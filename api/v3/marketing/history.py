"""GET /api/v3/marketing/history[?ano=2026] — histórico MENSAL do Meta Ads.
Lê a tabela meta_ads_monthly (preenchida pelo meta_monthly_cron). lvl>=5.
Resp: { ok, ano, meses:[{mes, spend, results, cpl, ...}], totais:{...} }.
Degrada gracioso se a tabela ainda não existe (hint pra rodar o SQL)."""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore


def _missing(e):
    s = str(e).lower()
    return "meta_ads_monthly" in s or "does not exist" in s or "schema cache" in s


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
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        try:
            ano = int(q.get("ano") or datetime.now(timezone.utc).year)
        except Exception:
            ano = datetime.now(timezone.utc).year

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})
        try:
            rows = sb.table("meta_ads_monthly").select("*").eq("ano", ano).order("mes").execute().data or []
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": True, "ano": ano, "meses": [], "pending": True,
                                        "hint": "Rode supabase/sprint_meta_monthly.sql e dispare /api/v3/marketing/meta_monthly_cron"})
            return self._send(500, {"ok": False, "error": str(e)})

        tot = {"spend": 0.0, "results": 0.0, "messages": 0.0, "leads": 0.0, "impressions": 0.0, "clicks": 0.0}
        for r in rows:
            for k in tot:
                tot[k] += float(r.get(k) or 0)
        tot["cpl"] = (tot["spend"] / tot["results"]) if tot["results"] > 0 else 0.0
        return self._send(200, {"ok": True, "ano": ano, "meses": rows, "totais": tot,
                                "meses_com_dado": len(rows)})
