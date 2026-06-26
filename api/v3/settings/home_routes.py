"""
GET/POST /api/v3/settings/home_routes — TELA INICIAL por papel. v81.86

Define em que rota o sistema ABRE pra cada papel (modo inicializador). Ex.: o
corretor_conquista não inicia no Dashboard inicial e sim no /painel (ou /cockpit).
O front, no boot, se o hash for a landing padrão ('' ou '/'), redireciona pra rota
configurada do papel — desde que o usuário tenha permissão de ver (canSee).

shared_kv key 'home_routes' = { "<papel>": "/rota" }.  Rota vazia/ausente = padrão
(Dashboard '/').

GET  (qualquer autenticado): { ok, routes }.
POST (lvl>=10 sócio): MERGE do patch (papel→rota). Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "home_routes"
VALID_ROLES = {"socio", "diretor", "gerente", "lider", "backoffice", "financeiro", "marketing",
               "corretor", "corretor_conquista", "corretor_map", "corretor_locacao", "corretor_terceiros", "gerente_conquista", "gerente_map", "gerente_locacao", "gerente_terceiros", "secretaria_vendas"}
MAX_LEN = 60


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


def _clean_route(v):
    """Normaliza pra uma rota-hash segura: '/algo' (sem '#', sem espaço, curta).
    Vazio/'/' → '' (= usa padrão Dashboard)."""
    if not isinstance(v, str):
        return ""
    v = v.strip().lstrip("#").strip()
    if not v or v == "/":
        return ""
    if not v.startswith("/"):
        v = "/" + v
    # só caracteres de rota (letras, números, / - _ ? = &)
    if not re.match(r"^/[A-Za-z0-9/_\-?=&]{0," + str(MAX_LEN) + r"}$", v):
        return ""
    return v[:MAX_LEN + 1]


def _role_ok(r):
    """Aceita papel fixo (VALID_ROLES), '*' ou papel CUSTOM em formato slug
    (minúsculo, [a-z0-9_], começa com letra) — assim categorias novas funcionam
    sem precisar editar este arquivo. v81.91"""
    if not isinstance(r, str):
        return False
    r = r.strip()
    if r == "*" or r in VALID_ROLES:
        return True
    return (2 <= len(r) <= 41 and r == r.lower() and r[0].isalpha()
            and r.replace("_", "").isalnum())


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, {"ok": True, "routes": _read(sb)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # só sócio administra
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        cur = _read(sb)
        patch = body.get("routes") if isinstance(body.get("routes"), dict) else body
        for role, route in (patch or {}).items():
            if not isinstance(role, str) or not _role_ok(role.strip()):
                continue
            cur[role.strip()] = _clean_route(route)
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": cur,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "home_routes.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "routes": cur})
