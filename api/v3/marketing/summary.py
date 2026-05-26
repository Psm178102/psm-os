"""
GET /api/v3/marketing/summary[?date_preset=last_30d|since=YYYY-MM-DD&until=YYYY-MM-DD]
Header: Authorization: Bearer <token>

Wrapper autenticado pro /api/meta-ads (já em prod). Requer Líder (lvl>=5).
Cache do meta-ads (5min) já cuida do rate-limit.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}

        # Build URL pro /api/meta-ads (rota interna do Vercel)
        # Vercel deploys têm o host como ${VERCEL_URL} ou usa headers
        host = self.headers.get("Host") or "www.housepsm.com.br"
        scheme = "https"
        qs_parts = []
        if params.get("date_preset"):
            qs_parts.append("date_preset=" + urllib.parse.quote(params["date_preset"]))
        if params.get("since") and params.get("until"):
            qs_parts.append("since=" + urllib.parse.quote(params["since"]))
            qs_parts.append("until=" + urllib.parse.quote(params["until"]))
        if params.get("nocache"):
            qs_parts.append("nocache=1")
        qs = "&".join(qs_parts) if qs_parts else "date_preset=last_30d"
        meta_url = f"{scheme}://{host}/api/meta-ads?{qs}"

        try:
            req = urllib.request.Request(meta_url, headers={
                "Accept": "application/json",
                "User-Agent": "PSM-OS-v3/marketing",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return self._send(502, {"ok": False, "error": f"Meta API HTTP {e.code}"})
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"meta-ads err: {e}"})

        # Adiciona scope info pra UI
        data["v3_scope"] = "team" if (user.get("lvl") or 0) >= 5 else "self"
        data["v3_user_lvl"] = user.get("lvl")
        return self._send(200, data)
