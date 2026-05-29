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
    const qp = '?date_preset=' + encodeURIComponent(_preset);
    _bd = null;  // breakdown depende do período; invalida ao recarregar
    const [meta, crm, goog] = await Promise.allSettled([
      api.request('/api/v3/marketing/summary' + qp),
      api.request('/api/v3/marketing/crm_metrics' + qp),
      api.request('/api/v3/marketing/google_ads' + qp),
    ]);
    if (meta.status === 'fulfilled') _data = meta.value; else throw meta.reason;
    if (crm.status === 'fulfilled' && crm.value?.ok) { _crm = crm.value; _crmErr = null; }
    else { _crm = null; _crmErr = (crm.reason?.message) || (crm.value?.error) || 'CRM indisponível'; }
    _google = (goog.status === 'fulfilled') ? goog.value : { ok: false, error: goog.reason?.message };
    render();
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
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, purchaseValue: 0 };
  accounts.forEach(a => {
    t.spend += a.spend || 0; t.impressions += a.impressions || 0; t.reach += a.reach || 0;
    t.clicks += a.clicks || 0; t.results += a.results || 0; t.purchaseValue += a.purchaseValue || 0;
  });
  t.cpl = t.results > 0 ? t.spend / t.results : 0;
  t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
  t.cpm = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0;
  t.freq = t.reach > 0 ? t.impressions / t.reach : 0;
  t.roas = t.spend > 0 && t.purchaseValue > 0 ? t.purchaseValue / t.spend : 0;
  return t;
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
      </div>

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
  if (_tab === 'trafego')   return tabTrafegoCompleto();
  if (_tab === 'vendas')    return tabVendas();
  if (_tab === 'marca')     return tabMarca();
  return tabExecutiva();
}

function crmWarn() {
  return `<div class="alert alert-warn">📭 Sem dados do CRM no período (${escapeHtml(_crmErr || 'RD não sincronizado')}).<br>
    Esta aba cruza vendas do RD Station com o gasto Meta. Verifique o sync de deals (cron <code>/api/v3/crm/sync_cron</code>) e o <code>RD_API_TOKEN</code>.</div>`;
}

/* ───────────────────────── ABA: EXECUTIVA (Aba 1) ───────────────────────── */
function tabExecutiva() {
  const d = _data || {};
  const accounts = d.accounts || [];
  const t = periodTotals(accounts);
  if (!_crm) {
    // Mostra ao menos o investimento Meta, mesmo sem CRM
    return `
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('💰 Investimento Total', 'R$ ' + money(t.spend), 'mídia no período', '#dc2626')}
        ${kpi('🎯 Resultados Meta', fmtNum(t.results), t.cpl ? `CPL: R$ ${money(t.cpl)}` : '—', '#2563eb')}
      </div>
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
    <p class="card-sub">Visão executiva — mídia paga convertida em venda real. CAC, VGV e ROAS cruzam Meta Ads × deals ganhos no RD no mesmo período.</p>
    <div class="flex gap-3 mt-3" style="flex-wrap:wrap;margin-top:12px">
      ${kpi('💰 Investimento Total', 'R$ ' + money(t.spend), `${accounts.length} conta(s) Meta`, '#dc2626')}
      ${kpi('🧮 CAC', cac ? 'R$ ' + money(cac) : '—', `${g.vendas} venda(s) no período`, '#ea580c')}
      ${kpi('🏛 VGV Influenciado', vgvInf > 0 ? 'R$ ' + moneyShort(vgvInf) : '—', vgvInfLbl, '#7c3aed')}
      ${kpi('📈 ROAS Imobiliário', roas ? roas.toFixed(1) + 'x' : '—', vgvInf > 0 ? 'VGV influenciado ÷ investimento' : 'sem ganhos com origem paga marcada', '#16a34a')}
    </div>

    <div class="flex gap-3 mt-3" style="flex-wrap:wrap;margin-top:10px">
      ${miniKpi('Leads gerados (RD)', fmtNum(g.leads_criados), '#2563eb')}
      ${miniKpi('Vendas ganhas', fmtNum(g.vendas), '#16a34a')}
      ${miniKpi('Ticket médio', g.ticket_medio ? 'R$ ' + moneyShort(g.ticket_medio) : '—', '#7c3aed')}
      ${miniKpi('Conversão', g.taxa_conversao != null ? g.taxa_conversao + '%' : '—', '#0891b2', 'ganhos ÷ fechados')}
      ${miniKpi('CPL real (RD)', g.leads_criados ? 'R$ ' + money(t.spend / g.leads_criados) : '—', '#d97706', 'gasto ÷ leads RD')}
    </div>

    ${attrBanner(attr)}

    <div class="mt-4" style="margin-top:18px">
      <h3 class="card-title">Atribuição por canal <span class="muted tiny" style="font-weight:500">(origem RD × VGV ganho)</span></h3>
      ${attrChannelTable(attr)}
    </div>

    <div class="mt-4" style="margin-top:18px">
      <h3 class="card-title">Por marca (Meta × CRM)</h3>
      <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:680px">
        <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:6px 10px">Marca</th><th style="text-align:right;padding:6px 8px">Investido</th>
          <th style="text-align:right;padding:6px 8px">Leads</th><th style="text-align:right;padding:6px 8px">Vendas</th>
          <th style="text-align:right;padding:6px 8px">CAC</th><th style="text-align:right;padding:6px 8px">VGV</th>
          <th style="text-align:right;padding:6px 8px">ROAS</th>
        </tr></thead><tbody>
          ${execBrandRows(byBrand)}
        </tbody></table></div>
    </div>

    ${googleSection(attr)}
    ${roadmapMini()}
  `;
}

/* ─── Google Ads (Sprint 9.15) — dados reais se configurado, senão aviso honesto ─── */
function googleSection(attr) {
  const gg = _google;
  if (!gg) return '';
  if (gg.configured === false) {
    const miss = (gg.missing || []).join(', ');
    return `<div class="alert alert-warn mt-4" style="margin-top:18px">🔌 <strong>Google Ads não conectado.</strong> Configure as credenciais no Vercel para fechar a atribuição do canal Google (ROAS Google). Falta: <code style="font-size:11px">${escapeHtml(miss || 'credenciais')}</code>.</div>`;
  }
  if (gg.ok === false) {
    return `<div class="alert alert-warn mt-4" style="margin-top:18px">⚠️ Google Ads: ${escapeHtml(gg.error || 'erro')}</div>`;
  }
  // ROAS Google = VGV ganho via canal google (RD) ÷ gasto Google
  const gch = ((attr && attr.by_channel) || []).find(c => c.channel === 'google');
  const gVgv = gch ? gch.vgv : 0;
  const roas = (gg.spend > 0 && gVgv > 0) ? gVgv / gg.spend : 0;
  const top = (gg.campaigns || []).slice(0, 6);
  return `<div class="mt-4" style="margin-top:18px">
    <h3 class="card-title">🔎 Google Ads</h3>
    <div class="flex gap-3 mt-2" style="flex-wrap:wrap">
      ${miniKpi('Investido Google', 'R$ ' + money(gg.spend), '#dc2626')}
      ${miniKpi('Cliques', fmtNum(gg.clicks), '#2563eb')}
      ${miniKpi('Conversões (Google)', fmtNum(gg.conversions), '#0891b2')}
      ${miniKpi('VGV via Google (RD)', gVgv ? 'R$ ' + moneyShort(gVgv) : '—', '#7c3aed')}
      ${miniKpi('ROAS Google', roas ? roas.toFixed(1) + 'x' : '—', '#16a34a', 'VGV Google ÷ gasto')}
    </div>
    ${top.length ? `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:480px;margin-top:10px">
      <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:6px 10px">Campanha</th><th style="text-align:right;padding:6px 8px">Gasto</th>
        <th style="text-align:right;padding:6px 8px">Cliques</th><th style="text-align:right;padding:6px 8px">Conv.</th>
      </tr></thead><tbody>
      ${top.map(c => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 10px;font-weight:600">${escapeHtml(c.name)}</td>
        <td style="text-align:right;padding:6px 8px;color:#dc2626">R$ ${money(c.spend)}</td>
        <td style="text-align:right;padding:6px 8px">${fmtNum(c.clicks)}</td>
        <td style="text-align:right;padding:6px 8px">${fmtNum(c.conversions)}</td>
      </tr>`).join('')}
      </tbody></table></div>` : ''}
  </div>`;
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
    rows.push(`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 10px;font-weight:700;color:${bi.cor}">${escapeHtml(crm?.label || bi.brand)}</td>
      <td style="text-align:right;padding:6px 8px;color:#dc2626">R$ ${money(spend)}</td>
      <td style="text-align:right;padding:6px 8px">${fmtNum(leads)}</td>
      <td style="text-align:right;padding:6px 8px;color:#16a34a">${fmtNum(vendas)}</td>
      <td style="text-align:right;padding:6px 8px">${cac ? 'R$ ' + money(cac) : '—'}</td>
      <td style="text-align:right;padding:6px 8px;font-weight:700">R$ ${moneyShort(vgv)}</td>
      <td style="text-align:right;padding:6px 8px;font-weight:800;color:${roas>=1?'#16a34a':'#ea580c'}">${roas ? roas.toFixed(1) + 'x' : '—'}</td>
    </tr>`);
  });
  return rows.join('') || '<tr><td colspan="7" class="muted tiny" style="padding:14px;text-align:center">Sem cruzamento no período.</td></tr>';
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
    return `<div class="alert alert-warn mt-3" style="margin-top:12px">⚠️ <strong>${semOrigem}% do VGV ganho está sem origem marcada no RD.</strong> VGV Influenciado e ROAS consideram só ganhos com origem de mídia paga (Meta/Google) — nunca o total. Marque a origem dos deals no RD pra subir a precisão.</div>`;
  }
  return `<div class="alert alert-ok mt-3" style="margin-top:12px">✅ ${cov}% do VGV ganho com origem marcada no RD — atribuição confiável.</div>`;
}
function attrChannelTable(attr) {
  const rows = (attr && attr.by_channel) || [];
  if (!rows.length) return '<div class="muted tiny">Sem ganhos/leads com canal no período.</div>';
  const totalVgv = rows.reduce((s, r) => s + (r.vgv || 0), 0);
  return `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:560px">
    <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
      <th style="text-align:left;padding:6px 10px">Canal</th>
      <th style="text-align:right;padding:6px 8px">Leads</th><th style="text-align:right;padding:6px 8px">Vendas</th>
      <th style="text-align:right;padding:6px 8px">VGV</th><th style="text-align:right;padding:6px 8px">% VGV</th>
    </tr></thead><tbody>
    ${rows.map(r => {
      const pct = totalVgv > 0 ? (r.vgv / totalVgv * 100) : 0;
      const isPaid = r.channel === 'meta' || r.channel === 'google';
      const isUnatt = r.channel === 'nao_atribuido';
      const col = isUnatt ? '#94a3b8' : isPaid ? '#7c3aed' : '#0891b2';
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 10px;font-weight:700;color:${col}">${escapeHtml(r.label)}${isPaid ? ' 💳' : ''}</td>
        <td style="text-align:right;padding:6px 8px">${fmtNum(r.leads)}</td>
        <td style="text-align:right;padding:6px 8px;color:#16a34a">${fmtNum(r.vendas)}</td>
        <td style="text-align:right;padding:6px 8px;font-weight:700">R$ ${moneyShort(r.vgv)}</td>
        <td style="text-align:right;padding:6px 8px">${pct.toFixed(0)}%</td>
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

/* ───────────────────────── compartilhados ───────────────────────── */
function roadmapMini() {
  return `
    <div class="alert alert-warn mt-3" style="margin-top:14px">🔌 <strong>Ainda no roadmap:</strong> Impression Share + perdas de IS (métricas avançadas Google Ads) · 1ª resposta exata no WhatsApp (atividades RD). <span class="muted">Breakdowns Meta (idade/gênero/plataforma/dispositivo/região/hora) e atribuição honesta por canal já no ar.</span></div>`;
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
  document.getElementById('ma-auto')?.addEventListener('change', e => { _auto = e.target.checked; startAuto(); });
  document.getElementById('ma-status')?.addEventListener('change', e => { _statusFilter = e.target.value; render(); });
  document.getElementById('ma-sort')?.addEventListener('change', e => { _sort = e.target.value; render(); });
  document.getElementById('ma-filter')?.addEventListener('input', e => { _filter = e.target.value; render(); });
  document.getElementById('bd-sel')?.addEventListener('change', e => { _bdSel = e.target.value; });
  document.getElementById('bd-go')?.addEventListener('click', () => loadBreakdown(_bdSel));

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
