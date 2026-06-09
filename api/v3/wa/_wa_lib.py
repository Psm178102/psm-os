"""Helpers da Campanha WhatsApp (Evolution API) — envio, extração de contato, opt-out."""
import os, re, json, urllib.request


def normalize_phone(raw):
    dig = re.sub(r"\D", "", str(raw or ""))
    if not dig:
        return None
    if len(dig) <= 11 and not dig.startswith("55"):
        dig = "55" + dig
    return dig


def phone_from_rd(rd_raw):
    """Extrai o 1º telefone do payload bruto do RD (deals.rd_raw)."""
    if not isinstance(rd_raw, dict):
        return None
    for c in (rd_raw.get("contacts") or []):
        for ph in (c.get("phones") or []):
            p = normalize_phone(ph.get("phone") or ph.get("number"))
            if p:
                return p
    return None


def name_from_rd(rd_raw, fallback=""):
    if isinstance(rd_raw, dict):
        for c in (rd_raw.get("contacts") or []):
            if c.get("name"):
                return c["name"]
    return fallback or ""


def first_name(nome):
    return (nome or "").strip().split(" ")[0] if nome else ""


def is_sim(text):
    """Resposta positiva curta — 'sim', 'quero', 'tenho interesse', '👍'."""
    t = (text or "").strip().lower()
    if not t:
        return False
    return bool(re.match(r"^(sim|s|quero|qro|claro|bora|pode|tenho interesse|interesse|aceito|👍|✅)\b", t)) or t in ("sim", "s", "👍", "✅")


def evolution_send(phone, text, instance=None):
    url = os.environ.get("EVOLUTION_API_URL", "").strip()
    key = os.environ.get("EVOLUTION_API_KEY", "").strip()
    inst = (instance or os.environ.get("EVOLUTION_INSTANCE", "")).strip()
    if not url or not key or not inst:
        return {"ok": False, "error": "WhatsApp (Evolution) nao configurado: faltam EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE"}
    endpoint = url.rstrip("/") + "/message/sendText/" + inst
    body = json.dumps({"number": phone, "text": text}).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, method="POST",
                                 headers={"Content-Type": "application/json", "apikey": key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return {"ok": True, "status": r.status, "resp": (r.read().decode("utf-8") or "")[:300]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def is_opted_out(sb, phone):
    try:
        r = sb.table("wa_optout").select("phone").eq("phone", phone).limit(1).execute().data or []
        return len(r) > 0
    except Exception:
        return False


def render_template(tpl, nome):
    """Substitui {nome} e {primeiro_nome} na mensagem."""
    n = nome or "tudo bem"
    return (tpl or "").replace("{primeiro_nome}", first_name(n) or n).replace("{nome}", n)
