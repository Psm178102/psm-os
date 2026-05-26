"""GET /api/v3/checkin/list[?user_id=&since=&limit=]"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone, date, timedelta

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
        target_uid = params.get("user_id") or user["id"]
        # Não-sócio só vê os próprios
        if target_uid != user["id"] and (user.get("lvl") or 0) < 7:
            return self._send(403, {"ok": False, "error": "scope inválido"})
        since = params.get("since") or (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        try:
            rows = sb.table("check_ins").select("*").eq("user_id", target_uid).gte("ts", since).order("ts", desc=True).limit(200).execute().data or []
            # Hoje: status
            today_start = date.today().isoformat() + "T00:00:00+00:00"
            today_rows = [r for r in rows if r["ts"] >= today_start]
            today_in_count  = sum(1 for r in today_rows if r["tipo"] == "in")
            today_out_count = sum(1 for r in today_rows if r["tipo"] == "out")
            status = "fora" if today_in_count <= today_out_count else "dentro"
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "user_id": target_uid, "status": status, "today": {"ins": today_in_count, "outs": today_out_count}, "history": rows})
