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

export async function pageDashboard(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando KPIs…</div></div>';
  const isGestor = (auth.user()?.lvl || 0) >= 5;
  try {
    const calls = [api.request('/api/v3/metrics/overview')];
    // Ranking de vendas real (mês) — só gestor (o endpoint exige lvl>=5)
    if (isGestor) calls.push(api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null));
    const [d, oo] = await Promise.all(calls);
    _data = d;
    _board = oo;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
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
