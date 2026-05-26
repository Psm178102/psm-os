"""POST /api/v3/checkin/toggle — alterna automaticamente in/out baseado no último registro do dia"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone, date

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
        try: user = require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: body = {}
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        today_start = date.today().isoformat() + "T00:00:00+00:00"
        try:
            last = sb.table("check_ins").select("tipo,ts").eq("user_id", user["id"]).gte("ts", today_start).order("ts", desc=True).limit(1).execute().data or []
            next_tipo = "out" if (last and last[0]["tipo"] == "in") else "in"
            ip = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or self.headers.get("X-Real-IP") or ""
            row = {"user_id": user["id"], "tipo": next_tipo, "ip": ip[:64] or None, "observacao": body.get("observacao") or None}
            res = sb.table("check_ins").insert(row).execute()
            inserted = (res.data or [row])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, user, "checkin." + next_tipo, target_type="checkin", target_id=str(inserted.get("id")))
        return self._send(200, {"ok": True, "tipo": next_tipo, "ts": inserted.get("ts"), "id": inserted.get("id")})
