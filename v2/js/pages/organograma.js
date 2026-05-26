/* PSM-OS v2 — Organograma (Sprint 7.22) */
import { api } from '../api.js';

const ROLE_META = {
  socio:      { ico: '👑', color: '#dc2626', label: 'Sócio/Diretor', lvl: 10 },
  diretor:    { ico: '👑', color: '#dc2626', label: 'Sócio/Diretor', lvl: 10 },
  gerente:    { ico: '🎯', color: '#7c3aed', label: 'Gerente',       lvl: 7 },
  backoffice: { ico: '📋', color: '#0891b2', label: 'Back Office',   lvl: 6 },
  lider:      { ico: '🛡', color: '#059669', label: 'Líder',          lvl: 5 },
  marketing:  { ico: '📢', color: '#d97706', label: 'Marketing',     lvl: 3 },
  corretor:   { ico: '🏠', color: '#64748b', label: 'Corretor',      lvl: 2 },
};

let _root = null, _users = [];

export async function pageOrganograma(ctx, root) {
  _root = root;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Construindo hierarquia…</div></div>';
  try {
    const r = await api.request('/api/v3/users/list');
    _users = (r.users || []).filter(u => (u.status || 'ativo') === 'ativo');
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  // Agrupa por role
  const byRole = {};
  _users.forEach(u => { (byRole[u.role || 'corretor'] = byRole[u.role || 'corretor'] || []).push(u); });

  const socios     = (byRole.socio || []).concat(byRole.diretor || []);
  const gerentes   = byRole.gerente || [];
  const back       = byRole.backoffice || [];
  const lideres    = byRole.lider || [];
  const marketing  = byRole.marketing || [];
  const corretores = byRole.corretor || [];

  // Corretores por team
  const corretoresByTeam = {};
  corretores.forEach(c => { (corretoresByTeam[c.team || 'geral'] = corretoresByTeam[c.team || 'geral'] || []).push(c); });

  // Líderes por team
  const lideresByTeam = {};
  lideres.forEach(l => { (lideresByTeam[l.team || 'geral'] = lideresByTeam[l.team || 'geral'] || []).push(l); });

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🌳 Organograma PSM</h2>
      <p class="card-sub">${_users.length} pessoas ativas. Hierarquia: Sócio → Gerente → Líder → Corretor por equipe.</p>

      <!-- Sócios -->
      ${section('Sócios / Diretoria', socios, 'socio')}

      <!-- Gerentes + Back -->
      ${section('Gerência & Back Office', [...gerentes, ...back], gerentes[0]?.role || 'gerente')}

      <!-- Marketing -->
      ${marketing.length ? section('Marketing', marketing, 'marketing') : ''}

      <!-- Equipes (líder + corretores) -->
      <h3 class="card-title mt-4">🛡 Equipes</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:14px">
        ${Object.keys(lideresByTeam).concat(Object.keys(corretoresByTeam).filter(t => !lideresByTeam[t])).filter((v, i, a) => a.indexOf(v) === i).sort().map(team => teamBox(team, lideresByTeam[team] || [], corretoresByTeam[team] || [])).join('')}
      </div>
    </div>
  `;
}

function section(title, list, primaryRole) {
  if (!list.length) return '';
  return `
    <h3 class="card-title mt-4" style="margin-top:14px">${ROLE_META[primaryRole]?.ico || ''} ${escapeHtml(title)} <span class="muted tiny" style="font-weight:400">(${list.length})</span></h3>
    <div class="flex gap-2" style="flex-wrap:wrap">
      ${list.map(u => userCard(u, 'lg')).join('')}
    </div>
  `;
}

function teamBox(team, lideres, corretores) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-md);padding:12px">
      <div style="font-weight:800;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;color:var(--ink)">${escapeHtml(team)}</div>
      ${lideres.length ? `<div style="margin-bottom:8px">${lideres.map(l => userCard(l, 'md')).join('')}</div>` : ''}
      ${corretores.length ? `<div style="display:flex;flex-direction:column;gap:4px;border-left:2px solid var(--border-2);padding-left:10px;margin-left:10px">
        ${corretores.map(c => userCard(c, 'sm')).join('')}
      </div>` : '<div class="muted tiny">Sem corretores.</div>'}
    </div>
  `;
}

function userCard(u, size) {
  const meta = ROLE_META[u.role || 'corretor'] || ROLE_META.corretor;
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const sizes = {
    lg: { box: '120px', av: '46px', font: 14, ini_font: 16 },
    md: { box: 'auto',  av: '32px', font: 13, ini_font: 11 },
    sm: { box: 'auto',  av: '24px', font: 12, ini_font: 9 },
  };
  const s = sizes[size] || sizes.md;
  return `
    <div style="display:flex;align-items:center;gap:8px;padding:6px;background:var(--bg-2);border-radius:var(--r-sm);${size==='lg' ? `width:${s.box};flex-direction:column;text-align:center;padding:12px 8px` : ''}">
      <div style="width:${s.av};height:${s.av};border-radius:50%;background:${u.color || meta.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${s.ini_font}px;flex-shrink:0">${ini}</div>
      <div style="min-width:0;${size==='lg' ? 'text-align:center' : ''}">
        <div style="font-weight:700;font-size:${s.font}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.name || '—')}</div>
        <div class="tiny muted">${meta.ico} ${escapeHtml(meta.label)} · L${meta.lvl}</div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
