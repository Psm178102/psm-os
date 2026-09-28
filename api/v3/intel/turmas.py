"""
GET /api/v3/intel/turmas?meses=6[&fresh=1]  — 🧪 Turmas e funil por canal (Inteligência · Vendas). v88.86

Para cada TURMA (negócios que entraram no RD num mês): quantos chegaram a cada degrau do funil
(contato → agendamento → visita → proposta → contrato → venda) e quantos viraram venda em 30/60/90 dias,
quebrado por frente, por canal de origem (categorias do Dicionário §2) e por corretor.

O cálculo pesado é UMA função agregada no banco (public.intel_turmas, ~40 ms, ~300 linhas) e o resultado
fica em cache (shared_kv) ligado à versão dos dados do RD — o banco é pequeno, nada de puxar negócio a negócio.

Atenção de leitura: é a TRAJETÓRIA NO RD. Na Conquista, a esteira oficial de etapas é a do PSM HUB
(Dicionário §5) — esta visão compara canais e turmas; não substitui o número oficial do mês.
Só sócio (lvl 10).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
if _V3 not in sys.path:
    sys.path.append(_V3)
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
import _metricas_lib as MX  # type: ignore

CACHE_TTL_S = 3 * 3600
DEGRAUS = ("entraram", "contato", "agendamento", "visita", "proposta", "contrato", "vendas")
EXTRAS = ("vendas_30", "vendas_60", "vendas_90", "vgv", "dias_venda_soma")
# Funis que NÃO entram na análise (decisão do Paulo, 28/09/2026). Comparação sem acento/caixa,
# ignorando o sufixo "(fechados 3d)".
FUNIS_FORA = {"carteira map paulo"}
FRENTES = {"conquista": "Conquista", "map": "MAP", "terceiros": "Terceiros", "locacao": "Locação", "outros": "Outros funis"}


def _frente(pipeline):
    k = MX.team_key(pipeline)
    return k if k in ("conquista", "map", "terceiros", "locacao") else "outros"


def _vazio():
    return {k: 0 for k in DEGRAUS + EXTRAS}


def _soma(acc, r):
    for k in DEGRAUS + EXTRAS:
        acc[k] += float(r.get(k) or 0) if k in ("vgv", "dias_venda_soma") else int(r.get(k) or 0)


def _limpa(b):
    b["vgv"] = round(b["vgv"], 2)
    b["dias_venda_medio"] = round(b["dias_venda_soma"] / b["vendas"], 1) if b["vendas"] else None
    b.pop("dias_venda_soma", None)
    return b


def calcular(sb, meses, hoje):
    y, m = hoje.year, hoje.month - (meses - 1)
    while m <= 0:
        m += 12
        y -= 1
    desde = date(y, m, 1)
    rows = sb.rpc("intel_turmas", {"p_desde": desde.isoformat()}).execute().data or []
    rows = [r for r in rows
            if MX._norm(r.get("pipeline") or "").replace("(fechados 3d)", "").strip() not in FUNIS_FORA]
    mapa = MX.mapa_origens(sb)
    nomes, por_nome_colado = {}, {}
    try:
        for u in sb.table("users").select("id,name,email").execute().data or []:
            nomes[str(u["id"])] = u.get("name") or u["id"]
            if u.get("email"):
                nomes[u["email"].lower()] = u.get("name") or u["email"]
            if u.get("name"):   # "Paulo Morimatsu" → "paulomorimatsu" (casa com paulomorimatsu@gmail.com do RD)
                por_nome_colado[MX._norm(u["name"]).replace(" ", "")] = u["name"]
    except Exception:
        pass

    def nome_dono(r):
        em = (r.get("user_email") or "").lower()
        n = nomes.get(str(r.get("user_id") or "")) or nomes.get(em)
        if n:
            return n
        # v88.87: o RD às vezes usa o e-mail PESSOAL (ex.: gmail) e o House o da empresa — casa pelo nome
        local = MX._norm(em.split("@")[0]).replace(" ", "").replace(".", "").replace("_", "")
        return por_nome_colado.get(local) or em or "sem dono"

    turmas, canais, pessoas = {}, {}, {}
    # corretor: só as 3 turmas mais recentes (o retrato de agora, não de meio ano atrás)
    ult3 = sorted({r["mes"] for r in rows})[-3:]
    for r in rows:
        fr = _frente(r.get("pipeline"))
        cat = MX.origem_categoria(r.get("origem") or "", mapa)[0]
        for chave in ((r["mes"], fr), (r["mes"], "todas")):
            _soma(turmas.setdefault(chave, _vazio()), r)
        for chave in ((fr, cat), ("todas", cat)):
            _soma(canais.setdefault(chave, _vazio()), r)
        if r["mes"] in ult3:
            dono = nome_dono(r)
            for chave in ((fr, dono), ("todas", dono)):
                _soma(pessoas.setdefault(chave, _vazio()), r)

    def fim_mes(ym):
        a, b = map(int, ym.split("-"))
        return date(a + (b == 12), 1 if b == 12 else b + 1, 1)

    out_t = []
    for (mes, fr), b in sorted(turmas.items()):
        idade = (hoje - fim_mes(mes)).days   # dias desde que a turma FECHOU a entrada
        out_t.append({"mes": mes, "frente": fr, **_limpa(b),
                      "maduro_30": idade >= 30, "maduro_60": idade >= 60, "maduro_90": idade >= 90})
    out_c = [{"frente": fr, "canal": cat, "canal_label": MX.CAT_LABEL.get(cat, cat), **_limpa(b)}
             for (fr, cat), b in canais.items()]
    out_c.sort(key=lambda x: -x["entraram"])
    out_p = [{"frente": fr, "nome": n, **_limpa(b)} for (fr, n), b in pessoas.items()]
    out_p.sort(key=lambda x: (-x["vendas"], -x["visita"], -x["entraram"]))
    return {"desde": desde.isoformat(), "meses": meses, "turmas_corretor": ult3,
            "frentes": FRENTES, "turmas": out_t, "canais": out_c, "corretores": out_p}


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
            require_user(self, min_lvl=10)   # seção Inteligência = só sócio
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        try:
            meses = max(3, min(12, int(q.get("meses") or 6)))
        except ValueError:
            meses = 6
        hoje = MX.hoje_brt()
        versao = MX.versao_dados(sb)
        key = f"intel_turmas:v2:{meses}:{hoje.isoformat()}"   # v2: sem Carteira MAP Paulo + dono pelo nome
        if not q.get("fresh"):
            c = MX._kv_read(sb, key)
            ts = MX.parse_dt((c or {}).get("_cached_at")) if isinstance(c, dict) else None
            if ts and c.get("versao") == versao and (datetime.now(timezone.utc) - ts).total_seconds() < CACHE_TTL_S:
                return self._send(200, {"ok": True, "cached": True, **c["data"]})
        try:
            data = calcular(sb, meses, hoje)
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"turmas: {str(e)[:200]}"})
        data["calculado_em"] = datetime.now(timezone.utc).isoformat()
        MX._kv_write(sb, key, {"_cached_at": datetime.now(timezone.utc).isoformat(), "versao": versao, "data": data})
        return self._send(200, {"ok": True, "cached": False, **data})
