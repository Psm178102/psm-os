// KIWIFY PROXY v6 - supports action=students, action=products, action=debug
let cachedToken = null;
let tokenExp = 0;

async function getToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExp) return cachedToken;
  const body = "client_id=" + clientId + "&client_secret=" + clientSecret;
  const res = await fetch("https://public-api.kiwify.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body,
  });
  if (!res.ok) throw new Error("OAuth failed: " + res.status);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExp = Date.now() + 80 * 3600 * 1000;
  return cachedToken;
}

function fmt(d) { return d.toISOString().split("T")[0]; }

async function kiwifyGet(url, token, accountId) {
  const r = await fetch(url, {
    headers: {
      "Authorization": "Bearer " + token,
      "x-kiwify-account-id": accountId,
      "Accept": "application/json",
    },
  });
  const txt = await r.text();
  return { status: r.status, text: txt };
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
    const action = (req.query.action || "students").toLowerCase();

    // ACTION: products
    if (action === "products") {
      const r = await kiwifyGet("https://public-api.kiwify.com/v1/products?page_size=50&page_number=1", token, accountId);
      if (r.status !== 200) return res.status(200).json({ ok: false, status: r.status, body: r.text.substring(0, 500) });
      const json = JSON.parse(r.text);
      return res.status(200).json({ ok: true, products: json.data || [], pagination: json.pagination });
    }

    // ACTION: debug - test multiple endpoints
    if (action === "debug") {
      const endpoints = ["/v1/products?page_size=10&page_number=1", "/v1/sales?start_date=2025-01-01&end_date=2026-03-21&page_number=1&page_size=10", "/v1/account"];
      const results = [];
      for (const ep of endpoints) {
        const r = await kiwifyGet("https://public-api.kiwify.com" + ep, token, accountId);
        results.push({ endpoint: ep, status: r.status, preview: r.text.substring(0, 300) });
      }
      return res.status(200).json({ ok: true, tokenLen: token.length, results: results });
    }

    // ACTION: students (default) - scan 90-day windows
    const allStudents = [];
    const seen = {};
    const debug = [];
    const now = new Date();
    const DAY = 24 * 3600 * 1000;

    for (let w = 0; w < 9; w++) {
      const endDate = new Date(now.getTime() - w * 89 * DAY);
      const startDate = new Date(endDate.getTime() - 89 * DAY);
      const sd = fmt(startDate);
      const ed = fmt(endDate);
      let pageNum = 1;
      let hasMore = true;

      while (hasMore && pageNum <= 20) {
        const r = await kiwifyGet("https://public-api.kiwify.com/v1/sales?start_date=" + sd + "&end_date=" + ed + "&page_number=" + pageNum + "&page_size=100", token, accountId);
        if (r.status !== 200) { debug.push({ w, sd, ed, page: pageNum, status: r.status }); break; }
        const json = JSON.parse(r.text);
        const items = json.data || [];
        items.forEach(function(s) {
          const c = s.customer || s.buyer || {};
          const email = c.email || "";
          if (email && !seen[email]) {
            seen[email] = true;
            allStudents.push({ nome: c.name || c.full_name || "?", email: email, status: s.status || "?", data: s.created_at || "" });
          }
        });
        debug.push({ w, sd, ed, page: pageNum, count: items.length });
        const pag = json.pagination || {};
        if (pageNum >= Math.ceil((pag.count || 0) / (pag.page_size || 100)) || items.length === 0) hasMore = false;
        pageNum++;
      }
      if (allStudents.length > 0 && w >= 2) break;
    }

    return res.status(200).json({ ok: true, total: allStudents.length, students: allStudents, debug: debug });
  } catch (err) {
    console.error("[Kiwify]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
