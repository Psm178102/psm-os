/* PSM-OS v2 — 🧲 CRM House PSM (v86.52) · piloto F2 do CRM próprio
   O kanban NATIVO: deals do espelho local, mover card grava deal_stage_events
   (source='house') e empurra pro RD por paridade enquanto ele for o primário.
   Blueprint: funil por etapas do RD ao vivo, escopo por papel no backend,
   drag por Pointer Events (funciona no celular — kanban-drag.js).
   Backend: /api/v3/crm/house */
import { api } from '../api.js';
import { ativarDrag } from '../kanban-drag.js';

let _host = null, _d = null, _busy = false, _busca = '', _showMax = {};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const brlK = n => {
  n = Number(n || 0);
  if (n >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
  if (n >= 1e3) return 'R$ ' + Math.round(n / 1e3).toLocaleString('pt-BR') + 'k';
  return brl(n);
};
const POR_COL = 40; // cards visíveis por coluna antes do "mostrar mais"

const diasDesde = iso => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d >= 0 ? d : null;
};

export async function pageCrmHouse(ctx, root) {
  _host = root;
  const salvo = localStorage.getItem('crmhouse_pipeline') || '';
  await reload(salvo);
}

async function reload(pipelineId) {
  if (!_host) return;
  _host.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando o CRM House…</div></div>';
  try {
    const q = pipelineId ? `?pipeline_id=${encodeURIComponent(pipelineId)}` : '';
    _d = await api.request('/api/v3/crm/house' + q);
  } catch (e) {
    _host.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  if (_d.pipeline_id) localStorage.setItem('crmhouse_pipeline', _d.pipeline_id);
  _showMax = {};
  render();
}

function cardHtml(c) {
  const dp = diasDesde(c.updated_at);
  const quieto = dp !== null && dp >= 7;
  const dono = (c.user_email || '').split('@')[0];
  return `<div class="ch-card" data-id="${esc(c.id)}"
    style="background:var(--bg-2);border:1px solid var(--bd,#e2e8f0);border-radius:10px;padding:8px 10px;margin-bottom:6px;cursor:grab">
    <div class="flex items-center" style="gap:6px">
      <b style="font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name || '(sem nome)')}</b>
      ${c.phone ? `<a class="tiny" href="https://wa.me/55${esc(c.phone)}" target="_blank" rel="noopener" title="Abrir WhatsApp" onclick="event.stopPropagation()">💬</a>` : ''}
    </div>
    <div class="flex" style="gap:4px;flex-wrap:wrap;margin-top:3px;align-items:center">
      ${Number(c.amount) ? `<span class="tiny" style="color:#d97706;font-weight:800">💼 ${brl(c.amount)}</span>` : '<span class="tiny muted">sem valor</span>'}
      ${quieto ? `<span class="tiny" style="background:#64748b1a;color:#64748b;padding:0 7px;border-radius:999px;font-weight:700">😴 ${dp}d</span>` : ''}
      ${dono ? `<span class="tiny muted" style="margin-left:auto">👔 ${esc(dono)}</span>` : ''}
    </div>
  </div>`;
}

function render() {
  const stages = _d.stages || [];
  const cols = _d.cols || {};
  const soltos = _d.soltos || [];
  const meta = _d.meta || {};
  const q = _busca.toLowerCase();
  const filtra = l => q ? l.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.user_email || '').toLowerCase().includes(q)) : l;

  const colHtml = (s) => {
    const lista = filtra(cols[s.id] || []);
    const max = _showMax[s.id] || POR_COL;
    const soma = lista.reduce((a, c) => a + Number(c.amount || 0), 0);
    return `<div class="ch-col" data-stage="${esc(s.id)}"
      style="min-width:250px;width:250px;flex:0 0 auto;background:var(--bg-1,#f8fafc);border:1px solid var(--bd,#e2e8f0);border-radius:12px;padding:8px;display:flex;flex-direction:column;max-height:72vh">
      <div style="padding:2px 4px 8px">
        <div class="flex items-center" style="gap:6px">
          <b style="font-size:13px;flex:1">${esc(s.name)}</b>
          <span class="tiny muted">${lista.length}</span>
        </div>
        ${soma ? `<div class="tiny" style="color:#d97706;font-weight:700">${brlK(soma)}</div>` : ''}
      </div>
      <div style="overflow-y:auto;flex:1;min-height:40px">
        ${lista.slice(0, max).map(cardHtml).join('') || '<div class="tiny muted" style="text-align:center;padding:14px 0">vazio</div>'}
        ${lista.length > max ? `<button class="btn btn-sm btn-ghost ch-mais" data-stage="${esc(s.id)}" style="width:100%">+ ${lista.length - max} mais</button>` : ''}
      </div>
    </div>`;
  };

  _host.innerHTML = `
    <div class="card" style="padding:10px 12px">
      <div class="flex items-center" style="gap:6px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0;font-size:16px">🧲 CRM House PSM</h2>
        <span class="tiny" style="background:#0f5c431a;color:#0f5c43;padding:0 8px;border-radius:999px;font-weight:800">PILOTO F2</span>
        <span class="tiny muted">mover card grava evento nativo + sincroniza o RD</span>
        <span style="margin-left:auto"></span>
        <input id="ch-busca" class="input input-sm" placeholder="🔎 nome, fone, corretor" value="${esc(_busca)}" style="width:180px">
        <button class="btn btn-sm btn-ghost" id="ch-reload" title="Atualizar">🔄</button>
      </div>
      <div class="flex" style="gap:4px;flex-wrap:wrap;margin-top:8px;border-bottom:1px solid var(--bd,#e2e8f0);padding-bottom:6px">
        ${(_d.pipelines || []).map(p => `<button class="btn btn-sm ${p.id === _d.pipeline_id ? 'btn-primary' : 'btn-ghost'} ch-pipe" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
      </div>
      <div class="tiny muted" style="margin-top:6px">
        ${meta.total ?? 0} deals abertos · escopo: ${esc(meta.scope || '?')} · colunas: ${meta.stages_src === 'rd_live' ? 'RD ao vivo' : 'espelho'}
        ${soltos.length ? ` · ⚠️ ${soltos.length} deal(s) em etapa desconhecida` : ''}
      </div>
    </div>
    <div id="ch-board" class="flex" style="gap:10px;overflow-x:auto;align-items:flex-start;padding:10px 2px 20px">
      ${stages.map(colHtml).join('') || '<div class="card muted">Nenhuma etapa encontrada nesse funil.</div>'}
    </div>`;

  // ── eventos ──
  _host.querySelector('#ch-reload').onclick = () => reload(_d.pipeline_id);
  _host.querySelectorAll('.ch-pipe').forEach(b => { b.onclick = () => reload(b.dataset.id); });
  const busca = _host.querySelector('#ch-busca');
  let t = null;
  busca.oninput = () => { clearTimeout(t); t = setTimeout(() => { _busca = busca.value; render(); }, 250); };
  _host.querySelectorAll('.ch-mais').forEach(b => {
    b.onclick = () => { _showMax[b.dataset.stage] = (_showMax[b.dataset.stage] || POR_COL) + POR_COL; render(); };
  });

  ativarDrag({
    host: _host.querySelector('#ch-board'),
    card: '.ch-card',
    coluna: '.ch-col',
    colDe: el => el.dataset.stage,
    aoSoltar: (id, destino) => mover(id, destino),
    aoClicar: id => abrirCard(id),
  });
}

function achaCard(id) {
  for (const sid of Object.keys(_d.cols || {})) {
    const c = (_d.cols[sid] || []).find(x => x.id === id);
    if (c) return c;
  }
  return (_d.soltos || []).find(x => x.id === id) || null;
}

function tiraCard(dealId) {
  for (const l of [...Object.values(_d.cols || {}), _d.soltos || []]) {
    const i = l.findIndex(c => c.id === dealId);
    if (i >= 0) l.splice(i, 1);
  }
}

async function mover(dealId, toStageId) {
  const card = achaCard(dealId);
  if (!card || _busy) return;
  if (card.stage_id === toStageId) return;
  _busy = true;
  // otimista: move na tela já
  const origem = card.stage_id;
  tiraCard(dealId);
  card.stage_id = toStageId;
  (_d.cols[toStageId] = _d.cols[toStageId] || []).unshift(card);
  render();
  try {
    const r = await api.request('/api/v3/crm/house', {
      method: 'POST',
      body: { action: 'move', deal_id: dealId, to_stage_id: toStageId, to_stage_name: (_d.stages.find(s => s.id === toStageId) || {}).name },
    });
    if (r && r.moved && !r.rd_sync) {
      alert('⚠️ Movido no House, mas o RD não sincronizou (' + (r.rd_err || '?') + '). Se o RD continuar na etapa antiga, o card pode voltar no próximo sync.');
    }
  } catch (e) {
    alert('❌ NÃO MOVEU: ' + e.message);
    // desfaz
    tiraCard(dealId);
    card.stage_id = origem;
    (_d.cols[origem] = _d.cols[origem] || []).unshift(card);
    render();
  }
  _busy = false;
}

function abrirCard(id) {
  const c = achaCard(id);
  if (!c) return;
  const dp = diasDesde(c.updated_at);
  const atual = (_d.stages.find(s => s.id === c.stage_id) || {}).name || c.stage_id;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  wrap.innerHTML = `
    <div class="card" style="max-width:420px;width:100%;padding:16px" onclick="event.stopPropagation()">
      <div class="flex items-center" style="gap:8px">
        <h3 style="margin:0;flex:1;font-size:15px">${esc(c.name || '(sem nome)')}</h3>
        <button class="btn btn-sm btn-ghost" id="chm-x">✕</button>
      </div>
      <div class="tiny muted" style="margin-top:6px">📍 ${esc(atual)} ${dp !== null ? `· 😴 ${dp}d sem atualização` : ''}</div>
      <div style="margin-top:8px">${Number(c.amount) ? `<b style="color:#d97706">💼 ${brl(c.amount)}</b>` : '<span class="tiny muted">sem valor</span>'}</div>
      ${c.user_email ? `<div class="tiny" style="margin-top:4px">👔 ${esc(c.user_email)}</div>` : ''}
      <div class="flex" style="gap:6px;margin-top:12px;flex-wrap:wrap">
        ${c.phone ? `<a class="btn btn-sm btn-primary" href="https://wa.me/55${esc(c.phone)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
        <a class="btn btn-sm btn-ghost" href="https://crm.rdstation.com/app/deals/${esc(c.id)}" target="_blank" rel="noopener">🔗 abrir no RD</a>
      </div>
      <div style="margin-top:12px">
        <label class="tiny muted">Mover para:</label>
        <select id="chm-mv" class="input input-sm" style="width:100%;margin-top:4px">
          ${_d.stages.map(s => `<option value="${esc(s.id)}" ${s.id === c.stage_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>`;
  wrap.onclick = () => wrap.remove();
  wrap.querySelector('#chm-x').onclick = () => wrap.remove();
  wrap.querySelector('#chm-mv').onchange = async ev => {
    const dest = ev.target.value;
    wrap.remove();
    await mover(id, dest);
  };
  document.body.appendChild(wrap);
}
