# AUDITORIA v21 — PSM OS (2026-04-19)

## MUDANÇAS v21

### 1. PSM Live — Diretoria + topo do Modo TV
- Nova entrada `{id:'psm_live', lbl:'PSM Live', ico:'📡'}` em Diretoria (após Recados Diretoria).
- Página `pgPsmLive()` com CRUD completo: form (tipo/ícone/dias de expiração/mensagem) + lista cronológica reversa com edit/del.
- Storage reutiliza `S.timelineItems` existente (já usado por renderGlobalTimeline).
- Permissão de edição: `lvl>=5` ou role socio/diretor/lider/backoffice.
- `psmLiveAdd/psmLiveEdit/psmLiveDel` expostos em window.
- Auto-expiração: itens com `exp<now` são filtrados em render.

**Top bar gigante no Modo TV:**
- Nova barra fixa 76px no topo com badge "● PSM LIVE" (gradient dourado) + marquee infinito.
- Animação CSS `psmMarquee` 60s linear infinite + `psmPulse` 1.6s para o indicador.
- Conteúdo concatenado de `S.timelineItems` com ícones, duplicado pra loop suave.
- Split container ajustado: `top:76px`, `height:calc(100vh - 56px - 76px)`.
- `renderPsmLive()` refresca junto com `renderTimeline()` a cada 15s.

### 2. Timeline TV com 12 fontes (novidades reais)
`buildTimeline()` foi reescrita. Agora agrega tudo que é atualizado no sistema:

1. VENDAS recentes (últimas 20, exclui sócios)
2. `S.timelineItems` — PSM Live (inclui perpétuos, guarda `exp && exp<now`)
3. `S.arenaRecados` — recados Diretoria (inclui perpétuos com exp=0)
4. `S.oportunidadesPSM` — publicadas
5. `S.gpTreinamentos` — Gestão de Pessoas
6. `S.gpReunioes` — 1:1
7. `S.gpTalentos` — base de talentos
8. `S.locContratos` — contratos de locação
9. `S.lancamentos` — lançamentos
10. `S.agenda` — eventos ±30 dias
11. Premiações top 3 do mês (medalhas)
12. Alertas críticos (staleCrm ≥5)

Métricas VGV/pipeline continuam escopadas ao período 'war' (mês vigente) via `getMetricas`/`getMetricasGlobal` — mês vigente por padrão.

### 3. Funil RD CRM TV inicia em Novo Atendimento
`sceneFunilCRM._funilData()` agora filtra estágios: `stages = _rawStages.filter(s => s.id !== 'carteira')`. A etapa Carteira é ignorada tanto visualmente quanto na contagem/VGV/conversão. Afeta TOTAL, MAP e CONQUISTA.

### 4. Métricas OO por corretor no TV
`sceneRankingOO()` reescrita:
- Consolida ag (ooAggMonth) + rd (ooAggMonthRD) em lig/vis/prop
- Lê `S.metaIndiv[b.id][mk]` para metaLig/metaVis/metaProp
- Ordena por score composto (lig + vis×3 + prop×5)
- Cada célula mostra `real/meta · %` com cor semafórica (verde ≥100, dourado ≥70, laranja ≥40, vermelho <40)
- Label: "ONE ON ONE — Métricas × Meta · <Mês>"
- SCENES key `ONEONONE` label atualizado: `OO × Meta`

### 5. Ranking Anual no TV
Nova `sceneRankingAnual()`:
- Agrega `VENDAS` do ano atual por `bid` (vgv + vendas)
- Soma `S.metaIndiv[b.id][mk]` de todos os 12 meses pra meta anual
- Exclui sócios
- Ordena por VGV descendente
- Mostra posição, iniciais, barra gradient, VGV, vendas e % meta anual
- Header: `RANKING ANUAL <ANO> — N Corretores · M vendas · VGV total`
- Key `RANK_ANUAL` adicionada ao array SCENES (dur:14000)

### 6. Otimização de espaço vazio nas cenas
**sceneHero:**
- Números menores (clamp 48-90px em vez de 56-110px)
- Adiciona bloco "Pódio do Mês" com top 3 (medalhas + VGV + vendas)

**scenePulse:**
- Limita vendas a 6 (altura ≤50%)
- Se `topOpps.length > 0`, adiciona "Top Oportunidades Abertas" (até 8) com border-left azul
- Filtra opps `vgv>0 && st_psm != carteira/perdido/ganho`

### 7. Layout TV ajustado
- Split grid ocupa `calc(100vh - 56px - 76px)` (footer + top bar)
- z-index top bar: 100001 (acima do split, igual ao footer)
- keyframes injetados uma única vez via `#tv-psm-live-style`

## VALIDAÇÃO

- Sintaxe JS: **0 erros** (4 scripts inline via `node --check`)
- sw.js: **OK**
- Versão: `v20` → `v21`
- SW cache: `psm-os-v21-2026-04-19`

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v21)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v21)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v21.md`

## COMO USAR

**PSM Live (Diretoria):**
- Menu → Diretoria → PSM Live
- Form: tipo (evento/recado/premiação/oportunidade/urgente), ícone, prazo em dias (0=perpétuo), mensagem
- Editar/excluir na lista
- Aparece automaticamente no topo do Modo TV (marquee) + timeline lateral

**Modo TV v21:**
- Top bar gigante rolando com PSM Live
- Ranking Anual entra na rotação de cenas
- Funil CRM inicia em Novo Atendimento
- Hero mostra Pódio do Mês
- Pulse mostra Vendas + Top Opps
- OO exibe métricas × meta com % de atingimento
