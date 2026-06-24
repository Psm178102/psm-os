"""
GET/POST /api/v3/settings/role_perms — Permissões de MENU por papel (editável pelo sócio). v77.81

Override GRANULAR (por ROTA) de quais itens de menu cada papel enxerga, sobrepondo o
default por grupo (ROLE_ALLOWED do frontend). Guarda em shared_kv key 'role_perms'.

Estrutura: { "<role>": ["/rota1", "/rota2", ...], ... } — SÓ os papéis customizados.
Papel ausente do mapa = usa o default (comportamento original intacto).

⚠️ Isto controla VISIBILIDADE de menu/navegação no front. Cada endpoint do backend
segue exigindo seu nível mínimo (require_user) — liberar um item aqui não concede
acesso a dado acima do nível do usuário; apenas mostra/esconde no menu.

GET  (qualquer autenticado): {ok, perms}.
POST (lvl>=10 sócio): substitui o mapa inteiro pelo enviado. Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "role_perms"
# 'socio' nunca é customizável (não dá pra trancar o dono pra fora) → ignorado se vier.
VALID_ROLES = {"diretor", "gerente", "lider", "backoffice", "financeiro", "marketing", "corretor",
               "corretor_conquista", "corretor_map", "corretor_locacao"}
MAX_ROUTES = 300       # teto de rotas por papel
MAX_LEN = 80           # tamanho de uma chave de rota


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


def _clean(payload):
    """Mantém só papéis válidos, listas de strings de rota únicas, com teto."""
    out = {}
    for role, routes in (payload or {}).items():
        if role not in VALID_ROLES or not isinstance(routes, list):
            continue
        seen, clean = set(), []
        for r in routes:
            if not isinstance(r, str):
                continue
            r = r.strip()[:MAX_LEN]
            if r and r not in seen:
                seen.add(r); clean.append(r)
            if len(clean) >= MAX_ROUTES:
                break
        out[role] = clean
    return out


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
        return self._send(200, {"ok": True, "perms": _read(sb)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # só sócio edita a matriz
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

        perms = _clean(body.get("perms") if isinstance(body.get("perms"), dict) else body)
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": perms,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "role_perms.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "perms": perms})
