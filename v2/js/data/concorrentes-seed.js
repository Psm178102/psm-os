/* ============================================================================
   PSM-OS v2 — Radar Concorrência · base de concorrentes
   ----------------------------------------------------------------------------
   Migrado integralmente da análise feita no sistema antigo (/v1, índice
   index.html). São 46 imobiliárias/corretores de São José do Rio Preto (RP)
   monitorados, com:
     - tier (A/B/C) e segmento (MAP / Terceiros / MCMV / Locação)
     - handle Instagram + métricas coletadas (seguidores, posts, CRECI, bio)
     - fb_page_id → link direto para a Biblioteca de Anúncios do Meta
   Coleta de referência: 2026-04-05. Dados estáticos curados (não mudam só).
   A página /concorrencia renderiza isto como Radar (KPIs + filtros + tabela).
============================================================================ */

// Link para a Biblioteca de Anúncios do Meta (campanhas ATIVAS daquele anunciante)
export function adsLibraryUrl(pageId) {
  return 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR'
    + '&is_targeted_country=false&media_type=all&search_type=page'
    + '&sort_data[direction]=desc&sort_data[mode]=total_impressions'
    + '&view_all_page_id=' + pageId;
}

export function instagramUrl(handle) {
  return 'https://instagram.com/' + String(handle || '').replace(/^@/, '');
}

// Converte "27K" / "1.530" / "12K" → número (p/ ordenação). "—" → 0.
export function parseSeguidores(s) {
  if (s == null) return 0;
  const str = String(s).trim().toUpperCase().replace(/\s/g, '');
  if (!str || str === '—') return 0;
  if (str.endsWith('K')) return Math.round(parseFloat(str.replace('K', '').replace(',', '.')) * 1000);
  if (str.endsWith('M')) return Math.round(parseFloat(str.replace('M', '').replace(',', '.')) * 1e6);
  // "1.530" → 1530 (ponto = milhar)
  return parseInt(str.replace(/\./g, '').replace(/,/g, ''), 10) || 0;
}

// fb_page_id quando há ('' = sem página mapeada → só Instagram)
export const CONCORRENTES = [
  { nome:'Empreendimentos Rio Preto',        handle:'@empreendimentos_rp',              tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'27K',   posts:'663',  creci:'040437-J', fb:'',                  bio:'Todos os lançamentos de Rio Preto. empreendimentosriopreto.com.br' },
  { nome:'FG Inteligência Imobiliária',      handle:'@fg_inteligenciaimobiliaria',      tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'1.530', posts:'204',  creci:'J-47617',  fb:'251428058048549',   bio:'1º lugar em experiência e resultado. Parceiros das melhores construtoras' },
  { nome:'Imobiliária São José',             handle:'@imobiliaria_saojose',             tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'8.535', posts:'252',  creci:'039255-J', fb:'109950098309921',   bio:'Especialista em imóveis na planta. SJRP' },
  { nome:'Grupo NexGen',                     handle:'@gruponexgen',                     tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'1.889', posts:'79',   creci:'—',        fb:'857841284076491',   bio:'+200M investidos. Imóveis de médio e alto padrão na planta' },
  { nome:'Renascer & Jales JK',              handle:'@renascerejalesjk',                tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'5.032', posts:'890',  creci:'40.599-J', fb:'1029339286932287',  bio:'+25 anos no alto padrão. Venda, Locação, Compra' },
  { nome:'House 3 Imobiliária',              handle:'@house3imobiliaria',               tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'1.196', posts:'114',  creci:'—',        fb:'336027406258118',   bio:'Transformando experiências imobiliárias. Rua Abrão Thomé, 340' },
  { nome:'Grupo Zani Imobiliária',           handle:'@imobiliariagrupozani',            tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'7.570', posts:'461',  creci:'40.371-J', fb:'101587087976514',   bio:'Imóveis de médio e alto padrão. SJRP e Região' },
  { nome:'Imobiliária Irmãos Ferreira',      handle:'@imobiliariairmaosferreira',       tipo:'imobiliaria', tier:'B', seg:'Terceiros', seguidores:'2.773', posts:'214',  creci:'J-31608',  fb:'1693511670731545',  bio:'Compra, Venda, Locação e Adm de Imóveis' },
  { nome:'Condominium Imóveis',              handle:'@condominiumimoveis',              tipo:'imobiliaria', tier:'A', seg:'Terceiros', seguidores:'8.538', posts:'1852', creci:'J-09635',  fb:'144347112425008',   bio:'Invista em morar bem. Tel 17 4009-3333' },
  { nome:'Imobiliária Westim',               handle:'@imobiliariawestim',               tipo:'imobiliaria', tier:'C', seg:'MAP',       seguidores:'465',   posts:'42',   creci:'31935-J',  fb:'109584225112402',   bio:'Expert em lançamentos, +15 anos. SJRP' },
  { nome:'Shimana Imóveis',                  handle:'@shimanaimoveis',                  tipo:'imobiliaria', tier:'A', seg:'MCMV',      seguidores:'7.986', posts:'1449', creci:'23.050-J', fb:'770368413001259',   bio:'+15 anos viabilizando sonhos. Alto padrão e empreendimentos' },
  { nome:'Atlas Imobiliária',                handle:'@atlas.imb',                       tipo:'imobiliaria', tier:'C', seg:'MCMV',      seguidores:'651',   posts:'36',   creci:'048188-J', fb:'499455473247880',   bio:'Seu guia na jornada do imóvel ideal. SJRP' },
  { nome:'5G Imóveis',                       handle:'@5gimoveis',                       tipo:'imobiliaria', tier:'B', seg:'Terceiros', seguidores:'2.144', posts:'186',  creci:'—',        fb:'112977187072469',   bio:'Imóveis em SJ Rio Preto/SP e Região' },
  { nome:'Gemim Negócios Imobiliários',      handle:'@gemimnegociosimobiliarios',       tipo:'imobiliaria', tier:'B', seg:'MAP',       seguidores:'4.527', posts:'119',  creci:'—',        fb:'103782116143274',   bio:'Especialista médio/alto padrão. Consórcio Rodobens. Edifício Onix SJRP' },
  { nome:'Ana Ancheta Imóveis',              handle:'@anaancheta.imoveis',              tipo:'imobiliaria', tier:'A', seg:'Terceiros', seguidores:'14K',   posts:'2158', creci:'37134-J',  fb:'101422654811836',   bio:'Ética na comercialização de imóveis' },
  { nome:'Allegro Prime',                    handle:'@allegroprime.oficial',            tipo:'imobiliaria', tier:'A', seg:'MAP',       seguidores:'2.848', posts:'436',  creci:'43017-J',  fb:'111717875267207',   bio:'Especialistas em realizar sonhos. Melhores opções em Rio Preto' },
  { nome:'Imóveis Nova Geração RP',          handle:'@imoveisnovageracaorp',            tipo:'imobiliaria', tier:'B', seg:'Terceiros', seguidores:'2.957', posts:'493',  creci:'40525-J',  fb:'102488338043286',   bio:'Compra, Venda e Locação de Imóveis' },
  { nome:'Imóveis Alto Padrão SJRP',         handle:'@imoveisaltopadrao_sjrp',          tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'9.893', posts:'247',  creci:'—',        fb:'111269225330893',   bio:'Consultora imobiliária. Transformando sonhos em realidade' },
  { nome:'Alonso Negócios Imobiliários',     handle:'@alonso_negociosimobiliarios',     tipo:'imobiliaria', tier:'A', seg:'MCMV',      seguidores:'6.123', posts:'537',  creci:'046071-J', fb:'214733118396261',   bio:'1º imóvel com R$500 de entrada. Minha Casa Minha Vida' },
  { nome:'Bless Imobiliária',                handle:'@blessriopreto',                   tipo:'imobiliaria', tier:'B', seg:'MCMV',      seguidores:'4.007', posts:'337',  creci:'37724-J',  fb:'103307098655854',   bio:'Transformando sonhos em novos endereços. Rio Preto e região' },
  { nome:'Gabriel Elegance Imóveis',         handle:'@gabrieleleganceimoveis',          tipo:'imobiliaria', tier:'A', seg:'MCMV',      seguidores:'9.959', posts:'341',  creci:'46158-J',  fb:'104791488719525',   bio:'Construindo e realizando sonhos' },
  { nome:'Fit Prime (Renascer Jales)',       handle:'@imobiliariafitprime',             tipo:'imobiliaria', tier:'B', seg:'MCMV',      seguidores:'3.116', posts:'2102', creci:'30639-J',  fb:'104029939216479',   bio:'Seu imóvel na medida certa' },
  { nome:'Felix & Maciel',                   handle:'@imobiliariafelixemaciel',         tipo:'imobiliaria', tier:'C', seg:'MCMV',      seguidores:'485',   posts:'138',  creci:'40033-J',  fb:'100371522647785',   bio:'Entregando muito mais que imóveis. SJRP e Araras' },
  { nome:'Martin & Carrazone',               handle:'@martincarrazoneimoveis',          tipo:'imobiliaria', tier:'B', seg:'MCMV',      seguidores:'3.971', posts:'228',  creci:'45966-J',  fb:'243459655523557',   bio:'+500 sonhos realizados. Especialistas em Lançamentos' },
  { nome:'Vanessa Brianti',                  handle:'@vanessabrianti_imoveis',          tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'6.215', posts:'1479', creci:'229.115-F',fb:'400613696477539',   bio:'Especialista em Alto Padrão. Advogada licenciada. SJRP' },
  { nome:'Guilherme Neilly',                 handle:'@corretorguilhermeneilly',         tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'106K',  posts:'4657', creci:'—',        fb:'105137467515540',   bio:'Referência no mercado SJRP. Corretor Revelação 2025. 19 anos' },
  { nome:'João Gabriel Imóveis',             handle:'@joaogabriel.imoveis',             tipo:'corretor',    tier:'B', seg:'Terceiros', seguidores:'4.552', posts:'252',  creci:'196.731-F',fb:'104031465786185',   bio:'Imóveis de médio e alto padrão. SJRP' },
  { nome:'Urbano Negócios Imobiliários',     handle:'@urbano_negocios_imobiliarios',    tipo:'imobiliaria', tier:'C', seg:'Terceiros', seguidores:'873',   posts:'342',  creci:'38.370-J', fb:'111954114977621',   bio:'Condomínios horizontais e verticais, prontos ou na planta' },
  { nome:'Diego Urbano Imóveis',             handle:'@diegourbano.imoveis',             tipo:'corretor',    tier:'B', seg:'Terceiros', seguidores:'4.200', posts:'1042', creci:'225960-F', fb:'830545453485228',   bio:'Atendimento personalizado. Condomínios prontos ou na planta' },
  { nome:'Mateus Santilli',                  handle:'@mateussantillicorretor',          tipo:'corretor',    tier:'B', seg:'Terceiros', seguidores:'4.869', posts:'426',  creci:'—',        fb:'164196200120273',   bio:'Especialista em investimentos imobiliários. Alto padrão' },
  { nome:'JP Bonfá',                         handle:'@jpbonfa',                         tipo:'corretor',    tier:'B', seg:'MAP',       seguidores:'2.984', posts:'28',   creci:'—',        fb:'109848154827554',   bio:'Especialista em lançamentos médio/alto padrão SJRP desde 2021' },
  { nome:'Marco Deboletta',                  handle:'@corretor.marcodeboletta',         tipo:'corretor',    tier:'B', seg:'Terceiros', seguidores:'2.957', posts:'509',  creci:'219.151-F',fb:'122097377192007409',bio:'Imóveis médio e alto padrão. SJRP' },
  { nome:'Marineli Bolandin',                handle:'@maribolandin_altopadrao',         tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'35K',   posts:'875',  creci:'266966-F', fb:'1445088742301910',  bio:'Especialista no mercado de mais alto padrão de SJRP' },
  { nome:'Gabi Imóveis',                     handle:'@imoveisgabi',                     tipo:'corretor',    tier:'B', seg:'Terceiros', seguidores:'5.843', posts:'278',  creci:'—',        fb:'108413597406322',   bio:'+50M em imóveis vendidos' },
  { nome:'João Mozaquatro',                  handle:'@joaomozaquatro',                  tipo:'corretor',    tier:'B', seg:'Terceiros', seguidores:'4.375', posts:'693',  creci:'—',        fb:'102322759550436',   bio:'5 anos no alto padrão SJRP. Conforto, exclusividade e segurança' },
  { nome:'João Vitor Ferreira de Souza',     handle:'@joaovitorfs',                     tipo:'corretor',    tier:'C', seg:'Terceiros', seguidores:'310',   posts:'23',   creci:'304813-F', fb:'',                  bio:'Negócios Imobiliários' },
  { nome:'Marco Vessani',                    handle:'@marcovessani',                    tipo:'corretor',    tier:'B', seg:'MAP',       seguidores:'3.278', posts:'1035', creci:'217395-F', fb:'101976961866630',   bio:'Especialista em lançamentos. Atendimento personalizado' },
  { nome:'Franco Marinho',                   handle:'@francomarinho.corretor',          tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'13K',   posts:'1913', creci:'—',        fb:'362467630752770',   bio:'Corretor de Imóveis. Luxo. Melhores oportunidades' },
  { nome:'RR Broker',                        handle:'@rrbroker',                        tipo:'imobiliaria', tier:'B', seg:'MCMV',      seguidores:'5.545', posts:'1864', creci:'29199-J',  fb:'327246514399591',   bio:'Imóveis exclusivos. Lançamentos. Treinamentos em vendas' },
  { nome:'Porta 8 Imóveis',                  handle:'@porta8imoveis',                   tipo:'imobiliaria', tier:'A', seg:'Locação',   seguidores:'20K',   posts:'514',  creci:'27.969-J', fb:'107775701156073',   bio:'12 anos transformando sonhos imobiliários em Rio Preto' },
  { nome:'Compacto Imóveis',                 handle:'@compactoimoveis',                 tipo:'imobiliaria', tier:'A', seg:'Locação',   seguidores:'39K',   posts:'1893', creci:'—',        fb:'114751304955764',   bio:'Imobiliária completa. 1 imóvel alugado a cada 2 horas' },
  { nome:'Allianza Negócios Imobiliários',   handle:'@allianzanegociosimobiliarios',    tipo:'imobiliaria', tier:'A', seg:'Terceiros', seguidores:'2.805', posts:'668',  creci:'J-27369',  fb:'837960639566169',   bio:'Venda, compra, financiamento, consórcio, locação e adm. SJRP' },
  { nome:'Andréa Torquatto',                 handle:'@andreatorquatto',                 tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'12K',   posts:'989',  creci:'—',        fb:'100558971514637',   bio:'Especialista imóveis médio e alto padrão. SJRP' },
  { nome:'Fred Tonelli Neto',                handle:'@fredtonellineto',                 tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'14K',   posts:'607',  creci:'—',        fb:'754051904456906',   bio:'20 anos no mercado. Fundador @allianzanegociosimobiliarios' },
  { nome:'Simone Moreno',                    handle:'@simonemoreno_negimobiliarios',    tipo:'corretor',    tier:'A', seg:'Terceiros', seguidores:'12K',   posts:'1050', creci:'213635-F', fb:'738752766476515',   bio:'Corretora. Transformando sonhos em realidade. SJRP' },
  { nome:'Jean Doniani',                     handle:'@jeandoniani',                     tipo:'corretor',    tier:'A', seg:'MAP',       seguidores:'18K',   posts:'155',  creci:'—',        fb:'405869292615098',   bio:'Empresário do mercado imobiliário. Fundador da @imobiliaria_saojose' },
];

// Descrições dos segmentos (mapeamento estratégico — espelha o /v1)
export const SEGMENTOS = {
  'MAP':       { label: 'Médio e Alto Padrão', cor: '#7c3aed', desc: 'Lançamentos e imóveis na planta de médio/alto valor — o core do PSM.' },
  'Terceiros': { label: 'Terceiros / Avulsos',  cor: '#2563eb', desc: 'Imóveis de terceiros, revenda e usados (carteira aberta).' },
  'MCMV':      { label: 'Minha Casa Minha Vida', cor: '#16a34a', desc: 'Programa habitacional / entrada facilitada / econômico.' },
  'Locação':   { label: 'Locação',               cor: '#d97706', desc: 'Foco em aluguel e administração de imóveis.' },
};
