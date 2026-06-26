/* ============================================================================
   PSM-OS v2 — Avaliações & Feedbacks (gestão de desempenho) · v81.90
   ----------------------------------------------------------------------------
   Sub-abas: 📊 Visão geral · 📝 Minhas avaliações · 👥 Avaliar ·
             💬 Feedback & Kudos · 🔄 Ciclos & Competências · 🎯 9-Box & Calibração
   Backend: /api/v3/gp/avaliacoes (config shared_kv + tabelas gp_avaliacoes / gp_feedbacks)
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const EP = '/api/v3/gp/avaliacoes';
const CARGOS_MODELO = ['Geral', 'Corretor', 'Secretária de Vendas', 'SDR', 'Líder de Equipe', 'Gerente', 'Backoffice', 'Marketing', 'Financeiro', 'Administrativo'];
const TIPOS = [['auto', '🪞 Autoavaliação'], ['gestor', '👔 Gestor'], ['par', '🤝 Par (360°)'], ['subordinado', '⬇ Subordinado (360°)']];
const FB_TIPOS = [['elogio', '👏 Elogio'], ['melhoria', '🔧 Ponto de melhoria'], ['1a1', '🗣 1:1'], ['reconhecimento', '🏆 Reconhecimento']];
const NINE = { 1: 'Baixo', 2: 'Médio', 3: 'Alto' };
const SUGESTOES = {
  Corretor: ['Prospecção & captação', 'Atendimento & relacionamento', 'Negociação & fechamento', 'Uso do CRM / processo', 'Pós-venda & indicação', 'Conhecimento de produto'],
  Gerente: ['Liderança & desenvolvimento do time', 'Atingimento de metas', 'Gestão de processos & rotina', 'Comunicação & feedback', 'Visão estratégica'],
  'Líder de Equipe': ['Engajamento do time', 'Cadência & acompanhamento', 'Exemplo & cultura', 'Resolução de problemas'],
  'Secretária de Vendas': ['Organização & agenda', 'Atendimento interno', 'Documentação & precisão', 'Proatividade'],
  Backoffice: ['Precisão & qualidade', 'Prazo & SLA', 'Organização documental', 'Colaboração'],
  Geral: ['Postura & cultura PSM', 'Comprometimento & atitude', 'Comunicação', 'Trabalho em equipe', 'Pontualidade & disciplina'],
};

let _host = null, _data = null, _users = [], _sub = 'overview';
let _evForm = null;     // avaliação em edição (scorecard)
let _cfgEdit = null;    // cópia editável da config (ciclos/competências)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const me = () => _data?.me || auth.user() || {};
const escala = () => (_data?.config?.escala) || 5;
const uName = id => (_users.find(u => u.id === id) || {}).name || id || '—';
const comps = cargo => (_data?.config?.competencias?.[cargo]) || (_data?.config?.competencias?.['Geral']) || [];
const ciclos = () => (_data?.config?.ciclos) || [];
const cicloAtivo = () => ciclos().find(c => c.status === 'aberto') || null;
const isGestao = () => (me().lvl || 0) >= 5;
const isSenior = () => (me().lvl || 0) >= 7;
function notaFinal(notas, cargo) {
  const cs = comps(cargo); let tp = 0, t = 0;
  cs.forEach(c => { const v = parseFloat(notas?.[c.id]); if (!isNaN(v)) { t += v * (parseFloat(c.peso) || 1); tp += (parseFloat(c.peso) || 1); } });
  return tp ? Math.round((t / tp) * 100) / 100 : null;
}
function notaEfetiva(a) { return (a.nota_calibrada != null ? a.nota_calibrada : a.nota_final); }

export async function renderAvaliacoes(host) {
  _host = host;
  host.innerHTML = '<div class="muted tiny" style="padding:14px"><span class="spinner"></span> Carregando avaliações…</div>';
  try {
    const [r, u] = await Promise.all([api.request(EP), (_users.length ? Promise.resolve({ users: _users }) : api.listUsers().catch(() => ({ users: [] })))]);
    _data = r; _users = (u && u.users) || _users;
  } catch (e) { host.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return; }
  draw();
}

function draw() {
  const tabs = [['overview', '📊 Visão geral'], ['minhas', '📝 Minhas avaliações'], ['avaliar', '👥 Avaliar'], ['feedback', '💬 Feedback & Kudos']];
  if (isGestao()) tabs.push(['ciclos', '🔄 Ciclos & Competências']);
  if (isGestao()) tabs.push(['nineBox', '🎯 9-Box & Calibração']);
  if (!tabs.some(t => t[0] === _sub)) _sub = 'overview';
  _host.innerHTML = `
    <div class="flex gap-1 mb-3" style="flex-wrap:wrap">
      ${tabs.map(([id, lbl]) => `<button class="btn ${_sub === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-asub="${id}">${lbl}</button>`).join('')}
    </div>
    <div id="aval-body"></div>`;
  _host.querySelectorAll('[data-asub]').forEach(b => b.addEventListener('click', () => { _sub = b.dataset.asub; _evForm = null; _cfgEdit = null; draw(); }));
  const body = document.getElementById('aval-body');
  ({ overview: viewOverview, minhas: viewMinhas, avaliar: viewAvaliar, feedback: viewFeedback, ciclos: viewCiclos, nineBox: viewNineBox }[_sub] || viewOverview)(body);
}

/* ─────────────── 📊 Visão geral ─────────────── */
function viewOverview(body) {
  const avs = _data.avaliacoes || [], fbs = _data.feedbacks || [];
  const ca = cicloAtivo();
  const minhasRecebidas = avs.filter(a => a.avaliado_id === me().id && a.status === 'enviado');
  const ultima = minhasRecebidas[0];
  const pendAuto = ca && !avs.some(a => a.ciclo_id === ca.id && a.avaliado_id === me().id && a.tipo === 'auto');
  // distribuição de notas (enviadas) p/ gestão
  const enviadas = avs.filter(a => a.status === 'enviado' && notaEfetiva(a) != null);
  const buckets = [0, 0, 0, 0, 0]; // por faixa da escala
  enviadas.forEach(a => { const f = Math.min(4, Math.floor((notaEfetiva(a) - 0.001) / (escala() / 5))); buckets[Math.max(0, f)]++; });
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px">
      ${card('Ciclo ativo', ca ? esc(ca.nome) : '—', ca ? `${esc(ca.inicio || '')} → ${esc(ca.fim || '')}` : 'nenhum aberto', '#2563eb')}
      ${card('Minha última nota', ultima && notaEfetiva(ultima) != null ? notaEfetiva(ultima) + '/' + escala() : '—', ultima ? esc(ultima.cargo || '') : 'sem avaliação ainda', '#16a34a')}
      ${card('Avaliações enviadas', String(enviadas.length), 'no total', '#7c3aed')}
      ${card('Feedbacks/kudos', String(fbs.length), `${fbs.filter(f => f.publico).length} públicos`, '#f59e0b')}
    </div>
    ${pendAuto ? `<div class="alert alert-warn" style="margin-bottom:12px">📝 Você ainda não fez sua <b>autoavaliação</b> do ciclo <b>${esc(ca.nome)}</b>. <button class="btn btn-sm btn-primary" id="go-auto" style="margin-left:8px">Fazer agora</button></div>` : ''}
    ${isGestao() ? `<div class="card"><div style="font-weight:800;margin-bottom:8px">Distribuição de notas (enviadas)</div>
      ${enviadas.length ? barChart(buckets) : '<div class="tiny muted">Sem avaliações enviadas ainda.</div>'}</div>` : ''}
    <div class="card" style="margin-top:12px"><div style="font-weight:800;margin-bottom:8px">💬 Reconhecimentos recentes (kudos)</div>
      ${fbs.filter(f => f.publico).slice(0, 6).map(fbLine).join('') || '<div class="tiny muted">Nenhum kudos público ainda.</div>'}</div>`;
  const ga = document.getElementById('go-auto'); if (ga) ga.onclick = () => { _sub = 'avaliar'; startEval(me().id, 'auto'); };
}
function card(t, v, s, c) {
  return `<div class="card" style="padding:12px;border-left:3px solid ${c}"><div class="tiny muted">${esc(t)}</div>
    <div style="font-size:20px;font-weight:800;color:${c}">${esc(v)}</div><div class="tiny muted">${esc(s)}</div></div>`;
}
function barChart(b) {
  const mx = Math.max(1, ...b); const lbl = ['muito baixo', 'baixo', 'médio', 'alto', 'excelente'];
  return `<div style="display:flex;gap:6px;align-items:flex-end;height:90px">${b.map((v, i) =>
    `<div style="flex:1;text-align:center"><div style="background:#2563eb;border-radius:4px 4px 0 0;height:${Math.round(v / mx * 70)}px;min-height:2px"></div>
     <div class="tiny" style="font-weight:700">${v}</div><div class="tiny muted">${lbl[i]}</div></div>`).join('')}</div>`;
}
function fbLine(f) {
  const t = (FB_TIPOS.find(x => x[0] === f.tipo) || [, f.tipo])[1];
  return `<div style="border-top:1px solid var(--bd,#e2e8f0);padding:7px 0">
    <div style="font-size:13px"><b>${esc(uName(f.de_id))}</b> → <b>${esc(uName(f.para_id))}</b> <span class="tiny muted">${t}</span></div>
    <div class="tiny">${esc(f.texto)}</div></div>`;
}

/* ─────────────── 📝 Minhas avaliações ─────────────── */
function viewMinhas(body) {
  const avs = _data.avaliacoes || [];
  const minhaAuto = avs.filter(a => a.avaliado_id === me().id && a.tipo === 'auto');
  const recebidas = avs.filter(a => a.avaliado_id === me().id && a.avaliador_id !== me().id && a.status === 'enviado');
  const fbs = (_data.feedbacks || []).filter(f => f.para_id === me().id);
  const ca = cicloAtivo();
  body.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="flex items-center" style="justify-content:space-between"><div style="font-weight:800">🪞 Minha autoavaliação</div>
        ${ca ? `<button class="btn btn-sm btn-primary" id="nova-auto">${minhaAuto.some(a => a.ciclo_id === ca.id) ? 'Editar' : 'Fazer'} autoavaliação · ${esc(ca.nome)}</button>` : '<span class="tiny muted">nenhum ciclo aberto</span>'}</div>
      ${minhaAuto.length ? `<div class="mt-2">${minhaAuto.map(a => avLine(a, true)).join('')}</div>` : '<div class="tiny muted mt-2">Você ainda não se autoavaliou.</div>'}
    </div>
    <div class="card" style="margin-bottom:12px"><div style="font-weight:800;margin-bottom:6px">📥 Avaliações que recebi</div>
      ${recebidas.length ? recebidas.map(a => avLine(a, false)).join('') : '<div class="tiny muted">Nenhuma avaliação recebida ainda.</div>'}</div>
    <div class="card"><div style="font-weight:800;margin-bottom:6px">💬 Feedbacks que recebi</div>
      ${fbs.length ? fbs.map(fbLine).join('') : '<div class="tiny muted">Nenhum feedback ainda.</div>'}</div>`;
  const na = document.getElementById('nova-auto');
  if (na) na.onclick = () => { _sub = 'avaliar'; const ex = minhaAuto.find(a => a.ciclo_id === ca.id); startEval(me().id, 'auto', ex); };
  body.querySelectorAll('[data-edit-av]').forEach(b => b.onclick = () => { const a = (_data.avaliacoes || []).find(x => x.id === b.dataset.editAv); if (a) startEval(a.avaliado_id, a.tipo, a); });
}
function avLine(a, own) {
  const ne = notaEfetiva(a);
  return `<div style="border-top:1px solid var(--bd,#e2e8f0);padding:8px 0">
    <div class="flex items-center" style="gap:8px"><b>${esc(a.cargo || '—')}</b>
      <span class="tiny muted">${esc((ciclos().find(c => c.id === a.ciclo_id) || {}).nome || 'sem ciclo')} · por ${esc(uName(a.avaliador_id))}</span>
      ${ne != null ? `<span style="margin-left:auto;font-weight:800;color:#16a34a">${ne}/${escala()}</span>` : `<span style="margin-left:auto" class="tiny muted">${esc(a.status)}</span>`}</div>
    ${a.pontos_fortes ? `<div class="tiny"><b>Fortes:</b> ${esc(a.pontos_fortes)}</div>` : ''}
    ${a.a_desenvolver ? `<div class="tiny"><b>A desenvolver:</b> ${esc(a.a_desenvolver)}</div>` : ''}
    ${a.comentario ? `<div class="tiny">${esc(a.comentario)}</div>` : ''}
    ${own && a.status === 'rascunho' ? `<button class="btn btn-ghost btn-sm mt-1" data-edit-av="${a.id}">✏️ Continuar</button>` : ''}</div>`;
}

/* ─────────────── 👥 Avaliar (scorecard) ─────────────── */
function startEval(avaliadoId, tipo, existing) {
  const u = _users.find(x => x.id === avaliadoId);
  const cargoGuess = existing?.cargo || (u && (CARGOS_MODELO.find(c => (u.role || '').toLowerCase().includes(c.toLowerCase().split(' ')[0])) )) || 'Geral';
  _evForm = existing ? { ...existing, notas: { ...(existing.notas || {}) } } : {
    avaliado_id: avaliadoId, tipo, cargo: cargoGuess, ciclo_id: (cicloAtivo() || {}).id || '', notas: {},
    desempenho: '', potencial: '', comentario: '', pontos_fortes: '', a_desenvolver: '', status: 'rascunho',
  };
  _sub = 'avaliar'; draw();
}
function viewAvaliar(body) {
  if (_evForm) return renderScorecard(body);
  const podeEquipe = isGestao();
  const pessoas = _users.filter(u => (u.status || 'ativo') === 'ativo');
  body.innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:8px">Iniciar avaliação</div>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:end">
        <label class="tiny muted">Pessoa<select id="av-pessoa" class="select" style="min-width:200px">
          <option value="${esc(me().id)}">${esc(me().name || 'Eu')} (eu)</option>
          ${podeEquipe ? pessoas.filter(u => u.id !== me().id).map(u => `<option value="${esc(u.id)}">${esc(u.name)}${u.role ? ' · ' + esc(u.role) : ''}</option>`).join('') : ''}
        </select></label>
        <label class="tiny muted">Tipo<select id="av-tipo" class="select">${TIPOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <button class="btn btn-primary" id="av-start">Começar →</button>
      </div>
      ${!podeEquipe ? '<div class="tiny muted mt-2">Você pode fazer sua autoavaliação e avaliações 360° solicitadas. Avaliar a equipe é função da gestão.</div>' : ''}
    </div>
    <div class="card mt-3"><div style="font-weight:800;margin-bottom:6px">Avaliações que eu registrei</div>
      ${(_data.avaliacoes || []).filter(a => a.avaliador_id === me().id).map(a => `
        <div style="border-top:1px solid var(--bd,#e2e8f0);padding:7px 0" class="flex items-center" style="gap:8px">
          <span><b>${esc(uName(a.avaliado_id))}</b> <span class="tiny muted">${esc((TIPOS.find(t => t[0] === a.tipo) || [, a.tipo])[1])} · ${esc(a.status)}</span></span>
          ${notaEfetiva(a) != null ? `<span style="margin-left:auto;font-weight:700">${notaEfetiva(a)}/${escala()}</span>` : '<span style="margin-left:auto"></span>'}
          <button class="btn btn-ghost btn-sm" data-edit-av="${a.id}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del-av="${a.id}">🗑</button>
        </div>`).join('') || '<div class="tiny muted">Nenhuma ainda.</div>'}</div>`;
  document.getElementById('av-start').onclick = () => startEval(document.getElementById('av-pessoa').value, document.getElementById('av-tipo').value);
  body.querySelectorAll('[data-edit-av]').forEach(b => b.onclick = () => { const a = _data.avaliacoes.find(x => x.id === b.dataset.editAv); if (a) startEval(a.avaliado_id, a.tipo, a); });
  body.querySelectorAll('[data-del-av]').forEach(b => b.onclick = async () => { if (!confirm('Excluir avaliação?')) return; try { await api.request(EP, { method: 'POST', body: { action: 'delete', id: b.dataset.delAv } }); await renderAvaliacoes(_host); } catch (e) { alert(e.message); } });
}
function renderScorecard(body) {
  const f = _evForm, cs = comps(f.cargo), E = escala();
  const noModel = !cs.length;
  const nf = notaFinal(f.notas, f.cargo);
  body.innerHTML = `
    <div class="flex items-center gap-2 mb-2"><button class="btn btn-ghost btn-sm" id="sc-back">← Voltar</button>
      <div style="font-weight:800">${esc(uName(f.avaliado_id))} · ${esc((TIPOS.find(t => t[0] === f.tipo) || [, f.tipo])[1])}</div>
      <div id="sc-nf" style="margin-left:auto;font-weight:800;color:#16a34a">${nf != null ? nf + '/' + E : '—'}</div></div>
    <div class="card">
      <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:10px">
        <label class="tiny muted">Ciclo<select id="sc-ciclo" class="select"><option value="">— avulsa —</option>${ciclos().map(c => `<option value="${esc(c.id)}"${c.id === f.ciclo_id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="tiny muted">Modelo de competências (cargo)<select id="sc-cargo" class="select">${CARGOS_MODELO.map(c => `<option value="${esc(c)}"${c === f.cargo ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      </div>
      ${noModel ? `<div class="alert alert-warn tiny">Não há competências cadastradas para "<b>${esc(f.cargo)}</b>". Cadastre em <b>Ciclos & Competências</b> ${isGestao() ? '' : '(peça à gestão)'} ou escolha outro modelo.</div>`
        : `<div style="display:flex;flex-direction:column;gap:7px">${cs.map(c => scRow(c, f.notas[c.id], E)).join('')}</div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
        <label class="tiny muted">9-Box · Desempenho<select id="sc-desemp" class="select"><option value="">—</option>${[1, 2, 3].map(n => `<option value="${n}"${String(f.desempenho) === String(n) ? ' selected' : ''}>${n} · ${NINE[n]}</option>`).join('')}</select></label>
        <label class="tiny muted">9-Box · Potencial<select id="sc-potenc" class="select"><option value="">—</option>${[1, 2, 3].map(n => `<option value="${n}"${String(f.potencial) === String(n) ? ' selected' : ''}>${n} · ${NINE[n]}</option>`).join('')}</select></label>
      </div>
      <label class="tiny muted" style="display:block;margin-top:8px">Pontos fortes<textarea id="sc-fortes" class="input" rows="2">${esc(f.pontos_fortes || '')}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:6px">A desenvolver<textarea id="sc-desenv" class="input" rows="2">${esc(f.a_desenvolver || '')}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:6px">Comentário geral<textarea id="sc-coment" class="input" rows="2">${esc(f.comentario || '')}</textarea></label>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        <button class="btn btn-ghost" id="sc-draft">💾 Salvar rascunho</button>
        <button class="btn btn-primary" id="sc-send">✅ Enviar avaliação</button>
        ${isGestao() && f.a_desenvolver ? '<button class="btn btn-ghost" id="sc-pdi" style="margin-left:auto">📈 Gerar PDI</button>' : ''}
      </div>
    </div>`;
  const reNota = () => { const nv = notaFinal(_evForm.notas, _evForm.cargo); const el = document.getElementById('sc-nf'); if (el) el.textContent = nv != null ? nv + '/' + E : '—'; };
  body.querySelectorAll('[data-comp]').forEach(sel => sel.addEventListener('change', () => { _evForm.notas[sel.dataset.comp] = sel.value; reNota(); }));
  document.getElementById('sc-back').onclick = () => { _evForm = null; draw(); };
  document.getElementById('sc-ciclo').onchange = e => _evForm.ciclo_id = e.target.value;
  document.getElementById('sc-cargo').onchange = e => { capture(); _evForm.cargo = e.target.value; renderScorecard(body); };
  document.getElementById('sc-draft').onclick = () => saveEval('rascunho');
  document.getElementById('sc-send').onclick = () => saveEval('enviado');
  const pdi = document.getElementById('sc-pdi'); if (pdi) pdi.onclick = gerarPDI;
}
function scRow(c, val, E) {
  return `<div class="flex items-center gap-2" style="border-top:1px solid var(--bd,#e2e8f0);padding:6px 0">
    <span style="flex:1;font-size:13px">${esc(c.nome)} <span class="tiny muted">(peso ${esc(c.peso || 1)})</span></span>
    <select class="select" data-comp="${esc(c.id)}" style="max-width:130px"><option value="">—</option>${Array.from({ length: E }, (_, i) => i + 1).map(n => `<option value="${n}"${String(val) === String(n) ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`;
}
function capture() {
  const g = id => document.getElementById(id)?.value;
  if (!_evForm) return;
  document.querySelectorAll('[data-comp]').forEach(s => _evForm.notas[s.dataset.comp] = s.value);
  _evForm.desempenho = g('sc-desemp'); _evForm.potencial = g('sc-potenc');
  _evForm.pontos_fortes = g('sc-fortes'); _evForm.a_desenvolver = g('sc-desenv'); _evForm.comentario = g('sc-coment');
  _evForm.ciclo_id = g('sc-ciclo');
}
async function saveEval(status) {
  capture();
  const f = _evForm;
  const body = { action: 'save', id: f.id, avaliado_id: f.avaliado_id, avaliador_id: me().id, tipo: f.tipo, cargo: f.cargo,
    ciclo_id: f.ciclo_id || null, notas: f.notas, desempenho: f.desempenho || null, potencial: f.potencial || null,
    comentario: f.comentario, pontos_fortes: f.pontos_fortes, a_desenvolver: f.a_desenvolver, status };
  try {
    const r = await api.request(EP, { method: 'POST', body });
    if (r.row) { _evForm.id = r.row.id; }
    _evForm = null; await renderAvaliacoes(_host);
  } catch (e) { alert('Erro: ' + e.message); }
}
async function gerarPDI() {
  capture();
  try { await api.request(EP, { method: 'POST', body: { action: 'gerar_pdi', pessoa: uName(_evForm.avaliado_id), a_desenvolver: _evForm.a_desenvolver } });
    alert('📈 PDI criado no Plano de Crescimento.'); } catch (e) { alert('Erro: ' + e.message); }
}

/* ─────────────── 💬 Feedback & Kudos ─────────────── */
function viewFeedback(body) {
  const fbs = _data.feedbacks || [];
  const pessoas = _users.filter(u => (u.status || 'ativo') === 'ativo' && u.id !== me().id);
  body.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-weight:800;margin-bottom:8px">Dar feedback</div>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:end">
        <label class="tiny muted">Para<select id="fb-para" class="select" style="min-width:180px">${pessoas.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label>
        <label class="tiny muted">Tipo<select id="fb-tipo" class="select">${FB_TIPOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="tiny muted" style="display:flex;align-items:center;gap:5px;margin-top:14px"><input type="checkbox" id="fb-pub"> público (kudos)</label>
      </div>
      <textarea id="fb-txt" class="input mt-2" rows="2" placeholder="Escreva o feedback…"></textarea>
      <button class="btn btn-primary btn-sm mt-2" id="fb-send">Enviar feedback</button>
    </div>
    <div class="card"><div style="font-weight:800;margin-bottom:6px">Mural de reconhecimentos (kudos públicos)</div>
      ${fbs.filter(f => f.publico).map(f => fbCard(f)).join('') || '<div class="tiny muted">Nenhum kudos público ainda.</div>'}</div>`;
  document.getElementById('fb-send').onclick = async () => {
    const txt = document.getElementById('fb-txt').value.trim();
    if (!txt) { alert('Escreva o feedback.'); return; }
    try {
      await api.request(EP, { method: 'POST', body: { action: 'feedback', para_id: document.getElementById('fb-para').value, tipo: document.getElementById('fb-tipo').value, texto: txt, publico: document.getElementById('fb-pub').checked } });
      await renderAvaliacoes(_host);
    } catch (e) { alert('Erro: ' + e.message); }
  };
}
function fbCard(f) {
  const t = (FB_TIPOS.find(x => x[0] === f.tipo) || [, f.tipo])[1];
  const podeDel = f.de_id === me().id || isSenior();
  return `<div style="border-top:1px solid var(--bd,#e2e8f0);padding:8px 0" class="flex items-start gap-2">
    <div style="flex:1"><div style="font-size:13px"><b>${esc(uName(f.de_id))}</b> → <b>${esc(uName(f.para_id))}</b> <span class="tiny muted">${t}</span></div>
      <div class="tiny">${esc(f.texto)}</div></div>
    ${podeDel ? `<button class="btn btn-ghost btn-sm" data-del-fb="${f.id}">🗑</button>` : ''}</div>`;
}

/* ─────────────── 🔄 Ciclos & Competências ─────────────── */
function viewCiclos(body) {
  if (!_cfgEdit) _cfgEdit = JSON.parse(JSON.stringify(_data.config || { competencias: {}, ciclos: [], escala: 5 }));
  const cfg = _cfgEdit;
  body.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="flex items-center" style="justify-content:space-between"><div style="font-weight:800">🔄 Ciclos de avaliação</div>
        <div class="flex gap-2"><label class="tiny muted" style="display:flex;align-items:center;gap:4px">Escala 1–<input id="cfg-escala" type="number" min="2" max="10" value="${cfg.escala || 5}" class="input" style="width:54px"></label>
        <button class="btn btn-sm btn-ghost" id="ciclo-add">+ Ciclo</button></div></div>
      <div id="ciclos-list" class="mt-2">${(cfg.ciclos || []).map((c, i) => cicloRow(c, i)).join('') || '<div class="tiny muted">Nenhum ciclo. Crie um pra abrir avaliações.</div>'}</div>
    </div>
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between"><div style="font-weight:800">🧩 Competências por cargo</div>
        <select id="comp-cargo" class="select" style="max-width:200px">${CARGOS_MODELO.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
      <div id="comp-list" class="mt-2"></div>
    </div>
    <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="cfg-save">💾 Salvar tudo</button><span class="tiny muted" id="cfg-msg"></span></div>`;
  // ciclos
  body.querySelector('#ciclo-add').onclick = () => { captureCfg(); cfg.ciclos.push({ id: 'c_' + Date.now(), nome: 'Novo ciclo', tipo: 'semestral', inicio: '', fim: '', status: 'rascunho' }); viewCiclos(body); };
  body.querySelectorAll('[data-del-ciclo]').forEach(b => b.onclick = () => { captureCfg(); cfg.ciclos.splice(+b.dataset.delCiclo, 1); viewCiclos(body); });
  // competências
  const cargoSel = body.querySelector('#comp-cargo');
  const drawComps = () => {
    const cargo = cargoSel.value; const list = cfg.competencias[cargo] || [];
    body.querySelector('#comp-list').innerHTML = `
      ${list.map((c, i) => `<div class="flex gap-2" style="align-items:center;margin-bottom:5px">
        <input class="input comp-nome" data-i="${i}" value="${esc(c.nome)}" placeholder="Competência" style="flex:1">
        <input class="input comp-peso" data-i="${i}" type="number" min="1" max="9" value="${esc(c.peso || 1)}" title="peso" style="width:64px">
        <button class="btn btn-ghost btn-sm comp-del" data-i="${i}">🗑</button></div>`).join('')}
      <div class="flex gap-2 mt-1"><button class="btn btn-ghost btn-sm" id="comp-add">+ Competência</button>
        ${!list.length && SUGESTOES[cargo] ? `<button class="btn btn-ghost btn-sm" id="comp-sug">✨ Carregar sugestões</button>` : ''}</div>`;
    const capComp = () => { cfg.competencias[cargo] = [...body.querySelectorAll('.comp-nome')].map((inp, i) => ({ id: (list[i] && list[i].id) || 'k_' + cargo.replace(/\W/g, '') + i, nome: inp.value, peso: parseInt(body.querySelectorAll('.comp-peso')[i].value) || 1 })).filter(c => c.nome.trim()); };
    body.querySelector('#comp-add').onclick = () => { capComp(); (cfg.competencias[cargo] = cfg.competencias[cargo] || []).push({ id: 'k_' + cargo.replace(/\W/g, '') + Date.now(), nome: '', peso: 1 }); drawComps(); };
    const sug = body.querySelector('#comp-sug'); if (sug) sug.onclick = () => { cfg.competencias[cargo] = (SUGESTOES[cargo] || []).map((n, i) => ({ id: 'k_' + cargo.replace(/\W/g, '') + i, nome: n, peso: 1 })); drawComps(); };
    body.querySelectorAll('.comp-del').forEach(b => b.onclick = () => { capComp(); cfg.competencias[cargo].splice(+b.dataset.i, 1); drawComps(); });
    body.querySelectorAll('.comp-nome,.comp-peso').forEach(inp => inp.addEventListener('change', capComp));
  };
  cargoSel.onchange = drawComps; drawComps();
  body.querySelector('#cfg-save').onclick = async () => {
    captureCfg();
    try { await api.request(EP, { method: 'POST', body: { action: 'config', competencias: cfg.competencias, ciclos: cfg.ciclos, escala: parseInt(body.querySelector('#cfg-escala').value) || 5 } });
      _data.config = JSON.parse(JSON.stringify(cfg)); _data.config.escala = parseInt(body.querySelector('#cfg-escala').value) || 5;
      body.querySelector('#cfg-msg').textContent = '✅ salvo'; } catch (e) { alert('Erro: ' + e.message); }
  };
}
function cicloRow(c, i) {
  const ST = ['rascunho', 'aberto', 'encerrado'];
  return `<div class="flex gap-2" style="align-items:center;margin-bottom:6px;flex-wrap:wrap">
    <input class="input ciclo-nome" data-i="${i}" value="${esc(c.nome)}" style="flex:1;min-width:140px">
    <input class="input ciclo-ini" data-i="${i}" type="date" value="${esc(c.inicio || '')}" style="width:140px">
    <input class="input ciclo-fim" data-i="${i}" type="date" value="${esc(c.fim || '')}" style="width:140px">
    <select class="select ciclo-st" data-i="${i}" style="width:120px">${ST.map(s => `<option value="${s}"${c.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" data-del-ciclo="${i}">🗑</button></div>`;
}
function captureCfg() {
  const cfg = _cfgEdit; if (!cfg) return;
  document.querySelectorAll('.ciclo-nome').forEach((inp, i) => { if (cfg.ciclos[i]) cfg.ciclos[i].nome = inp.value; });
  document.querySelectorAll('.ciclo-ini').forEach((inp, i) => { if (cfg.ciclos[i]) cfg.ciclos[i].inicio = inp.value; });
  document.querySelectorAll('.ciclo-fim').forEach((inp, i) => { if (cfg.ciclos[i]) cfg.ciclos[i].fim = inp.value; });
  document.querySelectorAll('.ciclo-st').forEach((inp, i) => { if (cfg.ciclos[i]) cfg.ciclos[i].status = inp.value; });
}

/* ─────────────── 🎯 9-Box & Calibração ─────────────── */
function viewNineBox(body) {
  const avs = (_data.avaliacoes || []).filter(a => a.status === 'enviado');
  // última avaliação enviada por avaliado, com 9-box
  const porPessoa = {};
  avs.forEach(a => { if (a.desempenho && a.potencial) { if (!porPessoa[a.avaliado_id] || a.criado_em > porPessoa[a.avaliado_id].criado_em) porPessoa[a.avaliado_id] = a; } });
  const grid = {};
  Object.values(porPessoa).forEach(a => { const k = a.potencial + 'x' + a.desempenho; (grid[k] = grid[k] || []).push(a); });
  const cell = (pot, des) => {
    const list = grid[pot + 'x' + des] || [];
    const cor = pot + des >= 5 ? '#16a34a' : pot + des <= 3 ? '#dc2626' : '#f59e0b';
    return `<div style="border:1px solid var(--bd,#e2e8f0);border-radius:8px;padding:6px;min-height:64px;background:${cor}0e">
      ${list.map(a => `<div class="tiny" style="font-weight:600">${esc(uName(a.avaliado_id))}</div>`).join('') || '<span class="tiny muted">—</span>'}</div>`;
  };
  body.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-weight:800;margin-bottom:8px">🎯 9-Box · Potencial (↑) × Desempenho (→)</div>
      <div style="display:grid;grid-template-columns:90px 1fr 1fr 1fr;gap:6px;align-items:stretch">
        <div></div><div class="tiny muted" style="text-align:center">Desemp. Baixo</div><div class="tiny muted" style="text-align:center">Médio</div><div class="tiny muted" style="text-align:center">Alto</div>
        ${[3, 2, 1].map(pot => `<div class="tiny muted" style="display:flex;align-items:center">Pot. ${NINE[pot]}</div>${cell(pot, 1)}${cell(pot, 2)}${cell(pot, 3)}`).join('')}
      </div>
      ${Object.keys(porPessoa).length ? '' : '<div class="tiny muted mt-2">Posicione as pessoas preenchendo Desempenho/Potencial nas avaliações enviadas.</div>'}
    </div>
    <div class="card"><div style="font-weight:800;margin-bottom:6px">⚖️ Calibração de notas (enviadas)</div>
      ${avs.filter(a => notaEfetiva(a) != null).map(a => `
        <div class="flex items-center gap-2" style="border-top:1px solid var(--bd,#e2e8f0);padding:7px 0">
          <span style="flex:1"><b>${esc(uName(a.avaliado_id))}</b> <span class="tiny muted">${esc(a.cargo || '')} · por ${esc(uName(a.avaliador_id))}</span></span>
          <span class="tiny muted">orig ${a.nota_final ?? '—'}</span>
          <input class="input cal-nota" data-id="${a.id}" type="number" step="0.1" min="0" max="${escala()}" value="${a.nota_calibrada ?? ''}" placeholder="calibrar" style="width:90px">
          <button class="btn btn-ghost btn-sm cal-save" data-id="${a.id}">salvar</button>
        </div>`).join('') || '<div class="tiny muted">Nenhuma avaliação enviada pra calibrar.</div>'}</div>`;
  body.querySelectorAll('.cal-save').forEach(b => b.onclick = async () => {
    const inp = body.querySelector(`.cal-nota[data-id="${b.dataset.id}"]`);
    try { await api.request(EP, { method: 'POST', body: { action: 'calibrar', id: b.dataset.id, nota_calibrada: inp.value === '' ? null : parseFloat(inp.value) } });
      b.textContent = '✓'; const a = _data.avaliacoes.find(x => x.id === b.dataset.id); if (a) a.nota_calibrada = inp.value === '' ? null : parseFloat(inp.value); } catch (e) { alert(e.message); }
  });
}

// delega cliques de delete de feedback (mural) — bind global simples
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-del-fb]'); if (!b || !_host) return;
  if (!confirm('Remover feedback?')) return;
  try { await api.request(EP, { method: 'POST', body: { action: 'feedback_del', id: b.dataset.delFb } }); await renderAvaliacoes(_host); } catch (err) { alert(err.message); }
});
