/* PSM-OS v2 — Captações Kanban (modelo Notion PSM) — Sprint 9.8 (redesign moderno)
   Kanban drag-and-drop por status, KPIs, filtros, cards profissionais. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];
let _users = [];
let _editing = null;
let _dragId = null;
let _lastDrop = 0;
let _search = '';
let _fObj = '';
let _fResp = '';

// Status agrupados (= colunas Kanban do Notion) — 3 fases, 17 status
const FASES = [
  { fase: 'A fazer', cor: '#ef4444', status: [
    { id: 'a_fazer',       lbl: 'À Fazer Captação', cor: '#dc2626' },
    { id: 'agendar_prop',  lbl: 'Agendar c/ Prop',  cor: '#ea580c' },
    { id: 'agendado',      lbl: 'Agendado',         cor: '#3b82f6' },
    { id: 'pausado',       lbl: 'Pausado',          cor: '#64748b' },
  ]},
  { fase: 'Em andamento', cor: '#f59e0b', status: [
    { id: 'captacao_realizada',     lbl: 'Captação Realizada',     cor: '#ca8a04' },
    { id: 'edicao_fotos',           lbl: 'Edição Fotos',           cor: '#3b82f6' },
    { id: 'edicao_videos',          lbl: 'Edição Vídeos',          cor: '#8b5cf6' },
    { id: 'aprovacao',              lbl: 'Pendente Aprovação',     cor: '#ca8a04' },
  ]},
  { fase: 'Concluídos', cor: '#16a34a', status: [
    { id: 'formulario_kenlo',   lbl: 'Formulário → Kenlo', cor: '#8b5cf6' },
    { id: 'subir_kenlo',        lbl: 'Subir Direto Kenlo', cor: '#8b5cf6' },
    { id: 'agendar_mlabs',      lbl: 'Agendar Post',       cor: '#ca8a04' },
    { id: 'refazer',            lbl: 'Refazer',            cor: '#dc2626' },
    { id: 'concluido',          lbl: 'Concluído',          cor: '#16a34a' },
  ]},
];
const ALL_STATUS = FASES.flatMap(f => f.status);
// Etapas removidas (v77.37) → pra onde os cards antigos vão (não some nenhum card).
const STATUS_REMAP = { colher_dados: 'a_fazer', aguardando_autorizacao: 'a_fazer', a_fazer_formulario: 'formulario_kenlo', aprovado: 'concluido' };
const normStatus = s => STATUS_REMAP[s] || s;
const statusInfo = id => ALL_STATUS.find(s => s.id === id) || { lbl: id || '—', cor: '#64748b' };
const statusCor = id => statusInfo(id).cor;
const faseOf = id => FASES.find(f => f.status.some(s => s.id === id))?.fase || '';
const faseCorOf = id => (FASES.find(f => f.status.some(s => s.id === id)) || {}).cor || '#64748b';

// Tipos de imóvel com ícone + categoria (cor da flag no card)
const TIPOS = [
  { v: 'Casa em condomínio', ic: '🏡', cat: 'res' },
  { v: 'Casa bairro', ic: '🏠', cat: 'res' },
  { v: 'Apartamento', ic: '🏢', cat: 'res' },
  { v: 'Duplex', ic: '🏠', cat: 'res' },
  { v: 'Cobertura', ic: '🌆', cat: 'res' },
  { v: 'Terreno Residencial aberto', ic: '🟩', cat: 'terreno' },
  { v: 'Terreno Residencial condomínio', ic: '🟩', cat: 'terreno' },
  { v: 'Terreno comercial', ic: '🟧', cat: 'terreno' },
  { v: 'Terreno industrial', ic: '🟫', cat: 'terreno' },
  { v: 'Studio', ic: '🛋️', cat: 'res' },
  { v: 'Chácara', ic: '🌳', cat: 'rural' },
  { v: 'Sítio', ic: '🌾', cat: 'rural' },
  { v: 'Galpão', ic: '🏭', cat: 'industrial' },
  { v: 'Barracão', ic: '🏚️', cat: 'industrial' },
  { v: 'Loja', ic: '🏬', cat: 'com' },
  { v: 'Salão comercial', ic: '🛍️', cat: 'com' },
  { v: 'Sala comercial', ic: '🏢', cat: 'com' },
  { v: 'Andar laje inteira', ic: '🏙️', cat: 'com' },
];
const TIPO_CAT_COR = { res: '#16a34a', com: '#2563eb', terreno: '#d97706', rural: '#65a30d', industrial: '#475569' };
const TIPO_MAP = Object.fromEntries(TIPOS.map(t => [t.v, t]));

// Flag (ícone + tipo) colorida por categoria — vai no topo do card
function tipoFlag(tipo) {
  if (!tipo) return '';
  const t = TIPO_MAP[tipo];
  const ic = t ? t.ic : '🏠';
  const cor = t ? (TIPO_CAT_COR[t.cat] || '#64748b') : '#64748b';
  return `<span class="cap-chip" title="${esc(tipo)}" style="background:${cor}1f;color:${cor};font-weight:700;border:1px solid ${cor}55">${ic} ${esc(tipo)}</span>`;
}

// Título do card = endereço completo + quadra/lote OU bloco/unidade (fallback: nome)
function capTitulo(c) {
  const parts = [];
  if (c.endereco) parts.push(c.endereco);
  const ql = [];
  if (c.quadra) ql.push('Q ' + c.quadra);
  if (c.lote) ql.push('L ' + c.lote);
  if (c.bloco) ql.push('Bl ' + c.bloco);
  if (c.unidade) ql.push('Ap ' + c.unidade);
  if (ql.length) parts.push(ql.join(' '));
  if (c.bairro) parts.push(c.bairro);
  const t = parts.filter(Boolean).join(' · ');
  return t || c.nome_imovel || c.condominio || c.localizacao || c.proprietario || 'Sem endereço';
}
const SITUACOES = [
  { id: 'desocupado', lbl: 'Desocupado', cor: '#16a34a' },
  { id: 'semi_pronto', lbl: 'Semi Pronto', cor: '#d97706' },
  { id: 'ocupado_proprietario', lbl: 'Ocupado Proprietário', cor: '#dc2626' },
  { id: 'ocupado_inquilino', lbl: 'Ocupado Inquilino', cor: '#dc2626' },
  { id: 'inquilino', lbl: 'Inquilino', cor: '#dc2626' },
  { id: 'reformando', lbl: 'Reformando', cor: '#a16207' },
];
const PENDENCIAS = [
  { id: 'falta_fotos', lbl: 'Falta Fotos', cor: '#3b82f6' },
  { id: 'falta_fotos_videos', lbl: 'Falta Fotos e Vídeos', cor: '#a16207' },
  { id: 'falta_video_drone', lbl: 'Falta Vídeo Drone', cor: '#8b5cf6' },
  { id: 'falta_atualizar_fotos', lbl: 'Falta Atualizar Fotos', cor: '#16a34a' },
  { id: 'video_corretor', lbl: 'Vídeo com Corretor', cor: '#64748b' },
  { id: 'pendencia_documentacao', lbl: 'Pendência Documentação', cor: '#a16207' },
  { id: 'pendencia_chaves', lbl: 'Pendência Chaves', cor: '#be185d' },
  { id: 'pendencia_agendamento', lbl: 'Pendência Agendamento', cor: '#64748b' },
  { id: 'atualizado', lbl: 'Atualizado', cor: '#16a34a' },
];
const TERMOS = [
  { id: 'solicitar', lbl: 'Solicitar Autorização', cor: '#3b82f6' },
  { id: 'pendente', lbl: 'Autorização Pendente', cor: '#a16207' },
  { id: 'aprovado', lbl: 'Aprovado', cor: '#16a34a' },
  { id: 'recusado', lbl: 'Recusado', cor: '#dc2626' },
];

const AVATAR_COLORS = ['#6366f1', '#0891b2', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#0d9488'];
const colorFor = s => AVATAR_COLORS[[...String(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = s => (String(s || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
const fmtBRL = v => (v || v === 0) ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '';

export async function pageCaptacoes(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const [r, u] = await Promise.all([
      api.request('/api/v3/captacoes/kanban'),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _items = r.captacoes || [];
    if (u.users) _users = u.users.filter(x => (x.status || 'ativo') === 'ativo').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    renderBoard();
  } catch (e) {
    const b = document.getElementById('cap-board');
    if (b) b.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <style>
      .cap-board::-webkit-scrollbar{height:8px}
      .cap-board::-webkit-scrollbar-thumb{background:rgba(148,163,184,.4);border-radius:8px}
      .cap-col{min-width:268px;max-width:300px;flex:0 0 auto;background:var(--bg-3,#f1f5f9);border-radius:12px;padding:8px;display:flex;flex-direction:column;transition:background .15s,box-shadow .15s}
      .cap-col.drop{background:rgba(99,102,241,.12);box-shadow:inset 0 0 0 2px #6366f1}
      .cap-card{background:var(--bg-1,#fff);border-radius:10px;padding:11px 12px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.04);border:1px solid rgba(148,163,184,.16);transition:transform .12s,box-shadow .12s;user-select:none;-webkit-user-select:none}
      .cap-card:active{cursor:grabbing}
      .cap-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,23,42,.12)}
      .cap-card.dragging{opacity:.45;transform:rotate(1.5deg)}
      .cap-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;line-height:1.6}
      .cap-kpi{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:12px 14px;flex:1;min-width:120px}
    </style>
    <div class="card" style="margin-bottom:14px">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <h2 class="card-title">📥 Captações</h2>
          <p class="card-sub">Pipeline de captação de imóveis · arraste os cards entre etapas · notifica responsável + marketing</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="cap-refresh" title="Atualizar">🔄</button>
          <button class="btn btn-ghost" id="cap-rd" title="Puxar agora quem entrou na etapa CAPTAR IMÓVEL do RD (CARTEIRA MAP)">📥 Puxar do RD</button>
          <button class="btn btn-primary" id="cap-novo">➕ Nova Captação</button>
        </div>
      </div>
      <div id="cap-rd-status" class="tiny" style="margin-top:6px"></div>
      <div id="cap-stats" class="mt-3"></div>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center">
        <input id="cap-search" class="input" placeholder="🔎 Buscar condomínio, proprietário, local…" style="max-width:300px" value="${esc(_search)}">
        <select id="cap-fobj" class="select" style="max-width:150px">
          <option value="">Todos objetivos</option>
          <option value="venda"${_fObj === 'venda' ? ' selected' : ''}>Venda</option>
          <option value="locacao"${_fObj === 'locacao' ? ' selected' : ''}>Locação</option>
        </select>
        <select id="cap-fresp" class="select" style="max-width:170px"><option value="">Todos responsáveis</option></select>
      </div>
    </div>
    <div id="cap-board"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
  `;
  document.getElementById('cap-novo').addEventListener('click', () => { _editing = { status: 'a_fazer', objetivo: 'venda' }; openForm(); });
  document.getElementById('cap-refresh').addEventListener('click', load);
  document.getElementById('cap-rd').addEventListener('click', async () => {
    const st = document.getElementById('cap-rd-status');
    if (st) { st.style.color = '#d97706'; st.innerHTML = '<span class="spinner"></span> Puxando da etapa CAPTAR IMÓVEL do RD…'; }
    try {
      const r = await api.request('/api/v3/crm/captar_now');
      if (st) {
        if (r && r.ok) { st.style.color = '#16a34a'; st.textContent = `✅ ${r.created || 0} nova(s) captação(ões) criada(s) · ${r.deals_na_etapa || 0} deal(s) na etapa CAPTAR IMÓVEL.`; }
        else { st.style.color = '#dc2626'; st.textContent = '⚠️ ' + ((r && r.error) || 'não consegui puxar agora'); }
      }
      if (r && r.created) await load();
    } catch (e) { if (st) { st.style.color = '#dc2626'; st.textContent = '⚠️ ' + e.message; } }
  });
  document.getElementById('cap-search').addEventListener('input', e => { _search = e.target.value; renderBoard(); });
  document.getElementById('cap-fobj').addEventListener('change', e => { _fObj = e.target.value; renderBoard(); });
  document.getElementById('cap-fresp').addEventListener('change', e => { _fResp = e.target.value; renderBoard(); });
}

function filtered() {
  const q = _search.trim().toLowerCase();
  return _items.filter(i => {
    if (_fObj && (i.objetivo || 'venda') !== _fObj) return false;
    if (_fResp && (i.responsavel || '') !== _fResp) return false;
    if (q) {
      const hay = [i.endereco, i.bairro, i.condominio, i.nome_imovel, i.proprietario, i.localizacao, i.tipo_imovel, i.quadra, i.lote, i.bloco, i.contato, i.codigo_kenlo].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBoard() {
  // popula filtro responsável
  const resps = [...new Set(_items.map(i => i.responsavel).filter(Boolean))].sort();
  const fresp = document.getElementById('cap-fresp');
  if (fresp) fresp.innerHTML = '<option value="">Todos responsáveis</option>' +
    resps.map(r => `<option value="${esc(r)}"${_fResp === r ? ' selected' : ''}>${esc(r)}</option>`).join('');

  const items = filtered();

  // KPIs
  const pipeline = items.filter(i => (i.objetivo || 'venda') === 'venda').reduce((s, i) => s + (Number(i.valor_venda) || 0), 0);
  const porFase = FASES.map(f => ({ fase: f.fase, cor: f.cor, n: items.filter(i => f.status.some(s => s.id === i.status)).length }));
  const pend = items.filter(i => i.pendencia && i.pendencia !== 'atualizado').length;
  const midia = items.filter(i => i.precisa_fotos || i.precisa_videos).length;
  document.getElementById('cap-stats').innerHTML = `
    <div class="flex gap-2" style="flex-wrap:wrap">
      ${kpi('Total', items.length, '#3b82f6')}
      ${kpi('Pipeline (VGV)', fmtBRL(pipeline) || 'R$ 0', '#16a34a')}
      ${porFase.map(f => kpi(f.fase, f.n, f.cor)).join('')}
      ${kpi('⚠ Pendências', pend, '#f59e0b')}
      ${kpi('📷 Mídia p/ MKT', midia, '#8b5cf6')}
    </div>`;

  const board = document.getElementById('cap-board');
  if (!items.length) {
    board.innerHTML = `<div class="card" style="text-align:center;padding:48px 20px">
      <div style="font-size:40px">📭</div>
      <h3 style="margin:10px 0 4px">Nenhuma captação ${_search || _fObj || _fResp ? 'com esse filtro' : 'ainda'}</h3>
      <p class="muted">${_search || _fObj || _fResp ? 'Ajuste a busca/filtros acima.' : 'Cadastre a primeira captação para começar o pipeline.'}</p>
      <button class="btn btn-primary mt-2" id="cap-empty-novo">➕ Nova Captação</button>
    </div>`;
    const b = document.getElementById('cap-empty-novo');
    if (b) b.addEventListener('click', () => { _editing = { status: 'a_fazer', objetivo: 'venda' }; openForm(); });
    return;
  }

  board.innerHTML = `
    <div class="flex gap-3 tiny muted" style="margin:0 2px 8px;flex-wrap:wrap;align-items:center">
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#ef4444;vertical-align:middle"></span> A fazer</span>
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#f59e0b;vertical-align:middle"></span> Em andamento</span>
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#16a34a;vertical-align:middle"></span> Concluídos</span>
      <span style="margin-left:auto">← arraste os cards entre as etapas →</span>
    </div>
    <div class="cap-board flex gap-3" style="overflow-x:auto;padding-bottom:12px;align-items:flex-start">
      ${ALL_STATUS.map(st => statusColumn(st, items)).join('')}
    </div>`;
  bindBoard();
}

function statusColumn(st, items) {
  const cards = items.filter(i => normStatus(i.status) === st.id);
  const fcor = faseCorOf(st.id);
  return `
    <div class="cap-col" data-status="${st.id}" style="border-top:3px solid ${fcor}">
      <div class="flex" style="align-items:center;gap:6px;padding:6px 6px 8px">
        <span style="width:8px;height:8px;border-radius:50%;background:${st.cor}"></span>
        <span style="font-weight:700;font-size:12px;color:var(--ink,#0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${st.lbl}</span>
        <span class="tiny muted" style="margin-left:auto;background:rgba(148,163,184,.2);padding:0 7px;border-radius:999px;font-weight:700">${cards.length}</span>
      </div>
      <div class="cap-drop" data-status="${st.id}" style="min-height:40px;flex:1;overflow-y:auto;max-height:68vh">
        ${cards.map(c => card(c)).join('') || '<div class="tiny muted" style="text-align:center;padding:14px 0;opacity:.45">—</div>'}
      </div>
    </div>`;
}

function card(c) {
  const sit = SITUACOES.find(s => s.id === c.situacao_imovel);
  const pend = PENDENCIAS.find(p => p.id === c.pendencia);
  const termo = TERMOS.find(t => t.id === c.termo_autorizacao);
  const obj = (c.objetivo || 'venda') === 'locacao';
  const precisa = [];
  if (c.precisa_fotos) precisa.push('📷');
  if (c.precisa_videos) precisa.push('🎥');
  if (c.precisa_avaliacao) precisa.push('💰');
  const valor = obj ? (c.valor_locacao ? fmtBRL(c.valor_locacao) : '') : fmtBRL(c.valor_venda);
  const titulo = capTitulo(c);
  const subnome = c.nome_imovel || c.condominio || '';
  const links = [];
  if (c.link_fotos) links.push(`<a href="${esc(c.link_fotos)}" target="_blank" rel="noopener" title="Fotos captadas" data-stop="1" style="text-decoration:none">📷</a>`);
  if (c.link_videos) links.push(`<a href="${esc(c.link_videos)}" target="_blank" rel="noopener" title="Vídeos captados" data-stop="1" style="text-decoration:none">🎥</a>`);
  if (c.link_autorizacao) links.push(`<a href="${esc(c.link_autorizacao)}" target="_blank" rel="noopener" title="Autorização de visita" data-stop="1" style="text-decoration:none">📋</a>`);
  const agend = c.data_agendamento ? (String(c.data_agendamento).substring(0, 10).split('-').reverse().join('/')) : '';
  const horas = c.hora_inicio ? (c.hora_inicio + (c.hora_fim ? '–' + c.hora_fim : '')) : '';
  return `
    <div class="cap-card" draggable="true" data-card="${esc(c.id)}">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="font-weight:800;font-size:13.5px;line-height:1.25">${esc(titulo)} <span class="tiny" style="font-weight:700;color:${obj ? '#a16207' : '#16a34a'}">· ${obj ? 'Locação' : 'Venda'}</span></div>
        <span class="tiny" style="white-space:nowrap;font-weight:700;color:${c.codigo_kenlo ? '#8b5cf6' : '#cbd5e1'}" title="Código Kenlo">🏷 ${c.codigo_kenlo ? esc(c.codigo_kenlo) : '—'}</span>
      </div>
      ${(c.tipo_imovel || subnome) ? `<div class="flex gap-1" style="flex-wrap:wrap;align-items:center;margin-top:5px">
        ${tipoFlag(c.tipo_imovel)}
        ${subnome ? `<span class="tiny muted">${esc(subnome)}</span>` : ''}
      </div>` : ''}
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:7px">
        ${sit ? `<span class="cap-chip" style="background:${sit.cor}1f;color:${sit.cor}">${sit.lbl}</span>` : ''}
        ${valor ? `<span class="cap-chip" style="background:rgba(148,163,184,.18);color:var(--ink,#0f172a)">${esc(valor)}</span>` : ''}
        ${precisa.length ? `<span class="cap-chip" style="background:rgba(148,163,184,.14)">${precisa.join('')}</span>` : ''}
      </div>
      ${pend && c.pendencia !== 'atualizado' ? `<div class="tiny" style="margin-top:6px;color:${pend.cor};font-weight:600">⚠ ${pend.lbl}</div>` : ''}
      ${termo ? `<div class="tiny" style="margin-top:4px;color:${termo.cor}">📋 ${termo.lbl}</div>` : ''}
      ${c.proprietario ? `<div class="tiny muted" style="margin-top:6px">👤 ${esc(c.proprietario)}${c.contato ? ' · ' + esc(c.contato) : ''}</div>` : (c.contato ? `<div class="tiny muted" style="margin-top:6px">📞 ${esc(c.contato)}</div>` : '')}
      ${agend ? `<div class="tiny muted" style="margin-top:4px">📅 ${esc(agend)}${horas ? ' · ' + esc(horas) : ''}</div>` : ''}
      ${c.local_chaves ? `<div class="tiny muted" style="margin-top:4px">🔑 ${esc(c.local_chaves)}</div>` : ''}
      ${links.length ? `<div class="flex gap-2" style="margin-top:6px;font-size:15px">${links.join('')}</div>` : ''}
      ${c.responsavel ? `<div class="flex" style="align-items:center;gap:6px;margin-top:8px">
        <span style="width:20px;height:20px;border-radius:50%;background:${colorFor(c.responsavel)};color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center">${esc(initials(c.responsavel))}</span>
        <span class="tiny muted">${esc(c.responsavel)}</span>
      </div>` : ''}
      <select class="cap-move" data-stop="1" data-card="${esc(c.id)}" title="Mover para outra etapa" style="margin-top:8px;width:100%;font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg-2,#fff);color:var(--ink,#0f172a);cursor:pointer">
        ${ALL_STATUS.map(s => `<option value="${esc(s.id)}"${s.id === c.status ? ' selected' : ''}>↪ ${esc(s.lbl)}</option>`).join('')}
      </select>
    </div>`;
}

function bindBoard() {
  document.querySelectorAll('.cap-card').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) return;
      // Não abrir o modal logo após um arrasto (o clique "fantasma" pós-drop)
      if (Date.now() - _lastDrop < 300) return;
      _editing = _items.find(x => x.id === el.dataset.card); openForm();
    });
    el.addEventListener('dragstart', e => {
      _dragId = el.dataset.card;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.card); } catch (_) {}  // cross-browser (Firefox exige)
    });
    el.addEventListener('dragend', () => { _lastDrop = Date.now(); _dragId = null; el.classList.remove('dragging'); document.querySelectorAll('.cap-col.drop').forEach(c => c.classList.remove('drop')); });
  });
  document.querySelectorAll('.cap-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drop'); });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('drop');
      _lastDrop = Date.now();
      const id = _dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      if (id) moveCard(id, col.dataset.status);
    });
  });
  // Mover por seletor (qualquer etapa → qualquer etapa, 1 clique, sem drag)
  document.querySelectorAll('.cap-move').forEach(sel => {
    sel.addEventListener('mousedown', e => e.stopPropagation());
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => { e.stopPropagation(); moveCard(sel.dataset.card, sel.value); });
  });
}

async function moveCard(id, status) {
  if (!id || !status) return;
  const item = _items.find(x => x.id === id);
  if (!item || item.status === status) return;
  const prev = item.status;
  item.status = status;        // otimista
  renderBoard();
  try {
    await api.request('/api/v3/captacoes/kanban', { method: 'POST', body: { action: 'move', id, status } });
  } catch (e) {
    item.status = prev; renderBoard();
    alert('Erro ao mover: ' + e.message);
  }
}

function openForm() {
  const c = _editing || {};
  const isLider = (auth.user()?.lvl || 0) >= 5;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  overlay.innerHTML = `
    <div class="card" style="max-width:640px;width:100%;background:var(--bg-2);margin:auto">
      <div class="flex" style="justify-content:space-between;align-items:center">
        <h3 class="card-title">${c.id ? '✏️ Editar' : '➕ Nova'} Captação</h3>
        <button class="btn btn-ghost btn-sm" id="cf-x">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        ${inp('cf-nome', 'Nome do imóvel', c.nome_imovel, 'Ex.: Residencial X / Apto 1203')}
        ${sel('cf-obj', 'Objetivo', [['venda', 'Venda'], ['locacao', 'Locação']], c.objetivo)}
        ${sel('cf-status', 'Status', ALL_STATUS.map(s => [s.id, s.lbl]), c.status)}
        ${sel('cf-tipo', 'Tipo de imóvel', [['', '—'], ...TIPOS.map(t => [t.v, t.ic + ' ' + t.v])], c.tipo_imovel)}
        ${inp('cf-cond', 'Condomínio / Edifício', c.condominio, 'nome (opcional)')}

        <div style="grid-column:1/-1;margin-top:4px;border-top:1px solid var(--border);padding-top:8px"><b class="tiny" style="color:#16a34a">📍 Endereço <span class="muted" style="font-weight:400">(monta o título do card)</span></b></div>
        ${inp('cf-end', 'Endereço (rua/av + nº)', c.endereco, 'Ex.: Rua Guatemala, 123')}
        ${inp('cf-bairro', 'Bairro ⭐', c.bairro, 'obrigatório a partir da captura (vira pino no Mapa)')}
        ${inp('cf-quadra', 'Quadra', c.quadra)}
        ${inp('cf-lote', 'Lote', c.lote)}
        ${inp('cf-bloco', 'Bloco', c.bloco)}
        ${inp('cf-unidade', 'Apto / Unidade', c.unidade)}
        ${inp('cf-loc', 'Complemento / referência', c.localizacao, 'opcional')}
        ${respSelect(c)}
        ${sel('cf-sit', 'Situação do imóvel', [['', '—'], ...SITUACOES.map(s => [s.id, s.lbl])], c.situacao_imovel)}
        ${inp('cf-chaves', '🔑 Local de chaves ou senha', c.local_chaves, 'ex: cofre da portaria, senha 1234, com o zelador')}
        ${sel('cf-pend', 'Pendência', [['', '—'], ...PENDENCIAS.map(p => [p.id, p.lbl])], c.pendencia)}
        ${sel('cf-termo', 'Termo Autorização', [['', '—'], ...TERMOS.map(t => [t.id, t.lbl])], c.termo_autorizacao)}
        ${inp('cf-lautoriz', 'Link autorização de visita', c.link_autorizacao, 'Drive / URL')}
        ${inp('cf-prop', 'Proprietário', c.proprietario)}
        ${inp('cf-ctt', 'Contato', c.contato)}
        ${inp('cf-email', 'Email', c.email)}
        ${inp('cf-vv', 'Valor de venda (R$) ⭐', c.valor_venda, 'obrigatório p/ entrar no inventário', 'number')}
        ${inp('cf-kenlo', 'Código Kenlo', c.codigo_kenlo)}

        <div style="grid-column:1/-1;margin-top:4px;border-top:1px solid var(--border);padding-top:8px"><b class="tiny" style="color:#3b82f6">📅 Agendamento</b></div>
        ${inp('cf-agend', 'Data', (c.data_agendamento || '').substring(0, 10), '', 'date')}
        <div class="flex gap-2">
          <div style="flex:1">${inp('cf-hini', 'Hora início', c.hora_inicio, '', 'time')}</div>
          <div style="flex:1">${inp('cf-hfim', 'Hora fim', c.hora_fim, '', 'time')}</div>
        </div>

        <div style="grid-column:1/-1;margin-top:4px;border-top:1px solid var(--border);padding-top:8px"><b class="tiny" style="color:#a16207">🏠 Locação</b></div>
        ${inp('cf-vl', 'Valor locação (R$) ⭐', c.valor_locacao, 'obrigatório p/ entrar no inventário', 'number')}
        ${inp('cf-vcond', 'Valor condomínio (R$)', c.valor_condominio, '', 'number')}
        ${inp('cf-viptu', 'Valor IPTU (R$)', c.valor_iptu, '', 'number')}
        <div class="flex gap-2" style="align-items:flex-end">
          <div style="flex:1">${inp('cf-taxa', 'Taxa adm', c.taxa_adm_valor, '', 'number')}</div>
          <div style="width:90px">${sel('cf-taxatipo', 'em', [['pct', '%'], ['valor', 'R$']], c.taxa_adm_tipo || 'pct')}</div>
        </div>

        <div style="grid-column:1/-1;margin-top:4px;border-top:1px solid var(--border);padding-top:8px"><b class="tiny" style="color:#3b82f6">📎 Mídia captada</b></div>
        ${inp('cf-lfotos', 'Link das fotos', c.link_fotos, 'Drive / URL')}
        ${inp('cf-lvideos', 'Link dos vídeos', c.link_videos, 'Drive / URL')}
      </div>
      <div class="flex gap-3 mt-2" style="flex-wrap:wrap">
        <label class="tiny flex gap-1" style="align-items:center"><input type="checkbox" id="cf-fotos" ${c.precisa_fotos ? 'checked' : ''}> 📷 Precisa Fotos</label>
        <label class="tiny flex gap-1" style="align-items:center"><input type="checkbox" id="cf-videos" ${c.precisa_videos ? 'checked' : ''}> 🎥 Precisa Vídeos</label>
        <label class="tiny flex gap-1" style="align-items:center"><input type="checkbox" id="cf-aval" ${c.precisa_avaliacao ? 'checked' : ''}> 💰 Precisa Avaliação</label>
      </div>
      <div class="mt-2"><label class="tiny muted">Descrição do imóvel</label><textarea id="cf-desc" class="input" rows="2">${esc(c.descricao || '')}</textarea></div>
      <div class="mt-2"><label class="tiny muted">Observação</label><textarea id="cf-obs" class="input" rows="2">${esc(c.observacao || '')}</textarea></div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" id="cf-save">💾 Salvar</button>
        ${c.id && isLider ? '<button class="btn btn-ghost" id="cf-del" style="color:#ef4444">🗑 Excluir</button>' : ''}
      </div>
      <div id="cf-msg" class="mt-2"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cf-x').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#cf-save').addEventListener('click', () => saveForm(overlay));
  const del = overlay.querySelector('#cf-del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Excluir captação?')) return;
    try { await api.request('/api/v3/captacoes/kanban?id=' + encodeURIComponent(c.id), { method: 'DELETE' }); overlay.remove(); await load(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

async function saveForm(overlay) {
  const g = id => overlay.querySelector('#' + id);
  const num = id => { const v = parseFloat(g(id).value); return isNaN(v) ? null : v; };
  const respEl = g('cf-resp');
  const respOpt = respEl ? respEl.options[respEl.selectedIndex] : null;
  const payload = {
    id: _editing?.id,
    status: g('cf-status').value,
    objetivo: g('cf-obj').value,
    nome_imovel: g('cf-nome').value.trim(),
    tipo_imovel: g('cf-tipo').value,
    condominio: g('cf-cond').value.trim(),
    endereco: g('cf-end').value.trim(),
    bairro: g('cf-bairro').value.trim(),
    quadra: g('cf-quadra').value.trim(),
    lote: g('cf-lote').value.trim(),
    bloco: g('cf-bloco').value.trim(),
    unidade: g('cf-unidade').value.trim(),
    localizacao: g('cf-loc').value.trim(),
    responsavel_id: respEl ? respEl.value : null,
    responsavel: respOpt ? (respOpt.dataset.name || respOpt.textContent || '').trim() : '',
    situacao_imovel: g('cf-sit').value,
    local_chaves: g('cf-chaves').value.trim(),
    pendencia: g('cf-pend').value,
    termo_autorizacao: g('cf-termo').value,
    proprietario: g('cf-prop').value.trim(),
    contato: g('cf-ctt').value.trim(),
    email: g('cf-email').value.trim(),
    valor_venda: num('cf-vv'),
    valor_locacao: g('cf-vl').value.trim(),
    valor_condominio: num('cf-vcond'),
    valor_iptu: num('cf-viptu'),
    taxa_adm_valor: num('cf-taxa'),
    taxa_adm_tipo: g('cf-taxatipo').value,
    link_fotos: g('cf-lfotos').value.trim(),
    link_videos: g('cf-lvideos').value.trim(),
    codigo_kenlo: g('cf-kenlo').value.trim(),
    data_agendamento: g('cf-agend').value || null,
    hora_inicio: g('cf-hini').value || null,
    hora_fim: g('cf-hfim').value || null,
    link_autorizacao: g('cf-lautoriz').value.trim(),
    precisa_fotos: g('cf-fotos').checked,
    precisa_videos: g('cf-videos').checked,
    precisa_avaliacao: g('cf-aval').checked,
    descricao: g('cf-desc').value.trim(),
    observacao: g('cf-obs').value.trim(),
  };
  if (!payload.nome_imovel && !payload.condominio && !payload.proprietario) {
    g('cf-msg').innerHTML = '<div class="alert alert-err">Informe ao menos Nome do imóvel, Condomínio/Bairro ou Proprietário</div>';
    return;
  }
  // ⭐ A partir da etapa de CAPTURA, a captação vira imóvel do inventário (Imóveis + Mapa):
  // exige Bairro (pino no mapa) + Valor (estoque). Etapas iniciais de prospecção ficam livres.
  const CAPTURED = ['colher_dados', 'edicao_fotos', 'subir_kenlo', 'agendar_mlabs', 'concluido'];
  if (CAPTURED.includes(payload.status)) {
    const temValor = payload.objetivo === 'locacao'
      ? (parseFloat(payload.valor_locacao) > 0)
      : ((payload.valor_venda || 0) > 0);
    const faltam = [];
    if (!payload.bairro) faltam.push('Bairro');
    if (!temValor) faltam.push(payload.objetivo === 'locacao' ? 'Valor de locação' : 'Valor de venda');
    if (faltam.length) {
      if (!payload.bairro) g('cf-bairro').style.borderColor = '#dc2626';
      const vEl = g(payload.objetivo === 'locacao' ? 'cf-vl' : 'cf-vv'); if (vEl && !temValor) vEl.style.borderColor = '#dc2626';
      g('cf-msg').innerHTML = `<div class="alert alert-warn">📍 Pra entrar no inventário de <b>Imóveis</b> + aparecer no <b>Mapa</b>, preencha: <b>${faltam.join(' e ')}</b>. (Obrigatório a partir da etapa de captura.)</div>`;
      return;
    }
  }
  g('cf-msg').innerHTML = '<div class="muted tiny"><span class="spinner"></span> Salvando…</div>';
  try {
    const res = await api.request('/api/v3/captacoes/kanban', { method: 'POST', body: payload });
    if (res && res.dropped && res.dropped.length) {
      await load();
      g('cf-msg').innerHTML = `<div class="alert alert-warn">Salvo — mas os campos <b>${esc(res.dropped.join(', '))}</b> ainda não existem no banco. Rode <code>supabase/sprint9_16</code> pra eles persistirem.</div>`;
      return;
    }
    overlay.remove();
    await load();
  } catch (e) {
    g('cf-msg').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function inp(id, label, val, ph, type) {
  return `<div><label class="tiny muted">${label}</label><input id="${id}" class="input" type="${type || 'text'}" value="${esc(val ?? '')}" placeholder="${esc(ph || '')}"></div>`;
}
function sel(id, label, opts, cur) {
  return `<div><label class="tiny muted">${label}</label><select id="${id}" class="select">${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
}
function respSelect(c) {
  const curId = c.responsavel_id || '';
  const curName = (c.responsavel || '').trim();
  const matchName = u => curName && (u.name || '').toLowerCase().startsWith(curName.toLowerCase());
  const inList = _users.some(u => u.id === curId || matchName(u));
  const opts = ['<option value="">— Selecione —</option>']
    .concat(_users.map(u => {
      const isSel = (curId && u.id === curId) || (!curId && matchName(u));
      return `<option value="${esc(u.id)}" data-name="${esc(u.name || u.email || '')}"${isSel ? ' selected' : ''}>${esc(u.name || u.email || u.id)}</option>`;
    }));
  if (curName && !inList) {
    // responsável legado (texto) que não bate com nenhum user — mantém selecionável
    opts.push(`<option value="" data-name="${esc(curName)}" selected>${esc(curName)} (texto)</option>`);
  }
  return `<div><label class="tiny muted">Responsável</label><select id="cf-resp" class="select">${opts.join('')}</select></div>`;
}
function kpi(label, value, color) {
  return `<div class="cap-kpi" style="border-top:3px solid ${color}"><div class="tiny muted">${label}</div><div style="font-size:19px;font-weight:800;color:${color};line-height:1.3">${value}</div></div>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
