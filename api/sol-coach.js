// api/sol-coach.js — Vercel Serverless Function
// v75.15: Sol Coach Diário — copilot IA personalizado por corretor.
//
// Recebe contexto do corretor (DISC + dados dos últimos 7 dias) e devolve
// um plano de 3 ações prioritárias para HOJE, com tom adaptado ao perfil.
//
// Input (POST):
//   {
//     bid, name, role, disc: {perfil, desc},
//     metas: {...}, ooDaily: [...últimos 7 dias],
//     rdAtividades: [...] (opcional, do RD CRM),
//     tarefasPendentes: [...] (do dirTarefas filtrado por responsavel),
//     leadsParados: [...] (opcional)
//   }
// Output:
//   { ok: true, plan: { date, actions: [{prio,icon,title,why}], summary }, model: 'gemini-...' }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error: 'Method not allowed' });

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok:false, error: 'GEMINI_API_KEY nao configurado' });

  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){ body = {}; } }

  var nome = (body.name || 'Corretor').toString().split(' ')[0];
  var disc = body.disc || {};
  var perfil = (disc.perfil || '').toString();
  var ooDaily = Array.isArray(body.ooDaily) ? body.ooDaily : [];
  var metas = body.metas || {};
  var tarefas = Array.isArray(body.tarefasPendentes) ? body.tarefasPendentes : [];
  var rdAtividades = Array.isArray(body.rdAtividades) ? body.rdAtividades : [];
  var leadsParados = Array.isArray(body.leadsParados) ? body.leadsParados : [];

  // Tom adaptado ao DISC (D-I-S-C / Diretor-Influente-Estavel-Conforme)
  var tomMap = {
    'Diretor':   'Direto, objetivo, foco em resultados. Sem rodeios. Ações claras e mensuraveis.',
    'Influente': 'Motivacional, energético, foco em relacionamento. Use linguagem entusiasmada.',
    'Estavel':   'Empático, organizado, foco em consistência. Tom amigável e estruturado.',
    'Conforme':  'Detalhado, técnico, foco em qualidade e processo. Cite dados específicos.',
    'Operador':  'Pragmático, foco em execução. Linguagem direta e prática.'
  };
  var tom = tomMap[perfil] || 'Profissional, equilibrado, motivacional sem excesso.';

  // Resumo dos últimos 7 dias (compactar pra economizar tokens)
  var resumo7d = {
    ligacoes_realizadas: 0,
    ligacoes_atendidas: 0,
    tentativas_agendar: 0,
    agendamentos: 0,
    visitas: 0,
    propostas: 0,
    vendas: 0,
    captacoes: 0,
    pastas_abertas: 0
  };
  ooDaily.forEach(function(d){
    if (!d) return;
    resumo7d.ligacoes_realizadas += (d.lig_real || 0);
    resumo7d.ligacoes_atendidas += (d.lig_atend || 0);
    resumo7d.tentativas_agendar += (d.tent_agend || 0);
    resumo7d.agendamentos += (d.agend || 0);
    resumo7d.visitas += (d.vis || 0);
    resumo7d.propostas += (d.prop || 0);
    resumo7d.vendas += (d.vend || 0);
    resumo7d.captacoes += (d.capt || 0);
    resumo7d.pastas_abertas += (d.pastas || 0);
  });

  var prompt = 'Voce e o Sol, copilot de IA pessoal do corretor ' + nome + ' da imobiliaria PSM (Sao Jose do Rio Preto/SP).\n\n';
  prompt += 'CONTEXTO DO CORRETOR:\n';
  prompt += '- Nome: ' + nome + '\n';
  if (perfil) prompt += '- Perfil DISC: ' + perfil + ' (' + (disc.desc || '') + ')\n';
  prompt += '- Tom da sua resposta: ' + tom + '\n\n';

  prompt += 'DADOS DOS ULTIMOS 7 DIAS (Sistema PSM):\n';
  prompt += JSON.stringify(resumo7d) + '\n\n';

  if (metas && Object.keys(metas).length > 0) {
    prompt += 'METAS DO MES:\n' + JSON.stringify(metas) + '\n\n';
  }

  if (rdAtividades.length > 0) {
    prompt += 'ATIVIDADES RD CRM (ultimos 7 dias, top ' + Math.min(rdAtividades.length, 15) + '):\n';
    prompt += JSON.stringify(rdAtividades.slice(0,15)) + '\n\n';
  }

  if (leadsParados.length > 0) {
    prompt += 'LEADS PARADOS (sem contato > 3 dias):\n';
    prompt += JSON.stringify(leadsParados.slice(0,10)) + '\n\n';
  }

  if (tarefas.length > 0) {
    prompt += 'TAREFAS PENDENTES ATRIBUIDAS A ' + nome.toUpperCase() + ':\n';
    prompt += JSON.stringify(tarefas.slice(0,10).map(function(t){
      return {titulo:t.titulo,prazo:t.prazo,prioridade:t.prioridade,status:t.status};
    })) + '\n\n';
  }

  prompt += 'TAREFA:\n';
  prompt += 'Analise o contexto e devolva o PLANO DE HOJE com 3 acoes prioritarias (max).\n';
  prompt += 'Seja especifico — cite nomes/numeros do contexto quando relevante.\n';
  prompt += 'Cada acao deve ter ROI claro (mais perto da venda, mais perto da meta).\n\n';
  prompt += 'RESPONDA APENAS EM JSON VALIDO (sem markdown, sem ```json), neste formato exato:\n';
  prompt += '{\n';
  prompt += '  "summary": "1 frase motivacional contextualizada (max 120 chars)",\n';
  prompt += '  "actions": [\n';
  prompt += '    { "prio": "alta", "icon": "📞", "title": "acao concreta (max 80 chars)", "why": "motivo em 1 frase (max 100 chars)" },\n';
  prompt += '    { "prio": "media", "icon": "📝", "title": "...", "why": "..." },\n';
  prompt += '    { "prio": "baixa", "icon": "💬", "title": "...", "why": "..." }\n';
  prompt += '  ]\n';
  prompt += '}\n';
  prompt += 'prio aceita: critica|alta|media|baixa\n';
  prompt += 'icon: emoji unico relevante a acao\n';
  prompt += 'Responda em portugues BR. Nenhum texto fora do JSON.';

  var model = 'gemini-2.5-flash';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function(){ controller.abort(); }, 30000);
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(resp.status).json({ ok:false, error: 'Gemini HTTP ' + resp.status + ': ' + errText.substring(0,400) });
    }
    var data = await resp.json();
    var text = '';
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
      text = (data.candidates[0].content.parts[0].text || '').trim();
    }
    if (!text) return res.status(502).json({ ok:false, error: 'Gemini retornou resposta vazia' });

    // Tira ```json ... ``` se vier
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    var plan;
    try { plan = JSON.parse(text); }
    catch(e){
      return res.status(502).json({ ok:false, error: 'Gemini retornou JSON invalido: ' + text.substring(0,300), raw: text });
    }

    // Sanity: precisa ter actions
    if (!plan || !Array.isArray(plan.actions) || plan.actions.length === 0) {
      return res.status(502).json({ ok:false, error: 'Plano sem acoes' });
    }

    // Adicionar IDs únicos para cada action (para tracking de completion)
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
      model: model
    });
  } catch(e) {
    var msg = (e && e.name === 'AbortError') ? 'Gemini timeout (30s)' : String(e && e.message || e);
    return res.status(502).json({ ok:false, error: msg });
  }
};
