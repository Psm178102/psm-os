// api/ai-analysis.js — Vercel Serverless Function
// v75.18: Proxy de análise IA com fallback automático Claude → Gemini.
// Recebe: POST { prompt: string, max_tokens?, temperature? }
// Devolve: { ok, text, model_used, fallback_reason?, usage }

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

  const prompt = String(body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ ok:false, error: 'prompt obrigatorio' });
  if (prompt.length > 40000) return res.status(400).json({ ok:false, error: 'prompt muito longo (max 40000 chars)' });

  const system = 'Você é um analista senior de marketing digital especializado em Meta Ads para o segmento imobiliário no Brasil. Você é direto, prático, conhece bem o cotidiano de uma imobiliária (lançamentos, MCMV, lead WhatsApp, ficha, visita, proposta). Responda em português BR com markdown limpo.';

  try {
    const result = await callAI({
      system: system,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: Math.min(8192, parseInt(body.max_tokens, 10) || 2048),
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.5,
      // Motor principal configurável via env AI_PREFER ('gemini' | 'claude').
      // Com a conta Anthropic sem saldo, setar AI_PREFER=gemini faz o Gemini Pro
      // ser o primário (sem bater no Claude morto e tomar erro/latência a cada call).
      prefer: body.prefer || process.env.AI_PREFER || 'claude',
      // Modelo forte por provedor (quando setado no Vercel): CLAUDE_SMART_MODEL
      // (Opus) p/ Claude, GEMINI_SMART_MODEL (ex.: gemini-2.5-pro) p/ Gemini.
      // body.model força o modelo Claude.
      model: body.model || process.env.CLAUDE_SMART_MODEL || undefined,
      // Visão: imagens (base64) — [{base64, media_type}] ou [{url}]. Máx 8.
      images: Array.isArray(body.images) ? body.images.slice(0, 8) : undefined,
    });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (e) {
    return res.status(502).json({ ok:false, error: String(e.message || e) });
  }
};
