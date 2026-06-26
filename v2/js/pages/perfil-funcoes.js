/* ============================================================================
   PSM-OS v2 — Meu Perfil → Funções e Tarefas (v81.86)
   - Todo usuário vê o checklist do seu CARGO + do seu LOGIN e pode marcar feito.
   - Sócio (lvl≥10) tem um EDITOR: define os itens por cargo ou por login.
   Backend: /api/v3/settings/funcoes_tarefas  (shared_kv 'funcoes_tarefas')
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const ROLES = [
  ['socio', '👑 Sócio'], ['diretor', 'Diretor'], ['gerente', 'Gerente'], ['lider', 'Líder'],
  ['backoffice', 'Backoffice'], ['financeiro', 'Financeiro'], ['marketing', 'Marketing'],
  ['corretor_conquista', 'Corretor Conquista'], ['corretor_map', 'Corretor MAP'],
  ['corretor_locacao', 'Corretor Locação'], ['corretor_terceiros', 'Corretor Terceiros'],
];
const EP = '/api/v3/settings/funcoes_tarefas';

let _data = null;        // sócio: {byRole,byUser,checked} | user: {items,checked}
let _isSocio = false;
let _users = [];
let _editMode = 'role';  // 'role' | 'user'
let _editItems = [];     // [{id,txt}] em edição
let _curMode = '', _curKey = '';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = a => (a || []).map(x => ({ id: x.id || '', txt: x.txt || '' }));

export async function renderFuncoesTarefas(host) {
  host.innerHTML = '<div class="muted tiny" style="padding:14px"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request(EP);
    _data = r || {}; _isSocio = !!r.is_socio;
  } catch (e) {
    host.innerHTML = `<div class="alert alert-err">Erro ao carregar: ${esc(e.message)}</div>`; return;
  }
  if (_isSocio && !_users.length) {
    try { const u = await api.listUsers(); _users = (u && u.users) || []; } catch {}
  }
  draw(host);
}

function myItems() {
  const u = auth.user();
  if (_isSocio) return [...((_data.byRole || {})[u.role] || []), ...((_data.byUser || {})[u.id] || [])];
  return _data.items || [];
}
function myChecked() {
  const u = auth.user();
  return _isSocio ? ((_data.checked || {})[u.id] || {}) : (_data.checked || {});
}

function draw(host) {
  const items = myItems(), checked = myChecked();
  const done = items.filter(it => checked[it.id]).length;
  let html = `
    <div class="card">
      <h3 class="card-title">✅ Minhas funções e tarefas</h3>
      <p class="card-sub">Checklist do seu cargo e do seu login. ${items.length ? `<b>${done}/${items.length}</b> concluídos.` : 'Ainda não há itens cadastrados pra você.'}</p>
      ${items.length ? `<div>${items.map(it => `
        <label class="ft-row" style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--bd,#e2e8f0);cursor:pointer">
          <input type="checkbox" data-ft-toggle="${esc(it.id)}" ${checked[it.id] ? 'checked' : ''} style="margin-top:3px;width:16px;height:16px;flex:none">
          <span style="font-size:13.5px;${checked[it.id] ? 'text-decoration:line-through;opacity:.55' : ''}">${esc(it.txt)}</span>
        </label>`).join('')}</div>`
      : '<div class="muted tiny" style="padding:6px 0">—</div>'}
    </div>`;
  if (_isSocio) html += socioEditorHTML();
  host.innerHTML = html;
  bind(host);
  if (_isSocio && _curKey) drawEditItems();   // mantém editor aberto após salvar
}

function socioEditorHTML() {
  const opts = _editMode === 'role'
    ? ROLES.map(([r, l]) => `<option value="${r}">${esc(l)}</option>`).join('')
    : _users.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.id)}${u.role ? ' · ' + esc(u.role) : ''}</option>`).join('');
  return `
    <div class="card" style="margin-top:14px">
      <h3 class="card-title">🛠 Editor de Funções e Tarefas (sócio)</h3>
      <p class="card-sub">Preencha o checklist por <b>cargo</b> (vale pra todos daquele cargo) ou por <b>login</b> (só aquela pessoa). Cada linha é um item. O que você marcar de "feito" é individual de cada usuário.</p>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <select class="select" id="ft-mode" style="max-width:150px">
          <option value="role" ${_editMode === 'role' ? 'selected' : ''}>Por cargo</option>
          <option value="user" ${_editMode === 'user' ? 'selected' : ''}>Por login</option>
        </select>
        <select class="select" id="ft-key" style="max-width:260px">${opts}</select>
        <button class="btn btn-ghost" id="ft-load">Carregar / editar</button>
      </div>
      <div id="ft-edit"></div>
    </div>`;
}

function rowHTML(it, i) {
  return `<div class="flex gap-2" style="align-items:center;margin-bottom:6px">
    <input class="input ft-itxt" data-i="${i}" value="${esc(it.txt)}" placeholder="Descreva a função/tarefa…" style="flex:1">
    <button class="btn btn-ghost btn-sm ft-del" data-i="${i}" title="Remover" type="button">🗑</button>
  </div>`;
}

function captureItems() {
  document.querySelectorAll('.ft-itxt').forEach(inp => {
    const i = +inp.dataset.i;
    if (_editItems[i]) _editItems[i].txt = inp.value;
  });
}

function drawEditItems() {
  const host = document.getElementById('ft-edit');
  if (!host) return;
  const who = _curMode === 'role'
    ? (ROLES.find(r => r[0] === _curKey) || [, _curKey])[1]
    : ((_users.find(u => u.id === _curKey) || {}).name || _curKey);
  host.innerHTML = `
    <div class="tiny muted" style="margin-bottom:6px">Editando: <b>${esc(who)}</b></div>
    <div id="ft-rows">${_editItems.map((it, i) => rowHTML(it, i)).join('') || '<div class="tiny muted">Nenhum item. Adicione abaixo.</div>'}</div>
    <button class="btn btn-ghost btn-sm" id="ft-add" type="button" style="margin-top:8px">+ Adicionar item</button>
    <div class="flex gap-2" style="margin-top:12px;align-items:center">
      <button class="btn btn-primary" id="ft-save" type="button">💾 Salvar checklist</button>
      <span class="tiny muted" id="ft-saved"></span>
    </div>`;
  host.querySelectorAll('.ft-del').forEach(b => b.addEventListener('click', () => {
    captureItems(); _editItems.splice(+b.dataset.i, 1); drawEditItems();
  }));
  const add = host.querySelector('#ft-add');
  if (add) add.addEventListener('click', () => { captureItems(); _editItems.push({ id: '', txt: '' }); drawEditItems(); });
  const save = host.querySelector('#ft-save');
  if (save) save.addEventListener('click', saveEdit);
}

async function saveEdit() {
  captureItems();
  const items = _editItems.filter(it => (it.txt || '').trim());
  const action = _curMode === 'role' ? 'set_role' : 'set_user';
  const body = _curMode === 'role' ? { action, role: _curKey, items } : { action, userId: _curKey, items };
  const tag = document.getElementById('ft-saved');
  const btn = document.getElementById('ft-save');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ salvando…'; }
  try {
    await api.request(EP, { method: 'POST', body });
    // re-busca o estado completo (atualiza "Minhas funções" se editou o próprio cargo)
    const r = await api.request(EP); _data = r || {}; _isSocio = !!r.is_socio;
    if (tag) tag.textContent = '✅ Salvo!';
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar checklist'; }
    const host = document.querySelector('[data-funcoes-host]') || document.getElementById('ft-edit')?.closest('[data-funcoes-host]');
    if (host) draw(host);
  } catch (e) {
    if (tag) tag.textContent = '';
    alert('Erro ao salvar: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar checklist'; }
  }
}

function bind(host) {
  host.querySelectorAll('[data-ft-toggle]').forEach(cb => cb.addEventListener('change', async () => {
    const id = cb.dataset.ftToggle;
    try {
      await api.request(EP, { method: 'POST', body: { action: 'toggle', itemId: id, done: cb.checked } });
      // atualiza estado local de marcação
      const u = auth.user();
      if (_isSocio) { _data.checked = _data.checked || {}; _data.checked[u.id] = _data.checked[u.id] || {}; if (cb.checked) _data.checked[u.id][id] = true; else delete _data.checked[u.id][id]; }
      else { _data.checked = _data.checked || {}; if (cb.checked) _data.checked[id] = true; else delete _data.checked[id]; }
      draw(host);
    } catch (e) { cb.checked = !cb.checked; alert('Erro: ' + e.message); }
  }));
  if (!_isSocio) return;
  const mode = host.querySelector('#ft-mode');
  if (mode) mode.addEventListener('change', () => { _editMode = mode.value; _curKey = ''; _editItems = []; draw(host); });
  const load = host.querySelector('#ft-load');
  if (load) load.addEventListener('click', () => {
    const key = document.getElementById('ft-key').value;
    _curMode = _editMode; _curKey = key;
    _editItems = clone(_curMode === 'role' ? (_data.byRole || {})[key] : (_data.byUser || {})[key]);
    drawEditItems();
  });
}
