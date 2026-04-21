/* PSM OS — IA Engine v26.3 (2026-04-21)
 * v23.1 -> v26.3: timeout, HTTP error handling, retry com backoff, rate limit detect,
 *                 prompt log para debug, cache key SHA-lite, Sentry integration.
 * Score lead + Previsao venda + Alertas + Sugestao acao via Gemini 2.0 Flash.
 */
(function(){
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  var GEMINI_URL   = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  var CACHE        = {};
  var CACHE_TTL    = 300000;          // 5min
  var FETCH_TIMEOUT = 25000;          // 25s
  var RETRY_MAX    = 2;               // 2 retries (total 3 tentativas)
  var DEBUG        = false;           // window.psmIA._debug(true) pra ativar

  // ── Cache key — hash simples (evita colisao de 200 chars) ──────────────
  function hashKey(str){
    var h = 0;
    for (var i=0; i<str.length; i++){
      h = ((h<<5)-h) + str.charCodeAt(i);
      h |= 0;
    }
    return 'k'+h;
  }

  function getKey(){
    return (window.S && window.S.connectors && window.S.connectors.gemini_key)
      || localStorage.getItem('psm_gemini_key') || '';
  }

  // ── Fetch com timeout ────────────────────────────────────────────────────
  function fetchWithTimeout(url, opts, ms){
    return new Promise(function(resolve, reject){
      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      if (ctl) opts.signal = ctl.signal;
      var to = setTimeout(function(){
        if (ctl) try{ ctl.abort(); }catch(_){}
        reject(new Error('Gemini timeout ('+ms+'ms)'));
      }, ms);
      fetch(url, opts).then(function(r){
        clearTimeout(to); resolve(r);
      }).catch(function(e){
        clearTimeout(to); reject(e);
      });
    });
  }

  // ── Chamada Gemini com retry + melhor erro ─────────────────────────────
  function callGemini(prompt, attempt){
    attempt = attempt || 0;
    var key = getKey();
    if (!key) return Promise.reject(new Error('Gemini key ausente — configure em Conectores'));

    var ck = hashKey(prompt);
    var cached = CACHE[ck];
    if (cached && (Date.now() - cached.at) < CACHE_TTL){
      if (DEBUG) console.log('[PSM-IA] cache hit', ck);
      return Promise.resolve(cached.data);
    }

    if (DEBUG) console.log('[PSM-IA] call attempt='+attempt+' len='+prompt.length);

    return fetchWithTimeout(GEMINI_URL + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        contents:[{parts:[{text: prompt}]}],
        generationConfig:{temperature:0.3, maxOutputTokens:800}
      })
    }, FETCH_TIMEOUT).then(function(r){
      // Diagnostico HTTP explicito
      if (!r.ok){
        var status = r.status;
        return r.text().then(function(body){
          var err;
          if (status === 429)      err = new Error('Gemini quota/rate limit (429). Aguarde 60s.');
          else if (status === 401) err = new Error('Gemini key invalida (401). Revise em Conectores.');
          else if (status === 400) err = new Error('Gemini request invalido (400): ' + body.slice(0,200));
          else if (status >= 500)  err = new Error('Gemini server error ('+status+'). Retry automatico.');
          else                     err = new Error('Gemini HTTP '+status+': '+body.slice(0,200));
          err._status = status;
          throw err;
        });
      }
      return r.json();
    }).then(function(j){
      // Diagnostico de shape
      if (j && j.error){
        throw new Error('Gemini API error: ' + (j.error.message || JSON.stringify(j.error).slice(0,200)));
      }
      if (j && j.promptFeedback && j.promptFeedback.blockReason){
        throw new Error('Gemini bloqueou: ' + j.promptFeedback.blockReason);
      }
      var cand = (j && j.candidates && j.candidates[0]) || {};
      if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS'){
        throw new Error('Gemini finish='+cand.finishReason);
      }
      var parts = (cand.content && cand.content.parts) || [];
      var txt = (parts[0] && parts[0].text) || '';
      if (!txt){
        throw new Error('Gemini retornou vazio. Resposta: ' + JSON.stringify(j).slice(0,300));
      }
      CACHE[ck] = {at: Date.now(), data: txt};
      return txt;
    }).catch(function(e){
      // Retry em 5xx ou timeout
      var retriable = (e._status >= 500) || /timeout/i.test(e.message || '');
      if (retriable && attempt < RETRY_MAX){
        var delay = 1000 * Math.pow(2, attempt);
        if (DEBUG) console.log('[PSM-IA] retry in '+delay+'ms');
        return new Promise(function(res){ setTimeout(res, delay); })
          .then(function(){ return callGemini(prompt, attempt+1); });
      }
      if (window.Sentry) try{ window.Sentry.captureException(e, {tags:{module:'psm-ia'}}); }catch(_){}
      throw e;
    });
  }

  // ── Parser JSON robusto ────────────────────────────────────────────────
  function parseJSON(txt){
    if (!txt) return null;
    try {
      var m = txt.match(/```json\s*([\s\S]*?)\s*```/)
           || txt.match(/```\s*([\s\S]*?)\s*```/)
           || txt.match(/(\[[\s\S]*\])/)
           || txt.match(/({[\s\S]*})/);
      if (m) return JSON.parse(m[1]);
      return JSON.parse(txt);
    } catch(e){
      if (DEBUG) console.warn('[PSM-IA] parseJSON falhou. Raw:', txt.slice(0,400));
      return null;
    }
  }

  // ── Helper: executa com fallback uniforme ──────────────────────────────
  function exec(prompt, fallback, label){
    return callGemini(prompt).then(function(txt){
      var p = parseJSON(txt);
      if (!p){
        var fb = typeof fallback === 'function' ? fallback() : fallback;
        fb._raw = txt.slice(0,200);
        fb._parseError = true;
        return fb;
      }
      return p;
    }).catch(function(e){
      var fb = typeof fallback === 'function' ? fallback() : fallback;
      fb.erro = true;
      fb.mensagem = e.message;
      fb._label = label;
      return fb;
    });
  }

  // ── 1. Score lead ────────────────────────────────────────────────────────
  function scoreLead(lead){
    var prompt = 'Voce e analista de vendas imobiliarias em Sao Jose do Rio Preto/SP. '
      + 'Avalie este lead numa escala 0-100 (100 = super quente, fecha em 7 dias):\n\n'
      + JSON.stringify(lead, null, 2) + '\n\n'
      + 'Retorne APENAS JSON: {"score":N, "motivo":"frase curta", "proxima_acao":"verbo + alvo"}';
    return exec(prompt, {score:50, motivo:'IA indisponivel', proxima_acao:'Ligar'}, 'scoreLead');
  }

  // ── 2. Alerta performance ────────────────────────────────────────────────
  function alertaPerformance(corretor){
    var prompt = 'Voce analisa performance de corretores. Corretor '+corretor.nome+'.\n'
      + 'Ultimas semanas: ' + JSON.stringify(corretor.semanas) + '\n\n'
      + 'Detecte queda, estagnacao ou melhora. Retorne APENAS JSON: '
      + '{"alerta":true|false, "severidade":"low|med|high", "mensagem":"observacao", "recomendacao":"acao para gerente"}';
    return exec(prompt, {alerta:false, severidade:'low', mensagem:'IA indisponivel', recomendacao:''}, 'alertaPerformance');
  }

  // ── 3. Sugestao acoes ────────────────────────────────────────────────────
  function sugerirAcoes(contexto){
    var prompt = 'Voce e coach de vendas imobiliarias. Contexto:\n' + JSON.stringify(contexto, null, 2) + '\n\n'
      + 'Sugira 3 acoes concretas para bater meta. Retorne APENAS JSON array: '
      + '[{"acao":"verbo+alvo", "prioridade":"alta|media|baixa", "impacto_esperado":"% meta"}]';
    return callGemini(prompt).then(function(txt){
      var p = parseJSON(txt);
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.acoes)) return p.acoes;
      return [{acao:'IA nao retornou lista', prioridade:'baixa', impacto_esperado:'0%', _raw:(txt||'').slice(0,200)}];
    }).catch(function(e){
      if (window.Sentry) try{ window.Sentry.captureException(e, {tags:{module:'psm-ia', fn:'sugerirAcoes'}}); }catch(_){}
      return [{acao:'Ligar top 5 leads', prioridade:'alta', impacto_esperado:'20%', erro:true, mensagem:e.message}];
    });
  }

  // ── 4. Prever venda fim de mes ───────────────────────────────────────────
  function preverVenda(historico, atual){
    var prompt = 'Voce e analista de forecast imobiliario em Sao Jose do Rio Preto/SP. '
      + 'Historico ultimos 6 meses:\n'
      + JSON.stringify(historico) + '\n\nProgresso mes atual:\n' + JSON.stringify(atual) + '\n\n'
      + 'Retorne APENAS JSON: {"previsto":N, "confianca":"baixa|media|alta", "base":"como calculou", "risco":"o que pode mudar"}';
    return exec(prompt, function(){
      // Fallback matematico se historico nao vazio
      var fb = {previsto:0, confianca:'baixa', base:'IA indisponivel — usando projecao linear local'};
      if (Array.isArray(historico) && historico.length > 0){
        var somaVgv = historico.reduce(function(a,h){return a+(h.vgv_real||h.vgv||0);},0);
        var media = somaVgv / historico.length;
        var realAtual = (atual && atual.vgv_real) || 0;
        var du = (atual && atual.du_tot) ? atual.du_tot : 22;
        var duPass = (atual && atual.du_pass) ? atual.du_pass : 11;
        var ritmo = duPass > 0 ? realAtual / duPass : 0;
        fb.previsto = Math.round((ritmo * du + media) / 2);
      }
      return fb;
    }, 'preverVenda');
  }

  // ── Health check manual ────────────────────────────────────────────────
  function healthCheck(){
    return callGemini('Diga apenas a palavra OK.')
      .then(function(t){ return {ok:true, raw:t, hasKey:!!getKey()}; })
      .catch(function(e){ return {ok:false, error:e.message, hasKey:!!getKey()}; });
  }

  // ── Expose ───────────────────────────────────────────────────────────────
  window.psmIA = {
    scoreLead:          scoreLead,
    alertaPerformance:  alertaPerformance,
    sugerirAcoes:       sugerirAcoes,
    preverVenda:        preverVenda,
    healthCheck:        healthCheck,
    _callGemini:        callGemini,
    _cache:             CACHE,
    _clearCache:        function(){ CACHE = {}; },
    _debug:             function(on){ DEBUG = !!on; console.log('[PSM-IA] debug='+DEBUG); },
    _version:           '26.3'
  };

  console.log('[PSM-IA] v26.3 pronto — window.psmIA (scoreLead, alertaPerformance, sugerirAcoes, preverVenda, healthCheck)');
})();
