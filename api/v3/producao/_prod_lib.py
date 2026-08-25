"""
_prod_lib — miolo do módulo PRODUTIVIDADE REAL (v86.78).

Peças que esta lib sustenta (spec "Produtividade Real" aprovada pelo Paulo em 25/ago):
  1. Eventos de produção do CORRETOR (toques/visitas) em producao_eventos — registro no ato.
  3. Campos personalizados do RD (status de visita/no-show e status de PASTA no funil
     Conquista) viram eventos quando o valor MUDA (diff contra o rd_raw guardado em deals).
  4. Motivo de perda do RD espelhado como evento (qualidade de lead por campanha).
  2. Primeiro contato (SLA 5/15 min) — helpers de first-touch usados pelo cron e painel.

Premissa operacional: os corretores SEGUEM NO RD. Nada aqui exige o kanban /crm-house.
Convenções: aditivo, sem migração (reusa producao_eventos + shared_kv), config editável
em shared_kv 'rd_campos_map' (seed heurístico — conferir/editar via set_cfg).
"""
import json
import re
from datetime import datetime, timezone, timedelta

BRT = timezone(timedelta(hours=-3))
KV_CAMPOS = "rd_campos_map"        # mapeamento label do campo RD -> conceito
KV_SLA_ALERTAS = "sla_lead_alertas"  # dedupe de alerta por deal

# ── Peça 1: tipos de evento válidos para CORRETOR (qualquer usuário lvl>=2 loga PRA SI) ──
CORRETOR_TIPOS = [
    "toque_ligacao", "toque_whatsapp",
    "visita_marcada", "visita_confirmada", "visita_realizada", "no_show",
    "anuncio_renovado", "criativo_publicado", "gravacao_entregue", "captacao_imovel",
    # tipos gravados pelo espelho dos campos do RD (não pelo botão):
    "pasta_status", "perda_motivo",
]
BLOCOS = ["sala_ligacao", "ativo", "meio_dia", "retomada", "corujao", "plantao_sabado", "fila_dia"]

# metas de partida por bloco (mês 1 = baseline; editar via fiscalizacao_cfg depois)
METAS_CORRETOR = {"toques_dia": 60, "visitas_dia": 2, "no_show_max_pct": 30}


def email_local(email):
    e = str(email or "").strip().lower()
    return e.split("@", 1)[0] if "@" in e else (e or None)


# ── Peça 3/4: campos personalizados do RD ───────────────────────────────────────────────
# O deal do RD traz os campos em `deal_custom_fields` (às vezes `custom_fields`), cada um
# {value, custom_field:{label,...}}. O mapa label→conceito vive em shared_kv (seed abaixo
# por heurística de label; Paulo confere/edita — nomes exatos dos campos são dele).
DEFAULT_CAMPOS = {
    # "label em minúsculas (contains)": conceito
    "status da visita": "status_visita",
    "status visita": "status_visita",
    "no show": "status_visita",
    "no-show": "status_visita",
    "motivo do no show": "motivo_no_show",
    "pasta": "pasta_status",        # etapa pasta/aprovação do funil Conquista
    "aprovacao": "pasta_status",
    "aprovação": "pasta_status",
}
# valores do campo de visita → tipo de evento (contains, minúsculas)
VISITA_VALOR_TIPO = [
    ("no show", "no_show"), ("no-show", "no_show"), ("não compareceu", "no_show"),
    ("realizada", "visita_realizada"), ("realizado", "visita_realizada"),
    ("confirmada", "visita_confirmada"), ("confirmado", "visita_confirmada"),
    ("agendada", "visita_marcada"), ("agendado", "visita_marcada"),
    ("remarcada", "visita_marcada"), ("remarcado", "visita_marcada"),
]


def get_campos_map(sb, seed=True):
    """Mapa label→conceito mesclado (defaults ← shared_kv). Mesmo padrão do fiscalizacao_cfg."""
    saved = None
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_CAMPOS).limit(1).execute().data or []
        saved = rows[0]["value"] if rows else None
        if isinstance(saved, str):
            saved = json.loads(saved)
    except Exception:
        saved, seed = None, False
    if saved is None and seed:
        try:
            sb.table("shared_kv").upsert({"key": KV_CAMPOS, "value": DEFAULT_CAMPOS,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception:
            pass
        return dict(DEFAULT_CAMPOS)
    out = dict(DEFAULT_CAMPOS)
    if isinstance(saved, dict):
        out.update({str(k).lower(): v for k, v in saved.items()})
    return out


def extract_custom_fields(deal):
    """{label_lower: value_str} dos campos personalizados de um deal RD."""
    out = {}
    if not isinstance(deal, dict):
        return out
    arr = deal.get("deal_custom_fields") or deal.get("custom_fields") or []
    if not isinstance(arr, list):
        return out
    for f in arr:
        if not isinstance(f, dict):
            continue
        cf = f.get("custom_field") or {}
        label = str((cf.get("label") if isinstance(cf, dict) else None) or f.get("label") or "").strip().lower()
        val = f.get("value")
        if isinstance(val, list):
            val = ", ".join(str(v) for v in val)
        val = str(val).strip() if val is not None else ""
        if label:
            out[label] = val
    return out


def conceitos_do_deal(deal, campos_map):
    """{conceito: valor} aplicando o mapa (label contains)."""
    fields = extract_custom_fields(deal)
    out = {}
    for label, val in fields.items():
        for frag, conceito in campos_map.items():
            if frag in label and val:
                # primeiro match vence; visita tem prioridade sobre pasta em labels ambíguos
                if conceito not in out:
                    out[conceito] = val
    return out


def _ja_registrado(sb, tipo, ref_id, valor_meta):
    """Dedupe: último evento deste tipo+deal já tem o mesmo valor? (eventos são imutáveis)"""
    try:
        rows = (sb.table("producao_eventos").select("meta")
                .eq("tipo", tipo).eq("ref_id", str(ref_id))
                .order("ts", desc=True).limit(1).execute().data or [])
        if rows:
            m = rows[0].get("meta") or {}
            if isinstance(m, str):
                m = json.loads(m)
            return str((m or {}).get("valor") or "").lower() == str(valor_meta or "").lower()
    except Exception:
        pass
    return False


def _insert_evento(sb, colaborador, tipo, ref_id, meta, criado_por="rd_espelho"):
    try:
        sb.table("producao_eventos").insert({
            "colaborador": colaborador or "sem_dono", "tipo": tipo,
            "ref_type": "deal", "ref_id": str(ref_id)[:120],
            "valor": None, "meta": meta, "criado_por": criado_por,
        }).execute()
        return True
    except Exception as e:
        print(f"[prod] insert evento {tipo} falhou: {e}")
        return False


def record_field_events(sb, deal, prev_raw, campos_map=None):
    """Peça 3: diffa os campos mapeados do deal contra o rd_raw ANTERIOR e grava eventos.
    Nunca levanta. Retorna lista de tipos gravados."""
    gravados = []
    try:
        if not isinstance(deal, dict) or deal.get("id") is None:
            return gravados
        campos_map = campos_map or get_campos_map(sb)
        agora = conceitos_do_deal(deal, campos_map)
        antes = conceitos_do_deal(prev_raw or {}, campos_map)
        if not agora:
            return gravados
        did = str(deal.get("id"))
        dono = email_local(((deal.get("user") or {}).get("email")) if isinstance(deal.get("user"), dict) else None)
        pipe = deal.get("deal_pipeline") or {}
        base_meta = {"deal_id": did, "pipeline": (pipe.get("name") if isinstance(pipe, dict) else None),
                     "origem": "campo_rd"}
        for conceito, valor in agora.items():
            if str(antes.get(conceito) or "").lower() == str(valor).lower():
                continue  # não mudou
            if conceito == "status_visita":
                tipo = None
                vl = valor.lower()
                for frag, t in VISITA_VALOR_TIPO:
                    if frag in vl:
                        tipo = t
                        break
                if not tipo:
                    continue
            elif conceito == "pasta_status":
                tipo = "pasta_status"
            elif conceito == "motivo_no_show":
                continue  # vira meta do evento no_show, não evento próprio
            else:
                continue
            if _ja_registrado(sb, tipo, did, valor):
                continue
            meta = {**base_meta, "campo": conceito, "valor": valor, "anterior": antes.get(conceito)}
            if tipo == "no_show" and agora.get("motivo_no_show"):
                meta["motivo"] = agora["motivo_no_show"]
            if _insert_evento(sb, dono, tipo, did, meta):
                gravados.append(tipo)
    except Exception as e:
        print(f"[prod] record_field_events falhou: {e}")
    return gravados


def record_loss_reason(sb, deal, prev_raw):
    """Peça 4: deal marcado como PERDIDO com motivo → evento perda_motivo (1× por deal)."""
    try:
        if not isinstance(deal, dict) or deal.get("id") is None:
            return False
        if deal.get("win") is not False:   # win: true=ganho, false=perdido, null=aberto
            return False
        lr = deal.get("deal_lost_reason") or {}
        motivo = (lr.get("name") if isinstance(lr, dict) else None) or None
        prev_win = (prev_raw or {}).get("win") if isinstance(prev_raw, dict) else None
        if prev_win is False and not motivo:
            return False  # já era perdido e continua sem motivo — nada novo
        did = str(deal.get("id"))
        if _ja_registrado(sb, "perda_motivo", did, motivo or "sem_motivo"):
            return False
        dono = email_local(((deal.get("user") or {}).get("email")) if isinstance(deal.get("user"), dict) else None)
        src = deal.get("deal_source") or {}
        camp = deal.get("campaign") or {}
        meta = {"deal_id": did, "valor": motivo or "sem_motivo",
                "fonte": (src.get("name") if isinstance(src, dict) else None),
                "campanha": (camp.get("name") if isinstance(camp, dict) else None),
                "origem": "campo_rd"}
        return _insert_evento(sb, dono, "perda_motivo", did, meta)
    except Exception as e:
        print(f"[prod] record_loss_reason falhou: {e}")
        return False


# ── Peça 2: primeiro contato ────────────────────────────────────────────────────────────
def first_touch_map(sb, deal_ids):
    """{deal_id: iso_do_primeiro_toque} — toque humano (producao_eventos) OU 2ª etapa
    observada no espelho (deal_stage_events além do evento de criação)."""
    out = {}
    ids = [str(i) for i in (deal_ids or []) if i]
    if not ids:
        return out
    for i in range(0, len(ids), 150):
        chunk = ids[i:i + 150]
        try:
            evs = (sb.table("producao_eventos").select("ref_id,ts,tipo")
                   .in_("ref_id", chunk).in_("tipo", ["toque_ligacao", "toque_whatsapp"])
                   .order("ts", desc=False).execute().data or [])
            for e in evs:
                out.setdefault(str(e["ref_id"]), e["ts"])
        except Exception:
            pass
        try:
            ses = (sb.table("deal_stage_events").select("deal_id,occurred_at")
                   .in_("deal_id", chunk).order("occurred_at", desc=False).execute().data or [])
            seen = {}
            for s in ses:
                seen.setdefault(str(s["deal_id"]), []).append(s["occurred_at"])
            for did, lst in seen.items():
                if len(lst) >= 2:   # 1º = estado na criação; 2º = alguém mexeu
                    cand = lst[1]
                    if did not in out or str(cand) < str(out[did]):
                        out[did] = cand
        except Exception:
            pass
    return out


def em_horario_comercial(dt_utc):
    b = dt_utc.astimezone(BRT)
    return b.weekday() < 6 and 8 <= b.hour < 19
