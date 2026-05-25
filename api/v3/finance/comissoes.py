"""
GET /api/v3/finance/comissoes[?company=imoveis|locacao|all&months=6]
Header: Authorization: Bearer <token>

Filtra lançamentos NIBO em categorias que contenham 'comiss', 'honor', 'corretor', 'broker', '4%'.
Agrupa por mês + por categoria + por destinatário (stakeholder).
Retorna lista detalhada (até 500) + agregados.

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

KEYWORDS = ["comiss", "honor", "corretor", "broker", "4%"]


def _matches_commission(it):
    """Heurística: olha description, categories[].description, stakeholder.name"""
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
    stake = it.get("stakeholder") or {}
    if isinstance(stake, dict) and stake.get("name"):
        haystack.append(str(stake["name"]).lower())
    blob = " | ".join(haystack)
    return any(k in blob for k in KEYWORDS)


def _fetch_nibo(company: str, endpoint: str, top: int = 2000):
    cfg = COMPANIES.get(company)
    if not cfg: return {"items": [], "error": f"company {company}"}
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


def _money(v):
    try: return float(v or 0)
    except: return 0.0

def _settled(it):
    if it.get("isPaid") or it.get("isReceived"): return True
    return (it.get("status") or "").lower() in ("paid", "received", "settled", "pago", "recebido")

def _date(it):
    return it.get("dueDate") or it.get("scheduleDate") or it.get("date")

def _stakeholder_name(it):
    s = it.get("stakeholder") or {}
    if isinstance(s, dict): return s.get("name") or s.get("description") or "—"
    return str(s) if s else "—"

def _category_name(it):
    cats = it.get("categories") or []
    if isinstance(cats, list) and cats:
        c = cats[0]
        if isinstance(c, dict): return c.get("description") or c.get("name") or "—"
    return "—"


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

        all_items = []
        errors = []
        for c in companies:
            r = _fetch_nibo(c, "schedules/debit", 2000)
            if r.get("error"): errors.append({"company": c, "msg": r["error"]})
            all_items.extend(r.get("items") or [])

        # Filtra heurística
        items = [it for it in all_items if isinstance(it, dict) and _matches_commission(it)]

        # Limita resposta
        rows = []
        for it in items[:500]:
            rows.append({
                "id": it.get("id") or it.get("scheduleId"),
                "company": it.get("_company"),
                "company_label": it.get("_companyLabel"),
                "data": _date(it),
                "stakeholder": _stakeholder_name(it),
                "category": _category_name(it),
                "description": it.get("description") or "",
                "valor": _money(it.get("value") or it.get("amount")),
                "settled": _settled(it),
                "status": it.get("status"),
            })

        # Agregados por stakeholder (top corretores)
        by_stake = defaultdict(lambda: {"valor": 0.0, "count": 0, "pago": 0.0, "previsto": 0.0})
        for r in rows:
            k = r["stakeholder"] or "—"
            by_stake[k]["valor"] += r["valor"]
            by_stake[k]["count"] += 1
            if r["settled"]: by_stake[k]["pago"] += r["valor"]
            else:            by_stake[k]["previsto"] += r["valor"]
        top_stake = sorted(
            [{"stakeholder": k, **v} for k, v in by_stake.items()],
            key=lambda x: -x["valor"]
        )[:20]

        total = sum(r["valor"] for r in rows)
        pago = sum(r["valor"] for r in rows if r["settled"])
        previsto = total - pago

        return self._send(200, {
            "ok": len(errors) == 0,
            "company": company,
            "matched_keywords": KEYWORDS,
            "rows": rows,
            "total_lancamentos": len(rows),
            "total_valor": total,
            "pago": pago,
            "previsto": previsto,
            "top_stakeholders": top_stake,
            "errors": errors,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
