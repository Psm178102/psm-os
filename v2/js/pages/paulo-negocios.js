/* PSM-OS v2 — "Paulo" (Diretoria): mini-kanban dos NEGÓCIOS PESSOAIS do Paulo.
   NÃO é a imobiliária — board privado por dono (board=negocios). v77.48 */
import { api } from '../api.js';

let _root = null;
let _cards = [];
let _editing = null;
let _dragId = null;

const STAGES = [
  { id: 'ideia',      lbl: '💡 Ideia / Oportunidade', cor: '#64748b' },
  { id: 'analise',    lbl: '🔎 Analisando',           cor: '#0ea5e9' },
  { id: 'negociando', lbl: '🤝 Negociando',           cor: '#f59e0b' },
  { id: 'fechamento', lbl: '✍️ Fechamento',           cor: '#8b5cf6' },
  { id: 'fechado',    lbl: '✅ Fechado',              cor: '#16a34a' },
  { id: 'pausado',    lbl: '⏸ Pausado / Standby',     cor: '#94a3b8' },
];
const stInfo = id => STAGES.find(s => s.id === id) || STAGES[0];

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const money = v => (v == null || v === '' || isNaN(+v)) ? '' : (+v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';

export async function pagePauloNegocios(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando negócios…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=negocios');
    if (r && r.pending) { root.innerHTML = `<div class="alert alert-err">Tabela ainda não criada. Rode <code>supabase/sprint_paulo_e_captstale.sql</code>.</div>`; return; }
    _cards = (r && r.cards) || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  render();
}

function render() {
  const total = _cards.filter(c => c.status !== 'fechado' && c.status !== 'pausado')
    .reduce((s, c) => s + (+c.valor || 0), 0);
  const fechado = _cards.filter(c => c.status === 'fechado').reduce((s, c) => s + (+c.valor || 0), 0);
  _root.innerHTML = `
    <style>
      .pn-board{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x proximity}
      .pn-col{min-width:248px;max-width:280px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:8px;display:flex;flex-direction:column;scroll-snap-align:start;transition:background .15s,box-shadow .15s}
      .pn-col.drop{background:rgba(99,102,241,.12);box-shadow:inset 0 0 0 2px #6366f1}
      .pn-card{background:var(--bg-1,#fff);border-radius:10px;padding:10px 11px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.06);border:1px solid rgba(148,163,184,.16);transition:transform .12s,box-shadow .12s}
      .pn-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.12)}
      .pn-card.dragging{opacity:.45}
      .pn-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
      .pn-kpi{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:10px 14px;flex:1;min-width:120px}
    </style>
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">Paulo · Meus Negócios</div>
        <div class="tiny muted">Negócios pessoais em andamento — privado, não é a imobiliária.</div>
      </div>
      <button class="btn btn-primary" id="pn-new">+ Novo negócio</button>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="pn-kpi"><div class="tiny muted">Em andamento</div><div style="font-size:18px;font-weight:800">${money(total) || 'R$ 0'}</div></div>
      <div class="pn-kpi"><div class="tiny muted">Fechado (acumulado)</div><div style="font-size:18px;font-weight:800;color:#16a34a">${money(fechado) || 'R$ 0'}</div></div>
      <div class="pn-kpi"><div class="tiny muted">Negócios ativos</div><div style="font-size:18px;font-weight:800">${_cards.filter(c => c.status !== 'fechado' && c.status !== 'pausado').length}</div></div>
    </div>
    <div class="pn-board">
      ${STAGES.map(col).join('')}
    </div>`;
  bind();
}

function col(st) {
  const cards = _cards.filter(c => (c.status || 'ideia') === st.id);
  return `
    <div class="pn-col" data-col="${st.id}">
      <div class="flex items-center" style="justify-content:space-between;padding:2px 4px 8px">
        <span style="font-weight:800;font-size:12.5px;color:${st.cor}">${st.lbl}</span>
        <span class="tiny muted" style="font-weight:700">${cards.length}</span>
      </div>
      ${cards.map(card).join('') || '<div class="tiny muted" style="padding:8px;text-align:center;opacity:.6">—</div>'}
      <button class="btn btn-ghost tiny pn-add" data-st="${st.id}" style="margin-top:auto;border:1px dashed rgba(148,163,184,.4)">+ adicionar</button>
    </div>`;
}

function card(c) {
  const v = money(c.valor);
  return `
    <div class="pn-card" draggable="true" data-card="${esc(c.id)}">
      <div style="font-weight:800;font-size:13.5px;line-height:1.3">${esc(c.titulo || 'Sem título')}</div>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">
        ${v ? `<span class="pn-chip" style="background:rgba(22,163,74,.14);color:#15803d">${esc(v)}</span>` : ''}
        ${c.data_ref ? `<span class="pn-chip" style="background:rgba(148,163,184,.16);color:var(--ink,#475569)">📅 ${esc(fmtData(c.data_ref))}</span>` : ''}
      </div>
      ${c.obs ? `<div class="tiny muted" style="margin-top:6px;white-space:pre-wrap;max-height:54px;overflow:hidden">${esc(c.obs)}</div>` : ''}
      <div class="flex gap-2" style="margin-top:8px;align-items:center">
        ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener" data-stop="1" class="tiny" style="text-decoration:none">🔗 abrir</a>` : ''}
        <button class="btn btn-ghost tiny pn-edit" data-card="${esc(c.id)}" style="margin-left:auto">editar</button>
      </div>
    </div>`;
}

function bind() {
  _root.querySelector('#pn-new')?.addEventListener('click', () => openEditor(null));
  _root.querySelectorAll('.pn-add').forEach(b => b.addEventListener('click', () => openEditor({ status: b.dataset.st })));
  _root.querySelectorAll('.pn-edit').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditor(_cards.find(c => c.id === b.dataset.card));
  }));
  _root.querySelectorAll('.pn-card').forEach(el => {
    el.addEventListener('dragstart', () => { _dragId = el.dataset.card; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { _dragId = null; el.classList.remove('dragging'); _root.querySelectorAll('.pn-col').forEach(c => c.classList.remove('drop')); });
  });
  _root.querySelectorAll('.pn-col').forEach(colEl => {
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
  _editing = seed && seed.id ? seed : { status: (seed && seed.status) || 'ideia' };
  const c = _editing;
  const ov = document.createElement('div');
  ov.id = 'pn-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:440px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? 'Editar negócio' : 'Novo negócio'}</div>
      <label class="tiny muted">Título</label>
      <input id="pn-f-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex: Compra terreno X / Sociedade Y" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Valor / potencial (R$)</label>
          <input id="pn-f-valor" class="input" type="number" value="${c.valor ?? ''}" placeholder="0"></div>
        <div style="flex:1"><label class="tiny muted">Etapa</label>
          <select id="pn-f-status" class="input">${STAGES.map(s => `<option value="${s.id}"${(c.status || 'ideia') === s.id ? ' selected' : ''}>${esc(s.lbl)}</option>`).join('')}</select></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Prazo / data</label>
          <input id="pn-f-data" class="input" type="date" value="${c.data_ref ? String(c.data_ref).substring(0,10) : ''}"></div>
        <div style="flex:1"><label class="tiny muted">Link</label>
          <input id="pn-f-link" class="input" value="${esc(c.link || '')}" placeholder="https://"></div>
      </div>
      <label class="tiny muted">Notas</label>
      <textarea id="pn-f-obs" class="input" rows="3" placeholder="Detalhes, próximos passos…" style="margin-bottom:14px">${esc(c.obs || '')}</textarea>
      <div class="flex gap-2" style="justify-content:space-between">
        <button class="btn btn-ghost" id="pn-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="pn-cancel">Cancelar</button>
          <button class="btn btn-primary" id="pn-save">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#pn-cancel').onclick = () => ov.remove();
  ov.querySelector('#pn-save').onclick = async () => {
    const body = {
      action: 'upsert', board: 'negocios', id: c.id || undefined,
      titulo: ov.querySelector('#pn-f-titulo').value.trim(),
      valor: ov.querySelector('#pn-f-valor').value,
      status: ov.querySelector('#pn-f-status').value,
      data_ref: ov.querySelector('#pn-f-data').value || null,
      link: ov.querySelector('#pn-f-link').value.trim(),
      obs: ov.querySelector('#pn-f-obs').value.trim(),
    };
    if (!body.titulo) { ov.querySelector('#pn-f-titulo').focus(); return; }
    ov.querySelector('#pn-save').disabled = true;
    try {
      await api.request('/api/v3/paulo/cards', { method: 'POST', body });
      ov.remove();
      await pagePauloNegocios(null, _root);
    } catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#pn-save').disabled = false; }
  };
  ov.querySelector('#pn-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este negócio?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await pagePauloNegocios(null, _root); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#pn-f-titulo')?.focus(), 50);
}
