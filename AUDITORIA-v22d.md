# AUDITORIA v22d — PSM OS (2026-04-19)

## CONTEXTO

Quatro correções pedidas pelo usuário após v22c, baseadas em print da tela Modo TV + planilha `Nomes.xlsx`:
1. Timeline TV: adicionar oportunidades, premiações, eventos.
2. Timeline TV: remover vendas/fatos de meses anteriores.
3. Cenas TV com espaços vazios.
4. Rankings com métricas resumidas/incompletas.
5. Base de Talentos: campo @ Instagram.
5.1. Pré-popular Base de Talentos com `Nomes.xlsx` (74 candidatos).

## CORREÇÕES v22d

### 1. Timeline TV — filtro mês vigente + categorias já incluídas
`buildTimeline()` (linha ~4385) reescrita:
- Calcula janela `_mStart` / `_mEnd` (mês vigente)
- **Vendas**: só do mês vigente (até 30 itens, era 20)
- **Oportunidades PSM**: só do mês vigente
- **Treinamentos**: só do mês vigente
- **Reuniões 1:1**: só do mês vigente
- **Talentos**: só criados no mês vigente
- **Contratos Locação**: só do mês vigente
- **Lançamentos**: só com dataUpd/dataCreated no mês vigente
- **Agenda PSM**: janela mês ±7 dias (permite próximos compromissos)
- **PSM Live** + **Recados Arena**: mantidos (já têm lógica `exp` de expiração)
- **Premiações top 3**: mantidas (já usam getMetricas('war') = mês vigente)
- **Alertas CRM (leads parados)**: mantidos (estado atual)
- Slice final: 80 itens (era 50)

Efeito: timeline não mostra mais `Venda fechada R$ 187.080 ------` de meses passados.

### 2. sceneRanking — agregados no topo (otimiza espaço vazio + métricas completas)
Header agora inclui 4 cards KPI acima da lista:
- **VGV Total** (amarelo) — soma + meta consolidada
- **Vendas** (verde) — quantidade + ticket médio
- **% Meta Consolidada** (verde/âmbar/vermelho) — barra de progresso
- **Ativos / Meta ≥100%** (azul) — quantos venderam e quantos bateram meta

### 3. sceneRankingAnual — agregados no topo
Header agora inclui 4 cards KPI acima da lista:
- **VGV Ano** — soma + meta anual consolidada
- **Vendas** — total + ticket médio anual
- **% Meta Anual** — com barra de progresso
- **Top Performer** — nome + VGV do #1

### 4. Base de Talentos — campo @ Instagram
`_gpTalentos()` (linha ~7604):
- Novo input `@ Instagram` no formulário (normalizado sem `@` leading)
- Nova coluna `@ Instagram` na tabela com link direto `https://instagram.com/<handle>` (rosa #ec4899)
- `gpAddTalento` grava campo `instagram`
- `gpEditTalento` prompt adicional para editar Instagram

### 5. Seed inicial — 74 candidatos de `Nomes.xlsx`
Dentro de `pgGestaoPessoas()` após `if(!S.gpTalentos) S.gpTalentos = [];`:
```js
if(!S._talentosSeedV1){
  var _SEED_TALENTOS = [...74 candidatos...];
  // dedupe por nome (case-insensitive trim), insere só quem falta
  S._talentosSeedV1 = true;
  saveState();
}
```
Dados extraídos e normalizados:
- `nome` — limpo (removidos "XXX", iniciais duplicadas, etc.)
- `setor` — coluna TIME (origem/indicação: PSM, PEIXE, MARCUS LOPES, RODRIGO TRIVELLATO, KADU - INDICACAO, etc.)
- `funcao` — coluna LOCAL (local atual: TARRAF, VITTA, FG, SHIMANA, etc.)
- `cenario` — concatena CRECI, Perfil, Vaga, Disponibilidade, Apresentação, Status, Prazo, Aceito (com separador `·`)

Flag `_seed:true` marca registros para eventual limpeza futura.
Executa uma única vez por estado local (flag `S._talentosSeedV1`).

## VERSÃO

- `index.html` linha 1: `v2026.04.19-v22d`
- `index.html` meta linha 10: `content="2026.04.19-v22d"`
- `index.html` sidebar: `OS v22d`
- `sw.js`: `const CACHE_VERSION = 'psm-os-v22d-2026-04-19'`

## VALIDAÇÃO

```
inline scripts: 4
script 0: 1106 chars — OK
script 1: 75135 chars — OK
script 2: 454526 chars — OK  (+15 KB: seed talentos + KPIs agregados)
script 3: 1442397 chars — OK
sw.js — OK
TOTAL ERRORS: 0
```

## OBSERVAÇÕES

- Item 6 ficou em branco no pedido do usuário.
- Premiações Top 3 (medalhas 🥇🥈🥉) já apareciam no timeline (item 11 do buildTimeline) — visíveis no print do usuário ("Marcus Lopes 1º lugar do mês R$ 780.001"). Categoria está funcional.
- sceneEquipes, sceneMetasIndiv, sceneVolume, sceneRankingOO já tinham cards agregados no topo desde v22.
- sceneHero, scenePulse, sceneAlertas, sceneProjecoes, sceneFunilCRM, sceneAproveitamento, sceneVolumeAprov — layout cheio, sem espaço morto residual significativo.

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v22d)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v22d)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v22d.md`

## RESUMO EXECUTIVO

| Item | v22c | v22d |
|---|---|---|
| Timeline TV vendas fora do mês | aparecia | filtrado por mês vigente |
| Oportunidades/Premiações/Eventos | já presentes | mantido + filtro mês |
| sceneRanking (métricas) | só VGV/vendas/% | + 4 cards KPI (ticket, ativos, meta ≥100%) |
| sceneRankingAnual | só VGV/vendas/meta | + 4 cards KPI (ticket anual, top performer) |
| Talentos @ Instagram | ausente | input + coluna + link rosa |
| Seed Talentos | 0 | 74 candidatos importados |
