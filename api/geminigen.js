export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { apiKey, prompt, refImage } = req.body;
    if (!apiKey || !prompt) return res.status(400).json({ error: 'apiKey and prompt are required' });
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + apiKey;
    var parts = [{ text: prompt }];
    if (refImage) {
      var match = refImage.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.unshift({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Gemini error ' + r.status });
    const rParts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const imgPart = rParts.find(function(p) { return p.inlineData; });
    if (imgPart) {
      return res.status(200).json({
        image: 'data:' + imgPart.inlineData.mimeType + ';base64,' + imgPart.inlineData.data,
        text: (rParts.find(function(p) { return p.text; }) || {}).text || null
      });
    }
    return res.status(422).json({ error: 'Gemini nao retornou imagem. Tente novamente.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
