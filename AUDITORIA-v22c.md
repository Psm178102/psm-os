# AUDITORIA v22c — PSM OS (2026-04-19)

## CONTEXTO

Três correções pedidas pelo usuário após v22b:
1. Favicon "horrível" — trocar pelo logo oficial PSM.
2. Código de Ética incompleto no Manual de Cultura e na aba própria — aplicar PDF oficial completo.
3. Remover opção "Kenlo" do menu Ferramentas.

## CORREÇÕES v22c

### 1. Favicon oficial PSM.IMÓVEIS
Regerados a partir de `logo-psm-navy.png` (upload oficial do usuário) via PIL:
- `favicon-16.png` (619 B)
- `favicon-32.png` (1.5 KB)
- `favicon.ico` (641 B — multi-size 16/32/48)
- `apple-touch-icon.png` (12.7 KB, 180×180)
- `icon-192.png` (10.4 KB, maskable, 20% padding)
- `icon-512.png` (35.3 KB, maskable, 20% padding)

Background navy `#0f172a`, logo centralizado com padding 10% (favicons) e 20% (maskable).
Referências em `<head>` linhas 18–24 já apontam para esses arquivos.

### 2. Código de Ética completo (17 capítulos, 69 artigos)
Extração via `pdftotext` do PDF oficial → 824 linhas estruturadas.

Adicionado `CODIGO_ETICA_CAPITULOS` (linha 14527 em diante) com estrutura:
```js
[{num, tit, intro, arts:[{n, t, c, m}, ...]}, ...]
```
- `num` — número do capítulo
- `tit` — título do capítulo
- `intro` — ementa de abertura
- `arts[].n` — número do artigo (ex: "1", "6-A", "21-A")
- `arts[].t` — título do artigo
- `arts[].c` — cláusula completa (conduta esperada ou proibida)
- `arts[].m` — medida / consequência

Adicionado `renderCodigoEticaCompleto()` (linha ~14646) que monta:
- Header gradiente navy com contagem "17 Capítulos · 69 Artigos"
- TOC clicável com todos os capítulos
- Cada capítulo em card com badge numerado, título e intro
- Cada artigo em card com borda dourada esquerda:
  - Artigo nº (dourado)
  - Título (navy, bold)
  - Cláusula (prose, line-height 1.7, preserva `\n` do PDF)
  - Callout âmbar "⚠️ Consequência" com a medida

Wiring (v22c):
- `pgManual` linha 14481: `var eticaContent = renderCodigoEticaCompleto();`
- `pgCodigoEtica` linha ~14696: `var eticaContent = renderCodigoEticaCompleto();`

Ambas as funções agora renderizam a versão completa do PDF oficial — não mais os 5 blocos genéricos.

### 3. Remoção de Kenlo do menu Ferramentas
- `PAGES_ALL` (linha 22376): removido `'kenlo'` do array
- `MENU` seção Ferramentas (linha 22493): removido item `{id:'kenlo',lbl:'Kenlo',ico:'🏠'}`

Mantidos para compatibilidade (não quebrar estado salvo):
- `pgKenlo()` e funções `kenloSaveAndTest/Sync/Filter/Export`
- `case 'kenlo': return pgKenlo()` no router
- `codigoKenlo` como campo em captações (metadado de imóveis)

Efeito: página não aparece mais no sidebar; canAccess bloqueia navegação direta (não está em PAGES_ALL).

## VERSÃO

- `index.html` linha 1: `v2026.04.19-v22c`
- `index.html` meta linha 10: `content="2026.04.19-v22c"`
- `index.html` sidebar linha 22559: `OS v22c`
- `sw.js`: `const CACHE_VERSION = 'psm-os-v22c-2026-04-19'`

## VALIDAÇÃO

```
inline scripts: 4
script 0: 1106 chars — OK
script 1: 75135 chars — OK
script 2: 439843 chars — OK
script 3: 1442397 chars — OK
sw.js — OK
```

Total: **0 erros de sintaxe**.

Delta script 3: v22b 1.403.872 → v22c 1.442.397 (+38 KB = estrutura completa do Código de Ética).

## ARQUIVOS

- `/sessions/magical-funny-feynman/mnt/outputs/index.html` (v22c)
- `/sessions/magical-funny-feynman/mnt/outputs/sw.js` (v22c)
- `/sessions/magical-funny-feynman/mnt/outputs/favicon.ico` + `favicon-16/32.png` + `apple-touch-icon.png` + `icon-192/512.png`
- `/sessions/magical-funny-feynman/mnt/outputs/AUDITORIA-v22c.md`

## RESUMO EXECUTIVO

| Item | v22b | v22c |
|---|---|---|
| Favicon | Python/PIL genérico | Logo oficial PSM.IMÓVEIS navy |
| Código de Ética | 5 blocos genéricos | 17 capítulos / 69 artigos (PDF oficial) |
| Kenlo menu | presente | removido |
| Wiring pgManual/pgCodigoEtica | HTML hardcoded | `renderCodigoEticaCompleto()` |
| Syntax | OK | OK |
