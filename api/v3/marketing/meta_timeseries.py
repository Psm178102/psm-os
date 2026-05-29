"""
GET /api/v3/marketing/meta_timeseries?date_preset=last_30d[&since=&until=][&nocache=1]
Header: Authorization: Bearer <token>   (Líder lvl>=5)

Série DIÁRIA de Meta Ads (time_increment=1), agregada entre todas as contas, pra
alimentar os gráficos de tendência (gasto/dia, CPL/dia, resultados/dia). Endpoint
Python dedicado — não mexe no /api/meta-ads. Usa o cache compartilhado
(meta_ads_cache, chave 'ts:...') com TTL 30min.

Resp: { ok, period, series:[{date, spend, results, impressions, clicks, cpl, ctr}],
        totals, errors, cache }
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

GRAPH_API = "https://graph.facebook.com/v21.0"
CACHE_MAX_AGE_S = 30 * 60
_LEAD_ACTIONS = {
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.messaging_first_reply",
    "lead",
    "offsite_conversion.fb_pixel_lead",
}


def _env_list(name):
    return [s.strip() for s in (os.environ.get(name, "") or "").split(",") if s.strip()]


def _results(actions):
    t = 0
    for a in (actions or []):
        if a.get("action_type") in _LEAD_ACTIONS:
            try:
                t += int(float(a.get("value") or 0))
            except Exception:
                pass
    return t


def _fetch_account_daily(act_id, token, date_params, timeout=30):
    url = (GRAPH_API + "/" + act_id + "/insights?level=account&time_increment=1"
           + "&fields=spend,impressions,clicks,actions&limit=500"
           + "&access_token=" + urllib.parse.quote(token) + date_params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/meta-timeseries"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(data["error"].get("message") or "Graph API error")
    return data.get("data") or []


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

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        preset = params.get("date_preset") or ("" if (params.get("since") and params.get("until")) else "last_30d")
        since = params.get("since") or ""
        until = params.get("until") or ""
        nocache = bool(params.get("nocache"))
        key = "ts:" + build_cache_key(preset, since, until)

        sb = supabase_client()
        if sb and not nocache:
            cached, age_s, csource = read_cache(sb, key, CACHE_MAX_AGE_S)
            if cached:
                cached["cache"] = {"hit": True, "age_s": age_s, "source": csource, "shared": True}
                return self._send(200, cached)

        token = os.environ.get("META_ACCESS_TOKEN")
        account_ids = _env_list("META_AD_ACCOUNT_IDS")
        tokens = _env_list("META_AD_ACCOUNT_TOKENS")
        if not token or not account_ids:
            return self._send(503, {"ok": False, "error": "META_ACCESS_TOKEN/META_AD_ACCOUNT_IDS ausentes"})

        if since and until:
            date_params = '&time_range={"since":"%s","until":"%s"}' % (since, until)
        else:
            date_params = "&date_preset=" + urllib.parse.quote(preset or "last_30d")

        by_day = {}   # date -> {spend, results, impressions, clicks}
        errors = []
        for i, act_id in enumerate(account_ids):
            act_token = tokens[i] if i < len(tokens) and tokens[i] else token
            try:
                rows = _fetch_account_daily(act_id, act_token, date_params)
            except Exception as e:
                errors.append({"id": act_id, "error": str(e)})
                continue
            for row in rows:
                d = row.get("date_start")
                if not d:
                    continue
                acc = by_day.setdefault(d, {"spend": 0.0, "results": 0, "impressions": 0, "clicks": 0})
                acc["spend"] += float(row.get("spend") or 0)
                acc["results"] += _results(row.get("actions"))
                acc["impressions"] += int(float(row.get("impressions") or 0))
                acc["clicks"] += int(float(row.get("clicks") or 0))

        series = []
        tot = {"spend": 0.0, "results": 0, "impressions": 0, "clicks": 0}
        for d in sorted(by_day.keys()):
            v = by_day[d]
            series.append({
                "date": d,
                "spend": round(v["spend"], 2),
                "results": v["results"],
                "impressions": v["impressions"],
                "clicks": v["clicks"],
                "cpl": round(v["spend"] / v["results"], 2) if v["results"] > 0 else 0,
                "ctr": round(v["clicks"] / v["impressions"] * 100, 2) if v["impressions"] > 0 else 0,
            })
            for k in tot:
                tot[k] += v[k]
        tot["spend"] = round(tot["spend"], 2)
        tot["cpl"] = round(tot["spend"] / tot["results"], 2) if tot["results"] > 0 else 0
        tot["ctr"] = round(tot["clicks"] / tot["impressions"] * 100, 2) if tot["impressions"] > 0 else 0

        payload = {
            "ok": len(errors) == 0,
            "period": {"date_preset": preset, "since": since, "until": until},
            "series": series,
            "totals": tot,
            "errors": errors,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
        # Cacheia se houve pelo menos algum dado (não descarta por 1 conta com erro).
        if sb and series:
            write_cache(sb, key, preset, since, until, payload, source="live")
        payload["cache"] = {"hit": False, "source": "live"}
        return self._send(200, payload)
