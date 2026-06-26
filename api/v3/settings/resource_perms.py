"""
GET/POST /api/v3/settings/resource_perms — visibilidade de RECURSOS por papel. v81.81

Controla quem (por PAPEL) vê recursos granulares que NÃO são rotas próprias e por
isso não cabem na matriz de Permissões por papel (route-based). Ex.:
  - "mapa_map", "mapa_conquista"          → abas do Mapa de Empreendimentos
  - "ads_conquista","ads_map",
    "ads_locacao","ads_terceiros"          → categorias da Biblioteca de Anúncios

shared_kv key 'resource_perms' = { "<chave>": ["papel", ...] }.

Regra de visibilidade (decidida no front, documentada aqui):
  - chave AUSENTE, lista VAZIA ou contendo "*"  → TODOS veem (quem já tem a página).
  - senão                                       → só os papéis listados.
  - sócio sempre vê tudo (e administra).

GET  (qualquer autenticado): { ok, perms }.
POST (lvl>=10 sócio): faz MERGE do patch enviado (chave→lista de papéis). Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "resource_perms"
VALID_ROLES = {"socio", "diretor", "gerente", "lider", "backoffice", "financeiro", "marketing",
               "corretor", "corretor_conquista", "corretor_map", "corretor_locacao", "corretor_terceiros", "*"}
MAX_KEYS = 200
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


def _clean_list(roles):
    out, seen = [], set()
    for r in (roles or []):
        if not isinstance(r, str):
            continue
        r = r.strip()
        if r in VALID_ROLES and r not in seen:
            seen.add(r); out.append(r)
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
        patch = body.get("perms") if isinstance(body.get("perms"), dict) else body
        for k, v in (patch or {}).items():
            if not isinstance(k, str):
                continue
            k = k.strip()[:MAX_LEN]
            if not k or len(cur) >= MAX_KEYS:
                continue
            cur[k] = _clean_list(v)   # lista de papéis (vazia = todos)
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": cur,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "resource_perms.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "perms": cur})
