"""
GET /api/v3/zoho/connect — inicia o OAuth do Zoho pro usuário logado.
Devolve { url } com a página de consentimento do Zoho. O front redireciona.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore
import _zoho_lib as z  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        if not z.configured():
            return self._send(503, {"ok": False, "error": "Zoho ainda não configurado (faltam ZOHO_CLIENT_ID/SECRET no Vercel)"})
        return self._send(200, {"ok": True, "url": z.authorize_url(user.get("id"))})
