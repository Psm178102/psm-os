"""
GET /api/v3/users/list[?all=1]
Header (opcional): Authorization: Bearer <token>

Lista os users (sem password_hash). Por PADRÃO, usuários INATIVOS **ou**
OCULTOS são EXCLUÍDOS — assim não poluem NENHUM dropdown/opção do sistema
(responsável, 1:1, equipes, talentos, etc.). Inativar OU ocultar OU excluir
já tira a pessoa de toda opção. Passe ?all=1 pra trazer todos (só a Gestão
de Usuários, que precisa vê-los pra reativar). v81.86
Auth opcional — se logado, inclui campos extras (last_login_at).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, current_user, enrich_user  # type: ignore


def _hidden_from_pickers(u):
    """Some das OPÇÕES/dropdowns quando o usuário está INATIVO **ou** OCULTO
    (hide_from_ranking). Antes era 'E' (só sumia quem estava inativo E oculto),
    o que deixava entrar gente sem sentido nos seletores. Agem como filtro de
    picker; a Gestão (?all=1) vê todos. v81.86"""
    inativo = (u.get("status") or "ativo") != "ativo"
    oculto = bool(u.get("hide_from_ranking"))
    return inativo or oculto


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
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        except Exception:
            qs = {}
        show_all = (qs.get("all", ["0"])[0] or "").lower() in ("1", "true", "yes")

        try:
            cols = "id,name,email,role,team,ini,color,rd_id,meta_id,status,hide_from_ranking,created_at,updated_at,last_login_at,menu_groups"
            res = sb.table("users").select(cols).order("name").execute()
            rows = res.data or []
            if not show_all:
                rows = [r for r in rows if not _hidden_from_pickers(r)]   # inativo OU oculto sai dos pickers
            users = [enrich_user(u) for u in rows]
            return self._send(200, {"ok": True, "count": len(users), "users": users})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
