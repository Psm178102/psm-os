// api/ai-analysis.js — Vercel Serverless Function
// v75.7: Proxy seguro para Google Gemini API (não expõe API key no frontend).
//
// Antes (bug crítico): cliente chamava generativelanguage.googleapis.com direto com
// ?key=<gemini_key> na URL. Qualquer um inspecionando rede via DevTools via a chave.
// Agora: chave fica em GEMINI_API_KEY (env Vercel), client só envia prompt+contexto.
//
// Recebe: POST { prompt: string, model?: string, temperature?: number, maxTokens?: number }
// Devolve: { ok: true, text: string } ou { ok: false, error: string }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error: 'Method not allowed' });
  }

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok:false, error: 'GEMINI_API_KEY nao configurado no Vercel' });
  }

  // Parse body (Vercel já parseia JSON automaticamente)
  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_) { body = {}; } }

  var prompt = String(body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ ok:false, error: 'prompt obrigatorio' });
  }
  if (prompt.length > 32000) {
    return res.status(400).json({ ok:false, error: 'prompt muito longo (max 32000 chars)' });
  }

  var model = String(body.model || 'gemini-2.5-flash');
  // sanitiza model para evitar injection
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) {
    return res.status(400).json({ ok:false, error: 'modelo invalido' });
  }
  var temperature = Number(body.temperature);
  if (isNaN(temperature) || temperature < 0 || temperature > 2) temperature = 0.5;
  var maxTokens = parseInt(body.maxTokens, 10);
  if (isNaN(maxTokens) || maxTokens < 1 || maxTokens > 8192) maxTokens = 2048;

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  try {
    // Timeout 30s
    var controller = new AbortController();
    var timeout = setTimeout(function(){ controller.abort(); }, 30000);
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(resp.status).json({ ok:false, error: 'Gemini API HTTP ' + resp.status + ': ' + errText.substring(0,500) });
    }
    var data = await resp.json();
    var text = '';
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
      text = data.candidates[0].content.parts[0].text || '';
    }
    if (!text && data.error) {
      var em = typeof data.error === 'string' ? data.error : String(data.error.message || JSON.stringify(data.error));
      return res.status(502).json({ ok:false, error: 'Gemini retornou erro: ' + em });
    }
    if (!text) {
      return res.status(502).json({ ok:false, error: 'Gemini retornou resposta vazia/inesperada' });
    }
    return res.status(200).json({ ok:true, text: text });
  } catch(e) {
    var msg = (e && e.name === 'AbortError') ? 'Gemini timeout (30s)' : String(e && e.message || e);
    return res.status(502).json({ ok:false, error: msg });
  }
};
