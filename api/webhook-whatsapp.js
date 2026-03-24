// ─── WEBHOOK WHATSAPP (Evolution API) ────────────────────────────────────────
// Recebe mensagens do Evolution API e roteia para o agente PSM correto
// Route: POST /api/webhook-whatsapp
// Evolution API docs: https://doc.evolution-api.com/

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

// Detect which agent should handle based on the Evolution API instance
function detectAgent(instanceName) {
  const name = (instanceName || '').toLowerCase();
  if (name.includes('conquista') || name.includes('sol')) return 'sol';
  if (name.includes('assessoria') || name.includes('imoveis') || name.includes('vera')) return 'vera';
  return 'vera'; // default
}

// Send message back via Evolution API
async function sendWhatsAppMessage(instanceName, to, text) {
  const evoUrl = process.env.EVOLUTION_API_URL || '';
  const evoKey = process.env.EVOLUTION_API_KEY || '';

  if (!evoUrl || !evoKey) {
    console.error('[WA] EVOLUTION_API_URL or EVOLUTION_API_KEY not configured');
    return;
  }

  const url = evoUrl.replace(/\/$/, '') + '/message/sendText/' + instanceName;

  try {
    const resp = await httpsReq(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evoKey,
      },
      body: JSON.stringify({
        number: to,
        text: text,
      }),
    });
    console.log('[WA] Sent to', to, '- Status:', resp.status);
    return JSON.parse(resp.body);
  } catch (err) {
    console.error('[WA] Send error:', err.message);
  }
}

// Store processed message IDs to avoid duplicates (in-memory, resets on cold start)
const processedMessages = new Set();
const MAX_PROCESSED = 5000;

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // GET = verification endpoint
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'PSM WhatsApp Webhook' });
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // Evolution API sends different event types
    const event = body.event || '';
    console.log('[WA] Event received:', event);

    // Only process incoming text messages
    if (event !== 'messages.upsert') {
      return res.status(200).json({ ok: true, skipped: event });
    }

    const data = body.data || {};
    const instanceName = body.instance || '';
    const messageData = data.message || data;
    const key = data.key || messageData.key || {};

    // Skip messages sent by us
    if (key.fromMe) {
      return res.status(200).json({ ok: true, skipped: 'fromMe' });
    }

    // Skip already processed
    const msgId = key.id || data.id || '';
    if (msgId && processedMessages.has(msgId)) {
      return res.status(200).json({ ok: true, skipped: 'duplicate' });
    }
    if (msgId) {
      processedMessages.add(msgId);
      if (processedMessages.size > MAX_PROCESSED) {
        const first = processedMessages.values().next().value;
        processedMessages.delete(first);
      }
    }

    // Extract message text
    const textMessage = messageData.message?.conversation
      || messageData.message?.extendedTextMessage?.text
      || messageData.body
      || '';

    if (!textMessage.trim()) {
      return res.status(200).json({ ok: true, skipped: 'no_text' });
    }

    // Extract sender info
    const remoteJid = key.remoteJid || data.remoteJid || '';
    const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
    const senderName = data.pushName || messageData.pushName || '';

    // Skip group messages (optional — can be enabled later)
    if (remoteJid.includes('@g.us')) {
      return res.status(200).json({ ok: true, skipped: 'group' });
    }

    console.log('[WA] Message from', senderPhone, ':', textMessage.slice(0, 100));

    // Determine agent
    const agentId = detectAgent(instanceName);
    const conversationId = 'wa_' + agentId + '_' + senderPhone;

    // Call PSM Agent Engine
    const agentUrl = (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://housepsm.com.br') + '/api/agent';

    const agentResp = await httpsReq(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: agentId,
        message: textMessage,
        conversationId,
        channel: 'whatsapp',
        metadata: {
          leadName: senderName,
          leadPhone: senderPhone,
        },
      }),
    });

    const agentData = JSON.parse(agentResp.body);
    const responseText = agentData.response || '';

    if (responseText) {
      // Send response back via WhatsApp
      await sendWhatsAppMessage(instanceName, senderPhone, responseText);

      // Log conversation for PSM OS dashboard
      console.log('[WA] Agent', agentId, 'responded to', senderPhone, '- Temp:', agentData.leadTemperature);
    }

    return res.status(200).json({
      ok: true,
      agent: agentId,
      conversationId,
      leadTemperature: agentData.leadTemperature,
    });

  } catch (err) {
    console.error('[WA] Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
