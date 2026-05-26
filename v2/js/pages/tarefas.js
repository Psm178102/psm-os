/* ============================================================================
   PSM-OS v2 — Tarefas Diretoria
   Sprint 7.6
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

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
let _filterStatus = '';
let _filterResp = '';
let _filterPrior = '';

export async function pageTarefas(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando tarefas…</div></div>';
  await reload();
}

async function reload() {
  try {
    const [t, u] = await Promise.all([
      api.request('/api/v3/tasks/list'),
      api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _tasks = t.tasks || [];
    _users = u.users || [];
    render(t.scope);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render(scope) {
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
          ${_users.map(u => `<option value="${escapeHtml(u.id)}"${_filterResp === u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
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
  document.getElementById('f-resp').addEventListener('change', e => { _filterResp = e.target.value; render(scope); });
  document.getElementById('f-prior').addEventListener('change', e => { _filterPrior = e.target.value; render(scope); });
  document.querySelectorAll('[data-status-chip]').forEach(b => b.addEventListener('click', () => {
    _filterStatus = _filterStatus === b.dataset.statusChip ? '' : b.dataset.statusChip;
    render(scope);
  }));
  const cs = document.getElementById('clr-status'); if (cs) cs.addEventListener('click', () => { _filterStatus = ''; render(scope); });
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
            ${_users.map(u => `<option value="${escapeHtml(u.id)}"${t.responsavel === u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
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
  }
}

function openNewModal() {
  const modal = document.getElementById('modal-new');
  modal.style.display = 'block';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
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
            ${_users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join('')}
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
