// lib/psm-backup.js — Stub Sprint 0 (2026-04-25)
// Backup local em localStorage 'psm_backup_snapshot'. GitHub Releases real fica para Sprint 1+.
(function(){
  'use strict';
  var w = (typeof window !== 'undefined') ? window : self;
  if (w.psmBackup) return;

  var SNAPSHOT_KEY = 'psm_backup_snapshot';
  var LAST_KEY = 'psm_backup_last_at';

  function safeSnapshot(){
    try {
      var s = w.S || {};
      var pick = {};
      ['ooDaily','ooMetas','agendaReunioes','timelineItems','arenaRecados','locContratos','crmSearch','organograma','gpTalentos'].forEach(function(k){
        if (s[k] != null) pick[k] = s[k];
      });
      return { ts: Date.now(), data: pick };
    } catch(e) { return null; }
  }

  w.psmBackup = {
    snapshotNow: function(){
      var snap = safeSnapshot();
      if (!snap) return Promise.reject(new Error('snapshot falhou'));
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
        localStorage.setItem(LAST_KEY, String(snap.ts));
        console.debug('[psm-backup stub] snapshot salvo, ' + Object.keys(snap.data).length + ' chaves');
        return Promise.resolve(snap);
      } catch(e){
        return Promise.reject(e);
      }
    },
    lastBackupAt: function(){
      var t = Number(localStorage.getItem(LAST_KEY) || 0);
      return t || null;
    },
    restoreLast: function(){
      try {
        var raw = localStorage.getItem(SNAPSHOT_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch(_) { return null; }
    },
    autoStart: function(intervalMs){
      console.debug('[psm-backup stub] autoStart no-op (Sprint 1)');
    }
  };

  console.log('[psm-backup] stub v0.1 carregado');
})();
