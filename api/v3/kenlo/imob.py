"""
GET /api/v3/kenlo/imob — CONECTOR KENLO OPEN API v2 (Kenlo Imob). v84.10

Chave criada em 03/07/2026 via Marketplace do Kenlo Imob → "Ativar Kenlo Open"
(self-service, sem custo, revogável na mesma tela). Escopo concedido: SOMENTE
LEITURA de Dados dos imóveis (endereço, fotos sem marca d'água, histórico,
matrícula, valores). Sem ações de escrita, sem dados de clientes.

Upstream: https://imob-api.kenlo-open.com (GCP API Gateway)
Auth upstream: headers x-api-key (KENLO_OPEN_API_KEY) +
               x-user-info (KENLO_OPEN_USER_INFO, base64 gerado pelo Marketplace).
Só funciona server-side (o gateway bloqueia CORS) — por isso este proxy.

Query:
  rota=health            → GET /v2/health (sem auth; smoke test)
  rota=properties        → GET /v2/properties?scope=&page=&pageSize=&sort=&order=  (registro CRM)
  rota=property&id=      → GET /v2/properties/{id}
  rota=listings          → GET /v2/listings?page=&pageSize=                        (anúncio publicado)
  rota=listing&id=       → GET /v2/listings/{id}
  rota=media&id=         → GET /v2/properties/{id}/media

Auth local: JWT lvl>=2. Resposta: { ok, rota, status, data } (data = corpo upstream).
Espelho do padrão NIBO/D360: gateado em env — sem as envs devolve 503 com instrução.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore

BASE = os.environ.get("KENLO_OPEN_BASE", "https://imob-api.kenlo-open.com").rstrip("/")
ROTAS = {
    "health": "/v2/health",
    "properties": "/v2/properties",
    "property": "/v2/properties/{id}",
    "listings": "/v2/listings",
    "listing": "/v2/listings/{id}",
    "media": "/v2/properties/{id}/media",
}
# params de query que repassamos pro upstream (whitelist)
PASS = ("scope", "page", "pageSize", "sort", "order", "q")


def _upstream(path, qs, need_auth=True):
    key = os.environ.get("KENLO_OPEN_API_KEY", "").strip()
    uinfo = os.environ.get("KENLO_OPEN_USER_INFO", "").strip()
    if need_auth and (not key or not uinfo):
        return 503, {"erro": "KENLO_OPEN_API_KEY/KENLO_OPEN_USER_INFO ausentes no Vercel",
                     "como": "Kenlo Imob → menu do perfil → Marketplace → Kenlo Open → Copiar os 2 códigos"}
    url = BASE + path
    if qs:
        url += "?" + urllib.parse.urlencode(qs)
    headers = {"Accept": "application/json", "User-Agent": "PSM-OS/kenlo"}
    if need_auth:
        headers["x-api-key"] = key
        headers["x-user-info"] = uinfo
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"erro": str(e)[:200]}
        return e.code, body
    except Exception as e:
        return 502, {"erro": str(e)[:200]}


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
            require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        rota = (q.get("rota") or "health").lower()
        if rota not in ROTAS:
            return self._send(400, {"ok": False, "error": f"rota inválida (use {', '.join(ROTAS)})"})
        path = ROTAS[rota]
        if "{id}" in path:
            pid = (q.get("id") or "").strip()
            if not pid:
                return self._send(400, {"ok": False, "error": "id obrigatório"})
            path = path.replace("{id}", urllib.parse.quote(pid, safe=""))
        qs = {k: q[k] for k in PASS if q.get(k)}
        if rota == "properties" and "scope" not in qs:
            qs["scope"] = "all"  # exigido pela fonte do CRM; 'all' percorre o catálogo
        try:
            qs["pageSize"] = str(max(1, min(100, int(qs.get("pageSize") or 50))))
        except Exception:
            qs["pageSize"] = "50"
        if rota == "health":
            status, data = _upstream(path, {}, need_auth=False)
        else:
            status, data = _upstream(path, qs)
        return self._send(200 if status < 500 else 502,
                          {"ok": 200 <= status < 300, "rota": rota, "status": status, "data": data})
