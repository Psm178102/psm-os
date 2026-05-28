/* ============================================================================
   PSM-OS v2 — Hash router (lightweight)
============================================================================ */

const routes = new Map(); // path -> { render: async fn(ctx) }
let mountEl = null;
let currentPath = null;
let guardFn = null; // (path) => boolean : false bloqueia a rota

export const router = {
  mount(el) { mountEl = el; window.addEventListener('hashchange', tick); tick(); },
  register(path, handler) { routes.set(path, handler); },
  setGuard(fn) { guardFn = fn; },
  go(path)  { location.hash = path.startsWith('#') ? path : '#' + path; },
  current() { return currentPath; },
};

async function tick() {
  if (!mountEl) return;
  const hash = (location.hash || '#/').replace(/^#/, '') || '/';
  const [path, query] = hash.split('?');
  currentPath = path;
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
