# GERADO por scripts/sync_ig_skills.py a partir de ~/.claude/skills/ig-human/detect.py — NÃO EDITAR À MÃO.
"""
detect.py - painel de 5 checagens que mede o quanto um rascunho parece
escrito por máquina (PT-BR e inglês), mais a CAMADA CONQUISTA.
Versão PSM CONQUISTA (27/09/2026). Cânone: ~/.claude/instagram/voice.md

O que é: cinco heurísticas locais baseadas nos sinais que os detectores
públicos medem - variação de tamanho de frase, concretude, vocabulário de
clichê, impressão digital tipográfica e voz. Tudo roda na máquina, a partir
do texto. Nada é enviado.

O que NÃO é: GPTZero, Originality, Copyleaks, Winston ou Turnitin. Não chama
essas APIs e não promete o veredito delas. Pega o que todos medem, por isso
corrigir aqui costuma mexer lá - mas a única afirmação honesta é esta linha.

E NÃO aprova peça: é a metade automática do item "originalidade sem vício de
IA" do auditor-mkt-psm. Quem dá nota é o auditor (corte 8).

Cada checagem devolve nota HUMANA de 0 a 100. Maior é melhor.
Idioma detectado por stopwords (ou --lang). Em PT a VOZ premia marcas de fala
("pra", "tá", "a gente", "né", "você") e a ESPECIFICIDADE conta R$, %,
números, siglas (CAIXA, FGTS, MCMV) e bairros de Rio Preto.

Uso
  python3 ~/.claude/skills/ig-human/detect.py rascunho.txt
  pbpaste | python3 ~/.claude/skills/ig-human/detect.py -
  python3 ~/.claude/skills/ig-human/detect.py rascunho.txt --json
  python3 ~/.claude/skills/ig-human/detect.py antes.txt depois.txt   # antes/depois

Saída: 0 = LIMPO; 1 = REVISAR/SINALIZADO; 2 = BLOQUEADO (Camada Conquista).
"""

import argparse
import json
import os
import re
import statistics
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _ig_humanize import (LEX, brand_checks, detect_lang, load_lexicon, nfc,  # noqa: E402
                      _for_lang, _phrase_re)

SENT_RE = re.compile(r"(?:[^.!?\n]|(?<=\d)[.,](?=\d))+[.!?]*")  # "R$ 1.100" não quebra frase
WORD_RE = re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)*")

# Inglês (comportamento original)
CONTRACTIONS = re.compile(r"\b\w+'(?:s|t|re|ve|ll|d|m)\b", re.IGNORECASE)
PRONOUNS_EN = re.compile(r"\b(i|me|my|mine|we|us|our|you|your)\b", re.IGNORECASE)
NUMBERS_EN = re.compile(r"\b\d[\d,.]*%?\b|\$\d")

# Português
COLLOQUIAL_PT = re.compile(
    r"(?<!\w)(?:pra|pro|pras|pros|tá|tô|tamo|tão\s+assim|né|cê|vc|a\s+gente|bora|olha\s+só|"
    r"presta\s+atenção|o\s+negócio\s+é\s+o\s+seguinte|beleza|daí|aí|dá\s+pra|tipo\s+assim)(?!\w)",
    re.IGNORECASE)
PERSON_PT = re.compile(
    r"(?<!\w)(?:eu|me|meu|minha|meus|minhas|comigo|você|vocês|cê|te|contigo|seu|sua|seus|suas|"
    r"a\s+gente|nós|nosso|nossa|nossos|nossas)(?!\w)", re.IGNORECASE)
NUMBERS_PT = re.compile(r"R\$\s?\d[\d.,]*(?:\s?mil)?|\d[\d.,]*\s?%|\b\d[\d.,]*\b")
ACRONYM = re.compile(r"\b[A-ZÀ-Ý]{2,}\b")
PROPER = re.compile(r"(?<![.!?]\s)(?<!^)\b[A-ZÀ-Ý][a-zà-ÿ]{2,}\b", re.MULTILINE)


def clamp(n):
    return max(0.0, min(100.0, n))


def scale(value, human, machine):
    if human == machine:
        return 50.0
    return clamp((value - machine) / (human - machine) * 100)


def sentences(text):
    return [s.strip() for s in SENT_RE.findall(text) if len(s.split()) > 2]


def words(text):
    return WORD_RE.findall(text)


def check_burstiness(text):
    lens = [len(s.split()) for s in sentences(text)]
    if len(lens) < 4:
        return 50.0, "curto demais pra julgar"
    mean = statistics.mean(lens)
    cv = statistics.pstdev(lens) / mean if mean else 0
    score = scale(cv, human=0.70, machine=0.22)
    return score, f"variação {cv:.2f} em {len(lens)} frases (ideal 0,55+)"


def check_specificity(text, lang, lex):
    w = words(text)
    if len(w) < 25:
        return 50.0, "curto demais pra julgar"
    per100 = 100 / len(w)
    if lang == "pt":
        nums = NUMBERS_PT.findall(text)
        acr = {a for a in ACRONYM.findall(text) if a not in {"EU", "OK"}}
        proper = set(PROPER.findall(text))
        bairros = [b for b in lex.get("bairros", [])
                   if _phrase_re(b).search(text)]
        # Bairro/cidade conta em dobro: alcance LOCAL é a meta da casa.
        hits = len(nums) + len(acr) + len(proper) + len(bairros)
        density = hits * per100
        detail = (f"{len(nums)} número(s)/R$/%, {len(acr)} sigla(s), {len(proper)} nome(s) próprio(s), "
                  f"{len(bairros)} bairro/cidade; {density:.1f} por 100 palavras (ideal 4+)")
    else:
        hits = len(NUMBERS_EN.findall(text)) + len(set(PROPER.findall(text)))
        density = hits * per100
        detail = f"{hits} marcadores concretos, {density:.1f} por 100 palavras (ideal 4+)"
    score = scale(density, human=6.0, machine=0.5)
    return score, detail


def check_slop(text, lex, lang):
    w = words(text)
    if not w:
        return 50.0, "vazio"
    hits, found = 0, []
    for entry in _for_lang(lex["words"] + lex["phrases"], lang):
        n = len(_phrase_re(entry["find"]).findall(text))
        if n:
            hits += n
            found.append(entry["find"])
    density = hits * 100 / len(w)
    score = scale(density, human=0.0, machine=4.0)
    detail = f"{hits} clichê(s), {density:.1f} por 100 palavras"
    if found:
        detail += " (" + ", ".join(sorted(found)[:4]) + (", ..." if len(found) > 4 else "") + ")"
    return score, detail


def check_fingerprint(text):
    invisible = sum(1 for c in text if unicodedata.category(c) == "Cf")
    em = text.count("—")
    curly = sum(text.count(c) for c in "‘’“”")
    ellip = text.count("…")
    nbsp = sum(text.count(c) for c in "   ")
    total = invisible * 4 + em * 2 + curly + ellip + nbsp
    per1k = total * 1000 / max(len(text), 1)
    score = scale(per1k, human=0.0, machine=12.0)
    detail = (f"{invisible} invisível, {em} travessão, {curly} aspas curvas, "
              f"{ellip} reticência tipográfica, {nbsp} espaço duro")
    return score, detail


def _structural_tells(text, lex, lang):
    tells, names = 0, []
    for s in _for_lang(lex["structures"], lang):
        try:
            n = len(re.compile(s["regex"], re.MULTILINE).findall(text))
        except re.error:
            continue
        if n:
            # "Não é X. É Y." e família pesam em dobro (prioridade zero da casa).
            tells += n * (2 if s.get("prioridade") == "ZERO" else 1)
            names.append(s["id"])
    return tells, names


def check_voice(text, lex, lang):
    w = words(text)
    if len(w) < 25:
        return 50.0, "curto demais pra julgar"
    per100 = 100 / len(w)
    tells, names = _structural_tells(text, lex, lang)
    bullets = [len(b.split()) for b in re.findall(r"(?m)^\s*[-*•]\s+(.+)$", text)]
    uniform = (len(bullets) >= 3 and statistics.pstdev(bullets) < 1.6)
    if lang == "pt":
        coloq = len(COLLOQUIAL_PT.findall(text)) * per100
        person = len(PERSON_PT.findall(text)) * per100
        score = (scale(coloq, human=2.5, machine=0.0) * 0.35
                 + scale(person, human=6.0, machine=1.0) * 0.35
                 + clamp(100 - tells * 22) * 0.30)
        detail = (f"{coloq:.1f} marcas de fala (pra/tá/a gente/né), {person:.1f} de 1ª/2ª pessoa "
                  f"por 100 palavras, {tells} ponto(s) de estrutura de IA")
    else:
        contractions = len(CONTRACTIONS.findall(text)) * per100
        person = len(PRONOUNS_EN.findall(text)) * per100
        score = (scale(contractions, human=3.0, machine=0.0) * 0.35
                 + scale(person, human=8.0, machine=1.0) * 0.35
                 + clamp(100 - tells * 22) * 0.30)
        detail = (f"{contractions:.1f} contractions, {person:.1f} personal pronouns "
                  f"per 100 words, {tells} structural tell(s)")
    if uniform:
        score -= 12
        names.append("bullets-iguais")
    if names:
        detail += " [" + ", ".join(names[:4]) + ("..." if len(names) > 4 else "") + "]"
    return clamp(score), detail


CHECKS = ["RITMO", "ESPECIFICIDADE", "CLICHÊ", "DIGITAL", "VOZ"]
LEGENDA = {"RITMO": "burstiness", "ESPECIFICIDADE": "specificity", "CLICHÊ": "slop density",
           "DIGITAL": "fingerprint", "VOZ": "voice"}


def run(text, lex, lang=None, marca=None):
    text = nfc(text)
    lang = lang or detect_lang(text, lex)
    results = {
        "RITMO": check_burstiness(text),
        "ESPECIFICIDADE": check_specificity(text, lang, lex),
        "CLICHÊ": check_slop(text, lex, lang),
        "DIGITAL": check_fingerprint(text),
        "VOZ": check_voice(text, lex, lang),
    }
    scores = [results[c][0] for c in CHECKS]
    overall = statistics.mean(scores) * 0.6 + min(scores) * 0.4
    verdict = "LIMPO" if overall >= 70 and min(scores) >= 55 else (
        "REVISAR" if overall >= 50 else "SINALIZADO")
    run_brand = (lang == "pt") if marca is None else marca
    brand = brand_checks(text, lex) if run_brand else []
    if any(h["nivel"] == "BLOQUEIA" for h in brand):
        verdict = "BLOQUEADO"
    return results, overall, verdict, lang, brand


def bar(score, width=24):
    filled = round(score / 100 * width)
    return "#" * filled + "." * (width - filled)


def render(results, overall, verdict, lang, brand, label=None, out=sys.stdout):
    title = f"PAINEL ANTI-ROBÔ ({lang})" + (f"  -  {label}" if label else "")
    print("\n" + title, file=out)
    print("=" * max(len(title), 66), file=out)
    for name in CHECKS:
        score, detail = results[name]
        print(f"  {name:<15} {bar(score)} {score:5.1f}", file=out)
        print(f"  {'':<15} {detail}", file=out)
    print("-" * 66, file=out)
    print(f"  {'NOTA HUMANA':<15} {bar(overall)} {overall:5.1f}   {verdict}", file=out)
    if brand or lang == "pt":
        print("\n  CAMADA CONQUISTA", file=out)
        if not brand:
            print("    nada encontrado", file=out)
        for h in brand:
            print(f"    [{h['nivel']}] {h['count']}x {h['name']}", file=out)
            for t in h["trechos"][:1]:
                print(f"        > {t}", file=out)
    if verdict == "BLOQUEADO":
        print("\n  BLOQUEADO pela Camada Conquista: reescreva antes de entregar "
              "(rode humanize.py --report pra ver o conserto de cada regra).", file=out)
    elif verdict != "LIMPO":
        weakest = min(CHECKS, key=lambda c: results[c][0])
        print(f"\n  Sinal mais fraco: {weakest} ({LEGENDA[weakest]}). Corrija esse primeiro.", file=out)
    print("  Lembrete: LIMPO aqui não é aprovação. A nota é do auditor-mkt-psm (corte 8).\n", file=out)


def main():
    ap = argparse.ArgumentParser(description="Mede o quanto um rascunho parece de máquina (PT-BR/EN).")
    ap.add_argument("input", nargs="?", default="-", help="arquivo, ou - para stdin")
    ap.add_argument("compare", nargs="?", help="segundo arquivo, pra antes/depois")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--lang", choices=["pt", "en"], help="força o idioma (padrão: detecta)")
    ap.add_argument("--marca", dest="marca", action="store_true", default=None,
                    help="força a Camada Conquista mesmo em texto em inglês")
    ap.add_argument("--sem-marca", dest="marca", action="store_false")
    ap.add_argument("--lexicon", default=LEX)
    args = ap.parse_args()

    lex = load_lexicon(args.lexicon)
    read = lambda p: sys.stdin.read() if p == "-" else open(p, encoding="utf-8").read()

    targets = [(args.input, read(args.input))]
    if args.compare:
        targets.append((args.compare, read(args.compare)))

    payload, runs = [], []
    for name, text in targets:
        results, overall, verdict, lang, brand = run(text, lex, args.lang, args.marca)
        runs.append((results, overall, verdict, lang, brand))
        payload.append({
            "source": name, "lang": lang,
            "checks": {k: {"score": round(v[0], 1), "detail": v[1]} for k, v in results.items()},
            "human_score": round(overall, 1),
            "verdict": verdict,
            "marca": brand,
        })

    if args.json:
        print(json.dumps(payload if args.compare else payload[0], indent=2, ensure_ascii=False))
    else:
        for (name, _), r in zip(targets, runs):
            render(*r, label=os.path.basename(name) if args.compare else None)
        if args.compare:
            a, b = payload
            delta = b["human_score"] - a["human_score"]
            print(f"  {a['human_score']:.1f} {a['verdict']}  ->  "
                  f"{b['human_score']:.1f} {b['verdict']}   ({delta:+.1f})\n")

    last = payload[-1]["verdict"]
    sys.exit(0 if last == "LIMPO" else (2 if last == "BLOQUEADO" else 1))


if __name__ == "__main__":
    main()
