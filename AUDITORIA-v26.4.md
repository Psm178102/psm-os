# v26.4 — Multi-IA + 4 Personas (2026-04-21)

## PEDIDO DO USUARIO

1. Sistema roda so Gemini — precisa Claude + GPT tambem
2. Criar 4 personas:
   - **Vera** — vai falar com clientes PSM IMOVEIS (futuramente)
   - **Sol** — vai falar com clientes PSM CONQUISTA (futuramente)
   - **Sr Performance** — analitico em tempo real para socios
   - **Sr Gerencia** — gestor do time de corretores, cobra e ajuda

---

## ENTREGUE

### 1. Multi-provider (Claude / Gemini / GPT)

`lib/psm-ia.js` v26.4 reescrito. Agora suporta 3 providers com **fallback automatico**.

| Provider | Modelo | Key env |
|---|---|---|
| Claude | `claude-sonnet-4-6` | `S.connectors.claude_key` ou `localStorage.psm_claude_key` |
| Gemini | `gemini-2.0-flash` | `S.connectors.gemini_key` ou `localStorage.psm_gemini_key` |
| GPT    | `gpt-4o-mini` | `S.connectors.openai_key` ou `localStorage.psm_openai_key` |

Ordem default: **Claude → Gemini → GPT**. Se Claude falhar (sem key / 429 / timeout), passa automatico pro proximo.

Override manual:
```js
psmIA.setProvider('gemini')   // forca Gemini primeiro
psmIA.setProvider('claude')   // forca Claude
psmIA.setProvider('auto')     // volta ao fallback default
psmIA.getProviderOrder()      // ve ordem atual
```

### 2. Personas

| ID | Nome | Empresa | Publico | Tom |
|---|---|---|---|---|
| `vera` | Vera | PSM IMOVEIS | Alto padrao / investidores | Elegante, tecnica, consultiva |
| `sol` | Sol | PSM CONQUISTA | C/B, MCMV, primeiro imovel | Acolhedora, didatica, empatica |
| `sr_performance` | Sr Performance | PSM interno | Socios (lvl 10) | Executivo, cirurgico, direto |
| `sr_gerencia` | Sr Gerencia | PSM interno | Corretores | Firme, pratico, motivador |

### 3. API de uso (console ou codigo)

**Personas conversacionais:**
```js
// Vera (cliente alto padrao)
psmIA.askVera('Quero um imovel 3 suites em Bady, ate 2.5mi')
  .then(r => console.log(r.resposta))

// Sol (MCMV)
psmIA.askSol('Ganho 3.500, tenho FGTS, posso financiar?')
  .then(r => console.log(r.resposta))

// Sr Performance (socios) — passando contexto BI
psmIA.askSrPerformance('Como estamos no mes?', {
  vgv_real: 4200000, vgv_meta: 6000000,
  du_pass: 11, du_tot: 22,
  top_canal: 'Instagram', conversao_global: 2.3
}).then(r => console.log(r.resposta))

// Sr Gerencia (corretor)
psmIA.askSrGerencia('O Lucas esta sumido ha 3 dias, o que fazer?', {
  corretor: 'Lucas', ibc: 'I', vendas_mes: 1, meta_mes: 4,
  ultimo_checkin: '2026-04-18', leads_parados: 7
}).then(r => console.log(r.resposta))
```

**Handles tecnicos (JSON estruturado):**
```js
psmIA.scoreLead({...})           // score 0-100
psmIA.alertaPerformance({...})   // alerta queda
psmIA.sugerirAcoes({...})        // 3 acoes pra bater meta
psmIA.preverVenda(hist, atual)   // forecast fim de mes
```

**Diagnostico:**
```js
psmIA.healthCheck().then(console.log)
// retorna {order, providers:{claude:{ok:true/false}, gemini:..., gpt:...}, keysConfigured:{...}}

psmIA.listPersonas()
// [{id, nome, empresa, papel, publico}]

psmIA._debug(true)   // liga logs detalhados
psmIA._version       // "26.4"
```

---

## REGRAS DE PAPEL (hard-coded no system prompt)

### Vera
- SO alto padrao/investimento
- Se cliente fala de MCMV/subsidio → redireciona educadamente para Sol
- Discreta, sem emoji, sem exclamacao
- Nunca inventa metragem/valor — promete consultor humano

### Sol
- SO residencial C/B/MCMV
- Se cliente fala de investimento → redireciona educadamente para Vera
- Acolhedora, pode usar emoji com moderacao
- Celebra conquista, nunca pressiona
- Nunca inventa dado do imovel — promete consultor humano

### Sr Performance
- Executivo direto, 3-5 bullets max
- Prioriza: (1) risco imediato da meta, (2) alavancas no mes, (3) tendencia estrutural
- Nunca estima escondido — diz "nao tenho esse dado" quando falta
- Sinaliza possivel erro na base se dado parece incoerente

### Sr Gerencia
- Cobra com firmeza mas sem humilhar
- Adapta tom ao perfil IBC (D/I/S/C) do corretor
- Ajuda com script de ligacao, respostas para objecoes
- Sempre termina com acao concreta + prazo

---

## O QUE AINDA FALTA (v26.5+)

### Pre-requisito para Vera/Sol falarem com cliente

1. **Canal de entrada** — WhatsApp Business API / webchat / Instagram Direct
   - **Recomendacao:** Z-API (WhatsApp) ou Chatwoot (multi-canal)
2. **RAG de catalogo** — Vera/Sol precisam consultar imoveis disponiveis antes de responder
   - Fonte: RD CRM produtos OU Supabase `psm_imoveis`
   - Embeddings: OpenAI text-embedding-3-small ou Voyage
3. **Memoria de conversa** — log por cliente em Supabase `psm_conversas`
4. **Handoff humano** — quando escalar pro corretor, regra clara de gatilho
5. **LGPD** — opt-in do cliente antes de conversar com IA

### Pre-requisito para Sr Performance tempo real

- Ja tem acesso a BI Socio — mas precisa **ferramenta de tool use** para chamar funcoes do sistema (getMetricas, etc) por conta propria
- Claude tem `tools` API nativa — proximo passo v26.5

### Pre-requisito para Sr Gerencia cobrar corretores

- Ja tem contexto (alertaPerformance + dados do corretor)
- Falta: **notificacao proativa** — gerencia detecta atraso e dispara alerta
- Feed de cobranca no dashboard do corretor (v26.5)

---

## VALIDACAO

```
sw.js                 : OK
lib/psm-ia.js         : OK (v26.4 multi-provider)
lib/psm-supabase.js   : OK
inline scripts        : 11/11 OK
versao                : 26.3 -> 26.4 (header, meta, sidebar, SW)
```

---

## ARQUIVOS ALTERADOS

- `index.html` — version tags v26.4
- `sw.js` — cache bump v26.4
- `lib/psm-ia.js` — reescrita multi-provider + 4 personas
- `AUDITORIA-v26.4.md` — este documento

---

## DEPLOY GITHUB `Psm178102/psm-os`

1. `index.html`
2. `sw.js`
3. `lib/psm-ia.js`

---

## SMOKE TEST MANUAL

1. Recarregar com SW v26.4 ativo
2. Console: `psmIA._version` → `"26.4"`
3. Console: `psmIA.listPersonas()` → 4 entradas
4. Configurar Claude key: `localStorage.setItem('psm_claude_key','sk-ant-...')`
5. Console: `psmIA.healthCheck().then(console.log)` — deve retornar status dos 3 providers
6. Console: `psmIA.askSrPerformance('resumo do mes em 3 bullets', {vgv_real:3000000, vgv_meta:5000000})`
7. Ver resposta (primeiro provider disponivel)

---

## PROXIMA SPRINT (v26.5 — sugestao)

**Tema:** Estudio IA — UI para conversar com as 4 personas

- Pagina `ia_studio` em Diretoria
- 4 cards clicaveis (Vera/Sol/Sr Performance/Sr Gerencia)
- Chat tipo WhatsApp, historico por persona em Supabase
- Sr Performance com tool use (chama getMetricas/getMetricasGlobal direto)
- Sr Gerencia com alerta proativo (detecta corretor sumido → notifica)
- Vera/Sol em sandbox (so teste interno, sem cliente real ainda)

**Esforco:** ~12h

---

## VEREDITO

Sistema agora tem **3 cerebros** (Claude, Gemini, GPT) com fallback automatico e **4 personas** com regras de papel robustas. Fundacao pronta para evoluir para atendimento ao cliente real (Vera/Sol) e cobranca proativa (Sr Gerencia) em proxima sprint.
