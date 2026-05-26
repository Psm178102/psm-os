"""
GET /api/v3/finance/custos_fixos[?company=imoveis|locacao|all&months=3]
Header: Authorization: Bearer <token>

Filtra NIBO schedules/debit em categorias clássicas de custo fixo
(folha, software, aluguel, contabilidade, internet, energia, telefone,
limpeza, marketing, manutenção). Agrupa por categoria + por mês.

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

BUCKETS = [
    ("Folha de Pagamento",  ["folha", "salario", "salário", "13o", "13º", "ferias", "férias", "vale-transporte", "vale transporte", "vt ", "pro labore", "pró-labore", "inss", "fgts"]),
    ("Softwares & SaaS",    ["software", "saas", "assinatura", "licença", "licenca", "nuvem", "cloud", "google workspace", "microsoft", "office 365", "365", "google one", "drive", "vercel", "supabase", "rd station", "rdstation", "kommo", "pipedrive", "kenlo", "imoview", "notion"]),
    ("Aluguéis & Condomínio", ["aluguel", "aluguéis", "condomin", "condominio", "condomínio", "locacao imovel", "iptu sede"]),
    ("Contabilidade & Consultoria", ["contabilidade", "contábil", "contabil", "consultoria", "advog", "advogad", "honorário advoc"]),
    ("Internet & Telecom",  ["internet", "wi-fi", "wifi", "telefon", "celular", "operadora", "claro", "vivo", "tim ", "oi ", "datora", "fibra"]),
    ("Energia & Água",      ["energia", "luz", "elétric", "eletric", "eletrica", "agua", "água", "saneamento"]),
    ("Marketing & Mídia",   ["marketing", "anúncio", "anuncio", "facebook ads", "meta ads", "google ads", "instagram", "mídia", "midia", "patrocínio", "patrocinio", "agência", "agencia"]),
    ("Manutenção & Limpeza", ["manutenção", "manutencao", "limpeza", "faxina", "diarista", "reparo", "consert", "predial"]),
    ("Impostos & Taxas",    ["imposto", "tributo", "iss", "simples nacional", "pis ", "cofins", "irpj", "csll", "darf", "taxa "]),
    ("Bancário",            ["tarifa banco", "tarifa bancária", "tarifa bancaria", "manutenção conta", "anuidade cartão", "tarifa cobr"]),
]


def _classify(it):
    parts = []
    for k in ("description", "title", "details"):
        v = it.get(k)
        if v: parts.append(str(v).lower())
    cats = it.get("categories") or []
    if isinstance(cats, list):
        for c in cats:
            if isinstance(c, dict):
                if c.get("description"): parts.append(str(c["description"]).lower())
                if c.get("name"):        parts.append(str(c["name"]).lower())
    stake = it.get("stakeholder") or {}
    if isinstance(stake, dict) and stake.get("name"):
        parts.append(str(stake["name"]).lower())
    blob = " | ".join(parts)
    for name, kws in BUCKETS:
        for kw in kws:
            if kw in blob:
                return name
    return None


def _fetch_nibo(company: str, endpoint: str, top: int = 2000):
    cfg = COMPANIES.get(company)
    if not cfg: return {"items": []}
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

def _date_str(it):
    return it.get("dueDate") or it.get("scheduleDate") or it.get("date")

def _month_key(s):
    if not s: return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return f"{dt.year:04d}-{dt.month:02d}"
    except:
        return None

def _stake(it):
    s = it.get("stakeholder") or {}
    if isinstance(s, dict): return s.get("name") or "—"
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
        months = max(1, min(12, int(params.get("months", "3") or "3")))
        companies = ["imoveis", "locacao"] if company == "all" else [company]

        all_items = []
        errors = []
        for c in companies:
            r = _fetch_nibo(c, "schedules/debit", 2000)
            if r.get("error"): errors.append({"company": c, "msg": r["error"]})
            all_items.extend(r.get("items") or [])

        now = datetime.now(timezone.utc)
        cy = now.year
        cm = now.month - months + 1
        while cm <= 0:
            cy -= 1
            cm += 12
        cutoff_key = f"{cy:04d}-{cm:02d}"

        by_bucket = defaultdict(lambda: {"total": 0.0, "count": 0, "pago": 0.0, "previsto": 0.0, "rows": []})
        by_bucket_month = defaultdict(lambda: defaultdict(float))
        all_months = set()
        unclass = 0

        for it in all_items:
            if not isinstance(it, dict): continue
            bucket = _classify(it)
            if not bucket:
                unclass += 1
                continue
            mk = _month_key(_date_str(it))
            if mk and mk < cutoff_key:
                continue
            v = _money(it.get("value") or it.get("amount"))
            settled = _settled(it)
            b = by_bucket[bucket]
            b["total"] += v
            b["count"] += 1
            if settled: b["pago"] += v
            else:       b["previsto"] += v
            b["rows"].append({
                "id": it.get("id"),
                "data": _date_str(it),
                "stakeholder": _stake(it),
                "description": it.get("description") or "",
                "valor": v,
                "settled": settled,
                "company": it.get("_company"),
            })
            if mk:
                by_bucket_month[bucket][mk] += v
                all_months.add(mk)

        buckets_out = []
        for name, _kws in BUCKETS:
            d = by_bucket.get(name)
            if not d or d["count"] == 0: continue
            d["rows"].sort(key=lambda r: (r["data"] or ""), reverse=True)
            d["rows"] = d["rows"][:50]
            d["by_month"] = dict(by_bucket_month.get(name) or {})
            buckets_out.append({"bucket": name, **d})
        buckets_out.sort(key=lambda x: -x["total"])

        return self._send(200, {
            "ok": len(errors) == 0,
            "company": company,
            "months": months,
            "since": cutoff_key,
            "buckets": buckets_out,
            "totals": {
                "total": sum(b["total"] for b in buckets_out),
                "pago": sum(b["pago"] for b in buckets_out),
                "previsto": sum(b["previsto"] for b in buckets_out),
            },
            "unclassified": unclass,
            "month_keys": sorted(list(all_months)),
            "errors": errors,
            "fetched_at": now.isoformat(),
        })
