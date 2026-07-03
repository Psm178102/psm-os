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
KV_LVL = "role_lvl_overrides"   # {role_fixo: lvl} — níveis dos papéis fixos editados pelo sócio. v83.9
# ids reservados (papéis fixos) — não podem ser sobrescritos/colididos
BUILTIN = {"socio", "diretor", "gerente", "gerente_conquista", "gerente_map", "gerente_locacao",
           "gerente_terceiros", "lider", "líder", "backoffice", "back_office", "secretaria_vendas",
           "financeiro", "marketing", "corretor", "corretor_conquista", "corretor_map",
           "corretor_locacao", "corretor_terceiros"}
# níveis BASE dos fixos (espelha o ROLE_LVL do _auth_lib; a Central mostra/edita por cima)
BUILTIN_LVL = {"socio": 10, "diretor": 10,
               "gerente": 7, "gerente_conquista": 7, "gerente_map": 7, "gerente_locacao": 7, "gerente_terceiros": 7,
               "backoffice": 6, "lider": 5, "financeiro": 4, "marketing": 3, "secretaria_vendas": 3,
               "corretor": 2, "corretor_conquista": 2, "corretor_map": 2, "corretor_locacao": 2, "corretor_terceiros": 2}
LOCKED = {"socio", "diretor"}   # anti-lockout: nível não editável
MAX_ROLES = 60


def _read_lvl_overrides(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_LVL).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
        return {str(k).lower(): max(1, min(10, int(v))) for k, v in (val or {}).items()
                if str(k).lower() in BUILTIN_LVL and str(k).lower() not in LOCKED} if isinstance(val, dict) else {}
    except Exception:
        return {}


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
        # v83.9 — Central de Permissões: devolve também os papéis FIXOS com nível
        # EFETIVO (base + override do sócio via shared_kv 'role_lvl_overrides').
        ov = _read_lvl_overrides(sb)
        builtin = [{"id": rid, "lvl_base": base, "lvl": ov.get(rid, base), "override": rid in ov}
                   for rid, base in sorted(BUILTIN_LVL.items(), key=lambda x: (-x[1], x[0]))]
        return self._send(200, {"ok": True, "roles": _read(sb), "builtin": builtin, "lvl_overrides": ov})

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

        if action == "set_lvl":   # nível de papel FIXO (Central de Permissões, sócio define). v83.9
            rid = (body.get("role") or "").strip().lower()
            if rid not in BUILTIN_LVL:
                return self._send(400, {"ok": False, "error": "papel fixo desconhecido (custom edita via 'add')"})
            if rid in LOCKED:
                return self._send(400, {"ok": False, "error": "socio/diretor têm nível travado (proteção anti-lockout)"})
            ov = _read_lvl_overrides(sb)
            raw = body.get("lvl")
            if raw in (None, "", "reset"):
                ov.pop(rid, None)   # volta ao nível base
            else:
                try:
                    ov[rid] = max(1, min(10, int(raw)))
                except Exception:
                    return self._send(400, {"ok": False, "error": "lvl inválido (1–10)"})
                if ov[rid] == BUILTIN_LVL[rid]:
                    ov.pop(rid, None)   # igual ao base = sem override
            try:
                sb.table("shared_kv").upsert({"key": KV_LVL, "value": ov,
                                              "updated_at": datetime.now(timezone.utc).isoformat()},
                                             on_conflict="key").execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "roles.set_lvl", target_type="shared_kv", target_id=rid, notes=str(body.get("lvl")))
            builtin = [{"id": r, "lvl_base": b, "lvl": ov.get(r, b), "override": r in ov}
                       for r, b in sorted(BUILTIN_LVL.items(), key=lambda x: (-x[1], x[0]))]
            return self._send(200, {"ok": True, "builtin": builtin, "lvl_overrides": ov})

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
