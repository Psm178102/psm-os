/* PSM-OS v2 — Simulador Repasse (Sprint 8.4) */

const KEY = 'psm_v2_sim_repasse';
const DEFAULTS = {
  nomeImovel: 'PLATZ', unidade: '2101', m2: 35,
  valorContrato: 303900, dataCompra: '2022-02-15',
  valorPago: 118111, saldoDevedor: 249668,
  prazoRestante: 1, numMensais: 1, valorMensais: 0,
  numBaloes: 0, valorBaloes: 0,
  novoValor: 450000, comissaoPct: 5, parcelasEntrada: 3,
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
  const totalAtualizado = r.valorPago + r.saldoDevedor;
  const totalMensais = r.numMensais * r.valorMensais;
  const totalBaloes = r.numBaloes * r.valorBaloes;
  const saldoEntrega = r.saldoDevedor + totalMensais + totalBaloes;
  const entradaComprador = r.novoValor - r.saldoDevedor;
  const comissao = r.novoValor * r.comissaoPct / 100;
  // Lucro do vendedor = o que recebe (entrada) − o que já desembolsou (valorPago) − comissão.
  // O comprador assume o saldo devedor, então NÃO se subtrai de novo (antes era contado 2×). Equivale a ágio − comissão.
  const lucroVendedor = entradaComprador - r.valorPago - comissao;
  const agioValor = r.novoValor - totalAtualizado;
  const agioPct = totalAtualizado > 0 ? ((agioValor / r.valorPago) * 100).toFixed(1) : '0.0';
  const parcelaEntrada = r.parcelasEntrada > 0 ? entradaComprador / r.parcelasEntrada : 0;
  const m2Novo = r.m2 > 0 ? Math.round(r.novoValor / r.m2) : 0;
  return { totalAtualizado, totalMensais, totalBaloes, saldoEntrega, entradaComprador, comissao, lucroVendedor, agioValor, agioPct, parcelaEntrada, m2Novo };
}

function render() {
  const c = compute();
  const isPositive = c.lucroVendedor >= 0;
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">💰 Simulador de Repasse</h2>
      <p class="card-sub">Precificação de repasse com saldo devedor — análise para proprietário e novo comprador</p>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px;margin-top:12px">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:6px">Imóvel</div>
          ${inp('Nome', 'nomeImovel', 'text')}
          ${inp('Unidade', 'unidade', 'text')}
          ${inp('M²', 'm2', 'num', 'm²')}
          ${inp('Valor Original do Contrato', 'valorContrato', 'num', 'R$')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Saldo Atual</div>
          ${inp('Valor Pago Atualizado', 'valorPago', 'num', 'R$')}
          ${inp('Saldo Devedor Atualizado', 'saldoDevedor', 'num', 'R$')}
          ${inp('Prazo Restante (meses)', 'prazoRestante', 'num')}
          ${inp('Nº Mensais Restantes', 'numMensais', 'num')}
          ${inp('Valor das Mensais', 'valorMensais', 'num', 'R$')}
          ${inp('Nº Balões', 'numBaloes', 'num')}
          ${inp('Valor dos Balões', 'valorBaloes', 'num', 'R$')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Proposta de Venda</div>
          ${inp('Novo Valor Total Sugerido', 'novoValor', 'num', 'R$')}
          ${inp('Comissão (%)', 'comissaoPct', 'num', '%')}
          ${inp('Parcelas da Entrada', 'parcelasEntrada', 'num')}
        </div>

        <div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
            ${kpi('Novo Valor', fmt(_s.novoValor), 'var(--psm-navy)', '#fff')}
            ${kpi('Ágio', c.agioPct + '%<div style="font-size:11px;opacity:.7">' + fmt(c.agioValor) + '</div>', c.agioValor >= 0 ? '#22c55e' : '#ef4444')}
            ${kpi('Lucro Vendedor', fmt(c.lucroVendedor), isPositive ? '#22c55e' : '#ef4444')}
          </div>

          <div class="card" style="padding:14px;margin-bottom:14px">
            <div style="font-weight:800;margin-bottom:10px">Análise do Proprietário</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
              ${mini('Valor Pago', fmt(_s.valorPago))}
              ${mini('Total Atualizado (Custo)', fmt(c.totalAtualizado))}
              ${mini('Comissão ' + _s.comissaoPct + '%', fmt(c.comissao), 'var(--psm-gold)')}
              ${mini('Lucro Líquido', fmt(c.lucroVendedor), isPositive ? '#22c55e' : '#ef4444')}
              ${mini('R$/m² Novo', 'R$ ' + c.m2Novo.toLocaleString('pt-BR'))}
              ${mini('Saldo na Entrega', fmt(c.saldoEntrega))}
            </div>
          </div>

          <div class="card" style="padding:14px;border-left:4px solid #22c55e">
            <div style="font-weight:800;color:#22c55e;margin-bottom:10px">Fluxo da Proposta para Novo Comprador</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
              ${mini('Entrada para Comprador', fmt(c.entradaComprador), '#22c55e')}
              ${mini('Parcela Entrada × ' + _s.parcelasEntrada, fmt(c.parcelaEntrada))}
              ${mini('Saldo Devedor Assumido', fmt(_s.saldoDevedor))}
              ${mini('Total Comprador', fmt(c.entradaComprador + _s.saldoDevedor))}
            </div>
          </div>

          <div class="flex gap-2 mt-3">
            <button class="btn btn-ghost" onclick="window.print()">🖨 Imprimir</button>
            <button class="btn btn-ghost" data-back>← Voltar Simuladores</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bind();
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', e => {
    const k = el.dataset.key, t = el.dataset.type;
    _s[k] = t === 'num' ? (parseFloat(e.target.value) || 0) : e.target.value;
    save();
    clearTimeout(window._repTimer); window._repTimer = setTimeout(render, 250);
  }));
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function inp(label, key, type, suffix) {
  const val = _s[key] ?? '';
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1"><input type="${type === 'text' ? 'text' : 'number'}" class="input" data-key="${key}" data-type="${type}" value="${val}" style="flex:1;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, bg, color) {
  return `<div style="background:${bg};color:${color || '#fff'};padding:14px;border-radius:8px;text-align:center"><div style="font-size:9px;text-transform:uppercase;opacity:.8;font-weight:700">${label}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${value}</div></div>`;
}

function mini(label, value, color) {
  return `<div style="background:var(--bg-3);padding:10px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-weight:800;font-size:14px;color:${color || 'var(--tx)'}">${value}</div></div>`;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
