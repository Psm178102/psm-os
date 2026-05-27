/* PSM-OS v2 — Gestão de Pessoas (Sprint 8.1) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _tab = 'treinamentos';
let _treinamentos = [];
let _talentos = [];
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
      <p class="card-sub">Treinamentos, reuniões 1:1 e base de talentos</p>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        <button class="btn ${_tab === 'treinamentos' ? 'btn-primary' : 'btn-ghost'}" data-tab="treinamentos">🎓 Treinamentos</button>
        <button class="btn ${_tab === 'reunioes' ? 'btn-primary' : 'btn-ghost'}" data-tab="reunioes">📅 Reuniões 1:1</button>
        <button class="btn ${_tab === 'talentos' ? 'btn-primary' : 'btn-ghost'}" data-tab="talentos">👥 Base de Talentos</button>
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
  if (_tab === 'treinamentos') return loadTreinamentos();
  if (_tab === 'talentos') return loadTalentos();
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

// ─── Talentos ──────────────────────────────────────────────────────────
async function loadTalentos() {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/talentos');
    _talentos = r.talentos || [];
    renderTalentos();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderTalentos() {
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);margin-bottom:14px;padding:14px">
      <div style="font-weight:800;margin-bottom:8px">👤 ${_editing?.id ? 'Editar' : 'Adicionar'} Talento</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px">
        <input id="tal-nome" class="input" placeholder="Nome completo *" value="${esc(_editing?.nome || '')}">
        <input id="tal-setor" class="input" placeholder="Setor / Origem" value="${esc(_editing?.setor || '')}">
        <input id="tal-funcao" class="input" placeholder="Função / Empresa atual" value="${esc(_editing?.funcao || '')}">
        <input id="tal-contato" class="input" placeholder="Contato (WhatsApp/tel)" value="${esc(_editing?.contato || '')}">
        <input id="tal-instagram" class="input" placeholder="@instagram" value="${esc(_editing?.instagram || '')}">
        <input id="tal-status" class="input" placeholder="Status (aceito, analisando, etc)" value="${esc(_editing?.status || '')}">
      </div>
      <textarea id="tal-cenario" class="input mt-2" rows="2" placeholder="Cenário / observações (CRECI, perfil, vaga, disp, prazo...)">${esc(_editing?.cenario || '')}</textarea>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-primary" id="tal-save">${_editing?.id ? '💾 Salvar' : '➕ Adicionar'}</button>
        ${_editing?.id ? '<button class="btn btn-ghost" id="tal-cancel">Cancelar</button>' : ''}
        <input id="tal-search" class="input" placeholder="🔍 Buscar talento..." style="flex:1;max-width:250px;margin-left:auto">
      </div>
    </div>
    <div style="font-weight:800;margin-bottom:8px">Base de Talentos (${_talentos.length})</div>
    <div id="tal-list">${renderTalentoList(_talentos)}</div>
  `;
  document.getElementById('tal-save').addEventListener('click', saveTalento);
  const cancel = document.getElementById('tal-cancel');
  if (cancel) cancel.addEventListener('click', () => { _editing = null; renderTalentos(); });
  document.getElementById('tal-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = _talentos.filter(t => (t.nome || '').toLowerCase().includes(q) || (t.setor || '').toLowerCase().includes(q) || (t.funcao || '').toLowerCase().includes(q));
    document.getElementById('tal-list').innerHTML = renderTalentoList(filtered);
    bindTalentoActions();
  });
  bindTalentoActions();
}

function renderTalentoList(items) {
  if (!items.length) return '<div class="muted tiny" style="text-align:center;padding:20px">Nenhum talento.</div>';
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--bg-3)">
        <th style="text-align:left;padding:8px">Nome</th>
        <th style="text-align:left;padding:8px">Setor</th>
        <th style="text-align:left;padding:8px">Função</th>
        <th style="text-align:left;padding:8px">Cenário</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${items.map(t => `
          <tr style="border-bottom:1px solid var(--bd)">
            <td style="padding:8px;font-weight:700">${esc(t.nome)}</td>
            <td style="padding:8px">${esc(t.setor || '—')}</td>
            <td style="padding:8px">${esc(t.funcao || '—')}</td>
            <td style="padding:8px;font-size:11px;color:var(--muted)">${esc((t.cenario || '').substring(0, 100))}</td>
            <td style="padding:8px;text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-edit-tal="${t.id}">✏️</button>
              <button class="btn btn-ghost btn-sm" data-del-tal="${t.id}">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function bindTalentoActions() {
  document.querySelectorAll('[data-edit-tal]').forEach(b => b.addEventListener('click', () => {
    _editing = _talentos.find(x => x.id === b.dataset.editTal);
    renderTalentos();
  }));
  document.querySelectorAll('[data-del-tal]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover talento?')) return;
    try {
      await api.request('/api/v3/gp/talentos?id=' + encodeURIComponent(b.dataset.delTal), { method: 'DELETE' });
      loadTalentos();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

async function saveTalento() {
  const payload = {
    id: _editing?.id,
    nome: document.getElementById('tal-nome').value.trim(),
    setor: document.getElementById('tal-setor').value.trim(),
    funcao: document.getElementById('tal-funcao').value.trim(),
    contato: document.getElementById('tal-contato').value.trim(),
    instagram: document.getElementById('tal-instagram').value.trim(),
    status: document.getElementById('tal-status').value.trim(),
    cenario: document.getElementById('tal-cenario').value.trim(),
  };
  if (!payload.nome) { alert('Nome obrigatório'); return; }
  try {
    await api.request('/api/v3/gp/talentos', { method: 'POST', body: payload });
    _editing = null;
    await loadTalentos();
  } catch (e) { alert('Erro: ' + e.message); }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
