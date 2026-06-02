"""
_brain_lib.py — Cérebro de Vendas (Sales Intelligence)
=======================================================
Scoring preditivo de leads abertos, clusterização de motivos de perda,
próxima-melhor-ação por lead/corretor e forecast ponderado por pipeline.

Tudo derivado de DADO REAL (deals do RD sincronizados). As PROBABILIDADES são
heurística TRANSPARENTE — prior por etapa do funil × taxa histórica REAL do
canal × sinais de recência/engajamento — NÃO um modelo de ML treinado. O front
rotula isso claramente como estimativa calibrada (não promessa).

Reaproveita o parsing canônico do One-on-One (_oo_lib): milestone do funil,
canal de origem, motivo de perda, amount, etc. — uma única fonte de verdade.
"""
import re
import calendar
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from _oo_lib import (parse_dt, amount, lost_reason, source, channel,  # type: ignore
                     deal_max_milestone, median, CHANNEL_LABEL, TRASH_RE,
                     MILESTONES)

# ── Prior de conversão→venda por marco do funil ──────────────────────────────
# Base imobiliária conservadora. É uma SUPOSIÇÃO transparente (não treino), e é
# ajustada adiante pela taxa REAL do canal + recência + engajamento.
MS_PRIOR = {0: 0.03, 1: 0.08, 2: 0.18, 3: 0.32, 4: 0.55, 5: 0.80}


def _interactions_count(raw):
    it = raw.get("interactions")
    if isinstance(it, int):
        return it
    if isinstance(it, list):
        return len(it)
    return None


# ── Taxa de conversão REAL por canal (base do multiplicador) ─────────────────
def channel_winrates(closed):
    """closed: lista de deals fechados (win True/False). Retorna
    (overall_wr, {canal: wr}, {canal: n_fechados}). Taxa real por canal."""
    tot_w = tot = 0
    by = defaultdict(lambda: [0, 0])  # canal -> [wins, total_fechados]
    for d in closed:
        win = d.get("win")
        if win is None:
            continue
        ch = channel(source(d.get("rd_raw") or {}))
        by[ch][1] += 1
        tot += 1
        if win is True:
            by[ch][0] += 1
            tot_w += 1
    overall = (tot_w / tot) if tot else 0.0
    wr = {k: (v[0] / v[1] if v[1] else 0.0) for k, v in by.items()}
    n = {k: v[1] for k, v in by.items()}
    return overall, wr, n


def _recency_factor(days):
    if days is None:
        return 0.9
    if days <= 3:
        return 1.15
    if days <= 7:
        return 1.0
    if days <= 14:
        return 0.8
    if days <= 30:
        return 0.55
    return 0.3


def _engagement_factor(n):
    if n is None:
        return 0.95
    if n >= 5:
        return 1.15
    if n >= 2:
        return 1.05
    if n >= 1:
        return 1.0
    return 0.9


def next_action(ms, days_stale):
    """Próxima melhor ação baseada na etapa do funil + estagnação."""
    if days_stale is not None and days_stale > 21:
        return f"♻️ Reativar ou descartar — parado há {days_stale}d"
    if ms == 0:
        if days_stale is not None and days_stale > 2:
            return f"🔥 1º contato URGENTE — lead sem toque há {days_stale}d"
        return "📞 Fazer o 1º contato"
    if ms == 1:
        return "📅 Qualificar e agendar a visita"
    if ms == 2:
        return "🚗 Confirmar e realizar a visita agendada"
    if ms == 3:
        return "📝 Enviar proposta / follow-up pós-visita"
    if ms == 4:
        return "🤝 Negociar e fechar — destravar a proposta"
    if ms == 5:
        return "📁 Concluir documentação / assinar a pasta"
    return "Acompanhar"


def score_open(deal, overall_wr, ch_wr, ch_n, today_dt):
    """Pontua UM deal aberto (0-100) + probabilidade calibrada + próxima ação.
    Retorna None se o deal já é venda (win=True) ou perdido."""
    if deal.get("win") is not None:
        return None
    raw = deal.get("rd_raw") or {}
    ms = deal_max_milestone(deal, [])
    if ms >= 6:
        return None
    prior = MS_PRIOR.get(ms, 0.03)
    ch = channel(source(raw))
    # multiplicador de canal só quando há base real suficiente (>=5 fechados)
    if overall_wr > 0 and ch_n.get(ch, 0) >= 5:
        mult = ch_wr.get(ch, overall_wr) / overall_wr
        mult = max(0.5, min(1.8, mult))
    else:
        mult = 1.0
    la = (parse_dt(raw.get("last_activity_at")) or parse_dt(deal.get("updated_at_rd"))
          or parse_dt(raw.get("updated_at")) or parse_dt(deal.get("created_at_rd")))
    days_stale = (today_dt - la).days if la else None
    rec = _recency_factor(days_stale)
    nint = _interactions_count(raw)
    eng = _engagement_factor(nint)

    prob = prior * mult * rec * eng
    prob = max(0.01, min(0.95, prob))
    score = round(prob * 100)
    temp = "quente" if score >= 55 else ("morno" if score >= 25 else "frio")
    amt = amount(deal)
    title = (raw.get("name") or raw.get("title") or deal.get("title")
             or f"Negócio #{deal.get('id')}")
    return {
        "id": deal.get("id"),
        "title": str(title)[:80],
        "ms": ms,
        "ms_label": MILESTONES[ms][1],
        "stage_name": deal.get("stage_name"),
        "score": score,
        "prob": round(prob, 3),
        "temp": temp,
        "amount": round(amt, 2),
        "expected_vgv": round(prob * amt, 2),
        "canal": CHANNEL_LABEL.get(ch, ch),
        "dias_parado": days_stale,
        "interacoes": nint,
        "acao": next_action(ms, days_stale),
        "fatores": {
            "prior_etapa": round(prior, 3),
            "mult_canal": round(mult, 2),
            "fator_recencia": rec,
            "fator_engajamento": eng,
        },
    }


# ── Clusterização de motivos de perda ────────────────────────────────────────
LOSS_CATS = [
    ("credito", "🏦 Financiamento / crédito / renda",
     re.compile(r"financ|cr[ée]dito|renda|aprova|banco|\bscore\b|nome.*suj|restri|negativ|fgts|subs[íi]dio|n[ãa]o.*entrada", re.I)),
    ("preco", "💰 Preço / valor",
     re.compile(r"pre[çc]o|valor|caro|or[çc]ament|acima|sem.*condi[çc]|parcel.*alt|mensal.*alt", re.I)),
    ("local", "📍 Localização",
     re.compile(r"localiza|bairro|regi[ãa]o|dist[âa]ncia|\blonge\b|outra cidade|mudou.*cidade", re.I)),
    ("produto", "🏠 Produto / imóvel",
     re.compile(r"\bplanta\b|tamanho|metragem|dormit|\bquarto|[áa]rea|acabament|\bandar\b|\bsol\b|\bvaga\b|\bnão.*gostou", re.I)),
    ("concorrencia", "⚔️ Concorrência",
     re.compile(r"concorr|outra imob|comprou.*outr|fechou.*outr|com.*outr.*imob|outro corretor", re.I)),
    ("sumiu", "👻 Sumiu / sem retorno",
     re.compile(r"sumiu|n[ãa]o.*respond|sem retorno|n[ãa]o atend|parou.*respond|n[ãa]o deu retorno|sem contato", re.I)),
    ("timing", "⏳ Timing / desistência",
     re.compile(r"desist|momento|adiou|aguard|pensar|depois|futuro|sem pressa|ano que vem|sem urg", re.I)),
]


def classify_loss(reason):
    if not reason:
        return ("ni", "❔ Não informado")
    # categorias de negócio primeiro (ex.: "sem renda / crédito negado" é um
    # problema FINANCEIRO acionável, não lixo) — só cai em lixo se nada casar.
    for key, label, rx in LOSS_CATS:
        if rx.search(reason):
            return (key, label)
    if TRASH_RE.search(reason):
        return ("lixo", "🗑️ Lead desqualificado / fora do perfil")
    return ("outro", "📦 Outro")


def loss_clusters(closed_lost):
    """Agrupa as perdas (deals win=False) em categorias acionáveis."""
    cats = defaultdict(lambda: {"n": 0, "exemplos": []})
    raw_reasons = defaultdict(int)
    for d in closed_lost:
        rsn = lost_reason(d.get("rd_raw") or {}) or ""
        key, label = classify_loss(rsn)
        c = cats[(key, label)]
        c["n"] += 1
        if rsn and len(c["exemplos"]) < 4 and rsn not in c["exemplos"]:
            c["exemplos"].append(rsn)
        if rsn:
            raw_reasons[rsn] += 1
    total = sum(c["n"] for c in cats.values())
    out = []
    for (key, label), c in cats.items():
        out.append({"key": key, "label": label, "n": c["n"],
                    "pct": round(c["n"] / total * 100, 1) if total else 0,
                    "exemplos": c["exemplos"]})
    out.sort(key=lambda x: -x["n"])
    top_raw = sorted([{"motivo": k, "n": v} for k, v in raw_reasons.items()],
                     key=lambda x: -x["n"])[:10]
    trash = sum(c["n"] for (k, _l), c in cats.items() if k == "lixo")
    return {"total": total, "trash_n": trash,
            "trash_pct": round(trash / total * 100, 1) if total else 0,
            "categorias": out, "top_motivos": top_raw}


# ── Forecast inteligente (ponderado por pipeline) ────────────────────────────
def forecast(open_scored, wins_month_vgv, wins_month_n, today, meta_vgv_mes=0):
    dia = today.day
    dias_mes = calendar.monthrange(today.year, today.month)[1]
    run_rate = (wins_month_vgv / dia * dias_mes) if dia else 0.0
    pipe_vgv = sum(o["expected_vgv"] for o in open_scored)
    pipe_vendas = sum(o["prob"] for o in open_scored)
    quentes = [o for o in open_scored if o["temp"] == "quente"]
    pipe_quente_vgv = sum(o["expected_vgv"] for o in quentes)
    return {
        "realizado_mes_vgv": round(wins_month_vgv, 2),
        "realizado_mes_vendas": wins_month_n,
        "dia": dia, "dias_mes": dias_mes,
        "run_rate_proj_vgv": round(run_rate, 2),
        "pipeline_ponderado_vgv": round(pipe_vgv, 2),
        "pipeline_ponderado_vendas": round(pipe_vendas, 1),
        "pipeline_quente_vgv": round(pipe_quente_vgv, 2),
        "quentes_n": len(quentes),
        "meta_vgv_mes": round(meta_vgv_mes, 2),
        "run_rate_pct_meta": round(run_rate / meta_vgv_mes * 100) if meta_vgv_mes else None,
    }
