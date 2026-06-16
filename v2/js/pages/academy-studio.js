/* PSM-OS v2 — Academy · Produção (centro de construção da PSM Academy).
   Controla a CONSTRUÇÃO dos cursos: linha de curso × etapa de produção,
   com tema, roteiro, responsável e data de gravação. board=academy. v77.58 */
import { api } from '../api.js';

let _root = null;
let _cards = [];
let _view = 'kanban';   // kanban | agenda
let _fLinha = '';       // filtro linha de curso
let _fResp = '';        // filtro responsável
let _dragId = null;

// Linhas de curso (trilhas da Academy) — sugestões; aceita customizar
const LINHAS = [
  'Mercado Imobiliário Básico', 'Vendas', 'Marketing', 'Noção Contábil', 'Noção de Direito',
  'PNL', 'Lançamentos MCMV', 'Lançamentos M.A.P', 'Terceiros', 'Locação', 'Urbanismo',
];
const TIPOS = ['Vídeo-aula', 'Material / PDF', 'Quiz', 'Live', 'Exercício'];
const RESP_SUGEST = ['Paulo', 'Guilherme', 'Isabella'];

const STAGES = [
  { id: 'ideia',     lbl: '💡 Ideia / Tema', cor: '#64748b' },
  { id: 'roteiro',   lbl: '📝 Roteiro',      cor: '#0ea5e9' },
  { id: 'gravacao',  lbl: '🎬 Gravação',     cor: '#f59e0b' },
  { id: 'edicao',    lbl: '✂️ Edição',       cor: '#8b5cf6' },
  { id: 'revisao',   lbl: '👁 Revisão',      cor: '#d97706' },
  { id: 'publicada', lbl: '✅ Publicada',    cor: '#16a34a' },
];
const stageInfo = id => STAGES.find(s => s.id === id) || { lbl: id || '—', cor: '#64748b' };

const COR = ['#0ea5e9', '#16a34a', '#d6249f', '#8b5cf6', '#f59e0b', '#ef4444', '#0891b2', '#ca8a04', '#64748b', '#7c3aed', '#db2777'];
const linhaCor = l => COR[(LINHAS.indexOf(l) + 11) % COR.length] || '#64748b';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';
const hoje = () => new Date().toISOString().substring(0, 10);

export async function pageAcademyStudio(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando estúdio…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=academy');
    if (r && r.pending) { root.innerHTML = `<div class="alert alert-err">Tabela ainda não criada. Rode <code>supabase/sprint_paulo_e_captstale.sql</code>.</div>`; return; }
    _cards = (r && r.cards) || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  render();
}

function linhasDisponiveis() {
  const set = new Set(LINHAS);
  _cards.forEach(c => { if (c.plataforma) set.add(c.plataforma); });
  return [...set];
}
function respsDisponiveis() {
  const set = new Set(RESP_SUGEST);
  _cards.forEach(c => { if (c.responsavel) set.add(c.responsavel); });
  return [...set];
}
function filtered() {
  return _cards.filter(c =>
    (_fLinha === '' || (c.plataforma || '') === _fLinha) &&
    (_fResp === '' || (c.responsavel || '') === _fResp));
}

const STYLE = `
  <style>
    .as-tab{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:999px;font-weight:700;font-size:13px;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:var(--bg-1,#fff);color:var(--ink,#334155)}
    .as-tab.on{background:#7c3aed;border-color:#7c3aed;color:#fff}
    .as-board{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 14px}
    .as-col{min-width:248px;max-width:280px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:8px;display:flex;flex-direction:column}
    .as-col.drop{background:rgba(124,58,237,.12);box-shadow:inset 0 0 0 2px #7c3aed}
    .as-card{background:var(--bg-1,#fff);border-radius:10px;padding:10px 11px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.06);border:1px solid rgba(148,163,184,.16);transition:transform .12s,box-shadow .12s}
    .as-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.12)}
    .as-card.dragging{opacity:.45}
    .as-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
    .as-kpi{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:10px 14px;flex:1;min-width:120px}
    .as-day{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:12px 14px;margin-bottom:12px}
    .as-row{display:flex;align-items:center;gap:10px;padding:7px 4px;border-top:1px solid rgba(148,163,184,.12);cursor:pointer}
    .as-row:hover{background:rgba(124,58,237,.06)}
  </style>`;

function header() {
  return `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">🎬 Academy · Produção</div>
        <div class="tiny muted">Centro de construção da PSM Academy — linha de curso, tema, roteiro, gravação, responsável.</div>
      </div>
      <button class="btn btn-primary" id="as-new">+ Nova aula</button>
    </div>`;
}

function filtros() {
  const linhas = linhasDisponiveis(), resps = respsDisponiveis();
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div class="as-tab ${_view === 'kanban' ? 'on' : ''}" data-view="kanban">🗂 Produção</div>
      <div class="as-tab ${_view === 'agenda' ? 'on' : ''}" data-view="agenda">📅 Agenda de Gravações</div>
      <div style="flex:1"></div>
      <div><label class="tiny muted">Linha de curso</label>
        <select id="as-flinha" class="select"><option value="">Todas as linhas</option>${linhas.map(l => `<option value="${esc(l)}"${_fLinha === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div><label class="tiny muted">Responsável</label>
        <select id="as-fresp" class="select"><option value="">Todos</option>${resps.map(r => `<option value="${esc(r)}"${_fResp === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    </div>`;
}

function kpis() {
  const f = filtered();
  const porEtapa = id => f.filter(c => (c.status || 'ideia') === id).length;
  const agendadas = f.filter(c => c.data_ref && c.status !== 'publicada' && c.data_ref >= hoje()).length;
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="as-kpi"><div class="tiny muted">Aulas no funil</div><div style="font-size:18px;font-weight:800">${f.length}</div></div>
      <div class="as-kpi"><div class="tiny muted">📝 Em roteiro</div><div style="font-size:18px;font-weight:800;color:#0ea5e9">${porEtapa('roteiro')}</div></div>
      <div class="as-kpi"><div class="tiny muted">🎬 Gravações agendadas</div><div style="font-size:18px;font-weight:800;color:#f59e0b">${agendadas}</div></div>
      <div class="as-kpi"><div class="tiny muted">✅ Publicadas</div><div style="font-size:18px;font-weight:800;color:#16a34a">${porEtapa('publicada')}</div></div>
    </div>`;
}

function render() {
  _root.innerHTML = `${STYLE}${header()}${filtros()}${kpis()}${_view === 'agenda' ? renderAgenda() : `<div class="as-board">${STAGES.map(col).join('')}</div>`}`;
  bind();
}

function col(st) {
  const cards = filtered().filter(c => (c.status || 'ideia') === st.id);
  return `
    <div class="as-col" data-col="${st.id}">
      <div class="flex items-center" style="justify-content:space-between;padding:2px 4px 8px">
        <span style="font-weight:800;font-size:12px;color:${st.cor}">${st.lbl}</span>
        <span class="tiny muted" style="font-weight:700">${cards.length}</span>
      </div>
      ${cards.map(card).join('') || '<div class="tiny muted" style="padding:8px;text-align:center;opacity:.6">—</div>'}
      <button class="btn btn-ghost tiny as-add" data-st="${st.id}" style="margin-top:auto;border:1px dashed rgba(148,163,184,.4)">+ adicionar</button>
    </div>`;
}

function card(c) {
  const ini = (c.responsavel || '').substring(0, 1).toUpperCase();
  return `
    <div class="as-card" draggable="true" data-card="${esc(c.id)}">
      <div style="font-weight:800;font-size:13px;line-height:1.3">${esc(c.titulo || 'Sem tema')}</div>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">
        ${c.plataforma ? `<span class="as-chip" style="background:${linhaCor(c.plataforma)}1f;color:${linhaCor(c.plataforma)}">${esc(c.plataforma)}</span>` : ''}
        ${c.formato ? `<span class="as-chip" style="background:rgba(124,58,237,.12);color:#7c3aed">${esc(c.formato)}</span>` : ''}
        ${c.data_ref ? `<span class="as-chip" style="background:rgba(245,158,11,.16);color:#b45309">🎬 ${esc(fmtData(c.data_ref))}</span>` : ''}
      </div>
      <div class="flex gap-2" style="margin-top:8px;align-items:center">
        ${c.responsavel ? `<span class="tiny" style="font-weight:700">👤 ${esc(c.responsavel)}</span>` : ''}
        ${c.obs ? '<span class="tiny" title="Tem roteiro" style="color:#16a34a">📝</span>' : ''}
        ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener" data-stop="1" class="tiny" style="text-decoration:none">🔗</a>` : ''}
        <button class="btn btn-ghost tiny as-edit" data-card="${esc(c.id)}" style="margin-left:auto">editar</button>
      </div>
    </div>`;
}

/* ── AGENDA DE GRAVAÇÕES: agrupa por data de gravação ── */
function renderAgenda() {
  const f = filtered().filter(c => c.data_ref).sort((a, b) => (a.data_ref).localeCompare(b.data_ref));
  const semData = filtered().filter(c => !c.data_ref);
  const groups = {};
  f.forEach(c => { (groups[c.data_ref] = groups[c.data_ref] || []).push(c); });
  const datas = Object.keys(groups).sort();
  if (!datas.length && !semData.length) return '<div class="muted tiny">Nenhuma aula ainda. Crie a primeira em "+ Nova aula".</div>';
  const row = c => `<div class="as-row" data-card="${esc(c.id)}">
      <span style="font-size:15px">${stageInfo(c.status).lbl.split(' ')[0]}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.titulo || 'Sem tema')}</div>
        <div class="tiny muted">${esc(c.plataforma || '—')}${c.formato ? ' · ' + esc(c.formato) : ''}${c.responsavel ? ' · 👤 ' + esc(c.responsavel) : ''}</div>
      </div>
      <span class="as-chip" style="background:${stageInfo(c.status).cor}1f;color:${stageInfo(c.status).cor};white-space:nowrap">${stageInfo(c.status).lbl}</span>
    </div>`;
  return `
    ${datas.map(d => {
      const isHoje = d === hoje(), isPast = d < hoje();
      return `<div class="as-day">
        <div class="flex items-center" style="justify-content:space-between">
          <div style="font-weight:800;font-size:14px;color:${isHoje ? '#16a34a' : isPast ? '#94a3b8' : '#b45309'}">🎬 ${fmtData(d)}${isHoje ? ' · HOJE' : isPast ? ' · (passou)' : ''}</div>
          <span class="tiny muted" style="font-weight:700">${groups[d].length} gravação${groups[d].length === 1 ? '' : 'ões'}</span>
        </div>
        ${groups[d].map(row).join('')}
      </div>`;
    }).join('')}
    ${semData.length ? `<div class="as-day"><div style="font-weight:800;font-size:14px;color:#64748b">📌 Sem data de gravação (${semData.length})</div>${semData.map(row).join('')}</div>` : ''}`;
}

function bind() {
  _root.querySelectorAll('.as-tab').forEach(t => t.addEventListener('click', () => { _view = t.dataset.view; render(); }));
  const fl = _root.querySelector('#as-flinha'); if (fl) fl.onchange = () => { _fLinha = fl.value; render(); };
  const fr = _root.querySelector('#as-fresp'); if (fr) fr.onchange = () => { _fResp = fr.value; render(); };
  _root.querySelector('#as-new')?.addEventListener('click', () => openEditor({ plataforma: _fLinha || '' }));
  _root.querySelectorAll('.as-add').forEach(b => b.addEventListener('click', () => openEditor({ status: b.dataset.st, plataforma: _fLinha || '' })));
  _root.querySelectorAll('.as-edit').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openEditor(_cards.find(c => c.id === b.dataset.card)); }));
  _root.querySelectorAll('.as-row').forEach(r => r.addEventListener('click', () => openEditor(_cards.find(c => c.id === r.dataset.card))));
  _root.querySelectorAll('.as-card').forEach(el => {
    el.addEventListener('dragstart', () => { _dragId = el.dataset.card; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { _dragId = null; el.classList.remove('dragging'); _root.querySelectorAll('.as-col').forEach(c => c.classList.remove('drop')); });
  });
  _root.querySelectorAll('.as-col').forEach(colEl => {
    colEl.addEventListener('dragover', e => { e.preventDefault(); colEl.classList.add('drop'); });
    colEl.addEventListener('dragleave', () => colEl.classList.remove('drop'));
    colEl.addEventListener('drop', async e => {
      e.preventDefault(); colEl.classList.remove('drop');
      const st = colEl.dataset.col;
      if (!_dragId || !st) return;
      const c = _cards.find(x => x.id === _dragId);
      if (!c || c.status === st) return;
      c.status = st; render();
      try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'move', id: c.id, status: st } }); } catch (_) {}
    });
  });
}

function openEditor(seed) {
  const c = seed && seed.id ? seed : { status: (seed && seed.status) || 'ideia', plataforma: (seed && seed.plataforma) || '' };
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:560px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? 'Editar aula' : 'Nova aula'}</div>
      <label class="tiny muted">Tema / título da aula</label>
      <input id="as-f-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex: Como tirar o CRECI / Funil de vendas na prática" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Linha de curso</label>
          <input id="as-f-linha" class="input" list="as-linhas" value="${esc(c.plataforma || '')}" placeholder="Trilha do curso">
          <datalist id="as-linhas">${LINHAS.map(l => `<option value="${esc(l)}">`).join('')}</datalist></div>
        <div style="flex:1"><label class="tiny muted">Tipo</label>
          <select id="as-f-tipo" class="select"><option value="">—</option>${TIPOS.map(t => `<option value="${esc(t)}"${c.formato === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Etapa de produção</label>
          <select id="as-f-status" class="select">${STAGES.map(s => `<option value="${s.id}"${(c.status || 'ideia') === s.id ? ' selected' : ''}>${esc(s.lbl)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Responsável</label>
          <input id="as-f-resp" class="input" list="as-resps" value="${esc(c.responsavel || '')}" placeholder="Quem produz">
          <datalist id="as-resps">${respsDisponiveis().map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">📅 Data de gravação</label>
          <input id="as-f-data" class="input" type="date" value="${c.data_ref ? String(c.data_ref).substring(0,10) : ''}"></div>
        <div style="flex:1"><label class="tiny muted">Link (material / vídeo / drive)</label>
          <input id="as-f-link" class="input" value="${esc(c.link || '')}" placeholder="https://"></div>
      </div>
      <label class="tiny muted">📝 Roteiro</label>
      <textarea id="as-f-obs" class="input" rows="6" placeholder="Roteiro da aula: gancho, tópicos, exemplos, CTA…">${esc(c.obs || '')}</textarea>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        <button class="btn btn-ghost" id="as-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="as-cancel">Cancelar</button>
          <button class="btn btn-primary" id="as-save">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#as-cancel').onclick = () => ov.remove();
  ov.querySelector('#as-save').onclick = async () => {
    const g = id => ov.querySelector('#as-f-' + id).value;
    const body = {
      action: 'upsert', board: 'academy', id: c.id || undefined,
      titulo: g('titulo').trim(),
      plataforma: g('linha').trim(),     // linha de curso
      formato: g('tipo'),                // tipo de conteúdo
      status: g('status'),
      responsavel: g('resp').trim(),
      data_ref: g('data') || null,       // data de gravação
      link: g('link').trim(),
      obs: g('obs').trim(),              // roteiro
    };
    if (!body.titulo) { ov.querySelector('#as-f-titulo').focus(); return; }
    ov.querySelector('#as-save').disabled = true;
    try {
      await api.request('/api/v3/paulo/cards', { method: 'POST', body });
      if (body.plataforma) _fLinha = _fLinha;  // mantém filtro
      ov.remove();
      await pageAcademyStudio(null, _root);
    } catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#as-save').disabled = false; }
  };
  ov.querySelector('#as-del').onclick = async () => {
    if (!c.id || !confirm('Excluir esta aula?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await pageAcademyStudio(null, _root); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#as-f-titulo')?.focus(), 50);
}
