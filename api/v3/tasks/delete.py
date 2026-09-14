"""
POST /api/v3/tasks/delete
Body: { id }
Header: Authorization: Bearer <token>

Apaga uma tarefa. Sócio (lvl>=10) apaga qualquer uma. v87.81: quem CRIOU uma
tarefa PRA SI MESMO (sem responsável ou responsável = ele) também apaga — era
lixo pessoal que só o sócio conseguia tirar. Tarefa atribuída por outra pessoa
continua só concluível/cancelável (o histórico de quem cobrou fica).
Apagar a tarefa apaga junto o espelho dela na Agenda e no Zoho (antes ficava órfão).
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
            actor = require_user(self, min_lvl=0)
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
            uid = actor.get("id")
            dono_pessoal = before.get("criado_por") == uid and before.get("responsavel") in (None, "", uid)
            if (actor.get("lvl") or 0) < 10 and not dono_pessoal:
                return self._send(403, {"ok": False, "error": "Só o sócio ou quem criou a tarefa pra si pode excluir. Você pode cancelar."})
            sb.table("dir_tasks").delete().eq("id", task_id).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro delete: {e}"})

        try:
            from _espelho_agenda import apagar_espelho  # type: ignore
            apagar_espelho(sb, task_id, before.get("responsavel"))
        except Exception as e:
            print(f"[task.delete] espelho: {e}")

        audit(self, actor, "task.delete", target_type="dir_task", target_id=task_id,
              before=before, notes=f"deletada por {actor.get('name')}")
        return self._send(200, {"ok": True, "id": task_id})
