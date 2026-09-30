"""
_adlib_parse.py — lê a página pública da Biblioteca de Anúncios do Meta (markdown vindo do Firecrawl)
e devolve os anúncios ativos de um anunciante. v89.3 (coleta do Vigia na NUVEM).

A página não pede login. Formato (inglês ou português, conforme o servidor que renderiza):
  "~5 results" / "~5 resultados" / "No ads" / "Nenhum anúncio"
  cada anúncio: "Library ID: 123…" / "Identificação da biblioteca: 123…",
                "Started running on Sep 16, 2026" / "Veiculação iniciada em 16 de set de 2026",
                texto depois de "Sponsored"/"Patrocinado", botão (Apply now, Send WhatsApp message…).
"""
import re
from datetime import date

_MESES = {"jan": 1, "feb": 2, "fev": 2, "mar": 3, "apr": 4, "abr": 4, "may": 5, "mai": 5, "jun": 6,
          "jul": 7, "aug": 8, "ago": 8, "sep": 9, "set": 9, "oct": 10, "out": 10, "nov": 11, "dec": 12, "dez": 12}
_RE_TOTAL = re.compile(r"~?\s*([\d.,]+)\s+(?:results?|resultados?)\b", re.I)
_RE_ZERO = re.compile(r"\b(no ads|nenhum an[uú]ncio|0 results?|0 resultados?)\b", re.I)
_RE_ID = re.compile(r"(?:Library ID|Identifica[çc][ãa]o da biblioteca)\s*:\s*(\d{6,})", re.I)
_RE_INICIO_EN = re.compile(r"Started running on\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})", re.I)
_RE_INICIO_PT = re.compile(r"Veicula[çc][ãa]o iniciada em\s+(\d{1,2})\s+de\s+([a-zç]{3})[a-zç]*\.?\s+de\s+(\d{4})", re.I)
_CTAS = ("Send WhatsApp message", "Enviar mensagem", "Apply now", "Cadastre-se", "Learn more", "Saiba mais",
         "Sign up", "Book now", "Contact us", "Fale conosco", "Get quote", "Send message", "Call now", "Ligar agora")


def _data(bloco):
    m = _RE_INICIO_EN.search(bloco)
    if m:
        mes = _MESES.get(m.group(1).lower()[:3])
        if mes:
            return date(int(m.group(3)), mes, int(m.group(2)))
    m = _RE_INICIO_PT.search(bloco)
    if m:
        mes = _MESES.get(m.group(2).lower()[:3])
        if mes:
            return date(int(m.group(3)), mes, int(m.group(1)))
    return None


def _texto(bloco):
    """Copy do anúncio: depois de Sponsored/Patrocinado até o player/botão; sem links de imagem."""
    m = re.search(r"\*\*(?:Sponsored|Patrocinado)\*\*\s*(.+?)(?:Sorry, we're having trouble|\[Learn more\]|API\.WHATSAPP|$)", bloco, re.S | re.I)
    t = m.group(1) if m else ""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"\\-", "-", t)
    return re.sub(r"\s+", " ", t).strip()


def parse(markdown, hoje=None):
    """→ {"total": int|None, "anuncios": [{id, inicio, dias_no_ar, texto, cta, whatsapp}], "zero": bool}"""
    md = markdown or ""
    hoje = hoje or date.today()
    total = None
    m = _RE_TOTAL.search(md)
    if m:
        try:
            total = int(m.group(1).replace(".", "").replace(",", ""))
        except ValueError:
            total = None
    partes = _RE_ID.split(md)   # [antes, id1, bloco1, id2, bloco2, ...]
    anuncios = []
    for i in range(1, len(partes) - 1, 2):
        ad_id, bloco = partes[i], partes[i + 1]
        ini = _data(bloco)
        cta = next((c for c in _CTAS if c.lower() in bloco.lower()), None)
        anuncios.append({"id": ad_id, "inicio": ini.isoformat() if ini else None,
                         "dias_no_ar": (hoje - ini).days if ini else None,
                         "texto": _texto(bloco)[:400], "cta": cta,
                         "whatsapp": "whatsapp" in bloco.lower()})
    zero = bool(_RE_ZERO.search(md)) and not anuncios
    if total is None:
        total = 0 if zero else (len(anuncios) if anuncios else None)
    return {"total": total, "anuncios": anuncios, "zero": zero}


def nivel(n):
    if n is None:
        return None
    return "zero" if n == 0 else "baixo" if n <= 4 else "medio" if n <= 14 else "alto"
