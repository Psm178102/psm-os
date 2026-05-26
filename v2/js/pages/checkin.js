/* PSM-OS v2 — Check-in / out (Sprint 7.23) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _data = null;

export async function pageCheckin(ctx, root) { _root = root; await reload(); }

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    _data = await api.request('/api/v3/checkin/list');
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const dentro = _data.status === 'dentro';
  const today = _data.today || {};
  const hist = _data.history || [];

  // Agrupa histórico por dia
  const byDate = {};
  hist.forEach(h => {
    const d = h.ts.substring(0, 10);
    (byDate[d] = byDate[d] || []).push(h);
  });
  const days = Object.keys(byDate).sort().reverse().slice(0, 30);

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📍 Check-in / Check-out</h2>
      <p class="card-sub">Registro de presença diária. ${dentro ? '🟢 Você está <b>NA EMPRESA</b>' : '⚪ Você está <b>FORA</b>'}</p>

      <div style="display:flex;justify-content:center;margin:24px 0">
        <button id="btn-toggle" class="btn ${dentro ? 'btn-danger' : 'btn-primary'}" style="padding:24px 48px;font-size:18px;border-radius:var(--r-lg);box-shadow:var(--shadow-md)">
          ${dentro ? '🚪 Fazer Check-OUT' : '🟢 Fazer Check-IN'}
        </button>
      </div>

      <div class="flex gap-3" style="flex-wrap:wrap;justify-content:center">
        ${kpi('Hoje · Check-ins', today.ins || 0)}
        ${kpi('Hoje · Check-outs', today.outs || 0)}
        ${kpi('Últimos 30 dias', hist.length + ' registros')}
      </div>

      <h3 class="card-title mt-4">🕐 Histórico (30 dias)</h3>
      <div style="display:grid;gap:8px;max-height:480px;overflow-y:auto">
        ${days.length === 0 ? '<div class="muted text-center" style="padding:30px">Sem registros ainda. Clica em Check-in pra começar.</div>' :
          days.map(d => dayBlock(d, byDate[d])).join('')}
      </div>
    </div>
  `;
  document.getElementById('btn-toggle').addEventListener('click', toggle);
}

function dayBlock(date, items) {
  const dt = new Date(date + 'T12:00:00');
  const dataFmt = dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:8px 12px">
      <div class="tiny muted" style="font-weight:700;text-transform:uppercase;margin-bottom:4px">${escapeHtml(dataFmt)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${items.sort((a,b) => a.ts.localeCompare(b.ts)).map(i => `
          <span class="tiny" style="background:${i.tipo === 'in' ? '#dcfce7;color:#166534' : '#fee2e2;color:#991b1b'};padding:3px 10px;border-radius:var(--r-full);font-weight:600">
            ${i.tipo === 'in' ? '🟢 IN' : '🚪 OUT'} ${new Date(i.ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

async function toggle() {
  const btn = document.getElementById('btn-toggle');
  btn.disabled = true;
  try {
    const r = await api.request('/api/v3/checkin/toggle', { method: 'POST', body: {} });
    await reload();
  } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; }
}

function kpi(label, value) {
  return `<div style="background:var(--bg-3);padding:10px 16px;border-radius:var(--r-sm);min-width:140px;text-align:center">
    <div class="tiny muted">${label}</div>
    <div style="font-size:18px;font-weight:800">${value}</div>
  </div>`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
