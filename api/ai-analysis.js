// api/ai-analysis.js — Vercel Serverless Function
// v75.16: Análise IA Profunda (Meta ADS, etc) — MIGRADO de Gemini para Claude Haiku 4.5.
//
// Antes (v75.7): proxy Gemini Flash com GEMINI_API_KEY no env
// Agora (v75.16): proxy Claude Haiku 4.5 com ANTHROPIC_API_KEY no env
//
// Recebe: POST { prompt: string, max_tokens?: number, temperature?: number }
// Devolve: { ok: true, text: string, model } ou { ok: false, error: string }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ ok:false, error: 'ANTHROPIC_API_KEY nao configurado no Vercel' });

  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){ body = {}; } }

  var prompt = String(body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ ok:false, error: 'prompt obrigatorio' });
  if (prompt.length > 40000) return res.status(400).json({ ok:false, error: 'prompt muito longo (max 40000 chars)' });

  var maxTokens = parseInt(body.max_tokens, 10);
  if (isNaN(maxTokens) || maxTokens < 1 || maxTokens > 8192) maxTokens = 2048;

  var temperature = Number(body.temperature);
  if (isNaN(temperature) || temperature < 0 || temperature > 1) temperature = 0.5;

  var model = 'claude-haiku-4-5';

  var system = 'Você é um analista senior de marketing digital especializado em Meta Ads para o segmento imobiliário no Brasil. ';
  system += 'Você é direto, prático, conhece bem o cotidiano de uma imobiliária (lançamentos, MCMV, lead WhatsApp, ficha, visita, proposta). ';
  system += 'Responda em português BR com markdown limpo.';

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function(){ controller.abort(); }, 30000);
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        temperature: temperature,
        system: system,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(resp.status).json({ ok:false, error: 'Claude HTTP ' + resp.status + ': ' + errText.substring(0,500) });
    }
    var data = await resp.json();
    var text = '';
    if (Array.isArray(data.content)) data.content.forEach(function(c){ if (c && c.type === 'text') text += (c.text || ''); });
    if (!text) return res.status(502).json({ ok:false, error: 'Claude retornou resposta vazia/inesperada' });
    return res.status(200).json({ ok:true, text: text, model: model, usage: data.usage || {} });
  } catch(e) {
    var msg = (e && e.name === 'AbortError') ? 'Claude timeout (30s)' : String(e && e.message || e);
    return res.status(502).json({ ok:false, error: msg });
  }
};
