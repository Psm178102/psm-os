# AUDITORIA v26.1 — PSM OS (2026-04-21)

## SALTO v23.3 -> v26.1

v23.3 entregou IA (scoreLead, historico, PDF export). v26.1 abre frente **BI Socio (lvl 10)** — visibilidade financeira/estrategica exclusiva dos socios.

## PAGINA NOVA — BI Socio

Rota `bi_socio` (lvl 10 / PAGES_DIRETORIA). 4 cards:

### Card 1 — Lucro por Corretor
- VGV_real (mes vigente) x comissao% (`S.comissaoPct` default 6%)
- Menos custo fixo R$ 3.500/corretor (editavel v26.2)
- Tabela ordenada desc lucro, top 15 + TOTAL
- Lucro verde/vermelho

### Card 2 — ROI por Canal
- Agrupa `S.OPPS + S.VENDAS` por `o.fonte|canal|source`
- Leads / Vendas / Conv% / VGV / Comissao
- Top 10 canais

### Card 3 — Forecast 6 meses (IA)
- Botao `Gerar Forecast 6m` -> `psmBiForecast6m()`
- Chama `window.psmIA.preverVenda(S.historicoMensal, {atual})`
- Cacheia em `localStorage.psm_bi_forecast_6m`
- Renderiza JSON formatado

### Card 4 — Comparativo Mercado SJRP
- Benchmarks SECOVI-SP / CBIC / FipeZap (2025-2026)
- Ticket medio R$ 480k, conversao 2,8%, ciclo 45d, YoY +8,4%, MCMV 62%
- PSM confrontado com cada indicador

## MUDANCAS

| Arquivo | Linha | De | Para |
|---|---|---|---|
| index.html | 1 | v23.3 | v26.1 |
| index.html | 10 | v23.3 | v26.1 |
| index.html | 23033 | — | `+'bi_socio'` em PAGES_DIRETORIA |
| index.html | 23100 | — | nav item `BI Socio` (menu Diretoria) |
| index.html | 23456 | — | `case 'bi_socio': return pgBiSocio();` |
| index.html | ~27105 | — | `function pgBiSocio()` + `psmBiForecast6m()` |
| index.html | 23201 | OS v23.3 | OS v26.1 |
| index.html | 28697 | `psm-os-v23.3` | `psm-os-v26.1` |
| sw.js | 2 | v23.3 | v26.1 |
| sw.js | 8 | `psm-os-v23-3-...` | `psm-os-v26-1-2026-04-21` |

## DEPENDENCIAS

- `window.psmIA.preverVenda` (de `lib/psm-ia.js` v23.1)
- `getMetricas(bid, 'dash')` / `getMetricasGlobal('dash')`
- `S.comissaoPct`, `S.OPPS`, `S.VENDAS`, `S.historicoMensal`
- `psmEscape()` para sanitizar nomes

## VALIDACAO

```
sw.js                 : node --check OK
lib/psm-ia.js         : node --check OK
lib/psm-supabase.js   : node --check OK
inline scripts        : 11/11 OK
```

## SMOKE TEST

1. Login socio (lvl 10)
2. Sidebar Diretoria > `👑 BI Socio`
3. Ver 4 cards renderizados
4. Card 1: tabela com ate 15 corretores + TOTAL
5. Card 2: canais agrupados
6. Card 3: click `Gerar Forecast 6m` -> aguardar Gemini -> ver JSON
7. Recarregar: forecast persiste (localStorage)
8. Card 4: 5 linhas benchmark SJRP

## LIMITACOES CONHECIDAS

- Custo fixo R$ 3.500 hardcoded — v26.2 configuravel em Configuracoes
- Benchmarks mercado estaticos — v26.4 vai cruzar com Radar Concorrencia
- ROI canal nao considera CAC (custo de aquisicao por canal) — v26.2
- Forecast 6m mostra JSON bruto — v26.3 vai renderizar grafico recharts

## PROXIMO — v26.2

- Editar custo fixo + CAC por canal (Configuracoes)
- Calculo ROI real (VGV x comissao - CAC x leads)
- Input de meta de lucro mensal
- Comparar projetado vs realizado por canal

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v26.1, ~29.000 linhas)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v26.1)
- `/sessions/magical-funny-feynman/mnt/outputs/lib/psm-ia.js` (v23.1, inalterado)
- `/sessions/magical-funny-feynman/mnt/outputs/lib/psm-supabase.js` (inalterado)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v26.1.md` (este)

## ACOES USUARIO — GITHUB

Push no repo `Psm178102/psm-os`:

1. `index.html` (sobrescrever)
2. `sw.js` (sobrescrever)

(libs + audit sao opcionais — apenas index.html + sw.js afetam comportamento em prod)
