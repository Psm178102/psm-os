"""GET /api/v3/concorrentes/list"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()
    def do_GET(self):
        try: user = require_user(self, min_lvl=3)  # Marketing (lvl3) ou acima — inteligência de concorrência
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("concorrentes").select("*").order("anuncios_count", desc=True).limit(200).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "count": len(rows), "concorrentes": rows})
