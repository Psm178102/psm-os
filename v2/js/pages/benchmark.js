/* PSM-OS v2 — Benchmark de Mercado (Sprint 8.3) */
import { api } from '../api.js';

let _root = null;
let _concorrentes = [];

const METRICAS = [
  { key: 'seguidores',     label: 'Seguidores',       icon: '👥', format: v => v ? Number(v).toLocaleString('pt-BR') : '—' },
  { key: 'engajamento',    label: 'Engajamento (%)',  icon: '💬', format: v => v ? v + '%' : '—' },
  { key: 'anuncios_count', label: 'Anúncios Ativos',  icon: '📢', format: v => v || '—' },
  { key: 'imoveis_ativos', label: 'Imóveis Ativos',   icon: '🏠', format: v => v || '—' },
];

export async function pageBenchmark(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/concorrentes/list');
    _concorrentes = r.concorrentes || [];
    renderContent();
  } catch (e) {
    document.getElementById('bm-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card" style="background:#0f172a;color:#e2e8f0;padding:24px;min-height:80vh">
      <div class="flex" style="align-items:center;gap:14px;margin-bottom:20px">
        <span style="font-size:36px;color:#d4af37">📊</span>
        <div>
          <h2 style="margin:0;color:#fff;font-size:24px">Benchmark de Mercado</h2>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">Análise comparativa de concorrentes</p>
        </div>
      </div>
      <div id="bm-body"><div class="muted tiny"><span class="spinner"></span> Carregando concorrentes…</div></div>
    </div>
  `;
}

function renderContent() {
  const body = document.getElementById('bm-body');
  if (_concorrentes.length === 0) {
    body.innerHTML = `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:40px;text-align:center">
        <p style="color:#64748b">Nenhum concorrente cadastrado. Use o <a href="#/concorrencia" style="color:#d4af37">Radar de Concorrência</a> pra adicionar.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <p style="color:#94a3b8;font-size:13px;margin-bottom:16px">${_concorrentes.length} concorrentes monitorados</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:16px;margin-bottom:24px">
      ${METRICAS.map(m => metricCard(m)).join('')}
    </div>
    ${renderTiers()}
  `;
}

function calcStats(key) {
  const vals = _concorrentes.map(c => parseFloat(c[key])).filter(v => !isNaN(v) && v > 0);
  if (!vals.length) return { avg: 0, max: 0, min: 0, median: 0, count: 0 };
  vals.sort((a, b) => a - b);
  const sum = vals.reduce((s, v) => s + v, 0);
  const avg = sum / vals.length;
  const median = vals.length % 2 === 0 ? (vals[vals.length/2 - 1] + vals[vals.length/2]) / 2 : vals[Math.floor(vals.length/2)];
  return { avg: Math.round(avg * 100)/100, max: vals[vals.length - 1], min: vals[0], median: Math.round(median * 100)/100, count: vals.length };
}

function metricCard(m) {
  const stats = calcStats(m.key);
  const top = _concorrentes.reduce((best, c) => (parseFloat(c[m.key]) || 0) > (parseFloat(best?.[m.key]) || 0) ? c : best, _concorrentes[0] || {});
  return `
    <div style="background:linear-gradient(135deg,#1e293b,#263549);border:1px solid #334155;border-radius:12px;padding:18px">
      <div class="flex" style="align-items:flex-start;gap:10px;margin-bottom:14px">
        <span style="font-size:28px">${m.icon}</span>
        <div>
          <div style="color:#fff;font-weight:800;font-size:14px">${m.label}</div>
          <div style="color:#94a3b8;font-size:11px">${stats.count} dados</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        ${stat('Média', m.format(stats.avg), '#3b82f6')}
        ${stat('Mediana', m.format(stats.median), '#8b5cf6')}
        ${stat('Máximo', m.format(stats.max), '#22c55e')}
        ${stat('Mínimo', m.format(stats.min), '#ef4444')}
      </div>
      <div style="padding:10px;background:#0a1628;border-radius:6px;border-left:3px solid #d4af37">
        <div style="color:#94a3b8;font-size:10px;text-transform:uppercase;font-weight:600">🏆 Líder</div>
        <div style="color:#d4af37;font-weight:700;font-size:12px">${esc(top?.nome || '—')}</div>
      </div>
    </div>
  `;
}

function stat(label, value, color) {
  return `
    <div style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px">
      <div style="color:#64748b;font-size:10px;text-transform:uppercase;font-weight:600">${label}</div>
      <div style="color:${color};font-size:15px;font-weight:800">${value}</div>
    </div>
  `;
}

function renderTiers() {
  return `
    <div style="background:linear-gradient(135deg,#1e293b,#263549);border:1px solid #334155;border-radius:12px;padding:20px">
      <h3 style="color:#fff;margin:0 0 14px;font-size:16px">🏆 Ranking por Tier</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px">
        ${['A', 'B', 'C'].map(tier => {
          const grupo = _concorrentes.filter(c => (c.tier || '').toUpperCase() === tier);
          const tierColor = tier === 'A' ? '#f59e0b' : tier === 'B' ? '#3b82f6' : '#64748b';
          return `
            <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px">
              <div style="color:${tierColor};font-weight:800;margin-bottom:10px;text-transform:uppercase">Tier ${tier} <span style="color:#94a3b8;font-weight:400">(${grupo.length})</span></div>
              ${grupo.length === 0 ? '<div style="color:#64748b;font-size:12px;text-align:center;padding:10px">—</div>' :
                grupo.slice(0, 8).map((c, i) => `
                  <div class="flex" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b;font-size:12px">
                    <span style="color:#fff;font-weight:600">${i + 1}. ${esc(c.nome || '—')}</span>
                    <span style="color:#94a3b8">${c.seguidores ? Number(c.seguidores).toLocaleString('pt-BR') : '—'}</span>
                  </div>
                `).join('')
              }
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
