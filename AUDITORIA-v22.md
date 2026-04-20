# AUDITORIA v22 — PSM OS (2026-04-19)

## CONTEXTO

Correção honesta após auditoria apontada pelo usuário. v21 deixou pendências que estavam sendo tratadas como feitas. v22 zera o débito.

## NEGLIGÊNCIAS ADMITIDAS (v21)

1. **Funil TV "iniciar em Novo Atendimento"** — v21 só filtrou `carteira`. Funis `terceiros`/`locacao` têm `precisa_im` antes. Incompleto.
2. **Otimizar espaço vazio** — v21 só mexeu em Hero + Pulse. Outras 6+ cenas com espaço vazio ficaram de fora.
3. **PSM Live em todas páginas** — só foi injetado no Modo TV. `renderGlobalTimeline` tinha ID errado de overlay TV (`arenaTvOv` em vez de `arena-tv-overlay`) e podia aparecer duplicado.
4. **Favicon oficial PSM.IMÓVEIS** — foi gerado genérico via Python/PIL. Bloqueado até usuário salvar PNG oficial.
5. **Teste IBC revelando perfil ao responder** — opção selecionada mostrava ícone/cor do perfil, enviesando resposta.

## CORREÇÕES v22

### 1. Funil TV — slice a partir de `novo_atend`
`sceneFunilCRM._funilData()` linha ~4433:
```js
var _rawStages = FUNIS['lancamento'] || [];
var _ixNovo = _rawStages.findIndex(function(s){ return s.id === 'novo_atend'; });
var stages = _ixNovo >= 0 ? _rawStages.slice(_ixNovo) : _rawStages.filter(function(s){ return s.id !== 'carteira'; });
```
Agora corta todos os estágios anteriores a Novo Atendimento (inclui `carteira`, `precisa_im`).

### 2. IBC teste — seleção neutra
Linha ~12662. Troca do ícone do perfil por check verde genérico:
- Não-selecionado: círculo vazio `2px solid #cbd5e1`
- Selecionado: círculo verde `#10b981` com `✓` branco
- Background da opção: sem cor do perfil (`rgba(16,185,129,0.10)` neutro)
- Perfil/ícone/cor só aparecem no resultado final após completar 25 questões.

### 3. renderGlobalTimeline — ID correto
Linha ~22332. Checa `arena-tv-overlay` além dos demais para não duplicar a barra no TV:
```js
if(document.getElementById('warTvOv') || document.getElementById('dashExecTvOv') ||
   document.getElementById('arenaTvOv') || document.getElementById('arena-tv-overlay')) return '';
```
PSM Live agora aparece de verdade em todas páginas (injetado via `render()` linha 26108).

### 4. Otimização de espaço — cenas TV

**sceneMetasIndiv** — 4 cards agregados no topo (VGV total, Visitas, Captações, Propostas com real/meta e %).

**sceneVolume** — 4 cards agregados (Ligações real/meta, Δ Ligações, Visitas real/meta, Δ Visitas).

**sceneAlertas** — quando `alertas.length===0`, mostra bloco verde "Ritmo saudável — sem alertas críticos" + Top 3 destaques do mês (com medalhas 🥇🥈🥉, VGV e %).

**sceneProjecoes** — reescrita:
- 3 cards em grid horizontal (Fim do Mês, Ritmo/Dia, Forecast Anual) em vez de empilhados
- Bloco novo "Top 5 Gap vs. Meta · Prioridade" abaixo com os 5 corretores com maior gap, ícone vermelho, valor do gap em BRL e % de atingimento.

**sceneRankingOO** — 4 cards agregados no topo (Lig total/meta, Vis total/meta, Prop total/meta, F.up total) com barras coloridas e % de atingimento consolidado.

### 5. Verificações v20/v21 — intactas
- `pgGestaoPessoas` (Treinamentos/Reuniões/Base de Talentos) presente.
- `pgPsmLoc` + `locContratos` (PSM Locações 6 páginas) presente.
- `pgPsmLive` + `psmLiveAdd/Edit/Del` (Diretoria) presente.
- `renderGlobalTimeline` chamado em `render()` linha 26108 — aparece em TODAS páginas logadas.

## VERSÃO

- index.html linha 1: `v2026.04.19-v22`
- index.html meta linha 10: `content="2026.04.19-v22"`
- index.html sidebar linha 22429: `OS v22`
- sw.js: `const CACHE_VERSION = 'psm-os-v22-2026-04-19'`

## VALIDAÇÃO

```
=== inline scripts (4) ===
script 0: 1106 chars — OK
script 1: 75135 chars — OK
script 2: 439843 chars — OK
script 3: 1403872 chars — OK
=== sw.js === OK
```

Total: **0 erros de sintaxe**.

## FAVICON — PENDÊNCIA HONESTA

Os PNGs oficiais PSM.IMÓVEIS (cream + navy) não foram salvos em `/mnt/uploads`. Sem isso não há como gerar `favicon-16/32/apple-touch-icon/icon-192/icon-512` com a identidade correta. Os arquivos atuais são genéricos de v17.

**Ação requerida do usuário:** arrastar as 2 imagens oficiais para o chat e solicitar geração do favicon; ou salvar manualmente em `/mnt/outputs/` com os nomes exatos já referenciados em `manifest.json`.

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v22, 27473 linhas)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v22)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v22.md`

## RESUMO EXECUTIVO

| Item | v21 | v22 |
|---|---|---|
| Funil TV Novo Atend | só `carteira` | slice a partir de `novo_atend` |
| IBC teste neutro | revelava ícone/cor | check verde genérico |
| PSM Live todas páginas | só TV | todas páginas (render linha 26108) |
| Cenas otimizadas | Hero + Pulse | Hero + Pulse + Metas + Volume + Alertas + Projecoes + RankingOO |
| Favicon oficial | genérico | **pendente — bloqueado por arquivos** |
