/* PSM-OS v2 — Plantões (Sprint 7.24) */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';

const PERIODOS = [
  { id: 'manha',    lbl: 'Manhã',     ico: '🌅' },
  { id: 'tarde',    lbl: 'Tarde',     ico: '🌇' },
  { id: 'dia_todo', lbl: 'Dia todo',  ico: '☀️' },
];

const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MES_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let _root = null, _items = [], _users = [], _mes = new Date();

export async function pagePlantoes(ctx, root) { _root = root; await reload(); }

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const start = new Date(_mes.getFullYear(), _mes.getMonth(), 1);
    const end = new Date(_mes.getFullYear(), _mes.getMonth() + 1, 0);
    const qs = `?since=${isoDate(start)}&until=${isoDate(end)}`;
    const [p, u] = await Promise.all([
      api.request('/api/v3/plantoes/list' + qs),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _items = p.plantoes || [];
    if (u.users) _users = u.users;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const canEdit = (me?.lvl || 0) >= 5;
  const ano = _mes.getFullYear(), mesIdx = _mes.getMonth();
  const primeiroDia = new Date(ano, mesIdx, 1);
  const ultimoDia = new Date(ano, mesIdx + 1, 0);
  const totalDias = ultimoDia.getDate();
  const startWeekday = primeiroDia.getDay();

  // Agrupa por dia
  const byDay = {};
  _items.forEach(p => {
    const day = parseInt(p.data.split('-')[2], 10);
    (byDay[day] = byDay[day] || []).push(p);
  });

  // Conta por corretor
  const byCorr = {};
  _items.forEach(p => {
    if (!p.corretor_id) return;
    byCorr[p.corretor_id] = (byCorr[p.corretor_id] || 0) + 1;
  });
  const topCorr = Object.entries(byCorr).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push('<div></div>');
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === ano && today.getMonth() === mesIdx;
  for (let d = 1; d <= totalDias; d++) {
    const isToday = isCurrentMonth && today.getDate() === d;
    const day = byDay[d] || [];
    const dow = new Date(ano, mesIdx, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    cells.push(`
      <div ${canEdit ? `data-day="${d}"` : ''} style="border:1px solid var(--border);border-radius:var(--r-sm);padding:6px;min-height:88px;background:${isToday ? '#dbeafe' : isWeekend ? '#fef3c7' : 'var(--bg-2)'};display:flex;flex-direction:column;gap:3px;${canEdit ? 'cursor:pointer' : ''}">
        <div style="font-weight:${isToday ? 800 : 600};font-size:12px;color:${isToday ? '#1e40af' : 'var(--ink)'}">${d}</div>
        ${day.map(p => {
          const u = _users.find(x => x.id === p.corretor_id);
          const per = PERIODOS.find(x => x.id === p.periodo) || PERIODOS[2];
          return `<div style="background:${u?.color || '#64748b'};color:#fff;font-size:10px;padding:2px 4px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(u?.name || '?')} - ${per.lbl}">${per.ico} ${escapeHtml((u?.name || '?').split(' ')[0])}</div>`;
        }).join('')}
      </div>
    `);
  }

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🛡 Plantões</h2>
      <p class="card-sub">Escala de plantão (fim de semana destacado). ${_items.length} no mês.</p>

      <div class="flex gap-2 mt-2" style="align-items:center">
        <button class="btn btn-ghost" id="prev-mes">‹</button>
        <button class="btn btn-ghost" id="hoje-mes">Hoje</button>
        <button class="btn btn-ghost" id="next-mes">›</button>
        <span style="font-weight:800;font-size:16px;margin-left:8px">${MES_NAMES[mesIdx]} ${ano}</span>
        ${canEdit ? '<button class="btn btn-primary" id="btn-novo" style="margin-left:auto">+ Plantão</button>' : ''}
      </div>

      <div class="mt-3">
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px">
          ${DIAS_SEMANA.map(d => `<div style="text-align:center;font-weight:700;font-size:11px;color:var(--ink-muted);padding:6px">${d}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cells.join('')}</div>
      </div>

      ${topCorr.length > 0 ? `
        <div class="card mt-4" style="margin-top:14px">
          <h3 class="card-title">🏆 Top corretores em plantão (mês)</h3>
          <div style="display:grid;gap:4px">
            ${topCorr.map(([cid, count]) => {
              const u = _users.find(x => x.id === cid);
              return `<div style="display:flex;justify-content:space-between;padding:6px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px">
                <span>${escapeHtml(u?.name || cid)}</span>
                <b>${count} plantão${count !== 1 ? 'ões' : ''}</b>
              </div>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div id="modal-pl" style="display:none"></div>
    </div>
  `;
  document.getElementById('prev-mes').addEventListener('click', async () => { _mes = new Date(ano, mesIdx - 1, 1); await reload(); });
  document.getElementById('next-mes').addEventListener('click', async () => { _mes = new Date(ano, mesIdx + 1, 1); await reload(); });
  document.getElementById('hoje-mes').addEventListener('click', async () => { _mes = new Date(); await reload(); });
  const btnNovo = document.getElementById('btn-novo');
  if (btnNovo) btnNovo.addEventListener('click', () => openModal());
  document.querySelectorAll('[data-day]').forEach(el => el.addEventListener('click', () => {
    const day = parseInt(el.dataset.day);
    const dateIso = `${ano}-${String(mesIdx+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    openModal(null, dateIso);
  }));
}

function openModal(pid, preDate) {
  const p = pid ? _items.find(x => x.id === pid) : null;
  const modal = document.getElementById('modal-pl');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:5vh 20px 20px;overflow:auto';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:480px;width:100%">
      <h3 class="card-title">${p ? '✏️ Editar' : '➕ Novo'} plantão</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Data *</label><input id="pl-data" type="date" class="input" value="${p?.data || preDate || ''}"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Período</label><select id="pl-per" class="select">${PERIODOS.map(per => `<option value="${per.id}"${(p?.periodo||'dia_todo')===per.id?' selected':''}>${per.ico} ${per.lbl}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Corretor *</label><select id="pl-corr" class="select"><option value="">— —</option>${selectableUsers(_users, p?.corretor_id).map(u => `<option value="${escapeHtml(u.id)}"${p?.corretor_id===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Observações</label><textarea id="pl-obs" class="input" rows="2">${p?escapeHtml(p.observacoes||''):''}</textarea></div>
      <div id="pl-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${p ? '<button class="btn btn-danger" id="pl-del">🗑</button>' : '<span></span>'}
        <div class="flex gap-2"><button class="btn btn-ghost" id="pl-cancel">Cancelar</button><button class="btn btn-primary" id="pl-save">${p ? 'Salvar' : 'Criar'}</button></div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('pl-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('pl-save').addEventListener('click', async () => {
    const body = { id: p?.id, data: document.getElementById('pl-data').value, periodo: document.getElementById('pl-per').value, corretor_id: document.getElementById('pl-corr').value, observacoes: document.getElementById('pl-obs').value.trim() || null };
    if (!body.data || !body.corretor_id) { document.getElementById('pl-msg').innerHTML = '<div class="alert alert-err">Data e corretor obrigatórios.</div>'; return; }
    try { await api.request('/api/v3/plantoes/upsert', { method: 'POST', body }); modal.style.display = 'none'; await reload(); }
    catch (e) { document.getElementById('pl-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; }
  });
  if (p) document.getElementById('pl-del').addEventListener('click', async () => {
    if (!confirm('Apagar?')) return;
    try { await api.request('/api/v3/plantoes/upsert', { method: 'POST', body: { id: p.id, _delete: true } }); modal.style.display = 'none'; await reload(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
