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
import { auth } from '../auth.js';
import { getAdsLibrary, saveAdsLink, deleteAdsLink, getResourcePerms, canSeeResource, openResourcePermsModal } from '../links.js';

// Bibliotecas de Anúncios do Meta (Ad Library) — uma "conta"/categoria por bloco,
// vários links cada. Visibilidade por papel via resource_perms 'ads_<cat>'. v81.81
const ADS_CATS = [['conquista', '🏠 Conquista'], ['map', '🗺️ MAP'], ['locacao', '🔑 Locação'], ['terceiros', '🤝 Terceiros']];
let _adsLib = {}, _adsPerms = {};

let _root = null;
let _tab = 'solicitacoes';
let _canEdit = false;       // lvl>=3 (marketing+) curadoria da biblioteca de download
let _cards = [];
let _resps = [];   // usuários que enxergam Marketing (login p/ responsável)
let _fTipo = '';
let _fResp = '';
let _dragId = null;
const _board = 'criativos';
const _boardLib = 'criativos_lib';   // biblioteca de DOWNLOAD (criativos prontos)
let _lib = [];
let _fLibFmt = '';
let _fLibStatus = '';
// Categoria/equipe do criativo de download — guardada na coluna `plataforma` do card
// (livre p/ este board). Abas: MAP+Terceiros / Locação / Conquista. v81.61
const LIB_CATS = ['Conquista', 'MAP+Terceiros', 'Locação'];
let _libCat = 'Conquista';
const _isConquista = () => (auth.user()?.role || '').toLowerCase() === 'corretor_conquista';

const TIPOS = ['Carrossel', 'Estático', 'Vídeo', 'Story / Reels'];
const TIPO_COR = { 'Carrossel': '#8b5cf6', 'Estático': '#0ea5e9', 'Vídeo': '#ef4444', 'Story / Reels': '#d6249f' };
const FORMATOS = ['Feed 1:1 (1080×1080)', 'Feed 4:5 (1080×1350)', 'Stories/Reels 9:16 (1080×1920)', 'Paisagem 16:9', 'Outro'];
const CAMPANHAS = ['Tráfego — Conquista', 'Tráfego — M.A.P', 'Captação', 'Locação', 'Branding', 'Lançamento'];
const CTAS = ['Saiba mais', 'Enviar mensagem', 'Falar no WhatsApp', 'Cadastre-se', 'Ligar agora', 'Comprar / Tenho interesse'];
const RESP_SUGEST = ['Guilherme', 'Isabella', 'Paulo'];
const MAT_TIPOS = ['imagem', 'vídeo', 'pdf', 'link', 'texto'];
const MAT_ICO = { imagem: '🖼', 'vídeo': '🎞', pdf: '📄', link: '🔗', texto: '📝' };

const STAGES = [
  { id: 'solicitado', lbl: '📥 Solicitado',       cor: '#f59e0b' },
  { id: 'producao',   lbl: '🎨 Em produção',      cor: '#0ea5e9' },
  // 'revisao' mantém o ID (renomear o id orfanaria os cards já nessa coluna). v81.59
  { id: 'revisao',    lbl: '👁 Para aprovação',   cor: '#8b5cf6' },
  { id: 'corrigir',   lbl: '🔁 Corrigir/Refazer', cor: '#ef4444' },
  { id: 'aprovado',   lbl: '✅ Aprovado',         cor: '#16a34a' },
  { id: 'publicado',  lbl: '🚀 Publicado',        cor: '#0891b2' },
];
const stageInfo = id => STAGES.find(s => s.id === id) || { lbl: id || '—', cor: '#64748b' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';
const hoje = () => new Date().toISOString().substring(0, 10);
// Cronograma da demanda: Início ▶ / Entrega 📦 (alerta de atraso) / Post 📣 (v81.35)
const dateChips = c => {
  const atrasE = c.data_entrega && c.status !== 'publicado' && c.status !== 'aprovado' && String(c.data_entrega).substring(0, 10) < hoje();
  const mk = (ic, d, lbl, bg, fg) => d ? `<span class="cr-chip" title="${lbl}" style="background:${bg};color:${fg}">${ic} ${esc(fmtData(d))}</span>` : '';
  const chips = mk('▶', c.data_inicio, 'Início', 'rgba(16,185,129,.14)', '#047857')
    + (c.data_entrega ? `<span class="cr-chip" title="Entrega" style="background:${atrasE ? 'rgba(239,68,68,.18)' : 'rgba(239,68,68,.10)'};color:#b91c1c">📦 ${esc(fmtData(c.data_entrega))}${atrasE ? ' ⚠' : ''}</span>` : '')
    + mk('📣', c.data_post, 'Post', 'rgba(79,70,229,.14)', '#4f46e5');
  return chips ? `<div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">${chips}</div>` : '';
};
const brief = c => (c && typeof c.checklist === 'object' && c.checklist) ? c.checklist : {};
const mats = c => Array.isArray(brief(c).materiais) ? brief(c).materiais : [];

// SOLICITAÇÕES de criativos (briefing pro marketing produzir) — esteira kanban
export async function pageCriativos(ctx, root) {
  _root = root;
  _canEdit = (auth.user()?.lvl || 0) >= 3;
  root.innerHTML = `${STYLE}<div id="cr-body"><div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div></div>`;
  loadSolicitacoes();
}

// CRIATIVOS PARA DOWNLOAD (biblioteca de criativos prontos) — página/menu PRÓPRIO,
// separado das Solicitações: público diferente (corretor baixa × marketing produz). v81.49
export async function pageCriativosDownload(ctx, root) {
  _root = root;
  _canEdit = (auth.user()?.lvl || 0) >= 3;   // marketing+ faz a curadoria da biblioteca
  root.innerHTML = `${STYLE}<div id="cr-body"><div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div></div>`;
  loadLib();
}

const body = () => _root.querySelector('#cr-body');

async function loadSolicitacoes() {
  _fTipo = ''; _fResp = '';
  body().innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando criativos…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=' + _board);
    if (r && r.pending) { body().innerHTML = `<div class="alert alert-err">Tabela ainda não criada. Rode <code>supabase/sprint_paulo_e_captstale.sql</code>.</div>`; return; }
    _cards = (r && r.cards) || [];
  } catch (e) {
    body().innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  // usuários que têm acesso à aba Criativos (grupo Marketing) — pro dropdown de responsável
  try {
    const u = await api.request('/api/v3/users/options?group=marketing&route=' + encodeURIComponent('/criativos'));
    _resps = (u && u.users) || [];
  } catch (_) { _resps = []; }
  renderSolicitacoes();
}

// logins dos elegíveis (+ o que já está nos cards, p/ não perder valor antigo no filtro)
function respsDisp() {
  const s = new Set(_resps.map(u => u.login).filter(Boolean));
  _cards.forEach(c => { if (c.responsavel) s.add(c.responsavel); });
  if (!s.size) RESP_SUGEST.forEach(r => s.add(r));  // fallback se a lista não carregou
  return [...s];
}
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

function renderSolicitacoes() {
  body().innerHTML = `${header()}${filtros()}${kpis()}<div class="cr-board">${STAGES.map(col).join('')}</div>`;
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
      </div>
      ${dateChips(c)}
      <div class="flex gap-2" style="margin-top:8px;align-items:center">
        ${c.responsavel ? `<span class="tiny" style="font-weight:700">👤 ${esc(c.responsavel)}</span>` : '<span class="tiny" style="color:#f59e0b;font-weight:700">sem resp.</span>'}
        ${nMat ? `<span class="tiny" title="Materiais anexados">📎 ${nMat}</span>` : ''}
        ${b.cta ? `<span class="tiny" title="CTA">▶ ${esc(b.cta)}</span>` : ''}
        <button class="btn btn-ghost tiny cr-edit" data-card="${esc(c.id)}" style="margin-left:auto">abrir</button>
      </div>
    </div>`;
}

function bind() {
  const ft = _root.querySelector('#cr-ftipo'); if (ft) ft.onchange = () => { _fTipo = ft.value; renderSolicitacoes(); };
  const fr = _root.querySelector('#cr-fresp'); if (fr) fr.onchange = () => { _fResp = fr.value; renderSolicitacoes(); };
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
      c.status = st; renderSolicitacoes();
      try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'move', id: c.id, status: st } }); } catch (_) {}
    });
  });
}

/* ── opções de responsável: logins dos usuários que enxergam Marketing ── */
function respOptions(cur) {
  const seen = new Set();
  let opts = '<option value="">— sem responsável —</option>';
  _resps.forEach(u => {
    if (!u.login || seen.has(u.login)) return;
    seen.add(u.login);
    const lbl = u.name ? `${u.name} · ${u.login}` : u.login;
    opts += `<option value="${esc(u.login)}"${cur === u.login ? ' selected' : ''}>${esc(lbl)}</option>`;
  });
  if (cur && !seen.has(cur)) opts += `<option value="${esc(cur)}" selected>${esc(cur)} (atual)</option>`;
  return opts;
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
        <div style="flex:1"><label class="tiny muted">Responsável (login)</label>
          <select id="cr-f-resp" class="select">${respOptions(c.responsavel || '')}</select></div>
      </div>
      <label class="tiny muted">📅 Cronograma da demanda</label>
      <div class="flex gap-2" style="margin-bottom:10px;margin-top:3px">
        <div style="flex:1"><label class="tiny muted">▶ Início</label>
          <input id="cr-f-inicio" class="input" type="date" value="${c.data_inicio ? String(c.data_inicio).substring(0,10) : ''}"></div>
        <div style="flex:1"><label class="tiny muted">📦 Entrega</label>
          <input id="cr-f-entrega" class="input" type="date" value="${c.data_entrega ? String(c.data_entrega).substring(0,10) : (c.data_ref ? String(c.data_ref).substring(0,10) : '')}"></div>
        <div style="flex:1"><label class="tiny muted">📣 Post</label>
          <input id="cr-f-post" class="input" type="date" value="${c.data_post ? String(c.data_post).substring(0,10) : ''}"></div>
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
      data_inicio: g('inicio') || null,
      data_entrega: g('entrega') || null,
      data_post: g('post') || null,
      data_ref: g('entrega') || null,   // espelha a Entrega (prazo) → mantém alerta/Agenda
      link: g('link').trim(),
      obs: g('obs').trim(),
      status: g('status'),
      checklist,                     // brief estruturado
    };
    if (!body.titulo) { ov.querySelector('#cr-f-titulo').focus(); return; }
    ov.querySelector('#cr-save').disabled = true;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body }); ov.remove(); await loadSolicitacoes(); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#cr-save').disabled = false; }
  };
  ov.querySelector('#cr-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este pedido de criativo?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await loadSolicitacoes(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#cr-f-titulo')?.focus(), 50);
}

/* ════════════════════════════════════════════════════════════════════════
   ABA DOWNLOAD — biblioteca de criativos PRONTOS (board=criativos_lib)
   O marketing anexa o link do Drive; o corretor vê a prévia renderizada e
   baixa. Cada item: nome, formato, ativo/inativo em campanha, link Drive.
   Render do Drive: thumbnail nativo (drive.google.com/thumbnail?id=…). v81.43
═══════════════════════════════════════════════════════════════════════════ */
// pasta do Drive (não tem prévia/baixar de arquivo único)
const driveFolderId = url => { const m = String(url || '').match(/\/folders\/([-\w]{15,})/); return m ? m[1] : ''; };
// FILE_ID de um ARQUIVO do Drive (retorna '' se for pasta)
const driveFileId = url => {
  const s = String(url || '');
  if (driveFolderId(s)) return '';
  const m = s.match(/\/file\/d\/([-\w]{15,})/) || s.match(/\/d\/([-\w]{15,})/) || s.match(/[?&]id=([-\w]{15,})/) || s.match(/([-\w]{25,})/);
  return m ? m[1] : '';
};
const driveThumb = id => id ? `https://drive.google.com/thumbnail?id=${id}&sz=w800` : '';
const driveEmbed = id => id ? `https://drive.google.com/file/d/${id}/preview` : '';   // renderiza imagem E vídeo
const driveDownload = id => id ? `https://drive.google.com/uc?export=download&id=${id}` : '';
const driveView = (url, id) => id ? `https://drive.google.com/file/d/${id}/view` : (url || '#');
const isAtivo = c => (c.status || 'ativo') !== 'inativo';

async function loadLib() {
  body().innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando biblioteca…</div></div>';
  try {
    const r = await api.request('/api/v3/paulo/cards?board=' + _boardLib);
    if (r && r.pending) { body().innerHTML = `<div class="alert alert-err">Tabela ainda não criada.</div>`; return; }
    _lib = (r && r.cards) || [];
  } catch (e) {
    body().innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  renderDownload();
}

function libFiltered() {
  const conquista = _isConquista();
  return _lib.filter(c => {
    const cat = c.plataforma || '';
    // Conquista: SÓ a categoria Conquista. Gestão/demais: a aba ativa + os sem
    // categoria (aparecem em todas as abas pra serem categorizados). v81.61
    if (conquista) { if (cat !== 'Conquista') return false; }
    else if (cat !== _libCat && cat !== '') return false;
    return (_fLibFmt === '' || (c.formato || '') === _fLibFmt) &&
      (_fLibStatus === '' || (isAtivo(c) ? 'ativo' : 'inativo') === _fLibStatus);
  });
}

function renderDownload() {
  const cats = _isConquista() ? ['Conquista'] : LIB_CATS;   // Conquista vê só a aba Conquista
  if (!cats.includes(_libCat)) _libCat = cats[0];
  const list = libFiltered();
  const nAtivos = list.filter(isAtivo).length;
  body().innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">⬇️ Criativos para Download</div>
        <div class="tiny muted">Criativos prontos do marketing — veja a prévia e baixe pelo Drive.${_canEdit ? ' Anexe novos pelo link do Drive.' : ''}</div>
      </div>
      ${_canEdit ? `<button class="btn btn-primary" id="lib-new">+ Anexar criativo</button>` : ''}
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;border-bottom:2px solid var(--border,#e2e8f0);padding-bottom:8px;margin-bottom:12px">
      ${cats.map(cat => `<button class="btn btn-sm ${cat === _libCat ? '' : 'btn-ghost'}" data-libcat="${esc(cat)}" style="${cat === _libCat ? 'background:#d6249f;color:#fff;border-color:#d6249f' : ''}">${esc(cat)} <span class="tiny" style="opacity:.7">(${_lib.filter(c => (c.plataforma || '') === cat).length})</span></button>`).join('')}
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
      <div><label class="tiny muted">Formato</label>
        <select id="lib-ffmt" class="select"><option value="">Todos os formatos</option>${TIPOS.map(t => `<option value="${esc(t)}"${_fLibFmt === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div><label class="tiny muted">Status em campanha</label>
        <select id="lib-fstatus" class="select"><option value="">Todos</option><option value="ativo"${_fLibStatus === 'ativo' ? ' selected' : ''}>🟢 Ativos</option><option value="inativo"${_fLibStatus === 'inativo' ? ' selected' : ''}>⚪ Inativos</option></select></div>
      <span class="tiny muted" style="margin-left:auto;align-self:center">${_lib.length} criativo(s) · ${nAtivos} ativo(s)</span>
    </div>
    ${!list.length
      ? `<div class="card muted tiny" style="text-align:center;padding:34px">${_lib.length ? 'Nenhum criativo com esse filtro.' : 'Biblioteca vazia.' + (_canEdit ? ' Clique em <b>+ Anexar criativo</b> e cole o link do Drive.' : ' O marketing ainda não anexou criativos.')}</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">${list.map(libCard).join('')}</div>`}`;
  bindDownload();
}

function libCard(c) {
  const fid = driveFileId(c.link);
  const folder = driveFolderId(c.link);
  const ativo = isAtivo(c);
  const fcor = TIPO_COR[c.formato] || '#64748b';
  // mídia: arquivo → thumbnail (no erro vira embed que renderiza imagem/vídeo); pasta/sem link → placeholder
  let media;
  if (fid) {
    media = `<img src="${esc(driveThumb(fid))}" loading="lazy" referrerpolicy="no-referrer" alt="${esc(c.titulo || '')}" style="width:100%;height:100%;object-fit:cover"
              onerror="this.style.display='none';var f=this.parentNode.querySelector('iframe');if(f){if(!f.src)f.src=f.dataset.src;f.style.display='block';}">
             <iframe data-src="${esc(driveEmbed(fid))}" referrerpolicy="no-referrer" allow="autoplay" loading="lazy" style="display:none;width:100%;height:100%;border:0"></iframe>`;
  } else {
    const ph = folder ? ['📁', 'isto é uma PASTA<br>cole o link do arquivo'] : ['🔗', 'sem link de arquivo'];
    media = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#94a3b8;font-size:36px;flex-direction:column;gap:6px;text-align:center;padding:0 8px"><span>${ph[0]}</span><span style="font-size:10px;line-height:1.3">${ph[1]}</span></div>`;
  }
  return `
    <div style="background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06);display:flex;flex-direction:column">
      <div style="position:relative;aspect-ratio:4/5;background:#0f172a;display:flex;align-items:center;justify-content:center;overflow:hidden">
        ${media}
        <span style="position:absolute;top:8px;left:8px;background:${ativo ? '#16a34a' : 'rgba(100,116,139,.92)'};color:#fff;font-size:10px;font-weight:800;padding:3px 9px;border-radius:999px;pointer-events:none">${ativo ? '🟢 ATIVO' : '⚪ INATIVO'}</span>
        ${_canEdit ? `<button class="lib-edit" data-id="${esc(c.id)}" title="Editar" style="position:absolute;top:6px;right:6px;background:rgba(15,23,42,.6);color:#fff;border:none;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:13px;z-index:2">✏️</button>` : ''}
      </div>
      <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;flex:1">
        <div style="font-weight:800;font-size:13px;line-height:1.3">${esc(c.titulo || 'Sem nome')}</div>
        ${c.formato ? `<span class="cr-chip" style="align-self:flex-start;background:${fcor}1f;color:${fcor}">${esc(c.formato)}</span>` : ''}
        <div class="flex gap-2" style="margin-top:auto">
          ${fid
            ? `<a class="btn btn-primary tiny" href="${esc(driveDownload(fid))}" target="_blank" rel="noopener" style="flex:1;text-align:center">⬇️ Baixar</a>
               <a class="btn btn-ghost tiny" href="${esc(driveView(c.link, fid))}" target="_blank" rel="noopener" title="Abrir no Drive">👁</a>`
            : (c.link ? `<a class="btn btn-ghost tiny" href="${esc(c.link)}" target="_blank" rel="noopener" style="flex:1;text-align:center">${folder ? '📁 Abrir pasta' : '🔗 Abrir link'}</a>` : '<span class="tiny muted">sem link</span>')}
        </div>
      </div>
    </div>`;
}

function bindDownload() {
  body().querySelectorAll('[data-libcat]').forEach(b => b.onclick = () => { _libCat = b.dataset.libcat; renderDownload(); });
  const ff = body().querySelector('#lib-ffmt'); if (ff) ff.onchange = () => { _fLibFmt = ff.value; renderDownload(); };
  const fs = body().querySelector('#lib-fstatus'); if (fs) fs.onchange = () => { _fLibStatus = fs.value; renderDownload(); };
  const nw = body().querySelector('#lib-new'); if (nw) nw.onclick = () => openLibEditor(null);
  body().querySelectorAll('.lib-edit').forEach(b => b.onclick = e => { e.stopPropagation(); openLibEditor(_lib.find(c => c.id === b.dataset.id)); });
}

function openLibEditor(c0) {
  const c = c0 || { status: 'ativo' };
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  // prévia ao vivo: arquivo → embed (renderiza imagem/vídeo); pasta → aviso; vazio → nada
  const prev = url => {
    const fid = driveFileId(url), folder = driveFolderId(url);
    if (fid) return `<iframe src="${driveEmbed(fid)}" referrerpolicy="no-referrer" allow="autoplay" style="width:100%;height:220px;border:0;border-radius:8px;margin-top:8px;background:#0f172a"></iframe>`;
    if (folder) return `<div class="alert alert-warn" style="margin-top:8px;font-size:12px">📁 Isso é um link de <b>PASTA</b>. Cole o link de um <b>arquivo</b> (vídeo/imagem) — botão direito no arquivo → <b>Compartilhar → Copiar link</b>.</div>`;
    return '';
  };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:480px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? '✏️ Editar criativo' : '⬇️ Anexar criativo pra download'}</div>
      <label class="tiny muted">Nome do criativo *</label>
      <input id="lb-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex.: Carrossel MCMV — Junho" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Formato</label>
          <select id="lb-fmt" class="select"><option value="">—</option>${TIPOS.map(t => `<option value="${esc(t)}"${c.formato === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Status em campanha</label>
          <select id="lb-status" class="select"><option value="ativo"${isAtivo(c) ? ' selected' : ''}>🟢 Ativo</option><option value="inativo"${!isAtivo(c) ? ' selected' : ''}>⚪ Inativo</option></select></div>
      </div>
      <label class="tiny muted">Categoria (equipe) — define em qual aba aparece</label>
      <select id="lb-cat" class="select" style="margin-bottom:10px"><option value="">— sem categoria (aparece em todas) —</option>${LIB_CATS.map(cat => `<option value="${esc(cat)}"${(c.plataforma || '') === cat ? ' selected' : ''}>${esc(cat)}</option>`).join('')}</select>
      <label class="tiny muted">🔗 Link do <b>ARQUIVO</b> no Google Drive *</label>
      <input id="lb-link" class="input" value="${esc(c.link || '')}" placeholder="https://drive.google.com/file/d/.../view">
      <div class="tiny muted" style="margin-top:4px">Use o link de um <b>arquivo</b> (não de pasta) e compartilhe como <b>qualquer pessoa com o link</b> — sem isso a prévia não renderiza.</div>
      <div id="lb-prev" style="text-align:center">${prev(c.link)}</div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="lb-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="lb-cancel">Cancelar</button><button class="btn btn-primary" id="lb-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#lb-cancel').onclick = () => ov.remove();
  // prévia ao vivo enquanto cola o link
  ov.querySelector('#lb-link').addEventListener('input', e => { ov.querySelector('#lb-prev').innerHTML = prev(e.target.value); });
  ov.querySelector('#lb-save').onclick = async () => {
    const titulo = ov.querySelector('#lb-titulo').value.trim();
    const link = ov.querySelector('#lb-link').value.trim();
    if (!titulo) { ov.querySelector('#lb-titulo').focus(); return; }
    const payload = { action: 'upsert', board: _boardLib, id: c.id || undefined, titulo, formato: ov.querySelector('#lb-fmt').value, status: ov.querySelector('#lb-status').value, link, plataforma: ov.querySelector('#lb-cat').value };
    ov.querySelector('#lb-save').disabled = true;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: payload }); ov.remove(); await loadLib(); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#lb-save').disabled = false; }
  };
  ov.querySelector('#lb-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este criativo da biblioteca de download?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await loadLib(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#lb-titulo')?.focus(), 50);
}

/* ════════════════════════════════════════════════════════════════════════
   📣 BIBLIOTECA DE ANÚNCIOS PSM (v81.61) — os anúncios que a PSM está rodando:
   CRIATIVO + COPY, pro corretor ver e usar. Abas por categoria (Conquista /
   MAP+Terceiros / Locação); corretor Conquista vê só Conquista. Curadoria do
   marketing (lvl≥3). paulo/cards board 'anuncios_psm' (plataforma=categoria, obs=copy).
═══════════════════════════════════════════════════════════════════════════ */
const _boardAnuncios = 'anuncios_psm';
let _anuncios = [], _anCat = 'Conquista', _fAnStatus = '';

export async function pageAnunciosPSM(ctx, root) {
  _root = root;
  _canEdit = (auth.user()?.lvl || 0) >= 3;
  root.innerHTML = `${STYLE}<div id="cr-body"><div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div></div>`;
  loadAnuncios();
}

async function loadAnuncios() {
  body().innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando anúncios…</div></div>';
  try {
    const [r, al, rp] = await Promise.all([
      api.request('/api/v3/paulo/cards?board=' + _boardAnuncios),
      getAdsLibrary(true).catch(() => ({})),
      getResourcePerms(true).catch(() => ({})),
    ]);
    if (r && r.pending) { body().innerHTML = `<div class="alert alert-err">Tabela ainda não criada.</div>`; return; }
    _anuncios = (r && r.cards) || [];
    _adsLib = al || {}; _adsPerms = rp || {};
  } catch (e) { body().innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return; }
  renderAnuncios();
}

// ── Seção: Bibliotecas de Anúncios do Meta (links por conta/categoria) ──────────
function adLibsSection() {
  const u = auth.user() || {};
  const isSocio = (u.lvl || 0) >= 10;
  const podeEditar = (u.lvl || 0) >= 3;   // marketing+ cura os links
  const visiveis = ADS_CATS.filter(([k]) => canSeeResource('ads_' + k, _adsPerms, u));
  if (!visiveis.length && !isSocio) return '';   // nada pra mostrar a este papel
  const cats = isSocio ? ADS_CATS : visiveis;    // sócio vê todas (e administra)
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div>
          <div style="font-size:16px;font-weight:800">📚 Bibliotecas de Anúncios do Meta</div>
          <div class="tiny muted">Veja o que cada conta está anunciando no Facebook/Instagram (Ad Library).${podeEditar ? ' Adicione quantos links quiser por conta.' : ''}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
        ${cats.map(([k, lbl]) => {
          const links = _adsLib[k] || [];
          const oculto = !canSeeResource('ads_' + k, _adsPerms, u);   // sócio vê, mas marca
          return `<div style="border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:12px;background:var(--bg-2)">
            <div class="flex items-center" style="justify-content:space-between;gap:6px;margin-bottom:8px">
              <div style="font-weight:800;font-size:13px">${lbl}${oculto ? ' <span class="tiny" style="color:#b45309">(oculto)</span>' : ''}</div>
              ${isSocio ? `<button class="btn btn-ghost btn-sm adl-perm" data-cat="${k}" data-lbl="${esc(lbl)}" title="Quem vê esta conta" style="padding:2px 7px">👁</button>` : ''}
            </div>
            ${links.length ? links.map(l => `<div class="flex items-center" style="gap:4px;margin-bottom:6px">
              <a href="${esc(l.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="flex:1;justify-content:flex-start;text-align:left;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📣 ${esc(l.titulo)}</a>
              ${podeEditar ? `<button class="adl-edit" data-cat="${k}" data-id="${esc(l.id)}" title="Editar" style="background:none;border:none;cursor:pointer;font-size:12px">✏️</button><button class="adl-del" data-cat="${k}" data-id="${esc(l.id)}" title="Remover" style="background:none;border:none;cursor:pointer;font-size:12px">🗑️</button>` : ''}
            </div>`).join('') : '<div class="tiny muted" style="padding:4px 0 8px">— sem links —</div>'}
            ${podeEditar ? `<button class="btn btn-ghost btn-sm adl-add" data-cat="${k}" style="width:100%;margin-top:2px;border-style:dashed">+ Link</button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

async function adlAddEdit(cat, id) {
  const existing = id ? (_adsLib[cat] || []).find(l => l.id === id) : null;
  const titulo = prompt('Nome do link (ex.: "Conquista — página principal"):', existing ? existing.titulo : '');
  if (titulo === null) return;
  const url = prompt('Cole o link da Biblioteca de Anúncios do Meta\n(facebook.com/ads/library/...):', existing ? existing.url : '');
  if (url === null || !url.trim()) return;
  try { _adsLib = await saveAdsLink(cat, { id: id || undefined, titulo: titulo.trim(), url: url.trim() }); renderAnuncios(); }
  catch (e) { alert('Erro: ' + e.message); }
}
async function adlDel(cat, id) {
  if (!confirm('Remover este link?')) return;
  try { _adsLib = await deleteAdsLink(cat, id); renderAnuncios(); } catch (e) { alert('Erro: ' + e.message); }
}

function anFiltered() {
  const conquista = _isConquista();
  return _anuncios.filter(c => {
    const cat = c.plataforma || '';
    if (conquista) { if (cat !== 'Conquista') return false; }
    else if (cat !== _anCat && cat !== '') return false;
    return _fAnStatus === '' || (isAtivo(c) ? 'ativo' : 'inativo') === _fAnStatus;
  });
}

function renderAnuncios() {
  const cats = _isConquista() ? ['Conquista'] : LIB_CATS;
  if (!cats.includes(_anCat)) _anCat = cats[0];
  const list = anFiltered();
  body().innerHTML = `
    ${adLibsSection()}
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:20px;font-weight:800">📣 Anúncios da PSM (criativo + copy)</div>
        <div class="tiny muted">Os anúncios que a PSM está rodando — veja o criativo e copie a copy.${_canEdit ? ' Cadastre novos pelo botão.' : ''}</div>
      </div>
      ${_canEdit ? `<button class="btn btn-primary" id="an-new">+ Novo anúncio</button>` : ''}
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;border-bottom:2px solid var(--border,#e2e8f0);padding-bottom:8px;margin-bottom:12px">
      ${cats.map(cat => `<button class="btn btn-sm ${cat === _anCat ? '' : 'btn-ghost'}" data-ancat="${esc(cat)}" style="${cat === _anCat ? 'background:#d6249f;color:#fff;border-color:#d6249f' : ''}">${esc(cat)} <span class="tiny" style="opacity:.7">(${_anuncios.filter(c => (c.plataforma || '') === cat).length})</span></button>`).join('')}
      <select id="an-fstatus" class="select" style="margin-left:auto;max-width:150px"><option value="">Todos</option><option value="ativo"${_fAnStatus === 'ativo' ? ' selected' : ''}>🟢 No ar</option><option value="inativo"${_fAnStatus === 'inativo' ? ' selected' : ''}>⚪ Pausados</option></select>
    </div>
    ${!list.length
      ? `<div class="card muted tiny" style="text-align:center;padding:34px">${_anuncios.length ? 'Nenhum anúncio nesta aba.' : 'Nenhum anúncio cadastrado ainda.' + (_canEdit ? ' Clique em <b>+ Novo anúncio</b>.' : '')}</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">${list.map(anCard).join('')}</div>`}`;
  bindAnuncios();
}

function anMedia(c) {
  const fid = driveFileId(c.link), folder = driveFolderId(c.link);
  if (fid) return `<img src="${esc(driveThumb(fid))}" loading="lazy" referrerpolicy="no-referrer" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none';var f=this.parentNode.querySelector('iframe');if(f){if(!f.src)f.src=f.dataset.src;f.style.display='block';}"><iframe data-src="${esc(driveEmbed(fid))}" referrerpolicy="no-referrer" allow="autoplay" loading="lazy" style="display:none;width:100%;height:100%;border:0"></iframe>`;
  const ph = folder ? ['📁', 'isto é uma PASTA'] : ['📣', 'sem criativo'];
  return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#94a3b8;font-size:34px;flex-direction:column;gap:6px;text-align:center;padding:0 8px"><span>${ph[0]}</span><span style="font-size:10px">${ph[1]}</span></div>`;
}

function anCard(c) {
  const fid = driveFileId(c.link), ativo = isAtivo(c), cat = c.plataforma || '';
  const copy = c.obs || '';
  return `
    <div style="background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06);display:flex;flex-direction:column">
      <div style="position:relative;aspect-ratio:4/5;background:#0f172a;display:flex;align-items:center;justify-content:center;overflow:hidden">
        ${anMedia(c)}
        <span style="position:absolute;top:8px;left:8px;background:${ativo ? '#16a34a' : 'rgba(100,116,139,.92)'};color:#fff;font-size:10px;font-weight:800;padding:3px 9px;border-radius:999px">${ativo ? '🟢 NO AR' : '⚪ PAUSADO'}</span>
        ${_canEdit ? `<button class="an-edit" data-id="${esc(c.id)}" title="Editar" style="position:absolute;top:6px;right:6px;background:rgba(15,23,42,.6);color:#fff;border:none;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:13px;z-index:2">✏️</button>` : ''}
      </div>
      <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;flex:1">
        <div style="font-weight:800;font-size:13px;line-height:1.3">${esc(c.titulo || 'Sem nome')}</div>
        <div class="flex gap-1" style="flex-wrap:wrap">${cat ? `<span class="cr-chip" style="background:rgba(214,36,159,.12);color:#be185d">${esc(cat)}</span>` : ''}${c.formato ? `<span class="cr-chip" style="background:#64748b1f;color:#475569">${esc(c.formato)}</span>` : ''}</div>
        ${copy ? `<div style="font-size:11.5px;line-height:1.4;color:var(--ink-2,#475569);background:var(--bg-3,#f1f5f9);border-radius:8px;padding:8px 9px;max-height:120px;overflow:auto;white-space:pre-wrap">${esc(copy)}</div>
          <button class="btn btn-ghost tiny an-copybtn" data-copy="${esc(c.id)}">📋 Copiar copy</button>` : '<div class="tiny muted">Sem copy cadastrada.</div>'}
        <div class="flex gap-2" style="margin-top:auto">
          ${c.link ? `<a class="btn btn-primary tiny" href="${esc(fid ? driveView(c.link, fid) : c.link)}" target="_blank" rel="noopener" style="flex:1;text-align:center">👁 Ver criativo</a>${fid ? `<a class="btn btn-ghost tiny" href="${esc(driveDownload(fid))}" target="_blank" rel="noopener" title="Baixar">⬇️</a>` : ''}` : '<span class="tiny muted">sem link de criativo</span>'}
        </div>
      </div>
    </div>`;
}

function bindAnuncios() {
  // Bibliotecas do Meta (links por conta) — add/editar/remover + quem vê (sócio)
  body().querySelectorAll('.adl-add').forEach(b => b.onclick = () => adlAddEdit(b.dataset.cat, null));
  body().querySelectorAll('.adl-edit').forEach(b => b.onclick = () => adlAddEdit(b.dataset.cat, b.dataset.id));
  body().querySelectorAll('.adl-del').forEach(b => b.onclick = () => adlDel(b.dataset.cat, b.dataset.id));
  body().querySelectorAll('.adl-perm').forEach(b => b.onclick = () => openResourcePermsModal('ads_' + b.dataset.cat, 'Anúncios — ' + (b.dataset.lbl || b.dataset.cat), () => loadAnuncios()));
  body().querySelectorAll('[data-ancat]').forEach(b => b.onclick = () => { _anCat = b.dataset.ancat; renderAnuncios(); });
  const fs = body().querySelector('#an-fstatus'); if (fs) fs.onchange = () => { _fAnStatus = fs.value; renderAnuncios(); };
  const nw = body().querySelector('#an-new'); if (nw) nw.onclick = () => openAnEditor(null);
  body().querySelectorAll('.an-edit').forEach(b => b.onclick = () => openAnEditor(_anuncios.find(c => c.id === b.dataset.id)));
  body().querySelectorAll('.an-copybtn').forEach(b => b.onclick = () => {
    const c = _anuncios.find(x => x.id === b.dataset.copy);
    if (c && navigator.clipboard) navigator.clipboard.writeText(c.obs || '').then(() => { b.textContent = '✓ Copiado'; setTimeout(() => b.textContent = '📋 Copiar copy', 1500); }).catch(() => {});
  });
}

function openAnEditor(c0) {
  const c = c0 || { status: 'ativo' };
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto';
  const prev = url => { const fid = driveFileId(url); return fid ? `<iframe src="${driveEmbed(fid)}" referrerpolicy="no-referrer" allow="autoplay" style="width:100%;height:200px;border:0;border-radius:8px;margin-top:8px;background:#0f172a"></iframe>` : (driveFolderId(url) ? `<div class="alert alert-warn" style="margin-top:8px;font-size:12px">📁 Link de PASTA — cole o link de um ARQUIVO.</div>` : ''); };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:520px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);margin:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${c.id ? '✏️ Editar anúncio' : '📣 Novo anúncio'}</div>
      <label class="tiny muted">Nome do anúncio *</label>
      <input id="an-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex.: MCMV — Apto 2 quartos a partir de R$ X" style="margin-bottom:10px">
      <div class="flex gap-2" style="margin-bottom:10px">
        <div style="flex:1"><label class="tiny muted">Categoria (aba) *</label><select id="an-cat" class="select"><option value="">—</option>${LIB_CATS.map(cat => `<option value="${esc(cat)}"${(c.plataforma || '') === cat ? ' selected' : ''}>${esc(cat)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Formato</label><select id="an-fmt" class="select"><option value="">—</option>${TIPOS.map(t => `<option value="${esc(t)}"${c.formato === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Status</label><select id="an-status" class="select"><option value="ativo"${isAtivo(c) ? ' selected' : ''}>🟢 No ar</option><option value="inativo"${!isAtivo(c) ? ' selected' : ''}>⚪ Pausado</option></select></div>
      </div>
      <label class="tiny muted">🔗 Link do criativo no Drive (arquivo)</label>
      <input id="an-link" class="input" value="${esc(c.link || '')}" placeholder="https://drive.google.com/file/d/.../view">
      <div id="an-prev" style="text-align:center">${prev(c.link)}</div>
      <label class="tiny muted" style="margin-top:10px;display:block">📝 Copy do anúncio (texto)</label>
      <textarea id="an-copy" class="input" rows="5" placeholder="Cole aqui a copy/legenda do anúncio para o corretor usar…">${esc(c.obs || '')}</textarea>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="an-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="an-cancel">Cancelar</button><button class="btn btn-primary" id="an-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#an-cancel').onclick = () => ov.remove();
  ov.querySelector('#an-link').addEventListener('input', e => { ov.querySelector('#an-prev').innerHTML = prev(e.target.value); });
  ov.querySelector('#an-save').onclick = async () => {
    const titulo = ov.querySelector('#an-titulo').value.trim();
    if (!titulo) { ov.querySelector('#an-titulo').focus(); return; }
    const payload = { action: 'upsert', board: _boardAnuncios, id: c.id || undefined, titulo, plataforma: ov.querySelector('#an-cat').value, formato: ov.querySelector('#an-fmt').value, status: ov.querySelector('#an-status').value, link: ov.querySelector('#an-link').value.trim(), obs: ov.querySelector('#an-copy').value };
    ov.querySelector('#an-save').disabled = true;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: payload }); ov.remove(); await loadAnuncios(); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#an-save').disabled = false; }
  };
  ov.querySelector('#an-del').onclick = async () => {
    if (!c.id || !confirm('Excluir este anúncio da biblioteca?')) return;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'delete', id: c.id } }); ov.remove(); await loadAnuncios(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#an-titulo')?.focus(), 50);
}
