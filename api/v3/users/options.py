"""
GET /api/v3/users/options?group=marketing&route=/criativos — usuários elegíveis
a ver um grupo/aba (mesma regra do menu lateral). Usado pra popular dropdowns de
responsável só com quem tem acesso à seção. v77.68

Retorna { ok, users:[{id, name, login, email, role, lvl}] } ordenado por nome.
login = email (o que a pessoa usa pra logar); cai no id se não houver email.
lvl>=3 (qualquer cargo operacional pode listar responsáveis da sua área).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, lvl_of  # type: ignore

# espelha o ROLE_ALLOWED do frontend (v2/js/main.js) — política de acesso por cargo
ROLE_ALLOWED = {
    "lider":      ["inicio", "vendas", "captacoes", "locacao", "marketing", "performance", "ia", "cultura", "ferramentas", "conta"],
    "líder":      ["inicio", "vendas", "captacoes", "locacao", "marketing", "performance", "ia", "cultura", "ferramentas", "conta"],
    "marketing":  ["inicio", "marketing", "captacoes", "cultura", "conta"],
    "backoffice": ["inicio", "captacoes", "vendas", "locacao", "cultura", "conta"],
    "financeiro": ["inicio", "financeiro", "cultura", "conta"],
    "corretor":   ["inicio", "vendas", "captacoes", "locacao", "performance", "ia", "cultura", "ferramentas", "conta"],
    "corretor_conquista": ["inicio", "vendas", "captacoes", "locacao", "performance", "ia", "cultura", "ferramentas", "conta"],
    "corretor_map":       ["inicio", "vendas", "captacoes", "locacao", "performance", "ia", "cultura", "ferramentas", "conta"],
    "corretor_locacao":   ["inicio", "vendas", "captacoes", "locacao", "performance", "ia", "cultura", "ferramentas", "conta"],
    "corretor_terceiros": ["inicio", "vendas", "captacoes", "locacao", "performance", "ia", "cultura", "ferramentas", "conta"],
}
ALWAYS = ("inicio", "conta", "academy")  # grupos sempre visíveis


def _can_see(role, lvl, menu_groups, group, route):
    """Mesma lógica do canSee()/_allowedGroups() do frontend."""
    if group in ALWAYS:
        return True
    if isinstance(menu_groups, list):          # override por usuário MANDA
        return (group in menu_groups) or (bool(route) and route in menu_groups)
    if (lvl or 0) >= 7:                          # sócio/diretor/gerente veem tudo
        return True
    return group in ROLE_ALLOWED.get((role or "corretor").lower(), ROLE_ALLOWED["corretor"])


def _inactive(status):
    return (status or "").strip().lower() in ("inativo", "inactive", "disabled", "desligado")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=3)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        group = (params.get("group") or "").strip().lower()
        route = (params.get("route") or "").strip().lower()
        if not group:
            return self._send(400, {"ok": False, "error": "group obrigatório"})

        base = "id,name,email,role,status"
        try:
            rows = sb.table("users").select(base + ",menu_groups").order("name").execute().data or []
        except Exception:
            rows = sb.table("users").select(base).order("name").execute().data or []

        out = []
        for u in rows:
            if _inactive(u.get("status")):
                continue
            role = (u.get("role") or "corretor").lower()
            lvl = lvl_of(role)
            mg = u.get("menu_groups")
            if not _can_see(role, lvl, mg if isinstance(mg, list) else None, group, route):
                continue
            login = (u.get("email") or "").strip() or u.get("id")
            out.append({"id": u.get("id"), "name": u.get("name"), "login": login,
                        "email": u.get("email"), "role": role, "lvl": lvl})
        return self._send(200, {"ok": True, "group": group, "count": len(out), "users": out})
