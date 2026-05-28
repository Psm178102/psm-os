/* PSM-OS v2 — Prospecção SDR (funil CARTEIRA MAP do RD CRM) — Sprint 9.7
   Leire chama a carteira 1 a 1 no WhatsApp → SDR → tem imóvel (cria captação)
   ou não tem (90 dias). Follow-up dos parados no SDR. */
import { api } from '../api.js';

let _root = null;
let _data = null;
let _pipelineId = null;
let _dias = 2;
let _busy = false;

const COLS = [
  { key: 'ativo',   titulo: '📇 Fila p/ chamar', sub: 'Carteira ativa (mais antigos primeiro)', cor: '#0891b2' },
  { key: 'sdr',     titulo: '📞 SDR — em andamento', sub: 'Chamados, aguardando resposta', cor: '#2563eb' },
  { key: 'captar',  titulo: '🎯 Captar imóvel', sub: 'Tem imóvel pra vender/alugar', cor: '#16a34a' },
  { key: 'noventa', titulo: '🗓 90 dias', sub: 'Sem imóvel agora — reaborda em 3 meses', cor: '#64748b' },
];

const WA_MSG = 'Olá! Aqui é da PSM Imóveis. Tudo bem? Você tem algum imóvel para vender ou alugar?';

export async function pageSdr(ctx, root) {
  _root = root;
  await load();
}

async function load() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando carteira do RD…</div></div>';
  try {
    const qs = new URLSearchParams({ dias: String(_dias), ativo_limit: '60' });
    if (_pipelineId) qs.set('pipeline_id', _pipelineId);
    _data = await api.request('/api/v3/crm/sdr?' + qs.toString());
    if (!_data.ok) throw new Error(_data.error || 'erro');
    _pipelineId = _data.pipeline?.id || _pipelineId;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro ao carregar SDR: ${escapeHtml(e.message)}</div>
      ${e.message && e.message.includes('CARTEIRA MAP') ? '<div class="alert alert-warn mt-2">Rode o sync de funis do RD em <b>CRM</b> e tente de novo.</div>' : ''}`;
  }
}

function render() {
  const cols = _data.columns || {};
  const carteiras = _data.carteiras || [];
  const fup = _data.followup_count || 0;

  const sel = carteiras.length > 1
    ? `<select id="sdr-pipe" class="input" style="max-width:240px">
         ${carteiras.map(c => `<option value="${escapeHtml(c.id)}"${String(c.id) === String(_pipelineId) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
       </select>`
    : `<span class="chip">${escapeHtml(_data.pipeline?.name || 'CARTEIRA MAP')}</span>`;

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2 flex-wrap" style="justify-content:space-between">
        <div>
          <h2 class="card-title">📞 Prospecção SDR</h2>
          <p class="card-sub">Trabalhe a carteira: chame no WhatsApp → tem imóvel vira captação, não tem volta em 90 dias.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${sel}
          <label class="tiny muted flex items-center gap-1">Follow-up após
            <input id="sdr-dias" type="number" min="1" max="30" value="${_dias}" class="input" style="width:56px;padding:4px 6px">d</label>
          <button id="sdr-reload" class="btn btn-ghost">↻ Atualizar</button>
        </div>
      </div>
      ${fup > 0 ? `<div class="alert alert-warn mt-2">🔔 <b>${fup}</b> lead(s) no SDR parado(s) há ${_dias}+ dias — precisam de follow-up (estão no topo da coluna SDR).</div>` : ''}
      ${_data.errors ? `<div class="alert alert-err mt-2 tiny">Avisos RD: ${escapeHtml((_data.errors || []).join(' · '))}</div>` : ''}
    </div>

    <div class="sdr-board" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px">
      ${COLS.map(c => colHTML(c, cols[c.key] || { deals: [] })).join('')}
    </div>
  `;

  // eventos
  document.getElementById('sdr-reload')?.addEventListener('click', load);
  const dias = document.getElementById('sdr-dias');
  if (dias) dias.addEventListener('change', e => { _dias = Math.max(1, Math.min(30, parseInt(e.target.value) || 2)); load(); });
  const pipe = document.getElementById('sdr-pipe');
  if (pipe) pipe.addEventListener('change', e => { _pipelineId = e.target.value; load(); });

  _root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', onAction));
}

function colHTML(col, data) {
  const deals = data.deals || [];
  const extra = col.key === 'ativo' ? ` (próximos ${deals.length})` : ` (${deals.length})`;
  return `
    <div class="card" style="border-top:3px solid ${col.cor};padding:12px">
      <div style="margin-bottom:10px">
        <div style="font-weight:800;color:${col.cor}">${col.titulo}<span class="muted" style="font-weight:600">${extra}</span></div>
        <div class="tiny muted">${col.sub}</div>
      </div>
      <div style="display:grid;gap:8px;max-height:70vh;overflow-y:auto">
        ${deals.length ? deals.map(d => cardHTML(d, col.key)).join('') : '<div class="tiny muted" style="padding:8px">— vazio —</div>'}
      </div>
    </div>`;
}

function cardHTML(d, colKey) {
  const nome = escapeHtml(d.contato || d.name || 'Lead');
  const sub = d.contato && d.name && d.contato !== d.name ? `<div class="tiny muted">${escapeHtml(d.name)}</div>` : '';
  const owner = d.owner ? `<span class="tiny muted">👤 ${escapeHtml(d.owner.split(' ')[0])}</span>` : '';
  const parado = (d.dias_parado != null) ? `<span class="tiny ${d.needs_followup ? '' : 'muted'}" style="${d.needs_followup ? 'color:#dc2626;font-weight:700' : ''}">⏱ ${d.dias_parado}d</span>` : '';
  const fupBadge = d.needs_followup ? '<span class="chip" style="background:#fee2e2;color:#b91c1c;font-weight:700">FOLLOW-UP</span>' : '';

  // botões por coluna
  let actions = '';
  const dd = encodeURIComponent(JSON.stringify({ id: d.id, name: d.name, contato: d.contato, phone: d.phone, email: d.email }));
  const wa = waBtn(d);
  if (colKey === 'ativo') {
    actions = `${wa}<button class="btn btn-primary tiny" data-act="move" data-to="sdr" data-deal="${dd}">📞 Chamei → SDR</button>`;
  } else if (colKey === 'sdr') {
    actions = `${wa}
      <button class="btn btn-primary tiny" data-act="move" data-to="captar" data-deal="${dd}" style="background:#16a34a">✅ Tem imóvel</button>
      <button class="btn btn-ghost tiny" data-act="move" data-to="noventa" data-deal="${dd}">❌ Não tem</button>
      <button class="btn btn-ghost tiny" data-act="followup" data-deal="${dd}">📝 Follow-up</button>`;
  } else if (colKey === 'captar') {
    actions = `${wa}<a class="btn btn-ghost tiny" href="#/captacoes">→ Ver captações</a>`;
  } else {
    actions = `${wa}<button class="btn btn-ghost tiny" data-act="move" data-to="sdr" data-deal="${dd}">↩ Reabrir SDR</button>`;
  }

  return `
    <div class="sdr-card" style="border:1px solid var(--bd,#e5e7eb);border-radius:10px;padding:10px;background:var(--bg-1,#fff)">
      <div class="flex items-center gap-1 flex-wrap" style="justify-content:space-between">
        <b style="font-size:13px">${nome}</b>
        ${fupBadge}
      </div>
      ${sub}
      <div class="flex items-center gap-2 flex-wrap" style="margin:4px 0">${owner}${parado}</div>
      <div class="flex items-center gap-1 flex-wrap" style="margin-top:6px">${actions}</div>
    </div>`;
}

function waBtn(d) {
  const msg = encodeURIComponent(WA_MSG);
  if (d.phone) {
    return `<a class="btn btn-ghost tiny" target="_blank" rel="noopener" href="https://wa.me/${encodeURIComponent(d.phone)}?text=${msg}" style="color:#16a34a">💬 WhatsApp</a>`;
  }
  return `<button class="btn btn-ghost tiny" data-act="wa" data-id="${escapeHtml(d.id)}">💬 Buscar contato</button>`;
}

async function onAction(ev) {
  if (_busy) return;
  const btn = ev.currentTarget;
  const act = btn.dataset.act;

  if (act === 'wa') {
    btn.textContent = '…';
    try {
      const r = await api.request('/api/v3/crm/sdr?deal_id=' + encodeURIComponent(btn.dataset.id));
      const ph = r.deal?.phone;
      if (ph) window.open(`https://wa.me/${encodeURIComponent(ph)}?text=${encodeURIComponent(WA_MSG)}`, '_blank', 'noopener');
      else { alert('Sem telefone cadastrado nesse lead no RD.'); btn.textContent = '💬 Buscar contato'; }
    } catch (e) { alert('Erro: ' + e.message); btn.textContent = '💬 Buscar contato'; }
    return;
  }

  const deal = JSON.parse(decodeURIComponent(btn.dataset.deal || '{}'));

  if (act === 'followup') {
    const note = prompt(`Registrar follow-up de "${deal.contato || deal.name || 'lead'}":\n(opcional — anote o que rolou)`);
    if (note === null) return;
    await post({ action: 'followup', deal_id: deal.id, deal_name: deal.name, pipeline_id: _pipelineId, kind: 'followup', note }, btn);
    return;
  }

  if (act === 'move') {
    const to = btn.dataset.to;
    if (to === 'captar' && !confirm(`Confirmar que "${deal.contato || deal.name}" TEM imóvel?\nVou mover pra "Captar imóvel" e criar a captação automática.`)) return;
    const r = await post({ action: 'move', deal_id: deal.id, to, pipeline_id: _pipelineId,
                           deal_name: deal.name, contato: deal.contato, phone: deal.phone, email: deal.email }, btn);
    if (r && r.ok && r.captacao_id) {
      // feedback rápido
      toast('✅ Captação criada! Veja no Kanban de Captações.');
    }
  }
}

async function post(body, btn) {
  _busy = true;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await api.request('/api/v3/crm/sdr', { method: 'POST', body });
    if (!r.ok) throw new Error(r.error || 'falha');
    await load();
    return r;
  } catch (e) {
    alert('Erro: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    return null;
  } finally {
    _busy = false;
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:12px 20px;border-radius:10px;font-weight:700;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,.25)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
