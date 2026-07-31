/* ============================================================================
   PSM-OS v2 — Hash router (lightweight)
============================================================================ */

const routes = new Map(); // path -> { render: async fn(ctx) }
let mountEl = null;
let currentPath = null;
let currentQuery = {};    // query da rota atual (pra re-render fiel no refresh)
let guardFn = null; // (path) => boolean : false bloqueia a rota
let cleanups = []; // fns p/ limpar timers/estado da rota atual ao trocar de rota
let _refreshing = false;
// v84.95 — ESCUDO DE EDIÇÃO: qualquer digitação em input/textarea/select levanta o
// escudo; o auto-refresh (pulso/realtime) fica bloqueado por 3min ou até SALVAR
// (api.js zera no primeiro POST ok). Mata o "perdi tudo que estava preenchendo".
if (typeof window !== 'undefined') {
  window.__psmLastEdit = 0;
  document.addEventListener('input', () => { window.__psmLastEdit = Date.now(); }, { passive: true, capture: true });
  window.__psmEditShield = () => (Date.now() - (window.__psmLastEdit || 0)) < 180000;
}

export const router = {
  mount(el) { mountEl = el; window.addEventListener('hashchange', tick); tick(); },
  register(path, handler) { routes.set(path, handler); },
  setGuard(fn) { guardFn = fn; },
  // Páginas com setInterval/timers registram aqui sua limpeza; o router roda
  // tudo ANTES de renderizar a próxima rota — evita auto-refresh de uma página
  // (ex.: Marketing 60s, Arena, TV) "carimbar" o conteúdo da página seguinte.
  onCleanup(fn) { if (typeof fn === 'function') cleanups.push(fn); },
  go(path)  { location.hash = path.startsWith('#') ? path : '#' + path; },
  current() { return currentPath; },
  // 🔄 Re-renderiza a ROTA ATUAL re-buscando os dados (tempo real entre devices).
// v84.95 — restaura o scroll INSISTINDO: o restore de 1 tiro falhava porque a
// página recém-renderizada ainda está curta (carregando) e o navegador trava o
// scroll no topo — era o "puxa a barra pra cima". Tenta por até 2.5s, e PARA na
// hora se o usuário rolar/clicar (nunca briga com gesto humano).
function restaurarScroll(sy) {
  let cancelado = false;
  const cancela = () => { cancelado = true; };
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(ev =>
    window.addEventListener(ev, cancela, { passive: true, once: true }));
  const tenta = (i) => {
    if (cancelado) return;
    if (Math.abs((window.scrollY || 0) - sy) > 4) { try { window.scrollTo(0, sy); } catch (_) {} }
    if (i < 6 && document.documentElement.scrollHeight < sy + window.innerHeight) setTimeout(() => tenta(i + 1), 400);
  };
  tenta(0); setTimeout(() => tenta(1), 150); setTimeout(() => tenta(2), 500); setTimeout(() => tenta(3), 1200); setTimeout(() => tenta(4), 2500);
}

  // quiet=true → sem spinner e preservando o scroll (refresh de fundo, sem "piscar").
  async refresh(opts = {}) {
    const quiet = !!opts.quiet;
    if (!mountEl || currentPath == null || _refreshing) return;
    if (guardFn && currentPath !== '/' && !guardFn(currentPath)) return;
    const route = routes.get(currentPath) || routes.get('*');
    if (!route) return;
    _refreshing = true;
    if (cleanups.length) { const cs = cleanups.splice(0); cs.forEach(fn => { try { fn(); } catch (_) {} }); }
    const sy = window.scrollY || 0;
    const root = document.createElement('div');
    root.className = 'route-root';
    if (!quiet) root.innerHTML = '<div class="flex items-center gap-2 muted"><span class="spinner"></span> Atualizando…</div>';
    mountEl.replaceChildren(root);
    try {
      await route.render({ path: currentPath, query: { ...currentQuery } }, root);
      if (quiet && sy > 0) restaurarScroll(sy);   // v84.95: persistente, não 1 tiro
    } catch (e) {
      root.innerHTML = '<div class="alert alert-err">Erro ao atualizar: ' + (e.message || e) + '</div>';
    } finally {
      _refreshing = false;
    }
  },
};

async function tick() {
  if (!mountEl) return;
  // Limpa timers/estado da rota anterior antes de montar a próxima
  if (cleanups.length) { const cs = cleanups.splice(0); cs.forEach(fn => { try { fn(); } catch (_) {} }); }
  let hash = (location.hash || '#/').replace(/^#/, '') || '/';
  // Links de notificação chegavam tortos ("/#/rota" virava hash "#/#/rota" → 404
  // em TODOS os cliques do sino). Normaliza qualquer resíduo de #/ no começo. v84.21.1
  hash = hash.replace(/^\/?#+\/?/, '/');
  if (!hash.startsWith('/')) hash = '/' + hash;
  const [path, query] = hash.split('?');
  currentPath = path;
  currentQuery = Object.fromEntries(new URLSearchParams(query || ''));
  // 🔝 volta ao topo a cada navegação — sem isso, vindo de uma página rolada, telas
  // curtas (Imóveis, Mapa, etc.) apareciam EM BRANCO (conteúdo ficava acima da viewport).
  try {
    window.scrollTo(0, 0);
    document.scrollingElement && (document.scrollingElement.scrollTop = 0);
    const mainEl = document.querySelector('main, #app, .content, .app-main');
    if (mainEl) mainEl.scrollTop = 0;
  } catch {}
  // 🧱 ISOLAMENTO DE NAVEGAÇÃO: cada rota renderiza num root NOVO. Sem isso, uma
  // página com fetch ainda em voo (que guardou `_root` global) escrevia o conteúdo
  // DELA por cima da rota seguinte — "Insights" aparecendo dentro de /kpis, erros
  // "Cannot set properties of null", telas trocadas ao navegar rápido. Com o root
  // novo, a página antiga escreve num nó órfão (fora do DOM) — inofensivo.
  const root = document.createElement('div');
  root.className = 'route-root';
  root.innerHTML = '<div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div>';
  mountEl.replaceChildren(root);
  // Guard de permissões: se a rota não é permitida, mostra aviso e não renderiza
  if (guardFn && path !== '/' && !guardFn(path)) {
    root.innerHTML = '<div class="card"><h2 class="card-title">🔒 Sem permissão</h2>'
      + '<p class="muted">Você não tem acesso a esta seção. Fale com um gestor se precisar.</p>'
      + '<button class="btn btn-primary mt-3" onclick="location.hash=\'#/\'">← Voltar ao início</button></div>';
    return;
  }
  const route = routes.get(path) || routes.get('*');
  if (!route) {
    root.innerHTML = '<div class="card"><h2 class="card-title">404</h2><p class="muted">Rota não encontrada: ' + path + '</p></div>';
    return;
  }
  try {
    const ctx = { path, query: Object.fromEntries(new URLSearchParams(query || '')) };
    await route.render(ctx, root);
  } catch (e) {
    console.error('[router]', e);
    root.innerHTML = '<div class="alert alert-err">Erro ao renderizar: ' + (e.message || e) + '</div>';
  }
}

export default router;
