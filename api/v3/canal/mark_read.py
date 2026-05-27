"""POST /api/v3/canal/mark_read — marca mensagem(s) como lida (Sócio)

Body: { id?: number (uma) | ids?: number[] (várias) | all: bool }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()
    def do_POST(self):
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        patch = {"lido": True, "lido_por": actor.get("id"), "lido_em": datetime.now(timezone.utc).isoformat()}
        n = 0
        try:
            if body.get("all"):
                r = sb.table("canal_anonimo").update(patch).eq("lido", False).execute()
                n = len(r.data or [])
            elif body.get("ids"):
                ids = [int(x) for x in body["ids"] if x]
                r = sb.table("canal_anonimo").update(patch).in_("id", ids).execute()
                n = len(r.data or ids)
            elif body.get("id") is not None:
                r = sb.table("canal_anonimo").update(patch).eq("id", int(body["id"])).execute()
                n = len(r.data or [1])
            else:
                return self._send(400, {"ok": False, "error": "Forneça id, ids ou all"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "canal.mark_read", target_type="canal_anonimo",
              notes=f"marcadas={n}")
        return self._send(200, {"ok": True, "marked": n})
