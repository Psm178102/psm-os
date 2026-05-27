/* PSM-OS v2 — KPIs Executivos (Sprint 8.6) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;

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
    const [atg, deals, dre] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/crm/deals?limit=500').catch(() => ({ deals: [] })),
      api.request('/api/v3/finance/dre').catch(() => ({})),
    ]);
    _data = { atg, deals: deals.deals || [], dre };
    renderContent();
  } catch (e) {
    document.getElementById('kpi-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📊 KPIs Executivos</h2>
      <p class="card-sub">Visão estratégica consolidada — vendas, pipeline, conversão, financeiro, equipe</p>
      <div id="kpi-body" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Calculando KPIs…</div></div>
    </div>
  `;
}

function renderContent() {
  const { atg, deals, dre } = _data;

  // Vendas e pipeline
  const closed = deals.filter(d => d.win);
  // win: true=ganho, false=perdido, null/undefined=em aberto
  const open = deals.filter(d => d.win === null || d.win === undefined);
  const lost = deals.filter(d => d.win === false);
  const vgvR = closed.reduce((s, d) => s + (+d.amount || 0), 0);
  const vgvPipe = open.reduce((s, d) => s + (+d.amount || 0), 0);
  const vgvLost = lost.reduce((s, d) => s + (+d.amount || 0), 0);
  const ticketMedio = closed.length ? vgvR / closed.length : 0;
  const ticketPipe = open.length ? vgvPipe / open.length : 0;
  const conv = closed.length + lost.length > 0 ? (closed.length / (closed.length + lost.length) * 100) : 0;
  const loss = closed.length + lost.length > 0 ? (lost.length / (closed.length + lost.length) * 100) : 0;

  // Meta
  const metaVGV = +atg.meta_total_vgv || 0;
  const pctMeta = metaVGV > 0 ? (vgvR / metaVGV * 100) : 0;
  const gap = metaVGV - vgvR;

  // Dias úteis
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  let duPass = 0, duTot = 0;
  for (let d = new Date(inicioMes); d <= fimMes; d.setDate(d.getDate() + 1)) {
    const dw = d.getDay();
    if (dw !== 0 && dw !== 6) {
      duTot++;
      if (d <= hoje) duPass++;
    }
  }
  const velocidade = duPass > 0 ? vgvR / duPass : 0;
  const projecaoMes = duPass > 0 ? velocidade * duTot : 0;
  const projecaoAno = velocidade * 252; // 252 dias úteis ano

  // Ciclo médio
  let cicloTotal = 0, cicloCount = 0;
  closed.forEach(d => {
    const dc = d.created_at ? new Date(d.created_at) : null;
    const df = d.closed_at ? new Date(d.closed_at) : null;
    if (dc && df) {
      const dias = Math.round((df - dc) / 86400000);
      if (dias >= 0 && dias < 365) { cicloTotal += dias; cicloCount++; }
    }
  });
  const cicloMedio = cicloCount > 0 ? (cicloTotal / cicloCount).toFixed(1) : '0';

  // Atingimento por corretor
  const corretores = (atg.por_corretor || []);
  const batendoMeta = corretores.filter(c => (c.vgv_atingido / Math.max(c.meta_vgv, 1)) >= 1).length;
  const sub50 = corretores.filter(c => (c.vgv_atingido / Math.max(c.meta_vgv, 1)) < 0.5).length;

  // Financeiro
  const receitaMes = dre?.totalRevenue || dre?.receita_total || 0;
  const despMes = dre?.totalExpenses || dre?.despesa_total || 0;
  const lucroMes = receitaMes - despMes;
  const margem = receitaMes > 0 ? (lucroMes / receitaMes * 100) : 0;

  const body = document.getElementById('kpi-body');
  body.innerHTML = `
    <!-- Seção 1: Vendas -->
    <div class="card-title mt-3" style="font-size:13px;color:var(--psm-gold);text-transform:uppercase;letter-spacing:1px">📈 Vendas & Meta</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-bottom:18px">
      ${kpi('🏆', 'Vendas Fechadas', closed.length, '', semStatus(closed.length, [3, 6, 10]))}
      ${kpi('💰', 'VGV Realizado', fmtKM(vgvR), pctMeta.toFixed(0) + '% da meta', semStatus(pctMeta, [50, 80, 100]))}
      ${kpi('🎯', 'Meta', fmtKM(metaVGV), gap > 0 ? 'Falta ' + fmtKM(gap) : '✓ Batida', '#cbd5e1')}
      ${kpi('⚡', 'Velocidade', fmtKM(velocidade) + '/dia', `${duPass}/${duTot} dias úteis`, '#3b82f6')}
      ${kpi('📊', 'Projeção Mês', fmtKM(projecaoMes), 'extrapolação ritmo', projecaoMes >= metaVGV ? '#22c55e' : '#f59e0b')}
      ${kpi('📅', 'Projeção Ano', fmtKM(projecaoAno), '252 dias úteis', '#0b1f3a', '#fff')}
    </div>

    <!-- Seção 2: Funil -->
    <div class="card-title" style="font-size:13px;color:var(--psm-gold);text-transform:uppercase;letter-spacing:1px">🔻 Funil & Conversão</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-bottom:18px">
      ${kpi('💼', 'Pipeline Aberto', open.length, fmtKM(vgvPipe), '#3b82f6')}
      ${kpi('🎯', 'Ticket Médio', fmtKM(ticketMedio), 'fechados', '#22c55e')}
      ${kpi('📋', 'Ticket Pipeline', fmtKM(ticketPipe), 'em aberto', '#a855f7')}
      ${kpi('✅', 'Taxa Conversão', conv.toFixed(1) + '%', `${closed.length}/${closed.length + lost.length}`, semStatus(conv, [20, 35, 50]))}
      ${kpi('❌', 'Taxa Perda', loss.toFixed(1) + '%', `${lost.length}/${closed.length + lost.length}`, semStatus(100 - loss, [50, 70, 85]))}
      ${kpi('⏱', 'Ciclo Médio', cicloMedio + ' dias', 'criação → fechamento', '#0891b2')}
    </div>

    <!-- Seção 3: Equipe -->
    <div class="card-title" style="font-size:13px;color:var(--psm-gold);text-transform:uppercase;letter-spacing:1px">👥 Equipe</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-bottom:18px">
      ${kpi('🛡', 'Corretores Ativos', corretores.length, '', '#3b82f6')}
      ${kpi('🥇', 'Batendo Meta', batendoMeta, '≥ 100%', '#22c55e')}
      ${kpi('🟡', 'No Caminho', corretores.length - batendoMeta - sub50, '50-99%', '#f59e0b')}
      ${kpi('🔴', 'Crítico', sub50, '< 50%', '#ef4444')}
    </div>

    <!-- Seção 4: Financeiro -->
    <div class="card-title" style="font-size:13px;color:var(--psm-gold);text-transform:uppercase;letter-spacing:1px">💵 Financeiro (Mês)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px">
      ${kpi('📥', 'Receita', fmtKM(receitaMes), 'NIBO', '#22c55e')}
      ${kpi('📤', 'Despesas', fmtKM(despMes), 'NIBO', '#ef4444')}
      ${kpi('💎', 'Lucro Líquido', fmtKM(lucroMes), margem.toFixed(1) + '% margem', semStatus(margem, [10, 20, 30]))}
    </div>
  `;
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
  if (n >= 1_000_000) return 'R$ ' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return 'R$ ' + (n / 1000).toFixed(0) + 'k';
  return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
