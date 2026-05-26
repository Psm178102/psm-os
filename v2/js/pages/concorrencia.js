/* PSM-OS v2 — Radar Concorrência (Sprint 7.23) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _items = [];

export async function pageConcorrencia(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder.</div>'; return; }
  await reload();
}

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try { const r = await api.request('/api/v3/concorrentes/list'); _items = r.concorrentes || []; render(); }
  catch (e) { _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`; }
}

function render() {
  const total = _items.length;
  const totalAds = _items.reduce((s, c) => s + (c.anuncios_count || 0), 0);
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🎯 Radar Concorrência</h2>
      <p class="card-sub">${total} concorrentes monitorados · ${totalAds} anúncios totais detectados</p>
      <div style="display:flex;justify-content:flex-end;margin:10px 0">
        <button class="btn btn-primary" id="btn-novo">+ Adicionar</button>
      </div>
      <div style="display:grid;gap:8px">
        ${_items.length === 0 ? '<div class="muted text-center" style="padding:30px">Nenhum concorrente cadastrado.</div>' :
          _items.map(c => card(c)).join('')}
      </div>
      <div id="modal-co" style="display:none"></div>
    </div>
  `;
  document.getElementById('btn-novo').addEventListener('click', () => openModal());
  document.querySelectorAll('[data-co]').forEach(el => el.addEventListener('click', () => openModal(parseInt(el.dataset.co))));
}

function card(c) {
  const ts = c.ultima_atualizacao ? new Date(c.ultima_atualizacao).toLocaleDateString('pt-BR') : '—';
  return `
    <div data-co="${c.id}" style="background:var(--bg-3);border-radius:var(--r-md);padding:12px 16px;cursor:pointer">
      <div class="flex items-center gap-2" style="margin-bottom:6px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${escapeHtml(c.nome)}</div>
          <div class="tiny muted">${escapeHtml(c.segmento || 'sem segmento')}</div>
        </div>
        <span class="tiny" style="background:#7c3aed;color:#fff;padding:3px 10px;border-radius:var(--r-full);font-weight:700">${c.anuncios_count || 0} anúncios</span>
      </div>
      <div class="tiny muted">${c.observacoes ? escapeHtml(c.observacoes.substring(0, 200)) : ''}</div>
      <div class="tiny muted mt-2">Atualizado: ${ts}${c.link ? ' · <a href="' + escapeHtml(c.link) + '" target="_blank" onclick="event.stopPropagation()">🔗 link</a>' : ''}</div>
    </div>
  `;
}

function openModal(cid) {
  const c = cid ? _items.find(x => x.id === cid) : null;
  const modal = document.getElementById('modal-co');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:520px;width:100%">
      <h3 class="card-title">${c ? '✏️ Editar' : '➕ Novo'} concorrente</h3>
      <div class="field"><label>Nome *</label><input id="co-nome" class="input" value="${c?escapeHtml(c.nome):''}"></div>
      <div class="field"><label>Segmento</label><input id="co-seg" class="input" placeholder="ex: alto padrão, residencial, locação" value="${c?escapeHtml(c.segmento||''):''}"></div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:120px"><label># Anúncios</label><input id="co-ads" type="number" class="input" value="${c?.anuncios_count||0}"></div>
        <div class="field" style="flex:2;min-width:200px"><label>Link</label><input id="co-link" class="input" value="${c?escapeHtml(c.link||''):''}" placeholder="https://..."></div>
      </div>
      <div class="field"><label>Observações</label><textarea id="co-obs" class="input" rows="3">${c?escapeHtml(c.observacoes||''):''}</textarea></div>
      <div id="co-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${c?'<button class="btn btn-danger" id="co-del">🗑</button>':'<span></span>'}
        <div class="flex gap-2"><button class="btn btn-ghost" id="co-cancel">Cancelar</button><button class="btn btn-primary" id="co-save">${c?'Salvar':'Criar'}</button></div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('co-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('co-save').addEventListener('click', async () => {
    const body = { id: c?.id, nome: document.getElementById('co-nome').value.trim(), segmento: document.getElementById('co-seg').value.trim()||null, anuncios_count: parseInt(document.getElementById('co-ads').value)||0, link: document.getElementById('co-link').value.trim()||null, observacoes: document.getElementById('co-obs').value.trim()||null };
    if (!body.nome) { document.getElementById('co-msg').innerHTML = '<div class="alert alert-err">Nome obrigatório.</div>'; return; }
    try { await api.request('/api/v3/concorrentes/upsert', { method: 'POST', body }); modal.style.display='none'; await reload(); }
    catch (e) { document.getElementById('co-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; }
  });
  if (c) document.getElementById('co-del').addEventListener('click', async () => {
    if (!confirm('Apagar?')) return;
    try { await api.request('/api/v3/concorrentes/upsert', { method: 'POST', body: { id: c.id, _delete: true } }); modal.style.display='none'; await reload(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
