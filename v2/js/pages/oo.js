/* PSM-OS v2 — One-on-One (Sprint 7.24) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _items = [], _users = [], _filterCorretor = '';

export async function pageOO(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder.</div>'; return; }
  await reload();
}

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const qs = _filterCorretor ? '?corretor_id=' + _filterCorretor : '';
    const [o, u] = await Promise.all([
      api.request('/api/v3/oo/list' + qs),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _items = o.items || [];
    if (u.users) _users = u.users;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  // Agrupa por corretor
  const byCorr = {};
  _items.forEach(i => { (byCorr[i.corretor_id] = byCorr[i.corretor_id] || []).push(i); });

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👥 One-on-One</h2>
      <p class="card-sub">Reuniões individuais líder × corretor. ${_items.length} registros · ${Object.keys(byCorr).length} corretores acompanhados.</p>

      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted">FILTRAR CORRETOR:</label>
        <select id="f-corr" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todos</option>
          ${_users.map(u => `<option value="${escapeHtml(u.id)}"${_filterCorretor===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="btn-novo" style="margin-left:auto">+ Nova reunião</button>
      </div>

      <div class="mt-4" style="display:grid;gap:14px">
        ${Object.keys(byCorr).length === 0 ? '<div class="muted text-center" style="padding:30px">Nenhuma reunião cadastrada.</div>' :
          Object.entries(byCorr).map(([cid, items]) => corretorBlock(cid, items)).join('')}
      </div>

      <div id="modal-oo" style="display:none"></div>
    </div>
  `;
  document.getElementById('f-corr').addEventListener('change', async e => { _filterCorretor = e.target.value; await reload(); });
  document.getElementById('btn-novo').addEventListener('click', () => openModal());
  document.querySelectorAll('[data-oo]').forEach(el => el.addEventListener('click', () => openModal(parseInt(el.dataset.oo))));
}

function corretorBlock(cid, items) {
  const u = _users.find(x => x.id === cid);
  items.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const last = items[0];
  const proxima = last?.proxima_data;
  return `
    <div class="card" style="margin:0">
      <div class="flex items-center gap-2" style="margin-bottom:8px">
        <div style="flex:1">
          <div style="font-weight:800;font-size:14px">${escapeHtml(u?.name || cid)}</div>
          <div class="tiny muted">${items.length} reuniões${proxima ? ' · próxima ' + new Date(proxima).toLocaleDateString('pt-BR') : ''}</div>
        </div>
      </div>
      <div style="display:grid;gap:6px;max-height:240px;overflow-y:auto">
        ${items.map(i => ooRow(i)).join('')}
      </div>
    </div>
  `;
}

function ooRow(i) {
  const lider = _users.find(u => u.id === i.lider_id);
  const dt = i.data ? new Date(i.data + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
  const acoesCount = Array.isArray(i.acoes) ? i.acoes.length : 0;
  return `
    <div data-oo="${i.id}" style="background:var(--bg-3);border-radius:var(--r-sm);padding:8px 12px;cursor:pointer">
      <div class="flex items-center gap-2">
        <span style="font-weight:700;font-size:12.5px">📅 ${dt}</span>
        <span class="tiny muted">com ${escapeHtml(lider?.name || i.lider_id || '?')}</span>
        ${acoesCount > 0 ? `<span class="tiny" style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:var(--r-full);font-weight:600">${acoesCount} ação(ões)</span>` : ''}
      </div>
      ${i.observacoes ? `<div class="tiny muted" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(i.observacoes)}</div>` : ''}
    </div>
  `;
}

function openModal(iid) {
  const i = iid ? _items.find(x => x.id === iid) : null;
  const modal = document.getElementById('modal-oo');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:520px;width:100%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">${i ? '✏️ Editar' : '➕ Nova'} reunião 1:1</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px">
          <label>Corretor *</label>
          <select id="oo-corr" class="select"><option value="">— —</option>${_users.filter(u => (u.role || '').toLowerCase() === 'corretor').map(u => `<option value="${escapeHtml(u.id)}"${i?.corretor_id===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select>
        </div>
        <div class="field" style="flex:1;min-width:140px"><label>Data *</label><input id="oo-data" type="date" class="input" value="${i?.data || new Date().toISOString().slice(0,10)}"></div>
      </div>
      <div class="field">
        <label>Líder/Gerente</label>
        <select id="oo-lider" class="select">${_users.filter(u => ['lider','gerente','socio'].includes((u.role || '').toLowerCase())).map(u => `<option value="${escapeHtml(u.id)}"${(i?.lider_id || auth.user()?.id)===u.id?' selected':''}>${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`).join('')}</select>
      </div>
      <div class="field"><label>Observações da reunião</label><textarea id="oo-obs" class="input" rows="4" placeholder="O que foi conversado, pontos altos, dificuldades...">${i?escapeHtml(i.observacoes||''):''}</textarea></div>
      <div class="field">
        <label>Ações combinadas (uma por linha)</label>
        <textarea id="oo-acoes" class="input" rows="3" placeholder="Ex:&#10;- Fechar 2 visitas até sexta&#10;- Estudar funil Conquista">${i && Array.isArray(i.acoes) ? escapeHtml(i.acoes.join('\n')) : ''}</textarea>
      </div>
      <div class="field"><label>Próxima reunião</label><input id="oo-prox" type="date" class="input" value="${i?.proxima_data || ''}"></div>
      <div id="oo-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${i ? '<button class="btn btn-danger" id="oo-del">🗑</button>' : '<span></span>'}
        <div class="flex gap-2"><button class="btn btn-ghost" id="oo-cancel">Cancelar</button><button class="btn btn-primary" id="oo-save">${i ? 'Salvar' : 'Criar'}</button></div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('oo-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('oo-save').addEventListener('click', async () => {
    const acoesText = document.getElementById('oo-acoes').value.trim();
    const acoes = acoesText ? acoesText.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const body = { id: i?.id, corretor_id: document.getElementById('oo-corr').value, data: document.getElementById('oo-data').value, lider_id: document.getElementById('oo-lider').value, observacoes: document.getElementById('oo-obs').value.trim() || null, acoes, proxima_data: document.getElementById('oo-prox').value || null };
    if (!body.corretor_id || !body.data) { document.getElementById('oo-msg').innerHTML = '<div class="alert alert-err">Corretor e data obrigatórios.</div>'; return; }
    try { await api.request('/api/v3/oo/upsert', { method: 'POST', body }); modal.style.display = 'none'; await reload(); }
    catch (e) { document.getElementById('oo-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; }
  });
  if (i) document.getElementById('oo-del').addEventListener('click', async () => {
    if (!confirm('Apagar?')) return;
    try { await api.request('/api/v3/oo/upsert', { method: 'POST', body: { id: i.id, _delete: true } }); modal.style.display = 'none'; await reload(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
