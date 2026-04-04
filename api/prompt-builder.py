from http.server import BaseHTTPRequestHandler
import json

# ============================================================
# PSM PROMPT BUILDER — Motor de prompts profissionais
# Transforma dados básicos da planilha em mega-prompts
# detalhados para geração de imagens via IA (Gemini/DALL-E)
# ============================================================

# ---------- BRAND PRESETS (fallback se frontend não enviar) ----------

BRANDS = {
    "conquista": {
        "nome": "PSM CONQUISTA",
        "handle": "@psmconquista",
        "desc": "Imobiliária residencial MCMV, primeiro imóvel, famílias jovens — São José do Rio Preto SP",
        "publico": "Jovens casais, famílias classe C/B, primeiro imóvel, saindo do aluguel, renda até R$8.000",
        "paleta": {
            "primaria": "#E88530",
            "primaria_nome": "Laranja vibrante",
            "secundaria": "#D06830",
            "secundaria_nome": "Laranja escuro",
            "accent": "#F5B840",
            "accent_nome": "Dourado",
            "sucesso": "#7AB330",
            "sucesso_nome": "Verde lima",
            "cta": "#1B7A40",
            "cta_nome": "Verde escuro",
            "bg_principal": "#0F172A",
            "bg_card": "#1E293B",
            "texto_claro": "#F8FAFC",
            "texto_muted": "#94A3B8",
            "borda": "#334155"
        },
        "fontes": {
            "headline": "Montserrat Extra Bold, sans-serif, uppercase quando curto",
            "headline_tamanho": "48-72px para títulos principais, 32-40px subtítulos",
            "corpo": "Inter Regular 16-18px, line-height 1.5",
            "cta_fonte": "Montserrat Bold 20-28px",
            "numeros": "Montserrat Black para valores monetários e percentuais"
        },
        "visual": {
            "estilo": "Moderno, bold, high-contrast. Dark mode com acentos vibrantes.",
            "bg_tratamento": "Fundo escuro #0F172A com gradientes sutis e elementos geométricos abstratos",
            "foto_estilo": "Fotos reais de obras, apartamentos decorados compactos, famílias brasileiras felizes, fachadas de prédios MCMV",
            "icones": "Ícones line-art modernos, stroke 2px, cor accent quando destaque",
            "bordas": "Border-radius 12-16px nos cards, 8px em elementos menores",
            "sombras": "Drop shadow sutil nos cards flutuantes, glow accent nos CTAs"
        },
        "regras": [
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
        "tom": "Motivador, direto, empático. Como um amigo que entende de imóveis e torce por você. Usa 'você'. Evita jargão técnico. Gera urgência sem ser agressivo."
    },
    "imoveis": {
        "nome": "PSM IMÓVEIS",
        "handle": "@psmimoveis",
        "desc": "Assessoria imobiliária premium, alto padrão, investidores — São José do Rio Preto SP",
        "publico": "Investidores, compradores alto padrão, renda acima R$15.000, buscam valorização e exclusividade",
        "paleta": {
            "primaria": "#C9A84C",
            "primaria_nome": "Dourado premium",
            "secundaria": "#8B7355",
            "secundaria_nome": "Bronze",
            "accent": "#FFFFFF",
            "accent_nome": "Branco puro",
            "sucesso": "#4A7C59",
            "sucesso_nome": "Verde discreto",
            "cta": "#C9A84C",
            "cta_nome": "Dourado premium",
            "bg_principal": "#1A1A2E",
            "bg_card": "#2C2C44",
            "texto_claro": "#F5F0E8",
            "texto_muted": "#A09880",
            "borda": "#3D3D5C"
        },
        "fontes": {
            "headline": "Playfair Display Bold, serif, title-case",
            "headline_tamanho": "44-64px para títulos, 28-36px subtítulos",
            "corpo": "Lato Light 15-17px, letter-spacing 0.3px, line-height 1.6",
            "cta_fonte": "Lato Bold 18-24px, letter-spacing 1px uppercase",
            "numeros": "Playfair Display Bold para valores, Lato para métricas"
        },
        "visual": {
            "estilo": "Sofisticado, minimalista, editorial. Muito espaço em branco (respiro). Elegância discreta.",
            "bg_tratamento": "Fundo escuro #1A1A2E com texturas sutis de mármore ou linho, gradientes de dourado para bronze muito suaves",
            "foto_estilo": "Fotografias profissionais de interiores luxuosos, vistas panorâmicas, acabamentos premium, arquitetura contemporânea, piscinas de borda infinita",
            "icones": "Ícones minimalistas thin-line, monocromáticos, stroke 1px",
            "bordas": "Border-radius 4-8px (mais retos = mais sofisticado), linhas finas douradas como separadores",
            "sombras": "Sombras muito sutis, quase imperceptíveis. Elegância pela tipografia, não por efeitos."
        },
        "regras": [
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
        "tom": "Consultivo, confiante, sofisticado. Como um consultor de investimentos premium. Usa dados e argumentos sólidos. Gera desejo pela exclusividade, não pela urgência."
    }
}
}

# ---------- FUNIL STRATEGY ----------

FUNIL = {
    "TOPO": {
        "objetivo": "ATRAIR atenção, parar o scroll, gerar curiosidade",
        "visual_strategy": "Impacto visual máximo. Contraste alto. Elemento de surpresa ou provocação. Headline grande e bold que gera curiosidade.",
        "psicologia": "Gatilhos: curiosidade, identificação, dor/desejo. A pessoa ainda não sabe que precisa de você.",
        "headline_style": "Pergunta provocativa OU dado surpreendente OU afirmação ousada",
        "cta_intensidade": "Leve — 'Saiba mais', 'Arrasta', 'Comenta X'. Sem pressão de venda.",
        "cor_destaque": "Usar cor ACCENT para o gancho principal. Headline em cor primária."
    },
    "MEIO": {
        "objetivo": "ENGAJAR, educar, construir autoridade e confiança",
        "visual_strategy": "Informativo e organizado. Hierarquia visual clara. Dados, comparações, listas. Conteúdo de valor.",
        "psicologia": "Gatilhos: autoridade, prova social, educação. A pessoa já tem interesse, precisa de informação.",
        "headline_style": "Educativo — 'Como...', 'X coisas que...', 'O guia completo de...'",
        "cta_intensidade": "Médio — 'Salva pra depois', 'Compartilha com quem precisa', 'Comenta sua dúvida'.",
        "cor_destaque": "Usar cor SUCESSO para dados positivos. Primária para estrutura."
    },
    "FUNDO": {
        "objetivo": "CONVERTER, gerar ação imediata, fechar negócio",
        "visual_strategy": "Urgência visual. CTA dominante. Escassez. Prova social. Depoimento. Números concretos.",
        "psicologia": "Gatilhos: urgência, escassez, prova social, medo de perder (FOMO). A pessoa está pronta, precisa do empurrão.",
        "headline_style": "Urgente — 'Últimas X unidades', 'Só até sexta', 'Condição especial'",
        "cta_intensidade": "Máximo — 'Fale agora', 'Garanta o seu', 'Manda DM'. CTA grande e impossível de ignorar.",
        "cor_destaque": "Usar cor CTA como fundo do botão principal. Accent para urgência."
    }
}

# ---------- FORMATO TEMPLATES ----------

def build_static_prompt(post, brand, funil_data, brand_key):
    """Post estático (1 slide)"""
    b = BRANDS.get(brand_key, BRANDS["conquista"])
    p = brand  # Brand guidelines já formatadas

    p += f"""
--- COMPOSIÇÃO E LAYOUT ---
Tipo: Post estático Instagram, 1024x1792 portrait
Grid: Layout centralizado com hierarquia vertical
Safe Zone: {b['visual']['bordas']} — respeitar margens de {80 if brand_key == 'imoveis' else 60}px
Background: {b['visual']['bg_tratamento']}

--- HIERARQUIA VISUAL (de cima para baixo) ---
1. TOPO (0-15% altura): Logo {b['nome']} pequeno no canto superior esquerdo + indicador de marca
2. ZONA DE IMPACTO (15-55% altura): Headline principal — {b['fontes']['headline']}, tamanho {b['fontes']['headline_tamanho']}
   Texto: "{post.get('titulo', '')}"
   Cor: {b['paleta']['primaria']} ({b['paleta']['primaria_nome']})
   Alinhamento: centralizado ou left-aligned conforme comprimento
3. ZONA VISUAL (30-70% altura): {post.get('visual', 'Composição visual profissional')}
   Estilo fotográfico: {b['visual']['foto_estilo']}
   Tratamento: {b['visual']['estilo']}
4. ZONA DE SUPORTE (55-80% altura): Texto de apoio se houver
   Fonte: {b['fontes']['corpo']}
   Cor: {b['paleta']['texto_claro']}
5. CTA (80-92% altura): "{post.get('cta', 'Saiba mais')}"
   Botão: fundo {b['paleta']['cta']} ({b['paleta']['cta_nome']}), texto branco, {b['fontes']['cta_fonte']}
   Border-radius: 12px, padding: 16px 40px
6. RODAPÉ (92-100% altura): {b['handle']} em {b['paleta']['texto_muted']}, fonte 12px

--- ESTRATÉGIA DE FUNIL: {post.get('funil', 'MEIO')} ---
Objetivo: {funil_data['objetivo']}
Abordagem visual: {funil_data['visual_strategy']}
Psicologia: {funil_data['psicologia']}
Estilo headline: {funil_data['headline_style']}
Intensidade CTA: {funil_data['cta_intensidade']}

--- DIRETRIZES VISUAIS ---
Estilo geral: {b['visual']['estilo']}
Ícones: {b['visual']['icones']}
Sombras: {b['visual']['sombras']}

--- REGRAS OBRIGATÓRIAS ---
"""
    for r in b['regras']:
        p += f"• {r}
"

    p += f"""
--- INSTRUÇÃO FINAL ---
Crie uma imagem profissional de Instagram post (1024x1792 portrait) com design de alta qualidade.
A imagem deve ser COMPLETA e FINALIZADA — pronta para publicar sem edição adicional.
O título "{post.get('titulo', '')}" deve ser o elemento de MAIOR DESTAQUE visual.
Todo texto na imagem deve ser em PORTUGUÊS do Brasil.
Estilo: {b['visual']['estilo']}
Tom: {b['tom']}
"""
    return p.strip()


def build_carousel_slide(post, brand, funil_data, brand_key, slide_idx, total_slides):
    """Slide individual de carrossel"""
    b = BRANDS.get(brand_key, BRANDS["conquista"])
    p = brand  # Brand guidelines

    # Parse copy lines
    copy_lines = [l.strip() for l in (post.get('copy', '') or '').split('
') if l.strip()]

    # Determine slide type
    if slide_idx == 0:
        return _build_cover_slide(post, b, funil_data, brand_key, brand, total_slides)
    elif slide_idx == total_slides - 1:
        return _build_cta_slide(post, b, funil_data, brand_key, brand, total_slides)
    else:
        clean = ""
        if slide_idx < len(copy_lines):
            import re
            clean = re.sub(r'^Slide d+ [-–] ', '', copy_lines[slide_idx])
        return _build_content_slide(post, b, funil_data, brand_key, brand, slide_idx, total_slides, clean)


def _build_cover_slide(post, b, funil_data, brand_key, brand, total_slides):
    """Slide 1 — COVER"""
    p = brand
    p += f"""
--- SLIDE 1/{total_slides} — COVER (CAPA DO CARROSSEL) ---
Este é o slide MAIS IMPORTANTE. Ele decide se a pessoa vai passar ou parar para ler.

--- COMPOSIÇÃO E LAYOUT ---
Tipo: Slide de carrossel Instagram, 1024x1792 portrait
Função: PARAR O SCROLL. Gerar curiosidade irresistível.
Background: {b['visual']['bg_tratamento']}

--- HIERARQUIA VISUAL ---
1. TOPO (0-10%): Logo {b['nome']} discreto, canto superior esquerdo
2. INDICADOR (topo direito): "1/{total_slides}" em fonte bold 16px, cor {b['paleta']['accent']}
3. HEADLINE PRINCIPAL (20-55%): "{post.get('titulo', '')}"
   Fonte: {b['fontes']['headline']}, tamanho MÁXIMO ({b['fontes']['headline_tamanho']})
   Cor: {b['paleta']['primaria']} com possível accent em {b['paleta']['accent']} para palavras-chave
   DEVE ocupar pelo menos 35% da área visual
   Quebrar em 2-3 linhas com hierarquia de tamanho se necessário
4. VISUAL DE SUPORTE (40-75%): {post.get('visual', '')}
   Estilo: {b['visual']['foto_estilo']}
5. TEASER (75-85%): Frase curta que gera curiosidade sobre o próximo slide
   Fonte: {b['fontes']['corpo']}, cor {b['paleta']['texto_muted']}
6. SWIPE ARROW (85-92%): Seta animada/visual apontando para direita + texto "Arrasta →"
   Cor: {b['paleta']['accent']}, animação implícita (seta com motion blur ou trail)
7. RODAPÉ (92-100%): {b['handle']}

--- ESTRATÉGIA DE FUNIL: {post.get('funil', 'MEIO')} ---
{funil_data['visual_strategy']}
{funil_data['psicologia']}

--- REGRAS DO COVER ---
• O headline é REI — nada compete visualmente com ele
• Contraste MÁXIMO entre headline e background
• Sensação de "tem mais" — o slide deve parecer incompleto de propósito
• Seta de swipe é OBRIGATÓRIA no primeiro slide
• Sem CTA de venda no cover — apenas curiosidade
• Dark background com elementos luminosos chama mais atenção no feed

--- INSTRUÇÃO FINAL ---
Crie o SLIDE 1 (cover) de um carrossel de {total_slides} slides para Instagram (1024x1792).
Este slide deve PARAR o scroll do usuário. O título "{post.get('titulo', '')}" deve ser gigante e impossível de ignorar.
Inclua a seta de swipe e o indicador 1/{total_slides}.
Design profissional, pronto para publicação. Texto em PORTUGUÊS do Brasil.
Estilo: {b['visual']['estilo']}
"""
    return p.strip()


def _build_content_slide(post, b, funil_data, brand_key, brand, slide_idx, total_slides, content):
    """Slides de conteúdo (2 até penúltimo)"""
    p = brand
    p += f"""
--- SLIDE {slide_idx + 1}/{total_slides} — CONTEÚDO ---

--- COMPOSIÇÃO E LAYOUT ---
Tipo: Slide de conteúdo, carrossel Instagram, 1024x1792 portrait
Função: INFORMAR e MANTER o engajamento. A pessoa já parou, agora quer valor.
Background: {b['visual']['bg_tratamento']}

--- HIERARQUIA VISUAL ---
1. TOPO (0-8%): Indicador "{slide_idx + 1}/{total_slides}" no canto superior direito, fonte 14px bold, cor {b['paleta']['accent']}
2. SUBTÍTULO DO SLIDE (8-18%): Título deste slide específico
   Fonte: {b['fontes']['headline']}, tamanho 28-36px
   Cor: {b['paleta']['primaria']}
3. CONTEÚDO PRINCIPAL (20-78%): "{content}"
   Layout: {_content_layout(content)}
   Fonte corpo: {b['fontes']['corpo']}
   Cor texto: {b['paleta']['texto_claro']}
   Dados/números em destaque: {b['fontes']['numeros']}, cor {b['paleta']['accent']}
4. VISUAL DE APOIO: {post.get('visual', '')}
   Usar ícones ({b['visual']['icones']}) para acompanhar pontos-chave
5. SEPARADOR VISUAL: Linha fina ou elemento gráfico em {b['paleta']['borda']}
6. CONTEXTO (78-88%): Micro-texto de conexão com próximo slide
7. SWIPE (88-92%): Indicador sutil de "continue" → próximo slide
8. RODAPÉ (92-100%): {b['handle']}

--- REGRAS DE CONTEÚDO ---
• Hierarquia clara: título do slide → conteúdo → visual de apoio
• Cada slide deve ter UM ponto principal, não vários
• Números e dados em DESTAQUE com fonte maior e cor accent
• Consistência visual com os outros slides do carrossel
• Background IDÊNTICO ao slide 1 (consistência de marca)
• Se houver lista, máximo 3-4 itens por slide (legibilidade)

--- INSTRUÇÃO FINAL ---
Crie o SLIDE {slide_idx + 1} de um carrossel de {total_slides} slides para Instagram (1024x1792).
Conteúdo deste slide: "{content}"
Título do carrossel: "{post.get('titulo', '')}"
Visual: {post.get('visual', '')}
Manter consistência visual com os demais slides. Design profissional, texto em PORTUGUÊS do Brasil.
Estilo: {b['visual']['estilo']}
"""
    return p.strip()


def _build_cta_slide(post, b, funil_data, brand_key, brand, total_slides):
    """Último slide — CTA"""
    p = brand
    p += f"""
--- SLIDE {total_slides}/{total_slides} — CTA FINAL ---

--- COMPOSIÇÃO E LAYOUT ---
Tipo: Slide final CTA, carrossel Instagram, 1024x1792 portrait
Função: CONVERTER. Este slide é a razão de existir do carrossel inteiro.
Background: Gradiente de {b['paleta']['cta']} para {b['paleta']['bg_principal']} (mais impactante que slides anteriores)

--- HIERARQUIA VISUAL ---
1. TOPO (0-8%): Indicador "{total_slides}/{total_slides}" — último slide
2. FRASE DE CONEXÃO (10-25%): Frase emocional que resume o valor entregue no carrossel
   Fonte: {b['fontes']['corpo']}, tamanho 20-24px, cor {b['paleta']['texto_claro']}
   Exemplo: "Pronto pra dar o próximo passo?" ou "Essa oportunidade é pra você"
3. CTA PRINCIPAL (30-55%): "{post.get('cta', 'Fale conosco')}"
   ESTE É O ELEMENTO DOMINANTE DO SLIDE
   Botão GIGANTE: fundo {b['paleta']['cta']}, texto branco (ou escuro se marca premium)
   Fonte: {b['fontes']['cta_fonte']}, tamanho 28-36px
   Border-radius: 16px, padding: 24px 60px
   Sombra/glow em volta do botão para atrair o olho
4. INSTRUÇÃO DIRETA (58-68%): Texto claro do que fazer
   "Manda 'QUERO' no DM" ou "Clica no link da bio" ou "Comenta PARCELA"
   Fonte: {b['fontes']['corpo']}, cor {b['paleta']['accent']}
5. PROVA SOCIAL (70-82%): Se aplicável — depoimento curto, número de clientes, avaliação
   Elemento de confiança para reduzir hesitação
6. LOGO {b['nome']} (82-92%): Logo maior que nos outros slides, centralizado
7. RODAPÉ (92-100%): {b['handle']} + dados de contato se houver

--- ESTRATÉGIA DE FUNIL: {post.get('funil', 'MEIO')} ---
Intensidade CTA: {funil_data['cta_intensidade']}
Psicologia: {funil_data['psicologia']}

--- REGRAS DO CTA ---
• O botão de CTA deve ser IMPOSSÍVEL de ignorar — maior elemento da página
• Background diferenciado dos outros slides (mais vibrante, mais contraste)
• Sem distrações — tudo aponta para a ação
• Incluir urgência se funil FUNDO: "Últimas vagas", "Só hoje", etc.
• Gradiente no background cria sensação de "chegamos ao destino"

--- INSTRUÇÃO FINAL ---
Crie o SLIDE FINAL (CTA) de um carrossel de {total_slides} slides para Instagram (1024x1792).
CTA principal: "{post.get('cta', 'Fale conosco')}"
Este slide deve CONVERTER. O botão de ação deve ser o maior e mais visível elemento.
Gradiente de fundo vibrante. Logo da marca em destaque. Design profissional.
Texto em PORTUGUÊS do Brasil.
Estilo: {b['visual']['estilo']}
"""
    return p.strip()


def _content_layout(content):
    """Sugere layout baseado no tipo de conteúdo"""
    if not content:
        return "Layout flexível — preencher com visual de impacto"
    words = content.split()
    if len(words) <= 8:
        return "Texto curto → centralizado, fonte grande (28-32px), muito respiro"
    if any(c in content for c in ['vs', 'x ', 'VS', ' ou ']):
        return "Comparação → split-screen, lado a lado, cores contrastantes"
    if any(c in content for c in ['R$', '%', 'mil', 'anos']):
        return "Dados numéricos → número em destaque gigante (48-64px accent), texto explicativo menor embaixo"
    if content.count(',') >= 2 or content.count(';') >= 2:
        return "Lista de itens → cards ou bullets com ícones, espaçamento generoso"
    return "Parágrafo informativo → texto bem hierarquizado com elemento visual de apoio"


def build_brand_context(brand_data, brand_key):
    """Monta o contexto de marca formatado"""
    b = brand_data or BRANDS.get(brand_key, BRANDS["conquista"])

    # Se veio do frontend (formato simplificado), adaptar
    if 'cores' in b and isinstance(b['cores'], list) and len(b['cores']) > 0 and isinstance(b['cores'][0], dict) and 'hex' in b['cores'][0]:
        cores_str = ', '.join([f"{c.get('nome','')} {c['hex']}" for c in b['cores']])
    else:
        pal = b.get('paleta', {})
        cores_str = ', '.join([f"{v}" for k, v in pal.items() if '_nome' not in k and k not in ('bg_principal', 'bg_card', 'texto_claro', 'texto_muted', 'borda')])

    fontes = b.get('fontes', '')
    if isinstance(fontes, dict):
        fontes = f"Headline: {fontes.get('headline', '')} | Corpo: {fontes.get('corpo', '')}"

    ctx = f"""=== BRAND GUIDELINES: {b.get('nome', brand_key.upper())} ===
Descrição: {b.get('desc', '')}
Público-alvo: {b.get('publico', '')}
Paleta de Cores: {cores_str}
Fontes: {fontes}
Tom de Voz: {b.get('tom', '')}
"""
    regras = b.get('regras', [])
    if isinstance(regras, list):
        ctx += "Regras Visuais:
" + '
'.join([f"  • {r}" for r in regras]) + '
'
    elif isinstance(regras, str):
        ctx += f"Regras Visuais:
{regras}
"

    ctx += "=== FIM BRAND GUIDELINES ===

"
    return ctx


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        self.send_header('Access-Control-Allow-Origin', '*')

        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode())
            return

        post = body.get('post', {})
        brand_key = body.get('brand', 'conquista')
        brand_data = body.get('brandData')  # Custom brand from localStorage
        slide_idx = body.get('slideIdx', 0)
        total_slides = body.get('totalSlides', 1)

        # Build brand context
        brand_ctx = build_brand_context(brand_data, brand_key)
        funil_key = (post.get('funil', '') or 'MEIO').upper()
        funil_data = FUNIL.get(funil_key, FUNIL['MEIO'])

        # Build the prompt
        if total_slides <= 1:
            prompt = build_static_prompt(post, brand_ctx, funil_data, brand_key)
        else:
            prompt = build_carousel_slide(post, brand_ctx, funil_data, brand_key, slide_idx, total_slides)

        # If the post has a custom prompt from spreadsheet, ENHANCE it instead
        custom_prompt = post.get('prompt', '').strip()
        if custom_prompt:
            prompt = brand_ctx + f"""
--- PROMPT BASE DA PLANILHA ---
{custom_prompt}

--- ENRIQUECIMENTO AUTOMÁTICO ---
Formato: Instagram post, 1024x1792 portrait
Estilo visual: {BRANDS.get(brand_key, BRANDS['conquista'])['visual']['estilo']}
Background: {BRANDS.get(brand_key, BRANDS['conquista'])['visual']['bg_tratamento']}
Fotografia: {BRANDS.get(brand_key, BRANDS['conquista'])['visual']['foto_estilo']}
Tipografia headline: {BRANDS.get(brand_key, BRANDS['conquista'])['fontes']['headline']}
Tipografia corpo: {BRANDS.get(brand_key, BRANDS['conquista'])['fontes']['corpo']}
Safe zone: margens de {80 if brand_key == 'imoveis' else 60}px
Handle: {BRANDS.get(brand_key, BRANDS['conquista'])['handle']} no rodapé

--- ESTRATÉGIA DE FUNIL: {funil_key} ---
{funil_data['objetivo']}
{funil_data['visual_strategy']}

--- INSTRUÇÃO ---
Use o prompt base acima como diretriz criativa principal.
Aplique TODAS as brand guidelines e regras visuais descritas.
Crie a imagem profissional finalizada (1024x1792 portrait), pronta para publicação.
Texto em PORTUGUÊS do Brasil.
"""
            if total_slides > 1:
                prompt += f"
Este é o slide {slide_idx + 1} de {total_slides}."
            prompt = prompt.strip()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            "prompt": prompt,
            "brand": brand_key,
            "funil": funil_key,
            "slideIdx": slide_idx,
            "totalSlides": total_slides,
            "promptLength": len(prompt)
        }).encode())
