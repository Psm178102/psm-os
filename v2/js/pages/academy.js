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
let _view = 'journey';    // journey | trilha | builder
let _trilha = null;       // trilha selecionada (detalhe)

export const NIVEIS = ['Fundamentos', 'Iniciante', 'Intermediário', 'Avançado', 'Expert'];
const NIVEL_IDX = Object.fromEntries(NIVEIS.map((n, i) => [n, i]));
const NIVEL_COR = ['#16a34a', '#2563eb', '#7c3aed', '#d97706', '#dc2626'];
const TIPO_IC = { aula: '📘', video: '🎥', curso: '🎓', playbook: '📗', script: '📝', doc: '📄', link: '🔗' };
const canEdit = () => (auth.user()?.lvl || 0) >= 7;

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
  const [r, p] = await Promise.all([
    api.request('/api/v3/diretoria/academy').catch(() => ({ items: [] })),
    api.request('/api/v3/diretoria/academy_progress').catch(() => ({ completed: [] })),
  ]);
  _items = r.items || [];
  _pendItems = !!r.pending;
  _done = new Set(p.completed || []);
  _pendProg = !!p.pending;
  render();
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
        ${canEdit() ? `<button class="btn ${_view === 'builder' ? 'btn-primary' : 'btn-ghost'}" id="ac-builder">🛠 Construtor</button>` : ''}
      </div>
    </div>
    ${extra || ''}`;
}

function bindHeader() {
  const h = document.getElementById('ac-home'); if (h) h.addEventListener('click', () => { _view = 'journey'; _trilha = null; render(); });
  const b = document.getElementById('ac-builder'); if (b) b.addEventListener('click', () => { _view = _view === 'builder' ? 'journey' : 'builder'; render(); });
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
  `;
  bindHeader();
  const i0 = document.getElementById('ac-install0'); if (i0) i0.addEventListener('click', installCurriculo);
  _root.querySelectorAll('[data-trilha]').forEach(el => el.addEventListener('click', () => { _trilha = el.dataset.trilha; _view = 'trilha'; render(); }));
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
  _root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(_items.find(x => x.id === b.dataset.edit))));
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
      </div>
      ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="flex-shrink:0">▶ Abrir</a>` : ''}
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
  } catch (e) { /* mantém otimista */ }
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
}

async function installCurriculo() {
  const out = document.getElementById('ac-install-out');
  const btn = document.getElementById('ac-install') || document.getElementById('ac-install0');
  if (btn) { btn.disabled = true; btn.textContent = 'Instalando…'; }
  try {
    const items = curriculumItems();
    const r = await api.request('/api/v3/diretoria/academy', { method: 'POST', body: { action: 'bulk', items } });
    if (r && r.ok) {
      if (out) out.innerHTML = `<span style="color:#16a34a">✓ ${r.count} aulas instaladas.</span>`;
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
          <div><label class="tiny muted" style="font-weight:700">Duração</label>
            <input id="af-duracao" class="input" value="${esc(c.duracao || '')}" placeholder="12 min" style="width:100%" /></div>
          <div><label class="tiny muted" style="font-weight:700">Ordem</label>
            <input id="af-ordem" class="input" type="number" value="${esc(c.ordem ?? 0)}" style="width:100%" /></div>
        </div>
        <div id="af-err" class="tiny" style="color:#dc2626;margin-top:8px"></div>
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
