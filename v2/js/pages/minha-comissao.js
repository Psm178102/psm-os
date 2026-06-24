/* ============================================================================
   PSM-OS v2 — Minha Comissão  v81.44
   ----------------------------------------------------------------------------
   Visão da comissão do corretor a partir do que JÁ ESTÁ no NIBO (real):
   lançamentos de comissão/honorário filtrados pelo nome do corretor. Mostra o
   que já foi PAGO, o que está PREVISTO (a receber) e a linha do tempo.
   • Corretor → vê só a SUA (auto-match pelo nome do login).
   • Gestor/sócio (lvl>=7) → seletor pra ver de qualquer corretor (QA + gestão).
   Sem dado inventado: se não houver lançamento, mostra estado vazio honesto.
   Gated em sócio por enquanto (ROUTE_MIN_LVL=10).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const BRL = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '—';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

let _root = null, _rows = [], _stakes = [], _sel = '', _isGestor = false;

export async function pageMinhaComissao(ctx, root) {
  _root = root;
  const me = auth.user() || {};
  _isGestor = (me.lvl || 0) >= 7;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Buscando comissões no NIBO…</div></div>';
  try {
    const r = await api.request('/api/v3/finance/comissoes?company=all');
    _rows = (r && r.rows) || [];
    _stakes = (r && r.top_stakeholders) || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro ao buscar comissões: ${esc(e.message)}</div>`;
    return;
  }
  // escopo inicial: corretor → próprio nome; gestor → "todos"
  if (!_isGestor) {
    const myName = norm(me.name || me.nome || me.login);
    const match = _stakes.find(s => norm(s.stakeholder).includes(myName) || myName.includes(norm(s.stakeholder)));
    _sel = match ? match.stakeholder : (me.name || me.login || '');
  } else {
    _sel = '';   // todos
  }
  render();
}

function filteredRows() {
  if (!_sel) return _rows;
  const k = norm(_sel);
  return _rows.filter(r => norm(r.stakeholder).includes(k) || k.includes(norm(r.stakeholder)));
}

function render() {
  const rows = filteredRows();
  const total = rows.reduce((a, r) => a + (r.valor || 0), 0);
  const pago = rows.filter(r => r.settled).reduce((a, r) => a + (r.valor || 0), 0);
  const previsto = total - pago;
  const ordered = [...rows].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  const stakeOptions = [...new Set(_stakes.map(s => s.stakeholder).filter(Boolean))]
    .map(s => `<option value="${esc(s)}"${_sel === s ? ' selected' : ''}>${esc(s)}</option>`).join('');

  _root.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-size:21px;font-weight:800">💰 Minha Comissão</div>
      <div class="tiny muted">Comissões e honorários no NIBO ${_isGestor ? '(gestor: escolha o corretor)' : '(suas)'} — o que já foi pago e o que está a receber.</div>
    </div>

    ${_isGestor ? `<div class="card" style="padding:12px;margin-bottom:14px">
      <label class="tiny muted">Ver comissão de:</label>
      <select id="mc-sel" class="select" style="max-width:320px">
        <option value="">— Todos os corretores —</option>
        ${stakeOptions}
      </select>
    </div>` : ''}

    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:16px">
      <div class="card" style="padding:14px;flex:1;min-width:150px;border-left:4px solid #16a34a"><div class="tiny muted">✅ Recebido (pago)</div><div style="font-size:23px;font-weight:800;color:#16a34a">${BRL(pago)}</div></div>
      <div class="card" style="padding:14px;flex:1;min-width:150px;border-left:4px solid #f59e0b"><div class="tiny muted">⏳ A receber (previsto)</div><div style="font-size:23px;font-weight:800;color:#f59e0b">${BRL(previsto)}</div></div>
      <div class="card" style="padding:14px;flex:1;min-width:150px;border-left:4px solid #0ea5e9"><div class="tiny muted">Σ Total</div><div style="font-size:23px;font-weight:800;color:#0ea5e9">${BRL(total)}</div></div>
      <div class="card" style="padding:14px;flex:1;min-width:120px"><div class="tiny muted"># Lançamentos</div><div style="font-size:23px;font-weight:800">${rows.length}</div></div>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:12px 14px;font-weight:800;border-bottom:1px solid var(--bd,#e2e8f0)">📜 Lançamentos${_sel ? ' · ' + esc(_sel) : ''}</div>
      ${!ordered.length
        ? `<div class="muted tiny" style="text-align:center;padding:34px">Nenhuma comissão encontrada${_sel ? ' pra ' + esc(_sel) : ''} no NIBO. ${_isGestor && !_sel ? '' : 'Quando houver lançamento com esse nome, aparece aqui.'}</div>`
        : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="text-align:left;color:var(--ink-muted,#64748b)">
              <th style="padding:8px 12px">Data</th><th style="padding:8px 12px">Descrição</th>${_isGestor && !_sel ? '<th style="padding:8px 12px">Corretor</th>' : ''}<th style="padding:8px 12px">Empresa</th><th style="padding:8px 12px;text-align:right">Valor</th><th style="padding:8px 12px">Status</th></tr></thead>
            <tbody>${ordered.map(r => `<tr style="border-top:1px solid var(--bd,#e2e8f0)">
              <td style="padding:8px 12px;white-space:nowrap">${fmtData(r.data)}</td>
              <td style="padding:8px 12px">${esc((r.description || r.category || '—').substring(0, 60))}</td>
              ${_isGestor && !_sel ? `<td style="padding:8px 12px">${esc(r.stakeholder || '—')}</td>` : ''}
              <td style="padding:8px 12px"><span class="tiny">${esc(r.company_label || r.company || '—')}</span></td>
              <td style="padding:8px 12px;text-align:right;font-weight:700">${BRL(r.valor)}</td>
              <td style="padding:8px 12px">${r.settled ? '<span style="color:#16a34a;font-weight:700">✅ pago</span>' : '<span style="color:#f59e0b;font-weight:700">⏳ previsto</span>'}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
    </div>
    <div class="tiny muted" style="margin-top:10px">Fonte: NIBO (categorias de comissão/honorário). Reflete o que está lançado no financeiro — não é projeção de pipeline.</div>`;

  const sel = _root.querySelector('#mc-sel');
  if (sel) sel.onchange = () => { _sel = sel.value; render(); };
}
