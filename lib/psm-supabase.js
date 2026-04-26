/*
 * PSM OS — Supabase wrapper (dual-write) — v0.2 Sprint 2 (2026-04-25)
 * ============================================================
 * Este arquivo eh carregado ANTES do bloco principal de script
 * no index.html. Ele expoe:
 *   window.psmAuth  — login/logout/signup via Supabase
 *   window.psmDb    — read/write de user_kv e shared_kv
 *   window.PSM_SYNC_MODE — "parallel" (padrao) ou "supabase"
 *
 * Modo "parallel":
 *   - saveState() continua escrevendo no localStorage (como sempre)
 *   - E TAMBEM escreve no Supabase em background (com debounce)
 *   - Se Supabase cair, o sistema continua funcionando local
 *   - Seguro para rollback
 *
 * Modo "supabase":
 *   - Supabase eh a fonte da verdade
 *   - localStorage vira apenas cache
 *   - SO ativar depois de 1 semana estavel em paralelo
 *
 * Configuracao: preencher SUPABASE_URL e SUPABASE_ANON_KEY abaixo.
 * ============================================================
 */
(function(){
  'use strict';

  // ---- CONFIG (preencher depois que o projeto Supabase for criado) ----
  var SUPABASE_URL      = window.SUPABASE_URL      || '__SUPABASE_URL__';
  var SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '__SUPABASE_ANON_KEY__';
  var SYNC_MODE         = window.PSM_SYNC_MODE     || 'parallel';

  // Lista de chaves que vivem em shared_kv (antigos SYNC_KEYS do Firebase)
  // Qualquer key que NAO esta aqui vai pra user_kv (privado por usuario)
  var SHARED_KEYS = [
    'BROKERS','PROJETOS','LEADS_POOL','LEADS','PRODUTOS','CALENDARIO',
    'METAS','AVISOS','SUPRIMENTOS','TREINAMENTOS','ATAS','DOCUMENTOS',
    'COMISSOES','REGRAS','CONFIG','INCENTIVOS','REUNIOES_GERAIS',
    'POSTVENDA','LOCACAO_IMOVEIS','LOCACAO_INQUILINOS','LOCACAO_PROPRIETARIOS',
    'TERCEIROS_IMOVEIS','ARENA_STATE','PARCEIROS','RANKINGS','MAPA_VENDAS',
    'CAMPANHAS','INDICADORES','LOG_AUDITORIA','MENSAGENS','USER_DISABLED'
  ];

  var ready = false;
  var client = null;
  var currentUser = null;
  var writeQueue = {};
  var writeTimer = null;
  var WRITE_DEBOUNCE = 1500; // ms


  // ── Sprint 2 (2026-04-25) ──────────────────────────────────────────────
  // Quando NAO ha sessao Supabase Auth, derivamos um UUID deterministico do
  // psm user.id legado (S.user.id em window.S). Permite que cada corretor
  // tenha seus dados em user_kv sem precisar criar conta Supabase real.
  // ── Sprint 4+ vai substituir isso por Supabase Auth real.
  function _legacyUid() {
    try {
      var psmId = (window.S && window.S.user && window.S.user.id) || '';
      if (!psmId) return null;
      var hex = '';
      for (var i = 0; i < psmId.length; i++) hex += psmId.charCodeAt(i).toString(16).padStart(2,'0');
      hex = (hex + '00000000000000000000000000000000').substring(0,32);
      return hex.substring(0,8) + '-' + hex.substring(8,12) + '-' + hex.substring(12,16) + '-' + hex.substring(16,20) + '-' + hex.substring(20,32);
    } catch(e) { return null; }
  }
  function _activeUid() {
    if (currentUser && currentUser.id) return currentUser.id;
    return _legacyUid();
  }

  function isShared(key) {
    if (!key) return false;
    for (var i = 0; i < SHARED_KEYS.length; i++) {
      if (key === SHARED_KEYS[i]) return true;
    }
    return false;
  }

  function log() {
    if (window.PSM_DEBUG) console.log.apply(console, ['[psm-sb]'].concat([].slice.call(arguments)));
  }
  function warn() { console.warn.apply(console, ['[psm-sb]'].concat([].slice.call(arguments))); }

  // --------------------------------------------------------
  // Boot: carrega SDK Supabase via CDN e cria client
  // --------------------------------------------------------
  function loadSdk(cb) {
    if (window.supabase && window.supabase.createClient) return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.async = true;
    s.onload = cb;
    s.onerror = function(){ warn('falha ao carregar SDK Supabase'); };
    document.head.appendChild(s);
  }

  function init() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.indexOf('__') === 0 || SUPABASE_ANON_KEY.indexOf('__') === 0) {
      log('SUPABASE_URL/KEY nao configurados — wrapper inerte, rodando SO em localStorage');
      return;
    }
    loadSdk(function(){
      try {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true }
        });
        ready = true;
        log('client pronto, modo=', SYNC_MODE);
        client.auth.getUser().then(function(r){
          currentUser = r && r.data && r.data.user || null;
          log('user=', currentUser && currentUser.email);
          if (currentUser) subscribeRealtime();
        });
        client.auth.onAuthStateChange(function(ev, session){
          currentUser = session && session.user || null;
          log('auth change=', ev, currentUser && currentUser.email);
          if (currentUser) subscribeRealtime();
        });
      } catch(e) {
        warn('init erro', e);
      }
    });
  }

  // --------------------------------------------------------
  // Realtime subscription em shared_kv
  // --------------------------------------------------------
  var realtimeChan = null;
  function subscribeRealtime() {
    if (!client || realtimeChan) return;
    try {
      realtimeChan = client
        .channel('shared_kv_changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'shared_kv' },
            function(payload) {
              try {
                var row = payload.new || payload.old;
                if (!row || !row.key) return;
                // Ignora mudancas que vieram do proprio usuario
                if (row.updated_by && currentUser && row.updated_by === currentUser.id) return;
                log('realtime', payload.eventType, row.key);
                // Atualiza localStorage pra manter em sincronia
                if (payload.new) {
                  try { localStorage.setItem(row.key, JSON.stringify(payload.new.value)); } catch(e){}
                }
                // Avisa o app pra re-renderizar (se ele escutar)
                if (typeof window.psmOnRemoteChange === 'function') {
                  try { window.psmOnRemoteChange(row.key); } catch(e){}
                }
              } catch(e) { warn('realtime handler', e); }
            })
        .subscribe(function(status){ log('realtime status=', status); });
    } catch(e) { warn('subscribeRealtime', e); }
  }

  // --------------------------------------------------------
  // Escrita com debounce e batch
  // --------------------------------------------------------
  function enqueueWrite(key, value) {
    writeQueue[key] = value;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flushWrites, WRITE_DEBOUNCE);
  }

  function flushWrites() {
    writeTimer = null;
    if (!ready || !client) { writeQueue = {}; return; }
    var keys = Object.keys(writeQueue);
    if (!keys.length) return;
    var batch = writeQueue;
    writeQueue = {};

    var sharedRows = [];
    var userRows = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = batch[k];
      if (isShared(k)) {
        sharedRows.push({ key: k, value: v });
      } else {
        var uid = _activeUid();
        if (uid) {
          userRows.push({ user_id: uid, key: k, value: v });
        } else {
          warn('user_kv drop (sem psm/auth user):', k);
        }
      }
    }

    if (sharedRows.length) {
      client.from('shared_kv').upsert(sharedRows, { onConflict: 'key' })
        .then(function(r){ if (r.error) warn('shared upsert', r.error); else log('shared ok', sharedRows.length); });
    }
    if (userRows.length) {
      client.from('user_kv').upsert(userRows, { onConflict: 'user_id,key' })
        .then(function(r){ if (r.error) warn('user upsert', r.error); else log('user ok', userRows.length); });
    }
  }

  // --------------------------------------------------------
  // API publica
  // --------------------------------------------------------
  window.psmAuth = {
    isReady: function(){ return ready; },
    user: function(){ return currentUser; },
    signIn: function(email, password) {
      if (!client) return Promise.reject(new Error('client nao iniciado'));
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    signOut: function() {
      if (!client) return Promise.resolve();
      return client.auth.signOut();
    },
    resetPassword: function(email) {
      if (!client) return Promise.reject(new Error('client nao iniciado'));
      return client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password'
      });
    }
  };

  window.psmDb = {
    isReady: function(){ return ready; },
    mode: function(){ return SYNC_MODE; },
    // Escreve (via debounce). Usado pelo saveState monkey-patch.
    write: function(key, value) { enqueueWrite(key, value); },
    // Le um valor unico (usado no boot pra hidratar do Supabase)
    read: function(key) {
      if (!ready || !client) return Promise.resolve(null);
      if (isShared(key)) {
        return client.from('shared_kv').select('value').eq('key', key).maybeSingle()
          .then(function(r){ return r.data ? r.data.value : null; });
      }
      if (!currentUser) return Promise.resolve(null);
      return client.from('user_kv').select('value').eq('user_id', (currentUser && currentUser.id) || _legacyUid()).eq('key', key).maybeSingle()
        .then(function(r){ return r.data ? r.data.value : null; });
    },
    // Le TUDO do usuario + shared (usado no boot em modo supabase)
    hydrateAll: function() {
      if (!ready || !client) return Promise.resolve({});
      var out = {};
      var p1 = client.from('shared_kv').select('key,value').then(function(r){
        if (r.data) r.data.forEach(function(row){ out[row.key] = row.value; });
      });
      var p2 = _activeUid()
        ? client.from('user_kv').select('key,value').eq('user_id', (currentUser && currentUser.id) || _legacyUid()).then(function(r){
            if (r.data) r.data.forEach(function(row){ out[row.key] = row.value; });
          })
        : Promise.resolve();
      return Promise.all([p1, p2]).then(function(){ return out; });
    },
    flush: function(){ if (writeTimer) { clearTimeout(writeTimer); flushWrites(); } }
  };

  window.PSM_SYNC_MODE = SYNC_MODE;

  // --------------------------------------------------------
  // Monkey-patch de saveState (parallel mode)
  // --------------------------------------------------------
  // O index.html define saveState() globalmente. Em modo paralelo,
  // envolvemos saveState() pra copiar tambem pro Supabase.
  // Executa depois que o DOM + script principal carregou.
  function patchSaveState() {
    if (typeof window.saveState !== 'function') { setTimeout(patchSaveState, 500); return; }
    if (window.saveState.__psmPatched) return;
    var orig = window.saveState;
    var LAST_SNAPSHOT = {};
    window.saveState = function() {
      var r = orig.apply(this, arguments);
      // Apos salvar localStorage, detecta keys que mudaram e envia
      try {
        if (!ready) return r;
        // Estrategia: envia todos os shared keys + tudo que esta em window.S
        if (window.S) {
          for (var k in window.S) {
            if (!Object.prototype.hasOwnProperty.call(window.S, k)) continue;
            var v = window.S[k];
            // dedup superficial via JSON length (barato)
            var sig = v == null ? 'null' : (typeof v === 'object' ? JSON.stringify(v).length + ':' + (Object.keys(v).length) : String(v));
            if (LAST_SNAPSHOT[k] !== sig) {
              LAST_SNAPSHOT[k] = sig;
              enqueueWrite(k, v);
            }
          }
        }
      } catch(e) { warn('saveState patch', e); }
      return r;
    };
    window.saveState.__psmPatched = true;
    log('saveState monkey-patched');
  }

  // --------------------------------------------------------
  // Boot
  // --------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ init(); patchSaveState(); });
  } else {
    init();
    patchSaveState();
  }

  // Flush pendente antes de sair
  window.addEventListener('beforeunload', function(){
    try { if (writeTimer) { clearTimeout(writeTimer); flushWrites(); } } catch(e){}
  });

})();
