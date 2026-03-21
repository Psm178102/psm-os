// KIWIFY PROXY (Vercel Serverless) - v2 with debug logging
const https = require("https");

function httpsReq(url, opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: opts.method || "GET",
      headers: opts.headers || {},
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

let cachedToken = null;
let tokenExp = 0;

async function getToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExp) return cachedToken;
  const body = "grant_type=client_credentials&client_id=" + clientId + "&client_secret=" + clientSecret;
  console.log("[Kiwify] Getting OAuth token...");
  const res = await httpsReq("https://public-api.kiwify.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body,
  });
  console.log("[Kiwify] Token response status:", res.status);
  if (res.status !== 200) {
    console.log("[Kiwify] Token error body:", res.body.substring(0, 500));
    throw new Error("Kiwify OAuth failed: " + res.status);
  }
  const data = JSON.parse(res.body);
  cachedToken = data.access_token;
  tokenExp = Date.now() + 90 * 3600 * 1000;
  console.log("[Kiwify] Token obtained, length:", cachedToken.length);
  return cachedToken;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const clientId = process.env.KIWIFY_CLIENT_ID;
    const clientSecret = process.env.KIWIFY_CLIENT_SECRET;
    const accountId = process.env.KIWIFY_ACCOUNT_ID;

    if (!clientId || !clientSecret || !accountId) {
      console.log("[Kiwify] Missing env vars:", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasAccountId: !!accountId
      });
      return res.status(500).json({ error: "Kiwify env vars not configured" });
    }

    const token = await getToken(clientId, clientSecret);

    // Try multiple endpoints
    const endpoints = [
      "/v1/sales?status=paid&page=1",
      "/v1/orders?status=paid&page=1",
      "/v1/subscriptions?page=1"
    ];

    let salesRes = null;
    let usedEndpoint = "";

    for (const ep of endpoints) {
      console.log("[Kiwify] Trying endpoint:", ep);
      const r = await httpsReq("https://public-api.kiwify.com" + ep, {
        headers: {
          "Authorization": "Bearer " + token,
          "X-Account-Id": accountId,
          "Accept": "application/json",
        },
      });
      console.log("[Kiwify] " + ep + " => status:", r.status, "body preview:", r.body.substring(0, 300));
      if (r.status === 200) {
        salesRes = r;
        usedEndpoint = ep;
        break;
      }
    }

    if (!salesRes) {
      return res.status(200).json({
        ok: false,
        error: "All Kiwify endpoints returned non-200",
        debug: "Token works but sales/orders/subscriptions all failed with auth error"
      });
    }

    // Parse and deduplicate
    const salesData = JSON.parse(salesRes.body);
    const items = salesData.data || salesData.results || salesData.orders || [];
    console.log("[Kiwify] Got " + items.length + " items from " + usedEndpoint);

    const seen = {};
    const students = [];
    items.forEach(function(sale) {
      const cust = sale.customer || sale.buyer || {};
      const email = cust.email || "";
      if (email && !seen[email]) {
        seen[email] = true;
        students.push({
          nome: cust.name || cust.full_name || "\u2014",
          email: email,
          produto: (sale.product || {}).name || "Comunidade PSM",
          data: sale.created_at || sale.approved_date || "",
          status: sale.status || "paid",
        });
      }
    });

    return res.status(200).json({
      ok: true,
      total: students.length,
      endpoint: usedEndpoint,
      students: students,
    });

  } catch (err) {
    console.error("[Kiwify proxy]", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
