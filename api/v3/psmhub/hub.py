"""
GET /api/v3/psmhub/hub?month=&year= — PONTE com o PSM HUB (sistema da Equipe Conquista). v77.73

O House PSM loga no psmhub.com.br com um usuário de serviço (credenciais em ENV,
NUNCA no código) e devolve os KPIs/metas/times/agentes daquele sistema, pra cruzar
e auditar com os números do RD/House PSM.

Auth psmhub: POST {BASE}/api/auth/login {email,password} → {token,user}; depois
Bearer token nos GET /api/*. O token é cacheado em memória (re-loga em 401/expiração).

ENV (setar no Vercel): PSMHUB_EMAIL, PSMHUB_PASSWORD  (opcional PSMHUB_BASE).
lvl>=7 (diretoria) — é auditoria de gestão.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore
from _psmhub_lib import get as _get, configured  # type: ignore  # login/_get compartilhados


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
            require_user(self, min_lvl=7)   # auditoria de diretoria
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
        mq = f"month={urllib.parse.quote(month)}&year={urllib.parse.quote(year)}"

        # cada fonte best-effort: uma falha não derruba o resto
        out, errs = {}, {}
        plan = {
            "kpis":          f"/api/dashboard/kpis?period=mensal&{mq}",
            "esteira":       f"/api/dashboard/esteira?period=mensal&{mq}",
            "metas_config":  f"/api/metas/config?{mq}",
            "metas_metrics": f"/api/metas/metrics?{mq}",
            "lead_sources":  f"/api/metas/lead-sources?{mq}",
            "funnel_ratios": "/api/metas/funnel-ratios",
            "teams":         "/api/teams",
            "agents":        "/api/agents",
        }
        for key, path in plan.items():
            try:
                out[key] = _get(path)
            except Exception as e:
                errs[key] = str(e)[:160]
                out[key] = None

        return self._send(200, {"ok": True, "month": int(month), "year": int(year),
                                "data": out, "errors": errs or None,
                                "source": "psmhub.com.br", "fetched_at": now.isoformat()})
