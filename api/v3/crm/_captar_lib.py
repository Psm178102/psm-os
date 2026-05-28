"""Helper compartilhado: importa deals da etapa CAPTAR IMÓVEL (funil CARTEIRA MAP)
do RD CRM e cria captações "À fazer" no Kanban (dedup por rd_deal_id).

Usado por captar_cron.py (cron dedicado) e sync_cron.py (piggyback 3×/dia).
"""
import json, os, re, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

RD_BASE = "https://crm.rdstation.com/api/v1"

try:
    from _auth_lib import notify_all as notify  # type: ignore  # fan-out (in-app + web push)
except Exception:  # pragma: no cover
    def notify(*a, **k):  # fallback no-op
        return 0


def _stage_key(name):
    n = (name or "").lower()
    if "captar" in n or "captaç" in n or "captac" in n: return "captar"
    if "90" in n or "noventa" in n: return "noventa"
    if re.search(r"\bsdr\b", n) or "sdr" in n: return "sdr"
    if "ativo" in n or "carteira" in n: return "ativo"
    return "outros"


def _contact_phone(d):
    for c in (d.get("contacts") or []):
        for ph in (c.get("phones") or []):
            dig = re.sub(r"\D", "", str(ph.get("phone") or ph.get("number") or ""))
            if dig:
                if len(dig) <= 11 and not dig.startswith("55"):
                    dig = "55" + dig
                return dig
    return None


def _contact_name(d):
    for c in (d.get("contacts") or []):
        if c.get("name"): return c["name"]
    return None


def _contact_email(d):
    for c in (d.get("contacts") or []):
        for em in (c.get("emails") or []):
            if em.get("email"): return em["email"]
    return None


def _rd_deals_by_stage(stage_id, token, limit=400):
    out, page = [], 1
    while True:
        p = {"token": token, "deal_stage_id": stage_id, "limit": 200, "page": page}
        url = f"{RD_BASE}/deals?{urllib.parse.urlencode(p)}"
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/captar"})
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"error": str(e), "deals": out}
        deals = data.get("deals") or data.get("items") or []
        out.extend(deals)
        if len(deals) < 200 or len(out) >= limit or page >= 25:
            break
        page += 1
    return {"deals": out[:limit]}


def _resolve_captar_stage(sb):
    """Retorna (pipeline_dict, stage_id) da etapa CAPTAR IMÓVEL do funil CARTEIRA MAP."""
    try:
        pipes = sb.table("rd_pipelines").select("*").execute().data or []
        stages = sb.table("rd_stages").select("*").execute().data or []
    except Exception:
        return None, None
    carteiras = [p for p in pipes if "carteira" in (p.get("name") or "").lower()]
    chosen = next((p for p in carteiras if (p.get("name") or "").strip().lower() == "carteira map"), None) \
        or (carteiras[0] if carteiras else None)
    if not chosen:
        return None, None
    pid = chosen.get("id") or chosen.get("external_id")
    for s in stages:
        if str(s.get("pipeline_id") or s.get("rd_pipeline_id") or "") in (str(pid), str(chosen.get("external_id"))):
            if _stage_key(s.get("name")) == "captar":
                return chosen, (s.get("id") or s.get("external_id"))
    return chosen, None


def _notify_gestao(sb, nome, cid, actor_id=None):
    try:
        rows = sb.table("users").select("id,name,role").execute().data or []
        ids = [r["id"] for r in rows if (r.get("role") in ("socio", "diretor", "gerente", "backoffice", "marketing"))
               or "leire" in (r.get("name") or "").lower()]
        ids = [i for i in ids if i and i != actor_id]
        if ids:
            notify(ids, "captacao", "🎯 Nova captação (RD → CAPTAR IMÓVEL)",
                   f"{nome} — entrou na etapa Captar Imóvel do CARTEIRA MAP",
                   link="/v2/captacoes", target_type="captacoes", target_id=cid)
    except Exception:
        pass


def _rd_get_deal(deal_id, token):
    """Busca 1 deal ao vivo no RD (payload completo com contatos/etapa)."""
    if not deal_id or not token:
        return None
    url = f"{RD_BASE}/deals/{urllib.parse.quote(str(deal_id))}?token={urllib.parse.quote(token)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/captar"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def is_captar_stage(d):
    """True se o deal está numa etapa cujo nome indica 'captar imóvel'."""
    if not isinstance(d, dict):
        return False
    st = d.get("deal_stage") or {}
    name = st.get("name") if isinstance(st, dict) else (st if isinstance(st, str) else "")
    return _stage_key(name) == "captar"


def create_captacao_from_deal(sb, d):
    """Cria UMA captação 'À fazer' a partir de um deal RD, se ainda não existir
    (dedup por rd_deal_id). Notifica gestão/Leire. Retorna o id ou None."""
    if not sb or not isinstance(d, dict):
        return None
    did = str(d.get("id") or "")
    if not did or did == "None":
        return None
    try:
        ex = sb.table("captacoes").select("id").eq("rd_deal_id", did).limit(1).execute().data or []
        if ex:
            return ex[0]["id"]  # já existe — não duplica
    except Exception:
        pass
    nome = _contact_name(d) or d.get("name") or "Proprietário"
    cid = f"cap_rd_{did}"
    row = {
        "id": cid, "objetivo": "venda", "status": "a_fazer",
        "condominio": (d.get("name") or "")[:255] or None,
        "proprietario": nome, "contato": _contact_phone(d), "email": _contact_email(d),
        "rd_deal_id": did, "precisa_avaliacao": True,
        "observacao": f"Criada automaticamente do RD (etapa CAPTAR IMÓVEL) · deal {did}",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        sb.table("captacoes").upsert(row, on_conflict="id").execute()
        _notify_gestao(sb, nome, cid)
        return cid
    except Exception as e:
        print(f"[captar] falha {did}: {e}")
        return None


def import_captar(sb, token):
    """Cria captações 'À fazer' pra cada lead na etapa CAPTAR IMÓVEL.
    Robusto: resolve a etapa pela tabela `deals` (sincronizada do RD, nome real
    da etapa, ex. '🔴 CAPTAR IMÓVEL') — NÃO depende de rd_stages (que fica stale).
    Combina deals já sincronizados (rd_raw) + busca AO VIVO no RD por stage_id
    (pega quem entrou agora). Idempotente: dedup por rd_deal_id."""
    if not sb:
        return {"ok": False, "error": "sb ausente", "created": 0}

    candidates = {}   # deal_id -> payload (rd_raw sincronizado ou deal ao vivo)
    stage_ids = set()
    # 1) Fonte robusta: deals já sincronizados cuja etapa contém "captar"
    try:
        rows = sb.table("deals").select("id,name,stage_id,stage_name,rd_raw").ilike("stage_name", "%captar%").execute().data or []
        for r in rows:
            did = str(r.get("id"))
            raw = r.get("rd_raw")
            candidates[did] = raw if isinstance(raw, dict) and raw else {"id": did, "name": r.get("name")}
            if r.get("stage_id"):
                stage_ids.add(r["stage_id"])
    except Exception as e:
        return {"ok": False, "error": f"deals: {e}", "created": 0}

    # 2) Tempo real: busca AO VIVO no RD por cada stage_id descoberto (pega novos)
    if token:
        for sid in list(stage_ids)[:5]:
            rr = _rd_deals_by_stage(sid, token)
            if not rr.get("error"):
                for d in (rr.get("deals") or []):
                    candidates[str(d.get("id"))] = d

    if not candidates:
        return {"ok": True, "created": 0, "deals_na_etapa": 0,
                "note": "nenhum lead na etapa CAPTAR (deals + RD)"}

    # 3) Dedup contra captações existentes
    try:
        existing = sb.table("captacoes").select("rd_deal_id").execute().data or []
        seen = {str(x["rd_deal_id"]) for x in existing if x.get("rd_deal_id")}
    except Exception as e:
        return {"ok": False, "error": f"dedup: {e}", "created": 0}

    created = []
    for did, d in candidates.items():
        if not did or did == "None" or did in seen:
            continue
        nome = _contact_name(d) or d.get("name") or "Proprietário"
        cid = f"cap_rd_{did}"
        row = {
            "id": cid, "objetivo": "venda", "status": "a_fazer",   # À Fazer Captação
            "condominio": (d.get("name") or "")[:255] or None,
            "proprietario": nome, "contato": _contact_phone(d), "email": _contact_email(d),
            "rd_deal_id": did, "precisa_avaliacao": True,
            "observacao": f"Criada automaticamente do RD (etapa CAPTAR IMÓVEL) · deal {did}",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            sb.table("captacoes").upsert(row, on_conflict="id").execute()
            created.append(cid)
            seen.add(did)
            _notify_gestao(sb, nome, cid)
        except Exception as e:
            print(f"[captar_import] falha {did}: {e}")

    return {"ok": True, "created": len(created), "captacao_ids": created,
            "deals_na_etapa": len(candidates), "stage_ids": list(stage_ids)}
