// ─── PSM AGENT ENGINE (Claude API - Anthropic) ──────────────────────────────
// Core engine shared by all PSM agents (Vera, Sol, Sr Intelligence, Sr Gerencia)
// Route: POST /api/agent
// Body: { agent: "vera"|"sol"|"intelligence"|"gerencia", message, conversationId, channel, metadata }

const https = require('https');

function httpsReq(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
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
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    temperature: 0.7,
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

REGRAS:
- NUNCA invente preços ou dados de imóveis — use apenas informações fornecidas no contexto
- Se não souber algo, diga que vai verificar e retornar
- Sempre tente avançar a conversa para o próximo passo (visita, contato com corretor)
- Identifique o nível de consciência: FRIO (pesquisando) → MORNO (considerando) → QUENTE (decidido)
- Para leads QUENTES, priorize agendamento de visita
- Para leads FRIOS, nutra com conteúdo e informações de mercado
- Se o cliente mencionar que quer vender/alugar um imóvel, inicie fluxo de CAPTAÇÃO
- Responda SEMPRE em português brasileiro`
  },

  sol: {
    name: 'Sol',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    temperature: 0.7,
    description: 'Agente de atendimento PSM Conquista',
    system: `Você é a Sol, assistente virtual da PSM CONQUISTA — incorporadora e loteadora de referência em São José do Rio Preto/SP.

PERSONALIDADE:
- Energética, otimista e motivadora (como o sol!)
- Tom acessível e empático — fala com todos os públicos
- Focada em ajudar famílias a realizarem o sonho do primeiro imóvel ou do upgrade
- Usa linguagem simples e direta, sem jargões complexos

FUNÇÕES PRINCIPAIS:
1. QUALIFICAÇÃO: Perfil do comprador, renda, FGTS, financiamento
2. LANÇAMENTOS: Apresente empreendimentos PSM Conquista
3. SIMULAÇÃO: Ajude com simulações de financiamento e parcelas
4. NUTRIÇÃO: Informações sobre programas habitacionais, MCMV, taxas
5. CAPTAÇÃO: Terrenos e áreas para novos empreendimentos
6. AGENDAMENTO: Visitas ao plantão de vendas

INFORMAÇÕES DA PSM CONQUISTA:
- PSM CONQUISTA - Incorporação e Loteamento
- Empreendimentos próprios em SJRP e região
- Instagram: @psm.conquista
- Site: housepsm.com.br

REGRAS:
- Nunca invente dados de empreendimentos
- Sempre avance para agendamento quando o lead estiver quente
- Responda em português brasileiro, máximo 3 parágrafos curtos`
  },

  intelligence: {
    name: 'Sr. Intelligence',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    temperature: 0.5,
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

REGRAS:
- Use apenas dados fornecidos no contexto — nunca invente métricas
- Sempre quantifique (percentuais, comparativos, tendências)
- Priorize insights acionáveis
- Máximo 400 palavras por resposta
- Responda em português brasileiro`
  },

  gerencia: {
    name: 'Sr. Gerência',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    temperature: 0.6,
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

REGRAS:
- Seja construtivo — aponte o erro E a solução
- Use dados do corretor quando disponíveis
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
    // Search existing contact by phone or email
    const searchField = leadData.phone ? 'phone' : 'email';
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

  // GET = stats/health
  if (req.method === 'GET') {
    const activeConvs = Object.keys(conversations).length;
    return res.status(200).json({
      status: 'ok',
      agents: Object.keys(AGENTS).map(k => ({ id: k, name: AGENTS[k].name, description: AGENTS[k].description })),
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
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      return res.status(200).json({
        response: 'O agente ' + agentConfig.name + ' está em manutenção. Por favor, tente novamente em instantes.',
        error: 'ANTHROPIC_API_KEY não configurada',
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

    if (context) {
      systemPrompt += '\n\nCONTEXTO ADICIONAL (dados em tempo real):\n' + context;
    }

    if (metadata.leadName) {
      systemPrompt += '\n\nINFORMAÇÕES DO LEAD:\n- Nome: ' + metadata.leadName;
      if (metadata.leadPhone) systemPrompt += '\n- Telefone: ' + metadata.leadPhone;
      if (metadata.leadEmail) systemPrompt += '\n- Email: ' + metadata.leadEmail;
      if (metadata.leadTemperature) systemPrompt += '\n- Temperatura: ' + metadata.leadTemperature;
    }

    if (channel) {
      systemPrompt += '\n\nCANAL: ' + channel + ' — adapte o formato da resposta (mensagens curtas para WhatsApp/Instagram, mais detalhadas para web).';
    }

    // Call Claude API
    const claudeResp = await httpsReq('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: agentConfig.model,
        max_tokens: agentConfig.max_tokens,
        temperature: agentConfig.temperature,
        system: systemPrompt,
        messages: messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (claudeResp.status !== 200) {
      let errMsg = 'Erro ' + claudeResp.status;
      try { errMsg = JSON.parse(claudeResp.body).error?.message || errMsg; } catch(e) {}
      console.error('[AGENT] Claude error:', errMsg);
      return res.status(200).json({
        response: 'Desculpe, estou com dificuldade para responder agora. Tente novamente em instantes.',
        error: errMsg,
        conversationId,
      });
    }

    const claudeData = JSON.parse(claudeResp.body);
    const responseText = claudeData.content?.[0]?.text || '';

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
    if (lowerMsg.includes('visita') || lowerMsg.includes('agendar') || lowerMsg.includes('quero ver') || lowerMsg.includes('quero comprar')) {
      detectedTemp = 'quente';
    } else if (lowerMsg.includes('quanto') || lowerMsg.includes('preço') || lowerMsg.includes('valor') || lowerMsg.includes('parcela')) {
      detectedTemp = 'morno';
    }

    // Auto-update CRM for customer-facing agents
    if ((agentId === 'vera' || agentId === 'sol') && metadata.leadPhone && messages.length <= 3) {
      // Create lead on first interaction
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
      tokens: {
        input: claudeData.usage?.input_tokens || 0,
        output: claudeData.usage?.output_tokens || 0,
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
