/* ============================================================================
   PSM-OS v2 — Premium UI kit (dark hero + sparklines + Chart.js)
   ----------------------------------------------------------------------------
   Mesmo padrão visual do cockpit Meta Ads (Executiva premium):
   hero dark com gradiente, KPIs com mini-sparkline + Δ% vs período anterior,
   cards de progresso e gráficos Chart.js. Reaproveitado por Financeiro e
   Dashboard Diretoria pra manter a linguagem visual consistente.
   Sem dependências além do Chart.js (já no cache do Service Worker).
============================================================================ */

/* ── Mini sparkline SVG (sem libs) ─────────────────────────────────────── */
export function sparkSVG(vals, color) {
  const a = (vals || []).filter(v => typeof v === 'number' && !isNaN(v));
  if (a.length < 2) return '<div style="height:34px"></div>';
  const max = Math.max(...a), min = Math.min(...a), rng = (max - min) || 1, n = a.length;
  const line = a.map((v, i) => `${(i / (n - 1) * 100).toFixed(1)},${(32 - (v - min) / rng * 28).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 100 34" preserveAspectRatio="none" style="width:100%;height:34px;display:block">
    <polygon points="0,34 ${line} 100,34" fill="${color}" opacity="0.16"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ── Badge de variação (▲/▼ %) — invert=true quando "menor é melhor" ───── */
export function deltaBadge(pct, invert) {
  if (pct == null || isNaN(pct)) return '<span style="font-size:11px;color:#64748b">— vs ant.</span>';
  const good = invert ? pct <= 0 : pct >= 0;
  const c = good ? '#22c55e' : '#f87171';
  return `<span style="font-size:11px;font-weight:700;color:${c}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

/* ── KPI premium: label, valor (string já formatada), Δ%, sparkline ────── */
export function heroKpi(label, value, deltaPct, sparkVals, color, invert) {
  return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px 14px 10px">
    <div style="font-size:11px;color:#94a3b8;letter-spacing:.4px">${label}</div>
    <div style="font-size:22px;font-weight:800;color:#f1f5f9;line-height:1.1;margin-top:3px">${value}</div>
    <div style="margin-top:2px">${deltaBadge(deltaPct, invert)}</div>
    <div style="margin-top:6px">${sparkSVG(sparkVals, color)}</div>
  </div>`;
}

/* ── Card de progresso com barra ───────────────────────────────────────── */
export function progressCard(label, value, sub, frac, color) {
  const w = Math.max(2, Math.min(100, Math.round((frac || 0) * 100)));
  return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px 14px">
    <div style="font-size:11px;color:#94a3b8">${label}</div>
    <div style="font-size:22px;font-weight:800;color:#f1f5f9;margin-top:2px">${value}</div>
    <div style="height:7px;border-radius:6px;background:rgba(255,255,255,0.08);margin-top:8px;overflow:hidden"><div style="height:100%;width:${w}%;background:${color}"></div></div>
    <div style="font-size:10px;color:#64748b;margin-top:4px">${sub || ''}</div>
  </div>`;
}

/* ── Mini stat (3-col dentro do hero) ──────────────────────────────────── */
export function miniStat(label, val, color) {
  return `<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:8px;text-align:center">
    <div style="font-size:10px;color:#94a3b8">${label}</div><div style="font-size:15px;font-weight:800;color:${color || '#f1f5f9'}">${val}</div></div>`;
}

/* ── Container dark do hero ────────────────────────────────────────────── */
export function heroWrap(title, subtitle, inner) {
  return `
  <div style="background:linear-gradient(160deg,#0f172a,#111827);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:18px 18px 20px;color:#e2e8f0;margin-bottom:16px">
    <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:17px;font-weight:800;color:#fff">${title}</div>
        ${subtitle ? `<div style="font-size:11px;color:#94a3b8">${subtitle}</div>` : ''}
      </div>
    </div>
    ${inner}
  </div>`;
}

/* ── Card escuro (sub-painel dentro do hero) ───────────────────────────── */
export function panel(title, inner, extraStyle) {
  return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px;${extraStyle || ''}">
    ${title ? `<div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:8px">${title}</div>` : ''}
    ${inner}
  </div>`;
}

/* ── Δ% entre dois valores ─────────────────────────────────────────────── */
export function pctDelta(cur, prev) {
  if (prev == null || prev === 0 || isNaN(prev)) return null;
  return (cur - prev) / Math.abs(prev) * 100;
}

/* ── Chart.js (já no cache do SW v2/sw.js → offline-safe) ──────────────── */
let _chartLibP = null;
export function loadChartLib() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (_chartLibP) return _chartLibP;
  _chartLibP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => res(window.Chart);
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return _chartLibP;
}

/* Eixos/grid escuros padrão pros gráficos do hero */
export const DARK_INK = '#cbd5e1';
export const DARK_GRID = 'rgba(148,163,184,0.14)';
export function darkOpts(extra) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: DARK_INK, font: { size: 10 } } } },
  }, extra || {});
}
