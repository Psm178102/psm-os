// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-lgtv-keepalive.js v74.5.0
// Anti-sleep ULTRA AGRESSIVO especifico para LG webOS / SmartTV.
//
// Problema: TV LG webOS 22+ (Chromium) tem Wake Lock API funcional, mas o
// screensaver/sleep da TV opera em camada de FIRMWARE que ignora Wake Lock.
// Apos ~5-15min a tela apaga mesmo com Wake Lock ativo.
//
// Solucao: combina 6 estrategias que o firmware LG conta como "atividade real":
//   1. Video em loop visivel (LG conta media playback como ativo)
//   2. AudioContext rodando silencioso (oscillator volume 0)
//   3. Wake Lock API com retry agressivo no visibilitychange
//   4. Pixel canvas com cor mudando a cada 200ms (force repaint)
//   5. Heartbeat de rede a cada 30s (fetch /version.json)
//   6. Eventos sinteticos + window.scroll micro (1px up/down)
//
// Detecção automatica: ativa SO em LG webOS / SmartTV. Em browsers normais
// fica idle (zero overhead).
//
// API publica:
//   psmLgTv.start()           - forca ativacao manual
//   psmLgTv.stop()            - desativa tudo
//   psmLgTv.status()          - {isLG, active, uptime, techniques}
//   psmLgTv.isLG()            - bool
//
// Indicator visual: pequeno LED no canto inferior esquerdo, verde/vermelho.
// Toggle via psmLgTv.showIndicator(true|false).
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  function _log(level, msg, data){
    if (global.PSM && global.PSM.log) return global.PSM.log[level]('lgtv', msg, data);
  }

  // ─── Detector LG webOS ────────────────────────────────────────────────────
  function isLG(){
    var ua = (global.navigator && global.navigator.userAgent) || '';
    return /Web0S|webOS|SmartTV|LG Browser|NetCast|LGE/i.test(ua)
        || /(LG|webOS)/i.test(global.navigator && global.navigator.vendor || '');
  }

  // Permite forcar via URL ?lgtv=1 ou localStorage psm_force_lgtv
  function isLGOrForced(){
    if (isLG()) return true;
    try {
      if (global.location && /[?&]lgtv=1/.test(global.location.search)) return true;
      if (global.localStorage && localStorage.getItem('psm_force_lgtv') === '1') return true;
    } catch(_){}
    return false;
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  var _state = {
    active: false,
    startedAt: 0,
    techniques: {
      video: false, audio: false, wakeLock: false,
      canvas: false, heartbeat: false, events: false
    },
    handles: {} // referências para cleanup
  };

  // ─── Tecnica 1: Video em loop visivel ──────────────────────────────────────
  // Video MP4 de 1s em loop, posicionado canto inferior direito com tamanho
  // suficiente para o firmware LG contar como "media ativa".
  var KEEPALIVE_VIDEO_SRC = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAACphtZGF0AAACrwYF//+r3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1NSByMjkxNyAwYTg0ZDk4IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxOCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTMgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yOC4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAEmWIhAAn//8aLxn3S3Zr6d2EAAADAAE5dABHnYBdwACgAAD//gIwABQBACAJCKZAAUAX8AgCQAAFWEVhEIRCEIRCERaLCAEAAGYoAKCnA==';

  function _startVideo(){
    if (_state.handles.video) return;
    var v = global.document.createElement('video');
    v.id = 'psm-lgtv-video';
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('playsinline','');
    v.setAttribute('webkit-playsinline','');
    v.setAttribute('disableremoteplayback','');
    v.src = KEEPALIVE_VIDEO_SRC;
    // v75.5: aumentei pra 80x60 (era 4x6). Firmware LG ignora videos muito pequenos.
    // Posicionado fora da area visivel do conteudo TV (atras do footer) mas com tamanho
    // suficiente pra contar como "media playback ativo" no firmware.
    v.style.cssText = 'position:fixed;bottom:0;left:0;width:80px;height:60px;z-index:99996;pointer-events:none;opacity:0.01;object-fit:cover';
    global.document.body.appendChild(v);
    var playPromise = v.play();
    if (playPromise && playPromise.catch) playPromise.catch(function(e){ _log('warn','video play falhou',e); });
    _state.handles.video = v;
    _state.techniques.video = true;
    _log('debug','video iniciado (80x60)');
  }
  function _stopVideo(){
    if (!_state.handles.video) return;
    try { _state.handles.video.pause(); _state.handles.video.remove(); } catch(_){}
    _state.handles.video = null;
    _state.techniques.video = false;
  }

  // ─── Tecnica 2: AudioContext silencioso rodando ───────────────────────────
  function _startAudio(){
    if (_state.handles.audio) return;
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      gain.gain.value = 0; // volume zero = silencioso mas ATIVO
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      _state.handles.audio = { ctx: ctx, osc: osc, gain: gain };
      _state.techniques.audio = true;
      _log('debug','audio context iniciado (silencioso)');
    } catch(e){ _log('warn','audio falhou',e); }
  }
  function _stopAudio(){
    if (!_state.handles.audio) return;
    try {
      _state.handles.audio.osc.stop();
      _state.handles.audio.ctx.close();
    } catch(_){}
    _state.handles.audio = null;
    _state.techniques.audio = false;
  }

  // ─── Tecnica 3: Wake Lock API com retry ──────────────────────────────────
  function _startWakeLock(){
    if (_state.handles.wakeLockRetry) return;
    var _wl = null;
    async function _request(){
      if (!('wakeLock' in global.navigator)) return;
      try {
        _wl = await global.navigator.wakeLock.request('screen');
        _wl.addEventListener('release', function(){
          _wl = null;
          // Re-tenta apos 1s se ainda estamos ativos
          if (_state.active) setTimeout(_request, 1000);
        });
        _state.techniques.wakeLock = true;
        _log('debug','wake lock ativo');
      } catch(e){
        _state.techniques.wakeLock = false;
        _log('warn','wake lock falhou — vai re-tentar', e.message);
      }
    }
    _request();
    // Re-tenta sempre que pagina voltar a ficar visivel
    var _visHandler = function(){
      if (global.document.visibilityState === 'visible' && _state.active && !_wl) _request();
    };
    global.document.addEventListener('visibilitychange', _visHandler);
    // Retry periodico a cada 30s mesmo sem visibilitychange
    var _retryInterval = setInterval(function(){
      if (_state.active && !_wl) _request();
    }, 30000);
    _state.handles.wakeLockRetry = { release: function(){
      global.document.removeEventListener('visibilitychange', _visHandler);
      clearInterval(_retryInterval);
      if (_wl) try { _wl.release(); } catch(_){}
    }};
  }
  function _stopWakeLock(){
    if (!_state.handles.wakeLockRetry) return;
    _state.handles.wakeLockRetry.release();
    _state.handles.wakeLockRetry = null;
    _state.techniques.wakeLock = false;
  }

  // ─── Tecnica 4: Pixel canvas com cor mudando ─────────────────────────────
  // Canvas 2x2 fora da tela mas com repaint a cada 200ms. Forca o GPU/render
  // pipeline a manter a tela ativa.
  function _startCanvas(){
    if (_state.handles.canvas) return;
    var c = global.document.createElement('canvas');
    c.id = 'psm-lgtv-canvas';
    c.width = 2; c.height = 2;
    c.style.cssText = 'position:fixed;bottom:0;left:8px;width:2px;height:2px;z-index:99995;pointer-events:none;opacity:0.5';
    global.document.body.appendChild(c);
    var ctx = c.getContext('2d');
    var hue = 0;
    var iv = setInterval(function(){
      if (!_state.active) return;
      hue = (hue + 30) % 360;
      ctx.fillStyle = 'hsl(' + hue + ',50%,50%)';
      ctx.fillRect(0,0,2,2);
    }, 200);
    _state.handles.canvas = { el: c, iv: iv };
    _state.techniques.canvas = true;
    _log('debug','canvas pixel iniciado');
  }
  function _stopCanvas(){
    if (!_state.handles.canvas) return;
    clearInterval(_state.handles.canvas.iv);
    try { _state.handles.canvas.el.remove(); } catch(_){}
    _state.handles.canvas = null;
    _state.techniques.canvas = false;
  }

  // ─── Tecnica 5: Heartbeat de rede ────────────────────────────────────────
  // GET /version.json a cada 30s. LG webOS conta network activity como vida.
  function _startHeartbeat(){
    if (_state.handles.heartbeat) return;
    var iv = setInterval(function(){
      if (!_state.active) return;
      try {
        global.fetch('/version.json?_lgtv=' + Date.now(), { cache: 'no-store' }).catch(function(){});
      } catch(_){}
    }, 30000);
    _state.handles.heartbeat = iv;
    _state.techniques.heartbeat = true;
    _log('debug','heartbeat de rede a cada 30s');
  }
  function _stopHeartbeat(){
    if (!_state.handles.heartbeat) return;
    clearInterval(_state.handles.heartbeat);
    _state.handles.heartbeat = null;
    _state.techniques.heartbeat = false;
  }

  // ─── Tecnica 6: Eventos + scroll micro (REFORCADO v75.5) ────────────────
  function _startEvents(){
    if (_state.handles.events) return;
    var iv = setInterval(function(){
      if (!_state.active) return;
      try {
        // Scroll micro
        global.window.scrollBy(0, 1);
        global.window.scrollBy(0, -1);
        // MouseEvent REAL com clientX/Y (LG aceita melhor que Event generico)
        var mx = Math.random() * global.innerWidth;
        var my = Math.random() * global.innerHeight;
        global.document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, view: global,
          clientX: mx, clientY: my, screenX: mx, screenY: my
        }));
        // KeyboardEvent
        global.document.dispatchEvent(new KeyboardEvent('keydown', {key:'Shift', code:'ShiftLeft', bubbles:true}));
        global.document.dispatchEvent(new KeyboardEvent('keyup', {key:'Shift', code:'ShiftLeft', bubbles:true}));
        // Focus na janela
        try { global.window.focus(); } catch(_){}
      } catch(_){}
    }, 30000); // v75.5: 30s (era 60s)
    _state.handles.events = iv;
    _state.techniques.events = true;
    _log('debug','eventos sinteticos a cada 30s (reforcado)');
  }
  function _stopEvents(){
    if (!_state.handles.events) return;
    clearInterval(_state.handles.events);
    _state.handles.events = null;
    _state.techniques.events = false;
  }

  // ─── Indicator visual (LED) ──────────────────────────────────────────────
  var _indicator = null;
  function _showIndicator(show){
    if (show && !_indicator) {
      _indicator = global.document.createElement('div');
      _indicator.id = 'psm-lgtv-indicator';
      _indicator.title = 'LG TV anti-sleep ativo';
      _indicator.style.cssText = 'position:fixed;bottom:6px;left:14px;width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;z-index:99997;pointer-events:none;animation:psmLgPulse 2s ease-in-out infinite';
      // CSS keyframes inline
      var st = global.document.getElementById('psm-lgtv-css');
      if (!st) {
        st = global.document.createElement('style');
        st.id = 'psm-lgtv-css';
        st.textContent = '@keyframes psmLgPulse{0%,100%{opacity:0.5}50%{opacity:1}}';
        global.document.head.appendChild(st);
      }
      global.document.body.appendChild(_indicator);
    } else if (!show && _indicator) {
      try { _indicator.remove(); } catch(_){}
      _indicator = null;
    }
  }

  // ─── Start / Stop combinados ─────────────────────────────────────────────
  function start(){
    if (_state.active) return false;
    _state.active = true;
    _state.startedAt = Date.now();
    _startVideo();
    _startAudio();
    _startWakeLock();
    _startCanvas();
    _startHeartbeat();
    _startEvents();
    _showIndicator(true);
    _log('info','LG TV keepalive ATIVADO (6 tecnicas)');
    return true;
  }

  function stop(){
    if (!_state.active) return false;
    _state.active = false;
    _stopVideo(); _stopAudio(); _stopWakeLock();
    _stopCanvas(); _stopHeartbeat(); _stopEvents();
    _showIndicator(false);
    _log('info','LG TV keepalive desativado');
    return true;
  }

  function status(){
    return {
      isLG: isLG(),
      forced: isLGOrForced() && !isLG(),
      active: _state.active,
      uptime: _state.active ? Math.round((Date.now() - _state.startedAt) / 1000) : 0,
      uptimeReadable: _state.active ? _readableTime((Date.now() - _state.startedAt)) : '-',
      techniques: Object.assign({}, _state.techniques),
      userAgent: (global.navigator && global.navigator.userAgent) || ''
    };
  }

  function _readableTime(ms){
    var s = Math.floor(ms/1000);
    var h = Math.floor(s/3600); s %= 3600;
    var m = Math.floor(s/60); s %= 60;
    return (h>0?h+'h ':'') + (m>0?m+'m ':'') + s+'s';
  }

  // Auto-ativacao se LG detectado (ou ?lgtv=1 forcado)
  function _autoStart(){
    if (isLGOrForced()) {
      start();
      // Re-tenta video play quando o usuario interage (alguns browsers exigem gesture)
      var _resumeOnInteract = function(){
        if (_state.handles.video && _state.handles.video.paused) {
          try { _state.handles.video.play(); } catch(_){}
        }
        if (_state.handles.audio && _state.handles.audio.ctx && _state.handles.audio.ctx.state === 'suspended') {
          try { _state.handles.audio.ctx.resume(); } catch(_){}
        }
      };
      global.document.addEventListener('click', _resumeOnInteract);
      global.document.addEventListener('keydown', _resumeOnInteract);
      global.document.addEventListener('touchstart', _resumeOnInteract);
    }
  }

  // ─── Expose ──────────────────────────────────────────────────────────────
  var api = {
    isLG: isLG,
    isLGOrForced: isLGOrForced,
    start: start,
    stop: stop,
    status: status,
    showIndicator: _showIndicator,
    VERSION: '74.5.0'
  };
  global.psmLgTv = api;
  global.PSM = global.PSM || {};
  global.PSM.lgTv = api;

  // Auto-start no DOMContentLoaded
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', _autoStart);
  } else {
    _autoStart();
  }

  _log('debug', 'psm-lgtv-keepalive.js v74.5.0 carregado (isLG: ' + isLG() + ')');
})(typeof window !== 'undefined' ? window : this);
