"""
POST /api/v3/ia/chat
Body: { agent: 'vera|sol|sr_performance|sr_gerencia', messages: [{role, content}] }
Header: Authorization: Bearer <token>

Roteador unificado pras 4 IAs PSM. Cada agent tem prompt system específico
e provider preferido (Claude/Gemini/OpenAI). Fallback automático se um falha.

Não armazena histórico (frontend gerencia). Audit log conta uso.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client  # type: ignore


# ─── Agents config ─────────────────────────────────────────────────────
AGENTS = {
    "vera": {
        "name": "Vera",
        "ico": "💜",
        "tagline": "Especialista em vendas e estratégia comercial",
        "system": (
            "Você é Vera, assistente IA da PSM Imobiliária especializada em "
            "vendas e estratégia comercial. Responda em português, direto ao ponto, "
            "tom profissional mas próximo. Use bullets quando apropriado. "
            "Foque em soluções acionáveis pra corretores e gestão comercial."
        ),
        "primary": "claude",
    },
    "sol": {
        "name": "Sol",
        "ico": "☀️",
        "tagline": "Auxiliar de Marketing e copywriting",
        "system": (
            "Você é Sol, assistente IA de marketing imobiliário da PSM. "
            "Especialidade: copywriting persuasivo, posts pra Instagram, "
            "campanhas Meta Ads, descrições de imóveis. Tom claro, otimista, "
            "estratégico. Sempre em português."
        ),
        "primary": "claude",
    },
    "sr_performance": {
        "name": "Sr. Performance",
        "ico": "🤖",
        "tagline": "Analytics e performance de mídia",
        "system": (
            "Você é Sr. Performance, assistente IA analítico da PSM. "
            "Especialidade: análise de KPIs, performance Meta Ads, ROAS, CPL, "
            "diagnósticos de campanha. Responda com dados, sugira hipóteses, "
            "proponha ações específicas. Português, tom técnico mas claro."
        ),
        "primary": "gemini",
    },
    "sr_gerencia": {
        "name": "Sr. Gerência",
        "ico": "👔",
        "tagline": "Liderança e gestão de equipe",
        "system": (
            "Você é Sr. Gerência, assistente IA da PSM focado em liderança "
            "e gestão de equipe comercial. Ajuda gerentes/líderes em decisões "
            "de pessoal, alocação, metas, conversas difíceis. Português, "
            "tom maduro e prático."
        ),
        "primary": "claude",
    },
    # v86.91: tutor da PSM Academy — tira dúvidas do corretor com base no
    # currículo real das trilhas (academy_items) + base extra do sócio
    # (shared_kv academy_config.tutor_extra). Contexto injetado no do_POST.
    "professor": {
        "name": "Professor PSM",
        "ico": "👨‍🏫",
        "tagline": "Tutor da PSM Academy — tira dúvidas da formação",
        "system": (
            "Você é o Professor PSM, tutor oficial da PSM Academy — a escola "
            "interna da PSM Assessoria Imobiliária (São José do Rio Preto/SP, "
            "marcas PSM Conquista/MCMV e PSM Imóveis/alto padrão). "
            "Sua missão: formar corretores do zero ao expert. Responda dúvidas "
            "sobre mercado imobiliário, vendas, MCMV, financiamento Caixa, FGTS, "
            "documentação, direito imobiliário básico, locação, marketing e rotina "
            "do corretor. Sempre em português BR, tom didático e encorajador de "
            "professor particular: explique como se o aluno fosse iniciante, use "
            "exemplos práticos do dia a dia do corretor, e feche com uma dica "
            "acionável ou pergunta que estimule o próximo passo do estudo. "
            "Quando a dúvida bater com uma aula da ementa (fornecida abaixo), "
            "indique a trilha/módulo onde o aluno aprofunda. Se não souber com "
            "segurança (ex.: regra que muda com frequência), diga que precisa "
            "confirmar e oriente onde verificar — nunca invente número de lei, "
            "taxa ou faixa de renda."
        ),
        "primary": "claude",
    },
    # v86.92: Sala de Treino — a IA vira o CLIENTE e o corretor treina na prática.
    # Persona do cenário (TREINO_CENARIOS) é anexada ao system no do_POST.
    "sala_treino": {
        "name": "Sala de Treino",
        "ico": "🥊",
        "tagline": "Role-play: a IA é o cliente, você é o corretor",
        "system": (
            "Você está numa simulação de treino de vendas imobiliárias da PSM "
            "(São José do Rio Preto/SP). Você interpreta um CLIENTE (persona "
            "descrita abaixo) e o usuário é o CORRETOR em treinamento. Regras "
            "invioláveis: (1) NUNCA saia do personagem, nunca dê aula, nunca "
            "elogie ou corrija o corretor — você é só o cliente; (2) responda "
            "como gente real no WhatsApp: mensagens CURTAS (1 a 3 frases), "
            "português coloquial BR, sem listas nem formatação; (3) seja "
            "realista e desafiador — só ceda terreno quando o corretor usar "
            "técnica boa de verdade (pergunta aberta, escuta, valor antes de "
            "preço, contorno bem feito); se ele for fraco, genérico ou "
            "apressado, fique mais resistente, enrole ou ameace encerrar; "
            "(4) mantenha os fatos da persona coerentes a conversa inteira; "
            "(5) se o corretor conduzir muito bem por várias mensagens, o "
            "cliente pode avançar (aceitar visita, pedir simulação, sinalizar "
            "fechamento) — nunca de graça."
        ),
        "primary": "claude",
    },
    # v87.5: Gestor de Tráfego — especialista sênior de mídia paga das 2 marcas.
    # Contexto vivo (Meta cache + CRM + config editável) injetado no do_POST.
    "gestor_trafego": {
        "name": "Sr. Tráfego",
        "ico": "🚦",
        "tagline": "Gestor de Tráfego sênior — Meta Ads, públicos e estratégia",
        "system": (
            "Você é o Sr. Tráfego, gestor de tráfego pago SÊNIOR da PSM Assessoria "
            "Imobiliária (São José do Rio Preto/SP). Gerencia as duas marcas: "
            "PSM CONQUISTA (volume MCMV — empreendimentos na planta em Rio Preto, "
            "Mirassol e Bady Bassitt, público de renda R$ 2-8 mil, lead via "
            "formulário/WhatsApp) e PSM IMÓVEIS (alto padrão, quiet luxury, NEPQ, "
            "ticket R$ 600 mil+). Nível de especialista: domina Meta Ads (estrutura "
            "de campanha, CBO/ABO, leilão, criativo, Advantage+, públicos "
            "personalizados e semelhantes, pixel/CAPI, Lead Ads), Instagram, "
            "Facebook, WhatsApp e a leitura de funil completo até a venda no CRM. "
            "REGRAS: (1) responda SEMPRE com base nos DADOS REAIS do contexto "
            "abaixo — cite números (gasto, CPL, leads, CTR) ao diagnosticar; se um "
            "dado não estiver no contexto, diga que falta e como obtê-lo, nunca "
            "invente; (2) pense como dono do orçamento: cada recomendação vem com "
            "ação concreta, impacto esperado e prioridade; (3) CPL alvo Conquista "
            "e verba são os da ESTRATÉGIA VIGENTE do contexto (se definida); "
            "(4) ações executáveis no House (pausar/reativar campanha, ajustar "
            "orçamento) respeitam guardrails e só o sócio executa — quando "
            "recomendar uma, aponte que dá pra executar na aba Ações; (5) para "
            "públicos, use a base RD do contexto (segmentos, listas) e proponha "
            "seeds de semelhantes e exclusões; (6) português BR, direto, técnico "
            "mas claro, formato executivo (bullets, negrito no que importa)."
        ),
        "primary": "gemini",
    },
    "treino_nota": {
        "name": "Avaliador da Sala de Treino",
        "ico": "📋",
        "tagline": "Corrige o treino e dá a nota",
        "system": (
            "Você é o avaliador oficial da Sala de Treino da PSM Academy. Vai "
            "receber a transcrição de um role-play entre um corretor em "
            "treinamento e um cliente simulado, com a descrição do cenário. "
            "Avalie SOMENTE o desempenho do CORRETOR: rapport, perguntas de "
            "descoberta, escuta ativa, apresentação de valor, contorno de "
            "objeções, condução/fechamento e postura profissional. Seja justo "
            "mas exigente (nota 8+ só pra desempenho realmente forte). "
            "Responda APENAS com JSON válido, sem markdown, neste formato: "
            '{"nota": 0.0 a 10, "resumo": "1 frase direta", '
            '"fortes": ["até 3 pontos"], "melhorar": ["até 3 pontos, cada um '
            'com o que fazer diferente"], "trilha": "trilha da PSM Academy '
            'mais indicada pra evoluir (ex.: Vendas, PNL, Lançamentos MCMV, '
            "Lançamentos M.A.P, Locação)\"}"
        ),
        "primary": "claude",
    },
}

# ─── Cenários da Sala de Treino (persona que a IA interpreta) ──────────
TREINO_CENARIOS = {
    "mcmv_inseguro": {
        "nome": "Cliente MCMV inseguro", "ico": "😰🏠",
        "persona": (
            "PERSONA: Marcos, 28 anos, casado com a Ana, primeiro filho a caminho. "
            "CLT, R$ 3.200/mês; a esposa faz bico. Sonha em sair do aluguel "
            "(paga R$ 1.100) mas MORRE DE MEDO: acha que não aprova crédito, teve "
            "o nome negativado ano passado (já limpou), não sabe o que é subsídio "
            "nem FGTS direito, e o pai dele fala que 'financiamento é furada, você "
            "paga 3 casas pra ter 1'. Quer acreditar, mas qualquer termo técnico "
            "sem explicação o assusta. Começa a conversa interessado porém "
            "desconfiado, respondendo curto."
        ),
    },
    "map_frio": {
        "nome": "Cliente alto padrão frio (NEPQ)", "ico": "🥶💼",
        "persona": (
            "PERSONA: Dr. Ricardo, 52 anos, cirurgião, patrimônio alto, já teve "
            "várias experiências ruins com corretor insistente. Seco, educado e "
            "sem tempo: respostas de poucas palavras, testa a autoridade do "
            "corretor com perguntas técnicas (m², padrão construtivo, liquidez, "
            "comparativo com outro lançamento). DETESTA pressa e elogio vazio — "
            "se sentir venda empurrada, encerra ('me manda por escrito, depois "
            "vejo'). Só se abre com quem faz perguntas inteligentes sobre o que "
            "ELE quer (estilo NEPQ) e demonstra conhecimento real de mercado."
        ),
    },
    "exclusividade": {
        "nome": "Proprietário contra exclusividade", "ico": "🔑🙅",
        "persona": (
            "PERSONA: Dona Vera, 61 anos, aposentada, quer vender a casa de "
            "R$ 480 mil pra ficar perto dos netos. Convicção firme: 'quanto mais "
            "imobiliária divulgando, mais rápido vende' — já deu a casa pra 4 "
            "imobiliárias sem exclusividade e está há 8 meses sem proposta séria, "
            "mas culpa o mercado. Desconfia que exclusividade é 'prender o imóvel'. "
            "Conversadora, conta histórias, foge do assunto. Só considera assinar "
            "se o corretor mostrar com clareza O QUE ela ganha (plano de "
            "divulgação, filtro de curioso, preço defendido) — e mesmo assim "
            "negocia prazo."
        ),
    },
    "ta_caro": {
        "nome": "Objeção: 'tá caro'", "ico": "💸😬",
        "persona": (
            "PERSONA: Júlia (31) e Pedro (33), casal, renda conjunta R$ 12 mil. "
            "Visitaram o apartamento anteontem e AMARAM (varanda, região, lazer), "
            "mas Pedro ancorou: 'vale no máximo R$ 40 mil a menos'. Comparam com "
            "um concorrente mais barato (que tem menos área e fica longe do "
            "trabalho da Júlia — eles omitem isso se o corretor não perguntar). "
            "Júlia quer fechar, Pedro segura. Repetem 'tá caro' e 'vamos pensar' "
            "sempre que o corretor fala de preço sem reforçar valor. Cedem apenas "
            "se o corretor separar preço de custo/valor, usar a dor do aluguel "
            "atual e criar urgência honesta (unidade/tabela)."
        ),
    },
    "lead_sumido": {
        "nome": "Lead que sumiu (follow-up)", "ico": "👻📱",
        "persona": (
            "PERSONA: Fernanda, 35, analista de RH, visitou um apê há 12 dias, "
            "demonstrou interesse e depois PAROU de responder. Motivo real (não "
            "conte de cara): levou um susto com o valor das parcelas e ficou com "
            "vergonha de dizer; além disso a irmã falou 'espera a Selic cair'. "
            "A conversa começa com o corretor puxando o follow-up — responda "
            "inicialmente com frieza educada ('oi! então, tô meio corrida…'). "
            "Reabra a conversa só se o corretor NÃO pressionar e trouxer algo "
            "novo de valor (condição, unidade parecida mais barata, informação "
            "útil). Pressão direta = 'qualquer coisa te chamo, tá?'"
        ),
    },
}


def _professor_context(sb):
    """Monta o contexto do Professor PSM: ementa real das trilhas (academy_items)
    + base de conhecimento extra do sócio (academy_config.tutor_extra).
    Capado em ~20k chars pra não estourar o prompt."""
    if not sb:
        return ""
    parts = []
    try:
        rows = sb.table("shared_kv").select("value").eq("key", "academy_config").limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        extra = (v.get("tutor_extra") or "").strip() if isinstance(v, dict) else ""
        if extra:
            parts.append("BASE DE CONHECIMENTO PSM (fornecida pela diretoria — use como fonte primária):\n" + extra[:12000])
    except Exception:
        pass
    try:
        rows = (sb.table("academy_items")
                .select("trilha,nivel,modulo,titulo,conteudo")
                .order("trilha").order("ordem").limit(1000).execute().data or [])
        if rows:
            outline, budget = [], 8000
            cur_t, cur_m = None, None
            for r in rows:
                t, m = r.get("trilha") or "Geral", r.get("modulo") or ""
                if t != cur_t:
                    outline.append(f"\n## Trilha: {t}")
                    cur_t, cur_m = t, None
                if m and m != cur_m:
                    outline.append(f"### {r.get('nivel') or ''} · {m}")
                    cur_m = m
                outline.append(f"- {r.get('titulo') or ''}")
            ementa = "\n".join(outline)[:budget]
            parts.append("EMENTA DA PSM ACADEMY (trilhas e aulas disponíveis — cite-as ao indicar onde estudar):" + ementa)
            # conteúdo inline das aulas (material didático real), até caber
            budget2 = 8000
            chunks = []
            for r in rows:
                c = (r.get("conteudo") or "").strip()
                if not c:
                    continue
                piece = f"\n[{r.get('trilha')}] {r.get('titulo')}:\n{c[:1200]}"
                if budget2 - len(piece) < 0:
                    break
                budget2 -= len(piece)
                chunks.append(piece)
            if chunks:
                parts.append("MATERIAL DAS AULAS (trechos):" + "".join(chunks))
    except Exception:
        pass
    return ("\n\n".join(parts))[:22000]


def _gestor_context(sb):
    """Contexto vivo do Sr. Tráfego: config editável (gt_config), métricas Meta
    do cache compartilhado (7d/30d), regras de alerta, públicos/listas e um
    snapshot do funil RD. Tudo best-effort, capado em ~20k chars."""
    if not sb:
        return ""
    parts = []

    def _kv(key):
        try:
            rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
            v = rows[0]["value"] if rows else {}
            if isinstance(v, str):
                v = json.loads(v)
            return v if isinstance(v, (dict, list)) else {}
        except Exception:
            return {}

    # 1) Config editável do sócio (persona extra, estratégia, conhecimento)
    cfg = _kv("gt_config")
    if isinstance(cfg, dict):
        if cfg.get("persona_extra"):
            parts.append("AJUSTE DE PERSONA (definido pelo sócio — obedeça):\n" + str(cfg["persona_extra"])[:4000])
        est = cfg.get("estrategia") or {}
        if isinstance(est, dict) and (est.get("conquista") or est.get("imoveis")):
            parts.append("ESTRATÉGIA VIGENTE:\n[PSM Conquista] " + str(est.get("conquista") or "—")[:4000] +
                         "\n[PSM Imóveis] " + str(est.get("imoveis") or "—")[:4000])
        if cfg.get("conhecimento_extra"):
            parts.append("BASE DE CONHECIMENTO EXTRA:\n" + str(cfg["conhecimento_extra"])[:6000])
        mc = cfg.get("metricas_custom") or []
        if mc:
            parts.append("MÉTRICAS PERSONALIZADAS ACOMPANHADAS:\n" +
                         "\n".join(f"- {m.get('nome')}: {m.get('descricao')}" for m in mc[:20] if isinstance(m, dict)))
        g = cfg.get("guardrails") or {}
        if g:
            parts.append("GUARDRAILS DE AÇÃO (limites que o sócio definiu): " + json.dumps(g, ensure_ascii=False))

    # 2) Métricas Meta do cache compartilhado (nunca chama a Graph aqui)
    def _meta_janela(preset):
        try:
            rows = (sb.table("meta_ads_cache").select("payload,refreshed_at")
                    .eq("cache_key", preset + "||").limit(1).execute().data or [])
            p = rows[0].get("payload") if rows else None
            if not isinstance(p, dict):
                return None
            tot = ((p.get("totals") or {}).get("cur")) or {}
            spend = float(tot.get("spend") or 0)
            res = int(tot.get("results") or 0)
            linhas = [f"{preset}: gasto R$ {spend:,.0f} · {res} leads · CPL R$ {spend / res:,.2f}" if res
                      else f"{preset}: gasto R$ {spend:,.0f} · 0 leads"]
            camps = sorted([c for c in (p.get("campaigns") or []) if float(c.get("spend") or 0) > 0],
                           key=lambda c: -float(c.get("spend") or 0))[:12]
            for c in camps:
                cs, cr = float(c.get("spend") or 0), int(c.get("results") or 0)
                linhas.append(f"  - [{c.get('account') or ''}] {str(c.get('name') or '')[:70]} ({c.get('status') or ''}): "
                              f"R$ {cs:,.0f} · {cr} leads · CPL {'R$ %.2f' % (cs / cr) if cr else '—'} · CTR {c.get('ctr') or 0}")
            return "\n".join(linhas)
        except Exception:
            return None
    metas = [m for m in (_meta_janela("last_7d"), _meta_janela("last_30d")) if m]
    if metas:
        parts.append("META ADS AGORA (cache compartilhado, por campanha):\n" + "\n".join(metas))

    # 3) Alertas configurados
    regras = (_kv("gt_alertas") or {}).get("regras") if isinstance(_kv("gt_alertas"), dict) else None
    regras = regras or []
    if regras:
        parts.append("REGRAS DE ALERTA CONFIGURADAS:\n" + "\n".join(
            f"- {r.get('nome') or r.get('metrica')}: {r.get('metrica')} {r.get('op')} {r.get('valor')} "
            f"({r.get('janela')}, {r.get('severidade')}, {'ativo' if r.get('ativo', True) else 'inativo'})"
            for r in regras[:40] if isinstance(r, dict)))

    # 4) Públicos planejados + listas/mailings disponíveis
    planos = (_kv("gt_publicos") or {}).get("planos") or []
    if planos:
        parts.append("PLANOS DE PÚBLICO:\n" + "\n".join(
            f"- [{p.get('marca')}] {p.get('nome')} ({p.get('tipo')}, {p.get('status')}): {str(p.get('definicao') or '')[:150]}"
            for p in planos[:30] if isinstance(p, dict)))
    listas = (_kv("gt_listas_idx") or {}).get("listas") or []
    if listas:
        parts.append("LISTAS/MAILINGS DISPONÍVEIS (upload do sócio):\n" + "\n".join(
            f"- {l.get('nome')} ({l.get('n')} contatos, marca {l.get('marca')}, origem: {l.get('origem')})"
            for l in listas[:30] if isinstance(l, dict)))

    # 5) Snapshot do funil RD (base p/ públicos e leitura de fundo de funil)
    try:
        agg = {}
        rows = (sb.table("deals").select("pipeline_name,win")
                .order("updated_at_rd", desc=True).limit(3000).execute().data or [])
        for d in rows:
            k = (d.get("pipeline_name") or "?")[:40]
            a = agg.setdefault(k, {"aberto": 0, "ganho": 0, "perdido": 0})
            a["ganho" if d.get("win") is True else ("perdido" if d.get("win") is False else "aberto")] += 1
        if agg:
            parts.append("BASE RD CRM (últimos 3.000 deals, por funil):\n" + "\n".join(
                f"- {k}: {v['aberto']} abertos · {v['ganho']} ganhos · {v['perdido']} perdidos"
                for k, v in sorted(agg.items(), key=lambda kv: -sum(kv[1].values()))[:15]))
    except Exception:
        pass

    return ("\n\n".join(parts))[:22000]


def _get_setting(sb, key):
    """Pega chave do shared_kv psm_os_settings."""
    if not sb: return None
    try:
        row = sb.table("shared_kv").select("value").eq("key", "psm_os_settings").limit(1).execute().data or []
        if not row: return None
        v = row[0].get("value") or {}
        return v.get(key) if isinstance(v, dict) else None
    except Exception:
        return None


def _call_claude(api_key, system, messages):
    """Chama Anthropic Messages API."""
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": "claude-3-5-sonnet-20241022",
        "max_tokens": 1024,
        "system": system,
        "messages": [{"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")],
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    content = data.get("content") or []
    text = "".join(c.get("text", "") for c in content if c.get("type") == "text")
    return {"text": text, "provider": "claude", "model": data.get("model"), "usage": data.get("usage")}


def _call_gemini(api_key, system, messages):
    """Chama Google Gemini generateContent. Modelo via env (GEMINI_SMART_MODEL,
    default gemini-2.5-flash) e auth via header x-goog-api-key — funciona com
    chaves AIza… E AQ.… (o método antigo ?key= rejeitava a chave nova)."""
    model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    # Gemini: sem system separado, prefixa na primeira user message
    contents = []
    if messages and system:
        first = messages[0]
        if first.get("role") == "user":
            messages = [{"role": "user", "content": f"[Sistema]: {system}\n\n[Usuário]: {first['content']}"}] + messages[1:]
    for m in messages:
        if m.get("role") not in ("user", "assistant"): continue
        contents.append({
            "role": "model" if m["role"] == "assistant" else "user",
            "parts": [{"text": m["content"]}],
        })
    payload = {"contents": contents, "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.7}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    cands = data.get("candidates") or []
    if not cands: return {"text": "", "provider": "gemini", "error": "no candidates"}
    parts = cands[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts)
    return {"text": text, "provider": "gemini", "model": model}


def _call_openai(api_key, system, messages):
    """Fallback OpenAI."""
    url = "https://api.openai.com/v1/chat/completions"
    msgs = [{"role": "system", "content": system}]
    for m in messages:
        if m.get("role") in ("user", "assistant"):
            msgs.append({"role": m["role"], "content": m["content"]})
    payload = {"model": "gpt-4o-mini", "messages": msgs, "max_tokens": 1024}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
        "Authorization": "Bearer " + api_key,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    choices = data.get("choices") or []
    text = choices[0]["message"]["content"] if choices else ""
    return {"text": text, "provider": "openai", "model": payload["model"], "usage": data.get("usage")}


def _try_chain(providers, system, messages, keys):
    """Tenta providers em ordem; retorna primeiro sucesso ou último erro."""
    last_err = None
    for prov in providers:
        try:
            if prov == "claude" and keys.get("anthropic_api_key"):
                return _call_claude(keys["anthropic_api_key"], system, messages)
            if prov == "gemini" and keys.get("gemini_api_key"):
                return _call_gemini(keys["gemini_api_key"], system, messages)
            if prov == "openai" and keys.get("openai_api_key"):
                return _call_openai(keys["openai_api_key"], system, messages)
        except Exception as e:
            last_err = f"{prov}: {e}"
            continue
    return {"text": "", "provider": None, "error": last_err or "nenhum provider disponível"}


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
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        agent_id = (body.get("agent") or "").strip().lower()
        messages = body.get("messages") or []

        if agent_id not in AGENTS:
            return self._send(400, {"ok": False, "error": f"agent inválido. Use: {sorted(AGENTS.keys())}"})
        if not messages or not isinstance(messages, list):
            return self._send(400, {"ok": False, "error": "messages[] obrigatório"})
        if len(messages) > 50:
            return self._send(400, {"ok": False, "error": "max 50 messages"})

        agent = AGENTS[agent_id]

        # v87.5: Sr. Tráfego carrega verba/estratégia/base no contexto — líder+ apenas
        if agent_id == "gestor_trafego" and (user.get("lvl") or 0) < 5:
            return self._send(403, {"ok": False, "error": "Sr. Tráfego é restrito à gestão (lvl 5+)"})

        # Carrega keys
        sb = supabase_client()
        # ENV primeiro (fonte de verdade que o /api/ai-analysis já usa e funciona);
        # settings só como fallback. Antes era settings-first → uma chave velha na
        # tabela sobrescrevia a chave boa do env e derrubava o chat dos agentes.
        keys = {
            "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY") or _get_setting(sb, "anthropic_api_key"),
            "gemini_api_key":    os.environ.get("GEMINI_API_KEY")    or _get_setting(sb, "gemini_api_key"),
            "openai_api_key":    os.environ.get("OPENAI_API_KEY")    or _get_setting(sb, "openai_api_key"),
        }

        # Chain de fallback: AI_PREFER (env) tem prioridade sobre o primary do agent.
        # Como a conta Anthropic está sem saldo, o padrão favorece gemini (2.5-flash).
        primary = os.environ.get("AI_PREFER") or agent.get("primary", "gemini")
        chain = [primary] + [p for p in ["gemini", "claude", "openai"] if p != primary]

        system = agent["system"]
        if agent_id == "professor":
            ctx = _professor_context(sb)
            if ctx:
                system = system + "\n\n" + ctx
        elif agent_id == "gestor_trafego":
            ctx = _gestor_context(sb)
            if ctx:
                system = system + "\n\n═══ CONTEXTO VIVO (dados reais agora) ═══\n" + ctx
        elif agent_id == "sala_treino":
            cen = TREINO_CENARIOS.get((body.get("cenario") or "").strip())
            if not cen:
                return self._send(400, {"ok": False, "error": f"cenario inválido. Use: {sorted(TREINO_CENARIOS)}"})
            system = system + "\n\n" + cen["persona"]
        elif agent_id == "treino_nota":
            cen = TREINO_CENARIOS.get((body.get("cenario") or "").strip())
            if cen:
                system = system + "\n\nCENÁRIO TREINADO: " + cen["nome"] + " — " + cen["persona"]

        t0 = time.time()
        result = _try_chain(chain, system, messages, keys)
        dur = round(time.time() - t0, 2)

        if not result.get("text"):
            return self._send(502, {"ok": False, "error": result.get("error") or "sem resposta", "agent": agent_id})

        # Audit (sem o texto inteiro; só metadata)
        last_user_msg = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
        audit(self, user, "ia.chat", target_type="ia", target_id=agent_id,
              notes=f"provider={result.get('provider')} chars_in={len(last_user_msg)} chars_out={len(result['text'])} {dur}s")

        return self._send(200, {
            "ok": True,
            "agent": agent_id,
            "agent_meta": {"name": agent["name"], "ico": agent["ico"], "tagline": agent["tagline"]},
            "reply": result["text"],
            "provider": result.get("provider"),
            "model": result.get("model"),
            "duration_s": dur,
        })


# Endpoint utilitário pra UI listar agents
class _ignore_handler:
    """Dummy pra evitar warnings; Vercel só usa 'handler'."""
    pass


def get_agents_list():
    """Helper exportável."""
    return [{"id": k, **v} for k, v in AGENTS.items()]
