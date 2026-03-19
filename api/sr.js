// ─── SR. PERFORMANCE (Google Gemini AI Proxy) ────────────────────────────────
// Vercel Serverless Function — proxies to Google Gemini API
// Env var: GEMINI_API_KEY (get free at aistudio.google.com/apikey)

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
    // Priority: header from frontend > env var on Vercel
    const headerKey = req.headers['x-gemini-key'] || '';
    const apiKey = headerKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return res.status(200).json({
        content: [{ type: 'text', text: '⚠️ Sr. Performance precisa da chave Google Gemini.\n\n1. Acesse aistudio.google.com/apikey\n2. Clique "Create API Key"\n3. Copie a chave AIza...\n4. No PSM, vá em Configurações > Inteligência Artificial\n5. Cole a chave no campo "Google Gemini"' }]
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const systemPrompt = body.system || '';
    const messages = body.messages || [];

    // Convert messages to Gemini format
    const contents = [];
    if (systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: 'SYSTEM INSTRUCTIONS: ' + systemPrompt }] });
      contents.push({ role: 'model', parts: [{ text: 'Entendido. Vou seguir essas instruções.' }] });
    }
    messages.forEach(m => {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    });

    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

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

    const geminiData = JSON.parse(resp.body);
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Não consegui responder. Verifique a GEMINI_API_KEY.';

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      content: [{ type: 'text', text }]
    });

  } catch (err) {
    console.error('[SR] Error:', err.message);
    return res.status(200).json({
      content: [{ type: 'text', text: '⚠️ Erro no Sr. Performance: ' + err.message }]
    });
  }
};
