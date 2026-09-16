"""
GET /api/v3/metricas/projecao?h=semana|quinzena|mes|trimestre|semestre|ano[&since=&until=][&fresh=1]
Header: Authorization: Bearer <token>   (qualquer logado; recorte pela alçada)

META · REALIZADO · PROJEÇÃO por empresa, equipe e corretor, no horizonte escolhido.
Modelo em api/v3/_projecao_lib.py (Dicionário de Métricas §8, revisão 16/09/2026). v87.91
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
if _V3 not in sys.path:
    sys.path.append(_V3)
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _projecao_lib import projecao, filtrar  # type: ignore


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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        fresh = params.get("fresh") == "1" and (user.get("lvl") or 0) >= 5
        try:
            data = projecao(sb, params, fresh=fresh)
        except Exception as e:
            body = {"ok": False, "error": f"projeção: {str(e)[:200]}"}
            if (user.get("lvl") or 0) >= 10:
                import traceback
                body["trace"] = traceback.format_exc()[-1500:]
            return self._send(500, body)
        return self._send(200, filtrar(data, user))
