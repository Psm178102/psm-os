// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-a11y.js v74.0.0
// Utilidades de acessibilidade — focus trap, screen reader announcements,
// keyboard navigation helpers, Esc-to-close para modais.
//
// API publica (window.PSM.a11y):
//   announce(msg, mode)              - anuncia para screen readers
//                                      mode: 'polite' (default) ou 'assertive'
//   trapFocus(element)               - prende foco dentro do elemento (modais)
//                                      retorna { release() } para soltar
//   restoreFocus()                   - foca o ultimo elemento ativo antes do trap
//   bindEsc(element, handler)        - chama handler() ao pressionar Esc
//                                      retorna funcao unbind()
//   keyboardNav(items, opts)         - arrow up/down navega items[]
//                                      opts: {loop, onSelect, onEnter}
//   prefersReducedMotion()           - bool: respeita pref do user
//   srOnly(text)                     - cria elemento visualmente escondido para SR
//
// Padroes seguidos:
//   - Sempre devolve unbind/release/cleanup para evitar leaks
//   - aria-live regions criadas sob demanda (1 polite + 1 assertive globais)
//   - Focus trap respeita tabindex e ignora elementos invisible
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  function _log(level, msg, data){
    if (global.PSM && global.PSM.log) return global.PSM.log[level]('a11y', msg, data);
  }

  // ─── Screen reader announcements ────────────────────────────────────────────
  var _liveRegions = { polite: null, assertive: null };

  function _ensureLive(mode){
    if (_liveRegions[mode]) return _liveRegions[mode];
    var el = global.document.createElement('div');
    el.setAttribute('aria-live', mode);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', mode === 'assertive' ? 'alert' : 'status');
    el.style.cssText = 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';
    el.id = 'psm-a11y-live-' + mode;
    global.document.body.appendChild(el);
    _liveRegions[mode] = el;
    return el;
  }

  function announce(msg, mode){
    mode = (mode === 'assertive') ? 'assertive' : 'polite';
    var el = _ensureLive(mode);
    // clear & re-set para forcar leitura (alguns SR ignoram texto identico)
    el.textContent = '';
    setTimeout(function(){ el.textContent = String(msg); }, 50);
  }

  // ─── Focus trap ─────────────────────────────────────────────────────────────
  var _focusStack = [];

  function _focusableSelector(){
    return 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable]';
  }

  function _getFocusable(root){
    var nodes = root.querySelectorAll(_focusableSelector());
    return Array.prototype.filter.call(nodes, function(el){
      // ignora invisible e display:none
      var s = global.getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && !el.hidden;
    });
  }

  function trapFocus(element){
    if (!element) return { release: function(){} };
    var prevFocus = global.document.activeElement;
    _focusStack.push(prevFocus);

    var focusables = _getFocusable(element);
    var first = focusables[0];
    var last = focusables[focusables.length - 1];

    function onKey(e){
      if (e.key !== 'Tab') return;
      var current = global.document.activeElement;
      // se nada no trap esta focado, foca primeiro
      if (!element.contains(current)) {
        e.preventDefault();
        if (first) first.focus();
        return;
      }
      if (e.shiftKey && current === first) {
        e.preventDefault();
        if (last) last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        if (first) first.focus();
      }
    }

    element.addEventListener('keydown', onKey);
    if (first) try { first.focus(); } catch(_){}

    return {
      release: function(){
        element.removeEventListener('keydown', onKey);
        restoreFocus();
      }
    };
  }

  function restoreFocus(){
    var prev = _focusStack.pop();
    if (prev && typeof prev.focus === 'function') {
      try { prev.focus(); } catch(_){}
    }
  }

  // ─── Esc handler ────────────────────────────────────────────────────────────
  function bindEsc(element, handler){
    if (!element || typeof handler !== 'function') return function(){};
    function onKey(e){
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.stopPropagation();
        handler(e);
      }
    }
    element.addEventListener('keydown', onKey);
    return function unbind(){
      element.removeEventListener('keydown', onKey);
    };
  }

  // ─── Keyboard navigation (arrow up/down em listas) ──────────────────────────
  function keyboardNav(items, opts){
    opts = opts || {};
    var loop = opts.loop !== false;
    var current = 0;

    function onKey(e){
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        current = (current + 1) % items.length;
        if (!loop && current >= items.length) current = items.length - 1;
        try { items[current].focus(); } catch(_){}
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        current = current - 1;
        if (current < 0) current = loop ? items.length - 1 : 0;
        try { items[current].focus(); } catch(_){}
      } else if (e.key === 'Home') {
        e.preventDefault(); current = 0;
        try { items[current].focus(); } catch(_){}
      } else if (e.key === 'End') {
        e.preventDefault(); current = items.length - 1;
        try { items[current].focus(); } catch(_){}
      } else if (e.key === 'Enter' && typeof opts.onEnter === 'function') {
        opts.onEnter(items[current], current, e);
      }
    }

    items.forEach(function(item, i){
      item.addEventListener('focus', function(){ current = i; });
      item.addEventListener('keydown', onKey);
    });

    return function cleanup(){
      items.forEach(function(item){
        item.removeEventListener('keydown', onKey);
      });
    };
  }

  // ─── Preferences ────────────────────────────────────────────────────────────
  function prefersReducedMotion(){
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch(_){ return false; }
  }

  function srOnly(text){
    var span = global.document.createElement('span');
    span.style.cssText = 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';
    span.textContent = text || '';
    return span;
  }

  // ─── Expose ─────────────────────────────────────────────────────────────────
  var api = {
    announce: announce,
    trapFocus: trapFocus,
    restoreFocus: restoreFocus,
    bindEsc: bindEsc,
    keyboardNav: keyboardNav,
    prefersReducedMotion: prefersReducedMotion,
    srOnly: srOnly,
    VERSION: '74.0.0'
  };

  global.PSM = global.PSM || {};
  global.PSM.a11y = api;

  _log('debug', 'psm-a11y.js v74.0.0 carregado (reduced-motion: ' + prefersReducedMotion() + ')');
})(typeof window !== 'undefined' ? window : this);
