"""
GET/POST /api/v3/cs/clientes — Carteira de clientes (Sucesso do Cliente). v81.53

HÍBRIDO: a base vem AUTOMÁTICA dos negócios GANHOS no RD (deals win=true) — nome,
LTV (soma do amount), última compra, categoria DERIVADA do funil (pipeline_name).
O CS/sócio ENRIQUECE cada cliente (shared_kv 'cs_enriq', chave = nome normalizado):
status (ativo/em_risco/churn/renovado), score (0-100), próxima renovação, satisfação,
categoria (override) e obs. As MÉTRICAS (churn%, retenção%, LTV, score) saem disso,
geral + por categoria (MAP/Conquista/Locação/Terceiros).

GET  (lvl>=5): {ok, clientes:[...], metrics:{geral, por_categoria}}.
POST (lvl>=5): {action:'enrich', key, dados:{...}} grava o enriquecimento.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, unicodedata
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "cs_enriq"
CATEGORIAS = ["MAP", "Conquista", "Locação", "Terceiros", "Outros"]
STATUSES = ["ativo", "em_risco", "churn", "renovado"]


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().strip()
    return " ".join(s.split())


def categoria_de(pipeline_name):
    p = (pipeline_name or "").lower()
    if "conquista" in p: return "Conquista"
    if "m.a.p" in p or "map" in p: return "MAP"
    if "loca" in p: return "Locação"
    if "terceir" in p: return "Terceiros"
    return "Outros"


def _read_enriq(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


def _fetch_won(sb):
    out, page, size = [], 0, 1000
    while page < 30:
        try:
            rows = (sb.table("deals").select("name,amount,closed_at,pipeline_name,user_email,user_id")
                    .eq("win", True).range(page * size, page * size + size - 1).execute().data or [])
        except Exception:
            break
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
    return out


def _money(v):
    try: return float(v or 0)
    except Exception: return 0.0


def _build_clientes(sb):
    deals = _fetch_won(sb)
    enriq = _read_enriq(sb)
    by_key = {}
    for d in deals:
        nome = (d.get("name") or "").strip()
        if not nome:
            continue
        k = norm(nome)
        c = by_key.get(k)
        if not c:
            c = by_key[k] = {"key": k, "nome": nome, "ltv": 0.0, "n_negocios": 0,
                             "ultima_compra": None, "cat_rd": categoria_de(d.get("pipeline_name")),
                             "corretor": d.get("user_email")}
        c["ltv"] += _money(d.get("amount"))
        c["n_negocios"] += 1
        cl = d.get("closed_at")
        if cl and (not c["ultima_compra"] or cl > c["ultima_compra"]):
            c["ultima_compra"] = cl
            c["cat_rd"] = categoria_de(d.get("pipeline_name"))  # categoria do negócio mais recente

    clientes = []
    for k, c in by_key.items():
        e = enriq.get(k) or {}
        categoria = e.get("categoria") or c["cat_rd"]
        status = e.get("status") or "ativo"
        score = e.get("score")
        clientes.append({
            **c, "ltv": round(c["ltv"], 2), "categoria": categoria, "status": status,
            "score": score, "satisfacao": e.get("satisfacao"),
            "proxima_renovacao": e.get("proxima_renovacao"), "obs": e.get("obs"),
            "enriquecido": bool(e),
        })
    clientes.sort(key=lambda x: -x["ltv"])
    return clientes


def _metrics(clientes):
    def agg(lst):
        n = len(lst)
        churn = sum(1 for c in lst if c["status"] == "churn")
        renov = sum(1 for c in lst if c["status"] == "renovado")
        risco = sum(1 for c in lst if c["status"] == "em_risco")
        ativos = sum(1 for c in lst if c["status"] in ("ativo", "renovado"))
        ltv_total = round(sum(c["ltv"] for c in lst), 2)
        scores = [c["score"] for c in lst if isinstance(c["score"], (int, float))]
        return {
            "clientes": n, "ativos": ativos, "em_risco": risco, "churn": churn, "renovados": renov,
            "churn_pct": round(churn / n * 100, 1) if n else 0,
            "retencao_pct": round((n - churn) / n * 100, 1) if n else 0,
            "ltv_total": ltv_total, "ltv_medio": round(ltv_total / n, 2) if n else 0,
            "score_medio": round(sum(scores) / len(scores), 1) if scores else None,
        }
    geral = agg(clientes)
    por_cat = {cat: agg([c for c in clientes if c["categoria"] == cat]) for cat in CATEGORIAS}
    por_cat = {k: v for k, v in por_cat.items() if v["clientes"] > 0}
    return {"geral": geral, "por_categoria": por_cat}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        clientes = _build_clientes(sb)
        return self._send(200, {"ok": True, "clientes": clientes, "metrics": _metrics(clientes),
                                "categorias": CATEGORIAS, "statuses": STATUSES})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        key = norm(body.get("key"))
        if not key:
            return self._send(400, {"ok": False, "error": "cliente (key) obrigatório"})
        dados = body.get("dados") if isinstance(body.get("dados"), dict) else {}
        clean = {}
        if dados.get("categoria") in CATEGORIAS: clean["categoria"] = dados["categoria"]
        if dados.get("status") in STATUSES: clean["status"] = dados["status"]
        if dados.get("score") not in (None, ""):
            try: clean["score"] = max(0, min(100, int(float(dados["score"]))))
            except Exception: pass
        for f in ("satisfacao", "proxima_renovacao", "obs"):
            v = dados.get(f)
            if v not in (None, ""): clean[f] = str(v)[:2000]
        clean["updated_at"] = datetime.now(timezone.utc).isoformat()

        enriq = _read_enriq(sb)
        enriq[key] = {**(enriq.get(key) or {}), **clean}
        try:
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": enriq,
                "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "cs.enrich", target_type="shared_kv", target_id=key)
        return self._send(200, {"ok": True, "key": key, "enriq": enriq[key]})
