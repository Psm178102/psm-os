/* PSM-OS v2 — Simulador Leads/CAC (Sprint 8.4) */

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
  const v = _s;
  const invTotal = v.metaAds + v.googleAds + v.instagramOrg;
  // Impressões: investimento / cpc / ctr
  const cliques = v.cpc > 0 ? (v.metaAds + v.googleAds) / v.cpc : 0;
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
  const roi = invTotal > 0 ? (lucro / invTotal * 100).toFixed(1) : '0';
  const ltv_cac = cac > 0 ? (comissao / vendas / cac).toFixed(2) : '0';
  return { invTotal, cliques, leads, qualificados, visitas, propostas, vendas, cpl, cac, vgv, comissao, lucro, roi, ltv_cac };
}

function render() {
  const c = compute();
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🎯 Simulador Leads / CAC</h2>
      <p class="card-sub">Custo por lead, CAC, conversão de funil e ROI do investimento em marketing</p>

      <div style="display:grid;grid-template-columns:300px 1fr;gap:14px;margin-top:12px">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:6px">Investimento Mensal</div>
          ${inp('Meta Ads (R$)', 'metaAds', 'num')}
          ${inp('Google Ads (R$)', 'googleAds', 'num')}
          ${inp('Outros (R$)', 'instagramOrg', 'num')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Métricas de Mídia</div>
          ${inp('CPC Médio (R$)', 'cpc', 'num')}
          ${inp('CTR (%)', 'ctr', 'num', '%')}
          ${inp('Conv. Landing (%)', 'cvrLP', 'num', '%')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Taxas de Funil</div>
          ${inp('Qualificação (%)', 'taxaQualif', 'num', '%')}
          ${inp('Lead → Visita (%)', 'taxaVisita', 'num', '%')}
          ${inp('Visita → Proposta (%)', 'taxaProposta', 'num', '%')}
          ${inp('Fechamento (%)', 'taxaFech', 'num', '%')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Vendas</div>
          ${inp('Ticket Médio (R$)', 'ticketMedio', 'num')}
          ${inp('Comissão (%)', 'comissaoPct', 'num', '%')}
        </div>

        <div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
            ${kpi('Investimento', fmt(c.invTotal), 'var(--psm-navy)', '#fff')}
            ${kpi('CPL', fmt(c.cpl), '#3b82f6')}
            ${kpi('CAC', fmt(c.cac), '#f59e0b')}
            ${kpi('ROI', c.roi + '%', c.roi >= 0 ? '#22c55e' : '#ef4444')}
          </div>

          <div class="card" style="padding:14px;margin-bottom:14px">
            <div style="font-weight:800;margin-bottom:10px">🔻 Funil de Conversão</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${funnelStep('💸 Cliques', c.cliques.toFixed(0), 100, '#3b82f6')}
              ${funnelStep('🎯 Leads', c.leads.toFixed(0), pct(c.leads, c.cliques), '#6366f1')}
              ${funnelStep('✅ Qualificados', c.qualificados.toFixed(0), pct(c.qualificados, c.leads), '#8b5cf6')}
              ${funnelStep('🚪 Visitas', c.visitas.toFixed(0), pct(c.visitas, c.qualificados), '#a855f7')}
              ${funnelStep('📝 Propostas', c.propostas.toFixed(0), pct(c.propostas, c.visitas), '#d946ef')}
              ${funnelStep('🏆 Vendas', c.vendas.toFixed(1), pct(c.vendas, c.propostas), '#22c55e')}
            </div>
          </div>

          <div class="card" style="padding:14px">
            <div style="font-weight:800;margin-bottom:10px">💰 Análise Financeira</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
              ${mini('VGV Total', fmt(c.vgv))}
              ${mini('Comissão (' + _s.comissaoPct + '%)', fmt(c.comissao), 'var(--psm-gold)')}
              ${mini('Lucro Líquido', fmt(c.lucro), c.lucro >= 0 ? '#22c55e' : '#ef4444')}
              ${mini('LTV / CAC', c.ltv_cac + 'x', c.ltv_cac >= 3 ? '#22c55e' : '#f59e0b')}
            </div>
          </div>

          <div class="alert" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);margin-top:14px;padding:12px;border-radius:8px">
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
}

function pct(a, b) { return b > 0 ? (a / b * 100).toFixed(1) : '0'; }

function funnelStep(label, value, p, color) {
  const width = Math.max(20, Math.min(100, parseFloat(p)));
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
  _root.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', e => {
    const k = el.dataset.key, t = el.dataset.type;
    _s[k] = t === 'num' ? (parseFloat(e.target.value) || 0) : e.target.value;
    save();
    clearTimeout(window._lTimer); window._lTimer = setTimeout(render, 250);
  }));
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function inp(label, key, type, suffix) {
  const val = _s[key] ?? '';
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1"><input type="number" class="input" data-key="${key}" data-type="${type}" value="${val}" style="flex:1;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, bg, color) {
  return `<div style="background:${bg};color:${color || '#fff'};padding:14px;border-radius:8px;text-align:center"><div style="font-size:9px;text-transform:uppercase;opacity:.8;font-weight:700">${label}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${value}</div></div>`;
}

function mini(label, value, color) {
  return `<div style="background:var(--bg-3);padding:10px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-weight:800;font-size:14px;color:${color || 'var(--tx)'}">${value}</div></div>`;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
