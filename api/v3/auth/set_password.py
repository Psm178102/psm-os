"""
POST /api/v3/auth/set_password
Body: { "user_id": "...", "new_password": "..." }
Header (opcional): Authorization: Bearer <token>

Regras:
- Bootstrap: se o user-alvo ainda NÃO tem password_hash → permite sem auth
  (usado pra primeira definição de senha do Paulo + outros).
- Caso contrário, requer JWT do PRÓPRIO user OU de um Sócio/Diretor (lvl >= 10).

Resp: { ok }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (  # type: ignore
    supabase_client, hash_password, current_user
)


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
            return self._send(400, {"ok": False, "error": "senha precisa ter ≥ 6 caracteres"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # Lê target user
        try:
            res = sb.table("users").select("id,password_hash,status").eq("id", user_id).limit(1).execute()
            rows = res.data or []
            target = rows[0] if rows else None
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro consulta: {e}"})

        if not target:
            return self._send(404, {"ok": False, "error": "user não encontrado"})

        # Bootstrap: se ainda não tem senha, permite sem auth (modo "primeira definição")
        is_bootstrap = not target.get("password_hash")

        if not is_bootstrap:
            # Requer auth: ou o próprio user, ou Sócio
            actor = current_user(self)
            if not actor:
                return self._send(401, {"ok": False, "error": "autenticação necessária"})
            if actor["id"] != user_id and (actor.get("lvl") or 0) < 10:
                return self._send(403, {"ok": False, "error": "apenas o próprio user ou um Sócio pode alterar"})

        # Hash + grava
        try:
            new_hash = hash_password(new_password)
            sb.table("users").update({
                "password_hash": new_hash,
                "password_set_at": "now()",
            }).eq("id", user_id).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro gravar senha: {e}"})

        return self._send(200, {
            "ok": True,
            "bootstrap": is_bootstrap,
            "message": "senha definida com sucesso",
        })
