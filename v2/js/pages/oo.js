/* PSM-OS v2 — One-on-One · Cockpit de Gestão Individual do Corretor */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _view = 'list';            // 'list' | 'detail'
let _selId = '';               // corretor selecionado
let _preset = 'this_month';
let _since = '', _until = '';  // período custom (data início/fim)
let _ov = null;                // overview (lista)
let _det = null;               // detalhe do corretor
let _norte = null;             // 🎯 meta do mês (norte) do corretor selecionado
let _meet = [];                // reuniões 1:1 do corretor
let _users = [];
let _scope = 'individual';     // 'individual' | 'equipe' (só líderes têm equipe)
/* 🧪 Simulador (v86.1) — aba individual por corretor, sócio-only */
let _dtab = 'cockpit';         // 'cockpit' | 'simulador'
let _sim = null;               // estado calibrado (GET /oo/simulador)
let _simCen = null;            // cenário em edição
let _simRes = null;            // último resultado simulado
let _simTimer = null;

const PRESETS = [
  { id: 'hoje', lbl: 'Hoje' },
  { id: 'semana', lbl: 'Semana atual' },
  { id: 'q1', lbl: '1ª quinzena' },
  { id: 'q2', lbl: '2ª quinzena' },
  { id: 'this_month', lbl: 'Mês atual' },
  { id: 'last_month', lbl: 'Mês passado' },
  { id: 'tri1', lbl: '1º trimestre' },
  { id: 'tri2', lbl: '2º trimestre' },
  { id: 'tri3', lbl: '3º trimestre' },
  { id: 'tri4', lbl: '4º trimestre' },
  { id: 'sem1', lbl: '1º semestre' },
  { id: 'sem2', lbl: '2º semestre' },
  { id: 'this_year', lbl: 'Ano' },
];

// Todo preset vira since/until calculado AQUI (o backend só recebe datas) —
// assim o funil meta × realizado prorateia a meta com a mesma janela.
function presetRange(id) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const lastDay = new Date(y, m + 1, 0);
  switch (id) {
    case 'hoje': return [fmt(t), fmt(t)];
    case 'semana': { const dow = (t.getDay() + 6) % 7; return [fmt(new Date(y, m, t.getDate() - dow)), fmt(new Date(y, m, t.getDate() - dow + 6))]; }
    case 'q1': return [fmt(new Date(y, m, 1)), fmt(new Date(y, m, 15))];
    case 'q2': return [fmt(new Date(y, m, 16)), fmt(lastDay)];
    case 'this_month': return [fmt(new Date(y, m, 1)), fmt(lastDay)];
    case 'last_month': return [fmt(new Date(y, m - 1, 1)), fmt(new Date(y, m, 0))];
    case 'tri1': return [`${y}-01-01`, `${y}-03-31`];
    case 'tri2': return [`${y}-04-01`, `${y}-06-30`];
    case 'tri3': return [`${y}-07-01`, `${y}-09-30`];
    case 'tri4': return [`${y}-10-01`, `${y}-12-31`];
    case 'sem1': return [`${y}-01-01`, `${y}-06-30`];
    case 'sem2': return [`${y}-07-01`, `${y}-12-31`];
    case 'this_year': return [`${y}-01-01`, `${y}-12-31`];
  }
  return null;
}

export async function pageOO(ctx, root) {
  _root = root;
  // 🙋 v86.3: corretor (lvl<5) abre DIRETO o 1:1 dele — sem lista, sem dados de
  // outros; o backend corta os campos sensíveis (ads/CPL/custos).
  if ((auth.user()?.lvl || 0) < 5) {
    const meId = auth.user()?.id;
    if (!meId) { root.innerHTML = '<div class="alert alert-warn">Sessão inválida — faça login de novo.</div>'; return; }
    _selId = meId; _view = 'detail';
    await loadDetail();
    return;
  }
  // deep-link vindo do Organograma
  const pre = sessionStorage.getItem('oo.open');
  if (pre) { sessionStorage.removeItem('oo.open'); _selId = pre; _view = 'detail'; }
  if (_view === 'detail' && _selId) await loadDetail();
  else await loadList();
}

const isSelfView = () => (auth.user()?.lvl || 0) < 5;

/* ───────────────────────── LISTA ───────────────────────── */
async function loadList() {
  _view = 'list';
  _root.innerHTML = spinner('Carregando corretores…');
  try {
    _ov = await api.request('/api/v3/oo/overview?' + ooQP());
    renderList();
  } catch (e) { _root.innerHTML = err(e.message); }
}

function renderList() {
  const cs = _ov?.corretores || [];
  const isManager = (c) => ['lider', 'gerente'].includes((c.role || '').toLowerCase());
  const gestores = cs.filter(isManager);          // gerente/líder: visão de EQUIPE
  const corretores = cs.filter(c => !isManager(c)); // individual
  const totalVendas = corretores.reduce((a, c) => a + (c.vendas || 0), 0);
  const totalVgv = corretores.reduce((a, c) => a + (c.vgv || 0), 0);
  const atencao = corretores.filter(c => c.health_color === 'vermelho').length;
  const grid = (arr) => `<div class="mt-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">${arr.map(brokerCard).join('')}</div>`;
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <h2 class="card-title">👥 One-on-One · Gestão</h2>
          <p class="card-sub">${corretores.length} corretores · ${gestores.length} gestor(es) · ${totalVendas} vendas · R$ ${money(totalVgv)} VGV no período · <b style="color:#dc2626">${atencao}</b> em atenção 🔴</p>
        </div>
        ${periodSel()}
      </div>
      ${gestores.length ? `<div style="font-size:12px;font-weight:800;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:14px">🛡 Gestores · visão de equipe</div>${grid(gestores)}` : ''}
      <div style="font-size:12px;font-weight:800;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:16px">🏠 Corretores · individual</div>
      ${corretores.length ? grid(corretores) : '<div class="muted text-center" style="padding:30px">Sem corretores com dados no período.</div>'}
    </div>`;
  wirePeriod(loadList);
  _root.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => { _selId = el.dataset.open; loadDetail(); }));
}

function brokerCard(c) {
  const dot = healthDot(c.health_color);
  const att = c.meta_attainment_pct;
  const attBar = att != null ? bar(Math.min(100, att), c.health_color) : '';
  const alerts = (c.alertas_top || []).map(a => `<span style="display:inline-block;background:#fef2f2;color:#b91c1c;font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;margin:2px 2px 0 0">⚠ ${escapeHtml(a)}</span>`).join('');
  return `
    <div data-open="${escapeHtml(c.id)}" style="cursor:pointer;background:var(--bg-2);border:1px solid var(--border);border-left:4px solid ${healthHex(c.health_color)};border-radius:var(--r-md);padding:12px;transition:.15s" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
      <div class="flex items-center gap-2" style="margin-bottom:8px">
        <div style="width:40px;height:40px;border-radius:50%;background:${c.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">${escapeHtml((c.ini || (c.name||'?').slice(0,2)).toUpperCase())}</div>
        <div style="min-width:0;flex:1">
          <div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name || c.id)}${c.is_team ? ` <span class="tiny" style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:999px;font-weight:700">👥 equipe</span>` : ''}</div>
          <div class="tiny muted">${escapeHtml(c.team || '—')} · ${(() => { const r = (c.role || '').toLowerCase(); if (r === 'lider' || r === 'gerente') { const lbl = r === 'gerente' ? 'Gerente' : 'Líder'; return c.is_team ? `🛡 ${lbl} · agregado da equipe` : `🛡 ${lbl}`; } return '🏠 Corretor'; })()}</div>
        </div>
        <div style="text-align:center">${dot}<div style="font-size:10px;font-weight:700;color:${healthHex(c.health_color)}">${c.health}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;margin-bottom:8px">
        ${miniKpi('Vendas', c.vendas)} ${miniKpi('Visitas', c.visitas)} ${miniKpi('VGV', 'R$ ' + moneyShort(c.vgv))}
      </div>
      ${att != null ? `<div class="tiny muted" style="margin-bottom:2px">Meta VGV: <b>${pctF(att)}</b></div>${attBar}` : '<div class="tiny muted">Sem meta no período</div>'}
      ${alerts ? `<div style="margin-top:6px">${alerts}</div>` : ''}
      ${c.proxima_oo ? `<div class="tiny muted" style="margin-top:6px">📅 Próxima 1:1: ${fmtD(c.proxima_oo)}</div>` : (c.last_oo ? `<div class="tiny muted" style="margin-top:6px">Última 1:1: ${fmtD(c.last_oo)}</div>` : '<div class="tiny" style="color:#d97706;margin-top:6px">Sem 1:1 registrada</div>')}
    </div>`;
}

/* ───────────────────────── DETALHE ───────────────────────── */
async function loadDetail() {
  _view = 'detail';
  if (_sim && _sim.corretor && _sim.corretor.id !== _selId) { _sim = null; _simCen = null; _simRes = null; _dtab = 'cockpit'; }
  _root.innerHTML = spinner('Carregando cockpit do corretor…');
  try {
    const [d, m, u, n] = await Promise.all([
      api.request('/api/v3/oo/corretor?corretor_id=' + encodeURIComponent(_selId) + '&' + ooQP()),
      api.request('/api/v3/oo/list?corretor_id=' + encodeURIComponent(_selId)).catch(() => ({ items: [] })),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
      api.request('/api/v3/oo/norte?corretor_id=' + encodeURIComponent(_selId) + '&' + ooQP()).catch(() => null),
    ]);
    _det = d; _meet = m.items || []; if (u.users) _users = u.users; _norte = n;
    _scope = (d.team && d.team.metrics) ? 'equipe' : 'individual';  // líder abre na visão de equipe
    renderDetail();
  } catch (e) { _root.innerHTML = err(e.message); }
}

function renderDetail() {
  const d = _det, c = d.corretor;
  // Líder/Gerente = cockpit de GESTÃO da equipe (não é avaliado como corretor).
  if (['lider', 'gerente'].includes((c.role || '').toLowerCase()) && d.team && d.team.metrics) { renderGestor(d, c); return; }
  // 🧪 Aba Simulador (sócio-only) — motor de meta individual (v86.1)
  if (_dtab === 'simulador' && (auth.user()?.lvl || 0) >= 10) {
    _root.innerHTML = `
      <div class="card">
        <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
          <button class="btn btn-ghost" id="oo-back">← Corretores</button>
          <span class="tiny muted">Janela fixa de calibração: últimos 90 dias (RD CRM)</span>
          <button class="btn btn-primary" id="oo-new" style="margin-left:auto">+ Reunião 1:1</button>
        </div>
        ${detailHeader(d, c)}
        ${ooTabBar()}
        <div id="oo-sim" class="mt-3">${_sim ? '' : spinner('Calibrando com o RD (últimos 90 dias)…')}</div>
        <div id="modal-oo" style="display:none"></div>
      </div>`;
    wireTabsCommon();
    if (_sim) renderSim(); else loadSim();
    return;
  }
  // Corretor = cockpit individual. selfView = o PRÓPRIO corretor olhando (v86.3):
  // sem lista/reunião/RH360, e os painéis de custo (ads/CPL/custo fixo) nem chegam
  // do backend — só gestor/diretor/sócio veem dado sensível.
  const selfView = isSelfView();
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
        ${selfView ? `<h2 class="card-title" style="margin:0">📊 Meu One-on-One</h2>` : '<button class="btn btn-ghost" id="oo-back">← Corretores</button>'}
        ${periodSel()}
        ${selfView ? '' : '<button class="btn btn-primary" id="oo-new" style="margin-left:auto">+ Reunião 1:1</button>'}
      </div>
      ${detailHeader(d, c)}
      ${ooTabBar()}
      <div style="margin-top:14px">${nortePanel(d)}</div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:14px;align-items:start">
        <div>${funnelPanel(d)}</div>
        <div>${kpiVsMeta(d)}</div>
      </div>
      <div style="margin-top:14px">${efficiencyPanel(d)}</div>
      ${d.ads_invest ? `<div style="margin-top:14px">${adsInvestPanel(d, 'corretor')}</div>` : ''}
      ${d.custo_total != null ? `<div style="margin-top:14px">${custoTotalPanel(d, 'corretor')}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;align-items:start">
        ${reverseFunnelPanel(d)}
        ${projecaoPanel(d)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:14px">
        ${ratesPanel(d)}
        ${originPanel(d)}
        ${lossPanel(d)}
      </div>
      <div id="oo-ranking" class="mt-3"></div>
      ${trendPanel(d, escapeHtml(c.name))}
      ${selfView ? '' : meetingsPanel()}
      ${selfView ? '' : '<div id="oo-rh360" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Cruzando dados de RH…</div></div>'}
      <div id="modal-oo" style="display:none"></div>
    </div>`;
  wireDetailCommon();
}

/* ───────────────────── COCKPIT DO GESTOR (líder) ───────────────────── */
function renderGestor(d, c) {
  const t = d.team, M = t.metrics;
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
        <button class="btn btn-ghost" id="oo-back">← Corretores</button>
        ${periodSel()}
        <button class="btn btn-primary" id="oo-new" style="margin-left:auto">+ Reunião 1:1</button>
      </div>
      ${gestorHeader(d)}
      ${gestorAlerts(M)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;align-items:start">
        ${projecaoPanel({ projecao: M.projecao })}
        ${reverseFunnelPanel({ funil_reverso: M.funil_reverso })}
      </div>
      <div style="margin-top:14px">${pipelinePanel(M)}</div>
      <div style="margin-top:14px">${adsInvestPanel({ ads_invest: M.ads_invest }, 'equipe')}</div>
      <div style="margin-top:14px">${custoTotalPanel({ ads_invest: M.ads_invest, custo_fixo: M.custo_fixo, custo_total: M.custo_total }, 'equipe')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;align-items:start">
        ${saudeEquipePanel(t)}
        ${kpiVsMeta(M)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;align-items:start">
        ${gargaloPanel(M)}
        ${focoSemanaPanel(t)}
      </div>
      <div style="margin-top:14px">${matrizConversaoPanel(t)}</div>
      <div style="margin-top:14px">${tendenciaPanel(t)}</div>
      ${rankingPanel(t)}
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:14px;align-items:start">
        <div>${funnelPanel(M)}</div>
        <div>${ooCoveragePanel(t)}</div>
      </div>
      ${trendPanel(M, 'Equipe ' + escapeHtml(t.name))}
      ${meetingsPanel('🗓 Minhas reuniões 1:1 (com a diretoria)')}
      <div id="modal-oo" style="display:none"></div>
    </div>`;
  wireDetailCommon();
}

/* 🧪 Abas do 1:1 individual (Cockpit | Simulador) — Simulador é sócio-only */
function ooTabBar() {
  if ((auth.user()?.lvl || 0) < 10) return '';
  const tb = (id, lbl) => `<button class="btn ${_dtab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-dtab="${id}">${lbl}</button>`;
  const sombra = _sim && _sim.shadow ? '<span class="tiny" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;padding:2px 8px;border-radius:999px;font-weight:700">🌒 modo sombra — só sócios veem</span>' : '';
  return `<div class="flex items-center gap-2" style="margin-top:12px;flex-wrap:wrap">${tb('cockpit', '📊 Cockpit')}${tb('simulador', '🧪 Simulador')}${sombra}</div>`;
}

function wireTabsCommon() {
  document.getElementById('oo-back')?.addEventListener('click', () => loadList());
  document.getElementById('oo-new')?.addEventListener('click', () => openMeeting());
  _root.querySelectorAll('[data-dtab]').forEach(el => el.addEventListener('click', () => {
    if (_dtab === el.dataset.dtab) return;
    _dtab = el.dataset.dtab;
    renderDetail();
  }));
}

function wireDetailCommon() {
  wireTabsCommon();
  document.getElementById('norte-edit')?.addEventListener('click', openNorte);
  document.getElementById('norte-log')?.addEventListener('click', () => {
    const b = document.getElementById('norte-log-box');
    if (b) b.style.display = b.style.display === 'none' ? '' : 'none';
  });
  wirePeriod(loadDetail);
  loadDefasagem();   // ⏳ MAP: venda de hoje ↔ atividade de N meses atrás (v86.1)
  loadOORanking();   // 🏅 ranking geral + da equipe do corretor (v86.3)
  _root.querySelectorAll('[data-member]').forEach(el => el.addEventListener('click', () => { _selId = el.dataset.member; loadDetail(); }));
  _root.querySelectorAll('[data-meet]').forEach(el => el.addEventListener('click', () => openMeeting(parseInt(el.dataset.meet))));
  _root.querySelectorAll('[data-pdi]').forEach(el => el.addEventListener('change', () => togglePdi(parseInt(el.dataset.pdi), parseInt(el.dataset.idx), el.checked)));
  if (_det && _det.corretor && !isSelfView()) loadRH360(_det.corretor);   // visão 360° RH — gestão (v81.96)
}

/* 🏅 Ranking no 1:1 do corretor (v86.3): GERAL + o da EQUIPE dele, com a posição
   destacada. Mesmas fontes da página Ranking (VGV do ano via RD + papéis/equipes);
   sócio/diretor/gerente e hide_from_ranking ficam de fora, como lá. */
async function loadOORanking() {
  const host = document.getElementById('oo-ranking');
  if (!host || !_det?.corretor) return;
  host.innerHTML = `<div class="tiny muted"><span class="spinner"></span> Carregando ranking…</div>`;
  const ano = new Date().getFullYear();
  try {
    const [act, atin] = await Promise.all([
      api.request('/api/v3/metrics/activity_ranking?days=30&limit=50'),
      api.request('/api/v3/metas/atingimento?ano=' + ano).catch(() => null),
    ]);
    const byUser = {};
    (act.ranking || []).forEach(u => { byUser[u.id] = { ...u, vgv: 0, vendas: 0 }; });
    ((atin || {}).grid || []).forEach(g => {
      const u = byUser[g.user?.id];
      if (u) { u.vgv = g.totals?.atingido_vgv || 0; u.vendas = g.totals?.vendas_count || 0; }
    });
    // mesma régua da página Ranking: gestão não compete
    const comp = Object.values(byUser).filter(u => !['socio', 'diretor', 'gerente'].includes((u.role || '').toLowerCase()));
    const geral = comp.slice().sort((a, b) => (b.vgv - a.vgv) || ((b.vendas || 0) - (a.vendas || 0)) || ((b.score || 0) - (a.score || 0)));
    const tkey = (_det.corretor.team || '').trim().toLowerCase();
    const equipe = geral.filter(u => (u.team || '').trim().toLowerCase() === tkey);
    if (!geral.length) { host.innerHTML = ''; return; }

    const linha = (u, pos) => {
      const eu = u.id === _selId;
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:8px;${eu ? 'background:#eff6ff;border:1px solid #bfdbfe;font-weight:800' : ''}">
        <span style="min-width:26px;font-weight:800;color:${pos <= 3 ? '#d97706' : 'var(--ink-muted)'}">${pos <= 3 ? ['🥇', '🥈', '🥉'][pos - 1] : pos + 'º'}</span>
        <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px">${escapeHtml(u.name || '?')}${eu ? ' (ele)' : ''}</span>
        <span style="font-size:11.5px;white-space:nowrap"><b>R$ ${moneyShort(u.vgv || 0)}</b> · ${u.vendas || 0}v</span>
      </div>`;
    };
    const lista = (arr) => {
      const idx = arr.findIndex(u => u.id === _selId);
      const top = arr.slice(0, 8).map((u, i) => linha(u, i + 1)).join('');
      const fora = idx >= 8 ? `<div class="tiny muted" style="text-align:center;padding:2px">⋯</div>${linha(arr[idx], idx + 1)}` : '';
      const rodape = idx >= 0 ? `<div class="tiny muted" style="margin-top:4px">Posição: <b>${idx + 1}º</b> de ${arr.length}</div>` : '';
      return `<div style="display:grid;gap:3px">${top}${fora}</div>${rodape}`;
    };
    host.innerHTML = panel(`🏅 Ranking VGV ${ano} — geral × equipe`, `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        <div><div style="font-weight:800;font-size:12px;margin-bottom:5px">🌎 Geral (${geral.length} corretores)</div>${lista(geral)}</div>
        <div><div style="font-weight:800;font-size:12px;margin-bottom:5px">🛡 Equipe ${escapeHtml(_det.corretor.team || '—')} (${equipe.length})</div>${equipe.length ? lista(equipe) : '<div class="tiny muted">Sem outros corretores na equipe.</div>'}</div>
      </div>
      <div class="tiny muted" style="margin-top:6px">VGV e vendas do ano via RD CRM (mesma fonte da página Ranking); gestão e ocultos não competem.</div>`);
  } catch { host.innerHTML = ''; }
}

function gestorHeader(d) {
  const t = d.team, M = t.metrics, hc = M.health_color, att = M.meta_attainment_pct, c = d.corretor;
  return `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:5px solid ${healthHex(hc)}">
      <div style="width:54px;height:54px;border-radius:50%;background:${c.color || '#2563eb'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;flex-shrink:0">${escapeHtml((c.ini || (c.name||'?').slice(0,2)).toUpperCase())}</div>
      <div style="flex:1;min-width:180px">
        <div style="font-weight:800;font-size:18px">${escapeHtml(c.name)} <span style="font-size:12px;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-weight:700">🛡 Gestor</span></div>
        <div class="tiny muted">Equipe ${escapeHtml(t.name)} · ${t.members.length} corretores · período ${fmtD(d.period.since)}–${fmtD(d.period.until)}</div>
      </div>
      <div style="text-align:center;padding:0 10px"><div style="font-size:34px;line-height:1">${healthEmoji(hc)}</div><div style="font-size:11px;font-weight:800;color:${healthHex(hc)}">SAÚDE EQUIPE ${M.health}/100</div></div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900;color:${healthHex(hc)}">${pctF(att)}</div><div class="tiny muted">meta VGV equipe</div></div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900">${M.kpis.vendas}</div><div class="tiny muted">vendas · R$ ${moneyShort(M.kpis.vgv)}</div></div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900;color:#16a34a">R$ ${moneyShort(M.ano_vgv || 0)}</div><div class="tiny muted">VGV ${new Date().getFullYear()} (ano)</div></div>
    </div>`;
}

function gestorAlerts(M) {
  const a = M.alertas || [];
  if (!a.length) return '<div style="margin-top:10px;font-size:12px;color:#16a34a">✅ Equipe sem alertas críticos no período.</div>';
  return `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${a.map(x => `<span style="background:${x.level==='alto'?'#fef2f2':'#fffbeb'};color:${x.level==='alto'?'#b91c1c':'#b45309'};border:1px solid ${x.level==='alto'?'#fecaca':'#fde68a'};font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:999px">${x.level==='alto'?'🚨':'⚠️'} ${escapeHtml(x.txt)}</span>`).join('')}</div>`;
}

function saudeEquipePanel(t) {
  const ms = t.members || [];
  const g = ms.filter(m => m.health_color === 'verde').length;
  const y = ms.filter(m => m.health_color === 'amarelo').length;
  const r = ms.filter(m => m.health_color === 'vermelho').length;
  const batendo = ms.filter(m => (m.meta_attainment_pct || 0) >= 100).length;
  const semVenda = ms.filter(m => !m.vendas).length;
  return panel('🩺 Saúde da equipe', `
    <div style="display:flex;gap:14px;justify-content:space-around;margin-bottom:10px">
      <div style="text-align:center"><div style="font-size:24px;font-weight:900;color:#16a34a">${g}</div><div class="tiny muted">🟢 saudável</div></div>
      <div style="text-align:center"><div style="font-size:24px;font-weight:900;color:#d97706">${y}</div><div class="tiny muted">🟡 atenção</div></div>
      <div style="text-align:center"><div style="font-size:24px;font-weight:900;color:#dc2626">${r}</div><div class="tiny muted">🔴 crítico</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;text-align:center">
      ${miniKpi('Batendo meta', batendo + '/' + ms.length)}
      ${miniKpi('Sem venda', semVenda + '/' + ms.length)}
    </div>`);
}

function rankingPanel(t) {
  return `<div style="margin-top:14px">${teamMembersPanel(t)}</div>`;
}

function ooCoveragePanel(t) {
  const ms = t.members || [];
  const now = Date.now(), D30 = 30 * 864e5;
  const hasRecent = m => m.last_oo && (now - new Date(m.last_oo + 'T12:00:00').getTime()) <= D30;
  const recent = ms.filter(hasRecent);
  const overdue = ms.filter(m => !hasRecent(m));
  return panel('🗓 Cobertura de 1:1 (últimos 30 dias)', `
    <div style="display:flex;gap:14px;text-align:center;margin-bottom:8px">
      ${miniKpi('Com 1:1 recente', recent.length + '/' + ms.length)}
      ${miniKpi('Pendentes', overdue.length)}
    </div>
    ${overdue.length ? `<div class="tiny muted" style="margin-bottom:4px">Sem 1:1 nos últimos 30d — priorize (clique pra abrir):</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${overdue.map(m => `<span data-member="${escapeHtml(m.id)}" style="cursor:pointer;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px">${escapeHtml(m.name)} →</span>`).join('')}</div>`
      : '<div style="font-size:12px;color:#16a34a">✅ Todos os corretores tiveram 1:1 recente.</div>'}`);
}

function teamHeader(d) {
  const t = d.team, M = t.metrics, hc = M.health_color, att = M.meta_attainment_pct;
  return `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:5px solid ${healthHex(hc)}">
      <div style="width:54px;height:54px;border-radius:14px;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;flex-shrink:0">🛡</div>
      <div style="flex:1;min-width:180px">
        <div style="font-weight:800;font-size:18px">Equipe ${escapeHtml(t.name)}</div>
        <div class="tiny muted">${t.members.length} pessoas · líder ${escapeHtml(d.corretor.name)} · período ${fmtD(d.period.since)}–${fmtD(d.period.until)}</div>
      </div>
      <div style="text-align:center;padding:0 10px"><div style="font-size:34px;line-height:1">${healthEmoji(hc)}</div><div style="font-size:11px;font-weight:800;color:${healthHex(hc)}">SAÚDE ${M.health}/100</div></div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900;color:${healthHex(hc)}">${pctF(att)}</div><div class="tiny muted">meta VGV equipe</div></div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900">${M.kpis.vendas}</div><div class="tiny muted">vendas · R$ ${moneyShort(M.kpis.vgv)}</div></div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900">R$ ${moneyShort(M.ano_vgv || 0)}</div><div class="tiny muted">VGV ${new Date().getFullYear()} (ano)</div></div>
    </div>
    ${(M.alertas || []).length ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${M.alertas.map(a => `<span style="background:${a.level==='alto'?'#fef2f2':'#fffbeb'};color:${a.level==='alto'?'#b91c1c':'#b45309'};border:1px solid ${a.level==='alto'?'#fecaca':'#fde68a'};font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:999px">${a.level==='alto'?'🚨':'⚠️'} ${escapeHtml(a.txt)}</span>`).join('')}</div>` : ''}`;
}

function teamMembersPanel(t) {
  const ms = t.members || [];
  const now = Date.now(), D30 = 30 * 864e5;
  const ooCell = (m) => {
    const recent = m.last_oo && (now - new Date(m.last_oo + 'T12:00:00').getTime()) <= D30;
    if (m.proxima_oo) return `<span class="tiny" style="color:#2563eb">📅 ${fmtD(m.proxima_oo)}</span>`;
    if (recent) return `<span class="tiny muted">${fmtD(m.last_oo)}</span>`;
    return '<span class="tiny" style="color:#dc2626;font-weight:700">sem 1:1</span>';
  };
  return `${panel('🏅 Ranking de corretores (clique pra abrir o 1:1)', `
    <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:640px">
      <thead><tr style="color:var(--ink-muted);font-size:11px;text-align:left;border-bottom:1px solid var(--border)">
        <th style="padding:5px 6px">#</th><th>Corretor</th><th style="text-align:center">Saúde</th><th style="text-align:right">Vendas</th><th style="text-align:right">VGV</th><th style="text-align:right">Visitas</th><th style="text-align:right">Win%</th><th style="text-align:right">Meta</th><th style="text-align:center">⚠</th><th style="text-align:right">1:1</th></tr></thead>
      <tbody>
      ${ms.map((m, i) => `<tr data-member="${escapeHtml(m.id)}" style="border-bottom:1px solid var(--border);cursor:pointer" onmouseover="this.style.background='var(--bg-3)'" onmouseout="this.style.background='transparent'">
        <td style="padding:6px;color:var(--ink-muted)">${i + 1}</td>
        <td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:22px;height:22px;border-radius:50%;background:${m.color||'#64748b'};color:#fff;font-size:9px;font-weight:800;display:inline-flex;align-items:center;justify-content:center">${escapeHtml((m.ini||(m.name||'?').slice(0,2)).toUpperCase())}</span> ${escapeHtml(m.name)}</span></td>
        <td style="text-align:center">${healthEmoji(m.health_color)} ${m.health}</td>
        <td style="text-align:right;font-weight:700">${m.vendas}</td>
        <td style="text-align:right">R$ ${moneyShort(m.vgv)}</td>
        <td style="text-align:right">${m.visitas}</td>
        <td style="text-align:right">${pctF(m.win_rate)}</td>
        <td style="text-align:right">${pctF(m.meta_attainment_pct)}</td>
        <td style="text-align:center">${m.alertas_count ? '<span style="color:#dc2626;font-weight:700">' + m.alertas_count + '</span>' : '✓'}</td>
        <td style="text-align:right">${ooCell(m)}</td>
      </tr>`).join('')}
      </tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">Ordenado por quem precisa de atenção (mais alertas / menor saúde). Clique numa linha pra abrir o cockpit e registrar a 1:1.</div>`)}`;
}

function detailHeader(d, c) {
  const hc = d.health_color, att = d.meta_attainment_pct;
  return `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:5px solid ${healthHex(hc)}">
      <div style="width:54px;height:54px;border-radius:50%;background:${c.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;flex-shrink:0">${escapeHtml((c.ini || (c.name||'?').slice(0,2)).toUpperCase())}</div>
      <div style="flex:1;min-width:180px">
        <div style="font-weight:800;font-size:18px">${escapeHtml(c.name || c.id)}</div>
        <div class="tiny muted">${escapeHtml(c.team || '—')} · ${(c.role || '').toLowerCase() === 'gerente' ? '🛡 Gerente' : ((c.role || '').toLowerCase() === 'lider' ? '🛡 Líder' : '🏠 Corretor')} · período ${fmtD(d.period.since)}–${fmtD(d.period.until)}</div>
      </div>
      <div style="text-align:center;padding:0 10px">
        <div style="font-size:34px;line-height:1">${healthEmoji(hc)}</div>
        <div style="font-size:11px;font-weight:800;color:${healthHex(hc)}">SAÚDE ${d.health}/100</div>
      </div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)">
        <div style="font-size:24px;font-weight:900;color:${healthHex(hc)}">${pctF(att)}</div>
        <div class="tiny muted">atingimento meta VGV</div>
      </div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)">
        <div style="font-size:24px;font-weight:900">${d.kpis.vendas}</div>
        <div class="tiny muted">vendas · R$ ${moneyShort(d.kpis.vgv)}</div>
      </div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)">
        <div style="font-size:24px;font-weight:900;color:#16a34a">R$ ${moneyShort(d.ano_vgv || 0)}</div>
        <div class="tiny muted">VGV ${new Date().getFullYear()} (ano)</div>
      </div>
    </div>
    ${(d.alertas || []).length ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${d.alertas.map(a => `<span style="background:${a.level==='alto'?'#fef2f2':'#fffbeb'};color:${a.level==='alto'?'#b91c1c':'#b45309'};border:1px solid ${a.level==='alto'?'#fecaca':'#fde68a'};font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:999px">${a.level==='alto'?'🚨':'⚠️'} ${escapeHtml(a.txt)}</span>`).join('')}</div>` : '<div style="margin-top:10px;font-size:12px;color:#16a34a">✅ Sem alertas no período.</div>'}`;
}

function funnelBars(stages, getLabel) {
  const max = Math.max(1, ...stages.map(s => s.n));
  const grad = (i, n) => { const t = n ? i / Math.max(1, n - 1) : 0; const h = Math.round(210 - t * 70); return `hsl(${h},75%,55%)`; };
  const convChip = (c) => c == null ? '' :
    `<span title="conversão da etapa anterior" style="font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:999px;background:${c>=50?'rgba(22,163,74,.15)':c>=25?'rgba(217,119,6,.15)':'rgba(220,38,38,.15)'};color:${c>=50?'#16a34a':c>=25?'#d97706':'#dc2626'}">↓ ${pctF(c)}</span>`;
  return `<div style="display:grid;gap:7px">${stages.map((s, i) => `
    <div>
      ${i > 0 && s.conv_from_prev != null ? `<div style="text-align:center;margin:-2px 0 1px">${convChip(s.conv_from_prev)}</div>` : ''}
      <div class="flex items-center" style="justify-content:space-between;font-size:11.5px;margin-bottom:2px">
        <span style="font-weight:600">${getLabel(s)}</span>
        <b>${s.n}</b>
      </div>
      <div style="height:16px;background:var(--bg-3);border-radius:6px;overflow:hidden"><div style="height:100%;width:${s.n ? Math.max(3, s.n / max * 100) : 0}%;background:${grad(i, stages.length)};border-radius:6px"></div></div>
    </div>`).join('')}</div>`;
}

// Tabela explícita de conversão por etapa (taxa entre etapas do funil RD)
function convTable(stages) {
  const rows = stages.map((s, i) => i === 0 ? '' : `<tr style="border-top:1px solid var(--border)">
    <td style="padding:4px 6px;color:var(--ink-muted)">${escapeHtml(stages[i-1].name || stages[i-1].label)} → <b>${escapeHtml(s.name || s.label)}</b></td>
    <td style="text-align:right;padding:4px 6px;font-weight:800;color:${(s.conv_from_prev||0)>=50?'#16a34a':(s.conv_from_prev||0)>=25?'#d97706':'#dc2626'}">${pctF(s.conv_from_prev)}</td>
  </tr>`).filter(Boolean).join('');
  const first = stages[0]?.n || 0, last = stages[stages.length-1]?.n || 0;
  const overall = first ? round1(last / first * 100) : null;
  return `<table style="width:100%;font-size:11.5px;border-collapse:collapse;margin-top:8px">
    <thead><tr style="color:var(--ink-muted);font-size:10.5px"><th style="text-align:left;padding:4px 6px">Conversão por etapa</th><th style="text-align:right;padding:4px 6px">taxa</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border)"><td style="padding:5px 6px;font-weight:700">${escapeHtml(stages[0]?.name||stages[0]?.label||'')} → ${escapeHtml(stages[stages.length-1]?.name||'')}</td><td style="text-align:right;padding:5px 6px;font-weight:900;color:#2563eb">${pctF(overall)}</td></tr></tfoot>
  </table>`;
}
function round1(n) { return Math.round(n * 10) / 10; }

function funnelPanel(d) {
  const rd = d.rd_funnels || [];
  if (rd.length) {
    // Funil REAL do RD por etapa, do funil em que o corretor/equipe participa
    return rd.map(fn => panel(`🫧 Funil RD · ${escapeHtml(fn.pipeline)} <span class="tiny muted" style="font-weight:400">(${fn.deals} negócios)</span>`,
      funnelBars(fn.stages, s => escapeHtml(s.name)) +
      convTable(fn.stages) +
      `<div class="tiny muted" style="margin-top:6px">Etapas reais do RD · ↓ = taxa de conversão da etapa anterior · win rate geral: <b>${pctF(d.win_rate)}</b></div>`
    )).join('<div style="height:12px"></div>');
  }
  // fallback: marcos canônicos
  const f = d.funnel || [];
  return panel('🫧 Funil individual', funnelBars(f, s => escapeHtml(s.label)) + convTable(f) +
    `<div class="tiny muted" style="margin-top:6px">↓ = taxa de conversão da etapa anterior. Win rate: <b>${pctF(d.win_rate)}</b></div>`);
}

function kpiVsMeta(d) {
  const m = d.meta;
  // realNum = valor numérico (pro %); disp = texto exibido
  const row = (lbl, realNum, meta, disp) => {
    const pct = meta > 0 ? Math.round(realNum / meta * 100) : null;
    const col = pct == null ? '#64748b' : (pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626');
    return `<div style="margin-bottom:7px">
      <div class="flex items-center" style="justify-content:space-between;font-size:12px"><span>${lbl}</span><span><b>${disp != null ? disp : realNum}</b>${meta>0?` / ${meta}`:''} ${pct!=null?`<span style="color:${col};font-size:11px;font-weight:700">${pctF(pct)}</span>`:''}</span></div>
      ${meta>0?`<div style="height:6px;background:var(--bg-3);border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${Math.min(100,Math.max(0,pct))}%;background:${col}"></div></div>`:''}
    </div>`;
  };
  return panel('🎯 Meta × Realizado', `
    ${row('💰 VGV', m.real_vgv, m.meta_vgv, 'R$ ' + moneyShort(m.real_vgv))}
    ${row('🤝 Vendas', m.real_vendas, m.meta_vendas)}
    ${row('👀 Visitas', m.real_visitas, m.meta_visitas)}
    ${row('📅 Agendamentos', m.real_agendamentos, m.meta_agendamentos)}
    ${row('📝 Propostas', m.real_propostas, m.meta_propostas)}
    ${row('📂 Pastas', m.real_pastas, m.meta_pastas)}
    ${(!m.meta_vgv && !m.meta_visitas) ? '<div class="tiny" style="color:#d97706;margin-top:4px">Defina metas em Menu → Metas pra ver o atingimento.</div>' : ''}`);
}

/* 💸 Investimento em ads — atribuição EXATA por lead (CPL da campanha de cada lead) */
function adsInvestPanel(d, scope) {
  const a = d.ads_invest;
  if (!a) return '';
  const who = scope === 'equipe' ? 'da equipe' : 'do corretor';
  const presetLbl = { last_30d: 'últimos 30d', this_month: 'mês atual', last_month: 'mês passado', last_14d: 'últimos 14d', last_7d: 'últimos 7d', yesterday: 'ontem' }[a.preset_cpl] || a.preset_cpl || '';
  if (a.invest == null || a.cpl_global == null && a.cpl_team == null) return panel('💸 Investimento em ads', '<div class="tiny muted">Sem gasto Meta no cache pra calcular. Abra o painel de Meta Ads pra popular o cache.</div>');
  const cob = a.cobertura_pct;
  const temFaixa = a.invest_low != null && a.invest_high != null && a.invest_high > a.invest_low;
  const cb = { alta: ['🟢 Alta', '#dcfce7', '#166534'], media: ['🟡 Média', '#fef3c7', '#92400e'], baixa: ['🔴 Baixa', '#fee2e2', '#b91c1c'] }[a.confianca] || ['—', '#e2e8f0', '#475569'];
  const row = (cor, lbl, n, val, sub) => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:8px;background:var(--bg-3)">
      <span style="width:9px;height:9px;border-radius:50%;background:${cor};flex:none"></span>
      <div style="flex:1;min-width:0"><b style="font-size:12.5px">${lbl}</b> <span class="tiny muted">· ${n} lead(s)${sub ? ' · ' + sub : ''}</span></div>
      <b style="font-size:13px">R$ ${moneyShort(val)}</b>
    </div>`;
  return panel('💸 Investimento em ads — exato por lead', `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div>
        <div class="tiny muted">Investido ${who} no período</div>
        <div style="font-size:24px;font-weight:900;color:#fb7185">R$ ${moneyShort(a.invest)}</div>
        ${temFaixa ? `<div class="tiny muted">faixa provável R$ ${moneyShort(a.invest_low)} – R$ ${moneyShort(a.invest_high)}</div>` : ''}
      </div>
      <div style="margin-left:auto;text-align:right">
        <div class="tiny muted">confiança ${a.confianca_pct != null ? '(' + pctF(a.confianca_pct) + ' exato)' : ''}</div>
        <span class="tiny" style="background:${cb[1]};color:${cb[2]};border-radius:999px;padding:3px 10px;font-weight:800">${cb[0]}</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px">
      ${row('#16a34a', '🎯 CPL exato da campanha', a.exato_leads || 0, a.exato_valor || 0, 'cruzado lead × campanha no Meta')}
      ${(a.conta_leads || 0) > 0 ? row('#d97706', '🛡 CPL da conta ' + escapeHtml(a.acct_label || 'da equipe'), a.conta_leads, a.conta_valor || 0, 'lead pago sem campanha no cache') : ''}
      ${(a.zero_leads || 0) > 0 ? row('#94a3b8', '🌱 Orgânico / indicação / portal', a.zero_leads, 0, 'não veio de ads Meta → R$ 0') : ''}
    </div>
    <div class="tiny muted" style="margin-top:8px">
      Cada lead recebido no período é cruzado com a campanha de origem (RD) e precificado pelo <b>CPL real daquela campanha no Meta</b> (${presetLbl}).
      ${(a.conta_leads || 0) > 0 ? `Quando a campanha não está no cache, usa o CPL da conta da equipe. ` : ''}Lead que não veio de ads não custa nada. ${cob != null && cob < 100 ? `Cobertura exata de ${pctF(cob)} — o resto é fallback honesto.` : ''}</div>`);
}

/* 💰 Quanto custa o corretor = investimento em ads (período) + custo fixo (mensal) */
function custoTotalPanel(d, scope) {
  const a = d.ads_invest;
  const ads = (a && a.invest) || 0;
  const fixo = d.custo_fixo || 0;
  const total = d.custo_total != null ? d.custo_total : (ads + fixo);
  const who = scope === 'equipe' ? 'a equipe custa' : 'o corretor custa';
  return panel('💰 Quanto ' + who, `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <div><div class="tiny muted">💸 Ads (período)</div><div style="font-size:18px;font-weight:900;color:#fb7185">R$ ${moneyShort(ads)}</div></div>
      <div style="font-size:18px;color:#94a3b8">+</div>
      <div><div class="tiny muted">🧾 Custo fixo (mensal)</div><div style="font-size:18px;font-weight:900;color:#6366f1">R$ ${moneyShort(fixo)}</div></div>
      <div style="font-size:18px;color:#94a3b8">=</div>
      <div><div class="tiny muted">Custo total</div><div style="font-size:24px;font-weight:900;color:#0f172a">R$ ${moneyShort(total)}</div></div>
    </div>
    <div class="tiny muted" style="margin-top:8px">${fixo === 0
      ? '🧾 Custo fixo ainda não cadastrado. Em <b>Diretoria → Métricas Viab</b> o sócio lança logins, e-mail e licenças por corretor.'
      : 'Custo fixo (logins, e-mail, licenças…) vem de Métricas Viab. Ads do período + fixo mensal = quanto custa de verdade.'}</div>`);
}

function efficiencyPanel(d) {
  const fc = d.primeiro_contato_h;
  const fcTxt = fc == null ? '—' : (fc < 1 ? Math.round(fc * 60) + ' min' : fc.toFixed(1) + ' h');
  return panel('⚡ Eficiência & custo', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px">
      ${stat('🎟 Ticket médio', d.ticket_medio != null ? 'R$ ' + moneyShort(d.ticket_medio) : '—', '#0ea5e9')}
      ${stat('👀 Visitas/venda', d.visitas_por_venda != null ? d.visitas_por_venda : '—', '#22d3ee', null, 'Quantas visitas até 1 venda')}
      ${stat('📞 Atend./venda', d.atend_por_venda != null ? d.atend_por_venda : '—', '#60a5fa', null, 'Atendimentos até 1 venda')}
      ${stat('📆 Dias/venda', d.dias_por_venda != null ? d.dias_por_venda + ' d' : '—', '#a78bfa', null, 'Ritmo: dias do período por venda')}
      ${stat('🎯 Qualificação', pctF(d.qualificacao_rate), '#16a34a', null, 'Leads que passaram da qualificação')}
      ${stat('🔁 Follow-up', pctF(d.followup_rate), '#f59e0b', null, 'Leads com +1 interação no RD')}
      ${stat('🕰 Estagnação', d.estagnacao_dias != null ? Math.round(d.estagnacao_dias) + ' d' : '—', '#ef4444', null, 'Mediana de dias sem atividade (abertos)')}
      ${stat('💸 Invest. ads', (d.ads_invest && d.ads_invest.invest != null) ? 'R$ ' + moneyShort(d.ads_invest.invest) : '—', '#fb7185', null, (d.ads_invest && d.ads_invest.cobertura_pct != null) ? (d.ads_invest.exato_leads + '/' + d.ads_invest.leads + ' leads com CPL exato da campanha (' + d.ads_invest.cobertura_pct + '%)') : 'Sem gasto Meta no cache')}
    </div>`);
}

function ratesPanel(d) {
  const fc = d.primeiro_contato_h;
  const fcTxt = fc == null ? '—' : (fc < 1 ? Math.round(fc * 60) + ' min' : fc.toFixed(1).replace('.', ',') + ' h');
  // base das taxas (transparência: win/descarte são sobre FECHADOS no período; lixo sobre as perdas)
  const vend = (d.kpis && d.kpis.vendas) || 0;
  const perd = d.perdas || 0;
  const fech = vend + perd;
  const trashN = perd ? Math.round((d.trash_rate || 0) / 100 * perd) : 0;
  return panel('⏱ Taxas & Tempos', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${stat('Win rate' + (fech ? ` · ${vend}/${fech} fechados` : ''), pctF(d.win_rate), '#16a34a', null, 'Vendas ÷ negócios FECHADOS (ganhos+perdidos) no período')}
      ${stat('Taxa descarte' + (fech ? ` · ${perd}/${fech} fechados` : ''), pctF(d.descarte_rate), '#dc2626', null, 'Perdas ÷ negócios fechados no período')}
      ${stat('1º contato', fcTxt, '#2563eb', d.primeiro_contato_basis === 'real' ? 'real' : 'sem evento')}
      ${stat('Ciclo médio', d.ciclo_medio_dias != null ? d.ciclo_medio_dias + ' d' : '—', '#7c3aed', null, 'Dias entre criação e fechamento das vendas ganhas (— se não houve venda no período)')}
      ${stat('Lixo/descarte' + (perd ? ` · ${trashN}/${perd} perdas` : ''), pctF(d.trash_rate), '#64748b', null, 'Das perdas, quantas foram lixo/sem perfil/duplicado')}
      ${stat('Parados +14d', d.pendencias.parados_14d, '#d97706', null, 'Negócios abertos sem atividade há +14 dias')}
    </div>`);
}

function originPanel(d) {
  const o = d.origem_ultimas_vendas || [];
  return panel('🧭 Origem das últimas vendas', o.length ? `
    <div style="display:grid;gap:5px">
      ${o.map(w => `<div class="flex items-center" style="justify-content:space-between;font-size:12px;border-bottom:1px solid var(--border);padding-bottom:4px">
        <span>${fmtD(w.data)} · <b>${escapeHtml(w.canal)}</b><span class="muted"> ${escapeHtml(w.origem !== w.canal ? w.origem : '')}</span></span>
        <span style="font-weight:700">R$ ${moneyShort(w.vgv)}</span></div>`).join('')}
    </div>` : '<div class="muted tiny">Sem vendas no período.</div>');
}

function lossPanel(d) {
  const l = d.motivos_perda || [];
  return panel('💔 Motivos de perda', l.length ? `
    <div style="display:grid;gap:4px">
      ${l.map(m => `<div class="flex items-center" style="justify-content:space-between;font-size:12px"><span>${escapeHtml(m.motivo)}</span><b>${m.n}</b></div>`).join('')}
    </div>
    <div class="tiny muted" style="margin-top:6px">${d.perdas} perda(s) no período.</div>` : '<div class="muted tiny">Sem perdas registradas.</div>');
}

function trendPanel(d, who) {
  const t = d.trend || [];
  if (!t.length) return '';
  const maxV = Math.max(1, ...t.map(x => x.vgv));
  const yr = new Date().getFullYear();
  const MES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `<div style="margin-top:14px">${panel(`📈 VGV ${yr} — ${who || ''} <span class="tiny muted" style="font-weight:400">· total R$ ${money(d.ano_vgv || 0)} · ${d.ano_vendas || 0} vendas</span>`, `
    <div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:4px">
      ${t.map(x => { const mm = parseInt(x.mes.slice(5)); return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px" title="${MES[mm]}/${yr}: ${x.vendas} venda(s) · R$ ${money(x.vgv)}">
        <div style="font-size:10px;font-weight:800;color:#16a34a">${x.vgv ? 'R$' + moneyShort(x.vgv) : ''}</div>
        <div style="width:100%;max-width:42px;height:${x.vgv ? Math.max(4, x.vgv / maxV * 78) : 2}px;background:${x.vgv ? 'linear-gradient(180deg,#34d399,#16a34a)' : 'var(--border)'};border-radius:5px 5px 0 0"></div>
        <div style="font-size:10px;color:var(--ink-muted);font-weight:600">${MES[mm]}</div>
        <div style="font-size:9px;color:var(--ink-muted)">${x.vendas ? x.vendas + 'v' : ''}</div>
      </div>`; }).join('')}
    </div>`)}</div>`;
}

/* ──────────────── Reunião 1:1 (com PDI) ──────────────── */
function meetingsPanel(title) {
  const items = _meet.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return `<div style="margin-top:14px">${panel(title || '🗓 Reuniões One-on-One', items.length ? `
    <div style="display:grid;gap:8px">
      ${items.map(meetRow).join('')}
    </div>` : '<div class="muted tiny">Nenhuma reunião registrada. Clique em “+ Reunião 1:1”.</div>')}</div>`;
}

function meetRow(i) {
  const lider = _users.find(u => u.id === i.lider_id);
  const acoes = normAcoes(i.acoes);
  const done = acoes.filter(a => a.done).length;
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 12px">
      <div class="flex items-center gap-2" style="margin-bottom:4px">
        <span style="font-weight:700;font-size:13px;cursor:pointer" data-meet="${i.id}">📅 ${fmtD(i.data)}</span>
        <span class="tiny muted">com ${escapeHtml(lider?.name || '?')}</span>
        ${acoes.length ? `<span class="tiny" style="margin-left:auto;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-weight:600">PDI ${done}/${acoes.length}</span>` : ''}
        <span class="btn btn-ghost btn-sm" data-meet="${i.id}" style="padding:2px 8px;font-size:11px;${acoes.length?'':'margin-left:auto'}">✏️</span>
      </div>
      ${i.observacoes ? `<div class="tiny" style="margin-bottom:5px;white-space:pre-wrap">${escapeHtml(i.observacoes)}</div>` : ''}
      ${acoes.length ? `<div style="display:grid;gap:3px">${acoes.map((a, idx) => `
        <label class="flex items-center gap-2" style="font-size:12px;cursor:pointer">
          <input type="checkbox" data-pdi="${i.id}" data-idx="${idx}" ${a.done ? 'checked' : ''}>
          <span style="${a.done ? 'text-decoration:line-through;color:var(--ink-muted)' : ''}">${escapeHtml(a.t)}${a.prazo ? ` <span class="muted tiny">(até ${fmtD(a.prazo)})</span>` : ''}</span>
        </label>`).join('')}</div>` : ''}
      ${i.proxima_data ? `<div class="tiny muted" style="margin-top:5px">Próxima: ${fmtD(i.proxima_data)}</div>` : ''}
    </div>`;
}

function normAcoes(acoes) {
  if (!Array.isArray(acoes)) return [];
  return acoes.map(a => typeof a === 'string' ? { t: a, done: false } : { t: a.t || a.text || '', done: !!a.done, prazo: a.prazo || null }).filter(a => a.t);
}

async function togglePdi(meetId, idx, checked) {
  const it = _meet.find(x => x.id === meetId); if (!it) return;
  const acoes = normAcoes(it.acoes); if (!acoes[idx]) return;
  acoes[idx].done = checked; it.acoes = acoes;
  try { await api.request('/api/v3/oo/upsert', { method: 'POST', body: { id: meetId, corretor_id: it.corretor_id, data: it.data, lider_id: it.lider_id, observacoes: it.observacoes, acoes, proxima_data: it.proxima_data } }); }
  catch (e) { alert('Erro ao salvar PDI: ' + e.message); }
}

function openMeeting(iid) {
  const i = iid ? _meet.find(x => x.id === iid) : null;
  const acoes = normAcoes(i?.acoes);
  const modal = document.getElementById('modal-oo');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:540px;width:100%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">${i ? '✏️ Editar' : '➕ Nova'} reunião 1:1 — ${escapeHtml(_det.corretor.name)}</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Data *</label><input id="oo-data" type="date" class="input" value="${i?.data || new Date().toISOString().slice(0,10)}"></div>
        <div class="field" style="flex:1;min-width:160px"><label>Líder/Gestor</label>
          <select id="oo-lider" class="select">${selectableUsers(_users.filter(u => ['lider','gerente','socio','diretor'].includes((u.role||'').toLowerCase())), i?.lider_id, auth.user()?.id).map(u => `<option value="${escapeHtml(u.id)}"${(i?.lider_id||auth.user()?.id)===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label>Observações / pauta da reunião</label><textarea id="oo-obs" class="input" rows="4" placeholder="Pontos altos, dificuldades, combinados...">${i?escapeHtml(i.observacoes||''):''}</textarea></div>
      <div class="field"><label>Plano de ação (uma por linha)</label><textarea id="oo-acoes" class="input" rows="3" placeholder="Ex:&#10;Fechar 2 visitas até sexta&#10;Revisar funil de Conquista">${acoes.map(a => a.t).join('\n')}</textarea></div>
      <div class="field"><label>Próxima reunião</label><input id="oo-prox" type="date" class="input" value="${i?.proxima_data || ''}"></div>
      <div id="oo-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${i ? '<button class="btn btn-danger" id="oo-del">🗑</button>' : '<span></span>'}
        <div class="flex gap-2"><button class="btn btn-ghost" id="oo-cancel">Cancelar</button><button class="btn btn-primary" id="oo-save">${i ? 'Salvar' : 'Criar'}</button></div>
      </div>
    </div>`;
  modal.style.display = 'flex';
  const close = () => modal.style.display = 'none';
  document.getElementById('oo-cancel').addEventListener('click', close);
  document.getElementById('oo-save').addEventListener('click', async () => {
    const txt = document.getElementById('oo-acoes').value.trim();
    const prev = acoes; // preserva status done dos que continuam
    const novas = txt ? txt.split('\n').map(s => s.trim()).filter(Boolean).map(t => {
      const old = prev.find(p => p.t === t); return { t, done: old ? old.done : false, prazo: old?.prazo || null };
    }) : [];
    const body = { id: i?.id, corretor_id: _selId, data: document.getElementById('oo-data').value, lider_id: document.getElementById('oo-lider').value, observacoes: document.getElementById('oo-obs').value.trim() || null, acoes: novas, proxima_data: document.getElementById('oo-prox').value || null };
    if (!body.data) { document.getElementById('oo-msg').innerHTML = err('Data obrigatória'); return; }
    try { await api.request('/api/v3/oo/upsert', { method: 'POST', body }); close(); await loadDetail(); }
    catch (e) { document.getElementById('oo-msg').innerHTML = err(e.message); }
  });
  if (i) document.getElementById('oo-del').addEventListener('click', async () => {
    if (!confirm('Apagar esta reunião?')) return;
    try { await api.request('/api/v3/oo/upsert', { method: 'POST', body: { id: i.id, _delete: true } }); close(); await loadDetail(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

/* ──────────────── helpers visuais ──────────────── */
function ooQP() {
  if (_since && _until) return 'since=' + encodeURIComponent(_since) + '&until=' + encodeURIComponent(_until);
  const r = presetRange(_preset);
  if (r) return 'since=' + r[0] + '&until=' + r[1];
  return 'date_preset=' + encodeURIComponent(_preset);
}
function periodSel() {
  const custom = !!(_since && _until);
  return `<div class="flex items-center gap-2" style="flex-wrap:wrap">
    <select id="oo-preset" class="select" style="padding:5px 10px;font-size:12px">
      ${PRESETS.map(p => `<option value="${p.id}"${(p.id === _preset && !custom) ? ' selected' : ''}>${p.lbl}</option>`).join('')}
    </select>
    <span class="tiny muted">ou</span>
    <input type="date" id="oo-since" value="${_since}" class="input" style="padding:4px 6px;font-size:12px;width:135px">
    <span class="tiny muted">até</span>
    <input type="date" id="oo-until" value="${_until}" class="input" style="padding:4px 6px;font-size:12px;width:135px">
    <button class="btn btn-primary btn-sm" id="oo-range-go">Aplicar</button>
    ${custom ? '<button class="btn btn-ghost btn-sm" id="oo-range-clear">limpar</button>' : ''}
  </div>`;
}
function wirePeriod(reloadFn) {
  document.getElementById('oo-preset')?.addEventListener('change', e => { _preset = e.target.value; _since = ''; _until = ''; reloadFn(); });
  document.getElementById('oo-range-go')?.addEventListener('click', () => {
    const s = document.getElementById('oo-since')?.value, u = document.getElementById('oo-until')?.value;
    if (s && u) { _since = s; _until = u; reloadFn(); } else alert('Informe data de início e fim.');
  });
  document.getElementById('oo-range-clear')?.addEventListener('click', () => { _since = ''; _until = ''; reloadFn(); });
}
/* 🔮 Previsão por pipeline: realista = já vendido + quase fechando; potencial = funil ponderado */
function pipelinePanel(M) {
  const p = M.pipeline;
  if (!p) return '';
  const cob = p.cobertura_pct;
  const cor = cob == null ? '#64748b' : (cob >= 100 ? '#16a34a' : cob >= 70 ? '#d97706' : '#dc2626');
  return panel('🔮 Previsão por pipeline (realista)', `
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
      <div><div class="tiny muted">Já vendido</div><div style="font-size:18px;font-weight:900;color:#16a34a">R$ ${moneyShort(p.ja_vendido)}</div></div>
      <div style="font-size:18px;color:#94a3b8">+</div>
      <div><div class="tiny muted">🔒 Quase fechando</div><div style="font-size:18px;font-weight:900;color:#2563eb">R$ ${moneyShort(p.comprometido)}</div></div>
      <div style="font-size:18px;color:#94a3b8">=</div>
      <div><div class="tiny muted">Previsto (realista)</div><div style="font-size:20px;font-weight:900;color:${cor}">R$ ${moneyShort(p.previsto_total)}</div></div>
      ${p.meta_vgv ? `<div style="margin-left:auto;text-align:right"><div class="tiny muted">da meta</div><div style="font-size:20px;font-weight:900;color:${cor}">${pctF(cob)}</div></div>` : ''}
    </div>
    ${p.meta_vgv ? bar(Math.min(100, cob || 0), cob >= 100 ? 'verde' : cob >= 70 ? 'amarelo' : 'vermelho') : ''}
    <div class="tiny muted" style="margin-top:6px">"Quase fechando" = negócios em proposta/pasta/contrato.
      ${p.meta_vgv ? (cob >= 100 ? ' ✅ Já comprometido cobre a meta.' : ` 🔴 Falta R$ ${moneyShort(p.gap)} pra cobrir a meta (precisa fechar mais do pipeline).`) : ' Defina a meta da equipe pra ver a cobertura.'}</div>
    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)" class="tiny muted">
      📊 Potencial do funil inteiro (${p.abertos} negócios abertos, ponderados por etapa): <b>R$ ${moneyShort(p.potencial_total)}</b>${p.meta_vgv ? ` (${pctF(p.potencial_pct)} da meta)` : ''} — teto otimista se TUDO avançar; não é a previsão do mês.</div>`);
}

/* 🔥 Matriz de conversão: corretor × etapa do funil (vermelho = onde cada um trava) */
function matrizConversaoPanel(t) {
  const ms = (t.members || []).filter(m => (m.conv || []).some(v => v != null));
  if (!ms.length) return panel('🔥 Conversão por corretor × etapa', '<div class="tiny muted">Sem dados de conversão por etapa no período.</div>');
  const cols = ['Lead→Cont', 'Cont→Agend', 'Agend→Visita', 'Visita→Prop', 'Prop→Pasta', 'Pasta→Venda'];
  // média por coluna (pra colorir relativo: vermelho = bem abaixo da média da equipe)
  const avg = cols.map((_, j) => { const vals = ms.map(m => m.conv[j]).filter(v => v != null); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; });
  const cell = (v, j) => {
    if (v == null) return '<td style="text-align:center;color:#cbd5e1;padding:5px 4px">—</td>';
    const a = avg[j]; let bg = '#dcfce7', cor = '#166534';
    if (a != null) { if (v < a * 0.6) { bg = '#fee2e2'; cor = '#b91c1c'; } else if (v < a) { bg = '#fef3c7'; cor = '#92400e'; } }
    return `<td style="text-align:center;padding:5px 4px"><span style="background:${bg};color:${cor};font-weight:700;border-radius:6px;padding:2px 6px;font-size:11.5px">${pctF(v)}</span></td>`;
  };
  return panel('🔥 Conversão por corretor × etapa (foco de coaching)', `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:620px">
      <thead><tr style="color:var(--ink-muted);font-size:10.5px"><th style="text-align:left;padding:4px 6px">Corretor</th>${cols.map(c => `<th style="padding:4px 4px">${c}</th>`).join('')}</tr></thead>
      <tbody>${ms.map(m => `<tr data-member="${escapeHtml(m.id)}" style="cursor:pointer;border-top:1px solid var(--border)" onmouseover="this.style.background='var(--bg-3)'" onmouseout="this.style.background='transparent'">
        <td style="padding:5px 6px;font-weight:600;white-space:nowrap">${escapeHtml((m.name || '').split(' ')[0])}</td>
        ${m.conv.map((v, j) => cell(v, j)).join('')}
      </tr>`).join('')}
      <tr style="border-top:2px solid var(--border);font-weight:800;color:#64748b"><td style="padding:5px 6px">Média</td>${avg.map(a => `<td style="text-align:center;padding:5px 4px">${pctF(a)}</td>`).join('')}</tr>
      </tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">🔴 vermelho = bem abaixo da média da equipe naquela etapa → treine isso com a pessoa. Clique no corretor pra abrir.</div>`);
}

/* 📉 Tendência por corretor: VGV mês a mês + alerta de queda */
function tendenciaPanel(t) {
  const ms = (t.members || []).filter(m => (m.trend || []).length >= 2);
  if (!ms.length) return panel('📉 Tendência por corretor', '<div class="tiny muted">Histórico mensal insuficiente pra calcular tendência ainda.</div>');
  const spark = (tr) => {
    const vals = tr.map(x => x.vgv || 0); const mx = Math.max(1, ...vals);
    return `<span style="display:inline-flex;align-items:flex-end;gap:2px;height:24px">${vals.slice(-6).map(v => `<span style="width:6px;height:${Math.max(2, Math.round(v / mx * 24))}px;background:${v ? '#2563eb' : '#e2e8f0'};border-radius:1px"></span>`).join('')}</span>`;
  };
  const rows = ms.map(m => {
    const tr = m.trend; const ult = tr[tr.length - 1].vgv || 0, pen = tr[tr.length - 2].vgv || 0;
    const queda = ult < pen, delta = pen ? (ult - pen) / pen * 100 : (ult ? 100 : 0);
    return { m, queda, delta, ult, pen, tr };
  }).sort((a, b) => a.delta - b.delta);
  return panel('📉 Tendência por corretor (VGV mês a mês)', `
    <div style="display:flex;flex-direction:column;gap:5px">
    ${rows.map(r => `<div data-member="${escapeHtml(r.m.id)}" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:5px 8px;border-radius:8px;background:${r.queda ? '#fef2f2' : 'var(--bg-3)'}">
      <b style="font-size:13px;flex:1;min-width:0">${escapeHtml((r.m.name || '').split(' ')[0])}</b>
      ${spark(r.tr)}
      <span style="font-weight:800;font-size:12px;color:${r.queda ? '#dc2626' : '#16a34a'};min-width:64px;text-align:right">${r.queda ? '🔻' : '🔺'} ${r.delta > 0 ? '+' : ''}${pctF(r.delta)}</span>
    </div>`).join('')}
    </div>
    <div class="tiny muted" style="margin-top:6px">Variação do último mês vs o anterior. 🔻 em queda = priorize na 1:1.</div>`);
}

/* 🔻 Gargalo do funil da equipe: a etapa que MENOS converte = foco de coaching */
function gargaloPanel(M) {
  const f = (M.funnel || []).filter(s => s.conv_from_prev != null);
  if (!f.length) return panel('🔻 Gargalo do funil', '<div class="tiny muted">Sem dados de conversão por etapa no período.</div>');
  let pior = f[0];
  f.forEach(s => { if ((s.conv_from_prev ?? 999) < (pior.conv_from_prev ?? 999)) pior = s; });
  const idx = (M.funnel || []).findIndex(s => s.key === pior.key);
  const ant = idx > 0 ? M.funnel[idx - 1].label : '';
  const chain = (M.funnel || []).map((s, i) => i === 0 ? `${s.label} (${s.n})`
    : `<span style="${s.key === pior.key ? 'color:#dc2626;font-weight:800' : 'color:#64748b'}">→ ${pctF(s.conv_from_prev)} → ${s.label} (${s.n})</span>`).join(' ');
  return panel('🔻 Gargalo do funil (foco de coaching)', `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:9px 12px;margin-bottom:8px">
      <div style="font-weight:800;color:#b91c1c;font-size:13px">Maior perda: ${escapeHtml(ant)} → ${escapeHtml(pior.label)} = ${pctF(pior.conv_from_prev)}</div>
      <div class="tiny" style="color:#7f1d1d;margin-top:2px">É aqui que a equipe mais perde negócio. Trabalhe ${escapeHtml(pior.label.toLowerCase())} nas 1:1.</div>
    </div>
    <div class="tiny" style="line-height:1.7">${chain}</div>`);
}

/* 🎯 Foco da semana: os 3 corretores que mais movem o ponteiro (atenção × volume) */
function focoSemanaPanel(t) {
  const ms = (t.members || []).slice();
  const score = m => (100 - (m.health || 0)) * (1 + (m.vgv || 0) / 1e6) + (m.alertas_count || 0) * 8;
  ms.sort((a, b) => score(b) - score(a));
  const top = ms.slice(0, 3);
  if (!top.length) return panel('🎯 Foco da semana', '<div class="tiny muted">Sem corretores na equipe.</div>');
  return panel('🎯 Foco da semana (prioridade do gestor)', `
    <div class="tiny muted" style="margin-bottom:6px">Quem mais precisa de você agora (saúde + volume + alertas):</div>
    <div style="display:flex;flex-direction:column;gap:6px">
    ${top.map((m, i) => {
      const motivo = !m.vendas ? 'sem vendas no período'
        : (m.meta_attainment_pct != null && m.meta_attainment_pct < 70) ? `${pctF(m.meta_attainment_pct)} da meta`
        : (m.alertas_count ? `${m.alertas_count} alerta(s)` : 'acompanhar ritmo');
      return `<div data-member="${escapeHtml(m.id)}" style="cursor:pointer;display:flex;align-items:center;gap:9px;background:var(--bg-3);border-left:4px solid ${healthHex(m.health_color)};border-radius:8px;padding:7px 10px">
        <span style="font-weight:900;color:var(--ink-muted)">${i + 1}</span>
        <span style="flex:1;min-width:0"><b style="font-size:13px">${escapeHtml(m.name)}</b> <span class="tiny muted">· ${healthEmoji(m.health_color)} ${m.health}</span><div class="tiny" style="color:#b45309">${motivo} · R$ ${moneyShort(m.vgv)} · ${m.vendas} venda(s)</div></span>
        <span class="tiny" style="color:#2563eb">abrir →</span>
      </div>`;
    }).join('')}
    </div>`);
}

/* ═══════════════ 🎯 NORTE DO MÊS · Meta × Realizado (v85.6) ═══════════════
   O modelo da planilha PSM (atendimentos × mix por canal × energia) vira o
   norte do corretor: funil com as MESMAS 7 etapas do RD, meta proporcional ao
   período selecionado, realizado direto do RD CRM (sync automático). */
function fmtN(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function nortePanel(d) {
  const n = _norte;
  if (!n || !n.ok) return panel('🎯 Norte do Mês · Meta × Realizado', '<div class="tiny muted">Meta do mês indisponível agora — recarrega a página ou tenta de novo.</div>');
  const btns = `<div class="flex gap-2" style="margin-top:10px;flex-wrap:wrap;align-items:center">
      ${isSelfView() ? '' : `<button class="btn btn-primary btn-sm" id="norte-edit">⚙️ ${n.meses_com_meta ? 'Ajustar meta' : 'Definir meta do mês'}</button>`}
      ${(n.changelog || []).length && !isSelfView() ? '<button class="btn btn-ghost btn-sm" id="norte-log">🕘 O que mudou?</button>' : ''}
      ${n.read_fail ? '<span class="tiny" style="color:#d97706">⚠ leitura parcial do banco — números podem estar incompletos</span>' : ''}
    </div>
    <div id="norte-log-box" style="display:none;margin-top:8px">${norteChangelog(n.changelog)}</div>`;
  if (!n.meses_com_meta) {
    return panel('🎯 Norte do Mês · Meta × Realizado',
      isSelfView()
        ? '<div class="tiny muted">Seu gestor ainda não definiu a meta deste período — ela aparece aqui (e no seu Norte do Dia) assim que for definida no 1:1.</div>'
        : `<div class="tiny muted">Nenhuma meta definida pro período selecionado. Defina o norte do mês — atendimentos, mix por canal (igual à planilha) e metas por etapa do funil. O quadro compara meta × realizado puxando direto do RD CRM, todos os dias, sozinho.</div>${btns}`);
  }
  const comp = n.computed || {}, pace = n.pace, fm = n.funil_meta_periodo || {}, mp = n.meta_periodo || {}, kp = d.kpis || {};
  const stages = d.funnel || [];
  const parcial = (n.fracs || []).some(f => f.frac < 1) || (n.fracs || []).length > 1;

  const strip = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;background:linear-gradient(135deg,#0f172a,#1e3a8a);border-radius:var(--r-md);padding:14px 16px;color:#fff">
      <div><div style="font-size:10.5px;opacity:.75;text-transform:uppercase;letter-spacing:.5px">Atendimentos no mês</div>
        <div style="font-size:22px;font-weight:900">${fmtN(comp.atendimentos_mes)}</div>
        ${pace ? `<div style="font-size:11px;opacity:.85">≈ ${fmtN(pace.atend_dia)}/dia</div>` : ''}</div>
      <div><div style="font-size:10.5px;opacity:.75;text-transform:uppercase;letter-spacing:.5px">Vendas previstas</div>
        <div style="font-size:22px;font-weight:900">${fmtN(comp.vendas_prev)}</div>
        <div style="font-size:11px;opacity:.85">ticket R$ ${money(comp.ticket_medio)}</div></div>
      <div><div style="font-size:10.5px;opacity:.75;text-transform:uppercase;letter-spacing:.5px">VGV previsto</div>
        <div style="font-size:22px;font-weight:900">R$ ${money(comp.vgv_prev)}</div></div>
      ${pace ? `<div><div style="font-size:10.5px;opacity:.75;text-transform:uppercase;letter-spacing:.5px">Hoje · dia ${pace.dia}/${pace.dias_mes}</div>
        <div style="font-size:14px;font-weight:800;margin-top:3px">esperado até hoje: ${fmtN(pace.atend_esperado_ate_hoje)} atend.</div>
        <div style="font-size:11px;opacity:.85">faltam ${pace.dias_restantes} dia(s) no mês</div></div>` : ''}
    </div>`;

  // 🎲 venda é ruído no mês (Poisson): dentro da faixa estatística NUNCA pinta vermelho
  const metaVenda = Number(fm.venda || 0);
  const fxVenda = metaVenda > 0 ? poisFaixaJs(metaVenda) : null;
  const rows = stages.map(s => {
    const meta = Number(fm[s.key] || 0);
    const pct = meta > 0 ? (s.n / meta * 100) : null;
    let cor = pct == null ? '#94a3b8' : pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
    let extra = '';
    if (s.key === 'venda' && fxVenda && pct != null && pct < 100 && s.n >= fxVenda.lo) {
      cor = '#2563eb';   // dentro da faixa = normal estatístico, não é alerta
      extra = `<span class="tiny" style="color:#2563eb;font-weight:700" title="faixa Poisson do período pra meta ${fmtN(metaVenda)}"> · 🎲 ${fxVenda.lo}–${fxVenda.hi} é normal</span>`;
    } else if (s.key === 'venda' && fxVenda) {
      extra = `<span class="tiny muted" title="faixa Poisson do período"> · 🎲 ${fxVenda.lo}–${fxVenda.hi} normal</span>`;
    }
    const w = meta > 0 ? Math.min(100, s.n / meta * 100) : 0;
    return `<tr>
      <td style="font-weight:600;font-size:12px;padding:5px 8px 5px 0;white-space:nowrap">${escapeHtml(s.label)}</td>
      <td style="width:100%;padding:5px 0"><div style="height:14px;background:var(--bg-3);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${w}%;background:${cor};border-radius:6px;transition:.3s"></div></div></td>
      <td style="text-align:right;padding:5px 0 5px 10px;white-space:nowrap;font-size:12.5px"><b>${fmtN(s.n)}</b> <span class="muted">/ ${meta > 0 ? fmtN(meta) : '—'}</span>${extra}</td>
      <td style="text-align:right;padding:5px 0 5px 8px;white-space:nowrap">${pct == null ? '<span class="tiny muted">definir</span>' : `<span style="font-size:11px;font-weight:800;color:${cor}">${pctF(pct)}</span>`}</td>
    </tr>`;
  }).join('');

  const resumoBar = (lbl, real, meta, isMoney, faixa) => {
    const pct = meta > 0 ? real / meta * 100 : null;
    let cor = pct == null ? '#94a3b8' : pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
    let fxTxt = '';
    if (faixa && pct != null && pct < 100 && real >= faixa.lo) { cor = '#2563eb'; fxTxt = ` <span class="tiny" style="color:#2563eb">🎲 ${faixa.lo}–${faixa.hi} normal</span>`; }
    else if (faixa) fxTxt = ` <span class="tiny muted">🎲 ${faixa.lo}–${faixa.hi} normal</span>`;
    return `<div>
      <div class="flex" style="justify-content:space-between;font-size:11.5px;margin-bottom:2px">
        <span style="font-weight:700">${lbl}</span>
        <span><b>${isMoney ? 'R$ ' + money(real) : fmtN(real)}</b> <span class="muted">/ ${meta > 0 ? (isMoney ? 'R$ ' + money(meta) : fmtN(meta)) : '—'}</span>${pct != null ? ` · <b style="color:${cor}">${pctF(pct)}</b>` : ''}${fxTxt}</span>
      </div>
      <div style="height:10px;background:var(--bg-3);border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct != null ? Math.min(100, pct) : 0}%;background:${cor};border-radius:6px"></div></div>
    </div>`;
  };

  return panel('🎯 Norte do Mês · Meta × Realizado', `
    ${strip}
    ${parcial ? `<div class="tiny muted" style="margin-top:8px">📐 Meta <b>proporcional ao período selecionado</b> (${(n.fracs || []).map(f => `${f.ym}: ${Math.round(f.frac * 100)}%${f.tem_meta ? '' : ' <span style="color:#d97706">sem meta</span>'}`).join(' · ')}).</div>` : ''}
    <div style="margin-top:10px;overflow-x:auto"><table style="width:100%;border-collapse:collapse">${rows}</table></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
      ${resumoBar('Vendas no período', kp.vendas || 0, mp.vendas || 0, false, (mp.vendas || 0) > 0 ? poisFaixaJs(mp.vendas) : null)}
      ${resumoBar('VGV no período', kp.vgv || 0, mp.vgv || 0, true)}
    </div>
    <div id="norte-defasagem"></div>
    <div class="tiny muted" style="margin-top:8px">🔄 Realizado vem do RD CRM automaticamente (sync diário + tempo real). Atendimentos são meta de ritmo — o sistema ainda não mede atendimento 1-a-1.</div>
    ${btns}`);
}

/* ⏳ Jornada longa (MAP ~3m): a venda do mês nasce da ATIVIDADE de N meses atrás.
   Busca o realizado da janela defasada e mostra o que é justo esperar AGORA. */
async function loadDefasagem() {
  const host = document.getElementById('norte-defasagem');
  const N = Number(_norte?.defasagem_meses || 1);
  if (!host || N <= 1 || !_norte?.period) return;
  try {
    const s = new Date(_norte.period.since + 'T12:00:00'), u = new Date(_norte.period.until + 'T12:00:00');
    s.setMonth(s.getMonth() - N); u.setMonth(u.getMonth() - N);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = await api.request(`/api/v3/oo/norte?corretor_id=${encodeURIComponent(_selId)}&since=${fmt(s)}&until=${fmt(u)}&realizado=1`);
    const leadsLag = ((r.realizado || {}).kpis || {}).leads;
    if (leadsLag == null) return;
    const convPct = (_det?.funil_reverso?.taxas?.lead_venda_pct) ?? null;
    const esperadas = convPct != null ? leadsLag * convPct / 100 : null;
    const mesLag = s.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    host.innerHTML = `<div style="margin-top:8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 10px;font-size:12px">
      ⏳ <b>Jornada ~${N} meses:</b> a venda de agora nasce da atividade de <b>${escapeHtml(mesLag)}</b> —
      foram <b>${fmtN(leadsLag)}</b> leads trabalhados lá${esperadas != null ? `, o que sustenta ≈ <b>${fmtN(Math.round(esperadas * 10) / 10)}</b> venda(s) neste período` : ''}.
      Cobre a atividade do mês; a venda, julgue no trimestre.</div>`;
  } catch { /* informativo — silencioso */ }
}

function norteChangelog(log) {
  if (!(log || []).length) return '<div class="tiny muted">Sem alterações registradas.</div>';
  return `<div style="display:grid;gap:6px">${log.map(e => `
    <div style="background:var(--bg-3);border-radius:8px;padding:8px 10px">
      <div class="tiny"><b>${escapeHtml(e.quem || '?')}</b> · <span class="muted">${e.quando ? new Date(e.quando).toLocaleString('pt-BR') : ''}</span></div>
      <div class="tiny muted">${(e.mudancas || []).map(m => `${escapeHtml(m.campo)}: <s>${escapeHtml(String(m.de ?? '—'))}</s> → <b>${escapeHtml(String(m.para ?? '—'))}</b>`).join(' · ')}</div>
    </div>`).join('')}</div>`;
}

/* ── Editor da meta (a planilha viva) ── */
let _ne = null;   // estado de edição

function openNorte() {
  const n = _norte || {};
  const cfg = JSON.parse(JSON.stringify(n.cfg || {}));
  if (!Array.isArray(cfg.canais) || !cfg.canais.length) {
    cfg.canais = [
      { nome: 'Tráfego Pago', taxa_base: 1.3, energia: 0, mix: 0 },
      { nome: 'Indicação', taxa_base: 8, energia: 0, mix: 0 },
      { nome: 'Carteira Própria', taxa_base: 15, energia: 0, mix: 0 },
      { nome: 'Eventos (rodadas)', taxa_base: 3, energia: 0, mix: 0 },
      { nome: 'Networking', taxa_base: 6, energia: 0, mix: 0 },
      { nome: 'Plantão', taxa_base: 5, energia: 0, mix: 0 },
      { nome: 'Reativação/Disparo', taxa_base: 1, energia: 0, mix: 0 },
      { nome: 'Ativo (prospecção)', taxa_base: 0.5, energia: 0, mix: 0 },
      { nome: 'Tráfego orgânico', taxa_base: 1.8, energia: 0, mix: 0 },
      { nome: 'Captação de imóvel', taxa_base: 2.5, energia: 0, mix: 0 },
    ];
  }
  cfg.metas_etapas = cfg.metas_etapas || {};
  const hoje = new Date();
  _ne = { cfg, ym: n.ref_ym || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}` };
  renderNorteModal();
}

function renderNorteModal() {
  let ov = document.getElementById('norte-ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'norte-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:26px 12px;overflow:auto';
    document.body.appendChild(ov);
  }
  const c = _ne.cfg;
  const etapas = (_norte?.etapas || []).length ? _norte.etapas : [
    { key: 'lead', label: 'Lead' }, { key: 'contato', label: 'Contato / Qualificação' }, { key: 'agendamento', label: 'Agendamento' },
    { key: 'visita', label: 'Visita realizada' }, { key: 'proposta', label: 'Proposta / Aprovação' }, { key: 'pasta', label: 'Pasta / Lançamento' }, { key: 'venda', label: 'Venda' }];
  ov.innerHTML = `
    <div class="card" style="max-width:920px;width:100%;margin:0">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h3 class="card-title" style="margin:0">🎯 Meta do Mês — norte do corretor</h3>
        <div class="flex items-center gap-2">
          <label class="tiny muted">Mês</label><input type="month" id="ne-ym" class="input" value="${_ne.ym}" style="padding:4px 8px;font-size:12px">
          <button class="btn btn-ghost btn-sm" id="ne-close">✕ fechar</button>
        </div>
      </div>
      <div class="tiny muted" style="margin:4px 0 10px">Mesma matemática da planilha: taxa ajustada = taxa base × energia/100 · atendimentos do canal = mix% × total · vendas = atendimentos × taxa ajustada. Tudo fica auditado (quem mudou, quando, de → para).</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div class="field"><label>Atendimentos no mês (total)</label><input type="number" id="ne-atend" class="input" min="0" step="1" value="${Number(c.atendimentos_mes) || ''}"></div>
        <div class="field"><label>Ticket médio (R$ por venda)</label><input type="number" id="ne-ticket" class="input" min="0" step="1000" value="${Number(c.ticket_medio) || ''}"></div>
        <div class="field"><label>Observação</label><input type="text" id="ne-obs" class="input" value="${escapeHtml(c.obs || '')}" placeholder="ex.: foco reativação MAP"></div>
      </div>
      <div style="overflow-x:auto;margin-top:8px"><table class="table" style="width:100%;font-size:12px">
        <thead><tr><th style="text-align:left">Canal</th><th>Taxa base %</th><th>Energia 0-100</th><th>Mix %</th><th>Taxa ajust.</th><th>Atend.</th><th>Vendas</th><th></th></tr></thead>
        <tbody id="ne-canais">${c.canais.map((cn, i) => `
          <tr data-ne-row="${i}">
            <td><input class="input" data-ne="${i}:nome" value="${escapeHtml(cn.nome || '')}" style="min-width:150px;padding:3px 6px;font-size:12px"></td>
            <td><input class="input" type="number" step="0.1" min="0" data-ne="${i}:taxa_base" value="${Number(cn.taxa_base) || 0}" style="width:70px;padding:3px 6px;font-size:12px;text-align:right"></td>
            <td><input class="input" type="number" step="1" min="0" max="100" data-ne="${i}:energia" value="${Number(cn.energia) || 0}" style="width:64px;padding:3px 6px;font-size:12px;text-align:right"></td>
            <td><input class="input" type="number" step="0.5" min="0" data-ne="${i}:mix" value="${Number(cn.mix) || 0}" style="width:64px;padding:3px 6px;font-size:12px;text-align:right"></td>
            <td class="tiny" style="text-align:right" id="ne-ta-${i}">—</td>
            <td class="tiny" style="text-align:right" id="ne-at-${i}">—</td>
            <td class="tiny" style="text-align:right;font-weight:800" id="ne-vd-${i}">—</td>
            <td><button class="btn btn-ghost btn-sm" data-ne-del="${i}" title="remover canal">🗑</button></td>
          </tr>`).join('')}</tbody>
        <tfoot><tr style="font-weight:800">
          <td style="text-align:right">Σ</td><td></td><td></td>
          <td style="text-align:right" id="ne-mix-t">—</td><td></td>
          <td style="text-align:right" id="ne-at-t">—</td>
          <td style="text-align:right" id="ne-vd-t">—</td><td></td>
        </tr></tfoot>
      </table></div>
      <div class="flex" style="gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" id="ne-add">+ canal</button>
        <span class="tiny" id="ne-mix-aviso"></span>
        <span class="tiny muted" style="margin-left:auto">VGV previsto: <b id="ne-vgv">—</b></span>
      </div>
      <div style="margin-top:12px;font-weight:800;font-size:12.5px">Metas por etapa do funil (mesmas etapas do RD · vazio = a definir · Venda vazia usa o previsto do mix)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:6px">
        ${etapas.map(e => `<div class="field"><label class="tiny">${escapeHtml(e.label)}</label>
          <input type="number" step="0.1" min="0" class="input" data-ne-et="${e.key}" value="${c.metas_etapas[e.key] ?? ''}" placeholder="${e.key === 'venda' ? 'auto' : '—'}" style="padding:4px 8px;font-size:12px"></div>`).join('')}
      </div>
      <div class="flex" style="gap:8px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap">
        ${(((_det?.corretor?.team) || '').toLowerCase().includes('conquista') && (auth.user()?.lvl || 0) >= 7)
          ? '<button class="btn btn-ghost" id="ne-auto" style="margin-right:auto" title="Preenche com dado real: RD CRM (funil Conquista, 90d) + metas do PSM HUB. Sobrescreve o que está neste mês.">⚡ Preencher automático (RD + HUB)</button>' : ''}
        <button class="btn btn-ghost" id="ne-cancel">Cancelar</button>
        <button class="btn btn-primary" id="ne-save">💾 Salvar meta do mês</button>
      </div>
    </div>`;
  const close = () => { ov.remove(); _ne = null; };
  ov.querySelector('#ne-close').onclick = close;
  ov.querySelector('#ne-cancel').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#ne-ym').onchange = e => { _ne.ym = e.target.value; };
  ov.querySelectorAll('[data-ne]').forEach(inp => inp.addEventListener('input', () => {
    const [i, f] = inp.dataset.ne.split(':');
    _ne.cfg.canais[+i][f] = f === 'nome' ? inp.value : (parseFloat(inp.value) || 0);
    norteRecalc();
  }));
  ov.querySelector('#ne-atend').addEventListener('input', e => { _ne.cfg.atendimentos_mes = parseFloat(e.target.value) || 0; norteRecalc(); });
  ov.querySelector('#ne-ticket').addEventListener('input', e => { _ne.cfg.ticket_medio = parseFloat(e.target.value) || 0; norteRecalc(); });
  ov.querySelector('#ne-obs').addEventListener('input', e => { _ne.cfg.obs = e.target.value; });
  ov.querySelectorAll('[data-ne-et]').forEach(inp => inp.addEventListener('input', () => {
    const v = inp.value.trim();
    _ne.cfg.metas_etapas[inp.dataset.neEt] = v === '' ? null : (parseFloat(v) || 0);
  }));
  ov.querySelectorAll('[data-ne-del]').forEach(b => b.onclick = () => { _ne.cfg.canais.splice(+b.dataset.neDel, 1); renderNorteModal(); });
  ov.querySelector('#ne-add').onclick = () => { _ne.cfg.canais.push({ nome: 'Novo canal', taxa_base: 1, energia: 0, mix: 0 }); renderNorteModal(); };
  ov.querySelector('#ne-save').onclick = saveNorte;
  const bAuto = ov.querySelector('#ne-auto');
  if (bAuto) bAuto.onclick = async () => {
    if (!confirm(`Preencher o norte de ${_ne.ym} automaticamente com RD (funil Conquista, 90d) + PSM HUB?\nIsso SOBRESCREVE o que está definido neste mês pra este corretor.`)) return;
    bAuto.disabled = true; bAuto.textContent = '⚡ Preenchendo…';
    try {
      const r = await api.request('/api/v3/oo/norte_auto', { method: 'POST', body: {
        action: 'aplicar', corretor_id: _selId, ym: _ne.ym, force: true } });
      if (!r.aplicados) throw new Error((r.res && r.res[0] && (r.res[0].detalhe || r.res[0].status)) || 'nada aplicado');
      document.getElementById('norte-ov')?.remove(); _ne = null;
      await loadDetail();
    } catch (e) {
      alert('Não preencheu: ' + (e.message || e));
      bAuto.disabled = false; bAuto.textContent = '⚡ Preencher automático (RD + HUB)';
    }
  };
  norteRecalc();
}

function norteRecalc() {
  const c = _ne.cfg;
  const atendT = Number(c.atendimentos_mes) || 0;
  let mixT = 0, atT = 0, vdT = 0;
  (c.canais || []).forEach((cn, i) => {
    const ta = (Number(cn.taxa_base) || 0) * (Number(cn.energia) || 0) / 100;
    const at = atendT * (Number(cn.mix) || 0) / 100;
    const vd = at * ta / 100;
    mixT += Number(cn.mix) || 0; atT += at; vdT += vd;
    const el = id => document.getElementById(id);
    if (el(`ne-ta-${i}`)) el(`ne-ta-${i}`).textContent = pctF(ta);
    if (el(`ne-at-${i}`)) el(`ne-at-${i}`).textContent = fmtN(Math.round(at * 10) / 10);
    if (el(`ne-vd-${i}`)) el(`ne-vd-${i}`).textContent = fmtN(Math.round(vd * 1000) / 1000);
  });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ne-mix-t', pctF(mixT)); set('ne-at-t', fmtN(Math.round(atT * 10) / 10)); set('ne-vd-t', fmtN(Math.round(vdT * 1000) / 1000));
  set('ne-vgv', 'R$ ' + money(vdT * (Number(c.ticket_medio) || 0)));
  const av = document.getElementById('ne-mix-aviso');
  if (av) av.innerHTML = Math.abs(mixT - 100) < 0.51 ? '<span style="color:#16a34a;font-weight:700">✓ Mix fecha 100%</span>' : `<span style="color:#d97706;font-weight:700">⚠ Mix soma ${pctF(mixT)} — ajuste pra fechar 100%</span>`;
}

async function saveNorte() {
  const btn = document.getElementById('ne-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    await api.request('/api/v3/oo/norte', { method: 'POST', body: {
      corretor_id: _selId, ym: _ne.ym,
      patch: {
        atendimentos_mes: Number(_ne.cfg.atendimentos_mes) || 0,
        ticket_medio: Number(_ne.cfg.ticket_medio) || 0,
        obs: _ne.cfg.obs || '',
        canais: _ne.cfg.canais,
        metas_etapas: _ne.cfg.metas_etapas,
      } } });
    document.getElementById('norte-ov')?.remove(); _ne = null;
    await loadDetail();
  } catch (e) {
    alert('Não salvou: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar meta do mês'; }
  }
}

function panel(title, inner) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">${title}</div>${inner}</div>`;
}

/* ═══════════════ 🧪 SIMULADOR (v86.1) — motor de meta individual ═══════════════
   Motor da planilha FUNIL-DE-ENERGIA nativo: taxas reais 90d × pisos (credibilidade),
   elasticidade de ticket, energia por canal, horas de capacidade, faixa Poisson.
   Venda se julga no TRIMESTRE; o mês cobra ATIVIDADE. Sócio-only. */

function poisCdfJs(k, lam) { let t = Math.exp(-lam), s = t; for (let i = 1; i <= k; i++) { t *= lam / i; s += t; } return s; }
function poisQJs(q, lam) { let k = 0; while (poisCdfJs(k, lam) < q && k < 2000) k++; return k; }
function poisFaixaJs(lam) { lam = Math.max(0, Number(lam) || 0); return { lo: poisQJs(0.075, lam), hi: poisQJs(0.925, lam), p0: Math.exp(-lam) }; }

async function loadSim() {
  try {
    const r = await api.request('/api/v3/oo/simulador?user_id=' + encodeURIComponent(_selId));
    _sim = r;
    _simCen = r.cenario_salvo ? { ...JSON.parse(JSON.stringify(r.cenario_calibrado)), ...JSON.parse(JSON.stringify(r.cenario_salvo)) } : JSON.parse(JSON.stringify(r.cenario_calibrado));
    _simRes = r.baseline;
    renderDetail();
    if (r.cenario_salvo) runSim();   // cenário salvo ≠ calibrado → recalcula
  } catch (e) {
    const host = document.getElementById('oo-sim');
    if (host) host.innerHTML = `<div class="alert alert-err">Simulador indisponível: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderSim() {
  const host = document.getElementById('oo-sim');
  if (!host || !_sim) return;
  host.innerHTML = `
    ${simRetrato()}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;align-items:start">
      <div>${simPainel()}</div>
      <div id="sim-res">${simResultado()}</div>
    </div>
    <div style="margin-top:14px">${simProposta()}</div>
    <div style="margin-top:14px">${simCalibracao()}</div>`;
  wireSim();
}

const _pc = v => (v == null ? '—' : (Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');

/* a) Retrato real (90d): funil real × piso × usada + canais + volume + ticket */
function simRetrato() {
  const e = _sim.estado || {}, ps = e.passagens || [];
  const garg = e.gargalo;
  const rows = ps.map(p => {
    const isG = p.key === garg;
    const abaixo = p.real != null && p.real < p.piso;
    return `<tr style="${isG ? 'background:#fef2f2' : ''}">
      <td style="padding:4px 8px 4px 0;font-size:12px;font-weight:600;white-space:nowrap">${escapeHtml(p.label)}${isG ? ' <span style="color:#dc2626;font-weight:800" title="maior ganho se consertar">🔥 gargalo</span>' : ''}</td>
      <td style="text-align:right;font-size:12px;color:${abaixo ? '#dc2626' : '#16a34a'};font-weight:700">${_pc(p.real)}</td>
      <td style="text-align:right;font-size:12px;color:var(--ink-muted)">${_pc(p.piso)}</td>
      <td style="text-align:right;font-size:12px;font-weight:800">${_pc(p.usada)}</td>
      <td style="text-align:right;font-size:11px;color:var(--ink-muted)">n=${p.n}</td>
    </tr>`;
  }).join('');
  const chips = (e.canais || []).map(c =>
    `<span style="display:inline-block;background:var(--bg-3);border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-size:11.5px;margin:2px">
      <b>${escapeHtml(c.label)}</b> ${Math.round(c.share * 100)}%${c.neutro ? '' : ` · conv ${c.taxa_rel}×`}<span class="muted"> · ${c.leads} leads</span></span>`).join('');
  const rdBadge = e.modo === 'rd' && e.pipeline
    ? `<div style="margin-bottom:8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:6px 10px;font-size:12px">🔁 <b>Etapas espelhadas 1:1 do funil “${escapeHtml(e.pipeline.nome)}” do RD CRM</b> — mesma quantidade e nomenclatura (sem tradução, sem divergência). Piso = taxa real da equipe inteira na passagem (editável na Calibração).</div>`
    : '';
  return panel(`📸 Retrato real (90d) · ${escapeHtml((_sim.corretor || {}).name || '')}`, `
    ${rdBadge}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;text-align:center">
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:20px;font-weight:900">${fmtN(e.volume_mensal_leads)}</div><div class="tiny muted">leads novos/mês</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:20px;font-weight:900">${e.vendas_90d || 0}</div><div class="tiny muted">vendas 90d · média 6m: ${fmtN(e.media_6m_vendas)}/mês</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:20px;font-weight:900">${e.ticket_corretor ? 'R$ ' + moneyShort(e.ticket_corretor) : '—'}</div><div class="tiny muted">ticket dele · equipe: ${e.ticket_equipe ? 'R$ ' + moneyShort(e.ticket_equipe) : '—'}</div></div>
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left;padding-bottom:4px">Passagem do funil</th><th>real 90d</th><th>piso mercado</th><th>usada*</th><th>amostra</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">* taxa usada = média entre o REAL dele e o PISO de mercado, ponderada pela amostra (K=${(_sim.config || {}).K}) — corretor novo nasce do piso, veterano nasce dele.</div>
    <div style="margin-top:8px">${chips || '<span class="tiny muted">Sem leads no período pra mapear canais.</span>'}</div>`);
}

/* b) Painel de simulação: volume, perfil, energia por canal, "e se" por etapa */
function simPainel() {
  const e = _sim.estado || {}, cfg = _sim.config || {}, c = _simCen || {};
  const faixas = cfg.faixas || {};
  const perfis = [['conquista', `Conquista (R$ ${moneyShort((faixas.conquista || {}).ticket || 0)})`],
                  ['map', `MAP (R$ ${moneyShort((faixas.map || {}).ticket || 0)})`],
                  ['misto', 'Misto (50/50)'], ['manual', 'Manual (mix por faixa)']];
  const mixM = c.mix_manual || { conquista: 50, map: 50, alto_padrao: 0 };
  const canais = (e.canais || []).map(cn => {
    const en = Math.round(Number((c.energia || {})[cn.key] ?? 100));
    return `<div style="display:grid;grid-template-columns:110px 1fr 46px;gap:8px;align-items:center">
      <span class="tiny" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${Math.round(cn.share * 100)}% dos leads">${escapeHtml(cn.label)} <span class="muted">${Math.round(cn.share * 100)}%</span></span>
      <input type="range" min="0" max="100" step="5" value="${en}" data-sim-en="${escapeHtml(cn.key)}">
      <span class="tiny" style="text-align:right;font-weight:800" id="sim-enl-${escapeHtml(cn.key)}">${en}</span>
    </div>`;
  }).join('');
  const ovs = (e.passagens || []).map(p => {
    const ov = (c.overrides || {})[p.key];
    return `<div class="field"><label class="tiny" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(p.label)}">${escapeHtml(p.label)}</label>
      <input type="number" class="input" min="1" max="98" step="1" data-sim-ov="${escapeHtml(p.key)}"
        value="${ov != null ? Math.round(ov * 100) : ''}" placeholder="${Math.round((p.usada || 0) * 100)}%" style="padding:4px 8px;font-size:12px"></div>`;
  }).join('');
  return panel('🎛 Simular cenário (ao vivo no 1:1)', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Atendimentos/mês (leads que ele dá conta)</label>
        <input type="number" class="input" id="sim-atend" min="0" step="1" value="${Math.round(Number(c.atendimentos_mes) || 0)}"></div>
      <div class="field"><label>Meta-alvo de vendas/mês (opcional)</label>
        <input type="number" class="input" id="sim-meta" min="0" step="1" value="${c.meta_vendas_mes || ''}" placeholder="p/ ver o gap"></div>
    </div>
    <div class="field" style="margin-top:6px"><label>Perfil de marca (mix de ticket)</label>
      <select class="select" id="sim-perfil">${perfis.map(p => `<option value="${p[0]}"${(c.perfil || 'misto') === p[0] ? ' selected' : ''}>${p[1]}</option>`).join('')}</select></div>
    <div id="sim-mixm" style="display:${(c.perfil === 'manual') ? 'grid' : 'none'};grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px">
      ${['conquista', 'map', 'alto_padrao'].map(f => `<div class="field"><label class="tiny">${escapeHtml((faixas[f] || {}).label || f)} (peso)</label>
        <input type="number" class="input" min="0" step="5" data-sim-mix="${f}" value="${Number(mixM[f]) || 0}" style="padding:4px 8px;font-size:12px"></div>`).join('')}
    </div>
    <div style="margin-top:10px;font-weight:800;font-size:12px">⚡ Energia por canal <span class="tiny muted" style="font-weight:400">(0 zera o canal · 100 = taxa plena — semântica da planilha)</span></div>
    <div style="display:grid;gap:4px;margin-top:6px">${canais || '<div class="tiny muted">Sem canais mapeados — fator neutro.</div>'}</div>
    <div style="margin-top:10px;font-weight:800;font-size:12px">🔧 “E se melhorar a etapa?” <span class="tiny muted" style="font-weight:400">(taxa em % · vazio = usa a calibrada)</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:6px">${ovs}</div>
    <div class="flex gap-2" style="margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="sim-reset">↺ Restaurar calibrado</button>
      <button class="btn btn-ghost btn-sm" id="sim-save">💾 Salvar cenário (retomar depois)</button>
    </div>`);
}

/* c) Resultado ao vivo */
function simResultado() {
  const r = _simRes;
  if (!r) return panel('📈 Resultado', '<div class="tiny muted">Ajuste o cenário pra simular.</div>');
  const h = r.horas || {}, po = (r.poisson || {});
  const FAROL = { cabe: ['#16a34a', '✅ cabe na agenda'], apertado: ['#d97706', '⚠️ apertado'], nao_cabe: ['#dc2626', '🚨 NÃO cabe — rebaixe volume ou meta'] };
  const [fc, fl] = FAROL[h.farol] || ['#94a3b8', '—'];
  const atv = r.atividade_mes || {};
  const ATV_LBL = { lead: 'Leads novos', contato: 'Contatos/qualif.', agendamento: 'Agendamentos', visita: 'Visitas realizadas', proposta: 'Propostas', pasta: 'Pastas' };
  const alav = (r.alavancas || []).map((a, i) =>
    `<div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:8px;padding:6px 10px">
      <span style="font-weight:900;color:#2563eb">${i + 1}º</span>
      <span style="flex:1;font-size:12px">${escapeHtml(a.label)}</span>
      <span style="font-weight:800;color:#16a34a;font-size:12px">+${fmtN(a.delta_vendas)} venda(s)/mês</span></div>`).join('');
  const gap = r.gap;
  return panel('📈 Resultado do cenário', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;background:linear-gradient(135deg,#0f172a,#1e3a8a);border-radius:var(--r-md);padding:12px 14px;color:#fff;text-align:center">
      <div><div style="font-size:10.5px;opacity:.75;text-transform:uppercase">Vendas/mês</div><div style="font-size:24px;font-weight:900">${fmtN(r.vendas_prev)}</div></div>
      <div><div style="font-size:10.5px;opacity:.75;text-transform:uppercase">VGV/mês</div><div style="font-size:24px;font-weight:900">R$ ${moneyShort(r.vgv_prev)}</div></div>
      <div><div style="font-size:10.5px;opacity:.75;text-transform:uppercase">Conversão efetiva</div><div style="font-size:24px;font-weight:900">${fmtN(r.conv_efetiva_pct)}%</div></div>
    </div>
    <div class="tiny muted" style="margin-top:6px">funil ${_pc(r.conv_funil)} × ticket ${fmtN(r.fator_ticket)}× × canais ${fmtN(r.fator_canais)}× · ticket ponderado R$ ${moneyShort(r.ticket_ponderado)} · jornada ~${fmtN(r.jornada_meses)} mês(es)</div>
    ${gap ? `<div style="margin-top:8px;background:${gap.gap_vendas > 0 ? '#fffbeb' : '#f0fdf4'};border:1px solid ${gap.gap_vendas > 0 ? '#fde68a' : '#bbf7d0'};border-radius:8px;padding:8px 10px;font-size:12px">
      🎯 Meta ${fmtN(gap.meta_vendas_mes)}/mês: ${gap.gap_vendas > 0 ? `faltam <b>${fmtN(gap.gap_vendas)}</b> venda(s) — precisaria de <b>${fmtN(gap.atend_necessarios)}</b> atendimentos/mês` : '<b>cenário bate a meta ✓</b>'}</div>` : ''}
    <div style="margin-top:10px;font-weight:800;font-size:12px">📋 Atividade mensal necessária (o que o mês cobra)</div>
    <table style="width:100%;border-collapse:collapse;margin-top:4px">${(r.atividade_rows && r.atividade_rows.length
      ? r.atividade_rows.map(a => `<tr><td style="font-size:12px;padding:3px 0">${escapeHtml(a.label)}</td><td style="text-align:right;font-weight:800;font-size:12.5px">${fmtN(a.valor)}</td></tr>`)
      : Object.keys(ATV_LBL).map(k => `<tr><td style="font-size:12px;padding:3px 0">${ATV_LBL[k]}</td><td style="text-align:right;font-weight:800;font-size:12.5px">${fmtN(atv[k])}</td></tr>`)).join('')}</table>
    <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:12px;background:var(--bg-3);border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.min(100, h.pct || 0)}%;background:${fc}"></div></div>
      <span class="tiny" style="font-weight:800;color:${fc};white-space:nowrap">${fmtN(h.total)}h / ${fmtN(h.capacidade)}h · ${fl}</span>
    </div>
    <div style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:8px 10px;font-size:12px">
      🎲 <b>Faixa estatística (Poisson)</b> — venda se julga no TRIMESTRE:<br>
      mês: <b>${(po.mes || {}).lo}–${(po.mes || {}).hi}</b> é normal · ${Math.round(((po.mes || {}).p_zero || 0) * 100)}% dos meses zeram MESMO executando certo<br>
      trimestre: <b>${(po.tri || {}).lo}–${(po.tri || {}).hi}</b> é normal
    </div>
    ${alav ? `<div style="margin-top:10px;font-weight:800;font-size:12px">🚀 Top alavancas deste cenário</div><div style="display:grid;gap:5px;margin-top:5px">${alav}</div>` : ''}`);
}

/* d) Proposta de meta trimestral */
function simProposta() {
  const qa = _sim.quarter_atual, qp = _sim.quarter_proximo;
  const qSel = document.getElementById('sim-q')?.value;
  const q = (qSel === qa || qSel === qp) ? qSel : qp;
  const reg = (_sim.propostas || {})[q];
  const p = reg && reg.proposta;
  const shadow = !!_sim.shadow;
  const STATUS = { proposta: ['#64748b', '📝 rascunho (só sócios veem)'], enviada: ['#2563eb', '📨 enviada — aguardando aceite'], aceita: ['#16a34a', '✅ aceita pelo corretor'] };
  const st = reg ? (STATUS[reg.status] || STATUS.proposta) : null;
  const ATV_LBL = { lead: 'Leads', contato: 'Contatos', agendamento: 'Agend.', visita: 'Visitas', proposta: 'Propostas', pasta: 'Pastas' };
  return panel('🎯 Transformar em meta (trimestre)', `
    <div class="flex items-center gap-2" style="flex-wrap:wrap">
      <label class="tiny muted">Trimestre</label>
      <select class="select" id="sim-q" style="width:auto">${[qa, qp].map(x => `<option value="${x}"${x === q ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <label class="tiny muted">Vendas/mês</label>
      <select class="select" id="sim-adj" style="width:auto">
        <option value="auto">auto (motor decide)</option>
        ${[1, 2, 3].map(m => `<option value="${m}">${m}/mês (${m * 3} no tri)</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" id="sim-prop">🎯 Gerar proposta</button>
      ${reg && reg.status !== 'aceita' ? `<button class="btn btn-sm ${shadow ? 'btn-ghost' : 'btn-primary'}" id="sim-send" ${shadow ? 'disabled title="modo sombra ligado — desligue na Calibração"' : ''}>📨 Enviar pro corretor</button>` : ''}
    </div>
    <div class="tiny muted" style="margin-top:6px">Regra: maior m∈{1,2,3} com horas ≤ 85% da capacidade e m ≤ média 6m ×1,3 + 0,5 · sem histórico → 1. O aceite do corretor (no Meu Painel) grava a ATIVIDADE mensal derivada no Norte do Mês dos 3 meses.</div>
    ${reg && p ? `<div style="margin-top:10px;background:var(--bg-3);border-radius:8px;padding:10px 12px">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <span style="font-weight:900;font-size:15px">${p.vendas_mes}/mês · ${p.vendas_tri} no tri ${reg.quarter || q}</span>
        <span class="tiny" style="background:${st[0]}22;color:${st[0]};border:1px solid ${st[0]}55;padding:2px 8px;border-radius:999px;font-weight:700">${st[1]}</span>
        ${p.ajuste_socio != null && p.ajuste_socio !== p.m_auto ? `<span class="tiny muted">(motor sugeriu ${p.m_auto} · sócio ajustou pra ${p.ajuste_socio})</span>` : ''}
      </div>
      <div class="tiny" style="margin-top:6px">VGV/mês ≈ <b>R$ ${moneyShort(p.vgv_mes_prev)}</b> · ${fmtN(p.horas_mes)}h/mês de ${fmtN(p.capacidade)}h · 🎲 tri normal: <b>${(p.poisson_tri || {}).lo}–${(p.poisson_tri || {}).hi}</b> · mês zera ${Math.round(((p.poisson_mes || {}).p_zero || 0) * 100)}% das vezes mesmo executando</div>
      <div class="tiny" style="margin-top:4px">Atividade/mês: ${(p.atividade_rows && p.atividade_rows.length
        ? p.atividade_rows.map(a => `${escapeHtml(a.label)} <b>${fmtN(a.valor)}</b>`)
        : Object.keys(ATV_LBL).map(k => `${ATV_LBL[k]} <b>${fmtN((p.atividade_mes || {})[k])}</b>`)).join(' · ')}</div>
      ${reg.aceite ? `<div class="tiny" style="color:#16a34a;margin-top:4px">Aceita em ${new Date(reg.aceite.ts).toLocaleString('pt-BR')}</div>` : ''}
    </div>` : '<div class="tiny muted" style="margin-top:8px">Nenhuma proposta gerada pra este trimestre ainda.</div>'}`);
}

/* e) Calibração global (gaveta — mexe pra TODOS os corretores) */
function simCalibracao() {
  const cfg = _sim.config || {}, pisos = cfg.pisos || {}, faixas = cfg.faixas || {}, tempos = cfg.tempos_min || {}, defas = cfg.defasagem_meses || {};
  const e = _sim.estado || {};
  const num = (id, lbl, v, step) => `<div class="field"><label class="tiny">${lbl}</label><input type="number" class="input" id="${id}" value="${v}" step="${step || 1}" style="padding:4px 8px;font-size:12px"></div>`;
  return `<details style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 14px">
    <summary style="font-weight:800;font-size:13px;cursor:pointer">⚙️ Calibração do motor (global — vale pra todos os corretores) ${_sim.shadow ? '· 🌒 SOMBRA LIGADA' : '· 🌕 sombra desligada'}</summary>
    <div style="margin-top:10px">
      <label style="display:flex;align-items:center;gap:8px;background:${_sim.shadow ? '#f1f5f9' : '#f0fdf4'};border:1px solid ${_sim.shadow ? '#cbd5e1' : '#bbf7d0'};border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12.5px">
        <input type="checkbox" id="cal-shadow" ${_sim.shadow ? 'checked' : ''}>
        <span><b>Modo sombra</b> — aba e propostas visíveis SÓ pra sócios; nada é enviado a corretor nem gravado no Norte do Mês até desligar.</span>
      </label>
      <div style="margin-top:8px;font-weight:800;font-size:12px">Pisos de mercado por passagem (%)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:4px">
        ${(e.passagens || []).map(p => num('cal-piso-' + p.key, p.label, Math.round((pisos[p.key] || 0) * 100))).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:8px">
        ${num('cal-k', 'K (credibilidade)', cfg.K)}
        ${num('cal-tref', 'Ticket ref. (R$)', cfg.ticket_ref, 1000)}
        ${num('cal-sens', 'Sensibilidade ticket', cfg.sens, 0.1)}
        ${num('cal-du', 'Dias úteis/mês', cfg.dias_uteis)}
        ${num('cal-hd', 'Horas/dia', cfg.horas_dia)}
        ${num('cal-minam', 'Amostra mín. canal', cfg.canal_min_amostra)}
      </div>
      <div style="margin-top:8px;font-weight:800;font-size:12px">Faixas de ticket (R$) · jornada (meses)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:4px">
        ${['conquista', 'map', 'alto_padrao'].map(f => num('cal-fx-' + f, (faixas[f] || {}).label || f, (faixas[f] || {}).ticket || 0, 10000)
          + num('cal-jn-' + f, 'jornada ' + ((faixas[f] || {}).label || f), (faixas[f] || {}).jornada_meses || 1)).join('')}
      </div>
      <div style="margin-top:8px;font-weight:800;font-size:12px">Tempo por atividade (min) · defasagem venda↔atividade (meses)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:4px">
        ${['lead', 'contato', 'agendamento', 'visita', 'proposta', 'pasta'].map(k => num('cal-tm-' + k, k, tempos[k] ?? 0)).join('')}
        ${num('cal-df-map', 'defasagem MAP', defas.map ?? 3)}
        ${num('cal-df-conq', 'defasagem Conquista', defas.conquista ?? 1)}
      </div>
      <div class="flex" style="margin-top:10px;justify-content:flex-end">
        <button class="btn btn-primary btn-sm" id="cal-save">💾 Salvar calibração</button>
      </div>
    </div>
  </details>`;
}

function wireSim() {
  const $ = id => document.getElementById(id);
  const sched = () => { clearTimeout(_simTimer); _simTimer = setTimeout(runSim, 450); };
  $('sim-atend')?.addEventListener('input', ev => { _simCen.atendimentos_mes = parseFloat(ev.target.value) || 0; sched(); });
  $('sim-meta')?.addEventListener('input', ev => { const v = parseFloat(ev.target.value); _simCen.meta_vendas_mes = v > 0 ? v : null; sched(); });
  $('sim-perfil')?.addEventListener('change', ev => {
    _simCen.perfil = ev.target.value;
    const mm = $('sim-mixm'); if (mm) mm.style.display = _simCen.perfil === 'manual' ? 'grid' : 'none';
    sched();
  });
  _root.querySelectorAll('[data-sim-mix]').forEach(inp => inp.addEventListener('input', () => {
    _simCen.mix_manual = _simCen.mix_manual || {};
    _simCen.mix_manual[inp.dataset.simMix] = parseFloat(inp.value) || 0;
    sched();
  }));
  _root.querySelectorAll('[data-sim-en]').forEach(inp => inp.addEventListener('input', () => {
    _simCen.energia = _simCen.energia || {};
    _simCen.energia[inp.dataset.simEn] = parseFloat(inp.value) || 0;
    const l = $('sim-enl-' + inp.dataset.simEn); if (l) l.textContent = inp.value;
    sched();
  }));
  _root.querySelectorAll('[data-sim-ov]').forEach(inp => inp.addEventListener('input', () => {
    _simCen.overrides = _simCen.overrides || {};
    const v = inp.value.trim();
    if (v === '') delete _simCen.overrides[inp.dataset.simOv];
    else _simCen.overrides[inp.dataset.simOv] = Math.min(0.98, Math.max(0.01, (parseFloat(v) || 0) / 100));
    sched();
  }));
  $('sim-reset')?.addEventListener('click', () => {
    _simCen = JSON.parse(JSON.stringify(_sim.cenario_calibrado));
    _simRes = _sim.baseline;
    renderSim();
  });
  $('sim-save')?.addEventListener('click', async ev => {
    ev.target.disabled = true; ev.target.textContent = 'Salvando…';
    try {
      await api.request('/api/v3/oo/simulador', { method: 'POST', body: { action: 'salvar_cenario', user_id: _selId, cenario: _simCen } });
      ev.target.textContent = '✓ Cenário salvo';
    } catch (e) { alert('Não salvou: ' + e.message); ev.target.textContent = '💾 Salvar cenário (retomar depois)'; }
    ev.target.disabled = false;
  });
  $('sim-q')?.addEventListener('change', () => { const box = $('oo-sim'); if (box) renderSim(); });
  $('sim-prop')?.addEventListener('click', gerarProposta);
  $('sim-send')?.addEventListener('click', enviarProposta);
  $('cal-save')?.addEventListener('click', salvarCalibracao);
}

async function runSim() {
  if (!_sim || !_simCen) return;
  try {
    const r = await api.request('/api/v3/oo/simulador', { method: 'POST', body: {
      action: 'simular',
      estado: { taxas_usadas: (_sim.estado || {}).taxas_usadas, canais: (_sim.estado || {}).canais, cadeia: (_sim.estado || {}).cadeia },
      cenario: _simCen } });
    _simRes = r.result;
    const el = document.getElementById('sim-res');
    if (el) el.innerHTML = simResultado();
  } catch (e) { /* mantém o último resultado na tela */ }
}

async function gerarProposta() {
  const q = document.getElementById('sim-q')?.value || _sim.quarter_proximo;
  const adj = document.getElementById('sim-adj')?.value;
  const btn = document.getElementById('sim-prop');
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
  try {
    // guarda o cenário junto (retomar 1:1 de onde parou)
    api.request('/api/v3/oo/simulador', { method: 'POST', body: { action: 'salvar_cenario', user_id: _selId, cenario: _simCen } }).catch(() => {});
    const r = await api.request('/api/v3/oo/simulador', { method: 'POST', body: {
      action: 'proposta', user_id: _selId, quarter: q,
      estado: { taxas_usadas: (_sim.estado || {}).taxas_usadas, canais: (_sim.estado || {}).canais, cadeia: (_sim.estado || {}).cadeia, pipeline: (_sim.estado || {}).pipeline, media_6m_vendas: (_sim.estado || {}).media_6m_vendas },
      cenario: _simCen,
      ajuste_socio: adj === 'auto' ? null : Number(adj) } });
    _sim.propostas = _sim.propostas || {};
    _sim.propostas[q] = r.proposta;
    renderSim();
  } catch (e) {
    alert('Não gerou: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '🎯 Gerar proposta'; }
  }
}

async function enviarProposta() {
  const q = document.getElementById('sim-q')?.value || _sim.quarter_proximo;
  if (!confirm(`Enviar a proposta do ${q} pro corretor aceitar no Meu Painel?`)) return;
  try {
    const r = await api.request('/api/v3/oo/simulador', { method: 'POST', body: { action: 'enviar', user_id: _selId, quarter: q } });
    _sim.propostas[q] = r.proposta;
    renderSim();
  } catch (e) { alert('Não enviou: ' + (e.message || e)); }
}

async function salvarCalibracao() {
  const $ = id => document.getElementById(id);
  const btn = $('cal-save');
  const nv = id => parseFloat($(id)?.value) || 0;
  const e = _sim.estado || {};
  const pisosNovos = Object.fromEntries((e.passagens || []).map(p => [p.key, Math.min(0.98, Math.max(0.01, nv('cal-piso-' + p.key) / 100))]));
  const patch = {
    motor_shadow: !!$('cal-shadow')?.checked,
    K: Math.max(1, Math.round(nv('cal-k'))),
    ticket_ref: nv('cal-tref'), sens: nv('cal-sens'),
    dias_uteis: nv('cal-du'), horas_dia: nv('cal-hd'),
    canal_min_amostra: Math.max(1, Math.round(nv('cal-minam'))),
    faixas: Object.fromEntries(['conquista', 'map', 'alto_padrao'].map(f => [f, {
      ...((_sim.config.faixas || {})[f] || {}), ticket: nv('cal-fx-' + f), jornada_meses: nv('cal-jn-' + f) }])),
    tempos_min: Object.fromEntries(['lead', 'contato', 'agendamento', 'visita', 'proposta', 'pasta'].map(k => [k, nv('cal-tm-' + k)])),
    defasagem_meses: { map: Math.round(nv('cal-df-map')), conquista: Math.round(nv('cal-df-conq')) },
  };
  // pisos: funil RD espelhado grava em pisos_rd[pipeline]; canônico grava em pisos
  if (e.modo === 'rd' && e.pipeline) {
    patch.pisos_rd = { ...((_sim.config || {}).pisos_rd || {}), [e.pipeline.id]: pisosNovos };
  } else {
    patch.pisos = pisosNovos;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const r = await api.request('/api/v3/oo/simulador', { method: 'POST', body: { action: 'config', patch } });
    _sim.config = r.config;
    _sim.shadow = !!(r.config || {}).motor_shadow;
    // recarrega o estado calibrado (pisos/K mudam as taxas usadas)
    _sim = null; _simRes = null;
    renderDetail();
  } catch (e) {
    alert('Não salvou: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar calibração'; }
  }
}

/* 🎯 Funil reverso: da meta → atividades necessárias pelas taxas reais do corretor */
function reverseFunnelPanel(d) {
  const fr = d.funil_reverso;
  if (!fr) return panel('🎯 Funil reverso (previsibilidade)',
    '<div class="tiny muted">Defina a meta de VGV/vendas deste corretor (em Metas) pra simular quantos leads, contatos e visitas são necessários.</div>');
  const linhas = [['Vendas', 'vendas'], ['Visitas', 'visitas'], ['Contatos', 'contatos'], ['Leads', 'leads']];
  const fonte = fr.usa_taxas === 'individuais' ? 'taxas REAIS deste corretor' : 'benchmark (sem histórico próprio ainda)';
  const rows = linhas.map(([lbl, k]) => {
    const nec = fr.necessario[k] ?? '—', real = fr.realizado[k] ?? 0, falta = fr.faltam[k] ?? 0;
    const cor = falta > 0 ? '#dc2626' : '#16a34a';
    return `<tr>
      <td style="padding:4px 6px;font-weight:600">${lbl}</td>
      <td style="padding:4px 6px;text-align:center">${nec}</td>
      <td style="padding:4px 6px;text-align:center;color:#64748b">${real}</td>
      <td style="padding:4px 6px;text-align:center;font-weight:800;color:${cor}">${falta > 0 ? 'faltam ' + falta : '✓'}</td>
    </tr>`;
  }).join('');
  return panel('🎯 Funil reverso — pra bater a meta', `
    <div class="tiny muted" style="margin-bottom:6px">Meta: <b>R$ ${money(fr.meta_vgv)}</b> · <b>${fr.necessario.vendas}</b> venda(s). Cálculo pelas ${fonte}.</div>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr style="color:#64748b;font-size:10.5px;text-transform:uppercase">
        <th style="text-align:left;padding:2px 6px">Etapa</th><th style="padding:2px 6px">Precisa</th><th style="padding:2px 6px">Feito</th><th style="padding:2px 6px">Falta</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="tiny muted" style="margin-top:6px">Taxas: lead→venda ${pctF(fr.taxas.lead_venda_pct)} · ${fr.taxas.visitas_por_venda} visitas/venda · ${fr.taxas.contatos_por_venda} contatos/venda.</div>`);
}

/* 📈 Projeção: realizado até hoje + (se mês em aberto) projeção pelo ritmo até o fim */
function projecaoPanel(d) {
  const p = d.projecao;
  if (!p) return '';
  const temMeta = p.meta_vgv > 0;
  const proj = (p.modo === 'projecao');
  const att = p.atingira_vgv_pct;
  const cor = p.no_ritmo === true ? '#16a34a' : (p.no_ritmo === false ? '#dc2626' : '#64748b');
  return panel(proj ? '📈 Projeção do mês (ritmo atual)' : '📈 Realizado do período', `
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end">
      <div><div class="tiny muted">Realizado até hoje</div><div style="font-size:20px;font-weight:900">R$ ${moneyShort(p.real_vgv)} <span class="tiny muted" style="font-weight:400">· ${p.real_vendas} venda(s)</span></div></div>
      ${proj ? `<div style="font-size:18px;color:#94a3b8">→</div>
        <div><div class="tiny muted">Projeção fim do mês</div><div style="font-size:22px;font-weight:900;color:${cor}">R$ ${moneyShort(p.proj_vgv)} <span class="tiny muted" style="font-weight:400">· ${p.proj_vendas} venda(s)</span></div>${p.margem_pct ? `<div class="tiny muted">faixa R$ ${moneyShort(p.proj_vgv_low)} – R$ ${moneyShort(p.proj_vgv_high)} · ±${pctF(p.margem_pct)}</div>` : ''}</div>` : ''}
      ${temMeta ? `<div style="margin-left:auto;text-align:right"><div class="tiny muted">${proj ? 'proj. da meta' : 'da meta'}</div><div style="font-size:22px;font-weight:900;color:${cor}">${pctF(att)}</div></div>` : ''}
    </div>
    ${temMeta ? `<div style="margin-top:6px">${bar(Math.min(100, att || 0), p.no_ritmo ? 'verde' : (att >= 70 ? 'amarelo' : 'vermelho'))}</div>` : ''}
    <div class="tiny muted" style="margin-top:6px">${proj ? `${p.dias_decorridos}/${p.dias_total} dias do mês (faltam ${p.dias_restantes}).${p.confianca ? ' Confiança ' + ({ alta: '🟢 alta', media: '🟡 média', baixa: '🔴 baixa' }[p.confianca]) + ' (±' + p.margem_pct + '%, fecha conforme o mês avança).' : ''} ` : 'Período fechado — sem extrapolação. '}
      ${temMeta ? (p.no_ritmo ? '✅ No ritmo de bater a meta.' : `🔴 Projetado ${pctF(att)} da meta — gap de R$ ${moneyShort(p.gap_vgv)}.${p.ritmo_necessario_dia ? ' Precisa ~' + p.ritmo_necessario_dia + ' venda(s)/dia.' : ''}`) : 'Defina a meta pra comparar.'}</div>`);
}
function miniKpi(lbl, val) {
  return `<div style="background:var(--bg-3);border-radius:6px;padding:5px 4px"><div style="font-weight:800;font-size:14px">${val}</div><div style="font-size:9.5px;color:var(--ink-muted)">${lbl}</div></div>`;
}
function stat(lbl, val, color, badge, tip) {
  return `<div title="${tip ? escapeHtml(tip) : ''}" style="background:var(--bg-3);border-radius:6px;padding:7px 9px"><div style="font-weight:800;font-size:15px;color:${color}">${val}</div><div style="font-size:10px;color:var(--ink-muted)">${lbl}${badge ? ` · <span style="color:${badge==='real'?'#16a34a':'#d97706'}">${badge==='real'?'✓ real':'≈'}</span>` : ''}</div></div>`;
}
function bar(pct, hc) {
  return `<div style="height:6px;background:var(--bg-3);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${healthHex(hc)}"></div></div>`;
}
function healthDot(c) { return `<div style="width:14px;height:14px;border-radius:50%;background:${healthHex(c)};margin:0 auto"></div>`; }
function healthHex(c) { return c === 'verde' ? '#16a34a' : c === 'amarelo' ? '#d97706' : '#dc2626'; }
function healthEmoji(c) { return c === 'verde' ? '🟢' : c === 'amarelo' ? '🟡' : '🔴'; }
function spinner(t) { return `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${t}</div></div>`; }
function err(m) { return `<div class="alert alert-err">Erro: ${escapeHtml(m)}</div>`; }
function fmtD(s) { if (!s) return '—'; try { return new Date(s + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return s; } }
// v80.1: SEM arredondamento/abreviação — valores SEMPRE exatos (decisão do sócio).
function money(v) { return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function moneyShort(v) { return money(v); }   // alias: não abrevia mais (k/M); valor cheio
function pctF(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ═══════════════════ VISÃO 360° RH (cruza módulos) · v81.96 ═══════════════════
   Puxa de: Funções&Organograma (cargo+checklist), Avaliações (score+feedbacks),
   Perfil/Painel (pontos de atenção, perfil comportamental, metas), Plano de
   Crescimento (PDI), 1:1 (ações abertas) e Remuneração. */
let _rh360 = {};
async function loadRH360(c) {
  const host = document.getElementById('oo-rh360'); if (!host) return;
  const uid = c.id, myLvl = auth.user()?.lvl || 0;
  let ft = {}, pf = {}, av = {}, reg = {}, rem = {};
  try {
    [ft, pf, av, reg, rem] = await Promise.all([
      api.request('/api/v3/settings/funcoes_tarefas?user_id=' + encodeURIComponent(uid)).catch(() => ({})),
      api.request('/api/v3/profile/data?user_id=' + encodeURIComponent(uid)).catch(() => ({})),
      api.request('/api/v3/gp/avaliacoes').catch(() => ({ avaliacoes: [], feedbacks: [] })),
      api.request('/api/v3/gp/rh_registros').catch(() => ({})),
      (myLvl >= 5 ? api.request('/api/v3/gp/remuneracao?user_id=' + encodeURIComponent(uid)).catch(() => ({})) : Promise.resolve({})),
    ]);
  } catch (e) { /* noop */ }
  _rh360 = { uid, name: c.name, ft, pf, av, reg, rem };
  render360();
}
function render360() {
  const host = document.getElementById('oo-rh360'); if (!host) return;
  const { uid, name, ft, pf, av, reg, rem } = _rh360;
  const cargo = ft.cargo || {};
  const items = ft.items || [], checked = ft.checked || {};
  const doneN = items.filter(it => checked[it.id]).length;
  const prof = pf.profile || {};
  const escala = (av.config && av.config.escala) || 5;
  const avs = (av.avaliacoes || []).filter(a => a.avaliado_id === uid && a.status === 'enviado').sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  const score = avs.length ? (avs[0].nota_calibrada != null ? avs[0].nota_calibrada : avs[0].nota_final) : null;
  const fbs = (av.feedbacks || []).filter(f => f.para_id === uid).slice(0, 6);
  const plano = ((reg.plano) || []).filter(p => (p.pessoa || '').trim().toLowerCase() === (name || '').trim().toLowerCase());
  const acoesAbertas = (_meet || []).reduce((n, m) => n + (Array.isArray(m.acoes) ? m.acoes.filter(a => !a.done).length : 0), 0);
  const r = rem.remuneracao || {};
  const vgv = (_det && _det.metrics && (_det.metrics.vgv || _det.metrics.realizado)) || 0;
  const myLvl = auth.user()?.lvl || 0;
  const box = (titulo, html, cor) => `<div style="background:var(--bg-2);border:1px solid var(--bd,#e2e8f0);border-left:3px solid ${cor};border-radius:10px;padding:11px">
    <div style="font-weight:800;font-size:12.5px;margin-bottom:5px">${titulo}</div>${html}</div>`;
  const nl = s => escapeHtml(s || '').replace(/\n/g, '<br>') || '<span class="muted tiny">—</span>';
  host.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <h3 class="card-title" style="margin:0">📊 Visão 360° RH — ${escapeHtml(name || '')}</h3>
        <span class="tiny muted">cruza Funções · Avaliações · Perfil · PDI · 1:1 · Remuneração</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px">
        ${box('🪪 Cargo — Funções/Objetivos/Tarefas', `
          ${cargo.funcoes ? `<div class="tiny"><b>Funções:</b> ${nl(cargo.funcoes)}</div>` : ''}
          ${cargo.objetivos ? `<div class="tiny" style="margin-top:3px"><b>Objetivos:</b> ${nl(cargo.objetivos)}</div>` : ''}
          ${cargo.tarefas ? `<div class="tiny" style="margin-top:3px"><b>Tarefas:</b> ${nl(cargo.tarefas)}</div>` : ''}
          ${(!cargo.funcoes && !cargo.objetivos && !cargo.tarefas) ? '<div class="muted tiny">Não cadastrado no cargo. <a href="#/rh-funcoes">cadastrar →</a></div>' : ''}
          ${items.length ? `<div class="tiny muted" style="margin-top:5px">Checklist: <b>${doneN}/${items.length}</b> concluídos</div>` : ''}`, '#7c3aed')}
        ${box('🎯 Desempenho & metas', `
          <div style="font-size:22px;font-weight:800;color:#16a34a">${score != null ? score + '/' + escala : '<span style="font-size:13px;color:#94a3b8">sem avaliação</span>'}</div>
          ${prof.meta_produtividade ? `<div class="tiny"><b>Meta produtividade:</b> ${escapeHtml(prof.meta_produtividade)}</div>` : ''}
          ${prof.meta_resultado ? `<div class="tiny"><b>Meta resultado:</b> ${escapeHtml(prof.meta_resultado)}</div>` : ''}`, '#16a34a')}
        ${box('⚠️ Pontos de atenção & perfil', `
          <div class="tiny"><b>Atenção:</b> ${nl(prof.pontos_atencao)}</div>
          ${prof.perfil_comportamental ? `<div class="tiny" style="margin-top:3px"><b>Perfil:</b> ${nl(prof.perfil_comportamental)}</div>` : ''}`, '#f59e0b')}
        ${box('💬 Feedbacks', `
          ${fbs.length ? fbs.map(f => `<div class="tiny" style="border-top:1px solid var(--bd,#eee);padding:4px 0"><b>${escapeHtml(uName360(f.de_id))}:</b> ${escapeHtml(f.texto || '')}</div>`).join('') : '<span class="muted tiny">Nenhum feedback registrado.</span>'}
          <div class="tiny muted" style="margin-top:4px"><a href="#/rh-avaliacoes">abrir Avaliações & Feedbacks →</a></div>`, '#2563eb')}
        ${box('📈 PDI & ações', `
          ${plano.length ? plano.map(p => `<div class="tiny"><b>${escapeHtml(p.proximo_cargo || 'PDI')}:</b> ${escapeHtml(p.competencias || '')} <span class="muted">(${escapeHtml(p.status || '')})</span></div>`).join('') : '<span class="muted tiny">Sem plano de crescimento.</span>'}
          <div class="tiny muted" style="margin-top:4px">Ações de 1:1 em aberto: <b>${acoesAbertas}</b> · <a href="#/rh-plano">Plano de Crescimento →</a></div>`, '#0891b2')}
        ${box('💰 Comissão & Remuneração', `
          <div class="tiny"><b>Produção (VGV):</b> R$ ${money(vgv)}</div>
          ${myLvl >= 5 ? `
            <div class="tiny" style="margin-top:3px"><b>Tipo:</b> ${escapeHtml(r.tipo || '—')}</div>
            <div class="tiny"><b>Base:</b> ${r.salario_base != null ? 'R$ ' + money(r.salario_base) : '—'} ${r.comissao_pct != null ? '· <b>Comissão:</b> ' + r.comissao_pct + '%' : ''}</div>
            ${r.ajuda_custo != null ? `<div class="tiny"><b>Ajuda de custo:</b> R$ ${money(r.ajuda_custo)}</div>` : ''}
            ${r.obs ? `<div class="tiny muted">${escapeHtml(r.obs)}</div>` : ''}
            ${myLvl >= 7 ? '<button class="btn btn-ghost btn-sm mt-1" id="rh-remun-edit">✏️ Editar remuneração</button>' : ''}
          ` : '<div class="tiny muted">Remuneração: restrito à gestão.</div>'}`, '#ea580c')}
      </div>
    </div>`;
  const re = host.querySelector('#rh-remun-edit'); if (re) re.onclick = () => openRemunEditor(uid, name, r);
}
function uName360(id) { const u = (_users || []).find(x => x.id === id); return u ? (u.name || id) : (id || '—'); }
function openRemunEditor(uid, name, r) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 14px;overflow:auto';
  const TIPOS = ['CLT', 'PJ', 'Comissionado', 'CLT + comissão', 'Estágio', 'Autônomo', 'Sócio'];
  ov.innerHTML = `<div class="card" style="max-width:460px;width:100%;margin:auto">
    <div class="flex" style="justify-content:space-between;align-items:center"><h3 class="card-title" style="margin:0">💰 Remuneração — ${escapeHtml(name || '')}</h3><button class="btn btn-ghost btn-sm" id="rm-x">✕</button></div>
    <p class="tiny muted">Confidencial — visível só pra gestão (lvl≥5), editável por sócio.</p>
    <label class="tiny muted">Tipo<select id="rm-tipo" class="select"><option value="">—</option>${TIPOS.map(t => `<option${r.tipo === t ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
      <label class="tiny muted">Salário base (R$)<input id="rm-base" class="input" type="number" value="${r.salario_base ?? ''}"></label>
      <label class="tiny muted">Comissão (%)<input id="rm-com" class="input" type="number" value="${r.comissao_pct ?? ''}"></label>
    </div>
    <label class="tiny muted" style="display:block;margin-top:6px">Ajuda de custo (R$)<input id="rm-aj" class="input" type="number" value="${r.ajuda_custo ?? ''}"></label>
    <label class="tiny muted" style="display:block;margin-top:6px">Observações<textarea id="rm-obs" class="input" rows="2">${escapeHtml(r.obs || '')}</textarea></label>
    <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="rm-save">💾 Salvar</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#rm-x').onclick = () => ov.remove();
  ov.querySelector('#rm-save').onclick = async () => {
    const body = { user_id: uid, tipo: ov.querySelector('#rm-tipo').value, salario_base: ov.querySelector('#rm-base').value, comissao_pct: ov.querySelector('#rm-com').value, ajuda_custo: ov.querySelector('#rm-aj').value, obs: ov.querySelector('#rm-obs').value };
    try { const res = await api.request('/api/v3/gp/remuneracao', { method: 'POST', body }); _rh360.rem = { remuneracao: res.remuneracao }; ov.remove(); render360(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
}
