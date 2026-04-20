# AUDITORIA v22e — PSM OS (2026-04-19)

## CONTEXTO

Seis grupos de correções pedidos pelo usuário após v22d:
1. Corretores NÃO veem PSM Locações nem Gestão de Pessoas.
2. Sócios sempre veem tudo (já estava OK).
3. Marcos Anderson enxerga Gestão de Pessoas (login ainda não criado).
4. Mariane enxerga Locações.
5. Modo TV Arena PSM:
   5.1. Marquee PSM Live mais rápido.
   5.3. Preencher espaços vazios nas telas.
   5.4. Rankings completos com todas as métricas.
   5.5. Timeline de Lançamentos 2026.
   5.6. Novo ranking RD CRM (imagem anexada).
6. Anexar imagem/vídeo em Recados Arena e PSM Live → aparecer no Modo TV.

## CORREÇÕES v22e

### 1. Usuário marcos_anderson + permissões refinadas

`USERS_BASE` (linha ~921): adicionado
```js
{id:'marcos_anderson',name:'Marcos Anderson',ini:'MN',color:'#d4a843',role:'socio',frente:null,email:'marcos@imobiliariapsm.com.br',rdId:''}
```

`PERFIL_MAP` (linha 21245): `marcos_anderson:'diretor'` — entra como sócio/diretor.

Novo helper (linha ~21251):
```js
function isUserMarcosAnderson(){return S.user&&S.user.id==='marcos_anderson';}
```

`canAccess()` ajustado (linhas 22585-22588):
- **PAGES_LOCACOES**: `isUserSocio() || isGestorOrSocio() || isUserMariane()` — removido corretor, adicionada Mariane.
- **PAGES_GP**: `isUserSocio() || isGestorOrSocio() || isUserMarcosAnderson()` — Marcos Anderson incluído.

Efeito: corretores perdem acesso direto ao menu Locações e GP (sidebar e navegação). Mariane ganha acesso completo às 6 páginas de Locações. Marcos Anderson ganha acesso às 3 abas de Gestão de Pessoas.

### 2. Marquee PSM Live mais rápido

`renderPsmLive()` (linha ~5133): animação `psmMarquee` reduzida de **60s → 25s** (~2.4× mais rápido). Letreiro agora completa volta em 25 segundos — texto fica legível por mais tempo em cada rotação de cena.

### 3. Nova cena TV: **Ranking RD CRM Completo** (sceneRankingCRM)

Tabela densa com TODAS as métricas da imagem anexada pelo usuário:
- **#** (posição) — medalhas 🥇🥈🥉 top 3
- **Corretor** (avatar colorido + nome)
- **Frente** (badge colorido: Conquista/MAP/Terceiros/Locação)
- **VGV Realizado** (número completo BR)
- **V** vendas (verde)
- **P** perdidas (vermelho)
- **Conv%** conversão (verde/âmbar/vermelho)
- **Ag** agendamentos (azul)
- **Vis** visitas (roxo)
- **Pr** propostas (ciano)
- **CRM Score** (verde ≥80, âmbar ≥65, vermelho <65)

Header com 4 cards KPI agregados:
- VGV total
- Vendas / Perdidas
- Conversão consolidada (%)
- CRM Score médio

Ordenação: VGV decrescente (mesmo critério da imagem).

### 4. Nova cena TV: **Lançamentos 2026** (sceneLancamentos)

Grid 4×3 (12 meses) com:
- KPIs topo: Total / Já Lançados / A Lançar
- Cada mês vira card com cor baseada em estado:
  - **Passado** (verde): meses <= atual
  - **Atual** (dourado, pulsa com ●): mês vigente
  - **Futuro** (azul): meses a frente
- Lista de lançamentos do mês (até 4, +N mais se exceder)
- Cor da borda esquerda de cada lançamento preservada da timeline editorial

Fonte: `S.lancTimeline` (mesmo dado da página Lançamentos).

### 5. Array SCENES atualizado

Ordem de cenas (linha ~5075):
```
HERO · RANKING · RANK_ANUAL · RANK_CRM · LANC_2026 · FUNIL · PULSE · EQUIPES · METAS · APROV · VOL_APROV · VOLUME · ONEONONE · PROJECOES · ALERTAS
```
Total: **15 cenas** (antes: 13).

### 6. Mídia em Recados Arena

`pgRecadosDiretoria` (linha ~7210):
- Novo botão `📎 Anexar imagem/vídeo` com `<input type="file" accept="image/*,video/*">`
- Preview inline após upload com botão remover
- Validação: max 8MB (base64 data URL armazenado em `window._recDirMedia`)
- `publicarRecadoDir()` persiste `rec.media = {url, type, name}`
- Lista de recados mostra thumbnail (img 240×160 ou video controls)

### 7. Mídia em PSM Live

`pgPsmLive` (linha ~7304):
- Mesmo padrão (`📎 Anexar imagem/vídeo` → `window._plMedia`)
- `psmLiveAdd()` grava `media` no item
- Lista de itens ativos mostra thumbnail + badge "📎 image/video"

### 8. Mídia no Modo TV

`buildTimeline()` (linhas 4425, 4435): campo `media` propagado de `timelineItems` e `arenaRecados` para os itens de timeline.

`renderTimeline()` (linha ~4564): cards da timeline agora renderizam abaixo do texto:
- **Imagem**: `<img>` com `object-fit:cover`, max-height 120px
- **Vídeo**: `<video autoplay loop muted playsinline>` para tocar sem som na TV

Efeito: qualquer recado ou anúncio PSM Live publicado com mídia aparece com thumbnail visual na timeline lateral direita do Arena PSM Modo TV.

## VERSÃO

- `index.html` linha 1: `v2026.04.19-v22e`
- `index.html` meta linha 10: `content="2026.04.19-v22e"`
- `index.html` sidebar: `OS v22e`
- `sw.js`: `const CACHE_VERSION = 'psm-os-v22e-2026-04-19'`

## VALIDAÇÃO

```
inline scripts: 8 (4 curtos + 4 grandes)
script 4: 1106 chars — OK
script 5: 75279 chars — OK
script 6: 469937 chars — OK (+15 KB: 2 cenas TV + midia)
script 7: 1442559 chars — OK
sw.js — OK
TOTAL ERRORS: 0
```

## RESUMO EXECUTIVO

| Item | v22d | v22e |
|---|---|---|
| Corretor vê Locações | sim | **não** |
| Corretor vê GP | não | não (mantido) |
| Mariane vê Locações | não (só Financeiro) | **sim** |
| Marcos Anderson vê GP | usuário inexistente | **usuário criado + acesso GP** |
| Marquee PSM Live | 60s | **25s** |
| Cena Ranking CRM | ausente | **sceneRankingCRM** (10 métricas) |
| Cena Lançamentos | ausente | **sceneLancamentos** (grid 12 meses) |
| Total cenas TV | 13 | **15** |
| Anexar mídia Recados Arena | não | **imagem/vídeo max 8MB** |
| Anexar mídia PSM Live | não | **imagem/vídeo max 8MB** |
| Mídia aparece na TV | — | **thumbnail inline no timeline** |

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v22e)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v22e)
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v22e.md`

## OBSERVAÇÕES

- Login do Marcos Anderson ainda não criado no sistema de autenticação externo. Usuário adicionado em `USERS_BASE` com email `marcos@imobiliariapsm.com.br` — basta criar credencial quando necessário.
- Mídia é armazenada como data URL (base64) no estado local. Limite 8MB por arquivo para não estourar localStorage. Para mídia grande, futuro upgrade deverá usar Storage externo (Firebase Storage ou similar).
- Vídeos no Modo TV rodam `muted` + `loop` (autoplay só funciona mudo em navegadores modernos).
- Cena `RANK_CRM` usa `getMetricas(bid, 'war')` — período mês vigente. Consistente com demais rankings.
- Cena `LANC_2026` lê direto de `S.lancTimeline`, respeitando edições manuais feitas na página Lançamentos.
- Grid de 12 meses na tela de Lançamentos destaca o mês atual com borda dourada pulsando (visual do print do usuário sobre "espaços vazios" foi priorizado com densidade alta).
