/* ============================================================================
   PSM-OS v2 — Tarefas Diretoria
   Sprint 7.6
============================================================================ */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';
import { mountComments } from '../comments.js';
import { pageAgenda } from './agenda.js';

const STATUS = [
  { id: 'aberta',         lbl: 'Aberta',        color: '#64748b', ico: '📝' },
  { id: 'em_andamento',   lbl: 'Em andamento',  color: '#2563eb', ico: '🔄' },
  { id: 'concluida',      lbl: 'Concluída',     color: '#16a34a', ico: '✅' },
  { id: 'cancelada',      lbl: 'Cancelada',     color: '#94a3b8', ico: '⛔' },
  { id: 'atrasada',       lbl: 'Atrasada',      color: '#dc2626', ico: '⚠️' },
];

const PRIORIDADE = [
  { id: 'baixa',   lbl: 'Baixa',    color: '#94a3b8' },
  { id: 'media',   lbl: 'Média',    color: '#d97706' },
  { id: 'alta',    lbl: 'Alta',     color: '#dc2626' },
  { id: 'critica', lbl: 'Crítica',  color: '#7c1d1d' },
];

let _root = null;
let _tasks = [];
let _users = [];
let _feed = [];
let _feedCounts = {};
let _view = 'central';     // central | board
let _cOrigem = '';         // filtro de origem na central
let _cDone = false;        // mostrar concluídos na central
let _scope = 'mine';
let _ctx = null;
let _filterStatus = '';
let _filterResp = '';
let _filterPrior = '';

// ── Hierarquia de atribuição (mesma regra do backend tasks/upsert _pode_atribuir) ──
// sócio/diretor(≥10)→todos · gerente(≥7)→lvl<7 · líder(≥5)→própria equipe lvl<5 · demais→só si.
const ROLE_LVL_T = { socio: 10, diretor: 10, gerente: 7, backoffice: 6, lider: 5, financeiro: 4, marketing: 3, corretor: 2 };
function assignableUsers() {
  const me = auth.user() || {};
  const lvl = me.lvl || ROLE_LVL_T[String(me.role || '').toLowerCase()] || 2;
  const team = String(me.team || '').trim().toLowerCase();
  const lvlOf = u => ROLE_LVL_T[String((u && u.role) || '').toLowerCase()] || 2;
  const ativos = (_users || []).filter(u => (u.status || 'ativo') === 'ativo' && !u.hide_from_ranking);
  let list;
  if (lvl >= 10) list = ativos;
  else if (lvl >= 7) list = ativos.filter(u => lvlOf(u) < 7);
  else if (lvl >= 5) list = ativos.filter(u => String(u.team || '').trim().toLowerCase() === team && lvlOf(u) < 5);
  else list = ativos.filter(u => String(u.id) === String(me.id));
  if (!list.find(u => String(u.id) === String(me.id))) {
    const meU = (_users || []).find(u => String(u.id) === String(me.id));
    if (meU) list = [meU, ...list];
  }
  return list;
}
// Lista atribuível garantindo que o responsável atual apareça (pra edição inline).
function assignableFor(currentId) {
  const list = assignableUsers().slice();
  if (currentId && !list.find(u => String(u.id) === String(currentId))) {
    const cur = (_users || []).find(u => String(u.id) === String(currentId));
    if (cur) list.unshift(cur);
  }
  return list;
}

export async function pageTarefas(ctx, root) {
  _root = root; _ctx = ctx;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando central…</div></div>';
  await reload();
}

async function reload() {
  try {
    const [t, u, f] = await Promise.all([
      api.request('/api/v3/tasks/list'),
      api.request('/api/v3/users/list').catch(() => ({ users: [] })),
      api.request('/api/v3/tasks/feed').catch(() => ({ items: [], counts: {} })),
    ]);
    _tasks = t.tasks || [];
    _users = u.users || [];
    _feed = f.items || [];
    _feedCounts = f.counts || {};
    _scope = t.scope || 'mine';
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function tabsHTML() {
  const tab = (id, lbl) => `<div class="tk-tab ${_view === id ? 'on' : ''}" data-tk-tab="${id}">${lbl}</div>`;
  return `
    <style>
      .tk-tab{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:999px;font-weight:700;font-size:13px;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:var(--bg-1,#fff);color:var(--ink,#334155)}
      .tk-tab.on{background:#2563eb;border-color:#2563eb;color:#fff}
      .tk-row{display:flex;align-items:center;gap:10px;padding:9px 11px;background:var(--bg-3);border-radius:10px;border-left:4px solid #94a3b8}
      .tk-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:rgba(148,163,184,.16);color:var(--ink,#475569)}
    </style>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      ${tab('central', '🗂 Central (tudo meu)')}
      ${tab('agenda', '📅 Agenda')}
      ${tab('board', '📋 Board de tarefas')}
    </div>`;
}

function wireTabs() {
  _root.querySelectorAll('[data-tk-tab]').forEach(t => t.addEventListener('click', () => { _view = t.dataset.tkTab; render(); }));
}

/* ─────────────────── AGENDA (calendário embutido) ─────────────────── */
function renderAgenda() {
  _root.innerHTML = `<div class="card">${tabsHTML()}<div id="tk-agenda-host"><div class="muted tiny" style="padding:8px"><span class="spinner"></span> Carregando agenda…</div></div></div>`;
  wireTabs();
  const host = document.getElementById('tk-agenda-host');
  if (host) pageAgenda(_ctx, host);   // monta a Agenda (lista + calendário) dentro da central
}

function render() {
  // Sem abas: a página é a Central (tudo do usuário). Agenda/Board viram a Home integrada.
  renderCentral();
}

/* ─────────────────── CENTRAL (feed unificado) ─────────────────── */
const ORIGENS = ['Tarefa', 'Agenda', 'Academy', 'Projeto', 'Captação', 'One-on-One', 'Plantão'];

function renderCentral() {
  const me = auth.user();
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  let list = _feed.slice();
  if (!_cDone) list = list.filter(i => !i.done);
  if (_cOrigem) list = list.filter(i => i.origem === _cOrigem);

  // grupos por urgência
  const G = { atrasado: [], hoje: [], semana: [], depois: [], semdata: [] };
  const sem = new Date(Date.now() + (7 - 3 / 24) * 86400000).toISOString().slice(0, 10);
  list.forEach(i => {
    if (!i.data) return G.semdata.push(i);
    if (i.data < hoje) return G.atrasado.push(i);
    if (i.data === hoje) return G.hoje.push(i);
    if (i.data <= sem) return G.semana.push(i);
    G.depois.push(i);
  });
  Object.values(G).forEach(arr => arr.sort((a, b) => (a.data || '9') < (b.data || '9') ? -1 : 1));

  const c = _feedCounts || {};
  const kpi = (lbl, v, cor) => `<div style="background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:9px 13px;flex:1;min-width:96px"><div class="tiny muted">${lbl}</div><div style="font-size:18px;font-weight:800;color:${cor || 'inherit'}">${v || 0}</div></div>`;

  const sec = (key, lbl, cor) => {
    const arr = G[key];
    if (!arr.length) return '';
    return `<div style="margin-bottom:14px">
      <div style="font-weight:800;font-size:13px;color:${cor};margin-bottom:6px">${lbl} <span class="muted tiny" style="font-weight:400">(${arr.length})</span></div>
      <div style="display:grid;gap:6px">${arr.map(centralRow).join('')}</div>
    </div>`;
  };

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🗂 Minha Central</h2>
      <p class="card-sub">Tudo que é seu pra fazer/acompanhar — tarefas, agenda, prazos de Projetos/Academy, captações, 1:1 e plantões — num lugar só, independente da aba.</p>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        ${kpi('Pendentes', c.pendentes, '#2563eb')}
        ${kpi('⏰ Atrasados', c.atrasados, '#dc2626')}
        ${kpi('📅 Hoje', c.hoje, '#16a34a')}
        ${kpi('Próx. 7 dias', c.semana, '#d97706')}
        ${kpi('Total', c.total)}
      </div>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center">
        <div class="tk-tab ${_cOrigem === '' ? 'on' : ''}" data-orig="">Todas</div>
        ${ORIGENS.map(o => `<div class="tk-tab ${_cOrigem === o ? 'on' : ''}" data-orig="${o}">${o}${c.por_origem && c.por_origem[o] ? ' · ' + c.por_origem[o] : ''}</div>`).join('')}
        <label class="tiny muted" style="margin-left:auto;display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="c-done" ${_cDone ? 'checked' : ''}> mostrar concluídos</label>
        <button class="btn btn-primary" id="btn-new">+ Nova tarefa</button>
      </div>
      <div class="mt-4">
        ${list.length ? '' : '<div class="muted tiny" style="text-align:center;padding:24px">Nada pendente pra você agora. 🎉</div>'}
        ${sec('atrasado', '⏰ Atrasados', '#dc2626')}
        ${sec('hoje', '📅 Hoje', '#16a34a')}
        ${sec('semana', '🗓 Próximos 7 dias', '#d97706')}
        ${sec('depois', '📌 Depois', '#2563eb')}
        ${sec('semdata', '— Sem data', '#64748b')}
      </div>
      <div id="modal-new" style="display:none"></div>
    </div>`;

  _root.querySelectorAll('[data-orig]').forEach(b => b.addEventListener('click', () => { _cOrigem = b.dataset.orig; render(); }));
  document.getElementById('c-done').addEventListener('change', e => { _cDone = e.target.checked; render(); });
  document.getElementById('btn-new').addEventListener('click', () => openNewModal());
  _root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    const link = b.dataset.open;
    if (link === '#/tarefas') { _view = 'board'; render(); }
    else location.hash = link;
  }));
  _root.querySelectorAll('[data-done-tarefa]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api.request('/api/v3/tasks/upsert', { method: 'POST', body: { id: b.dataset.doneTarefa, status: 'concluida' } }); await reload(); }
    catch (e) { alert('Erro: ' + e.message); b.disabled = false; }
  }));
}

function centralRow(i) {
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const dataTxt = i.data ? i.data.split('-').reverse().join('/') : '';
  const overdue = i.data && !i.done && i.data < hoje;
  const cor = i.done ? '#16a34a' : overdue ? '#dc2626' : '#94a3b8';
  return `
    <div class="tk-row" style="border-left-color:${cor}">
      <span style="font-size:16px">${i.ico || '•'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.done ? '<span style="text-decoration:line-through;opacity:.6">' : ''}${escapeHtml(i.titulo)}${i.done ? '</span>' : ''}</div>
        <div class="tiny muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.sub ? escapeHtml(i.sub) : ''}</div>
      </div>
      <span class="tk-chip">${escapeHtml(i.origem)}</span>
      ${dataTxt ? `<span class="tiny" style="color:${overdue ? '#dc2626' : 'var(--ink-muted)'};white-space:nowrap">📅 ${dataTxt}${overdue ? ' ⚠' : ''}</span>` : ''}
      ${i.kind === 'tarefa' && !i.done ? `<button class="btn btn-ghost tiny" data-done-tarefa="${escapeHtml(i.id)}" title="Concluir">✓</button>` : ''}
      <button class="btn btn-ghost tiny" data-open="${escapeHtml(i.link)}" title="Abrir origem">abrir →</button>
    </div>`;
}

function renderBoard(scope) {
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 10;

  // Filtros
  let list = _tasks.slice();
  if (_filterStatus) list = list.filter(t => t.status === _filterStatus);
  if (_filterResp)   list = list.filter(t => t.responsavel === _filterResp);
  if (_filterPrior)  list = list.filter(t => t.prioridade === _filterPrior);

  // Group by status
  const byStatus = {};
  STATUS.forEach(s => byStatus[s.id] = []);
  list.forEach(t => {
    const s = t.status || 'aberta';
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(t);
  });

  // Stats
  const counts = STATUS.reduce((acc, s) => ({ ...acc, [s.id]: (byStatus[s.id] || []).length }), {});

  _root.innerHTML = `
    <div class="card">
      ${tabsHTML()}
      <h2 class="card-title">📋 Tarefas Diretoria</h2>
      <p class="card-sub">
        ${scope === 'mine' ? '👤 Você vê apenas tarefas onde é responsável ou criador. ' : '👁 Visão completa (Sócio/Gerente). '}
        ${_tasks.length} tarefas no Postgres.
      </p>

      <!-- Stats por status -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        ${STATUS.map(s => statChip(s, counts[s.id], _filterStatus === s.id)).join('')}
        ${_filterStatus ? `<button class="btn btn-ghost tiny" id="clr-status">✕ Limpar status</button>` : ''}
      </div>

      <!-- Filtros + Nova -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted" style="font-weight:700">RESPONSÁVEL:</label>
        <select id="f-resp" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todos</option>
          ${selectableUsers(_users, _filterResp).map(u => `<option value="${escapeHtml(u.id)}"${_filterResp === u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">PRIORIDADE:</label>
        <select id="f-prior" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todas</option>
          ${PRIORIDADE.map(p => `<option value="${p.id}"${_filterPrior === p.id ? ' selected' : ''}>${p.lbl}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="btn-new" style="margin-left:auto">+ Nova tarefa</button>
      </div>

      <!-- Listas por status -->
      <div class="mt-4" style="display:grid;gap:14px">
        ${STATUS.map(s => groupBlock(s, byStatus[s.id] || [], isSocio, me?.id)).join('')}
      </div>

      <!-- Modal nova tarefa (oculto inicialmente) -->
      <div id="modal-new" style="display:none"></div>
    </div>
  `;

  // Wire
  document.getElementById('f-resp').addEventListener('change', e => { _filterResp = e.target.value; render(); });
  document.getElementById('f-prior').addEventListener('change', e => { _filterPrior = e.target.value; render(); });
  document.querySelectorAll('[data-status-chip]').forEach(b => b.addEventListener('click', () => {
    _filterStatus = _filterStatus === b.dataset.statusChip ? '' : b.dataset.statusChip;
    render();
  }));
  const cs = document.getElementById('clr-status'); if (cs) cs.addEventListener('click', () => { _filterStatus = ''; render(); });
  document.getElementById('btn-new').addEventListener('click', () => openNewModal());
  document.querySelectorAll('[data-task-action]').forEach(b => b.addEventListener('click', handleTaskAction));
  document.querySelectorAll('[data-task-field]').forEach(s => s.addEventListener('change', handleFieldChange));
}

function statChip(s, count, active) {
  return `
    <button data-status-chip="${s.id}" class="btn" style="padding:6px 14px;background:${active ? s.color : 'var(--bg-3)'};color:${active ? '#fff' : s.color};font-weight:700;border:1px solid ${s.color}">
      ${s.ico} ${s.lbl} <span style="opacity:0.7">·</span> <b>${count}</b>
    </button>
  `;
}

function groupBlock(s, items, isSocio, myId) {
  if (!items.length) return '';
  return `
    <div>
      <h3 style="font-size:14px;color:${s.color};margin:0 0 8px;display:flex;align-items:center;gap:6px">
        ${s.ico} ${s.lbl} <span class="muted tiny" style="font-weight:400">(${items.length})</span>
      </h3>
      <div style="display:grid;gap:6px">
        ${items.map(t => taskRow(t, isSocio, myId)).join('')}
      </div>
    </div>
  `;
}

function taskRow(t, isSocio, myId) {
  const respUser = _users.find(u => u.id === t.responsavel);
  const respLbl = respUser ? respUser.name : (t.responsavel || '— sem responsável —');
  const criador = _users.find(u => u.id === t.criado_por);
  const criadorLbl = criador ? criador.name : (t.criado_por || 'sistema');
  const isMine = t.responsavel === myId || t.criado_por === myId;
  const canEdit = isSocio || isMine;
  const prior = PRIORIDADE.find(p => p.id === t.prioridade) || PRIORIDADE[1];
  const prazoTxt = t.prazo ? new Date(t.prazo).toLocaleDateString('pt-BR') : null;
  const overdue = t.prazo && t.status !== 'concluida' && t.status !== 'cancelada' && new Date(t.prazo) < new Date();
  const histLen = Array.isArray(t.historico) ? t.historico.length : 0;

  return `
    <div style="background:var(--bg-3);border-radius:var(--r-md);padding:12px;border-left:4px solid ${prior.color}">
      <div class="flex items-center gap-2" style="margin-bottom:6px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${escapeHtml(t.titulo || '(sem título)')}</div>
          ${t.descricao ? `<div class="tiny muted" style="margin-top:2px">${escapeHtml(t.descricao)}</div>` : ''}
        </div>
        <span class="tiny" style="background:${prior.color};color:#fff;padding:3px 8px;border-radius:var(--r-full);font-weight:700">${prior.lbl}</span>
        ${overdue ? '<span class="tiny" style="background:#dc2626;color:#fff;padding:3px 8px;border-radius:var(--r-full);font-weight:700">⚠️ ATRASADA</span>' : ''}
      </div>

      <div class="flex gap-3 mt-2" style="flex-wrap:wrap;align-items:center">
        <select class="select" data-task-field="status" data-id="${t.id}" style="padding:4px 10px;font-size:11.5px;font-weight:600" ${canEdit ? '' : 'disabled'}>
          ${STATUS.map(s => `<option value="${s.id}"${t.status === s.id ? ' selected' : ''}>${s.ico} ${s.lbl}</option>`).join('')}
        </select>

        ${isSocio ? `
          <select class="select" data-task-field="responsavel" data-id="${t.id}" style="padding:4px 10px;font-size:11.5px" title="Responsável">
            <option value="">— sem responsável —</option>
            ${assignableFor(t.responsavel).map(u => `<option value="${escapeHtml(u.id)}"${t.responsavel === u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
          </select>
          <select class="select" data-task-field="prioridade" data-id="${t.id}" style="padding:4px 10px;font-size:11.5px">
            ${PRIORIDADE.map(p => `<option value="${p.id}"${t.prioridade === p.id ? ' selected' : ''}>${p.lbl}</option>`).join('')}
          </select>
        ` : `
          <span class="tiny muted">👤 ${escapeHtml(respLbl)} · ${prior.lbl}</span>
        `}

        ${prazoTxt ? `<span class="tiny" style="color:${overdue ? '#dc2626' : 'var(--ink-muted)'}">📅 ${prazoTxt}</span>` : ''}
        ${histLen > 0 ? `<span class="tiny muted">📜 ${histLen} histórico</span>` : ''}

        <span class="tiny muted" style="margin-left:auto">criado por ${escapeHtml(criadorLbl)}</span>

        <button class="btn btn-ghost tiny" data-task-action="comments" data-id="${t.id}" title="Comentários" style="padding:5px 8px">💬</button>
        ${isSocio ? `<button class="btn btn-ghost tiny" data-task-action="delete" data-id="${t.id}" title="Apagar">🗑</button>` : ''}
      </div>
    </div>
  `;
}

// ─── Handlers ────────────────────────────────────────────────────────────
async function handleFieldChange(ev) {
  const el = ev.currentTarget;
  const field = el.dataset.taskField;
  const id = el.dataset.id;
  if (!field || !id) return;
  try {
    await api.request('/api/v3/tasks/upsert', { method: 'POST', body: { id, [field]: el.value } });
    await reload();
  } catch (e) {
    alert('Erro: ' + e.message);
    await reload();
  }
}

async function handleTaskAction(ev) {
  const el = ev.currentTarget;
  const action = el.dataset.taskAction;
  const id = el.dataset.id;
  if (action === 'delete') {
    if (!confirm('Apagar essa tarefa? Não dá pra desfazer.')) return;
    try {
      await api.request('/api/v3/tasks/delete', { method: 'POST', body: { id } });
      await reload();
    } catch (e) { alert('Erro: ' + e.message); }
  } else if (action === 'comments') {
    openCommentsModal(id);
  }
}

function openCommentsModal(taskId) {
  const t = _tasks.find(x => x.id === taskId);
  if (!t) return;
  let modal = document.getElementById('modal-comments');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-comments';
    document.body.appendChild(modal);
  }
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:5vh 20px 20px;overflow:auto';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:560px;width:100%;max-height:90vh;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <h3 style="margin:0;flex:1">💬 Comentários · ${escapeHtml(t.titulo)}</h3>
        <button class="btn btn-ghost" id="cm-close">✕</button>
      </div>
      <div id="comments-host" style="flex:1;overflow-y:auto"></div>
    </div>
  `;
  document.getElementById('cm-close').addEventListener('click', () => modal.remove());
  mountComments(document.getElementById('comments-host'), { target_type: 'task', target_id: taskId });
}

function openNewModal() {
  const modal = document.getElementById('modal-new');
  modal.style.display = 'block';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px 16px;overflow:auto';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:520px;width:90%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">➕ Nova tarefa</h3>
      <div class="field">
        <label>Título *</label>
        <input id="nt-titulo" class="input" placeholder="Ex: Revisar contrato Conquista" required>
      </div>
      <div class="field">
        <label>Descrição</label>
        <textarea id="nt-desc" class="input" rows="2" placeholder="Contexto / detalhes"></textarea>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px">
          <label>Responsável</label>
          <select id="nt-resp" class="select">
            <option value="">— sem responsável —</option>
            ${assignableFor().map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Prioridade</label>
          <select id="nt-prior" class="select">
            ${PRIORIDADE.map(p => `<option value="${p.id}"${p.id === 'media' ? ' selected' : ''}>${p.lbl}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px">
          <label>Início</label>
          <input id="nt-inicio" type="date" class="input">
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Prazo</label>
          <input id="nt-prazo" type="date" class="input">
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Categoria</label>
          <input id="nt-cat" class="input" placeholder="ex: Operação">
        </div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px">
          <label>Hora início</label>
          <input id="nt-hini" type="time" class="input">
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Hora fim</label>
          <input id="nt-hfim" type="time" class="input">
        </div>
      </div>
      <div id="nt-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-ghost" id="nt-cancel">Cancelar</button>
        <button class="btn btn-primary btn-block" id="nt-save">Criar tarefa</button>
      </div>
    </div>
  `;
  document.getElementById('nt-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('nt-save').addEventListener('click', async () => {
    const titulo = document.getElementById('nt-titulo').value.trim();
    if (!titulo) { document.getElementById('nt-msg').innerHTML = '<div class="alert alert-err">Título obrigatório.</div>'; return; }
    try {
      await api.request('/api/v3/tasks/upsert', { method: 'POST', body: {
        titulo,
        descricao:   document.getElementById('nt-desc').value.trim() || null,
        responsavel: document.getElementById('nt-resp').value || null,
        prioridade:  document.getElementById('nt-prior').value,
        inicio:      document.getElementById('nt-inicio').value || null,
        prazo:       document.getElementById('nt-prazo').value || null,
        hora_inicio: document.getElementById('nt-hini').value || null,
        hora_fim:    document.getElementById('nt-hfim').value || null,
        categoria:   document.getElementById('nt-cat').value.trim() || null,
      } });
      modal.style.display = 'none';
      await reload();
    } catch (e) {
      document.getElementById('nt-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
    }
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
