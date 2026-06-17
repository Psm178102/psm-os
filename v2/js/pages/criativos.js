/* ============================================================================
   PSM-OS v2 — Marketing · Criativos (v77.65)
   ----------------------------------------------------------------------------
   Mural de BRIEFINGS de criativos pra campanhas de tráfego. O time pede aqui
   tudo que o marketing precisa pra produzir: tipo (carrossel/estático/vídeo),
   formato, copy, headline, CTA, número que deve constar, e o material de apoio
   (imagens/vídeos/PDFs/links). O marketing pega o card, produz e move pela
   esteira (Solicitado → Em produção → Em revisão → Aprovado → Publicado).
   Reusa o board engine paulo_cards (board=criativos). Brief estruturado vai no
   campo checklist (jsonb). Sem SQL.
============================================================================ */
import { api } from '../api.js';

let _root = null;
let _cards = [];
let _fTipo = '';
let _fResp = '';
let _dragId = null;
const _board = 'criativos';

const TIPOS = ['Carrossel', 'Estático', 'Vídeo', 'Story / Reels'];
const TIPO_COR = { 'Carrossel': '#8b5cf6', 'Estático': '#0ea5e9', 'Vídeo': '#ef4444', 'Story / Reels': '#d6249f' };
const FORMATOS = ['Feed 1:1 (1080×1080)', 'Feed 4:5 (1080×1350)', 'Stories/Reels 9:16 (1080×1920)', 'Paisagem 16:9', 'Outro'];
const CAMPANHAS = ['Tráfego — Conquista', 'Tráfego — M.A.P', 'Captação', 'Locação', 'Branding', 'Lançamento'];
const CTAS = ['Saiba mais', 'Enviar mensagem', 'Falar no WhatsApp', 'Cadastre-se', 'Ligar agora', 'Comprar / Tenho interesse'];
const RESP_SUGEST = ['Guilherme', 'Isabella', 'Paulo'];
const MAT_TIPOS = ['imagem', 'vídeo', 'pdf', 'link', 'texto'];
const MAT_ICO = { imagem: '🖼', 'vídeo': '🎞', pdf: '📄', link: '🔗', texto: '📝' };

const STAGES = [
  { id: 'solicitado', lbl: '📥 Solicitado',  cor: '#f59e0b' },
  { id: 'producao',   lbl: '🎨 Em produção', cor: '#0ea5e9' },
  { id: 'revisao',    lbl: '👁 Em revisão',  cor: '#8b5cf6' },
  { id: 'aprovado',   lbl: '✅ Aprovado',    cor: '#16a34a' },
  { id: 'publicado',  lbl: '🚀 Publicado',   cor: '#0891b2' },
];
const stageInfo = id => STAGES.find(s => s.id === id) || { lbl: id || '—', cor: '#64748b' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';
const hoje = () => new Date().toISOString().substring(0, 10);
const brief = c => (c && typeof c.checklist === 'object' && c.checklist) ? c.checklist : {};
const mats = c => Array.isArray(brief(c).materiais) ? brief(c).materiais : [];

export async function pageCriativos(ctx, root) {
  _root = root; _fTipo = ''; _fResp = '';
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando criativos…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=' + _board);
    if (r && r.pending) { root.innerHTML = `<div class="alert alert-err">Tabela ainda não criada. Rode <code>supabase/sprint_paulo_e_captstale.sql</code>.</div>`; return; }
    _cards = (r && r.cards) || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  render();
}

function respsDisp() { const s = new Set(RESP_SUGEST); _cards.forEach(c => { if (c.responsavel) s.add(c.responsavel); }); return [...s]; }
function filtered() {
  return _cards.filter(c => (_fTipo === '' || (c.formato || '') === _fTipo) && (_fResp === '' || (c.responsavel || '') === _fResp));
}

const STYLE = `
  <style>
    .cr-board{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 14px}
    .cr-col{min-width:250px;max-width:288px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:8px;display:flex;flex-direction:column}
    .cr-col.drop{background:rgba(214,36,159,.12);box-shadow:inset 0 0 0 2px #d6249f}
    .cr-card{background:var(--bg-1,#fff);border-radius:10px;padding:10px 11px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.06);border:1px solid rgba(148,163,184,.16);transition:transform .12s,box-shadow .12s}
    .cr-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.12)}
    .cr-card.dragging{opacity:.45}
    .cr-chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
    .cr-kpi{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:10px 14px;flex:1;min-width:110px}
    .cr-matrow{display:flex;gap:6px;margin-bottom:6px;align-items:center}
  </style>`;

function header() {
  return `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">🎨 Criativos — pedidos pro Marketing</div>
        <div class="tiny muted">Briefe aqui o que precisa pras campanhas (copy, headline, CTA, número, material) e o marketing produz.</div>
      </div>
      <button class="btn btn-primary" id="cr-new">+ Pedir criativo</button>
    </div>`;
}

function filtros() {
  const resps = respsDisp();
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div><label class="tiny muted">Tipo</label>
        <select id="cr-ftipo" class="select"><option value="">Todos os tipos</option>${TIPOS.map(t => `<option value="${esc(t)}"${_fTipo === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div><label class="tiny muted">Responsável</label>
        <select id="cr-fresp" class="select"><option value="">Todos</option>${resps.map(r => `<option value="${esc(r)}"${_fResp === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    </div>`;
}

function kpis() {
  const f = filtered();
  const por = id => f.filter(c => (c.status || 'solicitado') === id).length;
  const atras = f.filter(c => c.data_ref && c.status !== 'publicado' && c.status !== 'aprovado' && c.data_ref < hoje()).length;
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="cr-kpi"><div class="tiny muted">Pedidos</div><div style="font-size:18px;font-weight:800">${f.length}</div></div>
      <div class="cr-kpi"><div class="tiny muted">📥 Na fila</div><div style="font-size:18px;font-weight:800;color:#f59e0b">${por('solicitado')}</div></div>
      <div class="cr-kpi"><div class="tiny muted">🎨 Produzindo</div><div style="font-size:18px;font-weight:800;color:#0ea5e9">${por('producao')}</div></div>
      <div class="cr-kpi"><div class="tiny muted">⏰ Atrasados</div><div style="font-size:18px;font-weight:800;color:#ef4444">${atras}</div></div>
      <div class="cr-kpi"><div class="tiny muted">🚀 Publicados</div><div style="font-size:18px;font-weight:800;color:#0891b2">${por('publicado')}</div></div>
    </div>`;
}

function render() {
  _root.innerHTML = `${STYLE}${header()}${filtros()}${kpis()}<div class="cr-board">${STAGES.map(col).join('')}</div>`;
  bind();
}

function col(st) {
  const cards = filtered().filter(c => (c.status || 'solicitado') === st.id);
  return `
    <div class="cr-col" data-col="${st.id}">
      <div class="flex items-center" style="justify-content:space-between;padding:2px 4px 8px">
        <span style="font-weight:800;font-size:12px;color:${st.cor}">${st.lbl}</span>
        <span class="tiny muted" style="font-weight:700">${cards.length}</span>
      </div>
      ${cards.map(card).join('') || '<div class="tiny muted" style="padding:8px;text-align:center;opacity:.6">—</div>'}
      <button class="btn btn-ghost tiny cr-add" data-st="${st.id}" style="margin-top:auto;border:1px dashed rgba(148,163,184,.4)">+ pedir</button>
    </div>`;
}

function card(c) {
  const atras = c.data_ref && c.status !== 'publicado' && c.status !== 'aprovado' && c.data_ref < hoje();
  const b = brief(c); const nMat = mats(c).length;
  return `
    <div class="cr-card" draggable="true" data-card="${esc(c.id)}">
      <div style="font-weight:800;font-size:13px;line-height:1.3">${esc(c.titulo || 'Sem nome')}</div>
      ${b.headline ? `<div class="tiny muted" style="margin-top:3px;font-style:italic">“${esc(String(b.headline).substring(0, 70))}”</div>` : ''}
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">
        ${c.formato ? `<span class="cr-chip" style="background:${(TIPO_COR[c.formato] || '#64748b')}1f;color:${TIPO_COR[c.formato] || '#64748b'}">${esc(c.formato)}</span>` : ''}
        ${c.plataforma ? `<span class="cr-chip" style="background:rgba(148,163,184,.16);color:var(--ink,#475569)">🎯 ${esc(c.plataforma)}</span>` : ''}
        ${c.data_ref ? `<span class="cr-chip" style="background:${atras ? 'rgba(239,68,68,.16)' : 'rgba(148,163,184,.16)'};color:${atras ? '#dc2626' : 'var(--ink,#475569)'}">📅 ${esc(fmtData(c.data_ref))}${atras ? ' ⚠' : ''}</span>` : ''}
      </div>
      <div class="flex gap-2" style="margin-top:8px;align-items:center">
        ${c.responsavel ? `<span class="tiny" style="font-weight:700">👤 ${esc(c.responsavel)}</span>` : '<span class="tiny" style="color:#f59e0b;font-weight:700">sem resp.</span>'}
        ${nMat ? `<span class="tiny" title="Materiais anexados">📎 ${nMat}</span>` : ''}
        ${b.cta ? `<span class="tiny" title="CTA">▶ ${esc(b.cta)}</span>` : ''}
        <button class="btn btn-ghost tiny cr-edit" data-card="${esc(c.id)}" style="margin-left:auto">abrir</button>
      </div>
    </div>`;
}

function bind() {
  const ft = _root.querySelector('#cr-ftipo'); if (ft) ft.onchange = () => { _fTipo = ft.value; render(); };
  const fr = _root.querySelector('#cr-fresp'); if (fr) fr.onchange = () => { _fResp = fr.value; render(); };
  _root.querySelector('#cr-new')?.addEventListener('click', () => openEditor({}));
  _root.querySelectorAll('.cr-add').forEach(b => b.addEventListener('click', () => openEditor({ status: b.dataset.st })));
  _root.querySelectorAll('.cr-edit').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openEditor(_cards.find(c => c.id === b.dataset.card)); }));
  _root.querySelectorAll('.cr-card').forEach(el => {
    el.addEventListener('dragstart', () => { _dragId = el.dataset.card; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { _dragId = null; el.classList.remove('dragging'); _root.querySelectorAll('.cr-col').forEach(c => c.classList.remove('drop')); });
  });
  _root.querySelectorAll('.cr-col').forEach(colEl => {
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

/* ── materiais (repeater) ── */
function matRow(m = {}) {
  return `<div class="cr-matrow">
      <select class="select cr-m-tipo" style="max-width:110px">${MAT_TIPOS.map(t => `<option value="${t}"${m.tipo === t ? ' selected' : ''}>${MAT_ICO[t]} ${t}</option>`).join('')}</select>
      <input class="input cr-m-url" placeholder="link / URL do material" value="${esc(m.url || '')}" style="flex:2">
      <input class="input cr-m-nome" placeholder="descrição" value="${esc(m.nome || '')}" style="flex:1">
      <button class="btn btn-ghost tiny cr-m-del" type="button" title="remover">✕</button>
    </div>`;
}

function openEditor(seed) {
  const c = seed && seed.id ? seed : { status: (seed && seed.status) || 'solicitado' };
  const b = brief(c);
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:620px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? 'Briefing do criativo' : 'Pedir novo criativo'}</div>
      <label class="tiny muted">Nome / referência do criativo *</label>
      <input id="cr-f-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex: Carrossel lançamento X / Reels captação MAP" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Tipo *</label>
          <select id="cr-f-tipo" class="select"><option value="">—</option>${TIPOS.map(t => `<option value="${esc(t)}"${c.formato === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Formato / dimensão</label>
          <input id="cr-f-formato" class="input" list="cr-formatos" value="${esc(b.formatoDet || '')}" placeholder="dimensão">
          <datalist id="cr-formatos">${FORMATOS.map(f => `<option value="${esc(f)}">`).join('')}</datalist></div>
      </div>
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Campanha / objetivo</label>
          <input id="cr-f-camp" class="input" list="cr-camps" value="${esc(c.plataforma || '')}" placeholder="Pra qual campanha">
          <datalist id="cr-camps">${CAMPANHAS.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div style="flex:1"><label class="tiny muted">Responsável (marketing)</label>
          <input id="cr-f-resp" class="input" list="cr-resps" value="${esc(c.responsavel || '')}" placeholder="Quem produz">
          <datalist id="cr-resps">${respsDisp().map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
        <div style="flex:0 0 140px"><label class="tiny muted">📅 Prazo</label>
          <input id="cr-f-data" class="input" type="date" value="${c.data_ref ? String(c.data_ref).substring(0, 10) : ''}"></div>
      </div>
      <label class="tiny muted">📰 Headline (título do criativo)</label>
      <input id="cr-f-headline" class="input" value="${esc(b.headline || '')}" placeholder="Título que aparece na arte" style="margin-bottom:10px">
      <label class="tiny muted">✍️ Copy (texto do anúncio)</label>
      <textarea id="cr-f-copy" class="input" rows="4" placeholder="Texto principal do anúncio">${esc(b.copy || '')}</textarea>
      <div class="flex gap-2" style="margin:10px 0">
        <div style="flex:1"><label class="tiny muted">CTA (chamada)</label>
          <input id="cr-f-cta" class="input" list="cr-ctas" value="${esc(b.cta || '')}" placeholder="Ex: Falar no WhatsApp">
          <datalist id="cr-ctas">${CTAS.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div style="flex:1"><label class="tiny muted">📞 Número que deve constar</label>
          <input id="cr-f-tel" class="input" value="${esc(b.telefone || '')}" placeholder="Telefone/WhatsApp na arte"></div>
      </div>
      <label class="tiny muted">📎 Material de apoio (imagens, vídeos, PDFs, links)</label>
      <div id="cr-mats" style="margin:4px 0 6px">${(mats(c).length ? mats(c) : [{}]).map(matRow).join('')}</div>
      <button class="btn btn-ghost tiny" id="cr-m-add" type="button">+ adicionar material</button>
      <div style="margin-top:12px"><label class="tiny muted">Link principal (pasta Drive / referência)</label>
        <input id="cr-f-link" class="input" value="${esc(c.link || '')}" placeholder="https://"></div>
      <div style="margin-top:10px"><label class="tiny muted">Observações / briefing extra</label>
        <textarea id="cr-f-obs" class="input" rows="2" placeholder="Tom, referências visuais, o que NÃO fazer, etc.">${esc(c.obs || '')}</textarea></div>
      <div class="flex gap-2" style="margin-bottom:6px;margin-top:10px">
        <label class="tiny muted" style="align-self:center">Etapa</label>
        <select id="cr-f-status" class="select" style="max-width:200px">${STAGES.map(s => `<option value="${s.id}"${(c.status || 'solicitado') === s.id ? ' selected' : ''}>${esc(s.lbl)}</option>`).join('')}</select>
      </div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        <button class="btn btn-ghost" id="cr-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="cr-cancel">Cancelar</button>
          <button class="btn btn-primary" id="cr-save">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#cr-cancel').onclick = () => ov.remove();
  const matsBox = ov.querySelector('#cr-mats');
  ov.querySelector('#cr-m-add').onclick = () => matsBox.insertAdjacentHTML('beforeend', matRow());
  matsBox.addEventListener('click', e => { const d = e.target.closest('.cr-m-del'); if (d) { d.closest('.cr-matrow').remove(); } });

  ov.querySelector('#cr-save').onclick = async () => {
    const g = id => (ov.querySelector('#cr-f-' + id)?.value || '');
    const materiais = [...matsBox.querySelectorAll('.cr-matrow')].map(r => ({
      tipo: r.querySelector('.cr-m-tipo').value,
      url: r.querySelector('.cr-m-url').value.trim(),
      nome: r.querySelector('.cr-m-nome').value.trim(),
    })).filter(m => m.url || m.nome);
    const checklist = {
      formatoDet: g('formato').trim(), headline: g('headline').trim(), copy: g('copy').trim(),
      cta: g('cta').trim(), telefone: g('tel').trim(), materiais,
    };
    const body = {
      action: 'upsert', board: _board, id: c.id || undefined,
      titulo: g('titulo').trim(),
      formato: g('tipo'),            // tipo do criativo
      plataforma: g('camp').trim(),  // campanha/objetivo
      responsavel: g('resp').trim(),
      data_ref: g('data') || null,   // prazo
      link: g('link').trim(),
      obs: g('obs').trim(),
      status: g('status'),
      checklist,                     // brief estruturado
    };
    if (!body.titulo) { ov.querySelector('#cr-f-titulo').focus(); return; }
    ov.querySelector('#cr-save').disabled = true;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body }); ov.remove(); await pageCriativos(null, _root); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#cr-save').disabled = false; }
  };
  ov.querySelector('#cr-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este pedido de criativo?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await pageCriativos(null, _root); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#cr-f-titulo')?.focus(), 50);
}
