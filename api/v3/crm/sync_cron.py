"""
GET /api/v3/crm/sync_cron
Header: Authorization: Bearer <CRON_SECRET>

Endpoint chamado pelo Vercel Cron 3×/dia (06, 12, 18 UTC).
Sincroniza deals RD → Postgres deals table.
Não requer JWT (cron é máquina-a-máquina).

Vercel envia Authorization: Bearer ${CRON_SECRET} automaticamente
quando CRON_SECRET está nas env vars.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, audit  # type: ignore


RD_BASE = "https://crm.rdstation.com/api/v1"


def _rd_page(token, params, page):
    p = dict(params)
    p["token"] = token
    p["page"] = page
    p["limit"] = 200
    url = RD_BASE + "/deals?" + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/cron"
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_iso(s):
    if not s: return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).isoformat()
    except Exception:
        return None


def _deal_to_row(d, users_by_email):
    user = d.get("user") or {}
    email = (user.get("email") or "").lower() if isinstance(user, dict) else ""
    pipe = d.get("deal_pipeline") or {}
    stage = d.get("deal_stage") or {}
    try:
        amount = float(d.get("amount_total") or d.get("amount_unique") or 0)
    except Exception:
        amount = 0.0
    return {
        "id": d.get("id"),
        "name": (d.get("name") or "")[:255],
        "amount": amount,
        "win": d.get("win"),
        "closed_at": _parse_iso(d.get("closed_at")),
        "created_at_rd": _parse_iso(d.get("created_at")),
        "updated_at_rd": _parse_iso(d.get("updated_at")),
        "pipeline_id": pipe.get("id") if isinstance(pipe, dict) else None,
        "pipeline_name": (pipe.get("name") if isinstance(pipe, dict) else None) or None,
        "stage_id": stage.get("id") if isinstance(stage, dict) else None,
        "stage_name": (stage.get("name") if isinstance(stage, dict) else None) or None,
        "user_email": email or None,
        "user_id": users_by_email.get(email),
        "rd_raw": d,
    }


def _verify_cron(headers) -> tuple[bool, str]:
    """Vercel cron envia Authorization: Bearer ${CRON_SECRET}.
    Se CRON_SECRET não configurado, recusa.
    """
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False, "CRON_SECRET ausente no Vercel — configure pra habilitar cron"
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return False, "Authorization header ausente"
    token = auth[7:].strip()
    if token != secret:
        return False, "CRON_SECRET inválido"
    return True, ""


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        ok, msg = _verify_cron(self.headers)
        if not ok:
            return self._send(401, {"ok": False, "error": msg})

        rd_token = os.environ.get("RD_API_TOKEN")
        if not rd_token:
            return self._send(503, {"ok": False, "error": "RD_API_TOKEN ausente"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})

        t0 = time.time()
        try:
            urows = sb.table("users").select("id,email").execute().data or []
            users_by_email = {(u.get("email") or "").lower(): u["id"] for u in urows if u.get("email")}
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"users: {e}"})

        total_fetched = 0
        rows_buffer = []
        upserted = 0
        errors = []
        pages_done = 0
        max_pages = 30

        for page in range(1, max_pages + 1):
            try:
                data = _rd_page(rd_token, {}, page)
            except Exception as e:
                errors.append(f"page {page}: {e}")
                break
            deals = data.get("deals") or []
            pages_done = page
            if not deals: break
            total_fetched += len(deals)
            for d in deals:
                if d.get("id"):
                    rows_buffer.append(_deal_to_row(d, users_by_email))
            if len(rows_buffer) >= 200:
                try:
                    sb.table("deals").upsert(rows_buffer, on_conflict="id").execute()
                    upserted += len(rows_buffer)
                except Exception as e:
                    errors.append(f"upsert: {e}")
                rows_buffer = []
            if len(deals) < 200: break

        if rows_buffer:
            try:
                sb.table("deals").upsert(rows_buffer, on_conflict="id").execute()
                upserted += len(rows_buffer)
            except Exception as e:
                errors.append(f"upsert final: {e}")

        duration = round(time.time() - t0, 2)

        # Audit (actor=null = sistema)
        audit(self, None, "crm.sync_cron", target_type="deals", target_id="*",
              notes=f"upserted={upserted} pages={pages_done} {duration}s")

        # Piggyback: cria captações dos leads na etapa CAPTAR IMÓVEL (rede de segurança
        # caso o cron dedicado captar_cron falhe). Idempotente (dedup rd_deal_id).
        captar = None
        try:
            from _captar_lib import import_captar  # type: ignore
            captar = import_captar(sb, rd_token)
            if captar and captar.get("created"):
                audit(self, None, "captacao.auto_rd", target_type="captacoes", target_id="*",
                      notes=f"criadas={captar.get('created')} via sync_cron")
        except Exception as e:
            captar = {"ok": False, "error": str(e)}

        return self._send(200, {
            "ok": len(errors) == 0,
            "actor": "cron",
            "total_fetched": total_fetched,
            "upserted": upserted,
            "pages_done": pages_done,
            "errors": errors,
            "captar_import": captar,
            "duration_s": duration,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        })
