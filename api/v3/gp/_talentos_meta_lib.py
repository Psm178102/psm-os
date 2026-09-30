# -*- coding: utf-8 -*-
"""Lead das campanhas de CONTRATAÇÃO (Meta) → ficha nova em "Interessados" no kanban de R&S. v89.15

Pedido do Paulo (30/09/2026): "toda vez que cair um lead das campanhas de contratação ele deverá ser
criado uma oportunidade nova em Interessados no kanban do House".

Por que direto do Meta (e não só via RD): no cruzamento de 30/09, 6 de 97 leads das planilhas do Meta
nunca chegaram ao RD. O webhook de Lead Ads do House (marketing/leads_webhook) nunca recebeu nada
(tabela meta_leads vazia) — então o caminho garantido é BUSCAR: cron lê os leads dos anúncios cujas
campanhas têm "VAGA" no nome e cria a ficha. O funil do RD continua ligando por cima (mesmo telefone
= mesma ficha, ver _talentos_rd_lib.reconciliar).

Campanha de contratação = nome da campanha OU do formulário contém "VAGA" (ex.: "[VAGAS CONQUISTA] …",
"[PSM CONQUISTA VAGAS] …").
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

GRAPH = "https://graph.facebook.com/v21.0"
KV = "talentos_meta_ultimo"
RESPONSAVEL = "Isabella Morimatsu"   # pedido do Paulo 30/09 p/ os leads de vagas
MARCA = re.compile(r"vaga", re.I)


def _token():
    return os.environ.get("META_LEADS_TOKEN") or os.environ.get("META_ACCESS_TOKEN")


def _get(path, params):
    p = dict(params)
    p["access_token"] = _token()
    url = f"{GRAPH}/{path}?{urllib.parse.urlencode(p)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS/talentos-meta"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        try:
            det = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            det = ""
        return None, f"Meta HTTP {e.code} {det}"[:300]
    except Exception as e:
        return None, str(e)[:300]


def _todas(path, params, teto=20):
    out, erro, n = [], None, 0
    data, erro = _get(path, params)
    while data and n < teto:
        out.extend(data.get("data") or [])
        nxt = (data.get("paging") or {}).get("next")
        if not nxt:
            break
        try:
            with urllib.request.urlopen(nxt, timeout=25) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception as e:
            erro = str(e)[:200]
            break
        n += 1
    return out, erro


def _contas(sb):
    mk = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "marketing")
    if mk not in sys.path:
        sys.path.insert(0, mk)
    try:
        from _accounts_lib import resolver_contas  # type: ignore
        ids, _, _ = resolver_contas(sb)
    except Exception:
        ids = [s.strip() for s in (os.environ.get("META_AD_ACCOUNT_IDS") or "").split(",") if s.strip()]
    return [i if i.startswith("act_") else "act_" + i for i in ids]


def _campo(fd, *chaves):
    for f in fd or []:
        k = (f.get("name") or "").lower()
        if any(c in k for c in chaves):
            v = (f.get("values") or [None])[0]
            if v not in (None, ""):
                return str(v).strip()
    return None


def _digitos(v):
    d = re.sub(r"\D", "", str(v or ""))
    if 10 <= len(d) <= 11:
        d = "55" + d
    return d


def _ultimo(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV).limit(1).execute().data or []
        ts = (rows[0]["value"] or {}).get("ts") if rows else None
        if ts:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        pass
    return datetime.now(timezone.utc) - timedelta(days=60)


def _marcar(sb, ts, resumo):
    agora = datetime.now(timezone.utc).isoformat()
    try:
        sb.table("shared_kv").upsert({"key": KV, "value": {"ts": ts, "rodou": agora, **resumo},
                                      "updated_at": agora}, on_conflict="key").execute()
    except Exception as e:
        print(f"[talentos_meta] kv: {e}")


def ficha_de_lead(lead, campanha=None, anuncio=None):
    fd = lead.get("field_data") or []
    fone = _digitos(_campo(fd, "phone", "telefone", "celular", "whats"))
    email = (_campo(fd, "email") or "").lower() or None
    nome = _campo(fd, "full_name", "nome", "name") or "Lead sem nome"
    exp = _campo(fd, "experiencia", "experiência")
    creci = _campo(fd, "creci")
    pret = _campo(fd, "pretens", "ganhos")
    cidade = _campo(fd, "cidade", "city")
    criado = (lead.get("created_time") or "")[:10] or None
    agora = datetime.now(timezone.utc).isoformat()
    creci_fmt = {"sim": "Sim", "não": "Não", "nao": "Não"}.get((creci or "").lower(), creci)
    return {
        "id": f"gpt_meta_{fone or lead.get('id')}",
        "nome": nome[:200], "contato": fone or None, "email": email,
        "responsavel": RESPONSAVEL, "etapa": "Interessados", "decisao": "Em andamento",
        "canal": "Campanha / Anúncio", "origem": "manual", "status": "em análise",
        "setor": "Comercial", "cargo": "Corretor", "categoria": "Conquista",
        "creci": creci_fmt,
        "experiencia": f"Experiência com vendas: {exp or '—'} · CRECI: {creci_fmt or '—'}" + (f" · Cidade: {cidade}" if cidade else ""),
        "pretensao": (pret or "").replace("_", " ")[:80] or None,
        "cenario": f"Lead da campanha de vagas (Meta) — campanha: {campanha or '—'} · anúncio: {anuncio or '—'}. "
                   f"Entrou em {criado or '—'}. Lead Meta {lead.get('id')}.",
        "data": criado,
        "historico": [{"de": "", "para": "Interessados", "by": "Meta (lead da campanha de vagas)", "at": agora}],
        "criado_por": None, "updated_at": agora,
    }


def _ja_existe(fichas, f):
    f8 = (f.get("contato") or "")[-8:]
    em = (f.get("email") or "").lower()
    for x in fichas:
        xf = re.sub(r"\D", "", x.get("contato") or "")
        if f8 and len(f8) == 8 and len(xf) >= 8 and xf[-8:] == f8:
            return x
        if em and (x.get("email") or "").lower() == em:
            return x
    return None


def criar_fichas(sb, leads_com_ctx):
    """[(lead, campanha, anuncio)] → cria só quem ainda não está no kanban (telefone/e-mail)."""
    fichas = sb.table("gp_talentos").select("id,contato,email").limit(5000).execute().data or []
    novas = []
    for lead, camp, ad in leads_com_ctx:
        f = ficha_de_lead(lead, camp, ad)
        if _ja_existe(fichas + novas, f):
            continue
        novas.append(f)
    for i in range(0, len(novas), 100):
        sb.table("gp_talentos").upsert(novas[i:i + 100], on_conflict="id", ignore_duplicates=True).execute()
    return novas


def sincronizar(sb):
    """Busca leads novos das campanhas de vagas em todas as contas e cria as fichas."""
    if not _token():
        return {"ok": False, "erro": "META_ACCESS_TOKEN ausente"}
    desde = _ultimo(sb) - timedelta(hours=2)   # margem: lead pode aparecer com atraso no Graph
    ts_filtro = int(desde.timestamp())
    achados, erros, anuncios = [], [], 0
    for conta in _contas(sb):
        ads, err = _todas(f"{conta}/ads", {
            "fields": "id,name,campaign{name}",
            "filtering": json.dumps([{"field": "campaign.name", "operator": "CONTAIN", "value": "vaga"}]),
            "limit": 200})
        if err:
            erros.append(f"{conta}: {err}")
        for ad in ads:
            camp = ((ad.get("campaign") or {}).get("name")) or ""
            if not MARCA.search(camp):
                continue
            anuncios += 1
            leads, err = _todas(f"{ad['id']}/leads", {
                "fields": "id,created_time,field_data,form_id",
                "filtering": json.dumps([{"field": "time_created", "operator": "GREATER_THAN", "value": ts_filtro}]),
                "limit": 100})
            if err:
                erros.append(f"ad {ad['id']}: {err}")
            achados.extend((l, camp, ad.get("name")) for l in leads)
    novas = criar_fichas(sb, achados) if achados else []
    resumo = {"anuncios": anuncios, "leads": len(achados), "criadas": len(novas),
              "nomes": [n["nome"] for n in novas][:20], "erros": erros[:5]}
    if not erros or achados:
        _marcar(sb, datetime.now(timezone.utc).isoformat(), resumo)
    return {"ok": not erros, **resumo}
