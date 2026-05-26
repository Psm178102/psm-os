/* PSM-OS v2 — Captações (Sprint 7.24) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _data = null, _days = 90;

export async function pageCaptacoes(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder.</div>'; return; }
  await reload();
}

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando captações…</div></div>';
  try {
    const since = new Date(Date.now() - _days * 86400000).toISOString().slice(0, 10);
    _data = await api.request('/api/v3/captacoes/list?since=' + since);
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const ranking = _data.ranking || [];
  const imoveis = _data.imoveis || [];
  const totVal = ranking.reduce((s, r) => s + (r.valor || 0), 0);

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📥 Captações</h2>
      <p class="card-sub">Relatório de imóveis captados nos últimos ${_days} dias. ${_data.count || 0} imóveis · ${ranking.length} captadores ativos · R$ ${money(totVal)} em valor captado.</p>

      <div class="flex gap-2 mt-3" style="align-items:center">
        <label class="tiny muted">PERÍODO:</label>
        ${[30, 60, 90, 180, 365].map(d => `<button class="btn ${_days===d?'btn-primary':'btn-ghost'}" data-days="${d}">${d}d</button>`).join('')}
      </div>

      <h3 class="card-title mt-4">🏆 Ranking de captadores</h3>
      ${ranking.length === 0 ? '<div class="muted tiny">Nenhuma captação no período.</div>' : `
        <div style="display:grid;gap:6px">
          ${ranking.map((r, i) => rankRow(r, i)).join('')}
        </div>
      `}

      <h3 class="card-title mt-4">📋 Últimos ${Math.min(imoveis.length, 50)} imóveis captados</h3>
      ${imoveis.length === 0 ? '<div class="muted tiny">Sem imóveis no período.</div>' : `
        <div style="max-height:480px;overflow-y:auto">
          <table style="width:100%;font-size:11.5px;border-collapse:collapse">
            <thead><tr style="background:var(--bg-3);position:sticky;top:0">
              <th style="text-align:left;padding:6px 8px">Data</th>
              <th style="text-align:left;padding:6px 8px">Código</th>
              <th style="text-align:left;padding:6px 8px">Endereço</th>
              <th style="text-align:right;padding:6px 8px">Valor</th>
              <th style="text-align:center;padding:6px 8px">Status</th>
            </tr></thead>
            <tbody>
              ${imoveis.slice(0, 50).map(im => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:5px 8px" class="muted">${im.created_at ? new Date(im.created_at).toLocaleDateString('pt-BR') : '—'}</td>
                  <td style="padding:5px 8px;font-weight:600">${escapeHtml(im.codigo || '—')}</td>
                  <td style="padding:5px 8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(im.endereco || '')}">${escapeHtml(im.endereco || '')}</td>
                  <td style="text-align:right;padding:5px 8px">R$ ${money(im.valor)}</td>
                  <td style="text-align:center;padding:5px 8px"><span class="tiny" style="padding:2px 8px;border-radius:var(--r-full);background:${statusColor(im.status)};color:#fff;font-weight:600">${escapeHtml(im.status || '—')}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
  document.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', async () => {
    _days = parseInt(b.dataset.days); await reload();
  }));
}

function rankRow(r, i) {
  const u = r.user;
  const ini = escapeHtml((u?.ini || (u?.name || '?').substring(0, 2)).toUpperCase());
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
  return `
    <div style="display:grid;grid-template-columns:40px 36px 1fr auto auto;gap:10px;padding:10px 14px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:12.5px">
      <div style="font-size:${i<3?'20px':'13px'};text-align:center;font-weight:800">${medal}</div>
      <div style="width:32px;height:32px;border-radius:var(--r-sm);background:${u?.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px">${ini}</div>
      <div>
        <div style="font-weight:700">${escapeHtml(u?.name || r.captador_id)}</div>
        <div class="tiny muted">${escapeHtml(u?.team || '')} · ${r.disponiveis} disponíveis · ${r.vendidos} vendidos</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:16px;font-weight:900;color:#2563eb">${r.total}</div>
        <div class="tiny muted">imóveis</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14px;font-weight:800;color:#7c3aed">R$ ${money(r.valor)}</div>
        <div class="tiny muted">total</div>
      </div>
    </div>
  `;
}

function statusColor(s) {
  if (s === 'disponivel') return '#16a34a';
  if (s === 'vendido') return '#7c3aed';
  if (s === 'em_negociacao') return '#d97706';
  return '#64748b';
}
function money(n) { return n == null || isNaN(n) ? '0' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
