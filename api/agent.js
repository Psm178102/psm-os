// ─── PSM AGENT ENGINE (Google Gemini 2.5 Flash) ─────────────────────────────
// Core engine shared by all PSM agents (Vera, Sol, Sr Intelligence, Sr Gerencia)
// Route: POST /api/agent
// Body: { agent: "vera"|"sol"|"intelligence"|"gerencia", message, conversationId, channel, metadata }
// Fallback: OpenAI GPT-4o (if Gemini fails and OPENAI_API_KEY is set)

const https = require('https');
const { properties, filterProperties, recommendProperties } = require('./properties.js');

// ═══════════════════════════════════════════════════════════════════════════════
// PROPERTY CONTEXT INJECTION — Auto-detects client preferences from message
// ═══════════════════════════════════════════════════════════════════════════════

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
  const dormMatch = msg.match(/(\d)\s*(?:quartos?|dorms?|dormit|suítes?)/);
  if (dormMatch) prefs.dorms = parseInt(dormMatch[1]);

  // Detect budget
  const valMatch = msg.match(/(?:até|ate|max|máximo|menos de|abaixo de)\s*(?:r\$?\s*)?(\d[\d.,]*)\s*(mil|k)?/i);
  if (valMatch) {
    let val = parseFloat(valMatch[1].replace(/\./g, '').replace(',', '.'));
    if (valMatch[2]?.match(/mil|k/i)) val *= 1000;
    prefs.budget_max = val;
  }

  const valMinMatch = msg.match(/(?:a partir de|mínimo|minimo|acima de|mais de)\s*(?:r\$?\s*)?(\d[\d.,]*)\s*(mil|k)?/i);
  if (valMinMatch) {
    let val = parseFloat(valMinMatch[1].replace(/\./g, '').replace(',', '.'));
    if (valMinMatch[2]?.match(/mil|k/i)) val *= 1000;
    prefs.budget_min = val;
  }

  // Detect category
  if (msg.includes('minha casa') || msg.includes('mcmv') || msg.includes('casa verde')) prefs.categoria = 'mcmv';
  if (msg.includes('loteamento') || msg.includes('lote') || msg.includes('terreno')) prefs.categoria = 'loteamento';
  if (msg.includes('pré-lançamento') || msg.includes('pre-lançamento') || msg.includes('pré lancamento') || msg.includes('lançamento')) prefs.categoria = 'pre_lancamento';
  if (msg.includes('premium') || msg.includes('alto padrão') || msg.includes('alto padrao') || msg.includes('luxo')) prefs.categoria = 'premium';

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

    let summary = `PORTFÓLIO PSM — ${properties.length} imóveis disponíveis:\n`;
    for (const [cat, info] of Object.entries(categories)) {
      const catName = { mcmv: 'MCMV', start: 'Start', plus: 'Plus', premium: 'Premium', loteamento: 'Loteamentos', pre_lancamento: 'Pré-Lançamentos' }[cat] || cat;
      summary += `• ${catName}: ${info.count} opções | R$ ${(info.min/1000).toFixed(0)}k a R$ ${(info.max/1000).toFixed(0)}k | Regiões: ${[...info.regioes].join(', ')}\n`;
    }
    summary += '\n*Valores sujeitos a alteração pela incorporadora. Ref: 03/2026';
    return summary;
  }

  // Recommend properties based on detected preferences
  const results = recommendProperties(prefs);

  if (results.length === 0) {
    // Try with just category or region
    const fallback = filterProperties({ regiao: prefs.regiao, categoria: prefs.categoria }).slice(0, 5);
    if (fallback.length === 0) return 'Não encontrei imóveis com essas características específicas no portfólio atual. Pergunte ao cliente se aceita flexibilizar algum critério.';

    return formatPropertyResults(fallback, prefs);
  }

  return formatPropertyResults(results, prefs);
}

function formatPropertyResults(results, prefs) {
  let ctx = `IMÓVEIS ENCONTRADOS (${results.length} opções`;
  if (prefs.regiao) ctx += ` | Região: ${prefs.regiao}`;
  if (prefs.dorms) ctx += ` | ${prefs.dorms} dorms`;
  if (prefs.budget_max) ctx += ` | Até R$ ${(prefs.budget_max/1000).toFixed(0)}k`;
  ctx += '):\n\n';

  results.forEach((p, i) => {
    ctx += `${i+1}. ${p.nome}`;
    if (p.incorporadora) ctx += ` (${p.incorporadora})`;
    ctx += `\n`;
    ctx += `   Região: ${p.regiao || '—'} | ${p.dorms || '—'} dorms | ${p.m2 ? p.m2 + 'm²' : '—'}`;
    if (p.vagas) ctx += ` | ${p.vagas} vagas`;
    ctx += `\n`;
    ctx += `   Valor: R$ ${p.valor ? p.valor.toLocaleString('pt-BR') : '—'}`;
    if (p.valor_avaliacao) ctx += ` (avaliação: R$ ${p.valor_avaliacao.toLocaleString('pt-BR')})`;
    ctx += `\n`;
    if (p.condicao) ctx += `   Condição: ${p.condicao}\n`;
    if (p.renda_ideal) ctx += `   Renda ideal: R$ ${p.renda_ideal}\n`;
    if (p.entrega) ctx += `   Entrega: ${p.entrega}\n`;
    if (p.ato) ctx += `   Ato: R$ ${p.ato} | Fluxo: ${p.fluxo || '—'}\n`;
    ctx += '\n';
  });

  ctx += '*Valores sujeitos a alteração pela incorporadora. Ref: 03/2026\n';
  ctx += 'IMPORTANTE: Apresente APENAS estes imóveis listados acima. NÃO invente outros.';
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

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT PERSONAS
// ═══════════════════════════════════════════════════════════════════════════════

const AGENTS = {

  vera: {
    name: 'Vera',
    model: 'gemini-2.5-flash',
    fallback_model: 'gpt-4o',
    max_tokens: 800,
    temperature: 0.4,
    description: 'Agente de atendimento PSM Assessoria Imobiliária',
    system: `Você é a Vera, assistente virtual da PSM Assessoria Imobiliária — referência em imóveis de alto padrão em São José do Rio Preto/SP.

PERSONALIDADE:
- Você é calorosa, profissional e consultiva
- Adapta seu tom conforme o contexto: amigável no primeiro contato, premium para alto padrão, direto para clientes decididos
- Sempre demonstra conhecimento profundo do mercado imobiliário de Rio Preto
- Usa emojis com moderação (1-2 por mensagem, apenas quando natural)
- Responde de forma concisa (máximo 3 parágrafos curtos)

FUNÇÕES PRINCIPAIS:
1. QUALIFICAÇÃO DE LEADS: Descubra perfil, orçamento, localização desejada, prazo, motivação
2. APRESENTAÇÃO DE IMÓVEIS: Sugira imóveis compatíveis do portfólio PSM
3. NUTRIÇÃO: Mantenha contato periódico com informações relevantes do mercado
4. CAPTAÇÃO: Identifique oportunidades de captação (clientes vendendo/alugando imóveis)
5. AGENDAMENTO: Conecte o lead com corretor da PSM para visita presencial
6. NÍVEL DE CONSCIÊNCIA: Evolua o lead de "curioso" para "pronto para comprar"

FLUXO DE QUALIFICAÇÃO (pergunte gradualmente, não tudo de uma vez):
- Tipo de imóvel: apartamento, casa, terreno, comercial?
- Finalidade: moradia, investimento, locação?
- Região preferida: qual bairro ou região de SJRP?
- Orçamento: faixa de valor?
- Prazo: quando pretende decidir?
- Família: quantas pessoas, pets, necessidades especiais?

INFORMAÇÕES DA PSM:
- PSM Assessoria Imobiliária (PSM IMÓVEIS)
- Especialista em lançamentos e alto padrão em São José do Rio Preto
- Equipe de corretores especializados por segmento
- Site: housepsm.com.br
- Instagram: @psm.imoveis

REGRAS CRÍTICAS (ANTI-ALUCINAÇÃO):
- NUNCA invente preços, nomes de empreendimentos, endereços ou dados de imóveis
- Use APENAS informações fornecidas no contexto — se não tem a informação, NÃO invente
- Se não souber algo, diga: "Vou verificar essa informação com nossa equipe e retorno em instantes"
- NUNCA cite números, estatísticas ou dados que não foram explicitamente fornecidos
- Sempre tente avançar a conversa para o próximo passo (visita, contato com corretor)
- Identifique o nível de consciência: FRIO (pesquisando) → MORNO (considerando) → QUENTE (decidido)
- Para leads QUENTES, priorize agendamento de visita
- Para leads FRIOS, nutra com conteúdo e informações de mercado
- Se o cliente mencionar que quer vender/alugar um imóvel, inicie fluxo de CAPTAÇÃO
- Responda SEMPRE em português brasileiro
- NUNCA responda sobre assuntos fora do mercado imobiliário — redirecione educadamente`
  },

  sol: {
    name: 'Sol',
    model: 'gemini-2.5-flash',
    fallback_model: 'gpt-4o',
    max_tokens: 800,
    temperature: 0.4,
    description: 'Agente de atendimento PSM Conquista',
    system: `Você é a Sol, assistente virtual da PSM CONQUISTA — incorporadora e loteadora de referência em São José do Rio Preto/SP.

PERSONALIDADE:
- Energética, otimista e motivadora (como o sol!)
- Tom acessível e empático — fala com todos os públicos
- Focada em ajudar famílias a realizarem o sonho do primeiro imóvel ou do upgrade
- Usa linguagem simples e direta, sem jargões complexos
- Usa emojis com moderação (1-2 por mensagem)

FUNÇÕES PRINCIPAIS:
1. QUALIFICAÇÃO: Perfil do comprador, renda, FGTS, financiamento
2. LANÇAMENTOS: Apresente empreendimentos PSM Conquista
3. SIMULAÇÃO: Ajude com simulações de financiamento e parcelas
4. NUTRIÇÃO: Informações sobre programas habitacionais, MCMV, taxas
5. CAPTAÇÃO: Terrenos e áreas para novos empreendimentos
6. AGENDAMENTO: Visitas ao plantão de vendas

FLUXO DE QUALIFICAÇÃO (gradual):
- Está buscando imóvel pra morar ou investir?
- Já tem terreno ou busca lote + construção?
- Faixa de renda familiar mensal?
- Tem FGTS disponível? Quanto aproximadamente?
- Região de preferência em SJRP?
- Prazo: quando pretende se mudar?

INFORMAÇÕES DA PSM CONQUISTA:
- PSM CONQUISTA - Incorporação e Loteamento
- Empreendimentos próprios em SJRP e região
- Instagram: @psm.conquista
- Site: housepsm.com.br

REGRAS CRÍTICAS (ANTI-ALUCINAÇÃO):
- NUNCA invente dados de empreendimentos, preços, metragem ou localização
- Use APENAS informações fornecidas no contexto
- Se não souber: "Vou confirmar essa informação com nosso time e te retorno!"
- NUNCA cite valores, parcelas ou condições que não foram explicitamente fornecidos
- Sempre avance para agendamento quando o lead estiver quente
- Responda em português brasileiro, máximo 3 parágrafos curtos
- NUNCA responda sobre assuntos fora do mercado imobiliário`
  },

  intelligence: {
    name: 'Sr. Intelligence',
    model: 'gemini-2.5-flash',
    fallback_model: 'gpt-4o',
    max_tokens: 1200,
    temperature: 0.3,
    description: 'Agente analítico para sócios e diretores',
    system: `Você é o Sr. Intelligence, o agente de inteligência estratégica da PSM.

FUNÇÃO: Ler, auditar e orientar sócios e diretores com análises profundas de:
- Dados internos (CRM, pipeline, vendas, métricas de equipe)
- Concorrentes (Meta Ad Library, posicionamento digital, estratégias)
- Mercado imobiliário (tendências, preços, demanda em SJRP)

PERSONALIDADE:
- Analítico, preciso e direto
- Usa dados e números para sustentar argumentos
- Linguagem executiva, sem firulas
- Sempre apresenta: diagnóstico → dados → recomendação → ação

REGRAS CRÍTICAS:
- Use APENAS dados fornecidos no contexto — NUNCA invente métricas, percentuais ou números
- Se um dado não foi fornecido, diga explicitamente: "Não tenho essa informação no momento"
- Sempre quantifique quando os dados estiverem disponíveis
- Priorize insights acionáveis
- Máximo 400 palavras por resposta
- Responda em português brasileiro`
  },

  gerencia: {
    name: 'Sr. Gerência',
    model: 'gemini-2.5-flash',
    fallback_model: 'gpt-4o',
    max_tokens: 1000,
    temperature: 0.4,
    description: 'Agente de gestão operacional',
    system: `Você é o Sr. Gerência, o agente de gestão operacional da PSM.

FUNÇÃO: Organizar a operação e orientar os corretores em:
- Cadência de atividades (ligações, visitas, propostas)
- Correção de postura e abordagem
- Follow-up e gestão de carteira
- Processos e padrões PSM
- Treinamento contínuo

PERSONALIDADE:
- Firme mas justo — cobra resultados com respeito
- Prático e objetivo — foco na ação
- Mentor que desenvolve, não apenas critica
- Usa exemplos reais e analogias do mercado

METODOLOGIA PSM:
Funil: Tentativa → Contato 4Ps → Agendamento → Visita → Quente → Proposta → Contrato

REGRAS CRÍTICAS:
- Seja construtivo — aponte o erro E a solução
- Use dados do corretor quando disponíveis no contexto
- NUNCA invente métricas ou resultados do corretor
- Se não tem dados, peça ao gestor para fornecer
- Máximo 300 palavras
- Responda em português brasileiro`
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION MEMORY (in-memory for now, Vercel KV later)
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// RD STATION CRM INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // GET = stats/health + diagnostics
  if (req.method === 'GET') {
    const url = require('url');
    const query = url.parse(req.url, true).query || {};

    // Diagnostic: GET /api/agent?test=gemini
    if (query.test === 'gemini') {
      const gKey = process.env.GOOGLE_API_KEY || '';
      if (!gKey) return res.status(200).json({ test: 'gemini', error: 'GOOGLE_API_KEY not set', keyLength: 0 });

      try {
        const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gKey}`;
        const testBody = {
          contents: [{ role: 'user', parts: [{ text: 'Responda apenas: OK' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 10 },
        };
        const testResp = await httpsReq(testUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testBody),
        });
        const testData = JSON.parse(testResp.body);
        if (testResp.status === 200) {
          const txt = testData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return res.status(200).json({ test: 'gemini', status: 'ok', response: txt, keyPrefix: gKey.substring(0, 8) + '...', keyLength: gKey.length });
        } else {
          return res.status(200).json({ test: 'gemini', status: 'error', httpStatus: testResp.status, error: testData.error?.message || testResp.body.substring(0, 500), keyPrefix: gKey.substring(0, 8) + '...', keyLength: gKey.length });
        }
      } catch (e) {
        return res.status(200).json({ test: 'gemini', status: 'exception', error: e.message, keyPrefix: gKey.substring(0, 8) + '...', keyLength: gKey.length });
      }
    }

    const activeConvs = Object.keys(conversations).length;
    return res.status(200).json({
      status: 'ok',
      engine: 'Google Gemini 2.5 Flash',
      fallback: 'OpenAI GPT-4o',
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

    // Get API keys
    const geminiKey = process.env.GOOGLE_API_KEY || '';
    const openaiKey = process.env.OPENAI_API_KEY || '';
    if (!geminiKey && !openaiKey) {
      return res.status(200).json({
        response: 'O agente ' + agentConfig.name + ' está em manutenção. Por favor, tente novamente em instantes.',
        error: 'Nenhuma API key configurada (GOOGLE_API_KEY ou OPENAI_API_KEY)',
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
      systemPrompt += '\n\n═══ CATÁLOGO DE IMÓVEIS PSM (DADOS REAIS — USE APENAS ESTES) ═══\n' + propertyContext;
    }

    // Add extra context if provided via API call
    if (context) {
      systemPrompt += '\n\nCONTEXTO ADICIONAL (dados em tempo real — USE APENAS ESTES DADOS):\n' + context;
    }

    // Add conversation metadata
    if (metadata.leadName) {
      systemPrompt += '\n\nINFORMAÇÕES DO LEAD:\n- Nome: ' + metadata.leadName;
      if (metadata.leadPhone) systemPrompt += '\n- Telefone: ' + metadata.leadPhone;
      if (metadata.leadEmail) systemPrompt += '\n- Email: ' + metadata.leadEmail;
      if (metadata.leadTemperature) systemPrompt += '\n- Temperatura: ' + metadata.leadTemperature;
    }

    if (channel) {
      systemPrompt += '\n\nCANAL: ' + channel + ' — adapte o formato da resposta (mensagens curtas para WhatsApp/Instagram, mais detalhadas para web).';
    }

    // ─── TRY GEMINI FIRST, FALLBACK TO OPENAI ──────────────────────────────
    let responseText = '';
    let usedEngine = 'gemini';
    let tokenInfo = {};
    let geminiErrorMsg = '';

    if (geminiKey) {
      try {
        // Build Gemini contents array
        const geminiContents = [];

        // Add conversation history (Gemini uses "user"/"model" roles)
        const historyMsgs = messages.slice(-20);
        for (const m of historyMsgs) {
          geminiContents.push({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          });
        }

        const geminiBody = {
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: geminiContents,
          generationConfig: {
            temperature: agentConfig.temperature,
            maxOutputTokens: agentConfig.max_tokens,
            topP: 0.95,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ]
        };

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${agentConfig.model}:generateContent?key=${geminiKey}`;

        const geminiResp = await httpsReq(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
        });

        if (geminiResp.status === 200) {
          const geminiData = JSON.parse(geminiResp.body);
          responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          tokenInfo = {
            input: geminiData.usageMetadata?.promptTokenCount || 0,
            output: geminiData.usageMetadata?.candidatesTokenCount || 0,
            total: geminiData.usageMetadata?.totalTokenCount || 0,
          };

          if (!responseText) {
            throw new Error('Gemini returned empty response');
          }
        } else {
          let errDetail = '';
          try { errDetail = JSON.parse(geminiResp.body).error?.message || ''; } catch(e) {}
          throw new Error('Gemini HTTP ' + geminiResp.status + ': ' + errDetail);
        }
      } catch (geminiErr) {
        console.error('[AGENT] Gemini error, trying OpenAI fallback:', geminiErr.message);
        geminiErrorMsg = geminiErr.message;
        usedEngine = 'openai_fallback';
        responseText = ''; // Reset to trigger fallback
      }
    }

    // FALLBACK: OpenAI if Gemini failed or not configured
    if (!responseText && openaiKey) {
      usedEngine = geminiKey ? 'openai_fallback' : 'openai';

      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
      ];

      const openaiResp = await httpsReq('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openaiKey,
        },
        body: JSON.stringify({
          model: agentConfig.fallback_model || 'gpt-4o',
          max_tokens: agentConfig.max_tokens,
          temperature: agentConfig.temperature,
          messages: openaiMessages,
        }),
      });

      if (openaiResp.status !== 200) {
        let errMsg = 'Erro ' + openaiResp.status;
        try { errMsg = JSON.parse(openaiResp.body).error?.message || errMsg; } catch(e) {}
        console.error('[AGENT] OpenAI fallback error:', errMsg);
        return res.status(200).json({
          response: 'Desculpe, estou com dificuldade para responder agora. Tente novamente em instantes.',
          error: errMsg,
          geminiError: geminiErrorMsg || null,
          conversationId,
        });
      }

      const openaiData = JSON.parse(openaiResp.body);
      responseText = openaiData.choices?.[0]?.message?.content || '';
      tokenInfo = {
        input: openaiData.usage?.prompt_tokens || 0,
        output: openaiData.usage?.completion_tokens || 0,
        total: openaiData.usage?.total_tokens || 0,
      };
    }

    if (!responseText) {
      return res.status(200).json({
        response: 'Desculpe, não consegui processar sua mensagem. Tente novamente.',
        error: 'Nenhuma engine disponível retornou resposta',
        conversationId,
      });
    }

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
    } else if (lowerMsg.includes('quanto') || lowerMsg.includes('preço') || lowerMsg.includes('valor') || lowerMsg.includes('parcela') || lowerMsg.includes('financ') || lowerMsg.includes('entrada')) {
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
      engine: usedEngine,
      model: usedEngine === 'openai_fallback' || usedEngine === 'openai' ? (agentConfig.fallback_model || 'gpt-4o') : agentConfig.model,
      tokens: tokenInfo,
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
