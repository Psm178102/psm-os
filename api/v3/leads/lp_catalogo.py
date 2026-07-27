# -*- coding: utf-8 -*-
"""
GET /api/v3/leads/lp_catalogo — catálogo público da landing psmconquista.com.br. v84.92

Fonte da verdade: a "Tabela de Lançamentos PSM" nativa do House (shared_kv
'tabelas_lancamentos'), marca 'conquista'. O gestor edita a tabela no House
(valores, condições, entra/sai produto) e a LP se atualiza sozinha por aqui.

Endpoint PÚBLICO (vitrine — sem auth), CORS *, cache 5 min.
Parser tolerante a colunas livres: identifica por nome de cabeçalho
(empreendimento/nome, construtora/incorporadora, valor/preço, renda,
entrega/previsão, foto/imagem, obs/condição). Colunas extras vão em `extras`.

Saída:
  { ok, updated_at, count,
    itens: [ { nome, construtora, valor, valor_num, renda, renda_num,
               entrega, foto, obs, extras{...} } ] }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore

KV_KEY = "tabelas_lancamentos"

# mapeamento header normalizado -> campo canônico (primeira coluna que casar vence)
HEADER_MAP = (
    ("nome",        ("empreendimento", "empreend", "produto", "nome")),
    ("construtora", ("construtora", "incorporadora", "inc.", "incorp")),
    ("valor",       ("valor", "preco", "a partir", "apartir")),
    ("renda",       ("renda",)),
    ("entrega",     ("entrega", "previsao", "prev.")),
    ("foto",        ("foto", "imagem", "img", "url foto")),
    ("obs",         ("obs", "observa", "condicao", "condição", "condicoes", "destaque")),
)


def _norm(s):
    s = unicodedata.normalize("NFD", str(s or "").strip().lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _num(txt):
    """Extrai número de 'R$ 209.000,00' / 'R$ 2.000' / '3.500' → int (reais)."""
    t = _norm(txt).replace("r$", "").strip()
    m = re.findall(r"[\d.,]+", t)
    if not m:
        return None
    raw = m[0].replace(".", "").split(",")[0]
    try:
        n = int(raw)
    except Exception:
        return None
    return n if n > 0 else None


def _col_idx(colunas):
    """Descobre o índice de cada campo canônico a partir dos headers livres."""
    idx = {}
    normed = [_norm(c) for c in colunas]
    for campo, keys in HEADER_MAP:
        for i, h in enumerate(normed):
            if campo in idx:
                break
            for k in keys:
                if k in h:
                    idx[campo] = i
                    break
    return idx


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
        try:
            rows = (sb.table("shared_kv").select("value,updated_at")
                    .eq("key", KV_KEY).limit(1).execute().data or [])
            blob = (rows[0].get("value") if rows else None) or {}
            if isinstance(blob, str):
                blob = json.loads(blob or "{}")
            tabelas = blob.get("tabelas") or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)}, cache=False)

        itens, updated = [], None
        for t in tabelas:
            if (t.get("marca") or "") != "conquista":
                continue
            upd = t.get("atualizado_em")
            if upd and (not updated or str(upd) > str(updated)):
                updated = upd
            colunas = t.get("colunas") or []
            idx = _col_idx(colunas)
            if "nome" not in idx:
                continue
            for linha in (t.get("linhas") or []):
                def cell(campo):
                    i = idx.get(campo)
                    return (str(linha[i]).strip()
                            if i is not None and i < len(linha) and linha[i] is not None
                            else "")
                nome = cell("nome")
                if not nome:
                    continue
                usados = set(idx.values())
                extras = {colunas[i]: str(linha[i]).strip()
                          for i in range(min(len(colunas), len(linha)))
                          if i not in usados and str(linha[i] or "").strip()}
                itens.append({
                    "nome": nome,
                    "construtora": cell("construtora"),
                    "valor": cell("valor"),
                    "valor_num": _num(cell("valor")),
                    "renda": cell("renda"),
                    "renda_num": _num(cell("renda")),
                    "entrega": cell("entrega"),
                    "foto": cell("foto"),
                    "obs": cell("obs"),
                    "extras": extras,
                })
        return self._send(200, {"ok": True, "updated_at": updated,
                                "count": len(itens), "itens": itens})
