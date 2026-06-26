"""
GET/POST /api/v3/settings/roles — CATEGORIAS DE LOGIN custom (papéis). v81.91

Permite o sócio CRIAR/REMOVER categorias de login (papéis) pela tela de Usuários,
sem mexer no código. Os papéis fixos (socio, gerente, corretor_*, etc.) continuam
embutidos; aqui ficam só os CUSTOM.

shared_kv key 'custom_roles' = [ { id, label, lvl, color, ico } ].
O nível (lvl) é lido pelo _auth_lib.lvl_of (cache 60s) → o login do papel custom
já entra com o nível certo. Visões/permissões: o sócio configura na matriz.

GET  (qualquer autenticado): { ok, roles }.
POST (lvl>=10):
  - action 'add'    { label, lvl, color?, ico?, id? } → cria/atualiza (id = slug do label).
  - action 'remove' { id, force? }                    → remove (bloqueia se há user ativo usando, salvo force).
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "custom_roles"
# ids reservados (papéis fixos) — não podem ser sobrescritos/colididos
BUILTIN = {"socio", "diretor", "gerente", "gerente_conquista", "gerente_map", "gerente_locacao",
           "gerente_terceiros", "lider", "líder", "backoffice", "back_office", "secretaria_vendas",
           "financeiro", "marketing", "corretor", "corretor_conquista", "corretor_map",
           "corretor_locacao", "corretor_terceiros"}
MAX_ROLES = 60


def _slug(s):
    s = (s or "").strip().lower()
    s = s.replace("á", "a").replace("ã", "a").replace("â", "a").replace("é", "e").replace("ê", "e")
    s = s.replace("í", "i").replace("ó", "o").replace("ô", "o").replace("õ", "o").replace("ú", "u").replace("ç", "c")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:40]


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else []
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = []
    return val if isinstance(val, list) else []


def _write(sb, val):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": val, "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


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
        return self._send(200, {"ok": True, "roles": _read(sb)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # só sócio gerencia categorias
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

        action = (body.get("action") or "").strip()
        roles = _read(sb)

        if action == "add":
            label = (body.get("label") or "").strip()[:60]
            if not label:
                return self._send(400, {"ok": False, "error": "label obrigatório"})
            rid = _slug(body.get("id") or label)
            if not rid:
                return self._send(400, {"ok": False, "error": "id inválido"})
            if rid in BUILTIN:
                return self._send(400, {"ok": False, "error": f"'{rid}' é um papel fixo do sistema"})
            try:
                lvl = max(1, min(10, int(body.get("lvl") or 2)))
            except Exception:
                lvl = 2
            entry = {"id": rid, "label": label, "lvl": lvl,
                     "color": (body.get("color") or "#64748b")[:9], "ico": (body.get("ico") or "🏷️")[:4]}
            found = False
            for i, r in enumerate(roles):
                if isinstance(r, dict) and r.get("id") == rid:
                    roles[i] = entry; found = True; break
            if not found:
                if len(roles) >= MAX_ROLES:
                    return self._send(400, {"ok": False, "error": "limite de categorias atingido"})
                roles.append(entry)
            try:
                _write(sb, roles)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "roles.add", target_type="shared_kv", target_id=rid, notes=label)
            return self._send(200, {"ok": True, "roles": roles, "id": rid})

        if action == "remove":
            rid = _slug(body.get("id") or "")
            if not rid:
                return self._send(400, {"ok": False, "error": "id obrigatório"})
            if not body.get("force"):
                try:
                    used = sb.table("users").select("id").eq("role", rid).eq("status", "ativo").execute().data or []
                except Exception:
                    used = []
                if used:
                    return self._send(409, {"ok": False, "error": f"{len(used)} usuário(s) ativo(s) usam essa categoria — reatribua antes (ou force).", "em_uso": len(used)})
            roles = [r for r in roles if not (isinstance(r, dict) and r.get("id") == rid)]
            try:
                _write(sb, roles)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "roles.remove", target_type="shared_kv", target_id=rid)
            return self._send(200, {"ok": True, "roles": roles})

        return self._send(400, {"ok": False, "error": "action inválida"})
