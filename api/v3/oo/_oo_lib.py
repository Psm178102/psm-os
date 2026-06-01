"""
_oo_lib.py — núcleo de métricas individuais do corretor (One-on-One cockpit).

Tudo derivado de DADO REAL: deals (RD sincronizado), deal_stage_events (1º
contato/visita reais) e metas. Nada inventado — onde falta evento capturado,
o valor vira None e o front mostra "—".

Funil canônico imobiliário (7 marcos), classificado por regex no nome da etapa:
  Lead → Contato/Qualif. → Agendamento → Visita → Proposta → Pasta → Venda
"""
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date

# ─── Helpers de parsing ──────────────────────────────────────────────────────
def parse_dt(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


def amount(d):
    try:
        return float(d.get("amount") or 0) or float(
            (d.get("rd_raw") or {}).get("amount_total")
            or (d.get("rd_raw") or {}).get("amount_unique") or 0)
    except Exception:
        return 0.0


def lost_reason(raw):
    r = (raw or {}).get("deal_lost_reason")
    if isinstance(r, dict):
        return (r.get("name") or "").strip() or None
    if isinstance(r, str):
        return r.strip() or None
    return None


def source(raw):
    s = (raw or {}).get("deal_source")
    if isinstance(s, dict):
        return (s.get("name") or "").strip() or None
    if isinstance(s, str):
        return s.strip() or None
    return None


def median(vals):
    v = sorted(x for x in vals if x is not None)
    if not v:
        return None
    n = len(v)
    mid = n // 2
    return v[mid] if n % 2 else (v[mid - 1] + v[mid]) / 2.0


CHANNEL_LABEL = {
    "meta": "Meta", "google": "Google", "portal": "Portais",
    "indicacao": "Indicação", "organico": "Orgânico", "direto": "Direto",
    "outro": "Outro", "nao_atribuido": "Sem origem",
}
_CH = [
    ("meta", re.compile(r"facebook|instagram|\bfb\b|\big\b|\bmeta\b|lead ?ads|fanpage", re.I)),
    ("google", re.compile(r"google|adwords|youtube|\bgads\b|pesquisa|\bsearch\b|display", re.I)),
    ("portal", re.compile(r"zap|viva ?real|\bolx\b|imovelweb|im[óo]vel ?web|chaves ?na ?m[ãa]o|quintoandar|\bloft\b|portal", re.I)),
    ("indicacao", re.compile(r"indica|referr|amig|parceir|cliente antig", re.I)),
    ("organico", re.compile(r"org[âa]nic|\bsite\b|google meu neg|\bgmn\b|\bmaps\b|whats", re.I)),
    ("direto", re.compile(r"direto|telefone|balc[ãa]o|passante|walk|placa|fachada", re.I)),
]


def channel(src):
    if not src:
        return "nao_atribuido"
    for k, rx in _CH:
        if rx.search(src):
            return k
    return "outro"


TRASH_RE = re.compile(
    r"sem perfil|fora do perfil|n[ãa]o.*perfil|descart|duplicad|inv[áa]lid|engano|"
    r"trote|curios|n[ãa]o.*qualific|spam|teste|errad|sem renda|sem interesse|desqualific",
    re.I,
)

# ─── Funil canônico (marcos) ────────────────────────────────────────────────
# índice → (key, label). Lead=0 (todo deal) e Venda=6 (win=true) são especiais.
MILESTONES = [
    ("lead", "Lead"),
    ("contato", "Contato / Qualificação"),
    ("agendamento", "Agendamento"),
    ("visita", "Visita realizada"),
    ("proposta", "Proposta / Aprovação"),
    ("pasta", "Pasta / Lançamento"),
    ("venda", "Venda"),
]
# regex por marco (do mais avançado pro mais básico — primeiro match vence)
_MS_RE = [
    (5, re.compile(r"pasta|lan[çc]ament", re.I)),
    (4, re.compile(r"proposta|aprova", re.I)),
    (3, re.compile(r"realizad", re.I)),                       # VISITA REALIZADA
    (2, re.compile(r"agendad|agendar", re.I)),               # VISITA AGENDADA
    (1, re.compile(r"cont|qualific|atend|tent|oport|negocia", re.I)),
]


def stage_milestone(stage_name):
    """Índice do marco (0..5) que o NOME da etapa representa. Venda (6) vem do win."""
    nm = (stage_name or "").lower()
    if not nm:
        return 0
    for idx, rx in _MS_RE:
        if rx.search(nm):
            return idx
    return 0  # nome desconhecido → conta só como Lead (conservador, honesto)


def deal_max_milestone(deal, events):
    """Marco mais avançado que o deal alcançou (atual + histórico de eventos)."""
    if deal.get("win") is True:
        return 6
    m = stage_milestone(deal.get("stage_name"))
    for ev in (events or []):
        m = max(m, stage_milestone(ev[1]))  # ev = (pos, name_lower, dt)
    return m


# ─── Janela de período ──────────────────────────────────────────────────────
def window(params, today=None):
    today = today or datetime.now(timezone.utc).date()
    since = params.get("since")
    until = params.get("until")
    if since and until:
        try:
            return (date.fromisoformat(since), date.fromisoformat(until))
        except Exception:
            pass
    preset = params.get("date_preset") or "this_month"
    if preset == "this_month":
        return today.replace(day=1), today
    if preset == "this_year":
        return today.replace(month=1, day=1), today
    days = {"last_7d": 7, "last_14d": 14, "last_30d": 30, "last_90d": 90}.get(preset, 30)
    return today - timedelta(days=days - 1), today


def read_meta_spend(sb, preset):
    """Gasto total em ads (Meta) do período, do cache compartilhado meta_ads_cache.
    Soma o spend das contas no payload. Retorna float ou None (sem cache)."""
    try:
        rows = (sb.table("meta_ads_cache").select("payload,date_preset,refreshed_at")
                .order("refreshed_at", desc=True).limit(20).execute().data or [])
    except Exception:
        return None
    if not rows:
        return None
    row = next((r for r in rows if r.get("date_preset") == preset), rows[0])
    pl = row.get("payload") or {}
    accs = pl.get("accounts") or []
    try:
        return float(sum(float(a.get("spend") or 0) for a in accs))
    except Exception:
        return None


def months_in_range(since_d, until_d):
    """Lista de (ano, mes) cobertos pela janela — pra somar metas mensais."""
    out = []
    y, m = since_d.year, since_d.month
    while (y, m) <= (until_d.year, until_d.month):
        out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


# ─── Etapas REAIS do RD (rd_stages) ─────────────────────────────────────────
def build_stage_maps(stages_rows, pipes_rows=None):
    """Retorna (pos_by_stage_id, by_pipeline, pipe_names).
    pos_by_stage_id: {stage_id_qualquer_variante: (pipeline_id, position)}
    by_pipeline: {pipeline_id: [(position, name)] ordenado}
    pipe_names:  {pipeline_id: nome do funil}"""
    pos_by_id, by_pipe = {}, defaultdict(list)
    for s in (stages_rows or []):
        pos = s.get("position")
        if pos is None:
            pos = s.get("order")
        try:
            pos = int(pos)
        except Exception:
            continue
        name = (s.get("name") or "").strip()
        pid = str(s.get("pipeline_id") or s.get("rd_pipeline_id") or s.get("pipeline") or "")
        for k in (s.get("id"), s.get("external_id"), s.get("stage_id")):
            if k:
                pos_by_id[str(k)] = (pid, pos)
        by_pipe[pid].append((pos, name))
    for pid in by_pipe:
        by_pipe[pid].sort(key=lambda x: x[0])
    pipe_names = {}
    for p in (pipes_rows or []):
        for k in (p.get("id"), p.get("external_id")):
            if k:
                pipe_names[str(k)] = p.get("name")
    return pos_by_id, dict(by_pipe), pipe_names


def _rd_funnels(deals, events_by_deal, pos_by_id, by_pipe, pipe_names, since_dt, until_dt):
    """Funil REAL do RD por etapa (cumulativo: alcançou >= a etapa), pros funis
    em que o corretor participa no período. Cada deal soma nas etapas até o
    ponto máximo que alcançou (etapa atual + histórico de eventos)."""
    in_pipe = defaultdict(list)
    for d in deals:
        win = d.get("win")
        created = parse_dt(d.get("created_at_rd"))
        closed = parse_dt(d.get("closed_at"))
        touches = (created and since_dt <= created <= until_dt) or (closed and since_dt <= closed <= until_dt) or win is None
        if not touches:
            continue
        pid = str(d.get("pipeline_id") or "")
        if not pid and d.get("stage_id"):
            pid = (pos_by_id.get(str(d.get("stage_id"))) or ("", 0))[0]
        in_pipe[pid].append(d)
    out = []
    # ordena funis por volume de deals (mais relevante primeiro)
    for pid in sorted(in_pipe.keys(), key=lambda p: -len(in_pipe[p])):
        stages = by_pipe.get(pid)
        if not stages:
            continue
        ds = in_pipe[pid]
        if len(ds) < 1:
            continue
        # posição máxima alcançada por deal
        counts = {pos: 0 for (pos, _n) in stages}
        for d in ds:
            cur = (pos_by_id.get(str(d.get("stage_id"))) or (pid, 0))[1]
            mx = cur
            for ev in (events_by_deal.get(str(d.get("id"))) or []):
                p = ev[0]
                if isinstance(p, int):
                    mx = max(mx, p)
            if d.get("win") is True:
                # venda = alcançou a maior posição "de venda" disponível
                mx = max(mx, cur)
            for (pos, _n) in stages:
                if mx >= pos:
                    counts[pos] += 1
        rows, prev = [], None
        for (pos, name) in stages:
            n = counts[pos]
            conv = round(n / prev * 100, 1) if (prev not in (None, 0)) else None
            rows.append({"position": pos, "name": name, "n": n, "conv_from_prev": conv})
            prev = n
        out.append({"pipeline_id": pid, "pipeline": pipe_names.get(pid, "Funil"),
                    "deals": len(ds), "stages": rows})
    return out[:2]  # no máx. 2 funis (principal + secundário)


# ─── Núcleo: métricas de UM corretor ────────────────────────────────────────
def broker_metrics(deals, events_by_deal, meta_sum, since_d, until_d, today, detail=False, stage_maps=None):
    """
    deals: lista de deals do corretor (já filtrados por dono).
    events_by_deal: {deal_id: [(pos, name_lower, dt)]} (vazio no overview = sem 1º contato).
    meta_sum: dict com metas somadas no período (meta_vgv, meta_vendas, ...).
    Retorna dict com funil, taxas, contagens, tempos, origem, trend, health, alertas.
    """
    since_dt = datetime(since_d.year, since_d.month, since_d.day, tzinfo=timezone.utc)
    until_dt = datetime(until_d.year, until_d.month, until_d.day, 23, 59, 59, tzinfo=timezone.utc)
    now_dt = datetime(today.year, today.month, today.day, 23, 59, 59, tzinfo=timezone.utc)

    funnel = [0] * 7
    vendas = 0
    vgv = 0.0
    perdas = 0
    trash = 0
    first_contact_h = []
    cycle_days = []
    lost = defaultdict(int)
    wins = []                      # (closed_dt, amount, source_name, channel)
    stuck = 0                      # deals abertos parados >14d
    sem_contato = 0                # deals abertos só no Lead há >2d
    followup_n = 0                 # deals do período com follow-up (>1 interação)
    estag_days = []                # dias sem atividade (deals abertos) → estagnação
    win_dates = []                 # datas de fechamento ganho (cadência de vendas)
    trend = defaultdict(lambda: {"vendas": 0, "vgv": 0.0})  # 'YYYY-MM' -> ...

    for d in deals:
        raw = d.get("rd_raw") or {}
        created = parse_dt(d.get("created_at_rd")) or parse_dt(raw.get("created_at"))
        closed = parse_dt(d.get("closed_at")) or parse_dt(raw.get("closed_at"))
        updated = parse_dt(d.get("updated_at_rd")) or parse_dt(raw.get("updated_at"))
        win = d.get("win")
        amt = amount(d)
        evs = events_by_deal.get(str(d.get("id"))) or []
        ms = deal_max_milestone(d, evs)

        in_create = created is not None and since_dt <= created <= until_dt
        in_close = closed is not None and since_dt <= closed <= until_dt

        # Funil: conta deals que TOCAM o período (criados ou fechados na janela,
        # ou ainda abertos). Cada deal soma em todos os marcos <= seu máximo.
        touches = in_create or in_close or (win is None)
        if touches:
            for i in range(ms + 1):
                funnel[i] += 1
            # follow-up: deal com mais de 1 interação registrada no RD
            inter = raw.get("interactions")
            n_int = inter if isinstance(inter, int) else (len(inter) if isinstance(inter, list) else None)
            if n_int is not None and n_int > 1:
                followup_n += 1

        # Vendas / VGV / ciclo (fechadas ganhas na janela)
        if in_close and win is True:
            vendas += 1
            vgv += amt
            if created and closed:
                cycle_days.append((closed - created).total_seconds() / 86400.0)
            src = source(raw)
            wins.append((closed, amt, src, channel(src)))
            win_dates.append(closed)
        elif in_close and win is False:
            perdas += 1
            mr = lost_reason(raw) or "Não informado"
            lost[mr] += 1
            if TRASH_RE.search(mr):
                trash += 1

        # Tendência (12m) — vendas ganhas por mês de fechamento
        if win is True and closed:
            key = f"{closed.year:04d}-{closed.month:02d}"
            trend[key]["vendas"] += 1
            trend[key]["vgv"] += amt

        # 1º contato real (deals criados na janela, via eventos capturados)
        if in_create and evs and created:
            adv = sorted([e[2] for e in evs if e[2] and stage_milestone(e[1]) >= 1 and e[2] > created])
            if adv:
                dh = (adv[0] - created).total_seconds() / 3600.0
                if 0 < dh <= 720:  # até 30 dias, corta ruído
                    first_contact_h.append(dh)

        # Pendências (deals abertos)
        if win is None:
            if updated and (now_dt - updated).days > 14:
                stuck += 1
            if ms == 0 and created and (now_dt - created).days > 2:
                sem_contato += 1
            # estagnação: dias desde a última atividade do lead aberto
            la = parse_dt(raw.get("last_activity_at")) or updated or created
            if la:
                dd = (now_dt - la).days
                if dd >= 0:
                    estag_days.append(dd)

    total_fech = vendas + perdas
    win_rate = round(vendas / total_fech * 100, 1) if total_fech else None
    descarte = round(perdas / total_fech * 100, 1) if total_fech else None

    # Conversão entre marcos
    conv = []
    for i in range(6):
        conv.append(round(funnel[i + 1] / funnel[i] * 100, 1) if funnel[i] else None)

    out = {
        "funnel": [{"key": MILESTONES[i][0], "label": MILESTONES[i][1],
                    "n": funnel[i], "conv_from_prev": (conv[i - 1] if i > 0 else None)}
                   for i in range(7)],
        "kpis": {
            "leads": funnel[0], "agendamentos": funnel[2], "visitas": funnel[3],
            "propostas": funnel[4], "pastas": funnel[5], "vendas": vendas,
            "vgv": round(vgv, 2),
        },
        "win_rate": win_rate,
        "descarte_rate": descarte,
        "trash_rate": round(trash / perdas * 100, 1) if perdas else None,
        "perdas": perdas,
        "ciclo_medio_dias": round(median(cycle_days), 1) if cycle_days else None,
        "primeiro_contato_h": round(median(first_contact_h), 1) if first_contact_h else None,
        "primeiro_contato_basis": "real" if first_contact_h else "sem_evento",
        "pendencias": {"parados_14d": stuck, "sem_contato_48h": sem_contato},
        # ── Métricas de eficiência (pedido Paulo) ──
        "ticket_medio": round(vgv / vendas, 2) if vendas else None,
        "visitas_por_venda": round(funnel[3] / vendas, 1) if vendas else None,
        "atend_por_venda": round(funnel[1] / vendas, 1) if vendas else None,
        "dias_por_venda": round(((until_d - since_d).days + 1) / vendas, 0) if vendas else None,
        "qualificacao_rate": round(funnel[1] / funnel[0] * 100, 1) if funnel[0] else None,
        "followup_rate": round(followup_n / funnel[0] * 100, 1) if funnel[0] else None,
        "estagnacao_dias": round(median(estag_days), 0) if estag_days else None,
    }

    if detail:
        out["motivos_perda"] = sorted(
            [{"motivo": k, "n": v} for k, v in lost.items()], key=lambda x: -x["n"])[:8]
        wins.sort(key=lambda x: x[0], reverse=True)
        out["origem_ultimas_vendas"] = [
            {"data": w[0].date().isoformat(), "vgv": round(w[1], 2),
             "origem": w[2] or "—", "canal": CHANNEL_LABEL.get(w[3], w[3])}
            for w in wins[:8]]
        # Tendência: VGV/vendas mês a mês do ANO corrente (Jan→mês atual), zero-fill
        yr = today.year
        ytd = []
        for mm in range(1, today.month + 1):
            k = f"{yr:04d}-{mm:02d}"
            t = trend.get(k) or {}
            ytd.append({"mes": k, "vendas": t.get("vendas", 0), "vgv": round(t.get("vgv", 0.0), 2)})
        out["trend"] = ytd
        out["ano_vgv"] = round(sum(x["vgv"] for x in ytd), 2)
        out["ano_vendas"] = sum(x["vendas"] for x in ytd)
        # Funil REAL do RD (etapas do funil em que o corretor participa)
        if stage_maps:
            try:
                pos_by_id, by_pipe, pipe_names = stage_maps
                out["rd_funnels"] = _rd_funnels(deals, events_by_deal, pos_by_id, by_pipe,
                                                pipe_names, since_dt, until_dt)
            except Exception:
                out["rd_funnels"] = []

    # ── Meta × realizado ──
    mv = (meta_sum or {})
    out["meta"] = {
        "meta_vgv": mv.get("meta_vgv", 0), "real_vgv": round(vgv, 2),
        "meta_vendas": mv.get("meta_vendas", 0), "real_vendas": vendas,
        "meta_visitas": mv.get("meta_visitas", 0), "real_visitas": funnel[3],
        "meta_pastas": mv.get("meta_pastas", 0), "real_pastas": funnel[5],
        "meta_propostas": mv.get("meta_propostas", 0), "real_propostas": funnel[4],
        "meta_agendamentos": mv.get("meta_agendamentos", 0), "real_agendamentos": funnel[2],
    }

    # ── Health score (0-100) + cor ──
    attain = (vgv / mv["meta_vgv"]) if mv.get("meta_vgv") else None
    pace = 1.0
    days_total = (until_d - since_d).days + 1
    days_elapsed = max(1, min(days_total, (today - since_d).days + 1))
    pace = days_elapsed / days_total if days_total else 1.0
    # componentes (cada 0..1)
    c_meta = min(1.0, (attain / pace)) if (attain is not None and pace) else (0.5 if attain is None else min(1.0, attain))
    c_ativ = min(1.0, funnel[3] / max(1, mv.get("meta_visitas") or 8))   # visitas vs meta (ou 8 baseline)
    c_conv = min(1.0, (win_rate or 0) / 15.0)                            # 15% lead→venda = ótimo
    has_meta = bool(mv.get("meta_vgv") or mv.get("meta_visitas"))
    if has_meta:
        health = round(100 * (0.5 * c_meta + 0.3 * c_ativ + 0.2 * c_conv))
    else:
        health = round(100 * (0.6 * c_ativ + 0.4 * c_conv))
    health = max(0, min(100, health))
    out["health"] = health
    out["health_color"] = "verde" if health >= 70 else ("amarelo" if health >= 40 else "vermelho")
    out["meta_attainment_pct"] = round(attain * 100, 1) if attain is not None else None

    # ── Alertas automáticos ──
    alerts = []
    if funnel[3] == 0:
        alerts.append({"level": "alto", "txt": "0 visitas no período"})
    if funnel[4] == 0:
        alerts.append({"level": "medio", "txt": "Nenhuma proposta no período"})
    if vendas == 0 and perdas > 0:
        alerts.append({"level": "alto", "txt": f"Sem vendas ({perdas} perdas no período)"})
    if sem_contato > 0:
        alerts.append({"level": "alto", "txt": f"{sem_contato} lead(s) sem 1º contato há +48h"})
    if stuck > 0:
        alerts.append({"level": "medio", "txt": f"{stuck} negócio(s) parado(s) há +14 dias"})
    if attain is not None and pace and attain < pace * 0.7:
        alerts.append({"level": "medio", "txt": f"Abaixo do ritmo da meta ({out['meta_attainment_pct']}% atingido)"})
    if (out["primeiro_contato_h"] or 0) > 24:
        alerts.append({"level": "medio", "txt": f"1º contato lento (~{out['primeiro_contato_h']}h)"})
    out["alertas"] = alerts

    return out
