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


def import_captar(sb, token):
    """Cria captações 'À fazer' pra cada deal novo na etapa CAPTAR IMÓVEL.
    Idempotente: dedup por captacoes.rd_deal_id. Retorna resumo."""
    if not sb or not token:
        return {"ok": False, "error": "sb/token ausente", "created": 0}
    pipe, stage_id = _resolve_captar_stage(sb)
    if not stage_id:
        return {"ok": False, "error": "etapa CAPTAR IMÓVEL não resolvida (rode sync de funis)", "created": 0}

    r = _rd_deals_by_stage(stage_id, token)
    if r.get("error"):
        return {"ok": False, "error": "RD: " + r["error"], "created": 0}
    deals = r.get("deals") or []

    # dedup: ids já importados
    try:
        existing = sb.table("captacoes").select("rd_deal_id").execute().data or []
        seen = {str(x["rd_deal_id"]) for x in existing if x.get("rd_deal_id")}
    except Exception as e:
        return {"ok": False, "error": f"dedup: {e}", "created": 0, "deals": len(deals)}

    created = []
    for d in deals:
        did = str(d.get("id"))
        if not did or did in seen:
            continue
        nome = _contact_name(d) or d.get("name") or "Proprietário"
        cid = f"cap_rd_{did}"
        row = {
            "id": cid,
            "objetivo": "venda",
            "status": "a_fazer",                       # À Fazer Captação
            "condominio": (d.get("name") or "")[:255] or None,
            "proprietario": nome,
            "contato": _contact_phone(d),
            "email": _contact_email(d),
            "rd_deal_id": did,
            "precisa_avaliacao": True,
            "observacao": f"Criada automaticamente do RD (CARTEIRA MAP → Captar Imóvel) · deal {did}",
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
            "deals_na_etapa": len(deals), "pipeline": (pipe or {}).get("name")}
