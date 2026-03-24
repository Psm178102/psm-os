// ─── WEBHOOK INSTAGRAM DM (Meta Graph API) ──────────────────────────────────
// Recebe mensagens do Instagram via Meta Webhooks e roteia para o agente PSM
// Route: GET/POST /api/webhook-instagram
// Meta docs: https://developers.facebook.com/docs/messenger-platform/instagram/

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

// Detect agent based on Instagram Page ID
function detectAgent(pageId) {
  const conquista = (process.env.IG_PAGE_ID_CONQUISTA || '').trim();
  const imoveis = (process.env.IG_PAGE_ID_IMOVEIS || '').trim();

  if (conquista && pageId === conquista) return 'sol';
  if (imoveis && pageId === imoveis) return 'vera';
  return 'vera'; // default
}

// Send message back via Instagram Messaging API
async function sendInstagramMessage(recipientId, text, pageAccessToken) {
  const url = 'https://graph.facebook.com/v21.0/me/messages';

  try {
    const resp = await httpsReq(url + '?access_token=' + pageAccessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: text },
        messaging_type: 'RESPONSE',
      }),
    });
    console.log('[IG] Sent to', recipientId, '- Status:', resp.status);
    return JSON.parse(resp.body);
  } catch (err) {
    console.error('[IG] Send error:', err.message);
  }
}

// Processed message dedup
const processedMessages = new Set();
const MAX_PROCESSED = 5000;

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // ═══════════════════════════════════════════════════════════════════════════
  // GET = Webhook Verification (Meta sends this to verify your endpoint)
  // ═══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.IG_VERIFY_TOKEN || 'psm_webhook_2026';

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[IG] Webhook verified!');
      return res.status(200).send(challenge);
    } else {
      console.error('[IG] Verification failed. Token:', token);
      return res.status(403).send('Forbidden');
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  // ═══════════════════════════════════════════════════════════════════════════
  // POST = Incoming Message
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const entries = body.entry || [];

    // Must respond 200 quickly to Meta
    res.status(200).json({ ok: true });

    // Process each entry
    for (const entry of entries) {
      const pageId = entry.id || '';
      const messaging = entry.messaging || [];

      for (const event of messaging) {
        // Skip non-message events (reads, deliveries, etc)
        if (!event.message || event.message.is_echo) continue;

        const senderId = event.sender?.id || '';
        const messageId = event.message?.mid || '';
        const text = event.message?.text || '';

        // Skip already processed
        if (messageId && processedMessages.has(messageId)) continue;
        if (messageId) {
          processedMessages.add(messageId);
          if (processedMessages.size > MAX_PROCESSED) {
            processedMessages.delete(processedMessages.values().next().value);
          }
        }

        // Skip non-text messages for now (attachments, stickers, etc)
        if (!text.trim()) continue;

        console.log('[IG] Message from', senderId, ':', text.slice(0, 100));

        // Determine agent
        const agentId = detectAgent(pageId);
        const conversationId = 'ig_' + agentId + '_' + senderId;

        // Call PSM Agent Engine
        const agentUrl = (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://housepsm.com.br') + '/api/agent';

        try {
          const agentResp = await httpsReq(agentUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agent: agentId,
              message: text,
              conversationId,
              channel: 'instagram',
              metadata: {
                leadName: '',
                igUserId: senderId,
              },
            }),
          });

          const agentData = JSON.parse(agentResp.body);
          const responseText = agentData.response || '';

          if (responseText) {
            // Get page access token
            const pageToken = pageId === (process.env.IG_PAGE_ID_CONQUISTA || '')
              ? (process.env.IG_PAGE_TOKEN_CONQUISTA || process.env.IG_PAGE_TOKEN || '')
              : (process.env.IG_PAGE_TOKEN_IMOVEIS || process.env.IG_PAGE_TOKEN || '');

            if (pageToken) {
              await sendInstagramMessage(senderId, responseText, pageToken);
              console.log('[IG] Agent', agentId, 'responded to', senderId);
            } else {
              console.error('[IG] No page token for pageId:', pageId);
            }
          }
        } catch (agentErr) {
          console.error('[IG] Agent call error:', agentErr.message);
        }
      }
    }

  } catch (err) {
    console.error('[IG] Webhook error:', err.message);
    // Already sent 200 above
  }
};
