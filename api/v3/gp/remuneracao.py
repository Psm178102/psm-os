"""GET/POST /api/v3/gp/remuneracao — remuneração por usuário. v81.96

Sensível: só GESTÃO. shared_kv 'remuneracao' = { uid: {tipo, salario_base,
comissao_pct, ajuda_custo, obs} }. Cruzado na visão 360° do One-on-One.

GET  (lvl>=5): ?user_id=X → {ok, remuneracao:{...}}; sem user_id → {ok, all:{...}}.
POST (lvl>=7): { user_id, tipo, salario_base, comissao_pct, ajuda_custo, obs }.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV = "remuneracao"
TIPOS = {"CLT", "PJ", "Comissionado", "CLT + comissão", "Estágio", "Autônomo", "Sócio"}


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


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
        try: require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        import urllib.parse
        try: qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        except Exception: qs = {}
        uid = (qs.get("user_id", [""])[0] or "").strip()
        val = _read(sb)
        if uid:
            return self._send(200, {"ok": True, "remuneracao": val.get(uid, {})})
        return self._send(200, {"ok": True, "all": val})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        uid = (body.get("user_id") or "").strip()
        if not uid: return self._send(400, {"ok": False, "error": "user_id obrigatório"})
        val = _read(sb)
        def _n(k):
            try: return round(float(body.get(k)), 2)
            except Exception: return None
        tipo = (body.get("tipo") or "").strip()[:30]
        val[uid] = {
            "tipo": tipo if tipo in TIPOS else (tipo or None),
            "salario_base": _n("salario_base"),
            "comissao_pct": _n("comissao_pct"),
            "ajuda_custo": _n("ajuda_custo"),
            "obs": (body.get("obs") or "").strip()[:1500] or None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": actor.get("name"),
        }
        try:
            sb.table("shared_kv").upsert({"key": KV, "value": val,
                                          "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "remuneracao.set", target_type="shared_kv", target_id=uid)
        return self._send(200, {"ok": True, "remuneracao": val[uid]})
