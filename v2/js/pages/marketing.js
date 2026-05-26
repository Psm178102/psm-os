/* ============================================================================
   PSM-OS v2 — Meta Ads dashboard
   Sprint 7.19
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const PRESETS = [
  { id: 'today',         lbl: 'Hoje' },
  { id: 'yesterday',     lbl: 'Ontem' },
  { id: 'last_7d',       lbl: 'Últimos 7 dias' },
  { id: 'last_30d',      lbl: 'Últimos 30 dias' },
  { id: 'this_month',    lbl: 'Mês atual' },
  { id: 'last_month',    lbl: 'Mês anterior' },
];

let _root = null;
let _data = null;
let _preset = 'last_30d';
let _filter = '';
let _sort = 'spend';

export async function pageMarketing(ctx, root) {
  _root = root;
  const me = auth.user();
  if ((me?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl ≥ 5).</div>';
    return;
  }
  await reload();
}

async function reload() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando Meta Ads (cache 5min)…</div></div>';
  try {
    _data = await api.request('/api/v3/marketing/summary?date_preset=' + _preset);
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const d = _data || {};
  if (d.error) { _root.innerHTML = `<div class="alert alert-err">${escapeHtml(d.error)}</div>`; return; }

  const accounts = d.accounts || [];
  const totals = d.totals || {};
  let campaigns = d.campaigns || [];

  // Filter
  if (_filter) {
    const q = _filter.toLowerCase();
    campaigns = campaigns.filter(c => (c.name || '').toLowerCase().includes(q) || (c.account_label || '').toLowerCase().includes(q));
  }

  // Sort
  campaigns = campaigns.slice().sort((a, b) => {
    if (_sort === 'spend')      return (b.spend || 0) - (a.spend || 0);
    if (_sort === 'cpl')        return (a.cpl || 9e9) - (b.cpl || 9e9);
    if (_sort === 'results')    return (b.results || 0) - (a.results || 0);
    if (_sort === 'impressions')return (b.impressions || 0) - (a.impressions || 0);
    return 0;
  });

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📢 Meta Ads · Marketing</h2>
      <p class="card-sub">
        ${accounts.length} conta(s) Meta · ${d.cached ? '📦 Cache' : '🔥 Fresh'} · Atualizado ${d.fetchedAt ? new Date(d.fetchedAt).toLocaleString('pt-BR') : 'agora'}
      </p>

      <!-- Filtros -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted" style="font-weight:700">PERÍODO:</label>
        <select id="ma-preset" class="select" style="padding:5px 10px;font-size:12px">
          ${PRESETS.map(p => `<option value="${p.id}"${p.id === _preset ? ' selected' : ''}>${p.lbl}</option>`).join('')}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:14px">BUSCAR:</label>
        <input id="ma-filter" class="input" placeholder="campanha ou conta…" value="${escapeHtml(_filter)}" style="padding:5px 10px;font-size:12px;width:200px">
        <label class="tiny muted" style="font-weight:700;margin-left:14px">ORDENAR:</label>
        <select id="ma-sort" class="select" style="padding:5px 10px;font-size:12px">
          <option value="spend"${_sort==='spend'?' selected':''}>Spend ↓</option>
          <option value="cpl"${_sort==='cpl'?' selected':''}>CPL ↑</option>
          <option value="results"${_sort==='results'?' selected':''}>Resultados ↓</option>
          <option value="impressions"${_sort==='impressions'?' selected':''}>Impressões ↓</option>
        </select>
        <button class="btn btn-ghost" id="ma-reload" style="margin-left:auto">🔄</button>
      </div>

      <!-- Hero KPIs -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('💰 Spend total', 'R$ ' + money(totals.spend), 'no período', '#dc2626')}
        ${kpi('👁 Impressões',  fmtNum(totals.impressions), 'people reached: ' + fmtNum(totals.reach), '#2563eb')}
        ${kpi('🎯 Resultados',  fmtNum(totals.results), totals.cpl ? `CPL: R$ ${money(totals.cpl)}` : '', '#16a34a')}
        ${kpi('📊 CTR',          (totals.ctr != null ? totals.ctr.toFixed(2) + '%' : '—'), `CPM: R$ ${money(totals.cpm)}`, '#7c3aed')}
      </div>

      <!-- Contas -->
      ${accounts.length > 0 ? `
        <div class="card mt-4" style="margin-top:14px">
          <h3 class="card-title">🏢 Contas Meta</h3>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="background:var(--bg-3);border-bottom:1px solid var(--border)">
              <th style="text-align:left;padding:6px 10px">Conta</th>
              <th style="text-align:right;padding:6px 10px">Spend</th>
              <th style="text-align:right;padding:6px 10px">Impressões</th>
              <th style="text-align:right;padding:6px 10px">Resultados</th>
              <th style="text-align:right;padding:6px 10px">CPL</th>
            </tr></thead>
            <tbody>
              ${accounts.map(a => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:5px 10px;font-weight:600">${escapeHtml(a.label || a.id)}</td>
                  <td style="text-align:right;padding:5px 10px;color:#dc2626">R$ ${money(a.spend)}</td>
                  <td style="text-align:right;padding:5px 10px">${fmtNum(a.impressions)}</td>
                  <td style="text-align:right;padding:5px 10px;color:#16a34a">${fmtNum(a.results)}</td>
                  <td style="text-align:right;padding:5px 10px">${a.cpl ? 'R$ ' + money(a.cpl) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      <!-- Campanhas -->
      <div class="card mt-4" style="margin-top:14px">
        <h3 class="card-title">🎯 Campanhas <span class="muted tiny" style="font-weight:400">(${campaigns.length})</span></h3>
        ${campaigns.length === 0 ? '<div class="muted tiny">Sem campanhas no período.</div>' : `
          <div style="overflow-x:auto">
            <table style="width:100%;font-size:11.5px;border-collapse:collapse;min-width:780px">
              <thead><tr style="background:var(--bg-3);border-bottom:1px solid var(--border)">
                <th style="text-align:left;padding:6px 8px">Status</th>
                <th style="text-align:left;padding:6px 8px">Conta</th>
                <th style="text-align:left;padding:6px 8px">Campanha</th>
                <th style="text-align:right;padding:6px 8px">Spend</th>
                <th style="text-align:right;padding:6px 8px">Imp.</th>
                <th style="text-align:right;padding:6px 8px">CTR</th>
                <th style="text-align:right;padding:6px 8px">Resultados</th>
                <th style="text-align:right;padding:6px 8px">CPL</th>
              </tr></thead>
              <tbody>
                ${campaigns.map(campaignRow).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;

  // Wire
  document.getElementById('ma-preset').addEventListener('change', async e => { _preset = e.target.value; await reload(); });
  document.getElementById('ma-filter').addEventListener('input', e => { _filter = e.target.value; render(); });
  document.getElementById('ma-sort').addEventListener('change', e => { _sort = e.target.value; render(); });
  document.getElementById('ma-reload').addEventListener('click', async () => { await reload(); });
}

function campaignRow(c) {
  const statusColor = c.effective_status === 'ACTIVE' ? '#16a34a' : c.effective_status === 'PAUSED' ? '#d97706' : 'var(--ink-muted)';
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px"><span style="background:${statusColor};color:#fff;padding:2px 8px;border-radius:var(--r-full);font-size:10px;font-weight:700">${escapeHtml((c.effective_status || c.status || 'N/A').substring(0, 8))}</span></td>
      <td style="padding:5px 8px;font-size:11px" class="muted">${escapeHtml(c.account_label || '')}</td>
      <td style="padding:5px 8px;font-weight:600;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '—')}</td>
      <td style="text-align:right;padding:5px 8px;color:#dc2626">R$ ${money(c.spend)}</td>
      <td style="text-align:right;padding:5px 8px">${fmtNum(c.impressions)}</td>
      <td style="text-align:right;padding:5px 8px">${c.ctr != null ? c.ctr.toFixed(2) + '%' : '—'}</td>
      <td style="text-align:right;padding:5px 8px;color:#16a34a">${fmtNum(c.results)}</td>
      <td style="text-align:right;padding:5px 8px;font-weight:700">${c.cpl ? 'R$ ' + money(c.cpl) : '—'}</td>
    </tr>
  `;
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:20px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
    <div class="tiny muted">${sub || ''}</div>
  </div>`;
}
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function money(n) {
  if (n == null || isNaN(n)) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
