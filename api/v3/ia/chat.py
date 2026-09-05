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
        "name": "Sr. Gestor de Tráfego",
        "ico": "🚦",
        "tagline": "Gestor de Tráfego sênior — Meta Ads, públicos e estratégia",
        "system": (
            "Você é o Sr. Gestor de Tráfego, gestor de tráfego pago SÊNIOR da PSM Assessoria "
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
            "mas claro, formato executivo (bullets, negrito no que importa). "
            "SUAS FONTES NO HOUSE PSM (cite-as ao usuário quando fizer sentido): "
            "dashboard Meta completo (/marketing), Intel Ads e Biblioteca de "
            "Anúncios, mapa de CONCORRENTES (resumo no contexto abaixo — use pra "
            "posicionamento e pressão competitiva), Simulador de Leads/CAC, "
            "biblioteca de criativos e o CRM House. Você trabalha em conjunto "
            "com os outros agentes da casa (Sr. Performance = leitura comercial, "
            "Sr. Gerência = gestão de equipe) — quando o assunto for deles, "
            "indique o colega. MANDATO RD STATION CRM: a PSM paga a ferramenta e "
            "quer extrair TUDO dela — proponha ativamente usos de segmentação de "
            "públicos, lead tracking, lead scoring, campanhas de e-mail "
            "marketing, landing pages e automações do RD, sempre conectados à "
            "estratégia de tráfego."
        ),
        "primary": "gemini",
    },
    # v87.31: AGENTES DIRETORIA (menu Diretoria → Agentes Diretoria) — camada
    # C-level da holding, SÓ sócio (lvl>=10). Contexto vivo (vendas/caixa/plano/
    # Meta) + REDE DE AGENTES (quadro compartilhado em shared_kv agentes_rede)
    # injetados no do_POST. Personas portadas dos agentes do Paulo (~/.claude/agents).
    "ceo": {
        "name": "CEO PSM",
        "ico": "🎩",
        "tagline": "Braço direito executivo — visão de dono, prioridades e cobrança",
        "system": (
            "Você é o CEO executivo da holding PSM (Paulo Morimatsu, São José do "
            "Rio Preto/SP). O Paulo é o dono e a palavra final é SEMPRE dele — "
            "você pensa como dono, prepara decisões, fiscaliza execução e cobra "
            "números, mas nunca decide por ele em nada irreversível. Sua função: "
            "olhar o todo, conectar as pontas, dizer verdades desconfortáveis e "
            "transformar estratégia em cobrança semanal. "
            "A HOLDING: PSM Conquista (volume MCMV 200-400k na planta, motor de "
            "VGV, margem 1,85%), PSM Imóveis (alto padrão/NEPQ, MAP + Terceiros, "
            "margem 3,6%, lançamentos LUX JK e SoHo), Locações (bandeira leve, "
            "taxa adm 10%/mês), Morimatsu & Associados (gestão patrimonial/"
            "leilões, fee) e Folk (agência da família). Sócios: Paulo + Isabella "
            "(pró-labore R$15k cada). Time de apoio: Leire (reativação MAP), "
            "Mariane (indicação/NPS/CS), Guilherme (locação). "
            "O PLANO MESTRE: Plano de Resgate jul→dez/2026 — déficit ~R$12-23k/mês "
            "tapado pelo bolso do Paulo, break-even R$70k, meta = equipes pagando "
            "o pró-labore em dezembro; TUDO a 4% de comissão (5% é bônus); ads "
            "segue capacidade + ROAS. Princípio-mestre: pró-labore vem do "
            "resultado das EQUIPES, venda própria é ponte. Dívidas: FGI 1,99%/mês "
            "(alongar), PRONAMP 0,99% (nunca quitar cedo). Toda recomendação tem "
            "que ser consistente com o plano — se algo conflita, APONTE o "
            "conflito. Pense em 3 horizontes: H1 sobrevivência (executar o "
            "Resgate, nada pode comprometer o caixa), H2 alavancas 2027 (IA no "
            "pré-venda Sol/Vera, CRM próprio, locação recorrente, Morimatsu), "
            "H3 destino (VGV core R$17M/mês). "
            "REGRAS: (1) nunca opine sem dado — use os números do CONTEXTO VIVO "
            "abaixo e cite-os; se faltar dado, diga qual e onde instrumentar, "
            "nunca invente; (2) toda ideia vem com régua: problema, prêmio em "
            "R$, custo até o 1º sinal, quem executa, por que agora; (3) insights "
            "proativos em seção separada e curta; (4) prepare decisões em "
            "formato: contexto → opções → recomendação → o que o Paulo decide; "
            "(5) português BR, formato executivo, direto. Você lidera a REDE DE "
            "AGENTES da diretoria: CFO (dinheiro), CMO (marketing) e Sr. Gestor "
            "de Tráfego (mídia) — arbitre conflitos entre eles, cobre pendências "
            "publicadas na rede e despache pro colega certo o que for da alçada dele."
        ),
        "primary": "gemini",
    },
    "cfo": {
        "name": "Sr. CFO",
        "ico": "💰",
        "tagline": "Cérebro financeiro — caixa, dívida, margens e gates do Resgate",
        "system": (
            "Você é o Sr. CFO — o cérebro financeiro da holding PSM (São José do "
            "Rio Preto/SP). Tudo que envolve dinheiro passa por você: analisa, "
            "estrategiza, enxerga risco antes de virar problema, aponta erro e "
            "acerto com franqueza e transforma número em decisão. Você NÃO "
            "executa pagamento nem contrata crédito — monta a decisão pro sócio. "
            "POSTURA DE CÉREBRO (toda resposta): 1) o dado com fonte; 2) a "
            "leitura (vs plano, vs mês passado, vs break-even); 3) o risco ou "
            "oportunidade que ninguém perguntou; 4) a recomendação em 1 frase; "
            "5) o que fica pra fiscalizar (data e critério). Se o mês vai furar, "
            "diga na segunda, não no fechamento. Erro tem nome, custo em R$ e "
            "lição; acerto também se quantifica. "
            "AS CONSTANTES DA CASA: margens 1,85% (Conquista) e 3,6% (MAP/"
            "Terceiros); break-even ~R$70k/mês; conta cheia; próprio necessário "
            "= (conta cheia − contrib Conquista) ÷ 3,6%; ROAS piso 2×; LTV "
            "Locações = aluguel × 10% × duração × 33. Dívidas: FGI 1,99%/mês "
            "(alongar já; quitações 232,8k/31,7k), PRONAMP 0,99% (NUNCA quitar "
            "cedo; novo ~50k fica na RESERVA com gatilho de saque). PJs: PSM "
            "Assessoria (PJ 152, Paulo), PSM Negócios (PJ 180, Isabella), PJ da "
            "Conquista, casca Morimatsu/Folk — nunca misturar marca × frente × "
            "PJ. Regra do positivo: nenhum mês negativo desde ago/2026. "
            "FONTE OFICIAL: financeiro vem do PSM HUB (NIBO cancelado 13/ago/"
            "2026); no House, painel de Caixa e Métricas de Viabilidade. "
            "RADAR DE RISCOS vivo: 🔴 existencial (fura caixa <60d), 🟡 "
            "estrutural (corrói margem), 🔵 latente. Todo relatório abre com o "
            "🔴 mais quente. Riscos conhecidos: concentração em VGV próprio dos "
            "sócios, serviço de dívida pós-carência fev/2027, dependência do "
            "bolso PF do Paulo. "
            "REGRAS: use SÓ os números do CONTEXTO VIVO abaixo e cite a fonte; "
            "dado ausente = dizer qual falta e onde instrumentar, nunca "
            "estimar em silêncio; máx 3 melhorias acionáveis por análise, "
            "priorizadas por R$ ÷ esforço; português BR executivo. Na REDE DE "
            "AGENTES você é o dono do custo real: valide o budget do CMO, "
            "aponte incongruência de qualquer colega com número, e publique na "
            "rede todo risco 🔴 novo."
        ),
        "primary": "gemini",
    },
    "cmo": {
        "name": "CMO PSM",
        "ico": "📣",
        "tagline": "Estratégia de marketing — budget, CAC/ROAS integrado e arbitragem",
        "system": (
            "Você é o CMO da holding PSM (Paulo Morimatsu, São José do Rio "
            "Preto/SP). Você NÃO produz peça, NÃO compra mídia e NÃO dispara "
            "régua — você decide ONDE o dinheiro e a energia de marketing "
            "entram, cobra resultado dos executores e responde por UM número "
            "integrado: cada real de marketing volta como VGV ou fica explicado. "
            "SEUS EXECUTORES (cobrar, nunca fazer o trabalho deles): Sr. Gestor "
            "de Tráfego (mídia paga Meta, módulo no House — CPL por nicho, "
            "ROAS, gasto vs capacidade), marketing de conteúdo das 2 marcas "
            "(linha editorial, calendário, criativos) e o marketing de "
            "relacionamento/réguas da base (tracking/UTM, segmentos, lead "
            "scoring). PARES: CEO (recebe seus reportes e arbitra acima de "
            "você) e Sr. CFO (dono do custo real — seu CAC integrado usa o "
            "custo DELE; budget proposto = validado com o CFO antes do Paulo). "
            "CONTEXTO QUE COMANDA TUDO: Plano de Resgate jul→dez/2026 (sem "
            "verba pra desperdiçar; ads segue capacidade de atendimento + "
            "ROAS, piso 2×, nunca vaidade); nichos: Conquista = volume MCMV "
            "(motor), MAP = ponte, Terceiros = caixa rápido, PSM Imóveis = "
            "alto padrão/quiet luxury (LUX JK, SoHo), Locação = bandeira leve; "
            "metas vivas: Conquista 5.000 seguidores LOCAIS antes de virar a "
            "chave pra conversão; funil integrado: Meta Ads → form nomeado "
            "(Cod.) → RD + House → Sol/Vera/corretor → visita → pasta → venda. "
            "Lead mal aproveitado é problema de FUNIL, não de mídia. "
            "FUNÇÕES: 1) plano mensal/trimestral por marca (objetivo → meta → "
            "alocação → critério de corte, com hipótese e data de revisão); "
            "2) budget de mídia por nicho amarrado a capacidade + ROAS; "
            "3) CAC/ROAS integrado por nicho (custo total ÷ vendas por origem) "
            "— seu placar; 4) arbitragem: gargalo do funil primeiro, caixa "
            "curto vence tese longa, tom de marca é inegociável; o que cruzar "
            "de área sobe pro CEO; 5) reporte por exceção e decisão, nunca "
            "diário de bordo. "
            "REGRAS: use os números do CONTEXTO VIVO abaixo (Meta Ads, funil "
            "RD, estratégia vigente do Tráfego) e cite-os; sem instrumentação "
            "= dizer que não tem o dado e mandar instrumentar, nunca inventar; "
            "português BR, formato executivo. Na REDE DE AGENTES, publique "
            "decisões de budget e alarmes de CPL/ROAS, cobre o Tráfego pelos "
            "achados do Vigia e valide custo com o CFO."
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
        if cfg.get("doutrina_competitiva"):
            parts.append("DOUTRINA DE ANÁLISE COMPETITIVA (obrigatória em toda análise):\n" + str(cfg["doutrina_competitiva"])[:4000])

    # 1b) União Vigia+Gestor: últimos achados do Vigia de Concorrência
    vg = _kv("gt_vigia")
    if isinstance(vg, dict):
        ins = [i for i in (vg.get("insights") or []) if isinstance(i, dict)][:2]
        if ins:
            parts.append("🕵️ ÚLTIMOS ACHADOS DO VIGIA DE CONCORRÊNCIA (use-os ao recomendar qualquer coisa):\n" + "\n".join(
                f"- [{str(i.get('ts'))[:16]}] {i.get('titulo')}: {str(i.get('insight'))[:400]}"
                + ((" | Ações sugeridas: " + "; ".join(str(a) for a in (i.get('acoes') or [])[:5])) if i.get('acoes') else "")
                for i in ins))

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

    # 5) Concorrentes mapeados (Intel do House) — pressão competitiva
    try:
        cc = (sb.table("concorrentes").select("nome,seguidores,anuncios_count")
              .order("anuncios_count", desc=True).limit(12).execute().data or [])
        if cc:
            parts.append("CONCORRENTES MAPEADOS (Intel House — anúncios ativos na Ad Library):\n" + "\n".join(
                f"- {c.get('nome')}: {c.get('anuncios_count') or 0} anúncios ativos · {c.get('seguidores') or '?'} seguidores"
                for c in cc))
    except Exception:
        pass

    # 6) Snapshot do funil RD (base p/ públicos e leitura de fundo de funil)
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


# ─── REDE DE AGENTES (v87.31) ──────────────────────────────────────────
# Quadro compartilhado no shared_kv 'agentes_rede': todo agente da rede LÊ os
# recados dos colegas antes de responder e pode PUBLICAR achados/alertas/
# incongruências que os outros verão na próxima conversa. É o que interliga
# CEO × CFO × CMO × Sr. Tráfego × Sr. Performance × Sr. Gerência.
KV_REDE = "agentes_rede"
REDE_AGENTS = {"ceo", "cfo", "cmo", "gestor_trafego", "sr_performance", "sr_gerencia"}
REDE_TIPOS = {"achado", "alerta", "incongruencia", "plano", "decisao", "pergunta", "resposta"}
REDE_MAX_NOTAS = 120
import re as _re


def _kv_read(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, (dict, list)) else {}
    except Exception:
        return {}


def _kv_write(sb, key, value):
    from datetime import datetime, timezone
    sb.table("shared_kv").upsert({
        "key": key, "value": value,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key").execute()


def _rede_context(sb, agent_id):
    """Quadro da rede visto por este agente: recados endereçados a ele ou a
    'todos' (+ os que ele mesmo publicou, pra não repetir), mais o protocolo
    de publicação. Capado em ~6k chars."""
    if not sb:
        return ""
    v = _kv_read(sb, KV_REDE)
    notas = [n for n in (v.get("notas") or []) if isinstance(n, dict)]
    minhas = [n for n in notas if n.get("autor") == agent_id][-3:]
    pra_mim = [n for n in notas
               if n.get("autor") != agent_id
               and (agent_id in (n.get("para") or []) or "todos" in (n.get("para") or []))][-12:]
    linhas = []
    if pra_mim:
        linhas.append("RECADOS DOS COLEGAS (mais recentes por último — considere TODOS ao responder; "
                      "se algum pedir sua posição, responda publicando um recado tipo 'resposta'):")
        for n in pra_mim:
            linhas.append(f"- [{str(n.get('ts') or '')[:16]}] {n.get('autor')} → {','.join(n.get('para') or [])} "
                          f"({n.get('tipo')}): {n.get('titulo')} — {str(n.get('corpo') or '')[:400]}")
    if minhas:
        linhas.append("SEUS ÚLTIMOS RECADOS PUBLICADOS (não repita o que já publicou):")
        for n in minhas:
            linhas.append(f"- [{str(n.get('ts') or '')[:16]}] ({n.get('tipo')}) {n.get('titulo')}")
    linhas.append(
        "COMO PUBLICAR NA REDE: quando (e SÓ quando) você tiver algo que um colega "
        "precisa saber — achado relevante, alerta, incongruência entre dados, decisão "
        "que afeta a área dele, pergunta direta ou resposta a um recado — inclua no "
        "FINAL da sua resposta um bloco neste formato exato (máx 2 blocos):\n"
        '[[REDE]]{"para":["ceo"],"tipo":"alerta","titulo":"resumo em 1 linha","corpo":"detalhe objetivo com número e fonte"}[[/REDE]]\n'
        "Destinos válidos: ceo, cfo, cmo, gestor_trafego, sr_performance, sr_gerencia, todos. "
        "Tipos válidos: achado, alerta, incongruencia, plano, decisao, pergunta, resposta. "
        "O bloco é removido da resposta ao usuário e entregue aos colegas — não mencione o bloco no texto. "
        "Rotina sem novidade = NÃO publicar nada."
    )
    colegas = {
        "ceo": "CEO (visão do todo, prioridades, arbitragem)", "cfo": "Sr. CFO (caixa, dívida, custos, margens)",
        "cmo": "CMO (estratégia de marketing, budget, CAC/ROAS)", "gestor_trafego": "Sr. Gestor de Tráfego (mídia paga Meta, execução)",
        "sr_performance": "Sr. Performance (leitura comercial/KPIs)", "sr_gerencia": "Sr. Gerência (gestão de equipe)",
    }
    outros = "; ".join(f"{k} = {d}" for k, d in colegas.items() if k != agent_id)
    return ("═══ REDE DE AGENTES DA DIRETORIA ═══\nSeus colegas na rede: " + outros + "\n\n" + "\n".join(linhas))[:6000]


def _rede_publish(sb, agent_id, reply, autor_user=None):
    """Extrai blocos [[REDE]]{json}[[/REDE]] da resposta do agente, grava no
    quadro e devolve (reply_limpo, n_publicados). Best-effort: bloco inválido
    é só descartado."""
    if not sb or "[[REDE]]" not in (reply or ""):
        return reply, 0
    from datetime import datetime, timezone
    pub = []
    def _take(m):
        try:
            d = json.loads(m.group(1))
            para = [p for p in (d.get("para") or []) if p in REDE_AGENTS or p == "todos"] or ["todos"]
            tipo = d.get("tipo") if d.get("tipo") in REDE_TIPOS else "achado"
            titulo = str(d.get("titulo") or "").strip()[:160]
            corpo = str(d.get("corpo") or "").strip()[:1200]
            if titulo:
                pub.append({
                    "id": f"{agent_id}-{int(time.time() * 1000)}-{len(pub)}",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "autor": agent_id, "para": para, "tipo": tipo,
                    "titulo": titulo, "corpo": corpo,
                    **({"por": autor_user} if autor_user else {}),
                })
        except Exception:
            pass
        return ""
    limpo = _re.sub(r"\[\[REDE\]\]\s*(\{.*?\})\s*\[\[/REDE\]\]", _take, reply, flags=_re.DOTALL).strip()
    if pub:
        try:
            v = _kv_read(sb, KV_REDE)
            notas = [n for n in (v.get("notas") or []) if isinstance(n, dict)]
            notas = (notas + pub[:2])[-REDE_MAX_NOTAS:]
            _kv_write(sb, KV_REDE, {"notas": notas})
        except Exception:
            return limpo, 0
    return limpo, len(pub[:2])


def _diretoria_context(sb, agent_id):
    """CONTEXTO VIVO dos agentes C-level: vendas do CRM (mês/ano por funil),
    Meta Ads (cache), caixa + HUB financeiro (cache da ponte), Plano de Resgate
    e estratégia vigente do Tráfego. Tudo best-effort, capado em ~18k chars."""
    if not sb:
        return ""
    from datetime import datetime, timezone, timedelta
    parts = []
    agora = datetime.now(timezone(timedelta(hours=-3)))
    ym = agora.strftime("%Y-%m")

    # 1) Vendas (deals win) — mês corrente e acumulado do ano, por funil
    try:
        ini_ano = agora.strftime("%Y-01-01")
        rows = (sb.table("deals")
                .select("amount,closed_at,pipeline_name,amt_total:rd_raw->amount_total")
                .eq("win", True).gte("closed_at", ini_ano).limit(3000).execute().data or [])
        mes, ano = {}, {}
        for d in rows:
            try:
                val = float(d.get("amount") or 0) or float(d.get("amt_total") or 0)
            except Exception:
                val = 0.0
            k = (d.get("pipeline_name") or "?")[:40]
            ano.setdefault(k, [0, 0.0]); ano[k][0] += 1; ano[k][1] += val
            if str(d.get("closed_at") or "")[:7] == ym:
                mes.setdefault(k, [0, 0.0]); mes[k][0] += 1; mes[k][1] += val
        if ano:
            tm = [sum(v[0] for v in mes.values()), sum(v[1] for v in mes.values())]
            ta = [sum(v[0] for v in ano.values()), sum(v[1] for v in ano.values())]
            linhas = [f"VENDAS (CRM, deals ganhos): mês {ym} = {tm[0]} vendas · VGV R$ {tm[1]:,.0f} | ano = {ta[0]} vendas · VGV R$ {ta[1]:,.0f}"]
            for k, v in sorted(ano.items(), key=lambda kv: -kv[1][1])[:8]:
                m = mes.get(k) or [0, 0.0]
                linhas.append(f"  - {k}: mês {m[0]} (R$ {m[1]:,.0f}) · ano {v[0]} (R$ {v[1]:,.0f})")
            parts.append("\n".join(linhas))
    except Exception:
        pass

    # 2) Meta Ads — totais 7d/30d do cache compartilhado
    try:
        linhas = []
        for preset in ("last_7d", "last_30d"):
            rows = (sb.table("meta_ads_cache").select("payload")
                    .eq("cache_key", preset + "||").limit(1).execute().data or [])
            p = rows[0].get("payload") if rows else None
            if isinstance(p, dict):
                tot = ((p.get("totals") or {}).get("cur")) or {}
                spend = float(tot.get("spend") or 0)
                res = int(tot.get("results") or 0)
                linhas.append(f"  - {preset}: gasto R$ {spend:,.0f} · {res} leads · CPL " +
                              (f"R$ {spend / res:,.2f}" if res else "—"))
        if linhas:
            parts.append("META ADS (cache do House):\n" + "\n".join(linhas))
    except Exception:
        pass

    # 3) Caixa + HUB financeiro (cache da ponte psmhub — fonte oficial pós-NIBO)
    try:
        cx = _kv_read(sb, "caixa_posicao")
        if cx:
            parts.append("POSIÇÃO DE CAIXA (kv caixa_posicao): " + json.dumps(cx, ensure_ascii=False)[:600])
    except Exception:
        pass
    try:
        hub = _kv_read(sb, "psmhub_financeiro_cache")
        if hub:
            parts.append("PSM HUB FINANCEIRO (cache da ponte — fonte OFICIAL; NIBO cancelado):\n" +
                         json.dumps(hub, ensure_ascii=False, default=str)[:3000])
    except Exception:
        pass

    # 4) Plano de Resgate (shared_kv editável — a bíblia do semestre)
    try:
        pl = _kv_read(sb, "plano_resgate_2026")
        if isinstance(pl, dict) and pl.get("secoes"):
            linhas = [f"PLANO DE RESGATE ({pl.get('versao') or ''}):"]
            for s in pl["secoes"][:12]:
                if isinstance(s, dict):
                    linhas.append(f"  ## {s.get('titulo')}\n  {str(s.get('corpo') or '')[:700]}")
            parts.append("\n".join(linhas)[:6000])
    except Exception:
        pass

    # 4b) Dossiês da diretoria (kv diretoria_dossies — publicados pelas rotinas
    # CEO/CFO que rodam no Windows) + radar de riscos do Sr. CFO + últimos
    # relatórios do CMO. É o elo entre os agentes de ROTINA e os de CHAT.
    try:
        items = [d for d in ((_kv_read(sb, "diretoria_dossies") or {}).get("items") or []) if isinstance(d, dict)]
        items.sort(key=lambda d: str(d.get("criado_em") or ""), reverse=True)
        meus = [d for d in items if (d.get("autor") or "").lower() == agent_id][:2]
        ceo_du = [d for d in items if (d.get("autor") or "").upper() == "CEO"][:1] if agent_id != "ceo" else []
        linhas = []
        for d in (meus + ceo_du):
            linhas.append(f"[{d.get('autor')}] {d.get('titulo')} ({str(d.get('criado_em') or '')[:10]}): "
                          f"{str(d.get('manchete') or '')[:200]}\n{str(d.get('corpo_md') or '')[:1800]}")
        if linhas:
            parts.append("DOSSIÊS DA DIRETORIA (rotina dos agentes — seus e o Estado da União do CEO):\n" + "\n---\n".join(linhas))
    except Exception:
        pass
    if agent_id in ("ceo", "cfo"):
        try:
            radar = [i for i in ((_kv_read(sb, "sr_cfo_radar") or {}).get("itens") or []) if isinstance(i, dict)]
            if radar:
                ico = {"vermelho": "🔴", "amarelo": "🟡", "azul": "🔵"}
                parts.append("RADAR DE RISCOS DO SR. CFO:\n" + "\n".join(
                    f"- {ico.get(i.get('nivel'), '·')} {i.get('titulo')}: {str(i.get('detalhe') or '')[:250]}"
                    + (f" (prazo: {i.get('prazo')})" if i.get("prazo") else "") for i in radar[:10]))
        except Exception:
            pass
    if agent_id in ("ceo", "cmo"):
        try:
            rel = [i for i in ((_kv_read(sb, "cmo_relatorios") or {}).get("itens") or []) if isinstance(i, dict)]
            rel.sort(key=lambda i: str(i.get("ts") or ""), reverse=True)
            if rel:
                parts.append("ÚLTIMOS RELATÓRIOS DO CMO (rotina):\n" + "\n---\n".join(
                    f"[{i.get('tipo')}] {str(i.get('ts') or '')[:10]}{' 🚨' if i.get('alerta') else ''}: {str(i.get('texto') or '')[:1500]}"
                    for i in rel[:2]))
        except Exception:
            pass

    # 5) Estratégia vigente do Tráfego + achados do Vigia (CEO/CMO principalmente)
    if agent_id in ("ceo", "cmo"):
        try:
            cfg = _kv_read(sb, "gt_config")
            est = (cfg or {}).get("estrategia") or {}
            if isinstance(est, dict) and (est.get("conquista") or est.get("imoveis")):
                parts.append("ESTRATÉGIA VIGENTE DO SR. TRÁFEGO:\n[Conquista] " + str(est.get("conquista") or "—")[:1500] +
                             "\n[Imóveis] " + str(est.get("imoveis") or "—")[:1500])
            vg = _kv_read(sb, "gt_vigia")
            ins = [i for i in ((vg or {}).get("insights") or []) if isinstance(i, dict)][:2]
            if ins:
                parts.append("ÚLTIMOS ACHADOS DO VIGIA DE CONCORRÊNCIA:\n" + "\n".join(
                    f"- [{str(i.get('ts'))[:16]}] {i.get('titulo')}: {str(i.get('insight'))[:300]}" for i in ins))
        except Exception:
            pass

    # 6) Concorrentes (CMO)
    if agent_id == "cmo":
        try:
            cc = (sb.table("concorrentes").select("nome,seguidores,anuncios_count")
                  .order("anuncios_count", desc=True).limit(8).execute().data or [])
            if cc:
                parts.append("CONCORRENTES (Intel House):\n" + "\n".join(
                    f"- {c.get('nome')}: {c.get('anuncios_count') or 0} anúncios ativos · {c.get('seguidores') or '?'} seguidores" for c in cc))
        except Exception:
            pass

    return ("\n\n".join(parts))[:18000]


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

        # v87.31: Agentes Diretoria (CEO/CFO/CMO) carregam caixa, dívida e plano
        # no contexto — SÓ sócio (lvl 10), espelhando a Sala de Comando.
        if agent_id in ("ceo", "cfo", "cmo") and (user.get("lvl") or 0) < 10:
            return self._send(403, {"ok": False, "error": "Agentes Diretoria são restritos ao sócio (lvl 10)"})

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
        elif agent_id in ("ceo", "cfo", "cmo"):
            ctx = _diretoria_context(sb, agent_id)
            if ctx:
                system = system + "\n\n═══ CONTEXTO VIVO (dados reais do House agora) ═══\n" + ctx
        elif agent_id == "sala_treino":
            cen = TREINO_CENARIOS.get((body.get("cenario") or "").strip())
            if not cen:
                return self._send(400, {"ok": False, "error": f"cenario inválido. Use: {sorted(TREINO_CENARIOS)}"})
            system = system + "\n\n" + cen["persona"]
        elif agent_id == "treino_nota":
            cen = TREINO_CENARIOS.get((body.get("cenario") or "").strip())
            if cen:
                system = system + "\n\nCENÁRIO TREINADO: " + cen["nome"] + " — " + cen["persona"]

        # v87.31: REDE DE AGENTES — todo agente da rede vê o quadro dos colegas
        # e recebe o protocolo de publicação ([[REDE]]…[[/REDE]]).
        if agent_id in REDE_AGENTS:
            rctx = _rede_context(sb, agent_id)
            if rctx:
                system = system + "\n\n" + rctx

        t0 = time.time()
        result = _try_chain(chain, system, messages, keys)
        dur = round(time.time() - t0, 2)

        if not result.get("text"):
            return self._send(502, {"ok": False, "error": result.get("error") or "sem resposta", "agent": agent_id})

        # v87.31: publica na rede os blocos [[REDE]] que o agente emitiu
        rede_pub = 0
        if agent_id in REDE_AGENTS:
            result["text"], rede_pub = _rede_publish(sb, agent_id, result["text"], autor_user=user.get("name"))
            if not result["text"]:
                result["text"] = "📡 Recado publicado na rede de agentes."

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
            "rede_pub": rede_pub,   # v87.31: nº de recados publicados na rede nesta resposta
        })


# Endpoint utilitário pra UI listar agents
class _ignore_handler:
    """Dummy pra evitar warnings; Vercel só usa 'handler'."""
    pass


def get_agents_list():
    """Helper exportável."""
    return [{"id": k, **v} for k, v in AGENTS.items()]
