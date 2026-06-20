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
let _meet = [];                // reuniões 1:1 do corretor
let _users = [];
let _scope = 'individual';     // 'individual' | 'equipe' (só líderes têm equipe)

const PRESETS = [
  { id: 'this_month', lbl: 'Mês atual' },
  { id: 'last_30d', lbl: 'Últimos 30 dias' },
  { id: 'last_90d', lbl: 'Últimos 90 dias' },
  { id: 'this_year', lbl: 'Ano' },
];

export async function pageOO(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder ou acima.</div>'; return; }
  // deep-link vindo do Organograma
  const pre = sessionStorage.getItem('oo.open');
  if (pre) { sessionStorage.removeItem('oo.open'); _selId = pre; _view = 'detail'; }
  if (_view === 'detail' && _selId) await loadDetail();
  else await loadList();
}

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
  const gestores = cs.filter(c => c.role === 'lider');     // visão de EQUIPE
  const corretores = cs.filter(c => c.role !== 'lider');   // individual
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
          <div class="tiny muted">${escapeHtml(c.team || '—')} · ${c.role === 'lider' ? (c.is_team ? '🛡 Líder · agregado da equipe' : '🛡 Líder') : '🏠 Corretor'}</div>
        </div>
        <div style="text-align:center">${dot}<div style="font-size:10px;font-weight:700;color:${healthHex(c.health_color)}">${c.health}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;margin-bottom:8px">
        ${miniKpi('Vendas', c.vendas)} ${miniKpi('Visitas', c.visitas)} ${miniKpi('VGV', 'R$ ' + moneyShort(c.vgv))}
      </div>
      ${att != null ? `<div class="tiny muted" style="margin-bottom:2px">Meta VGV: <b>${att}%</b></div>${attBar}` : '<div class="tiny muted">Sem meta no período</div>'}
      ${alerts ? `<div style="margin-top:6px">${alerts}</div>` : ''}
      ${c.proxima_oo ? `<div class="tiny muted" style="margin-top:6px">📅 Próxima 1:1: ${fmtD(c.proxima_oo)}</div>` : (c.last_oo ? `<div class="tiny muted" style="margin-top:6px">Última 1:1: ${fmtD(c.last_oo)}</div>` : '<div class="tiny" style="color:#d97706;margin-top:6px">Sem 1:1 registrada</div>')}
    </div>`;
}

/* ───────────────────────── DETALHE ───────────────────────── */
async function loadDetail() {
  _view = 'detail';
  _root.innerHTML = spinner('Carregando cockpit do corretor…');
  try {
    const [d, m, u] = await Promise.all([
      api.request('/api/v3/oo/corretor?corretor_id=' + encodeURIComponent(_selId) + '&' + ooQP()),
      api.request('/api/v3/oo/list?corretor_id=' + encodeURIComponent(_selId)).catch(() => ({ items: [] })),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _det = d; _meet = m.items || []; if (u.users) _users = u.users;
    _scope = (d.team && d.team.metrics) ? 'equipe' : 'individual';  // líder abre na visão de equipe
    renderDetail();
  } catch (e) { _root.innerHTML = err(e.message); }
}

function renderDetail() {
  const d = _det, c = d.corretor;
  // Líder/gestor = cockpit de GESTÃO da equipe (não é avaliado como corretor).
  if ((c.role || '') === 'lider' && d.team && d.team.metrics) { renderGestor(d, c); return; }
  // Corretor = cockpit individual.
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
        <button class="btn btn-ghost" id="oo-back">← Corretores</button>
        ${periodSel()}
        <button class="btn btn-primary" id="oo-new" style="margin-left:auto">+ Reunião 1:1</button>
      </div>
      ${detailHeader(d, c)}
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:14px;align-items:start">
        <div>${funnelPanel(d)}</div>
        <div>${kpiVsMeta(d)}</div>
      </div>
      <div style="margin-top:14px">${efficiencyPanel(d)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:14px">
        ${ratesPanel(d)}
        ${originPanel(d)}
        ${lossPanel(d)}
      </div>
      ${trendPanel(d, escapeHtml(c.name))}
      ${meetingsPanel()}
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
        ${saudeEquipePanel(t)}
        ${kpiVsMeta(M)}
      </div>
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

function wireDetailCommon() {
  document.getElementById('oo-back').addEventListener('click', () => loadList());
  document.getElementById('oo-new').addEventListener('click', () => openMeeting());
  wirePeriod(loadDetail);
  _root.querySelectorAll('[data-member]').forEach(el => el.addEventListener('click', () => { _selId = el.dataset.member; loadDetail(); }));
  _root.querySelectorAll('[data-meet]').forEach(el => el.addEventListener('click', () => openMeeting(parseInt(el.dataset.meet))));
  _root.querySelectorAll('[data-pdi]').forEach(el => el.addEventListener('change', () => togglePdi(parseInt(el.dataset.pdi), parseInt(el.dataset.idx), el.checked)));
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
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900;color:${healthHex(hc)}">${att != null ? att + '%' : '—'}</div><div class="tiny muted">meta VGV equipe</div></div>
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
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)"><div style="font-size:24px;font-weight:900;color:${healthHex(hc)}">${att != null ? att + '%' : '—'}</div><div class="tiny muted">meta VGV equipe</div></div>
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
        <td style="text-align:right">${m.win_rate != null ? m.win_rate + '%' : '—'}</td>
        <td style="text-align:right">${m.meta_attainment_pct != null ? m.meta_attainment_pct + '%' : '—'}</td>
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
        <div class="tiny muted">${escapeHtml(c.team || '—')} · ${c.role === 'lider' ? '🛡 Líder' : '🏠 Corretor'} · período ${fmtD(d.period.since)}–${fmtD(d.period.until)}</div>
      </div>
      <div style="text-align:center;padding:0 10px">
        <div style="font-size:34px;line-height:1">${healthEmoji(hc)}</div>
        <div style="font-size:11px;font-weight:800;color:${healthHex(hc)}">SAÚDE ${d.health}/100</div>
      </div>
      <div style="text-align:center;padding:0 10px;border-left:1px solid var(--border)">
        <div style="font-size:24px;font-weight:900;color:${healthHex(hc)}">${att != null ? att + '%' : '—'}</div>
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
    `<span title="conversão da etapa anterior" style="font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:999px;background:${c>=50?'rgba(22,163,74,.15)':c>=25?'rgba(217,119,6,.15)':'rgba(220,38,38,.15)'};color:${c>=50?'#16a34a':c>=25?'#d97706':'#dc2626'}">↓ ${c}%</span>`;
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
    <td style="text-align:right;padding:4px 6px;font-weight:800;color:${(s.conv_from_prev||0)>=50?'#16a34a':(s.conv_from_prev||0)>=25?'#d97706':'#dc2626'}">${s.conv_from_prev != null ? s.conv_from_prev + '%' : '—'}</td>
  </tr>`).filter(Boolean).join('');
  const first = stages[0]?.n || 0, last = stages[stages.length-1]?.n || 0;
  const overall = first ? round1(last / first * 100) : null;
  return `<table style="width:100%;font-size:11.5px;border-collapse:collapse;margin-top:8px">
    <thead><tr style="color:var(--ink-muted);font-size:10.5px"><th style="text-align:left;padding:4px 6px">Conversão por etapa</th><th style="text-align:right;padding:4px 6px">taxa</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border)"><td style="padding:5px 6px;font-weight:700">${escapeHtml(stages[0]?.name||stages[0]?.label||'')} → ${escapeHtml(stages[stages.length-1]?.name||'')}</td><td style="text-align:right;padding:5px 6px;font-weight:900;color:#2563eb">${overall != null ? overall + '%' : '—'}</td></tr></tfoot>
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
      `<div class="tiny muted" style="margin-top:6px">Etapas reais do RD · ↓ = taxa de conversão da etapa anterior · win rate geral: <b>${d.win_rate != null ? d.win_rate + '%' : '—'}</b></div>`
    )).join('<div style="height:12px"></div>');
  }
  // fallback: marcos canônicos
  const f = d.funnel || [];
  return panel('🫧 Funil individual', funnelBars(f, s => escapeHtml(s.label)) + convTable(f) +
    `<div class="tiny muted" style="margin-top:6px">↓ = taxa de conversão da etapa anterior. Win rate: <b>${d.win_rate != null ? d.win_rate + '%' : '—'}</b></div>`);
}

function kpiVsMeta(d) {
  const m = d.meta;
  // realNum = valor numérico (pro %); disp = texto exibido
  const row = (lbl, realNum, meta, disp) => {
    const pct = meta > 0 ? Math.round(realNum / meta * 100) : null;
    const col = pct == null ? '#64748b' : (pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626');
    return `<div style="margin-bottom:7px">
      <div class="flex items-center" style="justify-content:space-between;font-size:12px"><span>${lbl}</span><span><b>${disp != null ? disp : realNum}</b>${meta>0?` / ${meta}`:''} ${pct!=null?`<span style="color:${col};font-size:11px;font-weight:700">${pct}%</span>`:''}</span></div>
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

function efficiencyPanel(d) {
  const fc = d.primeiro_contato_h;
  const fcTxt = fc == null ? '—' : (fc < 1 ? Math.round(fc * 60) + ' min' : fc.toFixed(1) + ' h');
  return panel('⚡ Eficiência & custo', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px">
      ${stat('🎟 Ticket médio', d.ticket_medio != null ? 'R$ ' + moneyShort(d.ticket_medio) : '—', '#0ea5e9')}
      ${stat('👀 Visitas/venda', d.visitas_por_venda != null ? d.visitas_por_venda : '—', '#22d3ee', null, 'Quantas visitas até 1 venda')}
      ${stat('📞 Atend./venda', d.atend_por_venda != null ? d.atend_por_venda : '—', '#60a5fa', null, 'Atendimentos até 1 venda')}
      ${stat('📆 Dias/venda', d.dias_por_venda != null ? d.dias_por_venda + ' d' : '—', '#a78bfa', null, 'Ritmo: dias do período por venda')}
      ${stat('🎯 Qualificação', d.qualificacao_rate != null ? d.qualificacao_rate + '%' : '—', '#16a34a', null, 'Leads que passaram da qualificação')}
      ${stat('🔁 Follow-up', d.followup_rate != null ? d.followup_rate + '%' : '—', '#f59e0b', null, 'Leads com +1 interação no RD')}
      ${stat('🕰 Estagnação', d.estagnacao_dias != null ? Math.round(d.estagnacao_dias) + ' d' : '—', '#ef4444', null, 'Mediana de dias sem atividade (abertos)')}
      ${stat('💸 Invest. leads', d.lead_invest != null ? 'R$ ' + moneyShort(d.lead_invest) : '—', '#fb7185', null, d.cpl_global != null ? ('CPL R$ ' + money(d.cpl_global) + ' × leads') : 'Sem gasto Meta no cache')}
    </div>`);
}

function ratesPanel(d) {
  const fc = d.primeiro_contato_h;
  const fcTxt = fc == null ? '—' : (fc < 1 ? Math.round(fc * 60) + ' min' : fc.toFixed(1) + ' h');
  return panel('⏱ Taxas & Tempos', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${stat('Win rate', d.win_rate != null ? d.win_rate + '%' : '—', '#16a34a')}
      ${stat('Taxa descarte', d.descarte_rate != null ? d.descarte_rate + '%' : '—', '#dc2626')}
      ${stat('1º contato', fcTxt, '#2563eb', d.primeiro_contato_basis === 'real' ? 'real' : 'sem evento')}
      ${stat('Ciclo médio', d.ciclo_medio_dias != null ? d.ciclo_medio_dias + ' d' : '—', '#7c3aed')}
      ${stat('Lixo/descarte', d.trash_rate != null ? d.trash_rate + '%' : '—', '#64748b')}
      ${stat('Parados +14d', d.pendencias.parados_14d, '#d97706')}
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
  return (_since && _until)
    ? ('since=' + encodeURIComponent(_since) + '&until=' + encodeURIComponent(_until))
    : ('date_preset=' + encodeURIComponent(_preset));
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
function panel(title, inner) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">${title}</div>${inner}</div>`;
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
function money(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function moneyShort(v) { v = v || 0; if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(0) + 'k'; return money(v); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
