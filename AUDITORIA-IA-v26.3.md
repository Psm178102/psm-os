# AUDITORIA IA — PSM OS (v26.3, 2026-04-21)

## CONTEXTO

Usuario pediu: "vamos focar em desenvolver as IAS dentro do nosso sistema, o que nao esta funcionando?"

Auditoria cobre `lib/psm-ia.js` + 7 runners no `index.html`.

---

## O QUE EXISTE

| Funcao | Arquivo/Linha | Funcao |
|---|---|---|
| `scoreLead` | psm-ia.js | Avalia lead 0-100 |
| `alertaPerformance` | psm-ia.js | Detecta queda corretor |
| `sugerirAcoes` | psm-ia.js | 3 acoes para bater meta |
| `preverVenda` | psm-ia.js | Forecast fim de mes |
| `psmIARodar` | index 29158 | Painel Dashboard (preverVenda + sugerirAcoes) |
| `psmAnaliseIAEquipe` | index 29231 | Batch alertaPerformance 8 corretores |
| `psmScoreLeads` | index 29295 | Modal 30 opps com botao score |
| `psmScorarOpp` | index 29334 | Score individual 1 opp |
| `psmScoreLeadsBatch` | index 29359 | Score top 10 em sequencia |
| `psmHistoricoIA` | index 29369 | Ver historico previsoes + delta realizado |
| `psmExportarIAPDF` | index 29410 | Print-to-PDF da analise |
| `psmBiForecast6m` | index 27276 | Forecast 6 meses BI Socio |

---

## O QUE NAO ESTAVA FUNCIONANDO (pre v26.3)

### CRITICO

**IA1. `callGemini` sem timeout**
- Rede ruim/Firebase lento = Promise pendura forever
- User ve "Analisando... 10-20s" eternamente
- **Fix v26.3:** AbortController 25s + erro explicito

**IA2. Sem tratamento HTTP**
- `r.json()` chamado mesmo em 400/429/500
- Erro Gemini = parse vazio = fallback silencioso
- User ve "score 50" mas IA nunca rodou
- **Fix v26.3:** Branch por status 401/429/400/5xx com mensagem humana

**IA3. `psmIARodar` chama `getMetricas()` sem args**
- Assinatura canonica: `getMetricas(bid, prefix)`
- Sem bid retornava {} OU crashava
- IA recebia payload vazio
- **Fix v26.3:** Usa `getMetricasGlobal('dash')` (visao agregada)

**IA4. Cache key fraco (200 chars)**
- Prompts com mesmo preambulo = cache colisao
- **Fix v26.3:** hash djb2 sobre prompt inteiro

**IA5. Sem retry em 5xx/timeout**
- Gemini ocasionalmente 503 = falha definitiva
- **Fix v26.3:** 2 retries com backoff exponencial (1s, 2s)

### ALTA

**IA6. `S.historicoMensal` nunca populado**
- `preverVenda(hist, atual)` recebe sempre `[]`
- Forecast sempre "baixa confianca"
- **Nao corrigido v26.3** — exige job mensal que snapshota VGV/vendas
- **Backlog v26.4:** cron SW gera snapshot dia 1 de cada mes

**IA7. Sem fallback local em preverVenda**
- IA caiu = `{previsto:0}`
- **Fix v26.3:** fallback matematico (media historico + ritmo atual)

**IA8. Erro Gemini não visivel ao user**
- Console.log talvez, mas sem toast nem Sentry
- **Fix v26.3:** Sentry.captureException em todo catch + mensagem propagada ao modal

**IA9. Rate limit invisivel**
- 429 = user ve "erro generico"
- **Fix v26.3:** mensagem explicita "Aguarde 60s"

### MEDIA

**IA10. Sem debug mode**
- Impossivel inspecionar prompt/response em prod
- **Fix v26.3:** `psmIA._debug(true)` loga attempt/len/raw

**IA11. Sem healthCheck**
- User nao sabe se key ta valida sem rodar caso real
- **Fix v26.3:** `psmIA.healthCheck()` pinga "Diga OK" e retorna {ok, error, hasKey}

**IA12. Parser JSON fragil**
- So pegava ```json ou {...}`. Gemini as vezes devolve [...].
- **Fix v26.3:** matcher tambem array + code block generico

---

## O QUE CONTINUA NAO FUNCIONANDO

### Bloqueadores externos

**Config Gemini key**
- Se `S.connectors.gemini_key` OU `localStorage.psm_gemini_key` vazio → tudo morre
- UI: `Configuracoes -> Conectores -> Gemini`
- **Testar:** `psmIA.healthCheck().then(console.log)` no console

**Historico mensal ausente**
- Sem 6 meses de histórico, forecast é chute
- **Solucao:** popular manual em Configuracoes OU criar job que salva 1x/mes

### Bloqueadores do proprio prompt

**Prompt `scoreLead` pede contexto que RD CRM nao entrega**
- `dias_funil`, `interacoes`, `orcamento` — RD tem mas nao mapeado em `o.`
- `psmScorarOpp` monta lead com fallback 0
- IA recebe `{dias_funil:0, interacoes:0, orcamento:0}` = score inutil
- **Backlog v26.4:** enriquecer `o.dnu` (dias no funil) + `o.intc` via RD CRM webhook

**Prompt `preverVenda` tem historico sempre vazio (ver IA6)**

---

## TESTES DE FUMAÇA — v26.3

```js
// 1. Health check
psmIA.healthCheck().then(console.log)
// esperado: {ok:true, raw:"OK", hasKey:true}

// 2. Debug ON
psmIA._debug(true)

// 3. Score lead manual
psmIA.scoreLead({nome:"Teste", fonte:"site", dias_funil:3, interacoes:5, orcamento:450000, regiao:"SJRP"}).then(console.log)
// esperado: {score:N, motivo, proxima_acao}

// 4. Previsao com historico
psmIA.preverVenda([{mes:"jan",vgv_real:2000000},{mes:"fev",vgv_real:1800000}], {vgv_real:900000, du_pass:11, du_tot:22}).then(console.log)
// esperado: {previsto:N, confianca, base, risco}

// 5. Cache clear (se precisar)
psmIA._clearCache()
```

---

## RESUMO

| Item | Antes (v23.1) | v26.3 |
|---|---|---|
| Timeout | ∞ | 25s |
| HTTP error handling | silencioso | explicito 401/429/400/5xx |
| Retry | 0 | 2x backoff exp |
| Cache key | prompt[0:200] | hash djb2 full |
| Fallback preverVenda | `{previsto:0}` | projecao linear local |
| healthCheck | nao | sim |
| Debug mode | nao | sim |
| Sentry | alguns spots | todos catches |
| getMetricas() sem args (psmIARodar) | bug | corrigido |
| JSON parser | 2 regexes | 4 regexes |

---

## RESTA (v26.4+)

- Popular `S.historicoMensal` (job mensal ou backfill manual em Config)
- Enriquecer `o.dnu` + `o.intc` em oportunidades (mapeamento RD)
- Grafico forecast 6m (em vez de JSON cru)
- Ranking de leads com pontuacao IA + CTA de acao
- Analise por perfil IBC (D/I/S/C) — cruzar com `u.ibc` para sugerir acoes personalizadas
