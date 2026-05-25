"""
GET /api/v3/users/list
Header (opcional): Authorization: Bearer <token>

Lista todos os users (sem password_hash). Auth opcional — se logado,
inclui campos extras (last_login_at). Frontend pode chamar sem auth
no boot, mas o ideal é chamar com Bearer.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, current_user, enrich_user  # type: ignore


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            cols = "id,name,email,role,team,ini,color,rd_id,meta_id,status,hide_from_ranking,created_at,updated_at,last_login_at"
            res = sb.table("users").select(cols).order("name").execute()
            users = [enrich_user(u) for u in (res.data or [])]
            return self._send(200, {"ok": True, "count": len(users), "users": users})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
