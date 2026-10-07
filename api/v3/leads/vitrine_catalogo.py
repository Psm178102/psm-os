# -*- coding: utf-8 -*-
"""
GET /api/v3/leads/vitrine_catalogo — catálogo público da vitrine psmempreendimentos.com.br.

Fonte da verdade: a "Tabela de Lançamentos PSM" do House (shared_kv
'tabelas_lancamentos'), marca 'imoveis' (tabela MAP). O gestor edita a tabela
no House e a vitrine se atualiza sozinha por aqui.

Endpoint PÚBLICO (vitrine — sem auth), CORS *, cache 5 min.
Diferente do lp_catalogo (Conquista), aqui a saída é LISTA FECHADA de campos:
coluna que não está no HEADER_MAP não sai (Link Drive e afins são internos).
Loteamentos ficam fora por padrão (?loteamentos=1 inclui).

Saída:
  { ok, updated_at, count, faixas: [ {id, label, count} ],
    itens: [ { nome, incorporadora, categoria, m2, valor, valor_num, faixa,
               entrega, status, dorms, suites, vagas, regiao,
               condicao, fluxo, ato } ] }
  status: pronto | entrega_proxima (≤12 meses) | em_obras | pre_lancamento | ""
  espelhos: [ { nome, vigencia, unidades: [ {unidade, andar, m2, vagas, status, valor, valor_num} ] } ]
    — tabelas de categoria "<EMPREENDIMENTO> · ESPELHO ..." (uma linha por unidade).
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import date
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
from lp_catalogo import _norm, _num, KV_KEY  # type: ignore

MARCA = "imoveis"

# header normalizado (sem acento e sem espaço) -> campo; primeira coluna que casar vence
HEADER_MAP = (
    ("nome",         ("empreendimento", "loteamentos", "produto", "nome")),
    ("incorporadora", ("incorporador", "construtora")),
    ("m2",           ("m²", "m2", "metragem")),
    ("valor",        ("valor", "preco")),
    ("entrega",      ("entrega", "expectativa", "previsao")),
    ("dorms",        ("dorms", "dormitorio")),
    ("suites",       ("suite",)),
    ("vagas",        ("vaga",)),
    ("regiao",       ("localiza", "regiao", "bairro")),
    ("condicao",     ("condicao", "comercial")),
    ("fluxo",        ("fluxo",)),
    ("ato",          ("ato",)),
)

# (id, label, teto exclusivo em R$) — a última não tem teto
FAIXAS = (
    ("ate_400",   "Até R$ 400 mil",          400_000),
    ("400_600",   "R$ 400 a 600 mil",        600_000),
    ("600_800",   "R$ 600 a 800 mil",        800_000),
    ("800_1mi",   "R$ 800 mil a 1 milhão", 1_000_000),
    ("acima_1mi", "Acima de R$ 1 milhão",        None),
)

RE_ENTREGA = re.compile(r"(\d{1,2})\s*/\s*(\d{4}|\d{2})")


def _hkey(s):
    return re.sub(r"\s+", "", _norm(s))


def _col_idx(colunas):
    idx, usados = {}, set()
    normed = [_hkey(c) for c in colunas]
    for campo, keys in HEADER_MAP:
        for i, h in enumerate(normed):
            # "PRAZO DE FLUXO" é prazo em meses, não o fluxo 30/70
            if i in usados or (campo == "fluxo" and "prazo" in h):
                continue
            if any(k in h for k in keys):
                idx[campo] = i
                usados.add(i)
                break
    return idx


def _faixa(valor_num):
    if not valor_num:
        return ""
    for fid, _lbl, teto in FAIXAS:
        if teto is None or valor_num < teto:
            return fid
    return ""


def _status(entrega, categoria, hoje):
    e, c = _norm(entrega), _norm(categoria)
    if "pre lanc" in c or "pre-lanc" in c:
        return "pre_lancamento"
    if "entregue" in e or "pronto" in e or "pronto" in c:
        return "pronto"
    m = RE_ENTREGA.search(e)
    if not m:
        return ""
    mes, ano = int(m.group(1)), int(m.group(2))
    if ano < 100:
        ano += 2000
    if not 1 <= mes <= 12:
        return ""
    meses = (ano - hoje.year) * 12 + (mes - hoje.month)
    # data vencida não garante chave na mão (tolerância de obra): só "ENTREGUE" vira pronto
    return "entrega_proxima" if meses <= 12 else "em_obras"


def montar(tabelas, hoje=None, loteamentos=False):
    """tabelas do shared_kv → (itens, updated_at). Puro, sem I/O (testável)."""
    hoje = hoje or date.today()
    itens, updated = [], None
    for t in sorted(tabelas, key=lambda x: x.get("ordem") or 0):
        if (t.get("marca") or "") != MARCA:
            continue
        categoria = str(t.get("categoria") or "").strip()
        if not loteamentos and "loteamento" in _norm(categoria):
            continue
        upd = t.get("atualizado_em")
        if upd and (not updated or str(upd) > str(updated)):
            updated = upd
        idx = _col_idx(t.get("colunas") or [])
        if "nome" not in idx:
            continue
        for linha in (t.get("linhas") or []):
            def cell(campo):
                i = idx.get(campo)
                return (str(linha[i]).strip()
                        if i is not None and i < len(linha) and linha[i] is not None
                        else "")
            nome = cell("nome")
            if not nome or nome.lower().startswith("http"):
                continue
            valor_num = _num(cell("valor"))
            itens.append({
                "nome": nome,
                "incorporadora": cell("incorporadora"),
                "categoria": categoria,
                "m2": cell("m2"),
                "valor": cell("valor"),
                "valor_num": valor_num,
                "faixa": _faixa(valor_num),
                "entrega": cell("entrega"),
                "status": _status(cell("entrega"), categoria, hoje),
                "dorms": cell("dorms"),
                "suites": cell("suites"),
                "vagas": cell("vagas"),
                "regiao": cell("regiao"),
                "condicao": cell("condicao"),
                "fluxo": cell("fluxo"),
                "ato": cell("ato"),
            })
    return itens, updated


# espelho de unidades: header normalizado -> campo (lista fechada, como o HEADER_MAP)
ESPELHO_MAP = (
    ("unidade", ("unidade",)),
    ("andar",   ("andar",)),
    ("m2",      ("area", "m²", "m2", "metragem")),
    ("vagas",   ("vaga",)),
    ("status",  ("status", "situacao")),
    ("valor",   ("valordaunidade", "valor", "preco")),
)


def espelhos(tabelas):
    """Tabelas "<EMPREENDIMENTO> · ESPELHO ..." da marca → lista por empreendimento. Puro."""
    out = []
    for t in sorted(tabelas, key=lambda x: x.get("ordem") or 0):
        categoria = str(t.get("categoria") or "").strip()
        if (t.get("marca") or "") != MARCA or "espelho" not in _norm(categoria):
            continue
        normed = [_hkey(c) for c in (t.get("colunas") or [])]
        idx = {}
        for campo, keys in ESPELHO_MAP:
            for i, h in enumerate(normed):
                # "R$/M²" é preço por metro, não a área nem o valor da unidade
                if i in idx.values() or "r$" in h:
                    continue
                if any(k in h for k in keys):
                    idx[campo] = i
                    break
        if "unidade" not in idx:
            continue
        unidades = []
        for linha in (t.get("linhas") or []):
            u = {campo: (str(linha[i]).strip() if i < len(linha) and linha[i] is not None else "")
                 for campo, i in idx.items()}
            if not u.get("unidade"):
                continue
            u["valor_num"] = _num(u.get("valor") or "")
            unidades.append(u)
        if unidades:
            out.append({"nome": re.split(r"\s+[·\-–—|]\s+", categoria)[0].strip(),
                        "vigencia": str(t.get("vigencia") or ""), "unidades": unidades})
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b, cache=True):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control",
                         "public, max-age=300" if cache else "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"}, cache=False)
        qs = parse_qs(urlparse(self.path).query)
        try:
            rows = (sb.table("shared_kv").select("value,updated_at")
                    .eq("key", KV_KEY).limit(1).execute().data or [])
            blob = (rows[0].get("value") if rows else None) or {}
            if isinstance(blob, str):
                blob = json.loads(blob or "{}")
            tabelas = blob.get("tabelas") or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)}, cache=False)

        itens, updated = montar(tabelas, loteamentos=qs.get("loteamentos") == ["1"])
        faixas = [{"id": fid, "label": lbl,
                   "count": sum(1 for i in itens if i["faixa"] == fid)}
                  for fid, lbl, _teto in FAIXAS]
        return self._send(200, {"ok": True, "updated_at": updated,
                                "count": len(itens), "faixas": faixas, "itens": itens,
                                "espelhos": espelhos(tabelas)})
