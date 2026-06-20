/* PSM-OS v2 — Lançamentos (Sprint 7.21) */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';

const STATUS = [
  { id: 'ativo',      lbl: 'Ativo',      color: '#16a34a' },
  { id: 'suspenso',   lbl: 'Suspenso',   color: '#d97706' },
  { id: 'finalizado', lbl: 'Finalizado', color: '#64748b' },
];
const ETAPAS = [
  { id: 'pre-lancamento', lbl: 'Pré-lançamento', ico: '📋' },
  { id: 'lancamento',     lbl: 'Lançamento',      ico: '🚀' },
  { id: 'em-obras',       lbl: 'Em obras',        ico: '🏗' },
  { id: 'entregue',       lbl: 'Entregue',        ico: '🏢' },
];

// Raias da linha do tempo (marcas/equipes)
const MARCAS = [
  { id: 'map',       lbl: 'MAP',       color: '#2563eb' },
  { id: 'conquista', lbl: 'Conquista', color: '#16a34a' },
];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const normMarca = m => (m || '').toString().trim().toLowerCase();

let _root = null, _items = [], _users = [], _filterStatus = '', _tlYear = 2026;

export async function pageLancamentos(ctx, root) { _root = root; await reload(); }

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const qs = _filterStatus ? '?status=' + _filterStatus : '';
    const [l, u] = await Promise.all([
      api.request('/api/v3/lancamentos/list' + qs),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _items = l.lancamentos || [];
    if (u.users) _users = u.users;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const canEdit = (me?.lvl || 0) >= 7;

  const totVgv = _items.reduce((s, i) => s + Number(i.vgv_total || 0), 0);
  const totUnits = _items.reduce((s, i) => s + Number(i.unidades_total || 0), 0);
  const totSold = _items.reduce((s, i) => s + Number(i.unidades_vendidas || 0), 0);
  const ativos = _items.filter(i => (i.status || 'ativo') === 'ativo').length;

  _root.innerHTML = `
    <style>
      .lc-tl{position:relative;margin-top:6px}
      .lc-month{display:flex;align-items:center;gap:8px;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-muted,#64748b);margin:16px 0 8px}
      .lc-month::before{content:'';width:11px;height:11px;border-radius:50%;background:var(--psm-gold,#d4a843);box-shadow:0 0 0 3px rgba(212,168,67,.2)}
      .lc-row{display:flex;gap:0;align-items:stretch}
      .lc-rail{width:34px;flex:0 0 34px;position:relative;display:flex;justify-content:center}
      .lc-rail::before{content:'';position:absolute;top:0;bottom:0;width:2px;background:var(--border)}
      .lc-dot{position:relative;z-index:1;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;background:var(--bg-1,#fff);border:2px solid var(--c);margin-top:12px}
      .lc-card{flex:1;min-width:0;background:var(--bg-1,#fff);border:1px solid var(--border);border-left:4px solid var(--c);border-radius:12px;padding:12px 15px;margin:6px 0 6px 10px;transition:transform .12s,box-shadow .12s}
      .lc-card.click{cursor:pointer}
      .lc-card.click:hover{transform:translateX(2px);box-shadow:0 4px 14px rgba(15,23,42,.10)}
      .lc-step{display:flex;align-items:center;gap:3px;flex-wrap:wrap;margin:8px 0}
      .lc-step .st{display:flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--bg-3);color:var(--ink-muted,#94a3b8)}
      .lc-step .st.on{background:var(--c);color:#fff}
      .lc-step .sep{color:var(--border);font-size:10px}
      .lc-stat{font-size:12px}.lc-stat b{font-weight:800}
      .tl-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px;margin-top:8px}
      .tl-grid{display:grid;grid-template-columns:120px repeat(12,minmax(94px,1fr));min-width:1180px}
      .tl-h{background:var(--bg-3);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-muted,#64748b);padding:8px 4px;text-align:center;border-bottom:1px solid var(--border)}
      .tl-h.now{color:#2563eb}
      .tl-lane{position:sticky;left:0;z-index:2;background:var(--bg-1,#fff);font-weight:800;font-size:12.5px;padding:10px 12px;border-right:2px solid var(--border);border-bottom:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;gap:2px}
      .tl-cell{border-left:1px solid var(--border);border-bottom:1px solid var(--border);min-height:64px;padding:5px;position:relative}
      .tl-cell.now{background:rgba(37,99,235,.06)}
      .tl-chip{display:block;font-size:10.5px;font-weight:700;padding:3px 7px;border-radius:7px;margin-bottom:4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1.5px solid var(--c)}
      .tl-chip.real{background:var(--c);color:#fff}
      .tl-chip.prev{background:transparent;color:var(--c);border-style:dashed}
      .tl-add{position:absolute;right:4px;bottom:3px;font-size:14px;line-height:1;opacity:0;cursor:pointer;color:var(--ink-muted,#94a3b8);transition:opacity .12s}
      .tl-cell:hover .tl-add{opacity:.7}
      .tl-nav{display:flex;align-items:center;gap:10px;justify-content:center;margin:4px 0 2px}
    </style>
    <div class="card">
      <h2 class="card-title">🏗 Lançamentos</h2>
      <p class="card-sub">${_items.length} cadastrados · ${ativos} ativos · linha do tempo por data de lançamento</p>

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('🚀 Ativos',       ativos, _items.length + ' total', '#16a34a')}
        ${kpi('💰 VGV total',    'R$ ' + money(totVgv), 'soma dos VGV', '#7c3aed')}
        ${kpi('🏢 Unidades',     totUnits, totSold + ' vendidas', '#2563eb')}
        ${kpi('📊 % Vendido',    totUnits > 0 ? Math.round(totSold/totUnits*100) + '%' : '—', 'do total', '#d97706')}
      </div>

      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted" style="font-weight:700">STATUS:</label>
        <select id="f-st" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todos</option>
          ${STATUS.map(s => `<option value="${s.id}"${_filterStatus===s.id?' selected':''}>${s.lbl}</option>`).join('')}
        </select>
        ${canEdit ? '<button class="btn btn-primary" id="btn-novo" style="margin-left:auto">+ Novo</button>' : ''}
      </div>

      <!-- 📅 LINHA DO TEMPO MAP × CONQUISTA -->
      <div class="card mt-3" style="margin-top:14px">
        <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
          <h3 class="card-title" style="margin:0">📅 Linha do tempo · MAP × Conquista</h3>
          <div class="tl-nav">
            <button class="btn btn-ghost btn-sm" data-tl-nav="-1">‹</button>
            <b style="min-width:54px;text-align:center;font-size:15px">${_tlYear}</b>
            <button class="btn btn-ghost btn-sm" data-tl-nav="1">›</button>
          </div>
        </div>
        <p class="tiny muted" style="margin:2px 0 0">Lançamentos por mês, em duas raias. <b style="color:#16a34a">■ Sólido</b> = já ocorreu · <b style="color:#64748b">▢ Tracejado</b> = previsto.${canEdit ? ' Passe o mouse numa célula e clique no <b>＋</b> pra cadastrar.' : ''}</p>
        ${timeline2026(canEdit)}
      </div>

      <!-- LISTA DETALHADA (cronológica) -->
      <h3 class="card-title mt-3" style="margin-top:16px">🗂 Todos os lançamentos</h3>
      <div class="lc-tl mt-3">
        ${_items.length === 0 ? '<div class="muted text-center" style="padding:30px">Nenhum lançamento.</div>' : timelineHTML(canEdit)}
      </div>

      <div id="modal-lc" style="display:none"></div>
    </div>
  `;
  document.getElementById('f-st').addEventListener('change', async e => { _filterStatus = e.target.value; await reload(); });
  const btnNovo = document.getElementById('btn-novo');
  if (btnNovo) btnNovo.addEventListener('click', () => openModal());
  document.querySelectorAll('[data-lc]').forEach(el => el.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) return; openModal(el.dataset.lc); }));
  // navegação de ano da linha do tempo
  document.querySelectorAll('[data-tl-nav]').forEach(b => b.addEventListener('click', () => { _tlYear += parseInt(b.dataset.tlNav, 10) || 0; render(); }));
  // botão ＋ por célula → novo lançamento já com marca + mês
  document.querySelectorAll('[data-tl-add]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const [marca, data] = b.dataset.tlAdd.split('|');
    openModal(null, { marca, data_lancamento: data });
  }));
}

// 📅 Linha do tempo Jan–Dez do ano, com 2 raias (MAP / Conquista)
function timeline2026(canEdit) {
  const today = new Date();
  const isThisYear = today.getFullYear() === _tlYear;
  // header de meses
  const head = `<div class="tl-h" style="border-bottom:1px solid var(--border)"></div>`
    + MESES.map((m, idx) => `<div class="tl-h${isThisYear && idx === today.getMonth() ? ' now' : ''}">${m}</div>`).join('');

  const lanes = MARCAS.map(mc => {
    // lançamentos dessa marca no ano
    const dos = _items.filter(i => normMarca(i.marca) === mc.id && i.data_lancamento
      && new Date(i.data_lancamento).getFullYear() === _tlYear);
    const vgv = dos.reduce((s, i) => s + Number(i.vgv_total || 0), 0);
    const laneCell = `<div class="tl-lane">
        <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:${mc.color}"></span>${mc.lbl}</span>
        <span class="tiny muted" style="font-weight:600">${dos.length} · R$ ${money(vgv)}</span>
      </div>`;
    const cells = MESES.map((_, m) => {
      const inMonth = dos.filter(i => new Date(i.data_lancamento).getMonth() === m);
      const chips = inMonth.map(i => {
        const real = new Date(i.data_lancamento) <= today;
        const t = i.vgv_total > 0 ? ` · ${money(i.vgv_total)}` : '';
        return `<span class="tl-chip ${real ? 'real' : 'prev'}" style="--c:${mc.color}" data-lc="${i.id}" title="${esc(i.nome)}${t}">${esc(i.nome)}</span>`;
      }).join('');
      const addBtn = canEdit ? `<span class="tl-add" data-tl-add="${mc.id}|${_tlYear}-${String(m + 1).padStart(2, '0')}-01" title="Novo lançamento ${mc.lbl} em ${MESES[m]}/${_tlYear}">＋</span>` : '';
      return `<div class="tl-cell${isThisYear && m === today.getMonth() ? ' now' : ''}">${chips}${addBtn}</div>`;
    }).join('');
    return laneCell + cells;
  }).join('');

  const semMarca = _items.filter(i => !MARCAS.some(mc => mc.id === normMarca(i.marca))).length;
  return `<div class="tl-wrap"><div class="tl-grid">${head}${lanes}</div></div>
    ${semMarca ? `<p class="tiny muted" style="margin:6px 0 0">⚠️ ${semMarca} lançamento(s) sem marca definida (não aparecem nas raias) — edite e escolha MAP ou Conquista.</p>` : ''}`;
}

// Ordena por data (lançamentos com data primeiro, cronológico) e agrupa por mês/ano
function timelineHTML(canEdit) {
  const withDate = _items.filter(i => i.data_lancamento).slice()
    .sort((a, b) => new Date(a.data_lancamento) - new Date(b.data_lancamento));
  const noDate = _items.filter(i => !i.data_lancamento);
  const groups = [];
  let curKey = null, curArr = null;
  for (const i of withDate) {
    const d = new Date(i.data_lancamento);
    const key = d.getFullYear() + '-' + d.getMonth();
    if (key !== curKey) { curKey = key; curArr = { label: monthLabel(d), items: [] }; groups.push(curArr); }
    curArr.items.push(i);
  }
  if (noDate.length) groups.push({ label: 'Sem data definida', items: noDate });
  return groups.map(g => `
    <div class="lc-month">${esc(g.label)}</div>
    ${g.items.map(i => launchRow(i, canEdit)).join('')}
  `).join('');
}

function launchRow(i, canEdit) {
  const status = STATUS.find(s => s.id === i.status) || STATUS[0];
  const etapa = ETAPAS.find(e => e.id === i.etapa) || ETAPAS[1];
  const etapaIdx = ETAPAS.findIndex(e => e.id === (i.etapa || 'lancamento'));
  const resp = _users.find(u => u.id === i.responsavel_id);
  const pct = i.unidades_total > 0 ? Math.round(i.unidades_vendidas / i.unidades_total * 100) : 0;
  const data = i.data_lancamento ? new Date(i.data_lancamento).toLocaleDateString('pt-BR') : '—';
  const stepper = ETAPAS.map((e, idx) =>
    `<span class="st${idx <= etapaIdx ? ' on' : ''}" style="--c:${status.color}">${e.ico} ${e.lbl}</span>`
  ).join('<span class="sep">›</span>');
  return `
    <div class="lc-row">
      <div class="lc-rail"><div class="lc-dot" style="--c:${status.color}">${etapa.ico}</div></div>
      <div class="lc-card${canEdit ? ' click' : ''}" style="--c:${status.color}" ${canEdit ? `data-lc="${i.id}"` : ''}>
        <div class="flex items-center gap-2" style="flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:14.5px">${esc(i.nome)}${marcaBadge(i.marca)}</div>
            <div class="tiny muted">${esc(i.construtora || 'sem construtora')} · 📅 ${esc(data)}</div>
          </div>
          <span class="tiny" style="background:${status.color};color:#fff;padding:3px 11px;border-radius:999px;font-weight:700">${status.lbl}</span>
        </div>
        <div class="lc-step">${stepper}</div>
        <div class="flex gap-3" style="flex-wrap:wrap">
          <div class="lc-stat">💰 <b>R$ ${money(i.vgv_total)}</b> <span class="muted">VGV</span></div>
          <div class="lc-stat">🤝 <b>${i.comissao_pct || 0}%</b> <span class="muted">comissão</span></div>
          <div class="lc-stat">🏢 <b>${i.unidades_vendidas || 0}/${i.unidades_total || 0}</b> <span class="muted">(${pct}%)</span></div>
          ${resp ? `<div class="lc-stat">👤 ${esc(resp.name)}</div>` : ''}
          ${i.link_pasta ? `<a class="lc-stat" href="${esc(i.link_pasta)}" target="_blank" rel="noopener" data-stop="1" style="text-decoration:none">📁 pasta</a>` : ''}
        </div>
        ${i.unidades_total > 0 ? `<div style="background:var(--bg-3);height:5px;border-radius:3px;overflow:hidden;margin-top:7px"><div style="background:${status.color};height:100%;width:${pct}%;transition:width .4s"></div></div>` : ''}
      </div>
    </div>
  `;
}

function monthLabel(d) {
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const esc = (s) => escapeHtml(s);
function marcaBadge(m) {
  const mc = MARCAS.find(x => x.id === normMarca(m));
  return mc ? ` <span class="tiny" style="background:${mc.color}1f;color:${mc.color};padding:1px 7px;border-radius:999px;font-weight:800;vertical-align:middle">${mc.lbl}</span>` : '';
}

function openModal(lid, prefill) {
  const i = lid ? _items.find(x => x.id === lid) : null;
  const pf = prefill || {};
  const curMarca = (i?.marca || pf.marca || '').toString().toLowerCase();
  const modal = document.getElementById('modal-lc');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:560px;width:100%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">${i ? '✏️ Editar' : '➕ Novo'} lançamento</h3>
      <div class="field"><label>Nome *</label><input id="lc-nome" class="input" value="${i ? escapeHtml(i.nome) : ''}"></div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Construtora</label><input id="lc-constr" class="input" value="${i ? escapeHtml(i.construtora||'') : ''}"></div>
        <div class="field" style="flex:1;min-width:120px"><label>Marca / Equipe</label><select id="lc-marca" class="select"><option value="">— —</option>${MARCAS.map(mc => `<option value="${mc.id}"${curMarca===mc.id?' selected':''}>${mc.lbl}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:140px"><label>Data lançamento</label><input id="lc-data" type="date" class="input" value="${i?.data_lancamento || pf.data_lancamento || ''}"></div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Etapa</label><select id="lc-etapa" class="select">${ETAPAS.map(e => `<option value="${e.id}"${i?.etapa===e.id?' selected':''}>${e.ico} ${e.lbl}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:120px"><label>Status</label><select id="lc-status" class="select">${STATUS.map(s => `<option value="${s.id}"${(i?.status||'ativo')===s.id?' selected':''}>${s.lbl}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:100px"><label>Comissão %</label><input id="lc-com" type="number" step="0.1" class="input" value="${i?.comissao_pct || 0}"></div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>VGV total (R$)</label><input id="lc-vgv" type="number" step="0.01" class="input" value="${i?.vgv_total || 0}"></div>
        <div class="field" style="flex:1;min-width:100px"><label>Unid. total</label><input id="lc-ut" type="number" class="input" value="${i?.unidades_total || 0}"></div>
        <div class="field" style="flex:1;min-width:100px"><label>Vendidas</label><input id="lc-uv" type="number" class="input" value="${i?.unidades_vendidas || 0}"></div>
      </div>
      <div class="field"><label>Responsável</label><select id="lc-resp" class="select"><option value="">— —</option>${selectableUsers(_users, i?.responsavel_id).map(u => `<option value="${escapeHtml(u.id)}"${i?.responsavel_id===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Descrição</label><textarea id="lc-desc" class="input" rows="2">${i?.descricao ? escapeHtml(i.descricao) : ''}</textarea></div>
      <div class="field"><label>Link da pasta (Drive)</label><input id="lc-link" class="input" value="${i ? escapeHtml(i.link_pasta||'') : ''}"></div>
      <div id="lc-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${i ? '<button class="btn btn-danger" id="lc-del">🗑 Apagar</button>' : '<span></span>'}
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="lc-cancel">Cancelar</button>
          <button class="btn btn-primary" id="lc-save">${i ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('lc-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('lc-save').addEventListener('click', async () => {
    const body = {
      id: i?.id,
      nome: document.getElementById('lc-nome').value.trim(),
      construtora: document.getElementById('lc-constr').value.trim() || null,
      marca: document.getElementById('lc-marca').value || null,
      data_lancamento: document.getElementById('lc-data').value || null,
      etapa: document.getElementById('lc-etapa').value,
      status: document.getElementById('lc-status').value,
      comissao_pct: parseFloat(document.getElementById('lc-com').value) || 0,
      vgv_total: parseFloat(document.getElementById('lc-vgv').value) || 0,
      unidades_total: parseInt(document.getElementById('lc-ut').value) || 0,
      unidades_vendidas: parseInt(document.getElementById('lc-uv').value) || 0,
      responsavel_id: document.getElementById('lc-resp').value || null,
      descricao: document.getElementById('lc-desc').value.trim() || null,
      link_pasta: document.getElementById('lc-link').value.trim() || null,
    };
    if (!body.nome) { document.getElementById('lc-msg').innerHTML = '<div class="alert alert-err">Nome obrigatório.</div>'; return; }
    try {
      await api.request('/api/v3/lancamentos/upsert', { method: 'POST', body });
      modal.style.display = 'none';
      await reload();
    } catch (e) { document.getElementById('lc-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; }
  });
  if (i) {
    document.getElementById('lc-del').addEventListener('click', async () => {
      if (!confirm('Apagar este lançamento?')) return;
      try {
        await api.request('/api/v3/lancamentos/upsert', { method: 'POST', body: { id: i.id, _delete: true } });
        modal.style.display = 'none';
        await reload();
      } catch (e) { alert('Erro: ' + e.message); }
    });
  }
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:20px;font-weight:900;color:${color};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}
function money(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
