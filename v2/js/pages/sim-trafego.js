/* PSM-OS v2 — 📣 Simulador de Tráfego (FIEL À PLANILHA do Paulo)
   Lê de cima pra baixo como planilha: Investimento → CPL → Leads → Descarte →
   Conversão (Otimista/Realista/Mínima) → Vendas → VGV → Faturamento → Imposto →
   Comissão → Caixa → CPA/ROAS → CPL necessário pra positivar → Carteira/LTV → Projeção 2 anos.
   Abas por linha (M.A.P / Conquista / Consolidado). Tudo editável (salva no banco). lvl≥7. */
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
// 3 colunas de conversão (como na planilha do Paulo)
const COLS = [
  { key: 'convOtim', nome: 'Otimista', cor: '#16a34a' },
  { key: 'convReal', nome: 'Realista', cor: '#2563eb' },
  { key: 'convMin', nome: 'Mínima', cor: '#d97706' },
];

function freshLine(over) {
  return Object.assign({
    ticket: 234000, investMes: 7500, cpl: 15, descartePct: 10,
    convOtim: 1.3, convReal: 1.0, convMin: 0.68,
    comissaoPct: 4, corretorPct: 40, custoOperMes: 0,
    tempoConv: 60, ltv: 0.5, taxaCarteira: 5, crescInvestTrim: 6, encarecCplTrim: 5,
  }, over || {});
}
const DEFAULTS = {
  _v: 3, active: 'map',
  // M.A.P (Paulo): ticket 420k, CPL 32, comissão 4%, corretor 50%, conversão ~90 dias, descarte 15%
  map: freshLine({ ticket: 420000, cpl: 32, comissaoPct: 4, corretorPct: 50, descartePct: 15, tempoConv: 90, taxaCarteira: 4 }),
  // Conquista (Paulo): ticket 234k, CPL 12, comissão 4%, corretor 35%, conversão ~25 dias
  conquista: freshLine({ ticket: 234000, cpl: 12, comissaoPct: 4, corretorPct: 35, descartePct: 10, tempoConv: 25, taxaCarteira: 8 }),
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
  if (!c || c._v !== DEFAULTS._v) return JSON.parse(JSON.stringify(DEFAULTS)); // descarta versão antiga
  const o = JSON.parse(JSON.stringify(DEFAULTS));
  if (c.active && (c.active === 'consol' || LINES.some(l => l.id === c.active))) o.active = c.active;
  for (const ln of LINES) if (c[ln.id]) { const d = o[ln.id], sv = c[ln.id]; for (const k of Object.keys(d)) if (sv[k] !== undefined) d[k] = sv[k]; }
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
const getP = (o, p) => o[p];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lineMeta = id => LINES.find(l => l.id === id) || LINES[0];

/* ── motor (1 funil, recebe a taxa de conversão) ── */
function funil(L, conv) {
  const invest = +L.investMes || 0;
  const cpl = +L.cpl || 0;
  const leads = cpl > 0 ? invest / cpl : 0;
  const descartados = leads * (L.descartePct / 100);
  const qualif = leads - descartados;
  const vendas = qualif * (conv / 100);
  const vgv = vendas * L.ticket;
  const faturamento = vgv * L.comissaoPct / 100;
  const fx = faixa(faturamento * 12);
  const imposto = faturamento * fx.r;
  const liquido = faturamento - imposto;
  const corretor = liquido * L.corretorPct / 100;
  const caixa = liquido - corretor - (+L.custoOperMes || 0);
  const cpa = vendas > 0 ? invest / vendas : 0;
  const roas = invest > 0 ? vgv / invest : 0;
  const caixaPorVenda = L.ticket * L.comissaoPct / 100 * (1 - fx.r) * (1 - L.corretorPct / 100);
  const cplPositivar = (1 - L.descartePct / 100) * (conv / 100) * caixaPorVenda;
  return { invest, cpl, leads, descartados, qualif, conv, vendas, vgv, faturamento, aliq: fx.r, cat: fx.cat, imposto, liquido, corretor, caixa, cpa, roas, cplPositivar };
}
function carteira(L, f) {
  const naoConv = Math.max(0, f.qualif - f.vendas);
  const vendasFut = naoConv * (L.taxaCarteira / 100);
  const vgvFut = vendasFut * L.ticket;
  const valorLTV = vgvFut * L.comissaoPct / 100 * L.ltv;
  return { naoConv, vendasFut, vgvFut, valorLTV };
}
function projData(L) {
  const labels = [], real = new Array(8).fill(0), invArr = new Array(8).fill(0);
  const lagTri = Math.max(0, Math.round((L.tempoConv || 0) / 90)); // dias → trimestres
  let inv = +L.investMes || 0, cpl = +L.cpl || 0;
  for (let t = 0; t < 8; t++) {
    if (t >= 4) { inv *= (1 + L.crescInvestTrim / 100); cpl *= (1 + L.encarecCplTrim / 100); }
    const cx = funil({ ...L, investMes: inv, cpl }, L.convReal).caixa * 3;
    invArr[t] += inv * 3;
    if (t + lagTri < 8) real[t + lagTri] += cx;
    labels.push((t < 4 ? '1A·T' : '2A·T') + ((t % 4) + 1));
  }
  let ac = 0; const acum = real.map(r => (ac += r));
  return { labels, invArr, real, acum, lagTri };
}

/* ── render ── */
function render() {
  if (!_root) return;
  const isConsol = _s.active === 'consol';
  const tabs = LINES.map(l => tabBtn(l.id, l.icon + ' ' + l.nome, l.cor)).join('') + tabBtn('consol', '📊 Consolidado', '#0ea5e9');
  let body;
  if (isConsol) body = `<div id="st-out"></div>`;
  else body = `
    ${realPanel()}
    <div class="st-sec">⚙️ Premissas — ${esc(lineMeta(_s.active).nome)} <span class="tiny muted" style="font-weight:400">(edite; salva no banco)</span></div>
    <div class="st-grid">
      ${field('Ticket médio', 'ticket', { money: 1 })}
      ${field('Investimento/mês', 'investMes', { money: 1 })}
      ${field('CPL (custo por lead)', 'cpl', { money: 1 })}
      ${field('% Descarte de leads', 'descartePct', { pct: 1 })}
      ${field('Conversão OTIMISTA', 'convOtim', { pct: 1, step: '0.01' })}
      ${field('Conversão REALISTA', 'convReal', { pct: 1, step: '0.01' })}
      ${field('Conversão MÍNIMA', 'convMin', { pct: 1, step: '0.01' })}
      ${field('Comissão imobiliária', 'comissaoPct', { pct: 1 })}
      ${field('% Comissão corretor', 'corretorPct', { pct: 1 })}
      ${field('Custo operacional/mês', 'custoOperMes', { money: 1 })}
      ${field('⏱ Tempo de conversão (dias)', 'tempoConv')}
      ${field('LTV (carteira)', 'ltv')}
      ${field('Taxa conv. carteira', 'taxaCarteira', { pct: 1 })}
      ${field('Cresc. invest. trim. (Ano2)', 'crescInvestTrim', { pct: 1 })}
      ${field('Encarec. CPL trim. (Ano2)', 'encarecCplTrim', { pct: 1 })}
    </div>
    <div class="tiny muted" id="st-msg" style="margin-top:6px">${esc(_msg)}</div>
    <div id="st-out"></div>`;
  _root.innerHTML = `
  <div class="card">
    <h2 class="card-title">📣 Simulador de Tráfego</h2>
    <p class="card-sub">Investimento → CPL → leads → descarte → conversão → vendas → VGV → comissão → caixa. Lê de cima pra baixo.</p>
    <div class="st-tabs">${tabs}</div>
    ${body}
    <div class="tiny muted" style="margin-top:14px"><a href="#/metricas-viab" style="color:var(--psm-gold)">← voltar pra Métrica Viab</a></div>
  </div>
  <style>
    .st-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 8px}
    .st-tab{padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);cursor:pointer;font-weight:700;font-size:13px}
    .st-tab.on{color:#fff}
    .st-sec{font-size:11px;text-transform:uppercase;font-weight:800;color:var(--text-2,#94a3b8);letter-spacing:.5px;margin:20px 0 8px}
    .st-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;background:var(--bg-3);border-radius:12px;padding:14px}
    .stt{width:100%;border-collapse:collapse;font-size:13px}
    .stt th,.stt td{padding:7px 12px;border-bottom:1px solid var(--border)}
    .stt thead th{background:var(--bg-3);font-size:11px;text-transform:uppercase;letter-spacing:.3px}
    .stt td.lbl{text-align:left;font-weight:600}
    .stt td.val{text-align:right;font-variant-numeric:tabular-nums}
    .stt tr.grp td{background:var(--bg-3);font-weight:800;font-size:10.5px;text-transform:uppercase;color:var(--text-2,#94a3b8);letter-spacing:.4px;border-bottom:none;padding-top:11px}
    .stt tr.hi td{background:rgba(99,102,241,.08);font-weight:800}
    .stt td.real{background:rgba(37,99,235,.06)}
    @media(max-width:880px){.st-grid{grid-template-columns:repeat(2,1fr)}}
  </style>`;
  _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { _s.active = b.dataset.tab; save(); render(); }));
  if (!isConsol) bindInputs();
  renderOut();
}
function tabBtn(id, label, cor) { const on = _s.active === id; return `<button class="st-tab ${on ? 'on' : ''}" data-tab="${id}" style="${on ? `background:${cor};border-color:${cor}` : ''}">${label}</button>`; }
function field(label, key, o = {}) {
  const v = getP(_s[_s.active], key);
  return `<div>
    <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:3px">${label}</label>
    <div class="flex gap-1" style="align-items:center">
      ${o.money ? '<span class="tiny muted" style="font-weight:700">R$</span>' : ''}
      <input type="number" step="${o.step || 'any'}" class="input" data-key="${key}" value="${v ?? ''}" style="flex:1;font-size:12px;padding:6px 8px;min-width:0">
      ${o.pct ? '<span class="tiny muted">%</span>' : ''}
    </div></div>`;
}
function bindInputs() {
  _root.querySelectorAll('.st-grid [data-key]').forEach(el => el.addEventListener('input', () => {
    _s[_s.active][el.dataset.key] = parseFloat(el.value) || 0; save(); renderOut();
  }));
  const pux = document.getElementById('st-puxar'); if (pux) pux.addEventListener('click', puxarReal);
  const apl = document.getElementById('st-aplicar'); if (apl) apl.addEventListener('click', () => {
    if (_real && !_real.erro) { const L = _s[_s.active]; L.investMes = Math.round(_real.spend) || L.investMes; L.cpl = Math.round(_real.cpl) || L.cpl; save(); render(); }
  });
}

/* ── outputs ── */
function renderOut() {
  const out = document.getElementById('st-out'); if (!out) return;
  if (_s.active === 'consol') { out.innerHTML = consolView(); return; }
  const L = _s[_s.active];
  const fs = COLS.map(c => funil(L, L[c.key]));   // [otim, real, min]
  const cartR = carteira(L, fs[1]);
  const pd = projData(L);
  out.innerHTML = `
    <div class="st-sec">📋 Funil — ${esc(lineMeta(_s.active).nome)}</div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px">
    <table class="stt">
      <thead><tr><th style="text-align:left">Etapa</th>${COLS.map(c => `<th style="text-align:right;color:${c.cor}">${c.nome}</th>`).join('')}</tr></thead>
      <tbody>
        ${grp('Entrada')}
        ${row('💸 Investimento/mês', fs.map(f => f$(f.invest)))}
        ${row('🎯 CPL (custo por lead)', fs.map(f => f$(f.cpl)))}
        ${grp('Funil de leads')}
        ${row('👥 Leads gerados', fs.map(f => f1(f.leads)))}
        ${row('🗑️ (−) Descarte (' + L.descartePct + '%)', fs.map(f => '−' + f1(f.descartados)))}
        ${row('✅ Leads qualificados', fs.map(f => f1(f.qualif)))}
        ${row('📈 Taxa de conversão', COLS.map(c => L[c.key] + '%'))}
        ${row('🤝 Vendas/mês', fs.map(f => f1(f.vendas)), { hi: 1 })}
        ${grp('Financeiro (por mês)')}
        ${row('🏆 VGV', fs.map(f => fK(f.vgv)), { hi: 1 })}
        ${row('💼 Faturamento (comissão ' + L.comissaoPct + '%)', fs.map(f => f$(f.faturamento)))}
        ${row('🧾 (−) Imposto Simples (' + (fs[1].aliq * 100).toFixed(1) + '% ' + fs[1].cat + ')', fs.map(f => '−' + f$(f.imposto)))}
        ${row('= Líquido', fs.map(f => f$(f.liquido)))}
        ${row('👔 (−) Comissão corretor (' + L.corretorPct + '%)', fs.map(f => '−' + f$(f.corretor)))}
        ${row('💰 Caixa da empresa/mês', fs.map(f => f$(f.caixa)), { hi: 1, money: 1 })}
        ${grp('Indicadores & decisão')}
        ${row('📊 CPA (custo/venda)', fs.map(f => f$(f.cpa)))}
        ${row('🔁 ROAS (VGV ÷ invest.)', fs.map(f => f1(f.roas) + 'x'))}
        ${row('⭐ CPL necessário pra positivar', fs.map(f => f$(f.cplPositivar)), { hi: 1 })}
        ${row('   → seu CPL atual', fs.map(f => f$(L.cpl) + (L.cpl <= f.cplPositivar ? ' ✅' : ' 🔴')))}
      </tbody>
    </table></div>
    <div class="tiny muted" style="margin-top:6px">💡 Se o <b>CPL atual</b> está <b>abaixo</b> do "CPL necessário pra positivar", o tráfego se paga (✅). Acima, queima caixa (🔴). A coluna <b style="color:#2563eb">Realista</b> é a referência.</div>

    <div class="st-sec">🗂️ Carteira de leads + LTV <span class="tiny muted" style="font-weight:400">(cenário Realista)</span></div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px"><table class="stt"><tbody>
      ${row2('Leads não convertidos/mês', f1(cartR.naoConv))}
      ${row2('Convertem depois (' + L.taxaCarteira + '%)', f1(cartR.vendasFut) + ' vendas')}
      ${row2('VGV futuro da carteira', fK(cartR.vgvFut))}
      ${row2('💎 Valor da carteira (× LTV ' + L.ltv + ')', f$(cartR.valorLTV) + '/mês', 1)}
    </tbody></table></div>

    <div class="st-sec">📈 Projeção 24 meses (Realista) <span class="tiny muted" style="font-weight:400">— venda entra ${L.tempoConv} dias após o lead</span></div>
    ${projTable(pd)}
  `;
  out.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', () => { _s[_s.active][el.dataset.key] = parseFloat(el.value) || 0; save(); clearTimeout(window._stoo); window._stoo = setTimeout(renderOut, 350); }));
}
function grp(t) { return `<tr class="grp"><td colspan="4">${t}</td></tr>`; }
function row(label, vals, o = {}) {
  return `<tr class="${o.hi ? 'hi' : ''}"><td class="lbl">${label}</td>${vals.map((v, i) => `<td class="val ${i === 1 ? 'real' : ''}">${v}</td>`).join('')}</tr>`;
}
function row2(label, val, hi) { return `<tr class="${hi ? 'hi' : ''}"><td class="lbl">${label}</td><td class="val" style="color:${hi ? '#d97706' : ''};font-weight:${hi ? 800 : 600}">${val}</td></tr>`; }

function consolView() {
  // soma as 2 linhas por cenário (cada linha com sua própria taxa)
  const sums = COLS.map(c => { const a = funil(_s.map, _s.map[c.key]), b = funil(_s.conquista, _s.conquista[c.key]);
    return { invest: a.invest + b.invest, leads: a.leads + b.leads, vendas: a.vendas + b.vendas, vgv: a.vgv + b.vgv, faturamento: a.faturamento + b.faturamento, imposto: a.imposto + b.imposto, caixa: a.caixa + b.caixa,
      cpa: (a.vendas + b.vendas) > 0 ? (a.invest + b.invest) / (a.vendas + b.vendas) : 0, roas: (a.invest + b.invest) > 0 ? (a.vgv + b.vgv) / (a.invest + b.invest) : 0 }; });
  const pdM = projData(_s.map), pdC = projData(_s.conquista);
  const real = pdM.real.map((v, i) => v + pdC.real[i]); const invArr = pdM.invArr.map((v, i) => v + pdC.invArr[i]);
  let ac = 0; const acum = real.map(r => (ac += r));
  const perLinha = LINES.map(ln => { const f = funil(_s[ln.id], _s[ln.id].convReal); const m = lineMeta(ln.id);
    return `<tr><td class="lbl" style="color:${m.cor}">${m.icon} ${m.nome}</td><td class="val">${f$(f.invest)}</td><td class="val">${f1(f.leads)}</td><td class="val">${f1(f.vendas)}</td><td class="val">${fK(f.vgv)}</td><td class="val" style="color:${f.caixa >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${f$(f.caixa)}</td></tr>`; }).join('');
  return `
    <div class="st-sec">📊 Consolidado (M.A.P + Conquista) — por cenário</div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px"><table class="stt">
      <thead><tr><th style="text-align:left">Etapa</th>${COLS.map(c => `<th style="text-align:right;color:${c.cor}">${c.nome}</th>`).join('')}</tr></thead>
      <tbody>
        ${row('💸 Investimento/mês', sums.map(s => f$(s.invest)))}
        ${row('👥 Leads/mês', sums.map(s => f1(s.leads)))}
        ${row('🤝 Vendas/mês', sums.map(s => f1(s.vendas)), { hi: 1 })}
        ${row('🏆 VGV/mês', sums.map(s => fK(s.vgv)), { hi: 1 })}
        ${row('💼 Faturamento', sums.map(s => f$(s.faturamento)))}
        ${row('🧾 (−) Imposto', sums.map(s => '−' + f$(s.imposto)))}
        ${row('💰 Caixa empresa/mês', sums.map(s => f$(s.caixa)), { hi: 1 })}
        ${row('📊 CPA médio', sums.map(s => f$(s.cpa)))}
        ${row('🔁 ROAS', sums.map(s => f1(s.roas) + 'x'))}
      </tbody></table></div>
    <div class="st-sec">Por linha (Realista)</div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px"><table class="stt">
      <thead><tr><th style="text-align:left">Linha</th><th style="text-align:right">Invest.</th><th style="text-align:right">Leads</th><th style="text-align:right">Vendas</th><th style="text-align:right">VGV</th><th style="text-align:right">Caixa</th></tr></thead>
      <tbody>${perLinha}</tbody></table></div>
    <div class="st-sec">📈 Projeção 24m — caixa acumulado consolidado <span class="tiny muted" style="font-weight:400">(cada linha com seu atraso)</span></div>
    ${projTable({ labels: pdM.labels, invArr, real, acum })}`;
}

function projTable(pd) {
  const th = pd.labels.map(l => `<th style="text-align:right">${l}</th>`).join('');
  const tdInv = pd.invArr.map(v => `<td class="val">${fK(v)}</td>`).join('');
  const tdCx = pd.real.map(v => `<td class="val" style="color:${v >= 0 ? '#16a34a' : '#dc2626'}">${fK(v)}</td>`).join('');
  const tdAc = pd.acum.map(v => `<td class="val" style="font-weight:800;color:${v >= 0 ? '#16a34a' : '#dc2626'}">${fK(v)}</td>`).join('');
  return `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px"><table class="stt">
    <thead><tr><th style="text-align:left">—</th>${th}</tr></thead>
    <tbody>
      <tr><td class="lbl">Investimento/tri</td>${tdInv}</tr>
      <tr><td class="lbl">Caixa/tri (já com atraso)</td>${tdCx}</tr>
      <tr class="hi"><td class="lbl">Caixa acumulado</td>${tdAc}</tr>
    </tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">O começo é menor porque a venda só entra depois do tempo de conversão. Acumulado final: <b style="color:${pd.acum[7] >= 0 ? '#16a34a' : '#dc2626'}">${f$(pd.acum[7])}</b> em 24 meses.</div>`;
}

/* ── 🔄 Puxar realizado: Meta (investimento, CPL) + CRM ── */
function realPanel() {
  if (!_real) return `<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="st-puxar">📡 Puxar realizado (Meta + CRM)</button> <span class="tiny muted">— traz investimento e CPL reais do Meta pra esta linha</span></div>`;
  if (_real.erro) return `<div class="alert alert-warn" style="margin-top:10px">⚠️ ${esc(_real.erro)} <button class="btn btn-ghost btn-sm" id="st-puxar">tentar de novo</button></div>`;
  const rk = (l, v) => `<div style="background:var(--bg-2);border-radius:8px;padding:8px"><div class="tiny muted">${l}</div><div style="font-weight:800">${v}</div></div>`;
  return `<div style="margin-top:10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:12px">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-weight:800">📡 Realizado (Meta) <span class="tiny muted">· ${esc(_real.periodo)}</span></div>
      <div class="flex gap-2"><button class="btn btn-ghost btn-sm" id="st-puxar">↻ atualizar</button><button class="btn btn-primary btn-sm" id="st-aplicar">usar invest./CPL nesta linha →</button></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px;font-size:12.5px">
      ${rk('Investimento', f$(_real.spend))}${rk('Leads', Math.round(_real.leads))}${rk('CPL real', f$(_real.cpl))}${rk('Conversão real ↗', _real.convReal.toFixed(2) + '%')}
    </div>
    <div class="tiny muted" style="margin-top:6px">Conversão real = vendas/mês do CRM (${_real.vendasMes.toFixed(1)}) ÷ leads do Meta — referência (vendas são do sistema todo). Use pra calibrar suas 3 taxas.</div>
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
