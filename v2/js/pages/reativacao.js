/* PSM-OS v2 — 🔁 Fila de Reativação MAP (v84.2)
   A base parada do CRM vira fila diária pra Mariane: WhatsApp 1-a-1 (método fila,
   não toma bloqueio) ou ligação → qualifica → "agendou visita" → sócio fecha.
   Backend: /api/v3/crm/reativacao (deals do RD sync + estado em shared_kv). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _busy = false, _view = 'fila', _cfgOpen = false;

const ST_LBL = {
  novo: ['🆕', 'Novo'], contatado: ['💬', 'Contatado'], respondeu: ['✅', 'Respondeu'],
  agendou: ['📅', 'Agendou visita'], sem_interesse: ['❌', 'Sem interesse'],
  futuro: ['⏳', 'Futuro'], nao_atendeu: ['📵', 'Não atendeu'],
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function pageReativacao(ctx, root) {
  _root = root;
  await reload();
}

async function reload() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Montando a fila de reativação…</div></div>';
  try { _d = await api.request('/api/v3/crm/reativacao?view=' + _view); }
  catch (e) { _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`; return; }
  render();
}

function waLink(it) {
  if (!it.fone) return null;
  const tpl = (_d.cfg?.template || '').replaceAll('{nome}', (it.nome || '').split(' ')[0] || 'tudo bem');
  return `https://wa.me/${it.fone}?text=${encodeURIComponent(tpl)}`;
}

function statChip(k, v, cor) {
  const [ico, lbl] = ST_LBL[k] || ['·', k];
  return `<div style="flex:1;min-width:104px;background:var(--bg-3);border-radius:10px;padding:8px 10px;border-left:3px solid ${cor}">
    <div class="tiny muted">${ico} ${lbl}</div><div style="font-size:18px;font-weight:900">${v}</div></div>`;
}

function card(it, naFila) {
  const wa = waLink(it);
  const stBtns = ['contatado', 'respondeu', 'agendou', 'nao_atendeu', 'sem_interesse', 'futuro']
    .map(s => `<button class="btn btn-ghost btn-sm rv-st" data-id="${it.deal_id}" data-st="${s}" title="${ST_LBL[s][1]}" style="padding:2px 7px;font-size:12px">${ST_LBL[s][0]}</button>`).join('');
  const [ico, lbl] = ST_LBL[it.st] || ST_LBL.novo;
  return `<div class="card" style="margin:0 0 8px;padding:10px 12px">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b style="font-size:13.5px">${esc(it.nome)}</b>
      <span class="tiny muted">${esc(it.etapa || '')} · ${esc((it.funil || '').replace('FUNIL ', ''))}</span>
      <span class="badge" style="background:${(it.dias_parado || 0) > 180 ? '#dc262622' : '#d9770622'};font-weight:700">⏱ ${it.dias_parado ?? '?'}d parado</span>
      ${it.st !== 'novo' ? `<span class="tiny" style="font-weight:700">${ico} ${lbl}</span>` : ''}
      <span style="margin-left:auto"></span>
      ${wa ? `<a class="btn btn-primary btn-sm rv-wa" data-id="${it.deal_id}" href="${wa}" target="_blank" rel="noopener" style="padding:3px 10px">💬 WhatsApp</a>` : '<span class="tiny muted">sem fone</span>'}
      ${it.fone ? `<a class="btn btn-ghost btn-sm" href="tel:+${it.fone}" style="padding:3px 8px">📞</a>` : ''}
    </div>
    <div class="flex items-center mt-1" style="gap:6px;flex-wrap:wrap">
      <span class="tiny muted">Marcar:</span>${stBtns}
      <input class="input rv-nota" data-id="${it.deal_id}" placeholder="nota (opcional)" value="${esc(it.nota || '')}" style="flex:1;min-width:140px;padding:3px 7px;font-size:11.5px">
      ${it.corretor ? `<span class="tiny muted" title="corretor original">👤 ${esc(it.corretor.split('@')[0])}</span>` : ''}
    </div>
  </div>`;
}

function render() {
  const s = _d.stats || {};
  const me = auth.user();
  const canCfg = (me?.lvl || 0) >= 7;
  const contactRate = s.base ? (((s.respondeu || 0) + (s.agendou || 0)) / Math.max(1, s.base - (s.novo || 0)) * 100) : 0;
  const fila = _d.fila || [];
  const quentes = _d.trabalhados || [];
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🔁 Reativação MAP</h2>
        <span class="tiny muted">base parada do CRM → fila diária → visita agendada → sócio fecha</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-ghost btn-sm" id="rv-view">${_view === 'fila' ? '👁 Ver base inteira' : '🎯 Ver só o lote do dia'}</button>
        ${canCfg ? `<button class="btn btn-ghost btn-sm" id="rv-cfg">⚙ Config</button>` : ''}
        <button class="btn btn-ghost btn-sm" id="rv-reload">↻</button>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:104px;background:var(--psm-navy);color:#fff;border-radius:10px;padding:8px 10px"><div class="tiny" style="opacity:.8">📦 Base parada</div><div style="font-size:18px;font-weight:900">${s.base || 0}</div></div>
        ${statChip('novo', s.novo || 0, '#64748b')}
        ${statChip('contatado', s.contatado || 0, '#2563eb')}
        ${statChip('respondeu', s.respondeu || 0, '#0891b2')}
        ${statChip('agendou', s.agendou || 0, '#16a34a')}
        ${statChip('sem_interesse', s.sem_interesse || 0, '#dc2626')}
        ${statChip('futuro', s.futuro || 0, '#d97706')}
      </div>
      <div class="tiny muted mt-1">Taxa de resposta dos trabalhados: <b>${contactRate.toFixed(0)}%</b> · Lote: <b>${_d.cfg?.lote}</b>/dia · Parado há <b>${_d.cfg?.dias_min}+ dias</b> · O botão 💬 abre o WhatsApp com a mensagem pronta personalizada — 1 a 1, do jeito que não toma bloqueio.</div>
      ${_cfgOpen && canCfg ? cfgBox() : ''}
      ${(s.agendou || 0) > 0 ? `<div class="alert mt-2" style="background:#16a34a18;border:1px solid #16a34a44;font-size:12.5px">📅 <b>${s.agendou} visita(s) agendada(s)</b> — hora do sócio fechar. Detalhe na lista "quentes" abaixo.</div>` : ''}
    </div>
    <div class="card" style="margin-top:12px">
      <h3 class="card-title">🎯 ${_view === 'fila' ? `Lote do dia (${fila.length})` : `Base inteira (${fila.length} a trabalhar)`} <span class="tiny muted" style="font-weight:400">· mais parados primeiro</span></h3>
      ${fila.map(it => card(it, true)).join('') || '<div class="tiny muted" style="padding:10px">🎉 Nada na fila — ou a base foi toda trabalhada, ou afrouxe o filtro de dias na Config.</div>'}
    </div>
    ${quentes.length ? `<div class="card" style="margin-top:12px">
      <h3 class="card-title">🔥 Quentes (responderam/agendaram)</h3>
      ${quentes.map(it => card(it, false)).join('')}
    </div>` : ''}`;
  wire();
}

function cfgBox() {
  const c = _d.cfg || {};
  return `<div class="card mt-2" style="background:var(--bg-3)">
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:end">
      <label class="tiny muted" style="display:flex;flex-direction:column;gap:2px">Lote/dia<input id="cfg-lote" class="input" value="${c.lote || 40}" style="width:80px"></label>
      <label class="tiny muted" style="display:flex;flex-direction:column;gap:2px">Parado há (dias mín.)<input id="cfg-dias" class="input" value="${c.dias_min || 30}" style="width:100px"></label>
      <button class="btn btn-primary btn-sm" id="cfg-save">💾 Salvar</button>
    </div>
    <label class="tiny muted mt-2" style="display:block">Mensagem do WhatsApp (use {nome}):
      <textarea id="cfg-tpl" class="input" rows="3" style="width:100%;font-size:12px;margin-top:3px">${esc(c.template || '')}</textarea>
    </label>
  </div>`;
}

function wire() {
  document.getElementById('rv-reload')?.addEventListener('click', reload);
  document.getElementById('rv-view')?.addEventListener('click', () => { _view = _view === 'fila' ? 'todos' : 'fila'; reload(); });
  document.getElementById('rv-cfg')?.addEventListener('click', () => { _cfgOpen = !_cfgOpen; render(); });
  document.getElementById('cfg-save')?.addEventListener('click', async () => {
    try {
      const r = await api.request('/api/v3/crm/reativacao', { method: 'POST', body: { action: 'set_cfg', lote: document.getElementById('cfg-lote').value, dias_min: document.getElementById('cfg-dias').value, template: document.getElementById('cfg-tpl').value } });
      if (r && r.cfg) { _cfgOpen = false; await reload(); }
    } catch (e) { alert('⚠️ ' + e.message); }
  });
  // clicar no WhatsApp já marca "contatado" (sem clique extra pra Mariane)
  document.querySelectorAll('.rv-wa').forEach(a => a.addEventListener('click', () => setStatus(a.dataset.id, 'contatado', null, true)));
  document.querySelectorAll('.rv-st').forEach(b => b.addEventListener('click', () => {
    const nota = document.querySelector(`.rv-nota[data-id="${b.dataset.id}"]`)?.value || '';
    setStatus(b.dataset.id, b.dataset.st, nota);
  }));
}

async function setStatus(dealId, st, nota, silencioso) {
  if (_busy) return; _busy = true;
  try {
    await api.request('/api/v3/crm/reativacao', { method: 'POST', body: { action: 'set_status', deal_id: dealId, st, nota } });
    if (!silencioso) await reload();
    else {
      // atualização otimista local (não recarrega a fila no meio do trabalho dela)
      const it = (_d.fila || []).concat(_d.trabalhados || []).find(x => String(x.deal_id) === String(dealId));
      if (it && it.st === 'novo') it.st = st;
    }
  } catch (e) { alert('⚠️ ' + e.message); }
  finally { _busy = false; }
}
