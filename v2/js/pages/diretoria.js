/* ============================================================================
   PSM-OS v2 — Dashboard Diretoria (Recados + Estratégia + KPIs)
   Sprint 7.14
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
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
      const d = await api.request('/api/v3/diretoria/dashboard?ano=' + _ano).catch(e => ({ error: e.message }));
      _data.dash = d;
      body.innerHTML = renderDashboard();
      buildDashCharts();
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

// ─── Tab: Dashboard ─────────────────────────────────────────────────────
function renderDashboard() {
  const d = _data.dash || {};
  if (d.error) return `<div class="alert alert-err">${escapeHtml(d.error)}</div>`;
  if (!d.kpis) return '<div class="muted">Sem dados.</div>';
  const k = d.kpis;

  return `
    ${dashHero(k, d)}

    <div class="tiny muted" style="margin-bottom:10px">
      ${_ano} · ${MES_NAMES[(k.mes || d.mes) - 1] || ''}/${_ano} · Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')}
    </div>

    <div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpi('👥 Equipe', k.users_ativos || 0, `${k.users_total || 0} cadastrados`, '#0891b2')}
      ${kpi('📋 Tarefas abertas', k.tarefas_abertas || 0, totalTarefas(k.tarefas), (k.tarefas_abertas || 0) > 0 ? '#d97706' : '#16a34a')}
      ${kpi('📅 Eventos 7d', k.eventos_proxima_semana || 0, 'próximos 7 dias', '#7c3aed')}
      ${kpi('📢 Recados', k.recados_ativos || 0, `${k.recados_criticos || 0} críticos`, k.recados_criticos > 0 ? '#dc2626' : '#16a34a')}
    </div>

    <!-- Equipe por team -->
    ${k.users_by_team && Object.keys(k.users_by_team).length ? `
      <div class="card" style="margin:0">
        <h3 class="card-title">🛡 Equipe por frente</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${Object.entries(k.users_by_team).map(([t, n]) => `
            <div style="background:var(--bg-3);border-radius:var(--r-full);padding:8px 18px;font-size:13px;font-weight:600">
              ${escapeHtml(t)} <span class="muted">·</span> <b>${n}</b>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Métricas executivas (só Diretoria) -->
    ${execMetrics(k)}

    <!-- Top actions 24h -->
    ${(k.top_actions_24h || []).length ? `
      <div class="card" style="margin:14px 0">
        <h3 class="card-title">⚡ Top ações últimas 24h</h3>
        <table style="width:100%;font-size:13px">
          ${k.top_actions_24h.map(a => `
            <tr><td style="padding:5px 0"><code>${escapeHtml(a.action)}</code></td><td style="text-align:right;font-weight:700">${a.count}</td></tr>
          `).join('')}
        </table>
        <div class="tiny muted mt-2">${k.audit_24h} eventos no audit_log nas últimas 24h.</div>
      </div>
    ` : ''}

    <div class="flex gap-2 mt-3">
      <a href="#/metas" class="btn btn-ghost">🎯 Ver Metas detalhadas</a>
      <a href="#/financeiro" class="btn btn-ghost">💰 Financeiro</a>
      <a href="#/crm" class="btn btn-ghost">🔗 CRM</a>
    </div>
  `;
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
        ${ex('🔄 Turnover', k.turnover_pct != null ? k.turnover_pct + '%' : '—', `${k.users_inativos || 0} inativos / ${k.users_total || 0}`, (k.turnover_pct || 0) > 15 ? '#dc2626' : '#d97706')}
      </div>
      <div class="tiny muted mt-2">Premissas PSM: comissão <b>${((pr.comissao_pct || 0.04) * 100).toFixed(1)}%</b> do VGV · custo variável <b>${((pr.custo_var_pct || 0.0145) * 100).toFixed(2)}%</b> do VGV · custo fixo/mês <b>${pr.custo_fixo_mensal ? 'R$ ' + moneyShort(pr.custo_fixo_mensal) : '—'}</b>. Margem = comissão (4% VGV) − custo variável (1,45% VGV) por venda.</div>
    </div>`;
}

// ─── Hero premium (dark + sparklines + gráficos) ────────────────────────
function dashHero(k, d) {
  const vgvMes = k.vgv_por_mes || [];
  const vendasMes = k.vendas_por_mes || [];
  const mesIdx = (k.mes || d.mes || 1) - 1;
  // Δ% entre os dois últimos meses COMPLETOS (o mês corrente é parcial e
  // distorceria o %); cai pra mês-a-mês simples se ainda não há 2 meses fechados.
  const dVgvMes = mesIdx >= 2 ? pctDelta(vgvMes[mesIdx - 1] || 0, vgvMes[mesIdx - 2] || 0)
                : mesIdx > 0 ? pctDelta(vgvMes[mesIdx] || 0, vgvMes[mesIdx - 1] || 0) : null;
  // VGV acumulado mês a mês (pra sparkline de "VGV Ano")
  let acc = 0; const vgvAcum = vgvMes.map(v => (acc += (v || 0)));
  const atingPct = k.atingimento_pct;
  const metaAno = k.meta_vgv_ano || 0;
  const inner = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px">
      ${heroKpi('💎 VGV Ano (atingido)', 'R$ ' + moneyShort(k.atingido_vgv_ano), null, vgvAcum, '#a855f7')}
      ${heroKpi('🎯 Meta Ano', 'R$ ' + moneyShort(metaAno), null, vgvMes.map(() => metaAno / 12), '#3b82f6')}
      ${heroKpi('📊 % Atingimento', (atingPct == null ? '—' : atingPct.toFixed(1) + '%'), null, vgvAcum.map(v => metaAno ? v / metaAno * 100 : 0), '#22c55e')}
      ${heroKpi('💵 VGV Mês', 'R$ ' + moneyShort(k.atingido_vgv_mes), dVgvMes, vgvMes, '#14b8a6')}
    </div>

    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px;margin-top:16px;align-items:start">
      ${panel('📈 VGV por mês × meta mensal (' + _ano + ')', '<div style="position:relative;height:210px"><canvas id="dir-ch-vgv"></canvas></div>')}
      ${panel('🛡 Equipe por frente', '<div style="position:relative;height:210px"><canvas id="dir-ch-team"></canvas></div>')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:14px">
      ${miniStat('Vendas no ano', fmtNum(k.atingido_vendas_ano), '#a855f7')}
      ${miniStat('Vendas no mês', fmtNum(k.atingido_vendas_mes), '#14b8a6')}
      ${miniStat('Equipe ativa', fmtNum(k.users_ativos), '#06b6d4')}
      ${miniStat('Tarefas abertas', fmtNum(k.tarefas_abertas), (k.tarefas_abertas || 0) > 0 ? '#f59e0b' : '#22c55e')}
      ${miniStat('Eventos 7d', fmtNum(k.eventos_proxima_semana), '#a855f7')}
      ${miniStat('Recados', fmtNum(k.recados_ativos) + (k.recados_criticos ? ' · ' + k.recados_criticos + '🔴' : ''), k.recados_criticos > 0 ? '#f87171' : '#22c55e')}
    </div>`;
  return heroWrap('🏛 Diretoria PSM · Painel Executivo', `Ano ${_ano} · meta R$ ${moneyShort(metaAno)} · atingido R$ ${moneyShort(k.atingido_vgv_ano)}`, inner);
}

async function buildDashCharts() {
  let Chart; try { Chart = await loadChartLib(); } catch (_) { return; }
  if (!Chart) return;
  _charts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _charts = [];
  const k = (_data.dash || {}).kpis || {};
  const mk = (id, cfg) => { const el = document.getElementById(id); if (el) _charts.push(new Chart(el, cfg)); };
  const MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const vgvMes = k.vgv_por_mes || [];
  if (vgvMes.length) {
    const metaMes = (k.meta_vgv_ano || 0) / 12;
    mk('dir-ch-vgv', {
      type: 'bar',
      data: { labels: MES, datasets: [
        { type: 'bar', label: 'VGV realizado', data: vgvMes, backgroundColor: 'rgba(168,85,247,0.65)', borderRadius: 4, order: 2 },
        { type: 'line', label: 'Meta mensal', data: MES.map(() => metaMes), borderColor: '#f59e0b', borderDash: [5, 4], pointRadius: 0, borderWidth: 2, order: 1 },
      ] },
      options: darkOpts({ scales: {
        x: { ticks: { color: DARK_INK, font: { size: 10 } }, grid: { color: DARK_GRID } },
        y: { beginAtZero: true, ticks: { color: DARK_INK, callback: v => 'R$ ' + (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v) }, grid: { color: DARK_GRID } },
      } }),
    });
  }

  const byTeam = k.users_by_team || {};
  const teams = Object.keys(byTeam);
  if (teams.length) {
    const PAL = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#14b8a6', '#ec4899'];
    mk('dir-ch-team', {
      type: 'doughnut',
      data: { labels: teams, datasets: [{ data: teams.map(t => byTeam[t]), backgroundColor: teams.map((_, i) => PAL[i % PAL.length]), borderWidth: 0 }] },
      options: darkOpts({ cutout: '58%' }),
    });
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
        <div class="tiny muted" style="margin-top:2px">Progresso: ${it.progresso}%</div>
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
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function moneyShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2).replace('.', ',') + ' mi';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + ' mil';
  return money(v);
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('pt-BR');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
