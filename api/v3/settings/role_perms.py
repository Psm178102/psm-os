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
KV_ROUTE_LVL = "route_min_lvl"   # {"/rota": lvl} — travas de nível por rota editáveis pelo sócio (Central de Permissões). v83.9
# 'socio' nunca é customizável (não dá pra trancar o dono pra fora) → ignorado se vier.
VALID_ROLES = {"diretor", "gerente", "lider", "backoffice", "financeiro", "marketing", "corretor",
               "corretor_conquista", "corretor_map", "corretor_locacao", "corretor_terceiros", "gerente_conquista", "gerente_map", "gerente_locacao", "gerente_terceiros", "secretaria_vendas"}
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
        if not _role_ok(role) or not isinstance(routes, list):
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


def _read_route_lvl(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_ROUTE_LVL).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
        out = {}
        for k, v in (val or {}).items():
            k = str(k).strip()
            if k.startswith("/") and len(k) <= MAX_LEN:
                try:
                    out[k] = max(0, min(10, int(v)))
                except Exception:
                    pass
        return out
    except Exception:
        return {}


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
        return self._send(200, {"ok": True, "perms": _read(sb), "route_lvl": _read_route_lvl(sb)})

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

        # v83.9 — Central de Permissões: POST só de travas de rota (não mexe na matriz)
        if isinstance(body.get("route_lvl"), dict) and "perms" not in body:
            rl = {}
            for k, v in body["route_lvl"].items():
                k = str(k).strip()
                if k.startswith("/") and len(k) <= MAX_LEN:
                    try:
                        rl[k] = max(0, min(10, int(v)))
                    except Exception:
                        pass
            try:
                sb.table("shared_kv").upsert({"key": KV_ROUTE_LVL, "value": rl,
                                              "updated_at": datetime.now(timezone.utc).isoformat()},
                                             on_conflict="key").execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "role_perms.route_lvl", target_type="shared_kv", target_id=KV_ROUTE_LVL)
            return self._send(200, {"ok": True, "route_lvl": rl})

        perms = _clean(body.get("perms") if isinstance(body.get("perms"), dict) else body)
        # snapshot ANTES (v84.84): toda alteração da matriz fica reversível pelo
        # audit_log. Sem isto, o caso Nayara (5 rotas apagadas em silêncio) não
        # teria como ser desfeito nem provado. Mesma lição do incidente da Leire.
        try:
            _ant = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
            antes = _ant[0]["value"] if _ant else {}
        except Exception:
            antes = None
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": perms,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "role_perms.update", target_type="shared_kv", target_id=KV_KEY,
              before=antes, after=perms)
        return self._send(200, {"ok": True, "perms": perms})
