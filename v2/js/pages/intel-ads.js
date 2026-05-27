/* PSM-OS v2 — Inteligência Ads (Meta Library) (Sprint 8.3) */
import { api } from '../api.js';

let _root = null;
let _concorrentes = [];
let _segFilter = 'all';

const SEGMENTOS = ['all', 'MAP', 'MCMV', 'Terceiros', 'Locacao'];

export async function pageIntelAds(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/concorrentes/list');
    _concorrentes = (r.concorrentes || []).map(c => ({
      ...c,
      anuncios_count: +(c.anuncios_count || 0),
    }));
    renderContent();
  } catch (e) {
    document.getElementById('ads-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card" style="background:#0b1120;color:#e2e8f0;padding:22px;min-height:80vh">
      <div class="flex" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px">
        <div class="flex" style="align-items:center;gap:14px">
          <span style="font-size:36px;color:#d4af37">📢</span>
          <div>
            <h2 style="margin:0;color:#fff;font-size:22px">Inteligência Ads</h2>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">Biblioteca de Anúncios Meta — monitora concorrentes</p>
          </div>
        </div>
        <a href="https://www.facebook.com/ads/library/?country=BR" target="_blank" rel="noopener" class="btn btn-primary" style="background:#d4af37;color:#0a1628">🔗 Abrir Meta Ads Library</a>
      </div>

      <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:16px">
        ${SEGMENTOS.map(s => `<button class="btn ${_segFilter === s ? 'btn-primary' : 'btn-ghost'} btn-sm" data-seg="${s}">${s === 'all' ? '🌐 Todos' : s}</button>`).join('')}
      </div>

      <div id="ads-body"><div class="muted tiny"><span class="spinner"></span> Carregando concorrentes…</div></div>
    </div>
  `;
  _root.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => {
    _segFilter = b.dataset.seg;
    render();
    renderContent();
  }));
}

function renderContent() {
  const body = document.getElementById('ads-body');
  if (!_concorrentes.length) {
    body.innerHTML = '<div style="background:#1e293b;padding:30px;border-radius:10px;text-align:center;color:#64748b">Sem concorrentes cadastrados.</div>';
    return;
  }
  const filtered = _segFilter === 'all'
    ? _concorrentes
    : _concorrentes.filter(c => (c.segmento || '').toLowerCase() === _segFilter.toLowerCase());
  filtered.sort((a, b) => b.anuncios_count - a.anuncios_count);

  const totalAds = filtered.reduce((s, c) => s + (+c.anuncios_count || 0), 0);
  const withAds = filtered.filter(c => c.anuncios_count > 0).length;
  const top = filtered.length > 0 && filtered[0].anuncios_count > 0 ? filtered[0] : null;

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;margin-bottom:18px">
      ${kpi('Concorrentes', filtered.length, '#3b82f6')}
      ${kpi('Total Anúncios', totalAds, '#22c55e')}
      ${kpi('Com Anúncios', withAds, '#f59e0b')}
      ${kpi('Top Anunciante', top ? `${top.anuncios_count}` : '—', '#d4af37', top?.nome)}
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#1e293b;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#0f172a">
        <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px;text-transform:uppercase">#</th>
        <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px;text-transform:uppercase">Concorrente</th>
        <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px;text-transform:uppercase">Segmento</th>
        <th style="padding:10px;text-align:center;color:#d4af37;font-size:11px;text-transform:uppercase">Tier</th>
        <th style="padding:10px;text-align:right;color:#d4af37;font-size:11px;text-transform:uppercase">Anúncios</th>
        <th style="padding:10px;text-align:center;color:#d4af37;font-size:11px;text-transform:uppercase">Ads Library</th>
      </tr></thead>
      <tbody>
        ${filtered.map((c, i) => `
          <tr style="border-bottom:1px solid #334155">
            <td style="padding:8px 10px;color:#94a3b8">${i + 1}</td>
            <td style="padding:8px 10px;color:#fff;font-weight:600">${esc(c.nome || '—')}<div style="font-size:10px;color:#94a3b8">${esc(c.link || '')}</div></td>
            <td style="padding:8px 10px;color:#94a3b8">${esc(c.segmento || '—')}</td>
            <td style="padding:8px 10px;text-align:center"><span style="padding:2px 8px;border-radius:4px;background:${tierColor(c.tier)};color:#fff;font-size:11px;font-weight:700">${esc(c.tier || '—')}</span></td>
            <td style="padding:8px 10px;text-align:right;font-weight:800;color:${c.anuncios_count > 0 ? '#22c55e' : '#64748b'}">${c.anuncios_count || 0}</td>
            <td style="padding:8px 10px;text-align:center">
              <a href="${adLibUrl(c.nome)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="font-size:11px">🔗 Abrir</a>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function adLibUrl(name) {
  return 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q=' + encodeURIComponent((name || '').replace(/[&]/g, '')) + '&search_type=keyword_unordered';
}

function tierColor(tier) {
  if (tier === 'A') return '#f59e0b';
  if (tier === 'B') return '#3b82f6';
  return '#64748b';
}

function kpi(label, value, color, sub) {
  return `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px">
      <div style="color:#64748b;font-size:10px;text-transform:uppercase;font-weight:700;margin-bottom:4px">${label}</div>
      <div style="color:${color};font-size:22px;font-weight:800">${value}</div>
      ${sub ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(sub)}</div>` : ''}
    </div>
  `;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
