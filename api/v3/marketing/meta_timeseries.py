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
from _window_lib import window as _resolve_window, WindowError  # type: ignore
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta as _td

GRAPH_API = "https://graph.facebook.com/v21.0"
CACHE_MAX_AGE_S = 30 * 60
# v86.68: só conversation_started_7d (first_reply é subconjunto → somava 2×)
_MSG_ACTIONS = {
    "onsite_conversion.messaging_conversation_started_7d",
}
_LEAD_ONLY = {"lead", "offsite_conversion.fb_pixel_lead"}
_LEAD_ACTIONS = _MSG_ACTIONS | _LEAD_ONLY  # retrocompat (results = mensagens + leads)


def _env_list(name):
    return [s.strip() for s in (os.environ.get(name, "") or "").split(",") if s.strip()]


_LEAD_PARTS = {"offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"}


def _count(actions, types):
    """Soma as actions de `types`. v88.11: `lead` já é o TOTAL de leads na Meta
    (formulário + pixel) — se veio, as partes (fb_pixel_lead/lead_grouped) são
    ignoradas; antes lead + fb_pixel_lead contava o lead de pixel 2×."""
    types = set(types)
    has_agg = "lead" in types and any(a.get("action_type") == "lead" for a in (actions or []))
    t = 0
    for a in (actions or []):
        at = a.get("action_type")
        if at in _LEAD_PARTS and "lead" in types:
            if has_agg:
                continue
        elif at not in types:
            continue
        try:
            t += int(float(a.get("value") or 0))
        except Exception:
            pass
    return t


def _results(actions):
    return _count(actions, _LEAD_ACTIONS)


def _get_json(url, timeout=30):
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/meta-timeseries"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(data["error"].get("message") or "Graph API error")
    return data


def _fetch_account_daily(act_id, token, since, until, timeout=30):
    """Série diária da conta na janela [since, until]. v88.13: segue paging.next
    (limit=500 cortava intervalos longos calado)."""
    tr = '{"since":"%s","until":"%s"}' % (since, until)
    url = (GRAPH_API + "/" + act_id + "/insights?level=account&time_increment=1"
           + "&fields=spend,impressions,reach,clicks,actions&limit=500"
           + "&time_range=" + urllib.parse.quote(tr)
           + "&action_report_time=conversion"   # v88.19: dia da conversão (= RD)
           + "&access_token=" + urllib.parse.quote(token))
    out, pages = [], 0
    while url and pages < 10:
        data = _get_json(url, timeout)
        out.extend(data.get("data") or [])
        url = (data.get("paging") or {}).get("next")
        pages += 1
    return out


def _fetch_account_total(act_id, token, since, until, timeout=30):
    """Totais agregados (sem time_increment) de uma janela — pro período anterior."""
    tr = '{"since":"%s","until":"%s"}' % (since, until)
    url = (GRAPH_API + "/" + act_id + "/insights?level=account"
           + "&fields=spend,impressions,reach,clicks,actions"
           + "&time_range=" + urllib.parse.quote(tr)
           + "&action_report_time=conversion"   # v88.19: dia da conversão (= RD)
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
        # v88.13: janela resolvida no _window_lib (mesma do CRM, BRT) e enviada à
        # Meta sempre como time_range explícito. Preset/datas inválidos → 400
        # (antes: 200 com tudo zerado; e since/until crus iam concatenados na URL).
        try:
            w_s, w_u = _resolve_window(params)
        except WindowError as e:
            return self._send(400, {"ok": False, "error": str(e)})
        ws, wu = w_s.isoformat(), w_u.isoformat()
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

        # v88.13: período anterior = mesma duração da JANELA pedida, imediatamente
        # antes (antes vinha do 1º/último dia COM dado — campanha ligada há 10 dias
        # num last_30d comparava com 10 dias).
        ndays = (w_u - w_s).days + 1
        p_u = w_s - _td(days=1)
        p_s = p_u - _td(days=ndays - 1)
        ps, pu = p_s.isoformat(), p_u.isoformat()

        # Por conta, em paralelo: série diária + total da janela (alcance REAL —
        # alcance é de pessoas únicas, não se soma dia a dia) + total do anterior.
        def _job(pair):
            act_id, act_token = pair
            out = {"id": act_id}
            try:
                out["daily"] = _fetch_account_daily(act_id, act_token, ws, wu)
                out["cur"] = _fetch_account_total(act_id, act_token, ws, wu)
            except Exception as e:
                out["error"] = str(e)
            try:
                out["prev"] = _fetch_account_total(act_id, act_token, ps, pu)
            except Exception as e:
                out["prev_error"] = str(e)
            return out

        with ThreadPoolExecutor(max_workers=min(8, max(1, len(pairs)))) as ex:
            results = list(ex.map(_job, pairs))

        by_day = {}   # date -> {spend, results, messages, leads, impressions, clicks, reach}
        errors = []
        reach_total = 0
        for r in results:
            if r.get("error"):
                errors.append({"id": r["id"], "error": r["error"]})
                continue
            reach_total += int(float((r.get("cur") or {}).get("reach") or 0))
            for row in r.get("daily") or []:
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
                if k != "reach":
                    tot[k] += v[k]
        tot["reach"] = reach_total   # alcance do período (não a soma dos dias)
        tot["spend"] = round(tot["spend"], 2)
        tot["cpl"] = round(tot["spend"] / tot["results"], 2) if tot["results"] > 0 else 0
        tot["ctr"] = round(tot["clicks"] / tot["impressions"] * 100, 2) if tot["impressions"] > 0 else 0

        # ── Período anterior → % de variação (só se TODAS as contas responderam) ──
        pv = {"spend": 0.0, "results": 0, "messages": 0, "leads": 0, "impressions": 0, "clicks": 0, "reach": 0}
        prev_failed = []
        for r in results:
            if r.get("error"):
                continue
            if r.get("prev_error"):
                prev_failed.append({"id": r["id"], "error": r["prev_error"]})
                continue
            x = r.get("prev") or {}
            acts = x.get("actions")
            pv["spend"] += float(x.get("spend") or 0)
            pv["messages"] += _count(acts, _MSG_ACTIONS)
            pv["leads"] += _count(acts, _LEAD_ONLY)
            pv["results"] += _results(acts)
            pv["impressions"] += int(float(x.get("impressions") or 0))
            pv["clicks"] += int(float(x.get("clicks") or 0))
            pv["reach"] += int(float(x.get("reach") or 0))
        pv["spend"] = round(pv["spend"], 2)
        pv["cpl"] = round(pv["spend"] / pv["results"], 2) if pv["results"] > 0 else 0
        pv["ctr"] = round(pv["clicks"] / pv["impressions"] * 100, 2) if pv["impressions"] > 0 else 0
        prev = {"since": ps, "until": pu, **pv, "partial": bool(prev_failed), "accounts_error": prev_failed}
        delta = {}
        if not prev_failed and not errors:
            for k in ("spend", "results", "messages", "leads", "impressions", "clicks", "reach", "cpl", "ctr"):
                base = pv.get(k) or 0
                delta[k] = round((tot.get(k, 0) - base) / base * 100, 1) if base else None

        payload = {
            "ok": len(errors) == 0,
            "period": {"date_preset": preset, "since": ws, "until": wu},
            "series": series,
            "totals": tot,
            "prev": prev,
            "delta": delta,
            "errors": errors,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
        # v88.13: só cacheia resultado COMPLETO (parcial ficava 30min com conta faltando)
        if sb and series and not errors:
            write_cache(sb, key, preset, since, until, payload, source="live")
        payload["cache"] = {"hit": False, "source": "live"}
        return self._send(200, payload)
