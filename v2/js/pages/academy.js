/* ============================================================================
   PSM-OS v2 — PSM Academy (academia interna · Diretoria)
   ----------------------------------------------------------------------------
   Biblioteca de treinamento PSM: trilhas, playbooks, scripts, vídeos e docs.
   Conteúdo REAL cadastrado pela diretoria (links Drive/YouTube ou texto inline).
   CRUD via /api/v3/diretoria/academy (upsert tolerante). Leitura p/ todos
   logados; edição p/ Gerência/Diretoria (lvl>=7).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _items = [], _editing = null, _pending = false;
let _fTrilha = '', _fTipo = '', _search = '';

const TIPOS = [
  { v: 'video',    ic: '🎥', lbl: 'Vídeo' },
  { v: 'curso',    ic: '🎓', lbl: 'Curso' },
  { v: 'playbook', ic: '📘', lbl: 'Playbook' },
  { v: 'script',   ic: '📝', lbl: 'Script' },
  { v: 'doc',      ic: '📄', lbl: 'Documento' },
  { v: 'link',     ic: '🔗', lbl: 'Link' },
];
const TIPO_MAP = Object.fromEntries(TIPOS.map(t => [t.v, t]));
const tipoIc = v => (TIPO_MAP[v] || TIPO_MAP.link).ic;
const tipoLbl = v => (TIPO_MAP[v] || TIPO_MAP.link).lbl;

// Trilhas sugeridas (estrutura, não dado fake — só preenchem o datalist)
const TRILHAS_SUG = [
  'Onboarding', 'Captação', 'Atendimento & SDR', 'Negociação', 'Locação',
  'Produtos & Lançamentos', 'Financiamento & MCMV', 'Marketing Pessoal',
  'Ferramentas PSM', 'Cultura PSM',
];
const CARGOS = [
  ['todos', 'Todos'], ['corretor', 'Corretor'], ['sdr', 'SDR'],
  ['lider', 'Líder'], ['gerente', 'Gerência'], ['marketing', 'Marketing'], ['backoffice', 'Backoffice'],
];
const NIVEIS = [['', '—'], ['iniciante', 'Iniciante'], ['intermediario', 'Intermediário'], ['avancado', 'Avançado']];
const NIVEL_COR = { iniciante: '#16a34a', intermediario: '#d97706', avancado: '#dc2626' };

const canEdit = () => (auth.user()?.lvl || 0) >= 7;

export async function pageAcademy(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 2) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Acesso restrito.</div>';
    return;
  }
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/diretoria/academy');
    _items = r.items || [];
    _pending = !!r.pending;
    renderList();
  } catch (e) {
    const b = document.getElementById('ac-list');
    if (b) b.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <style>
      .ac-card{background:var(--bg-1,#fff);border:1px solid var(--border);border-radius:12px;padding:13px 15px;transition:transform .12s,box-shadow .12s}
      .ac-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.10)}
      .ac-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;line-height:1.7}
      .ac-flt{padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:var(--bg-2);cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap}
      .ac-flt.on{background:var(--psm-gold,#d4a843);color:#0f172a;border-color:transparent}
    </style>
    <div class="card" style="margin-bottom:14px">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">🎓 PSM Academy</h2>
          <p class="card-sub">A universidade interna da PSM — trilhas, playbooks, scripts, vídeos e materiais de formação. Conteúdo curado pela diretoria.</p>
        </div>
        ${canEdit() ? `<button class="btn btn-primary" id="ac-new">➕ Novo conteúdo</button>` : ''}
      </div>
      <div id="ac-kpis" class="flex gap-3 mt-3" style="flex-wrap:wrap"></div>
      <div style="margin-top:12px">
        <input id="ac-search" class="input" placeholder="🔎 Buscar por título, descrição, tag…" style="width:100%;max-width:420px" />
      </div>
      <div id="ac-trilhas" class="flex gap-2 mt-2" style="flex-wrap:wrap;overflow-x:auto"></div>
      <div id="ac-tipos" class="flex gap-2 mt-2" style="flex-wrap:wrap"></div>
    </div>
    <div id="ac-list"></div>
    <div id="ac-modal"></div>
  `;
  document.getElementById('ac-search').addEventListener('input', e => { _search = e.target.value.toLowerCase(); renderList(); });
  if (canEdit()) document.getElementById('ac-new').addEventListener('click', () => { _editing = {}; openForm(); });
}

function renderList() {
  // KPIs
  const trilhas = [...new Set(_items.map(i => i.trilha || 'Geral'))];
  const porTipo = {};
  _items.forEach(i => { porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1; });
  const kpis = document.getElementById('ac-kpis');
  if (kpis) kpis.innerHTML = `
    ${kpiCard('📚 Conteúdos', _items.length, '#2563eb')}
    ${kpiCard('🛤 Trilhas', trilhas.length, '#16a34a')}
    ${kpiCard('🎥 Vídeos/Cursos', (porTipo.video || 0) + (porTipo.curso || 0), '#8b5cf6')}
    ${kpiCard('📝 Scripts/Playbooks', (porTipo.script || 0) + (porTipo.playbook || 0), '#d97706')}
  `;

  // filtros de trilha
  const ft = document.getElementById('ac-trilhas');
  if (ft) ft.innerHTML = trilhas.length ? [
    `<button class="ac-flt ${_fTrilha === '' ? 'on' : ''}" data-trilha="">Todas as trilhas</button>`,
    ...trilhas.sort().map(t => `<button class="ac-flt ${_fTrilha === t ? 'on' : ''}" data-trilha="${esc(t)}">${esc(t)}</button>`),
  ].join('') : '';
  ft && ft.querySelectorAll('[data-trilha]').forEach(b => b.addEventListener('click', () => { _fTrilha = b.dataset.trilha; renderList(); }));

  // filtros de tipo
  const fp = document.getElementById('ac-tipos');
  if (fp) fp.innerHTML = _items.length ? [
    `<button class="ac-flt ${_fTipo === '' ? 'on' : ''}" data-tipo="">Todos os tipos</button>`,
    ...TIPOS.filter(t => porTipo[t.v]).map(t => `<button class="ac-flt ${_fTipo === t.v ? 'on' : ''}" data-tipo="${t.v}">${t.ic} ${t.lbl}</button>`),
  ].join('') : '';
  fp && fp.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { _fTipo = b.dataset.tipo; renderList(); }));

  // lista filtrada
  const list = document.getElementById('ac-list');
  if (!list) return;

  if (_pending) {
    list.innerHTML = `<div class="alert alert-warn">⏳ A tabela da Academy ainda não foi criada — rode <code>supabase/sprint9_22_academy.sql</code> no Supabase. Você já pode usar a tela; o conteúdo passa a salvar depois disso.</div>`;
    return;
  }

  const filtered = _items.filter(i => {
    if (_fTrilha && (i.trilha || 'Geral') !== _fTrilha) return false;
    if (_fTipo && i.tipo !== _fTipo) return false;
    if (_search) {
      const hay = [i.titulo, i.descricao, i.tags, i.trilha, i.conteudo].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(_search)) return false;
    }
    return true;
  });

  if (!_items.length) {
    list.innerHTML = `
      <div class="card" style="text-align:center;padding:46px 22px">
        <div style="font-size:48px">🎓</div>
        <h3 style="margin:10px 0 4px">A Academy está pronta pra ser construída</h3>
        <p class="muted" style="max-width:520px;display:inline-block;margin:0 0 16px">Monte as trilhas de formação da PSM: onboarding, captação, negociação, locação, scripts de venda, playbooks e os vídeos do time. ${canEdit() ? 'Comece adicionando o primeiro conteúdo.' : 'A diretoria vai publicar os conteúdos aqui em breve.'}</p>
        ${canEdit() ? `<div><button class="btn btn-primary" id="ac-new2">➕ Adicionar primeiro conteúdo</button></div>` : ''}
      </div>`;
    const b2 = document.getElementById('ac-new2');
    if (b2) b2.addEventListener('click', () => { _editing = {}; openForm(); });
    return;
  }

  if (!filtered.length) {
    list.innerHTML = `<div class="card"><p class="muted" style="margin:0">Nenhum conteúdo com esse filtro.</p></div>`;
    return;
  }

  // agrupa por trilha
  const grupos = {};
  filtered.forEach(i => { (grupos[i.trilha || 'Geral'] = grupos[i.trilha || 'Geral'] || []).push(i); });
  const ordem = Object.keys(grupos).sort();

  list.innerHTML = ordem.map(tr => `
    <div class="card" style="margin-bottom:12px">
      <h3 class="card-title" style="font-size:15px">🛤 ${esc(tr)} <span class="tiny muted">· ${grupos[tr].length} conteúdo(s)</span></h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:10px">
        ${grupos[tr].sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).map(itemCard).join('')}
      </div>
    </div>
  `).join('');

  // binds
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    _editing = _items.find(x => x.id === b.dataset.edit); openForm();
  }));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); del(b.dataset.del);
  }));
  list.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); viewContent(b.dataset.view);
  }));
}

function itemCard(i) {
  const nivel = i.nivel ? `<span class="ac-chip" style="background:${NIVEL_COR[i.nivel] || '#64748b'}1f;color:${NIVEL_COR[i.nivel] || '#64748b'}">${esc(i.nivel)}</span>` : '';
  const cargo = (i.cargo && i.cargo !== 'todos') ? `<span class="ac-chip" style="background:rgba(37,99,235,.12);color:#2563eb">👤 ${esc(i.cargo)}</span>` : '';
  const dur = i.duracao ? `<span class="ac-chip" style="background:rgba(148,163,184,.16)">⏱ ${esc(i.duracao)}</span>` : '';
  const hasContent = !!(i.conteudo && i.conteudo.trim());
  return `
    <div class="ac-card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="font-weight:800;font-size:13.5px;line-height:1.3">${tipoIc(i.tipo)} ${esc(i.titulo)}</div>
        ${canEdit() ? `<div class="flex gap-1" style="flex-shrink:0">
          <button class="btn btn-ghost btn-sm" data-edit="${esc(i.id)}" title="Editar" style="padding:2px 7px">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(i.id)}" title="Excluir" style="padding:2px 7px">🗑</button>
        </div>` : ''}
      </div>
      ${i.descricao ? `<div class="tiny muted" style="margin-top:5px;line-height:1.45">${esc(i.descricao)}</div>` : ''}
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:8px">
        <span class="ac-chip" style="background:rgba(148,163,184,.14)">${tipoLbl(i.tipo)}</span>
        ${nivel}${cargo}${dur}
      </div>
      <div class="flex gap-2" style="margin-top:10px">
        ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="flex:1;text-align:center">▶ Abrir</a>` : ''}
        ${hasContent ? `<button class="btn btn-ghost btn-sm" data-view="${esc(i.id)}" style="flex:${i.url ? '0 0 auto' : '1'}">📖 Ler</button>` : ''}
        ${(!i.url && !hasContent) ? `<span class="tiny muted">sem link/conteúdo</span>` : ''}
      </div>
    </div>`;
}

/* ─── Ver conteúdo inline (script/playbook) ─── */
function viewContent(id) {
  const i = _items.find(x => x.id === id);
  if (!i) return;
  const modal = document.getElementById('ac-modal');
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:680px;width:100%;background:var(--bg-1);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${tipoIc(i.tipo)} ${esc(i.titulo)}</h3>
          <button class="btn btn-ghost btn-sm" id="ac-vx">✕</button>
        </div>
        ${i.descricao ? `<p class="card-sub">${esc(i.descricao)}</p>` : ''}
        <div style="white-space:pre-wrap;line-height:1.6;font-size:14px;background:var(--bg-3);border-radius:10px;padding:14px 16px;margin-top:10px">${esc(i.conteudo || '')}</div>
        ${i.url ? `<div style="margin-top:12px"><a href="${esc(i.url)}" target="_blank" rel="noopener" class="btn btn-primary">▶ Abrir link relacionado</a></div>` : ''}
      </div>
    </div>`;
  document.getElementById('ac-vx').addEventListener('click', () => { modal.innerHTML = ''; });
  modal.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) modal.innerHTML = ''; });
}

/* ─── Form (criar/editar) ─── */
function openForm() {
  const c = _editing || {};
  const modal = document.getElementById('ac-modal');
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:620px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${c.id ? '✏️ Editar' : '➕ Novo'} conteúdo</h3>
          <button class="btn btn-ghost btn-sm" id="ac-x">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          ${inp('af-titulo', 'Título', c.titulo, 'Ex.: Script de abordagem WhatsApp', '', '1/-1')}
          <div style="grid-column:1/-1">
            <label class="tiny muted" style="font-weight:700">Trilha</label>
            <input id="af-trilha" class="input" list="af-trilhas-dl" value="${esc(c.trilha || '')}" placeholder="Ex.: Captação" style="width:100%" />
            <datalist id="af-trilhas-dl">${TRILHAS_SUG.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
          </div>
          ${sel('af-tipo', 'Tipo', TIPOS.map(t => [t.v, t.ic + ' ' + t.lbl]), c.tipo || 'link')}
          ${sel('af-cargo', 'Público-alvo', CARGOS, c.cargo || 'todos')}
          ${sel('af-nivel', 'Nível', NIVEIS, c.nivel || '')}
          ${inp('af-duracao', 'Duração', c.duracao, 'Ex.: 12 min')}
          ${inp('af-url', 'Link (Drive / YouTube / URL)', c.url, 'https://…', '', '1/-1')}
          <div style="grid-column:1/-1">
            <label class="tiny muted" style="font-weight:700">Descrição</label>
            <textarea id="af-descricao" class="input" rows="2" style="width:100%" placeholder="Resumo curto do conteúdo">${esc(c.descricao || '')}</textarea>
          </div>
          <div style="grid-column:1/-1">
            <label class="tiny muted" style="font-weight:700">Conteúdo inline (script/playbook — opcional)</label>
            <textarea id="af-conteudo" class="input" rows="5" style="width:100%" placeholder="Cole aqui o script, roteiro ou playbook (texto). Aparece num leitor dentro do sistema.">${esc(c.conteudo || '')}</textarea>
          </div>
          ${inp('af-tags', 'Tags (vírgula)', c.tags, 'whatsapp, objeção, fechamento')}
          ${inp('af-ordem', 'Ordem', c.ordem, '0', 'number')}
        </div>
        <div id="af-err" class="tiny" style="color:#dc2626;margin-top:8px"></div>
        <div class="flex gap-2 mt-3" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="ac-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ac-save">${c.id ? 'Salvar' : 'Adicionar'}</button>
        </div>
      </div>
    </div>`;
  const close = () => { modal.innerHTML = ''; };
  document.getElementById('ac-x').addEventListener('click', close);
  document.getElementById('ac-cancel').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
  document.getElementById('ac-save').addEventListener('click', save);
}

async function save() {
  const g = id => document.getElementById(id);
  const titulo = g('af-titulo').value.trim();
  if (!titulo) { g('af-err').textContent = 'O título é obrigatório.'; return; }
  const payload = {
    id: (_editing && _editing.id) || undefined,
    titulo,
    trilha: g('af-trilha').value.trim() || 'Geral',
    tipo: g('af-tipo').value,
    cargo: g('af-cargo').value,
    nivel: g('af-nivel').value,
    duracao: g('af-duracao').value.trim(),
    url: g('af-url').value.trim(),
    descricao: g('af-descricao').value.trim(),
    conteudo: g('af-conteudo').value.trim(),
    tags: g('af-tags').value.trim(),
    ordem: parseInt(g('af-ordem').value || '0', 10) || 0,
  };
  const btn = g('ac-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const r = await api.request('/api/v3/diretoria/academy', { method: 'POST', body: payload });
    if (r && r.ok === false && r.pending) {
      g('af-err').textContent = r.error || 'Tabela ainda não criada — rode o SQL da Academy.';
      btn.disabled = false; btn.textContent = 'Adicionar';
      return;
    }
    document.getElementById('ac-modal').innerHTML = '';
    await load();
  } catch (e) {
    g('af-err').textContent = e.message || 'Erro ao salvar.';
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

async function del(id) {
  const i = _items.find(x => x.id === id);
  if (!confirm(`Excluir "${(i && i.titulo) || 'este conteúdo'}" da Academy?`)) return;
  try {
    await api.request('/api/v3/diretoria/academy?id=' + encodeURIComponent(id), { method: 'DELETE' });
    await load();
  } catch (e) { alert('Erro ao excluir: ' + e.message); }
}

/* ─── helpers ─── */
function kpiCard(label, n, color) {
  return `<div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:var(--r-md);padding:12px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">${label}</div>
    <div style="font-size:26px;font-weight:900;color:${color}">${n}</div></div>`;
}
function inp(id, label, val, ph = '', type = '', span = '') {
  return `<div${span ? ` style="grid-column:${span}"` : ''}>
    <label class="tiny muted" style="font-weight:700">${label}</label>
    <input id="${id}" class="input" ${type ? `type="${type}"` : ''} value="${esc(val ?? '')}" placeholder="${esc(ph)}" style="width:100%" />
  </div>`;
}
function sel(id, label, opts, cur) {
  return `<div>
    <label class="tiny muted" style="font-weight:700">${label}</label>
    <select id="${id}" class="input" style="width:100%">
      ${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}
    </select>
  </div>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
