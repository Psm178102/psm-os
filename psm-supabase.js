/* PSM OS — Supabase wrapper (v22m)
 * Carrega Supabase JS client do CDN e expoe window.psmSupabase.
 * Faz dual-write opcional (Firebase + Supabase) e auth stub.
 * Silencioso se credenciais ausentes.
 */
(function(){
  'use strict';

  var URL  = window.PSM_SUPABASE_URL;
  var ANON = window.PSM_SUPABASE_ANON;

  if (!URL || !ANON){
    console.log('[PSM-Supabase] credenciais ausentes — skip');
    return;
  }

  // Carrega CDN se ainda nao presente
  function loadSbClient(cb){
    if (window.supabase && window.supabase.createClient) return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/dist/umd/supabase.min.js';
    s.onload = cb;
    s.onerror = function(){ console.warn('[PSM-Supabase] CDN fail'); };
    document.head.appendChild(s);
  }

  loadSbClient(function(){
    try {
      var sb = window.supabase.createClient(URL, ANON, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });

      window.psmSupabase = {
        client: sb,
        // Auth wrappers — prontos para uso futuro em substituicao ao _localLogin
        signIn: function(email, senha){
          return sb.auth.signInWithPassword({email:email, password:senha});
        },
        signUp: function(email, senha, meta){
          return sb.auth.signUp({email:email, password:senha, options:{data:meta||{}}});
        },
        signOut: function(){ return sb.auth.signOut(); },
        getUser: function(){ return sb.auth.getUser(); },
        // Dual-write opcional (nao ativo por padrao — so quando schema estiver pronto)
        saveSnapshot: async function(payload){
          try {
            var { error } = await sb.from('psm_snapshots').insert({
              user_email: (window.S && window.S.user && window.S.user.email) || 'anon',
              payload: payload,
              created_at: new Date().toISOString()
            });
            if (error) throw error;
            return {ok:true};
          } catch(e){
            console.warn('[PSM-Supabase] saveSnapshot fail', e.message);
            return {ok:false, err:e};
          }
        }
      };

      // Expoe tambem como window.psmAuth (API historica)
      window.psmAuth = {
        signIn: window.psmSupabase.signIn,
        signOut: window.psmSupabase.signOut
      };

      console.log('[PSM-Supabase] pronto', URL);
    } catch(err){
      console.warn('[PSM-Supabase] init fail', err);
    }
  });
})();
