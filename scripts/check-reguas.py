#!/usr/bin/env python3
"""
check-reguas.py — guarda-corpo da RÉGUA DO FUNIL. v87.59 (auditoria 08/set)

A Vercel empacota cada pasta de api/v3/* isolada, então `_oo_lib.py` é COPIADO
em vez de importado. Em algum ponto as cópias divergiram: a de api/v3/intel/
ficou na versão anterior à v86.65, com `realizad` (fazia "CONTATO REALIZADO"
virar VISITA) e `cont` (casava em CONTRATO e em "Construtores"). Resultado:
Sales Brain, briefing diário e fila do dia contavam visita e contato diferente
da Gestão Comercial e do 1:1 — o mesmo deal, dois marcos.

Este script quebra se as cópias divergirem de novo. Roda sozinho:
    python3 scripts/check-reguas.py

Sai 0 se tudo bate, 1 se divergiu (com o diff na tela).
"""
import re
import sys
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (arquivo, nome do bloco) — todos têm que casar com o primeiro da lista
ESPELHOS = [
    ("api/v3/oo/_oo_lib.py", "_MS_RE"),
    ("api/v3/intel/_oo_lib.py", "_MS_RE"),
]

RX_BLOCO = re.compile(r"^_MS_RE = \[(.*?)^\]", re.S | re.M)


def regras(caminho):
    """Lista de (marco, regex) do bloco, sem comentários nem espaçamento."""
    with open(os.path.join(RAIZ, caminho), encoding="utf-8") as f:
        src = f.read()
    m = RX_BLOCO.search(src)
    if not m:
        raise SystemExit(f"✗ {caminho}: bloco _MS_RE não encontrado")
    out = []
    for linha in m.group(1).splitlines():
        linha = linha.strip()
        if not linha.startswith("("):
            continue                      # comentário ou linha em branco
        linha = re.sub(r"\s*#.*$", "", linha)   # comentário no fim da linha
        out.append(linha.rstrip(","))
    return out


def main():
    base_arq, _ = ESPELHOS[0]
    base = regras(base_arq)
    if not base:
        raise SystemExit(f"✗ {base_arq}: bloco _MS_RE vazio")

    problemas = []
    for caminho, _nome in ESPELHOS[1:]:
        atual = regras(caminho)
        if atual != base:
            problemas.append((caminho, atual))

    if not problemas:
        print(f"✓ régua do funil idêntica em {len(ESPELHOS)} cópias ({len(base)} marcos)")
        return 0

    print("✗ RÉGUA DO FUNIL DIVERGIU — o mesmo deal vai receber marcos diferentes")
    print(f"\n  referência: {base_arq}")
    for r in base:
        print(f"    {r}")
    for caminho, atual in problemas:
        print(f"\n  divergente: {caminho}")
        for r in atual:
            marca = " " if r in base else "←"
            print(f"    {r} {marca}")
    print("\n  Corrija copiando o bloco da referência. Se a mudança for proposital,")
    print("  aplique nas DUAS cópias — nunca em uma só.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
