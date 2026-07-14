"""
GET  /api/v3/zoho/status  — o usuário logado está conectado ao Zoho?
POST /api/v3/zoho/status  { action: "disconnect" } — desconecta (apaga a conexão).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
import _zoho_lib as z  # type: ignore


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
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        conn = z.get_conn(sb, user.get("id"))
        return self._send(200, {"ok": True, "configurado": z.configured(),
                                "conectado": bool(conn),
                                "zoho_email": (conn or {}).get("zoho_email"),
                                "last_sync_at": (conn or {}).get("last_sync_at"),
                                "last_sync_res": (conn or {}).get("last_sync_res")})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length else "{}")
        except Exception:
            body = {}
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if (body.get("action") or "") == "disconnect":
            try:
                sb.table("zoho_conexoes").delete().eq("user_id", str(user.get("id"))).execute()
                audit(self, user, "zoho.disconnect", target_type="zoho_conexoes", target_id=str(user.get("id")))
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:160]})
            return self._send(200, {"ok": True, "conectado": False})
        return self._send(400, {"ok": False, "error": "action inválida"})
