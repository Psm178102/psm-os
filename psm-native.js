/* ═══════════════════════════════════════════════════════════════════════════
 * PSM NATIVE BRIDGE v27 (2026-04-21)
 * Detecta runtime (web vs Capacitor iOS/Android) e expoe API uniforme.
 * Todos os helpers funcionam em web (fallback) e em app (nativo).
 * Uso: window.psmNative.<metodo>(...).then(...)
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(global){
'use strict';

var Cap = global.Capacitor || null;
var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
var platform = isNative ? Cap.getPlatform() : 'web';

function _log(){ try{ console.log.apply(console, ['[psm-native]'].concat([].slice.call(arguments))); }catch(_){} }
function _err(msg, e){ try{ console.warn('[psm-native]', msg, e); if(global.PSMSentry) global.PSMSentry.capture(e||msg); }catch(_){} }

function _plugin(name){
  if(!isNative) return null;
  try { return Cap.Plugins[name] || null; } catch(_) { return null; }
}

// ─── INFO ──────────────────────────────────────────────────────────────────
function info(){
  return {
    isNative: isNative,
    platform: platform,
    version: '27.0',
    plugins: isNative ? Object.keys(Cap.Plugins||{}) : []
  };
}

// ─── CAMERA ────────────────────────────────────────────────────────────────
async function takePhoto(opts){
  opts = opts || {};
  var Camera = _plugin('Camera');
  if(Camera){
    try {
      var photo = await Camera.getPhoto({
        quality: opts.quality || 80,
        allowEditing: false,
        resultType: 'dataUrl',
        source: opts.source === 'gallery' ? 'PHOTOS' : 'CAMERA',
        saveToGallery: false,
        width: opts.width || 1280,
        height: opts.height || 1280
      });
      return { dataUrl: photo.dataUrl, format: photo.format, source: 'native' };
    } catch(e){ _err('takePhoto native', e); throw e; }
  }
  // Fallback web: input type=file capture=camera
  return new Promise(function(resolve, reject){
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if(opts.source !== 'gallery') inp.capture = 'environment';
    inp.onchange = function(e){
      var f = e.target.files && e.target.files[0];
      if(!f) return reject(new Error('No file'));
      var r = new FileReader();
      r.onload = function(){ resolve({ dataUrl: r.result, format: f.type, source: 'web' }); };
      r.onerror = function(){ reject(r.error); };
      r.readAsDataURL(f);
    };
    inp.click();
  });
}

// ─── GEOLOCATION ───────────────────────────────────────────────────────────
async function getLocation(opts){
  opts = opts || {};
  var Geo = _plugin('Geolocation');
  if(Geo){
    try {
      var pos = await Geo.getCurrentPosition({
        enableHighAccuracy: opts.highAccuracy !== false,
        timeout: opts.timeout || 15000,
        maximumAge: opts.maxAge || 0
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        ts: pos.timestamp,
        source: 'native'
      };
    } catch(e){ _err('getLocation native', e); throw e; }
  }
  // Fallback web
  return new Promise(function(resolve, reject){
    if(!navigator.geolocation) return reject(new Error('Geolocation indisponivel'));
    navigator.geolocation.getCurrentPosition(
      function(pos){ resolve({lat:pos.coords.latitude, lng:pos.coords.longitude, accuracy:pos.coords.accuracy, ts:pos.timestamp, source:'web'}); },
      function(e){ reject(e); },
      { enableHighAccuracy: opts.highAccuracy !== false, timeout: opts.timeout || 15000, maximumAge: opts.maxAge || 0 }
    );
  });
}

// ─── BIOMETRIA ─────────────────────────────────────────────────────────────
async function isBiometricAvailable(){
  var B = _plugin('NativeBiometric');
  if(!B) return { available:false, reason:'web' };
  try {
    var r = await B.isAvailable();
    return { available: r.isAvailable, type: r.biometryType };
  } catch(e){ return { available:false, reason:e.message }; }
}

async function biometricLogin(reason){
  var B = _plugin('NativeBiometric');
  if(!B) throw new Error('Biometria so funciona no app nativo');
  try {
    await B.verifyIdentity({
      reason: reason || 'Acesse sua conta PSM',
      title: 'Login PSM OS',
      subtitle: 'Use sua biometria pra entrar',
      description: 'FaceID / Touch ID / Fingerprint'
    });
    // Recupera credenciais do Keychain/Keystore
    var creds = await B.getCredentials({ server: 'br.com.imobiliariapsm.os' });
    return { email: creds.username, password: creds.password };
  } catch(e){ _err('biometricLogin', e); throw e; }
}

async function saveBiometricCreds(email, password){
  var B = _plugin('NativeBiometric');
  if(!B) throw new Error('Biometria so funciona no app nativo');
  return B.setCredentials({ username: email, password: password, server: 'br.com.imobiliariapsm.os' });
}

async function clearBiometricCreds(){
  var B = _plugin('NativeBiometric');
  if(!B) return;
  try { await B.deleteCredentials({ server: 'br.com.imobiliariapsm.os' }); } catch(_){}
}

// ─── PUSH NOTIFICATIONS ────────────────────────────────────────────────────
var _pushHandlers = [];
async function requestPushPermission(){
  var P = _plugin('PushNotifications');
  if(!P){
    // Fallback web Notification API
    if(!('Notification' in window)) return { granted:false, reason:'no-api' };
    var perm = await Notification.requestPermission();
    return { granted: perm === 'granted', source:'web' };
  }
  try {
    var r = await P.requestPermissions();
    if(r.receive !== 'granted') return { granted:false, reason:r.receive };
    await P.register();
    return { granted:true, source:'native' };
  } catch(e){ _err('push perm', e); return { granted:false, reason:e.message }; }
}

function onPushReceived(cb){
  if(typeof cb !== 'function') return;
  _pushHandlers.push(cb);
  var P = _plugin('PushNotifications');
  if(P){
    try {
      P.addListener('registration', function(token){ _log('FCM token:', token.value); cb({type:'token', token: token.value}); });
      P.addListener('registrationError', function(err){ _err('reg err', err); });
      P.addListener('pushNotificationReceived', function(n){ cb({type:'received', notification:n}); });
      P.addListener('pushNotificationActionPerformed', function(a){ cb({type:'action', action:a}); });
    } catch(e){ _err('push listener', e); }
  }
}

async function showLocalNotification(title, body, opts){
  opts = opts || {};
  var L = _plugin('LocalNotifications');
  if(L){
    try {
      var id = opts.id || Math.floor(Math.random()*100000);
      await L.schedule({
        notifications: [{
          id: id,
          title: title,
          body: body,
          smallIcon: 'ic_stat_notification',
          schedule: opts.schedule || undefined,
          extra: opts.extra || {}
        }]
      });
      return { id: id, source:'native' };
    } catch(e){ _err('local notif native', e); }
  }
  // Fallback web
  if('Notification' in window && Notification.permission === 'granted'){
    try { new Notification(title, { body: body, icon: 'logo-psm-navy.png' }); return { source:'web' }; } catch(_){}
  }
  return { source:'none' };
}

// ─── NETWORK ───────────────────────────────────────────────────────────────
var _netHandlers = [];
async function getNetworkStatus(){
  var N = _plugin('Network');
  if(N){ try { return await N.getStatus(); } catch(_){} }
  return { connected: navigator.onLine, connectionType: navigator.onLine ? 'unknown' : 'none' };
}

function onNetworkChange(cb){
  if(typeof cb !== 'function') return;
  _netHandlers.push(cb);
  var N = _plugin('Network');
  if(N){
    try { N.addListener('networkStatusChange', cb); } catch(_){}
  } else {
    window.addEventListener('online',  function(){ cb({connected:true, connectionType:'unknown'}); });
    window.addEventListener('offline', function(){ cb({connected:false, connectionType:'none'}); });
  }
}

// ─── BACKGROUND TASK (sync periodico) ──────────────────────────────────────
async function registerBackgroundSync(taskName, intervalMin){
  intervalMin = intervalMin || 15;
  var BG = _plugin('BackgroundRunner');
  if(BG){
    try {
      await BG.dispatchEvent({ label: taskName || 'psmSync', event: 'syncNow', details:{} });
      return { ok:true, source:'native', intervalMin: intervalMin };
    } catch(e){ _err('bg native', e); }
  }
  // Fallback web: setInterval (so funciona com aba aberta)
  if(!global._psmBgTimer){
    global._psmBgTimer = setInterval(function(){
      try { if(global.psmOffline && global.psmOffline.flush) global.psmOffline.flush(); } catch(_){}
    }, intervalMin * 60000);
  }
  return { ok:true, source:'web-interval', intervalMin: intervalMin };
}

// ─── PREFERENCES (storage seguro multi-plataforma) ─────────────────────────
async function setPref(key, value){
  var P = _plugin('Preferences');
  if(P){ try { await P.set({ key: key, value: String(value) }); return; } catch(_){} }
  try { localStorage.setItem(key, String(value)); } catch(_){}
}

async function getPref(key){
  var P = _plugin('Preferences');
  if(P){ try { var r = await P.get({ key: key }); return r.value; } catch(_){} }
  try { return localStorage.getItem(key); } catch(_){ return null; }
}

async function removePref(key){
  var P = _plugin('Preferences');
  if(P){ try { await P.remove({ key: key }); return; } catch(_){} }
  try { localStorage.removeItem(key); } catch(_){}
}

// ─── DEVICE INFO ───────────────────────────────────────────────────────────
async function getDeviceInfo(){
  var D = _plugin('Device');
  if(D){ try { return await D.getInfo(); } catch(_){} }
  return {
    platform: 'web',
    operatingSystem: navigator.platform,
    osVersion: navigator.userAgent,
    manufacturer: 'web',
    model: 'web'
  };
}

// ─── STATUS BAR ─────────────────────────────────────────────────────────────
async function setStatusBarStyle(style){
  var SB = _plugin('StatusBar');
  if(!SB) return;
  try {
    await SB.setStyle({ style: style || 'DARK' }); // 'LIGHT' | 'DARK'
    await SB.setBackgroundColor({ color: '#0f172a' });
  } catch(_){}
}

// ─── EXPOSE ────────────────────────────────────────────────────────────────
global.psmNative = {
  info: info,
  isNative: isNative,
  platform: platform,
  takePhoto: takePhoto,
  getLocation: getLocation,
  isBiometricAvailable: isBiometricAvailable,
  biometricLogin: biometricLogin,
  saveBiometricCreds: saveBiometricCreds,
  clearBiometricCreds: clearBiometricCreds,
  requestPushPermission: requestPushPermission,
  onPushReceived: onPushReceived,
  showLocalNotification: showLocalNotification,
  getNetworkStatus: getNetworkStatus,
  onNetworkChange: onNetworkChange,
  registerBackgroundSync: registerBackgroundSync,
  setPref: setPref,
  getPref: getPref,
  removePref: removePref,
  getDeviceInfo: getDeviceInfo,
  setStatusBarStyle: setStatusBarStyle,
  _version: '27.0'
};

_log('pronto', { isNative: isNative, platform: platform });

})(typeof window !== 'undefined' ? window : globalThis);
