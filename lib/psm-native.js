// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-native.js v69.0.0 (STUB)
// Bridge nativo Capacitor (iOS/Android) com fallback web.
// Stub na v69. Real impl. dependente do build Capacitor.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  if (global.PSM && global.PSM.native) return;
  global.PSM = global.PSM || {};
  var isNative = !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  global.PSM.native = {
    VERSION: '69.0.0-stub',
    isNative: isNative,
    platform: isNative ? (global.Capacitor.getPlatform && global.Capacitor.getPlatform()) : 'web',
    haptic: function(){ /* noop no web */ },
    share: function(opts){
      if (global.navigator && navigator.share) return navigator.share(opts);
      return Promise.reject(new Error('navigator.share indisponivel'));
    }
  };
  if (global.PSM && global.PSM.log) global.PSM.log.debug('native', 'stub carregado (platform: ' + global.PSM.native.platform + ')');
})(typeof window !== 'undefined' ? window : this);
