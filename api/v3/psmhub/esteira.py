"""
GET /api/v3/psmhub/esteira?month=&year= — ESTEIRA DE PRODUTIVIDADE do PSM HUB pra TV. v87.73

Ponte de leitura com o psmhub.com.br (mesmo login de serviço do ranking.py) que
devolve o /api/dashboard/esteira do HUB — por corretor: prospeccao, qualificacao,
agendamento, atendimento, pasta, vendaCount, vendaTotal (+ totals) — pras telas
de Pastas, Visitas, Prospecção e Placar do mês da Arena TV. Decisão do Paulo
(10/set): essas telas saem da esteira; ranking geral e duelo seguem no ranking
do HUB (/api/v3/psmhub/ranking).

lvl>=0 (qualquer logado): é o placar que fica na TV da sala.
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
        if not (month.isdigit() and year.isdigit()):
            return self._send(400, {"ok": False, "error": "month/year inválidos"})

        try:
            est = _get(f"/api/dashboard/esteira?period=mensal&month={month}&year={year}")
        except Exception as e:
            return self._send(200, {"ok": False, "error": f"esteira do psmhub indisponível: {str(e)[:160]}"})

        # contrato da tela do próprio HUB: {rows: [...], totals: {...}}
        # (comercial.py também aceita lista crua — mesma tolerância aqui)
        rows = est if isinstance(est, list) else ((est or {}).get("rows") or [])
        totals = (est or {}).get("totals") if isinstance(est, dict) else None
        return self._send(200, {"ok": True,
                                "data": {"rows": [r for r in rows if isinstance(r, dict)], "totals": totals or {}},
                                "month": int(month), "year": int(year),
                                "source": "psmhub.com.br/api/dashboard/esteira", "fetched_at": now.isoformat()})
