"""
GET /api/v3/audit/list?[target_id=...&actor_id=...&action=...&limit=200&since=ISO]
Header: Authorization: Bearer <token>

Retorna entradas do audit_log. Requer auth.
Sócio vê tudo. Outros usuários veem só ações relacionadas a eles
(actor_id = self OR target_id = self).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


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

        limit = min(500, max(1, int(params.get("limit", "200") or "200")))
        target_id = params.get("target_id")
        actor_id  = params.get("actor_id")
        action    = params.get("action")
        since     = params.get("since")
        is_socio  = (user.get("lvl") or 0) >= 10

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            q = sb.table("audit_log").select("*").order("ts", desc=True).limit(limit)
            if target_id: q = q.eq("target_id", target_id)
            if actor_id:  q = q.eq("actor_id", actor_id)
            if action:    q = q.like("action", action + "%")
            if since:     q = q.gte("ts", since)
            rows = (q.execute().data) or []

            # Não-sócio: filtra pra ver só registros onde ele participa
            if not is_socio:
                uid = user["id"]
                rows = [r for r in rows if r.get("actor_id") == uid or r.get("target_id") == uid]

            return self._send(200, {"ok": True, "count": len(rows), "entries": rows})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
