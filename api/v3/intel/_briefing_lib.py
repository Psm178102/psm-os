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
# v84.4 — dossiê rico + frente_of (fonte única)
from _dossie_lib import compile_dossie, _emails_fora  # type: ignore
from _auth_lib import frente_of, hoje_brt  # type: ignore


def _fetch_closed(sb, since_iso):
    cols = "id,amount,win,closed_at,created_at_rd,rd_raw,user_email"
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
    _fora = _emails_fora(sb)   # v88.95: negócios fora das métricas
    out = [d for d in out if (d.get("user_email") or "").strip().lower() not in _fora]
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
        _fora = _emails_fora(sb)   # v88.95: negócios fora das métricas saem do pipeline aberto
        if _fora:
            of = sb.table("deals").select("id", count="exact").is_("win", "null").in_("user_email", list(_fora)).limit(1).execute()
            open_count = max(0, open_count - (of.count or 0))
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
    spend_preset = None
    try:
        spend, spend_preset = read_meta_spend(sb, return_preset=True)
    except Exception:
        spend = None
    # v88.47 (Dicionário §2): CPL = gasto ÷ LEADS (só tráfego pago, pela "Origem do cliente") na MESMA
    # janela do gasto. Antes dividia o gasto do mês parcial por TODO negócio criado em 30 dias
    # (qualquer origem) — CPL artificialmente baixo, e a IA escrevia as ordens da semana em cima dele.
    leads_janela, janela_txt = None, None
    try:
        import sys as _sys
        _v3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _v3 not in _sys.path:
            _sys.path.append(_v3)
        import _metricas_lib as MX  # type: ignore
        if spend_preset == "this_month":
            ini_d, janela_txt = today.replace(day=1), "mês corrente"
        else:
            ini_d, janela_txt = today - timedelta(days=29), "últimos 30 dias"
        ini_iso = ini_d.isoformat() + "T03:00:00+00:00"   # 00h em Brasília
        mapa = MX.mapa_origens(sb)
        _fora_o = _emails_fora(sb)   # v88.95
        rows, pg = [], 0
        while True:
            lote = (sb.table("deals").select("id,origem_cliente,user_email,src:rd_raw->deal_source->>name")
                    .gte("created_at_rd", ini_iso).order("id").range(pg * 1000, pg * 1000 + 999).execute().data or [])
            rows += [d for d in lote if (d.get("user_email") or "").strip().lower() not in _fora_o]
            if len(lote) < 1000 or pg >= 20:
                break
            pg += 1
        leads_janela = sum(1 for d in rows
                           if MX.origem_categoria((d.get("origem_cliente") or "").strip() or d.get("src"), mapa)[0] in MX.LEAD_CATS)
    except Exception as e:
        print(f"[briefing] leads por origem indisponível: {e}")
    facts["ads"] = {
        "meta_spend_mensal": round(spend, 2) if spend else None,
        "meta_spend_preset": spend_preset,
        "leads_30d": leads_janela,   # nome mantido por compat; agora = leads pagos na janela do gasto
        "leads_janela": janela_txt,
        "cpl": round(spend / leads_janela, 2) if (spend and leads_janela) else None,
        "cpl_base": f"gasto {spend_preset} ÷ leads de tráfego pago ({janela_txt})" if (spend and leads_janela) else None,
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


_IA_DIAG = {}   # v88.99: o que aconteceu na chamada de IA (gravado nos facts do briefing)


def _ai_text(prompt, max_tokens=4000):
    """v84.9 — Briefing de Guerra roda no GEMINI PRO via /api/v3/ia/analyze
    (motor oficial decidido pelo Paulo; Claude dormente). Fallback: legado."""
    _IA_DIAG.clear()
    cron = os.environ.get("CRON_SECRET", "").strip()
    if cron:
        try:
            body = json.dumps({"prompt": prompt, "model": "pro", "max_tokens": max_tokens,
                               "dossie": False}).encode("utf-8")
            req = urllib.request.Request(
                PUBLIC_BASE + "/api/v3/ia/analyze", data=body,
                headers={"Content-Type": "application/json", "User-Agent": "PSM-OS/briefing",
                         "Authorization": "Bearer " + cron})
            with urllib.request.urlopen(req, timeout=110) as resp:
                d = json.loads(resp.read().decode("utf-8"))
            if d.get("erro_principal"):
                _IA_DIAG["erro_modelo_principal"] = str(d["erro_principal"])[:400]
            if d.get("ok") and d.get("text"):
                return d.get("text"), d.get("model_used")
            _IA_DIAG["erro_analyze"] = str(d.get("error") or "sem texto")[:400]
        except Exception as e:
            _IA_DIAG["erro_analyze"] = f"{type(e).__name__}: {str(e)[:300]}"   # timeout, 401, 5xx...
    else:
        _IA_DIAG["erro_analyze"] = "CRON_SECRET ausente — pulou o motor oficial"
    body = json.dumps({"prompt": prompt, "max_tokens": max_tokens}).encode("utf-8")
    req = urllib.request.Request(
        PUBLIC_BASE + "/api/ai-analysis", data=body,
        headers={"Content-Type": "application/json", "User-Agent": "PSM-OS/briefing",
                 "Authorization": "Bearer " + os.environ.get("CRON_SECRET", "").strip()})
    with urllib.request.urlopen(req, timeout=70) as resp:
        d = json.loads(resp.read().decode("utf-8"))
    if not d.get("ok") or not d.get("text"):
        raise RuntimeError("IA indisponível: " + str(d.get("error") or "sem texto"))
    return d.get("text"), d.get("model_used")


def generate_and_store(sb, actor_id=None):
    """Compila → gera com IA → tenta salvar. Retorna o briefing mesmo se a
    tabela war_briefings ainda não existir (saved=False)."""
    today = hoje_brt()  # v86.68: hoje BRT
    facts = compile_facts(sb, today)
    try:
        facts["dossie"] = compile_dossie(sb, frente_of)   # contexto COMPLETO (v84.4)
    except Exception:
        facts["dossie"] = ""
    prompt = build_prompt(facts)
    if facts.get("dossie"):
        prompt = facts["dossie"] + "\n\n---\n\n" + prompt
    text, model = _ai_text(prompt)
    if _IA_DIAG:
        facts["ia_diag"] = dict(_IA_DIAG)   # v88.99: por que não saiu no modelo principal (se for o caso)
    facts.pop("dossie", None)   # não persiste o dossiê inteiro na linha (só os facts compactos)
    ordens_n = salvar_ordens(sb, text, today)   # checklist rastreável (v84.6)
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

def _extrai_ordens(text):
    """Puxa os itens da seção '## 🔥 3 ordens da semana' → lista de strings. v84.6"""
    import re as _re
    try:
        m = _re.search(r"##[^\n]*ordens[^\n]*\n(.*?)(\n##|$)", text, _re.S | _re.I)
        if not m:
            return []
        itens = []
        for ln in m.group(1).splitlines():
            ln = ln.strip()
            ln = _re.sub(r"^([0-9]+[\.\)]|[-*•])\s*", "", ln).strip()
            ln = _re.sub(r"^\*\*(.+?)\*\*", r"\1", ln)
            if len(ln) > 8:
                itens.append(ln[:220])
        return itens[:5]
    except Exception:
        return []


def salvar_ordens(sb, text, semana):
    """Ordens viram checklist rastreável (shared_kv 'war_ordens') — o dossiê da
    semana seguinte mostra o status real pra IA COBRAR o que não foi feito. v84.6"""
    itens = _extrai_ordens(text)
    if not itens:
        return 0
    try:
        # v88.82: ordem com dono (delegada) ou já feita NÃO é apagada se o briefing rodar de novo
        # na mesma semana — antes cada regeração zerava tudo (houve semanas com 2-3 rodadas).
        atual = sb.table("shared_kv").select("value").eq("key", "war_ordens").limit(1).execute().data or []
        atual = (atual[0]["value"] if atual else {}) or {}
        if isinstance(atual, str):
            atual = json.loads(atual)
        tocadas = [o for o in (atual.get("itens") or []) if o.get("dono") or o.get("feito")]
        if str(atual.get("semana")) == str(semana) and tocadas:
            return 0
        if atual.get("itens"):   # guarda a semana anterior (com status) antes de trocar
            hist = sb.table("shared_kv").select("value").eq("key", "war_ordens_hist").limit(1).execute().data or []
            hist = (hist[0]["value"] if hist else []) or []
            if isinstance(hist, str):
                hist = json.loads(hist)
            hist = ([atual] + [h for h in hist if isinstance(h, dict) and h.get("semana") != atual.get("semana")])[:12]
            sb.table("shared_kv").upsert({"key": "war_ordens_hist", "value": hist,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        sb.table("shared_kv").upsert({
            "key": "war_ordens",
            "value": {"semana": str(semana), "itens": [{"txt": t, "feito": False} for t in itens]},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="key").execute()
        return len(itens)
    except Exception:
        return 0
