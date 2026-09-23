# -*- coding: utf-8 -*-
"""
🛰️ CENTRAL DE OPERAÇÕES (v88.17) — /api/v3/system/ops_central

UMA tela com tudo que roda sozinho no House PSM: rotinas (heartbeat + crons do
Vercel), integrações/APIs, agentes IA e a saúde geral — e o VIGIA que avisa o
Paulo quando algo trava, dá erro, para ou fica pausado.

Antes estava espalhado: Saúde do Sistema (/governanca), Integrações, Central
Agentes (status chumbado no JS), aviso de saúde do menu, cron_state (sem tela)
e o Sentinela (só ntfy). Nenhum desses dizia "o backup não roda há 8 dias".

Acesso: SÓ SÓCIO (lvl 10 = Paulo e Isa). Se o shared_kv 'ops_central_cfg'
tiver `admins` (lista de e-mails), só esses e-mails entram — trava extra.

GET                         → snapshot completo (checa ao vivo, inclui ping das APIs)
GET ?resumo=1               → só o último estado gravado (barato; badge do menu)
GET ?cron=1                 → vigia: calcula, grava e dispara os alertas novos
                              (Bearer CRON_SECRET, ou sócio logado)
POST {action:"silenciar", id, horas}   → cala um alerta por N horas (padrão 24)
POST {action:"reativar", id}           → tira o silêncio
POST {action:"config", whatsapp:bool, ntfy:bool, admins:[emails]}
POST {action:"testar_alerta"}          → manda um alerta de teste pelos canais

Alertas: sino + push (notify_all) pros admins; WhatsApp (Evolution) pro número
do admin quando é ERRO; ntfy.sh (mesmo tópico do Sentinela) quando é ERRO.
Dedupe em shared_kv 'ops_central_state': avisa quando o problema aparece,
relembra a cada 6h se continuar, e manda "✅ resolvido" quando some.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify_all, audit  # type: ignore

KV_STATE = "ops_central_state"
KV_CFG = "ops_central_cfg"
NTFY_TOPIC = os.environ.get("NTFY_TOPIC") or "psm-house-alerta-7k3m9x2f"   # mesmo do Sentinela
RELEMBRA_H = 6
BRT = timezone(timedelta(hours=-3))

# ─── Catálogo: rotinas do HEARTBEAT (espelha system/heartbeat.py JOBS) ───────────
# (key, nome, o que faz, intervalo_h | None=semanal, link da tela relacionada)
HEARTBEAT = [
    ("sync_rd_inc",  "Sync RD (incremental)",      "Puxa os negócios novos/alterados do RD Station pro House.", 0.5, "#/crm"),
    ("visitas_rd",   "Visitas do RD",              "Importa as tarefas de visita concluídas no RD.", 0.5, "#/minha-producao"),
    ("decisoes_dia", "Suas decisões de hoje",      "Manda a cada dono as decisões do dia (7h).", 1, "#/painel"),
    ("meu_dia",      "Meu dia",                    "Agenda + tarefas + recados de cada pessoa (sino, push e WhatsApp).", 0.5, "#/agenda"),
    ("lembrete_dia", "Lembretes do Paulo",         "Aviso de gravação (Academy) e prazos de Projetos.", 20, "#/projetos"),
    ("captar",       "Captações automáticas",      "Varre a etapa CAPTAR IMÓVEL e cria as captações.", 2, "#/captacoes"),
    ("recebiveis",   "Radar de recebíveis",        "Venda ganha → rascunho de recebível + alertas D-3/D+1.", 2, "#/diretoria"),
    ("meta_cache",   "Cache do Meta Ads",          "Pré-aquece os números do Meta pro Cockpit abrir rápido.", 1, "#/gestor-trafego"),
    ("meta_monthly", "Histórico mensal Meta",      "Arquiva o fechamento mensal de mídia paga.", 24, "#/marketing-historico"),
    ("leads_lp",     "Leads da Landing Page",      "Confere LP × RD, SLA de atendimento e saúde do webhook.", 0.5, "#/leads-lp"),
    ("reunioes",     "Lembretes de reunião",       "Avisa 30 min antes de cada formato de reunião.", 0.25, "#/reunioes"),
    ("sr_agente",    "Sr. Gerência (agente)",      "Agente IA que analisa 3 pessoas por rodada (ciclo semanal).", 2, "#/sr-gerencia"),
    ("backup_auto",  "Backup automático",          "Snapshot diário do banco no Storage (guarda 30 dias).", 24, "#/backup"),
    ("war_briefing", "Briefing de Guerra",         "Briefing semanal de inteligência (segunda).", None, "#/inteligencia"),
    ("amortecedor",  "Amortecedor de VGV",         "Push semanal do VGV próprio necessário.", None, "#/diretoria"),
    ("viab_ritmo",   "Alerta de ritmo do mês",     "Avisa a diretoria dia 10/20/25 se o VGV está abaixo do ritmo.", 12, "#/metricas-viab"),
    ("trafego_real", "Gasto real de mídia",        "Puxa o gasto do Meta por marca e alimenta a Viabilidade.", 6, "#/metricas-viab"),
    ("gt_relatorio", "Relatórios Sr. Tráfego",     "Relatórios diário/semanal/quinzenal/mensal do Gestor de Tráfego.", 0.5, "#/gestor-trafego"),
    ("gt_vigia",     "Vigia de Concorrência",      "IA olha concorrentes + Ad Library e avisa se tem algo acionável.", 2, "#/concorrencia"),
    ("gt_paridade",  "Paridade Meta × RD",         "Leads do Meta hoje × entradas no RD (piso 70%).", 1, "#/gestor-trafego"),
    ("consistencia", "Teste dos números",          "Confere à noite se os números batem entre as telas.", 1, "#/governanca"),
]

# ─── Crons do vercel.json SEM heartbeat, com a evidência de que rodaram ──────────
# evid: ("kv", key) = shared_kv.updated_at · ("tab", tabela, coluna) = max(coluna)
#       None = o job não deixa rastro → aparece como "sem registro" (não alerta)
# (id, nome, o que faz, agenda legível, evid, max_h_warn, max_h_err, link)
VERCEL = [
    ("sentinela",   "Sentinela (uptime)",       "Checa banco + site a cada 5 min e alerta no ntfy.", "a cada 5 min",
     ("kv", "uptime_state"), 0.5, 2, "#/governanca"),
    ("rd_full",     "Sync RD completo",         "Sincronização completa do RD (3×/dia).", "3×/dia",
     ("tab", "deals", "synced_at"), 12, 26, "#/crm"),
    ("kenlo",       "Sync estoque Kenlo",       "Atualiza o estoque de imóveis da Kenlo.", "diário 5h",
     ("tab", "kenlo_estoque_snapshots", "criado_em"), 30, 54, "#/estoque-kenlo"),
    ("zoho",        "Sync agenda Zoho",         "Sincroniza o Zoho Calendar de quem conectou.", "a cada 30 min",
     ("tab", "zoho_conexoes", "last_sync_at"), 3, 26, "#/integracoes"),
    ("ceo_cron",    "Rotina do Agente CEO",     "Diário/semanal/mensal do CEO (dossiês e compromissos).", "diário 7h45",
     ("kv", "ceo_diario"), 30, 54, "#/diretoria-ceo"),
    ("cmo_cron",    "Rotina do Agente CMO",     "Relatórios diário/semanal/mensal do CMO.", "diário 19h15",
     ("kv", "cmo_relatorios"), 30, 54, "#/cmo"),
    ("lembretes",   "Lembretes da agenda",      "Avisa os compromissos da agenda.", "a cada 5 min", None, 0, 0, "#/agenda"),
    ("sla_lead",    "SLA de lead novo",         "Cobra o corretor quando o lead novo fica sem contato.", "a cada 10 min", None, 0, 0, "#/minha-producao"),
    ("roleta_wa",   "Roleta WhatsApp (Vera)",   "Distribui a fila de leads do WhatsApp entre corretores.", "a cada 10 min", None, 0, 0, "#/wa-leads"),
    ("oo_alertas",  "Vigia Gestão Comercial",   "Alertas de hora em hora da Gestão Comercial.", "de hora em hora", None, 0, 0, "#/gestao-comercial"),
    ("prod_alerta", "Check-in de produção",     "Cobrança de produção das 14h.", "seg-sex 14h", None, 0, 0, "#/minha-producao"),
    ("kanban_cad",  "Kanban de cadência",       "Joga bases do RD no Kanban com cadência.", "seg-sex 9h", None, 0, 0, "#/reativacao"),
    ("norte_auto",  "Norte do Mês automático",  "Monta o Norte do Mês da Conquista.", "segunda 9h", None, 0, 0, "#/gestao-comercial"),
    ("plano_brief", "Briefing do Plano",        "Briefing semanal do plano.", "segunda 7h", None, 0, 0, "#/diretoria"),
    ("gate_risco",  "Gate em risco",            "Alerta mensal de gate em risco (dia 20).", "dia 20", None, 0, 0, "#/diretoria"),
    ("viab_mes",    "Fechamento Viabilidade",   "Recalcula a Viabilidade no dia 1.", "dia 1", None, 0, 0, "#/metricas-viab"),
]

# ─── Agentes IA ────────────────────────────────────────────────────────────────
AGENTES_CHAT = [
    ("vera", "Vera", "💜", "Vendas e estratégia comercial"),
    ("sol", "Sol", "☀️", "Marketing e copy"),
    ("sr_performance", "Sr. Performance", "🎖️", "Performance individual"),
    ("sr_gerencia", "Sr. Gerência", "👔", "Gestão de equipe"),
    ("gestor_trafego", "Sr. Gestor de Tráfego", "🚦", "Mídia paga"),
    ("ceo", "CEO", "🏛", "Visão de dono"),
    ("cfo", "CFO", "💰", "Financeiro"),
    ("cmo", "CMO", "📣", "Marketing estratégico"),
    ("curador", "Curador", "🔎", "Squad Conquista — pauta"),
    ("copywriter", "Copywriter", "✍️", "Squad Conquista — copy"),
    ("designer", "Designer", "🎨", "Squad Conquista — arte"),
    ("video_ia", "Vídeo IA", "🎬", "Squad Conquista — vídeo"),
    ("editor_video", "Editor de Vídeo", "✂️", "Squad Conquista — cortes"),
    ("social_media", "Social Media", "📅", "Squad Conquista — calendário"),
    ("community", "Community", "💬", "Squad Conquista — comentários/DMs"),
    ("agendador", "Agendador", "🗓", "Squad Conquista — publicação"),
    ("seo", "SEO", "🔍", "Squad Conquista — busca"),
    ("organico", "Tráfego Orgânico", "🌱", "Squad Conquista — algoritmo"),
    ("mkt_mrr", "Sr. MKT MRR", "🔁", "Réguas e base"),
    ("auditor_mkt", "Auditor de Marketing", "🧐", "Notas e QC"),
    ("professor", "Professor", "🎓", "Academy"),
    ("sala_treino", "Sala de Treino", "🥊", "Treino de objeções"),
]
# agentes que trabalham SOZINHOS (rotina) e a evidência do último trabalho
AGENTES_AUTO = [
    ("auto_ceo", "Agente CEO (rotina)", "🏛", ("kv", "ceo_diario"), 30, 54, "#/diretoria-ceo"),
    ("auto_cmo", "Agente CMO (rotina)", "📣", ("kv", "cmo_relatorios"), 30, 54, "#/cmo"),
    ("auto_gt", "Sr. Gestor de Tráfego (relatórios)", "🚦", ("kv", "gt_relatorios"), 30, 54, "#/gestor-trafego"),
    ("auto_vigia", "Vigia de Concorrência (IA)", "🕵️", ("kv", "gt_vigia"), 14, 30, "#/concorrencia"),
    ("auto_sr", "Sr. Gerência (análises)", "👔", ("kv", "sr_agente_state"), 8, 30, "#/sr-gerencia"),
    ("auto_sol", "Sol no WhatsApp", "☀️", ("tab", "sol_eventos", "criado_em"), 0, 0, "#/central-sol"),
]


# ─── util ──────────────────────────────────────────────────────────────────────
def _now():
    return datetime.now(timezone.utc)


def _parse(iso):
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _age_h(iso, now):
    d = _parse(iso)
    return None if d is None else max(0.0, (now - d).total_seconds() / 3600.0)


def fmt_idade(h):
    if h is None:
        return "nunca"
    if h < 1:
        return f"há {max(1, int(round(h * 60)))} min"
    if h < 48:
        return f"há {int(round(h))}h"
    return f"há {int(round(h / 24))} dias"


def fmt_intervalo(hours):
    if hours is None:
        return "semanal"
    if hours < 1:
        return f"a cada {int(hours * 60)} min"
    if hours < 24:
        return f"a cada {int(hours) if hours == int(hours) else hours}h"
    return "diário"


def _item(id_, grupo, nome, desc, status, detalhe, ultimo=None, link=None, agenda=None, ico=None):
    return {"id": id_, "grupo": grupo, "nome": nome, "desc": desc, "status": status,
            "detalhe": detalhe, "ultimo": ultimo, "link": link, "agenda": agenda, "ico": ico}


def avaliar_heartbeat(key, hours, ran_at, note, now):
    """Status de uma rotina do heartbeat. Regras (testadas em tests/test_ops_central.py):
    - nunca rodou → erro · nota 'falha:' → erro (a última tentativa quebrou)
    - atraso > max(4× intervalo, intervalo+6h) → erro · > max(2×, intervalo+1h) → atenção
    - semanal: nada desde a segunda passada (> 8 dias) → erro
    Devolve (status, detalhe)."""
    age = _age_h(ran_at, now)
    if age is None:
        return "error", "Nunca rodou."
    if note and str(note).lower().startswith("falha"):
        return "error", f"Última tentativa falhou ({fmt_idade(age)}): {str(note)[6:].strip()[:140]}"
    if hours is None:
        if age > 8 * 24:
            return "error", f"Rotina semanal parada — última vez {fmt_idade(age)}."
        return "ok", f"Rodou {fmt_idade(age)}."
    if age > max(4 * hours, hours + 6):
        return "error", f"Parada — devia rodar {fmt_intervalo(hours)}, última vez {fmt_idade(age)}."
    if age > max(2 * hours, hours + 1):
        return "warn", f"Atrasada — devia rodar {fmt_intervalo(hours)}, última vez {fmt_idade(age)}."
    extra = " (ainda executando no servidor)" if note and "em execução" in str(note) else ""
    return "ok", f"Rodou {fmt_idade(age)}{extra}."


def avaliar_idade(age, warn_h, err_h):
    if age is None:
        return "error" if err_h else "unknown"
    if err_h and age > err_h:
        return "error"
    if warn_h and age > warn_h:
        return "warn"
    return "ok"


# ─── coleta ────────────────────────────────────────────────────────────────────
class Coleta:
    """Lê o banco uma vez só por fonte (cache por request)."""

    def __init__(self, sb):
        self.sb = sb
        self._kv = {}
        self._tab = {}

    def kv_updated(self, key):
        if key not in self._kv:
            try:
                r = (self.sb.table("shared_kv").select("updated_at,value").eq("key", key)
                     .limit(1).execute().data or [])
                self._kv[key] = r[0] if r else None
            except Exception:
                self._kv[key] = None
        row = self._kv[key]
        return row.get("updated_at") if row else None

    def kv_value(self, key):
        self.kv_updated(key)
        row = self._kv.get(key)
        return (row or {}).get("value")

    def tab_max(self, tab, col):
        k = (tab, col)
        if k not in self._tab:
            try:
                r = (self.sb.table(tab).select(col).not_.is_(col, "null")
                     .order(col, desc=True).limit(1).execute().data or [])
                self._tab[k] = r[0].get(col) if r else None
            except Exception:
                self._tab[k] = "__erro__"
        v = self._tab[k]
        return None if v == "__erro__" else v

    def evid(self, ev):
        if not ev:
            return None
        if ev[0] == "kv":
            return self.kv_updated(ev[1])
        return self.tab_max(ev[1], ev[2])


def coletar_rotinas(sb, col, now):
    itens = []
    try:
        rows = sb.table("cron_state").select("key,ran_at,note").execute().data or []
        cs = {r["key"]: r for r in rows}
        cron_ok = True
    except Exception:
        cs, cron_ok = {}, False

    if not cron_ok:
        itens.append(_item("motor", "rotinas", "Motor de rotinas (heartbeat)",
                           "Tabela cron_state que controla todas as rotinas.", "error",
                           "Tabela cron_state inacessível — nenhuma rotina automática está sendo controlada.",
                           link="#/governanca"))
        return itens

    # motor parado? (nenhum job em 3h durante o expediente = ninguém usando OU heartbeat quebrado)
    ultimos = [_parse(r.get("ran_at")) for k, r in cs.items() if k != "sla_ran_at"]
    ultimos = [u for u in ultimos if u]
    idade_motor = (now - max(ultimos)).total_seconds() / 3600 if ultimos else None
    hora_brt = now.astimezone(BRT).hour
    if idade_motor is None or (idade_motor > 3 and 9 <= hora_brt <= 21):
        itens.append(_item("motor", "rotinas", "Motor de rotinas (heartbeat)",
                           "Roda as rotinas automáticas enquanto o sistema está em uso.", "error",
                           f"Nenhuma rotina rodou {fmt_idade(idade_motor)} — heartbeat parado ou CRON_SECRET ausente.",
                           link="#/governanca", agenda="contínuo"))
    if not os.environ.get("CRON_SECRET"):
        itens.append(_item("cron_secret", "rotinas", "Chave das rotinas (CRON_SECRET)",
                           "Senha que autoriza as rotinas automáticas.", "error",
                           "CRON_SECRET ausente no Vercel — nenhuma rotina roda.", agenda="—"))

    for key, nome, desc, hours, link in HEARTBEAT:
        r = cs.get(key) or {}
        st, det = avaliar_heartbeat(key, hours, r.get("ran_at"), r.get("note"), now)
        itens.append(_item("hb:" + key, "rotinas", nome, desc, st, det, r.get("ran_at"), link, fmt_intervalo(hours)))

    for id_, nome, desc, agenda, ev, wh, eh, link in VERCEL:
        if ev is None:
            itens.append(_item("vc:" + id_, "rotinas", nome, desc, "unknown",
                               "Agendada no Vercel — não deixa registro de execução.", None, link, agenda))
            continue
        ult = col.evid(ev)
        age = _age_h(ult, now)
        st = avaliar_idade(age, wh, eh)
        det = f"Última execução {fmt_idade(age)}." if age is not None else "Sem nenhum registro de execução."
        # detalhes extra
        if id_ == "sentinela":
            v = col.kv_value("uptime_state") or {}
            if v.get("estado") == "down":
                st, det = "error", "Sentinela detectou queda: " + "; ".join(v.get("problemas") or [])[:200]
        if id_ == "zoho" and st == "ok":
            try:
                zs = sb.table("zoho_conexoes").select("zoho_email,last_sync_res").limit(200).execute().data or []
                ruins = [z for z in zs if isinstance(z.get("last_sync_res"), dict) and (z["last_sync_res"].get("erro") or z["last_sync_res"].get("error"))]
                if ruins:
                    st = "warn"
                    det += f" {len(ruins)} conta(s) com erro no último sync."
            except Exception:
                pass
        itens.append(_item("vc:" + id_, "rotinas", nome, desc, st, det, ult, link, agenda))
    return itens


def _http_json(url, headers=None, timeout=6):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PSM-OpsCentral", **(headers or {})})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, (r.read(4000).decode("utf-8", "ignore")), round(time.time() - t0, 2)
    except urllib.error.HTTPError as e:
        try:
            body = e.read(2000).decode("utf-8", "ignore")
        except Exception:
            body = ""
        return e.code, body, round(time.time() - t0, 2)
    except Exception as e:
        return 0, str(e)[:160], round(time.time() - t0, 2)


def _env(*names):
    return all((os.environ.get(n) or "").strip() for n in names)


def _pings():
    """Pings baratos (listar modelos / 'me'), sem custo de uso. Roda em paralelo."""
    tarefas = {}
    meta_tok = (os.environ.get("META_ACCESS_TOKEN") or "").strip()
    if meta_tok:
        tarefas["meta"] = lambda: _http_json("https://graph.facebook.com/v21.0/me?fields=id&access_token=" + urllib.parse.quote(meta_tok))
    ak = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if ak:
        tarefas["anthropic"] = lambda: _http_json("https://api.anthropic.com/v1/models?limit=1",
                                                  {"x-api-key": ak, "anthropic-version": "2023-06-01"})
    gk = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if gk:
        tarefas["gemini"] = lambda: _http_json("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=" + urllib.parse.quote(gk))
    ok_ = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if ok_:
        tarefas["openai"] = lambda: _http_json("https://api.openai.com/v1/models", {"Authorization": "Bearer " + ok_})
    ev_url = (os.environ.get("EVOLUTION_API_URL") or "").strip().rstrip("/")
    if ev_url and _env("EVOLUTION_API_KEY", "EVOLUTION_INSTANCE"):
        inst = os.environ["EVOLUTION_INSTANCE"].strip()
        tarefas["evolution"] = lambda: _http_json(f"{ev_url}/instance/connectionState/{urllib.parse.quote(inst)}",
                                                  {"apikey": os.environ["EVOLUTION_API_KEY"].strip()})
    su = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    if su:
        tarefas["supabase_rest"] = lambda: _http_json(su + "/rest/v1/", timeout=5)
    out = {}
    if not tarefas:
        return out
    with ThreadPoolExecutor(max_workers=len(tarefas)) as ex:
        futs = {k: ex.submit(f) for k, f in tarefas.items()}
        for k, f in futs.items():
            try:
                out[k] = f.result(timeout=9)
            except Exception as e:
                out[k] = (0, str(e)[:120], 9)
    return out


def _ping_status(p, nome):
    """(status, detalhe) de um ping. 200 = ok · 401/403 = chave inválida/expirada (erro) · 0 = fora do ar."""
    if p is None:
        return None
    code, body, dt = p
    if code == 200:
        return "ok", f"Respondendo ({dt}s)."
    if code in (401, 403):
        return "error", f"{nome} recusou a chave (HTTP {code}) — token inválido ou expirado."
    if code == 0:
        return "error", f"{nome} não respondeu ({body[:80]})."
    if code == 429:
        return "warn", f"{nome} limitando requisições (HTTP 429) — cota estourada?"
    msg = ""
    try:
        j = json.loads(body)
        msg = ((j.get("error") or {}).get("message") if isinstance(j.get("error"), dict) else j.get("error")) or ""
    except Exception:
        pass
    return "warn", f"{nome} respondeu HTTP {code}. {str(msg)[:140]}"


def coletar_integracoes(sb, col, now, live=True):
    P = _pings() if live else {}
    itens = []

    def add(id_, nome, desc, st, det, ult=None, link=None, ico=None):
        itens.append(_item("in:" + id_, "integracoes", nome, desc, st, det, ult, link, None, ico))

    # Banco
    try:
        t0 = time.time()
        sb.table("shared_kv").select("key").limit(1).execute()
        ms = round((time.time() - t0) * 1000)
        add("supabase", "Banco de dados (Supabase)", "Onde mora todo o dado do House.",
            "warn" if ms > 3000 else "ok", f"Consulta em {ms} ms.", ico="🗄")
    except Exception as e:
        add("supabase", "Banco de dados (Supabase)", "Onde mora todo o dado do House.", "error", f"Banco não responde: {str(e)[:120]}", ico="🗄")

    # RD Station
    if not _env("RD_API_TOKEN"):
        add("rd", "RD Station CRM", "Negócios, funis e tarefas.", "error", "RD_API_TOKEN ausente — CRM não sincroniza.", link="#/crm", ico="📇")
    else:
        ult = col.tab_max("deals", "synced_at")
        age = _age_h(ult, now)
        st = avaliar_idade(age, 2, 12)
        add("rd", "RD Station CRM", "Negócios, funis e tarefas.", st,
            f"Último dado sincronizado {fmt_idade(age)}." + (" Token pode ter expirado." if st == "error" else ""),
            ult, "#/crm", "📇")

    # Meta Ads
    s = _ping_status(P.get("meta"), "Meta")
    if not _env("META_ACCESS_TOKEN"):
        add("meta", "Meta Ads (Facebook/Instagram)", "Campanhas, gasto e leads.", "error", "META_ACCESS_TOKEN ausente.", link="#/gestor-trafego", ico="📢")
    else:
        ult = col.tab_max("meta_ads_cache", "refreshed_at")
        age = _age_h(ult, now)
        st, det = s or ("unknown", "Não testado agora.")
        if st == "ok" and avaliar_idade(age, 3, 24) != "ok":
            st, det = "warn", f"Token OK, mas o cache do Meta está {fmt_idade(age)} sem atualizar."
        add("meta", "Meta Ads (Facebook/Instagram)", "Campanhas, gasto e leads.", st, det, ult, "#/gestor-trafego", "📢")

    # WhatsApp
    prov = "none"
    if _env("WA_CLOUD_TOKEN", "WA_PHONE_ID", "WA_TEMPLATE") or _env("META_WA_TOKEN", "WA_PHONE_ID", "WA_TEMPLATE"):
        prov = "WhatsApp Cloud (Meta)"
    elif _env("D360_API_KEY", "D360_TEMPLATE"):
        prov = "360dialog"
    elif _env("EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE"):
        prov = "Evolution"
    if prov == "none":
        add("whatsapp", "WhatsApp", "Envio de mensagens (Meu dia, campanhas, roleta).", "paused",
            "Nenhum provedor configurado — envios de WhatsApp desligados.", link="#/wa-leads", ico="💬")
    else:
        st, det = "ok", f"Provedor: {prov}."
        pe = P.get("evolution")
        if pe is not None:
            code, body, _dt = pe
            if code != 200:
                st, det = _ping_status(pe, "Evolution")
            elif '"open"' not in body and "'open'" not in body:
                st, det = "error", "Evolution respondeu, mas o WhatsApp está DESCONECTADO (precisa ler o QR code de novo)."
            else:
                det = "Evolution conectado."
        # erros recentes na fila de leads do WhatsApp
        try:
            desde = (now - timedelta(hours=24)).isoformat()
            n = (sb.table("wa_leads").select("id", count="exact").not_.is_("erro", "null")
                 .gte("updated_at", desde).execute().count or 0)
            if n:
                st = "warn" if st == "ok" else st
                det += f" {n} lead(s) do WhatsApp com erro nas últimas 24h."
        except Exception:
            pass
        add("whatsapp", "WhatsApp", "Envio de mensagens (Meu dia, campanhas, roleta).", st, det, link="#/wa-leads", ico="💬")

    # Landing page / webhook
    try:
        desde = (now - timedelta(hours=24)).isoformat()
        fal = (sb.table("lp_webhook_log").select("id", count="exact").eq("ok", False).gte("ts", desde).execute().count or 0)
        ult = col.tab_max("lp_webhook_log", "ts")
        age = _age_h(ult, now)
        st = "error" if fal >= 5 else ("warn" if fal else "ok")
        det = (f"{fal} envio(s) do formulário falharam nas últimas 24h. " if fal else "") + f"Último lead recebido {fmt_idade(age)}."
        add("lp", "Landing Page (webhook de leads)", "Formulário psmconquista → House → RD.", st, det, ult, "#/leads-lp", "🧲")
    except Exception:
        pass

    # Kenlo
    if not (_env("KENLO_OPEN_CLIENT_ID") or _env("KENLO_OPEN_TOKEN") or _env("KENLO_OPEN_API_KEY")
            or any(k.startswith("KENLO_OPEN") and os.environ.get(k) for k in os.environ)):
        add("kenlo", "Kenlo Imob", "Estoque de imóveis.", "paused", "Credenciais KENLO_OPEN_* ausentes.", link="#/estoque-kenlo", ico="🏠")
    else:
        ult = col.tab_max("kenlo_estoque_snapshots", "criado_em")
        age = _age_h(ult, now)
        add("kenlo", "Kenlo Imob", "Estoque de imóveis.", avaliar_idade(age, 30, 54),
            f"Último sync {fmt_idade(age)}.", ult, "#/estoque-kenlo", "🏠")
        itens[-1]["herda"] = "vc:kenlo"   # mesmo problema da rotina "Sync estoque Kenlo" → 1 alerta só

    # NIBO
    add("nibo", "NIBO (financeiro)", "Contas, pagamentos e comissões pagas.",
        "ok" if _env("NIBO_API_TOKEN") else "error",
        "Token configurado." if _env("NIBO_API_TOKEN") else "NIBO_API_TOKEN ausente — Financeiro ao vivo fora.",
        link="#/financeiro", ico="🏦")

    # Zoho
    ult = col.tab_max("zoho_conexoes", "last_sync_at")
    if _env("ZOHO_CLIENT_ID") or ult:
        age = _age_h(ult, now)
        add("zoho", "Zoho Calendar", "Agenda de quem conectou.", avaliar_idade(age, 3, 26),
            f"Último sync {fmt_idade(age)}.", ult, "#/integracoes", "📆")

    # IAs
    ias = []
    for key, nome, env in (("anthropic", "Claude (Anthropic)", "ANTHROPIC_API_KEY"),
                           ("gemini", "Gemini (Google)", "GEMINI_API_KEY"),
                           ("openai", "OpenAI", "OPENAI_API_KEY")):
        if not _env(env):
            st, det = ("paused", f"{env} não configurada.") if key == "openai" else ("warn", f"{env} ausente — agentes usam só o outro provedor.")
        else:
            st, det = _ping_status(P.get(key), nome) or ("unknown", "Não testado agora.")
        ias.append((key, st))
        add(key, nome, "Motor dos agentes IA.", st, det, link="#/ia", ico="🧠")

    # Push / alertas
    add("push", "Notificações no celular (Push)", "Web Push do sino pro celular/navegador.",
        "ok" if _env("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY") else "warn",
        "Chaves VAPID configuradas." if _env("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY") else "Chaves VAPID ausentes — alertas só aparecem no sino.",
        ico="🔔")
    add("ntfy", "Alerta de emergência (ntfy)", "Canal que funciona mesmo com o banco fora do ar.",
        "ok", f"Tópico: {NTFY_TOPIC} — assine no app ntfy pra receber.", ico="🚨")

    # Supabase REST (ping externo)
    s = _ping_status(P.get("supabase_rest"), "Supabase")
    if s and s[0] == "error" and P.get("supabase_rest", (0,))[0] not in (401, 403):
        add("supabase_rest", "Supabase (gateway)", "Porta de entrada do banco.", "error", s[1], ico="🗄")

    return itens, ias


def coletar_agentes(sb, col, now, ias):
    itens = []
    motor_ok = any(st == "ok" for k, st in ias if k in ("anthropic", "gemini"))
    motor_testado = any(st != "unknown" for k, st in ias)
    uso = {}
    try:
        rows = (sb.table("shared_kv").select("key,updated_at").like("key", "agent_chat::%")
                .order("updated_at", desc=True).limit(800).execute().data or [])
        for r in rows:
            parts = str(r["key"]).split("::")
            if len(parts) >= 2 and parts[1] not in uso:
                uso[parts[1]] = r.get("updated_at")
    except Exception:
        pass
    for key, nome, ico, papel in AGENTES_CHAT:
        ult = uso.get(key)
        herda = None
        if motor_testado and not motor_ok:
            st, det = "error", "Sem motor de IA respondendo (Claude e Gemini fora) — o agente não responde."
            herda = "in:anthropic"   # 1 alerta só (o do motor), não 1 por agente
        else:
            st = "ok"
            det = f"Última conversa {fmt_idade(_age_h(ult, now))}." if ult else "Disponível — ainda sem conversas."
        it = _item("ag:" + key, "agentes", nome, papel, st, det, ult, "#/ia", "sob demanda", ico)
        if herda:
            it["herda"] = herda
        itens.append(it)
    for id_, nome, ico, ev, wh, eh, link in AGENTES_AUTO:
        ult = col.evid(ev)
        age = _age_h(ult, now)
        st = avaliar_idade(age, wh, eh)
        det = f"Último trabalho {fmt_idade(age)}." if ult else "Sem registro de trabalho ainda."
        if id_ == "auto_sol":
            st = "ok" if ult else "unknown"
            try:
                cfg = sb.table("sol_config").select("chave,valor").eq("chave", "autonomia_padrao").limit(1).execute().data or []
                modo = ((cfg[0].get("valor") or {}).get("modo") if cfg else None)
                if modo:
                    det += f" Modo: {'autônoma' if modo == 'autonoma' else 'copiloto'}."
            except Exception:
                pass
        if motor_testado and not motor_ok and st == "ok":
            st, det = "error", "Motor de IA fora — a rotina vai falhar. " + det
        itens.append(_item("ag:" + id_, "agentes", nome, "Trabalha sozinho (rotina)", st, det, ult, link, "automático", ico))
    return itens


def versao_coerente(json_txt, main_txt):
    """(status, detalhe) comparando version.json × APP_VERSION embarcado no main.js.
    Diferentes = todo navegador acha que tem versão nova, recarrega e cai de novo no
    aviso → loop de atualização (aconteceu na v88.19: json 88.19 × main.js 88.18)."""
    try:
        vj = str(json.loads(json_txt).get("version") or "").strip()
    except Exception:
        vj = ""
    m = re.search(r"APP_VERSION\s*=\s*'([^']+)'", main_txt or "")
    vm = m.group(1).strip() if m else ""
    if not vj or not vm:
        return "warn", "Não consegui ler a versão publicada (version.json ou main.js)."
    if vj != vm:
        return "error", (f"Versão DESCASADA: version.json diz {vj} e o código diz {vm} — o sistema fica "
                         "pedindo 'Atualizar' em loop pra todo mundo. Corrigir APP_VERSION no main.js e publicar.")
    return "ok", f"Versão {vj} coerente (version.json = código)."


def coletar_saude(sb, col, now, host="www.housepsm.com.br", live=True):
    """Versão publicada + avisos já existentes (teste noturno dos números entre telas)."""
    itens = []
    try:
        if not live:
            raise StopIteration
        def _baixa(url):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "PSM-OpsCentral", "Cache-Control": "no-cache"})
                with urllib.request.urlopen(req, timeout=8) as r:
                    return r.status, r.read().decode("utf-8", "ignore")
            except urllib.error.HTTPError as e:
                return e.code, ""
        t = int(time.time())
        cj, tj = _baixa(f"https://{host}/version.json?t={t}")     # inteiro: passa de 4 KB
        cm, tm = _baixa(f"https://{host}/v2/js/main.js?t={t}")
        if cj == 200 and cm == 200:
            st, det = versao_coerente(tj, tm)
        else:
            st, det = "warn", f"Site não entregou os arquivos de versão (version.json HTTP {cj}, main.js HTTP {cm})."
        itens.append(_item("sd:versao", "saude", "Versão publicada", "version.json × código do app (evita loop de atualização).",
                           st, det, None, None, "a cada checagem", "🔁"))
    except StopIteration:
        pass
    except Exception as e:
        itens.append(_item("sd:versao", "saude", "Versão publicada", "version.json × código do app.",
                           "warn", f"Checagem de versão falhou: {str(e)[:100]}", None, None, "a cada checagem", "🔁"))
    try:
        rows = (sb.table("shared_kv").select("key,value,updated_at").like("key", "consistencia_telas:%")
                .order("updated_at", desc=True).limit(1).execute().data or [])
        if rows:
            v = rows[0].get("value") or {}
            falhas = v.get("falhas") if isinstance(v, dict) else None
            checks = (v.get("checks") or []) if isinstance(v, dict) else []
            ruins = [c for c in checks if isinstance(c, dict) and not c.get("ok")]
            n = falhas if isinstance(falhas, int) else len(ruins)
            st = "ok" if not n else ("error" if any(c.get("sev") == "err" for c in ruins) else "warn")
            det = "Todos os números batem entre as telas." if not n else \
                f"{n} divergência(s): " + " · ".join(str(c.get("msg"))[:90] for c in ruins[:3])
            itens.append(_item("sd:consistencia", "saude", "Números entre telas", "Teste noturno de consistência.",
                               st, det, rows[0].get("updated_at"), "#/governanca", "toda noite", "🔎"))
    except Exception:
        pass
    # venda sem VGV no mês (suja os números)
    try:
        b = now.astimezone(BRT)
        m0 = datetime(b.year, b.month, 1, tzinfo=BRT).isoformat()
        n0 = (sb.table("deals").select("id", count="exact").eq("win", True).gte("closed_at", m0)
              .eq("amount", 0).execute().count or 0)
        itens.append(_item("sd:vgv0", "saude", "Vendas com valor", "Vendas do mês precisam ter VGV no RD.",
                           "warn" if n0 else "ok",
                           f"{n0} venda(s) do mês com VGV R$ 0,00 no RD." if n0 else "Todas as vendas do mês têm valor.",
                           None, "#/crm", "contínuo", "🧾"))
    except Exception:
        pass
    return itens


# ─── estado, alertas ───────────────────────────────────────────────────────────
ALERTA_STATUS = ("error", "warn", "paused")


def resumo(itens):
    r = {"error": 0, "warn": 0, "paused": 0, "ok": 0, "unknown": 0}
    for i in itens:
        r[i["status"]] = r.get(i["status"], 0) + 1
    status = "error" if r["error"] else ("warn" if r["warn"] else "ok")
    return status, r


def diff_alertas(itens, anterior, silencio, now, relembra_h=RELEMBRA_H, ignorar=()):
    """Decide o que avisar. Puro (testável).
    anterior: {id: {status, desde, avisado_em}} · silencio: {id: iso_até}
    ignorar: ids que NÃO devem ser avaliados agora (congela o estado anterior, sem avisar
    nem dar "resolvido") — ex.: rotinas curtas fora do expediente.
    Retorna (novo_estado, novos, relembrar, resolvidos)."""
    novo, novos, relembrar, resolvidos = {}, [], [], []
    for id_ in ignorar:
        if id_ in anterior:
            novo[id_] = anterior[id_]
    # "herda": problema que é consequência de outro já alertado (ex.: agentes sem motor de IA)
    atuais = {i["id"]: i for i in itens
              if i["status"] in ALERTA_STATUS and i["id"] not in ignorar and not i.get("herda")}
    for id_, it in atuais.items():
        prev = anterior.get(id_) or {}
        calado = _parse(silencio.get(id_)) and _parse(silencio.get(id_)) > now
        piorou = prev.get("status") == "warn" and it["status"] == "error"
        ent = {"status": it["status"], "desde": prev.get("desde") or now.isoformat(),
               "avisado_em": prev.get("avisado_em")}
        if not calado:
            if not prev or piorou or (prev.get("status") == "paused" and it["status"] != "paused"):
                novos.append(it)
                ent["avisado_em"] = now.isoformat()
            elif it["status"] == "error":
                last = _parse(prev.get("avisado_em"))
                if last is None or (now - last).total_seconds() >= relembra_h * 3600:
                    relembrar.append(it)
                    ent["avisado_em"] = now.isoformat()
        novo[id_] = ent
    for id_, prev in anterior.items():
        if id_ not in atuais and id_ not in ignorar and prev.get("avisado_em"):
            resolvidos.append(id_)
    return novo, novos, relembrar, resolvidos


CURTAS = {"hb:" + k for k, _n, _d, h, _l in HEARTBEAT if h is not None and h <= 2}


def fora_do_expediente(itens, now):
    """Rotinas de ciclo curto só rodam com o sistema em uso (heartbeat). Antes das 9h e
    depois das 21h (BRT) o atraso delas é esperado → não alerta nem dá 'resolvido'."""
    h = now.astimezone(BRT).hour
    if 9 <= h <= 21:
        return set()
    return {i["id"] for i in itens if i["id"] in CURTAS}


def _admins(sb, cfg):
    emails = [str(e).strip().lower() for e in (cfg.get("admins") or []) if str(e).strip()]
    try:
        rows = (sb.table("users").select("id,name,email,role,status,whatsapp")
                .in_("role", ["socio", "diretor"]).execute().data or [])
    except Exception:
        rows = []
    rows = [u for u in rows if str(u.get("status") or "ativo").lower() in ("ativo", "active")]
    if emails:
        rows = [u for u in rows if str(u.get("email") or "").lower() in emails]
    return rows


def _pode(user, cfg):
    if (user.get("lvl") or 0) < 10:
        return False
    emails = [str(e).strip().lower() for e in (cfg.get("admins") or []) if str(e).strip()]
    return not emails or str(user.get("email") or "").lower() in emails


def _ntfy(titulo, corpo, prioridade="high"):
    try:
        req = urllib.request.Request(
            f"https://ntfy.sh/{NTFY_TOPIC}", data=corpo.encode("utf-8"), method="POST",
            headers={"Title": titulo.encode("ascii", "ignore").decode() or "House PSM",
                     "Priority": prioridade, "Tags": "rotating_light", "Click": "https://www.housepsm.com.br/#/central-ops"})
        urllib.request.urlopen(req, timeout=8)
        return True
    except Exception:
        return False


def _wa_send(phone, text):
    url = (os.environ.get("EVOLUTION_API_URL") or "").strip().rstrip("/")
    key = (os.environ.get("EVOLUTION_API_KEY") or "").strip()
    inst = (os.environ.get("EVOLUTION_INSTANCE") or "").strip()
    dig = re.sub(r"\D", "", str(phone or "")).lstrip("0")
    if not (url and key and inst) or len(dig) < 10:
        return False
    if not dig.startswith("55"):
        dig = "55" + dig
    try:
        req = urllib.request.Request(url + "/message/sendText/" + inst, method="POST",
                                     data=json.dumps({"number": dig, "text": text}).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "apikey": key})
        urllib.request.urlopen(req, timeout=15)
        return True
    except Exception:
        return False


ICO = {"error": "🔴", "warn": "🟡", "paused": "⏸"}


def disparar(sb, cfg, novos, relembrar, resolvidos, nomes_resolvidos):
    """Manda os alertas pelos canais. Devolve o que saiu por onde."""
    if not (novos or relembrar or resolvidos):
        return {"enviado": False}
    admins = _admins(sb, cfg)
    ids = [u["id"] for u in admins]
    linhas = [f"{ICO.get(i['status'], '•')} {i['nome']}: {i['detalhe']}" for i in novos]
    linhas += [f"⏰ continua: {i['nome']}: {i['detalhe']}" for i in relembrar]
    linhas += [f"✅ resolvido: {nomes_resolvidos.get(r, r)}" for r in resolvidos]
    n_err = sum(1 for i in novos + relembrar if i["status"] == "error")
    if n_err:
        titulo = f"🚨 House PSM: {n_err} problema(s) sério(s)"
    elif novos or relembrar:
        titulo = f"⚠️ House PSM: {len(novos) + len(relembrar)} ponto(s) de atenção"
    else:
        titulo = f"✅ House PSM: {len(resolvidos)} problema(s) resolvido(s)"
    corpo = "\n".join(linhas[:12]) + ("\n…" if len(linhas) > 12 else "")
    out = {"enviado": True, "admins": len(ids), "linhas": len(linhas)}
    if ids:
        try:
            notify_all(ids, "ops_alerta", titulo, corpo[:900], link="#/central-ops")
            out["sino_push"] = True
        except Exception as e:
            out["sino_push"] = f"falhou: {str(e)[:80]}"
    # canais "barulhentos" só pra ERRO
    if n_err:
        if cfg.get("ntfy", True):
            out["ntfy"] = _ntfy(titulo, corpo)
        if cfg.get("whatsapp", True):
            wa = 0
            for u in admins:
                if u.get("whatsapp") and _wa_send(u["whatsapp"], f"*{titulo}*\n\n{corpo}\n\nAbrir: https://www.housepsm.com.br/#/central-ops"):
                    wa += 1
            out["whatsapp"] = wa
    return out


def snapshot(sb, now, live=True, host="www.housepsm.com.br"):
    col = Coleta(sb)
    rotinas = coletar_rotinas(sb, col, now)
    integracoes, ias = coletar_integracoes(sb, col, now, live=live)
    agentes = coletar_agentes(sb, col, now, ias)
    saude = coletar_saude(sb, col, now, host, live)
    itens = rotinas + integracoes + agentes + saude
    status, r = resumo(itens)
    return itens, status, r


def kv_get(sb, key):
    try:
        rows = sb.table("shared_kv").select("value,updated_at").eq("key", key).limit(1).execute().data or []
        return (rows[0].get("value") or {}) if rows else {}
    except Exception:
        return {}


def kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value, "updated_at": _now().isoformat()},
                                 on_conflict="key").execute()


def vigiar(sb, cfg, itens, now, forcar_teste=False):
    st = kv_get(sb, KV_STATE)
    anterior = st.get("alertas") or {}
    silencio = cfg.get("silencio") or {}
    nomes = {**(st.get("nomes") or {}), **{i["id"]: i["nome"] for i in itens}}
    novo, novos, relembrar, resolvidos = diff_alertas(itens, anterior, silencio, now,
                                                      ignorar=fora_do_expediente(itens, now))
    envio = disparar(sb, cfg, novos, relembrar, resolvidos, nomes)
    status, r = resumo(itens)
    estado = {"alertas": novo, "nomes": {k: nomes[k] for k in novo if k in nomes},
              "status": status, "resumo": r, "em": now.isoformat(),
              "ativos": [{"id": i["id"], "nome": i["nome"], "status": i["status"], "detalhe": i["detalhe"],
                          "link": i.get("link"), "grupo": i["grupo"]}
                         for i in itens if i["status"] in ALERTA_STATUS],
              "ultimo_envio": ({"em": now.isoformat(), **envio} if envio.get("enviado") else st.get("ultimo_envio"))}
    try:
        kv_set(sb, KV_STATE, estado)
    except Exception:
        pass
    return estado, envio


# ─── auto-cura ─────────────────────────────────────────────────────────────────
# Rotina CRÍTICA parada não espera o heartbeat (que só roda com gente usando o sistema
# e fica refém do sync do RD): o vigia dispara ela direto, com o CRON_SECRET do servidor.
# (item, path, atraso mínimo em horas pra disparar)
AUTO_CURA = [
    ("hb:backup_auto", "/api/v3/backup/auto", 30),
]


def precisa_curar(itens, now, cron_state_ran):
    """Quais rotinas críticas disparar agora. Puro (testável).
    cron_state_ran: {key: iso do último ran_at}."""
    alvo = []
    por_id = {i["id"]: i for i in itens}
    for id_, path, min_h in AUTO_CURA:
        it = por_id.get(id_)
        if not it or it["status"] not in ("error", "warn"):
            continue
        age = _age_h(cron_state_ran.get(id_[3:]), now)
        if age is None or age >= min_h:
            alvo.append((id_, path))
    return alvo


def auto_curar(sb, itens, now, host=None):
    secret = (os.environ.get("CRON_SECRET") or "").strip()
    if not secret:
        return {"ran": [], "erro": "CRON_SECRET ausente"}
    try:
        ran = {r["key"]: r.get("ran_at") for r in (sb.table("cron_state").select("key,ran_at").execute().data or [])}
    except Exception:
        ran = {}
    host = (host or "www.housepsm.com.br").split(",")[0].strip()
    out = {"ran": []}
    for id_, path in precisa_curar(itens, now, ran)[:1]:     # 1 por rodada: request curta
        key = id_[3:]
        try:   # trava antes (2 crons simultâneos não disparam 2 backups); o endpoint regrava no sucesso
            sb.table("cron_state").upsert({"key": key, "ran_at": now.isoformat(), "note": "auto-cura da Central (disparado)"},
                                          on_conflict="key").execute()
        except Exception:
            pass
        try:
            req = urllib.request.Request(f"https://{host}{path}", headers={"Authorization": f"Bearer {secret}",
                                                                           "User-Agent": "PSM-OpsCentral-autocura"})
            with urllib.request.urlopen(req, timeout=50) as r:
                out["ran"].append({"id": id_, "status": r.status, "resp": r.read(300).decode("utf-8", "ignore")})
        except Exception as e:
            msg = str(e)[:160]
            if "timed out" in msg.lower():   # segue rodando no servidor (mesma regra do heartbeat)
                out["ran"].append({"id": id_, "aguardo": "timeout — segue rodando no servidor"})
            else:
                out["ran"].append({"id": id_, "erro": msg})
                try:
                    sb.table("cron_state").upsert({"key": key, "ran_at": ran.get(key) or now.isoformat(),
                                                  "note": f"falha: auto-cura {msg[:100]}"}, on_conflict="key").execute()
                except Exception:
                    pass
    return out


# ─── handler ───────────────────────────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def _cron_auth(self):
        sec = os.environ.get("CRON_SECRET")
        a = self.headers.get("Authorization") or ""
        return bool(sec and a.lower().startswith("bearer ") and a[7:].strip() == sec)

    def _user(self, cfg):
        u = require_user(self, min_lvl=10)
        if not _pode(u, cfg):
            raise AuthError(403, "Central de Operações: acesso só do Paulo e da Isa.")
        return u

    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        sb = supabase_client()
        if not sb:
            return self._send(200, {"ok": False, "status": "error", "error": "Banco indisponível (Supabase não configurado)."})
        cfg = kv_get(sb, KV_CFG)
        now = _now()

        if q.get("cron"):
            if not self._cron_auth():
                try:
                    self._user(cfg)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            itens, status, r = snapshot(sb, now, live=True)
            cura = auto_curar(sb, itens, now, self.headers.get("Host"))
            if cura.get("ran"):
                itens, status, r = snapshot(sb, now, live=True)   # reflete o que a auto-cura resolveu
            estado, envio = vigiar(sb, cfg, itens, now)
            return self._send(200, {"ok": True, "status": status, "resumo": r, "envio": envio, "auto_cura": cura})

        try:
            self._user(cfg)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        if q.get("resumo"):
            st = kv_get(sb, KV_STATE)
            return self._send(200, {"ok": True, "status": st.get("status") or "unknown", "resumo": st.get("resumo") or {},
                                    "ativos": st.get("ativos") or [], "em": st.get("em")})

        itens, status, r = snapshot(sb, now, live=True)
        # abrir a tela também roda o vigia (alerta sai mesmo se o cron do Vercel falhar)
        estado, _envio = vigiar(sb, cfg, itens, now)
        silencio = {k: v for k, v in (cfg.get("silencio") or {}).items() if _parse(v) and _parse(v) > now}
        for i in itens:
            if i["id"] in silencio:
                i["silenciado_ate"] = silencio[i["id"]]
            a = (estado.get("alertas") or {}).get(i["id"])
            if a:
                i["desde"] = a.get("desde")
        return self._send(200, {
            "ok": True, "status": status, "resumo": r, "itens": itens, "em": now.isoformat(),
            "ultimo_envio": estado.get("ultimo_envio"),
            "cfg": {"whatsapp": cfg.get("whatsapp", True), "ntfy": cfg.get("ntfy", True),
                    "admins": cfg.get("admins") or [], "ntfy_topic": NTFY_TOPIC,
                    "wa_configurado": _env("EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE")},
        })

    def do_POST(self):
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Banco indisponível."})
        cfg = kv_get(sb, KV_CFG)
        try:
            user = self._user(cfg)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        acao = body.get("action")
        now = _now()

        if acao in ("silenciar", "reativar"):
            id_ = str(body.get("id") or "")[:80]
            if not id_:
                return self._send(400, {"ok": False, "error": "id obrigatório"})
            sil = {k: v for k, v in (cfg.get("silencio") or {}).items() if _parse(v) and _parse(v) > now}
            if acao == "silenciar":
                horas = max(1, min(24 * 30, int(body.get("horas") or 24)))
                sil[id_] = (now + timedelta(hours=horas)).isoformat()
            else:
                sil.pop(id_, None)
            cfg["silencio"] = sil
            kv_set(sb, KV_CFG, cfg)
            audit(self, user, f"ops_central.{acao}", "ops_item", id_)
            return self._send(200, {"ok": True, "silencio": sil})

        if acao == "config":
            if "whatsapp" in body:
                cfg["whatsapp"] = bool(body["whatsapp"])
            if "ntfy" in body:
                cfg["ntfy"] = bool(body["ntfy"])
            if "admins" in body:
                lst = [str(e).strip().lower() for e in (body.get("admins") or []) if "@" in str(e)][:5]
                me = str(user.get("email") or "").lower()
                if lst and me not in lst:
                    return self._send(400, {"ok": False, "error": "Inclua o seu próprio e-mail na lista, senão você perde o acesso."})
                cfg["admins"] = lst
            kv_set(sb, KV_CFG, cfg)
            audit(self, user, "ops_central.config", "shared_kv", KV_CFG)
            return self._send(200, {"ok": True, "cfg": {k: cfg.get(k) for k in ("whatsapp", "ntfy", "admins")}})

        if acao == "testar_alerta":
            teste = [_item("teste", "saude", "Alerta de teste", "", "error",
                           f"Se você recebeu isto, os alertas da Central de Operações estão funcionando ({user.get('name')}).")]
            envio = disparar(sb, cfg, teste, [], [], {})
            return self._send(200, {"ok": True, "envio": envio})

        return self._send(400, {"ok": False, "error": "action deve ser silenciar, reativar, config ou testar_alerta"})
