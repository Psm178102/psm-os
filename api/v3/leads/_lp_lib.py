# -*- coding: utf-8 -*-
"""
_lp_lib — helpers do módulo Leads LP (receptor da landing psmconquista). v84.86

Peça central do TESTE DE CRM: a LP manda cada lead em duplo destino (RD + House)
e aqui medimos paridade + speed-to-lead. Config em shared_kv (sem migração):
  leads_lp_config = { atendentes:[], gestores:[], sla_min:5, alerta_min:15,
                      horario:{ini:"08:30",fim:"18:30",dias:[0,1,2,3,4]}, meta_paridade:99 }
  leads_lp_state  = dedupe de alertas (hora do alerta de webhook, dia da paridade)
"""
import json
import os
import re
import urllib.request
from datetime import datetime, timezone, timedelta

KV_CFG = "leads_lp_config"
KV_STATE = "leads_lp_state"
BRT = timezone(timedelta(hours=-3))

STATUS_VALIDOS = ("novo", "em_atendimento", "agendado", "descartado", "nutricao")
FAIXA_NUTRICAO = "ATE_2250"

CFG_DEFAULT = {
    "atendentes": [],          # user ids que recebem o push do lead novo ([] = gerentes conquista)
    "gestores": [],            # user ids dos alertas de SLA ([] = gerentes + sócios)
    "sla_min": 5,
    "alerta_min": 15,
    "horario": {"ini": "08:30", "fim": "18:30", "dias": [0, 1, 2, 3, 4]},  # weekday() seg=0
    "meta_paridade": 99,
}


# ─── normalização ─────────────────────────────────────────────────────────
def norm_phone(raw):
    """Só dígitos, formato wa.me (55DDDNÚMERO). None se inválido."""
    dig = re.sub(r"\D", "", str(raw or ""))
    dig = dig.lstrip("0")
    if len(dig) < 10:
        return None
    if not dig.startswith("55"):
        dig = "55" + dig
    if len(dig) > 15:
        return None
    return dig


def _fmt_brl(n):
    try:
        s = f"{float(n):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return f"R$ {s}"
    except Exception:
        return str(n)


def faixa_label(code):
    """F2_3500_4000 → 'R$ 3.500,00 – R$ 4.000,00' · ATE_2250 → 'Até R$ 2.250,00'."""
    c = str(code or "").upper()
    nums = [int(x) for x in re.findall(r"\d{3,7}", c)]
    if c.startswith("ATE") and nums:
        return f"Até {_fmt_brl(nums[-1])}"
    if c.startswith("ACIMA") and nums:
        return f"Acima de {_fmt_brl(nums[-1])}"
    if len(nums) >= 2:
        return f"{_fmt_brl(nums[-2])} – {_fmt_brl(nums[-1])}"
    return c or "—"


# ─── config / kv ──────────────────────────────────────────────────────────
def kv_get(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        return rows[0]["value"] if rows else (default if default is not None else {})
    except Exception:
        return default if default is not None else {}


def kv_set(sb, key, value):
    try:
        sb.table("shared_kv").upsert({"key": key, "value": value,
                                      "updated_at": datetime.now(timezone.utc).isoformat()},
                                     on_conflict="key").execute()
        return True
    except Exception:
        return False


def get_cfg(sb):
    cfg = dict(CFG_DEFAULT)
    salvo = kv_get(sb, KV_CFG, {})
    if isinstance(salvo, dict):
        cfg.update({k: v for k, v in salvo.items() if v is not None})
    return cfg


def horario_comercial(cfg, now_brt=None):
    now = now_brt or datetime.now(BRT)
    h = cfg.get("horario") or {}
    if now.weekday() not in (h.get("dias") or [0, 1, 2, 3, 4]):
        return False
    hm = now.strftime("%H:%M")
    return (h.get("ini") or "08:30") <= hm < (h.get("fim") or "18:30")


# ─── alçadas (nunca broadcast — padrão v81.72) ────────────────────────────
def _users_ativos(sb):
    try:
        return [u for u in (sb.table("users").select("id,name,email,role,status").execute().data or [])
                if (u.get("status") or "ativo") == "ativo" and u.get("id")]
    except Exception:
        return []


def atendentes_ids(sb, cfg, lvl_of):
    ids = [i for i in (cfg.get("atendentes") or []) if i]
    if ids:
        return ids
    return [u["id"] for u in _users_ativos(sb)
            if (u.get("role") or "") in ("gerente", "gerente_conquista")]


def gestores_ids(sb, cfg, lvl_of):
    ids = [i for i in (cfg.get("gestores") or []) if i]
    if ids:
        return ids
    return [u["id"] for u in _users_ativos(sb)
            if (u.get("role") or "").startswith("gerente") or lvl_of(u.get("role")) >= 10]


# ─── broadcast server-side (webhook não tem navegador pra emitir o sinal) ─
def broadcast_change():
    """Best-effort: acorda os clientes Realtime (<1s). Fallback = pulso 6-12s."""
    url = os.environ.get("SUPABASE_URL")
    anon = os.environ.get("SUPABASE_ANON_KEY")
    if not (url and anon):
        return False
    try:
        body = json.dumps({"messages": [{"topic": "psm-os", "event": "change", "payload": {}}]}).encode()
        req = urllib.request.Request(f"{url.rstrip('/')}/realtime/v1/api/broadcast", data=body, method="POST",
                                     headers={"apikey": anon, "Authorization": f"Bearer {anon}",
                                              "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False


# ─── reconciliação RD × House ─────────────────────────────────────────────
def _phones_do_deal(rd_raw):
    """Todos os telefones normalizados do rd_raw.contacts."""
    out = []
    try:
        for c in (rd_raw or {}).get("contacts") or []:
            for p in (c.get("phones") or []):
                n = norm_phone(p.get("phone"))
                if n:
                    out.append(n)
    except Exception:
        pass
    return out


def reconciliar(sb):
    """Casa leads_lp sem rd_deal_ref (72h) com deals do RD (por telefone, janela 4d).
    O sync RD roda 1×/dia — lead de hoje normalmente só casa amanhã. Idempotente."""
    now = datetime.now(timezone.utc)
    try:
        pend = (sb.table("leads_lp").select("id,lead_id,whatsapp,historico")
                .is_("rd_deal_ref", "null")
                .gte("ts_recebido", (now - timedelta(hours=72)).isoformat())
                .limit(200).execute().data or [])
    except Exception as e:
        return {"error": f"leads: {e}"[:150]}
    if not pend:
        return {"pendentes": 0, "casados": 0}
    try:
        deals = (sb.table("deals").select("id,name,created_at_rd,rd_raw")
                 .gte("created_at_rd", (now - timedelta(days=4)).isoformat())
                 .order("created_at_rd", desc=True).limit(500).execute().data or [])
    except Exception as e:
        return {"error": f"deals: {e}"[:150]}
    por_fone = {}
    for d in deals:
        for f in _phones_do_deal(d.get("rd_raw")):
            por_fone.setdefault(f, d)
    casados = 0
    for ld in pend:
        d = por_fone.get(ld.get("whatsapp"))
        if not d:
            continue
        hist = ld.get("historico") or []
        hist.append({"ts": now.isoformat(), "ev": "casado_rd", "deal": d["id"]})
        try:
            sb.table("leads_lp").update({"rd_deal_ref": str(d["id"]), "historico": hist}) \
                .eq("id", ld["id"]).execute()
            casados += 1
        except Exception:
            pass
    return {"pendentes": len(pend), "casados": casados}


def paridade_janela(sb, ini_h, fim_h):
    """Paridade numa janela [agora-ini_h, agora-fim_h] (h atrás). Só o lado House→RD:
    detectar 'RD sem House' depende do RD marcar a origem — limitação declarada."""
    now = datetime.now(timezone.utc)
    try:
        rows = (sb.table("leads_lp").select("id,nome,whatsapp,ts_recebido,rd_deal_ref,nutricao")
                .gte("ts_recebido", (now - timedelta(hours=ini_h)).isoformat())
                .lte("ts_recebido", (now - timedelta(hours=fim_h)).isoformat())
                .limit(1000).execute().data or [])
    except Exception:
        rows = []
    tot = len(rows)
    casados = sum(1 for r in rows if r.get("rd_deal_ref"))
    return {"total": tot, "casados": casados,
            "pct": round(100.0 * casados / tot, 1) if tot else None,
            "sem_rd": [{"nome": r.get("nome"), "whatsapp": r.get("whatsapp"),
                        "ts": r.get("ts_recebido")} for r in rows if not r.get("rd_deal_ref")][:20]}
