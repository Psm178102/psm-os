/* ============================================================================
   PSM-OS v2 — Financeiro (NIBO live)
   Sprint 7.4
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;
let _company = 'all';

export async function pageFinanceiro(ctx, root) {
  _root = root;
  const me = auth.user();
  if ((me?.lvl || 0) < 5) {
    root.innerHTML = `<div class="alert alert-warn">🔒 Requer nível Líder (5) ou superior. Você é <code>${me?.role}</code> (L${me?.lvl}).</div>`;
    return;
  }
  await load();
}

async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Buscando NIBO live (2 CNPJs)…</div></div>';
  try {
    _data = await api.request('/api/v3/finance/summary?company=' + encodeURIComponent(_company));
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const d = _data;
  const sa = d.saldo || {};
  const r = d.receita || {};
  const p = d.despesa || {};
  const m = d.mes_atual || {};
  const empresas = d.por_empresa || {};

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">💰 Financeiro · NIBO ao vivo</h2>
      <p class="card-sub">
        ${d.partial ? '<b style="color:var(--warn)">⚠ Dados parciais — 1 CNPJ falhou.</b> ' : ''}
        Atualizado: ${new Date(d.fetched_at).toLocaleString('pt-BR')}
        ${d.errors && d.errors.length ? ` · <span style="color:var(--err)">${d.errors.length} erro(s)</span>` : ''}
      </p>

      <!-- Filtro empresa -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        ${empresaBtn('all',     'Consolidado',   d.company)}
        ${empresaBtn('imoveis', 'PSM Imóveis',   d.company)}
        ${empresaBtn('locacao', 'PSM Locação',   d.company)}
        <button class="btn btn-ghost" id="btn-reload" style="margin-left:auto">🔄 Atualizar</button>
      </div>

      <!-- HERO -->
      <div class="flex gap-3 mt-4" style="flex-wrap:wrap">
        ${kpiBig('💚 A Receber (previsto)',  'R$ ' + money(r.previsto),  `${r.total_lancamentos || 0} lançamentos`, '#16a34a')}
        ${kpiBig('❤️ A Pagar (previsto)',    'R$ ' + money(p.previsto),  `${p.total_lancamentos || 0} lançamentos`, '#dc2626')}
        ${kpiBig('📊 Saldo previsto líq.',   'R$ ' + money(sa.previsto_liquido), 'receita − despesa', sa.previsto_liquido >= 0 ? '#16a34a' : '#dc2626')}
        ${kpiBig('✓ Saldo realizado',        'R$ ' + money(sa.realizado_liquido), 'recebido − pago', sa.realizado_liquido >= 0 ? '#16a34a' : '#dc2626')}
      </div>

      <!-- MÊS ATUAL -->
      <div class="card mt-4">
        <h3 class="card-title">📅 Mês atual</h3>
        <div class="flex gap-3" style="flex-wrap:wrap">
          ${kpiMini('Receita do mês', 'R$ ' + money(m.receita), '#16a34a')}
          ${kpiMini('Despesa do mês', 'R$ ' + money(m.despesa), '#dc2626')}
          ${kpiMini('Saldo do mês',   'R$ ' + money(m.saldo),   m.saldo >= 0 ? '#16a34a' : '#dc2626')}
          ${kpiMini('# lançamentos receita', m.n_receitas || 0)}
          ${kpiMini('# lançamentos despesa', m.n_despesas || 0)}
        </div>
      </div>

      <!-- POR EMPRESA -->
      ${Object.keys(empresas).length > 1 ? `
        <div class="card mt-4">
          <h3 class="card-title">🏢 Por empresa (CNPJ)</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                <th style="text-align:left;padding:8px">Empresa</th>
                <th style="text-align:right;padding:8px">Receita prevista</th>
                <th style="text-align:right;padding:8px">Despesa prevista</th>
                <th style="text-align:right;padding:8px"># Receita</th>
                <th style="text-align:right;padding:8px"># Despesa</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(empresas).map(([k, v]) => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px;font-weight:700">${escapeHtml(v.label)}</td>
                  <td style="text-align:right;padding:8px;color:#16a34a">R$ ${money(v.receita_total)}</td>
                  <td style="text-align:right;padding:8px;color:#dc2626">R$ ${money(v.despesa_total)}</td>
                  <td style="text-align:right;padding:8px">${v.n_lanc_receita || 0}</td>
                  <td style="text-align:right;padding:8px">${v.n_lanc_despesa || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      <!-- CATEGORIAS -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div class="card">
          <h3 class="card-title">💚 Top 10 categorias — Receita</h3>
          ${tableCat(d.por_categoria_receita || [], '#16a34a')}
        </div>
        <div class="card">
          <h3 class="card-title">❤️ Top 10 categorias — Despesa</h3>
          ${tableCat(d.por_categoria_despesa || [], '#dc2626')}
        </div>
      </div>

      <div class="alert alert-warn mt-4">
        <b>Em construção (Sprint 7.4 fase 2):</b> DRE 12 meses Plano vs Real, Comissões cruzadas RD×4%, Repasses, Fluxo de Caixa.
        Hoje no /v1 (continua funcionando). Eu migro essas tabs nas próximas commits.
      </div>
    </div>
  `;

  // Wire up
  document.querySelectorAll('[data-company]').forEach(b => {
    b.addEventListener('click', () => { _company = b.dataset.company; load(); });
  });
  document.getElementById('btn-reload').addEventListener('click', () => load());
}

function empresaBtn(id, lbl, current) {
  return `<button class="btn ${current === id ? 'btn-primary' : 'btn-ghost'}" data-company="${id}">${lbl}</button>`;
}

function kpiBig(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:200px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:24px;font-weight:900;color:${color};margin-top:2px">${big}</div>
      <div class="tiny muted">${sub}</div>
    </div>
  `;
}

function kpiMini(label, value, color) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:150px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
      <div style="font-size:18px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
    </div>
  `;
}

function tableCat(cats, color) {
  if (!cats.length) return '<div class="muted tiny">Nenhuma categoria com lançamentos.</div>';
  const max = Math.max(...cats.map(c => Math.abs(c.valor) || 1));
  return `
    <div style="display:grid;gap:6px">
      ${cats.map(c => {
        const pct = Math.min(100, Math.round((Math.abs(c.valor) / max) * 100));
        return `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px">
              <span style="font-weight:600">${escapeHtml(c.categoria)} <span class="muted">(${c.count})</span></span>
              <span style="color:${color};font-weight:700">R$ ${money(c.valor)}</span>
            </div>
            <div style="background:var(--bg);height:6px;border-radius:3px;overflow:hidden;margin-top:2px">
              <div style="background:${color};height:100%;width:${pct}%"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function money(n) {
  if (n == null || isNaN(n)) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
