/* PSM-OS v2 — Simulador Leads/CAC (Sprint 8.4)
   v87.73: formulário desenhado UMA vez — digitar só repinta o resultado (o
   campo parava de apagar; ver sim-campos.js). O CTR, que era digitado mas não
   entrava em conta nenhuma, agora gera as impressões e o CPM do topo do funil. */
import { ATTR_NUM, parseNum, numCampo } from '../sim-campos.js';

const KEY = 'psm_v2_sim_leads';
const DEFAULTS = {
  // Investimento mensal
  metaAds: 10000, googleAds: 5000, instagramOrg: 0,
  // Métricas
  cpc: 1.50, ctr: 2.0, cvrLP: 5.0,
  // Funil
  taxaQualif: 30, taxaVisita: 40, taxaProposta: 50, taxaFech: 35,
  // Vendas
  ticketMedio: 600000, comissaoPct: 6,
};
let _root, _s;

export async function pageSimLeads(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

function compute() {
  const v = {};
  Object.keys(DEFAULTS).forEach(k => { v[k] = +_s[k] || 0; });
  const invMidia = v.metaAds + v.googleAds;
  const invTotal = invMidia + v.instagramOrg;
  const cliques = v.cpc > 0 ? invMidia / v.cpc : 0;
  const impressoes = v.ctr > 0 ? cliques / (v.ctr / 100) : 0;
  const cpm = impressoes > 0 ? invMidia / impressoes * 1000 : 0;
  const leads = cliques * (v.cvrLP / 100);
  const qualificados = leads * (v.taxaQualif / 100);
  const visitas = qualificados * (v.taxaVisita / 100);
  const propostas = visitas * (v.taxaProposta / 100);
  const vendas = propostas * (v.taxaFech / 100);
  const cpl = leads > 0 ? invTotal / leads : 0;
  const cac = vendas > 0 ? invTotal / vendas : 0;
  const vgv = vendas * v.ticketMedio;
  const comissao = vgv * v.comissaoPct / 100;
  const lucro = comissao - invTotal;
  const roi = invTotal > 0 ? lucro / invTotal * 100 : 0;
  const ltvCac = cac > 0 ? (comissao / vendas / cac) : 0;
  return { invTotal, impressoes, cpm, cliques, leads, qualificados, visitas, propostas, vendas, cpl, cac, vgv, comissao, lucro, roi, ltvCac };
}

function render() {
  _root.innerHTML = `
    <style>@media(max-width:900px){.ld-grid{grid-template-columns:minmax(0,1fr) !important}}</style>
    <div class="card">
      <h2 class="card-title">🎯 Simulador Leads / CAC</h2>
      <p class="card-sub">Custo por lead, CAC, conversão de funil e ROI do investimento em marketing</p>

      <div class="ld-grid" style="display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px;margin-top:12px;align-items:start">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:6px">Investimento Mensal</div>
          ${inp('Meta Ads (R$)', 'metaAds')}
          ${inp('Google Ads (R$)', 'googleAds')}
          ${inp('Outros (R$)', 'instagramOrg')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Métricas de Mídia</div>
          ${inp('CPC Médio (R$)', 'cpc')}
          ${inp('CTR (%)', 'ctr', '%')}
          ${inp('Conv. Landing (%)', 'cvrLP', '%')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Taxas de Funil</div>
          ${inp('Qualificação (%)', 'taxaQualif', '%')}
          ${inp('Lead → Visita (%)', 'taxaVisita', '%')}
          ${inp('Visita → Proposta (%)', 'taxaProposta', '%')}
          ${inp('Fechamento (%)', 'taxaFech', '%')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Vendas</div>
          ${inp('Ticket Médio (R$)', 'ticketMedio')}
          ${inp('Comissão (%)', 'comissaoPct', '%')}
        </div>

        <div>
          <div id="ld-kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px"></div>

          <div class="card" style="padding:14px;margin-bottom:14px">
            <div style="font-weight:800;margin-bottom:10px">🔻 Funil de Conversão</div>
            <div id="ld-funil" style="display:flex;flex-direction:column;gap:6px"></div>
          </div>

          <div class="card" style="padding:14px">
            <div style="font-weight:800;margin-bottom:10px">💰 Análise Financeira</div>
            <div id="ld-fin" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px"></div>
          </div>

          <div class="alert" style="background:rgba(99,102,241,.1);color:var(--violeta);border:1px solid rgba(99,102,241,.3);margin-top:14px;padding:12px;border-radius:8px">
            <b>💡 Benchmark:</b> CAC saudável no imobiliário ≤ 30% da comissão. LTV/CAC ≥ 3x = operação sustentável. ROI > 200% no marketing digital de luxo, > 400% no MCMV.
          </div>

          <div class="flex gap-2 mt-3">
            <button class="btn btn-ghost" data-back>← Voltar Simuladores</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bind();
  pintaSaida();
}

/* Repinta SÓ o resultado — os <input> ficam vivos do começo ao fim */
function pintaSaida() {
  const c = compute();
  const set = (sel, html) => { const el = _root.querySelector(sel); if (el) el.innerHTML = html; };
  set('#ld-kpis', kpi('Investimento', fmt(c.invTotal), 'var(--psm-navy)', '#fff')
    + kpi('CPL', fmt(c.cpl), '#3b82f6')
    + kpi('CAC', fmt(c.cac), '#f59e0b')
    + kpi('ROI', dec(c.roi, 1) + '%', c.roi >= 0 ? '#22c55e' : '#ef4444'));
  set('#ld-funil',
    (c.impressoes > 0 ? funnelStep('👀 Impressões', int(c.impressoes), 100, '#0ea5e9') : '')
    + funnelStep('💸 Cliques', int(c.cliques), c.impressoes > 0 ? pct(c.cliques, c.impressoes) : 100, '#3b82f6')
    + funnelStep('🎯 Leads', int(c.leads), pct(c.leads, c.cliques), '#6366f1')
    + funnelStep('✅ Qualificados', int(c.qualificados), pct(c.qualificados, c.leads), '#8b5cf6')
    + funnelStep('🚪 Visitas', int(c.visitas), pct(c.visitas, c.qualificados), '#a855f7')
    + funnelStep('📝 Propostas', int(c.propostas), pct(c.propostas, c.visitas), '#d946ef')
    + funnelStep('🏆 Vendas', dec(c.vendas, 1), pct(c.vendas, c.propostas), '#22c55e'));
  set('#ld-fin', mini('VGV Total', fmt(c.vgv))
    + mini('Comissão (' + _s.comissaoPct + '%)', fmt(c.comissao), 'var(--psm-gold)')
    + mini('Lucro Líquido', fmt(c.lucro), c.lucro >= 0 ? '#22c55e' : '#ef4444')
    + mini('LTV / CAC', dec(c.ltvCac, 2) + 'x', c.ltvCac >= 3 ? '#22c55e' : '#f59e0b')
    + mini('CPM (mil impressões)', c.impressoes > 0 ? 'R$ ' + c.cpm.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')
    + mini('Cliques / mês', int(c.cliques)));
}

function pct(a, b) { return b > 0 ? dec(a / b * 100, 1) : '0'; }
function int(n) { return Math.round(n || 0).toLocaleString('pt-BR'); }
function dec(n, casas) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }

function funnelStep(label, value, p, color) {
  const width = Math.max(20, Math.min(100, parseFloat(String(p).replace(/\./g, '').replace(',', '.'))));
  return `
    <div style="background:var(--bg-3);border-radius:6px;overflow:hidden;position:relative">
      <div style="background:${color}33;width:${width}%;height:100%;position:absolute;left:0;top:0"></div>
      <div style="position:relative;padding:8px 12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">${label}</span>
        <span><b style="color:${color}">${value}</b> <span class="tiny muted">(${p}%)</span></span>
      </div>
    </div>
  `;
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', () => { _s[el.dataset.key] = parseNum(el.value); save(); pintaSaida(); });
    el.addEventListener('blur', () => { el.value = numCampo(_s[el.dataset.key]); });
  });
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function inp(label, key, suffix) {
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1">${/R\$/.test(label) ? '<span class="tiny muted" style="align-self:center;font-weight:700">R$</span>' : ''}<input ${ATTR_NUM} class="input" data-key="${key}" value="${numCampo(_s[key])}" style="flex:1;min-width:0;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, bg, color) {
  return `<div style="background:${bg};color:${color || '#fff'};padding:14px;border-radius:8px;text-align:center"><div style="font-size:9px;text-transform:uppercase;opacity:.8;font-weight:700">${label}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${value}</div></div>`;
}

function mini(label, value, color) {
  return `<div style="background:var(--bg-3);padding:10px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-weight:800;font-size:14px;color:${color || 'var(--tx)'}">${value}</div></div>`;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
