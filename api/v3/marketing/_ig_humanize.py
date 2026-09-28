# GERADO por scripts/sync_ig_skills.py a partir de ~/.claude/skills/ig-human/humanize.py — NÃO EDITAR À MÃO.
"""
humanize.py - tira a cara de máquina de um rascunho (PT-BR e inglês).
Versão PSM CONQUISTA (27/09/2026). Cânone: ~/.claude/instagram/voice.md

Passes, nesta ordem:

  0. MARCA       (só leitura) roda a CAMADA CONQUISTA no texto ORIGINAL:
                 Sol com experiência vivida, promessa proibida, escassez
                 fabricada, exclusividade, tom coach, R$/% sem disclaimer,
                 travessão em texto curto. BLOQUEIA = reescrever antes de
                 entregar. VERIFICAR = conferir fonte/Paulo.
  1. INVISÍVEIS  apaga caracteres que teclado nenhum produz (zero-width,
                 word joiner, soft hyphen, BOM, tags Unicode, espaços duros).
  2. TIPOGRAFIA  travessão -> vírgula, meia-risca -> hífen, aspas curvas ->
                 retas, reticências -> três pontos, bullet -> hífen.
  3. LÉXICO      troca o clichê de slop.json por palavra simples, preservando
                 maiúscula e sem mexer em URL. Só aplica as entradas do idioma
                 detectado (pt/en). Entradas action=flag só sinalizam.

Estruturas ("Não é X. É Y.", tríades, revelação retórica, isca de
engajamento) são SINALIZADAS, nunca reescritas: mudar a forma da frase pede
julgamento, e isso é trabalho do modelo, não de regex.

Uso
  python3 ~/.claude/skills/ig-human/humanize.py rascunho.txt --report
  pbpaste | python3 ~/.claude/skills/ig-human/humanize.py - --report
  python3 ~/.claude/skills/ig-human/humanize.py rascunho.txt -o limpo.txt --report
  python3 ~/.claude/skills/ig-human/humanize.py rascunho.txt --json
  python3 ~/.claude/skills/ig-human/humanize.py rascunho.txt --lang pt
  python3 ~/.claude/skills/ig-human/humanize.py rascunho.txt --so-marca   # só a Camada Conquista

Saída: código 2 se a Camada Conquista tiver BLOQUEIA; 0 caso contrário.
"""

import argparse
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
LEX = os.path.join(HERE, "slop.json")

URL_RE = re.compile(r"https?://\S+|www\.\S+|\S+@\S+\.\S+")
SENT_RE = re.compile(r"(?:[^.!?\n]|(?<=\d)[.,](?=\d))+[.!?]*")  # "R$ 1.100" não quebra frase
TOKEN_RE = re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)?")
ADJ_GONE = "\x01"            # marca interna de adjetivo apagado
SHORT_TEXT = 2200            # legenda de Instagram; "texto curto" pra regra do travessão
# Depois destas palavras o adjetivo é predicativo ("é incrível") e apagar quebra a frase.
PREDICATIVE_BEFORE = {"é", "são", "foi", "era", "ficou", "fica", "está", "tá", "estão",
                      "muito", "muita", "tão", "mais", "super", "bem", "menos", "seja",
                      "será", "parece", "ser", "estar", "sou", "somos", "fui", "bastante"}


def load_lexicon(path=LEX):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def nfc(text):
    """Acento decomposto (comum em texto colado do Mac) vira um caractere só."""
    return unicodedata.normalize("NFC", text)


def detect_lang(text, lex):
    """'pt' ou 'en' pela contagem de stopwords. Empate com acento -> pt."""
    toks = [t.lower() for t in TOKEN_RE.findall(text)]
    sw = lex.get("stopwords", {})
    pt = sum(1 for t in toks if t in set(sw.get("pt", [])))
    en = sum(1 for t in toks if t in set(sw.get("en", [])))
    if en > pt:
        return "en"
    if pt > en:
        return "pt"
    return "pt" if re.search(r"[ãõçáéíóúâêô]", text.lower()) else "en"


def _for_lang(entries, lang):
    return [e for e in entries if e.get("lang", "en") in (lang, "any")]


def _cp(spec):
    if "-" in spec:
        a, b = spec.split("-")
        return (int(a[2:], 16), int(b[2:], 16))
    return int(spec[2:], 16)


def _phrase_re(find):
    return re.compile(r"(?<!\w)" + re.escape(find).replace(r"\ ", r"\s+") + r"(?!\w)",
                      re.IGNORECASE)


def protect_urls(text):
    found = []

    def stash(m):
        found.append(m.group(0))
        return f"\x00URL{len(found) - 1}\x00"

    return URL_RE.sub(stash, text), found


def restore_urls(text, found):
    for i, url in enumerate(found):
        text = text.replace(f"\x00URL{i}\x00", url)
    return text


# ---------------------------------------------------------------- CAMADA CONQUISTA
def _excerpt(text, start, end, pad=30):
    a, b = max(0, start - pad), min(len(text), end + pad)
    s = text[a:b].replace("\n", " ")
    return ("..." if a else "") + s.strip() + ("..." if b < len(text) else "")


def brand_checks(text, lex=None):
    """Regras da marca PSM CONQUISTA. Roda no texto original (antes da limpeza).

    Devolve lista de {id, nivel, name, count, trechos, fix}.
    nivel BLOQUEIA = reescrever antes de entregar; VERIFICAR = conferir.
    """
    lex = lex or load_lexicon()
    text = nfc(text)
    hits = []
    # Fala de CLIENTE entre aspas ("Posso usar meu FGTS?") não é a Sol contando a própria vida:
    # regras marcadas com ignora_citacao pulam o que está dentro de aspas (Paulo, 27/09/2026).
    citacoes = [(q.start(), q.end()) for q in re.finditer(r'"[^"\n]{1,300}"|“[^”\n]{1,300}”', text)]
    for m in lex.get("marca", []):
        pat = re.compile(m["regex"])
        near = re.compile(m["salvo_perto"]) if m.get("salvo_perto") else None
        found = []
        for mt in pat.finditer(text):
            if m.get("ignora_citacao") and any(a <= mt.start() and mt.end() <= b for a, b in citacoes):
                continue
            if near:
                # Texto curto (legenda): o disclaimer vale se estiver em qualquer lugar.
                if len(text) <= SHORT_TEXT and m["id"] == "disclaimer":
                    if near.search(text):
                        continue
                else:
                    w = m.get("janela", 200)
                    if near.search(text[max(0, mt.start() - w): mt.end() + w]):
                        continue
            found.append(mt)
        if found:
            hits.append({"id": m["id"], "nivel": m["nivel"], "name": m["name"],
                         "count": len(found),
                         "trechos": [_excerpt(text, f.start(), f.end()) for f in found[:2]],
                         "fix": m["fix"]})
    # Travessão: legenda curta = zero; texto longo = máx. 1 a cada 5 parágrafos.
    em = [mt for mt in re.finditer("—", text)]
    if em:
        paras = max(1, len([p for p in re.split(r"\n\s*\n", text) if p.strip()]))
        if len(text) <= SHORT_TEXT:
            hits.append({"id": "travessao", "nivel": "BLOQUEIA",
                         "name": "Travessão em texto curto (legenda/roteiro/DM)",
                         "count": len(em),
                         "trechos": [_excerpt(text, e.start(), e.end()) for e in em[:2]],
                         "fix": "Em legenda curta, zero travessão. O humanize.py troca por vírgula; "
                                "releia a frase e prefira ponto final."})
        elif len(em) > max(1, paras // 5):
            hits.append({"id": "travessao", "nivel": "VERIFICAR",
                         "name": f"Travessão demais ({len(em)} em {paras} parágrafos)",
                         "count": len(em), "trechos": [],
                         "fix": "Máximo 1 travessão a cada 5 parágrafos."})
    order = {"BLOQUEIA": 0, "VERIFICAR": 1}
    return sorted(hits, key=lambda h: order.get(h["nivel"], 2))


# ---------------------------------------------------------------- PASSES
def pass_invisible(text, lex):
    hits = []
    for entry in lex["invisible"]:
        cp = _cp(entry["cp"])
        if isinstance(cp, tuple):
            pattern = "[" + re.escape(chr(cp[0])) + "-" + re.escape(chr(cp[1])) + "]"
        else:
            pattern = re.escape(chr(cp))
        n = len(re.findall(pattern, text))
        if n:
            hits.append({"name": entry["cp"] + " " + entry["name"], "count": n,
                         "action": "apagar" if entry["action"] == "delete" else "espaço"})
            text = re.sub(pattern, "" if entry["action"] == "delete" else " ", text)
    # U+FE0F (seletor de variação do emoji) é Mn, não Cf: fica. O resto Cf sai.
    stray = [c for c in text if unicodedata.category(c) == "Cf" and c != "\x00"]
    if stray:
        hits.append({"name": "outros caracteres invisíveis (Cf)", "count": len(stray),
                     "action": "apagar"})
        text = "".join(c for c in text if unicodedata.category(c) != "Cf" or c == "\x00")
    return text, hits


def pass_typographic(text, lex):
    hits = []
    for entry in lex["typographic"]:
        ch = entry["from"]
        n = text.count(ch)
        if not n:
            continue
        hits.append({"name": f"{ch} {entry['name']}", "count": n,
                     "to": entry["to"].strip() or "(espaço)"})
        if ch == "—":
            text = re.sub(r"\s*—\s*", ", ", text)
        elif ch == "–":
            text = re.sub(r"\s*–\s*(?=\d)", "-", text)
            text = re.sub(r"\s+–\s+", ", ", text)
            text = text.replace("–", "-")
        else:
            text = text.replace(ch, entry["to"])
    text = re.sub(r",\s*([,.;:!?])", r"\1", text)
    text = re.sub(r",\s*\n", "\n", text)
    text = re.sub(r"(?m)^\s*,\s*", "", text)
    return text, hits


def _match_case(src, repl):
    if not repl:
        return repl
    if src.isupper() and len(src) > 1:
        return repl.upper()
    if src[0].isupper():
        return repl[0].upper() + repl[1:]
    return repl


def pass_lexical(text, lex, lang):
    """Troca clichê por palavra simples. Frases mais longas primeiro."""
    hits, flags = [], []
    entries = sorted(_for_lang(lex["phrases"] + lex["words"], lang),
                     key=lambda e: len(e["find"]), reverse=True)
    for entry in entries:
        pattern = _phrase_re(entry["find"])
        found = pattern.findall(text)
        if not found:
            continue
        if entry.get("action") == "flag":
            flags.append({"find": entry["find"], "count": len(found),
                          "family": entry["family"], "nota": entry.get("nota", "")})
            continue
        state = {"done": 0, "kept": 0}

        def sub(m, entry=entry, state=state):
            if entry.get("predicativo"):
                before = TOKEN_RE.findall(m.string[max(0, m.start() - 25):m.start()])
                if before and before[-1].lower() in PREDICATIVE_BEFORE:
                    state["kept"] += 1
                    return m.group(0)
            state["done"] += 1
            if entry.get("predicativo") and not entry["replace"]:
                return ADJ_GONE        # sentinela: some junto com o "e" que ligava dois adjetivos
            return _match_case(m.group(0), entry["replace"])

        text = pattern.sub(sub, text)
        if state["done"]:
            hits.append({"find": entry["find"], "replace": entry["replace"] or "(apagado)",
                         "count": state["done"], "family": entry["family"]})
        if state["kept"]:
            flags.append({"find": entry["find"], "count": state["kept"], "family": entry["family"],
                          "nota": "Predicativo ('é incrível'): apagar quebraria a frase. "
                                  "Troque pelo fato ou número."})
    # "jornada incrível e transformadora" -> os dois somem, e o "e" que os ligava também.
    text = re.sub(ADJ_GONE + r"(?:\s*(?:,|\be\b|\bou\b)\s*" + ADJ_GONE + r")+", ADJ_GONE, text)
    text = re.sub(r"[ \t]*" + ADJ_GONE, "", text)
    # Limpeza depois de apagar: pontuação órfã, espaços duplos, linha abrindo em vírgula.
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"(?m)^[ \t]*(?:[,.;:!]+[ \t]*)+", "", text)
    text = re.sub(r"(?m)^[ \t](?=\S)", "", text)
    text = re.sub(r"[ \t]+([,.;:!?])", r"\1", text)
    text = re.sub(r",\s*([,.;:!?])", r"\1", text)
    text = text.replace("...", "\x00ELL\x00")
    text = re.sub(r"\.\s*\.+", ".", text)
    text = re.sub(r"([!?])\s*\.", r"\1", text)
    text = text.replace("\x00ELL\x00", "...")
    text = re.sub(r"(?m)^[ \t]+$", "", text)
    # Sobrou só o conectivo na linha ("Follow for more and tag..." -> "And!"): some.
    text = re.sub(r"(?im)^[ \t]*(?:and|or|but|e|ou|mas)[ \t]*[!.?]*[ \t]*$", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    if lang == "en":
        text = re.sub(r",\s*(also|so|still|basically|in the end)\s*,\s*",
                      lambda m: ". " + m.group(1)[0].upper() + m.group(1)[1:] + ", ", text)
    return text, hits, flags


def scan_structures(text, lex, lang):
    flags = []
    for s in _for_lang(lex["structures"], lang):
        try:
            pattern = re.compile(s["regex"], re.MULTILINE)
        except re.error:
            continue
        found = [m for m in pattern.finditer(text)]
        if found:
            flags.append({"id": s["id"], "name": s["name"], "count": len(found), "fix": s["fix"],
                          "prioridade": s.get("prioridade", "normal"),
                          "trechos": [_excerpt(text, f.start(), f.end(), 10) for f in found[:2]]})
    lens = [len(s.split()) for s in SENT_RE.findall(text) if len(s.split()) > 2]
    if len(lens) >= 4:
        mean = sum(lens) / len(lens)
        var = sum((n - mean) ** 2 for n in lens) / len(lens)
        cv = (var ** 0.5) / mean if mean else 0
        if cv < 0.35:
            flags.append({"id": "ritmo-uniforme",
                          "name": f"Frases do mesmo tamanho (variação {cv:.2f})",
                          "count": len(lens), "prioridade": "normal", "trechos": [],
                          "fix": "Quebre uma frase no meio. Deixe outra correr. Máquina escreve igual."})
    flags.sort(key=lambda f: 0 if f["prioridade"] == "ZERO" else 1)
    return flags


def restore_capitals(original, text):
    """Apagar a abertura deixa a próxima palavra minúscula. Só corrige se o autor
    costuma começar frase com maiúscula (voz toda minúscula é estilo, não defeito)."""
    starts = re.findall(r"(?:^|[.!?]\s+|\n)\s*([^\W\d_])", original)
    if not starts or sum(1 for c in starts if c.isupper()) * 2 < len(starts):
        return text
    return re.sub(r"(?:^|(?<=[.!?] )|(?<=[.!?]\n)|(?<=\n))\s*([^\W\d_])",
                  lambda m: m.group(0)[:-1] + m.group(1).upper(), text)


def humanize(text, lex, lang=None, marca=None):
    text = nfc(text)
    lang = lang or detect_lang(text, lex)
    run_brand = (lang == "pt") if marca is None else marca
    brand = brand_checks(text, lex) if run_brand else []
    raw_for_case = text
    text, urls = protect_urls(text)
    text, inv = pass_invisible(text, lex)
    text, typo = pass_typographic(text, lex)
    text, lexi, lexflags = pass_lexical(text, lex, lang)
    text = restore_capitals(raw_for_case, text)
    text = restore_urls(text, urls)
    return text.strip() + "\n", {
        "lang": lang,
        "marca": brand,
        "invisible": inv,
        "typographic": typo,
        "lexical": lexi,
        "lexical_flags": lexflags,
        "structures": scan_structures(text, lex, lang),
    }


def render_brand(brand, out=sys.stderr):
    if not brand:
        print("  Camada Conquista: nada encontrado.", file=out)
        return
    for h in brand:
        print(f"  [{h['nivel']}] {h['count']}x  {h['name']}", file=out)
        for t in h["trechos"]:
            print(f"        > {t}", file=out)
        print(f"        {h['fix']}", file=out)


def render_report(report, out=sys.stderr):
    def head(title):
        print(f"\n{title}\n" + "-" * len(title), file=out)

    total = sum(h["count"] for h in report["invisible"]) \
        + sum(h["count"] for h in report["typographic"]) \
        + sum(h["count"] for h in report["lexical"])
    bloqueia = [h for h in report["marca"] if h["nivel"] == "BLOQUEIA"]

    head(f"RELATÓRIO HUMANIZE  (idioma: {report['lang']})")
    print(f"{total} artefatos de máquina removidos, "
          f"{len(report['structures']) + len(report['lexical_flags'])} vícios sinalizados pra reescrever, "
          f"{len(report['marca'])} alerta(s) da Camada Conquista", file=out)

    if report["lang"] == "pt" or report["marca"]:
        head("0. CAMADA CONQUISTA  (BLOQUEIA = reescrever antes de entregar)")
        render_brand(report["marca"], out)
    if report["invisible"]:
        head("1. CARACTERES INVISÍVEIS")
        for h in report["invisible"]:
            print(f"  {h['count']:>3}x  {h['name']}  -> {h['action']}", file=out)
    if report["typographic"]:
        head("2. TIPOGRAFIA")
        for h in report["typographic"]:
            print(f"  {h['count']:>3}x  {h['name']}  -> {h['to']}", file=out)
    if report["lexical"]:
        head("3. LÉXICO TROCADO")
        for h in report["lexical"]:
            print(f"  {h['count']:>3}x  {h['find']}  -> {h['replace']}   [{h['family']}]", file=out)
    if report["lexical_flags"]:
        head("3b. PALAVRAS SINALIZADAS  (não trocadas - reescreva)")
        for h in report["lexical_flags"]:
            print(f"  {h['count']:>3}x  {h['find']}   [{h['family']}]\n        {h['nota']}", file=out)
    if report["structures"]:
        head("4. ESTRUTURAS DE IA  (não corrigidas - reescreva à mão)")
        for h in report["structures"]:
            tag = "  PRIORIDADE ZERO" if h["prioridade"] == "ZERO" else ""
            print(f"  {h['count']:>3}x  {h['name']}{tag}", file=out)
            for t in h["trechos"]:
                print(f"        > {t}", file=out)
            print(f"        {h['fix']}", file=out)
    if not any(report[k] for k in ("marca", "invisible", "typographic", "lexical",
                                   "lexical_flags", "structures")):
        head("LIMPO")
        print("  Nada pra tirar.", file=out)
    if bloqueia:
        print(f"\n  >>> BLOQUEADO: {len(bloqueia)} regra(s) da marca. Reescreva antes de entregar. "
              "Esta skill nunca aprova: a nota é do auditor-mkt-psm.", file=out)
    print("", file=out)


def main():
    ap = argparse.ArgumentParser(description="Tira a cara de máquina de um rascunho (PT-BR/EN).")
    ap.add_argument("input", nargs="?", default="-", help="arquivo, ou - para stdin")
    ap.add_argument("-o", "--out", help="grava o texto limpo aqui em vez do stdout")
    ap.add_argument("--report", action="store_true", help="mostra o que mudou (stderr)")
    ap.add_argument("--json", action="store_true", help="emite {text, report} em JSON")
    ap.add_argument("--lang", choices=["pt", "en"], help="força o idioma (padrão: detecta)")
    ap.add_argument("--marca", dest="marca", action="store_true", default=None,
                    help="força a Camada Conquista mesmo em texto em inglês")
    ap.add_argument("--sem-marca", dest="marca", action="store_false",
                    help="desliga a Camada Conquista")
    ap.add_argument("--so-marca", action="store_true", help="só roda a Camada Conquista")
    ap.add_argument("--lexicon", default=LEX, help="caminho do slop.json")
    args = ap.parse_args()

    raw = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
    lex = load_lexicon(args.lexicon)

    if args.so_marca:
        brand = brand_checks(raw, lex)
        if args.json:
            print(json.dumps(brand, indent=2, ensure_ascii=False))
        else:
            print("\nCAMADA CONQUISTA\n----------------")
            render_brand(brand, sys.stdout)
            print("")
        sys.exit(2 if any(h["nivel"] == "BLOQUEIA" for h in brand) else 0)

    clean, report = humanize(raw, lex, lang=args.lang, marca=args.marca)

    if args.json:
        print(json.dumps({"text": clean, "report": report}, indent=2, ensure_ascii=False))
    else:
        if args.out:
            with open(args.out, "w", encoding="utf-8") as fh:
                fh.write(clean)
            print(f"gravado em {args.out}", file=sys.stderr)
        else:
            sys.stdout.write(clean)
        if args.report:
            render_report(report)
    sys.exit(2 if any(h["nivel"] == "BLOQUEIA" for h in report["marca"]) else 0)


if __name__ == "__main__":
    main()
