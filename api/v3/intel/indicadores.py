"""
GET /api/v3/intel/indicadores[?fresh=1] — 🏦 Indicadores de mercado (Banco Central, SGS). v88.86

Substitui os "indicadores manuais" da planilha Dados de Mercado (0 cadastrados em 4 meses): os números
que mexem no financiamento imobiliário vêm sozinhos da API pública do Banco Central.
  432   Selic meta (% a.a.)          13522 IPCA acumulado 12 meses (%)
  192   INCC-DI mensal (%) → mês e 12 meses compostos
  226   TR (% no período)            195   Rendimento da poupança (% no período)
Cache de 12 h em shared_kv (a API do BC é externa; não pesa no banco). Só sócio (lvl 10).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
if _V3 not in sys.path:
    sys.path.append(_V3)
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
import _metricas_lib as MX  # type: ignore

KV = "intel_indicadores"
TTL_S = 12 * 3600
URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{}/dados/ultimos/{}?formato=json"
URL_JANELA = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{}/dados?formato=json&dataInicial={}&dataFinal={}"


def _serie(codigo, n, dias=None):
    """dias=N → busca por janela de datas até hoje (a Selic meta tem datas FUTURAS e 'ultimos' só aceita ≤ 20)."""
    if dias:
        from datetime import timedelta
        h = MX.hoje_brt()
        url = URL_JANELA.format(codigo, (h - timedelta(days=dias)).strftime("%d/%m/%Y"), h.strftime("%d/%m/%Y"))
    else:
        url = URL.format(codigo, n)
    req = urllib.request.Request(url, headers={"User-Agent": "PSM-OS/indicadores"})
    rows = []
    for tentativa in (1, 2):   # a API do BC às vezes trava uma requisição isolada — 2ª tentativa resolve
        try:
            with urllib.request.urlopen(req, timeout=6) as r:
                rows = json.loads(r.read().decode("utf-8")) or []
            break
        except Exception:
            if tentativa == 2:
                raise
    hoje = MX.hoje_brt()
    out = []
    for x in rows:
        try:
            d = datetime.strptime(x["data"], "%d/%m/%Y").date()
            if d <= hoje:   # a Selic meta vem com datas futuras (vigente até o próximo Copom)
                out.append((d, float(str(x["valor"]).replace(",", "."))))
        except (KeyError, ValueError):
            continue
    out.sort()
    return out


def coletar():
    """As 5 buscas em paralelo (a API do BC às vezes demora ~8 s por série)."""
    from concurrent.futures import ThreadPoolExecutor
    itens, erros = [], []

    def add(id_, label, valor, unidade, ref, nota=""):
        if valor is not None:
            itens.append({"id": id_, "label": label, "valor": round(valor, 2), "unidade": unidade,
                          "ref": ref.isoformat() if ref else None, "nota": nota})

    def simples(id_, label, codigo, unidade, nota, n=3, dias=None):
        def fn():
            s = _serie(codigo, n, dias)
            if s:
                add(id_, label, s[-1][1], unidade, s[-1][0], nota)
        return fn

    tarefas = [
        simples("selic", "Selic (meta)", 432, "% a.a.", "juros básicos — puxam o crédito imobiliário", n=0, dias=30),
        simples("ipca_12m", "IPCA 12 meses", 13522, "%", "inflação oficial acumulada"),
        lambda: _incc(add),
        simples("tr", "TR", 226, "% no período", "corrige o saldo do financiamento SFH"),
        simples("poupanca", "Poupança", 195, "% no período", "funding do crédito imobiliário"),
    ]

    def roda(fn):
        try:
            fn()
        except Exception as e:
            erros.append(str(e)[:120])

    with ThreadPoolExecutor(max_workers=5) as ex:
        list(ex.map(roda, tarefas))
    ordem = ["selic", "ipca_12m", "incc_mes", "incc_12m", "tr", "poupanca"]
    itens.sort(key=lambda x: ordem.index(x["id"]) if x["id"] in ordem else 99)
    return itens, erros


def _incc(add):
    s = _serie(192, 13)
    if not s:
        return
    d, v = s[-1]
    add("incc_mes", "INCC-DI no mês", v, "%", d, "custo da construção (FGV) — reajusta obra na planta")
    ult12 = s[-12:]
    if len(ult12) == 12:
        acc = 1.0
        for _, x in ult12:
            acc *= 1 + x / 100
        add("incc_12m", "INCC-DI 12 meses", (acc - 1) * 100, "%", d, "acumulado composto dos últimos 12 meses")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        c = MX._kv_read(sb, KV) if sb else None
        ts = MX.parse_dt((c or {}).get("_cached_at")) if isinstance(c, dict) else None
        if not q.get("fresh") and ts and (datetime.now(timezone.utc) - ts).total_seconds() < TTL_S and c.get("itens"):
            return self._send(200, {"ok": True, "cached": True, "itens": c["itens"], "atualizado_em": c["_cached_at"],
                                    "fonte": "Banco Central do Brasil (SGS)"})
        itens, erros = coletar()
        if itens and isinstance(c, dict) and c.get("itens"):   # série que falhou agora usa o último valor bom
            tem = {x["id"] for x in itens}
            itens += [dict(x, anterior=True) for x in c["itens"] if x.get("id") not in tem]
        if not itens and isinstance(c, dict) and c.get("itens"):   # BC fora do ar: devolve o último bom
            return self._send(200, {"ok": True, "cached": True, "stale": True, "itens": c["itens"],
                                    "atualizado_em": c.get("_cached_at"), "erros": erros,
                                    "fonte": "Banco Central do Brasil (SGS)"})
        agora = datetime.now(timezone.utc).isoformat()
        if itens and sb:
            MX._kv_write(sb, KV, {"_cached_at": agora, "itens": itens})
        return self._send(200, {"ok": bool(itens), "cached": False, "itens": itens, "atualizado_em": agora,
                                "erros": erros, "fonte": "Banco Central do Brasil (SGS)"})
