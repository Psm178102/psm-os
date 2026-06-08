"""
GET /api/v3/marketing/meta_monthly_cron
  Auth: Authorization: Bearer <CRON_SECRET>  OU  ?key=<CRON_SECRET>
  Opcional: ?ano=2026 (default ano atual) · ?meses=1,2,3 (default: todos até hoje)

Arquiva o HISTÓRICO MENSAL do Meta Ads na tabela meta_ads_monthly. Pra cada mês
do ano, busca o período no /api/meta-ads (since/until), soma as contas e grava
investimento, leads (results), mensagens, CPL, CPM e a campanha campeã do mês.
Roda diário pelo Vercel Cron (atualiza o mês corrente) e, ao rodar, faz BACKFILL
de todos os meses do ano que a Graph API ainda devolve. Idempotente (upsert).

Resp: { ok, ano, meses:[{mes, ok, spend, results, cpl, top}], errors[], duration_s }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time, urllib.parse, calendar
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from _meta_cache_lib import fetch_live  # type: ignore


def _authorized(headers, path):
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.lower().startswith("bearer ") and auth[7:].strip() == secret:
        return True
    try:
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(path).query))
        return q.get("key") == secret
    except Exception:
        return False


def _num(x):
    try:
        return float(x or 0)
    except Exception:
        return 0.0


def _aggregate(payload):
    accs = (payload.get("accounts") or []) if isinstance(payload, dict) else []
    t = {"spend": 0.0, "results": 0.0, "messages": 0.0, "leads": 0.0, "impressions": 0.0, "clicks": 0.0, "accounts_n": 0}
    for a in accs:
        if a.get("_error"):
            continue
        t["accounts_n"] += 1
        t["spend"] += _num(a.get("spend"))
        t["results"] += _num(a.get("results"))
        t["messages"] += _num(a.get("messages"))
        t["leads"] += _num(a.get("leads"))
        t["impressions"] += _num(a.get("impressions"))
        t["clicks"] += _num(a.get("clicks"))
    t["cpl"] = (t["spend"] / t["results"]) if t["results"] > 0 else 0.0
    t["cpm"] = (t["spend"] / t["impressions"] * 1000) if t["impressions"] > 0 else 0.0
    # campanha campeã do mês (mais leads/results)
    camps = (payload.get("campaigns") or []) if isinstance(payload, dict) else []
    best = None
    for c in camps:
        v = _num(c.get("results")) or _num(c.get("leads"))
        if best is None or v > best[1]:
            best = (c.get("name") or c.get("campaign_name") or "—", v)
    t["top_campaign"] = best[0] if best else None
    t["top_campaign_leads"] = best[1] if best else 0.0
    return t


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        # Autoriza por CRON_SECRET (Vercel) OU por usuário logado lvl≥7 (botão "Atualizar agora")
        ok_auth = _authorized(self.headers, self.path)
        if not ok_auth:
            try:
                require_user(self, min_lvl=7)
                ok_auth = True
            except AuthError:
                ok_auth = False
        if not ok_auth:
            return self._send(401, {"ok": False, "error": "precisa de CRON_SECRET ou login de Diretor (lvl 7+)"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})

        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        now = datetime.now(timezone.utc)
        try:
            ano = int(q.get("ano") or now.year)
        except Exception:
            ano = now.year
        last_mes = now.month if ano == now.year else 12
        if q.get("meses"):
            try:
                meses = [int(x) for x in q["meses"].split(",") if x.strip()]
            except Exception:
                meses = list(range(1, last_mes + 1))
        else:
            meses = list(range(1, last_mes + 1))

        host = self.headers.get("Host") or "www.housepsm.com.br"
        t0 = time.time()
        out, errors = [], []
        for mes in meses:
            since = f"{ano}-{mes:02d}-01"
            last_day = now.day if (ano == now.year and mes == now.month) else calendar.monthrange(ano, mes)[1]
            until = f"{ano}-{mes:02d}-{last_day:02d}"
            payload, err = fetch_live(host, "", since, until, nocache=True)
            if err or not isinstance(payload, dict):
                errors.append({"mes": mes, "error": err or "payload inválido"})
                out.append({"mes": mes, "ok": False})
                continue
            agg = _aggregate(payload)
            row = {"ano": ano, "mes": mes, **agg, "captured_at": now.isoformat()}
            try:
                sb.table("meta_ads_monthly").upsert(row, on_conflict="ano,mes").execute()
                out.append({"mes": mes, "ok": True, "spend": round(agg["spend"]), "results": round(agg["results"]),
                            "cpl": round(agg["cpl"], 2), "top": agg["top_campaign"]})
            except Exception as e:
                errors.append({"mes": mes, "error": str(e)})
                out.append({"mes": mes, "ok": False})

        return self._send(200, {"ok": True, "ano": ano, "meses": out, "errors": errors,
                                "duration_s": round(time.time() - t0, 1)})
