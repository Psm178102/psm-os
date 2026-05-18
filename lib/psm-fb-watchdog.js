// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-fb-watchdog.js v71.0.0
// Watchdog Firebase: conta falhas consecutivas e mostra aviso visivel apos N falhas.
// Extraido inline do index.html (v71 modularization).
//
// API publica:
//   window.psmFbReportFail()     - chamar em catch de operacao Firebase
//   window.psmFbReportSuccess()  - chamar em then de operacao bem-sucedida
//   PSM.fbWatchdog.reset()       - zera contador manualmente
//   PSM.fbWatchdog.getFailCount() - debug
//
// Comportamento: 3 falhas consecutivas → banner sticky. Reset apos success.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  var THRESHOLD = 3;
  var _failCount = 0;
  var _warnEl = null;

  function _log(level, msg, data){
    if (global.PSM && global.PSM.log) return global.PSM.log[level]('fb-watchdog', msg, data);
  }

  function _showWarn(){
    if (_warnEl) return;
    _warnEl = global.document.createElement('div');
    _warnEl.className = 'psm-fb-down';
    _warnEl.setAttribute('role', 'alert');
    _warnEl.setAttribute('aria-live', 'polite');
    _warnEl.textContent = 'Sincronizacao Firebase falhou. Clique para detalhes.';
    _warnEl.title = 'Dados estao salvos localmente mas nao sincronizam multi-device. Verifique conexao ou Firebase rules.';
    _warnEl.style.cursor = 'pointer';
    _warnEl.onclick = function(){
      if (typeof global.psmAlert === 'function') {
        global.psmAlert(
          'Sincronizacao Firebase falhou ' + _failCount + 'x consecutivas.\n\n' +
          'Seus dados estao seguros LOCALMENTE (localStorage + IndexedDB) e em backup.\n\n' +
          'Mas mudancas NAO estao indo para outros dispositivos enquanto isso.\n\n' +
          'Acoes:\n' +
          '1. Verificar conexao internet\n' +
          '2. Recarregar pagina (F5)\n' +
          '3. Configuracoes > Backup > Forcar Backup',
          { title:'Firebase offline' }
        );
      }
    };
    global.document.body.appendChild(_warnEl);
    _log('warn', 'banner Firebase offline exibido', { failCount: _failCount });
  }

  function _hideWarn(){
    if (!_warnEl) return;
    try { global.document.body.removeChild(_warnEl); } catch(_){}
    _warnEl = null;
  }

  global.psmFbReportFail = function(){
    _failCount++;
    if (_failCount >= THRESHOLD && !_warnEl) _showWarn();
  };

  global.psmFbReportSuccess = function(){
    if (_failCount > 0) _log('info', 'recuperado apos ' + _failCount + ' falhas');
    _failCount = 0;
    _hideWarn();
  };

  global.PSM = global.PSM || {};
  global.PSM.fbWatchdog = {
    reset: function(){ _failCount = 0; _hideWarn(); },
    getFailCount: function(){ return _failCount; },
    setThreshold: function(n){ THRESHOLD = Math.max(1, n|0); },
    VERSION: '71.0.0'
  };
  _log('debug', 'psm-fb-watchdog.js v71.0.0 carregado');
})(typeof window !== 'undefined' ? window : this);
