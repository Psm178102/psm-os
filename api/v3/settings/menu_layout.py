"""
GET/POST /api/v3/settings/menu_layout — Estrutura editável do menu (sócio). v81.48

Complementa o menu_labels (que renomeia). Aqui guardamos a ORGANIZAÇÃO: em qual
seção cada item fica e a ordem de itens/seções. Vale pra TODOS (shared_kv key
'menu_layout'). NÃO mexe em permissão — quem vê o item segue na matriz por papel.

Estrutura:
  {
    "secOrder": ["🏠 Início", "🔑 Locação", ...],   # ordem das seções (id = rótulo padrão)
    "items": { "/reunioes": {"sec":"🔑 Locação", "ord": 3}, ... }  # item → seção alvo + ordem
  }
Item/seção ausente = posição padrão do menu estático.

GET  (qualquer autenticado): {ok, layout}.
POST (lvl>=10 sócio): substitui o layout inteiro. Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "menu_layout"
MAX_ITEMS = 400
MAX_SECS = 60
MAX_KEY = 80
MAX_SEC = 80


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
    val.setdefault("secOrder", [])
    val.setdefault("items", {})
    if not isinstance(val["secOrder"], list):
        val["secOrder"] = []
    if not isinstance(val["items"], dict):
        val["items"] = {}
    return val


def _clean(raw):
    raw = raw or {}
    sec_order = []
    seen = set()
    for s in (raw.get("secOrder") or [])[:MAX_SECS]:
        if isinstance(s, str):
            s = s.strip()[:MAX_SEC]
            if s and s not in seen:
                seen.add(s); sec_order.append(s)
    items = {}
    src = raw.get("items") if isinstance(raw.get("items"), dict) else {}
    for route, cfg in list(src.items())[:MAX_ITEMS]:
        if not isinstance(route, str) or not isinstance(cfg, dict):
            continue
        route = route.strip()[:MAX_KEY]
        if not route:
            continue
        entry = {}
        sec = cfg.get("sec")
        if isinstance(sec, str) and sec.strip():
            entry["sec"] = sec.strip()[:MAX_SEC]
        ordv = cfg.get("ord")
        try:
            if ordv is not None:
                entry["ord"] = int(ordv)
        except Exception:
            pass
        if entry:
            items[route] = entry
    return {"secOrder": sec_order, "items": items}


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
        return self._send(200, {"ok": True, "layout": _read(sb)})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=10)  # só sócio organiza o menu
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        layout = _clean(body.get("layout") if isinstance(body.get("layout"), dict) else body)
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": layout,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "menu_layout.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "layout": layout})
