"""GET/POST /api/v3/adm/registros — Backoffice & Adm. v81.93

Conjuntos (shared_kv, lista de registros por chave):
  'adm_compras'      — solicitações de compra (item, qtd, urgência, responsável da
                       compra, método de pagamento, fornecedor, valores, status).
  'adm_estoque'      — controle de estoque (item, qtd atual, qtd mínima, unidade,
                       local, responsável) → alerta de reposição é calculado no front.
  'adm_patrimonio'   — patrimônio (nome, código, valor estimado, estado, local…).
  'adm_manutencoes'  — manutenções (equipamento, descrição, status, orçamentos[],
                       valor aprovado, responsável).

GET  (lvl>=2): { ok, compras, estoque, patrimonio, manutencoes }.
POST (lvl>=2):
  - action 'upsert' { modulo, registro }  → cria/atualiza (id auto).
  - action 'delete' { modulo, id }.
Tudo gated pela matriz de permissões (grupo 'adm').
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

MODULOS = {"compras": "adm_compras", "estoque": "adm_estoque",
           "patrimonio": "adm_patrimonio", "manutencoes": "adm_manutencoes"}
MAX_ROWS = 2000
NOW = lambda: datetime.now(timezone.utc).isoformat()


def _read(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        val = rows[0]["value"] if rows else []
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = []
    return val if isinstance(val, list) else []


def _write(sb, key, val):
    sb.table("shared_kv").upsert({"key": key, "value": val, "updated_at": NOW()}, on_conflict="key").execute()


def _sanit(v, depth=0):
    """Mantém JSON simples e limitado (str cap, listas/dicts rasos)."""
    if isinstance(v, str):
        return v[:4000]
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    if isinstance(v, list) and depth < 2:
        return [_sanit(x, depth + 1) for x in v[:60]]
    if isinstance(v, dict) and depth < 2:
        return {str(k)[:60]: _sanit(x, depth + 1) for k, x in list(v.items())[:40]}
    return str(v)[:4000]


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
        try: require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        out = {"ok": True}
        for mod, key in MODULOS.items():
            out[mod] = _read(sb, key)
        return self._send(200, out)

    def do_POST(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        action = (body.get("action") or "").strip()
        modulo = (body.get("modulo") or "").strip()
        key = MODULOS.get(modulo)
        if not key:
            return self._send(400, {"ok": False, "error": "modulo inválido"})
        lst = _read(sb, key)

        if action == "delete":
            rid = body.get("id")
            lst = [r for r in lst if r.get("id") != rid]
            try: _write(sb, key, lst)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, f"adm.{modulo}.delete", target_type="shared_kv", target_id=str(rid))
            return self._send(200, {"ok": True, modulo: lst})

        # upsert
        reg = body.get("registro")
        if not isinstance(reg, dict):
            return self._send(400, {"ok": False, "error": "registro inválido"})
        reg = {str(k)[:60]: _sanit(v) for k, v in reg.items()}
        rid = reg.get("id")
        if rid:
            found = False
            for i, r in enumerate(lst):
                if r.get("id") == rid:
                    reg["criado_em"] = r.get("criado_em") or NOW()
                    reg["criado_por"] = r.get("criado_por") or actor.get("id")
                    reg["updated_at"] = NOW()
                    lst[i] = reg; found = True; break
            if not found:
                lst.insert(0, reg)
        else:
            reg["id"] = f"{modulo[:3]}_{int(datetime.now().timestamp()*1000)}"
            reg["criado_em"] = NOW(); reg["criado_por"] = actor.get("id"); reg["updated_at"] = NOW()
            if len(lst) >= MAX_ROWS:
                return self._send(400, {"ok": False, "error": "limite atingido"})
            lst.insert(0, reg)
        try: _write(sb, key, lst)
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"adm.{modulo}.upsert", target_type="shared_kv", target_id=reg.get("id"),
              notes=(reg.get("item") or reg.get("nome") or "")[:60])
        return self._send(200, {"ok": True, "registro": reg, modulo: lst})
