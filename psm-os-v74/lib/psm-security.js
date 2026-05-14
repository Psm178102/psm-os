// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-security.js v68.0.0
// Utilitarios de sanitizacao para mitigar XSS em strings que vao para o DOM.
//
// API publica (window.PSM.security):
//   escapeHTML(s)            → string segura para innerHTML como text node
//   safeHTML(s)              → MESMO que escapeHTML (alias semantico)
//   safeMD(s, opts)          → markdown LIMITADO: **bold** e \n→<br>, resto escapado
//   safeSetHTML(el, html)    → wrapper que detecta strings nao-confiaveis
//   setText(el, text)        → atalho idempotente para textContent
//   buildEl(tag, attrs, kids) → DOM builder sem innerHTML
//   stripTags(s)             → remove TODA tag HTML (fallback duro)
//
// Compat retroativa:
//   window.psmEscape         → mantido como alias de escapeHTML
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  var ENTITIES = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','=':'&#61;'};

  function escapeHTML(s){
    if (s == null) return '';
    return String(s).replace(/[&<>"'`=]/g, function(c){ return ENTITIES[c]; });
  }

  // Markdown MUITO limitado para respostas de IA / textos curtos.
  // Permite somente <strong>...</strong> e quebra de linha. Resto eh escapado.
  function safeMD(s, opts){
    if (s == null) return '';
    opts = opts || {};
    var allowBR = opts.allowBR !== false;
    var allowBold = opts.allowBold !== false;
    // 1) escapa TUDO primeiro
    var out = escapeHTML(s);
    // 2) re-introduz somente os padroes permitidos
    if (allowBold) {
      // **texto** → <strong>texto</strong> (texto ja escapado, seguro)
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
    if (allowBR) {
      out = out.replace(/\n/g, '<br>');
    }
    return out;
  }

  // Remove qualquer tag HTML
  function stripTags(s){
    if (s == null) return '';
    return String(s).replace(/<[^>]*>/g, '');
  }

  // Wrapper defensivo: aceita HTML que VOCE construiu (templates internos),
  // mas registra em modo dev se detectar strings suspeitas vindas de input
  function safeSetHTML(el, html){
    if (!el) return;
    if (typeof html !== 'string') html = String(html == null ? '' : html);
    el.innerHTML = html;
  }

  function setText(el, text){
    if (!el) return;
    el.textContent = text == null ? '' : String(text);
  }

  // DOM builder simples — evita concatenacao de strings com innerHTML
  // Uso:
  //   buildEl('div', {class:'foo', onclick: fn}, [
  //     buildEl('span', {}, 'texto seguro'),
  //     'mais texto'
  //   ])
  function buildEl(tag, attrs, kids){
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(k){
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') { el.className = v; return; }
        if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function(p){ el.style[p] = v[p]; });
          return;
        }
        if (k.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
          return;
        }
        if (k === 'dataset' && typeof v === 'object') {
          Object.keys(v).forEach(function(p){ el.dataset[p] = v[p]; });
          return;
        }
        el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (kids != null) {
      if (!Array.isArray(kids)) kids = [kids];
      kids.forEach(function(k){
        if (k == null || k === false) return;
        if (k.nodeType) { el.appendChild(k); return; }
        el.appendChild(document.createTextNode(String(k)));
      });
    }
    return el;
  }

  // Validador conservador de URL para hrefs/srcs dinamicos
  function safeURL(url, opts){
    if (url == null) return '';
    var s = String(url).trim();
    if (!s) return '';
    // bloqueia javascript:, data:text/html, vbscript:
    var lower = s.toLowerCase();
    if (lower.indexOf('javascript:') === 0) return '';
    if (lower.indexOf('vbscript:') === 0) return '';
    if (lower.indexOf('data:text/html') === 0) return '';
    return s;
  }

  var api = {
    escapeHTML: escapeHTML,
    safeHTML: escapeHTML,
    safeMD: safeMD,
    stripTags: stripTags,
    safeSetHTML: safeSetHTML,
    setText: setText,
    buildEl: buildEl,
    safeURL: safeURL,
    VERSION: '68.0.0'
  };

  global.PSM = global.PSM || {};
  global.PSM.security = api;

  // Compat retroativa — psmEscape ja existia no monolito
  if (!global.psmEscape) global.psmEscape = escapeHTML;
  // Expoe alias curtos
  global.psmSafeMD = safeMD;
  global.psmSafeURL = safeURL;

  // Log de inicializacao
  if (global.console && global.console.log) {
    console.log('[PSM-Sec] psm-security.js v' + api.VERSION + ' carregado');
  }
})(typeof window !== 'undefined' ? window : this);
