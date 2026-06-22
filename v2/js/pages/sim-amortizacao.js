/* ============================================================================
   PSM-OS v2 — 🏦 Simulador de Amortização (SAC + PRICE + amortização extra)
   Lógica fiel à planilha "PlanilhadeAmortizacao" (abas SAC e PRICE):
     • taxa mensal = (1 + juros_efetivos_aa)^(1/12) − 1
     • SAC:   amortização constante = VF/prazo · parcela = juros + amortização
     • PRICE: parcela = PMT(i, prazo_restante, saldo) · amortização = parcela − juros
     • Amortização adicional: mantém a parcela do contrato + extra, sobre o saldo
       corrigido (paga mais rápido). Compara Contrato × Com amortização: economia
       de juros e redução de prazo. Valores exatos pt-BR (sem arredondar).
============================================================================ */
const KEY = 'psm_v2_sim_amort';
const DEFAULTS = { sistema: 'SAC', valorFinanciado: 180000, prazo: 420, jurosAA: 8, extraMensal: 0, aportes: [] };
let _root, _s, _view = 'sim';

export async function pageSimAmortizacao(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  if (!Array.isArray(_s.aportes)) _s.aportes = [];
  render();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

/* ───────── núcleo de cálculo ───────── */
function taxaMensal(aa) { return Math.pow(1 + (+aa || 0) / 100, 1 / 12) - 1; }
function pmt(i, n, pv) { return (i === 0) ? pv / n : pv * i / (1 - Math.pow(1 + i, -n)); }

function simular() {
  const VF = +_s.valorFinanciado || 0;
  const n = Math.max(1, Math.round(+_s.prazo || 0));
  const i = taxaMensal(_s.jurosAA);
  const sac = _s.sistema === 'SAC';
  const amortSAC = VF / n;
  const extraMensal = +_s.extraMensal || 0;
  const extraMap = {};
  (_s.aportes || []).forEach(a => { const m = Math.round(+a.mes || 0); if (m >= 1) extraMap[m] = (extraMap[m] || 0) + (+a.valor || 0); });

  // 1) Contrato (sem amortização extra)
  const contrato = []; let saldo = VF;
  for (let m = 1; m <= n && saldo > 1e-6; m++) {
    const juros = saldo * i;
    let amort, parcela;
    if (sac) { amort = Math.min(amortSAC, saldo); parcela = juros + amort; }
    else { parcela = pmt(i, n - (m - 1), saldo); if (parcela > saldo + juros) parcela = saldo + juros; amort = parcela - juros; }
    const saldoFim = Math.max(0, saldo - amort);
    contrato.push({ m, saldoIni: saldo, juros, amort, parcela, saldoFim });
    saldo = saldoFim;
  }

  // 2) Simulação (parcela do contrato + extra, sobre o saldo corrigido)
  const sim = []; let s = VF;
  for (let m = 1; m <= n && s > 1e-6; m++) {
    const juros = s * i;
    const base = contrato[m - 1] ? contrato[m - 1].parcela : (sac ? (juros + amortSAC) : pmt(i, n - (m - 1), s));
    const extra = extraMensal + (extraMap[m] || 0);
    let parcela = base + extra;
    const teto = s + juros;
    if (parcela > teto) parcela = teto;            // último mês: quita o que falta
    const amort = parcela - juros;
    const saldoFim = Math.max(0, s - amort);
    sim.push({ m, saldoIni: s, juros, amort, parcela, extra, saldoFim });
    s = saldoFim;
  }

  const sum = (arr, k) => arr.reduce((a, b) => a + (b[k] || 0), 0);
  const cJuros = sum(contrato, 'juros'), cPago = sum(contrato, 'parcela');
  const sJuros = sum(sim, 'juros'), sPago = sum(sim, 'parcela');
  return {
    VF, n, i, sac, contrato, sim,
    parcelaInicial: contrato[0]?.parcela || 0,
    parcelaFinal: contrato[contrato.length - 1]?.parcela || 0,
    cJuros, cPago, cPrazo: contrato.length,
    sJuros, sPago, sPrazo: sim.length,
    economiaJuros: cJuros - sJuros,
    economiaTotal: cPago - sPago,
    reducaoMeses: contrato.length - sim.length,
    temExtra: (extraMensal > 0 || Object.keys(extraMap).length > 0),
  };
}

/* ───────── render ───────── */
function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🏦 Simulador de Amortização</h2>
      <p class="card-sub">Financiamento <b>SAC</b> ou <b>PRICE</b> + simulação de <b>amortização extra</b> — veja a economia de juros e a redução de prazo. Lógica da planilha PSM.</p>
      <div style="display:grid;grid-template-columns:340px 1fr;gap:16px;margin-top:12px;align-items:start" class="amort-grid">
        <div style="background:var(--bg-3);border-radius:12px;padding:16px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:8px">Sistema de amortização</div>
          <div class="flex gap-2" style="margin-bottom:12px">
            ${sisBtn('SAC', 'SAC — parcela decrescente')}
            ${sisBtn('PRICE', 'PRICE — parcela fixa')}
          </div>
          ${inp('Valor financiado', 'valorFinanciado', 'R$')}
          ${inp('Prazo', 'prazo', 'meses')}
          ${inp('Juros efetivos', 'jurosAA', '% ao ano')}
          <div class="tiny muted" style="margin:2px 0 8px">Taxa mensal equivalente: <b>${pct4(taxaMensal(_s.jurosAA))}</b></div>

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:12px 0 6px">💰 Amortização extra</div>
          ${inp('Extra todo mês', 'extraMensal', 'R$')}
          <div class="tiny muted" style="font-weight:700;margin:8px 0 4px">Aportes pontuais (mês específico)</div>
          <div id="amort-aportes">${aportesHTML()}</div>
          <button class="btn btn-ghost btn-sm btn-block mt-1" id="amort-addap">➕ adicionar aporte</button>

          <button class="btn btn-primary btn-block mt-3" id="amort-calc">🔄 Calcular</button>
        </div>
        <div id="amort-out"></div>
      </div>
    </div>
    <style>@media(max-width:760px){.amort-grid{grid-template-columns:1fr !important}}</style>`;
  wireInputs();
  renderOut();
}

function sisBtn(id, label) {
  const on = _s.sistema === id;
  return `<button class="btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}" data-sis="${id}" style="flex:1" title="${label}">${id}</button>`;
}
function inp(label, key, suffix) {
  const isMoney = suffix === 'R$';
  return `<div style="margin-bottom:8px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label>
    <div class="flex gap-1">${isMoney ? '<span class="tiny muted" style="align-self:center;font-weight:700">R$</span>' : ''}
      <input type="number" step="any" class="input" data-key="${key}" value="${_s[key] ?? ''}" style="flex:1;font-size:13px;padding:7px 9px">
      ${!isMoney && suffix ? `<span class="tiny muted" style="align-self:center;white-space:nowrap">${suffix}</span>` : ''}</div></div>`;
}
function aportesHTML() {
  if (!_s.aportes.length) return '<div class="tiny muted" style="padding:2px 0">Nenhum aporte pontual.</div>';
  return _s.aportes.map((a, idx) => `<div class="flex gap-1" style="margin-bottom:5px;align-items:center">
    <span class="tiny muted">mês</span>
    <input type="number" class="input" data-ap="${idx}" data-apk="mes" value="${a.mes ?? ''}" style="width:64px;font-size:12px;padding:5px 6px">
    <span class="tiny muted">R$</span>
    <input type="number" class="input" data-ap="${idx}" data-apk="valor" value="${a.valor ?? ''}" style="flex:1;font-size:12px;padding:5px 6px">
    <button class="btn btn-ghost btn-sm" data-apdel="${idx}" style="color:#dc2626;padding:3px 7px">✕</button></div>`).join('');
}

function wireInputs() {
  _root.querySelectorAll('[data-sis]').forEach(b => b.onclick = () => { _s.sistema = b.dataset.sis; save(); render(); });
  _root.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', () => { _s[el.dataset.key] = el.value === '' ? '' : +el.value; save(); }));
  _root.querySelectorAll('[data-ap]').forEach(el => el.addEventListener('input', () => { const i = +el.dataset.ap; _s.aportes[i][el.dataset.apk] = el.value === '' ? '' : +el.value; save(); }));
  _root.querySelectorAll('[data-apdel]').forEach(b => b.onclick = () => { _s.aportes.splice(+b.dataset.apdel, 1); save(); render(); });
  const add = _root.querySelector('#amort-addap'); if (add) add.onclick = () => { _s.aportes.push({ mes: '', valor: '' }); save(); render(); };
  const calc = _root.querySelector('#amort-calc'); if (calc) calc.onclick = () => render();
}

function renderOut() {
  const out = _root.querySelector('#amort-out'); if (!out) return;
  const r = simular();
  const dados = (_view === 'contrato' || !r.temExtra) ? r.contrato : r.sim;
  const showExtra = (_view !== 'contrato') && r.temExtra;
  out.innerHTML = `
    <!-- resumo -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      ${kpi('Parcela inicial', fmt(r.parcelaInicial), r.sac ? 'decresce a cada mês' : 'fixa (PRICE)', '#2563eb')}
      ${kpi('Total do contrato', fmt(r.cPago), `${r.cPrazo} meses · ${fmt(r.cJuros)} de juros`, '#64748b')}
      ${r.temExtra ? kpi('Com amortização', fmt(r.sPago), `${r.sPrazo} meses · ${fmt(r.sJuros)} de juros`, '#16a34a') : ''}
      ${r.temExtra ? kpi('💚 Economia de juros', fmt(r.economiaJuros), pctEco(r) + ' menos juros', '#16a34a') : ''}
      ${r.temExtra ? kpi('⏱ Reduz o prazo', mesesLabel(r.reducaoMeses), `quita em ${r.sPrazo} de ${r.cPrazo} meses`, '#d4a843') : ''}
    </div>
    ${r.temExtra ? '' : '<div class="tiny muted" style="margin-top:8px">💡 Preencha “Extra todo mês” ou um aporte pontual pra ver a economia e a redução de prazo.</div>'}

    <!-- gráfico saldo devedor -->
    <div class="card mt-3" style="background:var(--bg-3)">
      <div class="tiny muted" style="font-weight:800;text-transform:uppercase;margin-bottom:6px">📉 Saldo devedor ao longo do tempo</div>
      ${chart(r)}
    </div>

    <!-- tabela -->
    <div class="card mt-3" style="padding:10px">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <b style="font-size:13px">📋 Tabela de amortização <span class="tiny muted">· ${dados.length} parcela(s)</span></b>
        ${r.temExtra ? `<div class="flex gap-1">
          <button class="btn btn-sm ${_view !== 'contrato' ? 'btn-primary' : 'btn-ghost'}" data-view="sim">Com amortização</button>
          <button class="btn btn-sm ${_view === 'contrato' ? 'btn-primary' : 'btn-ghost'}" data-view="contrato">Contrato</button>
        </div>` : ''}
      </div>
      <div style="max-height:56vh;overflow:auto;border:1px solid var(--border);border-radius:8px">
        <table style="border-collapse:collapse;width:100%;min-width:max-content;font-size:12px">
          <thead><tr>${['Mês', 'Saldo inicial', 'Juros', 'Amortização', showExtra ? 'Extra' : null, 'Parcela', 'Saldo final'].filter(Boolean)
            .map(h => `<th style="position:sticky;top:0;background:var(--psm-gold,#d4a843);color:#000;padding:6px 9px;text-align:right;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
          <tbody>${dados.map(p => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:5px 9px;text-align:right;font-weight:700">${p.m}</td>
            <td style="padding:5px 9px;text-align:right">${fmt(p.saldoIni)}</td>
            <td style="padding:5px 9px;text-align:right;color:#dc2626">${fmt(p.juros)}</td>
            <td style="padding:5px 9px;text-align:right;color:#16a34a">${fmt(p.amort)}</td>
            ${showExtra ? `<td style="padding:5px 9px;text-align:right;color:#7c3aed">${p.extra ? fmt(p.extra) : '—'}</td>` : ''}
            <td style="padding:5px 9px;text-align:right;font-weight:700">${fmt(p.parcela)}</td>
            <td style="padding:5px 9px;text-align:right">${fmt(p.saldoFim)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  out.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { _view = b.dataset.view; renderOut(); });
}

/* ───────── gráfico SVG (saldo devedor: contrato × com amortização) ───────── */
function chart(r) {
  const W = 720, H = 220, pad = 44;
  const maxM = r.cPrazo, maxV = r.VF;
  if (maxM < 2) return '<div class="tiny muted">—</div>';
  const x = m => pad + (m / maxM) * (W - pad - 10);
  const y = v => H - 24 - (v / maxV) * (H - 24 - 10);
  const line = (arr, cor) => {
    const pts = [{ m: 0, saldoFim: r.VF }, ...arr.map(p => ({ m: p.m, saldoFim: p.saldoFim }))];
    return `<polyline fill="none" stroke="${cor}" stroke-width="2.5" points="${pts.map(p => `${x(p.m).toFixed(1)},${y(p.saldoFim).toFixed(1)}`).join(' ')}"/>`;
  };
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => { const v = maxV * f; return `<line x1="${pad}" y1="${y(v)}" x2="${W - 10}" y2="${y(v)}" stroke="var(--border,#e5e7eb)" stroke-width="1"/><text x="${pad - 5}" y="${y(v) + 3}" font-size="9" fill="var(--ink-muted,#94a3b8)" text-anchor="end">${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${yTicks}
    ${line(r.contrato, '#94a3b8')}
    ${r.temExtra ? line(r.sim, '#16a34a') : ''}
    <text x="${W - 12}" y="14" font-size="10" fill="#94a3b8" text-anchor="end">— Contrato</text>
    ${r.temExtra ? `<text x="${W - 12}" y="28" font-size="10" fill="#16a34a" text-anchor="end" font-weight="700">— Com amortização</text>` : ''}
  </svg>`;
}

/* ───────── helpers ───────── */
function kpi(lbl, val, sub, cor) {
  return `<div style="background:var(--bg-1,#fff);border:1px solid var(--border);border-left:4px solid ${cor};border-radius:10px;padding:11px 13px">
    <div class="tiny muted" style="text-transform:uppercase;font-weight:700">${lbl}</div>
    <div style="font-size:19px;font-weight:900;color:${cor};margin-top:2px;line-height:1.1">${val}</div>
    <div class="tiny muted" style="margin-top:2px">${sub}</div></div>`;
}
function mesesLabel(m) { if (m <= 0) return '—'; const a = Math.floor(m / 12), me = m % 12; return (a ? a + 'a ' : '') + (me ? me + 'm' : (a ? '' : '0m')) || m + 'm'; }
function pctEco(r) { return r.cJuros > 0 ? (r.economiaJuros / r.cJuros * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—'; }
function fmt(n) { return 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct4(i) { return (Number(i) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + '% a.m.'; }
