"""GET /api/v3/locacoes/list[?status=&responsavel_id=]"""
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
            q = sb.table("locacoes").select("*").order("data_fim_contrato").limit(500)
            if params.get("status"):         q = q.eq("status", params["status"])
            if params.get("responsavel_id"): q = q.eq("responsavel_id", params["responsavel_id"])
            rows = q.execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Calcula KPIs
        from datetime import date, timedelta
        today = date.today()
        in30 = today + timedelta(days=30)
        kpis = {
            "total":        len(rows),
            "disponiveis":  sum(1 for r in rows if (r.get("status") or "") == "disponivel"),
            "ocupadas":     sum(1 for r in rows if (r.get("status") or "") == "ocupado"),
            "em_atraso":    sum(1 for r in rows if (r.get("status") or "") == "em_atraso"),
            "vence_30d":    sum(1 for r in rows if r.get("data_fim_contrato") and r["data_fim_contrato"] <= in30.isoformat() and r["data_fim_contrato"] >= today.isoformat()),
            "receita_potencial": sum(float(r.get("valor_aluguel") or 0) for r in rows if (r.get("status") or "") == "ocupado"),
        }
        return self._send(200, {"ok": True, "count": len(rows), "locacoes": rows, "kpis": kpis})
