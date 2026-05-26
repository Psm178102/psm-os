"""
POST /api/v3/agenda/delete
Body: { id }
Header: Authorization: Bearer <token>

Apaga evento. Apenas Sócio/Gerente OU criador.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Origin", "*")
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
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        evento_id = (body.get("id") or "").strip()
        if not evento_id:
            return self._send(400, {"ok": False, "error": "id obrigatório"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            cur = sb.table("eventos").select("*").eq("id", evento_id).limit(1).execute().data or []
            if not cur:
                return self._send(404, {"ok": False, "error": "evento não encontrado"})
            before = cur[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        is_socio_gerente = (actor.get("lvl") or 0) >= 7
        owner = before.get("criado_por") == actor["id"]
        if not is_socio_gerente and not owner:
            return self._send(403, {"ok": False, "error": "apenas Sócio/Gerente ou criador pode apagar"})

        try:
            sb.table("eventos").delete().eq("id", evento_id).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"delete: {e}"})

        audit(self, actor, "evento.delete", target_type="evento", target_id=evento_id, before=before)
        return self._send(200, {"ok": True, "id": evento_id})
