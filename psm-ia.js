/* PSM OS — IA Engine v26.4 (2026-04-21)
 * Multi-provider: Claude / Gemini / GPT com fallback automatico.
 * 4 Personas:
 *   - Vera         : atendente PSM IMOVEIS (alto padrao / investidores)
 *   - Sol          : atendente PSM CONQUISTA (residencial C/B / MCMV)
 *   - Sr Performance : analitico socios (BI tempo real)
 *   - Sr Gerencia   : gestor time vendas (cobra corretores)
 *
 * Handles tecnicos: scoreLead, alertaPerformance, sugerirAcoes, preverVenda.
 */
(function(){
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════════════
  var FETCH_TIMEOUT = 25000;
  var RETRY_MAX     = 2;
  var CACHE_TTL     = 300000;
  var CACHE         = {};
  var DEBUG         = false;

  // Ordem default de provider (override via S.iaProvider ou localStorage.psm_ia_provider)
  var DEFAULT_ORDER = ['claude','gemini','gpt'];

  // Ordem especializada por persona (Claude lidera conversa, Gemini lidera analise de dados)
  var PERSONA_ORDER = {
    vera:           ['claude','gpt','gemini'],     // cliente alto padrao — tom/nuance
    sol:            ['claude','gpt','gemini'],     // cliente MCMV — empatia
    sr_gerencia:    ['claude','gpt','gemini'],     // cobra corretor — firmeza humana
    sr_performance: ['gemini','claude','gpt']      // analise dados — Gemini e rapido e barato
  };

  var PROVIDERS = {
    claude: {
      url: 'https://api.anthropic.com/v1/messages',
      model: 'claude-sonnet-4-6',
      keyPath: 'claude_key',
      keyPathLegacy: 'claude_api_key',
      keyLS:   'psm_claude_key',
      build: function(prompt, system, key){
        return {
          url: this.url,
          headers: {
            'Content-Type':'application/json',
            'x-api-key': key,
            'anthropic-version':'2023-06-01',
            'anthropic-dangerous-direct-browser-access':'true'
          },
          body: {
            model: this.model,
            max_tokens: 1024,
            system: system || undefined,
            messages: [{role:'user', content: prompt}]
          }
        };
      },
      extract: function(j){
        if (j && j.error) throw new Error('Claude API error: '+(j.error.message||JSON.stringify(j.error).slice(0,200)));
        var c = (j.content||[])[0];
        return (c && c.text) || '';
      }
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      keyPath: 'gemini_key',
      keyPathLegacy: 'gemini_api_key',
      keyLS:   'psm_gemini_key',
      build: function(prompt, system, key){
        var fullPrompt = system ? (system + '\n\n' + prompt) : prompt;
        return {
          url: this.url + '?key=' + encodeURIComponent(key),
          headers: {'Content-Type':'application/json'},
          body: {
            contents:[{parts:[{text: fullPrompt}]}],
            generationConfig:{temperature:0.3, maxOutputTokens:1024}
          }
        };
      },
      extract: function(j){
        if (j && j.error) throw new Error('Gemini API error: '+(j.error.message||JSON.stringify(j.error).slice(0,200)));
        if (j && j.promptFeedback && j.promptFeedback.blockReason) throw new Error('Gemini bloqueou: '+j.promptFeedback.blockReason);
        var cand = (j.candidates||[])[0] || {};
        var parts = (cand.content && cand.content.parts) || [];
        return (parts[0] && parts[0].text) || '';
      }
    },
    gpt: {
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      keyPath: 'openai_key',
      keyPathLegacy: 'openai_api_key',
      keyLS:   'psm_openai_key',
      build: function(prompt, system, key){
        var msgs = [];
        if (system) msgs.push({role:'system', content: system});
        msgs.push({role:'user', content: prompt});
        return {
          url: this.url,
          headers: {
            'Content-Type':'application/json',
            'Authorization':'Bearer ' + key
          },
          body: {model: this.model, messages: msgs, temperature: 0.3, max_tokens: 1024}
        };
      },
      extract: function(j){
        if (j && j.error) throw new Error('OpenAI API error: '+(j.error.message||JSON.stringify(j.error).slice(0,200)));
        var c = ((j.choices||[])[0]||{}).message;
        return (c && c.content) || '';
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════
  function hashKey(str){
    var h = 0;
    for (var i=0; i<str.length; i++){ h = ((h<<5)-h) + str.charCodeAt(i); h |= 0; }
    return 'k'+h;
  }

  function getKey(provName){
    var p = PROVIDERS[provName];
    if (!p) return '';
    var c = (window.S && window.S.connectors) || {};
    return (c[p.keyPath] || (p.keyPathLegacy && c[p.keyPathLegacy]) || localStorage.getItem(p.keyLS) || '').trim();
  }

  // Salva key em 3 lugares: S.connectors (sync Firebase), localStorage (offline), retorna persistido
  function setKey(provName, key){
    var p = PROVIDERS[provName];
    if (!p) throw new Error('Provider invalido: '+provName);
    key = (key||'').trim();
    if (!window.S) window.S = {};
    if (!window.S.connectors) window.S.connectors = {};
    window.S.connectors[p.keyPath] = key;
    if (key) localStorage.setItem(p.keyLS, key);
    else { localStorage.removeItem(p.keyLS); delete window.S.connectors[p.keyPath]; }
    // Sync Firebase via saveState (se disponivel)
    try { if (typeof window.saveState === 'function') window.saveState(); } catch(_){}
    console.log('[PSM-IA] key '+provName+' salva (Firebase + localStorage)');
    return !!key;
  }

  // Boot: copia keys do localStorage pra S.connectors se S vazio (1a vez no device)
  function bootKeys(){
    if (!window.S) window.S = {};
    if (!window.S.connectors) window.S.connectors = {};
    Object.keys(PROVIDERS).forEach(function(name){
      var p = PROVIDERS[name];
      var ls = localStorage.getItem(p.keyLS);
      if (ls && !window.S.connectors[p.keyPath] && !(p.keyPathLegacy && window.S.connectors[p.keyPathLegacy])){
        window.S.connectors[p.keyPath] = ls.trim();
      }
    });
  }

  function getProviderOrder(personaId){
    var forced = (window.S && window.S.iaProvider) || localStorage.getItem('psm_ia_provider');
    if (forced && PROVIDERS[forced]) return [forced].concat(DEFAULT_ORDER.filter(function(p){return p!==forced;}));
    if (personaId && PERSONA_ORDER[personaId]) return PERSONA_ORDER[personaId].slice();
    return DEFAULT_ORDER.slice();
  }

  function fetchWithTimeout(url, opts, ms){
    return new Promise(function(resolve, reject){
      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      if (ctl) opts.signal = ctl.signal;
      var to = setTimeout(function(){
        if (ctl) try{ ctl.abort(); }catch(_){}
        reject(new Error('timeout ('+ms+'ms)'));
      }, ms);
      fetch(url, opts).then(function(r){ clearTimeout(to); resolve(r); })
                     .catch(function(e){ clearTimeout(to); reject(e); });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CORE: call com provider + retry + fallback automatico
  // ═══════════════════════════════════════════════════════════════════════
  function callProvider(provName, prompt, system, attempt){
    attempt = attempt || 0;
    var prov = PROVIDERS[provName];
    if (!prov) return Promise.reject(new Error('Provider desconhecido: '+provName));
    var key = getKey(provName);
    if (!key) return Promise.reject(new Error(provName+' key ausente'));

    var ck = provName+':'+hashKey((system||'')+'|'+prompt);
    var cached = CACHE[ck];
    if (cached && (Date.now() - cached.at) < CACHE_TTL){
      if (DEBUG) console.log('[PSM-IA] cache hit', ck);
      return Promise.resolve({text: cached.data, provider: provName, cached:true});
    }

    var cfg = prov.build(prompt, system, key);
    if (DEBUG) console.log('[PSM-IA] '+provName+' attempt='+attempt+' prompt len='+prompt.length);

    return fetchWithTimeout(cfg.url, {
      method: 'POST',
      headers: cfg.headers,
      body: JSON.stringify(cfg.body)
    }, FETCH_TIMEOUT).then(function(r){
      if (!r.ok){
        var status = r.status;
        return r.text().then(function(body){
          var err;
          if (status === 429)      err = new Error(provName+' quota/rate (429)');
          else if (status === 401) err = new Error(provName+' key invalida (401)');
          else if (status === 400) err = new Error(provName+' request invalido (400): '+body.slice(0,160));
          else if (status >= 500)  err = new Error(provName+' server error ('+status+')');
          else                     err = new Error(provName+' HTTP '+status+': '+body.slice(0,160));
          err._status = status;
          throw err;
        });
      }
      return r.json();
    }).then(function(j){
      var txt = prov.extract(j);
      if (!txt) throw new Error(provName+' retorno vazio');
      CACHE[ck] = {at: Date.now(), data: txt};
      return {text: txt, provider: provName, cached:false};
    }).catch(function(e){
      var retriable = (e._status >= 500) || /timeout/i.test(e.message||'');
      if (retriable && attempt < RETRY_MAX){
        var delay = 1000 * Math.pow(2, attempt);
        return new Promise(function(res){ setTimeout(res, delay); })
          .then(function(){ return callProvider(provName, prompt, system, attempt+1); });
      }
      throw e;
    });
  }

  // Chamada principal com fallback automatico entre providers
  function callAI(prompt, system, personaId){
    var order = getProviderOrder(personaId);
    var i = 0;
    var errors = [];
    function tryNext(){
      if (i >= order.length){
        var err = new Error('Todos providers falharam: '+errors.map(function(e){return e.p+'='+e.m;}).join(' | '));
        err.errors = errors;
        if (window.Sentry) try{ window.Sentry.captureException(err, {tags:{module:'psm-ia'}}); }catch(_){}
        throw err;
      }
      var p = order[i++];
      return callProvider(p, prompt, system).catch(function(e){
        errors.push({p:p, m:e.message});
        if (DEBUG) console.warn('[PSM-IA] '+p+' falhou:', e.message);
        return tryNext();
      });
    }
    return Promise.resolve().then(tryNext);
  }

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

  function exec(prompt, fallback, label, system){
    return callAI(prompt, system).then(function(res){
      var p = parseJSON(res.text);
      if (!p){
        var fb = typeof fallback === 'function' ? fallback() : fallback;
        fb._raw = res.text.slice(0,200);
        fb._provider = res.provider;
        fb._parseError = true;
        return fb;
      }
      p._provider = res.provider;
      return p;
    }).catch(function(e){
      var fb = typeof fallback === 'function' ? fallback() : fallback;
      fb.erro = true;
      fb.mensagem = e.message;
      fb._label = label;
      return fb;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PERSONAS — definicoes e system prompts
  // ═══════════════════════════════════════════════════════════════════════
  var PERSONAS = {
    vera: {
      nome: 'Vera',
      empresa: 'PSM IMOVEIS',
      papel: 'atendente digital',
      publico: 'clientes alto padrao e investidores',
      system:
        'Voce e a Vera, atendente digital da PSM IMOVEIS (alto padrao e investimento imobiliario em Sao Jose do Rio Preto/SP). '
      + 'Perfil: elegante, tecnica, consultiva. Fala com investidores e compradores de imoveis acima de R$ 800k. '
      + 'Sabe explicar ROI, VPL, cap rate, potencial valorizacao, rentabilidade aluguel vs. venda, LTV, regiao nobre. '
      + 'NUNCA oferece MCMV. Se cliente perguntar sobre subsidio popular, redireciona gentilmente para Sol da PSM CONQUISTA. '
      + 'Tom: discreto, sofisticado, direto. Sem emojis. Sem exclamacoes. Trata por senhor/senhora ate o cliente autorizar nome. '
      + 'Nunca inventa dado de imovel: se nao sabe o metro quadrado/valor exato, diz que vai confirmar com consultor humano.'
    },
    sol: {
      nome: 'Sol',
      empresa: 'PSM CONQUISTA',
      papel: 'atendente digital',
      publico: 'compradores residenciais C/B, MCMV, primeiro imovel',
      system:
        'Voce e a Sol, atendente digital da PSM CONQUISTA (residencial C/B e MCMV em Sao Jose do Rio Preto/SP). '
      + 'Perfil: acolhedora, didatica, entusiasta. Fala com familias comprando o primeiro imovel, classe C/B, renda ate R$ 9.600 (MCMV). '
      + 'Sabe explicar MCMV (Faixas 1, 2, 3), subsidio, FGTS, financiamento Caixa, entrada facilitada, documentacao, sonho da casa propria. '
      + 'NUNCA oferece investimento/alto padrao. Se cliente for investidor, redireciona educadamente para Vera da PSM IMOVEIS. '
      + 'Tom: proximo, empatico, claro, sem jargao tecnico. Pode usar emoji com moderacao. Trata por voce, nome. '
      + 'Celebra a conquista, nunca pressiona. Se nao sabe algo especifico do imovel, promete consultor humano em seguida.'
    },
    sr_performance: {
      nome: 'Sr Performance',
      empresa: 'PSM (interno)',
      papel: 'analista estrategico dos socios',
      publico: 'socios PSM (lvl 10)',
      system:
        'Voce e o Sr Performance, analista estrategico dedicado aos socios da PSM Assessoria Imobiliaria. '
      + 'Voce enxerga todos os dados do sistema em tempo real: VGV realizado/meta, pipeline, conversao por canal, ticket medio, '
      + 'ciclo de venda, ranking de corretores, comissoes, custo fixo, lucro liquido, historico mensal, forecast 6m. '
      + 'Tom: executivo, direto, cirurgico. Fala com socios que querem saber o que importa hoje. '
      + 'Prioriza sempre: (1) risco imediato da meta, (2) alavancas ainda disponiveis no mes, (3) tendencia estrutural. '
      + 'Nao enfeita. Nao lista 20 coisas. Responde em 3-5 bullets no maximo. '
      + 'Cita numero exato quando tem, e assume "nao tenho esse dado" quando falta — nunca estima escondido. '
      + 'Se dado parece incoerente (ticket muito baixo, conversao muito alta), sinaliza possivel erro na base.'
    },
    sr_gerencia: {
      nome: 'Sr Gerencia',
      empresa: 'PSM (interno)',
      papel: 'gestor do time de vendas',
      publico: 'corretores PSM',
      system:
        'Voce e o Sr Gerencia, gestor direto do time de corretores PSM. '
      + 'Voce acompanha: atividade diaria, reunioes agendadas/realizadas, follow-up em atraso, leads parados, meta individual vs. realizado, '
      + 'rotina de prospeccao, objecoes mais comuns, treinamento, perfil IBC (D/I/S/C) do corretor. '
      + 'Ajuda no atendimento: sugere respostas para objecoes, script de ligacao, proximo passo com cliente frio/morno/quente. '
      + 'Cobra com firmeza mas sem humilhacao: aponta o que esta atrasado, o que precisa mudar, o prazo. '
      + 'Tom: direto, pratico, firme. Usa "voce" e o nome do corretor. Nao amacia quando a meta esta em risco. '
      + 'Adapta o estilo ao perfil IBC: com D (dominancia) vai mais objetivo, com I (influente) mais motivador, '
      + 'com S (estavel) mais paciente, com C (consciente) mais analitico. '
      + 'Sempre termina com acao concreta: "proximo passo: ligar X, agendar Y, responder Z ate horario tal".'
    }
  };

  // Chamada de conversa em nome de uma persona
  function askPersona(personaId, mensagem, contexto){
    var p = PERSONAS[personaId];
    if (!p) return Promise.reject(new Error('Persona desconhecida: '+personaId));
    var system = p.system;
    var prompt = mensagem;
    if (contexto && typeof contexto === 'object'){
      prompt = 'CONTEXTO (JSON):\n' + JSON.stringify(contexto, null, 2) + '\n\nMENSAGEM:\n' + mensagem;
    }
    return callAI(prompt, system, personaId).then(function(res){
      return {
        persona: p.nome,
        resposta: res.text,
        provider: res.provider
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HANDLES TECNICOS (usam Sr Performance por baixo quando faz sentido)
  // ═══════════════════════════════════════════════════════════════════════
  function scoreLead(lead){
    var prompt = 'Voce avalia um lead para corretores da PSM em Sao Jose do Rio Preto/SP. '
      + 'Lead:\n' + JSON.stringify(lead, null, 2) + '\n\n'
      + 'Retorne APENAS JSON: {"score":0-100, "motivo":"frase curta", "proxima_acao":"verbo + alvo"}. '
      + '100 = super quente, fecha em 7 dias.';
    return exec(prompt, {score:50, motivo:'IA indisponivel', proxima_acao:'Ligar'}, 'scoreLead', PERSONAS.sr_gerencia.system);
  }

  function alertaPerformance(corretor){
    var prompt = 'Corretor '+corretor.nome+'. Ultimas semanas: ' + JSON.stringify(corretor.semanas) + '\n\n'
      + 'Detecte queda/estagnacao/melhora. Retorne APENAS JSON: '
      + '{"alerta":true|false, "severidade":"low|med|high", "mensagem":"observacao", "recomendacao":"acao para gerente"}';
    return exec(prompt, {alerta:false, severidade:'low', mensagem:'IA indisponivel', recomendacao:''}, 'alertaPerformance', PERSONAS.sr_gerencia.system);
  }

  function sugerirAcoes(contexto){
    var prompt = 'Contexto:\n' + JSON.stringify(contexto, null, 2) + '\n\n'
      + 'Sugira 3 acoes concretas para bater meta. Retorne APENAS JSON array: '
      + '[{"acao":"verbo+alvo", "prioridade":"alta|media|baixa", "impacto_esperado":"% meta"}]';
    return callAI(prompt, PERSONAS.sr_performance.system).then(function(res){
      var p = parseJSON(res.text);
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.acoes)) return p.acoes;
      return [{acao:'IA nao retornou lista', prioridade:'baixa', impacto_esperado:'0%', _raw:(res.text||'').slice(0,200), _provider:res.provider}];
    }).catch(function(e){
      if (window.Sentry) try{ window.Sentry.captureException(e, {tags:{module:'psm-ia', fn:'sugerirAcoes'}}); }catch(_){}
      return [{acao:'Ligar top 5 leads', prioridade:'alta', impacto_esperado:'20%', erro:true, mensagem:e.message}];
    });
  }

  function preverVenda(historico, atual){
    var prompt = 'Historico ultimos 6 meses:\n' + JSON.stringify(historico)
      + '\n\nProgresso mes atual:\n' + JSON.stringify(atual) + '\n\n'
      + 'Retorne APENAS JSON: {"previsto":N, "confianca":"baixa|media|alta", "base":"como calculou", "risco":"o que pode mudar"}';
    return exec(prompt, function(){
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
    }, 'preverVenda', PERSONAS.sr_performance.system);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DIAGNOSTICO
  // ═══════════════════════════════════════════════════════════════════════
  function healthCheck(){
    var order = getProviderOrder();
    var report = {
      order: order,
      providers: {},
      keysConfigured: {}
    };
    order.forEach(function(p){
      report.keysConfigured[p] = !!getKey(p);
    });
    // Ping apenas providers com key
    var tasks = order.filter(function(p){ return !!getKey(p); }).map(function(p){
      return callProvider(p, 'Diga apenas a palavra OK.', '')
        .then(function(r){ report.providers[p] = {ok:true, raw:(r.text||'').slice(0,40)}; })
        .catch(function(e){ report.providers[p] = {ok:false, error:e.message}; });
    });
    return Promise.all(tasks).then(function(){ return report; });
  }

  function listPersonas(){
    return Object.keys(PERSONAS).map(function(id){
      var p = PERSONAS[id];
      return {id:id, nome:p.nome, empresa:p.empresa, papel:p.papel, publico:p.publico};
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EXPOSE
  // ═══════════════════════════════════════════════════════════════════════
  window.psmIA = {
    // Handles tecnicos (JSON estruturado)
    scoreLead:         scoreLead,
    alertaPerformance: alertaPerformance,
    sugerirAcoes:      sugerirAcoes,
    preverVenda:       preverVenda,

    // Personas conversacionais
    askPersona:        askPersona,
    askVera:           function(msg, ctx){ return askPersona('vera', msg, ctx); },
    askSol:            function(msg, ctx){ return askPersona('sol', msg, ctx); },
    askSrPerformance:  function(msg, ctx){ return askPersona('sr_performance', msg, ctx); },
    askSrGerencia:     function(msg, ctx){ return askPersona('sr_gerencia', msg, ctx); },
    listPersonas:      listPersonas,
    _personas:         PERSONAS,

    // Core/config
    callAI:            callAI,
    _callProvider:     callProvider,
    _providers:        PROVIDERS,
    setProvider:       function(name){
      if (!PROVIDERS[name] && name !== 'auto') throw new Error('Provider invalido');
      if (name === 'auto'){ localStorage.removeItem('psm_ia_provider'); if(window.S)delete window.S.iaProvider; }
      else { localStorage.setItem('psm_ia_provider', name); if(window.S)window.S.iaProvider = name; }
      console.log('[PSM-IA] provider='+name);
    },
    getProviderOrder:  getProviderOrder,
    setKey:            setKey,
    getKey:            function(name){ return getKey(name) ? '***' + getKey(name).slice(-4) : ''; },
    bootKeys:          bootKeys,
    keysStatus:        function(){
      var s = {};
      Object.keys(PROVIDERS).forEach(function(n){
        var k = getKey(n);
        s[n] = {configured: !!k, mask: k ? '***'+k.slice(-4) : '(vazio)'};
      });
      return s;
    },

    // Diagnostico
    healthCheck:       healthCheck,
    _cache:            CACHE,
    _clearCache:       function(){ CACHE = {}; },
    _debug:            function(on){ DEBUG = !!on; console.log('[PSM-IA] debug='+DEBUG); },
    _version:          '26.4'
  };

  // Auto-boot: hidrata S.connectors a partir do localStorage no carregamento
  bootKeys();

  console.log('[PSM-IA] v26.4 pronto — multi-provider (Claude/Gemini/GPT) + 4 personas (Vera, Sol, Sr Performance, Sr Gerencia)');
  console.log('[PSM-IA] keys status:', window.psmIA && typeof window.psmIA.keysStatus === 'function' ? window.psmIA.keysStatus() : 'n/a');
})();
