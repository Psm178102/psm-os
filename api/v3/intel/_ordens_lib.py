"""
_ordens_lib.py — Ordens da semana do Briefing com DONO, PRAZO e COBRANÇA. v88.82

Decisão do Paulo (28/09/2026): "as ordens ficam com o Paulo; dependendo, ele delega
para algum agente de IA ou para algum usuário do sistema".

Cada ordem (shared_kv 'war_ordens'.itens[i]) ganha:
  dono      {tipo: 'socio'|'usuario'|'agente', id, nome}
  prazo     'AAAA-MM-DD'
  task_id   tarefa em dir_tasks (espelha na Agenda) — é ela que cobra
  entrega   (só agente) o plano/entregável que o agente escreveu
  status    pendente | em_andamento | atrasada | aguardando_validacao | feita

Delegar a USUÁRIO/SÓCIO → vira tarefa na Agenda do dono + notificação.
Delegar a AGENTE → o agente escreve a entrega na hora (com o contexto vivo dele) e
nasce uma tarefa "Validar entrega do agente" pro sócio — agente não fecha ordem sozinho.
"""
import os
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
for _p in (os.path.join(_V3, "tasks"), os.path.join(_V3, "ia")):
    if _p not in sys.path:
        sys.path.append(_p)

from _auth_lib import notify, hoje_brt  # type: ignore

KV_ORDENS = "war_ordens"
CATEGORIA = "Briefing"

# Agentes que podem receber uma ordem (ids do AGENTS de api/v3/ia/chat.py).
AGENTES = [
    ("ceo", "CEO"), ("cfo", "CFO"), ("cmo", "CMO"),
    ("gestor_trafego", "Sr. Gestor de Tráfego"), ("sr_performance", "Sr. Performance"),
    ("sr_gerencia", "Sr. Gerência"), ("mkt_mrr", "Sr. MKT MRR (base e réguas)"),
    ("curador", "Curador (pauta)"), ("copywriter", "Copywriter"), ("social_media", "Social Media"),
]
_AGENTE_NOME = dict(AGENTES)


def ler(sb):
    rows = sb.table("shared_kv").select("value").eq("key", KV_ORDENS).limit(1).execute().data or []
    v = rows[0]["value"] if rows else {}
    if isinstance(v, str):
        import json
        v = json.loads(v)
    return v or {}


def gravar(sb, ordens):
    sb.table("shared_kv").upsert({"key": KV_ORDENS, "value": ordens,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def usuarios_ativos(sb):
    try:
        us = sb.table("users").select("id,name,role,status,is_service").execute().data or []
    except Exception:
        us = sb.table("users").select("id,name,role,status").execute().data or []
    return [{"id": u["id"], "nome": u.get("name") or "—", "papel": u.get("role") or ""}
            for u in us if u.get("id") and (u.get("status") or "ativo") == "ativo" and not u.get("is_service")]


def sincronizar_status(sb, ordens):
    """Lê as tarefas ligadas às ordens e devolve o status real (sem gravar)."""
    itens = ordens.get("itens") or []
    ids = [o.get("task_id") for o in itens if o.get("task_id")]
    tasks = {}
    if ids:
        try:
            for t in sb.table("dir_tasks").select("id,status,prazo,responsavel").in_("id", ids).execute().data or []:
                tasks[t["id"]] = t
        except Exception:
            pass
    hoje = hoje_brt().isoformat()
    for o in itens:
        if o.get("feito"):
            o["status"] = "feita"
            continue
        t = tasks.get(o.get("task_id"))
        if not o.get("dono"):
            o["status"] = "pendente"
        elif t and (t.get("status") or "").lower() in ("concluida", "concluída", "feita", "done"):
            o["status"] = "aguardando_validacao" if (o["dono"].get("tipo") == "agente") else "feita"
        elif o.get("prazo") and str(o["prazo"]) < hoje:
            o["status"] = "atrasada"
        elif o["dono"].get("tipo") == "agente":
            o["status"] = "aguardando_validacao"
        else:
            o["status"] = "em_andamento"
    return ordens


def _prazo_padrao():
    # até sexta desta semana (se já passou de quinta, sexta da próxima)
    h = hoje_brt()
    dias = (4 - h.weekday()) % 7
    if dias < 1:
        dias += 7
    return (h + timedelta(days=dias)).isoformat()


def _criar_tarefa(sb, actor, responsavel, titulo, descricao, prazo):
    tid = f"brf_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"
    row = {
        "id": tid, "titulo": titulo[:140], "descricao": descricao[:4000],
        "status": "aberta", "prioridade": "alta", "categoria": CATEGORIA,
        "responsavel": responsavel, "criado_por": actor.get("id"),
        "criado_em": int(time.time() * 1000), "inicio": hoje_brt().isoformat(), "prazo": prazo,
        "historico": [{"ts": datetime.now(timezone.utc).isoformat(), "by": actor.get("id"),
                       "acao": "criada pelo Briefing (ordem da semana)"}],
    }
    sb.table("dir_tasks").insert(row).execute()
    try:
        from _espelho_agenda import espelhar  # type: ignore
        espelhar(sb, row)
    except Exception as e:
        print(f"[ordens] espelho agenda: {e}")
    return tid


def _rodar_agente(sb, agent_id, ordem_txt, semana):
    """O agente escreve a entrega da ordem com o contexto vivo dele (mesmo motor do chat)."""
    import chat as CH  # type: ignore  (api/v3/ia/chat.py)
    agent = CH.AGENTS[agent_id]
    system = agent["system"]
    try:
        if agent_id in ("ceo", "cfo", "cmo"):
            ctx = CH._diretoria_context(sb, agent_id)
            if ctx:
                system += "\n\n═══ CONTEXTO VIVO (dados reais do House agora) ═══\n" + ctx
        elif agent_id == "gestor_trafego":
            ctx = CH._gestor_context(sb)
            if ctx:
                system += "\n\n═══ CONTEXTO VIVO (dados reais agora) ═══\n" + ctx
    except Exception as e:
        print(f"[ordens] contexto {agent_id}: {e}")
    keys = {
        "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY") or CH._get_setting(sb, "anthropic_api_key"),
        "gemini_api_key": os.environ.get("GEMINI_API_KEY") or CH._get_setting(sb, "gemini_api_key"),
        "openai_api_key": os.environ.get("OPENAI_API_KEY") or CH._get_setting(sb, "openai_api_key"),
    }
    primary = os.environ.get("AI_PREFER") or agent.get("primary", "gemini")
    chain = [primary] + [p for p in ["gemini", "claude", "openai"] if p != primary]
    pedido = (
        f"O sócio Paulo te DELEGOU esta ordem do Briefing da semana {semana}:\n\n\"{ordem_txt}\"\n\n"
        "Entregue AGORA, em markdown, direto e concreto:\n"
        "1) **O que eu já entrego** — o que você mesmo produz neste momento (análise, texto, lista, roteiro, números).\n"
        "2) **Plano de execução** — passos numerados, cada um com quem faz e até quando.\n"
        "3) **Depende de gente** — o que só um humano pode fazer e de quem (nome ou cargo).\n"
        "4) **Como saber se deu certo** — 1 a 3 números para conferir na semana que vem.\n"
        "Use só dados que você tem no contexto. Não invente número."
    )
    out = CH._try_chain(chain, system, [{"role": "user", "content": pedido}], keys) or {}
    return (out.get("text") or "").strip(), out.get("provider"), out.get("error")


def delegar(sb, actor, i, tipo, alvo, prazo=None):
    ordens = ler(sb)
    itens = ordens.get("itens") or []
    if not (0 <= i < len(itens)):
        raise ValueError("ordem não encontrada — atualize a tela")
    o = itens[i]
    if o.get("task_id") and not o.get("feito"):
        raise ValueError("esta ordem já tem dono — conclua ou marque como feita antes de redelegar")
    prazo = prazo or _prazo_padrao()
    semana = ordens.get("semana") or ""
    txt = o.get("txt") or ""

    if tipo in ("socio", "usuario"):
        dono_id = actor.get("id") if tipo == "socio" else alvo
        nomes = {u["id"]: u["nome"] for u in usuarios_ativos(sb)}
        if dono_id not in nomes:
            raise ValueError("usuário não encontrado ou inativo")
        tid = _criar_tarefa(sb, actor, dono_id, "Ordem do Briefing: " + txt,
                            f"{txt}\n\nOrdem da semana {semana} (Briefing · Inteligência).\nOnde ver: #/briefing-guerra", prazo)
        o.update({"dono": {"tipo": tipo, "id": dono_id, "nome": nomes[dono_id]}, "prazo": prazo, "task_id": tid,
                  "delegado_em": datetime.now(timezone.utc).isoformat(), "delegado_por": actor.get("id")})
        if dono_id != actor.get("id"):
            notify(dono_id, "briefing_ordem", "📋 Ordem da semana pra você", f"{txt[:180]} · prazo {prazo}",
                   link="#/", target_type="task", target_id=tid)
    elif tipo == "agente":
        if alvo not in _AGENTE_NOME:
            raise ValueError("agente inválido")
        texto, provider, err = _rodar_agente(sb, alvo, txt, semana)
        if not texto:
            raise RuntimeError("o agente não respondeu" + (f": {err}" if err else ""))
        tid = _criar_tarefa(sb, actor, actor.get("id"), f"Validar entrega do {_AGENTE_NOME[alvo]}: {txt}",
                            f"O {_AGENTE_NOME[alvo]} entregou o plano desta ordem. Leia em #/briefing-guerra, "
                            f"execute/aprove e marque a ordem como feita.\n\nOrdem: {txt}", prazo)
        o.update({"dono": {"tipo": "agente", "id": alvo, "nome": _AGENTE_NOME[alvo]}, "prazo": prazo, "task_id": tid,
                  "entrega": texto[:8000], "entrega_modelo": provider,
                  "delegado_em": datetime.now(timezone.utc).isoformat(), "delegado_por": actor.get("id")})
    else:
        raise ValueError("tipo deve ser socio, usuario ou agente")
    o["feito"] = False
    gravar(sb, ordens)
    return sincronizar_status(sb, ordens)


def marcar_feita(sb, i):
    ordens = ler(sb)
    o = (ordens.get("itens") or [])[i]
    o["feito"] = not o.get("feito")
    if o.get("task_id"):
        try:
            sb.table("dir_tasks").update({"status": "concluida" if o["feito"] else "aberta"}).eq("id", o["task_id"]).execute()
        except Exception as e:
            print(f"[ordens] fechar tarefa: {e}")
    gravar(sb, ordens)
    return sincronizar_status(sb, ordens)

