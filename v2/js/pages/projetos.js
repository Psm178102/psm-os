/* PSM-OS v2 — Diretoria · Projetos. Centro de controle dos PROJETOS da empresa
   (kanban por etapa, área, prioridade, responsável, prazo, escopo, checklist,
   métricas, IA de plano). board=projetos — independente da Academy. v77.60 */
import { api } from '../api.js';

let _root = null;
let _cards = [];
let _view = 'kanban';   // kanban | prazos | metricas
let _fArea = '';
let _fResp = '';
let _dragId = null;
const _board = 'projetos';

const AREAS = ['Comercial', 'Marketing', 'Produto / Sistema', 'Pessoas / RH', 'Financeiro', 'Expansão', 'Operações'];
const PRIOR = ['Alta', 'Média', 'Baixa'];
const PRIOR_COR = { 'Alta': '#ef4444', 'Média': '#f59e0b', 'Baixa': '#64748b' };
const RESP_SUGEST = ['Paulo', 'Guilherme', 'Isabella'];

const STAGES = [
  { id: 'ideia',        lbl: '💡 Ideia',        cor: '#64748b' },
  { id: 'planejamento', lbl: '📋 Planejamento', cor: '#0ea5e9' },
  { id: 'andamento',    lbl: '🚧 Em andamento', cor: '#f59e0b' },
  { id: 'revisao',      lbl: '👁 Em revisão',   cor: '#8b5cf6' },
  { id: 'concluido',    lbl: '✅ Concluído',    cor: '#16a34a' },
  { id: 'pausado',      lbl: '⏸ Pausado',       cor: '#94a3b8' },
];
const stageInfo = id => STAGES.find(s => s.id === id) || { lbl: id || '—', cor: '#64748b' };

const CHECK = [
  { k: 'escopo',     l: '🎯 Escopo definido' },
  { k: 'recursos',   l: '💰 Recursos / orçamento' },
  { k: 'resp',       l: '👤 Responsáveis definidos' },
  { k: 'cronograma', l: '📅 Cronograma' },
  { k: 'execucao',   l: '🚧 Em execução' },
  { k: 'entregue',   l: '📦 Entregue' },
  { k: 'validado',   l: '✅ Validado' },
];
const checkDone = c => CHECK.filter(x => (c.checklist || {})[x.k]).length;

const COR = ['#0ea5e9', '#16a34a', '#d6249f', '#8b5cf6', '#f59e0b', '#ef4444', '#0891b2'];
const areaCor = a => COR[(AREAS.indexOf(a) + 7) % COR.length] || '#64748b';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';
const hoje = () => new Date().toISOString().substring(0, 10);

export async function pageProjetos(ctx, root) {
  _root = root; _view = 'kanban'; _fArea = ''; _fResp = '';
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando projetos…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=' + _board);
    if (r && r.pending) { root.innerHTML = `<div class="alert alert-err">Tabela ainda não criada. Rode <code>supabase/sprint_paulo_e_captstale.sql</code>.</div>`; return; }
    _cards = (r && r.cards) || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  render();
}

function areasDisp() { const s = new Set(AREAS); _cards.forEach(c => { if (c.plataforma) s.add(c.plataforma); }); return [...s]; }
function respsDisp() { const s = new Set(RESP_SUGEST); _cards.forEach(c => { if (c.responsavel) s.add(c.responsavel); }); return [...s]; }
function filtered() {
  return _cards.filter(c => (_fArea === '' || (c.plataforma || '') === _fArea) && (_fResp === '' || (c.responsavel || '') === _fResp));
}

const STYLE = `
  <style>
    .pj-tab{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:999px;font-weight:700;font-size:13px;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:var(--bg-1,#fff);color:var(--ink,#334155)}
    .pj-tab.on{background:#0891b2;border-color:#0891b2;color:#fff}
    .pj-board{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 14px}
    .pj-col{min-width:248px;max-width:280px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:8px;display:flex;flex-direction:column}
    .pj-col.drop{background:rgba(8,145,178,.12);box-shadow:inset 0 0 0 2px #0891b2}
    .pj-card{background:var(--bg-1,#fff);border-radius:10px;padding:10px 11px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.06);border:1px solid rgba(148,163,184,.16);transition:transform .12s,box-shadow .12s}
    .pj-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.12)}
    .pj-card.dragging{opacity:.45}
    .pj-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
    .pj-kpi{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:10px 14px;flex:1;min-width:120px}
    .pj-day{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:12px 14px;margin-bottom:12px}
    .pj-row{display:flex;align-items:center;gap:10px;padding:7px 4px;border-top:1px solid rgba(148,163,184,.12);cursor:pointer}
    .pj-row:hover{background:rgba(8,145,178,.06)}
  </style>`;

function header() {
  return `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">📌 Projetos da Diretoria</div>
        <div class="tiny muted">Controle dos projetos da empresa — área, prioridade, responsável, prazo, escopo e entregas.</div>
      </div>
      <button class="btn btn-primary" id="pj-new">+ Novo projeto</button>
    </div>`;
}

function filtros() {
  const areas = areasDisp(), resps = respsDisp();
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div class="pj-tab ${_view === 'kanban' ? 'on' : ''}" data-view="kanban">🗂 Quadro</div>
      <div class="pj-tab ${_view === 'prazos' ? 'on' : ''}" data-view="prazos">📅 Prazos</div>
      <div class="pj-tab ${_view === 'metricas' ? 'on' : ''}" data-view="metricas">📊 Métricas</div>
      <div style="flex:1"></div>
      <div><label class="tiny muted">Área</label>
        <select id="pj-farea" class="select"><option value="">Todas as áreas</option>${areas.map(a => `<option value="${esc(a)}"${_fArea === a ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
      <div><label class="tiny muted">Responsável</label>
        <select id="pj-fresp" class="select"><option value="">Todos</option>${resps.map(r => `<option value="${esc(r)}"${_fResp === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    </div>`;
}

function kpis() {
  const f = filtered();
  const por = id => f.filter(c => (c.status || 'ideia') === id).length;
  const atrasados = f.filter(c => c.data_ref && c.status !== 'concluido' && c.status !== 'pausado' && c.data_ref < hoje()).length;
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="pj-kpi"><div class="tiny muted">Projetos</div><div style="font-size:18px;font-weight:800">${f.length}</div></div>
      <div class="pj-kpi"><div class="tiny muted">🚧 Em andamento</div><div style="font-size:18px;font-weight:800;color:#f59e0b">${por('andamento')}</div></div>
      <div class="pj-kpi"><div class="tiny muted">⏰ Atrasados</div><div style="font-size:18px;font-weight:800;color:#ef4444">${atrasados}</div></div>
      <div class="pj-kpi"><div class="tiny muted">✅ Concluídos</div><div style="font-size:18px;font-weight:800;color:#16a34a">${por('concluido')}</div></div>
    </div>`;
}

function render() {
  const body = _view === 'prazos' ? renderPrazos()
    : _view === 'metricas' ? renderMetricas()
    : `<div class="pj-board">${STAGES.map(col).join('')}</div>`;
  _root.innerHTML = `${STYLE}${header()}${filtros()}${_view === 'metricas' ? '' : kpis()}${body}`;
  bind();
}

function col(st) {
  const cards = filtered().filter(c => (c.status || 'ideia') === st.id);
  return `
    <div class="pj-col" data-col="${st.id}">
      <div class="flex items-center" style="justify-content:space-between;padding:2px 4px 8px">
        <span style="font-weight:800;font-size:12px;color:${st.cor}">${st.lbl}</span>
        <span class="tiny muted" style="font-weight:700">${cards.length}</span>
      </div>
      ${cards.map(card).join('') || '<div class="tiny muted" style="padding:8px;text-align:center;opacity:.6">—</div>'}
      <button class="btn btn-ghost tiny pj-add" data-st="${st.id}" style="margin-top:auto;border:1px dashed rgba(148,163,184,.4)">+ adicionar</button>
    </div>`;
}

function card(c) {
  const atras = c.data_ref && c.status !== 'concluido' && c.status !== 'pausado' && c.data_ref < hoje();
  return `
    <div class="pj-card" draggable="true" data-card="${esc(c.id)}">
      <div style="font-weight:800;font-size:13px;line-height:1.3">${esc(c.titulo || 'Sem nome')}</div>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">
        ${c.plataforma ? `<span class="pj-chip" style="background:${areaCor(c.plataforma)}1f;color:${areaCor(c.plataforma)}">${esc(c.plataforma)}</span>` : ''}
        ${c.formato ? `<span class="pj-chip" style="background:${(PRIOR_COR[c.formato] || '#64748b')}1f;color:${PRIOR_COR[c.formato] || '#64748b'}">⚑ ${esc(c.formato)}</span>` : ''}
        ${c.data_ref ? `<span class="pj-chip" style="background:${atras ? 'rgba(239,68,68,.16)' : 'rgba(148,163,184,.16)'};color:${atras ? '#dc2626' : 'var(--ink,#475569)'}">📅 ${esc(fmtData(c.data_ref))}${atras ? ' ⚠' : ''}</span>` : ''}
      </div>
      ${(() => { const d = checkDone(c); return d ? `<div style="margin-top:7px"><div style="height:5px;border-radius:3px;background:rgba(148,163,184,.25);overflow:hidden"><div style="height:100%;width:${Math.round(d / CHECK.length * 100)}%;background:${d === CHECK.length ? '#16a34a' : '#0891b2'}"></div></div><div class="tiny muted" style="margin-top:2px">✔ ${d}/${CHECK.length}</div></div>` : ''; })()}
      <div class="flex gap-2" style="margin-top:8px;align-items:center">
        ${c.responsavel ? `<span class="tiny" style="font-weight:700">👤 ${esc(c.responsavel)}</span>` : ''}
        ${c.obs ? '<span class="tiny" title="Tem escopo" style="color:#16a34a">📄</span>' : ''}
        ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener" data-stop="1" class="tiny" style="text-decoration:none">🔗</a>` : ''}
        <button class="btn btn-ghost tiny pj-edit" data-card="${esc(c.id)}" style="margin-left:auto">editar</button>
      </div>
    </div>`;
}

/* ── PRAZOS: agrupa por data de entrega ── */
function renderPrazos() {
  const f = filtered().filter(c => c.data_ref).sort((a, b) => a.data_ref.localeCompare(b.data_ref));
  const semData = filtered().filter(c => !c.data_ref);
  const groups = {}; f.forEach(c => (groups[c.data_ref] = groups[c.data_ref] || []).push(c));
  const datas = Object.keys(groups).sort();
  if (!datas.length && !semData.length) return '<div class="muted tiny">Nenhum projeto ainda — crie o primeiro em "+ Novo projeto".</div>';
  const row = c => `<div class="pj-row" data-card="${esc(c.id)}">
      <span style="font-size:15px">${stageInfo(c.status).lbl.split(' ')[0]}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.titulo || 'Sem nome')}</div>
        <div class="tiny muted">${esc(c.plataforma || '—')}${c.formato ? ' · ⚑ ' + esc(c.formato) : ''}${c.responsavel ? ' · 👤 ' + esc(c.responsavel) : ''}</div>
      </div>
      <span class="pj-chip" style="background:${stageInfo(c.status).cor}1f;color:${stageInfo(c.status).cor};white-space:nowrap">${stageInfo(c.status).lbl}</span>
    </div>`;
  return `
    ${datas.map(d => {
      const isHoje = d === hoje(), isPast = d < hoje();
      return `<div class="pj-day">
        <div class="flex items-center" style="justify-content:space-between">
          <div style="font-weight:800;font-size:14px;color:${isHoje ? '#16a34a' : isPast ? '#ef4444' : '#0891b2'}">📅 ${fmtData(d)}${isHoje ? ' · HOJE' : isPast ? ' · ATRASADO' : ''}</div>
          <span class="tiny muted" style="font-weight:700">${groups[d].length} projeto(s)</span>
        </div>
        ${groups[d].map(row).join('')}
      </div>`;
    }).join('')}
    ${semData.length ? `<div class="pj-day"><div style="font-weight:800;font-size:14px;color:#64748b">📌 Sem prazo (${semData.length})</div>${semData.map(row).join('')}</div>` : ''}`;
}

/* ── MÉTRICAS ── */
function renderMetricas() {
  const f = filtered();
  if (!f.length) return '<div class="muted tiny">Sem projetos ainda.</div>';
  const n = f.length;
  const concl = f.filter(c => c.status === 'concluido').length;
  const atras = f.filter(c => c.data_ref && c.status !== 'concluido' && c.status !== 'pausado' && c.data_ref < hoje()).length;
  const bar = (v, max, cor) => `<div style="height:8px;border-radius:4px;background:rgba(148,163,184,.2);overflow:hidden"><div style="height:100%;width:${max ? Math.round(v / max * 100) : 0}%;background:${cor}"></div></div>`;
  const stg = STAGES.map(s => ({ s, n: f.filter(c => (c.status || 'ideia') === s.id).length })); const stgMax = Math.max(1, ...stg.map(x => x.n));
  const area = {}; f.forEach(c => { const a = c.plataforma || '(sem área)'; (area[a] = area[a] || { tot: 0, ok: 0 }); area[a].tot++; if (c.status === 'concluido') area[a].ok++; });
  const areaArr = Object.entries(area).sort((a, b) => b[1].tot - a[1].tot);
  const resp = {}; f.forEach(c => { const r = c.responsavel || '(sem resp.)'; resp[r] = (resp[r] || 0) + 1; });
  const respArr = Object.entries(resp).sort((a, b) => b[1] - a[1]); const respMax = Math.max(1, ...respArr.map(x => x[1]));
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="pj-kpi"><div class="tiny muted">Total</div><div style="font-size:20px;font-weight:800">${n}</div></div>
      <div class="pj-kpi"><div class="tiny muted">Concluídos</div><div style="font-size:20px;font-weight:800;color:#16a34a">${concl} <span class="tiny muted">(${Math.round(concl / n * 100)}%)</span></div></div>
      <div class="pj-kpi"><div class="tiny muted">⏰ Atrasados</div><div style="font-size:20px;font-weight:800;color:#ef4444">${atras}</div></div>
    </div>
    <div class="pj-day"><div style="font-weight:800;font-size:14px;margin-bottom:8px">Por etapa</div>
      ${stg.map(x => `<div style="margin-bottom:8px"><div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:700;color:${x.s.cor}">${x.s.lbl}</span><span class="tiny muted">${x.n}</span></div>${bar(x.n, stgMax, x.s.cor)}</div>`).join('')}
    </div>
    <div class="pj-day"><div style="font-weight:800;font-size:14px;margin-bottom:8px">Por área (concluídos/total)</div>
      ${areaArr.map(([a, v]) => `<div style="margin-bottom:8px"><div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:700">${esc(a)}</span><span class="tiny muted">${v.ok}/${v.tot}</span></div>${bar(v.ok, v.tot, areaCor(a))}</div>`).join('')}
    </div>
    <div class="pj-day"><div style="font-weight:800;font-size:14px;margin-bottom:8px">Carga por responsável</div>
      ${respArr.map(([r, v]) => `<div style="margin-bottom:8px"><div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:700">👤 ${esc(r)}</span><span class="tiny muted">${v}</span></div>${bar(v, respMax, '#0891b2')}</div>`).join('')}
    </div>`;
}

async function gerarIA(payload, alvoEl, btn) {
  const t0 = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ gerando…'; }
  try {
    const r = await api.request('/api/v3/ia/roteiro', { method: 'POST', body: { modo: 'projeto', ...payload } });
    if (r && r.text) alvoEl.value = (alvoEl.value ? alvoEl.value + '\n\n' : '') + r.text;
    else alert('IA não retornou conteúdo.');
  } catch (e) { alert('IA indisponível: ' + (e.message || e)); }
  finally { if (btn) { btn.disabled = false; btn.textContent = t0; } }
}

function bind() {
  _root.querySelectorAll('.pj-tab').forEach(t => t.addEventListener('click', () => { _view = t.dataset.view; render(); }));
  const fa = _root.querySelector('#pj-farea'); if (fa) fa.onchange = () => { _fArea = fa.value; render(); };
  const fr = _root.querySelector('#pj-fresp'); if (fr) fr.onchange = () => { _fResp = fr.value; render(); };
  _root.querySelector('#pj-new')?.addEventListener('click', () => openEditor({ plataforma: _fArea || '' }));
  _root.querySelectorAll('.pj-add').forEach(b => b.addEventListener('click', () => openEditor({ status: b.dataset.st, plataforma: _fArea || '' })));
  _root.querySelectorAll('.pj-edit').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openEditor(_cards.find(c => c.id === b.dataset.card)); }));
  _root.querySelectorAll('.pj-row').forEach(r => r.addEventListener('click', () => openEditor(_cards.find(c => c.id === r.dataset.card))));
  _root.querySelectorAll('.pj-card').forEach(el => {
    el.addEventListener('dragstart', () => { _dragId = el.dataset.card; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { _dragId = null; el.classList.remove('dragging'); _root.querySelectorAll('.pj-col').forEach(c => c.classList.remove('drop')); });
  });
  _root.querySelectorAll('.pj-col').forEach(colEl => {
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
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? 'Editar projeto' : 'Novo projeto'}</div>
      <label class="tiny muted">Nome do projeto</label>
      <input id="pj-f-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex: Implantar pós-venda / Reformar showroom" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Área</label>
          <input id="pj-f-area" class="input" list="pj-areas" value="${esc(c.plataforma || '')}" placeholder="Área responsável">
          <datalist id="pj-areas">${AREAS.map(a => `<option value="${esc(a)}">`).join('')}</datalist></div>
        <div style="flex:1"><label class="tiny muted">Prioridade</label>
          <select id="pj-f-prior" class="select"><option value="">—</option>${PRIOR.map(p => `<option value="${esc(p)}"${c.formato === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Etapa</label>
          <select id="pj-f-status" class="select">${STAGES.map(s => `<option value="${s.id}"${(c.status || 'ideia') === s.id ? ' selected' : ''}>${esc(s.lbl)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Responsável</label>
          <input id="pj-f-resp" class="input" list="pj-resps" value="${esc(c.responsavel || '')}" placeholder="Quem toca">
          <datalist id="pj-resps">${respsDisp().map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">📅 Prazo / entrega</label>
          <input id="pj-f-data" class="input" type="date" value="${c.data_ref ? String(c.data_ref).substring(0,10) : ''}"></div>
        <div style="flex:1"><label class="tiny muted">Link (pasta / doc)</label>
          <input id="pj-f-link" class="input" value="${esc(c.link || '')}" placeholder="https://"></div>
      </div>
      <div class="flex" style="justify-content:space-between;align-items:center">
        <label class="tiny muted">📄 Escopo / descrição</label>
        <button class="btn btn-ghost tiny" id="pj-ia" type="button" title="Esboça um plano de projeto com IA">✍️ Esboçar plano (IA)</button>
      </div>
      <textarea id="pj-f-obs" class="input" rows="6" placeholder="Objetivo, entregáveis, etapas… (ou ✍️ Esboçar plano com IA)">${esc(c.obs || '')}</textarea>
      <label class="tiny muted" style="display:block;margin-top:10px">✅ Checklist</label>
      <div class="flex" style="flex-wrap:wrap;gap:6px 14px;margin-bottom:6px">
        ${CHECK.map(x => `<label class="tiny flex gap-1" style="align-items:center;cursor:pointer"><input type="checkbox" class="pj-chk" data-k="${x.k}" ${(c.checklist || {})[x.k] ? 'checked' : ''}> ${x.l}</label>`).join('')}
      </div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        <button class="btn btn-ghost" id="pj-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="pj-cancel">Cancelar</button>
          <button class="btn btn-primary" id="pj-save">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#pj-cancel').onclick = () => ov.remove();
  ov.querySelector('#pj-ia').onclick = e => gerarIA(
    { tema: ov.querySelector('#pj-f-titulo').value, linha: ov.querySelector('#pj-f-area').value },
    ov.querySelector('#pj-f-obs'), e.currentTarget);
  ov.querySelector('#pj-save').onclick = async () => {
    const g = id => ov.querySelector('#pj-f-' + id).value;
    const checklist = {}; ov.querySelectorAll('.pj-chk').forEach(ch => { if (ch.checked) checklist[ch.dataset.k] = true; });
    const body = {
      action: 'upsert', board: _board, id: c.id || undefined,
      titulo: g('titulo').trim(),
      plataforma: g('area').trim(),    // área
      formato: g('prior'),             // prioridade
      status: g('status'),
      responsavel: g('resp').trim(),
      data_ref: g('data') || null,     // prazo
      link: g('link').trim(),
      obs: g('obs').trim(),            // escopo
      checklist,
    };
    if (!body.titulo) { ov.querySelector('#pj-f-titulo').focus(); return; }
    ov.querySelector('#pj-save').disabled = true;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body }); ov.remove(); await pageProjetos(null, _root); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#pj-save').disabled = false; }
  };
  ov.querySelector('#pj-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este projeto?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await pageProjetos(null, _root); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#pj-f-titulo')?.focus(), 50);
}
