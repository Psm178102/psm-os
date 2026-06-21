/* PSM-OS v2 — Métricas de Viabilidade por LINHA + Rateio híbrido (Sprint 9.31)
   4 linhas (M.A.P · Conquista · Terceiros · Locações) + Consolidado.
   • Período Mensal/Anual (toggle).
   • Margem PSM líquida REAL (desconta corretor + sênior + imposto) no break-even e lucro.
   • Locação: comissão = 1º aluguel integral (100%) + receita recorrente 10% adm × contratos ativos.
   • Meta vem da aba Metas (atingimento). Pró-labore com toggle (set/2026).
   • Rateio híbrido dos custos: Igual÷3 (excl Terceiros), Proporcional por gasto+tamanho da equipe, Direto.
   • Params de linha + custos persistidos no board custos_compartilhados (compartilhado). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _data = null, _custos = null, _lines = null, _nibo = null, _meta = null;
let _active = 'map', _showCustos = false, _periodo = 'mes', _comProLabore = false, _custosMsg = '', _locRateia = true;
// 💼 Custo fixo por corretor (v80.0 / v80.4 — padrão por equipe + extra individual)
let _ccUsers = null, _ccData = { byteam: {}, byuser: {} }, _ccEdit = null, _ccDraft = [], _ccCanEdit = false, _ccMsg = '';
const TEAM_LBL = { conquista: '🏆 Conquista', lancamento: '🏗 Lançamento', terceiros: '🤝 Terceiros', impper: '✨ IMPPER', locacao: '🔑 Locação', '': '— Sem equipe' };

const LKEY = 'psm_v2_metricas_viab_lines';
const SHARED = ['map', 'conquista', 'locacoes']; // rateiam os custos compartilhados (excl. Terceiros)
const MESES_DECORRIDOS = Math.max(1, new Date().getMonth() + 1);

const LINES = [
  { id: 'map',       nome: 'PSM M.A.P',     icon: '🏢', cor: '#7c3aed' },
  { id: 'conquista', nome: 'PSM Conquista', icon: '🏠', cor: '#2563eb' },
  { id: 'terceiros', nome: 'PSM Terceiros', icon: '🤝', cor: '#0891b2' },
  { id: 'locacoes',  nome: 'PSM Locações',  icon: '🔑', cor: '#d97706' },
];

const DEFAULTS = {
  map:       { ticketMedio: 350000, vendasMes: 1, comissaoBrutaPct: 4,   comCorretorPct: 1.4, comSeniorPct: 1.6, comGerentePct: 0, salarioGerente: 0, aliquotaPct: 8, admPct: 0,  admAliquotaPct: 8, contratosAtivos: 0,   recorrenteModo: 'abater', verbaMarketing: 0, custoDireto: 0,    corretoresManual: '', vgvManual: '' },
  conquista: { ticketMedio: 200000, vendasMes: 1, comissaoBrutaPct: 5,   comCorretorPct: 2.0, comSeniorPct: 1.0, comGerentePct: 0, salarioGerente: 0, aliquotaPct: 8, admPct: 0,  admAliquotaPct: 8, contratosAtivos: 0,   recorrenteModo: 'abater', verbaMarketing: 0, custoDireto: 0,    corretoresManual: '', vgvManual: '' },
  terceiros: { ticketMedio: 250000, vendasMes: 1, comissaoBrutaPct: 6,   comCorretorPct: 3.0, comSeniorPct: 1.0, comGerentePct: 0, salarioGerente: 0, aliquotaPct: 8, admPct: 0,  admAliquotaPct: 8, contratosAtivos: 0,   recorrenteModo: 'abater', verbaMarketing: 0, custoDireto: 8000, corretoresManual: '', vgvManual: '' },
  // Locação: ticket = aluguel; comissão de captação = 100% do 1º aluguel; adm recorrente = 10% × contratos ativos
  locacoes:  { ticketMedio: 2500,   vendasMes: 2, comissaoBrutaPct: 100, comCorretorPct: 30,  comSeniorPct: 0,   comGerentePct: 0, salarioGerente: 0, aliquotaPct: 8, admPct: 10, admAliquotaPct: 8, contratosAtivos: 100, recorrenteModo: 'abater', verbaMarketing: 0, custoDireto: 0,    corretoresManual: '', vgvManual: '' },
};

const CUSTOS_SEED = [
  { item: 'Pró-labore Paulo (set/2026 R$8k)', valor: 0, tipo: 'igual', cat: 'Sócios', prolabore: 1 },
  { item: 'Pró-labore Isadora (set/2026 R$8k)', valor: 0, tipo: 'igual', cat: 'Sócios', prolabore: 1 },
  { item: 'Ponto / Aluguel sala', valor: 15000, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Condomínio', valor: 5400, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Energia', valor: 1300, tipo: 'igual', cat: 'Estrutura' },
  { item: 'WiFi', valor: 100, tipo: 'igual', cat: 'Estrutura' },
  { item: 'IPTU', valor: 1500, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Mobília (17.000/12m)', valor: 1416, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Água', valor: 300, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Limpeza + produtos', valor: 1500, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Café', valor: 500, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Material de escritório', valor: 824, tipo: 'igual', cat: 'Estrutura' },
  { item: 'Leire (admin)', valor: 4376, tipo: 'igual', cat: 'Folha admin' },
  { item: 'Mari (admin)', valor: 3242, tipo: 'igual', cat: 'Folha admin' },
  { item: 'Guilherme (admin)', valor: 3242, tipo: 'igual', cat: 'Folha admin' },
  { item: 'Contabilidade', valor: 500, tipo: 'proporcional', cat: 'Administrativo' },
  { item: 'Empréstimo FGI — PSM 152', valor: 5013.16, tipo: 'proporcional', cat: 'Financeiro' },
  { item: 'Empréstimo FGI — PSM 180', valor: 683.61, tipo: 'proporcional', cat: 'Financeiro' },
  { item: 'Seguro 152', valor: 182.31, tipo: 'proporcional', cat: 'Financeiro' },
  { item: 'Seguro 180', valor: 27.62, tipo: 'proporcional', cat: 'Financeiro' },
  { item: 'PRONAMP', valor: 2960.98, tipo: 'proporcional', cat: 'Financeiro' },
  { item: 'Cestas Itaú 152', valor: 289, tipo: 'proporcional', cat: 'Financeiro' },
  { item: 'Cestas Itaú 180', valor: 169, tipo: 'proporcional', cat: 'Financeiro' },
  { item: 'RD Station CRM', valor: 2784.60, tipo: 'proporcional', cat: 'Software' },
  { item: 'RD Marketing', valor: 1210.50, tipo: 'proporcional', cat: 'Software' },
  { item: 'Kenlo Locação', valor: 163.82, tipo: 'direto', linha: 'locacoes', cat: 'Software' },
  { item: 'Zoho', valor: 120, tipo: 'proporcional', cat: 'Software' },
  { item: 'Nibo', valor: 600, tipo: 'proporcional', cat: 'Software' },
  { item: 'ClickSign', valor: 59, tipo: 'proporcional', cat: 'Software' },
  { item: 'Notion', valor: 208.56, tipo: 'proporcional', cat: 'Software' },
  { item: 'Canva', valor: 34.90, tipo: 'proporcional', cat: 'Software' },
  { item: 'Hubla', valor: 240.01, tipo: 'proporcional', cat: 'Software' },
  { item: 'WA Plus (1)', valor: 27.27, tipo: 'proporcional', cat: 'Software' },
  { item: 'WA Plus (2)', valor: 27.27, tipo: 'proporcional', cat: 'Software' },
  { item: 'ChatGPT', valor: 120.34, tipo: 'proporcional', cat: 'Software' },
  { item: 'Google 2TB', valor: 15, tipo: 'proporcional', cat: 'Software' },
  { item: 'YouTube', valor: 5, tipo: 'proporcional', cat: 'Software' },
  { item: 'MLabs', valor: 57.90, tipo: 'proporcional', cat: 'Software' },
  { item: 'Adobe', valor: 95, tipo: 'proporcional', cat: 'Software' },
  { item: 'Claude', valor: 121.87, tipo: 'proporcional', cat: 'Software' },
  { item: 'Hostinger', valor: 40, tipo: 'proporcional', cat: 'Software' },
  { item: 'Canal Pro', valor: 2377.50, tipo: 'proporcional', cat: 'Portais' },
  { item: 'Matrículas de imóveis', valor: 73.25, tipo: 'proporcional', cat: 'Operacional' },
  { item: 'CRECI / 12', valor: 344.25, tipo: 'proporcional', cat: 'Administrativo' },
  { item: 'Curso Hard3', valor: 99.73, tipo: 'proporcional', cat: 'Treinamento' },
];
const PROLABORE_VALOR = 8000; // quando ativado (set/2026)

export async function pageMetricasViab(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>'; return; }
  _lines = freshLines();
  try { const c = JSON.parse(localStorage.getItem(LKEY) || 'null'); if (c) for (const l of LINES) _lines[l.id] = Object.assign({}, DEFAULTS[l.id], c[l.id] || {}); } catch {}
  _custos = CUSTOS_SEED.map(c => ({ ...c }));
  render();
  await load();
}

function freshLines() { const o = {}; for (const l of LINES) o[l.id] = { ...DEFAULTS[l.id] }; return o; }

async function load() {
  try {
    const ANO = new Date().getFullYear();
    const [atg, board, nibo, hist, ccc, ccu] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/diretoria/strategy?board=custos_compartilhados').catch(() => null),
      api.request('/api/v3/finance/custos_fixos?months=3&company=all').catch(() => null),
      api.request('/api/v3/marketing/history?ano=' + ANO).catch(() => null),
      api.request('/api/v3/diretoria/custos_corretor').catch(() => null),
      api.request('/api/v3/users/list').catch(() => null),
    ]);
    _ccData = { byteam: (ccc && ccc.byteam) || {}, byuser: (ccc && ccc.byuser) || {} };
    _ccCanEdit = !!(ccc && ccc.can_edit);
    _ccUsers = (ccu && (ccu.users || ccu.data)) || (Array.isArray(ccu) ? ccu : []);
    _data = atg || {};
    // 📡 Meta Ads real (histórico): investimento/leads/CPL médios do ano → verba de mkt REAL
    const ht = (hist && hist.totais) || null, mh = (hist && hist.meses_com_dado) || 0;
    if (ht && mh > 0) {
      const inv = +ht.spend || 0, lds = +ht.results || 0;
      _meta = { ano: ANO, investMes: inv / mh, leadsMes: lds / mh, cpl: +ht.cpl || (lds > 0 ? inv / lds : 0), meses: mh };
    } else _meta = null;
    const d = board && board.ok ? (board.data || {}) : null;
    if (d && Array.isArray(d.items) && d.items.length) _custos = d.items.map(c => ({ ...c }));
    if (d && d.lines) for (const l of LINES) _lines[l.id] = Object.assign({}, DEFAULTS[l.id], d.lines[l.id] || {});
    _custosMsg = board && board.pending ? '⏳ board não criado — usando base; edite p/ salvar' : (d ? '' : 'usando base padrão');
    // 🔄 Ciclo #2: NIBO realizado → confronta a planilha de custos (premissa × real)
    const t = nibo && nibo.ok ? (nibo.totals || {}) : null, mm = (nibo && nibo.months) || 3;
    _nibo = t ? { realMes: (+t.total || 0) / mm, pagoMes: (+t.pago || 0) / mm, months: mm } : null;
  } catch { _data = {}; }
  renderBanner(); renderRealSim(); renderParams(); renderCustos(); renderTable(); renderEquilibrio(); renderCustosCorretor();
}

function saveAll() {
  try { localStorage.setItem(LKEY, JSON.stringify(_lines)); } catch {}
  clearTimeout(window._cst);
  window._cst = setTimeout(async () => {
    try {
      const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'custos_compartilhados', data: { items: _custos, lines: _lines } } });
      _custosMsg = (r && r.ok) ? '💾 salvo (compartilhado)' : (r && r.pending ? '⚠️ ' + (r.error || '') : '⚠️ erro');
    } catch (e) { _custosMsg = '⚠️ ' + e.message; }
    const m = document.getElementById('custos-msg'); if (m) m.textContent = _custosMsg;
  }, 500);
}

/* ── dado real por equipe ── */
function teamAgg() {
  const pc = _data?.por_corretor || [];
  const t = c => (c.team || '').toLowerCase();
  const isLoc = c => t(c).includes('loca'), isConq = c => t(c) === 'conquista', isTerc = c => t(c) === 'terceiros';
  const isMap = c => !isLoc(c) && !isConq(c) && !isTerc(c);
  const agg = pred => { const r = pc.filter(pred); return {
    vgv: r.reduce((s, c) => s + (+c.vgv_atingido || 0), 0),
    vendas: r.reduce((s, c) => s + (+c.vendas || 0), 0),
    meta: r.reduce((s, c) => s + (+c.meta_vgv || 0), 0),
    n: r.length }; };
  return { map: agg(isMap), conquista: agg(isConq), terceiros: agg(isTerc), locacoes: agg(isLoc) };
}
function resolved(id) {
  const p = _lines[id], a = teamAgg()[id] || { vgv: 0, vendas: 0, meta: 0, n: 0 };
  const vM = (p.vgvManual !== '' && p.vgvManual != null) ? +p.vgvManual : null;
  const cM = (p.corretoresManual !== '' && p.corretoresManual != null) ? +p.corretoresManual : null;
  // VGV realizado MENSAL: manual já é mensal; auto = acumulado do ano ÷ meses decorridos
  return {
    vgvRealMes: vM != null ? vM : (a.vgv / MESES_DECORRIDOS),
    vgvAnualReal: a.vgv,
    metaMes: (a.meta || 0) / 12,
    nCorr: cM != null ? cM : a.n,
    autoVgvMes: a.vgv / MESES_DECORRIDOS, autoN: a.n,
    vgvIsManual: vM != null, corrIsManual: cM != null,
  };
}
function expectativa(id) { const p = _lines[id], r = resolved(id); return (r.nCorr || 0) * (+p.ticketMedio || 0) * (+p.vendasMes || 0); }

/* ── custos: aplica pró-labore toggle ── */
function custoValor(c) { return (c.prolabore && _comProLabore) ? PROLABORE_VALOR : (+c.valor || 0); }

function rateio() {
  // SHARED_EFF: quem rateia o overhead. Toggle "Locação rateia estrutura": se OFF,
  // a Locação sai do rateio (overhead todo cai em M.A.P + Conquista; locação fica só com custo direto).
  const SHARED_EFF = _locRateia ? SHARED : SHARED.filter(id => id !== 'locacoes');
  const igualTotal = _custos.filter(c => c.tipo === 'igual').reduce((s, c) => s + custoValor(c), 0);
  const propTotal = _custos.filter(c => c.tipo === 'proporcional').reduce((s, c) => s + custoValor(c), 0);
  // Rateio Proporcional = média de 2 participações: (a) GASTO direto da equipe
  // (verba mkt + custo direto + salário gerente) e (b) TAMANHO da equipe (nº corretores).
  const gasto = {}, corr = {}; let gastoTot = 0, corrTot = 0;
  for (const id of SHARED_EFF) {
    const p = _lines[id];
    gasto[id] = (+p.verbaMarketing || 0) + (+p.custoDireto || 0) + (+p.salarioGerente || 0);
    corr[id] = resolved(id).nCorr || 0;
    gastoTot += gasto[id]; corrTot += corr[id];
  }
  const peso = {}; let pesoTot = 0;
  for (const id of SHARED_EFF) {
    const sg = gastoTot > 0 ? gasto[id] / gastoTot : (1 / SHARED_EFF.length);
    const sc = corrTot > 0 ? corr[id] / corrTot : (1 / SHARED_EFF.length);
    peso[id] = (sg + sc) / 2;
    pesoTot += peso[id];
  }
  const out = { map: 0, conquista: 0, terceiros: 0, locacoes: 0 };
  for (const id of SHARED_EFF) {
    out[id] += igualTotal / SHARED_EFF.length;
    out[id] += pesoTot > 0 ? propTotal * (peso[id] / pesoTot) : propTotal / SHARED_EFF.length;
  }
  for (const c of _custos) if (c.tipo === 'direto' && c.linha && out[c.linha] != null) out[c.linha] += custoValor(c);
  const dirTotal = _custos.filter(c => c.tipo === 'direto').reduce((s, c) => s + custoValor(c), 0);
  // ESPECÍFICO: divide IGUALMENTE só entre as linhas escolhidas (c.linhas[])
  let espTotal = 0;
  for (const c of _custos) {
    if (c.tipo !== 'especifico') continue;
    const lns = (Array.isArray(c.linhas) ? c.linhas : []).filter(ln => out[ln] != null);
    if (!lns.length) continue;
    const v = custoValor(c); espTotal += v;
    const each = v / lns.length;
    for (const ln of lns) out[ln] += each;
  }
  return { alloc: out, igualTotal, propTotal, dirTotal, espTotal };
}

/* ── viabilidade (tudo MENSAL) ── */
function computeLine(id, rt) {
  const p = _lines[id], r = resolved(id);
  const ticket = +p.ticketMedio || 0;
  // despesa fixa da linha = rateio + custo direto extra + salário do gerente + verba de marketing própria
  const despFixa = (rt.alloc[id] || 0) + (+p.custoDireto || 0) + (+p.salarioGerente || 0) + (+p.verbaMarketing || 0);
  // margem PSM líquida REAL por venda (desconta corretor + sênior + GERENTE %VGV + imposto)
  const comBruta = ticket * p.comissaoBrutaPct / 100;
  const margemPSM = comBruta - comBruta * p.aliquotaPct / 100
    - ticket * p.comCorretorPct / 100 - ticket * p.comSeniorPct / 100 - ticket * (+p.comGerentePct || 0) / 100;
  const netMarginPct = ticket > 0 ? margemPSM / ticket : 0; // fração líquida da PSM sobre o VGV
  const margemPSMpct = (p.comissaoBrutaPct || 0) - (p.comissaoBrutaPct || 0) * p.aliquotaPct / 100 - (+p.comCorretorPct || 0) - (+p.comSeniorPct || 0) - (+p.comGerentePct || 0); // % líquido s/ ticket
  const inviavel = margemPSM <= 0; // margem zero/negativa = break-even impossível
  // receita recorrente de administração (locação): % adm × aluguel × contratos ativos, líquida do imposto do recorrente
  const recorrenteBruto = ticket * (+p.admPct || 0) / 100 * (+p.contratosAtivos || 0);
  const recorrenteImposto = recorrenteBruto * (+p.admAliquotaPct || 0) / 100;
  const recorrente = recorrenteBruto - recorrenteImposto;
  // modo: 'abater' (recorrente reduz o custo fixo a cobrir) ou 'reserva' (vira reserva, não abate)
  const abate = (p.recorrenteModo === 'reserva') ? 0 : recorrente;
  const reservaMes = recorrente - abate;
  const despNet = despFixa - abate;
  // SEM clamp: se a margem é negativa, break-even sai negativo (sinaliza inviabilidade)
  const vgvBreakEven = netMarginPct !== 0 ? despNet / netMarginPct : 0;
  const vendasBreakEven = margemPSM !== 0 ? Math.ceil(despNet / margemPSM) : 0;
  const nCorr = r.nCorr || 0;
  const vgvMinPorCorretor = nCorr > 0 ? vgvBreakEven / nCorr : 0;
  const vendasMinPorCorretor = nCorr > 0 ? Math.ceil(vendasBreakEven / nCorr) : 0;
  const lucro = r.vgvRealMes * netMarginPct + abate - despFixa;
  const margemReal = r.vgvRealMes > 0 ? (lucro / r.vgvRealMes * 100) : 0;
  const metaPct = r.metaMes > 0 ? (r.vgvRealMes / r.metaMes * 100) : null;
  // imposto gerado/mês = imposto sobre a comissão das vendas realizadas + imposto do recorrente
  const impostoGerado = r.vgvRealMes * (p.comissaoBrutaPct || 0) / 100 * (p.aliquotaPct || 0) / 100 + recorrenteImposto;
  // indicadores por equipe
  const verbaMarketing = +p.verbaMarketing || 0;
  const vendasEsp = nCorr * (+p.vendasMes || 0);                          // vendas esperadas/mês da equipe
  const custoPorCorretor = nCorr > 0 ? despFixa / nCorr : 0;              // custo fixo mensal por corretor
  const custoFixoPorVenda = vendasEsp > 0 ? despFixa / vendasEsp : 0;     // custo fixo embutido em cada venda
  const custoFixoPctVenda = ticket > 0 ? (custoFixoPorVenda / ticket * 100) : 0; // % do ticket
  const cac = vendasEsp > 0 ? verbaMarketing / vendasEsp : 0;            // CAC = mkt ÷ vendas (clientes) da equipe
  return { despFixa, verbaMarketing, recorrente, recorrenteImposto, reservaMes, vgvBreakEven, vendasBreakEven, margemPSM, margemPSMpct, netMarginPct, inviavel, nCorr, ticket,
    expectativa: expectativa(id), vendasEsp, custoPorCorretor, custoFixoPorVenda, custoFixoPctVenda, cac,
    vgvMinPorCorretor, vendasMinPorCorretor, impostoGerado,
    vgvRealMes: r.vgvRealMes, metaMes: r.metaMes, metaPct, lucro, margemReal };
}
function computeTotal(per) {
  const t = { despFixa: 0, verbaMarketing: 0, recorrente: 0, reservaMes: 0, vgvBreakEven: 0, vendasBreakEven: 0, vgvRealMes: 0, metaMes: 0, lucro: 0, nCorr: 0, expectativa: 0, impostoGerado: 0, vendasEsp: 0 };
  for (const id of Object.keys(per)) { const c = per[id]; for (const k of ['despFixa','verbaMarketing','recorrente','reservaMes','vgvBreakEven','vendasBreakEven','vgvRealMes','metaMes','lucro','nCorr','expectativa','impostoGerado','vendasEsp']) t[k] += c[k]; }
  t.inviavel = Object.keys(per).some(id => per[id].inviavel);
  t.margemReal = t.vgvRealMes > 0 ? (t.lucro / t.vgvRealMes * 100) : 0;
  t.custoPorCorretor = t.nCorr > 0 ? t.despFixa / t.nCorr : 0;
  t.custoFixoPorVenda = t.vendasEsp > 0 ? t.despFixa / t.vendasEsp : 0;
  t.cac = t.vendasEsp > 0 ? t.verbaMarketing / t.vendasEsp : 0;
  t.metaPct = t.metaMes > 0 ? (t.vgvRealMes / t.metaMes * 100) : null;
  t.vgvMinPorCorretor = t.nCorr > 0 ? t.vgvBreakEven / t.nCorr : 0;
  t.vendasMinPorCorretor = t.nCorr > 0 ? Math.ceil(t.vendasBreakEven / t.nCorr) : 0;
  return t;
}

/* ── shell ── */
function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🧪 Métricas de Viabilidade por Linha</h2>
      <p class="card-sub">Break-even por unidade + rateio híbrido + VGV mín/corretor · valores mensais e anuais · Sócio only</p>
      <div id="viab-banner"></div>
      <div id="viab-realsim"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Parâmetros da linha (editável)</div>
      <div class="flex gap-2" style="flex-wrap:wrap" id="viab-tabs">
        ${LINES.map(l => `<button class="btn ${l.id === _active ? 'btn-primary' : 'btn-ghost'} btn-sm" data-line="${l.id}">${l.icon} ${l.nome}</button>`).join('')}
      </div>
      <div id="viab-params" style="background:var(--bg-3);border-radius:10px;padding:14px;margin-top:8px"></div>

      <div id="viab-custos" style="margin-top:14px"></div>

      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin:18px 0 6px">
        <div class="tiny muted" style="text-transform:uppercase;font-weight:800">📊 Quadro comparativo</div>
        <div class="flex gap-2" style="align-items:center">
          <label class="tiny" style="cursor:pointer"><input type="checkbox" id="viab-prolabore" ${_comProLabore ? 'checked' : ''}> incluir pró-labore (set/26)</label>
          <label class="tiny" style="cursor:pointer" title="OFF = Locação não carrega overhead da estrutura; o custo fixo todo é rateado só entre M.A.P e Conquista"><input type="checkbox" id="viab-locrateia" ${_locRateia ? 'checked' : ''}> 🔑 Locação rateia estrutura</label>
          <div class="flex gap-1" id="viab-periodo">
            <button class="btn ${_periodo === 'mes' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-p="mes">Mensal</button>
            <button class="btn ${_periodo === 'ano' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-p="ano">Anual</button>
          </div>
        </div>
      </div>
      <div id="viab-table"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:20px 0 6px">🎯 Ponto de Equilíbrio da Empresa <span class="muted" style="text-transform:none;font-weight:400">(quanto cada linha precisa vender pra zerar o consolidado)</span></div>
      <div id="viab-equilibrio"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:20px 0 6px">🎚 Alavancas &amp; ⛓ Gargalos <span class="muted" style="text-transform:none;font-weight:400">(sensibilidade · impacto no lucro/mês potencial)</span></div>
      <div id="viab-alav"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <h2 class="card-title">💼 Custo fixo por corretor</h2>
      <p class="card-sub">Quanto cada corretor custa de fixo por mês (e-mail, logins de sistema, licenças…), por equipe. Soma com o investimento em ads no One-on-One = <b>quanto custa cada corretor</b>. Valores mensais.</p>
      <div id="cc-msg" class="tiny muted" style="margin-bottom:6px"></div>
      <div id="cc-list"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>`;
  _root.querySelectorAll('#viab-tabs [data-line]').forEach(b => b.addEventListener('click', () => {
    _active = b.dataset.line;
    _root.querySelectorAll('#viab-tabs [data-line]').forEach(x => x.className = `btn ${x.dataset.line === _active ? 'btn-primary' : 'btn-ghost'} btn-sm`);
    renderRealSim(); renderParams(); renderAlavancas();
  }));
  _root.querySelectorAll('#viab-periodo [data-p]').forEach(b => b.addEventListener('click', () => {
    _periodo = b.dataset.p;
    _root.querySelectorAll('#viab-periodo [data-p]').forEach(x => x.className = `btn ${x.dataset.p === _periodo ? 'btn-primary' : 'btn-ghost'} btn-sm`);
    renderTable();
  }));
  document.getElementById('viab-prolabore').addEventListener('change', e => { _comProLabore = e.target.checked; renderCustos(); renderTable(); renderEquilibrio(); });
  document.getElementById('viab-locrateia').addEventListener('change', e => { _locRateia = e.target.checked; renderRealSim(); renderCustos(); renderTable(); renderEquilibrio(); });
  renderRealSim(); renderParams(); renderCustos(); renderEquilibrio();
}

function renderBanner() {
  const el = document.getElementById('viab-banner'); if (!el) return;
  const a = teamAgg();
  el.innerHTML = `<div class="alert" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);padding:10px 12px;border-radius:8px;margin-top:8px;font-size:12.5px">
    📡 <b>VGV real acumulado (ano, ${MESES_DECORRIDOS} ${MESES_DECORRIDOS === 1 ? 'mês' : 'meses'}):</b> ${fmt(+(_data?.total_vgv || 0))} · ${+(_data?.total_vendas || 0)} venda(s). Por equipe →
    🏢 ${fmt(a.map.vgv)} (${a.map.n}p) · 🏠 ${fmt(a.conquista.vgv)} (${a.conquista.n}p) · 🤝 ${fmt(a.terceiros.vgv)} (${a.terceiros.n}p) · 🔑 ${fmt(a.locacoes.vgv)} (${a.locacoes.n}p).
    <span class="muted">No quadro, "VGV realizado mensal" = acumulado ÷ ${MESES_DECORRIDOS}.</span></div>`;
}

/* 📡 ATUAL (real) × 🎯 PREMISSA (na meta) — painel comparativo da LINHA ativa.
   ATUAL = realizado do CRM (VGV/vendas ÷ meses) + verba real do Meta. PREMISSA = se bater a meta. */
function renderRealSim() {
  const el = document.getElementById('viab-realsim'); if (!el) return;
  const id = _active, rt = rateio();
  const c = computeLine(id, rt);
  const ta = teamAgg()[id] || { vgv: 0, vendas: 0, meta: 0, n: 0 };
  const vendasRealMes = (ta.vendas || 0) / MESES_DECORRIDOS;
  const ticketReal = ta.vendas > 0 ? ta.vgv / ta.vendas : c.ticket;
  const base = c.metaMes > 0 ? c.metaMes : c.expectativa;          // VGV alvo (premissa)
  const baseLabel = c.metaMes > 0 ? 'meta' : 'expectativa';
  const lucroPot = c.lucro + ((base || 0) - c.vgvRealMes) * (c.netMarginPct || 0);
  const atingPct = base > 0 ? (c.vgvRealMes / base * 100) : null;
  const ln = LINES.find(l => l.id === id) || {};
  const dc = v => v >= 0 ? '#16a34a' : '#dc2626';
  const pct = n => (Math.round((n || 0) * 10) / 10).toLocaleString('pt-BR') + '%';
  const f1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('pt-BR');
  const row = (label, real, prem, delta, strong) => `<tr style="border-bottom:1px solid var(--border)">
    <td style="text-align:left;padding:7px 10px;font-weight:600">${label}</td>
    <td style="text-align:right;padding:7px 10px${strong ? ';font-weight:800' : ''}">${real}</td>
    <td style="text-align:right;padding:7px 10px;color:var(--text-2,#94a3b8)${strong ? ';font-weight:800' : ''}">${prem}</td>
    <td style="text-align:right;padding:7px 10px">${delta || ''}</td></tr>`;
  const verbaPrem = LINES.reduce((s, l) => s + (+_lines[l.id].verbaMarketing || 0), 0);
  el.innerHTML = `<div style="margin-top:10px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.3);border-radius:12px;padding:13px">
    <div style="font-weight:800;color:#16a34a">📡 ATUAL (real) × 🎯 PREMISSA — ${ln.icon || ''} ${esc(ln.nome || id)} <span class="tiny muted" style="font-weight:400;color:var(--text-2,#94a3b8)">média mensal · realizado do CRM × se bater a ${baseLabel}</span></div>
    <div style="overflow-x:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:460px">
      <thead><tr style="background:var(--bg-3)">
        <th style="text-align:left;padding:7px 10px">Métrica</th>
        <th style="text-align:right;padding:7px 10px;color:#16a34a">📡 ATUAL (real)</th>
        <th style="text-align:right;padding:7px 10px">🎯 PREMISSA (na ${baseLabel})</th>
        <th style="text-align:right;padding:7px 10px">Δ / gap</th>
      </tr></thead><tbody>
      ${row('🏆 VGV/mês', fmt(c.vgvRealMes), fmt(base), atingPct != null ? `<b style="color:${dc((atingPct || 0) - 100)}">${pct(atingPct)}</b>` : '—')}
      ${row('🤝 Vendas/mês', f1(vendasRealMes), f1(c.vendasEsp), '')}
      ${row('🎫 Ticket médio', fmt(ticketReal), fmt(c.ticket), '')}
      ${row('💰 Lucro/mês', `<b style="color:${dc(c.lucro)}">${fmt(c.lucro)}</b>`, `<b style="color:${dc(lucroPot)}">${fmt(lucroPot)}</b>`, `<span style="color:${dc(lucroPot - c.lucro)}">${(lucroPot - c.lucro) >= 0 ? '+' : ''}${fmt(lucroPot - c.lucro)}</span>`, 1)}
      ${row('📊 Margem líquida', pct(c.margemReal), pct(c.margemPSMpct), '')}
      </tbody></table></div>
    ${_meta ? `<div class="tiny muted" style="margin-top:7px">📣 <b>Verba mkt REAL</b> (empresa, Meta ${_meta.ano}): <b>${fmt(_meta.investMes)}/mês</b> · ${f1(_meta.leadsMes)} leads/mês · CPL ${fmt(_meta.cpl)}. Premissa de verba (soma das linhas): <b>${fmt(verbaPrem)}/mês</b>${verbaPrem > 0 ? ` <span style="color:${dc(verbaPrem - _meta.investMes)}">(${(_meta.investMes - verbaPrem) >= 0 ? 'real acima' : 'real abaixo'} da premissa)</span>` : ''}.</div>` : ''}
    <div class="tiny muted" style="margin-top:4px">ATUAL = realizado (VGV ÷ ${MESES_DECORRIDOS} meses, CRM). PREMISSA = se a linha bater a ${baseLabel}. O Δ no lucro é o ganho potencial ao fechar o gap.</div>
  </div>`;
}

/* 🎯 PONTO DE EQUILÍBRIO DA EMPRESA — quanto cada linha precisa de VGV pra zerar o consolidado.
   Equação: Σ(VGV_linha × margem_líquida_linha) = custo fixo total líquido. Como a margem da
   Locação (≈50%) é ~33× a das vendas (≈1,5%), cada R$ de captação da Locação "puxa" muito custo.
   Cenários: Locação cobrindo 0 / o próprio BE / mais — e o VGV de venda que sobra (no mix real). */
function renderEquilibrio() {
  const el = document.getElementById('viab-equilibrio'); if (!el) return;
  const rt = rateio();
  const per = {}; for (const l of LINES) per[l.id] = computeLine(l.id, rt);
  const tot = computeTotal(per);
  const abate = id => (per[id].recorrente || 0) - (per[id].reservaMes || 0);
  const totalFixNet = tot.despFixa - LINES.reduce((s, l) => s + abate(l.id), 0);
  const nmMap = per.map.netMarginPct || 0, nmConq = per.conquista.netMarginPct || 0, nmLoc = per.locacoes.netMarginPct || 0;
  const tkMap = per.map.ticket || 1, tkConq = per.conquista.ticket || 1, tkLoc = per.locacoes.ticket || 1;
  const vMap = per.map.vgvRealMes || 0, vConq = per.conquista.vgvRealMes || 0;
  let wMap = 0.5, wConq = 0.5;
  if (vMap + vConq > 0) { wMap = vMap / (vMap + vConq); wConq = 1 - wMap; }
  const denom = wMap * nmMap + wConq * nmConq; // margem ponderada das vendas
  const locSelfBE = nmLoc > 0 ? per.locacoes.despFixa / nmLoc : 0;
  const locCobreTudo = nmLoc > 0 ? totalFixNet / nmLoc : 0;
  const solve = locVgv => {
    const remaining = Math.max(0, totalFixNet - locVgv * nmLoc);
    const r = denom > 0 ? remaining / denom : 0;
    const m = r * wMap, c = r * wConq;
    return { loc: locVgv, map: m, conq: c, total: m + c + locVgv,
      nMap: tkMap > 0 ? m / tkMap : 0, nConq: tkConq > 0 ? c / tkConq : 0, nLoc: tkLoc > 0 ? locVgv / tkLoc : 0 };
  };
  // cenários de captação da Locação/mês (VGV de 1º aluguéis)
  const seeds = [0, locSelfBE, 50000, 100000, locCobreTudo].filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
  const cen = seeds.map(solve);
  const f1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('pt-BR');
  const labelLoc = v => v === 0 ? 'Locação ZERO' : (Math.abs(v - locSelfBE) < 1 ? 'Locação só se paga' : (Math.abs(v - locCobreTudo) < 1 ? 'Locação cobre TUDO' : 'Locação ' + fmt(v)));
  const rows = cen.map(s => {
    const hi = Math.abs(s.loc - 50000) < 1;
    return `<tr style="border-bottom:1px solid var(--border)${hi ? ';background:rgba(34,197,94,.10)' : ''}">
      <td style="text-align:left;padding:7px 10px;font-weight:700">🔑 ${labelLoc(s.loc)}</td>
      <td style="text-align:right;padding:7px 10px">${fmt(s.loc)}<div class="tiny muted">${f1(s.nLoc)} captações</div></td>
      <td style="text-align:right;padding:7px 10px">${fmt(s.map)}<div class="tiny muted">${f1(s.nMap)} vendas</div></td>
      <td style="text-align:right;padding:7px 10px">${fmt(s.conq)}<div class="tiny muted">${f1(s.nConq)} vendas</div></td>
      <td style="text-align:right;padding:7px 10px;font-weight:800">${fmt(s.total)}</td></tr>`;
  }).join('');
  // alavanca: quanto de VGV de venda some a cada R$10k de captação de Locação
  const alav = denom > 0 ? (10000 * nmLoc / denom) : 0;
  el.innerHTML = `<div style="background:var(--bg-3);border-radius:12px;padding:13px">
    <div class="tiny muted" style="margin-bottom:8px">Custo fixo total a cobrir: <b>${fmt(totalFixNet)}/mês</b>${_locRateia ? '' : ' · 🔑 Locação ISENTA do rateio'}. Vendas no <b>mix real</b> (M.A.P ${(wMap * 100).toFixed(0)}% · Conquista ${(wConq * 100).toFixed(0)}%). Margem líq.: M.A.P ${(nmMap * 100).toFixed(2)}% · Conquista ${(nmConq * 100).toFixed(2)}% · Locação ${(nmLoc * 100).toFixed(0)}%.</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:560px">
      <thead><tr style="background:var(--bg-2)">
        <th style="text-align:left;padding:7px 10px">Cenário</th>
        <th style="text-align:right;padding:7px 10px">🔑 Locação</th>
        <th style="text-align:right;padding:7px 10px">🏢 M.A.P</th>
        <th style="text-align:right;padding:7px 10px">🏠 Conquista</th>
        <th style="text-align:right;padding:7px 10px">📊 VGV total/mês</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:8px">🎚 <b>Alavanca da Locação:</b> cada <b>R$ 10.000</b> de captação (≈${f1(10000 / tkLoc)} contratos) tira <b>~${fmt(alav)}</b> de VGV de venda necessário pra empresa fechar no zero — porque a margem da Locação (${(nmLoc * 100).toFixed(0)}%) é ~${nmLoc > 0 && denom > 0 ? (nmLoc / denom).toFixed(0) : '—'}× a das vendas. Não some custo; some <b>VGV de venda</b>.</div>
    <div class="tiny muted" style="margin-top:2px">Equilíbrio = Σ(VGV × margem líquida) = custo fixo. A Locação sozinha cobriria tudo com <b>${fmt(locCobreTudo)}</b> de captação/mês (${f1(locCobreTudo / tkLoc)} contratos). Cenário em verde = ref. R$50k.</div>
  </div>`;
}

function renderParams() {
  const el = document.getElementById('viab-params'); if (!el) return;
  const l = LINES.find(x => x.id === _active), r = resolved(_active), isLoc = _active === 'locacoes';
  el.innerHTML = `
    <div style="font-weight:800;color:${l.cor};margin-bottom:8px">${l.icon} ${l.nome}${isLoc ? ' <span class="tiny muted">(comissão = 1º aluguel 100% + adm recorrente)</span>' : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${inp('Nº de Corretores', 'corretoresManual', '', `real: ${r.autoN}`)}
      ${inp(isLoc ? 'Aluguel médio (R$)' : 'Ticket Médio (R$)', 'ticketMedio')}
      ${inp(isLoc ? 'Contratos novos/corretor/mês' : 'Vendas/corretor/mês', 'vendasMes')}
      ${inp(isLoc ? 'Comissão captação (% do 1º aluguel)' : 'Comissão Bruta (%)', 'comissaoBrutaPct', '%')}
      ${inp('% Corretor', 'comCorretorPct', '%')}
      ${inp('% Sênior', 'comSeniorPct', '%')}
      ${inp('Salário Gerente (R$/mês)', 'salarioGerente')}
      ${inp('% Gerente (sobre VGV da equipe)', 'comGerentePct', '%')}
      ${inp('Alíquota Imposto (%)', 'aliquotaPct', '%')}
      ${inp('📣 Verba Marketing (R$/mês)', 'verbaMarketing')}
      ${isLoc ? inp('% Adm recorrente', 'admPct', '%') : inp('Custo Direto Extra (R$/mês)', 'custoDireto', '', _active === 'terceiros' ? 'Terceiros não rateia' : 'fora da planilha')}
      ${isLoc ? inp('% Imposto s/ adm (recorrente)', 'admAliquotaPct', '%') : ''}
      ${isLoc ? inp('Contratos ativos (carteira)', 'contratosAtivos') : ''}
      ${isLoc ? selp('Adm recorrente →', 'recorrenteModo', [['abater', '↓ Abater do custo fixo'], ['reserva', '🏦 Reserva financeira']]) : ''}
      ${isLoc ? inp('Custo Direto Extra (R$/mês)', 'custoDireto', '', 'fora da planilha') : ''}
    </div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
      ${inp('VGV Realizado MENSAL (R$) — vazio = real ÷ meses', 'vgvManual', '', `auto: ${fmt(r.autoVgvMes)}`)}
      <div class="tiny muted" style="margin-top:4px">📐 Expectativa de VGV/mês: <b>${fmt(expectativa(_active))}</b> (nº corretores × ${isLoc ? 'aluguel' : 'ticket'} × ${isLoc ? 'contratos' : 'vendas'}/corretor — informativo). 📦 Rateio proporcional agora é por <b>gasto + tamanho da equipe</b>. 🎯 Meta/mês (aba Metas): <b>${fmt(r.metaMes)}</b>.${_active === 'terceiros' ? ' <span style="color:#d97706">Terceiros é EXCLUÍDO do rateio (só custo direto).</span>' : ''}${isLoc ? ' <span style="color:#d97706">Locação: recorrente de adm cobre parte do custo fixo.</span>' : ''}</div>
    </div>`;
  el.querySelectorAll('[data-key]').forEach(input => {
    const handler = e => {
      const k = input.dataset.key;
      if (k === 'recorrenteModo') _lines[_active][k] = e.target.value;
      else if (k === 'vgvManual' || k === 'corretoresManual') _lines[_active][k] = e.target.value.trim();
      else _lines[_active][k] = parseFloat(e.target.value) || 0;
      saveAll();
      clearTimeout(window._vtm); window._vtm = setTimeout(() => { renderTable(); renderBanner(); }, 200);
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

function renderCustos() {
  const el = document.getElementById('viab-custos'); if (!el) return;
  const rt = rateio();
  const total = rt.igualTotal + rt.propTotal + rt.dirTotal;
  if (!_showCustos) {
    let niboLine = '';
    if (_nibo) {
      const d = total - _nibo.pagoMes; // planilha − realizado pago
      const cor = Math.abs(d) <= total * 0.1 ? '#16a34a' : (d < 0 ? '#dc2626' : '#d97706');
      niboLine = `<div class="tiny" style="margin-top:4px;color:${cor}">📡 <b>Realizado NIBO</b> (pago, méd. ${_nibo.months}m): <b>${fmt(_nibo.pagoMes)}/mês</b> · planilha ${fmt(total)} → ${d >= 0 ? 'planilha acima' : 'planilha ABAIXO do real'} em <b>${fmt(Math.abs(d))}</b> ${d < 0 ? '⚠️' : ''}</div>`;
    }
    el.innerHTML = `<div style="background:var(--bg-3);border-radius:10px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="font-size:12.5px"><b>💸 Custos Compartilhados (rateio híbrido)</b> — ${_custos.length} itens · Igual ${fmt(rt.igualTotal)} · Proporcional ${fmt(rt.propTotal)} · Direto ${fmt(rt.dirTotal)}${rt.espTotal ? ' · Específico ' + fmt(rt.espTotal) : ''} · <b>Total ${fmt(total)}/mês</b>${_comProLabore ? ' <span class="tiny" style="color:#16a34a">+pró-labore</span>' : ''}</div>
        <button class="btn btn-ghost btn-sm" id="custos-toggle">✏️ editar custos</button>
      </div>${niboLine}</div>`;
    document.getElementById('custos-toggle').addEventListener('click', () => { _showCustos = true; renderCustos(); });
    return;
  }
  const lineOpts = id => LINES.map(l => `<option value="${l.id}"${l.id === id ? ' selected' : ''}>${l.nome}</option>`).join('');
  el.innerHTML = `<div style="background:var(--bg-3);border-radius:10px;padding:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <div style="font-weight:800">💸 Custos Compartilhados <span class="tiny muted">(Igual÷${_locRateia ? 3 : 2} · Proporcional · Específico=linhas escolhidas · Direto=1 linha)</span>${!_locRateia ? ' <span class="tiny" style="color:#d97706;font-weight:700">· 🔑 Locação ISENTA do rateio (overhead só M.A.P+Conquista)</span>' : ''}</div>
      <div class="flex gap-2"><button class="btn btn-ghost btn-sm" id="custos-add">＋ item</button><button class="btn btn-ghost btn-sm" id="custos-reset">↺ base</button><button class="btn btn-ghost btn-sm" id="custos-close">✓ fechar</button></div>
    </div>
    <div class="tiny muted" id="custos-msg" style="margin-bottom:6px">${escapeHtml(_custosMsg)}</div>
    <div style="overflow-x:auto;max-height:320px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:600px">
      <thead><tr style="background:var(--bg-2);position:sticky;top:0">
        <th style="text-align:left;padding:6px 8px">Item</th><th style="text-align:right;padding:6px 8px;width:100px">R$/mês</th>
        <th style="text-align:left;padding:6px 8px;width:120px">Rateio</th><th style="text-align:left;padding:6px 8px;width:120px">Linha</th><th style="width:26px"></th>
      </tr></thead><tbody>
        ${_custos.map((c, i) => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:3px 6px"><input class="input" data-idx="${i}" data-field="item" value="${escapeHtml(c.item || '')}" style="width:100%;font-size:12px;padding:4px 6px"></td>
          <td style="padding:3px 6px"><input class="input" type="number" data-idx="${i}" data-field="valor" value="${c.valor ?? 0}" style="width:100%;font-size:12px;padding:4px 6px;text-align:right"></td>
          <td style="padding:3px 6px"><select class="input" data-idx="${i}" data-field="tipo" style="width:100%;font-size:12px;padding:4px 6px">
            <option value="igual"${c.tipo === 'igual' ? ' selected' : ''}>Igual ÷3</option><option value="proporcional"${c.tipo === 'proporcional' ? ' selected' : ''}>Proporcional</option><option value="especifico"${c.tipo === 'especifico' ? ' selected' : ''}>Específico</option><option value="direto"${c.tipo === 'direto' ? ' selected' : ''}>Direto (1 linha)</option></select></td>
          <td style="padding:3px 6px">${c.tipo === 'direto'
            ? `<select class="input" data-idx="${i}" data-field="linha" style="width:100%;font-size:12px;padding:4px 6px">${lineOpts(c.linha || 'map')}</select>`
            : c.tipo === 'especifico'
              ? LINES.map(l => `<label class="tiny" style="display:inline-flex;align-items:center;gap:2px;margin-right:7px;cursor:pointer;white-space:nowrap"><input type="checkbox" data-idx="${i}" data-ln="${l.id}"${(c.linhas || []).includes(l.id) ? ' checked' : ''}> ${l.nome.replace('PSM ', '')}</label>`).join('')
              : '<span class="tiny muted">—</span>'}</td>
          <td style="padding:3px 6px;text-align:center"><span data-del="${i}" style="cursor:pointer;color:#dc2626">✕</span></td></tr>`).join('')}
      </tbody></table></div></div>`;
  el.querySelectorAll('input[data-field]').forEach(inpEl => inpEl.addEventListener('input', () => {
    const i = +inpEl.dataset.idx, f = inpEl.dataset.field;
    _custos[i][f] = f === 'valor' ? (parseFloat(inpEl.value) || 0) : inpEl.value;
    saveAll(); clearTimeout(window._vtm); window._vtm = setTimeout(renderTable, 250);
  }));
  el.querySelectorAll('input[data-ln]').forEach(cb => cb.addEventListener('change', () => {
    const i = +cb.dataset.idx, ln = cb.dataset.ln;
    const arr = Array.isArray(_custos[i].linhas) ? _custos[i].linhas : (_custos[i].linhas = []);
    if (cb.checked) { if (!arr.includes(ln)) arr.push(ln); } else { _custos[i].linhas = arr.filter(x => x !== ln); }
    saveAll(); clearTimeout(window._vtm); window._vtm = setTimeout(renderTable, 250);
  }));
  el.querySelectorAll('select[data-idx]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.idx, f = sel.dataset.field; _custos[i][f] = sel.value;
    if (f === 'tipo' && sel.value === 'direto' && !_custos[i].linha) _custos[i].linha = 'map';
    if (f === 'tipo' && sel.value === 'especifico' && !(Array.isArray(_custos[i].linhas) && _custos[i].linhas.length)) _custos[i].linhas = ['map', 'conquista'];
    saveAll(); if (f === 'tipo') renderCustos(); renderTable();
  }));
  el.querySelectorAll('[data-del]').forEach(x => x.addEventListener('click', () => { _custos.splice(+x.dataset.del, 1); saveAll(); renderCustos(); renderTable(); }));
  document.getElementById('custos-add').addEventListener('click', () => { _custos.push({ item: 'Novo custo', valor: 0, tipo: 'proporcional', cat: '' }); saveAll(); renderCustos(); renderTable(); });
  document.getElementById('custos-reset').addEventListener('click', () => { if (confirm('Restaurar a planilha base?')) { _custos = CUSTOS_SEED.map(c => ({ ...c })); saveAll(); renderCustos(); renderTable(); } });
  document.getElementById('custos-close').addEventListener('click', () => { _showCustos = false; renderCustos(); });
}

function renderTable() {
  const body = document.getElementById('viab-table'); if (!body) return;
  const rt = rateio();
  const per = {}; for (const l of LINES) per[l.id] = computeLine(l.id, rt);
  const tot = computeTotal(per);
  // lucro POTENCIAL = se a linha bater a meta (ou a expectativa, se não tem meta). pot = lucro + (base − realizado) × margem líquida
  const pot = p => p.lucro + (((p.metaMes > 0 ? p.metaMes : p.expectativa) || 0) - p.vgvRealMes) * (p.netMarginPct || 0);
  const totPot = LINES.reduce((s, l) => s + pot(per[l.id]), 0);
  const f = _periodo === 'ano' ? 12 : 1;
  const sufx = _periodo === 'ano' ? '/ano' : '/mês';
  const v = n => fmt((n || 0) * f);                 // valor R$ escalado
  const cnt = n => Math.round((n || 0) * f);        // contagem escalada
  const cnum = n => `<span style="color:${n >= 0 ? '#16a34a' : '#dc2626'}">${fmt((n || 0) * f)}</span>`;
  const vcol = n => `<span style="color:${(n || 0) < 0 ? '#dc2626' : 'inherit'};${(n || 0) < 0 ? 'font-weight:700' : ''}">${fmt((n || 0) * f)}</span>`; // vermelho se negativo (escala período)
  const mcol = n => `<span style="color:${(n || 0) < 0 ? '#dc2626' : 'inherit'}">${fmt(n)}</span>`;                  // valor por venda (sem escala)
  const pcol = p => `<span style="color:${(p || 0) < 0 ? '#dc2626' : 'inherit'};${(p || 0) < 0 ? 'font-weight:700' : ''}">${(p || 0).toFixed(2)}%</span>`;
  // viável = a linha cobre os custos (lucro ≥ 0). Trata certo o caso da Locação (break-even negativo pq o recorrente já cobre).
  const statusCell = (lucro, inviavel) => { if (inviavel) return '<span style="color:#dc2626;font-weight:800">⛔ inviável</span>'; const ok = (lucro || 0) >= 0; return `<span style="color:${ok ? '#16a34a' : '#dc2626'};font-weight:800">${ok ? '✅ viável' : '⚠️ abaixo'}</span>`; };
  const colHead = LINES.map(l => `<th style="text-align:right;padding:8px 10px;color:${l.cor};white-space:nowrap">${l.icon} ${l.nome.replace('PSM ', '')}</th>`).join('');
  const td = x => `<td style="text-align:right;padding:7px 10px">${x}</td>`;
  const G = t => ({ g: t });
  const rows = [
    G('🏢 Estrutura da operação'),
    ['Nº Corretores', id => per[id].nCorr || '—', tot.nCorr || '—', { tip: 'Quantos corretores atuam nesta linha.' }],
    [_periodo === 'ano' ? 'Aluguel/Ticket' : 'Ticket Médio', id => fmt(per[id].ticket), '—', { tip: 'Valor médio de um imóvel/contrato vendido nesta linha.' }],
    ['Expectativa VGV' + sufx, id => v(per[id].expectativa), v(tot.expectativa), { tip: 'VGV esperado = nº de corretores × ticket × vendas por corretor.' }],
    ['🎯 Meta (aba Metas)' + sufx, id => v(per[id].metaMes), v(tot.metaMes), { tip: 'Meta vinda da aba Metas, atribuída a esta linha.' }],
    G('💸 Custos fixos'),
    ['📣 Verba Marketing' + sufx, id => per[id].verbaMarketing ? v(per[id].verbaMarketing) : '—', tot.verbaMarketing ? v(tot.verbaMarketing) : '—', { tip: 'Mídia paga que esta linha gasta por mês (entra na despesa fixa).' }],
    ['Despesa Fixa (c/ mkt)' + sufx, id => v(per[id].despFixa), v(tot.despFixa), { strong: 1, tip: 'Custo fixo TOTAL da linha: rateio dos custos compartilhados + custos diretos + gerente + marketing.' }],
    ['💵 Custo fixo / corretor' + sufx, id => per[id].nCorr ? v(per[id].custoPorCorretor) : '—', tot.nCorr ? v(tot.custoPorCorretor) : '—', { tip: 'Despesa fixa da linha ÷ nº de corretores.' }],
    G('🔁 Recorrente (locação)'),
    ['Receita recorrente adm' + sufx, id => per[id].recorrente ? v(per[id].recorrente) : '—', tot.recorrente ? v(tot.recorrente) : '—', { tip: 'Taxa de administração mensal das locações ativas (já líquida de imposto).' }],
    ['🏦 Reserva financeira' + sufx, id => per[id].reservaMes ? v(per[id].reservaMes) : '—', tot.reservaMes ? v(tot.reservaMes) : '—', { tip: 'Parte do recorrente guardada como reserva (quando o toggle da linha está em "reserva").' }],
    G('💰 Margem por venda'),
    ['Margem PSM % / venda', id => pcol(per[id].margemPSMpct), '—', { tip: 'Quanto sobra pra empresa em cada venda (%). Já desconta corretor + sênior + gerente + imposto.' }],
    ['Margem PSM R$ / venda', id => mcol(per[id].margemPSM), '—', { tip: 'Quanto sobra pra empresa, em reais, por venda.' }],
    G('📊 Eficiência'),
    ['Custo fixo / venda', id => per[id].vendasEsp ? fmt(per[id].custoFixoPorVenda) : '—', tot.vendasEsp ? fmt(tot.custoFixoPorVenda) : '—', { tip: 'Quanto de custo fixo cada venda esperada precisa carregar.' }],
    ['Custo fixo % do ticket', id => per[id].vendasEsp ? per[id].custoFixoPctVenda.toFixed(1) + '%' : '—', '—', { tip: 'O custo fixo por venda como % do ticket médio.' }],
    ['📣 CAC (mkt ÷ venda)', id => per[id].vendasEsp ? fmt(per[id].cac) : '—', tot.vendasEsp ? fmt(tot.cac) : '—', { tip: 'Custo de aquisição: verba de marketing ÷ vendas esperadas.' }],
    G('🎯 Ponto de equilíbrio (break-even)'),
    ['VGV Break-Even' + sufx, id => vcol(per[id].vgvBreakEven), vcol(tot.vgvBreakEven), { strong: 1, tip: 'VGV que a linha precisa vender pra EMPATAR (cobrir o custo fixo). Vermelho/negativo = margem negativa.' }],
    ['⭐ VGV mín/corretor' + sufx, id => vcol(per[id].vgvMinPorCorretor), vcol(tot.vgvMinPorCorretor), { hl: 1, tip: 'Quanto CADA corretor precisa vender pra a linha empatar (break-even ÷ nº corretores).' }],
    ['⭐ Vendas mín/corretor' + (f > 1 ? '/ano' : '/mês'), id => (per[id].inviavel ? '⛔' : (per[id].vendasMinPorCorretor ? cnt(per[id].vendasMinPorCorretor) : '—')), (tot.vendasMinPorCorretor ? cnt(tot.vendasMinPorCorretor) : '—'), { hl: 1, tip: 'Quantas vendas cada corretor precisa fazer pra empatar.' }],
    ['Vendas Break-Even' + (f > 1 ? '/ano' : '/mês'), id => per[id].inviavel ? '⛔' : (per[id].vendasBreakEven ? cnt(per[id].vendasBreakEven) : '—'), tot.vendasBreakEven ? cnt(tot.vendasBreakEven) : '—', { tip: 'Total de vendas da linha pra empatar.' }],
    G('🏁 Resultado'),
    ['Imposto gerado' + sufx, id => v(per[id].impostoGerado), v(tot.impostoGerado), { tip: 'Imposto (Simples Nacional) gerado pela linha no período.' }],
    ['VGV Realizado' + sufx, id => v(per[id].vgvRealMes), v(tot.vgvRealMes), { tip: 'VGV efetivamente vendido (vem do CRM / aba Metas).' }],
    ['% da Meta atingida', id => per[id].metaPct == null ? '—' : per[id].metaPct.toFixed(0) + '%', tot.metaPct == null ? '—' : tot.metaPct.toFixed(0) + '%', { tip: 'VGV realizado ÷ meta da linha.' }],
    ['Lucro Líquido (realizado)' + sufx, id => cnum(per[id].lucro), cnum(tot.lucro), { strong: 1, big: 1, tip: 'Resultado REAL do mês = VGV realizado × margem − custo fixo (+ recorrente). É o realizado: se vendeu pouco no mês, dá prejuízo mesmo a operação sendo viável.' }],
    ['💡 Lucro potencial (na meta)' + sufx, id => cnum(pot(per[id])), cnum(totPot), { strong: 1, tip: 'Quanto a linha DARIA de lucro se batesse a META (ou a expectativa, se não tem meta). Mostra o potencial estrutural — separado do realizado do mês. Verde = a operação fecha no positivo quando atinge o volume.' }],
    ['📈 Margem de lucro %', id => `<span style="color:${per[id].margemReal < 0 ? '#dc2626' : '#16a34a'};font-weight:700">${per[id].margemReal.toFixed(1)}%</span>`, `<span style="color:${tot.margemReal < 0 ? '#dc2626' : '#16a34a'};font-weight:700">${tot.margemReal.toFixed(1)}%</span>`, { tip: 'Lucro ÷ receita.' }],
    ['Status', id => statusCell(per[id].lucro, per[id].inviavel), statusCell(tot.lucro, tot.inviavel), { big: 1, tip: '✅ viável (lucro ≥ 0) · ⚠️ abaixo (prejuízo, mas margem positiva) · ⛔ inviável (margem por venda negativa).' }],
  ];
  body.innerHTML = `
    <div class="tiny muted" style="margin-bottom:6px">💡 Passe o mouse nas métricas <span style="border-bottom:1px dotted var(--text-2,#94a3b8)">sublinhadas</span> pra ver a explicação. A coluna <b style="color:#0f766e">CONSOLIDADO</b> soma todas as linhas.</div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:820px">
      <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:10px">Métrica <span class="tiny muted">(${_periodo === 'ano' ? 'anual' : 'mensal'})</span></th>${colHead}
        <th style="text-align:right;padding:10px;color:#0f766e;background:rgba(13,148,136,.10);white-space:nowrap">📊 CONSOLIDADO</th></tr></thead>
      <tbody>${rows.map(r => {
        if (r.g) return `<tr><td colspan="${LINES.length + 2}" style="background:var(--bg-2);font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-2,#64748b);padding:11px 10px 5px">${r.g}</td></tr>`;
        const [label, fn, total, o = {}] = r;
        const lbl = o.tip ? `<span title="${o.tip}" style="border-bottom:1px dotted var(--text-2,#94a3b8);cursor:help">${label}</span>` : label;
        const fz = o.big ? 'font-size:13.5px;' : '';
        return `<tr style="border-bottom:1px solid var(--border)${o.strong ? ';font-weight:700' : ''}${o.hl ? ';background:rgba(124,58,237,.06)' : ''}${o.big ? ';border-top:2px solid var(--border)' : ''}">
          <td style="text-align:left;padding:8px 10px;font-weight:600;${fz}">${lbl}</td>${LINES.map(l => `<td style="text-align:right;padding:8px 10px;${fz}">${fn(l.id)}</td>`).join('')}
          <td style="text-align:right;padding:8px 10px;font-weight:800;background:rgba(13,148,136,.06);${fz}">${total}</td></tr>`; }).join('')}</tbody>
    </table></div>
    <div class="alert" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);padding:12px;border-radius:8px;margin-top:14px;font-size:12.5px">
      <b>💡 Leitura (${_periodo === 'ano' ? 'anual' : 'mensal'}):</b><br>
      • ⭐ <b>VGV mín/corretor</b> = quanto cada corretor precisa vender pra cobrir o break-even (com o ticket da linha).<br>
      • <b>Margem PSM</b> desconta corretor + sênior + gerente + imposto. Margem <span style="color:#dc2626;font-weight:700">negativa</span> = <b>⛔ inviável</b> (break-even em vermelho/negativo).<br>
      • <b>Locação</b> = 1º aluguel (100%) + adm recorrente líquido de imposto (${fmt(tot.recorrente)}/mês) — abate o custo fixo ou vira reserva, conforme o toggle.<br>
      • Consolidado: break-even ${v(tot.vgvBreakEven)} · lucro <b style="color:${tot.lucro >= 0 ? '#16a34a' : '#dc2626'}">${cnum(tot.lucro)}</b> (margem ${tot.margemReal.toFixed(1)}%).${_comProLabore ? '' : ' <span class="muted">(sem pró-labore — marque o toggle pra simular set/26)</span>'}
    </div>`;
  renderAlavancas();
}

/* ── 🎚 Alavancas & ⛓ Gargalos (sensibilidade + restrição) ── */
// lucro POTENCIAL da linha (se bater a expectativa de VGV) — base da análise de alavancas
function linePotencial(p, nCorr, alloc) {
  const ticket = +p.ticketMedio || 0;
  const comBruta = ticket * (+p.comissaoBrutaPct || 0) / 100;
  const margemPSM = comBruta - comBruta * (+p.aliquotaPct || 0) / 100
    - ticket * (+p.comCorretorPct || 0) / 100 - ticket * (+p.comSeniorPct || 0) / 100 - ticket * (+p.comGerentePct || 0) / 100;
  const netMargin = ticket > 0 ? margemPSM / ticket : 0;
  const expVGV = (nCorr || 0) * ticket * (+p.vendasMes || 0);
  const recLiq = ticket * (+p.admPct || 0) / 100 * (+p.contratosAtivos || 0) * (1 - (+p.admAliquotaPct || 0) / 100);
  const abate = (p.recorrenteModo === 'reserva') ? 0 : recLiq;
  const despFixa = (alloc || 0) + (+p.custoDireto || 0) + (+p.salarioGerente || 0) + (+p.verbaMarketing || 0);
  const despNet = Math.max(0, despFixa - abate);
  return { lucroPot: expVGV * netMargin + abate - despFixa, margemPSM, netMargin, expVGV, despFixa, vgvBE: netMargin > 0 ? despNet / netMargin : 0 };
}
function sensibilidade(id, rt) {
  const base = _lines[id], nCorr = resolved(id).nCorr || 0, alloc = rt.alloc[id] || 0;
  const baseL = linePotencial(base, nCorr, alloc).lucroPot;
  const tests = [
    ['Comissão bruta +1pp', { comissaoBrutaPct: (+base.comissaoBrutaPct || 0) + 1 }, nCorr],
    ['Repasse corretor −1pp', { comCorretorPct: Math.max(0, (+base.comCorretorPct || 0) - 1) }, nCorr],
    ['Ticket +10%', { ticketMedio: (+base.ticketMedio || 0) * 1.1 }, nCorr],
    ['Volume +1 venda/corretor', { vendasMes: (+base.vendasMes || 0) + 1 }, nCorr],
    ['+1 corretor (bruto)', {}, nCorr + 1],
  ];
  const levers = tests.map(([label, patch, n]) => ({ label, delta: linePotencial({ ...base, ...patch }, n, alloc).lucroPot - baseL }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { baseL, levers };
}
function gargalo(id, rt) {
  const P = linePotencial(_lines[id], resolved(id).nCorr || 0, rt.alloc[id] || 0);
  if ((resolved(id).nCorr || 0) === 0 && (+_lines[id].ticketMedio || 0) === 0) return { sev: 'warn', txt: 'Linha não preenchida/ inativa.' };
  if (P.margemPSM <= 0) return { sev: 'bad', txt: 'ESTRUTURAL — comissão paga (corretor+sênior+gerente+imposto) ≥ comissão cobrada. Margem ≤ 0: volume nenhum resolve. Alavanca real = comissão bruta / repasse.' };
  if (P.lucroPot < 0) return { sev: 'bad', txt: 'CAPACIDADE/CUSTO — nem batendo a expectativa de VGV o lucro fecha. Precisa + volume (corretores/vendas) ou − custo fixo.' };
  const real = resolved(id).vgvRealMes || 0;
  if (P.expVGV > 0 && real < P.expVGV * 0.7) return { sev: 'warn', txt: 'EXECUÇÃO — o potencial fecha no azul, mas o realizado está abaixo da expectativa. Gargalo é conversão/ritmo, não estrutura.' };
  return { sev: 'ok', txt: 'Sem gargalo crítico — linha estruturalmente saudável.' };
}
function renderAlavancas() {
  const el = document.getElementById('viab-alav'); if (!el) return;
  const rt = rateio();
  const l = LINES.find(x => x.id === _active);
  const g = gargalo(_active, rt);
  const s = sensibilidade(_active, rt);
  // ranking de alavancas POSITIVAS de todas as linhas (maior impacto = ponto de alavancagem da empresa)
  const all = [];
  LINES.forEach(L => sensibilidade(L.id, rt).levers.forEach(lv => { if (lv.delta > 0) all.push({ L, ...lv }); }));
  all.sort((a, b) => b.delta - a.delta);
  const topEmpresa = all.slice(0, 5);
  // gargalo da empresa = pior linha (estrutural > capacidade > execução)
  const sevRank = { bad: 0, warn: 1, ok: 2 };
  const gargEmpresa = LINES.map(L => ({ L, g: gargalo(L.id, rt) })).filter(x => x.g.sev !== 'ok')
    .sort((a, b) => sevRank[a.g.sev] - sevRank[b.g.sev])[0];
  const cor = { ok: '#16a34a', warn: '#d97706', bad: '#dc2626' };
  const dot = { ok: '🟢', warn: '🟡', bad: '🔴' };
  const maxAbs = Math.max(1, ...s.levers.map(x => Math.abs(x.delta)));
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div style="background:var(--bg-3);border-radius:10px;padding:14px">
        <div style="font-weight:800;color:${l.cor};margin-bottom:8px">${l.icon} ${l.nome} — alavancas</div>
        ${s.levers.map(lv => {
          const w = Math.round(Math.abs(lv.delta) / maxAbs * 100);
          const c = lv.delta >= 0 ? '#16a34a' : '#dc2626';
          return `<div style="margin-bottom:7px">
            <div class="flex" style="justify-content:space-between;font-size:12px"><span>${esc(lv.label)}</span><b style="color:${c}">${lv.delta >= 0 ? '+' : ''}${fmt(lv.delta)}/mês</b></div>
            <div style="height:6px;background:var(--bg-2);border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${w}%;background:${c}"></div></div>
          </div>`;
        }).join('')}
        <div class="tiny muted" style="margin-top:4px">Quanto o lucro/mês potencial muda mexendo só nesse lever.</div>
      </div>
      <div style="background:var(--bg-3);border-radius:10px;padding:14px">
        <div style="font-weight:800;margin-bottom:8px">⛓ Gargalo de <span style="color:${l.cor}">${l.nome}</span></div>
        <div style="background:${cor[g.sev]}14;border-left:4px solid ${cor[g.sev]};border-radius:8px;padding:10px;font-size:12.5px">${dot[g.sev]} ${g.txt}</div>
        ${gargEmpresa ? `<div style="font-weight:800;margin:12px 0 6px">⛓ Fator limitante da EMPRESA</div>
          <div style="background:${cor[gargEmpresa.g.sev]}14;border-left:4px solid ${cor[gargEmpresa.g.sev]};border-radius:8px;padding:10px;font-size:12.5px">${dot[gargEmpresa.g.sev]} <b>${gargEmpresa.L.nome}</b>: ${gargEmpresa.g.txt}</div>` : ''}
      </div>
    </div>
    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-top:14px">
      <div style="font-weight:800;margin-bottom:8px">🎚 Maiores pontos de alavancagem da EMPRESA</div>
      ${topEmpresa.length ? topEmpresa.map((x, i) => `<div class="flex" style="justify-content:space-between;font-size:12.5px;padding:5px 0;border-bottom:1px solid var(--border)">
        <span><b>${i + 1}.</b> ${x.L.icon} ${x.L.nome} — ${esc(x.label)}</span><b style="color:#16a34a">+${fmt(x.delta)}/mês</b></div>`).join('')
        : '<div class="tiny muted">Sem alavancas positivas calculáveis (preencha os parâmetros das linhas).</div>'}
      <div class="tiny muted" style="margin-top:6px">Ranking do que mais aumenta o lucro com 1 movimento — é onde empurrar primeiro.</div>
    </div>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ── helpers ── */
function inp(label, key, suffix, placeholder) {
  const val = _lines[_active][key];
  const money = /R\$/.test(label);
  return `<div><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1">${money ? '<span class="tiny muted" style="align-self:center;font-weight:700">R$</span>' : ''}<input type="number" class="input" data-key="${key}" value="${val ?? ''}" ${placeholder ? `placeholder="${placeholder}"` : ''} style="flex:1;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}
function selp(label, key, opts) {
  const val = _lines[_active][key] || opts[0][0];
  return `<div><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><select class="input" data-key="${key}" style="width:100%;font-size:12px;padding:6px 8px">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
}
// ───────── 💼 Custo fixo por corretor: PADRÃO POR EQUIPE + extra individual — v80.4 ─────────
function ccItensTotal(itens) { return (itens || []).reduce((s, i) => s + (+i.valor || 0), 0); }
function ccTeamItens(t) { return (_ccData.byteam[String(t).toLowerCase()] || {}).itens || []; }
function ccUserItens(uid) { return (_ccData.byuser[String(uid)] || {}).itens || []; }
function ccTeamPadrao(t) { return ccItensTotal(ccTeamItens(t)); }          // R$/corretor da equipe
function ccUserExtra(uid) { return ccItensTotal(ccUserItens(uid)); }       // extra individual
function ccCorretorTotal(uid, t) { return ccTeamPadrao(t) + ccUserExtra(uid); }

// Editor genérico (key = 'team:<t>' ou 'user:<uid>')
function ccEditor(key) {
  const itens = _ccDraft;
  const rows = itens.map((it, i) => `<div style="display:flex;gap:6px;margin-bottom:4px">
      <input class="input" data-cc-field="nome" data-i="${i}" value="${escapeHtml(it.nome || '')}" placeholder="Item (ex.: E-mail Google, Login RD…)" style="flex:1;font-size:12px;padding:4px 6px">
      <input class="input" data-cc-field="valor" data-i="${i}" type="number" step="0.01" value="${it.valor || ''}" placeholder="R$/mês" style="width:120px;font-size:12px;padding:4px 6px">
      <button class="btn btn-ghost btn-sm" data-cc-del="${i}" title="remover">✕</button>
    </div>`).join('');
  return `<div style="background:var(--bg-3);border-radius:8px;padding:10px;margin:6px 4px 8px">
    ${rows || '<div class="tiny muted" style="margin-bottom:4px">Sem itens — adicione abaixo.</div>'}
    <div class="flex gap-2" style="margin-top:6px;align-items:center">
      <button class="btn btn-ghost btn-sm" data-cc-add="1">+ item</button>
      <span class="tiny muted" style="margin-left:auto">subtotal ${fmt(ccItensTotal(itens))}/${key.startsWith('team:') ? 'corretor' : 'mês'}</span>
      <button class="btn btn-primary btn-sm" data-cc-save="${key}">💾 Salvar</button>
    </div>
  </div>`;
}
function renderCustosCorretor() {
  const el = document.getElementById('cc-list'); if (!el) return;
  const users = (_ccUsers || []).filter(u => ['corretor', 'lider'].includes((u.role || '').toLowerCase()) && (u.status || 'ativo') === 'ativo' && !u.hide_from_ranking);
  if (!users.length) { el.innerHTML = '<div class="muted tiny">Sem corretores ativos pra exibir.</div>'; return; }
  const byTeam = {};
  users.forEach(u => { const t = (u.team || '').toLowerCase().trim(); (byTeam[t] = byTeam[t] || []).push(u); });
  const teams = Object.keys(byTeam).sort((a, b) => (TEAM_LBL[a] || a).localeCompare(TEAM_LBL[b] || b, 'pt-BR'));
  let grand = 0;
  const html = teams.map(t => {
    const arr = byTeam[t].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
    const padrao = ccTeamPadrao(t);
    const sub = arr.reduce((s, u) => s + ccCorretorTotal(u.id, t), 0);
    grand += sub;
    const teamKey = 'team:' + t, editingTeam = _ccEdit === teamKey;
    const rows = arr.map(u => {
      const extra = ccUserExtra(u.id), tot = padrao + extra;
      const uKey = 'user:' + u.id, editingU = _ccEdit === uKey;
      return `<div style="border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;padding:6px 4px">
          <b style="flex:1;font-size:13px;min-width:0">${escapeHtml((u.name || '').trim())}</b>
          <span class="tiny muted" title="padrão da equipe + extra individual">${fmt(padrao)}${extra ? ' + ' + fmt(extra) : ''} =</span>
          <span style="font-weight:800;font-size:13px;color:${tot > 0 ? '#6366f1' : '#94a3b8'};min-width:96px;text-align:right">${fmt(tot)}/mês</span>
          ${_ccCanEdit ? `<button class="btn btn-ghost btn-sm" data-cc-edit="${uKey}">${editingU ? 'Fechar' : '✏️ Extra'}</button>` : ''}
        </div>
        ${editingU ? ccEditor(uKey) : ''}
      </div>`;
    }).join('');
    return `<div style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px">
        <span style="flex:1">${TEAM_LBL[t] || ('🏷 ' + (t || '—'))}</span>
        <span class="muted tiny" style="font-weight:600">padrão ${fmt(padrao)}/corretor · total ${fmt(sub)}/mês · ${arr.length}</span>
        ${_ccCanEdit ? `<button class="btn ${editingTeam ? 'btn-primary' : 'btn-ghost'} btn-sm" data-cc-edit="${teamKey}">${editingTeam ? 'Fechar' : '✏️ Padrão da equipe'}</button>` : ''}
      </div>
      ${editingTeam ? ccEditor(teamKey) : ''}
      ${rows}
    </div>`;
  }).join('');
  el.innerHTML = html
    + `<div style="border-top:2px solid var(--border);margin-top:16px;padding-top:8px;display:flex;justify-content:space-between;font-weight:900"><span>Total fixo · todos os corretores</span><span style="color:#6366f1">${fmt(grand)}/mês</span></div>`;
  const m = document.getElementById('cc-msg');
  if (m) m.textContent = _ccCanEdit ? ('Lance o PADRÃO da equipe (vale por corretor) e, se precisar, o ✏️ Extra de alguém. ' + (_ccMsg || '')) : '🔒 Só sócio/diretoria edita.';
  wireCC();
}
function ccSyncDraft() {
  const el = document.getElementById('cc-list'); if (!el) return;
  el.querySelectorAll('[data-cc-field="nome"]').forEach(inp => { const i = +inp.dataset.i; if (_ccDraft[i]) _ccDraft[i].nome = inp.value; });
  el.querySelectorAll('[data-cc-field="valor"]').forEach(inp => { const i = +inp.dataset.i; if (_ccDraft[i]) _ccDraft[i].valor = +inp.value || 0; });
}
function ccDraftFor(key) {
  const [kind, id] = key.split(':');
  const itens = kind === 'team' ? ccTeamItens(id) : ccUserItens(id);
  return JSON.parse(JSON.stringify(itens));
}
function wireCC() {
  const el = document.getElementById('cc-list'); if (!el) return;
  el.querySelectorAll('[data-cc-edit]').forEach(b => b.onclick = () => {
    const key = b.dataset.ccEdit;
    if (_ccEdit === key) { ccSyncDraft(); _ccEdit = null; }
    else { _ccEdit = key; _ccDraft = ccDraftFor(key); }
    renderCustosCorretor();
  });
  el.querySelectorAll('[data-cc-add]').forEach(b => b.onclick = () => { ccSyncDraft(); _ccDraft.push({ nome: '', valor: 0 }); renderCustosCorretor(); });
  el.querySelectorAll('[data-cc-del]').forEach(b => b.onclick = () => { ccSyncDraft(); _ccDraft.splice(+b.dataset.ccDel, 1); renderCustosCorretor(); });
  el.querySelectorAll('[data-cc-save]').forEach(b => b.onclick = () => ccSave(b.dataset.ccSave));
}
async function ccSave(key) {
  ccSyncDraft();
  const [kind, id] = key.split(':');
  const itens = _ccDraft.filter(i => (i.nome || '').trim() || (+i.valor)).map(i => ({ nome: (i.nome || '').trim(), valor: +i.valor || 0 }));
  _ccMsg = '⏳ salvando…';
  const m = document.getElementById('cc-msg'); if (m) m.textContent = _ccMsg;
  try {
    const body = kind === 'team' ? { action: 'set_team', team: id, itens } : { action: 'set_user', uid: id, itens };
    const r = await api.request('/api/v3/diretoria/custos_corretor', { method: 'POST', body });
    if (r && r.ok) { _ccData = { byteam: r.byteam || {}, byuser: r.byuser || {} }; _ccEdit = null; _ccMsg = '💾 salvo'; }
    else _ccMsg = '⚠️ ' + ((r && r.error) || 'erro');
  } catch (e) { _ccMsg = '⚠️ ' + e.message; }
  renderCustosCorretor();
}

function fmt(n) { return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR'); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
