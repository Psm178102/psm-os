/* PSM-OS v2 — Fichas/Propostas (Sprint 8.7) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];
let _users = [];
let _editing = null;
let _filter = 'todas';

const STATUS_COLOR = {
  em_analise: '#f59e0b',
  aprovada: '#22c55e',
  recusada: '#ef4444',
  fechada: '#3b82f6',
};
const STATUS_LBL = {
  em_analise: 'Em Análise',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  fechada: 'Fechada',
};

export async function pageFichasPropostas(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const [fic, us] = await Promise.all([
      api.request('/api/v3/crm_extra/fichas'),
      api.listUsers().catch(() => ({ users: [] })),
    ]);
    _items = fic.fichas || [];
    _users = us.users || [];
    renderList();
  } catch (e) {
    document.getElementById('fic-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">📋 Fichas de Proposta</h2>
          <p class="card-sub">Propostas enviadas ao cliente — controle de aprovações e fechamentos</p>
        </div>
        <button class="btn btn-primary" id="fic-new">➕ Nova Ficha</button>
      </div>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        ${['todas', 'em_analise', 'aprovada', 'fechada', 'recusada'].map(s => `
          <button class="btn ${_filter === s ? 'btn-primary' : 'btn-ghost'} btn-sm" data-filter="${s}">${s === 'todas' ? 'Todas' : STATUS_LBL[s]}</button>
        `).join('')}
      </div>
      <div id="fic-body" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  document.getElementById('fic-new').addEventListener('click', () => {
    _editing = { status: 'em_analise', data_envio: new Date().toISOString().slice(0, 10) };
    showForm();
  });
  _root.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    _filter = b.dataset.filter;
    render();
    renderList();
  }));
}

function renderList() {
  const body = document.getElementById('fic-body');
  if (!body) return;
  const filtered = _filter === 'todas' ? _items : _items.filter(f => f.status === _filter);
  const stats = {
    em_analise: _items.filter(f => f.status === 'em_analise').length,
    aprovada: _items.filter(f => f.status === 'aprovada').length,
    fechada: _items.filter(f => f.status === 'fechada').length,
    recusada: _items.filter(f => f.status === 'recusada').length,
  };
  const totalProposto = filtered.reduce((s, f) => s + (+f.valor_proposta || 0), 0);

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;margin-bottom:14px">
      ${kpi('Em Análise', stats.em_analise, STATUS_COLOR.em_analise)}
      ${kpi('Aprovadas', stats.aprovada, STATUS_COLOR.aprovada)}
      ${kpi('Fechadas', stats.fechada, STATUS_COLOR.fechada)}
      ${kpi('Recusadas', stats.recusada, STATUS_COLOR.recusada)}
      ${kpi('Valor total', 'R$ ' + Math.round(totalProposto).toLocaleString('pt-BR'), '#fbbf24')}
    </div>
    ${filtered.length === 0 ? '<div class="muted tiny" style="text-align:center;padding:30px">Nenhuma ficha nesse filtro.</div>' : `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg-3)">
          <th style="text-align:left;padding:8px">Cliente</th>
          <th style="text-align:left;padding:8px">Imóvel</th>
          <th style="text-align:right;padding:8px">Valor</th>
          <th style="text-align:left;padding:8px">Corretor</th>
          <th style="text-align:center;padding:8px">Status</th>
          <th style="text-align:center;padding:8px">Envio</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${filtered.map(f => {
            const cor = STATUS_COLOR[f.status] || '#64748b';
            const corretor = _users.find(u => u.id === f.corretor_id);
            return `
              <tr style="border-bottom:1px solid var(--bd)">
                <td style="padding:8px"><div style="font-weight:700">${esc(f.cliente)}</div><div class="tiny muted">${esc(f.cliente_contato || '—')}</div></td>
                <td style="padding:8px">${esc(f.imovel || '—')}</td>
                <td style="padding:8px;text-align:right;font-weight:800;color:var(--psm-gold)">R$ ${(+f.valor_proposta || 0).toLocaleString('pt-BR')}</td>
                <td style="padding:8px">${esc(corretor?.name || '—')}</td>
                <td style="padding:8px;text-align:center"><span style="background:${cor}22;color:${cor};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700">${STATUS_LBL[f.status]}</span></td>
                <td style="padding:8px;text-align:center;font-size:11px">${f.data_envio || '—'}</td>
                <td style="padding:8px;text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-sm" data-edit="${f.id}">✏️</button>
                  <button class="btn btn-ghost btn-sm" data-del="${f.id}">🗑</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `}
  `;
  body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    _editing = JSON.parse(JSON.stringify(_items.find(x => x.id === b.dataset.edit)));
    showForm();
  }));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover ficha?')) return;
    try {
      await api.request('/api/v3/crm_extra/fichas?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      await load();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

function showForm() {
  const f = _editing;
  const body = document.getElementById('fic-body');
  const isLider = (auth.user()?.lvl || 0) >= 5;
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);padding:18px;margin-bottom:14px">
      <div class="flex" style="justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800">${f.id ? '✏️ Editar' : '➕ Nova'} Ficha de Proposta</div>
        <button class="btn btn-ghost btn-sm" id="fic-cancel">✕ Cancelar</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/-1">
          <label class="tiny muted">Cliente *</label>
          <input id="ff-cli" class="input" placeholder="Nome completo" value="${esc(f.cliente || '')}">
        </div>
        <div>
          <label class="tiny muted">CPF</label>
          <input id="ff-doc" class="input" placeholder="000.000.000-00" value="${esc(f.cliente_doc || '')}">
        </div>
        <div>
          <label class="tiny muted">Contato</label>
          <input id="ff-cont" class="input" placeholder="WhatsApp / email" value="${esc(f.cliente_contato || '')}">
        </div>
        <div style="grid-column:1/-1">
          <label class="tiny muted">Imóvel (empreendimento + unidade)</label>
          <input id="ff-imv" class="input" placeholder="Ex: GIULIA Boulevard · Torre 1 · Apt 1502" value="${esc(f.imovel || '')}">
        </div>
        <div>
          <label class="tiny muted">Valor Imóvel (R$)</label>
          <input id="ff-vimv" type="number" class="input" value="${f.valor_imovel || ''}">
        </div>
        <div>
          <label class="tiny muted">Valor Proposta (R$)</label>
          <input id="ff-vprop" type="number" class="input" value="${f.valor_proposta || ''}">
        </div>
        <div style="grid-column:1/-1">
          <label class="tiny muted">Forma de Pagamento</label>
          <input id="ff-pagto" class="input" placeholder="Ex: Entrada 5% + 42x sem juros + Financiamento 75%" value="${esc(f.forma_pagto || '')}">
        </div>
        <div style="grid-column:1/-1">
          <label class="tiny muted">Observações</label>
          <textarea id="ff-obs" class="input" rows="3">${esc(f.observacoes || '')}</textarea>
        </div>
        ${isLider ? `
          <div>
            <label class="tiny muted">Corretor responsável</label>
            <select id="ff-cor" class="select">
              <option value="">— sem corretor —</option>
              ${_users.filter(u => u.role === 'corretor' || u.role === 'lider').map(u => `<option value="${u.id}" ${f.corretor_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div>
          <label class="tiny muted">Status</label>
          <select id="ff-st" class="select">
            ${Object.entries(STATUS_LBL).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="tiny muted">Data Envio</label>
          <input id="ff-env" type="date" class="input" value="${f.data_envio || ''}">
        </div>
        <div>
          <label class="tiny muted">Data Resposta</label>
          <input id="ff-res" type="date" class="input" value="${f.data_resposta || ''}">
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" id="ff-save">💾 Salvar</button>
        <button class="btn btn-ghost" onclick="window.print()">🖨 Imprimir</button>
      </div>
    </div>
  `;
  document.getElementById('fic-cancel').addEventListener('click', () => { _editing = null; render(); renderList(); });
  document.getElementById('ff-save').addEventListener('click', save);
}

async function save() {
  const isLider = (auth.user()?.lvl || 0) >= 5;
  const payload = {
    id: _editing?.id,
    cliente: document.getElementById('ff-cli').value.trim(),
    cliente_doc: document.getElementById('ff-doc').value.trim(),
    cliente_contato: document.getElementById('ff-cont').value.trim(),
    imovel: document.getElementById('ff-imv').value.trim(),
    valor_imovel: parseFloat(document.getElementById('ff-vimv').value) || null,
    valor_proposta: parseFloat(document.getElementById('ff-vprop').value) || null,
    forma_pagto: document.getElementById('ff-pagto').value.trim(),
    observacoes: document.getElementById('ff-obs').value.trim(),
    status: document.getElementById('ff-st').value,
    data_envio: document.getElementById('ff-env').value || null,
    data_resposta: document.getElementById('ff-res').value || null,
  };
  if (isLider) {
    payload.corretor_id = document.getElementById('ff-cor').value || null;
  }
  if (!payload.cliente) { alert('Cliente obrigatório'); return; }
  try {
    await api.request('/api/v3/crm_extra/fichas', { method: 'POST', body: payload });
    _editing = null;
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

function kpi(label, value, color) {
  return `<div style="background:var(--bg-3);border-left:4px solid ${color};padding:12px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-size:20px;font-weight:800;color:${color}">${value}</div></div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
