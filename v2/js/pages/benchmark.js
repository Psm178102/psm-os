/* PSM-OS v2 — 🏙 Mercado · Benchmark (v88.82; antes Sprint 8.3)
   Aba do hub Mercado (/concorrencia?tab=benchmark), só sócio. Compara a base
   ÚNICA de concorrentes nas métricas que de fato são preenchidas: seguidores,
   posts, anúncios ativos (coleta diária do Vigia) e tamanho do time.
   Engajamento e imóveis ativos saíram: nunca foram preenchidos (0 de 65). */
import { api } from '../api.js';

let _root = null;
let _concorrentes = [];

const METRICAS = [
  { key: 'seguidores',     label: 'Seguidores',      icon: '👥' },
  { key: 'posts',          label: 'Posts',           icon: '🖼' },
  { key: 'anuncios_count', label: 'Anúncios ativos', icon: '📢' },
  { key: 'corretores',     label: 'Corretores',      icon: '👤' },
];
const fmt = v => (v || v === 0) ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—';

export async function pageBenchmark(ctx, root) {
  _root = root;
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando concorrentes…</div></div>`;
  try {
    const r = await api.request('/api/v3/concorrentes/list');
    _concorrentes = r.concorrentes || [];
    render();
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  if (!_concorrentes.length) {
    _root.innerHTML = `<div class="card"><p class="muted">Nenhum concorrente na base. Cadastre no Radar.</p></div>`;
    return;
  }
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📊 Benchmark do mercado</h2>
      <p class="card-sub">${_concorrentes.length} concorrentes · média, mediana e líder em cada métrica preenchida.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px">
        ${METRICAS.map(metricCard).join('')}
      </div>
      ${renderTiers()}
    </div>`;
}

function calcStats(key) {
  const vals = _concorrentes.map(c => parseFloat(c[key])).filter(v => !isNaN(v) && v > 0).sort((a, b) => a - b);
  if (!vals.length) return { avg: 0, max: 0, median: 0, count: 0 };
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return { avg, max: vals[vals.length - 1], median, count: vals.length };
}

function metricCard(m) {
  const st = calcStats(m.key);
  const top = _concorrentes.reduce((best, c) => (parseFloat(c[m.key]) || 0) > (parseFloat(best?.[m.key]) || 0) ? c : best, null);
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px">
    <div class="flex items-center gap-2" style="margin-bottom:10px">
      <span style="font-size:18px">${m.icon}</span>
      <div><div style="font-weight:600;font-size:14px">${m.label}</div><div class="tiny muted">${st.count} de ${_concorrentes.length} com dado</div></div>
    </div>
    ${st.count ? `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
      ${stat('Média', fmt(st.avg))}${stat('Mediana', fmt(st.median))}${stat('Máximo', fmt(st.max))}
    </div>
    <div class="tiny" style="margin-top:10px"><span class="muted">Líder:</span> <b>${esc(top?.nome || '—')}</b></div>`
    : '<div class="tiny muted">Sem dado ainda — preencha no Radar.</div>'}
  </div>`;
}

function stat(label, value) {
  return `<div style="background:var(--bg-3);border-radius:var(--radius-sm);padding:6px 8px">
    <div class="tiny muted">${label}</div><div style="font-weight:600;font-size:14px">${value}</div></div>`;
}

function renderTiers() {
  const cor = { A: 'var(--err)', B: 'var(--warn)', C: 'var(--ink-muted)' };
  return `<h3 class="card-title" style="font-size:14px;margin-top:18px">🏆 Ranking por tier (seguidores)</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:8px">
      ${['A', 'B', 'C'].map(tier => {
        const grupo = _concorrentes.filter(c => (c.tier || '').toUpperCase() === tier)
          .sort((a, b) => (+b.seguidores || 0) - (+a.seguidores || 0));
        return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px">
          <div style="color:${cor[tier]};font-weight:600;margin-bottom:6px">Tier ${tier} <span class="tiny muted">(${grupo.length})</span></div>
          ${grupo.length === 0 ? '<div class="tiny muted">—</div>' : grupo.slice(0, 8).map((c, i) => `
            <div class="flex" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--border);font-size:12px">
              <span style="font-weight:600">${i + 1}. ${esc(c.nome || '—')}</span>
              <span class="muted">${c.seguidores ? Number(c.seguidores).toLocaleString('pt-BR') : '—'}</span>
            </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
