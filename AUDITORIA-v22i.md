# AUDITORIA v22i — PSM OS (2026-04-20)

## CONTEXTO

Apos v22h, auditoria profunda do sistema inteiro revelou 7 bugs adicionais nao cobertos pelas tres classes (A/B/C). v22i corrige todos.

## BUGS DETECTADOS E CORRIGIDOS

### 1. TYPO `psm_vendas_manual` (singular, faltava `s`)

**Onde:** linhas 1849, 10035, 10037 (`saveState`/`loadState`/`salvarVenda`).

**Impacto:** vendas manuais gravavam em `psm_vendas_manual` mas SYNC_LS_KEYS sincronizava `psm_vendas_manuais`. Resultado: vendas manuais NAO sincronizavam entre devices, e legacy carregava de chave isolada.

**Fix:** unificado para `psm_vendas_manuais` (plural) em 3 sites. Agora monkey-patch dispara `fbPushState()` automatico.

### 2. `S.timelineItems` AUSENTE de SYNC_KEYS

**Onde:** linha 1870 (SYNC_KEYS).

**Impacto:** PSM Live (feed de novidades visivel no TV/topo) gravava em `S.timelineItems` mas SYNC_KEYS nao incluia a chave. Cada device tinha seu proprio feed. Lancamentos novos nao apareciam pra equipe.

**Fix:** adicionado `'timelineItems'` ao final de SYNC_KEYS. Como item tem `id`, usa merge by-id local-wins (Classe A v22h).

### 3. SYNC_LS_KEYS sem chaves orfas

**Onde:** linhas 1887-1888.

**Impacto:** 6 chaves localStorage usadas em sub-sistemas (radar patterns, radar global, ads data, meta indiv, webhook url, hide mock) nao sincronizavam.

**Fix:** adicionadas:
- `psm_radar_patterns` (textareas radar concorrencia)
- `psm_radar_global` (insights globais radar)
- `psm_ads_data` (dados Meta Ads sincronizados)
- `psm_meta_indiv` (metas individuais legacy)
- `psm_webhook_url` (URL webhook Zapier)
- `psm_hide_mock` (flag UI ocultar dados mock)

Excluidas deliberadamente:
- `psm_senhas` (segredo, nao deve ir pro Firebase)
- `psm_audit_log` (cresce demais, ja temos `S.ooAuditLog` sincronizado)
- `psm_backup_critical` (backup duplo seria circular)

### 4. `_fbSyncing` podia travar em true

**Onde:** linha ~2240 (`fbPushState`).

**Antes:** se `_fbDb.ref('shared').set(shared)` lancava excecao SINCRONA (network error, DB rules), `.then`/`.catch` nunca executavam, `_fbSyncing` permanecia `true` indefinidamente, bloqueando todo `onValue` ate refresh.

**Fix:** envolvido em `try/catch` + circuit-breaker `setTimeout(_fbReleaseSyncing, 30000)`. Helper unico libera flag + cancela timer.

```js
function _fbReleaseSyncing(reason){
  _fbSyncing = false;
  if (_fbSyncingTimer) { clearTimeout(_fbSyncingTimer); _fbSyncingTimer = null; }
}
// em fbPushState:
_fbSyncingTimer = setTimeout(function(){ _fbReleaseSyncing('timeout 30s'); }, 30000);
try {
  _fbDb.ref('shared').set(shared).then(/*...*/).catch(/*...*/);
} catch(syncErr){ _fbReleaseSyncing('sync exception'); }
```

### 5. `ooAuditLog` perdia entradas em merge

**Onde:** linha ~2014 (listener Firebase).

**Antes:** `ooAuditLog` e array SEM `id`, caia no `else` → `S[k] = data[k]` (overwrite). Se aba A logava 10 entradas e aba B 5 diferentes, sync sobrescrevia entre si.

**Fix:** merge especial para `ooAuditLog`:
- concat local + remote
- dedupe por chave composta `ts|actor|kind|bid|field`
- ordena por timestamp ascendente
- limita a ultimas 5000 entradas

```js
if (k === 'ooAuditLog' && Array.isArray(data[k])) {
  var combined = (S.ooAuditLog||[]).concat(data[k]);
  var seenLog = {}, deduped = [];
  combined.forEach(function(e){
    var key = (e.ts||0)+'|'+(e.actor||'')+'|'+(e.kind||'')+'|'+(e.bid||'')+'|'+(e.field||'');
    if (!seenLog[key]) { seenLog[key]=1; deduped.push(e); }
  });
  deduped.sort(function(a,b){ return (a.ts||0)-(b.ts||0); });
  if (deduped.length > 5000) deduped = deduped.slice(-5000);
  S.ooAuditLog = deduped;
  return;
}
```

### 6. Comentario "23 chaves" desatualizado

**Onde:** linha 1875.

**Fix:** removida menção a numero fixo. Adicionada nota explicando exclusoes deliberadas (`psm_senhas`, `psm_audit_log`, `psm_backup_critical`).

### 7. `_updatedAt` strategy clarificada

**Status:** mantido lt >= rt = LOCAL vence. Em ausencia de timestamps (estado atual), LOCAL sempre vence — protege edicoes nao-pushadas. Trade-off: delete via outro device nao propaga ate `_updatedAt` ser populado em mutation handlers (futuro v22j).

**Mitigacao atual:** `_lastUpdate` global no payload + protecao `localSavedAt > data._lastUpdate` continua funcionando como tie-breaker grosso para o snapshot inteiro.

## VERSAO

- `index.html` linha 1: `v2026.04.20-v22i`
- `index.html` meta: `2026.04.20-v22i`
- `index.html` sidebar: `OS v22i`
- `sw.js`: `psm-os-v22i-2026-04-20`

## VALIDACAO

```
node --check sw.js:                     OK
node --check 4 inline scripts:          OK (s1=26 s2=1564 s3=6515 s4=19284 linhas)
psm_vendas_manual (typo):               0 ocorrencias
psm_vendas_manuais (correto):           8 ocorrencias
timelineItems em SYNC_KEYS:             1 (linha 1870)
_fbReleaseSyncing:                      5 (def + 4 chamadas)
_fbSyncingTimer:                        4 (var + uso)
ooAuditLog merge especial:              1 site
SYNC_LS_KEYS:                           30 chaves (24 v22h + 6 orfas)
```

## RESUMO ACUMULADO

| Item | v22h | v22i |
|---|---|---|
| Typo psm_vendas_manual | 3 sites bug | **0 (corrigido)** |
| timelineItems sync | nao | **sim** |
| try/catch fbPushState set | nao | **sim** |
| Circuit-breaker _fbSyncing | nao | **sim (30s)** |
| ooAuditLog merge | overwrite (perdia) | **concat+dedupe** |
| Chaves localStorage orfas | 24 sync | **30 sync (+6 orfas)** |
| Estrategia _updatedAt | lt>=rt local-wins | mantido (futuro v22j) |

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v22i)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v22i)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v22i.md`

## ROADMAP v22j (pendente)

- Implementar `_psmTouch(obj)` em mutation handlers para popular `_updatedAt` (lancTimeline, agenda*, vendasManuais, etc.)
- Habilitar delete propagation via tombstone marker
- Migrar `_lsKeys` para path Firebase separado (`shared/_ls/<key>`) — evita pull do snapshot inteiro a cada update
- Push throttle adaptativo: 500ms em rajada, 5s em idle
