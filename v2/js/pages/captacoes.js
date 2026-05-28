/* PSM-OS v2 — Captações Kanban (modelo Notion PSM) — Sprint 9.5 */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];
let _editing = null;

// Status agrupados (= colunas Kanban do Notion)
const FASES = [
  { fase: 'A fazer', cor: '#dc2626', status: [
    { id: 'colher_dados',  lbl: 'Colher Dados',     cor: '#a16207' },
    { id: 'a_fazer',       lbl: 'À Fazer Captação', cor: '#dc2626' },
    { id: 'agendar_prop',  lbl: 'Agendar c/ Prop',  cor: '#ea580c' },
    { id: 'agendado',      lbl: 'Agendado',         cor: '#3b82f6' },
    { id: 'pausado',       lbl: 'Pausado',          cor: '#64748b' },
  ]},
  { fase: 'Em andamento', cor: '#f59e0b', status: [
    { id: 'aguardando_autorizacao', lbl: 'Aguardando Autorização', cor: '#a16207' },
    { id: 'captacao_realizada',     lbl: 'Captação Realizada',     cor: '#ca8a04' },
    { id: 'edicao_fotos',           lbl: 'Edição Fotos',           cor: '#3b82f6' },
    { id: 'edicao_videos',          lbl: 'Edição Vídeos',          cor: '#8b5cf6' },
    { id: 'aprovacao',              lbl: 'Aprovação',              cor: '#ca8a04' },
  ]},
  { fase: 'Concluídos', cor: '#16a34a', status: [
    { id: 'a_fazer_formulario', lbl: 'À Fazer Formulário', cor: '#3b82f6' },
    { id: 'formulario_kenlo',   lbl: 'Formulário → Kenlo', cor: '#8b5cf6' },
    { id: 'subir_kenlo',        lbl: 'Subir Direto Kenlo', cor: '#8b5cf6' },
    { id: 'agendar_mlabs',      lbl: 'Agendar Mlabs',      cor: '#ca8a04' },
    { id: 'refazer',            lbl: 'Refazer',            cor: '#dc2626' },
    { id: 'aprovado',           lbl: 'Aprovado',           cor: '#16a34a' },
    { id: 'concluido',          lbl: 'Concluído',          cor: '#16a34a' },
  ]},
];
const ALL_STATUS = FASES.flatMap(f => f.status);
const statusCor = id => (ALL_STATUS.find(s => s.id === id)?.cor) || '#64748b';

const TIPOS = ['Apartamento', 'Studio', 'Casa em condomínio', 'Casa', 'Terreno condomínio', 'Loja', 'Sala Comercial', 'Casa Comercial', 'Salão'];
const SITUACOES = [
  { id: 'desocupado', lbl: 'Desocupado', cor: '#16a34a' },
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

export async function pageCaptacoes(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/captacoes/kanban');
    _items = r.captacoes || [];
    renderBoard();
  } catch (e) {
    const b = document.getElementById('cap-board');
    if (b) b.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">📥 Captações — Kanban</h2>
          <p class="card-sub">Pipeline de captação de imóveis · notifica responsável + marketing automaticamente</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="cap-refresh">🔄</button>
          <button class="btn btn-primary" id="cap-novo">➕ Nova Captação</button>
        </div>
      </div>
      <div id="cap-stats" class="mt-3"></div>
      <div id="cap-board" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  document.getElementById('cap-novo').addEventListener('click', () => { _editing = { status: 'colher_dados', objetivo: 'venda' }; openForm(); });
  document.getElementById('cap-refresh').addEventListener('click', load);
}

function renderBoard() {
  const stats = document.getElementById('cap-stats');
  const total = _items.length;
  const porFase = FASES.map(f => ({ fase: f.fase, cor: f.cor, n: _items.filter(i => f.status.some(s => s.id === i.status)).length }));
  stats.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px">
      ${kpi('Total', total, '#3b82f6')}
      ${porFase.map(f => kpi(f.fase, f.n, f.cor)).join('')}
    </div>
  `;

  const board = document.getElementById('cap-board');
  board.innerHTML = `
    <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:12px;align-items:flex-start">
      ${FASES.map(fase => faseColumn(fase)).join('')}
    </div>
  `;
  bindBoard();
}

function faseColumn(fase) {
  return `
    <div style="min-width:300px;max-width:330px;flex:1">
      <div style="font-weight:800;color:${fase.cor};font-size:13px;text-transform:uppercase;letter-spacing:1px;padding:6px 8px;border-bottom:2px solid ${fase.cor};margin-bottom:8px">
        ${fase.fase}
      </div>
      ${fase.status.map(st => {
        const cards = _items.filter(i => i.status === st.id);
        if (cards.length === 0) return '';
        return `
          <div style="margin-bottom:10px">
            <div class="tiny" style="color:${st.cor};font-weight:700;padding:2px 6px">● ${st.lbl} (${cards.length})</div>
            ${cards.map(c => card(c)).join('')}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function card(c) {
  const sit = SITUACOES.find(s => s.id === c.situacao_imovel);
  const pend = PENDENCIAS.find(p => p.id === c.pendencia);
  const termo = TERMOS.find(t => t.id === c.termo_autorizacao);
  const precisa = [];
  if (c.precisa_fotos) precisa.push('📷');
  if (c.precisa_videos) precisa.push('🎥');
  if (c.precisa_avaliacao) precisa.push('💰');
  return `
    <div data-card="${c.id}" style="background:var(--bg-3);border-left:3px solid ${statusCor(c.status)};border-radius:8px;padding:10px;margin-bottom:6px;cursor:pointer;font-size:12px">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="font-weight:800;flex:1">${esc(c.condominio || 'Sem nome')}</div>
        ${precisa.length ? `<span>${precisa.join('')}</span>` : ''}
      </div>
      <div class="tiny muted">${esc(c.tipo_imovel || '')}${c.localizacao ? ' · ' + esc(c.localizacao) : ''}</div>
      <div class="flex gap-1 mt-1" style="flex-wrap:wrap">
        ${c.objetivo ? `<span style="background:${c.objetivo === 'locacao' ? '#a16207' : '#16a34a'}33;color:${c.objetivo === 'locacao' ? '#a16207' : '#16a34a'};padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700">${c.objetivo === 'locacao' ? 'Locação' : 'Venda'}</span>` : ''}
        ${c.responsavel ? `<span style="background:#6366f133;color:#a5b4fc;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700">${esc(c.responsavel)}</span>` : ''}
        ${sit ? `<span style="background:${sit.cor}22;color:${sit.cor};padding:1px 6px;border-radius:4px;font-size:10px">${sit.lbl}</span>` : ''}
      </div>
      ${pend ? `<div class="tiny mt-1" style="color:${pend.cor}">⚠ ${pend.lbl}</div>` : ''}
      ${termo ? `<div class="tiny mt-1" style="color:${termo.cor}">📋 ${termo.lbl}</div>` : ''}
      ${c.proprietario ? `<div class="tiny muted mt-1">👤 ${esc(c.proprietario)}${c.contato ? ' · ' + esc(c.contato) : ''}</div>` : ''}
    </div>
  `;
}

function bindBoard() {
  document.querySelectorAll('[data-card]').forEach(el => el.addEventListener('click', () => {
    _editing = _items.find(x => x.id === el.dataset.card);
    openForm();
  }));
}

function openForm() {
  const c = _editing || {};
  const isLider = (auth.user()?.lvl || 0) >= 5;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  overlay.innerHTML = `
    <div class="card" style="max-width:620px;width:100%;background:var(--bg-2);margin:auto">
      <div class="flex" style="justify-content:space-between;align-items:center">
        <h3 class="card-title">${c.id ? '✏️ Editar' : '➕ Nova'} Captação</h3>
        <button class="btn btn-ghost btn-sm" id="cf-x">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        ${sel('cf-status', 'Status', ALL_STATUS.map(s => [s.id, s.lbl]), c.status)}
        ${sel('cf-obj', 'Objetivo', [['venda', 'Venda'], ['locacao', 'Locação']], c.objetivo)}
        ${sel('cf-tipo', 'Tipo de imóvel', [['', '—'], ...TIPOS.map(t => [t, t])], c.tipo_imovel)}
        ${inp('cf-cond', 'Condomínio / Bairro', c.condominio)}
        ${inp('cf-loc', 'Quadra/Lote/APT/Rua nº', c.localizacao)}
        ${inp('cf-resp', 'Responsável', c.responsavel, 'Gui, Mariane, Paulo, Isabella, Leire')}
        ${sel('cf-sit', 'Situação do imóvel', [['', '—'], ...SITUACOES.map(s => [s.id, s.lbl])], c.situacao_imovel)}
        ${sel('cf-pend', 'Pendência', [['', '—'], ...PENDENCIAS.map(p => [p.id, p.lbl])], c.pendencia)}
        ${sel('cf-termo', 'Termo Autorização', [['', '—'], ...TERMOS.map(t => [t.id, t.lbl])], c.termo_autorizacao)}
        ${inp('cf-prop', 'Proprietário', c.proprietario)}
        ${inp('cf-ctt', 'Contato', c.contato)}
        ${inp('cf-email', 'Email', c.email)}
        ${inp('cf-vv', 'Valor de venda (R$)', c.valor_venda, '', 'number')}
        ${inp('cf-vl', 'Valor locação / COND / IPTU', c.valor_locacao)}
        ${inp('cf-kenlo', 'Código Kenlo', c.codigo_kenlo)}
        ${inp('cf-agend', 'Data agendamento', c.data_agendamento, '', 'date')}
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
  const payload = {
    id: _editing?.id,
    status: g('cf-status').value,
    objetivo: g('cf-obj').value,
    tipo_imovel: g('cf-tipo').value,
    condominio: g('cf-cond').value.trim(),
    localizacao: g('cf-loc').value.trim(),
    responsavel: g('cf-resp').value.trim(),
    situacao_imovel: g('cf-sit').value,
    pendencia: g('cf-pend').value,
    termo_autorizacao: g('cf-termo').value,
    proprietario: g('cf-prop').value.trim(),
    contato: g('cf-ctt').value.trim(),
    email: g('cf-email').value.trim(),
    valor_venda: parseFloat(g('cf-vv').value) || null,
    valor_locacao: g('cf-vl').value.trim(),
    codigo_kenlo: g('cf-kenlo').value.trim(),
    data_agendamento: g('cf-agend').value || null,
    precisa_fotos: g('cf-fotos').checked,
    precisa_videos: g('cf-videos').checked,
    precisa_avaliacao: g('cf-aval').checked,
    descricao: g('cf-desc').value.trim(),
    observacao: g('cf-obs').value.trim(),
  };
  if (!payload.condominio && !payload.proprietario) {
    g('cf-msg').innerHTML = '<div class="alert alert-err">Informe ao menos Condomínio/Bairro ou Proprietário</div>';
    return;
  }
  g('cf-msg').innerHTML = '<div class="muted tiny"><span class="spinner"></span> Salvando…</div>';
  try {
    await api.request('/api/v3/captacoes/kanban', { method: 'POST', body: payload });
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
function kpi(label, value, color) {
  return `<div style="background:var(--bg-3);border-left:4px solid ${color};padding:10px;border-radius:6px"><div class="tiny muted">${label}</div><div style="font-size:20px;font-weight:800;color:${color}">${value}</div></div>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
