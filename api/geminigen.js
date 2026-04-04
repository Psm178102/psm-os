export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { apiKey, prompt } = req.body;
    if (!apiKey || !prompt) return res.status(400).json({ error: 'apiKey and prompt are required' });
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=' + apiKey;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Gemini error ' + r.status });
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const imgPart = parts.find(function(p) { return p.inlineData; });
    if (imgPart) {
      return res.status(200).json({
        image: 'data:' + imgPart.inlineData.mimeType + ';base64,' + imgPart.inlineData.data,
        text: (parts.find(function(p) { return p.text; }) || {}).text || null
      });
    }
    return res.status(422).json({ error: 'Gemini nao retornou imagem. Tente novamente.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
