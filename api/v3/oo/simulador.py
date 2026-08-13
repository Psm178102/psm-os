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
import re

from _oo_lib import (  # type: ignore
    MILESTONES, deal_max_milestone, channel, CHANNEL_LABEL, source, parse_dt, amount,
    build_stage_maps,
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
    "canal_min_amostra": 10,                   # leads no canal < isso → canal neutro (taxa_rel=1.0)
    "canal_min_vendas": 5,                     # vendas 90d do corretor < isso → TODOS os canais neutros
                                               # (com 1-2 vendas, conversão por canal é ruído puro — v86.5)
    "defasagem_meses": {"map": 3, "conquista": 1},  # venda do mês ↔ atividade de N meses atrás
    "motor_shadow": True,
    # 🔁 v86.2: equipes cujo simulador ESPELHA o funil REAL do RD (etapas 1:1, mesma
    # quantidade e nomenclatura — regra do Paulo: etapa diferente = métrica divergente).
    # {substring_do_time: substring_do_nome_do_funil_no_rd}
    "funil_rd_por_time": {"map": "map"},
    # pisos por passagem do funil RD: {pipeline_id: {"p<pos>": taxa}} — sem valor,
    # o piso vem da taxa REAL da EQUIPE inteira naquela passagem (90d)
    "pisos_rd": {},
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
            if k in ("pisos", "faixas", "tempos_min", "defasagem_meses", "funil_rd_por_time", "pisos_rd") and isinstance(v, dict):
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
def cadeia_de(estado, cfg):
    """Cadeia ordenada de passagens do funil deste corretor.
    Canônico (default): 6 passagens lead→…→venda com tempos do cfg.
    Modo RD (ex.: funil MAP): a cadeia vem PRONTA no estado (etapas reais 1:1)."""
    if isinstance(estado.get("cadeia"), list) and estado["cadeia"]:
        return estado["cadeia"]
    tempos = cfg.get("tempos_min") or {}
    out = []
    for i, k in enumerate(PASSAGENS):
        out.append({"key": k, "label": PASS_LABEL[k],
                    "origem": ETAPAS[i], "origem_label": MILESTONES[i][1],
                    "marco": i, "tempo_min": _num(tempos.get(ETAPAS[i]), 0)})
    return out


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
    """Cenário → resultado. estado = taxas usadas + canais + cadeia (do GET
    calibrado); cenario = atendimentos/perfil/energia/overrides."""
    faixas = cfg["faixas"]
    cadeia = cadeia_de(estado, cfg)
    keys = [c["key"] for c in cadeia]

    # 1) taxas por passagem (usadas, com overrides do "e se")
    taxas = {}
    base = estado.get("taxas_usadas") or {}
    overrides = cenario.get("overrides") or {}
    for k in keys:
        t = _num(base.get(k), 0.0)
        if k in overrides and overrides[k] is not None:
            t = _num(overrides[k], t)
        taxas[k] = _clamp(t, 0.01, 0.98)
    conv_funil = 1.0
    for k in keys:
        conv_funil *= taxas[k]

    # 2) ticket ponderado do perfil + elasticidade ticket→conversão
    mix = mix_do_perfil(cenario.get("perfil"), cenario.get("mix_manual"), faixas)
    ticket_pond = sum(w * _num(faixas[f]["ticket"]) for f, w in mix.items())
    jornada_pond = sum(w * _num(faixas[f].get("jornada_meses"), 1) for f, w in mix.items())
    fator_ticket = 1.0
    if ticket_pond > 0 and _num(cfg.get("ticket_ref")) > 0:
        fator_ticket = _clamp((_num(cfg["ticket_ref"]) / ticket_pond) ** _num(cfg.get("sens"), 0.5), 0.5, 1.5)

    # 3) canais: vendas do canal escalam com mix × energia × taxa relativa
    #    (semântica da planilha: energia 0 zera o canal, 100 = taxa plena; mix
    #    não-energizado se PERDE, não redistribui).
    #    v86.8: o CENÁRIO pode trazer os próprios canais (lista personalizável —
    #    mix E energia editáveis, catálogo completo da planilha). Conv relativa
    #    vem do MEDIDO 90d quando o canal existe no RD; canal sem medição = neutro.
    canais_in = estado.get("canais") or []
    rel_map = {c.get("key"): _num(c.get("taxa_rel"), 1.0) for c in canais_in}
    canais_cen = cenario.get("canais")
    energia = cenario.get("energia") or {}
    fator_canais, canais_out = 0.0, []
    if isinstance(canais_cen, list) and canais_cen:
        for c in canais_cen:
            key = c.get("key")
            mx = _clamp(_num(c.get("mix")), 0.0, 400.0) / 100.0
            en = _clamp(_num(c.get("energia"), 100.0), 0.0, 100.0)
            tr = rel_map.get(key, 1.0)
            contrib = mx * (en / 100.0) * tr
            fator_canais += contrib
            canais_out.append({"key": key, "label": c.get("label") or CHANNEL_LABEL.get(key, key),
                               "share": round(mx, 4), "mix": round(mx * 100, 1),
                               "taxa_rel": round(tr, 3), "energia": en,
                               "contrib": round(contrib, 4)})
    elif canais_in:
        for c in canais_in:
            key = c.get("key")
            sh = _num(c.get("share"))
            tr = _num(c.get("taxa_rel"), 1.0)
            en = _clamp(_num(energia.get(key), 100.0), 0.0, 100.0)
            contrib = sh * (en / 100.0) * tr
            fator_canais += contrib
            canais_out.append({"key": key, "label": c.get("label") or CHANNEL_LABEL.get(key, key),
                               "share": round(sh, 4), "mix": round(sh * 100, 1),
                               "taxa_rel": round(tr, 3),
                               "energia": en, "contrib": round(contrib, 4)})
    else:
        fator_canais = 1.0

    conv_efetiva = conv_funil * fator_ticket * fator_canais
    atend = max(0.0, _num(cenario.get("atendimentos_mes")))
    vendas = atend * conv_efetiva
    vgv = vendas * ticket_pond

    # 4) atividade mensal por etapa (funil reverso; fator ticket×canais distribuído)
    fator_total = fator_ticket * fator_canais
    rows_atv, horas = atividade_para(vendas, taxas, fator_total, cadeia)
    atividade = {r["origem"]: r["valor"] for r in rows_atv}

    # 5) horas + farol
    capacidade = _num(cfg.get("dias_uteis"), 22) * _num(cfg.get("horas_dia"), 8)
    pct_cap = (horas / capacidade) if capacidade else None
    farol = None
    if pct_cap is not None:
        farol = "cabe" if pct_cap <= 0.85 else ("apertado" if pct_cap <= 1.0 else "nao_cabe")

    # horas por 1 venda/mês (régua da proposta — escala linear)
    _r1, horas_por_venda = atividade_para(1.0, taxas, fator_total, cadeia)

    out = {
        "taxas": {k: round(taxas[k], 4) for k in keys},
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
        "atividade_rows": [{"key": r["origem"], "label": r["origem_label"],
                            "valor": round(r["valor"], 1)} for r in rows_atv],
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


def atividade_para(vendas_alvo, taxas, fator_total, cadeia):
    """Volume mensal necessário em cada ETAPA da cadeia pra fechar `vendas_alvo`
    vendas + horas totais. O fator ticket×canais entra DISTRIBUÍDO geometricamente
    (fator^(1/n) por passagem) — o produto continua conv_funil×fator (entrada =
    vendas/conv_efetiva) e o funil fica sempre decrescente.
    Devolve ([{key,origem,origem_label,marco,valor,tempo_min}...em ordem], horas)."""
    n = max(1, len(cadeia))
    fN = max(0.001, fator_total) ** (1.0 / n)
    acc = max(0.0, vendas_alvo)
    rows = []
    for c in reversed(cadeia):   # da última passagem pra primeira
        t = _clamp(_num(taxas.get(c["key"]), 0.5) * fN, 0.001, 0.98)
        acc = acc / t
        rows.append({"key": c["key"], "origem": c.get("origem") or c["key"],
                     "origem_label": c.get("origem_label") or c.get("label") or c["key"],
                     "marco": c.get("marco"), "valor": acc,
                     "tempo_min": _num(c.get("tempo_min"), 0)})
    rows.reverse()
    horas = sum(r["valor"] * r["tempo_min"] for r in rows) / 60.0
    return rows, horas


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

    canais_cen = cenario.get("canais")
    if isinstance(canais_cen, list) and canais_cen:
        # canais personalizados do cenário: alavanca = energia total num canal com mix relevante
        for i, c in enumerate(canais_cen):
            en = _clamp(_num(c.get("energia"), 100.0), 0.0, 100.0)
            if en < 100 and _num(c.get("mix")) > 2:
                l2 = json.loads(json.dumps(canais_cen))
                l2[i]["energia"] = 100
                dv = _vendas({"canais": l2}) - vendas_base
                if dv > 0.001:
                    cands.append({"tipo": "canal", "key": c.get("key"),
                                  "label": f"Energia total em {c.get('label') or CHANNEL_LABEL.get(c.get('key'), c.get('key'))} (→100)",
                                  "delta_vendas": round(dv, 3)})
    else:
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
    for c in cadeia_de(estado, cfg):
        k = c["key"]
        atual = _num(overrides.get(k), _num(base_taxas.get(k)))
        novo = min(0.95, atual + 0.05)
        if novo > atual:
            o2 = dict(overrides)
            o2[k] = novo
            dv = _vendas({"overrides": o2}) - vendas_base
            if dv > 0.001:
                cands.append({"tipo": "etapa", "key": k,
                              "label": f"{c.get('label') or k} +5pp",
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
    base = estado.get("taxas_usadas") or {}
    overrides = cenario.get("overrides") or {}
    conv = 1.0
    for c in cadeia_de(estado, cfg):
        k = c["key"]
        t = _num(base.get(k), 0.0)
        if k in overrides and overrides[k] is not None:
            t = _num(overrides[k], t)
        conv *= _clamp(t, 0.01, 0.98)
    mix = mix_do_perfil(cenario.get("perfil"), cenario.get("mix_manual"), faixas)
    tp = sum(w * _num(faixas[f]["ticket"]) for f, w in mix.items())
    ft = 1.0
    if tp > 0 and _num(cfg.get("ticket_ref")) > 0:
        ft = _clamp((_num(cfg["ticket_ref"]) / tp) ** _num(cfg.get("sens"), 0.5), 0.5, 1.5)
    energia = cenario.get("energia") or {}
    canais = estado.get("canais") or []
    rel_map = {c.get("key"): _num(c.get("taxa_rel"), 1.0) for c in canais}
    canais_cen = cenario.get("canais")
    fc = 0.0
    if isinstance(canais_cen, list) and canais_cen:
        for c in canais_cen:
            en = _clamp(_num(c.get("energia"), 100.0), 0.0, 100.0)
            fc += (_clamp(_num(c.get("mix")), 0.0, 400.0) / 100.0) * (en / 100.0) * rel_map.get(c.get("key"), 1.0)
    elif canais:
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

    # canais: share dos leads 90d + taxa relativa (conv do canal ÷ conv geral).
    # taxa relativa SÓ liga com amostra decente dos dois lados: leads do canal
    # (canal_min_amostra) E vendas totais 90d (canal_min_vendas) — com 1-2 vendas,
    # todo canal sem venda ia pro chão do clamp e derrubava a conversão efetiva
    # sem sentido nenhum (achado da auditoria ao vivo, v86.5).
    total_leads_ch = sum(ch_leads.values())
    conv_geral = (vendas_90 / total_leads_ch) if total_leads_ch else 0
    min_amostra = int(_num(cfg.get("canal_min_amostra"), 10))
    min_vendas = int(_num(cfg.get("canal_min_vendas"), 5))
    canais = []
    for ck in sorted(ch_leads, key=lambda x: -ch_leads[x]):
        n_c = ch_leads[ck]
        share = n_c / total_leads_ch if total_leads_ch else 0
        if n_c >= min_amostra and vendas_90 >= min_vendas and conv_geral > 0:
            taxa_rel = _clamp((ch_vendas.get(ck, 0) / n_c) / conv_geral, 0.5, 2.0)
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

    est = {
        "window": {"since": since_d.isoformat(), "until": today.isoformat(), "dias": dias},
        "modo": "canonico",
        "funil": [{"key": ETAPAS[i], "label": MILESTONES[i][1], "n": funnel[i]} for i in range(7)],
        "passagens": passagens,
        "taxas_usadas": taxas_usadas,
        "cadeia": None,   # canônico usa a cadeia default (cadeia_de)
        "canais": canais,
        "leads_90d": leads_criados,
        "volume_mensal_leads": round(leads_criados / (dias / 30.0), 1),
        "vendas_90d": vendas_90,
        "ticket_corretor": ticket_corr,
        "ticket_equipe": ticket_eq,
        "media_6m_vendas": media_6m,
    }
    est["cadeia"] = cadeia_de(est, cfg)

    # 🔁 v86.2: equipe com funil RD espelhado (MAP) — etapas EXATAMENTE iguais em
    # quantidade e nomenclatura ao funil do RD CRM (regra do Paulo: etapa diferente
    # = métrica divergente). Substitui funil/passagens/taxas/cadeia do estado.
    # rd_debug fica na resposta (sócio-only) — erro engolido aqui virou funil
    # canônico silencioso na v86.2/3 e ninguém sabia o porquê.
    try:
        rd = _calibrar_rd(sb, u, cfg, deals, events, since_dt, until_dt)
        est["rd_debug"] = None if rd else "nenhum funil RD casou com o time (funil_rd_por_time / rd_stages)"
    except Exception as e:
        rd = None
        est["rd_debug"] = f"{type(e).__name__}: {str(e)[:200]}"
    if rd:
        est.update(rd)
    return est


# régua LOCAL de marco pra etapas de funil RD (mais criteriosa que a do cockpit:
# 'visita realizada' exige VISITA no nome — senão 'CONTATO REALIZADO' viraria visita;
# 'pasta' em etapa-fonte tipo 'PASTAS LANÇAMENTO' não pode virar marco 5)
_MARCO_RD = [
    (5, re.compile(r"pasta|dossi[êe]", re.I)),
    (4, re.compile(r"proposta|negocia|aprova", re.I)),
    (3, re.compile(r"visita.*realizad|realizad.*visita", re.I)),
    (2, re.compile(r"agendad|agendar|agendamento", re.I)),
    (1, re.compile(r"contato|qualific|atend|tentativ|oport", re.I)),
]


def _marco_rd(nm):
    n = (nm or "").lower()
    for idx, rx in _MARCO_RD:
        if rx.search(n):
            return idx
    return 0


def _marcos_monotonicos(stages):
    """Marco canônico (0..6) de cada etapa RD, com 2 regras de sanidade:
    1) etapas-FONTE (antes da 1ª etapa de atendimento, ex.: CARTEIRA / PASTAS
       LANÇAMENTO / REATIVAÇÕES no MAP) = marco 0 (lead) — regex sozinho erraria.
    2) monotônico: o marco nunca volta ao longo das posições (OPORTUNIDADE DO MÊS
       depois de VISITA REALIZADA herda o marco da visita, não vira 'contato').
    Última etapa = 6 (venda/contrato)."""
    raw = [_marco_rd(nm) for _pos, nm in stages]
    # começo do funil ATIVO = 1ª etapa de contato/agendamento (marco 1 ou 2);
    # tudo antes é fonte/entrada de lead, mesmo que o nome engane (ex.: 'pastas')
    first_active = next((i for i, m in enumerate(raw) if m in (1, 2)), 0)
    out, run = [], 0
    for i in range(len(stages)):
        m = 0 if i < first_active else raw[i]
        run = max(run, m)
        out.append(run)
    if out:
        out[-1] = 6
    return out


def _calibrar_rd(sb, u, cfg, deals, events, since_dt, until_dt):
    """Funil RD espelhado pro time (cfg funil_rd_por_time). Devolve o patch do
    estado (modo/pipeline/funil/passagens/taxas_usadas/cadeia) ou None."""
    tkey = (u.get("team") or "").strip().lower()
    alvo = None
    for t_sub, p_sub in (cfg.get("funil_rd_por_time") or {}).items():
        if t_sub and str(t_sub).lower() in tkey:
            alvo = str(p_sub or t_sub).strip().lower()
            break
    if not alvo:
        return None
    stages_rows = sb.table("rd_stages").select("*").execute().data or []
    pipes_rows = sb.table("rd_pipelines").select("*").execute().data or []
    pos_by_id, by_pipe, pipe_names = build_stage_maps(stages_rows, pipes_rows)
    # ids candidatos do funil (id E external_id apontam pro mesmo nome). Pode haver
    # mais de um funil com o termo (ex.: 'FUNIL MAP' e 'CARTEIRA MAP PAULO') —
    # fica o que tem MAIS etapas; empate desempata por nome começando com 'funil'.
    cands = []
    for k, nm in pipe_names.items():
        p = str(k)
        if alvo in (nm or "").lower() and p in by_pipe and len(by_pipe[p]) >= 2:
            cands.append((len(by_pipe[p]), (nm or "").lower().startswith("funil"), p))
    cands.sort(reverse=True)
    pid = cands[0][2] if cands else None
    if not pid:
        return None
    # aliases do funil escolhido (id E external_id apontam pro MESMO nome) —
    # deals/stage podem referenciar qualquer variante
    nome_pid = pipe_names.get(pid)
    pids = {k for k, nm in pipe_names.items() if nm == nome_pid}
    pids.add(pid)
    stages = by_pipe[pid]                      # [(pos, nome)] ordenado
    marcos = _marcos_monotonicos(stages)
    tempos_cfg = cfg.get("tempos_min") or {}

    def _max_pos(d, evs):
        dpid = str(d.get("pipeline_id") or "")
        sid = str(d.get("stage_id") or "")
        spid, spos = pos_by_id.get(sid) or ("", 0)
        if dpid not in pids and spid not in pids:
            return None                        # deal de outro funil
        mx = spos if spid in pids or dpid in pids else 0
        for ev in (evs or []):
            if isinstance(ev[0], int):
                mx = max(mx, ev[0])
        if d.get("win") is True:
            mx = max(mx, stages[-1][0])
        return mx

    def _counts(dset, evmap):
        cnt = {pos: 0 for pos, _n in stages}
        tot = 0
        for d in dset:
            win = d.get("win")
            created = parse_dt(d.get("created_at_rd")) or parse_dt((d.get("rd_raw") or {}).get("created_at"))
            closed = parse_dt(d.get("closed_at"))
            touches = ((created and since_dt <= created <= until_dt)
                       or (closed and since_dt <= closed <= until_dt) or win is None)
            if not touches:
                continue
            mx = _max_pos(d, (evmap or {}).get(str(d.get("id"))) if evmap else None)
            if mx is None:
                continue
            tot += 1
            for pos, _n in stages:
                if mx >= pos:
                    cnt[pos] += 1
        return cnt, tot

    counts, meus = _counts(deals, events)
    if meus == 0:
        pass  # corretor sem deal no funil — segue: taxas nascem do piso da equipe

    # PISO por passagem = taxa REAL da EQUIPE inteira (90d, sem eventos — aproximação
    # leve: etapa atual ≈ máximo alcançado) com cache 24h; override em cfg pisos_rd.
    team_rates, team_ns = {}, {}
    ck = f"oo_pisos_rd_cache:{pid}"
    cache, _okc = _kv_read(sb, ck)
    fresh = False
    if cache and cache.get("ts"):
        try:
            fresh = (datetime.now(timezone.utc) - parse_dt(cache["ts"])).total_seconds() < 86400
        except Exception:
            fresh = False
    if fresh:
        team_rates = cache.get("rates") or {}
        team_ns = cache.get("n") or {}
    else:
        try:
            membros = [m for m in (sb.table("users").select("id,email,team,status").execute().data or [])
                       if (m.get("status") or "ativo") == "ativo"
                       and (m.get("team") or "").strip().lower() == tkey]
            mids = [m.get("id") for m in membros if m.get("id")]
            tdeals = []
            cols = "id,win,closed_at,created_at_rd,stage_id,pipeline_id,rd_raw"
            for i in range(0, len(mids), 80):
                pg = 0
                while True:
                    ch = (sb.table("deals").select(cols).in_("user_id", mids[i:i + 80])
                          .order("id").range(pg * 1000, pg * 1000 + 999).execute().data or [])
                    tdeals.extend(ch)
                    if len(ch) < 1000 or pg >= 20:
                        break
                    pg += 1
            tcnt, _tot = _counts(tdeals, None)
            for i in range(len(stages) - 1):
                a, b = stages[i][0], stages[i + 1][0]
                key = f"p{a}"
                team_ns[key] = tcnt[a]
                if tcnt[a] > 0:
                    team_rates[key] = round(tcnt[b] / tcnt[a], 4)
            _kv_write(sb, ck, {"ts": datetime.now(timezone.utc).isoformat(),
                               "rates": team_rates, "n": team_ns, "pipeline": pipe_names.get(pid)})
        except Exception:
            team_rates, team_ns = {}, {}

    pisos_cfg = ((cfg.get("pisos_rd") or {}).get(str(pid)) or {})
    pisos_canon = cfg.get("pisos") or {}
    K = max(1, int(_num(cfg.get("K"), 30)))
    passagens, taxas_usadas, cadeia = [], {}, []
    for i in range(len(stages) - 1):
        a_pos, a_nome = stages[i]
        b_pos, b_nome = stages[i + 1]
        key = f"p{a_pos}"
        n_k = counts[a_pos]
        real = (counts[b_pos] / counts[a_pos]) if counts[a_pos] else None
        # piso: config explícita > equipe (amostra ≥8) > piso canônico do marco
        if key in pisos_cfg:
            piso, base = _clamp(_num(pisos_cfg[key], 0.5), 0.01, 0.98), "config"
        elif key in team_rates and (team_ns.get(key) or 0) >= 8:
            piso, base = _clamp(_num(team_rates[key], 0.5), 0.01, 0.98), "equipe"
        else:
            mk = min(5, max(0, marcos[i]))
            piso, base = _clamp(_num(pisos_canon.get(PASSAGENS[mk] if mk < 6 else "venda"), 0.5), 0.01, 0.98), "mercado"
        usada = ((n_k * real + K * piso) / (n_k + K)) if real is not None else piso
        usada = _clamp(usada, 0.01, 0.98)
        taxas_usadas[key] = round(usada, 4)
        passagens.append({"key": key, "label": f"{a_nome} → {b_nome}", "n": n_k,
                          "real": round(real, 4) if real is not None else None,
                          "piso": piso, "piso_base": base, "usada": round(usada, 4)})
        mk = min(5, max(0, marcos[i]))
        cadeia.append({"key": key, "label": f"{a_nome} → {b_nome}",
                       "origem": f"s{a_pos}", "origem_label": a_nome,
                       "marco": marcos[i], "tempo_min": _num(tempos_cfg.get(ETAPAS[mk]), 0)})

    return {
        "modo": "rd",
        "pipeline": {"id": str(pid), "nome": pipe_names.get(pid) or "Funil"},
        "funil": [{"key": f"s{pos}", "label": nome, "n": counts[pos], "marco": marcos[i]}
                  for i, (pos, nome) in enumerate(stages)],
        "passagens": passagens,
        "taxas_usadas": taxas_usadas,
        "cadeia": cadeia,
        "deals_no_funil": meus,
    }


def perfil_do_team(team):
    t = (team or "").strip().lower()
    if "conquista" in t:
        return "conquista"
    if "map" in t:
        return "map"
    return "misto"


def cenario_calibrado(estado, u):
    """Cenário-default: o corretor como ele é hoje (volume real, mix real, energia 100)."""
    return {
        "atendimentos_mes": max(1.0, estado.get("volume_mensal_leads") or 0),
        "perfil": perfil_do_team(u.get("team")),
        "mix_manual": None,
        "energia": {c["key"]: 100 for c in (estado.get("canais") or [])},
        # canais personalizáveis (v86.8): nasce do MIX REAL do RD; o sócio troca/
        # acrescenta origens do catálogo da planilha no quadro Simulador
        "canais": [{"key": c["key"], "label": c.get("label"),
                    "mix": round(_num(c.get("share")) * 100, 1), "energia": 100}
                   for c in (estado.get("canais") or [])],
        "overrides": {},
        "meta_vendas_mes": None,
    }


def gargalo(estado, cfg, cen_base):
    """Passagem cujo conserto até o piso mais aumenta vendas (gap × impacto)."""
    best, best_dv = None, 0.0
    sub = {"taxas_usadas": estado["taxas_usadas"], "canais": estado["canais"],
           "cadeia": estado.get("cadeia")}
    base_v = _simulate_core(sub, cen_base, cfg)["vendas"]
    for p in estado["passagens"]:
        if p["real"] is not None and p["real"] < p["piso"] and p["n"] >= 5:
            o2 = {p["key"]: p["piso"]}
            v2 = _simulate_core(sub, {**cen_base, "overrides": o2}, cfg)["vendas"]
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
                      "dias_uteis", "horas_dia", "canal_min_amostra", "defasagem_meses",
                      "motor_shadow", "pisos_rd", "funil_rd_por_time")
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
            cadeia = cadeia_de(estado, cfg)
            atv_rows, _h = atividade_para(float(m), dict(sim["taxas"]),
                                          sim["fator_ticket"] * sim["fator_canais"], cadeia)
            # canônico (7 marcos) pro oo_norte: volume da PRIMEIRA etapa de cada marco
            atv = {}
            for r in atv_rows:
                mk = min(5, max(0, int(r.get("marco") or 0)))
                if ETAPAS[mk] not in atv:
                    atv[ETAPAS[mk]] = round(r["valor"], 1)
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
                                    "cadeia": estado.get("cadeia"),
                                    "pipeline": estado.get("pipeline"),
                                    "media_6m_vendas": estado.get("media_6m_vendas")},
                "params_snapshot": {k: cfg.get(k) for k in ("pisos", "K", "ticket_ref", "sens", "dias_uteis", "horas_dia")},
                "proposta": {
                    "vendas_mes": m, "vendas_tri": m * 3,
                    "m_auto": m_auto, "ajuste_socio": (int(aj) if aj is not None and isinstance(aj, (int, float)) else None),
                    "vgv_mes_prev": round(m * sim["ticket_ponderado"], 2),
                    "ticket_ponderado": sim["ticket_ponderado"],
                    "atividade_mes": {k: round(v, 1) for k, v in atv.items()},
                    "atividade_rows": [{"key": r["origem"], "label": r["origem_label"],
                                        "valor": round(r["valor"], 1)} for r in atv_rows],
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
            # só grava marcos que a atividade cobre (funil RD pode não ter 'pasta', ex.: MAP)
            metas_etapas = {k: round(_num(atv.get(k)), 1) for k in ETAPAS[:-1] if atv.get(k) is not None}
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
