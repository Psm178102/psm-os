/* PSM-OS v2 — Simulador VPL (Sprint 8.4 · v86.17 layout PROPOSTA PERSONALIZADA)
   O fluxo aparece IGUAL à planilha oficial (faixa amarela, N°/Data, colunas
   ENTRADA/MENSAIS/SEMESTRAIS/ANUAIS/FINANCIAMENTO-CHAVES/TOTAL, linhas verdes,
   chaves em azul, pós-chaves em vermelho, rodapé Total) — e Imprimir/Compartilhar
   abrem a MESMA via em janela limpa (PDF pelo diálogo do navegador). */

const KEY = 'psm_v2_sim_vpl';
let _root = null;
let _s = null;

const DEFAULTS = {
  empreendimento: '', torreUnidade: '', m2: 45, cliente: '',
  dataInicio: new Date().toISOString().slice(0, 10),
  valorTabela: 480000, taxaAA: 6.168, prazoObra: 42,
  pctAto: 5, pctMensal: 14, pctAnual: 6, pctSemestral: 0, pctFinanc: 75,
  numAnuais: 3, numSemestrais: 0, numMensais: 0,   // 0 = até as chaves
  mesesExibidos: 0,                                 // 0 = até as chaves (igual planilha: pode exibir além, zerado em vermelho)
  desconto: 0,
};

export async function pageSimVPL(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function labelMes(i) {
  // linha i (1..N) = i meses depois do início; ATO é a linha 0
  try {
    const [y, m] = String(_s.dataInicio || '').slice(0, 7).split('-').map(Number);
    const d = new Date(y, (m - 1) + i, 1);
    return `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
  } catch { return `mês ${i}`; }
}

function compute() {
  const v = _s;
  const taxaM = Math.pow(1 + v.taxaAA / 100, 1 / 12) - 1;
  const valorFinal = v.valorTabela * (1 - v.desconto / 100);
  const nMensais = (v.numMensais > 0 ? Math.min(v.numMensais, 480) : v.prazoObra);
  const ato = valorFinal * v.pctAto / 100;
  const totalMensal = valorFinal * v.pctMensal / 100;
  const mensal = nMensais > 0 ? totalMensal / nMensais : 0;
  const totalAnual = valorFinal * v.pctAnual / 100;
  const anual = v.numAnuais > 0 ? totalAnual / v.numAnuais : 0;
  const totalSemestral = valorFinal * v.pctSemestral / 100;
  const semestral = v.numSemestrais > 0 ? totalSemestral / v.numSemestrais : 0;
  const financ = valorFinal * v.pctFinanc / 100;
  const pctTotal = v.pctAto + v.pctMensal + v.pctAnual + v.pctSemestral + v.pctFinanc;

  const nLinhas = Math.max(v.prazoObra, v.mesesExibidos > 0 ? Math.min(v.mesesExibidos, 480) : 0);
  const fluxo = [];
  for (let i = 0; i <= nLinhas; i++) {
    const ent = i === 0 ? ato : 0;
    const m = (i > 0 && i <= nMensais) ? mensal : 0;
    const a = (i > 0 && i % 12 === 0 && i / 12 <= v.numAnuais) ? anual : 0;
    const s = (i > 0 && v.numSemestrais > 0 && i % 6 === 0 && i / 6 <= v.numSemestrais) ? semestral : 0;
    const f = (i === v.prazoObra) ? financ : 0;
    const total = ent + m + a + s + f;
    const pv = total / Math.pow(1 + taxaM, i);
    fluxo.push({ mes: i, ent, m, a, s, f, total, pv, chaves: i === v.prazoObra && v.prazoObra > 0 });
  }
  const vpl = fluxo.reduce((sum, x) => sum + x.pv, 0);
  const descVPL = ((1 - vpl / v.valorTabela) * 100).toFixed(2);
  const m2VPL = v.m2 > 0 ? (vpl / v.m2).toFixed(0) : 0;
  const m2Tabela = v.m2 > 0 ? (v.valorTabela / v.m2).toFixed(0) : 0;
  const tot = fluxo.reduce((acc, x) => ({ ent: acc.ent + x.ent, m: acc.m + x.m, s: acc.s + x.s, a: acc.a + x.a, f: acc.f + x.f, total: acc.total + x.total }),
    { ent: 0, m: 0, s: 0, a: 0, f: 0, total: 0 });
  return { taxaM, ato, mensal, anual, semestral, financ, pctTotal, fluxo, tot, vpl, descVPL, m2VPL, m2Tabela, totalMensal, totalAnual, valorFinal, nMensais };
}

/* ═══════════ A TABELA DA PLANILHA (idêntica na tela, na impressão e no share) ═══════════ */
const fmt2 = n => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// célula de dinheiro estilo Excel contábil: "R$" encostado à esquerda, valor à direita
function celR$(v, forca) {
  if (!v && !forca) return '<td class="pp-c pp-money"></td>';
  return `<td class="pp-c pp-money"><span class="pp-rs">R$</span><span>${v ? fmt2(v) : '-'}</span></td>`;
}

function propostaTableHTML(c) {
  const linhas = c.fluxo.map(x => {
    const tipo = x.mes === 0 ? 'ato' : (x.chaves ? 'chaves' : (x.total > 0.005 ? 'verde' : 'verm'));
    return `<tr class="pp-r pp-${tipo}">
      <td class="pp-c pp-n">${x.mes}</td>
      <td class="pp-c pp-data">${x.mes === 0 ? 'ATO' : labelMes(x.mes)}</td>
      ${x.mes === 0 ? celR$(x.ent) : celR$(x.ent)}
      ${x.mes === 0 ? celR$(0, true) : celR$(x.m)}
      ${celR$(x.s)}
      ${celR$(x.a)}
      ${celR$(x.f)}
      <td class="pp-c pp-money pp-tot"><span>${fmt2(x.total)}</span></td>
    </tr>`;
  }).join('');
  return `
  <table class="pp-table">
    <thead>
      <tr>
        <th class="pp-h pp-n" rowspan="2">N°</th>
        <th class="pp-h pp-data" rowspan="2">Data</th>
        <th class="pp-titulo" colspan="6">PROPOSTA PERSONALIZADA</th>
      </tr>
      <tr>
        <th class="pp-h">ENTRADA</th>
        <th class="pp-h">MENSAIS</th>
        <th class="pp-h">SEMESTRAIS</th>
        <th class="pp-h">ANUAIS</th>
        <th class="pp-h">FINANCIAMENTO /<br>CHAVES</th>
        <th class="pp-h">TOTAL</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
    <tfoot>
      <tr class="pp-foot">
        <td class="pp-c" colspan="2"><b>Total</b></td>
        ${celR$(c.tot.ent, true)}${celR$(c.tot.m, true)}${celR$(c.tot.s, true)}${celR$(c.tot.a, true)}${celR$(c.tot.f, true)}
        <td class="pp-c pp-money pp-tot"><span class="pp-rs">R$</span><span>${fmt2(c.tot.total)}</span></td>
      </tr>
    </tfoot>
  </table>`;
}

// CSS fiel à planilha — o MESMO na tela e na via de impressão/compartilhamento
const PP_CSS = `
  .pp-table{border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;width:100%;max-width:980px;background:#fff}
  .pp-table .pp-c,.pp-table .pp-h{border:1px solid #000;padding:2px 6px;height:19px}
  .pp-titulo{background:#ffff00;color:#000;font-weight:800;font-size:21px;border:1.5px solid #000;text-align:center;padding:6px}
  .pp-h{background:#fff;font-weight:700;text-align:center;font-size:11.5px}
  .pp-n{width:44px;text-align:center;font-weight:700}
  .pp-data{width:74px;text-align:center;font-weight:700}
  .pp-money{min-width:108px;text-align:right;white-space:nowrap}
  .pp-money .pp-rs{float:left;padding-right:8px}
  .pp-r td{background:#dde8d0}
  .pp-ato td{background:#fff;font-weight:700}
  .pp-verde .pp-n{background:#d9ead3;color:#38761d}
  .pp-verm .pp-n{background:#f4cccc;color:#cc0000}
  .pp-verm td:not(.pp-n){color:#333}
  .pp-chaves .pp-n{background:#a4c2f4;color:#1c4587}
  .pp-tot{font-weight:700}
  .pp-foot td{background:#c6d5b0;font-weight:800;border:1.5px solid #000}
`;

/* via limpa (janela nova): igual à foto, pronta pra imprimir/salvar PDF/compartilhar */
function abrirVia(autoPrint) {
  const c = compute();
  const cab = [
    _s.empreendimento && `<b>Empreendimento:</b> ${escHtml(_s.empreendimento)}`,
    _s.torreUnidade && `<b>Torre/Unidade:</b> ${escHtml(_s.torreUnidade)}`,
    _s.cliente && `<b>Cliente:</b> ${escHtml(_s.cliente)}`,
    `<b>Valor:</b> R$ ${fmt2(c.valorFinal)}${_s.desconto ? ` (tabela R$ ${fmt2(_s.valorTabela)} − ${_s.desconto}%)` : ''}`,
    `<b>Data:</b> ${new Date().toLocaleDateString('pt-BR')}`,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Proposta ${escHtml(_s.cliente || _s.empreendimento || 'PSM')}</title>
    <style>
      body{margin:18px;background:#fff}
      .pp-cab{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:0 0 8px;max-width:980px}
      .pp-acoes{position:fixed;top:10px;right:10px;display:flex;gap:8px;font-family:Arial}
      .pp-acoes button{padding:8px 14px;border:1px solid #999;border-radius:8px;background:#f5f5f5;font-weight:700;cursor:pointer}
      @media print{.pp-acoes{display:none}body{margin:0}}
      ${PP_CSS}
    </style></head><body>
    <div class="pp-acoes"><button onclick="window.print()">🖨 Imprimir / Salvar PDF</button><button onclick="window.close()">✕ Fechar</button></div>
    <div class="pp-cab">${cab}</div>
    ${propostaTableHTML(c)}
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela — libere pop-ups pra imprimir/compartilhar.'); return; }
  w.document.write(html);
  w.document.close();
  if (autoPrint) setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
}

function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

function render() {
  const c = compute();
  _root.innerHTML = `
    <style>${PP_CSS}</style>
    <div class="card">
      <h2 class="card-title">📐 Simulador VPL · Proposta Personalizada</h2>
      <p class="card-sub">Valor Presente Líquido — o fluxo sai IGUAL à planilha oficial (na tela, na impressão e no compartilhamento)</p>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px;margin-top:12px" id="vpl-grid">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          ${section('Dados do Imóvel', [
            inp('Empreendimento', 'empreendimento', 'text'),
            inp('Torre / Unidade', 'torreUnidade', 'text'),
            inp('M²', 'm2', 'num', 'm²'),
            inp('Cliente', 'cliente', 'text'),
            inp('Início do fluxo (1ª mensal)', 'dataInicio', 'date'),
            inp('Valor de Tabela (R$)', 'valorTabela', 'num'),
            inp('Taxa VPL (% a.a.)', 'taxaAA', 'num', '% a.a.'),
            `<div class="tiny muted">Taxa mensal: ${(c.taxaM * 100).toFixed(4)}% a.m.</div>`,
            inp('Desconto sobre Tabela (%)', 'desconto', 'num', '%'),
          ])}
          ${section('Fluxo de Pagamentos', [
            inp('Ato/Entrada (%)', 'pctAto', 'num', '%'),
            inp('Mensais (%)', 'pctMensal', 'num', '%'),
            inp('Nº de Mensais (0 = até chaves)', 'numMensais', 'num'),
            inp('Prazo Obra / Chaves (meses)', 'prazoObra', 'num'),
            inp('Semestrais (%)', 'pctSemestral', 'num', '%'),
            inp('Nº Semestrais', 'numSemestrais', 'num'),
            inp('Anuais (%)', 'pctAnual', 'num', '%'),
            inp('Nº Anuais', 'numAnuais', 'num'),
            inp('Financiamento/Chaves (%)', 'pctFinanc', 'num', '%'),
            inp('Meses exibidos (0 = até chaves)', 'mesesExibidos', 'num'),
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

          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:14px">
            ${miniKpi('Ato', fmt(c.ato), _s.pctAto + '%')}
            ${miniKpi('Mensais ' + c.nMensais + 'x', fmt(c.mensal), 'por mês')}
            ${miniKpi('Semestrais ' + _s.numSemestrais + 'x', fmt(c.semestral), '')}
            ${miniKpi('Anuais ' + _s.numAnuais + 'x', fmt(c.anual), '')}
            ${miniKpi('Financiamento/Chaves', fmt(c.financ), _s.pctFinanc + '%')}
            ${miniKpi('Total do fluxo', fmt(c.tot.total), '')}
          </div>

          <div class="flex gap-2" style="margin-bottom:10px">
            <button class="btn btn-primary" id="vpl-print">🖨 Imprimir / PDF</button>
            <button class="btn btn-ghost" id="vpl-share">📤 Compartilhar (via limpa)</button>
            <button class="btn btn-ghost" data-back style="margin-left:auto">← Voltar Simuladores</button>
          </div>

          <div style="overflow:auto;max-height:560px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px">
            ${propostaTableHTML(c)}
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
      clearTimeout(window._vplTimer);
      window._vplTimer = setTimeout(render, 250);
    });
  });
  _root.querySelector('#vpl-print')?.addEventListener('click', () => abrirVia(true));
  _root.querySelector('#vpl-share')?.addEventListener('click', () => abrirVia(false));
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
  const inputType = type === 'text' ? 'text' : (type === 'date' ? 'date' : 'number');
  return `
    <div>
      <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label>
      <div class="flex gap-1" style="align-items:center">
        ${(/R\$/.test(label) || suffix === 'R$') ? '<span class="tiny muted" style="font-weight:700">R$</span>' : ''}
        <input type="${inputType}" class="input" data-key="${key}" data-type="${type}" value="${escHtml(val)}" style="flex:1;font-size:12px;padding:6px 8px">
        ${(suffix && suffix !== 'R$') ? `<span class="tiny muted">${suffix}</span>` : ''}
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
