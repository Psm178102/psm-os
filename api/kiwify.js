// KIWIFY PROXY v4 - with required start_date/end_date params
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

    // Build date range: last 90 days (API max)
    const now = new Date();
    const end = now.toISOString().split("T")[0];
    const start = new Date(now.getTime() - 89 * 24 * 3600 * 1000).toISOString().split("T")[0];

    const allStudents = [];
    const seen = {};
    let pageNum = 1;
    let hasMore = true;
    const debug = [];

    while (hasMore && pageNum <= 10) {
      const url = "https://public-api.kiwify.com/v1/sales?status=paid&start_date=" + start + "&end_date=" + end + "&page_number=" + pageNum + "&page_size=50";
      console.log("[Kiwify] GET", url);
      const r = await fetch(url, {
        headers: {
          "Authorization": "Bearer " + token,
          "x-kiwify-account-id": accountId,
          "Accept": "application/json",
        },
      });
      const txt = await r.text();
      console.log("[Kiwify] page", pageNum, "=>", r.status, txt.substring(0, 200));
      debug.push({ page: pageNum, status: r.status, preview: txt.substring(0, 100) });

      if (r.status !== 200) {
        debug.push({ error: "non-200", body: txt.substring(0, 300) });
        break;
      }

      let json;
      try { json = JSON.parse(txt); } catch(e) { debug.push({ parseErr: e.message }); break; }

      const items = json.data || [];
      items.forEach(function(s) {
        const c = s.customer || s.buyer || {};
        const email = c.email || "";
        if (email && !seen[email]) {
          seen[email] = true;
          allStudents.push({ nome: c.name || c.full_name || "?", email: email, status: s.status || "paid", data: s.created_at || "" });
        }
      });

      const pag = json.pagination || {};
      const totalPages = Math.ceil((pag.count || 0) / (pag.page_size || 50));
      if (pageNum >= totalPages || items.length === 0) {
        hasMore = false;
      }
      pageNum++;
    }

    return res.status(200).json({ ok: true, total: allStudents.length, students: allStudents, dateRange: { start: start, end: end }, debug: debug });
  } catch (err) {
    console.error("[Kiwify]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
