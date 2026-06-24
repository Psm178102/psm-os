/* ============================================================================
   PSM-OS v2 — Página Usuários (CRUD completo)
   Sprint 7.2 — substitui pgConfig > Gestão de Usuários do /v1/
============================================================================ */
import { api, ApiError, tokenStore } from '../api.js';
import { auth } from '../auth.js';

const ROLES = [
  { id: 'socio',      lbl: 'Sócio / Diretor',   lvl: 10, color: '#dc2626', ico: '👑' },
  { id: 'gerente',    lbl: 'Gerente',           lvl: 7,  color: '#7c3aed', ico: '🎯' },
  { id: 'backoffice', lbl: 'Back Office',       lvl: 6,  color: '#0891b2', ico: '📋' },
  { id: 'lider',      lbl: 'Líder de Equipe',   lvl: 5,  color: '#059669', ico: '🛡️' },
  { id: 'financeiro', lbl: 'Financeiro',        lvl: 4,  color: '#16a34a', ico: '💰' },
  { id: 'marketing',  lbl: 'Marketing',         lvl: 3,  color: '#d97706', ico: '📢' },
  { id: 'corretor_conquista', lbl: 'Corretor Conquista', lvl: 2, color: '#f59e0b', ico: '🏠' },
  { id: 'corretor_map',       lbl: 'Corretor MAP',       lvl: 2, color: '#a855f7', ico: '🗺️' },
  { id: 'corretor_locacao',   lbl: 'Corretor Locação',   lvl: 2, color: '#a16207', ico: '🔑' },
  { id: 'corretor_terceiros', lbl: 'Corretor Terceiros', lvl: 2, color: '#0d9488', ico: '🤝' },
  // legado: não é mais oferecido pra novos; some do seletor, mas continua exibindo
  // pra quem ainda é 'corretor' (até o sócio reatribuir) + serve de fallback interno. v81.38
  { id: 'corretor',   lbl: 'Corretor (antigo)', lvl: 2,  color: '#64748b', ico: '🏠', legacy: true },
];
// Papéis OFERECIDOS no seletor: esconde legados, mas mantém o papel atual do usuário
const roleOptions = (curId) => ROLES.filter(r => !r.legacy || r.id === curId);

const TEAMS = [
  { id: 'lancamento', lbl: 'Lançamento', color: '#d4a843', ico: '🏗' },
  { id: 'conquista',  lbl: 'Conquista',   color: '#dc2626', ico: '🏆' },
  { id: 'terceiros',  lbl: 'Terceiros',   color: '#3b82f6', ico: '🤝' },
  { id: 'impper',     lbl: 'IMPPER',      color: '#a855f7', ico: '✨' },
  { id: 'locacao',    lbl: 'Locação',     color: '#10b981', ico: '🔑' },
  { id: 'geral',      lbl: 'Geral',       color: '#64748b', ico: '📁' },
];

// State
let _users = [];
let _lastAuditByUser = {};   // target_id -> "Editado por X há Yh"
let _filterTeam = 'todos';
let _filterStatus = 'todos';
let _rootEl = null;

export async function pageUsuarios(ctx, root) {
  _rootEl = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando usuários…</div></div>';
  await reload();
}

async function reload() {
  try {
    const [u, a] = await Promise.all([
      api.request('/api/v3/users/list?all=1'),   // gestão vê TODOS (inclusive arquivados)
      api.request('/api/v3/audit/list?limit=300').catch(() => ({ entries: [] })),
    ]);
    _users = u.users || [];
    _lastAuditByUser = {};
    for (const e of (a.entries || [])) {
      if (!e.target_id) continue;
      if (e.action && (e.action.startsWith('user.') || e.action.startsWith('auth.'))) {
        if (!_lastAuditByUser[e.target_id]) {
          const ago = relTime(e.ts);
          const actor = e.actor_name || e.actor_id || 'sistema';
          _lastAuditByUser[e.target_id] = `${e.action.split('.')[1]} por ${actor} · ${ago}`;
        }
      }
    }
    render();
  } catch (e) {
    _rootEl.innerHTML = `<div class="alert alert-err">Erro ao carregar: ${escapeHtml(e.message)}</div>`;
  }
}

function relTime(iso) {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return m + 'min atrás';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h atrás';
  const d = Math.round(h / 24);
  if (d < 30) return d + 'd atrás';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function render() {
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 10;

  // Filter — ARQUIVADOS (inativo E oculto) saem da lista principal pra não poluir
  // e ficam numa seção recolhida no fim. Eles também não aparecem em nenhuma
  // outra opção do sistema (backend exclui por padrão; só voltam ao reativar).
  const isArchived = u => (u.status || 'ativo') !== 'ativo' && !!u.hide_from_ranking;
  let base = _users.slice();
  if (_filterTeam !== 'todos') base = base.filter(u => (u.team || 'geral') === _filterTeam);
  const archivedList = base.filter(isArchived);
  let list = base.filter(u => !isArchived(u));
  if (_filterStatus === 'ativos')   list = list.filter(u => (u.status || 'ativo') === 'ativo');
  else if (_filterStatus === 'inativos') list = list.filter(u => (u.status || 'ativo') !== 'ativo');
  else if (_filterStatus === 'ocultos')  list = list.filter(u => !!u.hide_from_ranking);

  // Stats
  const total = _users.length;
  const ativos = _users.filter(u => (u.status || 'ativo') === 'ativo').length;
  const inativos = total - ativos;
  const ocultos = _users.filter(u => !!u.hide_from_ranking).length;

  _rootEl.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔐 Gestão de Usuários · Perfil + Equipe + Acesso</h2>
      <p class="card-sub">
        Fonte: Postgres (24 cadastrados). Edições são auditadas e refletem em todos os dispositivos.
        ${isSocio ? '' : '<br><b style="color:var(--warn)">Apenas Sócio/Diretor edita.</b>'}
      </p>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        ${statCard('Total',    total,    'var(--bg-3)',  'var(--ink)')}
        ${statCard('Ativos',   ativos,   '#dcfce7',     '#166534')}
        ${statCard('Inativos', inativos, '#fee2e2',     '#991b1b')}
        ${statCard('Ocultos',  ocultos,  '#fef3c7',     '#78350f')}
      </div>

      <!-- Filtros -->
      <div class="flex gap-3 items-center mt-3" style="padding:10px;background:var(--bg-3);border-radius:var(--r-sm);flex-wrap:wrap">
        <label class="tiny muted" style="font-weight:700;letter-spacing:1px">EQUIPE:</label>
        <select id="f-team" class="select">
          <option value="todos">Todas equipes</option>
          ${TEAMS.map(t => `<option value="${t.id}">${t.ico} ${t.lbl}</option>`).join('')}
        </select>
        <label class="tiny muted" style="font-weight:700;letter-spacing:1px;margin-left:14px">STATUS:</label>
        <select id="f-status" class="select">
          <option value="todos">Todos</option>
          <option value="ativos">Apenas ativos</option>
          <option value="inativos">Apenas inativos</option>
          <option value="ocultos">Apenas ocultos</option>
        </select>
        <span style="margin-left:auto" class="tiny muted">${list.length} resultado(s)</span>
      </div>

      <!-- Lista (ativos / não-arquivados) -->
      <div class="mt-4" style="display:grid;gap:8px">
        ${list.map(u => userRow(u, isSocio, me?.id)).join('') || '<div class="muted text-center" style="padding:30px">Nenhum usuário com esse filtro.</div>'}
      </div>

      ${archivedList.length ? `
      <details style="margin-top:16px;border:1px dashed var(--border-2);border-radius:var(--r-md);background:#fafafa">
        <summary style="cursor:pointer;padding:12px 14px;font-weight:800;font-size:13px;color:var(--ink-muted);user-select:none;list-style:none">
          📦 Arquivados · inativos + ocultos (${archivedList.length})
          <span class="tiny muted" style="font-weight:600">— não aparecem em nenhuma opção do sistema; reative aqui se precisar</span>
        </summary>
        <div style="display:grid;gap:8px;padding:0 12px 14px">
          ${archivedList.map(u => userRow(u, isSocio, me?.id)).join('')}
        </div>
      </details>` : ''}

      ${isSocio ? addUserBlock() : ''}
    </div>
  `;

  // Wire up filters
  const fT = document.getElementById('f-team');
  const fS = document.getElementById('f-status');
  if (fT) { fT.value = _filterTeam;   fT.addEventListener('change', () => { _filterTeam = fT.value; render(); }); }
  if (fS) { fS.value = _filterStatus; fS.addEventListener('change', () => { _filterStatus = fS.value; render(); }); }

  // Wire up row controls
  document.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('change', handleFieldChange);
    el.addEventListener('click', handleClick);
  });

  // Wire up add form
  const addBtn = document.getElementById('btn-add-user');
  if (addBtn) addBtn.addEventListener('click', handleAddUser);
}

function statCard(label, value, bg, fg) {
  return `
    <div style="background:${bg};border-radius:var(--r-sm);padding:10px 12px">
      <div class="tiny" style="color:${fg};opacity:0.7;letter-spacing:1.5px;font-weight:700;text-transform:uppercase">${label}</div>
      <div style="font-size:22px;font-weight:900;color:${fg}">${value}</div>
    </div>
  `;
}

function userRow(u, isSocio, myId) {
  const role = ROLES.find(r => r.id === (u.role || 'corretor')) || ROLES.find(r => r.id === 'corretor');
  const team = TEAMS.find(t => t.id === (u.team || 'geral')) || TEAMS[5];
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const inactive = (u.status || 'ativo') !== 'ativo';
  const hidden = !!u.hide_from_ranking;
  const isMe = myId === u.id;
  const editable = isSocio && !isMe;
  const lastAudit = _lastAuditByUser[u.id];

  return `
    <div style="display:grid;grid-template-columns:42px 1fr auto auto auto auto auto;gap:10px;padding:10px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--r-md);align-items:center${inactive ? ';opacity:0.65' : ''}">
      <div style="width:36px;height:36px;border-radius:var(--r-sm);background:${u.color || role.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px">${ini}</div>
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13px">${escapeHtml(u.name || 'Sem nome')}${isMe ? ' <span style="font-size:9px;background:var(--psm-navy);color:#fff;padding:1px 6px;border-radius:3px;letter-spacing:1px;margin-left:6px">VOCÊ</span>' : ''}</div>
        <div class="tiny muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.email || 'sem email')}</div>
        ${lastAudit ? `<div class="tiny" style="color:var(--info);margin-top:2px"><a href="#/auditoria" data-link-audit="${u.id}">📜 ${escapeHtml(lastAudit)}</a></div>` : ''}
        ${Array.isArray(u.menu_groups) ? `<div class="tiny" style="margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="background:#fef3c7;color:#78350f;padding:1px 7px;border-radius:3px;font-weight:700" title="Esse usuário tem permissão INDIVIDUAL que IGNORA as Permissões por papel. Liberado só: ${escapeHtml((u.menu_groups || []).join(', ') || '(nada)')}">⚠️ Exceção de menu (${u.menu_groups.length})</span>
          ${editable ? `<button class="btn btn-ghost" data-action="clear-menu-override" data-id="${u.id}" style="padding:2px 8px;font-size:10px" title="Remover a exceção → passa a seguir as Permissões por papel">↩︎ voltar ao papel</button>` : ''}
        </div>` : ''}
      </div>
      <select class="select" data-action="role" data-id="${u.id}" ${editable ? '' : 'disabled'} style="padding:5px 8px;font-size:11px;font-weight:700;min-width:170px;border-left:3px solid ${role.color}" title="Papel hierárquico">
        ${roleOptions(u.role).map(r => `<option value="${r.id}"${u.role === r.id ? ' selected' : ''}>${r.ico} ${r.lbl} · L${r.lvl}</option>`).join('')}
      </select>
      <select class="select" data-action="team" data-id="${u.id}" ${editable ? '' : 'disabled'} style="padding:5px 8px;font-size:11px;font-weight:700;min-width:150px;border-left:3px solid ${team.color}" title="Equipe / frente">
        ${TEAMS.map(t => `<option value="${t.id}"${u.team === t.id ? ' selected' : ''}>${t.ico} ${t.lbl}</option>`).join('')}
      </select>
      ${isMe
        ? '<span class="tiny muted" style="font-style:italic;padding:0 8px">— você —</span>'
        : `<button class="btn" data-action="toggle-status" data-id="${u.id}" style="padding:6px 12px;font-size:11px;letter-spacing:1px;text-transform:uppercase;background:${inactive ? '#fee2e2' : '#dcfce7'};color:${inactive ? '#991b1b' : '#166534'};min-width:92px" ${editable ? '' : 'disabled'} title="${inactive ? 'Reativar' : 'Bloquear acesso'}">${inactive ? '🔒 Inativo' : '✓ Ativo'}</button>`
      }
      <button class="btn" data-action="toggle-hidden" data-id="${u.id}" style="padding:6px 12px;font-size:11px;letter-spacing:1px;text-transform:uppercase;background:${hidden ? '#fef3c7' : 'var(--bg-3)'};color:${hidden ? '#78350f' : 'var(--ink-muted)'};min-width:92px" ${editable ? '' : 'disabled'} title="${hidden ? 'Tornar visível' : 'Ocultar de rankings/TV'}">${hidden ? '👁 Oculto' : '👁 Visível'}</button>
      ${editable ? `<button class="btn btn-ghost" data-action="reset-pwd" data-id="${u.id}" title="Resetar senha" style="padding:6px 10px;font-size:11px">🔑</button>` : '<span></span>'}
    </div>
  `;
}

function addUserBlock() {
  return `
    <div class="mt-4" style="padding:14px;background:#f8fafc;border-radius:var(--r-md);border:1px dashed var(--border-2)">
      <div style="font-size:12px;font-weight:800;color:var(--ink);margin-bottom:6px">➕ Adicionar novo usuário</div>
      <div class="tiny muted" style="margin-bottom:10px">Cria o usuário no Postgres. Depois ele acessa <b>housepsm.com.br/login</b> → "definir senha inicial".</div>
      <div class="flex gap-2 items-center" style="flex-wrap:wrap">
        <input id="nu-name"  class="input" placeholder="Nome completo" style="width:200px;padding:6px 10px;font-size:12px">
        <input id="nu-email" class="input" placeholder="email@imobiliariapsm.com.br" style="width:260px;padding:6px 10px;font-size:12px">
        <select id="nu-role" class="select" style="padding:6px 10px;font-size:12px">
          ${roleOptions('').map(r => `<option value="${r.id}"${r.id === 'corretor_conquista' ? ' selected' : ''}>${r.ico} ${r.lbl}</option>`).join('')}
        </select>
        <select id="nu-team" class="select" style="padding:6px 10px;font-size:12px">
          ${TEAMS.map(t => `<option value="${t.id}"${t.id === 'geral' ? ' selected' : ''}>${t.ico} ${t.lbl}</option>`).join('')}
        </select>
        <button id="btn-add-user" class="btn btn-primary">+ Adicionar</button>
      </div>
      <div id="nu-msg" class="mt-2"></div>
    </div>
  `;
}

// ─── Handlers ───────────────────────────────────────────────────────────
async function handleFieldChange(ev) {
  const el = ev.currentTarget;
  if (el.tagName !== 'SELECT') return;
  const id = el.dataset.id;
  const action = el.dataset.action;
  if (!id || !action) return;
  if (action !== 'role' && action !== 'team') return;
  try {
    await api.request('/api/v3/users/update', {
      method: 'POST',
      body: { id, fields: { [action]: el.value } },
    });
    toast(`${action} atualizado para ${id}`, 'ok');
    await reload();
  } catch (e) {
    toast('Falha: ' + e.message, 'err');
    await reload();
  }
}

async function handleClick(ev) {
  const el = ev.currentTarget;
  if (el.tagName !== 'BUTTON') return;
  const id = el.dataset.id;
  const action = el.dataset.action;
  if (!id || !action) return;

  const u = _users.find(x => x.id === id);
  if (!u) return;

  try {
    if (action === 'toggle-status') {
      const newStatus = ((u.status || 'ativo') === 'ativo') ? 'inativo' : 'ativo';
      await api.request('/api/v3/users/update', { method: 'POST', body: { id, fields: { status: newStatus } } });
      toast(`Status de ${u.name} → ${newStatus}`, 'ok');
      await reload();
    } else if (action === 'toggle-hidden') {
      await api.request('/api/v3/users/update', { method: 'POST', body: { id, fields: { hide_from_ranking: !u.hide_from_ranking } } });
      toast(`${u.name} ${!u.hide_from_ranking ? 'oculto' : 'visível'} em rankings`, 'ok');
      await reload();
    } else if (action === 'reset-pwd') {
      const pwd = prompt(`Nova senha para ${u.name} (≥ 6 chars):`);
      if (!pwd) return;
      if (pwd.length < 6) { toast('Senha precisa ≥ 6 chars', 'err'); return; }
      await api.request('/api/v3/users/admin_reset_password', { method: 'POST', body: { user_id: id, new_password: pwd } });
      toast(`Senha de ${u.name} resetada.`, 'ok');
    } else if (action === 'clear-menu-override') {
      const itens = (u.menu_groups || []).join(', ') || '(nada)';
      if (!confirm(`Remover a exceção de menu de ${u.name}?\n\nHoje ele(a) vê só: ${itens}\n\nDepois passa a seguir as Permissões por papel do cargo "${u.role}".`)) return;
      await api.request('/api/v3/users/menu_access', { method: 'POST', body: { id, clear: true } });
      toast(`Exceção removida — ${u.name} agora segue o papel ✓`, 'ok');
      await reload();
    }
  } catch (e) {
    toast('Falha: ' + e.message, 'err');
    await reload();
  }
}

async function handleAddUser() {
  const name  = document.getElementById('nu-name').value.trim();
  const email = document.getElementById('nu-email').value.trim().toLowerCase();
  const role  = document.getElementById('nu-role').value;
  const team  = document.getElementById('nu-team').value;
  const msg   = document.getElementById('nu-msg');
  msg.innerHTML = '';

  if (!name) { msg.innerHTML = '<div class="alert alert-err">Nome obrigatório.</div>'; return; }

  try {
    const r = await api.request('/api/v3/users/create', { method: 'POST', body: { name, email, role, team } });
    msg.innerHTML = `<div class="alert alert-ok">Usuário <b>${escapeHtml(r.user.name)}</b> criado (id=${r.user.id}). Diga pra ele fazer "definir senha inicial".</div>`;
    document.getElementById('nu-name').value = '';
    document.getElementById('nu-email').value = '';
    await reload();
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
  }
}

// ─── Toast ──────────────────────────────────────────────────────────────
let _toastEl = null;
function toast(msg, kind = 'ok') {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:8px;color:#fff;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.2);transition:opacity 0.3s';
    document.body.appendChild(_toastEl);
  }
  _toastEl.style.background = kind === 'err' ? 'var(--err)' : 'var(--ok)';
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  clearTimeout(_toastEl._t);
  _toastEl._t = setTimeout(() => { _toastEl.style.opacity = '0'; }, 3000);
}

// ─── Helpers ────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
