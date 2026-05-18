// api/sol-coach.js — Vercel Serverless Function
// v75.16: Sr. Performance Diário (renomeado de "Sol Coach") — copilot IA pessoal por corretor.
// MIGRADO de Gemini para Claude Haiku 4.5 (qualidade superior, mesmo schema de input/output).
//
// Input (POST): { bid, name, role, disc, ooDaily, metas, tarefasPendentes, rdAtividades?, leadsParados? }
// Output: { ok, plan: { date, bid, actions:[{id,prio,icon,title,why}], summary, generated_at }, model }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error: 'Method not allowed' });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ ok:false, error: 'ANTHROPIC_API_KEY nao configurado no Vercel' });

  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){ body = {}; } }

  var nome = (body.name || 'Corretor').toString().split(' ')[0];
  var disc = body.disc || {};
  var perfil = (disc.perfil || '').toString();
  var ooDaily = Array.isArray(body.ooDaily) ? body.ooDaily : [];
  var metas = body.metas || {};
  var tarefas = Array.isArray(body.tarefasPendentes) ? body.tarefasPendentes : [];

  var tomMap = {
    'Diretor':   'Direto, objetivo, foco em resultados. Sem rodeios. Ações claras e mensuráveis.',
    'Influente': 'Motivacional, energético, foco em relacionamento. Linguagem entusiasmada.',
    'Estavel':   'Empático, organizado, foco em consistência. Tom amigável e estruturado.',
    'Conforme':  'Detalhado, técnico, foco em qualidade e processo. Cite dados específicos.',
    'Operador':  'Pragmático, foco em execução. Linguagem direta e prática.'
  };
  var tom = tomMap[perfil] || 'Profissional, equilibrado, motivacional sem excesso.';

  // Resumo dos últimos 7 dias
  var r = { lig_real:0, lig_atend:0, tent_agend:0, agend:0, vis:0, prop:0, vend:0, capt:0, pastas:0 };
  ooDaily.forEach(function(d){
    if (!d) return;
    r.lig_real += (d.lig_real||0); r.lig_atend += (d.lig_atend||0); r.tent_agend += (d.tent_agend||0);
    r.agend += (d.agend||0); r.vis += (d.vis||0); r.prop += (d.prop||0); r.vend += (d.vend||0);
    r.capt += (d.capt||0); r.pastas += (d.pastas||0);
  });

  var system = 'Você é o Sr. Performance, copilot de IA pessoal dos corretores da PSM Assessoria Imobiliária (São José do Rio Preto/SP). ';
  system += 'Você analisa dados reais do corretor e gera planos de ação diários priorizados, com tom adaptado ao perfil DISC. ';
  system += 'Você é direto, prático, conhece o cotidiano do corretor (ligações, agendamentos, visitas, propostas, captações, pastas) e da operação imobiliária brasileira (MCMV, lançamentos, financiamento, FGTS). ';
  system += 'Você fala em português BR.';

  var userPrompt = 'Corretor: ' + nome + '\n';
  if (perfil) userPrompt += 'Perfil DISC: ' + perfil + ' — ' + (disc.desc || '') + '\n';
  userPrompt += 'Tom da sua resposta: ' + tom + '\n\n';
  userPrompt += 'DADOS DOS ULTIMOS 7 DIAS (Sistema PSM):\n' + JSON.stringify(r) + '\n\n';
  if (metas && Object.keys(metas).length > 0) userPrompt += 'METAS DO MES:\n' + JSON.stringify(metas) + '\n\n';
  if (tarefas.length > 0) {
    userPrompt += 'TAREFAS PENDENTES DELE:\n';
    userPrompt += JSON.stringify(tarefas.slice(0,10).map(function(t){
      return { titulo:t.titulo, prazo:t.prazo, prioridade:t.prioridade, status:t.status };
    })) + '\n\n';
  }
  userPrompt += 'GERE o plano de hoje para ' + nome + ' com EXATAMENTE 3 ações priorizadas.\n';
  userPrompt += 'Seja específico — cite números/contextos quando relevante.\n';
  userPrompt += 'Cada ação deve estar mais perto da meta de vendas.\n\n';
  userPrompt += 'Responda APENAS JSON válido neste formato:\n';
  userPrompt += '{\n';
  userPrompt += '  "summary": "1 frase motivacional contextualizada (max 120 chars)",\n';
  userPrompt += '  "actions": [\n';
  userPrompt += '    { "prio": "alta", "icon": "📞", "title": "ação concreta (max 80 chars)", "why": "motivo em 1 frase (max 100 chars)" },\n';
  userPrompt += '    { "prio": "media", "icon": "📝", "title": "...", "why": "..." },\n';
  userPrompt += '    { "prio": "baixa", "icon": "💬", "title": "...", "why": "..." }\n';
  userPrompt += '  ]\n';
  userPrompt += '}\n';
  userPrompt += 'prio aceita: critica|alta|media|baixa\nNenhum texto fora do JSON.';

  var model = 'claude-haiku-4-5';

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function(){ controller.abort(); }, 30000);
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        temperature: 0.6,
        system: system,
        messages: [{ role: 'user', content: userPrompt }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(resp.status).json({ ok:false, error: 'Claude HTTP '+resp.status+': '+errText.substring(0,400) });
    }
    var data = await resp.json();
    var text = '';
    if (Array.isArray(data.content)) data.content.forEach(function(c){ if (c && c.type === 'text') text += (c.text || ''); });
    if (!text) return res.status(502).json({ ok:false, error:'Claude retornou resposta vazia' });

    text = text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    var plan;
    try { plan = JSON.parse(text); }
    catch(e){ return res.status(502).json({ ok:false, error: 'Claude retornou JSON invalido: '+text.substring(0,300), raw: text }); }

    if (!plan || !Array.isArray(plan.actions) || plan.actions.length === 0) {
      return res.status(502).json({ ok:false, error: 'Plano sem acoes' });
    }

    plan.actions = plan.actions.map(function(a, i){
      return {
        id: 'a' + Date.now() + '_' + i,
        prio: a.prio || 'media',
        icon: a.icon || '✦',
        title: (a.title || '').toString().substring(0, 120),
        why: (a.why || '').toString().substring(0, 200)
      };
    });

    var today = new Date();
    var dateStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

    return res.status(200).json({
      ok: true,
      plan: {
        date: dateStr,
        bid: body.bid || '',
        actions: plan.actions,
        summary: (plan.summary || '').toString().substring(0, 200),
        generated_at: Date.now()
      },
      model: model,
      usage: data.usage || {}
    });
  } catch(e) {
    var msg = (e && e.name === 'AbortError') ? 'Claude timeout (30s)' : String(e && e.message || e);
    return res.status(502).json({ ok:false, error: msg });
  }
};
