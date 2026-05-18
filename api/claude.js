// api/claude.js — Vercel Serverless Function
// v75.18: Proxy IA genérico com fallback automático Claude → Gemini
// Recebe: POST { system?, messages, max_tokens?, temperature?, response_json?, prefer? }
// Devolve: { ok, text, json?, model_used, fallback_reason?, usage }

const { callAI } = require('./_ai.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){ body = {}; } }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return res.status(400).json({ ok:false, error:'messages obrigatorio (array)' });

  try {
    const result = await callAI({
      system: body.system,
      messages: messages,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      response_json: body.response_json === true,
      prefer: body.prefer || 'claude'
    });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (e) {
    return res.status(502).json({ ok:false, error: String(e.message || e) });
  }
};
