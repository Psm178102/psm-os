"""
🧪 Simulador individual do corretor (v86.1) — Norte do Mês 2.0 (motor de meta).

O motor da planilha FUNIL-DE-ENERGIA-PSM-2026 vira sistema, individual e
alimentado pelo RD: taxas REAIS 90d por marco (com credibilidade bayesiana
contra pisos de mercado), elasticidade ticket→conversão, energia por canal,
capacidade em horas e faixa de Poisson (venda se julga no TRIMESTRE; o mês
cobra ATIVIDADE).

GET  ?user_id=<id>            → estado calibrado do corretor (SÓCIO lvl>=10)
GET  ?proposta=1              → proposta do tri do PRÓPRIO usuário (aceite no Meu Painel)
POST {action}:
  simular         → cálculo puro do cenário (nada grava)            [sócio]
  salvar_cenario  → kv oo_simulador:<uid> (retomar 1:1 de onde parou)[sócio]
  config          → kv oo_motor_config (pisos, K, tickets, tempos…)  [sócio]
  proposta        → gera/regrava proposta tri em oo_meta_motor:<uid>:<YYYY>Q<n> [sócio]
  enviar          → status proposta→enviada + notifica SÓ o corretor [sócio, bloqueado em sombra]
  aceitar         → o PRÓPRIO corretor aceita → metas de atividade derivadas
                    gravam nos 3 oo_norte do tri (PATCH, formato atual intocado)
                    + notifica sócios e gestor da equipe (alçada, nunca broadcast)

MODO SOMBRA (motor_shadow=true, default): tudo visível só pro sócio; enviar/
aceitar bloqueados; nada toca oo_norte até o sócio desligar na Calibração.
"""
from http.server import BaseHTTPRequestHandler
import json
import math
import os
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit, notify_all, lvl_of  # type: ignore
from _oo_lib import (  # type: ignore
    MILESTONES, deal_max_milestone, channel, CHANNEL_LABEL, source, parse_dt, amount,
)

# ─── Passagens do funil (marco k → k+1), nomeadas pelo marco de DESTINO ─────
PASSAGENS = [m[0] for m in MILESTONES[1:]]  # contato..venda (6)
PASS_LABEL = {MILESTONES[i + 1][0]: f"{MILESTONES[i][1]} → {MILESTONES[i + 1][1]}" for i in range(6)}
ETAPAS = [m[0] for m in MILESTONES]

# ─── Config global do motor (kv oo_motor_config, editável só por sócio) ─────
CFG_MOTOR_DEFAULT = {
    # pisos de mercado das passagens 0→1..5→6 (defaults validados na planilha)
    "pisos": {"contato": 0.60, "agendamento": 0.45, "visita": 0.60,
              "proposta": 0.35, "pasta": 0.50, "venda": 0.85},
    "K": 30,                      # credibilidade: peso do piso (n_k pequenos puxam pro piso)
    "ticket_ref": 335000.0,       # calibração ago/2026 (elasticidade ticket→conversão)
    "sens": 0.5,                  # expoente da elasticidade
    "faixas": {                   # perfis de marca (ticket + jornada típica)
        "conquista":   {"ticket": 240000.0,  "jornada_meses": 1,  "label": "Conquista"},
        "map":         {"ticket": 430000.0,  "jornada_meses": 3,  "label": "MAP"},
        "alto_padrao": {"ticket": 1200000.0, "jornada_meses": 12, "label": "Alto padrão"},
    },
    "tempos_min": {"lead": 4, "contato": 8, "agendamento": 10,
                   "visita": 90, "proposta": 30, "pasta": 60},
    "dias_uteis": 22, "horas_dia": 8,          # capacidade = 176h/mês
    "canal_min_amostra": 10,                   # < isso → canal neutro (taxa_rel=1.0)
    "defasagem_meses": {"map": 3, "conquista": 1},  # venda do mês ↔ atividade de N meses atrás
    "motor_shadow": True,
}
KV_CFG = "oo_motor_config"


def _kv_read(sb, key):
    """(value|None, read_ok) — leitura falhou ≠ não existe (lição do norte.py)."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
    except Exception:
        return None, False
    if not rows:
        return None, True
    v = rows[0].get("value")
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = None
    return (v if isinstance(v, dict) else None), True


def _kv_write(sb, key, value, updated_by=None):
    try:
        sb.table("shared_kv").upsert({"key": key, "value": value, "updated_by": updated_by},
                                     on_conflict="key").execute()
        return True
    except Exception:
        try:
            sb.table("shared_kv").upsert({"key": key, "value": value}, on_conflict="key").execute()
            return True
        except Exception:
            return False


def motor_cfg(sb):
    """Config global mesclada com defaults (chave nova no default nunca some)."""
    saved, ok = _kv_read(sb, KV_CFG)
    cfg = json.loads(json.dumps(CFG_MOTOR_DEFAULT))
    if isinstance(saved, dict):
        for k, v in saved.items():
            if k in ("pisos", "faixas", "tempos_min", "defasagem_meses") and isinstance(v, dict):
                base = cfg.get(k) or {}
                for kk, vv in v.items():
                    if isinstance(vv, dict) and isinstance(base.get(kk), dict):
                        base[kk] = {**base[kk], **vv}
                    else:
                        base[kk] = vv
                cfg[k] = base
            else:
                cfg[k] = v
    cfg["_read_ok"] = ok
    return cfg


def _num(x, default=0.0):
    try:
        v = float(x)
        return v if v == v else default
    except Exception:
        return default


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ─── Poisson (na mão — sem scipy no runtime) ────────────────────────────────
def pois_cdf(k, lam):
    if lam <= 0:
        return 1.0
    term = math.exp(-lam)
    s = term
    for i in range(1, k + 1):
        term *= lam / i
        s += term
    return s


def pois_quantile(q, lam):
    k = 0
    while pois_cdf(k, lam) < q and k < 2000:
        k += 1
    return k


def pois_faixa(lam):
    """Faixa central ~85% (quantis 7,5%–92,5%). Reproduz a régua do Paulo:
    meta 3/tri → 1–6 · 6/tri → 3–10 · 9/tri → 5–13."""
    lam = max(0.0, lam)
    return {"lo": pois_quantile(0.075, lam), "hi": pois_quantile(0.925, lam),
            "p_zero": round(math.exp(-lam), 4) if lam > 0 else 1.0}


# ═══════════════ MOTOR (cálculo puro — nada de banco aqui) ═══════════════
def mix_do_perfil(perfil, mix_manual, faixas):
    """Perfil → pesos por faixa de ticket. 'manual' usa os pesos enviados."""
    p = (perfil or "misto").lower()
    if p == "conquista":
        w = {"conquista": 1.0}
    elif p == "map":
        w = {"map": 1.0}
    elif p == "manual" and isinstance(mix_manual, dict):
        w = {k: max(0.0, _num(v)) for k, v in mix_manual.items() if k in faixas}
        if sum(w.values()) <= 0:
            w = {"conquista": 0.5, "map": 0.5}
    else:  # misto
        w = {"conquista": 0.5, "map": 0.5}
    tot = sum(w.values())
    return {k: v / tot for k, v in w.items() if v > 0}


def simulate(estado, cenario, cfg):
    """Cenário → resultado. estado = taxas usadas + canais (do GET calibrado);
    cenario = atendimentos/perfil/energia/overrides; cfg = oo_motor_config."""
    faixas = cfg["faixas"]
    tempos = cfg["tempos_min"]

    # 1) taxas por passagem (usadas, com overrides do "e se")
    taxas = {}
    base = estado.get("taxas_usadas") or {}
    overrides = cenario.get("overrides") or {}
    for k in PASSAGENS:
        t = _num(base.get(k), 0.0)
        if k in overrides and overrides[k] is not None:
            t = _num(overrides[k], t)
        taxas[k] = _clamp(t, 0.01, 0.98)
    conv_funil = 1.0
    for k in PASSAGENS:
        conv_funil *= taxas[k]

    # 2) ticket ponderado do perfil + elasticidade ticket→conversão
    mix = mix_do_perfil(cenario.get("perfil"), cenario.get("mix_manual"), faixas)
    ticket_pond = sum(w * _num(faixas[f]["ticket"]) for f, w in mix.items())
    jornada_pond = sum(w * _num(faixas[f].get("jornada_meses"), 1) for f, w in mix.items())
    fator_ticket = 1.0
    if ticket_pond > 0 and _num(cfg.get("ticket_ref")) > 0:
        fator_ticket = _clamp((_num(cfg["ticket_ref"]) / ticket_pond) ** _num(cfg.get("sens"), 0.5), 0.5, 1.5)

    # 3) energia por canal: vendas do canal escalam com share × energia × taxa relativa
    #    (semântica da planilha: energia 0 zera o canal, 100 = taxa plena; share
    #    não-energizado se PERDE, não redistribui)
    canais_in = estado.get("canais") or []
    energia = cenario.get("energia") or {}
    fator_canais, canais_out = 0.0, []
    if canais_in:
        for c in canais_in:
            key = c.get("key")
            sh = _num(c.get("share"))
            tr = _num(c.get("taxa_rel"), 1.0)
            en = _clamp(_num(energia.get(key), 100.0), 0.0, 100.0)
            contrib = sh * (en / 100.0) * tr
            fator_canais += contrib
            canais_out.append({"key": key, "label": c.get("label") or CHANNEL_LABEL.get(key, key),
                               "share": round(sh, 4), "taxa_rel": round(tr, 3),
                               "energia": en, "contrib": round(contrib, 4)})
    else:
        fator_canais = 1.0

    conv_efetiva = conv_funil * fator_ticket * fator_canais
    atend = max(0.0, _num(cenario.get("atendimentos_mes")))
    vendas = atend * conv_efetiva
    vgv = vendas * ticket_pond

    # 4) atividade mensal por marco (funil reverso; ticket+canais pesam na 1ª passagem —
    #    é na entrada do funil que perfil e origem mudam a conversa)
    fator_total = fator_ticket * fator_canais
    atividade = atividade_para(vendas, taxas, fator_total)

    # 5) horas + farol
    horas = sum(atividade[k] * _num(tempos.get(k), 0) for k in atividade) / 60.0
    capacidade = _num(cfg.get("dias_uteis"), 22) * _num(cfg.get("horas_dia"), 8)
    pct_cap = (horas / capacidade) if capacidade else None
    farol = None
    if pct_cap is not None:
        farol = "cabe" if pct_cap <= 0.85 else ("apertado" if pct_cap <= 1.0 else "nao_cabe")

    # horas por 1 venda/mês (régua da proposta — escala linear)
    atv1 = atividade_para(1.0, taxas, fator_total)
    horas_por_venda = sum(atv1[k] * _num(tempos.get(k), 0) for k in atv1) / 60.0

    out = {
        "taxas": {k: round(taxas[k], 4) for k in PASSAGENS},
        "conv_funil": round(conv_funil, 5),
        "fator_ticket": round(fator_ticket, 4),
        "fator_canais": round(fator_canais, 4),
        "conv_efetiva": round(conv_efetiva, 5),
        "conv_efetiva_pct": round(conv_efetiva * 100, 2),
        "mix_faixas": {k: round(v, 3) for k, v in mix.items()},
        "ticket_ponderado": round(ticket_pond, 2),
        "jornada_meses": round(jornada_pond, 1),
        "atendimentos_mes": round(atend, 1),
        "vendas_prev": round(vendas, 3),
        "vgv_prev": round(vgv, 2),
        "canais": canais_out,
        "atividade_mes": {k: round(v, 1) for k, v in atividade.items()},
        "horas": {"total": round(horas, 1), "capacidade": round(capacidade, 1),
                  "pct": round(pct_cap * 100, 1) if pct_cap is not None else None,
                  "farol": farol, "por_venda": round(horas_por_venda, 1)},
        "poisson": {"mes": pois_faixa(vendas), "tri": pois_faixa(vendas * 3)},
    }

    # 6) gap pra meta (se o sócio digitou uma meta-alvo de vendas/mês)
    meta_v = _num(cenario.get("meta_vendas_mes"))
    if meta_v > 0:
        out["gap"] = {
            "meta_vendas_mes": meta_v,
            "gap_vendas": round(meta_v - vendas, 2),
            "atend_necessarios": round(meta_v / conv_efetiva, 0) if conv_efetiva > 0 else None,
            "poisson_meta_mes": pois_faixa(meta_v),
            "poisson_meta_tri": pois_faixa(meta_v * 3),
        }

    # 7) alavancas: top 3 mudanças isoladas de maior impacto em vendas
    out["alavancas"] = alavancas(estado, cenario, cfg, vendas)
    return out


def atividade_para(vendas_alvo, taxas, fator_total):
    """Volume mensal necessário em cada marco pra fechar `vendas_alvo` vendas.
    O fator ticket×canais entra DISTRIBUÍDO geometricamente pelas 6 passagens
    (fator^(1/6) em cada) — o produto continua conv_funil×fator (leads =
    vendas/conv_efetiva) e o funil fica sempre decrescente lead→pasta."""
    vol = {}
    acc = max(0.0, vendas_alvo)
    f6 = max(0.001, fator_total) ** (1.0 / 6.0)
    # de trás pra frente: venda ← pasta ← proposta ← visita ← agendamento ← contato ← lead
    ordem = list(reversed(PASSAGENS))  # venda, pasta, proposta, visita, agendamento, contato
    marcos = list(reversed(ETAPAS[:-1]))  # pasta, proposta, visita, agendamento, contato, lead
    for i, p in enumerate(ordem):
        t = _clamp(taxas[p] * f6, 0.001, 0.98)
        acc = acc / t
        vol[marcos[i]] = acc
    return {k: vol.get(k, 0.0) for k in ETAPAS[:-1]}  # lead..pasta


def alavancas(estado, cenario, cfg, vendas_base):
    """Testa mudanças isoladas e ordena por Δvendas: energia de canal → 100,
    +5pp numa passagem, +20% de atendimentos."""
    cands = []

    def _vendas(cen2):
        c2 = dict(cenario)
        c2.update(cen2)
        c2.pop("meta_vendas_mes", None)
        # simulate sem alavancas: chama núcleo direto
        r = _simulate_core(estado, c2, cfg)
        return r["vendas"]

    energia = dict(cenario.get("energia") or {})
    for c in (estado.get("canais") or []):
        key = c.get("key")
        en = _clamp(_num(energia.get(key), 100.0), 0.0, 100.0)
        if en < 100 and _num(c.get("share")) > 0.02:
            e2 = dict(energia)
            e2[key] = 100.0
            dv = _vendas({"energia": e2}) - vendas_base
            if dv > 0.001:
                cands.append({"tipo": "canal", "key": key,
                              "label": f"Energia total em {c.get('label') or CHANNEL_LABEL.get(key, key)} (→100)",
                              "delta_vendas": round(dv, 3)})
    overrides = dict(cenario.get("overrides") or {})
    base_taxas = estado.get("taxas_usadas") or {}
    for k in PASSAGENS:
        atual = _num(overrides.get(k), _num(base_taxas.get(k)))
        novo = min(0.95, atual + 0.05)
        if novo > atual:
            o2 = dict(overrides)
            o2[k] = novo
            dv = _vendas({"overrides": o2}) - vendas_base
            if dv > 0.001:
                cands.append({"tipo": "etapa", "key": k,
                              "label": f"{PASS_LABEL[k]} +5pp",
                              "delta_vendas": round(dv, 3)})
    atend = _num(cenario.get("atendimentos_mes"))
    if atend > 0:
        extra = max(1, round(atend * 0.2))
        dv = _vendas({"atendimentos_mes": atend + extra}) - vendas_base
        if dv > 0.001:
            cands.append({"tipo": "volume", "key": "atendimentos",
                          "label": f"+{extra} atendimentos/mês",
                          "delta_vendas": round(dv, 3)})
    cands.sort(key=lambda x: -x["delta_vendas"])
    return cands[:3]


def _simulate_core(estado, cenario, cfg):
    """Núcleo mínimo (vendas apenas) — usado pelas alavancas pra não recursar."""
    faixas = cfg["faixas"]
    taxas = {}
    base = estado.get("taxas_usadas") or {}
    overrides = cenario.get("overrides") or {}
    conv = 1.0
    for k in PASSAGENS:
        t = _num(base.get(k), 0.0)
        if k in overrides and overrides[k] is not None:
            t = _num(overrides[k], t)
        taxas[k] = _clamp(t, 0.01, 0.98)
        conv *= taxas[k]
    mix = mix_do_perfil(cenario.get("perfil"), cenario.get("mix_manual"), faixas)
    tp = sum(w * _num(faixas[f]["ticket"]) for f, w in mix.items())
    ft = 1.0
    if tp > 0 and _num(cfg.get("ticket_ref")) > 0:
        ft = _clamp((_num(cfg["ticket_ref"]) / tp) ** _num(cfg.get("sens"), 0.5), 0.5, 1.5)
    energia = cenario.get("energia") or {}
    canais = estado.get("canais") or []
    fc = 0.0
    if canais:
        for c in canais:
            en = _clamp(_num(energia.get(c.get("key")), 100.0), 0.0, 100.0)
            fc += _num(c.get("share")) * (en / 100.0) * _num(c.get("taxa_rel"), 1.0)
    else:
        fc = 1.0
    atend = max(0.0, _num(cenario.get("atendimentos_mes")))
    return {"vendas": atend * conv * ft * fc}


# ═══════════════ CALIBRAÇÃO (dado real 90d do corretor) ═══════════════
def _fetch_deals(sb, uid, email):
    cols = "id,amount,win,closed_at,created_at_rd,updated_at_rd,stage_id,stage_name,pipeline_id,user_id,user_email,rd_raw"
    deals, seen = [], set()
    for fld, val in (("user_id", uid), ("user_email", email)):
        if not val:
            continue
        pg = 0
        while True:
            try:
                ch = (sb.table("deals").select(cols).eq(fld, val).order("id")
                      .range(pg * 1000, pg * 1000 + 999).execute().data or [])
            except Exception:
                ch = []
            for r in ch:
                if r.get("id") not in seen:
                    seen.add(r.get("id")); deals.append(r)
            if len(ch) < 1000 or pg >= 20:
                break
            pg += 1
    return deals


def _fetch_events(sb, deal_ids):
    out = {}
    ids = [str(x) for x in deal_ids if x]
    for i in range(0, len(ids), 150):
        try:
            rows = (sb.table("deal_stage_events")
                    .select("deal_id,stage_position,stage_name,occurred_at,source")
                    .in_("deal_id", ids[i:i + 150]).neq("source", "backfill").execute().data or [])
        except Exception:
            rows = []
        for r in rows:
            out.setdefault(str(r.get("deal_id")), []).append(
                (r.get("stage_position"), (r.get("stage_name") or "").lower(), parse_dt(r.get("occurred_at"))))
    return out


def calibrar(sb, uid, u, cfg, dias=90):
    """Estado calibrado: funil 90d por marco (cumulativo), taxa real×piso×usada,
    canais reais (share + taxa relativa), ticket 90d dele e da equipe, média 6m."""
    today = datetime.now(timezone.utc).date()
    since_d = today - timedelta(days=dias - 1)
    since_dt = datetime(since_d.year, since_d.month, since_d.day, tzinfo=timezone.utc)
    until_dt = datetime(today.year, today.month, today.day, 23, 59, 59, tzinfo=timezone.utc)
    email = (u.get("email") or "").lower()

    deals = _fetch_deals(sb, uid, email)
    events = _fetch_events(sb, [d.get("id") for d in deals])

    # funil cumulativo 90d (mesma régua do cockpit: deal toca a janela se foi
    # criado/fechado nela ou segue aberto)
    funnel = [0] * 7
    leads_criados = 0
    ch_leads, ch_vendas = {}, {}
    vendas_90, tickets = 0, []
    win180 = 0
    d180 = datetime.now(timezone.utc) - timedelta(days=180)
    for d in deals:
        raw = d.get("rd_raw") or {}
        created = parse_dt(d.get("created_at_rd")) or parse_dt(raw.get("created_at"))
        closed = parse_dt(d.get("closed_at")) or parse_dt(raw.get("closed_at"))
        win = d.get("win")
        touches = ((created and since_dt <= created <= until_dt)
                   or (closed and since_dt <= closed <= until_dt) or win is None)
        ck = channel(source(raw))
        if touches:
            ms = deal_max_milestone(d, events.get(str(d.get("id"))) or [])
            for i in range(ms + 1):
                funnel[i] += 1
            ch_leads[ck] = ch_leads.get(ck, 0) + 1
        if created and since_dt <= created <= until_dt:
            leads_criados += 1
        if win is True and closed and since_dt <= closed <= until_dt:
            vendas_90 += 1
            ch_vendas[ck] = ch_vendas.get(ck, 0) + 1
            a = amount(d)
            if a > 0:
                tickets.append(a)
        if win is True and closed and closed >= d180:
            win180 += 1

    # taxas reais + credibilidade bayesiana contra o piso
    K = max(1, int(_num(cfg.get("K"), 30)))
    pisos = cfg["pisos"]
    passagens = []
    taxas_usadas = {}
    for i, k in enumerate(PASSAGENS):
        n_k = funnel[i]
        real = (funnel[i + 1] / funnel[i]) if funnel[i] else None
        piso = _clamp(_num(pisos.get(k), 0.5), 0.01, 0.98)
        usada = ((n_k * real + K * piso) / (n_k + K)) if real is not None else piso
        usada = _clamp(usada, 0.01, 0.98)
        taxas_usadas[k] = round(usada, 4)
        passagens.append({"key": k, "label": PASS_LABEL[k], "n": n_k,
                          "real": round(real, 4) if real is not None else None,
                          "piso": piso, "usada": round(usada, 4)})

    # canais: share dos leads 90d + taxa relativa (conv do canal ÷ conv geral)
    total_leads_ch = sum(ch_leads.values())
    conv_geral = (vendas_90 / total_leads_ch) if total_leads_ch else 0
    min_amostra = int(_num(cfg.get("canal_min_amostra"), 10))
    canais = []
    for ck in sorted(ch_leads, key=lambda x: -ch_leads[x]):
        n_c = ch_leads[ck]
        share = n_c / total_leads_ch if total_leads_ch else 0
        if n_c >= min_amostra and conv_geral > 0:
            taxa_rel = _clamp((ch_vendas.get(ck, 0) / n_c) / conv_geral, 0.25, 3.0)
            neutro = False
        else:
            taxa_rel, neutro = 1.0, True
        canais.append({"key": ck, "label": CHANNEL_LABEL.get(ck, ck), "leads": n_c,
                       "vendas": ch_vendas.get(ck, 0), "share": round(share, 4),
                       "taxa_rel": round(taxa_rel, 3), "neutro": neutro})

    # ticket da equipe (vendas ganhas 90d dos membros ativos da mesma equipe)
    ticket_eq = None
    tkey = (u.get("team") or "").strip().lower()
    if tkey:
        try:
            membros = [m for m in (sb.table("users").select("id,email,team,status").execute().data or [])
                       if (m.get("status") or "ativo") == "ativo"
                       and (m.get("team") or "").strip().lower() == tkey]
            mids = [m.get("id") for m in membros if m.get("id")]
            vals = []
            for i in range(0, len(mids), 80):
                rows = (sb.table("deals").select("amount,rd_raw,closed_at,win")
                        .in_("user_id", mids[i:i + 80]).eq("win", True)
                        .gte("closed_at", since_dt.isoformat()).limit(1000).execute().data or [])
                vals.extend(amount(r) for r in rows if amount(r) > 0)
            if vals:
                ticket_eq = round(sum(vals) / len(vals), 2)
        except Exception:
            ticket_eq = None

    ticket_corr = round(sum(tickets) / len(tickets), 2) if tickets else None
    media_6m = round(win180 / 6.0, 2)

    return {
        "window": {"since": since_d.isoformat(), "until": today.isoformat(), "dias": dias},
        "funil": [{"key": ETAPAS[i], "label": MILESTONES[i][1], "n": funnel[i]} for i in range(7)],
        "passagens": passagens,
        "taxas_usadas": taxas_usadas,
        "canais": canais,
        "leads_90d": leads_criados,
        "volume_mensal_leads": round(leads_criados / (dias / 30.0), 1),
        "vendas_90d": vendas_90,
        "ticket_corretor": ticket_corr,
        "ticket_equipe": ticket_eq,
        "media_6m_vendas": media_6m,
    }


def perfil_do_team(team):
    t = (team or "").strip().lower()
    if "conquista" in t:
        return "conquista"
    if "map" in t:
        return "map"
    return "misto"


def cenario_calibrado(estado, u):
    """Cenário-default: o corretor como ele é hoje (volume real, energia 100)."""
    return {
        "atendimentos_mes": max(1.0, estado.get("volume_mensal_leads") or 0),
        "perfil": perfil_do_team(u.get("team")),
        "mix_manual": None,
        "energia": {c["key"]: 100 for c in (estado.get("canais") or [])},
        "overrides": {},
        "meta_vendas_mes": None,
    }


def gargalo(estado, cfg, cen_base):
    """Passagem cujo conserto até o piso mais aumenta vendas (gap × impacto)."""
    best, best_dv = None, 0.0
    base_v = _simulate_core({"taxas_usadas": estado["taxas_usadas"], "canais": estado["canais"]},
                            cen_base, cfg)["vendas"]
    for p in estado["passagens"]:
        if p["real"] is not None and p["real"] < p["piso"] and p["n"] >= 5:
            o2 = {p["key"]: p["piso"]}
            v2 = _simulate_core({"taxas_usadas": estado["taxas_usadas"], "canais": estado["canais"]},
                                {**cen_base, "overrides": o2}, cfg)["vendas"]
            if v2 - base_v > best_dv:
                best_dv, best = v2 - base_v, p["key"]
    return best


# ═══════════════ PROPOSTA DE META (trimestre) ═══════════════
def quarter_of(d):
    return f"{d.year:04d}Q{(d.month - 1) // 3 + 1}"


def next_quarter(d):
    q = (d.month - 1) // 3 + 1
    return f"{d.year + 1:04d}Q1" if q == 4 else f"{d.year:04d}Q{q + 1}"


def quarter_months(qstr):
    """'2026Q4' → ['2026-10','2026-11','2026-12'] (None se formato inválido)."""
    try:
        y, q = int(qstr[:4]), int(qstr[5])
        if not 1 <= q <= 4 or qstr[4] not in "Qq":
            return None
        m0 = (q - 1) * 3 + 1
        return [f"{y:04d}-{m:02d}" for m in range(m0, m0 + 3)]
    except Exception:
        return None


def propor_m(sim, estado, cfg):
    """Maior m∈{1,2,3} com horas(m) ≤ 85% da capacidade E m ≤ média6m×1.3+0.5.
    Sem histórico (média 0) → 1. Capacidade estourada rebaixa."""
    cap = _num(cfg.get("dias_uteis"), 22) * _num(cfg.get("horas_dia"), 8)
    hpv = _num((sim.get("horas") or {}).get("por_venda"))
    m6 = _num(estado.get("media_6m_vendas"))
    if m6 <= 0:
        teto_hist = 1
    else:
        teto_hist = m6 * 1.3 + 0.5
    escolhido = 1
    for m in (3, 2, 1):
        cabe = (hpv * m) <= 0.85 * cap if (cap and hpv) else (m == 1)
        if cabe and m <= teto_hist:
            escolhido = m
            break
    return escolhido


def _kv_meta_key(uid, q):
    return f"oo_meta_motor:{uid}:{q}"


def _kv_cen_key(uid):
    return f"oo_simulador:{uid}"


# ═══════════════ HANDLER ═══════════════
class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    # ─────────────── GET ───────────────
    def do_GET(self):
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}

        # Visão do CORRETOR: só a própria proposta (aceite no Meu Painel)
        if params.get("proposta") == "1":
            try:
                user = require_user(self, min_lvl=0)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
            sb = supabase_client()
            if not sb:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            cfg = motor_cfg(sb)
            if cfg.get("motor_shadow"):
                return self._send(200, {"ok": True, "proposta": None})  # sombra: invisível
            uid = str(user.get("id"))
            today = datetime.now(timezone.utc).date()
            achada = None
            for q in (quarter_of(today), next_quarter(today)):
                v, _ok = _kv_read(sb, _kv_meta_key(uid, q))
                if v and v.get("status") in ("enviada", "aceita"):
                    achada = {**v, "quarter": q}
                    if v.get("status") == "enviada":
                        break
            return self._send(200, {"ok": True, "proposta": achada})

        # Visão do SÓCIO: estado calibrado completo
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        uid = params.get("user_id")
        if not uid:
            return self._send(400, {"ok": False, "error": "user_id obrigatório"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            urows = sb.table("users").select("id,name,email,role,team,ini,color").eq("id", uid).limit(1).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"users: {e}"})
        if not urows:
            return self._send(404, {"ok": False, "error": "corretor não encontrado"})
        u = urows[0]

        cfg = motor_cfg(sb)
        estado = calibrar(sb, uid, u, cfg)
        cen = cenario_calibrado(estado, u)
        estado["gargalo"] = gargalo(estado, cfg, cen)

        cen_salvo, _ok1 = _kv_read(sb, _kv_cen_key(uid))
        today = datetime.now(timezone.utc).date()
        propostas = {}
        for q in (quarter_of(today), next_quarter(today)):
            v, _ok2 = _kv_read(sb, _kv_meta_key(uid, q))
            if v:
                propostas[q] = v

        cfg_pub = {k: v for k, v in cfg.items() if not k.startswith("_")}
        return self._send(200, {
            "ok": True,
            "corretor": {"id": u.get("id"), "name": u.get("name"), "team": u.get("team"),
                         "role": u.get("role"), "ini": u.get("ini"), "color": u.get("color")},
            "config": cfg_pub,
            "shadow": bool(cfg.get("motor_shadow")),
            "estado": estado,
            "cenario_calibrado": cen,
            "cenario_salvo": (cen_salvo or {}).get("cenario"),
            "propostas": propostas,
            "quarter_atual": quarter_of(today),
            "quarter_proximo": next_quarter(today),
            "baseline": simulate(estado, cen, cfg),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })

    # ─────────────── POST ───────────────
    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        action = (body.get("action") or "").strip()

        # aceite = o PRÓPRIO corretor; todo o resto = sócio
        min_lvl = 0 if action == "aceitar" else 10
        try:
            user = require_user(self, min_lvl=min_lvl)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        cfg = motor_cfg(sb)

        # ── simular: cálculo puro ──
        if action == "simular":
            estado = body.get("estado") or {}
            cenario = body.get("cenario") or {}
            if not estado.get("taxas_usadas"):
                return self._send(400, {"ok": False, "error": "estado.taxas_usadas obrigatório (use o GET calibrado)"})
            return self._send(200, {"ok": True, "result": simulate(estado, cenario, cfg)})

        # ── salvar_cenario: retomar o 1:1 de onde parou ──
        if action == "salvar_cenario":
            uid = body.get("user_id")
            cen = body.get("cenario")
            if not uid or not isinstance(cen, dict):
                return self._send(400, {"ok": False, "error": "user_id e cenario obrigatórios"})
            okw = _kv_write(sb, _kv_cen_key(uid), {
                "cenario": cen, "ts": datetime.now(timezone.utc).isoformat(),
                "por": user.get("name") or user.get("email")}, updated_by=user.get("id"))
            if not okw:
                return self._send(500, {"ok": False, "error": "gravação falhou"})
            return self._send(200, {"ok": True})

        # ── config: calibração global (pisos, K, tickets, tempos, sombra…) ──
        if action == "config":
            patch = body.get("patch") or {}
            if not isinstance(patch, dict) or not patch:
                return self._send(400, {"ok": False, "error": "patch obrigatório"})
            cur, okr = _kv_read(sb, KV_CFG)
            if not okr:
                return self._send(503, {"ok": False, "error": "não consegui LER a config atual — gravação abortada por segurança"})
            before = json.loads(json.dumps(cur)) if cur else None
            novo = cur or {}
            CAMPOS = ("pisos", "K", "ticket_ref", "sens", "faixas", "tempos_min",
                      "dias_uteis", "horas_dia", "canal_min_amostra", "defasagem_meses", "motor_shadow")
            mudou = []
            for k in CAMPOS:
                if k in patch and patch[k] != novo.get(k):
                    mudou.append(k)
                    novo[k] = patch[k]
            if not mudou:
                return self._send(200, {"ok": True, "sem_mudancas": True, "config": {kk: vv for kk, vv in motor_cfg(sb).items() if not kk.startswith('_')}})
            log = novo.get("changelog") or []
            log.append({"quem": user.get("name") or user.get("email"),
                        "quando": datetime.now(timezone.utc).isoformat(), "campos": mudou})
            novo["changelog"] = log[-40:]
            if not _kv_write(sb, KV_CFG, novo, updated_by=user.get("id")):
                return self._send(500, {"ok": False, "error": "gravação falhou"})
            audit(self, user, "oo_motor.config", target_type="oo_motor", target_id=KV_CFG,
                  before=before, after=novo, notes=f"campos: {', '.join(mudou)}")
            return self._send(200, {"ok": True, "config": {kk: vv for kk, vv in motor_cfg(sb).items() if not kk.startswith('_')}})

        # ── proposta: cenário → proposta de meta trimestral (grava rascunho) ──
        if action == "proposta":
            uid = body.get("user_id")
            estado = body.get("estado") or {}
            cenario = body.get("cenario") or {}
            q = body.get("quarter") or next_quarter(datetime.now(timezone.utc).date())
            if not uid or not estado.get("taxas_usadas"):
                return self._send(400, {"ok": False, "error": "user_id e estado obrigatórios"})
            if not quarter_months(q):
                return self._send(400, {"ok": False, "error": "quarter inválido (use YYYYQn)"})
            sim = simulate(estado, cenario, cfg)
            m_auto = propor_m(sim, estado, cfg)
            aj = body.get("ajuste_socio")
            m = int(aj) if (isinstance(aj, (int, float)) and 1 <= int(aj) <= 3) else m_auto
            # atividade da proposta usa as taxas do CENÁRIO (overrides inclusos)
            atv = atividade_para(float(m), dict(sim["taxas"]), sim["fator_ticket"] * sim["fator_canais"])
            hpv = _num((sim.get("horas") or {}).get("por_venda"))
            cap = _num(cfg.get("dias_uteis"), 22) * _num(cfg.get("horas_dia"), 8)
            cur, okr = _kv_read(sb, _kv_meta_key(uid, q))
            if not okr:
                return self._send(503, {"ok": False, "error": "não consegui LER a proposta atual — abortado por segurança"})
            if cur and cur.get("status") == "aceita":
                return self._send(409, {"ok": False, "error": f"meta do {q} já foi ACEITA pelo corretor — não regravo por cima"})
            registro = {
                "quarter": q,
                "cenario": cenario,
                "estado_snapshot": {"taxas_usadas": estado.get("taxas_usadas"),
                                    "canais": estado.get("canais"),
                                    "media_6m_vendas": estado.get("media_6m_vendas")},
                "params_snapshot": {k: cfg.get(k) for k in ("pisos", "K", "ticket_ref", "sens", "dias_uteis", "horas_dia")},
                "proposta": {
                    "vendas_mes": m, "vendas_tri": m * 3,
                    "m_auto": m_auto, "ajuste_socio": (int(aj) if aj is not None and isinstance(aj, (int, float)) else None),
                    "vgv_mes_prev": round(m * sim["ticket_ponderado"], 2),
                    "ticket_ponderado": sim["ticket_ponderado"],
                    "atividade_mes": {k: round(v, 1) for k, v in atv.items()},
                    "horas_mes": round(hpv * m, 1), "capacidade": round(cap, 1),
                    "poisson_mes": pois_faixa(float(m)), "poisson_tri": pois_faixa(float(m * 3)),
                },
                "status": "proposta",
                "criado_por": user.get("name") or user.get("email"),
                "ts": datetime.now(timezone.utc).isoformat(),
            }
            if cur:
                registro["historico"] = ((cur.get("historico") or []) + [{"status_anterior": cur.get("status"), "ts": cur.get("ts")}])[-10:]
            if not _kv_write(sb, _kv_meta_key(uid, q), registro, updated_by=user.get("id")):
                return self._send(500, {"ok": False, "error": "gravação falhou"})
            audit(self, user, "oo_meta_motor.proposta", target_type="oo_meta_motor",
                  target_id=f"{uid}:{q}", before=cur, after=registro,
                  notes=f"m={m} (auto {m_auto}) tri {q}")
            return self._send(200, {"ok": True, "proposta": registro})

        # ── enviar: proposta → corretor (bloqueado em SOMBRA) ──
        if action == "enviar":
            uid = body.get("user_id")
            q = body.get("quarter")
            if not uid or not quarter_months(q or ""):
                return self._send(400, {"ok": False, "error": "user_id e quarter obrigatórios"})
            if cfg.get("motor_shadow"):
                return self._send(409, {"ok": False, "error": "motor em MODO SOMBRA — desligue na Calibração antes de enviar proposta a corretor"})
            cur, okr = _kv_read(sb, _kv_meta_key(uid, q))
            if not okr:
                return self._send(503, {"ok": False, "error": "não consegui LER a proposta — abortado"})
            if not cur or cur.get("status") not in ("proposta", "enviada"):
                return self._send(404, {"ok": False, "error": "não há proposta pra enviar (gere primeiro)"})
            before = json.loads(json.dumps(cur))
            cur["status"] = "enviada"
            cur["enviada"] = {"ts": datetime.now(timezone.utc).isoformat(),
                              "por": user.get("name") or user.get("email")}
            if not _kv_write(sb, _kv_meta_key(uid, q), cur, updated_by=user.get("id")):
                return self._send(500, {"ok": False, "error": "gravação falhou"})
            audit(self, user, "oo_meta_motor.enviar", target_type="oo_meta_motor",
                  target_id=f"{uid}:{q}", before=before, after=cur)
            p = cur.get("proposta") or {}
            # alçada: SÓ o corretor recebe (nunca broadcast)
            notify_all([uid], "meta_proposta",
                       f"🎯 Proposta de meta do trimestre {q}",
                       f"{p.get('vendas_mes')} venda(s)/mês ({p.get('vendas_tri')} no tri) · "
                       f"atividade mensal derivada do seu funil real. Veja e aceite no Meu Painel.",
                       link="/v2/#/painel", target_type="oo_meta_motor", target_id=f"{uid}:{q}")
            return self._send(200, {"ok": True, "proposta": cur})

        # ── aceitar: o PRÓPRIO corretor (grava aceite + deriva oo_norte do tri) ──
        if action == "aceitar":
            q = body.get("quarter")
            uid = str(user.get("id"))
            months = quarter_months(q or "")
            if not months:
                return self._send(400, {"ok": False, "error": "quarter obrigatório (YYYYQn)"})
            if cfg.get("motor_shadow"):
                return self._send(409, {"ok": False, "error": "motor em modo sombra — aceite indisponível"})
            cur, okr = _kv_read(sb, _kv_meta_key(uid, q))
            if not okr:
                return self._send(503, {"ok": False, "error": "não consegui LER a proposta — tente de novo"})
            if not cur or cur.get("status") != "enviada":
                return self._send(404, {"ok": False, "error": "nenhuma proposta pendente de aceite"})
            before = json.loads(json.dumps(cur))
            cur["status"] = "aceita"
            cur["aceite"] = {"ts": datetime.now(timezone.utc).isoformat(),
                             "por": user.get("name") or user.get("email")}
            if not _kv_write(sb, _kv_meta_key(uid, q), cur, updated_by=uid):
                return self._send(500, {"ok": False, "error": "gravação do aceite falhou"})

            # metas mensais de ATIVIDADE derivadas → oo_norte dos 3 meses (PATCH:
            # preserva canais/obs que o gestor já tenha editado; formato intocado)
            p = cur.get("proposta") or {}
            atv = p.get("atividade_mes") or {}
            metas_etapas = {k: round(_num(atv.get(k)), 1) for k in ETAPAS[:-1]}
            metas_etapas["venda"] = p.get("vendas_mes")
            gravados, falhas = [], []
            for ym in months:
                key = f"oo_norte:{uid}:{ym}"
                cfg_n, okn = _kv_read(sb, key)
                if not okn:
                    falhas.append(ym)
                    continue
                novo = cfg_n or {"atendimentos_mes": 0, "ticket_medio": 0, "canais": [],
                                 "metas_etapas": {k: None for k in ETAPAS}, "obs": "", "changelog": []}
                me = novo.get("metas_etapas") or {k: None for k in ETAPAS}
                me.update(metas_etapas)
                novo["metas_etapas"] = me
                novo["atendimentos_mes"] = round(_num(atv.get("lead")), 0)
                if _num(p.get("ticket_ponderado")) > 0:
                    novo["ticket_medio"] = _num(p.get("ticket_ponderado"))
                log = novo.get("changelog") or []
                log.append({"quem": user.get("name") or user.get("email"),
                            "quando": datetime.now(timezone.utc).isoformat(),
                            "mudancas": [{"campo": "meta do motor 1:1", "de": "—",
                                          "para": f"{p.get('vendas_mes')} venda(s)/mês · tri {q} aceito"}]})
                novo["changelog"] = log[-60:]
                if _kv_write(sb, key, novo, updated_by=uid):
                    gravados.append(ym)
                else:
                    falhas.append(ym)
            audit(self, user, "oo_meta_motor.aceite", target_type="oo_meta_motor",
                  target_id=f"{uid}:{q}", before=before, after=cur,
                  notes=f"nortes gravados: {', '.join(gravados) or 'nenhum'}"
                        + (f" · FALHAS: {', '.join(falhas)}" if falhas else ""))

            # alçada: sócios + gestor da equipe do corretor (nunca broadcast)
            dest = set()
            try:
                for x in (sb.table("users").select("id,role,team,status").execute().data or []):
                    if (x.get("status") or "ativo") != "ativo" or not x.get("id"):
                        continue
                    r = (x.get("role") or "").lower()
                    if lvl_of(r) >= 10:
                        dest.add(str(x["id"]))
                    elif r in ("lider", "líder", "gerente") and \
                            (x.get("team") or "").strip().lower() == (user.get("team") or "").strip().lower():
                        dest.add(str(x["id"]))
            except Exception:
                pass
            dest.discard(uid)
            if dest:
                notify_all(list(dest), "meta_aceita",
                           f"✅ {user.get('name') or 'Corretor'} aceitou a meta do {q}",
                           f"{p.get('vendas_mes')} venda(s)/mês · atividade mensal gravada no Norte do Mês"
                           + (f" · atenção: falhou gravar {', '.join(falhas)}" if falhas else ""),
                           link="/v2/#/one-on-one", target_type="oo_meta_motor", target_id=f"{uid}:{q}")
            return self._send(200, {"ok": True, "proposta": cur,
                                    "nortes_gravados": gravados, "nortes_falha": falhas})

        return self._send(400, {"ok": False, "error": f"action desconhecida: {action or '(vazia)'}"})
