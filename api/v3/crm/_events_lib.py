"""
_events_lib.py — captura de eventos de transição de etapa (event sourcing).

O RD CRM v1 não guarda histórico de etapas. Esta lib grava, de forma idempotente,
cada vez que um deal é observado numa etapa — alimentando a tabela
`deal_stage_events`. A partir daí SLA / 1º contato / visita ficam REAIS.

Idempotência: occurred_at = deal.updated_at (o RD muda esse timestamp quando o
deal muda). Reenvio de webhook e re-sync geram a MESMA chave
(deal_id, stage_id, occurred_at) → unique no banco dedup sozinho.

Reusado por: rd_webhook.py (instantâneo), sync.py / sync_cron.py (rede de
segurança), events_backfill.py (seed inicial).
"""
import os
import time
from datetime import datetime, timezone

# ─── Cache do mapa de posições de etapa (rd_stages) ─────────────────────────
_pos_cache = {"ts": 0.0, "map": {}}
_POS_TTL = 300  # 5 min


def _parse_iso(s):
    """Normaliza p/ isoformat canônico estável (chave de idempotência)."""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.isoformat()
    except Exception:
        return None


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def stage_position_map(sb, force=False):
    """{stage_id(str): position(int)} a partir de rd_stages, com cache curto."""
    now = time.time()
    if not force and _pos_cache["map"] and (now - _pos_cache["ts"]) < _POS_TTL:
        return _pos_cache["map"]
    m = {}
    try:
        stages = sb.table("rd_stages").select("*").execute().data or []
        for s in stages:
            pos = s.get("position")
            if pos is None:
                pos = s.get("order")
            try:
                pos = int(pos) if pos is not None else None
            except Exception:
                pos = None
            for key in (s.get("id"), s.get("external_id"), s.get("stage_id")):
                if key is not None:
                    m[str(key)] = pos
    except Exception as e:
        print(f"[events] stage_position_map falhou: {e}")
        return _pos_cache["map"] or {}
    _pos_cache["map"] = m
    _pos_cache["ts"] = now
    return m


def _amount(deal):
    try:
        return float(deal.get("amount_total") or deal.get("amount_unique") or deal.get("amount") or 0)
    except Exception:
        return 0.0


def build_event(sb, deal, source="webhook", occurred_at=None, pos_map=None):
    """Monta uma linha de deal_stage_events a partir de um deal RD. None se inválido."""
    if not isinstance(deal, dict):
        return None
    did = deal.get("id")
    if did is None:
        return None
    stage = deal.get("deal_stage") or {}
    if not isinstance(stage, dict):
        stage = {}
    stage_id = stage.get("id")
    if stage_id is None:
        return None  # sem etapa não há transição a registrar
    pipe = deal.get("deal_pipeline") or {}
    if not isinstance(pipe, dict):
        pipe = {}
    user = deal.get("user") or {}
    if not isinstance(user, dict):
        user = {}
    occ = occurred_at or _parse_iso(deal.get("updated_at")) or _parse_iso(deal.get("created_at")) or _now_iso()
    if pos_map is None:
        pos_map = stage_position_map(sb)
    return {
        "deal_id": str(did),
        "pipeline_id": str(pipe.get("id")) if pipe.get("id") is not None else None,
        "pipeline_name": pipe.get("name") or None,
        "stage_id": str(stage_id),
        "stage_name": stage.get("name") or None,
        "stage_position": pos_map.get(str(stage_id)),
        "win": deal.get("win"),
        "amount": _amount(deal),
        "user_email": (user.get("email") or "").lower() or None,
        "occurred_at": occ,
        "source": source,
        "raw": None,  # o rd_raw já vive em `deals`; não duplicamos o blob aqui
    }


def _upsert_ignore(sb, rows):
    """Insere ignorando duplicatas (chave deal_id,stage_id,occurred_at). Best-effort."""
    if not rows:
        return 0
    try:
        sb.table("deal_stage_events").upsert(
            rows, on_conflict="deal_id,stage_id,occurred_at", ignore_duplicates=True
        ).execute()
        return len(rows)
    except TypeError:
        # cliente supabase antigo sem ignore_duplicates
        pass
    except Exception as e:
        # pode ser conflito (em insert) ou outro; tenta linha a linha abaixo
        if len(rows) == 1:
            return 0
    # fallback: tenta uma a uma, engolindo duplicatas
    ok = 0
    for r in rows:
        try:
            sb.table("deal_stage_events").insert(r).execute()
            ok += 1
        except Exception:
            pass  # duplicata ou erro pontual → ignora
    return ok


def record_stage_event(sb, deal, source="webhook", pos_map=None):
    """Grava 1 evento de etapa (idempotente). Nunca levanta — só loga. Retorna bool."""
    try:
        ev = build_event(sb, deal, source=source, pos_map=pos_map)
        if not ev:
            return False
        _upsert_ignore(sb, [ev])
        return True
    except Exception as e:
        print(f"[events] record_stage_event falhou: {e}")
        return False


def record_many(sb, deals, source="sync"):
    """Grava eventos de uma lista de deals (idempotente). Retorna qtde tentada."""
    pos_map = stage_position_map(sb)
    rows = []
    for d in deals or []:
        ev = build_event(sb, d, source=source, pos_map=pos_map)
        if ev:
            rows.append(ev)
    n = 0
    for i in range(0, len(rows), 200):
        n += _upsert_ignore(sb, rows[i:i + 200])
    return n


def record_changes(sb, deals, source="sync"):
    """Rede de segurança do webhook: compara a etapa de cada deal com a já
    armazenada em `deals` e grava evento SÓ quando mudou (ou é deal novo).
    DEVE ser chamada ANTES do upsert dos mesmos deals. Idempotente."""
    deals = [d for d in (deals or []) if isinstance(d, dict) and d.get("id") is not None]
    if not deals:
        return 0
    ids = [str(d.get("id")) for d in deals]
    stored = {}
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        try:
            rows = sb.table("deals").select("id,stage_id").in_("id", chunk).execute().data or []
            for r in rows:
                stored[str(r.get("id"))] = str(r.get("stage_id")) if r.get("stage_id") is not None else None
        except Exception as e:
            print(f"[events] record_changes leitura falhou: {e}")
    pos_map = stage_position_map(sb)
    changed = []
    for d in deals:
        did = str(d.get("id"))
        ns = (d.get("deal_stage") or {}).get("id") if isinstance(d.get("deal_stage"), dict) else None
        ns = str(ns) if ns is not None else None
        if not ns:
            continue
        prev = stored.get(did, "__absent__")
        if prev == ns:
            continue  # etapa não mudou → nada a registrar
        ev = build_event(sb, d, source=source, pos_map=pos_map)
        if ev:
            changed.append(ev)
    n = 0
    for i in range(0, len(changed), 200):
        n += _upsert_ignore(sb, changed[i:i + 200])
    return n


def capture_enabled_since(sb):
    """ISO do 1º evento REAL (não-backfill) — marco a partir do qual a métrica é real.
    None se ainda não há captura real."""
    try:
        r = (sb.table("deal_stage_events")
             .select("occurred_at")
             .neq("source", "backfill")
             .order("occurred_at", desc=False)
             .limit(1)
             .execute().data or [])
        return r[0]["occurred_at"] if r else None
    except Exception:
        return None
