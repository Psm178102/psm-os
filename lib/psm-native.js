// lib/psm-native.js — Stub Sprint 0 (2026-04-25)
// Bridge nativo Capacitor (iOS/Android). Em web: no-op gracioso.
(function(){
  'use strict';
  var w = (typeof window !== 'undefined') ? window : self;
  if (w.psmNative) return;

  var isCapacitor = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  var platform = isCapacitor ? (w.Capacitor.getPlatform ? w.Capacitor.getPlatform() : 'native') : 'web';

  function noopReject(name){
    return function(){
      console.debug('[psm-native stub] ' + name + ' nao disponivel em web');
      return Promise.reject(new Error(name + ' requer app nativo'));
    };
  }
  function noopResolve(name, val){
    return function(){
      console.debug('[psm-native stub] ' + name + ' no-op');
      return Promise.resolve(val);
    };
  }

  w.psmNative = {
    isNative: isCapacitor,
    platform: platform,
    requestPushPermission: noopResolve('requestPushPermission', { granted: false }),
    onPushReceived: function(cb){ console.debug('[psm-native stub] onPushReceived registrado (no-op web)'); },
    saveBiometricCreds: noopResolve('saveBiometricCreds', false),
    biometricLogin: noopReject('biometricLogin'),
    isBiometricAvailable: noopResolve('isBiometricAvailable', { available: false }),
    takePhoto: noopReject('takePhoto'),
    getLocation: function(){
      if (!navigator.geolocation) return Promise.reject(new Error('Geolocation nao suportada'));
      return new Promise(function(resolve, reject){
        navigator.geolocation.getCurrentPosition(
          function(p){ resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
          function(e){ reject(e); },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }
  };

  console.log('[psm-native] stub v0.1 carregado, platform=' + platform);
})();
