/* ============================================================================
   PSM-OS v2 — Main entry (ES module)
============================================================================ */
import { auth } from './auth.js';
import { router } from './router.js';
import { initPulse } from './pulse.js';
import { initRealtime } from './realtime.js';
import { api } from './api.js';
import { initPush, enablePush, pushSupported, pushPermission } from './push.js';
import { loadFrentes, frentesAtivas, FRENTES } from './frentes.js';
import { pageUsuarios as pageUsuariosV2 } from './pages/usuarios.js';
import { pageAuditoria } from './pages/auditoria.js';
import { pageDashboard as pageDashboardV2 } from './pages/dashboard.js';
import { pagePainel } from './pages/painel.js';
import { pageFinanceiro } from './pages/financeiro.js';
import { pageCrm } from './pages/crm.js';
import { pageEquipe } from './pages/equipe.js';
import { pageTarefas } from './pages/tarefas.js';
import { pageMetas } from './pages/metas.js';
import { pageAgenda } from './pages/agenda.js';
import { pageDiretoria } from './pages/diretoria.js';
import { pageCockpitHub } from './pages/cockpit-hub.js';
import { pagePauloNegocios } from './pages/paulo-negocios.js';
import { pageProjetos } from './pages/projetos.js';
import { pagePsmHub } from './pages/psmhub.js';
import { pagePauloConteudo, pageConteudoImoveis, pageConteudoConquista } from './pages/paulo-conteudo.js';
import { pageCriativos, pageCriativosDownload, pageAnunciosPSM } from './pages/criativos.js';
import { pageSucessoCliente, pageSCOnboarding, pageSCCarteira, pageSCSuporte, pageSCRetencao, pageSCMetricas, pageSCUpsell, pageSCMarketing, pageSCAvaliacoes, pageSCIndicacoes } from './pages/sucesso-cliente.js';
import { pageEstrategia } from './pages/estrategia.js';
import { pageAcademy } from './pages/academy.js';
import { pageAcademyStudio } from './pages/academy-studio.js';
import { initNotifs, refreshNotifs } from './notifs.js';
import { sounds } from './sounds.js';
import { pageConfiguracoes } from './pages/configuracoes.js';
import { pageLogins } from './pages/logins.js';
import { pageConfigMenu } from './pages/config-menu.js';
import { loadMenuLabels, loadMenuLayout, applyHeaderOverride } from './menu-labels.js';
import { pageMarketing } from './pages/marketing.js';
import { pageIA } from './pages/ia.js';
import { pageLancamentos } from './pages/lancamentos.js';
import { pageLocacoes } from './pages/locacoes.js';
import { pageMinutasJuridico, pageMinutasLocacao } from './pages/minutas.js';
import { pageCnds } from './pages/cnds.js';
import { pageLinksUteis } from './pages/links-uteis.js';
import { pageSacIncorporadoras } from './pages/sac-incorporadoras.js';
import { pageSistemasIncorporadoras } from './pages/sistemas-incorporadoras.js';
import { initSearch } from './search.js';
import { pageQualidade } from './pages/qualidade.js';
import { initTimeline, reloadTimeline } from './timeline.js';
import { pageReunioes } from './pages/reunioes.js';
import { pageArena } from './pages/arena.js';
import { pageForecast } from './pages/forecast.js';
import { pageOrganograma } from './pages/organograma.js';
import { pageCheckin } from './pages/checkin.js';
import { pageRanking } from './pages/ranking.js';
import { pageImoveis } from './pages/imoveis.js';
import { pageConcorrencia } from './pages/concorrencia.js';
import { pageBP } from './pages/bp.js';
import { pageTV } from './pages/tv.js';
import { pageGovernanca } from './pages/governanca.js';
import { pageOO } from './pages/oo.js';
import { pagePlantoes } from './pages/plantoes.js';
import { pageCaptacoes } from './pages/captacoes.js';
import { pageSdr } from './pages/sdr.js';
import { pageReativacao } from './pages/reativacao.js';
import { pageTabelaImoveis } from './pages/tabela-imoveis.js';
import { pageIntegracoes } from './pages/integracoes.js';
import { pageBackup } from './pages/backup.js';
import { pageRelatorios } from './pages/relatorios.js';
import { pageManual } from './pages/manual.js';
import { pageEtica } from './pages/etica.js';
import { pageCanal } from './pages/canal.js';
import { pageBase } from './pages/base.js';
import { pageFormacao } from './pages/formacao.js';
import { pageGestaoPessoas, pageOnboarding, pageOffboarding, pageRhTreinamentos, pageRhRecrutamento, pageRhPlano, pageRhClima, pageRhAvaliacoes } from './pages/gestao-pessoas.js';
import { pageCompras, pagePatrimonio, pageManutencoes } from './pages/backoffice-adm.js';
import { pageRhCargos } from './pages/rh-cargos.js';
import { pageTalentos } from './pages/talentos.js';
// Ferramentas Conquista (v81.44) — gated em sócio (ROUTE_MIN_LVL=10) por enquanto
import { pageCockpitConquista } from './pages/cockpit-conquista.js';
import { pageMinhaComissao } from './pages/minha-comissao.js';
import { pageMeuCerebro } from './pages/meu-cerebro.js';
import { pageSimConquista } from './pages/sim-conquista.js';
import { pagePremiacoes } from './pages/premiacoes.js';
import { pageAgentes } from './pages/agentes.js';
import { pageAgenteVera } from './pages/agente-vera.js';
import { pageAgenteSol } from './pages/agente-sol.js';
import { pageTendencias } from './pages/tendencias.js';
import { pageBenchmark } from './pages/benchmark.js';
import { pageIntelAds } from './pages/intel-ads.js';
import { pageIntelCentro } from './pages/intel-centro.js';
import { pageBibliotecaAds } from './pages/biblioteca-ads.js';
import { pageMarketingHistorico } from './pages/marketing-historico.js';
import { pageDadosMercado } from './pages/dados-mercado.js';
import { pageIntelVendas } from './pages/intel-vendas.js';
import { pageIntelBriefing } from './pages/intel-briefing.js';
import { pageSimuladores } from './pages/simuladores.js';
import { pageSimVPL } from './pages/sim-vpl.js';
import { pageSimINCC } from './pages/sim-incc.js';
import { pageSimRepasse } from './pages/sim-repasse.js';
import { pageSimEnergia } from './pages/sim-energia.js';
import { pageSimAmortizacao } from './pages/sim-amortizacao.js';
import { pageSimLeads } from './pages/sim-leads.js';
import { pageSimCriativos } from './pages/sim-criativos.js';
import { pageWarRoom } from './pages/war-room.js';
import { pageWarArena } from './pages/war-arena.js';
import { pageOKRs } from './pages/okrs.js';
import { pageMetricasViab } from './pages/metricas-viab.js';
import { pageSimTrafego } from './pages/sim-trafego.js';
import { pageCampanhaWa } from './pages/campanha-wa.js';
import { pageOportunidades } from './pages/oportunidades.js';
import { pageCadencia } from './pages/cadencia.js';
import { pageScripts } from './pages/scripts.js';
import { pageFichasPropostas } from './pages/fichas-propostas.js';
import { pageSrGerencia } from './pages/sr-gerencia.js';
import { pageSrPerformance } from './pages/sr-performance.js';
import { pageMapa } from './pages/mapa.js';

// ─── Permissões por role (Sprint 9.6) ──────────────────────────────────
// Cada rota pertence a um GRUPO. Cada role enxerga só os grupos liberados.
// 'conta' e 'inicio' são sempre liberados pra qualquer login.
export const ROUTE_GROUP = {
  // Início (sempre)
  '/': 'inicio', '/painel': 'inicio', '/checkin': 'inicio', '/ranking': 'inicio', '/agenda': 'inicio', '/tarefas': 'inicio',
  // Secretaria de Vendas & Backoffice (SDR + Captações)
  '/sdr': 'secretaria', '/reativacao': 'secretaria', '/captacoes': 'secretaria', '/links-uteis': 'secretaria', '/sac-incorporadoras': 'secretaria', '/sistemas-incorporadoras': 'secretaria', '/campanha-wa': 'secretaria',
  // Backoffice & Adm (v81.93)
  '/compras': 'adm', '/patrimonio': 'adm', '/manutencoes': 'adm',
  // Imóveis & Vendas (+ Metas/Equipes/Plantões e simuladores VPL/INCC/Repasse/Energia migrados)
  '/crm': 'vendas', '/oportunidades': 'vendas', '/cadencia': 'vendas', '/scripts': 'vendas', '/fichas': 'vendas',
  '/imoveis': 'vendas', '/mapa': 'vendas', '/tabela-imoveis': 'vendas', '/tabela-conquista': 'vendas', '/tabela-map': 'vendas', '/lancamentos': 'vendas',
  '/metas': 'vendas', '/equipe': 'vendas', '/plantoes': 'vendas',
  '/sim-vpl': 'vendas', '/sim-incc': 'vendas', '/sim-repasse': 'vendas', '/sim-energia': 'vendas', '/sim-amortizacao': 'vendas',
  '/cockpit-conquista': 'vendas', '/minha-comissao': 'vendas', '/meu-cerebro': 'vendas', '/sim-conquista': 'vendas',  // ferramentas Conquista (v81.44)
  // Locação
  '/locacoes': 'locacao', '/minutas-locacao': 'locacao',
  // Financeiro
  '/financeiro': 'financeiro', '/forecast': 'financeiro',
  // Inteligência & Marketing
  '/marketing': 'marketing', '/concorrencia': 'marketing', '/benchmark': 'marketing',
  '/intel-ads': 'marketing', '/intel-dash': 'marketing', '/tendencias': 'marketing', '/inteligencia': 'marketing', '/biblioteca-ads': 'marketing', '/anuncios-concorrentes': 'marketing', '/marketing-historico': 'marketing', '/cerebro-vendas': 'marketing', '/briefing-guerra': 'marketing', '/paulo-conteudo': 'marketing', '/conteudo-imoveis': 'marketing', '/conteudo-conquista': 'marketing', '/criativos': 'marketing', '/criativos-download': 'marketing',
  '/dados-mercado': 'diretoria',
  // Arena & Performance (Metas/Equipes/Plantões migraram p/ Imóveis & Vendas)
  '/organograma': 'performance', '/one-on-one': 'performance', '/arena': 'performance',
  '/tv': 'performance', '/war-room': 'performance', '/war-arena': 'performance',
  // Diretoria
  '/cockpit': 'diretoria', '/paulo': 'diretoria', '/projetos': 'diretoria',
  '/diretoria': 'diretoria', '/kpis': 'diretoria', '/okrs': 'diretoria',
  '/metricas-viab': 'diretoria', '/sim-trafego': 'diretoria', '/mapa-ciclos': 'diretoria', '/bp': 'diretoria', '/governanca': 'diretoria', '/reunioes': 'diretoria',
  // Jurídico (grupo próprio)
  '/minutas': 'juridico', '/cnds': 'juridico',
  '/pontos-atencao': 'diretoria', '/insights': 'diretoria', '/estrategia': 'diretoria',
  // IA
  '/agentes': 'ia', '/ia': 'ia', '/sr-performance': 'ia', '/sr-gerencia': 'ia',
  // PSM Academy — menu próprio, visível a todos (a "faculdade" da PSM)
  '/academy': 'academy', '/academy-studio': 'academy',
  // Cultura/Compliance → movidos pro Início (sempre visíveis)
  '/base': 'inicio', '/manual': 'inicio', '/etica': 'inicio', '/canal': 'inicio',
  '/formacao': 'academy', '/premiacoes': 'inicio',
  // Gestão de Pessoas & RH (grupo próprio)
  '/gestao-pessoas': 'rh', '/onboarding': 'rh', '/offboarding': 'rh',
  '/rh-treinamentos': 'rh', '/rh-recrutamento': 'rh', '/rh-plano': 'rh', '/rh-clima': 'rh', '/rh-avaliacoes': 'rh', '/rh-funcoes': 'rh',   // abas RH soltas (v81.55 / funcoes+organograma v81.95)
  '/sucesso-cliente': 'sucesso',   // Customer Success (v81.53)
  '/cs-onboarding': 'sucesso', '/cs-carteira': 'sucesso', '/cs-suporte': 'sucesso', '/cs-retencao': 'sucesso', '/cs-metricas': 'sucesso', '/cs-upsell': 'sucesso', '/cs-marketing': 'sucesso', '/cs-avaliacoes': 'sucesso', '/cs-indicacoes': 'sucesso',   // abas CS soltas (v81.55)
  '/talentos': 'rh', '/psmhub': 'diretoria',
  // Ferramentas
  '/simuladores': 'ferramentas', '/relatorios': 'diretoria',
  // Sistema
  '/usuarios': 'sistema', '/auditoria': 'sistema', '/integracoes': 'sistema',
  '/backup': 'sistema', '/configuracoes': 'sistema', '/config-menu': 'sistema', '/logins': 'sistema', '/qualidade': 'sistema',
  // Conta (sempre)
  '/conta': 'conta',
  // simuladores Leads/CAC e Criativos migraram p/ Marketing (VPL/INCC/Repasse/Energia → Imóveis & Vendas, acima)
  '/sim-leads': 'marketing', '/sim-criativos': 'marketing',
  '/agente-vera': 'ia', '/agente-sol': 'ia',
};

// '*' = vê tudo. Senão, lista de grupos permitidos (inicio + conta sempre incluídos).
export const ROLE_ALLOWED = {
  socio:      '*',
  diretor:    '*',
  gerente:    '*',
  // gerentes por categoria (lvl 7) — default = tudo; o sócio afina cada um na matriz. v81.89
  gerente_conquista: '*',
  gerente_map:       '*',
  gerente_locacao:   '*',
  gerente_terceiros: '*',
  // líder: toda a operação + performance da equipe, MAS sem Diretoria nem Sistema (admin)
  lider:      ['inicio', 'secretaria', 'adm', 'vendas', 'captacoes', 'locacao', 'marketing', 'performance', 'ia', 'rh', 'ferramentas', 'academy', 'conta'],
  marketing:  ['inicio', 'secretaria', 'marketing', 'captacoes', 'rh', 'academy', 'conta'],
  backoffice: ['inicio', 'secretaria', 'adm', 'captacoes', 'vendas', 'locacao', 'rh', 'academy', 'conta'],
  // secretária de vendas (lvl 3) — apoio comercial; o sócio afina na matriz. v81.89
  secretaria_vendas: ['inicio', 'secretaria', 'adm', 'vendas', 'captacoes', 'locacao', 'academy', 'conta'],
  financeiro: ['inicio', 'financeiro', 'rh', 'academy', 'conta'],
  corretor:   ['inicio', 'secretaria', 'vendas', 'captacoes', 'locacao', 'performance', 'ia', 'rh', 'ferramentas', 'academy', 'conta'],
  // Sub-tipos de corretor (lvl 2) — default = mesmo do corretor; o sócio afina cada um
  // em "Permissões por papel". v81.37
  corretor_conquista: ['inicio', 'secretaria', 'vendas', 'captacoes', 'locacao', 'performance', 'ia', 'rh', 'ferramentas', 'academy', 'conta'],
  corretor_map:       ['inicio', 'secretaria', 'vendas', 'captacoes', 'locacao', 'performance', 'ia', 'rh', 'ferramentas', 'academy', 'conta'],
  corretor_locacao:   ['inicio', 'secretaria', 'vendas', 'captacoes', 'locacao', 'performance', 'ia', 'rh', 'ferramentas', 'academy', 'conta'],
  corretor_terceiros: ['inicio', 'secretaria', 'vendas', 'captacoes', 'locacao', 'performance', 'ia', 'rh', 'ferramentas', 'academy', 'conta'],
};

// Nível MÍNIMO real (backend) p/ páginas que vivem num grupo compartilhado mas
// exigem mais do que o cargo mais baixo daquele grupo tem. Sem isso, o item
// aparecia no menu (grupo permitido) e dava 403 ao clicar (ex.: Guilherme/marketing).
// Espelha o require_user(min_lvl=) do endpoint primário de cada página (v77.49).
export const ROUTE_MIN_LVL = {
  '/compras': 2, '/patrimonio': 2, '/manutencoes': 2,   // Backoffice & Adm — matriz decide quem vê. v81.93
  '/tabela-imoveis': 5,   // upload de tabelas — não p/ corretor
  '/tabela-conquista': 2, // Tabela Conquista: VISÍVEL p/ corretor (read-only; upload é travado por can_edit lvl>=5 na página). Quem vê = matriz por papel. v81.40
  '/tabela-map': 2,       // Tabela MAP: idem
  '/campanha-wa': 5,      // disparo de campanha — não p/ corretor
  '/one-on-one': 5,       // visão de gestor do 1:1
  '/cerebro-vendas': 5,   // inteligência de vendas (líder+)
  '/briefing-guerra': 7,  // briefing estratégico (diretoria)
  '/academy-studio': 5,   // produção/construção da Academy — só time que constrói (líder+)
  '/config-menu': 10,     // renomear o menu/páginas — só sócio
  '/psmhub': 7,           // auditoria do PSM HUB (Conquista) — diretoria
  '/qualidade': 7,        // saúde dos cadastros — diretoria+
  // Ferramentas Conquista (v81.44): A PRINCÍPIO só sócio (lvl 10). Pra abrir pro
  // corretor é só baixar este número (ou liberar na matriz por papel).
  '/cockpit-conquista': 10, '/minha-comissao': 10, '/meu-cerebro': 10, '/sim-conquista': 10,
  // RH + Sucesso do Cliente (v81.58): piso 2 (corretor) — quem vê isso é decidido
  // 100% na matriz por papel (Configurações → Permissões), sem trava de nível.
  '/onboarding': 2, '/offboarding': 2,
  '/rh-treinamentos': 2, '/rh-recrutamento': 2, '/rh-plano': 2, '/rh-clima': 2, '/rh-avaliacoes': 2,
  '/sucesso-cliente': 2,
  '/cs-onboarding': 2, '/cs-carteira': 2, '/cs-suporte': 2, '/cs-retencao': 2, '/cs-metricas': 2, '/cs-upsell': 2, '/cs-marketing': 2, '/cs-avaliacoes': 2, '/cs-indicacoes': 2,
};

// Override por PAPEL (matriz editável pelo sócio em Configurações → Permissões por papel).
// { role: ["/rota", ...] } — só papéis customizados. Vazio = comportamento original. v77.81
let _rolePerms = {};
let _catalogRoutes = null;   // Set das rotas que são itens de menu (pra decisão granular)

function buildCatalog() {
  try {
    _catalogRoutes = new Set([...document.querySelectorAll('.app-sidebar .sb-link[data-nav]')].map(b => b.dataset.nav));
  } catch (_) { _catalogRoutes = null; }
}
export let ROUTE_LVL_OV = {};   // travas de nível por rota editadas pelo sócio (Central de Permissões). v83.9
export const routeMinLvl = base => (ROUTE_LVL_OV[base] !== undefined ? ROUTE_LVL_OV[base] : (ROUTE_MIN_LVL[base] || 0));
async function loadRolePerms() {
  try {
    const r = await api.request('/api/v3/settings/role_perms');
    _rolePerms = (r && r.perms) || {};
    ROUTE_LVL_OV = (r && r.route_lvl) || {};
  }
  catch (_) { _rolePerms = {}; ROUTE_LVL_OV = {}; }
}

function _allowedGroups(user) {
  // Override por usuário (lista branca de grupos), setado no cadastro (menu_groups).
  // Quando presente, MANDA — vê só esses grupos + os sempre-visíveis (inicio/conta/academy). v77.53
  if (Array.isArray(user?.menu_groups)) return user.menu_groups;
  const role = (user?.role || 'corretor').toLowerCase();
  const lvl = user?.lvl || 0;
  if (lvl >= 7) return '*';  // sócio/diretor/gerente sempre tudo
  return ROLE_ALLOWED[role] || ROLE_ALLOWED.corretor;
}

function canSee(path, user) {
  const base = (path || '/').split('?')[0];
  const role = (user?.role || 'corretor').toLowerCase();
  const grp = ROUTE_GROUP[base] || 'inicio';

  // 🔐 Cofre de Logins e Senhas: acessível a qualquer autenticado — o backend só
  // devolve a cada um as credenciais liberadas pra ele (viewers). v77.93
  if (base === '/logins') return true;

  // override por PAPEL (matriz editável pelo sócio) — só quando o papel foi customizado.
  // socio nunca entra aqui (não dá pra se trancar fora). v77.81
  const rp = _rolePerms[role];
  if (role !== 'socio' && !Array.isArray(user?.menu_groups) && Array.isArray(rp)) {
    if (grp === 'conta') return true;  // só CONTA é sempre visível; Início e PSM Academy agora são configuráveis por papel (v81.40)
    // v81.58: a MATRIZ MANDA — o sócio decide o que cada papel vê, SEM trava de nível.
    // (o backend ainda é a fronteira de segurança real; aqui é só a visibilidade do menu)
    if (_catalogRoutes && _catalogRoutes.has(base)) return rp.includes(base);   // item de menu: granular
    return rp.some(r => (ROUTE_GROUP[r] || '') === grp);                        // sub-rota: liberada se o grupo tem item liberado
  }

  // ── comportamento ORIGINAL (sem customização de papel) ──
  const allowed = _allowedGroups(user);
  if (allowed === '*') return true;
  if ((user?.lvl || 0) < routeMinLvl(base)) return false;   // trava editável (Central de Permissões). v83.9
  if (grp === 'inicio' || grp === 'conta' || grp === 'academy') return true;
  if (allowed.includes(base)) return true;
  return allowed.includes(grp);
}

// Frente pausada (Central de Frentes) → esconde as telas dela do menu, em vez de
// exibir aba vazia. Hoje mapeia Locações; frentes de venda compartilham as telas. v84.0
const FRENTE_ROUTES = { locacoes: ['/locacoes', '/minutas'] };
function applyFrentesPausadas() {
  for (const f of FRENTES) {
    const rotas = FRENTE_ROUTES[f.id] || [];
    for (const r of rotas) {
      const el = document.querySelector(`.app-sidebar .sb-link[data-nav="${r}"]`);
      if (el && f.ativa === false) el.style.display = 'none';
    }
  }
}

function applyPermissions(user) {
  // reset (re-aplicável: chamado de novo quando o override de papel chega)
  document.querySelectorAll('.sb-link[data-nav]').forEach(b => { b.style.display = ''; });
  document.querySelectorAll('.app-sidebar .sb-sec').forEach(s => { s.style.display = ''; });
  const role = (user?.role || '').toLowerCase();
  const customized = role !== 'socio' && !Array.isArray(user?.menu_groups) && Array.isArray(_rolePerms[role]);
  // vê tudo e não customizado → não filtra
  if (!customized && _allowedGroups(user) === '*') return;
  // Esconde links não permitidos
  document.querySelectorAll('.sb-link[data-nav]').forEach(btn => {
    if (!canSee(btn.dataset.nav, user)) btn.style.display = 'none';
  });
  // Esconde seções (sb-sec) que ficaram sem nenhum link visível
  const sidebar = document.querySelector('.app-sidebar');
  if (!sidebar) return;
  const nodes = [...sidebar.children];
  nodes.forEach((node, i) => {
    if (!node.classList || !node.classList.contains('sb-sec')) return;
    // Conta links visíveis até a próxima sb-sec
    let visible = 0;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].classList && nodes[j].classList.contains('sb-sec')) break;
      if (nodes[j].classList && nodes[j].classList.contains('sb-link') && nodes[j].style.display !== 'none') visible++;
    }
    if (visible === 0) node.style.display = 'none';
  });
}

// Minimizar/expandir categorias do menu (cabeçalhos sb-sec) — estado salvo por usuário.
// Usa CLASSE css (não inline display) pra não conflitar com a ocultação por permissão. v77.85
function initSectionCollapse() {
  const KEY = 'psm.v2.menu_collapsed';
  let collapsed;
  try { collapsed = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (_) { collapsed = new Set(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...collapsed])); } catch (_) {} };
  if (!document.getElementById('sb-collapse-css')) {
    const st = document.createElement('style');
    st.id = 'sb-collapse-css';
    // caret via ::after (pseudo-elemento) — sobrevive ao menu-labels, que reescreve o textContent das seções
    st.textContent = '.sb-sec{cursor:pointer;user-select:none;position:relative;padding-right:22px}'
      + '.sb-sec::after{content:"▾";position:absolute;right:10px;top:50%;transform:translateY(-50%);opacity:.5;font-size:10px;font-weight:400}'
      + '.sb-sec.sec-collapsed::after{content:"▸"}'
      + '.menu-collapsed{display:none !important}';
    document.head.appendChild(st);
  }
  const sidebar = document.querySelector('.app-sidebar');
  if (!sidebar) return;
  sidebar.querySelectorAll('.sb-sec').forEach(sec => {
    const key = sec.dataset.deflabel || (sec.textContent || '').trim();
    // itens da seção = irmãos até o próximo sb-sec (inclui sb-subsec + sb-link)
    const items = [];
    let n = sec.nextElementSibling;
    while (n && !(n.classList && n.classList.contains('sb-sec'))) { items.push(n); n = n.nextElementSibling; }
    const apply = () => {
      const isC = collapsed.has(key);
      sec.classList.toggle('sec-collapsed', isC);
      items.forEach(it => it.classList.toggle('menu-collapsed', isC));
    };
    if (!sec._collapseWired) {
      sec._collapseWired = true;
      sec.addEventListener('click', () => {
        // ⚓ Ancora o cabeçalho clicado: guarda a posição dele na tela, aplica o
        // colapso/expansão e reajusta o scroll pra ele NÃO sair do lugar — assim as
        // outras seções não "pulam" sob o cursor e some o erro de clique. v81.61
        const sc = sec.closest('.app-sidebar') || sidebar;
        const before = sec.getBoundingClientRect().top;
        if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
        apply(); save();
        const after = sec.getBoundingClientRect().top;
        const delta = after - before;
        if (delta && sc && typeof sc.scrollTop === 'number') sc.scrollTop += delta;
      });
    }
    apply();
  });
}

// Versão do CÓDIGO embarcado neste bundle. Comparada com /version.json pra detectar
// quando a aba está rodando um JS antigo (cache/SW) e oferecer "Atualizar agora". v77.99
const APP_VERSION = '84.8.0';

// ─── Boot ──────────────────────────────────────────────────────────────
(async function boot() {
  // 1) Tenta hidratar sessão
  const user = await auth.hydrate();
  if (!user) {
    location.href = '/login?from=' + encodeURIComponent(location.pathname + location.hash);
    return;
  }

  // 2) Renderiza shell
  document.body.innerHTML = shellHTML(user);

  // 3) Eventos do shell
  document.getElementById('btn-logout').addEventListener('click', () => auth.logout());

  // Hamburger (mobile)
  const sidebar = document.querySelector('.app-sidebar');
  const backdrop = document.getElementById('sb-backdrop');
  const openSidebar = () => { sidebar.classList.add('open'); backdrop.classList.add('open'); };
  const closeSidebar = () => { sidebar.classList.remove('open'); backdrop.classList.remove('open'); };
  document.getElementById('btn-hamburger').addEventListener('click', openSidebar);
  backdrop.addEventListener('click', closeSidebar);

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      router.go(btn.dataset.nav);
      closeSidebar();  // fecha drawer ao navegar (mobile)
    });
  });

  // 3.1) Permissões por papel — esconde links/seções não permitidas + guarda rotas
  buildCatalog();              // mapeia as rotas que são itens de menu (granularidade)
  applyPermissions(user);      // 1ª passada: comportamento default (igual a hoje)
  router.setGuard((path) => canSee(path, user));
  // override por papel (matriz editável pelo sócio) chega async e re-aplica
  loadRolePerms().then(() => applyPermissions(user));
  loadFrentes().then(() => applyFrentesPausadas());   // fonte única de frentes (v84.0)

  // 3.1c) Minimizar/expandir categorias do menu (estado salvo por usuário)
  initSectionCollapse();

  // 3.1b) Nomes custom + organização do menu (sócio edita em /config-menu) — vale p/ todos
  loadMenuLabels().then(() => loadMenuLayout()).catch(() => {});

  // 3.2) Auto-cura do sync RD: o cron do Vercel é não-confiável (limite do plano),
  // então o próprio uso mantém o dado fresco — se o último sync tiver +6h, dispara
  // um refresh em background (debounce 30min por navegador; idempotente no server).
  try {
    const AUTOSYNC_KEY = 'psm.v2.autosync_at';
    const lastTry = parseInt(localStorage.getItem(AUTOSYNC_KEY) || '0');
    if (Date.now() - lastTry > 30 * 60 * 1000) {
      localStorage.setItem(AUTOSYNC_KEY, String(Date.now()));
      api.request('/api/v3/crm/sync_if_stale').then(r => {
        if (r && r.fresh === false) console.log('[autosync] RD atualizado:', r.upserted, 'deals (estava', r.was_stale_h, 'h velho)');
      }).catch(() => {});
    }
    // Heartbeat: executa 1 job de cron vencido por boot (captar/históricoMeta/briefing) —
    // rede de segurança pros crons do Vercel que o plano não roda (debounce 20min).
    const HB_KEY = 'psm.v2.heartbeat_at';
    const hbLast = parseInt(localStorage.getItem(HB_KEY) || '0');
    if (Date.now() - hbLast > 20 * 60 * 1000) {
      localStorage.setItem(HB_KEY, String(Date.now()));
      api.request('/api/v3/system/heartbeat').then(r => {
        if (r && r.ran) console.log('[heartbeat] job executado:', r.ran, r.ok ? 'ok' : r.error);
      }).catch(() => {});
    }
    // Captação RD→Kanban: além do webhook (tempo real), o uso do sistema puxa quem
    // entrou na etapa CAPTAR IMÓVEL (debounce 15min/navegador) — independe de cron.
    const CAP_KEY = 'psm.v2.captar_at';
    const capLast = parseInt(localStorage.getItem(CAP_KEY) || '0');
    if (Date.now() - capLast > 15 * 60 * 1000) {
      localStorage.setItem(CAP_KEY, String(Date.now()));
      api.request('/api/v3/crm/captar_now').then(r => {
        if (r && r.created) console.log('[captar] novas captações do RD:', r.created);
      }).catch(() => {});
    }
  } catch {}

  // 3.3) Briefing matinal do diretor: depois das 7h, o 1º diretor que abrir o
  // sistema dispara o resumo do dia anterior no WhatsApp (dedup no server,
  // 1×/dia). Mesma filosofia do auto-sync: o uso substitui o cron.
  try {
    if ((user.lvl || 0) >= 7) {
      const BRIEF_KEY = 'psm.v2.briefing_at';
      const lastB = parseInt(localStorage.getItem(BRIEF_KEY) || '0');
      if (Date.now() - lastB > 60 * 60 * 1000) {
        localStorage.setItem(BRIEF_KEY, String(Date.now()));
        api.request('/api/v3/intel/briefing_diario?auto=1').then(r => {
          if (r && r.enviado) console.log('[briefing] enviado no WhatsApp');
          else if (r && r.pending) console.log('[briefing] pendente:', r.error);
        }).catch(() => {});
      }
    }
  } catch {}

  // 4) Registra rotas (Sprint 7.3: dashboard + painel modulares)
  router.register('/',          { render: async (ctx, root) => { setHeader('Dashboard'); highlight('/');          await pageDashboardV2(ctx, root); } });
  router.register('/painel',    { render: async (ctx, root) => { setHeader('Meu Painel'); highlight('/painel');   await pagePainel(ctx, root); } });
  router.register('/financeiro',{ render: async (ctx, root) => { setHeader('Financeiro');highlight('/financeiro');await pageFinanceiro(ctx, root); } });
  router.register('/crm',       { render: async (ctx, root) => { setHeader('CRM');       highlight('/crm');       await pageCrm(ctx, root); } });
  router.register('/equipe',    { render: async (ctx, root) => { setHeader('Equipe');    highlight('/equipe');    await pageEquipe(ctx, root); } });
  router.register('/tarefas',   { render: async (ctx, root) => { setHeader('Tarefas');   highlight('/tarefas');   await pageTarefas(ctx, root); } });
  router.register('/metas',     { render: async (ctx, root) => { setHeader('Metas');     highlight('/metas');     await pageMetas(ctx, root); } });
  router.register('/agenda',    { render: async (ctx, root) => { setHeader('Agenda');    highlight('/agenda');    await pageAgenda(ctx, root); } });
  router.register('/cockpit', { render: async (ctx, root) => { setHeader('Cockpit de Decisão'); highlight('/cockpit'); await pageCockpitHub(ctx, root); } });
  router.register('/diretoria', { render: async (ctx, root) => { setHeader('Dashboard Diretoria'); highlight('/diretoria'); await pageDiretoria(ctx, root); } });
  router.register('/paulo', { render: async (ctx, root) => { setHeader('Paulo · Meus Negócios'); highlight('/paulo'); await pagePauloNegocios(ctx, root); } });
  router.register('/projetos', { render: async (ctx, root) => { setHeader('Projetos'); highlight('/projetos'); await pageProjetos(ctx, root); } });
  router.register('/psmhub', { render: async (ctx, root) => { setHeader('PSM HUB · Conquista'); highlight('/psmhub'); await pagePsmHub(ctx, root); } });
  router.register('/minutas', { render: async (ctx, root) => { setHeader('Minutas padrão'); highlight('/minutas'); await pageMinutasJuridico(ctx, root); } });
  router.register('/cnds',    { render: async (ctx, root) => { setHeader("CND's"); highlight('/cnds'); await pageCnds(ctx, root); } });
  router.register('/links-uteis', { render: async (ctx, root) => { setHeader('Links úteis'); highlight('/links-uteis'); await pageLinksUteis(ctx, root); } });
  router.register('/sac-incorporadoras', { render: async (ctx, root) => { setHeader('SAC Incorporadoras'); highlight('/sac-incorporadoras'); await pageSacIncorporadoras(ctx, root); } });
  router.register('/sistemas-incorporadoras', { render: async (ctx, root) => { setHeader('Sistema e Drive Incorporadoras'); highlight('/sistemas-incorporadoras'); await pageSistemasIncorporadoras(ctx, root); } });
  router.register('/reunioes', { render: async (ctx, root) => { setHeader('Formatos de Reunião'); highlight('/reunioes'); await pageReunioes(ctx, root); } });
  router.register('/estrategia', { render: async (ctx, root) => { setHeader('Estratégia'); highlight('/estrategia'); await pageEstrategia(ctx, root); } });
  // v77.30: absorvidas pelo Cockpit Hub — redirects preservam links/hábito antigos
  router.register('/pontos-atencao', { render: async () => { location.hash = '#/cockpit?tab=atencao'; } });
  router.register('/insights', { render: async () => { location.hash = '#/cockpit?tab=insights'; } });
  router.register('/academy', { render: async (ctx, root) => { setHeader('PSM Academy'); highlight('/academy'); await pageAcademy(ctx, root); } });
  router.register('/academy-studio', { render: async (ctx, root) => { setHeader('Academy · Produção'); highlight('/academy-studio'); await pageAcademyStudio(ctx, root); } });
  router.register('/marketing', { render: async (ctx, root) => { setHeader('Marketing'); highlight('/marketing'); await pageMarketing(ctx, root); } });
  router.register('/paulo-conteudo', { render: async (ctx, root) => { setHeader('Paulo Morimatsu · Conteúdo'); highlight('/paulo-conteudo'); await pagePauloConteudo(ctx, root); } });
  router.register('/conteudo-imoveis', { render: async (ctx, root) => { setHeader('PSM Imóveis · Conteúdo'); highlight('/conteudo-imoveis'); await pageConteudoImoveis(ctx, root); } });
  router.register('/conteudo-conquista', { render: async (ctx, root) => { setHeader('PSM Conquista · Conteúdo'); highlight('/conteudo-conquista'); await pageConteudoConquista(ctx, root); } });
  router.register('/criativos', { render: async (ctx, root) => { setHeader('Solicitações de Criativos'); highlight('/criativos'); await pageCriativos(ctx, root); } });
  router.register('/criativos-download', { render: async (ctx, root) => { setHeader('Criativos para Download'); highlight('/criativos-download'); await pageCriativosDownload(ctx, root); } });
  router.register('/inteligencia', { render: async (ctx, root) => { setHeader('Centro de Inteligência'); highlight('/inteligencia'); await pageIntelCentro(ctx, root); } });
  router.register('/dados-mercado', { render: async (ctx, root) => { setHeader('Dados de Mercado'); highlight('/dados-mercado'); await pageDadosMercado(ctx, root); } });
  // v81.61: "Biblioteca de Anúncios" agora é a dos anúncios DA PSM (criativo + copy).
  router.register('/biblioteca-ads', { render: async (ctx, root) => { setHeader('Biblioteca de Anúncios'); highlight('/biblioteca-ads'); await pageAnunciosPSM(ctx, root); } });
  // o monitoramento de concorrentes (antiga biblioteca-ads) virou item próprio.
  router.register('/anuncios-concorrentes', { render: async (ctx, root) => { setHeader('Anúncios dos Concorrentes'); highlight('/anuncios-concorrentes'); await pageBibliotecaAds(ctx, root); } });
  router.register('/marketing-historico', { render: async (ctx, root) => { setHeader('Histórico Meta'); highlight('/marketing-historico'); await pageMarketingHistorico(ctx, root); } });
  router.register('/cerebro-vendas', { render: async (ctx, root) => { setHeader('Cérebro de Vendas'); highlight('/cerebro-vendas'); await pageIntelVendas(ctx, root); } });
  router.register('/briefing-guerra', { render: async (ctx, root) => { setHeader('Briefing de Guerra'); highlight('/briefing-guerra'); await pageIntelBriefing(ctx, root); } });
  router.register('/ia',        { render: async (ctx, root) => { setHeader('IA');        highlight('/ia');        await pageIA(ctx, root); } });
  router.register('/lancamentos', { render: async (ctx, root) => { setHeader('Lançamentos'); highlight('/lancamentos'); await pageLancamentos(ctx, root); } });
  router.register('/locacoes',  { render: async (ctx, root) => { setHeader('Locações');  highlight('/locacoes');  await pageLocacoes(ctx, root); } });
  router.register('/minutas-locacao', { render: async (ctx, root) => { setHeader('Minutas e Fichas · Locação'); highlight('/minutas-locacao'); await pageMinutasLocacao(ctx, root); } });
  router.register('/arena',     { render: async (ctx, root) => { setHeader('Arena Live'); highlight('/arena');     await pageArena(ctx, root); } });
  router.register('/forecast',  { render: async (ctx, root) => { setHeader('Forecast');  highlight('/forecast');  await pageForecast(ctx, root); } });
  router.register('/organograma', { render: async (ctx, root) => { setHeader('Organograma'); highlight('/organograma'); await pageOrganograma(ctx, root); } });
  router.register('/checkin',     { render: async (ctx, root) => { setHeader('Check-in');     highlight('/checkin');     await pageCheckin(ctx, root); } });
  router.register('/ranking',     { render: async (ctx, root) => { setHeader('Ranking');      highlight('/ranking');     await pageRanking(ctx, root); } });
  router.register('/imoveis',     { render: async (ctx, root) => { setHeader('Imóveis');      highlight('/imoveis');     await pageImoveis(ctx, root); } });
  router.register('/concorrencia',{ render: async (ctx, root) => { setHeader('Concorrência'); highlight('/concorrencia');await pageConcorrencia(ctx, root); } });
  router.register('/bp',          { render: async (ctx, root) => { setHeader('Plano BP');     highlight('/bp');          await pageBP(ctx, root); } });
  router.register('/tv',          { render: async (ctx, root) => { setHeader('Modo TV');      highlight('/tv');          await pageTV(ctx, root); } });
  router.register('/governanca',  { render: async (ctx, root) => { setHeader('Governança');   highlight('/governanca');  await pageGovernanca(ctx, root); } });
  router.register('/one-on-one',  { render: async (ctx, root) => { setHeader('One-on-One');   highlight('/one-on-one');  await pageOO(ctx, root); } });
  router.register('/plantoes',    { render: async (ctx, root) => { setHeader('Plantões');     highlight('/plantoes');    await pagePlantoes(ctx, root); } });
  router.register('/captacoes',   { render: async (ctx, root) => { setHeader('Captações');    highlight('/captacoes');   await pageCaptacoes(ctx, root); } });
  router.register('/sdr',         { render: async (ctx, root) => { setHeader('Prospecção SDR'); highlight('/sdr');         await pageSdr(ctx, root); } });
  router.register('/reativacao',  { render: async (ctx, root) => { setHeader('Reativação MAP'); highlight('/reativacao'); await pageReativacao(ctx, root); } });
  router.register('/integracoes', { render: async (ctx, root) => { setHeader('Integrações');  highlight('/integracoes'); await pageIntegracoes(ctx, root); } });
  router.register('/backup',      { render: async (ctx, root) => { setHeader('Backup');       highlight('/backup');      await pageBackup(ctx, root); } });
  router.register('/relatorios',  { render: async (ctx, root) => { setHeader('Relatórios');   highlight('/relatorios');  await pageRelatorios(ctx, root); } });
  router.register('/base',        { render: async (ctx, root) => { setHeader('Base de Conhecimento'); highlight('/base'); await pageBase(ctx, root); } });
  router.register('/manual',      { render: async (ctx, root) => { setHeader('Manual de Cultura');    highlight('/manual'); await pageManual(ctx, root); } });
  router.register('/etica',       { render: async (ctx, root) => { setHeader('Código de Ética');     highlight('/etica');  await pageEtica(ctx, root); } });
  router.register('/canal',       { render: async (ctx, root) => { setHeader('Canal Anônimo');        highlight('/canal');  await pageCanal(ctx, root); } });
  router.register('/formacao',    { render: async (ctx, root) => { setHeader('Formação PSM');         highlight('/formacao'); await pageFormacao(ctx, root); } });
  router.register('/gestao-pessoas', { render: async (ctx, root) => { setHeader('Gestão de Pessoas'); highlight('/gestao-pessoas'); await pageGestaoPessoas(ctx, root); } });
  router.register('/sucesso-cliente', { render: async (ctx, root) => { setHeader('Sucesso do Cliente'); highlight('/sucesso-cliente'); await pageSucessoCliente(ctx, root); } });
  router.register('/compras',     { render: async (ctx, root) => { setHeader('Compras');     highlight('/compras');     await pageCompras(ctx, root); } });
  router.register('/patrimonio',  { render: async (ctx, root) => { setHeader('Patrimônio');  highlight('/patrimonio');  await pagePatrimonio(ctx, root); } });
  router.register('/manutencoes', { render: async (ctx, root) => { setHeader('Manutenções'); highlight('/manutencoes'); await pageManutencoes(ctx, root); } });
  router.register('/onboarding',  { render: async (ctx, root) => { setHeader('Onboarding');  highlight('/onboarding');  await pageOnboarding(ctx, root); } });
  router.register('/offboarding', { render: async (ctx, root) => { setHeader('Offboarding'); highlight('/offboarding'); await pageOffboarding(ctx, root); } });
  router.register('/rh-treinamentos', { render: async (ctx, root) => { setHeader('Treinamentos'); highlight('/rh-treinamentos'); await pageRhTreinamentos(ctx, root); } });
  router.register('/rh-recrutamento', { render: async (ctx, root) => { setHeader('Recrutamento & Seleção'); highlight('/rh-recrutamento'); await pageRhRecrutamento(ctx, root); } });
  router.register('/rh-plano', { render: async (ctx, root) => { setHeader('Plano de Crescimento'); highlight('/rh-plano'); await pageRhPlano(ctx, root); } });
  router.register('/rh-clima', { render: async (ctx, root) => { setHeader('Clima Interno'); highlight('/rh-clima'); await pageRhClima(ctx, root); } });
  router.register('/rh-avaliacoes', { render: async (ctx, root) => { setHeader('Avaliações & Feedbacks'); highlight('/rh-avaliacoes'); await pageRhAvaliacoes(ctx, root); } });
  router.register('/rh-funcoes',    { render: async (ctx, root) => { setHeader('Funções & Organograma'); highlight('/rh-funcoes'); await pageRhCargos(ctx, root); } });
  router.register('/cs-onboarding', { render: async (ctx, root) => { setHeader('Onboarding do Cliente'); highlight('/cs-onboarding'); await pageSCOnboarding(ctx, root); } });
  router.register('/cs-carteira', { render: async (ctx, root) => { setHeader('Gestão de Carteira'); highlight('/cs-carteira'); await pageSCCarteira(ctx, root); } });
  router.register('/cs-suporte', { render: async (ctx, root) => { setHeader('Relacionamento & Suporte'); highlight('/cs-suporte'); await pageSCSuporte(ctx, root); } });
  router.register('/cs-retencao', { render: async (ctx, root) => { setHeader('Retenção & Renovação'); highlight('/cs-retencao'); await pageSCRetencao(ctx, root); } });
  router.register('/cs-metricas', { render: async (ctx, root) => { setHeader('Métricas de Sucesso'); highlight('/cs-metricas'); await pageSCMetricas(ctx, root); } });
  router.register('/cs-upsell', { render: async (ctx, root) => { setHeader('Upsell & Cross-sell'); highlight('/cs-upsell'); await pageSCUpsell(ctx, root); } });
  router.register('/cs-marketing', { render: async (ctx, root) => { setHeader('Customer Marketing'); highlight('/cs-marketing'); await pageSCMarketing(ctx, root); } });
  router.register('/cs-avaliacoes', { render: async (ctx, root) => { setHeader('Avaliações de Atendimento'); highlight('/cs-avaliacoes'); await pageSCAvaliacoes(ctx, root); } });
  router.register('/cs-indicacoes', { render: async (ctx, root) => { setHeader('Programa de Indicações'); highlight('/cs-indicacoes'); await pageSCIndicacoes(ctx, root); } });
  router.register('/talentos', { render: async (ctx, root) => { setHeader('Base de Talentos'); highlight('/talentos'); await pageTalentos(ctx, root); } });
  router.register('/premiacoes',  { render: async (ctx, root) => { setHeader('Premiações');           highlight('/premiacoes'); await pagePremiacoes(ctx, root); } });
  router.register('/agentes',     { render: async (ctx, root) => { setHeader('Central de Agentes');  highlight('/agentes');  await pageAgentes(ctx, root); } });
  router.register('/agente-vera', { render: async (ctx, root) => { setHeader('Agente Vera');         highlight('/agente-vera'); await pageAgenteVera(ctx, root); } });
  router.register('/agente-sol',  { render: async (ctx, root) => { setHeader('Agente Sol');          highlight('/agente-sol'); await pageAgenteSol(ctx, root); } });
  router.register('/tendencias',  { render: async (ctx, root) => { setHeader('Tendências');           highlight('/tendencias'); await pageTendencias(ctx, root); } });
  router.register('/benchmark',   { render: async (ctx, root) => { setHeader('Benchmark de Mercado'); highlight('/benchmark');  await pageBenchmark(ctx, root); } });
  router.register('/intel-ads',   { render: async (ctx, root) => { setHeader('Inteligência Ads');    highlight('/intel-ads');  await pageIntelAds(ctx, root); } });
  router.register('/intel-dash',  { render: async () => { location.hash = '#/inteligencia?tab=landscape'; } });   // aposentado: virou aba do Centro (v84.5)
  router.register('/simuladores', { render: async (ctx, root) => { setHeader('Simuladores');         highlight('/simuladores'); await pageSimuladores(ctx, root); } });
  router.register('/sim-vpl',     { render: async (ctx, root) => { setHeader('Simulador VPL');       highlight('/sim-vpl'); await pageSimVPL(ctx, root); } });
  router.register('/sim-incc',    { render: async (ctx, root) => { setHeader('Simulador INCC');      highlight('/sim-incc'); await pageSimINCC(ctx, root); } });
  router.register('/sim-repasse', { render: async (ctx, root) => { setHeader('Simulador Repasse');   highlight('/sim-repasse'); await pageSimRepasse(ctx, root); } });
  router.register('/sim-energia', { render: async (ctx, root) => { setHeader('Simulador Energia');   highlight('/sim-energia'); await pageSimEnergia(ctx, root); } });
  router.register('/sim-amortizacao', { render: async (ctx, root) => { setHeader('Simulador de Amortização'); highlight('/sim-amortizacao'); await pageSimAmortizacao(ctx, root); } });
  router.register('/cockpit-conquista', { render: async (ctx, root) => { setHeader('Cockpit Conquista'); highlight('/cockpit-conquista'); await pageCockpitConquista(ctx, root); } });
  router.register('/minha-comissao',   { render: async (ctx, root) => { setHeader('Minha Comissão');    highlight('/minha-comissao'); await pageMinhaComissao(ctx, root); } });
  router.register('/meu-cerebro',      { render: async (ctx, root) => { setHeader('Meu Cérebro de Vendas'); highlight('/meu-cerebro'); await pageMeuCerebro(ctx, root); } });
  router.register('/sim-conquista',    { render: async (ctx, root) => { setHeader('Simulador Conquista'); highlight('/sim-conquista'); await pageSimConquista(ctx, root); } });
  router.register('/sim-leads',   { render: async (ctx, root) => { setHeader('Simulador Leads/CAC'); highlight('/sim-leads'); await pageSimLeads(ctx, root); } });
  router.register('/sim-criativos', { render: async (ctx, root) => { setHeader('Simulador Criativos'); highlight('/sim-criativos'); await pageSimCriativos(ctx, root); } });
  router.register('/war-room',    { render: async (ctx, root) => { setHeader('War Room');            highlight('/war-room');   await pageWarRoom(ctx, root); } });
  router.register('/war-arena',   { render: async (ctx, root) => { setHeader('War Arena');           highlight('/war-arena');  await pageWarArena(ctx, root); } });
  router.register('/okrs',        { render: async (ctx, root) => { setHeader('OKRs');                highlight('/okrs');       await pageOKRs(ctx, root); } });
  router.register('/kpis',        { render: async () => { location.hash = '#/cockpit?tab=kpis'; } });
  router.register('/metricas-viab', { render: async (ctx, root) => { setHeader('Métricas Viabilidade'); highlight('/metricas-viab'); await pageMetricasViab(ctx, root); } });
  router.register('/sim-trafego', { render: async (ctx, root) => { setHeader('Simulador de Tráfego'); highlight('/sim-trafego'); await pageSimTrafego(ctx, root); } });
  router.register('/mapa-ciclos', { render: async () => { location.hash = '#/governanca?tab=mapa'; } });
  router.register('/oportunidades', { render: async (ctx, root) => { setHeader('Oportunidades');     highlight('/oportunidades'); await pageOportunidades(ctx, root); } });
  router.register('/cadencia',    { render: async (ctx, root) => { setHeader('Cadência');            highlight('/cadencia');    await pageCadencia(ctx, root); } });
  router.register('/scripts',     { render: async (ctx, root) => { setHeader('Scripts & Cadências'); highlight('/scripts');     await pageScripts(ctx, root); } });
  router.register('/fichas',      { render: async (ctx, root) => { setHeader('Fichas/Propostas');    highlight('/fichas');      await pageFichasPropostas(ctx, root); } });
  router.register('/campanha-wa', { render: async (ctx, root) => { setHeader('Campanha WhatsApp');   highlight('/campanha-wa'); await pageCampanhaWa(ctx, root); } });
  router.register('/sr-gerencia', { render: async (ctx, root) => { setHeader('Sr. Gerência');        highlight('/sr-gerencia'); await pageSrGerencia(ctx, root); } });
  router.register('/sr-performance', { render: async (ctx, root) => { setHeader('Sr. Performance'); highlight('/sr-performance'); await pageSrPerformance(ctx, root); } });
  router.register('/mapa',        { render: async (ctx, root) => { setHeader('Mapa de Imóveis');    highlight('/mapa');        await pageMapa(ctx, root); } });
  router.register('/tabela-imoveis', { render: async (ctx, root) => { setHeader('Tabela de Imóveis'); highlight('/tabela-imoveis'); await pageTabelaImoveis(ctx, root); } });
  router.register('/tabela-conquista', { render: async (ctx, root) => { setHeader('Tabela de Lançamentos Conquista'); highlight('/tabela-conquista'); await pageTabelaImoveis(ctx, root, 'conquista'); } });
  router.register('/tabela-map', { render: async (ctx, root) => { setHeader('Tabela de Lançamentos MAP'); highlight('/tabela-map'); await pageTabelaImoveis(ctx, root, 'imoveis'); } });
  router.register('/usuarios',  { render: async (ctx, root) => { setHeader('Usuários');  highlight('/usuarios');  await pageUsuariosV2(ctx, root); } });
  router.register('/auditoria', { render: async (ctx, root) => { setHeader('Auditoria'); highlight('/auditoria'); await pageAuditoria(ctx, root); } });
  router.register('/conta',     { render: pageConta });
  router.register('/configuracoes', { render: async (ctx, root) => { setHeader('Configurações'); highlight('/configuracoes'); await pageConfiguracoes(ctx, root); } });
  router.register('/config-menu', { render: async (ctx, root) => { setHeader('Editor de Menu'); highlight('/config-menu'); await pageConfigMenu(ctx, root); } });
  router.register('/logins',    { render: async (ctx, root) => { setHeader('Logins e Senhas'); highlight('/logins'); await pageLogins(ctx, root); } });
  router.register('/qualidade', { render: async (ctx, root) => { setHeader('Qualidade dos Dados'); highlight('/qualidade'); await pageQualidade(ctx, root); } });
  router.register('*',          { render: page404 });

  // 4.5) Tela inicial por PAPEL (sócio configura em Configurações → "Tela inicial por papel").
  // Se o usuário abriu na landing padrão ('' ou '/'), redireciona pra rota do papel.
  // Cache local p/ redirecionar instantâneo (sem flash); refresh async atualiza. v81.86
  const _isLanding = () => { const h = (location.hash || '').replace(/^#/, ''); return h === '' || h === '/'; };
  try {
    const cached = localStorage.getItem('psm.v2.home.' + user.role);
    if (_isLanding() && cached && cached !== '/' && canSee(cached, user)) location.hash = cached;
  } catch {}
  api.request('/api/v3/settings/home_routes').then(r => {
    const home = ((r && r.routes) || {})[user.role] || '';
    try {
      if (home) localStorage.setItem('psm.v2.home.' + user.role, home);
      else localStorage.removeItem('psm.v2.home.' + user.role);
    } catch {}
    if (_isLanding() && home && home !== '/' && canSee(home, user)) location.hash = home;
  }).catch(() => {});

  // 5) Monta router
  router.mount(document.getElementById('route-mount') || document.getElementById('app-main'));

  // 6) Notificações (sino + drawer + poll 60s)
  initNotifs();

  // 6b) Saúde do sistema (indicador no menu — falhas/desatualização/erros)
  initSystemHealth();

  // 7) Sons da Arena (Web Audio API)
  sounds.initSounds();

  // 8) Toggle sons button
  const btnSons = document.getElementById('btn-sons');
  if (btnSons) {
    const refresh = () => { btnSons.textContent = sounds.isEnabled() ? '🔊' : '🔇'; btnSons.title = sounds.isEnabled() ? 'Sons ativos (clique pra mutar)' : 'Sons mutados (clique pra ativar)'; };
    refresh();
    btnSons.addEventListener('click', () => { sounds.setEnabled(!sounds.isEnabled()); refresh(); if (sounds.isEnabled()) sounds.notif(); });
  }

  // 9) Service Worker + Web Push (notificações navegador + celular/PWA)
  const btnPush = document.getElementById('btn-push');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/v2/sw.js').then(reg => {
      initPush(reg);
      if (btnPush && pushSupported() && pushPermission() !== 'granted') {
        btnPush.style.display = '';
        btnPush.addEventListener('click', async () => {
          const ok = await enablePush();
          if (ok) { btnPush.style.display = 'none'; alert('✅ Notificações ativadas neste dispositivo!'); }
        });
      }
    }).catch(() => {});
  }

  // 9.5) Busca global (Cmd/Ctrl+K + botão 🔎 no topo)
  initSearch();

  // 9.6) Timeline de recados no topo (sócios publicam; notifica sino/push)
  initTimeline();

  // 10) Checagem de versão: avisa na hora se a aba está com código antigo,
  //     re-checa ao voltar pra aba, e o rodapé "House PSM · vX" checa sob clique.
  // ⚡ SINCRONIZAÇÃO AO VIVO de tudo que é definido por config/identidade. Pulso,
  // WebSocket e foco chamam isto; cobre, SEM reload, em TODOS os logins:
  //   • cargo/status do próprio usuário (re-hidrata a identidade)
  //   • matriz de permissões por papel (quais abas o cargo vê/usa)
  //   • nomes/renomeações de itens do menu (config-menu)
  // e re-aplica a barra lateral. Throttle 5s (config muda pouco). v81.31
  let _lastPermApply = 0, _permsSig = null;
  window.__psmApplyPerms = (force) => {
    const now = Date.now();
    if (!force && now - _lastPermApply < 5000) return;
    _lastPermApply = now;
    (async () => {
      try { const fresh = await auth.hydrate(); if (fresh) Object.assign(user, fresh); } catch (_) {}
      try { await loadRolePerms(); } catch (_) {}
      try { await loadFrentes(true); applyFrentesPausadas(); } catch (_) {}
      // Carrega rótulos + ORGANIZAÇÃO do menu (global) ANTES da assinatura — assim a
      // mudança de layout (Editor de Menu) também entra na detecção. v81.60
      let layoutSig = '';
      try { await loadMenuLabels(); } catch (_) {}
      try { const lay = await loadMenuLayout(); layoutSig = JSON.stringify(lay || ''); } catch (_) {}
      // À PROVA DE FALHA: se a permissão EFETIVA deste usuário OU a organização do
      // menu mudou, faz um RELOAD limpo — garante o menu 100% certo, imune a
      // qualquer detalhe de re-render ao vivo (applyMenuLayout usa o DOM já mexido). v81.32/81.60
      try {
        const role = (user.role || '').toLowerCase();
        const sig = JSON.stringify([role, user.lvl, user.menu_groups || null, _rolePerms[role] || null, layoutSig]);
        if (_permsSig !== null && sig !== _permsSig) { location.reload(); return; }
        _permsSig = sig;
      } catch (_) {}
      try { applyPermissions(user); } catch (_) {}
    })();
  };

  checkVersion();
  // ⚡ Checa versão a cada 20s: assim que um deploy sai, TODOS os logins detectam e
  // são FORÇADOS a recarregar juntos — sem depender de foco/navegação/clique. v81.33
  setInterval(() => { if (!_verWarned) checkVersion(); }, 20000);
  // ⚡ PERMISSÕES EM TEMPO REAL (v81.58): a cada 15s re-busca a matriz por papel e,
  // se a permissão EFETIVA deste login mudou (o sócio liberou/tirou uma aba), recarrega
  // com o menu certo — MESMO parado na tela, sem trocar de aba nem recarregar na mão.
  setInterval(() => { try { window.__psmApplyPerms(); } catch (_) {} }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!_verWarned) checkVersion();
    window.__psmApplyPerms(true);   // re-aplica perms do menu ao focar (force)
    // ⚡ TEMPO REAL: ao focar a aba (trocou de device, desbloqueou o cel), atualiza
    // a página atual + sino + recados na hora — todo login vê o estado mais novo. v81.26
    try { router.refresh(); } catch (_) {}
    try { refreshNotifs(); } catch (_) {}
    try { reloadTimeline(); } catch (_) {}
  });
  document.getElementById('app-ver')?.addEventListener('click', () => checkVersion(true));

  // ⚡ TEMPO REAL (contínuo): o pulso pergunta ao backend a cada ~12s "mudou algo?"
  // e re-renderiza a página atual em silêncio SÓ quando algo realmente mudou
  // (tarefa, recado, venda, config, notificação…) — em qualquer login/device. v81.27
  initPulse();
  // ⚡⚡ PUSH <1s: WebSocket (Supabase Realtime). Só ativa se a SUPABASE_ANON_KEY
  // estiver configurada no Vercel; senão segue no pulso. v81.29
  initRealtime();
})();

// ─── Shell ─────────────────────────────────────────────────────────────
function shellHTML(user) {
  const ini = (user.ini || (user.name || '?').substring(0, 2)).toUpperCase();
  return `
    <div class="app-shell">
      <aside class="app-sidebar">
        <div class="sb-brand">House <span style="color:var(--psm-gold)">PSM</span></div>

        <div class="sb-sec">🏠 Início</div>
        <button class="sb-link on" data-nav="/"><span class="sb-ico">📊</span> Dashboard</button>
        <button class="sb-link" data-nav="/painel"><span class="sb-ico">👤</span> Meu Painel</button>
        <button class="sb-link" data-nav="/checkin"><span class="sb-ico">📍</span> Check-in</button>
        <button class="sb-link" data-nav="/ranking"><span class="sb-ico">🏆</span> Ranking</button>
        <button class="sb-link" data-nav="/one-on-one"><span class="sb-ico">👥</span> One-on-One</button>
        <button class="sb-link" data-nav="/manual"><span class="sb-ico">📖</span> Manual Cultura</button>
        <button class="sb-link" data-nav="/etica"><span class="sb-ico">⚖️</span> Código de Ética</button>
        <button class="sb-link" data-nav="/canal"><span class="sb-ico">🔒</span> Canal Anônimo</button>
        <button class="sb-link" data-nav="/premiacoes"><span class="sb-ico">🏆</span> Premiações</button>

        <div class="sb-sec">🏘 Imóveis & Vendas</div>
        <button class="sb-link" data-nav="/crm"><span class="sb-ico">🔗</span> CRM (RD)</button>
        <button class="sb-link" data-nav="/oportunidades"><span class="sb-ico">💡</span> Oportunidades</button>
        <button class="sb-link" data-nav="/scripts"><span class="sb-ico">📚</span> Scripts & Cadências</button>
        <button class="sb-link" data-nav="/fichas"><span class="sb-ico">📋</span> Fichas/Propostas</button>
        <button class="sb-link" data-nav="/mapa"><span class="sb-ico">🗺</span> Mapa Imóveis</button>
        <button class="sb-link" data-nav="/tabela-conquista"><span class="sb-ico">🏆</span> Tabela Lançamentos Conquista</button>
        <button class="sb-link" data-nav="/tabela-map"><span class="sb-ico">🗺</span> Tabela Lançamentos MAP</button>
        <button class="sb-link" data-nav="/lancamentos"><span class="sb-ico">🏗</span> Lançamentos</button>
        <button class="sb-link" data-nav="/metas"><span class="sb-ico">🎯</span> Metas</button>
        <button class="sb-link" data-nav="/equipe"><span class="sb-ico">🛡</span> Equipes</button>
        <button class="sb-link" data-nav="/plantoes"><span class="sb-ico">🛡</span> Plantões</button>
        <button class="sb-link" data-nav="/sim-vpl"><span class="sb-ico">🧮</span> Simulador VPL</button>
        <button class="sb-link" data-nav="/sim-incc"><span class="sb-ico">📈</span> Simulador INCC</button>
        <button class="sb-link" data-nav="/sim-repasse"><span class="sb-ico">🔁</span> Simulador Repasse</button>
        <button class="sb-link" data-nav="/sim-energia"><span class="sb-ico">⚡</span> Simulador Energia</button>
        <button class="sb-link" data-nav="/sim-amortizacao"><span class="sb-ico">🏦</span> Simulador de Amortização</button>
        <button class="sb-link" data-nav="/cockpit-conquista"><span class="sb-ico">🚀</span> Cockpit Conquista</button>
        <button class="sb-link" data-nav="/sim-conquista"><span class="sb-ico">🏠</span> Simulador Conquista</button>
        <button class="sb-link" data-nav="/meu-cerebro"><span class="sb-ico">🎯</span> Meu Cérebro de Vendas</button>
        <button class="sb-link" data-nav="/minha-comissao"><span class="sb-ico">💰</span> Minha Comissão</button>

        <div class="sb-sec">🔥 Arena & Performance</div>
        <button class="sb-link" data-nav="/tv"><span class="sb-ico">📺</span> Modo TV</button>
        <button class="sb-link" data-nav="/war-room"><span class="sb-ico">⚔️</span> War Room</button>
        <button class="sb-link" data-nav="/war-arena"><span class="sb-ico">🔥</span> War Arena</button>

        <div class="sb-sec">🎓 PSM Academy</div>
        <button class="sb-link" data-nav="/academy-studio"><span class="sb-ico">🎬</span> Academy · Produção</button>
        <button class="sb-link" data-nav="/academy"><span class="sb-ico">🎓</span> PSM Academy (aulas)</button>
        <button class="sb-link" data-nav="/formacao"><span class="sb-ico">🎓</span> Formação PSM</button>

        <div class="sb-sec">🧮 Ferramentas</div>
        <button class="sb-link" data-nav="/simuladores"><span class="sb-ico">🧮</span> Simuladores</button>

        <div class="sb-sec">🗂 Secretaria de Vendas & Backoffice</div>
        <button class="sb-link" data-nav="/sdr"><span class="sb-ico">📞</span> Prospecção SDR</button>
        <button class="sb-link" data-nav="/reativacao"><span class="sb-ico">🔁</span> Reativação MAP</button>
        <button class="sb-link" data-nav="/captacoes"><span class="sb-ico">📥</span> Captações</button>
        <button class="sb-link" data-nav="/links-uteis"><span class="sb-ico">🔗</span> Links úteis</button>
        <button class="sb-link" data-nav="/sac-incorporadoras"><span class="sb-ico">📞</span> SAC Incorporadoras</button>
        <button class="sb-link" data-nav="/sistemas-incorporadoras"><span class="sb-ico">🏢</span> Sistema e Drive Incorporadoras</button>
        <button class="sb-link" data-nav="/campanha-wa"><span class="sb-ico">📣</span> Campanha WhatsApp</button>

        <div class="sb-sec">🗄 Backoffice & Adm</div>
        <button class="sb-link" data-nav="/compras"><span class="sb-ico">🛒</span> Compras</button>
        <button class="sb-link" data-nav="/patrimonio"><span class="sb-ico">🏢</span> Patrimônio</button>
        <button class="sb-link" data-nav="/manutencoes"><span class="sb-ico">🛠</span> Manutenções</button>

        <div class="sb-sec">🧑‍💼 Gestão de Pessoas & RH</div>
        <button class="sb-link" data-nav="/rh-treinamentos"><span class="sb-ico">🎓</span> Treinamentos</button>
        <button class="sb-link" data-nav="/onboarding"><span class="sb-ico">🚀</span> Onboarding</button>
        <button class="sb-link" data-nav="/offboarding"><span class="sb-ico">👋</span> Offboarding</button>
        <button class="sb-link" data-nav="/rh-recrutamento"><span class="sb-ico">🧲</span> Recrutamento & Seleção</button>
        <button class="sb-link" data-nav="/rh-plano"><span class="sb-ico">📈</span> Plano de Crescimento</button>
        <button class="sb-link" data-nav="/rh-clima"><span class="sb-ico">🌡</span> Clima Interno</button>
        <button class="sb-link" data-nav="/rh-avaliacoes"><span class="sb-ico">⭐</span> Avaliações & Feedbacks</button>
        <button class="sb-link" data-nav="/rh-funcoes"><span class="sb-ico">🗂</span> Funções & Organograma</button>

        <div class="sb-sec">🤝 Sucesso do Cliente</div>
        <button class="sb-link" data-nav="/cs-onboarding"><span class="sb-ico">🚀</span> Onboarding do Cliente</button>
        <button class="sb-link" data-nav="/cs-carteira"><span class="sb-ico">💼</span> Gestão de Carteira</button>
        <button class="sb-link" data-nav="/cs-suporte"><span class="sb-ico">📞</span> Relacionamento & Suporte</button>
        <button class="sb-link" data-nav="/cs-retencao"><span class="sb-ico">🔄</span> Retenção & Renovação</button>
        <button class="sb-link" data-nav="/cs-metricas"><span class="sb-ico">📊</span> Métricas de Sucesso</button>
        <button class="sb-link" data-nav="/cs-upsell"><span class="sb-ico">📈</span> Upsell & Cross-sell</button>
        <button class="sb-link" data-nav="/cs-marketing"><span class="sb-ico">⭐</span> Customer Marketing</button>
        <button class="sb-link" data-nav="/cs-avaliacoes"><span class="sb-ico">🌟</span> Avaliações de Atendimento</button>
        <button class="sb-link" data-nav="/cs-indicacoes"><span class="sb-ico">🎁</span> Programa de Indicações</button>

        <div class="sb-sec">📣 Marketing</div>
        <button class="sb-link" data-nav="/marketing"><span class="sb-ico">📢</span> Marketing (Meta)</button>
        <button class="sb-link" data-nav="/criativos"><span class="sb-ico">🎨</span> Solicitações de Criativos</button>
        <button class="sb-link" data-nav="/criativos-download"><span class="sb-ico">⬇️</span> Criativos para Download</button>
        <button class="sb-link" data-nav="/paulo-conteudo"><span class="sb-ico">🎬</span> Paulo Morimatsu</button>
        <button class="sb-link" data-nav="/conteudo-imoveis"><span class="sb-ico">🏠</span> PSM Imóveis (conteúdo)</button>
        <button class="sb-link" data-nav="/conteudo-conquista"><span class="sb-ico">🏆</span> PSM Conquista (conteúdo)</button>
        <button class="sb-link" data-nav="/marketing-historico"><span class="sb-ico">📅</span> Histórico Meta</button>
        <button class="sb-link" data-nav="/biblioteca-ads"><span class="sb-ico">📣</span> Biblioteca de Anúncios</button>
        <button class="sb-link" data-nav="/anuncios-concorrentes"><span class="sb-ico">📡</span> Anúncios dos Concorrentes</button>
        <button class="sb-link" data-nav="/intel-ads"><span class="sb-ico">🎯</span> Intel Ads</button>
        <button class="sb-link" data-nav="/sim-leads"><span class="sb-ico">📈</span> Simulador Leads/CAC</button>
        <button class="sb-link" data-nav="/sim-criativos"><span class="sb-ico">🎨</span> Simulador Criativos</button>

        <div class="sb-sec">🏛 Diretoria</div>
        <div class="sb-subsec" style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;opacity:.45;font-weight:800;padding:6px 14px 2px">Decisão</div>
        <button class="sb-link" data-nav="/cockpit"><span class="sb-ico">🧭</span> Cockpit de Decisão</button>
        <button class="sb-link" data-nav="/diretoria"><span class="sb-ico">📊</span> Dashboard</button>
        <button class="sb-link" data-nav="/paulo"><span class="sb-ico">🧑‍💼</span> Paulo</button>
        <button class="sb-link" data-nav="/relatorios"><span class="sb-ico">🖨</span> Relatórios</button>
        <button class="sb-link" data-nav="/psmhub"><span class="sb-ico">🔌</span> PSM HUB · Conquista</button>
        <div class="sb-subsec" style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;opacity:.45;font-weight:800;padding:6px 14px 2px">Planejamento</div>
        <button class="sb-link" data-nav="/projetos"><span class="sb-ico">📌</span> Projetos</button>
        <button class="sb-link" data-nav="/estrategia"><span class="sb-ico">♟️</span> Estratégia</button>
        <button class="sb-link" data-nav="/metricas-viab"><span class="sb-ico">🧪</span> Métricas Viab</button>
        <button class="sb-link" data-nav="/sim-trafego"><span class="sb-ico">📣</span> Simulador de Tráfego</button>
        <button class="sb-link" data-nav="/bp"><span class="sb-ico">📋</span> Plano BP</button>
        <button class="sb-link" data-nav="/reunioes"><span class="sb-ico">🤝</span> Formatos de Reunião</button>
        <div class="sb-subsec" style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;opacity:.45;font-weight:800;padding:6px 14px 2px">Governança</div>
        <button class="sb-link" data-nav="/governanca"><span class="sb-ico">⚖️</span> Governança</button>

        <div class="sb-sec">🧠 Inteligência</div>
        <button class="sb-link" data-nav="/inteligencia"><span class="sb-ico">🧠</span> Centro de Inteligência</button>
        <button class="sb-link" data-nav="/dados-mercado"><span class="sb-ico">📈</span> Dados de Mercado</button>
        <button class="sb-link" data-nav="/cerebro-vendas"><span class="sb-ico">🎯</span> Cérebro de Vendas</button>
        <button class="sb-link" data-nav="/briefing-guerra"><span class="sb-ico">⚔️</span> Briefing de Guerra</button>
        <button class="sb-link" data-nav="/concorrencia"><span class="sb-ico">🥊</span> Concorrência</button>
        <button class="sb-link" data-nav="/benchmark"><span class="sb-ico">📊</span> Benchmark</button>

        <button class="sb-link" data-nav="/tendencias"><span class="sb-ico">📉</span> Tendências</button>

        <div class="sb-sec">🔑 Locação</div>
        <button class="sb-link" data-nav="/locacoes"><span class="sb-ico">🔑</span> Locações</button>
        <button class="sb-link" data-nav="/minutas-locacao"><span class="sb-ico">📑</span> Minutas e Fichas · Locação</button>

        <div class="sb-sec">💰 Financeiro</div>
        <button class="sb-link" data-nav="/financeiro"><span class="sb-ico">💰</span> Financeiro</button>
        <button class="sb-link" data-nav="/forecast"><span class="sb-ico">📈</span> Forecast</button>

        <div class="sb-sec">⚖️ Jurídico</div>
        <button class="sb-link" data-nav="/minutas"><span class="sb-ico">📜</span> Minutas padrão</button>
        <button class="sb-link" data-nav="/cnds"><span class="sb-ico">⚖️</span> CND's</button>

        <div class="sb-sec">🤖 IA Assistentes</div>
        <button class="sb-link" data-nav="/agentes"><span class="sb-ico">🧠</span> Central Agentes</button>
        <button class="sb-link" data-nav="/ia"><span class="sb-ico">🤖</span> Chat IAs</button>
        <button class="sb-link" data-nav="/sr-performance"><span class="sb-ico">🎖️</span> Sr. Performance</button>
        <button class="sb-link" data-nav="/sr-gerencia"><span class="sb-ico">👔</span> Sr. Gerência</button>

        <div class="sb-sec">⚙️ Sistema</div>
        <button class="sb-link" data-nav="/usuarios"><span class="sb-ico">👥</span> Usuários</button>
        <button class="sb-link" data-nav="/auditoria"><span class="sb-ico">📜</span> Auditoria</button>
        <button class="sb-link" data-nav="/integracoes"><span class="sb-ico">🔌</span> Integrações</button>
        <button class="sb-link" data-nav="/backup"><span class="sb-ico">💾</span> Backup</button>
        <button class="sb-link" data-nav="/configuracoes"><span class="sb-ico">🔧</span> Configurações</button>
        <button class="sb-link" data-nav="/config-menu"><span class="sb-ico">✏️</span> Editor de Menu</button>
        <button class="sb-link" data-nav="/logins"><span class="sb-ico">🔐</span> Logins e Senhas</button>
        <button class="sb-link" data-nav="/qualidade"><span class="sb-ico">🧹</span> Qualidade dos Dados</button>

        <div class="sb-sec">👤 Conta</div>
        <button class="sb-link" data-nav="/conta"><span class="sb-ico">⚙️</span> Minha conta</button>

        <div id="app-ver" title="Clique para checar atualizações" style="margin-top:auto;padding:12px 0;font-size:10px;opacity:0.55;cursor:pointer">House PSM · v${APP_VERSION}</div>
      </aside>
      <header class="app-header">
        <button class="h-hamburger" id="btn-hamburger" title="Menu">☰</button>
        <div class="h-title" id="h-title">Dashboard</div>
        <div class="h-spacer"></div>
        <div class="h-user">
          <button class="btn btn-ghost" id="btn-search" style="padding:6px 10px" title="Buscar (Cmd/Ctrl+K)">🔎</button>
          <button class="btn btn-ghost" id="btn-health" style="position:relative;padding:6px 10px" title="Saúde do sistema">
            <span id="health-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#94a3b8;vertical-align:middle"></span>
          </button>
          <button class="btn btn-ghost" id="btn-sons" style="padding:6px 10px" title="Sons">🔊</button>
          <button class="btn btn-ghost" id="btn-notif" style="position:relative;padding:6px 10px" title="Notificações">
            🔔
            <span id="notif-badge" style="display:none;position:absolute;top:-2px;right:-2px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;border-radius:9px;padding:0 5px;min-width:16px;height:16px;line-height:16px;text-align:center"></span>
          </button>
          <button class="btn btn-ghost" id="btn-push" style="display:none;padding:6px 10px" title="Ativar notificações no celular e navegador">📲</button>
          <span>${escapeHtml(user.name || 'Usuário')}</span>
          <div class="h-avatar">${escapeHtml(ini)}</div>
          <button class="btn btn-ghost" id="btn-logout">Sair</button>
        </div>
      </header>
      <div class="sidebar-backdrop" id="sb-backdrop"></div>
      <main class="app-main" id="app-main"><div id="timeline-bar" style="display:none"></div><div id="route-mount"></div></main>
    </div>
  `;
}

// ─── Páginas ───────────────────────────────────────────────────────────
async function pageDashboard(ctx, root) {
  setHeader('Dashboard');
  const user = auth.user();
  let health = null;
  try { health = await api.health(); } catch (e) { health = { ok: false, error: e.message }; }
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👋 Bem-vindo, ${escapeHtml(user.name || '')}</h2>
      <p class="card-sub">Bem-vindo ao <strong>House PSM</strong> — sistema de gestão imobiliária PSM.</p>
      <div class="flex gap-3 mt-4">
        <div class="card" style="flex:1">
          <div class="muted tiny">USUÁRIO</div>
          <div style="font-size:var(--fs-xl);font-weight:800">${escapeHtml(user.name || '—')}</div>
          <div class="tiny muted">${escapeHtml(user.role || '')} · L${user.lvl || '?'}</div>
        </div>
        <div class="card" style="flex:1">
          <div class="muted tiny">EQUIPE</div>
          <div style="font-size:var(--fs-xl);font-weight:800">${escapeHtml(user.team || user.frente || 'Geral')}</div>
          <div class="tiny muted">${user.is_lider ? '🛡 Líder' : ''} ${user.is_diretor ? '👑 Diretor' : ''}</div>
        </div>
        <div class="card" style="flex:1">
          <div class="muted tiny">BACKEND</div>
          <div style="font-size:var(--fs-xl);font-weight:800;color:${health.ok ? 'var(--ok)' : 'var(--err)'}">
            ${health.ok ? '✓ Operacional' : '✗ Erro'}
          </div>
          <div class="tiny muted">${escapeHtml(health.version || health.error || '')}</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">🚀 Roadmap Sprint 7</h3>
      <ul style="line-height:1.7;font-size:var(--fs-sm)">
        <li><b>✓ 7.0</b> — Backend auth (bcrypt + JWT) <span class="muted">→ /api/v3/auth/*</span></li>
        <li><b>✓ 7.1</b> — Shell frontend modular <span class="muted">→ /v2/</span></li>
        <li><b>7.2</b> — Migrar tela Usuários (CRUD completo)</li>
        <li><b>7.3</b> — Migrar Dashboard + Painel do Corretor</li>
        <li><b>7.4</b> — Migrar CRM + Financeiro</li>
        <li><b>7.5</b> — Cutover: /v1 (index.html) → modo legacy/readonly</li>
      </ul>
    </div>
  `;
}

async function pageUsuarios(ctx, root) {
  setHeader('Usuários');
  highlight('/usuarios');
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando usuários…</div></div>';
  let users = [];
  try {
    const r = await api.listUsers();
    users = r.users || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro ao carregar usuários: ${escapeHtml(e.message)}</div>`;
    return;
  }
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👥 Usuários <span class="muted tiny" style="font-weight:400">${users.length} cadastrados</span></h2>
      <p class="card-sub">Lista vinda do Postgres (fonte da verdade). Edição completa nas próximas sprints.</p>
      <div style="display:grid;grid-template-columns:1fr;gap:8px">
        ${users.map(u => userCard(u)).join('')}
      </div>
    </div>
  `;
}

function userCard(u) {
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const color = u.color || '#64748b';
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-3);border-radius:var(--r-md)">
      <div style="width:36px;height:36px;border-radius:var(--r-sm);background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px">${ini}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${escapeHtml(u.name || '—')}</div>
        <div class="tiny muted">${escapeHtml(u.email || 'sem email')} · ${escapeHtml(u.role || '—')} · ${escapeHtml(u.team || u.frente || 'geral')}</div>
      </div>
      <div class="tiny muted">L${u.lvl || '?'}</div>
    </div>
  `;
}

async function pageConta(ctx, root) {
  setHeader('Minha conta');
  highlight('/conta');
  // Funções & Tarefas saíram daqui (v81.95) → agora ficam em RH → Funções & Organograma.
  renderContaInfo(root, auth.user());
}

function renderContaInfo(body, user) {
  body.innerHTML = `
    <div class="card">
      <h2 class="card-title">⚙️ Minha conta</h2>
      <div class="field">
        <label>Nome</label>
        <input class="input" value="${escapeHtml(user.name || '')}" disabled>
      </div>
      <div class="field">
        <label>Email</label>
        <input class="input" value="${escapeHtml(user.email || '')}" disabled>
      </div>
      <div class="field">
        <label>Papel</label>
        <input class="input" value="${escapeHtml(user.role || '')} · L${user.lvl}" disabled>
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">🔐 Trocar senha</h3>
      <p class="card-sub">Nova senha deve ter pelo menos 6 caracteres.</p>
      <div class="field">
        <label>Nova senha</label>
        <input class="input" type="password" id="new-pwd" autocomplete="new-password">
      </div>
      <div class="field">
        <label>Confirmar</label>
        <input class="input" type="password" id="new-pwd-2" autocomplete="new-password">
      </div>
      <div id="pwd-msg"></div>
      <button class="btn btn-primary mt-3" id="btn-save-pwd">Salvar nova senha</button>
    </div>
  `;
  document.getElementById('btn-save-pwd').addEventListener('click', async () => {
    const a = document.getElementById('new-pwd').value;
    const b = document.getElementById('new-pwd-2').value;
    const msg = document.getElementById('pwd-msg');
    msg.innerHTML = '';
    if (a.length < 6) { msg.innerHTML = '<div class="alert alert-err">Senha precisa ≥ 6 caracteres.</div>'; return; }
    if (a !== b) { msg.innerHTML = '<div class="alert alert-err">Senhas não conferem.</div>'; return; }
    try {
      await api.setPassword(user.id, a);
      msg.innerHTML = '<div class="alert alert-ok">Senha atualizada com sucesso.</div>';
    } catch (e) {
      msg.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
    }
  });
}

async function page404(ctx, root) {
  setHeader('404');
  root.innerHTML = `<div class="card"><h2 class="card-title">404</h2><p class="muted">Rota não encontrada: ${escapeHtml(ctx.path)}</p></div>`;
}

// ─── Helpers ───────────────────────────────────────────────────────────
function setHeader(t) { const el = document.getElementById('h-title'); if (el) el.textContent = t; }

// ─── Atualização do app (saber/forçar a versão mais nova) ────────────────
// Compara APP_VERSION (versão do código rodando) com /version.json (versão no ar).
// Diferente = a aba está com JS antigo → mostra faixa "Atualizar agora" (1 clique
// limpa cache + recarrega). Pega tanto aba aberta antes do deploy quanto JS em cache.
let _verWarned = false, _updatePending = null;

function showUpdateBanner(newVer) {
  if (document.getElementById('upd-modal')) return;
  if (!document.getElementById('updpop-css')) {
    const s = document.createElement('style'); s.id = 'updpop-css';
    s.textContent = '@keyframes updpop{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}@keyframes updfade{from{opacity:0}to{opacity:1}}';
    document.head.appendChild(s);
  }
  const o = document.createElement('div');
  o.id = 'upd-modal';
  o.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.74);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;animation:updfade .2s ease';
  o.innerHTML = `
    <div role="alertdialog" aria-modal="true" style="background:#fff;color:#0f172a;max-width:430px;width:100%;border-radius:20px;padding:32px 26px;text-align:center;box-shadow:0 26px 70px rgba(0,0,0,.45);animation:updpop .26s ease">
      <div style="font-size:50px;line-height:1">🔄</div>
      <h2 style="margin:12px 0 8px;font-size:21px;font-weight:800">Nova versão disponível!</h2>
      <p style="margin:0 0 6px;font-size:14.5px;color:#475569;line-height:1.5">Você está em uma versão <b>desatualizada</b> do sistema${newVer ? ` (a nova é a <b>v${newVer}</b>)` : ''}.</p>
      <p style="margin:0 0 22px;font-size:14.5px;color:#475569;line-height:1.5">Recarregue a página pra ver as novidades — ou saia e entre de novo.</p>
      <button id="upd-go" style="width:100%;background:var(--psm-gold,#d4af37);color:#0f172a;border:0;border-radius:13px;padding:15px;font-size:16px;font-weight:800;cursor:pointer">🔄 Atualizar agora</button>
      <button id="upd-x" style="margin-top:12px;background:transparent;border:0;color:#94a3b8;font-size:13px;cursor:pointer">Agora não</button>
    </div>`;
  document.body.appendChild(o);
  document.getElementById('upd-go').onclick = doUpdate;
  document.getElementById('upd-x').onclick = () => o.remove();
}

async function doUpdate() {
  if (window.__psmUpdating) return; window.__psmUpdating = true;
  const go = document.getElementById('upd-go');
  if (go) { go.textContent = 'Atualizando…'; go.disabled = true; }
  try {
    if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
    if (navigator.serviceWorker) { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.update().catch(() => {}))); }
  } catch (_) {}
  // bypassa cache HTTP do documento
  try { location.reload(true); } catch (_) { location.reload(); }
}

// ⚡ ATUALIZAÇÃO FORÇADA: saiu versão nova → TODOS os logins recarregam sozinhos (sem
// modal, sem clicar, sem navegar). Só espera o usuário parar de digitar pra não perder
// texto de formulário — e mesmo assim força em no máximo ~60s. v81.33
let _forceTries = 0;
function forceUpdateSoon() {
  if (window.__psmUpdating || window.__psmForcing) return;
  window.__psmForcing = true;
  const tryNow = () => {
    const el = document.activeElement;
    const typing = !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes((el.tagName || '').toUpperCase()) || el.isContentEditable === true);
    if (typing && _forceTries < 15) { _forceTries++; setTimeout(tryNow, 4000); return; }
    doUpdate();
  };
  setTimeout(tryNow, 1500);
}

async function checkVersion(announce) {
  try {
    const v = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    if (v && v.version && v.version !== APP_VERSION) {
      _verWarned = true;
      _updatePending = v.version;
      try { window.__psmUpdateReady = true; window.__psmDoUpdate = doUpdate; } catch (_) {}
      showUpdateBanner(v.version);   // mostra "Atualizando…" (informativo)
      forceUpdateSoon();             // ⚡ FORÇA o reload em TODOS os logins — não depende de clique/navegação. v81.33
      return false;
    }
    if (announce) alert('✅ Tudo certo! Você está na versão mais recente (v' + APP_VERSION + ').');
    return true;
  } catch (_) {
    if (announce) alert('Não consegui checar agora. Tente de novo em instantes.');
    return null;
  }
}

// Atualiza SOZINHO na próxima troca de tela (fronteira segura: navegar já descarta o
// estado da página, então não perde nada que o usuário esteja digitando). Trava por
// sessão+versão evita loop de reload se o CDN ainda estiver propagando. Assim, mesmo
// quem não clicar na faixa entra na versão nova ao abrir qualquer aba — ninguém fica atrás.
let _autoUpdHooked = false;
function maybeAutoUpdate() {
  if (_autoUpdHooked || !_updatePending) return;
  _autoUpdHooked = true;
  const target = _updatePending;
  const handler = () => {
    if (!_updatePending) return;
    if (sessionStorage.getItem('psm.autoupd') === target) return;  // já tentou p/ essa versão → não repete
    sessionStorage.setItem('psm.autoupd', target);
    window.removeEventListener('hashchange', handler);
    doUpdate();
  };
  window.addEventListener('hashchange', handler);
}

// ─── Indicador de saúde do sistema (menu principal) ──────────────────────
let _healthTimer = null, _bootVer = null, _healthData = null;

async function initSystemHealth() {
  try {
    const v = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    _bootVer = v.version;
  } catch (_) {}
  document.getElementById('btn-health')?.addEventListener('click', toggleHealthPanel);
  await pollHealth();
  if (_healthTimer) clearInterval(_healthTimer);
  _healthTimer = setInterval(pollHealth, 90000);
}

async function pollHealth() {
  let issues = [], status = 'ok';
  try {
    const h = await api.request('/api/v3/system_health');
    issues = h.issues || [];
    status = h.status || 'ok';
  } catch (e) {
    issues = [{ area: 'rede', severity: 'error', message: 'Não consegui checar a saúde do sistema: ' + e.message }];
    status = 'error';
  }
  // Sentinela de consistência (auditoria SI1): pra diretoria (lvl>=7), os checks de
  // "os números batem entre as fontes?" entram no MESMO aviso de saúde. v84.1
  try {
    if ((auth.user()?.lvl || 0) >= 7) {
      const c = await api.request('/api/v3/system/consistency');
      for (const ck of (c.checks || [])) {
        if (!ck.ok) {
          issues.push({ area: 'consistência', severity: ck.sev === 'err' ? 'error' : 'warn', message: ck.msg });
          if (status === 'ok') status = ck.sev === 'err' ? 'error' : 'warn';
          else if (status === 'warn' && ck.sev === 'err') status = 'error';
        }
      }
    }
  } catch (_) {}
  // Desatualização do cliente (tab antiga aberta após deploy)
  try {
    const v = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    if (v.version && v.version !== APP_VERSION) {
      issues = [{ area: 'app', severity: 'warn', message: `Nova versão ${v.version} disponível — clique em “Atualizar agora”.` }, ...issues];
      if (status === 'ok') status = 'warn';
      showUpdateBanner(v.version);
    }
  } catch (_) {}
  _healthData = { status, issues };
  renderHealthDot(status, issues.length);
  const panel = document.getElementById('health-panel');
  if (panel && panel.style.display !== 'none') renderHealthPanel();
}

function renderHealthDot(status, count) {
  const dot = document.getElementById('health-dot');
  if (!dot) return;
  const color = status === 'error' ? '#dc2626' : status === 'warn' ? '#d97706' : '#16a34a';
  dot.style.background = color;
  dot.style.boxShadow = status === 'ok' ? 'none' : `0 0 0 3px ${color}33`;
  const btn = document.getElementById('btn-health');
  if (btn) btn.title = status === 'ok' ? 'Sistema OK' : `${count} aviso(s) do sistema`;
}

function toggleHealthPanel() {
  const panel = document.getElementById('health-panel');
  if (panel && panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  renderHealthPanel();
}

function renderHealthPanel() {
  let panel = document.getElementById('health-panel');
  if (!panel) { panel = document.createElement('div'); panel.id = 'health-panel'; document.body.appendChild(panel); }
  const d = _healthData || { status: 'ok', issues: [] };
  const head = d.status === 'error' ? '🔴 Problemas no sistema'
    : d.status === 'warn' ? '🟡 Avisos do sistema' : '🟢 Tudo funcionando';
  panel.style.cssText = 'position:fixed;top:56px;right:12px;z-index:10000;background:var(--bg-2,#fff);color:var(--ink,#111);border:1px solid var(--border,#e5e7eb);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.25);width:344px;max-width:92vw;max-height:72vh;overflow:auto;padding:14px';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <strong style="font-size:14px">${head}</strong>
      <button id="health-close" style="border:none;background:transparent;cursor:pointer;font-size:16px;line-height:1">✕</button>
    </div>
    ${d.issues.length === 0
      ? '<div style="font-size:13px;color:#16a34a">Nenhuma falha detectada. Integrações e dados em dia.</div>'
      : d.issues.map(i => {
          const c = i.severity === 'error' ? '#dc2626' : '#d97706';
          const ico = i.severity === 'error' ? '🔴' : '⚠️';
          return `<div style="display:flex;gap:8px;padding:8px;border-left:3px solid ${c};background:${c}14;border-radius:6px;margin-bottom:6px;font-size:12.5px">
            <span>${ico}</span><div><strong style="text-transform:uppercase;font-size:10px;color:${c}">${escapeHtml(i.area)}</strong><br>${escapeHtml(i.message)}</div></div>`;
        }).join('')}
    <div style="margin-top:8px;font-size:10px;opacity:0.5">Atualiza a cada 90s · clique no ponto pra abrir/fechar</div>
  `;
  panel.style.display = 'block';
  document.getElementById('health-close')?.addEventListener('click', () => { panel.style.display = 'none'; });
}
function highlight(path) {
  document.querySelectorAll('.sb-link').forEach(b => b.classList.remove('on'));
  const cur = document.querySelector('[data-nav="' + path + '"]');
  if (cur) cur.classList.add('on');
  applyHeaderOverride(path);  // título do topo herda o nome custom da rota (se houver)
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
