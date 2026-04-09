// api/gemini-text.js — proxy simples para Gemini retornando TEXTO
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { apiKey, prompt, model } = req.body || {};
    if (!apiKey || !prompt) return res.status(400).json({ error: 'apiKey e prompt são obrigatórios' });

    const m = model || 'gemini-2.0-flash-exp';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + apiKey;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          maxOutputTokens: 2048
        }
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: (data && data.error && data.error.message) || ('Gemini error ' + r.status) });
    }

    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    let text = '';
    parts.forEach(function (p) { if (p.text) text += p.text; });

    if (!text) {
      return res.status(422).json({ error: 'Gemini não retornou texto.' });
    }

    return res.status(200).json({ text: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
