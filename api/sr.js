// ─── SR. PERFORMANCE (Google Gemini AI Proxy) ────────────────────────────────
const https = require('https');

function httpsReq(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: opts.method || 'POST',
      headers: opts.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Gemini-Key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Get API key: header > query param > env var
    const headerKey = (req.headers['x-gemini-key'] || '').trim();
    const queryKey = (req.query?.gemini_key || '').trim();
    const apiKey = headerKey || queryKey || process.env.GEMINI_API_KEY || '';

    console.log('[SR] Key source:', headerKey ? 'header' : queryKey ? 'query' : process.env.GEMINI_API_KEY ? 'env' : 'NONE');
    console.log('[SR] Key prefix:', apiKey ? apiKey.slice(0,8)+'...' : 'EMPTY');

    if (!apiKey) {
      return res.status(200).json({
        content: [{ type: 'text', text: '⚠️ Chave Gemini não encontrada.\n\nVá em Configurações > Inteligência Artificial e cole sua chave AIza...' }]
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const systemPrompt = body.system || '';
    const messages = body.messages || [];

    // Convert to Gemini format
    const contents = [];
    if (systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: 'INSTRUÇÕES DO SISTEMA: ' + systemPrompt }] });
      contents.push({ role: 'model', parts: [{ text: 'Entendido, vou seguir essas instruções.' }] });
    }
    messages.forEach(m => {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }]
      });
    });

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Olá' }] });
    }

    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

    console.log('[SR] Calling Gemini with', contents.length, 'messages');

    const resp = await httpsReq(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: body.max_tokens || 1024,
          temperature: 0.7,
        },
      }),
    });

    console.log('[SR] Gemini response:', resp.status, resp.body.slice(0, 200));

    if (resp.status !== 200) {
      // Parse Gemini error
      let errMsg = 'Erro ' + resp.status;
      try {
        const errData = JSON.parse(resp.body);
        errMsg = errData.error?.message || errData.error?.status || errMsg;
      } catch(e) {}
      return res.status(200).json({
        content: [{ type: 'text', text: '❌ Gemini retornou erro: ' + errMsg + '\n\nVerifique se a chave API está correta em Configurações > Inteligência Artificial.' }]
      });
    }

    const geminiData = JSON.parse(resp.body);
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      const blockReason = geminiData.candidates?.[0]?.finishReason || geminiData.promptFeedback?.blockReason || 'unknown';
      return res.status(200).json({
        content: [{ type: 'text', text: '⚠️ Gemini não gerou resposta. Motivo: ' + blockReason }]
      });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (err) {
    console.error('[SR] Exception:', err.message);
    return res.status(200).json({
      content: [{ type: 'text', text: '❌ Erro: ' + err.message }]
    });
  }
};
