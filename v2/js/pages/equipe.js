/* ============================================================================
   PSM-OS v2 — Equipe (visão por time)
   Sprint 7.5
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const TEAM_META = {
  lancamento: { lbl: 'Lançamento', color: '#d4a843', ico: '🏗' },
  conquista:  { lbl: 'Conquista',  color: '#dc2626', ico: '🏆' },
  terceiros:  { lbl: 'Terceiros',  color: '#3b82f6', ico: '🤝' },
  impper:     { lbl: 'IMPPER',     color: '#a855f7', ico: '✨' },
  locacao:    { lbl: 'Locação',    color: '#10b981', ico: '🔑' },
  geral:      { lbl: 'Geral',      color: '#64748b', ico: '📁' },
};

let _root = null;

export async function pageEquipe(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando equipes…</div></div>';
  try {
    const r = await api.request('/api/v3/users/list');
    render(r.users || []);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render(users) {
  // Agrupa por team
  const byTeam = {};
  users.forEach(u => {
    const t = (u.team || 'geral').toLowerCase();
    (byTeam[t] = byTeam[t] || []).push(u);
  });

  // Ordena teams conhecidos primeiro
  const knownOrder = ['lancamento', 'conquista', 'terceiros', 'impper', 'locacao', 'geral'];
  const teams = Object.keys(byTeam).sort((a, b) => {
    const ia = knownOrder.indexOf(a); const ib = knownOrder.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const me = auth.user();

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👥 Equipes PSM</h2>
      <p class="card-sub">${users.length} usuários distribuídos em ${teams.length} equipe(s). Dados do Postgres (fonte da verdade).</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(420px, 1fr));gap:14px;margin-top:14px">
        ${teams.map(t => teamCard(t, byTeam[t], me)).join('')}
      </div>
    </div>
  `;
}

function teamCard(team, users, me) {
  const meta = TEAM_META[team] || { lbl: team, color: '#64748b', ico: '📁' };
  const ativos = users.filter(u => (u.status || 'ativo') === 'ativo');
  const inativos = users.length - ativos.length;
  const lider = ativos.find(u => (u.role || '').toLowerCase() === 'lider');
  const gerente = ativos.find(u => (u.role || '').toLowerCase() === 'gerente');

  // Ordena: gerente → líder → corretores
  const ROLE_ORDER = { socio: 0, gerente: 1, lider: 2, backoffice: 3, marketing: 4, corretor: 5 };
  const sorted = ativos.slice().sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || '').localeCompare(b.name || ''));

  return `
    <div class="card" style="margin:0;border-top:4px solid ${meta.color}">
      <div class="flex items-center gap-2" style="margin-bottom:8px">
        <span style="font-size:24px">${meta.ico}</span>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px">${escapeHtml(meta.lbl)}</div>
          <div class="tiny muted">${ativos.length} ativo(s)${inativos ? ` · ${inativos} inativo(s)` : ''}</div>
        </div>
        ${gerente ? `<span class="tiny" style="background:#7c3aed;color:#fff;padding:3px 8px;border-radius:var(--r-full);font-weight:700">🎯 ${escapeHtml((gerente.name || '').split(' ')[0])}</span>` : ''}
        ${lider ? `<span class="tiny" style="background:#059669;color:#fff;padding:3px 8px;border-radius:var(--r-full);font-weight:700">🛡 ${escapeHtml((lider.name || '').split(' ')[0])}</span>` : ''}
      </div>

      <div style="display:grid;gap:4px;max-height:380px;overflow-y:auto">
        ${sorted.map(u => brokerLine(u, me)).join('') || '<div class="muted tiny" style="padding:10px">Nenhum ativo.</div>'}
      </div>
    </div>
  `;
}

function brokerLine(u, me) {
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const isMe = me?.id === u.id;
  const hidden = !!u.hide_from_ranking;
  const roleIco = { socio: '👑', gerente: '🎯', lider: '🛡', backoffice: '📋', marketing: '📢', corretor: '🏠' }[u.role] || '·';
  return `
    <div style="display:grid;grid-template-columns:28px 1fr auto auto;gap:8px;padding:6px 8px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:12.5px${hidden ? ';opacity:0.6' : ''}">
      <div style="width:24px;height:24px;border-radius:var(--r-sm);background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px">${ini}</div>
      <div style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        <b>${escapeHtml(u.name || 'Sem nome')}</b>${isMe ? ' <span class="tiny" style="background:var(--psm-navy);color:#fff;padding:1px 6px;border-radius:3px;letter-spacing:1px">VOCÊ</span>' : ''}
        ${hidden ? ' <span class="tiny muted">(oculto)</span>' : ''}
      </div>
      <span class="tiny muted" title="${escapeHtml(u.role || '')}">${roleIco}</span>
      <span class="tiny muted">L${u.lvl || '?'}</span>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
