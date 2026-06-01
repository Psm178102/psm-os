/* ============================================================================
   PSM-OS v2 — Meta Ads × RD CRM · Cockpit do Gestor de Tráfego (abas)
   ----------------------------------------------------------------------------
   Planta baixa do Paulo, agora com CRM cruzado:
     🎯 Executiva   — Investimento · CAC · VGV Influenciado · ROAS Imobiliário
     📊 Tráfego     — KPIs Meta do período + Central de Alertas + contas + campanhas
     🎬 Criativos   — Laboratório (gancho 3s/retenção/CTR geral×link/freq/CPM/relevância)
     🏁 Vendas      — Motor de Vendas (conversão/ciclo/SLA/contact/show-up/motivos/ranking)
     🚦 Semáforo    — decisão de escala (Vertical/Horizontal/Troca/Sangria/Manter)
     🏷 Por Marca   — 1 conta Meta = 1 marca (Conquista MCMV × PSM Imóveis × Locação)
   Meta: /api/v3/marketing/summary · CRM: /api/v3/marketing/crm_metrics (tabela deals).
   Sprint 9.10 (v76.7).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const PRESETS = [
  { id: 'today',      lbl: 'Hoje' },
  { id: 'yesterday',  lbl: 'Ontem' },
  { id: 'last_7d',    lbl: 'Últimos 7 dias' },
  { id: 'last_14d',   lbl: 'Últimos 14 dias' },
  { id: 'last_30d',   lbl: 'Últimos 30 dias' },
  { id: 'this_month', lbl: 'Mês atual' },
  { id: 'last_month', lbl: 'Mês anterior' },
];

const TABS = [
  { id: 'executiva', lbl: '🎯 Executiva' },
  { id: 'graficos',  lbl: '📈 Gráficos' },
  { id: 'trafego',   lbl: '📊 Tráfego' },   // unifica tráfego + criativos + semáforo
  { id: 'vendas',    lbl: '🏁 Vendas' },
  { id: 'marca',     lbl: '🏷 Por Marca' },
];

const TH_KEY = 'psm.v2.ads_thresholds';
const DEFAULT_TH = { cpl: 80, freq: 3.0, ctr: 1.0, gasto: 30 };

let _root = null, _data = null, _crm = null, _crmErr = null;
let _preset = 'last_30d';
let _tab = 'executiva';
let _filter = '', _sort = 'spend', _statusFilter = 'todos';
let _auto = false, _timer = null, _busy = false;
// Sprint 9.15: breakdowns Meta (sob demanda) + Google Ads (gated por env)
let _bd = null, _bdSel = 'age', _bdBusy = false, _google = null;
// Gráficos (Chart.js já no cache do SW) + série diária sob demanda
let _ts = null, _tsBusy = false, _charts = [], _chartLibP = null;
// Filtros: período custom (since/until) + contas selecionadas (vazio = todas)
let _since = '', _until = '', _accSel = [];
// Modo TV / tela cheia (overlay fullscreen + rotação automática das abas)
let _tv = false, _tvRotate = true, _tvTimer = null, _tvDataTimer = null;
// Leads por cidade + alerta de % fora de Rio Preto (fonte: deals/RD)
let _geo = null;
let _leadsCreative = null;
const BREAKDOWNS = [
  { id: 'age',                'lbl': '🎂 Idade' },
  { id: 'gender',             'lbl': '⚧ Gênero' },
  { id: 'publisher_platform', 'lbl': '📱 Plataforma' },
  { id: 'device_platform',    'lbl': '💻 Dispositivo' },
  { id: 'region',             'lbl': '📍 Região' },
  { id: 'hourly_stats_aggregated_by_advertiser_time_zone', 'lbl': '🕐 Hora do dia' },
];

function loadTh() { try { return { ...DEFAULT_TH, ...(JSON.parse(localStorage.getItem(TH_KEY) || '{}')) }; } catch { return { ...DEFAULT_TH }; } }
function saveTh(th) { localStorage.setItem(TH_KEY, JSON.stringify(th)); }
let _th = loadTh();

// 1 conta Meta = 1 marca. Classifica pelo rótulo da conta + metas por segmento.
function brandInfo(label) {
  const s = (label || '').toLowerCase();
  if (/conquista|mcmv|minha casa|1º|primeiro/.test(s)) return { key: 'conquista', brand: 'PSM Conquista', sub: 'MCMV / 1º Imóvel', cor: '#16a34a', cplAlvo: 25 };
  if (/loca|aluguel|locaç/.test(s))                    return { key: 'locacao',   brand: 'Locação',       sub: 'Aluguel & Adm',  cor: '#d97706', cplAlvo: 60 };
  return { key: 'imoveis', brand: 'PSM Imóveis', sub: 'Médio / Alto Padrão', cor: '#7c3aed', cplAlvo: 150 };
}

export async function pageMarketing(ctx, root) {
  _root = root;
  stopAuto();
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl ≥ 5).</div>'; return; }
  await reload();
  if (_auto) startAuto();
}

function stopAuto() { if (_timer) { clearInterval(_timer); _timer = null; } }
function startAuto() {
  stopAuto();
  if (!_auto) return;
  _timer = setInterval(() => {
    if (!_root || !document.body.contains(_root) || !location.hash.startsWith('#/marketing')) { stopAuto(); return; }
    if (!_busy) reload(true);
  }, 60000);
}

async function reload(silent) {
  if (!_root) return;
  _busy = true;
  if (!silent) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando Meta Ads + CRM…</div></div>';
  try {
    const qp = (_since && _until)
      ? ('?since=' + encodeURIComponent(_since) + '&until=' + encodeURIComponent(_until))
      : ('?date_preset=' + encodeURIComponent(_preset));
    // Filtro de conta(s) Meta → marca(s): o CRM/Leads do RD respeitam a seleção
    // da toolbar (a conta resolve até a marca, pois o lead RD não traz a conta).
    const bk = selectedBrandKeys();
    const bq = bk.length ? '&brands=' + encodeURIComponent(bk.join(',')) : '';
    _bd = null; _ts = null;  // breakdown/série dependem do período; invalida ao recarregar
    const [meta, crm, goog, geo, lc] = await Promise.allSettled([
      api.request('/api/v3/marketing/summary' + qp),
      api.request('/api/v3/marketing/crm_metrics' + qp + bq),
      api.request('/api/v3/marketing/google_ads' + qp),
      api.request('/api/v3/marketing/leads_geo' + qp + bq),
      api.request('/api/v3/marketing/leads_creative' + qp),
    ]);
    if (meta.status === 'fulfilled') _data = meta.value; else throw meta.reason;
    if (crm.status === 'fulfilled' && crm.value?.ok) { _crm = crm.value; _crmErr = null; }
    else { _crm = null; _crmErr = (crm.reason?.message) || (crm.value?.error) || 'CRM indisponível'; }
    _google = (goog.status === 'fulfilled') ? goog.value : { ok: false, error: goog.reason?.message };
    _geo = (geo.status === 'fulfilled' && geo.value?.ok) ? geo.value : null;
    _leadsCreative = (lc.status === 'fulfilled' && lc.value?.ok) ? lc.value : null;
    if (_tv) renderTV(); else render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro ao consultar Meta: ${escapeHtml(e.message)}</div>
      <div class="mt-2"><button class="btn btn-primary" id="ma-retry">🔄 Tentar de novo</button></div>`;
    document.getElementById('ma-retry')?.addEventListener('click', () => reload());
  } finally { _busy = false; }
}

// Sprint 9.15: busca breakdown Meta sob demanda (não no load — só quando o gestor pede)
async function loadBreakdown(sel) {
  _bdSel = sel || _bdSel;
  _bdBusy = true; render();
  try {
    _bd = await api.request('/api/v3/marketing/meta_breakdowns?breakdown='
      + encodeURIComponent(_bdSel) + '&date_preset=' + encodeURIComponent(_preset));
  } catch (e) {
    _bd = { ok: false, error: e.message };
  } finally {
    _bdBusy = false; render();
  }
}

function periodTotals(accounts) {
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, messages: 0, leads: 0, purchaseValue: 0 };
  accounts.forEach(a => {
    t.spend += a.spend || 0; t.impressions += a.impressions || 0; t.reach += a.reach || 0;
    t.clicks += a.clicks || 0; t.results += a.results || 0; t.purchaseValue += a.purchaseValue || 0;
    t.messages += a.messages || 0; t.leads += a.leads || 0;
  });
  t.cpl = t.results > 0 ? t.spend / t.results : 0;
  t.cpl_msg = t.messages > 0 ? t.spend / t.messages : 0;
  t.cpl_lead = t.leads > 0 ? t.spend / t.leads : 0;
  t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
  t.cpm = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0;
  t.freq = t.reach > 0 ? t.impressions / t.reach : 0;
  t.roas = t.spend > 0 && t.purchaseValue > 0 ? t.purchaseValue / t.spend : 0;
  return t;
}

// Filtro de conta(s): vazio = todas. Aplica client-side em contas e campanhas.
function filteredAccounts() {
  const a = (_data && _data.accounts) || [];
  return _accSel.length ? a.filter(x => _accSel.includes(x.id)) : a;
}
function filteredCampaigns() {
  const c = (_data && _data.campaigns) || [];
  return _accSel.length ? c.filter(x => _accSel.includes(x.accountId)) : c;
}
// Barra de filtros: período custom (since/until) + chips de conta (uma/várias/todas)
function filterBar() {
  const acc = (_data && _data.accounts) || [];
  const chip = (id, lbl, active) => `<button class="ma-acc" data-acc="${esc(id)}" style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${active ? '#2563eb' : 'var(--border)'};background:${active ? '#2563eb' : 'transparent'};color:${active ? '#fff' : 'var(--ink-muted)'}">${escapeHtml(lbl)}</button>`;
  return `
    <div class="flex items-center gap-2 mt-2" style="flex-wrap:wrap;background:var(--bg-3);border-radius:10px;padding:8px 10px">
      <span class="tiny" style="font-weight:700">📅 Período:</span>
      <input type="date" id="ma-since" value="${_since}" class="input" style="padding:3px 6px;font-size:12px;width:140px">
      <span class="tiny muted">até</span>
      <input type="date" id="ma-until" value="${_until}" class="input" style="padding:3px 6px;font-size:12px;width:140px">
      <button class="btn btn-primary btn-sm" id="ma-range-go">Aplicar</button>
      ${(_since && _until) ? '<button class="btn btn-ghost btn-sm" id="ma-range-clear">limpar</button>' : ''}
      <span style="width:1px;height:18px;background:var(--border);margin:0 4px"></span>
      <span class="tiny" style="font-weight:700">🏢 Contas:</span>
      ${chip('__all__', 'Todas', _accSel.length === 0)}
      ${acc.map(a => chip(a.id, a.label || a.id, _accSel.includes(a.id))).join('')}
    </div>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Marca(s) implícita(s) na seleção de conta(s) — mapeia cada conta selecionada
// pra sua marca (brandInfo). Vazio = todas. Usado pra filtrar CRM/Leads do RD.
function selectedBrandKeys() {
  if (!_accSel.length) return [];
  const acc = (_data && _data.accounts) || [];
  const keys = new Set();
  acc.forEach(a => { if (_accSel.includes(a.id)) keys.add(brandInfo(a.label || a.id).key); });
  return [...keys];
}

// Selo de filtro ativo (conta(s) → marca(s)) pros painéis de RD.
function filterTag() {
  if (!_accSel.length) return '';
  const acc = (_data && _data.accounts) || [];
  const sel = acc.filter(a => _accSel.includes(a.id));
  const names = sel.map(a => a.label || a.id);
  const brands = [...new Set(sel.map(a => brandInfo(a.label || a.id).brand))];
  return `<span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:rgba(37,99,235,0.18);border:1px solid rgba(37,99,235,0.4);color:#93c5fd;font-size:10px;font-weight:700" title="O lead do RD não carrega a conta de anúncio; a conta resolve até a marca/funil.">🔎 ${escapeHtml(names.join(' + '))} → ${escapeHtml(brands.join(' / '))}</span>`;
}

// Agrupa gasto/resultados Meta por marca (mesma classificação do CRM).
function metaSpendByBrand(accounts) {
  const m = {};
  (accounts || []).forEach(a => {
    const k = brandInfo(a.label || a.id).key;
    const b = m[k] || (m[k] = { spend: 0, results: 0, impressions: 0, label: brandInfo(a.label).brand, cor: brandInfo(a.label).cor });
    b.spend += a.spend || 0; b.results += a.results || 0; b.impressions += a.impressions || 0;
  });
  return m;
}

function computeAlerts(campaigns) {
  const active = campaigns.filter(c => (c.status || '').toLowerCase() === 'active');
  return {
    active,
    burning:   active.filter(c => (c.spend || 0) >= _th.gasto && (c.results || 0) === 0),
    cplHigh:   active.filter(c => (c.results || 0) > 0 && (c.cpr || 0) > _th.cpl),
    fadiga:    active.filter(c => (c.frequency || 0) > _th.freq),
    ctrLow:    active.filter(c => (c.impressions || 0) >= 500 && (c.ctr || 0) < _th.ctr),
    qualBaixo: active.filter(c => /BELOW_AVERAGE/.test(c.qualityRanking || '')),
  };
}

// outbound CTR (cliques de link / impressões) — clique de intenção real
function outboundCtr(c) { return (c.impressions || 0) > 0 ? ((c.inlineLinkClicks || 0) / c.impressions) * 100 : 0; }

function render() {
  const d = _data || {};
  if (d.error) { _root.innerHTML = `<div class="alert alert-err">${escapeHtml(d.error)}</div>`; return; }
  const accounts = d.accounts || [];

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">📢 Cockpit de Tráfego · Meta Ads × CRM</h2>
          <p class="card-sub">
            ${accounts.length} conta(s) · período <strong>${escapeHtml(d.period || _preset)}</strong> ·
            atualizado ${d.fetchedAt ? new Date(d.fetchedAt).toLocaleTimeString('pt-BR') : 'agora'}
            ${d.partial ? ' · <span style="color:#d97706">⚠️ parcial</span>' : ''}
            ${_crm ? ` · <span style="color:#16a34a">CRM ✓ ${_crm.deals_scanned} deals</span>` : ' · <span style="color:#d97706">CRM ⚠️</span>'}
            ${_crm && _crm.truncated ? ' · <span style="color:#d97706" title="Mais deals do que o teto desta janela — aumente o recorte ou reduza o período">⚠️ amostra truncada</span>' : ''}
          </p>
        </div>
        <label class="tiny" style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer">
          <input type="checkbox" id="ma-auto" ${_auto ? 'checked' : ''}> ⏱ Tempo real (60s)
        </label>
        <select id="ma-preset" class="select" style="padding:5px 10px;font-size:12px">
          ${PRESETS.map(p => `<option value="${p.id}"${p.id === _preset ? ' selected' : ''}>${p.lbl}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="ma-reload" title="Atualizar">🔄</button>
        <button class="btn btn-primary" id="ma-tv-btn" title="Modo TV / Tela cheia (apresentação)">📺 TV</button>
      </div>

      ${filterBar()}

      ${(d.errors && d.errors.length) ? `<div class="alert alert-warn mt-2">⚠️ ${d.errors.length} conta(s) com erro: ${escapeHtml(d.errors.map(e => e.label + ' — ' + e.error).join(' · '))}</div>` : ''}

      <!-- Abas -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:0">
        ${TABS.map(t => `<button class="ma-tab" data-tab="${t.id}" style="background:${_tab===t.id?'var(--bg-3)':'transparent'};border:none;border-bottom:3px solid ${_tab===t.id?'#2563eb':'transparent'};padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;color:${_tab===t.id?'var(--ink)':'var(--ink-muted)'}">${t.lbl}</button>`).join('')}
      </div>

      <div id="ma-tab-body" style="margin-top:14px">${tabBody()}</div>
    </div>
  `;
  wire();
}

function tabBody() {
  if (_tab === 'graficos')  return tabGraficos();
  if (_tab === 'trafego')   return tabTrafegoCompleto();
  if (_tab === 'vendas')    return tabVendas();
  if (_tab === 'marca')     return tabMarca();
  return tabExecutiva();
}

/* ───────────────────────── MODO TV / TELA CHEIA ─────────────────────────
   Overlay full-viewport (+ Fullscreen API) que mostra SÓ o dashboard, em
   tela grande, com rotação automática das abas e controles interativos
   (◀ ▶ play/pause · dots por aba · 🔄 · ✕). Responsivo e navegável por
   teclado (← → espaço Esc). Reusa as mesmas abas/gráficos do cockpit.      */
const TV_ROTATE_MS = 18000;    // troca de aba a cada 18s
const TV_REFRESH_MS = 180000;  // re-puxa dados a cada 3min
const TVBTN = 'border:none;cursor:pointer;padding:8px 13px;border-radius:10px;font-weight:800;font-size:15px;background:rgba(255,255,255,0.1);color:#e2e8f0;line-height:1';

function enterTV() {
  if (_tv) return;
  _tv = true; _tvRotate = true;
  if (_root) { _root.innerHTML = ''; _root.style.display = 'none'; }  // evita IDs de canvas duplicados
  let ov = document.getElementById('ma-tv');
  if (!ov) { ov = document.createElement('div'); ov.id = 'ma-tv'; document.body.appendChild(ov); }
  // Overlay dark + override das variáveis de tema → abas claras (Vendas/Marca/
  // tabelas) viram dark automaticamente, sem reescrever cada uma.
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0b1220;color:#e2e8f0;overflow-y:auto;overflow-x:hidden;'
    + '--bg:#0b1220;--bg-2:#111827;--bg-3:rgba(255,255,255,0.06);--ink:#f1f5f9;--ink-muted:#94a3b8;'
    + '--border:rgba(255,255,255,0.12);--border-2:rgba(255,255,255,0.08);--psm-navy:#1e293b';
  document.addEventListener('keydown', tvKey);
  try {
    const rf = ov.requestFullscreen || ov.webkitRequestFullscreen || ov.msRequestFullscreen;
    if (rf) { const p = rf.call(ov); if (p && p.catch) p.catch(() => {}); }
  } catch (_) {}
  renderTV();
  if (!_ts) loadTimeseries();
  if (_tvTimer) clearInterval(_tvTimer);
  _tvTimer = setInterval(() => { if (_tv && _tvRotate) tvStep(1); }, TV_ROTATE_MS);
  if (_tvDataTimer) clearInterval(_tvDataTimer);
  _tvDataTimer = setInterval(() => { if (_tv && !_busy) reload(true); }, TV_REFRESH_MS);
}

function exitTV() {
  _tv = false;
  if (_tvTimer) { clearInterval(_tvTimer); _tvTimer = null; }
  if (_tvDataTimer) { clearInterval(_tvDataTimer); _tvDataTimer = null; }
  document.removeEventListener('keydown', tvKey);
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
  const ov = document.getElementById('ma-tv'); if (ov) ov.remove();
  if (_root) { _root.style.display = ''; render(); }
}

function tvStep(dir) {
  const i = TABS.findIndex(t => t.id === _tab);
  _tab = TABS[(i + dir + TABS.length) % TABS.length].id;
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
  const ov = document.getElementById('ma-tv'); if (!ov) return;
  const d = _data || {};
  const nAcc = (d.accounts || []).length;
  const dots = TABS.map(t => `<button class="tv-dot" data-tab="${t.id}" style="border:none;cursor:pointer;padding:7px 13px;border-radius:999px;font-weight:800;font-size:14px;background:${t.id===_tab?'#2563eb':'rgba(255,255,255,0.08)'};color:${t.id===_tab?'#fff':'#94a3b8'}">${escapeHtml(t.lbl)}</button>`).join('');
  // chips de conta (analisar contas diferentes dentro do TV)
  const accBtn = (active, label, id) => `<button class="tv-acc" data-acc="${escapeHtml(id)}" style="border:none;cursor:pointer;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:700;background:${active ? '#0891b2' : 'rgba(255,255,255,0.08)'};color:${active ? '#fff' : '#94a3b8'}">${escapeHtml(label)}</button>`;
  const accChips = accBtn(_accSel.length === 0, '🌐 Todas', '__all__') + (d.accounts || []).map(a => accBtn(_accSel.indexOf(a.id) >= 0, a.label || a.id, a.id)).join('');
  ov.innerHTML = `
    <div style="position:sticky;top:0;z-index:5;background:rgba(11,18,32,0.94);backdrop-filter:blur(6px);border-bottom:1px solid rgba(255,255,255,0.08);padding:12px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:19px;font-weight:900;color:#fff;white-space:nowrap">📺 PSM · Meta Ads</div>
      <div style="font-size:12px;color:#94a3b8;white-space:nowrap">${nAcc} conta(s) · ${escapeHtml(d.period || _preset)} · ${d.fetchedAt ? new Date(d.fetchedAt).toLocaleTimeString('pt-BR') : 'agora'}${d.partial ? ' · ⚠️ parcial' : ''}</div>
      <div style="flex:1;min-width:10px"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:center">${dots}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <button id="tv-prev" title="Anterior (←)" style="${TVBTN}">◀</button>
        <button id="tv-rotate" title="Auto-rotação (espaço)" style="${TVBTN}${_tvRotate ? ';background:#16a34a;color:#fff' : ''}">${_tvRotate ? '⏸' : '▶'}</button>
        <button id="tv-next" title="Próximo (→)" style="${TVBTN}">▶</button>
        <button id="tv-refresh" title="Atualizar dados" style="${TVBTN}">🔄</button>
        <button id="tv-exit" title="Sair (Esc)" style="${TVBTN};background:#dc2626;color:#fff">✕ Sair</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 18px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(11,18,32,0.85)">
      <span style="font-size:11px;color:#94a3b8;font-weight:800;letter-spacing:.5px">CONTAS:</span>
      ${accChips}
    </div>
    <div id="ma-tv-body" style="padding:18px 22px 48px;font-size:15px;max-width:1700px;margin:0 auto">${tabBody()}</div>
  `;
  ov.querySelectorAll('.tv-acc').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.acc;
    const before = selectedBrandKeys().slice().sort().join(',');
    if (id === '__all__') _accSel = [];
    else { const i = _accSel.indexOf(id); if (i >= 0) _accSel.splice(i, 1); else _accSel.push(id); }
    _ts = null;                 // série diária depende das contas selecionadas
    // CRM/Leads (RD) seguem a marca da seleção — refaz só se a marca mudou.
    if (selectedBrandKeys().slice().sort().join(',') !== before) reload(true);
    else renderTV();
  }));
  ov.querySelectorAll('.tv-dot').forEach(b => b.addEventListener('click', () => { _tab = b.dataset.tab; renderTV(); }));
  ov.querySelector('#tv-prev')?.addEventListener('click', () => tvStep(-1));
  ov.querySelector('#tv-next')?.addEventListener('click', () => tvStep(1));
  ov.querySelector('#tv-rotate')?.addEventListener('click', () => { _tvRotate = !_tvRotate; renderTV(); });
  ov.querySelector('#tv-refresh')?.addEventListener('click', () => reload(true));
  ov.querySelector('#tv-exit')?.addEventListener('click', exitTV);
  // gráficos da aba atual (canvas vivem no overlay; in-page está vazio → sem conflito de ID)
  if (_tab === 'executiva') { if (!_ts && !_tsBusy) loadTimeseries(); buildExecutivaCharts(); }
  if (_tab === 'graficos')  { if (!_ts && !_tsBusy) loadTimeseries(); buildGraficos(); }
}

function crmWarn() {
  return `<div class="alert alert-warn">📭 Sem dados do CRM no período (${escapeHtml(_crmErr || 'RD não sincronizado')}).<br>
    Esta aba cruza vendas do RD Station com o gasto Meta. Verifique o sync de deals (cron <code>/api/v3/crm/sync_cron</code>) e o <code>RD_API_TOKEN</code>.</div>`;
}

/* ─── Leads por Cidade (tabela, não-mapa) + alerta >30% fora de Rio Preto ─── */
function leadsGeoPanel() {
  const g = _geo;
  if (!g || !g.total) return '';
  const semPct = g.total > 0 ? Math.round(g.sem_cidade / g.total * 100) : 0;
  const top = (g.by_city || []).slice(0, 12);
  const maxLeads = Math.max(1, ...top.map(c => c.leads));
  const cityRows = top.map(c => {
    const w = Math.round(c.leads / maxLeads * 100);
    const col = c.cidade === 'Não informado' ? '#64748b' : (c.is_rio_preto ? '#22c55e' : '#fbbf24');
    return `<tr style="border-top:1px solid rgba(255,255,255,0.06)">
      <td style="padding:6px 10px;color:${col};font-weight:700">${c.is_rio_preto ? '📍 ' : ''}${escapeHtml(c.cidade)}</td>
      <td style="padding:6px 8px;position:relative;min-width:120px"><div style="position:absolute;inset:5px auto 5px 0;width:${w}%;background:${col}33;border-radius:4px"></div><span style="position:relative;font-weight:700;color:#e2e8f0">${fmtNum(c.leads)}</span></td>
      <td style="text-align:right;padding:6px 10px;color:#cbd5e1">${c.pct}%</td>
    </tr>`;
  }).join('');
  const alerts = (g.by_campaign || []).filter(c => c.alerta);
  const banner = g.alerta_global
    ? `<div style="margin-top:12px;background:rgba(239,68,68,0.14);border:1px solid rgba(239,68,68,0.4);color:#fecaca;border-radius:12px;padding:10px 14px;font-size:12px"><strong>⚠️ ${g.pct_outras}% dos leads vêm de FORA da região de Rio Preto (DDD ≠ 17)</strong> — acima do limite de ${g.threshold_pct}% (${g.outras} de ${g.com_cidade} leads com DDD).</div>`
    : (g.pct_outras != null ? `<div style="margin-top:12px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);color:#86efac;border-radius:12px;padding:10px 14px;font-size:12px">✅ ${(100 - g.pct_outras).toFixed(1)}% dos leads são da região de Rio Preto (DDD 17) · ${g.pct_outras}% de fora (dentro do limite de ${g.threshold_pct}%).</div>` : '');
  const campAlerts = alerts.length
    ? `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:6px">🚨 Campanhas/públicos com >${g.threshold_pct}% de leads de fora</div>
       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
       ${alerts.slice(0, 12).map(c => `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:8px 12px">
          <div style="font-size:12px;color:#fca5a5;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.campanha)}">${escapeHtml(c.campanha)}</div>
          <div style="font-size:18px;font-weight:900;color:#f87171">${c.pct_outras}% fora</div>
          <div style="font-size:10px;color:#94a3b8">${c.outras} fora · ${c.rio_preto} RP · ${c.leads} leads</div></div>`).join('')}
       </div></div>`
    : '';
  const brands = g.by_brand || [];
  const brandBlock = brands.length ? `<div style="margin-top:12px">
    <div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:6px">🏷 Por marca (% de leads de fora de Rio Preto)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px">
    ${brands.map(b => {
      const al = b.alerta;
      const col = al ? '#f87171' : (b.pct_outras != null && b.pct_outras <= 10 ? '#4ade80' : '#fbbf24');
      return `<div style="background:${al ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)'};border:1px solid ${al ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)'};border-radius:10px;padding:8px 12px">
        <div style="font-size:12px;color:#cbd5e1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${al ? '🚨 ' : ''}${escapeHtml(b.marca)}</div>
        <div style="font-size:18px;font-weight:900;color:${col}">${b.pct_outras != null ? b.pct_outras + '% fora' : '—'}</div>
        <div style="font-size:10px;color:#94a3b8">${fmtNum(b.leads)} leads · ${fmtNum(b.rio_preto)} RP · ${fmtNum(b.outras)} fora</div></div>`;
    }).join('')}
    </div></div>` : '';
  return `
  <div style="background:linear-gradient(160deg,#0f172a,#111827);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:18px;color:#e2e8f0;margin-bottom:16px">
    <div style="font-size:15px;font-weight:800;color:#fff">📍 Leads por Região (DDD do telefone)</div>
    <div style="font-size:11px;color:#94a3b8">região pelo DDD do telefone do lead (RD) · <b style="color:#86efac">DDD 17 = São José do Rio Preto</b> · alerta quando >${g.threshold_pct}% vêm de fora${filterTag()}</div>
    ${banner}
    ${campAlerts}
    ${brandBlock}
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:14px;margin-top:12px;align-items:start">
      <div style="overflow-x:auto">
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="color:#94a3b8;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.1)">
            <th style="text-align:left;padding:6px 10px">Região (DDD)</th><th style="text-align:left;padding:6px 8px">Leads</th><th style="text-align:right;padding:6px 10px">%</th></tr></thead>
          <tbody>${cityRows}</tbody>
        </table>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-content:start">
        ${crmMiniDark('Total de leads', fmtNum(g.total), '#60a5fa')}
        ${crmMiniDark('📍 DDD 17 · Rio Preto', fmtNum(g.rio_preto), '#22c55e', g.com_cidade ? Math.round(g.rio_preto / g.com_cidade * 100) + '% dos c/ DDD' : '')}
        ${crmMiniDark('Outras regiões', fmtNum(g.outras), '#fbbf24', g.pct_outras != null ? g.pct_outras + '%' : '')}
        ${crmMiniDark('Sem telefone/DDD', fmtNum(g.sem_cidade), '#94a3b8', semPct + '% do total')}
      </div>
    </div>
    ${semPct >= 40 ? `<div style="margin-top:10px;font-size:11px;color:#fcd34d">⚠️ ${semPct}% dos leads sem telefone/DDD válido no RD.</div>` : ''}
  </div>`;
}

/* ───────────────────────── ABA: EXECUTIVA (Aba 1) ───────────────────────── */
/* ───────── Visão Geral premium (estilo relatório de agência) ───────── */
function sparkSVG(vals, color) {
  const a = (vals || []).filter(v => typeof v === 'number');
  if (a.length < 2) return '<div style="height:34px"></div>';
  const max = Math.max(...a), min = Math.min(...a), rng = (max - min) || 1, n = a.length;
  const line = a.map((v, i) => `${(i / (n - 1) * 100).toFixed(1)},${(32 - (v - min) / rng * 28).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 100 34" preserveAspectRatio="none" style="width:100%;height:34px;display:block">
    <polygon points="0,34 ${line} 100,34" fill="${color}" opacity="0.16"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
  </svg>`;
}
function deltaBadge(pct, invert) {
  if (pct == null || isNaN(pct)) return '<span style="font-size:11px;color:#64748b">— vs ant.</span>';
  const good = invert ? pct <= 0 : pct >= 0;
  const c = good ? '#22c55e' : '#f87171';
  return `<span style="font-size:11px;font-weight:700;color:${c}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}
function heroKpi(label, value, deltaPct, sparkVals, color, invert) {
  return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px 14px 10px">
    <div style="font-size:11px;color:#94a3b8;letter-spacing:.4px">${label}</div>
    <div style="font-size:23px;font-weight:800;color:#f1f5f9;line-height:1.1;margin-top:3px">${value}</div>
    <div style="margin-top:2px">${deltaBadge(deltaPct, invert)}</div>
    <div style="margin-top:6px">${sparkSVG(sparkVals, color)}</div>
  </div>`;
}
function funnelStage(label, val, frac, color) {
  const w = Math.max(20, Math.round(frac * 100));
  return `<div style="margin:0 auto;width:${w}%;background:linear-gradient(135deg,${color},${color}bb);border-radius:8px;padding:8px 10px;text-align:center;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25)">
    <div style="font-size:10px;opacity:.85;letter-spacing:.5px">${label}</div>
    <div style="font-size:17px;font-weight:800;line-height:1.1">${fmtNum(val)}</div>
  </div>`;
}
function progressCard(label, value, sub, frac, color) {
  const w = Math.max(2, Math.min(100, Math.round(frac * 100)));
  return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:12px 14px">
    <div style="font-size:11px;color:#94a3b8">${label}</div>
    <div style="font-size:22px;font-weight:800;color:#f1f5f9;margin-top:2px">${value}</div>
    <div style="height:7px;border-radius:6px;background:rgba(255,255,255,0.08);margin-top:8px;overflow:hidden"><div style="height:100%;width:${w}%;background:${color}"></div></div>
    <div style="font-size:10px;color:#64748b;margin-top:4px">${sub}</div>
  </div>`;
}
function execHero(t, accounts) {
  const d = _data || {};
  const s = (_ts && _ts.series) || [];
  const dl = (_ts && _ts.delta) || {};
  const col = (m) => s.map(p => p[m]);
  const freq = t.reach > 0 ? (t.impressions / t.reach) : 0;
  const cpc = t.clicks > 0 ? (t.spend / t.clicks) : 0;
  const cplTarget = (_th && _th.cpl) || 80;
  const camps = filteredCampaigns().slice().sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5);
  const maxSp = Math.max(1, ...camps.map(c => c.spend || 0));
  const maxCl = Math.max(1, ...camps.map(c => c.clicks || 0));
  const cell = (txt, frac, color) => `<td style="padding:6px 8px;text-align:right;position:relative">
      <div style="position:absolute;inset:3px auto 3px 0;width:${Math.round(frac * 100)}%;background:${color}22;border-radius:4px"></div>
      <span style="position:relative;font-weight:700">${txt}</span></td>`;
  return `
  <div style="background:linear-gradient(160deg,#0f172a,#111827);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:18px 18px 20px;color:#e2e8f0;margin-bottom:16px">
    <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:17px;font-weight:800;color:#fff">∞ Relatório Meta Ads · PSM</div>
        <div style="font-size:11px;color:#94a3b8">${accounts.length} conta(s) · ${escapeHtml(d.period || _preset)}${_ts && _ts.prev && _ts.prev.since ? ' · vs ' + _ts.prev.since.slice(5) + '–' + (_ts.prev.until || '').slice(5) : ''}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-top:14px">
      ${heroKpi('💰 Investimento', 'R$ ' + money(t.spend), dl.spend, col('spend'), '#ef4444')}
      ${heroKpi('💬 Mensagens', fmtNum(t.messages), dl.messages, col('messages'), '#22c55e')}
      ${heroKpi('🧲 Leads', fmtNum(t.leads), dl.leads, col('leads'), '#14b8a6')}
      ${heroKpi('🖱 Cliques', fmtNum(t.clicks), dl.clicks, col('clicks'), '#3b82f6')}
      ${heroKpi('👥 Alcance', fmtNum(t.reach), dl.reach, col('reach'), '#a855f7')}
      ${heroKpi('📊 Impressões', fmtNum(t.impressions), dl.impressions, col('impressions'), '#d4a843')}
      ${heroKpi('🎯 CTR', (t.ctr || 0).toFixed(2) + '%', dl.ctr, col('ctr'), '#06b6d4')}
    </div>

    <div style="display:grid;grid-template-columns:1.05fr 1.35fr;gap:14px;margin-top:16px;align-items:start">
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px">
        <div style="font-size:13px;font-weight:700;color:#cbd5e1;text-align:center;margin-bottom:10px">Funil de Tráfego</div>
        <div style="display:flex;flex-direction:column;gap:7px">
          ${funnelStage('IMPRESSÕES', t.impressions, 1, '#1d4ed8')}
          ${funnelStage('ALCANCE', t.reach, t.impressions ? t.reach / t.impressions : 0.7, '#2563eb')}
          ${funnelStage('CLIQUES', t.clicks, t.impressions ? Math.max(0.4, t.clicks / t.impressions * 8) : 0.5, '#3b82f6')}
          ${funnelStage('MENSAGENS/LEADS', t.results, t.impressions ? Math.max(0.28, t.results / t.impressions * 40) : 0.3, '#60a5fa')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">
          ${miniStat('CTR', (t.ctr || 0).toFixed(2) + '%')}
          ${miniStat('Frequência', freq.toFixed(2))}
          ${miniStat('CPM', 'R$ ' + money(t.cpm || 0))}
        </div>
      </div>

      <div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${progressCard('Custo por Mensagem/Lead (CPL)', t.cpl ? 'R$ ' + money(t.cpl) : '—', `meta R$ ${money(cplTarget)} · ${deltaTxt(dl.cpl)}`, cplTarget ? (t.cpl / cplTarget) : 0, (t.cpl <= cplTarget ? '#22c55e' : '#f87171'))}
          ${progressCard('Custo por Clique (CPC)', cpc ? 'R$ ' + money(cpc) : '—', deltaTxt(dl.clicks, true) + ' cliques', Math.min(1, cpc / 5), '#38bdf8')}
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:12px;margin-top:10px">
          <div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:6px">Investimento × Resultados (dia)</div>
          <div style="position:relative;height:170px"><canvas id="ch-exec-line"></canvas></div>
        </div>
      </div>
    </div>

    ${heroAlertas()}

    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:14px;margin-top:14px;align-items:start">
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:12px;overflow-x:auto">
        <div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:6px">Campanhas (top 5 por gasto)</div>
        <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:420px">
          <thead><tr style="color:#94a3b8;font-size:11px"><th style="text-align:left;padding:6px 8px">Campanha</th><th style="text-align:right;padding:6px 8px">Investido</th><th style="text-align:right;padding:6px 8px">Cliques</th><th style="text-align:right;padding:6px 8px">Result.</th></tr></thead>
          <tbody>${camps.length ? camps.map(c => `<tr style="border-top:1px solid rgba(255,255,255,0.06)">
            <td style="padding:6px 8px;color:#e2e8f0">${escapeHtml((c.name || '—').slice(0, 34))}</td>
            ${cell('R$ ' + money(c.spend || 0), (c.spend || 0) / maxSp, '#3b82f6')}
            ${cell(fmtNum(c.clicks || 0), (c.clicks || 0) / maxCl, '#22c55e')}
            <td style="padding:6px 8px;text-align:right;font-weight:700">${fmtNum(c.results || 0)}</td></tr>`).join('') : '<tr><td colspan="4" style="padding:12px;text-align:center;color:#64748b">Sem campanhas no período.</td></tr>'}</tbody>
        </table>
      </div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:12px">
        <div style="font-size:12px;font-weight:700;color:#cbd5e1;margin-bottom:6px">Mix de investimento (campanhas)</div>
        <div style="position:relative;height:210px"><canvas id="ch-exec-donut"></canvas></div>
      </div>
    </div>
  </div>`;
}
function miniStat(label, val) {
  return `<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:8px;text-align:center">
    <div style="font-size:10px;color:#94a3b8">${label}</div><div style="font-size:15px;font-weight:800;color:#f1f5f9">${val}</div></div>`;
}
function deltaTxt(pct, raw) {
  if (pct == null || isNaN(pct)) return raw ? '' : 'sem comparativo';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs período ant.`;
}

async function buildExecutivaCharts() {
  let Chart;
  try { Chart = await loadChartLib(); } catch (_) { return; }
  if (!Chart) return;
  _charts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _charts = [];
  const ink = '#cbd5e1', grid = 'rgba(148,163,184,0.14)';
  const mk = (id, cfg) => { const el = document.getElementById(id); if (el) _charts.push(new Chart(el, cfg)); };
  const opts = (e) => Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: ink, font: { size: 10 } } } } }, e || {});
  if (_ts && _ts.series && _ts.series.length) {
    const labels = _ts.series.map(p => (p.date || '').slice(5));
    mk('ch-exec-line', { type: 'line', data: { labels, datasets: [
      { label: 'Investimento (R$)', data: _ts.series.map(p => p.spend), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.14)', fill: true, tension: 0.35, pointRadius: 0, yAxisID: 'y' },
      { label: 'Resultados', data: _ts.series.map(p => p.results), borderColor: '#38bdf8', tension: 0.35, pointRadius: 0, yAxisID: 'y1' },
    ] }, options: opts({ scales: { x: { ticks: { color: ink, maxTicksLimit: 10 }, grid: { color: grid } }, y: { position: 'left', beginAtZero: true, ticks: { color: ink }, grid: { color: grid } }, y1: { position: 'right', beginAtZero: true, ticks: { color: ink }, grid: { drawOnChartArea: false } } } }) });
  }
  const camps = ((_data && _data.campaigns) || []).slice().sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 6).filter(c => (c.spend || 0) > 0);
  if (camps.length) {
    const PAL = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4'];
    mk('ch-exec-donut', { type: 'doughnut', data: { labels: camps.map(c => (c.name || '—').slice(0, 20)), datasets: [{ data: camps.map(c => c.spend), backgroundColor: camps.map((_, i) => PAL[i % PAL.length]), borderWidth: 0 }] }, options: opts({ cutout: '60%' }) });
  }
}

function heroAlertas() {
  const camps = filteredCampaigns();
  const al = computeAlerts(camps);
  const verba = al.burning.reduce((s, c) => s + (c.spend || 0), 0);
  const buckets = { vertical: 0, horizontal: 0, troca: 0, sangria: 0, manter: 0 };
  camps.forEach(c => { const k = classifySemaforo(c); if (buckets[k] != null) buckets[k]++; });
  const stat = (ico, lbl, val, color, sub) => `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px 12px;border-left:4px solid ${color}">
      <div style="font-size:11px;color:#94a3b8">${ico} ${lbl}</div>
      <div style="font-size:20px;font-weight:800;color:#f1f5f9">${val}</div>
      ${sub ? `<div style="font-size:10px;color:#64748b">${sub}</div>` : ''}</div>`;
  return `
  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px;margin-top:14px">
    <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:#cbd5e1">⚠️ Alertas & Semáforo de Escala</div>
      <span class="tiny" style="color:#94a3b8">detalhe na aba 📊 Tráfego</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      ${stat('🛑', 'Sangria (pausar)', al.burning.length, '#dc2626', verba ? ('R$ ' + money(verba) + ' em risco') : 'verba sem retorno')}
      ${stat('💸', 'CPL acima da meta', al.cplHigh.length, '#ea580c', 'custo por lead alto')}
      ${stat('😵', 'Fadiga (freq alta)', al.fadiga.length, '#a16207', 'trocar criativo')}
      ${stat('📉', 'CTR baixo', al.ctrLow.length, '#2563eb', 'gancho fraco')}
      ${stat('🚀', 'Escalar vertical', buckets.vertical, '#16a34a', 'CPL ok + freq baixa → +20% verba')}
      ${stat('🧭', 'Escalar horizontal', buckets.horizontal, '#0891b2', 'novo público / lookalike')}
    </div>
  </div>`;
}

function tabExecutiva() {
  const d = _data || {};
  const accounts = filteredAccounts();
  const t = periodTotals(accounts);
  if (!_crm) {
    // Hero premium + aviso de CRM ausente
    return `
      ${execHero(t, accounts)}
      ${leadsGeoPanel()}
      <div class="mt-3" style="margin-top:14px">${crmWarn()}</div>`;
  }
  const g = _crm.global;
  const attr = g.attribution || {};
  const byBrand = metaSpendByBrand(accounts);
  const cac = g.vendas > 0 ? t.spend / g.vendas : 0;
  // Honesto (Sprint 9.14): VGV Influenciado = só ganhos com origem Meta/Google
  // marcada no RD. SEM fallback p/ VGV total (que fingiria que tudo veio de ads).
  const vgvInf = attr.vgv_paid || 0;
  const cov = attr.coverage_pct;   // % do VGV ganho que tem origem marcada
  const roas = (t.spend > 0 && vgvInf > 0) ? vgvInf / t.spend : 0;
  const vgvInfLbl = `Meta+Google (origem RD)${attrChip(cov)}`;

  return `
    ${execHero(t, accounts)}
    ${leadsGeoPanel()}
    <div style="background:linear-gradient(160deg,#0f172a,#111827);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:18px 18px 20px;color:#e2e8f0;margin-bottom:16px">
      <div style="font-size:15px;font-weight:800;color:#fff">🔗 Cruzamento com CRM · Meta Ads × RD</div>
      <div style="font-size:11px;color:#94a3b8">Mídia paga convertida em venda real — CAC, VGV e ROAS cruzam Meta Ads × deals ganhos no RD no mesmo período.${filterTag()}</div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px">
        ${crmKpiDark('💰 Investimento Total', 'R$ ' + money(t.spend), `${accounts.length} conta(s) Meta`, '#f87171')}
        ${crmKpiDark('🧮 CAC', cac ? 'R$ ' + money(cac) : '—', `${g.vendas} venda(s) no período`, '#fb923c')}
        ${crmKpiDark('🏛 VGV Influenciado', vgvInf > 0 ? 'R$ ' + moneyShort(vgvInf) : '—', vgvInfLbl, '#c4b5fd')}
        ${crmKpiDark('📈 ROAS Imobiliário', roas ? roas.toFixed(1) + 'x' : '—', vgvInf > 0 ? 'VGV influenciado ÷ investimento' : 'sem ganhos com origem paga marcada', '#4ade80')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:12px">
        ${crmMiniDark('Leads gerados (RD)', fmtNum(g.leads_criados), '#60a5fa')}
        ${crmMiniDark('Vendas ganhas', fmtNum(g.vendas), '#4ade80')}
        ${crmMiniDark('Ticket médio', g.ticket_medio ? 'R$ ' + moneyShort(g.ticket_medio) : '—', '#c4b5fd')}
        ${crmMiniDark('Conversão', g.taxa_conversao != null ? g.taxa_conversao + '%' : '—', '#22d3ee', 'ganhos ÷ fechados')}
        ${crmMiniDark('CPL real (RD)', g.leads_criados ? 'R$ ' + money(t.spend / g.leads_criados) : '—', '#fbbf24', 'gasto ÷ leads RD')}
      </div>

      ${attrBanner(attr)}

      ${crmPanelDark('📡 Atribuição por canal', '(origem RD × VGV ganho)', attrChannelTable(attr))}

      ${crmPanelDark('🏷 Por marca (Meta × CRM)', '', `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:680px">
        <thead><tr style="color:#94a3b8;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.1)">
          <th style="text-align:left;padding:6px 10px">Marca</th><th style="text-align:right;padding:6px 8px">Investido</th>
          <th style="text-align:right;padding:6px 8px">Leads</th><th style="text-align:right;padding:6px 8px">Vendas</th>
          <th style="text-align:right;padding:6px 8px">CAC</th><th style="text-align:right;padding:6px 8px">VGV</th>
          <th style="text-align:right;padding:6px 8px">ROAS</th>
        </tr></thead><tbody>
          ${execBrandRows(byBrand)}
        </tbody></table></div>`)}

      ${produtoEficienciaPanel()}
      ${rejeicaoMotivoPanel()}
      ${creativeCyclePanel()}
      ${googleSection(attr)}
      ${roadmapMini()}
    </div>
  `;
}

/* ─── Google Ads (Sprint 9.15) — dados reais se configurado, senão aviso honesto ─── */
function googleSection(attr) {
  const gg = _google;
  if (!gg) return '';
  if (gg.configured === false) {
    const miss = (gg.missing || []).join(', ');
    return `<div style="margin-top:14px;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);color:#fde68a;border-radius:12px;padding:10px 14px;font-size:12px">🔌 <strong>Google Ads não conectado.</strong> Configure as credenciais no Vercel para fechar a atribuição do canal Google (ROAS Google). Falta: <code style="font-size:11px;color:#fcd34d">${escapeHtml(miss || 'credenciais')}</code>.</div>`;
  }
  if (gg.ok === false) {
    return `<div style="margin-top:14px;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);color:#fde68a;border-radius:12px;padding:10px 14px;font-size:12px">⚠️ Google Ads: ${escapeHtml(gg.error || 'erro')}</div>`;
  }
  // ROAS Google = VGV ganho via canal google (RD) ÷ gasto Google
  const gch = ((attr && attr.by_channel) || []).find(c => c.channel === 'google');
  const gVgv = gch ? gch.vgv : 0;
  const roas = (gg.spend > 0 && gVgv > 0) ? gVgv / gg.spend : 0;
  const top = (gg.campaigns || []).slice(0, 6);
  return crmPanelDark('🔎 Google Ads', '', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
      ${crmMiniDark('Investido Google', 'R$ ' + money(gg.spend), '#f87171')}
      ${crmMiniDark('Cliques', fmtNum(gg.clicks), '#60a5fa')}
      ${crmMiniDark('Conversões (Google)', fmtNum(gg.conversions), '#22d3ee')}
      ${crmMiniDark('VGV via Google (RD)', gVgv ? 'R$ ' + moneyShort(gVgv) : '—', '#c4b5fd')}
      ${crmMiniDark('ROAS Google', roas ? roas.toFixed(1) + 'x' : '—', '#4ade80', 'VGV Google ÷ gasto')}
    </div>
    ${top.length ? `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:480px;margin-top:10px">
      <thead><tr style="color:#94a3b8;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.1)">
        <th style="text-align:left;padding:6px 10px">Campanha</th><th style="text-align:right;padding:6px 8px">Gasto</th>
        <th style="text-align:right;padding:6px 8px">Cliques</th><th style="text-align:right;padding:6px 8px">Conv.</th>
      </tr></thead><tbody>
      ${top.map(c => `<tr style="border-top:1px solid rgba(255,255,255,0.06)">
        <td style="padding:6px 10px;font-weight:600;color:#e2e8f0">${escapeHtml(c.name)}</td>
        <td style="text-align:right;padding:6px 8px;color:#f87171">R$ ${money(c.spend)}</td>
        <td style="text-align:right;padding:6px 8px;color:#e2e8f0">${fmtNum(c.clicks)}</td>
        <td style="text-align:right;padding:6px 8px;color:#e2e8f0">${fmtNum(c.conversions)}</td>
      </tr>`).join('')}
      </tbody></table></div>` : ''}`);
}

function execBrandRows(byBrand) {
  const order = ['conquista', 'imoveis', 'locacao'];
  const rows = [];
  order.forEach(k => {
    const meta = byBrand[k];
    const crm = _crm.brands?.[k];
    if (!meta && !crm) return;
    const spend = meta?.spend || 0;
    const vendas = crm?.vendas || 0;
    const vgv = crm?.vgv || 0;
    const leads = crm?.leads_criados || 0;
    const cac = vendas ? spend / vendas : 0;
    const vgvInf = (crm?.attribution?.vgv_paid) || 0;  // honesto: só Meta/Google, sem fallback
    const roas = (spend && vgvInf) ? vgvInf / spend : 0;
    const bi = brandInfo(k === 'conquista' ? 'conquista' : k === 'locacao' ? 'locacao' : 'imoveis');
    rows.push(`<tr style="border-top:1px solid rgba(255,255,255,0.06)">
      <td style="padding:6px 10px;font-weight:700;color:${bi.cor}">${escapeHtml(crm?.label || bi.brand)}</td>
      <td style="text-align:right;padding:6px 8px;color:#f87171">R$ ${money(spend)}</td>
      <td style="text-align:right;padding:6px 8px;color:#e2e8f0">${fmtNum(leads)}</td>
      <td style="text-align:right;padding:6px 8px;color:#4ade80">${fmtNum(vendas)}</td>
      <td style="text-align:right;padding:6px 8px;color:#cbd5e1">${cac ? 'R$ ' + money(cac) : '—'}</td>
      <td style="text-align:right;padding:6px 8px;font-weight:700;color:#f1f5f9">R$ ${moneyShort(vgv)}</td>
      <td style="text-align:right;padding:6px 8px;font-weight:800;color:${roas>=1?'#4ade80':'#fb923c'}">${roas ? roas.toFixed(1) + 'x' : '—'}</td>
    </tr>`);
  });
  return rows.join('') || '<tr><td colspan="7" style="padding:14px;text-align:center;color:#64748b;font-size:12px">Sem cruzamento no período.</td></tr>';
}

/* ───────────────────────── ABA: GRÁFICOS (Chart.js) ───────────────────────── */
function tabGraficos() {
  if (!_data || !(_data.accounts || []).length) {
    return `<div class="alert alert-warn mt-2">Sem dados do Meta no período pra plotar.</div>`;
  }
  const tsNote = _tsBusy
    ? '<span class="muted tiny"><span class="spinner"></span> carregando série diária…</span>'
    : (!_ts ? '<span class="muted tiny">série diária a caminho…</span>'
      : (_ts.ok === false ? '<span class="tiny" style="color:#d97706">⚠️ série parcial</span>' : '<span class="muted tiny">por dia</span>'));
  const card = (title, id, sub, h) => `<div class="card" style="margin:0">
      <div class="flex" style="justify-content:space-between;align-items:baseline;gap:8px"><h3 class="card-title" style="font-size:14px;margin:0">${title}</h3>${sub || ''}</div>
      <div style="position:relative;height:${h || 280}px;margin-top:8px"><canvas id="${id}"></canvas></div>
    </div>`;
  return `
    <p class="card-sub">Visão gráfica Meta Ads × CRM no período. Tendências diárias, distribuição de investimento e funil de aquisição.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px">
      <div style="grid-column:1/-1">${card('💰 Gasto por dia (R$)', 'ch-gasto', tsNote, 300)}</div>
      <div style="grid-column:1/-1">${card('📉 CPL × Resultados por dia', 'ch-cplres', tsNote, 300)}</div>
      ${card('🏷 Investimento por marca', 'ch-marca', '', 300)}
      ${card('📡 Leads por canal (origem RD)', 'ch-canal', '', 300)}
      <div style="grid-column:1/-1">${card('🏆 Top campanhas por gasto', 'ch-camp', '', 360)}</div>
      <div style="grid-column:1/-1">${card('🔻 Funil de aquisição (escala log)', 'ch-funil', '', 300)}</div>
    </div>`;
}

// Chart.js já está no cache do Service Worker (v2/sw.js) → carrega offline-safe.
function loadChartLib() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (_chartLibP) return _chartLibP;
  _chartLibP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => res(window.Chart);
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return _chartLibP;
}

async function loadTimeseries() {
  if (_ts || _tsBusy) return;
  _tsBusy = true;
  try {
    let q = (_since && _until)
      ? ('?since=' + encodeURIComponent(_since) + '&until=' + encodeURIComponent(_until))
      : ('?date_preset=' + encodeURIComponent(_preset));
    if (_accSel.length) q += '&accounts=' + encodeURIComponent(_accSel.join(','));
    _ts = await api.request('/api/v3/marketing/meta_timeseries' + q);
  }
  catch (e) { _ts = { ok: false, series: [], error: e.message }; }
  finally { _tsBusy = false; if (_tv) renderTV(); else if (_tab === 'graficos' || _tab === 'executiva') render(); }
}

async function buildGraficos() {
  let Chart;
  try { Chart = await loadChartLib(); } catch (_) { return; }
  if (!Chart) return;
  _charts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _charts = [];
  const ink = (getComputedStyle(document.documentElement).getPropertyValue('--ink') || '#0f172a').trim() || '#0f172a';
  const grid = 'rgba(148,163,184,0.18)';
  const PAL = ['#2563eb', '#16a34a', '#dc2626', '#d4a843', '#7c3aed', '#0891b2', '#ea580c', '#db2777'];
  const opts = (extra) => Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: ink, font: { size: 11 } } } } }, extra || {});
  const mk = (id, cfg) => { const el = document.getElementById(id); if (el) _charts.push(new Chart(el, cfg)); };
  const accounts = (_data && _data.accounts) || [];
  const camps = (_data && _data.campaigns) || [];

  // 1+2 — série diária
  if (_ts && _ts.series && _ts.series.length) {
    const labels = _ts.series.map(p => (p.date || '').slice(5));
    mk('ch-gasto', { type: 'line', data: { labels, datasets: [{ label: 'Gasto (R$)', data: _ts.series.map(p => p.spend), borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.12)', fill: true, tension: 0.3, pointRadius: 2 }] },
      options: opts({ scales: { x: { ticks: { color: ink, maxTicksLimit: 12 }, grid: { color: grid } }, y: { ticks: { color: ink }, grid: { color: grid }, beginAtZero: true } }, plugins: { legend: { display: false } } }) });
    mk('ch-cplres', { type: 'line', data: { labels, datasets: [
      { label: 'CPL (R$)', data: _ts.series.map(p => p.cpl), borderColor: '#7c3aed', tension: 0.3, pointRadius: 2, yAxisID: 'y' },
      { label: 'Resultados', data: _ts.series.map(p => p.results), borderColor: '#16a34a', tension: 0.3, pointRadius: 2, yAxisID: 'y1' },
    ] }, options: opts({ scales: { x: { ticks: { color: ink, maxTicksLimit: 12 }, grid: { color: grid } }, y: { position: 'left', beginAtZero: true, ticks: { color: ink }, grid: { color: grid } }, y1: { position: 'right', beginAtZero: true, ticks: { color: ink }, grid: { drawOnChartArea: false } } } }) });
  }

  // 3 — investimento por marca
  const byBrand = metaSpendByBrand(accounts);
  const bk = ['conquista', 'imoveis', 'locacao'].filter(k => byBrand[k] && byBrand[k].spend > 0);
  if (bk.length) mk('ch-marca', { type: 'doughnut', data: { labels: bk.map(k => brandInfo(k).brand), datasets: [{ data: bk.map(k => byBrand[k].spend), backgroundColor: bk.map(k => brandInfo(k).cor) }] }, options: opts() });

  // 4 — leads por canal
  const ch = (_crm && _crm.global && _crm.global.attribution && _crm.global.attribution.by_channel) || [];
  const chL = ch.filter(c => c.leads > 0);
  if (chL.length) mk('ch-canal', { type: 'doughnut', data: { labels: chL.map(c => c.label), datasets: [{ data: chL.map(c => c.leads), backgroundColor: chL.map((_, i) => PAL[i % PAL.length]) }] }, options: opts() });

  // 5 — top campanhas por gasto
  const top = [...camps].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 8).filter(c => (c.spend || 0) > 0);
  if (top.length) mk('ch-camp', { type: 'bar', data: { labels: top.map(c => (c.name || '—').slice(0, 30)), datasets: [{ label: 'Gasto (R$)', data: top.map(c => c.spend || 0), backgroundColor: '#2563eb' }] },
    options: opts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: ink }, grid: { color: grid }, beginAtZero: true }, y: { ticks: { color: ink, font: { size: 10 } }, grid: { display: false } } } }) });

  // 6 — funil de aquisição (log)
  const t = periodTotals(accounts);
  const vendas = (_crm && _crm.global && _crm.global.vendas) || 0;
  mk('ch-funil', { type: 'bar', data: { labels: ['Impressões', 'Cliques', 'Leads', 'Vendas'], datasets: [{ label: 'Funil', data: [t.impressions, t.clicks, t.results, vendas], backgroundColor: ['#0891b2', '#2563eb', '#7c3aed', '#16a34a'] }] },
    options: opts({ plugins: { legend: { display: false } }, scales: { x: { ticks: { color: ink }, grid: { display: false } }, y: { type: 'logarithmic', ticks: { color: ink }, grid: { color: grid } } } }) });
}

/* ─── ABA UNIFICADA: TRÁFEGO (operacional + criativos + semáforo + breakdowns) ─── */
function tabTrafegoCompleto() {
  const div = (t) => `<div style="margin:22px 0 4px;padding-top:16px;border-top:2px solid var(--border)"><h2 class="card-title" style="font-size:16px">${t}</h2></div>`;
  return `
    ${div('📊 Tráfego — visão operacional')}
    ${tabTrafego()}
    ${div('🎬 Criativos & breakdowns')}
    ${tabCriativos()}
    ${div('🚦 Semáforo de campanhas')}
    ${tabSemaforo()}
  `;
}

/* ─── Cockpit de métricas completo (todas as métricas Meta em tempo real) ─── */
function aggMetrics(camps) {
  const s = { spend:0, impressions:0, reach:0, clicks:0, linkClicks:0, results:0, messages:0, leads:0,
    reactions:0, comments:0, shares:0, saves:0, postEng:0, pageEng:0, lpViews:0, outbound:0,
    views:0, v3:0, v25:0, v50:0, v75:0, v95:0, v100:0, leadValue:0, purchaseValue:0, avgWatchSum:0, avgWatchN:0 };
  camps.forEach(c => {
    s.spend += c.spend||0; s.impressions += c.impressions||0; s.reach += c.reach||0; s.clicks += c.clicks||0;
    s.linkClicks += c.inlineLinkClicks||0; s.results += c.results||0; s.messages += c.messages||0; s.leads += c.leads||0;
    s.reactions += c.reactions||0; s.comments += c.comments||0; s.shares += c.shares||0; s.saves += c.saves||0;
    s.postEng += c.postEngagement||0; s.pageEng += c.pageEngagement||0; s.lpViews += c.landingPageViews||0; s.outbound += c.outboundClicks||0;
    s.views += c.views||0; s.v3 += c.v3||0; s.v25 += c.v25||0; s.v50 += c.v50||0; s.v75 += c.v75||0; s.v95 += c.v95||0; s.v100 += c.v100||0;
    s.leadValue += c.leadValue||0; s.purchaseValue += c.purchaseValue||0;
    if (c.avgWatchTime) { s.avgWatchSum += c.avgWatchTime; s.avgWatchN++; }
  });
  return s;
}
function metaMetricsCockpit() {
  const camps = filteredCampaigns();
  if (!camps.length) return '';
  const s = aggMetrics(camps);
  const freq = s.reach>0 ? s.impressions/s.reach : 0;
  const cpm = s.impressions>0 ? s.spend/s.impressions*1000 : 0;
  const ctrAll = s.impressions>0 ? s.clicks/s.impressions*100 : 0;
  const ctrLink = s.impressions>0 ? s.linkClicks/s.impressions*100 : 0;
  const cpcAll = s.clicks>0 ? s.spend/s.clicks : 0;
  const cpcLink = s.linkClicks>0 ? s.spend/s.linkClicks : 0;
  const engRate = s.impressions>0 ? s.postEng/s.impressions*100 : 0;
  const costPerEng = s.postEng>0 ? s.spend/s.postEng : 0;
  const avgWatch = s.avgWatchN>0 ? s.avgWatchSum/s.avgWatchN : 0;
  const vtr = s.views>0 ? s.v100/s.views*100 : 0;
  const cplMsg = s.messages>0 ? s.spend/s.messages : 0;
  const cplLead = s.leads>0 ? s.spend/s.leads : 0;
  const cpLp = s.lpViews>0 ? s.spend/s.lpViews : 0;
  const vbase = Math.max(s.views, s.v25, 1);
  const vstage = (lbl, val, color) => { const w = Math.max(5, Math.round(val/vbase*100)); return `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:2px"><span>${lbl}</span><span style="color:#e2e8f0;font-weight:700">${fmtNum(val)}</span></div><div style="height:14px;border-radius:6px;background:rgba(255,255,255,0.06);overflow:hidden"><div style="height:100%;width:${w}%;background:${color}"></div></div></div>`; };
  const grid = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px';
  return `
    <div style="background:linear-gradient(160deg,#0f172a,#111827);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:18px;color:#e2e8f0;margin-bottom:16px">
      <div style="font-size:15px;font-weight:800;color:#fff">📊 Cockpit de Métricas Meta</div>
      <div style="font-size:11px;color:#94a3b8">${camps.length} campanha(s) no período · entrega · tráfego · engajamento · vídeo · mensagens · leads — tudo em tempo real</div>

      ${crmPanelDark('🚀 Entrega & Custo', '', `<div style="${grid}">
        ${crmMiniDark('Investido', 'R$ ' + money(s.spend), '#f87171')}
        ${crmMiniDark('Impressões', fmtNum(s.impressions), '#fbbf24')}
        ${crmMiniDark('Alcance', fmtNum(s.reach), '#a855f7')}
        ${crmMiniDark('Frequência', freq.toFixed(2), '#c4b5fd')}
        ${crmMiniDark('CPM', 'R$ ' + money(cpm), '#60a5fa')}
      </div>`)}

      ${crmPanelDark('🖱 Tráfego', '(link × todos)', `<div style="${grid}">
        ${crmMiniDark('Cliques no link', fmtNum(s.linkClicks), '#60a5fa')}
        ${crmMiniDark('Cliques (todos)', fmtNum(s.clicks), '#93c5fd')}
        ${crmMiniDark('CTR link', ctrLink.toFixed(2) + '%', '#22d3ee')}
        ${crmMiniDark('CTR todos', ctrAll.toFixed(2) + '%', '#67e8f9')}
        ${crmMiniDark('CPC link', 'R$ ' + money(cpcLink), '#34d399')}
        ${crmMiniDark('CPC todos', 'R$ ' + money(cpcAll), '#6ee7b7')}
        ${crmMiniDark('Cliques de saída', fmtNum(s.outbound), '#94a3b8')}
        ${crmMiniDark('Visitas LP', fmtNum(s.lpViews), '#fbbf24', cpLp ? 'R$ ' + money(cpLp) + '/visita' : '')}
      </div>`)}

      ${crmPanelDark('❤️ Engajamento', '', `<div style="${grid}">
        ${crmMiniDark('Engaj. c/ post', fmtNum(s.postEng), '#f472b6')}
        ${crmMiniDark('Curtidas/Reações', fmtNum(s.reactions), '#fb7185')}
        ${crmMiniDark('Comentários', fmtNum(s.comments), '#60a5fa')}
        ${crmMiniDark('Compartilham.', fmtNum(s.shares), '#34d399')}
        ${crmMiniDark('Salvamentos', fmtNum(s.saves), '#fbbf24')}
        ${crmMiniDark('Taxa engaj.', engRate.toFixed(2) + '%', '#22d3ee', 'engaj ÷ impr')}
        ${crmMiniDark('Custo/engaj.', costPerEng ? 'R$ ' + money(costPerEng) : '—', '#6ee7b7')}
      </div>`)}

      ${s.views > 0 ? crmPanelDark('🎬 Funil de Vídeo', '(retenção de audiência)', `
        <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start">
          <div>
            ${vstage('▶︎ Reproduções', s.views, '#3b82f6')}
            ${vstage('25% assistido', s.v25, '#6366f1')}
            ${vstage('50% assistido', s.v50, '#8b5cf6')}
            ${vstage('75% assistido', s.v75, '#a855f7')}
            ${vstage('95% assistido', s.v95, '#c026d3')}
            ${vstage('100% (assistiu tudo)', s.v100, '#22c55e')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${crmMiniDark('Tempo médio', avgWatch ? avgWatch.toFixed(1) + 's' : '—', '#a855f7')}
            ${crmMiniDark('VTR', vtr.toFixed(1) + '%', '#22c55e', '100% ÷ views')}
            ${crmMiniDark('Hold', s.v25 ? (s.v75/s.v25*100).toFixed(0) + '%' : '—', '#c4b5fd', '75% ÷ 25%')}
            ${crmMiniDark('Hook', s.views ? (s.v25/s.views*100).toFixed(0) + '%' : '—', '#60a5fa', '25% ÷ views')}
          </div>
        </div>`) : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px">
          <div style="font-size:13px;font-weight:700;color:#cbd5e1;margin-bottom:8px">💬 Mensagens</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${crmMiniDark('Conversas iniciadas', fmtNum(s.messages), '#22c55e')}
            ${crmMiniDark('Custo/conversa', cplMsg ? 'R$ ' + money(cplMsg) : '—', '#6ee7b7')}
          </div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px">
          <div style="font-size:13px;font-weight:700;color:#cbd5e1;margin-bottom:8px">🧲 Leads & Conversão</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            ${crmMiniDark('Leads', fmtNum(s.leads), '#14b8a6')}
            ${crmMiniDark('Custo/lead', cplLead ? 'R$ ' + money(cplLead) : '—', '#6ee7b7')}
            ${crmMiniDark('Valor conv.', s.leadValue ? 'R$ ' + moneyShort(s.leadValue) : 'R$ 0', '#fbbf24')}
          </div>
        </div>
      </div>
    </div>`;
}

/* ───────────────────────── ABA: TRÁFEGO (Meta operacional) ───────────────────────── */
function tabTrafego() {
  const d = _data || {};
  const accounts = d.accounts || [];
  const allCampaigns = d.campaigns || [];
  const t = periodTotals(accounts);
  const al = computeAlerts(allCampaigns);
  const verbaRisco = al.burning.reduce((s, c) => s + (c.spend || 0), 0);
  const totalAlerts = al.burning.length + al.cplHigh.length + al.fadiga.length + al.ctrLow.length + al.qualBaixo.length;

  let campaigns = allCampaigns.slice();
  if (_statusFilter !== 'todos') campaigns = campaigns.filter(c => (c.status || '').toLowerCase() === _statusFilter);
  if (_filter) { const q = _filter.toLowerCase(); campaigns = campaigns.filter(c => (c.name || '').toLowerCase().includes(q) || (c.account || '').toLowerCase().includes(q)); }
  campaigns.sort((a, b) => {
    if (_sort === 'spend') return (b.spend || 0) - (a.spend || 0);
    if (_sort === 'cpl') return (b.cpr || 0) - (a.cpr || 0);
    if (_sort === 'results') return (b.results || 0) - (a.results || 0);
    if (_sort === 'frequency') return (b.frequency || 0) - (a.frequency || 0);
    if (_sort === 'ctr') return (a.ctr || 0) - (b.ctr || 0);
    if (_sort === 'impressions') return (b.impressions || 0) - (a.impressions || 0);
    return 0;
  });

  return `
    ${metaMetricsCockpit()}
    <div class="flex gap-3" style="flex-wrap:wrap">
      ${kpi('💰 Investido', 'R$ ' + money(t.spend), 'no período', '#dc2626')}
      ${kpi('🎯 Resultados', fmtNum(t.results), t.cpl ? `CPL médio: R$ ${money(t.cpl)}` : 'sem conversões', '#16a34a')}
      ${kpi('👁 Alcance', fmtNum(t.reach), `${fmtNum(t.impressions)} impressões · freq ${t.freq.toFixed(2)}`, '#2563eb')}
      ${kpi('📊 CTR', t.ctr.toFixed(2) + '%', `CPM: R$ ${money(t.cpm)} · ${fmtNum(t.clicks)} cliques`, '#7c3aed')}
      ${t.roas > 0 ? kpi('📈 ROAS (pixel)', t.roas.toFixed(2) + 'x', `R$ ${money(t.purchaseValue)} em vendas`, '#0891b2') : ''}
    </div>

    <div class="mt-4" style="margin-top:18px">
      <div class="flex items-center gap-2" style="margin-bottom:10px">
        <h3 class="card-title" style="margin:0">⚠️ Central de Alertas</h3>
        <span class="tiny" style="background:${totalAlerts ? '#dc2626' : '#16a34a'};color:#fff;padding:2px 10px;border-radius:var(--r-full);font-weight:800">${totalAlerts}</span>
        ${verbaRisco > 0 ? `<span class="tiny" style="color:#dc2626;font-weight:800;margin-left:6px">🔥 R$ ${money(verbaRisco)} em risco</span>` : ''}
        <button class="btn btn-ghost tiny" id="ma-th" style="margin-left:auto">⚙️ Limiares</button>
      </div>
      <div id="ma-th-panel" style="display:none"></div>
      ${totalAlerts === 0 ? '<div class="alert alert-ok">✅ Nenhum alerta. Campanhas ativas dentro dos limiares.</div>' : `<div style="display:grid;gap:10px">
        ${alertCard('🔴', 'CRÍTICO · Verba queimando sem resultado', '#dc2626', al.burning, `Ativas que já gastaram ≥ R$ ${_th.gasto} e geraram 0 resultados.`, c => `gastou <strong>R$ ${money(c.spend)}</strong> · 0 result.`, true)}
        ${alertCard('🟠', 'CPL acima da meta', '#ea580c', al.cplHigh, `CPL acima de R$ ${_th.cpl}.`, c => `CPL <strong>R$ ${money(c.cpr)}</strong> · ${fmtNum(c.results)} result.`)}
        ${alertCard('🟠', 'Fadiga de criativo (frequência alta)', '#d97706', al.fadiga, `Frequência > ${_th.freq.toFixed(1)} — público saturado.`, c => `freq <strong>${(c.frequency || 0).toFixed(2)}</strong> · alcance ${fmtNum(c.reach)}`)}
        ${alertCard('🟡', 'CTR baixo (criativo fraco)', '#ca8a04', al.ctrLow, `CTR < ${_th.ctr.toFixed(1)}% com ≥ 500 impressões.`, c => `CTR <strong>${(c.ctr || 0).toFixed(2)}%</strong> · ${fmtNum(c.impressions)} imp.`)}
        ${alertCard('🟡', 'Ranking de qualidade baixo', '#ca8a04', al.qualBaixo, 'Meta classificou abaixo da média — afeta entrega e custo.', c => `qualidade <strong>${escapeHtml(rankLabel(c.qualityRanking))}</strong>`)}
      </div>`}
    </div>

    ${accounts.length > 0 ? `
      <div class="mt-4" style="margin-top:18px">
        <h3 class="card-title">🏢 Contas Meta</h3>
        <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:620px">
          <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:6px 10px">Conta</th><th style="text-align:right;padding:6px 8px">Investido</th>
            <th style="text-align:right;padding:6px 8px">Result.</th><th style="text-align:right;padding:6px 8px">CPL</th>
            <th style="text-align:right;padding:6px 8px">CTR</th><th style="text-align:right;padding:6px 8px">Freq</th><th style="text-align:right;padding:6px 8px">ROAS</th>
          </tr></thead><tbody>
            ${accounts.map(a => `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:5px 10px;font-weight:600">${escapeHtml(a.label || a.id)}${a._error ? ' <span class="tiny" style="color:#dc2626">⚠️</span>' : ''}</td>
              <td style="text-align:right;padding:5px 8px;color:#dc2626">R$ ${money(a.spend)}</td>
              <td style="text-align:right;padding:5px 8px;color:#16a34a">${fmtNum(a.results)}</td>
              <td style="text-align:right;padding:5px 8px">${a.cpr ? 'R$ ' + money(a.cpr) : '—'}</td>
              <td style="text-align:right;padding:5px 8px">${a.ctr != null ? a.ctr.toFixed(2) + '%' : '—'}</td>
              <td style="text-align:right;padding:5px 8px">${a.frequency ? a.frequency.toFixed(2) : '—'}</td>
              <td style="text-align:right;padding:5px 8px">${a.roas ? a.roas.toFixed(2) + 'x' : '—'}</td>
            </tr>`).join('')}
          </tbody></table></div>
      </div>` : ''}

    <div class="mt-4" style="margin-top:18px">
      <h3 class="card-title">🎯 Campanhas <span class="muted tiny" style="font-weight:400">(${campaigns.length}/${allCampaigns.length})</span></h3>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);margin:8px 0">
        <select id="ma-status" class="select" style="padding:5px 10px;font-size:12px">
          <option value="todos"${_statusFilter==='todos'?' selected':''}>Todos status</option>
          <option value="active"${_statusFilter==='active'?' selected':''}>Ativas</option>
          <option value="paused"${_statusFilter==='paused'?' selected':''}>Pausadas</option>
        </select>
        <select id="ma-sort" class="select" style="padding:5px 10px;font-size:12px">
          <option value="spend"${_sort==='spend'?' selected':''}>Maior gasto</option>
          <option value="cpl"${_sort==='cpl'?' selected':''}>Maior CPL</option>
          <option value="results"${_sort==='results'?' selected':''}>Mais resultados</option>
          <option value="frequency"${_sort==='frequency'?' selected':''}>Maior frequência</option>
          <option value="ctr"${_sort==='ctr'?' selected':''}>Menor CTR</option>
          <option value="impressions"${_sort==='impressions'?' selected':''}>Mais impressões</option>
        </select>
        <input id="ma-filter" class="input" placeholder="campanha ou conta…" value="${escapeHtml(_filter)}" style="padding:5px 10px;font-size:12px;width:200px;margin-left:auto">
      </div>
      ${campaigns.length === 0 ? '<div class="muted tiny">Sem campanhas no período/filtro.</div>' : `
        <div style="overflow-x:auto"><table style="width:100%;font-size:11.5px;border-collapse:collapse;min-width:920px">
          <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="padding:6px 8px"></th><th style="text-align:left;padding:6px 8px">Status</th><th style="text-align:left;padding:6px 8px">Conta</th>
            <th style="text-align:left;padding:6px 8px">Campanha</th><th style="text-align:right;padding:6px 8px">Gasto</th><th style="text-align:right;padding:6px 8px">Imp.</th>
            <th style="text-align:right;padding:6px 8px">CTR</th><th style="text-align:right;padding:6px 8px">Freq</th><th style="text-align:right;padding:6px 8px">Result.</th>
            <th style="text-align:right;padding:6px 8px">CPL</th><th style="text-align:center;padding:6px 8px">Ação</th>
          </tr></thead><tbody>${campaigns.map(campaignRow).join('')}</tbody></table></div>`}
    </div>
  `;
}

/* ───────────────────────── ABA: CRIATIVOS (Aba 4) ───────────────────────── */
function tabCriativos() {
  const all = (_data?.campaigns || []).filter(c => (c.impressions || 0) > 0);
  all.sort((a, b) => (b.spend || 0) - (a.spend || 0));
  return `
    <p class="card-sub">Laboratório de criativos — valida gancho, retenção e intenção antes de escalar. Métricas por campanha (a Meta não expõe nível de anúncio neste feed).</p>
    ${all.length === 0 ? '<div class="muted tiny mt-2">Sem campanhas com impressões no período.</div>' : `
      <div style="overflow-x:auto;margin-top:10px"><table style="width:100%;font-size:11.5px;border-collapse:collapse;min-width:900px">
        <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:6px 8px">Campanha</th>
          <th style="text-align:right;padding:6px 8px" title="% que assistiu os 3s iniciais (thumbstop)">Gancho 3s</th>
          <th style="text-align:right;padding:6px 8px" title="Retenção / assistência completa">Retenção</th>
          <th style="text-align:right;padding:6px 8px">CTR geral</th>
          <th style="text-align:right;padding:6px 8px" title="Cliques de link / impressões (intenção real)">CTR link</th>
          <th style="text-align:right;padding:6px 8px">Freq</th>
          <th style="text-align:right;padding:6px 8px">CPM</th>
          <th style="text-align:center;padding:6px 8px" title="Qualidade · Engajamento · Conversão (Meta)">Relevância</th>
        </tr></thead><tbody>
          ${all.map(criativoRow).join('')}
        </tbody></table></div>
      <div class="flex gap-3 mt-3 tiny muted" style="flex-wrap:wrap;margin-top:10px">
        <span>🟢 ok · 🟠 atenção · 🔴 fraco</span>
        <span>Gancho saudável ≥ 25% · Freq fadiga > ${_th.freq.toFixed(1)} · CTR link bom ≥ 1%</span>
      </div>`}
    ${breakdownSection()}
  `;
}

/* ─── Breakdowns Meta sob demanda (Sprint 9.15) ─── */
function breakdownSection() {
  const sel = BREAKDOWNS.map(b => `<option value="${b.id}"${b.id === _bdSel ? ' selected' : ''}>${b.lbl}</option>`).join('');
  let body;
  if (_bdBusy) {
    body = '<div class="flex items-center gap-2 muted tiny" style="padding:10px"><span class="spinner"></span> Consultando o Meta…</div>';
  } else if (!_bd) {
    body = '<div class="muted tiny" style="padding:10px">Escolha uma dimensão e clique em <strong>Analisar</strong> para quebrar o gasto/leads do período.</div>';
  } else if (_bd.ok === false) {
    body = `<div class="alert alert-warn mt-2">⚠️ ${escapeHtml(_bd.error || 'Falha ao buscar breakdown')}</div>`;
  } else {
    body = (_bd.accounts || []).map(acc => {
      if (!acc.rows || !acc.rows.length) {
        return `<div class="mt-2"><strong>${escapeHtml(acc.label)}</strong> <span class="muted tiny">— ${acc._error ? escapeHtml(acc._error) : 'sem dados'}</span></div>`;
      }
      return `<div class="mt-3" style="margin-top:12px"><strong>${escapeHtml(acc.label)}</strong>
        <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:560px;margin-top:6px">
          <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:6px 10px">Segmento</th>
            <th style="text-align:right;padding:6px 8px">Gasto</th><th style="text-align:right;padding:6px 8px">Leads</th>
            <th style="text-align:right;padding:6px 8px">CPL</th><th style="text-align:right;padding:6px 8px">CTR</th>
          </tr></thead><tbody>
          ${acc.rows.map(r => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:6px 10px;font-weight:600">${escapeHtml(r.segment)}</td>
            <td style="text-align:right;padding:6px 8px;color:#dc2626">R$ ${money(r.spend)}</td>
            <td style="text-align:right;padding:6px 8px">${fmtNum(r.results)}</td>
            <td style="text-align:right;padding:6px 8px;font-weight:700">${r.cpl ? 'R$ ' + money(r.cpl) : '—'}</td>
            <td style="text-align:right;padding:6px 8px">${r.ctr ? r.ctr.toFixed(2) + '%' : '—'}</td>
          </tr>`).join('')}
        </tbody></table></div></div>`;
    }).join('') || '<div class="muted tiny" style="padding:10px">Sem dados no período.</div>';
  }
  return `<div class="mt-4" style="margin-top:18px">
    <div class="flex items-center gap-2" style="flex-wrap:wrap">
      <h3 class="card-title" style="margin:0">🔍 Breakdowns Meta</h3>
      <select id="bd-sel" class="select" style="padding:5px 10px;font-size:12px">${sel}</select>
      <button class="btn btn-primary btn-sm" id="bd-go">Analisar</button>
      ${_bd && _bd.cache && _bd.cache.hit ? '<span class="muted tiny">cache ' + (_bd.cache.age_s || 0) + 's</span>' : ''}
    </div>
    ${body}
  </div>`;
}
function criativoRow(c) {
  const gancho = (c.thumbstop || 0) * 100;            // v3/impressões
  const ret = (c.holdRate ? c.holdRate * 100 : (c.vtr ? c.vtr * 100 : 0)); // retenção
  const ctrL = outboundCtr(c);
  const isVideo = (c.views || 0) > 0 || gancho > 0;
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px"><div style="font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name||'')}">${escapeHtml(c.name||'—')}</div><div class="tiny muted">${escapeHtml(c.account||'')}</div></td>
      <td style="text-align:right;padding:5px 8px;${gancho?colorVal(gancho>=25?2:gancho>=15?1:0):''}">${isVideo ? gancho.toFixed(0)+'%' : '—'}</td>
      <td style="text-align:right;padding:5px 8px">${isVideo && ret ? ret.toFixed(0)+'%' : '—'}</td>
      <td style="text-align:right;padding:5px 8px">${(c.ctr||0).toFixed(2)}%</td>
      <td style="text-align:right;padding:5px 8px;${colorVal(ctrL>=1?2:ctrL>=0.5?1:0)}">${ctrL.toFixed(2)}%</td>
      <td style="text-align:right;padding:5px 8px;${colorVal((c.frequency||0)<=2?2:(c.frequency||0)<=_th.freq?1:0)}">${c.frequency?c.frequency.toFixed(2):'—'}</td>
      <td style="text-align:right;padding:5px 8px">R$ ${money(c.cpm)}</td>
      <td style="text-align:center;padding:5px 8px;white-space:nowrap">${rankDot(c.qualityRanking)}${rankDot(c.engagementRanking)}${rankDot(c.conversionRanking)}</td>
    </tr>`;
}

/* ───────────────────────── ABA: VENDAS (Aba 5 · Motor de Vendas) ───────────────────────── */
function tabVendas() {
  if (!_crm) return crmWarn();
  const g = _crm.global;
  const mb = metricsBasis();
  const slaLabel = mb === 'real' ? '⚡ SLA 1º contato' : '⚡ SLA 1º atend.';
  const motivos = g.motivos_perda || [];
  const maxMot = motivos.reduce((m, x) => Math.max(m, x.n), 0) || 1;
  return `
    <p class="card-sub">Motor de Vendas (TV War Arena) — o que acontece com o lead depois do clique. Dados do RD Station no período.</p>
    <div class="flex gap-3 mt-3" style="flex-wrap:wrap;margin-top:12px">
      ${kpi('🎯 Conversão', g.taxa_conversao != null ? g.taxa_conversao + '%' : '—', `${g.vendas} ganhos / ${g.perdas} perdas`, '#16a34a')}
      ${kpi('⏱ Ciclo de venda', cycleLbl(g.ranking), 'mediana lead → ganho', '#2563eb')}
      ${kpi('📞 Contact Rate', contactGlobal(), `leads que saíram da entrada ${basisChip(mb)}`, '#7c3aed')}
      ${kpi('🚪 Show-up / Visita', visitaGlobal(), `contatados que chegaram à visita ${basisChip(mb)}`, '#0891b2')}
      ${kpi(slaLabel, slaGlobal(), `${mb === 'real' ? 'criação → 1º contato (eventos reais)' : 'criação → última atividade RD'} ${basisChip(mb)}`, '#ea580c')}
    </div>

    <div class="mt-4" style="margin-top:18px">
      <h3 class="card-title">🧯 Concentração de motivos de perda</h3>
      ${motivos.length === 0 ? '<div class="muted tiny">Sem perdas registradas no período.</div>' : `
        <div style="display:grid;gap:6px;margin-top:8px">
          ${motivos.map(m => `
            <div style="display:flex;align-items:center;gap:10px;font-size:12px">
              <span style="flex:0 0 220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(m.motivo)}">${escapeHtml(m.motivo)}</span>
              <div style="flex:1;background:var(--bg-3);border-radius:var(--r-full);height:16px;overflow:hidden">
                <div style="width:${(m.n/maxMot*100).toFixed(0)}%;height:100%;background:#dc2626"></div>
              </div>
              <span class="tiny" style="flex:0 0 90px;text-align:right;font-weight:700">${m.n} · ${(m.pct||0).toFixed(0)}%</span>
            </div>`).join('')}
        </div>`}
    </div>

    <div class="mt-4" style="margin-top:18px">
      <h3 class="card-title">🏆 Ranking de corretores (período)</h3>
      ${(g.ranking||[]).length === 0 ? '<div class="muted tiny">Sem vendas/perdas atribuídas no período.</div>' : `
        <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:520px">
          <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:6px 10px">#</th><th style="text-align:left;padding:6px 8px">Corretor</th>
            <th style="text-align:right;padding:6px 8px">Vendas</th><th style="text-align:right;padding:6px 8px">VGV</th>
            <th style="text-align:right;padding:6px 8px">Perdas</th>
          </tr></thead><tbody>
            ${g.ranking.map((o, i) => `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:5px 10px;font-weight:800;color:${i===0?'#d97706':'var(--ink-muted)'}">${i+1}º</td>
              <td style="padding:5px 8px;font-weight:600">${escapeHtml(o.nome || o.email || '—')}</td>
              <td style="text-align:right;padding:5px 8px;color:#16a34a;font-weight:700">${fmtNum(o.vendas)}</td>
              <td style="text-align:right;padding:5px 8px;font-weight:700">R$ ${moneyShort(o.vgv)}</td>
              <td style="text-align:right;padding:5px 8px;color:#dc2626">${fmtNum(o.perdas)}</td>
            </tr>`).join('')}
          </tbody></table></div>`}
    </div>
    <div class="alert ${mb === 'real' ? 'alert-ok' : 'alert-warn'} mt-3" style="margin-top:12px">
      ${mb === 'real'
        ? `✅ <strong>Métricas reais</strong> desde ${fmtDateBR(_crm.capture_since)} — Contact Rate, Show-up e SLA vêm dos <em>eventos de mudança de etapa</em> capturados (webhook RD + sync). O período selecionado está coberto.`
        : `⏳ <strong>Capturando eventos.</strong> Contact/Show-up/SLA ainda são <em>estimativa</em> do funil sincronizado — o RD v1 não guarda histórico de transição. Assim que houver eventos cobrindo o período inteiro, viram <strong>reais</strong> sozinhos. Ativar o webhook no RD acelera a captura (instantânea em vez de 3×/dia).`}
    </div>
  `;
}
function cycleLbl(ranking) {
  // ciclo global = mediana dos ciclos por marca de venda
  const vals = [];
  Object.keys(_crm.brands || {}).forEach(k => { if (k !== 'captacao' && _crm.brands[k].ciclo_medio_dias != null) vals.push(_crm.brands[k].ciclo_medio_dias); });
  if (!vals.length) return '—';
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg.toFixed(0) + ' dias';
}
function contactGlobal() {
  // média ponderada por leads
  let totLeads = 0, totContact = 0;
  Object.keys(_crm.brands || {}).forEach(k => {
    if (k === 'captacao') return;
    const b = _crm.brands[k];
    if (b.leads_criados && b.contact_rate != null) { totLeads += b.leads_criados; totContact += b.contact_rate / 100 * b.leads_criados; }
  });
  return totLeads ? (totContact / totLeads * 100).toFixed(0) + '%' : '—';
}
function visitaGlobal() {
  const vals = [];
  Object.keys(_crm.brands || {}).forEach(k => { if (k !== 'captacao' && _crm.brands[k].visita_rate != null) vals.push(_crm.brands[k].visita_rate); });
  if (!vals.length) return '—';
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0) + '%';
}
function slaGlobal() {
  const vals = [];
  Object.keys(_crm.brands || {}).forEach(k => { if (k !== 'captacao' && _crm.brands[k].sla_horas_aprox != null) vals.push(_crm.brands[k].sla_horas_aprox); });
  if (!vals.length) return '—';
  const h = vals.reduce((a, b) => a + b, 0) / vals.length;
  return h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(1) + ' h';
}
// Base do dado: 'real' (eventos de etapa capturados) vs 'estimativa' (proxy do funil).
function metricsBasis() { return (_crm && _crm.metrics_basis) || 'estimativa'; }
function basisChip(b) {
  b = b || metricsBasis();
  return b === 'real'
    ? `<span style="display:inline-block;padding:1px 6px;border-radius:var(--r-full);background:#dcfce7;color:#15803d;font-weight:800;font-size:10px;vertical-align:middle">✓ real</span>`
    : `<span style="display:inline-block;padding:1px 6px;border-radius:var(--r-full);background:#fef3c7;color:#b45309;font-weight:800;font-size:10px;vertical-align:middle">≈ estimativa</span>`;
}
function fmtDateBR(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (_) { return iso || '—'; } }

/* ─── Atribuição honesta por canal (Sprint 9.14) ─── */
// Selo de cobertura: % do VGV ganho que tem origem marcada no RD.
function attrChip(cov) {
  if (cov == null) return '';
  const c = cov >= 80 ? '#15803d' : cov >= 50 ? '#b45309' : '#dc2626';
  const bg = cov >= 80 ? '#dcfce7' : cov >= 50 ? '#fef3c7' : '#fee2e2';
  return ` <span style="display:inline-block;padding:1px 6px;border-radius:var(--r-full);background:${bg};color:${c};font-weight:800;font-size:10px;vertical-align:middle">${cov}% c/ origem</span>`;
}
function attrBanner(attr) {
  const cov = attr && attr.coverage_pct;
  if (cov == null) return '';
  if (cov < 60) {
    const semOrigem = (100 - cov).toFixed(0);
    return `<div style="margin-top:14px;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);color:#fde68a;border-radius:12px;padding:10px 14px;font-size:12px">⚠️ <strong>${semOrigem}% do VGV ganho está sem origem marcada no RD.</strong> VGV Influenciado e ROAS consideram só ganhos com origem de mídia paga (Meta/Google) — nunca o total. Marque a origem dos deals no RD pra subir a precisão.</div>`;
  }
  return `<div style="margin-top:14px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);color:#86efac;border-radius:12px;padding:10px 14px;font-size:12px">✅ ${cov}% do VGV ganho com origem marcada no RD — atribuição confiável.</div>`;
}
function attrChannelTable(attr) {
  const rows = (attr && attr.by_channel) || [];
  if (!rows.length) return '<div style="color:#64748b;font-size:12px">Sem ganhos/leads com canal no período.</div>';
  const totalVgv = rows.reduce((s, r) => s + (r.vgv || 0), 0);
  return `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:560px">
    <thead><tr style="color:#94a3b8;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.1)">
      <th style="text-align:left;padding:6px 10px">Canal</th>
      <th style="text-align:right;padding:6px 8px">Leads</th><th style="text-align:right;padding:6px 8px">Vendas</th>
      <th style="text-align:right;padding:6px 8px">VGV</th><th style="text-align:right;padding:6px 8px">% VGV</th>
    </tr></thead><tbody>
    ${rows.map(r => {
      const pct = totalVgv > 0 ? (r.vgv / totalVgv * 100) : 0;
      const isPaid = r.channel === 'meta' || r.channel === 'google';
      const isUnatt = r.channel === 'nao_atribuido';
      const col = isUnatt ? '#64748b' : isPaid ? '#c4b5fd' : '#7dd3fc';
      return `<tr style="border-top:1px solid rgba(255,255,255,0.06)">
        <td style="padding:6px 10px;font-weight:700;color:${col}">${escapeHtml(r.label)}${isPaid ? ' 💳' : ''}</td>
        <td style="text-align:right;padding:6px 8px;color:#e2e8f0">${fmtNum(r.leads)}</td>
        <td style="text-align:right;padding:6px 8px;color:#4ade80">${fmtNum(r.vendas)}</td>
        <td style="text-align:right;padding:6px 8px;font-weight:700;color:#f1f5f9">R$ ${moneyShort(r.vgv)}</td>
        <td style="text-align:right;padding:6px 8px;color:#cbd5e1">${pct.toFixed(0)}%</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

/* ───────────────────────── ABA: SEMÁFORO (Aba 6) ───────────────────────── */
function classifySemaforo(c) {
  const target = brandInfo(c.account).cplAlvo;
  const freq = c.frequency || 0, cpl = c.cpr || 0, res = c.results || 0, spend = c.spend || 0, imp = c.impressions || 0;
  if ((res === 0 && spend >= _th.gasto) || (res > 0 && cpl > target * 1.5)) return 'sangria';
  if (freq > 5 || (imp >= 1000 && (c.thumbstop || 0) > 0 && (c.thumbstop || 0) < 0.20)) return 'troca';
  if (res > 0 && cpl <= target && freq < 2.0) return 'vertical';
  if (res > 0 && cpl <= target * 1.3 && freq >= 2.0) return 'horizontal';
  return 'manter';
}
function tabSemaforo() {
  const active = (_data?.campaigns || []).filter(c => (c.status || '').toLowerCase() === 'active');
  const buckets = { vertical: [], horizontal: [], troca: [], sangria: [], manter: [] };
  active.forEach(c => buckets[classifySemaforo(c)].push(c));
  Object.keys(buckets).forEach(k => buckets[k].sort((a, b) => (b.spend || 0) - (a.spend || 0)));
  const metric = c => `CPL <strong>${c.cpr ? 'R$ ' + money(c.cpr) : '—'}</strong> · freq ${(c.frequency||0).toFixed(2)} · ${fmtNum(c.results)} result. · R$ ${money(c.spend)}`;
  return `
    <p class="card-sub">Decisão de escala sem achismo. CPL alvo por marca: Conquista R$ 25 · Imóveis R$ 150 · Locação R$ 60 (proxy de CPO).</p>
    <div style="display:grid;gap:10px;margin-top:12px">
      ${semaCard('🚀', 'Escala Vertical · aumentar orçamento 20%', '#16a34a', buckets.vertical, 'CPL no alvo + frequência baixa (<2.0). O leilão ainda tem lead barato.', metric, true)}
      ${semaCard('🧭', 'Escala Horizontal · novo público / lookalike', '#2563eb', buckets.horizontal, 'CPL ainda ok mas frequência subindo — o público atual está secando.', metric)}
      ${semaCard('♻️', 'Troca de Criativo · acionar videomaker', '#d97706', buckets.troca, 'Frequência alta (>5) ou gancho fraco — anúncio cansado.', metric, true)}
      ${semaCard('🛑', 'Sangria · pausar imediatamente', '#dc2626', buckets.sangria, 'Verba virando pó: 0 resultado com gasto ou CPL muito acima do alvo.', metric, true)}
      ${semaCard('🟢', 'Manter · estável', '#64748b', buckets.manter, 'Dentro do esperado, sem ação urgente.', metric)}
    </div>
    <div class="alert alert-warn mt-3" style="margin-top:12px">🔌 <strong>Roadmap:</strong> "Perda de IS por orçamento" exige métricas avançadas do Google Ads; "CTR Decay" exige histórico diário acumulado — próximos sprints. <span class="muted">(Breakdown por hora já disponível na aba Criativos · Google Ads conectável na aba Executiva.)</span></div>
  `;
}
function semaCard(icon, title, color, items, desc, fmtItem, withAction) {
  if (!items.length) return `<div style="background:var(--bg-3);border-left:4px solid ${color}55;border-radius:var(--r-md);padding:10px 14px"><span style="font-weight:800;color:${color}">${icon} ${escapeHtml(title)}</span> <span class="tiny muted">· nenhuma</span></div>`;
  return `
    <div style="background:${color}10;border-left:4px solid ${color};border-radius:var(--r-md);padding:12px 14px">
      <div style="font-weight:800;color:${color}">${icon} ${escapeHtml(title)} <span class="tiny" style="font-weight:700">· ${items.length}</span></div>
      <div class="tiny muted" style="margin:2px 0 8px">${escapeHtml(desc)}</div>
      <div style="display:grid;gap:5px">
        ${items.slice(0, 12).map(c => `<div class="tiny" style="display:flex;gap:8px;align-items:center">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name||'')}">${escapeHtml(c.account?'['+c.account+'] ':'')}${escapeHtml(c.name||'—')}</span>
          <span style="white-space:nowrap">${fmtItem(c)}</span>
          ${withAction ? `<button class="btn btn-ghost tiny" data-act="pause" data-cid="${c.id}" data-cname="${escapeHtml(c.name||'')}" title="Pausar">⏸</button>` : ''}
        </div>`).join('')}
        ${items.length > 12 ? `<div class="tiny muted">+ ${items.length - 12} outra(s)…</div>` : ''}
      </div>
    </div>`;
}

/* ───────────────────────── ABA: POR MARCA (Abas 2+3) ───────────────────────── */
function tabMarca() {
  const campaigns = _data?.campaigns || [];
  const groups = {};
  campaigns.forEach(c => { const k = c.account || '—'; (groups[k] = groups[k] || []).push(c); });
  const keys = Object.keys(groups).sort((a, b) => sumSpend(groups[b]) - sumSpend(groups[a]));
  if (!keys.length) return '<div class="muted tiny">Sem campanhas no período.</div>';
  return `
    <p class="card-sub">Cada conta Meta = uma marca. Metas e funil de venda (RD) embutidos por segmento.</p>
    <div style="display:grid;gap:14px;margin-top:12px">
      ${keys.map(k => marcaPanel(k, groups[k])).join('')}
    </div>
    ${_crm ? '' : `<div class="mt-3" style="margin-top:12px">${crmWarn()}</div>`}
  `;
}
function sumSpend(arr) { return arr.reduce((s, c) => s + (c.spend || 0), 0); }
function marcaPanel(label, camps) {
  const bi = brandInfo(label);
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0 };
  camps.forEach(c => { t.spend += c.spend||0; t.impressions += c.impressions||0; t.reach += c.reach||0; t.clicks += c.clicks||0; t.results += c.results||0; });
  const cpl = t.results > 0 ? t.spend / t.results : 0;
  const ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
  const freq = t.reach > 0 ? t.impressions / t.reach : 0;
  const cplOk = cpl > 0 && cpl <= bi.cplAlvo;
  const ativas = camps.filter(c => (c.status||'').toLowerCase() === 'active').length;
  // CRM cruzado p/ essa marca
  const crm = _crm?.brands?.[bi.key];
  const cac = crm && crm.vendas ? t.spend / crm.vendas : 0;
  const cpo = crm && crm.leads_criados ? t.spend / crm.leads_criados : 0;
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-left:5px solid ${bi.cor};border-radius:var(--r-md);padding:14px 16px">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="font-weight:900;font-size:15px;color:${bi.cor}">${escapeHtml(label)}</div>
        <span class="tiny" style="background:${bi.cor}22;color:${bi.cor};padding:2px 8px;border-radius:var(--r-full);font-weight:700">${escapeHtml(bi.brand)} · ${escapeHtml(bi.sub)}</span>
        <span class="tiny muted" style="margin-left:auto">${ativas} ativa(s) / ${camps.length} campanha(s)</span>
      </div>
      <div class="tiny muted" style="margin-top:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Mídia (Meta)</div>
      <div class="flex gap-2 mt-1" style="flex-wrap:wrap;margin-top:4px">
        ${miniKpi('Investido', 'R$ ' + money(t.spend), '#dc2626')}
        ${miniKpi('Result. Meta', fmtNum(t.results), '#16a34a')}
        ${miniKpi('CPL Meta', cpl ? 'R$ ' + money(cpl) : '—', cplOk ? '#16a34a' : '#ea580c', `alvo R$ ${bi.cplAlvo}`)}
        ${miniKpi('CTR', ctr.toFixed(2) + '%', '#7c3aed')}
        ${miniKpi('Freq', freq.toFixed(2), freq > _th.freq ? '#d97706' : '#2563eb')}
      </div>
      ${crm ? `
        <div class="tiny muted" style="margin-top:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Vendas (RD CRM)</div>
        <div class="flex gap-2 mt-1" style="flex-wrap:wrap;margin-top:4px">
          ${miniKpi('Leads RD', fmtNum(crm.leads_criados), '#2563eb')}
          ${miniKpi('Vendas', fmtNum(crm.vendas), '#16a34a')}
          ${miniKpi('CAC', cac ? 'R$ ' + money(cac) : '—', '#ea580c', 'gasto ÷ vendas')}
          ${miniKpi(bi.key==='conquista'?'CPL-R':'CPO', cpo ? 'R$ ' + money(cpo) : '—', cpo && cpo <= bi.cplAlvo ? '#16a34a' : '#d97706', 'gasto ÷ leads')}
          ${miniKpi('VGV', 'R$ ' + moneyShort(crm.vgv), '#7c3aed')}
          ${miniKpi('Conversão', crm.taxa_conversao != null ? crm.taxa_conversao + '%' : '—', '#0891b2')}
          ${miniKpi('Ciclo', crm.ciclo_medio_dias != null ? crm.ciclo_medio_dias + 'd' : '—', '#64748b')}
          ${bi.key==='conquista' && crm.trash_rate != null ? miniKpi('Trash Rate', crm.trash_rate + '%', crm.trash_rate <= 25 ? '#16a34a' : '#dc2626', 'leads descartados') : ''}
        </div>` : ''}
    </div>`;
}
function miniKpi(label, val, color, sub) {
  return `<div style="flex:1;min-width:110px;background:var(--bg-3);border-radius:var(--r-sm);padding:8px 12px">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px;font-weight:700">${label}</div>
    <div style="font-size:17px;font-weight:900;color:${color}">${val}</div>
    ${sub ? `<div class="tiny muted">${sub}</div>` : ''}
  </div>`;
}

/* ─── Versões DARK p/ a seção CRM da Executiva (mesmo padrão premium do hero) ─── */
function crmKpiDark(label, value, sub, color) {
  return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-left:4px solid ${color};border-radius:14px;padding:12px 14px">
    <div style="font-size:11px;color:#94a3b8;letter-spacing:.4px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:23px;font-weight:800;color:${color};line-height:1.1;margin-top:3px">${value}</div>
    <div style="font-size:11px;color:#64748b;margin-top:3px">${sub || ''}</div>
  </div>`;
}
function crmMiniDark(label, val, color, sub) {
  return `<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:8px 10px">
    <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;font-weight:700">${label}</div>
    <div style="font-size:17px;font-weight:800;color:${color || '#f1f5f9'}">${val}</div>
    ${sub ? `<div style="font-size:10px;color:#64748b">${sub}</div>` : ''}
  </div>`;
}
function crmPanelDark(title, sub, inner) {
  return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px;margin-top:14px">
    <div style="font-size:13px;font-weight:700;color:#cbd5e1;margin-bottom:8px">${title}${sub ? ` <span style="font-weight:500;color:#64748b;font-size:11px">${sub}</span>` : ''}</div>
    ${inner}
  </div>`;
}

/* ───────────────────────── compartilhados ───────────────────────── */
// ─── Eficiência por Produto (Meta × CRM): CPL · CPQL · Custo/Visita · ROAS ───
const OO_COMISSAO_PCT = 0.04;  // comissão bruta PSM sobre o VGV (premissa Diretoria)
function produtoEficienciaPanel() {
  if (!_crm || !_crm.brands) return '';
  const byBrand = metaSpendByBrand(filteredAccounts());
  const order = ['conquista', 'imoveis', 'locacao', 'captacao'];
  const rows = order.map(k => {
    const m = byBrand[k], c = _crm.brands?.[k];
    if (!m && !c) return '';
    const spend = m?.spend || 0;
    const leads = c?.leads_criados || 0;
    const qual = c?.leads_contatados || 0;     // qualificado ≈ lead que avançou/foi contatado
    const visitas = c?.leads_visita || 0;
    const vendas = c?.vendas || 0;
    const vgv = c?.vgv || 0;
    const comissao = vgv * OO_COMISSAO_PCT;
    const cpl = leads ? spend / leads : 0;
    const cpql = qual ? spend / qual : 0;
    const cpar = visitas ? spend / visitas : 0;
    const roas = spend ? comissao / spend : 0;
    const bi = brandInfo(k === 'conquista' ? 'conquista' : k === 'locacao' ? 'locacao' : 'imoveis');
    const cell = (v, col) => `<td style="text-align:right;padding:6px 8px;color:${col || '#e2e8f0'}">${v}</td>`;
    return `<tr style="border-top:1px solid rgba(255,255,255,0.06)">
      <td style="padding:6px 10px;font-weight:700;color:${bi.cor}">${escapeHtml(c?.label || bi.brand)}</td>
      ${cell('R$ ' + money(spend), '#f87171')}
      ${cell(fmtNum(leads))}
      ${cell(cpl ? 'R$ ' + money(cpl) : '—', '#fbbf24')}
      ${cell(fmtNum(qual))}
      ${cell(cpql ? 'R$ ' + money(cpql) : '—', '#fb923c')}
      ${cell(fmtNum(visitas))}
      ${cell(cpar ? 'R$ ' + money(cpar) : '—', '#f472b6')}
      ${cell(fmtNum(vendas), '#4ade80')}
      ${cell('R$ ' + moneyShort(vgv), '#f1f5f9')}
      ${cell(roas ? roas.toFixed(2) + 'x' : '—', roas >= 1 ? '#4ade80' : '#fb923c')}
    </tr>`;
  }).filter(Boolean).join('');
  if (!rows) return '';
  return crmPanelDark('💎 Eficiência por Produto (Meta × CRM)', '(CPL · CPQL · custo/visita · ROAS por comissão — distribua o orçamento pro produto mais rentável)', `
    <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:760px">
      <thead><tr style="color:#94a3b8;font-size:10.5px;border-bottom:1px solid rgba(255,255,255,0.1)">
        <th style="text-align:left;padding:6px 10px">Produto</th>
        <th style="text-align:right;padding:6px 8px">Investido</th><th style="text-align:right;padding:6px 8px">Leads</th>
        <th style="text-align:right;padding:6px 8px" title="Custo por Lead">CPL</th>
        <th style="text-align:right;padding:6px 8px" title="Leads qualificados (contatados/avançaram)">Qualif.</th>
        <th style="text-align:right;padding:6px 8px" title="Custo por Lead Qualificado">CPQL</th>
        <th style="text-align:right;padding:6px 8px">Visitas</th>
        <th style="text-align:right;padding:6px 8px" title="Custo por Visita Realizada (CPAR)">Custo/Visita</th>
        <th style="text-align:right;padding:6px 8px">Vendas</th><th style="text-align:right;padding:6px 8px">VGV</th>
        <th style="text-align:right;padding:6px 8px" title="Retorno: comissão (VGV×4%) ÷ investido">ROAS</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    <div style="font-size:11px;color:#64748b;margin-top:8px">CPQL usa lead qualificado = lead que foi contatado/avançou no funil. ROAS = VGV ganho × <b>${(OO_COMISSAO_PCT*100).toFixed(0)}%</b> de comissão ÷ investido no Meta. Investido por produto = soma das contas Meta da marca.</div>`);
}

// ─── Ciclo de vendas por formato de criativo (#5 — Lead Ads × CRM) ───────────
function creativeCyclePanel() {
  const lc = _leadsCreative;
  if (!lc) return '';
  if (lc.pending || !(lc.by_creative || []).length) {
    return crmPanelDark('🎬 Ciclo de vendas por formato de criativo', '(vídeo × carrossel × imagem — prova o ROI do audiovisual)', `
      <div style="font-size:12px;color:#94a3b8">⏳ Aguardando captação de Lead Ads. Quando o webhook do Meta estiver ligado (token <code style="color:#fcd34d">leads_retrieval</code> + inscrição <code style="color:#fcd34d">leadgen</code>), esta tabela popula sozinha: leads por formato, conversão e <b>tempo médio até a venda</b> — em tempo real, sem depender de ninguém.</div>`);
  }
  const rows = lc.by_creative.map(c => `<tr style="border-top:1px solid rgba(255,255,255,0.06)">
    <td style="padding:6px 10px;font-weight:700;color:#e2e8f0">${escapeHtml(c.label)}</td>
    <td style="text-align:right;padding:6px 8px">${fmtNum(c.leads)}</td>
    <td style="text-align:right;padding:6px 8px;color:#4ade80">${fmtNum(c.vendas)}</td>
    <td style="text-align:right;padding:6px 8px;color:${(c.conv_pct||0)>=2?'#4ade80':'#fbbf24'}">${c.conv_pct != null ? c.conv_pct + '%' : '—'}</td>
    <td style="text-align:right;padding:6px 8px;color:#f1f5f9">R$ ${moneyShort(c.vgv)}</td>
    <td style="text-align:right;padding:6px 8px;font-weight:800;color:#22d3ee">${c.ciclo_medio_dias != null ? c.ciclo_medio_dias + ' d' : '—'}</td>
  </tr>`).join('');
  return crmPanelDark('🎬 Ciclo de vendas por formato de criativo', `(leads capturados × CRM — ${lc.total_leads} leads no período)`, `
    <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:520px">
      <thead><tr style="color:#94a3b8;font-size:10.5px;border-bottom:1px solid rgba(255,255,255,0.1)">
        <th style="text-align:left;padding:6px 10px">Formato</th><th style="text-align:right;padding:6px 8px">Leads</th>
        <th style="text-align:right;padding:6px 8px">Vendas</th><th style="text-align:right;padding:6px 8px">Conv.</th>
        <th style="text-align:right;padding:6px 8px">VGV</th>
        <th style="text-align:right;padding:6px 8px" title="Tempo médio do lead até a venda">Ciclo médio</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    <div style="font-size:11px;color:#64748b;margin-top:8px">Ciclo = dias do lead (entrada no Meta) até o fechamento no RD. Quanto menor o ciclo do vídeo, mais a prova de que o audiovisual gera lead mais maduro.</div>`);
}

// ─── Rejeição de leads por motivo × produto (ajuste de segmentação) ───────────
function rejeicaoMotivoPanel() {
  if (!_crm || !_crm.brands) return '';
  const order = ['conquista', 'imoveis', 'locacao'];
  const blocks = order.map(k => {
    const c = _crm.brands?.[k];
    const mot = (c?.motivos_perda || []).filter(x => x.n > 0).slice(0, 6);
    if (!c || !mot.length) return '';
    const bi = brandInfo(k === 'conquista' ? 'conquista' : k === 'locacao' ? 'locacao' : 'imoveis');
    const maxN = Math.max(...mot.map(x => x.n));
    return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 12px">
      <div style="font-weight:700;font-size:12.5px;color:${bi.cor};margin-bottom:6px">${escapeHtml(c.label)} <span style="color:#64748b;font-weight:400">· ${c.perdas} perdas</span></div>
      ${mot.map(x => `<div style="margin-bottom:5px">
        <div class="flex items-center" style="justify-content:space-between;font-size:11.5px;color:#cbd5e1"><span>${escapeHtml(x.motivo)}</span><b>${x.n}${x.pct?` · ${Math.round(x.pct)}%`:''}</b></div>
        <div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${Math.max(4, x.n/maxN*100)}%;background:#fb7185"></div></div>
      </div>`).join('')}
    </div>`;
  }).filter(Boolean).join('');
  if (!blocks) return '';
  return crmPanelDark('🚫 Rejeição de leads por motivo × produto', '(motivo da perda no RD por linha — se uma linha descarta muito por "renda/crédito", ajuste a segmentação socioeconômica no Meta)', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">${blocks}</div>`);
}

function roadmapMini() {
  return `
    <div style="margin-top:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:10px 14px;font-size:12px;color:#cbd5e1">🔌 <strong style="color:#e2e8f0">Ainda no roadmap (precisa de mais integração):</strong>
      <div style="margin-top:6px;display:grid;gap:4px;font-size:11.5px">
        <div>📋 <b>Drop-off de formulário (Lead Ads)</b> — exige a API de Lead Forms do Meta (aberturas × envios); não vem no insights padrão.</div>
        <div>🎬 <b>Ciclo por formato de criativo</b> (vídeo×carrossel×imagem) — precisa capturar o <code style="font-size:10px">ad_id</code>/criativo no lead do RD pra linkar lead→anúncio.</div>
        <div>🎯 <b>Conversão por roteamento inteligente</b> — depende do sistema de distribuição de leads por patente (War Arena); quando existir, cruzamos roteado vs aleatório.</div>
        <div style="color:#64748b">✓ Já no ar: CPQL/CPAR/ROAS por produto · rejeição por motivo × produto · breakdowns Meta · atribuição por canal.</div>
      </div></div>`;
}

function campaignRow(c) {
  const st = (c.status || '').toLowerCase();
  const statusColor = st === 'active' ? '#16a34a' : st === 'paused' ? '#d97706' : 'var(--ink-muted)';
  const statusLbl = st === 'active' ? 'ATIVA' : st === 'paused' ? 'PAUSADA' : (c.status || 'N/A').toUpperCase();
  const flags = [];
  if (st === 'active') {
    if ((c.spend||0) >= _th.gasto && (c.results||0) === 0) flags.push(['#dc2626','Verba sem resultado']);
    if ((c.results||0) > 0 && (c.cpr||0) > _th.cpl) flags.push(['#ea580c','CPL alto']);
    if ((c.frequency||0) > _th.freq) flags.push(['#d97706','Fadiga']);
    if ((c.impressions||0) >= 500 && (c.ctr||0) < _th.ctr) flags.push(['#ca8a04','CTR baixo']);
    if (/BELOW_AVERAGE/.test(c.qualityRanking||'')) flags.push(['#ca8a04','Qualidade baixa']);
  }
  const dot = flags.length ? `<span title="${escapeHtml(flags.map(f=>f[1]).join(', '))}" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${flags[0][0]}"></span>` : '';
  const cplHi = (c.results||0) > 0 && (c.cpr||0) > _th.cpl;
  const freqHi = (c.frequency||0) > _th.freq;
  const ctrLo = (c.impressions||0) >= 500 && (c.ctr||0) < _th.ctr;
  const actBtn = st === 'active'
    ? `<button class="btn btn-ghost tiny" data-act="pause" data-cid="${c.id}" data-cname="${escapeHtml(c.name||'')}" title="Pausar">⏸</button>`
    : st === 'paused' ? `<button class="btn btn-ghost tiny" data-act="resume" data-cid="${c.id}" data-cname="${escapeHtml(c.name||'')}" title="Retomar">▶️</button>` : '';
  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px;text-align:center">${dot}</td>
      <td style="padding:5px 8px"><span style="background:${statusColor};color:#fff;padding:2px 8px;border-radius:var(--r-full);font-size:10px;font-weight:700">${statusLbl}</span></td>
      <td style="padding:5px 8px;font-size:11px" class="muted">${escapeHtml(c.account||'')}</td>
      <td style="padding:5px 8px;font-weight:600;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name||'')}">${escapeHtml(c.name||'—')}</td>
      <td style="text-align:right;padding:5px 8px;color:#dc2626">R$ ${money(c.spend)}</td>
      <td style="text-align:right;padding:5px 8px">${fmtNum(c.impressions)}</td>
      <td style="text-align:right;padding:5px 8px${ctrLo?';color:#ca8a04;font-weight:700':''}">${c.ctr!=null?c.ctr.toFixed(2)+'%':'—'}</td>
      <td style="text-align:right;padding:5px 8px${freqHi?';color:#d97706;font-weight:700':''}">${c.frequency?c.frequency.toFixed(2):'—'}</td>
      <td style="text-align:right;padding:5px 8px;color:#16a34a">${fmtNum(c.results)}</td>
      <td style="text-align:right;padding:5px 8px;font-weight:700${cplHi?';color:#ea580c':''}">${c.cpr?'R$ '+money(c.cpr):'—'}</td>
      <td style="text-align:center;padding:5px 8px">${actBtn}</td>
    </tr>`;
}

function alertCard(icon, title, color, items, desc, fmtItem, withAction) {
  if (!items || items.length === 0) return '';
  const shown = items.slice(0, 8);
  return `
    <div style="background:${color}10;border-left:4px solid ${color};border-radius:var(--r-md);padding:12px 14px">
      <div style="font-weight:800;color:${color}">${icon} ${escapeHtml(title)} <span class="tiny" style="font-weight:700">· ${items.length}</span></div>
      <div class="tiny muted" style="margin:2px 0 8px">${escapeHtml(desc)}</div>
      <div style="display:grid;gap:4px">
        ${shown.map(c => `<div class="tiny" style="display:flex;gap:8px;align-items:center">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name||'')}">${escapeHtml(c.account?'['+c.account+'] ':'')}${escapeHtml(c.name||'—')}</span>
          <span style="white-space:nowrap">${fmtItem(c)}</span>
          ${withAction ? `<button class="btn btn-ghost tiny" data-act="pause" data-cid="${c.id}" data-cname="${escapeHtml(c.name||'')}" title="Pausar">⏸</button>` : ''}
        </div>`).join('')}
        ${items.length > shown.length ? `<div class="tiny muted">+ ${items.length - shown.length} outra(s)…</div>` : ''}
      </div>
    </div>`;
}

function thresholdPanel() {
  return `
    <div class="card" style="margin:0 0 10px;background:var(--bg-3)">
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end">
        ${thInput('CPL alvo (R$)', 'th-cpl', _th.cpl, 1)}
        ${thInput('Freq. máx.', 'th-freq', _th.freq, 0.5)}
        ${thInput('CTR mín. (%)', 'th-ctr', _th.ctr, 0.1)}
        ${thInput('Gasto sem result. (R$)', 'th-gasto', _th.gasto, 5)}
        <button class="btn btn-primary" id="th-save">Salvar limiares</button>
        <button class="btn btn-ghost" id="th-reset">Padrão</button>
      </div>
      <p class="tiny muted mt-2">Definem quando uma campanha vira alerta. Salvos só neste navegador.</p>
    </div>`;
}
function thInput(label, id, val, step) {
  return `<div class="field" style="min-width:130px"><label class="tiny">${label}</label><input id="${id}" type="number" step="${step}" class="input" value="${val}" style="padding:5px 8px;font-size:12px"></div>`;
}

function wire() {
  document.querySelectorAll('.ma-tab').forEach(b => b.addEventListener('click', () => { _tab = b.dataset.tab; render(); }));
  document.getElementById('ma-preset')?.addEventListener('change', async e => { _preset = e.target.value; await reload(); });
  document.getElementById('ma-reload')?.addEventListener('click', () => reload());
  document.getElementById('ma-tv-btn')?.addEventListener('click', enterTV);
  document.getElementById('ma-auto')?.addEventListener('change', e => { _auto = e.target.checked; startAuto(); });
  document.getElementById('ma-status')?.addEventListener('change', e => { _statusFilter = e.target.value; render(); });
  document.getElementById('ma-sort')?.addEventListener('change', e => { _sort = e.target.value; render(); });
  document.getElementById('ma-filter')?.addEventListener('input', e => { _filter = e.target.value; render(); });
  document.getElementById('bd-sel')?.addEventListener('change', e => { _bdSel = e.target.value; });
  document.getElementById('bd-go')?.addEventListener('click', () => loadBreakdown(_bdSel));

  // Filtro de período custom
  document.getElementById('ma-range-go')?.addEventListener('click', () => {
    const s = document.getElementById('ma-since')?.value, u = document.getElementById('ma-until')?.value;
    if (s && u) { _since = s; _until = u; reload(); }
    else alert('Informe data de início e fim.');
  });
  document.getElementById('ma-range-clear')?.addEventListener('click', () => { _since = ''; _until = ''; reload(); });
  // Filtro de conta(s): Todas reseta; clicar alterna a conta (multiseleção).
  // Refaz CRM/Leads (RD) com o filtro de marca da seleção — assim o Cruzamento
  // com CRM e o Leads por Região respeitam a conta escolhida (separada ou todas).
  document.querySelectorAll('.ma-acc').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.acc;
    const before = selectedBrandKeys().slice().sort().join(',');
    if (id === '__all__') { _accSel = []; }
    else { const i = _accSel.indexOf(id); if (i >= 0) _accSel.splice(i, 1); else _accSel.push(id); }
    _ts = null;
    // Só refaz a chamada de rede se a(s) marca(s) do RD realmente mudaram;
    // senão é só re-render (filtro Meta é client-side).
    if (selectedBrandKeys().slice().sort().join(',') !== before) reload(true);
    else render();
  }));

  // Aba Gráficos: garante a série diária e (re)desenha os charts
  if (_tab === 'graficos') { loadTimeseries(); buildGraficos(); }
  // Executiva premium: série diária (sparklines/deltas/linha) + charts do hero
  if (_tab === 'executiva') { loadTimeseries(); buildExecutivaCharts(); }

  document.getElementById('ma-th')?.addEventListener('click', () => {
    const p = document.getElementById('ma-th-panel'); if (!p) return;
    if (p.style.display === 'none' || !p.innerHTML) {
      p.innerHTML = thresholdPanel(); p.style.display = 'block';
      document.getElementById('th-save').addEventListener('click', () => {
        _th = {
          cpl: parseFloat(document.getElementById('th-cpl').value) || DEFAULT_TH.cpl,
          freq: parseFloat(document.getElementById('th-freq').value) || DEFAULT_TH.freq,
          ctr: parseFloat(document.getElementById('th-ctr').value) || DEFAULT_TH.ctr,
          gasto: parseFloat(document.getElementById('th-gasto').value) || DEFAULT_TH.gasto,
        };
        saveTh(_th); render();
      });
      document.getElementById('th-reset').addEventListener('click', () => { _th = { ...DEFAULT_TH }; saveTh(_th); render(); });
    } else { p.style.display = 'none'; }
  });

  document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const act = btn.dataset.act, cid = btn.dataset.cid, cname = btn.dataset.cname;
    const verbo = act === 'pause' ? 'PAUSAR' : 'RETOMAR';
    if (!confirm(`${verbo} a campanha "${cname}"?\n\nIsso altera direto na conta Meta.`)) return;
    btn.disabled = true; btn.textContent = '…';
    try { await api.request('/api/meta-ads', { method: 'POST', body: { action: act, campaign_id: cid } }); await reload(); }
    catch (e) { alert('Erro ao ' + verbo.toLowerCase() + ': ' + e.message); btn.disabled = false; }
  }));
}

function rankLabel(r) {
  if (!r) return '—';
  if (r === 'ABOVE_AVERAGE') return 'Acima da média';
  if (r === 'AVERAGE') return 'Na média';
  if (/BELOW_AVERAGE/.test(r)) return 'Abaixo da média';
  return r;
}
function rankDot(r) {
  const c = r === 'ABOVE_AVERAGE' ? '#16a34a' : r === 'AVERAGE' ? '#ca8a04' : /BELOW_AVERAGE/.test(r || '') ? '#dc2626' : '#cbd5e1';
  return `<span title="${escapeHtml(rankLabel(r))}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin:0 2px"></span>`;
}
function colorVal(level) { return level === 2 ? 'color:#16a34a;font-weight:700' : level === 1 ? 'color:#d97706;font-weight:700' : 'color:#dc2626;font-weight:700'; }
function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:170px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
    <div class="tiny muted">${sub || ''}</div>
  </div>`;
}
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function money(n) { if (n == null || isNaN(n)) return '0,00'; return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function moneyShort(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mi';
  if (n >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
  return money(n);
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
