"""GET /api/v3/oo/list[?corretor_id=]"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

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
        try: user = require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            q = sb.table("one_on_ones").select("*").order("data", desc=True).limit(500)
            if params.get("corretor_id"): q = q.eq("corretor_id", params["corretor_id"])
            rows = q.execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        # Filtra por role: não-Sócio só vê os próprios (como líder ou corretor)
        if (user.get("lvl") or 0) < 7:
            uid = user["id"]
            rows = [r for r in rows if r.get("lider_id") == uid or r.get("corretor_id") == uid]
        return self._send(200, {"ok": True, "count": len(rows), "items": rows})
