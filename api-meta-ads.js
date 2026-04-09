// api/meta-ads.js — Vercel Serverless Function (v3 — PRO DASHBOARD)
// Proxy seguro para Meta Marketing API com:
//  - Dados agregados (como antes)
//  - dailySeries por conta (time_increment=1)
//  - Comparativo com período anterior (shift pela mesma janela)
//  - Breakdown por placement (publisher_platform, platform_position)
// NÃO expõe token no frontend.

const GRAPH_API = 'https://graph.facebook.com/v21.0';

// In-memory cache (lives per warm Lambda instance). 30s TTL.
// Evita estourar rate limit com auto-refresh do frontend.
var __cache = {};
var CACHE_TTL_MS = 30 * 1000;

// Map date_preset → dias (para shift do período anterior)
function presetToDays(preset) {
  var map = {
    today: 1, yesterday: 1,
    last_3d: 3, last_7d: 7, last_14d: 14, last_28d: 28, last_30d: 30,
    last_90d: 90, this_month: 30, last_month: 30
  };
  return map[preset] || 30;
}

// Calcula range anterior equivalente
function shiftRange(since, until) {
  var d1 = new Date(since + 'T00:00:00Z');
  var d2 = new Date(until + 'T00:00:00Z');
  var diff = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
  var prevUntil = new Date(d1.getTime() - 86400000);
  var prevSince = new Date(prevUntil.getTime() - (diff - 1) * 86400000);
  function fmt(d) {
    return d.toISOString().slice(0, 10);
  }
  return { since: fmt(prevSince), until: fmt(prevUntil), days: diff };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function resolveRange(preset, since, until) {
  if (since && until) return { since: since, until: until };
  var days = presetToDays(preset);
  if (preset === 'today') return { since: todayISO(), until: todayISO() };
  if (preset === 'yesterday') return { since: daysAgoISO(1), until: daysAgoISO(1) };
  if (preset === 'this_month') {
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    return { since: first, until: todayISO() };
  }
  if (preset === 'last_month') {
    var n2 = new Date();
    var firstPrev = new Date(n2.getFullYear(), n2.getMonth() - 1, 1).toISOString().slice(0, 10);
    var lastPrev = new Date(n2.getFullYear(), n2.getMonth(), 0).toISOString().slice(0, 10);
    return { since: firstPrev, until: lastPrev };
  }
  return { since: daysAgoISO(days - 1), until: todayISO() };
}

function sumActions(actionsArr, types) {
  var out = 0;
  (actionsArr || []).forEach(function (a) {
    if (types.indexOf(a.action_type) >= 0) out += parseInt(a.value || 0);
  });
  return out;
}

function extractResults(actions) {
  // Prioriza conversas (whatsapp) e leads; retorna {count, tipo}
  var types = ['onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.messaging_first_reply',
    'lead',
    'offsite_conversion.fb_pixel_lead'];
  var count = 0, tipo = 'leadgen', sawWa = false;
  (actions || []).forEach(function (a) {
    if (types.indexOf(a.action_type) >= 0) {
      count += parseInt(a.value || 0);
      if (a.action_type.indexOf('messaging') >= 0) { sawWa = true; }
    }
  });
  if (sawWa) tipo = 'whatsapp';
  return { count: count, tipo: tipo };
}

function extractCpr(costArr) {
  var types = ['onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.messaging_first_reply',
    'lead', 'offsite_conversion.fb_pixel_lead'];
  var val = 0;
  (costArr || []).forEach(function (ca) {
    if (types.indexOf(ca.action_type) >= 0) {
      var v = parseFloat(ca.value || 0);
      if (v > 0 && (val === 0 || v < val)) val = v;
    }
  });
  return val;
}

async function fetchJson(url) {
  var r = await fetch(url);
  return r.json();
}

// Busca insights agregados por campanha para um range
async function getCampaignInsights(actId, token, rangeStr) {
  var url = GRAPH_API + '/' + actId + '/insights'
    + '?fields=campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,'
    + 'actions,cost_per_action_type,inline_link_clicks,'
    + 'video_avg_time_watched_actions,'
    + 'video_p25_watched_actions,video_p50_watched_actions,'
    + 'video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,'
    + 'video_play_actions'
    + '&level=campaign&limit=200' + rangeStr + '&access_token=' + token;
  var d = await fetchJson(url);
  if (d.error) throw new Error(d.error.message);
  var map = {};
  (d.data || []).forEach(function (ins) { map[ins.campaign_id] = ins; });
  return map;
}

// Busca insights agregados da CONTA inteira
async function getAccountAgg(actId, token, rangeStr) {
  var url = GRAPH_API + '/' + actId + '/insights'
    + '?fields=spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,actions,cost_per_action_type,inline_link_clicks,'
    + 'video_play_actions,video_p25_watched_actions,video_p75_watched_actions'
    + rangeStr + '&access_token=' + token;
  var d = await fetchJson(url);
  if (d.error) throw new Error(d.error.message);
  return (d.data && d.data[0]) || {};
}

// Busca daily series da conta (time_increment=1)
async function getAccountDaily(actId, token, rangeStr) {
  var url = GRAPH_API + '/' + actId + '/insights'
    + '?fields=date_start,spend,impressions,clicks,actions'
    + '&time_increment=1' + rangeStr + '&limit=200&access_token=' + token;
  var d = await fetchJson(url);
  if (d.error) return [];
  return (d.data || []).map(function (x) {
    var r = extractResults(x.actions);
    return {
      date: x.date_start,
      spend: parseFloat(x.spend || 0),
      impressions: parseInt(x.impressions || 0),
      clicks: parseInt(x.clicks || 0),
      results: r.count
    };
  });
}

// Breakdown por placement
async function getPlacements(actId, token, rangeStr) {
  var url = GRAPH_API + '/' + actId + '/insights'
    + '?fields=spend,impressions,reach,clicks,ctr,actions'
    + '&breakdowns=publisher_platform,platform_position'
    + rangeStr + '&limit=100&access_token=' + token;
  var d = await fetchJson(url);
  if (d.error) return [];
  return (d.data || []).map(function (x) {
    var r = extractResults(x.actions);
    return {
      platform: x.publisher_platform || '—',
      position: x.platform_position || '—',
      spend: parseFloat(x.spend || 0),
      impressions: parseInt(x.impressions || 0),
      reach: parseInt(x.reach || 0),
      clicks: parseInt(x.clicks || 0),
      ctr: parseFloat(x.ctr || 0),
      results: r.count
    };
  });
}

function buildCampaign(camp, ins, actLabel, actId) {
  ins = ins || {};
  var spend = parseFloat(ins.spend || 0);
  var impressions = parseInt(ins.impressions || 0);
  var reach = parseInt(ins.reach || 0);
  var frequency = parseFloat(ins.frequency || 0);
  if (!frequency && reach > 0) frequency = impressions / reach;
  var clicks = parseInt(ins.clicks || 0);
  var inlineLinkClicks = parseInt(ins.inline_link_clicks || 0);
  var ctr = parseFloat(ins.ctr || 0);
  var cpm = parseFloat(ins.cpm || 0);
  var cpc = parseFloat(ins.cpc || 0);
  if (!cpc && clicks > 0) cpc = spend / clicks;

  var r = extractResults(ins.actions);
  var results = r.count;
  var tipo = r.tipo;

  var cpr = extractCpr(ins.cost_per_action_type);
  if (cpr === 0 && results > 0) cpr = spend / results;

  // Video
  var views = 0, v25 = 0, v50 = 0, v75 = 0, v95 = 0, v100 = 0;
  (ins.video_play_actions || []).forEach(function (v) { views += parseInt(v.value || 0); });
  (ins.video_p25_watched_actions || []).forEach(function (v) { v25 += parseInt(v.value || 0); });
  (ins.video_p50_watched_actions || []).forEach(function (v) { v50 += parseInt(v.value || 0); });
  (ins.video_p75_watched_actions || []).forEach(function (v) { v75 += parseInt(v.value || 0); });
  (ins.video_p95_watched_actions || []).forEach(function (v) { v95 += parseInt(v.value || 0); });
  (ins.video_p100_watched_actions || []).forEach(function (v) { v100 += parseInt(v.value || 0); });

  var hookRate = views > 0 ? v25 / views : 0;
  var holdRate = v25 > 0 ? v75 / v25 : 0;

  // Taxa conv: leads/clicks
  var convRate = clicks > 0 ? (results / clicks) : 0;

  // Detect tipo from campaign name
  var nameLower = (camp.name || '').toLowerCase();
  if (nameLower.indexOf('whatsapp') !== -1 || nameLower.indexOf('[whatsapp]') !== -1) tipo = 'whatsapp';
  else if (nameLower.indexOf('forms') !== -1 || nameLower.indexOf('[forms]') !== -1) tipo = 'leadgen';

  var statusMap = { ACTIVE: 'active', PAUSED: 'paused', CAMPAIGN_PAUSED: 'paused' };

  return {
    id: camp.id,
    name: camp.name,
    objective: camp.objective || '',
    status: statusMap[camp.effective_status] || camp.effective_status,
    account: actLabel,
    accountId: actId,
    tipo: tipo,
    spend: spend,
    impressions: impressions,
    reach: reach,
    frequency: frequency,
    clicks: clicks,
    linkClicks: inlineLinkClicks,
    ctr: ctr,
    cpm: cpm,
    cpc: cpc,
    results: results,
    cpr: cpr,
    convRate: convRate,
    views: views,
    v25: v25, v50: v50, v75: v75, v95: v95, v100: v100,
    hookRate: hookRate,
    holdRate: holdRate
  };
}

function buildAccountAgg(acctIns) {
  var r = extractResults(acctIns.actions);
  var clicks = parseInt(acctIns.clicks || 0);
  var results = r.count;
  var spend = parseFloat(acctIns.spend || 0);
  var impressions = parseInt(acctIns.impressions || 0);
  var v25 = 0, views = 0;
  (acctIns.video_play_actions || []).forEach(function (v) { views += parseInt(v.value || 0); });
  (acctIns.video_p25_watched_actions || []).forEach(function (v) { v25 += parseInt(v.value || 0); });
  return {
    spend: spend,
    impressions: impressions,
    reach: parseInt(acctIns.reach || 0),
    frequency: parseFloat(acctIns.frequency || 0),
    clicks: clicks,
    ctr: parseFloat(acctIns.ctr || 0),
    cpm: parseFloat(acctIns.cpm || 0),
    cpc: parseFloat(acctIns.cpc || 0) || (clicks > 0 ? spend / clicks : 0),
    results: results,
    cpr: results > 0 ? spend / results : 0,
    convRate: clicks > 0 ? results / clicks : 0,
    hookRate: views > 0 ? v25 / views : 0
  };
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
      return res.status(200).json(hit.d);
    }
  }

  var token = process.env.META_ACCESS_TOKEN;
  var accountIds = (process.env.META_AD_ACCOUNT_IDS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var accountLabels = (process.env.META_AD_ACCOUNT_LABELS || '').split(',').map(function (s) { return s.trim(); });
  var accountTokens = (process.env.META_AD_ACCOUNT_TOKENS || '').split(',').map(function (s) { return s.trim(); });

  if (!token || accountIds.length === 0) {
    return res.status(500).json({
      error: 'META_ACCESS_TOKEN e META_AD_ACCOUNT_IDS não configurados nas env vars do Vercel'
    });
  }

  var datePreset = req.query.date_preset || 'last_30d';
  var sinceDate = req.query.since || '';
  var untilDate = req.query.until || '';

  // Resolve range atual para que possamos calcular o período anterior
  var cur = resolveRange(datePreset, sinceDate, untilDate);
  var prev = shiftRange(cur.since, cur.until);
  var curRangeStr = '&time_range={"since":"' + cur.since + '","until":"' + cur.until + '"}';
  var prevRangeStr = '&time_range={"since":"' + prev.since + '","until":"' + prev.until + '"}';

  try {
    var allCampaigns = [];
    var accountAggs = [];
    var placementsAll = [];
    var dailyMerged = {}; // date -> {spend,impressions,clicks,results}

    for (var i = 0; i < accountIds.length; i++) {
      var actId = accountIds[i];
      var actLabel = accountLabels[i] || actId;
      var actToken = (accountTokens[i] && accountTokens[i].length > 0) ? accountTokens[i] : token;

      // 1. Campanhas (meta)
      var campaignsUrl = GRAPH_API + '/' + actId + '/campaigns'
        + '?fields=name,status,objective,effective_status,daily_budget,lifetime_budget'
        + '&effective_status=["ACTIVE","PAUSED","CAMPAIGN_PAUSED"]'
        + '&limit=200&access_token=' + actToken;
      var campData = await fetchJson(campaignsUrl);
      if (campData.error) {
        return res.status(400).json({ error: campData.error.message, account: actId });
      }
      var campaigns = campData.data || [];

      // 2+3. Insights atual + prévio (paralelo)
      var [insMapCur, insMapPrev, acctAggCur, acctAggPrev, dailySeries, placements] = await Promise.all([
        getCampaignInsights(actId, actToken, curRangeStr),
        getCampaignInsights(actId, actToken, prevRangeStr).catch(function () { return {}; }),
        getAccountAgg(actId, actToken, curRangeStr),
        getAccountAgg(actId, actToken, prevRangeStr).catch(function () { return {}; }),
        getAccountDaily(actId, actToken, curRangeStr).catch(function () { return []; }),
        getPlacements(actId, actToken, curRangeStr).catch(function () { return []; })
      ]);

      // Account agg current + previous deltas
      var aggCur = buildAccountAgg(acctAggCur);
      var aggPrev = buildAccountAgg(acctAggPrev);
      accountAggs.push({
        id: actId,
        label: actLabel,
        spend: aggCur.spend,
        impressions: aggCur.impressions,
        reach: aggCur.reach,
        frequency: aggCur.frequency,
        clicks: aggCur.clicks,
        ctr: aggCur.ctr,
        cpm: aggCur.cpm,
        cpc: aggCur.cpc,
        results: aggCur.results,
        cpr: aggCur.cpr,
        convRate: aggCur.convRate,
        hookRate: aggCur.hookRate,
        prev: aggPrev,
        dailySeries: dailySeries
      });

      // Merge daily into global
      dailySeries.forEach(function (d) {
        if (!dailyMerged[d.date]) dailyMerged[d.date] = { date: d.date, spend: 0, impressions: 0, clicks: 0, results: 0 };
        dailyMerged[d.date].spend += d.spend;
        dailyMerged[d.date].impressions += d.impressions;
        dailyMerged[d.date].clicks += d.clicks;
        dailyMerged[d.date].results += d.results;
      });

      // Placements (com label da conta)
      placements.forEach(function (p) { p.account = actLabel; p.accountId = actId; });
      placementsAll = placementsAll.concat(placements);

      // Campanhas com dados atuais e prévios
      campaigns.forEach(function (camp) {
        var built = buildCampaign(camp, insMapCur[camp.id], actLabel, actId);
        var prevIns = insMapPrev[camp.id];
        if (prevIns) {
          var prevBuilt = buildCampaign(camp, prevIns, actLabel, actId);
          built.prev = {
            spend: prevBuilt.spend,
            results: prevBuilt.results,
            cpr: prevBuilt.cpr,
            ctr: prevBuilt.ctr,
            cpm: prevBuilt.cpm,
            clicks: prevBuilt.clicks,
            impressions: prevBuilt.impressions,
            hookRate: prevBuilt.hookRate,
            frequency: prevBuilt.frequency
          };
        } else {
          built.prev = null;
        }
        allCampaigns.push(built);
      });
    }

    // Daily merged ordenado
    var globalDaily = Object.keys(dailyMerged).sort().map(function (k) { return dailyMerged[k]; });

    // Totais do período atual e do anterior (para delta global)
    var totalsCur = accountAggs.reduce(function (a, b) {
      a.spend += b.spend; a.impressions += b.impressions; a.reach += b.reach;
      a.clicks += b.clicks; a.results += b.results;
      return a;
    }, { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0 });
    var totalsPrev = accountAggs.reduce(function (a, b) {
      var p = b.prev || {};
      a.spend += (p.spend || 0);
      a.impressions += (p.impressions || 0);
      a.reach += (p.reach || 0);
      a.clicks += (p.clicks || 0);
      a.results += (p.results || 0);
      return a;
    }, { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0 });

    var payload = {
      success: true,
      period: cur.since + ' → ' + cur.until,
      periodPrev: prev.since + ' → ' + prev.until,
      rangeDays: prev.days,
      dateRange: cur,
      dateRangePrev: { since: prev.since, until: prev.until },
      accounts: accountAggs,
      campaigns: allCampaigns,
      placements: placementsAll,
      dailySeries: globalDaily,
      totals: { cur: totalsCur, prev: totalsPrev },
      fetchedAt: new Date().toISOString()
    };
    __cache[cacheKey] = { t: Date.now(), d: payload };
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro ao consultar Meta API' });
  }
};
