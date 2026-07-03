/* ============================================================================
   PSM-OS v2 — Dashboard Diretoria (Recados + Estratégia + KPIs)
   Sprint 7.14
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { FRENTES } from '../frentes.js';
import { heroWrap, heroKpi, miniStat, panel, loadChartLib, darkOpts, DARK_INK, DARK_GRID, pctDelta } from '../premium.js';

let _charts = [];

const TIPOS_EST = [
  { id: 'visao',      lbl: 'Visão',      ico: '🎯', color: '#7c3aed' },
  { id: 'missao',     lbl: 'Missão',     ico: '🚀', color: '#2563eb' },
  { id: 'objetivo',   lbl: 'Objetivos',  ico: '📍', color: '#16a34a' },
  { id: 'okr',        lbl: 'OKRs',       ico: '✅', color: '#d97706' },
  { id: 'iniciativa', lbl: 'Iniciativas',ico: '🛠', color: '#dc2626' },
];

const PRIOR_LBL = {
  info:    { lbl: 'Info',     bg: '#dbeafe', fg: '#1e40af', ico: 'ℹ️' },
  alerta:  { lbl: 'Alerta',   bg: '#fef3c7', fg: '#78350f', ico: '⚠️' },
  critica: { lbl: 'Crítica',  bg: '#fee2e2', fg: '#991b1b', ico: '🔴' },
};

let _root = null;
let _tab = 'dashboard';
let _ano = new Date().getFullYear();
let _periodo = 'ano';   // ano | ytd | t1..t4 | m1..m12  (v81.99)
let _frente = 'todas';  // todas | conquista | map | locacao | terceiros
let _data = {};

export async function pageDiretoria(ctx, root) {
  _root = root;
  await renderShell();
  await loadTab();
}

async function renderShell() {
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 7;
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🏛 Diretoria PSM</h2>
      <p class="card-sub">Painel executivo: KPIs consolidados, recados pra equipe, estratégia anual.${isSocio ? '' : ' <b>Visualização — edição requer Sócio/Gerente.</b>'}</p>

      <div class="flex gap-1" style="margin-top:14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        ${tabBtn('dashboard', '📊 Dashboard')}
        ${tabBtn('recados',   '📢 Recados')}
        ${tabBtn('estrategia','🎯 Estratégia')}
      </div>

      <div id="dir-body" style="margin-top:14px">
        <div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div>
      </div>
      <div id="dir-modal" style="display:none"></div>
    </div>
  `;
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', async () => {
    _tab = b.dataset.tab; await renderShell(); await loadTab();
  }));
}

async function loadTab() {
  const body = document.getElementById('dir-body');
  try {
    if (_tab === 'dashboard') {
      body.innerHTML = `<div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando painel…</div>`;
      const d = await api.request(`/api/v3/diretoria/dashboard?ano=${_ano}&periodo=${_periodo}&frente=${_frente}`).catch(e => ({ error: e.message }));
      _data.dash = d;
      body.innerHTML = renderDashboard();
      buildDashCharts();
      wireDashboard();
    } else if (_tab === 'recados') {
      const r = await api.request('/api/v3/diretoria/recados');
      _data.recados = r;
      body.innerHTML = renderRecados();
      wireRecados();
    } else if (_tab === 'estrategia') {
      const e = await api.request('/api/v3/diretoria/estrategia?ano=' + _ano);
      _data.est = e;
      body.innerHTML = renderEstrategia();
      wireEstrategia();
    }
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

// ─── Tab: Dashboard (Painel Executivo filtrável · v81.99) ────────────────
function renderDashboard() {
  const d = _data.dash || {};
  if (d.error) return `${filterBar()}<div class="alert alert-err">${escapeHtml(d.error)}</div>`;
  const k = d.kpis || {};
  const ex = k.exec;
  if (!ex) return `${filterBar()}<div class="muted">Sem dados para o filtro selecionado.</div>`;

  return `
    ${filterBar()}
    ${execHero(ex)}
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px;margin-top:14px;align-items:start">
      ${panel(`📈 VGV mês a mês ${ex.kpis.has_meta ? '× meta' : '(vs ano anterior)'} · ${escapeHtml(frenteLabel(ex))}`, '<div style="position:relative;height:230px"><canvas id="dir-ch-vgv"></canvas></div>')}
      ${panel('🥧 Participação por frente', '<div style="position:relative;height:230px"><canvas id="dir-ch-frente"></canvas></div>')}
    </div>
    ${forecastCard(ex.forecast)}
    ${porFrenteTable(ex)}
    ${rankingTable(ex.ranking)}

    <!-- Operação -->
    <div class="flex gap-3" style="flex-wrap:wrap;margin:16px 0 4px">
      ${kpi('👥 Equipe ativa', k.users_ativos || 0, `${k.users_total || 0} cadastrados`, '#0891b2')}
      ${kpi('📋 Tarefas abertas', k.tarefas_abertas || 0, totalTarefas(k.tarefas), (k.tarefas_abertas || 0) > 0 ? '#d97706' : '#16a34a')}
      ${kpi('📅 Eventos 7d', k.eventos_proxima_semana || 0, 'próximos 7 dias', '#7c3aed')}
      ${kpi('📢 Recados', k.recados_ativos || 0, `${k.recados_criticos || 0} críticos`, k.recados_criticos > 0 ? '#dc2626' : '#16a34a')}
    </div>
    ${execMetrics(k)}

    <div class="tiny muted" style="margin:8px 0">Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')} · fonte: deals ganhos (RD) + metas.</div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <a href="#/metas" class="btn btn-ghost">🎯 Metas detalhadas</a>
      <a href="#/financeiro" class="btn btn-ghost">💰 Financeiro</a>
      <a href="#/crm" class="btn btn-ghost">🔗 CRM</a>
      <a href="#/ranking" class="btn btn-ghost">🏆 Ranking completo</a>
    </div>
  `;
}

// ─── Barra de filtros (Ano · Período · Frente) ───────────────────────────
function frenteLabel(ex) {
  if (!ex || ex.frente === 'todas') return 'Todas as frentes';
  return (ex.frentes.find(f => f.code === ex.frente) || {}).label || ex.frente;
}
function filterBar() {
  const anoAtual = new Date().getFullYear();
  const ex = (_data.dash?.kpis || {}).exec;
  const frentes = (ex?.frentes) || FRENTES.map(f => ({ code: f.id, label: f.nome }));   // fallback = fonte única (v84.0)
  const MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const perGroups = [
    ['Consolidado', [['ano', 'Ano inteiro'], ['ytd', 'Acumulado no ano (YTD)']]],
    ['Trimestre', [['t1', '1º Trimestre'], ['t2', '2º Trimestre'], ['t3', '3º Trimestre'], ['t4', '4º Trimestre']]],
    ['Mês', MES.map((m, i) => ['m' + (i + 1), m])],
  ];
  const perOpts = perGroups.map(([g, opts]) =>
    `<optgroup label="${g}">${opts.map(([v, l]) => `<option value="${v}"${v === _periodo ? ' selected' : ''}>${l}</option>`).join('')}</optgroup>`).join('');
  const frOpts = `<option value="todas"${_frente === 'todas' ? ' selected' : ''}>Todas as frentes</option>` +
    frentes.map(f => `<option value="${f.code}"${f.code === _frente ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;background:var(--bg-3);padding:10px 12px;border-radius:12px;margin-bottom:14px">
      <div class="flex" style="align-items:center;gap:4px;background:var(--bg-2);border-radius:8px;padding:2px">
        <button class="btn btn-ghost btn-sm" data-ano-set="${_ano - 1}" title="Ano anterior" style="padding:4px 9px">◄</button>
        <span style="font-weight:800;min-width:52px;text-align:center">${_ano}</span>
        <button class="btn btn-ghost btn-sm" data-ano-set="${_ano + 1}" title="Próximo ano" style="padding:4px 9px" ${_ano >= anoAtual ? 'disabled' : ''}>►</button>
      </div>
      <label class="tiny muted" style="display:flex;flex-direction:column;gap:2px">Período
        <select id="dir-f-periodo" class="select" style="min-width:170px">${perOpts}</select>
      </label>
      <label class="tiny muted" style="display:flex;flex-direction:column;gap:2px">Frente / unidade
        <select id="dir-f-frente" class="select" style="min-width:150px">${frOpts}</select>
      </label>
      ${ex ? `<span class="badge" style="background:var(--psm-navy);color:#fff;font-weight:700;align-self:flex-end;margin-bottom:2px">${escapeHtml(ex.kpis.label_periodo)}</span>` : ''}
      <button class="btn btn-ghost btn-sm" id="dir-refresh" style="margin-left:auto;align-self:flex-end">🔄 Atualizar</button>
    </div>`;
}

// ─── Hero executivo (dark) ───────────────────────────────────────────────
function subline(txt) { return `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${txt}</div>`; }
function deltaBadge(pct) {
  if (pct == null) return `<span style="font-size:12px;color:#94a3b8">— vs anterior</span>`;
  const up = pct >= 0, c = up ? '#34d399' : '#f87171', ar = up ? '▲' : '▼';
  return `<span style="font-size:12px;color:${c};font-weight:700">${ar} ${Math.abs(pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span> <span style="font-size:11px;color:#94a3b8">vs anterior</span>`;
}
function heroCard(label, val, subHtml, color) {
  return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 16px">
    <div style="font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:1px;font-weight:700">${label}</div>
    <div style="font-size:25px;font-weight:900;color:${color};margin:3px 0;line-height:1.1">${val}</div>
    ${subHtml || ''}
  </div>`;
}
function atingCard(pct) {
  const col = pct == null ? '#94a3b8' : pct < 60 ? '#f87171' : pct < 95 ? '#fbbf24' : '#34d399';
  const w = Math.min(100, Math.max(0, pct || 0));
  return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 16px">
    <div style="font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:1px;font-weight:700">📊 % Atingimento</div>
    <div style="font-size:25px;font-weight:900;color:${col};margin:3px 0;line-height:1.1">${pct == null ? '—' : pct2(pct)}</div>
    <div style="height:7px;background:rgba(255,255,255,.12);border-radius:99px;overflow:hidden;margin-top:5px"><div style="height:100%;width:${w}%;background:${col};transition:width .4s"></div></div>
  </div>`;
}
function execHero(ex) {
  const k = ex.kpis;
  const cards = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px">
      ${heroCard('💎 VGV realizado', 'R$ ' + moneyC(k.vgv), subline(deltaBadge(k.delta_vgv_pct)), '#c084fc')}
      ${k.has_meta
        ? heroCard('🎯 Meta do período', 'R$ ' + moneyC(k.meta), subline(k.gap > 0 ? `faltam <b style="color:#f87171">R$ ${moneyC(k.gap)}</b>` : `<b style="color:#34d399">meta batida</b> (+R$ ${moneyC(-k.gap)})`), '#60a5fa')
        : heroCard('🎟 Ticket médio', 'R$ ' + moneyC(k.ticket), subline(`${fmtNum(k.vendas)} vendas no período`), '#60a5fa')}
      ${k.has_meta ? atingCard(k.ating_pct) : heroCard('🥧 Participação', shareOfSelected(ex), subline('do VGV total do período'), '#22d3ee')}
      ${heroCard('🤝 Vendas', fmtNum(k.vendas), subline(deltaBadge(k.delta_vendas_pct)), '#2dd4bf')}
    </div>`;
  return heroWrap('🏛 Diretoria PSM · Painel Executivo', `${k.label_periodo} · ${escapeHtml(frenteLabel(ex))}`, cards);
}
function shareOfSelected(ex) {
  const f = (ex.por_frente || []).find(x => x.code === ex.frente);
  return f ? pct2(f.share_pct) : '—';
}

// ─── Forecast / projeção ─────────────────────────────────────────────────
function forecastCard(fc) {
  if (!fc) return '';
  const on = fc.on_track;
  const col = on == null ? '#64748b' : on ? '#16a34a' : '#dc2626';
  return `
    <div class="card" style="margin:14px 0;border-left:5px solid ${col}">
      <h3 class="card-title">🔮 Projeção do ano <span class="tiny muted" style="font-weight:400">· ritmo atual</span></h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${miniStat('Realizado YTD', 'R$ ' + moneyC(fc.ytd_vgv), '#a855f7')}
        ${miniStat('Projeção fim do ano', 'R$ ' + moneyC(fc.run_rate_anual), col)}
        ${miniStat('% da meta (projeção)', fc.proj_pct == null ? '—' : pct2(fc.proj_pct), col)}
        ${miniStat('Falta p/ meta', fc.falta > 0 ? 'R$ ' + moneyC(fc.falta) : 'R$ 0', fc.falta > 0 ? '#d97706' : '#16a34a')}
        ${miniStat('Ritmo necessário/mês', fc.ritmo_necessario_mes > 0 ? 'R$ ' + moneyC(fc.ritmo_necessario_mes) : '✔ no ritmo', fc.ritmo_necessario_mes > 0 ? '#dc2626' : '#16a34a')}
      </div>
      <div class="tiny muted mt-2">Projeção = run-rate (VGV ÷ ${fc.elapsed_months} ${fc.elapsed_months === 1 ? 'mês' : 'meses'} × 12). ${on ? '✅ No ritmo pra bater a meta.' : '⚠️ Abaixo do ritmo — precisa acelerar os meses restantes.'}</div>
    </div>`;
}

// ─── Quebra por frente ───────────────────────────────────────────────────
function porFrenteTable(ex) {
  const rows = ex.por_frente || [];
  if (!rows.length) return '';
  const maxV = Math.max(1, ...rows.map(r => r.vgv));
  return `
    <div class="card" style="margin:14px 0">
      <h3 class="card-title">🛡 Desempenho por frente <span class="tiny muted" style="font-weight:400">· ${escapeHtml(ex.kpis.label_periodo)}</span></h3>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:560px">
        <thead><tr style="background:var(--bg-3);text-align:left">
          <th style="padding:8px">Frente</th><th style="padding:8px;text-align:right">VGV</th>
          <th style="padding:8px;text-align:right">Vendas</th><th style="padding:8px;text-align:right">Ticket</th>
          <th style="padding:8px;text-align:right">Part.</th><th style="padding:8px;text-align:right">vs ant.</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr style="border-bottom:1px solid var(--border);cursor:pointer" data-frente-row="${r.code}" title="Filtrar por ${escapeHtml(r.label)}">
              <td style="padding:8px"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${r.cor};margin-right:7px"></span><b>${escapeHtml(r.label)}</b></td>
              <td style="padding:8px;text-align:right">
                <div style="font-weight:700">R$ ${moneyC(r.vgv)}</div>
                <div style="height:5px;background:var(--bg-3);border-radius:99px;overflow:hidden;margin-top:3px"><div style="height:100%;width:${(r.vgv / maxV * 100).toFixed(1)}%;background:${r.cor}"></div></div>
              </td>
              <td style="padding:8px;text-align:right">${fmtNum(r.vendas)}</td>
              <td style="padding:8px;text-align:right">R$ ${moneyC(r.ticket)}</td>
              <td style="padding:8px;text-align:right">${pct2(r.share_pct)}</td>
              <td style="padding:8px;text-align:right">${r.delta_pct == null ? '<span class="muted">—</span>' : `<span style="color:${r.delta_pct >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${r.delta_pct >= 0 ? '▲' : '▼'} ${Math.abs(r.delta_pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>`}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="tiny muted mt-2">Clique numa frente pra filtrar o painel inteiro. Frentes vêm do funil do RD (Conquista/MAP/Locação/Terceiros).</div>
    </div>`;
}

// ─── Ranking de corretores ───────────────────────────────────────────────
function rankingTable(rk) {
  if (!rk || !rk.length) return `<div class="card" style="margin:14px 0"><h3 class="card-title">🏆 Ranking de corretores</h3><div class="muted tiny" style="padding:10px">Sem vendas registradas no período/frente selecionado.</div></div>`;
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span class="muted">${i + 1}º</span>`;
  const maxV = Math.max(1, ...rk.map(r => r.vgv));
  return `
    <div class="card" style="margin:14px 0">
      <h3 class="card-title">🏆 Ranking de corretores <span class="tiny muted" style="font-weight:400">· por VGV no período</span></h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tbody>
          ${rk.map((r, i) => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:7px 8px;width:34px;font-weight:800">${medal(i)}</td>
              <td style="padding:7px 8px;font-weight:600">${escapeHtml(r.nome)}</td>
              <td style="padding:7px 8px;width:44%">
                <div style="height:6px;background:var(--bg-3);border-radius:99px;overflow:hidden"><div style="height:100%;width:${(r.vgv / maxV * 100).toFixed(1)}%;background:linear-gradient(90deg,#7c3aed,#a855f7)"></div></div>
              </td>
              <td style="padding:7px 8px;text-align:right;font-weight:700;white-space:nowrap">R$ ${moneyC(r.vgv)}</td>
              <td style="padding:7px 8px;text-align:right;color:var(--ink-muted);white-space:nowrap">${fmtNum(r.vendas)} vd</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── Wiring dos filtros ──────────────────────────────────────────────────
function wireDashboard() {
  const per = document.getElementById('dir-f-periodo');
  if (per) per.onchange = e => { _periodo = e.target.value; loadTab(); };
  const fr = document.getElementById('dir-f-frente');
  if (fr) fr.onchange = e => { _frente = e.target.value; loadTab(); };
  document.querySelectorAll('[data-ano-set]').forEach(b => { if (!b.disabled) b.onclick = () => { _ano = parseInt(b.dataset.anoSet); loadTab(); }; });
  const rf = document.getElementById('dir-refresh'); if (rf) rf.onclick = () => loadTab();
  document.querySelectorAll('[data-frente-row]').forEach(r => r.addEventListener('click', () => { _frente = r.dataset.frenteRow; loadTab(); }));
}

// ─── Métricas executivas (Diretoria) ────────────────────────────────────
function execMetrics(k) {
  const pr = k.exec_premissas || {};
  const ex = (lbl, val, sub, color) => `<div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:var(--r-md);padding:12px 14px;border-left:4px solid ${color}">
    <div style="font-size:11px;color:var(--ink-muted);font-weight:600">${lbl}</div>
    <div style="font-size:22px;font-weight:900;color:${color};margin:2px 0">${val}</div>
    <div class="tiny muted">${sub}</div></div>`;
  const cfHint = k.custo_fixo_por_venda != null ? 'mês ÷ vendas do mês' : 'defina o custo fixo mensal nas premissas';
  return `
    <div class="card" style="margin:14px 0">
      <h3 class="card-title">📊 Métricas Executivas <span class="tiny muted" style="font-weight:400">· só Diretoria</span></h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        ${ex('🎟 Ticket médio', 'R$ ' + moneyShort(k.ticket_medio || 0), 'VGV ÷ vendas (ano)', '#0ea5e9')}
        ${ex('🏦 Custo fixo / venda', k.custo_fixo_por_venda != null ? 'R$ ' + moneyShort(k.custo_fixo_por_venda) : '—', cfHint, '#ef4444')}
        ${ex('💚 Margem contrib. / venda', 'R$ ' + moneyShort(k.margem_contrib_venda || 0), 'comissão − custo variável', '#16a34a')}
        ${ex('♻️ LTV (comissão/cliente)', 'R$ ' + moneyShort(k.ltv || 0), 'comissão média por cliente', '#a855f7')}
        ${ex('🔄 Turnover', k.turnover_pct != null ? pct2(k.turnover_pct) : '—', `${k.users_inativos || 0} inativos / ${k.users_total || 0}`, (k.turnover_pct || 0) > 15 ? '#dc2626' : '#d97706')}
      </div>
      <div class="tiny muted mt-2">Premissas PSM: comissão <b>${pct2((pr.comissao_pct || 0.04) * 100)}</b> do VGV · custo variável <b>${pct2((pr.custo_var_pct || 0.0145) * 100)}</b> do VGV · custo fixo/mês <b>${pr.custo_fixo_mensal ? 'R$ ' + moneyShort(pr.custo_fixo_mensal) : '—'}</b>. Margem = comissão (4% VGV) − custo variável (1,45% VGV) por venda.</div>
    </div>`;
}

// ─── Gráficos do painel (dirigidos pelo bloco exec · respeitam os filtros) ──
async function buildDashCharts() {
  let Chart; try { Chart = await loadChartLib(); } catch (_) { return; }
  if (!Chart) return;
  _charts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _charts = [];
  const ex = ((_data.dash || {}).kpis || {}).exec;
  if (!ex) return;
  const mk = (id, cfg) => { const el = document.getElementById(id); if (el) _charts.push(new Chart(el, cfg)); };
  const yTick = v => 'R$ ' + (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v);

  // 1) VGV mês a mês do ano corrente: barras = realizado; linha = meta (global) OU ano anterior (frente)
  const s = ex.serie || {};
  if ((s.vgv || []).length) {
    const ds = [{ type: 'bar', label: 'VGV realizado', data: s.vgv, backgroundColor: 'rgba(168,85,247,0.65)', borderRadius: 4, order: 2 }];
    if (s.meta) ds.push({ type: 'line', label: 'Meta mensal', data: s.meta, borderColor: '#f59e0b', borderDash: [5, 4], pointRadius: 0, borderWidth: 2, order: 1 });
    else if (s.vgv_ano_ant) ds.push({ type: 'line', label: `${_ano - 1}`, data: s.vgv_ano_ant, borderColor: '#38bdf8', pointRadius: 0, borderWidth: 2, order: 1 });
    mk('dir-ch-vgv', {
      type: 'bar',
      data: { labels: s.meses || [], datasets: ds },
      options: darkOpts({ scales: {
        x: { ticks: { color: DARK_INK, font: { size: 10 } }, grid: { color: DARK_GRID } },
        y: { beginAtZero: true, ticks: { color: DARK_INK, callback: yTick }, grid: { color: DARK_GRID } },
      } }),
    });
  }

  // 2) Participação por frente (VGV do período)
  const pf = (ex.por_frente || []).filter(r => r.vgv > 0);
  if (pf.length) {
    mk('dir-ch-frente', {
      type: 'doughnut',
      data: { labels: pf.map(r => r.label), datasets: [{ data: pf.map(r => r.vgv), backgroundColor: pf.map(r => r.cor), borderWidth: 0 }] },
      options: darkOpts({ cutout: '58%' }),
    });
  } else {
    const el = document.getElementById('dir-ch-frente');
    if (el && el.parentElement) el.parentElement.innerHTML = '<div style="color:#94a3b8;font-size:12px;text-align:center;padding:40px 10px">Sem VGV no período.</div>';
  }
}

// ─── Tab: Recados ──────────────────────────────────────────────────────
function renderRecados() {
  const recados = (_data.recados?.recados) || [];
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 7;
  return `
    <div class="flex gap-2" style="align-items:center;margin-bottom:14px">
      <div class="tiny muted">${recados.length} recado(s) ativo(s)</div>
      ${isSocio ? '<button class="btn btn-primary" id="btn-novo-recado" style="margin-left:auto">+ Novo recado</button>' : ''}
    </div>

    ${recados.length === 0 ? '<div class="muted text-center" style="padding:30px">Nenhum recado ativo.</div>' :
      `<div style="display:grid;gap:8px">
        ${recados.map(r => recadoCard(r, isSocio)).join('')}
      </div>`
    }
  `;
}

function recadoCard(r, isSocio) {
  const p = PRIOR_LBL[r.prioridade] || PRIOR_LBL.info;
  const dt = new Date(r.data_inicio).toLocaleString('pt-BR');
  const ate = r.data_fim ? `até ${new Date(r.data_fim).toLocaleString('pt-BR')}` : 'sem expiração';
  return `
    <div style="background:${p.bg};color:${p.fg};border-left:4px solid ${p.fg};border-radius:var(--r-sm);padding:12px 16px">
      <div class="flex items-center gap-2" style="margin-bottom:6px">
        <span style="font-size:16px">${p.ico}</span>
        <span style="font-weight:800">${p.lbl}</span>
        ${r.fixado ? '<span class="tiny" style="background:#fff;color:#0f172a;padding:2px 8px;border-radius:var(--r-full);font-weight:700">📌 FIXADO</span>' : ''}
        <span style="margin-left:auto;font-size:11px;opacity:0.7">${dt} · ${ate}</span>
        ${isSocio ? `<button class="btn btn-ghost tiny" data-rec-edit="${r.id}" style="padding:3px 8px">✏️</button>` : ''}
        ${isSocio ? `<button class="btn btn-ghost tiny" data-rec-del="${r.id}" style="padding:3px 8px">🗑</button>` : ''}
      </div>
      <div style="font-size:14px;font-weight:500;line-height:1.4">${escapeHtml(r.texto)}</div>
      ${r.audiencia && r.audiencia !== 'todos' ? `<div class="tiny" style="margin-top:6px;opacity:0.7">🎯 ${escapeHtml(r.audiencia)}</div>` : ''}
    </div>
  `;
}

function wireRecados() {
  const btnNovo = document.getElementById('btn-novo-recado');
  if (btnNovo) btnNovo.addEventListener('click', () => openRecadoModal());
  document.querySelectorAll('[data-rec-edit]').forEach(b => b.addEventListener('click', () => openRecadoModal(b.dataset.recEdit)));
  document.querySelectorAll('[data-rec-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Apagar este recado?')) return;
    try {
      await api.request('/api/v3/diretoria/recados', { method: 'POST', body: { id: b.dataset.recDel, _delete: true } });
      await loadTab();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

function openRecadoModal(rid) {
  const r = rid ? (_data.recados?.recados || []).find(x => x.id === rid) : null;
  const modal = document.getElementById('dir-modal');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:520px;width:100%">
      <h3 class="card-title">${r ? '✏️ Editar recado' : '➕ Novo recado'}</h3>
      <div class="field">
        <label>Texto *</label>
        <textarea id="rec-texto" class="input" rows="3" placeholder="Mensagem pro time">${r ? escapeHtml(r.texto) : ''}</textarea>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px">
          <label>Prioridade</label>
          <select id="rec-prior" class="select">
            <option value="info"${r?.prioridade==='info'?' selected':''}>ℹ️ Info</option>
            <option value="alerta"${r?.prioridade==='alerta'?' selected':''}>⚠️ Alerta</option>
            <option value="critica"${r?.prioridade==='critica'?' selected':''}>🔴 Crítica</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Público-alvo</label>
          <select id="rec-aud" class="select">
            ${[['todos','👥 Todos'],['corretores','🧑‍💼 Corretores'],['lideres','⭐ Líderes+'],['gerencia','🎖 Gerência+'],['diretoria','👑 Diretoria']]
              .map(([v,l]) => `<option value="${v}"${(r?.audiencia||'todos')===v?' selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Expira em</label>
          <input id="rec-fim" type="datetime-local" class="input" value="${r?.data_fim ? r.data_fim.substring(0,16) : ''}">
        </div>
      </div>
      <div class="field">
        <label class="flex items-center gap-2"><input id="rec-fix" type="checkbox" ${r?.fixado?'checked':''}> Fixar no topo</label>
      </div>
      <div id="rec-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="rec-cancel">Cancelar</button>
        <button class="btn btn-primary" id="rec-save">${r ? 'Salvar' : 'Publicar'}</button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('rec-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('rec-save').addEventListener('click', async () => {
    const texto = document.getElementById('rec-texto').value.trim();
    if (!texto) { document.getElementById('rec-msg').innerHTML = '<div class="alert alert-err">Texto obrigatório.</div>'; return; }
    try {
      const fim = document.getElementById('rec-fim').value;
      await api.request('/api/v3/diretoria/recados', { method: 'POST', body: {
        id: r?.id,
        texto,
        prioridade: document.getElementById('rec-prior').value,
        audiencia: document.getElementById('rec-aud').value,
        data_fim: fim ? new Date(fim).toISOString() : null,
        fixado: document.getElementById('rec-fix').checked,
      } });
      modal.style.display = 'none';
      await loadTab();
    } catch (e) {
      document.getElementById('rec-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
    }
  });
}

// ─── Tab: Estratégia ───────────────────────────────────────────────────
function renderEstrategia() {
  const e = _data.est || { groups: {} };
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 7;
  return `
    <div class="flex gap-2" style="align-items:center;margin-bottom:14px">
      <label class="tiny muted" style="font-weight:700">ANO:</label>
      <select id="est-ano" class="select" style="padding:5px 10px;font-size:12px">
        ${[2024, 2025, 2026, 2027].map(a => `<option value="${a}"${a === _ano ? ' selected' : ''}>${a}</option>`).join('')}
      </select>
      ${isSocio ? '<button class="btn btn-primary" id="btn-novo-est" style="margin-left:auto">+ Novo item</button>' : ''}
    </div>

    <div style="display:grid;gap:14px">
      ${TIPOS_EST.map(t => grupoEst(t, e.groups[t.id] || [], isSocio)).join('')}
    </div>
  `;
}

function grupoEst(tipo, items, isSocio) {
  return `
    <div class="card" style="margin:0;border-top:3px solid ${tipo.color}">
      <h3 class="card-title">${tipo.ico} ${tipo.lbl} <span class="muted tiny" style="font-weight:400">(${items.length})</span></h3>
      ${items.length === 0 ? '<div class="muted tiny">Nenhum item.</div>' : `
        <div style="display:grid;gap:6px">
          ${items.map(i => estItem(i, isSocio)).join('')}
        </div>
      `}
    </div>
  `;
}

function estItem(it, isSocio) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 12px">
      <div class="flex items-center gap-2">
        <div style="flex:1">
          <div style="font-weight:700">${escapeHtml(it.titulo)}</div>
          ${it.descricao ? `<div class="tiny muted" style="margin-top:2px">${escapeHtml(it.descricao)}</div>` : ''}
        </div>
        <span class="tiny" style="background:${it.status === 'concluido' ? '#dcfce7;color:#166534' : it.status === 'ativo' ? '#dbeafe;color:#1e40af' : '#fef3c7;color:#78350f'};padding:3px 8px;border-radius:var(--r-full);font-weight:600">${escapeHtml(it.status)}</span>
        ${isSocio ? `<button class="btn btn-ghost tiny" data-est-edit="${it.id}" style="padding:3px 8px">✏️</button>` : ''}
        ${isSocio ? `<button class="btn btn-ghost tiny" data-est-del="${it.id}" style="padding:3px 8px">🗑</button>` : ''}
      </div>
      ${it.progresso != null ? `
        <div style="background:var(--bg);height:6px;border-radius:3px;overflow:hidden;margin-top:6px">
          <div style="background:#16a34a;height:100%;width:${Math.min(100, it.progresso)}%"></div>
        </div>
        <div class="tiny muted" style="margin-top:2px">Progresso: ${pct2(it.progresso)}</div>
      ` : ''}
    </div>
  `;
}

function wireEstrategia() {
  document.getElementById('est-ano').addEventListener('change', async e => { _ano = parseInt(e.target.value); await loadTab(); });
  const btnNovo = document.getElementById('btn-novo-est');
  if (btnNovo) btnNovo.addEventListener('click', () => openEstModal());
  document.querySelectorAll('[data-est-edit]').forEach(b => b.addEventListener('click', () => openEstModal(parseInt(b.dataset.estEdit))));
  document.querySelectorAll('[data-est-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Apagar este item?')) return;
    try {
      await api.request('/api/v3/diretoria/estrategia', { method: 'POST', body: { id: parseInt(b.dataset.estDel), _delete: true } });
      await loadTab();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

function openEstModal(itid) {
  const it = itid ? (_data.est?.items || []).find(x => x.id === itid) : null;
  const modal = document.getElementById('dir-modal');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:520px;width:100%">
      <h3 class="card-title">${it ? '✏️ Editar item' : '➕ Novo item de estratégia'}</h3>
      <div class="field">
        <label>Tipo *</label>
        <select id="est-tipo" class="select">
          ${TIPOS_EST.map(t => `<option value="${t.id}"${it?.tipo === t.id ? ' selected' : ''}>${t.ico} ${t.lbl}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Título *</label>
        <input id="est-titulo" class="input" value="${it ? escapeHtml(it.titulo) : ''}">
      </div>
      <div class="field">
        <label>Descrição</label>
        <textarea id="est-desc" class="input" rows="3">${it?.descricao ? escapeHtml(it.descricao) : ''}</textarea>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px">
          <label>Ano</label>
          <input id="est-ano-i" type="number" class="input" value="${it?.ano || _ano}">
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Status</label>
          <select id="est-status" class="select">
            <option value="ativo"${(it?.status || 'ativo')==='ativo'?' selected':''}>Ativo</option>
            <option value="rascunho"${it?.status==='rascunho'?' selected':''}>Rascunho</option>
            <option value="concluido"${it?.status==='concluido'?' selected':''}>Concluído</option>
            <option value="cancelado"${it?.status==='cancelado'?' selected':''}>Cancelado</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Progresso %</label>
          <input id="est-prog" type="number" min="0" max="100" class="input" value="${it?.progresso || 0}">
        </div>
      </div>
      <div id="est-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="est-cancel">Cancelar</button>
        <button class="btn btn-primary" id="est-save">${it ? 'Salvar' : 'Criar'}</button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('est-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('est-save').addEventListener('click', async () => {
    const titulo = document.getElementById('est-titulo').value.trim();
    if (!titulo) { document.getElementById('est-msg').innerHTML = '<div class="alert alert-err">Título obrigatório.</div>'; return; }
    try {
      await api.request('/api/v3/diretoria/estrategia', { method: 'POST', body: {
        id: it?.id,
        tipo: document.getElementById('est-tipo').value,
        titulo,
        descricao: document.getElementById('est-desc').value.trim() || null,
        ano: parseInt(document.getElementById('est-ano-i').value),
        status: document.getElementById('est-status').value,
        progresso: parseInt(document.getElementById('est-prog').value) || 0,
      } });
      modal.style.display = 'none';
      await loadTab();
    } catch (e) {
      document.getElementById('est-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────
const MES_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function tabBtn(id, lbl) {
  return `<button class="btn" data-tab="${id}" style="border-radius:var(--r-sm) var(--r-sm) 0 0;background:${_tab === id ? 'var(--psm-navy)' : 'transparent'};color:${_tab === id ? '#fff' : 'var(--ink-muted)'};border-bottom:none;font-weight:700">${lbl}</button>`;
}
function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}
function pctColor(pct) {
  if (pct == null) return 'var(--ink-muted)';
  if (pct < 50) return '#dc2626';
  if (pct < 90) return '#d97706';
  if (pct < 110) return '#16a34a';
  return '#065f46';
}
function totalTarefas(t) {
  if (!t) return '—';
  return Object.entries(t).map(([k, v]) => `${k}:${v}`).join(' · ');
}
function money(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneyShort(n) {
  return money(n);
}
// compacto p/ o painel executivo: 1,25 Mi · 340 mil · 850 (v81.99)
function moneyC(n) {
  n = Number(n) || 0; const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Mi';
  if (a >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function fmtNum(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('pt-BR');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
