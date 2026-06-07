/* PSM-OS v2 — 📣 Simulador de Tráfego (Meta Ads → Leads → Vendas → Caixa)
   Reescrito do SIMULADOR-ADS.xlsx do Paulo, com correções:
   - cada cenário tem seu PRÓPRIO CPL (CPL baixo→mais leads; CPL alto→menos, melhor conversão)
   - imposto por faixa ANUAL (Simples) consistente
   - "caixa da empresa" desconta o custo operacional/mês (liga na realidade)
   - CPL break-even (o CPL máximo que o tráfego ainda paga) em destaque
   Persistido no board sim_trafego (compartilhado). Diretoria lvl≥7. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _s = null, _msg = '';

// faixas Simples (faturamento anual da comissão → alíquota) — editáveis no futuro
const FAIXAS = [
  { ate: 180000, r: 0.10, cat: 'A' }, { ate: 360000, r: 0.114, cat: 'B' },
  { ate: 720000, r: 0.135, cat: 'C' }, { ate: 1800000, r: 0.16, cat: 'D' },
  { ate: 4800000, r: 0.21, cat: 'E' }, { ate: Infinity, r: 0.33, cat: 'SONEGA' },
];
function faixa(receitaAno) { return FAIXAS.find(f => receitaAno <= f.ate) || FAIXAS[FAIXAS.length - 1]; }

const DEFAULTS = {
  ticket: 234000, comissaoPct: 4, corretorPct: 40, descartePct: 10, ltv: 0.5,
  investMes: 7500, custoOperMes: 0, crescInvestTrim: 6, encarecCplTrim: 5,
  cenarios: [
    { nome: 'Volume (CPL baixo)', cpl: 12, conv: 0.68 },
    { nome: 'Equilíbrio (CPL médio)', cpl: 22, conv: 1.0 },
    { nome: 'Qualidade (CPL alto)', cpl: 40, conv: 1.3 },
  ],
};

export async function pageSimTrafego(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Diretor (lvl 7+).</div>'; return; }
  _s = JSON.parse(JSON.stringify(DEFAULTS));
  render();
  try {
    const b = await api.request('/api/v3/diretoria/strategy?board=sim_trafego').catch(() => null);
    if (b && b.ok && b.data && b.data.cfg) _s = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), b.data.cfg);
  } catch {}
  render();
}

function save() {
  try { localStorage.setItem('psm_sim_trafego', JSON.stringify(_s)); } catch {}
  clearTimeout(window._stt);
  window._stt = setTimeout(async () => {
    try { const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'sim_trafego', data: { cfg: _s } } });
      _msg = (r && r.ok) ? '💾 salvo' : '⚠️ ' + (r && r.error || ''); }
    catch (e) { _msg = '⚠️ ' + e.message; }
    const m = document.getElementById('st-msg'); if (m) m.textContent = _msg;
  }, 500);
}

/* ── motor: calcula um cenário (mensal + anual) ── */
function calc(c) {
  const s = _s;
  const leads = c.cpl > 0 ? s.investMes / c.cpl : 0;
  const qualif = leads * (1 - s.descartePct / 100);
  const vendas = qualif * (c.conv / 100);
  const vgvMes = vendas * s.ticket;
  const receitaMes = vgvMes * s.comissaoPct / 100;     // faturamento da imobiliária
  const receitaAno = receitaMes * 12;
  const fx = faixa(receitaAno);
  const impostoMes = receitaMes * fx.r;
  const liquidoMes = receitaMes - impostoMes;
  const corretorMes = liquidoMes * s.corretorPct / 100;
  const caixaBrutoMes = liquidoMes - corretorMes;       // antes do custo operacional
  const caixaMes = caixaBrutoMes - (+s.custoOperMes || 0); // caixa real da empresa
  const roas = s.investMes > 0 ? vgvMes / s.investMes : 0;
  const cpa = vendas > 0 ? s.investMes / vendas : 0;
  // CPL break-even: CPL máximo que o tráfego ainda paga (caixa da venda ≥ custo do lead)
  const caixaPorVenda = s.ticket * s.comissaoPct / 100 * (1 - fx.r) * (1 - s.corretorPct / 100);
  const cplBE = (1 - s.descartePct / 100) * (c.conv / 100) * caixaPorVenda;
  return { leads, qualif, vendas, vgvMes, receitaMes, impostoMes, liquidoMes, corretorMes, caixaMes, roas, cpa, cplBE, cat: fx.cat, aliq: fx.r };
}

function render() {
  if (!_root) return;
  const cen = _s.cenarios.map(calc);
  const f = n => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
  const f1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('pt-BR');
  const col = (fn) => _s.cenarios.map((c, i) => `<td style="text-align:right;padding:7px 10px">${fn(cen[i], c)}</td>`).join('');
  const head = _s.cenarios.map((c, i) => `<th style="text-align:right;padding:8px 10px;white-space:nowrap;color:${['#16a34a','#2563eb','#7c3aed'][i]}">${esc(c.nome)}</th>`).join('');
  const rows = [
    ['CPL (R$)', (x, c) => f(c.cpl)],
    ['Conversão', (x, c) => c.conv + '%'],
    ['Leads/mês', x => f1(x.leads)],
    ['Qualificados/mês', x => f1(x.qualif)],
    ['Vendas/mês', x => f1(x.vendas)],
    ['VGV/mês', x => f(x.vgvMes), 1],
    ['Receita comissão/mês', x => f(x.receitaMes)],
    ['Imposto (' + '%)', x => f(x.impostoMes) + ` <span class="tiny muted">(${(x.aliq * 100).toFixed(1)}% ${x.cat})</span>`],
    ['Comissão corretor/mês', x => f(x.corretorMes)],
    ['💰 Caixa empresa/mês', x => `<span style="color:${x.caixaMes >= 0 ? '#16a34a' : '#dc2626'};font-weight:800">${f(x.caixaMes)}</span>`, 1],
    ['ROAS', x => f1(x.roas) + 'x'],
    ['CPA (custo/venda)', x => f(x.cpa)],
    ['⭐ CPL break-even', x => `<b>${f(x.cplBE)}</b>`, 1],
    ['Folga do CPL (BE − atual)', (x, c) => { const d = x.cplBE - c.cpl; return `<span style="color:${d >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${d >= 0 ? '+' : ''}${f(d)}</span>`; }],
    ['Status', (x, c) => x.cplBE >= c.cpl ? '<span style="color:#16a34a;font-weight:800">✅ paga o tráfego</span>' : '<span style="color:#dc2626;font-weight:800">🔴 queima caixa</span>'],
  ];
  // projeção 24m do caixa (cenário equilíbrio), com crescimento de invest e encarecimento de CPL por trimestre
  const proj = projecao();
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📣 Simulador de Tráfego</h2>
      <p class="card-sub">Meta Ads → leads → funil → vendas → caixa. Cada cenário com CPL próprio. Sócio/Diretor.</p>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:12px 0 6px">Parâmetros gerais (editável)</div>
      <div style="background:var(--bg-3);border-radius:10px;padding:14px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        ${inp('Ticket médio (R$)', 'ticket')}
        ${inp('Investimento/mês (R$)', 'investMes')}
        ${inp('Comissão imobiliária (%)', 'comissaoPct')}
        ${inp('% Corretor (do líquido)', 'corretorPct')}
        ${inp('% Descarte de leads', 'descartePct')}
        ${inp('Custo operacional/mês (R$)', 'custoOperMes')}
        ${inp('LTV (carteira)', 'ltv')}
        ${inp('Cresc. invest. trim. Ano2 (%)', 'crescInvestTrim')}
      </div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:16px 0 6px">Cenários (edite CPL e conversão de cada)</div>
      <div style="background:var(--bg-3);border-radius:10px;padding:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
        ${_s.cenarios.map((c, i) => `<div style="border-left:3px solid ${['#16a34a','#2563eb','#7c3aed'][i]};padding-left:10px">
          <div style="font-weight:800;color:${['#16a34a','#2563eb','#7c3aed'][i]};font-size:12.5px">${esc(c.nome)}</div>
          <label class="tiny muted" style="display:block;margin-top:6px">CPL (R$)</label><input type="number" class="input" data-cen="${i}" data-k="cpl" value="${c.cpl}" style="width:100%;font-size:12px;padding:5px 7px">
          <label class="tiny muted" style="display:block;margin-top:6px">Conversão (%)</label><input type="number" step="0.01" class="input" data-cen="${i}" data-k="conv" value="${c.conv}" style="width:100%;font-size:12px;padding:5px 7px">
        </div>`).join('')}
      </div>
      <div class="tiny muted" id="st-msg" style="margin-top:4px">${esc(_msg)}</div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:18px 0 6px">📊 Comparativo dos cenários</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:620px">
        <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)"><th style="text-align:left;padding:8px 10px">Métrica</th>${head}</tr></thead>
        <tbody>${rows.map(([l, fn, strong]) => `<tr style="border-bottom:1px solid var(--border)${strong ? ';font-weight:700' : ''}"><td style="text-align:left;padding:7px 10px;font-weight:600">${l}</td>${col(fn)}</tr>`).join('')}</tbody>
      </table></div>

      <div class="alert" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);padding:12px;border-radius:8px;margin-top:14px;font-size:12.5px">
        <b>💡 Leitura:</b> o <b>⭐ CPL break-even</b> é o CPL MÁXIMO que cada cenário ainda paga (caixa da venda cobre o custo do lead). Se o CPL atual está <b>abaixo</b> dele → o tráfego se paga (✅). Se está acima → queima caixa (🔴). "Folga do CPL" é o respiro que você tem.
      </div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:18px 0 6px">📈 Projeção 24 meses — caixa acumulado (cenário Equilíbrio)</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:700px">
        <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:6px 8px">—</th>${proj.labels.map(l => `<th style="text-align:right;padding:6px 6px">${l}</th>`).join('')}</tr></thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 8px;font-weight:600">Invest./tri</td>${proj.invest.map(v => `<td style="text-align:right;padding:6px 6px">${f(v)}</td>`).join('')}</tr>
          <tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 8px;font-weight:600">Caixa/tri</td>${proj.caixa.map(v => `<td style="text-align:right;padding:6px 6px;color:${v >= 0 ? '#16a34a' : '#dc2626'}">${f(v)}</td>`).join('')}</tr>
          <tr style="font-weight:700"><td style="padding:6px 8px">Acumulado</td>${proj.acum.map(v => `<td style="text-align:right;padding:6px 6px;color:${v >= 0 ? '#16a34a' : '#dc2626'}">${f(v)}</td>`).join('')}</tr>
        </tbody>
      </table></div>
      <div class="tiny muted" style="margin-top:6px">Invest. cresce ${_s.crescInvestTrim}%/tri e CPL encarece ${_s.encarecCplTrim}%/tri no Ano 2. <a href="#/metricas-viab" style="color:var(--psm-gold)">← voltar pra Métrica Viab</a></div>
    </div>`;
  bind();
}

/* projeção trimestral de 24 meses (8 trimestres) do cenário do meio */
function projecao() {
  const base = _s.cenarios[1] || _s.cenarios[0];
  const labels = [], invest = [], caixa = [], acum = [];
  let inv = _s.investMes, cpl = base.cpl, ac = 0;
  for (let t = 0; t < 8; t++) {
    if (t > 0) { // a cada trimestre: a partir do Ano2 (t>=4) aplica crescimento/encarecimento
      if (t >= 4) { inv *= (1 + _s.crescInvestTrim / 100); cpl *= (1 + _s.encarecCplTrim / 100); }
    }
    const c = calcWith(inv, cpl, base.conv);
    const cxTri = c.caixaMes * 3, invTri = inv * 3;
    ac += cxTri;
    labels.push((t < 4 ? '1A-T' : '2A-T') + ((t % 4) + 1));
    invest.push(invTri); caixa.push(cxTri); acum.push(ac);
  }
  return { labels, invest, caixa, acum };
}
function calcWith(investMes, cpl, conv) {
  const sv = _s.investMes; const so = _s;
  // calc reutilizando o motor com overrides temporários
  const leads = cpl > 0 ? investMes / cpl : 0;
  const qualif = leads * (1 - so.descartePct / 100);
  const vendas = qualif * (conv / 100);
  const receitaMes = vendas * so.ticket * so.comissaoPct / 100;
  const fx = faixa(receitaMes * 12);
  const liquido = receitaMes * (1 - fx.r);
  const caixa = liquido * (1 - so.corretorPct / 100) - (+so.custoOperMes || 0);
  return { caixaMes: caixa };
}

function inp(label, key) {
  return `<div><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><input type="number" step="any" class="input" data-g="${key}" value="${_s[key] ?? ''}" style="width:100%;font-size:12px;padding:6px 8px"></div>`;
}
function bind() {
  _root.querySelectorAll('[data-g]').forEach(el => el.addEventListener('input', () => {
    _s[el.dataset.g] = parseFloat(el.value) || 0; save();
    clearTimeout(window._rdr); window._rdr = setTimeout(render, 250);
  }));
  _root.querySelectorAll('[data-cen]').forEach(el => el.addEventListener('input', () => {
    _s.cenarios[+el.dataset.cen][el.dataset.k] = parseFloat(el.value) || 0; save();
    clearTimeout(window._rdr); window._rdr = setTimeout(render, 250);
  }));
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
