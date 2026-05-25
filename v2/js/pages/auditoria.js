/* ============================================================================
   PSM-OS v2 — Auditoria
   Mostra histórico completo de ações: quem fez o quê, quando.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const ACTION_LABELS = {
  'auth.login_ok':              { ico: '🔓', lbl: 'Login OK',                color: '#16a34a' },
  'auth.login_fail':            { ico: '⛔', lbl: 'Login falhou',            color: '#dc2626' },
  'auth.bootstrap_password':    { ico: '🆕', lbl: 'Senha inicial definida',   color: '#0891b2' },
  'auth.change_password':       { ico: '🔐', lbl: 'Senha alterada',          color: '#7c3aed' },
  'auth.admin_set_password':    { ico: '🔧', lbl: 'Senha alterada (admin)',  color: '#d97706' },
  'auth.admin_reset_password':  { ico: '🔑', lbl: 'Senha resetada (Sócio)',  color: '#d97706' },
  'user.create':                { ico: '➕', lbl: 'Usuário criado',           color: '#16a34a' },
  'user.update':                { ico: '✏️', lbl: 'Usuário atualizado',      color: '#2563eb' },
  'user.delete':                { ico: '🗑',  lbl: 'Usuário removido',        color: '#dc2626' },
};

let _entries = [];
let _filterAction = '';
let _filterTarget = '';
let _filterActor  = '';
let _root = null;

export async function pageAuditoria(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando trilha…</div></div>';
  await reload();
}

async function reload() {
  try {
    const qs = new URLSearchParams();
    if (_filterAction) qs.set('action', _filterAction);
    if (_filterTarget) qs.set('target_id', _filterTarget);
    if (_filterActor)  qs.set('actor_id',  _filterActor);
    qs.set('limit', '300');
    const r = await api.request('/api/v3/audit/list?' + qs.toString());
    _entries = r.entries || [];
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 10;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📜 Trilha de Auditoria</h2>
      <p class="card-sub">
        Quem fez o quê, quando. Toda mudança em usuários, senhas e logins fica registrada aqui.
        ${isSocio ? '' : '<br><b>Você vê apenas eventos relacionados a você (Sócio vê tudo).</b>'}
      </p>

      <div class="flex gap-3 items-center mt-3" style="padding:10px;background:var(--bg-3);border-radius:var(--r-sm);flex-wrap:wrap">
        <label class="tiny muted" style="font-weight:700;letter-spacing:1px">AÇÃO:</label>
        <select id="f-action" class="select">
          <option value="">Todas</option>
          <option value="user">Usuários (user.*)</option>
          <option value="auth">Autenticação (auth.*)</option>
        </select>
        <label class="tiny muted" style="font-weight:700;letter-spacing:1px;margin-left:14px">USER ALVO:</label>
        <input id="f-target" class="input" placeholder="ex: paulo" style="padding:5px 10px;font-size:12px;width:160px" value="${escapeHtml(_filterTarget)}">
        <label class="tiny muted" style="font-weight:700;letter-spacing:1px;margin-left:14px">USER QUE FEZ:</label>
        <input id="f-actor" class="input" placeholder="ex: kaue" style="padding:5px 10px;font-size:12px;width:160px" value="${escapeHtml(_filterActor)}">
        <button id="f-apply" class="btn btn-primary" style="margin-left:auto">Filtrar</button>
        <button id="f-clear" class="btn btn-ghost">Limpar</button>
      </div>

      <div class="tiny muted mt-2">${_entries.length} entrada(s) carregadas (últimas).</div>

      <div class="mt-4" style="display:grid;gap:6px;max-height:calc(100vh - 280px);overflow-y:auto">
        ${_entries.map(e => entryRow(e)).join('') || '<div class="muted text-center" style="padding:30px">Nenhuma entrada com esse filtro.</div>'}
      </div>
    </div>
  `;

  document.getElementById('f-apply').addEventListener('click', () => {
    _filterAction = document.getElementById('f-action').value;
    _filterTarget = document.getElementById('f-target').value.trim();
    _filterActor  = document.getElementById('f-actor').value.trim();
    reload();
  });
  document.getElementById('f-clear').addEventListener('click', () => {
    _filterAction = ''; _filterTarget = ''; _filterActor = '';
    reload();
  });
}

function entryRow(e) {
  const meta = ACTION_LABELS[e.action] || { ico: '·', lbl: e.action, color: 'var(--ink-muted)' };
  const ts = new Date(e.ts).toLocaleString('pt-BR');
  const actor = e.actor_name || e.actor_id || '<sistema>';
  const target = e.target_id ? `<b>${escapeHtml(e.target_id)}</b>` : '—';
  const beforeAfter = (e.before_data || e.after_data) ? changesSummary(e.before_data, e.after_data) : '';
  return `
    <div style="display:grid;grid-template-columns:24px 150px 1fr auto;gap:10px;padding:10px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:var(--r-sm);align-items:center;font-size:12.5px">
      <div style="font-size:18px">${meta.ico}</div>
      <div style="font-weight:700;color:${meta.color}">${meta.lbl}</div>
      <div style="min-width:0">
        <div><b>${escapeHtml(actor)}</b> → ${target}${e.notes ? ' · <span class="muted">' + escapeHtml(e.notes) + '</span>' : ''}</div>
        ${beforeAfter ? `<div class="tiny muted" style="margin-top:2px">${beforeAfter}</div>` : ''}
      </div>
      <div class="tiny muted" style="white-space:nowrap" title="${e.ip || ''} · ${escapeHtml(e.user_agent || '')}">${ts}</div>
    </div>
  `;
}

function changesSummary(before, after) {
  if (!after) return '';
  const b = before || {};
  const a = after  || {};
  const keys = new Set([...Object.keys(b).filter(k => k !== 'id'), ...Object.keys(a).filter(k => k !== 'id')]);
  const parts = [];
  keys.forEach(k => {
    const bv = b[k];
    const av = a[k];
    if (bv === av) return;
    parts.push(`<code>${escapeHtml(k)}</code>: <s>${escapeHtml(String(bv ?? '∅'))}</s> → <b>${escapeHtml(String(av ?? '∅'))}</b>`);
  });
  return parts.join(' · ');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
