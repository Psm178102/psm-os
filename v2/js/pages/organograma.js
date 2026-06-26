/* PSM-OS v2 — Organograma (Grupo PSM → unidades) · v81.92
   Hierarquia: PSM (cúpula) → PSM Conquista · PSM M.A.P · PSM Locações · PSM Terceiros
   + Áreas de apoio (backoffice/marketing/financeiro/secretaria/RH). */
import { api } from '../api.js';

const ROLE_META = {
  socio:      { ico: '👑', color: '#dc2626', label: 'Sócio/Diretor', lvl: 10 },
  diretor:    { ico: '👑', color: '#dc2626', label: 'Sócio/Diretor', lvl: 10 },
  gerente:    { ico: '🎯', color: '#7c3aed', label: 'Gerente',       lvl: 7 },
  gerente_conquista: { ico: '🎯', color: '#f59e0b', label: 'Gerente Conquista', lvl: 7 },
  gerente_map:       { ico: '🎯', color: '#a855f7', label: 'Gerente MAP',       lvl: 7 },
  gerente_locacao:   { ico: '🎯', color: '#0891b2', label: 'Gerente Locação',   lvl: 7 },
  gerente_terceiros: { ico: '🎯', color: '#0d9488', label: 'Gerente Terceiros', lvl: 7 },
  backoffice: { ico: '📋', color: '#0891b2', label: 'Back Office',   lvl: 6 },
  secretaria_vendas: { ico: '🗂️', color: '#db2777', label: 'Secretária de Vendas', lvl: 3 },
  lider:      { ico: '🛡', color: '#059669', label: 'Líder',          lvl: 5 },
  financeiro: { ico: '💰', color: '#0d9488', label: 'Financeiro',    lvl: 4 },
  marketing:  { ico: '📢', color: '#d97706', label: 'Marketing',     lvl: 3 },
  corretor:   { ico: '🏠', color: '#64748b', label: 'Corretor',      lvl: 2 },
  corretor_conquista: { ico: '🏠', color: '#f59e0b', label: 'Corretor Conquista', lvl: 2 },
  corretor_map:       { ico: '🗺️', color: '#a855f7', label: 'Corretor MAP',       lvl: 2 },
  corretor_locacao:   { ico: '🔑', color: '#a16207', label: 'Corretor Locação',   lvl: 2 },
  corretor_terceiros: { ico: '🤝', color: '#0d9488', label: 'Corretor Terceiros', lvl: 2 },
};
const UNITS = [
  { id: 'conquista', nome: 'PSM Conquista', cor: '#f59e0b', ico: '🏠' },
  { id: 'map',       nome: 'PSM M.A.P',     cor: '#a855f7', ico: '🗺️' },
  { id: 'locacao',   nome: 'PSM Locações',  cor: '#0891b2', ico: '🔑' },
  { id: 'terceiros', nome: 'PSM Terceiros', cor: '#0d9488', ico: '🤝' },
];

let _root = null, _users = [];

const metaOf = u => ROLE_META[(u.role || 'corretor').toLowerCase()] || ROLE_META.corretor;
const lvlOf = u => (metaOf(u).lvl) || 2;

function unitOf(u) {
  const role = (u.role || '').toLowerCase();
  if (role === 'socio' || role === 'diretor') return null;   // cúpula, não entra em unidade
  const hay = role + ' ' + (u.team || '').toLowerCase();
  if (/conquista/.test(hay)) return 'conquista';
  if (/(^|[^a-z])map([^a-z]|$)|m\.?a\.?p/.test(hay)) return 'map';
  if (/loca/.test(hay)) return 'locacao';
  if (/terceir/.test(hay)) return 'terceiros';
  return null;
}

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
  const cupula = _users.filter(u => ['socio', 'diretor'].includes((u.role || '').toLowerCase()))
    .sort((a, b) => lvlOf(b) - lvlOf(a));
  const byUnit = { conquista: [], map: [], locacao: [], terceiros: [] };
  const apoio = [];
  _users.forEach(u => {
    if (['socio', 'diretor'].includes((u.role || '').toLowerCase())) return;
    const un = unitOf(u);
    if (un) byUnit[un].push(u); else apoio.push(u);
  });
  Object.values(byUnit).forEach(l => l.sort((a, b) => lvlOf(b) - lvlOf(a)));
  apoio.sort((a, b) => lvlOf(b) - lvlOf(a));

  const tier = list => `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${list.map(u => personChip(u)).join('')}</div>`;
  const connector = () => `<div style="width:2px;height:22px;background:var(--border-2,#cbd5e1);margin:2px auto"></div>`;

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <h2 class="card-title">🌳 Organograma — Grupo PSM</h2>
          <p class="card-sub">${_users.length} pessoas ativas. Estrutura por unidade de negócio. Clique numa pessoa pra abrir o cockpit One-on-One.</p>
        </div>
        <div class="tiny muted" style="text-align:right">${UNITS.map(u => `${u.ico} ${byUnit[u.id].length}`).join(' · ')}</div>
      </div>

      <!-- Cúpula: Grupo PSM -->
      <div style="margin-top:16px;text-align:center">
        <div style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#dc2626);color:#fff;font-weight:900;letter-spacing:1px;padding:8px 22px;border-radius:999px;font-size:15px">🏛 GRUPO PSM</div>
        ${cupula.length ? connector() + tier(cupula) : ''}
      </div>

      <div style="margin-top:8px">${connector()}</div>
      <div style="height:2px;background:var(--border-2,#cbd5e1);margin:0 0 14px"></div>

      <!-- 4 unidades -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
        ${UNITS.map(u => unitBox(u, byUnit[u.id])).join('')}
      </div>

      ${apoio.length ? `
        <div style="height:1px;background:var(--border-2,#cbd5e1);margin:18px 0 14px"></div>
        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden">
          <div style="background:var(--bg-3);padding:8px 12px;border-bottom:1px solid var(--border);font-weight:800;font-size:13px">🧩 Áreas de apoio · Grupo PSM <span class="tiny muted">(${apoio.length})</span></div>
          <div style="padding:10px 12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px">${apoio.map(u => personChip(u, 'row')).join('')}</div>
        </div>` : ''}
    </div>`;

  _root.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
    sessionStorage.setItem('oo.open', el.dataset.open);
    location.hash = '#/one-on-one';
  }));
}

function unitBox(unit, pessoas) {
  const gestores = pessoas.filter(p => lvlOf(p) >= 7);
  const lideres = pessoas.filter(p => lvlOf(p) === 5);
  const resto = pessoas.filter(p => lvlOf(p) < 5);
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${unit.cor};border-radius:var(--r-md);overflow:hidden">
      <div style="background:${unit.cor}14;padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:800;font-size:13px;color:${unit.cor}">${unit.ico} ${escapeHtml(unit.nome)}</span>
        <span class="tiny muted">${pessoas.length} pessoa${pessoas.length !== 1 ? 's' : ''}</span>
      </div>
      <div style="padding:10px 12px">
        ${gestores.map(p => personChip(p, 'lead')).join('')}
        ${lideres.map(p => personChip(p, 'lead')).join('')}
        ${resto.length ? `<div style="margin-top:${gestores.length || lideres.length ? '8px' : '0'};border-left:2px solid var(--border-2,#cbd5e1);padding-left:10px;display:flex;flex-direction:column;gap:5px">
          ${resto.map(p => personChip(p, 'row')).join('')}
        </div>` : (gestores.length || lideres.length ? '' : '<div class="muted tiny">Sem pessoas nesta unidade.</div>')}
      </div>
    </div>`;
}

function personChip(u, variant) {
  const meta = metaOf(u);
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const click = !['socio', 'diretor'].includes((u.role || '').toLowerCase());   // todos menos a cúpula abrem 1:1
  const attrs = click ? `data-open="${escapeHtml(u.id)}" title="Abrir cockpit 1:1 de ${escapeHtml(u.name)}"` : '';
  const cursor = click ? 'cursor:pointer' : '';
  if (variant === 'row' || variant === 'lead') {
    return `<div ${attrs} style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:var(--r-sm);${cursor};${variant === 'lead' ? 'background:var(--bg-3)' : ''}">
      <div style="width:28px;height:28px;border-radius:50%;background:${u.color || meta.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0">${ini}</div>
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.name || '—')}</div>
        <div class="tiny muted">${meta.ico} ${escapeHtml(meta.label)}</div>
      </div>
      ${click ? '<span class="tiny muted">→</span>' : ''}
    </div>`;
  }
  return `<div ${attrs} style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px;width:118px;padding:12px 8px;background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${meta.color};border-radius:var(--r-md);${cursor}">
    <div style="width:44px;height:44px;border-radius:50%;background:${u.color || meta.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px">${ini}</div>
    <div style="font-weight:700;font-size:13px;line-height:1.2">${escapeHtml(u.name || '—')}</div>
    <div class="tiny muted">${meta.ico} ${escapeHtml(meta.label)}</div>
  </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
