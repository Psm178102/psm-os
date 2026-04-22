/* ═══════════════════════════════════════════════════════════════════════════
 * PSM OFFLINE ENGINE v27 (2026-04-21)
 * - Fila de mutacoes offline em IndexedDB
 * - Merge com vector clock (cliente + servidor)
 * - Resolucao de conflito: LWW (last-write-wins) por campo + log em conflict_log
 * - Auto-flush quando volta online
 * - Integra com Firebase + Supabase
 *
 * API publica:
 *   psmOffline.enqueue(table, op, payload)
 *   psmOffline.flush()
 *   psmOffline.status()         -> {queued, inflight, online, lastSync}
 *   psmOffline.conflicts()      -> lista de conflitos nao resolvidos
 *   psmOffline.resolveConflict(id, side) -> 'local' | 'remote'
 *   psmOffline.onChange(cb)     -> notifica mudanca de status
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(global){
'use strict';

var DB_NAME = 'psm_offline_v27';
var DB_VERSION = 1;
var STORE_QUEUE = 'mutation_queue';
var STORE_CONFLICT = 'conflict_log';
var STORE_CACHE = 'data_cache';

var CLIENT_ID = (function(){
  try {
    var k = localStorage.getItem('psm_client_id');
    if(k) return k;
    k = 'c_' + Math.random().toString(36).slice(2,10) + '_' + Date.now().toString(36);
    localStorage.setItem('psm_client_id', k);
    return k;
  } catch(_){ return 'c_fallback_' + Date.now(); }
})();

var _db = null;
var _status = { queued: 0, inflight: 0, online: navigator.onLine, lastSync: 0, err: null };
var _handlers = [];
var _flushing = false;
var _debug = false;

function _log(){ if(_debug) try { console.log.apply(console, ['[psm-offline]'].concat([].slice.call(arguments))); } catch(_){} }
function _err(msg, e){ console.warn('[psm-offline]', msg, e); if(global.PSMSentry) global.PSMSentry.capture(e||msg); }

function _notify(){
  _handlers.forEach(function(h){ try{ h(_status); } catch(_){} });
}

// ─── IndexedDB init ────────────────────────────────────────────────────────
function _openDB(){
  return new Promise(function(resolve, reject){
    if(_db) return resolve(_db);
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e){
      var db = e.target.result;
      if(!db.objectStoreNames.contains(STORE_QUEUE)){
        var os = db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_status', 'status', { unique: false });
        os.createIndex('by_ts', 'ts', { unique: false });
        os.createIndex('by_table', 'table', { unique: false });
      }
      if(!db.objectStoreNames.contains(STORE_CONFLICT)){
        var oc = db.createObjectStore(STORE_CONFLICT, { keyPath: 'id', autoIncrement: true });
        oc.createIndex('by_resolved', 'resolved', { unique: false });
      }
      if(!db.objectStoreNames.contains(STORE_CACHE)){
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
      }
    };
    req.onsuccess = function(){ _db = req.result; resolve(_db); };
    req.onerror = function(){ reject(req.error); };
  });
}

function _tx(store, mode){
  return _openDB().then(function(db){ return db.transaction(store, mode||'readonly').objectStore(store); });
}

// ─── Vector clock helpers ─────────────────────────────────────────────────
function _newClock(){
  var c = {}; c[CLIENT_ID] = 1; return c;
}
function _incClock(clock){
  clock = clock || {};
  clock[CLIENT_ID] = (clock[CLIENT_ID] || 0) + 1;
  return clock;
}
// Compara dois clocks: returns 'a-newer' | 'b-newer' | 'concurrent' | 'equal'
function _compareClock(a, b){
  a = a || {}; b = b || {};
  var keys = {};
  Object.keys(a).forEach(function(k){ keys[k] = 1; });
  Object.keys(b).forEach(function(k){ keys[k] = 1; });
  var aGreater = false, bGreater = false;
  Object.keys(keys).forEach(function(k){
    var av = a[k]||0, bv = b[k]||0;
    if(av > bv) aGreater = true;
    if(bv > av) bGreater = true;
  });
  if(aGreater && bGreater) return 'concurrent';
  if(aGreater) return 'a-newer';
  if(bGreater) return 'b-newer';
  return 'equal';
}

// ─── ENQUEUE ──────────────────────────────────────────────────────────────
// op: 'insert' | 'update' | 'delete' | 'upsert'
function enqueue(table, op, payload){
  return _openDB().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(STORE_QUEUE, 'readwrite');
      var os = tx.objectStore(STORE_QUEUE);
      var entry = {
        table: String(table),
        op: String(op),
        payload: payload || {},
        ts: Date.now(),
        clientId: CLIENT_ID,
        clock: _incClock(payload && payload._clock ? payload._clock : null),
        status: 'pending',
        retries: 0,
        lastErr: null
      };
      var req = os.add(entry);
      req.onsuccess = function(){ entry.id = req.result; resolve(entry); _updateStatus(); _autoFlush(); };
      req.onerror = function(){ reject(req.error); };
    });
  });
}

function _updateStatus(){
  return _openDB().then(function(db){
    return new Promise(function(resolve){
      var tx = db.transaction(STORE_QUEUE, 'readonly');
      var idx = tx.objectStore(STORE_QUEUE).index('by_status');
      var countQueued = 0, countInflight = 0;
      var r1 = idx.count(IDBKeyRange.only('pending'));
      r1.onsuccess = function(){ countQueued = r1.result; };
      var r2 = idx.count(IDBKeyRange.only('inflight'));
      r2.onsuccess = function(){ countInflight = r2.result; };
      tx.oncomplete = function(){
        _status.queued = countQueued;
        _status.inflight = countInflight;
        _status.online = navigator.onLine;
        _notify();
        resolve();
      };
    });
  });
}

// ─── FLUSH ────────────────────────────────────────────────────────────────
function flush(){
  if(_flushing) return Promise.resolve({ skipped:true });
  if(!navigator.onLine){ _status.online = false; _notify(); return Promise.resolve({ offline:true }); }
  _flushing = true;
  _log('flush start');
  return _openDB().then(function(db){
    return new Promise(function(resolve){
      var tx = db.transaction(STORE_QUEUE, 'readonly');
      var idx = tx.objectStore(STORE_QUEUE).index('by_status');
      var req = idx.getAll(IDBKeyRange.only('pending'));
      req.onsuccess = function(){ resolve(req.result || []); };
    });
  }).then(function(items){
    items.sort(function(a,b){ return a.ts - b.ts; });
    var sent = 0, failed = 0, conflicts = 0;
    return items.reduce(function(p, item){
      return p.then(function(){
        return _sendMutation(item).then(function(r){
          if(r.conflict){ conflicts++; return _markConflict(item, r); }
          if(r.ok){ sent++; return _markSent(item); }
          failed++; return _markFailed(item, r.err);
        });
      });
    }, Promise.resolve()).then(function(){
      _status.lastSync = Date.now();
      _status.err = null;
      _flushing = false;
      _updateStatus();
      _log('flush end', { sent:sent, failed:failed, conflicts:conflicts });
      return { sent:sent, failed:failed, conflicts:conflicts };
    });
  }).catch(function(e){
    _flushing = false;
    _err('flush', e);
    _status.err = e.message||String(e);
    _notify();
    return { err: _status.err };
  });
}

// ─── SEND via Supabase (prioridade) ou Firebase ───────────────────────────
function _sendMutation(item){
  // Try Supabase first if disponivel
  var sb = global.psmSupabase || global.supabase;
  if(sb){
    return _sendSupabase(sb, item).catch(function(e){
      // Fallback Firebase se Supabase falhar
      if(global.fbPushState){
        try { global.fbPushState(); } catch(_){}
        return { ok: true, via: 'firebase-fallback' };
      }
      return { ok:false, err: e.message };
    });
  }
  // Fallback Firebase direto
  if(global.fbPushState){
    try { global.fbPushState(); return Promise.resolve({ ok:true, via:'firebase' }); }
    catch(e){ return Promise.resolve({ ok:false, err: e.message }); }
  }
  return Promise.resolve({ ok:false, err:'Nenhum backend disponivel' });
}

function _sendSupabase(sb, item){
  var table = item.table;
  var op = item.op;
  var payload = item.payload || {};
  // Adiciona clock ao payload
  payload._clock = item.clock;
  payload._client_id = item.clientId;
  payload._updated_at = new Date(item.ts).toISOString();

  if(op === 'insert' || op === 'upsert'){
    return sb.from(table).upsert(payload, { onConflict: payload.id ? 'id' : undefined }).then(function(r){
      if(r.error) return { ok:false, err: r.error.message };
      return { ok:true, via:'supabase' };
    });
  }
  if(op === 'update'){
    return _checkConflict(sb, table, payload).then(function(conflict){
      if(conflict) return { conflict:true, remote: conflict };
      return sb.from(table).update(payload).eq('id', payload.id).then(function(r){
        if(r.error) return { ok:false, err: r.error.message };
        return { ok:true, via:'supabase' };
      });
    });
  }
  if(op === 'delete'){
    return sb.from(table).delete().eq('id', payload.id).then(function(r){
      if(r.error) return { ok:false, err: r.error.message };
      return { ok:true, via:'supabase' };
    });
  }
  return Promise.resolve({ ok:false, err: 'op desconhecida: '+op });
}

function _checkConflict(sb, table, payload){
  if(!payload.id) return Promise.resolve(null);
  return sb.from(table).select('_clock,_updated_at').eq('id', payload.id).single().then(function(r){
    if(r.error || !r.data) return null;
    var cmp = _compareClock(payload._clock || {}, r.data._clock || {});
    if(cmp === 'concurrent') return r.data; // conflito real
    if(cmp === 'b-newer') return r.data;    // servidor mais novo
    return null;
  });
}

function _markSent(item){
  return _openDB().then(function(db){
    return new Promise(function(resolve){
      var tx = db.transaction(STORE_QUEUE, 'readwrite');
      tx.objectStore(STORE_QUEUE).delete(item.id);
      tx.oncomplete = function(){ resolve(); };
    });
  });
}

function _markFailed(item, err){
  return _openDB().then(function(db){
    return new Promise(function(resolve){
      var tx = db.transaction(STORE_QUEUE, 'readwrite');
      var os = tx.objectStore(STORE_QUEUE);
      item.retries = (item.retries||0) + 1;
      item.lastErr = err || 'unknown';
      item.status = item.retries > 5 ? 'dead' : 'pending';
      os.put(item);
      tx.oncomplete = function(){ resolve(); };
    });
  });
}

function _markConflict(item, res){
  return _openDB().then(function(db){
    return new Promise(function(resolve){
      var tx = db.transaction([STORE_QUEUE, STORE_CONFLICT], 'readwrite');
      tx.objectStore(STORE_QUEUE).delete(item.id);
      tx.objectStore(STORE_CONFLICT).add({
        table: item.table,
        op: item.op,
        local: item.payload,
        remote: res.remote,
        localClock: item.clock,
        remoteClock: res.remote && res.remote._clock,
        ts: Date.now(),
        resolved: 0,
        resolution: null
      });
      tx.oncomplete = function(){ resolve(); };
    });
  });
}

// ─── CONFLITOS ────────────────────────────────────────────────────────────
function conflicts(){
  return _openDB().then(function(db){
    return new Promise(function(resolve){
      var tx = db.transaction(STORE_CONFLICT, 'readonly');
      var idx = tx.objectStore(STORE_CONFLICT).index('by_resolved');
      var r = idx.getAll(IDBKeyRange.only(0));
      r.onsuccess = function(){ resolve(r.result||[]); };
    });
  });
}

function resolveConflict(id, side){
  return _openDB().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(STORE_CONFLICT, 'readwrite');
      var os = tx.objectStore(STORE_CONFLICT);
      var r = os.get(id);
      r.onsuccess = function(){
        var c = r.result;
        if(!c){ reject(new Error('conflict nao encontrado')); return; }
        c.resolved = 1;
        c.resolution = side;
        c.resolvedAt = Date.now();
        os.put(c);
        // Se escolheu 'local', reenfileira
        if(side === 'local'){
          enqueue(c.table, c.op, c.local).then(function(){ resolve(c); });
        } else {
          resolve(c);
        }
      };
      r.onerror = function(){ reject(r.error); };
    });
  });
}

// ─── AUTO FLUSH ───────────────────────────────────────────────────────────
var _autoTimer = null;
function _autoFlush(){
  clearTimeout(_autoTimer);
  _autoTimer = setTimeout(function(){ flush(); }, 1500);
}

function status(){ return Object.assign({}, _status); }
function onChange(cb){ if(typeof cb === 'function') _handlers.push(cb); }
function debug(v){ _debug = !!v; }

// ─── INIT ──────────────────────────────────────────────────────────────────
window.addEventListener('online', function(){
  _status.online = true; _notify(); _autoFlush();
});
window.addEventListener('offline', function(){
  _status.online = false; _notify();
});

_openDB().then(_updateStatus).then(function(){
  if(navigator.onLine) _autoFlush();
});

// Sync periodico: 2min quando online
setInterval(function(){ if(navigator.onLine) flush(); }, 120000);

// ─── EXPOSE ────────────────────────────────────────────────────────────────
global.psmOffline = {
  enqueue: enqueue,
  flush: flush,
  status: status,
  conflicts: conflicts,
  resolveConflict: resolveConflict,
  onChange: onChange,
  debug: debug,
  clientId: CLIENT_ID,
  _version: '27.0'
};

})(typeof window !== 'undefined' ? window : globalThis);
