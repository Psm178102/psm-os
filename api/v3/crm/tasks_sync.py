"""
GET /api/v3/crm/tasks_sync[?days=60]
Header: Authorization: Bearer <CRON_SECRET>  (cron)  ou  Bearer <JWT lvl>=5>

Sincroniza as TAREFAS DE VISITA concluídas do RD Station CRM (GET /api/v1/tasks?type=visit&done=true)
para a tabela `rd_tasks`. Dicionário de Métricas v1 §5 (Paulo, 15/set): para MAP, Terceiros e
Locação a VISITA oficial é a tarefa de visita marcada como feita pelo corretor, não a coluna do funil.
v87.86 — roda a cada 30 min (vercel.json) e no botão 🔄 das telas.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, current_user, audit  # type: ignore

RD_BASE = "https://crm.rdstation.com/api/v1"
BRT = timezone(timedelta(hours=-3))


def _rd_tasks(token, params, page):
    p = dict(params)
    p.update({"token": token, "page": page, "limit": 200})
    req = urllib.request.Request(RD_BASE + "/tasks?" + urllib.parse.urlencode(p),
                                 headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/tasks_sync"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).isoformat()
    except Exception:
        return None


def _row(t, now_iso):
    users = t.get("users") or []
    email = ""
    if users and isinstance(users[0], dict):
        email = (users[0].get("email") or "").lower()
    deal = t.get("deal") or {}
    return {
        "id": str(t.get("id") or t.get("_id")),
        "type": t.get("type") or "visit",
        "done": bool(t.get("done")),
        "date": (str(t.get("date") or "")[:10] or None),
        "hour": t.get("hour"),
        "done_date": _iso(t.get("done_date")),
        "deal_id": str(t.get("deal_id") or (deal.get("id") if isinstance(deal, dict) else "") or "") or None,
        "user_email": email or None,
        "user_ids": t.get("user_ids") or [u.get("id") for u in users if isinstance(u, dict)],
        "subject": t.get("subject"),
        "raw": t,
        "synced_at": now_iso,
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        # cron (CRON_SECRET) ou gestor logado (lvl>=5)
        auth = self.headers.get("Authorization") or self.headers.get("authorization") or ""
        tok = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        secret = os.environ.get("CRON_SECRET")
        actor = None
        if not (secret and tok == secret):
            actor = current_user(self)
            if not actor or (actor.get("lvl") or 0) < 5:
                return self._send(401, {"ok": False, "error": "cron ou gestor (lvl>=5)"})
        rd_token = os.environ.get("RD_API_TOKEN")
        if not rd_token:
            return self._send(503, {"ok": False, "error": "RD_API_TOKEN ausente"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        try:
            days = max(1, min(400, int(q.get("days") or 60)))
        except Exception:
            days = 60
        hoje = datetime.now(BRT).date()
        params = {"type": "visit", "done": "true",
                  "done_date_start": (hoje - timedelta(days=days)).isoformat(),
                  "done_date_end": (hoje + timedelta(days=1)).isoformat()}
        t0 = time.time()
        now_iso = datetime.now(timezone.utc).isoformat()
        rows, errors, page = [], [], 1
        while page <= 40:
            try:
                data = _rd_tasks(rd_token, params, page)
            except urllib.error.HTTPError as e:
                errors.append(f"RD p{page}: HTTP {e.code}")
                break
            except Exception as e:
                errors.append(f"RD p{page}: {str(e)[:120]}")
                break
            tasks = data.get("tasks") if isinstance(data, dict) else data
            tasks = tasks or []
            rows += [_row(t, now_iso) for t in tasks if isinstance(t, dict)]
            has_more = bool(data.get("has_more")) if isinstance(data, dict) else (len(tasks) >= 200)
            if not tasks or not has_more:
                break
            page += 1
        up = 0
        for i in range(0, len(rows), 200):
            try:
                sb.table("rd_tasks").upsert(rows[i:i + 200], on_conflict="id").execute()
                up += len(rows[i:i + 200])
            except Exception as e:
                errors.append(f"upsert: {str(e)[:160]}")
                break
        try:
            audit(self, actor, "crm.tasks_sync", "rd_tasks", "*",
                  notes=f"visitas={len(rows)} upsert={up} days={days} {time.time()-t0:.1f}s erros={len(errors)}")
        except Exception:
            pass
        return self._send(200, {"ok": not errors, "fetched": len(rows), "upserted": up, "days": days,
                                "errors": errors, "duration_s": round(time.time() - t0, 1)})
