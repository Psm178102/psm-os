"""
_projecao_lib.py — META · REALIZADO · PROJEÇÃO, com horizonte escolhido. v87.91

Pedido do Paulo (16/09/2026): "as projeções são muito irreais e/ou erradas, zerando etc, não temos
previsão nenhuma desta forma; dentro da Gestão Comercial temos que ter uma tela de Meta + Realizado +
Projeção (tempo personalizável) — mês atual, semana, quinzenal, trimestral, semestral e anual".

Por que as projeções antigas não serviam (medido em 16/09):
  • RITMO (vendido ÷ dias decorridos × dias do período) zera enquanto não sai venda no período.
  • PIPELINE PONDERADO do Cérebro não é calibrado: soma milhares de abertos e dava 21 vendas só pro Kadu,
    contra ~6 vendas/mês da empresa inteira no histórico.

MODELO (Dicionário de Métricas §8, revisão 16/09) — igual pra corretor, equipe e empresa:
  Realizado R      = vendas ganhas no RD de [início, hoje] (régua §1).
  Ritmo histórico H = vendas/dia útil dos últimos 180 dias × dias úteis que faltam no horizonte.
                      Por corretor, suavizado pela média da equipe (corretor novo não zera, veterano pesa o próprio).
  Funil F          = propostas/contratos abertos (mexidos em 60 d) × taxa REAL proposta→venda da equipe
                      × fração que cabe no prazo (dias corridos restantes ÷ dias medianos proposta→venda).
  Provável         = R + max(H, F)   ← projeção oficial
  Conservador      = R + min(H, F)
  Otimista         = R + H + F
  VGV              = vendas × ticket de referência (vendido usa o valor real; funil usa o valor do negócio ou o ticket).
  Meta do horizonte = metas mensais proporcionais aos dias úteis (seg–sáb) do período; meta de vendas = meta_vendas
                      ou meta_vgv ÷ ticket quando só a meta de VGV foi cadastrada.
"""
import calendar
import math
from datetime import date, datetime, timedelta, timezone

import _metricas_lib as MX

CACHE_BASE = "metricas_proj:v2"   # v88.2: realizado da empresa inclui quem saiu e sem corretor
HIST_DIAS = 180            # janela do ritmo histórico
SHRINK_K = 26              # peso da média da equipe (≈ 1 mês de dias úteis) na suavização por corretor
FUNIL_MEXIDO_DIAS = 60     # proposta parada há mais que isso não entra no funil
CAL_INI_DIAS, CAL_FIM_DIAS = 240, 30   # calibração: entradas em proposta entre 240 e 30 dias atrás
CAL_MIN_N = 15             # amostra mínima pra usar a taxa da equipe (senão empresa, senão padrão)
TAXA_PADRAO, DIAS_PADRAO = 0.15, 21
CHAVES_FUNIL = ("proposta", "contrato")
HORIZONTES = ("semana", "quinzena", "mes", "trimestre", "semestre", "ano")
HZ_LABEL = {"semana": "Semana", "quinzena": "Quinzena", "mes": "Mês", "trimestre": "Trimestre",
            "semestre": "Semestre", "ano": "Ano", "personalizado": "Período"}


# ─── calendário ──────────────────────────────────────────────────────────────
def dias_uteis(a, b):
    """Dias úteis (seg–sáb) de a até b, inclusive. 0 se b < a."""
    if b < a:
        return 0
    n, d = 0, a
    while d <= b:
        if d.weekday() < 6:
            n += 1
        d += timedelta(days=1)
    return n


def horizonte(params, hoje):
    """→ (chave, ini, fim). Horizontes nomeados em Brasília; personalizado por since/until."""
    p = params or {}
    h = (p.get("h") or p.get("horizonte") or "").lower()
    if p.get("since") and p.get("until") and h not in HORIZONTES:
        try:
            s, u = date.fromisoformat(p["since"][:10]), date.fromisoformat(p["until"][:10])
            if s <= u:
                return "personalizado", s, u
        except Exception:
            pass
    if h == "semana":
        ini = hoje - timedelta(days=hoje.weekday())
        return h, ini, ini + timedelta(days=5)
    if h == "quinzena":
        if hoje.day <= 15:
            return h, hoje.replace(day=1), hoje.replace(day=15)
        return h, hoje.replace(day=16), hoje.replace(day=calendar.monthrange(hoje.year, hoje.month)[1])
    if h == "trimestre":
        m0 = (hoje.month - 1) // 3 * 3 + 1
        fim_m = m0 + 2
        return h, date(hoje.year, m0, 1), date(hoje.year, fim_m, calendar.monthrange(hoje.year, fim_m)[1])
    if h == "semestre":
        if hoje.month <= 6:
            return h, date(hoje.year, 1, 1), date(hoje.year, 6, 30)
        return h, date(hoje.year, 7, 1), date(hoje.year, 12, 31)
    if h == "ano":
        return h, date(hoje.year, 1, 1), date(hoje.year, 12, 31)
    return "mes", hoje.replace(day=1), hoje.replace(day=calendar.monthrange(hoje.year, hoje.month)[1])


def _poisson_faixa(lam, lo_q=0.10, hi_q=0.90):
    """Quantis de Poisson(λ) — faixa de variação normal do número de vendas que ainda vêm."""
    if lam <= 0:
        return 0, 0
    lo = hi = None
    p = math.exp(-lam)
    acc, k = p, 0
    while k < 500:
        if lo is None and acc >= lo_q:
            lo = k
        if acc >= hi_q:
            hi = k
            break
        k += 1
        p = p * lam / k
        acc += p
    return (lo or 0), (hi if hi is not None else k)


# ─── cargas ──────────────────────────────────────────────────────────────────
def _users(sb):
    rows = sb.table("users").select("id,name,email,role,team,status,is_service").execute().data or []
    return [u for u in rows if u.get("id")]


def _stage_ids_funil(sb):
    try:
        rows = sb.table("rd_stages").select("id,psm_stage_key").execute().data or []
        return {str(r["id"]) for r in rows if r.get("id") and r.get("psm_stage_key") in CHAVES_FUNIL}
    except Exception:
        return set()


def _calibracao(sb, stage_ids, owner_team, email_team, agora):
    """Taxa real proposta→venda e dias medianos por equipe (e empresa), a partir de quem ENTROU em
    proposta/contrato entre 240 e 30 dias atrás (tempo suficiente pra desfecho)."""
    if not stage_ids:
        return {}
    ini = (agora - timedelta(days=CAL_INI_DIAS)).isoformat()
    fim = (agora - timedelta(days=CAL_FIM_DIAS)).isoformat()
    ids = sorted(stage_ids)
    ent = {}
    try:
        for i in range(0, len(ids), 50):
            evs = MX._paginado(lambda: sb.table("deal_stage_events").select("deal_id,stage_id,occurred_at")
                               .in_("stage_id", ids[i:i + 50]).gte("occurred_at", ini).lt("occurred_at", fim)
                               .order("id"), cap=20)
            for e in evs:
                did = str(e.get("deal_id") or "")
                t = MX.parse_dt(e.get("occurred_at"))
                if did and t and (did not in ent or t < ent[did]):
                    ent[did] = t
    except Exception:
        return {}
    if not ent:
        return {}
    deals = {}
    dids = list(ent)
    try:
        for i in range(0, len(dids), 150):
            for d in (sb.table("deals").select("id,win,closed_at,user_id,user_email")
                      .in_("id", dids[i:i + 150]).execute().data or []):
                deals[str(d["id"])] = d
    except Exception:
        return {}
    agg = {}
    for did, t in ent.items():
        d = deals.get(did)
        if not d:
            continue
        tk = owner_team.get(str(d.get("user_id") or "")) or email_team.get((d.get("user_email") or "").lower()) or "sem_equipe"
        for chave in (tk, "_empresa"):
            a = agg.setdefault(chave, {"n": 0, "ganhos": 0, "dias": []})
            a["n"] += 1
            if d.get("win") is True:
                a["ganhos"] += 1
                c = MX.parse_dt(d.get("closed_at"))
                if c and c > t:
                    a["dias"].append((c - t).days)
    out = {}
    for k, a in agg.items():
        dias = sorted(a["dias"])
        med = dias[len(dias) // 2] if dias else None
        out[k] = {"n": a["n"], "ganhos": a["ganhos"],
                  "taxa": (a["ganhos"] / a["n"]) if a["n"] else None, "dias": med}
    return out


def _metas(sb, anos):
    rows = []
    for a in anos:
        try:
            rows += sb.table("metas").select("corretor_id,ano,mes,meta_vgv,meta_vendas").eq("ano", a).execute().data or []
        except Exception:
            pass
    return rows


def _meta_proporcional(rows_uid, ini, fim, corte):
    """Meta do horizonte e meta esperada até hoje, proporcionais aos dias úteis de cada mês."""
    tot = {"vgv": 0.0, "vendas": 0.0, "vgv_ate_hoje": 0.0, "vendas_ate_hoje": 0.0}
    by_m = {(int(r.get("ano") or 0), int(r.get("mes") or 0)): r for r in rows_uid}
    for (y, m) in MX.meses_da_janela(ini, fim):
        r = by_m.get((y, m))
        if not r:
            continue
        p1, pu = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
        du_mes = dias_uteis(p1, pu) or 1
        f_h = dias_uteis(max(ini, p1), min(fim, pu)) / du_mes
        f_t = dias_uteis(max(ini, p1), min(corte, pu)) / du_mes if corte >= max(ini, p1) else 0.0
        mv, mn = float(r.get("meta_vgv") or 0), float(r.get("meta_vendas") or 0)
        tot["vgv"] += mv * f_h
        tot["vendas"] += mn * f_h
        tot["vgv_ate_hoje"] += mv * f_t
        tot["vendas_ate_hoje"] += mn * f_t
    return tot


# ─── cálculo ─────────────────────────────────────────────────────────────────
def calcular(sb, params, hoje=None):
    hoje = hoje or MX.hoje_brt()
    agora = datetime.now(timezone.utc)
    chave, ini, fim = horizonte(params, hoje)
    corte = min(hoje, fim)
    passado = fim < hoje
    futuro = ini > hoje

    # Realizado + equipes/pessoas + ticket de referência: o MESMO retrato do motor único
    if futuro:
        base = MX.resumo(sb, {"since": hoje.isoformat(), "until": hoje.isoformat()}, hoje=hoje)
    else:
        base = MX.resumo(sb, {"since": ini.isoformat(), "until": corte.isoformat()}, hoje=hoje)
    pessoas = base.get("pessoas") or {}
    equipes = base.get("equipes") or {}

    users = _users(sb)
    servico = {(u.get("email") or "").lower() for u in users if u.get("is_service")}
    owner_team = {u["id"]: MX.team_key(u.get("team")) for u in users if not u.get("is_service")}
    email_uid = {(u.get("email") or "").lower(): u["id"] for u in users if u.get("email") and not u.get("is_service")}
    email_team = {e: owner_team.get(uid) for e, uid in email_uid.items()}

    def dono(d):
        uid = str(d.get("user_id") or "")
        if uid in owner_team:
            return uid
        em = (d.get("user_email") or "").lower()
        return None if em in servico else email_uid.get(em)

    # dias
    du_total = dias_uteis(ini, fim)
    du_decorridos = 0 if futuro else dias_uteis(ini, corte)
    du_restantes = 0 if passado else (dias_uteis(ini, fim) if futuro else dias_uteis(hoje + timedelta(days=1), fim))
    dc_restantes = 0 if passado else ((fim - hoje).days)

    # ── ritmo histórico (180 d fechados antes de hoje) ──
    h_ini_d = hoje - timedelta(days=HIST_DIAS)
    h_ini, h_fim = MX.limites_utc(h_ini_d, hoje - timedelta(days=1))
    du_hist = dias_uteis(h_ini_d, hoje - timedelta(days=1)) or 1
    wins = []
    try:
        wins = MX._paginado(lambda: sb.table("deals")
                            .select("id,amount,closed_at,user_id,user_email,amt_total:rd_raw->amount_total,amt_unique:rd_raw->amount_unique")
                            .eq("win", True).gte("closed_at", h_ini.isoformat()).lt("closed_at", h_fim.isoformat())
                            .order("id"), cap=10)
    except Exception:
        wins = []
    hist_n, hist_vgv = {}, {}
    for w in wins:
        uid = dono(w)
        if not uid:
            continue
        hist_n[uid] = hist_n.get(uid, 0) + 1
        v = MX.vgv_de(w)
        if v > 0:
            hist_vgv.setdefault(uid, []).append(v)

    membros_eq = {tk: [m for m in (e.get("membros") or []) if m in pessoas] for tk, e in equipes.items()}
    taxa_eq = {}
    for tk, mem in membros_eq.items():
        n = sum(hist_n.get(m, 0) for m in mem)
        taxa_eq[tk] = (n / du_hist / len(mem)) if mem else 0.0

    # ── funil comprometido (propostas/contratos abertos, mexidos em 60 d) ──
    stage_ids = _stage_ids_funil(sb)
    cal = _calibracao(sb, stage_ids, owner_team, email_team, agora)
    abertos = []
    if stage_ids and not passado:
        mex = (agora - timedelta(days=FUNIL_MEXIDO_DIAS)).isoformat()
        ids = sorted(stage_ids)
        try:
            for i in range(0, len(ids), 50):
                abertos += MX._paginado(lambda: sb.table("deals")
                                        .select("id,amount,user_id,user_email,stage_id,amt_total:rd_raw->amount_total,amt_unique:rd_raw->amount_unique")
                                        .is_("win", "null").in_("stage_id", ids[i:i + 50]).gte("updated_at_rd", mex)
                                        .order("id"), cap=10)
        except Exception:
            abertos = []

    def calib(tk):
        for k in (tk, "_empresa"):
            c = cal.get(k)
            if c and c["n"] >= CAL_MIN_N and c["taxa"] is not None:
                dias = c["dias"] or (cal.get("_empresa") or {}).get("dias") or DIAS_PADRAO
                return {"taxa": c["taxa"], "dias": max(1, dias), "n": c["n"], "fonte": "equipe" if k == tk else "empresa"}
        return {"taxa": TAXA_PADRAO, "dias": DIAS_PADRAO, "n": 0, "fonte": "padrão"}

    funil_p = {}
    for d in abertos:
        uid = dono(d)
        if not uid or uid not in pessoas:
            continue
        f = funil_p.setdefault(uid, {"abertos": 0, "valor": 0.0, "sem_valor": 0})
        f["abertos"] += 1
        v = MX.vgv_de(d)
        if v > 0:
            f["valor"] += v
        else:
            f["sem_valor"] += 1

    # ── por pessoa ──
    metas_rows = _metas(sb, sorted({ini.year, fim.year}))
    metas_uid = {}
    for r in metas_rows:
        metas_uid.setdefault(r.get("corretor_id"), []).append(r)

    def ticket_de(uid, tk):
        vals = hist_vgv.get(uid) or []
        if len(vals) >= 3:
            return sum(vals) / len(vals)
        e = equipes.get(tk) or {}
        return float(e.get("ticket_referencia") or (base.get("empresa") or {}).get("ticket_referencia") or 0) or \
            float(next((x.get("ticket_referencia") for x in equipes.values() if x.get("ticket_referencia")), 0) or 0)

    def bloco(real_n, real_vgv, h_vendas, h_vgv, f_vendas, f_vgv, meta, ticket, extra):
        prov_n = real_n + max(h_vendas, f_vendas)
        prov_vgv = real_vgv + (h_vgv if h_vendas >= f_vendas else f_vgv)
        cons_n = real_n + min(h_vendas, f_vendas)
        cons_vgv = real_vgv + (f_vgv if h_vendas >= f_vendas else h_vgv)
        oti_n = real_n + h_vendas + f_vendas
        oti_vgv = real_vgv + h_vgv + f_vgv
        lo, hi = _poisson_faixa(max(h_vendas, f_vendas))
        meta_vgv = meta["vgv"]
        meta_vendas = meta["vendas"] or ((meta_vgv / ticket) if ticket else 0.0)
        pct = (prov_vgv / meta_vgv * 100) if meta_vgv > 0 else None
        gap = max(0.0, meta_vgv - real_vgv)
        if meta_vgv <= 0:
            status = "sem_meta"
        elif real_vgv >= meta_vgv:
            status = "batida"
        elif pct is not None and pct >= 100:
            status = "no_ritmo"
        elif pct is not None and pct >= 70:
            status = "atras"
        else:
            status = "fora"
        return {
            "meta": {"vgv": round(meta_vgv, 2), "vendas": round(meta_vendas, 1),
                     "vgv_ate_hoje": round(meta["vgv_ate_hoje"], 2),
                     "fonte_vendas": "meta_vendas" if meta["vendas"] else ("vgv ÷ ticket" if meta_vgv else None)},
            "realizado": {"vendas": real_n, "vgv": round(real_vgv, 2),
                          "pct_meta": (round(real_vgv / meta_vgv * 100, 1) if meta_vgv > 0 else None)},
            "historico": {"vendas": round(h_vendas, 2), "vgv": round(h_vgv, 2)},
            "funil": {"vendas": round(f_vendas, 2), "vgv": round(f_vgv, 2)},
            "provavel": {"vendas": round(prov_n, 1), "vgv": round(prov_vgv, 2), "pct_meta": (round(pct, 1) if pct is not None else None)},
            "conservador": {"vendas": round(cons_n, 1), "vgv": round(cons_vgv, 2)},
            "otimista": {"vendas": round(oti_n, 1), "vgv": round(oti_vgv, 2)},
            "faixa_vendas": {"lo": real_n + lo, "hi": real_n + hi},
            "falta_vgv": round(gap, 2),
            "falta_vendas": (round(gap / ticket, 1) if ticket and gap else 0),
            "por_dia_util_vgv": (round(gap / du_restantes, 2) if du_restantes and gap else None),
            "ticket": round(ticket, 2) if ticket else None,
            "status": status,
            **extra,
        }

    out_p = {}
    for uid, b in pessoas.items():
        tk = b.get("team")
        mem = membros_eq.get(tk) or []
        prior = taxa_eq.get(tk, 0.0)
        rate = (hist_n.get(uid, 0) + prior * SHRINK_K) / (du_hist + SHRINK_K)
        ticket = ticket_de(uid, tk)
        h_vendas = rate * du_restantes
        h_vgv = h_vendas * ticket
        cb = calib(tk)
        fp = funil_p.get(uid) or {"abertos": 0, "valor": 0.0, "sem_valor": 0}
        fator = min(1.0, dc_restantes / cb["dias"]) if dc_restantes > 0 else 0.0
        f_vendas = fp["abertos"] * cb["taxa"] * fator
        f_vgv = (fp["valor"] + fp["sem_valor"] * ticket) * cb["taxa"] * fator
        meta = _meta_proporcional(metas_uid.get(uid, []), ini, fim, corte)
        real_n = 0 if futuro else b.get("vendas", 0)
        real_vgv = 0.0 if futuro else float(b.get("vgv") or 0)
        out_p[uid] = bloco(real_n, real_vgv, h_vendas, h_vgv, f_vendas, f_vgv, meta, ticket, {
            "id": uid, "name": b.get("name"), "team": tk, "ativo": b.get("ativo"),
            "gestor": b.get("gestor"), "corretor": b.get("corretor"),
            "base": {"vendas_180d": hist_n.get(uid, 0), "vendas_mes_ritmo": round(rate * 26, 2),
                     "propostas_abertas": fp["abertos"], "propostas_sem_valor": fp["sem_valor"],
                     "taxa_proposta_venda_pct": round(cb["taxa"] * 100, 1), "dias_proposta_venda": cb["dias"],
                     "calibracao": cb["fonte"], "fator_prazo": round(fator, 2)},
        })

    def somar(ids, extra, real_fora=(0, 0.0)):
        z = {"real_n": real_fora[0], "real_vgv": real_fora[1], "h_n": 0.0, "h_vgv": 0.0, "f_n": 0.0, "f_vgv": 0.0,
             "meta": {"vgv": 0.0, "vendas": 0.0, "vgv_ate_hoje": 0.0, "vendas_ate_hoje": 0.0},
             "v180": 0, "prop": 0, "prop_sv": 0}
        for uid in ids:
            p = out_p[uid]
            z["real_n"] += p["realizado"]["vendas"]
            z["real_vgv"] += p["realizado"]["vgv"]
            z["h_n"] += p["historico"]["vendas"]
            z["h_vgv"] += p["historico"]["vgv"]
            z["f_n"] += p["funil"]["vendas"]
            z["f_vgv"] += p["funil"]["vgv"]
            mp = _meta_proporcional(metas_uid.get(uid, []), ini, fim, corte)
            for k in z["meta"]:
                z["meta"][k] += mp[k]
            z["v180"] += p["base"]["vendas_180d"]
            z["prop"] += p["base"]["propostas_abertas"]
            z["prop_sv"] += p["base"]["propostas_sem_valor"]
        ticket = (z["h_vgv"] / z["h_n"]) if z["h_n"] > 0 else next((out_p[i]["ticket"] for i in ids if out_p[i]["ticket"]), 0) or 0
        return bloco(z["real_n"], z["real_vgv"], z["h_n"], z["h_vgv"], z["f_n"], z["f_vgv"], z["meta"], ticket,
                     {**extra, "base": {"vendas_180d": z["v180"], "vendas_mes_ritmo": round(z["h_n"] / du_restantes * 26, 2) if du_restantes else None,
                                        "propostas_abertas": z["prop"], "propostas_sem_valor": z["prop_sv"]}})

    out_e = {}
    for tk, mem in membros_eq.items():
        ids = [m for m in mem if m in out_p]
        if not ids:
            continue
        cb = calib(tk)
        out_e[tk] = somar(ids, {"team": tk, "membros": ids,
                                "calibracao": {"taxa_pct": round(cb["taxa"] * 100, 1), "dias": cb["dias"], "amostra": cb["n"], "fonte": cb["fonte"]}})
    todos = [uid for uid, p in out_p.items() if p.get("ativo")]
    # v88.2 (Dicionário §1): o realizado da EMPRESA soma toda venda ganha — inclusive de quem saiu e sem corretor
    # (mesmo total do motor único). Ritmo, funil e meta seguem só as pessoas ativas (§4).
    fora_n, fora_vgv = 0, 0.0
    if not futuro:
        be = base.get("empresa") or {}
        for bloco_fora in (be.get("sem_corretor") or {}, be.get("inativos") or {}):
            fora_n += int(bloco_fora.get("vendas") or 0)
            fora_vgv += float(bloco_fora.get("vgv") or 0)
    empresa = somar(todos, {"team": "_empresa", "realizado_fora_das_equipes": {"vendas": fora_n, "vgv": round(fora_vgv, 2)}},
                    (fora_n, fora_vgv)) if todos else None

    return {
        "ok": True,
        "horizonte": {"chave": chave, "label": HZ_LABEL.get(chave, chave), "ini": ini.isoformat(), "fim": fim.isoformat(),
                      "hoje": hoje.isoformat(), "passado": passado, "futuro": futuro,
                      "dias_uteis": {"total": du_total, "decorridos": du_decorridos, "restantes": du_restantes},
                      "dias_corridos_restantes": dc_restantes},
        "modelo": {"historico_dias": HIST_DIAS, "suavizacao_dias": SHRINK_K, "funil_mexido_dias": FUNIL_MEXIDO_DIAS,
                   "calibracao": {k: {"taxa_pct": round((v["taxa"] or 0) * 100, 1), "dias": v["dias"], "amostra": v["n"]} for k, v in cal.items()}},
        "pessoas": out_p, "equipes": out_e, "empresa": empresa,
        "avisos": base.get("avisos") or [],
        "dados_de": base.get("dados_de"), "dados_de_hhmm": base.get("dados_de_hhmm"), "versao": base.get("versao"),
    }


def projecao(sb, params=None, fresh=False, hoje=None):
    """Com cache em shared_kv versionado pelo sync do RD (mesmo princípio do resumo)."""
    hoje = hoje or MX.hoje_brt()
    chave, ini, fim = horizonte(params, hoje)
    versao = MX.versao_deals(sb)
    key = f"{CACHE_BASE}:{chave}:{ini.isoformat()}:{fim.isoformat()}:{hoje.isoformat()}"
    if not fresh:
        c = MX._kv_read(sb, key)
        if isinstance(c, dict) and c.get("data") and c.get("versao") == versao:
            ts = MX.parse_dt(c.get("_cached_at"))
            if ts and (datetime.now(timezone.utc) - ts).total_seconds() < MX.CACHE_TTL:
                out = dict(c["data"])
                out["cached"] = True
                return out
    data = calcular(sb, params, hoje)
    MX._kv_write(sb, key, {"_cached_at": datetime.now(timezone.utc).isoformat(), "versao": versao, "data": data})
    data["cached"] = False
    return data


def filtrar(data, user):
    """Alçada igual ao resumo: sócio tudo; gestor/lvl≥5 a própria equipe; corretor só a si."""
    lvl = (user or {}).get("lvl") or 0
    if lvl >= 10:
        return data
    out = dict(data)
    tk = MX.team_key((user or {}).get("team"))
    if lvl >= 5 or MX.is_gestor((user or {}).get("role")):
        out["pessoas"] = {k: v for k, v in data["pessoas"].items() if v.get("team") == tk}
        out["equipes"] = {k: v for k, v in data["equipes"].items() if k == tk}
    else:
        uid = (user or {}).get("id")
        out["pessoas"] = {k: v for k, v in data["pessoas"].items() if k == uid}
        out["equipes"] = {}
    out["empresa"] = None
    return out
