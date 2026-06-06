/* PSM-OS v2 — Métricas de Viabilidade por LINHA DE NEGÓCIO (Sprint 9.28)
   3 linhas: PSM M.A.P · PSM Conquista · PSM Locações + Consolidado (soma).
   Cada linha tem parâmetros próprios (persistidos) e break-even/margem próprios.
   VGV realizado puxa do dado REAL por equipe (atingimento), com override manual. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;
let _active = 'map';

const KEY = 'psm_v2_metricas_viab_lines';

// Ordem e identidade das linhas
const LINES = [
  { id: 'map',       nome: 'PSM M.A.P',     icon: '🏢', cor: '#7c3aed' },
  { id: 'conquista', nome: 'PSM Conquista', icon: '🏠', cor: '#2563eb' },
  { id: 'locacoes',  nome: 'PSM Locações',  icon: '🔑', cor: '#d97706' },
];

// Defaults (premissas iniciais editáveis) por linha
const DEFAULTS = {
  map:       { custoFixoMes: 15000, proLabore: 12000, ads: 9000, comissaoBrutaPct: 4,  comCorretorPct: 1.4, comSeniorPct: 1.6, aliquotaPct: 8, ticketMedio: 350000, metaMes: 2500000, vgvManual: '' },
  conquista: { custoFixoMes: 9000,  proLabore: 8000,  ads: 5000, comissaoBrutaPct: 5,  comCorretorPct: 2.0, comSeniorPct: 1.0, aliquotaPct: 8, ticketMedio: 200000, metaMes: 1500000, vgvManual: '' },
  locacoes:  { custoFixoMes: 3000,  proLabore: 4000,  ads: 1000, comissaoBrutaPct: 10, comCorretorPct: 4.0, comSeniorPct: 2.0, aliquotaPct: 8, ticketMedio: 2500,   metaMes: 60000,   vgvManual: '' },
};

let _lines = null;

export async function pageMetricasViab(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>';
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    _lines = {};
    for (const l of LINES) _lines[l.id] = Object.assign({}, DEFAULTS[l.id], saved[l.id] || {});
  } catch { _lines = JSON.parse(JSON.stringify(DEFAULTS)); }
  render();
  await load();
}

async function load() {
  try {
    _data = await api.request('/api/v3/metas/atingimento').catch(() => ({}));
  } catch { _data = {}; }
  renderBanner();
  renderTable();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_lines)); } catch {} }

/* ── VGV realizado por linha (dado real por equipe) ── */
function autoVGV() {
  const pc = _data?.por_corretor || [];
  const team = c => (c.team || '').toLowerCase();
  const sum = (pred, field) => pc.filter(pred).reduce((s, c) => s + (+c[field] || 0), 0);
  const isLoc = c => team(c).includes('loca');
  const isConq = c => team(c) === 'conquista';
  const isMap = c => !isLoc(c) && !isConq(c); // M.A.P = tudo que não é Conquista nem Locação
  return {
    map:       { vgv: sum(isMap, 'vgv_atingido'),  vendas: sum(isMap, 'vendas') },
    conquista: { vgv: sum(isConq, 'vgv_atingido'), vendas: sum(isConq, 'vendas') },
    locacoes:  { vgv: sum(isLoc, 'vgv_atingido'),  vendas: sum(isLoc, 'vendas') },
  };
}

function lineVGV(id) {
  const p = _lines[id];
  const auto = autoVGV()[id] || { vgv: 0, vendas: 0 };
  const manual = (p.vgvManual !== '' && p.vgvManual != null) ? +p.vgvManual : null;
  return { vgvReal: manual != null ? manual : auto.vgv, vendasReal: auto.vendas, auto: auto.vgv, isManual: manual != null };
}

/* ── Cálculo de viabilidade de uma linha ── */
function computeLine(id) {
  const p = _lines[id];
  const { vgvReal, vendasReal } = lineVGV(id);
  const despFixa = (+p.custoFixoMes || 0) + (+p.proLabore || 0) + (+p.ads || 0);
  const margemLiquidaPct = (p.comissaoBrutaPct - p.aliquotaPct * p.comissaoBrutaPct / 100) / 100;
  const vgvBreakEven = margemLiquidaPct > 0 ? despFixa / margemLiquidaPct : 0;
  const comissaoBrutaMedia = p.ticketMedio * p.comissaoBrutaPct / 100;
  const impostoMedio = comissaoBrutaMedia * p.aliquotaPct / 100;
  const comissaoCorretor = p.ticketMedio * p.comCorretorPct / 100;
  const comissaoSenior = p.ticketMedio * p.comSeniorPct / 100;
  const margemPSM = comissaoBrutaMedia - impostoMedio - comissaoCorretor - comissaoSenior;
  const vendasBreakEven = margemPSM > 0 ? Math.ceil(despFixa / margemPSM) : 0;
  const lucroLiquido = vgvReal * margemLiquidaPct - despFixa;
  const margemLiquidaReal = vgvReal > 0 ? (lucroLiquido / vgvReal * 100) : 0;
  return {
    despFixa, margemLiquidaPct, vgvBreakEven, vendasBreakEven,
    comissaoBrutaMedia, impostoMedio, comissaoCorretor, comissaoSenior, margemPSM,
    vgvReal, vendasReal, lucroLiquido, margemLiquidaReal,
  };
}

function computeTotal(perLine) {
  const t = { despFixa: 0, vgvBreakEven: 0, vendasBreakEven: 0, vgvReal: 0, vendasReal: 0, lucroLiquido: 0 };
  for (const id of Object.keys(perLine)) {
    const c = perLine[id];
    t.despFixa += c.despFixa; t.vgvBreakEven += c.vgvBreakEven; t.vendasBreakEven += c.vendasBreakEven;
    t.vgvReal += c.vgvReal; t.vendasReal += c.vendasReal; t.lucroLiquido += c.lucroLiquido;
  }
  t.margemLiquidaReal = t.vgvReal > 0 ? (t.lucroLiquido / t.vgvReal * 100) : 0;
  return t;
}

/* ── Render shell ── */
function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🧪 Métricas de Viabilidade por Linha</h2>
      <p class="card-sub">Break-even, margens e lucro por unidade de negócio (PSM M.A.P · Conquista · Locações) + consolidado · Sócio only</p>
      <div id="viab-banner"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Parâmetros da linha</div>
      <div class="flex gap-2" style="flex-wrap:wrap" id="viab-tabs">
        ${LINES.map(l => `<button class="btn ${l.id === _active ? 'btn-primary' : 'btn-ghost'} btn-sm" data-line="${l.id}">${l.icon} ${l.nome}</button>`).join('')}
      </div>
      <div id="viab-params" style="background:var(--bg-3);border-radius:10px;padding:14px;margin-top:8px"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:18px 0 6px">📊 Quadro comparativo de viabilidade</div>
      <div id="viab-table"><div class="muted tiny"><span class="spinner"></span> Carregando dados reais…</div></div>
    </div>
  `;
  _root.querySelectorAll('#viab-tabs [data-line]').forEach(b => b.addEventListener('click', () => {
    _active = b.dataset.line;
    _root.querySelectorAll('#viab-tabs [data-line]').forEach(x => x.className = `btn ${x.dataset.line === _active ? 'btn-primary' : 'btn-ghost'} btn-sm`);
    renderParams();
  }));
  renderParams();
}

function renderBanner() {
  const el = document.getElementById('viab-banner'); if (!el) return;
  const real = +(_data?.total_vgv || 0);
  const vendas = +(_data?.total_vendas || 0);
  const a = autoVGV();
  el.innerHTML = `
    <div class="alert" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);padding:10px 12px;border-radius:8px;margin-top:8px;font-size:12.5px">
      📡 <b>VGV real do sistema (ano):</b> ${fmt(real)} · ${vendas} venda(s). Distribuição automática por equipe →
      🏢 M.A.P ${fmt(a.map.vgv)} · 🏠 Conquista ${fmt(a.conquista.vgv)} · 🔑 Locações ${fmt(a.locacoes.vgv)}.
      <span class="muted">Você pode sobrescrever o VGV de cada linha no campo "VGV realizado".</span>
    </div>`;
}

function renderParams() {
  const el = document.getElementById('viab-params'); if (!el) return;
  const l = LINES.find(x => x.id === _active);
  const vinfo = lineVGV(_active);
  el.innerHTML = `
    <div style="font-weight:800;color:${l.cor};margin-bottom:8px">${l.icon} ${l.nome}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${inp('Custo Fixo Mensal (R$)', 'custoFixoMes')}
      ${inp('Pró-Labore (R$)', 'proLabore')}
      ${inp('Investimento Ads (R$)', 'ads')}
      ${inp('Comissão Bruta (%)', 'comissaoBrutaPct', '%')}
      ${inp('% Corretor', 'comCorretorPct', '%')}
      ${inp('% Sênior', 'comSeniorPct', '%')}
      ${inp('Alíquota Imposto (%)', 'aliquotaPct', '%')}
      ${inp('Ticket Médio (R$)', 'ticketMedio')}
      ${inp('Meta Mês (R$)', 'metaMes')}
    </div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
      ${inp('VGV Realizado (R$) — vazio = usar dado real por equipe', 'vgvManual', '', `auto: ${fmt(vinfo.auto)}`)}
      <div id="viab-vgv-hint" class="tiny muted" style="margin-top:2px">${vinfo.isManual ? '✏️ usando valor manual' : '📡 usando dado real da(s) equipe(s) desta linha'}</div>
    </div>
  `;
  el.querySelectorAll('[data-key]').forEach(input => input.addEventListener('input', e => {
    const k = input.dataset.key;
    _lines[_active][k] = (k === 'vgvManual') ? e.target.value.trim() : (parseFloat(e.target.value) || 0);
    save();
    clearTimeout(window._vtm); window._vtm = setTimeout(() => { renderTable(); renderBanner(); if (k === 'vgvManual') renderParamsHint(); }, 250);
  }));
}

function renderParamsHint() {
  // atualiza só a linha de status do override sem perder foco do input
  const vinfo = lineVGV(_active);
  const hint = document.getElementById('viab-vgv-hint');
  if (hint) hint.textContent = vinfo.isManual ? '✏️ usando valor manual' : '📡 usando dado real da(s) equipe(s) desta linha';
}

function renderTable() {
  const body = document.getElementById('viab-table'); if (!body) return;
  const per = {}; for (const l of LINES) per[l.id] = computeLine(l.id);
  const tot = computeTotal(per);

  const statusCell = (vgvReal, be) => {
    const ok = vgvReal >= be && be > 0;
    const cor = ok ? '#16a34a' : '#dc2626';
    return `<span style="color:${cor};font-weight:800">${ok ? '✅ viável' : '⚠️ abaixo BE'}</span>`;
  };
  const colHead = LINES.map(l => `<th style="text-align:right;padding:8px 10px;color:${l.cor}">${l.icon} ${l.nome.replace('PSM ', '')}</th>`).join('');
  const cell = v => `<td style="text-align:right;padding:7px 10px">${v}</td>`;
  const rowsDef = [
    ['VGV Realizado', id => fmt(per[id].vgvReal), fmt(tot.vgvReal), true],
    ['VGV Break-Even', id => fmt(per[id].vgvBreakEven), fmt(tot.vgvBreakEven)],
    ['Gap (real − BE)', id => colorNum(per[id].vgvReal - per[id].vgvBreakEven), colorNum(tot.vgvReal - tot.vgvBreakEven)],
    ['Despesa Fixa/mês', id => fmt(per[id].despFixa), fmt(tot.despFixa)],
    ['Vendas Break-Even', id => per[id].vendasBreakEven, tot.vendasBreakEven],
    ['Margem PSM / venda', id => fmt(per[id].margemPSM), '—'],
    ['Lucro Líquido/mês', id => colorNum(per[id].lucroLiquido), colorNum(tot.lucroLiquido)],
    ['Margem Líquida %', id => per[id].margemLiquidaReal.toFixed(1) + '%', tot.margemLiquidaReal.toFixed(1) + '%'],
    ['Status', id => statusCell(per[id].vgvReal, per[id].vgvBreakEven), statusCell(tot.vgvReal, tot.vgvBreakEven)],
  ];

  body.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:680px">
        <thead>
          <tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:8px 10px">Métrica</th>
            ${colHead}
            <th style="text-align:right;padding:8px 10px;color:#0f766e;background:rgba(13,148,136,.08)">📊 CONSOLIDADO</th>
          </tr>
        </thead>
        <tbody>
          ${rowsDef.map(([label, fn, total, strong]) => `
            <tr style="border-bottom:1px solid var(--border)${strong ? ';font-weight:700' : ''}">
              <td style="text-align:left;padding:7px 10px;font-weight:600">${label}</td>
              ${LINES.map(l => cell(fn(l.id))).join('')}
              <td style="text-align:right;padding:7px 10px;font-weight:800;background:rgba(13,148,136,.06)">${total}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="alert" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);padding:12px;border-radius:8px;margin-top:14px;font-size:12.5px">
      <b>💡 Leitura consolidada:</b><br>
      • Break-even total da operação: <b>${fmt(tot.vgvBreakEven)}</b>/mês · <b>${tot.vgvReal >= tot.vgvBreakEven ? 'já cobre' : 'falta ' + fmt(tot.vgvBreakEven - tot.vgvReal)}</b> a despesa fixa<br>
      • Lucro líquido consolidado: <b style="color:${tot.lucroLiquido >= 0 ? '#16a34a' : '#dc2626'}">${fmt(tot.lucroLiquido)}/mês</b> (margem ${tot.margemLiquidaReal.toFixed(1)}%)<br>
      • Margem saudável no setor: 25–35%. Edite os parâmetros de cada linha acima pra simular cenários.
    </div>
  `;
}

/* ── helpers ── */
function inp(label, key, suffix, placeholder) {
  const val = _lines[_active][key];
  return `<div><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1"><input type="number" class="input" data-key="${key}" value="${val ?? ''}" ${placeholder ? `placeholder="${placeholder}"` : ''} style="flex:1;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}
function colorNum(n) {
  const cor = n >= 0 ? '#16a34a' : '#dc2626';
  return `<span style="color:${cor}">${fmt(n)}</span>`;
}
function fmt(n) { return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR'); }
