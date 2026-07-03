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


# ─── Provider de envio ───────────────────────────────────────────────────────
# 360dialog (OFICIAL, Cloud API) é o preferido. Evolution (não-oficial) só dispara
# se explicitamente ligado (WA_USE_EVOLUTION=1). Sem nenhum → 'none' = campanha PAUSADA.
def provider():
    if os.environ.get("D360_API_KEY", "").strip() and os.environ.get("D360_TEMPLATE", "").strip():
        return "360dialog"
    if (os.environ.get("EVOLUTION_API_URL", "").strip() and os.environ.get("EVOLUTION_API_KEY", "").strip()
            and os.environ.get("EVOLUTION_INSTANCE", "").strip() and os.environ.get("WA_USE_EVOLUTION", "").strip() == "1"):
        return "evolution"
    return "none"


def cloud_api_send(phone, template, params, lang="pt_BR"):
    """Envia TEMPLATE aprovado via 360dialog (WhatsApp Cloud API oficial)."""
    key = os.environ.get("D360_API_KEY", "").strip()
    tpl = (template or os.environ.get("D360_TEMPLATE", "")).strip()
    if not key or not tpl:
        return {"ok": False, "error": "360dialog nao configurado (D360_API_KEY / D360_TEMPLATE)"}
    base = os.environ.get("D360_BASE_URL", "https://waba-v2.360dialog.io").rstrip("/")
    comps = [{"type": "body", "parameters": [{"type": "text", "text": str(p)} for p in (params or [])]}] if params else []
    payload = {
        "messaging_product": "whatsapp", "recipient_type": "individual", "to": phone,
        "type": "template",
        "template": {"name": tpl, "language": {"code": lang}, "components": comps},
    }
    req = urllib.request.Request(base + "/messages", data=json.dumps(payload).encode("utf-8"),
                                 method="POST", headers={"Content-Type": "application/json", "D360-API-KEY": key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return {"ok": True, "status": r.status, "resp": (r.read().decode("utf-8") or "")[:300]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def record_reply(sb, phone, text):
    """Casa a resposta com um envio recente (wa_sends) → marca is_sim / opt-out.
    Usado pelo webhook do Evolento E pelo webhook da Cloud API. Idempotente/seguro."""
    import re as _re
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    phone = normalize_phone(phone)
    if not phone:
        return {"matched": False}
    now = _dt.now(_tz.utc)
    sim = is_sim(text)
    optout = bool(_re.match(r"^(sair|parar|pare|remover|descadastr|n[aã]o quero|stop|cancelar)\b", (text or ""), _re.I))
    matched = False
    try:
        since = (now - _td(days=21)).isoformat()
        rows = sb.table("wa_sends").select("id,deal_id").eq("phone", phone).gte("sent_at", since) \
            .order("sent_at", desc=True).limit(1).execute().data or []
        if rows:
            matched = True
            sb.table("wa_sends").update({"reply_text": (text or "")[:500], "is_sim": sim,
                                         "status": "replied", "replied_at": now.isoformat()}).eq("id", rows[0]["id"]).execute()
            # reflete na Fila de Reativação: SIM → respondeu (🔥); opt-out → sem interesse. v84.3
            did = rows[0].get("deal_id")
            if did and sim:
                fila_update(sb, did, "respondeu", "respondeu na campanha: " + (text or "")[:120], por="webhook WA")
            elif did and optout:
                fila_update(sb, did, "sem_interesse", "pediu opt-out na campanha", por="webhook WA")
    except Exception:
        pass
    if optout:
        try:
            sb.table("wa_optout").upsert({"phone": phone, "motivo": (text or "")[:200]}, on_conflict="phone").execute()
        except Exception:
            pass
    return {"matched": matched, "is_sim": sim, "optout": optout}

def fila_update(sb, deal_id, st, nota, por="campanha WA"):
    """Reflete o evento da campanha na Fila de Reativação MAP (shared_kv
    'reativacao_map') — envio marca 'contatado', SIM marca 'respondeu',
    opt-out marca 'sem_interesse'. Best-effort (nunca quebra o envio). v84.3"""
    try:
        from datetime import datetime as _dt, timezone as _tz
        if not deal_id:
            return
        rows = sb.table("shared_kv").select("value").eq("key", "reativacao_map").limit(1).execute().data or []
        estado = rows[0]["value"] if rows else {}
        if isinstance(estado, str):
            estado = json.loads(estado)
        if not isinstance(estado, dict):
            estado = {}
        cur = (estado.get(str(deal_id)) or {}).get("st")
        # não rebaixa: se a fila já marcou respondeu/agendou, um envio não volta pra 'contatado'
        ordem = {"contatado": 1, "nao_atendeu": 1, "respondeu": 2, "futuro": 2, "sem_interesse": 3, "agendou": 3}
        if cur and ordem.get(cur, 0) >= ordem.get(st, 0) and st == "contatado":
            return
        estado[str(deal_id)] = {"st": st, "nota": (nota or "")[:300],
                                "ts": _dt.now(_tz.utc).isoformat(), "por": por[:60]}
        sb.table("shared_kv").upsert({"key": "reativacao_map", "value": estado,
                                      "updated_at": _dt.now(_tz.utc).isoformat()}, on_conflict="key").execute()
    except Exception:
        pass
