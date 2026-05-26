"""
POST /api/v3/tasks/delete
Body: { id }
Header: Authorization: Bearer <token>

Apaga uma tarefa. Apenas Sócio (lvl>=10).
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
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        task_id = (body.get("id") or "").strip()
        if not task_id:
            return self._send(400, {"ok": False, "error": "id obrigatório"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            cur = sb.table("dir_tasks").select("*").eq("id", task_id).limit(1).execute().data or []
            if not cur:
                return self._send(404, {"ok": False, "error": "tarefa não encontrada"})
            before = cur[0]
            sb.table("dir_tasks").delete().eq("id", task_id).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro delete: {e}"})

        audit(self, actor, "task.delete", target_type="dir_task", target_id=task_id,
              before=before, notes=f"deletada por {actor.get('name')}")
        return self._send(200, {"ok": True, "id": task_id})
