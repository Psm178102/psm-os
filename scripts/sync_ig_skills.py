#!/usr/bin/env python3
"""
Sincroniza as skills /ig-* (Claude Code, no Mac do Paulo) pra dentro do House.

Fonte da verdade (editar LÁ, nunca no arquivo gerado):
  ~/.claude/instagram/voice.md          cânone de voz e regras da PSM Conquista
  ~/.claude/skills/ig-*/SKILL.md        protocolo de cada skill
  ~/.claude/skills/ig-human/slop.json   léxico anti-robô (PT-BR + EN)
  ~/.claude/skills/ig-reel/hooks.json   26+ fórmulas de gancho
  ~/.claude/skills/ig-profile/rubric.json

Gera: api/v3/marketing/_ig_skills_data.py (módulo Python com tudo embutido —
o runtime da Vercel importa como qualquer _lib, sem depender de arquivo solto).

Uso:  python3 scripts/sync_ig_skills.py         (depois: commit + deploy)
"""
import json
import os
import re
import sys
from datetime import datetime

HOME = os.path.expanduser("~")
SKILLS = os.path.join(HOME, ".claude", "skills")
CANON = os.path.join(HOME, ".claude", "instagram", "voice.md")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3", "marketing", "_ig_skills_data.py")

ORDEM = ["ig-reel", "ig-caption", "ig-carousel", "ig-story", "ig-plan", "ig-repurpose",
         "ig-viral", "ig-audit", "ig-profile", "ig-comment", "ig-reply", "ig-dm", "ig-human"]


def _frontmatter(txt):
    m = re.match(r"^---\n(.*?)\n---\n", txt, re.S)
    if not m:
        return {}, txt
    fm, body = m.group(1), txt[m.end():]
    out = {}
    name = re.search(r"^name:\s*(.+)$", fm, re.M)
    if name:
        out["name"] = name.group(1).strip()
    desc = re.search(r"^description:\s*(>-?\s*\n)?(.*)", fm, re.M | re.S)
    if desc:
        d = desc.group(2)
        d = re.split(r"\n\S[\w-]*:\s", "\n" + d)[0] if not desc.group(1) else d
        out["description"] = " ".join(x.strip() for x in d.strip().splitlines()).strip().strip('"')
    return out, body


def main():
    if not os.path.exists(CANON):
        sys.exit(f"cânone não encontrado: {CANON}")
    data = {"canon": open(CANON, encoding="utf-8").read(), "skills": {}, "json": {}}
    for sid in ORDEM:
        p = os.path.join(SKILLS, sid, "SKILL.md")
        if not os.path.exists(p):
            sys.exit(f"skill ausente: {p}")
        fm, body = _frontmatter(open(p, encoding="utf-8").read())
        data["skills"][sid] = {"name": fm.get("name", sid), "description": fm.get("description", ""), "body": body}
    # Banco de Imagens (resumo por empreendimento) + Banco de Referências — pra SUGESTÃO DE IMAGEM das peças
    base = os.path.join(HOME, ".claude", "instagram")
    bi = open(os.path.join(base, "banco-imagens.md"), encoding="utf-8").read() if os.path.exists(os.path.join(base, "banco-imagens.md")) else ""
    m = re.search(r"(## 1\..*?)(?=\n## 2\.)", bi, re.S)
    data["banco"] = (m.group(1) if m else bi[:15000]).strip()
    rf = os.path.join(base, "referencias.md")
    data["referencias"] = open(rf, encoding="utf-8").read() if os.path.exists(rf) else ""
    for sid, fn in (("ig-human", "slop.json"), ("ig-reel", "hooks.json"), ("ig-profile", "rubric.json")):
        p = os.path.join(SKILLS, sid, fn)
        data["json"][fn] = json.load(open(p, encoding="utf-8"))
    head = ('"""GERADO por scripts/sync_ig_skills.py em ' + datetime.now().strftime("%d/%m/%Y %H:%M") +
            ' — NÃO EDITAR À MÃO.\nFonte: ~/.claude/instagram/voice.md e ~/.claude/skills/ig-*.\n"""\n')
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(head)
        f.write("import json as _json\n\n")
        f.write("_DATA = _json.loads(" + repr(json.dumps(data, ensure_ascii=False)) + ")\n\n")
        f.write("CANON = _DATA['canon']\nSKILLS = _DATA['skills']\nSLOP = _DATA['json']['slop.json']\n"
                "HOOKS = _DATA['json']['hooks.json']\nRUBRIC = _DATA['json']['rubric.json']\n"
                "BANCO = _DATA.get('banco', '')\nREFERENCIAS = _DATA.get('referencias', '')\n")
    kb = os.path.getsize(OUT) // 1024
    print(f"ok: {len(data['skills'])} skills + cânone ({len(data['canon'])} chars) → {os.path.relpath(OUT)} ({kb} KB)")

    # só o cânone pro roteador de chat (api/v3/ia) — os 12 agentes do squad falam com as mesmas regras
    ia_dir = os.path.join(os.path.dirname(OUT), "..", "ia")
    with open(os.path.join(ia_dir, "_ig_canon.py"), "w", encoding="utf-8") as f:
        f.write(head.replace("~/.claude/skills/ig-*", "(só o cânone)"))
        f.write("CANON = " + repr(data["canon"]) + "\n")
    print("ok: cânone → api/v3/ia/_ig_canon.py")

    # anti-robô: os mesmos scripts do Mac viram libs do backend (léxico vem do módulo gerado)
    dest = os.path.dirname(OUT)
    aviso = "# GERADO por scripts/sync_ig_skills.py a partir de ~/.claude/skills/ig-human/{} — NÃO EDITAR À MÃO.\n"
    for src, dst in (("humanize.py", "_ig_humanize.py"), ("detect.py", "_ig_detect.py")):
        code = open(os.path.join(SKILLS, "ig-human", src), encoding="utf-8").read()
        code = re.sub(r"^from humanize import", "from _ig_humanize import", code, flags=re.M)
        code = re.sub(r"^import humanize\b", "import _ig_humanize as humanize", code, flags=re.M)
        if code.startswith("#!"):
            code = code.split("\n", 1)[1]
        with open(os.path.join(dest, dst), "w", encoding="utf-8") as f:
            f.write(aviso.format(src) + code)
        print(f"ok: ig-human/{src} → api/v3/marketing/{dst}")


if __name__ == "__main__":
    main()
