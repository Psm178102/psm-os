/* PSM-OS v2 — Métricas de Viabilidade por LINHA + Rateio híbrido de custos (Sprint 9.30)
   4 linhas: PSM M.A.P · Conquista · Terceiros · Locações + Consolidado.
   Custos compartilhados (planilha) rateados:
     - Igual      → ÷ 3 (M.A.P, Conquista, Locações) — exclui Terceiros
     - Proporcional → pela EXPECTATIVA DE VGV (nº corretores × ticket × vendas/corretor) — exclui Terceiros
     - Direto     → 100% na linha indicada (qualquer linha)
   + custo direto extra manual por linha. Tudo editável. VGV mín/corretor pra break-even.
   Custos persistidos no board `custos_compartilhados` (compartilhado, sem SQL novo). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _data = null, _custos = null, _active = 'map', _showCustos = false, _custosMsg = '';

const LKEY = 'psm_v2_metricas_viab_lines';
const SHARED = ['map', 'conquista', 'locacoes']; // linhas que rateiam custos compartilhados (excl. Terceiros)

const LINES = [
  { id: 'map',       nome: 'PSM M.A.P',     icon: '🏢', cor: '#7c3aed' },
  { id: 'conquista', nome: 'PSM Conquista', icon: '🏠', cor: '#2563eb' },
  { id: 'terceiros', nome: 'PSM Terceiros', icon: '🤝', cor: '#0891b2' },
  { id: 'locacoes',  nome: 'PSM Locações',  icon: '🔑', cor: '#d97706' },
];

const DEFAULTS = {
  map:       { ticketMedio: 350000, vendasMes: 1, comissaoBrutaPct: 4,  comCorretorPct: 1.4, comSeniorPct: 1.6, aliquotaPct: 8, custoDireto: 0, metaMes: 2500000, corretoresManual: '', vgvManual: '' },
  conquista: { ticketMedio: 200000, vendasMes: 1, comissaoBrutaPct: 5,  comCorretorPct: 2.0, comSeniorPct: 1.0, aliquotaPct: 8, custoDireto: 0, metaMes: 1500000, corretoresManual: '', vgvManual: '' },
  terceiros: { ticketMedio: 250000, vendasMes: 1, comissaoBrutaPct: 6,  comCorretorPct: 3.0, comSeniorPct: 1.0, aliquotaPct: 8, custoDireto: 8000, metaMes: 800000, corretoresManual: '', vgvManual: '' },
  locacoes:  { ticketMedio: 2500,   vendasMes: 1, comissaoBrutaPct: 10, comCorretorPct: 4.0, comSeniorPct: 2.0, aliquotaPct: 8, custoDireto: 0, metaMes: 60000,   corretoresManual: '', vgvManual: '' },
};

// Planilha "CUSTOS COMPARTILHADOS — Rateio híbrido (excl. Terceiros)"
const CUSTOS_SEED = [
  { item: 'Pró-labore Paulo (set/2026 R$8k)', valor: 0, tipo: 'igual', cat: 'Sócios' },
  { item: 'Pró-labore Isadora (set/2026 R$8k)', valor: 0, tipo: 'igual', cat: 'Sócios' },
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

let _lines = null;

export async function pageMetricasViab(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>'; return; }
  try {
    const saved = JSON.parse(localStorage.getItem(LKEY) || '{}');
    _lines = {};
    for (const l of LINES) _lines[l.id] = Object.assign({}, DEFAULTS[l.id], saved[l.id] || {});
  } catch { _lines = JSON.parse(JSON.stringify(DEFAULTS)); }
  _custos = CUSTOS_SEED.map(c => ({ ...c }));
  render();
  await load();
}

async function load() {
  try {
    const [atg, board] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/diretoria/strategy?board=custos_compartilhados').catch(() => null),
    ]);
    _data = atg || {};
    if (board && board.ok && board.data && Array.isArray(board.data.items) && board.data.items.length) {
      _custos = board.data.items.map(c => ({ ...c }));
      _custosMsg = '';
    } else if (board && board.pending) {
      _custosMsg = '⏳ Board ainda não criado — usando a planilha base. Edite/salve pra persistir.';
    } else {
      _custosMsg = 'Usando a planilha base (padrão). Edite que eu salvo automaticamente.';
    }
  } catch { _data = {}; }
  renderBanner(); renderCustos(); renderParams(); renderTable();
}

function saveLines() { try { localStorage.setItem(LKEY, JSON.stringify(_lines)); } catch {} }
function saveCustos() {
  clearTimeout(window._cst);
  window._cst = setTimeout(async () => {
    try {
      const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'custos_compartilhados', data: { items: _custos } } });
      _custosMsg = (r && r.ok) ? '💾 salvo' : (r && r.pending ? '⚠️ ' + (r.error || 'tabela ausente') : '⚠️ erro ao salvar');
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
  const agg = pred => { const r = pc.filter(pred); return { vgv: r.reduce((s, c) => s + (+c.vgv_atingido || 0), 0), vendas: r.reduce((s, c) => s + (+c.vendas || 0), 0), n: r.length }; };
  return { map: agg(isMap), conquista: agg(isConq), terceiros: agg(isTerc), locacoes: agg(isLoc) };
}
function resolved(id) {
  const p = _lines[id], a = teamAgg()[id] || { vgv: 0, vendas: 0, n: 0 };
  const vM = (p.vgvManual !== '' && p.vgvManual != null) ? +p.vgvManual : null;
  const cM = (p.corretoresManual !== '' && p.corretoresManual != null) ? +p.corretoresManual : null;
  return { vgvReal: vM != null ? vM : a.vgv, vendasReal: a.vendas, nCorr: cM != null ? cM : a.n, autoVgv: a.vgv, autoN: a.n, vgvIsManual: vM != null, corrIsManual: cM != null };
}
function expectativa(id) {
  const p = _lines[id], r = resolved(id);
  return (r.nCorr || 0) * (+p.ticketMedio || 0) * (+p.vendasMes || 0);
}

/* ── rateio híbrido dos custos compartilhados ── */
function rateio() {
  const igualTotal = _custos.filter(c => c.tipo === 'igual').reduce((s, c) => s + (+c.valor || 0), 0);
  const propTotal = _custos.filter(c => c.tipo === 'proporcional').reduce((s, c) => s + (+c.valor || 0), 0);
  const exp = {}; let expTotal = 0;
  for (const id of SHARED) { exp[id] = expectativa(id); expTotal += exp[id]; }
  const out = { map: 0, conquista: 0, terceiros: 0, locacoes: 0 };
  for (const id of SHARED) {
    out[id] += igualTotal / SHARED.length;
    out[id] += expTotal > 0 ? propTotal * (exp[id] / expTotal) : propTotal / SHARED.length;
  }
  for (const c of _custos) if (c.tipo === 'direto' && c.linha && out[c.linha] != null) out[c.linha] += (+c.valor || 0);
  return { alloc: out, igualTotal, propTotal, exp, expTotal };
}

/* ── viabilidade por linha ── */
function computeLine(id, rt) {
  const p = _lines[id], r = resolved(id);
  const despFixa = (rt.alloc[id] || 0) + (+p.custoDireto || 0);
  const margemLiquidaPct = (p.comissaoBrutaPct - p.aliquotaPct * p.comissaoBrutaPct / 100) / 100;
  const vgvBreakEven = margemLiquidaPct > 0 ? despFixa / margemLiquidaPct : 0;
  const comBruta = p.ticketMedio * p.comissaoBrutaPct / 100;
  const margemPSM = comBruta - comBruta * p.aliquotaPct / 100 - p.ticketMedio * p.comCorretorPct / 100 - p.ticketMedio * p.comSeniorPct / 100;
  const vendasBreakEven = margemPSM > 0 ? Math.ceil(despFixa / margemPSM) : 0;
  const nCorr = r.nCorr || 0;
  const vgvMinPorCorretor = nCorr > 0 ? vgvBreakEven / nCorr : 0;
  const vendasMinPorCorretor = nCorr > 0 ? Math.ceil(vendasBreakEven / nCorr) : 0;
  const lucroLiquido = r.vgvReal * margemLiquidaPct - despFixa;
  const margemLiquidaReal = r.vgvReal > 0 ? (lucroLiquido / r.vgvReal * 100) : 0;
  return { despFixa, vgvBreakEven, vendasBreakEven, margemPSM, nCorr, ticket: +p.ticketMedio || 0, expectativa: expectativa(id), vgvMinPorCorretor, vendasMinPorCorretor, vgvReal: r.vgvReal, lucroLiquido, margemLiquidaReal };
}
function computeTotal(per) {
  const t = { despFixa: 0, vgvBreakEven: 0, vendasBreakEven: 0, vgvReal: 0, lucroLiquido: 0, nCorr: 0, expectativa: 0 };
  for (const id of Object.keys(per)) { const c = per[id]; t.despFixa += c.despFixa; t.vgvBreakEven += c.vgvBreakEven; t.vendasBreakEven += c.vendasBreakEven; t.vgvReal += c.vgvReal; t.lucroLiquido += c.lucroLiquido; t.nCorr += c.nCorr; t.expectativa += c.expectativa; }
  t.margemLiquidaReal = t.vgvReal > 0 ? (t.lucroLiquido / t.vgvReal * 100) : 0;
  t.vgvMinPorCorretor = t.nCorr > 0 ? t.vgvBreakEven / t.nCorr : 0;
  t.vendasMinPorCorretor = t.nCorr > 0 ? Math.ceil(t.vendasBreakEven / t.nCorr) : 0;
  return t;
}

/* ── shell ── */
function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🧪 Métricas de Viabilidade por Linha</h2>
      <p class="card-sub">Break-even por unidade + rateio híbrido de custos + VGV mínimo POR CORRETOR · Sócio only</p>
      <div id="viab-banner"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Parâmetros da linha (editável)</div>
      <div class="flex gap-2" style="flex-wrap:wrap" id="viab-tabs">
        ${LINES.map(l => `<button class="btn ${l.id === _active ? 'btn-primary' : 'btn-ghost'} btn-sm" data-line="${l.id}">${l.icon} ${l.nome}</button>`).join('')}
      </div>
      <div id="viab-params" style="background:var(--bg-3);border-radius:10px;padding:14px;margin-top:8px"></div>

      <div id="viab-custos" style="margin-top:14px"></div>

      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:18px 0 6px">📊 Quadro comparativo</div>
      <div id="viab-table"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  _root.querySelectorAll('#viab-tabs [data-line]').forEach(b => b.addEventListener('click', () => {
    _active = b.dataset.line;
    _root.querySelectorAll('#viab-tabs [data-line]').forEach(x => x.className = `btn ${x.dataset.line === _active ? 'btn-primary' : 'btn-ghost'} btn-sm`);
    renderParams();
  }));
  renderParams(); renderCustos();
}

function renderBanner() {
  const el = document.getElementById('viab-banner'); if (!el) return;
  const a = teamAgg();
  el.innerHTML = `<div class="alert" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);padding:10px 12px;border-radius:8px;margin-top:8px;font-size:12.5px">
    📡 <b>VGV real (ano):</b> ${fmt(+(_data?.total_vgv || 0))} · ${+(_data?.total_vendas || 0)} venda(s). Por equipe →
    🏢 M.A.P ${fmt(a.map.vgv)} (${a.map.n}p) · 🏠 Conquista ${fmt(a.conquista.vgv)} (${a.conquista.n}p) · 🤝 Terceiros ${fmt(a.terceiros.vgv)} (${a.terceiros.n}p) · 🔑 Locações ${fmt(a.locacoes.vgv)} (${a.locacoes.n}p).</div>`;
}

function renderParams() {
  const el = document.getElementById('viab-params'); if (!el) return;
  const l = LINES.find(x => x.id === _active), r = resolved(_active);
  el.innerHTML = `
    <div style="font-weight:800;color:${l.cor};margin-bottom:8px">${l.icon} ${l.nome}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${inp('Nº de Corretores', 'corretoresManual', '', `real: ${r.autoN}`)}
      ${inp('Ticket Médio (R$)', 'ticketMedio')}
      ${inp('Vendas/corretor/mês (p/ expectativa)', 'vendasMes')}
      ${inp('Comissão Bruta (%)', 'comissaoBrutaPct', '%')}
      ${inp('% Corretor', 'comCorretorPct', '%')}
      ${inp('% Sênior', 'comSeniorPct', '%')}
      ${inp('Alíquota Imposto (%)', 'aliquotaPct', '%')}
      ${inp('Custo Direto Extra (R$/mês)', 'custoDireto', '', _active === 'terceiros' ? 'Terceiros não rateia' : 'fora da planilha')}
      ${inp('Meta Mês (R$)', 'metaMes')}
    </div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
      ${inp('VGV Realizado (R$) — vazio = dado real da equipe', 'vgvManual', '', `auto: ${fmt(r.autoVgv)}`)}
      <div class="tiny muted" style="margin-top:4px">📐 Expectativa de VGV/mês desta linha: <b>${fmt(expectativa(_active))}</b> (nº corretores × ticket × vendas/corretor) — é a base do rateio proporcional.${_active === 'terceiros' ? ' <span style="color:#d97706">Terceiros é EXCLUÍDO do rateio compartilhado (só custo direto).</span>' : ''}</div>
    </div>`;
  el.querySelectorAll('[data-key]').forEach(input => input.addEventListener('input', e => {
    const k = input.dataset.key;
    _lines[_active][k] = (k === 'vgvManual' || k === 'corretoresManual') ? e.target.value.trim() : (parseFloat(e.target.value) || 0);
    saveLines();
    clearTimeout(window._vtm); window._vtm = setTimeout(() => { renderTable(); renderBanner(); }, 200);
  }));
}

function renderCustos() {
  const el = document.getElementById('viab-custos'); if (!el) return;
  const rt = rateio();
  const dirTotal = _custos.filter(c => c.tipo === 'direto').reduce((s, c) => s + (+c.valor || 0), 0);
  const total = rt.igualTotal + rt.propTotal + dirTotal;
  if (!_showCustos) {
    el.innerHTML = `<div style="background:var(--bg-3);border-radius:10px;padding:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-size:12.5px"><b>💸 Custos Compartilhados (rateio híbrido)</b> — ${_custos.length} itens · Igual ${fmt(rt.igualTotal)} · Proporcional ${fmt(rt.propTotal)} · Direto ${fmt(dirTotal)} · <b>Total ${fmt(total)}/mês</b></div>
      <button class="btn btn-ghost btn-sm" id="custos-toggle">✏️ editar custos</button>
    </div>`;
    document.getElementById('custos-toggle').addEventListener('click', () => { _showCustos = true; renderCustos(); });
    return;
  }
  const lineOpts = id => LINES.map(l => `<option value="${l.id}"${l.id === id ? ' selected' : ''}>${l.nome}</option>`).join('');
  el.innerHTML = `
    <div style="background:var(--bg-3);border-radius:10px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div style="font-weight:800">💸 Custos Compartilhados — rateio híbrido <span class="tiny muted">(excl. Terceiros no Igual/Proporcional)</span></div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" id="custos-add">＋ item</button>
          <button class="btn btn-ghost btn-sm" id="custos-reset">↺ planilha base</button>
          <button class="btn btn-ghost btn-sm" id="custos-close">✓ fechar</button>
        </div>
      </div>
      <div class="tiny muted" id="custos-msg" style="margin-bottom:6px">${escapeHtml(_custosMsg)}</div>
      <div style="overflow-x:auto;max-height:340px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:620px">
          <thead><tr style="background:var(--bg-2);position:sticky;top:0">
            <th style="text-align:left;padding:6px 8px">Item</th>
            <th style="text-align:right;padding:6px 8px;width:110px">R$/mês</th>
            <th style="text-align:left;padding:6px 8px;width:130px">Rateio</th>
            <th style="text-align:left;padding:6px 8px;width:130px">Linha (se direto)</th>
            <th style="width:30px"></th>
          </tr></thead>
          <tbody>
            ${_custos.map((c, i) => `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:3px 6px"><input class="input" data-idx="${i}" data-field="item" value="${escapeHtml(c.item || '')}" style="width:100%;font-size:12px;padding:4px 6px"></td>
              <td style="padding:3px 6px"><input class="input" type="number" data-idx="${i}" data-field="valor" value="${c.valor ?? 0}" style="width:100%;font-size:12px;padding:4px 6px;text-align:right"></td>
              <td style="padding:3px 6px"><select class="input" data-idx="${i}" data-field="tipo" style="width:100%;font-size:12px;padding:4px 6px">
                <option value="igual"${c.tipo === 'igual' ? ' selected' : ''}>Igual (÷3)</option>
                <option value="proporcional"${c.tipo === 'proporcional' ? ' selected' : ''}>Proporcional</option>
                <option value="direto"${c.tipo === 'direto' ? ' selected' : ''}>Direto</option>
              </select></td>
              <td style="padding:3px 6px">${c.tipo === 'direto' ? `<select class="input" data-idx="${i}" data-field="linha" style="width:100%;font-size:12px;padding:4px 6px">${lineOpts(c.linha || 'map')}</select>` : '<span class="tiny muted">—</span>'}</td>
              <td style="padding:3px 6px;text-align:center"><span data-del="${i}" style="cursor:pointer;color:#dc2626">✕</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="tiny muted" style="margin-top:6px">Igual <b>${fmt(rt.igualTotal)}</b> ÷ 3 = ${fmt(rt.igualTotal / 3)}/linha · Proporcional <b>${fmt(rt.propTotal)}</b> rateado por expectativa · Direto <b>${fmt(dirTotal)}</b> · Total <b>${fmt(total)}/mês</b></div>
    </div>`;
  // binds
  el.querySelectorAll('input[data-idx]').forEach(inpEl => inpEl.addEventListener('input', e => {
    const i = +inpEl.dataset.idx, f = inpEl.dataset.field;
    _custos[i][f] = f === 'valor' ? (parseFloat(e.target.value) || 0) : e.target.value;
    saveCustos();
    clearTimeout(window._vtm); window._vtm = setTimeout(renderTable, 250);
  }));
  el.querySelectorAll('select[data-idx]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.idx, f = sel.dataset.field;
    _custos[i][f] = sel.value;
    if (f === 'tipo' && sel.value === 'direto' && !_custos[i].linha) _custos[i].linha = 'map';
    saveCustos();
    if (f === 'tipo') renderCustos(); // mostra/esconde select de linha
    renderTable();
  }));
  el.querySelectorAll('[data-del]').forEach(x => x.addEventListener('click', () => { _custos.splice(+x.dataset.del, 1); saveCustos(); renderCustos(); renderTable(); }));
  document.getElementById('custos-add').addEventListener('click', () => { _custos.push({ item: 'Novo custo', valor: 0, tipo: 'proporcional', cat: '' }); saveCustos(); renderCustos(); renderTable(); });
  document.getElementById('custos-reset').addEventListener('click', () => { if (confirm('Restaurar a planilha base? (descarta edições)')) { _custos = CUSTOS_SEED.map(c => ({ ...c })); saveCustos(); renderCustos(); renderTable(); } });
  document.getElementById('custos-close').addEventListener('click', () => { _showCustos = false; renderCustos(); });
}

function renderTable() {
  const body = document.getElementById('viab-table'); if (!body) return;
  const rt = rateio();
  const per = {}; for (const l of LINES) per[l.id] = computeLine(l.id, rt);
  const tot = computeTotal(per);
  const statusCell =(vgvReal, be) => { const ok = vgvReal >= be && be > 0; return `<span style="color:${ok ? '#16a34a' : '#dc2626'};font-weight:800">${ok ? '✅ viável' : '⚠️ abaixo'}</span>`; };
  const colHead = LINES.map(l => `<th style="text-align:right;padding:8px 10px;color:${l.cor};white-space:nowrap">${l.icon} ${l.nome.replace('PSM ', '')}</th>`).join('');
  const td = v => `<td style="text-align:right;padding:7px 10px">${v}</td>`;
  const rows = [
    ['Nº Corretores', id => per[id].nCorr || '—', tot.nCorr || '—'],
    ['Ticket Médio', id => fmt(per[id].ticket), '—'],
    ['Expectativa VGV/mês', id => fmt(per[id].expectativa), fmt(tot.expectativa)],
    ['Despesa Fixa/mês (rateio+direto)', id => fmt(per[id].despFixa), fmt(tot.despFixa), { strong: 1 }],
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
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:780px">
        <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:8px 10px">Métrica</th>${colHead}
          <th style="text-align:right;padding:8px 10px;color:#0f766e;background:rgba(13,148,136,.08);white-space:nowrap">📊 CONSOLIDADO</th>
        </tr></thead>
        <tbody>
          ${rows.map(([label, fn, total, opt]) => {
            const o = opt || {};
            return `<tr style="border-bottom:1px solid var(--border)${o.strong ? ';font-weight:700' : ''}${o.hl ? ';background:rgba(124,58,237,.06)' : ''}">
              <td style="text-align:left;padding:7px 10px;font-weight:600">${label}</td>
              ${LINES.map(l => td(fn(l.id))).join('')}
              <td style="text-align:right;padding:7px 10px;font-weight:800;background:rgba(13,148,136,.06)">${total}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="alert" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);padding:12px;border-radius:8px;margin-top:14px;font-size:12.5px">
      <b>💡 Leitura:</b><br>
      • ⭐ <b>VGV mín/corretor</b> = quanto CADA corretor da linha precisa vender/mês pra cobrir o break-even (break-even da linha ÷ nº corretores, com o ticket da linha).<br>
      • <b>Despesa fixa</b> de cada linha sai do <b>rateio híbrido</b> da planilha: Igual ÷3, Proporcional pela expectativa de VGV, Direto cravado + custo direto extra.<br>
      • Consolidado: break-even ${fmt(tot.vgvBreakEven)}/mês · lucro <b style="color:${tot.lucroLiquido >= 0 ? '#16a34a' : '#dc2626'}">${fmt(tot.lucroLiquido)}/mês</b> (margem ${tot.margemLiquidaReal.toFixed(1)}%).
    </div>`;
}

/* ── helpers ── */
function inp(label, key, suffix, placeholder) {
  const val = _lines[_active][key];
  return `<div><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1"><input type="number" class="input" data-key="${key}" value="${val ?? ''}" ${placeholder ? `placeholder="${placeholder}"` : ''} style="flex:1;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}
function colorNum(n) { return `<span style="color:${n >= 0 ? '#16a34a' : '#dc2626'}">${fmt(n)}</span>`; }
function fmt(n) { return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR'); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
