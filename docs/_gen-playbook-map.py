# -*- coding: utf-8 -*-
"""Gera api/v3/scripts/_seed_map.py a partir de docs/playbook-map/NN-<id>.txt (v89.43).

Cada arquivo é uma etapa do "O que falar" do M.A.P no formato v2 (etapa → momento →
mensagem pronta; a sintaxe está no topo de v2/js/pages/playbook-render.js). A 1ª linha
é "NOME: <nome da etapa>"; o resto é o conteúdo. A ordem dos arquivos é a ordem na tela.

Para republicar depois de editar os .txt: suba REV em 1 e rode
    python3 docs/_gen-playbook-map.py
O playbook.py troca as etapas do M.A.P salvas no banco quando a REV do código é maior
que a gravada — então editar pela tela continua valendo até a próxima REV.
"""
import glob, json, os

REV = 2
AQUI = os.path.dirname(os.path.abspath(__file__))
etapas = []
for i, p in enumerate(sorted(glob.glob(os.path.join(AQUI, "playbook-map", "*.txt")))):
    txt = open(p, encoding="utf-8").read()
    cab, _, corpo = txt.partition("\n")
    assert cab.startswith("NOME: "), p
    etapas.append({"id": os.path.basename(p)[3:-4], "nome": cab[6:].strip(), "ordem": i,
                   "conteudo": corpo.strip() + "\n"})
dst = os.path.join(AQUI, "..", "api", "v3", "scripts", "_seed_map.py")
with open(dst, "w", encoding="utf-8") as f:
    f.write('"""M.A.P · O que falar — formato v2 (etapa → momento → mensagem). GERADO por docs/_gen-playbook-map.py; não edite à mão."""\n')
    f.write("import json\n")
    f.write("MAP_V2 = json.loads(r'''" + json.dumps({"rev": REV, "etapas": etapas}, ensure_ascii=False) + "''')\n")
print(len(etapas), "etapas ·", sum(len(e["conteudo"]) for e in etapas), "caracteres →", os.path.normpath(dst))
