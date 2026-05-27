/* PSM-OS v2 — Simulador VPL (Sprint 8.4) */

const KEY = 'psm_v2_sim_vpl';
let _root = null;
let _s = null;

const DEFAULTS = {
  empreendimento: '', torreUnidade: '', m2: 45, cliente: '',
  dataInicio: new Date().toISOString().slice(0, 10),
  valorTabela: 480000, taxaAA: 6.168, prazoObra: 42,
  pctAto: 5, pctMensal: 14, pctAnual: 6, pctSemestral: 0, pctFinanc: 75,
  numAnuais: 3, numSemestrais: 0, desconto: 0,
};

export async function pageSimVPL(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

function compute() {
  const v = _s;
  const taxaM = Math.pow(1 + v.taxaAA / 100, 1/12) - 1;
  const valorFinal = v.valorTabela * (1 - v.desconto / 100);
  const ato = valorFinal * v.pctAto / 100;
  const totalMensal = valorFinal * v.pctMensal / 100;
  const mensal = v.prazoObra > 0 ? totalMensal / v.prazoObra : 0;
  const totalAnual = valorFinal * v.pctAnual / 100;
  const anual = v.numAnuais > 0 ? totalAnual / v.numAnuais : 0;
  const totalSemestral = valorFinal * v.pctSemestral / 100;
  const semestral = v.numSemestrais > 0 ? totalSemestral / v.numSemestrais : 0;
  const financ = valorFinal * v.pctFinanc / 100;
  const pctTotal = v.pctAto + v.pctMensal + v.pctAnual + v.pctSemestral + v.pctFinanc;

  const fluxo = [];
  for (let i = 0; i <= v.prazoObra; i++) {
    const ent = i === 0 ? ato : 0;
    const m = i > 0 ? mensal : 0;
    const a = (i > 0 && i % 12 === 0 && i / 12 <= v.numAnuais) ? anual : 0;
    const s = (i > 0 && v.numSemestrais > 0 && i % 6 === 0 && i / 6 <= v.numSemestrais) ? semestral : 0;
    const f = (i === v.prazoObra) ? financ : 0;
    const total = ent + m + a + s + f;
    const pv = total / Math.pow(1 + taxaM, i);
    fluxo.push({ mes: i, ent, m, a, s, f, total, pv });
  }
  const vpl = fluxo.reduce((sum, x) => sum + x.pv, 0);
  const descVPL = ((1 - vpl / v.valorTabela) * 100).toFixed(2);
  const m2VPL = v.m2 > 0 ? (vpl / v.m2).toFixed(0) : 0;
  const m2Tabela = v.m2 > 0 ? (v.valorTabela / v.m2).toFixed(0) : 0;
  return { taxaM, ato, mensal, anual, semestral, financ, pctTotal, fluxo, vpl, descVPL, m2VPL, m2Tabela, totalMensal, totalAnual, valorFinal };
}

function render() {
  const c = compute();
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📐 Simulador VPL</h2>
      <p class="card-sub">Valor Presente Líquido — análise de fluxo de pagamentos do imóvel</p>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px;margin-top:12px" id="vpl-grid">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          ${section('Dados do Imóvel', [
            inp('Empreendimento', 'empreendimento', 'text'),
            inp('Torre / Unidade', 'torreUnidade', 'text'),
            inp('M²', 'm2', 'num', 'm²'),
            inp('Cliente', 'cliente', 'text'),
            inp('Valor de Tabela (R$)', 'valorTabela', 'num'),
            inp('Taxa VPL (% a.a.)', 'taxaAA', 'num', '% a.a.'),
            `<div class="tiny muted">Taxa mensal: ${(c.taxaM * 100).toFixed(4)}% a.m.</div>`,
            inp('Desconto sobre Tabela (%)', 'desconto', 'num', '%'),
          ])}
          ${section('Fluxo de Pagamentos', [
            inp('Ato/Entrada (%)', 'pctAto', 'num', '%'),
            inp('Mensais (%)', 'pctMensal', 'num', '%'),
            inp('Prazo Obra (meses)', 'prazoObra', 'num'),
            inp('Anuais (%)', 'pctAnual', 'num', '%'),
            inp('Nº Anuais', 'numAnuais', 'num'),
            inp('Semestrais (%)', 'pctSemestral', 'num', '%'),
            inp('Nº Semestrais', 'numSemestrais', 'num'),
            inp('Financiamento/Chaves (%)', 'pctFinanc', 'num', '%'),
          ])}
          ${Math.abs(c.pctTotal - 100) > 0.1 ? `<div class="alert alert-warn tiny">⚠ Total: ${c.pctTotal.toFixed(1)}% (deve ser 100%)</div>` : ''}
        </div>

        <div>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:14px">
            ${kpi('Valor VPL', fmt(c.vpl), 'var(--psm-navy)', '#fff')}
            ${kpi('Desconto VPL', c.descVPL + '%', '#22c55e')}
            ${kpi('R$/m² VPL', 'R$ ' + Number(c.m2VPL).toLocaleString('pt-BR'), '#3b82f6')}
            ${kpi('R$/m² Tabela', 'R$ ' + Number(c.m2Tabela).toLocaleString('pt-BR'), 'var(--muted)')}
          </div>

          <div class="card" style="padding:14px;margin-bottom:14px">
            <div style="font-weight:800;margin-bottom:10px">Resumo do Fluxo</div>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px">
              ${miniKpi('Ato', fmt(c.ato), _s.pctAto + '%')}
              ${miniKpi('Mensais ' + _s.prazoObra + 'x', fmt(c.mensal), 'por mês')}
              ${miniKpi('Anuais ' + _s.numAnuais + 'x', fmt(c.anual), '')}
              ${miniKpi('Semestrais ' + _s.numSemestrais + 'x', fmt(c.semestral), '')}
              ${miniKpi('Total Prazo Obra', fmt(c.ato + c.totalMensal + c.totalAnual), '')}
              ${miniKpi('Financiamento', fmt(c.financ), _s.pctFinanc + '%')}
            </div>
          </div>

          <div class="card" style="padding:0;overflow:auto;max-height:480px">
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <thead><tr style="background:var(--psm-navy);color:#fff">
                <th style="padding:6px;text-align:center">Mês</th>
                <th style="padding:6px;text-align:right">Entrada</th>
                <th style="padding:6px;text-align:right">Mensal</th>
                <th style="padding:6px;text-align:right">Anual</th>
                <th style="padding:6px;text-align:right">Financ.</th>
                <th style="padding:6px;text-align:right">Total</th>
              </tr></thead>
              <tbody>
                ${c.fluxo.map(x => `
                  <tr style="border-bottom:1px solid var(--bd);${x.a > 0 ? 'background:rgba(139,92,246,.08)' : ''}${x.f > 0 ? 'background:rgba(59,130,246,.15)' : ''}">
                    <td style="padding:4px 6px;text-align:center">${x.mes}</td>
                    <td style="padding:4px 6px;text-align:right">${x.ent > 0 ? fmt(x.ent) : ''}</td>
                    <td style="padding:4px 6px;text-align:right">${x.m > 0 ? fmt(x.m) : ''}</td>
                    <td style="padding:4px 6px;text-align:right;color:#8b5cf6">${x.a > 0 ? fmt(x.a) : ''}</td>
                    <td style="padding:4px 6px;text-align:right;color:#3b82f6">${x.f > 0 ? fmt(x.f) : ''}</td>
                    <td style="padding:4px 6px;text-align:right;font-weight:700">${fmt(x.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
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
  _root.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', e => {
      const k = el.dataset.key;
      const t = el.dataset.type;
      _s[k] = t === 'num' ? (parseFloat(e.target.value) || 0) : e.target.value;
      save();
      // re-render só o resumo, ou recriar toda
      clearTimeout(window._vplTimer);
      window._vplTimer = setTimeout(render, 250);
    });
  });
  const back = _root.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function section(title, items) {
  return `
    <div class="tiny muted" style="text-transform:uppercase;font-weight:800;letter-spacing:1px;margin:10px 0 6px">${title}</div>
    <div style="display:flex;flex-direction:column;gap:6px">${items.join('')}</div>
  `;
}

function inp(label, key, type, suffix) {
  const val = _s[key] ?? '';
  const inputType = type === 'text' ? 'text' : 'number';
  return `
    <div>
      <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label>
      <div class="flex gap-1" style="align-items:center">
        <input type="${inputType}" class="input" data-key="${key}" data-type="${type}" value="${val}" style="flex:1;font-size:12px;padding:6px 8px">
        ${suffix ? `<span class="tiny muted">${suffix}</span>` : ''}
      </div>
    </div>
  `;
}

function kpi(label, value, bg, color) {
  return `
    <div style="background:${bg};color:${color || '#fff'};padding:12px;border-radius:8px;text-align:center">
      <div style="font-size:9px;text-transform:uppercase;opacity:.7;font-weight:700">${label}</div>
      <div style="font-size:16px;font-weight:800;margin-top:4px">${value}</div>
    </div>
  `;
}

function miniKpi(label, value, sub) {
  return `
    <div style="background:var(--bg-3);padding:10px;border-radius:8px">
      <div class="tiny muted">${label}</div>
      <div style="font-weight:800;font-size:14px;color:var(--tx)">${value}</div>
      ${sub ? `<div class="tiny muted">${sub}</div>` : ''}
    </div>
  `;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
