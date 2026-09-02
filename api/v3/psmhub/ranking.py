"""
GET /api/v3/psmhub/ranking?month=&year=&mode= — RANKING do PSM HUB pra TV. v86.97

Ponte de leitura com o psmhub.com.br (mesmo login de serviço do hub.py) que devolve
o /api/ranking/detailed cru — pontos por corretor, breakdown por regra e totais do
time — pro Modo TV do House (Arena & Performance → Ranking HUB).

lvl>=0 (qualquer logado): é o placar motivacional que fica na TV da sala.
mode: monthly (default) | yearly.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore
from _psmhub_lib import get as _get, configured  # type: ignore


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
        try:
            require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        if not configured():
            return self._send(200, {"ok": False, "pending_config": True,
                                    "error": "Configure PSMHUB_EMAIL e PSMHUB_PASSWORD no Vercel pra ligar o PSM HUB."})

        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc) - timedelta(hours=3)
        month = q.get("month") or str(now.month)
        year = q.get("year") or str(now.year)
        mode = q.get("mode") if q.get("mode") in ("monthly", "yearly") else "monthly"

        try:
            data = _get(f"/api/ranking/detailed?mode={mode}&year={urllib.parse.quote(year)}&month={urllib.parse.quote(month)}")
        except Exception as e:
            return self._send(200, {"ok": False, "error": f"psmhub indisponível: {str(e)[:160]}"})

        return self._send(200, {"ok": True, "data": data, "source": "psmhub.com.br",
                                "fetched_at": now.isoformat()})
