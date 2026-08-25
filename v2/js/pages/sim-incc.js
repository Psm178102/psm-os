/* PSM-OS v2 — Simulador INCC (Sprint 8.4) */
import { renderSemPerderFoco } from '../sim-foco.js';

const KEY = 'psm_v2_sim_incc';
const DEFAULTS = {
  valorTotal: 300900, inccAA: 6, prazoMeses: 42,
  pctEntrada: 5, pctMensais: 14,
  pctSemestrais: 0, numSemestrais: 0,
  pctAnuais: 6, numAnuais: 3,
  pctFinanc: 75,
};
let _root, _s;

export async function pageSimINCC(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

function compute() {
  const v = _s;
  const inccM = Math.pow(1 + v.inccAA / 100, 1/12) - 1;
  const entrada = v.valorTotal * v.pctEntrada / 100;
  const totalMensais = v.valorTotal * v.pctMensais / 100;
  const mensal = v.prazoMeses > 0 ? totalMensais / v.prazoMeses : 0;
  // anuais/semestrais só existem DURANTE a obra (i <= prazoMeses); as que não cabem
  // são aparadas e o valor é redistribuído nas que restam (preserva o total).
  const nAnuaisPedido = Math.max(0, Math.round(v.numAnuais || 0));
  const nAnuais = Math.min(nAnuaisPedido, Math.floor(v.prazoMeses / 12));
  const anual = nAnuais > 0 ? (v.valorTotal * v.pctAnuais / 100) / nAnuais : 0;
  const nSemestraisPedido = Math.max(0, Math.round(v.numSemestrais || 0));
  const nSemestrais = Math.min(nSemestraisPedido, Math.floor(v.prazoMeses / 6));
  const semestral = nSemestrais > 0 ? (v.valorTotal * v.pctSemestrais / 100) / nSemestrais : 0;
  const parcelasAparadas = (nAnuaisPedido - nAnuais) + (nSemestraisPedido - nSemestrais);
  const financ = v.valorTotal * v.pctFinanc / 100;

  // Aplica INCC mensal cumulativo nos pagamentos durante a obra
  let totalCorrigido = entrada;
  for (let i = 1; i <= v.prazoMeses; i++) {
    const fator = Math.pow(1 + inccM, i);
    totalCorrigido += mensal * fator;
    if (i % 12 === 0 && i / 12 <= nAnuais) totalCorrigido += anual * fator;
    if (nSemestrais > 0 && i % 6 === 0 && i / 6 <= nSemestrais) totalCorrigido += semestral * fator;
  }
  totalCorrigido += financ * Math.pow(1 + inccM, v.prazoMeses);
  const correcaoTotal = totalCorrigido - v.valorTotal;
  const pctCorrecao = v.valorTotal > 0 ? ((correcaoTotal / v.valorTotal) * 100).toFixed(2) : '0.00';

  return { inccM, entrada, mensal, anual, semestral, financ, totalCorrigido, correcaoTotal, pctCorrecao, parcelasAparadas, nAnuais, nSemestrais };
}

function render() {
  const c = compute();
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📊 Simulador INCC</h2>
      <p class="card-sub">Correção pela inflação INCC durante o prazo de obra</p>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px;margin-top:12px">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          ${inp('Valor Total do Imóvel (R$)', 'valorTotal', 'num')}
          ${inp('INCC (% a.a.)', 'inccAA', 'num', '% a.a.')}
          <div class="tiny muted">INCC mensal: ${(c.inccM * 100).toFixed(4)}%</div>
          ${inp('Prazo Obra (meses)', 'prazoMeses', 'num')}
          ${inp('% Entrada', 'pctEntrada', 'num', '%')}
          ${inp('% Mensais', 'pctMensais', 'num', '%')}
          ${inp('% Anuais', 'pctAnuais', 'num', '%')}
          ${inp('Nº Anuais', 'numAnuais', 'num')}
          ${inp('% Semestrais', 'pctSemestrais', 'num', '%')}
          ${inp('Nº Semestrais', 'numSemestrais', 'num')}
          ${inp('% Financ./Chaves', 'pctFinanc', 'num', '%')}
        </div>

        <div>
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:14px">
            ${kpi('Total Corrigido', fmt(c.totalCorrigido), 'var(--psm-navy)', '#fff')}
            ${kpi('Correção Total', fmt(c.correcaoTotal), '#f59e0b')}
            ${kpi('% Correção', c.pctCorrecao + '%', '#ef4444')}
          </div>
          <div class="card" style="padding:14px">
            <div style="font-weight:800;margin-bottom:10px">Resumo do Fluxo (sem correção)</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
              ${mini('Entrada', fmt(c.entrada), _s.pctEntrada + '%')}
              ${mini('Mensal × ' + _s.prazoMeses, fmt(c.mensal), 'por mês')}
              ${mini('Anual × ' + _s.numAnuais, fmt(c.anual), '')}
              ${mini('Semestral × ' + _s.numSemestrais, fmt(c.semestral), '')}
              ${mini('Financ./Chaves', fmt(c.financ), _s.pctFinanc + '%')}
              ${mini('Valor sem correção', fmt(_s.valorTotal), 'tabela')}
            </div>
            ${c.parcelasAparadas > 0 ? `<div class="tiny" style="color:var(--warn);margin-top:8px">⚠️ ${c.parcelasAparadas} parcela(s) anual/semestral aparada(s) — não cabem no prazo de obra (${_s.prazoMeses} meses).</div>` : ''}
          </div>

          <div class="alert" style="background:rgba(239,68,68,.1);color:var(--err-suave);border:1px solid rgba(239,68,68,.3);margin-top:14px;padding:12px;border-radius:8px">
            <b>💡 Importante:</b> O INCC é aplicado mensalmente sobre o saldo devedor durante o prazo de obra. Após a entrega das chaves, o saldo passa a ser corrigido pelo IPCA + juros do financiamento bancário.
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
    clearTimeout(window._inccTimer); window._inccTimer = setTimeout(() => renderSemPerderFoco(_root, render), 250);
  }));
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function inp(label, key, type, suffix) {
  const val = _s[key] ?? '';
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1">${(/R\$/.test(label) || suffix === 'R$') ? '<span class="tiny muted" style="align-self:center;font-weight:700">R$</span>' : ''}<input type="${type === 'text' ? 'text' : 'number'}" class="input" data-key="${key}" data-type="${type}" value="${val}" style="flex:1;font-size:12px;padding:6px 8px">${(suffix && suffix !== 'R$') ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, bg, color) {
  return `<div style="background:${bg};color:${color || '#fff'};padding:14px;border-radius:8px;text-align:center"><div style="font-size:9px;text-transform:uppercase;opacity:.8;font-weight:700">${label}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${value}</div></div>`;
}

function mini(label, value, sub) {
  return `<div style="background:var(--bg-3);padding:10px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-weight:800;font-size:14px">${value}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
