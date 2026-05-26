"""
POST /api/v3/crm/sync
Header: Authorization: Bearer <token>

Sincroniza deals do RD CRM API → tabela `deals` no Postgres.
Paginação até max_pages, upsert por id, match user via email.

Sócio/Gerente only (lvl>=7).

Body opcional: { pipeline_id?, win?, max_pages? (default 30) }

Resp: { ok, inserted_or_updated, total_fetched, errors, duration_s }
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
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


RD_BASE = "https://crm.rdstation.com/api/v1"


def _rd_page(token, params, page):
    p = dict(params)
    p["token"] = token
    p["page"] = page
    p["limit"] = 200
    url = RD_BASE + "/deals?" + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/sync"
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_iso(s):
    if not s: return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).isoformat()
    except Exception:
        return None


def _amount(d):
    try: return float(d.get("amount_total") or d.get("amount_unique") or 0)
    except: return 0.0


def _deal_to_row(d, users_by_email):
    user = d.get("user") or {}
    email = (user.get("email") or "").lower() if isinstance(user, dict) else ""
    matched_uid = users_by_email.get(email)
    pipe = d.get("deal_pipeline") or {}
    stage = d.get("deal_stage") or {}
    return {
        "id": d.get("id"),
        "name": (d.get("name") or "")[:255],
        "amount": _amount(d),
        "win": d.get("win"),
        "closed_at": _parse_iso(d.get("closed_at")),
        "created_at_rd": _parse_iso(d.get("created_at")),
        "updated_at_rd": _parse_iso(d.get("updated_at")),
        "pipeline_id": pipe.get("id") if isinstance(pipe, dict) else None,
        "pipeline_name": (pipe.get("name") if isinstance(pipe, dict) else None) or None,
        "stage_id": stage.get("id") if isinstance(stage, dict) else None,
        "stage_name": (stage.get("name") if isinstance(stage, dict) else None) or None,
        "user_email": email or None,
        "user_id": matched_uid,
        "rd_raw": d,
    }


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        token = os.environ.get("RD_API_TOKEN")
        if not token:
            return self._send(503, {"ok": False, "error": "RD_API_TOKEN ausente"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            body = {}

        max_pages = min(50, int(body.get("max_pages") or 30))
        params = {}
        if body.get("pipeline_id"): params["deal_pipeline_id"] = body["pipeline_id"]
        if body.get("win") in (True, "true", "false", False):
            params["win"] = "true" if body["win"] in (True, "true") else "false"

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})

        t0 = time.time()
        # Mapa de users por email
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

        for page in range(1, max_pages + 1):
            try:
                data = _rd_page(token, params, page)
            except urllib.error.HTTPError as e:
                errors.append(f"page {page}: HTTP {e.code}")
                break
            except Exception as e:
                errors.append(f"page {page}: {e}")
                break
            deals = data.get("deals") or []
            pages_done = page
            if not deals:
                break
            total_fetched += len(deals)
            for d in deals:
                if not d.get("id"): continue
                rows_buffer.append(_deal_to_row(d, users_by_email))
            # Flush a cada 200
            if len(rows_buffer) >= 200:
                try:
                    sb.table("deals").upsert(rows_buffer, on_conflict="id").execute()
                    upserted += len(rows_buffer)
                except Exception as e:
                    errors.append(f"upsert batch: {e}")
                rows_buffer = []
            if len(deals) < 200:
                break

        if rows_buffer:
            try:
                sb.table("deals").upsert(rows_buffer, on_conflict="id").execute()
                upserted += len(rows_buffer)
            except Exception as e:
                errors.append(f"upsert final: {e}")

        duration = time.time() - t0
        audit(self, actor, "crm.sync", target_type="deals", target_id="*",
              notes=f"upserted={upserted} pages={pages_done} {duration:.1f}s")

        return self._send(200, {
            "ok": len(errors) == 0,
            "total_fetched": total_fetched,
            "upserted": upserted,
            "pages_done": pages_done,
            "errors": errors,
            "duration_s": round(duration, 2),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        })
