/* ============================================================================
   PSM-OS v2 — Agenda + Eventos
   Sprint 7.13
============================================================================ */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';

const TIPOS = [
  { id: 'plantao', lbl: 'Plantão',   color: '#2563eb', ico: '🛡' },
  { id: 'reuniao', lbl: 'Reunião',   color: '#7c3aed', ico: '💼' },
  { id: 'visita',  lbl: 'Visita',    color: '#16a34a', ico: '🏠' },
  { id: 'tarefa',  lbl: 'Tarefa',    color: '#d97706', ico: '✅' },
  { id: 'evento',  lbl: 'Evento',    color: '#dc2626', ico: '🎉' },
  { id: 'outro',   lbl: 'Outro',     color: '#64748b', ico: '·' },
];

const STATUS_LBL = {
  agendado:   { lbl: 'Agendado',   color: '#64748b' },
  confirmado: { lbl: 'Confirmado', color: '#16a34a' },
  cancelado:  { lbl: 'Cancelado',  color: '#dc2626' },
  realizado:  { lbl: 'Realizado',  color: '#2563eb' },
};

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let _root = null;
let _eventos = [];
let _users = [];
let _view = 'lista';      // lista | calendario
let _mesAtual = new Date();
let _filterTipo = '';
let _filterCorretor = '';
let _convites = [];        // convites pendentes de aceite (v84.57)
let _podeVerTime = false;  // sócio/gerente podem alternar pra visão do time
let _escopo = 'self';      // self | time

export async function pageAgenda(ctx, root) {
  _root = root;
  await reload();
}

async function reload() {
  if (_root) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando agenda…</div></div>';
  try {
    // No modo calendário, busca o mês inteiro; no modo lista, próximos 30d
    let since, until;
    if (_view === 'calendario') {
      const start = new Date(_mesAtual.getFullYear(), _mesAtual.getMonth(), 1);
      const end = new Date(_mesAtual.getFullYear(), _mesAtual.getMonth() + 1, 0);
      since = isoDate(start); until = isoDate(end);
    } else {
      const today = new Date(); const future = new Date(); future.setDate(today.getDate() + 60);
      since = isoDate(today); until = isoDate(future);
    }

    const qs = new URLSearchParams({ since, until });
    if (_filterTipo)     qs.set('tipo', _filterTipo);
    if (_filterCorretor) qs.set('corretor_id', _filterCorretor);
    if (_escopo === 'time') qs.set('escopo', 'time');

    const [evRes, usrRes] = await Promise.all([
      api.request('/api/v3/agenda/list?' + qs.toString()),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _eventos = evRes.eventos || [];
    _convites = evRes.convites || [];
    _podeVerTime = !!evRes.pode_ver_time;
    if (usrRes.users) _users = usrRes.users;
    render(evRes.scope);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

/* Convites esperando decisão. Ficam FORA da agenda até a pessoa aceitar —
   é isso que diferencia "te incluíram numa lista" de "está no meu calendário". */
function convitesCard() {
  if (!_convites.length || _escopo === 'time') return '';
  return `<div class="mt-2" style="background:#2563eb10;border-radius:10px;padding:10px 12px;border-left:3px solid #2563eb">
    <b class="tiny">📨 ${_convites.length} convite(s) esperando você</b>
    <div class="tiny muted">Só entram na sua agenda (e no seu Zoho) se você aceitar.</div>
    ${_convites.map(c => `<div class="flex items-center mt-2" style="gap:8px;flex-wrap:wrap;background:var(--bg-2);border-radius:8px;padding:7px 10px">
      <div style="flex:1;min-width:170px">
        <b class="tiny">${escapeHtml(c.titulo || 'Evento')}</b>
        <div class="tiny muted">${fmtDataBR(c.data)}${c.hora_inicio ? ' · ' + c.hora_inicio.slice(0, 5) : ' · dia todo'}${c.local ? ' · ' + escapeHtml(c.local) : ''} · de ${escapeHtml(nomeDe(c.criado_por))}</div>
      </div>
      <button class="btn btn-primary btn-sm cv-ok" data-id="${escapeHtml(c.id)}">✅ Aceitar</button>
      <button class="btn btn-ghost btn-sm cv-no" data-id="${escapeHtml(c.id)}" style="color:#dc2626">Recusar</button>
    </div>`).join('')}
  </div>`;
}

function nomeDe(uid) {
  const u = (_users || []).find(x => x.id === uid);
  return (u && u.name) || uid || '—';
}

function fmtDataBR(d) {
  return d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—';
}

function render(scope) {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📅 ${_escopo === 'time' ? 'Agenda do time' : 'Minha agenda'} ${_view === 'calendario' ? '— ' + MESES_NOMES[_mesAtual.getMonth()] + ' ' + _mesAtual.getFullYear() : ''}</h2>
      <p class="card-sub">
        ${_escopo === 'time' ? '👥 Vendo a agenda operacional do time' : '🔒 Só a sua agenda — ninguém mais vê'} · ${_eventos.length} evento(s) no período
        ${_podeVerTime ? `<button class="btn btn-ghost btn-sm" id="ag-escopo" style="margin-left:8px">${_escopo === 'time' ? '🔒 ver só a minha' : '👥 ver agenda do time'}</button>` : ''}
      </p>
      ${convitesCard()}
      <div id="zoho-banner" class="mt-2"></div>

      <!-- Controles -->
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <button class="btn ${_view === 'lista' ? 'btn-primary' : 'btn-ghost'}" data-view="lista">📋 Lista</button>
        <button class="btn ${_view === 'calendario' ? 'btn-primary' : 'btn-ghost'}" data-view="calendario">📅 Calendário</button>
        ${_view === 'calendario' ? `
          <button class="btn btn-ghost" id="prev-mes">‹</button>
          <button class="btn btn-ghost" id="hoje-mes">Hoje</button>
          <button class="btn btn-ghost" id="next-mes">›</button>
        ` : ''}
        <label class="tiny muted" style="font-weight:700;margin-left:14px">TIPO:</label>
        <select id="f-tipo" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todos</option>
          ${TIPOS.map(t => `<option value="${t.id}"${_filterTipo===t.id?' selected':''}>${t.ico} ${t.lbl}</option>`).join('')}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">CORRETOR:</label>
        <select id="f-corretor" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todos</option>
          ${selectableUsers(_users, _filterCorretor).map(u => `<option value="${escapeHtml(u.id)}"${_filterCorretor===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="btn-novo" style="margin-left:auto">+ Novo evento</button>
      </div>

      <!-- Legenda tipos -->
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        ${TIPOS.map(t => `<span class="tiny" style="background:${t.color};color:#fff;padding:3px 8px;border-radius:var(--r-full);font-weight:600">${t.ico} ${t.lbl}</span>`).join('')}
      </div>

      <div id="agenda-body" style="margin-top:14px">
        ${_view === 'lista' ? renderLista() : renderCalendario()}
      </div>

      <div id="modal-evento" style="display:none"></div>
    </div>
  `;

  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', async () => {
    _view = b.dataset.view; await reload();
  }));
  document.getElementById('f-tipo').addEventListener('change', async e => { _filterTipo = e.target.value; await reload(); });
  document.getElementById('f-corretor').addEventListener('change', async e => { _filterCorretor = e.target.value; await reload(); });
  document.getElementById('btn-novo').addEventListener('click', () => openModal());

  if (_view === 'calendario') {
    document.getElementById('prev-mes').addEventListener('click', async () => {
      _mesAtual = new Date(_mesAtual.getFullYear(), _mesAtual.getMonth() - 1, 1); await reload();
    });
    document.getElementById('next-mes').addEventListener('click', async () => {
      _mesAtual = new Date(_mesAtual.getFullYear(), _mesAtual.getMonth() + 1, 1); await reload();
    });
    document.getElementById('hoje-mes').addEventListener('click', async () => {
      _mesAtual = new Date(); await reload();
    });
  }

  document.querySelectorAll('[data-evento]').forEach(el => el.addEventListener('click', () => openModal(el.dataset.evento)));

  // alterna minha agenda ⇄ agenda do time (só sócio/gerente têm o botão)
  const bEsc = document.getElementById('ag-escopo');
  if (bEsc) bEsc.onclick = () => { _escopo = _escopo === 'time' ? 'self' : 'time'; reload(); };

  // aceitar / recusar convite
  document.querySelectorAll('.cv-ok, .cv-no').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const aceitar = b.classList.contains('cv-ok');
    b.disabled = true; b.textContent = '…';
    try {
      await api.request('/api/v3/agenda/convite', { method: 'POST', body: { id: b.dataset.id, acao: aceitar ? 'aceitar' : 'recusar' } });
      reload();
    } catch (err) {
      b.disabled = false;
      alert('❌ Não consegui registrar sua resposta: ' + (err.message || err));
      b.textContent = aceitar ? '✅ Aceitar' : 'Recusar';
    }
  }));
  loadZohoBanner();
}

// ─── Zoho Calendar (2 vias, por usuário) ────────────────────────────────
async function loadZohoBanner() {
  const host = document.getElementById('zoho-banner');
  if (!host) return;
  let st;
  try { st = await api.request('/api/v3/zoho/status'); } catch { host.innerHTML = ''; return; }
  if (!st.configurado) { host.innerHTML = ''; return; }  // Zoho ainda não ligado no Vercel
  if (!st.conectado) {
    host.innerHTML = `<div class="flex items-center gap-2" style="flex-wrap:wrap;background:#c8202015;border:1px solid #c8202040;border-radius:10px;padding:8px 12px">
      <b class="tiny">📮 Zoho Calendar</b>
      <span class="tiny muted">Conecte sua conta pra sincronizar a agenda nos dois sentidos (Zoho ⇄ House).</span>
      <button class="btn btn-primary btn-sm" id="zoho-conn" style="margin-left:auto">🔗 Conectar meu Zoho</button>
    </div>`;
    host.querySelector('#zoho-conn').onclick = async () => {
      try { const r = await api.request('/api/v3/zoho/connect'); if (r.url) location.href = r.url; }
      catch (e) { alert('Erro ao iniciar conexão: ' + e.message); }
    };
    return;
  }
  const r = st.last_sync_res || {};
  const quando = st.last_sync_at ? new Date(st.last_sync_at).toLocaleString('pt-BR') : 'ainda não';
  host.innerHTML = `<div class="flex items-center gap-2" style="flex-wrap:wrap;background:#16a34a15;border:1px solid #16a34a40;border-radius:10px;padding:8px 12px">
    <b class="tiny">📮 Zoho conectado</b>
    <span class="tiny muted">${escapeHtml(st.zoho_email || '')} · última sync: ${escapeHtml(quando)}${r.puxados != null ? ` (↓${r.puxados} ↑${r.enviados || 0})` : ''}</span>
    <button class="btn btn-ghost btn-sm" id="zoho-sync" style="margin-left:auto">🔄 Sincronizar agora</button>
    <button class="btn btn-ghost btn-sm" id="zoho-off" style="color:#dc2626">Desconectar</button>
  </div>`;
  host.querySelector('#zoho-sync').onclick = async (e) => {
    const b = e.target; b.disabled = true; b.textContent = '⏳ Sincronizando…';
    try { const s = await api.request('/api/v3/zoho/sync', { method: 'POST', body: {} });
      alert(`🔄 Pronto!\n↓ ${s.puxados || 0} do Zoho (${s.criados_house || 0} novos) · ↑ ${s.enviados || 0} enviados`); await reload(); }
    catch (err) { alert('Erro na sync: ' + err.message); b.disabled = false; b.textContent = '🔄 Sincronizar agora'; }
  };
  host.querySelector('#zoho-off').onclick = async () => {
    if (!confirm('Desconectar seu Zoho? Os eventos já sincronizados continuam na agenda; novas mudanças param de fluir.')) return;
    try { await api.request('/api/v3/zoho/status', { method: 'POST', body: { action: 'disconnect' } }); loadZohoBanner(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
}

// ─── Visão Lista ────────────────────────────────────────────────────────
function renderLista() {
  if (!_eventos.length) {
    return '<div class="card" style="margin:0"><div class="muted text-center" style="padding:30px">Nenhum evento no período. Clica "+ Novo evento" pra começar.</div></div>';
  }

  // Agrupar por data
  const byDate = {};
  _eventos.forEach(ev => { (byDate[ev.data] = byDate[ev.data] || []).push(ev); });
  const sortedDates = Object.keys(byDate).sort();

  return sortedDates.map(d => {
    const dt = new Date(d + 'T12:00:00');
    const diaSem = DIAS_SEMANA[dt.getDay()];
    const dataFmt = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `
      <div style="margin-bottom:14px">
        <div style="font-weight:800;font-size:13px;color:var(--ink-muted);margin-bottom:6px;letter-spacing:1px;text-transform:uppercase">${diaSem}, ${dataFmt}</div>
        <div style="display:grid;gap:6px">
          ${byDate[d].sort((a,b) => (a.hora_inicio || '99:99').localeCompare(b.hora_inicio || '99:99')).map(eventoRow).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function eventoRow(ev) {
  const tipo = TIPOS.find(t => t.id === ev.tipo) || TIPOS[5];
  const corretor = _users.find(u => u.id === ev.corretor_id);
  const horario = ev.all_day ? 'Dia todo' : (ev.hora_inicio ? ev.hora_inicio.substring(0,5) + (ev.hora_fim ? '–' + ev.hora_fim.substring(0,5) : '') : '');
  const statusMeta = STATUS_LBL[ev.status] || STATUS_LBL.agendado;
  return `
    <div data-evento="${ev.id}" style="display:grid;grid-template-columns:auto 90px 1fr auto;gap:10px;padding:10px 12px;background:var(--bg-3);border-left:4px solid ${tipo.color};border-radius:var(--r-sm);cursor:pointer;align-items:center;font-size:13px" title="Click pra editar">
      <div style="font-size:18px">${tipo.ico}</div>
      <div class="tiny muted" style="text-align:center">${horario || '—'}</div>
      <div style="min-width:0">
        <div style="font-weight:700">${escapeHtml(ev.titulo)}</div>
        <div class="tiny muted">
          ${corretor ? '👤 ' + escapeHtml(corretor.name) + ' · ' : ''}
          ${ev.local ? '📍 ' + escapeHtml(ev.local) + ' · ' : ''}
          <span style="color:${statusMeta.color};font-weight:600">${statusMeta.lbl}</span>
        </div>
      </div>
      <div class="tiny" style="background:${tipo.color};color:#fff;padding:3px 8px;border-radius:var(--r-full);font-weight:600">${tipo.lbl}</div>
    </div>
  `;
}

// ─── Visão Calendário ──────────────────────────────────────────────────
function renderCalendario() {
  const ano = _mesAtual.getFullYear();
  const mes = _mesAtual.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const totalDias = ultimoDia.getDate();
  const startWeekday = primeiroDia.getDay();

  // Agrupar eventos por dia
  const byDay = {};
  _eventos.forEach(ev => {
    const day = parseInt(ev.data.split('-')[2], 10);
    (byDay[day] = byDay[day] || []).push(ev);
  });

  const cells = [];
  // Vazios no início
  for (let i = 0; i < startWeekday; i++) cells.push('<div></div>');
  // Dias do mês
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === ano && today.getMonth() === mes;
  for (let d = 1; d <= totalDias; d++) {
    const isToday = isCurrentMonth && today.getDate() === d;
    const evDay = byDay[d] || [];
    cells.push(`
      <div style="border:1px solid var(--border);border-radius:var(--r-sm);padding:6px;min-height:84px;background:${isToday ? '#dbeafe' : 'var(--bg-2)'};display:flex;flex-direction:column;gap:3px">
        <div style="font-weight:${isToday ? 800 : 600};font-size:12px;color:${isToday ? '#1e40af' : 'var(--ink)'}">${d}</div>
        ${evDay.slice(0, 3).map(ev => {
          const t = TIPOS.find(x => x.id === ev.tipo) || TIPOS[5];
          return `<div data-evento="${ev.id}" style="background:${t.color};color:#fff;font-size:10px;padding:2px 4px;border-radius:3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(ev.titulo)}">${t.ico} ${escapeHtml(ev.titulo.substring(0, 18))}</div>`;
        }).join('')}
        ${evDay.length > 3 ? `<div class="tiny muted">+${evDay.length - 3} mais</div>` : ''}
      </div>
    `);
  }

  return `
    <div style="display:grid;grid-template-columns:repeat(7, 1fr);gap:4px;margin-bottom:4px">
      ${DIAS_SEMANA.map(d => `<div style="text-align:center;font-weight:700;font-size:11px;color:var(--ink-muted);padding:6px">${d}</div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7, 1fr);gap:4px">
      ${cells.join('')}
    </div>
  `;
}

// ─── Modal Novo/Editar ──────────────────────────────────────────────────
function openModal(evId) {
  const ev = evId ? _eventos.find(e => e.id === evId) : null;
  const isEdit = !!ev;
  const me = auth.user();
  const canDelete = isEdit && ((me?.lvl || 0) >= 7 || ev.criado_por === me?.id);

  const modal = document.getElementById('modal-evento');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:520px;width:100%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">${isEdit ? '✏️ Editar evento' : '➕ Novo evento'}</h3>
      <div class="field">
        <label>Tipo *</label>
        <select id="ev-tipo" class="select">
          ${TIPOS.map(t => `<option value="${t.id}"${ev?.tipo === t.id ? ' selected' : (!ev && t.id === 'reuniao' ? ' selected' : '')}>${t.ico} ${t.lbl}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Título *</label>
        <input id="ev-titulo" class="input" value="${ev ? escapeHtml(ev.titulo) : ''}" placeholder="Ex: Reunião comercial">
      </div>
      <div class="field">
        <label>Descrição</label>
        <textarea id="ev-desc" class="input" rows="2">${ev?.descricao ? escapeHtml(ev.descricao) : ''}</textarea>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px">
          <label>Data *</label>
          <input id="ev-data" type="date" class="input" value="${ev?.data || isoDate(new Date())}">
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Hora início</label>
          <input id="ev-hi" type="time" class="input" value="${ev?.hora_inicio ? ev.hora_inicio.substring(0,5) : ''}">
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label>Hora fim</label>
          <input id="ev-hf" type="time" class="input" value="${ev?.hora_fim ? ev.hora_fim.substring(0,5) : ''}">
        </div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px">
          <label>Responsável</label>
          <select id="ev-corretor" class="select">
            <option value="">— sem responsável —</option>
            ${selectableUsers(_users, ev?.corretor_id).map(u => `<option value="${escapeHtml(u.id)}"${ev?.corretor_id === u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>Status</label>
          <select id="ev-status" class="select">
            ${Object.entries(STATUS_LBL).map(([k, v]) => `<option value="${k}"${(ev?.status || 'agendado') === k ? ' selected' : ''}>${v.lbl}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label>Local</label>
        <input id="ev-local" class="input" value="${ev?.local ? escapeHtml(ev.local) : ''}" placeholder="Ex: Sala 1 ou link Meet">
      </div>
      <div id="ev-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${canDelete ? `<button class="btn btn-danger" id="ev-del">🗑 Apagar</button>` : '<span></span>'}
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="ev-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ev-save">${isEdit ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  document.getElementById('ev-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('ev-save').addEventListener('click', async () => {
    const titulo = document.getElementById('ev-titulo').value.trim();
    if (!titulo) { document.getElementById('ev-msg').innerHTML = '<div class="alert alert-err">Título obrigatório.</div>'; return; }
    try {
      await api.request('/api/v3/agenda/upsert', { method: 'POST', body: {
        id: ev?.id,
        tipo: document.getElementById('ev-tipo').value,
        titulo,
        descricao: document.getElementById('ev-desc').value.trim() || null,
        data: document.getElementById('ev-data').value,
        hora_inicio: document.getElementById('ev-hi').value || null,
        hora_fim: document.getElementById('ev-hf').value || null,
        corretor_id: document.getElementById('ev-corretor').value || null,
        status: document.getElementById('ev-status').value,
        local: document.getElementById('ev-local').value.trim() || null,
      } });
      modal.style.display = 'none';
      await reload();
    } catch (e) {
      document.getElementById('ev-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
    }
  });
  if (canDelete) {
    document.getElementById('ev-del').addEventListener('click', async () => {
      if (!confirm('Apagar este evento?')) return;
      try {
        await api.request('/api/v3/agenda/delete', { method: 'POST', body: { id: ev.id } });
        modal.style.display = 'none';
        await reload();
      } catch (e) {
        alert('Erro: ' + e.message);
      }
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────
function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
