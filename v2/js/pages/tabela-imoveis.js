/* PSM-OS v2 — Tabela de Lançamentos PSM — EDITOR NATIVO no sistema (v81.3)
   Sem upload que baixa: o gestor monta a tabela direto no sistema (linhas/colunas
   editáveis), por MARCA (🏆 PSM Conquista / ✨ PSM Imóveis) e CATEGORIA livre (ex.: MAP).
   Pode importar xlsx só pra preencher a grade. Tudo renderizado limpo, com busca. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _tabelas = [];
let _canEdit = false;
let _edit = null;      // id da tabela em edição, ou 'new:conquista' / 'new:imoveis'
let _draft = null;     // {id, marca, categoria, colunas:[], linhas:[[]]}
let _msg = '';
let _marcaFilter = null;  // null = ambas; 'conquista' | 'imoveis' (MAP)
let _filtros = null;      // v86.88: filtros do MAP (Sets por categoria) — só em memória, zera a cada abertura
let _renaming = null;     // id da tabela com título em edição inline

const MARCAS = [
  { id: 'conquista', label: '🏆 PSM Conquista', cor: '#dc2626', blue: false },
  // PSM Imóveis = MAP — paleta AZUL (igual à planilha): header azul + linhas zebradas
  { id: 'imoveis', label: '🗺 PSM MAP', cor: '#5b7fb4', blue: true },
];
// paleta de cores prontas pra colorir cada tabela (cor personalizada via seletor também)
const SWATCHES = ['#dc2626', '#ea580c', '#d4a843', '#16a34a', '#0891b2', '#5b7fb4', '#2563eb', '#7c3aed', '#db2777', '#475569'];

export async function pageTabelaImoveis(ctx, root, marcaFilter = null) {
  _root = root; _edit = null; _draft = null; _msg = ''; _renaming = null;
  _filtros = filtrosVazios();   // v86.88: filtros do MAP SEMPRE zerados ao abrir a página (nunca persistem)
  _marcaFilter = (marcaFilter === 'conquista' || marcaFilter === 'imoveis') ? marcaFilter : null;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  await load();
  render();
}

async function load() {
  try {
    const r = await api.request('/api/v3/tabelas/lancamentos');
    _tabelas = r.tabelas || [];
    _canEdit = !!r.can_edit;
  } catch (e) { _tabelas = []; _canEdit = (auth.user()?.lvl || 0) >= 5; _msg = '⚠️ ' + e.message; }
}

function loadXLSX() {
  return new Promise((resolve) => {
    if (window.XLSX) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve; s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

function render() {
  const marcas = _marcaFilter ? MARCAS.filter(m => m.id === _marcaFilter) : MARCAS;
  const titulo = _marcaFilter === 'conquista' ? '🏆 Tabela de Lançamentos Conquista'
    : _marcaFilter === 'imoveis' ? '🗺 Tabela de Lançamentos MAP'
      : '📊 Tabela de Lançamentos PSM';
  const sub = _marcaFilter === 'imoveis'
    ? 'Lançamentos do MAP, divididos por categoria. ' + (_canEdit ? 'Edite linhas/colunas, o título e o mês de vigência; importe xlsx pra preencher (links viram clicáveis).' : 'Somente leitura.')
    : _marcaFilter === 'conquista'
      ? 'Lançamentos da Conquista por categoria. ' + (_canEdit ? 'Edite linhas/colunas, o título e o mês de vigência aqui.' : 'Somente leitura.')
      : 'Montada dentro do sistema. ' + (_canEdit ? 'Edite direto aqui; importe xlsx pra preencher rápido.' : 'Somente leitura.');
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">${titulo}</h2>
      <p class="card-sub">${sub}</p>
      <div id="tl-msg" class="tiny" style="margin:4px 0">${_msg ? esc(_msg) : ''}</div>
      ${marcas.map(m => marcaSection(m)).join('')}
    </div>`;
  wire();
}

function marcaSection(m) {
  // ordem manual (campo ordem); sem ordem definida cai no fim, desempate por categoria
  const ord = t => (t.ordem == null ? 9999 : t.ordem);
  const tabs = _tabelas.filter(t => t.marca === m.id).sort((a, b) => (ord(a) - ord(b)) || (a.categoria || '').localeCompare(b.categoria || '', 'pt-BR'));
  const editingNew = _edit === ('new:' + m.id);
  return `
    <div class="mt-4" style="border-top:3px solid ${m.cor};border-radius:10px;padding-top:10px">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0;color:${m.cor}">${m.label} <span class="tiny muted" style="font-weight:600">· ${tabs.length} tabela(s)</span></h3>
        ${_canEdit && !_edit ? `<div class="flex gap-2" style="flex-wrap:wrap">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0" title="Cada aba da planilha vira uma tabela">📥 Importar planilha<input type="file" data-importall="${m.id}" accept=".xlsx,.xls,.csv" style="display:none"></label>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0" title="Anexa um PDF e exibe embutido">📎 Anexar PDF<input type="file" data-pdf="${m.id}" accept="application/pdf,.pdf" style="display:none"></label>
          <button class="btn btn-primary btn-sm" data-new="${m.id}">➕ Nova tabela</button>
        </div>` : ''}
      </div>
      ${m.id === 'imoveis' && !_edit ? filtroBarHTML(tabs) : ''}
      ${editingNew ? editorCard(m.cor) : ''}
      ${tabs.map((t, i) => (_edit === t.id ? editorCard(m.cor) : viewCard(t, m, i, tabs.length))).join('')
        || (editingNew ? '' : `<div class="tiny muted" style="padding:6px 2px">Nenhuma tabela ainda${_canEdit ? ' — clique em ➕ Nova tabela.' : '.'}</div>`)}
    </div>`;
}

/* ───────── VIEW ───────── */
// Célula clicável quando o valor é uma URL (ex.: coluna LINK DRIVE da planilha)
function isUrl(v) { return /^https?:\/\//i.test(String(v || '').trim()); }
function cellHTML(v) {
  const s = v != null ? String(v) : '';
  if (isUrl(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener" style="color:var(--azul-medio);font-weight:700;text-decoration:underline">🔗 abrir</a>`;
  return esc(s);
}

/* v86.87 — MAP SEMPRE em ordem CRESCENTE de valor (Paulo, 25/ago): cada tabela
   (categoria) do MAP exibe as linhas do menor pro maior valor. A coluna de valor
   é achada pelo cabeçalho (VALOR/PREÇO/INVESTIMENTO/A PARTIR) ou, sem cabeçalho
   que case, pela coluna com mais células monetárias (≥ R$ 1.000). Linha sem
   valor legível vai pro fim, na ordem original. Só exibição — o dado salvo não
   muda; por isso o arrastar-linha (v86.53) fica desligado no MAP. */
function parseMoney(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s || isUrl(s)) return null;
  s = s.replace(/R\$\s*/gi, '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  // pt-BR: ponto = milhar, vírgula = decimal ("1.234.567,89", "189.900", "250000")
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function colunaValor(t) {
  const cols = t.colunas || [];
  const porNome = cols.findIndex(c => /valor|pre[çc]o|invest|a\s*partir/i.test(String(c || '')));
  if (porNome >= 0) return porNome;
  const linhas = t.linhas || [];
  const nCols = cols.length || (linhas[0] || []).length;
  let best = -1, bestN = 0;
  for (let c = 0; c < nCols; c++) {
    const n = linhas.filter(r => { const v = parseMoney(r[c]); return v != null && v >= 1000; }).length;
    if (n > bestN) { bestN = n; best = c; }
  }
  return best;
}
function linhasOrdenadasPorValor(t) {
  const linhas = (t.linhas || []).slice();
  const c = colunaValor(t);
  if (c < 0) return linhas;
  return linhas
    .map((r, i) => ({ r, i, v: parseMoney(r[c]) }))
    .sort((a, b) => ((a.v == null) - (b.v == null)) || ((a.v != null && b.v != null) ? (a.v - b.v) : 0) || (a.i - b.i))
    .map(x => x.r);
}

/* ───────── v86.88 — FILTROS DO MAP (Paulo, 25/ago) ─────────
   Chips multi-seleção acima das tabelas do MAP: dentro da categoria é OU
   (marcou 2 faixas = qualquer uma serve), entre categorias é E. Categoria sem
   nada marcado = indiferente. Faixas CONTÍGUAS (limite superior inclusivo) pra
   nenhum imóvel cair em buraco. Os dados são texto livre, então o parser é
   tolerante: m² aceita múltiplas plantas na linha ("49m2 / 51m2 e 74m2" casa
   se QUALQUER uma cair na faixa); valor < 10 mil é lido como "mil" digitado
   curto ("R$ 541.00" ⇒ 541 mil); linha ILEGÍVEL num quesito filtrado é
   ocultada mas CONTADA no aviso "⚠ sem dado" — nunca some calada. */
const FILTROS_DEF = [
  { cat: 'm2', lbl: '📐 Tamanho de planta', opts: [
    { id: 'a', lbl: 'até 40 m²', max: 40 }, { id: 'b', lbl: '41–58', min: 40, max: 58 },
    { id: 'c', lbl: '59–80', min: 58, max: 80 }, { id: 'd', lbl: '81–100', min: 80, max: 100 },
    { id: 'e', lbl: '101–120', min: 100, max: 120 }, { id: 'f', lbl: '121–140', min: 120, max: 140 },
    { id: 'g', lbl: '141–170', min: 140, max: 170 }, { id: 'h', lbl: '171–200', min: 170, max: 200 },
    { id: 'i', lbl: '+200 m²', min: 200 } ] },
  { cat: 'planta', lbl: '🛏 Tipo de planta', opts: [
    { id: 'studio', lbl: 'Studio' }, { id: '1suite', lbl: '1 suíte' }, { id: '2dorm', lbl: '2 dorms' },
    { id: '2dorm_s', lbl: '2 dorms c/ suíte' }, { id: '2suites', lbl: '2 suítes' },
    { id: '3dorm_s', lbl: '3 dorms c/ suíte' }, { id: '3suites', lbl: '3 suítes' },
    { id: '4dorm_s', lbl: '4 dorms c/ suíte' }, { id: '4suites', lbl: '4 suítes' } ] },
  { cat: 'tipo', lbl: '🏠 Tipo de imóvel', opts: [
    { id: 'casa_cond', lbl: 'Casa em condomínio' }, { id: 'apto', lbl: 'Apartamento' },
    { id: 'terr_aberto', lbl: 'Terreno residencial aberto' }, { id: 'terr_cond', lbl: 'Terreno em condomínio' },
    { id: 'terr_com', lbl: 'Terreno comercial' }, { id: 'terr_ind', lbl: 'Terreno industrial' },
    { id: 'sala', lbl: 'Sala comercial' }, { id: 'loja', lbl: 'Loja' }, { id: 'cobertura', lbl: 'Cobertura' } ] },
  { cat: 'valor', lbl: '💰 Valor', opts: [
    { id: 'a', lbl: 'até 450 mil', max: 450000 }, { id: 'b', lbl: '450–600 mil', min: 450000, max: 600000 },
    { id: 'c', lbl: '600–800 mil', min: 600000, max: 800000 }, { id: 'd', lbl: '800 mil–1M', min: 800000, max: 1000000 },
    { id: 'e', lbl: '1M–1,8M', min: 1000000, max: 1800000 }, { id: 'f', lbl: '+1,8M', min: 1800000 } ] },
  { cat: 'prazo', lbl: '📅 Prazo de entrega', opts: [
    { id: 'a', lbl: 'até 6 meses', max: 6 }, { id: 'b', lbl: '6–12 meses', min: 6, max: 12 },
    { id: 'c', lbl: '1–2 anos', min: 12, max: 24 }, { id: 'd', lbl: '2–3 anos', min: 24, max: 36 },
    { id: 'e', lbl: '+3 anos', min: 36 } ] },
];
function filtrosVazios() { const f = {}; FILTROS_DEF.forEach(d => { f[d.cat] = new Set(); }); return f; }
function filtrosAtivos() { return !!_filtros && FILTROS_DEF.some(d => _filtros[d.cat].size); }
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function colPor(t, re, excl) {
  return (t.colunas || []).findIndex(c => re.test(norm(c)) && !(excl && excl.test(norm(c))));
}
function emFaixa(v, opts, sel) {
  return opts.some(o => sel.has(o.id) && v > (o.min != null ? o.min : -Infinity) && v <= (o.max != null ? o.max : Infinity));
}
// m² da linha: TODAS as plantas citadas na célula ("49m2 / 51m2 e 74m2" → [49,51,74])
function m2Vals(v) {
  if (isUrl(v)) return [];
  const ms = String(v == null ? '' : v).match(/\d+(?:[.,]\d+)?/g) || [];
  return ms.map(x => parseFloat(x.replace(',', '.'))).filter(x => isFinite(x) && x >= 10 && x <= 5000);
}
// valor da linha: "R$ 541.00" e "350" são "mil" digitado curto → ×1000 (imóvel < R$10 mil não existe)
function valorNormalizado(v) {
  const n = parseMoney(v);
  return n == null ? null : (n < 10000 ? n * 1000 : n);
}
// meses até a entrega: "09/2026" (MM/AAAA), "pronto", "36 meses" ou coluna MESES RESTANTES
function mesesAteEntrega(cel, celMesesRest) {
  const s = String(cel == null ? '' : cel);
  const mmaa = s.match(/(\d{1,2})\s*\/\s*(20\d{2})/);
  if (mmaa) { const hoje = new Date(); return (+mmaa[2] - hoje.getFullYear()) * 12 + (+mmaa[1] - 1 - hoje.getMonth()); }
  if (/pronto|entregue|imediat/i.test(s)) return 0;
  const meses = s.match(/(\d+)\s*m[eê]s/i);
  if (meses) return +meses[1];
  const n = parseInt(String(celMesesRest == null ? '' : celMesesRest), 10);
  return isFinite(n) ? n : null;
}
// tipo(s) de planta da célula, tolerante: "2/S" = 2 dorms c/ suíte; "1 suite ou
// 2 quartos" casa com as duas; "3 dorms" seco casa com "3 dorms c/ suíte"
function plantaIds(cel) {
  const out = new Set();
  norm(cel).split(/\bou\b|,|;|\+/).forEach(seg => {
    seg = seg.trim(); if (!seg) return;
    if (/stud/.test(seg)) { out.add('studio'); return; }
    const temSuite = /suite|\/\s*s\b|\bc\/?\s*s\b/.test(seg);
    const plural = /suites/.test(seg);
    const d = seg.match(/\d/); if (!d) { if (temSuite) out.add('1suite'); return; }
    const n = Math.min(4, +d[0]); if (n < 1) return;
    if (n === 1) { out.add('1suite'); return; }
    if (plural) { out.add(n + 'suites'); return; }
    if (n === 2) out.add(temSuite ? '2dorm_s' : '2dorm');
    else out.add(n + 'dorm_s');   // 3/4 dorms seco → opção "c/ suíte" (casamento tolerante)
  });
  return out;
}
// tipo de imóvel: não tem coluna própria — deduzido por palavra-chave na linha
// inteira + nome da tabela; linha residencial com dorms e sem outra pista = apto
function tipoIds(t, r, cPlanta) {
  const x = norm((r || []).filter(c => !isUrl(c)).join(' ') + ' ' + (t.categoria || ''));
  const out = new Set();
  if (/cobertura/.test(x)) out.add('cobertura');
  if (/sala/.test(x) && /comercial/.test(x)) out.add('sala');
  if (/\bloja/.test(x)) out.add('loja');
  if (/terreno|\blote\b/.test(x)) {
    if (/industr/.test(x)) out.add('terr_ind');
    else if (/comerc/.test(x)) out.add('terr_com');
    else if (/condom/.test(x)) out.add('terr_cond');
    else out.add('terr_aberto');
  } else if (/\bcasa\b|sobrado/.test(x)) out.add('casa_cond');
  if (!out.size && cPlanta >= 0 && plantaIds(r[cPlanta]).size) out.add('apto');
  return out;
}
// Aplica os filtros ativos numa tabela do MAP. Retorna as linhas visíveis +
// quantas foram ocultadas por estarem ILEGÍVEIS num quesito filtrado (semDado).
function filtroResultado(t) {
  const linhas = t.linhas || [];
  if (!filtrosAtivos() || t.tipo === 'pdf') return { linhas: linhas.slice(), semDado: 0, ativo: false };
  const cM2 = colPor(t, /m²|m2|metrag|area/);
  const cVal = colunaValor(t);
  const cPl = colPor(t, /dorm|suite|planta|tipolog|quarto/);
  const cEnt = colPor(t, /entrega|conclus|prazo/, /abertura|venda/);
  const cMR = colPor(t, /meses\s*rest/);
  const vis = []; let semDado = 0;
  for (const r of linhas) {
    let ok = true, faltou = false;
    for (const def of FILTROS_DEF) {
      const sel = _filtros[def.cat]; if (!sel.size) continue;
      let st; // true = casa, false = não casa, null = sem dado legível
      if (def.cat === 'm2') { const vs = cM2 >= 0 ? m2Vals(r[cM2]) : []; st = vs.length ? vs.some(v => emFaixa(v, def.opts, sel)) : null; }
      else if (def.cat === 'valor') { const v = cVal >= 0 ? valorNormalizado(r[cVal]) : null; st = v != null ? emFaixa(v, def.opts, sel) : null; }
      else if (def.cat === 'planta') { const ids = cPl >= 0 ? plantaIds(r[cPl]) : new Set(); st = ids.size ? [...ids].some(i => sel.has(i)) : null; }
      else if (def.cat === 'tipo') { const ids = tipoIds(t, r, cPl); st = ids.size ? [...ids].some(i => sel.has(i)) : null; }
      else { const v = mesesAteEntrega(cEnt >= 0 ? r[cEnt] : '', cMR >= 0 ? r[cMR] : ''); st = v != null ? emFaixa(Math.max(0, v), def.opts, sel) : null; }
      if (st === null) { faltou = true; ok = false; break; }
      if (!st) { ok = false; break; }
    }
    if (ok) vis.push(r); else if (faltou) semDado++;
  }
  return { linhas: vis, semDado, ativo: true };
}
function filtroBarHTML(tabs) {
  const dados = tabs.filter(tb => tb.tipo !== 'pdf' && (tb.linhas || []).length);
  if (!dados.length) return '';
  const ativo = filtrosAtivos();
  let totV = 0, totAll = 0, totT = 0;
  dados.forEach(tb => { const fr = filtroResultado(tb); totAll += (tb.linhas || []).length; totV += fr.linhas.length; if (fr.linhas.length) totT++; });
  const chip = (def, o) => {
    const sel = _filtros[def.cat].has(o.id);
    return `<button type="button" data-fcat="${def.cat}" data-fchip="${o.id}" style="border-radius:20px;padding:3px 10px;font-size:11.5px;font-weight:700;margin:2px 3px 2px 0;cursor:pointer;${sel ? 'background:#5b7fb4;color:#fff;border:1px solid #5b7fb4' : 'background:transparent;color:var(--text,inherit);border:1px solid var(--border)'}">${esc(o.lbl)}</button>`;
  };
  return `
    <div style="background:var(--bg-2);border:1px solid #5b7fb455;border-radius:10px;padding:10px 12px;margin-bottom:12px">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <b style="font-size:13px;color:#5b7fb4">🔎 Filtros do MAP</b>
        <span class="flex" style="align-items:center;gap:8px;flex-wrap:wrap">
          ${ativo ? `<span class="tiny" style="font-weight:800">${totV} de ${totAll} imóveis · ${totT} tabela(s) com resultado</span>
                     <button class="btn btn-ghost btn-sm" data-flimpar="1" style="padding:2px 10px">✕ Limpar filtros</button>`
                  : `<span class="tiny muted">marque quantas opções quiser · nada marcado = indiferente · abre sempre limpo</span>`}
        </span>
      </div>
      ${FILTROS_DEF.map(def => `
        <div style="margin-top:7px;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px">
          <span class="tiny muted" style="font-weight:800;min-width:150px">${def.lbl}</span>
          <span style="flex:1">${def.opts.map(o => chip(def, o)).join('')}</span>
        </div>`).join('')}
    </div>`;
}

function viewCard(t, m, idx, total) {
  const cor = t.cor || m.cor;               // cor efetiva: a da tabela tem prioridade
  const zebra = !!m.blue || !!t.cor;        // tabela colorida → linhas zebradas estilo planilha
  const isPdf = t.tipo === 'pdf' && t.pdf_url;
  const cols = t.colunas && t.colunas.length ? t.colunas : (t.linhas[0] || []).map((_, i) => 'Col ' + (i + 1));
  // v86.86 (Paulo 25/ago: "olha o modo escuro na tabela, não dá pra ler").
  // A zebra é uma PLANILHA: linha ímpar branca fixa + linha par com tinta
  // translúcida da cor. No escuro a tinta caía sobre o fundo escuro da página
  // e o texto (escuro fixo) sumia linha sim, linha não. A base da tabela agora
  // é folha BRANCA fixa nos 2 temas (como a via de impressão do VPL) — a tinta
  // translúcida volta a ser o pastel claro que ela sempre foi no claro.
  const cellTxt = zebra ? 'color:#1f2d3d' : '';
  // v86.53: reordenar LINHA com clicar-e-segurar (pedido do Paulo). A alça ⠿ tem
  // touch-action:none (arrasta no dedo sem brigar com o scroll da tabela); com o
  // mouse, segurar 0,3s em QUALQUER ponto da linha também engata.
  // v86.87: no MAP a ordem é AUTOMÁTICA (crescente por valor) — sem arrastar linha.
  // v86.88: filtros do MAP — filtra as linhas ANTES de ordenar; tabela zerada
  // pelo filtro vira um card recolhido em vez de ocupar a tela.
  const mapOrdenado = !isPdf && m.id === 'imoveis';
  const fr = mapOrdenado ? filtroResultado(t) : null;
  const linhas = mapOrdenado
    ? linhasOrdenadasPorValor({ colunas: t.colunas, linhas: fr.linhas })
    : (t.linhas || []);
  const canDragRow = _canEdit && !_edit && !isPdf && !mapOrdenado && (t.linhas || []).length > 1;
  const headHandle = canDragRow ? `<th style="position:sticky;top:0;background:${cor};z-index:1;width:26px"></th>` : '';
  const head = `<thead><tr>${headHandle}${cols.map(c => `<th style="position:sticky;top:0;background:${cor};color:#fff;padding:7px 9px;font-size:11.5px;text-align:left;white-space:nowrap;z-index:1">${esc(c)}</th>`).join('')}</tr></thead>`;
  const rowBg = (i) => zebra ? `background:${i % 2 ? '#ffffff' : cor + '1a'}` : '';
  const handleTd = canDragRow ? `<td data-rowgrip style="padding:0 2px;text-align:center;cursor:grab;touch-action:none;user-select:none;color:${zebra ? cor : 'var(--muted,#94a3b8)'};font-weight:900">⠿</td>` : '';
  const body = `<tbody data-rowdrag="${canDragRow ? t.id : ''}">${linhas.map((r, ri) => `<tr data-ri="${ri}" style="border-bottom:1px solid ${zebra ? cor + '40' : 'var(--border)'};${rowBg(ri)}">${handleTd}${cols.map((_, i) => `<td style="padding:6px 9px;font-size:12px;white-space:nowrap;${cellTxt}">${cellHTML(r[i])}</td>`).join('')}</tr>`).join('')}</tbody>`;
  const meta = isPdf ? '📄 PDF'
    : (fr && fr.ativo ? `${linhas.length} de ${(t.linhas || []).length} linha(s)` : `${(t.linhas || []).length} linha(s)`);
  const renaming = _renaming === t.id;
  const reorder = _canEdit && !_edit && !renaming && total > 1
    ? `<span class="flex" style="gap:2px"><button class="btn btn-ghost btn-sm" data-tblup="${t.id}" title="subir" ${idx === 0 ? 'disabled' : ''} style="padding:1px 6px">↑</button><button class="btn btn-ghost btn-sm" data-tbldn="${t.id}" title="descer" ${idx === total - 1 ? 'disabled' : ''} style="padding:1px 6px">↓</button></span>`
    : '';
  const titulo = renaming
    ? `<span class="flex gap-1" style="align-items:center">
         <input class="input" id="tl-rn" value="${esc(t.categoria || '')}" style="height:28px;font-size:13px;width:240px" placeholder="Nome da tabela">
         <button class="btn btn-primary btn-sm" data-rnsave="${t.id}">💾</button>
         <button class="btn btn-ghost btn-sm" data-rncancel="1">✕</button>
       </span>`
    : `<b style="font-size:13px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cor};margin-right:5px;vertical-align:middle"></span>${isPdf ? '📕' : '📋'} ${esc(t.categoria || 'Sem categoria')}${dupBadge(t)}${_canEdit && !_edit ? ` <button class="btn btn-ghost btn-sm" data-rename="${t.id}" title="Renomear" style="padding:1px 6px">✏️</button>` : ''}${t.vigencia ? ` <span style="background:${cor}22;color:${cor};font-weight:800;font-size:11px;padding:2px 8px;border-radius:20px;white-space:nowrap">📅 ${esc(t.vigencia)}</span>` : ''} <span class="tiny muted" style="font-weight:600">· ${meta} · ${fmtData(t.atualizado_em)}</span></b>`;
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid ${cor};border-radius:10px;padding:10px;margin-bottom:12px">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <span class="flex gap-1" style="align-items:center">${reorder}${titulo}</span>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${!isPdf && (t.linhas || []).length ? `<input class="input" data-search="${t.id}" placeholder="🔍 buscar…" style="height:30px;font-size:12px;width:150px">` : ''}
          ${isPdf ? `<a class="btn btn-ghost btn-sm" href="${esc(t.pdf_url)}" target="_blank" rel="noopener" download>↓ Baixar PDF</a>` : ''}
          ${_canEdit && !_edit && !isPdf ? `<button class="btn btn-ghost btn-sm" data-edittbl="${t.id}">✏️ Editar</button>` : ''}
          ${_canEdit && !_edit ? `<button class="btn btn-ghost btn-sm" data-deltbl="${t.id}">🗑</button>` : ''}
        </div>
      </div>
      ${isPdf
        ? `<iframe src="${esc(t.pdf_url)}" style="width:100%;height:72vh;border:1px solid var(--border);border-radius:8px;background:var(--bg-2)"></iframe>`
        : (fr && fr.ativo && !linhas.length && (t.linhas || []).length
          ? `<div class="tiny muted" style="padding:8px">🔎 Nenhum imóvel desta tabela casa com os filtros ativos.${fr.semDado ? ` ⚠ ${fr.semDado} linha(s) sem dado legível no(s) quesito(s) filtrado(s).` : ''}</div>`
          : ((t.linhas || []).length
            ? `<div data-tablewrap="${t.id}" style="max-height:64vh;overflow:auto;border:1px solid ${zebra ? cor + '40' : 'var(--border)'};border-radius:8px${zebra ? ';background:#ffffff' : ''}"><table style="border-collapse:collapse;width:100%;min-width:max-content">${head}${body}</table></div>`
              + (fr && fr.ativo && fr.semDado ? `<div class="tiny" style="margin-top:4px;color:var(--warn,#d97706);font-weight:700">⚠ ${fr.semDado} linha(s) ocultada(s) por não ter dado legível no(s) quesito(s) filtrado(s) — complete a tabela pra elas voltarem a aparecer.</div>` : '')
            : `<div class="tiny muted" style="padding:8px">Tabela vazia${_canEdit ? ' — clique em ✏️ Editar pra adicionar linhas.' : '.'}</div>`))}
    </div>`;
}

/* ───────── EDITOR ───────── */
function editorCard(cor) {
  const d = _draft;
  const cols = d.colunas;
  const headInputs = cols.map((c, i) => `<th style="background:${cor};padding:4px;min-width:120px">
      <div class="flex gap-1" style="align-items:center">
        <input class="input" data-h="${i}" value="${esc(c)}" style="height:26px;font-size:11px;padding:2px 5px;background:var(--bg-2);min-width:90px" placeholder="Coluna">
        <button class="btn btn-ghost btn-sm" data-delcol="${i}" title="remover coluna" style="color:#fff;padding:2px 6px">✕</button>
      </div></th>`).join('');
  const rows = d.linhas.map((r, ri) => `<tr style="border-bottom:1px solid var(--border)">
      ${cols.map((_, ci) => `<td style="padding:2px"><input class="input" data-r="${ri}" data-c="${ci}" value="${esc(r[ci] != null ? r[ci] : '')}" style="height:26px;font-size:11.5px;padding:2px 6px;width:100%;min-width:110px"></td>`).join('')}
      <td style="padding:2px;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-uprow="${ri}" ${ri === 0 ? 'disabled' : ''} style="padding:2px 5px">↑</button>
        <button class="btn btn-ghost btn-sm" data-downrow="${ri}" ${ri === d.linhas.length - 1 ? 'disabled' : ''} style="padding:2px 5px">↓</button>
        <button class="btn btn-ghost btn-sm" data-delrow="${ri}" style="padding:2px 5px;color:var(--err)">✕</button>
      </td></tr>`).join('');
  return `
    <div style="background:var(--bg-3);border:2px solid ${cor};border-radius:10px;padding:12px;margin-bottom:12px">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div class="flex gap-2" style="align-items:center;flex-wrap:wrap">
          <span class="tiny muted" style="font-weight:800">Categoria:</span>
          <input class="input" id="tl-cat" value="${esc(d.categoria)}" placeholder="ex.: MAP, Alto Padrão" style="height:30px;font-size:13px;width:200px">
          <span class="tiny muted" style="font-weight:800">📅 Vigência:</span>
          <input class="input" id="tl-vig" value="${esc(d.vigencia || '')}" placeholder="ex.: 05/2026, Maio/26" style="height:30px;font-size:13px;width:140px">
          <span class="tiny muted" style="font-weight:800">🎨 Cor:</span>
          ${SWATCHES.map(s => `<button type="button" data-cor="${s}" title="${s}" style="width:22px;height:22px;border-radius:6px;background:${s};border:2px solid ${(d.cor || '') === s ? '#111' : 'transparent'};cursor:pointer"></button>`).join('')}
          <input type="color" id="tl-cor" value="${esc(d.cor || cor)}" title="cor personalizada" style="width:32px;height:26px;padding:0;border:0;background:none;cursor:pointer">
          <button type="button" class="btn btn-ghost btn-sm" data-cor="" title="usar a cor da marca" style="padding:2px 8px">cor da marca</button>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📥 Importar xlsx<input type="file" id="tl-import" accept=".xlsx,.xls,.csv" style="display:none"></label>
          <button class="btn btn-ghost btn-sm" id="tl-cancel">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="tl-save">💾 Salvar</button>
        </div>
      </div>
      <div style="max-height:60vh;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg-2)">
        <table style="border-collapse:collapse;width:100%;min-width:max-content">
          <thead><tr>${headInputs}<th style="background:${cor};padding:4px;color:#fff;font-size:11px">ações</th></tr></thead>
          <tbody>${rows || ''}</tbody>
        </table>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="tl-addrow">➕ linha</button>
        <button class="btn btn-ghost btn-sm" id="tl-addcol">➕ coluna</button>
        <span class="tiny muted" style="align-self:center">${d.linhas.length} linha(s) · ${cols.length} coluna(s)</span>
      </div>
    </div>`;
}

function syncDraft() {
  if (!_draft) return;
  const cat = document.getElementById('tl-cat'); if (cat) _draft.categoria = cat.value;
  const vig = document.getElementById('tl-vig'); if (vig) _draft.vigencia = vig.value;
  // _draft.cor é mantido pelos handlers de swatch / seletor de cor (abaixo, no wire)
  _root.querySelectorAll('[data-h]').forEach(inp => { _draft.colunas[+inp.dataset.h] = inp.value; });
  _root.querySelectorAll('[data-r][data-c]').forEach(inp => { const ri = +inp.dataset.r, ci = +inp.dataset.c; if (_draft.linhas[ri]) _draft.linhas[ri][ci] = inp.value; });
}

function wire() {
  _root.querySelectorAll('[data-new]').forEach(b => b.onclick = () => {
    _edit = 'new:' + b.dataset.new;
    _draft = { id: '', marca: b.dataset.new, categoria: '', vigencia: '', cor: '', ordem: proximaOrdem(b.dataset.new), colunas: ['Coluna 1', 'Coluna 2'], linhas: [['', '']] };
    render();
  });
  _root.querySelectorAll('[data-importall]').forEach(inp => inp.addEventListener('change', () => importAllSheets(inp.dataset.importall, inp)));
  _root.querySelectorAll('[data-pdf]').forEach(inp => inp.addEventListener('change', () => attachPdf(inp.dataset.pdf, inp)));
  // 🎨 cor da tabela (swatch / cor personalizada / cor da marca)
  _root.querySelectorAll('[data-cor]').forEach(b => b.addEventListener('click', () => { if (!_draft) return; syncDraft(); _draft.cor = b.dataset.cor || ''; render(); }));
  const cc = document.getElementById('tl-cor'); if (cc) cc.addEventListener('input', () => { if (_draft) _draft.cor = cc.value; });
  // ↑↓ reordenar tabelas
  _root.querySelectorAll('[data-tblup]').forEach(b => b.onclick = () => moveTabela(b.dataset.tblup, -1));
  _root.querySelectorAll('[data-tbldn]').forEach(b => b.onclick = () => moveTabela(b.dataset.tbldn, +1));
  // rename inline do título da tabela
  _root.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => { _renaming = b.dataset.rename; render(); const i = document.getElementById('tl-rn'); if (i) { i.focus(); i.select(); } });
  _root.querySelectorAll('[data-rncancel]').forEach(b => b.onclick = () => { _renaming = null; render(); });
  _root.querySelectorAll('[data-rnsave]').forEach(b => b.onclick = () => renameTable(b.dataset.rnsave));
  const rn = document.getElementById('tl-rn');
  if (rn) rn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); renameTable(_renaming); } else if (e.key === 'Escape') { _renaming = null; render(); } });
  _root.querySelectorAll('[data-edittbl]').forEach(b => b.onclick = () => {
    const t = _tabelas.find(x => x.id === b.dataset.edittbl); if (!t) return;
    _draft = JSON.parse(JSON.stringify({ id: t.id, marca: t.marca, categoria: t.categoria, vigencia: t.vigencia || '', cor: t.cor || '', ordem: (t.ordem == null ? null : t.ordem), colunas: t.colunas.slice(), linhas: (t.linhas || []).map(r => r.slice()) }));
    if (!_draft.colunas.length) _draft.colunas = ['Coluna 1'];
    _edit = t.id; render();
  });
  _root.querySelectorAll('[data-deltbl]').forEach(b => b.onclick = async () => {
    const t = _tabelas.find(x => x.id === b.dataset.deltbl);
    if (!confirm('Excluir a tabela "' + (t ? t.categoria : '') + '"?')) return;
    try { const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'delete', id: b.dataset.deltbl } }); _tabelas = r.tabelas || []; render(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
  // 🖐 arrastar linha (clicar e segurar) pra reordenar — view, can_edit (v86.53)
  rowDragDocBind();
  _root.querySelectorAll('tbody[data-rowdrag]').forEach(tb => { if (tb.dataset.rowdrag) ativarDragLinha(tb, tb.dataset.rowdrag); });
  // 🔎 filtros do MAP (v86.88) — chips multi-seleção; estado só em memória
  _root.querySelectorAll('[data-fchip]').forEach(b => b.onclick = () => {
    const s = _filtros[b.dataset.fcat];
    s.has(b.dataset.fchip) ? s.delete(b.dataset.fchip) : s.add(b.dataset.fchip);
    render();
  });
  _root.querySelectorAll('[data-flimpar]').forEach(b => b.onclick = () => { _filtros = filtrosVazios(); render(); });
  // busca (view)
  _root.querySelectorAll('[data-search]').forEach(inp => inp.addEventListener('input', () => {
    const wrap = _root.querySelector(`[data-tablewrap="${inp.dataset.search}"]`); if (!wrap) return;
    const q = inp.value.toLowerCase();
    wrap.querySelectorAll('tbody tr').forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }));
  // editor
  if (_edit) {
    const $ = id => document.getElementById(id);
    $('tl-cancel') && ($('tl-cancel').onclick = () => { _edit = null; _draft = null; render(); });
    $('tl-save') && ($('tl-save').onclick = saveDraft);
    $('tl-addrow') && ($('tl-addrow').onclick = () => { syncDraft(); _draft.linhas.push(_draft.colunas.map(() => '')); render(); });
    $('tl-addcol') && ($('tl-addcol').onclick = () => { syncDraft(); _draft.colunas.push('Coluna ' + (_draft.colunas.length + 1)); _draft.linhas.forEach(r => r.push('')); render(); });
    _root.querySelectorAll('[data-delcol]').forEach(b => b.onclick = () => { syncDraft(); const c = +b.dataset.delcol; _draft.colunas.splice(c, 1); _draft.linhas.forEach(r => r.splice(c, 1)); render(); });
    _root.querySelectorAll('[data-delrow]').forEach(b => b.onclick = () => { syncDraft(); _draft.linhas.splice(+b.dataset.delrow, 1); render(); });
    _root.querySelectorAll('[data-uprow]').forEach(b => b.onclick = () => { const r = +b.dataset.uprow; if (r > 0) { syncDraft(); const a = _draft.linhas;[a[r - 1], a[r]] = [a[r], a[r - 1]]; render(); } });
    _root.querySelectorAll('[data-downrow]').forEach(b => b.onclick = () => { const r = +b.dataset.downrow; if (r < _draft.linhas.length - 1) { syncDraft(); const a = _draft.linhas;[a[r + 1], a[r]] = [a[r], a[r + 1]]; render(); } });
    const imp = $('tl-import'); if (imp) imp.addEventListener('change', () => importXlsx(imp));
  }
}

/* ───────── Arrastar linha (clicar e segurar) — v86.53 ─────────
   Pointer Events (mouse + dedo). Engate: imediato na alça ⠿, ou segurando
   ~0,3s em qualquer ponto da linha (mexeu antes de engatar = é scroll, solta).
   Soltou → reordena t.linhas e salva a tabela inteira (mesmo caminho do rename). */
function ativarDragLinha(tbody, tabelaId) {
  let alvo = null, ghost = null, marca = null, engatado = false, timer = null, x0 = 0, y0 = 0, pid = null;

  const limpar = () => {
    clearTimeout(timer); timer = null;
    if (ghost) ghost.remove(); ghost = null;
    if (marca) marca.style.boxShadow = ''; marca = null;
    if (alvo) alvo.style.opacity = '';
    alvo = null; engatado = false; pid = null;
    document.body.style.userSelect = '';
  };

  const engatar = (ev) => {
    if (!alvo) return;
    engatado = true;
    document.body.style.userSelect = 'none';
    alvo.style.opacity = '.35';
    ghost = document.createElement('div');
    ghost.textContent = '↕ ' + (alvo.cells[1] ? alvo.cells[1].textContent : alvo.textContent).trim().slice(0, 40);
    ghost.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;background:var(--bg-2,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.25)';
    document.body.appendChild(ghost);
    mover(ev);
  };

  const mover = (ev) => {
    if (!engatado) return;
    ev.preventDefault();
    if (ghost) { ghost.style.left = (ev.clientX + 12) + 'px'; ghost.style.top = (ev.clientY + 8) + 'px'; }
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const tr = el && el.closest ? el.closest('tr[data-ri]') : null;
    if (marca) marca.style.boxShadow = '';
    marca = (tr && tr !== alvo && tr.parentElement === tbody) ? tr : null;
    if (marca) {
      const acima = +marca.dataset.ri < +alvo.dataset.ri;
      marca.style.boxShadow = acima ? 'inset 0 3px 0 0 #2563eb' : 'inset 0 -3px 0 0 #2563eb';
    }
  };

  const soltar = async () => {
    if (!engatado || !alvo) { limpar(); return; }
    const de = +alvo.dataset.ri;
    const para = marca ? +marca.dataset.ri : null;
    limpar();
    if (para == null || para === de) return;
    const t = _tabelas.find(x => x.id === tabelaId);
    if (!t || !(t.linhas || []).length) return;
    const linhas = t.linhas.map(r => r.slice());
    const [row] = linhas.splice(de, 1);
    linhas.splice(para, 0, row);
    t.linhas = linhas;           // otimista: a tela já mostra a nova ordem
    render();
    const m = document.getElementById('tl-msg'); if (m) m.textContent = '⏳ salvando a ordem…';
    try {
      const tabela = {
        id: t.id, marca: t.marca, categoria: t.categoria, vigencia: t.vigencia || '',
        cor: t.cor || '', ordem: (t.ordem == null ? null : t.ordem),
        tipo: t.tipo || 'grade', pdf_url: t.pdf_url || null,
        colunas: t.colunas || [], linhas: t.linhas,
      };
      const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'save', tabela } });
      _tabelas = r.tabelas || _tabelas;
      const m2 = document.getElementById('tl-msg'); if (m2) m2.textContent = '💾 ordem salva.';
    } catch (e) {
      alert('❌ NÃO SALVOU a ordem: ' + e.message);
      await load(); render();
    }
  };

  tbody.addEventListener('pointerdown', ev => {
    if (ev.button != null && ev.button !== 0) return;
    const tr = ev.target.closest ? ev.target.closest('tr[data-ri]') : null;
    if (!tr || tr.parentElement !== tbody) return;
    alvo = tr; x0 = ev.clientX; y0 = ev.clientY; pid = ev.pointerId;
    if (ev.target.closest('[data-rowgrip]')) {
      ev.preventDefault();
      engatar(ev);                                  // alça ⠿: engata na hora
    } else if (ev.pointerType === 'mouse') {
      timer = setTimeout(() => engatar(ev), 300);   // linha inteira: segurar 0,3s (mouse)
    } else {
      alvo = null;                                  // dedo fora da alça = scroll normal
    }
  });
  tbody.addEventListener('pointermove', ev => {
    if (timer && !engatado && (Math.abs(ev.clientX - x0) > 6 || Math.abs(ev.clientY - y0) > 6)) { clearTimeout(timer); timer = null; alvo = null; return; }
    mover(ev);
  });
  ['pointerup', 'pointercancel'].forEach(n => tbody.addEventListener(n, () => { if (engatado) soltar(); else limpar(); }));
  tbody.addEventListener('dragstart', ev => ev.preventDefault());
  // o ponteiro pode sair do tbody durante o arrasto — o singleton do documento
  // (abaixo) delega pra instância ativa; registra esta como a ativa ao engatar
  tbody.addEventListener('pointerdown', () => { _rowDragAtivo = { mover: ev => { if (engatado && ev.pointerId === pid) mover(ev); }, soltar: ev => { if (engatado && ev.pointerId === pid) soltar(); } }; });
}

// listeners de documento do arrasto de linha: UMA vez só (senão acumulam a cada render)
let _rowDragAtivo = null;
let _rowDragDocOk = false;
function rowDragDocBind() {
  if (_rowDragDocOk) return;
  _rowDragDocOk = true;
  document.addEventListener('pointermove', ev => { if (_rowDragAtivo) _rowDragAtivo.mover(ev); });
  document.addEventListener('pointerup', ev => { if (_rowDragAtivo) _rowDragAtivo.soltar(ev); });
}

async function importXlsx(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const m = document.getElementById('tl-msg'); if (m) m.textContent = '⏳ lendo planilha…';
  try {
    syncDraft();
    await loadXLSX();
    if (!window.XLSX) throw new Error('sem leitor de planilha');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // raw:false → o SheetJS FORMATA célula (preço/data viram texto legível) em vez de
    // devolver o serial cru do Excel (ex.: 45678 no lugar de uma data / R$).
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false, defval: '' });
    if (!aoa.length) throw new Error('planilha vazia');
    _draft.colunas = (aoa[0] || []).map(c => String(c == null ? '' : c) || 'Coluna');
    _draft.linhas = aoa.slice(1).filter(r => r.some(c => String(c).trim() !== '')).map(r => {
      const row = _draft.colunas.map((_, i) => (r[i] == null ? '' : String(r[i])));
      return row;
    });
    if (m) m.textContent = '✅ planilha carregada na grade — revise e salve.';
    render();
  } catch (e) { if (m) m.textContent = '⚠️ ' + e.message; input.value = ''; }
}

async function saveDraft() {
  syncDraft();
  if (!(_draft.categoria || '').trim()) { alert('Dê um nome à categoria.'); return; }
  const m = document.getElementById('tl-msg'); if (m) m.textContent = '⏳ salvando…';
  try {
    const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'save', tabela: _draft } });
    _tabelas = r.tabelas || _tabelas; _edit = null; _draft = null; _msg = '';
    render();
    const m2 = document.getElementById('tl-msg'); if (m2) m2.textContent = '💾 salvo.';
  } catch (e) {
    const mm = document.getElementById('tl-msg'); if (mm) mm.textContent = '⚠️ ' + e.message;
    alert('❌ NÃO SALVOU: ' + e.message + '\nSuas alterações continuam na tela — tente salvar de novo.');
  }
}

// Renomeia só o título (categoria) — envia a tabela INTEIRA pra não zerar linhas/colunas.
async function renameTable(id) {
  const t = _tabelas.find(x => x.id === id); if (!t) return;
  const novo = (document.getElementById('tl-rn')?.value || '').trim();
  if (!novo) { alert('Dê um nome à tabela.'); return; }
  const tabela = {
    id: t.id, marca: t.marca, categoria: novo, vigencia: t.vigencia || '',
    cor: t.cor || '', ordem: (t.ordem == null ? null : t.ordem),
    tipo: t.tipo || 'grade', pdf_url: t.pdf_url || null,
    colunas: t.colunas || [], linhas: t.linhas || [],
  };
  try {
    const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'save', tabela } });
    _tabelas = r.tabelas || _tabelas; _renaming = null; render();
  } catch (e) { alert('Erro ao renomear: ' + e.message); }
}

// próxima posição (vai pro fim da marca)
function proximaOrdem(marca) {
  const os = _tabelas.filter(t => t.marca === marca).map(t => (t.ordem == null ? -1 : t.ordem));
  return (os.length ? Math.max(...os) : -1) + 1;
}

// move uma tabela ↑/↓ dentro da marca e persiste a nova ordem (ação reorder)
async function moveTabela(id, dir) {
  const t = _tabelas.find(x => x.id === id); if (!t) return;
  const ord = x => (x.ordem == null ? 9999 : x.ordem);
  const lista = _tabelas.filter(x => x.marca === t.marca)
    .sort((a, b) => (ord(a) - ord(b)) || (a.categoria || '').localeCompare(b.categoria || '', 'pt-BR'));
  const i = lista.findIndex(x => x.id === id), j = i + dir;
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  const ids = lista.map(x => x.id);
  try {
    const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'reorder', marca: t.marca, ids } });
    _tabelas = r.tabelas || _tabelas; render();
  } catch (e) { const mm = document.getElementById('tl-msg'); if (mm) mm.textContent = '⚠️ ' + e.message; }
}

function fileToB64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
}

// AOA da planilha trocando o texto da célula pela URL do HYPERLINK (quando houver),
// pra que a coluna LINK DRIVE chegue como URL clicável (e não só "link").
function sheetMatrix(ws) {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const out = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = []; let any = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let v = '';
      if (cell) {
        if (cell.l && cell.l.Target) v = cell.l.Target;          // hyperlink → URL real
        else if (cell.w != null) v = cell.w;                      // texto já formatado
        else if (cell.v != null) v = cell.v;
      }
      v = (v == null ? '' : String(v));
      if (v.trim() !== '') any = true;
      row.push(v);
    }
    if (any) out.push(row);   // pula linhas totalmente vazias (= blankrows:false)
  }
  return out;
}

// Importa TODAS as abas da planilha — cada aba vira uma tabela (categoria = nome da aba).
async function importAllSheets(marca, input) {
  const file = input.files && input.files[0]; if (!file) return;
  const m = document.getElementById('tl-msg'); const setMsg = h => { const e = document.getElementById('tl-msg'); if (e) e.textContent = h; };
  setMsg('⏳ lendo abas da planilha…');
  try {
    await loadXLSX();
    if (!window.XLSX) throw new Error('sem leitor de planilha');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    let n = 0;
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const aoa = sheetMatrix(ws);   // captura URL de hyperlink no lugar do texto "link"
      if (!aoa.length) continue;
      const colunas = (aoa[0] || []).map(c => String(c == null ? '' : c) || 'Coluna');
      const linhas = aoa.slice(1).filter(r => r.some(c => String(c).trim() !== '')).map(r => colunas.map((_, i) => (r[i] == null ? '' : String(r[i]))));
      if (!linhas.length && colunas.every(c => !c.trim())) continue;
      const cat = String(sheetName).trim() || ('Aba ' + (n + 1));
      const ex = _tabelas.find(t => t.marca === marca && t.tipo !== 'pdf' && normCat(t.categoria) === normCat(cat));
      const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'save', tabela: { id: ex ? ex.id : '', marca, categoria: cat, vigencia: ex ? (ex.vigencia || '') : '', cor: ex ? (ex.cor || '') : '', ordem: ex ? (ex.ordem == null ? null : ex.ordem) : proximaOrdem(marca), tipo: 'grade', colunas, linhas } } });
      _tabelas = r.tabelas || _tabelas; n++;
      setMsg(`⏳ importando… ${n} aba(s)`);
    }
    await load(); render();
    setMsg(`✅ ${n} aba(s) importada(s) como tabela(s).`);
  } catch (e) { setMsg('⚠️ ' + e.message); input.value = ''; }
}

// Anexa um PDF (renderiza embutido + baixar).
async function attachPdf(marca, input) {
  const file = input.files && input.files[0]; if (!file) return;
  const setMsg = h => { const e = document.getElementById('tl-msg'); if (e) e.textContent = h; };
  if (file.size > 4 * 1024 * 1024) { setMsg(`⚠️ PDF de ${(file.size / 1048576).toFixed(1)}MB (limite 4MB). Use uma versão menor.`); input.value = ''; return; }
  setMsg('⏳ enviando PDF…');
  try {
    const up = await api.request('/api/v3/upload_file', { method: 'POST', body: { folder: 'tabelas', filename: file.name, content_b64: await fileToB64(file) } });
    if (!up.ok || !up.url) throw new Error(up.error || 'falha no upload');
    const cat = file.name.replace(/\.pdf$/i, '');
    const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'save', tabela: { id: '', marca, categoria: cat, ordem: proximaOrdem(marca), tipo: 'pdf', pdf_url: up.url, colunas: [], linhas: [] } } });
    _tabelas = r.tabelas || _tabelas;
    await load(); render();
    setMsg('✅ PDF anexado e exibido.');
  } catch (e) { setMsg('⚠️ ' + e.message); input.value = ''; }
}

// mesma normalização do backend (dedup): sem acento, trim, minúscula
function normCat(s) {
  return String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// aviso de tabelas homônimas (a raiz do "salvei mas voltou a versão anterior")
function dupBadge(t) {
  const n = _tabelas.filter(x => x.id !== t.id && x.marca === t.marca &&
    (x.tipo || 'grade') === (t.tipo || 'grade') && normCat(x.categoria) === normCat(t.categoria)).length;
  return n ? ` <span class="badge" title="Existem ${n + 1} tabelas com este nome nesta marca. Confira a data de atualização — a próxima gravação nesta categoria consolida tudo na versão nova." style="background:#d9770622;color:var(--warn);font-weight:700;font-size:10px">⚠️ nome duplicado</span>` : '';
}

function fmtData(iso) {
  if (!iso) return 'novo';
  try { const d = new Date(iso); return 'atualizado ' + d.toLocaleDateString('pt-BR'); } catch { return ''; }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
