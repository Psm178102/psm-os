/* PSM OS — IA Engine v23.1
 * Score de lead quente + Previsao venda + Alertas + Sugestao acao.
 * Usa Gemini API (chave em S.connectors.gemini_key).
 * Silencioso se sem chave.
 */
(function(){
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  var CACHE = {};       // memoria de prompts ja respondidos (evita rerun)
  var CACHE_TTL = 300000; // 5min

  function getKey(){
    return (window.S && window.S.connectors && window.S.connectors.gemini_key) || localStorage.getItem('psm_gemini_key') || '';
  }

  function callGemini(prompt){
    var key = getKey();
    if (!key) return Promise.reject(new Error('Gemini key ausente'));
    var ck = prompt.slice(0, 200);
    var cached = CACHE[ck];
    if (cached && (Date.now() - cached.at) < CACHE_TTL) return Promise.resolve(cached.data);
    return fetch(GEMINI_URL + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        contents:[{parts:[{text: prompt}]}],
        generationConfig:{temperature:0.3, maxOutputTokens:800}
      })
    }).then(function(r){ return r.json(); }).then(function(j){
      var txt = (((j.candidates||[])[0]||{}).content||{}).parts;
      txt = txt && txt[0] && txt[0].text || '';
      CACHE[ck] = {at: Date.now(), data: txt};
      return txt;
    });
  }

  function parseJSON(txt){
    try {
      var m = txt.match(/```json\s*([\s\S]*?)\s*```/) || txt.match(/({[\s\S]*})/);
      if (m) return JSON.parse(m[1]);
      return JSON.parse(txt);
    } catch(e){ return null; }
  }

  // ── 1. Score lead quente ─────────────────────────────────────────────────
  // Input: lead = {nome, fonte, dias_funil, interacoes, orcamento, regiao}
  // Output: {score 0-100, motivo, proxima_acao}
  async function scoreLead(lead){
    var prompt = 'Voce e analista de vendas imobiliarias em Sao Jose do Rio Preto/SP. '
      + 'Avalie este lead numa escala 0-100 (100 = super quente, fecha em 7 dias):\n\n'
      + JSON.stringify(lead, null, 2) + '\n\n'
      + 'Retorne APENAS JSON: {"score":N, "motivo":"frase curta", "proxima_acao":"verbo + alvo"}';
    try {
      var txt = await callGemini(prompt);
      return parseJSON(txt) || {score:50, motivo:'IA falhou', proxima_acao:'Ligar'};
    } catch(e){
      return {score:50, motivo:e.message, proxima_acao:'Ligar', erro:true};
    }
  }

  // ── 2. Alerta queda performance ──────────────────────────────────────────
  // Input: corretor = {nome, semanas:[{semana, vendas, leads, conversao}]}
  // Output: {alerta:true/false, severidade, mensagem, recomendacao}
  async function alertaPerformance(corretor){
    var prompt = 'Voce analisa performance de corretores. Corretor '+corretor.nome+'.\n'
      + 'Ultimas semanas: ' + JSON.stringify(corretor.semanas) + '\n\n'
      + 'Detecte queda, estagnacao ou melhora. Retorne APENAS JSON: '
      + '{"alerta":true|false, "severidade":"low|med|high", "mensagem":"observacao", "recomendacao":"acao para gerente"}';
    try {
      var txt = await callGemini(prompt);
      return parseJSON(txt) || {alerta:false, severidade:'low', mensagem:'IA falhou', recomendacao:''};
    } catch(e){
      return {alerta:false, erro:true, mensagem:e.message};
    }
  }

  // ── 3. Sugestao proxima acao ─────────────────────────────────────────────
  // Input: contexto = {corretor, funil_atual, meta_mes, dias_restantes}
  // Output: [{acao, prioridade, impacto_esperado}]
  async function sugerirAcoes(contexto){
    var prompt = 'Voce e coach de vendas. Contexto:\n' + JSON.stringify(contexto, null, 2) + '\n\n'
      + 'Sugira 3 acoes concretas para bater meta. Retorne APENAS JSON array: '
      + '[{"acao":"verbo+alvo", "prioridade":"alta|media|baixa", "impacto_esperado":"% meta"}]';
    try {
      var txt = await callGemini(prompt);
      var p = parseJSON(txt);
      return Array.isArray(p) ? p : (p && p.acoes) || [];
    } catch(e){
      return [{acao:'Ligar top 5 leads', prioridade:'alta', impacto_esperado:'20%', erro:true}];
    }
  }

  // ── 4. Previsao venda fim de mes ─────────────────────────────────────────
  // Input: historico ultimos 6 meses + progresso mes atual
  // Output: {previsto, confianca, base, risco}
  async function preverVenda(historico, atual){
    var prompt = 'Voce e analista de forecast imobiliario. Historico ultimos 6 meses:\n'
      + JSON.stringify(historico) + '\n\nProgresso mes atual:\n' + JSON.stringify(atual) + '\n\n'
      + 'Retorne APENAS JSON: {"previsto":N, "confianca":"baixa|media|alta", "base":"como calculou", "risco":"o que pode mudar"}';
    try {
      var txt = await callGemini(prompt);
      return parseJSON(txt) || {previsto:0, confianca:'baixa', base:'IA falhou'};
    } catch(e){
      return {previsto:0, confianca:'baixa', base:e.message, erro:true};
    }
  }

  // ── Expose ───────────────────────────────────────────────────────────────
  window.psmIA = {
    scoreLead: scoreLead,
    alertaPerformance: alertaPerformance,
    sugerirAcoes: sugerirAcoes,
    preverVenda: preverVenda,
    _callGemini: callGemini,
    _cache: CACHE,
    _clearCache: function(){ CACHE = {}; }
  };

  console.log('[PSM-IA] v23.1 pronto — window.psmIA disponivel');
})();
