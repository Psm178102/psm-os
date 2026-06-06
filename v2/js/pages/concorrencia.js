/* ============================================================================
   PSM-OS v2 — Radar de Concorrência (base ÚNICA editável · Sprint 9.27)
   ----------------------------------------------------------------------------
   Fonte única: tabela `concorrentes` (Postgres). Lê de /api/v3/concorrentes/list;
   se a tabela estiver vazia, mostra a base curada (seed, 46 imobiliárias de Rio
   Preto) e oferece "Importar base curada". Gestão (lvl≥5) adiciona/edita/exclui.
   Benchmark e Intel-Dashboard leem a MESMA tabela.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import {
  CONCORRENTES, SEGMENTOS,
  adsLibraryUrl, instagramUrl, parseSeguidores,
} from '../data/concorrentes-seed.js';

const TIER_COR = { A: '#dc2626', B: '#d97706', C: '#64748b' };

let _root = null;
let _items = [];
let _fromSeed = false;   // true = tabela vazia, exibindo seed (não persistido)
let _editing = null;
let _f = { tier: 'todos', seg: 'todos', tipo: 'todos', q: '' };
let _sort = 'seguidores';
const canEdit = () => (auth.user()?.lvl || 0) >= 5;

export async function pageConcorrencia(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl ≥ 5).</div>';
    return;
  }
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando concorrentes…</div></div>';
  await load();
}

function mapDb(r) {
  return { ...r, seg: r.segmento || r.seg || '—', _id: r.id, _follow: +r.seguidores || 0 };
}
function mapSeed(c) {
  return { ...c, _id: null, _follow: parseSeguidores(c.seguidores) };
}

async function load() {
  try {
    const r = await api.request('/api/v3/concorrentes/list');
    const rows = r.concorrentes || [];
    if (rows.length) { _items = rows.map(mapDb); _fromSeed = false; }
    else { _items = CONCORRENTES.map(mapSeed); _fromSeed = true; }
  } catch (e) {
    _items = CONCORRENTES.map(mapSeed); _fromSeed = true;
  }
  render();
}

function filtered() {
  let list = _items.slice();
  if (_f.tier !== 'todos') list = list.filter(c => c.tier === _f.tier);
  if (_f.seg !== 'todos') list = list.filter(c => c.seg === _f.seg);
  if (_f.tipo !== 'todos') list = list.filter(c => c.tipo === _f.tipo);
  if (_f.q) {
    const q = _f.q.toLowerCase();
    list = list.filter(c => (c.nome || '').toLowerCase().includes(q) || (c.handle || '').toLowerCase().includes(q) || (c.bio || '').toLowerCase().includes(q));
  }
  list.sort((a, b) => {
    if (_sort === 'seguidores') return b._follow - a._follow;
    if (_sort === 'posts')      return (parseInt(b.posts) || 0) - (parseInt(a.posts) || 0);
    if (_sort === 'tier')       return String(a.tier || 'Z').localeCompare(String(b.tier || 'Z')) || b._follow - a._follow;
    if (_sort === 'nome')       return (a.nome || '').localeCompare(b.nome || '');
    return 0;
  });
  return list;
}

function render() {
  const all = _items;
  const tierCount = t => all.filter(c => c.tier === t).length;
  const segCount = s => all.filter(c => c.seg === s).length;
  const comAds = all.filter(c => c.fb).length;
  const list = filtered();
  const edit = canEdit();

  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">🥊 Radar de Concorrência</h2>
          <p class="card-sub">${all.length} imobiliárias/corretores monitorados em São José do Rio Preto${_fromSeed ? ' · <b>base curada (não salva)</b>' : ' · base viva (editável)'}</p>
        </div>
        ${edit ? `<div class="flex gap-2" style="flex-wrap:wrap">
          ${_fromSeed ? `<button class="btn btn-ghost" id="rc-import">📥 Importar base curada (${CONCORRENTES.length})</button>` : ''}
          <button class="btn btn-primary" id="rc-new">➕ Concorrente</button>
        </div>` : ''}
      </div>

      ${_fromSeed && edit ? `<div class="alert alert-warn" style="margin-top:10px">⏳ Tabela vazia — exibindo a base curada de referência. Clique em <b>Importar base curada</b> pra salvar os ${CONCORRENTES.length} no banco e poder editar/adicionar. (precisa rodar supabase/sprint9_27_concorrentes_rich.sql)</div>` : ''}

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('Monitorados', all.length, 'concorrentes RP', '#7c3aed')}
        ${kpi('🔴 Tier A', tierCount('A'), 'ameaça direta / alto padrão', TIER_COR.A)}
        ${kpi('🟠 Tier B', tierCount('B'), 'relevância média', TIER_COR.B)}
        ${kpi('⚪ Tier C', tierCount('C'), 'baixa relevância', TIER_COR.C)}
        ${kpi('📊 Com anúncios', comAds, 'rastreáveis na Biblioteca Meta', '#2563eb')}
      </div>

      <div class="mt-4" style="margin-top:16px">
        <div class="tiny muted" style="font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Mapeamento estratégico por segmento</div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${Object.keys(SEGMENTOS).map(s => segChip(s, segCount(s))).join('')}
        </div>
      </div>

      <div class="flex gap-2 mt-4" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm);margin-top:16px">
        <label class="tiny muted" style="font-weight:700">TIER:</label>
        <select id="rf-tier" class="select" style="padding:5px 10px;font-size:12px">${opt(['todos','A','B','C'], _f.tier)}</select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">SEGMENTO:</label>
        <select id="rf-seg" class="select" style="padding:5px 10px;font-size:12px">${opt(['todos', ...Object.keys(SEGMENTOS)], _f.seg)}</select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">TIPO:</label>
        <select id="rf-tipo" class="select" style="padding:5px 10px;font-size:12px">${opt(['todos','imobiliaria','corretor'], _f.tipo)}</select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">ORDENAR:</label>
        <select id="rf-sort" class="select" style="padding:5px 10px;font-size:12px">
          <option value="seguidores"${_sort==='seguidores'?' selected':''}>Seguidores ↓</option>
          <option value="posts"${_sort==='posts'?' selected':''}>Posts ↓</option>
          <option value="tier"${_sort==='tier'?' selected':''}>Tier (A→C)</option>
          <option value="nome"${_sort==='nome'?' selected':''}>Nome A→Z</option>
        </select>
        <input id="rf-q" class="input" placeholder="buscar nome / @ / bio…" value="${escapeHtml(_f.q)}" style="padding:5px 10px;font-size:12px;width:200px;margin-left:auto">
      </div>

      <div class="mt-3" style="overflow-x:auto;margin-top:14px">
        <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:760px">
          <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:8px 10px">Concorrente</th>
            <th style="text-align:center;padding:8px 6px">Tier</th>
            <th style="text-align:left;padding:8px 6px">Segmento</th>
            <th style="text-align:right;padding:8px 6px">Seguidores</th>
            <th style="text-align:right;padding:8px 6px">Posts</th>
            <th style="text-align:left;padding:8px 6px">CRECI</th>
            <th style="text-align:center;padding:8px 10px">Canais${edit && !_fromSeed ? ' / Ações' : ''}</th>
          </tr></thead>
          <tbody>
            ${list.length === 0 ? '<tr><td colspan="7" class="muted text-center" style="padding:24px">Nenhum concorrente com esse filtro.</td></tr>'
              : list.map(row).join('')}
          </tbody>
        </table>
      </div>
      <p class="tiny muted mt-2" style="margin-top:10px">💡 <strong>📊 Anúncios</strong> abre a Biblioteca de Anúncios do Meta daquele anunciante. <strong>${list.length}</strong> de ${all.length} exibidos.</p>
    </div>
    <div id="rc-modal"></div>
  `;

  document.getElementById('rf-tier').addEventListener('change', e => { _f.tier = e.target.value; render(); });
  document.getElementById('rf-seg').addEventListener('change', e => { _f.seg = e.target.value; render(); });
  document.getElementById('rf-tipo').addEventListener('change', e => { _f.tipo = e.target.value; render(); });
  document.getElementById('rf-sort').addEventListener('change', e => { _sort = e.target.value; render(); });
  document.getElementById('rf-q').addEventListener('input', e => { _f.q = e.target.value; render(); });
  if (edit) {
    const nw = document.getElementById('rc-new'); if (nw) nw.addEventListener('click', () => { _editing = {}; openForm(); });
    const im = document.getElementById('rc-import'); if (im) im.addEventListener('click', importarSeed);
    _root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); _editing = _items.find(c => String(c._id) === b.dataset.edit); openForm(); }));
    _root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); del(b.dataset.del); }));
  }
}

function dispFollow(c) {
  if (c.seguidores == null || c.seguidores === '') return '—';
  return typeof c.seguidores === 'number' ? c.seguidores.toLocaleString('pt-BR') : escapeHtml(c.seguidores);
}

function row(c) {
  const seg = SEGMENTOS[c.seg] || { label: c.seg, cor: '#64748b' };
  const ig = c.handle ? `<a href="${instagramUrl(c.handle)}" target="_blank" rel="noopener" data-stop="1" style="color:#e1306c;text-decoration:none" title="Abrir Instagram">📷 IG</a>` : '';
  const ads = c.fb
    ? `<a href="${adsLibraryUrl(c.fb)}" target="_blank" rel="noopener" data-stop="1" style="color:#2563eb;text-decoration:none;font-weight:700" title="Biblioteca de Anúncios Meta">📊 Anúncios</a>`
    : '<span class="tiny muted">—</span>';
  const acoes = (canEdit() && !_fromSeed && c._id != null)
    ? `<span data-edit="${escapeHtml(String(c._id))}" style="cursor:pointer;padding:2px 5px" title="Editar">✏️</span><span data-del="${escapeHtml(String(c._id))}" style="cursor:pointer;padding:2px 5px" title="Excluir">🗑</span>`
    : '';
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px">
        <div style="font-weight:700">${escapeHtml(c.nome)}</div>
        <div class="tiny muted">${escapeHtml(c.handle || '')}${c.tipo ? ' · ' + (c.tipo === 'corretor' ? '👤 Corretor' : '🏢 Imobiliária') : ''}</div>
        ${c.bio ? `<div class="tiny muted" style="margin-top:2px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.bio)}">${escapeHtml(c.bio)}</div>` : ''}
      </td>
      <td style="text-align:center;padding:8px 6px">
        ${c.tier ? `<span style="background:${TIER_COR[c.tier] || '#64748b'};color:#fff;padding:2px 9px;border-radius:var(--r-full);font-size:11px;font-weight:800">${escapeHtml(c.tier)}</span>` : '<span class="tiny muted">—</span>'}
      </td>
      <td style="padding:8px 6px">
        <span style="background:${seg.cor}22;color:${seg.cor};padding:2px 8px;border-radius:var(--r-full);font-size:11px;font-weight:700">${escapeHtml(c.seg)}</span>
      </td>
      <td style="text-align:right;padding:8px 6px;font-weight:700">${dispFollow(c)}</td>
      <td style="text-align:right;padding:8px 6px">${escapeHtml(c.posts != null ? c.posts : '—')}</td>
      <td style="padding:8px 6px;font-size:11px" class="muted">${escapeHtml(c.creci || '—')}</td>
      <td style="text-align:center;padding:8px 10px;white-space:nowrap">${ig} ${ig && ads ? '&nbsp;' : ''} ${ads} ${acoes ? '&nbsp; ' + acoes : ''}</td>
    </tr>
  `;
}

/* ─── Importar base curada (bulk) ─── */
async function importarSeed() {
  const btn = document.getElementById('rc-import');
  if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
  const slugify = s => String(s || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const items = CONCORRENTES.map(c => ({
    slug: slugify(c.handle || c.nome), nome: c.nome, handle: c.handle, tipo: c.tipo, tier: c.tier,
    segmento: c.seg, seguidores: parseSeguidores(c.seguidores), posts: parseInt(c.posts) || 0,
    creci: c.creci, fb: c.fb, bio: c.bio,
  }));
  try {
    const r = await api.request('/api/v3/concorrentes/upsert', { method: 'POST', body: { action: 'bulk', items } });
    if (r && r.ok === false && r.pending) { alert(r.error); if (btn) { btn.disabled = false; btn.textContent = '📥 Importar base curada (' + CONCORRENTES.length + ')'; } return; }
    await load();
  } catch (e) { alert('Erro ao importar: ' + e.message); if (btn) { btn.disabled = false; } }
}

/* ─── Form CRUD ─── */
function openForm() {
  const c = _editing || {};
  const modal = document.getElementById('rc-modal');
  const sel = (id, opts, cur) => `<select id="${id}" class="input" style="width:100%">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${escapeHtml(v)}"${String(v) === String(cur || '') ? ' selected' : ''}>${escapeHtml(l)}</option>`; }).join('')}</select>`;
  const f = (id, label, val, ph = '', type = '') => `<div><label class="tiny muted" style="font-weight:700">${label}</label><input id="${id}" class="input" ${type ? `type="${type}"` : ''} value="${escapeHtml(val ?? '')}" placeholder="${escapeHtml(ph)}" style="width:100%"></div>`;
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:600px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${c._id ? '✏️ Editar' : '➕ Novo'} concorrente</h3>
          <button class="btn btn-ghost btn-sm" id="rc-x">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <div style="grid-column:1/-1">${f('cc-nome', 'Nome', c.nome, 'Imobiliária / corretor')}</div>
          ${f('cc-handle', 'Instagram (@)', c.handle, '@perfil')}
          <div><label class="tiny muted" style="font-weight:700">Tipo</label>${sel('cc-tipo', [['imobiliaria', '🏢 Imobiliária'], ['corretor', '👤 Corretor']], c.tipo || 'imobiliaria')}</div>
          <div><label class="tiny muted" style="font-weight:700">Tier</label>${sel('cc-tier', [['A', '🔴 A — ameaça direta'], ['B', '🟠 B — média'], ['C', '⚪ C — baixa']], c.tier || 'B')}</div>
          <div><label class="tiny muted" style="font-weight:700">Segmento</label>${sel('cc-seg', Object.keys(SEGMENTOS).map(k => [k, SEGMENTOS[k].label]), c.seg)}</div>
          ${f('cc-seguidores', 'Seguidores', typeof c.seguidores === 'number' ? c.seguidores : parseSeguidores(c.seguidores) || '', 'nº', 'number')}
          ${f('cc-posts', 'Posts', c.posts, 'nº', 'number')}
          ${f('cc-creci', 'CRECI', c.creci, '')}
          ${f('cc-fb', 'Page ID Meta (anúncios)', c.fb, 'id da página p/ Biblioteca de Anúncios')}
          ${f('cc-engaj', 'Engajamento (%)', c.engajamento, '', 'number')}
          ${f('cc-imoveis', 'Imóveis ativos', c.imoveis_ativos, '', 'number')}
          <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">Bio / observações</label><textarea id="cc-bio" class="input" rows="2" style="width:100%">${escapeHtml(c.bio || c.observacoes || '')}</textarea></div>
        </div>
        <div id="cc-err" class="tiny" style="color:#dc2626;margin-top:8px"></div>
        <div class="flex gap-2 mt-3" style="justify-content:space-between">
          ${c._id ? `<button class="btn btn-ghost" id="cc-del" style="color:#dc2626">🗑 Excluir</button>` : '<span></span>'}
          <div class="flex gap-2"><button class="btn btn-ghost" id="cc-cancel">Cancelar</button><button class="btn btn-primary" id="cc-save">${c._id ? 'Salvar' : 'Adicionar'}</button></div>
        </div>
      </div>
    </div>`;
  const close = () => { modal.innerHTML = ''; };
  document.getElementById('rc-x').addEventListener('click', close);
  document.getElementById('rc-cancel').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
  document.getElementById('cc-save').addEventListener('click', () => save(c));
  if (c._id) { const d = document.getElementById('cc-del'); if (d) d.addEventListener('click', () => { close(); del(String(c._id)); }); }
}

async function save(c) {
  const g = id => document.getElementById(id);
  const nome = g('cc-nome').value.trim();
  if (!nome) { g('cc-err').textContent = 'Nome é obrigatório.'; return; }
  const numOr = id => { const v = g(id).value.trim(); return v === '' ? null : (Number(v) || 0); };
  const bio = g('cc-bio').value.trim();
  const body = {
    id: c._id || undefined,
    nome, handle: g('cc-handle').value.trim() || null, tipo: g('cc-tipo').value, tier: g('cc-tier').value,
    segmento: g('cc-seg').value, seguidores: numOr('cc-seguidores'), posts: numOr('cc-posts'),
    creci: g('cc-creci').value.trim() || null, fb: g('cc-fb').value.trim() || null,
    engajamento: numOr('cc-engaj'), imoveis_ativos: numOr('cc-imoveis'),
    bio: bio || null, observacoes: bio || null,
  };
  const btn = g('cc-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    await api.request('/api/v3/concorrentes/upsert', { method: 'POST', body });
    document.getElementById('rc-modal').innerHTML = '';
    await load();
  } catch (e) { g('cc-err').textContent = e.message; btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function del(id) {
  const c = _items.find(x => String(x._id) === String(id));
  if (!confirm(`Excluir "${(c && c.nome) || 'este concorrente'}" do radar?`)) return;
  try { await api.request('/api/v3/concorrentes/upsert', { method: 'POST', body: { id, _delete: true } }); await load(); }
  catch (e) { alert('Erro: ' + e.message); }
}

function segChip(s, n) {
  const seg = SEGMENTOS[s];
  if (!seg) return '';
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
