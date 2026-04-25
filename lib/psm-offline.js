// lib/psm-offline.js — Stub Sprint 0 (2026-04-25)
// Engine offline. Fallback: enqueue local em localStorage 'psm_offline_queue'.
(function(){
  'use strict';
  var w = (typeof window !== 'undefined') ? window : self;
  if (w.psmOffline) return;

  var QUEUE_KEY = 'psm_offline_queue';

  function readQueue(){
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch(_) { return []; }
  }
  function writeQueue(q){
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-500))); }
    catch(_) {}
  }

  w.psmOffline = {
    enqueue: function(table, op, data){
      try {
        var q = readQueue();
        q.push({ table: table, op: op, data: data, ts: Date.now() });
        writeQueue(q);
        console.debug('[psm-offline stub] enqueue ' + table + '/' + op + ' (queue size=' + q.length + ')');
      } catch(e){
        console.warn('[psm-offline stub] enqueue falhou:', e);
      }
    },
    flush: function(){
      console.debug('[psm-offline stub] flush no-op (Sprint 1 implementa)');
      return Promise.resolve({ flushed: 0, pending: readQueue().length });
    },
    pendingCount: function(){ return readQueue().length; },
    clear: function(){ writeQueue([]); }
  };

  console.log('[psm-offline] stub v0.1 carregado, fila pendente=' + readQueue().length);
})();
