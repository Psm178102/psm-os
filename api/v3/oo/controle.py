"""
🧭 CONTROLE COMERCIAL — FUNIL CONQUISTA (v89.0, pedido do Paulo 29/set)

Aba "🧭 Controle" da Gestão Comercial. Responde, com o espelho do RD, as 5
perguntas que o painel não deixava claras:
  1. 1º atendimento — quanto o lead espera (equipe e corretor, horas corridas e úteis)
  2. Cadência de tentativa de contato — leads sem tarefa / atrasados / parados e
     descartes sem contato (sem tentativas registradas, "curioso" sem qualificar)
  3. Follow-up — todo card aberto tem próxima tarefa? está dentro do prazo da etapa?
  4. Pastas (📂 APROVAÇÃO/PROPOSTA) — quantas entraram, desfecho, dias até o
     desfecho, paradas e o RESULTADO DO CRÉDITO (só aparece quando o RD tiver os
     campos: hoje o RD NÃO registra envio/retorno/resultado — a aba avisa)
  5. Pós-visita — o que aconteceu depois da visita realizada, e quanto foi para
     concorrente × motivo genérico

Regras do Paulo (28/set): só FUNIL CONQUISTA (inclui "(fechados 3d)"); FUNIL DE
PARCERIA não entra; leads de vaga para corretor saem (campanha com "VAGA" ou
motivo "Corretor / emprego"); o dono é o dono atual do card no RD.

Fontes: deals (espelho RD), deal_stage_events (eventos reais, source<>'backfill')
e rd_stage_hist (histórico antigo, parou em 06/09/2026 — só completa janelas antigas).
GATE: lvl>=5. Cache compartilhado 10 min por janela (banco é frágil — memória
house-psm-db-fragil: nada de varredura; só colunas/caminhos JSON necessários).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _oo_lib import parse_dt  # type: ignore
from simulador import _kv_read, _kv_write  # type: ignore
_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _V3 not in sys.path:
    sys.path.append(_V3)
from _metricas_lib import emails_fora  # type: ignore   # v88.95: dono fora das métricas

CACHE_VER = "controle_v2"
BRT = timezone(timedelta(hours=-3))

# Etapas do FUNIL CONQUISTA atual (desde mai/2026) — ids do RD
ST = {
    "reativ": "69f506fcc2da3b00135d05a9", "novo": "69f506fcc2da3b00135d05aa",
    "tdc": "69f506fcc2da3b00135d05ab", "qualif": "69f507bdbda71600175e9c15",
    "oport_mes": "69f507dc4b9c12001e0e8de1", "oport_fut": "69f507eaae7842001a121979",
    "vis_ag": "69f5080e621de20017ccbfe5", "vis_real": "69f50826f21d4b001892587d",
    "aprov": "69f50841d704820013d9c59d", "venda": "69f50851593120001308a272",
    "carteira": "69f506fcc2da3b00135d05a7", "pasta_lanc": "69f506fcc2da3b00135d05a8",
}
NOME_ST = {
    ST["reativ"]: "🔂 Reativação", ST["novo"]: "📣 Novo atendimento", ST["tdc"]: "📞 Tentativa de contato",
    ST["qualif"]: "📲 Contato + qualificação", ST["oport_mes"]: "🔥 Oportunidade do mês",
    ST["oport_fut"]: "🛠️ Oportunidade futura", ST["vis_ag"]: "📅 Visita agendada",
    ST["vis_real"]: "✅ Visita realizada", ST["aprov"]: "📂 Aprovação/Proposta (pasta)",
    ST["venda"]: "🎯 Venda", ST["carteira"]: "💼 Carteira", ST["pasta_lanc"]: "🚀 Pasta lançamento",
}
# Prazo máximo SEM ATIVIDADE por etapa (dias) — régua proposta 29/set; o card
# que passa disso está com o follow-up estourado.
SLA_FOLLOW = [
    ("qualif", 2), ("oport_mes", 7), ("oport_fut", 30),
    ("vis_ag", None), ("vis_real", 1), ("aprov", 3),
]
CADENCIA_MIN = 6          # tentativas exigidas antes de perder por "não atendeu"
TDC_PARADO_DIAS = 5       # mesma régua da penalidade do HUB ("TENT. CONTATO >5d")
ORIGENS_INBOUND = ("trafego pago psm", "marketplace")
GENERICOS = ("lead sem interesse / curioso", "outros (justificar)", "lead sumiu (+3 meses)", "lead sem perfil")


def _norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _low(s):
    return _norm(s).lower()


def _cf(cfs, pat):
    """valor do campo personalizado do RD cujo rótulo casa com o regex."""
    for f in cfs or []:
        lab = ((f or {}).get("custom_field") or {}).get("label") or ""
        if re.search(pat, lab, re.I):
            v = f.get("value")
            return v if v not in (None, "", "[]") else None
    return None


def _tem_cf(cfs, pat):
    return any(re.search(pat, (((f or {}).get("custom_field") or {}).get("label") or ""), re.I) for f in cfs or [])


def _eh_vaga(camp, motivo):
    return "VAGA" in str(camp or "").upper() or _low(motivo) == "corretor / emprego"


def _horas_uteis(a, b):
    """horas úteis entre a e b (seg–sex 8h–19h, sáb 8h–13h, BRT)."""
    if not a or not b or b <= a:
        return 0.0
    a, b = a.astimezone(BRT), b.astimezone(BRT)
    tot, d = 0.0, a.date()
    while d <= b.date():
        wd = d.weekday()
        if wd < 6:
            ini = datetime(d.year, d.month, d.day, 8, tzinfo=BRT)
            fim = datetime(d.year, d.month, d.day, 19 if wd < 5 else 13, tzinfo=BRT)
            lo, hi = max(ini, a), min(fim, b)
            if hi > lo:
                tot += (hi - lo).total_seconds() / 3600.0
        d += timedelta(days=1)
    return tot


def _med(v):
    v = sorted(x for x in v if x is not None)
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0


def _pct(a, b):
    return round(a / b * 100, 1) if b else None


def _pagina(q, limite=20):
    """executa a query paginada (PostgREST corta em 1000)."""
    out, p = [], 0
    while p < limite:
        part = q.range(p * 1000, p * 1000 + 999).execute().data or []
        out.extend(part)
        if len(part) < 1000:
            break
        p += 1
    return out


COLS = ("id,stage_id,stage_name,win,closed_at,created_at_rd,pipeline_name,user_email,"
        "dono:rd_raw->user->>name,camp:rd_raw->campaign->>name,src:rd_raw->deal_source->>name,"
        "motivo:rd_raw->deal_lost_reason->>name,nt:rd_raw->next_task,la:rd_raw->>last_activity_at,"
        "cfs:rd_raw->deal_custom_fields")


def _base_q(sb):
    return sb.table("deals").select(COLS).like("pipeline_name", "FUNIL CONQUISTA%")


def _eventos(sb, deal_ids, desde=None, stage_ids=None):
    """[(deal_id, stage_id, pos, dt)] de deal_stage_events (+ rd_stage_hist antigo)."""
    out = []
    ids = [str(x) for x in deal_ids if x]
    for i in range(0, len(ids), 150):
        ch = ids[i:i + 150]
        q = (sb.table("deal_stage_events").select("deal_id,stage_id,stage_position,occurred_at")
             .in_("deal_id", ch).neq("source", "backfill").order("id"))
        if desde:
            q = q.gte("occurred_at", desde)
        if stage_ids:
            q = q.in_("stage_id", stage_ids)
        for r in _pagina(q):
            out.append((str(r["deal_id"]), r.get("stage_id"), r.get("stage_position"), parse_dt(r.get("occurred_at"))))
        try:
            q2 = (sb.table("rd_stage_hist").select("deal_id,etapa_para,mudou_em")
                  .in_("deal_id", ch).eq("funil", "FUNIL CONQUISTA").order("id"))
            if desde:
                q2 = q2.gte("mudou_em", desde)
            if stage_ids:
                q2 = q2.in_("etapa_para", stage_ids)
            for r in _pagina(q2, 5):
                out.append((str(r["deal_id"]), r.get("etapa_para"), None, parse_dt(r.get("mudou_em"))))
        except Exception:
            pass
    return [e for e in out if e[3]]


def compute(sb, since_d, until_d):
    agora = datetime.now(timezone.utc)
    t0 = datetime(since_d.year, since_d.month, since_d.day, tzinfo=BRT)
    t1 = datetime(until_d.year, until_d.month, until_d.day, tzinfo=BRT) + timedelta(days=1)
    t0s, t1s = t0.isoformat(), t1.isoformat()
    donos_vistos = set()
    fora = emails_fora(sb)

    def excl(d):
        """vaga de corretor (Paulo 28/09) ou dono em 'emails_fora_metricas' (v88.95)."""
        return _eh_vaga(d.get("camp"), d.get("motivo")) or (d.get("user_email") or "").strip().lower() in fora

    def dono(d):
        n = _norm(d.get("dono")) or "— sem dono"
        donos_vistos.add(n)
        return n

    # ── 1. coorte criada na janela → 1º atendimento ─────────────────────────
    coorte = [d for d in _pagina(_base_q(sb).gte("created_at_rd", t0s).lt("created_at_rd", t1s))
              if not excl(d)]
    inbound = []
    for d in coorte:
        orig = _low(_cf(d.get("cfs"), r"^origem do cliente"))
        if (orig.startswith(ORIGENS_INBOUND)) or (not orig and "facebook ads" in _low(d.get("src"))):
            inbound.append(d)
    ev_c = _eventos(sb, [d["id"] for d in inbound], desde=(t0 - timedelta(days=1)).isoformat())
    primeiro = {}
    for did, sid, pos, dt in ev_c:
        if pos is not None and pos >= 2 and sid != ST["reativ"]:
            if did not in primeiro or dt < primeiro[did]:
                primeiro[did] = dt
    at_eq, at_p = [], defaultdict(list)
    faixa = {"comercial": [], "noite": [], "fds": []}
    sem_mov = 0
    for d in inbound:
        c = parse_dt(d.get("created_at_rd"))
        f = primeiro.get(str(d["id"]))
        if not c:
            continue
        if not f:
            if d.get("win") is None and d.get("stage_id") == ST["novo"]:
                sem_mov += 1
            continue
        if (f - c).total_seconds() < 120:      # card já nasceu fora do Novo atendimento
            continue
        h, hu = (f - c).total_seconds() / 3600.0, _horas_uteis(c, f)
        row = (h, hu)
        at_eq.append(row)
        at_p[dono(d)].append(row)
        cb = c.astimezone(BRT)
        k = "fds" if cb.weekday() >= 5 else ("comercial" if 8 <= cb.hour < 18 else "noite")
        faixa[k].append(row)

    def resumo_at(rows):
        n = len(rows)
        return {"n": n, "med_h": _med([r[0] for r in rows]), "med_util_h": _med([r[1] for r in rows]),
                "pct_1h_util": _pct(sum(1 for r in rows if r[1] <= 1), n),
                "pct_24h": _pct(sum(1 for r in rows if r[0] > 24), n)}

    abertos_novo = [d for d in _pagina(_base_q(sb).is_("win", "null").eq("stage_id", ST["novo"]))
                    if not excl(d)]
    atendimento = {
        "equipe": resumo_at(at_eq),
        "por_corretor": sorted([{"nome": k, **resumo_at(v)} for k, v in at_p.items()], key=lambda x: -(x["med_h"] or 0)),
        "por_horario": [{"faixa": lbl, **resumo_at(faixa[k])} for k, lbl in
                        (("comercial", "Dia útil, 8h–18h"), ("noite", "Noite/madrugada"), ("fds", "Fim de semana"))],
        "novo_agora": len(abertos_novo),
        "novo_agora_mais_1h": sum(1 for d in abertos_novo if parse_dt(d.get("created_at_rd")) and
                                  (agora - parse_dt(d["created_at_rd"])).total_seconds() > 3600),
        "novo_por_dono": sorted([[k, v] for k, v in _cont(abertos_novo, dono).items()], key=lambda x: -x[1]),
        "leads_coorte": len(coorte), "leads_inbound": len(inbound), "sem_movimento": sem_mov,
    }

    # ── 2. cadência de tentativa de contato ─────────────────────────────────
    tdc_abertos = [d for d in _pagina(_base_q(sb).is_("win", "null").eq("stage_id", ST["tdc"]))
                   if not excl(d)]
    # v89.0.1: perda na Reativação é limpeza de base, não descarte de atendimento
    perdidos = [d for d in _pagina(_base_q(sb).eq("win", False).gte("closed_at", t0s).lt("closed_at", t1s)
                                   .neq("stage_id", ST["reativ"]))
                if not excl(d)]
    cad_p = defaultdict(lambda: defaultdict(int))

    def sem_tarefa(d):
        nt = d.get("nt")
        return not nt or not isinstance(nt, dict) or not nt.get("date")

    def atrasada(d):
        nt = d.get("nt") if isinstance(d.get("nt"), dict) else None
        dt = parse_dt((nt or {}).get("date"))
        return bool(dt and dt < agora)

    # v89.0.1: "parado" conta desde a ENTRADA em Tentativa de contato (evento real);
    # sem evento, cai na data de criação do lead
    ent_tdc = {}
    for did, sid, pos, dt in _eventos(sb, [d["id"] for d in tdc_abertos], stage_ids=[ST["tdc"]]):
        if did not in ent_tdc or dt > ent_tdc[did]:
            ent_tdc[did] = dt
    for d in tdc_abertos:
        p = cad_p[dono(d)]
        p["tdc_abertos"] += 1
        if sem_tarefa(d):
            p["sem_tarefa"] += 1
        elif atrasada(d):
            p["atrasada"] += 1
        c = ent_tdc.get(str(d["id"])) or parse_dt(d.get("created_at_rd"))
        if c and (agora - c).days > TDC_PARADO_DIAS:
            p["parado_5d"] += 1
    for d in perdidos:
        p = cad_p[dono(d)]
        p["perdidos"] += 1
        if d.get("stage_id") in (ST["novo"], ST["tdc"]):
            p["sem_contato"] += 1
            try:
                tent = int(str(_cf(d.get("cfs"), r"^n.? ?tentativa de contato$") or "0").strip() or 0)
            except ValueError:
                tent = 0
            if tent < CADENCIA_MIN:
                p["irregular"] += 1
            if tent == 0:
                p["sem_registro"] += 1
            m = _low(d.get("motivo"))
            if m == "lead sem interesse / curioso":
                p["curioso_sem_qualif"] += 1
            if m == "outros (justificar)":
                p["outros"] += 1
            if m.startswith("não atendeu") and tent < CADENCIA_MIN:
                p["nao_atendeu_sem_6"] += 1
    CAMPOS_CAD = ("tdc_abertos", "sem_tarefa", "atrasada", "parado_5d", "perdidos", "sem_contato",
                  "sem_registro", "irregular", "curioso_sem_qualif", "outros", "nao_atendeu_sem_6")
    cad_rows = [{"nome": k, **{c: v.get(c, 0) for c in CAMPOS_CAD}} for k, v in cad_p.items()]
    cad_tot = {c: sum(r[c] for r in cad_rows) for c in CAMPOS_CAD}
    cadencia = {"equipe": cad_tot, "por_corretor": sorted(cad_rows, key=lambda r: -(r["irregular"] + r["sem_tarefa"])),
                "regra": {"tentativas": CADENCIA_MIN, "parado_dias": TDC_PARADO_DIAS}}

    # ── 3. follow-up (snapshot de agora) ────────────────────────────────────
    fu_ids = [ST[k] for k, _ in SLA_FOLLOW]
    fu_abertos = [d for d in _pagina(_base_q(sb).is_("win", "null").in_("stage_id", fu_ids))
                  if not excl(d)]
    sla_de = {ST[k]: v for k, v in SLA_FOLLOW if v is not None}
    fu_et = defaultdict(lambda: defaultdict(int))
    fu_p = defaultdict(lambda: defaultdict(int))
    for d in fu_abertos:
        sid = d.get("stage_id")
        e, p = fu_et[sid], fu_p[dono(d)]
        for x in (e, p):
            x["abertos"] += 1
        la = parse_dt(d.get("la")) or parse_dt(d.get("created_at_rd"))
        if sid == ST["vis_ag"]:
            # v89.0.1: visita marcada pra semana que vem não está "estourada" — o
            # controle aqui é a tarefa (data da visita) não ter passado sem baixa
            est = False
        else:
            est = bool(la and (agora - la).total_seconds() / 86400.0 > sla_de.get(sid, 999))
        st_ = sem_tarefa(d)
        at_ = (not st_) and atrasada(d)
        for x in (e, p):
            if st_:
                x["sem_tarefa"] += 1
            if at_:
                x["atrasada"] += 1
            if est:
                x["estourado"] += 1
            if not st_ and not at_ and not est:
                x["em_dia"] += 1
    CAMPOS_FU = ("abertos", "sem_tarefa", "atrasada", "estourado", "em_dia")
    followup = {
        "por_etapa": [{"etapa": NOME_ST.get(ST[k]), "sla_dias": v, **{c: fu_et[ST[k]].get(c, 0) for c in CAMPOS_FU}}
                      for k, v in SLA_FOLLOW],
        "por_corretor": sorted([{"nome": k, **{c: v.get(c, 0) for c in CAMPOS_FU}} for k, v in fu_p.items()],
                               key=lambda r: -(r["sem_tarefa"] + r["atrasada"] + r["estourado"])),
    }
    followup["equipe"] = {c: sum(r[c] for r in followup["por_etapa"]) for c in CAMPOS_FU}
    try:
        followup["reativacao_abertos"] = (sb.table("deals").select("id", count="exact").like("pipeline_name", "FUNIL CONQUISTA%")
                                          .is_("win", "null").eq("stage_id", ST["reativ"]).limit(1).execute().count)
    except Exception:
        followup["reativacao_abertos"] = None

    # ── 4. pastas (📂 APROVAÇÃO/PROPOSTA) ──────────────────────────────────
    desde_hist = (t0 - timedelta(days=180)).isoformat()
    ent_ev = []
    q = (sb.table("deal_stage_events").select("deal_id,occurred_at").eq("stage_id", ST["aprov"])
         .neq("source", "backfill").gte("occurred_at", desde_hist).lt("occurred_at", t1s).order("id"))
    ent_ev += [(str(r["deal_id"]), parse_dt(r["occurred_at"])) for r in _pagina(q)]
    try:
        q = (sb.table("rd_stage_hist").select("deal_id,mudou_em").eq("etapa_para", ST["aprov"])
             .gte("mudou_em", desde_hist).lt("mudou_em", t1s).order("id"))
        ent_ev += [(str(r["deal_id"]), parse_dt(r["mudou_em"])) for r in _pagina(q, 5)]
    except Exception:
        pass
    entrada = {}
    for did, dt in ent_ev:
        if dt and (did not in entrada or dt < entrada[did]):
            entrada[did] = dt
    abertos_aprov = [d for d in _pagina(_base_q(sb).is_("win", "null").eq("stage_id", ST["aprov"]))
                     if not excl(d)]
    ids_janela = [k for k, v in entrada.items() if t0 <= v < t1]
    deals_p = {}
    for i in range(0, len(ids_janela), 150):
        for d in _base_q(sb).in_("id", ids_janela[i:i + 150]).execute().data or []:
            if not excl(d):
                deals_p[str(d["id"])] = d
    for d in abertos_aprov:
        deals_p.setdefault(str(d["id"]), d)
    ev_p = defaultdict(list)
    for did, sid, pos, dt in _eventos(sb, list(deals_p.keys()), desde=desde_hist):
        ev_p[did].append((dt, sid))
    CRED_PAT = r"resultado.*cr[eé]dito|status.*cr[eé]dito|cr[eé]dito.*(aprovad|resultado)"
    ENVIO_PAT = r"envio.*pasta|pasta.*enviad|data.*envio"
    RET_PAT = r"retorno.*(pasta|banco|cr[eé]dito)|data.*retorno"
    campos_ok = any(_tem_cf(d.get("cfs"), CRED_PAT) for d in deals_p.values())
    pst = defaultdict(int)
    pst_p = defaultdict(lambda: defaultdict(int))
    d_venda, d_perda, d_ret, paradas = [], [], [], []
    cred = defaultdict(int)
    for did, d in deals_p.items():
        ent = entrada.get(did)
        na_janela = bool(ent and t0 <= ent < t1)
        evs = sorted(e for e in ev_p.get(did, []) if ent and e[0] >= ent)
        venda_em = next((dt for dt, sid in evs if sid == ST["venda"]), None)
        saiu = next((sid for dt, sid in evs if dt > ent and sid != ST["aprov"]), None) if ent else None
        if d.get("win") is None and d.get("stage_id") == ST["aprov"]:
            dias = (agora - ent).days if ent else None
            paradas.append({"nome": _norm(d.get("dono")), "dias": dias, "id": did})
        if not na_janela:
            continue
        p = pst_p[dono(d)]
        pst["entraram"] += 1
        p["entraram"] += 1
        if venda_em or d.get("win") is True:
            res = "venda"
            if venda_em:
                d_venda.append((venda_em - ent).total_seconds() / 86400.0)
        elif d.get("win") is False:
            res = "perdida"
            fc = parse_dt(d.get("closed_at"))
            if fc:
                d_perda.append((fc - ent).total_seconds() / 86400.0)
        elif d.get("stage_id") == ST["aprov"]:
            res = "na_etapa"
        else:
            res = "saiu_sem_desfecho"
        pst[res] += 1
        p[res] += 1
        r = _low(_cf(d.get("cfs"), CRED_PAT))
        if not r:
            cred["sem_registro"] += 1
        elif "reprov" in r:
            cred["reprovado"] += 1
        elif "condic" in r:
            cred["condicionado"] += 1
        elif "aprov" in r:
            cred["aprovado"] += 1
        elif "pend" in r:
            cred["pendencia"] += 1
        else:
            cred["outro"] += 1
        de, dr = _cf(d.get("cfs"), ENVIO_PAT), _cf(d.get("cfs"), RET_PAT)
        try:
            if de and dr:
                f = lambda s: datetime.strptime(str(s)[:10], "%d/%m/%Y") if "/" in str(s) else datetime.fromisoformat(str(s)[:10])
                d_ret.append((f(dr) - f(de)).days)
        except Exception:
            pass
    pastas = {
        "entraram": pst.get("entraram", 0),
        "desfecho": {k: pst.get(k, 0) for k in ("venda", "perdida", "saiu_sem_desfecho", "na_etapa")},
        "dias_ate_venda_med": _med(d_venda), "dias_ate_perda_med": _med(d_perda),
        "dias_retorno_med": _med(d_ret), "com_retorno_registrado": len(d_ret),
        "credito": dict(cred), "campos_credito_no_rd": campos_ok,
        "em_aprovacao_agora": len(abertos_aprov),
        "paradas": sorted(paradas, key=lambda x: -(x["dias"] if x["dias"] is not None else 9999))[:25],
        "por_corretor": sorted([{"nome": k, **{c: v.get(c, 0) for c in ("entraram", "venda", "perdida", "saiu_sem_desfecho", "na_etapa")}}
                                for k, v in pst_p.items()], key=lambda r: -r["entraram"]),
    }

    # ── 5. pós-visita ──────────────────────────────────────────────────────
    vis_ev = []
    q = (sb.table("deal_stage_events").select("deal_id,occurred_at").eq("stage_id", ST["vis_real"])
         .neq("source", "backfill").gte("occurred_at", t0s).lt("occurred_at", t1s).order("id"))
    vis_ev += [str(r["deal_id"]) for r in _pagina(q)]
    try:
        q = (sb.table("rd_stage_hist").select("deal_id").eq("etapa_para", ST["vis_real"])
             .gte("mudou_em", t0s).lt("mudou_em", t1s).order("id"))
        vis_ev += [str(r["deal_id"]) for r in _pagina(q, 5)]
    except Exception:
        pass
    vis_ids = sorted(set(vis_ev))
    pv = defaultdict(int)
    pv_p = defaultdict(lambda: defaultdict(int))
    motivos_pv = defaultdict(int)
    for i in range(0, len(vis_ids), 150):
        for d in _base_q(sb).in_("id", vis_ids[i:i + 150]).execute().data or []:
            if excl(d):
                continue
            p = pv_p[dono(d)]
            for x in (pv, p):
                x["visitas"] += 1
            if d.get("win") is True:
                k = "venda"
            elif d.get("win") is False:
                k = "perdida"
                m = _low(d.get("motivo"))
                motivos_pv[_norm(d.get("motivo")) or "Sem motivo"] += 1
                if "outra empresa" in m or "concorr" in m:
                    for x in (pv, p):
                        x["concorrente"] += 1
                elif m in GENERICOS:
                    for x in (pv, p):
                        x["generico"] += 1
            else:
                k = "aberta"
            for x in (pv, p):
                x[k] += 1
    CAMPOS_PV = ("visitas", "venda", "perdida", "aberta", "concorrente", "generico")
    pos_visita = {
        "equipe": {c: pv.get(c, 0) for c in CAMPOS_PV},
        "motivos": sorted([[k, v] for k, v in motivos_pv.items()], key=lambda x: -x[1]),
        "por_corretor": sorted([{"nome": k, **{c: v.get(c, 0) for c in CAMPOS_PV}} for k, v in pv_p.items()],
                               key=lambda r: -r["visitas"]),
    }

    return {
        "janela": {"since": since_d.isoformat(), "until": until_d.isoformat()},
        "escopo": "FUNIL CONQUISTA · sem Funil Parceria · sem leads de vaga · dono atual do card no RD",
        "atendimento": atendimento, "cadencia": cadencia, "followup": followup,
        "pastas": pastas, "pos_visita": pos_visita,
        "calculado_em": agora.isoformat(),
    }


def _cont(rows, fn):
    c = defaultdict(int)
    for r in rows:
        c[fn(r)] += 1
    return c


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        hoje = datetime.now(BRT).date()
        try:
            until_d = date.fromisoformat(q["until"]) if q.get("until") else hoje
            since_d = date.fromisoformat(q["since"]) if q.get("since") else until_d.replace(day=1)
        except Exception:
            return self._send(400, {"ok": False, "error": "since/until inválidos (YYYY-MM-DD)"})
        if (until_d - since_d).days > 190:
            return self._send(400, {"ok": False, "error": "janela máxima de 6 meses"})
        ck = f"{CACHE_VER}:{since_d}:{until_d}"
        cached, _ok = _kv_read(sb, ck)
        if cached and cached.get("ts") and q.get("fresh") != "1":
            try:
                if (datetime.now(timezone.utc) - parse_dt(cached["ts"])).total_seconds() < 600:
                    return self._send(200, {"ok": True, "cached": True, **cached.get("data", {})})
            except Exception:
                pass
        try:
            data = compute(sb, since_d, until_d)
        except Exception as e:
            import traceback as _tb
            det = _tb.format_exc()
            print("[controle] ERRO %s\n%s" % (e, det))
            corpo = {"ok": False, "error": "falha ao calcular o Controle: %s" % e}
            if (user.get("lvl") or 0) >= 10:
                corpo["traceback"] = det.strip().splitlines()[-8:]
            return self._send(500, corpo)
        _kv_write(sb, ck, {"ts": datetime.now(timezone.utc).isoformat(), "data": data}, user.get("id"))
        return self._send(200, {"ok": True, "cached": False, **data})
