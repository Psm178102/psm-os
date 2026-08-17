/* PSM-OS v2 — 📊 GESTÃO COMERCIAL (v86.33)
   Painel comercial por equipe/linha: Visão Geral (real × projetado × meta +
   métricas-chave com RÉGUA DE ALERTA) · Gráficos (tudo visual) · Fontes &
   Funil · Custo do Funil (R$/etapa + CAC) · Produtividade · Safras & Tempos
   (performance individual POR EQUIPE, só ativos). Todo quadro tem rodapé de
   análise do 🧠 Sr. Performance (Gemini). Gate lvl>=5; escopo por gestor. */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { loadChartLib } from '../premium.js';

let _root = null, _d = null, _tab = 'visao', _busy = false;
let _since = null, _until = null, _spendPreset = 'last_30d';
let _tv = false, _tvRotate = true, _tvTimer = null, _tvDataTimer = null, _tvTickTimer = null, _tvNextAt = 0;
const TV_ROT_MS = 20000, TV_REFRESH_MS = 300000;   // aba a cada 20s · dados a cada 5min

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fN = v => { const x = Number(v) || 0; return Number.isInteger(x) ? x.toLocaleString('pt-BR') : x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
const kR$ = v => { const n = Number(v) || 0, a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M'; if (a >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'; return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesNome = ym => { const m = parseInt(String(ym).slice(5, 7), 10); return MESES_NOME[m - 1] || ym; };
const fmtDHM = h => {   // horas → "00d 03h 27min" (formato exigido: duas casas em cada)
  if (h == null) return '—';
  const tot = Math.max(0, Math.round(h * 60)), d = Math.floor(tot / 1440), hh = Math.floor((tot % 1440) / 60), mm = tot % 60;
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d)}d ${p2(hh)}h ${p2(mm)}min`;
};
const TEAM_LBL = { conquista: '🏠 Conquista', map: '🏢 MAP', terceiros: '🤝 Terceiros', locacao: '🔑 Locação', outros: '— Outros' };

export async function pageGestaoComercial(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Gestão Comercial é para gestores, gerentes e sócios.</div>'; return; }
  if (!_until) {
    const h = new Date();
    const f = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    _until = f(h); _since = f(new Date(h.getTime() - 89 * 86400000));
  }
  await load();
}

async function load(fresh) {
  _busy = true;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Consolidando comercial (RD + HUB + Meta + Norte)… primeira leitura da janela pode levar ~30s.</div></div>';
  try {
    _d = await api.request(`/api/v3/oo/comercial?since=${_since}&until=${_until}&spend_preset=${_spendPreset}${fresh ? '&fresh=1' : ''}`);
    if (fresh) _srCache = {};
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message || e)}</div>`;
  } finally { _busy = false; }
}

function pan(title, inner, srId) {
  const sr = srId ? `<div class="gc-sr" data-sr="${srId}" style="margin-top:10px;border-top:1px dashed var(--border);padding-top:7px;font-size:12.5px;line-height:1.5">
      <span style="font-weight:800;white-space:nowrap">🧠 Sr. Performance:</span> <span class="gc-sr-txt" style="opacity:.7">analisando os números…</span></div>` : '';
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;margin-top:12px">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">${title}</div>${inner}${sr}</div>`;
}

function render() {
  const d = _d;
  const tabs = GC_TABS;
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">📊 Gestão Comercial</h2>
        ${d.escopo ? `<span class="tiny" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:999px;padding:2px 10px;font-weight:800">🔒 visão da equipe ${(TEAM_LBL[d.escopo] || d.escopo).replace(/^..\s/, '')}</span>` : ''}
        <span class="tiny muted">coorte de ${fN(d.coorte_n)} leads · origem preenchida em ${d.cobertura_origem_pct != null ? fN(d.cobertura_origem_pct) + '%' : '—'} · ${d.janela.since} → ${d.janela.until}</span>
        <span style="flex:1"></span>
        <select class="select" id="gc-preset" style="width:auto;padding:4px 8px;font-size:12px">
          <option value="">Período…</option>
          <option value="semana">Semana atual</option>
          <option value="quinzena">Quinzena (15d)</option>
          <option value="mes">Mês atual</option>
          <option value="90d">Últimos 90d</option>
          <option value="tri">Trimestre atual</option>
          <option value="sem">Semestre atual</option>
          <option value="ytd">Janeiro até hoje</option>
        </select>
        <input type="date" class="input" id="gc-since" value="${_since}" style="width:auto;padding:4px 8px;font-size:12px">
        <input type="date" class="input" id="gc-until" value="${_until}" style="width:auto;padding:4px 8px;font-size:12px">
        <button class="btn btn-ghost btn-sm" id="gc-aplicar">Aplicar</button>
        <button class="btn btn-ghost btn-sm" id="gc-fresh" title="ignora o cache de 10min">🔄</button>
        <button class="btn btn-sm" id="gc-tv" style="background:#0f172a;color:#fff;font-weight:800">📺 TV</button>
      </div>
      ${(d.avisos || []).length ? `<div class="alert alert-warn tiny" style="margin-top:8px">${d.avisos.map(esc).join('<br>')}</div>` : ''}
      <div class="flex gap-1" style="margin-top:10px;flex-wrap:wrap">
        ${tabs.map(([id, l]) => `<button class="btn ${_tab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-gct="${id}">${l}</button>`).join('')}
      </div>
      <div id="gc-body"></div>
    </div>`;
  _root.querySelectorAll('[data-gct]').forEach(b => b.onclick = () => { _tab = b.dataset.gct; render(); });
  _root.querySelector('#gc-aplicar').onclick = () => { _since = _root.querySelector('#gc-since').value; _until = _root.querySelector('#gc-until').value; load(); };
  _root.querySelector('#gc-fresh').onclick = () => load(true);
  _root.querySelector('#gc-tv').onclick = enterTV;
  _root.querySelector('#gc-preset').onchange = ev => {
    const h = new Date();
    const f = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const ini = { 
      semana: () => new Date(h.getTime() - ((h.getDay() + 6) % 7) * 86400000),
      quinzena: () => new Date(h.getTime() - 14 * 86400000),
      mes: () => new Date(h.getFullYear(), h.getMonth(), 1),
      '90d': () => new Date(h.getTime() - 89 * 86400000),
      tri: () => new Date(h.getFullYear(), Math.floor(h.getMonth() / 3) * 3, 1),
      sem: () => new Date(h.getFullYear(), h.getMonth() < 6 ? 0 : 6, 1),
      ytd: () => new Date(h.getFullYear(), 0, 1),
    }[ev.target.value];
    if (!ini) return;
    _since = f(ini()); _until = f(h);
    load();
  };
  const body = _root.querySelector('#gc-body');
  body.innerHTML = tabBody();
  postRender();
}

const GC_TABS = [['visao', '🎯 Visão Geral'], ['graficos', '📈 Gráficos'], ['funilrd', '⏬ Funil RD'], ['fontes', '🔀 Fontes & Funil'],
                 ['camp', '📣 Campanhas'], ['custos', '💰 Custo do Funil'], ['prod', '📊 Produtividade'], ['safras', '📈 Safras & Tempos']];
function tabBody() {
  return { visao: tabVisao, graficos: tabGraficos, funilrd: tabFunilRD, fontes: tabFontes, camp: tabCampanhas, custos: tabCustos, prod: tabProd, safras: tabSafras }[_tab]();
}

/* pós-render de cada aba: gráficos (Chart.js) + rodapés do 🧠 Sr. Performance */
function postRender() {
  if (_tab === 'graficos') initCharts();
  srPerformance();
}

/* ═══════════ 🧠 SR. PERFORMANCE — análise Gemini por quadro (v86.33) ═══════════ */
let _srCache = {};

function srPerformance() {
  const resumo = resumoTab();
  if (!Object.keys(resumo).length) return;
  const key = _tab + ':' + _since + ':' + _until + ':' + _spendPreset;
  const scope = () => (_tv ? document.getElementById('gc-tv-ov') : _root) || document;
  const fill = an => scope().querySelectorAll('.gc-sr').forEach(el => {
    const tx = el.querySelector('.gc-sr-txt');
    if (!tx) return;
    const t = an[el.dataset.sr];
    if (t) { tx.textContent = t; tx.style.opacity = '1'; }
    else tx.textContent = 'sem análise pra este quadro.';
  });
  if (_srCache[key]) return fill(_srCache[key]);
  api.request('/api/v3/oo/comercial_analise', { method: 'POST', body: { tab: _tab, janela: _d.janela, resumo } })
    .then(r => { _srCache[key] = r.analises || {}; fill(_srCache[key]); })
    .catch(e => scope().querySelectorAll('.gc-sr-txt').forEach(t => {
      t.textContent = 'análise indisponível agora (' + (e.message || 'erro') + ').';
    }));
}

/* resumo COMPACTO da aba atual → vira o prompt do Sr. Performance.
   As chaves têm que casar com os data-sr passados no 3º arg de pan(). */
function resumoTab() {
  const d = _d || {};
  const r = {};
  const histCompact = (d.historico || []).map(h => ({ mes: h.ym, parcial: !!h.parcial, leads: h.total?.leads, vendas: h.total?.vendas, vgv: h.total?.vgv, ticket: h.total?.ticket, spend: h.total?.spend, cac: h.total?.cac_global }));
  const eqProd = Object.entries((d.produtividade || {}).equipes || {}).map(([t, e]) => ({ equipe: TEAM_LBL[t] || t, ...e, canais: undefined }));
  if (_tab === 'visao') {
    r.metricas_chave = {
      alertas_fora_da_regua: ((d.alertas || {}).itens || []),
      equipes: ((d.custos || {}).equipes || []).map(c => ({ equipe: c.label, custo_lead: c.custo_lead ?? c.custo_lead_30d, custo_agend: c.custo_agend ?? c.custo_agend_30d, custo_visita: c.custo_visita ?? c.custo_visita_30d, custo_pasta: c.custo_pasta ?? c.custo_pasta_30d, cac_midia: c.cac_midia ?? c.cac_midia_30d, roas: c.roas, leads: c.leads, vendas: c.vendas })),
      razoes: eqProd,
    };
    r.real_meta = (d.visao || []).map(v => ({ equipe: v.label, vendas_real: v.real_vendas, meta: v.meta_vendas, proj_norte: v.proj_vendas, proj_ritmo: v.proj_ritmo, vgv_real: v.real_vgv, vgv_meta: v.meta_vgv, pipeline_aberto: v.pipeline_agora }));
    r.projecao_ponderada = d.forecast || {};
    r.historico_vendas = histCompact;
  } else if (_tab === 'graficos') {
    r.g_hist = { foco: 'vendas por equipe e VGV, mês a mês', dados: (d.historico || []).map(h => ({ mes: h.ym, equipes: h.equipes, vgv_total: h.total?.vgv })) };
    r.g_leads = { foco: 'leads × spend Meta, mês a mês', dados: histCompact };
    r.g_funil = { foco: 'funil da safra por equipe (leads→venda)', dados: eqProd };
    r.g_fontes = { foco: 'distribuição de leads e conversão por fonte', dados: ((d.fontes || {}).geral || []).slice(0, 10).map(f => ({ fonte: f.label, leads: f.leads, vendas: f.venda, pc_visita: f.pc_visita, pc_venda: f.pc_venda })) };
    r.g_safras = { foco: 'maturação das safras (conv até hoje)', dados: (d.safras || []) };
    r.g_custos = { foco: 'CAC mídia × CAC completo por equipe', dados: ((d.custos || {}).equipes || []).map(c => ({ equipe: c.label, spend: c.spend, cac_midia: c.cac_midia ?? c.cac_midia_30d, cac_completo: c.cac_completo ?? c.cac_completo_30d })) };
    r.g_camp = { foco: 'campanhas que mais venderam na safra', dados: ((d.campanhas || {}).itens || []).filter(x => x.venda > 0).slice(0, 10).map(x => ({ campanha: x.campanha, vendas: x.venda, vgv: x.vgv, spend: x.spend_30d, roas: x.roas })) };
  } else if (_tab === 'funilrd') {
    Object.entries(d.funil_rd || {}).forEach(([t, f]) => {
      r['funil_' + t] = { equipe: TEAM_LBL[t] || t, pipeline: f.pipeline, lanes: (f.lanes || []).map(l => ({ etapa: l.nome, abertos: l.abertos, alcancaram: l.alcancaram, passagem_pct: l.passagem_pct })) };
    });
  } else if (_tab === 'fontes') {
    r.podio_fontes = (d.fontes || {}).podio || {};
    r.fontes_geral = ((d.fontes || {}).geral || []).map(f => ({ fonte: f.label, leads: f.leads, agend: f.agend, visitas: f.visita, pastas: f.pasta, vendas: f.venda, pc_visita: f.pc_visita, pc_venda: f.pc_venda, vgv: f.vgv }));
    ['conquista', 'map', 'terceiros', 'locacao'].forEach(t => {
      if ((d.fontes || {})[t]?.length) r['fontes_' + t] = d.fontes[t].map(f => ({ fonte: f.label, leads: f.leads, vendas: f.venda, pc_venda: f.pc_venda }));
    });
    const canaisHist = (d.historico || []).map(h => ({ mes: h.ym, canais: h.canais }));
    if (canaisHist.length) { r.hist_fontes_leads = canaisHist; r.hist_fontes_vendas = canaisHist; }
  } else if (_tab === 'camp') {
    const its = ((d.campanhas || {}).itens || []).map(x => ({ campanha: x.campanha, ativa: x.ativa, leads: x.leads, visitas: x.visita, pastas: x.pasta, vendas: x.venda, vgv: x.vgv, spend: x.spend_30d, cpl: x.cpl_30d, roas: x.roas, veredito: x.veredito }));
    r.podio_campanhas = its.slice(0, 12);
    r.campanhas_ativas = its.filter(x => x.ativa).slice(0, 25);
    r.campanhas_pausadas = its.filter(x => !x.ativa).slice(0, 25);
  } else if (_tab === 'custos') {
    r.unit_economics = ((d.custos || {}).equipes || []);
    r.historico_custo = histCompact;
  } else if (_tab === 'prod') {
    r.produtividade = { equipes: eqProd, corretores: ((d.produtividade || {}).corretores || []).slice(0, 25).map(c => ({ nome: c.nome, equipe: c.team, leads: c.leads, vendas: c.venda, leads_por_venda: c.leads_por_venda, visitas_por_venda: c.visitas_por_venda, dias_por_venda: c.dias_por_venda, ticket: c.ticket, top_canal: c.top_canal })) };
    r.historico_producao = histCompact;
  } else if (_tab === 'safras') {
    const perf = d.performance_corretores || [];
    ['conquista', 'map', 'terceiros', 'locacao'].forEach(t => {
      const ps = perf.filter(c => c.team === t);
      if (ps.length) r['perf_' + t] = ps.map(c => ({ corretor: c.nome, atual: c.atual, base_90d: c.base, delta_vendas_pct: c.delta_vendas_pct, delta_vgv_pct: c.delta_vgv_pct }));
    });
    r.turnover = d.turnover || {};
    r.velocidade_contato = d.resposta || {};
    r.safras_meses = d.safras || [];
    r.tempos_etapas = d.tempos || {};
    r.historico_ano = histCompact;
  }
  // corta qualquer quadro vazio (sem dado não há o que analisar)
  Object.keys(r).forEach(k => {
    const v = r[k];
    if (v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) delete r[k];
  });
  return r;
}

/* ═══════════ 📺 MODO TV — todas as abas em rotação (pedido 15/ago) ═══════════ */
function enterTV() {
  if (_tv) return;
  _tv = true; _tvRotate = true;
  if (_root) _root.style.display = 'none';
  let ov = document.getElementById('gc-tv-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'gc-tv-ov'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0b1220;color:#e2e8f0;overflow-y:auto;overflow-x:hidden;'
    + '--bg:#0b1220;--bg-2:#111827;--bg-3:rgba(255,255,255,0.07);--ink:#f1f5f9;--ink-muted:#94a3b8;'
    + '--border:rgba(255,255,255,0.12);--border-2:rgba(255,255,255,0.08);--psm-navy:#1e293b';
  document.addEventListener('keydown', tvKey);
  try { const rf = ov.requestFullscreen || ov.webkitRequestFullscreen; if (rf) { const p = rf.call(ov); if (p && p.catch) p.catch(() => {}); } } catch (_) {}
  renderTV();
  clearInterval(_tvTimer);
  _tvTimer = setInterval(() => { if (_tv && _tvRotate) tvStep(1); }, TV_ROT_MS);
  clearInterval(_tvDataTimer);
  _tvNextAt = Date.now() + TV_REFRESH_MS;
  _tvDataTimer = setInterval(async () => {
    if (!_tv || _busy) return;
    _tvNextAt = Date.now() + TV_REFRESH_MS;
    try {
      _d = await api.request(`/api/v3/oo/comercial?since=${_since}&until=${_until}&spend_preset=${_spendPreset}&fresh=1`);
      renderTV();
    } catch (_) {}
  }, TV_REFRESH_MS);
  clearInterval(_tvTickTimer);
  _tvTickTimer = setInterval(() => {
    const el = document.getElementById('gc-tv-age');
    if (!el || !_tv) return;
    const age = _d?.fetched_at ? Math.max(0, Math.round((Date.now() - new Date(_d.fetched_at).getTime()) / 1000)) : null;
    const nxt = Math.max(0, Math.round((_tvNextAt - Date.now()) / 1000));
    const f = s => s < 90 ? s + 's' : Math.round(s / 60) + 'min';
    const cor = age == null ? '#94a3b8' : age < 720 ? '#4ade80' : age < 1800 ? '#fbbf24' : '#f87171';
    el.innerHTML = `<span style="color:${cor};font-weight:800">● dado de ${age != null ? f(age) : '—'} atrás</span><span style="opacity:.7"> · atualiza em ${f(nxt)}</span>`;
  }, 1000);
}

function exitTV() {
  _tv = false;
  [_tvTimer, _tvDataTimer, _tvTickTimer].forEach(t => clearInterval(t));
  document.removeEventListener('keydown', tvKey);
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
  document.getElementById('gc-tv-ov')?.remove();
  if (_root) { _root.style.display = ''; render(); }
}

function tvStep(dir) {
  const i = GC_TABS.findIndex(t => t[0] === _tab);
  _tab = GC_TABS[(i + dir + GC_TABS.length) % GC_TABS.length][0];
  renderTV();
}

function tvKey(e) {
  if (!_tv) return;
  if (e.key === 'Escape') exitTV();
  else if (e.key === 'ArrowRight') tvStep(1);
  else if (e.key === 'ArrowLeft') tvStep(-1);
  else if (e.key === ' ') { e.preventDefault(); _tvRotate = !_tvRotate; renderTV(); }
}

function renderTV() {
  const ov = document.getElementById('gc-tv-ov');
  if (!ov || !_d) return;
  const BTN = 'border:none;cursor:pointer;padding:7px 12px;border-radius:8px;background:rgba(255,255,255,0.08);color:#e2e8f0;font-weight:800';
  ov.innerHTML = `
    <div style="position:sticky;top:0;z-index:5;background:rgba(11,18,32,.94);backdrop-filter:blur(6px);border-bottom:1px solid rgba(255,255,255,.08);padding:12px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:19px;font-weight:900;color:#fff;white-space:nowrap">📊 PSM · Gestão Comercial</div>
      <div style="font-size:12px;color:#94a3b8;white-space:nowrap">${_d.janela.since} → ${_d.janela.until} · ${fN(_d.coorte_n)} leads</div>
      <div id="gc-tv-age" style="font-size:12px;white-space:nowrap"></div>
      <div style="flex:1;min-width:10px"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
        ${GC_TABS.map(([id, l]) => `<button class="gctv-dot" data-t="${id}" style="border:none;cursor:pointer;padding:6px 12px;border-radius:999px;font-weight:800;font-size:13px;background:${id === _tab ? '#2563eb' : 'rgba(255,255,255,0.08)'};color:${id === _tab ? '#fff' : '#94a3b8'}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button id="gctv-prev" style="${BTN}">◀</button>
        <button id="gctv-rot" style="${BTN}${_tvRotate ? ';background:#16a34a;color:#fff' : ''}">${_tvRotate ? '⏸' : '▶'}</button>
        <button id="gctv-next" style="${BTN}">▶</button>
        <button id="gctv-exit" style="${BTN};background:#dc2626;color:#fff">✕</button>
      </div>
    </div>
    <div style="padding:18px 22px 48px;font-size:15px;max-width:1700px;margin:0 auto">${tabBody()}</div>`;
  ov.querySelectorAll('.gctv-dot').forEach(b => b.onclick = () => { _tab = b.dataset.t; renderTV(); });
  ov.querySelector('#gctv-prev').onclick = () => tvStep(-1);
  ov.querySelector('#gctv-next').onclick = () => tvStep(1);
  ov.querySelector('#gctv-rot').onclick = () => { _tvRotate = !_tvRotate; renderTV(); };
  ov.querySelector('#gctv-exit').onclick = exitTV;
  postRender();
}

/* ── 📣 CAMPANHAS → FUNIL → VENDA: escalar/pausar pela VENDA, não pelo CPL ── */
function tabCampanhas() {
  const cp = _d.campanhas || {};
  const its = cp.itens || [];
  if (!its.length) return pan('📣 Campanhas', '<div class="tiny muted">Nenhum lead da janela com campanha preenchida no RD.</div>');
  const VCOR = { escalar: '#16a34a', manter: '#2563eb', maturando: '#d97706', pausar: '#dc2626', observar: '#94a3b8' };
  const podio = (campo, titulo, ico) => {
    const top = its.filter(x => (x[campo] || 0) > 0).sort((a, b) => b[campo] - a[campo]).slice(0, 3);
    return `<div><div class="tiny" style="font-weight:800;margin-bottom:4px">${ico} ${titulo}</div><div style="display:grid;gap:4px">
      ${top.map((x, i) => `<div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:8px;padding:6px 10px">
        <span>${['🥇', '🥈', '🥉'][i]}</span><span class="tiny" style="flex:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(x.campanha)}">${esc(x.campanha.slice(0, 46))}</span>
        <b>${fN(x[campo])}</b></div>`).join('') || '<div class="tiny muted">—</div>'}</div></div>`;
  };
  const linha = x => `<tr>
      <td style="font-size:11.5px;font-weight:600;padding:4px 8px 4px 0;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(x.campanha)}">${esc(x.campanha)}<div class="tiny muted">${(x.teams || []).join(' · ')}</div></td>
      <td style="text-align:right;font-size:12px">${fN(x.leads)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.agend)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.visita)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.proposta)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.pasta)}</td>
      <td style="text-align:right;font-weight:900;font-size:13px">${fN(x.venda)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(x.vgv)}</td>
      <td style="text-align:right;font-size:12px" title="≈ 4% do VGV">R$ ${kR$(x.receita_est)}</td>
      <td style="text-align:right;font-size:12px">${x.spend_30d != null ? 'R$ ' + kR$(x.spend_30d) : '—'}</td>
      <td style="text-align:right;font-size:12px">${x.cpl_30d != null ? 'R$ ' + kR$(x.cpl_30d) : '—'}</td>
      <td style="text-align:right;font-size:12px;font-weight:800">${x.roas != null ? fN(x.roas) + '×' : '—'}</td>
      <td><span class="tiny" style="font-weight:800;color:${VCOR[x.veredito]};white-space:nowrap">${esc(x.veredito_lbl)}</span></td>
    </tr>`;
  const ativas = its.filter(x => x.ativa);
  const inativas = its.filter(x => !x.ativa);
  const cab = `<thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Campanha</th><th>Leads</th><th>Agend.</th><th>Visitas</th><th>Prop.</th><th>Pastas</th><th>Vendas</th><th>VGV</th><th>Receita≈</th><th>Spend 30d</th><th>CPL</th><th>ROAS</th><th style="text-align:left">Veredito</th></tr></thead>`;
  const SPENDS = [['this_month', 'Este mês'], ['last_7d', 'Últimos 7d'], ['last_14d', 'Últimos 14d'], ['last_30d', 'Últimos 30d'], ['last_month', 'Mês passado']];
  const spendSel = `<div class="flex items-center gap-2" style="margin-bottom:8px">
    <span class="tiny" style="font-weight:800">🎚 Período do spend/CPL (Meta):</span>
    <select class="select" id="gc-spend" style="width:auto;padding:3px 8px;font-size:12px">
      ${SPENDS.map(([v, l]) => `<option value="${v}"${_spendPreset === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${cp.spend_preset_usado && cp.spend_preset_usado !== cp.spend_preset_pedido ? `<span class="tiny" style="color:#d97706;font-weight:700">⚠ cache da Meta não tinha "${esc(cp.spend_preset_pedido)}" — usando "${esc(cp.spend_preset_usado)}"</span>` : ''}
    <span class="tiny muted">o funil segue a janela de safra lá de cima — aqui você troca só a base de CUSTO</span>
  </div>`;
  setTimeout(() => { document.getElementById('gc-spend')?.addEventListener('change', ev => { _spendPreset = ev.target.value; load(); }); }, 0);
  return spendSel + pan('🏅 Pódio de campanhas — pelo FUNDO do funil, não pelo CPL', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">
        ${podio('visita', 'MAIS VISITAS', '🚶')}${podio('pasta', 'MAIS PASTAS', '📁')}${podio('proposta', 'MAIS PROPOSTAS', '📄')}${podio('venda', 'MAIS VENDAS', '💰')}
      </div>`, 'podio_campanhas')
    + pan(`🟢 Campanhas ATIVAS na Meta agora (${ativas.length})`, ativas.length ? `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${cab}
        <tbody>${ativas.map(linha).join('')}</tbody></table></div>` : '<div class="tiny muted">Nenhuma campanha ativa casou com leads da safra.</div>', 'campanhas_ativas')
    + pan(`⏸ Pausadas / encerradas / sem match na Meta (${inativas.length}) — histórico da safra`, `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${cab}
        <tbody>${inativas.map(linha).join('')}</tbody></table></div>
      <div class="tiny muted" style="margin-top:8px">${esc(cp.nota || '')} · ${fN(cp.sem_campanha || 0)} lead(s) da janela sem campanha no RD. Régua do veredito: 💰 ESCALAR = vende e a receita cobre ≥1,5× o spend · ⏳ MATURANDO = sem venda mas com pastas/propostas andando · 🔴 REVER = gasta ≥R$300/30d sem gerar UMA visita na safra. O CPL está aí de contexto — a decisão é pelo fundo do funil.</div>`, 'campanhas_pausadas');
}

/* Δ% verde/vermelho (histórico mensal — pedido 15/ago) */
function delta(cur, prev, invertido) {
  if (prev == null || cur == null || !prev) return '';
  const p = (cur - prev) / Math.abs(prev) * 100;
  if (!isFinite(p) || Math.abs(p) < 0.05) return '<span class="tiny muted">＝</span>';
  const bom = invertido ? p < 0 : p > 0;
  return `<span class="tiny" style="font-weight:800;color:${bom ? '#16a34a' : '#dc2626'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>`;
}

/* 📆 tabela do histórico do ano: colunas = meses (mês atual destacado + parcial),
   Δ% vs mês anterior em cada célula. rows = [{lbl, get(mesObj), fmt, invertido}] */
function histTable(titulo, rows, srId) {
  const hs = _d.historico || [];
  if (!hs.length) return '';
  const meses = hs.map(h => mesNome(h.ym));
  const head = `<tr class="tiny muted"><th style="text-align:left"></th>${hs.map((h, i) =>
    `<th style="text-align:right;padding:2px 8px;${h.parcial ? 'background:var(--bg-3);border-radius:6px 6px 0 0' : ''}">${meses[i]}${h.parcial ? '<div style="font-weight:400">parcial</div>' : ''}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr>
    <td class="tiny" style="font-weight:700;white-space:nowrap;padding:3px 8px 3px 0">${r.lbl}</td>
    ${hs.map((h, i) => {
      const v = r.get(h), pv = i > 0 ? r.get(hs[i - 1]) : null;
      return `<td style="text-align:right;padding:3px 8px;font-size:12px;${h.parcial ? 'background:var(--bg-3);font-weight:800' : ''}">${v != null ? r.fmt(v) : '—'}<div>${i > 0 ? delta(v, pv, r.invertido) : ''}</div></td>`;
    }).join('')}</tr>`).join('');
  return pan(`📆 ${titulo} — mês a mês ${new Date().getFullYear()} (Δ% vs mês anterior · mês atual destacado)`, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${head}${body}</table></div>`, srId);
}

/* ── 🎯 VISÃO GERAL: real × projeções ×3 × meta, por equipe + corretor ── */
function tabVisao() {
  const rows = (_d.visao || []).map(v => {
    const ok = v.meta_vendas > 0 ? (v.real_vendas >= (v.poisson?.lo ?? 0)) : null;
    const cor = v.meta_vendas <= 0 ? 'var(--ink-muted)' : v.real_vendas >= v.meta_vendas ? '#16a34a' : ok ? '#2563eb' : '#dc2626';
    const pa = v.pipeline_agora || {};
    return `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:6px 8px 6px 0;white-space:nowrap">${v.label}</td>
      <td style="text-align:right;font-weight:900;font-size:14px;color:${cor}">${fN(v.real_vendas)}</td>
      <td style="text-align:right;font-size:12px" title="PROJEÇÃO do Norte: mix × conversão calibrada de cada corretor">${v.proj_vendas ? fN(v.proj_vendas) : '—'}</td>
      <td style="text-align:right;font-size:12px" title="PROJEÇÃO por ritmo: vendas até hoje ÷ dias corridos × dias do mês">${v.proj_ritmo != null ? fN(v.proj_ritmo) : '—'}</td>
      <td style="text-align:right;font-size:12px" title="PROJEÇÃO do pipeline aberto × taxas reais (trimestre)">${(((_d.forecast || {})[v.team]) || {}).tri_esp != null ? fN(_d.forecast[v.team].tri_esp) : '—'}</td>
      <td style="text-align:right;font-size:12px;font-weight:700">${v.meta_vendas ? fN(v.meta_vendas) : '—'}</td>
      <td style="text-align:right;font-size:12px;font-weight:800;color:${v.meta_vendas ? (v.real_vendas / v.meta_vendas >= 1 ? '#16a34a' : v.real_vendas / v.meta_vendas >= 0.6 ? '#d97706' : '#dc2626') : 'var(--ink-muted)'}">${v.meta_vendas ? fN(v.real_vendas / v.meta_vendas * 100) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.meta_vendas ? fN(Math.max(0, v.meta_vendas - v.real_vendas)) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.poisson ? `${v.poisson.lo}–${v.poisson.hi} <span class="muted tiny">normal</span>` : '—'}</td>
      <td style="text-align:right;font-size:12px" title="atividade REAL do mês corrente (eventos)">${(() => { const c = ((_d.custos || {}).equipes || []).find(x => x.team === v.team) || {}; return `${fN(c.leads || 0)} / ${fN(c.agend || 0)} / ${fN(c.visita || 0)}`; })()}</td>
      <td style="text-align:right;font-size:12px" title="deals abertos AGORA parados em proposta / pasta">${fN(pa.propostas || 0)} / ${fN(pa.pastas || 0)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(v.real_vgv)}</td>
      <td style="text-align:right;font-size:12px">${v.meta_vgv ? 'R$ ' + kR$(v.meta_vgv) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.real_ticket ? 'R$ ' + kR$(v.real_ticket) : '—'}</td>
    </tr>`;
  }).join('');
  const hub = _d.hub_conquista;
  const detalhes = (_d.visao || []).filter(v => (v.por_corretor || []).length).map(v => `
    <details style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-weight:800;font-size:12.5px">${v.label} — corretor a corretor (real × meta × projetado)</summary>
      <div style="overflow-x:auto;margin-top:6px"><table style="width:100%;border-collapse:collapse">
        <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Corretor</th><th>Real (mês)</th><th>Meta</th><th>Projetado</th><th>VGV real</th><th>vs meta</th></tr></thead>
        <tbody>${v.por_corretor.map(c => {
          const pct = c.meta > 0 ? c.real / c.meta * 100 : null;
          const cc = pct == null ? 'var(--ink-muted)' : pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
          return `<tr><td style="font-size:12px;padding:3px 8px 3px 0">${esc(c.nome)}</td>
            <td style="text-align:right;font-weight:800;font-size:12px">${fN(c.real)}</td>
            <td style="text-align:right;font-size:12px">${c.meta ? fN(c.meta) : '—'}</td>
            <td style="text-align:right;font-size:12px">${c.proj ? fN(c.proj) : '—'}</td>
            <td style="text-align:right;font-size:12px">R$ ${kR$(c.vgv)}</td>
            <td style="text-align:right;font-size:11px;font-weight:800;color:${cc}">${pct != null ? fN(pct) + '%' : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>
    </details>`).join('');
  return metricasChave() + pan('🎯 Mês corrente — REAL × PROJETADO (Norte · Ritmo) × META, por equipe', `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>Vendas REAL</th><th>PROJEÇÃO Norte</th><th>PROJEÇÃO Ritmo</th><th>PROJEÇÃO Pipeline (tri)</th><th>Meta oficial</th><th>% da meta</th><th>Gap p/ meta</th><th>🎲 Faixa</th><th>Leads/Agend./Visitas (mês)</th><th>Prop./Pastas abertas</th><th>VGV real</th><th>VGV meta</th><th>Ticket</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${hub ? `<div class="tiny" style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:6px 10px">🌉 Cruzamento Conquista: esteira do PSM HUB marca <b>${fN(hub.vendas)} venda(s) · R$ ${kR$(hub.vgv)}</b> no mês — divergência com o RD é sinal de lançamento pendente num dos dois.</div>` : ''}
    ${detalhes}
    <div class="tiny muted" style="margin-top:6px">Metas = painel 🎯 Metas oficial do House (por corretor/mês). Duas projeções lado a lado: <b>Norte</b> (mix×conversão calibrada de cada corretor) e <b>Ritmo</b> (velocidade real do mês extrapolada). Venda dentro da 🎲 faixa = azul (normal estatístico). Prop./Pastas = pipeline vivo agora.</div>`, 'real_meta')
    + forecastPanel()
    + histTable('Vendas & VGV — real', [
      ...(_d.visao || []).map(v => ({ lbl: v.label + ' vendas', get: h => h.equipes?.[v.team]?.vendas, fmt: fN })),
      { lbl: 'TOTAL vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'TOTAL VGV', get: h => h.total?.vgv, fmt: x => 'R$ ' + kR$(x) },
      { lbl: 'Ticket médio', get: h => h.total?.ticket, fmt: x => 'R$ ' + kR$(x) },
    ], 'historico_vendas');
}

/* 📐 métricas-chave por equipe — v86.33: cards com RÉGUA DE ALERTA (fora da
   régua = vermelho + Δ% acima/abaixo + notificação pra gestor e sócios) */
function metricasChave() {
  const custos = ((_d.custos || {}).equipes || []);
  const prod = (_d.produtividade || {}).equipes || {};
  const resp = _d.resposta || {};
  const al = (_d.alertas || {});
  const aIdx = {};
  (al.itens || []).forEach(a => { aIdx[a.team + ':' + a.metrica] = a; });
  // 🚨 faixa de alertas ativos (inclui ritmo da meta, que mora no quadro de baixo)
  const strip = (al.itens || []).length ? `
    <div style="background:color-mix(in srgb, #dc2626 7%, transparent);border:1.5px solid #dc2626;border-radius:var(--r-md);padding:10px 14px;margin-top:12px">
      <div style="font-weight:900;font-size:13px;color:#dc2626;margin-bottom:6px">🚨 Métricas fora da régua (${(al.itens || []).length}) — gestor da equipe e sócios notificados</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${(al.itens || []).map(a => `<span style="background:var(--bg-2);border:1px solid #dc2626;border-radius:999px;padding:3px 12px;font-size:11.5px;font-weight:700">
          ${(TEAM_LBL[a.team] || a.team)} · ${esc(a.label)}: <b style="color:#dc2626">${fN(a.valor)}</b>
          <span style="color:#dc2626">${a.acima ? '▲' : '▼'} ${fN(Math.abs(a.delta_pct))}% ${a.acima ? 'acima' : 'abaixo'}</span>
          <span class="muted">(régua ${fN(a.limite)})</span></span>`).join('')}
      </div>
    </div>` : '';
  const tile = (team, mid, lbl, val, sub) => {
    const a = aIdx[team + ':' + mid];
    return `<div style="background:${a ? 'color-mix(in srgb, #dc2626 9%, transparent)' : 'var(--bg-3)'};border:1px solid ${a ? '#dc2626' : 'var(--border-2, var(--border))'};border-radius:10px;padding:7px 10px;min-width:0">
      <div class="tiny muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(lbl)}">${lbl}</div>
      <div style="font-size:16px;font-weight:900;white-space:nowrap;color:${a ? '#dc2626' : 'inherit'}">${val}</div>
      ${a ? `<div style="font-size:10.5px;font-weight:800;color:#dc2626">${a.acima ? '▲' : '▼'} ${fN(Math.abs(a.delta_pct))}% ${a.acima ? 'acima' : 'abaixo'} da régua</div>` : (sub ? `<div class="tiny muted">${sub}</div>` : '')}
    </div>`;
  };
  const val30 = (mes, d30) => mes != null ? 'R$ ' + kR$(mes) : (d30 != null ? `R$ ${kR$(d30)} <span class="tiny muted">30d</span>` : '—');
  const blocos = custos.map(c => {
    const t = c.team, p = prod[t] || {}, rz = resp[t] || {};
    const conv = p.leads ? Math.round(p.venda / p.leads * 10000) / 100 : null;
    return `<div style="margin-top:10px">
      <div style="font-weight:800;font-size:12.5px;margin-bottom:6px">${c.label}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:6px">
        ${tile(t, 'custo_lead', '💵 R$ / lead', val30(c.custo_lead, c.custo_lead_30d), fN(c.leads) + ' leads no mês')}
        ${tile(t, 'custo_agend', '📅 R$ / agendamento', val30(c.custo_agend, c.custo_agend_30d))}
        ${tile(t, 'custo_visita', '🚶 R$ / visita', val30(c.custo_visita, c.custo_visita_30d))}
        ${tile(t, 'custo_pasta', '📁 R$ / pasta', val30(c.custo_pasta, c.custo_pasta_30d))}
        ${tile(t, 'cac_midia', '🎯 CAC mídia (R$/venda)', val30(c.cac_midia, c.cac_midia_30d), fN(c.vendas) + ' venda(s) no mês')}
        ${tile(t, 'roas', '📈 ROAS (receita≈4% ÷ spend)', c.roas != null ? fN(c.roas) + '×' : '—')}
        ${tile(t, 'conv_venda', '🎲 Conv. lead→venda (safra)', conv != null ? fN(conv) + '%' : '—')}
        ${tile(t, 'visitas_venda', '🚶 Visitas → 1 venda', p.visitas_por_venda ?? '—')}
        ${tile(t, 'pastas_venda', '📁 Pastas → 1 venda', p.pastas_por_venda ?? '—')}
        ${tile(t, 'dias_venda', '⏳ Dias p/ nova venda', p.dias_por_venda != null ? fN(p.dias_por_venda) + 'd' : '—')}
        ${tile(t, 'contato_h', '⚡ 1º contato (mediano)', fmtDHM(p.contato_h_mediana))}
        ${tile(t, 'sem_contato', '🔕 SEM 1º contato', fN(rz.sem_contato || 0), 'leads da safra sem contato')}
      </div>
    </div>`;
  }).join('');
  // contatos de cada fonte pra 1 visita (leads da fonte ÷ visitas da fonte, geral)
  const fontesVisita = ((_d.fontes || {}).geral || []).filter(f => f.visita > 0).map(f =>
    `<span style="display:inline-block;background:var(--bg-3);border-radius:999px;padding:3px 10px;font-size:11.5px;margin:2px">${esc(f.label)}: <b>${fN(Math.round(f.leads / f.visita * 10) / 10)}</b> contatos → 1 visita</span>`).join('');
  return strip + pan('📐 Métricas-chave por equipe (custo do mês · razões e ritmo da safra) — vermelho = fora da régua de alerta', `
    ${blocos}
    ${fontesVisita ? `<div style="margin-top:10px"><span class="tiny" style="font-weight:800">🔀 Contatos de cada fonte pra gerar 1 visita:</span><div style="margin-top:4px">${fontesVisita}</div></div>` : ''}
    <div class="tiny muted" style="margin-top:6px">Custos = spend do mês da conta da equipe. Razões/dias/1º contato = safra da janela. Régua de alerta: ${(() => { const c = al.cfg || {}; return `R$/lead ≤ ${fN(c.max_cpl || 0)} · CAC ≤ ${kR$(c.max_cac_midia || 0)} · 1º contato ≤ ${fN(c.max_contato_h || 0)}h · conv ≥ ${fN(c.min_conv_venda_pct || 0)}% · sem contato ≤ ${fN(c.max_sem_contato || 0)} · ritmo da meta ≥ ${fN(c.min_ritmo_meta_pct || 0)}% · ROAS ≥ ${fN(c.min_roas || 0)}×`; })()}. Fora da régua: fica vermelho com Δ% e notifica gestor + sócios (1×/dia).</div>`, 'metricas_chave');
}

/* 🔮 projeção ponderada: pipeline aberto × taxas reais da equipe (mês e tri) */
function forecastPanel() {
  const fc = _d.forecast || {};
  const teams = Object.keys(fc).filter(t => (fc[t].termos || []).length || fc[t].mes_esp);
  if (!teams.length) return '';
  const rows = teams.map(t => {
    const f = fc[t];
    const termos = (f.termos || []).map(x => `${fN(x.abertos)} ${x.etapa}s×${fN(x.taxa_pct)}%`).join(' + ') || '—';
    return `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${TEAM_LBL[t] || t}</td>
      <td style="text-align:right;font-weight:900;font-size:13px">${fN(f.mes_esp)}</td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:#2563eb">${fN(f.tri_esp)}</td>
      <td style="text-align:right;font-size:12px">${f.pipeline_vgv_esp ? 'R$ ' + kR$(f.pipeline_vgv_esp) : '—'}</td>
      <td class="tiny muted">${termos}${f.mediana_pasta_venda_d != null ? ` · pasta→venda ~${f.mediana_pasta_venda_d}d` : ''}</td>
    </tr>`;
  }).join('');
  return pan('🔮 Projeção ponderada — o pipeline aberto × as taxas REAIS da equipe', `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>Esperado MÊS</th><th>Esperado TRI</th><th>VGV do pipeline</th><th style="text-align:left">Como foi calculado</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">MÊS = vendas já feitas + pastas abertas × taxa pasta→venda (só quando a mediana de dias cabe no que resta do mês). TRI = vendas + pipeline inteiro ponderado. Taxa sem amostra mínima fica de fora — sem invenção.</div>`, 'projecao_ponderada');
}

/* ── ⏬ FUNIL RD: as lanes EXATAS de cada funil, números do RD + % passagem ── */
function tabFunilRD() {
  const fr = _d.funil_rd || {};
  const teams = Object.keys(fr);
  if (!teams.length) return pan('⏬ Funil RD', '<div class="tiny muted">Nenhum funil espelhado encontrado (rd_stages).</div>');
  const RECOM = [
    [/agendar|agendad/i, 'cadência de contato mais curta + agendamento na PRIMEIRA conversa (script de 2 opções de horário)'],
    [/visita/i, 'confirmação na véspera + lembrete no dia + reagendamento ATIVO de quem furou'],
    [/proposta|aprova|quente/i, 'follow de 24h pós-visita com proposta/simulação na mão'],
    [/pasta|contrato|venda|cr[eé]dito/i, 'esteira documental: checklist de pasta + follow diário com correspondente/incorporadora'],
    [/contato|ctt|sondagem|qualific|atend/i, 'velocidade de resposta (1º contato) + 3 tentativas em canais diferentes nas primeiras 24h'],
  ];
  const bloco = tk => {
    const f = fr[tk];
    const lanes = f.lanes || [];
    const maxA = Math.max(1, ...lanes.filter(l => !l.base).map(l => l.alcancaram || 0));
    // 🔥 gargalo: pior passagem com volume relevante (≥15 alcançaram)
    const cand = lanes.filter(l => !l.base && l.passagem_pct != null && (l.alcancaram || 0) >= 15);
    const garg = cand.length ? cand.reduce((a, b) => (b.passagem_pct < a.passagem_pct ? b : a)) : null;
    const proxDe = nm => { const i = lanes.findIndex(l => l.nome === nm); return (lanes[i + 1] || {}).nome || ''; };
    const rec = garg ? (RECOM.find(([rx]) => rx.test(proxDe(garg.nome) + ' ' + garg.nome)) || [null, 'destravar a etapa com rotina diária de fila zero'])[1] : null;
    return pan(`${TEAM_LBL[tk] || tk} — funil “${esc(f.pipeline)}” (nomes exatos do RD)`, `
      <div style="display:grid;gap:3px">
        ${lanes.map(l => {
          if (l.base) return `<div style="display:flex;gap:8px;align-items:center;opacity:.75">
            <span class="tiny" style="min-width:210px;font-weight:600">🗂 ${esc(l.nome)}</span>
            <span class="tiny muted">lane de base · <b>${fN(l.abertos)}</b> parado(s) — conta como entrada, fora da cadeia</span></div>`;
          const w = Math.max(3, Math.round((l.alcancaram || 0) / maxA * 100));
          const ehGarg = garg && l.nome === garg.nome;
          return `<div style="display:flex;gap:8px;align-items:center${ehGarg ? ';background:color-mix(in srgb, #dc2626 8%, transparent);border-radius:6px;padding:2px 4px' : ''}">
            <span class="tiny" style="min-width:210px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(l.nome)}">${esc(l.nome)}</span>
            <div style="flex:1;height:20px;background:var(--bg-3);border-radius:5px;overflow:hidden;position:relative">
              <div style="height:100%;width:${w}%;background:linear-gradient(90deg,#1e3a8a,#2563eb);border-radius:5px"></div>
              <span class="tiny" style="position:absolute;left:8px;top:2px;color:#fff;font-weight:800">${fN(l.alcancaram || 0)} alcançaram</span>
            </div>
            <span class="tiny" style="min-width:86px;text-align:right"><b>${fN(l.abertos)}</b> <span class="muted">abertos</span></span>
            <span class="tiny" style="min-width:64px;text-align:right;font-weight:800;color:${l.passagem_pct == null ? 'var(--ink-muted)' : l.passagem_pct >= 50 ? '#16a34a' : l.passagem_pct >= 25 ? '#d97706' : '#dc2626'}">${l.passagem_pct != null ? '↓ ' + fN(l.passagem_pct) + '%' : ''}${ehGarg ? ' 🔥' : ''}</span>
          </div>`;
        }).join('')}
      </div>
      ${garg ? `<div style="margin-top:8px;background:color-mix(in srgb, #dc2626 8%, transparent);border:1.5px solid #dc2626;border-radius:8px;padding:8px 12px;font-size:12.5px">
        🔥 <b>GARGALO:</b> ${esc(garg.nome)} → ${esc(proxDe(garg.nome))} passa só <b>${fN(garg.passagem_pct)}%</b> (${fN(garg.abertos)} parado(s) na lane agora).
        <b>O que fazer:</b> ${esc(rec)}.</div>` : ''}
      <div class="tiny muted" style="margin-top:6px">Barra = quantos deals ALCANÇARAM a etapa (abertos de agora + ganhos do ano; aproximação pela etapa atual — dado real, sem invenção). ↓% = passagem pra próxima etapa. “Abertos” = parados na lane HOJE, igual ao RD.</div>`, 'funil_' + tk);
  };
  return teams.map(bloco).join('');
}

/* ── 🔀 FONTES & FUNIL: qual origem converte visita/pasta/venda ── */
function tabFontes() {
  const pod = _d.fontes?.podio || {};
  const medal = (arr, campo) => (arr || []).map((f, i) => `<div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:8px;padding:6px 10px">
      <span style="font-size:16px">${['🥇', '🥈', '🥉'][i]}</span><b style="flex:1;font-size:12.5px">${esc(f.label)}</b>
      <span style="font-weight:900">${fN(f[campo])}%</span><span class="tiny muted">(${fN(f.leads)} leads · ${fN(f.venda)} vendas)</span></div>`).join('') || '<div class="tiny muted">Sem fonte com amostra suficiente na janela.</div>';
  const tabela = (lista) => `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Origem</th><th>Leads</th><th>Agend.</th><th>Visitas</th><th>Pastas</th><th>Vendas</th><th>%→Visita</th><th>%→Pasta</th><th>%→Venda</th><th>VGV</th></tr></thead>
    <tbody>${(lista || []).map(f => `<tr${f.rankeavel ? '' : ' style="opacity:.55" title="amostra pequena — fora do pódio"'}>
      <td style="font-weight:600;font-size:12px;padding:4px 6px 4px 0">${esc(f.label)}${f.rankeavel ? '' : ' <span class="tiny">⚠</span>'}</td>
      <td style="text-align:right;font-size:12px">${fN(f.leads)}</td><td style="text-align:right;font-size:12px">${fN(f.agend)}</td>
      <td style="text-align:right;font-size:12px">${fN(f.visita)}</td><td style="text-align:right;font-size:12px">${fN(f.pasta)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(f.venda)}</td>
      <td style="text-align:right;font-size:12px">${f.pc_visita != null ? fN(f.pc_visita) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">${f.pc_pasta != null ? fN(f.pc_pasta) + '%' : '—'}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${f.pc_venda != null ? fN(f.pc_venda) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(f.vgv)}</td></tr>`).join('')}</tbody></table></div>`;
  const porEquipe = ['conquista', 'map', 'terceiros', 'locacao'].filter(t => _d.fontes?.[t]?.length)
    .map(t => pan(`${TEAM_LBL[t]} — funil por origem (safra da janela)`, tabela(_d.fontes[t]), 'fontes_' + t)).join('');
  return `
    ${pan('🏅 Pódio das fontes (safra da janela, amostra mínima ' + 30 + ' leads)', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">🚶 CONVERTE MAIS VISITA</div><div style="display:grid;gap:4px">${medal(pod.visita, 'pc_visita')}</div></div>
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">📁 CONVERTE MAIS PASTA</div><div style="display:grid;gap:4px">${medal(pod.pasta, 'pc_pasta')}</div></div>
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">💰 CONVERTE MAIS VENDA</div><div style="display:grid;gap:4px">${medal(pod.venda, 'pc_venda')}</div></div>
      </div>`, 'podio_fontes')}
    ${pan('🌎 Geral — todas as equipes', tabela(_d.fontes?.geral), 'fontes_geral')}
    ${porEquipe}
    <div class="tiny muted" style="margin-top:8px">Safra = lead NASCIDO na janela, acompanhado até hoje (fontes se comparam por coorte; visão instantânea mente com jornada de meses). Linhas apagadas = amostra pequena. Sem fonte e Outro contam como <b>Tráfego pago Imob</b> (regra 15/ago).</div>
    ${histFontes()}`;
}

/* 📆 histórico por ORIGEM (leads criados e vendas convertidas por mês — o Paulo
   tinha razão: data de conversão + origem de cada negociação resolvem) */
function histFontes() {
  const hs = _d.historico || [];
  const lblCanal = {};
  (_d.fontes?.geral || []).forEach(f => { lblCanal[f.canal] = f.label; });
  const tot = {};
  hs.forEach(h => Object.entries(h.canais || {}).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + (v.leads || 0); }));
  const canais = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, 8);
  if (!canais.length) return '';
  return histTable('Fontes — leads que ENTRARAM por origem, mês a mês',
    canais.map(k => ({ lbl: lblCanal[k] || k, get: h => h.canais?.[k]?.leads, fmt: fN })), 'hist_fontes_leads')
    + histTable('Fontes — VENDAS convertidas por origem (mês da conversão)',
      canais.map(k => ({ lbl: lblCanal[k] || k, get: h => h.canais?.[k]?.vendas, fmt: fN })), 'hist_fontes_vendas');
}

/* ── 💰 CUSTO DO FUNIL: R$ por etapa + CAC mídia/completo (mês corrente) ── */
function tabCustos() {
  const c = _d.custos || {};
  const rows = (c.equipes || []).map(e => `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${e.label}<div class="tiny muted">${e.conta ? 'conta ' + esc(e.conta) : 'sem conta Meta'}</div></td>
      <td style="text-align:right;font-size:12px">R$ ${brl(e.spend)}<div class="tiny muted">+ fixo R$ ${kR$(e.fixo_mes)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_lead != null ? 'R$ ' + brl(e.custo_lead) : (e.custo_lead_30d != null ? 'R$ ' + brl(e.custo_lead_30d) + ' <span class="tiny muted">30d</span>' : '—')}<div class="tiny muted">${fN(e.leads)} leads</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_agend != null ? 'R$ ' + brl(e.custo_agend) : (e.custo_agend_30d != null ? 'R$ ' + brl(e.custo_agend_30d) + ' <span class="tiny muted">30d</span>' : '—')}<div class="tiny muted">${fN(e.agend)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_visita != null ? 'R$ ' + brl(e.custo_visita) : (e.custo_visita_30d != null ? 'R$ ' + brl(e.custo_visita_30d) + ' <span class="tiny muted">30d</span>' : '—')}<div class="tiny muted">${fN(e.visita)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_pasta != null ? 'R$ ' + brl(e.custo_pasta) : (e.custo_pasta_30d != null ? 'R$ ' + brl(e.custo_pasta_30d) + ' <span class="tiny muted">30d</span>' : '—')}<div class="tiny muted">${fN(e.pasta)}</div></td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:#b45309">${e.cac_midia != null ? 'R$ ' + kR$(e.cac_midia) : (e.cac_midia_30d != null ? 'R$ ' + kR$(e.cac_midia_30d) + ' <span class="tiny muted">30d</span>' : '—')}</td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:#dc2626">${e.cac_completo != null ? 'R$ ' + kR$(e.cac_completo) : (e.cac_completo_30d != null ? 'R$ ' + kR$(e.cac_completo_30d) + ' <span class="tiny muted">30d</span>' : '—')}<div class="tiny muted">${fN(e.vendas)} venda(s) no mês${e.vendas_30d ? ' · ' + fN(e.vendas_30d) + ' em 30d' : ''}</div></td>
    </tr>`).join('');
  return pan(`💰 Unit economics do mês (${c.mes || ''}) — do lead ao CAC, por equipe`, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>Spend Meta</th><th>R$/lead</th><th>R$/agendamento</th><th>R$/visita</th><th>R$/pasta</th><th>CAC mídia</th><th>CAC completo</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${c.payback_midia ? `<div class="tiny" style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:6px 10px">💸 <b>Payback de mídia:</b> a venda vira caixa em mediana <b>${fN(c.payback_midia.mediana_dias)} dias</b> (${esc(c.payback_midia.fonte)}, n=${fN(c.payback_midia.n)}) — é o tempo entre o real investido e o real voltando.</div>` : ''}
    <div class="tiny muted" style="margin-top:8px">${esc(c.nota || '')}. Qualificado começa no AGENDAMENTO (decisão 14/ago). Indicação/orgânico não pagam mídia — o CAC deles vive no custo fixo.</div>`, 'unit_economics')
    + histTable('Custo — mês a mês (spend GLOBAL da Meta; histórico por equipe não existe na base mensal)', [
      { lbl: 'Spend Meta', get: h => h.total?.spend, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'CPL global', get: h => h.total?.cpl_global, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'CAC global (mídia)', get: h => h.total?.cac_global, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'Vendas TOTAL', get: h => h.total?.vendas, fmt: fN },
    ], 'historico_custo');
}

/* ── 📊 PRODUTIVIDADE: razões por corretor e equipe ── */
function tabProd() {
  const p = _d.produtividade || {};
  const eq = p.equipes || {};
  const eqRows = Object.keys(eq).map(t => {
    const e = eq[t];
    return `<tr style="font-weight:700;background:var(--bg-3)">
      <td style="font-size:12.5px;padding:5px 8px 5px 0">${TEAM_LBL[t] || t}</td>
      <td></td>
      <td style="text-align:right">${fN(e.leads)}</td><td style="text-align:right">${fN(e.venda)}</td>
      <td style="text-align:right">${e.leads_por_venda ?? '—'}</td><td style="text-align:right">${e.atend_por_venda ?? '—'}</td>
      <td style="text-align:right">${e.visitas_por_venda ?? '—'}</td><td style="text-align:right">${e.pastas_por_venda ?? '—'}</td>
      <td style="text-align:right">${e.dias_por_venda != null ? fN(e.dias_por_venda) + 'd' : '—'}</td>
      <td style="text-align:right;font-size:11px;white-space:nowrap">${fmtDHM(e.contato_h_mediana)}</td>
      <td style="text-align:right">${e.ticket ? 'R$ ' + kR$(e.ticket) : '—'}</td><td style="text-align:right">R$ ${kR$(e.vgv)}</td></tr>`;
  }).join('');
  const rows = (p.corretores || []).map(cr => {
    const chips = (cr.canais || []).filter(c => c.vendas > 0).map(c =>
      `<span style="display:inline-block;background:var(--bg-2);border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:10.5px;margin:1px">${esc(c.label)}: <b>${fN(c.share_vendas_pct)}%</b> das vendas · conv ${c.conv_pct != null ? fN(c.conv_pct) + '%' : '—'}</span>`).join('');
    return `<tr>
      <td style="font-size:12px;padding:4px 8px 4px 0">${esc(cr.nome)} <span class="tiny muted">${(TEAM_LBL[cr.team] || cr.team || '').replace(/^..\s/, '')}</span>
        ${chips ? `<div style="margin-top:2px">${chips}</div>` : ''}</td>
      <td style="font-size:11.5px;font-weight:800;color:#166534;white-space:nowrap">${cr.top_canal ? '🏆 ' + esc(cr.top_canal) : '—'}</td>
      <td style="text-align:right;font-size:12px">${fN(cr.leads)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(cr.venda)}</td>
      <td style="text-align:right;font-size:12px">${cr.leads_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.atend_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.visitas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.pastas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.dias_por_venda != null ? fN(cr.dias_por_venda) + 'd' : '—'}</td>
      <td style="text-align:right;font-size:11px;white-space:nowrap">${fmtDHM(cr.contato_h_mediana)}</td>
      <td style="text-align:right;font-size:12px">${cr.ticket ? 'R$ ' + kR$(cr.ticket) : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(cr.vgv)}</td>
    </tr>`;
  }).join('');
  return pan(`📊 Quantos X pra 1 venda — equipe e corretor (safra da janela)${p.restrito_a ? ` · <span class="tiny" style="color:#d97706">visão restrita à sua equipe (${p.restrito_a})</span>` : ''}`, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Corretor / Equipe</th><th style="text-align:left">Canal 🏆 (converte melhor)</th><th>Leads</th><th>Vendas</th><th>Leads/venda</th><th>Atend./venda</th><th>Visitas/venda</th><th>Pastas/venda</th><th>Dias p/ venda</th><th>1º contato</th><th>Ticket</th><th>VGV</th></tr></thead>
      <tbody>${eqRows}${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">Razões calculadas na safra da janela (lead nascido nela). Corretor sem venda na safra mostra — (sem denominador não há razão honesta).</div>`, 'produtividade')
    + histTable('Produção — mês a mês', [
      ...['conquista', 'map', 'terceiros', 'locacao'].map(t => ({ lbl: (TEAM_LBL[t] || t) + ' vendas', get: h => h.equipes?.[t]?.vendas, fmt: fN })),
      { lbl: 'TOTAL vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'TOTAL VGV', get: h => h.total?.vgv, fmt: x => 'R$ ' + kR$(x) },
    ], 'historico_producao');
}

/* ── 📈 SAFRAS & TEMPOS ── */
function tabSafras() {
  const rows = (_d.safras || []).map(s => `<tr>
      <td style="font-weight:700;font-size:12px;padding:4px 8px 4px 0">${mesNome(s.ym)}</td>
      <td style="text-align:right;font-size:12px">${fN(s.leads)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(s.vendas)}</td>
      <td style="text-align:right;font-size:12px">${s.pc != null ? fN(s.pc) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(s.vgv)}</td>
      <td style="text-align:right;font-size:12px">${s.dias_medio != null ? fN(s.dias_medio) + 'd' : '—'}</td>
    </tr>`).join('');
  const tempos = Object.keys(_d.tempos || {}).map(t => `
    <div><div class="tiny" style="font-weight:800;margin-bottom:4px">${TEAM_LBL[t] || t}</div>
      ${(_d.tempos[t] || []).map(l => `<div style="display:flex;justify-content:space-between;font-size:12px;border-bottom:1px dashed var(--border);padding:3px 0">
        <span>${esc(l.passo)}</span><span><b>${l.mediana_h != null ? fmtDHM(l.mediana_h) : '—'}</b> <span class="tiny muted">n=${l.n}</span></span></div>`).join('')}
    </div>`).join('');
  const resp = _d.resposta || {};
  const linhaR = (lbl, val) => `<div style="display:flex;justify-content:space-between;font-size:12px;border-bottom:1px dashed var(--border);padding:3px 0"><span>${lbl}</span><b style="white-space:nowrap">${val}</b></div>`;
  const respBlocos = Object.keys(resp).filter(t => (resp[t] || {}).n_mediveis).map(t => {
    const r = resp[t];
    return `<div><div class="tiny" style="font-weight:800;margin-bottom:4px">${TEAM_LBL[t] || t} <span class="muted">(${fN(r.n_mediveis)} medíveis)</span></div>
      ${linhaR('Mediana', fmtDHM(r.mediana_h))}
      ${linhaR('Média', fmtDHM(r.media_h))}
      ${linhaR('P25 → P75', fmtDHM(r.p25_h) + ' → ' + fmtDHM(r.p75_h))}
      ${linhaR('Mais rápido · mais lento', fmtDHM(r.mais_rapido_h) + ' · ' + fmtDHM(r.mais_lento_h))}
      ${linhaR('Conv. metade RÁPIDA', `<span style="color:#16a34a">${r.conv_rapidos_pct != null ? fN(r.conv_rapidos_pct) + '%' : '—'}</span>`)}
      ${linhaR('Conv. metade LENTA', `<span style="color:#dc2626">${r.conv_lentos_pct != null ? fN(r.conv_lentos_pct) + '%' : '—'}</span>`)}
      ${linhaR('Nasceram já em atendimento', fN(r.nasceram_na_etapa))}
      ${linhaR('SEM 1º contato até hoje', `<span style="color:#dc2626">${fN(r.sem_contato)}</span>`)}
    </div>`;
  }).join('');
  // 🏃 performance individual: janela atual × base 90d anterior — POR EQUIPE
  // (v86.33, pedido 17/ago: nichos diferentes não se misturam; desligado não
  // entra aqui — a análise dele vive só no 🚪 Turnover)
  const perf = _d.performance_corretores || [];
  const perfRow = c => {
    const dl = v => v == null ? '<span class="tiny muted">novo</span>' : `<span class="tiny" style="font-weight:800;color:${v >= 0 ? '#16a34a' : '#dc2626'}">${v >= 0 ? '▲' : '▼'} ${fN(Math.abs(v))}%</span>`;
    return `<tr>
      <td style="font-size:12px;font-weight:600;padding:4px 8px 4px 0;white-space:nowrap">${esc(c.nome)}</td>
      <td style="text-align:right;font-size:12px">${fN(c.atual.leads)} <span class="tiny muted">/ ${fN(c.base.leads)}</span></td>
      <td style="text-align:right;font-weight:800;font-size:12.5px">${fN(c.atual.vendas)} <span class="tiny muted">/ ${fN(c.base.vendas)}</span></td>
      <td style="text-align:right">${dl(c.delta_vendas_pct)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(c.atual.vgv)} <span class="tiny muted">/ R$ ${kR$(c.base.vgv)}</span></td>
      <td style="text-align:right">${dl(c.delta_vgv_pct)}</td>
      <td style="text-align:right;font-size:12px">${c.atual.conv_pct != null ? fN(c.atual.conv_pct) + '%' : '—'} <span class="tiny muted">/ ${c.base.conv_pct != null ? fN(c.base.conv_pct) + '%' : '—'}</span></td>
    </tr>`;
  };
  const perfCab = `<thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Corretor</th><th>Leads</th><th>Vendas</th><th>Δ vendas</th><th>VGV</th><th>Δ VGV</th><th>Conv.</th></tr></thead>`;
  const perfBlocos = ['conquista', 'map', 'terceiros', 'locacao'].filter(t => perf.some(c => c.team === t)).map(t =>
    pan(`🏃 Performance individual — ${TEAM_LBL[t]} (janela atual × BASE dos 90 dias anteriores, atual / base)`, `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${perfCab}
        <tbody>${perf.filter(c => c.team === t).map(perfRow).join('')}</tbody></table></div>
      <div class="tiny muted" style="margin-top:6px">A base individual é a média móvel de 90 dias do PRÓPRIO corretor — acima da base = evolução real, sem comparar maçã com laranja. Cada equipe é um nicho: não compare entre quadros. Só corretores ATIVOS — quem saiu aparece no 🚪 Turnover.</div>`, 'perf_' + t)).join('');
  // 🚪 turnover ciclo 90d
  const to = _d.turnover || {};
  const toCor = to.dias_desde_ultima == null ? 'var(--ink-muted)' : to.dias_desde_ultima >= (to.regra_dias || 90) ? '#dc2626' : to.dias_desde_ultima >= 60 ? '#d97706' : '#16a34a';
  const toBloco = pan('🚪 Turnover — regra da casa: 1 saída a cada ~90 dias', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px;text-align:center">
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:19px;font-weight:900">${to.intervalo_medio_dias != null ? fN(to.intervalo_medio_dias) + 'd' : '—'}</div><div class="tiny muted">ciclo REAL medido (média entre saídas)</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:19px;font-weight:900;color:${toCor}">${to.dias_desde_ultima != null ? fN(to.dias_desde_ultima) + 'd' : '—'}</div><div class="tiny muted">desde a última saída (régua: ${to.regra_dias || 90}d)</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:19px;font-weight:900">${fN((to.saidas || []).length)}</div><div class="tiny muted">saídas identificadas</div></div>
    </div>
    ${(to.saidas || []).length ? `<div class="tiny" style="font-weight:800;margin-bottom:4px">Saídas (última atividade no CRM):</div>
      <div>${to.saidas.map(x => `<span style="display:inline-block;background:var(--bg-3);border-radius:999px;padding:2px 10px;font-size:11.5px;margin:2px">${esc(x.nome)} · ${(TEAM_LBL[x.team] || x.team || '').replace(/^..\s/, '')} · ${x.ultima_atividade}</span>`).join('')}</div>` : ''}
    ${(to.ativos_risco || []).length ? `<div class="tiny" style="font-weight:800;margin:8px 0 4px;color:#d97706">⚠ Ativos em zona de atenção (90d+ sem venda com volume de lead):</div>
      <div>${to.ativos_risco.map(x => `<span style="display:inline-block;background:color-mix(in srgb, #d97706 12%, transparent);border:1px solid #d97706;border-radius:999px;padding:2px 10px;font-size:11.5px;margin:2px;font-weight:700">${esc(x.nome)} · ${fN(x.leads_janela)} leads · 0 vendas/90d</span>`).join('')}</div>` : ''}
    <div class="tiny muted" style="margin-top:6px">${esc(to.nota || '')} Tempo de casa/média entre saídas e desligados vivem AQUI — performance individual acima é só de ativos.</div>`, 'turnover');
  return `
    ${perfBlocos}
    ${toBloco}
    ${respBlocos ? pan('⚡ Velocidade do 1º contato × conversão (a prova de quanto custa demorar)', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${respBlocos}</div><div class="tiny muted" style="margin-top:6px">1º contato = primeira chegada ao marco de contato/agendamento (eventos reais do RD, safra da janela).</div>`, 'velocidade_contato') : ''}
    ${pan('📈 Safras — cada mês de lead, o que virou até hoje', `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Safra</th><th>Leads</th><th>Vendas até hoje</th><th>Conv.</th><th>VGV</th><th>Lead→venda</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="tiny muted" style="margin-top:6px">Safras recentes SEMPRE parecem piores — o lead ainda não teve tempo de maturar (MAP ~3 meses). Compare safras da mesma idade.</div>`, 'safras_meses')}
    ${pan('⏱ Tempo mediano entre etapas (esteira — onde empaca)', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${tempos}</div>`, 'tempos_etapas')}
    ${histTable('Ano — leads × vendas × ticket', [
      { lbl: 'Leads', get: h => h.total?.leads, fmt: fN },
      { lbl: 'Vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'Ticket', get: h => h.total?.ticket, fmt: x => 'R$ ' + kR$(x) },
    ], 'historico_ano')}`;
}

/* ── 📈 GRÁFICOS DE TUDO (v86.33, pedido 17/ago): o painel inteiro em visual ── */
const TEAM_CORES = { conquista: '#2563eb', map: '#7c3aed', terceiros: '#d97706', locacao: '#16a34a', outros: '#94a3b8' };
const CORES8 = ['#2563eb', '#7c3aed', '#d97706', '#16a34a', '#dc2626', '#0ea5e9', '#db2777', '#64748b'];

function gwrap(canvases, titulo, srId, alto) {
  const cv = (Array.isArray(canvases) ? canvases : [canvases])
    .map(id => `<div style="position:relative;height:${alto || 300}px;flex:1;min-width:min(320px,100%)"><canvas id="${id}"></canvas></div>`).join('');
  return pan(titulo, `<div style="display:flex;flex-wrap:wrap;gap:12px">${cv}</div>`, srId);
}

function tabGraficos() {
  const temHist = (_d.historico || []).length > 0;
  const temSafra = (_d.safras || []).length > 0;
  const temCamp = ((_d.campanhas || {}).itens || []).some(x => x.venda > 0);
  return `
    ${temHist ? gwrap('gch-hist', '📆 Vendas por equipe (barras) × VGV total (linha) — mês a mês', 'g_hist') : ''}
    ${temHist ? gwrap('gch-leads', '🧲 Leads (barras) × Spend Meta (linha) — mês a mês', 'g_leads') : ''}
    ${gwrap('gch-funil', '⏬ Funil da safra por equipe — leads → atendimento → agendamento → visita → pasta → venda', 'g_funil')}
    ${gwrap(['gch-fontes', 'gch-fontes-conv'], '🔀 Fontes — distribuição de leads e % de conversão por origem (safra)', 'g_fontes')}
    ${temSafra ? gwrap('gch-safras', '📈 Safras — leads de cada mês (barras) × conversão até hoje (linha)', 'g_safras') : ''}
    ${gwrap('gch-cac', '💰 CAC por equipe — mídia × completo (mês corrente, fallback 30d)', 'g_custos')}
    ${temCamp ? gwrap('gch-camp', '📣 Campanhas que mais VENDERAM na safra', 'g_camp') : ''}
    <div class="tiny muted" style="margin-top:8px">Mesmos dados das outras abas, em visual — janela e escopo lá de cima valem aqui. Gráfico vazio = sem dado na janela.</div>`;
}

let _gcharts = [];
async function initCharts() {
  let Chart;
  try { Chart = await loadChartLib(); } catch (_) { return; }
  _gcharts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _gcharts = [];
  const ink = _tv ? '#cbd5e1' : '#64748b';
  const grid = _tv ? 'rgba(148,163,184,.16)' : 'rgba(100,116,139,.14)';
  const base = extra => ({ responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: ink, font: { size: 11 }, boxWidth: 12 } } }, ...(extra || {}) });
  const sc = y2 => {
    const s = { x: { ticks: { color: ink, font: { size: 10 } }, grid: { color: grid } },
                y: { ticks: { color: ink, font: { size: 10 } }, grid: { color: grid }, beginAtZero: true } };
    if (y2) s.y2 = { position: 'right', ticks: { color: ink, font: { size: 10 } }, grid: { drawOnChartArea: false }, beginAtZero: true };
    return s;
  };
  const mk = (id, cfg) => { const el = document.getElementById(id); if (el) _gcharts.push(new Chart(el, cfg)); };
  const sigla = l => String(l || '').replace(/^[^\s]+\s/, '');
  const teams = ['conquista', 'map', 'terceiros', 'locacao'];
  const hs = _d.historico || [];
  const meses = hs.map(h => mesNome(h.ym).slice(0, 3));

  mk('gch-hist', { type: 'bar', data: { labels: meses, datasets: [
    ...teams.map(t => ({ label: sigla(TEAM_LBL[t]), data: hs.map(h => h.equipes?.[t]?.vendas || 0), backgroundColor: TEAM_CORES[t], stack: 'v' })),
    { type: 'line', label: 'VGV total (R$)', data: hs.map(h => h.total?.vgv || 0), borderColor: '#0ea5e9', backgroundColor: '#0ea5e9', yAxisID: 'y2', tension: .3 },
  ] }, options: base({ scales: sc(true) }) });

  mk('gch-leads', { type: 'bar', data: { labels: meses, datasets: [
    { label: 'Leads', data: hs.map(h => h.total?.leads || 0), backgroundColor: '#2563eb' },
    { type: 'line', label: 'Spend Meta (R$)', data: hs.map(h => h.total?.spend || 0), borderColor: '#d97706', backgroundColor: '#d97706', yAxisID: 'y2', tension: .3 },
  ] }, options: base({ scales: sc(true) }) });

  const eq = (_d.produtividade || {}).equipes || {};
  const etapas = [['leads', 'Leads'], ['atend', 'Atend.'], ['agend', 'Agend.'], ['visita', 'Visitas'], ['pasta', 'Pastas'], ['venda', 'Vendas']];
  mk('gch-funil', { type: 'bar', data: { labels: etapas.map(e => e[1]),
    datasets: teams.filter(t => eq[t] && eq[t].leads).map(t => ({ label: sigla(TEAM_LBL[t]), data: etapas.map(e => eq[t][e[0]] || 0), backgroundColor: TEAM_CORES[t] })) },
    options: base({ scales: sc() }) });

  const fg = ((_d.fontes || {}).geral || []).slice(0, 8);
  mk('gch-fontes', { type: 'doughnut', data: { labels: fg.map(f => f.label), datasets: [{ data: fg.map(f => f.leads), backgroundColor: CORES8 }] },
    options: base({ plugins: { legend: { position: 'right', labels: { color: ink, font: { size: 10 }, boxWidth: 10 } } } }) });
  mk('gch-fontes-conv', { type: 'bar', data: { labels: fg.map(f => f.label), datasets: [
    { label: '%→Visita', data: fg.map(f => f.pc_visita || 0), backgroundColor: '#2563eb' },
    { label: '%→Venda', data: fg.map(f => f.pc_venda || 0), backgroundColor: '#16a34a' },
  ] }, options: base({ indexAxis: 'y', scales: sc() }) });

  const sf = _d.safras || [];
  mk('gch-safras', { type: 'bar', data: { labels: sf.map(s => mesNome(s.ym).slice(0, 3)), datasets: [
    { label: 'Leads da safra', data: sf.map(s => s.leads), backgroundColor: '#94a3b8' },
    { type: 'line', label: 'Conv. até hoje (%)', data: sf.map(s => s.pc || 0), borderColor: '#16a34a', backgroundColor: '#16a34a', yAxisID: 'y2', tension: .3 },
  ] }, options: base({ scales: sc(true) }) });

  const ce = (_d.custos || {}).equipes || [];
  mk('gch-cac', { type: 'bar', data: { labels: ce.map(c => sigla(c.label)), datasets: [
    { label: 'CAC mídia', data: ce.map(c => c.cac_midia ?? c.cac_midia_30d ?? 0), backgroundColor: '#b45309' },
    { label: 'CAC completo', data: ce.map(c => c.cac_completo ?? c.cac_completo_30d ?? 0), backgroundColor: '#dc2626' },
  ] }, options: base({ scales: sc() }) });

  const ci = ((_d.campanhas || {}).itens || []).filter(x => x.venda > 0).slice(0, 10);
  mk('gch-camp', { type: 'bar', data: { labels: ci.map(x => x.campanha.slice(0, 30)), datasets: [
    { label: 'Vendas', data: ci.map(x => x.venda), backgroundColor: '#16a34a' },
  ] }, options: base({ indexAxis: 'y', scales: sc() }) });
}
