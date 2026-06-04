"""
_briefing_lib.py — Briefing de Guerra (boletim do comandante).

Compila os FATOS REAIS da semana (vendas + mídia + concorrência) e gera o
briefing estratégico com a IA — por AUTO-CHAMADA ao /api/ad-analysis... err,
/api/ai-analysis, que usa o motor ativo (gemini-2.5-flash). Uma única fonte de
verdade de IA (com fallback/redação do _ai.js). Usado pelo endpoint manual
(war_briefing.py) e pelo cron semanal (war_briefing_cron.py).
"""
import os
import json
import urllib.request
from datetime import datetime, timezone, timedelta

from _oo_lib import parse_dt, amount, read_meta_spend  # type: ignore
from _brain_lib import loss_clusters  # type: ignore

PUBLIC_BASE = (os.environ.get("PUBLIC_BASE_URL") or "https://www.housepsm.com.br").rstrip("/")


def _fetch_closed(sb, since_iso):
    cols = "id,amount,win,closed_at,created_at_rd,rd_raw"
    out, page, size = [], 0, 1000
    while page < 20:
        try:
            rows = (sb.table("deals").select(cols)
                    .gte("closed_at", since_iso)
                    .range(page * size, page * size + size - 1).execute().data or [])
        except Exception:
            break
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
    return out


def compile_facts(sb, today):
    """Resumo enxuto de fatos REAIS pra alimentar o briefing."""
    facts = {"data": today.isoformat()}
    month_start = today.replace(day=1)
    since90 = (today - timedelta(days=90)).isoformat() + "T00:00:00+00:00"

    # ── Vendas ──
    closed = _fetch_closed(sb, since90)
    wins_m_vgv, wins_m_n, losses = 0.0, 0, []
    for d in closed:
        if d.get("win") is True:
            cl = parse_dt(d.get("closed_at"))
            if cl and cl.date() >= month_start:
                wins_m_vgv += amount(d)
                wins_m_n += 1
        elif d.get("win") is False:
            losses.append(d)
    open_count = None
    try:
        oc = sb.table("deals").select("id", count="exact").is_("win", "null").limit(1).execute()
        open_count = oc.count or 0
    except Exception:
        pass
    lc = loss_clusters(losses)
    facts["vendas"] = {
        "vgv_mes": round(wins_m_vgv, 2), "vendas_mes": wins_m_n,
        "pipeline_aberto": open_count,
        "perdas_90d": lc.get("total"),
        "trash_pct": lc.get("trash_pct"),
        "top_motivos_perda": [[c["label"], c["n"], c["pct"]] for c in (lc.get("categorias") or [])[:4]],
    }

    # ── Mídia (Meta) ──
    try:
        spend = read_meta_spend(sb)
    except Exception:
        spend = None
    leads_30d = None
    try:
        m30 = (today - timedelta(days=29)).isoformat() + "T00:00:00+00:00"
        r = sb.table("deals").select("id", count="exact").gte("created_at_rd", m30).limit(1).execute()
        leads_30d = r.count or 0
    except Exception:
        pass
    facts["ads"] = {
        "meta_spend_mensal": round(spend, 2) if spend else None,
        "leads_30d": leads_30d,
        "cpl": round(spend / leads_30d, 2) if (spend and leads_30d) else None,
    }

    # ── Concorrência (Biblioteca de Anúncios) ──
    conc = []
    try:
        rows = (sb.table("ad_library_snapshots")
                .select("concorrente,ads_count,nivel_invest,captured_at")
                .order("captured_at", desc=True).limit(200).execute().data or [])
        seen = set()
        for r in rows:
            c = r.get("concorrente")
            if c and c not in seen:
                seen.add(c)
                conc.append({"concorrente": c, "ads": r.get("ads_count"), "nivel": r.get("nivel_invest")})
    except Exception:
        pass
    facts["concorrencia"] = conc[:8]
    return facts


def build_prompt(facts):
    v = facts.get("vendas") or {}
    a = facts.get("ads") or {}
    c = facts.get("concorrencia") or []
    motivos = "; ".join(f"{m[0]} {m[1]} ({m[2]}%)" for m in (v.get("top_motivos_perda") or [])) or "—"
    conc = "; ".join(f"{x['concorrente']} ({x.get('ads') or '?'} anúncios)" for x in c) or "sem captura ainda"
    return f"""Você é o chefe de inteligência de uma imobiliária de São José do Rio Preto que quer ser a MAIOR do estado em 2-3 anos. Escreva o BRIEFING DE GUERRA desta semana pro sócio Paulo, em markdown, direto e estratégico — sem encher linguiça e SEM inventar número além dos fatos abaixo.

Estruture exatamente assim:
## 🎯 Situação
(3-4 linhas: como entramos na semana)
## ⚔️ Frente de batalha
(o que importa em vendas, mídia e concorrência)
## 🔥 3 ordens da semana
(ações concretas e priorizadas — numeradas)
## ⚠️ Riscos / pontos cegos
(o que pode nos pegar)

FATOS REAIS:
- VENDAS: {v.get('vendas_mes', 0)} vendas no mês, VGV R$ {v.get('vgv_mes', 0)}, pipeline aberto {v.get('pipeline_aberto', '?')} negócios. Perdas 90d: {v.get('perdas_90d', '?')} ({v.get('trash_pct', '?')}% lixo/desqualificado). Top motivos de perda: {motivos}.
- MÍDIA (Meta Ads): gasto mensal ~R$ {a.get('meta_spend_mensal') or '?'}, leads 30d {a.get('leads_30d') or '?'}, CPL ~R$ {a.get('cpl') or '?'}.
- CONCORRÊNCIA (Biblioteca de Anúncios): {conc}."""


def _ai_text(prompt, max_tokens=1800):
    body = json.dumps({"prompt": prompt, "max_tokens": max_tokens}).encode("utf-8")
    req = urllib.request.Request(
        PUBLIC_BASE + "/api/ai-analysis", data=body,
        headers={"Content-Type": "application/json", "User-Agent": "PSM-OS/briefing"})
    with urllib.request.urlopen(req, timeout=70) as resp:
        d = json.loads(resp.read().decode("utf-8"))
    if not d.get("ok") or not d.get("text"):
        raise RuntimeError("IA indisponível: " + str(d.get("error") or "sem texto"))
    return d.get("text"), d.get("model_used")


def generate_and_store(sb, actor_id=None):
    """Compila → gera com IA → tenta salvar. Retorna o briefing mesmo se a
    tabela war_briefings ainda não existir (saved=False)."""
    today = datetime.now(timezone.utc).date()
    facts = compile_facts(sb, today)
    text, model = _ai_text(build_prompt(facts))
    row = {"briefing": text, "facts": facts, "model": model, "criado_por": actor_id}
    saved = None
    try:
        res = sb.table("war_briefings").insert(row).execute()
        saved = (res.data or [row])[0]
    except Exception:
        saved = None  # tabela ainda não criada — degrada gracioso
    return {"facts": facts, "briefing": text, "model": model,
            "saved": bool(saved), "item": saved,
            "generated_at": datetime.now(timezone.utc).isoformat()}
