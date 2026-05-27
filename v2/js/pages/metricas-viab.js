/* PSM-OS v2 — Métricas de Viabilidade (Sprint 8.6) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;

const KEY = 'psm_v2_metricas_viab';
const DEFAULTS = {
  // Operação base
  custoFixoMes: 27000,    // Aluguel + folha + utilities
  proLabore: 24000,        // 2 sócios
  ads: 15000,              // Marketing mensal
  comissaoBrutaPct: 4,     // % média sobre vendas
  comCorretorPct: 1.4,     // % pro corretor
  comSeniorPct: 1.6,       // % senior
  aliquotaPct: 8,          // simples nacional
  ticketMedio: 350000,
  metaMes: 4150000,        // VGV mínimo sustentável
};

let _s = null;

export async function pageMetricasViab(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>';
    return;
  }
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/metas/atingimento').catch(() => ({}));
    _data = r;
    renderContent();
  } catch (e) {
    renderContent();
  }
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

function compute() {
  const v = _s;
  // Despesa total mensal
  const despFixa = v.custoFixoMes + v.proLabore + v.ads;
  // VGV pra cobrir despesa fixa = despFixa / (comBruta% - imposto%)
  const margemLiquidaPct = (v.comissaoBrutaPct - v.aliquotaPct * v.comissaoBrutaPct / 100) / 100;
  const vgvBreakEven = margemLiquidaPct > 0 ? despFixa / margemLiquidaPct : 0;
  // Comissão líquida por venda
  const comissaoBrutaMedia = v.ticketMedio * v.comissaoBrutaPct / 100;
  const impostoMedio = comissaoBrutaMedia * v.aliquotaPct / 100;
  const comissaoCorretor = v.ticketMedio * v.comCorretorPct / 100;
  const comissaoSenior = v.ticketMedio * v.comSeniorPct / 100;
  const margemPSM = comissaoBrutaMedia - impostoMedio - comissaoCorretor - comissaoSenior;
  // Vendas pra break-even
  const vendasBreakEven = margemPSM > 0 ? Math.ceil(despFixa / margemPSM) : 0;
  // Meta atual
  const vgvReal = +(_data?.total_vgv || 0);
  const vendasReal = (_data?.por_corretor || []).reduce((s, c) => s + (+c.vendas || 0), 0);
  // Payback de uma campanha
  const cacBruto = 0; // (cost of acquisition) — sem dados ainda
  const lucroLiquido = vgvReal * margemLiquidaPct - despFixa;
  const margemLiquidaReal = vgvReal > 0 ? (lucroLiquido / vgvReal * 100) : 0;
  // Eficiência marketing (ads / vendas)
  const ladPorVenda = vendasReal > 0 ? v.ads / vendasReal : 0;
  return {
    despFixa, margemLiquidaPct, vgvBreakEven, vendasBreakEven,
    comissaoBrutaMedia, impostoMedio, comissaoCorretor, comissaoSenior, margemPSM,
    vgvReal, vendasReal, lucroLiquido, margemLiquidaReal, ladPorVenda,
  };
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🧪 Métricas de Viabilidade</h2>
      <p class="card-sub">Break-even, margens, eficiência — análise de viabilidade econômica PSM (Sócio only)</p>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px;margin-top:12px">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:6px">Parâmetros Operacionais</div>
          ${inp('Custo Fixo Mensal (R$)', 'custoFixoMes', 'num')}
          ${inp('Pró-Labore (R$)', 'proLabore', 'num')}
          ${inp('Investimento Ads (R$)', 'ads', 'num')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Comissões</div>
          ${inp('Comissão Bruta (%)', 'comissaoBrutaPct', 'num', '%')}
          ${inp('% Corretor', 'comCorretorPct', 'num', '%')}
          ${inp('% Sênior', 'comSeniorPct', 'num', '%')}
          ${inp('Alíquota Imposto (%)', 'aliquotaPct', 'num', '%')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Operação</div>
          ${inp('Ticket Médio (R$)', 'ticketMedio', 'num')}
          ${inp('Meta Mês (R$)', 'metaMes', 'num')}
        </div>

        <div id="viab-body"><div class="muted tiny"><span class="spinner"></span> Carregando dados reais…</div></div>
      </div>
    </div>
  `;
  bind();
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', e => {
    _s[el.dataset.key] = parseFloat(e.target.value) || 0;
    save();
    clearTimeout(window._vtm); window._vtm = setTimeout(renderContent, 250);
  }));
}

function renderContent() {
  const c = compute();
  const body = document.getElementById('viab-body');
  if (!body) return;

  const statusBE = c.vgvReal >= c.vgvBreakEven ? '✅ Acima do break-even' : '⚠️ Abaixo do break-even';
  const colorBE = c.vgvReal >= c.vgvBreakEven ? '#22c55e' : '#ef4444';

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">
      ${kpi('⚖️ Break-Even VGV', fmt(c.vgvBreakEven), 'pra cobrir despesa fixa', '#fbbf24')}
      ${kpi('🎯 Vendas Break-Even', c.vendasBreakEven, 'vendas mínimas/mês', '#3b82f6')}
      ${kpi('💸 Despesa Fixa', fmt(c.despFixa), 'custo + pró-labore + ads', '#ef4444')}
      ${kpi('📊 Margem Líquida', c.margemLiquidaPct.toFixed(2) + '%', 'após impostos', '#22c55e')}
    </div>

    <div class="card" style="padding:14px;margin-bottom:14px">
      <div style="font-weight:800;margin-bottom:10px">💰 Comissão por Venda (ticket ${fmt(_s.ticketMedio)})</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${mini('Comissão Bruta', fmt(c.comissaoBrutaMedia), '#3b82f6')}
        ${mini('Imposto', fmt(c.impostoMedio), '#ef4444')}
        ${mini('Comissão Corretor', fmt(c.comissaoCorretor), '#f59e0b')}
        ${mini('Comissão Sênior', fmt(c.comissaoSenior), '#8b5cf6')}
        ${mini('Margem PSM Final', fmt(c.margemPSM), c.margemPSM > 0 ? '#22c55e' : '#ef4444')}
        ${mini('% PSM sobre Ticket', (c.margemPSM / _s.ticketMedio * 100).toFixed(2) + '%', '#fbbf24')}
      </div>
    </div>

    <div class="card" style="padding:14px;margin-bottom:14px;border-left:4px solid ${colorBE}">
      <div style="font-weight:800;margin-bottom:10px;color:${colorBE}">${statusBE}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        ${mini('VGV Realizado', fmt(c.vgvReal), '#22c55e')}
        ${mini('VGV Break-Even', fmt(c.vgvBreakEven), '#fbbf24')}
        ${mini('Gap', fmt(c.vgvReal - c.vgvBreakEven), c.vgvReal >= c.vgvBreakEven ? '#22c55e' : '#ef4444')}
        ${mini('Lucro Líquido Mês', fmt(c.lucroLiquido), c.lucroLiquido > 0 ? '#22c55e' : '#ef4444')}
        ${mini('Margem Líquida Real', c.margemLiquidaReal.toFixed(2) + '%', '#fbbf24')}
        ${mini('Ads / Venda', fmt(c.ladPorVenda), '#3b82f6')}
      </div>
    </div>

    <div class="alert" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);padding:12px;border-radius:8px">
      <b>💡 Insights:</b><br>
      • Break-even: VGV mínimo de <b>${fmt(c.vgvBreakEven)}</b> ou <b>${c.vendasBreakEven} vendas/mês</b> pra cobrir despesas fixas<br>
      • Cada venda gera <b>${fmt(c.margemPSM)}</b> líquido pra PSM (${(c.margemPSM / _s.ticketMedio * 100).toFixed(2)}% do ticket)<br>
      • Margem ideal saudável imobiliário: 25-35%. Atual: <b>${c.margemLiquidaReal.toFixed(1)}%</b>
    </div>
  `;
}

function inp(label, key, type, suffix) {
  const val = _s[key] ?? '';
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1"><input type="number" class="input" data-key="${key}" value="${val}" style="flex:1;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, sub, color) {
  return `<div style="background:var(--bg-3);border-left:4px solid ${color};border-radius:8px;padding:12px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700">${label}</div><div style="font-size:20px;font-weight:800;color:${color};margin-top:4px">${value}</div><div class="tiny muted">${sub}</div></div>`;
}

function mini(label, value, color) {
  return `<div style="background:var(--bg-3);padding:10px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-weight:800;font-size:14px;color:${color || 'var(--tx)'}">${value}</div></div>`;
}

function fmt(n) { return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR'); }
