/* PSM-OS v2 — Premiações (Sprint 8.1) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];
let _editing = null;
let _formOpen = false;

export async function pagePremiacoes(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/premiacoes/list');
    _items = r.premiacoes || [];
    renderList();
  } catch (e) {
    document.getElementById('prem-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  const isSocio = (auth.user()?.lvl || 0) >= 7;
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🏆 Premiações</h2>
          <p class="card-sub">Campanhas e premiações ativas e encerradas</p>
        </div>
        ${isSocio ? `<button class="btn btn-primary" id="prem-toggle">${_formOpen ? '✕ Fechar' : '➕ Nova Premiação'}</button>` : ''}
      </div>

      ${_formOpen && isSocio ? renderForm() : ''}

      <div id="prem-body" class="mt-4"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  if (isSocio) {
    document.getElementById('prem-toggle').addEventListener('click', () => {
      _formOpen = !_formOpen;
      if (!_formOpen) _editing = null;
      render();
      renderList();
    });
    if (_formOpen) bindForm();
  }
}

function renderForm() {
  const ed = _editing || {};
  return `
    <div class="card mt-3" style="background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #6366f140;padding:18px">
      <div style="font-weight:800;color:#f8fafc;margin-bottom:14px">${ed.id ? '✏️ Editar' : '➕ Nova'} Premiação</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/-1">
          <label class="tiny" style="color:#94a3b8">Título *</label>
          <input id="pf-titulo" class="input" placeholder="Ex: Campanha Top Vendedor" value="${esc(ed.titulo || '')}">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Incorporadora *</label>
          <input id="pf-incorp" class="input" placeholder="PSM, Yuny, EBM..." value="${esc(ed.incorporadora || '')}">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Produto *</label>
          <input id="pf-produto" class="input" placeholder="Empreendimento ou TODOS" value="${esc(ed.produto || '')}">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Início *</label>
          <input id="pf-inicio" class="input" type="date" value="${esc(ed.inicio || '')}">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Término *</label>
          <input id="pf-fim" class="input" type="date" value="${esc(ed.fim || '')}">
        </div>
        <div style="grid-column:1/-1">
          <label class="tiny" style="color:#94a3b8">Descrição / Regras *</label>
          <textarea id="pf-desc" class="input" rows="3" placeholder="Regras, prêmios, condições...">${esc(ed.descricao || ed.desc || '')}</textarea>
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Prêmio</label>
          <input id="pf-premio" class="input" placeholder="R$ 2.000, viagem, day-off..." value="${esc(ed.premio || '')}">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Emoji</label>
          <input id="pf-icon" class="input" maxlength="4" style="font-size:18px;text-align:center" value="${esc(ed.icon || '🏆')}">
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" id="pf-save">${ed.id ? '💾 Salvar' : '➕ Adicionar'}</button>
        ${ed.id ? '<button class="btn btn-ghost" id="pf-cancel">Cancelar</button>' : ''}
      </div>
    </div>
  `;
}

function bindForm() {
  document.getElementById('pf-save').addEventListener('click', save);
  const c = document.getElementById('pf-cancel');
  if (c) c.addEventListener('click', () => { _editing = null; render(); renderList(); });
}

async function save() {
  const payload = {
    id: _editing?.id,
    titulo: document.getElementById('pf-titulo').value.trim(),
    incorporadora: document.getElementById('pf-incorp').value.trim(),
    produto: document.getElementById('pf-produto').value.trim(),
    inicio: document.getElementById('pf-inicio').value,
    fim: document.getElementById('pf-fim').value,
    descricao: document.getElementById('pf-desc').value.trim(),
    premio: document.getElementById('pf-premio').value.trim(),
    icon: document.getElementById('pf-icon').value.trim() || '🏆',
  };
  if (!payload.titulo || !payload.inicio || !payload.fim) { alert('Título, início e fim obrigatórios'); return; }
  try {
    await api.request('/api/v3/premiacoes/list', { method: 'POST', body: payload });
    _editing = null;
    _formOpen = false;
    render();
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

function renderList() {
  const body = document.getElementById('prem-body');
  if (!body) return;
  const isSocio = (auth.user()?.lvl || 0) >= 7;
  const hoje = new Date().toISOString().slice(0, 10);
  const ativas = _items.filter(p => p.fim >= hoje && p.inicio <= hoje);
  const futuras = _items.filter(p => p.inicio > hoje);
  const encerradas = _items.filter(p => p.fim < hoje);

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:10px;margin-bottom:16px">
      <div class="kpi" style="text-align:center"><div style="font-size:22px;font-weight:800;color:#22c55e">${ativas.length}</div><div class="tiny muted">Ativas</div></div>
      <div class="kpi" style="text-align:center"><div style="font-size:22px;font-weight:800;color:#3b82f6">${futuras.length}</div><div class="tiny muted">Futuras</div></div>
      <div class="kpi" style="text-align:center"><div style="font-size:22px;font-weight:800;color:var(--muted)">${encerradas.length}</div><div class="tiny muted">Encerradas</div></div>
      <div class="kpi" style="text-align:center"><div style="font-size:22px;font-weight:800;color:#fbbf24">${_items.length}</div><div class="tiny muted">Total</div></div>
    </div>

    ${ativas.length ? `
      <h3 style="color:#22c55e;font-size:14px;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block"></span> Ativas
      </h3>
      ${ativas.sort((a,b)=>a.fim.localeCompare(b.fim)).map(p => premCard(p, 'ATIVA', '#22c55e', isSocio, hoje)).join('')}
    ` : ''}
    ${futuras.length ? `
      <h3 style="color:#3b82f6;font-size:14px;margin:18px 0 10px">📅 Próximas</h3>
      ${futuras.sort((a,b)=>a.inicio.localeCompare(b.inicio)).map(p => premCard(p, 'FUTURA', '#3b82f6', isSocio, hoje)).join('')}
    ` : ''}
    ${encerradas.length ? `
      <h3 style="color:var(--muted);font-size:14px;margin:18px 0 10px">📋 Encerradas</h3>
      ${encerradas.sort((a,b)=>b.fim.localeCompare(a.fim)).slice(0, 10).map(p => premCard(p, 'ENCERRADA', '#64748b', isSocio, hoje)).join('')}
    ` : ''}
    ${_items.length === 0 ? '<div class="muted tiny" style="text-align:center;padding:30px">Nenhuma premiação cadastrada.</div>' : ''}
  `;

  if (isSocio) {
    body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      _editing = _items.find(x => x.id === b.dataset.edit);
      _formOpen = true;
      render();
      renderList();
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remover premiação?')) return;
      try {
        await api.request('/api/v3/premiacoes/list?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        await load();
      } catch (e) { alert('Erro: ' + e.message); }
    }));
  }
}

function premCard(p, label, color, canEdit, hoje) {
  let extra = '';
  if (p.fim >= hoje && p.inicio <= hoje) {
    const dias = Math.ceil((new Date(p.fim + 'T23:59:59') - new Date()) / 86400000);
    extra = `<div style="margin-top:10px;padding:8px 12px;background:${color}20;border-radius:6px;font-size:12px;color:${color};font-weight:700">⏳ ${dias} dia${dias !== 1 ? 's' : ''} restante${dias !== 1 ? 's' : ''}</div>`;
  } else if (p.inicio > hoje) {
    const dias = Math.ceil((new Date(p.inicio + 'T00:00:00') - new Date()) / 86400000);
    extra = `<div style="margin-top:10px;padding:8px 12px;background:${color}20;border-radius:6px;font-size:12px;color:${color};font-weight:700">📅 Começa em ${dias} dia${dias !== 1 ? 's' : ''}</div>`;
  }
  return `
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);color:#fff;border:1px solid ${color}40;border-radius:12px;padding:16px;margin-bottom:12px">
      <div class="flex" style="align-items:flex-start;gap:12px">
        <span style="font-size:32px">${esc(p.icon || '🏆')}</span>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800">${esc(p.titulo)}</div>
          <span style="display:inline-block;font-size:10px;padding:2px 10px;border-radius:10px;background:${color}30;color:${color};font-weight:800;letter-spacing:.5px;margin-top:4px">${label}</span>
        </div>
        ${canEdit ? `
          <div class="flex gap-1">
            <button class="btn btn-ghost btn-sm" data-edit="${p.id}">✏️</button>
            <button class="btn btn-ghost btn-sm" data-del="${p.id}">🗑️</button>
          </div>
        ` : ''}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#cbd5e1">
        <div><span style="color:#64748b">Incorporadora:</span> <b>${esc(p.incorporadora || '—')}</b></div>
        <div><span style="color:#64748b">Produto:</span> <b>${esc(p.produto || '—')}</b></div>
        <div><span style="color:#64748b">Início:</span> ${fmtDate(p.inicio)}</div>
        <div><span style="color:#64748b">Término:</span> ${fmtDate(p.fim)}</div>
        ${p.premio ? `<div style="grid-column:1/-1"><span style="color:#64748b">Prêmio:</span> <b style="color:#fbbf24">${esc(p.premio)}</b></div>` : ''}
      </div>
      ${p.descricao ? `<div style="margin-top:10px;font-size:13px;line-height:1.5;color:#94a3b8">${esc(p.descricao)}</div>` : ''}
      ${extra}
    </div>
  `;
}

function fmtDate(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return d || '—'; } }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
