/* ============================================================================
   PSM-OS v2 — Minutas / Documentos padrão (biblioteca por link do Google Drive)
   Dois escopos: 'juridico' (Diretoria → Minutas padrão) e 'locacao'
   (Locação → Minutas e fichas). Cada item = nome + categoria + link Drive + obs.
   Visualizar/baixar: qualquer um que vê a aba. Editar: lvl≥7 (jurídico) / ≥5 (locação).
============================================================================ */
import { api } from '../api.js';
import { driveDownload } from '../links.js';

const META = {
  juridico: {
    title: '📜 Minutas padrão',
    sub: 'Modelos de minutas de toda relação jurídica da imobiliária. Anexe por nome + link do Google Drive.',
    cats: ['Compra e venda', 'Locação', 'Permuta', 'Distrato', 'Procuração', 'Aditivo', 'Confissão de dívida', 'Notificação', 'Parceria', 'Outros'],
  },
  locacao: {
    title: '📑 Minutas e fichas · Locação',
    sub: 'Minutas e fichas padrão da locação. Anexe por nome + link do Google Drive.',
    cats: ['Contrato de locação', 'Ficha cadastral', 'Vistoria', 'Renovação', 'Rescisão', 'Garantia / Fiador', 'Termo de entrega', 'Notificação', 'Outros'],
  },
};

let _root = null, _scope = null, _items = [], _canEdit = false, _q = '', _editing = null, _busy = false, _cats = [], _catMgr = false, _catDraft = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const catColor = c => { let h = 0; for (const ch of String(c || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h},55%,45%)`; };

export function pageMinutasJuridico(ctx, root) { return boot('juridico', root); }
export function pageMinutasLocacao(ctx, root) { return boot('locacao', root); }

async function boot(scope, root) {
  _root = root; _scope = scope; _q = ''; _editing = null; _busy = false;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando minutas…</div></div>';
  await load();
}

async function load() {
  try {
    const r = await api.request(`/api/v3/docs/minutas?scope=${_scope}`);
    _items = r.items || [];
    _canEdit = !!r.can_edit;
    _cats = (r.categorias && r.categorias.length) ? r.categorias : META[_scope].cats;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function render() {
  const meta = META[_scope];
  const q = _q.trim().toLowerCase();
  const filt = !q ? _items : _items.filter(it =>
    [it.nome, it.categoria, it.obs].some(v => String(v || '').toLowerCase().includes(q)));

  // agrupa por categoria
  const groups = {};
  filt.forEach(it => { const c = it.categoria || 'Sem categoria'; (groups[c] = groups[c] || []).push(it); });
  const catNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">${meta.title}</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:640px">${meta.sub}</p>
        </div>
        <div class="flex gap-2" style="align-items:center">
          <input id="mn-q" class="input" placeholder="🔎 Buscar…" value="${esc(_q)}" style="max-width:200px">
          ${_canEdit ? `<button class="btn btn-ghost btn-sm" id="mn-cats" title="Gerenciar categorias">⚙️ Categorias</button>` : ''}
          ${_canEdit ? `<button class="btn btn-primary btn-sm" id="mn-add">➕ Adicionar minuta</button>` : ''}
        </div>
      </div>
      ${_catMgr && _canEdit ? catMgrHTML() : ''}

      <div class="flex gap-3 mt-2" style="flex-wrap:wrap">
        <span class="tiny muted">📁 ${_items.length} documento(s)${q ? ` · ${filt.length} no filtro` : ''}</span>
        ${!_canEdit ? `<span class="tiny muted">· somente leitura (download liberado)</span>` : ''}
      </div>

      ${_editing !== null ? formHTML() : ''}

      ${!filt.length ? `
        <div class="card mt-3" style="text-align:center;padding:30px;background:var(--bg-3)">
          <div style="font-size:30px">🗂️</div>
          <div class="muted tiny" style="margin-top:6px">${_items.length ? 'Nenhum documento no filtro.' : 'Nenhuma minuta cadastrada ainda.'}</div>
          ${_canEdit && !_items.length ? `<button class="btn btn-primary btn-sm mt-2" id="mn-add2">➕ Adicionar a primeira</button>` : ''}
        </div>` : catNames.map(cat => groupHTML(cat, groups[cat])).join('')}
    </div>`;

  wire();
}

function groupHTML(cat, items) {
  const cor = catColor(cat);
  return `
    <div class="card mt-3">
      <h3 class="card-title" style="font-size:13px;display:flex;align-items:center;gap:7px">
        <span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${cor}"></span>
        ${esc(cat)} <span class="tiny muted" style="font-weight:400">(${items.length})</span>
      </h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${items.map(it => rowHTML(it, cor)).join('')}
      </div>
    </div>`;
}

function rowHTML(it, cor) {
  return `
    <div class="flex items-center" style="justify-content:space-between;gap:10px;flex-wrap:wrap;border:1px solid var(--bd);border-left:3px solid ${cor};border-radius:10px;padding:10px 12px">
      <div style="min-width:200px;flex:1">
        <div style="font-weight:700;font-size:13.5px">📄 ${esc(it.nome)}</div>
        ${it.obs ? `<div class="tiny muted" style="margin-top:2px">${esc(it.obs)}</div>` : ''}
        ${it.updated_by || it.created_by ? `<div class="tiny muted" style="margin-top:3px;opacity:.7">por ${esc(it.updated_by || it.created_by)}</div>` : ''}
      </div>
      <div class="flex gap-2" style="align-items:center">
        <a class="btn btn-primary btn-sm" href="${esc(driveDownload(it.url))}" rel="noopener noreferrer" download title="Baixa o arquivo (não abre online)">⬇️ Baixar</a>
        ${_canEdit ? `
          <button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}" title="Editar">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" title="Excluir" style="color:#dc2626">🗑</button>` : ''}
      </div>
    </div>`;
}

function formHTML() {
  const meta = META[_scope];
  const ed = _editing && _editing !== 'new' ? _items.find(i => i.id === _editing) : null;
  return `
    <div class="card mt-3" style="background:var(--bg-3);border:1px solid var(--bd)">
      <h3 class="card-title" style="font-size:13px">${ed ? '✏️ Editar minuta' : '➕ Nova minuta'}</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div style="flex:2;min-width:220px">
          <label class="tiny muted">Nome do documento *</label>
          <input id="f-nome" class="input" placeholder="Ex.: Contrato de compra e venda — pessoa física" value="${esc(ed?.nome || '')}">
        </div>
        <div style="flex:1;min-width:160px">
          <label class="tiny muted">Categoria</label>
          <input id="f-cat" class="input" list="mn-cats" placeholder="Categoria" value="${esc(ed?.categoria || '')}">
          <datalist id="mn-cats">${_cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        </div>
      </div>
      <div class="mt-2">
        <label class="tiny muted">Link do Google Drive *</label>
        <input id="f-url" class="input" placeholder="https://drive.google.com/…" value="${esc(ed?.url || '')}">
      </div>
      <div class="mt-2">
        <label class="tiny muted">Observação (opcional)</label>
        <input id="f-obs" class="input" placeholder="Quando usar, versão, etc." value="${esc(ed?.obs || '')}">
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary btn-sm" id="f-save">${_busy ? '⏳ Salvando…' : '💾 Salvar'}</button>
        <button class="btn btn-ghost btn-sm" id="f-cancel">Cancelar</button>
      </div>
      <p class="tiny muted mt-2">💡 No Drive: botão direito no arquivo → <b>Compartilhar</b> → "Qualquer pessoa com o link" → <b>Copiar link</b>, e cole aqui.</p>
    </div>`;
}

function catMgrHTML() {
  return `
    <div class="card mt-3" style="background:var(--bg-3);border:1px solid var(--bd)">
      <h3 class="card-title" style="font-size:13px">⚙️ Categorias de minutas (personalizável)</h3>
      <p class="tiny muted" style="margin:0 0 8px">Crie, renomeie ou remova. Renomear atualiza as minutas dessa categoria automaticamente.</p>
      <div id="cat-list" style="display:flex;flex-direction:column;gap:6px">
        ${_catDraft.map((c, i) => `<div class="flex gap-2" style="align-items:center">
          <input class="input" data-cat="${i}" value="${esc(c.val)}" style="max-width:320px" placeholder="Nome da categoria">
          <button class="btn btn-ghost btn-sm" data-catdel="${i}" style="color:#dc2626">🗑</button>
        </div>`).join('')}
      </div>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" id="cat-add">➕ categoria</button>
        <button class="btn btn-primary btn-sm" id="cat-save" style="margin-left:auto">💾 Salvar categorias</button>
        <button class="btn btn-ghost btn-sm" id="cat-cancel">Fechar</button>
      </div>
    </div>`;
}

function syncCatDraft() {
  _root.querySelectorAll('#cat-list [data-cat]').forEach(inp => { const i = +inp.dataset.cat; if (_catDraft[i]) _catDraft[i].val = (inp.value || '').trim(); });
}

async function saveCats() {
  syncCatDraft();
  const categorias = [], renames = {}, seen = new Set();
  for (const r of _catDraft) {
    if (!r.val || seen.has(r.val.toLowerCase())) continue;
    seen.add(r.val.toLowerCase());
    categorias.push(r.val);
    if (r.orig && r.orig !== r.val) renames[r.orig] = r.val;
  }
  try {
    const res = await api.request('/api/v3/docs/minutas', { method: 'POST', body: { scope: _scope, action: 'set_cats', categorias, renames } });
    _cats = res.categorias || categorias; _items = res.items || _items; _catMgr = false;
    render();
  } catch (e) { alert('Erro ao salvar categorias: ' + e.message); }
}

function wire() {
  const $ = s => _root.querySelector(s);
  const qEl = $('#mn-q');
  if (qEl) qEl.oninput = () => { _q = qEl.value; const pos = qEl.selectionStart; render(); const n = _root.querySelector('#mn-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } };
  const openForm = (id) => { _editing = id; render(); };
  $('#mn-add') && ($('#mn-add').onclick = () => openForm('new'));
  $('#mn-add2') && ($('#mn-add2').onclick = () => openForm('new'));
  _root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(b.dataset.edit));
  _root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  $('#f-cancel') && ($('#f-cancel').onclick = () => { _editing = null; render(); });
  $('#f-save') && ($('#f-save').onclick = save);
  // gerenciador de categorias
  $('#mn-cats') && ($('#mn-cats').onclick = () => { _catMgr = !_catMgr; if (_catMgr) _catDraft = _cats.map(c => ({ orig: c, val: c })); render(); });
  $('#cat-cancel') && ($('#cat-cancel').onclick = () => { _catMgr = false; render(); });
  $('#cat-save') && ($('#cat-save').onclick = saveCats);
  $('#cat-add') && ($('#cat-add').onclick = () => { syncCatDraft(); _catDraft.push({ orig: '', val: '' }); render(); });
  _root.querySelectorAll('[data-catdel]').forEach(b => b.onclick = () => { syncCatDraft(); _catDraft.splice(+b.dataset.catdel, 1); render(); });
}

async function save() {
  if (_busy) return;
  const $ = s => _root.querySelector(s);
  const item = {
    nome: ($('#f-nome')?.value || '').trim(),
    categoria: ($('#f-cat')?.value || '').trim(),
    url: ($('#f-url')?.value || '').trim(),
    obs: ($('#f-obs')?.value || '').trim(),
  };
  if (!item.nome) return alert('Informe o nome do documento.');
  if (!/^https?:\/\//i.test(item.url)) return alert('Cole um link válido do Google Drive (começando com http/https).');
  _busy = true; render();
  try {
    const isNew = _editing === 'new';
    await api.request('/api/v3/docs/minutas', {
      method: 'POST',
      body: isNew
        ? { scope: _scope, action: 'add', item }
        : { scope: _scope, action: 'update', id: _editing, item },
    });
    _editing = null; _busy = false;
    await load();
  } catch (e) {
    _busy = false; render();
    alert('Erro ao salvar: ' + e.message);
  }
}

async function del(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir a minuta "${it?.nome || ''}"? (o arquivo no Drive não é afetado)`)) return;
  try {
    await api.request('/api/v3/docs/minutas', {
      method: 'POST',
      body: { scope: _scope, action: 'delete', id },
    });
    await load();
  } catch (e) {
    alert('Erro ao excluir: ' + e.message);
  }
}
