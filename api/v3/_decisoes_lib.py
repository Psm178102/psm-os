"""
_decisoes_lib.py — MOTOR DE DECISÕES do House PSM. v87.92

Pedido do Paulo (16/09/2026): "temos percepção, lógica e consciência de muitos dados, porém a função real,
prática, a que gera tomada de decisões claras, no tempo certo, não está funcionando. Precisamos que seja
FUNCIONAL, REAL, e não um monte de dados cruzados."

Cada decisão responde, numa linha só: O QUE FAZER · QUEM FAZ · ATÉ QUANDO · POR QUÊ (com o número que prova)
e fecha o ciclo: vira tarefa na Agenda do dono (1 clique), acompanha se a tarefa está em dia, atrasada ou se
foi concluída e o problema PERSISTIU (volta como crítica). Nenhuma decisão é "dado cruzado": se não há ação
clara, não é decisão.

Regras (todas lêem o motor único e a projeção — mesmos números das telas):
  meta_risco          equipe/empresa com projeção provável < 100% da meta do mês → plano de recuperação (gestor, 2 dias úteis)
  funil_curto         propostas abertas × taxa real não cobrem as vendas que faltam → gerar N propostas na semana (gestor)
  proposta_parada     proposta/contrato sem atividade há 7+ dias → destravar hoje (corretor)
  lead_sem_contato    lead criado há 24h+ (até 14 d) sem nenhuma interação → 1º contato hoje (corretor; 10+ escala ao gestor)
  sem_venda           corretor sem venda há mais que o dobro do seu intervalo normal (mín. 45 d) → 1:1 de desempenho (gestor)
  oo_atrasado         corretor fora do ritmo e sem 1:1 há 30+ dias → agendar 1:1 (gestor)
  meta_ausente        pessoa ativa sem meta no mês (ou no próximo, a partir do dia 25) → cadastrar (gestor/sócio)
  rd_hub              venda no PSM HUB sem ganho no RD (ou vice-versa) → corrigir no RD (corretor)
  sem_valor           propostas abertas sem valor no RD → preencher valor (corretor)
"""
import json
import math
import re
from datetime import date, datetime, timedelta, timezone

import _metricas_lib as MX
import _projecao_lib as PJ

CACHE_KEY = "decisoes:v1"
CACHE_TTL = 300
KV_DISPENSAS = "decisoes_dispensas"
CATEGORIA_TAREFA = "Decisão"
TAG_RE = re.compile(r"\[dec:([^\]]+)\]")

PROPOSTA_PARADA_DIAS = 7
LEAD_JANELA_DIAS = 14
SEM_VENDA_MIN_DIAS = 45
OO_MAX_DIAS = 30
DISPENSA_DIAS = 7

TIPO_LABEL = {
    "meta_risco": "Meta em risco", "funil_curto": "Funil insuficiente", "proposta_parada": "Proposta parada",
    "lead_sem_contato": "Lead sem 1º contato", "sem_venda": "Sem venda", "oo_atrasado": "1:1 atrasado",
    "meta_ausente": "Meta não cadastrada", "rd_hub": "Venda divergente RD × HUB", "sem_valor": "Negócio sem valor",
}
# em quais telas cada tipo aparece (o front filtra por ?tela=)
TELAS = {
    "meta_risco": ("gestao", "kpis", "sala", "metas", "oo"),
    "funil_curto": ("gestao", "kpis", "sala", "metas", "cerebro"),
    "proposta_parada": ("gestao", "cerebro", "oo", "produtividade", "sala"),
    "lead_sem_contato": ("gestao", "cerebro", "oo", "produtividade", "sala"),
    "sem_venda": ("gestao", "oo", "produtividade", "metas"),
    "oo_atrasado": ("gestao", "oo", "produtividade"),
    "meta_ausente": ("metas", "gestao", "kpis", "sala"),
    "rd_hub": ("gestao", "cerebro", "sala", "kpis"),
    "sem_valor": ("gestao", "cerebro", "oo"),
}
TEAM_NOME = {"conquista": "Conquista", "map": "MAP", "terceiros": "Terceiros", "locacao": "Locação"}


def _brl(v):
    v = float(v or 0)
    if abs(v) >= 1e6:
        return "R$ " + f"{v / 1e6:.2f}".replace(".", ",") + " mi"
    if abs(v) >= 1e3:
        return "R$ " + f"{v / 1e3:.0f}" + " mil"
    return "R$ " + f"{v:.0f}"


def _n(v):
    s = f"{v:.1f}".replace(".", ",")
    return s[:-2] if s.endswith(",0") else s


def _dia_util_mais(d, n):
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 6:
            n -= 1
    return d


def _fmt_d(d):
    return d.strftime("%d/%m")


# ─── cargas ──────────────────────────────────────────────────────────────────
def _carregar(sb, hoje):
    agora = datetime.now(timezone.utc)
    users = [u for u in (sb.table("users").select("id,name,email,role,team,status,is_service").execute().data or []) if u.get("id")]
    ativos = [u for u in users if (u.get("status") or "ativo") == "ativo" and not u.get("is_service")]
    email_uid = {(u.get("email") or "").lower(): u["id"] for u in ativos if u.get("email")}
    ids = {u["id"] for u in ativos}

    def dono(d):
        uid = str(d.get("user_id") or "")
        return uid if uid in ids else email_uid.get((d.get("user_email") or "").lower())

    stage_key = {}
    try:
        for s in (sb.table("rd_stages").select("id,psm_stage_key").execute().data or []):
            if s.get("id"):
                stage_key[str(s["id"])] = s.get("psm_stage_key")
    except Exception:
        pass
    prop_ids = sorted(k for k, v in stage_key.items() if v in ("proposta", "contrato"))

    cols = "id,name,amount,stage_id,stage_name,user_id,user_email,created_at_rd,updated_at_rd,la:rd_raw->>last_activity_at,nint:rd_raw->interactions,amt_total:rd_raw->amount_total,amt_unique:rd_raw->amount_unique"
    propostas = []
    for i in range(0, len(prop_ids), 50):
        try:
            propostas += MX._paginado(lambda: sb.table("deals").select(cols).is_("win", "null")
                                      .in_("stage_id", prop_ids[i:i + 50]).order("id"), cap=10)
        except Exception:
            pass
    lead_ini = (agora - timedelta(days=LEAD_JANELA_DIAS)).isoformat()
    lead_fim = (agora - timedelta(hours=24)).isoformat()
    leads = []
    try:
        leads = MX._paginado(lambda: sb.table("deals").select(cols).is_("win", "null")
                             .gte("created_at_rd", lead_ini).lt("created_at_rd", lead_fim).order("id"), cap=10)
    except Exception:
        pass
    ult_venda = {}
    try:
        wins = MX._paginado(lambda: sb.table("deals").select("closed_at,user_id,user_email").eq("win", True)
                            .gte("closed_at", (agora - timedelta(days=400)).isoformat()).order("id"), cap=10)
        for w in wins:
            uid = dono(w)
            c = MX.parse_dt(w.get("closed_at"))
            if uid and c and (uid not in ult_venda or c > ult_venda[uid]):
                ult_venda[uid] = c
    except Exception:
        pass
    ult_oo = {}
    try:
        for r in (sb.table("one_on_ones").select("corretor_id,data").order("data", desc=True).limit(2000).execute().data or []):
            c = r.get("corretor_id")
            if c and c not in ult_oo and r.get("data"):
                try:
                    ult_oo[c] = date.fromisoformat(str(r["data"])[:10])
                except Exception:
                    pass
    except Exception:
        pass
    metas = []
    try:
        for a in sorted({hoje.year, (hoje.replace(day=1) + timedelta(days=32)).year}):
            metas += sb.table("metas").select("corretor_id,ano,mes,meta_vgv,meta_vendas").eq("ano", a).execute().data or []
    except Exception:
        pass
    tarefas = []
    try:
        tarefas = sb.table("dir_tasks").select("id,titulo,descricao,status,prazo,responsavel,updated_at,categoria") \
            .eq("categoria", CATEGORIA_TAREFA).order("updated_at", desc=True).limit(500).execute().data or []
    except Exception:
        pass
    dispensas = MX._kv_read(sb, KV_DISPENSAS) or {}
    return {"users": users, "ativos": ativos, "dono": dono, "stage_key": stage_key, "propostas": propostas,
            "leads": leads, "ult_venda": ult_venda, "ult_oo": ult_oo, "metas": metas, "tarefas": tarefas,
            "dispensas": dispensas if isinstance(dispensas, dict) else {}, "agora": agora}


# ─── geração ─────────────────────────────────────────────────────────────────
def gerar(sb, hoje=None):
    hoje = hoje or MX.hoje_brt()
    b = _carregar(sb, hoje)
    pj = PJ.projecao(sb, {"h": "mes"}, hoje=hoje)
    nomes = {u["id"]: u.get("name") or u["id"] for u in b["users"]}
    ativos = {u["id"]: u for u in b["ativos"]}
    socios = sorted([u["id"] for u in b["ativos"] if MX.is_gestor(u.get("role")) is False and (u.get("role") or "").lower() in ("socio", "diretor")],
                    key=lambda x: (x != "paulo", x))
    socio = socios[0] if socios else None

    def gestor_de(tk):
        gs = [u["id"] for u in b["ativos"] if MX.is_gestor(u.get("role")) and MX.team_key(u.get("team")) == tk]
        return gs[0] if gs else socio

    out = []

    def add(tipo, alvo, nivel, titulo, porque, dono, prazo, team=None, pessoa=None, impacto=0.0, itens=None, link=None, periodo=""):
        if not dono:
            return
        did = f"{tipo}:{alvo}" + (f":{periodo}" if periodo else "")
        out.append({"id": did, "tipo": tipo, "tipo_label": TIPO_LABEL[tipo], "nivel": nivel, "titulo": titulo,
                    "porque": porque, "dono": {"id": dono, "name": nomes.get(dono, dono)},
                    "prazo": prazo.isoformat(), "prazo_label": ("hoje" if prazo == hoje else _fmt_d(prazo)),
                    "team": team, "pessoa": ({"id": pessoa, "name": nomes.get(pessoa, pessoa)} if pessoa else None),
                    "impacto_vgv": round(float(impacto or 0), 2), "itens": (itens or [])[:8], "link": link,
                    "telas": list(TELAS[tipo])})

    ym = f"{hoje.year:04d}-{hoje.month:02d}"
    hz = pj.get("horizonte") or {}
    du_rest = (hz.get("dias_uteis") or {}).get("restantes") or 0
    fim_mes = date.fromisoformat(hz["fim"]) if hz.get("fim") else hoje

    # 1) meta em risco + funil curto (equipes)
    for tk, e in (pj.get("equipes") or {}).items():
        if tk not in TEAM_NOME:
            continue
        g = gestor_de(tk)
        meta = e["meta"]["vgv"]
        if meta > 0 and e["status"] in ("fora", "atras") and du_rest > 0:
            falta = e["falta_vgv"]
            nivel = "critico" if e["status"] == "fora" else "atencao"
            add("meta_risco", tk, nivel,
                f"Fazer plano de recuperação da meta de {TEAM_NOME[tk]} até {_fmt_d(_dia_util_mais(hoje, 2))}",
                f"Projeção provável {_brl(e['provavel']['vgv'])} = {_n(e['provavel']['pct_meta'] or 0)}% da meta de {_brl(meta)}. "
                f"Faltam {_brl(falta)} (≈ {_n(e['falta_vendas'])} vendas) em {du_rest} dias úteis: {_brl(e['por_dia_util_vgv'] or 0)} por dia útil.",
                g, _dia_util_mais(hoje, 2), team=tk, impacto=falta, link="#/gestao-comercial", periodo=ym)
            # funil curto: vendas que faltam × o que as propostas abertas entregam
            cal = e.get("calibracao") or {}
            taxa = (cal.get("taxa_pct") or 15) / 100.0
            faltam_v = max(0.0, (e["meta"]["vendas"] or 0) - e["realizado"]["vendas"])
            cobre = e["funil"]["vendas"] + e["historico"]["vendas"]
            if faltam_v > cobre + 0.5 and taxa > 0:
                gerar_n = math.ceil((faltam_v - cobre) / taxa)
                add("funil_curto", tk, "critico" if e["status"] == "fora" else "atencao",
                    f"Gerar {gerar_n} propostas novas em {TEAM_NOME[tk]} até {_fmt_d(_dia_util_mais(hoje, 5))}",
                    f"Faltam ≈ {_n(faltam_v)} vendas. Ritmo + {e['base'].get('propostas_abertas', 0)} propostas abertas entregam ≈ {_n(cobre)}. "
                    f"Com {_n(taxa * 100)}% de conversão proposta→venda, são precisas {gerar_n} propostas a mais.",
                    g, _dia_util_mais(hoje, 5), team=tk, impacto=(faltam_v - cobre) * (e.get("ticket") or 0), link="#/gestao-comercial", periodo=ym)

    # 2) propostas paradas / sem valor (por corretor)
    by_uid_prop = {}
    for d in b["propostas"]:
        uid = b["dono"](d)
        if uid:
            by_uid_prop.setdefault(uid, []).append(d)
    for uid, ds in by_uid_prop.items():
        u = ativos.get(uid) or {}
        tk = MX.team_key(u.get("team"))
        ticket = ((pj.get("pessoas") or {}).get(uid) or {}).get("ticket") or 0
        paradas = []
        for d in ds:
            la = MX.parse_dt(d.get("la")) or MX.parse_dt(d.get("updated_at_rd"))
            dias = (b["agora"] - la).days if la else None
            if dias is not None and dias >= PROPOSTA_PARADA_DIAS:
                v = MX.vgv_de(d)
                paradas.append({"id": d.get("id"), "nome": (d.get("name") or "Negócio")[:60], "dias": dias,
                                "valor": v or None, "etapa": d.get("stage_name")})
        if paradas:
            paradas.sort(key=lambda x: -x["dias"])
            valor = sum((p["valor"] or ticket) for p in paradas)
            nivel = "critico" if any(p["dias"] >= 14 for p in paradas) else "atencao"
            add("proposta_parada", uid, nivel,
                f"Destravar {len(paradas)} proposta{'s' if len(paradas) > 1 else ''} parada{'s' if len(paradas) > 1 else ''} hoje",
                f"{nomes.get(uid)}: {len(paradas)} proposta(s) sem atividade há {paradas[0]['dias']}+ dias, ≈ {_brl(valor)} em jogo. "
                f"Proposta parada 14 dias raramente fecha: ligar, remarcar assinatura ou dar perda no RD.",
                uid, hoje, team=tk, pessoa=uid, impacto=valor * 0.18, itens=paradas, link="#/crm-house")
        sem_valor = [d for d in ds if MX.vgv_de(d) <= 0]
        if sem_valor:
            add("sem_valor", uid, "atencao",
                f"Preencher o valor de {len(sem_valor)} proposta{'s' if len(sem_valor) > 1 else ''} no RD",
                f"{nomes.get(uid)}: sem valor, a projeção usa o ticket médio ({_brl(ticket)}) e a previsão em reais fica imprecisa.",
                uid, _dia_util_mais(hoje, 1), team=tk, pessoa=uid,
                itens=[{"id": d.get("id"), "nome": (d.get("name") or "Negócio")[:60]} for d in sem_valor], link="#/crm-house")

    # 3) leads sem 1º contato
    by_uid_lead = {}
    for d in b["leads"]:
        n = d.get("nint")
        try:
            n = int(n) if n not in (None, "") else 0
        except Exception:
            n = 0
        if n == 0 and not d.get("la"):
            uid = b["dono"](d)
            if uid:
                by_uid_lead.setdefault(uid, []).append(d)
    for uid, ds in by_uid_lead.items():
        u = ativos.get(uid) or {}
        tk = MX.team_key(u.get("team"))
        itens = []
        for d in sorted(ds, key=lambda x: x.get("created_at_rd") or ""):
            c = MX.parse_dt(d.get("created_at_rd"))
            itens.append({"id": d.get("id"), "nome": (d.get("name") or "Lead")[:60],
                          "horas": int((b["agora"] - c).total_seconds() // 3600) if c else None})
        muitos = len(ds) >= 10
        dono = gestor_de(tk) if (muitos and gestor_de(tk) != uid) else uid
        add("lead_sem_contato", uid, "critico" if (muitos or any((i["horas"] or 0) >= 72 for i in itens)) else "atencao",
            (f"Redistribuir ou cobrar {len(ds)} leads sem contato de {nomes.get(uid)} hoje" if dono != uid
             else f"Fazer o 1º contato em {len(ds)} lead{'s' if len(ds) > 1 else ''} hoje"),
            f"{nomes.get(uid)}: {len(ds)} lead(s) com 24h+ sem nenhuma interação no RD (o mais antigo com {itens[0]['horas']}h). "
            f"Lead de tráfego esfria em horas: cada dia sem contato derruba a conversão.",
            dono, hoje, team=tk, pessoa=uid, impacto=len(ds) * 0.01 * ((pj.get("pessoas") or {}).get(uid, {}).get("ticket") or 0),
            itens=itens, link="#/crm-house")

    # 4) sem venda / 1:1 atrasado (corretores)
    for uid, p in (pj.get("pessoas") or {}).items():
        u = ativos.get(uid)
        if not u or not (u.get("role") or "").lower().startswith("corretor"):
            continue
        tk = MX.team_key(u.get("team"))
        g = gestor_de(tk)
        v180 = (p.get("base") or {}).get("vendas_180d") or 0
        intervalo = (180.0 / v180) if v180 else None
        limite = max(SEM_VENDA_MIN_DIAS, int(2 * intervalo)) if intervalo else SEM_VENDA_MIN_DIAS * 2
        ult = b["ult_venda"].get(uid)
        dias_sem = (b["agora"] - ult).days if ult else None
        oo = b["ult_oo"].get(uid)
        dias_oo = (hoje - oo).days if oo else None
        if dias_sem is not None and dias_sem > limite:
            add("sem_venda", uid, "critico" if dias_sem > limite * 1.5 else "atencao",
                f"1:1 de desempenho com {nomes.get(uid)} até {_fmt_d(_dia_util_mais(hoje, 3))}",
                f"{dias_sem} dias sem venda (o normal dele(a) é uma a cada {int(intervalo) if intervalo else '—'} dias). "
                f"Última 1:1: {(_fmt_d(oo) + f' ({dias_oo} dias)') if oo else 'nunca registrada'}.",
                g, _dia_util_mais(hoje, 3), team=tk, pessoa=uid, impacto=p.get("ticket") or 0, link="#/one-on-one")
        elif p.get("status") in ("fora", "atras") and (dias_oo is None or dias_oo > OO_MAX_DIAS) and p["meta"]["vgv"] > 0:
            add("oo_atrasado", uid, "atencao",
                f"Agendar 1:1 com {nomes.get(uid)} até {_fmt_d(_dia_util_mais(hoje, 5))}",
                f"Projeção {_n(p['provavel']['pct_meta'] or 0)}% da meta do mês e "
                f"{('última 1:1 há ' + str(dias_oo) + ' dias') if oo else 'nenhuma 1:1 registrada'}.",
                g, _dia_util_mais(hoje, 5), team=tk, pessoa=uid, impacto=p["falta_vgv"] * 0.1, link="#/one-on-one")

    # 5) meta não cadastrada (mês atual; próximo mês a partir do dia 25)
    meses = [(hoje.year, hoje.month)]
    if hoje.day >= 25:
        prox = hoje.replace(day=1) + timedelta(days=32)
        meses.append((prox.year, prox.month))
    tem_meta = {(m.get("corretor_id"), int(m.get("ano") or 0), int(m.get("mes") or 0))
                for m in b["metas"] if float(m.get("meta_vgv") or 0) > 0 or float(m.get("meta_vendas") or 0) > 0}
    for (y, mth) in meses:
        por_team = {}
        for uid, u in ativos.items():
            if (u.get("role") or "").lower().startswith("corretor") and (uid, y, mth) not in tem_meta:
                por_team.setdefault(MX.team_key(u.get("team")), []).append(uid)
        for tk, uids in por_team.items():
            if tk not in TEAM_NOME:
                continue
            quem = ", ".join(nomes.get(x, x).split(" ")[0] for x in uids)
            add("meta_ausente", tk, "atencao" if (y, mth) != (hoje.year, hoje.month) else "critico",
                f"Cadastrar meta de {mth:02d}/{y} para {len(uids)} corretor{'es' if len(uids) > 1 else ''} de {TEAM_NOME[tk]}",
                f"Sem meta não existe projeção nem cobrança: {quem}.",
                socio or gestor_de(tk), _dia_util_mais(hoje, 1), team=tk, link="#/metas", periodo=f"{y:04d}-{mth:02d}",
                itens=[{"id": x, "nome": nomes.get(x, x)} for x in uids])

    # 6) RD × HUB (avisos do motor)
    for a in (pj.get("avisos") or []):
        if a.get("tipo") == "rd_hub" and a.get("uid") in ativos:
            uid = a["uid"]
            add("rd_hub", uid, "critico",
                f"Conferir e marcar a venda no RD hoje",
                a.get("txt", "").replace("⚠️ ", ""),
                uid, hoje, team=MX.team_key(ativos[uid].get("team")), pessoa=uid,
                impacto=((pj.get("pessoas") or {}).get(uid) or {}).get("ticket") or 0, link="#/crm-house", periodo=ym)

    return _estados(out, b, hoje)


def _estados(decs, b, hoje):
    """Liga cada decisão à tarefa que a executa e às dispensas: nova · em andamento · atrasada · persistiu · dispensada."""
    por_dec = {}
    for t in b["tarefas"]:
        m = TAG_RE.search(t.get("descricao") or "")
        if m and m.group(1) not in por_dec:
            por_dec[m.group(1)] = t
    agora = b["agora"]
    vivas = []
    for d in decs:
        disp = b["dispensas"].get(d["id"])
        if isinstance(disp, dict) and disp.get("ate") and str(disp["ate"]) >= hoje.isoformat():
            d["estado"] = {"status": "dispensada", "motivo": disp.get("motivo"), "por": disp.get("por"), "ate": disp.get("ate")}
            vivas.append(d)
            continue
        t = por_dec.get(d["id"])
        if not t:
            d["estado"] = {"status": "nova"}
        else:
            st = (t.get("status") or "").lower()
            base = {"task_id": t.get("id"), "responsavel": t.get("responsavel"), "prazo": t.get("prazo")}
            if st in ("concluida", "concluída", "feita", "done"):
                upd = MX.parse_dt(t.get("updated_at"))
                if upd and (agora - upd) < timedelta(days=2):
                    d["estado"] = {**base, "status": "resolvendo"}   # acabou de concluir: dá 2 dias pro dado refletir
                else:
                    d["estado"] = {**base, "status": "persistiu"}
                    d["nivel"] = "critico"
            elif t.get("prazo") and str(t["prazo"]) < hoje.isoformat():
                d["estado"] = {**base, "status": "atrasada"}
                d["nivel"] = "critico"
            else:
                d["estado"] = {**base, "status": "em_andamento"}
        vivas.append(d)
    ordem_nivel = {"critico": 0, "atencao": 1}
    ordem_estado = {"persistiu": 0, "atrasada": 1, "nova": 2, "em_andamento": 3, "resolvendo": 4, "dispensada": 5}
    vivas.sort(key=lambda d: (ordem_estado.get(d["estado"]["status"], 9), ordem_nivel.get(d["nivel"], 9), -d["impacto_vgv"]))
    return vivas


def decisoes(sb, fresh=False, hoje=None):
    hoje = hoje or MX.hoje_brt()
    versao = MX.versao_deals(sb)
    key = f"{CACHE_KEY}:{hoje.isoformat()}"
    if not fresh:
        c = MX._kv_read(sb, key)
        if isinstance(c, dict) and c.get("versao") == versao:
            ts = MX.parse_dt(c.get("_cached_at"))
            if ts and (datetime.now(timezone.utc) - ts).total_seconds() < CACHE_TTL:
                return c.get("data") or []
    data = gerar(sb, hoje)
    MX._kv_write(sb, key, {"_cached_at": datetime.now(timezone.utc).isoformat(), "versao": versao, "data": data})
    return data


def invalidar(sb, hoje=None):
    hoje = hoje or MX.hoje_brt()
    try:
        sb.table("shared_kv").delete().eq("key", f"{CACHE_KEY}:{hoje.isoformat()}").execute()
    except Exception:
        pass


def filtrar(decs, user, tela=None, team=None, pessoa=None):
    """Alçada: sócio (lvl≥10) tudo; gestor/lvl≥5 da própria equipe + as que ele é dono; corretor só as dele."""
    lvl = (user or {}).get("lvl") or 0
    uid = (user or {}).get("id")
    tk_user = MX.team_key((user or {}).get("team"))
    out = []
    for d in decs:
        if lvl < 10:
            if lvl >= 5 or MX.is_gestor((user or {}).get("role")):
                if d.get("team") != tk_user and d["dono"]["id"] != uid:
                    continue
            elif d["dono"]["id"] != uid and (d.get("pessoa") or {}).get("id") != uid:
                continue
        if tela and tela not in d["telas"]:
            continue
        if team and d.get("team") != team:
            continue
        if pessoa and (d.get("pessoa") or {}).get("id") != pessoa and d["dono"]["id"] != pessoa:
            continue
        out.append(d)
    return out


def resumo_contagem(decs):
    ativos = [d for d in decs if d["estado"]["status"] not in ("dispensada", "resolvendo")]
    return {"total": len(ativos),
            "criticas": sum(1 for d in ativos if d["nivel"] == "critico"),
            "sem_dono_agindo": sum(1 for d in ativos if d["estado"]["status"] == "nova"),
            "atrasadas": sum(1 for d in ativos if d["estado"]["status"] in ("atrasada", "persistiu")),
            "em_andamento": sum(1 for d in ativos if d["estado"]["status"] == "em_andamento")}
