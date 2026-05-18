// ═════════════════════════════════════════════════════════════════════════════
// PSM OS · lib/psm-meta-sync.js v74.1.0
// Engine de sincronização entre fontes de meta no sistema.
//
// FONTE DA VERDADE (definida pelo dono do produto):
//   localStorage 'psm_meta_global' (S.mg) → editado em pgMetas (Diretoria)
//
// FONTES DERIVADAS (devem refletir a oficial):
//   S.ooMetaVgvMes[bid][monthKey] → declarada pelo corretor no 1-on-1
//   S.ooMetaLanc[bid][lancId]     → meta de lançamento individual
//   S.ooMetas[bid][monthKey]      → meta geral mensal do 1-on-1
//   S.metaIndiv[bid]              → cache calculado por corretor (Arena TV)
//
// API publica (window.psmMetaSync + PSM.metaSync):
//   getMetaOficialMes(type, monthIdx)
//   getMetaOficialAno(type)
//   getMetaPersonalVgvMes(bid, monthKey)
//   checkDivergenceVgv(bid, monthKey, monthIdx)
//   syncToOfficialVgv(bid, monthKey, monthIdx)
//   buildDivergenceBanner(divergence, bid, monthKey, monthIdx)
//   emitChange(detail)
//   onChange(callback) → unsubscribe()
//
// Eventos disparados (CustomEvent em document):
//   'psm:meta-changed' → quando alguma meta muda (oficial ou personal)
//   detail: { action: 'sync'|'update', source: 'oficial'|'1o1', bid?, type?, value? }
// ═════════════════════════════════════════════════════════════════════════════
(function(global){
  'use strict';

  var MESES_KEY = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  function _log(level, msg, data){
    if (global.PSM && global.PSM.log) return global.PSM.log[level]('meta-sync', msg, data);
  }

  // ─── Leitura da fonte oficial (S.mg = psm_meta_global) ──────────────────────

  function getMetaOficialMes(type, monthIdx){
    var S = global.S;
    if (!S || !S.mg) return 0;
    var m = S.mg;
    if (type === 'total') {
      return (m.metaImpper && m.metaImpper[monthIdx] || 0)
           + (m.metaTerc   && m.metaTerc[monthIdx]   || 0)
           + (m.metaEstMAP && m.metaEstMAP[monthIdx] || 0)
           + (m.metaEstConq&& m.metaEstConq[monthIdx]|| 0)
           + (m.metaLanc   && m.metaLanc[monthIdx]   || 0);
    }
    var field = ({
      lanc: 'metaLanc', impper: 'metaImpper', terc: 'metaTerc',
      estMap: 'metaEstMAP', estConq: 'metaEstConq'
    })[type];
    if (!field || !m[field]) return 0;
    return m[field][monthIdx] || 0;
  }

  function getMetaOficialAno(type){
    var t = 0;
    for (var i = 0; i < 12; i++) t += getMetaOficialMes(type, i);
    return t;
  }

  function getCorretoresMes(monthIdx){
    var S = global.S;
    return (S && S.mg && S.mg.corretores && S.mg.corretores[monthIdx]) || 1;
  }

  // ─── Leitura das fontes derivadas (1-on-1, individual) ──────────────────────

  function getMetaPersonalVgvMes(bid, monthKey){
    var S = global.S;
    if (!S || !S.ooMetaVgvMes || !S.ooMetaVgvMes[bid]) return 0;
    return parseFloat(S.ooMetaVgvMes[bid][monthKey]) || 0;
  }

  function getMetaPersonalLanc(bid, lancId){
    var S = global.S;
    if (!S || !S.ooMetaLanc || !S.ooMetaLanc[bid] || !S.ooMetaLanc[bid][lancId]) return null;
    var v = S.ooMetaLanc[bid][lancId];
    if (typeof v === 'object') return { pastas: v.pastas||0, vgv: v.vgv||0 };
    return { pastas: parseFloat(v)||0, vgv: 0 };
  }

  function getMetaPersonalMensal(bid, monthKey){
    var S = global.S;
    if (!S || !S.ooMetas || !S.ooMetas[bid]) return 0;
    return parseFloat(S.ooMetas[bid][monthKey]) || 0;
  }

  // ─── Detector de divergência ────────────────────────────────────────────────

  function checkDivergenceVgv(bid, monthKey, monthIdx){
    var personal = getMetaPersonalVgvMes(bid, monthKey);
    var oficialTotalMes = getMetaOficialMes('total', monthIdx);
    var corretoresMes = getCorretoresMes(monthIdx);
    var oficialPorCorretor = corretoresMes > 0 ? Math.round(oficialTotalMes / corretoresMes) : 0;

    var diff = personal - oficialPorCorretor;
    var pctDiff = oficialPorCorretor > 0 ? (diff / oficialPorCorretor) : 0;

    return {
      bid: bid,
      monthKey: monthKey,
      monthIdx: monthIdx,
      personal: personal,
      oficial: oficialPorCorretor,
      oficialTotalMes: oficialTotalMes,
      corretoresMes: corretoresMes,
      diff: diff,
      pctDiff: pctDiff,
      // Considera divergente se:
      //  • diferença absoluta > 5% E
      //  • personal foi de fato preenchida (> 0)
      isDivergent: Math.abs(pctDiff) > 0.05 && personal > 0
    };
  }

  // ─── Sync (copia oficial → personal) ────────────────────────────────────────

  function syncToOfficialVgv(bid, monthKey, monthIdx){
    var check = checkDivergenceVgv(bid, monthKey, monthIdx);
    if (typeof global.ooSaveMetaVgvMes === 'function') {
      global.ooSaveMetaVgvMes(bid, monthKey, check.oficial);
      emitChange({ action: 'sync', source: 'oficial→1o1', bid: bid, type: 'vgvMes', monthKey: monthKey, value: check.oficial });
      _log('info', 'sync VGV ' + bid + '/' + monthKey + ' = ' + check.oficial);
      return true;
    }
    _log('warn', 'ooSaveMetaVgvMes nao disponivel');
    return false;
  }

  // ─── Builder do banner amarelo ──────────────────────────────────────────────

  function _esc(s){
    if (global.PSM && global.PSM.security && global.PSM.security.escapeHTML) return global.PSM.security.escapeHTML(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }

  function _fmt(v){
    return 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function buildDivergenceBanner(divergence, opts){
    if (!divergence || !divergence.isDivergent) return '';
    opts = opts || {};
    var diffSign = divergence.diff > 0 ? 'acima' : 'abaixo';
    var diffPct = Math.abs(divergence.pctDiff * 100).toFixed(0);
    var bid = _esc(divergence.bid);
    var monthKey = _esc(divergence.monthKey);
    var monthIdx = divergence.monthIdx;
    var compact = opts.compact === true;

    if (compact) {
      return '<span class="psm-meta-divergent-pill" role="alert"' +
        ' title="1-on-1: ' + _fmt(divergence.personal) + ' · Oficial: ' + _fmt(divergence.oficial) + ' (' + diffSign + ' em ' + diffPct + '%)"' +
        ' style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#78350f;border:1px solid #f59e0b;border-radius:10px;padding:1px 8px;font-size:10px;font-weight:600;margin-left:6px">' +
        '⚠ ' + diffSign + ' ' + diffPct + '%' +
      '</span>';
    }

    return '<div class="psm-meta-divergent" role="alert" aria-live="polite"' +
      ' style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 12px;margin:8px 0;font-size:12px;color:#78350f;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:18px;flex-shrink:0" aria-hidden="true">⚠️</span>' +
      '<div style="flex:1;min-width:200px">' +
        '<strong>Meta no 1-on-1 diverge da oficial</strong><br>' +
        '<span style="color:#92400e">1-on-1: ' + _fmt(divergence.personal) +
        ' · Oficial: ' + _fmt(divergence.oficial) +
        ' (' + diffSign + ' em ' + diffPct + '%)</span>' +
      '</div>' +
      '<button onclick="window.psmMetaSync.syncToOfficialVgv(' +
        '\'' + bid + '\',\'' + monthKey + '\',' + monthIdx + ');' +
        'if(typeof render===\'function\')render();" ' +
        ' aria-label="Sincronizar meta com a oficial da diretoria"' +
        ' style="background:#f59e0b;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-weight:600;cursor:pointer;font-size:11px;flex-shrink:0">' +
        'Sincronizar com oficial' +
      '</button>' +
    '</div>';
  }

  // ─── Pub/sub para mudanças em tempo real ───────────────────────────────────

  var _listeners = [];
  function emitChange(detail){
    detail = detail || {};
    try {
      var ev = new CustomEvent('psm:meta-changed', { detail: detail });
      global.document.dispatchEvent(ev);
    } catch(_){}
    _listeners.forEach(function(cb){ try { cb(detail); } catch(e){ _log('warn', 'listener erro', e); } });
  }
  function onChange(cb){
    if (typeof cb !== 'function') return function(){};
    _listeners.push(cb);
    return function unsubscribe(){
      _listeners = _listeners.filter(function(c){ return c !== cb; });
    };
  }

  // ─── Hook automatico: detectar mudancas em S.mg via storage event ──────────
  // Quando outra aba salva psm_meta_global, esta aba recebe storage event
  if (global.addEventListener) {
    global.addEventListener('storage', function(e){
      if (e && e.key === 'psm_meta_global') {
        // Recarrega S.mg
        try {
          if (global.S && e.newValue) global.S.mg = JSON.parse(e.newValue);
        } catch(_){}
        emitChange({ action: 'update', source: 'oficial', via: 'storage-event' });
      }
    });
  }

  // ─── Expose ─────────────────────────────────────────────────────────────────

  // ─── Propagacao automatica (v74.2): quando oficial muda, invalida caches ──
  // Reage ao evento 'psm:meta-changed' com source='oficial'.
  // Estrategia conservadora: nao sobrescreve metaIndiv personalizada do corretor;
  // apenas recalcula derivados (recalcBrokerMetrics) e dispara re-render.

  function recalcAllDerivatives(){
    try {
      // 1. Forca recarga de S.mg do localStorage (caso outra aba tenha mudado)
      try {
        var raw = global.localStorage.getItem('psm_meta_global');
        if (raw && global.S) global.S.mg = JSON.parse(raw);
      } catch(_){}
      // 2. Recalcula metricas de todos os corretores
      if (typeof global.recalcBrokerMetrics === 'function') {
        global.recalcBrokerMetrics('war');  // 'war' = todos
        _log('debug', 'recalcBrokerMetrics disparado por meta-change');
      }
      // 3. Recarrega S.metaIndiv do localStorage (cache pode ter sido invalidado)
      try {
        var rawMI = global.localStorage.getItem('psm_meta_indiv');
        if (rawMI && global.S) global.S.metaIndiv = JSON.parse(rawMI);
      } catch(_){}
      return true;
    } catch(e){
      _log('error', 'recalcAllDerivatives falhou', e);
      return false;
    }
  }

  // Helper explicito: usar para SOBRESCREVER intencionalmente meta personal com oficial
  function propagateOficialToIndiv(bid, monthIdx){
    var S = global.S; if (!S || !S.mg) return false;
    if (!S.metaIndiv) S.metaIndiv = {};
    if (!S.metaIndiv[bid]) S.metaIndiv[bid] = {};
    var monthKey = monthIdx + 1; // S.metaIndiv usa 1-12, S.mg usa 0-11
    var oficialTotal = getMetaOficialMes('total', monthIdx);
    var corretoresMes = getCorretoresMes(monthIdx);
    var perCorretor = corretoresMes > 0 ? Math.round(oficialTotal / corretoresMes) : 0;
    S.metaIndiv[bid][monthKey] = S.metaIndiv[bid][monthKey] || {};
    S.metaIndiv[bid][monthKey].vgv_meta = perCorretor;
    S.metaIndiv[bid][monthKey]._autoSync = true; // marca como auto-sincronizado
    try { global.localStorage.setItem('psm_meta_indiv', JSON.stringify(S.metaIndiv)); } catch(_){}
    emitChange({ action: 'propagate', source: 'oficial→metaIndiv', bid: bid, monthKey: monthKey, value: perCorretor });
    return true;
  }

  // Auto-hook: escuta o evento e propaga
  if (global.document && global.document.addEventListener) {
    global.document.addEventListener('psm:meta-changed', function(ev){
      var d = ev.detail || {};
      if (d.source === 'oficial') {
        // Mudou na Diretoria: invalida caches derivados (recalcBrokerMetrics)
        // mas NAO sobrescreve metaIndiv personalizada (so se _autoSync = true).
        setTimeout(recalcAllDerivatives, 50); // pequeno delay pra agrupar mudancas
      }
    });
  }

  // ─── Auditoria global (rodar no console): psmMetaSync.audit() ──────────────
  function audit(){
    var S = global.S;
    if (!S || !S.ooMetaVgvMes) {
      console.log('[META-SYNC] sem dados — abra um corretor no 1-on-1 primeiro');
      return [];
    }
    var report = [];
    var bids = Object.keys(S.ooMetaVgvMes);
    bids.forEach(function(bid){
      MESES_KEY.forEach(function(mk, idx){
        var d = checkDivergenceVgv(bid, mk, idx);
        if (d.isDivergent) report.push(d);
      });
    });
    console.group('[META-SYNC] Relatório de Divergências (' + report.length + ' encontradas)');
    if (report.length === 0) console.log('✅ Sem divergências entre 1-on-1 e oficial');
    else console.table(report.map(function(r){
      return {
        Corretor: r.bid, Mes: r.monthKey,
        '1-on-1': r.personal, Oficial: r.oficial,
        Diferenca: r.diff,
        'Diferenca %': (r.pctDiff * 100).toFixed(1) + '%'
      };
    }));
    console.groupEnd();
    return report;
  }

  var api = {
    getMetaOficialMes: getMetaOficialMes,
    getMetaOficialAno: getMetaOficialAno,
    getMetaPersonalVgvMes: getMetaPersonalVgvMes,
    getMetaPersonalLanc: getMetaPersonalLanc,
    getMetaPersonalMensal: getMetaPersonalMensal,
    getCorretoresMes: getCorretoresMes,
    checkDivergenceVgv: checkDivergenceVgv,
    syncToOfficialVgv: syncToOfficialVgv,
    buildDivergenceBanner: buildDivergenceBanner,
    emitChange: emitChange,
    onChange: onChange,
    audit: audit,
    recalcAllDerivatives: recalcAllDerivatives,
    propagateOficialToIndiv: propagateOficialToIndiv,
    MESES_KEY: MESES_KEY,
    VERSION: '74.2.0'
  };

  global.psmMetaSync = api;
  global.PSM = global.PSM || {};
  global.PSM.metaSync = api;
  _log('debug', 'psm-meta-sync.js v74.1.0 carregado');
})(typeof window !== 'undefined' ? window : this);
