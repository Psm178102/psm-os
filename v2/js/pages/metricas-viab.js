/* PSM-OS v2 — Métricas de Viabilidade · v82.0 (reconstruído em 3 abas)
   Separa as 3 naturezas pra não haver confusão:
   1) 📋 Orçado (mensal, editável à mão — baseline oficial, salvo)
   2) 📈 Realizado mês a mês (VGV/vendas REAIS do CRM + custo lançado à mão;
      Orçado × Realizado × Δ; filtro de período; histórico com fechamento auto+manual)
   3) 🧪 Simulador (sandbox editável, cenários nomeados — não toca no oficial)
   Backend: /api/v3/diretoria/viab (shared_kv viab_orcamento/custos_real/snapshots + realizado do CRM). */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { loadChartLib, darkOpts, DARK_INK, DARK_GRID } from '../premium.js';

let _root = null, _tab = 'resumo', _ano = new Date().getFullYear(), _d = null, _msg = '';
let _vcharts = [];   // instâncias Chart.js vivas (destruídas a cada render, v83.4)
let _rSeries = null;  // séries mês a mês pro gráfico do Realizado (v83.4)
let _pIni = 1, _pFim = Math.max(1, new Date().getMonth() + 1);   // período da aba Realizado
let _custoMes = Math.max(1, new Date().getMonth() + 1);          // mês em edição de custos reais
let _sim = null;                                                 // estado do simulador
let _orcView = 'receita';                                        // 'receita' | 'custos' (aba Orçado)
let _custosOrc = null;                                           // itens de custo orçado detalhado (v82.3)
let _rateioEmp = null;                                           // empresas que rateiam o overhead (config global editável, v82.4)
let _cats = null;                                                // categorias de custo (criar/renomear/apagar, v83.2)
let _catsOpen = false;                                           // gerenciador de categorias aberto?
let _be = null;                                                  // cenário do break-even estratégico (v82.6)
let _beSemPL = false;                                            // break-even: descontar pró-labore do fixo? (v83.5)

const LINHAS = [
  { id: 'map', nome: 'PSM M.A.P', icon: '🏢', cor: '#7c3aed' },
  { id: 'conquista', nome: 'PSM Conquista', icon: '🏠', cor: '#2563eb' },
  { id: 'terceiros', nome: 'PSM Terceiros', icon: '🤝', cor: '#0891b2' },
  { id: 'locacoes', nome: 'PSM Locações', icon: '🔑', cor: '#d97706' },
];
const LIDS = LINHAS.map(l => l.id);
const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
// premissas de comissão/imposto (o custo agora vem dos "Custos detalhados", não daqui)
const PREM = [
  ['com_bruta_pct', 'Comissão bruta %'], ['com_corretor_pct', 'Corretor % (efetivo)'], ['com_senior_pct', 'Sênior %'], ['com_gerente_pct', 'Gerente % (s/ VGV)'], ['aliquota_pct', 'Imposto %'],
];

// ── Custos orçados detalhados (v82.3) ──
const DEFAULT_CATS = ['Sócios', 'Estrutura', 'Folha admin', 'Administrativo', 'Financeiro', 'Software', 'Portais', 'Operacional', 'Treinamento', 'Marketing', 'Tráfego pago', 'Outros'];
const CATS_TRAFEGO = ['Tráfego pago', 'Marketing'];   // excluídas do "custo sem tráfego" (v82.8)
const CLASSES = [['fixo', 'Fixo'], ['variavel', 'Variável'], ['extra', 'Extra']];
const ALOCS = [...LINHAS.map(l => [l.id, l.nome]), ['compartilhado', 'Compartilhado']];
const RATEIOS = [['igual', 'Igual'], ['proporcional', 'Proporcional'], ['especifico', 'Específico'], ['manual', 'Manual']];
// seed com os custos REAIS (do modelo antigo). tupla: [desc, cat, valor, aloc, rateio]. classe=fixo.
const _SEED_RAW = [
  ['Pró-labore Paulo', 'Sócios', 8000, 'compartilhado', 'igual'], ['Pró-labore Isadora', 'Sócios', 8000, 'compartilhado', 'igual'],
  ['Ponto / Aluguel sala', 'Estrutura', 15000, 'compartilhado', 'igual'], ['Condomínio', 'Estrutura', 5400, 'compartilhado', 'igual'],
  ['Energia', 'Estrutura', 1300, 'compartilhado', 'igual'], ['WiFi', 'Estrutura', 100, 'compartilhado', 'igual'],
  ['IPTU', 'Estrutura', 1500, 'compartilhado', 'igual'], ['Mobília (17k/12m)', 'Estrutura', 1416, 'compartilhado', 'igual'],
  ['Água', 'Estrutura', 300, 'compartilhado', 'igual'], ['Limpeza + produtos', 'Estrutura', 1500, 'compartilhado', 'igual'],
  ['Café', 'Estrutura', 500, 'compartilhado', 'igual'], ['Material de escritório', 'Estrutura', 824, 'compartilhado', 'igual'],
  ['Leire (admin)', 'Folha admin', 4376, 'compartilhado', 'igual'], ['Mari (admin)', 'Folha admin', 3242, 'compartilhado', 'igual'],
  ['Guilherme (admin)', 'Folha admin', 3242, 'compartilhado', 'igual'],
  ['Contabilidade', 'Administrativo', 500, 'compartilhado', 'proporcional'], ['CRECI / 12', 'Administrativo', 344.25, 'compartilhado', 'proporcional'],
  ['Empréstimo FGI — PSM 152', 'Financeiro', 5013.16, 'compartilhado', 'proporcional'], ['Empréstimo FGI — PSM 180', 'Financeiro', 683.61, 'compartilhado', 'proporcional'],
  ['Seguro 152', 'Financeiro', 182.31, 'compartilhado', 'proporcional'], ['Seguro 180', 'Financeiro', 27.62, 'compartilhado', 'proporcional'],
  ['PRONAMP', 'Financeiro', 2960.98, 'compartilhado', 'proporcional'], ['Cestas Itaú 152', 'Financeiro', 289, 'compartilhado', 'proporcional'],
  ['Cestas Itaú 180', 'Financeiro', 169, 'compartilhado', 'proporcional'],
  ['RD Station CRM', 'Software', 2784.60, 'compartilhado', 'proporcional'], ['RD Marketing', 'Software', 1210.50, 'compartilhado', 'proporcional'],
  ['Kenlo Locação', 'Software', 163.82, 'locacoes', 'igual'], ['Zoho', 'Software', 120, 'compartilhado', 'proporcional'],
  ['Nibo', 'Software', 600, 'compartilhado', 'proporcional'], ['ClickSign', 'Software', 59, 'compartilhado', 'proporcional'],
  ['Notion', 'Software', 208.56, 'compartilhado', 'proporcional'], ['Canva', 'Software', 34.90, 'compartilhado', 'proporcional'],
  ['Hubla', 'Software', 240.01, 'compartilhado', 'proporcional'], ['WA Plus (1)', 'Software', 27.27, 'compartilhado', 'proporcional'],
  ['WA Plus (2)', 'Software', 27.27, 'compartilhado', 'proporcional'], ['ChatGPT', 'Software', 120.34, 'compartilhado', 'proporcional'],
  ['Google 2TB', 'Software', 15, 'compartilhado', 'proporcional'], ['YouTube', 'Software', 5, 'compartilhado', 'proporcional'],
  ['MLabs', 'Software', 57.90, 'compartilhado', 'proporcional'], ['Adobe', 'Software', 95, 'compartilhado', 'proporcional'],
  ['Claude', 'Software', 121.87, 'compartilhado', 'proporcional'], ['Hostinger', 'Software', 40, 'compartilhado', 'proporcional'],
  ['Canal Pro', 'Portais', 2377.50, 'compartilhado', 'proporcional'], ['Matrículas de imóveis', 'Operacional', 73.25, 'compartilhado', 'proporcional'],
  ['Curso Hard3', 'Treinamento', 99.73, 'compartilhado', 'proporcional'],
];
const seedCustos = () => _SEED_RAW.map((t, i) => ({ id: 'seed_' + i, desc: t[0], cat: t[1], classe: 'fixo', aloc: t[3], rateio: t[4], valor: t[2], meses: null, linhas: [], pesos: null, por_mes: null }));

/* ── util ── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// parser BR-safe: vírgula = decimal; ponto = milhar SÓ quando parece milhar
// (grupo final de 3 dígitos). Assim "1.4" e "4.5" (decimais) não viram 14/45. v82.2
const num = v => {
  let s = String(v ?? '').trim();
  if (!s) return 0;
  if (s.includes(',')) { s = s.replace(/\./g, '').replace(',', '.'); }
  else {
    const p = s.split('.');
    if (p.length > 1 && p[p.length - 1].length === 3 && p.slice(0, -1).every(x => x.length && x.length <= 3)) s = p.join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};
// v83.5 — valor SEMPRE cheio, mínimo 2 casas, sem abreviar (k/M). Paulo pediu R$ XX.XXX,XX em todo lugar.
const fmt = n => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtC = fmt;   // antes abreviava (30k); agora idêntico ao cheio
const pct = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const dc = n => (n || 0) >= 0 ? '#16a34a' : '#dc2626';

/* ── gráficos (Chart.js sob demanda) v83.4 ── */
const CHART_PAL = ['#7c3aed', '#2563eb', '#0891b2', '#d97706', '#16a34a', '#dc2626', '#db2777', '#0d9488', '#ca8a04', '#4f46e5', '#9333ea', '#059669', '#e11d48', '#f59e0b', '#64748b'];
async function mkChart(canvasId, cfg) {
  const el = document.getElementById(canvasId); if (!el) return;
  try {
    const Chart = await loadChartLib();
    if (document.getElementById(canvasId) !== el) return;   // tela mudou enquanto carregava a lib
    _vcharts.push(new Chart(el, cfg));
  } catch (_) { const w = document.getElementById(canvasId + '-wrap'); if (w) w.innerHTML = '<div class="tiny muted" style="text-align:center;padding:20px">gráfico indisponível (sem conexão com a lib)</div>'; }
}
// composição do custo orçado por categoria (valor mensal, desc) — pro donut do Resumo
function custoPorCategoria() {
  const t = {};
  (_custosOrc || []).forEach(it => { t[it.cat] = (t[it.cat] || 0) + itemAnual(it); });
  return Object.entries(t).map(([cat, v]) => ({ cat, mes: v / 12 })).filter(x => x.mes > 0.5).sort((a, b) => b.mes - a.mes);
}

/* ── motor de viabilidade (espelha o backend snapshot_linha) ── */
function calc(vgv, vendas, o, custo) {
  vgv = +vgv || 0; vendas = +vendas || 0; custo = +custo || 0;
  const receita = vgv * (+o.com_bruta_pct || 0) / 100;
  const cc = vgv * (+o.com_corretor_pct || 0) / 100;             // corretor s/ VGV
  const ccCom = receita * (+o.com_corretor_sobre_com_pct || 0) / 100;  // corretor s/ a comissão (v83.5)
  const cs = vgv * (+o.com_senior_pct || 0) / 100;
  const cg = vgv * (+o.com_gerente_pct || 0) / 100;   // gerente s/ VGV (v82.8)
  const imp = receita * (+o.aliquota_pct || 0) / 100;
  const custoTot = custo + (+o.verba_mkt || 0);
  const lucro = receita - cc - ccCom - cs - cg - imp - custoTot;
  return { vgv, vendas, receita, cc, ccCom, cs, cg, imp, custo: custoTot, lucro, ticket: vendas ? vgv / vendas : 0, margem: vgv ? lucro / vgv * 100 : 0 };
}
function orcCell(linha, mes) {
  const base = Object.assign({}, (_d.defaults || {})[linha] || {});
  const saved = ((((_d.orcamento || {})[linha]) || {})[mes]) || {};
  for (const k in saved) if (saved[k] !== '' && saved[k] != null) base[k] = +saved[k];
  return base;
}
function realCell(linha, mes) { const c = ((((_d.realizado || {})[linha]) || {})[mes]) || {}; return { vgv: +c.vgv || 0, vendas: +c.vendas || 0 }; }
// premissa p/ o REALIZADO: zera verba_mkt (mkt real vem das fontes automáticas, não da premissa)
function orcReal(linha, mes) { const o = orcCell(linha, mes); return Object.assign({}, o, { verba_mkt: 0 }); }
// custo automático do mês (Meta real + gancho NIBO), company-wide
function autoMes(mes) { const fa = (_d.fontes_auto || {})[mes] || {}; return { meta_mkt: +fa.meta_mkt || 0, nibo_fixo: +fa.nibo_fixo || 0 }; }
function custoRealMes(mes) {
  const out = { map: 0, conquista: 0, terceiros: 0, locacoes: 0 }; let geral = 0;
  const cell = (_d.custos_real || {})[`${_ano}-${mes}`] || {};
  for (const it of (cell.itens || [])) { const v = +it.valor || 0; if (out[it.linha] != null) out[it.linha] += v; else geral += v; }
  const a = autoMes(mes); geral += a.meta_mkt + a.nibo_fixo;   // fontes automáticas → geral rateado
  if (geral) for (const k in out) out[k] += geral / 4;
  return out;
}

/* ── custos ORÇADOS detalhados → { empresa: {mes: R$} } (v82.3) ── */
function ratEmp() { const e = (_rateioEmp || []).filter(x => LIDS.includes(x)); return e.length ? e : LIDS; }
function ratAlvo(it) {
  if (it.rateio === 'especifico') { const l = (it.linhas || []).filter(x => LIDS.includes(x)); return l.length ? l : ratEmp(); }
  if (it.rateio === 'manual') { const l = Object.keys(it.pesos || {}).filter(x => LIDS.includes(x) && (+it.pesos[x] || 0) > 0); return l.length ? l : ratEmp(); }
  return ratEmp();   // igual / proporcional → empresas que rateiam o overhead (config global)
}
function ratPesos(it, alvo, m) {
  const w = {}; let tot = 0;
  if (it.rateio === 'proporcional') { alvo.forEach(l => { w[l] = orcCell(l, m).vgv || 0; tot += w[l]; }); }
  else if (it.rateio === 'manual') { alvo.forEach(l => { w[l] = +((it.pesos || {})[l]) || 0; tot += w[l]; }); }
  else { alvo.forEach(l => w[l] = 1 / alvo.length); return w; }   // igual / especifico
  if (tot > 0) alvo.forEach(l => w[l] = w[l] / tot); else alvo.forEach(l => w[l] = 1 / alvo.length);
  return w;
}
function custoOrcadoDet(semTrafego) {
  const out = {}; LIDS.forEach(l => { out[l] = {}; for (let m = 1; m <= 12; m++) out[l][m] = 0; });
  for (const it of (_custosOrc || [])) {
    if (semTrafego && CATS_TRAFEGO.includes(it.cat)) continue;   // exclui tráfego pago do total
    const base0 = +it.valor || 0;
    for (let m = 1; m <= 12; m++) {
      if (it.classe === 'extra' && Array.isArray(it.meses) && it.meses.length && !it.meses.includes(m)) continue;
      const base = (it.por_mes && it.por_mes[m] != null && it.por_mes[m] !== '') ? +it.por_mes[m] : base0;
      if (it.classe === 'variavel') {
        const p = base / 100;
        if (it.aloc !== 'compartilhado') { if (out[it.aloc]) out[it.aloc][m] += (orcCell(it.aloc, m).vgv || 0) * p; }
        else for (const l of LIDS) out[l][m] += (orcCell(l, m).vgv || 0) * p;
        continue;
      }
      if (it.aloc !== 'compartilhado') { if (out[it.aloc]) out[it.aloc][m] += base; continue; }
      const alvo = ratAlvo(it), pesos = ratPesos(it, alvo, m);
      for (const l of alvo) out[l][m] += base * (pesos[l] || 0);
    }
  }
  return out;
}
let _custoDetMemo = null;   // recalculado a cada render()
function custoOrcLinhaMes(l, m) {
  if ((_custosOrc || []).length) { if (!_custoDetMemo) _custoDetMemo = custoOrcadoDet(); return _custoDetMemo[l][m] || 0; }
  return orcCell(l, m).custo_fixo || 0;   // fallback legado (sem itens detalhados)
}

/* ── boot ── */
export async function pageMetricasViab(ctx, root) {
  _root = root;
  // Acesso controlado pela MATRIZ de permissões (router canSee) + backend can_viab.
  // Sem gate fixo de nível — o sócio libera/tira por papel em Configurações → Permissões. v82.7
  await load();
}
async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando viabilidade…</div></div>';
  try { _d = await api.request('/api/v3/diretoria/viab?ano=' + _ano); }
  catch (e) { _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`; return; }
  // custos orçados detalhados: usa o que está salvo; se vazio, pré-carrega os custos reais (seed) — só persiste quando salvar
  const st = (_d.custos_orcado && Array.isArray(_d.custos_orcado.itens)) ? _d.custos_orcado.itens : [];
  _custosOrc = st.length ? st.map(x => ({ ...x })) : seedCustos();
  _rateioEmp = (_d.custos_orcado && Array.isArray(_d.custos_orcado.rateio_empresas) && _d.custos_orcado.rateio_empresas.length)
    ? _d.custos_orcado.rateio_empresas.filter(x => LIDS.includes(x)) : LIDS.slice();
  _cats = (_d.custos_orcado && Array.isArray(_d.custos_orcado.categorias) && _d.custos_orcado.categorias.length)
    ? _d.custos_orcado.categorias.slice() : DEFAULT_CATS.slice();
  // garante que toda categoria usada pelos itens exista na lista
  (_custosOrc || []).forEach(it => { if (it.cat && !_cats.includes(it.cat)) _cats.push(it.cat); });
  if (!_cats.includes('Outros')) _cats.push('Outros');
  render();
}
function render() {
  _custoDetMemo = null;   // recalcula custos detalhados do zero a cada render
  _vcharts.forEach(c => { try { c.destroy(); } catch (_) {} }); _vcharts = [];   // limpa gráficos da tela anterior (v83.4)
  const tab = (id, lbl) => `<button class="btn ${_tab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-vtab="${id}">${lbl}</button>`;
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🧪 Métricas de Viabilidade</h2>
        <div class="flex" style="align-items:center;gap:4px;background:var(--bg-3);border-radius:8px;padding:2px;margin-left:6px">
          <button class="btn btn-ghost btn-sm" data-ano="${_ano - 1}" style="padding:4px 9px">◄</button>
          <span style="font-weight:800;min-width:52px;text-align:center">${_ano}</span>
          <button class="btn btn-ghost btn-sm" data-ano="${_ano + 1}" style="padding:4px 9px" ${_ano >= new Date().getFullYear() ? 'disabled' : ''}>►</button>
        </div>
        <span class="tiny muted" id="viab-msg" style="margin-left:auto">${esc(_msg)}</span>
      </div>
      <p class="card-sub">Orçado (plano) × Realizado (CRM + custo lançado) × Simulação — separados pra não confundir.</p>
      <div class="flex gap-1 mt-2" style="flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px">
        ${tab('resumo', '📊 Resumo')}
        ${tab('orcado', '📋 Orçado (mensal)')}
        ${tab('realizado', '📈 Realizado mês a mês')}
        ${tab('be', '🎯 Break-even')}
        ${tab('sim', '🧪 Simulador')}
      </div>
      <div id="viab-body" class="mt-3"></div>
    </div>`;
  _root.querySelectorAll('[data-vtab]').forEach(b => b.onclick = () => { _tab = b.dataset.vtab; render(); });
  _root.querySelectorAll('[data-ano]').forEach(b => { if (!b.disabled) b.onclick = () => { _ano = +b.dataset.ano; load(); }; });
  const body = document.getElementById('viab-body');
  if (_tab === 'resumo') { body.innerHTML = renderResumo(); wireResumo(); }
  else if (_tab === 'orcado') { body.innerHTML = renderOrcado(); wireOrcado(); }
  else if (_tab === 'realizado') { body.innerHTML = renderRealizado(); wireRealizado(); }
  else if (_tab === 'be') { body.innerHTML = renderBE(); wireBE(); }
  else { body.innerHTML = renderSim(); wireSim(); }
}
function flash(t) { _msg = t; const m = document.getElementById('viab-msg'); if (m) m.textContent = t; }

/* ════════════ ABA 1 · ORÇADO (mensal, editável) ════════════ */
function orcSubTabs() {
  const b = (id, lbl) => `<button class="btn ${_orcView === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-orcview="${id}">${lbl}</button>`;
  return `<div class="flex gap-1 mb-3" style="flex-wrap:wrap">${b('receita', '💰 Receita & metas')}${b('custos', '🧾 Custos detalhados')}</div>`;
}
function renderOrcado() {
  if (_orcView === 'custos') return orcSubTabs() + renderCustosDet();
  let consAno = 0;
  const blocks = LINHAS.map(l => {
    const prem = orcCell(l.id, 1);   // premissas (iguais em todos os meses; mes=0 salva bulk)
    let totLucro = 0, totVgv = 0, totCusto = 0;
    const cols = [];
    for (let m = 1; m <= 12; m++) {
      const o = orcCell(l.id, m);
      const custo = custoOrcLinhaMes(l.id, m);   // vem dos Custos detalhados
      const r = calc(o.vgv, o.vendas, o, custo);
      totLucro += r.lucro; totVgv += r.vgv; totCusto += r.custo;
      cols.push({ m, vgv: o.vgv || 0, vendas: o.vendas || 0, lucro: r.lucro });
    }
    consAno += totLucro;
    const inp = (m, f, v) => `<input class="input orc-cell" data-l="${l.id}" data-m="${m}" data-f="${f}" value="${v || ''}" style="width:74px;padding:3px 5px;font-size:11px;text-align:right">`;
    const premInp = PREM.map(([k, lbl]) => `<label class="tiny muted" style="display:flex;flex-direction:column;gap:1px">${lbl}<input class="input orc-prem" data-l="${l.id}" data-f="${k}" value="${prem[k] ?? ''}" style="width:96px;padding:3px 5px;font-size:11px;text-align:right"></label>`).join('');
    return `
      <div class="card" style="margin:0 0 12px;border-left:4px solid ${l.cor}">
        <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
          <b style="font-size:14px">${l.icon} ${l.nome}</b>
          <span class="tiny muted">VGV: <b>${fmt(totVgv)}</b> · custo: <b>${fmt(totCusto)}</b></span>
          <button class="btn btn-ghost btn-sm orc-copy" data-l="${l.id}" title="Replica o VGV e vendas do 1º mês preenchido nos 12 meses">⧉ replicar nos 12 meses</button>
          <span style="margin-left:auto;font-weight:800;color:${dc(totLucro)}">Lucro orçado ano: ${fmt(totLucro)}</span>
        </div>
        <div class="flex gap-2 mt-2" style="flex-wrap:wrap">${premInp}</div>
        <div style="overflow-x:auto;margin-top:8px"><table style="border-collapse:collapse;font-size:11px">
          <thead><tr><th style="text-align:left;padding:3px 6px;position:sticky;left:0;background:var(--bg-2)"></th>${MES.map(mn => `<th style="padding:3px 6px;text-align:right;color:var(--ink-muted)">${mn}</th>`).join('')}</tr></thead>
          <tbody>
            <tr><td style="padding:3px 6px;font-weight:700;position:sticky;left:0;background:var(--bg-2)">VGV</td>${cols.map(c => `<td style="padding:2px 4px">${inp(c.m, 'vgv', c.vgv)}</td>`).join('')}</tr>
            <tr><td style="padding:3px 6px;font-weight:700;position:sticky;left:0;background:var(--bg-2)">Vendas</td>${cols.map(c => `<td style="padding:2px 4px">${inp(c.m, 'vendas', c.vendas)}</td>`).join('')}</tr>
            <tr><td style="padding:3px 6px;font-weight:700;color:var(--ink-muted);position:sticky;left:0;background:var(--bg-2)">Lucro</td>${cols.map(c => `<td style="padding:3px 4px;text-align:right;font-weight:700;color:${dc(c.lucro)}">${fmtC(c.lucro)}</td>`).join('')}</tr>
          </tbody>
        </table></div>
      </div>`;
  }).join('');
  return orcSubTabs() + `
    <div class="alert" style="background:var(--bg-3);border:none;font-size:12px;margin-bottom:12px">📋 <b>Plano do ano</b> — edite VGV e Vendas por mês (sazonalidade) e as premissas de comissão. O <b>custo</b> vem da aba <b>Custos detalhados</b>. É o baseline que o Realizado compara.</div>
    ${blocks}
    <div class="card" style="margin:0;background:var(--psm-navy);color:#fff">
      <div class="flex items-center"><b style="font-size:15px">🏛 Consolidado — Lucro orçado do ano</b><span style="margin-left:auto;font-size:22px;font-weight:900;color:${consAno >= 0 ? '#4ade80' : '#f87171'}">${fmt(consAno)}</span></div>
    </div>`;
}
function wireOrcado() {
  document.querySelectorAll('[data-orcview]').forEach(b => b.onclick = () => { _orcView = b.dataset.orcview; render(); });
  if (_orcView === 'custos') { wireCustosDet(); return; }
  document.querySelectorAll('.orc-cell').forEach(el => el.onchange = () => saveOrc(el.dataset.l, +el.dataset.m, { [el.dataset.f]: num(el.value) }));
  document.querySelectorAll('.orc-prem').forEach(el => el.onchange = () => saveOrc(el.dataset.l, 0, { [el.dataset.f]: num(el.value) }));
  document.querySelectorAll('.orc-copy').forEach(b => b.onclick = () => {
    const l = b.dataset.l; let src = null;
    for (let m = 1; m <= 12; m++) { const o = orcCell(l, m); if ((o.vgv || 0) > 0 || (o.vendas || 0) > 0) { src = { vgv: o.vgv || 0, vendas: o.vendas || 0 }; break; } }
    if (!src) { flash('preencha o 1º mês antes de replicar'); return; }
    if (!confirm(`Replicar VGV ${fmt(src.vgv)} e ${src.vendas} venda(s) em TODOS os 12 meses desta linha?`)) return;
    saveOrc(l, 0, src);   // mes=0 aplica nos 12
  });
}
async function saveOrc(linha, mes, campos) {
  flash('💾 salvando…');
  try {
    const r = await api.request('/api/v3/diretoria/viab', { method: 'POST', body: { action: 'set_orcamento', ano: _ano, linha, mes, campos } });
    if (r && r.orcamento) _d.orcamento = r.orcamento;
    flash('✅ orçado salvo'); render();
  } catch (e) { flash('⚠️ ' + e.message); }
}

/* ── Orçado · Custos detalhados (v82.3) ── */
function itemAnual(it) {
  let tot = 0;
  for (let m = 1; m <= 12; m++) {
    if (it.classe === 'extra' && Array.isArray(it.meses) && it.meses.length && !it.meses.includes(m)) continue;
    const base = (it.por_mes && it.por_mes[m] != null && it.por_mes[m] !== '') ? +it.por_mes[m] : (+it.valor || 0);
    if (it.classe === 'variavel') { const p = base / 100; if (it.aloc !== 'compartilhado') tot += (orcCell(it.aloc, m).vgv || 0) * p; else for (const l of LIDS) tot += (orcCell(l, m).vgv || 0) * p; }
    else tot += base;
  }
  return tot;
}
function catsManagerHTML() {
  if (!_catsOpen) return `<div class="mb-2"><button class="btn btn-ghost btn-sm" id="cd-cats-toggle">⚙ Gerenciar categorias (${_cats.length})</button></div>`;
  const usada = c => (_custosOrc || []).filter(it => it.cat === c).length;
  const rows = _cats.map((c, i) => `<div class="flex gap-2 mb-1" style="align-items:center">
    <input class="input cat-ren" data-i="${i}" value="${esc(c)}" style="max-width:230px;font-size:12px;padding:3px 6px">
    <span class="tiny muted">${usada(c)} item(ns)</span>
    ${c === 'Outros' ? '' : `<button class="btn btn-ghost btn-sm cat-del" data-i="${i}" style="padding:1px 7px;color:#dc2626" title="Apagar (itens vão pra Outros)">🗑</button>`}
  </div>`).join('');
  return `<div class="card" style="margin:0 0 10px;background:var(--bg-3)">
    <div class="flex items-center"><b style="font-size:13px">⚙ Categorias de custo</b><button class="btn btn-ghost btn-sm" id="cd-cats-toggle" style="margin-left:auto">fechar</button></div>
    <div class="tiny muted" style="margin:2px 0 8px">Renomeie (atualiza os itens que a usam), apague (manda pra "Outros") ou crie nova — ex.: separar <b>"Retirada de sócio"</b> do custo operacional. Salva na hora.</div>
    ${rows}
    <div class="flex gap-2 mt-2"><input id="cat-nova" class="input" placeholder="nova categoria (ex.: Retirada de sócio)" style="max-width:250px;font-size:12px"><button class="btn btn-primary btn-sm" id="cat-add">＋ adicionar</button></div>
  </div>`;
}
function renderCustosDet() {
  const det = custoOrcadoDet();
  const detST = custoOrcadoDet(true);   // sem tráfego pago (v82.8)
  const totEmp = {}, totEmpST = {}; let grand = 0;
  LIDS.forEach(l => { totEmp[l] = 0; totEmpST[l] = 0; for (let m = 1; m <= 12; m++) { totEmp[l] += det[l][m]; totEmpST[l] += detST[l][m]; } grand += totEmp[l]; });
  const porClasse = { fixo: 0, variavel: 0, extra: 0 };
  (_custosOrc || []).forEach(it => porClasse[it.classe] = (porClasse[it.classe] || 0) + itemAnual(it));
  const opt = (arr, v) => arr.map(([val, lbl]) => `<option value="${val}"${val === v ? ' selected' : ''}>${esc(lbl)}</option>`).join('');
  const empChips = LINHAS.map(l => `<div style="flex:1;min-width:130px;background:var(--bg-3);border-radius:8px;padding:8px 10px"><div class="tiny muted">${l.icon} ${l.nome}</div><div style="font-weight:800;color:${l.cor}">${fmt(totEmp[l.id])}<span class="tiny muted" style="font-weight:400">/ano</span></div><div class="tiny muted">${fmt(totEmpST[l.id] / 12)}/mês <b>sem tráfego</b></div></div>`).join('');
  const rows = (_custosOrc || []).map((it, i) => {
    const comp = it.aloc === 'compartilhado';
    const rateioSel = comp ? `<select class="select cd-f" data-i="${i}" data-k="rateio" style="font-size:11px;padding:2px;max-width:118px">${opt(RATEIOS, it.rateio)}</select>` : '<span class="tiny muted">direto</span>';
    let detalhe = '';
    if (comp && it.rateio === 'especifico') detalhe = `<div class="flex gap-1" style="flex-wrap:wrap;margin-top:3px">${LINHAS.map(l => `<label class="tiny" style="display:inline-flex;gap:2px;align-items:center"><input type="checkbox" class="cd-esp" data-i="${i}" value="${l.id}"${(it.linhas || []).includes(l.id) ? ' checked' : ''}>${l.id}</label>`).join('')}</div>`;
    if (comp && it.rateio === 'manual') detalhe = `<div class="flex gap-1" style="flex-wrap:wrap;margin-top:3px">${LINHAS.map(l => `<label class="tiny" style="display:inline-flex;flex-direction:column;align-items:center">${l.id}<input class="input cd-man" data-i="${i}" data-l="${l.id}" value="${(it.pesos || {})[l.id] ?? ''}" style="width:44px;padding:1px 3px;font-size:10px" placeholder="%"></label>`).join('')}</div>`;
    const mesesCell = it.classe === 'extra' ? `<input class="input cd-f" data-i="${i}" data-k="meses" value="${Array.isArray(it.meses) ? it.meses.join(',') : ''}" placeholder="todos" title="ex: 1,6,12" style="width:66px;padding:2px 4px;font-size:11px">` : '<span class="tiny muted">todos</span>';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:3px 5px"><input class="input cd-f" data-i="${i}" data-k="desc" value="${esc(it.desc)}" style="width:100%;min-width:120px;padding:2px 5px;font-size:12px"></td>
      <td style="padding:3px 5px"><select class="select cd-f" data-i="${i}" data-k="cat" style="font-size:11px;padding:2px">${opt(_cats.map(c => [c, c]), it.cat)}</select></td>
      <td style="padding:3px 5px"><select class="select cd-f" data-i="${i}" data-k="classe" style="font-size:11px;padding:2px">${opt(CLASSES, it.classe)}</select></td>
      <td style="padding:3px 5px"><select class="select cd-f" data-i="${i}" data-k="aloc" style="font-size:11px;padding:2px">${opt(ALOCS, it.aloc)}</select></td>
      <td style="padding:3px 5px">${rateioSel}${detalhe}</td>
      <td style="padding:3px 5px;white-space:nowrap"><input class="input cd-f" data-i="${i}" data-k="valor" value="${it.valor ?? ''}" style="width:78px;padding:2px 5px;font-size:12px;text-align:right"> <span class="tiny muted">${it.classe === 'variavel' ? '% VGV' : 'R$'}</span></td>
      <td style="padding:3px 5px">${mesesCell}</td>
      <td style="padding:3px 5px"><button class="btn btn-ghost btn-sm cd-del" data-i="${i}" style="padding:1px 6px;color:#dc2626">🗑</button></td>
    </tr>`;
  }).join('');
  return `
    <div class="alert" style="background:var(--bg-3);border:none;font-size:12px;margin-bottom:10px">🧾 <b>Custos orçados detalhados</b> — fixos, variáveis (% do VGV) e extras, por empresa. Compartilhados rateiam (igual/proporcional/específico/manual). Pré-carregado com seus custos reais — ajuste e <b>salve</b>. Alimenta o lucro orçado.</div>
    <div class="flex gap-2 mb-2" style="flex-wrap:wrap;align-items:center;background:#7c3aed12;border:1px solid #7c3aed33;border-radius:8px;padding:8px 10px">
      <span class="tiny" style="font-weight:800;color:#7c3aed">⚖️ Quem rateia o overhead (Igual/Proporcional):</span>
      ${LINHAS.map(l => `<label class="tiny" style="display:inline-flex;gap:4px;align-items:center;font-weight:600;cursor:pointer"><input type="checkbox" class="re-emp" value="${l.id}"${ratEmp().includes(l.id) ? ' checked' : ''}>${l.icon} ${l.nome}</label>`).join('')}
      <span class="tiny muted">desmarque quem não divide a estrutura (ex.: Terceiros). Salva na hora.</span>
    </div>
    <div class="flex gap-2 mb-2" style="flex-wrap:wrap">${empChips}
      <div style="flex:1;min-width:150px;background:var(--psm-navy);color:#fff;border-radius:8px;padding:8px 10px"><div class="tiny" style="opacity:.8">Total custos/ano</div><div style="font-weight:800;font-size:16px">${fmt(grand)}</div><div class="tiny" style="opacity:.85">Fixo ${fmtC(porClasse.fixo)} · Var ${fmtC(porClasse.variavel)} · Extra ${fmtC(porClasse.extra)}</div></div>
    </div>
    ${catsManagerHTML()}
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:840px">
      <thead><tr style="background:var(--bg-3);text-align:left"><th style="padding:5px">Descrição</th><th style="padding:5px">Categoria</th><th style="padding:5px">Classe</th><th style="padding:5px">Empresa</th><th style="padding:5px">Rateio</th><th style="padding:5px">Valor</th><th style="padding:5px">Meses</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="tiny muted" style="padding:12px;text-align:center">Nenhum custo — clique em "adicionar custo".</td></tr>'}</tbody>
    </table></div>
    <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="cd-add">＋ adicionar custo</button>
      <button class="btn btn-primary btn-sm" id="cd-save">💾 Salvar custos orçados</button>
      <span class="tiny muted" style="align-self:center">${(_custosOrc || []).length} itens · variável calcula sobre o VGV orçado do mês</span>
    </div>`;
}
function wireCustosDet() {
  document.querySelectorAll('.cd-f').forEach(el => el.onchange = () => {
    const it = _custosOrc[+el.dataset.i]; if (!it) return; const k = el.dataset.k;
    if (k === 'valor') it.valor = num(el.value);
    else if (k === 'meses') it.meses = el.value.trim() ? el.value.split(',').map(x => parseInt(x.trim())).filter(x => x >= 1 && x <= 12) : null;
    else it[k] = el.value;
    render();
  });
  document.querySelectorAll('.cd-esp').forEach(el => el.onchange = () => {
    const it = _custosOrc[+el.dataset.i]; if (!it) return; it.linhas = it.linhas || [];
    if (el.checked) { if (!it.linhas.includes(el.value)) it.linhas.push(el.value); } else it.linhas = it.linhas.filter(x => x !== el.value);
    render();
  });
  document.querySelectorAll('.cd-man').forEach(el => el.onchange = () => {
    const it = _custosOrc[+el.dataset.i]; if (!it) return; it.pesos = it.pesos || {}; it.pesos[el.dataset.l] = num(el.value); render();
  });
  document.querySelectorAll('.re-emp').forEach(el => el.onchange = () => {
    let e = (_rateioEmp || []).slice();
    if (el.checked) { if (!e.includes(el.value)) e.push(el.value); } else e = e.filter(x => x !== el.value);
    if (!e.length) { flash('deixe ao menos 1 empresa no rateio'); render(); return; }
    _rateioEmp = e; saveCustosOrc();   // salva na hora (itens + config de rateio)
  });
  document.querySelectorAll('.cd-del').forEach(b => b.onclick = () => { _custosOrc.splice(+b.dataset.i, 1); render(); });
  const add = document.getElementById('cd-add');
  if (add) add.onclick = () => { _custosOrc.push({ id: 'co_' + Date.now(), desc: '', cat: 'Outros', classe: 'fixo', aloc: 'compartilhado', rateio: 'igual', valor: 0, meses: null, linhas: [], pesos: null, por_mes: null }); render(); };
  const save = document.getElementById('cd-save'); if (save) save.onclick = saveCustosOrc;
  // ── gerenciador de categorias (v83.2) ──
  const tog = document.getElementById('cd-cats-toggle'); if (tog) tog.onclick = () => { _catsOpen = !_catsOpen; render(); };
  document.querySelectorAll('.cat-ren').forEach(el => el.onchange = () => {
    const i = +el.dataset.i, old = _cats[i], nv = el.value.trim();
    if (!nv) { el.value = old; return; }
    if (_cats.some((c, j) => j !== i && c.toLowerCase() === nv.toLowerCase())) { flash('já existe uma categoria com esse nome'); el.value = old; return; }
    (_custosOrc || []).forEach(it => { if (it.cat === old) it.cat = nv; });   // renomeia nos itens
    _cats[i] = nv; saveCustosOrc();
  });
  document.querySelectorAll('.cat-del').forEach(b => b.onclick = () => {
    const i = +b.dataset.i, c = _cats[i];
    if (!confirm(`Apagar a categoria "${c}"? Os itens dela vão pra "Outros".`)) return;
    (_custosOrc || []).forEach(it => { if (it.cat === c) it.cat = 'Outros'; });
    _cats.splice(i, 1); if (!_cats.includes('Outros')) _cats.push('Outros'); saveCustosOrc();
  });
  const cadd = document.getElementById('cat-add'); if (cadd) cadd.onclick = () => {
    const nv = (document.getElementById('cat-nova').value || '').trim();
    if (!nv) return; if (_cats.some(c => c.toLowerCase() === nv.toLowerCase())) { flash('já existe'); return; }
    _cats.push(nv); saveCustosOrc();
  };
}
// re-semeia SÓ o custo derivado no Simulador e no Break-even quando custos/rateio mudam, preservando o resto (v83.6)
function reseedCustosSandbox() {
  _custoDetMemo = null;   // força recomputar com o rateio/custos novos
  if (_sim) {
    const det = custoOrcadoDet(true);
    for (const l of LIDS) { let c = 0; for (let m = 1; m <= 12; m++) c += det[l][m]; if (_sim[l]) _sim[l].custo_fixo = Math.round(c / 12); }
  }
  if (_be) {
    const det = custoOrcadoDet(); let fixo = 0; LIDS.forEach(l => { for (let m = 1; m <= 12; m++) fixo += det[l][m]; });
    _be.fixo = Math.round(fixo / 12); _be.proLabore = proLaboreMes();
  }
}
async function saveCustosOrc() {
  flash('💾 salvando custos…');
  try {
    const r = await api.request('/api/v3/diretoria/viab', { method: 'POST', body: { action: 'set_custos_orcado', ano: _ano, itens: _custosOrc, rateio_empresas: ratEmp(), categorias: _cats } });
    if (r && r.custos_orcado && Array.isArray(r.custos_orcado.itens)) _custosOrc = r.custos_orcado.itens.map(x => ({ ...x }));
    if (r && r.custos_orcado && Array.isArray(r.custos_orcado.rateio_empresas)) _rateioEmp = r.custos_orcado.rateio_empresas.slice();
    if (r && r.custos_orcado && Array.isArray(r.custos_orcado.categorias)) _cats = r.custos_orcado.categorias.slice();
    if (!_cats.includes('Outros')) _cats.push('Outros');
    reseedCustosSandbox();   // reflete a mudança no Simulador e Break-even na hora (v83.6)
    flash('✅ custos orçados salvos'); render();
  } catch (e) { flash('⚠️ ' + e.message); }
}

/* ════════════ ABA 2 · REALIZADO MÊS A MÊS ════════════ */
function aggRange(fonte, ini, fim) {
  // soma consolidada por período. fonte: 'orc' | 'real'
  const acc = { vgv: 0, vendas: 0, lucro: 0, receita: 0, custo: 0 };
  const porLinha = {}; LIDS.forEach(id => porLinha[id] = { vgv: 0, vendas: 0, lucro: 0 });
  for (let m = ini; m <= fim; m++) {
    const custos = custoRealMes(m);
    for (const l of LIDS) {
      const o = orcCell(l, m);
      let vgv, vendas, custo, oCalc;
      if (fonte === 'orc') { vgv = o.vgv || 0; vendas = o.vendas || 0; custo = custoOrcLinhaMes(l, m); oCalc = o; }
      else { const rc = realCell(l, m); vgv = rc.vgv; vendas = rc.vendas; custo = custos[l] || 0; oCalc = orcReal(l, m); }
      const r = calc(vgv, vendas, oCalc, custo);
      porLinha[l].vgv += r.vgv; porLinha[l].vendas += r.vendas; porLinha[l].lucro += r.lucro;
      acc.vgv += r.vgv; acc.vendas += r.vendas; acc.lucro += r.lucro; acc.receita += r.receita; acc.custo += r.custo;
    }
  }
  acc.margem = acc.vgv ? acc.lucro / acc.vgv * 100 : 0;
  return { acc, porLinha };
}
function renderRealizado() {
  const O = aggRange('orc', _pIni, _pFim), R = aggRange('real', _pIni, _pFim);
  const dVgv = R.acc.vgv - O.acc.vgv, dLucro = R.acc.lucro - O.acc.lucro;
  const kpi = (lbl, orc, real, isMoney) => {
    const d = real - orc; const f = isMoney ? fmtC : (v => pct(v));
    return `<div style="flex:1;min-width:170px;background:var(--bg-3);border-radius:10px;padding:12px 14px">
      <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px;font-weight:700">${lbl}</div>
      <div style="font-size:19px;font-weight:900;margin:2px 0">${isMoney ? fmtC(real) : pct(real)}</div>
      <div class="tiny">orçado ${isMoney ? fmtC(orc) : pct(orc)} · <b style="color:${dc(d)}">${d >= 0 ? '▲' : '▼'} ${isMoney ? fmtC(Math.abs(d)) : pct(Math.abs(d))}</b></div>
    </div>`;
  };
  const selMes = (id, val) => `<select id="${id}" class="select" style="max-width:110px">${MES.map((mn, i) => `<option value="${i + 1}"${i + 1 === val ? ' selected' : ''}>${mn}</option>`).join('')}</select>`;
  // linha a linha
  const rows = LINHAS.map(l => {
    const o = O.porLinha[l.id], r = R.porLinha[l.id];
    const dv = r.vgv - o.vgv, dl = r.lucro - o.lucro;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:7px 8px"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${l.cor};margin-right:6px"></span>${l.nome}</td>
      <td style="padding:7px 8px;text-align:right">${fmtC(o.vgv)}</td>
      <td style="padding:7px 8px;text-align:right;font-weight:700">${fmtC(r.vgv)}</td>
      <td style="padding:7px 8px;text-align:right;color:${dc(dv)}">${dv >= 0 ? '▲' : '▼'} ${fmtC(Math.abs(dv))}</td>
      <td style="padding:7px 8px;text-align:right">${fmtC(o.lucro)}</td>
      <td style="padding:7px 8px;text-align:right;font-weight:700;color:${dc(r.lucro)}">${fmtC(r.lucro)}</td>
      <td style="padding:7px 8px;text-align:right;color:${dc(dl)}">${dl >= 0 ? '▲' : '▼'} ${fmtC(Math.abs(dl))}</td>
    </tr>`;
  }).join('');
  // mês a mês (consolidado realizado) + séries pro gráfico (v83.4)
  const mm = [], chLbl = [], chVgvR = [], chVgvO = [], chLucroR = [];
  for (let m = _pIni; m <= _pFim; m++) {
    const custos = custoRealMes(m); let vgv = 0, lucro = 0, custo = 0;
    for (const l of LIDS) { const rc = realCell(l, m); const r = calc(rc.vgv, rc.vendas, orcReal(l, m), custos[l] || 0); vgv += r.vgv; lucro += r.lucro; custo += r.custo; }
    let vgvO = 0; for (const l of LIDS) { const o = orcCell(l, m); const ro = calc(o.vgv || 0, o.vendas || 0, o, custoOrcLinhaMes(l, m)); vgvO += ro.vgv; }
    chLbl.push(MES[m - 1]); chVgvR.push(Math.round(vgv)); chVgvO.push(Math.round(vgvO)); chLucroR.push(Math.round(lucro));
    const fechado = !!(_d.snapshots || {})[`${_ano}-${m}`];
    mm.push(`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px;font-weight:600">${MES[m - 1]}${fechado ? ' <span class="tiny" style="color:#16a34a">🔒 fechado</span>' : ''}</td>
      <td style="padding:6px 8px;text-align:right">${fmtC(vgv)}</td>
      <td style="padding:6px 8px;text-align:right">${fmtC(custo)}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;color:${dc(lucro)}">${fmtC(lucro)}</td>
      <td style="padding:6px 8px;text-align:right">${fechado ? `<button class="btn btn-ghost btn-sm" data-reabrir="${m}" style="padding:2px 7px">reabrir</button>` : `<button class="btn btn-ghost btn-sm" data-fechar="${m}" style="padding:2px 7px">🔒 fechar</button>`}</td>
    </tr>`);
  }
  _rSeries = { lbl: chLbl, vgvR: chVgvR, vgvO: chVgvO, lucroR: chLucroR };
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:end;background:var(--bg-3);padding:10px 12px;border-radius:10px;margin-bottom:12px">
      <label class="tiny muted" style="display:flex;flex-direction:column;gap:2px">De ${selMes('per-ini', _pIni)}</label>
      <label class="tiny muted" style="display:flex;flex-direction:column;gap:2px">até ${selMes('per-fim', _pFim)}</label>
      <span class="badge" style="background:var(--psm-navy);color:#fff;font-weight:700">${MES[_pIni - 1]}–${MES[_pFim - 1]}/${_ano}</span>
      <span class="tiny muted" style="margin-left:auto">VGV/vendas = CRM real · custo = Meta real (auto) + lançado à mão</span>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpi('VGV', O.acc.vgv, R.acc.vgv, true)}
      ${kpi('Lucro', O.acc.lucro, R.acc.lucro, true)}
      ${kpi('Margem', O.acc.margem, R.acc.margem, false)}
    </div>
    <div class="card" style="margin:0 0 14px">
      <h3 class="card-title">📊 VGV orçado × realizado por mês <span class="tiny muted" style="font-weight:400">· lucro realizado na linha</span></h3>
      <div id="viab-real-chart-wrap" style="height:260px;position:relative"><canvas id="viab-real-chart"></canvas></div>
      <div class="tiny muted mt-1">Barras = VGV (claro = orçado, cheio = realizado). Linha verde = lucro realizado. Vê num relance onde o mês bateu ou furou a meta.</div>
    </div>
    <div class="card" style="margin:0 0 14px">
      <h3 class="card-title">Orçado × Realizado por linha <span class="tiny muted" style="font-weight:400">· ${MES[_pIni - 1]}–${MES[_pFim - 1]}</span></h3>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
        <thead><tr style="background:var(--bg-3);text-align:right"><th style="text-align:left;padding:7px 8px">Linha</th><th style="padding:7px 8px">VGV orç.</th><th style="padding:7px 8px">VGV real</th><th style="padding:7px 8px">Δ</th><th style="padding:7px 8px">Lucro orç.</th><th style="padding:7px 8px">Lucro real</th><th style="padding:7px 8px">Δ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="tiny muted mt-2">⚠️ Comissões do realizado são <b>calculadas pela premissa do orçado</b> (% do VGV real), não "pagas" — até plugar a API do NIBO.</div>
    </div>
    <div class="card" style="margin:0 0 14px">
      <h3 class="card-title">📅 Mês a mês (realizado) + fechamento</h3>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px">
        <thead><tr style="background:var(--bg-3);text-align:right"><th style="text-align:left;padding:6px 8px">Mês</th><th style="padding:6px 8px">VGV real</th><th style="padding:6px 8px">Custo</th><th style="padding:6px 8px">Lucro</th><th style="padding:6px 8px"></th></tr></thead>
        <tbody>${mm.join('')}</tbody>
      </table></div>
      <div class="tiny muted mt-2">Fechar = congela o mês num snapshot (o cron fecha sozinho todo dia 1º; você pode fechar/reabrir manual). Snapshot não muda se o CRM mudar depois.</div>
    </div>
    ${renderCustosReais()}`;
}
function renderCustosReais() {
  const cell = (_d.custos_real || {})[`${_ano}-${_custoMes}`] || {}; const itens = cell.itens || [];
  const selMes = MES.map((mn, i) => `<option value="${i + 1}"${i + 1 === _custoMes ? ' selected' : ''}>${mn}</option>`).join('');
  const selLinha = (v) => `<option value=""${!v ? ' selected' : ''}>Geral (rateia)</option>` + LINHAS.map(l => `<option value="${l.id}"${l.id === v ? ' selected' : ''}>${l.nome}</option>`).join('');
  const rows = itens.map((it, i) => `<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:4px 6px"><input class="input cr-desc" data-i="${i}" value="${esc(it.desc || '')}" style="width:100%;padding:3px 6px;font-size:12px"></td>
    <td style="padding:4px 6px"><input class="input cr-val" data-i="${i}" value="${it.valor || ''}" style="width:110px;padding:3px 6px;font-size:12px;text-align:right"></td>
    <td style="padding:4px 6px"><select class="select cr-linha" data-i="${i}" style="font-size:12px;padding:3px">${selLinha(it.linha)}</select></td>
    <td style="padding:4px 6px"><button class="btn btn-ghost btn-sm cr-del" data-i="${i}" style="padding:2px 7px;color:#dc2626">🗑</button></td>
  </tr>`).join('');
  const manual = itens.reduce((s, it) => s + (+it.valor || 0), 0);
  const a = autoMes(_custoMes); const totalAuto = a.meta_mkt + a.nibo_fixo; const total = manual + totalAuto;
  return `
    <div class="card" style="margin:0">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h3 class="card-title" style="margin:0">🧾 Custos realizados do mês</h3>
        <label class="tiny muted" style="margin-left:8px">mês <select id="cr-mes" class="select" style="max-width:110px">${selMes}</select></label>
        <span style="margin-left:auto;font-weight:800">Total: ${fmt(total)}</span>
      </div>
      <div style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:8px 10px">
        <div class="tiny" style="font-weight:700;margin-bottom:4px">🔌 Fontes automáticas <span class="muted" style="font-weight:400">— entram sozinhas, sem digitar</span></div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <span class="tiny">📣 Meta Ads (verba real): <b>${fmt(a.meta_mkt)}</b> ${a.meta_mkt > 0 ? '<span style="color:#16a34a">✅ ao vivo</span>' : '<span class="muted">sem dado</span>'}</span>
          <span class="tiny">🏦 NIBO (custo fixo): <b>${fmt(a.nibo_fixo)}</b> ${a.nibo_fixo > 0 ? '<span style="color:#16a34a">✅</span>' : '<span style="color:#d97706">⏳ aguardando upgrade da API</span>'}</span>
          <span class="tiny muted" style="margin-left:auto">+ manual abaixo: <b>${fmt(manual)}</b></span>
        </div>
      </div>
      <div class="tiny muted" style="margin-top:8px">Lançamentos manuais (complementam as fontes automáticas):</div>
      <div style="overflow-x:auto;margin-top:4px"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:480px">
        <thead><tr style="background:var(--bg-3);text-align:left"><th style="padding:5px 6px">Descrição</th><th style="padding:5px 6px;text-align:right">Valor</th><th style="padding:5px 6px">Linha</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="tiny muted" style="padding:10px;text-align:center">Sem lançamentos nesse mês.</td></tr>'}</tbody>
      </table></div>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" id="cr-add">＋ Lançar custo</button>
        <button class="btn btn-primary btn-sm" id="cr-save">💾 Salvar custos do mês</button>
      </div>
      <div class="tiny muted mt-2">Quando você fizer o upgrade da API do NIBO, troco esse lançamento manual pelo custo real automático.</div>
    </div>`;
}
function wireRealizado() {
  const pi = document.getElementById('per-ini'), pf = document.getElementById('per-fim');
  if (pi) pi.onchange = () => { _pIni = +pi.value; if (_pIni > _pFim) _pFim = _pIni; render(); };
  if (pf) pf.onchange = () => { _pFim = +pf.value; if (_pFim < _pIni) _pIni = _pFim; render(); };
  // gráfico VGV orçado × realizado + lucro (v83.4)
  if (_rSeries && document.getElementById('viab-real-chart')) {
    const s = _rSeries;
    mkChart('viab-real-chart', {
      type: 'bar',
      data: { labels: s.lbl, datasets: [
        { type: 'bar', label: 'VGV orçado', data: s.vgvO, backgroundColor: 'rgba(37,99,235,0.30)', borderRadius: 3, order: 3 },
        { type: 'bar', label: 'VGV realizado', data: s.vgvR, backgroundColor: '#2563eb', borderRadius: 3, order: 2 },
        { type: 'line', label: 'Lucro realizado', data: s.lucroR, borderColor: '#16a34a', backgroundColor: '#16a34a', tension: 0.3, borderWidth: 2, pointRadius: 3, yAxisID: 'y1', order: 1 },
      ] },
      options: darkOpts({
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: DARK_INK, font: { size: 10 }, boxWidth: 12 } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtC(c.parsed.y)}` } } },
        scales: {
          x: { ticks: { color: DARK_INK, font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: DARK_INK, font: { size: 9 }, callback: v => fmtC(v) }, grid: { color: DARK_GRID } },
          y1: { position: 'right', ticks: { color: '#16a34a', font: { size: 9 }, callback: v => fmtC(v) }, grid: { display: false } },
        },
      }),
    });
  }
  document.querySelectorAll('[data-fechar]').forEach(b => b.onclick = () => fecharMes(+b.dataset.fechar));
  document.querySelectorAll('[data-reabrir]').forEach(b => b.onclick = () => reabrirMes(+b.dataset.reabrir));
  const cm = document.getElementById('cr-mes'); if (cm) cm.onchange = () => { _custoMes = +cm.value; render(); };
  const add = document.getElementById('cr-add'); if (add) add.onclick = () => { const k = `${_ano}-${_custoMes}`; _d.custos_real = _d.custos_real || {}; (_d.custos_real[k] = _d.custos_real[k] || { itens: [] }).itens.push({ desc: '', valor: 0, linha: '' }); render(); };
  document.querySelectorAll('.cr-del').forEach(b => b.onclick = () => { const k = `${_ano}-${_custoMes}`; _d.custos_real[k].itens.splice(+b.dataset.i, 1); render(); });
  const bind = (cls, f) => document.querySelectorAll(cls).forEach(el => el.onchange = () => { const k = `${_ano}-${_custoMes}`; _d.custos_real[k].itens[+el.dataset.i][f] = f === 'valor' ? num(el.value) : el.value; });
  bind('.cr-desc', 'desc'); bind('.cr-val', 'valor'); bind('.cr-linha', 'linha');
  const save = document.getElementById('cr-save'); if (save) save.onclick = saveCustos;
}
async function saveCustos() {
  const itens = ((_d.custos_real || {})[`${_ano}-${_custoMes}`] || {}).itens || [];
  flash('💾 salvando custos…');
  try { const r = await api.request('/api/v3/diretoria/viab', { method: 'POST', body: { action: 'set_custo_real', ano: _ano, mes: _custoMes, itens } }); if (r && r.custos_real) _d.custos_real = r.custos_real; flash('✅ custos salvos'); render(); }
  catch (e) { flash('⚠️ ' + e.message); }
}
async function fecharMes(m) {
  if (!confirm(`Fechar ${MES[m - 1]}/${_ano}? Congela o realizado num snapshot.`)) return;
  flash('🔒 fechando…');
  try { const r = await api.request('/api/v3/diretoria/viab', { method: 'POST', body: { action: 'fechar_mes', ano: _ano, mes: m } }); if (r && r.snapshot) { _d.snapshots = _d.snapshots || {}; _d.snapshots[`${_ano}-${m}`] = r.snapshot; } flash('✅ mês fechado'); render(); }
  catch (e) { flash('⚠️ ' + e.message); }
}
async function reabrirMes(m) {
  if (!confirm(`Reabrir ${MES[m - 1]}/${_ano}? Remove o snapshot.`)) return;
  try { await api.request('/api/v3/diretoria/viab', { method: 'POST', body: { action: 'reabrir_mes', ano: _ano, mes: m } }); if (_d.snapshots) delete _d.snapshots[`${_ano}-${m}`]; flash('mês reaberto'); render(); }
  catch (e) { flash('⚠️ ' + e.message); }
}

/* ════════════ ABA 3 · SIMULADOR (sandbox) ════════════ */
const SIMKEY = 'psm_viab_sim_cenarios';
function simSeed() {
  const mes = Math.max(1, new Date().getMonth() + 1); const o = {};
  const det = custoOrcadoDet(true);   // custo real por empresa/mês, SEM tráfego (v82.8) — semeia o custo do sim
  for (const l of LIDS) {
    const c = orcCell(l, mes);
    let custoMes = 0; for (let m = 1; m <= 12; m++) custoMes += det[l][m]; custoMes = Math.round(custoMes / 12);
    o[l] = { vgv: c.vgv || 0, vendas: c.vendas || 0, com_bruta_pct: c.com_bruta_pct, com_corretor_pct: c.com_corretor_pct, com_corretor_sobre_com_pct: c.com_corretor_sobre_com_pct || (l === 'terceiros' ? 50 : 0), com_senior_pct: c.com_senior_pct, com_gerente_pct: c.com_gerente_pct || 0, aliquota_pct: c.aliquota_pct, custo_fixo: custoMes, verba_mkt: c.verba_mkt || 0 };
    if (l === 'locacoes') o[l].admRec = 0;   // adm recorrente/mês que entra no caixa (v83.3)
  }
  return o;
}
function renderSim() {
  if (!_sim) _sim = simSeed();
  let cons = 0;
  const cenarios = JSON.parse(localStorage.getItem(SIMKEY) || '{}');
  const blocks = LINHAS.map(l => {
    const s = _sim[l.id]; const r = calc(s.vgv, s.vendas, s, s.custo_fixo);
    // Locação: adm recorrente que entra no caixa/mês (líquida de imposto). v83.3
    const isLoc = l.id === 'locacoes';
    const admLiq = isLoc ? (+s.admRec || 0) * (1 - (+s.aliquota_pct || 0) / 100) : 0;
    const lucroTot = r.lucro + admLiq;
    cons += lucroTot;
    const fld = (f, lbl) => `<label class="tiny muted" style="display:flex;flex-direction:column;gap:1px">${lbl}<input class="input sim-in" data-l="${l.id}" data-f="${f}" value="${s[f] ?? ''}" style="width:96px;padding:3px 5px;font-size:11px;text-align:right"></label>`;
    return `<div class="card" style="margin:0 0 10px;border-left:4px solid ${l.cor}">
      <div class="flex items-center"><b>${l.icon} ${l.nome}</b><span style="margin-left:auto;font-weight:800;color:${dc(lucroTot)}">Resultado/mês: ${fmt(lucroTot)}</span></div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        ${fld('vgv', isLoc ? '1º aluguel/mês' : 'VGV/mês')}${fld('vendas', isLoc ? 'Captações' : 'Vendas')}${fld('com_bruta_pct', 'Com. bruta % (s/ VGV)')}${fld('com_corretor_pct', 'Corretor % s/ VGV')}${fld('com_corretor_sobre_com_pct', 'Corretor % s/ comissão')}${fld('com_senior_pct', 'Sênior % s/ VGV')}${fld('com_gerente_pct', 'Gerente % s/ VGV')}${fld('aliquota_pct', 'Imposto % (s/ comissão)')}${fld('custo_fixo', 'Custo/mês (s/ tráfego)')}${fld('verba_mkt', '📣 Tráfego pago/mês')}${isLoc ? fld('admRec', '🔑 Adm recorrente/mês R$') : ''}
      </div>
      <div class="tiny muted mt-1">Receita ${fmtC(r.receita)} · corretor s/VGV ${fmtC(r.cc)} · corretor s/com. ${fmtC(r.ccCom)} · sênior ${fmtC(r.cs)} · gerente ${fmtC(r.cg)} · imposto ${fmtC(r.imp)} · custo ${fmtC(r.custo)}${isLoc ? ` · <b style="color:#16a34a">adm recorrente +${fmtC(admLiq)}/mês (líq. imposto)</b>` : ''} · margem <b style="color:${dc(r.margem)}">${pct(r.margem)}</b></div>
    </div>`;
  }).join('');
  const opts = Object.keys(cenarios).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const detST = custoOrcadoDet(true);
  const custoRef = LINHAS.map(l => { let c = 0; for (let m = 1; m <= 12; m++) c += detST[l.id][m]; return `<span class="tiny">${l.icon} <b style="color:${l.cor}">${fmt(c / 12)}</b></span>`; }).join(' · ');
  return `
    <div class="alert" style="background:var(--bg-3);border:none;font-size:12px;margin-bottom:10px">🧪 <b>Sandbox</b> — mexa à vontade. Não afeta o orçado nem o realizado. Salve cenários e compare.<br><span class="tiny muted">Modelo completo por frente: <b>comissão bruta</b> (% s/ VGV) → <b>corretor</b> pode ser % s/ VGV <b>e/ou</b> % s/ a comissão (ex.: Terceiros 40%+10% da comissão = 50%) → <b>sênior</b> e <b>gerente</b> (% s/ VGV) → <b>imposto</b> (% s/ a comissão) → <b>custo fixo</b> + <b>tráfego pago</b>.</span></div>
    <div class="flex gap-2 mb-2" style="flex-wrap:wrap;align-items:center;background:var(--bg-3);border-radius:8px;padding:7px 10px">
      <span class="tiny" style="font-weight:700">💰 Custo real por empresa/mês (fixo+var, <b>sem tráfego</b>):</span> ${custoRef}
      <span class="tiny muted" style="margin-left:auto">o "Custo/mês" de cada card já vem semeado com esse valor</span>
    </div>
    ${blocks}
    <div class="card" style="margin:0 0 10px;background:var(--psm-navy);color:#fff">
      <div class="flex items-center"><b style="font-size:15px">Lucro simulado/mês (consolidado)</b><span style="margin-left:auto;font-size:22px;font-weight:900;color:${cons >= 0 ? '#4ade80' : '#f87171'}">${fmt(cons)}</span></div>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
      <input id="sim-nome" class="input" placeholder="nome do cenário" style="max-width:200px">
      <button class="btn btn-primary btn-sm" id="sim-save">💾 Salvar cenário</button>
      ${opts ? `<select id="sim-load" class="select" style="max-width:200px"><option value="">carregar cenário…</option>${opts}</select>` : ''}
      <button class="btn btn-ghost btn-sm" id="sim-reset">↩ Resetar pro orçado</button>
    </div>`;
}
function wireSim() {
  document.querySelectorAll('.sim-in').forEach(el => el.onchange = () => { _sim[el.dataset.l][el.dataset.f] = num(el.value); render(); });
  const save = document.getElementById('sim-save'); if (save) save.onclick = () => {
    const nome = (document.getElementById('sim-nome').value || '').trim(); if (!nome) return flash('dê um nome ao cenário');
    const c = JSON.parse(localStorage.getItem(SIMKEY) || '{}'); c[nome] = _sim; localStorage.setItem(SIMKEY, JSON.stringify(c)); flash('✅ cenário "' + nome + '" salvo'); render();
  };
  const load = document.getElementById('sim-load'); if (load) load.onchange = () => { const c = JSON.parse(localStorage.getItem(SIMKEY) || '{}'); if (c[load.value]) { _sim = JSON.parse(JSON.stringify(c[load.value])); flash('cenário carregado'); render(); } };
  const reset = document.getElementById('sim-reset'); if (reset) reset.onclick = () => { _sim = simSeed(); flash('resetado pro orçado'); render(); };
}

/* ════════════ ABA 4 · BREAK-EVEN ESTRATÉGICO (v82.6) ════════════ */
const BEKEY = 'psm_viab_be_cenarios';
function proLaboreMes() {
  // detecta pró-labore/retirada de sócio nos custos (por descrição; fallback = categoria "Sócios"). v83.5
  let pl = 0; const rx = /pr[óo]\s*-?\s*labore|retirada/i;
  (_custosOrc || []).forEach(it => { if (rx.test(it.desc || '')) pl += itemAnual(it); });
  if (!pl) (_custosOrc || []).forEach(it => { if (it.cat === 'Sócios') pl += itemAnual(it); });
  return Math.round(pl / 12);
}
function seedBE() {
  const det = custoOrcadoDet(); let fixo = 0;
  LIDS.forEach(l => { for (let m = 1; m <= 12; m++) fixo += det[l][m]; });
  fixo = Math.round(fixo / 12);   // custo fixo mensal médio (dos custos detalhados)
  let cv = 0, cVGV = 0;
  for (let m = 1; m <= 12; m++) { const r = realCell('conquista', m); cv += r.vendas; cVGV += r.vgv; }
  const meses = Math.max(1, new Date().getMonth() + 1);
  return {
    fixo, proLabore: proLaboreMes(),
    conquista: { vendas: cv ? +(cv / meses).toFixed(1) : 2.3, ticket: cv ? Math.round(cVGV / cv) : 283000, margem: 1.8 },
    socio: { vendas: 0, ticket: 400000, margem: 4.5 },
    map: { corretores: 0, vendasCorr: 2, ticket: 345000, margem: 1.88, trafego: 3000 },
    terceiros: { vendas: 0, ticket: 400000, margem: 1.3, trafego: 3000 },
    locacao: { corretores: 0, minGar: 2500, capt: 0, aluguel: 2500, adm: 10, carteira: 0, trafego: 2000 },
  };
}
function beCalc(be) {
  const g = (o, f) => +((o || {})[f]) || 0;
  const conqC = g(be.conquista, 'vendas') * g(be.conquista, 'ticket') * g(be.conquista, 'margem') / 100;
  const socioC = g(be.socio, 'vendas') * g(be.socio, 'ticket') * g(be.socio, 'margem') / 100;
  const mapBruto = g(be.map, 'corretores') * g(be.map, 'vendasCorr') * g(be.map, 'ticket') * g(be.map, 'margem') / 100;
  const mapC = mapBruto - g(be.map, 'trafego');
  const tercBruto = g(be.terceiros, 'vendas') * g(be.terceiros, 'ticket') * g(be.terceiros, 'margem') / 100;
  const tercC = tercBruto - g(be.terceiros, 'trafego');
  const loc1 = g(be.locacao, 'capt') * g(be.locacao, 'aluguel') * 0.62;                                  // 1º aluguel (margem 62%)
  const locRec = g(be.locacao, 'carteira') * g(be.locacao, 'aluguel') * g(be.locacao, 'adm') / 100 * 0.92; // recorrente líq imposto
  const locMin = g(be.locacao, 'corretores') * g(be.locacao, 'minGar');                                    // mínimo garantido (fixo)
  const locC = loc1 + locRec - locMin - g(be.locacao, 'trafego');
  const total = conqC + socioC + mapC + tercC + locC;
  return { conqC, socioC, mapBruto, mapC, tercBruto, tercC, loc1, locRec, locMin, locC, total, resultado: total - g(be, 'fixo') };
}
function renderBE() {
  if (!_be) _be = seedBE();
  const r = beCalc(_be);
  const proLab = +_be.proLabore || 0;
  const fixoEf = _beSemPL ? Math.max(0, (+_be.fixo || 0) - proLab) : (+_be.fixo || 0);   // custo fixo considerado (v83.5)
  const resultado = r.total - fixoEf;
  const cor = resultado >= 0 ? '#4ade80' : '#f87171';
  const cob = fixoEf ? Math.min(100, r.total / fixoEf * 100) : 0;
  // barra de cobertura LÍQUIDA do fixo + quebra por alavanca com sinal (v83.4.1 — casa com a cobertura%)
  const segs = [
    { lbl: '🏠 Conquista', v: r.conqC }, { lbl: '👑 Sócio', v: r.socioC },
    { lbl: '🤝 Terceiros', v: r.tercC }, { lbl: '🔑 Locação', v: r.locC }, { lbl: '🏢 MAP', v: r.mapC },
  ].filter(s => Math.abs(s.v) > 1);
  const beScale = Math.max(r.total, fixoEf, 1);
  const fillPct = Math.max(0, Math.min(100, r.total / beScale * 100));
  const fixoPct = Math.min(100, fixoEf / beScale * 100);
  const barBg = r.total >= fixoEf ? '#22c55e' : (r.total > 0 ? 'linear-gradient(90deg,#f59e0b,#22c55e)' : '#ef4444');
  const torre = `<div style="margin-top:14px">
    <div class="tiny" style="opacity:.8;margin-bottom:6px">🧱 Contribuição líquida das alavancas vs custo fixo <span style="opacity:.7">(tracejado = 100% do fixo ${_beSemPL ? 'SEM' : 'COM'} pró-labore · barra = ${fillPct.toFixed(0)}%)</span></div>
    <div style="position:relative;height:22px;margin-top:16px">
      <div style="height:100%;background:rgba(255,255,255,.10);border-radius:6px;overflow:hidden"><div style="height:100%;width:${fillPct}%;background:${barBg};transition:width .2s"></div></div>
      <div style="position:absolute;top:-5px;bottom:-5px;left:${fixoPct}%;width:0;border-left:2px dashed #fff"></div>
      <div class="tiny" style="position:absolute;top:-16px;left:${fixoPct}%;transform:translateX(-50%);opacity:.85;white-space:nowrap">fixo ${fmtC(fixoEf)}</div>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-top:9px">${segs.map(s => `<span class="tiny" style="opacity:.9"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${s.v >= 0 ? '#22c55e' : '#ef4444'};margin-right:3px;vertical-align:middle"></span>${s.lbl} <b style="color:${s.v >= 0 ? '#4ade80' : '#f87171'}">${s.v >= 0 ? '+' : ''}${fmtC(s.v)}</b></span>`).join('') || '<span class="tiny" style="opacity:.7">preencha as alavancas abaixo</span>'}</div>
  </div>`;
  const bi = (grp, f, lbl, w = 82) => `<label class="tiny muted" style="display:flex;flex-direction:column;gap:1px">${lbl}<input class="input be-in" data-g="${grp}" data-f="${f}" value="${(_be[grp][f] ?? '')}" style="width:${w}px;padding:3px 5px;font-size:11px;text-align:right"></label>`;
  const lever = (titulo, cor2, inputsHtml, contrib, hint) => `
    <div class="card" style="margin:0 0 10px;border-left:4px solid ${cor2}">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap"><b style="font-size:13px">${titulo}</b>
        <span style="margin-left:auto;font-weight:800;color:${dc(contrib)}">${contrib >= 0 ? '+' : ''}${fmt(contrib)}/mês</span></div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:end">${inputsHtml}</div>
      ${hint ? `<div class="tiny muted mt-1">${hint}</div>` : ''}
    </div>`;
  return `
    <div class="alert" style="background:var(--bg-3);border:none;font-size:12px;margin-bottom:12px">🎯 <b>Break-even estratégico</b> — mexa nas alavancas e veja o resultado fechar. O custo fixo vem dos Custos detalhados (editável aqui p/ testar cortes). Use o botão <b>Com/Sem pró-labore</b> pra ver as duas realidades: caixa completo (contando sua retirada) × operacional puro (sem ela). Locação: o <b>mínimo garantido</b> come a margem até a carteira recorrente crescer. Salve cenários e compare.</div>

    <div class="card" style="margin:0 0 14px;background:var(--psm-navy);color:#fff">
      <div class="flex" style="align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div style="display:inline-flex;background:rgba(255,255,255,.10);border-radius:8px;padding:3px">
          <button class="be-pl" data-pl="0" style="cursor:pointer;border:none;padding:6px 13px;font-size:12px;font-weight:700;border-radius:6px;background:${!_beSemPL ? '#22c55e' : 'transparent'};color:#fff">Com pró-labore</button>
          <button class="be-pl" data-pl="1" style="cursor:pointer;border:none;padding:6px 13px;font-size:12px;font-weight:700;border-radius:6px;background:${_beSemPL ? '#22c55e' : 'transparent'};color:#fff">Sem pró-labore</button>
        </div>
        <label class="tiny" style="opacity:.9;display:flex;align-items:center;gap:4px">Pró-labore/mês <span style="font-weight:700">R$</span><input class="input be-in" data-g="_root" data-f="proLabore" value="${_be.proLabore ?? 0}" style="width:110px;padding:3px 6px;font-weight:700;text-align:right"></label>
        <span class="tiny" style="opacity:.7;flex:1;min-width:160px">${_beSemPL ? 'descontando a retirada dos sócios — visão operacional pura' : 'contando a retirada dos sócios — visão caixa completa'}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:start">
        <div><div class="tiny" style="opacity:.8">Custo fixo total/mês</div><div class="flex" style="align-items:center;gap:4px"><span style="font-weight:700">R$</span><input class="input be-in" data-g="_root" data-f="fixo" value="${_be.fixo}" style="width:110px;padding:4px 6px;font-weight:800;text-align:right"></div><div class="tiny" style="opacity:.7;margin-top:2px">considerado: <b>${fmt(fixoEf)}</b>${_beSemPL ? ` (−${fmtC(proLab)} pró-labore)` : ''}</div></div>
        <div><div class="tiny" style="opacity:.8">Contribuição total/mês</div><div style="font-size:19px;font-weight:900">${fmt(r.total)}</div></div>
        <div><div class="tiny" style="opacity:.8">Resultado/mês</div><div style="font-size:22px;font-weight:900;color:${cor}">${resultado >= 0 ? '+' : ''}${fmt(resultado)}</div></div>
        <div><div class="tiny" style="opacity:.8">Cobertura do fixo</div><div style="font-size:19px;font-weight:900;color:${cor}">${cob.toFixed(0)}%</div>
          <div style="height:7px;background:rgba(255,255,255,.15);border-radius:99px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${cob}%;background:${cor}"></div></div></div>
      </div>
      ${torre}
      <div class="tiny" style="opacity:.85;margin-top:12px">${resultado >= 0 ? `✅ Break-even batido ${_beSemPL ? 'sem contar pró-labore' : 'já contando pró-labore'} — o excedente vira lucro.` : `⚠️ Faltam ${fmt(-resultado)}/mês pra fechar${_beSemPL ? ' (sem pró-labore)' : ' (com pró-labore)'}.`}</div>
    </div>

    ${lever('🏠 Conquista (equipe atual)', '#2563eb', bi('conquista', 'vendas', 'Vendas/mês') + bi('conquista', 'ticket', 'Ticket R$', 100) + bi('conquista', 'margem', 'Margem %'), r.conqC, 'Sua base. Subir de 0,33 → 1 venda/corretor já triplica.')}

    ${lever('👑 Sócio vende (alto ticket · comissão fica na casa)', '#a855f7', bi('socio', 'vendas', 'Vendas/mês') + bi('socio', 'ticket', 'Ticket R$', 100) + bi('socio', 'margem', 'Margem %'), r.socioC, 'Você/Isadora vendendo Terceiros/MAP: retém ~4–5%. Custo fixo zero (já na folha). A alavanca mais rápida.')}

    ${lever('🤝 Terceiros (parceria · só tráfego)', '#0891b2', bi('terceiros', 'vendas', 'Vendas/mês') + bi('terceiros', 'ticket', 'Ticket R$', 100) + bi('terceiros', 'margem', 'Margem %') + bi('terceiros', 'trafego', 'Tráfego/mês R$', 96), r.tercC, 'Comissão pura (40% vendedor / 10% captador / 50% casa). Sem mínimo garantido. A mais barata de religar.')}

    ${lever('🔑 Locação (recorrência + mínimo garantido)', '#d97706', bi('locacao', 'corretores', 'Corretores') + bi('locacao', 'minGar', 'Mín. garant. R$', 96) + bi('locacao', 'capt', 'Captações/mês') + bi('locacao', 'aluguel', 'Aluguel médio R$', 100) + bi('locacao', 'adm', '% adm', 60) + bi('locacao', 'carteira', 'Carteira (contratos)', 110) + bi('locacao', 'trafego', 'Tráfego/mês R$', 96), r.locC,
      `1º aluguel <b style="color:${dc(r.loc1)}">${fmtC(r.loc1)}</b> + recorrente <b style="color:${dc(r.locRec)}">${fmtC(r.locRec)}</b> − mín. garantido <b style="color:#dc2626">${fmtC(r.locMin)}</b> − tráfego. O piso permanente: a carteira × adm banca a estrutura sozinha (${_be.locacao.aluguel && _be.locacao.adm ? Math.ceil(_be.fixo / (_be.locacao.aluguel * _be.locacao.adm / 100 * 0.92)) : '—'} contratos cobrem 100% do fixo).`)}

    ${lever('🏢 MAP (corretores comissionados + tráfego + gestão)', '#7c3aed', bi('map', 'corretores', 'Corretores') + bi('map', 'vendasCorr', 'Vendas/corr/mês') + bi('map', 'ticket', 'Ticket R$', 100) + bi('map', 'margem', 'Margem %') + bi('map', 'trafego', 'Tráfego/mês R$', 96), r.mapC, 'Margem fina + consome sua energia de gestão + tráfego pago. Deixe por último.')}

    <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
      <input id="be-nome" class="input" placeholder="nome do cenário" style="max-width:200px">
      <button class="btn btn-primary btn-sm" id="be-save">💾 Salvar cenário</button>
      ${Object.keys(JSON.parse(localStorage.getItem(BEKEY) || '{}')).length ? `<select id="be-load" class="select" style="max-width:200px"><option value="">carregar cenário…</option>${Object.keys(JSON.parse(localStorage.getItem(BEKEY) || '{}')).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>` : ''}
      <button class="btn btn-ghost btn-sm" id="be-reset">↩ Resetar</button>
    </div>`;
}
function wireBE() {
  document.querySelectorAll('.be-pl').forEach(b => b.onclick = () => { _beSemPL = b.dataset.pl === '1'; render(); });   // toggle com/sem pró-labore (v83.5)
  document.querySelectorAll('.be-in').forEach(el => el.onchange = () => {
    const g = el.dataset.g, f = el.dataset.f, v = num(el.value);
    if (g === '_root') _be[f] = v; else _be[g][f] = v;
    render();
  });
  const save = document.getElementById('be-save'); if (save) save.onclick = () => {
    const nome = (document.getElementById('be-nome').value || '').trim(); if (!nome) return flash('dê um nome ao cenário');
    const c = JSON.parse(localStorage.getItem(BEKEY) || '{}'); c[nome] = _be; localStorage.setItem(BEKEY, JSON.stringify(c)); flash('✅ cenário "' + nome + '" salvo'); render();
  };
  const load = document.getElementById('be-load'); if (load) load.onchange = () => { const c = JSON.parse(localStorage.getItem(BEKEY) || '{}'); if (c[load.value]) { _be = JSON.parse(JSON.stringify(c[load.value])); flash('cenário carregado'); render(); } };
  const reset = document.getElementById('be-reset'); if (reset) reset.onclick = () => { _be = seedBE(); flash('resetado'); render(); };
}

/* ════════════ ABA 0 · RESUMO EXECUTIVO (v83.0 — profissional/didático/inteligente) ════════════ */
function resumoData() {
  const meses = (_ano === new Date().getFullYear()) ? Math.max(1, new Date().getMonth() + 1) : 12;
  const det = custoOrcadoDet(); let fixo = 0; LIDS.forEach(l => { for (let m = 1; m <= 12; m++) fixo += det[l][m]; }); fixo /= 12;
  const detST = custoOrcadoDet(true); const custoEmp = {}; LIDS.forEach(l => { custoEmp[l] = 0; for (let m = 1; m <= 12; m++) custoEmp[l] += detST[l][m]; custoEmp[l] /= 12; });
  const frentes = LINHAS.map(l => {
    let vgv = 0, vendas = 0; for (let m = 1; m <= 12; m++) { const r = realCell(l.id, m); vgv += r.vgv; vendas += r.vendas; }
    const o = orcCell(l.id, 1);
    const margemPct = (+o.com_bruta_pct || 0) - (+o.com_corretor_pct || 0) - (+o.com_senior_pct || 0) - (+o.com_gerente_pct || 0) - (+o.com_bruta_pct || 0) * (+o.aliquota_pct || 0) / 100;
    const vgvMes = vgv / meses;
    return { l, vgvMes, vendasMes: vendas / meses, margemPct, contrib: vgvMes * margemPct / 100, custoMes: custoEmp[l.id] };
  });
  const contribTotal = frentes.reduce((s, f) => s + f.contrib, 0);
  return { fixo, frentes, contribTotal, cobertura: fixo ? contribTotal / fixo * 100 : 0, gap: fixo - contribTotal, meses };
}
function resumoInsight(d) {
  if (d.gap <= 0) return `✅ <b>Operação no azul.</b> A contribuição das vendas (${fmt(d.contribTotal)}/mês) cobre o custo fixo com folga de <b>${fmt(-d.gap)}/mês</b> — o excedente vira lucro.`;
  const ativas = d.frentes.filter(f => f.vgvMes > 0);
  const top = d.frentes.slice().sort((a, b) => b.contrib - a.contrib)[0];
  return `No ritmo atual você cobre <b>${d.cobertura.toFixed(0)}%</b> do custo fixo — faltam <b style="color:#f87171">${fmt(d.gap)}/mês</b> pra fechar. ${ativas.length <= 1 ? 'Só a <b>Conquista</b> está rodando' : `<b>${ativas.length} frentes</b> rodando`}. Como a margem de corretagem é fina (~${top ? top.margemPct.toFixed(1) : '1,8'}%), fechar só por volume é duro — as alavancas mais rápidas são <b>sócio vendendo alto ticket</b> (retém ~4–5%) e <b>locação recorrente</b> (piso que entra todo mês). Teste as combinações na aba 🎯 <b>Break-even</b>.`;
}
function heroStat(lbl, val, cor) { return `<div><div class="tiny" style="opacity:.8">${lbl}</div><div style="font-size:20px;font-weight:900;color:${cor}">${val}</div></div>`; }
function renderResumo() {
  const d = resumoData();
  const ok = d.gap <= 0, cor = ok ? '#4ade80' : '#f87171';
  const cob = Math.min(100, Math.max(0, d.cobertura));
  const passo = (n, ico, t, sub, tabId) => `<button class="btn btn-ghost res-goto" data-goto="${tabId}" style="flex:1;min-width:148px;text-align:left;border:1px solid var(--border);border-radius:10px;padding:9px 11px;height:auto"><div class="tiny muted">Passo ${n}</div><div style="font-weight:800;font-size:13px">${ico} ${t}</div><div class="tiny muted">${sub}</div></button>`;
  const margBadge = f => { const m = f.margemPct, c = m < 0.5 ? '#dc2626' : m < 1.5 ? '#d97706' : '#16a34a'; return `<div style="flex:1;min-width:135px;background:var(--bg-3);border-radius:10px;padding:9px 11px;border-left:4px solid ${f.l.cor}"><div class="tiny muted">${f.l.icon} ${f.l.nome}</div><div style="font-size:18px;font-weight:900;color:${c}">${pct(f.margemPct)}</div><div class="tiny muted">${f.vgvMes > 0 ? fmtC(f.vgvMes) + '/mês' : '⏸ pausada'}</div></div>`; };
  const maxC = Math.max(1, ...d.frentes.map(f => f.custoMes));
  const custoBar = f => `<div style="margin-bottom:6px"><div class="flex" style="justify-content:space-between;font-size:12px"><span>${f.l.icon} ${f.l.nome}</span><b>${fmt(f.custoMes)}/mês</b></div><div style="height:8px;background:var(--bg-3);border-radius:99px;overflow:hidden"><div style="height:100%;width:${(f.custoMes / maxC * 100).toFixed(0)}%;background:${f.l.cor}"></div></div></div>`;
  return `
    <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
      ${passo(1, '📋', 'Orce', 'metas + custos por frente', 'orcado')}
      ${passo(2, '📈', 'Acompanhe', 'realizado × orçado', 'realizado')}
      ${passo(3, '🎯', 'Simule', 'break-even & alavancas', 'be')}
      ${passo(4, '🧪', 'Decida', 'cenários lado a lado', 'sim')}
    </div>
    <div class="card" style="margin:0 0 14px;background:var(--psm-navy);color:#fff">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        ${heroStat('🏦 Custo fixo/mês', fmtC(d.fixo), '#cbd5e1')}
        ${heroStat('💚 Contribuição/mês', fmtC(d.contribTotal), '#4ade80')}
        ${heroStat(ok ? '🎉 Sobra/mês' : '⚠️ Falta/mês', fmtC(Math.abs(d.gap)), cor)}
        ${heroStat('📊 Cobertura do fixo', d.cobertura.toFixed(0) + '%', ok ? '#4ade80' : '#fbbf24')}
      </div>
      <div style="margin-top:12px">
        <div class="tiny" style="opacity:.8;margin-bottom:4px">Break-even — o quanto a contribuição preenche o custo fixo</div>
        <div style="position:relative;height:14px;background:rgba(255,255,255,.12);border-radius:99px;overflow:hidden"><div style="height:100%;width:${cob}%;background:${ok ? '#22c55e' : 'linear-gradient(90deg,#f59e0b,#ef4444)'}"></div></div>
        <div class="tiny" style="opacity:.65;margin-top:3px">0% ·········· meta: 100% = ${fmtC(d.fixo)}/mês</div>
      </div>
      <div style="margin-top:12px;background:rgba(255,255,255,.07);border-radius:10px;padding:11px 13px;font-size:13px;line-height:1.55">💡 <b>Leitura automática:</b> ${resumoInsight(d)}</div>
    </div>
    <div class="card" style="margin:0 0 14px"><h3 class="card-title">💹 Margem líquida por frente <span class="tiny muted" style="font-weight:400" title="Quanto a PSM retém do VGV depois de corretor + sênior + gerente + imposto. Verde ≥1,5% · amarelo 0,5–1,5% · vermelho <0,5%">ⓘ</span></h3>
      <div class="flex gap-2" style="flex-wrap:wrap">${d.frentes.map(margBadge).join('')}</div>
      <div class="tiny muted mt-2">Margem = comissão bruta − corretor − sênior − gerente − imposto. Fina na corretagem residencial; alta na captação de locação.</div>
    </div>
    <div class="card" style="margin:0 0 14px"><h3 class="card-title">🏢 Custo por empresa/mês <span class="tiny muted" style="font-weight:400">(fixo+variável, sem tráfego)</span></h3>
      ${d.frentes.map(custoBar).join('')}
      <div class="tiny muted mt-1">Total operacional (sem tráfego): <b>${fmt(d.frentes.reduce((s, f) => s + f.custoMes, 0))}/mês</b>. Edite na aba Orçado → 🧾 Custos detalhados.</div>
    </div>
    ${donutCatCard()}`;
}
// card do donut "composição do custo por categoria" (v83.4)
function donutCatCard() {
  const cats = custoPorCategoria();
  if (!cats.length) return '';
  const tot = cats.reduce((s, c) => s + c.mes, 0);
  const leg = cats.map((c, i) => `<div class="flex" style="align-items:center;gap:6px;font-size:12px;margin-bottom:3px"><span style="width:10px;height:10px;border-radius:3px;background:${CHART_PAL[i % CHART_PAL.length]};flex:none"></span><span style="flex:1">${esc(c.cat)}</span><b>${fmtC(c.mes)}</b><span class="tiny muted" style="width:38px;text-align:right">${(c.mes / tot * 100).toFixed(0)}%</span></div>`).join('');
  return `<div class="card" style="margin:0"><h3 class="card-title">🍩 Composição do custo fixo por categoria <span class="tiny muted" style="font-weight:400">· ${fmtC(tot)}/mês</span></h3>
    <div class="flex gap-3" style="flex-wrap:wrap;align-items:center">
      <div id="viab-cat-donut-wrap" style="flex:1;min-width:210px;height:220px;position:relative"><canvas id="viab-cat-donut"></canvas></div>
      <div style="flex:1;min-width:210px">${leg}</div>
    </div>
    <div class="tiny muted mt-1">Onde o dinheiro fixo vai — o maior bloco é o alvo nº 1 de corte pra baixar o break-even. Editável em Orçado → 🧾 Custos detalhados.</div>
  </div>`;
}
function wireResumo() {
  document.querySelectorAll('.res-goto').forEach(b => b.onclick = () => { if (b.dataset.goto === 'orcado') _orcView = 'receita'; _tab = b.dataset.goto; render(); });
  // donut de custo por categoria (v83.4)
  const cats = custoPorCategoria();
  if (cats.length && document.getElementById('viab-cat-donut')) {
    const totCat = cats.reduce((s, c) => s + c.mes, 0) || 1;
    mkChart('viab-cat-donut', {
      type: 'doughnut',
      data: { labels: cats.map(c => c.cat), datasets: [{ data: cats.map(c => Math.round(c.mes)), backgroundColor: cats.map((_, i) => CHART_PAL[i % CHART_PAL.length]), borderWidth: 0 }] },
      options: darkOpts({ cutout: '58%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtC(c.parsed)} (${(c.parsed / totCat * 100).toFixed(1)}%)` } } } }),
    });
  }
}
