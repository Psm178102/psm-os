/* PSM-OS v2 — "Paulo Morimatsu" (Marketing): pipeline de CONTEÚDO da marca pessoal.
   Por PLATAFORMA (IG/TikTok/YouTube) × ETAPA × SEMANA + Planner Mensal.
   Responsável por conteúdo (Paulo / Guilherme / Isabella). board=conteudo. v77.54 */
import { api } from '../api.js';

let _root = null;
let _cards = [];
let _plat = 'instagram';   // aba ativa: instagram|tiktok|youtube|planner
let _semana = '';          // filtro de semana ('' = todas)
let _dragId = null;
let _board = 'conteudo';   // conteudo (Paulo Morimatsu) | conteudo_imoveis | conteudo_conquista

const BOARD_TITLE = { conteudo: 'Paulo Morimatsu', conteudo_imoveis: 'PSM Imóveis', conteudo_conquista: 'PSM Conquista' };

const PLATAFORMAS = [
  { id: 'instagram', lbl: 'Instagram', ic: '📸', cor: '#d6249f' },
  { id: 'tiktok',    lbl: 'TikTok',    ic: '🎵', cor: '#111827' },
  { id: 'youtube',   lbl: 'YouTube',   ic: '▶️', cor: '#ef4444' },
];
const platInfo = id => PLATAFORMAS.find(p => p.id === id) || { lbl: id || '—', ic: '•', cor: '#64748b' };

const FORMATOS = {
  instagram: ['Reel', 'Carrossel', 'Post', 'Stories'],
  tiktok:    ['Vídeo', 'Foto'],
  youtube:   ['Vídeo', 'Short'],
};

const STAGES = [
  { id: 'curadoria',    lbl: '📚 Curadoria / Pauta', cor: '#64748b' },
  { id: 'gravacao',     lbl: '🎬 Gravação',          cor: '#0ea5e9' },
  { id: 'edicao',       lbl: '✂️ Edição',            cor: '#8b5cf6' },
  { id: 'aprovacao',    lbl: '👁 Aprovação',         cor: '#f59e0b' },
  { id: 'agendamento',  lbl: '📆 Agendar Post',      cor: '#ca8a04' },
  { id: 'publicado',    lbl: '🚀 Publicado',         cor: '#16a34a' },
];
const stageInfo = id => STAGES.find(s => s.id === id) || { lbl: id || '—', cor: '#64748b' };

const SEMANAS = [1, 2, 3, 4, 5];
const RESPONSAVEIS = ['Paulo', 'Guilherme', 'Isabella'];
const RESP_COR = { Paulo: '#0ea5e9', Guilherme: '#16a34a', Isabella: '#d6249f' };
const respCor = n => RESP_COR[n] || '#64748b';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';

// Cronograma da demanda: Início ▶ / Entrega 📦 / Post 📣 (v81.35)
const dateChips = c => {
  const mk = (ic, d, lbl, bg, fg) => d ? `<span class="pc-chip" title="${lbl}" style="background:${bg};color:${fg}">${ic} ${esc(fmtData(d))}</span>` : '';
  const chips = mk('▶', c.data_inicio, 'Início', 'rgba(16,185,129,.14)', '#047857')
    + mk('📦', c.data_entrega, 'Entrega', 'rgba(239,68,68,.14)', '#b91c1c')
    + mk('📣', c.data_post, 'Post', 'rgba(79,70,229,.14)', '#4f46e5');
  return chips ? `<div class="flex gap-1" style="flex-wrap:wrap;margin-top:5px">${chips}</div>` : '';
};

export function pagePauloConteudo(ctx, root) { return mount('conteudo', root); }
export function pageConteudoImoveis(ctx, root) { return mount('conteudo_imoveis', root); }
export function pageConteudoConquista(ctx, root) { return mount('conteudo_conquista', root); }

async function mount(board, root) {
  _root = root; _board = board; _plat = 'instagram'; _semana = '';
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando conteúdo…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=' + _board);
    if (r && r.pending) { root.innerHTML = `<div class="alert alert-err">Tabela ainda não criada. Rode <code>supabase/sprint_paulo_e_captstale.sql</code>.</div>`; return; }
    _cards = (r && r.cards) || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  render();
}

const STYLE = `
  <style>
    .pc-tab{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:999px;font-weight:700;font-size:13px;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:var(--bg-1,#fff);color:var(--ink,#334155);transition:.15s}
    .pc-tab.on{color:#fff}
    .pc-wk{display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-weight:700;font-size:12px;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:var(--bg-1,#fff);color:var(--ink,#475569)}
    .pc-wk.on{background:#4f46e5;border-color:#4f46e5;color:#fff}
    .pc-board{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x proximity}
    .pc-col{min-width:240px;max-width:270px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:8px;display:flex;flex-direction:column;scroll-snap-align:start;transition:background .15s,box-shadow .15s}
    .pc-col.drop{background:rgba(99,102,241,.12);box-shadow:inset 0 0 0 2px #6366f1}
    .pc-card{background:var(--bg-1,#fff);border-radius:10px;padding:10px 11px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.06);border:1px solid rgba(148,163,184,.16);transition:transform .12s,box-shadow .12s}
    .pc-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.12)}
    .pc-card.dragging{opacity:.45}
    .pc-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
    .pc-resp{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800}
    .pc-resp .dot{width:14px;height:14px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:8px}
    .pc-pl-week{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:12px 14px;margin-bottom:12px}
    .pc-pl-row{display:flex;align-items:center;gap:10px;padding:7px 4px;border-top:1px solid rgba(148,163,184,.12);cursor:pointer}
    .pc-pl-row:hover{background:rgba(99,102,241,.06)}
  </style>`;

function header() {
  return `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">${esc(BOARD_TITLE[_board] || 'Conteúdo')} · Conteúdo</div>
        <div class="tiny muted">Por plataforma e por semana · curadoria → gravação → edição → aprovação → agendamento → publicado.</div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-ghost" id="pc-import">📥 Importar planilha</button>
        <button class="btn btn-primary" id="pc-new">+ Novo conteúdo</button>
      </div>
    </div>`;
}

function tabsRow() {
  const counts = {};
  PLATAFORMAS.forEach(p => { counts[p.id] = _cards.filter(c => (c.plataforma || 'instagram') === p.id).length; });
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:12px">
      ${PLATAFORMAS.map(p => `<div class="pc-tab ${p.id === _plat ? 'on' : ''}" data-plat="${p.id}" style="${p.id === _plat ? `background:${p.cor};border-color:${p.cor}` : ''}">${p.ic} ${p.lbl} <span style="opacity:.7;font-weight:800">${counts[p.id] || 0}</span></div>`).join('')}
      <div class="pc-tab ${_plat === 'planner' ? 'on' : ''}" data-plat="planner" style="${_plat === 'planner' ? 'background:#4f46e5;border-color:#4f46e5' : ''}">📅 Planner Mensal</div>
    </div>`;
}

function render() {
  if (_plat === 'planner') return renderPlanner();
  const list = _cards.filter(c => (c.plataforma || 'instagram') === _plat && (_semana === '' || String(c.semana || '') === String(_semana)));
  const pub = list.filter(c => c.status === 'publicado').length;
  _root.innerHTML = `
    ${STYLE}
    ${header()}
    ${tabsRow()}
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <span class="tiny muted" style="font-weight:700;margin-right:2px">Semana:</span>
      <div class="pc-wk ${_semana === '' ? 'on' : ''}" data-wk="">Todas</div>
      ${SEMANAS.map(w => `<div class="pc-wk ${String(_semana) === String(w) ? 'on' : ''}" data-wk="${w}">Semana ${w}</div>`).join('')}
    </div>
    <div class="tiny muted" style="margin-bottom:8px">${list.length} itens · ${pub} publicados em ${platInfo(_plat).lbl}${_semana ? ' · Semana ' + _semana : ''}</div>
    <div class="pc-board">
      ${STAGES.map(col).join('')}
    </div>`;
  bind();
}

function col(st) {
  const cards = _cards.filter(c => (c.plataforma || 'instagram') === _plat
    && (c.status || 'curadoria') === st.id
    && (_semana === '' || String(c.semana || '') === String(_semana)));
  return `
    <div class="pc-col" data-col="${st.id}">
      <div class="flex items-center" style="justify-content:space-between;padding:2px 4px 8px">
        <span style="font-weight:800;font-size:12px;color:${st.cor}">${st.lbl}</span>
        <span class="tiny muted" style="font-weight:700">${cards.length}</span>
      </div>
      ${cards.map(card).join('') || '<div class="tiny muted" style="padding:8px;text-align:center;opacity:.6">—</div>'}
      <button class="btn btn-ghost tiny pc-add" data-st="${st.id}" style="margin-top:auto;border:1px dashed rgba(148,163,184,.4)">+ adicionar</button>
    </div>`;
}

function respBadge(n) {
  if (!n) return '';
  const ini = n.substring(0, 2).toUpperCase();
  return `<span class="pc-resp" title="Responsável: ${esc(n)}"><span class="dot" style="background:${respCor(n)}">${esc(ini[0])}</span>${esc(n)}</span>`;
}

function card(c) {
  return `
    <div class="pc-card" draggable="true" data-card="${esc(c.id)}">
      <div style="font-weight:800;font-size:13px;line-height:1.3">${esc(c.titulo || 'Sem título')}</div>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">
        ${c.semana ? `<span class="pc-chip" style="background:rgba(79,70,229,.14);color:#4f46e5">Sem ${esc(c.semana)}</span>` : ''}
        ${c.formato ? `<span class="pc-chip" style="background:rgba(99,102,241,.14);color:#4f46e5">${esc(c.formato)}</span>` : ''}
      </div>
      ${dateChips(c)}
      ${c.responsavel ? `<div style="margin-top:6px">${respBadge(c.responsavel)}</div>` : ''}
      ${c.obs ? `<div class="tiny muted" style="margin-top:6px;white-space:pre-wrap;max-height:48px;overflow:hidden">${esc(c.obs)}</div>` : ''}
      <div class="flex gap-2" style="margin-top:8px;align-items:center">
        ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener" data-stop="1" class="tiny" style="text-decoration:none">🔗 abrir</a>` : ''}
        <button class="btn btn-ghost tiny pc-edit" data-card="${esc(c.id)}" style="margin-left:auto">editar</button>
      </div>
    </div>`;
}

/* ── PLANNER MENSAL: todas as plataformas, agrupadas por semana ── */
function renderPlanner() {
  const groups = SEMANAS.map(w => ({ w, lbl: 'Semana ' + w, items: [] }));
  const semNada = { w: 0, lbl: 'Sem semana definida', items: [] };
  _cards.forEach(c => {
    const g = groups.find(x => String(x.w) === String(c.semana)) || semNada;
    g.items.push(c);
  });
  const all = groups.concat(semNada.items.length ? [semNada] : []);
  const sortFn = (a, b) => (a.data_ref || '9999').localeCompare(b.data_ref || '9999');
  const total = _cards.length, pub = _cards.filter(c => c.status === 'publicado').length;
  _root.innerHTML = `
    ${STYLE}
    ${header()}
    ${tabsRow()}
    <div class="tiny muted" style="margin-bottom:10px">Visão do mês inteiro: ${total} posts planejados · ${pub} publicados. Cada linha mostra título, plataforma, mídia e responsável.</div>
    ${all.map(g => `
      <div class="pc-pl-week">
        <div class="flex items-center" style="justify-content:space-between">
          <div style="font-weight:800;font-size:14px;color:#4f46e5">${g.lbl}</div>
          <span class="tiny muted" style="font-weight:700">${g.items.length} post${g.items.length === 1 ? '' : 's'}</span>
        </div>
        ${g.items.slice().sort(sortFn).map(c => {
          const pl = platInfo(c.plataforma || 'instagram');
          const stg = stageInfo(c.status || 'curadoria');
          return `<div class="pc-pl-row" data-card="${esc(c.id)}">
            <span title="${esc(pl.lbl)}" style="font-size:15px">${pl.ic}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.titulo || 'Sem título')}</div>
              <div class="tiny muted">${esc(pl.lbl)}${c.formato ? ' · ' + esc(c.formato) : ''}${c.data_ref ? ' · 📆 ' + esc(fmtData(c.data_ref)) : ''}</div>
            </div>
            ${c.responsavel ? respBadge(c.responsavel) : '<span class="tiny muted">sem resp.</span>'}
            <span class="pc-chip" style="background:${stg.cor}1f;color:${stg.cor};white-space:nowrap">${esc(stg.lbl)}</span>
          </div>`;
        }).join('') || '<div class="tiny muted" style="padding:8px 4px">Nenhum post nesta semana.</div>'}
      </div>`).join('')}`;
  bind();
}

function bind() {
  _root.querySelectorAll('.pc-tab').forEach(t => t.addEventListener('click', () => { _plat = t.dataset.plat; render(); }));
  _root.querySelectorAll('.pc-wk').forEach(w => w.addEventListener('click', () => { _semana = w.dataset.wk; render(); }));
  _root.querySelector('#pc-new')?.addEventListener('click', () => openEditor({ plataforma: _plat === 'planner' ? 'instagram' : _plat, semana: _semana || '' }));
  _root.querySelector('#pc-import')?.addEventListener('click', openImport);
  _root.querySelectorAll('.pc-add').forEach(b => b.addEventListener('click', () => openEditor({ plataforma: _plat, status: b.dataset.st, semana: _semana || '' })));
  _root.querySelectorAll('.pc-edit').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openEditor(_cards.find(c => c.id === b.dataset.card)); }));
  _root.querySelectorAll('.pc-pl-row').forEach(r => r.addEventListener('click', () => openEditor(_cards.find(c => c.id === r.dataset.card))));
  _root.querySelectorAll('.pc-card').forEach(el => {
    el.addEventListener('dragstart', () => { _dragId = el.dataset.card; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { _dragId = null; el.classList.remove('dragging'); _root.querySelectorAll('.pc-col').forEach(c => c.classList.remove('drop')); });
  });
  _root.querySelectorAll('.pc-col').forEach(colEl => {
    colEl.addEventListener('dragover', e => { e.preventDefault(); colEl.classList.add('drop'); });
    colEl.addEventListener('dragleave', () => colEl.classList.remove('drop'));
    colEl.addEventListener('drop', async e => {
      e.preventDefault(); colEl.classList.remove('drop');
      const st = colEl.dataset.col;
      if (!_dragId || !st) return;
      const c = _cards.find(x => x.id === _dragId);
      if (!c || c.status === st) return;
      const antes = c.status;
      c.status = st; render();
      try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'move', id: c.id, status: st } }); }
      catch (e) { c.status = antes; render(); alert('❌ NÃO SALVOU o movimento do card: ' + e.message + '\nEle voltou pra coluna original — tente de novo.'); }
    });
  });
}

function openEditor(seed) {
  const c = seed && seed.id ? seed : { plataforma: (seed && seed.plataforma) || 'instagram', status: (seed && seed.status) || 'curadoria', semana: (seed && seed.semana) || '' };
  const formatos = () => (FORMATOS[c.plataforma] || []).map(f => `<option value="${esc(f)}"${c.formato === f ? ' selected' : ''}>${esc(f)}</option>`).join('');
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:460px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? 'Editar conteúdo' : 'Novo conteúdo'}</div>
      <label class="tiny muted">Título / pauta</label>
      <input id="pc-f-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex: Tour casa alto padrão / Dica de investimento" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Plataforma</label>
          <select id="pc-f-plat" class="input">${PLATAFORMAS.map(p => `<option value="${p.id}"${c.plataforma === p.id ? ' selected' : ''}>${p.ic} ${esc(p.lbl)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Formato (mídia)</label>
          <select id="pc-f-formato" class="input">${formatos()}</select></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Etapa</label>
          <select id="pc-f-status" class="input">${STAGES.map(s => `<option value="${s.id}"${(c.status || 'curadoria') === s.id ? ' selected' : ''}>${esc(s.lbl)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Responsável</label>
          <select id="pc-f-resp" class="input"><option value="">—</option>${RESPONSAVEIS.map(n => `<option value="${esc(n)}"${c.responsavel === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Semana</label>
          <select id="pc-f-semana" class="input"><option value="">—</option>${SEMANAS.map(w => `<option value="${w}"${String(c.semana || '') === String(w) ? ' selected' : ''}>Semana ${w}</option>`).join('')}</select></div>
      </div>
      <label class="tiny muted">📅 Cronograma da demanda</label>
      <div class="flex gap-2" style="margin-bottom:10px;margin-top:3px">
        <div style="flex:1"><label class="tiny muted">▶ Início</label>
          <input id="pc-f-inicio" class="input" type="date" value="${c.data_inicio ? String(c.data_inicio).substring(0,10) : ''}"></div>
        <div style="flex:1"><label class="tiny muted">📦 Entrega</label>
          <input id="pc-f-entrega" class="input" type="date" value="${c.data_entrega ? String(c.data_entrega).substring(0,10) : ''}"></div>
        <div style="flex:1"><label class="tiny muted">📣 Post</label>
          <input id="pc-f-post" class="input" type="date" value="${c.data_post ? String(c.data_post).substring(0,10) : (c.data_ref ? String(c.data_ref).substring(0,10) : '')}"></div>
      </div>
      <label class="tiny muted">Link (roteiro / arquivo / post)</label>
      <input id="pc-f-link" class="input" value="${esc(c.link || '')}" placeholder="https://" style="margin-bottom:10px">
      <label class="tiny muted">Notas / roteiro</label>
      <textarea id="pc-f-obs" class="input" rows="3" placeholder="Gancho, CTA, referências…" style="margin-bottom:14px">${esc(c.obs || '')}</textarea>
      <div class="flex gap-2" style="justify-content:space-between">
        <button class="btn btn-ghost" id="pc-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="pc-cancel">Cancelar</button>
          <button class="btn btn-primary" id="pc-save">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#pc-f-plat').addEventListener('change', e => {
    c.plataforma = e.target.value;
    ov.querySelector('#pc-f-formato').innerHTML = (FORMATOS[c.plataforma] || []).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  });
  ov.querySelector('#pc-cancel').onclick = () => ov.remove();
  ov.querySelector('#pc-save').onclick = async () => {
    const body = {
      action: 'upsert', board: _board, id: c.id || undefined,
      titulo: ov.querySelector('#pc-f-titulo').value.trim(),
      plataforma: ov.querySelector('#pc-f-plat').value,
      formato: ov.querySelector('#pc-f-formato').value,
      status: ov.querySelector('#pc-f-status').value,
      responsavel: ov.querySelector('#pc-f-resp').value,
      semana: ov.querySelector('#pc-f-semana').value || null,
      data_inicio: ov.querySelector('#pc-f-inicio').value || null,
      data_entrega: ov.querySelector('#pc-f-entrega').value || null,
      data_post: ov.querySelector('#pc-f-post').value || null,
      data_ref: ov.querySelector('#pc-f-post').value || null,   // espelha o Post → mantém a Agenda/planner
      link: ov.querySelector('#pc-f-link').value.trim(),
      obs: ov.querySelector('#pc-f-obs').value.trim(),
    };
    if (!body.titulo) { ov.querySelector('#pc-f-titulo').focus(); return; }
    ov.querySelector('#pc-save').disabled = true;
    try {
      await api.request('/api/v3/paulo/cards', { method: 'POST', body });
      if (_plat !== 'planner') _plat = body.plataforma;
      ov.remove();
      await mount(_board, _root);
    } catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#pc-save').disabled = false; }
  };
  ov.querySelector('#pc-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este conteúdo?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await mount(_board, _root); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#pc-f-titulo')?.focus(), 50);
}

/* ── IMPORTAR PLANILHA (.xlsx) — lê no navegador (não sobe pro servidor) ── */
function loadSheetJS() {
  return new Promise((res, rej) => {
    if (window.XLSX) return res(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => res(window.XLSX);
    s.onerror = () => rej(new Error('não consegui carregar o leitor de planilha'));
    document.head.appendChild(s);
  });
}

function platOfSheet(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CARROSS')) return null;            // abas de detalhe de carrossel: ignora
  if (n.includes('INSTAGRAM') || n === 'IG') return 'instagram';
  if (n.includes('TIKTOK') || n.includes('TIK TOK')) return 'tiktok';
  if (n.includes('YOUTUBE') || n.includes('YT')) return 'youtube';
  return null;
}

function parseWorkbook(XLSX, wb, year) {
  const out = [];
  (wb.SheetNames || []).forEach(sn => {
    const plat = platOfSheet(sn);
    if (!plat) return;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
    // cabeçalho: ancora em DATA + (SEMANA/AULA). FORMATO é opcional (YouTube não tem).
    const hi = rows.findIndex(r => Array.isArray(r) && r.some(c => /SEMANA|AULA/i.test(c)) && r.some(c => /DATA/i.test(c)));
    if (hi < 0) return;
    const H = rows[hi].map(c => String(c || '').toUpperCase());
    const find = (...keys) => { for (const k of keys) { const i = H.findIndex(h => h.includes(k)); if (i >= 0) return i; } return -1; };
    const ci = {
      semana: find('SEMANA'), data: find('DATA'), formato: find('FORMATO'),
      titulo: find('TÍTULO', 'TITULO', 'TEMA') >= 0 ? find('TÍTULO', 'TITULO', 'TEMA')
        : (find('GANCHO') >= 0 ? find('GANCHO') : find('SÉRIE', 'SERIE', 'EDITORIA')),
      copy: find('COPY', 'ROTEIRO', 'FALA'), cta: find('CTA'), edit: find('EDITORIA', 'SÉRIE', 'SERIE', 'FUNIL'),
    };
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const g = idx => (idx >= 0 && r[idx] != null) ? String(r[idx]).trim() : '';
      let formato = g(ci.formato); const data = g(ci.data), titulo = g(ci.titulo);
      if (!data && !titulo) continue;                   // pula separadores / linhas vazias
      if (!formato && plat === 'youtube') formato = 'Vídeo';   // YouTube não tem coluna de formato
      let semana = null; const sm = g(ci.semana).match(/(\d+)/); if (sm) semana = parseInt(sm[1], 10);
      let data_ref = null; const dm = data.match(/(\d{1,2})[\/\-.](\d{1,2})/); if (dm) data_ref = `${year}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      if (!semana && dm) semana = Math.min(5, Math.max(1, Math.ceil(parseInt(dm[1], 10) / 7)));  // sem nº na coluna → deriva da data
      const obs = [g(ci.edit), g(ci.copy), g(ci.cta)].filter(Boolean).join('\n');
      out.push({ plataforma: plat, titulo: titulo || '(sem título)', formato, semana, data_ref, obs, status: 'curadoria' });
    }
  });
  return out;
}

function openImport() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:560px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:17px;font-weight:800;margin-bottom:4px">📥 Importar planilha de conteúdo</div>
      <div class="tiny muted" style="margin-bottom:14px">Anexe o .xlsx da linha editorial (abas Instagram/TikTok/YouTube). Cada linha vira um card em <b>Curadoria</b>, com plataforma, semana, formato e data. Itens iguais (mesma plataforma + título + data) não duplicam.</div>
      <div class="flex gap-2" style="align-items:flex-end;margin-bottom:12px">
        <div style="flex:1"><label class="tiny muted">Arquivo (.xlsx)</label>
          <input id="pc-imp-file" type="file" accept=".xlsx,.xls" class="input"></div>
        <div style="width:110px"><label class="tiny muted">Ano</label>
          <input id="pc-imp-ano" class="input" type="number" value="2026"></div>
      </div>
      <div id="pc-imp-preview" class="tiny muted">Selecione o arquivo para pré-visualizar.</div>
      <div class="flex gap-2 mt-3" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="pc-imp-cancel">Cancelar</button>
        <button class="btn btn-primary" id="pc-imp-go" disabled>Importar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#pc-imp-cancel').onclick = () => ov.remove();

  let parsed = [];
  const prev = ov.querySelector('#pc-imp-preview');
  const goBtn = ov.querySelector('#pc-imp-go');

  const reparse = async () => {
    const file = ov.querySelector('#pc-imp-file').files[0];
    if (!file) return;
    const year = parseInt(ov.querySelector('#pc-imp-ano').value, 10) || 2026;
    prev.innerHTML = '<span class="spinner"></span> Lendo planilha…';
    goBtn.disabled = true;
    try {
      const XLSX = await loadSheetJS();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      let items = parseWorkbook(XLSX, wb, year);
      // dedupe contra o que já existe (plataforma+titulo+data)
      const key = c => `${c.plataforma}|${(c.titulo || '').toLowerCase().trim()}|${c.data_ref || ''}`;
      const seen = new Set(_cards.map(key));
      const novos = items.filter(c => !seen.has(key(c)));
      const dups = items.length - novos.length;
      parsed = novos;
      const byPlat = {};
      novos.forEach(c => { byPlat[c.plataforma] = (byPlat[c.plataforma] || 0) + 1; });
      const resumo = PLATAFORMAS.filter(p => byPlat[p.id]).map(p => `${p.ic} ${byPlat[p.id]}`).join(' · ') || '—';
      prev.innerHTML = `Encontrei <b>${items.length}</b> linhas · <b style="color:#16a34a">${novos.length} novos</b> a importar (${resumo})${dups ? ` · ${dups} já existem (ignorados)` : ''}.
        ${novos.slice(0, 6).map(c => `<div style="margin-top:4px">• <b>${esc(c.titulo)}</b> <span class="muted">— ${esc(platInfo(c.plataforma).lbl)} · ${esc(c.formato || '')}${c.semana ? ' · Sem ' + c.semana : ''}${c.data_ref ? ' · ' + fmtData(c.data_ref) : ''}</span></div>`).join('')}
        ${novos.length > 6 ? `<div class="muted" style="margin-top:4px">… e mais ${novos.length - 6}</div>` : ''}`;
      goBtn.disabled = novos.length === 0;
      goBtn.textContent = `Importar ${novos.length}`;
    } catch (e) {
      prev.innerHTML = `<span style="color:#dc2626">Erro ao ler: ${esc(e.message)}</span>`;
    }
  };
  ov.querySelector('#pc-imp-file').addEventListener('change', reparse);
  ov.querySelector('#pc-imp-ano').addEventListener('change', reparse);

  goBtn.onclick = async () => {
    if (!parsed.length) return;
    goBtn.disabled = true; prev.innerHTML = '<span class="spinner"></span> Importando…';
    try {
      const r = await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'bulk', board: _board, cards: parsed } });
      ov.remove();
      await mount(_board, _root);
      alert(`✅ ${(r && r.inserted) || parsed.length} conteúdos importados pra Curadoria.`);
    } catch (e) {
      prev.innerHTML = `<span style="color:#dc2626">Erro ao importar: ${esc(e.message)}</span>`;
      goBtn.disabled = false;
    }
  };
}
