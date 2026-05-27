/* PSM-OS v2 — Cadências de Follow-up (Sprint 8.7) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];
let _editing = null;

const CANAIS = ['WhatsApp', 'Email', 'Ligação', 'Visita', 'SMS', 'Instagram'];
const CANAL_ICO = { WhatsApp: '💬', Email: '📧', 'Ligação': '📞', Visita: '🚪', SMS: '📱', Instagram: '📸' };

export async function pageCadencia(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+).</div>';
    return;
  }
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/crm_extra/cadencia');
    _items = r.cadencias || [];
    renderList();
  } catch (e) {
    document.getElementById('cad-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🔄 Fluxos de Cadência</h2>
          <p class="card-sub">Sequências automatizadas de follow-up com leads — múltiplos passos × canais</p>
        </div>
        <button class="btn btn-primary" id="cad-new">➕ Nova Cadência</button>
      </div>
      <div id="cad-body" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  document.getElementById('cad-new').addEventListener('click', () => {
    _editing = { nome: '', publico: '', ativa: true, passos: [{ dia: 0, canal: 'WhatsApp', mensagem: '' }] };
    showForm();
  });
}

function renderList() {
  const body = document.getElementById('cad-body');
  if (_items.length === 0) {
    body.innerHTML = '<div class="muted tiny" style="text-align:center;padding:40px">Nenhuma cadência ainda.</div>';
    return;
  }
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px">
      ${_items.map(c => cadCard(c)).join('')}
    </div>
  `;
  body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    _editing = JSON.parse(JSON.stringify(_items.find(x => x.id === b.dataset.edit)));
    showForm();
  }));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover cadência?')) return;
    try {
      await api.request('/api/v3/crm_extra/cadencia?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      await load();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

function cadCard(c) {
  return `
    <div class="card" style="border-left:4px solid ${c.ativa ? '#22c55e' : '#64748b'}">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="flex:1">
          <div style="font-weight:800">${esc(c.nome)}</div>
          <div class="tiny muted">${esc(c.publico || '—')} · ${c.ativa ? '🟢 Ativa' : '⚫ Pausada'}</div>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" data-edit="${c.id}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${c.id}">🗑</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">
        ${(c.passos || []).map((p, i) => `
          <div class="flex" style="gap:6px;align-items:center;font-size:12px;padding:4px 8px;background:var(--bg-3);border-radius:6px">
            <span style="background:var(--psm-gold);color:#000;font-weight:800;border-radius:4px;padding:2px 6px;font-size:10px">D+${p.dia || 0}</span>
            <span>${CANAL_ICO[p.canal] || '📨'} ${esc(p.canal)}</span>
            <span class="tiny muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.mensagem || '—')}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function showForm() {
  const c = _editing;
  const body = document.getElementById('cad-body');
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);padding:18px;margin-bottom:14px">
      <div class="flex" style="justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800">${c.id ? '✏️ Editar' : '➕ Nova'} Cadência</div>
        <button class="btn btn-ghost btn-sm" id="cad-cancel">✕ Cancelar</button>
      </div>
      <div style="display:grid;gap:10px">
        <div>
          <label class="tiny muted">Nome *</label>
          <input id="cd-nome" class="input" placeholder="Ex: Cadência Lead Quente MAP" value="${esc(c.nome || '')}">
        </div>
        <div>
          <label class="tiny muted">Público / Aplicação</label>
          <input id="cd-pub" class="input" placeholder="Lead que respondeu primeira mensagem" value="${esc(c.publico || '')}">
        </div>
        <div>
          <label class="flex gap-2" style="align-items:center"><input id="cd-ativa" type="checkbox" ${c.ativa ? 'checked' : ''}> Cadência ativa</label>
        </div>
        <div>
          <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:6px">
            <label class="tiny muted" style="font-weight:700">Passos</label>
            <button class="btn btn-ghost btn-sm" id="cd-add">➕ Adicionar passo</button>
          </div>
          <div id="cd-passos"></div>
        </div>
        <button class="btn btn-primary mt-2" id="cd-save">💾 Salvar Cadência</button>
      </div>
    </div>
  `;
  document.getElementById('cad-cancel').addEventListener('click', () => { _editing = null; render(); renderList(); });
  document.getElementById('cd-add').addEventListener('click', () => {
    _editing.passos.push({ dia: _editing.passos.length, canal: 'WhatsApp', mensagem: '' });
    renderPassos();
  });
  document.getElementById('cd-save').addEventListener('click', save);
  renderPassos();
}

function renderPassos() {
  const wrap = document.getElementById('cd-passos');
  wrap.innerHTML = _editing.passos.map((p, i) => `
    <div style="background:var(--bg-2);border-radius:8px;padding:10px;margin-bottom:6px">
      <div class="flex" style="justify-content:space-between;margin-bottom:6px">
        <div class="tiny muted">Passo ${i + 1}</div>
        <button class="btn btn-ghost btn-sm" data-rem-p="${i}" style="color:#ef4444">🗑</button>
      </div>
      <div style="display:grid;grid-template-columns:80px 140px 1fr;gap:6px">
        <input class="input" type="number" placeholder="Dia" data-p-key="dia" data-p-idx="${i}" value="${p.dia || 0}">
        <select class="select" data-p-key="canal" data-p-idx="${i}">
          ${CANAIS.map(c => `<option value="${c}" ${p.canal === c ? 'selected' : ''}>${CANAL_ICO[c]} ${c}</option>`).join('')}
        </select>
        <input class="input" placeholder="Mensagem / instrução" data-p-key="mensagem" data-p-idx="${i}" value="${esc(p.mensagem || '')}">
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-p-key]').forEach(el => el.addEventListener('input', e => {
    const i = +el.dataset.pIdx, k = el.dataset.pKey;
    let v = e.target.value;
    if (k === 'dia') v = parseInt(v) || 0;
    _editing.passos[i][k] = v;
  }));
  wrap.querySelectorAll('[data-rem-p]').forEach(b => b.addEventListener('click', () => {
    _editing.passos.splice(+b.dataset.remP, 1);
    renderPassos();
  }));
}

async function save() {
  _editing.nome = document.getElementById('cd-nome').value.trim();
  _editing.publico = document.getElementById('cd-pub').value.trim();
  _editing.ativa = document.getElementById('cd-ativa').checked;
  if (!_editing.nome) { alert('Nome obrigatório'); return; }
  try {
    await api.request('/api/v3/crm_extra/cadencia', { method: 'POST', body: _editing });
    _editing = null;
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
