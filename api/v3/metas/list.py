"""
GET /api/v3/metas/list?ano=2026[&mes=5][&corretor_id=paulo]
Header: Authorization: Bearer <token>

Lista metas do ano (ou mês específico). Inclui users sem meta cadastrada
(retorna meta_vgv=0). Role-based:
- Sócio/Gerente (lvl>=7): vê todos
- Líder (lvl 5): vê só do team
- Corretor: só as próprias
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime

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

        now = datetime.now()
        try:
            ano = int(params.get("ano") or now.year)
        except Exception:
            ano = now.year
        mes = params.get("mes")
        if mes:
            try: mes = int(mes)
            except: mes = None
        corretor_filter = params.get("corretor_id")

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            # Lista users ativos
            users = sb.table("users").select("id,name,email,team,role,color,ini").execute().data or []
            users = [u for u in users if (u.get("status") or "ativo") == "ativo" or u.get("status") is None]

            # Filter por role
            lvl = user.get("lvl") or 0
            scope = "all"
            if lvl < 7:
                role = (user.get("role") or "").lower()
                if role == "lider":
                    team = (user.get("team") or "").lower()
                    users = [u for u in users if (u.get("team") or "").lower() == team]
                    scope = "team"
                else:
                    users = [u for u in users if u.get("id") == user["id"]]
                    scope = "self"

            if corretor_filter:
                users = [u for u in users if u.get("id") == corretor_filter]

            # Lista metas
            q = sb.table("metas").select("*").eq("ano", ano)
            if mes is not None:
                q = q.eq("mes", mes)
            metas_rows = q.execute().data or []
            # Index by corretor + mes
            metas_idx = {}
            for m in metas_rows:
                metas_idx[(m["corretor_id"], m["mes"])] = m

            # Compose: para cada user, lista todos os 12 meses (ou só o pedido)
            meses_list = [mes] if mes is not None else list(range(1, 13))
            grid = []
            for u in users:
                row = {"user": u, "metas": []}
                for m in meses_list:
                    meta = metas_idx.get((u["id"], m))
                    if meta:
                        row["metas"].append(meta)
                    else:
                        row["metas"].append({
                            "corretor_id": u["id"], "ano": ano, "mes": m,
                            "meta_vgv": 0, "meta_vendas": 0, "meta_pontos": 0,
                            "_empty": True,
                        })
                grid.append(row)

            return self._send(200, {
                "ok": True,
                "ano": ano,
                "mes": mes,
                "scope": scope,
                "users_count": len(users),
                "metas_count": len(metas_rows),
                "grid": grid,
            })
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
