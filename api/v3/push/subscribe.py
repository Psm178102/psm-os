"""
GET/POST/DELETE /api/v3/push/subscribe — inscrições de Web Push.

GET            -> { ok, public_key }   (VAPID public key p/ o navegador)
POST  (auth)   body { endpoint, keys:{p256dh, auth} } -> salva inscrição do usuário
DELETE (auth)  ?endpoint=... OU body { endpoint } -> remove a inscrição
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        # público: o browser precisa da public key pra se inscrever
        return self._send(200, {"ok": True, "public_key": os.environ.get("VAPID_PUBLIC_KEY") or "",
                                "configured": bool(os.environ.get("VAPID_PRIVATE_KEY"))})

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return {}

    def do_POST(self):
        try: actor = require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        body = self._body()
        endpoint = body.get("endpoint")
        keys = body.get("keys") or {}
        if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
            return self._send(400, {"ok": False, "error": "endpoint e keys (p256dh, auth) obrigatórios"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        row = {
            "user_id": actor.get("id"),
            "endpoint": endpoint,
            "p256dh": keys.get("p256dh"),
            "auth": keys.get("auth"),
            "ua": (self.headers.get("User-Agent") or "")[:300],
        }
        try:
            sb.table("push_subscriptions").upsert(row, on_conflict="endpoint").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "push.subscribe", target_type="push_subscriptions", target_id=endpoint[:60])
        return self._send(200, {"ok": True})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        endpoint = params.get("endpoint") or self._body().get("endpoint")
        if not endpoint: return self._send(400, {"ok": False, "error": "endpoint obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("push_subscriptions").delete().eq("endpoint", endpoint).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True})
