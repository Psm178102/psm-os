"""GET/POST /api/v3/diretoria/academy_config — Config da Escola PSM (Academy). v86.91

Guarda no shared_kv (key 'academy_config') as configurações da "escola do
corretor" dentro da Academy:
  {
    "radio": [ {"titulo","url","desc"} ... ],   # playlists Spotify/YouTube da Rádio PSM
    "notebooklm_url":  "https://notebooklm.google.com/notebook/…",
    "notebooklm_desc": "texto curto do card",
    "tutor_extra":     "base de conhecimento extra que o Professor PSM usa nas respostas"
  }

GET  (lvl>=2): qualquer logado lê (o corretor precisa ver a Rádio e o tutor)
POST (lvl>=7): gerência/diretoria edita (mesma alçada do Construtor da Academy)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "academy_config"
MAX_BYTES = 120_000


def _clean_config(v):
    """Sanitiza o payload: só os campos conhecidos, tipos certos, listas capadas."""
    if not isinstance(v, dict):
        return {}
    out = {}
    radio = []
    for it in (v.get("radio") or [])[:24]:
        if not isinstance(it, dict):
            continue
        url = str(it.get("url") or "").strip()
        if not url.startswith("http"):
            continue
        radio.append({
            "titulo": str(it.get("titulo") or "").strip()[:120] or "Playlist",
            "url": url[:500],
            "desc": str(it.get("desc") or "").strip()[:240],
        })
    out["radio"] = radio
    nb = str(v.get("notebooklm_url") or "").strip()
    out["notebooklm_url"] = nb[:500] if nb.startswith("http") else ""
    out["notebooklm_desc"] = str(v.get("notebooklm_desc") or "").strip()[:300]
    out["tutor_extra"] = str(v.get("tutor_extra") or "").strip()[:40_000]

    # v86.92: meta de estudo semanal (0 = desligada)
    def _int(x, d):
        try:
            return max(0, min(50, int(x)))
        except Exception:
            return d
    out["meta_aulas_semana"] = _int(v.get("meta_aulas_semana"), 2)
    out["meta_treinos_semana"] = _int(v.get("meta_treinos_semana"), 1)
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = (sb.table("shared_kv").select("value,updated_at")
                    .eq("key", KV_KEY).limit(1).execute().data or [])
            val = rows[0]["value"] if rows else {}
            if isinstance(val, str):
                val = json.loads(val)
            up = rows[0].get("updated_at") if rows else None
        except Exception:
            val, up = {}, None
        return self._send(200, {"ok": True, "config": _clean_config(val), "updated_at": up})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BYTES:
                return self._send(413, {"ok": False, "error": "payload grande demais"})
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cfg = _clean_config(body.get("config") or body)
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": cfg,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "academy.config", target_type="shared_kv", target_id=KV_KEY,
              notes=f"radio={len(cfg['radio'])} nb={'sim' if cfg['notebooklm_url'] else 'não'}")
        return self._send(200, {"ok": True, "config": cfg})
