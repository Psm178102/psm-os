# -*- coding: utf-8 -*-
"""Kanban de R&S (gp_talentos) ⇄ RD CRM "FUNIL DE PARCERIA - PAULO". v89.10

Pedido do Paulo (30/09/2026): todos os cadastros do funil de parceria, em todas as etapas
MENOS "Negócios em potencial" e "Conexão negócio com parceiro", ficam integrados ao kanban
de contratações em tempo real.

Regras:
- Cada negócio do RD vira UMA ficha (gp_talentos.rd_deal_id, índice único; id = gpt_rd_<deal>).
- RD → House: quando a etapa do negócio MUDA no RD (≠ rd_etapa guardado), o card vai pra
  coluna equivalente e o histórico registra "RD". Etapa igual = não mexe — assim os passos
  que só existem no House (Avaliação interna, Due Diligence, Proposta…) não são desfeitos.
- House → RD: mover o card pra uma coluna que existe no RD move o negócio lá na hora
  (PUT /deals/:id). Coluna só do House não mexe no RD.
- Negócio que vai pra uma das 2 etapas de fora: a ficha fica, só com o selo da etapa do RD.
- Nome/contato do House nunca são sobrescritos; o RD só preenche o que está vazio.
Fontes que chamam reconciliar(): tela (leitura ao vivo a cada 60 s), cron de 30 min
(espelho `deals`) e o webhook do RD.
"""
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

RD_BASE = "https://crm.rdstation.com/api/v1"
PIPE_NOME = "parceria"
PIPE_ID_PADRAO = "642593f1d4645f001fd6fa2a"   # FUNIL DE PARCERIA - PAULO (fallback)


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s).strip().lower()


# etapa do RD (normalizada) → coluna do kanban
RD_PARA_HOUSE = {
    "interessados vaga corretor": "Interessados",
    "em contato vaga corretor": "Em contato",
    "entrevista marcada": "Entrevista marcada",
    "banco de talentos": "Banco de Talentos",
    "parceiros": "Parceiros",
}
FORA = {"negocios em potencial", "conexao negocio com parceiro"}
HOUSE_PARA_RD = {v: k for k, v in RD_PARA_HOUSE.items()}   # coluna → etapa RD (normalizada)
CAMPOS = "id,nome,contato,email,instagram,etapa,historico,decisao,cenario,rd_deal_id,rd_etapa,rd_status"


def _agora():
    return datetime.now(timezone.utc).isoformat()


def _get(url, timeout=25):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/Talentos"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pipeline_id(sb):
    try:
        for p in sb.table("rd_pipelines").select("id,name").execute().data or []:
            if PIPE_NOME in norm(p.get("name")):
                return str(p["id"])
    except Exception:
        pass
    return PIPE_ID_PADRAO


def etapas_rd(token, pid):
    """{nome normalizado: stage_id} do funil, ao vivo."""
    try:
        data = _get(f"{RD_BASE}/deal_pipelines?token={urllib.parse.quote(token)}&limit=200")
    except Exception:
        return {}
    pipes = data if isinstance(data, list) else (data.get("deal_pipelines") or data.get("items") or [])
    for p in pipes:
        if str(p.get("id")) == str(pid):
            return {norm(s.get("name")): s.get("id") for s in (p.get("deal_stages") or [])}
    return {}


_cache = {}


def deals_ao_vivo(token, pid, ttl=30):
    """Todos os negócios do funil direto do RD (cache curto na função)."""
    c = _cache.get(pid)
    if c and time.time() - c[0] < ttl:
        return c[1]
    out, page = [], 1
    while page <= 10:
        q = urllib.parse.urlencode({"token": token, "deal_pipeline_id": pid, "limit": 200, "page": page})
        deals = (_get(f"{RD_BASE}/deals?{q}") or {}).get("deals") or []
        out.extend(deals)
        if len(deals) < 200:
            break
        page += 1
    _cache[pid] = (time.time(), out)
    return out


def deals_do_espelho(sb, pid):
    rows = sb.table("deals").select("rd_raw,stage_name,win").eq("pipeline_id", pid).limit(2000).execute().data or []
    out = []
    for r in rows:
        d = r.get("rd_raw")
        if isinstance(d, str):
            try:
                d = json.loads(d)
            except Exception:
                d = None
        if isinstance(d, dict) and d.get("id"):
            out.append(d)
    return out


def mover_no_rd(token, deal_id, stage_id):
    url = f"{RD_BASE}/deals/{urllib.parse.quote(str(deal_id))}?token={urllib.parse.quote(token)}"
    body = json.dumps({"deal": {"deal_stage_id": stage_id}}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PUT",
                                 headers={"Accept": "application/json", "Content-Type": "application/json",
                                          "User-Agent": "PSM-OS-v3/Talentos"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
        _cache.clear()
        return None
    except urllib.error.HTTPError as e:
        try:
            det = e.read().decode("utf-8")[:200]
        except Exception:
            det = ""
        return f"RD HTTP {e.code} {det}".strip()
    except Exception as e:
        return str(e)


# ── leitura do negócio ──
def _fone(d):
    for c in (d.get("contacts") or []):
        for ph in (c.get("phones") or []):
            dig = re.sub(r"\D", "", str(ph.get("phone") or ""))
            if len(dig) >= 10:
                return dig if dig.startswith("55") or len(dig) > 11 else "55" + dig
    return None


def _email(d):
    for c in (d.get("contacts") or []):
        for em in (c.get("emails") or []):
            if em.get("email"):
                return em["email"]
    return None


def _instagram(d):
    for cf in (d.get("deal_custom_fields") or []):
        label = norm((cf.get("custom_field") or {}).get("label") or cf.get("label"))
        if label in ("instagram", "ig", "insta") and cf.get("value"):
            return str(cf["value"])[:200]
    return None


def _status(d):
    w = d.get("win")
    return "ganho" if w is True else "perdido" if w is False else "aberto"


def _hist(v):
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = []
    return v if isinstance(v, list) else []


def reconciliar(sb, deals, pid=None):
    """Aplica os negócios do funil de parceria no kanban. Idempotente. → resumo."""
    pid = str(pid or pipeline_id(sb))
    deals = [d for d in deals if d and d.get("id")]
    fichas = sb.table("gp_talentos").select(CAMPOS).limit(5000).execute().data or []
    por_deal = {str(f["rd_deal_id"]): f for f in fichas if f.get("rd_deal_id")}
    soltas = [f for f in fichas if not f.get("rd_deal_id")]
    # vínculo de fichas antigas: link do RD no cenário (botão ⭐) ou nome completo idêntico e único
    por_nome = {}
    for f in soltas:
        por_nome.setdefault(norm(f.get("nome")), []).append(f)

    agora = _agora()
    novos, alterados = [], 0
    for d in deals:
        did = str(d["id"])
        etapa_rd = ((d.get("deal_stage") or {}).get("name") or "").strip()
        en = norm(etapa_rd)
        f = por_deal.get(did)
        if not f:
            if en in FORA:
                continue   # nunca cria ficha pelas 2 etapas de fora
            cand = [s for s in soltas if did in (s.get("cenario") or "")]
            if not cand:
                nm = norm(d.get("name"))
                grupo = por_nome.get(nm) or []
                if len(nm.split()) >= 2 and len(grupo) == 1:
                    cand = grupo
            if cand:
                f = cand[0]
                soltas.remove(f)
                patch = {"rd_deal_id": did, "rd_etapa": etapa_rd, "rd_status": _status(d), "rd_sync_at": agora}
                for k, v in (("contato", _fone(d)), ("email", _email(d)), ("instagram", _instagram(d))):
                    if v and not f.get(k):
                        patch[k] = v
                sb.table("gp_talentos").update(patch).eq("id", f["id"]).execute()
                alterados += 1
                continue
            user = d.get("user") or {}
            vaga = "vaga corretor" in en
            novos.append({
                "id": f"gpt_rd_{did}",
                "nome": (d.get("name") or "Sem nome")[:200],
                "contato": _fone(d), "email": _email(d), "instagram": _instagram(d),
                "responsavel": (user.get("name") if isinstance(user, dict) else None),
                "setor": "Comercial" if vaga else None,
                "cargo": "Corretor" if vaga else None,
                "etapa": RD_PARA_HOUSE.get(en, "Interessados"),
                "decisao": "Reprovado" if d.get("win") is False else "Em andamento",
                "origem": "rd", "canal": "RD Station", "status": "em análise",
                "cenario": f"Veio do RD — funil de Parceria. https://crm.rdstation.com/app/deals/{did}",
                "data": (d.get("created_at") or "")[:10] or None,
                "rd_deal_id": did, "rd_etapa": etapa_rd, "rd_status": _status(d), "rd_sync_at": agora,
                "historico": [{"de": "", "para": RD_PARA_HOUSE.get(en, "Interessados"),
                               "by": "RD (importação)", "at": agora}],
                "criado_por": None, "updated_at": agora,   # FK p/ users — quem criou é o RD (ver historico)
            })
            continue

        patch = {}
        if norm(f.get("rd_etapa")) != en:
            patch["rd_etapa"] = etapa_rd
            nova = RD_PARA_HOUSE.get(en)
            if nova and nova != f.get("etapa"):
                patch["etapa"] = nova
                patch["historico"] = _hist(f.get("historico")) + [
                    {"de": f.get("etapa") or "", "para": nova, "by": "RD", "at": agora}]
        st = _status(d)
        if st != (f.get("rd_status") or ""):
            patch["rd_status"] = st
            if st == "perdido" and (f.get("decisao") or "Em andamento") == "Em andamento":
                patch["decisao"] = "Reprovado"
        if patch:
            patch["rd_sync_at"] = agora
            patch["updated_at"] = agora
            sb.table("gp_talentos").update(patch).eq("id", f["id"]).execute()
            alterados += 1

    for i in range(0, len(novos), 100):
        sb.table("gp_talentos").upsert(novos[i:i + 100], on_conflict="id").execute()
    return {"lidos": len(deals), "novos": len(novos), "alterados": alterados}


def empurrar_etapa(sb, token, ficha, etapa_nova):
    """House → RD. Move o negócio se a coluna existe no RD. → (rd_etapa_nova|None, erro|None)."""
    did = ficha.get("rd_deal_id")
    alvo = HOUSE_PARA_RD.get(etapa_nova)
    if not did or not alvo:
        return None, None
    if norm(ficha.get("rd_etapa")) == alvo:
        return None, None
    if not token:
        return None, "RD_API_TOKEN não configurado"
    stages = etapas_rd(token, pipeline_id(sb))
    sid = stages.get(alvo)
    if not sid:
        return None, f"etapa '{alvo}' não encontrada no funil do RD"
    err = mover_no_rd(token, did, sid)
    if err:
        return None, err
    return NOME_RD.get(alvo, alvo), None


# grafia do RD, guardada em rd_etapa (a reconciliação compara normalizado)
NOME_RD = {"interessados vaga corretor": "Interessados vaga corretor",
           "em contato vaga corretor": "Em contato vaga corretor",
           "entrevista marcada": "Entrevista marcada",
           "banco de talentos": "Banco de talentos",
           "parceiros": "Parceiros"}
