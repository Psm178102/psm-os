/* ============================================================================
   PSM-OS v2 — Radar de Concorrência (migrado integral do /v1)
   ----------------------------------------------------------------------------
   46 concorrentes de São José do Rio Preto monitorados: tier, segmento,
   Instagram, métricas coletadas e link direto p/ a Biblioteca de Anúncios Meta.
   Sprint 9.8 (v76.5).
============================================================================ */
import { auth } from '../auth.js';
import {
  CONCORRENTES, SEGMENTOS,
  adsLibraryUrl, instagramUrl, parseSeguidores,
} from '../data/concorrentes-seed.js';

const TIER_COR = { A: '#dc2626', B: '#d97706', C: '#64748b' };

let _root = null;
let _f = { tier: 'todos', seg: 'todos', tipo: 'todos', q: '' };
let _sort = 'seguidores';

export async function pageConcorrencia(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl ≥ 5).</div>';
    return;
  }
  render();
}

function filtered() {
  let list = CONCORRENTES.slice();
  if (_f.tier !== 'todos') list = list.filter(c => c.tier === _f.tier);
  if (_f.seg !== 'todos') list = list.filter(c => c.seg === _f.seg);
  if (_f.tipo !== 'todos') list = list.filter(c => c.tipo === _f.tipo);
  if (_f.q) {
    const q = _f.q.toLowerCase();
    list = list.filter(c => c.nome.toLowerCase().includes(q) || (c.handle || '').toLowerCase().includes(q) || (c.bio || '').toLowerCase().includes(q));
  }
  list.sort((a, b) => {
    if (_sort === 'seguidores') return parseSeguidores(b.seguidores) - parseSeguidores(a.seguidores);
    if (_sort === 'posts')      return (parseInt(b.posts) || 0) - (parseInt(a.posts) || 0);
    if (_sort === 'tier')       return (a.tier).localeCompare(b.tier) || parseSeguidores(b.seguidores) - parseSeguidores(a.seguidores);
    if (_sort === 'nome')       return a.nome.localeCompare(b.nome);
    return 0;
  });
  return list;
}

function render() {
  const all = CONCORRENTES;
  const tierCount = t => all.filter(c => c.tier === t).length;
  const segCount = s => all.filter(c => c.seg === s).length;
  const comAds = all.filter(c => c.fb).length;
  const list = filtered();

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🎯 Radar de Concorrência</h2>
      <p class="card-sub">${all.length} imobiliárias/corretores monitorados em São José do Rio Preto · coleta de referência abr/2026</p>

      <!-- KPIs -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('Monitorados', all.length, 'concorrentes RP', '#7c3aed')}
        ${kpi('🔴 Tier A', tierCount('A'), 'ameaça direta / alto padrão', TIER_COR.A)}
        ${kpi('🟠 Tier B', tierCount('B'), 'relevância média', TIER_COR.B)}
        ${kpi('⚪ Tier C', tierCount('C'), 'baixa relevância', TIER_COR.C)}
        ${kpi('📊 Com anúncios', comAds, 'rastreáveis na Biblioteca Meta', '#2563eb')}
      </div>

      <!-- Mapeamento estratégico por segmento -->
      <div class="mt-4" style="margin-top:16px">
        <div class="tiny muted" style="font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Mapeamento estratégico por segmento</div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${Object.keys(SEGMENTOS).map(s => segChip(s, segCount(s))).join('')}
        </div>
      </div>

      <!-- Filtros -->
      <div class="flex gap-2 mt-4" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm);margin-top:16px">
        <label class="tiny muted" style="font-weight:700">TIER:</label>
        <select id="rf-tier" class="select" style="padding:5px 10px;font-size:12px">
          ${opt(['todos','A','B','C'], _f.tier)}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">SEGMENTO:</label>
        <select id="rf-seg" class="select" style="padding:5px 10px;font-size:12px">
          ${opt(['todos', ...Object.keys(SEGMENTOS)], _f.seg)}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">TIPO:</label>
        <select id="rf-tipo" class="select" style="padding:5px 10px;font-size:12px">
          ${opt(['todos','imobiliaria','corretor'], _f.tipo)}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">ORDENAR:</label>
        <select id="rf-sort" class="select" style="padding:5px 10px;font-size:12px">
          <option value="seguidores"${_sort==='seguidores'?' selected':''}>Seguidores ↓</option>
          <option value="posts"${_sort==='posts'?' selected':''}>Posts ↓</option>
          <option value="tier"${_sort==='tier'?' selected':''}>Tier (A→C)</option>
          <option value="nome"${_sort==='nome'?' selected':''}>Nome A→Z</option>
        </select>
        <input id="rf-q" class="input" placeholder="buscar nome / @ / bio…" value="${escapeHtml(_f.q)}" style="padding:5px 10px;font-size:12px;width:200px;margin-left:auto">
      </div>

      <!-- Tabela -->
      <div class="mt-3" style="overflow-x:auto;margin-top:14px">
        <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:760px">
          <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:8px 10px">Concorrente</th>
            <th style="text-align:center;padding:8px 6px">Tier</th>
            <th style="text-align:left;padding:8px 6px">Segmento</th>
            <th style="text-align:right;padding:8px 6px">Seguidores</th>
            <th style="text-align:right;padding:8px 6px">Posts</th>
            <th style="text-align:left;padding:8px 6px">CRECI</th>
            <th style="text-align:center;padding:8px 10px">Canais</th>
          </tr></thead>
          <tbody>
            ${list.length === 0 ? '<tr><td colspan="7" class="muted text-center" style="padding:24px">Nenhum concorrente com esse filtro.</td></tr>'
              : list.map(row).join('')}
          </tbody>
        </table>
      </div>
      <p class="tiny muted mt-2" style="margin-top:10px">💡 Clique em <strong>📊 Anúncios</strong> para abrir a Biblioteca de Anúncios do Meta e ver as campanhas <em>ativas</em> daquele anunciante. <strong>${list.length}</strong> de ${all.length} exibidos.</p>
    </div>
  `;

  document.getElementById('rf-tier').addEventListener('change', e => { _f.tier = e.target.value; render(); });
  document.getElementById('rf-seg').addEventListener('change', e => { _f.seg = e.target.value; render(); });
  document.getElementById('rf-tipo').addEventListener('change', e => { _f.tipo = e.target.value; render(); });
  document.getElementById('rf-sort').addEventListener('change', e => { _sort = e.target.value; render(); });
  document.getElementById('rf-q').addEventListener('input', e => { _f.q = e.target.value; render(); });
}

function row(c) {
  const seg = SEGMENTOS[c.seg] || { label: c.seg, cor: '#64748b' };
  const ig = `<a href="${instagramUrl(c.handle)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#e1306c;text-decoration:none" title="Abrir Instagram">📷 IG</a>`;
  const ads = c.fb
    ? `<a href="${adsLibraryUrl(c.fb)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#2563eb;text-decoration:none;font-weight:700" title="Biblioteca de Anúncios Meta">📊 Anúncios</a>`
    : '<span class="tiny muted">—</span>';
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px">
        <div style="font-weight:700">${escapeHtml(c.nome)}</div>
        <div class="tiny muted">${escapeHtml(c.handle)} · ${c.tipo === 'corretor' ? '👤 Corretor' : '🏢 Imobiliária'}</div>
        ${c.bio ? `<div class="tiny muted" style="margin-top:2px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.bio)}">${escapeHtml(c.bio)}</div>` : ''}
      </td>
      <td style="text-align:center;padding:8px 6px">
        <span style="background:${TIER_COR[c.tier]};color:#fff;padding:2px 9px;border-radius:var(--r-full);font-size:11px;font-weight:800">${c.tier}</span>
      </td>
      <td style="padding:8px 6px">
        <span style="background:${seg.cor}22;color:${seg.cor};padding:2px 8px;border-radius:var(--r-full);font-size:11px;font-weight:700">${escapeHtml(c.seg)}</span>
      </td>
      <td style="text-align:right;padding:8px 6px;font-weight:700">${escapeHtml(c.seguidores)}</td>
      <td style="text-align:right;padding:8px 6px">${escapeHtml(c.posts)}</td>
      <td style="padding:8px 6px;font-size:11px" class="muted">${escapeHtml(c.creci)}</td>
      <td style="text-align:center;padding:8px 10px;white-space:nowrap">${ig} &nbsp; ${ads}</td>
    </tr>
  `;
}

function segChip(s, n) {
  const seg = SEGMENTOS[s];
  return `<div style="flex:1;min-width:180px;background:${seg.cor}14;border-left:4px solid ${seg.cor};border-radius:var(--r-md);padding:10px 12px">
    <div style="font-weight:800;color:${seg.cor}">${escapeHtml(seg.label)} <span class="tiny muted" style="font-weight:700">· ${n}</span></div>
    <div class="tiny muted" style="margin-top:2px">${escapeHtml(seg.desc)}</div>
  </div>`;
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:24px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
    <div class="tiny muted">${sub || ''}</div>
  </div>`;
}

function opt(values, sel) {
  return values.map(v => `<option value="${v}"${v === sel ? ' selected' : ''}>${v === 'todos' ? 'Todos' : v}</option>`).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
