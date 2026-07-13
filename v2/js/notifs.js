/* ============================================================================
   PSM-OS v2 — Notifications bell + drawer
   Sprint 7.15
============================================================================ */
import { api } from './api.js';

let _drawerEl = null;
let _unread = 0;
let _items = [];
let _pollTimer = null;

const TIPO_ICO = {
  'comment.new':   '💬',
  'task.assigned': '📋',
  'task.status':   '🔄',
  'recado.novo':   '📢',
  'captacao':      '📥',
  'premiacao':     '🏆',
  'oportunidade':  '💡',
  'canal':         '🔒',
};

export function initNotifs() {
  const btn = document.getElementById('btn-notif');
  if (!btn) return;
  btn.addEventListener('click', toggleDrawer);
  // Poll a cada 30s (tempo real entre devices)
  refresh();
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(refresh, 30000);
}

export function teardownNotifs() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// Atualização sob demanda (ex.: ao focar a aba) — usada pelo refresh global. v81.26
export function refreshNotifs() { return refresh().catch(() => {}); }

async function refresh() {
  try {
    const r = await api.request('/api/v3/notifications/list?limit=30');
    const prevUnread = _unread;
    _unread = r.unread_total || 0;
    _items = r.notifications || [];
    updateBadge();
    if (_drawerEl) renderDrawer();
    // Toca som se chegou notif nova
    if (_unread > prevUnread && prevUnread != null) {
      const newest = _items[0];
      const tipo = newest?.tipo || '';
      try {
        if (tipo === 'comment.new' || tipo === 'task.assigned' || tipo === 'task.status' || tipo === 'captacao') {
          window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'notif' }));
        } else if (tipo === 'recado.novo') {
          window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'alerta' }));
        }
      } catch {}
    }
  } catch (e) {
    console.warn('[notifs] refresh err:', e);
  }
}

function updateBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (_unread > 0) {
    badge.textContent = _unread > 99 ? '99+' : _unread;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function toggleDrawer() {
  if (_drawerEl) {
    _drawerEl.remove();
    _drawerEl = null;
    return;
  }
  _drawerEl = document.createElement('div');
  _drawerEl.style.cssText = 'position:fixed;top:56px;right:10px;width:380px;max-width:calc(100vw - 20px);max-height:calc(100vh - 80px);background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:0 8px 24px rgba(0,0,0,0.2);z-index:9998;overflow:hidden;display:flex;flex-direction:column';
  document.body.appendChild(_drawerEl);
  renderDrawer();

  // Click outside to close
  setTimeout(() => {
    document.addEventListener('click', closeOnOutside, { capture: true });
  }, 100);
}

function closeOnOutside(ev) {
  if (!_drawerEl) return;
  if (_drawerEl.contains(ev.target) || ev.target.id === 'btn-notif' || ev.target.id === 'notif-badge') return;
  _drawerEl.remove();
  _drawerEl = null;
  document.removeEventListener('click', closeOnOutside, { capture: true });
}

function renderDrawer() {
  if (!_drawerEl) return;
  _drawerEl.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
      <h3 style="margin:0;font-size:14px;flex:1">🔔 Notificações ${_unread ? `<span class="tiny" style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:var(--r-full);font-weight:700">${_unread} novas</span>` : ''}</h3>
      ${_unread > 0 ? '<button class="btn btn-ghost tiny" id="notif-mark-all" style="padding:4px 10px">✓ Marcar todas</button>' : ''}
    </div>
    <div style="flex:1;overflow-y:auto;padding:8px">
      ${_items.length === 0 ? '<div class="muted text-center" style="padding:30px">Nada por aqui ainda.</div>' :
        _items.map(notifRow).join('')
      }
    </div>
  `;
  const ma = document.getElementById('notif-mark-all');
  if (ma) ma.addEventListener('click', markAll);
  _drawerEl.querySelectorAll('[data-notif]').forEach(el => el.addEventListener('click', () => onClick(el.dataset.notif)));
}

function notifRow(n) {
  const ico = TIPO_ICO[n.tipo] || '🔔';
  const ts = relTime(n.created_at);
  const unreadStyle = !n.lida ? 'background:#dbeafe;border-left:3px solid #2563eb' : 'background:var(--bg-3);border-left:3px solid transparent';
  return `
    <div data-notif="${n.id}" style="${unreadStyle};margin-bottom:6px;padding:10px 12px;border-radius:var(--r-sm);cursor:pointer;font-size:12.5px">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <span style="font-size:16px">${ico}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:${n.lida ? 600 : 700};color:var(--ink)">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="tiny muted" style="margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(n.body)}</div>` : ''}
          <div class="tiny muted" style="margin-top:4px">${ts}</div>
        </div>
        ${!n.lida ? '<span style="width:8px;height:8px;border-radius:50%;background:#2563eb;margin-top:6px"></span>' : ''}
      </div>
    </div>
  `;
}

async function onClick(id) {
  const n = _items.find(x => x.id === id);
  if (!n) return;
  if (!n.lida) {
    try { await api.request('/api/v3/notifications/mark_read', { method: 'POST', body: { ids: [id] } }); } catch {}
  }
  if (n.link) {
    if (_drawerEl) { _drawerEl.remove(); _drawerEl = null; }
    // Backends gravavam link em 3 formatos ("#/x", "/x", "/#/x") — o último virava
    // hash duplo "#/#/x" → 404 em TODO clique de notificação. Normaliza sempre. v84.21.1
    location.hash = '#/' + String(n.link).replace(/^[\/#]+/, '');
  }
  refresh();
}

async function markAll() {
  try {
    await api.request('/api/v3/notifications/mark_read', { method: 'POST', body: { all: true } });
    await refresh();
  } catch (e) { alert('Erro: ' + e.message); }
}

function relTime(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return m + ' min atrás';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h atrás';
  const d = Math.round(h / 24);
  if (d < 30) return d + 'd atrás';
  return new Date(iso).toLocaleDateString('pt-BR');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
