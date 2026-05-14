// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-supabase.js v73.0.0
// Wrapper Supabase: autenticacao + key/value store + realtime subscriptions.
//
// Estrategia v73 (BRIDGE): Firebase continua sendo a fonte primaria de verdade.
// Supabase entra como destino paralelo (dual-write) com schema preparado.
// Quando RLS estiver provada em prod, sprint v74+ pode flippar a primaria.
//
// API publica (window.psmSupabase + PSM.supabase):
//   ready()                          - Promise<boolean> quando client conectado
//   getClient()                      - retorna o supabase-js client (ou null)
//   signIn(email, senha)             - login
//   signUp(email, senha)             - cadastro
//   signOut()                        - logout
//   getUser()                        - usuario atual (Promise)
//   kvGet(table, key)                - le valor de shared_kv ou user_kv
//   kvSet(table, key, value)         - escreve valor (upsert)
//   kvDelete(table, key)             - remove valor
//   kvSubscribe(table, key, cb)      - realtime subscription
//   audit(action, table, key, data)  - registra evento no audit_log
//
// Dependencias:
//   - <script src="/api/supabase-config"> define window.SUPABASE_URL/ANON_KEY
//   - <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"> define window.supabase
//
// Tabelas esperadas no Supabase (ver SECURITY-DEPLOY.md §10 para schema completo):
//   shared_kv (key text PK, value jsonb, updated_at timestamptz, updated_by text)
//   user_kv   (user_id uuid, key text, value jsonb, PRIMARY KEY (user_id, key))
//   audit_log (id bigserial, ts timestamptz, actor text, action text, table_name text, key text, value jsonb)
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  function _log(level, msg, data){
    if (global.PSM && global.PSM.log) return global.PSM.log[level]('supabase', msg, data);
  }

  var _client = null;
  var _ready = false;
  var _readyResolvers = [];

  function _resolveReady(state){
    _ready = state;
    var cbs = _readyResolvers.slice();
    _readyResolvers.length = 0;
    cbs.forEach(function(cb){ try { cb(state); } catch(_){} });
  }

  function _init(){
    if (_client) return;
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      _log('warn', 'supabase-js SDK ausente — wrapper inativo');
      _resolveReady(false);
      return;
    }
    var url = global.SUPABASE_URL;
    var key = global.SUPABASE_ANON_KEY;
    if (!url || !key) {
      _log('warn', 'SUPABASE_URL/ANON_KEY ausentes — wrapper inativo');
      _resolveReady(false);
      return;
    }
    try {
      _client = global.supabase.createClient(url, key, {
        auth: {
          persistSession: true,
          storageKey: 'psm_supabase_token',
          autoRefreshToken: true
        },
        realtime: {
          params: { eventsPerSecond: 5 }
        }
      });
      _log('info', 'client conectado a ' + url);
      _resolveReady(true);
    } catch(e){
      _log('error', 'falha ao criar client', e);
      _resolveReady(false);
    }
  }

  // ─── API publica ────────────────────────────────────────────────────────────

  function ready(){
    if (_ready) return Promise.resolve(true);
    if (_client) return Promise.resolve(true);
    return new Promise(function(res){ _readyResolvers.push(res); });
  }

  function getClient(){ return _client; }

  async function signIn(email, senha){
    if (!_client) await ready();
    if (!_client) return { error: { message: 'Supabase nao configurado' } };
    try {
      var r = await _client.auth.signInWithPassword({ email: email, password: senha });
      _log('info', 'signIn', { email: email, ok: !r.error });
      return r;
    } catch(e){ _log('error', 'signIn failed', e); return { error: e }; }
  }

  async function signUp(email, senha){
    if (!_client) await ready();
    if (!_client) return { error: { message: 'Supabase nao configurado' } };
    try {
      var r = await _client.auth.signUp({ email: email, password: senha });
      _log('info', 'signUp', { email: email, ok: !r.error });
      return r;
    } catch(e){ _log('error', 'signUp failed', e); return { error: e }; }
  }

  async function signOut(){
    if (!_client) return { error: null };
    try { return await _client.auth.signOut(); }
    catch(e){ return { error: e }; }
  }

  async function getUser(){
    if (!_client) await ready();
    if (!_client) return null;
    try {
      var r = await _client.auth.getUser();
      return r.data && r.data.user ? r.data.user : null;
    } catch(_){ return null; }
  }

  // ─── KV store ────────────────────────────────────────────────────────────────

  async function kvGet(table, key){
    if (!_client) await ready();
    if (!_client) return null;
    if (table !== 'shared_kv' && table !== 'user_kv') {
      _log('warn', 'kvGet: tabela invalida', table);
      return null;
    }
    try {
      var q = _client.from(table).select('value').eq('key', key);
      if (table === 'user_kv') {
        var u = await getUser();
        if (!u) return null;
        q = q.eq('user_id', u.id);
      }
      var r = await q.maybeSingle();
      return r.data ? r.data.value : null;
    } catch(e){
      _log('warn', 'kvGet erro', e);
      return null;
    }
  }

  async function kvSet(table, key, value){
    if (!_client) await ready();
    if (!_client) return false;
    if (table !== 'shared_kv' && table !== 'user_kv') {
      _log('warn', 'kvSet: tabela invalida', table);
      return false;
    }
    try {
      var row = { key: key, value: value, updated_at: new Date().toISOString() };
      if (table === 'shared_kv') {
        var u = await getUser();
        row.updated_by = u ? u.id : 'anonymous';
      } else { // user_kv
        var u2 = await getUser();
        if (!u2) { _log('warn', 'kvSet user_kv sem usuario logado'); return false; }
        row.user_id = u2.id;
      }
      var r = await _client.from(table).upsert(row, {
        onConflict: table === 'user_kv' ? 'user_id,key' : 'key'
      });
      if (r.error) { _log('warn', 'kvSet erro', r.error); return false; }
      return true;
    } catch(e){ _log('error', 'kvSet exception', e); return false; }
  }

  async function kvDelete(table, key){
    if (!_client) await ready();
    if (!_client) return false;
    try {
      var q = _client.from(table).delete().eq('key', key);
      if (table === 'user_kv') {
        var u = await getUser();
        if (!u) return false;
        q = q.eq('user_id', u.id);
      }
      var r = await q;
      return !r.error;
    } catch(e){ _log('warn', 'kvDelete erro', e); return false; }
  }

  function kvSubscribe(table, key, callback){
    if (!_client) {
      _log('warn', 'kvSubscribe antes do client estar pronto');
      return function(){};
    }
    var channelName = 'kv:' + table + ':' + key;
    var ch = _client
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: table, filter: 'key=eq.' + key }, function(payload){
        try { callback(payload); } catch(e){ _log('warn', 'subscribe callback erro', e); }
      })
      .subscribe();
    _log('debug', 'inscrito em ' + channelName);
    return function unsubscribe(){
      try { _client.removeChannel(ch); } catch(_){}
    };
  }

  // ─── Audit log ───────────────────────────────────────────────────────────────

  async function audit(action, table, key, value){
    if (!_client) return false;
    try {
      var u = await getUser();
      var row = {
        ts: new Date().toISOString(),
        actor: u ? u.id : 'anonymous',
        action: action,
        table_name: table,
        key: key,
        value: value || null
      };
      var r = await _client.from('audit_log').insert(row);
      return !r.error;
    } catch(_){ return false; }
  }

  // ─── Boot ────────────────────────────────────────────────────────────────────

  // Aguarda DOM + supabase-js carregar (CDN com defer no admin.html, sem defer no index.html)
  function _boot(){
    if (global.supabase && global.supabase.createClient) {
      _init();
    } else {
      // Polling rapido (max 5s) — supabase-js carrega geralmente em <1s
      var tries = 0;
      var iv = setInterval(function(){
        if (global.supabase && global.supabase.createClient) {
          clearInterval(iv); _init();
        } else if (++tries > 50) {
          clearInterval(iv);
          _log('warn', 'supabase-js nao carregou apos 5s');
          _resolveReady(false);
        }
      }, 100);
    }
  }
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  // ─── Expose ──────────────────────────────────────────────────────────────────

  var api = {
    ready: ready,
    getClient: getClient,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    getUser: getUser,
    kvGet: kvGet,
    kvSet: kvSet,
    kvDelete: kvDelete,
    kvSubscribe: kvSubscribe,
    audit: audit,
    VERSION: '73.0.0'
  };

  global.psmSupabase = api;
  global.PSM = global.PSM || {};
  global.PSM.supabase = api;

  _log('debug', 'psm-supabase.js v73.0.0 carregado');
})(typeof window !== 'undefined' ? window : this);
