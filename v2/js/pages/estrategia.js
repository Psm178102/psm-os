/* ============================================================================
   PSM-OS v2 — ESTRATÉGIA (central de planejamento · Diretoria)
   ----------------------------------------------------------------------------
   Aba com abas internas:
     🧠 Mapa Mental   — editor visual de nós (criar/arrastar/conectar/cor)
     🌳 Organograma   — mesmo editor, modo hierárquico (seed dos usuários reais)
     🗓️ Cronograma    — metas + objetivos por período, com status, responsável e observações
     🎯 OKRs          — reaproveita o componente de OKRs (mesmo backend)
   + 🤖 IA Estrategista — lê OKRs + metas + pipeline reais e sugere ajuste de rota

   Quadros visuais persistidos como JSON em /api/v3/diretoria/strategy.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { pageOKRs } from './okrs.js';
import { renderRecebiveis } from './recebiveis.js';

let _root = null;
let _tab = 'plano';

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#475569', '#d4a843'];
const TABS = [
  { id: 'plano', lbl: '🧭 Plano de Resgate' },
  { id: 'recebiveis', lbl: '💰 Radar de Recebíveis' },
  { id: 'mapa', lbl: '🧠 Mapa Mental' },
  { id: 'org', lbl: '🌳 Organograma' },
  { id: 'crono', lbl: '🗓️ Cronograma' },
  { id: 'okrs', lbl: '🎯 OKRs' },
];

export async function pageEstrategia(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Gerência/Diretoria.</div>';
    return;
  }
  const qtab = ctx && ctx.query && ctx.query.tab;
  if (qtab && TABS.some(t => t.id === qtab)) _tab = qtab;
  renderShell();
  await openTab(_tab);
}

function renderShell() {
  _root.innerHTML = `
    <style>
      .est-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
      .est-tab{padding:8px 14px;border-radius:10px 10px 0 0;border:1px solid var(--border);border-bottom:none;background:var(--bg-2);cursor:pointer;font-weight:700;font-size:13px;color:var(--ink-muted,#64748b)}
      .est-tab.on{background:var(--bg-1,#fff);color:var(--ink,#0f172a);box-shadow:0 -2px 0 var(--psm-gold,#d4a843) inset}
      .est-canvas{position:relative;width:100%;height:62vh;min-height:420px;overflow:auto;background:
        radial-gradient(circle, rgba(148,163,184,.20) 1px, transparent 1px) 0 0/22px 22px,
        var(--bg-3,#f1f5f9);border:1px solid var(--border);border-radius:0 10px 10px 10px}
      .est-stage{position:relative;width:2400px;height:1500px}
      .est-node{position:absolute;min-width:120px;max-width:210px;background:var(--bg-1,#fff);border:2px solid #2563eb;border-radius:12px;
        padding:8px 11px;font-size:12.5px;font-weight:700;box-shadow:0 2px 6px rgba(15,23,42,.12);cursor:grab;user-select:none;z-index:2}
      .est-node.sel{box-shadow:0 0 0 3px rgba(212,168,67,.55),0 6px 16px rgba(15,23,42,.18);z-index:3}
      .est-node .nlabel{outline:none;white-space:pre-wrap;word-break:break-word}
      .est-node[contenteditable]{cursor:text}
      .est-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--bg-1,#fff);border:1px solid var(--border);border-bottom:none;border-radius:10px 10px 0 0;padding:8px 10px}
      .est-sw{width:18px;height:18px;border-radius:50%;cursor:pointer;border:2px solid #fff;box-shadow:0 0 0 1px rgba(15,23,42,.15)}
      .crono-col{min-width:280px;max-width:320px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:10px}
    </style>
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">♟️ Estratégia</h2>
          <p class="card-sub">Planejamento da PSM — mapa mental, organograma, cronograma de metas/objetivos e OKRs. A bússola pra virar a maior do estado.</p>
        </div>
        <button class="btn btn-primary" id="est-ia">🤖 IA Estrategista</button>
      </div>
      <div class="est-tabs" id="est-tabbar">
        ${TABS.map(t => `<div class="est-tab ${t.id === _tab ? 'on' : ''}" data-tab="${t.id}">${t.lbl}</div>`).join('')}
      </div>
      <div id="est-content" style="margin-top:0"></div>
    </div>
    <div id="est-modal"></div>
  `;
  _root.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => openTab(el.dataset.tab)));
  document.getElementById('est-ia').addEventListener('click', iaEstrategista);
}

function setActiveTab() {
  _root.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('on', el.dataset.tab === _tab));
}

async function openTab(tab) {
  _tab = tab;
  setActiveTab();
  const c = document.getElementById('est-content');
  c.innerHTML = `<div class="card" style="border-radius:0 10px 10px 10px"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>`;
  if (tab === 'plano') { await renderPlanoResgate(c); return; }
  if (tab === 'recebiveis') { await renderRecebiveis(c); return; }
  if (tab === 'okrs') { await pageOKRs(null, c); return; }
  if (tab === 'crono') { await renderCronograma(c); return; }
  // mapa | org → editor de nós
  await renderBoard(c, tab === 'org' ? 'orgchart' : 'mindmap');
}

/* ════════════════════ EDITOR DE NÓS (mapa mental / organograma) ═══════════ */
let _ed = null; // estado do editor ativo

async function renderBoard(container, board) {
  let resp;
  try { resp = await api.request('/api/v3/diretoria/strategy?board=' + board); }
  catch (e) { container.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; return; }
  const data = resp.data || {};
  _ed = {
    board,
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    pending: !!resp.pending,
    sel: null,
    saveTimer: null,
    drag: null,
  };
  const isOrg = board === 'orgchart';
  container.innerHTML = `
    ${_ed.pending ? `<div class="alert alert-warn" style="margin:0 0 8px">⏳ Rode <code>supabase/sprint9_24_estrategia.sql</code> pra salvar este quadro.</div>` : ''}
    <div class="est-bar">
      <button class="btn btn-primary btn-sm" id="nd-add">➕ Nó</button>
      ${isOrg ? `<button class="btn btn-ghost btn-sm" id="nd-seed">👥 Puxar usuários</button>` : ''}
      <span style="width:1px;height:20px;background:var(--border)"></span>
      <span id="nd-selbar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1">
        <span class="tiny muted">Clique num nó pra editar · arraste pra mover · 2× clique edita o texto</span>
      </span>
      <button class="btn btn-ghost btn-sm" id="nd-save">💾 Salvar</button>
    </div>
    <div class="est-canvas" id="nd-canvas">
      <div class="est-stage" id="nd-stage">
        <svg id="nd-svg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1"></svg>
      </div>
    </div>
    <div class="tiny muted" style="margin-top:6px">${isOrg ? '🌳 Organograma: cada nó liga ao seu superior. Use "Puxar usuários" pra começar com o time real e depois conecte.' : '🧠 Mapa mental: ligue cada ideia à ideia-mãe (campo "Conecta a"). Salva automático.'}</div>
  `;
  document.getElementById('nd-add').addEventListener('click', () => addNode());
  const seedBtn = document.getElementById('nd-seed');
  if (seedBtn) seedBtn.addEventListener('click', seedOrg);
  document.getElementById('nd-save').addEventListener('click', () => saveBoard(true));
  // clique no vazio desseleciona
  document.getElementById('nd-canvas').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'nd-canvas' || e.target.id === 'nd-stage' || e.target.id === 'nd-svg') { _ed.sel = null; paintNodes(); }
  });
  paintNodes();
}

function addNode(seed) {
  const canvas = document.getElementById('nd-canvas');
  const sx = (canvas ? canvas.scrollLeft : 0) + 80 + Math.round(Math.random() * 60);
  const sy = (canvas ? canvas.scrollTop : 0) + 80 + Math.round(Math.random() * 60);
  const n = Object.assign({
    id: 'n_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    text: 'Nova ideia', x: sx, y: sy, color: PALETTE[_ed.nodes.length % PALETTE.length], parent: null,
  }, seed || {});
  _ed.nodes.push(n);
  _ed.sel = n.id;
  paintNodes();
  scheduleSave();
  return n;
}

function paintNodes() {
  const stage = document.getElementById('nd-stage');
  if (!stage) return;
  // remove nós antigos (mantém o svg)
  stage.querySelectorAll('.est-node').forEach(el => el.remove());
  for (const n of _ed.nodes) {
    const el = document.createElement('div');
    el.className = 'est-node' + (n.id === _ed.sel ? ' sel' : '');
    el.dataset.id = n.id;
    el.style.left = (n.x || 0) + 'px';
    el.style.top = (n.y || 0) + 'px';
    el.style.borderColor = n.color || '#2563eb';
    el.innerHTML = `<div class="nlabel">${esc(n.text || '')}</div>`;
    attachNode(el, n);
    stage.appendChild(el);
  }
  drawConnectors();
  renderSelBar();
}

function attachNode(el, n) {
  // duplo clique → editar texto
  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const lbl = el.querySelector('.nlabel');
    el.setAttribute('contenteditable', 'false');
    lbl.setAttribute('contenteditable', 'true');
    lbl.focus();
    const r = document.createRange(); r.selectNodeContents(lbl);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const finish = () => {
      lbl.removeAttribute('contenteditable');
      n.text = lbl.innerText.trim() || '—';
      lbl.innerText = n.text;
      scheduleSave();
    };
    lbl.addEventListener('blur', finish, { once: true });
    lbl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); lbl.blur(); } });
  });
  // drag
  el.addEventListener('pointerdown', (e) => {
    if (el.querySelector('.nlabel').getAttribute('contenteditable') === 'true') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const stage = document.getElementById('nd-stage');
    const rect = stage.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const ox = e.clientX - rect.left - (n.x || 0);
    const oy = e.clientY - rect.top - (n.y || 0);
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    const mv = (ev) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
      n.x = Math.max(0, ev.clientX - rect.left - ox);
      n.y = Math.max(0, ev.clientY - rect.top - oy);
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
      drawConnectors();
    };
    const up = (ev) => {
      el.releasePointerCapture(e.pointerId);
      el.style.cursor = 'grab';
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      if (!moved) { _ed.sel = n.id; paintNodes(); }
      else scheduleSave();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
}

function drawConnectors() {
  const svg = document.getElementById('nd-svg');
  const stage = document.getElementById('nd-stage');
  if (!svg || !stage) return;
  const byId = {};
  stage.querySelectorAll('.est-node').forEach(el => { byId[el.dataset.id] = el; });
  const center = (el, n) => ({ x: (n.x || 0) + el.offsetWidth / 2, y: (n.y || 0) + el.offsetHeight / 2 });
  let lines = '';
  for (const n of _ed.nodes) {
    if (!n.parent) continue;
    const cEl = byId[n.id], pNode = _ed.nodes.find(m => m.id === n.parent), pEl = byId[n.parent];
    if (!cEl || !pEl || !pNode) continue;
    const a = center(cEl, n), b = center(pEl, pNode);
    lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${n.color || '#94a3b8'}" stroke-width="2.5" stroke-opacity="0.55" />`;
  }
  svg.innerHTML = lines;
}

function renderSelBar() {
  const bar = document.getElementById('nd-selbar');
  if (!bar) return;
  const n = _ed.nodes.find(x => x.id === _ed.sel);
  if (!n) {
    bar.innerHTML = `<span class="tiny muted">Clique num nó pra editar · arraste pra mover · 2× clique edita o texto</span>`;
    return;
  }
  const others = _ed.nodes.filter(x => x.id !== n.id);
  bar.innerHTML = `
    <input id="nd-text" class="input" value="${esc(n.text || '')}" style="max-width:200px;height:30px;font-size:12px" />
    <span style="display:flex;gap:4px">${PALETTE.map(c => `<span class="est-sw" data-color="${c}" style="background:${c};${c === n.color ? 'outline:2px solid #0f172a' : ''}"></span>`).join('')}</span>
    <select id="nd-parent" class="input" style="max-width:170px;height:30px;font-size:12px">
      <option value="">${_ed.board === 'orgchart' ? 'Sem superior' : 'Sem conexão'}</option>
      ${others.map(o => `<option value="${esc(o.id)}"${n.parent === o.id ? ' selected' : ''}>${_ed.board === 'orgchart' ? '↳ ' : '→ '}${esc((o.text || '').slice(0, 24))}</option>`).join('')}
    </select>
    <button class="btn btn-ghost btn-sm" id="nd-del" style="color:var(--err)">🗑</button>
  `;
  document.getElementById('nd-text').addEventListener('input', e => { n.text = e.target.value; const el = document.querySelector(`.est-node[data-id="${cssesc(n.id)}"] .nlabel`); if (el) el.innerText = n.text; drawConnectors(); scheduleSave(); });
  bar.querySelectorAll('[data-color]').forEach(s => s.addEventListener('click', () => { n.color = s.dataset.color; paintNodes(); scheduleSave(); }));
  document.getElementById('nd-parent').addEventListener('change', e => {
    const v = e.target.value || null;
    if (v && createsCycle(n.id, v)) { alert('Essa conexão criaria um ciclo.'); e.target.value = n.parent || ''; return; }
    n.parent = v; drawConnectors(); scheduleSave();
  });
  document.getElementById('nd-del').addEventListener('click', () => {
    _ed.nodes = _ed.nodes.filter(x => x.id !== n.id);
    _ed.nodes.forEach(x => { if (x.parent === n.id) x.parent = null; });
    _ed.sel = null; paintNodes(); scheduleSave();
  });
}

function createsCycle(childId, newParentId) {
  let cur = newParentId, guard = 0;
  while (cur && guard++ < 999) {
    if (cur === childId) return true;
    cur = (_ed.nodes.find(n => n.id === cur) || {}).parent;
  }
  return false;
}

async function seedOrg() {
  if (_ed.nodes.length && !confirm('Isto adiciona os usuários ativos como nós (mantém os atuais). Continuar?')) return;
  let users = [];
  try {
    const r = await api.request('/api/v3/users/list').catch(() => api.request('/api/v2/users'));
    users = (r.users || r || []).filter(u => (u.status || 'ativo') === 'ativo');
  } catch (_) { alert('Não consegui carregar os usuários.'); return; }
  const TIER = { socio: 0, diretor: 0, gerente: 1, lider: 2, corretor: 3, marketing: 3, backoffice: 3, financeiro: 3 };
  const COR = { socio: '#d4a843', diretor: '#d4a843', gerente: '#7c3aed', lider: '#2563eb', corretor: '#16a34a' };
  const rowCount = {};
  users.forEach(u => {
    const tier = TIER[(u.role || 'corretor').toLowerCase()] ?? 3;
    rowCount[tier] = (rowCount[tier] || 0);
    addNode({ text: u.name || '—', x: 120 + rowCount[tier] * 200, y: 80 + tier * 150, color: COR[(u.role || '').toLowerCase()] || '#64748b' });
    rowCount[tier]++;
  });
  paintNodes();
  saveBoard(true);
}

function scheduleSave() {
  if (_ed.saveTimer) clearTimeout(_ed.saveTimer);
  _ed.saveTimer = setTimeout(() => saveBoard(false), 800);
}

async function saveBoard(explicit) {
  if (!_ed) return;
  const btn = document.getElementById('nd-save');
  if (explicit && btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: _ed.board, data: { nodes: _ed.nodes } } });
    if (r && r.ok === false && r.pending) { if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar'; } if (explicit) alert(r.error); return; }
    if (btn) { btn.disabled = false; btn.textContent = '✓ Salvo'; setTimeout(() => { if (btn) btn.textContent = '💾 Salvar'; }, 1200); }
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar'; } if (explicit) alert('Erro ao salvar: ' + e.message); }
}

/* ════════════════════ CRONOGRAMA ═════════════════════════════════════════ */
let _cr = null;

const CR_STATUS = {
  planejado: { lbl: 'Planejado', cor: '#64748b' },
  andamento: { lbl: 'Em andamento', cor: '#2563eb' },
  pausado: { lbl: 'Pausado', cor: '#a16207' },          // v84.96
  risco: { lbl: 'Em risco', cor: '#d97706' },
  concluido: { lbl: 'Concluído', cor: '#16a34a' },
  atrasado: { lbl: 'Atrasado', cor: '#dc2626' },
  excluido: { lbl: 'Excluído', cor: '#94a3b8' },        // v84.96 — soft, reversível
};
// v84.96 — fontes REAIS de progresso (medidas no servidor, mês/ano corrente)
const CR_FONTES = {
  '': '✍️ Manual (eu digito o %)',
  vgv_mes: '💰 VGV ganho no MÊS (R$)',
  vgv_ano: '💰 VGV ganho no ANO (R$)',
  corretores_conquista: '🧑‍💼 Corretores Conquista ativos',
  corretores_total: '🧑‍💼 Corretores ativos (todas as frentes)',
  captacoes_mes: '📥 Captações criadas no mês',
  leads_lp_mes: '🌐 Leads da LP no mês',
  recebiveis_mes: '🛟 R$ recebidos no mês (radar)',
};
let _crProg = {};        // id → {real, alvo, pct} vindo do crono_progress
let _crVerExcluidos = false;
function cronoPct(i) {
  if (i.status === 'excluido') return null;
  if (i.status === 'concluido') return 100;
  if (i.fonte && _crProg[i.id]) return _crProg[i.id].pct;
  const p = parseInt(i.progresso, 10);
  return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null;
}
function fmtReal(fonte, v) {
  if (v == null) return '—';
  return /vgv|recebiveis/.test(fonte) ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : String(Math.round(v));
}
const CR_PERIODOS = ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026', '2026', '2027', '2028'];

async function renderCronograma(container) {
  let resp;
  api.request('/api/v3/diretoria/crono_progress').then(r => {   // % real das fontes (não bloqueia o quadro)
    if (r && r.progresso) { _crProg = r.progresso; paintCronograma(container); }
  }).catch(() => {});
  try { resp = await api.request('/api/v3/diretoria/strategy?board=cronograma'); }
  catch (e) { container.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; return; }
  const data = resp.data || {};
  _cr = { items: Array.isArray(data.items) ? data.items : [], pending: !!resp.pending };
  paintCronograma(container);
}

function paintCronograma(container) {
  container = container || document.getElementById('est-content');
  const vivos = _cr.items.filter(i => i.status !== 'excluido');
  const excluidos = _cr.items.filter(i => i.status === 'excluido');
  const visiveis = _crVerExcluidos ? _cr.items : vivos;
  const periodos = [...new Set([...visiveis.map(i => i.periodo || 'Sem período')])];
  // ordena por CR_PERIODOS, desconhecidos no fim
  periodos.sort((a, b) => (CR_PERIODOS.indexOf(a) + 1 || 99) - (CR_PERIODOS.indexOf(b) + 1 || 99));
  const metas = vivos.filter(i => i.tipo === 'meta').length;
  const objs = vivos.filter(i => i.tipo !== 'meta').length;
  // v84.96 — % médio atingido (itens vivos com % conhecido; concluído = 100)
  const media = arr => { const ps = arr.map(cronoPct).filter(p => p != null); return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null; };
  const pctMetas = media(vivos.filter(i => i.tipo === 'meta'));
  const pctObjs = media(vivos.filter(i => i.tipo !== 'meta'));

  container.innerHTML = `
    <div class="card" style="border-radius:0 10px 10px 10px">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div class="flex gap-2" style="flex-wrap:wrap">
          <span class="cap-chip" style="background:rgba(37,99,235,.12);color:var(--info);padding:3px 10px;border-radius:999px;font-weight:700;font-size:12px">🎯 ${metas} meta(s)${pctMetas != null ? ` · <b>${pctMetas}%</b> atingido` : ''}</span>
          <span class="cap-chip" style="background:rgba(22,163,74,.12);color:var(--ok);padding:3px 10px;border-radius:999px;font-weight:700;font-size:12px">🚩 ${objs} objetivo(s)${pctObjs != null ? ` · <b>${pctObjs}%</b> atingido` : ''}</span>
          ${excluidos.length ? `<button class="btn btn-ghost btn-sm" id="cr-toggle-exc" style="font-size:11px">🗑 ${_crVerExcluidos ? 'ocultar' : 'ver'} excluídos (${excluidos.length})</button>` : ''}
        </div>
        <button class="btn btn-primary btn-sm" id="cr-new">➕ Novo item</button>
      </div>
      ${_cr.pending ? `<div class="alert alert-warn" style="margin-top:8px">⏳ Rode <code>supabase/sprint9_24_estrategia.sql</code> pra salvar o cronograma.</div>` : ''}
      ${!_cr.items.length ? `
        <div style="text-align:center;padding:40px 20px">
          <div style="font-size:42px">🗓️</div>
          <h3 style="margin:8px 0 4px">Monte o cronograma estratégico</h3>
          <p class="muted" style="max-width:480px;display:inline-block;margin:0">Adicione metas e objetivos por período (trimestre/ano), cada um com status, responsável e observações. Tudo num só lugar pra acompanhar a execução do plano.</p>
        </div>` : `
        <div class="flex" style="gap:12px;overflow-x:auto;margin-top:12px;padding-bottom:6px">
          ${periodos.map(p => cronoCol(p)).join('')}
        </div>`}
    </div>
  `;
  document.getElementById('cr-new').addEventListener('click', () => openCronoForm(null));
  const tex = document.getElementById('cr-toggle-exc');
  if (tex) tex.addEventListener('click', () => { _crVerExcluidos = !_crVerExcluidos; paintCronograma(container); });
  container.querySelectorAll('[data-cr-edit]').forEach(b => b.addEventListener('click', () => openCronoForm(_cr.items.find(i => i.id === b.dataset.crEdit))));
  container.querySelectorAll('[data-cr-del]').forEach(b => b.addEventListener('click', () => delCrono(b.dataset.crDel)));
  container.querySelectorAll('[data-cr-rest]').forEach(b => b.addEventListener('click', () => restCrono(b.dataset.crRest)));
}

function cronoCol(periodo) {
  const base = _crVerExcluidos ? _cr.items : _cr.items.filter(i => i.status !== 'excluido');
  const items = base.filter(i => (i.periodo || 'Sem período') === periodo);
  return `
    <div class="crono-col">
      <div style="font-weight:800;font-size:13px;margin-bottom:8px">📅 ${esc(periodo)} <span class="tiny muted">· ${items.length}</span></div>
      <div style="display:grid;gap:8px">
        ${items.map(cronoCard).join('')}
      </div>
    </div>`;
}

function cronoCard(i) {
  const st = CR_STATUS[i.status] || CR_STATUS.planejado;
  const isMeta = i.tipo === 'meta';
  return `
    <div style="background:var(--bg-1,#fff);border:1px solid var(--border);border-left:4px solid ${st.cor};border-radius:10px;padding:10px 12px">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="font-weight:800;font-size:13px;line-height:1.25">${isMeta ? '🎯' : '🚩'} ${esc(i.titulo)}</div>
        <div class="flex gap-1" style="flex-shrink:0">
          <button class="btn btn-ghost btn-sm" data-cr-edit="${esc(i.id)}" style="padding:1px 6px">✏️</button>
          ${i.status === 'excluido'
            ? `<button class="btn btn-ghost btn-sm" data-cr-rest="${esc(i.id)}" style="padding:1px 6px" title="restaurar">↩</button>`
            : `<button class="btn btn-ghost btn-sm" data-cr-del="${esc(i.id)}" style="padding:1px 6px" title="excluir (vai pra lixeira, reversível)">🗑</button>`}
        </div>
      </div>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:6px">
        <span style="background:${st.cor}1f;color:${st.cor};padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700">${st.lbl}</span>
        ${i.responsavel ? `<span style="background:rgba(148,163,184,.16);padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700">👤 ${esc(i.responsavel)}</span>` : ''}
        ${i.fonte ? `<span style="background:rgba(124,58,237,.12);color:var(--roxo);padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700" title="progresso medido automaticamente nesta fonte">🔗 auto</span>` : ''}
      </div>
      ${(() => {   /* v84.96 — barra de % (manual ou nutrida pela fonte) */
        const pct = cronoPct(i);
        if (pct == null && !i.fonte) return '';
        const pr = _crProg[i.id];
        const legenda = i.fonte
          ? (pr && pr.pct != null
              ? `${fmtReal(i.fonte, pr.real)} de ${fmtReal(i.fonte, pr.alvo)} — ${CR_FONTES[i.fonte] || i.fonte}`
              : (pr ? 'defina o ALVO no ✏️ pra medir' : 'medindo…'))
          : 'informado manualmente';
        const cor = pct == null ? '#94a3b8' : pct >= 100 ? '#16a34a' : pct >= 60 ? '#2563eb' : pct >= 30 ? '#d97706' : '#dc2626';
        return `<div style="margin-top:7px">
          <div class="flex" style="justify-content:space-between;font-size:10px;font-weight:700"><span style="color:${cor}">${pct != null ? pct + '%' : '—'}</span><span class="muted" style="font-weight:400">${legenda}</span></div>
          <div style="height:6px;background:var(--bg-3);border-radius:99px;margin-top:2px;overflow:hidden"><div style="height:100%;width:${pct || 0}%;background:${cor};border-radius:99px"></div></div>
        </div>`;
      })()}
      ${i.obs ? `<div class="tiny muted" style="margin-top:6px;white-space:pre-wrap;line-height:1.45;border-top:1px dashed var(--border);padding-top:6px">📝 ${esc(i.obs)}</div>` : ''}
    </div>`;
}

function openCronoForm(item) {
  const i = item || {};
  const modal = document.getElementById('est-modal');
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:560px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${i.id ? '✏️ Editar' : '➕ Novo'} item do cronograma</h3>
          <button class="btn btn-ghost btn-sm" id="cr-x">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">Título</label>
            <input id="cr-titulo" class="input" value="${esc(i.titulo || '')}" placeholder="Ex.: Abrir filial zona sul" style="width:100%" /></div>
          <div><label class="tiny muted" style="font-weight:700">Tipo</label>
            <select id="cr-tipo" class="input" style="width:100%">
              <option value="objetivo"${i.tipo !== 'meta' ? ' selected' : ''}>🚩 Objetivo</option>
              <option value="meta"${i.tipo === 'meta' ? ' selected' : ''}>🎯 Meta</option>
            </select></div>
          <div><label class="tiny muted" style="font-weight:700">Período</label>
            <input id="cr-periodo" class="input" list="cr-per-dl" value="${esc(i.periodo || 'Q1 2026')}" style="width:100%" />
            <datalist id="cr-per-dl">${CR_PERIODOS.map(p => `<option value="${p}">`).join('')}</datalist></div>
          <div><label class="tiny muted" style="font-weight:700">Status</label>
            <select id="cr-status" class="input" style="width:100%">
              ${Object.entries(CR_STATUS).map(([k, v]) => `<option value="${k}"${(i.status || 'planejado') === k ? ' selected' : ''}>${v.lbl}</option>`).join('')}
            </select></div>
          <div><label class="tiny muted" style="font-weight:700">Responsável</label>
            <input id="cr-resp" class="input" value="${esc(i.responsavel || '')}" placeholder="Nome" style="width:100%" /></div>
          <div style="grid-column:1/-1;border-top:1px dashed var(--border);padding-top:10px"><label class="tiny muted" style="font-weight:700">📈 Progresso — de onde vem o %?</label>
            <select id="cr-fonte" class="input" style="width:100%">
              ${Object.entries(CR_FONTES).map(([k, v]) => `<option value="${k}"${(i.fonte || '') === k ? ' selected' : ''}>${v}</option>`).join('')}
            </select>
            <div class="tiny muted" style="margin-top:2px">Fonte automática = o House mede sozinho (mês/ano corrente) e o card se atualiza. Manual = você digita.</div></div>
          <div id="cr-alvo-box" style="${(i.fonte || '') ? '' : 'display:none'}"><label class="tiny muted" style="font-weight:700">Alvo (número/R$)</label>
            <input id="cr-alvo" class="input" type="number" step="any" value="${i.alvo ?? ''}" placeholder="ex: 2100000 ou 8" style="width:100%" /></div>
          <div id="cr-prog-box" style="${(i.fonte || '') ? 'display:none' : ''}"><label class="tiny muted" style="font-weight:700">% atingido (manual)</label>
            <input id="cr-prog" class="input" type="number" min="0" max="100" value="${i.progresso ?? ''}" placeholder="0–100" style="width:100%" /></div>
          <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">Observações</label>
            <textarea id="cr-obs" class="input" rows="4" style="width:100%" placeholder="Notas, contexto, dependências, próximos passos…">${esc(i.obs || '')}</textarea></div>
        </div>
        <div id="cr-err" class="tiny" style="color:var(--err);margin-top:8px"></div>
        <div class="flex gap-2 mt-3" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="cr-cancel">Cancelar</button>
          <button class="btn btn-primary" id="cr-save">${i.id ? 'Salvar' : 'Adicionar'}</button>
        </div>
      </div>
    </div>`;
  const close = () => { modal.innerHTML = ''; };
  document.getElementById('cr-x').addEventListener('click', close);
  document.getElementById('cr-fonte').addEventListener('change', (e) => {
    const tem = !!e.target.value;
    document.getElementById('cr-alvo-box').style.display = tem ? '' : 'none';
    document.getElementById('cr-prog-box').style.display = tem ? 'none' : '';
  });
  document.getElementById('cr-cancel').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
  document.getElementById('cr-save').addEventListener('click', () => saveCrono(i));
}

async function saveCrono(i) {
  const titulo = document.getElementById('cr-titulo').value.trim();
  if (!titulo) { document.getElementById('cr-err').textContent = 'O título é obrigatório.'; return; }
  const obj = {
    id: i.id || ('c_' + Date.now().toString(36)),
    titulo,
    tipo: document.getElementById('cr-tipo').value,
    periodo: document.getElementById('cr-periodo').value.trim() || 'Sem período',
    status: document.getElementById('cr-status').value,
    responsavel: document.getElementById('cr-resp').value.trim(),
    obs: document.getElementById('cr-obs').value.trim(),
    fonte: document.getElementById('cr-fonte').value || null,
    alvo: document.getElementById('cr-alvo').value ? Number(document.getElementById('cr-alvo').value) : null,
    progresso: document.getElementById('cr-prog').value !== '' ? Math.max(0, Math.min(100, parseInt(document.getElementById('cr-prog').value, 10) || 0)) : null,
  };
  if (i.id) { const idx = _cr.items.findIndex(x => x.id === i.id); if (idx >= 0) _cr.items[idx] = obj; }
  else _cr.items.push(obj);
  const btn = document.getElementById('cr-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'cronograma', data: { items: _cr.items } } });
    if (r && r.ok === false && r.pending) { document.getElementById('cr-err').textContent = r.error; btn.disabled = false; btn.textContent = 'Adicionar'; return; }
    document.getElementById('est-modal').innerHTML = '';
    paintCronograma();
  } catch (e) { document.getElementById('cr-err').textContent = e.message; btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function delCrono(id) {
  const i = _cr.items.find(x => x.id === id);
  if (!confirm(`Excluir "${(i && i.titulo) || 'este item'}"?\n\nEle vai pra lixeira do quadro (dá pra restaurar em "ver excluídos").`)) return;
  if (i) i.status = 'excluido';   // v84.96 — soft-delete: some do quadro, mas NUNCA se perde
  try { await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'cronograma', data: { items: _cr.items } } }); }
  catch (e) { alert('Erro: ' + e.message); }
  paintCronograma();
}

async function restCrono(id) {
  const i = _cr.items.find(x => x.id === id);
  if (i) i.status = 'planejado';
  try { await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'cronograma', data: { items: _cr.items } } }); }
  catch (e) { alert('Erro: ' + e.message); }
  paintCronograma();
}

/* ════════════════════ IA ESTRATEGISTA ════════════════════════════════════ */
let _iaBusy = false;
async function iaEstrategista() {
  if (_iaBusy) return;
  _iaBusy = true;
  const modal = document.getElementById('est-modal');
  modal.innerHTML = wrapModal(`<div class="flex items-center gap-2"><span class="spinner"></span> Compilando OKRs, metas e pipeline e pedindo a leitura estratégica…</div>`);
  try {
    const [okrs, atg, ov] = await Promise.all([
      api.request('/api/v3/okrs/list').catch(() => ({ okrs: [] })),
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/metrics/overview').catch(() => ({})),
    ]);
    const prompt = buildIaPrompt(okrs.okrs || [], atg, ov);
    const j = await api.request('/api/v3/ia/analyze', { method: 'POST', body: { prompt, max_tokens: 3500, dossie: true } });   // cérebro novo (Sonnet 5 + dossiê) v84.4
    if (j.ok && j.text) {
      modal.innerHTML = wrapModal(`
        <div style="font-weight:800;color:var(--roxo);margin-bottom:8px">🤖 Leitura estratégica <span class="tiny muted" style="font-weight:400">· ${esc(j.model_used || 'IA')}</span></div>
        <div style="font-size:13.5px;line-height:1.6">${mdLite(j.text)}</div>`);
    } else {
      modal.innerHTML = wrapModal(`<div class="alert alert-warn">IA indisponível: ${esc(j.error || 'erro')}</div>`);
    }
  } catch (e) {
    modal.innerHTML = wrapModal(`<div class="alert alert-err">Erro: ${esc(e.message)}</div>`);
  } finally { _iaBusy = false; bindModalClose(); }
}

function buildIaPrompt(okrs, atg, ov) {
  const T = atg.totals || {}, s = (ov.sales || {});
  const okrTxt = okrs.length ? okrs.map(o => `- ${o.objetivo} (${o.ciclo}): ${(o.krs || []).map(k => `${k.label} ${k.pct || 0}%`).join('; ')}`).join('\n') : '(nenhum OKR cadastrado)';
  return `Você é o conselheiro estratégico da PSM Imóveis (imobiliária de alto padrão em expansão agressiva, meta de virar a maior do estado em 2-3 anos). Com base nos FATOS REAIS abaixo, faça uma leitura estratégica afiada pra diretoria. Não invente números além dos fatos.

== META ANUAL (RD) ==
Meta VGV ano: R$ ${num(T.meta_vgv)} · Realizado: R$ ${num(T.atingido_vgv)} (${T.vendas_count || 0} vendas) · ${pct(T.pct)}% da meta
Pipeline aberto: R$ ${num(s.pipeline_vgv)} (${s.pipeline_count || 0} negócios) · Perdas no mês: ${s.perdidos_mes || 0}

== OKRs ==
${okrTxt}

Escreva em português, markdown leve:
## Onde estamos (2-3 linhas, honesto)
## Maior alavanca agora (a aposta que mais move o ponteiro)
## Ajustes de rota (3 bullets concretos ligados aos OKRs/meta)
## Risco que pode descarrilar o plano`;
}

function wrapModal(inner) {
  return `<div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
    <div class="card" style="max-width:680px;width:100%;background:var(--bg-1);margin:auto">
      <div class="flex" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" id="est-ia-x">✕</button></div>
      ${inner}
    </div></div>`;
}
function bindModalClose() {
  const x = document.getElementById('est-ia-x');
  if (x) x.addEventListener('click', () => { document.getElementById('est-modal').innerHTML = ''; });
}

/* ─── helpers ─── */
function mdLite(t) {
  return esc(t)
    .replace(/^#### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^## (.*)$/gm, '<div style="font-weight:800;font-size:14px;margin:12px 0 4px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*\d+\.\s+(.*)$/gm, '<div style="margin:3px 0 3px 6px">▸ $1</div>')
    .replace(/^\s*[-*] (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}
function num(n) { return (Math.round(+n || 0)).toLocaleString('pt-BR'); }
function pct(n) { return (+n || 0).toFixed(1); }
function cssesc(s) { return String(s).replace(/"/g, '\\"'); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ════════════════════ 🧭 PLANO DE RESGATE (v84.19) ════════════════════════
   Documento-mestre jul→dez/2026 EDITÁVEL (shared_kv via backend) + checklist
   de cumprimento por mês + real vs plano com dados vivos do sistema. */
let _pr = null, _prSub = 'real';

const prEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prBrl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const prMi = n => 'R$ ' + (Number(n || 0) / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + 'M';
const prMd = s => prEsc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

async function renderPlanoResgate(c) {
  try {
    _pr = await api.request('/api/v3/diretoria/plano_resgate');
  } catch (e) {
    c.innerHTML = `<div class="card" style="border-radius:0 10px 10px 10px"><div class="alert alert-err">${prEsc(e.message)}</div></div>`;
    return;
  }
  prPaint(c);
}

function prBarra(lbl, real, meta, cor = '#16a34a') {
  const pct = meta ? Math.min(100, Math.round(100 * real / meta)) : 0;
  return `<div class="tiny" style="margin:5px 0">
    <div class="flex" style="justify-content:space-between"><span>${lbl}</span><b>${prMi(real)} / ${prMi(meta)} (${pct}%)</b></div>
    <div style="background:var(--bg-3);border-radius:6px;height:11px"><div style="width:${pct}%;background:${cor};height:11px;border-radius:6px"></div></div>
  </div>`;
}

function prPaint(c) {
  const p = _pr.plano || {}, r = _pr.real || {};
  const mesAtual = (p.meses || []).find(m => m.id === r.mes_id) || (p.meses || [])[0] || {};
  const subs = [['real', '📊 Real vs Plano'], ['check', '✅ Checklist'], ['doc', '📜 O Plano']];
  let corpo = '';

  const brief = _pr.briefing;
  const briefBox = brief && brief.texto ? `<div class="card" style="margin:0 0 8px;background:#7c3aed0d;border:1px dashed #7c3aed55">
    <div class="tiny"><b>📬 Briefing de segunda</b> <span class="muted">(${new Date(brief.ts).toLocaleDateString('pt-BR')} · ${prEsc(brief.provider || '')})</span></div>
    <div class="tiny mt-1" style="line-height:1.5">${prMd(brief.texto)}</div>
  </div>` : '';
  if (_prSub === 'real') {
    const vgvC = (r.vgv || {}).conquista || 0;
    const vgvP = ((r.vgv || {}).map || 0) + ((r.vgv || {}).terceiros || 0);
    const cts = p.constantes || {};
    const contrib = r.contribuicao || 0;
    const beOp = cts.breakeven_operacional || 70000, bePl = cts.breakeven_pleno || 100000;
    const pctBe = Math.min(100, Math.round(100 * contrib / bePl));
    /* 🎯 v2.3 — Amortecedor da Semana (regra do positivo) */
    const am = r.amortecedor;
    const amBox = am ? (() => {
      const cor = am.semaforo === 'verde' ? '#16a34a' : am.semaforo === 'amarelo' ? '#d97706' : '#dc2626';
      const emj = am.semaforo === 'verde' ? '🟢' : am.semaforo === 'amarelo' ? '🟡' : '🔴';
      return `<div class="card" style="margin:0 0 10px;border:2px solid ${cor};background:${cor}0d">
        <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <b>🎯 Amortecedor da Semana ${emj}</b>
          <span class="tiny muted">conta cheia do mês: <b>${prBrl(am.conta_cheia)}</b> ${am.conta_cheia_fonte === 'calculada' ? '(calculada dos custos orçados — fonte única)' : '(kv manual/fallback)'}</span>
        </div>
        <div style="font-size:26px;font-weight:900;color:${cor};margin:6px 0 2px">${am.falta_proprio > 0 ? 'Faltam ' + prBrl(am.falta_proprio) + ' de VGV próprio' : '✅ Mês coberto no ritmo atual'}</div>
        <div class="tiny">pra fechar o mês ≥ 0 · Conquista projetada no ritmo real: <b>${prBrl(am.contrib_conquista_projetada)}</b> de contribuição · próprio já vendido: <b>${prBrl(am.proprio_ja_vendido)}</b></div>
        <div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:170px;background:var(--bg-2);border-radius:8px;padding:6px 10px"><div class="tiny muted">📏 Régua Conquista</div><div style="font-weight:800">${prBrl(am.regua_conquista_sem)}/sem</div></div>
          <div style="flex:1;min-width:170px;background:var(--bg-2);border-radius:8px;padding:6px 10px"><div class="tiny muted">📏 Régua próprio (recalculada)</div><div style="font-weight:800;color:${cor}">${prBrl(am.regua_proprio_sem)}/sem</div></div>
        </div>
        <div class="tiny muted" style="margin-top:4px">Regra do Amortecedor: o que a Conquista não atingir vira meta própria de Paulo/Isa — recalculada toda segunda (push automático).</div>
        ${am.divergencia ? `<div class="tiny" style="color:var(--warn);font-weight:700;margin-top:4px">⚠️ kv manual (${prBrl(am.divergencia.kv_manual)}) ≠ calculado (${prBrl(am.divergencia.calculada)}) — o calculado manda; limpe/ajuste o kv na Viabilidade.</div>` : ''}
      </div>`;
    })() : '';
    corpo = amBox + briefBox + `
      <div class="tiny muted">Mês corrente: <b>${prEsc(mesAtual.nome || r.mes_id)}</b> · VGV = vendas GANHAS no CRM (win, mês do fechamento) · frentes pela Central de Frentes</div>
      ${prBarra('🏆 Conquista (equipe)', vgvC, mesAtual.conquista || 0, '#16a34a')}
      ${prBarra('🤝 VGV próprio (MAP + Terceiros)', vgvP, mesAtual.proprio || 0, '#2563eb')}
      <div class="tiny mt-2"><b>💰 Contribuição estimada do mês: ${prBrl(contrib)}</b> (Conquista ×${cts.margem_conquista_pct}% + próprio ×${cts.margem_proprio_pct}%)</div>
      ${r.caixa_recebido != null ? `<div class="tiny" style="margin-top:2px"><b>🏦 CAIXA do mês: recebido ${prBrl(r.caixa_recebido)}</b> de ${prBrl(r.caixa_previsto || 0)} previstos${(r.caixa_travado || 0) > 0 ? ` · <span style='color:var(--err);font-weight:800'>⛔ ${prBrl(r.caixa_travado)} travados</span>` : ''} — <span class="muted">competência ≠ caixa: o gap vendido×recebido</span></div>` : ''}
      <div style="background:var(--bg-3);border-radius:6px;height:14px;position:relative;margin:4px 0 2px">
        <div style="width:${pctBe}%;background:${contrib >= beOp ? '#16a34a' : '#d97706'};height:14px;border-radius:6px"></div>
        <div style="position:absolute;left:${Math.round(100 * beOp / bePl)}%;top:-3px;bottom:-3px;width:2px;background:#dc2626" title="break-even operacional"></div>
      </div>
      <div class="tiny muted">marco vermelho = break-even operacional ${prBrl(beOp)} · barra cheia = pleno ${prBrl(bePl)} (com pró-labore)</div>
      <div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">🔑 Locação: carteira</div><div style="font-weight:900;font-size:17px">${(r.locacao || {}).carteira || 0} <span class="tiny muted">(meta dez: ${cts.locacao_meta_dez || 27})</span></div></div>
        <div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">🔑 Contratos no mês</div><div style="font-weight:900;font-size:17px">${(r.locacao || {}).contratos_mes || 0}</div></div>
        <div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">📈 Vendas ganhas (mês)</div><div style="font-weight:900;font-size:17px">${Object.values(r.n_vendas || {}).reduce((a, b) => a + b, 0)}</div></div>
      </div>
      <div class="tiny muted mt-2">👁 Fiscalização no mês: ${Object.entries(r.fiscalizacao || {}).map(([k, ts]) =>
        `<b>${prEsc(k)}</b> ${Object.values(ts).reduce((a, b) => a + b, 0)} eventos`).join(' · ') || 'sem eventos ainda'}
        · <a href="#/fiscalizacao" style="color:var(--info)">abrir painel →</a></div>
      <div class="tiny mt-2" id="pr-ads"><span class="muted">💸 Semáforo de ads: carregando…</span></div>`;
  } else if (_prSub === 'check') {
    corpo = (p.meses || []).map(m => {
      const ck = p.checklist || {};
      const itens = (m.acoes || []).map((a, i) => {
        const chave = `${m.id}:acao:${i}`;
        const feito = ck[chave];
        return `<label class="tiny" style="display:flex;gap:7px;align-items:flex-start;padding:3px 0;cursor:pointer">
          <input type="checkbox" class="pr-ck" data-chave="${prEsc(chave)}" ${feito ? 'checked' : ''} style="margin-top:2px">
          <span style="${feito ? 'text-decoration:line-through;opacity:.55' : ''}">${prEsc(a)}${feito ? ` <span class="muted">✓ ${prEsc(feito.por || '')}</span>` : ''}</span>
        </label>`;
      }).join('');
      const gchave = `${m.id}:gate`;
      const gfeito = (p.checklist || {})[gchave];
      const done = (m.acoes || []).filter((a, i) => (p.checklist || {})[`${m.id}:acao:${i}`]).length;
      return `<div class="card" style="margin:0 0 8px;border-left:3px solid ${gfeito ? '#16a34a' : '#d4a843'}">
        <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
          <b>${prEsc(m.nome)}</b>
          <span class="tiny muted">Conquista ${prMi(m.conquista)} · próprio ${prMi(m.proprio)} · trilha ${prBrl(m.trilha_fin)}</span>
          <button class="btn btn-ghost btn-sm pr-editmes" data-mes="${prEsc(m.id)}" style="padding:1px 7px">✏️</button>
          <span style="margin-left:auto" class="tiny muted">${done}/${(m.acoes || []).length} ações</span>
        </div>
        ${itens}
        <label class="tiny" style="display:flex;gap:7px;align-items:flex-start;padding:5px 8px;margin-top:4px;background:${gfeito ? '#16a34a18' : '#d4a84318'};border-radius:8px;cursor:pointer">
          <input type="checkbox" class="pr-ck" data-chave="${prEsc(gchave)}" ${gfeito ? 'checked' : ''} style="margin-top:2px">
          <span><b>🚪 GATE:</b> ${prEsc(m.gate)}${gfeito ? ` <span class="muted">✓ ${prEsc(gfeito.por || '')}</span>` : ''}</span>
        </label>
      </div>`;
    }).join('') + `<div class="tiny muted">Regra 8: cada gate compra o direito do próximo mês — não pular etapa.</div>`;
  } else {
    corpo = (p.secoes || []).map(s => `
      <div class="card" style="margin:0 0 8px" id="pr-sec-${prEsc(s.id)}">
        <div class="flex items-center" style="gap:8px">
          <b>${prEsc(s.titulo)}</b>
          <button class="btn btn-ghost btn-sm pr-edit" data-sec="${prEsc(s.id)}" style="margin-left:auto;padding:1px 8px">✏️ editar</button>
        </div>
        <div class="tiny mt-1 pr-corpo" style="white-space:normal;line-height:1.55">${prMd(s.corpo)}</div>
      </div>`).join('');
  }

  c.innerHTML = `
    <div class="card" style="border-radius:0 10px 10px 10px">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <b style="font-size:15px">🧭 ${prEsc(p.titulo || 'Plano de Resgate')}</b>
        <span class="tiny muted">${prEsc(p.periodo || '')} · ${prEsc(p.versao || '')}</span>
      </div>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        ${subs.map(([id, lbl]) => `<button class="btn btn-sm ${_prSub === id ? 'btn-primary' : 'btn-ghost'} pr-sub" data-sub="${id}">${lbl}</button>`).join('')}
      </div>
      <div class="mt-2">${corpo}</div>
    </div>`;
  c.querySelectorAll('.pr-sub').forEach(b => b.onclick = () => { _prSub = b.dataset.sub; prPaint(c); });
  if (_prSub === 'real') prAds(c);
  c.querySelectorAll('.pr-ck').forEach(b => b.onchange = async () => {
    try {
      const r2 = await api.request('/api/v3/diretoria/plano_resgate', { method: 'POST', body: { action: 'toggle', chave: b.dataset.chave } });
      _pr.plano = r2.plano; prPaint(c);
    } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); prPaint(c); }
  });
  c.querySelectorAll('.pr-editmes').forEach(b => b.onclick = async () => {
    const m = (_pr.plano.meses || []).find(x => x.id === b.dataset.mes); if (!m) return;
    const cq = prompt(`Meta CONQUISTA de ${m.nome} (só números):`, m.conquista); if (cq === null) return;
    const pp = prompt(`Meta VGV PRÓPRIO de ${m.nome} (só números):`, m.proprio); if (pp === null) return;
    try {
      await api.request('/api/v3/diretoria/plano_resgate', { method: 'POST', body: { action: 'set_mes', id: m.id, campo: 'conquista', valor: Number(cq) } });
      const r2 = await api.request('/api/v3/diretoria/plano_resgate', { method: 'POST', body: { action: 'set_mes', id: m.id, campo: 'proprio', valor: Number(pp) } });
      _pr.plano = r2.plano; prPaint(c);
    } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
  });
  c.querySelectorAll('.pr-edit').forEach(b => b.onclick = () => {
    const s = (_pr.plano.secoes || []).find(x => x.id === b.dataset.sec); if (!s) return;
    const host = c.querySelector('#pr-sec-' + s.id + ' .pr-corpo');
    host.innerHTML = `<textarea class="input" style="width:100%;min-height:220px;font-size:12px" id="pr-ta">${prEsc(s.corpo)}</textarea>
      <div class="flex mt-1" style="gap:6px"><button class="btn btn-primary btn-sm" id="pr-save">💾 Salvar</button>
      <button class="btn btn-ghost btn-sm" id="pr-cancel">cancelar</button></div>`;
    host.querySelector('#pr-cancel').onclick = () => prPaint(c);
    host.querySelector('#pr-save').onclick = async () => {
      try {
        const r2 = await api.request('/api/v3/diretoria/plano_resgate', { method: 'POST', body: { action: 'set_secao', id: s.id, corpo: host.querySelector('#pr-ta').value } });
        _pr.plano = r2.plano; prPaint(c);
      } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
    };
  });
}

/* 💸 semáforo de ads do plano (global + por frente + por conta) — regra 9 */
async function prAds(c) {
  const host = c.querySelector('#pr-ads');
  if (!host) return;
  let a = null;
  try { a = await api.request('/api/v3/diretoria/plano_ads'); }
  catch (e) { host.innerHTML = `<span class="muted">💸 ads: ${prEsc(e.message)}</span>`; return; }
  if (a.erro_meta || !a.global) { host.innerHTML = `<span class="muted">💸 ads: sem dados do Meta (${prEsc(a.erro_meta || 'vazio')})</span>`; return; }
  const g = a.global;
  const cor = { '▲': '#16a34a', '⏸': '#d97706', '▼': '#dc2626', '—': '#64748b' };
  host.innerHTML = `
    <div style="background:var(--bg-3);border-radius:10px;padding:8px 10px">
      <b>💸 Semáforo de ads (mês)</b> — GLOBAL:
      <b style="color:${cor[g.farol]}">${g.farol} ROAS ${g.roas != null ? g.roas + '×' : '—'}</b>
      <span class="muted">(contribuição ${prBrl(g.contribuicao)} ÷ spend ${prBrl(g.spend)} · piso ${g.piso}×)</span>
      ${(a.frentes || []).length ? `<div class="mt-1">${a.frentes.map(f =>
        `<span style="margin-right:12px"><b style="color:${cor[f.farol]}">${f.farol}</b> ${prEsc(f.frente)}: ROAS ${f.roas != null ? f.roas + '×' : '—'} <span class="muted">(spend ${prBrl(f.spend)})</span></span>`).join('')}</div>` : ''}
      ${(a.contas || []).length ? `<div class="muted mt-1">Por conta: ${a.contas.map(ct =>
        `${prEsc(ct.nome)} ${prBrl(ct.spend)}${ct.frente ? ' (' + prEsc(ct.frente) + ')' : ''}`).join(' · ')}</div>` : ''}
      <div class="muted mt-1">▲ ≥2× pode subir · ⏸ 1–2× segura · ▼ &lt;1× corta e revê criativo/oferta. ROAS por frente é aproximado (conta→frente pelo nome); o número duro é o global.</div>
    </div>`;
}
