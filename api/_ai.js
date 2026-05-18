// api/_ai.js — Helper interno (prefixo _ não vira endpoint Vercel)
// v75.18: callAI() unificado com fallback automático Claude → Gemini
//
// Uso:
//   const {callAI} = require('./_ai.js');
//   const result = await callAI({
//     system: "You are X...",
//     messages: [{role:'user', content:'...'}],
//     max_tokens: 1024,
//     temperature: 0.7,
//     response_json: false  // se true, força JSON
//   });
//   // result = { ok, text, model_used, fallback_reason?, usage }

const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const ANTHROPIC_TIMEOUT_MS = 28000;
const GEMINI_TIMEOUT_MS = 28000;

function fetchWithTimeout(url, opts, ms) {
  ms = ms || 25000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: controller.signal }))
    .then(r => { clearTimeout(timeout); return r; })
    .catch(e => {
      clearTimeout(timeout);
      if (e && e.name === 'AbortError') throw new Error('timeout');
      throw e;
    });
}

async function callClaude(opts) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('no_anthropic_key');

  const messages = (opts.messages || []).slice(-30)
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 60000)
    }))
    .filter(m => m.content.length > 0);

  // Merge mensagens consecutivas do mesmo role
  const merged = [];
  messages.forEach(m => {
    if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
      merged[merged.length - 1].content += '\n\n' + m.content;
    } else {
      merged.push(m);
    }
  });
  if (merged.length === 0) throw new Error('no_messages');
  if (merged[0].role !== 'user') merged.unshift({ role: 'user', content: '(continuar)' });

  let system = String(opts.system || '').slice(0, 16000);
  if (opts.response_json === true) {
    system += '\n\nIMPORTANTE: Responda APENAS com JSON válido. Sem markdown (```json), sem texto antes ou depois.';
  }

  const payload = {
    model: opts.model || DEFAULT_CLAUDE_MODEL,
    max_tokens: opts.max_tokens || 1024,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
    messages: merged
  };
  if (system.trim().length > 0) payload.system = system;

  const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  }, ANTHROPIC_TIMEOUT_MS);

  if (!resp.ok) {
    const errText = await resp.text();
    // Detect specific errors for fallback decision
    const err = new Error('claude_http_' + resp.status);
    err.status = resp.status;
    err.body = errText;
    err.isCreditError = errText.indexOf('credit_balance_too_low') >= 0 || errText.indexOf('credit balance') >= 0;
    err.isAuthError = resp.status === 401 || errText.indexOf('authentication_error') >= 0;
    err.isRateLimit = resp.status === 429;
    err.isServerError = resp.status >= 500;
    throw err;
  }
  const data = await resp.json();
  let text = '';
  if (Array.isArray(data.content)) {
    data.content.forEach(c => { if (c && c.type === 'text') text += (c.text || ''); });
  }
  if (!text) throw new Error('claude_empty_response');

  return {
    text: text,
    model: data.model || DEFAULT_CLAUDE_MODEL,
    usage: data.usage || {}
  };
}

async function callGemini(opts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('no_gemini_key');

  // Converter messages do formato Claude pra contents do Gemini
  const system = String(opts.system || '');
  const messages = (opts.messages || []).slice(-30);

  const contents = [];
  // Gemini usa system prompt como primeira message com role 'user' (truque)
  if (system.trim().length > 0) {
    contents.push({ role: 'user', parts: [{ text: 'SYSTEM PROMPT:\n' + system }] });
    contents.push({ role: 'model', parts: [{ text: 'Entendido. Vou seguir essas instruções.' }] });
  }
  messages.forEach(m => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role: role, parts: [{ text: String(m.content || '').slice(0, 60000) }] });
  });
  if (contents.length === 0) throw new Error('no_messages');
  // Gemini exige começar com 'user'
  if (contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '(continuar)' }] });

  const model = opts.geminiModel || DEFAULT_GEMINI_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  let extraInstructions = '';
  if (opts.response_json === true) {
    extraInstructions = '\n\nIMPORTANTE: Responda APENAS com JSON válido. Sem markdown, sem texto antes ou depois.';
    // Adiciona ao último user message
    const lastUser = contents.slice().reverse().find(c => c.role === 'user');
    if (lastUser) lastUser.parts[0].text += extraInstructions;
  }

  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: contents,
      generationConfig: {
        maxOutputTokens: opts.max_tokens || 1024,
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7
      }
    })
  }, GEMINI_TIMEOUT_MS);

  if (!resp.ok) {
    const errText = await resp.text();
    const err = new Error('gemini_http_' + resp.status);
    err.status = resp.status;
    err.body = errText;
    throw err;
  }
  const data = await resp.json();
  let text = '';
  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
    text = data.candidates[0].content.parts[0].text || '';
  }
  if (!text) throw new Error('gemini_empty_response');

  return {
    text: text,
    model: model,
    usage: data.usageMetadata || {}
  };
}

/**
 * callAI: tenta Claude (Anthropic) primeiro. Se falhar com erro elegível
 * (credit, auth, server, timeout), faz fallback automático pra Gemini.
 *
 * @param {Object} opts
 *   - system: string (system prompt)
 *   - messages: [{role:'user'|'assistant', content}]
 *   - max_tokens: number
 *   - temperature: number
 *   - response_json: boolean
 *   - prefer: 'claude' | 'gemini' (default 'claude')
 * @returns {Object} { ok, text, model_used, fallback_reason?, usage, json? }
 */
async function callAI(opts) {
  opts = opts || {};
  const prefer = opts.prefer || 'claude';

  let claudeResult = null;
  let claudeError = null;
  let geminiResult = null;
  let geminiError = null;

  // Helper to validate JSON if requested
  function parseJSONIfNeeded(text) {
    if (opts.response_json !== true) return { text, json: null };
    const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return { text: cleaned, json: parsed };
    } catch (e) {
      return { text: cleaned, json: null, parseError: 'invalid_json' };
    }
  }

  if (prefer === 'claude') {
    // Tenta Claude primeiro
    try {
      claudeResult = await callClaude(opts);
      const parsed = parseJSONIfNeeded(claudeResult.text);
      // Se exigiu JSON e Claude retornou inválido, tenta Gemini
      if (opts.response_json === true && parsed.json === null && parsed.parseError) {
        throw new Error('claude_invalid_json');
      }
      return {
        ok: true,
        text: parsed.text,
        json: parsed.json,
        model_used: claudeResult.model,
        usage: claudeResult.usage
      };
    } catch (e) {
      claudeError = e;
      console.warn('[callAI] Claude failed:', e.message, e.isCreditError ? '(credit)' : '', e.isAuthError ? '(auth)' : '');
    }
    // Fallback pra Gemini
    try {
      geminiResult = await callGemini(opts);
      const parsed = parseJSONIfNeeded(geminiResult.text);
      return {
        ok: true,
        text: parsed.text,
        json: parsed.json,
        model_used: geminiResult.model + ' (fallback)',
        fallback_reason: _classifyError(claudeError),
        usage: geminiResult.usage
      };
    } catch (e) {
      geminiError = e;
    }
  } else {
    // prefer gemini
    try {
      geminiResult = await callGemini(opts);
      const parsed = parseJSONIfNeeded(geminiResult.text);
      return { ok: true, text: parsed.text, json: parsed.json, model_used: geminiResult.model, usage: geminiResult.usage };
    } catch (e) {
      geminiError = e;
    }
    try {
      claudeResult = await callClaude(opts);
      const parsed = parseJSONIfNeeded(claudeResult.text);
      return { ok: true, text: parsed.text, json: parsed.json, model_used: claudeResult.model + ' (fallback)', usage: claudeResult.usage };
    } catch (e) {
      claudeError = e;
    }
  }

  // Ambos falharam
  return {
    ok: false,
    error: 'Both providers failed',
    claude_error: claudeError ? (claudeError.message + (claudeError.body ? ': ' + claudeError.body.substring(0, 200) : '')) : null,
    gemini_error: geminiError ? (geminiError.message + (geminiError.body ? ': ' + geminiError.body.substring(0, 200) : '')) : null
  };
}

function _classifyError(err) {
  if (!err) return 'unknown';
  if (err.isCreditError) return 'no_credit';
  if (err.isAuthError) return 'auth_error';
  if (err.isRateLimit) return 'rate_limit';
  if (err.isServerError) return 'server_error';
  if (err.message === 'timeout') return 'timeout';
  if (err.message === 'no_anthropic_key') return 'no_anthropic_key';
  if (err.message === 'claude_invalid_json') return 'invalid_json';
  return 'unknown';
}

module.exports = { callAI, callClaude, callGemini };
