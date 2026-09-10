/* ============================================================================
   PSM-OS v2 — 📊 Simulador INCC · Fluxo corrigido (Sprint 8.4 · v87.73)
   ----------------------------------------------------------------------------
   Refeito a partir da aba "SIMULADOR INCC" da planilha oficial (VPL-09_26.xlsx):
   o fluxo aparece INTEIRO, mês a mês, com a projeção do INCC em cada parcela —
   na tela, na foto (PNG) e na impressão, no mesmo padrão do Simulador VPL.

   Colunas da planilha → aqui (linha = mês i contado da data da venda):
     A  INCC acum.       (1 + INCC a.a.)^(i/12) − 1
     J  Valor total      entrada + mensais + semestrais + anuais + financiamento
     L  100% corrigido   J × (1 + INCC acum.)
     M  % fluxo a pagar  (J desta linha até a última) ÷ (J do fluxo inteiro)
     N  Valor corrigido  regra do "% do fluxo sem correção" (G4): os primeiros
                         X% pagos NÃO sofrem INCC; a parcela que cruza a marca
                         é corrigida só na fração que passou dela
     P  Custo INCC       N − J
   Economia de INCC (G5) = ΣL − ΣN.   Cores do Nº = coluna O (legenda J2:J5).

   Dois tropeços da planilha que NÃO vieram junto: o Custo INCC das linhas 18+
   apontava para a linha de cima e usava o valor 100% corrigido (P18 = L17−J17),
   e o total P14 somava a coluna AD, vazia — por isso a planilha mostrava R$ 0.

   Campos: o formulário é desenhado UMA vez e a digitação só repinta o resultado
   (regra do VPL — ver sim-campos.js). "%" e "R$ por parcela" são ligados:
   digitar o valor da parcela da tabela da incorporadora recalcula o %.
============================================================================ */
import { ATTR_NUM, parseNum, numCampo, moedaCampo } from '../sim-campos.js';

const KEY = 'psm_v2_sim_incc2';        // v87.73: modelo novo (o antigo guardava só os %)
const KEY_VPL = 'psm_v2_sim_vpl';

// Números do exemplo = a própria aba da planilha (entrada R$ 15.045, 42 × R$ 1.436,79,
// 3 anuais de R$ 7.833,33 e 70% no financiamento) — confere 1:1 com o Excel.
const EXEMPLO = {
  empreendimento: '', unidade: '', cliente: '',
  dataVenda: '', prazo: 42,
  valorTotal: 300900, inccAA: 6, pctSemCorrecao: 5,
  pctAto: 5, numAto: 1,
  pctMensal: 60345.18 / 3009, numMensais: 42,
  pctSemestral: 0, numSemestrais: 0,
  pctAnual: 23499.99 / 3009, numAnuais: 3,
  pctBalao: 0, numBaloes: 0, intervaloBalao: 10, inicioBalao: 0,
  pctFinanc: 70,
  valorizacaoAA: 0,
};

let _root = null;
let _s = null;

function hojeMes() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function padrao() { return { ...EXEMPLO, dataVenda: hojeMes() }; }

export async function pageSimINCC(ctx, root) {
  _root = root;
  try { _s = Object.assign(padrao(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = padrao(); }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

/* ───────── datas ───────── */
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function ymd(iso) { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(iso || '')); return m ? { y: +m[1], m: +m[2], d: +(m[3] || 1) } : null; }
function labelMes(i) {
  const b = ymd(_s.dataVenda);
  if (!b) return `mês ${i}`;
  const d = new Date(b.y, b.m - 1 + i, 1);
  return `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}
function somaMeses(iso, n) {
  const b = ymd(iso);
  if (!b) return '';
  const d = new Date(b.y, b.m - 1 + n, 1);
  const ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(Math.min(b.d, ult)).padStart(2, '0')}`;
}
function mesesEntre(isoA, isoB) { const a = ymd(isoA), b = ymd(isoB); return a && b ? (b.y - a.y) * 12 + (b.m - a.m) : null; }

/* ───────── formatos ───────── */
const fmt2 = n => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = n => 'R$ ' + fmt2(n);
const pct2 = f => ((Number(f) || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const pct4 = f => ((Number(f) || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + '%';
const pctN = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }) + '%';   // número que já está em %
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

/* ═══════════ CÁLCULO ═══════════ */
function compute() {
  const v = _s;
  const valor = Math.max(0, +v.valorTotal || 0);
  const prazo = Math.max(0, Math.min(480, Math.round(+v.prazo || 0)));
  const inccAA = +v.inccAA || 0;
  const inccM = Math.pow(1 + inccAA / 100, 1 / 12) - 1;
  const pctSemCorr = Math.min(100, Math.max(0, +v.pctSemCorrecao || 0));

  // ── o fluxo: mesma agenda do Simulador VPL (ato → mensais → semestrais/anuais → balões → chaves) ──
  const nAto = Math.max(1, Math.min(Math.round(+v.numAto || 1), Math.max(1, prazo)));
  const ato = valor * (+v.pctAto || 0) / 100 / nAto;
  const mensaisAteChaves = Math.max(0, prazo - nAto + 1);
  const nMensaisPedido = +v.numMensais > 0 ? Math.min(Math.round(+v.numMensais), 480) : mensaisAteChaves;
  const nMensais = Math.min(nMensaisPedido, mensaisAteChaves);
  const mensal = nMensais > 0 ? valor * (+v.pctMensal || 0) / 100 / nMensais : 0;
  const nAnuaisPedido = Math.max(0, Math.round(+v.numAnuais || 0));
  const nAnuais = Math.min(nAnuaisPedido, Math.floor(prazo / 12));
  const anual = nAnuais > 0 ? valor * (+v.pctAnual || 0) / 100 / nAnuais : 0;
  const nSemPedido = Math.max(0, Math.round(+v.numSemestrais || 0));
  const nSemestrais = Math.min(nSemPedido, Math.floor(prazo / 6));
  const semestral = nSemestrais > 0 ? valor * (+v.pctSemestral || 0) / 100 / nSemestrais : 0;
  const intervalo = Math.max(1, Math.round(+v.intervaloBalao || 1));
  const inicioB = Math.max(0, Math.round(+v.inicioBalao || 0)) || intervalo;
  const nBaloesPedido = Math.max(0, Math.round(+v.numBaloes || 0));
  const cabemBaloes = inicioB <= prazo ? 1 + Math.floor((prazo - inicioB) / intervalo) : 0;
  const nBaloes = Math.min(nBaloesPedido, cabemBaloes);
  const balao = nBaloes > 0 ? valor * (+v.pctBalao || 0) / 100 / nBaloes : 0;
  const mesesBalao = [];
  for (let k = 0; k < nBaloes; k++) mesesBalao.push(inicioB + k * intervalo);
  const financ = valor * (+v.pctFinanc || 0) / 100;

  const avisos = [];
  if (nMensaisPedido > nMensais) avisos.push(`Nº de mensais reduzido em ${nMensaisPedido - nMensais} para não passar das chaves`);
  const aparadas = (nAnuaisPedido - nAnuais) + (nSemPedido - nSemestrais);
  if (aparadas > 0) avisos.push(`${aparadas} parcela(s) anual/semestral aparada(s) — não cabem antes das chaves`);
  if (nBaloesPedido > nBaloes) avisos.push(`${nBaloesPedido - nBaloes} balão(ões) aparado(s) — não cabem antes das chaves`);

  const rows = [];
  for (let i = 0; i <= prazo; i++) {
    const ent = i < nAto ? ato : 0;
    const m = (i >= nAto && i < nAto + nMensais) ? mensal : 0;
    const s = (i > 0 && nSemestrais > 0 && i % 6 === 0 && i / 6 <= nSemestrais) ? semestral : 0;
    const a = (i > 0 && i % 12 === 0 && i / 12 <= nAnuais) ? anual : 0;
    const b = mesesBalao.includes(i) ? balao : 0;
    const f = i === prazo ? financ : 0;
    const total = ent + m + s + a + b + f;
    const incc = Math.pow(1 + inccAA / 100, i / 12) - 1;                          // col A
    rows.push({ mes: i, ent, m, s, a, b, f, total, incc, cheio: total * (1 + incc), chaves: i === prazo && prazo > 0 });
  }

  // ── a regra do "% do fluxo sem correção" (col M → N), linha a linha como na planilha ──
  const Jt = rows.reduce((t, r) => t + r.total, 0);
  const H = 1 - pctSemCorr / 100;                      // H4 da planilha: fatia do fluxo que sofre INCC
  const EPS = 1e-9;
  let resta = Jt;
  rows.forEach(r => { r.fluxo = Jt > 0 ? resta / Jt : 0; resta -= r.total; });
  rows.forEach((r, k) => {
    const prox = rows[k + 1];
    const J = r.total;
    let p;                                                                          // fração da parcela que é corrigida
    if (!(J > 0.005) || !(Jt > 0)) p = 0;
    else if (r.fluxo <= H + EPS) p = 1;                                             // já passou da marca: corrige tudo
    else if (prox && prox.fluxo <= H + EPS) p = (H - prox.fluxo) / (J / Jt);        // cruza a marca: corrige o que passou
    else if (!prox) p = H / r.fluxo;                                                // última linha cruzando a marca
    else p = 0;                                                                     // ainda dentro dos X% sem correção
    p = Math.min(1, Math.max(0, p));
    r.corrigido = J * (1 + r.incc * p);
    r.custo = r.corrigido - J;
    r.status = !(J > 0.005) ? 'vazio' : (r.mes === 0 || p <= EPS) ? 'sem' : (p >= 1 - EPS ? 'integral' : 'parcial');
  });

  const soma = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const tot = { ent: soma('ent'), m: soma('m'), s: soma('s'), a: soma('a'), b: soma('b'), f: soma('f'),
    total: Jt, cheio: soma('cheio'), corrigido: soma('corrigido'), custo: soma('custo') };
  const ultima = rows[rows.length - 1];
  const inccChaves = ultima ? ultima.incc : 0;
  const financCorrigido = ultima && ultima.total > 0 ? financ * ultima.corrigido / ultima.total : financ;
  // 1ª e última mensal JÁ corrigidas — o "degrau" que o cliente vai sentir no boleto
  const comM = rows.filter(r => r.m > 0);
  const mensalCorr = r => r ? r.m * r.corrigido / r.total : 0;
  const mensal1 = mensalCorr(comM[0]);
  const mensalN = mensalCorr(comM[comM.length - 1]);

  // ── projeção de valorização (bloco T10:T17 da planilha, que só tinha os rótulos) ──
  const valAA = +v.valorizacaoAA || 0;
  const valAM = Math.pow(1 + valAA / 100, 1 / 12) - 1;
  const valAcum = Math.pow(1 + valAA / 100, prazo / 12) - 1;
  const valRS = valor * valAcum;
  const valLiq = valRS - tot.custo;
  const valLiqPct = valor > 0 ? valLiq / valor : 0;
  const valLiqAM = prazo > 0 && valLiqPct > -1 ? Math.pow(1 + valLiqPct, 1 / prazo) - 1 : 0;

  if (valor > 0 && Math.abs(Jt - valor) > 0.5) avisos.unshift(`o fluxo soma ${brl(Jt)} = ${pct2(Jt / valor)} do valor do imóvel (${brl(valor)}) — confira as parcelas`);

  return {
    valor, prazo, inccAA, inccM, pctSemCorr, nAto, ato, nMensais, mensal, nSemestrais, semestral, nAnuais, anual,
    nBaloes, balao, temBalao: nBaloes > 0, mesesBalao, financ, rows, tot, inccChaves, financCorrigido, mensal1, mensalN,
    economia: tot.cheio - tot.corrigido, custoIntegral: tot.cheio - tot.total,
    valAA, valAM, valAcum, valRS, valLiq, valLiqPct, valLiqAM, avisos,
    parcelas: { ato: { n: nAto, v: ato }, mensal: { n: nMensais, v: mensal }, semestral: { n: nSemestrais, v: semestral },
      anual: { n: nAnuais, v: anual }, balao: { n: nBaloes, v: balao }, financ: { n: 1, v: financ } },
  };
}

/* ═══════════ A PLANILHA — colunas, cores e conteúdo (tela, foto e impressão usam os mesmos) ═══════════ */
const COLS = [
  { k: 'n',         tl: ['N°'],                        w: 38 },
  { k: 'data',      tl: ['Data'],                      w: 60 },
  { k: 'incc',      tl: ['INCC', 'acum.'],             w: 62 },
  { k: 'ent',       tl: ['ENTRADA'],                   w: 100, g: 'F' },
  { k: 'm',         tl: ['MENSAIS'],                   w: 98,  g: 'F' },
  { k: 's',         tl: ['SEMESTRAIS'],                w: 98,  g: 'F' },
  { k: 'a',         tl: ['ANUAIS'],                    w: 98,  g: 'F' },
  { k: 'b',         tl: ['BALÕES'],                    w: 98,  g: 'F', so: 'temBalao' },
  { k: 'f',         tl: ['FINANCIAMENTO', '/ CHAVES'], w: 116, g: 'F' },
  { k: 'total',     tl: ['VALOR', 'TOTAL'],            w: 108, g: 'F', forte: 1 },
  { k: 'cheio',     tl: ['VALOR 100%', 'CORRIGIDO'],   w: 112, g: 'I' },
  { k: 'fluxo',     tl: ['% FLUXO', 'A PAGAR'],        w: 70,  g: 'I' },
  { k: 'corrigido', tl: ['VALOR', 'CORRIGIDO'],        w: 112, g: 'I', forte: 1 },
  { k: 'custo',     tl: ['CUSTO', 'INCC'],             w: 98,  g: 'I' },
];
const colunas = c => COLS.filter(k => !k.so || c[k.so]);

const ST = {
  sem:      { bg: '#d9ead3', fg: '#274e13', t: 'Parcela sem correção' },
  parcial:  { bg: '#fff2cc', fg: '#7f6000', t: 'Parcela parcialmente corrigida' },
  integral: { bg: '#f4cccc', fg: '#990000', t: 'Parcela integralmente corrigida' },
  vazio:    { bg: '#ffffff', fg: '#999999', t: '' },
};
const CHAVES = { bg: '#a4c2f4', fg: '#1c4587', t: 'Chaves / financiamento' };
const LEGENDA = [ST.sem, ST.parcial, ST.integral, CHAVES];
const COR = { titF: '#ffff00', titI: '#f8cbad', head: '#f3f3f3', headI: '#fce4d6', resumo: '#efefef', resumoLbl: '#e2e2e2' };

function estiloCel(c, r, k) {
  if (k.k === 'n' || k.k === 'corrigido') { const s = ST[r.status]; return { bg: s.bg, fg: s.fg, bold: true }; }
  if (k.k === 'data') return r.chaves ? { bg: CHAVES.bg, fg: CHAVES.fg, bold: true } : { bg: '#fff', fg: '#1a1a1a', bold: true };
  if (k.k === 'custo') return { bg: '#fff', fg: r.custo > 0.005 ? '#b91c1c' : '#1a1a1a' };
  if (k.k === 'incc' || k.k === 'fluxo') return { bg: '#fff', fg: '#555' };
  return { bg: '#fff', fg: '#1a1a1a', bold: !!k.forte || (k.g === 'F' && r.mes < c.nAto) };
}

function conteudo(c, r, k) {
  if (k.k === 'n') return { txt: String(r.mes) };
  if (k.k === 'data') return { txt: labelMes(r.mes) };
  if (k.k === 'incc') return { txt: pct2(r.incc) };
  if (k.k === 'fluxo') return { txt: r.total > 0.005 ? pct2(r.fluxo) : '' };
  return { money: r[k.k] };
}

// as 3 linhas de resumo que a planilha tem no topo (QUANTIDADE / % / TOTAL)
function resumoLinhas(c) {
  const v = c.valor;
  const q = { ent: c.nAto, m: c.nMensais, s: c.nSemestrais, a: c.nAnuais, b: c.nBaloes, f: c.financ > 0 ? 1 : 0 };
  return [
    { lbl: 'QUANTIDADE', cel: k => ({ txt: k.k in q ? String(q[k.k]) : '' }) },
    { lbl: '% DO VALOR', cel: k => {
      if (k.g === 'F') return { txt: v > 0 ? pct2(c.tot[k.k] / v) : '', fg: k.k === 'total' && Math.abs(c.tot.total - v) > 0.5 ? '#c00000' : null };
      if (k.k === 'cheio') return { txt: v > 0 ? '+' + pct2(c.custoIntegral / v) : '' };
      if (k.k === 'corrigido') return { txt: v > 0 ? '+' + pct2(c.tot.custo / v) : '' };
      return { txt: '' };
    } },
    { lbl: 'TOTAL', cel: k => (k.k === 'fluxo' ? { txt: '' } : { money: c.tot[k.k] }) },
  ];
}

function kpisDados(c) {
  const t = c.tot;
  return [
    { lbl: 'FLUXO SEM CORREÇÃO', val: brl(t.total), sub: Math.abs(t.total - c.valor) > 0.5 ? `valor do imóvel ${brl(c.valor)}` : 'valor de tabela', bg: '#eef2f7', fg: '#0f172a', fg2: '#475569' },
    { lbl: 'FLUXO CORRIGIDO (ESTIMATIVA)', val: brl(t.corrigido), sub: `INCC de ${pctN(c.inccAA)} a.a. até as chaves`, bg: '#0b1f3a', fg: '#ffffff', fg2: '#cbd5e1' },
    { lbl: 'CUSTO DO INCC', val: brl(t.custo), sub: t.total > 0 ? `+${pct2(t.custo / t.total)} sobre o fluxo` : '—', bg: '#fde2e2', fg: '#991b1b', fg2: '#7f1d1d' },
    { lbl: 'FINANCIAMENTO NAS CHAVES', val: brl(c.financCorrigido), sub: `hoje ${brl(c.financ)} · +${brl(c.financCorrigido - c.financ)}`, bg: '#dbeafe', fg: '#1e3a8a', fg2: '#1e40af' },
  ];
}

function cabecalhoTexto(c) {
  return [
    _s.empreendimento && `Empreendimento: ${_s.empreendimento}`,
    _s.unidade && `Unidade: ${_s.unidade}`,
    _s.cliente && `Cliente: ${_s.cliente}`,
    `Valor do imóvel: ${brl(c.valor)}`,
    `Venda: ${labelMes(0)}`,
    `Chaves / financiamento: ${labelMes(c.prazo)} (${c.prazo} meses)`,
    `INCC projetado: ${pctN(c.inccAA)} a.a.`,
    c.pctSemCorr > 0 ? `Sem correção: primeiros ${pctN(c.pctSemCorr)} do fluxo` : 'Todo o fluxo corrigido',
  ].filter(Boolean).join('  ·  ');
}

function leituraTexto(c) {
  if (!(c.tot.total > 0)) return 'Preencha o valor do imóvel e o fluxo de pagamento para ver a projeção.';
  const p = [
    `Com INCC projetado de ${pctN(c.inccAA)} ao ano, as parcelas são corrigidas mês a mês da venda (${labelMes(0)}) até as chaves (${labelMes(c.prazo)}, ${c.prazo} ${c.prazo === 1 ? 'mês' : 'meses'}) — ${pct2(c.inccChaves)} acumulados no período.`,
    `Pela tabela o fluxo soma ${brl(c.tot.total)}; corrigido, fica em torno de ${brl(c.tot.corrigido)} (+${brl(c.tot.custo)}).`,
  ];
  if (c.financ > 0) p.push(`No financiamento, os ${brl(c.financ)} que vão para o banco chegam nas chaves valendo cerca de ${brl(c.financCorrigido)}.`);
  if (c.pctSemCorr > 0 && c.economia > 0.5) p.push(`A regra dos ${pctN(c.pctSemCorr)} do fluxo sem correção economiza ${brl(c.economia)}.`);
  if (c.valAA > 0) p.push(`Se o imóvel valorizar ${pctN(c.valAA)} ao ano, vale cerca de ${brl(c.valor + c.valRS)} nas chaves (+${brl(c.valRS)}); descontado o INCC, a valorização líquida fica em ${brl(c.valLiq)} (${pct2(c.valLiqAM)} ao mês).`);
  return p.join(' ');
}

function notaTexto(c) {
  return `Estimativa com INCC constante de ${pctN(c.inccAA)} ao ano (${pct4(c.inccM)} ao mês) — o índice real é divulgado mês a mês pela FGV e pode vir maior ou menor.`
    + (c.pctSemCorr > 0 ? ` Parcelas pagas até completar ${pctN(c.pctSemCorr)} do fluxo não são corrigidas (regra do contrato).` : '')
    + ' Depois das chaves, o saldo segue as regras do financiamento bancário.';
}

function tdConteudo(v, st, alinh) {
  const style = `background:${st.bg};color:${v.fg || st.fg};${st.bold ? 'font-weight:700' : ''}`;
  if ('money' in v) {
    return Math.abs(v.money || 0) > 0.005
      ? `<td class="ic-c ic-m" style="${style}"><span class="ic-rs">R$</span>${fmt2(v.money)}</td>`
      : `<td class="ic-c" style="${style}"></td>`;
  }
  return `<td class="ic-c ${alinh}" style="${style}">${esc(v.txt || '')}</td>`;
}

function tabelaHTML(c) {
  const cols = colunas(c);
  const W = cols.reduce((t, k) => t + k.w, 0);
  const fixos = cols.filter(k => !k.g);
  const nF = cols.filter(k => k.g === 'F').length, nI = cols.filter(k => k.g === 'I').length;
  const h1 = fixos.map(k => `<th class="ic-h" rowspan="2" style="background:${COR.head}">${k.tl.join('<br>')}</th>`).join('')
    + `<th class="ic-tit" colspan="${nF}" style="background:${COR.titF}">FLUXO DE PAGAMENTO</th>`
    + `<th class="ic-tit" colspan="${nI}" style="background:${COR.titI}">PROJEÇÃO INCC</th>`;
  const h2 = cols.filter(k => k.g).map(k => `<th class="ic-h" style="background:${k.g === 'I' ? COR.headI : COR.head}">${k.tl.join('<br>')}</th>`).join('');
  const stResumo = { bg: COR.resumo, fg: '#1a1a1a', bold: true };
  const resumo = resumoLinhas(c).map(rl => `<tr><td class="ic-c ic-lbl" colspan="${fixos.length}">${rl.lbl}</td>${cols.filter(k => k.g).map(k => tdConteudo(rl.cel(k), stResumo, 'ic-dir')).join('')}</tr>`).join('');
  const corpo = c.rows.map(r => `<tr>${cols.map(k => tdConteudo(conteudo(c, r, k), estiloCel(c, r, k), (k.k === 'n' || k.k === 'data') ? 'ic-ctr' : 'ic-dir')).join('')}</tr>`).join('');
  return `<table class="ic-table" style="width:${W}px">
    <colgroup>${cols.map(k => `<col style="width:${k.w}px">`).join('')}</colgroup>
    <thead><tr>${h1}</tr><tr>${h2}</tr></thead>
    <tbody>${resumo}</tbody>
    <tbody>${corpo}</tbody>
  </table>`;
}

// completa = via limpa (título, cabeçalho, KPIs e leitura); na tela os KPIs já estão acima
function folhaHTML(c, completa) {
  const topo = completa ? `
    <div class="ic-titulo">SIMULAÇÃO DE CORREÇÃO PELO INCC</div>
    <div class="ic-cab">${esc(cabecalhoTexto(c))}</div>
    <div class="ic-kp">${kpisDados(c).map(k => `<div class="k" style="background:${k.bg};color:${k.fg}"><div class="l" style="color:${k.fg2}">${k.lbl}</div><div class="v">${k.val}</div><div class="s" style="color:${k.fg2}">${esc(k.sub)}</div></div>`).join('')}</div>
    <div class="ic-leit">${esc(leituraTexto(c))}</div>` : '';
  return `${topo}
    <div class="ic-leg">${LEGENDA.map(l => `<span><i style="background:${l.bg}"></i>${l.t}</span>`).join('')}</div>
    ${tabelaHTML(c)}
    <div class="ic-nota">${esc(notaTexto(c))}</div>`;
}

// CSS fiel à planilha — o MESMO na tela e na via de impressão/compartilhamento (folha clara nos 2 temas)
const IC_CSS = `
  .ic-folha{background:#fff;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif}
  .ic-titulo{font-size:17px;font-weight:800;margin:0 0 4px}
  .ic-cab{font-size:12px;color:#333;margin:0 0 8px;max-width:1180px;line-height:1.4}
  .ic-kp{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 10px;max-width:1180px}
  .ic-kp .k{border-radius:6px;padding:8px 10px}
  .ic-kp .l{font-size:10px;font-weight:700;letter-spacing:.3px}
  .ic-kp .v{font-size:18px;font-weight:800;margin:3px 0 2px}
  .ic-kp .s{font-size:10.5px}
  .ic-leit{font-size:12.5px;line-height:1.45;margin:0 0 10px;max-width:1180px}
  .ic-leg{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:11.5px;margin:0 0 8px;align-items:center;color:#1a1a1a}
  .ic-leg i{display:inline-block;width:12px;height:12px;border:1px solid #000;margin-right:6px;vertical-align:-2px}
  .ic-table{border-collapse:collapse;table-layout:fixed;font-size:11.5px;color:#1a1a1a;background:#fff}
  .ic-table th,.ic-table td{border:1px solid #000;padding:2px 5px;height:19px;white-space:nowrap;overflow:hidden}
  .ic-table .ic-h{font-weight:700;text-align:center;font-size:10.5px;line-height:1.15;color:#1a1a1a}
  .ic-table .ic-tit{font-weight:800;font-size:15px;text-align:center;padding:5px;color:#1a1a1a}
  .ic-table .ic-m{text-align:right}
  .ic-table .ic-m .ic-rs{float:left;padding-right:6px}
  .ic-table .ic-ctr{text-align:center}
  .ic-table .ic-dir{text-align:right}
  .ic-table .ic-lbl{background:${COR.resumoLbl};color:#1a1a1a;text-align:center;font-weight:800;font-size:10.5px}
  .ic-nota{font-size:10.5px;color:#555;margin-top:8px;max-width:1180px;line-height:1.4}
`;

/* ═══════════ 📷 A FOLHA COMO FOTO (PNG) ═══════════
   Desenho direto no canvas, como o VPL: a tabela é determinística (mesmas
   larguras, cores e formatos), então a foto sai idêntica sem lib externa. */
const CV = { pad: 18, hTit: 26, hHead: 34, hSum: 20, hRow: 20, hKpi: 58 };
const F = (px, bold) => `${bold ? 'bold ' : ''}${px}px Arial, Helvetica, sans-serif`;

function desenharFolha(c, scale) {
  const cols = colunas(c);
  const X = [0];
  cols.forEach((k, i) => X.push(X[i] + k.w));
  const W = X[cols.length];
  const nFix = cols.filter(k => !k.g).length;
  const med = document.createElement('canvas').getContext('2d');
  const quebra = (texto, fonte, largura) => {
    med.font = fonte;
    const linhas = [];
    let atual = '';
    String(texto).split(/\s+/).forEach(p => {
      const t = atual ? atual + ' ' + p : p;
      if (atual && med.measureText(t).width > largura) { linhas.push(atual); atual = p; } else atual = t;
    });
    if (atual) linhas.push(atual);
    return linhas;
  };
  const info = quebra(cabecalhoTexto(c), F(12), W);
  const leit = quebra(leituraTexto(c), F(12.5), W);
  const nota = quebra(notaTexto(c), F(10.5), W);
  const kp = kpisDados(c);
  const hTopo = 26 + info.length * 16 + 10 + CV.hKpi + 12 + leit.length * 17 + 10 + 22;
  const hTab = CV.hTit + CV.hHead + 3 * CV.hSum + c.rows.length * CV.hRow;
  const H = hTopo + hTab + 10 + nota.length * 14;
  // teto de canvas do iPhone (~16,7 MP): fluxo muito longo reduz a escala em vez de falhar
  const s = Math.min(scale, Math.sqrt(16e6 / ((W + CV.pad * 2) * (H + CV.pad * 2))));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((W + CV.pad * 2) * s);
  cv.height = Math.ceil((H + CV.pad * 2) * s);
  const g = cv.getContext('2d');
  g.scale(s, s);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W + CV.pad * 2, H + CV.pad * 2);
  g.translate(CV.pad, CV.pad);
  const txt = (t, x, y, o = {}) => { g.fillStyle = o.cor || '#1a1a1a'; g.font = o.fonte || F(11.5); g.textAlign = o.al || 'left'; g.textBaseline = 'middle'; g.fillText(String(t), x, y); };
  const cel = (x, y, w, h, bg) => { g.fillStyle = bg || '#fff'; g.fillRect(x, y, w, h); g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w, h); };
  const multi = (linhas, xc, yc, fonte) => { const lh = 12; const y0 = yc - (linhas.length - 1) * lh / 2; linhas.forEach((t, j) => txt(t, xc, y0 + j * lh, { al: 'center', fonte })); };

  let y = 0;
  txt('SIMULAÇÃO DE CORREÇÃO PELO INCC', 0, y + 10, { fonte: F(17, true) });
  txt('House PSM · ' + new Date().toLocaleDateString('pt-BR'), W, y + 10, { al: 'right', fonte: F(11), cor: '#666' });
  y += 26;
  info.forEach(l => { txt(l, 0, y + 7, { fonte: F(12), cor: '#333' }); y += 16; });
  y += 10;
  const gap = 10, kw = (W - gap * (kp.length - 1)) / kp.length;
  kp.forEach((k, i) => {
    const x = i * (kw + gap);
    g.fillStyle = k.bg; g.fillRect(x, y, kw, CV.hKpi);
    txt(k.lbl, x + 10, y + 13, { fonte: F(10, true), cor: k.fg2 });
    txt(k.val, x + 10, y + 32, { fonte: F(18, true), cor: k.fg });
    txt(k.sub, x + 10, y + 48, { fonte: F(10.5), cor: k.fg2 });
  });
  y += CV.hKpi + 12;
  leit.forEach(l => { txt(l, 0, y + 7, { fonte: F(12.5) }); y += 17; });
  y += 10;
  let lx = 0;
  LEGENDA.forEach(l => { cel(lx, y + 4, 12, 12, l.bg); txt(l.t, lx + 18, y + 10, { fonte: F(11.5) }); med.font = F(11.5); lx += 18 + med.measureText(l.t).width + 20; });
  y += 22;

  // cabeçalho: N°/Data/INCC com altura dupla + as duas faixas (FLUXO amarela, PROJEÇÃO laranja)
  const hh = CV.hTit + CV.hHead;
  cols.forEach((k, i) => { if (!k.g) { cel(X[i], y, k.w, hh, COR.head); multi(k.tl, X[i] + k.w / 2, y + hh / 2, F(10.5, true)); } });
  [['F', COR.titF, 'FLUXO DE PAGAMENTO'], ['I', COR.titI, 'PROJEÇÃO INCC']].forEach(([grp, cor, titulo]) => {
    const idx = cols.map((k, i) => (k.g === grp ? i : -1)).filter(i => i >= 0);
    if (!idx.length) return;
    const x0 = X[idx[0]], x1 = X[idx[idx.length - 1] + 1];
    cel(x0, y, x1 - x0, CV.hTit, cor);
    txt(titulo, (x0 + x1) / 2, y + CV.hTit / 2, { al: 'center', fonte: F(14, true) });
  });
  cols.forEach((k, i) => { if (k.g) { cel(X[i], y + CV.hTit, k.w, CV.hHead, k.g === 'I' ? COR.headI : COR.head); multi(k.tl, X[i] + k.w / 2, y + CV.hTit + CV.hHead / 2, F(10, true)); } });
  y += hh;

  // célula: dinheiro com "R$" encostado à esquerda e valor à direita, como a planilha
  const escreve = (v, st, i, k, yy, h, alinh) => {
    const fonte = F(11.5, st.bold), cor = v.fg || st.fg;
    if ('money' in v) {
      if (Math.abs(v.money || 0) > 0.005) { txt('R$', X[i] + 5, yy + h / 2, { fonte, cor }); txt(fmt2(v.money), X[i + 1] - 5, yy + h / 2, { al: 'right', fonte, cor }); }
      return;
    }
    if (!v.txt) return;
    if (alinh === 'ic-ctr') txt(v.txt, X[i] + k.w / 2, yy + h / 2, { al: 'center', fonte, cor });
    else txt(v.txt, X[i + 1] - 5, yy + h / 2, { al: 'right', fonte, cor });
  };
  const stResumo = { bg: COR.resumo, fg: '#1a1a1a', bold: true };
  resumoLinhas(c).forEach(rl => {
    cel(0, y, X[nFix], CV.hSum, COR.resumoLbl);
    txt(rl.lbl, X[nFix] / 2, y + CV.hSum / 2, { al: 'center', fonte: F(10.5, true) });
    cols.forEach((k, i) => { if (!k.g) return; cel(X[i], y, k.w, CV.hSum, stResumo.bg); escreve(rl.cel(k), stResumo, i, k, y, CV.hSum, 'ic-dir'); });
    y += CV.hSum;
  });
  c.rows.forEach(r => {
    cols.forEach((k, i) => {
      const st = estiloCel(c, r, k);
      cel(X[i], y, k.w, CV.hRow, st.bg);
      escreve(conteudo(c, r, k), st, i, k, y, CV.hRow, (k.k === 'n' || k.k === 'data') ? 'ic-ctr' : 'ic-dir');
    });
    y += CV.hRow;
  });
  y += 10;
  nota.forEach(l => { txt(l, 0, y + 6, { fonte: F(10.5), cor: '#555' }); y += 14; });
  return cv;
}

function nomeArquivo() {
  const base = String(_s.cliente || _s.empreendimento || 'psm').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'psm';
  return `incc-${base}.png`;
}

async function baixarFoto() {
  try {
    const cv = desenharFolha(compute(), 2);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('canvas vazio');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nomeArquivo();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    alert('Não consegui gerar a foto (' + (e.message || e) + '). Use 🖨 Imprimir/PDF — sai idêntico.');
  }
}

function dataUrlParaBlob(u) {
  const bin = atob(u.split(',')[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/png' });
}

function podeEnviarArquivo() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] })); } catch (_) { return false; }
}

// 📲 manda a FOTO direto (WhatsApp, e-mail…) pela folha de compartilhar do aparelho
async function enviarFoto() {
  try {
    // tudo síncrono até o share: ele só abre com o clique ainda "fresco"
    const url = desenharFolha(compute(), 2).toDataURL('image/png');
    const file = new File([dataUrlParaBlob(url)], nomeArquivo(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Simulação INCC' });
    else await baixarFoto();
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // fechou a folha de compartilhar
    alert('Não consegui compartilhar (' + (e.message || e) + '). Use 📷 Baixar foto.');
  }
}

/* via limpa (janela nova): igual à foto, pronta pra imprimir/salvar PDF/compartilhar */
function abrirVia(autoPrint) {
  const c = compute();
  let foto = '';
  try { foto = desenharFolha(c, 2).toDataURL('image/png'); } catch (_) {}
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>INCC ${esc(_s.cliente || _s.empreendimento || 'PSM')}</title>
    <style>
      body{margin:18px;background:#fff;color:#1a1a1a}
      .acoes{position:fixed;top:10px;right:10px;display:flex;gap:8px;font-family:Arial;z-index:9}
      .acoes button,.acoes a{padding:8px 14px;border:1px solid #999;border-radius:8px;background:#f5f5f5;font-weight:700;cursor:pointer;text-decoration:none;color:#1a1a1a;font-size:13px;font-family:Arial}
      @page{size:A4 landscape;margin:8mm}
      @media print{.acoes{display:none}body{margin:0;zoom:.82}}
      ${IC_CSS}
    </style></head><body>
    <div class="acoes">
      <button onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
      ${foto ? `<a href="${foto}" download="${nomeArquivo()}">📷 Baixar foto</a>` : ''}
      <button onclick="window.close()">✕ Fechar</button>
    </div>
    <div class="ic-folha">${folhaHTML(c, true)}</div>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela — libere pop-ups pra imprimir/compartilhar.'); return; }
  w.document.write(html);
  w.document.close();
  if (autoPrint) setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
}

/* ═══════════ TELA ═══════════ */
const IC_TELA = `
  .ic-grid{display:grid;grid-template-columns:340px minmax(0,1fr);gap:14px;margin-top:12px;align-items:start}
  @media(max-width:900px){.ic-grid{grid-template-columns:minmax(0,1fr)}}
  .ic-form{background:var(--bg-3);border-radius:10px;padding:14px}
  .ic-sec{text-transform:uppercase;font-weight:800;letter-spacing:1px;margin:14px 0 6px;font-size:11px;color:var(--ink-muted)}
  .ic-sec:first-child{margin-top:0}
  .ic-f{margin-bottom:7px}
  .ic-f>label{display:block;font-weight:600;font-size:11.5px;color:var(--ink-muted);margin-bottom:2px}
  .ic-in{display:flex;gap:5px;align-items:center}
  .ic-in input{flex:1;min-width:0;font-size:12.5px;padding:6px 8px}
  .ic-in span{font-size:11.5px;color:var(--ink-muted);font-weight:700;white-space:nowrap}
  .ic-dica{font-size:11px;color:var(--ink-muted);margin-top:3px;line-height:1.35}
  .ic-comp{background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:8px 9px;margin-bottom:7px}
  .ic-comp-t{font-weight:700;font-size:12px;margin-bottom:5px}
  .ic-sub{font-weight:400;font-size:10.5px;color:var(--ink-muted)}
  .ic-comp-g{display:grid;grid-template-columns:54px minmax(0,1fr) minmax(0,1.3fr);gap:6px}
  .ic-comp-x{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;margin-top:6px}
  .ic-comp-g label,.ic-comp-x label{display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--ink-muted);font-weight:600}
  .ic-comp-g input,.ic-comp-x input{font-size:12.5px;padding:5px 6px;min-width:0;width:100%}
  .ic-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
  .ic-kpis .k{border-radius:10px;padding:12px}
  .ic-kpis .l{font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase}
  .ic-kpis .v{font-size:19px;font-weight:900;margin:4px 0 2px}
  .ic-kpis .s{font-size:11px}
  .ic-leitura{background:var(--bg-3);border-left:4px solid #f59e0b;border-radius:8px;padding:10px 12px;margin:12px 0;font-size:13px;line-height:1.5}
  .ic-minis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px}
  .ic-mini{background:var(--bg-3);padding:10px;border-radius:8px}
  .ic-mini-v{font-weight:800;font-size:14px;color:var(--tx);margin:1px 0}
  .ic-val{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
  .ic-como{font-size:12px;color:var(--ink-muted);margin:18px 0 8px;line-height:1.5}
  .ic-tag{color:#1a1a1a;padding:0 5px;border-radius:3px;font-size:11px}
  .ic-wrap{background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;overflow-x:auto}
  .ic-wrap .ic-folha{padding:12px;border-radius:6px;width:max-content}
`;

function render() {
  _root.innerHTML = `
    <style>${IC_CSS}${IC_TELA}</style>
    <div class="card">
      <h2 class="card-title">📊 Simulador INCC · Fluxo corrigido</h2>
      <p class="card-sub">Mês a mês, quanto cada parcela vai custar com a correção do INCC até as chaves — igual à aba <b>SIMULADOR INCC</b> da planilha, na tela, na foto e na impressão</p>
      <div class="ic-grid">
        <div class="ic-form">${formHTML()}</div>
        <div>
          <div class="ic-kpis" id="ic-kpis"></div>
          <div class="ic-leitura" id="ic-leitura"></div>
          <div class="ic-minis" id="ic-minis"></div>
          <div id="ic-valoriz"></div>
          <div class="flex gap-2" style="flex-wrap:wrap;margin-top:14px">
            <button class="btn btn-primary" id="ic-print">🖨 Imprimir / PDF</button>
            <button class="btn btn-ghost" id="ic-share">📤 Compartilhar (via limpa)</button>
            <button class="btn btn-ghost" id="ic-foto">📷 Baixar foto (PNG)</button>
            ${podeEnviarArquivo() ? '<button class="btn btn-ghost" id="ic-enviar">📲 Enviar foto</button>' : ''}
            <button class="btn btn-ghost" data-back style="margin-left:auto">← Voltar Simuladores</button>
          </div>
        </div>
      </div>
      <div class="ic-como" id="ic-como"></div>
      <!-- fluxo INTEIRO na página, largura cheia (a página cresce; rola de lado só em tela estreita) -->
      <div class="ic-wrap"><div class="ic-folha" id="ic-planilha"></div></div>
      <div class="alert" style="background:rgba(239,68,68,.1);color:var(--err-suave);border:1px solid rgba(239,68,68,.3);margin-top:14px;padding:12px;border-radius:8px">
        <b>💡 Importante:</b> o INCC corrige o saldo mês a mês durante a obra e o índice real sai todo mês (FGV) — a projeção usa uma taxa constante. Depois das chaves, o saldo passa a seguir as regras do financiamento bancário.
      </div>
    </div>`;
  bind();
  pintaSaida();
}

function formHTML() {
  return `
    <div class="ic-sec">Dados do imóvel</div>
    ${campo('Empreendimento', 'empreendimento', { tipo: 'text' })}
    ${campo('Unidade', 'unidade', { tipo: 'text' })}
    ${campo('Cliente', 'cliente', { tipo: 'text' })}
    ${campo('Valor total do imóvel', 'valorTotal', { rs: true })}
    <div class="ic-sec">Datas</div>
    ${campo('Data da venda', 'dataVenda', { tipo: 'date' })}
    ${campo('Prazo até as chaves / financiamento', 'prazo', { suf: 'meses' })}
    <div class="ic-f"><label>Data das chaves / financiamento</label>
      <div class="ic-in"><input type="date" class="input" id="ic-dataChaves" value="${esc(somaMeses(_s.dataVenda, Math.round(+_s.prazo || 0)))}"></div>
      <div class="ic-dica" id="ic-h-datas"></div></div>
    <div class="ic-sec">INCC</div>
    ${campo('INCC projetado', 'inccAA', { suf: '% a.a.', dica: 'ic-h-incc' })}
    ${campo('% do fluxo sem correção', 'pctSemCorrecao', { suf: '%', dica: 'ic-h-sem' })}
    <div class="ic-sec">Fluxo de pagamento</div>
    ${comp('Entrada / ato', '(Nº 1 = à vista)', 'ato', 'pctAto', 'numAto')}
    ${comp('Mensais', '(Nº 0 = até as chaves)', 'mensal', 'pctMensal', 'numMensais')}
    ${comp('Semestrais', '', 'semestral', 'pctSemestral', 'numSemestrais')}
    ${comp('Anuais', '', 'anual', 'pctAnual', 'numAnuais')}
    ${comp('🎈 Balões', '(periodicidade livre)', 'balao', 'pctBalao', 'numBaloes', `
      <div class="ic-comp-x">
        <label>A cada (meses)<input ${ATTR_NUM} class="input" data-key="intervaloBalao" data-tipo="num" value="${esc(numCampo(_s.intervaloBalao))}"></label>
        <label>1º no mês (0 = no intervalo)<input ${ATTR_NUM} class="input" data-key="inicioBalao" data-tipo="num" value="${esc(numCampo(_s.inicioBalao))}"></label>
      </div><div class="ic-dica" id="ic-h-balao"></div>`)}
    ${comp('Financiamento / chaves', '(no mês das chaves)', 'financ', 'pctFinanc', null)}
    <div id="ic-alerta"></div>
    <div class="ic-sec">Projeção de valorização <span class="ic-sub" style="text-transform:none;letter-spacing:0">(opcional)</span></div>
    ${campo('Valorização esperada do imóvel', 'valorizacaoAA', { suf: '% a.a.', dica: 'ic-h-val' })}
    <div class="flex gap-2" style="flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-ghost btn-sm" id="ic-vpl">📐 Usar o fluxo do Simulador VPL</button>
      <button class="btn btn-ghost btn-sm" id="ic-exemplo">↺ Exemplo da planilha</button>
    </div>`;
}

function campo(rotulo, key, o = {}) {
  const tipo = o.tipo || 'num';
  const attrs = tipo === 'text' ? 'type="text"' : tipo === 'date' ? 'type="date"' : ATTR_NUM;
  const val = tipo === 'num' ? (o.rs ? moedaCampo(_s[key]) : numCampo(_s[key])) : (_s[key] ?? '');
  return `<div class="ic-f"><label>${rotulo}</label>
    <div class="ic-in">${o.rs ? '<span>R$</span>' : ''}<input ${attrs} class="input" data-key="${key}" data-tipo="${tipo}"${o.rs ? ' data-fmt="rs"' : ''} value="${esc(val)}">${o.suf ? `<span>${o.suf}</span>` : ''}</div>
    ${o.dica ? `<div class="ic-dica" id="${o.dica}"></div>` : ''}</div>`;
}

function comp(titulo, sub, id, pctKey, numKey, extra = '') {
  const num = numKey
    ? `<input ${ATTR_NUM} class="input" data-key="${numKey}" data-tipo="num" value="${esc(numCampo(_s[numKey]))}">`
    : '<input type="text" class="input" value="1" disabled>';
  return `<div class="ic-comp">
    <div class="ic-comp-t">${titulo}${sub ? ` <span class="ic-sub">${sub}</span>` : ''}</div>
    <div class="ic-comp-g">
      <label>Nº${num}</label>
      <label>% do valor<input ${ATTR_NUM} class="input" data-key="${pctKey}" data-tipo="num" value="${esc(numCampo(_s[pctKey]))}"></label>
      <label>R$ por parcela<input ${ATTR_NUM} class="input" data-rs="${id}" value=""></label>
    </div>${extra}
  </div>`;
}

function kpisHTML(c) {
  return kpisDados(c).map(k => `<div class="k" style="background:${k.bg};color:${k.fg}">
    <div class="l" style="color:${k.fg2}">${k.lbl}</div><div class="v">${k.val}</div><div class="s" style="color:${k.fg2}">${esc(k.sub)}</div></div>`).join('');
}

function minisHTML(c) {
  const mini = (l, v, s) => `<div class="ic-mini"><div class="tiny muted">${l}</div><div class="ic-mini-v">${v}</div>${s ? `<div class="tiny muted">${s}</div>` : ''}</div>`;
  const out = [mini(c.nAto > 1 ? `Entrada ${c.nAto}x` : 'Entrada', brl(c.ato), `${pctN(_s.pctAto)} do valor`)];
  if (c.nMensais) out.push(mini(`Mensais ${c.nMensais}x`, brl(c.mensal), `corrigida: 1ª ${brl(c.mensal1)} → última ${brl(c.mensalN)}`));
  if (c.nSemestrais) out.push(mini(`Semestrais ${c.nSemestrais}x`, brl(c.semestral), `${pctN(_s.pctSemestral)} do valor`));
  if (c.nAnuais) out.push(mini(`Anuais ${c.nAnuais}x`, brl(c.anual), `${pctN(_s.pctAnual)} do valor`));
  if (c.temBalao) out.push(mini(`🎈 Balões ${c.nBaloes}x`, brl(c.balao), `meses ${c.mesesBalao.join(', ')}`));
  out.push(mini('Financiamento / chaves', brl(c.financ), `nas chaves ≈ ${brl(c.financCorrigido)}`));
  out.push(mini('INCC acumulado até as chaves', pct2(c.inccChaves), `${labelMes(0)} → ${labelMes(c.prazo)} · ${c.prazo} meses`));
  out.push(mini(`Economia (${pctN(c.pctSemCorr)} sem correção)`, brl(c.economia), `100% corrigido seria ${brl(c.tot.cheio)}`));
  return out.join('');
}

function valorizHTML(c) {
  if (!(c.valAA > 0)) return '';
  const cel = (l, v) => `<div class="ic-mini"><div class="tiny muted">${l}</div><div class="ic-mini-v">${v}</div></div>`;
  return `<div style="margin-top:12px">
    <div class="tiny muted" style="text-transform:uppercase;font-weight:800;letter-spacing:1px;margin-bottom:6px">📈 Projeção de valorização × custo do INCC</div>
    <div class="ic-val">${cel('Ao mês', pct2(c.valAM))}${cel('Ao ano', pctN(c.valAA))}${cel('Prazo', c.prazo + ' meses')}${cel('Acumulado', `${pct2(c.valAcum)} · ${brl(c.valRS)}`)}${cel('Valorização líquida', `${brl(c.valLiq)} · ${pct2(c.valLiqPct)}`)}${cel('Valoriz. líq. ao mês', pct2(c.valLiqAM))}</div>
    <div class="tiny muted" style="margin-top:6px">Líquida = valorização do imóvel até as chaves − custo do INCC no mesmo período.</div></div>`;
}

function comoLerHTML(c) {
  return `<b>Como ler:</b> cada linha é um mês, da venda (${labelMes(0)}) às chaves (${labelMes(c.prazo)}). As colunas de <b class="ic-tag" style="background:${COR.titF}">FLUXO DE PAGAMENTO</b> são a tabela, sem correção. As de <b class="ic-tag" style="background:${COR.titI}">PROJEÇÃO INCC</b> mostram o índice: <b>100% corrigido</b> = a parcela se todo o fluxo fosse corrigido; <b>valor corrigido</b> = com a regra do contrato${c.pctSemCorr > 0 ? ` (os primeiros ${pctN(c.pctSemCorr)} pagos não sofrem INCC)` : ''} — é o que o cliente deve pagar; <b>custo INCC</b> = quanto o índice acrescenta àquela parcela. A cor do Nº diz se a parcela é corrigida.`;
}

/* Repinta SÓ o resultado e os campos ligados que NÃO estão com o foco — o
   campo onde o dedo está nunca é recriado (é isso que fazia ele "apagar"). */
function pintaSaida() {
  const c = compute();
  const set = (sel, html) => { const el = _root.querySelector(sel); if (el) el.innerHTML = html; };
  set('#ic-kpis', kpisHTML(c));
  set('#ic-leitura', esc(leituraTexto(c)));
  set('#ic-minis', minisHTML(c));
  set('#ic-valoriz', valorizHTML(c));
  set('#ic-como', comoLerHTML(c));
  set('#ic-planilha', folhaHTML(c, false));
  set('#ic-h-incc', `INCC mensal equivalente: <b>${pct4(c.inccM)}</b> a.m. · acumulado até as chaves: <b>${pct2(c.inccChaves)}</b>`);
  set('#ic-h-sem', c.pctSemCorr > 0
    ? `Os primeiros ${pctN(c.pctSemCorr)} do fluxo (${brl(c.tot.total * c.pctSemCorr / 100)}) são pagos sem INCC; daí em diante, tudo é corrigido.`
    : 'Todo o fluxo é corrigido pelo INCC desde o 1º mês.');
  set('#ic-h-datas', `venda <b>${labelMes(0)}</b> → chaves <b>${labelMes(c.prazo)}</b> = ${c.prazo} meses`);
  set('#ic-h-balao', c.temBalao ? `balões nos meses <b>${c.mesesBalao.join(', ')}</b>` : '');
  set('#ic-h-val', c.valAA > 0 ? `${pct2(c.valAM)} ao mês · ${pct2(c.valAcum)} até as chaves` : 'Opcional: compare a valorização do imóvel com o custo do INCC.');
  set('#ic-alerta', c.avisos.length ? `<div class="alert alert-warn tiny" style="margin:2px 0 6px">${c.avisos.map(a => '⚠ ' + esc(a)).join('<br>')}</div>` : '');
  const ae = document.activeElement;
  _root.querySelectorAll('[data-rs]').forEach(el => {
    if (el === ae) return;
    const p = c.parcelas[el.dataset.rs];
    el.value = p && p.n > 0 ? moedaCampo(p.v) : '';
    el.placeholder = p && p.n > 0 ? '' : 'defina o Nº';
  });
  const pz = _root.querySelector('[data-key="prazo"]');
  if (pz && pz !== ae) pz.value = numCampo(c.prazo);
  const dc = _root.querySelector('#ic-dataChaves');
  if (dc && dc !== ae) dc.value = somaMeses(_s.dataVenda, c.prazo);
}

// "R$ por parcela" digitado → vira o % do valor (que é o que fica salvo)
const COMP_PCT = { ato: 'pctAto', mensal: 'pctMensal', semestral: 'pctSemestral', anual: 'pctAnual', balao: 'pctBalao', financ: 'pctFinanc' };
function definirPorValor(id, valorParcela) {
  const c = compute();
  const p = c.parcelas[id], k = COMP_PCT[id];
  if (!k || !(c.valor > 0) || !(p.n > 0)) return;
  _s[k] = valorParcela * p.n / c.valor * 100;
  const el = _root.querySelector(`[data-key="${k}"]`);
  if (el && el !== document.activeElement) el.value = numCampo(_s[k]);
}

// monta no INCC o mesmo fluxo que o corretor já fechou no Simulador VPL (mesmo aparelho)
function usarFluxoVPL() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(KEY_VPL) || 'null'); } catch (_) {}
  if (!v || !(+v.valorTabela > 0)) { alert('Não achei proposta salva no Simulador VPL neste aparelho — monte o fluxo lá primeiro.'); return; }
  const n = (x, d = 0) => (x === '' || x == null || !isFinite(+x) ? d : +x);
  Object.assign(_s, {
    empreendimento: v.empreendimento || '', unidade: v.torreUnidade || '', cliente: v.cliente || '',
    dataVenda: v.dataInicio || _s.dataVenda, prazo: n(v.prazoObra, 42),
    valorTotal: n(v.valorTabela) * (1 - n(v.desconto) / 100),
    pctAto: n(v.pctAto, 5), numAto: n(v.numAto, 1),
    pctMensal: n(v.pctMensal, 14), numMensais: n(v.numMensais),
    pctSemestral: n(v.pctSemestral), numSemestrais: n(v.numSemestrais),
    pctAnual: n(v.pctAnual, 6), numAnuais: n(v.numAnuais, 3),
    pctBalao: n(v.pctBalao), numBaloes: n(v.numBaloes), intervaloBalao: n(v.intervaloBalao, 10), inicioBalao: n(v.inicioBalao),
    pctFinanc: n(v.pctFinanc, 75),
  });
  save();
  render();
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.key;
      _s[k] = el.dataset.tipo === 'num' ? parseNum(el.value) : el.value;
      save();
      pintaSaida();
    });
    // ao sair do campo, o número volta arrumado (1.436,79 · 6,5) — nunca enquanto se digita
    if (el.dataset.tipo === 'num') el.addEventListener('blur', () => { el.value = el.dataset.fmt === 'rs' ? moedaCampo(_s[el.dataset.key]) : numCampo(_s[el.dataset.key]); });
  });
  _root.querySelectorAll('[data-rs]').forEach(el => {
    el.addEventListener('input', () => { definirPorValor(el.dataset.rs, parseNum(el.value)); save(); pintaSaida(); });
    el.addEventListener('blur', () => pintaSaida());
  });
  const dc = _root.querySelector('#ic-dataChaves');
  if (dc) dc.addEventListener('input', () => {
    const p = mesesEntre(_s.dataVenda, dc.value);
    if (p == null) return;
    _s.prazo = Math.max(0, Math.min(480, p));
    save();
    pintaSaida();
  });
  on('#ic-print', () => abrirVia(true));
  on('#ic-share', () => abrirVia(false));
  on('#ic-foto', baixarFoto);
  on('#ic-enviar', enviarFoto);
  on('#ic-vpl', usarFluxoVPL);
  on('#ic-exemplo', () => { if (!confirm('Trocar os dados atuais pelo exemplo da planilha?')) return; _s = padrao(); save(); render(); });
  on('[data-back]', () => { location.hash = '/simuladores'; });
}

function on(sel, fn) { const el = _root.querySelector(sel); if (el) el.addEventListener('click', fn); }
