"""GET/POST /api/v3/gp/cargos — templates POR CARGO. v81.92

Config por cargo usada em 2 lugares:
- RECRUTAMENTO (R&S): requisitos + impeditivos de contratação por cargo → aparecem
  como referência na ficha do candidato.
- OFFBOARDING (desligamento): requisitos, métricas e checklist de checkout por cargo
  → aparecem no processo de desligamento.

shared_kv:
  'recrutamento_cargos' = { <cargo>: { requisitos, impeditivos } }
  'offboarding_cargos'  = { <cargo>: { requisitos, metricas, checklist:[str] } }

GET  (lvl>=2): { ok, recrutamento, offboarding }.
POST (lvl>=5):
  - action 'set_recrutamento' { cargo, requisitos, impeditivos }
  - action 'set_offboarding'  { cargo, requisitos, metricas, checklist:[str] }
  - action 'del'              { kind:'recrutamento'|'offboarding', cargo }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

K_REC = "recrutamento_cargos"
K_OFF = "offboarding_cargos"
NOW = lambda: datetime.now(timezone.utc).isoformat()


def _read(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


def _write(sb, key, val):
    sb.table("shared_kv").upsert({"key": key, "value": val, "updated_at": NOW()}, on_conflict="key").execute()


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
        return self._send(200, {"ok": True, "recrutamento": _read(sb, K_REC), "offboarding": _read(sb, K_OFF)})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        action = (body.get("action") or "").strip()
        cargo = (body.get("cargo") or "").strip()[:80]

        def _s(k, n=4000):
            return (body.get(k) or "").strip()[:n]

        if action == "set_recrutamento":
            if not cargo: return self._send(400, {"ok": False, "error": "cargo obrigatório"})
            cur = _read(sb, K_REC)
            cur[cargo] = {"requisitos": _s("requisitos"), "impeditivos": _s("impeditivos")}
            try: _write(sb, K_REC, cur)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "cargos.set_recrutamento", target_type="shared_kv", target_id=cargo)
            return self._send(200, {"ok": True, "recrutamento": cur})

        if action == "set_offboarding":
            if not cargo: return self._send(400, {"ok": False, "error": "cargo obrigatório"})
            checklist = body.get("checklist")
            if not isinstance(checklist, list):
                checklist = []
            checklist = [str(x).strip()[:300] for x in checklist if str(x).strip()][:60]
            cur = _read(sb, K_OFF)
            cur[cargo] = {"requisitos": _s("requisitos"), "metricas": _s("metricas"), "checklist": checklist}
            try: _write(sb, K_OFF, cur)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "cargos.set_offboarding", target_type="shared_kv", target_id=cargo)
            return self._send(200, {"ok": True, "offboarding": cur})

        if action == "del":
            kind = (body.get("kind") or "").strip()
            key = K_REC if kind == "recrutamento" else K_OFF if kind == "offboarding" else None
            if not key or not cargo: return self._send(400, {"ok": False, "error": "kind+cargo"})
            cur = _read(sb, key); cur.pop(cargo, None)
            try: _write(sb, key, cur)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            return self._send(200, {"ok": True})

        return self._send(400, {"ok": False, "error": "action inválida"})
