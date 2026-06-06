/* PSM-OS v2 — Métricas de Viabilidade por LINHA DE NEGÓCIO (Sprint 9.29)
   4 linhas: PSM M.A.P · PSM Conquista · PSM Terceiros · PSM Locações + Consolidado.
   Tudo editável. Calcula break-even por linha E VGV mínimo POR CORRETOR
   (conforme nº de corretores + ticket médio específico de cada linha).
   VGV realizado e nº de corretores puxam do dado REAL por equipe, com override. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;
let _active = 'map';

const KEY = 'psm_v2_metricas_viab_lines';

const LINES = [
  { id: 'map',       nome: 'PSM M.A.P',     icon: '🏢', cor: '#7c3aed' },
  { id: 'conquista', nome: 'PSM Conquista', icon: '🏠', cor: '#2563eb' },
  { id: 'terceiros', nome: 'PSM Terceiros', icon: '🤝', cor: '#0891b2' },
  { id: 'locacoes',  nome: 'PSM Locações',  icon: '🔑', cor: '#d97706' },
];

// Premissas iniciais editáveis por linha. corretoresManual/vgvManual vazios = usa dado real.
const DEFAULTS = {
  map:       { custoFixoMes: 14000, proLabore: 8000, ads: 9000, comissaoBrutaPct: 4,  comCorretorPct: 1.4, comSeniorPct: 1.6, aliquotaPct: 8, ticketMedio: 350000, metaMes: 2500000, corretoresManual: '', vgvManual: '' },
  conquista: { custoFixoMes: 12000, proLabore: 8000, ads: 5000, comissaoBrutaPct: 5,  comCorretorPct: 2.0, comSeniorPct: 1.0, aliquotaPct: 8, ticketMedio: 200000, metaMes: 1500000, corretoresManual: '', vgvManual: '' },
  terceiros: { custoFixoMes: 8000,  proLabore: 4000, ads: 3000, comissaoBrutaPct: 6,  comCorretorPct: 3.0, comSeniorPct: 1.0, aliquotaPct: 8, ticketMedio: 250000, metaMes: 800000,  corretoresManual: '', vgvManual: '' },
  locacoes:  { custoFixoMes: 4000,  proLabore: 4000, ads: 1000, comissaoBrutaPct: 10, comCorretorPct: 4.0, comSeniorPct: 2.0, aliquotaPct: 8, ticketMedio: 2500,   metaMes: 60000,   corretoresManual: '', vgvManual: '' },
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
  try { _data = await api.request('/api/v3/metas/atingimento').catch(() => ({})); }
  catch { _data = {}; }
  renderBanner();
  renderTable();
  renderParams(); // re-render p/ preencher hints de auto (nº corretores / vgv)
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_lines)); } catch {} }

/* ── Agregação real por equipe (VGV, vendas, headcount) ── */
function teamAgg() {
  const pc = _data?.por_corretor || [];
  const team = c => (c.team || '').toLowerCase();
  const isLoc = c => team(c).includes('loca');
  const isConq = c => team(c) === 'conquista';
  const isTerc = c => team(c) === 'terceiros';
  const isMap = c => !isLoc(c) && !isConq(c) && !isTerc(c); // M.A.P = lançamento+geral+resto
  const agg = pred => {
    const rows = pc.filter(pred);
    return {
      vgv: rows.reduce((s, c) => s + (+c.vgv_atingido || 0), 0),
      vendas: rows.reduce((s, c) => s + (+c.vendas || 0), 0),
      n: rows.length,
    };
  };
  return { map: agg(isMap), conquista: agg(isConq), terceiros: agg(isTerc), locacoes: agg(isLoc) };
}

function resolved(id) {
  const p = _lines[id];
  const a = teamAgg()[id] || { vgv: 0, vendas: 0, n: 0 };
  const vgvManual = (p.vgvManual !== '' && p.vgvManual != null) ? +p.vgvManual : null;
  const corrManual = (p.corretoresManual !== '' && p.corretoresManual != null) ? +p.corretoresManual : null;
  return {
    vgvReal: vgvManual != null ? vgvManual : a.vgv,
    vendasReal: a.vendas,
    nCorr: corrManual != null ? corrManual : a.n,
    autoVgv: a.vgv, autoN: a.n,
    vgvIsManual: vgvManual != null, corrIsManual: corrManual != null,
  };
}

/* ── Viabilidade de uma linha ── */
function computeLine(id) {
  const p = _lines[id];
  const r = resolved(id);
  const despFixa = (+p.custoFixoMes || 0) + (+p.proLabore || 0) + (+p.ads || 0);
  const margemLiquidaPct = (p.comissaoBrutaPct - p.aliquotaPct * p.comissaoBrutaPct / 100) / 100;
  const vgvBreakEven = margemLiquidaPct > 0 ? despFixa / margemLiquidaPct : 0;
  const comissaoBrutaMedia = p.ticketMedio * p.comissaoBrutaPct / 100;
  const impostoMedio = comissaoBrutaMedia * p.aliquotaPct / 100;
  const comissaoCorretor = p.ticketMedio * p.comCorretorPct / 100;
  const comissaoSenior = p.ticketMedio * p.comSeniorPct / 100;
  const margemPSM = comissaoBrutaMedia - impostoMedio - comissaoCorretor - comissaoSenior;
  const vendasBreakEven = margemPSM > 0 ? Math.ceil(despFixa / margemPSM) : 0;
  // POR CORRETOR (o pedido): quanto cada corretor da equipe precisa produzir pra cobrir o break-even
  const nCorr = r.nCorr || 0;
  const vgvMinPorCorretor = nCorr > 0 ? vgvBreakEven / nCorr : 0;
  const vendasMinPorCorretor = nCorr > 0 ? Math.ceil(vendasBreakEven / nCorr) : 0;
  const lucroLiquido = r.vgvReal * margemLiquidaPct - despFixa;
  const margemLiquidaReal = r.vgvReal > 0 ? (lucroLiquido / r.vgvReal * 100) : 0;
  return {
    despFixa, margemLiquidaPct, vgvBreakEven, vendasBreakEven, margemPSM,
    nCorr, ticket: +p.ticketMedio || 0, vgvMinPorCorretor, vendasMinPorCorretor,
    vgvReal: r.vgvReal, vendasReal: r.vendasReal, lucroLiquido, margemLiquidaReal,
  };
}

function computeTotal(per) {
  const t = { despFixa: 0, vgvBreakEven: 0, vendasBreakEven: 0, vgvReal: 0, vendasReal: 0, lucroLiquido: 0, nCorr: 0 };
  for (const id of Object.keys(per)) {
    const c = per[id];
    t.despFixa += c.despFixa; t.vgvBreakEven += c.vgvBreakEven; t.vendasBreakEven += c.vendasBreakEven;
    t.vgvReal += c.vgvReal; t.vendasReal += c.vendasReal; t.lucroLiquido += c.lucroLiquido; t.nCorr += c.nCorr;
  }
  t.margemLiquidaReal = t.vgvReal > 0 ? (t.lucroLiquido / t.vgvReal * 100) : 0;
  t.vgvMinPorCorretor = t.nCorr > 0 ? t.vgvBreakEven / t.nCorr : 0;
  t.vendasMinPorCorretor = t.nCorr > 0 ? Math.ceil(t.vendasBreakEven / t.nCorr) : 0;
  return t;
}

/* ── Render shell ── */
function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🧪 Métricas de Viabilidade por Linha</h2>
      <p class="card-sub">Break-even por unidade (M.A.P · Conquista · Terceiros · Locações) + consolidado · com VGV mínimo POR CORRETOR · Sócio only</p>
      <div id="viab-banner"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Parâmetros da linha (tudo editável)</div>
      <div class="flex gap-2" style="flex-wrap:wrap" id="viab-tabs">
        ${LINES.map(l => `<button class="btn ${l.id === _active ? 'btn-primary' : 'btn-ghost'} btn-sm" data-line="${l.id}">${l.icon} ${l.nome}</button>`).join('')}
      </div>
      <div id="viab-params" style="background:var(--bg-3);border-radius:10px;padding:14px;margin-top:8px"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:18px 0 6px">📊 Quadro comparativo — break-even por linha + por corretor</div>
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
  const a = teamAgg();
  el.innerHTML = `
    <div class="alert" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);padding:10px 12px;border-radius:8px;margin-top:8px;font-size:12.5px">
      📡 <b>VGV real do sistema (ano):</b> ${fmt(real)} · ${vendas} venda(s). Por equipe →
      🏢 M.A.P ${fmt(a.map.vgv)} (${a.map.n}p) · 🏠 Conquista ${fmt(a.conquista.vgv)} (${a.conquista.n}p) · 🤝 Terceiros ${fmt(a.terceiros.vgv)} (${a.terceiros.n}p) · 🔑 Locações ${fmt(a.locacoes.vgv)} (${a.locacoes.n}p).
      <span class="muted">VGV e nº de corretores de cada linha podem ser sobrescritos abaixo.</span>
    </div>`;
}

function renderParams() {
  const el = document.getElementById('viab-params'); if (!el) return;
  const l = LINES.find(x => x.id === _active);
  const r = resolved(_active);
  el.innerHTML = `
    <div style="font-weight:800;color:${l.cor};margin-bottom:8px">${l.icon} ${l.nome}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${inp('Nº de Corretores', 'corretoresManual', '', `real: ${r.autoN}`)}
      ${inp('Ticket Médio (R$)', 'ticketMedio')}
      ${inp('Meta Mês (R$)', 'metaMes')}
      ${inp('Custo Fixo Mensal (R$)', 'custoFixoMes')}
      ${inp('Pró-Labore (R$)', 'proLabore')}
      ${inp('Investimento Ads (R$)', 'ads')}
      ${inp('Comissão Bruta (%)', 'comissaoBrutaPct', '%')}
      ${inp('% Corretor', 'comCorretorPct', '%')}
      ${inp('% Sênior', 'comSeniorPct', '%')}
      ${inp('Alíquota Imposto (%)', 'aliquotaPct', '%')}
    </div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
      ${inp('VGV Realizado (R$) — vazio = usar dado real da equipe', 'vgvManual', '', `auto: ${fmt(r.autoVgv)}`)}
      <div id="viab-hint" class="tiny muted" style="margin-top:2px">
        ${r.corrIsManual ? '✏️ nº corretores manual' : `📡 nº corretores real (${r.autoN})`} ·
        ${r.vgvIsManual ? '✏️ VGV manual' : '📡 VGV real da equipe'}
      </div>
    </div>
  `;
  el.querySelectorAll('[data-key]').forEach(input => input.addEventListener('input', e => {
    const k = input.dataset.key;
    _lines[_active][k] = (k === 'vgvManual' || k === 'corretoresManual') ? e.target.value.trim() : (parseFloat(e.target.value) || 0);
    save();
    clearTimeout(window._vtm); window._vtm = setTimeout(() => { renderTable(); renderBanner(); renderHint(); }, 200);
  }));
}

function renderHint() {
  const r = resolved(_active); const h = document.getElementById('viab-hint');
  if (h) h.innerHTML = `${r.corrIsManual ? '✏️ nº corretores manual' : `📡 nº corretores real (${r.autoN})`} · ${r.vgvIsManual ? '✏️ VGV manual' : '📡 VGV real da equipe'}`;
}

function renderTable() {
  const body = document.getElementById('viab-table'); if (!body) return;
  const per = {}; for (const l of LINES) per[l.id] = computeLine(l.id);
  const tot = computeTotal(per);

  const statusCell = (vgvReal, be) => {
    const ok = vgvReal >= be && be > 0;
    return `<span style="color:${ok ? '#16a34a' : '#dc2626'};font-weight:800">${ok ? '✅ viável' : '⚠️ abaixo'}</span>`;
  };
  const colHead = LINES.map(l => `<th style="text-align:right;padding:8px 10px;color:${l.cor};white-space:nowrap">${l.icon} ${l.nome.replace('PSM ', '')}</th>`).join('');
  const td = v => `<td style="text-align:right;padding:7px 10px">${v}</td>`;
  // [label, fn(per-line), totalValue, {strong, highlight}]
  const rows = [
    ['Nº Corretores', id => per[id].nCorr || '—', tot.nCorr || '—'],
    ['Ticket Médio', id => fmt(per[id].ticket), '—'],
    ['Despesa Fixa/mês', id => fmt(per[id].despFixa), fmt(tot.despFixa)],
    ['VGV Break-Even (linha)', id => fmt(per[id].vgvBreakEven), fmt(tot.vgvBreakEven), { strong: 1 }],
    ['⭐ VGV mín / corretor', id => fmt(per[id].vgvMinPorCorretor), fmt(tot.vgvMinPorCorretor), { hl: 1 }],
    ['⭐ Vendas mín / corretor', id => (per[id].vendasMinPorCorretor || '—'), (tot.vendasMinPorCorretor || '—'), { hl: 1 }],
    ['Vendas Break-Even (linha)', id => per[id].vendasBreakEven || '—', tot.vendasBreakEven || '—'],
    ['Margem PSM / venda', id => fmt(per[id].margemPSM), '—'],
    ['VGV Realizado', id => fmt(per[id].vgvReal), fmt(tot.vgvReal)],
    ['Lucro Líquido/mês', id => colorNum(per[id].lucroLiquido), colorNum(tot.lucroLiquido)],
    ['Margem Líquida %', id => per[id].margemLiquidaReal.toFixed(1) + '%', tot.margemLiquidaReal.toFixed(1) + '%'],
    ['Status', id => statusCell(per[id].vgvReal, per[id].vgvBreakEven), statusCell(tot.vgvReal, tot.vgvBreakEven)],
  ];

  body.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:760px">
        <thead>
          <tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:8px 10px">Métrica</th>
            ${colHead}
            <th style="text-align:right;padding:8px 10px;color:#0f766e;background:rgba(13,148,136,.08);white-space:nowrap">📊 CONSOLIDADO</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([label, fn, total, opt]) => {
            const o = opt || {};
            const rowStyle = `border-bottom:1px solid var(--border)${o.strong ? ';font-weight:700' : ''}${o.hl ? ';background:rgba(124,58,237,.06)' : ''}`;
            return `<tr style="${rowStyle}">
              <td style="text-align:left;padding:7px 10px;font-weight:600">${label}</td>
              ${LINES.map(l => td(fn(l.id))).join('')}
              <td style="text-align:right;padding:7px 10px;font-weight:800;background:rgba(13,148,136,.06)">${total}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="alert" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);padding:12px;border-radius:8px;margin-top:14px;font-size:12.5px">
      <b>💡 Leitura:</b><br>
      • ⭐ <b>VGV mín/corretor</b> = quanto CADA corretor da equipe precisa vender/mês pra a linha cobrir o break-even (= break-even da linha ÷ nº de corretores).<br>
      • Break-even consolidado: <b>${fmt(tot.vgvBreakEven)}</b>/mês · ${tot.vgvReal >= tot.vgvBreakEven ? '<b style="color:#16a34a">já coberto</b>' : '<b style="color:#dc2626">falta ' + fmt(tot.vgvBreakEven - tot.vgvReal) + '</b>'}<br>
      • Lucro líquido consolidado: <b style="color:${tot.lucroLiquido >= 0 ? '#16a34a' : '#dc2626'}">${fmt(tot.lucroLiquido)}/mês</b> (margem ${tot.margemLiquidaReal.toFixed(1)}%) · margem saudável no setor: 25–35%.
    </div>
  `;
}

/* ── helpers ── */
function inp(label, key, suffix, placeholder) {
  const val = _lines[_active][key];
  return `<div><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1"><input type="number" class="input" data-key="${key}" value="${val ?? ''}" ${placeholder ? `placeholder="${placeholder}"` : ''} style="flex:1;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}
function colorNum(n) {
  return `<span style="color:${n >= 0 ? '#16a34a' : '#dc2626'}">${fmt(n)}</span>`;
}
function fmt(n) { return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR'); }
