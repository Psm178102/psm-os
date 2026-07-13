/* PSM-OS v2 — 🌉 Fila da Ponte (v84.21)
   Fechamento próprio Paulo/Isa: os negócios abertos MAP+Terceiros ranqueados
   por VALOR, servidos em lote diário. Gate de julho vira rotina de manhã.
   Backend: /api/v3/crm/ponte (lvl>=7). */
import { api } from '../api.js';

let _root = null, _d = null, _view = 'fila', _busy = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ST = [
  ['contatado', '📱 Contatei', '#2563eb'], ['proposta', '📄 Proposta', '#7c3aed'],
  ['negociando', '🤝 Negociando', '#d97706'], ['fechou_rd', '🏆 Fechei (marcar no RD!)', '#16a34a'],
  ['perdeu', '❌ Perdeu', '#dc2626'], ['futuro', '⏳ Futuro', '#64748b'],
];
const FRENTE = { map: '🏠 MAP', terceiros: '🔁 Terceiros' };

export async function pagePonte(ctx, root) { _root = root; await reload(); }

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Ranqueando a carteira própria…</div></div>';
  try {
    _d = await api.request('/api/v3/crm/ponte?view=' + _view + '&lote=10');
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  render();
}

function render() {
  const fila = _d.fila || [], s = _d.stats || {};
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🌉 Fila da Ponte</h2>
        <span class="tiny muted">carteira própria (MAP + Terceiros) por VALOR · o gate do mês vira rotina de manhã</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-ghost btn-sm" id="pt-view">${_view === 'fila' ? '👁 Ver base inteira' : '🎯 Ver lote do dia'}</button>
        <button class="btn btn-ghost btn-sm" id="pt-reload">↻</button>
      </div>
      <div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:130px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">Trabalhados hoje</div><div style="font-weight:900;font-size:18px">${s.hoje || 0}</div></div>
        <div style="flex:1;min-width:130px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">🤝 Negociando</div><div style="font-weight:900;font-size:18px">${s.negociando || 0}</div></div>
        <div style="flex:1;min-width:130px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">📄 Em proposta</div><div style="font-weight:900;font-size:18px">${s.proposta || 0}</div></div>
        <div style="flex:1;min-width:130px;background:var(--bg-3);border-radius:10px;padding:8px 10px;border-left:3px solid #16a34a"><div class="tiny muted">🏆 Fechados (RD)</div><div style="font-weight:900;font-size:18px">${s.fechou_rd || 0}</div></div>
        <div style="flex:1;min-width:130px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">Base c/ telefone</div><div style="font-weight:900;font-size:18px">${_d.total_base || 0}</div></div>
      </div>
    </div>
    <div class="mt-2">
      ${fila.map(it => `
        <div class="card" style="margin:0 0 8px;padding:10px 12px${it.sem_valor ? ';border-left:3px solid #d97706' : ''}">
          <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
            <b style="font-size:14px">${esc(it.contato)}</b>
            <span class="badge">${FRENTE[it.frente] || esc(it.frente)}</span>
            ${it.sem_valor ? '<span class="badge" style="background:#d9770622;color:#d97706;font-weight:700">⚠️ SEM VALOR no RD</span>'
      : `<b style="color:#16a34a">${brl(it.valor)}</b>`}
            <span class="tiny muted">${esc(it.estagio || '')}</span>
            ${it.st ? `<span class="badge" style="background:#2563eb22;color:#2563eb">${esc(it.st)}</span>` : ''}
            <span style="margin-left:auto"></span>
            <a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(it.fone)}">💬 WhatsApp</a>
          </div>
          <div class="tiny muted" style="margin-top:3px">${esc(it.deal_nome || '')}</div>
          <div class="flex" style="gap:5px;flex-wrap:wrap;margin-top:6px">
            ${ST.map(([id, lbl, cor]) => `<button class="btn btn-ghost btn-sm pt-st" data-deal="${esc(it.deal_id)}" data-st="${id}" style="padding:2px 8px;color:${cor}">${lbl}</button>`).join('')}
          </div>
        </div>`).join('') || '<div class="card">🎉 Lote do dia zerado — todos tratados. Amanhã a fila renova.</div>'}
    </div>`;
  _root.querySelector('#pt-reload').onclick = reload;
  _root.querySelector('#pt-view').onclick = () => { _view = _view === 'fila' ? 'todos' : 'fila'; reload(); };
  _root.querySelectorAll('.pt-st').forEach(b => b.onclick = async () => {
    if (_busy) return;
    _busy = true;
    let nota = null;
    if (['proposta', 'negociando', 'perdeu', 'futuro'].includes(b.dataset.st)) nota = prompt('Nota rápida (opcional):') || '';
    try {
      await api.request('/api/v3/crm/ponte', { method: 'POST', body: { action: 'set_status', deal_id: b.dataset.deal, st: b.dataset.st, nota } });
    } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
    _busy = false;
    reload();
  });
}
