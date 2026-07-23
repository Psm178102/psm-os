"""
GET /api/v3/marketing/meta_breakdowns?breakdown=age[,gender]&date_preset=last_30d
    [&since=YYYY-MM-DD&until=YYYY-MM-DD][&nocache=1]
Header: Authorization: Bearer <token>   (Líder lvl>=5)

Insights do Meta quebrados por dimensão (idade, gênero, posicionamento,
dispositivo, região, hora). Endpoint Python dedicado — NÃO mexe no /api/meta-ads
(isola o recurso). Lê o mesmo META_ACCESS_TOKEN das env do Vercel.

Usa o cache compartilhado (meta_ads_cache) com chave 'bd:<breakdown>|...' e TTL
de 30min — breakdowns são sob demanda (clique no dashboard), não precisam do cron.

Resp: { ok, breakdown, period, accounts:[{label, accountId, rows:[{segment,
        spend, impressions, clicks, results, cpl, ctr}]}], totals, errors }
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

# Dimensões que o Meta aceita em /insights?breakdowns=
ALLOWED_BREAKDOWNS = {
    "age", "gender", "publisher_platform", "device_platform",
    "platform_position", "impression_device", "region", "country",
    "hourly_stats_aggregated_by_advertiser_time_zone",
}
# Mesmo conjunto de actions que o /api/meta-ads conta como "resultado" (lead).
_LEAD_ACTIONS = {
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.messaging_first_reply",
    "lead",
    "offsite_conversion.fb_pixel_lead",
}


def _env_list(name):
    return [s.strip() for s in (os.environ.get(name, "") or "").split(",") if s.strip()]


def _results_from_actions(actions):
    total = 0
    for a in (actions or []):
        if a.get("action_type") in _LEAD_ACTIONS:
            try:
                total += int(float(a.get("value") or 0))
            except Exception:
                pass
    return total


def _fetch_account(act_id, token, bd_keys, date_params, timeout=30):
    fields = "spend,impressions,clicks,actions"
    bd = ",".join(bd_keys)
    url = (GRAPH_API + "/" + act_id + "/insights?level=account"
           + "&breakdowns=" + urllib.parse.quote(bd)
           + "&fields=" + fields + "&limit=500&access_token=" + urllib.parse.quote(token)
           + date_params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/meta-breakdowns"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(data["error"].get("message") or "Graph API error")
    out = []
    for row in (data.get("data") or []):
        seg = " · ".join(str(row.get(k) or "—") for k in bd_keys)
        spend = float(row.get("spend") or 0)
        impressions = int(float(row.get("impressions") or 0))
        clicks = int(float(row.get("clicks") or 0))
        results = _results_from_actions(row.get("actions"))
        out.append({
            "segment": seg,
            "spend": round(spend, 2),
            "impressions": impressions,
            "clicks": clicks,
            "results": results,
            "cpl": round(spend / results, 2) if results > 0 else 0,
            "ctr": round(clicks / impressions * 100, 2) if impressions > 0 else 0,
        })
    out.sort(key=lambda r: -r["spend"])
    return out


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

        bd_raw = (params.get("breakdown") or "age").strip()
        bd_keys = [k.strip() for k in bd_raw.split(",") if k.strip()]
        invalid = [k for k in bd_keys if k not in ALLOWED_BREAKDOWNS]
        if not bd_keys or invalid:
            return self._send(400, {"ok": False,
                                    "error": "breakdown inválido: %s" % (invalid or bd_raw),
                                    "allowed": sorted(ALLOWED_BREAKDOWNS)})

        preset = params.get("date_preset") or ("" if (params.get("since") and params.get("until")) else "last_30d")
        since = params.get("since") or ""
        until = params.get("until") or ""
        nocache = bool(params.get("nocache"))
        key = "bd:" + ",".join(bd_keys) + "|" + build_cache_key(preset, since, until)

        sb = supabase_client()
        if sb and not nocache:
            cached, age_s, csource = read_cache(sb, key, CACHE_MAX_AGE_S)
            if cached:
                cached["cache"] = {"hit": True, "age_s": age_s, "source": csource, "shared": True}
                return self._send(200, cached)

        token = os.environ.get("META_ACCESS_TOKEN")
        # v84.87 — contas config-driven: envs + camada editável (excluídas/extras)
        from _accounts_lib import resolver_contas  # type: ignore
        account_ids, labels, tokens = resolver_contas(sb)
        if not token or not account_ids:
            return self._send(503, {"ok": False, "error": "META_ACCESS_TOKEN/META_AD_ACCOUNT_IDS ausentes"})

        if since and until:
            date_params = '&time_range={"since":"%s","until":"%s"}' % (since, until)
        else:
            date_params = "&date_preset=" + urllib.parse.quote(preset or "last_30d")

        accounts = []
        errors = []
        tot = {"spend": 0.0, "impressions": 0, "clicks": 0, "results": 0}
        for i, act_id in enumerate(account_ids):
            label = labels[i] if i < len(labels) and labels[i] else act_id
            act_token = tokens[i] if i < len(tokens) and tokens[i] else token
            try:
                rows = _fetch_account(act_id, act_token, bd_keys, date_params)
            except Exception as e:
                errors.append({"id": act_id, "label": label, "error": str(e)})
                accounts.append({"label": label, "accountId": act_id, "rows": [], "_error": str(e)})
                continue
            for r in rows:
                tot["spend"] += r["spend"]
                tot["impressions"] += r["impressions"]
                tot["clicks"] += r["clicks"]
                tot["results"] += r["results"]
            accounts.append({"label": label, "accountId": act_id, "rows": rows})

        tot["spend"] = round(tot["spend"], 2)
        tot["cpl"] = round(tot["spend"] / tot["results"], 2) if tot["results"] > 0 else 0
        tot["ctr"] = round(tot["clicks"] / tot["impressions"] * 100, 2) if tot["impressions"] > 0 else 0

        payload = {
            "ok": len(errors) == 0,
            "breakdown": ",".join(bd_keys),
            "period": {"date_preset": preset, "since": since, "until": until},
            "accounts": accounts,
            "totals": tot,
            "errors": errors,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
        # Só aquece o cache quando veio inteiro (sem conta com erro).
        if sb and not errors:
            write_cache(sb, key, preset, since, until, payload, source="live")
        payload["cache"] = {"hit": False, "source": "live"}
        return self._send(200, payload)
