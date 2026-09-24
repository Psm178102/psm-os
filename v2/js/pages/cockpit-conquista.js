/* ============================================================================
   PSM-OS v2 — Cockpit Conquista  v81.44
   ----------------------------------------------------------------------------
   A "home" do corretor Conquista: num lugar só, o pipeline ponderado, a meta do
   mês, os leads pra atacar (com próxima ação), a leitura POR FAIXA DE RENDA dos
   negócios em foco e os atalhos do dia (Simulador, Cérebro, Comissão, Captação).
   Dado real do sales_brain (escopado ao corretor). Faixa = bucket por valor do
   negócio (referência MCMV). Gated em sócio por enquanto (ROUTE_MIN_LVL=10).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { montarDecisoes } from '../decisoes.js';   // v87.92 🧭 Decidir agora

const BRL = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });   // v88.37: sempre com centavos
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// teto de valor de imóvel por faixa MCMV (referência — varia por região)
const FAIXA_TETO = [
  { nome: 'Faixa 1', teto: 200000, cor: '#16a34a' },
  { nome: 'Faixa 2', teto: 264000, cor: '#0ea5e9' },
  { nome: 'Faixa 3', teto: 350000, cor: '#f59e0b' },
  { nome: 'Faixa 4', teto: 500000, cor: '#8b5cf6' },
  { nome: 'Acima MCMV', teto: Infinity, cor: '#64748b' },
];
const PJ_STATUS = { batida: ['meta batida', '#16a34a'], no_ritmo: ['vai bater', '#16a34a'], atras: ['atrás', '#d97706'], fora: ['fora do ritmo', '#dc2626'], sem_meta: ['sem meta', '#64748b'] };
const fN1 = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const faixaDeValor = v => (FAIXA_TETO.find(f => v <= f.teto) || FAIXA_TETO[FAIXA_TETO.length - 1]);

let _root = null, _list = [], _brain = null, _selId = '', _isGestor = false, _me = {}, _stamp = '', _avisos = [];
const loadingCard = msg => `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${esc(msg)} <span class="tiny" style="opacity:.65">— analisando o funil, pode levar alguns segundos</span></div></div>`;

export async function pageCockpitConquista(ctx, root) {
  _root = root;
  _me = auth.user() || {};
  _isGestor = (_me.lvl || 0) >= 7;
  root.innerHTML = loadingCard('Montando seu cockpit…');
  try {
    if (_isGestor) {
      const l = await api.request('/api/v3/intel/sales_brain?list=1');   // lista instantânea
      _list = (l && l.corretores) || [];
      if (!_list.length) { renderShell(null); return; }
      _selId = _list[0].id;
    } else {
      _selId = _me.id || '';
    }
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro ao montar o cockpit: ${esc(e.message)}</div>`;
    return;
  }
  await loadBrain();
}

async function loadBrain(fresh) {
  _root.innerHTML = loadingCard('Carregando seu pipeline…');
  try {
    if (fresh) { try { await api.request('/api/v3/crm/sync_if_stale?hours=0'); } catch (_) {} }   // v87.86: 🔄 renova a FONTE
    const r = await api.request('/api/v3/intel/sales_brain?corretor_id=' + encodeURIComponent(_selId) + (fresh ? '&fresh=1' : ''));
    const arr = (r && r.corretores) || [];
    _stamp = (r && r.dados_de_hhmm) || ''; _avisos = (r && r.avisos_dicionario) || [];
    _brain = arr.find(c => c.id === _selId) || arr[0] || null;
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return;
  }
  renderShell(_brain);
}

const ATALHOS = [
  { nav: '/sim-conquista', ic: '🏠', lbl: 'Simulador Conquista', sub: 'Renda → faixa, imóvel, parcela' },
  { nav: '/meu-cerebro', ic: '🎯', lbl: 'Meu Cérebro', sub: 'Quem atacar primeiro' },
  { nav: '/minha-comissao', ic: '💰', lbl: 'Minha Comissão', sub: 'Pago e a receber' },
  { nav: '/captacoes', ic: '📥', lbl: 'Captações', sub: 'Seu funil de entrada' },
  { nav: '/tabela-conquista', ic: '🏆', lbl: 'Tabela Conquista', sub: 'Lançamentos' },
  { nav: '/crm', ic: '🔗', lbl: 'CRM', sub: 'Seus negócios' },
];

function renderShell(c) {
  const hora = new Date().getHours();
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = (_me.name || _me.login || '').split(' ')[0];

  let kpis = '', faixa = '', leads = '';
  if (c) {
    const meta = c.meta_vgv_mes || 0;
    const pond = c.pipeline_ponderado_vgv || 0;
    const pj = c.projecao_mes;   // v87.95: projeção oficial do mês (a mesma da Gestão Comercial e do 1:1)
    const [pjLbl, pjCor] = PJ_STATUS[pj && pj.status] || ['', '#16a34a'];
    const atencao = (c.sem_contato_48h || 0) + (c.parados_14d || 0);
    kpis = `
      <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
        ${pj
          ? `<div class="card" style="padding:13px 15px;flex:1;min-width:160px;border-left:4px solid ${pjCor}" title="Provável = vendido + o maior entre seu ritmo dos últimos 180 dias e suas propostas abertas × taxa real proposta→venda. Pipeline ponderado (prioridade da fila): ${BRL(pond)}"><div class="tiny muted">📈 Provável do mês</div><div style="font-size:20px;font-weight:800;color:${pjCor}">${BRL(pj.provavel.vgv)}</div><div class="tiny muted">${fN1(pj.provavel.vendas)} vendas${pj.provavel.pct_meta != null ? ' · ' + fN1(pj.provavel.pct_meta) + '% da meta' : ''}${pjLbl ? ' · ' + pjLbl : ''}</div></div>`
          : `<div class="card" style="padding:13px 15px;flex:1;min-width:140px;border-left:4px solid #16a34a"><div class="tiny muted">💰 Pipeline ponderado</div><div style="font-size:20px;font-weight:800;color:var(--ok)">${BRL(pond)}</div><div class="tiny muted">prioridade da fila · projeção indisponível</div></div>`}
        <div class="card" style="padding:13px 15px;flex:1;min-width:120px;border-left:4px solid #ef4444"><div class="tiny muted">🔥 Quentes</div><div style="font-size:20px;font-weight:800;color:var(--err-suave)">${c.quentes || 0}</div></div>
        <div class="card" style="padding:13px 15px;flex:1;min-width:120px;border-left:4px solid #f59e0b"><div class="tiny muted">⚠️ Atenção</div><div style="font-size:20px;font-weight:800;color:#f59e0b">${atencao}</div><div class="tiny muted">sem contato + parados</div></div>
        <div class="card" style="padding:13px 15px;flex:1;min-width:140px"><div class="tiny muted">🎯 Meta VGV (mês)</div><div style="font-size:20px;font-weight:800">${meta ? BRL(meta) : '—'}</div>${pj && pj.falta_vgv ? `<div class="tiny muted">falta ${BRL(pj.falta_vgv)}${pj.por_dia_util_vgv ? ' · ' + BRL(pj.por_dia_util_vgv) + '/dia útil' : ''}</div>` : ''}</div>
        <div class="card" style="padding:13px 15px;flex:1;min-width:140px;border-left:4px solid #2563eb"><div class="tiny muted">✅ Vendido no mês</div><div style="font-size:20px;font-weight:800">${c.vendas_mes || 0} · ${BRL(c.vgv_mes || 0)}</div><div class="tiny muted">${c.atingimento_vgv_pct != null ? c.atingimento_vgv_pct + '% da meta' : 'sem meta'} · ${c.leads_mes || 0} leads · ${c.em_atendimento || 0} em atendimento</div></div>
      </div>
      ${_avisos.length ? `<div class="alert alert-warn tiny" style="margin:-6px 0 12px">${_avisos.map(esc).join('<br>')}</div>` : ''}`;

    // faixa de renda dos leads em foco (bucket por valor) — referência
    const buckets = {};
    (c.top_leads || []).forEach(l => { const f = faixaDeValor(l.amount || 0); buckets[f.nome] = buckets[f.nome] || { n: 0, vgv: 0, cor: f.cor }; buckets[f.nome].n++; buckets[f.nome].vgv += (l.amount || 0); });
    const bk = Object.entries(buckets);
    faixa = bk.length ? `
      <div class="card" style="padding:14px;margin-bottom:14px">
        <div style="font-weight:800;margin-bottom:8px">🏠 Leads em foco por faixa <span class="tiny muted">(referência por valor do negócio)</span></div>
        <div class="flex gap-2" style="flex-wrap:wrap">${bk.map(([nome, v]) => `<div style="flex:1;min-width:110px;background:${v.cor}14;border-radius:10px;padding:10px"><div style="font-weight:800;color:${v.cor};font-size:13px">${esc(nome)}</div><div style="font-size:18px;font-weight:800">${v.n}</div><div class="tiny muted">${BRL(v.vgv)}</div></div>`).join('')}</div>
      </div>` : '';

    const tl = (c.top_leads || []).slice(0, 5);
    leads = `
      <div class="card" style="padding:14px;margin-bottom:14px">
        <div class="flex items-center" style="justify-content:space-between;margin-bottom:8px"><div style="font-weight:800">🏹 Atacar primeiro</div><button class="btn btn-ghost btn-sm" onclick="location.hash='/meu-cerebro'">ver tudo →</button></div>
        ${!tl.length ? '<div class="tiny muted" style="padding:14px;text-align:center">Sem leads abertos.</div>' : tl.map(l => {
          const tc = l.temp === 'quente' ? '#ef4444' : l.temp === 'morno' ? '#f59e0b' : '#0ea5e9';
          return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--bd,#eef2f7)">
            <div style="min-width:0"><div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.title || 'Negócio')}</div><div class="tiny muted">${esc(l.stage_name || l.ms_label || '—')}${l.acao ? ' · ▶ ' + esc(l.acao) : ''}</div></div>
            <div style="text-align:right;white-space:nowrap"><div style="font-weight:800;color:${tc};font-size:13px">${Math.round((l.prob || 0) * 100)}%</div><div class="tiny muted">${BRL(l.amount || 0)}</div></div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    kpis = `<div class="card muted tiny" style="text-align:center;padding:24px;margin-bottom:14px">Sem funil vinculado ainda — os KPIs aparecem quando houver negócios no CRM. Os atalhos abaixo já funcionam.</div>`;
  }

  _root.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <div>
        <div style="font-size:22px;font-weight:800">🚀 ${saud}${nome ? ', ' + esc(nome) : ''}!</div>
        <div class="tiny muted">Seu cockpit Conquista — pipeline, meta e a fila de ataque do dia.${_stamp ? ` · dados de <b title="último sync do RD — o mesmo retrato em todas as telas">${esc(_stamp)}</b>` : ''}</div>
      </div>
      <div class="flex items-center gap-2">
        ${_isGestor && _list.length ? `<select id="ck-sel" class="select" style="max-width:240px">${_list.map(x => `<option value="${esc(x.id)}"${x.id === _selId ? ' selected' : ''}>${esc(x.name || x.id)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-ghost btn-sm" id="ck-fresh" title="sincroniza o RD agora e recalcula">🔄</button>
      </div>
    </div>
    <div id="ck-dec"></div>
    ${kpis}${faixa}${leads}
    <div style="font-weight:800;margin-bottom:8px">⚡ Atalhos do dia</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
      ${ATALHOS.map(a => `<button class="card" style="padding:14px;text-align:left;cursor:pointer;border:1px solid rgba(148,163,184,.18)" onclick="location.hash='${a.nav}'">
        <div style="font-size:24px">${a.ic}</div><div style="font-weight:800;margin-top:4px">${a.lbl}</div><div class="tiny muted">${a.sub}</div></button>`).join('')}
    </div>`;

  const sel = _root.querySelector('#ck-sel');
  if (sel) sel.onchange = () => { _selId = sel.value; loadBrain(); };
  const fb = _root.querySelector('#ck-fresh');
  if (fb) fb.onclick = () => loadBrain(true);
  montarDecisoes(_root.querySelector('#ck-dec'), { tela: 'cerebro', pessoa: _selId, titulo: _selId === _me.id ? '🧭 O que fazer agora no seu funil' : '🧭 O que fazer agora neste funil', max: 5 });
}
