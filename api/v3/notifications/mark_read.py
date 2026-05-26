"""
POST /api/v3/notifications/mark_read
Body: { ids?: [...], all?: true }

Marca notificações como lidas. user_id sempre filtrado pra evitar
um user marcar lida de outro.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone

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
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        ids = body.get("ids") or []
        mark_all = bool(body.get("all"))

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            patch = {"lida": True, "lida_em": datetime.now(timezone.utc).isoformat()}
            q = sb.table("notifications").update(patch).eq("user_id", user["id"]).eq("lida", False)
            if not mark_all:
                if not ids:
                    return self._send(400, {"ok": False, "error": "ids[] obrigatório ou all=true"})
                q = q.in_("id", ids)
            res = q.execute()
            count = len(res.data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        return self._send(200, {"ok": True, "marked": count})
