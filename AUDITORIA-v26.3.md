# AUDITORIA v26.3 — BI Socio fix + IA Engine rewrite (2026-04-21)

## CONTEXTO

User reportou (com prints) tres problemas:
1. Comissao 6% hardcoded — real eh 4%, caso a caso
2. Card 4 "Mercado SJRP" mostrava dados estimados como se fossem oficiais
3. IAs precisam atencao — o que nao funciona?

---

## CORRIGIDO

### BI Socio (lvl 10)

| # | Problema | Fix |
|---|---|---|
| BS1 | Comissao 6% hardcoded | Default 4%, soma caso a caso por `v.comissaoPct` em cada venda |
| BS2 | Custo fixo 3.500 hardcoded | Configuravel via `S.cfgBiSocio.custoFixo` |
| BS3 | Card 4 com SECOVI/CBIC/FipeZap inventado | Removido. Substituido por self-benchmark (so dados PSM) com disclaimer vermelho |
| BS4 | Reference a `pct` (renomeado pra `pctDefault`) | Atualizado em 2 spots |

### IA Engine (lib/psm-ia.js v23.1 -> v26.3)

Reescrita completa. 12 problemas corrigidos. Detalhes em `AUDITORIA-IA-v26.3.md`.

Resumo:
- Timeout 25s + AbortController
- HTTP error handling explicito (401/429/400/5xx)
- Retry 2x com backoff exponencial
- Cache key hash djb2 (em vez de prompt[0:200])
- Sentry integration em todo catch
- `healthCheck()` para diagnostico
- `_debug(true)` para inspecionar prompts
- Fallback matematico em `preverVenda` se IA cair
- Parser JSON 4 regexes (era 2)

### Bug critico corrigido em `psmIARodar`

`getMetricas()` chamado sem args (assinatura eh `getMetricas(bid, prefix)`).
v26.3: usa `getMetricasGlobal('dash')`.

---

## VALIDACAO

```
sw.js                 : OK
lib/psm-ia.js         : OK (rewrite v26.3)
lib/psm-supabase.js   : OK
inline scripts        : 11/11 OK
versao                : 26.2 -> 26.3 (header, meta, sidebar, SW)
```

---

## SMOKE TEST

1. Recarregar com SW v26.3
2. Login socio (lvl 10) -> sidebar `BI Socio`
3. Card 1: comissao agora soma por venda (se vendas tem `v.comissaoPct`, usa; senao 4%)
4. Card 4: avisa em vermelho que benchmarks externos sairam, mostra so dados PSM
5. Console: `psmIA._version` deve retornar `'26.3'`
6. Console: `psmIA.healthCheck().then(console.log)` -> deve devolver `{ok:true, raw:"OK", hasKey:true}` se key configurada
7. Dashboard Executivo -> `Rodar IA` -> ja nao crash por `getMetricas()` sem args

---

## ARQUIVOS

- `index.html` (v26.3, ~29.500 linhas) — pgBiSocio + psmIARodar fix
- `sw.js` (v26.3) — cache version bump
- `lib/psm-ia.js` (v26.3) — engine rewrite
- `lib/psm-supabase.js` (inalterado)
- `AUDITORIA-v26.3.md` (este)
- `AUDITORIA-IA-v26.3.md` (auditoria IA detalhada)

---

## DEPLOY GITHUB `Psm178102/psm-os`

1. `index.html` (sobrescrever)
2. `sw.js` (sobrescrever)
3. `lib/psm-ia.js` (sobrescrever)

---

## DEFERIDO PARA v26.4

- Popular `S.historicoMensal` (job mensal salva snapshot VGV/vendas)
- Enriquecer `o.dnu` + `o.intc` em opps via mapeamento RD CRM
- Grafico forecast 6m (recharts) em vez de JSON cru
- Integracao real CBIC/SECOVI (ou remover comparativo definitivo)
- Configuracao UI para `comissaoPct` por venda + custo fixo por corretor
- Migracao 40 confirm()/prompt() para psmConfirm (deferido v26.2)
- CSP unsafe-inline removal (deferido v26.2)

---

## VEREDITO

3 problemas reportados, 3 corrigidos. IA agora tem diagnostico real (healthCheck, debug mode, mensagens explicitas) e nao falha silenciosamente. Comissao reflete realidade PSM. Card 4 nao mente mais sobre fonte de dados.

Pronto para v24 (mobile real) sem amplificar bugs ja conhecidos.
