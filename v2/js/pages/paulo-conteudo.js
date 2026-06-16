/* PSM-OS v2 — "Paulo Morimatsu" (Marketing): pipeline de CONTEÚDO da marca pessoal,
   separado POR PLATAFORMA (IG / TikTok / YouTube) + etapas de produção.
   Board compartilhado (Paulo + marketing). board=conteudo. v77.48 */
import { api } from '../api.js';

let _root = null;
let _cards = [];
let _plat = 'instagram';   // aba ativa
let _dragId = null;

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

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';

export async function pagePauloConteudo(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando conteúdo…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=conteudo');
    if (r && r.pending) { root.innerHTML = `<div class="alert alert-err">Tabela ainda não criada. Rode <code>supabase/sprint_paulo_e_captstale.sql</code>.</div>`; return; }
    _cards = (r && r.cards) || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  render();
}

function render() {
  const counts = {};
  PLATAFORMAS.forEach(p => { counts[p.id] = _cards.filter(c => (c.plataforma || 'instagram') === p.id).length; });
  const list = _cards.filter(c => (c.plataforma || 'instagram') === _plat);
  const pub = list.filter(c => c.status === 'publicado').length;
  _root.innerHTML = `
    <style>
      .pc-tab{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:999px;font-weight:700;font-size:13px;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:var(--bg-1,#fff);color:var(--ink,#334155);transition:.15s}
      .pc-tab.on{color:#fff}
      .pc-board{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x proximity}
      .pc-col{min-width:240px;max-width:270px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:8px;display:flex;flex-direction:column;scroll-snap-align:start;transition:background .15s,box-shadow .15s}
      .pc-col.drop{background:rgba(99,102,241,.12);box-shadow:inset 0 0 0 2px #6366f1}
      .pc-card{background:var(--bg-1,#fff);border-radius:10px;padding:10px 11px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.06);border:1px solid rgba(148,163,184,.16);transition:transform .12s,box-shadow .12s}
      .pc-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.12)}
      .pc-card.dragging{opacity:.45}
      .pc-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
    </style>
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">Paulo Morimatsu · Conteúdo</div>
        <div class="tiny muted">Curadoria → gravação → edição → aprovação → agendamento, por plataforma.</div>
      </div>
      <button class="btn btn-primary" id="pc-new">+ Novo conteúdo</button>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      ${PLATAFORMAS.map(p => `<div class="pc-tab ${p.id === _plat ? 'on' : ''}" data-plat="${p.id}" style="${p.id === _plat ? `background:${p.cor};border-color:${p.cor}` : ''}">${p.ic} ${p.lbl} <span style="opacity:.7;font-weight:800">${counts[p.id] || 0}</span></div>`).join('')}
    </div>
    <div class="tiny muted" style="margin-bottom:8px">${list.length} itens · ${pub} publicados em ${platInfo(_plat).lbl}</div>
    <div class="pc-board">
      ${STAGES.map(col).join('')}
    </div>`;
  bind();
}

function col(st) {
  const cards = _cards.filter(c => (c.plataforma || 'instagram') === _plat && (c.status || 'curadoria') === st.id);
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

function card(c) {
  return `
    <div class="pc-card" draggable="true" data-card="${esc(c.id)}">
      <div style="font-weight:800;font-size:13px;line-height:1.3">${esc(c.titulo || 'Sem título')}</div>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">
        ${c.formato ? `<span class="pc-chip" style="background:rgba(99,102,241,.14);color:#4f46e5">${esc(c.formato)}</span>` : ''}
        ${c.data_ref ? `<span class="pc-chip" style="background:rgba(202,138,4,.16);color:#a16207">📆 ${esc(fmtData(c.data_ref))}</span>` : ''}
      </div>
      ${c.obs ? `<div class="tiny muted" style="margin-top:6px;white-space:pre-wrap;max-height:48px;overflow:hidden">${esc(c.obs)}</div>` : ''}
      <div class="flex gap-2" style="margin-top:8px;align-items:center">
        ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener" data-stop="1" class="tiny" style="text-decoration:none">🔗 abrir</a>` : ''}
        <button class="btn btn-ghost tiny pc-edit" data-card="${esc(c.id)}" style="margin-left:auto">editar</button>
      </div>
    </div>`;
}

function bind() {
  _root.querySelectorAll('.pc-tab').forEach(t => t.addEventListener('click', () => { _plat = t.dataset.plat; render(); }));
  _root.querySelector('#pc-new')?.addEventListener('click', () => openEditor({ plataforma: _plat }));
  _root.querySelectorAll('.pc-add').forEach(b => b.addEventListener('click', () => openEditor({ plataforma: _plat, status: b.dataset.st })));
  _root.querySelectorAll('.pc-edit').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openEditor(_cards.find(c => c.id === b.dataset.card)); }));
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
      c.status = st; render();
      try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'move', id: c.id, status: st } }); }
      catch (_) {}
    });
  });
}

function openEditor(seed) {
  const c = seed && seed.id ? seed : { plataforma: (seed && seed.plataforma) || _plat, status: (seed && seed.status) || 'curadoria' };
  const formatos = () => (FORMATOS[c.plataforma] || []).map(f => `<option value="${esc(f)}"${c.formato === f ? ' selected' : ''}>${esc(f)}</option>`).join('');
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:460px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? 'Editar conteúdo' : 'Novo conteúdo'}</div>
      <label class="tiny muted">Título / pauta</label>
      <input id="pc-f-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex: Tour casa alto padrão / Dica de investimento" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Plataforma</label>
          <select id="pc-f-plat" class="input">${PLATAFORMAS.map(p => `<option value="${p.id}"${c.plataforma === p.id ? ' selected' : ''}>${p.ic} ${esc(p.lbl)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Formato</label>
          <select id="pc-f-formato" class="input">${formatos()}</select></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Etapa</label>
          <select id="pc-f-status" class="input">${STAGES.map(s => `<option value="${s.id}"${(c.status || 'curadoria') === s.id ? ' selected' : ''}>${esc(s.lbl)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Data do post</label>
          <input id="pc-f-data" class="input" type="date" value="${c.data_ref ? String(c.data_ref).substring(0,10) : ''}"></div>
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
  // formato segue a plataforma escolhida
  ov.querySelector('#pc-f-plat').addEventListener('change', e => {
    c.plataforma = e.target.value;
    ov.querySelector('#pc-f-formato').innerHTML = (FORMATOS[c.plataforma] || []).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  });
  ov.querySelector('#pc-cancel').onclick = () => ov.remove();
  ov.querySelector('#pc-save').onclick = async () => {
    const body = {
      action: 'upsert', board: 'conteudo', id: c.id || undefined,
      titulo: ov.querySelector('#pc-f-titulo').value.trim(),
      plataforma: ov.querySelector('#pc-f-plat').value,
      formato: ov.querySelector('#pc-f-formato').value,
      status: ov.querySelector('#pc-f-status').value,
      data_ref: ov.querySelector('#pc-f-data').value || null,
      link: ov.querySelector('#pc-f-link').value.trim(),
      obs: ov.querySelector('#pc-f-obs').value.trim(),
    };
    if (!body.titulo) { ov.querySelector('#pc-f-titulo').focus(); return; }
    ov.querySelector('#pc-save').disabled = true;
    try {
      await api.request('/api/v3/paulo/cards', { method: 'POST', body });
      _plat = body.plataforma;
      ov.remove();
      await pagePauloConteudo(null, _root);
    } catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#pc-save').disabled = false; }
  };
  ov.querySelector('#pc-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este conteúdo?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await pagePauloConteudo(null, _root); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#pc-f-titulo')?.focus(), 50);
}
