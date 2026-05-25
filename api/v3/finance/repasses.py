"""
GET /api/v3/finance/repasses[?company=imoveis|locacao|all]
Header: Authorization: Bearer <token>

Filtra lançamentos NIBO em descrições/categorias com 'repasse' ou 'aluguel'
(típico de PSM Locação). Agrupa por mês e por proprietário.
Requer Líder (lvl >= 5).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore


NIBO_BASE = "https://api.nibo.com.br/empresas/v1"
COMPANIES = {
    "imoveis": {"env": "NIBO_API_TOKEN",    "label": "PSM Imóveis"},
    "locacao": {"env": "NIBO_TOKEN_LOCACAO", "label": "PSM Locação"},
}

KEYWORDS = ["repasse", "aluguel", "locador", "locação", "locacao"]


def _matches(it):
    haystack = []
    for k in ("description", "title", "details"):
        v = it.get(k)
        if v: haystack.append(str(v).lower())
    cats = it.get("categories") or []
    if isinstance(cats, list):
        for c in cats:
            if isinstance(c, dict):
                if c.get("description"): haystack.append(str(c["description"]).lower())
                if c.get("name"):        haystack.append(str(c["name"]).lower())
    s = it.get("stakeholder") or {}
    if isinstance(s, dict) and s.get("name"):
        haystack.append(str(s["name"]).lower())
    blob = " | ".join(haystack)
    return any(k in blob for k in KEYWORDS)


def _fetch_nibo(company: str, endpoint: str, top: int = 2000):
    cfg = COMPANIES.get(company)
    if not cfg: return {"items": [], "error": "company"}
    token = os.environ.get(cfg["env"])
    if not token: return {"items": [], "error": f"{cfg['env']} ausente"}
    url = f"{NIBO_BASE}/{endpoint}?$top={top}&$orderby=dueDate desc"
    req = urllib.request.Request(url, headers={
        "apitoken": token, "Accept": "application/json", "User-Agent": "PSM-OS-v3"
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        items = data.get("items") if isinstance(data, dict) else data
        if items is None: items = data if isinstance(data, list) else [data]
        for it in items:
            if isinstance(it, dict):
                it["_company"] = company
                it["_companyLabel"] = cfg["label"]
        return {"items": items}
    except Exception as e:
        return {"items": [], "error": str(e)}


def _m(v):
    try: return float(v or 0)
    except: return 0.0

def _settled(it):
    if it.get("isPaid") or it.get("isReceived"): return True
    return (it.get("status") or "").lower() in ("paid", "received", "settled", "pago", "recebido")

def _stake(it):
    s = it.get("stakeholder") or {}
    if isinstance(s, dict): return s.get("name") or "—"
    return str(s) if s else "—"

def _cat(it):
    cats = it.get("categories") or []
    if isinstance(cats, list) and cats:
        c = cats[0]
        if isinstance(c, dict): return c.get("description") or c.get("name") or "—"
    return "—"

def _date(it):
    return it.get("dueDate") or it.get("scheduleDate") or it.get("date")


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
        companies = ["imoveis", "locacao"] if company == "all" else [company]

        # Repasses geralmente são despesa (saída do dinheiro do aluguel pro dono),
        # mas locação também tem credit (recebimento do inquilino). Faz ambos.
        items_all = []
        errors = []
        for c in companies:
            for ep in ("schedules/debit", "schedules/credit"):
                r = _fetch_nibo(c, ep, 2000)
                if r.get("error"): errors.append({"company": c, "ep": ep, "msg": r["error"]})
                for it in (r.get("items") or []):
                    if isinstance(it, dict):
                        it["_direction"] = "debit" if "debit" in ep else "credit"
                items_all.extend(r.get("items") or [])

        items = [it for it in items_all if isinstance(it, dict) and _matches(it)]

        rows = []
        for it in items[:500]:
            rows.append({
                "id": it.get("id") or it.get("scheduleId"),
                "direction": it.get("_direction"),
                "company": it.get("_company"),
                "company_label": it.get("_companyLabel"),
                "data": _date(it),
                "stakeholder": _stake(it),
                "category": _cat(it),
                "description": it.get("description") or "",
                "valor": _m(it.get("value") or it.get("amount")),
                "settled": _settled(it),
            })

        # Top proprietários (stakeholders mais frequentes)
        bag = defaultdict(lambda: {"valor": 0.0, "count": 0})
        for r in rows:
            k = r["stakeholder"] or "—"
            bag[k]["valor"] += r["valor"]
            bag[k]["count"] += 1
        top = sorted(
            [{"stakeholder": k, **v} for k, v in bag.items()],
            key=lambda x: -x["valor"]
        )[:20]

        total = sum(r["valor"] for r in rows)
        a_pagar = sum(r["valor"] for r in rows if r["direction"] == "debit" and not r["settled"])
        a_receber = sum(r["valor"] for r in rows if r["direction"] == "credit" and not r["settled"])

        return self._send(200, {
            "ok": len(errors) == 0,
            "company": company,
            "matched_keywords": KEYWORDS,
            "rows": rows,
            "total_lancamentos": len(rows),
            "total_valor": total,
            "a_pagar": a_pagar,
            "a_receber": a_receber,
            "top_stakeholders": top,
            "errors": errors,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
