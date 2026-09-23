# -*- coding: utf-8 -*-
"""GET/POST /api/v3/diretoria/rotina — 🎯 Rotina de Gestão · PSM Conquista (v88.33)

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
from datetime import date, datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV = "rotina_conquista"
ISA, KAUE = "isa", "kbordini"

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


def aderencia(checks, ini, fim, hoje):
    """% cumprido entre ini e fim (até hoje): diário conta por dia útil; demais, por período que fechou/está aberto."""
    fim = min(fim, hoje)
    esperado = feito = 0
    por = {"isa": [0, 0], "kaue": [0, 0]}
    vistos = set()
    for t in TAREFAS:
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
            "isa": pct(*por["isa"]), "kaue": pct(*por["kaue"])}


def _pode_ver(u):
    return (u.get("role") or "") in ("socio", "diretor") or u.get("id") == KAUE or (u.get("role") or "") == "gerente_conquista"


def _pode_marcar(u, t):
    if (u.get("role") or "") in ("socio", "diretor"): return True
    return t["quem"] == "kaue" and (u.get("id") == KAUE or (u.get("role") or "") == "gerente_conquista")


def _kv(sb):
    rows = sb.table("shared_kv").select("value").eq("key", KV).limit(1).execute().data or []
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
        try: u = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        if not _pode_ver(u): return self._send(403, {"ok": False, "error": "rotina da diretoria da Conquista: sócios e o gerente"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try: data = _kv(sb)
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        checks = data.get("checks") or {}
        hoje = _hoje()
        seg = hoje - timedelta(days=hoje.weekday())
        tarefas = []
        for t in TAREFAS:
            p = periodo(t["cad"], hoje)
            c = (checks.get(p) or {}).get(t["id"])
            tarefas.append({**t, "periodo": p, "feito": c, "pode": _pode_marcar(u, t)})
        semanas = []
        for k in range(7, -1, -1):
            ini = seg - timedelta(weeks=k)
            a = aderencia(checks, ini, ini + timedelta(days=6), hoje)
            semanas.append({"semana": ini.isoformat(), **a})
        return self._send(200, {
            "ok": True, "hoje": hoje.isoformat(), "papeis": PAPEIS,
            "raci": [{"assunto": a, "isa": i, "kaue": k} for a, i, k in RACI],
            "tarefas": tarefas, "formatos": FORMATOS_ROTINA,
            "aderencia": {"semana": aderencia(checks, seg, seg + timedelta(days=6), hoje),
                          "mes": aderencia(checks, hoje.replace(day=1), hoje, hoje)},
            "semanas": semanas,
            "eu": {"id": u.get("id"), "socio": (u.get("role") or "") in ("socio", "diretor")},
        })

    def do_POST(self):
        try: u = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if body.get("action") != "check": return self._send(400, {"ok": False, "error": "action inválida"})
        t = IDX.get(body.get("item"))
        if not t: return self._send(400, {"ok": False, "error": "tarefa desconhecida"})
        if not _pode_marcar(u, t): return self._send(403, {"ok": False, "error": "essa tarefa é de outra pessoa"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            data = _kv(sb)
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
            sb.table("shared_kv").upsert({"key": KV, "value": data, "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, u, "rotina.check", target_type="rotina_conquista", target_id=t["id"],
              notes=f"{p} {'feito' if body.get('feito') else 'desmarcado'}")
        return self._send(200, {"ok": True, "periodo": p})
