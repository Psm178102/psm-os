"""
GET/POST /api/v3/cultura/manual — Manual de Cultura PSM (editável pelo sócio). v80.5

Antes era 100% chumbado no front (stub genérico do Sprint 8.0). Agora é config-driven:
o sócio edita missão, visão, valores (cards) e SEÇÕES livres (texto ou lista) — pilares,
plano de carreira, rituais, história, regras, o que quiser. Guarda em shared_kv
'manual_cultura' (sem SQL). Se nunca foi editado, devolve o conteúdo-base atual.

Estrutura:
{
  "missao": str, "visao": str,
  "valores": [{ "ico": str, "t": str, "d": str }],
  "secoes":  [{ "id": str, "ico": str, "titulo": str, "tipo": "texto"|"lista",
                "conteudo": str, "itens": [str] }]
}

GET  (qualquer autenticado): { ok, manual, can_edit }
POST (lvl >= 10 — sócio): { manual }  → salva o documento inteiro
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "manual_cultura"

# Conteúdo-base importado do Manual de Cultura PSM v2.0 (a atualizar para a 3.8).
# Editável pelo sócio; este é só o ponto de partida — nada inventado.
DEFAULT = {
    "missao": "Transformar pessoas além do m². Atuar com excelência no mercado imobiliário, mas com um olhar que vai além da venda — contribuindo de forma real para o crescimento pessoal, profissional e espiritual de quem faz parte da nossa jornada, clientes e parceiros.",
    "visao": "Ser um dos principais grupos integrados do Brasil nos setores imobiliário, financeiro e jurídico, reconhecido por formar profissionais de alta performance, entregar soluções completas e transformar o padrão de cultura, relacionamento e gestão no mercado.",
    "valores": [
        {"ico": "🙏", "t": "Deus em primeiro lugar", "d": "Decisões, ações e relações refletem os princípios que acreditamos e seguimos com fé."},
        {"ico": "🌱", "t": "Investir em quem quer ser transformado", "d": "Tempo, energia e formação em quem demonstra compromisso com o próprio crescimento."},
        {"ico": "💪", "t": "Diligência", "d": "Quem multiplica recebe sempre mais. (Mateus 25:21)"},
        {"ico": "⚖️", "t": "Justiça", "d": "Sem jeitinho. Sem corrupção. O que é certo é certo. (Isaías 1:17)"},
        {"ico": "🙌", "t": "Gratidão", "d": "Reconhecemos e agradecemos as boas atitudes. (Lucas 17:15-16)"},
        {"ico": "✅", "t": "Verdade", "d": "Falamos a verdade. Mentirosos não têm espaço aqui. (João 8:32)"},
        {"ico": "🧎", "t": "Humildade", "d": "Quem acha que já sabe tudo não cresce. (Tiago 4:6)"},
        {"ico": "🤝", "t": "Lealdade", "d": "Quem quer fazer parte tem que estar fechado com a gente. (Provérbios 20:6)"},
        {"ico": "🎁", "t": "Generosidade", "d": "Compartilhamos recursos para o crescimento conjunto. (2 Coríntios 9:7)"},
    ],
    "secoes": [
        {"id": "sobre", "ico": "🏢", "titulo": "Sobre a PSM", "tipo": "texto", "itens": [],
         "conteudo": "A PSM é uma assessoria especializada em negócios imobiliários com atuação destacada no mercado de lançamentos, constituída em 2023 por Paulo Sérgio Morimatsu em São José do Rio Preto - SP (que atua no mercado imobiliário desde 2015). Com mais de uma década de experiência no setor e um volume superior a R$125 milhões em vendas, Paulo estruturou uma empresa inovadora que se diferencia do mercado tradicional.\n\nNossa abordagem valoriza, acima de tudo, as pessoas. Investimos continuamente na formação e capacitação de corretores, preparando-os para a alta performance por meio de técnicas avançadas de vendas, treinamentos específicos e mentorias individuais. Acreditamos que o sucesso é construído sobre relacionamentos sólidos, confiança mútua e soluções reais para o cliente.\n\nCom esse posicionamento, a PSM garante acesso privilegiado aos melhores lançamentos da região, mantendo os clientes informados em primeira mão sobre as melhores oportunidades de investimento e moradia em São José do Rio Preto e região."},
        {"id": "historia", "ico": "📖", "titulo": "História e Visão de Futuro", "tipo": "texto", "itens": [],
         "conteudo": "“A PSM nasceu da ausência de direção, cultura e valorização em um mercado que forma corretores, mas não os desenvolve.”\n\nA trajetória começa em 2015, quando Paulo, com 18 anos, cursava Direito à noite e usava o horário comercial para buscar independência financeira. Sem experiência, viu uma placa de “Contrata-se corretor” numa imobiliária de bairro na zona norte de Rio Preto e pediu uma chance. Durante três meses, sem visitas nem clientes, teve clareza: o mercado imobiliário era uma escola de prática real.\n\nDepois veio a captação de imóveis na zona sul — mapeando bairros, anotando placas, falando com porteiros e zeladores — e o cuidado com os repasses de locação. Cursou o TTI, fez estágio, tirou o CRECI e iniciou como corretor. Tentou ser autônomo, mas sem estrutura e gestão emocional quase não vendeu; nichou em locações comerciais e entendeu o tamanho do desafio de empreender sozinho.\n\nEm 2018, ingressou em uma das maiores incorporadoras do Noroeste Paulista, começando no Minha Casa Minha Vida (ticket médio R$122 mil), em plantões de container, sem folga nos fins de semana. Vieram loteamentos, studios e médio padrão, até o lançamento vertical mais alto padrão da cidade naquele ano, onde se destacou. Ao longo dessa trajetória vendeu mais de R$70 milhões em VGV: 44% das vendas do Quintessa by Tarraf, líder de vendas do Montelena by Tarraf e campeão de vendas em todos os anos como corretor house.\n\nMas o que mais marcou não foram os números — foi o padrão do mercado: corretores sem suporte, sem cultura, sem estratégia. Contratados e abandonados. Esse foi o estopim para criar a PSM Imóveis: não como mais uma imobiliária, mas como uma empresa com estrutura própria de formação, cultura e desenvolvimento. Na PSM o corretor é capacitado, acompanhado e reconhecido; a cultura é aplicada no dia a dia; o desenvolvimento é levado a sério desde o primeiro dia.\n\nA PSM Imóveis não é sobre imóveis. É sobre gente. Gente que decidiu fazer diferente — e teve com quem contar no caminho."},
        {"id": "pilares", "ico": "🧱", "titulo": "Pilares da Prática", "tipo": "lista", "conteudo": "", "itens": [
            "Ambiente é tudo. Onde há cultura, há desenvolvimento.",
            "QE > QI. A inteligência emocional sustenta o resultado a longo prazo.",
            "Quem divide, multiplica. Trabalho em equipe é valor, não discurso.",
            "Relacionamento não se terceiriza. A venda começa antes da visita.",
            "O mercado é soberano. Adaptar-se aos ciclos é essencial.",
            "Valores cristãos. Ética e respeito são fundamentos inegociáveis.",
        ]},
        {"id": "grupo", "ico": "🌎", "titulo": "Visão de Futuro — Grupo PSM", "tipo": "texto", "itens": [],
         "conteudo": "O Grupo PSM nasce da prática e da ausência de estrutura percebida por quem viveu todos os lados do mercado. O que começou como uma imobiliária diferente evolui para um grupo estratégico e multidisciplinar, com visão de longo prazo e presença nacional — uma plataforma integrada de soluções que se conectam e se retroalimentam.\n\nO Grupo PSM será: uma holding integrada de soluções imobiliárias, financeiras e jurídicas; uma escola real de talentos e líderes do mercado imobiliário brasileiro; um ecossistema com cultura forte, visão estratégica e crescimento sustentável; uma referência nacional em ética, profissionalismo e desenvolvimento humano. Um movimento novo."},
        {"id": "frentes", "ico": "🧭", "titulo": "Frentes do Grupo PSM", "tipo": "lista", "conteudo": "", "itens": [
            "Desenvolvimento humano e formação profissional (universidade corporativa, mentoria, lideranças).",
            "Soluções imobiliárias de alta performance (compra e venda, locações, áreas, viabilidade, lançamentos, BTS/corporativo).",
            "Times comerciais especializados por produto (Minha Casa Minha Vida; Médio e Alto padrão).",
            "Expansão nacional com modelo replicável (2+ regiões metropolitanas até 2030, unidades próprias e franquia).",
            "Segmento financeiro e M&A (consórcios, financiamentos, valuation, fusões e aquisições de carteiras).",
            "Leilões e jurídico especializado (regularização, due diligence, leilões judiciais e extrajudiciais).",
            "Governança e cultura como alicerce (valores cristãos, cultura aplicada, gestão por dados e KPIs).",
        ]},
        {"id": "organograma", "ico": "🏛", "titulo": "Organograma e Funções", "tipo": "lista", "conteudo": "", "itens": [
            "Sócios — visão da empresa, planejamento estratégico, grandes negócios, parcerias, produtos e liderança executiva.",
            "Head de Operações — supervisiona RH, Marketing, Vendas e TI; processos integrados, cultura e operacionalização da visão. Reporta aos sócios.",
            "Head Administrativo e Financeiro — controladoria e tesouraria; notas fiscais, fluxos de pagamento, DRE, Fluxo de Caixa e Balanço. Reporta aos sócios.",
            "Gerente — gestão de uma ou mais equipes: metas e KPIs, coaching, One-on-One e previsibilidade do time (cockpit de gestão no sistema). Reporta ao Head de Operações / sócios.",
            "Líder — gestão de metas e KPIs dos corretores, acompanhamento de atendimentos e fechamentos, treinamentos de produto e previsão semanal do time. Reporta ao Gerente / Head de Operações.",
            "Corretor(a) — gerencia o funil no CRM, atende com qualidade da prospecção ao fechamento (estoque e lançamentos) seguindo o playbook. Reporta ao Líder.",
            "Estagiário Comercial — apoia as etapas comerciais com foco em SDR, atende com supervisão. Reporta ao Líder.",
            "Secretaria de Vendas e Locações — documentação e processos de aluguel, análise de crédito, agenda da PSM, Kenlo atualizado, autorizações de visita e controle de chaves.",
            "Analista Administrativo e Financeiro — documentação e processos internos, contas a pagar/receber, compras, rotina de pagamentos.",
            "Analista de Marketing — publicações, edição de foto e vídeo, design, captação de conteúdo e relatórios de crescimento orgânico.",
            "Vera — I.A. exclusiva da PSM: onboarding, operação diária do corretor, dúvidas, métricas e KPIs, conhecimento dos empreendimentos. O braço direito do corretor.",
            "PSM Academy (Comunidade) — aulas, treinos e mentorias gravadas (via Kiwify), conteúdos por módulos.",
        ]},
        {"id": "equipes", "ico": "🛡", "titulo": "Equipes / Squads", "tipo": "lista", "conteudo": "", "itens": [
            "Conquista — equipe comercial de alta performance.",
            "Lançamento — foco nos lançamentos das incorporadoras parceiras.",
            "Terceiros — imóveis de terceiros captados (estoque Kenlo).",
            "Locação — gestão e intermediação de locações.",
            "MAP e IMPPER — frentes específicas de prospecção/produto.",
            "(Missão detalhada de cada squad a confirmar na atualização 3.8.)",
        ]},
        {"id": "modelos", "ico": "🪪", "titulo": "Modelos de Atuação: Corretor Associado × Sócio", "tipo": "texto", "itens": [],
         "conteudo": "CORRETOR ASSOCIADO — modelo mais comum e recomendado para quem deseja atuar com liberdade, meritocracia e formação contínua, mantendo-se autônomo (PJ): atua com independência jurídica e fiscal, sem vínculo CLT; recebe comissões por produção conforme tabela vigente; tem acesso a estrutura, mentoria, treinamentos, leads e campanhas; é inserido em rotinas, metas e critérios mínimos; usa marca, estrutura e sistemas mediante regras claras; é avaliado por performance, aderência cultural e compromisso com o time. Quanto mais entrega, mais ganha.\n\nSÓCIO DA EMPRESA — responsabilidade direta sobre operação, resultados e patrimônio: divide lucros e prejuízos conforme participação; é corresponsável pela gestão, estratégia e operação; tem deveres legais e fiscais; pode ser administrador ou investidor; zela pela integridade da marca, das finanças e da cultura. Ser sócio não é só ter percentual — é ter responsabilidade, voz estratégica e risco jurídico e financeiro."},
        {"id": "carreira", "ico": "🪜", "titulo": "Plano de Carreira", "tipo": "lista", "conteudo": "", "itens": [
            "Corretor(a) — domina o funil, atende com qualidade e cumpre os critérios mínimos.",
            "Líder de Equipe — forma e acompanha um time: metas, KPIs, treinamentos e One-on-One.",
            "Gerente — gere uma ou mais equipes, com coaching, previsibilidade e cockpit de gestão.",
            "Sócio — responsabilidade direta sobre operação, resultados, patrimônio e cultura.",
            "A evolução acompanha a trilha da Comunidade: Formação → Performance → Especialização → Liderança → Empreendedorismo.",
            "(Critérios objetivos de promoção entre níveis a definir na atualização 3.8.)",
        ]},
        {"id": "rotina", "ico": "🗓", "titulo": "Rotina e Calendário Interno", "tipo": "texto", "itens": [],
         "conteudo": "A rotina da PSM é organizada para garantir foco, disciplina e resultado. Todos os compromissos e eventos são agendados na agenda oficial (Zoho).\n\nHorário de funcionamento: segunda a sexta, das 9h às 18h, e sábado das 9h às 12h. Corretores são autônomos e definem seus horários dentro desse período, mas devem comunicar ausências, participar dos eventos oficiais e manter ritmo compatível com as metas.\n\nPresencialidade: a rotina é presencial. Pedidos de remoto/híbrido passam por avaliação do Head de Operações. Algumas campanhas e leads são exclusivos de quem está presencial, pela agilidade exigida no atendimento.\n\nPlantões: definidos no início de cada mês, com pontualidade, boa apresentação e atendimento de excelência. Ser chamado é sinal de confiança — não é opcional."},
        {"id": "eventos", "ico": "📌", "titulo": "Eventos Fixos da Semana", "tipo": "lista", "conteudo": "", "itens": [
            "Alinhamento semanal — segunda-feira, 9h30.",
            "Treinamentos técnicos e desenvolvimento pessoal — sextas-feiras, 16h30 às 18h00.",
            "One on One individual — segunda a sexta (agendamento direto com o líder/head).",
        ]},
        {"id": "rotinas_adm", "ico": "💸", "titulo": "Rotinas Administrativas e Financeiras", "tipo": "lista", "conteudo": "", "itens": [
            "Pagamentos de comissão de venda: dias 5 e 20 de cada mês.",
            "Nota fiscal: solicitar 5 dias antes da data de pagamento.",
            "A solicitação só ocorre se a incorporadora já tiver feito o repasse à PSM; caso contrário, o pagamento vai para o próximo ciclo.",
        ]},
        {"id": "ferramentas", "ico": "🧰", "titulo": "Ferramentas de Organização", "tipo": "lista", "conteudo": "", "itens": [
            "Zoho Mail — agenda de eventos e compromissos da equipe.",
            "RD Station — CRM oficial; registro, acompanhamento e análise das atividades comerciais.",
            "Kenlo Imob — estoque de imóveis de terceiros captados.",
            "Drive PSM — materiais, tabelas vigentes por incorporadora, planilhas e tutoriais.",
            "Kiwify — aulas e mentorias gravadas.",
            "Google Earth PSM — localização de cada empreendimento e futuros lançamentos.",
        ]},
        {"id": "sistema", "ico": "🖥", "titulo": "Nosso Sistema — House PSM", "tipo": "texto", "itens": [],
         "conteudo": "O House PSM (housepsm.com.br) é o cérebro operacional da empresa — onde a cultura vira número e o acompanhamento acontece todos os dias. Reúne: Dashboard Diário, Metas e Atingimento, Ranking, Arena de performance, One-on-One (cockpit do corretor e do gestor), CRM integrado ao RD Station, Financeiro (NIBO), Secretaria de Vendas, Cofre de Logins e Senhas, CND's, Métricas de Viabilidade e a PSM Academy. É a ferramenta central do dia a dia de toda a equipe."},
        {"id": "desempenho", "ico": "📈", "titulo": "Atividade e Desempenho — Critérios Mínimos", "tipo": "lista", "conteudo": "", "itens": [
            "Não ficar mais de 3 meses sem realizar uma venda (caso ocorra, a parceria é reavaliada).",
            "Manter média mínima de 2 a 3 visitas presenciais por semana (calculadas ao longo de 90 dias).",
            "O foco da PSM é formar profissionais de alta performance — metas mínimas garantem coerência e justiça no desenvolvimento de todos.",
            "Acompanhamento e gamificação acontecem no sistema: Ranking, Arena de performance, metas/atingimento e One-on-One. (Critérios mínimos a revalidar na 3.8.)",
        ]},
        {"id": "etica", "ico": "⚖️", "titulo": "Código de Ética, Compliance e LGPD", "tipo": "texto", "itens": [],
         "conteudo": "O Código de Ética da PSM é documento anexo e complementar a este manual, com força normativa e aplicação direta sobre a atuação de todos os parceiros — reúne regras de conduta, padrões éticos, consequências e procedimentos disciplinares. Cada corretor e colaborador é responsável por conhecê-lo e segui-lo na íntegra.\n\nTodas as diretrizes estão respaldadas no contrato de parceria, que define obrigações legais, éticas e operacionais de proteção de dados, segurança da informação e compliance. O parceiro compromete-se a respeitar a LGPD e as políticas internas de confidencialidade e sigilo. O descumprimento pode gerar consequências contratuais, administrativas e legais."},
        {"id": "comunidade", "ico": "🎓", "titulo": "Comunidade PSM — Formação", "tipo": "texto", "itens": [],
         "conteudo": "“O mercado não perdoa amadorismo. E na PSM, ninguém é autorizado a atuar sem antes estar preparado.”\n\nA Comunidade PSM é o programa oficial de formação, capacitação contínua e desenvolvimento estratégico do Grupo — a “faculdade ideal” do setor. Aqui você aprende com quem está no campo, tem trilha prática por nível de maturidade, conta com suporte emocional, técnico, jurídico e estratégico, e é avaliado e promovido por cultura + performance.\n\nTrilha de evolução: Ciclo de Formação (técnica, conduta e ambientação) → Performance (funil, objeções, emocional, carteira) → Especialização (MCMV, médio/alto padrão, locações, BTS, lançamentos, áreas, leilões) → Liderança (formação de times, cultura, gestão de pessoas) → Empreendedorismo (operação, expansão, valuation, visão de negócio).\n\nFormação multidisciplinar com especialistas convidados em Direito & Legislação, Engenharia & Infraestrutura, Gestão & Finanças, Comportamento & Comunicação, Marketing & Performance Digital, Economia & Macrotendências e Liderança & Gestão de Pessoas. Aqui você não entra para vender — entra para dominar o mercado, com técnica, cultura e visão de longo prazo."},
        {"id": "glossario", "ico": "📚", "titulo": "Glossário", "tipo": "lista", "conteudo": "", "itens": [
            "VGV — Valor Geral de Vendas (soma do valor dos imóveis vendidos).",
            "Funil — etapas do lead até a venda: Lead → Contato → Agendamento → Visita → Proposta → Pasta → Venda.",
            "CRM (RD Station) — sistema de gestão dos atendimentos comerciais.",
            "NIBO — plataforma financeira (contas, fluxo de caixa).",
            "SDR — pré-venda: prospecção e qualificação de leads.",
            "CAC — Custo de Aquisição de Cliente · CPL — Custo Por Lead.",
            "BTS — Built-to-Suit (imóvel sob medida para o cliente).",
            "M&A — fusões e aquisições.",
            "One-on-One — reunião individual de acompanhamento (corretor/gestor).",
        ]},
        {"id": "versao", "ico": "🏷", "titulo": "Controle de Versão", "tipo": "lista", "conteudo": "", "itens": [
            "Base: Manual de Cultura PSM v2.0 (importado).",
            "Em evolução para a versão 3.8.",
            "Itens com '(confirmar/definir/revalidar na 3.8)' dependem de validação da diretoria.",
        ]},
    ],
}


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else None
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = None
    return val if isinstance(val, dict) and val.get("_saved") else None


def _clean(m):
    """Sanitiza o documento recebido do front."""
    def s(x, n=8000):
        return str(x or "").strip()[:n]
    valores = []
    for v in (m.get("valores") or [])[:30]:
        if not isinstance(v, dict):
            continue
        t = s(v.get("t"), 80)
        if t or s(v.get("d"), 300):
            valores.append({"ico": s(v.get("ico"), 8), "t": t, "d": s(v.get("d"), 300)})
    secoes = []
    for i, se in enumerate((m.get("secoes") or [])[:40]):
        if not isinstance(se, dict):
            continue
        titulo = s(se.get("titulo"), 120)
        tipo = "lista" if (se.get("tipo") == "lista") else "texto"
        itens = [s(x, 500) for x in (se.get("itens") or [])[:60] if s(x, 500)] if tipo == "lista" else []
        conteudo = s(se.get("conteudo"), 12000) if tipo == "texto" else ""
        if titulo or conteudo or itens:
            secoes.append({"id": s(se.get("id"), 40) or ("sec" + str(i)), "ico": s(se.get("ico"), 8),
                           "titulo": titulo, "tipo": tipo, "conteudo": conteudo, "itens": itens})
    return {"_saved": True, "missao": s(m.get("missao"), 4000), "visao": s(m.get("visao"), 4000),
            "valores": valores, "secoes": secoes}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            saved = _read(sb)
            manual = saved or dict(DEFAULT)
            manual.pop("_saved", None)
            return self._send(200, {"ok": True, "manual": manual,
                                    "is_default": saved is None,
                                    "can_edit": (user.get("lvl") or 0) >= 10})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        manual = body.get("manual")
        if not isinstance(manual, dict):
            return self._send(400, {"ok": False, "error": "manual obrigatório"})
        try:
            sb = supabase_client()
            doc = _clean(manual)
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": doc,
                                         "updated_at": datetime.now(timezone.utc).isoformat()},
                                        on_conflict="key").execute()
            try:
                audit(self, actor, "manual_cultura_save", "kv", KV_KEY, notes=None)
            except Exception:
                pass
            out = dict(doc)
            out.pop("_saved", None)
            return self._send(200, {"ok": True, "manual": out})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
