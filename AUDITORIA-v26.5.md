# v26.5 — Logo PSM oficial em posts gerados (2026-04-21)

## PEDIDO DO USUARIO

> "e eu nao quero que voce crie vetores do logo da psm imoveis mais, use a imagem logo oficial para ser os icones, porque esses atuais estao horriveis! corrija isso!"

Posts criados pelo Gerador de Imagens (DALL-E / Gemini Imagen) saiam com **vetores horriveis do logo PSM** desenhados pela IA.

---

## CAUSA RAIZ

`giBrandPrompt()` enviava as Brand Guidelines (cores, fontes, tom, regras) para o gerador de imagens, mas:

1. `GI_BRAND_DEFAULTS.imoveis.logo = ''` (vazio) e `.conquista.logo = ''` (vazio)
2. Sem logo de referencia, IA inventava letras "PSM" como marca grafica
3. Resultado: monogramas amadores, kerning errado, cores deslocadas

---

## CORRIGIDO

### 1. Brand defaults agora apontam para PNGs reais

| Marca | Logo |
|---|---|
| `imoveis` | `logo-psm-navy.png` (local, 256x256) |
| `conquista` | GitHub raw `logo psm conquista.png` |

### 2. `giBrandPrompt()` ganha REGRA CRITICA

Adicionado bloco no prompt enviado a IA:

```
=== REGRA CRITICA - LOGO ===
PROIBIDO desenhar, vetorizar, estilizar ou inventar QUALQUER versao do logo "{nome}".
PROIBIDO escrever as letras "PSM", "P S M", "PSM IMOVEIS" ou "PSM CONQUISTA"
como marca grafica/iniciais/monograma.
OBRIGATORIO reservar uma area limpa de 180x60px no canto inferior direito
(fundo solido na cor da marca, SEM texto, SEM forma, SEM marca dagua) —
o logo OFICIAL em PNG sera sobreposto em pos-producao pelo sistema.
=== FIM REGRA CRITICA ===
```

Tambem incluido nas `regras` da brand (item 11) para reforco redundante.

### 3. Composicao client-side: `giCompositeLogo(imageUrl)`

Funcao nova que:

- Carrega imagem gerada + logo oficial PNG
- Cria canvas 1024x1792 (ou tamanho da geracao)
- Desenha imagem base
- Sobrepoe fundo branco semi-transparente (`rgba(255,255,255,0.92)`) como caixa
- Desenha logo PNG por cima (max 18% largura, 6% altura, mantendo aspect ratio)
- Padding `2.5%` da borda inferior direita
- Retorna data URL PNG composta
- Fallback: se logo nao carrega ou falha, devolve imagem original

Hooks aplicados em **3 pontos**:

1. `giGenerate()` — geracao em lote (carrossel completo)
2. `giRegen(idx)` — regerar 1 slide
3. `giRefine(idx)` — aplicar ajuste com instrucao

### 4. Migracao automatica de localStorage

`giLoadBrands()` detecta brands salvas com `logo: ''` (defaults antigos) e injeta a URL oficial automaticamente. Persiste de volta no localStorage.

---

## ARQUIVOS

- `index.html` — bump v26.5 + GI_BRAND_DEFAULTS + giBrandPrompt + giCompositeLogo + 3 hooks + migracao
- `sw.js` — `psm-os-v26-5-2026-04-21`
- `AUDITORIA-v26.5.md` — este

---

## DEPLOY

1. `index.html`
2. `sw.js`

(Logos PNG ja estao no repo e GitHub)

---

## SMOKE TEST

1. Recarregar com SW v26.5 ativo
2. Diretoria > Gerador de Imagens
3. Trocar tab para "imoveis" ou "conquista"
4. Selecionar post -> Gemini -> Gerar
5. Imagem final deve ter logo PNG real no canto inferior direito (NAO vetor PSM amador)
6. Console: `S.giBrands.imoveis.logo` -> `'logo-psm-navy.png'`
7. Console: `S.giBrands.conquista.logo` -> URL GitHub conquista

---

## VERSAO

`26.4 -> 26.5` (header HTML, meta tag, sidebar, SW)

---

## VEREDITO

IA agora **proibida** de desenhar logos PSM (3 reforcos: prompt brand, regra critica, regras visuais).
Posts gerados sempre recebem logo PNG real composto via canvas.
Migracao automatica garante que sessoes antigas tambem usem logo oficial.
