/* PSM-OS v2 — 🗺️ Mapa dos Ciclos de Feedback (visão sistêmica). Mostra como o dado REAL
   circula: Tráfego(Meta) → Leads → Vendas(CRM) → Caixa(Financeiro), e como ele alimenta os
   instrumentos de decisão (Simulador, Viab, Forecast, Otimizador) que voltam pra operação.
   KPIs ao vivo (history + atingimento + custos_fixos). Diretoria (lvl≥7). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
const MESES = Math.max(1, new Date().getMonth() + 1);
const f$ = n => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fK = n => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('pt-BR');
const pct2 = v => v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function pageMapaCiclos(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Diretor (lvl 7+).</div>'; return; }
  render(null, true);
  const ANO = new Date().getFullYear();
  const [hist, atg, fin] = await Promise.all([
    api.request('/api/v3/marketing/history?ano=' + ANO).catch(() => null),
    api.request('/api/v3/metas/atingimento').catch(() => null),
    api.request('/api/v3/finance/custos_fixos?months=3&company=all').catch(() => null),
  ]);
  // Meta (média mensal do ano arquivado)
  const ht = (hist && hist.totais) || {}, mh = (hist && hist.meses_com_dado) || 0;
  const meta = {
    investMes: mh > 0 ? (+ht.spend || 0) / mh : 0,
    leadsMes: mh > 0 ? (+ht.results || 0) / mh : 0,
    cpl: +ht.cpl || 0, meses: mh,
    leadsAno: +ht.results || 0,
  };
  // CRM (realizado YTD ÷ meses)
  const vgvAno = +(atg && atg.total_vgv || 0), vendasAno = +(atg && atg.total_vendas || 0);
  const metaAno = (atg && Array.isArray(atg.por_corretor)) ? atg.por_corretor.reduce((s, c) => s + (+c.meta_vgv || 0), 0) : 0;
  const crm = {
    vgvMes: vgvAno / MESES, vendasMes: vendasAno / MESES, vgvAno, vendasAno,
    conv: meta.leadsAno > 0 ? (vendasAno / meta.leadsAno * 100) : 0,
    ticket: vendasAno > 0 ? vgvAno / vendasAno : 0,
  };
  // Forecast (run-rate)
  const fc = {
    projAno: crm.vgvMes * 12, metaAno,
    ating: metaAno > 0 ? (vgvAno / metaAno * 100) : null,
  };
  // Financeiro (custo fixo realizado — pode estar degradado se NIBO sem token)
  const ft = fin && fin.ok ? (fin.totals || {}) : null, fm = (fin && fin.months) || 3;
  const finc = ft ? { custoMes: (+ft.total || 0) / fm, ok: true } : { ok: false };
  const caixaMes = crm.vgvMes; // proxy de volume (caixa real depende de margem; aqui mostramos VGV gerado)

  render({ meta, crm, fc, finc }, false);
}

function node(href, icon, title, cor, sub, kpis) {
  return `<a href="${href}" class="mc-node" style="--c:${cor}">
    <div class="mc-h"><span style="font-size:18px">${icon}</span><b>${esc(title)}</b></div>
    ${sub ? `<div class="tiny muted" style="margin:-2px 0 6px">${esc(sub)}</div>` : ''}
    <div class="mc-kpis">${kpis.map(k => `<div class="mc-kpi"><div class="mc-v" style="${k.cor ? 'color:' + k.cor : ''}">${k.v}</div><div class="tiny muted">${k.l}</div></div>`).join('')}</div>
    <div class="mc-open">abrir →</div></a>`;
}

function render(d, loading) {
  if (!_root) return;
  if (loading) { _root.innerHTML = `<div class="card"><h2 class="card-title">🗺️ Mapa dos Ciclos de Feedback</h2><div class="muted tiny"><span class="spinner"></span> Lendo os dados reais…</div></div>`; return; }
  const m = d.meta, c = d.crm, fc = d.fc, fi = d.finc;
  const arrow = (txt) => `<div class="mc-arrow"><span class="mc-ar">▶</span><span class="tiny muted">${txt}</span></div>`;
  const atingCor = fc.ating == null ? '' : (fc.ating >= 100 ? '#16a34a' : fc.ating >= 70 ? '#d97706' : '#dc2626');

  const ciclo = (n, nome, desc, status) => {
    const st = status === 'ok' ? { t: '✅ ativo', c: '#16a34a' } : status === 'warn' ? { t: '⚠️ degradado', c: '#d97706' } : { t: '🔜 a fechar', c: '#64748b' };
    return `<div class="mc-ciclo">
      <div class="mc-cn" style="color:${st.c}">${n}</div>
      <div style="flex:1"><b>${esc(nome)}</b><div class="tiny muted">${desc}</div></div>
      <div class="tiny" style="font-weight:800;color:${st.c};white-space:nowrap">${st.t}</div></div>`;
  };

  _root.innerHTML = `
  <div class="card">
    <h2 class="card-title">🗺️ Mapa dos Ciclos de Feedback</h2>
    <p class="card-sub">Como o dado circula no PSM-OS: a <b>operação real</b> (em cima) alimenta os <b>instrumentos de decisão</b> (no meio), que voltam pra operação como <b>orçamento, meta e foco</b>. KPIs ao vivo.</p>

    <div class="mc-band">OPERAÇÃO REAL <span class="tiny muted" style="font-weight:400">— o que de fato aconteceu (Meta + CRM + Financeiro)</span></div>
    <div class="mc-row">
      ${node('#/marketing-historico', '📣', 'Tráfego (Meta)', '#7c3aed', 'investimento → leads', [
        { v: f$(m.investMes), l: 'invest/mês' }, { v: f1(m.leadsMes), l: 'leads/mês' }, { v: f$(m.cpl), l: 'CPL' },
      ])}
      ${arrow('leads viram oportunidades')}
      ${node('#/crm', '🤝', 'Vendas (CRM/RD)', '#2563eb', 'leads → vendas → VGV', [
        { v: fK(c.vgvMes), l: 'VGV/mês' }, { v: f1(c.vendasMes), l: 'vendas/mês' }, { v: pct2(c.conv), l: 'conversão real' },
      ])}
      ${arrow('comissão vira caixa')}
      ${node('#/financeiro', '💰', 'Financeiro', '#0891b2', fi.ok ? 'caixa & custos' : 'NIBO sem token', [
        fi.ok ? { v: f$(fi.custoMes), l: 'custo fixo/mês' } : { v: '—', l: 'custo (NIBO off)' },
        { v: fK(c.vgvAno), l: 'VGV ano' },
      ])}
    </div>

    <div class="mc-conn">⬇ <span class="tiny muted">o realizado alimenta as decisões (CPL, conversão, VGV, custo)</span></div>

    <div class="mc-band">INSTRUMENTOS DE DECISÃO <span class="tiny muted" style="font-weight:400">— leem o real e projetam o futuro</span></div>
    <div class="mc-grid">
      ${node('#/sim-trafego', '📣', 'Simulador de Tráfego', '#7c3aed', 'real → simulado + otimizador', [
        { v: f$(m.cpl), l: 'CPL real usado' }, { v: pct2(c.conv), l: 'conversão base' },
      ])}
      ${node('#/metricas-viab', '🧪', 'Métrica de Viabilidade', '#16a34a', 'realizado × premissa + equilíbrio', [
        { v: fK(c.vgvMes), l: 'VGV real/mês' }, { v: fi.ok ? f$(fi.custoMes) : '—', l: 'custo fixo' },
      ])}
      ${node('#/forecast', '🎯', 'Forecast / Metas', '#d97706', 'run-rate → projeção → meta', [
        { v: fK(fc.projAno), l: 'projeção ano' }, { v: fc.ating == null ? '—' : pct2(fc.ating), l: 'da meta', cor: atingCor },
      ])}
      ${node('#/sim-trafego', '⚡', 'Otimizador de Verba', '#0ea5e9', 'aloca orçamento ótimo', [
        { v: f$(m.investMes), l: 'verba atual/mês' }, { v: fK(c.vgvMes), l: 'VGV gerado' },
      ])}
    </div>

    <div class="mc-conn">⬆ <span class="tiny muted">as decisões voltam pra operação: orçamento de tráfego, meta de VGV e foco da semana</span></div>

    <div class="mc-band">OS 4 CICLOS</div>
    <div class="mc-ciclos">
      ${ciclo('🔄 #1', 'Meta + CRM → Simulador', 'CPL e conversão reais calibram o cenário simulado (botão "usar no simulado").', 'ok')}
      ${ciclo('🔄 #2', 'Financeiro → Viabilidade', 'Custo realizado (NIBO) confronta a planilha de custos da Viab.', fi.ok ? 'ok' : 'warn')}
      ${ciclo('🔄 #3', 'Viabilidade → Orçamento', 'VGV de equilíbrio/meta → "Orçamento pra meta" no Simulador calcula quanto investir em tráfego (engenharia reversa).', 'ok')}
      ${ciclo('🔄 #4', 'Vendas → Forecast → Meta', 'O run-rate do realizado projeta o ano e ajusta a meta na aba Metas.', 'ok')}
    </div>
    <div class="tiny muted" style="margin-top:10px">💡 Clique em qualquer bloco pra abrir a tela. Os números são a média mensal do ano (Meta ${m.meses} mês(es) arquivado(s); CRM ÷ ${MESES} meses decorridos).</div>
  </div>
  <style>
    .mc-band{font-size:11px;text-transform:uppercase;font-weight:800;color:var(--text-2,#94a3b8);letter-spacing:.5px;margin:18px 0 8px}
    .mc-row{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap}
    .mc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .mc-node{display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px;background:var(--bg-2);border:1px solid var(--border);border-left:4px solid var(--c);border-radius:12px;padding:12px;text-decoration:none;color:inherit;transition:transform .12s,box-shadow .12s}
    .mc-node:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.18)}
    .mc-h{display:flex;align-items:center;gap:7px;font-size:14px}
    .mc-kpis{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}
    .mc-kpi .mc-v{font-weight:800;font-size:14px}
    .mc-open{margin-top:auto;font-size:11px;font-weight:700;color:var(--c);padding-top:6px}
    .mc-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:90px;text-align:center}
    .mc-ar{color:var(--psm-gold,#d4af37);font-size:18px}
    .mc-conn{text-align:center;font-weight:800;color:var(--psm-gold,#d4af37);margin:12px 0;font-size:15px}
    .mc-ciclos{display:flex;flex-direction:column;gap:8px}
    .mc-ciclo{display:flex;align-items:center;gap:12px;background:var(--bg-3);border-radius:10px;padding:10px 12px}
    .mc-cn{font-weight:800;white-space:nowrap}
    @media(max-width:880px){.mc-grid{grid-template-columns:repeat(2,1fr)}.mc-arrow{min-width:0;flex-direction:row;width:100%}.mc-ar{transform:rotate(90deg)}}
  </style>`;
}
