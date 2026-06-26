"""
GET/POST /api/v3/settings/links — Links configuráveis (Google Drive/Earth) por gestão.
Guarda tudo em shared_kv key 'psm_links'. Usado por Mapa, Tabela de Imóveis e Cadência.

GET  (qualquer autenticado): retorna os links salvos (+ defaults).
POST (lvl>=5): faz merge do patch enviado e salva. Audita.

Estrutura:
{
  "mapa_earth": "<google earth url>",
  "tabela_conquista": "<drive url>",
  "tabela_map": "<drive url>",
  "cadencia": {"map": "...", "conquista": "...", "terceiros": "...", "locacao": "..."}
}
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "psm_links"
DEFAULTS = {
    "mapa_earth": "https://earth.google.com/earth/d/15bCIxsaicJySE2OT0yS8dZO7KqcwyJ8o?usp=sharing",
    "mapa_mymaps": "",
    "google_maps_key": "",   # chave JS da Google Maps Platform (restrita por referrer); Mapa em satélite + pins do My Maps. v81.70
    "tabela_conquista": "",
    "tabela_map": "",
    "ficha_modelo": "",
    "cadencia": {"map": "", "conquista": "", "terceiros": "", "locacao": ""},
}


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    out = dict(DEFAULTS)
    out.update(val or {})
    # garante sub-objeto cadencia completo
    cad = dict(DEFAULTS["cadencia"]); cad.update(out.get("cadencia") or {})
    out["cadencia"] = cad
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
        try: require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, {"ok": True, "links": _read(sb)})

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

        cur = _read(sb)
        patch = body.get("links") if isinstance(body.get("links"), dict) else body
        for k, v in (patch or {}).items():
            if k == "cadencia" and isinstance(v, dict):
                cur["cadencia"].update(v)
            elif k in DEFAULTS:
                cur[k] = v
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": cur,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "links.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "links": cur})
