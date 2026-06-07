/* PSM-OS v2 — 📣 Simulador de Tráfego POR LINHA (Meta Ads → Leads → Vendas → Caixa)
   Cada linha (M.A.P, Conquista) tem funil próprio: CPL, conversão, ticket, comissão,
   tempo de conversão — tudo diferente. + Consolidado que soma as linhas.
   - 2 canais (Mensagens × Leads) por linha, com mix/CPL/conversão próprios
   - funil visual, KPIs em cards, 3 cenários (Pess/Real/Otim), Carteira+LTV, Otimizador
   - ⏱ tempo de conversão editável → ATRASO REAL na projeção 24m (lead de hoje vira venda N meses depois)
   - 🔄 Puxar realizado (Meta+CRM) aplica no canal Leads da linha ativa
   Arquitetura: inputs fixos + outputs em #st-out (não perde foco). Board sim_trafego. lvl≥7. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _s = null, _msg = '', _real = null;
const MESES = Math.max(1, new Date().getMonth() + 1);

const FAIXAS = [
  { ate: 180000, r: 0.10, cat: 'A' }, { ate: 360000, r: 0.114, cat: 'B' },
  { ate: 720000, r: 0.135, cat: 'C' }, { ate: 1800000, r: 0.16, cat: 'D' },
  { ate: 4800000, r: 0.21, cat: 'E' }, { ate: Infinity, r: 0.33, cat: 'F' },
];
const faixa = v => FAIXAS.find(f => v <= f.ate) || FAIXAS[FAIXAS.length - 1];

const LINES = [
  { id: 'map', nome: 'PSM M.A.P', icon: '🏢', cor: '#7c3aed' },
  { id: 'conquista', nome: 'PSM Conquista', icon: '🏠', cor: '#16a34a' },
];
const CEN = [
  { id: 'pess', nome: 'Pessimista', mult: 0.7, cor: '#dc2626' },
  { id: 'real', nome: 'Realista', mult: 1.0, cor: '#2563eb' },
  { id: 'otim', nome: 'Otimista', mult: 1.3, cor: '#16a34a' },
];

function freshLine(over) {
  return Object.assign({
    ticket: 234000, comissaoPct: 5, corretorPct: 40, descartePct: 10, custoOperMes: 0,
    ltv: 0.5, taxaCarteira: 5, investMes: 7500, mixMsgPct: 40,
    msg: { cpl: 8, conv: 0.5 }, lead: { cpl: 18, conv: 1.0 },
    tempoConv: 3, crescInvestTrim: 6, encarecCplTrim: 5, metaTipo: 'vgv', metaValor: 5000000,
  }, over || {});
}
const DEFAULTS = {
  active: 'map',
  map: freshLine({ ticket: 600000, comissaoPct: 6, descartePct: 15, mixMsgPct: 30, msg: { cpl: 18, conv: 0.3 }, lead: { cpl: 45, conv: 0.7 }, tempoConv: 6, taxaCarteira: 4, metaValor: 8000000 }),
  conquista: freshLine({ ticket: 234000, comissaoPct: 5, descartePct: 10, mixMsgPct: 55, msg: { cpl: 7, conv: 0.7 }, lead: { cpl: 15, conv: 1.3 }, tempoConv: 2, taxaCarteira: 8, metaValor: 4000000 }),
};

export async function pageSimTrafego(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Diretor (lvl 7+).</div>'; return; }
  _s = JSON.parse(JSON.stringify(DEFAULTS));
  try { const c = JSON.parse(localStorage.getItem('psm_sim_trafego') || 'null'); if (c) _s = mergeDefaults(c); } catch {}
  render();
  try {
    const b = await api.request('/api/v3/diretoria/strategy?board=sim_trafego').catch(() => null);
    if (b && b.ok && b.data && b.data.cfg) { _s = mergeDefaults(b.data.cfg); render(); }
  } catch {}
}
function mergeDefaults(c) {
  const o = JSON.parse(JSON.stringify(DEFAULTS));
  if (c.active && (c.active === 'consol' || LINES.some(l => l.id === c.active))) o.active = c.active;
  for (const ln of LINES) if (c[ln.id]) {
    const d = o[ln.id], sv = c[ln.id];
    for (const k of Object.keys(d)) if (sv[k] !== undefined) d[k] = (d[k] && typeof d[k] === 'object') ? Object.assign(d[k], sv[k]) : sv[k];
  }
  return o;
}
function save() {
  try { localStorage.setItem('psm_sim_trafego', JSON.stringify(_s)); } catch {}
  clearTimeout(window._stt);
  window._stt = setTimeout(async () => {
    try { const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'sim_trafego', data: { cfg: _s } } });
      _msg = (r && r.ok) ? '💾 salvo' : '⚠️ ' + (r && r.error || ''); } catch (e) { _msg = '⚠️ ' + e.message; }
    const m = document.getElementById('st-msg'); if (m) m.textContent = _msg;
  }, 600);
}

/* ── helpers ── */
const f$ = n => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
const fK = n => { n = +n || 0; if (Math.abs(n) >= 1e6) return 'R$ ' + (n / 1e6).toFixed(2) + 'M'; if (Math.abs(n) >= 1e3) return 'R$ ' + (n / 1e3).toFixed(0) + 'k'; return 'R$ ' + Math.round(n); };
const f1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('pt-BR');
const getP = (o, p) => p.split('.').reduce((x, k) => x && x[k], o);
const setP = (o, p, v) => { const a = p.split('.'); let x = o; for (let i = 0; i < a.length - 1; i++) x = x[a[i]]; x[a[a.length - 1]] = v; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lineMeta = id => LINES.find(l => l.id === id) || LINES[0];

/* ── motor (recebe a linha L) ── */
function funnel(L, convMult = 1) {
  const invMsg = L.investMes * L.mixMsgPct / 100;
  const invLead = L.investMes - invMsg;
  const leadsMsg = L.msg.cpl > 0 ? invMsg / L.msg.cpl : 0;
  const leadsLead = L.lead.cpl > 0 ? invLead / L.lead.cpl : 0;
  const leads = leadsMsg + leadsLead;
  const fator = 1 - L.descartePct / 100;
  const qualif = leads * fator;
  const vendasMsg = leadsMsg * fator * (L.msg.conv * convMult) / 100;
  const vendasLead = leadsLead * fator * (L.lead.conv * convMult) / 100;
  const vendas = vendasMsg + vendasLead;
  const vgv = vendas * L.ticket;
  const receita = vgv * L.comissaoPct / 100;
  const fx = faixa(receita * 12);
  const imposto = receita * fx.r;
  const liquido = receita - imposto;
  const corretor = liquido * L.corretorPct / 100;
  const caixa = liquido - corretor - (+L.custoOperMes || 0);
  const roas = L.investMes > 0 ? vgv / L.investMes : 0;
  const cpa = vendas > 0 ? L.investMes / vendas : 0;
  const cplBlend = leads > 0 ? L.investMes / leads : 0;
  const convBlend = qualif > 0 ? vendas / qualif * 100 : 0;
  const caixaPorVenda = L.ticket * L.comissaoPct / 100 * (1 - fx.r) * (1 - L.corretorPct / 100);
  const cplBE = fator * (convBlend / 100) * caixaPorVenda;
  const margemPct = receita > 0 ? caixa / receita * 100 : 0;
  return { investMes: L.investMes, invMsg, invLead, leadsMsg, leadsLead, leads, qualif, vendasMsg, vendasLead, vendas, vgv, receita, imposto, liquido, corretor, caixa, roas, cpa, cplBlend, convBlend, cplBE, margemPct, aliq: fx.r, cat: fx.cat };
}
function consolidado(convMult = 1) {
  const fs = LINES.map(ln => funnel(_s[ln.id], convMult));
  const S = k => fs.reduce((a, f) => a + f[k], 0);
  const invest = S('investMes'), leads = S('leads'), qualif = S('qualif'), vendas = S('vendas'), vgv = S('vgv'), receita = S('receita'), imposto = S('imposto'), caixa = S('caixa');
  return { investMes: invest, leads, qualif, vendas, vgv, receita, imposto, caixa, invMsg: S('invMsg'), invLead: S('invLead'), leadsMsg: S('leadsMsg'), leadsLead: S('leadsLead'),
    roas: invest > 0 ? vgv / invest : 0, cpa: vendas > 0 ? invest / vendas : 0, cplBlend: leads > 0 ? invest / leads : 0,
    convBlend: qualif > 0 ? vendas / qualif * 100 : 0, margemPct: receita > 0 ? caixa / receita * 100 : 0, _fs: fs };
}
function carteira(L, f) {
  const naoConv = Math.max(0, f.qualif - f.vendas);
  const vendasFut = naoConv * (L.taxaCarteira / 100);
  const vgvFut = vendasFut * L.ticket;
  const valorLTV = vgvFut * L.comissaoPct / 100 * L.ltv;
  return { naoConv, vendasFut, vgvFut, valorLTV };
}
function otimizar(L, f) {
  const vendasNec = L.metaTipo === 'vgv' ? (L.ticket > 0 ? L.metaValor / L.ticket : 0) : L.metaValor;
  const convB = (f.convBlend / 100) || 0.0001;
  const leadsNec = vendasNec / ((1 - L.descartePct / 100) * convB);
  const investNec = leadsNec * f.cplBlend;
  const cplAlvo = leadsNec > 0 ? L.investMes / leadsNec : 0;
  return { vendasNec, leadsNec, investNec, cplAlvo };
}
/* projeção com ATRASO de conversão (lag em trimestres) */
function projData(L) {
  const labels = [], real = new Array(8).fill(0);
  const lagTri = Math.max(0, Math.round((L.tempoConv || 0) / 3));
  let inv = L.investMes, cm = L.msg.cpl, cl = L.lead.cpl;
  for (let t = 0; t < 8; t++) {
    if (t >= 4) { inv *= (1 + L.crescInvestTrim / 100); cm *= (1 + L.encarecCplTrim / 100); cl *= (1 + L.encarecCplTrim / 100); }
    const Lt = { ...L, investMes: inv, msg: { ...L.msg, cpl: cm }, lead: { ...L.lead, cpl: cl } };
    const cxTri = funnel(Lt, 1).caixa * 3;
    if (t + lagTri < 8) real[t + lagTri] += cxTri;
    labels.push((t < 4 ? '1A·T' : '2A·T') + ((t % 4) + 1));
  }
  let ac = 0; const acum = real.map(r => (ac += r));
  return { labels, real, acum, lagTri };
}

/* ── render ── */
function render() {
  if (!_root) return;
  const isConsol = _s.active === 'consol';
  const tabs = LINES.map(l => tabBtn(l.id, l.icon + ' ' + l.nome, l.cor)).join('') + tabBtn('consol', '📊 Consolidado', '#0ea5e9');
  let body;
  if (isConsol) body = `<div id="st-out"></div>`;
  else {
    body = `
    ${realPanel()}
    <div class="st-sec">⚙️ Premissas — ${esc(lineMeta(_s.active).nome)}</div>
    <div class="st-grid4">
      ${field('Ticket médio', 'ticket', { money: 1 })}
      ${field('Comissão imobiliária', 'comissaoPct', { pct: 1 })}
      ${field('% Corretor (do líquido)', 'corretorPct', { pct: 1 })}
      ${field('% Descarte de leads', 'descartePct', { pct: 1 })}
      ${field('⏱ Tempo de conversão (meses)', 'tempoConv')}
      ${field('Custo operacional/mês', 'custoOperMes', { money: 1 })}
      ${field('LTV (carteira)', 'ltv')}
      ${field('Investimento/mês', 'investMes', { money: 1 })}
      ${field('Taxa conv. carteira', 'taxaCarteira', { pct: 1 })}
      ${field('Cresc. invest. trim. (Ano2)', 'crescInvestTrim', { pct: 1 })}
      ${field('Encarec. CPL trim. (Ano2)', 'encarecCplTrim', { pct: 1 })}
    </div>
    <div class="st-sec">📣 Canais — Mensagens × Leads</div>
    <div class="st-grid2">
      <div class="st-ch" style="border-color:#0ea5e9">
        <div class="st-ch-h" style="color:#0ea5e9">💬 Mensagens <span class="tiny muted">(WhatsApp/Direct)</span></div>
        ${field('% do investimento', 'mixMsgPct', { pct: 1 })}
        ${field('CPL (custo/mensagem)', 'msg.cpl', { money: 1 })}
        ${field('Conversão p/ venda', 'msg.conv', { pct: 1, step: '0.01' })}
      </div>
      <div class="st-ch" style="border-color:#7c3aed">
        <div class="st-ch-h" style="color:#7c3aed">📋 Leads <span class="tiny muted">(formulário)</span></div>
        <div class="tiny muted" style="padding:6px 0">% do investimento: <b id="st-mixlead">—</b> (resto)</div>
        ${field('CPL (custo/lead)', 'lead.cpl', { money: 1 })}
        ${field('Conversão p/ venda', 'lead.conv', { pct: 1, step: '0.01' })}
      </div>
    </div>
    <div class="tiny muted" id="st-msg" style="margin-top:6px">${esc(_msg)}</div>
    <div id="st-out"></div>`;
  }
  _root.innerHTML = `
  <div class="card">
    <h2 class="card-title">📣 Simulador de Tráfego</h2>
    <p class="card-sub">Cada linha tem funil próprio (CPL, conversão, ticket, tempo). Escolha a linha ou o consolidado.</p>
    <div class="st-tabs">${tabs}</div>
    ${body}
    <div class="tiny muted" style="margin-top:14px"><a href="#/metricas-viab" style="color:var(--psm-gold)">← voltar pra Métrica Viab</a></div>
  </div>
  <style>
    .st-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 6px}
    .st-tab{padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);cursor:pointer;font-weight:700;font-size:13px}
    .st-tab.on{color:#fff}
    .st-sec{font-size:11px;text-transform:uppercase;font-weight:800;color:var(--text-2,#94a3b8);letter-spacing:.5px;margin:20px 0 8px}
    .st-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:var(--bg-3);border-radius:12px;padding:14px}
    .st-grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
    .st-ch{background:var(--bg-3);border-radius:12px;padding:14px;border-left:4px solid}
    .st-ch-h{font-weight:800;font-size:13px;margin-bottom:8px}
    .st-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
    .st-kpi{border-radius:12px;padding:14px;text-align:center;color:#fff}
    .st-kpi .l{font-size:9.5px;text-transform:uppercase;opacity:.85;font-weight:700;letter-spacing:.3px}
    .st-kpi .v{font-size:19px;font-weight:800;margin-top:5px;line-height:1.1}
    .st-kpi .s{font-size:10px;opacity:.8;margin-top:2px}
    .st-cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .st-cen{border-radius:12px;padding:14px;border:1px solid var(--border);background:var(--bg-2)}
    @media(max-width:880px){.st-grid4,.st-kpis{grid-template-columns:repeat(2,1fr)}.st-grid2,.st-cards3{grid-template-columns:1fr}}
  </style>`;
  _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { _s.active = b.dataset.tab; save(); render(); }));
  if (!isConsol) bindInputs();
  renderOut();
}
function tabBtn(id, label, cor) {
  const on = _s.active === id;
  return `<button class="st-tab ${on ? 'on' : ''}" data-tab="${id}" style="${on ? `background:${cor};border-color:${cor}` : ''}">${label}</button>`;
}
function field(label, path, o = {}) {
  const L = _s[_s.active]; const v = getP(L, path);
  return `<div>
    <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:3px">${label}</label>
    <div class="flex gap-1" style="align-items:center">
      ${o.money ? '<span class="tiny muted" style="font-weight:700">R$</span>' : ''}
      <input type="number" step="${o.step || 'any'}" class="input" data-path="${path}" value="${v ?? ''}" style="flex:1;font-size:12px;padding:6px 8px;min-width:0">
      ${o.pct ? '<span class="tiny muted">%</span>' : ''}
    </div></div>`;
}
function bindInputs() {
  _root.querySelectorAll('.st-grid4 [data-path], .st-grid2 [data-path]').forEach(el => el.addEventListener('input', () => {
    setP(_s[_s.active], el.dataset.path, parseFloat(el.value) || 0); save(); renderOut();
  }));
  const pux = document.getElementById('st-puxar'); if (pux) pux.addEventListener('click', puxarReal);
  const apl = document.getElementById('st-aplicar'); if (apl) apl.addEventListener('click', () => {
    if (_real && !_real.erro) { const L = _s[_s.active];
      L.investMes = Math.round(_real.spend) || L.investMes;
      L.lead.cpl = Math.round(_real.cpl) || L.lead.cpl;
      L.lead.conv = Math.round(_real.convReal * 100) / 100 || L.lead.conv;
      save(); render();
    }
  });
}

/* ── outputs ── */
function renderOut() {
  const out = document.getElementById('st-out'); if (!out) return;
  if (_s.active === 'consol') { out.innerHTML = consolView(); return; }
  const L = _s[_s.active];
  const ml = document.getElementById('st-mixlead'); if (ml) ml.textContent = (100 - L.mixMsgPct).toFixed(0) + '%';
  const base = funnel(L, 1), cart = carteira(L, base), ot = otimizar(L, base);
  const cens = CEN.map(c => ({ ...c, f: funnel(L, c.mult) }));
  const pd = projData(L);

  out.innerHTML = `
    <div class="st-sec">🎯 Resultado (Realista) — ⏱ converte em ~${L.tempoConv} ${L.tempoConv == 1 ? 'mês' : 'meses'}</div>
    <div class="st-kpis">
      ${kpi('VGV / mês', fK(base.vgv), '#1e293b', f1(base.vendas) + ' vendas')}
      ${kpi('💰 Caixa empresa/mês', fK(base.caixa), base.caixa >= 0 ? '#16a34a' : '#dc2626', 'margem ' + base.margemPct.toFixed(0) + '%')}
      ${kpi('ROAS', f1(base.roas) + 'x', '#0ea5e9', 'VGV ÷ invest.')}
      ${kpi('CPA', f$(base.cpa), '#7c3aed', 'custo/venda')}
      ${kpi('⭐ CPL break-even', f$(base.cplBE), '#d97706', 'CPL atual ' + f$(base.cplBlend))}
      ${kpi(base.cplBlend <= base.cplBE ? '✅ Tráfego' : '🔴 Tráfego', base.cplBlend <= base.cplBE ? 'PAGA' : 'QUEIMA', base.cplBlend <= base.cplBE ? '#16a34a' : '#dc2626', 'folga ' + f$(base.cplBE - base.cplBlend))}
    </div>

    <div class="st-sec">🔻 Funil</div>
    <div style="background:var(--bg-3);border-radius:12px;padding:16px">
      ${funilBar('💸 Investimento/mês', f$(L.investMes), 100, '#64748b', '💬 ' + f$(base.invMsg) + ' · 📋 ' + f$(base.invLead))}
      ${funilBar('👥 Leads gerados', f1(base.leads), 100, '#0ea5e9', '💬 ' + f1(base.leadsMsg) + ' · 📋 ' + f1(base.leadsLead) + ' · CPL méd ' + f$(base.cplBlend))}
      ${funilBar('✅ Qualificados', f1(base.qualif), pct(base.qualif, base.leads), '#6366f1', '−' + L.descartePct + '% descarte')}
      ${funilBar('🤝 Vendas', f1(base.vendas), pct(base.vendas, base.leads), '#7c3aed', 'conv méd ' + base.convBlend.toFixed(2) + '%')}
      ${funilBar('🏆 VGV', fK(base.vgv), pct(base.vendas, base.leads), '#16a34a', 'ticket ' + f$(L.ticket))}
    </div>

    <div class="st-sec">📊 Cenários (variação de conversão)</div>
    <div class="st-cards3">${cens.map(cenCard).join('')}</div>

    <div class="st-cards3" style="margin-top:14px">
      <div class="st-cen" style="border-left:4px solid #d97706">
        <div style="font-weight:800;margin-bottom:8px">🗂️ Carteira de leads + LTV</div>
        ${linha('Leads não convertidos/mês', f1(cart.naoConv))}
        ${linha('Convertem depois (' + L.taxaCarteira + '%)', f1(cart.vendasFut) + ' vendas')}
        ${linha('VGV futuro da carteira', fK(cart.vgvFut))}
        ${linha('💎 Valor (×LTV ' + L.ltv + ')', '<b style="color:#d97706">' + f$(cart.valorLTV) + '/mês</b>')}
      </div>
      <div class="st-cen" style="border-left:4px solid #16a34a;grid-column:span 2">
        <div style="font-weight:800;margin-bottom:8px">🧮 Otimizador — quanto preciso pra bater a meta</div>
        <div class="flex gap-2" style="align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
          <div><label class="tiny muted" style="display:block">Meta de</label>
            <select class="input" id="st-metatipo" style="font-size:12px;padding:6px 8px">
              <option value="vgv" ${L.metaTipo === 'vgv' ? 'selected' : ''}>VGV (R$)</option>
              <option value="vendas" ${L.metaTipo === 'vendas' ? 'selected' : ''}>Nº de vendas</option>
            </select></div>
          <div style="min-width:160px">${field(L.metaTipo === 'vgv' ? 'Valor (R$)' : 'Vendas/mês', 'metaValor', { money: L.metaTipo === 'vgv' })}</div>
        </div>
        <div class="st-kpis" style="grid-template-columns:repeat(3,1fr)">
          ${kpi('Investimento necessário', fK(ot.investNec), '#16a34a', 'no CPL atual ' + f$(base.cplBlend))}
          ${kpi('ou CPL-alvo', f$(ot.cplAlvo), '#0ea5e9', 'no orçamento atual ' + fK(L.investMes))}
          ${kpi('Leads necessários', f1(ot.leadsNec), '#7c3aed', f1(ot.vendasNec) + ' vendas')}
        </div>
      </div>
    </div>

    <div class="st-sec">📈 Projeção 24 meses — caixa acumulado <span class="tiny muted" style="font-weight:400">(com atraso de ${L.tempoConv} meses entre lead e venda)</span></div>
    ${projChart(pd)}
  `;
  const mt = document.getElementById('st-metatipo'); if (mt) mt.addEventListener('change', () => { _s[_s.active].metaTipo = mt.value; save(); renderOut(); });
  out.querySelectorAll('[data-path]').forEach(el => el.addEventListener('input', () => { setP(_s[_s.active], el.dataset.path, parseFloat(el.value) || 0); save(); clearTimeout(window._stoo); window._stoo = setTimeout(renderOut, 350); }));
}

function consolView() {
  const c = consolidado(1);
  const pds = LINES.map(ln => ({ ln, pd: projData(_s[ln.id]) }));
  const real = new Array(8).fill(0); pds.forEach(p => p.pd.real.forEach((v, i) => real[i] += v));
  let ac = 0; const acum = real.map(r => (ac += r));
  const labels = pds[0].pd.labels;
  const rows = LINES.map(ln => { const f = funnel(_s[ln.id], 1); const m = lineMeta(ln.id);
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:7px 10px;font-weight:700;color:${m.cor}">${m.icon} ${m.nome}</td>
      <td style="text-align:right;padding:7px 10px">${f$(_s[ln.id].investMes)}</td>
      <td style="text-align:right;padding:7px 10px">${f1(f.leads)}</td>
      <td style="text-align:right;padding:7px 10px">${f1(f.vendas)}</td>
      <td style="text-align:right;padding:7px 10px">${fK(f.vgv)}</td>
      <td style="text-align:right;padding:7px 10px;color:${f.caixa >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${f$(f.caixa)}</td>
      <td style="text-align:right;padding:7px 10px">${f1(f.roas)}x</td></tr>`; }).join('');
  return `
    <div class="st-sec">📊 Consolidado (M.A.P + Conquista)</div>
    <div class="st-kpis">
      ${kpi('Investimento/mês', fK(c.investMes), '#1e293b', '')}
      ${kpi('VGV / mês', fK(c.vgv), '#7c3aed', f1(c.vendas) + ' vendas')}
      ${kpi('💰 Caixa/mês', fK(c.caixa), c.caixa >= 0 ? '#16a34a' : '#dc2626', 'margem ' + c.margemPct.toFixed(0) + '%')}
      ${kpi('ROAS', f1(c.roas) + 'x', '#0ea5e9', '')}
      ${kpi('CPA médio', f$(c.cpa), '#d97706', '')}
      ${kpi('Leads/mês', f1(c.leads), '#16a34a', 'CPL méd ' + f$(c.cplBlend))}
    </div>
    <div class="st-sec">Por linha</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:560px">
      <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:8px 10px">Linha</th><th style="text-align:right;padding:8px 10px">Invest.</th><th style="text-align:right;padding:8px 10px">Leads</th><th style="text-align:right;padding:8px 10px">Vendas</th><th style="text-align:right;padding:8px 10px">VGV</th><th style="text-align:right;padding:8px 10px">Caixa</th><th style="text-align:right;padding:8px 10px">ROAS</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="st-sec">📈 Projeção 24m — caixa acumulado consolidado <span class="tiny muted" style="font-weight:400">(cada linha com seu atraso)</span></div>
    ${projChart({ labels, acum })}`;
}

function kpi(l, v, bg, s) { return `<div class="st-kpi" style="background:${bg}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`; }
function pct(v, max) { return max > 0 ? Math.max(4, Math.round(v / max * 100)) : 0; }
function funilBar(label, val, width, cor, sub) {
  return `<div style="margin-bottom:9px">
    <div class="flex" style="justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="font-weight:700">${label}</span><span style="font-weight:800">${val}</span></div>
    <div style="background:var(--bg-2);border-radius:6px;height:24px;position:relative;overflow:hidden">
      <div style="position:absolute;inset:0 auto 0 0;width:${width}%;background:${cor};border-radius:6px;opacity:.85"></div>
      <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--text-2,#94a3b8)">${sub}</span>
    </div></div>`;
}
function cenCard(c) {
  const ok = c.f.cplBlend <= c.f.cplBE;
  return `<div class="st-cen" style="border-top:4px solid ${c.cor}">
    <div class="flex" style="justify-content:space-between;align-items:center">
      <span style="font-weight:800;color:${c.cor}">${c.nome}</span><span style="font-size:11px">${ok ? '🟢' : '🔴'} conv ×${c.mult}</span></div>
    <div style="font-size:22px;font-weight:800;margin:8px 0 2px;color:${c.f.caixa >= 0 ? '#16a34a' : '#dc2626'}">${f$(c.f.caixa)}<span class="tiny muted" style="font-weight:600"> caixa/mês</span></div>
    ${linha('Vendas/mês', f1(c.f.vendas))}${linha('VGV/mês', fK(c.f.vgv))}${linha('ROAS', f1(c.f.roas) + 'x')}${linha('Margem', c.f.margemPct.toFixed(0) + '%')}
  </div>`;
}
function linha(l, v) { return `<div class="flex" style="justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--border)"><span class="muted">${l}</span><span style="font-weight:700">${v}</span></div>`; }
function projChart(pd) {
  const acum = pd.acum, labels = pd.labels;
  const max = Math.max(1, ...acum.map(Math.abs));
  const bars = acum.map((a, i) => {
    const h = Math.max(4, Math.round(Math.abs(a) / max * 110));
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px">
      <div class="tiny" style="font-weight:700;color:${a >= 0 ? '#16a34a' : '#dc2626'}">${fK(a)}</div>
      <div style="width:70%;height:${h}px;background:${a >= 0 ? 'linear-gradient(180deg,#16a34a,#15803d)' : '#dc2626'};border-radius:5px 5px 0 0"></div>
      <div class="tiny muted">${labels[i]}</div></div>`;
  }).join('');
  return `<div style="background:var(--bg-3);border-radius:12px;padding:16px">
    <div style="display:flex;align-items:flex-end;gap:6px;height:150px">${bars}</div>
    <div class="tiny muted" style="margin-top:8px">Acumulado final: <b style="color:${acum[7] >= 0 ? '#16a34a' : '#dc2626'}">${f$(acum[7])}</b> em 24 meses. O início é menor porque a venda só entra depois do tempo de conversão.</div>
  </div>`;
}

/* ── 🔄 ciclo de feedback: Meta + CRM → linha ativa ── */
function realPanel() {
  if (!_real) return `<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="st-puxar">📡 Puxar realizado (Meta + CRM)</button> <span class="tiny muted">— investimento/CPL do Meta + conversão real do CRM → canal Leads desta linha</span></div>`;
  if (_real.erro) return `<div class="alert alert-warn" style="margin-top:10px">⚠️ ${esc(_real.erro)} <button class="btn btn-ghost btn-sm" id="st-puxar">tentar de novo</button></div>`;
  const rk = (l, v) => `<div style="background:var(--bg-2);border-radius:8px;padding:8px"><div class="tiny muted">${l}</div><div style="font-weight:800">${v}</div></div>`;
  return `<div style="margin-top:10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:12px">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-weight:800">📡 Realizado (Meta + CRM) <span class="tiny muted">· ${esc(_real.periodo)}</span></div>
      <div class="flex gap-2"><button class="btn btn-ghost btn-sm" id="st-puxar">↻ atualizar</button><button class="btn btn-primary btn-sm" id="st-aplicar">aplicar nesta linha →</button></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px;font-size:12.5px">
      ${rk('Investimento', f$(_real.spend))}${rk('Leads', Math.round(_real.leads))}${rk('CPL real', f$(_real.cpl))}${rk('Conversão real', _real.convReal.toFixed(2) + '%')}
    </div>
    <div class="tiny muted" style="margin-top:6px">Conversão real = vendas/mês do CRM (${_real.vendasMes.toFixed(1)}) ÷ leads do período (Meta) — teto (vendas multicanal/agregadas, não por linha ainda).</div>
  </div>`;
}
async function puxarReal() {
  const b = document.getElementById('st-puxar'); if (b) { b.disabled = true; b.textContent = 'Puxando…'; }
  try {
    const [mkt, atg] = await Promise.all([
      api.request('/api/v3/marketing/summary').catch(() => null),
      api.request('/api/v3/metas/atingimento').catch(() => null),
    ]);
    const accs = (mkt && mkt.accounts) || [];
    const spend = accs.reduce((s, a) => s + (+a.spend || 0), 0);
    const results = accs.reduce((s, a) => s + (+a.results || 0), 0);
    const leads = accs.reduce((s, a) => s + (+a.leads || 0), 0) || results;
    const cpl = results > 0 ? spend / results : (leads > 0 ? spend / leads : 0);
    const vendasMes = (+(atg && atg.total_vendas || 0)) / MESES;
    const convReal = leads > 0 ? (vendasMes / leads * 100) : 0;
    _real = (spend === 0 && results === 0) ? { erro: 'Meta Ads sem dados agora (token/período). Veja a aba Marketing.' }
      : { spend, results, leads, cpl, vendasMes, convReal, periodo: (mkt && mkt.period) || 'período atual' };
  } catch (e) { _real = { erro: e.message }; }
  render();
}
