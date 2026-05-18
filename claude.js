// api/claude.js — Vercel Serverless Function
// v75.16: Proxy seguro para Anthropic Claude API (Sr. Performance + Sr. Gerência)
//
// Antes (Gemini): chave exposta no client, custo baixo, qualidade boa
// Agora (Claude): chave no env Vercel (ANTHROPIC_API_KEY), Haiku 4.5 padrão
//
// Recebe: POST {
//   system?: string,                          // system prompt
//   messages: [{role:'user'|'assistant', content}],  // historico
//   model?: 'claude-haiku-4-5' (default) | 'claude-sonnet-4-5'
//   max_tokens?: number (default 1024),
//   temperature?: number (default 0.7),
//   response_json?: boolean                   // se true, força JSON output
// }
// Devolve: {
//   ok: true, text, model, usage: {input_tokens, output_tokens}
// } ou { ok: false, error }

const DEFAULT_MODEL = 'claude-haiku-4-5';
const ALLOWED_MODELS = ['claude-haiku-4-5','claude-sonnet-4-5','claude-opus-4-7','claude-3-5-haiku-latest','claude-3-5-sonnet-latest'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ ok:false, error:'ANTHROPIC_API_KEY nao configurado no Vercel' });

  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){ body = {}; } }

  var system = String(body.system || '').slice(0, 16000);
  var messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return res.status(400).json({ ok:false, error:'messages obrigatorio (array)' });

  // Sanitiza mensagens
  var cleanMessages = messages.slice(-30).map(function(m){  // max 30 mensagens (~limite histórico)
    var role = (m.role === 'assistant') ? 'assistant' : 'user';
    var content = String(m.content || '').slice(0, 60000);
    return { role: role, content: content };
  }).filter(function(m){ return m.content.length > 0; });

  // A Anthropic exige que mensagens alternem user/assistant começando com user
  // Vamos garantir isso (merge mensagens consecutivas do mesmo role)
  var merged = [];
  cleanMessages.forEach(function(m){
    if (merged.length > 0 && merged[merged.length-1].role === m.role) {
      merged[merged.length-1].content += '\n\n' + m.content;
    } else {
      merged.push(m);
    }
  });
  // Se primeira não for user, prepend dummy user
  if (merged.length > 0 && merged[0].role !== 'user') {
    merged.unshift({ role:'user', content:'(continuar)' });
  }

  var model = String(body.model || DEFAULT_MODEL);
  if (ALLOWED_MODELS.indexOf(model) < 0) model = DEFAULT_MODEL;

  var maxTokens = parseInt(body.max_tokens, 10);
  if (isNaN(maxTokens) || maxTokens < 1 || maxTokens > 8192) maxTokens = 1024;

  var temperature = Number(body.temperature);
  if (isNaN(temperature) || temperature < 0 || temperature > 1) temperature = 0.7;

  // Se response_json=true, força JSON adicionando ao system
  if (body.response_json === true) {
    system += '\n\nIMPORTANTE: Responda APENAS com JSON válido. Sem markdown (```json), sem texto antes ou depois. Apenas o objeto JSON puro.';
  }

  var payload = {
    model: model,
    max_tokens: maxTokens,
    temperature: temperature,
    messages: merged
  };
  if (system.trim().length > 0) payload.system = system;

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
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(resp.status).json({ ok:false, error:'Anthropic HTTP '+resp.status+': '+errText.substring(0,500) });
    }
    var data = await resp.json();
    // Anthropic retorna: { content: [{type:'text', text:'...'}], usage: {...}, model, ... }
    var text = '';
    if (Array.isArray(data.content)) {
      data.content.forEach(function(c){ if (c && c.type === 'text') text += (c.text || ''); });
    }
    if (!text) return res.status(502).json({ ok:false, error:'Claude retornou resposta vazia', raw: JSON.stringify(data).substring(0,400) });

    // Se response_json, tenta parsear pra validar
    var parsed = null;
    if (body.response_json === true) {
      var cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try { parsed = JSON.parse(cleaned); text = cleaned; }
      catch(e) { return res.status(502).json({ ok:false, error:'Claude retornou JSON invalido: '+text.substring(0,300), raw: text }); }
    }

    return res.status(200).json({
      ok: true,
      text: text,
      json: parsed,
      model: data.model || model,
      usage: data.usage || {}
    });
  } catch(e) {
    var msg = (e && e.name === 'AbortError') ? 'Claude timeout (30s)' : String(e && e.message || e);
    return res.status(502).json({ ok:false, error: msg });
  }
};
