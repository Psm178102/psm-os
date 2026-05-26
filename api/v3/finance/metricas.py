"""
GET /api/v3/finance/metricas[?months=6&company=imoveis|locacao|all]
Header: Authorization: Bearer <token>

Métricas avançadas Financeiro:
- MoM (Month-over-Month): cada mês × mês anterior, variação % receita/despesa/saldo
- Fluxo de Caixa próximos 90 dias (timeline diária prevista)
- Alertas inteligentes: queda receita >15%, alta despesa >20%, saldo negativo

Requer Líder (lvl>=5).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta, date
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore


NIBO_BASE = "https://api.nibo.com.br/empresas/v1"
COMPANIES = {
    "imoveis": {"env": "NIBO_API_TOKEN",    "label": "PSM Imóveis"},
    "locacao": {"env": "NIBO_TOKEN_LOCACAO", "label": "PSM Locação"},
}


def _fetch_nibo(company, endpoint, top=2000):
    cfg = COMPANIES.get(company)
    if not cfg: return {"items": []}
    token = os.environ.get(cfg["env"])
    if not token: return {"items": []}
    url = f"{NIBO_BASE}/{endpoint}?$top={top}&$orderby=dueDate desc"
    req = urllib.request.Request(url, headers={
        "apitoken": token, "Accept": "application/json", "User-Agent": "PSM-OS-v3"
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        items = data.get("items") if isinstance(data, dict) else data
        if items is None: items = data if isinstance(data, list) else [data]
        return {"items": items}
    except Exception as e:
        return {"items": [], "error": str(e)}


def _money(v):
    try: return float(v or 0)
    except: return 0.0

def _settled(it):
    if it.get("isPaid") or it.get("isReceived"): return True
    return (it.get("status") or "").lower() in ("paid","received","settled","pago","recebido")

def _parse_dt(s):
    if not s: return None
    try: return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except: return None


def _month_buckets(items, months_back, now):
    """Buckets por (year, month) pros últimos N meses, separando real vs previsto."""
    cur = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    keys = []
    for _ in range(months_back):
        keys.append((cur.year, cur.month))
        cur = (cur - timedelta(days=1)).replace(day=1, tzinfo=timezone.utc)
    keys.reverse()
    bag = {k: {"real": 0.0, "prev": 0.0, "n": 0} for k in keys}
    for it in items:
        d = _parse_dt(it.get("dueDate") or it.get("scheduleDate") or it.get("date"))
        if not d: continue
        k = (d.year, d.month)
        if k not in bag: continue
        v = _money(it.get("value") or it.get("amount"))
        bag[k]["n"] += 1
        if _settled(it): bag[k]["real"] += v
        else:            bag[k]["prev"] += v
    return keys, bag


def _cashflow_daily(receitas, despesas, days_ahead=90):
    """Timeline diária dos próximos N dias."""
    today = date.today()
    end = today + timedelta(days=days_ahead)
    timeline = []
    daily = defaultdict(lambda: {"in": 0.0, "out": 0.0, "in_n": 0, "out_n": 0})
    for it in receitas:
        d = _parse_dt(it.get("dueDate") or it.get("scheduleDate") or it.get("date"))
        if not d: continue
        dd = d.date()
        if today <= dd <= end and not _settled(it):
            daily[dd]["in"] += _money(it.get("value") or it.get("amount"))
            daily[dd]["in_n"] += 1
    for it in despesas:
        d = _parse_dt(it.get("dueDate") or it.get("scheduleDate") or it.get("date"))
        if not d: continue
        dd = d.date()
        if today <= dd <= end and not _settled(it):
            daily[dd]["out"] += _money(it.get("value") or it.get("amount"))
            daily[dd]["out_n"] += 1
    saldo = 0.0
    cur = today
    while cur <= end:
        d = daily[cur]
        saldo += d["in"] - d["out"]
        timeline.append({
            "data": cur.isoformat(),
            "in": d["in"], "out": d["out"],
            "in_n": d["in_n"], "out_n": d["out_n"],
            "saldo_dia": d["in"] - d["out"],
            "saldo_acumulado": saldo,
        })
        cur += timedelta(days=1)
    return timeline


def _build_alerts(months, mom_rows, cashflow):
    out = []
    # Variação receita / despesa últimos mês vs anterior
    if len(mom_rows) >= 2:
        cur = mom_rows[-1]
        prev = mom_rows[-2]
        if prev["receita"] > 0:
            pct_r = (cur["receita"] - prev["receita"]) / prev["receita"] * 100
            if pct_r < -15:
                out.append({"level": "alta", "type": "receita_queda", "msg": f"Receita caiu {pct_r:.1f}% em {cur['label']} vs {prev['label']}"})
        if prev["despesa"] > 0:
            pct_d = (cur["despesa"] - prev["despesa"]) / prev["despesa"] * 100
            if pct_d > 20:
                out.append({"level": "alta", "type": "despesa_aumento", "msg": f"Despesa subiu {pct_d:.1f}% em {cur['label']} vs {prev['label']}"})

    # Saldo previsto negativo nos próximos 90d
    negativos = [d for d in cashflow if d["saldo_acumulado"] < 0]
    if negativos:
        primeiro = negativos[0]
        out.append({"level": "critica", "type": "saldo_negativo", "msg": f"Saldo previsto fica negativo em {primeiro['data']} (R$ {primeiro['saldo_acumulado']:.0f})"})

    # Saldo total previsto 90d
    if cashflow:
        ult = cashflow[-1]["saldo_acumulado"]
        if ult < 0:
            out.append({"level": "alta", "type": "saldo_90d_negativo", "msg": f"Projeção 90 dias: saldo líquido R$ {ult:.0f} (negativo)"})
        elif ult < 10000:
            out.append({"level": "media", "type": "saldo_baixo", "msg": f"Projeção 90 dias: saldo baixo R$ {ult:.0f}"})
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
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}
        company = (params.get("company") or "all").strip().lower()
        months = max(2, min(12, int(params.get("months", "6") or "6")))
        days_ahead = max(30, min(180, int(params.get("days_ahead", "90") or "90")))
        companies = ["imoveis", "locacao"] if company == "all" else [company]

        receitas, despesas = [], []
        errors = []
        for c in companies:
            r = _fetch_nibo(c, "schedules/credit")
            d = _fetch_nibo(c, "schedules/debit")
            if r.get("error"): errors.append({"company": c, "ep": "credit", "msg": r["error"]})
            if d.get("error"): errors.append({"company": c, "ep": "debit",  "msg": d["error"]})
            receitas.extend(r.get("items") or [])
            despesas.extend(d.get("items") or [])

        now = datetime.now(timezone.utc)
        # MoM
        names = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
        keys, rec_buckets = _month_buckets(receitas, months, now)
        _,    des_buckets = _month_buckets(despesas, months, now)
        mom_rows = []
        for (y, m) in keys:
            r_total = rec_buckets[(y,m)]["real"] + rec_buckets[(y,m)]["prev"]
            d_total = des_buckets[(y,m)]["real"] + des_buckets[(y,m)]["prev"]
            mom_rows.append({
                "key": f"{y:04d}-{m:02d}",
                "label": f"{names[m-1]}/{str(y)[-2:]}",
                "receita": r_total,
                "receita_real": rec_buckets[(y,m)]["real"],
                "despesa": d_total,
                "despesa_real": des_buckets[(y,m)]["real"],
                "saldo": r_total - d_total,
                "saldo_real": rec_buckets[(y,m)]["real"] - des_buckets[(y,m)]["real"],
            })

        # %variação vs mês anterior
        for i in range(len(mom_rows)):
            if i == 0:
                mom_rows[i]["receita_pct"] = None
                mom_rows[i]["despesa_pct"] = None
                mom_rows[i]["saldo_pct"] = None
            else:
                p = mom_rows[i-1]
                c = mom_rows[i]
                c["receita_pct"] = ((c["receita"] - p["receita"]) / p["receita"] * 100) if p["receita"] else None
                c["despesa_pct"] = ((c["despesa"] - p["despesa"]) / p["despesa"] * 100) if p["despesa"] else None
                c["saldo_pct"]   = ((c["saldo"]   - p["saldo"])   / abs(p["saldo"]) * 100) if p["saldo"]   else None

        # Cashflow 90d
        cashflow = _cashflow_daily(receitas, despesas, days_ahead)

        # Alertas
        alerts = _build_alerts(months, mom_rows, cashflow)

        return self._send(200, {
            "ok": len(errors) == 0,
            "company": company,
            "months": months,
            "days_ahead": days_ahead,
            "mom": mom_rows,
            "cashflow": cashflow,
            "alerts": alerts,
            "summary": {
                "saldo_atual_aprox": cashflow[0]["saldo_acumulado"] if cashflow else 0,
                "saldo_90d": cashflow[-1]["saldo_acumulado"] if cashflow else 0,
                "menor_saldo_90d": min((d["saldo_acumulado"] for d in cashflow), default=0),
                "dias_negativos": sum(1 for d in cashflow if d["saldo_acumulado"] < 0),
            },
            "errors": errors,
            "fetched_at": now.isoformat(),
        })
