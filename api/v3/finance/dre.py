"""
GET /api/v3/finance/dre[?company=imoveis|locacao|all&months=12]
Header: Authorization: Bearer <token>

DRE últimos 12 meses (default) consolidado dos 2 CNPJs.
Cada mês: receita_realizada, despesa_realizada, saldo, receita_prevista,
despesa_prevista, # lançamentos.

Resposta otimizada pra renderizar tabela 12m × {receita, despesa, saldo}.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore


NIBO_BASE = "https://api.nibo.com.br/empresas/v1"
COMPANIES = {
    "imoveis": {"env": "NIBO_API_TOKEN",    "label": "PSM Imóveis"},
    "locacao": {"env": "NIBO_TOKEN_LOCACAO", "label": "PSM Locação"},
}

MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']


def _fetch_nibo(company: str, endpoint: str, top: int = 2000):
    cfg = COMPANIES.get(company)
    if not cfg:
        return {"error": f"company inválida: {company}", "items": []}
    token = os.environ.get(cfg["env"])
    if not token:
        return {"error": f"{cfg['env']} ausente", "items": []}

    url = f"{NIBO_BASE}/{endpoint}?$top={top}&$orderby=dueDate%20desc"
    req = urllib.request.Request(url, headers={
        "apitoken": token,
        "Accept": "application/json",
        "User-Agent": "PSM-OS-v3/75.47",
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        items = data.get("items") if isinstance(data, dict) else data
        if items is None:
            items = data if isinstance(data, list) else [data]
        return {"items": items}
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "items": []}
    except Exception as e:
        return {"error": str(e), "items": []}


def _parse_money(v):
    try: return float(v or 0)
    except: return 0.0


def _parse_iso_date(s):
    if not s: return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _is_settled(it):
    if it.get("isPaid") or it.get("isReceived"): return True
    st = (it.get("status") or "").lower()
    return st in ("paid", "received", "settled", "pago", "recebido")


def _month_key(dt):
    return f"{dt.year:04d}-{dt.month:02d}"


def _month_label(dt):
    return f"{MONTH_NAMES[dt.month - 1]}/{str(dt.year)[-2:]}"


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
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}

        company = (params.get("company") or "all").strip().lower()
        months = max(1, min(24, int(params.get("months", "12") or "12")))
        companies = ["imoveis", "locacao"] if company == "all" else [company]

        receitas, despesas = [], []
        errors = []
        for c in companies:
            r = _fetch_nibo(c, "schedules/credit", 2000)
            d = _fetch_nibo(c, "schedules/debit",  2000)
            if r.get("error"): errors.append({"company": c, "endpoint": "credit", "msg": r["error"]})
            if d.get("error"): errors.append({"company": c, "endpoint": "debit",  "msg": d["error"]})
            receitas.extend(r.get("items") or [])
            despesas.extend(d.get("items") or [])

        # Buckets por mês
        now = datetime.now(timezone.utc)
        # Gera labels dos últimos N meses (do mais antigo pro mais novo)
        month_order = []
        cur = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        for _ in range(months):
            month_order.append(cur)
            # decrementa mês
            if cur.month == 1:
                cur = datetime(cur.year - 1, 12, 1, tzinfo=timezone.utc)
            else:
                cur = datetime(cur.year, cur.month - 1, 1, tzinfo=timezone.utc)
        month_order.reverse()  # do antigo pro novo
        keys = [_month_key(m) for m in month_order]
        labels = [_month_label(m) for m in month_order]

        bag = {k: {
            "key": k, "label": labels[i],
            "receita_prev": 0.0, "receita_real": 0.0, "receita_count": 0,
            "despesa_prev": 0.0, "despesa_real": 0.0, "despesa_count": 0,
        } for i, k in enumerate(keys)}

        def _process(items, side):
            for it in items:
                d = _parse_iso_date(it.get("dueDate") or it.get("scheduleDate") or it.get("date"))
                if not d: continue
                k = _month_key(d)
                if k not in bag: continue
                v = _parse_money(it.get("value") or it.get("amount"))
                settled = _is_settled(it)
                bucket = bag[k]
                bucket[f"{side}_count"] += 1
                if settled:
                    bucket[f"{side}_real"] += v
                else:
                    bucket[f"{side}_prev"] += v

        _process(receitas, "receita")
        _process(despesas, "despesa")

        rows = []
        total_rec, total_des = 0.0, 0.0
        for k in keys:
            b = bag[k]
            saldo_real = b["receita_real"] - b["despesa_real"]
            saldo_prev = (b["receita_real"] + b["receita_prev"]) - (b["despesa_real"] + b["despesa_prev"])
            b["saldo_real"] = saldo_real
            b["saldo_prev"] = saldo_prev
            rows.append(b)
            total_rec += b["receita_real"] + b["receita_prev"]
            total_des += b["despesa_real"] + b["despesa_prev"]

        return self._send(200, {
            "ok": len(errors) == 0,
            "partial": 0 < len(errors) < (len(companies) * 2),
            "company": company,
            "months": months,
            "rows": rows,
            "totals": {
                "receita": total_rec,
                "despesa": total_des,
                "saldo": total_rec - total_des,
            },
            "errors": errors,
            "fetched_at": now.isoformat(),
        })
