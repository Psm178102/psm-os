"""
GET /api/v3/auth/me
Header: Authorization: Bearer <token>
Resp: { ok, user }

Retorna o usuário logado (validando JWT). Usado pelo frontend pra:
- Hidratar a sessão no boot
- Detectar token expirado e mandar pro login
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import current_user  # type: ignore


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
        user = current_user(self)
        if not user:
            return self._send(401, {"ok": False, "error": "não autenticado"})
        return self._send(200, {"ok": True, "user": user})
