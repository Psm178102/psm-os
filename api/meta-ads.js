// api/meta-ads.js — Vercel Serverless Function
// v75.7: Proxy seguro para Meta Marketing API (nao expoe token no frontend)
//
// CHANGELOG v75.7:
// - Cache TTL 30s → 5min (rate-limit relief, dashboard nao precisa de fresh-fresh)
// - Paralelizacao: cada conta processa seus 3 fetches em Promise.all
// - Paralelizacao: contas multiplas processam em paralelo (Promise.all)
// - Timeout 25s por fetch (AbortController) — evita travar Lambda em ate 60s
// - Fix robustez: CPL fallback spend/results quando cost_per_action_type vazio

const GRAPH_API = 'https://graph.facebook.com/v21.0';

// In-memory cache (lives per warm Lambda instance). 5min TTL.
// Dashboard de Meta ADS nao precisa de fresh-fresh; spend nao muda a cada 30s.
var __cache = {};
var CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// v84.87 — lê a camada editável de contas (shared_kv.meta_ad_accounts) direto no
// PostgREST com a service key. Cache em memória 60s pra não custar 1 query por hit.
var __ovrCache = { t: 0, v: null };
async function fetchAccountOverrides(force) {
  if (!force && Date.now() - __ovrCache.t < 60 * 1000) return __ovrCache.v;
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    var r = await fetch(url.replace(/\/+$/, '') + '/rest/v1/shared_kv?key=eq.meta_ad_accounts&select=value',
      { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    var rows = await r.json();
    var v = (rows && rows[0] && rows[0].value) || null;
    __ovrCache = { t: Date.now(), v: v };
    return v;
  } catch (_) { return null; }
}

// v88.11 — contagem SEM duplicidade. Na Meta, `lead` já é o TOTAL de leads
// (formulário on-Facebook + pixel); somar `lead` + `offsite_conversion.fb_pixel_lead`
// contava o lead de pixel 2× (CPL aparecia pela metade). Idem `purchase`.
// Regra: usa o agregado se existir; senão soma as partes.
var MSG_ACTION = 'onsite_conversion.messaging_conversation_started_7d';
function pickAgg(list, aggType, partTypes, parse) {
  var agg = null, parts = 0;
  (list || []).forEach(function(a) {
    if (a.action_type === aggType) agg = (agg || 0) + parse(a.value || 0);
    else if (partTypes.indexOf(a.action_type) >= 0) parts += parse(a.value || 0);
  });
  return agg != null ? agg : parts;
}
function countLeads(actions) {
  return pickAgg(actions, 'lead', ['offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'], parseInt);
}
function countPurchases(actions) {
  return pickAgg(actions, 'purchase', ['offsite_conversion.fb_pixel_purchase'], parseInt);
}
function countMessages(actions) {
  return pickAgg(actions, MSG_ACTION, [], parseInt);
}
function leadValueOf(values) {
  return pickAgg(values, 'lead', ['offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'], parseFloat);
}
function purchaseValueOf(values) {
  return pickAgg(values, 'purchase', ['offsite_conversion.fb_pixel_purchase'], parseFloat);
}

// Timeout helper: fetch com AbortController
function fetchWithTimeout(url, ms) {
  ms = ms || 25000;
  var controller = new AbortController();
  var timeout = setTimeout(function(){ controller.abort(); }, ms);
  return fetch(url, { signal: controller.signal }).then(function(r){
    clearTimeout(timeout);
    return r;
  }).catch(function(e){
    clearTimeout(timeout);
    if (e && e.name === 'AbortError') throw new Error('Meta API timeout ('+(ms/1000)+'s)');
    throw e;
  });
}

// v86.68: segue paging.next até esgotar (era 1 página de 100 — campanhas/insights
// além da 100ª sumiam calado). Teto de segurança de 20 páginas.
async function fetchAllPages(url, maxPages) {
  var out = [];
  var next = url;
  var n = 0;
  while (next && n < (maxPages || 20)) {
    var r = await fetchWithTimeout(next);
    var j = await r.json();
    if (j.error) return { error: j.error, data: out };
    out = out.concat(j.data || []);
    next = (j.paging && j.paging.next) || null;
    n++;
  }
  return { data: out, truncated: !!next };
}

// Processa UMA conta: 3 fetches em paralelo (campaigns + insights + acctInsights)
// includeArchived: campanhas ARCHIVED entram (histórico — last_month/this_year/
// time_range custom); com preset corrente também, se possível (spend some em
// campanhas arquivadas se o período as toca).
async function processAccount(actId, actLabel, actToken, dateParams, includeArchived) {
  var statuses = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED'];
  if (includeArchived !== false) statuses.push('ARCHIVED');
  var campaignsUrl = GRAPH_API + '/' + actId + '/campaigns'
    + '?fields=name,status,objective,effective_status'
    + '&effective_status=' + encodeURIComponent(JSON.stringify(statuses))
    + '&limit=100'
    + '&access_token=' + actToken;

  var insightsUrl = GRAPH_API + '/' + actId + '/insights'
    + '?fields=campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,ctr,cpm,'
    + 'inline_link_clicks,action_values,'
    + 'actions,cost_per_action_type,'
    + 'quality_ranking,engagement_rate_ranking,conversion_rate_ranking,'
    + 'video_avg_time_watched_actions,'
    + 'video_p25_watched_actions,video_p50_watched_actions,'
    + 'video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,'
    + 'video_play_actions'
    + '&level=campaign'
    + '&limit=100'
    + '&access_token=' + actToken
    + dateParams;

  var acctInsUrl = GRAPH_API + '/' + actId + '/insights'
    + '?fields=spend,impressions,reach,frequency,clicks,actions,action_values'
    + '&access_token=' + actToken
    + dateParams;

  // PARALELIZACAO: 3 fetches simultaneos (era serializado, 3x mais lento)
  var results = await Promise.all([
    fetchAllPages(campaignsUrl, 20),
    fetchAllPages(insightsUrl, 20),
    fetchWithTimeout(acctInsUrl).then(function(r){ return r.json(); })
  ]);

  var campData = results[0];
  var insData = results[1];
  var acctData = results[2];

  if (campData.error) throw new Error('Conta '+actId+' (campaigns): '+campData.error.message);
  if (insData.error) throw new Error('Conta '+actId+' (insights): '+insData.error.message);
  // acctData.error nao bloqueia — total da conta e nice-to-have

  var campaigns = campData.data || [];
  var insights = insData.data || [];
  var acctIns = (acctData.data && acctData.data[0]) || {};

  var insightsMap = {};
  insights.forEach(function(ins) { insightsMap[ins.campaign_id] = ins; });
  // v88.18: campanha com gasto no período mas fora da lista de status (deletada,
  // com problema, em processamento…) sumia da tabela/top 5 enquanto o gasto
  // entrava no total da conta → total ≠ soma das linhas. Entra como "outro".
  var known = {};
  campaigns.forEach(function(c) { known[c.id] = true; });
  insights.forEach(function(ins) {
    if (ins.campaign_id && !known[ins.campaign_id]) {
      known[ins.campaign_id] = true;
      campaigns.push({ id: ins.campaign_id, name: ins.campaign_name || ins.campaign_id, effective_status: 'OUTRO' });
    }
  });

  var accountTotal = {
    id: actId,
    label: actLabel,
    spend: parseFloat(acctIns.spend || 0),
    impressions: parseInt(acctIns.impressions || 0),
    reach: parseInt(acctIns.reach || 0),
    frequency: parseFloat(acctIns.frequency || 0),
    clicks: parseInt(acctIns.clicks || 0)
  };

  // Calcular results/cpl agregados da conta — MENSAGENS separadas de LEADS
  var acctActions = acctIns.actions || [];
  // v86.68: conta SÓ conversation_started_7d (first_reply é subconjunto → somava 2×)
  // v88.11: leads sem duplicidade lead × fb_pixel_lead
  var acctMessages = countMessages(acctActions);
  var acctLeads = countLeads(acctActions);
  accountTotal.messages = acctMessages;
  accountTotal.leads = acctLeads;
  var acctResults = acctMessages + acctLeads;
  accountTotal.results = acctResults;
  accountTotal.cpl_msg = (acctMessages > 0 && accountTotal.spend > 0) ? (accountTotal.spend / acctMessages) : 0;
  accountTotal.cpl_lead = (acctLeads > 0 && accountTotal.spend > 0) ? (accountTotal.spend / acctLeads) : 0;
  accountTotal.cpr = (acctResults > 0 && accountTotal.spend > 0) ? (accountTotal.spend / acctResults) : 0;
  accountTotal.ctr = (accountTotal.impressions > 0) ? ((accountTotal.clicks / accountTotal.impressions) * 100) : 0;
  accountTotal.cpm = (accountTotal.impressions > 0) ? ((accountTotal.spend / accountTotal.impressions) * 1000) : 0;
  accountTotal.cpc = (accountTotal.clicks > 0) ? (accountTotal.spend / accountTotal.clicks) : 0;
  // v75.9: agrega ROAS da conta a partir dos action_values
  var acctPurchVal = purchaseValueOf(acctIns.action_values);
  accountTotal.purchaseValue = acctPurchVal;
  accountTotal.roas = (accountTotal.spend > 0 && acctPurchVal > 0) ? (acctPurchVal / accountTotal.spend) : 0;

  var allCampaigns = campaigns.map(function(camp){
    var ins = insightsMap[camp.id] || {};
    var spend = parseFloat(ins.spend || 0);
    var impressions = parseInt(ins.impressions || 0);
    var reach = parseInt(ins.reach || 0);
    var frequency = parseFloat(ins.frequency || 0);
    if (!frequency && reach > 0) frequency = impressions / reach;
    var clicks = parseInt(ins.clicks || 0);
    var ctr = parseFloat(ins.ctr || 0);
    var cpm = parseFloat(ins.cpm || 0);

    // v75.9: link clicks separados do clicks totais
    var inlineLinkClicks = parseInt(ins.inline_link_clicks || 0);
    // CPC explicito
    var cpc = clicks > 0 ? (spend / clicks) : 0;

    // Results: MENSAGENS separadas de LEADS
    var actions = ins.actions || [];
    var messages = countMessages(actions);
    var leads = countLeads(actions);      // v88.11: sem duplicidade lead × pixel
    var results = messages + leads;
    var purchases = countPurchases(actions);
    var tipo = actions.some(function(a){ return a.action_type === MSG_ACTION; }) ? 'whatsapp' : 'leadgen';

    // v76.30: Engajamento + tráfego detalhado (extraído do array actions; sem campos novos)
    var reactions = 0, comments = 0, shares = 0, saves = 0, postEng = 0, pageEng = 0, lpViews = 0, outbound = 0, linkClickAct = 0;
    actions.forEach(function(a) {
      var v = parseInt(a.value || 0);
      switch (a.action_type) {
        case 'post_reaction': reactions += v; break;
        case 'comment': comments += v; break;
        case 'post': shares += v; break;                       // compartilhamentos
        case 'onsite_conversion.post_save': saves += v; break;  // salvamentos
        case 'post_engagement': postEng += v; break;
        case 'page_engagement': pageEng += v; break;
        case 'landing_page_view': lpViews += v; break;
        case 'link_click': linkClickAct += v; break;
        case 'outbound_click': outbound += v; break;
      }
    });
    var linkCtr = impressions > 0 ? (inlineLinkClicks / impressions * 100) : 0;
    var linkCpc = inlineLinkClicks > 0 ? (spend / inlineLinkClicks) : 0;
    var costPerEngagement = postEng > 0 ? (spend / postEng) : 0;
    var costPerLike = reactions > 0 ? (spend / reactions) : 0;
    var leadValue = leadValueOf(ins.action_values);
    // v75.9: ROAS — valor de purchases via action_values ÷ spend (v88.11: sem duplicidade)
    var purchaseValue = purchaseValueOf(ins.action_values);
    var roas = (spend > 0 && purchaseValue > 0) ? (purchaseValue / spend) : 0;

    // v86.68: CPR = spend/results SEMPRE (cost_per_action_type pegava o custo do
    // último tipo iterado — msg OU lead — e não o custo por resultado total).
    var cpr = (results > 0 && spend > 0) ? (spend / results) : 0;
    var costPerConversation = (messages > 0 && spend > 0) ? (spend / messages) : 0;

    // v75.12: Video — sem video_3_sec_watched_actions (field nao existe na API).
    // Thumbstop agora deriva de actions[action_type=video_view] (ThruPlay) que tem semantica equivalente.
    var views = 0, v3 = 0, v25 = 0, v50 = 0, v75 = 0, v95 = 0, v100 = 0;
    var avgWatchTimeSec = 0;
    (ins.video_play_actions || []).forEach(function(v) { views += parseInt(v.value || 0); });
    // v75.12: thumbstop via actions.video_view (ThruPlay = 15s ou 97%; melhor proxy disponivel)
    actions.forEach(function(a){
      if (a.action_type === 'video_view') v3 += parseInt(a.value || 0);
    });
    (ins.video_p25_watched_actions || []).forEach(function(v) { v25 += parseInt(v.value || 0); });
    (ins.video_p50_watched_actions || []).forEach(function(v) { v50 += parseInt(v.value || 0); });
    (ins.video_p75_watched_actions || []).forEach(function(v) { v75 += parseInt(v.value || 0); });
    (ins.video_p95_watched_actions || []).forEach(function(v) { v95 += parseInt(v.value || 0); });
    (ins.video_p100_watched_actions || []).forEach(function(v) { v100 += parseInt(v.value || 0); });
    // avg watch time vem em milissegundos por placement/action_type, faz media
    var avgArr = ins.video_avg_time_watched_actions || [];
    if (avgArr.length > 0) {
      var sum=0, cnt=0;
      avgArr.forEach(function(v){ var n=parseFloat(v.value||0); if(n>0){ sum+=n; cnt++; } });
      // Meta retorna em segundos ja (nao ms), mas alguns endpoints sao ms. Heuristica: >300 = ms
      avgWatchTimeSec = cnt>0 ? (sum/cnt) : 0;
      if (avgWatchTimeSec > 300) avgWatchTimeSec = avgWatchTimeSec/1000;
    }

    var hookRate = views > 0 ? v25 / views : 0;
    var holdRate = v25 > 0 ? v75 / v25 : 0;
    var vtr = views > 0 ? v100 / views : 0; // view-through rate (assistencia completa)
    var thumbstop = impressions > 0 ? v3 / impressions : 0; // % de quem para o scroll por >=3s

    // v75.9: Rankings da Meta (qualidade, engajamento, conversao)
    // Valores: ABOVE_AVERAGE | AVERAGE | BELOW_AVERAGE_35_55 | BELOW_AVERAGE_20_35 | BELOW_AVERAGE_10_20 | UNKNOWN
    var qualityRanking = ins.quality_ranking || 'UNKNOWN';
    var engagementRanking = ins.engagement_rate_ranking || 'UNKNOWN';
    var conversionRanking = ins.conversion_rate_ranking || 'UNKNOWN';

    var nameLower = (camp.name || '').toLowerCase();
    if (nameLower.indexOf('whatsapp') !== -1 || nameLower.indexOf('[whatsapp]') !== -1) {
      tipo = 'whatsapp';
    } else if (nameLower.indexOf('forms') !== -1 || nameLower.indexOf('[forms]') !== -1) {
      tipo = 'leadgen';
    }

    var statusMap = {
      'ACTIVE': 'active',
      'PAUSED': 'paused',
      'CAMPAIGN_PAUSED': 'paused'
    };

    return {
      id: camp.id,
      name: camp.name,
      status: statusMap[camp.effective_status] || camp.effective_status,
      account: actLabel,
      accountId: actId,
      tipo: tipo,
      spend: spend,
      impressions: impressions,
      reach: reach,
      frequency: frequency,
      clicks: clicks,
      inlineLinkClicks: inlineLinkClicks,
      ctr: ctr,
      cpc: cpc,
      cpm: cpm,
      results: results,
      messages: messages,
      leads: leads,
      cpr: cpr,
      costPerConversation: costPerConversation,
      purchases: purchases,
      purchaseValue: purchaseValue,
      roas: roas,
      views: views,
      v3: v3,
      v25: v25,
      v50: v50,
      v75: v75,
      v95: v95,
      v100: v100,
      avgWatchTime: avgWatchTimeSec,
      hookRate: hookRate,
      holdRate: holdRate,
      vtr: vtr,
      thumbstop: thumbstop,
      qualityRanking: qualityRanking,
      engagementRanking: engagementRanking,
      conversionRanking: conversionRanking,
      // v76.30: engajamento + tráfego detalhado + valor de lead
      reactions: reactions,
      comments: comments,
      shares: shares,
      saves: saves,
      postEngagement: postEng,
      pageEngagement: pageEng,
      landingPageViews: lpViews,
      outboundClicks: outbound,
      linkCtr: linkCtr,
      linkCpc: linkCpc,
      costPerEngagement: costPerEngagement,
      costPerLike: costPerLike,
      leadValue: leadValue
    };
  });

  return { accountTotal: accountTotal, campaigns: allCampaigns };
}

// v75.26: Action handler — pausar/retomar campanha, ajustar budget
// POST /api/meta-ads { action: 'pause'|'resume'|'adjust_budget', campaign_id, value? }
// v88.11 — token da CONTA da campanha (conta com token próprio em
// META_AD_ACCOUNT_TOKENS falhava com erro de permissão ao pausar).
function tokenForAccount(accountId) {
  var ids = (process.env.META_AD_ACCOUNT_IDS || '').split(',').map(function(s){ return s.trim(); });
  var toks = (process.env.META_AD_ACCOUNT_TOKENS || '').split(',').map(function(s){ return s.trim(); });
  var i = accountId ? ids.indexOf(accountId) : -1;
  return (i >= 0 && toks[i]) ? toks[i] : process.env.META_ACCESS_TOKEN;
}

async function executeAction(body) {
  var action = body.action || '';
  var campaignId = String(body.campaign_id || '');
  var value = body.value;
  if (!/^\d{5,25}$/.test(campaignId)) throw new Error('campaign_id obrigatorio (numérico)');
  var token = tokenForAccount(String(body.account_id || ''));
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado');

  // Endpoint base (v88.11: mesma versão Graph das leituras)
  var baseUrl = GRAPH_API + '/' + encodeURIComponent(campaignId);

  if (action === 'pause' || action === 'resume') {
    var newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
    var url = baseUrl + '?status=' + newStatus + '&access_token=' + encodeURIComponent(token);
    var r = await fetchWithTimeoutOpts(url, 20000, { method: 'POST' });
    var j = await r.json();
    if (j.error) throw new Error('Meta API: ' + j.error.message);
    return { ok: true, action: action, campaign_id: campaignId, new_status: newStatus, meta: j };
  }

  if (action === 'adjust_budget') {
    // value = novo daily_budget em centavos (R$ 50,00 → 5000)
    var v = parseInt(value);
    if (!v || v < 100) throw new Error('value (cents) >= 100 obrigatorio para adjust_budget');
    var url2 = baseUrl + '?daily_budget=' + v + '&access_token=' + encodeURIComponent(token);
    var r2 = await fetchWithTimeoutOpts(url2, 20000, { method: 'POST' });
    var j2 = await r2.json();
    if (j2.error) throw new Error('Meta API: ' + j2.error.message);
    return { ok: true, action: action, campaign_id: campaignId, new_daily_budget_cents: v, meta: j2 };
  }

  throw new Error('action desconhecida: ' + action + ' (aceitos: pause, resume, adjust_budget)');
}

// Helper extendido com POST/body
function fetchWithTimeoutOpts(url, ms, opts) {
  ms = ms || 15000;
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); reject(new Error('timeout ' + ms + 'ms')); }, ms);
    var fetchOpts = Object.assign({}, opts, { signal: controller.signal });
    fetch(url, fetchOpts).then(function (resp) { clearTimeout(timer); resolve(resp); }).catch(function (e) { clearTimeout(timer); reject(e); });
  });
}

// v86.0 — AUTENTICAÇÃO OBRIGATÓRIA. Este endpoint expunha gasto, leads e CPL
// de todas as contas pra QUALQUER pessoa com a URL (aberto desde a v75.7; achado
// em 10/ago ao ligar o tráfego automático). Aceita: JWT de usuário logado
// (mesmo HS256/JWT_SECRET do backend v3) OU o CRON_SECRET (chamadas internas).
// v88.11 — SÓ chamada interna (CRON_SECRET). Antes qualquer JWT válido (até
// corretor lvl 2 ou usuário recém-desativado) lia o gasto de todas as contas e
// PAUSAVA/mudava orçamento de campanha. Usuários passam pelos endpoints v3:
// leitura → /api/v3/marketing/summary (lvl≥5 via cache);
// ação    → /api/v3/marketing/campaign_action (lvl≥5, usuário ativo, audit_log).
function metaAuthorized(req) {
  var h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  var tok = String(h).replace(/^Bearer\s+/i, '').trim();
  var cs = (process.env.CRON_SECRET || '').trim();
  if (!tok || !cs || tok.length !== cs.length) return false;
  try {
    return require('crypto').timingSafeEqual(Buffer.from(tok), Buffer.from(cs));
  } catch (_) { return false; }
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!metaAuthorized(req)) return res.status(401).json({ error: 'não autenticado' });

  // v75.26: POST = ação (pause/resume/adjust_budget)
  if (req.method === 'POST') {
    try {
      var body = req.body || {};
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){ body = {}; } }
      var result = await executeAction(body);
      return res.status(200).json(result);
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  }

  // Cache check
  var cacheKey = JSON.stringify({
    p: req.query.date_preset || '',
    s: req.query.since || '',
    u: req.query.until || '',
    nocache: req.query.nocache || ''
  });
  if (!req.query.nocache) {
    var hit = __cache[cacheKey];
    if (hit && (Date.now() - hit.t) < CACHE_TTL_MS) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Age', String(Math.floor((Date.now() - hit.t) / 1000)));
      return res.status(200).json(hit.d);
    }
  }

  var token = process.env.META_ACCESS_TOKEN;
  var accountIds = (process.env.META_AD_ACCOUNT_IDS || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  var accountLabels = (process.env.META_AD_ACCOUNT_LABELS || '').split(',').map(function(s){ return s.trim(); });
  var accountTokens = (process.env.META_AD_ACCOUNT_TOKENS || '').split(',').map(function(s){ return s.trim(); });

  // v84.87 — camada EDITÁVEL por cima das envs (shared_kv.meta_ad_accounts, gerida
  // na tela): excluídas somem, extras entram com o token principal. Falhou o kv →
  // segue só com as envs (nunca derruba o cockpit por causa da config).
  try {
    var ovr = await fetchAccountOverrides(!!req.query.nocache);
    if (ovr) {
      var excl = ovr.excluidas || [];
      var keep = accountIds.map(function(id, i){
        return { id: id, label: accountLabels[i] || id, token: accountTokens[i] || '' };
      }).filter(function(a){ return excl.indexOf(a.id) === -1; });
      (ovr.extras || []).forEach(function(e){
        if (e && e.id && excl.indexOf(e.id) === -1 && !keep.some(function(k){ return k.id === e.id; })) {
          keep.push({ id: e.id, label: e.label || e.id, token: '' });
        }
      });
      accountIds = keep.map(function(a){ return a.id; });
      accountLabels = keep.map(function(a){ return a.label; });
      accountTokens = keep.map(function(a){ return a.token; });
    }
  } catch (_) { /* segue com as envs */ }

  if (!token || accountIds.length === 0) {
    return res.status(500).json({
      error: 'META_ACCESS_TOKEN e META_AD_ACCOUNT_IDS nao configurados nas env vars do Vercel'
    });
  }

  var datePreset = req.query.date_preset || 'last_30d';
  var sinceDate = req.query.since || '';
  var untilDate = req.query.until || '';
  // v88.13: valida antes de montar a URL da Graph (datas cruas eram concatenadas
  // no time_range; preset/datas inválidos voltavam 200 com todas as contas em erro)
  var RE_D = /^\d{4}-\d{2}-\d{2}$/;
  var PRESETS_OK = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d',
    'this_month', 'last_month', 'this_year', 'last_year'];
  if (sinceDate || untilDate) {
    if (!RE_D.test(sinceDate) || !RE_D.test(untilDate) || sinceDate > untilDate) {
      return res.status(400).json({ error: 'since/until inválidos (YYYY-MM-DD, since <= until)' });
    }
  } else if (PRESETS_OK.indexOf(datePreset) === -1) {
    return res.status(400).json({ error: 'date_preset inválido: ' + String(datePreset).slice(0, 30) });
  }

  var dateParams = (sinceDate && untilDate)
    ? '&time_range={"since":"' + sinceDate + '","until":"' + untilDate + '"}'
    : '&date_preset=' + datePreset;
  var periodInfo = presetWindowBRT(datePreset, sinceDate, untilDate);

  try {
    // v75.11: resilience — uma conta com erro nao quebra todas. Usa Promise.allSettled.
    var perAccountSettled = await Promise.allSettled(accountIds.map(function(actId, i){
      var actLabel = accountLabels[i] || actId;
      var actToken = (accountTokens[i] && accountTokens[i].length > 0) ? accountTokens[i] : token;
      return processAccount(actId, actLabel, actToken, dateParams, true);
    }));

    var accountSpend = [];
    var allCampaigns = [];
    var accountErrors = []; // v75.11: lista de contas que falharam

    perAccountSettled.forEach(function(s, i){
      var actId = accountIds[i];
      var actLabel = accountLabels[i] || actId;
      if (s.status === 'fulfilled') {
        accountSpend.push(s.value.accountTotal);
        allCampaigns = allCampaigns.concat(s.value.campaigns);
      } else {
        // Conta falhou — registra erro mas nao bloqueia as outras
        var errMsg = (s.reason && s.reason.message) ? s.reason.message : String(s.reason);
        accountErrors.push({
          id: actId,
          label: actLabel,
          error: errMsg
        });
        // v86.68: conta com erro NÃO entra em `accounts` (entrava como R$0 e
        // contaminava totais/médias). Vai em accounts_error pro UI sinalizar.
      }
    });

    var payload = {
      success: accountErrors.length === 0,
      partial: accountErrors.length > 0 && accountErrors.length < accountIds.length,
      period: periodInfo,                 // {preset, since, until, label} em BRT
      accounts: accountSpend,             // só contas que responderam
      accounts_error: accountErrors.map(function(e){ return { id: e.id, label: e.label, _error: e.error }; }),
      campaigns: allCampaigns,
      errors: accountErrors,  // v75.11: lista de erros por conta (nao bloqueia o response)
      fetchedAt: new Date().toISOString()
    };
    // So cacheia se nao houver erros (evita cachear estado parcialmente quebrado)
    if (accountErrors.length === 0) {
      __cache[cacheKey] = { t: Date.now(), d: payload };
    }
    res.setHeader('X-Cache', accountErrors.length === 0 ? 'MISS' : 'PARTIAL');
    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro ao consultar Meta API' });
  }
};

function formatDate(d) {
  var dd = String(d.getUTCDate()).padStart(2, '0');
  var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  var yy = d.getUTCFullYear();
  return dd + '/' + mm + '/' + yy;
}

// v86.68: janela real do preset em BRT (UTC-3), mesma semântica da Meta
// (last_Nd = N dias fechados SEM hoje). Datas como Date em UTC "deslocadas".
function presetWindowBRT(preset, since, until) {
  var iso = function(d){ return d.toISOString().slice(0, 10); };
  var nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000);
  var today = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()));
  var addDays = function(d, n){ return new Date(d.getTime() + n * 86400000); };
  var s, u;
  if (since && until) {
    s = new Date(since + 'T00:00:00Z'); u = new Date(until + 'T00:00:00Z');
    preset = 'custom';
  } else {
    var lastN = { last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90 };
    if (preset === 'today') { s = today; u = today; }
    else if (preset === 'yesterday') { s = addDays(today, -1); u = s; }
    else if (lastN[preset]) { u = addDays(today, -1); s = addDays(u, -(lastN[preset] - 1)); }
    else if (preset === 'this_month') { s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); u = today; }
    else if (preset === 'last_month') {
      var firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      u = addDays(firstThis, -1); s = new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), 1));
    }
    else if (preset === 'this_year') { s = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); u = today; }
    else if (preset === 'last_year') { s = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)); u = new Date(Date.UTC(today.getUTCFullYear() - 1, 11, 31)); }
    else { u = addDays(today, -1); s = addDays(u, -29); preset = preset || 'last_30d'; }
  }
  var valid = s && u && !isNaN(s.getTime()) && !isNaN(u.getTime());
  return {
    preset: preset,
    since: valid ? iso(s) : (since || null),
    until: valid ? iso(u) : (until || null),
    label: valid ? (formatDate(s) + ' - ' + formatDate(u)) : ''
  };
}
