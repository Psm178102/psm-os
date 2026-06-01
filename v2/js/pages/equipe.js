/* ============================================================================
   PSM-OS v2 — Equipes (visão + editor) — Sprint 9.2
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _teams = [];
let _users = [];
let _editMode = false;

// Cargos (role) editáveis — mesmo mapa do backend (ROLE_LVL). Mudar o cargo
// recalcula o nível (lvl) e reflete em TODO o sistema (permissões, metas,
// ranking, dashboards) — pois tudo lê users.role/lvl/team do Postgres.
const ROLES = [
  ['socio', '👑 Sócio'], ['diretor', '👑 Diretor'], ['gerente', '🎯 Gerente'],
  ['backoffice', '📋 Backoffice'], ['lider', '🛡 Líder'], ['financeiro', '💰 Financeiro'],
  ['marketing', '📢 Marketing'], ['corretor', '🏠 Corretor'],
];
const ROLE_LVL = { socio: 10, diretor: 10, gerente: 7, backoffice: 6, lider: 5, financeiro: 4, marketing: 3, corretor: 2 };

export async function pageEquipe(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando equipes…</div></div>';
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/teams/manage');
    _teams = r.teams || [];
    _users = r.users || [];
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const isLider = (me?.lvl || 0) >= 5;
  // Agrupa usuários por team (normaliza por id/label)
  const teamIds = _teams.map(t => t.id);
  const byTeam = {};
  _teams.forEach(t => { byTeam[t.id] = []; });
  const semEquipe = [];
  _users.forEach(u => {
    const t = (u.team || '').toLowerCase();
    const match = _teams.find(x => x.id === t || x.label.toLowerCase() === t);
    if (match) byTeam[match.id].push(u);
    else if ((u.role || '') !== 'socio' && (u.role || '') !== 'diretor') semEquipe.push(u);
  });

  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">👥 Equipes PSM</h2>
          <p class="card-sub">${_users.length} usuários · ${_teams.length} equipes</p>
        </div>
        ${isLider ? `<button class="btn ${_editMode ? 'btn-ghost' : 'btn-primary'}" id="eq-toggle">${_editMode ? '✓ Concluir edição' : '✏️ Gerenciar Equipes'}</button>` : ''}
      </div>

      ${_editMode ? renderEditor() : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(420px, 1fr));gap:14px;margin-top:14px">
        ${_teams.map(t => teamCard(t, byTeam[t.id] || [], me, isLider)).join('')}
      </div>

      ${semEquipe.length ? `
        <div class="card mt-4" style="border:1px dashed var(--bd)">
          <div style="font-weight:800;margin-bottom:8px">⚠️ Sem equipe (${semEquipe.length})</div>
          <div style="display:grid;gap:4px">${semEquipe.map(u => brokerLine(u, me, isLider)).join('')}</div>
        </div>
      ` : ''}
    </div>
  `;

  if (isLider) {
    document.getElementById('eq-toggle').addEventListener('click', () => { _editMode = !_editMode; render(); });
    bindActions();
  }
}

function renderEditor() {
  return `
    <div class="card mt-3" style="background:var(--bg-3);padding:16px">
      <div style="font-weight:800;margin-bottom:10px">✏️ Editar Equipes</div>
      <div id="eq-rows" style="display:flex;flex-direction:column;gap:8px">
        ${_teams.map((t, i) => editorRow(t, i)).join('')}
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-ghost btn-sm" id="eq-add">➕ Nova equipe</button>
        <button class="btn btn-primary btn-sm" id="eq-save">💾 Salvar equipes</button>
      </div>
      <div class="tiny muted mt-2">No card de cada pessoa (abaixo) você edita o <b>Cargo</b> e a <b>Equipe</b>. Mudanças gravam direto nos usuários e <b>refletem em todo o sistema</b> (metas, dashboards da diretoria, marketing, ranking) — pois tudo lê o cargo/nível/equipe do banco. O cargo recalcula o nível de acesso automaticamente.</div>
    </div>
  `;
}

function editorRow(t, i) {
  return `
    <div class="flex gap-2" style="align-items:center" data-row="${i}">
      <input class="input" style="width:50px;text-align:center;font-size:18px" data-f="ico" data-i="${i}" value="${esc(t.ico)}" maxlength="4">
      <input class="input" style="flex:1" data-f="label" data-i="${i}" value="${esc(t.label)}" placeholder="Nome da equipe">
      <input class="input" type="color" style="width:50px;padding:2px" data-f="color" data-i="${i}" value="${esc(t.color)}">
      <button class="btn btn-ghost btn-sm" data-del-team="${i}" style="color:#ef4444">🗑</button>
    </div>
  `;
}

function teamCard(t, users, me, isLider) {
  const ativos = users.filter(u => (u.status || 'ativo') === 'ativo');
  const inativos = users.length - ativos.length;
  const lider = ativos.find(u => (u.role || '').toLowerCase() === 'lider');
  const gerente = ativos.find(u => (u.role || '').toLowerCase() === 'gerente');
  const ROLE_ORDER = { socio: 0, gerente: 1, lider: 2, backoffice: 3, marketing: 4, corretor: 5 };
  const sorted = ativos.slice().sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || '').localeCompare(b.name || ''));

  return `
    <div class="card" style="margin:0;border-top:4px solid ${t.color}">
      <div class="flex items-center gap-2" style="margin-bottom:8px">
        <span style="font-size:24px">${esc(t.ico)}</span>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px">${esc(t.label)}</div>
          <div class="tiny muted">${ativos.length} ativo(s)${inativos ? ` · ${inativos} inativo(s)` : ''}</div>
        </div>
        ${gerente ? `<span class="tiny" style="background:#7c3aed;color:#fff;padding:3px 8px;border-radius:99px;font-weight:700">🎯 ${esc((gerente.name || '').split(' ')[0])}</span>` : ''}
        ${lider ? `<span class="tiny" style="background:#059669;color:#fff;padding:3px 8px;border-radius:99px;font-weight:700">🛡 ${esc((lider.name || '').split(' ')[0])}</span>` : ''}
      </div>
      <div style="display:grid;gap:4px;max-height:380px;overflow-y:auto">
        ${sorted.map(u => brokerLine(u, me, isLider)).join('') || '<div class="muted tiny" style="padding:10px">Nenhum ativo.</div>'}
      </div>
    </div>
  `;
}

function brokerLine(u, me, isLider) {
  const ini = esc((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const isMe = me?.id === u.id;
  const hidden = !!u.hide_from_ranking;
  const roleIco = { socio: '👑', gerente: '🎯', lider: '🛡', backoffice: '📋', marketing: '📢', corretor: '🏠' }[u.role] || '·';
  return `
    <div style="display:grid;grid-template-columns:28px 1fr auto;gap:8px;padding:6px 8px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:12.5px${hidden ? ';opacity:0.6' : ''}">
      <div style="width:24px;height:24px;border-radius:var(--r-sm);background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px">${ini}</div>
      <div style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        <b>${esc(u.name || 'Sem nome')}</b>${isMe ? ' <span class="tiny" style="background:var(--psm-navy);color:#fff;padding:1px 6px;border-radius:3px">VOCÊ</span>' : ''}
        <span class="tiny muted">${roleIco}</span>
      </div>
      ${_editMode && isLider ? `
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          ${(me?.lvl || 0) >= 10 ? `<select class="select" data-role="${u.id}" title="Cargo (muda o nível e reflete no sistema)" style="font-size:11px;padding:2px 4px;max-width:118px">
            ${ROLES.map(([v, l]) => `<option value="${v}" ${(u.role || '').toLowerCase() === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>` : ''}
          <select class="select" data-move="${u.id}" title="Equipe" style="font-size:11px;padding:2px 4px;max-width:118px">
            <option value="">— equipe —</option>
            ${_teams.map(t => `<option value="${t.id}" ${(u.team || '').toLowerCase() === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
          </select>
        </div>
      ` : `<span class="tiny muted">${roleIco} L${u.lvl || '?'}</span>`}
    </div>
  `;
}

function bindActions() {
  if (!_editMode) return;
  // Editar campos de equipe (em memória)
  _root.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', e => {
    const i = +el.dataset.i, f = el.dataset.f;
    if (_teams[i]) _teams[i][f] = e.target.value;
  }));
  // Adicionar equipe
  const add = document.getElementById('eq-add');
  if (add) add.addEventListener('click', () => {
    _teams.push({ id: 'nova_' + Date.now(), label: 'Nova Equipe', color: '#64748b', ico: '📁', lider_id: null, gerente_id: null });
    render();
  });
  // Remover equipe
  _root.querySelectorAll('[data-del-team]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Remover esta equipe? (corretores ficam sem equipe)')) return;
    _teams.splice(+b.dataset.delTeam, 1);
    render();
  }));
  // Salvar equipes
  const save = document.getElementById('eq-save');
  if (save) save.addEventListener('click', async () => {
    try {
      await api.request('/api/v3/teams/manage', { method: 'POST', body: { action: 'save_teams', teams: _teams } });
      alert('✅ Equipes salvas!');
      await load();
    } catch (e) { alert('Erro: ' + e.message); }
  });
  // Mover corretor de equipe
  _root.querySelectorAll('[data-move]').forEach(sel => sel.addEventListener('change', async e => {
    try {
      await api.request('/api/v3/teams/manage', { method: 'POST', body: { action: 'move_user', user_id: sel.dataset.move, team: e.target.value } });
      const u = _users.find(x => x.id === sel.dataset.move);
      if (u) u.team = e.target.value;
      render();
    } catch (err) { alert('Erro: ' + err.message); }
  }));
  // Mudar CARGO (role) — grava em users.role → recalcula lvl → reflete no sistema
  _root.querySelectorAll('[data-role]').forEach(sel => sel.addEventListener('change', async e => {
    const uid = sel.dataset.role, role = e.target.value;
    const u = _users.find(x => x.id === uid);
    const nome = (u?.name || '').split(' ')[0] || 'usuário';
    if (!confirm(`Mudar o cargo de ${nome} para "${role}"? Isso muda o nível de acesso e reflete em metas, dashboards e ranking.`)) { render(); return; }
    try {
      await api.request('/api/v3/users/update', { method: 'POST', body: { id: uid, fields: { role } } });
      if (u) { u.role = role; u.lvl = ROLE_LVL[role] || u.lvl; }
      render();
    } catch (err) { alert('Erro ao mudar cargo: ' + err.message); }
  }));
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
