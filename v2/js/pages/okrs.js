/* PSM-OS v2 — OKRs (Objectives & Key Results) (Sprint 8.6) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];
let _editing = null;

const STATUS_MAP = {
  on_track: { lbl: 'No Caminho', color: '#22c55e' },
  at_risk: { lbl: 'Em Risco', color: '#f59e0b' },
  off_track: { lbl: 'Fora da Meta', color: '#ef4444' },
  completed: { lbl: 'Concluído', color: '#3b82f6' },
};

export async function pageOKRs(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/okrs/list');
    _items = r.okrs || [];
    renderList();
  } catch (e) {
    document.getElementById('okr-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  const isLider = (auth.user()?.lvl || 0) >= 5;
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🎯 OKRs — Objectives & Key Results</h2>
          <p class="card-sub">Alinhamento estratégico: objetivos ambiciosos com resultados-chave mensuráveis</p>
        </div>
        ${isLider ? `<button class="btn btn-primary" id="okr-new">➕ Novo OKR</button>` : ''}
      </div>
      <div id="okr-stats" class="mt-3"></div>
      <div id="okr-body" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  if (isLider) {
    document.getElementById('okr-new').addEventListener('click', () => { _editing = newOkr(); showForm(); });
  }
}

function newOkr() {
  return { objetivo: '', ciclo: 'Q1 2026', status: 'on_track', krs: [{ label: '', curr: 0, target: 100, unit: '', status: 'on_track', pct: 0 }] };
}

function renderList() {
  const stats = document.getElementById('okr-stats');
  const allKrs = _items.flatMap(o => o.krs || []);
  stats.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px">
      ${stat('Objectives', _items.length, '#0b1f3a', '#fff')}
      ${stat('KRs', allKrs.length, '#3b82f6')}
      ${stat('No Caminho', allKrs.filter(k => k.status === 'on_track').length, '#22c55e')}
      ${stat('Em Risco', allKrs.filter(k => k.status === 'at_risk').length, '#f59e0b')}
      ${stat('Fora da Meta', allKrs.filter(k => k.status === 'off_track').length, '#ef4444')}
    </div>
  `;

  const body = document.getElementById('okr-body');
  if (_items.length === 0) {
    body.innerHTML = '<div class="muted tiny" style="text-align:center;padding:40px">Nenhum OKR cadastrado. Crie o primeiro.</div>';
    return;
  }
  const isLider = (auth.user()?.lvl || 0) >= 5;
  body.innerHTML = _items.map(o => okrCard(o, isLider)).join('');
  if (isLider) {
    body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      _editing = JSON.parse(JSON.stringify(_items.find(x => x.id === b.dataset.edit)));
      showForm();
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remover OKR?')) return;
      try {
        await api.request('/api/v3/okrs/list?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        await load();
      } catch (e) { alert('Erro: ' + e.message); }
    }));
  }
}

function okrCard(o, canEdit) {
  const st = STATUS_MAP[o.status] || STATUS_MAP.on_track;
  return `
    <div class="card mb-3" style="border-left:4px solid ${st.color}">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
        <div style="flex:1">
          <div style="font-weight:800;color:var(--psm-gold)">${esc(o.objetivo)}</div>
          <div class="tiny muted">${esc(o.ciclo)}</div>
        </div>
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${st.color}22;color:${st.color}">${st.lbl}</span>
        ${canEdit ? `<div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" data-edit="${o.id}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${o.id}">🗑</button>
        </div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(o.krs || []).map(kr => krBar(kr)).join('')}
      </div>
    </div>
  `;
}

function krBar(kr) {
  const st = STATUS_MAP[kr.status] || STATUS_MAP.on_track;
  const pct = kr.pct || (kr.target > 0 ? Math.round((kr.curr / kr.target) * 100) : 0);
  return `
    <div style="background:var(--bg-3);border-radius:8px;padding:10px">
      <div class="flex" style="justify-content:space-between;margin-bottom:5px">
        <span style="font-size:12px;font-weight:600">${esc(kr.label || '—')}</span>
        <span style="font-size:11px;font-weight:700;color:${st.color}">${pct}%</span>
      </div>
      <div style="background:var(--bg-2);height:6px;border-radius:3px;overflow:hidden">
        <div style="background:${st.color};height:100%;width:${Math.min(100, pct)}%;transition:width .4s"></div>
      </div>
      <div class="flex" style="justify-content:space-between;margin-top:3px;font-size:10px;color:var(--muted)">
        <span>${kr.curr || 0} ${esc(kr.unit || '')}</span>
        <span>meta: ${kr.target || 0} ${esc(kr.unit || '')}</span>
      </div>
    </div>
  `;
}

function showForm() {
  const o = _editing;
  const body = document.getElementById('okr-body');
  body.innerHTML = `
    <div class="card mb-3" style="background:var(--bg-3);padding:16px">
      <div class="flex" style="justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800">${o.id ? '✏️ Editar OKR' : '➕ Novo OKR'}</div>
        <button class="btn btn-ghost btn-sm" id="okr-cancel">✕ Cancelar</button>
      </div>
      <div style="display:grid;gap:10px">
        <div>
          <label class="tiny muted">Objetivo *</label>
          <input id="o-obj" class="input" placeholder="Ex: Dominar o segmento MAP em Rio Preto" value="${esc(o.objetivo)}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label class="tiny muted">Ciclo</label>
            <select id="o-ciclo" class="select">
              ${['Q1 2026','Q2 2026','Q3 2026','Q4 2026','S1 2026','S2 2026','ANO 2026'].map(c => `<option value="${c}" ${o.ciclo === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="tiny muted">Status</label>
            <select id="o-status" class="select">
              ${Object.entries(STATUS_MAP).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v.lbl}</option>`).join('')}
            </select>
          </div>
        </div>

        <div>
          <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:6px">
            <label class="tiny muted" style="font-weight:700">Key Results</label>
            <button class="btn btn-ghost btn-sm" id="o-add-kr">➕ Adicionar KR</button>
          </div>
          <div id="o-krs"></div>
        </div>

        <button class="btn btn-primary mt-2" id="o-save">💾 Salvar OKR</button>
      </div>
    </div>
  `;
  document.getElementById('okr-cancel').addEventListener('click', () => { _editing = null; renderList(); });
  document.getElementById('o-add-kr').addEventListener('click', () => {
    _editing.krs.push({ label: '', curr: 0, target: 100, unit: '', status: 'on_track', pct: 0 });
    renderKRs();
  });
  document.getElementById('o-save').addEventListener('click', save);
  renderKRs();
}

function renderKRs() {
  const wrap = document.getElementById('o-krs');
  wrap.innerHTML = _editing.krs.map((kr, i) => `
    <div style="background:var(--bg-2);border-radius:8px;padding:10px;margin-bottom:6px">
      <div class="flex" style="justify-content:space-between;margin-bottom:6px">
        <div class="tiny muted">KR ${i + 1}</div>
        <button class="btn btn-ghost btn-sm" data-rem-kr="${i}" style="color:#ef4444">🗑</button>
      </div>
      <input class="input" placeholder="Descrição (ex: Atingir 50M de VGV)" data-kr-key="label" data-kr-idx="${i}" value="${esc(kr.label || '')}" style="margin-bottom:6px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px">
        <input class="input" type="number" placeholder="Atual" data-kr-key="curr" data-kr-idx="${i}" value="${kr.curr || 0}">
        <input class="input" type="number" placeholder="Meta" data-kr-key="target" data-kr-idx="${i}" value="${kr.target || 0}">
        <input class="input" placeholder="Unidade (R$, %, un)" data-kr-key="unit" data-kr-idx="${i}" value="${esc(kr.unit || '')}">
        <select class="select" data-kr-key="status" data-kr-idx="${i}">
          ${Object.entries(STATUS_MAP).map(([k, v]) => `<option value="${k}" ${kr.status === k ? 'selected' : ''}>${v.lbl}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-kr-key]').forEach(el => el.addEventListener('input', e => {
    const i = +el.dataset.krIdx, k = el.dataset.krKey;
    let v = e.target.value;
    if (k === 'curr' || k === 'target') v = parseFloat(v) || 0;
    _editing.krs[i][k] = v;
    if (k === 'curr' || k === 'target') {
      _editing.krs[i].pct = _editing.krs[i].target > 0 ? Math.round(_editing.krs[i].curr / _editing.krs[i].target * 100) : 0;
    }
  }));
  wrap.querySelectorAll('[data-rem-kr]').forEach(b => b.addEventListener('click', () => {
    _editing.krs.splice(+b.dataset.remKr, 1);
    renderKRs();
  }));
}

async function save() {
  _editing.objetivo = document.getElementById('o-obj').value.trim();
  _editing.ciclo = document.getElementById('o-ciclo').value;
  _editing.status = document.getElementById('o-status').value;
  if (!_editing.objetivo) { alert('Objetivo obrigatório'); return; }
  try {
    await api.request('/api/v3/okrs/list', { method: 'POST', body: _editing });
    _editing = null;
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

function stat(label, value, bg, color) {
  return `<div style="background:${bg};color:${color || '#fff'};padding:12px;border-radius:8px;text-align:center"><div style="font-size:10px;text-transform:uppercase;opacity:.8">${label}</div><div style="font-size:22px;font-weight:800;margin-top:4px">${value}</div></div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
