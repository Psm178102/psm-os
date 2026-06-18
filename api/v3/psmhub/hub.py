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
import json, os, sys, time, urllib.parse, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore

BASE = (os.environ.get("PSMHUB_BASE") or "https://psmhub.com.br").rstrip("/")
_tok = {"value": None, "at": 0}        # cache de token em memória (instância quente)
TTL = 45 * 60                          # re-loga a cada 45min por segurança


def _login():
    email = os.environ.get("PSMHUB_EMAIL")
    pw = os.environ.get("PSMHUB_PASSWORD")
    if not email or not pw:
        raise RuntimeError("PSMHUB_EMAIL/PSMHUB_PASSWORD não configurados no Vercel")
    body = json.dumps({"email": email, "password": pw}).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/api/auth/login", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json",
                                          "User-Agent": "PSM-OS/psmhub-bridge"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    tok = data.get("token") or data.get("access_token") or data.get("accessToken") or data.get("jwt")
    if not tok:
        raise RuntimeError("login psmhub não retornou token")
    _tok["value"] = tok; _tok["at"] = time.time()
    return tok


def _token(force=False):
    if force or not _tok["value"] or (time.time() - _tok["at"]) > TTL:
        return _login()
    return _tok["value"]


def _get(path, retry=True):
    tok = _token()
    req = urllib.request.Request(f"{BASE}{path}",
                                 headers={"Authorization": f"Bearer {tok}", "Accept": "application/json",
                                          "User-Agent": "PSM-OS/psmhub-bridge"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) and retry:      # token velho → re-loga uma vez
            _token(force=True)
            return _get(path, retry=False)
        raise


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

        if not os.environ.get("PSMHUB_EMAIL") or not os.environ.get("PSMHUB_PASSWORD"):
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
