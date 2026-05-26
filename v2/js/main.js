/* ============================================================================
   PSM-OS v2 — Main entry (ES module)
============================================================================ */
import { auth } from './auth.js';
import { router } from './router.js';
import { api } from './api.js';
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
import { initNotifs } from './notifs.js';
import { pageConfiguracoes } from './pages/configuracoes.js';

// ─── Boot ──────────────────────────────────────────────────────────────
(async function boot() {
  // 1) Tenta hidratar sessão
  const user = await auth.hydrate();
  if (!user) {
    location.href = '/v2/login.html?from=' + encodeURIComponent(location.pathname + location.hash);
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

  // 4) Registra rotas (Sprint 7.3: dashboard + painel modulares)
  router.register('/',          { render: async (ctx, root) => { setHeader('Dashboard'); highlight('/');          await pageDashboardV2(ctx, root); } });
  router.register('/painel',    { render: async (ctx, root) => { setHeader('Meu Painel'); highlight('/painel');   await pagePainel(ctx, root); } });
  router.register('/financeiro',{ render: async (ctx, root) => { setHeader('Financeiro');highlight('/financeiro');await pageFinanceiro(ctx, root); } });
  router.register('/crm',       { render: async (ctx, root) => { setHeader('CRM');       highlight('/crm');       await pageCrm(ctx, root); } });
  router.register('/equipe',    { render: async (ctx, root) => { setHeader('Equipe');    highlight('/equipe');    await pageEquipe(ctx, root); } });
  router.register('/tarefas',   { render: async (ctx, root) => { setHeader('Tarefas');   highlight('/tarefas');   await pageTarefas(ctx, root); } });
  router.register('/metas',     { render: async (ctx, root) => { setHeader('Metas');     highlight('/metas');     await pageMetas(ctx, root); } });
  router.register('/agenda',    { render: async (ctx, root) => { setHeader('Agenda');    highlight('/agenda');    await pageAgenda(ctx, root); } });
  router.register('/diretoria', { render: async (ctx, root) => { setHeader('Diretoria'); highlight('/diretoria'); await pageDiretoria(ctx, root); } });
  router.register('/usuarios',  { render: async (ctx, root) => { setHeader('Usuários');  highlight('/usuarios');  await pageUsuariosV2(ctx, root); } });
  router.register('/auditoria', { render: async (ctx, root) => { setHeader('Auditoria'); highlight('/auditoria'); await pageAuditoria(ctx, root); } });
  router.register('/conta',     { render: pageConta });
  router.register('/configuracoes', { render: async (ctx, root) => { setHeader('Configurações'); highlight('/configuracoes'); await pageConfiguracoes(ctx, root); } });
  router.register('*',          { render: page404 });

  // 5) Monta router
  router.mount(document.getElementById('app-main'));

  // 6) Notificações (sino + drawer + poll 60s)
  initNotifs();
})();

// ─── Shell ─────────────────────────────────────────────────────────────
function shellHTML(user) {
  const ini = (user.ini || (user.name || '?').substring(0, 2)).toUpperCase();
  return `
    <div class="app-shell">
      <aside class="app-sidebar">
        <div class="sb-brand">PSM <span style="color:var(--psm-gold)">OS</span> v2</div>
        <div class="sb-sec">Início</div>
        <button class="sb-link on" data-nav="/"><span class="sb-ico">🏠</span> Dashboard</button>
        <button class="sb-link" data-nav="/painel"><span class="sb-ico">👤</span> Meu Painel</button>
        <div class="sb-sec">Operação</div>
        <button class="sb-link" data-nav="/financeiro"><span class="sb-ico">💰</span> Financeiro</button>
        <button class="sb-link" data-nav="/crm"><span class="sb-ico">🔗</span> CRM</button>
        <button class="sb-link" data-nav="/equipe"><span class="sb-ico">🛡</span> Equipes</button>
        <button class="sb-link" data-nav="/tarefas"><span class="sb-ico">📋</span> Tarefas</button>
        <button class="sb-link" data-nav="/metas"><span class="sb-ico">🎯</span> Metas</button>
        <button class="sb-link" data-nav="/agenda"><span class="sb-ico">📅</span> Agenda</button>
        <button class="sb-link" data-nav="/diretoria"><span class="sb-ico">🏛</span> Diretoria</button>
        <div class="sb-sec">Gestão</div>
        <button class="sb-link" data-nav="/usuarios"><span class="sb-ico">👥</span> Usuários</button>
        <button class="sb-link" data-nav="/auditoria"><span class="sb-ico">📜</span> Auditoria</button>
        <div class="sb-sec">Conta</div>
        <button class="sb-link" data-nav="/conta"><span class="sb-ico">⚙️</span> Minha conta</button>
        <button class="sb-link" data-nav="/configuracoes"><span class="sb-ico">🔧</span> Configurações</button>
        <div style="margin-top:auto;padding:12px 0;font-size:10px;opacity:0.5">v2.0.0-sprint7</div>
      </aside>
      <header class="app-header">
        <button class="h-hamburger" id="btn-hamburger" title="Menu">☰</button>
        <div class="h-title" id="h-title">Dashboard</div>
        <div class="h-spacer"></div>
        <div class="h-user">
          <button class="btn btn-ghost" id="btn-notif" style="position:relative;padding:6px 10px" title="Notificações">
            🔔
            <span id="notif-badge" style="display:none;position:absolute;top:-2px;right:-2px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;border-radius:9px;padding:0 5px;min-width:16px;height:16px;line-height:16px;text-align:center"></span>
          </button>
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
      <p class="card-sub">Você está no <strong>v2</strong> — PSM-OS migrado para Python real (FastAPI-like, JWT, bcrypt).</p>
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
function highlight(path) {
  document.querySelectorAll('.sb-link').forEach(b => b.classList.remove('on'));
  const cur = document.querySelector('[data-nav="' + path + '"]');
  if (cur) cur.classList.add('on');
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
