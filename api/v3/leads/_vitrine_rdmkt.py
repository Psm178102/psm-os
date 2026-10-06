# -*- coding: utf-8 -*-
"""
Lead da vitrine psmempreendimentos.com.br → conversão no RD Station Marketing. v89.38.2

Usa o OAuth que o House já guarda na shared_kv (chave rd_mkt_tokens, a mesma do
api/_rd_kv.js): lê o access token, renova se venceu e registra a conversão
"psmempreendimentos" com nome, e-mail, celular, faixa e empreendimento de interesse.
RD Marketing só aceita lead com e-mail; sem e-mail, não envia. Nunca derruba o lead.

Env: RD_MKT_CLIENT_ID / RD_MKT_CLIENT_SECRET (já usados pelo OAuth) · VITRINE_RDMKT_OFF=1 desliga.
"""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone

RD = "https://api.rd.services"
KV_KEY = "rd_mkt_tokens"
CONVERSAO = "psmempreendimentos"
HTTP_TIMEOUT = 8


def _post(path, payload, bearer=None):
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if bearer:
        h["Authorization"] = "Bearer " + bearer
    req = urllib.request.Request(RD + path, data=json.dumps(payload).encode("utf-8"), method="POST", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"erro": str(e)[:120]}


def _vencido(tk, margem=120):
    try:
        t0 = datetime.fromisoformat(str(tk.get("obtained_at")).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - t0).total_seconds() > int(tk.get("expires_in") or 86400) - margem
    except Exception:
        return True


def _renovar(sb, tk):
    cid = (os.environ.get("RD_MKT_CLIENT_ID") or "").strip()
    sec = (os.environ.get("RD_MKT_CLIENT_SECRET") or "").strip()
    if not cid or not sec or not tk.get("refresh_token"):
        return None
    st, d = _post("/auth/token", {"client_id": cid, "client_secret": sec, "refresh_token": tk["refresh_token"]})
    if not d.get("access_token"):
        return None
    novo = {"access_token": d["access_token"], "refresh_token": d.get("refresh_token") or tk["refresh_token"],
            "expires_in": d.get("expires_in") or 86400,
            "obtained_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    try:
        sb.table("shared_kv").upsert({"key": KV_KEY, "value": novo}, on_conflict="key").execute()
    except Exception:
        pass
    return novo


def _token(sb, forcar=False):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        tk = rows[0]["value"] if rows else None
    except Exception:
        tk = None
    if not isinstance(tk, dict) or not tk.get("access_token"):
        return None
    if forcar or _vencido(tk):
        tk = _renovar(sb, tk)
    return tk.get("access_token") if tk else None


def registrar_conversao(sb, lead, faixa_txt):
    """Devolve (ok, resumo curto p/ log)."""
    if (os.environ.get("VITRINE_RDMKT_OFF") or "").strip() in ("1", "true"):
        return None, "desligado"
    email = (lead.get("email") or "").strip().lower()
    if not email:
        return None, "sem e-mail"
    tok = _token(sb)
    if not tok:
        return False, "sem token do RD Marketing (refazer OAuth em /api/rd-auth)"
    fone = re.sub(r"\D", "", str(lead.get("whatsapp") or ""))
    if fone and not fone.startswith("55"):
        fone = "55" + fone
    utms = lead.get("utms") or {}
    interesse = (lead.get("pagina_ancora") or "").strip()
    payload = {k: v for k, v in {
        "conversion_identifier": CONVERSAO,
        "email": email,
        "name": lead.get("nome"),
        "mobile_phone": ("+" + fone) if fone else None,
        "city": "São José do Rio Preto", "state": "SP", "country": "Brasil",
        "tags": [t for t in ["psmempreendimentos", "psm-imoveis",
                             "spoiler" if interesse.lower().startswith("spoiler") else None] if t],
        "traffic_source": utms.get("utm_source"), "traffic_medium": utms.get("utm_medium"),
        "traffic_campaign": utms.get("utm_campaign"), "traffic_value": utms.get("utm_term"),
        "legal_bases": [{"category": "communications", "type": "consent", "status": "granted"}],
    }.items() if v}
    corpo = {"event_type": "CONVERSION", "event_family": "CDP", "payload": payload}
    st, d = _post("/platform/events?event_type=conversion", corpo, bearer=tok)
    if st == 401:   # token caiu antes da hora: renova uma vez e tenta de novo
        tok = _token(sb, forcar=True)
        if tok:
            st, d = _post("/platform/events?event_type=conversion", corpo, bearer=tok)
    if 200 <= st < 300:
        return True, f"conversao ok ({interesse or 'geral'} · {faixa_txt})"[:150]
    return False, f"http {st}: {json.dumps(d, ensure_ascii=False)[:110]}"
