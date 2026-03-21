// —— KIWIFY PROXY (Vercel Serverless Function) ————————————————————
// Rota: /api/kiwify?action=students
// Faz OAuth token + busca vendas pagas, retorna lista de alunos
// Credenciais via env vars: KIWIFY_CLIENT_ID, KIWIFY_CLIENT_SECRET, KIWIFY_ACCOUNT_ID

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

// Cache token em memoria (serverless cold start = novo token)
let cachedToken = null;
let tokenExp = 0;

async function getToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExp) return cachedToken;
  
  const body = "grant_type=client_credentials&client_id=" + clientId + "&client_secret=" + clientSecret;
  const res = await httpsReq("https://public-api.kiwify.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body,
  });
  
  if (res.status !== 200) {
    throw new Error("Kiwify OAuth failed: " + res.status + " - " + res.body);
  }
  
  const data = JSON.parse(res.body);
  cachedToken = data.access_token;
  // Token expira em 96h, renovar em 90h por seguranca
  tokenExp = Date.now() + 90 * 3600 * 1000;
  return cachedToken;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  try {
    const clientId = process.env.KIWIFY_CLIENT_ID;
    const clientSecret = process.env.KIWIFY_CLIENT_SECRET;
    const accountId = process.env.KIWIFY_ACCOUNT_ID;
    
    if (!clientId || !clientSecret || !accountId) {
      return res.status(500).json({ error: "Kiwify env vars not configured" });
    }
    
    const action = req.query.action || "students";
    
    if (action === "students") {
      const token = await getToken(clientId, clientSecret);
      
      // Buscar vendas pagas (alunos matriculados)
      let allSales = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore && page <= 10) {
        const salesRes = await httpsReq(
          "https://public-api.kiwify.com/v1/sales?status=paid&page=" + page,
          {
            headers: {
              "Authorization": "Bearer " + token,
              "X-Account-Id": accountId,
            },
          }
        );
        
        if (salesRes.status !== 200) {
          throw new Error("Kiwify sales API: " + salesRes.status);
        }
        
        const salesData = JSON.parse(salesRes.body);
        const items = salesData.data || salesData.results || [];
        
        if (items.length === 0) {
          hasMore = false;
        } else {
          allSales = allSales.concat(items);
          page++;
          // Check pagination
          if (salesData.pagination) {
            hasMore = page <= salesData.pagination.total_pages;
          } else {
            hasMore = items.length >= 20;
          }
        }
      }
      
      // Deduplica por email
      const seen = {};
      const students = [];
      allSales.forEach(function(sale) {
        const cust = sale.customer || sale.buyer || {};
        const email = cust.email || "";
        if (email && !seen[email]) {
          seen[email] = true;
          students.push({
            nome: cust.name || cust.full_name || "—",
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
        students: students,
      });
    }
    
    return res.status(400).json({ error: "Unknown action: " + action });
    
  } catch (err) {
    console.error("[Kiwify proxy]", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
