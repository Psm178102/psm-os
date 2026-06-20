/* ============================================================================
   PSM-OS v2 — 🔐 Logins e Senhas (cofre de credenciais com controle de acesso)
   Sócio (lvl10) cadastra apps/redes/assinaturas e define QUEM pode ver cada uma.
   Demais usuários veem só as credenciais liberadas pra eles. Senha mascarada +
   revelar/copiar. O backend só devolve a senha a quem está autorizado.
============================================================================ */
import { api } from '../api.js';

let _root = null, _items = [], _canManage = false, _users = [], _editing = null, _busy = false;
let _cats = [], _catOpen = false;   // categorias gerenciáveis + estado do painel
const _shown = new Set();   // ids com senha revelada nesta sessão de tela

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const catColor = c => { let h = 0; for (const ch of String(c || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h},55%,45%)`; };
const userName = id => (_users.find(u => u.id === id) || {}).name || id;

export async function pageLogins(ctx, root) {
  _root = root; _editing = null; _busy = false; _shown.clear();
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Abrindo o cofre…</div></div>';
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/vault/creds');
    _items = r.items || [];
    _cats = r.categories || [];
    _canManage = !!r.can_manage;
    if (_canManage && !_users.length) {
      try { const u = await api.request('/api/v3/users/list'); _users = (u && u.users) || []; } catch (_) {}
    }
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function render() {
  const groups = {};
  _items.forEach(it => { const c = (it.categoria || '').trim() || 'Sem categoria'; (groups[c] = groups[c] || []).push(it); });
  // ordem: 1) categorias do registro (na ordem definida), 2) extras fora do registro (alfa), 3) Sem categoria por último
  const cats = [];
  _cats.forEach(c => { if (groups[c]) cats.push(c); });
  Object.keys(groups).filter(c => !_cats.includes(c) && c !== 'Sem categoria')
    .sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(c => cats.push(c));
  if (groups['Sem categoria']) cats.push('Sem categoria');

  _root.innerHTML = `
    <style>
      .vk-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--bd);border-left:3px solid var(--c);border-radius:10px;padding:11px 13px;margin-bottom:9px}
      .vk-field{display:flex;align-items:center;gap:8px;font-size:13px}
      .vk-field .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-muted,#94a3b8);font-weight:800;width:62px;flex:0 0 62px}
      .vk-val{font-family:ui-monospace,monospace;font-size:13px;background:var(--bg-3);padding:3px 9px;border-radius:6px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .vk-ico{cursor:pointer;border:0;background:transparent;font-size:14px;padding:2px 5px;border-radius:6px}
      .vk-ico:hover{background:var(--bg-3)}
      .vk-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bd);border-left:3px solid var(--c,#888);border-radius:20px;padding:4px 6px 4px 11px;font-size:12.5px;font-weight:600}
      .vk-chip-b{cursor:pointer;border:0;background:transparent;font-size:12px;padding:2px 4px;border-radius:50%;line-height:1}
      .vk-chip-b:hover{background:var(--bg-3)}
    </style>
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">🔐 Logins e Senhas</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:660px">${_canManage
            ? 'Cofre de credenciais (apps, redes, assinaturas). Você define <b>quem pode ver</b> cada uma.'
            : 'Credenciais liberadas pra você. Mantenha em segredo. 🔒'}</p>
        </div>
        ${_canManage ? `<button class="btn btn-primary btn-sm" id="vk-new">➕ Nova credencial</button>` : ''}
      </div>
      ${_canManage ? catManagerHTML() : ''}
      ${_editing !== null ? formHTML() : ''}
      ${!_items.length ? `
        <div class="card mt-3" style="text-align:center;padding:30px;background:var(--bg-3)">
          <div style="font-size:30px">🔐</div>
          <div class="muted tiny" style="margin-top:6px">${_canManage ? 'Nenhuma credencial cadastrada ainda.' : 'Nenhuma credencial foi liberada pra você.'}</div>
        </div>` : cats.map(c => groupHTML(c, groups[c])).join('')}
      ${_canManage ? '<p class="tiny muted mt-3">🔒 As senhas ficam no banco com acesso restrito (só quem você libera recebe o valor). Evite guardar aqui senhas bancárias/críticas.</p>' : ''}
    </div>`;
  wire();
}

function groupHTML(cat, items) {
  const cor = catColor(cat);
  return `<div class="card mt-3">
    <h3 class="card-title" style="font-size:13px;display:flex;align-items:center;gap:7px">
      <span style="width:9px;height:9px;border-radius:3px;background:${cor};display:inline-block"></span>${esc(cat)}
      <span class="tiny muted" style="font-weight:400">(${items.length})</span></h3>
    ${items.map(it => cardHTML(it, cor)).join('')}</div>`;
}

function catManagerHTML() {
  const count = c => _items.filter(i => ((i.categoria || '').trim() || 'Sem categoria') === c).length;
  return `<details class="card mt-3" id="vk-catmgr" style="background:var(--bg-3);border:1px solid var(--bd)" ${_catOpen ? 'open' : ''}>
    <summary style="cursor:pointer;font-weight:800;font-size:13px;list-style:none">🗂 Categorias <span class="tiny muted" style="font-weight:400">(${_cats.length}) — clique para gerenciar</span></summary>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:11px">
      ${_cats.length ? _cats.map(c => `<span class="vk-chip" style="--c:${catColor(c)}">
        ${esc(c)}<span class="tiny muted" style="font-weight:400">·${count(c)}</span>
        <button class="vk-chip-b" data-catren="${esc(c)}" title="Renomear">✏️</button>
        <button class="vk-chip-b" data-catdel="${esc(c)}" title="Excluir" style="color:#dc2626">✕</button>
      </span>`).join('') : '<span class="tiny muted">Nenhuma categoria cadastrada.</span>'}
    </div>
    <div class="flex gap-2 mt-2" style="max-width:380px">
      <input id="vk-catnew" class="input" placeholder="Nova categoria (ex.: Incorporadora)">
      <button class="btn btn-primary btn-sm" id="vk-catadd" style="white-space:nowrap">➕ Adicionar</button>
    </div>
    <p class="tiny muted" style="margin:7px 0 0">Renomear atualiza as credenciais; excluir solta as credenciais pra “Sem categoria”.</p>
  </details>`;
}

function cardHTML(it, cor) {
  const rev = _shown.has(it.id);
  const senha = it.senha || '';
  const viewers = (it.viewers || []).map(userName).filter(Boolean);
  return `<div class="vk-card" style="--c:${cor}">
    <div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
      <b style="font-size:14px">${esc(it.titulo)}</b>
      <div class="flex gap-1">
        ${it.url ? `<a class="btn btn-ghost btn-sm" href="${esc(it.url)}" target="_blank" rel="noopener">🌐 abrir</a>` : ''}
        ${_canManage ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" style="color:#dc2626">🗑</button>` : ''}
      </div>
    </div>
    ${it.login ? `<div class="vk-field"><span class="lbl">Login</span><span class="vk-val">${esc(it.login)}</span><button class="vk-ico" data-copy="login|${esc(it.id)}" title="Copiar">📋</button></div>` : ''}
    <div class="vk-field"><span class="lbl">Senha</span>
      <span class="vk-val" data-senha="${esc(it.id)}">${rev ? esc(senha) : '••••••••••'}</span>
      <button class="vk-ico" data-reveal="${esc(it.id)}" title="${rev ? 'Ocultar' : 'Revelar'}">${rev ? '🙈' : '👁'}</button>
      <button class="vk-ico" data-copy="senha|${esc(it.id)}" title="Copiar">📋</button></div>
    ${it.obs ? `<div class="tiny muted">📝 ${esc(it.obs)}</div>` : ''}
    ${_canManage ? `<div class="tiny muted">👁 vê: ${viewers.length ? esc(viewers.join(', ')) : '<span style="color:#d97706">só você</span>'}</div>` : ''}
  </div>`;
}

function formHTML() {
  const it = _editing && _editing !== 'new' ? _items.find(i => i.id === _editing) : null;
  const v = it || {};
  const chosen = new Set(v.viewers || []);
  return `<div class="card mt-3" style="background:var(--bg-3);border:1px solid var(--bd)">
    <h3 class="card-title" style="font-size:14px">${it ? '✏️ Editar credencial' : '➕ Nova credencial'}</h3>
    <div class="flex gap-2" style="flex-wrap:wrap">
      <div style="flex:2;min-width:200px"><label class="tiny muted">Título *</label><input id="vf-tit" class="input" value="${esc(v.titulo || '')}" placeholder="Ex.: Instagram PSM Conquista"></div>
      <div style="flex:1;min-width:140px"><label class="tiny muted">Categoria</label>
        <select id="vf-cat" class="input">
          ${(() => { const cur = (v.categoria || '').trim(); const opts = _cats.slice(); if (cur && !opts.includes(cur)) opts.unshift(cur);
            return `<option value="">— Sem categoria —</option>` + opts.map(c => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join(''); })()}
        </select>
        <p class="tiny muted" style="margin:3px 0 0">Gerencie no painel 🗂 acima.</p></div>
    </div>
    <div class="mt-2"><label class="tiny muted">URL (opcional)</label><input id="vf-url" class="input" value="${esc(v.url || '')}" placeholder="https://…"></div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:1;min-width:180px"><label class="tiny muted">Login / usuário</label><input id="vf-login" class="input" value="${esc(v.login || '')}"></div>
      <div style="flex:1;min-width:180px"><label class="tiny muted">Senha</label><input id="vf-senha" type="text" class="input" value="${esc(v.senha || '')}"></div>
    </div>
    <div class="mt-2"><label class="tiny muted">Observação</label><input id="vf-obs" class="input" value="${esc(v.obs || '')}" placeholder="2FA, e-mail de recuperação, etc."></div>
    <div class="mt-2"><label class="tiny muted" style="font-weight:700">👁 Quem pode ver esta credencial</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;max-height:160px;overflow:auto;border:1px solid var(--bd);border-radius:8px;padding:8px;margin-top:4px">
        ${_users.map(u => `<label class="tiny" style="display:flex;align-items:center;gap:5px;min-width:160px;cursor:pointer"><input type="checkbox" data-viewer="${esc(u.id)}" ${chosen.has(u.id) ? 'checked' : ''}> ${esc(u.name)} <span class="muted">(${esc(u.role || '')})</span></label>`).join('') || '<span class="tiny muted">Sem usuários.</span>'}
      </div>
      <p class="tiny muted" style="margin:4px 0 0">Você (sócio) sempre vê. Marque quem mais pode visualizar.</p>
    </div>
    <div class="flex gap-2 mt-3">
      <button class="btn btn-primary btn-sm" id="vf-save">${_busy ? '⏳ Salvando…' : '💾 Salvar'}</button>
      <button class="btn btn-ghost btn-sm" id="vf-cancel">Cancelar</button>
    </div>
  </div>`;
}

function wire() {
  const $ = s => _root.querySelector(s);
  $('#vk-new') && ($('#vk-new').onclick = () => { _editing = 'new'; render(); });
  _root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { _editing = b.dataset.edit; render(); });
  _root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  _root.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => {
    const id = b.dataset.reveal; _shown.has(id) ? _shown.delete(id) : _shown.add(id); render();
  });
  _root.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const [campo, id] = b.dataset.copy.split('|');
    const it = _items.find(x => x.id === id); if (!it) return;
    const val = campo === 'senha' ? (it.senha || '') : (it.login || '');
    navigator.clipboard.writeText(val).then(() => { b.textContent = '✅'; setTimeout(() => { b.textContent = '📋'; }, 1200); }).catch(() => {});
  });
  $('#vf-cancel') && ($('#vf-cancel').onclick = () => { _editing = null; render(); });
  $('#vf-save') && ($('#vf-save').onclick = save);
  // ── categorias ──
  const mgr = $('#vk-catmgr'); if (mgr) mgr.ontoggle = () => { _catOpen = mgr.open; };
  $('#vk-catadd') && ($('#vk-catadd').onclick = catAdd);
  $('#vk-catnew') && ($('#vk-catnew').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); catAdd(); } });
  _root.querySelectorAll('[data-catren]').forEach(b => b.onclick = () => catRename(b.dataset.catren));
  _root.querySelectorAll('[data-catdel]').forEach(b => b.onclick = () => catDelete(b.dataset.catdel));
}

async function catAdd() {
  const inp = _root.querySelector('#vk-catnew'); const name = (inp && inp.value || '').trim();
  if (!name) { inp && inp.focus(); return; }
  _catOpen = true;
  try { await api.request('/api/v3/vault/creds', { method: 'POST', body: { action: 'cat_add', name } }); await load(); }
  catch (e) { alert('Erro ao adicionar categoria: ' + e.message); }
}

async function catRename(from) {
  const to = prompt(`Renomear a categoria "${from}" para:`, from);
  if (to === null) return; const t = to.trim();
  if (!t || t === from) return;
  _catOpen = true;
  try { await api.request('/api/v3/vault/creds', { method: 'POST', body: { action: 'cat_rename', from, to: t } }); await load(); }
  catch (e) { alert('Erro ao renomear: ' + e.message); }
}

async function catDelete(name) {
  const n = _items.filter(i => ((i.categoria || '').trim()) === name).length;
  if (!confirm(`Excluir a categoria "${name}"?` + (n ? `\n\n${n} credencial(is) ficarão em “Sem categoria”.` : ''))) return;
  _catOpen = true;
  try { await api.request('/api/v3/vault/creds', { method: 'POST', body: { action: 'cat_delete', name } }); await load(); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}

async function save() {
  if (_busy) return;
  const $ = s => _root.querySelector(s);
  const item = {
    titulo: $('#vf-tit').value.trim(), categoria: $('#vf-cat').value.trim(),
    url: $('#vf-url').value.trim(), login: $('#vf-login').value.trim(),
    senha: $('#vf-senha').value, obs: $('#vf-obs').value.trim(),
    viewers: [..._root.querySelectorAll('[data-viewer]:checked')].map(c => c.dataset.viewer),
  };
  if (!item.titulo) return alert('Informe o título.');
  _busy = true; render();
  try {
    const isNew = _editing === 'new';
    await api.request('/api/v3/vault/creds', { method: 'POST', body: isNew ? { action: 'add', item } : { action: 'update', id: _editing, item } });
    _editing = null; _busy = false; await load();
  } catch (e) { _busy = false; render(); alert('Erro ao salvar: ' + e.message); }
}

async function del(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir a credencial "${it?.titulo || ''}"?`)) return;
  try { await api.request('/api/v3/vault/creds', { method: 'POST', body: { action: 'delete', id } }); await load(); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}
