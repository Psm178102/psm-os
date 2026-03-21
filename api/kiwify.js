// KIWIFY PROXY v3 - using native fetch()
let cachedToken = null;
let tokenExp = 0;

async function getToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExp) return cachedToken;
  const body = "client_id=" + clientId + "&client_secret=" + clientSecret;
  console.log("[Kiwify] Getting OAuth token...");
  const res = await fetch("https://public-api.kiwify.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body,
  });
  console.log("[Kiwify] Token status:", res.status);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("OAuth failed: " + res.status);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExp = Date.now() + 80 * 3600 * 1000;
  console.log("[Kiwify] Token ok, len:", cachedToken.length);
  return cachedToken;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const clientId = process.env.KIWIFY_CLIENT_ID;
    const clientSecret = process.env.KIWIFY_CLIENT_SECRET;
    const accountId = process.env.KIWIFY_ACCOUNT_ID;
    if (!clientId || !clientSecret || !accountId) {
      return res.status(500).json({ error: "env vars missing" });
    }

    const token = await getToken(clientId, clientSecret);
    const endpoints = ["/v1/sales?status=paid&page=1", "/v1/sales?page=1", "/v1/sales"];
    let salesData = null;
    let usedEp = "";
    let debug = [];

    for (const ep of endpoints) {
      const url = "https://public-api.kiwify.com" + ep;
      console.log("[Kiwify] GET", url);
      const r = await fetch(url, {
        headers: {
          "Authorization": "Bearer " + token,
          "x-kiwify-account-id": accountId,
          "Accept": "application/json",
        },
      });
      const txt = await r.text();
      console.log("[Kiwify]", ep, "=>", r.status, txt.substring(0, 200));
      debug.push({ ep, status: r.status, body: txt.substring(0, 100) });
      if (r.status === 200) {
        try { salesData = JSON.parse(txt); usedEp = ep; break; }
        catch(e) { debug.push({ parseErr: e.message }); }
      }
    }

    if (!salesData) {
      return res.status(200).json({ ok: false, error: "All endpoints failed", debug });
    }

    const seen = {};
    const students = [];
    (salesData.data || []).forEach(function(s) {
      const c = s.customer || s.buyer || {};
      const email = c.email || "";
      if (email && !seen[email]) {
        seen[email] = true;
        students.push({ nome: c.name || c.full_name || "?", email, status: s.status || "paid", data: s.created_at || "" });
      }
    });

    return res.status(200).json({ ok: true, endpoint: usedEp, total: students.length, students });
  } catch (err) {
    console.error("[Kiwify]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
