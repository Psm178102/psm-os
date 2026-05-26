/* PSM-OS v2 — Forecast (Sprint 7.22) */
import { api } from '../api.js';
import { auth } from '../auth.js';

const MES_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let _root = null, _data = null, _ano = new Date().getFullYear();

export async function pageForecast(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl ≥ 5).</div>';
    return;
  }
  await reload();
}

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Calculando forecast…</div></div>';
  try {
    _data = await api.request('/api/v3/forecast/summary?ano=' + _ano);
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const d = _data, t = d.totals || {}, months = d.months || [], stages = d.stages || [];
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📈 Forecast ${_ano}</h2>
      <p class="card-sub">Projeção VGV ponderada (deals abertos × peso do stage). Pesos heurísticos por nome do stage.</p>

      <div class="flex gap-2 mt-2" style="align-items:center">
        <label class="tiny muted" style="font-weight:700">ANO:</label>
        <select id="fc-ano" class="select" style="padding:5px 10px;font-size:12px">
          ${[2024,2025,2026,2027].map(a => `<option value="${a}"${a===_ano?' selected':''}>${a}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="fc-reload" style="margin-left:auto">🔄</button>
      </div>

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('🎯 Deals abertos',  t.deals || 0, 'em pipeline', '#2563eb')}
        ${kpi('💰 VGV bruto',       'R$ ' + money(t.valor_total),     'soma sem peso',         '#7c3aed')}
        ${kpi('📊 Forecast (ponderado)', 'R$ ' + money(t.valor_ponderado), 'por probabilidade', '#16a34a')}
        ${kpi('% Conversão est.',  t.valor_total > 0 ? ((t.valor_ponderado / t.valor_total) * 100).toFixed(1) + '%' : '—', 'forecast/bruto', '#d97706')}
      </div>

      <div class="card mt-4" style="margin-top:14px">
        <h3 class="card-title">📅 Por mês</h3>
        <div style="overflow-x:auto">
          <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:580px">
            <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--ink)">
              <th style="text-align:left;padding:8px">Mês</th>
              <th style="text-align:right;padding:8px"># Deals</th>
              <th style="text-align:right;padding:8px">Bruto</th>
              <th style="text-align:right;padding:8px">Forecast</th>
              <th style="text-align:right;padding:8px">% conv</th>
            </tr></thead>
            <tbody>
              ${months.length === 0 ? '<tr><td colspan="5" class="muted text-center" style="padding:20px">Sem deals abertos.</td></tr>' :
                months.map(m => {
                  const conv = m.valor_total > 0 ? (m.valor_ponderado / m.valor_total * 100).toFixed(0) + '%' : '—';
                  const label = MES_NAMES[parseInt(m.month.split('-')[1])-1] + '/' + m.month.split('-')[0].slice(-2);
                  return `<tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:6px 10px;font-weight:700">${label}</td>
                    <td style="text-align:right;padding:6px 10px">${m.deals}</td>
                    <td style="text-align:right;padding:6px 10px">R$ ${money(m.valor_total)}</td>
                    <td style="text-align:right;padding:6px 10px;color:#16a34a;font-weight:700">R$ ${money(m.valor_ponderado)}</td>
                    <td style="text-align:right;padding:6px 10px;color:var(--ink-muted)">${conv}</td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card mt-4" style="margin-top:14px">
        <h3 class="card-title">🎯 Por stage</h3>
        ${stages.length === 0 ? '<div class="muted tiny">Sem stages com deals.</div>' : `
          <div style="display:grid;gap:6px">
            ${stages.map(s => stageRow(s, t.valor_total)).join('')}
          </div>
        `}
      </div>

      <div class="alert alert-warn mt-3">
        <b>Como funciona:</b> cada deal aberto ganha um peso de 0-100% baseado no nome do stage
        (proposta/negociação ~70%, qualificado ~40%, contato ~15%, perdido 0%). Forecast =
        soma(amount × peso). É uma estimativa heurística — ajuste depois cadastrando pesos por stage.
      </div>
    </div>
  `;
  document.getElementById('fc-ano').addEventListener('change', async e => { _ano = parseInt(e.target.value); await reload(); });
  document.getElementById('fc-reload').addEventListener('click', reload);
}

function stageRow(s, totalGeral) {
  const pct = totalGeral > 0 ? (s.valor / totalGeral * 100) : 0;
  return `
    <div style="display:grid;grid-template-columns:1fr 80px 110px 60px;gap:8px;padding:6px 10px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:12px">
      <div style="font-weight:600">${escapeHtml(s.stage)}</div>
      <div class="muted">${s.count} deals</div>
      <div style="text-align:right;font-weight:700">R$ ${money(s.valor)}</div>
      <div style="text-align:right;color:#16a34a;font-weight:700">${(s.weight*100).toFixed(0)}%</div>
    </div>
  `;
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:20px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}
function money(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
