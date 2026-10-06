# -*- coding: utf-8 -*-
"""
Lead da vitrine psmempreendimentos.com.br → negócio no RD Station CRM. v89.38

O lead que chega pelo lp_webhook com origem 'lp_psmempreendimentos' também nasce
no FUNIL MAP, etapa NOVO ATENDIMENTO, com o Paulo de responsável.
Cliente que JÁ tem negócio aberto no RD não duplica: o card continua do dono.

Env (opcionais — os padrões abaixo são os ids do RD em out/2026):
  VITRINE_RD_STAGE       id da etapa de entrada
  VITRINE_RD_DONO_EMAIL  e-mail do responsável no RD
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

RD_BASE = "https://crm.rdstation.com/api/v1"
HTTP_TIMEOUT = 12
STAGE_NOVO_ATENDIMENTO_MAP = "67fbd52235ad8200142ed2b1"   # FUNIL MAP → NOVO ATENDIMENTO
DONO_EMAIL = "paulo@imobiliariapsm.com.br"
DONO_HOUSE_ID = "paulo"


def _rd(path, method="GET", payload=None):
    tok = (os.environ.get("RD_CRM_TOKEN") or os.environ.get("RD_API_TOKEN") or "").strip()
    if not tok:
        return None, "RD_CRM_TOKEN não configurado"
    sep = "&" if "?" in path else "?"
    url = f"{RD_BASE}{path}{sep}token={urllib.parse.quote(tok)}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8") or "{}"), None
    except urllib.error.HTTPError as e:
        try:
            corpo = e.read().decode("utf-8")[:200]
        except Exception:
            corpo = ""
        return None, f"RD {e.code}: {corpo}"
    except Exception as e:
        return None, f"RD: {str(e)[:150]}"


def _dono_id(email):
    data, err = _rd("/users", "GET")
    if err:
        return None
    users = data if isinstance(data, list) else ((data or {}).get("users") or [])
    for u in users:
        if (u.get("email") or "").strip().lower() == email:
            return u.get("id")
    return None


def _deal_aberto(phone):
    data, err = _rd(f"/contacts?q={urllib.parse.quote(phone[-11:])}", "GET")
    contatos = ((data or {}).get("contacts") or []) if not err else []
    if not contatos or not contatos[0].get("id"):
        return None
    data2, err2 = _rd(f"/deals?contact_id={urllib.parse.quote(str(contatos[0]['id']))}", "GET")
    if err2:
        return None
    for d in ((data2 or {}).get("deals") or []):
        if not d.get("closed_at") and d.get("win") is None:
            return d
    return None


def criar_negocio(sb, row, faixa_txt):
    """row = linha recém-gravada em leads_lp. Devolve (deal_id, motivo). Nunca levanta."""
    try:
        phone = row.get("whatsapp") or ""
        ja = _deal_aberto(phone)
        if ja:
            return ja.get("id"), "já tinha negócio aberto no RD — não duplicou"

        stage = (os.environ.get("VITRINE_RD_STAGE") or STAGE_NOVO_ATENDIMENTO_MAP).strip()
        email_dono = (os.environ.get("VITRINE_RD_DONO_EMAIL") or DONO_EMAIL).strip().lower()
        interesse = row.get("pagina_ancora") or ""
        deal = {"name": f"{row.get('nome')} · Vitrine PSM Imóveis" + (f" · {interesse}" if interesse else ""),
                "deal_stage_id": stage}
        uid = _dono_id(email_dono)
        if uid:
            deal["user_id"] = uid
        contato = {"name": row.get("nome"), "phones": [{"phone": "+" + phone, "type": "cellphone"}]}
        if row.get("email"):
            contato["emails"] = [{"email": row["email"]}]
        data, err = _rd("/deals", "POST", {"deal": deal, "contacts": [contato]})
        if err or not (data or {}).get("id"):
            return None, err or "RD não devolveu o id do negócio"

        # anotação com o que o cliente escolheu no site (o corretor abre o card e já sabe)
        utms = row.get("utms") or {}
        linhas = ["Lead da vitrine psmempreendimentos.com.br", f"Faixa de investimento: {faixa_txt}"]
        if interesse:
            linhas.append(f"Interesse: {interesse}")
        if utms:
            linhas.append("Origem: " + " · ".join(f"{k.replace('utm_', '')}={v}" for k, v in utms.items()))
        anot = {"deal_id": data["id"], "text": "\n".join(linhas)}
        if uid:
            anot["user_id"] = uid
        _rd("/activities", "POST", {"activity": anot})

        # espelho no House: o card aparece no kanban na hora; o próximo sync faz upsert por id
        stage_o = data.get("deal_stage") or {}
        pipe_o = data.get("deal_pipeline") or {}
        try:
            sb.table("deals").upsert({
                "id": data["id"], "name": (data.get("name") or "")[:255], "win": data.get("win"),
                "created_at_rd": data.get("created_at"), "updated_at_rd": data.get("updated_at"),
                "pipeline_id": pipe_o.get("id") if isinstance(pipe_o, dict) else None,
                "pipeline_name": pipe_o.get("name") if isinstance(pipe_o, dict) else None,
                "stage_id": (stage_o.get("id") if isinstance(stage_o, dict) else None) or stage,
                "stage_name": stage_o.get("name") if isinstance(stage_o, dict) else None,
                "user_email": email_dono, "user_id": DONO_HOUSE_ID, "rd_raw": data,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="id").execute()
        except Exception:
            pass
        return data["id"], "negócio criado no FUNIL MAP"
    except Exception as e:
        return None, f"falha: {str(e)[:150]}"
