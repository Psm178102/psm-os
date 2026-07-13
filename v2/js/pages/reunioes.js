/* ============================================================================
   PSM-OS v2 — Reuniões da PSM · Diretoria  (v81.36)
   Duas abas:
     📋 Formatos              — modelos/pautas editáveis (shared_kv 'reuniao_formatos')
     🗓️ Reuniões & Combinados — REGISTRO das reuniões (tabela reunioes_atas):
        histórico filtrável + combinados (checklist + "virar tarefa" cobrada) +
        próxima reunião/recorrência que cai na Agenda. Resolve: perder histórico,
        combinado não cumprido, prazo de rotina.
============================================================================ */
import { api } from '../api.js';

let _root = null, _tab = 'reunioes';

// Formatos (aba existente)
let _items = [], _canEditF = false, _editingF = null, _busyF = false, _drive = {}, _driveEdit = false;
// Reuniões (aba nova)
let _atas = [], _tipos = [], _canEdit = false, _users = [], _editingR = null, _busyR = false;
let _fTipo = '', _fStatus = '', _loadedR = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '';
const hoje = () => new Date().toISOString().substring(0, 10);
const body = () => _root.querySelector('#rn-body');

export async function pageReunioes(ctx, root) {
  _root = root; _editingF = null; _editingR = null;
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title" style="margin:0">🤝 Reuniões da PSM</h2>
      <p class="tiny muted" style="margin:2px 0 10px">Modelos de reunião + registro de tudo que foi combinado, com prazos e cobrança.</p>
      <div class="flex gap-1" id="rn-tabs" style="border-bottom:1px solid var(--bd,#e2e8f0)"></div>
    </div>
    <div id="rn-body"><div class="card mt-3"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div></div>`;
  renderTabs();
  renderTab();
}

function renderTabs() {
  const tabs = [['reunioes', '🗓️ Reuniões & Combinados'], ['formatos', '📋 Formatos']];
  const el = _root.querySelector('#rn-tabs');
  el.innerHTML = tabs.map(([id, lbl]) => {
    const on = id === _tab;
    return `<button class="rn-tab" data-tab="${id}" style="background:none;border:none;padding:9px 14px;cursor:pointer;font-weight:800;font-size:13px;border-bottom:3px solid ${on ? 'var(--psm-navy,#1e3a5f)' : 'transparent'};color:${on ? 'var(--ink,#0f172a)' : 'var(--ink-muted,#64748b)'}">${lbl}</button>`;
  }).join('');
  el.querySelectorAll('.rn-tab').forEach(b => b.onclick = () => { _tab = b.dataset.tab; renderTabs(); renderTab(); });
}

function renderTab() {
  if (_tab === 'formatos') return loadFormatos();
  return loadReunioes(!_loadedR);
}

/* ═══════════════════════ ABA REUNIÕES (nova) ═══════════════════════ */

async function loadReunioes() {
  body().innerHTML = `<div class="card mt-3"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando reuniões…</div></div>`;
  try {
    const [r, u] = await Promise.all([
      api.request('/api/v3/reunioes/atas'),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _atas = r.atas || [];
    _tipos = r.tipos || [];
    _canEdit = !!r.can_edit;
    _users = (u.users || []).filter(x => (x.status || 'ativo') === 'ativo');
    _loadedR = true;
    renderReunioes();
  } catch (e) {
    body().innerHTML = `<div class="alert alert-err mt-3">Erro: ${esc(e.message)}</div>`;
  }
}

const tipoInfo = id => _tipos.find(t => t.id === id) || { id, label: id || 'Reunião', emoji: '📋', cor: '#64748b' };
const userName = id => (_users.find(u => u.id === id) || {}).name || id || '';

// status de 1 combinado: feito | atrasado | pendente
function combStatus(c) {
  if (c.feito) return 'feito';
  if (c.prazo && String(c.prazo).substring(0, 10) < hoje()) return 'atrasado';
  return 'pendente';
}

function renderReunioes() {
  let list = _atas.slice();
  if (_fTipo) list = list.filter(a => a.tipo === _fTipo);
  if (_fStatus) list = list.filter(a => (a.combinados || []).some(c => combStatus(c) === _fStatus));

  // semáforo global (sobre a lista filtrada por tipo)
  const base = _fTipo ? _atas.filter(a => a.tipo === _fTipo) : _atas;
  let feito = 0, pend = 0, atr = 0;
  base.forEach(a => (a.combinados || []).forEach(c => {
    const s = combStatus(c); if (s === 'feito') feito++; else if (s === 'atrasado') atr++; else pend++;
  }));

  const chip = (val, lbl, cor) => `<button class="rn-fstatus" data-s="${val}" style="border:1px solid ${_fStatus === val ? cor : 'var(--bd,#e2e8f0)'};background:${_fStatus === val ? cor + '1a' : 'transparent'};color:${cor};padding:5px 12px;border-radius:999px;font-weight:800;font-size:12px;cursor:pointer">${lbl}</button>`;

  body().innerHTML = `
    <div class="card mt-3">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
          <select id="rn-ftipo" class="input" style="min-width:170px">
            <option value="">Todos os tipos</option>
            ${_tipos.map(t => `<option value="${esc(t.id)}"${_fTipo === t.id ? ' selected' : ''}>${t.emoji} ${esc(t.label)}</option>`).join('')}
          </select>
          ${chip('', 'Todos', '#64748b')}
          ${chip('atrasado', `🔴 Atrasados ${atr}`, '#dc2626')}
          ${chip('pendente', `⏳ Pendentes ${pend}`, '#a16207')}
          ${chip('feito', `✅ Feitos ${feito}`, '#16a34a')}
        </div>
        ${_canEdit ? `<div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" id="rn-tipos">⚙️ Tipos</button>
          <button class="btn btn-primary btn-sm" id="rn-nova">➕ Nova reunião</button>
        </div>` : ''}
      </div>
    </div>
    ${!list.length ? `<div class="card mt-3 muted tiny" style="text-align:center;padding:28px">Nenhuma reunião registrada${_fTipo || _fStatus ? ' com esse filtro' : ' ainda'}. ${_canEdit ? 'Clique em <b>➕ Nova reunião</b>.' : ''}</div>`
      : list.map(ataCard).join('')}`;
  wireReunioes();
}

function ataCard(a) {
  const t = tipoInfo(a.tipo);
  const combs = a.combinados || [];
  const atr = combs.filter(c => combStatus(c) === 'atrasado').length;
  const pend = combs.filter(c => combStatus(c) === 'pendente').length;
  const feito = combs.filter(c => combStatus(c) === 'feito').length;
  const parts = (a.participantes || []).map(userName).filter(Boolean);
  return `
    <div class="card mt-3">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="flex items-center gap-2" style="flex-wrap:wrap">
          <span style="background:${t.cor}1f;color:${t.cor};padding:3px 11px;border-radius:999px;font-weight:800;font-size:12px">${t.emoji} ${esc(t.label)}</span>
          <h3 class="card-title" style="margin:0;font-size:15px">${esc(a.titulo || 'Reunião')}</h3>
          ${a.confidencial ? `<span class="tiny" style="background:#0f172a;color:#fbbf24;padding:2px 9px;border-radius:999px;font-weight:800" title="Só os participantes (e quem criou) veem esta reunião">🔒 Confidencial</span>` : ''}
          ${a.data ? `<span class="tiny muted">📅 ${fmtData(a.data)}${a.hora_inicio ? ' · ' + esc(a.hora_inicio.substring(0, 5)) : ''}</span>` : ''}
        </div>
        ${_canEdit ? `<div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" data-edita="${esc(a.id)}">✏️ Editar</button>
          <button class="btn btn-ghost btn-sm" data-dela="${esc(a.id)}" style="color:#dc2626">🗑</button>
        </div>` : ''}
      </div>
      ${parts.length ? `<div class="tiny muted mt-1">👥 ${parts.map(esc).join(', ')}</div>` : ''}
      ${a.proxima_data ? `<div class="tiny mt-1" style="color:#2563eb;font-weight:700">🔁 Próxima: ${fmtData(a.proxima_data)}${a.recorrencia && a.recorrencia !== 'nenhuma' ? ' · ' + esc(a.recorrencia) : ''} <span class="muted" style="font-weight:400">(na Agenda)</span></div>` : ''}
      ${a.notas ? `<div class="tiny mt-2" style="white-space:pre-wrap;color:var(--ink-muted,#475569);max-height:64px;overflow:hidden">${esc(a.notas)}</div>` : ''}

      ${combs.length ? `<div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:10px 12px">
        <div class="flex items-center gap-2" style="margin-bottom:6px">
          <span class="tiny muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.5px">🤝 Combinados</span>
          ${atr ? `<span class="tiny" style="color:#dc2626;font-weight:800">🔴 ${atr}</span>` : ''}
          ${pend ? `<span class="tiny" style="color:#a16207;font-weight:800">⏳ ${pend}</span>` : ''}
          ${feito ? `<span class="tiny" style="color:#16a34a;font-weight:800">✅ ${feito}</span>` : ''}
        </div>
        ${combs.map(c => combRow(a, c)).join('')}
      </div>` : ''}

      ${(a.anexos && a.anexos.length) ? `<div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        ${a.anexos.map(x => `<a class="btn btn-ghost btn-sm" href="${esc(x.url)}" target="_blank" rel="noopener">📎 ${esc(x.nome)}</a>`).join('')}
      </div>` : ''}
    </div>`;
}

function combRow(a, c) {
  const s = combStatus(c);
  const cor = s === 'feito' ? '#16a34a' : s === 'atrasado' ? '#dc2626' : '#a16207';
  const ic = s === 'feito' ? '✅' : s === 'atrasado' ? '🔴' : '⏳';
  return `
    <div class="flex items-center gap-2" style="padding:4px 0;border-top:1px solid var(--bd,#eef2f7)">
      <input type="checkbox" ${c.feito ? 'checked' : ''} ${_canEdit ? '' : 'disabled'} data-comb-feito="${esc(a.id)}|${esc(c.id)}" title="Marcar como feito">
      <span style="flex:1;font-size:13px;${c.feito ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(c.texto)}</span>
      ${c.responsavel_id ? `<span class="tiny muted">👤 ${esc(userName(c.responsavel_id))}</span>` : ''}
      ${c.prazo ? `<span class="tiny" style="color:${cor};font-weight:700">${ic} ${fmtData(c.prazo)}</span>` : `<span class="tiny" style="color:${cor}">${ic}</span>`}
      ${_canEdit ? (c.task_id
        ? `<span class="tiny" style="color:#16a34a;font-weight:700" title="Já virou tarefa cobrada">✓ tarefa</span>`
        : `<button class="btn btn-ghost btn-sm" data-vira="${esc(a.id)}|${esc(c.id)}" style="padding:2px 8px;font-size:11px" title="Vira uma tarefa de verdade pro responsável (cobrada e notificada)">📌 virar tarefa</button>`) : ''}
    </div>`;
}

function wireReunioes() {
  const $ = s => body().querySelector(s);
  const ft = $('#rn-ftipo'); if (ft) ft.onchange = () => { _fTipo = ft.value; renderReunioes(); };
  body().querySelectorAll('.rn-fstatus').forEach(b => b.onclick = () => { _fStatus = b.dataset.s; renderReunioes(); });
  $('#rn-nova') && ($('#rn-nova').onclick = () => openAta(null));
  $('#rn-tipos') && ($('#rn-tipos').onclick = openTipos);
  body().querySelectorAll('[data-edita]').forEach(b => b.onclick = () => openAta(_atas.find(a => a.id === b.dataset.edita)));
  body().querySelectorAll('[data-dela]').forEach(b => b.onclick = () => delAta(b.dataset.dela));
  body().querySelectorAll('[data-vira]').forEach(b => b.onclick = () => viraTarefa(...b.dataset.vira.split('|')));
  body().querySelectorAll('[data-comb-feito]').forEach(b => b.onchange = () => toggleFeito(...b.dataset.combFeito.split('|'), b.checked));
}

// ── Editor de reunião (modal) ──
function openAta(a) {
  if (!_canEdit) return;
  const isNew = !a;
  // ao criar uma reunião nova de um tipo, sugere os combinados PENDENTES da última do mesmo tipo
  let combinados = (a && Array.isArray(a.combinados)) ? a.combinados.map(c => ({ ...c })) : [];
  const c = a || { tipo: _fTipo || (_tipos[0] && _tipos[0].id) || 'estrategia', status: 'realizada', data: hoje(), participantes: [], recorrencia: 'nenhuma' };
  _editingR = c;

  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow-y:auto';
  ov.innerHTML = `
    <div class="card" style="max-width:680px;width:100%;background:var(--bg-2);margin:auto">
      <div class="flex" style="justify-content:space-between;align-items:center">
        <h3 class="card-title" style="margin:0">${isNew ? '➕ Registrar reunião' : '✏️ Editar reunião'}</h3>
        <button class="btn btn-ghost btn-sm" id="at-x">✕</button>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:160px"><label class="tiny muted">Tipo</label>
          <select id="at-tipo" class="input">${_tipos.map(t => `<option value="${esc(t.id)}"${c.tipo === t.id ? ' selected' : ''}>${t.emoji} ${esc(t.label)}</option>`).join('')}</select></div>
        <div style="flex:2;min-width:200px"><label class="tiny muted">Título</label>
          <input id="at-titulo" class="input" value="${esc(c.titulo || '')}" placeholder="Ex.: Alinhamento semanal Conquista"></div>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:130px"><label class="tiny muted">Data</label>
          <input id="at-data" class="input" type="date" value="${c.data ? String(c.data).substring(0, 10) : ''}"></div>
        <div style="flex:1;min-width:110px"><label class="tiny muted">Início</label>
          <input id="at-hini" class="input" type="time" value="${c.hora_inicio ? String(c.hora_inicio).substring(0, 5) : ''}"></div>
        <div style="flex:1;min-width:110px"><label class="tiny muted">Fim</label>
          <input id="at-hfim" class="input" type="time" value="${c.hora_fim ? String(c.hora_fim).substring(0, 5) : ''}"></div>
      </div>

      <div class="mt-2"><label class="tiny muted">👥 Participantes</label>
        <div id="at-parts" style="max-height:130px;overflow:auto;border:1px solid var(--bd,#e2e8f0);border-radius:8px;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px">
          ${_users.map(u => `<label class="tiny flex gap-1" style="align-items:center"><input type="checkbox" value="${esc(u.id)}" ${(c.participantes || []).includes(u.id) ? 'checked' : ''}> ${esc(u.name)}</label>`).join('')}
        </div>
        <label class="tiny flex gap-1 mt-1" style="align-items:center;font-weight:700;cursor:pointer" title="Só os participantes marcados acima (e quem criou) enxergam esta reunião — nem gestores fora da lista. Também não gera evento na Agenda.">
          <input type="checkbox" id="at-conf" ${c.confidencial ? 'checked' : ''}> 🔒 Confidencial — só os participantes veem (nem a gestão fora da lista)
        </label></div>

      <div class="mt-2"><label class="tiny muted">📋 Pauta / o que foi tratado <button class="btn btn-ghost btn-sm" id="at-pauta-fmt" type="button" style="padding:1px 7px;font-size:10px">↧ puxar do formato</button></label>
        <textarea id="at-pauta" class="input" rows="4" style="resize:vertical">${esc(c.pauta || '')}</textarea></div>
      <div class="mt-2"><label class="tiny muted">📝 Decisões / notas</label>
        <textarea id="at-notas" class="input" rows="3" style="resize:vertical">${esc(c.notas || '')}</textarea></div>

      <div class="mt-3">
        <div class="flex items-center" style="justify-content:space-between">
          <label class="tiny muted" style="font-weight:800">🤝 Combinados (o que ficou combinado)</label>
          <button class="btn btn-ghost btn-sm" id="at-comb-add" type="button">+ combinado</button>
        </div>
        <div id="at-combs"></div>
        ${isNew ? `<button class="btn btn-ghost btn-sm mt-1" id="at-puxar" type="button" title="Traz os combinados ainda pendentes da última reunião desse tipo">↺ puxar pendentes da última</button>` : ''}
      </div>

      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:150px"><label class="tiny muted">🔁 Recorrência</label>
          <select id="at-rec" class="input">
            ${['nenhuma', 'semanal', 'quinzenal', 'mensal'].map(r => `<option value="${r}"${(c.recorrencia || 'nenhuma') === r ? ' selected' : ''}>${r === 'nenhuma' ? 'Sem recorrência' : r}</option>`).join('')}
          </select></div>
        <div style="flex:1;min-width:150px"><label class="tiny muted">📆 Próxima reunião (vai pra Agenda)</label>
          <input id="at-prox" class="input" type="date" value="${c.proxima_data ? String(c.proxima_data).substring(0, 10) : ''}"></div>
      </div>

      <div class="mt-2"><label class="tiny muted">📎 Anexos — uma por linha: <b>Nome | link</b></label>
        <textarea id="at-anexos" class="input" rows="2" style="resize:vertical" placeholder="Ata assinada | https://drive...">${esc((c.anexos || []).map(x => `${x.nome || ''} | ${x.url || ''}`).join('\n'))}</textarea></div>

      <div class="flex gap-2 mt-3" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="at-cancel">Cancelar</button>
        <button class="btn btn-primary" id="at-save">💾 Salvar reunião</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#at-x').onclick = close;
  ov.querySelector('#at-cancel').onclick = close;

  const combsBox = ov.querySelector('#at-combs');
  const renderCombs = () => { combsBox.innerHTML = combinados.map((cb, i) => combEditRow(cb, i)).join(''); };
  const addComb = (seed) => { combinados.push(seed || { id: 'c' + Math.random().toString(36).slice(2, 8), texto: '', responsavel_id: '', prazo: '', feito: false }); renderCombs(); };
  renderCombs();
  ov.querySelector('#at-comb-add').onclick = () => addComb();
  combsBox.addEventListener('click', e => {
    const d = e.target.closest('[data-comb-del]'); if (d) { combinados.splice(+d.dataset.combDel, 1); renderCombs(); }
  });
  // pauta do formato
  ov.querySelector('#at-pauta-fmt').onclick = async () => {
    try {
      const fr = await api.request('/api/v3/docs/reunioes');
      const tipoLbl = tipoInfo(ov.querySelector('#at-tipo').value).label.toLowerCase();
      const fmt = (fr.items || []).find(it => (it.nome || '').toLowerCase().includes(tipoLbl)) || (fr.items || [])[0];
      if (fmt && fmt.pauta) ov.querySelector('#at-pauta').value = fmt.pauta;
      else alert('Nenhum formato com pauta encontrado pra esse tipo.');
    } catch (_) {}
  };
  // puxar pendentes da última
  const puxar = ov.querySelector('#at-puxar');
  if (puxar) puxar.onclick = () => {
    const tipo = ov.querySelector('#at-tipo').value;
    const ult = _atas.filter(x => x.tipo === tipo).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))[0];
    if (!ult) return alert('Não há reunião anterior desse tipo.');
    const pend = (ult.combinados || []).filter(c => !c.feito);
    if (!pend.length) return alert('A última reunião desse tipo não tem combinados pendentes. 🎉');
    pend.forEach(c => addComb({ id: 'c' + Math.random().toString(36).slice(2, 8), texto: c.texto, responsavel_id: c.responsavel_id || '', prazo: c.prazo || '', feito: false }));
  };

  ov.querySelector('#at-save').onclick = () => saveAta(ov, a, () => readCombs(combsBox));
  setTimeout(() => ov.querySelector('#at-titulo')?.focus(), 50);
}

function combEditRow(cb, i) {
  return `
    <div class="flex gap-2" style="align-items:flex-end;margin-top:6px" data-comb-i="${i}">
      <div style="flex:2;min-width:140px"><input class="input cb-texto" value="${esc(cb.texto || '')}" placeholder="O que ficou combinado"></div>
      <div style="flex:1;min-width:120px"><select class="input cb-resp"><option value="">— responsável —</option>${_users.map(u => `<option value="${esc(u.id)}"${cb.responsavel_id === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
      <div style="width:140px"><input class="input cb-prazo" type="date" value="${cb.prazo ? String(cb.prazo).substring(0, 10) : ''}"></div>
      <button class="btn btn-ghost btn-sm" type="button" data-comb-del="${i}" style="color:#dc2626">×</button>
    </div>`;
}

function readCombs(box) {
  return [...box.querySelectorAll('[data-comb-i]')].map(row => {
    const texto = row.querySelector('.cb-texto').value.trim();
    if (!texto) return null;
    const i = +row.dataset.combI;
    const prev = _editingR && (_editingR.combinados || [])[i];
    return {
      id: (prev && prev.id) || 'c' + Math.random().toString(36).slice(2, 8),
      texto,
      responsavel_id: row.querySelector('.cb-resp').value || null,
      responsavel_nome: (_users.find(u => u.id === row.querySelector('.cb-resp').value) || {}).name || null,
      prazo: row.querySelector('.cb-prazo').value || null,
      feito: !!(prev && prev.feito),
      task_id: (prev && prev.task_id) || null,
    };
  }).filter(Boolean);
}

function parseAnexos(txt) {
  return (txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf('|');
    return i < 0 ? { nome: '', url: l.trim() } : { nome: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
  }).filter(a => /^https?:\/\//i.test(a.url));
}

async function saveAta(ov, orig, getCombs) {
  if (_busyR) return;
  const $ = s => ov.querySelector(s);
  const participantes = [...ov.querySelectorAll('#at-parts input:checked')].map(c => c.value);
  const body0 = {
    action: 'upsert', id: orig ? orig.id : undefined,
    tipo: $('#at-tipo').value,
    titulo: $('#at-titulo').value.trim(),
    data: $('#at-data').value || null,
    hora_inicio: $('#at-hini').value || null,
    hora_fim: $('#at-hfim').value || null,
    participantes,
    confidencial: $('#at-conf').checked,
    pauta: $('#at-pauta').value.trim(),
    notas: $('#at-notas').value.trim(),
    combinados: getCombs(),
    anexos: parseAnexos($('#at-anexos').value),
    recorrencia: $('#at-rec').value,
    proxima_data: $('#at-prox').value || null,
    status: 'realizada',
  };
  if (!body0.titulo && !body0.data) return alert('Informe ao menos o título ou a data da reunião.');
  _busyR = true; $('#at-save').disabled = true; $('#at-save').textContent = '⏳ Salvando…';
  try {
    const r = await api.request('/api/v3/reunioes/atas', { method: 'POST', body: body0 });
    if (r && r.aviso) alert(r.aviso);
    _busyR = false; ov.remove();
    await loadReunioes();
  } catch (e) {
    _busyR = false; $('#at-save').disabled = false; $('#at-save').textContent = '💾 Salvar reunião';
    alert('Erro ao salvar: ' + e.message);
  }
}

async function delAta(id) {
  const a = _atas.find(x => x.id === id);
  if (!confirm(`Excluir a reunião "${a?.titulo || tipoInfo(a?.tipo).label}"? Os combinados que já viraram tarefa continuam em Tarefas.`)) return;
  try { await api.request('/api/v3/reunioes/atas', { method: 'POST', body: { action: 'delete', id } }); await loadReunioes(); }
  catch (e) { alert('Erro: ' + e.message); }
}

async function viraTarefa(ataId, combId) {
  const a = _atas.find(x => x.id === ataId);
  try {
    await api.request('/api/v3/reunioes/atas', { method: 'POST', body: { action: 'vira_tarefa', id: ataId, combinado_id: combId, tipo_label: tipoInfo(a?.tipo).label } });
    await loadReunioes();
  } catch (e) { alert('Erro ao virar tarefa: ' + e.message); }
}

async function toggleFeito(ataId, combId, feito) {
  const a = _atas.find(x => x.id === ataId); if (!a) return;
  const combs = (a.combinados || []).map(c => c.id === combId ? { ...c, feito } : c);
  try {
    await api.request('/api/v3/reunioes/atas', {
      method: 'POST', body: {
        action: 'upsert', id: ataId, tipo: a.tipo, titulo: a.titulo, data: a.data,
        hora_inicio: a.hora_inicio, hora_fim: a.hora_fim, participantes: a.participantes,
        pauta: a.pauta, notas: a.notas, combinados: combs, anexos: a.anexos,
        recorrencia: a.recorrencia, proxima_data: a.proxima_data, status: a.status,
      }
    });
    a.combinados = combs; renderReunioes();
  } catch (e) { alert('Erro: ' + e.message); await loadReunioes(); }
}

// ── Gerenciar tipos (personalização) ──
function openTipos() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  const txt = _tipos.map(t => `${t.emoji} | ${t.label} | ${t.cor}`).join('\n');
  ov.innerHTML = `
    <div class="card" style="max-width:520px;width:100%;background:var(--bg-2);margin:auto">
      <h3 class="card-title">⚙️ Tipos de reunião</h3>
      <p class="tiny muted">Um por linha no formato <b>emoji | Nome | #cor</b>. Só o Nome é obrigatório. Esses tipos aparecem em toda reunião — adicione/remova à vontade.</p>
      <textarea id="tp-txt" class="input mt-2" rows="10" style="resize:vertical;font-family:inherit">${esc(txt)}</textarea>
      <div class="flex gap-2 mt-3" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="tp-cancel">Cancelar</button>
        <button class="btn btn-primary" id="tp-save">💾 Salvar tipos</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#tp-cancel').onclick = close;
  ov.querySelector('#tp-save').onclick = async () => {
    const tipos = ov.querySelector('#tp-txt').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const p = l.split('|').map(x => x.trim());
      let emoji = '📋', label = '', cor = '#64748b';
      if (p.length >= 3) { emoji = p[0] || emoji; label = p[1]; cor = p[2] || cor; }
      else if (p.length === 2) { emoji = p[0] || emoji; label = p[1]; }
      else { label = p[0]; }
      const id = (_tipos.find(t => t.label.toLowerCase() === label.toLowerCase()) || {}).id
        || label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
      return { id, label, emoji, cor };
    }).filter(t => t.label);
    if (!tipos.length) return alert('Informe ao menos 1 tipo.');
    try {
      const r = await api.request('/api/v3/reunioes/atas', { method: 'POST', body: { action: 'set_tipos', tipos } });
      _tipos = r.tipos || tipos; close(); renderReunioes();
    } catch (e) { alert('Erro: ' + e.message); }
  };
}

/* ═══════════════════════ ABA FORMATOS (existente) ═══════════════════════ */

async function loadFormatos(maybeSeed = true) {
  body().innerHTML = `<div class="card mt-3"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando formatos…</div></div>`;
  try {
    const r = await api.request('/api/v3/docs/reunioes');
    _items = r.items || []; _drive = r.drive || {}; _canEditF = !!r.can_edit;
    if (maybeSeed && !r.seeded && _canEditF) {
      try { await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'seed' } }); return loadFormatos(false); } catch (_) {}
    }
    renderFormatos();
  } catch (e) {
    body().innerHTML = `<div class="alert alert-err mt-3">Erro: ${esc(e.message)}</div>`;
  }
}

function renderFormatos() {
  body().innerHTML = `
    <div class="card mt-3">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h3 class="card-title" style="margin:0;font-size:16px">📋 Formatos de Reunião</h3>
          <p class="tiny muted" style="margin:2px 0 0;max-width:680px">Modelos/pautas das reuniões da PSM. ${_canEditF ? 'Edite a pauta, o objetivo, o checklist e anexe arquivos (links do Drive).' : 'Somente leitura.'}</p>
        </div>
        ${_canEditF ? `<button class="btn btn-primary btn-sm" id="rn-new">➕ Novo formato</button>` : ''}
      </div>
      ${driveHTML()}
    </div>
    ${_editingF === 'new' ? formHTML(null) : ''}
    ${_items.map(it => _editingF === it.id ? formHTML(it) : cardHTML(it)).join('')}
    ${!_items.length ? '<div class="card mt-3 muted tiny" style="text-align:center;padding:24px">Nenhum formato cadastrado.</div>' : ''}`;
  wireFormatos();
}

function driveHTML() {
  if (_driveEdit) {
    return `
      <div class="mt-3" style="background:var(--bg-3);border:1px solid var(--bd);border-radius:10px;padding:12px 14px">
        <div class="tiny muted" style="font-weight:800;margin-bottom:6px">📂 Pasta / arquivo das reuniões no Google Drive</div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <input id="dr-label" class="input" style="flex:1;min-width:160px" placeholder="Rótulo (ex.: Pasta das reuniões)" value="${esc(_drive.label || '')}">
          <input id="dr-url" class="input" style="flex:2;min-width:240px" placeholder="https://drive.google.com/…" value="${esc(_drive.url || '')}">
        </div>
        <div class="flex gap-2 mt-2">
          <button class="btn btn-primary btn-sm" id="dr-save">💾 Salvar link</button>
          <button class="btn btn-ghost btn-sm" id="dr-cancel">Cancelar</button>
        </div>
        <p class="tiny muted mt-2">💡 No Drive: clique direito → <b>Compartilhar</b> → "Qualquer pessoa com o link" → <b>Copiar link</b>.</p>
      </div>`;
  }
  if (_drive.url) {
    return `<div class="flex items-center gap-2 mt-3" style="flex-wrap:wrap">
      <a class="btn btn-primary btn-sm" href="${esc(_drive.url)}" target="_blank" rel="noopener noreferrer">📂 ${esc(_drive.label || 'Arquivos no Drive')} — Abrir / baixar</a>
      ${_canEditF ? `<button class="btn btn-ghost btn-sm" id="dr-edit">✏️ Editar link</button>` : ''}
    </div>`;
  }
  return _canEditF ? `<div class="mt-3"><button class="btn btn-ghost btn-sm" id="dr-edit">📂 Definir link do Drive (pasta de arquivos)</button></div>` : '';
}

function cardHTML(it) {
  const meta = [
    it.cadencia && ['🔁 Cadência', it.cadencia],
    it.quando && ['📆 Quando', it.quando],
    it.duracao && ['⏱ Duração', it.duracao],
    it.participantes && ['👥 Participantes', it.participantes],
  ].filter(Boolean);
  return `
    <div class="card mt-3">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h3 class="card-title" style="margin:0;font-size:16px">${it.emoji || '📋'} ${esc(it.nome)}</h3>
        <div class="flex gap-2">
          ${it.cadencia ? `<span class="tiny" style="background:#2563eb1a;color:#2563eb;padding:3px 10px;border-radius:999px;font-weight:700">${esc(it.cadencia)}</span>` : ''}
          ${_canEditF ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">✏️ Editar</button>
            <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" style="color:#dc2626">🗑</button>` : ''}
        </div>
      </div>
      ${it.objetivo ? `<p class="tiny" style="margin:6px 0 0;color:var(--ink-muted,#475569)"><b>🎯 Objetivo:</b> ${esc(it.objetivo)}</p>` : ''}
      ${meta.length ? `<div class="flex gap-3 mt-2" style="flex-wrap:wrap">${meta.map(([k, v]) => `<span class="tiny muted"><b>${k}:</b> ${esc(v)}</span>`).join('')}</div>` : ''}
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap;align-items:flex-start">
        ${it.pauta ? `<div style="flex:2;min-width:280px;background:var(--bg-3);border-radius:10px;padding:12px 14px">
          <div class="tiny muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📋 Pauta / roteiro</div>
          <div style="font-size:13px;line-height:1.6">${nl2br(it.pauta)}</div></div>` : ''}
        ${(it.checklist && it.checklist.length) ? `<div style="flex:1;min-width:220px;background:var(--bg-3);border-radius:10px;padding:12px 14px">
          <div class="tiny muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">✅ Checklist</div>
          ${it.checklist.map(c => `<div style="font-size:13px;line-height:1.7">☐ ${esc(c)}</div>`).join('')}</div>` : ''}
      </div>
      ${(it.arquivos && it.arquivos.length) ? `
        <div class="mt-3">
          <div class="tiny muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📎 Arquivos editáveis</div>
          <div class="flex gap-2" style="flex-wrap:wrap">
            ${it.arquivos.map(a => `<a class="btn btn-ghost btn-sm" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">📄 ${esc(a.nome || 'Arquivo')}</a>`).join('')}
          </div>
        </div>` : ''}
    </div>`;
}

function formHTML(it) {
  const v = it || {};
  const arquivosTxt = (v.arquivos || []).map(a => `${a.nome || ''} | ${a.url || ''}`).join('\n');
  const checklistTxt = (v.checklist || []).join('\n');
  return `
    <div class="card mt-3" style="border:1px solid var(--bd);background:var(--bg-3)">
      <h3 class="card-title" style="font-size:15px">${it ? '✏️ Editar formato' : '➕ Novo formato de reunião'}</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div style="width:70px"><label class="tiny muted">Emoji</label><input id="rf-emoji" class="input" maxlength="8" value="${esc(v.emoji || '')}" placeholder="📋"></div>
        <div style="flex:2;min-width:200px"><label class="tiny muted">Nome *</label><input id="rf-nome" class="input" value="${esc(v.nome || '')}" placeholder="Ex.: Reunião Matinal"></div>
        <div style="flex:1;min-width:140px"><label class="tiny muted">Cadência</label><input id="rf-cad" class="input" value="${esc(v.cadencia || '')}" placeholder="3x por semana"></div>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <div style="flex:2;min-width:200px"><label class="tiny muted">Quando</label><input id="rf-quando" class="input" value="${esc(v.quando || '')}" placeholder="Seg, Qua, Sex — 8h30"></div>
        <div style="flex:1;min-width:120px"><label class="tiny muted">Duração</label><input id="rf-dur" class="input" value="${esc(v.duracao || '')}" placeholder="15 min"></div>
        <div style="flex:2;min-width:200px"><label class="tiny muted">Participantes</label><input id="rf-part" class="input" value="${esc(v.participantes || '')}" placeholder="Equipe de vendas"></div>
      </div>
      <div class="mt-2"><label class="tiny muted">🎯 Objetivo</label><input id="rf-obj" class="input" value="${esc(v.objetivo || '')}" placeholder="Para que serve esta reunião"></div>
      <div class="mt-2"><label class="tiny muted">📋 Pauta / roteiro (uma linha por tópico)</label>
        <textarea id="rf-pauta" class="input" rows="7" style="resize:vertical;font-family:inherit">${esc(v.pauta || '')}</textarea></div>
      <div class="mt-2"><label class="tiny muted">✅ Checklist (uma linha por item)</label>
        <textarea id="rf-check" class="input" rows="4" style="resize:vertical;font-family:inherit">${esc(checklistTxt)}</textarea></div>
      <div class="mt-2"><label class="tiny muted">📎 Arquivos editáveis — uma por linha no formato <b>Nome | link do Drive</b></label>
        <textarea id="rf-arq" class="input" rows="3" style="resize:vertical;font-family:inherit" placeholder="Ata padrão | https://docs.google.com/...">${esc(arquivosTxt)}</textarea></div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary btn-sm" id="rf-save">${_busyF ? '⏳ Salvando…' : '💾 Salvar'}</button>
        <button class="btn btn-ghost btn-sm" id="rf-cancel">Cancelar</button>
      </div>
    </div>`;
}

function wireFormatos() {
  const $ = s => body().querySelector(s);
  $('#rn-new') && ($('#rn-new').onclick = () => { _editingF = 'new'; renderFormatos(); });
  body().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { _editingF = b.dataset.edit; renderFormatos(); });
  body().querySelectorAll('[data-del]').forEach(b => b.onclick = () => delFormato(b.dataset.del));
  $('#rf-cancel') && ($('#rf-cancel').onclick = () => { _editingF = null; renderFormatos(); });
  $('#rf-save') && ($('#rf-save').onclick = saveFormato);
  $('#dr-edit') && ($('#dr-edit').onclick = () => { _driveEdit = true; renderFormatos(); });
  $('#dr-cancel') && ($('#dr-cancel').onclick = () => { _driveEdit = false; renderFormatos(); });
  $('#dr-save') && ($('#dr-save').onclick = saveDrive);
}

async function saveDrive() {
  const $ = s => body().querySelector(s);
  const url = ($('#dr-url').value || '').trim();
  const label = ($('#dr-label').value || '').trim();
  if (url && !/^https?:\/\//i.test(url)) return alert('Cole um link válido do Google Drive (começando com http/https).');
  try {
    await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'set_drive', drive: { url, label } } });
    _driveEdit = false; await loadFormatos(false);
  } catch (e) { alert('Erro ao salvar o link: ' + e.message); }
}

function parseArquivos(txt) {
  return (txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf('|');
    if (i < 0) return { nome: '', url: l.trim() };
    return { nome: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
  }).filter(a => /^https?:\/\//i.test(a.url));
}

async function saveFormato() {
  if (_busyF) return;
  const $ = s => body().querySelector(s);
  const item = {
    emoji: $('#rf-emoji').value.trim(), nome: $('#rf-nome').value.trim(),
    cadencia: $('#rf-cad').value.trim(), quando: $('#rf-quando').value.trim(),
    duracao: $('#rf-dur').value.trim(), participantes: $('#rf-part').value.trim(),
    objetivo: $('#rf-obj').value.trim(), pauta: $('#rf-pauta').value,
    checklist: $('#rf-check').value.split('\n').map(s => s.trim()).filter(Boolean),
    arquivos: parseArquivos($('#rf-arq').value),
  };
  if (!item.nome) return alert('Informe o nome do formato.');
  _busyF = true; renderFormatos();
  try {
    const id = _editingF !== 'new' ? _editingF : null;
    await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'upsert', id, item } });
    _editingF = null; _busyF = false; await loadFormatos(false);
  } catch (e) { _busyF = false; renderFormatos(); alert('Erro ao salvar: ' + e.message); }
}

async function delFormato(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir o formato "${it?.nome || ''}"?`)) return;
  try { await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'delete', id } }); await loadFormatos(false); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}
