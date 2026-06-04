/* PSM-OS v2 — Arena Live (Sprint 7.22) */
import { api } from '../api.js';
import { router } from '../router.js';

let _root = null, _events = [], _pollTimer = null;

export async function pageArena(ctx, root) { _root = root; router.onCleanup(teardownArena); await reload(); startPoll(); }
export function teardownArena() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }

async function reload() {
  try {
    const r = await api.request('/api/v3/arena/live');
    _events = r.events || [];
    render(r.fetched_at);
  } catch (e) {
    if (_root) _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function startPoll() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(reload, 30000);
  window.addEventListener('hashchange', teardownArena, { once: true });
}

function render(fetchedAt) {
  if (!_root) return;
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📡 Arena PSM Live <span class="tiny muted" style="font-weight:400">— atualiza a cada 30s</span></h2>
      <p class="card-sub">Feed unificado: vendas RD · eventos · recados · tarefas · logins. Atualizado ${new Date(fetchedAt || Date.now()).toLocaleString('pt-BR')}</p>

      <div class="flex gap-2 mt-2">
        <button class="btn btn-ghost" id="ar-reload">🔄 Atualizar</button>
        <span class="tiny muted" style="margin-left:auto;align-self:center">${_events.length} eventos · últimos 7 dias</span>
      </div>

      <div class="mt-4" style="display:grid;gap:8px;max-height:calc(100vh - 280px);overflow-y:auto">
        ${_events.length === 0 ? '<div class="muted text-center" style="padding:30px">Nenhum evento recente.</div>' :
          _events.map(eventRow).join('')}
      </div>
    </div>
  `;
  document.getElementById('ar-reload').addEventListener('click', reload);
}

function eventRow(e) {
  const actor = e.actor;
  const ts = e.ts ? new Date(e.ts).toLocaleString('pt-BR') : '';
  return `
    <div style="display:grid;grid-template-columns:36px 1fr auto;gap:10px;padding:12px 14px;background:var(--bg-3);border-left:4px solid ${e.color};border-radius:var(--r-sm);align-items:center">
      <div style="font-size:22px;text-align:center">${e.ico}</div>
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13.5px">${escapeHtml(e.title)}</div>
        ${e.subtitle ? `<div class="tiny muted" style="margin-top:2px">${escapeHtml(e.subtitle)}</div>` : ''}
        ${actor ? `<div class="tiny" style="color:${actor.color || 'var(--ink-muted)'};margin-top:3px;font-weight:600">👤 ${escapeHtml(actor.name)}</div>` : ''}
      </div>
      <div class="tiny muted" style="white-space:nowrap;align-self:flex-start">${ts}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
