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

const MARCAS = [
  { id: 'conquista', label: '🏆 PSM Conquista', cor: '#dc2626' },
  { id: 'imoveis', label: '✨ PSM Imóveis', cor: '#d4a843' },
];

export async function pageTabelaImoveis(ctx, root) {
  _root = root; _edit = null; _draft = null; _msg = '';
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
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📊 Tabela de Lançamentos PSM</h2>
      <p class="card-sub">Montada dentro do sistema — <b>🏆 PSM Conquista</b> e <b>✨ PSM Imóveis</b> (com categorias, ex.: MAP). ${_canEdit ? 'Edite linhas e colunas direto aqui; importe xlsx só pra preencher rápido.' : 'Somente leitura.'}</p>
      <div id="tl-msg" class="tiny" style="margin:4px 0">${_msg ? esc(_msg) : ''}</div>
      ${MARCAS.map(m => marcaSection(m)).join('')}
    </div>`;
  wire();
}

function marcaSection(m) {
  const tabs = _tabelas.filter(t => t.marca === m.id).sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '', 'pt-BR'));
  const editingNew = _edit === ('new:' + m.id);
  return `
    <div class="mt-4" style="border-top:3px solid ${m.cor};border-radius:10px;padding-top:10px">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0;color:${m.cor}">${m.label} <span class="tiny muted" style="font-weight:600">· ${tabs.length} tabela(s)</span></h3>
        ${_canEdit && !_edit ? `<button class="btn btn-primary btn-sm" data-new="${m.id}">➕ Nova tabela</button>` : ''}
      </div>
      ${editingNew ? editorCard(m.cor) : ''}
      ${tabs.map(t => (_edit === t.id ? editorCard(m.cor) : viewCard(t, m.cor))).join('')
        || (editingNew ? '' : `<div class="tiny muted" style="padding:6px 2px">Nenhuma tabela ainda${_canEdit ? ' — clique em ➕ Nova tabela.' : '.'}</div>`)}
    </div>`;
}

/* ───────── VIEW ───────── */
function viewCard(t, cor) {
  const cols = t.colunas && t.colunas.length ? t.colunas : (t.linhas[0] || []).map((_, i) => 'Col ' + (i + 1));
  const head = `<thead><tr>${cols.map(c => `<th style="position:sticky;top:0;background:${cor};color:#fff;padding:7px 9px;font-size:11.5px;text-align:left;white-space:nowrap;z-index:1">${esc(c)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${(t.linhas || []).map(r => `<tr style="border-bottom:1px solid var(--border)">${cols.map((_, i) => `<td style="padding:6px 9px;font-size:12px;white-space:nowrap">${esc(r[i] != null ? r[i] : '')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:12px">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <b style="font-size:13px">📋 ${esc(t.categoria || 'Sem categoria')} <span class="tiny muted" style="font-weight:600">· ${(t.linhas || []).length} linha(s) · ${fmtData(t.atualizado_em)}</span></b>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${(t.linhas || []).length ? `<input class="input" data-search="${t.id}" placeholder="🔍 buscar…" style="height:30px;font-size:12px;width:150px">` : ''}
          ${_canEdit && !_edit ? `<button class="btn btn-ghost btn-sm" data-edittbl="${t.id}">✏️ Editar</button><button class="btn btn-ghost btn-sm" data-deltbl="${t.id}">🗑</button>` : ''}
        </div>
      </div>
      ${(t.linhas || []).length
        ? `<div data-tablewrap="${t.id}" style="max-height:64vh;overflow:auto;border:1px solid var(--border);border-radius:8px"><table style="border-collapse:collapse;width:100%;min-width:max-content">${head}${body}</table></div>`
        : `<div class="tiny muted" style="padding:8px">Tabela vazia${_canEdit ? ' — clique em ✏️ Editar pra adicionar linhas.' : '.'}</div>`}
    </div>`;
}

/* ───────── EDITOR ───────── */
function editorCard(cor) {
  const d = _draft;
  const cols = d.colunas;
  const headInputs = cols.map((c, i) => `<th style="background:${cor};padding:4px;min-width:120px">
      <div class="flex gap-1" style="align-items:center">
        <input class="input" data-h="${i}" value="${esc(c)}" style="height:26px;font-size:11px;padding:2px 5px;background:#fff;min-width:90px" placeholder="Coluna">
        <button class="btn btn-ghost btn-sm" data-delcol="${i}" title="remover coluna" style="color:#fff;padding:2px 6px">✕</button>
      </div></th>`).join('');
  const rows = d.linhas.map((r, ri) => `<tr style="border-bottom:1px solid var(--border)">
      ${cols.map((_, ci) => `<td style="padding:2px"><input class="input" data-r="${ri}" data-c="${ci}" value="${esc(r[ci] != null ? r[ci] : '')}" style="height:26px;font-size:11.5px;padding:2px 6px;width:100%;min-width:110px"></td>`).join('')}
      <td style="padding:2px;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-uprow="${ri}" ${ri === 0 ? 'disabled' : ''} style="padding:2px 5px">↑</button>
        <button class="btn btn-ghost btn-sm" data-downrow="${ri}" ${ri === d.linhas.length - 1 ? 'disabled' : ''} style="padding:2px 5px">↓</button>
        <button class="btn btn-ghost btn-sm" data-delrow="${ri}" style="padding:2px 5px;color:#dc2626">✕</button>
      </td></tr>`).join('');
  return `
    <div style="background:var(--bg-3);border:2px solid ${cor};border-radius:10px;padding:12px;margin-bottom:12px">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div class="flex gap-2" style="align-items:center">
          <span class="tiny muted" style="font-weight:800">Categoria:</span>
          <input class="input" id="tl-cat" value="${esc(d.categoria)}" placeholder="ex.: MAP, Alto Padrão, Junho/26" style="height:30px;font-size:13px;width:220px">
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
  _root.querySelectorAll('[data-h]').forEach(inp => { _draft.colunas[+inp.dataset.h] = inp.value; });
  _root.querySelectorAll('[data-r][data-c]').forEach(inp => { const ri = +inp.dataset.r, ci = +inp.dataset.c; if (_draft.linhas[ri]) _draft.linhas[ri][ci] = inp.value; });
}

function wire() {
  _root.querySelectorAll('[data-new]').forEach(b => b.onclick = () => {
    _edit = 'new:' + b.dataset.new;
    _draft = { id: '', marca: b.dataset.new, categoria: '', colunas: ['Coluna 1', 'Coluna 2'], linhas: [['', '']] };
    render();
  });
  _root.querySelectorAll('[data-edittbl]').forEach(b => b.onclick = () => {
    const t = _tabelas.find(x => x.id === b.dataset.edittbl); if (!t) return;
    _draft = JSON.parse(JSON.stringify({ id: t.id, marca: t.marca, categoria: t.categoria, colunas: t.colunas.slice(), linhas: (t.linhas || []).map(r => r.slice()) }));
    if (!_draft.colunas.length) _draft.colunas = ['Coluna 1'];
    _edit = t.id; render();
  });
  _root.querySelectorAll('[data-deltbl]').forEach(b => b.onclick = async () => {
    const t = _tabelas.find(x => x.id === b.dataset.deltbl);
    if (!confirm('Excluir a tabela "' + (t ? t.categoria : '') + '"?')) return;
    try { const r = await api.request('/api/v3/tabelas/lancamentos', { method: 'POST', body: { action: 'delete', id: b.dataset.deltbl } }); _tabelas = r.tabelas || []; render(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
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

async function importXlsx(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const m = document.getElementById('tl-msg'); if (m) m.textContent = '⏳ lendo planilha…';
  try {
    syncDraft();
    await loadXLSX();
    if (!window.XLSX) throw new Error('sem leitor de planilha');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
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
  } catch (e) { const mm = document.getElementById('tl-msg'); if (mm) mm.textContent = '⚠️ ' + e.message; }
}

function fmtData(iso) {
  if (!iso) return 'novo';
  try { const d = new Date(iso); return 'atualizado ' + d.toLocaleDateString('pt-BR'); } catch { return ''; }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
