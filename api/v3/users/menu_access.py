"""
POST /api/v3/users/menu_access — concede/revoga acesso a GRUPOS ou ROTAS específicas
no menu de um usuário (coluna users.menu_groups, allowlist por usuário). v77.70

Body: { "id": "<user_id>", "add": ["/criativos", ...], "remove": [...], "set": [...], "clear": true }
  • add    → faz UNIÃO com o menu_groups atual (não derruba o que já tinha)
  • remove → tira da lista
  • set    → substitui a lista inteira (use com cuidado)
  • clear  → zera o override (menu_groups = NULL) → o usuário volta a seguir as
            "Permissões por papel". Use pra desfazer uma exceção individual. v81.34
Header: Authorization: Bearer <token>. Requer Sócio (lvl>=10).

Observação: grupos sempre visíveis (inicio/conta/academy) não precisam estar na lista.
Quando menu_groups vira uma lista (não-nula), ela MANDA sobre o cargo (canSee()).
Retorna { ok, id, before, after }.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


def _norm_list(v):
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        s = str(x or "").strip()
        if s and s not in out:
            out.append(s)
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)  # só sócio mexe em permissão
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        target = (body.get("id") or "").strip()
        if not target:
            return self._send(400, {"ok": False, "error": "id obrigatório"})
        add = _norm_list(body.get("add"))
        remove = _norm_list(body.get("remove"))
        has_set = isinstance(body.get("set"), list)
        has_clear = bool(body.get("clear"))   # clear=true → zera o override (NULL) → volta a seguir o PAPEL
        if not add and not remove and not has_set and not has_clear:
            return self._send(400, {"ok": False, "error": "informe add, remove, set ou clear"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        try:
            cur = sb.table("users").select("id,name,menu_groups").eq("id", target).limit(1).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"leitura: {e}"})
        if not cur:
            return self._send(404, {"ok": False, "error": "usuário não encontrado"})
        before = cur[0].get("menu_groups")
        base = before if isinstance(before, list) else []

        if has_clear:
            new = None   # NULL real → canSee passa a usar a matriz do PAPEL (não a lista individual)
        elif has_set:
            new = _norm_list(body.get("set"))
        else:
            new = list(base)
            for r in add:
                if r not in new:
                    new.append(r)
            new = [r for r in new if r not in remove]

        try:
            sb.table("users").update({"menu_groups": new}).eq("id", target).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"update: {e}"})
        try:
            audit(self, actor, "user.menu_access", target_type="user", target_id=target,
                  before={"menu_groups": before}, after={"menu_groups": new})
        except Exception:
            pass
        return self._send(200, {"ok": True, "id": target, "name": cur[0].get("name"),
                                "before": before, "after": new})
