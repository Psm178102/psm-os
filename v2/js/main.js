/* ============================================================================
   PSM-OS v2 — Main entry (ES module)
============================================================================ */
import { auth } from './auth.js';
import { router } from './router.js';
import { api } from './api.js';
import { initPush, enablePush, pushSupported, pushPermission } from './push.js';
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
import { pageEstrategia } from './pages/estrategia.js';
import { pageAcademy } from './pages/academy.js';
import { initNotifs } from './notifs.js';
import { sounds } from './sounds.js';
import { pageConfiguracoes } from './pages/configuracoes.js';
import { pageMarketing } from './pages/marketing.js';
import { pageIA } from './pages/ia.js';
import { pageLancamentos } from './pages/lancamentos.js';
import { pageLocacoes } from './pages/locacoes.js';
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
import { pageTabelaImoveis } from './pages/tabela-imoveis.js';
import { pageIntegracoes } from './pages/integracoes.js';
import { pageBackup } from './pages/backup.js';
import { pageRelatorios } from './pages/relatorios.js';
import { pageManual } from './pages/manual.js';
import { pageEtica } from './pages/etica.js';
import { pageCanal } from './pages/canal.js';
import { pageBase } from './pages/base.js';
import { pageFormacao } from './pages/formacao.js';
import { pageGestaoPessoas } from './pages/gestao-pessoas.js';
import { pagePremiacoes } from './pages/premiacoes.js';
import { pageAgentes } from './pages/agentes.js';
import { pageAgenteVera } from './pages/agente-vera.js';
import { pageAgenteSol } from './pages/agente-sol.js';
import { pageTendencias } from './pages/tendencias.js';
import { pageBenchmark } from './pages/benchmark.js';
import { pageIntelAds } from './pages/intel-ads.js';
import { pageIntelDash } from './pages/intel-dash.js';
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
import { pageFichasPropostas } from './pages/fichas-propostas.js';
import { pageSrGerencia } from './pages/sr-gerencia.js';
import { pageSrPerformance } from './pages/sr-performance.js';
import { pageMapa } from './pages/mapa.js';

// ─── Permissões por role (Sprint 9.6) ──────────────────────────────────
// Cada rota pertence a um GRUPO. Cada role enxerga só os grupos liberados.
// 'conta' e 'inicio' são sempre liberados pra qualquer login.
const ROUTE_GROUP = {
  // Início (sempre)
  '/': 'inicio', '/painel': 'inicio', '/checkin': 'inicio', '/ranking': 'inicio', '/agenda': 'inicio', '/tarefas': 'inicio',
  // Imóveis & Vendas (secretaria de vendas)
  '/crm': 'vendas', '/sdr': 'vendas', '/oportunidades': 'vendas', '/cadencia': 'vendas', '/fichas': 'vendas', '/campanha-wa': 'vendas',
  '/imoveis': 'vendas', '/mapa': 'vendas', '/tabela-imoveis': 'vendas', '/lancamentos': 'vendas',
  // Captações
  '/captacoes': 'captacoes',
  // Locação
  '/locacoes': 'locacao',
  // Financeiro
  '/financeiro': 'financeiro', '/forecast': 'financeiro',
  // Inteligência & Marketing
  '/marketing': 'marketing', '/concorrencia': 'marketing', '/benchmark': 'marketing',
  '/intel-ads': 'marketing', '/intel-dash': 'marketing', '/tendencias': 'marketing', '/inteligencia': 'marketing', '/biblioteca-ads': 'marketing', '/marketing-historico': 'marketing', '/cerebro-vendas': 'marketing', '/briefing-guerra': 'marketing',
  '/dados-mercado': 'diretoria',
  // Metas & Performance
  '/metas': 'performance', '/equipe': 'performance', '/organograma': 'performance',
  '/one-on-one': 'performance', '/plantoes': 'performance', '/arena': 'performance',
  '/tv': 'performance', '/war-room': 'performance', '/war-arena': 'performance',
  // Diretoria
  '/cockpit': 'diretoria',
  '/diretoria': 'diretoria', '/kpis': 'diretoria', '/okrs': 'diretoria',
  '/metricas-viab': 'diretoria', '/sim-trafego': 'diretoria', '/mapa-ciclos': 'diretoria', '/bp': 'diretoria', '/governanca': 'diretoria',
  '/pontos-atencao': 'diretoria', '/insights': 'diretoria', '/estrategia': 'diretoria',
  // IA
  '/agentes': 'ia', '/ia': 'ia', '/sr-performance': 'ia', '/sr-gerencia': 'ia',
  // Cultura & Pessoas
  '/base': 'cultura', '/manual': 'cultura', '/etica': 'cultura', '/canal': 'cultura',
  '/formacao': 'cultura', '/gestao-pessoas': 'cultura', '/premiacoes': 'cultura', '/academy': 'cultura',
  // Ferramentas
  '/simuladores': 'ferramentas', '/relatorios': 'ferramentas',
  // Sistema
  '/usuarios': 'sistema', '/auditoria': 'sistema', '/integracoes': 'sistema',
  '/backup': 'sistema', '/configuracoes': 'sistema',
  // Conta (sempre)
  '/conta': 'conta',
  // sub-rotas de simuladores herdam ferramentas
  '/sim-vpl': 'ferramentas', '/sim-incc': 'ferramentas', '/sim-repasse': 'ferramentas',
  '/sim-energia': 'ferramentas', '/sim-leads': 'ferramentas', '/sim-criativos': 'ferramentas',
  '/agente-vera': 'ia', '/agente-sol': 'ia',
};

// '*' = vê tudo. Senão, lista de grupos permitidos (inicio + conta sempre incluídos).
const ROLE_ALLOWED = {
  socio:      '*',
  diretor:    '*',
  gerente:    '*',
  // líder: toda a operação + performance da equipe, MAS sem Diretoria nem Sistema (admin)
  lider:      ['inicio', 'vendas', 'captacoes', 'locacao', 'marketing', 'performance', 'ia', 'cultura', 'ferramentas', 'conta'],
  marketing:  ['inicio', 'marketing', 'captacoes', 'cultura', 'conta'],
  backoffice: ['inicio', 'captacoes', 'vendas', 'locacao', 'cultura', 'conta'],
  financeiro: ['inicio', 'financeiro', 'cultura', 'conta'],
  corretor:   ['inicio', 'vendas', 'captacoes', 'locacao', 'performance', 'ia', 'cultura', 'ferramentas', 'conta'],
};

function _allowedGroups(user) {
  const role = (user?.role || 'corretor').toLowerCase();
  const lvl = user?.lvl || 0;
  if (lvl >= 7) return '*';  // sócio/diretor/gerente sempre tudo
  return ROLE_ALLOWED[role] || ROLE_ALLOWED.corretor;
}

function canSee(path, user) {
  const allowed = _allowedGroups(user);
  if (allowed === '*') return true;
  const base = (path || '/').split('?')[0];
  const grp = ROUTE_GROUP[base] || 'inicio';
  if (grp === 'inicio' || grp === 'conta') return true;
  return allowed.includes(grp);
}

function applyPermissions(user) {
  const allowed = _allowedGroups(user);
  if (allowed === '*') return;  // vê tudo, não filtra
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
  applyPermissions(user);
  router.setGuard((path) => canSee(path, user));

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
  router.register('/estrategia', { render: async (ctx, root) => { setHeader('Estratégia'); highlight('/estrategia'); await pageEstrategia(ctx, root); } });
  // v77.30: absorvidas pelo Cockpit Hub — redirects preservam links/hábito antigos
  router.register('/pontos-atencao', { render: async () => { location.hash = '#/cockpit?tab=atencao'; } });
  router.register('/insights', { render: async () => { location.hash = '#/cockpit?tab=insights'; } });
  router.register('/academy', { render: async (ctx, root) => { setHeader('PSM Academy'); highlight('/academy'); await pageAcademy(ctx, root); } });
  router.register('/marketing', { render: async (ctx, root) => { setHeader('Marketing'); highlight('/marketing'); await pageMarketing(ctx, root); } });
  router.register('/inteligencia', { render: async (ctx, root) => { setHeader('Centro de Inteligência'); highlight('/inteligencia'); await pageIntelCentro(ctx, root); } });
  router.register('/dados-mercado', { render: async (ctx, root) => { setHeader('Dados de Mercado'); highlight('/dados-mercado'); await pageDadosMercado(ctx, root); } });
  router.register('/biblioteca-ads', { render: async (ctx, root) => { setHeader('Biblioteca de Anúncios'); highlight('/biblioteca-ads'); await pageBibliotecaAds(ctx, root); } });
  router.register('/marketing-historico', { render: async (ctx, root) => { setHeader('Histórico Meta'); highlight('/marketing-historico'); await pageMarketingHistorico(ctx, root); } });
  router.register('/cerebro-vendas', { render: async (ctx, root) => { setHeader('Cérebro de Vendas'); highlight('/cerebro-vendas'); await pageIntelVendas(ctx, root); } });
  router.register('/briefing-guerra', { render: async (ctx, root) => { setHeader('Briefing de Guerra'); highlight('/briefing-guerra'); await pageIntelBriefing(ctx, root); } });
  router.register('/ia',        { render: async (ctx, root) => { setHeader('IA');        highlight('/ia');        await pageIA(ctx, root); } });
  router.register('/lancamentos', { render: async (ctx, root) => { setHeader('Lançamentos'); highlight('/lancamentos'); await pageLancamentos(ctx, root); } });
  router.register('/locacoes',  { render: async (ctx, root) => { setHeader('Locações');  highlight('/locacoes');  await pageLocacoes(ctx, root); } });
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
  router.register('/integracoes', { render: async (ctx, root) => { setHeader('Integrações');  highlight('/integracoes'); await pageIntegracoes(ctx, root); } });
  router.register('/backup',      { render: async (ctx, root) => { setHeader('Backup');       highlight('/backup');      await pageBackup(ctx, root); } });
  router.register('/relatorios',  { render: async (ctx, root) => { setHeader('Relatórios');   highlight('/relatorios');  await pageRelatorios(ctx, root); } });
  router.register('/base',        { render: async (ctx, root) => { setHeader('Base de Conhecimento'); highlight('/base'); await pageBase(ctx, root); } });
  router.register('/manual',      { render: async (ctx, root) => { setHeader('Manual de Cultura');    highlight('/manual'); await pageManual(ctx, root); } });
  router.register('/etica',       { render: async (ctx, root) => { setHeader('Código de Ética');     highlight('/etica');  await pageEtica(ctx, root); } });
  router.register('/canal',       { render: async (ctx, root) => { setHeader('Canal Anônimo');        highlight('/canal');  await pageCanal(ctx, root); } });
  router.register('/formacao',    { render: async (ctx, root) => { setHeader('Formação PSM');         highlight('/formacao'); await pageFormacao(ctx, root); } });
  router.register('/gestao-pessoas', { render: async (ctx, root) => { setHeader('Gestão de Pessoas'); highlight('/gestao-pessoas'); await pageGestaoPessoas(ctx, root); } });
  router.register('/premiacoes',  { render: async (ctx, root) => { setHeader('Premiações');           highlight('/premiacoes'); await pagePremiacoes(ctx, root); } });
  router.register('/agentes',     { render: async (ctx, root) => { setHeader('Central de Agentes');  highlight('/agentes');  await pageAgentes(ctx, root); } });
  router.register('/agente-vera', { render: async (ctx, root) => { setHeader('Agente Vera');         highlight('/agente-vera'); await pageAgenteVera(ctx, root); } });
  router.register('/agente-sol',  { render: async (ctx, root) => { setHeader('Agente Sol');          highlight('/agente-sol'); await pageAgenteSol(ctx, root); } });
  router.register('/tendencias',  { render: async (ctx, root) => { setHeader('Tendências');           highlight('/tendencias'); await pageTendencias(ctx, root); } });
  router.register('/benchmark',   { render: async (ctx, root) => { setHeader('Benchmark de Mercado'); highlight('/benchmark');  await pageBenchmark(ctx, root); } });
  router.register('/intel-ads',   { render: async (ctx, root) => { setHeader('Inteligência Ads');    highlight('/intel-ads');  await pageIntelAds(ctx, root); } });
  router.register('/intel-dash',  { render: async (ctx, root) => { setHeader('Inteligência Estratégica'); highlight('/intel-dash'); await pageIntelDash(ctx, root); } });
  router.register('/simuladores', { render: async (ctx, root) => { setHeader('Simuladores');         highlight('/simuladores'); await pageSimuladores(ctx, root); } });
  router.register('/sim-vpl',     { render: async (ctx, root) => { setHeader('Simulador VPL');       highlight('/simuladores'); await pageSimVPL(ctx, root); } });
  router.register('/sim-incc',    { render: async (ctx, root) => { setHeader('Simulador INCC');      highlight('/simuladores'); await pageSimINCC(ctx, root); } });
  router.register('/sim-repasse', { render: async (ctx, root) => { setHeader('Simulador Repasse');   highlight('/simuladores'); await pageSimRepasse(ctx, root); } });
  router.register('/sim-energia', { render: async (ctx, root) => { setHeader('Simulador Energia');   highlight('/simuladores'); await pageSimEnergia(ctx, root); } });
  router.register('/sim-leads',   { render: async (ctx, root) => { setHeader('Simulador Leads/CAC'); highlight('/simuladores'); await pageSimLeads(ctx, root); } });
  router.register('/sim-criativos', { render: async (ctx, root) => { setHeader('Simulador Criativos'); highlight('/simuladores'); await pageSimCriativos(ctx, root); } });
  router.register('/war-room',    { render: async (ctx, root) => { setHeader('War Room');            highlight('/war-room');   await pageWarRoom(ctx, root); } });
  router.register('/war-arena',   { render: async (ctx, root) => { setHeader('War Arena');           highlight('/war-arena');  await pageWarArena(ctx, root); } });
  router.register('/okrs',        { render: async (ctx, root) => { setHeader('OKRs');                highlight('/okrs');       await pageOKRs(ctx, root); } });
  router.register('/kpis',        { render: async () => { location.hash = '#/cockpit?tab=kpis'; } });
  router.register('/metricas-viab', { render: async (ctx, root) => { setHeader('Métricas Viabilidade'); highlight('/metricas-viab'); await pageMetricasViab(ctx, root); } });
  router.register('/sim-trafego', { render: async (ctx, root) => { setHeader('Simulador de Tráfego'); highlight('/sim-trafego'); await pageSimTrafego(ctx, root); } });
  router.register('/mapa-ciclos', { render: async () => { location.hash = '#/governanca?tab=mapa'; } });
  router.register('/oportunidades', { render: async (ctx, root) => { setHeader('Oportunidades');     highlight('/oportunidades'); await pageOportunidades(ctx, root); } });
  router.register('/cadencia',    { render: async (ctx, root) => { setHeader('Cadência');            highlight('/cadencia');    await pageCadencia(ctx, root); } });
  router.register('/fichas',      { render: async (ctx, root) => { setHeader('Fichas/Propostas');    highlight('/fichas');      await pageFichasPropostas(ctx, root); } });
  router.register('/campanha-wa', { render: async (ctx, root) => { setHeader('Campanha WhatsApp');   highlight('/campanha-wa'); await pageCampanhaWa(ctx, root); } });
  router.register('/sr-gerencia', { render: async (ctx, root) => { setHeader('Sr. Gerência');        highlight('/sr-gerencia'); await pageSrGerencia(ctx, root); } });
  router.register('/sr-performance', { render: async (ctx, root) => { setHeader('Sr. Performance'); highlight('/sr-performance'); await pageSrPerformance(ctx, root); } });
  router.register('/mapa',        { render: async (ctx, root) => { setHeader('Mapa de Imóveis');    highlight('/mapa');        await pageMapa(ctx, root); } });
  router.register('/tabela-imoveis', { render: async (ctx, root) => { setHeader('Tabela de Imóveis'); highlight('/tabela-imoveis'); await pageTabelaImoveis(ctx, root); } });
  router.register('/usuarios',  { render: async (ctx, root) => { setHeader('Usuários');  highlight('/usuarios');  await pageUsuariosV2(ctx, root); } });
  router.register('/auditoria', { render: async (ctx, root) => { setHeader('Auditoria'); highlight('/auditoria'); await pageAuditoria(ctx, root); } });
  router.register('/conta',     { render: pageConta });
  router.register('/configuracoes', { render: async (ctx, root) => { setHeader('Configurações'); highlight('/configuracoes'); await pageConfiguracoes(ctx, root); } });
  router.register('*',          { render: page404 });

  // 5) Monta router
  router.mount(document.getElementById('app-main'));

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
        <button class="sb-link" data-nav="/agenda"><span class="sb-ico">📅</span> Agenda</button>
        <button class="sb-link" data-nav="/tarefas"><span class="sb-ico">📋</span> Tarefas</button>
        <button class="sb-link" data-nav="/one-on-one"><span class="sb-ico">👥</span> One-on-One</button>

        <div class="sb-sec">🏘 Imóveis & Vendas</div>
        <button class="sb-link" data-nav="/crm"><span class="sb-ico">🔗</span> CRM (RD)</button>
        <button class="sb-link" data-nav="/sdr"><span class="sb-ico">📞</span> Prospecção SDR</button>
        <button class="sb-link" data-nav="/oportunidades"><span class="sb-ico">💡</span> Oportunidades</button>
        <button class="sb-link" data-nav="/cadencia"><span class="sb-ico">🔄</span> Cadência</button>
        <button class="sb-link" data-nav="/fichas"><span class="sb-ico">📋</span> Fichas/Propostas</button>
        <button class="sb-link" data-nav="/imoveis"><span class="sb-ico">🏘</span> Imóveis</button>
        <button class="sb-link" data-nav="/mapa"><span class="sb-ico">🗺</span> Mapa Imóveis</button>
        <button class="sb-link" data-nav="/tabela-imoveis"><span class="sb-ico">📊</span> Tabela Imóveis</button>
        <button class="sb-link" data-nav="/lancamentos"><span class="sb-ico">🏗</span> Lançamentos</button>
        <button class="sb-link" data-nav="/captacoes"><span class="sb-ico">📥</span> Captações</button>
        <button class="sb-link" data-nav="/campanha-wa"><span class="sb-ico">📣</span> Campanha WhatsApp</button>

        <div class="sb-sec">🏛 Diretoria</div>
        <div class="sb-subsec" style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;opacity:.45;font-weight:800;padding:6px 14px 2px">Decisão</div>
        <button class="sb-link" data-nav="/cockpit"><span class="sb-ico">🧭</span> Cockpit de Decisão</button>
        <button class="sb-link" data-nav="/diretoria"><span class="sb-ico">📊</span> Dashboard</button>
        <div class="sb-subsec" style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;opacity:.45;font-weight:800;padding:6px 14px 2px">Planejamento</div>
        <button class="sb-link" data-nav="/estrategia"><span class="sb-ico">♟️</span> Estratégia</button>
        <button class="sb-link" data-nav="/metricas-viab"><span class="sb-ico">🧪</span> Métricas Viab</button>
        <button class="sb-link" data-nav="/sim-trafego"><span class="sb-ico">📣</span> Simulador de Tráfego</button>
        <button class="sb-link" data-nav="/bp"><span class="sb-ico">📋</span> Plano BP</button>
        <div class="sb-subsec" style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;opacity:.45;font-weight:800;padding:6px 14px 2px">Governança</div>
        <button class="sb-link" data-nav="/governanca"><span class="sb-ico">⚖️</span> Governança</button>

        <div class="sb-sec">🔑 Locação</div>
        <button class="sb-link" data-nav="/locacoes"><span class="sb-ico">🔑</span> Locações</button>

        <div class="sb-sec">💰 Financeiro</div>
        <button class="sb-link" data-nav="/financeiro"><span class="sb-ico">💰</span> Financeiro</button>
        <button class="sb-link" data-nav="/forecast"><span class="sb-ico">📈</span> Forecast</button>

        <div class="sb-sec">🧠 Inteligência</div>
        <button class="sb-link" data-nav="/inteligencia"><span class="sb-ico">🧠</span> Centro de Inteligência</button>
        <button class="sb-link" data-nav="/dados-mercado"><span class="sb-ico">📈</span> Dados de Mercado</button>
        <button class="sb-link" data-nav="/cerebro-vendas"><span class="sb-ico">🎯</span> Cérebro de Vendas</button>
        <button class="sb-link" data-nav="/briefing-guerra"><span class="sb-ico">⚔️</span> Briefing de Guerra</button>
        <button class="sb-link" data-nav="/concorrencia"><span class="sb-ico">🥊</span> Concorrência</button>
        <button class="sb-link" data-nav="/benchmark"><span class="sb-ico">📊</span> Benchmark</button>
        <button class="sb-link" data-nav="/intel-dash"><span class="sb-ico">🔍</span> Intel Dashboard</button>
        <button class="sb-link" data-nav="/tendencias"><span class="sb-ico">📉</span> Tendências</button>

        <div class="sb-sec">📣 Marketing</div>
        <button class="sb-link" data-nav="/marketing"><span class="sb-ico">📢</span> Marketing (Meta)</button>
        <button class="sb-link" data-nav="/marketing-historico"><span class="sb-ico">📅</span> Histórico Meta</button>
        <button class="sb-link" data-nav="/biblioteca-ads"><span class="sb-ico">📚</span> Biblioteca de Anúncios</button>
        <button class="sb-link" data-nav="/intel-ads"><span class="sb-ico">🎯</span> Intel Ads</button>

        <div class="sb-sec">🎯 Metas & Performance</div>
        <button class="sb-link" data-nav="/metas"><span class="sb-ico">🎯</span> Metas</button>
        <button class="sb-link" data-nav="/equipe"><span class="sb-ico">🛡</span> Equipes</button>
        <button class="sb-link" data-nav="/organograma"><span class="sb-ico">🌳</span> Organograma</button>
        <button class="sb-link" data-nav="/plantoes"><span class="sb-ico">🛡</span> Plantões</button>
        <button class="sb-link" data-nav="/arena"><span class="sb-ico">📡</span> Arena Live</button>
        <button class="sb-link" data-nav="/tv"><span class="sb-ico">📺</span> Modo TV</button>
        <button class="sb-link" data-nav="/war-room"><span class="sb-ico">⚔️</span> War Room</button>
        <button class="sb-link" data-nav="/war-arena"><span class="sb-ico">🔥</span> War Arena</button>

        <div class="sb-sec">🤖 IA Assistentes</div>
        <button class="sb-link" data-nav="/agentes"><span class="sb-ico">🧠</span> Central Agentes</button>
        <button class="sb-link" data-nav="/ia"><span class="sb-ico">🤖</span> Chat IAs</button>
        <button class="sb-link" data-nav="/sr-performance"><span class="sb-ico">🎖️</span> Sr. Performance</button>
        <button class="sb-link" data-nav="/sr-gerencia"><span class="sb-ico">👔</span> Sr. Gerência</button>

        <div class="sb-sec">🎓 Cultura & Pessoas</div>
        <button class="sb-link" data-nav="/academy"><span class="sb-ico">🎓</span> PSM Academy</button>
        <button class="sb-link" data-nav="/base"><span class="sb-ico">📚</span> Base Conhecimento</button>
        <button class="sb-link" data-nav="/manual"><span class="sb-ico">📖</span> Manual Cultura</button>
        <button class="sb-link" data-nav="/etica"><span class="sb-ico">⚖️</span> Código de Ética</button>
        <button class="sb-link" data-nav="/canal"><span class="sb-ico">🔒</span> Canal Anônimo</button>
        <button class="sb-link" data-nav="/formacao"><span class="sb-ico">🎓</span> Formação PSM</button>
        <button class="sb-link" data-nav="/gestao-pessoas"><span class="sb-ico">👥</span> Gestão Pessoas</button>
        <button class="sb-link" data-nav="/premiacoes"><span class="sb-ico">🏆</span> Premiações</button>

        <div class="sb-sec">🧮 Ferramentas</div>
        <button class="sb-link" data-nav="/simuladores"><span class="sb-ico">🧮</span> Simuladores</button>
        <button class="sb-link" data-nav="/relatorios"><span class="sb-ico">🖨</span> Relatórios</button>

        <div class="sb-sec">⚙️ Sistema</div>
        <button class="sb-link" data-nav="/usuarios"><span class="sb-ico">👥</span> Usuários</button>
        <button class="sb-link" data-nav="/auditoria"><span class="sb-ico">📜</span> Auditoria</button>
        <button class="sb-link" data-nav="/integracoes"><span class="sb-ico">🔌</span> Integrações</button>
        <button class="sb-link" data-nav="/backup"><span class="sb-ico">💾</span> Backup</button>
        <button class="sb-link" data-nav="/configuracoes"><span class="sb-ico">🔧</span> Configurações</button>

        <div class="sb-sec">👤 Conta</div>
        <button class="sb-link" data-nav="/conta"><span class="sb-ico">⚙️</span> Minha conta</button>

        <div style="margin-top:auto;padding:12px 0;font-size:10px;opacity:0.5">House PSM · v75.92</div>
      </aside>
      <header class="app-header">
        <button class="h-hamburger" id="btn-hamburger" title="Menu">☰</button>
        <div class="h-title" id="h-title">Dashboard</div>
        <div class="h-spacer"></div>
        <div class="h-user">
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
      <main class="app-main" id="app-main"></main>
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
  const user = auth.user();
  root.innerHTML = `
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
  // Desatualização do cliente (tab antiga aberta após deploy)
  try {
    const v = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    if (_bootVer && v.version && v.version !== _bootVer) {
      issues = [{ area: 'app', severity: 'warn', message: `Nova versão ${v.version} disponível — recarregue (Cmd+Shift+R).` }, ...issues];
      if (status === 'ok') status = 'warn';
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
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
