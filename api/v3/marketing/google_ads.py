"""
GET /api/v3/marketing/google_ads?date_preset=last_30d[&since=&until=][&nocache=1]
Header: Authorization: Bearer <token>   (Líder lvl>=5)

Conector Google Ads — gasto/leads por campanha, pra fechar a atribuição do canal
'google' (ROAS Google = VGV ganho via Google ÷ gasto Google).

IMPORTANTE — sem stub falso: este endpoint só retorna dados se as credenciais
estiverem nas env do Vercel. Sem elas, responde {ok:false, configured:false,
missing:[...]} de forma honesta (HTTP 200), explicando o que falta. O código de
chamada à API é REAL (OAuth refresh + GAQL via REST v17) e funciona assim que
Paulo configurar as credenciais — não posso criar conta/segredos por ele.

Env necessárias (todas):
  GOOGLE_ADS_DEVELOPER_TOKEN
  GOOGLE_ADS_CLIENT_ID
  GOOGLE_ADS_CLIENT_SECRET
  GOOGLE_ADS_REFRESH_TOKEN
  GOOGLE_ADS_CUSTOMER_ID          (só dígitos, sem traços)
  GOOGLE_ADS_LOGIN_CUSTOMER_ID    (opcional — MCC, se a conta estiver sob gerente)

Resp (configurado): { ok, configured:true, period, spend, impressions, clicks,
                      conversions, campaigns:[{id,name,spend,clicks,conversions}], cache }
Resp (não config.):  { ok:false, configured:false, missing:[...], help }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _meta_cache_lib import build_cache_key, read_cache, write_cache  # type: ignore

OAUTH_URL = "https://oauth2.googleapis.com/token"
ADS_API = "https://googleads.googleapis.com/v17"
CACHE_MAX_AGE_S = 15 * 60

REQUIRED_ENV = [
    "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID",
]

_PRESET_GAQL = {
    "today": "TODAY", "yesterday": "YESTERDAY", "last_7d": "LAST_7_DAYS",
    "last_14d": "LAST_14_DAYS", "last_30d": "LAST_30_DAYS",
    "this_month": "THIS_MONTH", "last_month": "LAST_MONTH",
}


def _missing_env():
    return [k for k in REQUIRED_ENV if not os.environ.get(k)]


def _date_clause(preset, since, until):
    if since and until:
        # GAQL aceita BETWEEN com datas YYYY-MM-DD
        return "segments.date BETWEEN '%s' AND '%s'" % (since, until)
    return "segments.date DURING %s" % _PRESET_GAQL.get(preset or "last_30d", "LAST_30_DAYS")


def _oauth_access_token(timeout=20):
    data = urllib.parse.urlencode({
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode("utf-8")
    req = urllib.request.Request(OAUTH_URL, data=data, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        tok = json.loads(resp.read().decode("utf-8"))
    at = tok.get("access_token")
    if not at:
        raise RuntimeError("OAuth: sem access_token (refresh_token inválido?)")
    return at


def _gaql(query, timeout=30):
    cid = "".join(ch for ch in os.environ["GOOGLE_ADS_CUSTOMER_ID"] if ch.isdigit())
    access = _oauth_access_token()
    headers = {
        "Authorization": "Bearer " + access,
        "developer-token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "Content-Type": "application/json",
    }
    login_cid = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID")
    if login_cid:
        headers["login-customer-id"] = "".join(ch for ch in login_cid if ch.isdigit())
    url = ADS_API + "/customers/" + cid + "/googleAds:searchStream"
    body = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


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
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        missing = _missing_env()
        if missing:
            return self._send(200, {
                "ok": False,
                "configured": False,
                "missing": missing,
                "help": ("Configure as env vars do Google Ads no Vercel para ativar. "
                         "Precisa de: developer token (API Center), OAuth client (id+secret), "
                         "refresh token (fluxo OAuth) e customer id da conta."),
            })

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        preset = params.get("date_preset") or ("" if (params.get("since") and params.get("until")) else "last_30d")
        since = params.get("since") or ""
        until = params.get("until") or ""
        nocache = bool(params.get("nocache"))
        key = "google:" + build_cache_key(preset, since, until)

        sb = supabase_client()
        if sb and not nocache:
            cached, age_s, csource = read_cache(sb, key, CACHE_MAX_AGE_S)
            if cached:
                cached["cache"] = {"hit": True, "age_s": age_s, "source": csource, "shared": True}
                return self._send(200, cached)

        query = (
            "SELECT campaign.id, campaign.name, metrics.cost_micros, "
            "metrics.impressions, metrics.clicks, metrics.conversions "
            "FROM campaign WHERE " + _date_clause(preset, since, until)
        )
        try:
            chunks = _gaql(query)
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8")[:400]
            except Exception:
                detail = str(e)
            return self._send(502, {"ok": False, "configured": True,
                                    "error": "Google Ads HTTP %s" % e.code, "detail": detail})
        except Exception as e:
            return self._send(502, {"ok": False, "configured": True, "error": str(e)})

        camp = {}
        tot = {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0}
        for chunk in (chunks if isinstance(chunks, list) else [chunks]):
            for row in (chunk.get("results") or []):
                c = row.get("campaign") or {}
                m = row.get("metrics") or {}
                cid = str(c.get("id") or "")
                spend = float(m.get("costMicros") or 0) / 1e6
                clicks = int(m.get("clicks") or 0)
                impr = int(m.get("impressions") or 0)
                conv = float(m.get("conversions") or 0)
                e = camp.setdefault(cid, {"id": cid, "name": c.get("name") or cid,
                                          "spend": 0.0, "clicks": 0, "impressions": 0, "conversions": 0.0})
                e["spend"] += spend
                e["clicks"] += clicks
                e["impressions"] += impr
                e["conversions"] += conv
                tot["spend"] += spend
                tot["clicks"] += clicks
                tot["impressions"] += impr
                tot["conversions"] += conv

        campaigns = sorted(
            [{"id": v["id"], "name": v["name"], "spend": round(v["spend"], 2),
              "clicks": v["clicks"], "impressions": v["impressions"],
              "conversions": round(v["conversions"], 2)} for v in camp.values()],
            key=lambda x: -x["spend"]
        )
        payload = {
            "ok": True,
            "configured": True,
            "period": {"date_preset": preset, "since": since, "until": until},
            "spend": round(tot["spend"], 2),
            "impressions": tot["impressions"],
            "clicks": tot["clicks"],
            "conversions": round(tot["conversions"], 2),
            "campaigns": campaigns,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
        if sb:
            write_cache(sb, key, preset, since, until, payload, source="live")
        payload["cache"] = {"hit": False, "source": "live"}
        return self._send(200, payload)
