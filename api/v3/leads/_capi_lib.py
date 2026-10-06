# -*- coding: utf-8 -*-
"""
_capi_lib.py — API de Conversões do Meta para os leads da landing psmconquista.com.br. v89.37.1

Por quê: o pixel do navegador perde evento (iPhone, bloqueador) e não enxerga o que
acontece DEPOIS do formulário. Aqui o House manda pelo servidor:
  · Lead               — na hora em que o lp_webhook grava o lead (event_id = lead_id,
                          o mesmo que a landing usa no fbq → o Meta deduplica)
  · etapas do funil    — quando o deal casado no RD anda (lp_recon?job=capi):
                          LeadQualificado · Schedule · VisitaRealizada ·
                          SubmitApplication · Purchase

Só leads com origem lp_psmconquista (pixel da Conquista). Dados pessoais vão
SEMPRE em hash SHA-256 (exigência do Meta); nada é enviado sem consent_lgpd.

Env:  META_WRITE_TOKEN ou META_ACCESS_TOKEN (precisa enxergar o pixel)
      META_PIXEL_CONQUISTA   (default: pixel instalado na landing)
      META_CAPI_TEST_CODE    (opcional — manda p/ a aba "Eventos de teste")
      META_CAPI_OFF=1        (desliga tudo sem redeploy de código)
"""
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

GRAPH_API = "https://graph.facebook.com/v21.0"
PIXEL_DEFAULT = "898566343254870"
ORIGEM_CONQUISTA = "lp_psmconquista"
LANDING_URL = "https://simule.psmconquista.com.br/ape"

# etapa do RD (pelo nome, sem emoji/acento) → evento do Meta. Ordem importa: 1º que casar.
ETAPAS = (
    (("venda",), "Purchase"),
    (("aprovacao", "proposta"), "SubmitApplication"),
    (("visita realizada",), "VisitaRealizada"),
    (("visita agendada",), "Schedule"),
    (("qualifica",), "LeadQualificado"),
)
PADRAO = {"Lead", "Schedule", "SubmitApplication", "Purchase", "Contact"}


def pixel_id():
    return (os.environ.get("META_PIXEL_CONQUISTA") or PIXEL_DEFAULT).strip()


def _token():
    return (os.environ.get("META_WRITE_TOKEN") or os.environ.get("META_ACCESS_TOKEN") or "").strip()


def ativo():
    return bool(_token()) and (os.environ.get("META_CAPI_OFF") or "").strip() not in ("1", "true")


def _sha(v):
    v = (v or "").strip().lower()
    return hashlib.sha256(v.encode("utf-8")).hexdigest() if v else None


def _sem_acento(s):
    import unicodedata
    s = unicodedata.normalize("NFD", str(s or ""))
    return re.sub(r"[^a-z0-9/ ]+", " ", "".join(c for c in s if unicodedata.category(c) != "Mn").lower())


def evento_da_etapa(stage_name):
    n = _sem_acento(stage_name)
    for chaves, ev in ETAPAS:
        if any(k in n for k in chaves):
            return ev
    return None


def user_data(lead, ids=None):
    """lead: linha de leads_lp · ids: {fbp, fbc, ip, ua} guardados no histórico."""
    ids = ids or {}
    fone = re.sub(r"\D", "", str(lead.get("whatsapp") or ""))
    if fone and not fone.startswith("55"):
        fone = "55" + fone
    nome = str(lead.get("nome") or "").strip().split(" ")
    ud = {"country": [_sha("br")]}
    if fone:
        ud["ph"] = [_sha(fone)]
    if lead.get("email"):
        ud["em"] = [_sha(lead["email"])]
    if nome and nome[0]:
        ud["fn"] = [_sha(nome[0])]
        if len(nome) > 1:
            ud["ln"] = [_sha(nome[-1])]
    if lead.get("lead_id"):
        ud["external_id"] = [_sha(lead["lead_id"])]
    for k_meta, k in (("fbp", "fbp"), ("fbc", "fbc"), ("client_ip_address", "ip"), ("client_user_agent", "ua")):
        if ids.get(k):
            ud[k_meta] = str(ids[k])[:500]
    return ud


def enviar(eventos):
    """POST no /{pixel}/events. Nunca levanta: devolve (ok, resumo curto p/ log)."""
    if not eventos:
        return True, "vazio"
    if not ativo():
        return False, "capi desligado/sem token"
    payload = {"data": json.dumps(eventos), "access_token": _token()}
    test = (os.environ.get("META_CAPI_TEST_CODE") or "").strip()
    if test:
        payload["test_event_code"] = test
    req = urllib.request.Request(f"{GRAPH_API}/{pixel_id()}/events",
                                 data=urllib.parse.urlencode(payload).encode("utf-8"), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            d = json.loads(resp.read().decode("utf-8") or "{}")
        return True, f"recebidos={d.get('events_received')}"
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8")).get("error", {})
            msg = f"{err.get('code')}: {err.get('message')}"
        except Exception:
            msg = f"http {e.code}"
        return False, msg[:150]
    except Exception as e:
        return False, str(e)[:150]


def evento(nome, lead, ids=None, quando=None, event_id=None, site=False, custom=None):
    ev = {
        "event_name": nome,
        "event_time": int((quando or datetime.now(timezone.utc)).timestamp()),
        "event_id": event_id or f"{lead.get('lead_id')}:{nome}",
        "action_source": "website" if site else "system_generated",
        "user_data": user_data(lead, ids),
    }
    if site:
        ev["event_source_url"] = (ids or {}).get("url") or LANDING_URL
    if custom:
        ev["custom_data"] = custom
    return ev


def ids_do_lead(lead):
    """fbp/fbc/ip/ua gravados pelo webhook na 1ª entrada do histórico."""
    for h in (lead.get("historico") or []):
        if isinstance(h, dict) and h.get("ev") == "recebido_lp":
            return h.get("meta") or {}
    return {}


def lead_recebido(lead, ids):
    """Chamado pelo lp_webhook logo após gravar. event_id = lead_id (dedupe com o fbq da landing)."""
    if (lead.get("origem") or "") != ORIGEM_CONQUISTA:
        return None, "origem fora do pixel"
    ev = evento("Lead", lead, ids, event_id=lead.get("lead_id"), site=True,
                custom={"content_name": "LP PSM Conquista", "content_category": lead.get("faixa_renda") or ""})
    return enviar([ev])


def funil(sb, dias=6):
    """Etapas do RD → Meta, 1× por lead por evento. Só lead da landing já casado com deal.
    Leve: 2 leituras pequenas + 1 update por evento novo. O Meta aceita evento de até 7 dias."""
    if not ativo():
        return {"skip": "capi desligado/sem token"}
    now = datetime.now(timezone.utc)
    try:
        leads = (sb.table("leads_lp")
                 .select("id,lead_id,nome,whatsapp,email,faixa_renda,origem,rd_deal_ref,historico")
                 .eq("origem", ORIGEM_CONQUISTA).not_.is_("rd_deal_ref", "null")
                 .gte("ts_recebido", (now - timedelta(days=120)).isoformat())
                 .limit(400).execute().data or [])
    except Exception as e:
        return {"error": f"leads: {str(e)[:100]}"}
    if not leads:
        return {"leads": 0, "enviados": 0}
    por_deal = {str(l["rd_deal_ref"]): l for l in leads}
    try:
        evs = (sb.table("deal_stage_events").select("deal_id,stage_name,occurred_at,amount,win")
               .in_("deal_id", list(por_deal.keys()))
               .gte("occurred_at", (now - timedelta(days=dias)).isoformat())
               .order("occurred_at").limit(1000).execute().data or [])
    except Exception as e:
        return {"error": f"eventos: {str(e)[:100]}"}
    enviados, falhas = 0, []
    for e in evs:
        nome = evento_da_etapa(e.get("stage_name"))
        lead = por_deal.get(str(e.get("deal_id")))
        if not nome or not lead:
            continue
        hist = list(lead.get("historico") or [])
        if any(isinstance(h, dict) and h.get("ev") == "capi" and h.get("nome") == nome for h in hist):
            continue
        try:
            quando = datetime.fromisoformat(str(e["occurred_at"]).replace("Z", "+00:00"))
        except Exception:
            quando = now
        custom = {"content_name": "LP PSM Conquista", "content_category": lead.get("faixa_renda") or ""}
        if nome == "Purchase":
            custom.update({"currency": "BRL", "value": float(e.get("amount") or 0)})
        ok, resumo = enviar([evento(nome, lead, ids_do_lead(lead), quando=quando, custom=custom)])
        if not ok:
            falhas.append(resumo)
            if len(falhas) >= 3:      # token/pixel quebrado: não insiste nesta rodada
                break
            continue
        hist.append({"ts": now.isoformat(), "ev": "capi", "nome": nome, "etapa": e.get("stage_name")})
        try:
            sb.table("leads_lp").update({"historico": hist}).eq("id", lead["id"]).execute()
            lead["historico"] = hist
            enviados += 1
        except Exception as ex:
            falhas.append(f"hist: {str(ex)[:80]}")
    return {"leads": len(leads), "eventos_etapa": len(evs), "enviados": enviados, "falhas": falhas[:3]}


def diagnostico():
    """Confere se o token enxerga o pixel (não envia evento nenhum)."""
    if not _token():
        return {"ok": False, "erro": "sem META_WRITE_TOKEN/META_ACCESS_TOKEN"}
    qs = urllib.parse.urlencode({"fields": "id,name,last_fired_time", "access_token": _token()})
    try:
        with urllib.request.urlopen(f"{GRAPH_API}/{pixel_id()}?{qs}", timeout=8) as resp:
            d = json.loads(resp.read().decode("utf-8") or "{}")
        return {"ok": True, "pixel": d.get("id"), "nome": d.get("name"), "ultimo_disparo": d.get("last_fired_time"),
                "ativo": ativo(), "modo_teste": bool((os.environ.get("META_CAPI_TEST_CODE") or "").strip())}
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8")).get("error", {})
            return {"ok": False, "erro": f"{err.get('code')}: {err.get('message')}"[:200]}
        except Exception:
            return {"ok": False, "erro": f"http {e.code}"}
    except Exception as e:
        return {"ok": False, "erro": str(e)[:150]}
