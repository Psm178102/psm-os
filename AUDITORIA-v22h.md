# AUDITORIA v22h — PSM OS (2026-04-20)

## CONTEXTO

Auditoria completa do bug de persistencia revelou TRES classes de falhas alem da reportada (lancTimeline). v22h corrige todas.

## CLASSES DE BUG E CORRECOES

### Classe A — Arrays editaveis com IDs (13 chaves afetadas)

**Antes (v22g):** merge usava `merged = data[k].slice()` (REMOTE) e so adicionava locais NAO presentes em remote. Quando editava campo de item existente (mesmo id), REMOTE vencia.

**Chaves afetadas:** `lancTimeline`, `agendaReunioes`, `agendaCaptConteudo`, `agendaCaptImovel`, `vendasManuais`, `oportunidadesPSM`, `opCorretorList`, `opEventos`, `opTreinamentos`, `tickerMsgs`, `canalAnonimo`, `premiacoes`, `fcData`.

**Fix v22h:** merge per-id preferindo a versao com `_updatedAt` mais novo. Em empate ou ausencia de timestamp, LOCAL vence.

```js
S[k].forEach(function(local){
  var remote = byId[local.id];
  if (!remote) { byId[local.id] = local; }
  else {
    var lt = local._updatedAt || 0, rt = remote._updatedAt || 0;
    if (lt >= rt) byId[local.id] = local;  // local-wins por padrao
  }
});
```

Trade-off: edicoes simultaneas em duas abas — local da aba ativa vence. Aceitavel pois conflito real e raro.

### Classe B — Globals deep-merge (3 chaves)

**Antes (v22g):** `Object.assign(METAS_CONFIG, data.metasConfig)` sobrescrevia campo top-level inteiro. Editar so meta de Marcus -> remote sem essa edicao -> sobrescreve.

**Chaves afetadas:** `METAS_CONFIG`, `METAS_EQUIPE`, `TEAM_CONFIG`.

**Fix v22h:** novo helper `_psmDeepMerge` que recursivamente merge objetos aninhados. Local preserva campos ate o nivel mais profundo.

```js
if (data.metasConfig) _psmDeepMerge(METAS_CONFIG, data.metasConfig);
if (data.metasEquipe) _psmDeepMerge(METAS_EQUIPE, data.metasEquipe);
if (data.teamConfig)  _psmDeepMerge(TEAM_CONFIG, data.teamConfig);
```

### Classe C — 23 chaves localStorage isoladas (sub-sistemas)

**Antes:** sub-sistemas inteiros gravavam em localStorage SEM passar por saveState/fbPushState. Logo nao sincronizavam entre devices/abas. Cada device tinha sua propria copia. PC editava metas -> celular nao via.

**Chaves afetadas (lista completa):**
- Metas: `psm_meta_global`, `psm_meta_equipe`
- Operacao: `psm_captacao`, `psm_fluxo_captacoes`, `psm_tarefas_psm`
- Financeiro: `psm_fluxocaixa`, `psm_dre`, `psm_comissoes`, `psm_repasses`, `psm_metricas_fin`
- Marketing: `psm_radar_data`, `psm_radar_ads`, `psm_radar_ai_result`, `psm_sim_criativo`, `psm_tendencias`
- Sistema: `psm_integrations`, `psm_user_roles`, `psm_vendas_manuais`
- Gemini: `psm_gi_brands`, `psm_gi_okey`, `psm_gi_gkey`
- Marketing Analytics: `psm_ma_budgets`, `psm_ma_cpl`, `psm_ma_sales`

**Fix v22h:** monkey-patch global em `Storage.prototype.setItem` que dispara `fbPushState()` automaticamente quando chave esta em `SYNC_LS_KEYS`. Tambem patch de `removeItem`. Originais expostos em `window._lsRawSet`/`_lsRawDel` para uso interno (evita loop).

```js
Storage.prototype.setItem = function(k, v) {
  _origSetItem.call(this, k, v);
  if (this === localStorage && SYNC_LS_KEYS.indexOf(k) !== -1) {
    if (typeof fbPushState === 'function' && _fbReady) fbPushState();
  }
};
```

No push, snapshot das 23 chaves vai em `shared._lsKeys`. No listener, aplica de volta a localStorage usando os raw setters (sem retriggerar push):

```js
// PUSH
shared._lsKeys = {};
SYNC_LS_KEYS.forEach(function(lsKey){
  var v = localStorage.getItem(lsKey);
  if (v != null) shared._lsKeys[lsKey] = v;
});

// LISTENER
if (data._lsKeys) {
  Object.keys(data._lsKeys).forEach(function(lsKey){
    if (val == null || val === '') window._lsRawDel(lsKey);
    else window._lsRawSet(lsKey, val);
  });
}
```

**Beneficio:** zero refatoracao das 23 features. Cada uma continua chamando `localStorage.setItem('psm_X', ...)` como antes — agora com sync gratuito.

## VERSAO

- `index.html` linha 1: `v2026.04.20-v22h`
- `index.html` meta: `2026.04.20-v22h`
- `index.html` sidebar: `OS v22h`
- `sw.js`: `psm-os-v22h-2026-04-20`

## VALIDACAO

```
node --check script 6: OK
node --check sw.js:    OK
SYNC_LS_KEYS def:      1
_lsKeys uses:          6
_psmDeepMerge:         5 occurrences (def + 4 calls)
_lsRawSet/_lsRawDel:   3 + 3
patchLocalStorageForSync: 1 IIFE
```

## RESUMO ACUMULADO

| Item | v22e | v22f | v22g | v22h |
|---|---|---|---|---|
| Debounce push | 5s | 5s | 1.5s | 1.5s |
| Flush em unload | nao | nao | sim (3 listeners) | sim |
| Merge ooSheetLinks | overwrite | per-key | per-key | per-key |
| Merge arrays IDs | remote-wins | remote-wins | remote-wins | **local-wins (by _updatedAt)** |
| Merge METAS_*/TEAM | overwrite top-level | overwrite | overwrite | **DEEP merge** |
| Sync chaves localStorage isoladas | nao (23 chaves) | nao | nao | **sim (auto via monkey-patch)** |
| Protecao firstLoad | nao | nao | sim | sim |

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v22h)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v22h)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v22h.md`

## NOTAS TECNICAS

- Monkey-patch e idempotente via `window._psmLsPatched` flag — nao duplica em hot reloads.
- Push automatico de chaves `psm_*` usa o mesmo debounce 1.5s, agregando multiplas escritas em rajadas.
- Sub-sistemas que tem auto-save aceleram debounce — push final garantido pelos listeners de unload.
- Para forcar sync manual de tudo (incluindo `_lsKeys`): botao "Forcar Sync Agora" em Configuracoes/Sync.
- Para usuarios em devices novos: ao logar, primeiro `onValue` traz tanto S.* quanto `_lsKeys` -> hidrata todas as 23 chaves localStorage automaticamente.
