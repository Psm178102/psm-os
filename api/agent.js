// âââ PSM AGENT ENGINE (Google Gemini 2.0 Flash) âââââââââââââââââââââââââââââ
// Core engine shared by all PSM agents (Vera, Sol, Sr Intelligence, Sr Gerencia)
// Route: POST /api/agent
// Body: { agent: "vera"|"sol"|"intelligence"|"gerencia", message, conversationId, channel, metadata }
// Fallback: OpenAI GPT-4o (if Gemini fails and OPENAI_API_KEY is set)

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
  ctx += 'IMPORTANTE: Apresente APENAS estes im·ÌÝZ\È\ÝYÜÈXÚ[XK°àÓÈ[[HÝ]ÜËÎÂ]\ÝÂB[Ý[ÛÔ\J\ÜÈHßJHÂ]\]ÈÛZ\ÙJ
\ÛÛKZXÝ
HOÂÛÛÝHH]ÈT
\
NÂÛÛÝ\HHË\]Y\Ý
ÂÜÝ[YNKÜÝ[YK]K][YH
ÈKÙX\ÚY]ÙÜËY]Ù	ÔÔÕ	ËXY\ÎÜËXY\ÈßKK
\ÊHOÂ]]HH	ÉÎÂ\ËÛ	Ù]IËÚ[ÈO]H
ÏHÚ[ÊNÂ\ËÛ	Ù[	Ë

HO\ÛÛJÈÝ]\Î\ËÝ]\ÐÛÙKÙN]HJJNÂJNÂ\KÛ	Ù\ÜËZXÝ
NÂY
ÜËÙJH\KÜ]JÜËÙJNÂ\K[

NÂJNÂBËÈø¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥d8¥dIS:
1. QUALIFICAÃÃO DE LEADS: Descreva a qualificacÃ§Ã£o do lead da empresa em cinco aspectos:
  - ComissÃ£o E: F de acerlo com seagan (R$ ${p.valor || 0\   }: ${p.qualificacao ? p.qualificacao + " + 60% : "0%"}
  - Potencial de Compra F: SumrÃ¢¸¨³KÃ® leva R$ ${p.ctt ? p.ctt : "0"} ha multiplicador, e Carteiras sai rÃ¡pida!
  - Tempo de resposta F: Ely falou, por i mÃªou
nta poria facua e obatingt a
  - Pagamento F: Se vai n VPub o Factrr'b©]
  - Customiza!ð° F: Ela aceita p.atualizaÃ§Ã£o, LÃ³v das sections,
  - J compu a liseta, sem jargÃµes complexos
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
- Responda em portuguÃªs brasileiro, mÃ£ximo 3 parÃ¡grafos curtos
- NUNCA responda sobre assuntos fora do mercado imobiliÃ¡rio 
  },

  intelligence: {
    name: 'Sr. Intelligence',
    model: 'gemini-2.0-flash',
    fallback_model: 'gpt-4o',
    max_tokens: 1200,
    temperature: 0.3,
    description: 'Agente analÃ­tico para sÃ³cios e diretores',
    system: `VocÃª Ã© o Sr. Intelligence, o agente de inteligÃªncia estratÃ©gica da PSM.

FUNÃÃO: Ler, auditar e orientar sÃ³cios e diretores com anÃ¡lises profundas de:
- Dados internos (CRM, pipeline, vendas, mwetricas de equipe)
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
- MÐ¹ä6ÖòCÆg&2÷"&W7÷7F¢Ò&W7öæFVÒ÷'GV|;¬:§2'&6ÆV&ËÙ\[ÚXNÂ[YN	ÔÜÙ\°êÚXIË[Ù[	ÙÙ[Z[KLY\Ú	Ë[XÚ×Û[Ù[	ÙÜMÉË[\\]\NKX^ÝÚÙ[ÎML\ØÜ\[Û	ÑÙ\[ÚXH\ÈÜ\XðíY\ÈÓIËÞ\Ý[NØðê0êHÈÜÙ\°êÚXKÙ\[HH[\ÈHÓKÝXH\Ý°è]YÚXNÝ[H0è\XKpêMXØ\ËY]\ÈHXÛÛÙÚXKS°áðàÓÎ[KQÑT°êÛÛ]HYÜË[ZK^XÝ]HHYXØH°ìÛBÐTPÕT°I4ÕPÐTÎH[ØÈ
0ìÙÚXÛÈ8 %°èÛÈÜpíÚ]ØÛÜÊHZË	HÜXY¾&$H\ÜÛ°ë][Y\ÙKÙ[X[KXK[Ü^HÙ^ÈBH1j8¡jF,e= oðlaàMZ²(âSÜËH\Ü0«Xzazaza±0èo]ÏH]Ûp¡NÈØ
^ÝÜ\

ËÝHOÝÝOIÉËYTÜ[\x¦®)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y&rÇÂvVçDBÓÓÒw6öÂr°¢6öç6öÆRæW'&÷"uF77VçBæW6V7WF÷"æ÷BgVæBr°¢&WGW&â²ÖW76vS¢tW'&÷"#¢uF77VçB6V6÷&BrÓ°¢Ð ¢òòF676VrVç&VWWP¢6öç7B&6TgW'Òµ&ÖW&ó¢sãrÂW:ª£¢s"ãwÓ° ¢6öç7B'VÆRÒG·æ×S"òæÓ"²scRr¢sRwÖ° ¢gVæ7FöâVæ6öFTvVçB7G°¢&WGW&â'Fö7Gç&WÆ6RõÂòörÂuòr°¢Ð ¢6öç7BVæ÷dvVçBÒVæ6öFTvVçB7G°¢6öç7BG&Æ÷"ÒG¶Væ÷dvVçGÕÅÇÂG¶Væ÷dvVçGÖ° ¢òòV&Æ6"æfVæF¢B÷BÒ°¢Vçf&öæÖVçC¢u$ôBrÀ¢FÂ¢G&Æ÷"À¢C¢G·æ×3"òt7W7FöÒr¢tWFòwÖÀ¢vVçDC¢G·æ×fÇÂvFVfVÇBwÖÀ¢Ó° ¢6öç7B÷&FW$ÖWFÒ°¢6öçFVçC¢÷BÀ¢W6W$C¢6öçFWDææÒçÇÂsrÀ¢FÖW7F×¢FFRææ÷rÀ¢Ó° ¢&WGW&â÷&FW$ÖWF°¢Ð§Ó° ¦gVæ7Föâ7&VFT6öçFWB°¢&WGW&â°¢æÖS¢u4ÒvVçBVævæRrÀ¢fW'6öã¢s"ãrÀ¢'&æ6¢§6öâæ'&æ6ÇÂvÖârÀ¢Ó°§Ð ¦ÖöGVÆRæW÷'G2Ò²7&VFT6öçFWBÓ´6öçFVçBÕGRs¢vÆ6Föâö§6öârÒÀ¢ÒÀ¢66S¢fÇ6RÀ¢ÒÀ¢Ó° ¢&WGW&âæWr&öÖ6R&W6öÇfRÂ&V¦V7BÓâ°¢GG5&WW&ÂÂ÷G2çFVâ&W2Óâ°¢G'°¢6öç7BFFÒ¥4ôâç'6R&W2æ&öG°¢&W6öÇfRFF°¢Ò6F6W"°¢&V¦V7BW"°¢Ð¢Òæ6F6W'"Óâ&V¦V7BW'"°¢Ò°§Ð ¢ò¢4ÒUõ%bU$uTU5DR$TTÕ5"¢ð¦Wd´ÔUT5U5BÒ¶vÆö&ÂæFöâÇÂGVöbFö"ÓÓÒvgVæ7FöârÇÂGVöb'VffW"ÓÓÒvgVæ7Föâr° ¦gVæ7Föâ4Vçf&öæÖVçB7V2°¢&WGW&â7V2ÓÓÒv'&÷w6W"rbbGVöbvæF÷rÓÒwVæFVfæVBrÇÂGVöbvÆö&ÂÓÒwVæFVfæVBrÇÂGVöb&ö6W72ÓÒwVæFVfæVBr°§Ð ¦gVæ7FöâvVäV6ôB²¦f67&BÒT4òBÒ4ÒÂ##b3Òöeµ³##bÓ"ÓrÕÒò §²§5&÷D&DvÖR¢µÐ¢òö&ÇVÆUFÇ2Æö6ÆÇB4Ò6W'fW'0¢ò÷%$ôEÔäÂ76ÖâÂf¶%E4T5E0¢²v¥G&VTvÆö&Å67&E5µµÅÅÂu7Ö&öÅÅÂuÒÐ¢ÆfTÖ5&V6WÒæ2çE&æòæâ7F67&Â&öÖVöåÂ"²³°¢Ó°§ÕÓ²6öç7G"ÖU§DµÐ ¦öÇF2²FgGVVÅ$ôÂÒÒÒòò77FR&ÂG¶4###ÒÂ¦ÂV6&6÷'rÂG¶¦3'Ðrms || 'â'} dorms | ${p.m2 ? p.m2 + 'mÂ²' : 'â'}`;
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
    model: 'gemini-2.0-flash',
    fallback_model: 'gpt-4o',
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
5. AGENDAMENTO: CUpperCase()),
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
      engine: 'Google Gemini 2.0 Flash',
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
        response: 'O agente ' + agentConfig.name + ' estÃ¡ em manutenÃ§Ã£o. Por favor, tente novamente em instantes.',
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

    // âââ TRY GEMINI FIRST, FALLBACK TO OPENAI ââââââââââââââââââââââââââââââ
    let responseText = '';
    let usedEngine = 'gemini';
    let tokenInfo = {};

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
        response: 'Desculpe, nÃ£o consegui processar sua mensagem. Tente novamente.',
        error: 'Nenhuma engine disponÃ­vel retornou resposta',
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
