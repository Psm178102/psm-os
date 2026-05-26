"""
GET /api/v3/tasks/list[?status=&responsavel=&prioridade=&categoria=]
Header: Authorization: Bearer <token>

Lista tarefas de diretoria com filtros opcionais. Role-based:
- Sócio/Gerente (lvl>=7): vê todas
- Outros: vê onde são responsavel OU criado_por
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

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            q = sb.table("dir_tasks").select("*").order("updated_at", desc=True).limit(500)
            if params.get("status"):     q = q.eq("status", params["status"])
            if params.get("responsavel"):q = q.eq("responsavel", params["responsavel"])
            if params.get("prioridade"): q = q.eq("prioridade", params["prioridade"])
            if params.get("categoria"):  q = q.eq("categoria", params["categoria"])
            rows = (q.execute().data) or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Role-based filter (não-Sócio só vê onde é responsavel ou criador)
        is_socio_gerente = (user.get("lvl") or 0) >= 7
        if not is_socio_gerente:
            uid = user["id"]
            rows = [r for r in rows if r.get("responsavel") == uid or r.get("criado_por") == uid]

        return self._send(200, {
            "ok": True,
            "count": len(rows),
            "tasks": rows,
            "scope": "all" if is_socio_gerente else "mine",
            "filters": {k: v for k, v in params.items() if v},
        })
