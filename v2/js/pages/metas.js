/* ============================================================================
   PSM-OS v2 — Metas · Planejador completo
   Ano / Trimestre / Semestre / Mensal  ×  Equipe + Individual + Total geral
   5 métricas: VGV · Vendas · Agendamentos · Visitas · Pastas
   Edição inline (mês a mês), interativo. Atingido (VGV) cruzado com Deals RD.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const METRICS = [
  { id: 'vgv',          key: 'meta_vgv',          lbl: 'VGV',          ico: '💰', money: true,  color: '#2563eb' },
  { id: 'vendas',       key: 'meta_vendas',       lbl: 'Vendas',       ico: '🏆', money: false, color: '#16a34a' },
  { id: 'agendamentos', key: 'meta_agendamentos', lbl: 'Agendamentos', ico: '📅', money: false, color: '#7c3aed' },
  { id: 'visitas',      key: 'meta_visitas',      lbl: 'Visitas',      ico: '🚪', money: false, color: '#0891b2' },
  { id: 'pastas',       key: 'meta_pastas',       lbl: 'Pastas',       ico: '📁', money: false, color: '#d97706' },
];
const ALL_KEYS = ['meta_vgv', 'meta_vendas', 'meta_agendamentos', 'meta_visitas', 'meta_pastas', 'meta_propostas'];

const PERIODS = {
  mensal: { lbl: '📅 Mensal',     buckets: MES.map((m, i) => ({ lbl: m, months: [i] })) },
  tri:    { lbl: '🗓 Trimestral', buckets: [{ lbl: 'T1', sub: 'Jan–Mar', months: [0, 1, 2] }, { lbl: 'T2', sub: 'Abr–Jun', months: [3, 4, 5] }, { lbl: 'T3', sub: 'Jul–Set', months: [6, 7, 8] }, { lbl: 'T4', sub: 'Out–Dez', months: [9, 10, 11] }] },
  sem:    { lbl: '📆 Semestral',  buckets: [{ lbl: '1º Semestre', sub: 'Jan–Jun', months: [0, 1, 2, 3, 4, 5] }, { lbl: '2º Semestre', sub: 'Jul–Dez', months: [6, 7, 8, 9, 10, 11] }] },
  ano:    { lbl: '🎯 Anual',      buckets: [{ lbl: 'Ano inteiro', months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }] },
};

let _root = null, _data = null;
let _ano = new Date().getFullYear();
let _metric = 'vgv', _period = 'mensal';
let _collapsed = {};   // team -> true (recolhido)

export async function pageMetas(ctx, root) { _root = root; await reload(); }

async function reload() {
  if (_root) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando metas…</div></div>';
  try { _data = await api.request('/api/v3/metas/atingimento?ano=' + _ano + '&nocache=1'); render(); }
  catch (e) { _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; }
}

const mc = () => METRICS.find(m => m.id === _metric);

/* soma a métrica selecionada nos meses do bucket, pra uma lista de linhas (grid items) */
function bucketSum(rows, months) {
  const k = mc().key;
  return rows.reduce((s, g) => s + months.reduce((a, mi) => a + (Number(g.cells[mi] && g.cells[mi][k]) || 0), 0), 0);
}
function yearSum(rows) { return bucketSum(rows, [0,1,2,3,4,5,6,7,8,9,10,11]); }

function render() {
  const me = auth.user();
  const canEdit = (me?.lvl || 0) >= 7;
  const d = _data || {};
  const grid = d.grid || [];
  const m = mc();
  const per = PERIODS[_period];
  const editable = canEdit && _period === 'mensal';

  // agrupa por equipe
  const teams = {};
  grid.forEach(g => { const t = (g.user && g.user.team) ? g.user.team : 'Sem equipe'; (teams[t] = teams[t] || []).push(g); });
  const teamNames = Object.keys(teams).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  teamNames.forEach(t => teams[t].sort((a, b) => (a.user.name || '').localeCompare(b.user.name || '', 'pt-BR')));

  const totalAno = yearSum(grid);
  const atingidoVgv = (d.totals && d.totals.atingido_vgv) || 0;
  const pctVgv = (m.id === 'vgv' && totalAno > 0) ? (atingidoVgv / totalAno * 100) : null;

  const colCount = per.buckets.length;

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">🎯 Planejador de Metas · ${_ano}</h2>
          <p class="card-sub">${grid.length} corretores · ${teamNames.length} equipe(s) · scope <b>${esc(d.scope || '—')}</b>${editable ? ' · <span style="color:#16a34a;font-weight:700">edição inline ativa (clique e digite)</span>' : (canEdit ? ' · <span class="muted">edite na visão Mensal</span>' : '')}</p>
        </div>
        <select id="mt-ano" class="select" style="padding:6px 10px;font-size:13px">
          ${[2024, 2025, 2026, 2027].map(a => `<option value="${a}"${a === _ano ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="mt-reload" title="Atualizar">🔄</button>
        ${canEdit ? '<button class="btn btn-ghost" id="mt-equipe" title="Aplicar meta a uma equipe inteira">👥 Meta p/ equipe</button>' : ''}
      </div>

      <!-- KPIs -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi(`${m.ico} Meta ${m.lbl} · ${_ano}`, fmtVal(totalAno, m.money), `total · ${grid.length} corretores`, m.color)}
        ${m.id === 'vgv' ? kpi('↑ Atingido VGV', 'R$ ' + money(atingidoVgv), `${(d.totals && d.totals.vendas_count) || 0} vendas (RD)`, atingidoVgv >= totalAno ? '#16a34a' : '#d97706') : ''}
        ${pctVgv != null ? kpi('% Atingimento', pctVgv.toFixed(1) + '%', 'atingido ÷ meta', pctColor(pctVgv)) : ''}
      </div>

      <!-- Seletor de MÉTRICA -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center">
        <span class="tiny muted" style="font-weight:800;letter-spacing:.5px">MÉTRICA:</span>
        ${METRICS.map(x => pill(x.id === _metric, x.ico + ' ' + x.lbl, `mt-met-${x.id}`, x.color)).join('')}
      </div>
      <!-- Seletor de PERÍODO -->
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
        <span class="tiny muted" style="font-weight:800;letter-spacing:.5px">PERÍODO:</span>
        ${Object.keys(PERIODS).map(p => pill(p === _period, PERIODS[p].lbl, `mt-per-${p}`, '#334155')).join('')}
      </div>

      <!-- Tabela -->
      <div style="overflow-x:auto;margin-top:14px">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:${260 + colCount * 90 + 120}px">
          <thead>
            <tr style="background:var(--bg-3);border-bottom:2px solid var(--ink)">
              <th style="text-align:left;padding:8px 10px;position:sticky;left:0;background:var(--bg-3);min-width:230px;z-index:2">Equipe / Corretor</th>
              ${per.buckets.map(b => `<th style="text-align:right;padding:8px;min-width:84px">${b.lbl}${b.sub ? `<div class="tiny muted" style="font-weight:400">${b.sub}</div>` : ''}</th>`).join('')}
              <th style="text-align:right;padding:8px;background:var(--bg-2);min-width:110px;border-left:2px solid var(--border)">TOTAL ${_ano}</th>
            </tr>
          </thead>
          <tbody>
            ${teamNames.map(t => teamBlock(t, teams[t], per, editable)).join('')}
          </tbody>
          <tfoot>
            ${grandTotalRow(grid, per)}
          </tfoot>
        </table>
      </div>
      <p class="tiny muted mt-2">${editable ? 'Edite os valores mês a mês — salva automático ao sair da célula (Enter/Tab). Trimestre/Semestre/Ano somam os meses.' : 'Visão de leitura. Para editar, escolha um Sócio/Gerente e a visão Mensal.'} O atingido (↑) cruza com os deals ganhos do RD (só VGV/vendas).</p>
    </div>
  `;
  wire(canEdit);
}

/* bloco de uma equipe: linha-subtotal (clicável p/ recolher) + linhas dos corretores */
function teamBlock(team, rows, per, editable) {
  const k = mc();
  const collapsed = !!_collapsed[team];
  const tk = teamKey(team);
  const subtotalCells = per.buckets.map((b, bi) =>
    `<td data-tt="${tk}" data-bi="${bi}" style="text-align:right;padding:7px 8px;font-weight:800;color:${k.color}">${fmtVal(bucketSum(rows, b.months), k.money)}</td>`
  ).join('');
  const teamTotal = yearSum(rows);
  const head = `
    <tr data-team-head="${tk}" style="background:var(--bg-2);border-top:2px solid var(--border);cursor:pointer">
      <td style="padding:8px 10px;position:sticky;left:0;background:var(--bg-2);font-weight:800;z-index:1">
        <span style="display:inline-block;width:14px">${collapsed ? '▸' : '▾'}</span> 🛡 ${esc(team)} <span class="tiny muted" style="font-weight:600">· ${rows.length}</span>
      </td>
      ${subtotalCells}
      <td data-tt="${tk}" data-bi="T" style="text-align:right;padding:8px;background:var(--bg-2);font-weight:900;color:${k.color};border-left:2px solid var(--border)">${fmtVal(teamTotal, k.money)}</td>
    </tr>`;
  if (collapsed) return head;
  const brokerRows = rows.map(g => brokerRow(g, per, editable)).join('');
  return head + brokerRows;
}

function brokerRow(g, per, editable) {
  const u = g.user, k = mc();
  const ini = esc((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const cells = per.buckets.map((b, bi) => {
    const val = b.months.reduce((a, mi) => a + (Number(g.cells[mi] && g.cells[mi][k.key]) || 0), 0);
    if (editable && b.months.length === 1) {
      const mes = b.months[0] + 1;
      return `<td style="padding:3px 4px"><input data-edit="${esc(u.id)}|${mes}" value="${val || ''}" placeholder="0"
        inputmode="${k.money ? 'decimal' : 'numeric'}"
        style="width:80px;text-align:right;padding:5px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--ink)"></td>`;
    }
    return `<td style="text-align:right;padding:6px 8px">${val ? fmtVal(val, k.money) : '<span class="muted">—</span>'}</td>`;
  }).join('');
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 10px;position:sticky;left:0;background:var(--bg);z-index:1">
        <span style="display:inline-flex;align-items:center;gap:7px">
          <span style="width:20px;height:20px;border-radius:4px;background:${u.color || '#64748b'};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:9px">${ini}</span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px" title="${esc(u.name)}">${esc(u.name || '—')}</span>
        </span>
      </td>
      ${cells}
      <td data-rt="${esc(u.id)}" style="text-align:right;padding:5px 8px;font-weight:800;background:var(--bg-2);border-left:2px solid var(--border)">${fmtVal(yearSum([g]), k.money)}</td>
    </tr>`;
}

function grandTotalRow(grid, per) {
  const k = mc();
  const cells = per.buckets.map((b, bi) =>
    `<td data-gt="${bi}" style="text-align:right;padding:9px 8px;font-weight:900;color:#fff">${fmtVal(bucketSum(grid, b.months), k.money)}</td>`
  ).join('');
  return `
    <tr style="background:${k.color};color:#fff;border-top:3px solid var(--ink)">
      <td style="padding:9px 10px;position:sticky;left:0;background:${k.color};color:#fff;font-weight:900;z-index:1">Σ TOTAL GERAL</td>
      ${cells}
      <td data-gt="T" style="text-align:right;padding:9px 8px;font-weight:900;color:#fff;border-left:2px solid rgba(255,255,255,.3)">${fmtVal(yearSum(grid), k.money)}</td>
    </tr>`;
}

function wire(canEdit) {
  document.getElementById('mt-ano')?.addEventListener('change', async e => { _ano = parseInt(e.target.value); await reload(); });
  document.getElementById('mt-reload')?.addEventListener('click', () => reload());
  document.getElementById('mt-equipe')?.addEventListener('click', openMetaEquipe);
  METRICS.forEach(x => document.getElementById('mt-met-' + x.id)?.addEventListener('click', () => { _metric = x.id; render(); }));
  Object.keys(PERIODS).forEach(p => document.getElementById('mt-per-' + p)?.addEventListener('click', () => { _period = p; render(); }));
  // recolher/expandir equipe
  document.querySelectorAll('[data-team-head]').forEach(tr => tr.addEventListener('click', () => {
    const tk = tr.dataset.teamHead;
    const team = Object.keys(_collapsed).find(t => teamKey(t) === tk) || _teamFromKey(tk);
    _collapsed[team] = !_collapsed[team]; render();
  }));
  // edição inline
  if (canEdit && _period === 'mensal') {
    _root.querySelectorAll('input[data-edit]').forEach(inp => {
      inp.addEventListener('change', () => saveCell(inp));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });
  }
}

async function saveCell(inp) {
  const [userId, mesStr] = inp.dataset.edit.split('|');
  const mes = parseInt(mesStr);
  const k = mc();
  const raw = inp.value;
  const value = k.money
    ? (parseFloat(String(raw).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0)
    : (parseInt(String(raw).replace(/[^\d-]/g, '')) || 0);
  const g = (_data.grid || []).find(x => x.user && x.user.id === userId);
  if (!g) return;
  const cell = g.cells[mes - 1] || (g.cells[mes - 1] = { ano: _ano, mes });
  // monta payload com TODAS as metas (preserva as outras) + override da selecionada
  const body = { corretor_id: userId, ano: _ano, mes };
  ALL_KEYS.forEach(key => { body[key] = Number(cell[key]) || 0; });
  body[k.key] = value;
  cell[k.key] = value;             // otimista (estado local)
  inp.value = value || '';
  inp.style.outline = '2px solid #f59e0b';
  try {
    await api.request('/api/v3/metas/upsert', { method: 'POST', body });
    inp.style.outline = '2px solid #16a34a';
    setTimeout(() => { inp.style.outline = ''; }, 700);
    patchTotals();                 // recalcula subtotais/totais sem re-render (mantém foco/fluxo)
  } catch (e) {
    inp.style.outline = '2px solid #dc2626';
    alert('Erro ao salvar: ' + e.message);
  }
}

/* recalcula e atualiza as células de total no DOM, sem re-render (preserva digitação) */
function patchTotals() {
  const grid = _data.grid || [];
  const per = PERIODS[_period];
  const k = mc();
  const teams = {};
  grid.forEach(g => { const t = (g.user && g.user.team) ? g.user.team : 'Sem equipe'; (teams[t] = teams[t] || []).push(g); });
  // subtotais por equipe
  Object.keys(teams).forEach(t => {
    const tk = teamKey(t);
    per.buckets.forEach((b, bi) => {
      const el = _root.querySelector(`[data-tt="${tk}"][data-bi="${bi}"]`);
      if (el) el.textContent = fmtVal(bucketSum(teams[t], b.months), k.money);
    });
    const elT = _root.querySelector(`[data-tt="${tk}"][data-bi="T"]`);
    if (elT) elT.textContent = fmtVal(yearSum(teams[t]), k.money);
  });
  // total por corretor (linha)
  grid.forEach(g => {
    const el = _root.querySelector(`[data-rt="${cssEsc(g.user.id)}"]`);
    if (el) el.textContent = fmtVal(yearSum([g]), k.money);
  });
  // total geral
  per.buckets.forEach((b, bi) => {
    const el = _root.querySelector(`[data-gt="${bi}"]`);
    if (el) el.textContent = fmtVal(bucketSum(grid, b.months), k.money);
  });
  const elG = _root.querySelector('[data-gt="T"]');
  if (elG) elG.textContent = fmtVal(yearSum(grid), k.money);
}

/* ─── Meta por equipe (bulk, todas as métricas de um mês) ─── */
function openMetaEquipe() {
  const teams = [...new Set((_data?.grid || []).map(g => (g.user?.team || '')).filter(Boolean))];
  const mesAtual = new Date().getMonth() + 1;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div class="card" style="max-width:480px;width:100%;background:var(--bg-2)">
      <h3 class="card-title">👥 Meta por equipe — ${_ano}</h3>
      <p class="card-sub">Aplica a MESMA meta mensal a todos os corretores da equipe.</p>
      <div style="display:grid;gap:10px;margin-top:12px">
        <div><label class="tiny muted">Equipe</label><select id="me-team" class="select">${teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
        <div><label class="tiny muted">Mês</label><select id="me-mes" class="select">${MES.map((m, i) => `<option value="${i + 1}"${i + 1 === mesAtual ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
        ${metaFields({})}
      </div>
      <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="me-save">💾 Aplicar</button><button class="btn btn-ghost" id="me-cancel">Cancelar</button></div>
      <div id="me-msg" class="mt-2"></div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#me-cancel').addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#me-save').addEventListener('click', async () => {
    const team = ov.querySelector('#me-team').value;
    const mes = parseInt(ov.querySelector('#me-mes').value);
    const vals = readMetaFields(ov);
    const ids = (_data?.grid || []).filter(g => (g.user?.team || '') === team).map(g => g.user.id);
    const msg = ov.querySelector('#me-msg');
    msg.innerHTML = `<div class="muted tiny"><span class="spinner"></span> Aplicando a ${ids.length} corretores…</div>`;
    try {
      for (const cid of ids) await api.request('/api/v3/metas/upsert', { method: 'POST', body: { corretor_id: cid, ano: _ano, mes, ...vals } });
      msg.innerHTML = `<div class="alert alert-ok">✅ Aplicada a ${ids.length} corretores!</div>`;
      setTimeout(async () => { ov.remove(); await reload(); }, 800);
    } catch (e) { msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
  });
}
function metaFields(v) {
  const f = (key, label, money) => `<div><label class="tiny muted">${label}</label><input class="input" data-mf="${key}" type="${money ? 'text' : 'number'}" value="${v[key] || 0}" inputmode="${money ? 'decimal' : 'numeric'}"></div>`;
  return `${f('meta_vgv', '💰 VGV (R$)', true)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${f('meta_vendas', '🏆 Vendas')}${f('meta_agendamentos', '📅 Agendamentos')}
      ${f('meta_visitas', '🚪 Visitas')}${f('meta_pastas', '📁 Pastas')}
    </div>`;
}
function readMetaFields(scope) {
  const vals = {};
  scope.querySelectorAll('[data-mf]').forEach(el => {
    const k = el.dataset.mf;
    vals[k] = k === 'meta_vgv'
      ? (parseFloat(String(el.value).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0)
      : (parseInt(el.value) || 0);
  });
  return vals;
}

/* ─── Helpers ─── */
function teamKey(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function _teamFromKey(tk) { return (_data?.grid || []).map(g => g.user?.team || 'Sem equipe').find(t => teamKey(t) === tk) || tk; }
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
function pill(active, label, id, color) {
  return `<button id="${id}" class="btn" style="padding:5px 12px;font-size:12px;font-weight:700;border-radius:999px;border:1px solid ${active ? color : 'var(--border)'};background:${active ? color : 'transparent'};color:${active ? '#fff' : 'var(--ink-muted)'}">${label}</button>`;
}
function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:170px;background:var(--bg-3);border-radius:var(--r-md);padding:13px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:.5px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:20px;font-weight:900;color:${color};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub}</div></div>`;
}
function fmtVal(n, isMoney) {
  if (n == null || isNaN(n)) n = 0;
  if (isMoney) return 'R$ ' + money(n);
  return Number(n).toLocaleString('pt-BR');
}
function money(n) { if (n == null || isNaN(n)) return '0'; return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function pctColor(p) { if (p == null) return 'var(--ink-muted)'; if (p < 50) return '#dc2626'; if (p < 90) return '#d97706'; if (p < 110) return '#16a34a'; return '#065f46'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
