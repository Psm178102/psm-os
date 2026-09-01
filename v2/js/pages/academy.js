/* ============================================================================
   PSM-OS v2 — PSM ACADEMY (a faculdade da PSM · do zero ao expert)
   ----------------------------------------------------------------------------
   Universidade interna: 11 trilhas → níveis (Fundamentos→Expert) → módulos →
   aulas. Jornada do aluno com progresso, subida de nível e CERTIFICADO ao
   concluir a trilha. Modo construtor (gestão) monta/edita aulas e instala o
   currículo. Conteúdo real (links Drive/YouTube ou texto inline) plugado pela
   PSM. Acesso a todos; edição lvl>=7.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];          // aulas (academy_items)
let _done = new Set();    // ids concluídos pelo usuário
let _pendItems = false, _pendProg = false;
let _view = 'journey';    // journey | trilha | builder | professor
let _trilha = null;       // trilha selecionada (detalhe)
let _cfg = { radio: [], notebooklm_url: '', notebooklm_desc: '', tutor_extra: '', meta_aulas_semana: 2, meta_treinos_semana: 1 }; // Config da Escola
let _chat = [];           // histórico do Professor PSM (sessão)
let _chatBusy = false;
let _dates = {};          // item_id → completed_at (meta semanal)
let _treinos = [];        // histórico da Sala de Treino do usuário
let _trCen = null;        // cenário ativo do treino
let _trChat = [];         // conversa do treino atual
let _trBusy = false;
let _trAval = null;       // avaliação recebida ao encerrar

/* Cenários exibidos no front (personas ficam no backend — ia/chat.py) */
const TREINOS = [
  { id: 'mcmv_inseguro', ico: '😰', nome: 'Cliente MCMV inseguro', desc: 'Marcos quer sair do aluguel mas morre de medo do financiamento. Acalme, explique e conduza.' },
  { id: 'map_frio', ico: '🥶', nome: 'Alto padrão frio (NEPQ)', desc: 'Dr. Ricardo: seco, sem tempo, testa sua autoridade. Só perguntas inteligentes abrem essa porta.' },
  { id: 'exclusividade', ico: '🔑', nome: 'Proprietário × exclusividade', desc: 'Dona Vera acha que exclusividade prende o imóvel. Mostre o que ela ganha — sem empurrar.' },
  { id: 'ta_caro', ico: '💸', nome: 'Objeção: "tá caro"', desc: 'Júlia e Pedro amaram o apê mas ancoraram R$ 40 mil abaixo. Separe preço de valor.' },
  { id: 'lead_sumido', ico: '👻', nome: 'Lead que sumiu', desc: 'Fernanda visitou e parou de responder há 12 dias. Reabra a conversa sem pressionar.' },
];

export const NIVEIS = ['Fundamentos', 'Iniciante', 'Intermediário', 'Avançado', 'Expert'];
const NIVEL_IDX = Object.fromEntries(NIVEIS.map((n, i) => [n, i]));
const NIVEL_COR = ['#16a34a', '#2563eb', '#7c3aed', '#d97706', '#dc2626'];
const TIPO_IC = { aula: '📘', video: '🎥', curso: '🎓', playbook: '📗', script: '📝', doc: '📄', link: '🔗', podcast: '🎧', playlist: '🎵', apresentacao: '📽', foto: '🖼' };
const canEdit = () => (auth.user()?.lvl || 0) >= 7;

/* ─── Player embutido: transforma URL comum em URL de embed ──────────────
   YouTube (vídeo, shorts, playlist), Spotify (playlist/show/episode/album/
   track) e Google Drive (preview). Retorna null se não der pra embutir. */
export function embedInfo(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com') {
      let vid = '', list = u.searchParams.get('list') || '';
      if (h === 'youtu.be') vid = u.pathname.slice(1).split('/')[0];
      else if (u.pathname.startsWith('/watch')) vid = u.searchParams.get('v') || '';
      else if (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/embed/') || u.pathname.startsWith('/live/')) vid = u.pathname.split('/')[2] || '';
      if (!vid && list) return { kind: 'youtube', ratio: '16/9', src: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}` };
      if (vid) return { kind: 'youtube', ratio: '16/9', src: `https://www.youtube.com/embed/${encodeURIComponent(vid)}${list ? '?list=' + encodeURIComponent(list) : ''}` };
      return null;
    }
    if (h === 'open.spotify.com') {
      const m = u.pathname.match(/^\/(?:intl-[a-z]+\/)?(playlist|show|episode|album|track|artist)\/([A-Za-z0-9]+)/);
      if (m) return { kind: 'spotify', height: (m[1] === 'episode' || m[1] === 'track') ? 152 : 352, src: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
      return null;
    }
    if (h === 'drive.google.com') {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      if (m) return { kind: 'drive', ratio: '16/10', src: `https://drive.google.com/file/d/${m[1]}/preview` };
      return null;
    }
    if (h === 'docs.google.com' && /\/presentation\//.test(u.pathname)) {
      const m = u.pathname.match(/\/presentation\/d\/([^/]+)/);
      if (m) return { kind: 'slides', ratio: '16/9', src: `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false` };
    }
    return null;
  } catch (_) { return null; }
}
function embedIframe(info, title) {
  if (info.kind === 'spotify') {
    return `<iframe src="${esc(info.src)}" title="${esc(title || 'player')}" style="width:100%;height:${info.height}px;border:0;border-radius:12px" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }
  return `<div style="position:relative;width:100%;aspect-ratio:${info.ratio || '16/9'};background:#000;border-radius:12px;overflow:hidden">
    <iframe src="${esc(info.src)}" title="${esc(title || 'player')}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>
  </div>`;
}

/* ─── EMENTA (currículo do zero ao expert) das 11 trilhas ───────────────── */
export const CURRICULUM = [
  { trilha: 'Mercado Básico', icon: '🏘️', cargo: 'todos', modulos: [
    { nivel: 'Fundamentos', nome: 'Bem-vindo ao mercado imobiliário', aulas: ['Como funciona o mercado imobiliário brasileiro', 'Tipos e nomenclatura de imóveis', 'Players do mercado: imobiliária, corretor, construtora, incorporadora', 'O ciclo completo de uma venda'] },
    { nivel: 'Fundamentos', nome: 'O corretor profissional', aulas: ['CRECI: o que é e por que importa', 'Ética e código de conduta do corretor', 'Postura, imagem e comunicação profissional', 'Rotina e organização do corretor de sucesso'] },
    { nivel: 'Iniciante', nome: 'Produto e precificação', aulas: ['Avaliação de imóveis: como precificar', 'Documentação básica de um imóvel', 'Matrícula, IPTU e ônus', 'Padrões construtivos e acabamentos'] },
    { nivel: 'Intermediário', nome: 'Captação e carteira', aulas: ['Como captar imóveis de qualidade', 'Autorização de venda e exclusividade', 'Construção e gestão da carteira', 'Relacionamento com proprietários'] },
    { nivel: 'Avançado', nome: 'Visão de mercado', aulas: ['Leitura de ciclos e tendências', 'Indicadores: FipeZap, Selic, INCC', 'Segmentação: econômico, médio e alto padrão', 'Como a PSM se posiciona no mercado'] },
  ]},
  { trilha: 'Vendas', icon: '🤝', cargo: 'corretor', modulos: [
    { nivel: 'Fundamentos', nome: 'A base da venda', aulas: ['Mentalidade de alta performance', 'Funil de vendas e cada etapa', 'Prospecção: onde estão os clientes', 'Primeiro contato que gera conexão'] },
    { nivel: 'Iniciante', nome: 'Atendimento e qualificação', aulas: ['Qualificação de leads na prática', 'Levantamento de necessidades', 'Agendamento e preparação da visita', 'Conduzindo a visita ao imóvel'] },
    { nivel: 'Intermediário', nome: 'Negociação', aulas: ['Apresentação de proposta e ancoragem', 'Contorno de objeções (preço, prazo, indecisão)', 'Técnicas de fechamento', 'Senso de urgência ético'] },
    { nivel: 'Avançado', nome: 'Vendas de alto valor', aulas: ['Venda consultiva e autoridade', 'Atendimento ao cliente de alto padrão', 'Pós-venda e indicações', 'Carteira de relacionamento e recompra'] },
    { nivel: 'Expert', nome: 'Máquina de vendas PSM', aulas: ['Os 4 motores de venda da PSM', 'Metas, KPIs e gestão do próprio funil', 'Rotina de um corretor de alta performance', 'Estudo de casos reais PSM'] },
  ]},
  { trilha: 'Marketing', icon: '📣', cargo: 'todos', modulos: [
    { nivel: 'Fundamentos', nome: 'Marketing imobiliário', aulas: ['Conceitos de marketing para imóveis', 'Marca pessoal do corretor', 'Posicionamento e nicho', 'Jornada do cliente online'] },
    { nivel: 'Iniciante', nome: 'Conteúdo e redes', aulas: ['Instagram para corretor: o essencial', 'Reels e vídeos que vendem', 'Fotografia e descrição de imóveis', 'Calendário de conteúdo'] },
    { nivel: 'Intermediário', nome: 'Tráfego e leads', aulas: ['Introdução ao tráfego pago (Meta Ads)', 'Anúncios de imóvel que geram lead', 'Landing pages e formulários', 'Métricas: CPL, CTR e conversão'] },
    { nivel: 'Avançado', nome: 'Branding e autoridade', aulas: ['Storytelling e branding pessoal', 'Parcerias e prova social', 'Gestão de reputação online', 'Funil de conteúdo até a venda'] },
  ]},
  { trilha: 'Noção Contábil', icon: '🧮', cargo: 'todos', modulos: [
    { nivel: 'Fundamentos', nome: 'Finanças do corretor', aulas: ['Corretor autônomo x PJ', 'Como a comissão é calculada e dividida', 'Fluxo de caixa pessoal', 'Reserva e previsibilidade de renda'] },
    { nivel: 'Iniciante', nome: 'Tributos na venda', aulas: ['Imposto de Renda do corretor', 'Nota fiscal e recibos', 'ITBI na compra e venda', 'Ganho de capital na venda de imóvel'] },
    { nivel: 'Intermediário', nome: 'Saúde financeira do negócio', aulas: ['Noções de DRE e fluxo de caixa', 'Custos fixos x variáveis', 'Margem e lucro de uma operação', 'Planejamento financeiro anual'] },
  ]},
  { trilha: 'Noção Direito', icon: '⚖️', cargo: 'todos', modulos: [
    { nivel: 'Fundamentos', nome: 'Direito imobiliário básico', aulas: ['Contratos: o que os torna válidos', 'Compra e venda: do sinal à escritura', 'Promessa de compra e venda', 'Direitos e deveres das partes'] },
    { nivel: 'Iniciante', nome: 'Documentação e registro', aulas: ['Matrícula e averbações', 'Registro de imóveis e cartório', 'Certidões essenciais', 'Regularização e pendências comuns'] },
    { nivel: 'Intermediário', nome: 'Situações especiais', aulas: ['Inventário, espólio e herança', 'Usufruto, doação e permuta', 'Financiamento e alienação fiduciária', 'Distrato e rescisão'] },
    { nivel: 'Avançado', nome: 'Locação e responsabilidade', aulas: ['Lei do Inquilinato (essencial)', 'Garantias locatícias', 'Responsabilidade civil do corretor', 'LGPD no dia a dia imobiliário'] },
  ]},
  { trilha: 'PNL', icon: '🧠', cargo: 'todos', modulos: [
    { nivel: 'Fundamentos', nome: 'PNL aplicada a vendas', aulas: ['O que é PNL e como ajuda o corretor', 'Rapport: conexão instantânea', 'Calibragem e leitura do cliente', 'Linguagem positiva e influência ética'] },
    { nivel: 'Iniciante', nome: 'Comunicação persuasiva', aulas: ['Sistemas representacionais (visual/auditivo/cinestésico)', 'Âncoras e estados emocionais', 'Perguntas poderosas', 'Escuta ativa'] },
    { nivel: 'Intermediário', nome: 'Alta performance pessoal', aulas: ['Crenças e mentalidade de campeão', 'Gestão emocional sob pressão', 'Metas bem formuladas', 'Foco e produtividade'] },
  ]},
  { trilha: 'Lançamentos MCMV', icon: '🏗️', cargo: 'corretor', modulos: [
    { nivel: 'Fundamentos', nome: 'Entendendo o MCMV', aulas: ['O que é o Minha Casa Minha Vida', 'Faixas de renda e regras atuais', 'Perfil do cliente MCMV', 'Subsídios e juros'] },
    { nivel: 'Iniciante', nome: 'Produto e financiamento', aulas: ['Como funciona o financiamento Caixa', 'Documentação do cliente', 'Simulação e aprovação de crédito', 'Entrada, FGTS e subsídio'] },
    { nivel: 'Intermediário', nome: 'Venda de lançamento MCMV', aulas: ['Argumentos de venda do MCMV', 'Plantão de vendas: como atuar', 'Tabela de vendas e reserva de unidade', 'Acompanhamento do contrato'] },
    { nivel: 'Avançado', nome: 'Especialista MCMV', aulas: ['Objeções específicas do público', 'Parcerias com construtoras', 'Como escalar volume de vendas', 'Casos reais PSM Conquista'] },
  ]},
  { trilha: 'Lançamentos M.A.P', icon: '🏙️', cargo: 'corretor', modulos: [
    { nivel: 'Fundamentos', nome: 'Mercado de Alto Padrão', aulas: ['O que define o alto padrão', 'Perfil e desejos do cliente M.A.P', 'Vender econômico x vender luxo', 'Posicionamento e discrição'] },
    { nivel: 'Iniciante', nome: 'Produto de luxo', aulas: ['Atributos de valor: localização, arquitetura, exclusividade', 'Leitura de planta e diferenciais', 'Acabamentos e personalização', 'Precificação no alto padrão'] },
    { nivel: 'Intermediário', nome: 'Atendimento M.A.P', aulas: ['Experiência de atendimento premium', 'Confiança e autoridade', 'Tour de imóvel de luxo', 'Negociação no alto padrão'] },
    { nivel: 'Avançado', nome: 'Especialista M.A.P', aulas: ['Networking de alto poder aquisitivo', 'Marketing de luxo e sigilo', 'Parcerias com incorporadoras premium', 'Casos reais PSM Imóveis'] },
  ]},
  { trilha: 'Terceiros', icon: '🏠', cargo: 'corretor', modulos: [
    { nivel: 'Fundamentos', nome: 'Mercado de terceiros (revenda)', aulas: ['O que é o mercado de usados', 'Diferença para lançamento', 'Captação de imóveis de terceiros', 'Avaliação de imóvel usado'] },
    { nivel: 'Iniciante', nome: 'Documentação na revenda', aulas: ['Análise de documentação do vendedor e do imóvel', 'Pendências e regularização', 'Preço de mercado', 'Autorização e exclusividade'] },
    { nivel: 'Intermediário', nome: 'Venda e negociação de usados', aulas: ['Anúncio e divulgação eficaz', 'Visitas e gestão de interessados', 'Negociação comprador x vendedor', 'Proposta, sinal e contrato'] },
    { nivel: 'Avançado', nome: 'Fechamento e financiamento', aulas: ['Financiamento na compra de usado', 'Da proposta à escritura', 'Comissão e repasses', 'Pós-venda e indicação'] },
  ]},
  { trilha: 'Locação', icon: '🔑', cargo: 'todos', modulos: [
    { nivel: 'Fundamentos', nome: 'Mercado de locação', aulas: ['Locação residencial e comercial', 'Papel da imobiliária na locação', 'Lei do Inquilinato: visão geral', 'Captação de imóveis para locar'] },
    { nivel: 'Iniciante', nome: 'Processo de locação', aulas: ['Anúncio e precificação do aluguel', 'Análise cadastral do locatário', 'Garantias: fiador, caução, seguro-fiança', 'Contrato de locação'] },
    { nivel: 'Intermediário', nome: 'Administração de locação', aulas: ['Vistoria de entrada e saída', 'Repasse de aluguéis e taxas', 'Reajuste e renovação', 'Inadimplência e despejo (noções)'] },
    { nivel: 'Avançado', nome: 'Gestão de carteira', aulas: ['Retenção de proprietários e inquilinos', 'Carteira recorrente e previsibilidade', 'Manutenção e relacionamento', 'Métricas da operação de locação'] },
  ]},
  { trilha: 'Urbanismo', icon: '🌆', cargo: 'todos', modulos: [
    { nivel: 'Fundamentos', nome: 'Urbanismo e cidade', aulas: ['O que é urbanismo e por que importa pro corretor', 'Plano Diretor e zoneamento', 'Uso e ocupação do solo', 'Infraestrutura e valorização'] },
    { nivel: 'Iniciante', nome: 'Loteamentos e terrenos', aulas: ['Tipos de loteamento (aberto e fechado)', 'Lei de parcelamento do solo', 'Aprovação de projetos e regularização', 'Avaliação de terrenos'] },
    { nivel: 'Intermediário', nome: 'Valorização e desenvolvimento', aulas: ['Vetores de crescimento da cidade', 'Como identificar regiões em valorização', 'Mobilidade, comércio e equipamentos', 'Sustentabilidade e tendências urbanas'] },
  ]},
];

function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function curriculumItems() {
  const out = [];
  CURRICULUM.forEach(t => {
    t.modulos.forEach((m, mi) => {
      m.aulas.forEach((a, ai) => {
        out.push({ id: `seed_${slug(t.trilha)}_${mi}_${ai}`, trilha: t.trilha, nivel: m.nivel, modulo: m.nome, titulo: a, tipo: 'aula', cargo: t.cargo, ordem: mi * 100 + ai });
      });
    });
  });
  return out;
}
const TRILHA_ICON = Object.fromEntries(CURRICULUM.map(t => [t.trilha, t.icon]));
const TRILHA_ORDER = CURRICULUM.map(t => t.trilha);

export async function pageAcademy(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 2) { root.innerHTML = '<div class="alert alert-warn">🔒 Acesso restrito.</div>'; return; }
  _view = 'journey'; _trilha = null;
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando a Academy…</div></div>`;
  await load();
}

async function load() {
  const [r, p, c, t] = await Promise.all([
    api.request('/api/v3/diretoria/academy').catch(() => ({ items: [] })),
    api.request('/api/v3/diretoria/academy_progress').catch(() => ({ completed: [] })),
    api.request('/api/v3/diretoria/academy_config').catch(() => ({ config: null })),
    api.request('/api/v3/diretoria/academy_treino').catch(() => ({ treinos: [] })),
  ]);
  _items = r.items || [];
  _pendItems = !!r.pending;
  _done = new Set(p.completed || []);
  _dates = p.dates || {};
  _pendProg = !!p.pending;
  if (c && c.config) _cfg = Object.assign({ radio: [], notebooklm_url: '', notebooklm_desc: '', tutor_extra: '', meta_aulas_semana: 2, meta_treinos_semana: 1 }, c.config);
  _treinos = (t && t.treinos) || [];
  render();
}

/* ─── semana de estudo (segunda 00:00 local até agora) ─── */
function weekStart() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - dow);
  return d;
}
function studyWeekStats() {
  const ini = weekStart();
  const aulas = Object.values(_dates).filter(ts => ts && new Date(ts) >= ini).length;
  const treinos = _treinos.filter(t => t.created_at && new Date(t.created_at) >= ini).length;
  return { aulas, treinos, metaA: _cfg.meta_aulas_semana || 0, metaT: _cfg.meta_treinos_semana || 0 };
}

/* ─── agregações ─── */
function trilhasList() {
  const names = [...new Set([..._items.map(i => i.trilha || 'Geral')])];
  names.sort((a, b) => (TRILHA_ORDER.indexOf(a) + 1 || 99) - (TRILHA_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return names.map(n => {
    const aulas = _items.filter(i => (i.trilha || 'Geral') === n);
    const done = aulas.filter(a => _done.has(a.id)).length;
    const pct = aulas.length ? Math.round(done / aulas.length * 100) : 0;
    // nível atual = nível da próxima aula não concluída (ou Expert se 100%)
    const pend = aulas.filter(a => !_done.has(a.id)).sort(byNivelOrdem)[0];
    const nivel = pct === 100 ? 'Concluído' : (pend ? (pend.nivel || '—') : '—');
    return { nome: n, icon: TRILHA_ICON[n] || '🎓', aulas, total: aulas.length, done, pct, nivel };
  });
}
function byNivelOrdem(a, b) {
  const na = NIVEL_IDX[a.nivel] ?? 9, nb = NIVEL_IDX[b.nivel] ?? 9;
  return na - nb || (a.ordem || 0) - (b.ordem || 0);
}

/* ─── render principal ─── */
function render() {
  if (_view === 'trilha' && _trilha) return renderTrilha();
  if (_view === 'builder') return renderBuilder();
  if (_view === 'professor') return renderProfessor();
  if (_view === 'treino') return renderTreino();
  renderJourney();
}

function header(extra) {
  return `
    <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div style="flex:1;min-width:240px">
        <h2 class="card-title">🎓 PSM Academy</h2>
        <p class="card-sub">A faculdade da PSM — do zero ao nível expert. Trilhas, níveis, módulos e aulas, com seu progresso e certificado.</p>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        ${_view !== 'journey' ? `<button class="btn btn-ghost" id="ac-home">🏠 Minha Jornada</button>` : ''}
        <button class="btn ${_view === 'treino' ? 'btn-primary' : 'btn-ghost'}" id="ac-treino">🥊 Sala de Treino</button>
        <button class="btn ${_view === 'professor' ? 'btn-primary' : 'btn-ghost'}" id="ac-prof">👨‍🏫 Professor PSM</button>
        ${canEdit() ? `<button class="btn ${_view === 'builder' ? 'btn-primary' : 'btn-ghost'}" id="ac-builder">🛠 Construtor</button>` : ''}
      </div>
    </div>
    ${extra || ''}`;
}

function bindHeader() {
  const h = document.getElementById('ac-home'); if (h) h.addEventListener('click', () => { _view = 'journey'; _trilha = null; render(); });
  const b = document.getElementById('ac-builder'); if (b) b.addEventListener('click', () => { _view = _view === 'builder' ? 'journey' : 'builder'; render(); });
  const pr = document.getElementById('ac-prof'); if (pr) pr.addEventListener('click', () => { _view = _view === 'professor' ? 'journey' : 'professor'; _trilha = null; render(); });
  const tr = document.getElementById('ac-treino'); if (tr) tr.addEventListener('click', () => { _view = _view === 'treino' ? 'journey' : 'treino'; _trilha = null; render(); });
}

/* ─── VIEW: Minha Jornada ─── */
function renderJourney() {
  const trilhas = trilhasList();
  const iniciadas = trilhas.filter(t => t.done > 0).length;
  const aulasDone = _done.size;
  const certificados = trilhas.filter(t => t.total > 0 && t.pct === 100).length;
  const pctMedio = trilhas.length ? Math.round(trilhas.reduce((s, t) => s + t.pct, 0) / trilhas.length) : 0;

  _root.innerHTML = `
    <style>
      .ac-tcard{background:var(--bg-1,#fff);border:1px solid var(--border);border-radius:14px;padding:16px;cursor:pointer;transition:transform .12s,box-shadow .12s}
      .ac-tcard:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(15,23,42,.12)}
      .ac-bar{height:8px;border-radius:5px;background:var(--bg-3,#e2e8f0);overflow:hidden}
      .ac-bar>i{display:block;height:100%;border-radius:5px;transition:width .5s}
      .ac-niv{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:800}
    </style>
    <div class="card">
      ${header()}
      ${_pendItems ? `<div class="alert alert-warn" style="margin-top:10px">⏳ Rode <code>supabase/sprint9_22_academy.sql</code> e <code>sprint9_25_academy_faculdade.sql</code> pra ativar a Academy.</div>` : ''}
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('🛤 Trilhas', trilhas.length, '#2563eb')}
        ${kpi('▶ Iniciadas', iniciadas, '#7c3aed')}
        ${kpi('✅ Aulas concluídas', aulasDone, '#16a34a')}
        ${kpi('🏅 Certificados', certificados, '#d4a843')}
      </div>
      ${trilhas.length ? `<div style="margin-top:6px"><div class="tiny muted" style="margin:8px 0 4px">Progresso geral da sua formação</div><div class="ac-bar"><i style="width:${pctMedio}%;background:linear-gradient(90deg,#16a34a,#22c55e)"></i></div><div class="tiny muted" style="margin-top:3px">${pctMedio}% concluído</div></div>` : ''}
    </div>

    ${escolaStrip()}

    ${!trilhas.length ? `
      <div class="card" style="text-align:center;padding:48px 22px">
        <div style="font-size:50px">🎓</div>
        <h3 style="margin:10px 0 4px">A faculdade da PSM ainda não foi instalada</h3>
        <p class="muted" style="max-width:540px;display:inline-block;margin:0 0 16px">As 11 trilhas (do mercado básico ao alto padrão) já têm a ementa pronta — é só instalar o currículo e plugar os vídeos/materiais em cada aula.</p>
        ${canEdit() ? `<div><button class="btn btn-primary" id="ac-install0">📚 Instalar currículo PSM</button></div>` : `<p class="tiny muted">A diretoria vai publicar as trilhas em breve.</p>`}
      </div>` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:14px" id="ac-grid">
        ${trilhas.map(trilhaCard).join('')}
      </div>`}

    ${radioSection()}
    <div id="ac-modal"></div>
  `;
  bindHeader();
  const i0 = document.getElementById('ac-install0'); if (i0) i0.addEventListener('click', installCurriculo);
  const p0 = document.getElementById('ac-prof0'); if (p0) p0.addEventListener('click', () => { _view = 'professor'; render(); });
  const t0 = document.getElementById('ac-tr0'); if (t0) t0.addEventListener('click', () => { _view = 'treino'; render(); });
  _root.querySelectorAll('[data-trilha]').forEach(el => el.addEventListener('click', () => { _trilha = el.dataset.trilha; _view = 'trilha'; render(); }));
}

/* ─── Escola: meta da semana + Professor + Sala de Treino + NotebookLM ─── */
function metaBar(label, feito, meta, cor) {
  const pct = meta ? Math.min(100, Math.round(feito / meta * 100)) : 0;
  const ok = meta && feito >= meta;
  return `
    <div style="flex:1;min-width:130px">
      <div class="tiny" style="display:flex;justify-content:space-between"><span class="muted">${label}</span><b style="color:${ok ? '#16a34a' : cor}">${feito}/${meta}${ok ? ' ✓' : ''}</b></div>
      <div class="ac-bar" style="margin-top:3px"><i style="width:${pct}%;background:${ok ? 'linear-gradient(90deg,#16a34a,#22c55e)' : cor}"></i></div>
    </div>`;
}

function escolaStrip() {
  const nb = _cfg.notebooklm_url;
  const w = studyWeekStats();
  const temMeta = (w.metaA > 0 || w.metaT > 0);
  const bateu = (!w.metaA || w.aulas >= w.metaA) && (!w.metaT || w.treinos >= w.metaT);
  const ultimaNota = _treinos.length && _treinos[0].nota != null ? Number(_treinos[0].nota).toFixed(1) : null;
  return `
    ${temMeta ? `
    <div class="card mt-3" style="border-left:4px solid ${bateu ? '#16a34a' : '#d97706'}">
      <div class="flex" style="align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:26px">${bateu ? '🏆' : '📅'}</div>
        <div style="min-width:150px">
          <div style="font-weight:800;font-size:13px">Sua semana de estudo</div>
          <div class="tiny muted">${bateu ? 'Meta batida — mantém o ritmo!' : 'Meta semanal da escola PSM'}</div>
        </div>
        ${w.metaA ? metaBar('📘 Aulas', w.aulas, w.metaA, '#2563eb') : ''}
        ${w.metaT ? metaBar('🥊 Treinos', w.treinos, w.metaT, '#7c3aed') : ''}
      </div>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-top:12px">
      <div class="card" style="margin:0;background:linear-gradient(135deg,#7c3aed12,#dc262612);border:1px solid var(--border)">
        <div class="flex" style="align-items:center;gap:12px">
          <div style="font-size:34px">🥊</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800">Sala de Treino</div>
            <div class="tiny muted">A IA vira o cliente e você treina de verdade: objeção, NEPQ, follow-up.${ultimaNota ? ` Última nota: <b>${ultimaNota}</b>` : ''}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="ac-tr0" style="flex-shrink:0">Treinar</button>
        </div>
      </div>
      <div class="card" style="margin:0;background:linear-gradient(135deg,#1e3a8a12,#7c3aed12);border:1px solid var(--border)">
        <div class="flex" style="align-items:center;gap:12px">
          <div style="font-size:34px">👨‍🏫</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800">Professor PSM</div>
            <div class="tiny muted">Tira-dúvidas 24h com base nas trilhas da Academy.</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="ac-prof0" style="flex-shrink:0">💬 Perguntar</button>
        </div>
      </div>
      ${nb ? `
      <div class="card" style="margin:0;background:linear-gradient(135deg,#0f766e12,#16a34a12);border:1px solid var(--border)">
        <div class="flex" style="align-items:center;gap:12px">
          <div style="font-size:34px">🧠</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800">Caderno de Estudos (NotebookLM)</div>
            <div class="tiny muted">${esc(_cfg.notebooklm_desc || 'Converse com os livros, PDFs e podcasts da PSM.')}</div>
          </div>
          <a href="${esc(nb)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="flex-shrink:0">Abrir ↗</a>
        </div>
      </div>` : ''}
    </div>`;
}

/* ─── Rádio PSM: playlists Spotify/YouTube embutidas ─── */
function radioSection() {
  const radios = (_cfg.radio || []).map(r => ({ ...r, info: embedInfo(r.url) }));
  if (!radios.length) {
    return canEdit() ? `<div class="card mt-3"><h3 class="card-title">🎧 Rádio PSM</h3><p class="muted" style="margin:0">Nenhuma playlist configurada. No <b>Construtor → Config da Escola</b>, cole links de playlist do Spotify ou YouTube (podcasts, audiobooks, treinos) e elas tocam aqui dentro.</p></div>` : '';
  }
  return `
    <div class="card mt-3">
      <h3 class="card-title">🎧 Rádio PSM</h3>
      <p class="card-sub">Estude ouvindo: podcasts, audiobooks e aulas em áudio/vídeo — sem sair do House.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:10px">
        ${radios.map(r => `
          <div>
            <div style="font-weight:700;font-size:13px;margin-bottom:2px">${esc(r.titulo || 'Playlist')}</div>
            ${r.desc ? `<div class="tiny muted" style="margin-bottom:6px">${esc(r.desc)}</div>` : '<div style="height:6px"></div>'}
            ${r.info ? embedIframe(r.info, r.titulo) : `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Abrir ↗</a>`}
          </div>`).join('')}
      </div>
    </div>`;
}

function trilhaCard(t) {
  const ni = NIVEL_IDX[t.nivel] ?? (t.pct === 100 ? 4 : 0);
  const cor = t.pct === 100 ? '#d4a843' : (NIVEL_COR[ni] || '#2563eb');
  return `
    <div class="ac-tcard" data-trilha="${esc(t.nome)}">
      <div class="flex" style="justify-content:space-between;align-items:flex-start">
        <div style="font-size:30px">${t.icon}</div>
        ${t.pct === 100 ? `<span class="ac-niv" style="background:#d4a84322;color:#b8860b">🏅 Expert</span>` : `<span class="ac-niv" style="background:${cor}1f;color:${cor}">${esc(t.nivel)}</span>`}
      </div>
      <div style="font-weight:800;font-size:15px;margin-top:8px">${esc(t.nome)}</div>
      <div class="tiny muted" style="margin:2px 0 10px">${t.total} aula(s) · ${t.done} concluída(s)</div>
      <div class="ac-bar"><i style="width:${t.pct}%;background:${t.pct === 100 ? 'linear-gradient(90deg,#d4a843,#e8c263)' : 'linear-gradient(90deg,#2563eb,#3b82f6)'}"></i></div>
      <div class="flex" style="justify-content:space-between;align-items:center;margin-top:8px">
        <span class="tiny" style="font-weight:800;color:${cor}">${t.pct}%</span>
        <span class="btn btn-ghost btn-sm">${t.done ? 'Continuar' : 'Começar'} →</span>
      </div>
    </div>`;
}

/* ─── VIEW: Trilha (detalhe + aulas) ─── */
function renderTrilha() {
  const aulas = _items.filter(i => (i.trilha || 'Geral') === _trilha).sort(byNivelOrdem);
  const done = aulas.filter(a => _done.has(a.id)).length;
  const pct = aulas.length ? Math.round(done / aulas.length * 100) : 0;
  const icon = TRILHA_ICON[_trilha] || '🎓';

  // agrupa por nível → módulo
  const niveis = [...new Set(aulas.map(a => a.nivel || '—'))].sort((a, b) => (NIVEL_IDX[a] ?? 9) - (NIVEL_IDX[b] ?? 9));

  _root.innerHTML = `
    <div class="card">
      ${header()}
    </div>
    <div class="card mt-3">
      <div class="flex" style="align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:40px">${icon}</div>
        <div style="flex:1;min-width:200px">
          <h3 class="card-title" style="margin:0">${esc(_trilha)}</h3>
          <div class="tiny muted">${done}/${aulas.length} aulas · ${pct}% concluído</div>
          <div class="ac-bar" style="margin-top:6px"><i style="width:${pct}%;background:${pct === 100 ? 'linear-gradient(90deg,#d4a843,#e8c263)' : 'linear-gradient(90deg,#2563eb,#3b82f6)'}"></i></div>
        </div>
        ${pct === 100 ? `<button class="btn btn-primary" id="ac-cert">🏅 Emitir certificado</button>` : ''}
      </div>
    </div>
    ${niveis.map(nv => {
      const an = aulas.filter(a => (a.nivel || '—') === nv);
      const dn = an.filter(a => _done.has(a.id)).length;
      const ni = NIVEL_IDX[nv] ?? 0;
      const cor = NIVEL_COR[ni] || '#2563eb';
      const modulos = [...new Set(an.map(a => a.modulo || '—'))];
      return `
        <div class="card mt-3" style="border-left:4px solid ${cor}">
          <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
            <h4 class="card-title" style="margin:0;font-size:14px;color:${cor}">${esc(nv)}</h4>
            <span class="tiny muted">${dn}/${an.length}</span>
          </div>
          ${modulos.map(mod => `
            <div style="margin-top:10px">
              <div style="font-weight:800;font-size:13px;margin-bottom:6px">📦 ${esc(mod)}</div>
              <div style="display:grid;gap:6px">
                ${an.filter(a => (a.modulo || '—') === mod).map(aulaRow).join('')}
              </div>
            </div>`).join('')}
        </div>`;
    }).join('')}
  `;
  bindHeader();
  const c = document.getElementById('ac-cert'); if (c) c.addEventListener('click', () => certificado(_trilha));
  _root.querySelectorAll('[data-done]').forEach(el => el.addEventListener('change', () => toggleDone(el.dataset.done, el.checked)));
  _root.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => viewContent(b.dataset.view)));
  _root.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', () => playAula(b.dataset.play)));
  _root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(_items.find(x => x.id === b.dataset.edit))));
}

/* ─── player embutido da aula (YouTube/Spotify/Drive dentro do House) ─── */
function playAula(id) {
  const a = _items.find(x => x.id === id); if (!a) return;
  const info = embedInfo(a.url);
  if (!info) { window.open(a.url, '_blank', 'noopener'); return; }
  const modal = document.getElementById('ac-modal') || mkModal();
  const isDone = _done.has(a.id);
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.72);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:840px;width:100%;background:var(--bg-1);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center;gap:8px">
          <h3 class="card-title" style="margin:0;min-width:0">${TIPO_IC[a.tipo] || '📘'} ${esc(a.titulo)}</h3>
          <button class="btn btn-ghost btn-sm" id="ac-px" style="flex-shrink:0">✕</button>
        </div>
        <div style="margin-top:12px">${embedIframe(info, a.titulo)}</div>
        ${(a.conteudo && a.conteudo.trim()) ? `<div style="white-space:pre-wrap;line-height:1.6;font-size:13.5px;background:var(--bg-3);border-radius:10px;padding:12px 14px;margin-top:12px">${esc(a.conteudo)}</div>` : ''}
        <div class="flex gap-2 mt-3" style="justify-content:space-between;flex-wrap:wrap">
          <a href="${esc(a.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Abrir no app ↗</a>
          <button class="btn ${isDone ? 'btn-ghost' : 'btn-primary'} btn-sm" id="ac-pdone">${isDone ? '↩ Desmarcar concluída' : '✅ Marcar aula concluída'}</button>
        </div>
      </div>
    </div>`;
  document.getElementById('ac-px').addEventListener('click', () => { modal.innerHTML = ''; });
  document.getElementById('ac-pdone').addEventListener('click', () => { modal.innerHTML = ''; toggleDone(a.id, !isDone); });
}

function aulaRow(a) {
  const isDone = _done.has(a.id);
  const ic = TIPO_IC[a.tipo] || '📘';
  return `
    <div style="display:flex;gap:10px;align-items:center;background:var(--bg-3);border-radius:8px;padding:9px 11px">
      <input type="checkbox" data-done="${esc(a.id)}" ${isDone ? 'checked' : ''} style="width:18px;height:18px;flex-shrink:0;cursor:pointer" title="Marcar concluída" />
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;${isDone ? 'opacity:.6;text-decoration:line-through' : ''}">${ic} ${esc(a.titulo)}</div>
        ${a.duracao ? `<div class="tiny muted">⏱ ${esc(a.duracao)}</div>` : ''}
        ${a.missao ? `<div class="tiny" style="margin-top:3px;color:#7c3aed"><b>🎯 Missão de campo:</b> ${esc(a.missao)}</div>` : ''}
      </div>
      ${a.url ? (embedInfo(a.url)
        ? `<button class="btn btn-primary btn-sm" data-play="${esc(a.id)}" style="flex-shrink:0">▶ Assistir</button>`
        : `<a href="${esc(a.url)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="flex-shrink:0">▶ Abrir</a>`) : ''}
      ${(a.conteudo && a.conteudo.trim()) ? `<button class="btn btn-ghost btn-sm" data-view="${esc(a.id)}" style="flex-shrink:0">📖 Ler</button>` : ''}
      ${(!a.url && !(a.conteudo && a.conteudo.trim())) ? `<span class="tiny muted" style="flex-shrink:0">${canEdit() ? '<button class="btn btn-ghost btn-sm" data-edit="' + esc(a.id) + '">➕ conteúdo</button>' : 'em breve'}</span>` : ''}
    </div>`;
}

/* ─── certificado ─── */
function certificado(trilha) {
  const u = auth.user() || {};
  const modal = document.getElementById('ac-modal') || mkModal();
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.6);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div style="max-width:720px;width:100%;margin:auto">
        <div id="cert-paper" style="background:linear-gradient(135deg,#0b1f3a,#1e293b);border:3px solid #d4a843;border-radius:16px;padding:40px;text-align:center;color:#fff">
          <div style="font-size:40px">🏛️</div>
          <div style="letter-spacing:3px;font-size:12px;color:#d4a843;font-weight:800;margin-top:6px">PSM ACADEMY · CERTIFICADO</div>
          <div style="font-size:14px;color:#cbd5e1;margin-top:22px">Certificamos que</div>
          <div style="font-size:26px;font-weight:900;margin:6px 0">${esc(u.name || 'Aluno PSM')}</div>
          <div style="font-size:14px;color:#cbd5e1">concluiu integralmente a trilha</div>
          <div style="font-size:20px;font-weight:800;color:#d4a843;margin:6px 0">${TRILHA_ICON[trilha] || '🎓'} ${esc(trilha)}</div>
          <div style="font-size:13px;color:#cbd5e1;margin-top:14px">alcançando o nível <b style="color:#fff">EXPERT</b> · ${esc(hoje)}</div>
          <div style="margin-top:26px;display:flex;justify-content:space-around;font-size:11px;color:#94a3b8">
            <div>______________________<br>PSM Conquista & PSM Imóveis</div>
          </div>
        </div>
        <div class="flex gap-2 mt-3" style="justify-content:center">
          <button class="btn btn-ghost" id="cert-x">Fechar</button>
          <button class="btn btn-primary" id="cert-print">🖨 Imprimir / PDF</button>
        </div>
      </div>
    </div>`;
  document.getElementById('cert-x').addEventListener('click', () => { modal.innerHTML = ''; });
  document.getElementById('cert-print').addEventListener('click', () => window.print());
}

/* ─── conteúdo inline ─── */
function viewContent(id) {
  const i = _items.find(x => x.id === id); if (!i) return;
  const modal = document.getElementById('ac-modal') || mkModal();
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:680px;width:100%;background:var(--bg-1);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${TIPO_IC[i.tipo] || '📘'} ${esc(i.titulo)}</h3>
          <button class="btn btn-ghost btn-sm" id="ac-vx">✕</button>
        </div>
        <div style="white-space:pre-wrap;line-height:1.6;font-size:14px;background:var(--bg-3);border-radius:10px;padding:14px 16px;margin-top:10px">${esc(i.conteudo || '')}</div>
        ${i.url ? `<div style="margin-top:12px"><a href="${esc(i.url)}" target="_blank" rel="noopener" class="btn btn-primary">▶ Abrir material</a></div>` : ''}
      </div>
    </div>`;
  document.getElementById('ac-vx').addEventListener('click', () => { modal.innerHTML = ''; });
}

/* ─── toggle conclusão ─── */
async function toggleDone(id, done) {
  if (done) _done.add(id); else _done.delete(id);
  // atualiza só o necessário sem re-render pesado
  if (_view === 'trilha') renderTrilha();
  try {
    const r = await api.request('/api/v3/diretoria/academy_progress', { method: 'POST', body: { item_id: id, done } });
    if (r && r.ok === false && r.pending) alert(r.error || 'Rode o SQL da Academy pra salvar progresso.');
  } catch (e) {
    // reverte o otimismo — sem isso o check some sozinho no reload e parece bug
    if (done) _done.delete(id); else _done.add(id);
    if (_view === 'trilha') renderTrilha();
    alert('❌ NÃO SALVOU seu progresso: ' + e.message + '\nMarque de novo.');
  }
}

/* ═══════════ VIEW: Professor PSM (tira-dúvidas IA) ═══════════ */
const PROF_SUGESTOES = [
  'Como funciona o financiamento pela Caixa no MCMV?',
  'O que falar na primeira ligação pra um lead?',
  'Quais documentos o comprador precisa ter?',
  'Como contornar a objeção "tá caro"?',
  'O que é matrícula do imóvel e por que importa?',
];

function renderProfessor() {
  _root.innerHTML = `
    <style>
      .prof-msg{max-width:82%;border-radius:14px;padding:10px 14px;font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
      .prof-user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:4px}
      .prof-ia{align-self:flex-start;background:var(--bg-3);border-bottom-left-radius:4px}
      .prof-chip{border:1px solid var(--border);background:var(--bg-1,#fff);border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer}
      .prof-chip:hover{border-color:#2563eb;color:#2563eb}
    </style>
    <div class="card">
      ${header()}
    </div>
    <div class="card mt-3" style="display:flex;flex-direction:column;min-height:60vh">
      <div class="flex" style="align-items:center;gap:10px;border-bottom:1px solid var(--border);padding-bottom:10px">
        <div style="font-size:30px">👨‍🏫</div>
        <div>
          <div style="font-weight:800">Professor PSM</div>
          <div class="tiny muted">Tutor da Academy — responde com base nas trilhas e no material da PSM</div>
        </div>
      </div>
      <div id="prof-log" style="flex:1;display:flex;flex-direction:column;gap:10px;padding:14px 2px;overflow-y:auto">
        ${_chat.length ? _chat.map(m => `<div class="prof-msg ${m.role === 'user' ? 'prof-user' : 'prof-ia'}">${esc(m.content)}</div>`).join('') : `
          <div style="text-align:center;padding:22px 10px">
            <div style="font-size:38px">🎓</div>
            <div style="font-weight:700;margin-top:6px">Pode perguntar, a aula é sua.</div>
            <div class="tiny muted" style="margin:4px 0 14px">Dúvida de financiamento, documentação, venda, objeção, lei… o Professor responde e indica a trilha pra aprofundar.</div>
            <div class="flex gap-2" style="justify-content:center;flex-wrap:wrap">
              ${PROF_SUGESTOES.map(s => `<button class="prof-chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}
            </div>
          </div>`}
        ${_chatBusy ? `<div class="prof-msg prof-ia"><span class="spinner"></span> pensando…</div>` : ''}
      </div>
      <div class="flex gap-2" style="border-top:1px solid var(--border);padding-top:10px">
        <input id="prof-in" class="input" placeholder="Escreva sua dúvida…" style="flex:1" ${_chatBusy ? 'disabled' : ''} />
        <button class="btn btn-primary" id="prof-send" ${_chatBusy ? 'disabled' : ''}>Enviar</button>
        ${_chat.length ? `<button class="btn btn-ghost" id="prof-clear" title="Limpar conversa">🗑</button>` : ''}
      </div>
    </div>`;
  bindHeader();
  const log = document.getElementById('prof-log'); if (log) log.scrollTop = log.scrollHeight;
  const inp = document.getElementById('prof-in');
  const send = () => { const t = (inp.value || '').trim(); if (t) askProfessor(t); };
  const sb = document.getElementById('prof-send'); if (sb) sb.addEventListener('click', send);
  if (inp) { inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }); if (!_chatBusy) inp.focus(); }
  const cl = document.getElementById('prof-clear'); if (cl) cl.addEventListener('click', () => { _chat = []; renderProfessor(); });
  _root.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => askProfessor(b.dataset.sug)));
}

async function askProfessor(texto) {
  if (_chatBusy) return;
  _chat.push({ role: 'user', content: texto });
  _chatBusy = true;
  renderProfessor();
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: { agent: 'professor', messages: _chat.slice(-20) } });
    _chat.push({ role: 'assistant', content: (r && r.reply) || 'Não consegui responder agora — tenta de novo em instantes.' });
  } catch (e) {
    _chat.push({ role: 'assistant', content: '❌ Erro ao falar com o Professor: ' + e.message });
  }
  _chatBusy = false;
  if (_view === 'professor') renderProfessor();
}

/* ═══════════ VIEW: Sala de Treino (role-play com IA) ═══════════ */
function renderTreino() {
  const cen = _trCen ? TREINOS.find(t => t.id === _trCen) : null;
  _root.innerHTML = `
    <style>
      .tr-msg{max-width:82%;border-radius:14px;padding:10px 14px;font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
      .tr-corretor{align-self:flex-end;background:#7c3aed;color:#fff;border-bottom-right-radius:4px}
      .tr-cliente{align-self:flex-start;background:var(--bg-3);border-bottom-left-radius:4px}
      .tr-card{background:var(--bg-1,#fff);border:1px solid var(--border);border-radius:14px;padding:16px;cursor:pointer;transition:transform .12s,box-shadow .12s}
      .tr-card:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(15,23,42,.12)}
      .ac-bar{height:8px;border-radius:5px;background:var(--bg-3,#e2e8f0);overflow:hidden}
      .ac-bar>i{display:block;height:100%;border-radius:5px;transition:width .5s}
    </style>
    <div class="card">${header()}</div>
    ${!cen ? trPicker() : (_trAval ? trAvaliacao(cen) : trRing(cen))}`;
  bindHeader();
  bindTreino(cen);
}

function trPicker() {
  const hist = _treinos.slice(0, 8);
  return `
    <div class="card mt-3">
      <h3 class="card-title">🥊 Sala de Treino</h3>
      <p class="card-sub">Escolha o cliente. A IA interpreta de verdade — sem colinha, sem elogio fácil. No fim você recebe nota e correção.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:10px">
        ${TREINOS.map(t => `
          <div class="tr-card" data-cen="${t.id}">
            <div style="font-size:30px">${t.ico}</div>
            <div style="font-weight:800;margin-top:6px">${esc(t.nome)}</div>
            <div class="tiny muted" style="margin-top:3px">${esc(t.desc)}</div>
            <div style="margin-top:10px"><span class="btn btn-primary btn-sm">Entrar no ringue →</span></div>
          </div>`).join('')}
      </div>
    </div>
    ${hist.length ? `
    <div class="card mt-3">
      <h4 class="card-title" style="font-size:14px">📈 Seus últimos treinos</h4>
      <div style="display:grid;gap:6px;margin-top:8px">
        ${hist.map(h => {
          const t = TREINOS.find(x => x.id === h.cenario);
          const n = h.nota != null ? Number(h.nota) : null;
          const cor = n == null ? '#64748b' : n >= 8 ? '#16a34a' : n >= 6 ? '#d97706' : '#dc2626';
          return `<div style="display:flex;gap:10px;align-items:center;background:var(--bg-3);border-radius:8px;padding:8px 12px">
            <span>${t ? t.ico : '🥊'}</span>
            <span style="flex:1;font-size:13px">${esc(t ? t.nome : h.cenario)}</span>
            <span class="tiny muted">${h.created_at ? new Date(h.created_at).toLocaleDateString('pt-BR') : ''}</span>
            <b style="color:${cor};font-size:15px">${n != null ? n.toFixed(1) : '—'}</b>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}`;
}

function trRing(cen) {
  const podeEncerrar = _trChat.filter(m => m.role === 'user').length >= 3;
  return `
    <div class="card mt-3" style="display:flex;flex-direction:column;min-height:60vh">
      <div class="flex" style="align-items:center;gap:10px;border-bottom:1px solid var(--border);padding-bottom:10px;flex-wrap:wrap">
        <div style="font-size:28px">${cen.ico}</div>
        <div style="flex:1;min-width:180px">
          <div style="font-weight:800">${esc(cen.nome)}</div>
          <div class="tiny muted">${esc(cen.desc)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="tr-quit">✕ Abandonar</button>
        <button class="btn btn-primary btn-sm" id="tr-fim" ${podeEncerrar && !_trBusy ? '' : 'disabled'} title="${podeEncerrar ? 'Receber nota e correção' : 'Troque pelo menos 3 mensagens antes de encerrar'}">🏁 Encerrar e receber nota</button>
      </div>
      <div id="tr-log" style="flex:1;display:flex;flex-direction:column;gap:10px;padding:14px 2px;overflow-y:auto">
        ${_trChat.length ? _trChat.map(m => `<div class="tr-msg ${m.role === 'user' ? 'tr-corretor' : 'tr-cliente'}">${esc(m.content)}</div>`).join('') : `
          <div style="text-align:center;padding:20px 10px">
            <div style="font-size:36px">💬</div>
            <div style="font-weight:700;margin-top:6px">Você abre a conversa.</div>
            <div class="tiny muted">Mande a primeira mensagem como se fosse o WhatsApp de verdade — o cliente responde no personagem.</div>
          </div>`}
        ${_trBusy ? `<div class="tr-msg tr-cliente"><span class="spinner"></span> digitando…</div>` : ''}
      </div>
      <div class="flex gap-2" style="border-top:1px solid var(--border);padding-top:10px">
        <input id="tr-in" class="input" placeholder="Sua mensagem pro cliente…" style="flex:1" ${_trBusy ? 'disabled' : ''} />
        <button class="btn btn-primary" id="tr-send" ${_trBusy ? 'disabled' : ''}>Enviar</button>
      </div>
    </div>`;
}

function trAvaliacao(cen) {
  const a = _trAval || {};
  const n = a.nota != null ? Number(a.nota) : null;
  const cor = n == null ? '#64748b' : n >= 8 ? '#16a34a' : n >= 6 ? '#d97706' : '#dc2626';
  return `
    <div class="card mt-3" style="text-align:center;padding:26px 20px">
      <div style="font-size:40px">${n != null && n >= 8 ? '🏆' : n != null && n >= 6 ? '💪' : '🥊'}</div>
      <div class="tiny muted" style="letter-spacing:2px;font-weight:800;margin-top:4px">TREINO CONCLUÍDO · ${esc(cen.nome).toUpperCase()}</div>
      <div style="font-size:52px;font-weight:900;color:${cor};margin:6px 0">${n != null ? n.toFixed(1) : '—'}</div>
      ${a.resumo ? `<div style="max-width:520px;margin:0 auto;font-size:14px">${esc(a.resumo)}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:18px;text-align:left">
        ${(a.fortes || []).length ? `<div style="background:#16a34a14;border-radius:12px;padding:14px"><div style="font-weight:800;color:#16a34a;font-size:13px">✅ O que você mandou bem</div><ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.6">${a.fortes.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
        ${(a.melhorar || []).length ? `<div style="background:#d9770614;border-radius:12px;padding:14px"><div style="font-weight:800;color:#d97706;font-size:13px">🎯 O que treinar</div><ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.6">${a.melhorar.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
      </div>
      ${a.trilha ? `<div style="margin-top:16px"><span class="tiny muted">Receita do avaliador:</span> <button class="btn btn-ghost btn-sm" id="tr-trilha">📚 Estudar a trilha ${esc(a.trilha)} →</button></div>` : ''}
      ${a.raw ? `<div style="white-space:pre-wrap;text-align:left;background:var(--bg-3);border-radius:10px;padding:12px 14px;margin-top:14px;font-size:13px">${esc(a.raw)}</div>` : ''}
      <div class="flex gap-2 mt-3" style="justify-content:center">
        <button class="btn btn-primary" id="tr-again">🔁 Treinar de novo</button>
        <button class="btn btn-ghost" id="tr-outro">🥊 Outro cenário</button>
      </div>
    </div>`;
}

function bindTreino(cen) {
  _root.querySelectorAll('[data-cen]').forEach(el => el.addEventListener('click', () => {
    _trCen = el.dataset.cen; _trChat = []; _trAval = null; render();
  }));
  const quit = document.getElementById('tr-quit'); if (quit) quit.addEventListener('click', () => { _trCen = null; _trChat = []; _trAval = null; render(); });
  const inp = document.getElementById('tr-in');
  const send = () => { const t = (inp.value || '').trim(); if (t) askTreino(t); };
  const sb = document.getElementById('tr-send'); if (sb) sb.addEventListener('click', send);
  if (inp) { inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }); if (!_trBusy) inp.focus(); }
  const log = document.getElementById('tr-log'); if (log) log.scrollTop = log.scrollHeight;
  const fim = document.getElementById('tr-fim'); if (fim) fim.addEventListener('click', encerrarTreino);
  const again = document.getElementById('tr-again'); if (again) again.addEventListener('click', () => { _trChat = []; _trAval = null; render(); });
  const outro = document.getElementById('tr-outro'); if (outro) outro.addEventListener('click', () => { _trCen = null; _trChat = []; _trAval = null; render(); });
  const goTrilha = document.getElementById('tr-trilha'); if (goTrilha) goTrilha.addEventListener('click', () => {
    const nome = (_trAval && _trAval.trilha) || '';
    const match = TRILHA_ORDER.find(t => t.toLowerCase().includes(nome.toLowerCase())) || TRILHA_ORDER.find(t => nome.toLowerCase().includes(t.toLowerCase()));
    if (match) { _trilha = match; _view = 'trilha'; render(); } else { _view = 'journey'; render(); }
  });
}

async function askTreino(texto) {
  if (_trBusy) return;
  _trChat.push({ role: 'user', content: texto });
  _trBusy = true;
  render();
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: { agent: 'sala_treino', cenario: _trCen, messages: _trChat.slice(-24) } });
    _trChat.push({ role: 'assistant', content: (r && r.reply) || '…' });
  } catch (e) {
    _trChat.push({ role: 'assistant', content: '❌ O cliente caiu da linha (' + e.message + '). Manda de novo.' });
  }
  _trBusy = false;
  if (_view === 'treino') render();
}

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) { /* segue */ }
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* segue */ } }
  return null;
}

async function encerrarTreino() {
  if (_trBusy) return;
  _trBusy = true;
  render();
  const transcript = _trChat.map(m => (m.role === 'user' ? 'CORRETOR: ' : 'CLIENTE: ') + m.content).join('\n');
  let aval = null;
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: 'treino_nota', cenario: _trCen,
      messages: [{ role: 'user', content: 'Avalie o desempenho do CORRETOR nesta transcrição:\n\n' + transcript }],
    } });
    const j = extractJson(r && r.reply);
    aval = j && j.nota != null ? j : { raw: (r && r.reply) || 'Sem avaliação.' };
  } catch (e) {
    aval = { raw: '❌ Erro ao avaliar: ' + e.message };
  }
  _trAval = aval;
  _trBusy = false;
  // salva no histórico (não bloqueia a tela)
  const cen = _trCen;
  const fb = JSON.stringify({ resumo: aval.resumo, fortes: aval.fortes, melhorar: aval.melhorar, trilha: aval.trilha, raw: aval.raw }).slice(0, 7900);
  api.request('/api/v3/diretoria/academy_treino', { method: 'POST', body: {
    cenario: cen, nota: aval.nota, feedback: fb, msgs: _trChat.length,
  } }).then(() => api.request('/api/v3/diretoria/academy_treino').then(t => { _treinos = (t && t.treinos) || _treinos; })).catch(() => {});
  if (_view === 'treino') render();
}

/* ═══════════ MODO CONSTRUTOR (gestão) ═══════════ */
function renderBuilder() {
  const trilhas = trilhasList();
  _root.innerHTML = `
    <div class="card">
      ${header()}
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        <button class="btn btn-primary" id="ac-install">📚 Instalar / atualizar currículo PSM</button>
        <button class="btn btn-ghost" id="ac-newaula">➕ Nova aula</button>
      </div>
      <div class="tiny muted" style="margin-top:8px">"Instalar currículo" cria as ${curriculumItems().length} aulas da ementa das 11 trilhas (idempotente — não duplica). Depois é só plugar o link/vídeo em cada aula.</div>
      <div id="ac-install-out" class="tiny" style="margin-top:6px"></div>
    </div>

    <div class="card mt-3">
      <h3 class="card-title">⚙️ Config da Escola</h3>
      <p class="card-sub">Rádio PSM (playlists embutidas), Caderno NotebookLM e a base de conhecimento do Professor PSM.</p>

      <div style="margin-top:10px">
        <label class="tiny muted" style="font-weight:700">🧠 Link do NotebookLM (Caderno de Estudos)</label>
        <input id="cfg-nb" class="input" value="${esc(_cfg.notebooklm_url || '')}" placeholder="https://notebooklm.google.com/notebook/…" style="width:100%" />
        <input id="cfg-nbd" class="input" value="${esc(_cfg.notebooklm_desc || '')}" placeholder="Descrição do card (opcional)" style="width:100%;margin-top:6px" />
        <div class="tiny muted" style="margin-top:4px">Compartilhe o notebook com os e-mails dos corretores no próprio NotebookLM — o card abre em nova aba.</div>
      </div>

      <div style="margin-top:14px">
        <label class="tiny muted" style="font-weight:700">🎧 Rádio PSM — playlists (Spotify ou YouTube)</label>
        <div id="cfg-radio-list" style="display:grid;gap:6px;margin-top:6px">
          ${(_cfg.radio || []).map((r, i) => cfgRadioRow(r, i)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="cfg-radio-add" style="margin-top:6px">➕ Adicionar playlist</button>
        <div class="tiny muted" style="margin-top:4px">Cole o link normal (ex.: open.spotify.com/playlist/… ou youtube.com/playlist?list=…) — o player embutido aparece na jornada de todos.</div>
      </div>

      <div style="margin-top:14px">
        <label class="tiny muted" style="font-weight:700">📅 Meta de estudo semanal (0 = desligada)</label>
        <div class="flex gap-2" style="margin-top:6px;flex-wrap:wrap">
          <div><span class="tiny muted">📘 Aulas/semana</span><br><input id="cfg-meta-a" class="input" type="number" min="0" max="50" value="${esc(_cfg.meta_aulas_semana ?? 2)}" style="width:110px" /></div>
          <div><span class="tiny muted">🥊 Treinos/semana</span><br><input id="cfg-meta-t" class="input" type="number" min="0" max="50" value="${esc(_cfg.meta_treinos_semana ?? 1)}" style="width:110px" /></div>
        </div>
        <div class="tiny muted" style="margin-top:4px">Aparece como barra de progresso na jornada de cada corretor (semana começa na segunda).</div>
      </div>

      <div style="margin-top:14px">
        <label class="tiny muted" style="font-weight:700">👨‍🏫 Base de conhecimento do Professor PSM (opcional)</label>
        <textarea id="cfg-tutor" class="input" rows="5" placeholder="Cole aqui resumos, apostilas, regras da PSM, FAQ… O Professor usa esse texto como fonte primária nas respostas." style="width:100%">${esc(_cfg.tutor_extra || '')}</textarea>
      </div>

      <div class="flex gap-2 mt-3" style="justify-content:flex-end;align-items:center">
        <span id="cfg-out" class="tiny"></span>
        <button class="btn btn-primary" id="cfg-save">💾 Salvar Config da Escola</button>
      </div>
    </div>
    ${trilhas.length ? trilhas.map(t => `
      <div class="card mt-3">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h4 class="card-title" style="margin:0;font-size:14px">${t.icon} ${esc(t.nome)} <span class="tiny muted">· ${t.total} aulas</span></h4>
        </div>
        <div style="display:grid;gap:5px;margin-top:8px">
          ${t.aulas.sort(byNivelOrdem).map(a => `
            <div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:7px;padding:7px 10px">
              <span class="tiny" style="flex-shrink:0;color:${NIVEL_COR[NIVEL_IDX[a.nivel] ?? 0] || '#64748b'};font-weight:800;width:90px">${esc(a.nivel || '—')}</span>
              <span style="flex:1;min-width:0;font-size:12.5px">${esc(a.titulo)} ${a.url || (a.conteudo && a.conteudo.trim()) ? '<span title="tem conteúdo">🟢</span>' : '<span title="sem conteúdo" style="opacity:.5">⚪</span>'}</span>
              <button class="btn btn-ghost btn-sm" data-edit="${esc(a.id)}" style="padding:1px 7px">✏️</button>
              <button class="btn btn-ghost btn-sm" data-del="${esc(a.id)}" style="padding:1px 7px">🗑</button>
            </div>`).join('')}
        </div>
      </div>`).join('') : `<div class="card mt-3"><p class="muted" style="margin:0">Nenhuma aula ainda. Clique em "Instalar currículo PSM" pra criar a faculdade completa.</p></div>`}
    <div id="ac-modal"></div>
  `;
  bindHeader();
  document.getElementById('ac-install').addEventListener('click', installCurriculo);
  document.getElementById('ac-newaula').addEventListener('click', () => openForm(null));
  _root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(_items.find(x => x.id === b.dataset.edit))));
  _root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delAula(b.dataset.del)));
  bindCfg();
}

/* ─── Config da Escola (builder) ─── */
function cfgRadioRow(r, i) {
  return `
    <div style="display:grid;grid-template-columns:170px 1fr 1fr 32px;gap:6px" data-radio-row="${i}">
      <input class="input cfg-r-tit" value="${esc(r.titulo || '')}" placeholder="Título" />
      <input class="input cfg-r-url" value="${esc(r.url || '')}" placeholder="https://open.spotify.com/… ou youtube.com/…" />
      <input class="input cfg-r-desc" value="${esc(r.desc || '')}" placeholder="Descrição (opcional)" />
      <button class="btn btn-ghost btn-sm cfg-r-del" title="Remover">🗑</button>
    </div>`;
}

function bindCfg() {
  const list = document.getElementById('cfg-radio-list'); if (!list) return;
  const add = document.getElementById('cfg-radio-add');
  if (add) add.addEventListener('click', () => {
    const div = document.createElement('div');
    div.innerHTML = cfgRadioRow({ titulo: '', url: '', desc: '' }, list.children.length);
    list.appendChild(div.firstElementChild);
    bindCfgDel();
  });
  bindCfgDel();
  const save = document.getElementById('cfg-save');
  if (save) save.addEventListener('click', async () => {
    const out = document.getElementById('cfg-out');
    const radio = [...list.querySelectorAll('[data-radio-row]')].map(row => ({
      titulo: row.querySelector('.cfg-r-tit').value.trim(),
      url: row.querySelector('.cfg-r-url').value.trim(),
      desc: row.querySelector('.cfg-r-desc').value.trim(),
    })).filter(r => r.url);
    const bad = radio.find(r => !embedInfo(r.url) && !/^https?:\/\//.test(r.url));
    if (bad) { out.innerHTML = `<span style="color:var(--err)">Link inválido: ${esc(bad.url)}</span>`; return; }
    const cfg = {
      radio,
      notebooklm_url: document.getElementById('cfg-nb').value.trim(),
      notebooklm_desc: document.getElementById('cfg-nbd').value.trim(),
      tutor_extra: document.getElementById('cfg-tutor').value.trim(),
      meta_aulas_semana: parseInt(document.getElementById('cfg-meta-a').value || '0', 10) || 0,
      meta_treinos_semana: parseInt(document.getElementById('cfg-meta-t').value || '0', 10) || 0,
    };
    save.disabled = true; save.textContent = 'Salvando…';
    try {
      const r = await api.request('/api/v3/diretoria/academy_config', { method: 'POST', body: { config: cfg } });
      if (r && r.ok) { _cfg = Object.assign(_cfg, r.config || cfg); out.innerHTML = '<span style="color:var(--ok)">✓ Salvo</span>'; }
      else out.innerHTML = `<span style="color:var(--err)">${esc((r && r.error) || 'Falha ao salvar')}</span>`;
    } catch (e) { out.innerHTML = `<span style="color:var(--err)">${esc(e.message)}</span>`; }
    save.disabled = false; save.textContent = '💾 Salvar Config da Escola';
  });
}
function bindCfgDel() {
  document.querySelectorAll('#cfg-radio-list .cfg-r-del').forEach(b => {
    if (b._bound) return; b._bound = true;
    b.addEventListener('click', () => b.closest('[data-radio-row]').remove());
  });
}

async function installCurriculo() {
  const out = document.getElementById('ac-install-out');
  const btn = document.getElementById('ac-install') || document.getElementById('ac-install0');
  if (btn) { btn.disabled = true; btn.textContent = 'Instalando…'; }
  try {
    const items = curriculumItems();
    const r = await api.request('/api/v3/diretoria/academy', { method: 'POST', body: { action: 'bulk', items } });
    if (r && r.ok) {
      if (out) out.innerHTML = `<span style="color:var(--ok)">✓ ${r.count} aulas instaladas.</span>`;
      await load();
      _view = 'builder'; render();
    } else {
      if (out) out.textContent = (r && r.error) || 'Falha ao instalar.';
      if (btn) { btn.disabled = false; btn.textContent = '📚 Instalar / atualizar currículo PSM'; }
    }
  } catch (e) {
    if (out) out.textContent = 'Erro: ' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = '📚 Instalar / atualizar currículo PSM'; }
  }
}

function openForm(item) {
  const c = item || {};
  const modal = document.getElementById('ac-modal') || mkModal();
  const trilhasSug = TRILHA_ORDER;
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:600px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${c.id ? '✏️ Editar' : '➕ Nova'} aula</h3>
          <button class="btn btn-ghost btn-sm" id="af-x">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">Título da aula</label>
            <input id="af-titulo" class="input" value="${esc(c.titulo || '')}" style="width:100%" /></div>
          <div><label class="tiny muted" style="font-weight:700">Trilha</label>
            <input id="af-trilha" class="input" list="af-tr-dl" value="${esc(c.trilha || '')}" style="width:100%" />
            <datalist id="af-tr-dl">${trilhasSug.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
          <div><label class="tiny muted" style="font-weight:700">Nível</label>
            <select id="af-nivel" class="input" style="width:100%">${['', ...NIVEIS].map(n => `<option value="${esc(n)}"${(c.nivel || '') === n ? ' selected' : ''}>${n || '—'}</option>`).join('')}</select></div>
          <div><label class="tiny muted" style="font-weight:700">Módulo</label>
            <input id="af-modulo" class="input" value="${esc(c.modulo || '')}" style="width:100%" /></div>
          <div><label class="tiny muted" style="font-weight:700">Tipo</label>
            <select id="af-tipo" class="input" style="width:100%">${Object.keys(TIPO_IC).map(t => `<option value="${t}"${(c.tipo || 'aula') === t ? ' selected' : ''}>${TIPO_IC[t]} ${t}</option>`).join('')}</select></div>
          <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">Link (Drive / YouTube / URL)</label>
            <input id="af-url" class="input" value="${esc(c.url || '')}" placeholder="https://…" style="width:100%" /></div>
          <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">Conteúdo inline (opcional)</label>
            <textarea id="af-conteudo" class="input" rows="4" style="width:100%">${esc(c.conteudo || '')}</textarea></div>
          <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">🎯 Missão de campo (opcional)</label>
            <input id="af-missao" class="input" value="${esc(c.missao || '')}" placeholder="Ex.: Faça 5 ligações usando o script desta aula e registre no painel" style="width:100%" />
            <div class="tiny muted" style="margin-top:3px">Padrão de aula de alto nível: vídeo de 5–12 min + resumo + missão de campo.</div></div>
          <div><label class="tiny muted" style="font-weight:700">Duração</label>
            <input id="af-duracao" class="input" value="${esc(c.duracao || '')}" placeholder="12 min" style="width:100%" /></div>
          <div><label class="tiny muted" style="font-weight:700">Ordem</label>
            <input id="af-ordem" class="input" type="number" value="${esc(c.ordem ?? 0)}" style="width:100%" /></div>
        </div>
        <div id="af-err" class="tiny" style="color:var(--err);margin-top:8px"></div>
        <div class="flex gap-2 mt-3" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="af-cancel">Cancelar</button>
          <button class="btn btn-primary" id="af-save">${c.id ? 'Salvar' : 'Adicionar'}</button>
        </div>
      </div>
    </div>`;
  const close = () => { modal.innerHTML = ''; };
  document.getElementById('af-x').addEventListener('click', close);
  document.getElementById('af-cancel').addEventListener('click', close);
  document.getElementById('af-save').addEventListener('click', () => saveAula(c));
}

async function saveAula(c) {
  const g = id => document.getElementById(id);
  const titulo = g('af-titulo').value.trim();
  if (!titulo) { g('af-err').textContent = 'Título obrigatório.'; return; }
  const payload = {
    id: c.id || undefined, titulo,
    trilha: g('af-trilha').value.trim() || 'Geral',
    nivel: g('af-nivel').value, modulo: g('af-modulo').value.trim(),
    tipo: g('af-tipo').value, url: g('af-url').value.trim(),
    conteudo: g('af-conteudo').value.trim(), duracao: g('af-duracao').value.trim(),
    missao: g('af-missao').value.trim(),
    ordem: parseInt(g('af-ordem').value || '0', 10) || 0,
  };
  const btn = g('af-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const r = await api.request('/api/v3/diretoria/academy', { method: 'POST', body: payload });
    if (r && r.ok === false && r.pending) { g('af-err').textContent = r.error; btn.disabled = false; btn.textContent = 'Salvar'; return; }
    const modal = document.getElementById('ac-modal'); if (modal) modal.innerHTML = '';
    await load();
    render();
  } catch (e) { g('af-err').textContent = e.message; btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function delAula(id) {
  const i = _items.find(x => x.id === id);
  if (!confirm(`Excluir a aula "${(i && i.titulo) || ''}"?`)) return;
  try { await api.request('/api/v3/diretoria/academy?id=' + encodeURIComponent(id), { method: 'DELETE' }); await load(); render(); }
  catch (e) { alert('Erro: ' + e.message); }
}

/* ─── helpers ─── */
function mkModal() { const d = document.createElement('div'); d.id = 'ac-modal'; _root.appendChild(d); return d; }
function kpi(label, n, color) {
  return `<div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:var(--r-md);padding:12px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">${label}</div>
    <div style="font-size:26px;font-weight:900;color:${color}">${n}</div></div>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
