/* PSM-OS v2 — Academy · Produção (centro de construção da PSM Academy).
   Controla a CONSTRUÇÃO dos cursos: linha de curso × etapa de produção,
   com tema, roteiro, responsável e data de gravação. board=academy. v77.58 */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { CURRICULUM, NIVEIS } from './academy.js';   // ementa oficial (fonte única) — v84.8

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
// Checklist de produção (ordem do fluxo)
const CHECK = [
  { k: 'roteiro',  l: '📝 Roteiro pronto' },
  { k: 'cenario',  l: '🎥 Cenário / equipamento' },
  { k: 'gravado',  l: '🎬 Gravado' },
  { k: 'editado',  l: '✂️ Editado' },
  { k: 'thumb',    l: '🖼 Thumbnail / capa' },
  { k: 'legenda',  l: '💬 Legendas' },
  { k: 'seo',      l: '🔎 Título / descrição (SEO)' },
  { k: 'publicado',l: '🚀 Publicado' },
];
const checkDone = c => CHECK.filter(x => (c.checklist || {})[x.k]).length;

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
        <div class="tiny muted">Da ideia à postagem: briefing → gravação → edição → <b>publicar direto na trilha do aluno</b>.</div>
      </div>
      <div class="flex gap-2">
        ${(auth.user()?.lvl || 0) >= 7 ? '<button class="btn btn-ghost" id="as-import">📥 Importar ementa</button>' : ''}
        <button class="btn btn-primary" id="as-new">+ Nova aula</button>
      </div>
    </div>`;
}

function filtros() {
  const linhas = linhasDisponiveis(), resps = respsDisponiveis();
  return `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div class="as-tab ${_view === 'kanban' ? 'on' : ''}" data-view="kanban">🗂 Produção</div>
      <div class="as-tab ${_view === 'agenda' ? 'on' : ''}" data-view="agenda">📅 Agenda de Gravações</div>
      <div class="as-tab ${_view === 'metricas' ? 'on' : ''}" data-view="metricas">📊 Métricas</div>
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
  const body = _view === 'agenda' ? renderAgenda()
    : _view === 'metricas' ? renderMetricas()
    : `<div class="as-board">${STAGES.map(col).join('')}</div>`;
  _root.innerHTML = `${STYLE}${header()}${filtros()}${_view === 'metricas' ? '' : kpis()}${body}`;
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
        ${c.data_ref && c.data_ref < hoje() && c.status !== 'publicada' ? `<span class="as-chip" style="background:#dc262622;color:#dc2626">🔴 atrasada</span>` : ''}
      </div>
      ${(() => { const d = checkDone(c); return d ? `<div style="margin-top:7px"><div style="height:5px;border-radius:3px;background:rgba(148,163,184,.25);overflow:hidden"><div style="height:100%;width:${Math.round(d / CHECK.length * 100)}%;background:${d === CHECK.length ? '#16a34a' : '#7c3aed'}"></div></div><div class="tiny muted" style="margin-top:2px">✔ ${d}/${CHECK.length} produção</div></div>` : ''; })()}
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

/* ── MÉTRICAS: dashboard de produção da Academy ── */
function renderMetricas() {
  const f = filtered();
  if (!f.length) return coberturaCurriculo() + '<div class="muted tiny">Sem aulas no funil — use 📥 Importar ementa pra puxar o backlog oficial.</div>';
  const n = f.length;
  const pubTotal = f.filter(c => c.status === 'publicada').length;
  const pct = Math.round(pubTotal / n * 100);
  const agendadas = f.filter(c => c.data_ref && c.status !== 'publicada' && c.data_ref >= hoje()).length;
  const pubs = f.filter(c => c.status === 'publicada' && c.created_at && c.updated_at);
  let lead = '—';
  if (pubs.length) { const d = pubs.reduce((s, c) => s + Math.max(0, (new Date(c.updated_at) - new Date(c.created_at)) / 86400000), 0) / pubs.length; lead = Math.round(d) + 'd'; }
  const bar = (v, max, cor) => `<div style="height:8px;border-radius:4px;background:rgba(148,163,184,.2);overflow:hidden"><div style="height:100%;width:${max ? Math.round(v / max * 100) : 0}%;background:${cor}"></div></div>`;
  // por etapa
  const stg = STAGES.map(s => ({ s, n: f.filter(c => (c.status || 'ideia') === s.id).length }));
  const stgMax = Math.max(1, ...stg.map(x => x.n));
  // por linha
  const linhas = {}; f.forEach(c => { const l = c.plataforma || '(sem linha)'; (linhas[l] = linhas[l] || { tot: 0, pub: 0 }); linhas[l].tot++; if (c.status === 'publicada') linhas[l].pub++; });
  const linhasArr = Object.entries(linhas).sort((a, b) => b[1].tot - a[1].tot);
  // por responsável
  const resp = {}; f.forEach(c => { const r = c.responsavel || '(sem resp.)'; resp[r] = (resp[r] || 0) + 1; });
  const respArr = Object.entries(resp).sort((a, b) => b[1] - a[1]); const respMax = Math.max(1, ...respArr.map(x => x[1]));
  return `
    ${coberturaCurriculo()}
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="as-kpi"><div class="tiny muted">Total de aulas</div><div style="font-size:20px;font-weight:800">${n}</div></div>
      <div class="as-kpi"><div class="tiny muted">Publicadas</div><div style="font-size:20px;font-weight:800;color:#16a34a">${pubTotal} <span class="tiny muted">(${pct}%)</span></div></div>
      <div class="as-kpi"><div class="tiny muted">Lead-time médio</div><div style="font-size:20px;font-weight:800">${lead}</div><div class="tiny muted">ideia→publicada</div></div>
      <div class="as-kpi"><div class="tiny muted">🎬 Gravações agendadas</div><div style="font-size:20px;font-weight:800;color:#f59e0b">${agendadas}</div></div>
    </div>
    <div class="as-day">
      <div style="font-weight:800;font-size:14px;margin-bottom:8px">Funil de produção</div>
      ${stg.map(x => `<div style="margin-bottom:8px"><div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:700;color:${x.s.cor}">${x.s.lbl}</span><span class="tiny muted">${x.n}</span></div>${bar(x.n, stgMax, x.s.cor)}</div>`).join('')}
    </div>
    <div class="as-day">
      <div style="font-weight:800;font-size:14px;margin-bottom:8px">Progresso por linha de curso</div>
      ${linhasArr.map(([l, v]) => `<div style="margin-bottom:8px"><div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:700">${esc(l)}</span><span class="tiny muted">${v.pub}/${v.tot} publicadas</span></div>${bar(v.pub, v.tot, linhaCor(l))}</div>`).join('')}
    </div>
    <div class="as-day">
      <div style="font-weight:800;font-size:14px;margin-bottom:8px">Carga por responsável</div>
      ${respArr.map(([r, v]) => `<div style="margin-bottom:8px"><div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:700">👤 ${esc(r)}</span><span class="tiny muted">${v} aula${v === 1 ? '' : 's'}</span></div>${bar(v, respMax, '#7c3aed')}</div>`).join('')}
    </div>`;
}


/* ── 📥 IMPORTAR EMENTA → BACKLOG (v84.8): o currículo oficial vira cards de produção ── */
function openImportEmenta() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const jaTem = new Set(_cards.map(c => (c.titulo || '').trim().toLowerCase()));
  const conta = t => t.modulos.reduce((s, m) => s + m.aulas.length, 0);
  const novasDe = t => t.modulos.reduce((s, m) => s + m.aulas.filter(a => !jaTem.has(a.trim().toLowerCase())).length, 0);
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:520px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:16px;font-weight:800;margin-bottom:6px">📥 Importar ementa oficial → fila de produção</div>
      <div class="tiny muted" style="margin-bottom:10px">Cada aula do currículo vira um card em 💡 Ideia com o briefing pré-anotado (trilha/nível/módulo). Aulas que já existem no kanban são puladas.</div>
      <label class="tiny muted">Trilha</label>
      <select id="ie-trilha" class="select" style="width:100%">
        <option value="*">🌐 TODAS as trilhas (${CURRICULUM.reduce((s, t) => s + novasDe(t), 0)} aulas novas)</option>
        ${CURRICULUM.map(t => `<option value="${esc(t.trilha)}">${t.icon} ${esc(t.trilha)} — ${novasDe(t)} novas de ${conta(t)}</option>`).join('')}
      </select>
      <div class="flex gap-2 mt-3" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="ie-x">Cancelar</button>
        <button class="btn btn-primary" id="ie-go">Importar</button>
      </div>
      <div class="tiny" id="ie-msg" style="margin-top:6px"></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#ie-x').onclick = () => ov.remove();
  ov.querySelector('#ie-go').onclick = async () => {
    const sel = ov.querySelector('#ie-trilha').value;
    const trilhas = sel === '*' ? CURRICULUM : CURRICULUM.filter(t => t.trilha === sel);
    const cards = [];
    trilhas.forEach(t => t.modulos.forEach(m => m.aulas.forEach(a => {
      if (jaTem.has(a.trim().toLowerCase())) return;
      cards.push({
        titulo: a, status: 'ideia', plataforma: t.trilha, formato: 'Vídeo-aula',
        obs: `🧭 Trilha: ${t.trilha} · Nível: ${m.nivel} · Módulo: ${m.nome}\n(clique em ✍️ Gerar com IA pra criar o briefing completo)`,
      });
    })));
    const msg = ov.querySelector('#ie-msg');
    if (!cards.length) { msg.textContent = '✅ Nada novo — essa ementa já está toda no kanban.'; return; }
    msg.textContent = `⏳ importando ${cards.length} aulas…`;
    try {
      await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'bulk', board: 'academy', cards } });
      ov.remove(); await pageAcademyStudio(null, _root);
    } catch (e) { msg.textContent = '⚠️ ' + e.message; }
  };
}

/* ── 🚀 PUBLICAR NA ACADEMY (v84.8): o card publicado vira AULA na trilha do aluno ── */
const TIPO_MAP = { 'Vídeo-aula': 'video', 'Material / PDF': 'doc', 'Quiz': 'aula', 'Live': 'video', 'Exercício': 'aula' };
function metaDoCard(c) {
  const m = /🧭 Trilha: (.+?) · Nível: (.+?) · Módulo: (.+?)(\n|$)/.exec(c.obs || '');
  return m ? { trilha: m[1].trim(), nivel: m[2].trim(), modulo: m[3].trim() } : {};
}
function openPublicar(c, ovAnterior) {
  const meta = metaDoCard(c);
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:520px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">🚀 Publicar na PSM Academy</div>
      <div class="tiny muted" style="margin-bottom:10px">"${esc(c.titulo || '')}" vira aula VISÍVEL pros alunos na trilha — e o card marca ✅ Publicada.</div>
      <div class="flex gap-2" style="margin-bottom:8px">
        <div style="flex:1"><label class="tiny muted">Trilha</label>
          <select id="pb-trilha" class="select" style="width:100%">${CURRICULUM.map(t => `<option value="${esc(t.trilha)}"${(meta.trilha || c.plataforma) === t.trilha ? ' selected' : ''}>${esc(t.trilha)}</option>`).join('')}</select></div>
        <div style="flex:1"><label class="tiny muted">Nível</label>
          <select id="pb-nivel" class="select" style="width:100%">${NIVEIS.map(n => `<option${meta.nivel === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      </div>
      <label class="tiny muted">Módulo</label>
      <input id="pb-modulo" class="input" value="${esc(meta.modulo || '')}" placeholder="ex.: O corretor profissional" style="margin-bottom:8px">
      <div class="flex gap-2" style="margin-bottom:8px">
        <div style="flex:1"><label class="tiny muted">Link do vídeo/material</label>
          <input id="pb-url" class="input" value="${esc(c.link || '')}" placeholder="https://(YouTube/Drive)"></div>
        <div style="width:110px"><label class="tiny muted">Duração</label>
          <input id="pb-dur" class="input" value="" placeholder="12 min"></div>
      </div>
      <div class="flex gap-2 mt-2" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="pb-x">Cancelar</button>
        <button class="btn btn-primary" id="pb-go">🚀 Publicar aula</button>
      </div>
      <div class="tiny" id="pb-msg" style="margin-top:6px"></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#pb-x').onclick = () => ov.remove();
  ov.querySelector('#pb-go').onclick = async () => {
    const g = id => ov.querySelector('#' + id).value;
    const msg = ov.querySelector('#pb-msg');
    if (!g('pb-url').trim()) { msg.textContent = '⚠️ coloque o link do vídeo/material'; return; }
    msg.textContent = '⏳ publicando…';
    try {
      await api.request('/api/v3/diretoria/academy', { method: 'POST', body: {
        titulo: c.titulo, trilha: g('pb-trilha'), nivel: g('pb-nivel'), modulo: g('pb-modulo').trim(),
        tipo: TIPO_MAP[c.formato] || 'video', url: g('pb-url').trim(), conteudo: '', duracao: g('pb-dur').trim(), ordem: 0,
      } });
      const checklist = { ...(c.checklist || {}), publicado: true };
      await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'upsert', board: 'academy', id: c.id, titulo: c.titulo, status: 'publicada', link: g('pb-url').trim(), checklist } });
      ov.remove(); if (ovAnterior) ovAnterior.remove();
      await pageAcademyStudio(null, _root);
    } catch (e) { msg.textContent = '⚠️ ' + e.message; }
  };
}

/* ── 🧭 COBERTURA DO CURRÍCULO (v84.8): ementa oficial × produção × publicado ── */
function coberturaCurriculo() {
  const bar = (v, max, cor) => `<div style="height:8px;border-radius:4px;background:rgba(148,163,184,.2);overflow:hidden"><div style="height:100%;width:${max ? Math.round(v / max * 100) : 0}%;background:${cor}"></div></div>`;
  const rows = CURRICULUM.map(t => {
    const ementa = t.modulos.reduce((s, m) => s + m.aulas.length, 0);
    const cardsT = _cards.filter(c => (c.plataforma || '') === t.trilha);
    const pub = cardsT.filter(c => c.status === 'publicada').length;
    const prod = cardsT.length - pub;
    return `<div style="margin-bottom:9px">
      <div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:700">${t.icon || ''} ${esc(t.trilha)}</span>
      <span class="tiny muted">✅ ${pub} publicadas · 🔧 ${prod} em produção · ementa ${ementa}</span></div>
      ${bar(pub, ementa, '#16a34a')}</div>`;
  }).join('');
  const totE = CURRICULUM.reduce((s, t) => s + t.modulos.reduce((x, m) => x + m.aulas.length, 0), 0);
  const totP = _cards.filter(c => c.status === 'publicada').length;
  return `<div class="as-day">
    <div style="font-weight:800;font-size:14px;margin-bottom:2px">🧭 Cobertura do currículo oficial</div>
    <div class="tiny muted" style="margin-bottom:10px">Quanto da ementa completa (${totE} aulas) já virou aula publicada: <b>${totE ? Math.round(totP / totE * 100) : 0}%</b>. Importe a ementa pra puxar o backlog.</div>
    ${rows}</div>`;
}

async function gerarIA(modo, payload, alvoEl, btn) {
  const txt0 = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ gerando…'; }
  try {
    // v84.8 — cérebro novo (Sonnet 5): briefing COMPLETO da aula, não só roteiro solto
    const prompt = modo === 'roteiro'
      ? `Escreva o BRIEFING COMPLETO de uma vídeo-aula interna da PSM Academy (imobiliária de São José do Rio Preto).
Tema: "${payload.tema || '?'}" · Trilha: ${payload.linha || 'geral'} · Formato: ${payload.tipo || 'Vídeo-aula'}.
Público: corretores e equipe da PSM (iniciantes na trilha). Estruture EXATAMENTE assim, direto e prático:
🎯 OBJETIVO DE APRENDIZAGEM (1 frase: o que a pessoa SABE FAZER ao final)
👥 PÚBLICO & PRÉ-REQUISITO
🎬 GANCHO DE ABERTURA (15s — a dor/curiosidade que segura a atenção)
📋 ESTRUTURA DA AULA (tópicos com minutagem, total 8-15 min, com exemplo REAL de imobiliária em cada tópico)
🏋️ EXERCÍCIO PRÁTICO (o que a pessoa faz HOJE pra aplicar)
✅ CTA DE ENCERRAMENTO (próxima aula/ação)
🎥 NOTAS DE GRAVAÇÃO (cenário, recursos, b-roll)`
      : `Sugira 5 títulos MATADORES pra uma vídeo-aula interna sobre "${payload.tema || payload.linha || '?'}" (trilha ${payload.linha || 'geral'}) da PSM Academy. Curtos, específicos, sem clickbait vazio. Só a lista.`;
    const r = await api.request('/api/v3/ia/analyze', { method: 'POST', body: { prompt, max_tokens: 2500, dossie: false } });
    if (r && r.text) {
      if (modo === 'roteiro') { alvoEl.value = (alvoEl.value ? alvoEl.value + '\n\n' : '') + r.text; }
      else { alert(r.text); }
    } else { alert('IA não retornou conteúdo.'); }
  } catch (e) { alert('IA indisponível: ' + (e.message || e)); }
  finally { if (btn) { btn.disabled = false; btn.textContent = txt0; } }
}

function bind() {
  _root.querySelectorAll('.as-tab').forEach(t => t.addEventListener('click', () => { _view = t.dataset.view; render(); }));
  const fl = _root.querySelector('#as-flinha'); if (fl) fl.onchange = () => { _fLinha = fl.value; render(); };
  const fr = _root.querySelector('#as-fresp'); if (fr) fr.onchange = () => { _fResp = fr.value; render(); };
  _root.querySelector('#as-new')?.addEventListener('click', () => openEditor({ plataforma: _fLinha || '' }));
  _root.querySelector('#as-import')?.addEventListener('click', openImportEmenta);
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
      const antes = c.status;
      c.status = st; render();
      try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'move', id: c.id, status: st } }); }
      catch (e) { c.status = antes; render(); alert('❌ NÃO SALVOU o movimento do card: ' + e.message + '\nEle voltou pra coluna original — tente de novo.'); }
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
      <div class="flex" style="justify-content:space-between;align-items:center">
        <label class="tiny muted">📝 Roteiro</label>
        <div class="flex gap-2">
          <button class="btn btn-ghost tiny" id="as-ia-roteiro" type="button" title="Gera um rascunho de roteiro com IA">✍️ Gerar com IA</button>
          <button class="btn btn-ghost tiny" id="as-ia-titulo" type="button" title="Sugere títulos">💡 Título</button>
        </div>
      </div>
      <textarea id="as-f-obs" class="input" rows="6" placeholder="Roteiro da aula: gancho, tópicos, exemplos, CTA… (ou clique em ✍️ Gerar com IA)">${esc(c.obs || '')}</textarea>
      <label class="tiny muted" style="display:block;margin-top:10px">✅ Checklist de produção</label>
      <div class="flex" style="flex-wrap:wrap;gap:6px 14px;margin-bottom:6px">
        ${CHECK.map(x => `<label class="tiny flex gap-1" style="align-items:center;cursor:pointer"><input type="checkbox" class="as-chk" data-k="${x.k}" ${(c.checklist || {})[x.k] ? 'checked' : ''}> ${x.l}</label>`).join('')}
      </div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        <button class="btn btn-ghost" id="as-del" ${c.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2">
          ${c.id ? '<button class="btn btn-ghost" id="as-pub" style="color:#16a34a;font-weight:700">🚀 Publicar na Academy</button>' : ''}
          <button class="btn btn-ghost" id="as-cancel">Cancelar</button>
          <button class="btn btn-primary" id="as-save">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#as-cancel').onclick = () => ov.remove();
  ov.querySelector('#as-pub')?.addEventListener('click', () => openPublicar({ ...c, link: ov.querySelector('#as-f-link').value.trim() || c.link, titulo: ov.querySelector('#as-f-titulo').value.trim() || c.titulo }, ov));
  ov.querySelector('#as-ia-roteiro').onclick = e => gerarIA('roteiro',
    { tema: ov.querySelector('#as-f-titulo').value, linha: ov.querySelector('#as-f-linha').value, tipo: ov.querySelector('#as-f-tipo').value },
    ov.querySelector('#as-f-obs'), e.currentTarget);
  ov.querySelector('#as-ia-titulo').onclick = e => gerarIA('titulo',
    { tema: ov.querySelector('#as-f-titulo').value, linha: ov.querySelector('#as-f-linha').value }, null, e.currentTarget);
  ov.querySelector('#as-save').onclick = async () => {
    const g = id => ov.querySelector('#as-f-' + id).value;
    const checklist = {}; ov.querySelectorAll('.as-chk').forEach(ch => { if (ch.checked) checklist[ch.dataset.k] = true; });
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
      checklist,
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
