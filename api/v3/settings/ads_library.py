"""
GET/POST /api/v3/settings/ads_library — links das Bibliotecas de Anúncios do Meta
(Facebook/Instagram Ad Library) por CONTA/categoria. v81.81

Permite VÁRIOS links por categoria (uma conta pode ter mais de uma página/biblioteca).
Categorias fixas: conquista, map, locacao, terceiros.

shared_kv key 'ads_library' = {
  "conquista": [ {id, titulo, url}, ... ],
  "map":       [ ... ], "locacao": [ ... ], "terceiros": [ ... ]
}

GET  (qualquer autenticado): { ok, ads_library }.
POST (lvl>=3 marketing/gestão):
  {action:'upsert', categoria, link:{id?, titulo, url}}  — cria/edita um link
  {action:'delete', categoria, id}                       — remove um link
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "ads_library"
CATS = ("conquista", "map", "locacao", "terceiros")
MAX_PER_CAT = 50


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
    for c in CATS:
        if not isinstance(val.get(c), list):
            val[c] = []
    return val


def _write(sb, val):
    sb.table("shared_kv").upsert(
        {"key": KV_KEY, "value": val, "updated_at": datetime.now(timezone.utc).isoformat()},
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
        return self._send(200, {"ok": True, "ads_library": _read(sb)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=3)   # marketing/gestão curam os links
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

        cat = (body.get("categoria") or "").strip().lower()
        if cat not in CATS:
            return self._send(400, {"ok": False, "error": "categoria inválida"})
        val = _read(sb)
        action = body.get("action") or "upsert"

        if action == "delete":
            lid = body.get("id")
            val[cat] = [x for x in val[cat] if x.get("id") != lid]
            try: _write(sb, val)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "ads_library.delete", target_type="shared_kv", target_id=cat + ":" + str(lid))
            return self._send(200, {"ok": True, "ads_library": val})

        link = body.get("link") if isinstance(body.get("link"), dict) else {}
        url = (link.get("url") or "").strip()
        titulo = (link.get("titulo") or "").strip()
        if not url:
            return self._send(400, {"ok": False, "error": "url obrigatória"})
        lid = link.get("id")
        item = {"id": lid or ("adl_" + uuid.uuid4().hex[:10]),
                "titulo": titulo[:160] or "Biblioteca de Anúncios",
                "url": url[:1000]}
        if lid:
            found = False
            for i, x in enumerate(val[cat]):
                if x.get("id") == lid:
                    val[cat][i] = item; found = True; break
            if not found:
                val[cat].append(item)
        else:
            if len(val[cat]) >= MAX_PER_CAT:
                return self._send(400, {"ok": False, "error": "limite de links na categoria"})
            val[cat].append(item)
        try: _write(sb, val)
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "ads_library.upsert", target_type="shared_kv", target_id=cat + ":" + item["id"])
        return self._send(200, {"ok": True, "ads_library": val})
