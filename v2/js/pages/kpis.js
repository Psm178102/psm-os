/* ============================================================================
   PSM-OS v2 — KPIs Executivos (cockpit estratégico · dado REAL)
   ----------------------------------------------------------------------------
   Fontes (campos REAIS, conferidos ao vivo):
     • /api/v3/metas/atingimento → totals{atingido_vgv, meta_vgv, pct, vendas_count}
       + grid[]{user, totals{atingido_vgv, meta_vgv, pct, status}} (atingimento ANUAL por corretor)
     • /api/v3/metrics/overview  → sales{pipeline_vgv, pipeline_count, perdidos_mes,
       vgv_perdido_mes, vgv_30d, vendas_30d, ticket_medio_mes, vgv_ano, vendas_ano} + users
     • /api/v3/finance/dre       → totals{receita, despesa, saldo} (NIBO; degrada se ok:false)
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _d = null;

export async function pageKpis(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+).</div>';
    return;
  }
  render();
  await load();
}

async function load() {
  try {
    const [atg, ov, dre] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/metrics/overview').catch(() => ({})),
      api.request('/api/v3/finance/dre').catch(() => ({ ok: false })),
    ]);
    _d = { atg, ov, dre };
    renderContent();
  } catch (e) {
    document.getElementById('kpi-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📊 KPIs Executivos</h2>
      <p class="card-sub">Visão estratégica consolidada (ano corrente) — vendas, meta, pipeline, conversão, equipe e financeiro. Dados reais do RD + metas + NIBO.</p>
      <div id="kpi-body" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Calculando KPIs…</div></div>
    </div>
  `;
}

function renderContent() {
  const { atg, ov, dre } = _d;
  const T = atg.totals || {};
  const sales = ov.sales || {};
  const users = ov.users || {};

  // ── Vendas & Meta (ANO) ──
  const metaVGV = +T.meta_vgv || 0;
  const realVGV = +T.atingido_vgv || 0;
  const vendas = +T.vendas_count || 0;
  const pctMeta = metaVGV > 0 ? (realVGV / metaVGV * 100) : 0;
  const gap = Math.max(metaVGV - realVGV, 0);
  const ticketMedio = vendas > 0 ? realVGV / vendas : 0;

  // Projeção do ano por run-rate (dia do ano corrido)
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const fracAno = Math.max(dayOfYear / 365, 0.01);
  const projAno = realVGV / fracAno;
  const pctProj = metaVGV > 0 ? (projAno / metaVGV * 100) : 0;

  // ── Pipeline & Funil (overview) ──
  const pipeVgv = +sales.pipeline_vgv || 0;
  const pipeCount = +sales.pipeline_count || 0;
  const ticketPipe = pipeCount > 0 ? pipeVgv / pipeCount : 0;
  const cobertura = gap > 0 ? pipeVgv / gap : null; // ×
  const perdMes = +sales.perdidos_mes || 0;
  const perdVgvMes = +sales.vgv_perdido_mes || 0;
  const vgv30 = +sales.vgv_30d || 0;
  const vendas30 = +sales.vendas_30d || 0;

  // ── Equipe (grid de atingimento anual) ──
  const grid = (atg.grid || []).filter(g => (+(g.totals?.meta_vgv) || 0) > 0); // só quem tem meta
  const pctOf = g => { const m = +(g.totals?.meta_vgv) || 0; return m > 0 ? (+(g.totals?.atingido_vgv) || 0) / m * 100 : 0; };
  const comMeta = grid.length;
  const batendo = grid.filter(g => pctOf(g) >= 100).length;
  const critico = grid.filter(g => pctOf(g) < 50).length;
  const caminho = comMeta - batendo - critico;
  const ativos = +users.ativos || 0;

  // ── Financeiro (NIBO) ──
  const dreOk = dre && dre.ok !== false && dre.totals;
  const dT = dre?.totals || {};
  const receita = +dT.receita || 0, despesa = +dT.despesa || 0, saldo = (receita - despesa);
  const margem = receita > 0 ? (saldo / receita * 100) : 0;
  const niboVazio = !dreOk || (receita === 0 && despesa === 0);

  document.getElementById('kpi-body').innerHTML = `
    <!-- Vendas & Meta -->
    ${secTitle('📈 Vendas & Meta · ano')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-bottom:18px">
      ${kpi('💰', 'VGV Realizado', fmtKM(realVGV), pctMeta.toFixed(1) + '% da meta', semStatus(pctMeta, [50, 80, 100]))}
      ${kpi('🎯', 'Meta do Ano', fmtKM(metaVGV), gap > 0 ? 'Falta ' + fmtKM(gap) : '✓ Batida', '#d4a843')}
      ${kpi('📊', 'Atingimento', pctMeta.toFixed(1) + '%', `${vendas} venda(s) no ano`, semStatus(pctMeta, [50, 80, 100]))}
      ${kpi('🏆', 'Ticket Médio', fmtKM(ticketMedio), 'por venda fechada', '#22c55e')}
      ${kpi('🔮', 'Projeção Ano', fmtKM(projAno), `~${pctProj.toFixed(0)}% da meta no ritmo`, pctProj >= 100 ? '#22c55e' : pctProj >= 80 ? '#f59e0b' : '#ef4444')}
    </div>

    <!-- Pipeline & Funil -->
    ${secTitle('🔻 Pipeline & Conversão')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-bottom:18px">
      ${kpi('💼', 'Pipeline Aberto', fmtNum(pipeCount), fmtKM(pipeVgv) + ' em jogo', '#3b82f6')}
      ${kpi('🎟', 'Ticket Pipeline', fmtKM(ticketPipe), 'média por negócio', '#a855f7')}
      ${kpi('🛡', 'Cobertura da Meta', cobertura == null ? '✓' : cobertura.toFixed(1) + '×', cobertura == null ? 'meta batida' : 'pipeline ÷ gap', cobertura == null ? '#22c55e' : (cobertura >= 3 ? '#22c55e' : cobertura >= 1.5 ? '#f59e0b' : '#ef4444'))}
      ${kpi('❌', 'Perdas (mês)', fmtNum(perdMes), fmtKM(perdVgvMes) + ' perdidos', perdMes > 0 ? '#ef4444' : '#22c55e')}
      ${kpi('⚡', 'Momentum 30d', fmtKM(vgv30), `${vendas30} venda(s) / 30 dias`, '#0891b2')}
    </div>

    <!-- Equipe -->
    ${secTitle('👥 Equipe')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-bottom:18px">
      ${kpi('🧑‍💼', 'Corretores Ativos', fmtNum(ativos), '', '#3b82f6')}
      ${kpi('🎯', 'Com Meta', fmtNum(comMeta), 'metas definidas', '#64748b')}
      ${kpi('🥇', 'Batendo Meta', fmtNum(batendo), '≥ 100%', '#22c55e')}
      ${kpi('🟡', 'No Caminho', fmtNum(caminho), '50–99%', '#f59e0b')}
      ${kpi('🔴', 'Crítico', fmtNum(critico), '< 50%', '#ef4444')}
    </div>

    <!-- Financeiro -->
    ${secTitle('💵 Financeiro (NIBO)')}
    ${niboVazio ? `
      <div class="alert alert-warn" style="margin:0">⚠️ Financeiro ao vivo indisponível agora (NIBO ${dreOk ? 'sem dados no período' : 'fora / token'}). Os números acima (vendas/pipeline/equipe) são do RD e seguem reais.</div>
    ` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px">
        ${kpi('📥', 'Receita', fmtKM(receita), 'NIBO · 12m', '#22c55e')}
        ${kpi('📤', 'Despesas', fmtKM(despesa), 'NIBO · 12m', '#ef4444')}
        ${kpi('💎', 'Saldo', fmtKM(saldo), margem.toFixed(1) + '% margem', semStatus(margem, [5, 15, 25]))}
      </div>
    `}

    <div class="tiny muted" style="margin-top:14px">Atingimento anual via RD (sincronizado ${fmtWhen(atg.deals_synced_at || atg.fetched_at)}). Pipeline e momentum via /metrics/overview. Financeiro via NIBO (DRE 12m).</div>
  `;
}

/* ─── helpers ─── */
function secTitle(t) {
  return `<div class="card-title" style="font-size:13px;color:var(--psm-gold);text-transform:uppercase;letter-spacing:1px">${t}</div>`;
}
function semStatus(v, [c, m, b]) {
  if (v >= b) return '#22c55e';
  if (v >= m) return '#f59e0b';
  if (v >= c) return '#fbbf24';
  return '#ef4444';
}
function kpi(ico, label, value, sub, color, textColor) {
  return `
    <div style="background:var(--bg-3);border-radius:10px;border-left:4px solid ${color};padding:14px;display:flex;gap:10px;align-items:flex-start">
      <div style="font-size:22px;flex-shrink:0">${ico}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;text-transform:uppercase;color:var(--muted);font-weight:600">${label}</div>
        <div style="font-size:18px;font-weight:800;color:${textColor || color}">${value}</div>
        ${sub ? `<div class="tiny muted">${sub}</div>` : ''}
      </div>
    </div>
  `;
}
function fmtKM(n) {
  n = +n || 0;
  if (n >= 1_000_000) return 'R$ ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (n >= 1000) return 'R$ ' + (n / 1000).toFixed(0) + 'k';
  return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
}
function fmtNum(n) { return (+n || 0).toLocaleString('pt-BR'); }
function fmtWhen(s) { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
