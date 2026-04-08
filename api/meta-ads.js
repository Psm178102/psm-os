// api/meta-ads.js â Vercel Serverless Function
// Proxy seguro para Meta Marketing API (nÃ£o expÃµe token no frontend)

const GRAPH_API = 'https://graph.facebook.com/v21.0';

// In-memory cache (lives per warm Lambda instance). 30s TTL.
// Evita estourar rate limit com auto-refresh do frontend.
var __cache = {};
var CACHE_TTL_MS = 30 * 1000;

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
  // Comma-separated: "act_123456,act_789012"
  var accountIds = (process.env.META_AD_ACCOUNT_IDS || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  // Comma-separated labels matching accounts: "Paulo Morimatsu,PSM Imoveis"
  var accountLabels = (process.env.META_AD_ACCOUNT_LABELS || '').split(',').map(function(s){ return s.trim(); });
  // Optional comma-separated per-account tokens matching accounts. Empty entry = fallback to META_ACCESS_TOKEN.
  // Useful when each ad account is in a different Business Manager and needs its own System User token.
  var accountTokens = (process.env.META_AD_ACCOUNT_TOKENS || '').split(',').map(function(s){ return s.trim(); });

  if (!token || accountIds.length === 0) {
    return res.status(500).json({
      error: 'META_ACCESS_TOKEN e META_AD_ACCOUNT_IDS nÃ£o configurados nas env vars do Vercel'
    });
  }

  // Date range (default: last 30 days)
  var datePreset = req.query.date_preset || 'last_30d';
  var sinceDate = req.query.since || '';
  var untilDate = req.query.until || '';

  try {
    var allCampaigns = [];
    var accountSpend = [];

    for (var i = 0; i < accountIds.length; i++) {
      var actId = accountIds[i];
      var actLabel = accountLabels[i] || actId;
      var actToken = (accountTokens[i] && accountTokens[i].length > 0) ? accountTokens[i] : token;

      // 1. Get active campaigns
      var campaignsUrl = GRAPH_API + '/' + actId + '/campaigns'
        + '?fields=name,status,objective,effective_status'
        + '&effective_status=["ACTIVE","PAUSED","CAMPAIGN_PAUSED"]'
        + '&limit=100'
        + '&access_token=' + actToken;

      var campResp = await fetch(campaignsUrl);
      var campData = await campResp.json();

      if (campData.error) {
        return res.status(400).json({ error: campData.error.message, account: actId });
      }

      var campaigns = campData.data || [];

      // 2. Get insights at campaign level
      var insightsUrl = GRAPH_API + '/' + actId + '/insights'
        + '?fields=campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,ctr,cpm,'
        + 'actions,cost_per_action_type,'
        + 'video_avg_time_watched_actions,'
        + 'video_p25_watched_actions,video_p50_watched_actions,'
        + 'video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,'
        + 'video_play_actions'
        + '&level=campaign'
        + '&limit=100'
        + '&access_token=' + actToken;

      if (sinceDate && untilDate) {
        insightsUrl += '&time_range={"since":"' + sinceDate + '","until":"' + untilDate + '"}';
      } else {
        insightsUrl += '&date_preset=' + datePreset;
      }

      var insResp = await fetch(insightsUrl);
      var insData = await insResp.json();

      if (insData.error) {
        return res.status(400).json({ error: insData.error.message, account: actId });
      }

      var insights = insData.data || [];
      var insightsMap = {};
      insights.forEach(function(ins) {
        insightsMap[ins.campaign_id] = ins;
      });

      // 3. Get account-level insights for total spend
      var acctInsUrl = GRAPH_API + '/' + actId + '/insights'
        + '?fields=spend,impressions,reach,frequency,clicks,actions'
        + '&access_token=' + actToken;

      if (sinceDate && untilDate) {
        acctInsUrl += '&time_range={"since":"' + sinceDate + '","until":"' + untilDate + '"}';
      } else {
        acctInsUrl += '&date_preset=' + datePreset;
      }

      var acctResp = await fetch(acctInsUrl);
      var acctData = await acctResp.json();
      var acctIns = (acctData.data && acctData.data[0]) || {};

      accountSpend.push({
        id: actId,
        label: actLabel,
        spend: parseFloat(acctIns.spend || 0),
        impressions: parseInt(acctIns.impressions || 0),
        reach: parseInt(acctIns.reach || 0),
        frequency: parseFloat(acctIns.frequency || 0),
        clicks: parseInt(acctIns.clicks || 0)
      });

      // 4. Merge campaign + insights data
      campaigns.forEach(function(camp) {
        var ins = insightsMap[camp.id] || {};
        var spend = parseFloat(ins.spend || 0);
        var impressions = parseInt(ins.impressions || 0);
        var reach = parseInt(ins.reach || 0);
        var frequency = parseFloat(ins.frequency || 0);
        if (!frequency && reach > 0) frequency = impressions / reach;
        var clicks = parseInt(ins.clicks || 0);
        var ctr = parseFloat(ins.ctr || 0);
        var cpm = parseFloat(ins.cpm || 0);

        // Extract results (leads/messages) from actions
        var results = 0;
        var tipo = 'leadgen';
        var actions = ins.actions || [];
        actions.forEach(function(a) {
          if (a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
              a.action_type === 'onsite_conversion.messaging_first_reply') {
            results += parseInt(a.value || 0);
            tipo = 'whatsapp';
          }
          if (a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead') {
            results += parseInt(a.value || 0);
          }
        });

        // Cost per result
        var cpr = 0;
        var costActions = ins.cost_per_action_type || [];
        costActions.forEach(function(ca) {
          if (ca.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
              ca.action_type === 'lead' ||
              ca.action_type === 'offsite_conversion.fb_pixel_lead' ||
              ca.action_type === 'onsite_conversion.messaging_first_reply') {
            cpr = parseFloat(ca.value || 0);
          }
        });
        if (cpr === 0 && results > 0) cpr = spend / results;

        // Video metrics
        var views = 0, v25 = 0, v50 = 0, v75 = 0, v95 = 0, v100 = 0;
        var videoPlay = ins.video_play_actions || [];
        videoPlay.forEach(function(v) { views += parseInt(v.value || 0); });
        (ins.video_p25_watched_actions || []).forEach(function(v) { v25 += parseInt(v.value || 0); });
        (ins.video_p50_watched_actions || []).forEach(function(v) { v50 += parseInt(v.value || 0); });
        (ins.video_p75_watched_actions || []).forEach(function(v) { v75 += parseInt(v.value || 0); });
        (ins.video_p95_watched_actions || []).forEach(function(v) { v95 += parseInt(v.value || 0); });
        (ins.video_p100_watched_actions || []).forEach(function(v) { v100 += parseInt(v.value || 0); });

        var hookRate = views > 0 ? v25 / views : 0;
        var holdRate = v25 > 0 ? v75 / v25 : 0;

        // Detect tipo from campaign name
        var nameLower = camp.name.toLowerCase();
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

        allCampaigns.push({
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
          ctr: ctr,
          cpm: cpm,
          results: results,
          cpr: cpr,
          views: views,
          v25: v25,
          v50: v50,
          v75: v75,
          v95: v95,
          v100: v100,
          hookRate: hookRate,
          holdRate: holdRate
        });
      });
    }

    // Build response
    var today = new Date();
    var thirtyAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    var period = (sinceDate || formatDate(thirtyAgo)) + ' - ' + (untilDate || formatDate(today));

    var payload = {
      success: true,
      period: period,
      accounts: accountSpend,
      campaigns: allCampaigns,
      fetchedAt: new Date().toISOString()
    };
    __cache[cacheKey] = { t: Date.now(), d: payload };
    res.setHeader('X-Cache', 'MISS');
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
