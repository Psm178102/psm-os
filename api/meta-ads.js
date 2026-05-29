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

// Processa UMA conta: 3 fetches em paralelo (campaigns + insights + acctInsights)
async function processAccount(actId, actLabel, actToken, dateParams) {
  var campaignsUrl = GRAPH_API + '/' + actId + '/campaigns'
    + '?fields=name,status,objective,effective_status'
    + '&effective_status=["ACTIVE","PAUSED","CAMPAIGN_PAUSED"]'
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
    fetchWithTimeout(campaignsUrl).then(function(r){ return r.json(); }),
    fetchWithTimeout(insightsUrl).then(function(r){ return r.json(); }),
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
  var acctMessages = 0, acctLeads = 0;
  acctActions.forEach(function(a){
    if (a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
        a.action_type === 'onsite_conversion.messaging_first_reply') {
      acctMessages += parseInt(a.value || 0);
    } else if (a.action_type === 'lead' ||
        a.action_type === 'offsite_conversion.fb_pixel_lead') {
      acctLeads += parseInt(a.value || 0);
    }
  });
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
  var acctPurchVal = 0;
  (acctIns.action_values || []).forEach(function(av){
    if (av.action_type === 'purchase' || av.action_type === 'offsite_conversion.fb_pixel_purchase') {
      acctPurchVal += parseFloat(av.value || 0);
    }
  });
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
    var results = 0, messages = 0, leads = 0;
    var tipo = 'leadgen';
    var purchases = 0;
    var actions = ins.actions || [];
    actions.forEach(function(a) {
      if (a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
          a.action_type === 'onsite_conversion.messaging_first_reply') {
        messages += parseInt(a.value || 0);
        results += parseInt(a.value || 0);
        tipo = 'whatsapp';
      }
      if (a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead') {
        leads += parseInt(a.value || 0);
        results += parseInt(a.value || 0);
      }
      if (a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase') {
        purchases += parseInt(a.value || 0);
      }
    });

    // v75.9: ROAS — soma valor de purchases via action_values, dividido por spend
    var purchaseValue = 0;
    var actionValues = ins.action_values || [];
    actionValues.forEach(function(av){
      if (av.action_type === 'purchase' || av.action_type === 'offsite_conversion.fb_pixel_purchase') {
        purchaseValue += parseFloat(av.value || 0);
      }
    });
    var roas = (spend > 0 && purchaseValue > 0) ? (purchaseValue / spend) : 0;

    // CPL — prefer Meta cost_per_action_type; fallback spend/results
    var cpr = 0;
    var costPerConversation = 0;
    var costActions = ins.cost_per_action_type || [];
    costActions.forEach(function(ca) {
      if (ca.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
          ca.action_type === 'lead' ||
          ca.action_type === 'offsite_conversion.fb_pixel_lead' ||
          ca.action_type === 'onsite_conversion.messaging_first_reply') {
        cpr = parseFloat(ca.value || 0);
      }
      // v75.9: custo por conversa especificamente WhatsApp
      if (ca.action_type === 'onsite_conversion.messaging_conversation_started_7d') {
        costPerConversation = parseFloat(ca.value || 0);
      }
    });
    if (cpr === 0 && results > 0 && spend > 0) cpr = spend / results;

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
      conversionRanking: conversionRanking
    };
  });

  return { accountTotal: accountTotal, campaigns: allCampaigns };
}

// v75.26: Action handler — pausar/retomar campanha, ajustar budget
// POST /api/meta-ads { action: 'pause'|'resume'|'adjust_budget', campaign_id, value? }
async function executeAction(body) {
  var action = body.action || '';
  var campaignId = body.campaign_id || '';
  var value = body.value;
  if (!campaignId) throw new Error('campaign_id obrigatorio');
  var token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN nao configurado');

  // Endpoint base
  var baseUrl = 'https://graph.facebook.com/v22.0/' + encodeURIComponent(campaignId);

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

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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

  if (!token || accountIds.length === 0) {
    return res.status(500).json({
      error: 'META_ACCESS_TOKEN e META_AD_ACCOUNT_IDS nao configurados nas env vars do Vercel'
    });
  }

  var datePreset = req.query.date_preset || 'last_30d';
  var sinceDate = req.query.since || '';
  var untilDate = req.query.until || '';

  var dateParams = (sinceDate && untilDate)
    ? '&time_range={"since":"' + sinceDate + '","until":"' + untilDate + '"}'
    : '&date_preset=' + datePreset;

  try {
    // v75.11: resilience — uma conta com erro nao quebra todas. Usa Promise.allSettled.
    var perAccountSettled = await Promise.allSettled(accountIds.map(function(actId, i){
      var actLabel = accountLabels[i] || actId;
      var actToken = (accountTokens[i] && accountTokens[i].length > 0) ? accountTokens[i] : token;
      return processAccount(actId, actLabel, actToken, dateParams);
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
        // Insere placeholder zerado pra conta aparecer no UI com indicador de erro
        accountSpend.push({
          id: actId,
          label: actLabel,
          spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0,
          results: 0, cpr: 0, ctr: 0, cpm: 0, cpc: 0,
          purchaseValue: 0, roas: 0,
          _error: errMsg
        });
      }
    });

    var today = new Date();
    var thirtyAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    var period = (sinceDate || formatDate(thirtyAgo)) + ' - ' + (untilDate || formatDate(today));

    var payload = {
      success: accountErrors.length === 0,
      partial: accountErrors.length > 0 && accountErrors.length < accountIds.length,
      period: period,
      accounts: accountSpend,
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
  var dd = String(d.getDate()).padStart(2, '0');
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yy = d.getFullYear();
  return dd + '/' + mm + '/' + yy;
}
