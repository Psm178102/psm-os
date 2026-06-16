"""
GET /api/v3/finance/summary[?company=imoveis|locacao|all]
Header: Authorization: Bearer <token>

Consolida KPIs financeiros de NIBO (multi-tenant 2 CNPJs) já agregados.
Requer auth. Apenas Sócio/Gerente/Líder pode ver (lvl >= 5).

Resp: {
  ok, company, fetched_at,
  receita: { previsto, recebido, total_lancamentos },
  despesa: { previsto, pago, total_lancamentos },
  saldo:   { previsto_liquido },
  por_categoria_receita: [...top 10],
  por_categoria_despesa: [...top 10],
  por_empresa: {imoveis: {...}, locacao: {...}},
  mes_atual: { receita, despesa, saldo }
}
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


def _fetch_nibo(company: str, endpoint: str, top: int = 1000):
    """Chama NIBO direto (sem usar /api/nibo.js — evita hop interno)."""
    cfg = COMPANIES.get(company)
    if not cfg:
        return {"error": f"company inválida: {company}", "items": []}
    token = os.environ.get(cfg["env"])
    if not token:
        return {"error": f"{cfg['env']} não configurado", "items": []}

    url = f"{NIBO_BASE}/{endpoint}?$top={top}"
    req = urllib.request.Request(url, headers={
        "apitoken": token,
        "Accept": "application/json",
        "User-Agent": "PSM-OS-v3/75.46",
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        items = data.get("items") if isinstance(data, dict) else data
        if items is None:
            items = data if isinstance(data, list) else [data]
        # Tag origem
        for it in items:
            if isinstance(it, dict):
                it["_company"] = company
                it["_companyLabel"] = cfg["label"]
        return {"items": items, "count": data.get("count") if isinstance(data, dict) else len(items)}
    except urllib.error.HTTPError as e:
        # DIAGNÓSTICO: captura o corpo do erro + headers de rate-limit do NIBO
        # pra distinguir token expirado/inválido de cota/rate-limit estourado.
        detail = ""
        try:
            detail = (e.read().decode("utf-8", "replace") or "").strip()
        except Exception:
            detail = ""
        hdr = {}
        try:
            for h in ("WWW-Authenticate", "Retry-After", "X-RateLimit-Remaining",
                      "X-Rate-Limit-Remaining", "X-RateLimit-Limit", "RateLimit-Remaining",
                      "X-RateLimit-Reset"):
                v = e.headers.get(h) if e.headers else None
                if v:
                    hdr[h] = v
        except Exception:
            pass
        snippet = (detail[:200] or "").replace("\n", " ").replace("\r", " ")
        extra = (" | hdr=" + json.dumps(hdr, ensure_ascii=False)) if hdr else ""
        return {"error": f"HTTP {e.code}: {snippet}{extra}", "items": []}
    except Exception as e:
        return {"error": str(e), "items": []}


def _parse_money(v):
    if v is None:
        return 0.0
    try:
        return float(v)
    except Exception:
        return 0.0


def _bucket(items, money_key="value", cat_key="categories"):
    """Soma valores por categoria. Retorna list[(cat, valor, count)] ordenada."""
    bag = defaultdict(lambda: {"valor": 0.0, "count": 0})
    for it in items:
        if not isinstance(it, dict):
            continue
        v = _parse_money(it.get(money_key) or it.get("value") or it.get("amount"))
        cats = it.get(cat_key) or []
        cat_name = "Sem categoria"
        if isinstance(cats, list) and cats:
            first = cats[0]
            if isinstance(first, dict):
                cat_name = first.get("description") or first.get("name") or "Sem categoria"
            else:
                cat_name = str(first)
        elif isinstance(cats, dict):
            cat_name = cats.get("description") or cats.get("name") or "Sem categoria"
        bag[cat_name]["valor"] += v
        bag[cat_name]["count"] += 1
    arr = [{"categoria": k, "valor": v["valor"], "count": v["count"]} for k, v in bag.items()]
    arr.sort(key=lambda x: -abs(x["valor"]))
    return arr


def _is_in_month(it, year, month):
    d = it.get("dueDate") or it.get("date") or it.get("scheduleDate")
    if not d:
        return False
    try:
        dt = datetime.fromisoformat(d.replace("Z", "+00:00"))
        return dt.year == year and dt.month == month
    except Exception:
        return False


def _is_settled(it):
    """Lançamento já pago/recebido?"""
    if it.get("isPaid") or it.get("isReceived"):
        return True
    status = (it.get("status") or "").lower()
    if status in ("paid", "received", "settled", "pago", "recebido"):
        return True
    return False


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
        # Auth — apenas Sócio (lvl >= 10) por enquanto (dados sensíveis)
        try:
            user = require_user(self, min_lvl=4)  # Financeiro (lvl4) ou acima — é a função-núcleo do cargo
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}

        company = (params.get("company") or "all").strip().lower()
        companies = ["imoveis", "locacao"] if company == "all" else [company]

        receitas_all = []
        despesas_all = []
        por_empresa = {}
        errors = []

        for c in companies:
            recv = _fetch_nibo(c, "schedules/credit", 1000)
            paid = _fetch_nibo(c, "schedules/debit", 1000)
            if recv.get("error"): errors.append({"company": c, "endpoint": "schedules/credit", "msg": recv["error"]})
            if paid.get("error"): errors.append({"company": c, "endpoint": "schedules/debit", "msg": paid["error"]})
            r_items = recv.get("items") or []
            d_items = paid.get("items") or []
            receitas_all.extend(r_items)
            despesas_all.extend(d_items)
            por_empresa[c] = {
                "label": COMPANIES[c]["label"],
                "receita_total":   sum(_parse_money(x.get("value") or x.get("amount")) for x in r_items),
                "despesa_total":   sum(_parse_money(x.get("value") or x.get("amount")) for x in d_items),
                "n_lanc_receita":  len(r_items),
                "n_lanc_despesa":  len(d_items),
            }

        # Agregados globais
        receita_total   = sum(_parse_money(x.get("value") or x.get("amount")) for x in receitas_all)
        receita_recebida = sum(_parse_money(x.get("value") or x.get("amount")) for x in receitas_all if _is_settled(x))
        receita_prevista = receita_total - receita_recebida
        despesa_total   = sum(_parse_money(x.get("value") or x.get("amount")) for x in despesas_all)
        despesa_paga    = sum(_parse_money(x.get("value") or x.get("amount")) for x in despesas_all if _is_settled(x))
        despesa_prevista = despesa_total - despesa_paga

        # Mês atual
        now = datetime.now(timezone.utc)
        mes_receitas = [x for x in receitas_all if _is_in_month(x, now.year, now.month)]
        mes_despesas = [x for x in despesas_all if _is_in_month(x, now.year, now.month)]
        mes_atual = {
            "receita":      sum(_parse_money(x.get("value") or x.get("amount")) for x in mes_receitas),
            "despesa":      sum(_parse_money(x.get("value") or x.get("amount")) for x in mes_despesas),
            "n_receitas":   len(mes_receitas),
            "n_despesas":   len(mes_despesas),
        }
        mes_atual["saldo"] = mes_atual["receita"] - mes_atual["despesa"]

        return self._send(200, {
            "ok": len(errors) == 0,
            "partial": 0 < len(errors) < (len(companies) * 2),
            "company": company,
            "fetched_at": now.isoformat(),
            "receita": {
                "previsto": receita_prevista,
                "recebido": receita_recebida,
                "total": receita_total,
                "total_lancamentos": len(receitas_all),
            },
            "despesa": {
                "previsto": despesa_prevista,
                "pago": despesa_paga,
                "total": despesa_total,
                "total_lancamentos": len(despesas_all),
            },
            "saldo": {
                "previsto_liquido": (receita_prevista) - (despesa_prevista),
                "realizado_liquido": receita_recebida - despesa_paga,
            },
            "por_categoria_receita": _bucket(receitas_all)[:10],
            "por_categoria_despesa": _bucket(despesas_all)[:10],
            "por_empresa": por_empresa,
            "mes_atual": mes_atual,
            "errors": errors,
        })
