/* ============================================================================
   PSM-OS v2 — Meu Cérebro de Vendas  v81.44 (perf v81.47)
   ----------------------------------------------------------------------------
   O Cérebro de Vendas (lead-scoring + próxima ação) ESCOPADO ao corretor: ele
   acorda sabendo quem atacar primeiro. Reusa /api/v3/intel/sales_brain.
   • Corretor → pede só o SEU funil (?corretor_id=ele) — rápido.
   • Gestor/sócio (lvl>=7) → ?list=1 (lista instantânea) p/ o seletor, e busca o
     cérebro do corretor escolhido sob demanda (também escopado = rápido).
   Gated em sócio por enquanto (ROUTE_MIN_LVL=10). Obs: o backend sales_brain
   exige lvl>=5 — ao abrir pro corretor, baixar esse gate p/ o escopo próprio.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const BRL = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const TEMP = { quente: { c: '#ef4444', e: '🔥', l: 'Quente' }, morno: { c: '#f59e0b', e: '🟡', l: 'Morno' }, frio: { c: '#0ea5e9', e: '🧊', l: 'Frio' } };
const loadingCard = msg => `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${esc(msg)} <span class="tiny" style="opacity:.65">— analisando o funil, pode levar alguns segundos</span></div></div>`;
const emptyCard = () => `<div class="card muted tiny" style="text-align:center;padding:40px">Sem funil pra analisar (nenhum negócio aberto vinculado). Quando houver deals no CRM, a fila de ataque aparece aqui.</div>`;

let _root = null, _list = [], _brain = null, _selId = '', _isGestor = false, _me = {};

export async function pageMeuCerebro(ctx, root) {
  _root = root;
  _me = auth.user() || {};
  _isGestor = (_me.lvl || 0) >= 7;
  root.innerHTML = loadingCard('Montando seu cérebro de vendas…');
  try {
    if (_isGestor) {
      const l = await api.request('/api/v3/intel/sales_brain?list=1');   // instantâneo
      _list = (l && l.corretores) || [];
      if (!_list.length) { root.innerHTML = emptyCard(); return; }
      _selId = _list[0].id;
    } else {
      _selId = _me.id || '';
    }
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  await loadBrain();
}

async function loadBrain() {
  _root.innerHTML = loadingCard('Pensando no funil…');
  try {
    const r = await api.request('/api/v3/intel/sales_brain?corretor_id=' + encodeURIComponent(_selId));
    const arr = (r && r.corretores) || [];
    _brain = arr.find(c => c.id === _selId) || arr[0] || null;
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  render();
}

function render() {
  const c = _brain;
  if (!c) { _root.innerHTML = emptyCard(); return; }
  const leads = c.top_leads || [];
  const semContato = c.sem_contato_48h || 0, parados = c.parados_14d || 0;

  _root.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <div>
        <div style="font-size:21px;font-weight:800">🎯 Meu Cérebro de Vendas</div>
        <div class="tiny muted">Quem atacar primeiro, o que está esfriando e a próxima ação de cada lead.</div>
      </div>
      ${_isGestor ? `<select id="cb-sel" class="select" style="max-width:260px">${_list.map(x => `<option value="${esc(x.id)}"${x.id === _selId ? ' selected' : ''}>${esc(x.name || x.id)}${x.team ? ' · ' + esc(x.team) : ''}</option>`).join('')}</select>` : ''}
    </div>

    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="card" style="padding:12px 14px;flex:1;min-width:110px;border-left:4px solid #ef4444"><div class="tiny muted">🔥 Quentes</div><div style="font-size:21px;font-weight:800;color:#ef4444">${c.quentes || 0}</div></div>
      <div class="card" style="padding:12px 14px;flex:1;min-width:110px;border-left:4px solid #f59e0b"><div class="tiny muted">🟡 Mornos</div><div style="font-size:21px;font-weight:800;color:#f59e0b">${c.mornos || 0}</div></div>
      <div class="card" style="padding:12px 14px;flex:1;min-width:110px;border-left:4px solid #0ea5e9"><div class="tiny muted">🧊 Frios</div><div style="font-size:21px;font-weight:800;color:#0ea5e9">${c.frios || 0}</div></div>
      <div class="card" style="padding:12px 14px;flex:1;min-width:130px"><div class="tiny muted">💰 Pipeline ponderado</div><div style="font-size:19px;font-weight:800">${BRL(c.pipeline_ponderado_vgv || 0)}</div></div>
    </div>

    ${(semContato || parados) ? `<div class="card" style="padding:12px 14px;margin-bottom:14px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.25)">
      <div style="font-weight:800;color:#b91c1c;margin-bottom:2px">⚠️ Atenção imediata</div>
      <div class="tiny">${semContato ? `<b>${semContato}</b> sem 1º contato (>48h)` : ''}${semContato && parados ? ' · ' : ''}${parados ? `<b>${parados}</b> parados (>14 dias)` : ''} — perde-se venda aqui. Reaja primeiro nestes.</div>
    </div>` : ''}

    <div style="font-weight:800;margin-bottom:8px">🏹 Atacar primeiro (top ${leads.length})</div>
    ${!leads.length
      ? `<div class="card muted tiny" style="text-align:center;padding:30px">Nenhum lead aberto neste funil.</div>`
      : `<div style="display:grid;gap:10px">${leads.map(leadCard).join('')}</div>`}

    <div class="tiny muted" style="margin-top:12px">Score = prior da etapa × taxa real do canal × recência × engajamento. Estimativa calibrada (não é modelo treinado). Fonte: deals do CRM.</div>`;

  const sel = _root.querySelector('#cb-sel');
  if (sel) sel.onchange = () => { _selId = sel.value; loadBrain(); };
}

function leadCard(l) {
  const t = TEMP[l.temp] || { c: '#64748b', e: '•', l: l.temp || '—' };
  const parado = (l.dias_parado || 0);
  const etapa = l.stage_name || l.ms_label || '—';
  return `
    <div class="card" style="padding:12px 14px;border-left:4px solid ${t.c}">
      <div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="font-weight:800;font-size:14px">${esc(l.title || 'Negócio')}</div>
        <span class="tiny" style="font-weight:800;color:${t.c}">${t.e} ${t.l} · ${Math.round((l.prob || 0) * 100)}%</span>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap;margin:6px 0">
        <span class="tiny" style="background:var(--bg-3,#f1f5f9);padding:2px 8px;border-radius:99px">📍 ${esc(etapa)}</span>
        <span class="tiny" style="background:var(--bg-3,#f1f5f9);padding:2px 8px;border-radius:99px">💰 ${BRL(l.amount || 0)}</span>
        ${l.canal ? `<span class="tiny" style="background:var(--bg-3,#f1f5f9);padding:2px 8px;border-radius:99px">📡 ${esc(l.canal)}</span>` : ''}
        <span class="tiny" style="background:${parado > 14 ? 'rgba(239,68,68,.14)' : 'var(--bg-3,#f1f5f9)'};color:${parado > 14 ? '#b91c1c' : 'inherit'};padding:2px 8px;border-radius:99px">⏱ ${parado}d parado</span>
      </div>
      ${l.acao ? `<div style="background:rgba(16,185,129,.10);border-radius:8px;padding:8px 10px;font-size:13px"><b style="color:#047857">▶ Próxima ação:</b> ${esc(l.acao)}</div>` : ''}
    </div>`;
}
