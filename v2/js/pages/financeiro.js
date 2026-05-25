/* ============================================================================
   PSM-OS v2 — Financeiro (NIBO live) — Sprint 7.5 c/ tabs
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _company = 'all';
let _tab = 'resumo';            // resumo | dre | comissoes | repasses
let _cache = {};                // por tab+company

export async function pageFinanceiro(ctx, root) {
  _root = root;
  const me = auth.user();
  if ((me?.lvl || 0) < 5) {
    root.innerHTML = `<div class="alert alert-warn">🔒 Requer nível Líder (5) ou superior. Você é <code>${me?.role}</code> (L${me?.lvl}).</div>`;
    return;
  }
  await loadAndRender();
}

async function loadAndRender() {
  drawShell();
  await drawBody();
}

function drawShell() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">💰 Financeiro · NIBO ao vivo</h2>

      <!-- Filtros -->
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
        ${empresaBtn('all', 'Consolidado')}
        ${empresaBtn('imoveis', 'PSM Imóveis')}
        ${empresaBtn('locacao', 'PSM Locação')}
        <button class="btn btn-ghost" id="btn-reload" style="margin-left:auto">🔄 Atualizar</button>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1" style="margin-top:14px;border-bottom:1px solid var(--border)">
        ${tabBtn('resumo',    '📊 Resumo')}
        ${tabBtn('dre',       '📈 DRE 12m')}
        ${tabBtn('comissoes', '💎 Comissões')}
        ${tabBtn('repasses',  '🔄 Repasses')}
      </div>

      <div id="fin-body" style="margin-top:14px">
        <div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando ${_tab}…</div>
      </div>
    </div>
  `;
  document.querySelectorAll('[data-company]').forEach(b => b.addEventListener('click', async () => {
    _company = b.dataset.company; await loadAndRender();
  }));
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', async () => {
    _tab = b.dataset.tab; await loadAndRender();
  }));
  document.getElementById('btn-reload').addEventListener('click', async () => {
    _cache = {}; await loadAndRender();
  });
}

async function drawBody() {
  const body = document.getElementById('fin-body');
  if (!body) return;
  try {
    if (_tab === 'resumo')        body.innerHTML = await renderResumo();
    else if (_tab === 'dre')      body.innerHTML = await renderDre();
    else if (_tab === 'comissoes')body.innerHTML = await renderComissoes();
    else if (_tab === 'repasses') body.innerHTML = await renderRepasses();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

// ─── Tab: Resumo ────────────────────────────────────────────────────────
async function renderResumo() {
  const key = 'summary|' + _company;
  if (!_cache[key]) _cache[key] = await api.request('/api/v3/finance/summary?company=' + encodeURIComponent(_company));
  const d = _cache[key];
  const r = d.receita || {}, p = d.despesa || {}, sa = d.saldo || {}, m = d.mes_atual || {}, emp = d.por_empresa || {};
  return `
    ${d.partial ? '<div class="alert alert-warn">⚠ Dados parciais — 1 CNPJ falhou.</div>' : ''}
    <div class="tiny muted" style="margin-bottom:10px">Atualizado: ${new Date(d.fetched_at).toLocaleString('pt-BR')}</div>

    <div class="flex gap-3" style="flex-wrap:wrap">
      ${kpiBig('💚 A Receber (previsto)',  'R$ ' + money(r.previsto),  `${r.total_lancamentos || 0} lançamentos`, '#16a34a')}
      ${kpiBig('❤️ A Pagar (previsto)',    'R$ ' + money(p.previsto),  `${p.total_lancamentos || 0} lançamentos`, '#dc2626')}
      ${kpiBig('📊 Saldo previsto líq.',    'R$ ' + money(sa.previsto_liquido), 'receita − despesa', sa.previsto_liquido >= 0 ? '#16a34a' : '#dc2626')}
      ${kpiBig('✓ Saldo realizado',         'R$ ' + money(sa.realizado_liquido), 'recebido − pago',  sa.realizado_liquido >= 0 ? '#16a34a' : '#dc2626')}
    </div>

    <div class="card mt-4" style="margin:14px 0 0">
      <h3 class="card-title">📅 Mês atual</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpiMini('Receita do mês', 'R$ ' + money(m.receita), '#16a34a')}
        ${kpiMini('Despesa do mês', 'R$ ' + money(m.despesa), '#dc2626')}
        ${kpiMini('Saldo do mês',   'R$ ' + money(m.saldo),   m.saldo >= 0 ? '#16a34a' : '#dc2626')}
        ${kpiMini('# rec mês', m.n_receitas || 0)}
        ${kpiMini('# des mês', m.n_despesas || 0)}
      </div>
    </div>

    ${Object.keys(emp).length > 1 ? `
      <div class="card mt-4" style="margin:14px 0 0">
        <h3 class="card-title">🏢 Por empresa (CNPJ)</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:8px">Empresa</th>
            <th style="text-align:right;padding:8px">Receita</th>
            <th style="text-align:right;padding:8px">Despesa</th>
            <th style="text-align:right;padding:8px"># Rec</th>
            <th style="text-align:right;padding:8px"># Des</th>
          </tr></thead>
          <tbody>
            ${Object.entries(emp).map(([k, v]) => `
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

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
      <div class="card" style="margin:0">
        <h3 class="card-title">💚 Top 10 categorias — Receita</h3>
        ${tableCat(d.por_categoria_receita || [], '#16a34a')}
      </div>
      <div class="card" style="margin:0">
        <h3 class="card-title">❤️ Top 10 categorias — Despesa</h3>
        ${tableCat(d.por_categoria_despesa || [], '#dc2626')}
      </div>
    </div>
  `;
}

// ─── Tab: DRE 12m ───────────────────────────────────────────────────────
async function renderDre() {
  const key = 'dre|' + _company;
  if (!_cache[key]) _cache[key] = await api.request('/api/v3/finance/dre?months=12&company=' + encodeURIComponent(_company));
  const d = _cache[key];
  const rows = d.rows || [];
  const tot = d.totals || {};

  // Calcular max pra normalizar barras
  const maxReceita = Math.max(...rows.map(r => r.receita_real + r.receita_prev), 1);
  const maxDespesa = Math.max(...rows.map(r => r.despesa_real + r.despesa_prev), 1);

  return `
    ${d.partial ? '<div class="alert alert-warn">⚠ Dados parciais.</div>' : ''}
    <div class="tiny muted" style="margin-bottom:10px">DRE últimos 12 meses · Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')}</div>

    <div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpiMini('Receita 12m', 'R$ ' + money(tot.receita), '#16a34a')}
      ${kpiMini('Despesa 12m', 'R$ ' + money(tot.despesa), '#dc2626')}
      ${kpiMini('Saldo 12m',   'R$ ' + money(tot.saldo),   tot.saldo >= 0 ? '#16a34a' : '#dc2626')}
    </div>

    <div style="overflow-x:auto;max-width:100%">
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:900px">
        <thead>
          <tr style="border-bottom:2px solid var(--ink);background:var(--bg-3)">
            <th style="text-align:left;padding:8px 10px;position:sticky;left:0;background:var(--bg-3)">Mês</th>
            <th style="text-align:right;padding:8px 10px;color:#16a34a">Receita Real</th>
            <th style="text-align:right;padding:8px 10px;color:#16a34a">Receita Prev</th>
            <th style="text-align:right;padding:8px 10px;color:#dc2626">Despesa Real</th>
            <th style="text-align:right;padding:8px 10px;color:#dc2626">Despesa Prev</th>
            <th style="text-align:right;padding:8px 10px">Saldo Real</th>
            <th style="text-align:right;padding:8px 10px">Saldo Prev</th>
            <th style="text-align:right;padding:8px 10px">#</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => dreRow(r, maxReceita, maxDespesa)).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--ink);background:var(--bg-3);font-weight:800">
            <td style="padding:8px 10px;position:sticky;left:0;background:var(--bg-3)">TOTAL 12m</td>
            <td style="text-align:right;padding:8px 10px;color:#16a34a">R$ ${money(rows.reduce((s,r)=>s+r.receita_real,0))}</td>
            <td style="text-align:right;padding:8px 10px;color:#16a34a">R$ ${money(rows.reduce((s,r)=>s+r.receita_prev,0))}</td>
            <td style="text-align:right;padding:8px 10px;color:#dc2626">R$ ${money(rows.reduce((s,r)=>s+r.despesa_real,0))}</td>
            <td style="text-align:right;padding:8px 10px;color:#dc2626">R$ ${money(rows.reduce((s,r)=>s+r.despesa_prev,0))}</td>
            <td style="text-align:right;padding:8px 10px;color:${rows.reduce((s,r)=>s+r.saldo_real,0) >= 0 ? '#16a34a' : '#dc2626'}">R$ ${money(rows.reduce((s,r)=>s+r.saldo_real,0))}</td>
            <td style="text-align:right;padding:8px 10px;color:${tot.saldo >= 0 ? '#16a34a' : '#dc2626'}">R$ ${money(tot.saldo)}</td>
            <td style="text-align:right;padding:8px 10px">${rows.reduce((s,r)=>s+r.receita_count+r.despesa_count, 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="tiny muted" style="margin-top:10px;line-height:1.6">
      <b>Real</b> = lançamentos marcados como pagos/recebidos. <b>Prev</b> = previstos (não settled).
      Saldo Real = Receita Real − Despesa Real (caixa). Saldo Prev = (Real + Prev) líquido.
    </div>
  `;
}

function dreRow(r, maxRec, maxDes) {
  const totalRec = r.receita_real + r.receita_prev;
  const totalDes = r.despesa_real + r.despesa_prev;
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 10px;font-weight:700;position:sticky;left:0;background:var(--bg-2)">${escapeHtml(r.label)}</td>
      <td style="text-align:right;padding:6px 10px;color:#16a34a">R$ ${money(r.receita_real)}</td>
      <td style="text-align:right;padding:6px 10px;color:#16a34a;opacity:0.7">R$ ${money(r.receita_prev)}</td>
      <td style="text-align:right;padding:6px 10px;color:#dc2626">R$ ${money(r.despesa_real)}</td>
      <td style="text-align:right;padding:6px 10px;color:#dc2626;opacity:0.7">R$ ${money(r.despesa_prev)}</td>
      <td style="text-align:right;padding:6px 10px;font-weight:700;color:${r.saldo_real >= 0 ? '#16a34a' : '#dc2626'}">R$ ${money(r.saldo_real)}</td>
      <td style="text-align:right;padding:6px 10px;color:${r.saldo_prev >= 0 ? '#16a34a' : '#dc2626'}">R$ ${money(r.saldo_prev)}</td>
      <td style="text-align:right;padding:6px 10px" class="muted">${r.receita_count + r.despesa_count}</td>
    </tr>
  `;
}

// ─── Tab: Comissões ─────────────────────────────────────────────────────
async function renderComissoes() {
  const key = 'comissoes|' + _company;
  if (!_cache[key]) _cache[key] = await api.request('/api/v3/finance/comissoes?company=' + encodeURIComponent(_company));
  const d = _cache[key];
  return `
    <div class="tiny muted" style="margin-bottom:10px">
      Filtrando NIBO por: <code>${(d.matched_keywords || []).join(', ')}</code> · Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')}
    </div>

    <div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpiMini('# Lançamentos', d.total_lancamentos || 0)}
      ${kpiMini('Total',          'R$ ' + money(d.total_valor), '#7c3aed')}
      ${kpiMini('Pago',           'R$ ' + money(d.pago),         '#16a34a')}
      ${kpiMini('Previsto',       'R$ ' + money(d.previsto),     '#d97706')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:14px">
      <div class="card" style="margin:0">
        <h3 class="card-title">🏆 Top 20 destinatários</h3>
        ${(d.top_stakeholders || []).length ? `
          <div style="display:grid;gap:4px;max-height:520px;overflow-y:auto">
            ${d.top_stakeholders.map((s, i) => `
              <div style="display:grid;grid-template-columns:24px 1fr auto;gap:8px;padding:6px 8px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px;align-items:center">
                <span class="tiny muted">${i + 1}</span>
                <div style="min-width:0">
                  <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.stakeholder)}</div>
                  <div class="tiny muted">${s.count} lançamentos · R$ ${money(s.pago)} pago · R$ ${money(s.previsto)} previsto</div>
                </div>
                <div style="font-weight:800;color:#7c3aed">R$ ${money(s.valor)}</div>
              </div>
            `).join('')}
          </div>
        ` : '<div class="muted tiny">Nenhum destinatário identificado.</div>'}
      </div>

      <div class="card" style="margin:0">
        <h3 class="card-title">📋 Lançamentos (últimos 500)</h3>
        ${(d.rows || []).length ? `
          <div style="max-height:520px;overflow-y:auto">
            <table style="width:100%;border-collapse:collapse;font-size:11.5px">
              <thead style="position:sticky;top:0;background:var(--bg-3);z-index:1">
                <tr>
                  <th style="text-align:left;padding:6px 8px">Data</th>
                  <th style="text-align:left;padding:6px 8px">Destinatário</th>
                  <th style="text-align:left;padding:6px 8px">Categoria</th>
                  <th style="text-align:right;padding:6px 8px">Valor</th>
                  <th style="text-align:center;padding:6px 8px">Status</th>
                </tr>
              </thead>
              <tbody>
                ${d.rows.map(r => `
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:5px 8px" class="muted">${r.data ? new Date(r.data).toLocaleDateString('pt-BR') : '—'}</td>
                    <td style="padding:5px 8px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="${escapeHtml(r.stakeholder)}">${escapeHtml(r.stakeholder)}</td>
                    <td style="padding:5px 8px" class="muted">${escapeHtml(r.category)}</td>
                    <td style="text-align:right;padding:5px 8px;font-weight:700;color:#7c3aed">R$ ${money(r.valor)}</td>
                    <td style="text-align:center;padding:5px 8px">${r.settled ? '<span style="color:#16a34a">✓</span>' : '<span style="color:#d97706">⏳</span>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="muted tiny">Nenhum lançamento.</div>'}
      </div>
    </div>
  `;
}

// ─── Tab: Repasses ──────────────────────────────────────────────────────
async function renderRepasses() {
  const key = 'repasses|' + _company;
  if (!_cache[key]) _cache[key] = await api.request('/api/v3/finance/repasses?company=' + encodeURIComponent(_company));
  const d = _cache[key];
  return `
    <div class="tiny muted" style="margin-bottom:10px">
      Filtrando NIBO por: <code>${(d.matched_keywords || []).join(', ')}</code> · Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')}
    </div>

    <div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpiMini('# Lançamentos', d.total_lancamentos || 0)}
      ${kpiMini('Total',          'R$ ' + money(d.total_valor))}
      ${kpiMini('A Pagar (debit)','R$ ' + money(d.a_pagar),    '#dc2626')}
      ${kpiMini('A Receber (cred)','R$ ' + money(d.a_receber), '#16a34a')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:14px">
      <div class="card" style="margin:0">
        <h3 class="card-title">👤 Top 20 proprietários / inquilinos</h3>
        ${(d.top_stakeholders || []).length ? `
          <div style="display:grid;gap:4px;max-height:520px;overflow-y:auto">
            ${d.top_stakeholders.map((s, i) => `
              <div style="display:grid;grid-template-columns:24px 1fr auto;gap:8px;padding:6px 8px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px;align-items:center">
                <span class="tiny muted">${i + 1}</span>
                <div style="min-width:0">
                  <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.stakeholder)}</div>
                  <div class="tiny muted">${s.count} lançamentos</div>
                </div>
                <div style="font-weight:800">R$ ${money(s.valor)}</div>
              </div>
            `).join('')}
          </div>
        ` : '<div class="muted tiny">Nenhum proprietário identificado.</div>'}
      </div>

      <div class="card" style="margin:0">
        <h3 class="card-title">📋 Lançamentos (últimos 500)</h3>
        ${(d.rows || []).length ? `
          <div style="max-height:520px;overflow-y:auto">
            <table style="width:100%;border-collapse:collapse;font-size:11.5px">
              <thead style="position:sticky;top:0;background:var(--bg-3);z-index:1">
                <tr>
                  <th style="text-align:left;padding:6px 8px">Data</th>
                  <th style="text-align:center;padding:6px 8px">↕</th>
                  <th style="text-align:left;padding:6px 8px">Quem</th>
                  <th style="text-align:left;padding:6px 8px">Categoria</th>
                  <th style="text-align:right;padding:6px 8px">Valor</th>
                  <th style="text-align:center;padding:6px 8px">✓</th>
                </tr>
              </thead>
              <tbody>
                ${d.rows.map(r => `
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:5px 8px" class="muted">${r.data ? new Date(r.data).toLocaleDateString('pt-BR') : '—'}</td>
                    <td style="text-align:center;padding:5px 8px">${r.direction === 'credit' ? '<span title="Receber" style="color:#16a34a">↓</span>' : '<span title="Pagar" style="color:#dc2626">↑</span>'}</td>
                    <td style="padding:5px 8px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="${escapeHtml(r.stakeholder)}">${escapeHtml(r.stakeholder)}</td>
                    <td style="padding:5px 8px" class="muted">${escapeHtml(r.category)}</td>
                    <td style="text-align:right;padding:5px 8px;font-weight:700;color:${r.direction === 'credit' ? '#16a34a' : '#dc2626'}">R$ ${money(r.valor)}</td>
                    <td style="text-align:center;padding:5px 8px">${r.settled ? '<span style="color:#16a34a">✓</span>' : '<span style="color:#d97706">⏳</span>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="muted tiny">Nenhum lançamento.</div>'}
      </div>
    </div>
  `;
}

// ─── Componentes ────────────────────────────────────────────────────────
function tabBtn(id, lbl) {
  return `<button class="btn" data-tab="${id}" style="border-radius:var(--r-sm) var(--r-sm) 0 0;background:${_tab === id ? 'var(--psm-navy)' : 'transparent'};color:${_tab === id ? '#fff' : 'var(--ink-muted)'};border-bottom:none">${lbl}</button>`;
}
function empresaBtn(id, lbl) {
  return `<button class="btn ${_company === id ? 'btn-primary' : 'btn-ghost'}" data-company="${id}">${lbl}</button>`;
}
function kpiBig(label, big, sub, color) {
  return `<div style="flex:1;min-width:200px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${color};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}
function kpiMini(label, value, color) {
  return `<div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:150px">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
    <div style="font-size:18px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
  </div>`;
}
function tableCat(cats, color) {
  if (!cats.length) return '<div class="muted tiny">Nenhuma categoria com lançamentos.</div>';
  const max = Math.max(...cats.map(c => Math.abs(c.valor) || 1));
  return `<div style="display:grid;gap:6px">${cats.map(c => {
    const pct = Math.min(100, Math.round((Math.abs(c.valor) / max) * 100));
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px">
        <span style="font-weight:600">${escapeHtml(c.categoria)} <span class="muted">(${c.count})</span></span>
        <span style="color:${color};font-weight:700">R$ ${money(c.valor)}</span>
      </div>
      <div style="background:var(--bg);height:6px;border-radius:3px;overflow:hidden;margin-top:2px">
        <div style="background:${color};height:100%;width:${pct}%"></div>
      </div>
    </div>`;
  }).join('')}</div>`;
}
function money(n) {
  if (n == null || isNaN(n)) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
