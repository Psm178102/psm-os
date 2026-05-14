// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-lgpd.js v71.0.0
// Consentimento LGPD + exportar dados + deletar dados (direito do titular).
// Extraido inline do index.html (v71 modularization).
//
// API publica (window.psmLgpd*):
//   psmLgpdShow()      - exibe modal de consentimento (1x por usuario)
//   psmLgpdExportar()  - download JSON de todos os dados psm_* do localStorage
//   psmLgpdDeletar()   - apaga todos os dados psm_* deste dispositivo
//   psmLgpdRevogar()   - revoga consentimento previamente dado (NOVO v71)
//   psmLgpdStatus()    - retorna {consented, consentedAt}
//
// Auto-inicializa: 3s apos DOMContentLoaded se window.S.user existir, mostra modal.
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  function _log(level, msg, data){
    if (global.PSM && global.PSM.log) return global.PSM.log[level]('lgpd', msg, data);
  }

  function _hasConsent(){
    try { return global.localStorage.getItem('psm_lgpd_consent') === '1'; } catch(_){ return false; }
  }

  function _setConsent(ok){
    try {
      if (ok) {
        global.localStorage.setItem('psm_lgpd_consent','1');
        global.localStorage.setItem('psm_lgpd_consent_ts', String(Date.now()));
      } else {
        global.localStorage.removeItem('psm_lgpd_consent');
        global.localStorage.removeItem('psm_lgpd_consent_ts');
      }
    } catch(_){}
  }

  global.psmLgpdStatus = function(){
    var ts = 0;
    try { ts = parseInt(global.localStorage.getItem('psm_lgpd_consent_ts')||'0', 10) || 0; } catch(_){}
    return { consented: _hasConsent(), consentedAt: ts };
  };

  global.psmLgpdShow = function(){
    if (_hasConsent()) return;
    if (typeof global.psmConfirm !== 'function') {
      _log('warn', 'psmConfirm() ainda nao definido — adiando');
      setTimeout(function(){ global.psmLgpdShow(); }, 2000);
      return;
    }
    setTimeout(function(){
      global.psmConfirm(
        'PSM OS coleta e processa dados de uso interno (vendas, atendimentos, metas) ' +
        'para finalidade legitima de gestao da imobiliaria.\n\n' +
        'Voce pode a qualquer momento:\n' +
        '• Exportar todos os seus dados\n' +
        '• Solicitar exclusao\n' +
        '• Revisar quem tem acesso\n\n' +
        'Acesse: Configuracoes > Privacidade (LGPD)\n\n' +
        'Concorda com o tratamento dos dados?',
        { title:'Privacidade & LGPD', okLabel:'Concordo', cancelLabel:'Recusar' }
      ).then(function(ok){
        if (ok) {
          _setConsent(true);
          _log('info', 'consentimento dado');
        } else if (typeof global.psmAlert === 'function') {
          global.psmAlert('Sem consentimento, voce nao pode usar o sistema. Faca logout.', { title:'Consentimento necessario' });
        }
      });
    }, 1500);
  };

  global.psmLgpdExportar = function(){
    try {
      var dump = {};
      for (var i=0; i<global.localStorage.length; i++){
        var k = global.localStorage.key(i);
        if (k && k.indexOf('psm_') === 0 && k !== 'psm_senhas') {
          dump[k] = global.localStorage.getItem(k);
        }
      }
      var blob = new Blob([JSON.stringify(dump, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = 'psm-os-dados-' + new Date().toISOString().slice(0,10) + '.json';
      global.document.body.appendChild(a);
      a.click();
      global.document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
      if (typeof global.toast === 'function') global.toast('Dados exportados','ok');
      _log('info', 'exportacao concluida', { keys: Object.keys(dump).length });
    } catch(e){
      _log('error', 'erro ao exportar', e);
      if (typeof global.psmAlert === 'function') global.psmAlert('Erro ao exportar: ' + e.message);
    }
  };

  global.psmLgpdDeletar = function(){
    if (typeof global.psmConfirm !== 'function') {
      _log('warn', 'psmConfirm indisponivel');
      return;
    }
    global.psmConfirm(
      'EXCLUIR TODOS os seus dados deste dispositivo?\n\n' +
      'Isso apaga: sessao, preferencias, cache, historicos.\n\n' +
      'Dados compartilhados (vendas, metas) permanecem para a equipe.\n\n' +
      'Esta acao e IRREVERSIVEL.',
      { title:'LGPD: Excluir Dados', okLabel:'Excluir Tudo', danger:true }
    ).then(function(ok){
      if (!ok) return;
      var keys = [];
      for (var i=0; i<global.localStorage.length; i++){
        var k = global.localStorage.key(i);
        if (k && k.indexOf('psm_') === 0) keys.push(k);
      }
      keys.forEach(function(k){ global.localStorage.removeItem(k); });
      if (global._psmIdb) {
        try { global._psmIdb.transaction('snapshots','readwrite').objectStore('snapshots').clear(); }
        catch(_){ _log('warn', 'clear IndexedDB falhou', _); }
      }
      _log('info', 'dados deletados', { keys: keys.length });
      if (typeof global.psmAlert === 'function') {
        global.psmAlert('Dados deletados. Recarregando...').then(function(){ global.location.reload(); });
      } else {
        global.location.reload();
      }
    });
  };

  // NOVO v71: permite revogar consentimento sem deletar dados
  global.psmLgpdRevogar = function(){
    _setConsent(false);
    _log('info', 'consentimento revogado');
    if (typeof global.psmAlert === 'function') {
      global.psmAlert('Consentimento revogado. Voce sera deslogado.').then(function(){ global.location.reload(); });
    } else {
      global.location.reload();
    }
  };

  // Auto-inicializacao: 3s apos DOMContentLoaded se ja houver usuario logado
  function _autoShow(){
    setTimeout(function(){
      if (global.S && global.S.user) global.psmLgpdShow();
    }, 3000);
  }
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', _autoShow);
  } else {
    _autoShow();
  }

  global.PSM = global.PSM || {};
  global.PSM.lgpd = {
    show: global.psmLgpdShow,
    exportar: global.psmLgpdExportar,
    deletar: global.psmLgpdDeletar,
    revogar: global.psmLgpdRevogar,
    status: global.psmLgpdStatus,
    VERSION: '71.0.0'
  };
  _log('debug', 'psm-lgpd.js v71.0.0 carregado');
})(typeof window !== 'undefined' ? window : this);
