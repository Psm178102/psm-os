"""
POST /api/v3/users/admin_reset_password
Body: { "user_id": "...", "new_password": "..." }
Header: Authorization: Bearer <token>

Permite ao Sócio (lvl >= 10) resetar a senha de qualquer user
SEM precisar conhecer a senha atual. Útil quando alguém esquece.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, hash_password, require_user, AuthError  # type: ignore


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
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)  # Apenas Sócio
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        user_id = (body.get("user_id") or "").strip()
        new_password = body.get("new_password") or ""

        if not user_id or not new_password:
            return self._send(400, {"ok": False, "error": "user_id e new_password obrigatórios"})
        if len(new_password) < 6:
            return self._send(400, {"ok": False, "error": "senha precisa ≥ 6 caracteres"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            new_hash = hash_password(new_password)
            res = sb.table("users").update({
                "password_hash": new_hash,
                "password_set_at": "now()",
            }).eq("id", user_id).execute()
            if not (res.data or []):
                return self._send(404, {"ok": False, "error": "user não encontrado"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro reset: {e}"})

        return self._send(200, {
            "ok": True,
            "message": f"senha de '{user_id}' resetada por '{actor['id']}'",
        })
