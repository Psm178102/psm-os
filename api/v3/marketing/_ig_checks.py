"""
Anti-robô da PSM Conquista no backend (v88.60) — casca fina sobre os MESMOS
scripts da skill /ig-human do Claude Code (copiados por scripts/sync_ig_skills.py
como _ig_humanize.py e _ig_detect.py). O léxico vem de _ig_skills_data.SLOP.

checar(texto) → {score, veredito, idioma, checks{}, bloqueios[], avisos[]}
  bloqueios = regra da marca nível BLOQUEIA (Sol que "viveu", promessa proibida,
              "Não é X. É Y.", travessão em texto curto...) → peça não sobe.
  avisos    = VERIFICAR (R$ sem disclaimer, prazo sem "em média"...).
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _ig_skills_data as IG  # type: ignore
from _ig_detect import run  # type: ignore
from _ig_humanize import _for_lang  # type: ignore

# blocos de metadado da entrega (AUDITORIA/PENDÊNCIAS) citam regra, não são texto público
_META = re.compile(r"^\s*(?:\*\*)?(AUDITORIA|PEND[ÊE]NCIAS|CHECKLIST|NOTAS? INTERNAS?)\b.*$", re.I | re.M)


def _limpo(texto):
    """Tira o bloco de metadado (do cabeçalho AUDITORIA/PENDÊNCIAS até a próxima linha em branco)."""
    out, pulando = [], False
    for ln in (texto or "").splitlines():
        if _META.match(ln):
            pulando = True
            continue
        if pulando and not ln.strip():
            pulando = False
        if not pulando:
            out.append(ln)
    return "\n".join(out)


def _fmt(h):
    trecho = (h.get("trechos") or [""])[0]
    return f"{h.get('name')}" + (f" — “{trecho.strip()}”" if trecho else "") + (f" → {h.get('fix')}" if h.get("fix") else "")


def checar(texto):
    texto = _limpo(texto)
    if not texto.strip():
        return {"score": None, "veredito": "VAZIO", "bloqueios": [], "avisos": []}
    results, overall, verdict, lang, brand = run(texto, IG.SLOP)
    checks = {nome: round(float(r[0] if isinstance(r, (list, tuple)) else r), 1) for nome, r in results.items()}
    bloqueios = [_fmt(h) for h in brand if h.get("nivel") == "BLOQUEIA"]
    avisos = [_fmt(h) for h in brand if h.get("nivel") != "BLOQUEIA"]
    # estruturas de IA: "Não é X. É Y." e família (prioridade ZERO) reprovam direto (lei do Auditor);
    # as demais viram aviso pro autor reescrever
    for s in _for_lang(IG.SLOP.get("structures") or [], lang):
        try:
            achados = list(re.finditer(s["regex"], texto, re.MULTILINE))
        except re.error:
            continue
        if not achados:
            continue
        m = achados[0]
        trecho = texto[max(0, m.start() - 10): m.end() + 10].replace("\n", " ").strip()
        linha = f"{s.get('name', s.get('id'))} — “{trecho}”" + (f" → {s['fix']}" if s.get("fix") else "")
        (bloqueios if s.get("prioridade") == "ZERO" else avisos).append(linha)
    return {"score": round(float(overall), 1), "veredito": verdict, "idioma": lang,
            "checks": checks, "bloqueios": bloqueios[:20], "avisos": avisos[:20]}
