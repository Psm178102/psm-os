// âââ PSM AGENT ENGINE (OpenAI GPT-4o) âââââââââââââââââââââââââââââââââââââââ
// Core engine shared by all PSM agents (Vera, Sol, Sr Intelligence, Sr Gerencia)
// Route: POST /api/agent
// Body: { agent: "vera"|"sol"|"intelligence"|"gerencia", message, conversationId, channel, metadata }

const https = require('https');
const { properties, filterProperties, recommendProperties } = require('./properties.js');

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// PROPERTY CONTEXT INJECTION â Auto-detects client preferences from message
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const REGION_MAP = {
  'sul': 'SUL', 'zona sul': 'SUL',
  'norte': 'NORTE', 'zona norte': 'NORTE',
  'oeste': 'OESTE', 'zona oeste': 'OESTE',
  'leste': 'LESTE', 'zona leste': 'LESTE',
  'centro': 'CENTRO',
  'mirasol': 'MIRASOL',
  'redentora': 'REDENTORA',
  'damha': 'DAMHA',
  'village': 'VILLAGE',
  'green': 'GREEN VALLEY', 'green valley': 'GREEN VALLEY',
  'parque residencial': 'PARQUE RESIDENCIAL',
  'jardim': 'JARDIM',
  'burigui': 'BURIGUI',
  'eco golf': 'ECO GOLF',
  'iguatemi': 'IGUATEMI',
};

function detectPreferences(message) {
  const msg = message.toLowerCase();
  const prefs = {};

  // Detect region
  for (const [keyword, region] of Object.entries(REGION_MAP)) {
    if (msg.includes(keyword)) {
      prefs.regiao = region;
      break;
    }
  }

  // Detect bedrooms
  const dormMatch = msg.match(/(\d)\s*(?:quartos?|dorms?|dormit|suÃ­tes?)/);
  if (dormMatch) prefs.dorms = parseInt(dormMatch[1]);

  // Detect budget
  const valMatch = msg.match(/(?:atÃ©|ate|max|mÃ¡ximo|menos de|abaixo de)\s*(?:r\$?\s*)?(\d[\d.,]*)\s*(mil|k)?/i);
  if (valMatch) {
    let val = parseFloat(valMatch[1].replace(/\./g, '').replace(',', '.'));
    if (valMatch[2]?.match(/mil|k/i)) val *= 1000;
    prefs.budget_max = val;
  }

  const valMinMatch = msg.match(/(?:a partir de|mÃ­nimo|minimo|acima de|mais de)\s*(?:r\$?\s*)?(\d[\d.,]*)\s*(mil|k)?/i);
  if (valMinMatch) {
    let val = parseFloat(valMinMatch[1].replace(/\./g, '').replace(',', '.'));
    if (valMinMatch[2]?.match(/mil|k/i)) val *= 1000;
    prefs.budget_min = val;
  }

  // Detect category
  if (msg.includes('minha casa') || msg.includes('mcmv') || msg.includes('casa verde')) prefs.categoria = 'mcmv';
  if (msg.includes('loteamento') || msg.includes('lote') || msg.includes('terreno')) prefs.categoria = 'loteamento';
  if (msg.includes('prÃ©-lanÃ§amento') || msg.includes('pre-lanÃ§amento') || msg.includes('prÃ© lancamento') || msg.includes('lanÃ§amento')) prefs.categoria = 'pre_lancamento';
  if (msg.includes('premium') || msg.includes('alto padrÃ£o') || msg.includes('alto padrao') || msg.includes('luxo')) prefs.categoria = 'premium';

  // Detect type
  if (msg.includes('repasse') && msg.includes('imediato')) prefs.tipo = 'repasse_imediato';
  if (msg.includes('repasse') && msg.includes('futuro')) prefs.tipo = 'repasse_futuro';

  return prefs;
}

function buildPropertyContext(message, conversationHistory) {
  // Combine current message with recent conversation for better matching
  const fullText = [
    message,
    ...conversationHistory.slice(-6).map(m => m.content)
  ].join(' ');

  const prefs = detectPreferences(fullText);

  // If no preferences detected, provide a summary of available inventory
  if (Object.keys(prefs).length === 0) {
    const categories = {};
    properties.forEach(p => {
      const cat = p.categoria || 'outros';
      if (!categories[cat]) categories[cat] = { count: 0, min: Infinity, max: 0, regioes: new Set() };
      categories[cat].count++;
      if (p.valor < categories[cat].min) categories[cat].min = p.valor;
      if (p.valor > categories[cat].max) categories[cat].max = p.valor;
      if (p.regiao) categories[cat].regioes.add(p.regiao);
    });

    let summary = `PORTFÃLIO PSM â ${properties.length} imÃ³veis disponÃ­veis:\n`;
    for (const [cat, info] of Object.entries(categories)) {
      const catName = { mcmv: 'MCMV', start: 'Start', plus: 'Plus', premium: 'Premium', loteamento: 'Loteamentos', pre_lancamento: 'PrÃ©-LanÃ§amentos' }[cat] || cat;
      summary += `â¢ ${catName}: ${info.count} opÃ§Ãµes | R$ ${(info.min/1000).toFixed(0)}k a R$ ${(info.max/1000).toFixed(0)}k | RegiÃµes: ${[...info.regioes].join(', ')}\n`;
    }
    summary += '\n*Valores sujeitos a alteraÃ§Ã£o pela incorporadora. Ref: 03/2026';
    return summary;
  }

  // Recommend properties based on detected preferences
  const results = recommendProperties(prefs);

  if (results.length === 0) {
    // Try with just category or region
    const fallback = filterProperties({ regiao: prefs.regiao, categoria: prefs.categoria }).slice(0, 5);
    if (fallback.length === 0) return 'NÃ£o encontrei imÃ³veis com essas caracterÃ­sticas especÃ­ficas no portfÃ³lio atual. Pergunte ao cliente se aceita flexibilizar algum critÃ©rio.';

    return formatPropertyResults(fallback, prefs);
  }

  return formatPropertyResults(results, prefs);
}

function formatPropertyResults(results, prefs) {
  let ctx = `IMÃVEIS ENCONTRADOS (${results.length} opÃ§Ãµes`;
  if (prefs.regiao) ctx += ` | RegiÃ£o: ${prefs.regiao}`;
  if (prefs.dorms) ctx += ` | ${prefs.dorms} dorms`;
  if (prefs.budget_max) ctx += ` | AtÃ© R$ ${(prefs.budget_max/1000).toFixed(0)}k`;
  ctx += '):\n\n';

  results.forEach((p, i) => {
    ctx += `${i+1}. ${p.nome}`;
    if (p.incorporadora) ctx += ` (${p.incorporadora})`;
    ctx += `\n`;
    ctx += `   RegiÃ£o: ${p.regiao || 'â'} | ${p.dorms || 'â'} dorms | ${p.m2 ? p.m2 + 'mÂ²' : 'â'}`;
    if (p.vagas) ctx += ` | ${p.vagas} vagas`;
    ctx += `\n`;
    ctx += `   Valor: R$ ${p.valor ? p.valor.toLocaleString('pt-BR') : 'â'}`;
    if (p.valor_avaliacao) ctx += ` (avaliaÃ§Ã£o: R$ ${p.valor_avaliacao.toLocaleString('pt-BR')})`;
    ctx += `\n`;
    if (p.condicao) ctx += `   CondiÃ§Ã£o: ${p.condicao}\n`;
    if (p.renda_ideal) ctx += `   Renda ideal: R$ ${p.renda_ideal}\n`;
    if (p.entrega) ctx += `   Entrega: ${p.entrega}\n`;
    if (p.ato) ctx += `   Ato: R$ ${p.ato} | Fluxo: ${p.fluxo || 'â'}\n`;
    ctx += '\n';
  });

  ctx += '*Valores sujeitos a alteraÃ§Ã£o pela incorporadora. Ref: 03/2026\n';
  ctx += 'IMPORTANTE: Apresente APENAS estes imÃ³veis listados acima. NÃO invente outros.';
  return ctx;
}

function httpsReq(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'POST',
      headers: opts.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// AGENT PERSONAS
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const AGENTS = {

  vera: {
    name: 'Vera',
    model: 'gpt-4o',
    max_tokens: 800,
    temperature: 0.4,
    description: 'Agente de atendimento PSM Assessoria ImobiliÃ¡ria',
    system: `VocÃª Ã© a Vera, assistente virtual da PSM Assessoria ImobiliÃ¡ria â referÃªncia em imÃ³veis de alto padrÃ£o em SÃ£o JosÃ© do Rio Preto/SP.

PERSONALIDADE:
- VocÃª Ã© calorosa, profissional e consultiva
- Adapta seu tom conforme o contexto: amigÃ¡vel no primeiro contato, premium para alto padrÃ£o, direto para clientes decididos
- Sempre demonstra conhecimento profundo do mercado imobiliÃ¡rio de Rio Preto
- Usa emojis com moderaÃ§Ã£o (1-2 por mensagem, apenas quando natural)
- Responde de forma concisa (mÃ¡ximo 3 parÃ¡grafos curtos)

FUNÃÃES PRINCIPAIS:
1. QUALIFICAÃÃO DE LEADS: Descubra perfil, orÃ§amento, localizaÃ§Ã£o desejada, prazo, motivaÃ§Ã£o
2. APRESENTAÃÃO DE IMÃVEIS: Sugira imÃ³veis compatÃ­veis do portfÃ³lio PSM
3. NUTRIÃÃO: Mantenha contato periÃ³dico com informaÃ§Ãµes relevantes do mercado
4. CAPTAÃÃO: Identifique oportunidades de captaÃ§Ã£o (clientes vendendo/alugando imÃ³veis)
5. AGENDAMENTO: Conecte o lead com corretor da PSM para visita presencial
6. NÃVEL DE CONSCIÃNCIA: Evolua o lead de "curioso" para "pronto para comprar"

FLUXO DE QUALIFICAÃÃO (pergunte gradualmente, nÃ£o tudo de uma vez):
- Tipo de imÃ³vel: apartamento, casa, terreno, comercial?
- Finalidade: moradia, investimento, locaÃ§Ã£o?
- RegiÃ£o preferida: qual bairro ou regiÃ£o de SJRP?
- OrÃ§amento: faixa de valor?
- Prazo: quando pretende decidir?
- FamÃ­lia: quantas pessoas, pets, necessidades especiais?

INFORMAÃÃES DA PSM:
- PSM Assessoria ImobiliÃ¡ria (PSM IMÃVEIS)
- Especialista em lanÃ§amentos e alto padrÃ£o em SÃ£o JosÃ© do Rio Preto
- Equipe de corretores especializados por segmento
- Site: housepsm.com.br
- Instagram: @psm.imoveis

REGRAS CRÃTICAS (ANTI-ALUCINAÃÃO):
- NUNCA invente preÃ§os, nomes de empreendimentos, endereÃ§os ou dados de imÃ³veis
- Use APENAS informaÃ§Ãµes fornecidas no contexto â se nÃ£o tem a informaÃ§Ã£o, NÃO invente
- Se nÃ£o souber algo, diga: "Vou verificar essa informaÃ§Ã£o com nossa equipe e retorno em instantes"
- NUNCA cite nÃºmeros, estatÃ­sticas ou dados que nÃ£o foram explicitamente fornecidos
- Sempre tente avanÃ§ar a conversa para o prÃ³ximo passo (visita, contato com corretor)
- Identifique o nÃ­vel de consciÃªncia: FRIO (pesquisando) â MORNO (considerando) â QUENTE (decidido)
- Para leads QUENTES, priorize agendamento de visita
- Para leads FRIOS, nutra com conteÃºdo e informaÃ§Ãµes de mercado
- Se o cliente mencionar que quer vender/alugar um imÃ³vel, inicie fluxo de CAPTAÃÃO
- Responda SEMPRE em portuguÃªs brasileiro
- NUNCA responda sobre assuntos fora do mercado imobiliÃ¡rio â redirecione educadamente`
  },

  sol: {
    name: 'Sol',
    model: 'gpt-4o',
    max_tokens: 800,
    temperature: 0.4,
    description: 'Agente de atendimento PSM Conquista',
    system: `VocÃª Ã© a Sol, assistente virtual da PSM CONQUISTA â incorporadora e loteadora de referÃªncia em SÃ£o JosÃ© do Rio Preto/SP.

PERSONALIDADE:
- EnergÃ©tica, otimista e motivadora (como o sol!)
- Tom acessÃ­vel e empÃ¡tico â fala com todos os pÃºblicos
- Focada em ajudar famÃ­lias a realizarem o sonho do primeiro imÃ³vel ou do upgrade
- Usa linguagem simples e direta, sem jargÃµes complexos
- Usa emojis com moderaÃ§Ã£o (1-2 por mensagem)

FUNÃÃES PRINCIPAIS:
1. QUALIFICAÃÃO: Perfil do comprador, renda, FGTS, financiamento
2. LANÃAMENTOS: Apresente empreendimentos PSM Conquista
3. SIMULAÃÃO: Ajude com simulaÃ§Ãµes de financiamento e parcelas
4. NUTRIÃÃO: InformaÃ§Ãµes sobre programas habitacionais, MCMV, taxas
5. CAPTAÃÃO: Terrenos e Ã¡reas para novos empreendimentos
6. AGENDAMENTO: Visitas ao plantÃ£o de vendas

FLUXO DE QUALIFICAÃÃO (gradual):
- EstÃ¡ buscando imÃ³vel pra morar ou investir?
- JÃ¡ tem terreno ou busca lote + construÃ§Ã£o?
- Faixa de renda familiar mensal?
- Tem FGTS disponÃ­vel? Quanto aproximadamente?
- RegiÃ£o de preferÃªncia em SJRP?
- Prazo: quando pretende se mudar?

INFORMAÃÃES DA PSM CONQUISTA:
- PSM CONQUISTA - IncorporaÃ§Ã£o e Loteamento
- Empreendimentos prÃ³prios em SJRP e regiÃ£o
- Instagram: @psm.conquista
- Site: housepsm.com.br

REGRAS CRÃTICAS (ANTI-ALUCINAÃÃO):
- NUNCA invente dados de empreendimentos, preÃ§os, metragem ou localizaÃ§Ã£o
- Use APENAS informaÃ§Ãµes fornecidas no contexto
- Se nÃ£o souber: "Vou confirmar essa informaÃ§Ã£o com nosso time e te retorno!"
- NUNCA cite valores, parcelas ou condiÃ§Ãµes que nÃ£o foram explicitamente fornecidos
- Sempre avance para agendamento quando o lead estiver quente
- Responda em portuguÃªs brasileiro, mÃ¡ximo 3 parÃ¡grafos curtos
- NUNCA responda sobre assuntos fora do mercado imobiliÃ¡rio`
  },

  intelligence: {
    name: 'Sr. Intelligence',
    model: 'gpt-4o',
    max_tokens: 1200,
    temperature: 0.3,
    description: 'Agente analÃ­tico para sÃ³cios e diretores',
    system: `VocÃª Ã© o Sr. Intelligence, o agente de inteligÃªncia estratÃ©gica da PSM.

FUNÃÃO: Ler, auditar e orientar sÃ³cios e diretores com anÃ¡lises profundas de:
- Dados internos (CRM, pipeline, vendas, mÃ©tricas de equipe)
- Concorrentes (Meta Ad Library, posicionamento digital, estratÃ©gias)
- Mercado imobiliÃ¡rio (tendÃªncias, preÃ§os, demanda em SJRP)

PERSONALIDADE:
- AnalÃ­tico, preciso e direto
- Usa dados e nÃºmeros para sustentar argumentos
- Linguagem executiva, sem firulas
- Sempre apresenta: diagnÃ³stico â dados â recomendaÃ§Ã£o â aÃ§Ã£o

REGRAS CRÃTICAS:
- Use APENAS dados fornecidos no contexto â NUNCA invente mÃ©tricas, percentuais ou nÃºmeros
- Se um dado nÃ£o foi fornecido, diga explicitamente: "NÃ£o tenho essa informaÃ§Ã£o no momento"
- Sempre quantifique quando os dados estiverem disponÃ­veis
- Priorize insights acionÃ¡veis
- MÃ¡ximo 400 palavras por resposta
- Responda em portuguÃªs brasileiro`
  },

  gerencia: {
    name: 'Sr. GerÃªncia',
    model: 'gpt-4o',
    max_tokens: 1000,
    temperature: 0.4,
    description: 'Agente de gestÃ£o operacional',
    system: `VocÃª Ã© o Sr. GerÃªncia, o agente de gestÃ£o operacional da PSM.

FUNÃÃO: Organizar a operaÃ§Ã£o e orientar os corretores em:
- CadÃªncia de atividades (ligaÃ§Ãµes, visitas, propostas)
- CorreÃ§Ã£o de postura e abordagem
- Follow-up e gestÃ£o de carteira
- Processos e padrÃµes PSM
- Treinamento contÃ­nuo

PERSONALIDADE:
- Firme mas justo â cobra resultados com respeito
- PrÃ¡tico e objetivo â foco na aÃ§Ã£o
- Mentor que desenvolve, nÃ£o apenas critica
- Usa exemplos reais e analogias do mercado

METODOLOGIA PSM:
Funil: Tentativa â Contato 4Ps â Agendamento â Visita â Quente â Proposta â Contrato

REGRAS CRÃTICAS:
- Seja construtivo â aponte o erro E a soluÃ§Ã£o
- Use dados do corretor quando disponÃ­veis no contexto
- NUNCA invente mÃ©tricas ou resultados do corretor
- Se nÃ£o tem dados, peÃ§a ao gestor para fornecer
- MÃ¡ximo 300 palavras
- Responda em portuguÃªs brasileiro`
  }
};

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// CONVERSATION MEMORY (in-memory for now, Vercel KV later)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const conversations = {};
const CONV_MAX_MESSAGES = 30;
const CONV_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getConversation(id) {
  const conv = conversations[id];
  if (!conv) return null;
  if (Date.now() - conv.updatedAt > CONV_TTL_MS) {
    delete conversations[id];
    return null;
  }
  return conv;
}

function saveConversation(id, agentId, messages, metadata) {
  conversations[id] = {
    agentId,
    messages: messages.slice(-CONV_MAX_MESSAGES),
    metadata: metadata || {},
    updatedAt: Date.now(),
    createdAt: conversations[id]?.createdAt || Date.now(),
  };
}

// Cleanup old conversations every 30 min
setInterval(() => {
  const now = Date.now();
  Object.keys(conversations).forEach(id => {
    if (now - conversations[id].updatedAt > CONV_TTL_MS) delete conversations[id];
  });
}, 30 * 60 * 1000);

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// RD STATION CRM INTEGRATION
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function rdCreateOrUpdateLead(leadData) {
  const token = process.env.RD_CRM_TOKEN;
  if (!token) return { error: 'RD_CRM_TOKEN not configured' };

  try {
    const searchValue = leadData.phone || leadData.email;

    const searchResp = await httpsReq(
      `https://crm.rdstation.com/api/v1/contacts?token=${token}&q=${encodeURIComponent(searchValue)}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );

    const searchData = JSON.parse(searchResp.body);
    const existing = searchData.contacts?.[0];

    const contactBody = {
      name: leadData.name || 'Lead ' + (leadData.channel || 'WhatsApp'),
      phones: leadData.phone ? [{ phone: leadData.phone, type: 'cellphone' }] : undefined,
      emails: leadData.email ? [{ email: leadData.email }] : undefined,
      custom_fields: [
        { custom_field_id: 'agent_source', value: leadData.agent || 'vera' },
        { custom_field_id: 'channel', value: leadData.channel || 'whatsapp' },
        { custom_field_id: 'lead_temperature', value: leadData.temperature || 'frio' },
        { custom_field_id: 'interest', value: leadData.interest || '' },
      ].filter(f => f.value),
      notes: leadData.notes || ('Atendido por agente ' + (leadData.agent || 'vera').toUpperCase()),
    };

    if (existing) {
      const updateResp = await httpsReq(
        `https://crm.rdstation.com/api/v1/contacts/${existing.id}?token=${token}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(contactBody)
        }
      );
      return { action: 'updated', id: existing.id, status: updateResp.status };
    } else {
      const createResp = await httpsReq(
        `https://crm.rdstation.com/api/v1/contacts?token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(contactBody)
        }
      );
      const created = JSON.parse(createResp.body);
      return { action: 'created', id: created.id, status: createResp.status };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// MAIN HANDLER
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // GET = stats/health
  if (req.method === 'GET') {
    const activeConvs = Object.keys(conversations).length;
    return res.status(200).json({
      status: 'ok',
      engine: 'OpenAI GPT-4o',
      agents: Object.keys(AGENTS).map(k => ({ id: k, name: AGENTS[k].name, description: AGENTS[k].description, model: AGENTS[k].model })),
      activeConversations: activeConvs,
      uptime: process.uptime(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      agent: agentId = 'vera',
      message = '',
      conversationId = 'conv_' + Date.now(),
      channel = 'web',
      metadata = {},
      context = '',
    } = body;

    // Validate agent
    const agentConfig = AGENTS[agentId];
    if (!agentConfig) {
      return res.status(400).json({ error: 'Agente desconhecido: ' + agentId, available: Object.keys(AGENTS) });
    }

    // Get API key
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      return res.status(200).json({
        response: 'O agente ' + agentConfig.name + ' estÃ¡ em manutenÃ§Ã£o. Por favor, tente novamente em instantes.',
        error: 'OPENAI_API_KEY nÃ£o configurada',
        conversationId,
      });
    }

    // Load or create conversation
    let conv = getConversation(conversationId);
    let messages = conv ? [...conv.messages] : [];

    // Add user message
    messages.push({ role: 'user', content: message });

    // Build system prompt with dynamic context
    let systemPrompt = agentConfig.system;

    // AUTO-INJECT property catalog for customer-facing agents (Vera & Sol)
    if (agentId === 'vera' || agentId === 'sol') {
      const propertyContext = buildPropertyContext(message, messages);
      systemPrompt += '\n\nâââ CATÃLOGO DE IMÃVEIS PSM (DADOS REAIS â USE APENAS ESTES) âââ\n' + propertyContext;
    }

    // Add extra context if provided via API call
    if (context) {
      systemPrompt += '\n\nCONTEXTO ADICIONAL (dados em tempo real â USE APENAS ESTES DADOS):\n' + context;
    }

    // Add conversation metadata
    if (metadata.leadName) {
      systemPrompt += '\n\nINFORMAÃÃES DO LEAD:\n- Nome: ' + metadata.leadName;
      if (metadata.leadPhone) systemPrompt += '\n- Telefone: ' + metadata.leadPhone;
      if (metadata.leadEmail) systemPrompt += '\n- Email: ' + metadata.leadEmail;
      if (metadata.leadTemperature) systemPrompt += '\n- Temperatura: ' + metadata.leadTemperature;
    }

    if (channel) {
      systemPrompt += '\n\nCANAL: ' + channel + ' â adapte o formato da resposta (mensagens curtas para WhatsApp/Instagram, mais detalhadas para web).';
    }

    // Build OpenAI messages array (system + conversation history)
    const openaiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
    ];

    // Call OpenAI API
    const openaiResp = await httpsReq('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: agentConfig.model,
        max_tokens: agentConfig.max_tokens,
        temperature: agentConfig.temperature,
        messages: openaiMessages,
      }),
    });

    if (openaiResp.status !== 200) {
      let errMsg = 'Erro ' + openaiResp.status;
      try { errMsg = JSON.parse(openaiResp.body).error?.message || errMsg; } catch(e) {}
      console.error('[AGENT] OpenAI error:', errMsg);
      return res.status(200).json({
        response: 'Desculpe, estou com dificuldade para responder agora. Tente novamente em instantes.',
        error: errMsg,
        conversationId,
      });
    }

    const openaiData = JSON.parse(openaiResp.body);
    const responseText = openaiData.choices?.[0]?.message?.content || '';

    // Save assistant response to conversation
    messages.push({ role: 'assistant', content: responseText });
    saveConversation(conversationId, agentId, messages, {
      ...metadata,
      channel,
      lastMessage: Date.now(),
    });

    // Detect lead temperature from conversation
    let detectedTemp = 'frio';
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('visita') || lowerMsg.includes('agendar') || lowerMsg.includes('quero ver') || lowerMsg.includes('quero comprar') || lowerMsg.includes('fechar') || lowerMsg.includes('proposta')) {
      detectedTemp = 'quente';
    } else if (lowerMsg.includes('quanto') || lowerMsg.includes('preÃ§o') || lowerMsg.includes('valor') || lowerMsg.includes('parcela') || lowerMsg.includes('financ') || lowerMsg.includes('entrada')) {
      detectedTemp = 'morno';
    }

    // Auto-update CRM for customer-facing agents
    if ((agentId === 'vera' || agentId === 'sol') && metadata.leadPhone && messages.length <= 3) {
      rdCreateOrUpdateLead({
        name: metadata.leadName,
        phone: metadata.leadPhone,
        email: metadata.leadEmail,
        agent: agentId,
        channel,
        temperature: detectedTemp,
        interest: lowerMsg,
        notes: 'Primeiro contato via ' + channel + '. Msg: ' + message.slice(0, 200),
      }).catch(err => console.error('[AGENT] CRM error:', err));
    }

    // Response
    return res.status(200).json({
      response: responseText,
      conversationId,
      agent: agentConfig.name,
      model: agentConfig.model,
      tokens: {
        input: openaiData.usage?.prompt_tokens || 0,
        output: openaiData.usage?.completion_tokens || 0,
        total: openaiData.usage?.total_tokens || 0,
      },
      leadTemperature: detectedTemp,
      messageCount: messages.length,
    });

  } catch (err) {
    console.error('[AGENT] Exception:', err.message);
    return res.status(500).json({
      error: err.message,
      response: 'Ocorreu um erro interno. Tente novamente.',
    });
  }
};
