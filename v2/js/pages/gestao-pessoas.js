/* PSM-OS v2 — Gestão de Pessoas (Sprint 8.1) */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { pageTalentos } from './talentos.js';
import { renderAvaliacoes } from './avaliacoes.js';

let _root = null;
let _ctx = null;
let _tab = 'treinamentos';
let _treinamentos = [];
let _editing = null;
let _rh = { onboarding: [], offboarding: [] };   // processos de admissão/desligamento (sócio)
const isSocio = () => (auth.user()?.lvl || 0) >= 10;
const SETORES = ['Comercial', 'SDR / Prospecção', 'Marketing', 'Backoffice', 'Financeiro', 'RH', 'Diretoria', 'Locação'];
const EQUIPES_COM = ['Conquista', 'MAP', 'Locação', 'Terceiros'];
let _trSetor = '', _trEquipe = '';   // filtros do Treinamentos

// Abas do hub de Pessoas, na ordem pedida (v81.52). Onboarding/Offboarding = só
// sócio (lvl 10); o resto = líder+ (lvl 5).
function visibleTabs() {
  // v81.58: cada aba é rota própria na barra lateral e o acesso é decidido na matriz
  // por papel (Configurações → Permissões). Aqui só validamos o _tab do deep-link —
  // por isso TODAS entram (sem filtro de sócio, que resetava o tab errado).
  return [
    { id: 'treinamentos', lbl: '🎓 Treinamentos' },
    { id: 'onboarding', lbl: '🚀 Onboarding' },
    { id: 'offboarding', lbl: '👋 Offboarding' },
    { id: 'talentos', lbl: '🧲 Recrutamento & Seleção' },
    { id: 'plano', lbl: '📈 Plano de Crescimento' },
    { id: 'clima', lbl: '🌡 Clima Interno' },
    { id: 'avaliacoes', lbl: '⭐ Avaliações & Feedbacks' },
  ];
}

// Entradas diretas (deep-link) — cada aba é um item próprio na barra lateral (v81.55)
export async function pageOnboarding(ctx, root) { _tab = 'onboarding'; return pageGestaoPessoas(ctx, root); }
export async function pageOffboarding(ctx, root) { _tab = 'offboarding'; return pageGestaoPessoas(ctx, root); }
export async function pageRhTreinamentos(ctx, root) { _tab = 'treinamentos'; return pageGestaoPessoas(ctx, root); }
export async function pageRhRecrutamento(ctx, root) { _tab = 'talentos'; return pageGestaoPessoas(ctx, root); }
export async function pageRhPlano(ctx, root) { _tab = 'plano'; return pageGestaoPessoas(ctx, root); }
export async function pageRhClima(ctx, root) { _tab = 'clima'; return pageGestaoPessoas(ctx, root); }
export async function pageRhAvaliacoes(ctx, root) { _tab = 'avaliacoes'; return pageGestaoPessoas(ctx, root); }

export async function pageGestaoPessoas(ctx, root) {
  _root = root; _ctx = ctx;
  // v81.58: quem vê isto é decidido na matriz por papel (Configurações → Permissões).
  // Piso mínimo só pra barrar não-autenticado/sem cargo.
  if ((auth.user()?.lvl || 0) < 2) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Sem acesso a este módulo.</div>';
    return;
  }
  const valid = visibleTabs().map(t => t.id);
  if (!valid.includes(_tab)) _tab = valid[0];   // default = 1ª aba visível (sócio→Onboarding)
  render();
  await loadData();
}

// v81.56: cada aba é um item próprio no menu lateral — sem barra de abas interna.
// A página renderiza direto o conteúdo do módulo da rota (_tab) em #gp-body.
function render() {
  _root.innerHTML = `<div id="gp-body"></div>`;
}

async function loadData() {
  if (_tab === 'talentos') return pageTalentos(_ctx, document.getElementById('gp-body'));
  if (_tab === 'onboarding' || _tab === 'offboarding') return loadRH(_tab);
  if (_tab === 'avaliacoes') return renderAvaliacoes(document.getElementById('gp-body'));
  if (_tab === 'plano' || _tab === 'clima') return loadReg(_tab);
  return loadTreinamentos();
}

/* ════════════════════════════════════════════════════════════════════════
   TREINAMENTOS — LMS interno (v81.57): catálogo rico + matrícula/progresso por
   pessoa + materiais + métricas de conclusão. Backend gp/treinamentos2 (shared_kv).
═══════════════════════════════════════════════════════════════════════════ */
let _treinos = [], _trUsers = [];
let _trF = { setor: '', equipe: '', tipo: '', status: '', trilha: '', obrig: '' };
const TR_TIPOS = ['tecnico', 'comportamental', 'comercial', 'lideranca', 'integracao'];
const TR_TIPO_LBL = { tecnico: 'Técnico', comportamental: 'Comportamental', comercial: 'Comercial', lideranca: 'Liderança', integracao: 'Integração' };
const TR_MODAL = ['presencial', 'online', 'gravado'];
const TR_STATUS = { planejado: { l: 'Planejado', c: '#64748b' }, ativo: { l: 'Ativo', c: '#0ea5e9' }, concluido: { l: 'Concluído', c: '#16a34a' }, arquivado: { l: 'Arquivado', c: '#94a3b8' } };
const PART_STATUS = { nao_iniciado: { l: 'Não iniciado', c: '#94a3b8' }, em_andamento: { l: 'Em andamento', c: '#f59e0b' }, concluido: { l: 'Concluído', c: '#16a34a' } };
const MAT_ICO = { link: '🔗', video: '🎬', pdf: '📄', imagem: '🖼', slide: '📊' };
const _hojeTr = () => new Date().toISOString().slice(0, 10);
const _fmtTr = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—';
const trProg = t => { const ps = t.participantes || []; const done = ps.filter(p => p.status === 'concluido').length; return { done, total: ps.length, pct: ps.length ? Math.round(done / ps.length * 100) : 0 }; };
const trAtrasado = t => t.prazo && t.status !== 'concluido' && t.status !== 'arquivado' && String(t.prazo).slice(0, 10) < _hojeTr();

async function loadTreinamentos() {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando treinamentos…</div></div>';
  try {
    const r = await api.request('/api/v3/gp/treinamentos2');
    _treinos = r.treinos || []; _trUsers = r.usuarios || [];
    renderTreinamentos();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function trFiltered() {
  return _treinos.filter(t =>
    (!_trF.setor || t.setor === _trF.setor) && (!_trF.equipe || t.equipe === _trF.equipe) &&
    (!_trF.tipo || t.tipo === _trF.tipo) && (!_trF.status || t.status === _trF.status) &&
    (!_trF.trilha || t.trilha === _trF.trilha) &&
    (!_trF.obrig || (_trF.obrig === 'sim') === !!t.obrigatorio));
}

function renderTreinamentos() {
  const body = document.getElementById('gp-body');
  const list = trFiltered();
  const totalP = _treinos.reduce((a, t) => a + (t.participantes || []).length, 0);
  const doneP = _treinos.reduce((a, t) => a + (t.participantes || []).filter(p => p.status === 'concluido').length, 0);
  const concl = totalP ? Math.round(doneP / totalP * 100) : 0;
  const atrasados = _treinos.filter(trAtrasado).length;
  const ativos = _treinos.filter(t => t.status === 'ativo').length;
  const obrig = _treinos.filter(t => t.obrigatorio).length;
  const trilhas = [...new Set(_treinos.map(t => t.trilha).filter(Boolean))];
  const byPerson = {};
  _treinos.forEach(t => (t.participantes || []).forEach(p => { if (p.status === 'concluido') byPerson[p.nome] = (byPerson[p.nome] || 0) + 1; }));
  const ranking = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const eqStat = {};
  _treinos.forEach(t => { const e = t.equipe || '—'; (t.participantes || []).forEach(p => { eqStat[e] = eqStat[e] || { d: 0, t: 0 }; eqStat[e].t++; if (p.status === 'concluido') eqStat[e].d++; }); });

  body.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div><div style="font-size:20px;font-weight:800">🎓 Treinamentos</div><div class="tiny muted">Catálogo + matrícula e progresso por pessoa, por setor e equipe.</div></div>
      <button class="btn btn-primary" id="tr-new">+ Novo treinamento</button>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:12px">
      ${[['📚 Treinamentos', _treinos.length, ''], ['▶ Ativos', ativos, '#0ea5e9'], ['✅ % Conclusão', concl + '%', '#16a34a'], ['⏰ Atrasados', atrasados, atrasados ? '#ef4444' : ''], ['❗ Obrigatórios', obrig, '#8b5cf6']]
        .map(([l, v, c]) => `<div class="card" style="padding:11px 14px;flex:1;min-width:108px${c ? ';border-left:4px solid ' + c : ''}"><div class="tiny muted">${l}</div><div style="font-size:20px;font-weight:800${c ? ';color:' + c : ''}">${v}</div></div>`).join('')}
    </div>
    ${(Object.keys(eqStat).length || ranking.length) ? `<div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      ${Object.keys(eqStat).length ? `<div class="card" style="padding:12px;flex:1;min-width:230px"><div style="font-weight:800;font-size:13px;margin-bottom:6px">Conclusão por equipe</div>${Object.entries(eqStat).map(([e, s]) => { const p = s.t ? Math.round(s.d / s.t * 100) : 0; return `<div style="margin-bottom:5px"><div class="flex" style="justify-content:space-between"><span class="tiny">${esc(e)}</span><span class="tiny muted">${p}% (${s.d}/${s.t})</span></div><div style="height:6px;background:var(--bg-3,#e2e8f0);border-radius:99px;overflow:hidden"><div style="height:100%;width:${p}%;background:#16a34a"></div></div></div>`; }).join('')}</div>` : ''}
      ${ranking.length ? `<div class="card" style="padding:12px;flex:1;min-width:200px"><div style="font-weight:800;font-size:13px;margin-bottom:6px">🏆 Quem mais concluiu</div>${ranking.map(([n, c], i) => `<div class="flex tiny" style="justify-content:space-between;padding:2px 0"><span>${['🥇', '🥈', '🥉', '4º', '5º'][i]} ${esc(n)}</span><b>${c}</b></div>`).join('')}</div>` : ''}
    </div>` : ''}
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:12px">
      <select id="trf-setor" class="select" style="max-width:150px"><option value="">Setor: todos</option>${SETORES.map(s => `<option${_trF.setor === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="trf-equipe" class="select" style="max-width:140px"><option value="">Equipe: todas</option>${EQUIPES_COM.map(e => `<option${_trF.equipe === e ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select>
      <select id="trf-tipo" class="select" style="max-width:140px"><option value="">Tipo: todos</option>${TR_TIPOS.map(t => `<option value="${t}"${_trF.tipo === t ? ' selected' : ''}>${TR_TIPO_LBL[t]}</option>`).join('')}</select>
      <select id="trf-status" class="select" style="max-width:140px"><option value="">Status: todos</option>${Object.keys(TR_STATUS).map(s => `<option value="${s}"${_trF.status === s ? ' selected' : ''}>${TR_STATUS[s].l}</option>`).join('')}</select>
      ${trilhas.length ? `<select id="trf-trilha" class="select" style="max-width:160px"><option value="">Trilha: todas</option>${trilhas.map(t => `<option${_trF.trilha === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
      <select id="trf-obrig" class="select" style="max-width:130px"><option value="">Obrig.: todos</option><option value="sim"${_trF.obrig === 'sim' ? ' selected' : ''}>Obrigatórios</option><option value="nao"${_trF.obrig === 'nao' ? ' selected' : ''}>Opcionais</option></select>
    </div>
    ${!list.length ? `<div class="card muted tiny" style="text-align:center;padding:34px">Nenhum treinamento${_treinos.length ? ' com esse filtro' : ' ainda — clique em + Novo treinamento'}.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">${list.map(trCard).join('')}</div>`}`;

  ['setor', 'equipe', 'tipo', 'status', 'trilha', 'obrig'].forEach(k => { const el = document.getElementById('trf-' + k); if (el) el.onchange = () => { _trF[k] = el.value; renderTreinamentos(); }; });
  document.getElementById('tr-new').onclick = () => openTrEditor(null);
  body.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => openTrEditor(_treinos.find(t => t.id === b.dataset.tr)));
}

function trCard(t) {
  const pr = trProg(t), st = TR_STATUS[t.status] || TR_STATUS.ativo, atr = trAtrasado(t);
  const barcor = pr.pct >= 80 ? '#16a34a' : pr.pct >= 40 ? '#f59e0b' : '#ef4444';
  return `<div class="card" style="padding:13px;cursor:pointer;border-left:4px solid ${st.c}" data-tr="${esc(t.id)}">
    <div class="flex items-center" style="justify-content:space-between;gap:8px">
      <div style="font-weight:800;font-size:14px;line-height:1.25">${esc(t.titulo)}${t.obrigatorio ? ' <span class="tiny" style="color:#8b5cf6">❗obrig.</span>' : ''}</div>
      <span class="tiny" style="color:${st.c};font-weight:800;white-space:nowrap">${st.l}</span>
    </div>
    <div class="flex gap-1" style="flex-wrap:wrap;margin:6px 0">
      <span class="tiny" style="background:rgba(99,102,241,.12);color:#4f46e5;padding:1px 7px;border-radius:99px">${esc(TR_TIPO_LBL[t.tipo] || t.tipo || '—')}</span>
      ${t.equipe ? `<span class="tiny" style="background:rgba(22,163,74,.14);color:#15803d;padding:1px 7px;border-radius:99px">${esc(t.equipe)}</span>` : ''}
      ${t.setor ? `<span class="tiny" style="background:rgba(14,165,233,.14);color:#0369a1;padding:1px 7px;border-radius:99px">${esc(t.setor)}</span>` : ''}
      ${t.modalidade ? `<span class="tiny muted">${esc(t.modalidade)}</span>` : ''}
      ${t.trilha ? `<span class="tiny" style="background:rgba(214,36,159,.12);color:#be185d;padding:1px 7px;border-radius:99px">🛤 ${esc(t.trilha)}</span>` : ''}
    </div>
    ${(t.participantes && t.participantes.length) ? `<div style="height:7px;background:var(--bg-3,#e2e8f0);border-radius:99px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${pr.pct}%;background:${barcor}"></div></div>
      <div class="tiny muted" style="margin-top:4px">${pr.done}/${pr.total} concluíram (${pr.pct}%)${(t.materiais && t.materiais.length) ? ' · ' + t.materiais.length + ' material(is)' : ''}</div>`
      : `<div class="tiny muted" style="margin-top:4px">Sem matrículas${(t.materiais && t.materiais.length) ? ' · ' + t.materiais.length + ' material(is)' : ''}</div>`}
    ${t.prazo ? `<div class="tiny" style="margin-top:4px;color:${atr ? '#b91c1c' : 'var(--ink-muted,#94a3b8)'}">${atr ? '⚠ atrasado · ' : '📅 '}prazo ${_fmtTr(t.prazo)}</div>` : ''}
  </div>`;
}

function openTrEditor(t0) {
  const t = t0 ? JSON.parse(JSON.stringify(t0)) : { tipo: 'tecnico', status: 'ativo', obrigatorio: false, materiais: [], participantes: [] };
  if (!t.materiais) t.materiais = []; if (!t.participantes) t.participantes = [];
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto';
  ov.innerHTML = `<div id="tr-modal" style="background:var(--bg-1,#fff);border-radius:14px;max-width:680px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);margin:auto"></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  const m = ov.querySelector('#tr-modal');

  const readForm = () => {
    const g = id => { const el = m.querySelector('#' + id); return el ? el.value : undefined; };
    ['titulo', 'descricao', 'tipo', 'setor', 'equipe', 'modalidade', 'carga_horaria', 'instrutor', 'data_inicio', 'prazo', 'trilha', 'status'].forEach(k => { const v = g('tr-' + k); if (v !== undefined) t[k] = v; });
    const ob = m.querySelector('#tr-obrig'); if (ob) t.obrigatorio = ob.checked;
    m.querySelectorAll('[data-pstatus]').forEach(s => { const p = t.participantes.find(x => x.user_id === s.dataset.pstatus); if (p) p.status = s.value; });
    m.querySelectorAll('[data-pnota]').forEach(n => { const p = t.participantes.find(x => x.user_id === n.dataset.pnota); if (p) p.nota = n.value; });
    m.querySelectorAll('[data-mtipo]').forEach(el => { if (t.materiais[+el.dataset.mtipo]) t.materiais[+el.dataset.mtipo].tipo = el.value; });
    m.querySelectorAll('[data-mtitulo]').forEach(el => { if (t.materiais[+el.dataset.mtitulo]) t.materiais[+el.dataset.mtitulo].titulo = el.value; });
    m.querySelectorAll('[data-murl]').forEach(el => { if (t.materiais[+el.dataset.murl]) t.materiais[+el.dataset.murl].url = el.value; });
  };

  const render = () => {
    const livres = _trUsers.filter(u => !t.participantes.some(p => p.user_id === u.id));
    m.innerHTML = `
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${t.id ? 'Editar' : 'Novo'} treinamento</div>
      <label class="tiny muted">Título *</label>
      <input id="tr-titulo" class="input" value="${esc(t.titulo || '')}" placeholder="Ex.: Técnicas de fechamento MCMV" style="margin-bottom:8px">
      <label class="tiny muted">Objetivo / descrição</label>
      <textarea id="tr-descricao" class="input" rows="2" style="margin-bottom:8px">${esc(t.descricao || '')}</textarea>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:8px">
        <div><label class="tiny muted">Tipo</label><select id="tr-tipo" class="select">${TR_TIPOS.map(x => `<option value="${x}"${t.tipo === x ? ' selected' : ''}>${TR_TIPO_LBL[x]}</option>`).join('')}</select></div>
        <div><label class="tiny muted">Setor</label><select id="tr-setor" class="select"><option value="">—</option>${SETORES.map(s => `<option${t.setor === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div><label class="tiny muted">Equipe</label><select id="tr-equipe" class="select"><option value="">—</option>${EQUIPES_COM.map(e => `<option${t.equipe === e ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
        <div><label class="tiny muted">Modalidade</label><select id="tr-modalidade" class="select"><option value="">—</option>${TR_MODAL.map(x => `<option${t.modalidade === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
        <div><label class="tiny muted">Carga horária</label><input id="tr-carga_horaria" class="input" value="${esc(t.carga_horaria || '')}" placeholder="ex.: 4h"></div>
        <div><label class="tiny muted">Instrutor</label><input id="tr-instrutor" class="input" value="${esc(t.instrutor || '')}"></div>
        <div><label class="tiny muted">Início</label><input id="tr-data_inicio" class="input" type="date" value="${esc((t.data_inicio || '').slice(0, 10))}"></div>
        <div><label class="tiny muted">Prazo</label><input id="tr-prazo" class="input" type="date" value="${esc((t.prazo || '').slice(0, 10))}"></div>
        <div><label class="tiny muted">Trilha</label><input id="tr-trilha" class="input" value="${esc(t.trilha || '')}" placeholder="ex.: Integração"></div>
        <div><label class="tiny muted">Status</label><select id="tr-status" class="select">${Object.keys(TR_STATUS).map(s => `<option value="${s}"${t.status === s ? ' selected' : ''}>${TR_STATUS[s].l}</option>`).join('')}</select></div>
      </div>
      <label class="flex items-center gap-1" style="font-size:13px;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="tr-obrig"${t.obrigatorio ? ' checked' : ''}> Treinamento obrigatório</label>

      <div style="font-weight:800;font-size:13px;margin:8px 0 4px">📎 Materiais</div>
      <div>${(t.materiais || []).map((mt, i) => `<div class="flex gap-1" style="margin-bottom:5px">
        <select class="select" data-mtipo="${i}" style="flex:0 0 96px">${Object.keys(MAT_ICO).map(k => `<option value="${k}"${mt.tipo === k ? ' selected' : ''}>${MAT_ICO[k]} ${k}</option>`).join('')}</select>
        <input class="input" data-mtitulo="${i}" value="${esc(mt.titulo || '')}" placeholder="Nome" style="flex:0 0 30%">
        <input class="input" data-murl="${i}" value="${esc(mt.url || '')}" placeholder="Link/URL" style="flex:1">
        <button class="btn btn-ghost btn-sm" data-mdel="${i}">✕</button></div>`).join('') || '<div class="tiny muted" style="margin-bottom:4px">Nenhum material.</div>'}</div>
      <button class="btn btn-ghost btn-sm" id="tr-addmat">+ material</button>

      <div style="font-weight:800;font-size:13px;margin:12px 0 4px">👥 Matrícula & progresso ${t.participantes.length ? `(${trProg(t).done}/${t.participantes.length} concluíram)` : ''}</div>
      <select id="tr-adduser" class="select" style="width:100%;margin-bottom:6px"><option value="">+ matricular pessoa…</option>${livres.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.id)}${u.team ? ' · ' + esc(u.team) : ''}</option>`).join('')}</select>
      <div>${(t.participantes || []).map(p => `<div class="flex items-center gap-1" style="margin-bottom:5px">
        <span style="flex:1;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.nome)}</span>
        <select class="select" data-pstatus="${esc(p.user_id)}" style="flex:0 0 150px">${Object.keys(PART_STATUS).map(s => `<option value="${s}"${p.status === s ? ' selected' : ''}>${PART_STATUS[s].l}</option>`).join('')}</select>
        <input class="input" data-pnota="${esc(p.user_id)}" value="${p.nota != null ? esc(p.nota) : ''}" placeholder="nota" style="flex:0 0 62px" inputmode="decimal">
        <button class="btn btn-ghost btn-sm" data-pdel="${esc(p.user_id)}">✕</button></div>`).join('') || '<div class="tiny muted">Ninguém matriculado.</div>'}</div>

      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:16px">
        <button class="btn btn-ghost" id="tr-del" ${t.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="tr-cancel">Cancelar</button><button class="btn btn-primary" id="tr-save">Salvar</button></div>
      </div>`;

    m.querySelector('#tr-addmat').onclick = () => { readForm(); t.materiais.push({ tipo: 'link', titulo: '', url: '' }); render(); };
    m.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { readForm(); t.materiais.splice(+b.dataset.mdel, 1); render(); });
    const au = m.querySelector('#tr-adduser'); if (au) au.onchange = () => { if (!au.value) return; readForm(); const u = _trUsers.find(x => x.id === au.value); if (u && !t.participantes.some(p => p.user_id === u.id)) t.participantes.push({ user_id: u.id, nome: u.name || u.id, status: 'nao_iniciado', nota: null, concluido_em: null }); render(); };
    m.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { readForm(); t.participantes = t.participantes.filter(p => p.user_id !== b.dataset.pdel); render(); });
    m.querySelector('#tr-cancel').onclick = () => ov.remove();
    m.querySelector('#tr-del').onclick = async () => { if (!t.id || !confirm('Excluir este treinamento?')) return; try { await api.request('/api/v3/gp/treinamentos2', { method: 'POST', body: { action: 'delete', id: t.id } }); ov.remove(); await loadTreinamentos(); } catch (e) { alert('Erro: ' + e.message); } };
    m.querySelector('#tr-save').onclick = async () => {
      readForm();
      if (!(t.titulo || '').trim()) { m.querySelector('#tr-titulo').focus(); return; }
      t.participantes.forEach(p => { if (p.status === 'concluido' && !p.concluido_em) p.concluido_em = _hojeTr(); if (p.status !== 'concluido') p.concluido_em = null; });
      m.querySelector('#tr-save').disabled = true;
      try { await api.request('/api/v3/gp/treinamentos2', { method: 'POST', body: { action: 'upsert', treino: t } }); ov.remove(); await loadTreinamentos(); }
      catch (e) { alert('Erro ao salvar: ' + e.message); m.querySelector('#tr-save').disabled = false; }
    };
  };
  render();
  setTimeout(() => m.querySelector('#tr-titulo')?.focus(), 50);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ════════════════════════════════════════════════════════════════════════
   ONBOARDING & OFFBOARDING (admissão / desligamento) — só sócio (lvl 10)
   Trilha por etapas com checklist. O template (etapas+itens) mora aqui; o
   backend (gp/rh_processos, shared_kv) só guarda nome/dados + quais itens
   estão marcados. Progresso = itens marcados / total do template. v81.44
═══════════════════════════════════════════════════════════════════════════ */
const RH_TPL = {
  onboarding: {
    titulo: '🚀 Onboarding — admissão', cor: '#16a34a', dataLbl: 'Data de início',
    sub: 'Trilha de entrada do novo colaborador — da papelada à rampa de produção.',
    campos: ['cargo', 'equipe', 'data', 'responsavel'],
    etapas: [
      { id: 'pre', lbl: '📄 Pré-início (documentação)', itens: [
        ['contrato', 'Contrato assinado'], ['docs', 'Documentos (RG, CPF, comprovante)'],
        ['creci', 'CRECI ativo / em transferência'], ['banco', 'Dados bancários p/ comissão'],
        ['lgpd', 'Termo LGPD + confidencialidade'] ] },
      { id: 'dia1', lbl: '🔑 Dia 1 (acessos)', itens: [
        ['login', 'Login House PSM criado'], ['rd', 'Acesso ao RD CRM'],
        ['wpp', 'WhatsApp corporativo'], ['email', 'E-mail / grupos'],
        ['time', 'Apresentação ao time'] ] },
      { id: 'sem1', lbl: '🎓 Semana 1 (formação)', itens: [
        ['academy', 'Trilha de boas-vindas (PSM Academy)'], ['cultura', 'Manual de Cultura + Código de Ética'],
        ['tabelas', 'Conhecer tabelas (Conquista/MAP) e lançamentos'], ['scripts', 'Scripts e cadências de atendimento'],
        ['shadow', 'Acompanhar 1 plantão (shadowing)'] ] },
      { id: 'mes1', lbl: '🚀 Mês 1 (rampa)', itens: [
        ['captacao', 'Primeira captação registrada'], ['visita', 'Primeiro atendimento / visita'],
        ['padrinho', 'Padrinho/líder de acompanhamento definido'], ['meta', 'Meta de rampa 30/60/90 definida'],
        ['oo', 'Primeira reunião 1:1 realizada'] ] },
    ],
  },
  offboarding: {
    titulo: '👋 Offboarding — desligamento', cor: '#ef4444', dataLbl: 'Data de saída',
    sub: 'Saída organizada: sem perder cliente, sem acesso solto, sem pendência financeira.',
    campos: ['cargo', 'equipe', 'motivo', 'data', 'responsavel', 'carteira_destino'],
    etapas: [
      { id: 'com', lbl: '📢 Comunicação', itens: [
        ['motivo', 'Motivo registrado (pediu/desligado)'], ['data', 'Data de saída definida'],
        ['lider', 'Líder e time comunicados'], ['aviso', 'Aviso prévio / acordo'] ] },
      { id: 'acessos', lbl: '🔒 Acessos (revogar)', itens: [
        ['login', 'Desativar login House PSM'], ['rd', 'Remover do RD CRM'],
        ['wpp', 'Sair dos grupos de WhatsApp'], ['email', 'Encerrar e-mail corporativo'],
        ['equip', 'Devolver equipamentos / materiais'] ] },
      { id: 'fin', lbl: '💰 Financeiro', itens: [
        ['comissoes', 'Acerto de comissões pendentes'], ['repasses', 'Repasses em aberto liquidados'],
        ['rescisao', 'Rescisão / quitação'] ] },
      { id: 'carteira', lbl: '🤝 Carteira (crítico — não perder cliente)', itens: [
        ['leads', 'Reatribuir leads/clientes ativos'], ['captacoes', 'Transferir captações em andamento'],
        ['herdeiro', 'Quem herda a carteira definido'] ] },
      { id: 'conhecimento', lbl: '🧠 Conhecimento', itens: [
        ['entrevista', 'Entrevista de saída'], ['doc', 'Documentar aprendizados / feedback'],
        ['confid', 'Termo de confidencialidade reforçado (LGPD)'] ] },
    ],
  },
};
const CARGOS = ['Corretor Conquista', 'Corretor MAP', 'Corretor Locação', 'Corretor Terceiros', 'SDR', 'Líder', 'Backoffice', 'Marketing', 'Financeiro', 'Outro'];
const EQUIPES = ['Conquista', 'MAP', 'Locação', 'Terceiros', '—'];
const MOTIVOS = ['Pediu demissão', 'Desligado', 'Fim de contrato', 'Outro'];

const tplItems = tipo => RH_TPL[tipo].etapas.flatMap(e => e.itens.map(([k]) => e.id + '.' + k));
function rhProgress(tipo, proc) {
  const all = tplItems(tipo);
  const done = all.filter(k => proc.checklist && proc.checklist[k]).length;
  return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
}

async function loadRH(tipo) {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/rh_processos');
    _rh = { onboarding: r.onboarding || [], offboarding: r.offboarding || [] };
    renderRH(tipo);
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderRH(tipo) {
  const T = RH_TPL[tipo];
  const list = _rh[tipo] || [];
  const ativos = list.filter(p => (p.status || 'em_andamento') !== 'concluido');
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:18px;font-weight:800;color:${T.cor}">${T.titulo}</div>
        <div class="tiny muted">${T.sub}</div>
      </div>
      <button class="btn btn-primary" id="rh-new">+ Novo processo</button>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Em andamento</div><div style="font-size:20px;font-weight:800;color:${T.cor}">${ativos.length}</div></div>
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Concluídos</div><div style="font-size:20px;font-weight:800">${list.length - ativos.length}</div></div>
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Total</div><div style="font-size:20px;font-weight:800">${list.length}</div></div>
    </div>
    ${!list.length
      ? `<div class="card muted tiny" style="text-align:center;padding:34px">Nenhum processo de ${tipo === 'onboarding' ? 'admissão' : 'desligamento'} ainda. Clique em <b>+ Novo processo</b>.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">${list.map(p => rhCard(tipo, p)).join('')}</div>`}`;
  document.getElementById('rh-new').onclick = () => openRHEditor(tipo, null);
  body.querySelectorAll('[data-rh-open]').forEach(b => b.onclick = () => openRHEditor(tipo, list.find(p => p.id === b.dataset.rhOpen)));
}

function rhCard(tipo, p) {
  const T = RH_TPL[tipo];
  const pr = rhProgress(tipo, p);
  const done = (p.status || 'em_andamento') === 'concluido';
  const barcor = done ? '#16a34a' : (pr.pct >= 67 ? '#16a34a' : pr.pct >= 34 ? '#f59e0b' : '#ef4444');
  return `
    <div class="card" style="padding:14px;cursor:pointer;border-left:4px solid ${T.cor}" data-rh-open="${esc(p.id)}">
      <div class="flex items-center" style="justify-content:space-between;gap:8px">
        <div style="font-weight:800;font-size:14px">${esc(p.nome || 'Sem nome')}</div>
        <span class="tiny" style="font-weight:800;color:${done ? '#16a34a' : T.cor}">${done ? '✓ Concluído' : pr.pct + '%'}</span>
      </div>
      <div class="tiny muted" style="margin:3px 0 8px">${esc(p.cargo || '—')}${p.equipe && p.equipe !== '—' ? ' · ' + esc(p.equipe) : ''}${p.data ? ' · ' + esc(p.data.split('-').reverse().join('/')) : ''}</div>
      <div style="height:7px;background:var(--bg-3,#e2e8f0);border-radius:99px;overflow:hidden"><div style="height:100%;width:${pr.pct}%;background:${barcor};transition:width .2s"></div></div>
      <div class="tiny muted" style="margin-top:5px">${pr.done}/${pr.total} itens${p.responsavel ? ' · 👤 ' + esc(p.responsavel) : ''}</div>
      ${tipo === 'offboarding' && p.carteira_destino ? `<div class="tiny" style="margin-top:5px;color:#0891b2;font-weight:700">🤝 carteira → ${esc(p.carteira_destino)}</div>` : ''}
    </div>`;
}

function openRHEditor(tipo, p0) {
  const T = RH_TPL[tipo];
  const p = p0 ? JSON.parse(JSON.stringify(p0)) : { checklist: {}, status: 'em_andamento' };
  if (!p.checklist) p.checklist = {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  const campo = (k) => {
    if (k === 'cargo') return `<div><label class="tiny muted">Cargo</label><select id="rh-cargo" class="select"><option value="">—</option>${CARGOS.map(c => `<option${p.cargo === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'equipe') return `<div><label class="tiny muted">Equipe</label><select id="rh-equipe" class="select">${EQUIPES.map(c => `<option${(p.equipe || '—') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'motivo') return `<div><label class="tiny muted">Motivo</label><select id="rh-motivo" class="select"><option value="">—</option>${MOTIVOS.map(c => `<option${p.motivo === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'data') return `<div><label class="tiny muted">${T.dataLbl}</label><input id="rh-data" class="input" type="date" value="${esc((p.data || '').substring(0, 10))}"></div>`;
    if (k === 'responsavel') return `<div><label class="tiny muted">Responsável (padrinho/líder)</label><input id="rh-responsavel" class="input" value="${esc(p.responsavel || '')}" placeholder="Quem acompanha"></div>`;
    if (k === 'carteira_destino') return `<div><label class="tiny muted">🤝 Carteira vai pra</label><input id="rh-carteira_destino" class="input" value="${esc(p.carteira_destino || '')}" placeholder="Quem herda os leads/clientes"></div>`;
    return '';
  };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:620px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:4px;color:${T.cor}">${p.id ? 'Editar' : 'Novo'} — ${T.titulo}</div>
      <label class="tiny muted">Nome do colaborador *</label>
      <input id="rh-nome" class="input" value="${esc(p.nome || '')}" placeholder="Nome completo" style="margin-bottom:10px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:12px">
        ${T.campos.map(campo).join('')}
        <div><label class="tiny muted">Status</label><select id="rh-status" class="select"><option value="em_andamento"${(p.status || 'em_andamento') === 'em_andamento' ? ' selected' : ''}>Em andamento</option><option value="concluido"${p.status === 'concluido' ? ' selected' : ''}>Concluído</option></select></div>
      </div>
      <div style="font-weight:800;font-size:13px;margin-bottom:8px">✅ Checklist</div>
      <div id="rh-checklist">${T.etapas.map(e => `
        <div style="margin-bottom:12px">
          <div style="font-weight:700;font-size:12px;color:${T.cor};margin-bottom:5px">${e.lbl}</div>
          ${e.itens.map(([k, lbl]) => { const key = e.id + '.' + k; return `
            <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;cursor:pointer;font-size:13px" onmouseover="this.style.background='var(--bg-3,#f1f5f9)'" onmouseout="this.style.background=''">
              <input type="checkbox" data-ck="${key}"${p.checklist[key] ? ' checked' : ''} style="width:16px;height:16px;cursor:pointer">
              <span>${esc(lbl)}</span>
            </label>`; }).join('')}
        </div>`).join('')}
      </div>
      <label class="tiny muted">Observações</label>
      <textarea id="rh-obs" class="input" rows="2" placeholder="Anotações do processo">${esc(p.obs || '')}</textarea>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="rh-del" ${p.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="rh-cancel">Cancelar</button><button class="btn btn-primary" id="rh-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#rh-cancel').onclick = () => ov.remove();
  ov.querySelector('#rh-save').onclick = async () => {
    const g = id => (ov.querySelector('#rh-' + id)?.value || '').trim();
    const checklist = {};
    ov.querySelectorAll('[data-ck]').forEach(c => { if (c.checked) checklist[c.dataset.ck] = true; });
    const proc = { id: p.id, nome: g('nome'), status: g('status') || 'em_andamento', obs: g('obs'), checklist };
    T.campos.forEach(k => { proc[k] = g(k); });
    if (!proc.nome) { ov.querySelector('#rh-nome').focus(); return; }
    ov.querySelector('#rh-save').disabled = true;
    try { await api.request('/api/v3/gp/rh_processos', { method: 'POST', body: { action: 'upsert', tipo, proc } }); ov.remove(); await loadRH(tipo); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#rh-save').disabled = false; }
  };
  ov.querySelector('#rh-del').onclick = async () => {
    if (!p.id || !confirm('Excluir este processo?')) return;
    try { await api.request('/api/v3/gp/rh_processos', { method: 'POST', body: { action: 'delete', tipo, id: p.id } }); ov.remove(); await loadRH(tipo); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#rh-nome')?.focus(), 50);
}

/* ════════════════════════════════════════════════════════════════════════
   MÓDULOS GENÉRICOS DE RH (Plano de Crescimento · Clima Interno · Avaliações)
   Lista de fichas via shared_kv (gp/rh_registros). O template (campos) mora
   aqui no front — adicionar campo/módulo é só editar isto. Líder+ (lvl 5). v81.52
═══════════════════════════════════════════════════════════════════════════ */
const REG_TPL = {
  plano: {
    titulo: '📈 Plano de Crescimento', cor: '#0ea5e9', titleField: 'pessoa',
    sub: 'Trilha de cargos e PDI: onde cada um está e o próximo passo.',
    campos: [
      { k: 'pessoa', lbl: 'Colaborador', type: 'text', req: true },
      { k: 'cargo_atual', lbl: 'Cargo atual', type: 'select', opts: CARGOS },
      { k: 'proximo_cargo', lbl: 'Próximo cargo (meta)', type: 'select', opts: CARGOS },
      { k: 'competencias', lbl: 'Competências a desenvolver', type: 'textarea' },
      { k: 'prazo', lbl: 'Prazo', type: 'date' },
      { k: 'status', lbl: 'Status', type: 'select', opts: ['Em andamento', 'No prazo', 'Atrasado', 'Concluído'] },
      { k: 'obs', lbl: 'Observações', type: 'textarea' },
    ],
    chips: r => [r.cargo_atual, r.proximo_cargo ? '→ ' + r.proximo_cargo : '', r.status].filter(Boolean),
  },
  clima: {
    titulo: '🌡 Clima Interno', cor: '#16a34a', titleField: 'periodo',
    sub: 'Pesquisas de clima / pulso — participação, eNPS e ações.',
    campos: [
      { k: 'periodo', lbl: 'Período (ex.: Jun/2026)', type: 'text', req: true },
      { k: 'participacao', lbl: 'Participação (%)', type: 'number' },
      { k: 'enps', lbl: 'eNPS (-100 a 100)', type: 'number' },
      { k: 'destaques', lbl: 'Destaques (o que está bom)', type: 'textarea' },
      { k: 'pontos_atencao', lbl: 'Pontos de atenção', type: 'textarea' },
      { k: 'acoes', lbl: 'Ações definidas', type: 'textarea' },
    ],
    chips: r => [r.participacao ? r.participacao + '% part.' : '', (r.enps !== undefined && r.enps !== '') ? 'eNPS ' + r.enps : ''].filter(Boolean),
  },
  avaliacoes: {
    titulo: '⭐ Avaliações & Feedbacks', cor: '#f59e0b', titleField: 'pessoa',
    sub: 'Avaliações de desempenho e feedbacks estruturados por colaborador.',
    campos: [
      { k: 'pessoa', lbl: 'Colaborador', type: 'text', req: true },
      { k: 'periodo', lbl: 'Período / ciclo', type: 'text' },
      { k: 'nota', lbl: 'Nota (0–10)', type: 'number' },
      { k: 'pontos_fortes', lbl: 'Pontos fortes', type: 'textarea' },
      { k: 'a_desenvolver', lbl: 'A desenvolver', type: 'textarea' },
      { k: 'feedback', lbl: 'Feedback', type: 'textarea' },
      { k: 'proximos_passos', lbl: 'Próximos passos', type: 'textarea' },
    ],
    chips: r => [r.periodo, (r.nota !== undefined && r.nota !== '') ? 'nota ' + r.nota : ''].filter(Boolean),
  },
};

let _regs = { plano: [], clima: [], avaliacoes: [] };

async function loadReg(modulo) {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/rh_registros');
    const reg = (r && r.registros) || {};
    _regs = { plano: reg.plano || [], clima: reg.clima || [], avaliacoes: reg.avaliacoes || [] };
    renderReg(modulo);
  } catch (e) { body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

function renderReg(modulo) {
  const T = REG_TPL[modulo], list = _regs[modulo] || [];
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div><div style="font-size:17px;font-weight:800;color:${T.cor}">${T.titulo}</div><div class="tiny muted">${T.sub}</div></div>
      <button class="btn btn-primary" id="reg-new">+ Nova ficha</button>
    </div>
    ${!list.length ? `<div class="card muted tiny" style="text-align:center;padding:30px">Nenhuma ficha ainda. Clique em <b>+ Nova ficha</b>.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${list.map(r => regCard(modulo, r)).join('')}</div>`}`;
  document.getElementById('reg-new').onclick = () => openRegEditor(modulo, null);
  body.querySelectorAll('[data-reg]').forEach(b => b.onclick = () => openRegEditor(modulo, list.find(r => r.id === b.dataset.reg)));
}

function regCard(modulo, r) {
  const T = REG_TPL[modulo];
  const title = r[T.titleField] || '—';
  const chips = (T.chips(r) || []).map(c => `<span style="background:${T.cor}1f;color:${T.cor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px">${esc(c)}</span>`).join(' ');
  const pf = T.campos.find(c => c.type === 'textarea' && r[c.k]);
  const prev = pf ? esc(String(r[pf.k]).slice(0, 90)) : '';
  return `<div class="card" style="padding:13px;cursor:pointer;border-left:4px solid ${T.cor}" data-reg="${esc(r.id)}">
    <div style="font-weight:800;font-size:14px">${esc(title)}</div>
    <div class="flex gap-1" style="flex-wrap:wrap;margin:6px 0">${chips}</div>
    ${prev ? `<div class="tiny muted">${prev}${String(r[pf.k]).length > 90 ? '…' : ''}</div>` : ''}
  </div>`;
}

function openRegEditor(modulo, r0) {
  const T = REG_TPL[modulo], r = r0 ? { ...r0 } : {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  const field = c => {
    const v = r[c.k] != null ? r[c.k] : '';
    if (c.type === 'textarea') return `<div><label class="tiny muted">${c.lbl}</label><textarea id="rg-${c.k}" class="input" rows="2">${esc(v)}</textarea></div>`;
    if (c.type === 'select') return `<div><label class="tiny muted">${c.lbl}</label><select id="rg-${c.k}" class="select"><option value="">—</option>${c.opts.map(o => `<option${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    const t = c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text';
    return `<div><label class="tiny muted">${c.lbl}</label><input id="rg-${c.k}" class="input" type="${t}" value="${esc(c.type === 'date' ? String(v).slice(0, 10) : v)}"></div>`;
  };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:520px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px;color:${T.cor}">${r.id ? 'Editar' : 'Nova'} — ${T.titulo}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${T.campos.map(field).join('')}</div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="rg-del" ${r.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="rg-cancel">Cancelar</button><button class="btn btn-primary" id="rg-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#rg-cancel').onclick = () => ov.remove();
  ov.querySelector('#rg-save').onclick = async () => {
    const rec = { id: r.id };
    T.campos.forEach(c => { const el = ov.querySelector('#rg-' + c.k); if (el) rec[c.k] = (el.value || '').trim(); });
    const reqF = T.campos.find(c => c.req);
    if (reqF && !rec[reqF.k]) { ov.querySelector('#rg-' + reqF.k).focus(); return; }
    ov.querySelector('#rg-save').disabled = true;
    try { await api.request('/api/v3/gp/rh_registros', { method: 'POST', body: { action: 'upsert', modulo, registro: rec } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); ov.querySelector('#rg-save').disabled = false; }
  };
  ov.querySelector('#rg-del').onclick = async () => {
    if (!r.id || !confirm('Excluir esta ficha?')) return;
    try { await api.request('/api/v3/gp/rh_registros', { method: 'POST', body: { action: 'delete', modulo, id: r.id } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => { const f = ov.querySelector('.input'); if (f) f.focus(); }, 50);
}
