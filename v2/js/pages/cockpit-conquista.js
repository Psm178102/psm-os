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

const BRL = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// teto de valor de imóvel por faixa MCMV (referência — varia por região)
const FAIXA_TETO = [
  { nome: 'Faixa 1', teto: 200000, cor: '#16a34a' },
  { nome: 'Faixa 2', teto: 264000, cor: '#0ea5e9' },
  { nome: 'Faixa 3', teto: 350000, cor: '#f59e0b' },
  { nome: 'Faixa 4', teto: 500000, cor: '#8b5cf6' },
  { nome: 'Acima MCMV', teto: Infinity, cor: '#64748b' },
];
const faixaDeValor = v => (FAIXA_TETO.find(f => v <= f.teto) || FAIXA_TETO[FAIXA_TETO.length - 1]);

let _root = null, _list = [], _brain = null, _selId = '', _isGestor = false, _me = {};
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

async function loadBrain() {
  _root.innerHTML = loadingCard('Carregando seu pipeline…');
  try {
    const r = await api.request('/api/v3/intel/sales_brain?corretor_id=' + encodeURIComponent(_selId));
    const arr = (r && r.corretores) || [];
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
    const atencao = (c.sem_contato_48h || 0) + (c.parados_14d || 0);
    kpis = `
      <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
        <div class="card" style="padding:13px 15px;flex:1;min-width:140px;border-left:4px solid #16a34a"><div class="tiny muted">💰 Pipeline ponderado</div><div style="font-size:20px;font-weight:800;color:#16a34a">${BRL(pond)}</div></div>
        <div class="card" style="padding:13px 15px;flex:1;min-width:120px;border-left:4px solid #ef4444"><div class="tiny muted">🔥 Quentes</div><div style="font-size:20px;font-weight:800;color:#ef4444">${c.quentes || 0}</div></div>
        <div class="card" style="padding:13px 15px;flex:1;min-width:120px;border-left:4px solid #f59e0b"><div class="tiny muted">⚠️ Atenção</div><div style="font-size:20px;font-weight:800;color:#f59e0b">${atencao}</div><div class="tiny muted">sem contato + parados</div></div>
        <div class="card" style="padding:13px 15px;flex:1;min-width:140px"><div class="tiny muted">🎯 Meta VGV (mês)</div><div style="font-size:20px;font-weight:800">${meta ? BRL(meta) : '—'}</div>${meta ? `<div class="tiny muted">ponderado = ${Math.round(pond / meta * 100)}% da meta</div>` : ''}</div>
      </div>`;

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
        <div class="tiny muted">Seu cockpit Conquista — pipeline, meta e a fila de ataque do dia.</div>
      </div>
      ${_isGestor && _list.length ? `<select id="ck-sel" class="select" style="max-width:240px">${_list.map(x => `<option value="${esc(x.id)}"${x.id === _selId ? ' selected' : ''}>${esc(x.name || x.id)}</option>`).join('')}</select>` : ''}
    </div>
    ${kpis}${faixa}${leads}
    <div style="font-weight:800;margin-bottom:8px">⚡ Atalhos do dia</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
      ${ATALHOS.map(a => `<button class="card" style="padding:14px;text-align:left;cursor:pointer;border:1px solid rgba(148,163,184,.18)" onclick="location.hash='${a.nav}'">
        <div style="font-size:24px">${a.ic}</div><div style="font-weight:800;margin-top:4px">${a.lbl}</div><div class="tiny muted">${a.sub}</div></button>`).join('')}
    </div>`;

  const sel = _root.querySelector('#ck-sel');
  if (sel) sel.onchange = () => { _selId = sel.value; loadBrain(); };
}
