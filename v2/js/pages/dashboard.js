/* ============================================================================
   PSM-OS v2 — Dashboard (cockpit executivo, role-based)
   Porta de entrada: KPIs reais de vendas/meta/pipeline + ranking de vendas do
   mês (dado real do RD via OO) + comissões. Sem ruído de sistema/dev.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const SCOPE_LBL = {
  global: '👁 Visão global (Sócio/Gerente)',
  team:   '👥 Sua equipe (Líder)',
  self:   '👤 Seus dados',
};

let _root = null;
let _data = null;
let _board = null; // ranking de vendas (gestores)
let _feed = [];        // central do usuário (agenda + tarefas + tudo)
let _feedCounts = {};
let _feedProd = {};    // produtividade (concluídas/solicitadas/atrasadas)
let _feedRole = '';    // cargo (corretor é exceção da produtividade)
let _plOffset = 0;     // mês do planner (0 = atual)

export async function pageDashboard(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando seu painel…</div></div>';
  const isGestor = (auth.user()?.lvl || 0) >= 5;
  try {
    const calls = [
      api.request('/api/v3/metrics/overview'),
      api.request('/api/v3/tasks/feed').catch(() => ({ items: [], counts: {} })),
    ];
    // Ranking de vendas real (mês) — só gestor (o endpoint exige lvl>=5)
    if (isGestor) calls.push(api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null));
    const [d, f, oo] = await Promise.all(calls);
    _data = d;
    _feed = (f && f.items) || [];
    _feedCounts = (f && f.counts) || {};
    _feedProd = (f && f.prod) || {};
    _feedRole = (f && f.role) || (auth.user()?.role) || '';
    _board = oo;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function _todayBRT() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }

/* ═══ PLANO DO MÊS — cockpit pessoal (metas + produtividade + planner + 4W) ═══ */
const ORIG_COR = { 'Tarefa': '#2563eb', 'Agenda': '#0891b2', 'Academy': '#7c3aed', 'Projeto': '#f59e0b', 'Captação': '#16a34a', 'One-on-One': '#d6249f', 'Plantão': '#64748b' };
const corOrigem = o => ORIG_COR[o] || '#64748b';
const _ymOffset = off => { const n = new Date(Date.now() - 3 * 3600 * 1000); return new Date(n.getFullYear(), n.getMonth() + off, 1); };

const PLANNER_CSS = `<style>
/* cabeçalho de card do cockpit */
.ck-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.ck-title{font-size:16px;font-weight:800;margin:0;display:flex;align-items:center;gap:7px}
.ck-spacer{flex:1}
.ck-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;white-space:nowrap}
/* lista executiva — O QUE / QUANDO / COMO / QUEM */
.exec-wrap{overflow-x:auto;border:1px solid var(--bd);border-radius:12px}
.exec-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.exec-tbl thead th{text-align:left;padding:10px 12px;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-muted,#94a3b8);background:var(--bg-3);font-weight:800;white-space:nowrap}
.exec-tbl td{padding:9px 12px;border-top:1px solid var(--bd);vertical-align:top}
.exec-tbl tbody tr{transition:background .15s}
.exec-tbl tbody tr:hover{background:var(--bg-3)}
.exec-task{font-weight:700;text-decoration:none;color:inherit;display:flex;align-items:center;gap:6px}
.exec-origin{display:inline-block;font-size:9.5px;font-weight:800;padding:1px 8px;border-radius:999px;margin-top:4px}
.exec-when{font-weight:800;font-size:12px;white-space:nowrap}
.exec-sub{font-size:12px;color:var(--ink-muted,#64748b);max-width:320px}
.exec-quem{font-size:12px;font-weight:600;white-space:nowrap}
/* gauges (% meta / % produtividade) */
.gz{flex:1;min-width:230px;background:var(--bg-1,#fff);border:1px solid var(--bd);border-radius:14px;padding:15px 17px}
.gz-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.gz-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:800;color:var(--ink-muted,#94a3b8)}
.gz-pct{font-size:28px;font-weight:900;line-height:1}
.gz-track{height:10px;border-radius:6px;background:rgba(148,163,184,.18);overflow:hidden;margin-top:10px}
.gz-fill{height:100%;border-radius:6px;transition:width .4s}
.gz-sub{font-size:11px;color:var(--ink-muted,#94a3b8);margin-top:7px}
/* planner mensal */
.pl-head{display:flex;align-items:center;justify-content:center;gap:16px;margin:4px 0 10px}
.pl-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.pl-wd{text-align:center;font-size:10px;font-weight:800;color:var(--ink-muted,#94a3b8);text-transform:uppercase;padding-bottom:2px}
.pl-cell{min-height:82px;background:var(--bg-3);border:1px solid transparent;border-radius:10px;padding:5px 5px 4px;overflow:hidden}
.pl-empty{background:transparent;border:none}
.pl-today{border-color:#2563eb;background:rgba(37,99,235,.07)}
.pl-dn{font-size:11px;font-weight:800;color:var(--ink-muted,#94a3b8);margin-bottom:3px;text-align:right;padding-right:2px}
.pl-today .pl-dn{color:#2563eb}
.pl-ev{display:block;font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:5px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}
.pl-more{font-size:9px;color:var(--ink-muted,#94a3b8);font-weight:700;padding-left:3px}
</style>`;

function gauge(label, pct, sub, cor) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="gz" style="border-color:${cor}55">
    <div class="gz-top"><span class="gz-lbl">${label}</span><span class="gz-pct" style="color:${cor}">${pct == null ? '—' : pct + '%'}</span></div>
    <div class="gz-track"><div class="gz-fill" style="width:${p}%;background:${cor}"></div></div>
    <div class="gz-sub">${sub || ''}</div></div>`;
}
function miniMetric(label, big, sub, cor) {
  return `<div style="flex:1;min-width:160px;background:var(--bg-3);border-radius:14px;padding:14px 16px;border-left:4px solid ${cor}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:800">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${cor};margin-top:2px">${big}</div><div class="tiny muted">${sub || ''}</div></div>`;
}

function metricsRow() {
  const d = _data || {};
  const isCorretor = (_feedRole || '').toLowerCase() === 'corretor';
  const metaVgv = d.metas?.meta_vgv || 0, vgvMes = d.sales?.vgv_mes || 0;
  const metaPct = metaVgv > 0 ? Math.round(vgvMes / metaVgv * 100) : null;
  const prod = _feedProd || {};
  const cards = [];
  if (metaPct !== null) cards.push(gauge('🎯 Meta do mês', metaPct, `R$ ${fmtKM(vgvMes)} de R$ ${fmtKM(metaVgv)}`, metaPct >= 100 ? '#16a34a' : metaPct >= 70 ? '#d4a843' : '#dc2626'));
  if (isCorretor) {
    cards.push(miniMetric('💰 VGV no mês', 'R$ ' + fmtKM(vgvMes), `${d.sales?.vendas_mes || 0} venda(s)`, '#16a34a'));
    cards.push(miniMetric('📈 Pipeline', 'R$ ' + fmtKM(d.sales?.pipeline_vgv), `${d.sales?.pipeline_count || 0} aberto(s)`, '#3b82f6'));
  } else {
    const pct = prod.pct;
    const sub = prod.solicitadas != null && prod.solicitadas > 0
      ? `${prod.concluidas || 0}/${prod.solicitadas} concluídas · ${prod.atrasadas || 0} atrasada(s)`
      : 'sem tarefas atribuídas ainda';
    cards.push(gauge('⚡ Produtividade', pct, sub, pct == null ? '#94a3b8' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d4a843' : '#dc2626'));
  }
  return `<div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">${cards.join('')}</div>`;
}

function plannerMensal() {
  const base = _ymOffset(_plOffset), y = base.getFullYear(), m = base.getMonth();
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`, today = _todayBRT();
  const byDay = {};
  (_feed || []).forEach(i => { if (i.data && i.data.slice(0, 7) === ym) (byDay[i.data] = byDay[i.data] || []).push(i); });
  const startDow = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][m];
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="pl-cell pl-empty"></div>';
  for (let dn = 1; dn <= days; dn++) {
    const ds = `${ym}-${String(dn).padStart(2, '0')}`, its = byDay[ds] || [], isT = ds === today;
    cells += `<div class="pl-cell${isT ? ' pl-today' : ''}"><div class="pl-dn">${dn}</div>`
      + its.slice(0, 3).map(i => `<a href="${i.link}" class="pl-ev" title="${escapeHtml((i.titulo || '') + ' — ' + (i.quem || ''))}" style="background:${corOrigem(i.origem)}22;color:${corOrigem(i.origem)}">${(i.ico || '')} ${escapeHtml((i.titulo || '').substring(0, 14))}</a>`).join('')
      + (its.length > 3 ? `<div class="pl-more">+${its.length - 3}</div>` : '') + `</div>`;
  }
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<div class="pl-wd">${d}</div>`).join('');
  return `<div class="pl-head"><button class="btn btn-ghost tiny" data-pl-nav="-1">‹ mês</button><b style="font-size:14px;min-width:150px;text-align:center">${MES} ${y}</b><button class="btn btn-ghost tiny" data-pl-nav="1">mês ›</button></div>
    <div class="pl-grid">${WD}</div>
    <div class="pl-grid" style="margin-top:4px">${cells}</div>`;
}

function listaExec() {
  const hoje = _todayBRT();
  const pend = (_feed || []).filter(i => !i.done).sort((a, b) => (a.data || '9999') < (b.data || '9999') ? -1 : 1);
  if (!pend.length) return `<div class="exec-wrap" style="padding:28px;text-align:center">
    <div style="font-size:28px">🎉</div>
    <div class="muted tiny" style="margin-top:4px">Nada pendente pra você agora. Tudo em dia!</div></div>`;
  const rows = pend.slice(0, 40).map(i => {
    const overdue = i.data && i.data < hoje, eh = i.data === hoje;
    const cor = corOrigem(i.origem);
    const dia = i.data ? i.data.split('-').reverse().slice(0, 2).join('/') : 'sem data';
    const badge = overdue ? ` <span style="color:#dc2626">⚠ atrasado</span>` : eh ? ` <span style="color:#16a34a">• hoje</span>` : '';
    const qcor = overdue ? '#dc2626' : eh ? '#16a34a' : 'var(--ink,#0f172a)';
    return `<tr>
      <td style="border-left:3px solid ${cor}">
        <a href="${i.link}" class="exec-task">${i.ico || ''} <span>${escapeHtml(i.titulo || '')}</span></a>
        <span class="exec-origin" style="background:${cor}1f;color:${cor}">${escapeHtml(i.origem)}</span>
      </td>
      <td class="exec-when" style="color:${qcor}">${dia}${badge}</td>
      <td class="exec-sub">${escapeHtml((i.sub || '—').substring(0, 100))}</td>
      <td class="exec-quem">${escapeHtml(i.quem || '—')}</td>
    </tr>`;
  }).join('');
  return `<div class="exec-wrap"><table class="exec-tbl">
    <thead><tr><th>🎯 O que fazer</th><th>📅 Quando</th><th>🛠 Como</th><th>👤 Quem</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${pend.length > 40 ? `<div class="tiny muted" style="margin-top:8px;text-align:right">+${pend.length - 40} item(ns) — <a href="#/tarefas">ver todas</a></div>` : ''}`;
}

// CARD 1 — ✅ TAREFAS & PENDÊNCIAS (ação primeiro: o que fazer / quando / como / quem)
function tarefasCard() {
  const c = _feedCounts || {};
  const chip = (n, lbl, cor) => `<span class="ck-chip" style="background:${cor}1a;color:${cor}">${n} ${lbl}</span>`;
  return `${PLANNER_CSS}
    <div class="card mt-4">
      <div class="ck-head">
        <h3 class="ck-title">✅ Tarefas &amp; pendências</h3>
        <span class="ck-spacer"></span>
        ${c.atrasados ? chip(c.atrasados, 'atrasada(s)', '#dc2626') : ''}
        ${c.hoje ? chip(c.hoje, 'hoje', '#16a34a') : ''}
        ${chip(c.pendentes || 0, 'pendente(s)', '#64748b')}
        <a href="#/agenda" class="btn btn-ghost tiny">📅 Agenda</a>
        <a href="#/tarefas" class="btn btn-ghost tiny">🗂 Ver tudo</a>
      </div>
      <p class="tiny muted" style="margin:-4px 0 12px">Tudo que é seu pra fazer — de qualquer aba — num lugar só: <b>o que fazer</b>, <b>quando</b>, <b>como</b> e <b>quem</b>.</p>
      ${listaExec()}
    </div>`;
}

// CARD 2 — 🗓 PLANO DO MÊS (% da meta + % de produtividade + cronograma mensal)
function planoMesCard() {
  return `
    <div class="card mt-4">
      <div class="ck-head">
        <h3 class="ck-title">🗓 Plano do mês</h3>
        <span class="ck-spacer"></span>
        <span class="tiny muted">% da meta · % de produtividade · cronograma</span>
      </div>
      ${metricsRow()}
      ${plannerMensal()}
    </div>`;
}

function render() {
  const me = auth.user();
  const d = _data || {};
  const hasFunis = (d.pipelines?.count_total || 0) > 0;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👋 Olá, ${escapeHtml(me.name || '')}</h2>
      <p class="card-sub">
        ${SCOPE_LBL[d.scope] || ''} ·
        <span class="tiny muted">Atualizado ${new Date().toLocaleString('pt-BR')}</span>
      </p>

      <!-- HERO KPIs — VENDAS + META -->
      <div class="flex gap-3 mt-4" style="flex-wrap:wrap">
        ${heroKpi('💰 VGV no Mês',  'R$ ' + fmtKM(d.sales?.vgv_mes), `${d.sales?.vendas_mes || 0} venda(s) fechada(s)`,          '#16a34a')}
        ${heroKpi('🎯 Meta do Mês', 'R$ ' + fmtKM(d.metas?.meta_vgv), pctMeta(d.sales?.vgv_mes, d.metas?.meta_vgv),               '#d4a843')}
        ${heroKpi('📈 Pipeline',    'R$ ' + fmtKM(d.sales?.pipeline_vgv), `${d.sales?.pipeline_count || 0} negócios abertos`,    '#3b82f6')}
        ${heroKpi('🏆 Ticket Médio','R$ ' + fmtKM(d.sales?.ticket_medio_mes), 'média da venda no mês',                             '#8b5cf6')}
      </div>

      <!-- ✅ TAREFAS & PENDÊNCIAS primeiro (ação) · depois 🗓 PLANO DO MÊS (metas/prod + planner) -->
      ${tarefasCard()}
      ${planoMesCard()}

      <!-- KPIs SECUNDÁRIOS -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpiCard('💰 VGV 30 dias',  'R$ ' + fmtKM(d.sales?.vgv_30d),    `${d.sales?.vendas_30d || 0} vendas`,                  '#16a34a')}
        ${kpiCard('💎 VGV no Ano',   'R$ ' + fmtKM(d.sales?.vgv_ano),    `${d.sales?.vendas_ano || 0} vendas no ano`,           '#0891b2')}
        ${kpiCard('❌ Perdidos mês', 'R$ ' + fmtKM(d.sales?.vgv_perdido_mes), `${d.sales?.perdidos_mes || 0} oportunidades`,    '#dc2626')}
        ${kpiCard('📋 Tarefas',      fmtNum(d.tasks?.pending),          `${d.tasks?.done || 0} feitas / ${d.tasks?.total || 0} total`, '#f59e0b')}
      </div>

      <!-- KPIs DE APOIO (limpos, sem ruído de sistema) -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpiCard('👥 Equipe',    fmtNum(d.users?.total),         `${d.users?.ativos || 0} ativos`,         '#2563eb')}
        ${kpiCard('💎 Comissões', 'R$ ' + fmtKM(d.commissions?.valor_pendente), `${d.commissions?.pendentes || 0} a pagar`, '#7c3aed')}
        ${hasFunis ? kpiCard('🔗 Funis RD', fmtNum(d.pipelines?.count_active), `de ${d.pipelines?.count_total} ativos`, '#0d9488') : ''}
      </div>

      <!-- DISTRIBUIÇÃO POR EQUIPE -->
      ${(d.users?.by_team && Object.keys(d.users.by_team).length > 1) ? `
      <div class="card mt-4">
        <h3 class="card-title">👥 Distribuição por equipe</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${Object.entries(d.users.by_team).map(([t, n]) => teamChip(t, n)).join('')}
        </div>
      </div>` : ''}

      <!-- 🏆 RANKING DE VENDAS DO MÊS (dado real do RD, só gestor) -->
      ${salesBoard()}

      <!-- 💎 COMISSÕES -->
      ${(d.commissions?.count || 0) > 0 ? `
        <div class="card mt-4">
          <h3 class="card-title">💎 Resumo de Comissões</h3>
          <div class="flex gap-3" style="flex-wrap:wrap">
            ${kpiMini('Total registrado', 'R$ ' + fmtMoney(d.commissions.valor_total))}
            ${kpiMini('Pendente',          'R$ ' + fmtMoney(d.commissions.valor_pendente), '#d97706')}
            ${kpiMini('# pagas',           d.commissions.pagas, '#16a34a')}
            ${kpiMini('# pendentes',       d.commissions.pendentes, '#d97706')}
          </div>
        </div>
      ` : ''}

      <!-- atalhos -->
      <div class="card mt-4">
        <h3 class="card-title">⚡ Atalhos</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${shortcut('🔗 CRM (RD)', '#/crm')}
          ${shortcut('🎯 Cérebro de Vendas', '#/cerebro-vendas')}
          ${shortcut('📥 Captações', '#/captacoes')}
          ${shortcut('💰 Financeiro', '#/financeiro')}
          ${shortcut('📊 Metas', '#/metas')}
          ${shortcut('👥 One-on-One', '#/one-on-one')}
        </div>
      </div>
    </div>
  `;
  // navegação do planner mensal (‹ mês ›)
  _root.querySelectorAll('[data-pl-nav]').forEach(b => b.addEventListener('click', () => {
    _plOffset += parseInt(b.dataset.plNav, 10) || 0;
    render();
  }));
}

/* ─── Ranking de vendas do mês (real, via OO) ─── */
function salesBoard() {
  if ((auth.user()?.lvl || 0) < 5) return ''; // corretor não vê ranking de todos
  if (!_board) return '';
  const all = (_board.corretores || []).filter(c => !c.is_team);
  if (!all.length) return '';
  const ranked = all.slice().sort((a, b) => (b.vgv || 0) - (a.vgv || 0) || (b.vendas || 0) - (a.vendas || 0));
  const comVenda = ranked.filter(c => (c.vendas || 0) > 0);
  const lista = (comVenda.length ? comVenda : ranked).slice(0, 8);
  const totalVgv = ranked.reduce((s, c) => s + (c.vgv || 0), 0);
  const totalVendas = ranked.reduce((s, c) => s + (c.vendas || 0), 0);
  return `
    <div class="card mt-4">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h3 class="card-title" style="flex:1;min-width:200px">🏆 Ranking de Vendas — mês</h3>
        <span class="tiny muted">${totalVendas} venda(s) · R$ ${fmtKM(totalVgv)} VGV no time</span>
      </div>
      ${comVenda.length === 0 ? '<div class="muted tiny" style="margin-top:6px">Ainda sem vendas fechadas neste mês — ranking por pipeline/atividade aparece aqui assim que fechar a primeira.</div>' : ''}
      <div style="display:grid;gap:6px;margin-top:8px">
        ${lista.map((c, i) => salesRow(c, i)).join('')}
      </div>
    </div>`;
}

function salesRow(c, i) {
  const ini = escapeHtml((c.ini || (c.name || '?').substring(0, 2)).toUpperCase());
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
  return `
    <div style="display:grid;grid-template-columns:34px 30px 1fr auto auto;gap:10px;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:13px">
      <div style="font-size:16px;text-align:center">${medal}</div>
      <div style="width:28px;height:28px;border-radius:50%;background:${c.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${ini}</div>
      <div style="min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name || '—')}</div><div class="tiny muted">${escapeHtml(c.team || 'geral')}</div></div>
      <div style="text-align:right"><div class="tiny muted">vendas</div><div style="font-weight:800;color:#2563eb">${c.vendas || 0}</div></div>
      <div style="text-align:right"><div class="tiny muted">VGV</div><div style="font-weight:900;color:#16a34a">R$ ${fmtKM(c.vgv)}</div></div>
    </div>`;
}

function shortcut(label, href) {
  return `<a href="${href}" class="btn btn-ghost" style="font-size:13px">${label}</a>`;
}

/* ─── KPI helpers ─── */
function kpiCard(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:28px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
      <div class="tiny muted">${sub || ''}</div>
    </div>
  `;
}

function heroKpi(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:200px;background:linear-gradient(135deg, ${color}22, ${color}05);border:1px solid ${color}44;border-radius:var(--r-md);padding:16px 18px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:30px;font-weight:900;color:${color};margin-top:4px;line-height:1.1">${big ?? '—'}</div>
      <div class="tiny muted" style="margin-top:2px">${sub || ''}</div>
    </div>
  `;
}

function pctMeta(real, meta) {
  if (!meta || meta <= 0) return 'meta não definida';
  const pct = Math.round((real || 0) / meta * 100);
  const emoji = pct >= 100 ? '🟢' : pct >= 70 ? '🟡' : '🔴';
  return `${emoji} ${pct}% atingido`;
}

function fmtKM(n) {
  if (n == null) return '0';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
  return Math.round(v).toLocaleString('pt-BR');
}

function kpiMini(label, value, color) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:140px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
      <div style="font-size:18px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
    </div>
  `;
}

function teamChip(team, n) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-full);padding:6px 14px;font-size:12px;font-weight:600">
      ${escapeHtml(team)} <span class="muted">·</span> <b>${n}</b>
    </div>
  `;
}

function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function fmtMoney(n) {
  if (n == null) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
