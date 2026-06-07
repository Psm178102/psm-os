/* PSM-OS v2 — 📣 Simulador de Tráfego (Meta Ads → Leads → Vendas → Caixa)
   Reescrito do SIMULADOR-ADS.xlsx, completo + premium:
   - 2 canais (Mensagens × Leads/Formulário), cada um com CPL e conversão próprios
   - funil visual (investimento → leads → qualificados → vendas → VGV)
   - 3 cenários (Pessimista/Realista/Otimista) por multiplicador de conversão
   - ⭐ CPL break-even (CPL máximo que o tráfego ainda paga)
   - 🗂️ Carteira de leads + LTV (leads que não fecham agora e convertem depois)
   - 🧮 Otimizador (meta de VGV/vendas → investimento e CPL-alvo necessários)
   - 🔄 Puxar realizado (Meta + CRM) — fecha o ciclo de feedback
   - 📈 Projeção 24m do caixa acumulado
   Arquitetura: inputs fixos + outputs em #st-out (re-render sem perder foco).
   Persistido no board sim_trafego. Diretoria lvl≥7. */
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

const CEN = [
  { id: 'pess', nome: 'Pessimista', mult: 0.7, cor: '#dc2626' },
  { id: 'real', nome: 'Realista', mult: 1.0, cor: '#2563eb' },
  { id: 'otim', nome: 'Otimista', mult: 1.3, cor: '#16a34a' },
];

const DEFAULTS = {
  ticket: 234000, comissaoPct: 4, corretorPct: 40, descartePct: 10,
  custoOperMes: 0, ltv: 0.5, taxaCarteira: 5,
  investMes: 7500, mixMsgPct: 40,
  msg: { cpl: 8, conv: 0.5 },    // Mensagens (WhatsApp/Direct): CPL menor, conversão menor
  lead: { cpl: 18, conv: 1.0 },  // Leads (formulário): CPL maior, intenção maior
  crescInvestTrim: 6, encarecCplTrim: 5,
  metaTipo: 'vgv', metaValor: 6000000,
};

export async function pageSimTrafego(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Diretor (lvl 7+).</div>'; return; }
  _s = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const cache = JSON.parse(localStorage.getItem('psm_sim_trafego') || 'null');
    if (cache) _s = mergeDefaults(cache);
  } catch {}
  render();
  try {
    const b = await api.request('/api/v3/diretoria/strategy?board=sim_trafego').catch(() => null);
    if (b && b.ok && b.data && b.data.cfg) { _s = mergeDefaults(b.data.cfg); render(); }
  } catch {}
}
function mergeDefaults(c) {
  const o = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(o)) if (c[k] !== undefined) {
    o[k] = (o[k] && typeof o[k] === 'object') ? Object.assign(o[k], c[k]) : c[k];
  }
  return o;
}

function save() {
  try { localStorage.setItem('psm_sim_trafego', JSON.stringify(_s)); } catch {}
  clearTimeout(window._stt);
  window._stt = setTimeout(async () => {
    try { const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'sim_trafego', data: { cfg: _s } } });
      _msg = (r && r.ok) ? '💾 salvo' : '⚠️ ' + (r && r.error || ''); }
    catch (e) { _msg = '⚠️ ' + e.message; }
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

/* ── motor ── */
function funnel(convMult = 1) {
  const s = _s;
  const invMsg = s.investMes * s.mixMsgPct / 100;
  const invLead = s.investMes - invMsg;
  const leadsMsg = s.msg.cpl > 0 ? invMsg / s.msg.cpl : 0;
  const leadsLead = s.lead.cpl > 0 ? invLead / s.lead.cpl : 0;
  const leads = leadsMsg + leadsLead;
  const fator = 1 - s.descartePct / 100;
  const qualif = leads * fator;
  const vendasMsg = leadsMsg * fator * (s.msg.conv * convMult) / 100;
  const vendasLead = leadsLead * fator * (s.lead.conv * convMult) / 100;
  const vendas = vendasMsg + vendasLead;
  const vgv = vendas * s.ticket;
  const receita = vgv * s.comissaoPct / 100;
  const fx = faixa(receita * 12);
  const imposto = receita * fx.r;
  const liquido = receita - imposto;
  const corretor = liquido * s.corretorPct / 100;
  const caixa = liquido - corretor - (+s.custoOperMes || 0);
  const roas = s.investMes > 0 ? vgv / s.investMes : 0;
  const cpa = vendas > 0 ? s.investMes / vendas : 0;
  const cplBlend = leads > 0 ? s.investMes / leads : 0;
  const convBlend = qualif > 0 ? vendas / qualif * 100 : 0;
  const caixaPorVenda = s.ticket * s.comissaoPct / 100 * (1 - fx.r) * (1 - s.corretorPct / 100);
  const cplBE = fator * (convBlend / 100) * caixaPorVenda;
  const margemPct = receita > 0 ? caixa / receita * 100 : 0;
  return { invMsg, invLead, leadsMsg, leadsLead, leads, qualif, vendasMsg, vendasLead, vendas, vgv, receita, imposto, liquido, corretor, caixa, roas, cpa, cplBlend, convBlend, cplBE, margemPct, aliq: fx.r, cat: fx.cat };
}
function carteira(f) {
  const naoConv = Math.max(0, f.qualif - f.vendas);
  const vendasFut = naoConv * (_s.taxaCarteira / 100);
  const vgvFut = vendasFut * _s.ticket;
  const receitaFut = vgvFut * _s.comissaoPct / 100;
  const valorLTV = receitaFut * _s.ltv;
  return { naoConv, vendasFut, vgvFut, valorLTV };
}
function otimizar(f) {
  const s = _s;
  const vendasNec = s.metaTipo === 'vgv' ? (s.ticket > 0 ? s.metaValor / s.ticket : 0) : s.metaValor;
  const convB = (f.convBlend / 100) || 0.0001;
  const leadsNec = vendasNec / ((1 - s.descartePct / 100) * convB);
  const investNec = leadsNec * f.cplBlend;
  const cplAlvo = leadsNec > 0 ? s.investMes / leadsNec : 0;
  return { vendasNec, leadsNec, investNec, cplAlvo };
}

/* ── render: skeleton (inputs fixos) + #st-out (outputs) ── */
function render() {
  if (!_root) return;
  _root.innerHTML = `
  <div class="card">
    <h2 class="card-title">📣 Simulador de Tráfego</h2>
    <p class="card-sub">Meta Ads → leads → funil → vendas → caixa. 2 canais, carteira/LTV e otimizador. Sócio/Diretor.</p>
    ${realPanel()}

    <div class="st-sec">⚙️ Premissas</div>
    <div class="st-grid4">
      ${field('Ticket médio', 'ticket', { money: 1 })}
      ${field('Comissão imobiliária', 'comissaoPct', { pct: 1 })}
      ${field('% Corretor (do líquido)', 'corretorPct', { pct: 1 })}
      ${field('% Descarte de leads', 'descartePct', { pct: 1 })}
      ${field('Custo operacional/mês', 'custoOperMes', { money: 1 })}
      ${field('LTV (carteira)', 'ltv')}
      ${field('Taxa conv. carteira', 'taxaCarteira', { pct: 1 })}
      ${field('Investimento/mês', 'investMes', { money: 1 })}
    </div>

    <div class="st-sec">📣 Canais — Mensagens × Leads <span class="tiny muted" style="font-weight:400">(mix do investimento + CPL e conversão de cada)</span></div>
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

    <div id="st-out"></div>
    <div class="tiny muted" style="margin-top:14px"><a href="#/metricas-viab" style="color:var(--psm-gold)">← voltar pra Métrica Viab</a></div>
  </div>
  <style>
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
  bindInputs();
  renderOut();
}

function field(label, path, o = {}) {
  const v = getP(_s, path);
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
    setP(_s, el.dataset.path, parseFloat(el.value) || 0); save(); renderOut();
  }));
  const pux = document.getElementById('st-puxar'); if (pux) pux.addEventListener('click', puxarReal);
  const apl = document.getElementById('st-aplicar'); if (apl) apl.addEventListener('click', () => {
    if (_real && !_real.erro) {
      _s.investMes = Math.round(_real.spend) || _s.investMes;
      _s.lead.cpl = Math.round(_real.cpl) || _s.lead.cpl;
      _s.lead.conv = Math.round(_real.convReal * 100) / 100 || _s.lead.conv;
      save(); render();
    }
  });
}

/* ── outputs ── */
function renderOut() {
  const out = document.getElementById('st-out'); if (!out) return;
  const ml = document.getElementById('st-mixlead'); if (ml) ml.textContent = (100 - _s.mixMsgPct).toFixed(0) + '%';
  const base = funnel(1);
  const cart = carteira(base);
  const ot = otimizar(base);
  const cens = CEN.map(c => ({ ...c, f: funnel(c.mult) }));

  out.innerHTML = `
    <div class="st-sec">🎯 Resultado (cenário Realista)</div>
    <div class="st-kpis">
      ${kpi('VGV / mês', fK(base.vgv), '#1e293b', f1(base.vendas) + ' vendas')}
      ${kpi('💰 Caixa empresa/mês', fK(base.caixa), base.caixa >= 0 ? '#16a34a' : '#dc2626', 'margem ' + base.margemPct.toFixed(0) + '%')}
      ${kpi('ROAS', f1(base.roas) + 'x', '#0ea5e9', 'VGV ÷ invest.')}
      ${kpi('CPA', f$(base.cpa), '#7c3aed', 'custo/venda')}
      ${kpi('⭐ CPL break-even', f$(base.cplBE), '#d97706', 'CPL atual ' + f$(base.cplBlend))}
      ${kpi(base.cplBlend <= base.cplBE ? '✅ Tráfego' : '🔴 Tráfego', base.cplBlend <= base.cplBE ? 'PAGA' : 'QUEIMA', base.cplBlend <= base.cplBE ? '#16a34a' : '#dc2626', 'folga ' + f$(base.cplBE - base.cplBlend))}
    </div>

    <div class="st-sec">🔻 Funil (Realista)</div>
    <div style="background:var(--bg-3);border-radius:12px;padding:16px">
      ${funilBar('💸 Investimento/mês', f$(_s.investMes), 100, '#64748b', '💬 ' + f$(base.invMsg) + ' · 📋 ' + f$(base.invLead))}
      ${funilBar('👥 Leads gerados', f1(base.leads), 100, '#0ea5e9', '💬 ' + f1(base.leadsMsg) + ' · 📋 ' + f1(base.leadsLead) + ' · CPL méd ' + f$(base.cplBlend))}
      ${funilBar('✅ Qualificados', f1(base.qualif), pct(base.qualif, base.leads), '#6366f1', '−' + _s.descartePct + '% descarte')}
      ${funilBar('🤝 Vendas', f1(base.vendas), pct(base.vendas, base.leads), '#7c3aed', 'conversão méd ' + base.convBlend.toFixed(2) + '%')}
      ${funilBar('🏆 VGV', fK(base.vgv), pct(base.vendas, base.leads), '#16a34a', 'ticket ' + f$(_s.ticket))}
    </div>

    <div class="st-sec">📊 Cenários (variação de conversão)</div>
    <div class="st-cards3">${cens.map(cenCard).join('')}</div>

    <div class="st-cards3" style="margin-top:14px">
      <div class="st-cen" style="border-left:4px solid #d97706">
        <div style="font-weight:800;margin-bottom:8px">🗂️ Carteira de leads + LTV</div>
        ${linha('Leads não convertidos/mês', f1(cart.naoConv))}
        ${linha('Convertem depois (' + _s.taxaCarteira + '%)', f1(cart.vendasFut) + ' vendas')}
        ${linha('VGV futuro da carteira', fK(cart.vgvFut))}
        ${linha('💎 Valor da carteira (×LTV ' + _s.ltv + ')', '<b style="color:#d97706">' + f$(cart.valorLTV) + '/mês</b>')}
        <div class="tiny muted" style="margin-top:6px">Receita futura dos leads que não fecham agora.</div>
      </div>
      <div class="st-cen" style="border-left:4px solid #16a34a;grid-column:span 2">
        <div style="font-weight:800;margin-bottom:8px">🧮 Otimizador — quanto preciso pra bater a meta</div>
        <div class="flex gap-2" style="align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
          <div><label class="tiny muted" style="display:block">Meta de</label>
            <select class="input" id="st-metatipo" style="font-size:12px;padding:6px 8px">
              <option value="vgv" ${_s.metaTipo === 'vgv' ? 'selected' : ''}>VGV (R$)</option>
              <option value="vendas" ${_s.metaTipo === 'vendas' ? 'selected' : ''}>Nº de vendas</option>
            </select></div>
          <div style="min-width:160px">${field(_s.metaTipo === 'vgv' ? 'Valor (R$)' : 'Vendas/mês', 'metaValor', { money: _s.metaTipo === 'vgv' })}</div>
        </div>
        <div class="st-kpis" style="grid-template-columns:repeat(3,1fr)">
          ${kpi('Investimento necessário', fK(ot.investNec), '#16a34a', 'no CPL atual ' + f$(base.cplBlend))}
          ${kpi('ou CPL-alvo', f$(ot.cplAlvo), '#0ea5e9', 'no orçamento atual ' + fK(_s.investMes))}
          ${kpi('Leads necessários', f1(ot.leadsNec), '#7c3aed', f1(ot.vendasNec) + ' vendas')}
        </div>
        <div class="tiny muted" style="margin-top:6px">Pra <b>${_s.metaTipo === 'vgv' ? fK(_s.metaValor) + ' de VGV' : f1(_s.metaValor) + ' vendas'}</b>: invista <b>${fK(ot.investNec)}/mês</b> (mantendo CPL/conversão atuais) — ou, no orçamento de hoje, busque CPL ≤ <b>${f$(ot.cplAlvo)}</b>.</div>
      </div>
    </div>

    <div class="st-sec">📈 Projeção 24 meses — caixa acumulado (Realista)</div>
    ${projChart()}
  `;
  const mt = document.getElementById('st-metatipo'); if (mt) mt.addEventListener('change', () => { _s.metaTipo = mt.value; save(); renderOut(); });
  out.querySelectorAll('[data-path]').forEach(el => el.addEventListener('input', () => { setP(_s, el.dataset.path, parseFloat(el.value) || 0); save(); clearTimeout(window._stoo); window._stoo = setTimeout(renderOut, 350); }));
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
      <span style="font-weight:800;color:${c.cor}">${c.nome}</span>
      <span style="font-size:11px">${ok ? '🟢' : '🔴'} conv ×${c.mult}</span>
    </div>
    <div style="font-size:22px;font-weight:800;margin:8px 0 2px;color:${c.f.caixa >= 0 ? '#16a34a' : '#dc2626'}">${f$(c.f.caixa)}<span class="tiny muted" style="font-weight:600"> caixa/mês</span></div>
    ${linha('Vendas/mês', f1(c.f.vendas))}
    ${linha('VGV/mês', fK(c.f.vgv))}
    ${linha('ROAS', f1(c.f.roas) + 'x')}
    ${linha('Margem', c.f.margemPct.toFixed(0) + '%')}
  </div>`;
}
function linha(l, v) { return `<div class="flex" style="justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--border)"><span class="muted">${l}</span><span style="font-weight:700">${v}</span></div>`; }

function projChart() {
  const labels = [], acum = [];
  let inv = _s.investMes, cplM = _s.msg.cpl, cplL = _s.lead.cpl, ac = 0;
  const save0 = { investMes: _s.investMes, mc: _s.msg.cpl, lc: _s.lead.cpl };
  for (let t = 0; t < 8; t++) {
    if (t >= 4) { inv *= (1 + _s.crescInvestTrim / 100); cplM *= (1 + _s.encarecCplTrim / 100); cplL *= (1 + _s.encarecCplTrim / 100); }
    _s.investMes = inv; _s.msg.cpl = cplM; _s.lead.cpl = cplL;
    const fx = funnel(1);
    ac += fx.caixa * 3;
    labels.push((t < 4 ? '1A·T' : '2A·T') + ((t % 4) + 1)); acum.push(ac);
  }
  _s.investMes = save0.investMes; _s.msg.cpl = save0.mc; _s.lead.cpl = save0.lc;
  const max = Math.max(1, ...acum.map(Math.abs));
  const bars = acum.map((a, i) => {
    const h = Math.max(4, Math.round(Math.abs(a) / max * 110));
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px">
      <div class="tiny" style="font-weight:700;color:${a >= 0 ? '#16a34a' : '#dc2626'}">${fK(a)}</div>
      <div style="width:70%;height:${h}px;background:${a >= 0 ? 'linear-gradient(180deg,#16a34a,#15803d)' : '#dc2626'};border-radius:5px 5px 0 0"></div>
      <div class="tiny muted">${labels[i]}</div>
    </div>`;
  }).join('');
  return `<div style="background:var(--bg-3);border-radius:12px;padding:16px">
    <div style="display:flex;align-items:flex-end;gap:6px;height:150px">${bars}</div>
    <div class="tiny muted" style="margin-top:8px">Invest. cresce ${_s.crescInvestTrim}%/tri e CPL encarece ${_s.encarecCplTrim}%/tri no Ano 2. Acumulado final: <b style="color:${acum[7] >= 0 ? '#16a34a' : '#dc2626'}">${f$(acum[7])}</b> em 24 meses.</div>
  </div>`;
}

/* ── 🔄 ciclo de feedback: Meta + CRM → simulador ── */
function realPanel() {
  if (!_real) return `<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="st-puxar">📡 Puxar realizado (Meta + CRM)</button> <span class="tiny muted">— traz investimento/CPL do Meta + conversão real do CRM</span></div>`;
  if (_real.erro) return `<div class="alert alert-warn" style="margin-top:10px">⚠️ ${esc(_real.erro)} <button class="btn btn-ghost btn-sm" id="st-puxar">tentar de novo</button></div>`;
  const rk = (l, v) => `<div style="background:var(--bg-2);border-radius:8px;padding:8px"><div class="tiny muted">${l}</div><div style="font-weight:800">${v}</div></div>`;
  return `<div style="margin-top:10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:12px">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-weight:800">📡 Realizado (Meta + CRM) <span class="tiny muted">· ${esc(_real.periodo)}</span></div>
      <div class="flex gap-2"><button class="btn btn-ghost btn-sm" id="st-puxar">↻ atualizar</button><button class="btn btn-primary btn-sm" id="st-aplicar">aplicar (invest./CPL/conversão) →</button></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px;font-size:12.5px">
      ${rk('Investimento', f$(_real.spend))}${rk('Leads', Math.round(_real.leads))}${rk('CPL real', f$(_real.cpl))}${rk('Conversão real', _real.convReal.toFixed(2) + '%')}
    </div>
    <div class="tiny muted" style="margin-top:6px">Conversão real = vendas/mês do CRM (${_real.vendasMes.toFixed(1)}) ÷ leads do período (Meta) — é um teto (vendas são multicanal). "Aplicar" joga investimento, CPL e conversão reais no canal Leads.</div>
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
