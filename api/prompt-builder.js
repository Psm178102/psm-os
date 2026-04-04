// ============================================================
// PSM PROMPT BUILDER — Motor de prompts profissionais (Node.js)
// Transforma dados básicos da planilha em mega-prompts
// detalhados para geração de imagens via IA (Gemini/DALL-E)
// ============================================================

const BRANDS = {
  conquista: {
    nome: "PSM CONQUISTA",
    handle: "@psmconquista",
    desc: "Imobiliária residencial MCMV, primeiro imóvel, famílias jovens — São José do Rio Preto SP",
    publico: "Jovens casais, famílias classe C/B, primeiro imóvel, saindo do aluguel, renda até R$8.000",
    paleta: {
      primaria: "#E88530", primaria_nome: "Laranja vibrante",
      secundaria: "#D06830", secundaria_nome: "Laranja escuro",
      accent: "#F5B840", accent_nome: "Dourado",
      sucesso: "#7AB330", sucesso_nome: "Verde lima",
      cta: "#1B7A40", cta_nome: "Verde escuro",
      bg_principal: "#0F172A", bg_card: "#1E293B",
      texto_claro: "#F8FAFC", texto_muted: "#94A3B8", borda: "#334155"
    },
    fontes: {
      headline: "Montserrat Extra Bold, sans-serif, uppercase quando curto",
      headline_tamanho: "48-72px para títulos principais, 32-40px subtítulos",
      corpo: "Inter Regular 16-18px, line-height 1.5",
      cta_fonte: "Montserrat Bold 20-28px",
      numeros: "Montserrat Black para valores monetários e percentuais"
    },
    visual: {
      estilo: "Moderno, bold, high-contrast. Dark mode com acentos vibrantes.",
      bg_tratamento: "Fundo escuro #0F172A com gradientes sutis e elementos geométricos abstratos",
      foto_estilo: "Fotos reais de obras, apartamentos decorados compactos, famílias brasileiras felizes, fachadas de prédios MCMV",
      icones: "Ícones line-art modernos, stroke 2px, cor accent quando destaque",
      bordas: "Border-radius 12-16px nos cards, 8px em elementos menores",
      sombras: "Drop shadow sutil nos cards flutuantes, glow accent nos CTAs"
    },
    regras: [
      "SEMPRE incluir @psmconquista no rodapé, fonte 12px, cor #94A3B8",
      "Logo PSM CONQUISTA no canto superior esquerdo ou inferior esquerdo",
      "Formato OBRIGATÓRIO: 1024x1792 portrait (Instagram)",
      "Safe zone: 60px de margem em todos os lados",
      "Headline NUNCA menor que 32px — legibilidade é prioridade",
      "Valores monetários em destaque: fonte Black, cor #F5B840 (dourado)",
      "CTA sempre com fundo sólido #1B7A40, texto branco, border-radius 12px, padding generoso",
      "NUNCA usar imagens de luxo, mansões ou alto padrão",
      "NUNCA usar termos como 'exclusivo', 'premium', 'sofisticado'",
      "Usar linguagem acessível: 'seu apê', 'sair do aluguel', 'parcela que cabe'",
      "Indicador de slide (1/5) em carrosséis: canto superior direito, fonte 14px bold",
      "Seta de swipe animada no slide 1 de carrosséis: canto inferior direito"
    ],
    tom: "Motivador, direto, empático. Como um amigo que entende de imóveis e torce por você. Usa 'você'. Evita jargão técnico. Gera urgência sem ser agressivo."
  },
  imoveis: {
    nome: "PSM IMÓVEIS",
    handle: "@psmimoveis",
    desc: "Assessoria imobiliária premium, alto padrão, investidores — São José do Rio Preto SP",
    publico: "Investidores, compradores alto padrão, renda acima R$15.000, buscam valorização e exclusividade",
    paleta: {
      primaria: "#C9A84C", primaria_nome: "Dourado premium",
      secundaria: "#8B7355", secundaria_nome: "Bronze",
      accent: "#FFFFFF", accent_nome: "Branco puro",
      sucesso: "#4A7C59", sucesso_nome: "Verde discreto",
      cta: "#C9A84C", cta_nome: "Dourado premium",
      bg_principal: "#1A1A2E", bg_card: "#2C2C44",
      texto_claro: "#F5F0E8", texto_muted: "#A09880", borda: "#3D3D5C"
    },
    fontes: {
      headline: "Playfair Display Bold, serif, title-case",
      headline_tamanho: "44-64px para títulos, 28-36px subtítulos",
      corpo: "Lato Light 15-17px, letter-spacing 0.3px, line-height 1.6",
      cta_fonte: "Lato Bold 18-24px, letter-spacing 1px uppercase",
      numeros: "Playfair Display Bold para valores, Lato para métricas"
    },
    visual: {
      estilo: "Sofisticado, minimalista, editorial. Muito espaço em branco (respiro). Elegância discreta.",
      bg_tratamento: "Fundo escuro #1A1A2E com texturas sutis de mármore ou linho, gradientes de dourado para bronze muito suaves",
      foto_estilo: "Fotografias profissionais de interiores luxuosos, vistas panorâmicas, acabamentos premium, arquitetura contemporânea, piscinas de borda infinita",
      icones: "Ícones minimalistas thin-line, monocromáticos, stroke 1px",
      bordas: "Border-radius 4-8px (mais retos = mais sofisticado), linhas finas douradas como separadores",
      sombras: "Sombras muito sutis, quase imperceptíveis. Elegância pela tipografia, não por efeitos."
    },
    regras: [
      "SEMPRE incluir @psmimoveis no rodapé, fonte 11px, cor #A09880",
      "Logo PSM IMÓVEIS no canto superior esquerdo, discreto",
      "Formato OBRIGATÓRIO: 1024x1792 portrait (Instagram)",
      "Safe zone: 80px de margem (mais generosa = mais premium)",
      "Headline: Playfair Display, nunca menor que 28px",
      "Valores de imóveis: Playfair Bold, cor dourada #C9A84C",
      "CTA elegante: borda fina dourada, fundo transparente OU fundo dourado sólido com texto escuro",
      "NUNCA usar linguagem popular, gírias ou tom informal",
      "NUNCA mencionar MCMV, Minha Casa Minha Vida ou programas sociais",
      "Usar termos como 'oportunidade de investimento', 'valorização', 'exclusividade'",
      "Layout com muito respiro — menos é mais",
      "Dados de ROI e valorização quando aplicável"
    ],
    tom: "Consultivo, confiante, sofisticado. Como um consultor de investimentos premium. Usa dados e argumentos sólidos. Gera desejo pela exclusividade, não pela urgência."
  }
};

const FUNIL = {
  TOPO: {
    objetivo: "ATRAIR atenção, parar o scroll, gerar curiosidade",
    visual_strategy: "Impacto visual máximo. Contraste alto. Elemento de surpresa ou provocação. Headline grande e bold que gera curiosidade.",
    psicologia: "Gatilhos: curiosidade, identificação, dor/desejo. A pessoa ainda não sabe que precisa de você.",
    headline_style: "Pergunta provocativa OU dado surpreendente OU afirmação ousada",
    cta_intensidade: "Leve — 'Saiba mais', 'Arrasta', 'Comenta X'. Sem pressão de venda.",
    cor_destaque: "Usar cor ACCENT para o gancho principal. Headline em cor primária."
  },
  MEIO: {
    objetivo: "ENGAJAR, educar, construir autoridade e confiança",
    visual_strategy: "Informativo e organizado. Hierarquia visual clara. Dados, comparações, listas. Conteúdo de valor.",
    psicologia: "Gatilhos: autoridade, prova social, educação. A pessoa já tem interesse, precisa de informação.",
    headline_style: "Educativo — 'Como...', 'X coisas que...', 'O guia completo de...'",
    cta_intensidade: "Médio — 'Salva pra depois', 'Compartilha com quem precisa', 'Comenta sua dúvida'.",
    cor_destaque: "Usar cor SUCESSO para dados positivos. Primária para estrutura."
  },
  FUNDO: {
    objetivo: "CONVERTER, gerar ação imediata, fechar negócio",
    visual_strategy: "Urgência visual. CTA dominante. Escassez. Prova social. Depoimento. Números concretos.",
    psicologia: "Gatilhos: urgência, escassez, prova social, medo de perder (FOMO). A pessoa está pronta, precisa do empurrão.",
    headline_style: "Urgente — 'Últimas X unidades', 'Só até sexta', 'Condição especial'",
    cta_intensidade: "Máximo — 'Fale agora', 'Garanta o seu', 'Manda DM'. CTA grande e impossível de ignorar.",
    cor_destaque: "Usar cor CTA como fundo do botão principal. Accent para urgência."
  }
};

// ---------- HELPER ----------
function contentLayout(content) {
  if (!content) return "Layout flexível — preencher com visual de impacto";
  const words = content.split(/\s+/);
  if (words.length <= 8) return "Texto curto → centralizado, fonte grande (28-32px), muito respiro";
  if (/\bvs\b|\bVS\b|\b x \b| ou /i.test(content)) return "Comparação → split-screen, lado a lado, cores contrastantes";
  if (/R\$|%|mil|anos/.test(content)) return "Dados numéricos → número em destaque gigante (48-64px accent), texto explicativo menor embaixo";
  if ((content.match(/,/g) || []).length >= 2 || (content.match(/;/g) || []).length >= 2) return "Lista de itens → cards ou bullets com ícones, espaçamento generoso";
  return "Parágrafo informativo → texto bem hierarquizado com elemento visual de apoio";
}

// ---------- BRAND CONTEXT ----------
function buildBrandContext(brandData, brandKey) {
  const b = brandData || BRANDS[brandKey] || BRANDS.conquista;

  let coresStr;
  if (b.cores && Array.isArray(b.cores) && b.cores.length > 0 && b.cores[0].hex) {
    coresStr = b.cores.map(c => `${c.nome || ''} ${c.hex}`).join(', ');
  } else {
    const pal = b.paleta || {};
    coresStr = Object.entries(pal)
      .filter(([k]) => !k.includes('_nome') && !['bg_principal','bg_card','texto_claro','texto_muted','borda'].includes(k))
      .map(([, v]) => v).join(', ');
  }

  let fontes = b.fontes || '';
  if (typeof fontes === 'object') fontes = `Headline: ${fontes.headline || ''} | Corpo: ${fontes.corpo || ''}`;

  let ctx = `=== BRAND GUIDELINES: ${b.nome || brandKey.toUpperCase()} ===\nDescrição: ${b.desc || ''}\nPúblico-alvo: ${b.publico || ''}\nPaleta de Cores: ${coresStr}\nFontes: ${fontes}\nTom de Voz: ${b.tom || ''}\n`;

  const regras = b.regras || [];
  if (Array.isArray(regras)) {
    ctx += "Regras Visuais:\n" + regras.map(r => ` • ${r}`).join('\n') + '\n';
  } else if (typeof regras === 'string') {
    ctx += `Regras Visuais:\n${regras}\n`;
  }

  ctx += "=== FIM BRAND GUIDELINES ===\n\n";
  return ctx;
}

// ---------- STATIC POST ----------
function buildStaticPrompt(post, brandCtx, funilData, brandKey) {
  const b = BRANDS[brandKey] || BRANDS.conquista;
  const margin = brandKey === 'imoveis' ? 80 : 60;

  let p = brandCtx;
  p += `\n--- COMPOSIÇÃO E LAYOUT ---\nTipo: Post estático Instagram, 1024x1792 portrait\nGrid: Layout centralizado com hierarquia vertical\nSafe Zone: ${b.visual.bordas} — respeitar margens de ${margin}px\nBackground: ${b.visual.bg_tratamento}\n\n--- HIERARQUIA VISUAL (de cima para baixo) ---\n1. TOPO (0-15% altura): Logo ${b.nome} pequeno no canto superior esquerdo + indicador de marca\n2. ZONA DE IMPACTO (15-55% altura): Headline principal — ${b.fontes.headline}, tamanho ${b.fontes.headline_tamanho}\n   Texto: \"${post.titulo || ''}\"\n   Cor: ${b.paleta.primaria} (${b.paleta.primaria_nome})\n   Alinhamento: centralizado ou left-aligned conforme comprimento\n3. ZONA VISUAL (30-70% altura): ${post.visual || 'Composição visual profissional'}\n   Estilo fotográfico: ${b.visual.foto_estilo}\n   Tratamento: ${b.visual.estilo}\n4. ZONA DE SUPORTE (55-80% altura): Texto de apoio se houver\n   Fonte: ${b.fontes.corpo}\n   Cor: ${b.paleta.texto_claro}\n5. CTA (80-92% altura): \"${post.cta || 'Saiba mais'}\"\n   Botão: fundo ${b.paleta.cta} (${b.paleta.cta_nome}), texto branco, ${b.fontes.cta_fonte}\n   Border-radius: 12px, padding: 16px 40px\n6. RODAPÉ (92-100% altura): ${b.handle} em ${b.paleta.texto_muted}, fonte 12px\n\n--- ESTRATÉGIA DE FUNIL: ${post.funil || 'MEIO'} ---\nObjetivo: ${funilData.objetivo}\nAbordagem visual: ${funilData.visual_strategy}\nPsicologia: ${funilData.psicologia}\nEstilo headline: ${funilData.headline_style}\nIntensidade CTA: ${funilData.cta_intensidade}\n\n--- DIRETRIZES VISUAIS ---\nEstilo geral: ${b.visual.estilo}\nÍcones: ${b.visual.icones}\nSombras: ${b.visual.sombras}\n\n--- REGRAS OBRIGATÓRIAS ---\n`;
  for (const r of b.regras) p += `• ${r}\n`;

  p += `\n--- INSTRUÇÃO FINAL ---\nCrie uma imagem profissional de Instagram post (1024x1792 portrait) com design de alta qualidade.\nA imagem deve ser COMPLETA e FINALIZADA — pronta para publicar sem edição adicional.\nO título \"${post.titulo || ''}\" deve ser o elemento de MAIOR DESTAQUE visual.\nTodo texto na imagem deve ser em PORTUGUÊS do Brasil.\nEstilo: ${b.visual.estilo}\nTom: ${b.tom}\n`;
  return p.trim();
}

// ---------- CAROUSEL: COVER ----------
function buildCoverSlide(post, b, funilData, brandKey, brandCtx, totalSlides) {
  let p = brandCtx;
  p += `\n--- SLIDE 1/${totalSlides} — COVER (CAPA DO CARROSSEL) ---\nEste é o slide MAIS IMPORTANTE. Ele decide se a pessoa vai passar ou parar para ler.\n\n--- COMPOSIÇÃO E LAYOUT ---\nTipo: Slide de carrossel Instagram, 1024x1792 portrait\nFunção: PARAR O SCROLL. Gerar curiosidade irresistível.\nBackground: ${b.visual.bg_tratamento}\n\n--- HIERARQUIA VISUAL ---\n1. TOPO (0-10%): Logo ${b.nome} discreto, canto superior esquerdo\n2. INDICADOR (topo direito): \"1/${totalSlides}\" em fonte bold 16px, cor ${b.paleta.accent}\n3. HEADLINE PRINCIPAL (20-55%): \"${post.titulo || ''}\"\n   Fonte: ${b.fontes.headline}, tamanho MÁXIMO (${b.fontes.headline_tamanho})\n   Cor: ${b.paleta.primaria} com possível accent em ${b.paleta.accent} para palavras-chave\n   DEVE ocupar pelo menos 35% da área visual\n   Quebrar em 2-3 linhas com hierarquia de tamanho se necessário\n4. VISUAL DE SUPORTE (40-75%): ${post.visual || ''}\n   Estilo: ${b.visual.foto_estilo}\n5. TEASER (75-85%): Frase curta que gera curiosidade sobre o próximo slide\n   Fonte: ${b.fontes.corpo}, cor ${b.paleta.texto_muted}\n6. SWIPE ARROW (85-92%): Seta animada/visual apontando para direita + texto \"Arrasta →\"\n   Cor: ${b.paleta.accent}, animação implícita (seta com motion blur ou trail)\n7. RODAPÉ (92-100%): ${b.handle}\n\n--- ESTRATÉGIA DE FUNIL: ${post.funil || 'MEIO'} ---\n${funilData.visual_strategy}\n${funilData.psicologia}\n\n--- REGRAS DO COVER ---\n• O headline é REI — nada compete visualmente com ele\n• Contraste MÁXIMO entre headline e background\n• Sensação de \"tem mais\" — o slide deve parecer incompleto de propósito\n• Seta de swipe é OBRIGATÓRIA no primeiro slide\n• Sem CTA de venda no cover — apenas curiosidade\n• Dark background com elementos luminosos chama mais atenção no feed\n\n--- INSTRUÇÃO FINAL ---\nCrie o SLIDE 1 (cover) de um carrossel de ${totalSlides} slides para Instagram (1024x1792).\nEste slide deve PARAR o scroll do usuário. O título \"${post.titulo || ''}\" deve ser gigante e impossível de ignorar.\nInclua a seta de swipe e o indicador 1/${totalSlides}.\nDesign profissional, pronto para publicação. Texto em PORTUGUÊS do Brasil.\nEstilo: ${b.visual.estilo}\n`;
  return p.trim();
}

// ---------- CAROUSEL: CONTENT ----------
function buildContentSlide(post, b, funilData, brandKey, brandCtx, slideIdx, totalSlides, content) {
  let p = brandCtx;
  p += `\n--- SLIDE ${slideIdx + 1}/${totalSlides} — CONTEÚDO ---\n\n--- COMPOSIÇÃO E LAYOUT ---\nTipo: Slide de conteúdo, carrossel Instagram, 1024x1792 portrait\nFunção: INFORMAR e MANTER o engajamento. A pessoa já parou, agora quer valor.\nBackground: ${b.visual.bg_tratamento}\n\n--- HIERARQUIA VISUAL ---\n1. TOPO (0-8%): Indicador \"${slideIdx + 1}/${totalSlides}\" no canto superior direito, fonte 14px bold, cor ${b.paleta.accent}\n2. SUBTÍTULO DO SLIDE (8-18%): Título deste slide específico\n   Fonte: ${b.fontes.headline}, tamanho 28-36px\n   Cor: ${b.paleta.primaria}\n3. CONTEÚDO PRINCIPAL (20-78%): \"${content}\"\n   Layout: ${contentLayout(content)}\n   Fonte corpo: ${b.fontes.corpo}\n   Cor texto: ${b.paleta.texto_claro}\n   Dados/números em destaque: ${b.fontes.numeros}, cor ${b.paleta.accent}\n4. VISUAL DE APOIO: ${post.visual || ''}\n   Usar ícones (${b.visual.icones}) para acompanhar pontos-chave\n5. SEPARADOR VISUAL: Linha fina ou elemento gráfico em ${b.paleta.borda}\n6. CONTEXTO (78-88%): Micro-texto de conexão com próximo slide\n7. SWIPE (88-92%): Indicador sutil de \"continue\" → próximo slide\n8. RODAPÉ (92-100%): ${b.handle}\n\n--- REGRAS DE CONTEÚDO ---\n• Hierarquia clara: título do slide → conteúdo → visual de apoio\n• Cada slide deve ter UM ponto principal, não vários\n• Números e dados em DESTAQUE com fonte maior e cor accent\n• Consistência visual com os outros slides do carrossel\n• Background IDÊNTICO ao slide 1 (consistência de marca)\n• Se houver lista, máximo 3-4 itens por slide (legibilidade)\n\n--- INSTRUÇÃO FINAL ---\nCrie o SLIDE ${slideIdx + 1} de um carrossel de ${totalSlides} slides para Instagram (1024x1792).\nConteúdo deste slide: \"${content}\"\nTítulo do carrossel: \"${post.titulo || ''}\"\nVisual: ${post.visual || ''}\nManter consistência visual com os demais slides. Design profissional, texto em PORTUGUÊS do Brasil.\nEstilo: ${b.visual.estilo}\n`;
  return p.trim();
}

// ---------- CAROUSEL: CTA ----------
function buildCtaSlide(post, b, funilData, brandKey, brandCtx, totalSlides) {
  let p = brandCtx;
  p += `\n--- SLIDE ${totalSlides}/${totalSlides} — CTA FINAL ---\n\n--- COMPOSIÇÃO E LAYOUT ---\nTipo: Slide final CTA, carrossel Instagram, 1024x1792 portrait\nFunção: CONVERTER. Este slide é a razão de existir do carrossel inteiro.\nBackground: Gradiente de ${b.paleta.cta} para ${b.paleta.bg_principal} (mais impactante que slides anteriores)\n\n--- HIERARQUIA VISUAL ---\n1. TOPO (0-8%): Indicador \"${totalSlides}/${totalSlides}\" — último slide\n2. FRASE DE CONEXÃO (10-25%): Frase emocional que resume o valor entregue no carrossel\n   Fonte: ${b.fontes.corpo}, tamanho 20-24px, cor ${b.paleta.texto_claro}\n   Exemplo: \"Pronto pra dar o próximo passo?\" ou \"Essa oportunidade é pra você\"\n3. CTA PRINCIPAL (30-55%): \"${post.cta || 'Fale conosco'}\"\n   ESTE É O ELEMENTO DOMINANTE DO SLIDE\n   Botão GIGANTE: fundo ${b.paleta.cta}, texto branco (ou escuro se marca premium)\n   Fonte: ${b.fontes.cta_fonte}, tamanho 28-36px\n   Border-radius: 16px, padding: 24px 60px\n   Sombra/glow em volta do botão para atrair o olho\n4. INSTRUÇÃO DIRETA (58-68%): Texto claro do que fazer\n   \"Manda 'QUERO' no DM\" ou \"Clica no link da bio\" ou \"Comenta PARCELA\"\n   Fonte: ${b.fontes.corpo}, cor ${b.paleta.accent}\n5. PROVA SOCIAL (70-82%): Se aplicável — depoimento curto, número de clientes, avaliação\n   Elemento de confiança para reduzir hesitação\n6. LOGO ${b.nome} (82-92%): Logo maior que nos outros slides, centralizado\n7. RODAPÉ (92-100%): ${b.handle} + dados de contato se houver\n\n--- ESTRATÉGIA DE FUNIL: ${post.funil || 'MEIO'} ---\nIntensidade CTA: ${funilData.cta_intensidade}\nPsicologia: ${funilData.psicologia}\n\n--- REGRAS DO CTA ---\n• O botão de CTA deve ser IMPOSSÍVEL de ignorar — maior elemento da página\n• Background diferenciado dos outros slides (mais vibrante, mais contraste)\n• Sem distrações — tudo aponta para a ação\n• Incluir urgência se funil FUNDO: \"\u00daltimas vagas\", \"Só hoje\", etc.\n• Gradiente no background cria sensação de \"chegamos ao destino\"\n\n--- INSTRUÇÃO FINAL ---\nCrie o SLIDE FINAL (CTA) de um carrossel de ${totalSlides} slides para Instagram (1024x1792).\nCTA principal: \"${post.cta || 'Fale conosco'}\"\nEste slide deve CONVERTER. O botão de ação deve ser o maior e mais visível elemento.\nGradiente de fundo vibrante. Logo da marca em destaque. Design profissional.\nTexto em PORTUGUÊS do Brasil.\nEstilo: ${b.visual.estilo}\n`;
  return p.trim();
}

// ---------- CAROUSEL ROUTER ----------
function buildCarouselSlide(post, brandCtx, funilData, brandKey, slideIdx, totalSlides) {
  const b = BRANDS[brandKey] || BRANDS.conquista;
  const copyLines = (post.copy || '').split('\n').map(l => l.trim()).filter(Boolean);

  if (slideIdx === 0) {
    return buildCoverSlide(post, b, funilData, brandKey, brandCtx, totalSlides);
  } else if (slideIdx === totalSlides - 1) {
    return buildCtaSlide(post, b, funilData, brandKey, brandCtx, totalSlides);
  } else {
    let clean = '';
    if (slideIdx < copyLines.length) {
      clean = copyLines[slideIdx].replace(/^Slide \d+ [-–] /, '');
    }
    return buildContentSlide(post, b, funilData, brandKey, brandCtx, slideIdx, totalSlides, clean);
  }
}

// ---------- HANDLER ----------
module.exports = (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const post = body.post || {};
    const brandKey = body.brand || 'conquista';
    const brandData = body.brandData || null;
    const slideIdx = body.slideIdx || 0;
    const totalSlides = body.totalSlides || 1;

    // Build brand context
    const brandCtx = buildBrandContext(brandData, brandKey);
    const funilKey = (post.funil || 'MEIO').toUpperCase();
    const funilData = FUNIL[funilKey] || FUNIL.MEIO;

    // Build the prompt
    let prompt;
    if (totalSlides <= 1) {
      prompt = buildStaticPrompt(post, brandCtx, funilData, brandKey);
    } else {
      prompt = buildCarouselSlide(post, brandCtx, funilData, brandKey, slideIdx, totalSlides);
    }

    // If the post has a custom prompt from spreadsheet, ENHANCE it
    const customPrompt = (post.prompt || '').trim();
    if (customPrompt) {
      const b = BRANDS[brandKey] || BRANDS.conquista;
      const margin = brandKey === 'imoveis' ? 80 : 60;
      prompt = brandCtx + `\n--- PROMPT BASE DA PLANILHA ---\n${customPrompt}\n\n--- ENRIQUECIMENTO AUTOMÁTICO ---\nFormato: Instagram post, 1024x1792 portrait\nEstilo visual: ${b.visual.estilo}\nBackground: ${b.visual.bg_tratamento}\nFotografia: ${b.visual.foto_estilo}\nTipografia headline: ${b.fontes.headline}\nTipografia corpo: ${b.fontes.corpo}\nSafe zone: margens de ${margin}px\nHandle: ${b.handle} no rodapé\n\n--- ESTRATÉGIA DE FUNIL: ${funilKey} ---\n${funilData.objetivo}\n${funilData.visual_strategy}\n\n--- INSTRUÇÃO ---\nUse o prompt base acima como diretriz criativa principal.\nAplique TODAS as brand guidelines e regras visuais descritas.\nCrie a imagem profissional finalizada (1024x1792 portrait), pronta para publicação.\nTexto em PORTUGUÊS do Brasil.\n`;
      if (totalSlides > 1) {
        prompt += `\n\nEste é o slide ${slideIdx + 1} de ${totalSlides}.`;
      }
    }

    prompt = prompt.trim();

    return res.status(200).json({
      prompt,
      brand: brandKey,
      funil: funilKey,
      slideIdx,
      totalSlides,
      promptLength: prompt.length
    });
  } catch (error) {
    console.error('Prompt builder error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
