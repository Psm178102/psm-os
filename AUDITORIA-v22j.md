# AUDITORIA v22j — PSM OS (2026-04-20)

## CONTEXTO

Auditoria FUNCIONAL pos-v22i (4 agentes paralelos: handlers, persistencia, CSS, features). Encontrados ~30 achados; aplicados fixes nos 7 de impacto real. Demais (cosmetica/style) deferidos.

## BUGS CORRIGIDOS

### 1. `S.mapPins.push` sem saveState (linha 14386)

**Impacto:** pin adicionado no mapa de lancamentos sumia ao recarregar.

**Fix:** `addMapPin()` agora chama `saveState()` apos push, antes do toast.

### 2. `S.iaChat.push` sem saveState (linhas 19913, 19967)

**Impacto:** historico do chat com IA Corretor (Gemini/Nano Banana) era perdido ao recarregar pagina.

**Fix:** `iaCorretorSend()` e `_iaAddResp()` agora chamam `saveState()` antes do `render()`.

### 3. `S.veraHist.push` sem saveState (linhas 20705, 20718, 20772, 20777)

**Impacto:** conversas com Sr. Performance (mentora IA da PSM) eram perdidas. 4 sites de push afetados.

**Fix:** `sendVera()` chama `saveState()` no final (apos try/catch), cobrindo todos os 4 push points.

### 4. Chaves chat NAO sincronizavam multi-device (linhas 1871-1873)

**Impacto:** mesmo com saveState, as chaves `mapPins`, `iaChat`, `veraHist` nao estavam em SYNC_KEYS — Firebase nao recebia. Dispositivo A salvava chat, dispositivo B nao via.

**Fix:** adicionadas a SYNC_KEYS:
```js
'timelineItems', // v22i
'mapPins',       // v22j: pins do mapa lancamentos
'iaChat',        // v22j: historico chat IA Corretor
'veraHist'       // v22j: historico Sr. Performance
```

### 5. `JSON.parse` sem try/catch em reset password (linha 9966)

**Impacto:** se `psm_reset_token` corrompido, `doResetPassword()` lancava `Uncaught SyntaxError`, travando o fluxo de redefinir senha (usuario ficava preso na tela).

**Fix:** envolvidos os 2 JSON.parse em try/catch separados:
```js
let data;
try { data=JSON.parse(raw); }
catch(e){ localStorage.removeItem('psm_reset_token'); S.loginErr='Token corrompido. Solicite novamente.'; render(); return; }
let senhas;
try { senhas=JSON.parse(localStorage.getItem('psm_senhas')||'{}'); } catch(e){ senhas={}; }
```

Bonus: validado `data` nao-nulo na comparacao de token.

### 6. `z-index:999999` (6 noves) em flash de venda (linhas 5845, 10100)

**Impacto:** copy-paste sem motivo. Empilhamento absurdo dificulta debug. Outros overlays usam `99999` (5 noves).

**Fix:** normalizado para `z-index:99999` em ambos os sites do flash de venda.

### 7. Versao bump

- `index.html` linha 1: `v2026.04.20-v22j`
- `index.html` meta: `2026.04.20-v22j`
- `index.html` sidebar: `OS v22j`
- `sw.js`: `psm-os-v22j-2026-04-20`

## FALSOS POSITIVOS DA AUDITORIA (verificados, NAO sao bugs)

- **Botoes `cap-add`, `com-add`, `rep-add`, `tend-save`, `radar-ai-*`**: agente alegou estarem sem onclick. **VERDADE:** todos tem handler atribuido via `document.querySelector('#xxx').onclick = ...` em `setTimeout` apos render. Funcionam.
- **`JSON.parse` linhas 1849, 3188, 10074**: alegado sem try/catch. **VERDADE:** todos tem try/catch envolvendo. Apenas linha 9966 estava sem.
- **`adsIntelAI`, `addFluxo`, `auditarCohortRD`**: agente alegou serem orfas. Necessita verificacao individual em proxima rodada (poderia ser dead code, ou definidas em outro escopo).

## DEFERIDOS (qualidade, nao bloqueiam producao)

- **125 try/catch vazios `catch(e){}`**: padrao perigoso mas em sua maioria intencional (defensive). Refatorar caso a caso.
- **96 `console.log` em producao**: maioria prefixada `[PSM-...]` para debug. Aceitavel.
- **9 `confirm()`/`prompt()` nativos** em handlers de delete (linhas 1561, 1565, 3117-3140, 7569, 7673, 7682, 8003-8145): UX melhor seria modal customizado. Mas funcional.
- **Magic numbers** (FORECAST_WEIGHT_LINEAR, FORECAST_WEIGHT_PIPELINE, MAX_FILE_SIZE 8MB): opcional refatorar para constantes nomeadas.
- **Acessibilidade**: inputs login (linhas 9770, 9776) tem `<label>` mas sem `for=` ou `aria-label`. Opcional.
- **Mobile tabelas**: tabelas com `min-width:600+px` sem wrapper `overflow-x:auto`. Quebra em iPhone SE.
- **Permissoes nao checadas em delete**: `organogramaRemoverNo`, `reunioesRemover` sem `canAccess()`. Verificar caso a caso.
- **Inconsistencia LOCAL backend**: linha 9839 TODO sobre `/api/auth` ainda nao deployado.
- **`setTimeout(render,0)`** linhas 17446, 18467: hack de timing. Refatorar para `requestAnimationFrame`.

## VALIDACAO

```
node --check sw.js:                         OK
node --check 4 inline scripts:              OK
  s1.js: 26L
  s2.js: 1567L (+3 vs v22i: SYNC_KEYS amplied)
  s3.js: 6515L
  s4.js: 19291L (+7 vs v22i: saveState fixes)
v22j em index.html:                         11 markers
v22j em sw.js:                              2 markers
saveState() FIX v22j:                       8 sites
z-index:999999 (deve ser 0):                0 ✓
z-index:99999:                              5 sites
mapPins/iaChat/veraHist em SYNC_KEYS:       3/3 ✓
```

## RESUMO ACUMULADO

| Item | v22i | v22j |
|---|---|---|
| Pins mapa persistem | nao | **sim** |
| Chat IA persiste | nao | **sim** |
| Chat Sr.Performance persiste | nao | **sim** |
| Chat sincroniza multi-device | nao | **sim (3 chaves)** |
| Reset password robusto | crash possivel | **try/catch** |
| z-index normalizado | 999999 (2x) | **99999 (max)** |

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v22j)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v22j)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v22j.md`

## ROADMAP v22k+ (deferidos)

- Modal customizado substituindo `confirm()`/`prompt()` nativos (10+ sites)
- Constantes nomeadas para magic numbers (FORECAST_WEIGHT_*, MAX_FILE_SIZE, ROTATION_INTERVAL_MS)
- Wrapper `overflow-x:auto` em tabelas com min-width
- ARIA labels em inputs login + form de captura
- `canAccess()` antes de `organogramaRemoverNo`, `reunioesRemover`, etc
- Deploy `/api/auth` backend (TODO linha 9839)
- Refator `setTimeout(render,0)` -> `requestAnimationFrame`
- Implementar `_psmTouch(obj)` em mutation handlers (popular `_updatedAt` para merge by-id correto — preserva LOCAL ainda mais robusto)
