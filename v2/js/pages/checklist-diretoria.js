/* PSM-OS v2 — ✅ Checklist da Diretoria (v88.41)
   Tudo o que a Diretoria precisa fazer, por SETOR, com RESPONSÁVEL e PRAZO.
   Usa a tabela de tarefas da diretoria (dir_tasks via /api/v3/tasks/*) — então cada item
   também avisa o responsável e, com prazo, aparece na Agenda dele (espelho que já existia).
   Setor = campo "categoria" da tarefa. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _tasks = [];
let _users = [];          // ativos (pra atribuir)
let _todos = [];          // todos (pra mostrar nome de quem saiu)
let _f = { status: 'abertas', setor: '', resp: '', busca: '' };
let _edit = null;          // tarefa em edição (null = formulário de nova)
let _fechados = new Set(); // setores recolhidos
let _cats = null;          // { lista, pode_editar } — setores editáveis (v88.43, /api/v3/tasks/categorias)
let _co = [];              // outros responsáveis da tarefa no formulário (v88.43)

export const SETORES = [
  { id: 'Presidência', ico: '🏛' }, { id: 'Comercial', ico: '🤝' }, { id: 'Marketing', ico: '📣' },
  { id: 'Financeiro', ico: '💰' }, { id: 'Pessoas & RH', ico: '👥' }, { id: 'Operações & Backoffice', ico: '⚙️' },
  { id: 'Jurídico', ico: '⚖️' }, { id: 'Locação', ico: '🔑' }, { id: 'Tecnologia & Sistema', ico: '💻' },
  { id: 'Morimatsu & Associados', ico: '🏯' },
];
const PRIOR = { critica: ['Crítica', '#7f1d1d'], alta: ['Alta', '#dc2626'], media: ['Média', '#d97706'], baixa: ['Baixa', '#64748b'] };
const ALIAS = { 'Locações': 'Locação' };   // categorias antigas que já existem nas tarefas
const setorDe = t => ALIAS[t.categoria] || t.categoria || 'Sem setor';
const listaSetores = () => (_cats && _cats.lista && _cats.lista.length) ? _cats.lista : SETORES.map(s => s.id);
const coDe = t => (Array.isArray(t.corresponsaveis) ? t.corresponsaveis : []).filter(x => x && x !== t.responsavel);
const ehResp = (t, uid) => t.responsavel === uid || coDe(t).includes(uid);
const icoSetor = s => (SETORES.find(x => x.id === s) || {}).ico || '📁';
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const aberta = t => !['concluida', 'cancelada'].includes(t.status);
const socio = () => (auth.user()?.lvl || 0) >= 10;

export async function pageChecklistDiretoria(ctx, root) {
  _root = root;
  _root.innerHTML = '<div class="card"><div class="muted tiny"><span class="spinner"></span> Carregando o checklist…</div></div>';
  await load();
}

async function load() {
  try {
    const [t, u] = await Promise.all([
      api.request('/api/v3/tasks/list'),
      _todos.length ? Promise.resolve({ users: _todos }) : api.request('/api/v3/users/list?all=1').catch(() => api.request('/api/v3/users/list')).catch(() => ({ users: [] })),
      _cats ? null : api.request('/api/v3/tasks/categorias').then(r => { _cats = { lista: r.lista || [], pode_editar: !!r.pode_editar }; }).catch(() => { _cats = { lista: [], pode_editar: false }; }),
    ]);
    _tasks = t.tasks || t.items || t.rows || [];
    _todos = (u.users || []).filter(x => x.id && x.name);
    _users = _todos.filter(x => (x.status || 'ativo') === 'ativo').sort((a, b) => a.name.localeCompare(b.name));
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

const nome = id => (_todos.find(u => u.id === id) || {}).name || id || '—';
const inativo = id => !!id && !_users.some(u => u.id === id);   // responsável que saiu da empresa

function filtradas() {
  const h = hoje();
  return _tasks.filter(t => {
    if (_f.status === 'abertas' && !aberta(t)) return false;
    if (_f.status === 'atrasadas' && !(aberta(t) && t.prazo && t.prazo < h)) return false;
    if (_f.status === 'concluidas' && t.status !== 'concluida') return false;
    if (_f.setor && setorDe(t) !== _f.setor) return false;
    if (_f.resp && !ehResp(t, _f.resp)) return false;
    if (_f.busca && !`${t.titulo} ${t.descricao || ''}`.toLowerCase().includes(_f.busca.toLowerCase())) return false;
    return true;
  });
}

/* ─── render ─────────────────────────────────────────────────────────── */
function render() {
  const h = hoje(), em7 = new Date(Date.now() + 7 * 864e5 - 3 * 3600e3).toISOString().slice(0, 10);
  const ab = _tasks.filter(aberta);
  const atras = ab.filter(t => t.prazo && t.prazo < h).length;
  const semana = ab.filter(t => t.prazo && t.prazo >= h && t.prazo <= em7).length;
  const semDono = ab.filter(t => !t.responsavel || !t.prazo || inativo(t.responsavel)).length;
  const mes = h.slice(0, 7);
  const feitasMes = _tasks.filter(t => t.status === 'concluida' && String(t.updated_at || '').slice(0, 7) === mes).length;
  const setoresUsados = [...new Set([...listaSetores(), ..._tasks.map(setorDe)])];

  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div><h2 class="card-title">✅ Checklist da Diretoria</h2>
          <p class="card-sub">O que precisa ser feito, por setor, com responsável e prazo. Quem recebe a tarefa é avisado e, com prazo, ela entra na Agenda dele.</p></div>
        <div class="flex gap-1">${_cats && _cats.pode_editar ? '<button class="btn btn-ghost" id="ck-setores" title="Criar, renomear ou remover setores">⚙️ Editar setores</button>' : ''}
          <button class="btn btn-primary" id="ck-novo">➕ Nova tarefa</button></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px" class="mt-2">
        ${tile('Abertas', ab.length, '', 'var(--psm-navy)', 'abertas')}
        ${tile('Atrasadas', atras, 'prazo vencido', atras ? '#dc2626' : '#16a34a', 'atrasadas')}
        ${tile('Vencem em 7 dias', semana, '', semana ? '#d97706' : '#64748b', '')}
        ${tile('Sem dono ou prazo', semDono, 'ou com responsável que saiu', semDono ? '#d97706' : '#16a34a', '')}
        ${tile('Concluídas no mês', feitasMes, '', '#16a34a', 'concluidas')}
      </div>
      <div class="flex gap-1 mt-3" style="flex-wrap:wrap;align-items:center">
        <select id="ck-st" class="select" style="width:auto">
          ${[['abertas', 'Abertas'], ['atrasadas', 'Atrasadas'], ['concluidas', 'Concluídas'], ['todas', 'Todas']].map(([v, l]) => `<option value="${v}" ${_f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="ck-setor" class="select" style="width:auto"><option value="">Todos os setores</option>
          ${setoresUsados.map(s => `<option ${_f.setor === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select id="ck-resp" class="select" style="width:auto"><option value="">Todos os responsáveis</option>
          ${_users.map(u => `<option value="${esc(u.id)}" ${_f.resp === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        <input id="ck-busca" class="input" style="width:auto;flex:1;min-width:160px" placeholder="🔎 buscar" value="${esc(_f.busca)}">
      </div>
    </div>
    <div id="ck-form"></div>
    <div id="ck-lista">${listaHTML()}</div>`;
  bind();
}

function tile(lbl, val, sub, cor, filtro) {
  return `<div ${filtro ? `data-filtro="${filtro}" style="cursor:pointer;` : 'style="'}background:var(--bg-3);border-radius:8px;padding:10px;border-top:3px solid ${cor}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">${lbl}</div>
    <div style="font-size:22px;font-weight:800;color:${cor}">${val}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
}

function listaHTML() {
  const ts = filtradas();
  if (!ts.length) return `<div class="card mt-3" style="text-align:center;padding:24px"><div class="muted">Nada aqui com esses filtros.</div></div>`;
  const grupos = {};
  ts.forEach(t => { (grupos[setorDe(t)] = grupos[setorDe(t)] || []).push(t); });
  const ordem = [...listaSetores(), 'Sem setor'];
  const chaves = Object.keys(grupos).sort((a, b) => (ordem.indexOf(a) + 1 || 99) - (ordem.indexOf(b) + 1 || 99));
  const h = hoje();
  const rank = t => [aberta(t) ? 0 : 1, t.prazo ? 0 : 1, t.prazo || '', { critica: 0, alta: 1, media: 2, baixa: 3 }[t.prioridade] ?? 2];
  return chaves.map(s => {
    const itens = grupos[s].sort((a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) { if (ra[i] < rb[i]) return -1; if (ra[i] > rb[i]) return 1; } return 0; });
    const atras = itens.filter(t => aberta(t) && t.prazo && t.prazo < h).length;
    const fechado = _fechados.has(s);
    return `<div class="card mt-2" style="padding:10px 12px">
      <div class="flex" data-setor="${esc(s)}" style="justify-content:space-between;align-items:center;cursor:pointer">
        <div style="font-weight:800">${fechado ? '▸' : '▾'} ${icoSetor(s)} ${esc(s)} <span class="tiny muted" style="font-weight:400">· ${itens.length} tarefa(s)</span></div>
        <div class="flex gap-1" style="align-items:center">${atras ? `<span class="tiny" style="color:#dc2626;font-weight:700">⚠ ${atras} atrasada(s)</span>` : ''}
          <button class="btn btn-ghost btn-sm" data-add-setor="${esc(s)}" title="Nova tarefa neste setor">➕</button></div>
      </div>
      ${fechado ? '' : itens.map(itemHTML).join('')}
    </div>`;
  }).join('');
}

function itemHTML(t) {
  const h = hoje(), feita = t.status === 'concluida', canc = t.status === 'cancelada';
  let prazo = '<span class="tiny" style="color:#d97706">sem prazo</span>';
  if (t.prazo) {
    const atras = !feita && !canc && t.prazo < h, eh = t.prazo === h;
    prazo = `<span class="tiny" style="font-weight:700;color:${atras ? '#dc2626' : eh ? '#d97706' : 'inherit'}">${atras ? '⚠ ' : eh ? '● hoje · ' : '📅 '}${t.prazo.split('-').reverse().join('/')}</span>`;
  }
  const p = PRIOR[t.prioridade] || PRIOR.media;
  return `<div class="flex gap-2" style="align-items:flex-start;padding:7px 0;border-top:1px dashed var(--border);${feita || canc ? 'opacity:.55' : ''}">
    <input type="checkbox" data-ok="${esc(t.id)}" ${feita ? 'checked' : ''} ${canc ? 'disabled' : ''} style="margin-top:3px" title="${feita ? 'reabrir' : 'marcar como feita'}">
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;${feita ? 'text-decoration:line-through' : ''}">${esc(t.titulo)}
        <span style="font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:99px;background:${p[1]}1f;color:${p[1]};margin-left:4px">${p[0]}</span>
        ${canc ? '<span class="tiny muted"> · cancelada</span>' : ''}</div>
      ${t.descricao ? `<div class="tiny muted">${esc(t.descricao)}</div>` : ''}
      <div class="flex gap-2 tiny" style="flex-wrap:wrap;margin-top:2px">
        <span>${!t.responsavel ? '<span style="color:#d97706">👤 sem responsável</span>'
          : inativo(t.responsavel) && aberta(t) ? `<span style="color:#dc2626">👤 ${esc(nome(t.responsavel))} — saiu da empresa, reatribuir</span>`
          : '👤 ' + esc(nome(t.responsavel))}${coDe(t).map(id => `, ${inativo(id) && aberta(t) ? `<span style="color:#dc2626">${esc(nome(id))} (saiu)</span>` : esc(nome(id))}`).join('')}</span>${prazo}
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" data-ed="${esc(t.id)}" title="Editar">✏️</button>
  </div>`;
}

/* ─── formulário ─────────────────────────────────────────────────────── */
function form(t, setorPadrao) {
  _edit = t || null;
  const x = t || { titulo: '', descricao: '', categoria: setorPadrao || '', responsavel: '', prazo: '', prioridade: 'media' };
  const el = document.getElementById('ck-form');
  const setores = [...new Set([...listaSetores(), ...(x.categoria ? [setorDe(x)] : [])])];
  _co = t ? coDe(t) : [];
  el.innerHTML = `<div class="card mt-3" style="border:2px solid var(--psm-navy)">
    <div class="flex" style="justify-content:space-between"><div style="font-weight:800">${t ? '✏️ Editar tarefa' : '➕ Nova tarefa'}</div>
      <button class="btn btn-ghost btn-sm" id="ck-x">✕</button></div>
    <div style="display:grid;gap:8px;margin-top:8px">
      <input id="ck-tit" class="input" placeholder="O que precisa ser feito" value="${esc(x.titulo)}">
      <textarea id="ck-desc" class="input" rows="2" placeholder="Detalhes / critério de pronto (opcional)">${esc(x.descricao || '')}</textarea>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">
        <div><label class="tiny muted">Setor</label><select id="ck-set" class="select"><option value="">— escolha —</option>
          ${setores.map(s => `<option ${setorDe(x) === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div><label class="tiny muted">Responsável</label><select id="ck-rsp" class="select"><option value="">— escolha —</option>
          ${_users.map(u => `<option value="${esc(u.id)}" ${x.responsavel === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
        <div style="grid-column:1/-1"><label class="tiny muted">Outros responsáveis</label>
          <div class="flex gap-1" style="flex-wrap:wrap;align-items:center"><select id="ck-co-add" class="select" style="width:auto"></select><span id="ck-cos" class="flex gap-1" style="flex-wrap:wrap"></span></div></div>
        <div><label class="tiny muted">Prazo</label><input id="ck-prz" type="date" class="input" value="${esc(x.prazo || '')}"></div>
        <div><label class="tiny muted">Prioridade</label><select id="ck-pri" class="select">
          ${Object.entries(PRIOR).map(([k, v]) => `<option value="${k}" ${(x.prioridade || 'media') === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      </div>
      <div class="flex gap-1">
        ${t && socio() ? '<button class="btn btn-ghost btn-sm" id="ck-del" style="color:#dc2626">🗑 Excluir</button>' : ''}
        ${t && t.status !== 'cancelada' ? '<button class="btn btn-ghost btn-sm" id="ck-canc">Cancelar tarefa</button>' : ''}
        <button class="btn btn-primary" id="ck-ok" style="margin-left:auto">💾 Salvar</button>
      </div>
    </div></div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  desenharCo();
  document.getElementById('ck-co-add').onchange = e => { if (e.target.value && !_co.includes(e.target.value)) _co.push(e.target.value); desenharCo(); };
  document.getElementById('ck-rsp').onchange = () => { _co = _co.filter(id => id !== document.getElementById('ck-rsp').value); desenharCo(); };
  document.getElementById('ck-x').onclick = () => { el.innerHTML = ''; _edit = null; };
  document.getElementById('ck-ok').onclick = salvar;
  const d = document.getElementById('ck-del');
  if (d) d.onclick = async () => {
    if (!confirm('Excluir esta tarefa de vez? (some também da Agenda)')) return;
    try { await api.request('/api/v3/tasks/delete', { method: 'POST', body: { id: t.id } }); el.innerHTML = ''; await load(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  const c = document.getElementById('ck-canc');
  if (c) c.onclick = () => mudarStatus(t.id, 'cancelada');
}

function desenharCo() {
  const principal = document.getElementById('ck-rsp').value;
  document.getElementById('ck-cos').innerHTML = _co.map(id => `<span class="tiny" style="display:inline-flex;align-items:center;gap:4px;background:var(--bg-3);border:1px solid var(--border);border-radius:99px;padding:2px 4px 2px 9px;font-weight:600">${esc(nome(id))}<button type="button" class="btn btn-ghost btn-sm" data-rmco="${esc(id)}" style="padding:0 5px;min-height:0" aria-label="Remover ${esc(nome(id))}">✕</button></span>`).join('')
    || '<span class="tiny muted">ninguém além do responsável</span>';
  document.getElementById('ck-co-add').innerHTML = '<option value="">+ adicionar pessoa…</option>'
    + _users.filter(u => u.id !== principal && !_co.includes(u.id)).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  document.querySelectorAll('#ck-cos [data-rmco]').forEach(b => b.onclick = () => { _co = _co.filter(id => id !== b.dataset.rmco); desenharCo(); });
}

/* ─── editar setores (v88.43) ────────────────────────────────────────── */
function formSetores() {
  _edit = null;
  const el = document.getElementById('ck-form');
  const lista = listaSetores();
  el.innerHTML = `<div class="card mt-3" style="border:2px solid var(--psm-navy)">
    <div class="flex" style="justify-content:space-between"><div style="font-weight:800">⚙️ Setores do Checklist</div>
      <button class="btn btn-ghost btn-sm" id="ck-x">✕</button></div>
    <p class="tiny muted" style="margin:4px 0 8px">Renomear troca o setor em todas as tarefas que já usam esse nome. Remover tira só da lista — as tarefas antigas continuam com o nome.</p>
    <div id="ck-set-rows" style="display:grid;gap:6px">
      ${lista.map(s => `<div class="flex gap-1" data-row><input class="input" data-orig="${esc(s)}" value="${esc(s)}" maxlength="60" aria-label="Setor ${esc(s)}">
        <button class="btn btn-ghost btn-sm" data-rmset title="Remover da lista" aria-label="Remover ${esc(s)}">🗑</button></div>`).join('')}
      <div class="flex gap-1"><input class="input" id="ck-set-novo" maxlength="60" placeholder="+ Novo setor (ex.: Incorporação)"></div>
    </div>
    <div class="flex gap-1 mt-2"><button class="btn btn-primary" id="ck-set-ok" style="margin-left:auto">💾 Salvar setores</button></div>
  </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('ck-x').onclick = () => { el.innerHTML = ''; };
  el.querySelectorAll('[data-rmset]').forEach(b => b.onclick = () => b.closest('[data-row]').remove());
  document.getElementById('ck-set-ok').onclick = async () => {
    const nova = [], renomear = {};
    el.querySelectorAll('[data-orig]').forEach(i => {
      const v = i.value.trim(); if (!v) return;
      nova.push(v); if (v !== i.dataset.orig) renomear[i.dataset.orig] = v;
    });
    const add = document.getElementById('ck-set-novo').value.trim(); if (add) nova.push(add);
    const b = document.getElementById('ck-set-ok'); b.disabled = true; b.textContent = 'Salvando…';
    try {
      const r = await api.request('/api/v3/tasks/categorias', { method: 'POST', body: { acao: 'salvar', lista: nova, renomear } });
      _cats.lista = r.lista || nova;
      if (renomear[_f.setor]) _f.setor = renomear[_f.setor];
      el.innerHTML = '';
      await load();
    } catch (e) { b.disabled = false; b.textContent = '💾 Salvar setores'; alert('Erro: ' + e.message); }
  };
}

async function salvar() {
  const titulo = document.getElementById('ck-tit').value.trim();
  if (!titulo) { alert('Escreva o que precisa ser feito.'); return; }
  const body = {
    titulo, descricao: document.getElementById('ck-desc').value.trim(),
    categoria: document.getElementById('ck-set').value, responsavel: document.getElementById('ck-rsp').value,
    prazo: document.getElementById('ck-prz').value, prioridade: document.getElementById('ck-pri').value,
  };
  body.corresponsaveis = _co.filter(id => id !== body.responsavel);
  if (_edit) body.id = _edit.id;
  else Object.keys(body).forEach(k => { if (body[k] === '') delete body[k]; });   // nova: vazio = não informado
  if (!body.responsavel && body.corresponsaveis.length) { alert('Escolha o responsável principal antes dos demais.'); return; }
  try {
    const r = await api.request('/api/v3/tasks/upsert', { method: 'POST', body });
    if (r && r.aviso) alert(r.aviso);
    document.getElementById('ck-form').innerHTML = ''; _edit = null;
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

async function mudarStatus(id, status) {
  try { await api.request('/api/v3/tasks/upsert', { method: 'POST', body: { id, status } }); document.getElementById('ck-form').innerHTML = ''; await load(); }
  catch (e) { alert('Erro: ' + e.message); await load(); }
}

/* ─── eventos ────────────────────────────────────────────────────────── */
function bind() {
  document.getElementById('ck-novo').onclick = () => form(null, _f.setor);
  const bs = document.getElementById('ck-setores'); if (bs) bs.onclick = formSetores;
  document.getElementById('ck-st').onchange = e => { _f.status = e.target.value; render(); };
  document.getElementById('ck-setor').onchange = e => { _f.setor = e.target.value; render(); };
  document.getElementById('ck-resp').onchange = e => { _f.resp = e.target.value; render(); };
  const b = document.getElementById('ck-busca');
  b.oninput = () => { _f.busca = b.value; document.getElementById('ck-lista').innerHTML = listaHTML(); bindLista(); };
  _root.querySelectorAll('[data-filtro]').forEach(el => el.onclick = () => { _f.status = el.dataset.filtro; render(); });
  bindLista();
}
function bindLista() {
  _root.querySelectorAll('[data-setor]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-add-setor]')) return;
    const s = el.dataset.setor; _fechados.has(s) ? _fechados.delete(s) : _fechados.add(s);
    document.getElementById('ck-lista').innerHTML = listaHTML(); bindLista();
  });
  _root.querySelectorAll('[data-add-setor]').forEach(el => el.onclick = () => form(null, el.dataset.addSetor === 'Sem setor' ? '' : el.dataset.addSetor));
  _root.querySelectorAll('[data-ok]').forEach(cb => cb.onchange = () => { cb.disabled = true; mudarStatus(cb.dataset.ok, cb.checked ? 'concluida' : 'aberta'); });
  _root.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => form(_tasks.find(t => t.id === b.dataset.ed)));
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
