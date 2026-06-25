"""
GET/POST /api/v3/cs/registros — Registros do Sucesso do Cliente (genérico). v81.53

Um endpoint serve os módulos do CS que são "lista de fichas":
  onb_cliente  → Onboarding do cliente (por categoria)
  suporte      → Central de relacionamento e suporte (tickets/contatos)
  retencao     → Retenção e renovação
  upsell       → Upsell & Cross-sell
  marketing    → Customer Marketing (depoimentos/cases)
  avaliacoes   → Avaliações de atendimento
  indicacoes   → Programa de Indicações (por categoria)
Guardado em shared_kv key 'cs_registros': { "<modulo>": [ <ficha>, ... ] }.
Template de campos no front (sem migração). Acesso: líder+ (lvl>=5).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "cs_registros"
MODULOS = ("onb_cliente", "suporte", "retencao", "upsell", "marketing", "avaliacoes", "indicacoes")
MAX_ROWS = 2000
MAX_FIELDS = 30
MAX_STR = 4000
MAX_KEYLEN = 40


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    if not isinstance(val, dict):
        val = {}
    for m in MODULOS:
        if not isinstance(val.get(m), list):
            val[m] = []
    return val


def _write(sb, val):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": val, "updated_at": _now()}, on_conflict="key").execute()


def _clean(raw):
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in list(raw.items())[:MAX_FIELDS]:
        if not isinstance(k, str) or k in ("id", "created_at", "updated_at"):
            continue
        k = k.strip()[:MAX_KEYLEN]
        if not k:
            continue
        if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
            out[k] = v
        else:
            out[k] = str(v)[:MAX_STR]
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
        try: require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, {"ok": True, "registros": _read(sb)})

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

        modulo = body.get("modulo")
        if modulo not in MODULOS:
            return self._send(400, {"ok": False, "error": "módulo inválido"})
        action = body.get("action") or "upsert"
        val = _read(sb)
        lst = val[modulo]

        if action == "delete":
            rid = body.get("id")
            val[modulo] = [r for r in lst if r.get("id") != rid]
            try: _write(sb, val)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "cs.reg_delete", target_type="shared_kv", target_id=modulo, notes=str(rid))
            return self._send(200, {"ok": True, "deleted": rid})

        rec = _clean(body.get("registro") if isinstance(body.get("registro"), dict) else {})
        if not any(str(v).strip() for v in rec.values()):
            return self._send(400, {"ok": False, "error": "ficha vazia"})
        rid = (body.get("registro") or {}).get("id")
        if rid:
            found = False
            for i, r in enumerate(lst):
                if r.get("id") == rid:
                    rec.update({"id": rid, "created_at": r.get("created_at") or _now(), "updated_at": _now()})
                    lst[i] = rec; found = True; break
            if not found:
                rid = None
        if not rid:
            if len(lst) >= MAX_ROWS:
                return self._send(400, {"ok": False, "error": "limite atingido"})
            rid = "cs_" + uuid.uuid4().hex[:12]
            rec.update({"id": rid, "created_at": _now(), "updated_at": _now()})
            lst.append(rec)
        val[modulo] = lst
        try: _write(sb, val)
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "cs.reg_upsert", target_type="shared_kv", target_id=modulo)
        return self._send(200, {"ok": True, "id": rid, "registro": rec})
