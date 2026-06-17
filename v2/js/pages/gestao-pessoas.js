/* PSM-OS v2 — Gestão de Pessoas (Sprint 8.1) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _tab = 'treinamentos';
let _treinamentos = [];
let _editing = null;

export async function pageGestaoPessoas(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+).</div>';
    return;
  }
  render();
  await loadData();
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👥 Gestão de Pessoas</h2>
      <p class="card-sub">Treinamentos e reuniões 1:1 <span class="tiny muted">· Base de Talentos agora fica na Diretoria 🌟</span></p>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        <button class="btn ${_tab === 'treinamentos' ? 'btn-primary' : 'btn-ghost'}" data-tab="treinamentos">🎓 Treinamentos</button>
        <button class="btn ${_tab === 'reunioes' ? 'btn-primary' : 'btn-ghost'}" data-tab="reunioes">📅 Reuniões 1:1</button>
      </div>
      <div id="gp-body" class="mt-4"></div>
    </div>
  `;
  _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    _tab = b.dataset.tab;
    render();
    loadData();
  }));
}

async function loadData() {
  if (_tab === 'reunioes') {
    document.getElementById('gp-body').innerHTML = `
      <div class="card" style="background:var(--bg-3);text-align:center;padding:40px">
        <div style="font-size:36px;margin-bottom:10px">📅</div>
        <div style="font-weight:800;margin-bottom:6px">Reuniões 1:1 estão em página dedicada</div>
        <div class="tiny muted mb-3">A funcionalidade One-on-One foi expandida e movida pra uma página própria.</div>
        <button class="btn btn-primary" onclick="location.hash='/one-on-one'">Ir pra One-on-One →</button>
      </div>
    `;
    return;
  }
  return loadTreinamentos();
}

async function loadTreinamentos() {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/treinamentos');
    _treinamentos = r.treinamentos || [];
    renderTreinamentos();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderTreinamentos() {
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);margin-bottom:14px;padding:14px">
      <div style="font-weight:800;margin-bottom:8px">🎓 ${_editing?.id ? 'Editar' : 'Mapear'} Treinamento</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:8px">
        <input id="trt-titulo" class="input" placeholder="Título do treinamento *" value="${esc(_editing?.titulo || '')}">
        <input id="trt-publico" class="input" placeholder="Público-alvo" value="${esc(_editing?.publico || '')}">
        <select id="trt-tipo" class="select">
          ${['tecnico','comportamental','comercial','lideranca','integracao'].map(t => `<option value="${t}" ${_editing?.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input id="trt-prazo" class="input" type="date" value="${esc(_editing?.prazo || '')}">
        <select id="trt-status" class="select">
          ${['planejado','em_andamento','concluido'].map(s => `<option value="${s}" ${_editing?.status === s ? 'selected' : ''}>${s.replace('_',' ')}</option>`).join('')}
        </select>
      </div>
      <textarea id="trt-conteudo" class="input mt-2" rows="2" placeholder="Conteúdo / objetivos / materiais">${esc(_editing?.conteudo || '')}</textarea>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-primary" id="trt-save">${_editing?.id ? '💾 Salvar' : '➕ Adicionar'}</button>
        ${_editing?.id ? '<button class="btn btn-ghost" id="trt-cancel">Cancelar</button>' : ''}
      </div>
    </div>
    <div style="font-weight:800;margin-bottom:8px">Treinamentos mapeados (${_treinamentos.length})</div>
    ${_treinamentos.length === 0 ? '<div class="muted tiny" style="text-align:center;padding:20px">Nenhum treinamento ainda.</div>' : `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg-3)">
          <th style="text-align:left;padding:8px">Título</th>
          <th style="text-align:left;padding:8px">Público</th>
          <th style="text-align:left;padding:8px">Tipo</th>
          <th style="text-align:left;padding:8px">Prazo</th>
          <th style="text-align:left;padding:8px">Status</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_treinamentos.map(t => `
            <tr style="border-bottom:1px solid var(--bd)">
              <td style="padding:8px"><div style="font-weight:700">${esc(t.titulo)}</div><div class="tiny muted">${esc((t.conteudo || '').substring(0, 80))}</div></td>
              <td style="padding:8px">${esc(t.publico || '—')}</td>
              <td style="padding:8px">${esc(t.tipo || '—')}</td>
              <td style="padding:8px">${esc(t.prazo || '—')}</td>
              <td style="padding:8px"><span style="color:${t.status === 'concluido' ? '#22c55e' : t.status === 'em_andamento' ? '#f59e0b' : 'var(--muted)'};font-weight:700">${esc((t.status || '').replace('_',' '))}</span></td>
              <td style="padding:8px;text-align:right">
                <button class="btn btn-ghost btn-sm" data-edit-tr="${t.id}">✏️</button>
                <button class="btn btn-ghost btn-sm" data-del-tr="${t.id}">🗑️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  `;
  document.getElementById('trt-save').addEventListener('click', saveTreinamento);
  const cancel = document.getElementById('trt-cancel');
  if (cancel) cancel.addEventListener('click', () => { _editing = null; renderTreinamentos(); });
  body.querySelectorAll('[data-edit-tr]').forEach(b => b.addEventListener('click', () => {
    _editing = _treinamentos.find(x => x.id === b.dataset.editTr);
    renderTreinamentos();
  }));
  body.querySelectorAll('[data-del-tr]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover treinamento?')) return;
    try {
      await api.request('/api/v3/gp/treinamentos?id=' + encodeURIComponent(b.dataset.delTr), { method: 'DELETE' });
      loadTreinamentos();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

async function saveTreinamento() {
  const payload = {
    id: _editing?.id,
    titulo: document.getElementById('trt-titulo').value.trim(),
    publico: document.getElementById('trt-publico').value.trim(),
    tipo: document.getElementById('trt-tipo').value,
    prazo: document.getElementById('trt-prazo').value || null,
    status: document.getElementById('trt-status').value,
    conteudo: document.getElementById('trt-conteudo').value.trim(),
  };
  if (!payload.titulo) { alert('Título obrigatório'); return; }
  try {
    await api.request('/api/v3/gp/treinamentos', { method: 'POST', body: payload });
    _editing = null;
    await loadTreinamentos();
  } catch (e) { alert('Erro: ' + e.message); }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
