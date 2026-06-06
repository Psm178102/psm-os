/* ============================================================================
   PSM-OS v2 — Dados de Mercado (Inteligência)
   ----------------------------------------------------------------------------
   Painel editável de inteligência de mercado: panorama (indicadores livres) +
   tabela de concorrentes/players (equipes, corretores, nichos, salário,
   comissão, verba de mkt, vendas/mês, vendas/ano) + notas. Persistido como
   documento JSON no board 'dados_mercado' (/api/v3/diretoria/strategy). lvl>=7.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = { panorama: [], concorrentes: [], notas: '' }, _pending = false;
const canEdit = () => (auth.user()?.lvl || 0) >= 7;

const COLS = [
  { k: 'nome', lbl: 'Concorrente', tipo: 'text', w: 150 },
  { k: 'equipes', lbl: 'Equipes', tipo: 'int', w: 70 },
  { k: 'corretores', lbl: 'Corretores', tipo: 'int', w: 80 },
  { k: 'nichos', lbl: 'Nichos', tipo: 'text', w: 160 },
  { k: 'salario', lbl: 'Salário médio', tipo: 'money', w: 110 },
  { k: 'comissao', lbl: 'Comissão', tipo: 'text', w: 90 },
  { k: 'verba_mkt', lbl: 'Verba Mkt (mês)', tipo: 'money', w: 120 },
  { k: 'vendas_mes', lbl: 'Vendas/mês', tipo: 'int', w: 90 },
  { k: 'vendas_ano', lbl: 'Vendas/ano', tipo: 'int', w: 90 },
  { k: 'obs', lbl: 'Observações', tipo: 'text', w: 200 },
];

export async function pageDadosMercado(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Gerência/Diretoria.</div>';
    return;
  }
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando dados de mercado…</div></div>`;
  try {
    const r = await api.request('/api/v3/diretoria/strategy?board=dados_mercado');
    const data = r.data || {};
    _d = {
      panorama: Array.isArray(data.panorama) ? data.panorama : [],
      concorrentes: Array.isArray(data.concorrentes) ? data.concorrentes : [],
      notas: typeof data.notas === 'string' ? data.notas : '',
    };
    _pending = !!r.pending;
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
    return;
  }
  render();
}

async function persist() {
  try {
    const r = await api.request('/api/v3/diretoria/strategy', { method: 'POST', body: { board: 'dados_mercado', data: _d } });
    if (r && r.ok === false && r.pending) { _pending = true; return false; }
    return true;
  } catch (e) { alert('Erro ao salvar: ' + e.message); return false; }
}

function render() {
  const edit = canEdit();
  _root.innerHTML = `
    <style>
      .dm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
      .dm-kpi{background:var(--bg-1,#fff);border:1px solid var(--border);border-top:3px solid #2563eb;border-radius:12px;padding:12px 14px;position:relative}
      .dm-kpi .v{font-size:22px;font-weight:900;color:#2563eb}
      .dm-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
      .dm-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-muted,#64748b);padding:8px 10px;border-bottom:2px solid var(--border);white-space:nowrap}
      .dm-tbl td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top}
      .dm-tbl tr:hover td{background:var(--bg-3)}
      .dm-act{cursor:pointer;opacity:.6;padding:2px 5px}.dm-act:hover{opacity:1}
    </style>
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">📈 Dados de Mercado</h2>
          <p class="card-sub">Inteligência de mercado e concorrência — indicadores, players, salários, comissões, equipes, nichos e verba. Base pra decisão estratégica.</p>
        </div>
      </div>
      ${_pending ? `<div class="alert alert-warn" style="margin-top:8px">⏳ Rode <code>supabase/sprint9_24_estrategia.sql</code> pra salvar (tabela estrategia_boards).</div>` : ''}

      <!-- PANORAMA -->
      <div class="flex items-center gap-2" style="margin-top:16px">
        <h3 class="card-title" style="flex:1;font-size:15px">📊 Panorama do mercado</h3>
        ${edit ? `<button class="btn btn-ghost btn-sm" id="dm-add-kpi">➕ Indicador</button>` : ''}
      </div>
      ${_d.panorama.length ? `<div class="dm-grid" style="margin-top:8px">${_d.panorama.map(kpiCard).join('')}</div>`
        : `<div class="tiny muted" style="margin-top:8px">Nenhum indicador. ${edit ? 'Adicione números do mercado: verba de marketing estimada, vendas/mês do setor, ticket médio, etc.' : ''}</div>`}

      <!-- CONCORRENTES -->
      <div class="flex items-center gap-2" style="margin-top:20px">
        <h3 class="card-title" style="flex:1;font-size:15px">🏢 Concorrentes & players <span class="tiny muted">· ${_d.concorrentes.length}</span></h3>
        ${edit ? `<button class="btn btn-primary btn-sm" id="dm-add-conc">➕ Concorrente</button>` : ''}
      </div>
      ${_d.concorrentes.length ? `
        <div style="overflow-x:auto;margin-top:8px">
          <table class="dm-tbl">
            <thead><tr>${COLS.map(c => `<th>${c.lbl}</th>`).join('')}${edit ? '<th></th>' : ''}</tr></thead>
            <tbody>${_d.concorrentes.map(concRow).join('')}</tbody>
          </table>
        </div>`
        : `<div class="tiny muted" style="margin-top:8px">Nenhum concorrente cadastrado. ${edit ? 'Use "➕ Concorrente" pra mapear cada player com equipes, corretores, nichos, salários, comissões e vendas.' : ''}</div>`}

      <!-- NOTAS -->
      <div class="flex items-center gap-2" style="margin-top:20px">
        <h3 class="card-title" style="flex:1;font-size:15px">📝 Notas de mercado</h3>
      </div>
      ${edit
        ? `<textarea id="dm-notas" class="input" rows="5" style="width:100%;margin-top:8px" placeholder="Tendências, movimentos de concorrentes, oportunidades, ameaças, leituras…">${esc(_d.notas)}</textarea>
           <div class="flex" style="justify-content:flex-end;margin-top:6px"><button class="btn btn-ghost btn-sm" id="dm-save-notas">💾 Salvar notas</button></div>`
        : (_d.notas ? `<div style="white-space:pre-wrap;line-height:1.55;font-size:13px;background:var(--bg-3);border-radius:10px;padding:12px 14px;margin-top:8px">${esc(_d.notas)}</div>` : '<div class="tiny muted" style="margin-top:8px">Sem notas.</div>')}
    </div>
    <div id="dm-modal"></div>
  `;
  if (edit) {
    document.getElementById('dm-add-kpi').addEventListener('click', () => openKpiForm(null));
    document.getElementById('dm-add-conc').addEventListener('click', () => openConcForm(null));
    const sn = document.getElementById('dm-save-notas');
    if (sn) sn.addEventListener('click', async () => { _d.notas = document.getElementById('dm-notas').value; sn.disabled = true; sn.textContent = 'Salvando…'; await persist(); sn.disabled = false; sn.textContent = '✓ Salvo'; setTimeout(() => sn.textContent = '💾 Salvar notas', 1200); });
    _root.querySelectorAll('[data-kpi-edit]').forEach(b => b.addEventListener('click', () => openKpiForm(_d.panorama.find(x => x.id === b.dataset.kpiEdit))));
    _root.querySelectorAll('[data-kpi-del]').forEach(b => b.addEventListener('click', () => delItem('panorama', b.dataset.kpiDel)));
    _root.querySelectorAll('[data-conc-edit]').forEach(b => b.addEventListener('click', () => openConcForm(_d.concorrentes.find(x => x.id === b.dataset.concEdit))));
    _root.querySelectorAll('[data-conc-del]').forEach(b => b.addEventListener('click', () => delItem('concorrentes', b.dataset.concDel)));
  }
}

function kpiCard(k) {
  const e = canEdit();
  return `<div class="dm-kpi">
    ${e ? `<div style="position:absolute;top:8px;right:8px"><span class="dm-act" data-kpi-edit="${esc(k.id)}">✏️</span><span class="dm-act" data-kpi-del="${esc(k.id)}">🗑</span></div>` : ''}
    <div class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.5px;max-width:85%">${esc(k.label)}</div>
    <div class="v">${esc(k.valor || '—')}</div>
    ${k.unidade ? `<div class="tiny muted">${esc(k.unidade)}</div>` : ''}
  </div>`;
}

function concRow(c) {
  const e = canEdit();
  const cell = (col) => {
    let v = c[col.k];
    if (v == null || v === '') return '<span class="muted">—</span>';
    if (col.tipo === 'money') return 'R$ ' + money(v);
    if (col.tipo === 'int') return Number(v).toLocaleString('pt-BR');
    return esc(String(v));
  };
  return `<tr>
    ${COLS.map((col, idx) => `<td${idx === 0 ? ' style="font-weight:700"' : ''}>${cell(col)}</td>`).join('')}
    ${e ? `<td style="white-space:nowrap"><span class="dm-act" data-conc-edit="${esc(c.id)}">✏️</span><span class="dm-act" data-conc-del="${esc(c.id)}">🗑</span></td>` : ''}
  </tr>`;
}

/* ─── Forms ─── */
function openKpiForm(k) {
  k = k || {};
  modal(`${k.id ? '✏️ Editar' : '➕ Novo'} indicador`, `
    <div style="display:grid;gap:10px">
      ${inp('km-label', 'Indicador', k.label, 'Ex.: Verba de marketing estimada (mercado)')}
      <div class="flex gap-2">
        <div style="flex:2">${inp('km-valor', 'Valor', k.valor, 'Ex.: R$ 1,2M / 320 / 8%')}</div>
        <div style="flex:1">${inp('km-unidade', 'Unidade', k.unidade, '/mês, vendas…')}</div>
      </div>
    </div>`, async () => {
    const label = val('km-label'); if (!label) return 'Informe o indicador.';
    upsert('panorama', { id: k.id, label, valor: val('km-valor'), unidade: val('km-unidade') });
    return true;
  });
}

function openConcForm(c) {
  c = c || {};
  const f = (k, lbl, ph, type) => inp('cm-' + k, lbl, c[k], ph, type);
  modal(`${c.id ? '✏️ Editar' : '➕ Novo'} concorrente`, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="grid-column:1/-1">${f('nome', 'Concorrente', 'Nome do player', '')}</div>
      ${f('equipes', 'Nº de equipes', '', 'number')}
      ${f('corretores', 'Nº de corretores', '', 'number')}
      <div style="grid-column:1/-1">${f('nichos', 'Nichos', 'Ex.: alto padrão, MCMV, locação', '')}</div>
      ${f('salario', 'Salário médio (R$)', '', 'number')}
      ${f('comissao', 'Comissão', 'Ex.: 5% ou 50/50', '')}
      ${f('verba_mkt', 'Verba Mkt/mês (R$)', '', 'number')}
      ${f('vendas_mes', 'Vendas/mês', '', 'number')}
      ${f('vendas_ano', 'Vendas/ano', '', 'number')}
      <div style="grid-column:1/-1"><label class="tiny muted" style="font-weight:700">Observações</label><textarea id="cm-obs" class="input" rows="2" style="width:100%">${esc(c.obs || '')}</textarea></div>
    </div>`, async () => {
    const nome = val('cm-nome'); if (!nome) return 'Informe o nome do concorrente.';
    upsert('concorrentes', {
      id: c.id, nome,
      equipes: numOrNull('cm-equipes'), corretores: numOrNull('cm-corretores'),
      nichos: val('cm-nichos'), salario: numOrNull('cm-salario'), comissao: val('cm-comissao'),
      verba_mkt: numOrNull('cm-verba_mkt'), vendas_mes: numOrNull('cm-vendas_mes'), vendas_ano: numOrNull('cm-vendas_ano'),
      obs: val('cm-obs'),
    });
    return true;
  });
}

async function upsert(arrKey, obj) {
  if (!obj.id) obj.id = arrKey[0] + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const arr = _d[arrKey];
  const idx = arr.findIndex(x => x.id === obj.id);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...obj }; else arr.push(obj);
  await persist();
  render();
}

async function delItem(arrKey, id) {
  const it = _d[arrKey].find(x => x.id === id);
  if (!confirm(`Excluir "${esc(it && (it.label || it.nome) || 'este item')}"?`)) return;
  _d[arrKey] = _d[arrKey].filter(x => x.id !== id);
  await persist();
  render();
}

/* ─── modal helper ─── */
function modal(titulo, inner, onSave) {
  const m = document.getElementById('dm-modal');
  m.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:560px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${titulo}</h3>
          <button class="btn btn-ghost btn-sm" id="dm-x">✕</button>
        </div>
        <div style="margin-top:12px">${inner}</div>
        <div id="dm-err" class="tiny" style="color:#dc2626;margin-top:8px"></div>
        <div class="flex gap-2 mt-3" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="dm-cancel">Cancelar</button>
          <button class="btn btn-primary" id="dm-ok">Salvar</button>
        </div>
      </div>
    </div>`;
  const close = () => { m.innerHTML = ''; };
  document.getElementById('dm-x').addEventListener('click', close);
  document.getElementById('dm-cancel').addEventListener('click', close);
  m.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
  document.getElementById('dm-ok').addEventListener('click', async () => {
    const btn = document.getElementById('dm-ok'); btn.disabled = true; btn.textContent = 'Salvando…';
    const res = await onSave();
    if (res === true) close();
    else { document.getElementById('dm-err').textContent = res || 'Erro.'; btn.disabled = false; btn.textContent = 'Salvar'; }
  });
}

/* ─── helpers ─── */
function inp(id, label, v, ph = '', type = '') {
  return `<div><label class="tiny muted" style="font-weight:700">${label}</label>
    <input id="${id}" class="input" ${type ? `type="${type}"` : ''} value="${esc(v ?? '')}" placeholder="${esc(ph)}" style="width:100%" /></div>`;
}
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function numOrNull(id) { const v = val(id); return v === '' ? null : (Number(v) || 0); }
function money(n) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
