"""GET /api/v3/imoveis/list[?status=&captador_id=&origem=]"""
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
            q = sb.table("imoveis").select("*").order("valor", desc=True).limit(500)
            if params.get("status"):       q = q.eq("status", params["status"])
            if params.get("captador_id"):  q = q.eq("captador_id", params["captador_id"])
            if params.get("origem"):       q = q.eq("origem", params["origem"])
            rows = q.execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        kpis = {
            "total": len(rows),
            "disponiveis": sum(1 for r in rows if (r.get("status") or "") == "disponivel"),
            "valor_total": sum(float(r.get("valor") or 0) for r in rows if (r.get("status") or "") == "disponivel"),
            "proprios": sum(1 for r in rows if (r.get("origem") or "") == "proprio"),
            "terceiros": sum(1 for r in rows if (r.get("origem") or "") == "terceiros"),
        }
        return self._send(200, {"ok": True, "count": len(rows), "imoveis": rows, "kpis": kpis})
