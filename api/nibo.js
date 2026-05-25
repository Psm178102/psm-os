// api/nibo.js — Vercel Serverless Function
// v75.21: Proxy seguro NIBO API MULTI-TENANT (2 CNPJs)
//
// Tokens (env Vercel):
//   NIBO_API_TOKEN       → PSM Assessoria & Negocios Imobiliarios (CNPJ 50.741.349/0001-52)
//                          empresa "imoveis" (Imóveis + Conquista)
//   NIBO_TOKEN_LOCACAO   → PSM Negocios & Locacao (CNPJ 45.078.081/0001-80)
//                          empresa "locacao"
//
// Endpoints suportados via GET:
//   ?endpoint=accounts&company=imoveis|locacao|all
//   ?endpoint=schedules/debit&company=imoveis|locacao|all
//   ?endpoint=schedules/credit&company=imoveis|locacao|all
//   ?endpoint=categories&company=imoveis|locacao|all
//   ?endpoint=costcenters&company=imoveis|locacao|all
//
// Quando company=all (ou ausente): consolida as 2 empresas em uma única resposta.
// Cada item tem _company:'imoveis'|'locacao' pra identificar origem.
//
// Cache 5min por (endpoint+company+queryparams).

const NIBO_BASE = 'https://api.nibo.com.br/empresas/v1';
const ALLOWED_ENDPOINTS = [
  'accounts','schedules/debit','schedules/credit','schedules',
  'categories','costcenters','stakeholders/customer','stakeholders/supplier',
  'stakeholders','products','companies','organization','users'
];

const COMPANY_TOKENS = {
  imoveis: 'NIBO_API_TOKEN',
  locacao: 'NIBO_TOKEN_LOCACAO'
};
const COMPANY_LABELS = {
  imoveis: 'PSM Imóveis',
  locacao: 'PSM Locação'
};

// In-memory cache (lives per warm Lambda instance). 5min TTL.
var __cache = {};
var CACHE_TTL_MS = 5 * 60 * 1000;

function fetchWithTimeout(url, opts, ms) {
  ms = ms || 25000;
  var controller = new AbortController();
  var timeout = setTimeout(function(){ controller.abort(); }, ms);
  return fetch(url, Object.assign({}, opts, { signal: controller.signal }))
    .then(function(r){ clearTimeout(timeout); return r; })
    .catch(function(e){ clearTimeout(timeout); throw e; });
}

// Fetch uma única empresa
async function fetchOne(company, endpoint, qs) {
  var envKey = COMPANY_TOKENS[company];
  if (!envKey) throw new Error('company invalida: '+company);
  var token = process.env[envKey];
  if (!token) throw new Error(envKey+' nao configurado no Vercel');

  var url = NIBO_BASE + '/' + endpoint + qs;
  var resp = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'apitoken': token,
      'Accept': 'application/json',
      'User-Agent': 'PSM-OS/75.21'
    }
  }, 25000);

  if (!resp.ok) {
    var errText = await resp.text();
    var err = new Error('NIBO HTTP '+resp.status);
    err.status = resp.status;
    err.body = errText.substring(0, 500);
    err.company = company;
    throw err;
  }
  var data = await resp.json();
  var items = data.items || (Array.isArray(data) ? data : [data]);
  // Tag cada item com a empresa de origem
  items.forEach(function(it){
    if (it && typeof it === 'object') {
      it._company = company;
      it._companyLabel = COMPANY_LABELS[company];
    }
  });
  return { items: items, count: data.count != null ? data.count : items.length };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  var q = req.query || {};
  var endpoint = String(q.endpoint || 'accounts').trim();
  if (ALLOWED_ENDPOINTS.indexOf(endpoint) < 0) {
    return res.status(400).json({ ok:false, error:'endpoint nao permitido. Aceitos: '+ALLOWED_ENDPOINTS.join(', ') });
  }
  var company = String(q.company || 'all').trim().toLowerCase();
  if (['imoveis','locacao','all'].indexOf(company) < 0) {
    return res.status(400).json({ ok:false, error:'company invalida. Aceitos: imoveis, locacao, all' });
  }

  // Query string adicional (OData)
  var qsParts = [];
  ['$top','$skip','$filter','$orderby','$select','$expand','$count'].forEach(function(k){
    if (q[k] != null && q[k] !== '') qsParts.push(encodeURIComponent(k)+'='+encodeURIComponent(q[k]));
  });
  if (qsParts.filter(function(p){return p.indexOf('%24top')===0;}).length === 0) {
    qsParts.push('%24top=500');
  }
  var qs = qsParts.length ? ('?'+qsParts.join('&')) : '';

  var cacheKey = endpoint + '|' + company + '|' + qs;
  if (!q.nocache) {
    var hit = __cache[cacheKey];
    if (hit && (Date.now() - hit.t) < CACHE_TTL_MS) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Age', String(Math.floor((Date.now() - hit.t) / 1000)));
      return res.status(200).json(Object.assign({}, hit.d, { cached: true }));
    }
  }

  try {
    var allItems = [];
    var totalCount = 0;
    var errors = [];
    var companies = (company === 'all') ? ['imoveis','locacao'] : [company];

    // Promise.allSettled — uma falha não derruba a outra
    var results = await Promise.allSettled(companies.map(function(c){ return fetchOne(c, endpoint, qs); }));
    results.forEach(function(r, i){
      var c = companies[i];
      if (r.status === 'fulfilled') {
        allItems = allItems.concat(r.value.items);
        totalCount += r.value.count;
      } else {
        var e = r.reason || {};
        errors.push({
          company: c,
          label: COMPANY_LABELS[c],
          message: e.message || String(e),
          status: e.status,
          body: e.body
        });
      }
    });

    var payload = {
      ok: errors.length === 0,
      partial: errors.length > 0 && errors.length < companies.length,
      endpoint: endpoint,
      company: company,
      items: allItems,
      count: totalCount,
      errors: errors,
      fetchedAt: new Date().toISOString()
    };
    if (errors.length === 0) __cache[cacheKey] = { t: Date.now(), d: payload };
    res.setHeader('X-Cache', errors.length === 0 ? 'MISS' : 'PARTIAL');
    return res.status(200).json(payload);

  } catch(e) {
    var msg = (e && e.name === 'AbortError') ? 'NIBO timeout (25s)' : String(e && e.message || e);
    return res.status(502).json({ ok:false, error: msg, endpoint: endpoint, company: company });
  }
};
