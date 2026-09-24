# -*- coding: utf-8 -*-
"""GET/POST /api/v3/diretoria/rotina — 🎯 Rotina de Gestão · PSM Conquista (v88.33) + PSM Imóveis (v88.37)

v88.37 — UNIDADES: ?unidade=imoveis (GET) / "unidade": "imoveis" (POST) serve a rotina
da PSM IMÓVEIS (Paulo × equipe MAP — Rafaela e Yara), pedida pelo Paulo em 24/set.
Sem o parâmetro = Conquista, como sempre. Cada unidade tem tarefas, papéis, RACI,
reuniões, placar e kv próprios; o motor (período, aderência, check) é o mesmo.

A rotina da DIRETORA da PSM Conquista (Isabella Morimatsu) com o GERENTE da equipe
(Kaue Bordini): tarefas recorrentes de cada um (dia/semana/quinzena/mês/trimestre),
checadas no período, e a aderência (% cumprido). As REUNIÕES não moram aqui — são
formatos da rotina v2.3 (/api/v3/gp/reunioes_formatos: lembrete, ata, pendências);
a tela junta as duas coisas.

GET  (Isa, Paulo, Kaue)  → papéis, tarefas com o estado do período atual, aderência
                            da semana/mês e das últimas 8 semanas
POST {action:'check', item, feito:bool, nota?}  → marca/desmarca no período ATUAL
     (tarefa da Isa: sócio; tarefa do Kaue: Kaue ou sócio)
Dados: shared_kv rotina_conquista {checks: {periodo: {item: {ts, por, nota}}}}
Período: D:AAAA-MM-DD · W:AAAA-Www · Q:AAAA-Www(par) · M:AAAA-MM · T:AAAA-Qn
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV = "rotina_conquista"
INICIO = date(2026, 9, 23)   # a rotina começou a valer aqui — antes disso não há o que cobrar
ISA, KAUE = "isa", "kbordini"
QUENS = ("isa", "kaue")   # papel A (quem aprova) · papel B (quem executa)

# quem: 'isa' | 'kaue' · cad: diario | semanal | quinzenal | mensal | trimestral · link: tela do sistema
def T(id, quem, cad, txt, link=None, porque=None):
    return {"id": id, "quem": quem, "cad": cad, "txt": txt, "link": link, "porque": porque}


TAREFAS = [
    # ── Isabella · Diretora ─────────────────────────────────────────────
    T("i_placar", "isa", "diario", "Olhar o placar do dia da Conquista (VGV, agendamentos, atendimentos, pastas)", "#/scorecard",
      "decidir com número, não com impressão"),
    T("i_leads", "isa", "diario", "Conferir leads sem 1º contato e cobrar o Kaue na hora", "#/wa-leads",
      "lead de tráfego esfria em horas"),
    T("i_checkin", "isa", "diario", "Check-in das 18h com o Kaue (número do dia, travas, o que escalar)", None,
      "problema de hoje resolvido hoje"),
    T("i_1a1", "isa", "semanal", "1:1 de Gestão com o Kaue — ata com pendências (dono + prazo)", "#/reunioes"),
    T("i_metas_sem", "isa", "semanal", "Validar com o Kaue o foco/meta da semana de cada corretor", "#/metas"),
    T("i_daily", "isa", "semanal", "Participar de 1 Daily Comercial (ouvir o time sem intermediário)", None),
    T("i_atend", "isa", "semanal", "Revisar 2 atendimentos/roleplays e devolver feedback ao Kaue", "#/one-on-one"),
    T("i_receb", "isa", "semanal", "Checar recebíveis da Conquista travados (nota, assinatura, repasse)", "#/estrategia"),
    T("i_criativos", "isa", "semanal", "Aprovar criativos e campanhas da Conquista da semana", "#/criativos"),
    T("i_dev", "isa", "quinzenal", "1:1 de Desenvolvimento do Kaue (feedback + PDI)", "#/rh-avaliacoes"),
    T("i_funil", "isa", "quinzenal", "Revisar funil & leads com o Kaue e o marketing (origem, CPL, perdas)", "#/gestao-comercial"),
    T("i_fech", "isa", "mensal", "Fechar o mês no Scorecard e mandar o relatório de 1 página ao Paulo", "#/scorecard"),
    T("i_comissao", "isa", "mensal", "Conferir e aprovar comissões e premiações da equipe", "#/comissao-conquista"),
    T("i_metas_mes", "isa", "mensal", "Aprovar as metas do próximo mês por corretor (proposta do Kaue) e lançar na aba Metas", "#/metas"),
    T("i_escala", "isa", "mensal", "Aprovar escala de plantões e campanhas do mês", "#/plantoes"),
    T("i_okr", "isa", "mensal", "Atualizar os KRs manuais dos OKRs (Academy / 2ª equipe)", "#/okrs"),
    T("i_okr_tri", "isa", "trimestral", "Revisão de OKRs da Conquista com o Paulo e o Kaue", "#/okrs"),
    T("i_aval", "isa", "trimestral", "Avaliação de desempenho do Kaue (9-box) e plano de desenvolvimento", "#/rh-avaliacoes"),
    T("i_time", "isa", "trimestral", "Plano de time: contratações, desligamentos e turma da Academy", "#/rh-recrutamento"),
    # ── Kaue · Gerente da equipe ───────────────────────────────────────
    T("k_daily", "kaue", "diario", "Conduzir a Daily das 9h (números de ontem, foco do dia, travas, ranking)", "#/gestao-comercial"),
    T("k_leads", "kaue", "diario", "Garantir 1º contato em todo lead (roleta) e redistribuir o que parou", "#/wa-leads"),
    T("k_checkin", "kaue", "diario", "Check-in das 18h com a Isa: número do dia + o que precisa dela", None),
    T("k_1a1", "kaue", "semanal", "1:1 com cada corretor e registro no One-on-One", "#/one-on-one"),
    T("k_pipe", "kaue", "semanal", "Levar ao 1:1 de Gestão o pipeline comprometido corretor a corretor", "#/gestao-comercial"),
    T("k_ata", "kaue", "semanal", "Registrar a ata da Daily de segunda (decisões + pendências)", "#/reunioes"),
    T("k_treino", "kaue", "semanal", "Treino/roleplay com o time (objeção, visita, fechamento)", "#/rh-treinamentos"),
    T("k_perdas", "kaue", "quinzenal", "Relatório de perdas e motivos para a revisão de funil", "#/gestao-comercial"),
    T("k_metas", "kaue", "mensal", "Propor metas do próximo mês por corretor para a Isa aprovar", "#/metas"),
    T("k_escala", "kaue", "mensal", "Montar a escala de plantões e propor campanhas", "#/plantoes"),
    T("k_academy", "kaue", "mensal", "Acompanhar os novos da Academy em campo (checklist de evolução)", "#/academy"),
]
IDX = {t["id"]: t for t in TAREFAS}

PAPEIS = {
    "isa": {"nome": "Isabella Morimatsu", "cargo": "Diretora da PSM Conquista (sócia)",
            "mandato": [
                "Dona do RESULTADO da Conquista: VGV, margem de contribuição da linha, CPL e o Scorecard da unidade.",
                "Aprova metas, contratações/desligamentos, comissões, premiações e verba de tráfego da Conquista.",
                "Desenvolve o gerente: 1:1 de gestão semanal, 1:1 de desenvolvimento quinzenal, avaliação trimestral.",
                "Garante que os rituais aconteçam e deixem ata — sem ata, o rito não aconteceu.",
                "Dona do OKR da Academy / 2ª equipe (16–18 corretores no Q1/2027).",
                "Reporta ao Paulo: Placar de Segunda, Quinzenal Diretoria e relatório de fechamento do mês.",
            ]},
    "kaue": {"nome": "Kaue Bordini", "cargo": "Gerente da equipe Conquista",
             "mandato": [
                 "Dono da EXECUÇÃO diária: daily, 1:1 com cada corretor, treino e roleplay.",
                 "Dono do Scorecard da Conquista e do Comercial no dia a dia (funil, SLA de lead, pipeline).",
                 "Todo lead com 1º contato rápido; redistribui o que parou na roleta.",
                 "Propõe metas, escala e campanhas — a Isa aprova.",
                 "Forma os novos da Academy em campo assistido.",
                 "Reporta à Isa todo dia (check-in 18h) e toda semana (1:1 de Gestão, com o pipeline corretor a corretor).",
             ]},
}
# R = executa · A = aprova/responde · C = consultado · I = informado
RACI = [
    ("Metas da equipe e por corretor", "A", "R"),
    ("Contratar / desligar corretor", "A", "R"),
    ("Escala de plantões", "A", "R"),
    ("Distribuição de leads (roleta) e SLA de 1º contato", "C", "R"),
    ("Daily, 1:1 dos corretores, treino e roleplay", "I", "R"),
    ("Verba de tráfego e criativos da Conquista", "A", "C"),
    ("Comissões e premiações", "A", "C"),
    ("Condições especiais com incorporadora", "A", "C"),
    ("Academy: seleção e campo assistido", "A", "R"),
    ("Relatório mensal ao Paulo", "R", "C"),
]
FORMATOS_ROTINA = ["conq_checkin", "conq_1a1_gestao", "conq_funil", "conq_dev_kaue", "conq_fechamento",
                   "daily_conquista", "placar_segunda", "quinzenal_diretoria", "mensal_rh"]


# ═══ PSM IMÓVEIS (v88.37) — Paulo (diretor, sócio) × equipe MAP (Rafaela e Yara) ═══════════
# Alto padrão / MAP + Terceiros: ciclo longo, proposta co-conduzida com o Paulo, captação com
# exclusividade (contrato padrão) e reativação da base MAP com a Mariane. Placar = un_imoveis.
TAREFAS_IMOVEIS = [
    # ── Paulo · Diretor da PSM Imóveis ─────────────────────────────────
    T("p_placar", "paulo", "diario", "Olhar o placar do dia da PSM Imóveis (VGV, visitas, propostas, pastas)", "#/scorecard",
      "decidir com número, não com impressão"),
    T("p_carteira", "paulo", "diario", "Conferir a Carteira MAP - Paulo e dar o próximo passo de cada negócio", "#/ponte",
      "negócio de alto padrão parado esfria"),
    T("p_semanal", "paulo", "semanal", "Conduzir a Semanal Comercial MAP — ata com pendências (dono + prazo)", "#/reunioes"),
    T("p_pipe", "paulo", "semanal", "Revisar o pipeline MAP negócio a negócio com a equipe", "#/gestao-comercial"),
    T("p_propostas", "paulo", "semanal", "Co-conduzir as propostas da semana (preço, condição, contraproposta)", "#/proposta"),
    T("p_capt", "paulo", "semanal", "Aprovar as captações novas e as exclusividades da semana", "#/captacoes"),
    T("p_reativ", "paulo", "semanal", "Conferir a reativação da base MAP (fila da Mariane) e as oportunidades que voltaram", "#/reativacao"),
    T("p_receb", "paulo", "semanal", "Checar recebíveis travados de MAP e Terceiros (nota, assinatura, repasse)", "#/estrategia"),
    T("p_dev", "paulo", "quinzenal", "1:1 de desenvolvimento com a Rafaela e com a Yara (feedback + próximos passos)", "#/one-on-one"),
    T("p_funil", "paulo", "quinzenal", "Revisar funil, origem dos leads e verba de tráfego da PSM Imóveis", "#/gestao-comercial"),
    T("p_fech", "paulo", "mensal", "Fechar o mês no Farol PSM (PSM Imóveis) e registrar as decisões", "#/scorecard"),
    T("p_metas", "paulo", "mensal", "Aprovar as metas do próximo mês por corretor e lançar na aba Metas", "#/metas"),
    T("p_estoque", "paulo", "mensal", "Revisar estoque Kenlo, tabelas MAP e SP Capital (preço e disponibilidade)", "#/estoque-kenlo"),
    T("p_comissao", "paulo", "mensal", "Conferir comissões e parcerias com Terceiros", "#/comissao-conquista"),
    T("p_okr", "paulo", "trimestral", "Revisão de OKRs da PSM Imóveis", "#/okrs"),
    T("p_aval", "paulo", "trimestral", "Avaliação de desempenho da equipe MAP e plano de desenvolvimento", "#/rh-avaliacoes"),
    # ── Equipe MAP · Rafaela e Yara ────────────────────────────────────
    T("m_producao", "map", "diario", "Registrar a produção do dia no ato (conversas de rede, reuniões, visitas)", "#/minha-producao",
      "o que não é registrado não conta no placar"),
    T("m_leads", "map", "diario", "Responder todo lead MAP no mesmo dia e atualizar a etapa no RD", "#/crm"),
    T("m_confirma", "map", "diario", "Confirmar as visitas do dia seguinte com o cliente", None),
    T("m_visitas", "map", "semanal", "Lançar cada visita feita como tarefa \"Visita\" concluída no RD", "#/crm",
      "é assim que a visita aparece na Gestão Comercial e na Produtividade"),
    T("m_pipe", "map", "semanal", "Levar à Semanal MAP o pipeline próprio e os agendamentos da semana", "#/gestao-comercial"),
    T("m_capt", "map", "semanal", "Buscar captações com exclusividade (formulário de captação)", "#/form-captacao"),
    T("m_reativ", "map", "quinzenal", "Follow-up das oportunidades reativadas pela Mariane", "#/reativacao"),
    T("m_metas", "map", "mensal", "Propor a meta do próximo mês ao Paulo", "#/metas"),
    T("m_estoque", "map", "mensal", "Atualizar fotos e dados dos imóveis captados no estoque", "#/estoque-kenlo"),
]
PAPEIS_IMOVEIS = {
    "paulo": {"nome": "Paulo Morimatsu", "cargo": "Diretor da PSM Imóveis (sócio)",
              "mandato": [
                  "Dono do RESULTADO da PSM Imóveis (MAP + Terceiros): VGV, margem da linha e o Farol da unidade.",
                  "Aprova metas, preço e condição de proposta, captações com exclusividade, comissões e verba de tráfego.",
                  "Co-conduz as propostas de alto padrão com a equipe até a assinatura.",
                  "Garante que a Semanal MAP aconteça e deixe ata — sem ata, o rito não aconteceu.",
                  "Desenvolve a equipe: 1:1 quinzenal e avaliação trimestral.",
              ]},
    "map": {"nome": "Equipe MAP — Rafaela Metzger · Yara Fetti", "cargo": "Corretoras da PSM Imóveis",
            "mandato": [
                "Donas da EXECUÇÃO: lead respondido no dia, visita marcada e confirmada, proposta levada ao Paulo.",
                "Registram no RD cada etapa e cada visita (tarefa \"Visita\" concluída) — é o que o sistema mede.",
                "Buscam captações com exclusividade e mantêm o estoque atualizado.",
                "Trabalham as oportunidades reativadas da base MAP junto com a Mariane.",
                "Reportam ao Paulo na Semanal MAP, com o pipeline próprio negócio a negócio.",
            ]},
}
RACI_IMOVEIS = [
    ("Metas da equipe e por corretor", "A", "R"),
    ("Preço e condição de proposta ao cliente", "A", "R"),
    ("Captação com exclusividade (contrato padrão)", "A", "R"),
    ("Registro no RD (etapas, visitas, propostas)", "I", "R"),
    ("Verba de tráfego e criativos da PSM Imóveis", "A", "C"),
    ("Comissões e parcerias com Terceiros", "A", "C"),
    ("Relacionamento com incorporadoras e SP Capital", "A", "C"),
    ("Contratar / desligar corretor MAP", "A", "I"),
]

UNIDADES = {
    "conquista": {"kv": KV, "inicio": INICIO, "quens": QUENS, "tarefas": TAREFAS, "papeis": PAPEIS,
                  "raci": RACI, "formatos": FORMATOS_ROTINA, "scorecard": "un_conquista",
                  "titulo": "PSM Conquista"},
    "imoveis": {"kv": "rotina_imoveis", "inicio": date(2026, 9, 24), "quens": ("paulo", "map"),
                "tarefas": TAREFAS_IMOVEIS, "papeis": PAPEIS_IMOVEIS, "raci": RACI_IMOVEIS,
                "formatos": ["semanal_map", "placar_segunda", "quinzenal_diretoria", "mensal_rh"],
                "scorecard": "un_imoveis", "titulo": "PSM Imóveis"},
}
for _u in UNIDADES.values():
    _u["idx"] = {t["id"]: t for t in _u["tarefas"]}


def _hoje():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


def periodo(cad, d):
    iso = d.isocalendar()
    if cad == "diario": return f"D:{d.isoformat()}"
    if cad == "semanal": return f"W:{iso[0]}-W{iso[1]:02d}"
    if cad == "quinzenal": return f"Q:{iso[0]}-W{(iso[1] - 1) // 2 * 2 + 1:02d}"
    if cad == "mensal": return f"M:{d.year}-{d.month:02d}"
    return f"T:{d.year}-Q{(d.month - 1) // 3 + 1}"


def _dias_uteis_ate(d, desde):
    out, x = [], desde
    while x <= d:
        if x.weekday() < 5: out.append(x)
        x += timedelta(days=1)
    return out


def aderencia(checks, ini, fim, hoje, un=None):
    """% cumprido entre ini e fim (até hoje): diário conta por dia útil; demais, por período que fechou/está aberto."""
    un = un or UNIDADES["conquista"]
    fim = min(fim, hoje)
    ini = max(ini, un["inicio"])
    if fim < ini:
        return {"pct": None, "feito": 0, "esperado": 0, **{q: None for q in un["quens"]}}
    esperado = feito = 0
    por = {q: [0, 0] for q in un["quens"]}
    vistos = set()
    for t in un["tarefas"]:
        if t["cad"] == "diario":
            ps = [periodo("diario", d) for d in _dias_uteis_ate(fim, ini)]
        else:
            ps, x = [], ini
            while x <= fim:
                p = periodo(t["cad"], x)
                if p not in ps: ps.append(p)
                x += timedelta(days=1)
        for p in ps:
            if (t["id"], p) in vistos: continue
            vistos.add((t["id"], p))
            esperado += 1; por[t["quem"]][1] += 1
            if (checks.get(p) or {}).get(t["id"]):
                feito += 1; por[t["quem"]][0] += 1
    pct = lambda a, b: round(a / b * 100) if b else None
    return {"pct": pct(feito, esperado), "feito": feito, "esperado": esperado,
            **{q: pct(*por[q]) for q in un["quens"]}}


def _eh_map(u):
    return (u.get("role") or "") in ("gerente_map", "corretor_map") or u.get("id") in ("rafaela", "yara")


def _pode_ver(u, unidade="conquista"):
    if (u.get("role") or "") in ("socio", "diretor"): return True
    if unidade == "imoveis": return _eh_map(u)
    return u.get("id") == KAUE or (u.get("role") or "") == "gerente_conquista"


def _pode_marcar(u, t, unidade="conquista"):
    if (u.get("role") or "") in ("socio", "diretor"): return True
    if unidade == "imoveis": return t["quem"] == "map" and _eh_map(u)
    return t["quem"] == "kaue" and (u.get("id") == KAUE or (u.get("role") or "") == "gerente_conquista")


def _kv(sb, kv=KV):
    rows = sb.table("shared_kv").select("value").eq("key", kv).limit(1).execute().data or []
    v = rows[0]["value"] if rows else None
    v = json.loads(v) if isinstance(v, str) else v
    return v if isinstance(v, dict) else {"checks": {}}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: u = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        unidade = q.get("unidade") or "conquista"
        un = UNIDADES.get(unidade)
        if not un: return self._send(400, {"ok": False, "error": "unidade inválida"})
        if not _pode_ver(u, unidade): return self._send(403, {"ok": False, "error": f"rotina da {un['titulo']}: sócios e a equipe da unidade"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try: data = _kv(sb, un["kv"])
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        checks = data.get("checks") or {}
        hoje = _hoje()
        seg = hoje - timedelta(days=hoje.weekday())
        tarefas = []
        for t in un["tarefas"]:
            p = periodo(t["cad"], hoje)
            c = (checks.get(p) or {}).get(t["id"])
            tarefas.append({**t, "periodo": p, "feito": c, "pode": _pode_marcar(u, t, unidade)})
        semanas = []
        for k in range(7, -1, -1):
            ini = seg - timedelta(weeks=k)
            a = aderencia(checks, ini, ini + timedelta(days=6), hoje, un)
            semanas.append({"semana": ini.isoformat(), **a})
        qa, qb = un["quens"]
        return self._send(200, {
            "ok": True, "unidade": unidade, "titulo": un["titulo"], "scorecard": un["scorecard"],
            "hoje": hoje.isoformat(), "papeis": un["papeis"], "quens": list(un["quens"]),
            "raci": [{"assunto": a, qa: i, qb: k} for a, i, k in un["raci"]],
            "tarefas": tarefas, "formatos": un["formatos"],
            "aderencia": {"semana": aderencia(checks, seg, seg + timedelta(days=6), hoje, un),
                          "mes": aderencia(checks, hoje.replace(day=1), hoje, hoje, un)},
            "semanas": semanas,
            "eu": {"id": u.get("id"), "socio": (u.get("role") or "") in ("socio", "diretor")},
            "inicio": un["inicio"].isoformat(),
        })

    def do_POST(self):
        try: u = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if body.get("action") != "check": return self._send(400, {"ok": False, "error": "action inválida"})
        unidade = str(body.get("unidade") or "conquista")
        un = UNIDADES.get(unidade)
        if not un: return self._send(400, {"ok": False, "error": "unidade inválida"})
        t = un["idx"].get(body.get("item"))
        if not t: return self._send(400, {"ok": False, "error": "tarefa desconhecida"})
        if not _pode_marcar(u, t, unidade): return self._send(403, {"ok": False, "error": "essa tarefa é de outra pessoa"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            data = _kv(sb, un["kv"])
            p = periodo(t["cad"], _hoje())
            cel = data.setdefault("checks", {}).setdefault(p, {})
            if body.get("feito"):
                cel[t["id"]] = {"ts": datetime.now(timezone.utc).isoformat(), "por": u.get("name"),
                                "nota": str(body.get("nota") or "")[:300] or None}
            else:
                cel.pop(t["id"], None)
            # guarda ~1 ano de períodos
            for k in sorted(data["checks"].keys())[:-400]:
                data["checks"].pop(k, None)
            sb.table("shared_kv").upsert({"key": un["kv"], "value": data, "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, u, "rotina.check", target_type=un["kv"], target_id=t["id"],
              notes=f"{p} {'feito' if body.get('feito') else 'desmarcado'}")
        return self._send(200, {"ok": True, "periodo": p})
