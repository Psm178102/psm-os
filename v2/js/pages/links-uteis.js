/* ============================================================================
   PSM-OS v2 — 🔗 Links úteis (Secretaria de Vendas & Backoffice)
   Atalhos do dia a dia: 2ª via CPFL, IPTU (Rio Preto/Mirassol/Bady), SEMAE,
   troca de titularidade, cartórios… Só o sócio (lvl10) adiciona/edita/exclui —
   igual ao Cofre. Agrupa por categoria, busca, e cada item abre o link.
============================================================================ */
import { api } from '../api.js';

let _root = null, _items = [], _cats = [], _canManage = false, _editing = null, _busy = false, _q = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const catColor = c => { let h = 0; for (const ch of String(c || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h},55%,45%)`; };

export async function pageLinksUteis(ctx, root) {
  _root = root; _editing = null; _busy = false; _q = '';
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando links úteis…</div></div>';
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/secretaria/links');
    _items = r.items || [];
    _cats = r.categorias || [];
    _canManage = !!r.can_manage;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function filtrados() {
  const q = _q.trim().toLowerCase();
  if (!q) return _items.slice();
  return _items.filter(it => [it.titulo, it.categoria, it.orgao, it.cidade, it.obs].some(v => String(v || '').toLowerCase().includes(q)));
}

function render() {
  const list = filtrados();
  const groups = {};
  list.forEach(it => { const c = (it.categoria || '').trim() || 'Sem categoria'; (groups[c] = groups[c] || []).push(it); });
  const order = [];
  _cats.forEach(c => { if (groups[c]) order.push(c); });
  Object.keys(groups).filter(c => !_cats.includes(c) && c !== 'Sem categoria').sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(c => order.push(c));
  if (groups['Sem categoria']) order.push('Sem categoria');

  _root.innerHTML = `
    <style>
      .lk-link{display:flex;align-items:center;gap:10px;border:1px solid var(--bd);border-left:4px solid var(--c);border-radius:11px;padding:11px 14px;margin-bottom:8px}
      .lk-link .ttl{font-size:14px;font-weight:700}
      .lk-meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink-muted,#64748b);margin-top:2px}
      .lk-meta b{color:var(--ink,#0f172a);font-weight:600}
      .lk-cat-h{font-size:13px;display:flex;align-items:center;gap:8px;margin:0 0 2px}
    </style>
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">🔗 Links úteis — atalhos do dia a dia</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:700px">${_canManage
            ? 'Atalhos que a secretaria/backoffice usa toda hora: 2ª via de energia, IPTU por cidade, SEMAE, troca de titularidade… Você adiciona, edita e exclui.'
            : 'Atalhos úteis do dia a dia. Clique para abrir. 🔗'}</p>
        </div>
        ${_canManage ? `<button class="btn btn-primary btn-sm" id="lk-new">➕ Novo link</button>` : ''}
      </div>

      ${_editing !== null ? formHTML() : ''}

      ${_items.length ? `<input id="lk-q" class="input mt-2" placeholder="🔎 Buscar por nome, categoria, concessionária, cidade…" value="${esc(_q)}">` : ''}

      ${!_items.length ? `
        <div class="card mt-3" style="text-align:center;padding:32px;background:var(--bg-3)">
          <div style="font-size:30px">🔗</div>
          <div class="muted tiny" style="margin-top:6px">${_canManage ? 'Nenhum link cadastrado ainda. Clique em “➕ Novo link”.' : 'Nenhum link cadastrado ainda.'}</div>
        </div>`
        : (list.length ? order.map(c => groupHTML(c, groups[c])).join('') : '<div class="muted tiny mt-3">Nada encontrado para a busca.</div>')}

      ${_canManage ? '<p class="tiny muted mt-3">🔗 Cole o link do serviço (2ª via, emissão, portal). Use a categoria pra organizar e a cidade pra achar rápido (Rio Preto, Mirassol, Bady…).</p>' : ''}
    </div>`;
  wire();
}

function groupHTML(cat, items) {
  const cor = catColor(cat);
  return `<div class="card mt-3">
    <h3 class="lk-cat-h"><span style="width:10px;height:10px;border-radius:3px;background:${cor};display:inline-block"></span>${esc(cat)} <span class="tiny muted" style="font-weight:400">(${items.length})</span></h3>
    ${items.map(it => linkHTML(it, cor)).join('')}</div>`;
}

function linkHTML(it, cor) {
  const sub = [it.orgao && `🏢 ${esc(it.orgao)}`, it.cidade && `📍 ${esc(it.cidade)}`].filter(Boolean).join('  ');
  return `<div class="lk-link" style="--c:${cor}">
    <div style="flex:1;min-width:0">
      <div class="ttl">${esc(it.titulo)}</div>
      ${sub ? `<div class="lk-meta">${sub}</div>` : ''}
      ${it.obs ? `<div class="tiny muted" style="margin-top:2px">📝 ${esc(it.obs)}</div>` : ''}
    </div>
    <div class="flex gap-1" style="flex-shrink:0">
      ${it.link ? `<a class="btn btn-primary btn-sm" href="${esc(it.link)}" target="_blank" rel="noopener">🔗 Abrir</a>` : '<span class="tiny muted">sem link</span>'}
      ${_canManage ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">✏️</button>
        <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" style="color:#dc2626">🗑</button>` : ''}
    </div>
  </div>`;
}

function formHTML() {
  const it = _editing && _editing !== 'new' ? _items.find(i => i.id === _editing) : null;
  const v = it || {};
  return `<div class="card mt-3" style="background:var(--bg-3);border:1px solid var(--bd)">
    <h3 class="card-title" style="font-size:14px">${it ? '✏️ Editar link' : '➕ Novo link útil'}</h3>
    <div class="flex gap-2" style="flex-wrap:wrap">
      <div style="flex:2;min-width:220px"><label class="tiny muted">Nome do serviço *</label><input id="lf-tit" class="input" value="${esc(v.titulo || '')}" placeholder="Ex.: 2ª via de conta — CPFL"></div>
      <div style="flex:1;min-width:160px"><label class="tiny muted">Categoria</label>
        <input id="lf-cat" class="input" list="lf-cats" value="${esc(v.categoria || '')}" placeholder="Energia, IPTU, Água…">
        <datalist id="lf-cats">${_cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:1;min-width:200px"><label class="tiny muted">Concessionária / órgão</label><input id="lf-org" class="input" value="${esc(v.orgao || '')}" placeholder="CPFL, SEMAE, Prefeitura…"></div>
      <div style="flex:1;min-width:200px"><label class="tiny muted">Cidade</label><input id="lf-cid" class="input" value="${esc(v.cidade || '')}" placeholder="São José do Rio Preto, Mirassol, Bady Bassitt…"></div>
    </div>
    <div class="mt-2"><label class="tiny muted">Link *</label><input id="lf-link" class="input" value="${esc(v.link || '')}" placeholder="https://…"></div>
    <div class="mt-2"><label class="tiny muted">Observação</label><input id="lf-obs" class="input" value="${esc(v.obs || '')}" placeholder="O que precisa (matrícula, CPF), login, passo a passo…"></div>
    <div class="flex gap-2 mt-3">
      <button class="btn btn-primary btn-sm" id="lf-save">${_busy ? '⏳ Salvando…' : '💾 Salvar'}</button>
      <button class="btn btn-ghost btn-sm" id="lf-cancel">Cancelar</button>
    </div>
  </div>`;
}

function wire() {
  const $ = s => _root.querySelector(s);
  $('#lk-new') && ($('#lk-new').onclick = () => { _editing = 'new'; render(); });
  _root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { _editing = b.dataset.edit; render(); });
  _root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  $('#lf-cancel') && ($('#lf-cancel').onclick = () => { _editing = null; render(); });
  $('#lf-save') && ($('#lf-save').onclick = save);
  const q = $('#lk-q');
  if (q) q.oninput = () => { _q = q.value; const pos = q.selectionStart; render(); const nq = _root.querySelector('#lk-q'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (_) {} } };
}

async function save() {
  if (_busy) return;
  const $ = s => _root.querySelector(s);
  const item = {
    titulo: $('#lf-tit').value.trim(), categoria: $('#lf-cat').value.trim(),
    orgao: $('#lf-org').value.trim(), cidade: $('#lf-cid').value.trim(),
    link: $('#lf-link').value.trim(), obs: $('#lf-obs').value.trim(),
  };
  if (!item.titulo) return alert('Informe o nome do serviço.');
  _busy = true; render();
  try {
    const isNew = _editing === 'new';
    await api.request('/api/v3/secretaria/links', { method: 'POST', body: isNew ? { action: 'add', item } : { action: 'update', id: _editing, item } });
    _editing = null; _busy = false; await load();
  } catch (e) { _busy = false; render(); alert('Erro ao salvar: ' + e.message); }
}

async function del(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir o link "${it?.titulo || ''}"?`)) return;
  try { await api.request('/api/v3/secretaria/links', { method: 'POST', body: { action: 'delete', id } }); await load(); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}
