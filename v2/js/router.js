/* ============================================================================
   PSM-OS v2 — Hash router (lightweight)
============================================================================ */

const routes = new Map(); // path -> { render: async fn(ctx) }
let mountEl = null;
let currentPath = null;
let guardFn = null; // (path) => boolean : false bloqueia a rota
let cleanups = []; // fns p/ limpar timers/estado da rota atual ao trocar de rota

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
};

async function tick() {
  if (!mountEl) return;
  // Limpa timers/estado da rota anterior antes de montar a próxima
  if (cleanups.length) { const cs = cleanups.splice(0); cs.forEach(fn => { try { fn(); } catch (_) {} }); }
  const hash = (location.hash || '#/').replace(/^#/, '') || '/';
  const [path, query] = hash.split('?');
  currentPath = path;
  // 🔝 volta ao topo a cada navegação — sem isso, vindo de uma página rolada, telas
  // curtas (Imóveis, Mapa, etc.) apareciam EM BRANCO (conteúdo ficava acima da viewport).
  try {
    window.scrollTo(0, 0);
    document.scrollingElement && (document.scrollingElement.scrollTop = 0);
    const mainEl = document.querySelector('main, #app, .content, .app-main');
    if (mainEl) mainEl.scrollTop = 0;
  } catch {}
  // Guard de permissões: se a rota não é permitida, mostra aviso e não renderiza
  if (guardFn && path !== '/' && !guardFn(path)) {
    mountEl.innerHTML = '<div class="card"><h2 class="card-title">🔒 Sem permissão</h2>'
      + '<p class="muted">Você não tem acesso a esta seção. Fale com um gestor se precisar.</p>'
      + '<button class="btn btn-primary mt-3" onclick="location.hash=\'#/\'">← Voltar ao início</button></div>';
    return;
  }
  const route = routes.get(path) || routes.get('*');
  if (!route) {
    mountEl.innerHTML = '<div class="card"><h2 class="card-title">404</h2><p class="muted">Rota não encontrada: ' + path + '</p></div>';
    return;
  }
  try {
    mountEl.innerHTML = '<div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div>';
    const ctx = { path, query: Object.fromEntries(new URLSearchParams(query || '')) };
    await route.render(ctx, mountEl);
  } catch (e) {
    console.error('[router]', e);
    mountEl.innerHTML = '<div class="alert alert-err">Erro ao renderizar: ' + (e.message || e) + '</div>';
  }
}

export default router;
