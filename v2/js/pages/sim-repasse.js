/* PSM-OS v2 — Simulador Repasse (Sprint 8.4 · v87.73)
   Fiel à aba SIMULADOR REPASSE da planilha oficial (VPL-09_26.xlsx):
     custo total      = valor pago atualizado + saldo devedor                 (J8)
     diferença total  = novo valor − custo total                              (D17)
     entrada nova     = valor pago + diferença  (= novo valor − saldo)        (D16)
     lucro vendedor   = entrada − (comissão + valor pago)  = ÁGIO em R$       (D20 / I20)
     ágio %           = lucro ÷ valor pago                                    (I21)
     renda ao mês     = ágio % ÷ (meses p/ vender + prazo da entrada nova)    (I22)
     saldo na entrega = saldo devedor − mensais − balões  (J6 = M10+M12+M13)
   v87.73: formulário desenhado UMA vez — digitar só repinta o resultado (o
   campo parava de apagar; ver sim-campos.js). Mensais/balões, que eram
   digitados e não entravam em conta nenhuma, agora compõem o saldo; entraram
   a cessão de direitos e o rendimento ao mês da planilha. */
import { ATTR_NUM, parseNum, numCampo } from '../sim-campos.js';

const KEY = 'psm_v2_sim_repasse';
const DEFAULTS = {
  nomeImovel: 'PLATZ', unidade: '2101', m2: 35,
  valorContrato: 303900, dataCompra: '2022-02-15', dataExtrato: '2026-02-23',
  valorPago: 118110.89, saldoDevedor: 249667.74,
  prazoRestante: 1, numMensais: 1, valorMensais: 0,
  numBaloes: 0, valorBaloes: 0,
  novoValor: 450000, comissaoPct: 5, parcelasEntrada: 3,
  cessao: 0, tempoMeses: 48,
};
let _root, _s;

export async function pageSimRepasse(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

function compute() {
  const r = _s;
  const n = k => +r[k] || 0;
  const custoTotal = n('valorPago') + n('saldoDevedor');
  const totalMensais = n('numMensais') * n('valorMensais');
  const totalBaloes = n('numBaloes') * n('valorBaloes');
  // o saldo devedor é TUDO que falta: mensais + balões + o que sobra para as chaves
  const saldoEntrega = n('saldoDevedor') - totalMensais - totalBaloes;
  const diferenca = n('novoValor') - custoTotal;
  const entrada = n('valorPago') + diferenca;
  const comissao = n('novoValor') * n('comissaoPct') / 100;
  const lucro = entrada - (comissao + n('valorPago'));
  // % sobre o que o proprietário JÁ PAGOU; sem valor pago não existe % (era "Infinity%")
  const agioPct = n('valorPago') > 0 ? lucro / n('valorPago') : null;
  const rendaMes = agioPct != null && n('tempoMeses') > 0 ? agioPct / n('tempoMeses') : null;
  const parcelaEntrada = n('parcelasEntrada') > 0 ? entrada / n('parcelasEntrada') : 0;
  return {
    custoTotal, totalMensais, totalBaloes, saldoEntrega, diferenca, entrada, comissao, lucro, agioPct, rendaMes, parcelaEntrada,
    totalComprador: entrada + n('saldoDevedor'), entradaMaisCessao: entrada + n('cessao'),
    m2Novo: n('m2') > 0 ? n('novoValor') / n('m2') : 0, m2Contrato: n('m2') > 0 ? n('valorContrato') / n('m2') : 0,
  };
}

function render() {
  _root.innerHTML = `
    <style>@media(max-width:900px){.rp-grid{grid-template-columns:minmax(0,1fr) !important}}</style>
    <div class="card">
      <h2 class="card-title">💰 Simulador de Repasse</h2>
      <p class="card-sub">Precificação de repasse com saldo devedor — análise para o proprietário e fluxo para o novo comprador (igual à aba SIMULADOR REPASSE da planilha)</p>

      <div class="rp-grid" style="display:grid;grid-template-columns:320px minmax(0,1fr);gap:14px;margin-top:12px;align-items:start">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          ${sec('Imóvel', true)}
          ${inp('Nome', 'nomeImovel', 'text')}
          ${inp('Unidade', 'unidade', 'text')}
          ${inp('M²', 'm2', 'num', 'm²')}
          ${inp('Valor original do contrato', 'valorContrato', 'num', 'R$')}
          ${inp('Data de compra', 'dataCompra', 'date')}

          ${sec('Extrato atualizado')}
          ${inp('Data do extrato', 'dataExtrato', 'date')}
          ${inp('Valor pago atualizado', 'valorPago', 'num', 'R$')}
          ${inp('Saldo devedor atualizado', 'saldoDevedor', 'num', 'R$')}
          ${inp('Prazo restante da dívida (meses)', 'prazoRestante', 'num')}
          ${inp('Nº de mensais restantes', 'numMensais', 'num')}
          ${inp('Valor das mensais', 'valorMensais', 'num', 'R$')}
          ${inp('Nº de balões restantes', 'numBaloes', 'num')}
          ${inp('Valor dos balões', 'valorBaloes', 'num', 'R$')}

          ${sec('Proposta de venda')}
          ${inp('Novo valor total sugerido', 'novoValor', 'num', 'R$')}
          ${inp('Comissão', 'comissaoPct', 'num', '%')}
          ${inp('Parcelas da entrada', 'parcelasEntrada', 'num', 'x')}
          ${inp('Valor da cessão de direitos', 'cessao', 'num', 'R$')}
          ${inp('Tempo p/ vender + prazo da entrada nova', 'tempoMeses', 'num', 'meses')}
        </div>

        <div>
          <div id="rp-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px"></div>
          <div id="rp-alerta"></div>

          <div class="card" style="padding:14px;margin-bottom:14px">
            <div style="font-weight:800;margin-bottom:10px">📊 Análise de investimento do proprietário</div>
            <div id="rp-analise" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"></div>
          </div>

          <div class="card" style="padding:14px;margin-bottom:14px">
            <div style="font-weight:800;margin-bottom:10px">🧾 Composição do saldo devedor</div>
            <div id="rp-saldo" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"></div>
          </div>

          <div class="card" style="padding:14px;border-left:4px solid #22c55e">
            <div style="font-weight:800;color:#22c55e;margin-bottom:10px">🤝 Fluxo da proposta para o novo comprador</div>
            <div id="rp-fluxo" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"></div>
          </div>

          <div class="flex gap-2 mt-3">
            <button class="btn btn-ghost" id="rp-print">🖨 Imprimir</button>
            <button class="btn btn-ghost" data-back>← Voltar Simuladores</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bind();
  pintaSaida();
}

/* Repinta SÓ o lado direito — os <input> ficam vivos do começo ao fim */
function pintaSaida() {
  const c = compute();
  const set = (sel, html) => { const el = _root.querySelector(sel); if (el) el.innerHTML = html; };
  const corLucro = c.lucro >= 0 ? '#22c55e' : '#ef4444';
  set('#rp-kpis',
    kpi('Novo valor', fmt(_s.novoValor), 'var(--psm-navy)')
    + kpi('Ágio (lucro do vendedor)', fmt(c.lucro), corLucro, c.agioPct != null ? pct(c.agioPct) + ' sobre o valor pago' : 'informe o valor pago')
    + kpi('Rendimento ao mês', c.rendaMes != null ? pct(c.rendaMes) : '—', '#0ea5e9', `ágio ÷ ${num(_s.tempoMeses)} meses`)
    + kpi('Entrada do comprador', fmt(c.entrada), '#16a34a', +_s.parcelasEntrada > 0 ? `${num(_s.parcelasEntrada)}x de ${fmt(c.parcelaEntrada)}` : ''));
  set('#rp-alerta', c.saldoEntrega < -0.005
    ? `<div class="alert alert-warn tiny" style="margin-bottom:14px">⚠ Mensais + balões (${fmt(c.totalMensais + c.totalBaloes)}) passam do saldo devedor (${fmt(_s.saldoDevedor)}) — confira o extrato.</div>` : '');
  set('#rp-analise', [
    mini('Valor pago atualizado', fmt(_s.valorPago)),
    mini('Custo total atualizado', fmt(c.custoTotal), '', 'valor pago + saldo devedor'),
    mini('Diferença total', fmt(c.diferenca), c.diferenca >= 0 ? '' : '#ef4444', 'novo valor − custo total (antes da comissão)'),
    mini('Comissão ' + pctNum(_s.comissaoPct), fmt(c.comissao), 'var(--psm-gold)'),
    mini('Ágio em R$ (lucro do vendedor)', fmt(c.lucro), corLucro, 'entrada − comissão − valor pago'),
    mini('Ágio em %', c.agioPct != null ? pct(c.agioPct) : '—', corLucro, 'sobre o valor pago'),
    mini('Ágio ÷ tempo', c.rendaMes != null ? pct(c.rendaMes) + ' ao mês' : '—', '', `${num(_s.tempoMeses)} meses p/ vender + prazo da entrada`),
    mini('R$/m² da venda', c.m2Novo ? 'R$ ' + Math.round(c.m2Novo).toLocaleString('pt-BR') : '—', '', c.m2Contrato ? `no contrato: R$ ${Math.round(c.m2Contrato).toLocaleString('pt-BR')}/m²` : ''),
  ].join(''));
  set('#rp-saldo', [
    mini('Mensais restantes', fmt(c.totalMensais), '', `${num(_s.numMensais)} × ${fmt(_s.valorMensais)}`),
    mini('Balões restantes', fmt(c.totalBaloes), '', `${num(_s.numBaloes)} × ${fmt(_s.valorBaloes)}`),
    mini('Saldo na entrega (chaves)', fmt(c.saldoEntrega), c.saldoEntrega < -0.005 ? '#ef4444' : '', 'saldo devedor − mensais − balões'),
    mini('Prazo restante da dívida', `${num(_s.prazoRestante)} ${+_s.prazoRestante === 1 ? 'mês' : 'meses'}`, '', _s.dataExtrato ? `extrato de ${dataBR(_s.dataExtrato)}` : ''),
  ].join(''));
  set('#rp-fluxo', [
    mini('Valor de entrada', fmt(c.entrada), '#22c55e', 'novo valor − saldo devedor'),
    mini(`Parcela da entrada × ${num(_s.parcelasEntrada)}`, fmt(c.parcelaEntrada)),
    mini('Assume o saldo devedor', fmt(_s.saldoDevedor), '', c.totalMensais + c.totalBaloes > 0
      ? `mensais ${fmt(c.totalMensais)} + balões ${fmt(c.totalBaloes)} + chaves ${fmt(c.saldoEntrega)}` : 'na entrega das chaves'),
    mini('Valor total do imóvel', fmt(c.totalComprador), '', 'entrada + saldo devedor'),
    mini('Cessão de direitos', fmt(_s.cessao), '', 'taxa de transferência, se houver'),
    mini('Entrada + cessão', fmt(c.entradaMaisCessao), '#22c55e', 'desembolso do comprador na entrada'),
  ].join(''));
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', () => {
      _s[el.dataset.key] = el.dataset.type === 'num' ? parseNum(el.value) : el.value;
      save();
      pintaSaida();
    });
    if (el.dataset.type === 'num') el.addEventListener('blur', () => { el.value = numCampo(_s[el.dataset.key]); });
  });
  const pr = _root.querySelector('#rp-print'); if (pr) pr.addEventListener('click', () => window.print());
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function sec(t, primeiro) {
  return `<div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:${primeiro ? 0 : 14}px 0 6px">${t}</div>`;
}

function inp(label, key, type, suffix) {
  const val = type === 'num' ? numCampo(_s[key]) : (_s[key] ?? '');
  const attrs = type === 'text' ? 'type="text"' : type === 'date' ? 'type="date"' : ATTR_NUM;
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1" style="align-items:center">${suffix === 'R$' ? '<span class="tiny muted" style="font-weight:700">R$</span>' : ''}<input ${attrs} class="input" data-key="${key}" data-type="${type}" value="${esc(val)}" style="flex:1;min-width:0;font-size:12px;padding:6px 8px">${(suffix && suffix !== 'R$') ? `<span class="tiny muted">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, bg, sub) {
  return `<div style="background:${bg};color:#fff;padding:14px;border-radius:8px;text-align:center"><div style="font-size:9px;text-transform:uppercase;opacity:.85;font-weight:700">${label}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${value}</div>${sub ? `<div style="font-size:11px;opacity:.85;margin-top:2px">${sub}</div>` : ''}</div>`;
}

function mini(label, value, color, sub) {
  return `<div style="background:var(--bg-3);padding:10px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-weight:800;font-size:14px;color:${color || 'var(--tx)'}">${value}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function fmt(n) { return 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(f) { return ((Number(f) || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function pctNum(n) { return (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%'; }
function num(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
function dataBR(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
