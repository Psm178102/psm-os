"""
GET /api/v3/agenda/list[?since=YYYY-MM-DD&until=YYYY-MM-DD&tipo=&corretor_id=&status=]
Header: Authorization: Bearer <token>

Lista eventos com filtros opcionais. Default: hoje até +30d.
Role-based:
- Sócio/Gerente/Líder vê todos do scope
- Corretor vê eventos onde é corretor_id OU criado_por OU participante
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zoho"))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

_SYNC_THROTTLE_S = 20


def _sync_zoho_se_preciso(sb, user):
    """Puxa o Zoho do usuário ao abrir a Agenda, no máximo 1x a cada 20s.
    Best-effort e SÍNCRONO: a lista logo abaixo já sai com o que veio.
    Se o Zoho falhar/demorar, a Agenda abre normal com o que tem no banco."""
    try:
        import _zoho_lib as z  # type: ignore
        from sync import sync_user  # type: ignore
        if not z.configured():
            return None
        conn = z.get_conn(sb, user.get("id"))
        if not conn:
            return None
        ult = conn.get("last_sync_at")
        if ult:
            from datetime import datetime, timezone as _tz
            try:
                dt = datetime.fromisoformat(str(ult).replace("Z", "+00:00"))
                if (datetime.now(_tz.utc) - dt).total_seconds() < _SYNC_THROTTLE_S:
                    return {"pulado": "recente"}
            except Exception:
                pass
        return sync_user(sb, conn)
    except Exception:
        return None


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
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}

        today = date.today()
        since = params.get("since") or today.isoformat()
        until = params.get("until") or (today + timedelta(days=30)).isoformat()

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # SYNC AO ABRIR: o Zoho não tem webhook, então quem abre a Agenda puxa
        # na hora. É isto que faz parecer tempo real — você nunca olha dado
        # velho. Throttle de 20s pra não bater na Zoho a cada F5.
        zsync = _sync_zoho_se_preciso(sb, user)

        try:
            q = sb.table("eventos").select("*").gte("data", since).lte("data", until).order("data").order("hora_inicio")
            if params.get("tipo"):       q = q.eq("tipo", params["tipo"])
            if params.get("corretor_id"):q = q.eq("corretor_id", params["corretor_id"])
            if params.get("status"):     q = q.eq("status", params["status"])
            rows = q.limit(500).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Role filter
        lvl = user.get("lvl") or 0
        if lvl < 5:
            uid = user["id"]
            filtered = []
            for r in rows:
                if r.get("corretor_id") == uid: filtered.append(r); continue
                if r.get("criado_por") == uid: filtered.append(r); continue
                parts = r.get("participantes") or []
                if isinstance(parts, list) and uid in parts: filtered.append(r); continue
            rows = filtered
            scope = "self"
        elif lvl < 7:
            # Líder vê do team
            team = (user.get("team") or "").lower()
            team_ids = set()
            try:
                tu = sb.table("users").select("id").eq("team", team).execute().data or []
                team_ids = {u["id"] for u in tu}
                team_ids.add(user["id"])
            except Exception:
                pass
            rows = [r for r in rows if (r.get("corretor_id") in team_ids) or (r.get("criado_por") in team_ids)]
            scope = "team"
        else:
            scope = "all"

        return self._send(200, {
            "ok": True,
            "since": since,
            "until": until,
            "scope": scope,
            "count": len(rows),
            "eventos": rows,
            "zoho_sync": zsync,
        })
