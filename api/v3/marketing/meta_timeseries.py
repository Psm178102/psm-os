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
_MSG_ACTIONS = {
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.messaging_first_reply",
}
_LEAD_ONLY = {"lead", "offsite_conversion.fb_pixel_lead"}
_LEAD_ACTIONS = _MSG_ACTIONS | _LEAD_ONLY  # retrocompat (results = mensagens + leads)


def _env_list(name):
    return [s.strip() for s in (os.environ.get(name, "") or "").split(",") if s.strip()]


def _count(actions, types):
    t = 0
    for a in (actions or []):
        if a.get("action_type") in types:
            try:
                t += int(float(a.get("value") or 0))
            except Exception:
                pass
    return t


def _results(actions):
    return _count(actions, _LEAD_ACTIONS)


def _fetch_account_daily(act_id, token, date_params, timeout=30):
    url = (GRAPH_API + "/" + act_id + "/insights?level=account&time_increment=1"
           + "&fields=spend,impressions,reach,clicks,actions&limit=500"
           + "&access_token=" + urllib.parse.quote(token) + date_params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/meta-timeseries"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(data["error"].get("message") or "Graph API error")
    return data.get("data") or []


def _fetch_account_total(act_id, token, since, until, timeout=30):
    """Totais agregados (sem time_increment) de uma janela — pro período anterior."""
    tr = '{"since":"%s","until":"%s"}' % (since, until)
    url = (GRAPH_API + "/" + act_id + "/insights?level=account"
           + "&fields=spend,impressions,reach,clicks,actions"
           + "&time_range=" + urllib.parse.quote(tr)
           + "&access_token=" + urllib.parse.quote(token))
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/meta-timeseries"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(data["error"].get("message") or "Graph API error")
    return (data.get("data") or [{}])[0] if (data.get("data")) else {}


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
        sel = sorted([s.strip() for s in (params.get("accounts") or "").split(",") if s.strip()])
        key = "ts:" + ((",".join(sel) + ":") if sel else "") + build_cache_key(preset, since, until)

        sb = supabase_client()
        if sb and not nocache:
            cached, age_s, csource = read_cache(sb, key, CACHE_MAX_AGE_S)
            if cached:
                cached["cache"] = {"hit": True, "age_s": age_s, "source": csource, "shared": True}
                return self._send(200, cached)

        token = os.environ.get("META_ACCESS_TOKEN")
        # v84.87 — contas config-driven: envs + camada editável (excluídas/extras)
        from _accounts_lib import resolver_contas  # type: ignore
        account_ids, _lbls, tokens = resolver_contas(sb)
        if not token or not account_ids:
            return self._send(503, {"ok": False, "error": "META_ACCESS_TOKEN/META_AD_ACCOUNT_IDS ausentes"})
        # Pares (conta, token) alinhados; filtra pelas contas selecionadas (item 4)
        pairs = [(account_ids[i], (tokens[i] if i < len(tokens) and tokens[i] else token)) for i in range(len(account_ids))]
        if sel:
            pairs = [p for p in pairs if p[0] in sel]

        if since and until:
            date_params = '&time_range={"since":"%s","until":"%s"}' % (since, until)
        else:
            date_params = "&date_preset=" + urllib.parse.quote(preset or "last_30d")

        by_day = {}   # date -> {spend, results, messages, leads, impressions, clicks, reach}
        errors = []
        for act_id, act_token in pairs:
            try:
                rows = _fetch_account_daily(act_id, act_token, date_params)
            except Exception as e:
                errors.append({"id": act_id, "error": str(e)})
                continue
            for row in rows:
                d = row.get("date_start")
                if not d:
                    continue
                acc = by_day.setdefault(d, {"spend": 0.0, "results": 0, "messages": 0, "leads": 0, "impressions": 0, "clicks": 0, "reach": 0})
                acts = row.get("actions")
                acc["spend"] += float(row.get("spend") or 0)
                acc["messages"] += _count(acts, _MSG_ACTIONS)
                acc["leads"] += _count(acts, _LEAD_ONLY)
                acc["results"] += _results(acts)
                acc["impressions"] += int(float(row.get("impressions") or 0))
                acc["clicks"] += int(float(row.get("clicks") or 0))
                acc["reach"] += int(float(row.get("reach") or 0))

        series = []
        tot = {"spend": 0.0, "results": 0, "messages": 0, "leads": 0, "impressions": 0, "clicks": 0, "reach": 0}
        for d in sorted(by_day.keys()):
            v = by_day[d]
            series.append({
                "date": d,
                "spend": round(v["spend"], 2),
                "results": v["results"],
                "messages": v["messages"],
                "leads": v["leads"],
                "impressions": v["impressions"],
                "clicks": v["clicks"],
                "reach": v["reach"],
                "cpl": round(v["spend"] / v["results"], 2) if v["results"] > 0 else 0,
                "ctr": round(v["clicks"] / v["impressions"] * 100, 2) if v["impressions"] > 0 else 0,
            })
            for k in tot:
                tot[k] += v[k]
        tot["spend"] = round(tot["spend"], 2)
        tot["cpl"] = round(tot["spend"] / tot["results"], 2) if tot["results"] > 0 else 0
        tot["ctr"] = round(tot["clicks"] / tot["impressions"] * 100, 2) if tot["impressions"] > 0 else 0

        # ── Período anterior (mesma duração, imediatamente antes) → % de variação ──
        prev = {}
        delta = {}
        if series:
            try:
                from datetime import date as _date, timedelta as _td
                d0 = _date.fromisoformat(series[0]["date"])
                d1 = _date.fromisoformat(series[-1]["date"])
                ndays = (d1 - d0).days + 1
                p_until = d0 - _td(days=1)
                p_since = p_until - _td(days=ndays - 1)
                ps, pu = p_since.isoformat(), p_until.isoformat()
                pv = {"spend": 0.0, "results": 0, "messages": 0, "leads": 0, "impressions": 0, "clicks": 0, "reach": 0}
                for act_id, act_token in pairs:
                    try:
                        r = _fetch_account_total(act_id, act_token, ps, pu)
                    except Exception:
                        continue
                    acts = r.get("actions")
                    pv["spend"] += float(r.get("spend") or 0)
                    pv["messages"] += _count(acts, _MSG_ACTIONS)
                    pv["leads"] += _count(acts, _LEAD_ONLY)
                    pv["results"] += _results(acts)
                    pv["impressions"] += int(float(r.get("impressions") or 0))
                    pv["clicks"] += int(float(r.get("clicks") or 0))
                    pv["reach"] += int(float(r.get("reach") or 0))
                pv["spend"] = round(pv["spend"], 2)
                pv["cpl"] = round(pv["spend"] / pv["results"], 2) if pv["results"] > 0 else 0
                pv["ctr"] = round(pv["clicks"] / pv["impressions"] * 100, 2) if pv["impressions"] > 0 else 0
                prev = {"since": ps, "until": pu, **pv}
                for k in ("spend", "results", "messages", "leads", "impressions", "clicks", "reach", "cpl", "ctr"):
                    base = pv.get(k) or 0
                    delta[k] = round((tot.get(k, 0) - base) / base * 100, 1) if base else None
            except Exception:
                prev, delta = {}, {}

        payload = {
            "ok": len(errors) == 0,
            "period": {"date_preset": preset, "since": since, "until": until},
            "series": series,
            "totals": tot,
            "prev": prev,
            "delta": delta,
            "errors": errors,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
        # Cacheia se houve pelo menos algum dado (não descarta por 1 conta com erro).
        if sb and series:
            write_cache(sb, key, preset, since, until, payload, source="live")
        payload["cache"] = {"hit": False, "source": "live"}
        return self._send(200, payload)
