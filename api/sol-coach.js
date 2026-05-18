// api/sol-coach.js — Vercel Serverless Function
// v75.18: Sr. Performance Diário com fallback automático Claude → Gemini.
// Recebe contexto do corretor e devolve plano de 3 ações priorizadas em JSON.

const { callAI } = require('./_ai.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){ body = {}; } }

  const nome = (body.name || 'Corretor').toString().split(' ')[0];
  const disc = body.disc || {};
  const perfil = (disc.perfil || '').toString();
  const ooDaily = Array.isArray(body.ooDaily) ? body.ooDaily : [];
  const metas = body.metas || {};
  const tarefas = Array.isArray(body.tarefasPendentes) ? body.tarefasPendentes : [];

  const tomMap = {
    'Diretor':   'Direto, objetivo, foco em resultados. Sem rodeios. Ações claras e mensuráveis.',
    'Influente': 'Motivacional, energético, foco em relacionamento. Linguagem entusiasmada.',
    'Estavel':   'Empático, organizado, foco em consistência. Tom amigável e estruturado.',
    'Conforme':  'Detalhado, técnico, foco em qualidade e processo. Cite dados específicos.',
    'Operador':  'Pragmático, foco em execução. Linguagem direta e prática.'
  };
  const tom = tomMap[perfil] || 'Profissional, equilibrado, motivacional sem excesso.';

  // Resumo dos últimos 7 dias
  const r = { lig_real:0, lig_atend:0, tent_agend:0, agend:0, vis:0, prop:0, vend:0, capt:0, pastas:0 };
  ooDaily.forEach(d => {
    if (!d) return;
    r.lig_real += (d.lig_real||0); r.lig_atend += (d.lig_atend||0); r.tent_agend += (d.tent_agend||0);
    r.agend += (d.agend||0); r.vis += (d.vis||0); r.prop += (d.prop||0); r.vend += (d.vend||0);
    r.capt += (d.capt||0); r.pastas += (d.pastas||0);
  });

  let system = 'Você é o Sr. Performance, copilot de IA pessoal dos corretores da PSM Assessoria Imobiliária (São José do Rio Preto/SP). ';
  system += 'Você analisa dados reais do corretor e gera planos de ação diários priorizados, com tom adaptado ao perfil DISC. ';
  system += 'Você é direto, prático, conhece o cotidiano do corretor (ligações, agendamentos, visitas, propostas, captações, pastas) e da operação imobiliária brasileira (MCMV, lançamentos, financiamento, FGTS). ';
  system += 'Você fala em português BR.';

  let userPrompt = 'Corretor: ' + nome + '\n';
  if (perfil) userPrompt += 'Perfil DISC: ' + perfil + ' — ' + (disc.desc || '') + '\n';
  userPrompt += 'Tom da sua resposta: ' + tom + '\n\n';
  userPrompt += 'DADOS DOS ULTIMOS 7 DIAS (Sistema PSM):\n' + JSON.stringify(r) + '\n\n';
  if (metas && Object.keys(metas).length > 0) userPrompt += 'METAS DO MES:\n' + JSON.stringify(metas) + '\n\n';
  if (tarefas.length > 0) {
    userPrompt += 'TAREFAS PENDENTES DELE:\n';
    userPrompt += JSON.stringify(tarefas.slice(0,10).map(t => ({titulo:t.titulo,prazo:t.prazo,prioridade:t.prioridade,status:t.status}))) + '\n\n';
  }
  userPrompt += 'GERE o plano de hoje para ' + nome + ' com EXATAMENTE 3 ações priorizadas.\n';
  userPrompt += 'Seja específico — cite números/contextos quando relevante.\n';
  userPrompt += 'Cada ação deve estar mais perto da meta de vendas.\n\n';
  userPrompt += 'Responda em JSON neste formato:\n';
  userPrompt += '{\n';
  userPrompt += '  "summary": "1 frase motivacional contextualizada (max 120 chars)",\n';
  userPrompt += '  "actions": [\n';
  userPrompt += '    { "prio": "alta", "icon": "📞", "title": "ação concreta (max 80 chars)", "why": "motivo em 1 frase (max 100 chars)" },\n';
  userPrompt += '    { "prio": "media", "icon": "📝", "title": "...", "why": "..." },\n';
  userPrompt += '    { "prio": "baixa", "icon": "💬", "title": "...", "why": "..." }\n';
  userPrompt += '  ]\n';
  userPrompt += '}\n';
  userPrompt += 'prio aceita: critica|alta|media|baixa';

  try {
    const result = await callAI({
      system: system,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 1024,
      temperature: 0.6,
      response_json: true,
      prefer: 'claude'
    });

    if (!result.ok || !result.json || !Array.isArray(result.json.actions) || result.json.actions.length === 0) {
      return res.status(502).json({
        ok: false,
        error: result.error || 'plano sem acoes',
        claude_error: result.claude_error,
        gemini_error: result.gemini_error,
        raw: result.text ? result.text.substring(0, 300) : undefined
      });
    }

    const plan = result.json;
    plan.actions = plan.actions.map((a, i) => ({
      id: 'a' + Date.now() + '_' + i,
      prio: a.prio || 'media',
      icon: a.icon || '✦',
      title: (a.title || '').toString().substring(0, 120),
      why: (a.why || '').toString().substring(0, 200)
    }));

    const today = new Date();
    const dateStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

    return res.status(200).json({
      ok: true,
      plan: {
        date: dateStr,
        bid: body.bid || '',
        actions: plan.actions,
        summary: (plan.summary || '').toString().substring(0, 200),
        generated_at: Date.now()
      },
      model_used: result.model_used,
      fallback_reason: result.fallback_reason,
      usage: result.usage
    });
  } catch (e) {
    return res.status(502).json({ ok:false, error: String(e.message || e) });
  }
};
