/* ═══════════════════════════════════════════════════════════════════════════
 * PSM BACKUP v27 (2026-04-21)
 * Snapshot diario de estado (Firebase + Supabase + localStorage) -> GitHub Releases.
 * Retencao: 30 diarios + 12 mensais. Restore via tag.
 * API: window.psmBackup.run() / list() / restore(id) / status()
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(global){
'use strict';

var CFG = {
  githubOwner: 'Psm178102',
  githubRepo:  'psm-os-backups',
  tokenKey:    'PSM_GITHUB_PAT',        // token no localStorage (seguro: device-local)
  intervalMs:  24 * 60 * 60 * 1000,     // 24h
  retentionDaily: 30,
  retentionMonthly: 12,
  maxPayloadMb: 25
};

function _log(){ try{ console.log.apply(console, ['[psm-backup]'].concat([].slice.call(arguments))); }catch(_){} }
function _err(msg, e){ try{ console.warn('[psm-backup]', msg, e); if(global.PSMSentry) global.PSMSentry.capture(e||msg); }catch(_){} }

var _status = { last:null, running:false, err:null, count:0 };
var _listeners = [];
function _emit(){ _listeners.forEach(function(cb){ try{ cb(_status); }catch(_){} }); }

function _token(){ try { return localStorage.getItem(CFG.tokenKey) || ''; } catch(_) { return ''; } }
function setToken(tok){ try { localStorage.setItem(CFG.tokenKey, tok); } catch(_){} }

// ─── SNAPSHOT COLLECTORS ───────────────────────────────────────────────────
async function _dumpFirebase(){
  try {
    var db = global.firebase && global.firebase.database ? global.firebase.database() : null;
    if(!db) return { err:'no-firebase' };
    var snap = await db.ref('/').once('value');
    return snap.val() || {};
  } catch(e){ _err('fb dump', e); return { err: e.message }; }
}

async function _dumpSupabase(){
  try {
    var sb = global.supabase || (global.getSupabase && global.getSupabase());
    if(!sb) return { err:'no-supabase' };
    var tables = ['atendimentos','leads','clientes','imoveis','tarefas','notas','historico','metas','usuarios'];
    var out = {};
    for(var i=0; i<tables.length; i++){
      try {
        var r = await sb.from(tables[i]).select('*').limit(10000);
        out[tables[i]] = r.data || [];
      } catch(e){ out[tables[i]] = { err: e.message }; }
    }
    return out;
  } catch(e){ _err('sb dump', e); return { err: e.message }; }
}

function _dumpLocalStorage(){
  var out = {};
  try {
    for(var i=0; i<localStorage.length; i++){
      var k = localStorage.key(i);
      if(!k) continue;
      if(/token|pat|secret|password/i.test(k)) continue; // NUNCA backup de tokens
      out[k] = localStorage.getItem(k);
    }
  } catch(_){}
  return out;
}

async function _dumpOfflineQueue(){
  try {
    if(!global.psmOffline) return null;
    return {
      status: global.psmOffline.status(),
      conflicts: await global.psmOffline.conflicts()
    };
  } catch(e){ return { err: e.message }; }
}

async function _buildSnapshot(){
  var now = new Date();
  var tag = 'backup-' + now.toISOString().slice(0,10).replace(/-/g,'') + '-' + now.getTime();
  var parts = await Promise.all([_dumpFirebase(), _dumpSupabase(), _dumpOfflineQueue()]);
  var snap = {
    tag: tag,
    ts: now.toISOString(),
    version: (global.PSM_VERSION || '27.0'),
    firebase: parts[0],
    supabase: parts[1],
    offline: parts[2],
    localStorage: _dumpLocalStorage(),
    device: (global.psmNative && global.psmNative.info && global.psmNative.info()) || { platform:'web' }
  };
  return { tag: tag, json: JSON.stringify(snap) };
}

// ─── GITHUB RELEASES UPLOAD ────────────────────────────────────────────────
async function _ghFetch(path, init){
  var tok = _token();
  if(!tok) throw new Error('Sem GitHub PAT. Rode psmBackup.setToken(tok).');
  init = init || {};
  init.headers = Object.assign({
    'Authorization': 'Bearer ' + tok,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }, init.headers || {});
  var url = 'https://api.github.com' + path;
  var r = await fetch(url, init);
  if(!r.ok) throw new Error('GH ' + r.status + ': ' + await r.text());
  return r;
}

async function _ghCreateRelease(tag, body){
  var r = await _ghFetch('/repos/' + CFG.githubOwner + '/' + CFG.githubRepo + '/releases', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ tag_name: tag, name: tag, body: body, draft: false, prerelease: false })
  });
  return r.json();
}

async function _ghUploadAsset(uploadUrl, name, contentType, data){
  uploadUrl = uploadUrl.replace('{?name,label}', '?name=' + encodeURIComponent(name));
  var r = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + _token(),
      'Content-Type': contentType
    },
    body: data
  });
  if(!r.ok) throw new Error('Upload ' + r.status + ': ' + await r.text());
  return r.json();
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────
async function run(){
  if(_status.running) { _log('backup ja em execucao'); return _status; }
  _status.running = true; _status.err = null; _emit();
  try {
    var s = await _buildSnapshot();
    var sizeMb = (new Blob([s.json]).size / 1048576).toFixed(2);
    if(sizeMb > CFG.maxPayloadMb) throw new Error('Snapshot muito grande: ' + sizeMb + 'MB');

    var release = await _ghCreateRelease(s.tag, 'PSM OS backup ' + s.tag + '\nSize: ' + sizeMb + 'MB');
    var blob = new Blob([s.json], { type:'application/json' });
    await _ghUploadAsset(release.upload_url, s.tag + '.json', 'application/json', blob);

    _status.last = { tag: s.tag, ts: new Date().toISOString(), sizeMb: sizeMb };
    _status.count++;
    _log('backup OK', _status.last);

    await _rotate();
    return _status;
  } catch(e){
    _status.err = e.message;
    _err('run', e);
    throw e;
  } finally {
    _status.running = false;
    _emit();
  }
}

async function list(){
  var r = await _ghFetch('/repos/' + CFG.githubOwner + '/' + CFG.githubRepo + '/releases?per_page=100');
  var arr = await r.json();
  return arr.map(function(rel){
    return {
      tag: rel.tag_name,
      ts: rel.created_at,
      id: rel.id,
      assetUrl: (rel.assets[0] && rel.assets[0].browser_download_url) || null,
      sizeMb: rel.assets[0] ? (rel.assets[0].size/1048576).toFixed(2) : null
    };
  });
}

async function restore(tag){
  var releases = await list();
  var rel = releases.find(function(r){ return r.tag === tag || String(r.id) === String(tag); });
  if(!rel || !rel.assetUrl) throw new Error('Backup ' + tag + ' nao encontrado');
  var r = await fetch(rel.assetUrl, { headers: { 'Authorization': 'Bearer ' + _token() } });
  if(!r.ok) throw new Error('Download falhou: ' + r.status);
  var snap = await r.json();
  _log('restore snapshot carregado', snap.tag, 'ts:', snap.ts);
  return snap; // decisao de aplicar ao estado local fica na UI (confirmacao do usuario)
}

async function _rotate(){
  try {
    var all = await list();
    // ordena desc
    all.sort(function(a,b){ return new Date(b.ts) - new Date(a.ts); });
    // agrupa: mantem ultimos N diarios + 12 mensais (1 por mes)
    var keep = new Set();
    all.slice(0, CFG.retentionDaily).forEach(function(r){ keep.add(r.id); });
    var seenMonth = {};
    all.forEach(function(r){
      var m = r.ts.slice(0,7);
      if(!seenMonth[m] && Object.keys(seenMonth).length < CFG.retentionMonthly){
        seenMonth[m] = true; keep.add(r.id);
      }
    });
    var toDelete = all.filter(function(r){ return !keep.has(r.id); });
    for(var i=0; i<toDelete.length; i++){
      try { await _ghFetch('/repos/' + CFG.githubOwner + '/' + CFG.githubRepo + '/releases/' + toDelete[i].id, { method:'DELETE' }); }
      catch(e){ _err('rotate del', e); }
    }
    if(toDelete.length) _log('rotate: removidos ' + toDelete.length);
  } catch(e){ _err('rotate', e); }
}

function status(){ return Object.assign({}, _status); }
function onChange(cb){ if(typeof cb === 'function') _listeners.push(cb); }

// ─── SCHEDULER ─────────────────────────────────────────────────────────────
function _schedule(){
  try {
    // nativo: BackgroundRunner (iOS BGAppRefresh / Android WorkManager)
    if(global.psmNative && global.psmNative.isNative){
      global.psmNative.registerBackgroundSync('psmBackup', 1440);
    }
    // web: interval + primeira execucao 30s apos boot (se online + com token)
    if(!global._psmBackupTimer){
      global._psmBackupTimer = setInterval(function(){
        if(navigator.onLine && _token()) run().catch(function(){});
      }, CFG.intervalMs);
    }
    setTimeout(function(){
      if(navigator.onLine && _token() && !_status.last) run().catch(function(){});
    }, 30000);
  } catch(e){ _err('schedule', e); }
}

_schedule();

global.psmBackup = {
  run: run,
  list: list,
  restore: restore,
  status: status,
  setToken: setToken,
  onChange: onChange,
  _version: '27.0'
};

_log('pronto');

})(typeof window !== 'undefined' ? window : globalThis);
