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

let _root = null, _data = null, _custos = null, _lines = null, _nibo = null;
let _active = 'map', _showCustos = false, _periodo = 'mes', _comProLabore = false, _custosMsg = '';

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
    const [atg, board, nibo] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/diretoria/strategy?board=custos_compartilhados').catch(() => null),
      api.request('/api/v3/finance/custos_fixos?months=3&company=all').catch(() => null),
    ]);
    _data = atg || {};
    const d = board && board.ok ? (board.data || {}) : null;
    if (d && Array.isArray(d.items) && d.items.length) _custos = d.items.map(c => ({ ...c }));
    if (d && d.lines) for (const l of LINES) _lines[l.id] = Object.assign({}, DEFAULTS[l.id], d.lines[l.id] || {});
    _custosMsg = board && board.pending ? '⏳ board não criado — usando base; edite p/ salvar' : (d ? '' : 'usando base padrão');
    // 🔄 Ciclo #2: NIBO realizado → confronta a planilha de custos (premissa × real)
    const t = nibo && nibo.ok ? (nibo.totals || {}) : null, mm = (nibo && nibo.months) || 3;
    _nibo = t ? { realMes: (+t.total || 0) / mm, pagoMes: (+t.pago || 0) / mm, months: mm } : null;
  } catch { _data = {}; }
  renderBanner(); renderParams(); renderCustos(); renderTable();
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
  const igualTotal = _custos.filter(c => c.tipo === 'igual').reduce((s, c) => s + custoValor(c), 0);
  const propTotal = _custos.filter(c => c.tipo === 'proporcional').reduce((s, c) => s + custoValor(c), 0);
  // Rateio Proporcional = média de 2 participações: (a) GASTO direto da equipe
  // (verba mkt + custo direto + salário gerente) e (b) TAMANHO da equipe (nº corretores).
  const gasto = {}, corr = {}; let gastoTot = 0, corrTot = 0;
  for (const id of SHARED) {
    const p = _lines[id];
    gasto[id] = (+p.verbaMarketing || 0) + (+p.custoDireto || 0) + (+p.salarioGerente || 0);
    corr[id] = resolved(id).nCorr || 0;
    gastoTot += gasto[id]; corrTot += corr[id];
  }
  const peso = {}; let pesoTot = 0;
  for (const id of SHARED) {
    const sg = gastoTot > 0 ? gasto[id] / gastoTot : (1 / SHARED.length);
    const sc = corrTot > 0 ? corr[id] / corrTot : (1 / SHARED.length);
    peso[id] = (sg + sc) / 2;
    pesoTot += peso[id];
  }
  const out = { map: 0, conquista: 0, terceiros: 0, locacoes: 0 };
  for (const id of SHARED) {
    out[id] += igualTotal / SHARED.length;
    out[id] += pesoTot > 0 ? propTotal * (peso[id] / pesoTot) : propTotal / SHARED.length;
  }
  for (const c of _custos) if (c.tipo === 'direto' && c.linha && out[c.linha] != null) out[c.linha] += custoValor(c);
  const dirTotal = _custos.filter(c => c.tipo === 'direto').reduce((s, c) => s + custoValor(c), 0);
  return { alloc: out, igualTotal, propTotal, dirTotal };
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
          <div class="flex gap-1" id="viab-periodo">
            <button class="btn ${_periodo === 'mes' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-p="mes">Mensal</button>
            <button class="btn ${_periodo === 'ano' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-p="ano">Anual</button>
          </div>
        </div>
      </div>
      <div id="viab-table"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:20px 0 6px">🎚 Alavancas &amp; ⛓ Gargalos <span class="muted" style="text-transform:none;font-weight:400">(sensibilidade · impacto no lucro/mês potencial)</span></div>
      <div id="viab-alav"></div>
    </div>`;
  _root.querySelectorAll('#viab-tabs [data-line]').forEach(b => b.addEventListener('click', () => {
    _active = b.dataset.line;
    _root.querySelectorAll('#viab-tabs [data-line]').forEach(x => x.className = `btn ${x.dataset.line === _active ? 'btn-primary' : 'btn-ghost'} btn-sm`);
    renderParams(); renderAlavancas();
  }));
  _root.querySelectorAll('#viab-periodo [data-p]').forEach(b => b.addEventListener('click', () => {
    _periodo = b.dataset.p;
    _root.querySelectorAll('#viab-periodo [data-p]').forEach(x => x.className = `btn ${x.dataset.p === _periodo ? 'btn-primary' : 'btn-ghost'} btn-sm`);
    renderTable();
  }));
  document.getElementById('viab-prolabore').addEventListener('change', e => { _comProLabore = e.target.checked; renderCustos(); renderTable(); });
  renderParams(); renderCustos();
}

function renderBanner() {
  const el = document.getElementById('viab-banner'); if (!el) return;
  const a = teamAgg();
  el.innerHTML = `<div class="alert" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);padding:10px 12px;border-radius:8px;margin-top:8px;font-size:12.5px">
    📡 <b>VGV real acumulado (ano, ${MESES_DECORRIDOS} ${MESES_DECORRIDOS === 1 ? 'mês' : 'meses'}):</b> ${fmt(+(_data?.total_vgv || 0))} · ${+(_data?.total_vendas || 0)} venda(s). Por equipe →
    🏢 ${fmt(a.map.vgv)} (${a.map.n}p) · 🏠 ${fmt(a.conquista.vgv)} (${a.conquista.n}p) · 🤝 ${fmt(a.terceiros.vgv)} (${a.terceiros.n}p) · 🔑 ${fmt(a.locacoes.vgv)} (${a.locacoes.n}p).
    <span class="muted">No quadro, "VGV realizado mensal" = acumulado ÷ ${MESES_DECORRIDOS}.</span></div>`;
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
        <div style="font-size:12.5px"><b>💸 Custos Compartilhados (rateio híbrido)</b> — ${_custos.length} itens · Igual ${fmt(rt.igualTotal)} · Proporcional ${fmt(rt.propTotal)} · Direto ${fmt(rt.dirTotal)} · <b>Total ${fmt(total)}/mês</b>${_comProLabore ? ' <span class="tiny" style="color:#16a34a">+pró-labore</span>' : ''}</div>
        <button class="btn btn-ghost btn-sm" id="custos-toggle">✏️ editar custos</button>
      </div>${niboLine}</div>`;
    document.getElementById('custos-toggle').addEventListener('click', () => { _showCustos = true; renderCustos(); });
    return;
  }
  const lineOpts = id => LINES.map(l => `<option value="${l.id}"${l.id === id ? ' selected' : ''}>${l.nome}</option>`).join('');
  el.innerHTML = `<div style="background:var(--bg-3);border-radius:10px;padding:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <div style="font-weight:800">💸 Custos Compartilhados <span class="tiny muted">(Igual÷3 excl. Terceiros · Proporcional por gasto+tamanho · Direto)</span></div>
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
            <option value="igual"${c.tipo === 'igual' ? ' selected' : ''}>Igual ÷3</option><option value="proporcional"${c.tipo === 'proporcional' ? ' selected' : ''}>Proporcional</option><option value="direto"${c.tipo === 'direto' ? ' selected' : ''}>Direto</option></select></td>
          <td style="padding:3px 6px">${c.tipo === 'direto' ? `<select class="input" data-idx="${i}" data-field="linha" style="width:100%;font-size:12px;padding:4px 6px">${lineOpts(c.linha || 'map')}</select>` : '<span class="tiny muted">—</span>'}</td>
          <td style="padding:3px 6px;text-align:center"><span data-del="${i}" style="cursor:pointer;color:#dc2626">✕</span></td></tr>`).join('')}
      </tbody></table></div></div>`;
  el.querySelectorAll('input[data-idx]').forEach(inpEl => inpEl.addEventListener('input', () => {
    const i = +inpEl.dataset.idx, f = inpEl.dataset.field;
    _custos[i][f] = f === 'valor' ? (parseFloat(inpEl.value) || 0) : inpEl.value;
    saveAll(); clearTimeout(window._vtm); window._vtm = setTimeout(renderTable, 250);
  }));
  el.querySelectorAll('select[data-idx]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.idx, f = sel.dataset.field; _custos[i][f] = sel.value;
    if (f === 'tipo' && sel.value === 'direto' && !_custos[i].linha) _custos[i].linha = 'map';
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
    ['Lucro Líquido' + sufx, id => cnum(per[id].lucro), cnum(tot.lucro), { strong: 1, big: 1, tip: 'Resultado da linha: margem das vendas − custo fixo (+ recorrente). Verde = lucro, vermelho = prejuízo.' }],
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
function fmt(n) { return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR'); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
