/* ============================================================================
   PSM-OS v2 — Financeiro (NIBO live) — Sprint 7.5 c/ tabs
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { heroWrap, heroKpi, miniStat, panel, loadChartLib, darkOpts, DARK_INK, DARK_GRID, pctDelta } from '../premium.js';

let _root = null;
let _company = 'all';
let _tab = 'resumo';            // resumo | dre | comissoes | repasses
let _cache = {};                // por tab+company
let _charts = [];               // instâncias Chart.js do hero (destruídas a cada render)

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
      <div class="flex gap-1" style="margin-top:14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        ${tabBtn('resumo',    '📊 Resumo')}
        ${tabBtn('dre',       '📈 DRE 12m')}
        ${tabBtn('metricas',  '🚦 Métricas')}
        ${tabBtn('custos',    '🏢 Custos Fixos')}
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
  _charts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _charts = [];
  try {
    if (_tab === 'resumo')      { body.innerHTML = await renderResumo(); buildResumoCharts(); }
    else if (_tab === 'dre')      body.innerHTML = await renderDre();
    else if (_tab === 'metricas') body.innerHTML = await renderMetricas();
    else if (_tab === 'custos')   body.innerHTML = await renderCustos();
    else if (_tab === 'comissoes')body.innerHTML = await renderComissoes();
    else if (_tab === 'repasses') body.innerHTML = await renderRepasses();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

// ─── Tab: Resumo ────────────────────────────────────────────────────────
// Banner honesto de falha/parcial do NIBO — diz QUAL empresa/endpoint falhou.
function finErrBanner(d) {
  const errs = (d && d.errors) || [];
  if (!errs.length && !(d && d.partial)) return '';
  const labels = { imoveis: 'PSM Imóveis', locacao: 'PSM Locação' };
  const detail = errs.map(e => `${labels[e.company] || e.company} — ${escapeHtml((e.endpoint || '') + ': ' + (e.msg || 'erro'))}`).join('<br>');
  const allFail = d && d.ok === false && !d.partial && errs.length;
  const cls = allFail ? 'alert-err' : 'alert-warn';
  const head = allFail
    ? '🔴 NIBO indisponível — os valores abaixo podem estar zerados ou incompletos.'
    : '⚠ Dados parciais do NIBO — uma empresa/seção falhou. Os totais consideram só o que respondeu:';
  return `<div class="alert ${cls}">${head}${detail ? '<div class="tiny" style="margin-top:4px">' + detail + '</div>' : ''}</div>`;
}

async function renderResumo() {
  const key = 'summary|' + _company;
  if (!_cache[key]) _cache[key] = await api.request('/api/v3/finance/summary?company=' + encodeURIComponent(_company));
  const d = _cache[key];
  // DRE 12m alimenta sparklines + gráfico do hero (série mensal real)
  const dkey = 'dre|' + _company;
  if (!_cache[dkey]) {
    try { _cache[dkey] = await api.request('/api/v3/finance/dre?months=12&company=' + encodeURIComponent(_company)); }
    catch (_) { _cache[dkey] = { rows: [] }; }
  }
  const r = d.receita || {}, p = d.despesa || {}, sa = d.saldo || {}, m = d.mes_atual || {}, emp = d.por_empresa || {};
  return `
    ${finErrBanner(d)}
    ${finHero(d, _cache[dkey])}
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

// ─── Hero premium (dark + sparklines + gráficos) ────────────────────────
function dreSeries(dre) {
  const rows = (dre && dre.rows) || [];
  return {
    labels: rows.map(r => r.label),
    receita: rows.map(r => (r.receita_real || 0) + (r.receita_prev || 0)),
    despesa: rows.map(r => (r.despesa_real || 0) + (r.despesa_prev || 0)),
    saldo: rows.map(r => ((r.receita_real || 0) + (r.receita_prev || 0)) - ((r.despesa_real || 0) + (r.despesa_prev || 0))),
    saldoReal: rows.map(r => r.saldo_real || 0),
  };
}
// Δ% robusto: compara os dois últimos meses COMPLETOS (descarta o mês corrente,
// que é parcial e distorce o %). Pra saldo (que cruza o zero) suprime o % quando
// a base é pequena demais ou houve troca de sinal — evita "▲2570%" sem sentido.
function lastDelta(arr, isSaldo) {
  if (!arr || arr.length < 3) return null;
  const cur = arr[arr.length - 2];   // último mês completo
  const prev = arr[arr.length - 3];  // mês anterior
  if (prev == null || prev === 0 || isNaN(prev)) return null;
  if (isSaldo) {
    const maxAbs = Math.max(...arr.map(v => Math.abs(v || 0)), 1);
    if (Math.abs(prev) < maxAbs * 0.12) return null;       // base irrelevante → sem %
    if ((cur < 0) !== (prev < 0)) return null;             // cruzou o zero → sem %
  }
  return pctDelta(cur, prev);
}
function finHero(d, dre) {
  const r = d.receita || {}, p = d.despesa || {}, sa = d.saldo || {}, m = d.mes_atual || {};
  const s = dreSeries(dre);
  const compName = _company === 'imoveis' ? 'PSM Imóveis' : _company === 'locacao' ? 'PSM Locação' : 'Consolidado (2 CNPJs)';
  const margem = (m.receita || 0) > 0 ? (m.saldo || 0) / m.receita * 100 : null;
  const inner = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px">
      ${heroKpi('💚 A Receber (previsto)', 'R$ ' + moneyShort(r.previsto), lastDelta(s.receita), s.receita, '#22c55e')}
      ${heroKpi('❤️ A Pagar (previsto)', 'R$ ' + moneyShort(p.previsto), lastDelta(s.despesa), s.despesa, '#ef4444', true)}
      ${heroKpi('📊 Saldo previsto líq.', 'R$ ' + moneyShort(sa.previsto_liquido), lastDelta(s.saldo, true), s.saldo, (sa.previsto_liquido >= 0 ? '#22c55e' : '#f87171'))}
      ${heroKpi('✓ Saldo realizado', 'R$ ' + moneyShort(sa.realizado_liquido), lastDelta(s.saldoReal, true), s.saldoReal, (sa.realizado_liquido >= 0 ? '#14b8a6' : '#f87171'))}
    </div>

    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px;margin-top:16px;align-items:start">
      ${panel('📈 Receita × Despesa × Saldo (12 meses)', '<div style="position:relative;height:220px"><canvas id="fin-ch-line"></canvas></div>')}
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px">
        <div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:8px" id="fin-donut-title">Composição</div>
        <div style="position:relative;height:220px"><canvas id="fin-ch-donut"></canvas></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:14px">
      ${miniStat('Receita do mês', 'R$ ' + moneyShort(m.receita), '#22c55e')}
      ${miniStat('Despesa do mês', 'R$ ' + moneyShort(m.despesa), '#f87171')}
      ${miniStat('Saldo do mês', 'R$ ' + moneyShort(m.saldo), (m.saldo >= 0 ? '#22c55e' : '#f87171'))}
      ${miniStat('Margem do mês', margem == null ? '—' : margem.toFixed(0) + '%', (margem || 0) >= 0 ? '#14b8a6' : '#f87171')}
      ${miniStat('# rec / des mês', (m.n_receitas || 0) + ' / ' + (m.n_despesas || 0), '#94a3b8')}
    </div>`;
  return heroWrap('💰 Financeiro · NIBO ao vivo', compName + ' · DRE 12 meses · trend mês a mês', inner);
}

function buildResumoCharts() {
  loadChartLib().then(Chart => {
    if (!Chart) return;
    const mk = (id, cfg) => { const el = document.getElementById(id); if (el) _charts.push(new Chart(el, cfg)); };
    const dre = _cache['dre|' + _company];
    const s = dreSeries(dre);
    const fmtAxis = v => 'R$ ' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v);
    if (s.labels.length) {
      mk('fin-ch-line', {
        type: 'line',
        data: { labels: s.labels, datasets: [
          { label: 'Receita', data: s.receita, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.14)', fill: true, tension: 0.35, pointRadius: 0 },
          { label: 'Despesa', data: s.despesa, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.10)', fill: true, tension: 0.35, pointRadius: 0 },
          { label: 'Saldo', data: s.saldo, borderColor: '#38bdf8', tension: 0.35, pointRadius: 0, borderWidth: 2 },
        ] },
        options: darkOpts({ scales: {
          x: { ticks: { color: DARK_INK, font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: DARK_GRID } },
          y: { ticks: { color: DARK_INK, callback: fmtAxis }, grid: { color: DARK_GRID } },
        } }),
      });
    }
    const sm = _cache['summary|' + _company] || {};
    const spec = pickDonut(sm, s);
    const titleEl = document.getElementById('fin-donut-title');
    if (titleEl) titleEl.textContent = spec.title;
    if (spec.data.length) {
      mk('fin-ch-donut', {
        type: 'doughnut',
        data: { labels: spec.labels, datasets: [{ data: spec.data, backgroundColor: spec.colors, borderWidth: 0 }] },
        options: darkOpts({ cutout: '58%' }),
      });
    }
  }).catch(() => {});
}

// Escolhe a composição mais informativa com dado REAL: 1) categorias de despesa
// reais (ignora "sem categoria"); 2) despesa por empresa/CNPJ (Consolidado);
// 3) Receita × Despesa (12m). Nunca cai num donut de 1 fatia "Sem categoria".
function pickDonut(sm, s) {
  const PAL = ['#ef4444', '#f59e0b', '#a855f7', '#3b82f6', '#14b8a6', '#ec4899'];
  const vazio = n => { const t = (n || '').trim().toLowerCase(); return !t || t === 'sem categoria' || t === 'outros' || t === 'não classificado'; };
  const cats = (sm.por_categoria_despesa || []).filter(c => Math.abs(c.valor || 0) > 0 && !vazio(c.categoria)).slice(0, 6);
  if (cats.length >= 2) {
    return { title: '❤️ Mix de despesa (categorias)', labels: cats.map(c => (c.categoria || '—').slice(0, 22)), data: cats.map(c => Math.abs(c.valor)), colors: cats.map((_, i) => PAL[i % PAL.length]) };
  }
  const emp = Object.values(sm.por_empresa || {}).filter(e => (e.despesa_total || 0) > 0);
  if (emp.length >= 2) {
    return { title: '🏢 Despesa por empresa (CNPJ)', labels: emp.map(e => e.label || '—'), data: emp.map(e => e.despesa_total), colors: emp.map((_, i) => PAL[i % PAL.length]) };
  }
  const totRec = (s.receita || []).reduce((a, b) => a + (b || 0), 0);
  const totDes = (s.despesa || []).reduce((a, b) => a + (b || 0), 0);
  if (totRec > 0 || totDes > 0) {
    return { title: '💰 Receita × Despesa (12 meses)', labels: ['Receita', 'Despesa'], data: [totRec, totDes], colors: ['#22c55e', '#ef4444'] };
  }
  return { title: 'Composição', labels: [], data: [], colors: [] };
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

// ─── Tab: Métricas (MoM + Fluxo de Caixa + Alertas) ─────────────────────
async function renderMetricas() {
  const key = 'metricas|' + _company;
  if (!_cache[key]) _cache[key] = await api.request('/api/v3/finance/metricas?months=6&days_ahead=90&company=' + encodeURIComponent(_company));
  const d = _cache[key];
  const mom = d.mom || [];
  const cash = d.cashflow || [];
  const sum = d.summary || {};

  const alertColors = {
    critica: { bg: '#fee2e2', fg: '#991b1b', ico: '🔴' },
    alta:    { bg: '#fef3c7', fg: '#78350f', ico: '🟠' },
    media:   { bg: '#dbeafe', fg: '#1e40af', ico: '🟡' },
  };

  // Calcular pontos pra mini chart de saldo
  const maxSaldo = Math.max(...cash.map(c => c.saldo_acumulado), 1);
  const minSaldo = Math.min(...cash.map(c => c.saldo_acumulado), 0);
  const range = maxSaldo - minSaldo || 1;

  return `
    <div class="tiny muted" style="margin-bottom:10px">
      MoM últimos 6 meses · Fluxo de caixa próximos 90 dias · Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')}
    </div>

    <!-- Hero KPIs -->
    <div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpiBig('💧 Saldo previsto 90d', 'R$ ' + money(sum.saldo_90d),
               (sum.saldo_90d || 0) >= 0 ? 'positivo' : 'NEGATIVO',
               (sum.saldo_90d || 0) >= 0 ? '#16a34a' : '#dc2626')}
      ${kpiBig('⚠ Menor saldo previsto',  'R$ ' + money(sum.menor_saldo_90d), 'vale no período', sum.menor_saldo_90d >= 0 ? '#16a34a' : '#dc2626')}
      ${kpiBig('📉 Dias negativos',       fmtNum(sum.dias_negativos), 'de 90 dias previstos', sum.dias_negativos > 0 ? '#dc2626' : '#16a34a')}
      ${kpiBig('🚨 Alertas',              d.alerts?.length || 0, 'eventos a monitorar', (d.alerts?.length || 0) > 0 ? '#d97706' : '#16a34a')}
    </div>

    <!-- Alertas -->
    ${(d.alerts || []).length ? `
      <div class="card" style="margin:14px 0">
        <h3 class="card-title">🚨 Alertas inteligentes</h3>
        <div style="display:grid;gap:8px">
          ${d.alerts.map(a => {
            const ac = alertColors[a.level] || alertColors.media;
            return `<div style="background:${ac.bg};color:${ac.fg};padding:10px 14px;border-radius:var(--r-sm);font-size:13px;font-weight:600">
              ${ac.ico} <b>${escapeHtml(a.level.toUpperCase())}</b> · ${escapeHtml(a.msg)}
            </div>`;
          }).join('')}
        </div>
      </div>
    ` : '<div class="alert alert-ok">✅ Nenhum alerta crítico no período.</div>'}

    <!-- Tabela MoM -->
    <div class="card" style="margin:14px 0">
      <h3 class="card-title">📊 Mês vs Mês (variação %)</h3>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:780px">
          <thead>
            <tr style="background:var(--bg-3);border-bottom:2px solid var(--ink)">
              <th style="text-align:left;padding:8px">Mês</th>
              <th style="text-align:right;padding:8px;color:#16a34a">Receita</th>
              <th style="text-align:right;padding:8px;color:#16a34a">Δ%</th>
              <th style="text-align:right;padding:8px;color:#dc2626">Despesa</th>
              <th style="text-align:right;padding:8px;color:#dc2626">Δ%</th>
              <th style="text-align:right;padding:8px">Saldo</th>
              <th style="text-align:right;padding:8px">Δ%</th>
            </tr>
          </thead>
          <tbody>
            ${mom.map(m => momRow(m)).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Cashflow timeline -->
    <div class="card" style="margin:14px 0">
      <h3 class="card-title">💧 Fluxo de Caixa previsto (90 dias)</h3>
      <div style="position:relative;height:200px;background:var(--bg-3);border-radius:var(--r-sm);padding:10px;overflow:hidden">
        <svg viewBox="0 0 ${cash.length || 1} 100" preserveAspectRatio="none" style="width:100%;height:100%">
          <!-- Linha zero -->
          ${minSaldo < 0 ? `<line x1="0" y1="${(maxSaldo / range) * 100}" x2="${cash.length}" y2="${(maxSaldo / range) * 100}" stroke="var(--ink-muted)" stroke-width="0.2" stroke-dasharray="2,1"/>` : ''}
          <!-- Linha do saldo acumulado -->
          <polyline points="${cash.map((c, i) => `${i},${100 - ((c.saldo_acumulado - minSaldo) / range) * 100}`).join(' ')}"
                    fill="none" stroke="#2563eb" stroke-width="0.5"/>
          <!-- Pontos negativos em vermelho -->
          ${cash.filter(c => c.saldo_acumulado < 0).map((c, idx) => {
            const i = cash.indexOf(c);
            return `<circle cx="${i}" cy="${100 - ((c.saldo_acumulado - minSaldo) / range) * 100}" r="0.6" fill="#dc2626"/>`;
          }).join('')}
        </svg>
      </div>
      <div class="flex" style="justify-content:space-between;font-size:11px;margin-top:6px">
        <span class="muted">${cash[0]?.data ? new Date(cash[0].data).toLocaleDateString('pt-BR') : ''}</span>
        <span class="muted">${cash[Math.floor(cash.length/2)]?.data ? new Date(cash[Math.floor(cash.length/2)].data).toLocaleDateString('pt-BR') : ''}</span>
        <span class="muted">${cash[cash.length-1]?.data ? new Date(cash[cash.length-1].data).toLocaleDateString('pt-BR') : ''}</span>
      </div>
      <div class="tiny muted mt-2">
        Linha azul = saldo acumulado dia a dia · Pontos vermelhos = dias com saldo < 0 ·
        Considera só lançamentos não-pagos (previstos) NIBO.
      </div>
    </div>

    <!-- Eventos próximos 14 dias -->
    <div class="card" style="margin:14px 0">
      <h3 class="card-title">📅 Próximos 14 dias (eventos significativos)</h3>
      ${(() => {
        const next14 = cash.slice(0, 14).filter(c => c.in > 0 || c.out > 0);
        if (!next14.length) return '<div class="muted tiny">Sem lançamentos previstos.</div>';
        return `<table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--bg-3)">
            <th style="text-align:left;padding:6px 8px">Data</th>
            <th style="text-align:right;padding:6px 8px;color:#16a34a">Entrada</th>
            <th style="text-align:right;padding:6px 8px;color:#dc2626">Saída</th>
            <th style="text-align:right;padding:6px 8px">Saldo dia</th>
            <th style="text-align:right;padding:6px 8px">Acumulado</th>
          </tr></thead>
          <tbody>
            ${next14.map(c => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:5px 8px;font-weight:600">${new Date(c.data).toLocaleDateString('pt-BR')}</td>
                <td style="text-align:right;padding:5px 8px;color:#16a34a">${c.in > 0 ? 'R$ ' + money(c.in) + ` <span class="tiny muted">(${c.in_n})</span>` : '—'}</td>
                <td style="text-align:right;padding:5px 8px;color:#dc2626">${c.out > 0 ? 'R$ ' + money(c.out) + ` <span class="tiny muted">(${c.out_n})</span>` : '—'}</td>
                <td style="text-align:right;padding:5px 8px;font-weight:700;color:${c.saldo_dia >= 0 ? '#16a34a' : '#dc2626'}">R$ ${money(c.saldo_dia)}</td>
                <td style="text-align:right;padding:5px 8px;color:${c.saldo_acumulado >= 0 ? '#16a34a' : '#dc2626'}">R$ ${money(c.saldo_acumulado)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
      })()}
    </div>
  `;
}

function momRow(m) {
  const fmt = (pct) => {
    if (pct == null) return '<span class="muted">—</span>';
    const c = pct > 0 ? '#16a34a' : pct < 0 ? '#dc2626' : 'var(--ink-muted)';
    const sign = pct > 0 ? '+' : '';
    return `<span style="color:${c};font-weight:700">${sign}${pct.toFixed(1)}%</span>`;
  };
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px;font-weight:700">${escapeHtml(m.label)}</td>
      <td style="text-align:right;padding:6px 8px;color:#16a34a">R$ ${money(m.receita)}</td>
      <td style="text-align:right;padding:6px 8px">${fmt(m.receita_pct)}</td>
      <td style="text-align:right;padding:6px 8px;color:#dc2626">R$ ${money(m.despesa)}</td>
      <td style="text-align:right;padding:6px 8px">${fmt(m.despesa_pct)}</td>
      <td style="text-align:right;padding:6px 8px;font-weight:700;color:${m.saldo >= 0 ? '#16a34a' : '#dc2626'}">R$ ${money(m.saldo)}</td>
      <td style="text-align:right;padding:6px 8px">${fmt(m.saldo_pct)}</td>
    </tr>
  `;
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('pt-BR');
}

// ─── Tab: Custos Fixos ──────────────────────────────────────────────────
async function renderCustos() {
  const key = 'custos|' + _company;
  if (!_cache[key]) _cache[key] = await api.request('/api/v3/finance/custos_fixos?months=3&company=' + encodeURIComponent(_company));
  const d = _cache[key];
  const t = d.totals || {};
  const buckets = d.buckets || [];
  const monthKeys = d.month_keys || [];

  return `
    <div class="tiny muted" style="margin-bottom:10px">
      Categorias classificadas por keywords desde <code>${escapeHtml(d.since)}</code> · ${d.unclassified || 0} lançamentos fora dos buckets · Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')}
    </div>

    <div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpiMini('Total 3m',  'R$ ' + money(t.total))}
      ${kpiMini('Pago',       'R$ ' + money(t.pago), '#16a34a')}
      ${kpiMini('Previsto',   'R$ ' + money(t.previsto), '#d97706')}
      ${kpiMini('# categorias com dado', buckets.length)}
    </div>

    ${buckets.length === 0 ? '<div class="muted">Nenhuma categoria de custo fixo identificada nesse período.</div>' : ''}

    <div style="display:grid;gap:10px">
      ${buckets.map(b => bucketCard(b, monthKeys, t.total)).join('')}
    </div>
  `;
}

function bucketCard(b, monthKeys, totalGeral) {
  const pct = totalGeral > 0 ? Math.round((b.total / totalGeral) * 100) : 0;
  const monthCols = monthKeys.map(mk => {
    const v = (b.by_month || {})[mk] || 0;
    return `<td style="text-align:right;padding:6px 10px;font-size:11px">R$ ${money(v)}</td>`;
  }).join('');

  return `
    <div class="card" style="margin:0;border-left:4px solid #7c3aed">
      <div class="flex items-center gap-2" style="margin-bottom:6px">
        <h3 style="margin:0;font-size:14px;flex:1">${escapeHtml(b.bucket)}</h3>
        <span class="tiny muted">${b.count} lanç</span>
        <span style="font-weight:800;color:#7c3aed">R$ ${money(b.total)}</span>
        <span class="tiny muted">(${pct}%)</span>
      </div>
      <div style="background:var(--bg);height:4px;border-radius:2px;overflow:hidden;margin-bottom:8px">
        <div style="background:#7c3aed;height:100%;width:${Math.min(100, pct * 2)}%"></div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:8px">
        <span class="tiny" style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:var(--r-full);font-weight:600">Pago: R$ ${money(b.pago)}</span>
        <span class="tiny" style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:var(--r-full);font-weight:600">Previsto: R$ ${money(b.previsto)}</span>
      </div>

      ${monthKeys.length > 1 ? `
        <table style="width:100%;font-size:11.5px;border-collapse:collapse;margin-bottom:8px">
          <thead>
            <tr style="background:var(--bg-3)">
              <th style="text-align:left;padding:6px 10px;font-size:10px">Mês</th>
              ${monthKeys.map(mk => `<th style="text-align:right;padding:6px 10px;font-size:10px">${escapeHtml(formatMonth(mk))}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:6px 10px;font-weight:700">Total</td>
              ${monthCols}
            </tr>
          </tbody>
        </table>
      ` : ''}

      <details>
        <summary class="tiny muted" style="cursor:pointer">Ver ${b.rows.length} lançamento(s)</summary>
        <div style="max-height:240px;overflow-y:auto;margin-top:8px">
          <table style="width:100%;font-size:11.5px;border-collapse:collapse">
            <thead style="position:sticky;top:0;background:var(--bg-3)">
              <tr>
                <th style="text-align:left;padding:5px 8px">Data</th>
                <th style="text-align:left;padding:5px 8px">Fornecedor</th>
                <th style="text-align:right;padding:5px 8px">Valor</th>
                <th style="text-align:center;padding:5px 8px">✓</th>
              </tr>
            </thead>
            <tbody>
              ${b.rows.map(r => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:4px 8px" class="muted">${r.data ? new Date(r.data).toLocaleDateString('pt-BR') : '—'}</td>
                  <td style="padding:4px 8px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.stakeholder)}">${escapeHtml(r.stakeholder)}</td>
                  <td style="text-align:right;padding:4px 8px;font-weight:700">R$ ${money(r.valor)}</td>
                  <td style="text-align:center;padding:4px 8px">${r.settled ? '<span style="color:#16a34a">✓</span>' : '<span style="color:#d97706">⏳</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  `;
}

function formatMonth(mk) {
  const [y, m] = (mk || '').split('-');
  const names = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const i = parseInt(m, 10) - 1;
  if (i < 0 || i > 11) return mk;
  return `${names[i]}/${y.slice(-2)}`;
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
function moneyShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2).replace('.', ',') + ' mi';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace('.', ',') + ' mil';
  return money(v);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
