/* ============================================================================
   PSM-OS v2 — Metas + Atingimento
   Sprint 7.8
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const MES_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let _root = null;
let _ano = new Date().getFullYear();
let _data = null;
let _showOnly = 'todos';   // todos | com_meta | sem_meta

export async function pageMetas(ctx, root) {
  _root = root;
  await reload();
}

async function reload() {
  if (_root) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando metas…</div></div>';
  try {
    _data = await api.request('/api/v3/metas/list?ano=' + _ano);
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

  // Totais por user
  const userTotals = grid.map(g => {
    const totals = g.metas.reduce((acc, m) => ({
      vgv: acc.vgv + Number(m.meta_vgv || 0),
      vendas: acc.vendas + Number(m.meta_vendas || 0),
      pontos: acc.pontos + Number(m.meta_pontos || 0),
      meses_com: acc.meses_com + (m._empty ? 0 : 1),
    }), { vgv: 0, vendas: 0, pontos: 0, meses_com: 0 });
    return { user: g.user, metas: g.metas, ...totals };
  });

  // Filtro show only
  if (_showOnly === 'com_meta')   grid = userTotals.filter(u => u.meses_com > 0);
  else if (_showOnly === 'sem_meta') grid = userTotals.filter(u => u.meses_com === 0);
  else grid = userTotals;

  // Totais gerais
  const totGlobal = userTotals.reduce((acc, u) => ({
    vgv: acc.vgv + u.vgv,
    vendas: acc.vendas + u.vendas,
    users_com: acc.users_com + (u.meses_com > 0 ? 1 : 0),
  }), { vgv: 0, vendas: 0, users_com: 0 });

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🎯 Metas ${_ano} ${canEdit ? '<span class="tiny muted" style="font-weight:400">— editável</span>' : '<span class="tiny muted" style="font-weight:400">— visualização</span>'}</h2>
      <p class="card-sub">Scope: <b>${d.scope}</b> · ${d.users_count} corretor(es) · ${d.metas_count} meta(s) cadastrada(s)</p>

      <!-- Filtros -->
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted" style="font-weight:700">ANO:</label>
        <select id="f-ano" class="select" style="padding:5px 10px;font-size:12px">
          ${[2024, 2025, 2026, 2027].map(a => `<option value="${a}"${a === _ano ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
        <label class="tiny muted" style="font-weight:700;margin-left:10px">MOSTRAR:</label>
        <select id="f-show" class="select" style="padding:5px 10px;font-size:12px">
          <option value="todos"${_showOnly==='todos'?' selected':''}>Todos</option>
          <option value="com_meta"${_showOnly==='com_meta'?' selected':''}>Com meta cadastrada</option>
          <option value="sem_meta"${_showOnly==='sem_meta'?' selected':''}>Sem meta</option>
        </select>
      </div>

      <!-- Totais do ano -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpiBig('💎 VGV total ' + _ano, 'R$ ' + money(totGlobal.vgv),  `${userTotals.length} corretores`, '#7c3aed')}
        ${kpiBig('🏠 Vendas ' + _ano,    fmtNum(totGlobal.vendas),       `meta acumulada`,                  '#2563eb')}
        ${kpiBig('✅ Cobertura',         `${totGlobal.users_com}/${userTotals.length}`, 'corretores com meta', '#16a34a')}
      </div>

      <!-- Tabela grid -->
      <div style="overflow-x:auto;margin-top:14px">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:1100px">
          <thead>
            <tr style="background:var(--bg-3);border-bottom:2px solid var(--ink)">
              <th style="text-align:left;padding:8px;position:sticky;left:0;background:var(--bg-3);min-width:180px">Corretor</th>
              ${MES_NAMES.map(m => `<th style="text-align:right;padding:8px;min-width:90px">${m}</th>`).join('')}
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

      <div class="tiny muted mt-3">
        Clique numa célula (Sócio/Gerente) pra editar a meta VGV daquele corretor naquele mês. Atingimento real vem na próxima fase (cruzando com deals ganhos do RD).
      </div>
    </div>
  `;

  document.getElementById('f-ano').addEventListener('change', async e => { _ano = parseInt(e.target.value); await reload(); });
  document.getElementById('f-show').addEventListener('change', e => { _showOnly = e.target.value; render(); });
  if (canEdit) {
    document.querySelectorAll('[data-meta-cell]').forEach(td => {
      td.addEventListener('click', () => editMeta(td));
    });
  }
}

function userRow(g, canEdit) {
  const u = g.user;
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px;position:sticky;left:0;background:var(--bg);font-weight:700;display:flex;align-items:center;gap:6px">
        <div style="width:22px;height:22px;border-radius:4px;background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px">${ini}</div>
        ${escapeHtml(u.name || '—')}
      </td>
      ${g.metas.map(m => `
        <td ${canEdit ? `data-meta-cell="${u.id}|${m.ano}|${m.mes}"` : ''}
            style="text-align:right;padding:6px 8px;color:${m._empty ? 'var(--ink-muted)' : 'var(--ink)'};${canEdit ? 'cursor:pointer' : ''};${m._empty ? 'opacity:0.4' : ''}"
            title="${escapeHtml(u.name)} · ${MES_NAMES[m.mes-1]}/${m.ano}">
          ${m._empty ? '—' : 'R$ ' + money(m.meta_vgv)}
        </td>
      `).join('')}
      <td style="text-align:right;padding:6px 8px;background:var(--bg-2);font-weight:800;color:#7c3aed">R$ ${money(g.vgv)}</td>
    </tr>
  `;
}

function footerRow(grid) {
  const totals = MES_NAMES.map((_, i) => grid.reduce((s, g) => s + Number(g.metas[i]?.meta_vgv || 0), 0));
  const totalAno = totals.reduce((s, v) => s + v, 0);
  return `
    <tr style="border-top:2px solid var(--ink);background:var(--bg-3);font-weight:800">
      <td style="padding:8px;position:sticky;left:0;background:var(--bg-3)">TOTAL/mês</td>
      ${totals.map(t => `<td style="text-align:right;padding:8px">${t > 0 ? 'R$ ' + money(t) : '—'}</td>`).join('')}
      <td style="text-align:right;padding:8px;background:var(--bg-2);color:#7c3aed">R$ ${money(totalAno)}</td>
    </tr>
  `;
}

async function editMeta(td) {
  const [corretor_id, ano, mes] = td.dataset.metaCell.split('|');
  const current = td.textContent.trim().replace('R$ ', '').replace(/\./g, '').replace(',', '.');
  const novo = prompt(`Meta VGV de ${corretor_id} em ${MES_NAMES[mes-1]}/${ano} (R$):`, current === '—' ? '0' : current);
  if (novo === null) return;
  const valor = parseFloat(String(novo).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  if (isNaN(valor) || valor < 0) { alert('Valor inválido'); return; }
  try {
    await api.request('/api/v3/metas/upsert', { method: 'POST', body: { corretor_id, ano: parseInt(ano), mes: parseInt(mes), meta_vgv: valor } });
    await reload();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────
function kpiBig(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${color};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}
function money(n) {
  if (n == null || isNaN(n)) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
