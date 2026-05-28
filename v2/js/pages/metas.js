/* ============================================================================
   PSM-OS v2 — Metas + Atingimento Real (cruza com Deals RD ganhos)
   Sprint 7.9
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const MES_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const STATUS_COLORS = {
  vazio:     { bg: 'transparent', fg: 'var(--ink-muted)', ico: '' },
  critico:   { bg: '#fee2e2',     fg: '#991b1b',         ico: '🔴' },
  atencao:   { bg: '#fef3c7',     fg: '#78350f',         ico: '🟡' },
  bom:       { bg: '#dcfce7',     fg: '#166534',         ico: '🟢' },
  estourou:  { bg: '#d1fae5',     fg: '#065f46',         ico: '🚀' },
};

let _root = null;
let _ano = new Date().getFullYear();
let _data = null;
let _view = 'pct';     // pct | meta | atingido | combo
let _showOnly = 'todos';

export async function pageMetas(ctx, root) {
  _root = root;
  await reload();
}

async function reload() {
  if (_root) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Cruzando metas com Deals RD…</div></div>';
  try {
    _data = await api.request('/api/v3/metas/atingimento?ano=' + _ano);
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const canEdit = (me?.lvl || 0) >= 7;
  const d = _data;
  let grid = d.grid || [];
  const t = d.totals || {};

  if (_showOnly === 'com_meta')       grid = grid.filter(g => (g.totals?.meta_vgv || 0) > 0);
  else if (_showOnly === 'sem_meta')  grid = grid.filter(g => (g.totals?.meta_vgv || 0) === 0);

  const sourceBadge = d.source === 'postgres'
    ? `<span class="tiny" style="background:#dcfce7;color:#166534;padding:3px 8px;border-radius:var(--r-full);font-weight:700">📦 Postgres ${d.deals_synced_at ? '· sync ' + new Date(d.deals_synced_at).toLocaleString('pt-BR') : ''}</span>`
    : d.source === 'rd_live'
      ? '<span class="tiny" style="background:#fef3c7;color:#78350f;padding:3px 8px;border-radius:var(--r-full);font-weight:700">🔥 RD live (sem sync ainda)</span>'
      : '<span class="tiny" style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:var(--r-full);font-weight:700">⚠ Sem dados</span>';

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🎯 Metas ${_ano} — Atingimento RD ${canEdit ? '<span class="tiny muted" style="font-weight:400">— click pra editar</span>' : ''}</h2>
      <p class="card-sub">
        Scope <b>${d.scope}</b> · ${d.cached ? '📦 Cache ' + d.cache_age_s + 's' : '🔥 Fresh'} · ${sourceBadge} · Atualizado ${new Date(d.fetched_at).toLocaleString('pt-BR')}
        ${d.rd_error ? `<br><span style="color:var(--warn)">⚠ ${escapeHtml(d.rd_error)}</span>` : ''}
      </p>

      <!-- Hero KPIs do ano -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpiBig('Meta VGV ' + _ano,       'R$ ' + money(t.meta_vgv),      `${grid.length} corretores`,     '#2563eb')}
        ${kpiBig('Atingido VGV',           'R$ ' + money(t.atingido_vgv), `${t.vendas_count || 0} vendas`, t.atingido_vgv >= t.meta_vgv ? '#16a34a' : '#d97706')}
        ${kpiBig('% Atingimento',          (t.pct == null ? '—' : t.pct.toFixed(1) + '%'), 'do ano',         pctColor(t.pct))}
        ${kpiBig('Falta/Sobra',            'R$ ' + money((t.atingido_vgv || 0) - (t.meta_vgv || 0)),
                                          (t.atingido_vgv >= t.meta_vgv ? 'sobra' : 'falta'),
                                          t.atingido_vgv >= t.meta_vgv ? '#16a34a' : '#dc2626')}
      </div>

      <!-- Controles -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted" style="font-weight:700">ANO:</label>
        <select id="f-ano" class="select" style="padding:5px 10px;font-size:12px">
          ${[2024, 2025, 2026, 2027].map(a => `<option value="${a}"${a === _ano ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">VISÃO:</label>
        <select id="f-view" class="select" style="padding:5px 10px;font-size:12px">
          <option value="pct"     ${_view==='pct'?'selected':''}>% Atingimento</option>
          <option value="meta"    ${_view==='meta'?'selected':''}>Meta VGV</option>
          <option value="atingido"${_view==='atingido'?'selected':''}>Atingido VGV</option>
          <option value="combo"   ${_view==='combo'?'selected':''}>Atingido / Meta</option>
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">MOSTRAR:</label>
        <select id="f-show" class="select" style="padding:5px 10px;font-size:12px">
          <option value="todos"${_showOnly==='todos'?' selected':''}>Todos</option>
          <option value="com_meta"${_showOnly==='com_meta'?' selected':''}>Com meta</option>
          <option value="sem_meta"${_showOnly==='sem_meta'?' selected':''}>Sem meta</option>
        </select>
        <button class="btn btn-ghost" id="btn-reload" style="margin-left:auto">🔄 Atualizar</button>
        ${canEdit ? '<button class="btn btn-ghost" id="btn-meta-equipe">👥 Meta por Equipe</button>' : ''}
        ${canEdit ? '<button class="btn btn-primary" id="btn-sync">⚡ Sincronizar RD → Postgres</button>' : ''}
      </div>

      <!-- Legenda -->
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
        ${legChip('critico',  '< 50%')}
        ${legChip('atencao',  '50-89%')}
        ${legChip('bom',      '90-109%')}
        ${legChip('estourou', '≥ 110%')}
      </div>

      <!-- Tabela grid -->
      <div style="overflow-x:auto;margin-top:14px">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:1200px">
          <thead>
            <tr style="background:var(--bg-3);border-bottom:2px solid var(--ink)">
              <th style="text-align:left;padding:8px;position:sticky;left:0;background:var(--bg-3);min-width:200px;z-index:1">Corretor</th>
              ${MES_NAMES.map(m => `<th style="text-align:center;padding:8px;min-width:78px">${m}</th>`).join('')}
              <th style="text-align:right;padding:8px;background:var(--bg-2);min-width:120px">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${grid.map(g => userRow(g, canEdit)).join('')}
          </tbody>
          <tfoot>
            ${footerRow(grid)}
          </tfoot>
        </table>
      </div>
    </div>
  `;

  document.getElementById('f-ano').addEventListener('change', async e => { _ano = parseInt(e.target.value); await reload(); });
  document.getElementById('f-view').addEventListener('change', e => { _view = e.target.value; render(); });
  document.getElementById('f-show').addEventListener('change', e => { _showOnly = e.target.value; render(); });
  document.getElementById('btn-reload').addEventListener('click', async () => { await reload(); });
  const btnSync = document.getElementById('btn-sync');
  if (btnSync) btnSync.addEventListener('click', doSync);
  const btnEq = document.getElementById('btn-meta-equipe');
  if (btnEq) btnEq.addEventListener('click', openMetaEquipe);

  if (canEdit) {
    document.querySelectorAll('[data-meta-cell]').forEach(td => {
      td.addEventListener('click', () => editMeta(td));
    });
  }
}

function userRow(g, canEdit) {
  const u = g.user;
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const tot = g.totals || {};

  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px;position:sticky;left:0;background:var(--bg);font-weight:700;display:flex;align-items:center;gap:6px;z-index:1">
        <div style="width:22px;height:22px;border-radius:4px;background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px">${ini}</div>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px" title="${escapeHtml(u.name)}">${escapeHtml(u.name || '—')}</span>
      </td>
      ${g.cells.map(c => cell(c, u.id, canEdit)).join('')}
      ${rowTotal(tot)}
    </tr>
  `;
}

function cell(c, userId, canEdit) {
  const st = STATUS_COLORS[c.status];
  const meta = c.meta_vgv || 0;
  const at = c.atingido_vgv || 0;
  const click = canEdit ? `data-meta-cell="${userId}|${c.ano}|${c.mes}"` : '';
  const cursor = canEdit ? 'cursor:pointer' : '';
  let txt = '';
  if (_view === 'pct') {
    txt = c.pct == null ? '—' : (c.pct >= 1000 ? '∞' : c.pct.toFixed(0) + '%');
  } else if (_view === 'meta') {
    txt = meta > 0 ? money(meta) : '—';
  } else if (_view === 'atingido') {
    txt = at > 0 ? money(at) : '—';
  } else {
    // combo: at / meta
    if (meta === 0 && at === 0) txt = '—';
    else if (meta === 0)        txt = money(at);
    else                         txt = money(at) + '<br><span class="tiny muted">/ ' + money(meta) + '</span>';
  }

  const tooltip = `${money(at)} / ${money(meta)} (${c.pct == null ? '—' : c.pct.toFixed(1) + '%'}) · ${c.vendas_count} vendas`;

  return `
    <td ${click}
        style="text-align:center;padding:6px 4px;background:${st.bg};color:${st.fg};${cursor};font-weight:700"
        title="${tooltip}">
      ${st.ico ? `<span style="font-size:9px;display:block">${st.ico}</span>` : ''}
      <span style="font-size:11px">${txt}</span>
    </td>
  `;
}

function rowTotal(tot) {
  const st = STATUS_COLORS[tot.status || 'vazio'];
  const pct = tot.pct == null ? '—' : tot.pct.toFixed(0) + '%';
  return `
    <td style="text-align:right;padding:6px 8px;background:var(--bg-2);font-weight:800">
      <div style="color:#2563eb;font-size:11px">R$ ${money(tot.meta_vgv)}</div>
      <div style="color:${st.fg};font-size:11px">↑ R$ ${money(tot.atingido_vgv)}</div>
      <div style="font-size:12px;color:${st.fg}">${pct}</div>
    </td>
  `;
}

function footerRow(grid) {
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const meta = grid.reduce((s, g) => s + (g.cells[i]?.meta_vgv || 0), 0);
    const at   = grid.reduce((s, g) => s + (g.cells[i]?.atingido_vgv || 0), 0);
    return { meta, at, pct: meta > 0 ? at / meta * 100 : null };
  });
  return `
    <tr style="border-top:2px solid var(--ink);background:var(--bg-3);font-weight:800">
      <td style="padding:8px;position:sticky;left:0;background:var(--bg-3);z-index:1">TOTAL/mês</td>
      ${monthly.map(m => `
        <td style="text-align:center;padding:6px 4px;font-size:11px">
          ${m.meta > 0 ? `<div style="color:#2563eb">R$ ${money(m.meta)}</div>` : ''}
          ${m.at > 0   ? `<div style="color:${m.pct >= 90 ? '#16a34a' : '#d97706'}">↑ R$ ${money(m.at)}</div>` : ''}
          ${m.pct != null ? `<div>${m.pct.toFixed(0)}%</div>` : (m.meta === 0 && m.at === 0 ? '<div class="muted">—</div>' : '')}
        </td>
      `).join('')}
      <td style="text-align:right;padding:8px;background:var(--bg-2)"></td>
    </tr>
  `;
}

async function doSync() {
  const btn = document.getElementById('btn-sync');
  if (!btn) return;
  if (!confirm('Sincronizar deals do RD → Postgres? Pode demorar 1-3 min.')) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sincronizando…';
  try {
    const r = await api.request('/api/v3/crm/sync', { method: 'POST', body: { max_pages: 30 } });
    alert(`✅ Sync OK\n${r.upserted} deals upserted em ${r.duration_s}s\nPáginas: ${r.pages_done}`);
    await reload();
  } catch (e) {
    alert('Erro: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⚡ Sincronizar RD → Postgres';
  }
}

async function editMeta(td) {
  const [corretor_id, ano, mes] = td.dataset.metaCell.split('|');
  // Busca a célula atual no grid pra pré-preencher
  const g = (_data?.grid || []).find(x => x.user?.id === corretor_id);
  const cell = g?.cells?.[mes - 1] || {};
  const nome = g?.user?.name || corretor_id;
  openMetaModal({
    titulo: `🎯 Meta de ${nome} — ${MES_NAMES[mes - 1]}/${ano}`,
    valores: {
      meta_vgv: cell.meta_vgv || 0,
      meta_vendas: cell.meta_vendas || 0,
      meta_visitas: cell.meta_visitas || 0,
      meta_pastas: cell.meta_pastas || 0,
      meta_propostas: cell.meta_propostas || 0,
      meta_agendamentos: cell.meta_agendamentos || 0,
    },
    onSave: async (vals) => {
      await api.request('/api/v3/metas/upsert', { method: 'POST', body: {
        corretor_id, ano: parseInt(ano), mes: parseInt(mes), ...vals,
      }});
      await reload();
    },
  });
}

function openMetaEquipe() {
  // Lista equipes a partir do grid (user.team)
  const teams = [...new Set((_data?.grid || []).map(g => (g.user?.team || '').toLowerCase()).filter(Boolean))];
  const mesAtual = new Date().getMonth() + 1;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div class="card" style="max-width:480px;width:100%;background:var(--bg-2)">
      <h3 class="card-title">👥 Meta por Equipe — ${_ano}</h3>
      <p class="card-sub">Aplica a mesma meta mensal a TODOS os corretores da equipe escolhida.</p>
      <div style="display:grid;gap:10px;margin-top:12px">
        <div>
          <label class="tiny muted">Equipe</label>
          <select id="me-team" class="select">${teams.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
        </div>
        <div>
          <label class="tiny muted">Mês</label>
          <select id="me-mes" class="select">${MES_NAMES.map((m, i) => `<option value="${i + 1}" ${i + 1 === mesAtual ? 'selected' : ''}>${m}</option>`).join('')}</select>
        </div>
        ${metaFields({})}
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" id="me-save">💾 Aplicar à equipe</button>
        <button class="btn btn-ghost" id="me-cancel">Cancelar</button>
      </div>
      <div id="me-msg" class="mt-2"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#me-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#me-save').addEventListener('click', async () => {
    const team = overlay.querySelector('#me-team').value;
    const mes = parseInt(overlay.querySelector('#me-mes').value);
    const vals = readMetaFields(overlay);
    const corretores = (_data?.grid || []).filter(g => (g.user?.team || '').toLowerCase() === team).map(g => g.user.id);
    const msg = overlay.querySelector('#me-msg');
    msg.innerHTML = `<div class="muted tiny"><span class="spinner"></span> Aplicando a ${corretores.length} corretores…</div>`;
    try {
      for (const cid of corretores) {
        await api.request('/api/v3/metas/upsert', { method: 'POST', body: { corretor_id: cid, ano: _ano, mes, ...vals } });
      }
      msg.innerHTML = `<div class="alert alert-ok">✅ Meta aplicada a ${corretores.length} corretores!</div>`;
      setTimeout(async () => { overlay.remove(); await reload(); }, 900);
    } catch (e) {
      msg.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
    }
  });
}

function openMetaModal({ titulo, valores, onSave }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div class="card" style="max-width:440px;width:100%;background:var(--bg-2)">
      <h3 class="card-title">${titulo}</h3>
      <div style="display:grid;gap:10px;margin-top:12px">${metaFields(valores)}</div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" id="mm-save">💾 Salvar</button>
        <button class="btn btn-ghost" id="mm-cancel">Cancelar</button>
      </div>
      <div id="mm-msg" class="mt-2"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#mm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#mm-save').addEventListener('click', async () => {
    const vals = readMetaFields(overlay);
    const msg = overlay.querySelector('#mm-msg');
    msg.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Salvando…</div>';
    try {
      await onSave(vals);
      overlay.remove();
    } catch (e) {
      msg.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
    }
  });
}

function metaFields(v) {
  const f = (key, label, money) => `
    <div>
      <label class="tiny muted">${label}</label>
      <input class="input" data-mf="${key}" type="${money ? 'text' : 'number'}" value="${v[key] || 0}" inputmode="${money ? 'decimal' : 'numeric'}">
    </div>`;
  return `
    ${f('meta_vgv', '💰 Meta VGV (R$)', true)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${f('meta_vendas', '🏆 Vendas')}
      ${f('meta_agendamentos', '📅 Agendamentos')}
      ${f('meta_visitas', '🚪 Visitas')}
      ${f('meta_pastas', '📁 Pastas')}
      ${f('meta_propostas', '📝 Propostas')}
    </div>
  `;
}

function readMetaFields(scope) {
  const vals = {};
  scope.querySelectorAll('[data-mf]').forEach(el => {
    const k = el.dataset.mf;
    if (k === 'meta_vgv') {
      vals[k] = parseFloat(String(el.value).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
    } else {
      vals[k] = parseInt(el.value) || 0;
    }
  });
  return vals;
}

// ─── Helpers ────────────────────────────────────────────────────────────
function kpiBig(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:20px;font-weight:900;color:${color};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}
function legChip(status, label) {
  const st = STATUS_COLORS[status];
  return `<span style="background:${st.bg};color:${st.fg};padding:3px 10px;border-radius:var(--r-full);font-size:11px;font-weight:700">${st.ico} ${label}</span>`;
}
function pctColor(pct) {
  if (pct == null) return 'var(--ink-muted)';
  if (pct < 50) return '#dc2626';
  if (pct < 90) return '#d97706';
  if (pct < 110) return '#16a34a';
  return '#065f46';
}
function money(n) {
  if (n == null || isNaN(n)) return '0';
  // Para tabela: sem decimais; valores grandes ok
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
