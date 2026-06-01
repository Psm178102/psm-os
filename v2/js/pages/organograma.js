/* PSM-OS v2 — Organograma (árvore hierárquica + atalho pro cockpit 1:1) */
import { api } from '../api.js';

const ROLE_META = {
  socio:      { ico: '👑', color: '#dc2626', label: 'Sócio/Diretor', lvl: 10 },
  diretor:    { ico: '👑', color: '#dc2626', label: 'Sócio/Diretor', lvl: 10 },
  gerente:    { ico: '🎯', color: '#7c3aed', label: 'Gerente',       lvl: 7 },
  backoffice: { ico: '📋', color: '#0891b2', label: 'Back Office',   lvl: 6 },
  lider:      { ico: '🛡', color: '#059669', label: 'Líder',          lvl: 5 },
  financeiro: { ico: '💰', color: '#0d9488', label: 'Financeiro',    lvl: 4 },
  marketing:  { ico: '📢', color: '#d97706', label: 'Marketing',     lvl: 3 },
  corretor:   { ico: '🏠', color: '#64748b', label: 'Corretor',      lvl: 2 },
};
const CLICKABLE = new Set(['corretor', 'lider']);  // abrem o cockpit 1:1

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
  const byRole = {};
  _users.forEach(u => { (byRole[u.role || 'corretor'] = byRole[u.role || 'corretor'] || []).push(u); });
  const socios = (byRole.socio || []).concat(byRole.diretor || []);
  const gerentes = byRole.gerente || [];
  const back = byRole.backoffice || [];
  const fin = byRole.financeiro || [];
  const marketing = byRole.marketing || [];
  const lideres = byRole.lider || [];
  const corretores = byRole.corretor || [];

  const corrByTeam = {}, lidByTeam = {};
  corretores.forEach(c => { (corrByTeam[c.team || 'Sem equipe'] = corrByTeam[c.team || 'Sem equipe'] || []).push(c); });
  lideres.forEach(l => { (lidByTeam[l.team || 'Sem equipe'] = lidByTeam[l.team || 'Sem equipe'] || []).push(l); });
  const teams = Array.from(new Set([...Object.keys(lidByTeam), ...Object.keys(corrByTeam)])).sort();

  const tier = (list) => `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${list.map(u => personChip(u)).join('')}</div>`;
  const connector = () => `<div style="width:2px;height:22px;background:var(--border-2,#cbd5e1);margin:2px auto"></div>`;

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <h2 class="card-title">🌳 Organograma PSM</h2>
          <p class="card-sub">${_users.length} pessoas ativas · ${teams.length} equipes. Clique num 🏠 corretor / 🛡 líder pra abrir o cockpit One-on-One.</p>
        </div>
        <div class="tiny muted" style="text-align:right;line-height:1.7">
          ${Object.entries({ socio: socios.length, gerente: gerentes.length, lider: lideres.length, corretor: corretores.length }).map(([k, n]) => `${ROLE_META[k].ico} ${n}`).join(' · ')}
        </div>
      </div>

      <!-- Cúpula -->
      <div style="margin-top:16px;text-align:center">
        ${tier(socios)}
        ${(gerentes.length || back.length || fin.length) ? connector() + tier([...gerentes, ...back, ...fin]) : ''}
        ${marketing.length ? connector() + tier(marketing) : ''}
      </div>

      <!-- Equipes -->
      <div style="margin-top:8px">${connector()}</div>
      <div style="height:2px;background:var(--border-2,#cbd5e1);margin:0 0 14px"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px">
        ${teams.map(t => teamBox(t, lidByTeam[t] || [], corrByTeam[t] || [])).join('')}
      </div>
    </div>`;

  _root.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
    sessionStorage.setItem('oo.open', el.dataset.open);
    location.hash = '#/one-on-one';
  }));
}

function teamBox(team, lideres, corretores) {
  const total = lideres.length + corretores.length;
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden">
      <div style="background:var(--bg-3);padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.5px">${escapeHtml(team)}</span>
        <span class="tiny muted">${total} pessoa${total !== 1 ? 's' : ''}</span>
      </div>
      <div style="padding:10px 12px">
        ${lideres.length ? lideres.map(l => personChip(l, 'lead')).join('') : ''}
        ${corretores.length ? `<div style="margin-top:${lideres.length ? '8px' : '0'};border-left:2px solid var(--border-2,#cbd5e1);padding-left:10px;display:flex;flex-direction:column;gap:5px">
          ${corretores.map(c => personChip(c, 'row')).join('')}
        </div>` : (lideres.length ? '' : '<div class="muted tiny">Sem pessoas.</div>')}
      </div>
    </div>`;
}

function personChip(u, variant) {
  const meta = ROLE_META[u.role || 'corretor'] || ROLE_META.corretor;
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const click = CLICKABLE.has(u.role || 'corretor');
  const attrs = click ? `data-open="${escapeHtml(u.id)}" title="Abrir cockpit 1:1 de ${escapeHtml(u.name)}"` : '';
  const cursor = click ? 'cursor:pointer' : '';
  if (variant === 'row' || variant === 'lead') {
    return `<div ${attrs} style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:var(--r-sm);${cursor};${variant === 'lead' ? 'background:var(--bg-3)' : ''}" ${click ? 'onmouseover="this.style.background=\'var(--bg-3)\'" onmouseout="this.style.background=\'' + (variant === 'lead' ? 'var(--bg-3)' : 'transparent') + '\'"' : ''}>
      <div style="width:28px;height:28px;border-radius:50%;background:${u.color || meta.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0">${ini}</div>
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.name || '—')}</div>
        <div class="tiny muted">${meta.ico} ${escapeHtml(meta.label)}</div>
      </div>
      ${click ? '<span class="tiny muted">→</span>' : ''}
    </div>`;
  }
  // chip "card" (cúpula)
  return `<div ${attrs} style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px;width:118px;padding:12px 8px;background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${meta.color};border-radius:var(--r-md);${cursor}" ${click ? 'onmouseover="this.style.boxShadow=\'0 4px 12px rgba(0,0,0,.1)\'" onmouseout="this.style.boxShadow=\'none\'"' : ''}>
    <div style="width:44px;height:44px;border-radius:50%;background:${u.color || meta.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px">${ini}</div>
    <div style="font-weight:700;font-size:13px;line-height:1.2">${escapeHtml(u.name || '—')}</div>
    <div class="tiny muted">${meta.ico} ${escapeHtml(meta.label)}</div>
  </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
