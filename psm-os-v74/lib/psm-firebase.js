// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-firebase.js v72.0.0
// Toda a sincronizacao Firebase Realtime Database em UM lugar.
// Extraido inline do index.html (v72 modularization).
//
// API publica (window.*):
//   fbGetConfig()         - retorna config Firebase (do /api/config ou localStorage)
//   fbSaveConfig(cfg)     - salva config no localStorage
//   fbInit()              - inicializa SDK, conecta DB, registra listener 'shared'
//   fbPushState(immediate)- envia state atual para Firebase (debounced 1.5s)
//   fbSetupConfig()       - abre modal para configurar Firebase
//
// State privado (nao exposto):
//   _fbApp, _fbDb, _fbReady, _fbSyncing, _fbLastPush, _fbDebounceTimer,
//   _fbPendingRun, _fbSyncingTimer, _fbBackupTimer
//
// Dependencias externas que o bundle inline deve fornecer:
//   S (state global), SYNC_KEYS (array), STORAGE_KEY (const), firebase (SDK)
//   saveState(), render(), toast(), recalcBrokerMetrics() — funcoes globais
//   _psmFbBlocked(), psmFbReportFail(), psmFbReportSuccess() — do FB freeze + watchdog
//   _psmDeepMerge() — usado em alguns paths de merge
//
// Por que IIFE com expose explicito em window.X:
//   1) state interno fica privado
//   2) ordem de carregamento controlavel (defer)
//   3) bundle monolitico ainda chama fbInit() sem prefixo
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  // Garante que firebase SDK esteja disponivel
  if (typeof global.firebase === 'undefined') {
    if (global.PSM && global.PSM.log) global.PSM.log.warn('firebase', 'firebase SDK ausente — modulo carregado mas inativo');
  }

  // ─── BEGIN extracted code from index.html v71 (linhas 2244-2669) ─────────
  var _fbApp = null;
  var _fbDb = null;
  var _fbReady = false;
  var _fbSyncing = false; // prevent loops
  var _fbLastPush = 0;
  var _fbDebounceTimer = null;
  
  // v68 SECURITY: FB_DEFAULT_CONFIG removido do source publico.
  // A config Firebase agora vem de /api/config (env vars do Vercel) ou do
  // localStorage 'psm_firebase_config' (configuravel pelo modal Settings).
  // Se nenhum estiver disponivel, fbInit() loga "nao configurado" e o app
  // roda em modo offline-only (localStorage) ate o usuario configurar.
  var FB_DEFAULT_CONFIG = null;
  
  function fbGetConfig() {
    // 1) preferencia: config injetada pelo /api/config (carregada via psm-config.js)
    try {
      if (window.PSM && PSM.config && PSM.config.isReady()) {
        var remote = PSM.config.getFirebase();
        if (remote && remote.databaseURL) return remote;
      }
    } catch(_){}
    // 2) fallback: configuracao salva localmente pelo usuario
    try {
      var custom = JSON.parse(localStorage.getItem('psm_firebase_config') || 'null');
      if (custom && custom.databaseURL) return custom;
    } catch(e) {}
    // 3) sem config — Firebase nao sera inicializado
    return null;
  }
  function fbSaveConfig(cfg) {
    localStorage.setItem('psm_firebase_config', JSON.stringify(cfg));
  }
  
  function fbInit() {
    var cfg = fbGetConfig();
    if (!cfg || !cfg.databaseURL) {
      console.log('[PSM-Sync] Firebase n\u00e3o configurado');
      return;
    }
    try {
      if (_fbApp) {
        try { _fbApp.delete(); } catch(e){(window.PSM&&PSM.log?PSM.log.error("legacy:27.7","caught",e):console.error("[PSM]",e));}
      }
      _fbApp = firebase.initializeApp(cfg, 'psm-sync');
      _fbDb = firebase.database(_fbApp);
      _fbReady = true;
      console.log('[PSM-Sync] Firebase conectado:', cfg.projectId);
      // Inicia scheduler de backups automáticos (1 na subida + 1 a cada 6h)
      try { _fbScheduleAutoBackup(); } catch(e) { console.warn('[auto-backup]', e); }
      // Listen for remote changes — SEM loop, SEM render durante edicao
      var _fbRecvTimer = null;
      var _fbLastRecvRender = 0;
      var _fbFirstLoad = true;
      var _fbLastUpdate = 0;
      _fbDb.ref('shared').on('value', function(snap) {
        if (_fbSyncing) {
          console.log('[PSM-Sync] Push pendente, ignorando onValue');
          return;
        }
        var data = snap.val();
        if (!data) return;
        // Ignora se nao mudou nada (mesmo timestamp)
        if (data._lastUpdate && data._lastUpdate === _fbLastUpdate) return;
        _fbLastUpdate = data._lastUpdate || 0;
        // Se o update veio de mim mesmo, apenas atualiza timestamp e ignora
        if (data._updatedBy === (S.user ? S.user.id : '') && !_fbFirstLoad) {
          console.log('[PSM-Sync] Ignorando echo proprio');
          return;
        }
        // PROTECAO: se salvamos localmente mais recente que o Firebase, nao sobrescreve
        // FIX v22g: removido !_fbFirstLoad — protecao DEVE rodar tambem no first load,
        // pois e exatamente quando edicoes nao-pushadas (debounce/abafechada) seriam perdidas.
        var localSavedAt = 0;
        try { var _ls = JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); localSavedAt = _ls.savedAt || 0; } catch(e){(window.PSM&&PSM.log?PSM.log.error("legacy:27.7","caught",e):console.error("[PSM]",e));}
        if (localSavedAt > (data._lastUpdate||0)) {
          console.log('[PSM-Sync] Dados locais mais recentes ('+new Date(localSavedAt).toLocaleTimeString()+') que Firebase ('+new Date(data._lastUpdate||0).toLocaleTimeString()+'), ignorando. Push pendente fara o sync.');
          // FIX v22g: dispara push imediato para sincronizar Firebase com local mais recente
          if (_fbFirstLoad) {
            _fbFirstLoad = false;
            setTimeout(function(){ if (typeof fbPushState==='function') fbPushState(true); }, 500);
          }
          return;
        }
        console.log('[PSM-Sync] Dados remotos de:', data._updatedBy||'?');
        // Chaves de mapa (objeto bid→valor) que precisam merge per-key para nao perder edicoes locais recentes
        var OBJ_MERGE_KEYS = {ooSheetLinks:1,ooSheetCache:1,ooSheetAbandoned:1,ooMetas:1,ooFunnelPct:1,ooFunilCustom:1,ooLateralCustom:1,ooMetaLanc:1,ooMetaVgvMes:1,ooObjetivo:1,ooObjetivoPessoal:1,ooRotina:1,ooDatas:1,ooObjSemana:1,ooObjMes:1,ooPontosAtencao:1,ooFechamento:1,ooDiscCustom:1,ooReunioes:1,sonhos:1,metaIndiv:1,comissoes:1,agendaConfig:1,lancMetas:1};
        // Aplica dados no state — MERGE arrays ao inves de sobrescrever cegamente
        SYNC_KEYS.forEach(function(k) {
          if (data[k] === undefined) return;
          // FIX v22i: ooAuditLog — array sem id, merge especial concat+dedupe (preserva log de TODAS abas)
          if (k === 'ooAuditLog' && Array.isArray(data[k])) {
            var localLog = Array.isArray(S.ooAuditLog) ? S.ooAuditLog : [];
            var combined = localLog.concat(data[k]);
            var seenLog = {};
            var deduped = [];
            combined.forEach(function(e){
              if (!e) return;
              var key = (e.ts||0)+'|'+(e.actor||'')+'|'+(e.kind||'')+'|'+(e.bid||'')+'|'+(e.field||'');
              if (seenLog[key]) return;
              seenLog[key] = 1;
              deduped.push(e);
            });
            deduped.sort(function(a,b){ return (a.ts||0)-(b.ts||0); });
            if (deduped.length > 5000) deduped = deduped.slice(-5000);
            S.ooAuditLog = deduped;
            return;
          }
          // FIX v22h: arrays com IDs — merge per-id preferindo versao com _updatedAt mais novo (default: LOCAL)
          if (Array.isArray(data[k]) && Array.isArray(S[k]) && S[k].length > 0 && data[k].length > 0 && S[k][0] && S[k][0].id) {
            var byId = {};
            var order = [];
            data[k].forEach(function(r){ if(r&&r.id){ byId[r.id]=r; order.push(r.id); } });
            S[k].forEach(function(local){
              if (!local || !local.id) return;
              var remote = byId[local.id];
              if (!remote) {
                byId[local.id] = local; order.push(local.id);
              } else {
                var lt = local._updatedAt || 0, rt = remote._updatedAt || 0;
                // Empate ou local mais novo -> preserva LOCAL (protege edicoes nao pushadas)
                if (lt >= rt) byId[local.id] = local;
              }
            });
            // dedupe order
            var seen = {}; var ordered = [];
            order.forEach(function(id){ if(!seen[id]){ seen[id]=1; ordered.push(byId[id]); } });
            S[k] = ordered;
          } else if (OBJ_MERGE_KEYS[k] && data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) {
            // FIX v22f: para mapas tipo {bid: valor}, merge per-key preservando entradas locais
            var localObj = (S[k] && typeof S[k]==='object' && !Array.isArray(S[k])) ? S[k] : {};
            var mergedObj = Object.assign({}, localObj);
            Object.keys(data[k]).forEach(function(bid){ mergedObj[bid] = data[k][bid]; });
            S[k] = mergedObj;
          } else {
            S[k] = data[k];
          }
        });
        // FIX v22h: METAS_CONFIG/METAS_EQUIPE/TEAM_CONFIG agora usam DEEP merge, nao Object.assign top-level
        if (data.metasConfig) _psmDeepMerge(METAS_CONFIG, data.metasConfig);
        if (data.metasEquipe) _psmDeepMerge(METAS_EQUIPE, data.metasEquipe);
        if (data.teamConfig)  _psmDeepMerge(TEAM_CONFIG, data.teamConfig);
        // FIX v22h: aplica chaves localStorage isoladas vindas do Firebase (radar, fluxo, dre, etc.)
        if (data._lsKeys && typeof data._lsKeys === 'object') {
          Object.keys(data._lsKeys).forEach(function(lsKey){
            if (SYNC_LS_KEYS.indexOf(lsKey) === -1) return;
            try {
              var val = data._lsKeys[lsKey];
              // Usa raw setters/removers para evitar loop com fbPushState
              if (val == null || val === '') (window._lsRawDel||localStorage.removeItem.bind(localStorage))(lsKey);
              else (window._lsRawSet||localStorage.setItem.bind(localStorage))(lsKey, val);
            } catch(e){ console.warn('[PSM-Sync] _lsKey '+lsKey+':', e); }
          });
        }
        // SALVA LOCAL SEM REENVIAR PRO FIREBASE (skipFbPush=true) — CORRIGE O LOOP
        saveState(true);
        // Debounce render: protege edicao do usuario
        if (_fbRecvTimer) clearTimeout(_fbRecvTimer);
        _fbRecvTimer = setTimeout(function() {
          var ae = document.activeElement;
          var isEditing = ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT'||ae.isContentEditable);
          if (isEditing) {
            console.log('[PSM-Sync] Usuario editando, render adiado');
            return;
          }
          var now = Date.now();
          if (now - _fbLastRecvRender < 10000 && !_fbFirstLoad) {
            console.log('[PSM-Sync] Render throttled (min 10s)');
            return;
          }
          _fbLastRecvRender = now;
          _fbFirstLoad = false;
          render();
          console.log('[PSM-Sync] Render remoto aplicado');
        }, _fbFirstLoad ? 1000 : 5000);
      });
      // Status badge
      _fbDb.ref('.info/connected').on('value', function(snap) {
        S._fbConnected = snap.val() === true;
      });
    } catch(e) {
      console.error('[PSM-Sync] Erro ao conectar Firebase:', e);
      _fbReady = false;
    }
  }
  
  // === BACKUP AUTOMÁTICO NO FIREBASE ==================================
  // Salva snapshots completos em /backups/{ts}. Mantém últimos 30.
  // Dispara: 1x ao carregar, e a cada 6h enquanto a aba estiver aberta.
  var _fbBackupTimer = null;
  var _fbLastBackup = 0;
  function fbSaveBackup(reason) {
    if (!_fbReady || !_fbDb) return Promise.resolve({ok:false, err:'sem firebase'});
    // Rate limit: no máximo 1 backup por hora
    if (Date.now() - _fbLastBackup < 3600000) return Promise.resolve({ok:false, err:'rate-limit'});
    var snapshot = {
      _ts: Date.now(),
      _by: (S.user && S.user.id) || 'system',
      _reason: reason || 'auto',
      ooDaily: S.ooDaily || {},
      ooImportado: S.ooImportado || {},
      ooAuditLog: S.ooAuditLog || [],
      ooReunioes: S.ooReunioes || {},
      ooMetas: S.ooMetas || {},
      ooRotina: S.ooRotina || {},
      ooObjetivo: S.ooObjetivo || {},
      ooObjetivoPessoal: S.ooObjetivoPessoal || {},
      ooMetaLanc: S.ooMetaLanc || {},
      ooMetaVgvMes: S.ooMetaVgvMes || {},
      ooDatas: S.ooDatas || {},
      ooDiscCustom: S.ooDiscCustom || {},
      ooFunilCustom: S.ooFunilCustom || {},
      ooLateralCustom: S.ooLateralCustom || {},
      ooFunnelPct: S.ooFunnelPct || {},
      ooSheetAbandoned: S.ooSheetAbandoned || {},
      comissoes: S.comissoes || {},
      premiacoes: S.premiacoes || [],
      oportunidadesPSM: S.oportunidadesPSM || [],
      lancMetas: S.lancMetas || {},
      metaIndiv: S.metaIndiv || {}
    };
    _fbLastBackup = Date.now();
    var ref = _fbDb.ref('backups/' + snapshot._ts);
    if (_psmFbBlocked('backups.set')) return Promise.resolve({ok:true,frozen:true,total:0,removed:0});
    return ref.set(snapshot).then(function(){
      // Rotação: manter apenas últimos 30
      return _fbDb.ref('backups').once('value');
    }).then(function(snap){
      var all = snap.val() || {};
      var keys = Object.keys(all).sort(); // ts asc
      if (keys.length > 30) {
        var toDelete = keys.slice(0, keys.length - 30);
        var removals = toDelete.map(function(k){ return _psmFbBlocked('backups.remove') ? Promise.resolve() : _fbDb.ref('backups/'+k).remove(); });
        return Promise.all(removals).then(function(){ return {ok:true, total:keys.length, removed:toDelete.length}; });
      }
      return {ok:true, total:keys.length, removed:0};
    }).catch(function(e){
      console.warn('[fbSaveBackup]', e);
      return {ok:false, err:e.message};
    });
  }
  
  function fbListBackups() {
    if (!_fbReady || !_fbDb) return Promise.resolve([]);
    return _fbDb.ref('backups').once('value').then(function(snap){
      var all = snap.val() || {};
      return Object.keys(all).sort().reverse().map(function(ts){
        var b = all[ts] || {};
        return {
          ts: parseInt(ts, 10),
          by: b._by || 'system',
          reason: b._reason || '',
          size: JSON.stringify(b).length,
          audit: (b.ooAuditLog||[]).length,
          daily: Object.keys(b.ooDaily||{}).length,
          importado: Object.keys(b.ooImportado||{}).length
        };
      });
    });
  }
  
  async function fbRestoreBackup(ts) {
    if (!_fbReady || !_fbDb) { toast('Firebase não conectado','err'); return; }
    if (!S.user || (S.user.lvl||0) < 5) { toast('Apenas diretores.','warn'); return; }
    var ok = await psmConfirm('⚠️ RESTAURAR backup de ' + new Date(ts).toLocaleString('pt-BR') + '?\n\n• Vai MESCLAR com dados atuais (dados do backup prevalecem em conflito)\n• Um snapshot do estado atual é salvo automaticamente antes\n• Operação reversível restaurando outro backup\n\nContinuar?', {danger:true});
    if (!ok) return;
    // Snapshot do estado atual antes
    fbSaveBackup('pre-restore').then(function(){
      return _fbDb.ref('backups/' + ts).once('value');
    }).then(function(snap){
      var b = snap.val();
      if (!b) { toast('Backup não encontrado','err'); return; }
      var merged = 0;
      ['ooImportado','ooDaily','ooReunioes','ooMetas','ooRotina','ooObjetivo',
       'ooObjetivoPessoal','ooMetaLanc','ooMetaVgvMes','ooDatas','ooDiscCustom',
       'ooFunilCustom','ooLateralCustom','ooFunnelPct','ooSheetAbandoned'].forEach(function(k){
        if (b[k] && typeof b[k] === 'object') {
          if (!S[k]) S[k] = {};
          Object.keys(b[k]).forEach(function(bid){
            if (!S[k][bid]) S[k][bid] = b[k][bid];
            else if (typeof b[k][bid] === 'object') {
              Object.keys(b[k][bid]).forEach(function(sk){ S[k][bid][sk] = b[k][bid][sk]; merged++; });
            }
          });
        }
      });
      if (Array.isArray(b.ooAuditLog)) {
        S.ooAuditLog = (S.ooAuditLog||[]).concat(b.ooAuditLog);
        var seen = {};
        S.ooAuditLog = S.ooAuditLog.filter(function(e){
          var key = e.ts+'|'+e.actor+'|'+e.kind+'|'+e.bid+'|'+e.field;
          if (seen[key]) return false; seen[key]=1; return true;
        });
        S.ooAuditLog.sort(function(a,b){return a.ts-b.ts;});
        if (S.ooAuditLog.length > 5000) S.ooAuditLog = S.ooAuditLog.slice(-5000);
      }
      saveState();
      render();
      toast('♻️ Backup restaurado: '+merged+' chaves','ok');
    });
  }
  
  function _fbScheduleAutoBackup() {
    if (_fbBackupTimer) return;
    // 1º backup após 30s se conectou agora (dá tempo de sync inicial terminar)
    setTimeout(function(){
      if (_fbReady) fbSaveBackup('auto-startup');
    }, 30000);
    // A cada 6h
    _fbBackupTimer = setInterval(function(){
      if (_fbReady) fbSaveBackup('auto-6h');
    }, 6*3600*1000);
  }
  
  // FIX v22g: armazena ultimo "run" para flush sincrono no beforeunload/pagehide
  // FIX v22i: circuit-breaker — se _fbSyncing fica preso (set throw / network drop), libera apos 30s
  var _fbPendingRun = null;
  var _fbSyncingTimer = null;
  function _fbReleaseSyncing(reason){
    _fbSyncing = false;
    if (_fbSyncingTimer) { clearTimeout(_fbSyncingTimer); _fbSyncingTimer = null; }
    if (reason) console.log('[PSM-Sync] _fbSyncing liberado:', reason);
  }
  // v28: Firebase rate limiter — impede storm de writes (limite 30 pushes/min por client)
  var _fbRateLimit = { window: 60000, max: 30, events: [] };
  function _fbRateCheck() {
    var now = Date.now();
    _fbRateLimit.events = _fbRateLimit.events.filter(function(t){ return (now - t) < _fbRateLimit.window; });
    if (_fbRateLimit.events.length >= _fbRateLimit.max) {
      console.warn('[PSM-FB] rate limit atingido: ' + _fbRateLimit.max + '/min. Push descartado.');
      try { if (window.psmMonitor) window.psmMonitor.alert('warn', 'Firebase rate limit hit (' + _fbRateLimit.max + '/min)'); } catch(_){}
      return false;
    }
    _fbRateLimit.events.push(now);
    return true;
  }
  
  function fbPushState(immediate) {
    if (!_fbReady || !_fbDb) return;
    if (!_fbRateCheck()) return;  // v28: rate limit guard
    // SINALIZA IMEDIATAMENTE que temos push pendente (protege contra onValue sobrescrever)
    _fbSyncing = true;
    // FIX v22i: circuit-breaker 30s — se push trava, nao bloqueia onValue indefinidamente
    if (_fbSyncingTimer) clearTimeout(_fbSyncingTimer);
    _fbSyncingTimer = setTimeout(function(){ _fbReleaseSyncing('timeout 30s'); }, 30000);
    S._localPushPending = Date.now();
    if (_fbDebounceTimer) clearTimeout(_fbDebounceTimer);
    var run = function() {
      _fbPendingRun = null;
      try {
        var shared = {};
        SYNC_KEYS.forEach(function(k) {
          shared[k] = S[k] !== undefined ? S[k] : (Array.isArray(S[k]) ? [] : {});
        });
        shared.metasConfig = METAS_CONFIG || {};
        shared.metasEquipe = METAS_EQUIPE || {};
        shared.teamConfig = TEAM_CONFIG || {};
        // FIX v22h: snapshot das chaves localStorage isoladas (radar, fluxo, dre, integrations, ma_*, gi_*)
        shared._lsKeys = {};
        SYNC_LS_KEYS.forEach(function(lsKey){
          try { var v = localStorage.getItem(lsKey); if (v != null) shared._lsKeys[lsKey] = v; } catch(e){(window.PSM&&PSM.log?PSM.log.error("legacy:27.7","caught",e):console.error("[PSM]",e));}
        });
        shared._lastUpdate = Date.now();
        shared._updatedBy = S.user ? S.user.id : 'unknown';
        // FIX v22i: try/catch envolve set() — sync exception nao mais prende _fbSyncing
        (_psmFbBlocked('shared.set') ? Promise.resolve({frozen:true}) : _fbDb.ref('shared').set(shared)).then(function() {
          _fbReleaseSyncing();
          _fbLastPush = Date.now();
          if (typeof window.psmFbReportSuccess === 'function') window.psmFbReportSuccess();
          console.log('[PSM-Sync] Push OK' + (immediate?' (immediate)':''));
        }).catch(function(e) {
          _fbReleaseSyncing('promise rejected');
          if (typeof window.psmFbReportFail === 'function') window.psmFbReportFail();
          console.error('[PSM-Sync] Push error:', e);
        });
      } catch(syncErr){
        _fbReleaseSyncing('sync exception');
        if (typeof window.psmFbReportFail === 'function') window.psmFbReportFail();
        console.error('[PSM-Sync] Push sync error:', syncErr);
      }
    };
    _fbPendingRun = run;
    // FIX v22g: debounce reduzido de 5000ms -> 1500ms (perde menos edicoes em crash)
    if (immediate) { run(); }
    else { _fbDebounceTimer = setTimeout(run, 1500); }
  }
  
  // FIX v22g: flush sincrono no fechamento da aba/navegacao
  // Garante que push pendente vai para Firebase mesmo se aba fecha antes do debounce
  (function setupBeforeUnloadFlush(){
    function flushPending(){
      if (_fbPendingRun) {
        try {
          if (_fbDebounceTimer) { clearTimeout(_fbDebounceTimer); _fbDebounceTimer = null; }
          var fn = _fbPendingRun;
          _fbPendingRun = null;
          fn(); // dispara push imediato (Firebase set retorna Promise mas browser tenta concluir)
          console.log('[PSM-Sync] Flush no unload disparado');
        } catch(e) { console.warn('[PSM-Sync] Flush erro:', e); }
      }
    }
    window.addEventListener('beforeunload', flushPending);
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'hidden') flushPending();
    });
  })();
  
  function fbSetupConfig() {
    var current = fbGetConfig();
    var html = '<div id="fb_setup_overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)this.remove()">'
      + '<div style="background:#1e293b;border-radius:16px;padding:24px;max-width:520px;width:100%;border:1px solid #334155">'
      + '<div style="font-size:18px;font-weight:700;color:#f8fafc;margin-bottom:6px">\uD83D\uDD25 Configurar Firebase (Sync em Tempo Real)</div>'
      + '<div style="font-size:12px;color:#94a3b8;margin-bottom:16px;line-height:1.5">Cole a configura\u00e7\u00e3o do Firebase (JSON) para ativar a sincroniza\u00e7\u00e3o entre todos os usu\u00e1rios. Crie um projeto gratuito em <a href="https://console.firebase.google.com" target="_blank" style="color:#6366f1">console.firebase.google.com</a>.</div>'
      + '<textarea id="fb_cfg_input" rows="10" style="width:100%;background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;resize:vertical" placeholder=\'{"apiKey":"AIza...","authDomain":"xxx.firebaseapp.com","databaseURL":"https://xxx-default-rtdb.firebaseio.com","projectId":"xxx","storageBucket":"xxx.appspot.com","messagingSenderId":"123","appId":"1:123:web:abc"}\'>'
      + (current ? JSON.stringify(current, null, 2) : '')
      + '</textarea>'
      + '<div style="display:flex;gap:8px;margin-top:12px">'
      + '<button onclick="var t=document.getElementById(\'fb_cfg_input\').value.trim();if(!t){toast(\'Cole o JSON\',\'warn\');return;}try{var c=JSON.parse(t);if(!c.databaseURL){toast(\'Falta databaseURL\',\'warn\');return;}fbSaveConfig(c);fbInit();document.getElementById(\'fb_setup_overlay\').remove();toast(\'\u2705 Firebase configurado!\',\'ok\');render();}catch(e){toast(\'JSON inv\u00e1lido: \'+e.message,\'warn\');}" style="flex:1;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">\u2714 Salvar e Conectar</button>'
      + '<button onclick="fbSaveConfig(null);_fbReady=false;if(_fbApp){try{_fbDb.ref(\'shared\').off();_fbApp.delete();}catch(e){(window.PSM&&PSM.log?PSM.log.error("legacy:27.7","caught",e):console.error("[PSM]",e));}_fbApp=null;_fbDb=null;}document.getElementById(\'fb_setup_overlay\').remove();toast(\'Firebase desconectado\',\'ok\');render()" style="padding:10px 16px;background:#dc262620;color:#fca5a5;border:1px solid #dc262640;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px">\u2715 Desconectar</button>'
      + '</div>'
      + '<div style="margin-top:12px;font-size:11px;color:#64748b;line-height:1.5">'
      + '<strong>Como criar:</strong> Firebase Console \u2192 Novo Projeto \u2192 Realtime Database \u2192 Criar \u2192 Modo de teste \u2192 Copiar config do SDK Web'
      + '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }
  // ─── END extracted code ───────────────────────────────────────────────────

  // Expose API publica em window (compat retroativa)
  global.fbGetConfig   = fbGetConfig;
  global.fbSaveConfig  = fbSaveConfig;
  global.fbInit        = fbInit;
  global.fbPushState   = fbPushState;
  global.fbSetupConfig = fbSetupConfig;

  // Expose state privado para debug (read-only intencional)
  global.PSM = global.PSM || {};
  global.PSM.firebase = {
    isReady: function(){ return _fbReady; },
    isSyncing: function(){ return _fbSyncing; },
    getApp: function(){ return _fbApp; },
    getDb: function(){ return _fbDb; },
    VERSION: '72.0.0'
  };

  if (global.PSM && global.PSM.log) {
    global.PSM.log.debug('firebase', 'psm-firebase.js v72.0.0 carregado');
  }
})(typeof window !== 'undefined' ? window : this);
