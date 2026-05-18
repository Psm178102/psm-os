// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-nosleep.js v71.0.0
// NoSleep.js v0.12.0 (MIT — richtr/NoSleep.js) wrappado para PSM.
// Mantem tela acesa em modo TV via Wake Lock API (Chrome/Edge/Safari 16.4+)
// com fallback video MP4 1s base64 (LG webOS, Tizen, Chromecast, mobile).
//
// Extraido inline do index.html (v71 modularization).
// Uso:  var ns = new NoSleep(); ns.enable(); ns.disable(); ns.isEnabled();
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';
  if (global.NoSleep) return; // evita re-inicializar

  // ─── Video base64 1s (44 frames MP4) ───────────────────────────────────────
  var NOSLEEP_VIDEO_SRC = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAACphtZGF0AAACrwYF//+r3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1NSByMjkxNyAwYTg0ZDk4IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxOCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTMgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yOC4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAEmWIhAAn//8aLxn3S3Zr6d2EAAADAAE5dABHnYBdwACgAAD//gIwABQBACAJCKZAAUAX8AgCQAAFWEVhEIRCEIRCERaLCAEAAGYoAKCnA==';

  function NoSleep(){
    this.enabled = false;
    this._video = null;
    this._wakeLock = null;
    this._wakeLockListener = null;
    this._supportsWakeLock = ('wakeLock' in global.navigator);
  }

  NoSleep.prototype.enable = async function(){
    var self = this;
    // 1) Wake Lock API (Chrome 84+, Safari 16.4+)
    if (this._supportsWakeLock){
      try {
        this._wakeLock = await global.navigator.wakeLock.request('screen');
        this._wakeLockListener = function(){
          if (global.document.visibilityState === 'visible' && self.enabled){
            self.enable().catch(function(){});
          }
        };
        global.document.addEventListener('visibilitychange', this._wakeLockListener);
        this.enabled = true;
        return;
      } catch(e){ /* fallback para video */ }
    }
    // 2) Video fallback
    if (!this._video){
      this._video = global.document.createElement('video');
      this._video.setAttribute('muted','');
      this._video.setAttribute('title','No Sleep');
      this._video.setAttribute('playsinline','');
      this._video.muted = true;
      this._video.loop = true;
      this._video.src = NOSLEEP_VIDEO_SRC;
      this._video.style.cssText = 'position:fixed;bottom:60px;right:12px;width:200px;height:120px;opacity:0.06;pointer-events:none;z-index:99998;border:1px solid rgba(212,168,67,0.15);border-radius:4px;object-fit:cover';
      global.document.body.appendChild(this._video);
    }
    await this._video.play();
    this.enabled = true;
  };

  NoSleep.prototype.disable = function(){
    if (this._wakeLock){
      try { this._wakeLock.release(); } catch(e){}
      this._wakeLock = null;
      if (this._wakeLockListener){
        global.document.removeEventListener('visibilitychange', this._wakeLockListener);
        this._wakeLockListener = null;
      }
    }
    if (this._video){
      try { this._video.pause(); } catch(e){}
      try { this._video.remove(); } catch(e){}
      this._video = null;
    }
    this.enabled = false;
  };

  NoSleep.prototype.isEnabled = function(){ return this.enabled; };

  global.NoSleep = NoSleep;
  global.PSM = global.PSM || {};
  global.PSM.nosleep = { Constructor: NoSleep, VERSION: '71.0.0' };
  if (global.PSM.log) global.PSM.log.debug('nosleep', 'psm-nosleep.js v71.0.0 carregado');
})(typeof window !== 'undefined' ? window : this);
