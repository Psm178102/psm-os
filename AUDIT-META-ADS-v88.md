# AUDITORIA — Cockpit Meta Ads × CRM (`#/marketing`) · v88.10 · 23/09/2026

Escopo: `v2/js/pages/marketing.js` (5 abas + modo TV) e os endpoints que ela consome:
`api/meta-ads.js` (Node), `api/v3/marketing/{summary,crm_metrics,meta_timeseries,meta_breakdowns,leads_geo,leads_creative,accounts,meta_cache_cron,meta_monthly_cron,_window_lib,_meta_cache_lib}.py`, `vercel.json`, `api/v3/system/heartbeat.py`.
Somente leitura: nada foi alterado.

Severidade: 🔴 crítico · 🟠 alto · 🟡 médio · ⚪ baixo


## ✅ STATUS DAS CORREÇÕES (atualizado 23/09/2026)

| Versão | Itens resolvidos |
|---|---|
| **v88.12** (no ar) | P1, P2, P3, P4, P8 (breakdowns), R1, R2, R4, R5, R6, R7, M1, M3, M11, F1, F2, F3, F4, F5, F6, F8 |
| **v88.15** | P5 (timeseries/breakdowns/Node validam), P6, P7, M2, M4, M5, M10, M12, M13, R3, R8, F9, F10, F11 |
| **v88.18** | M6, M7, M8, F7 (limiares da empresa), F12 (breakdowns) |

**Pendentes — dependem de decisão do Paulo (mudam números/definições):**
- **M9** janela de atribuição (`action_report_time=conversion` + janela fixa): muda a contagem diária de leads Meta.
- **M14** "Total de leads" do painel Região = todo deal criado × só tráfego pago (Dicionário §2).
- **leads_creative por marca**: exige gravar a marca/conta no `meta_leads`.
- **F13** `summary` lvl 3 é intencional (cargo Marketing usa Gestor de Tráfego); `Host`→URL interna fixa fica para o sprint de infra.
- Monthly cron: congelar meses fechados/UTC→BRT (parte de F8 além do "não grava com erro").

---

## 1. FILTRO DE PERÍODO

| # | Sev | Onde | Problema | Cenário que quebra | Correção |
|---|---|---|---|---|---|
| P1 | 🔴 | `marketing.js:104-108`, `:1815` | `periodQuery()` dá prioridade ao `since/until` custom. Trocar o preset no `<select>` **não limpa** o intervalo custom. | O usuário aplica 01/09–10/09 e depois escolhe "Hoje": o select mostra "Hoje", mas **todas as abas continuam no intervalo custom**. É o sintoma "o filtro de período não funciona". | Na mudança de preset: `_since = _until = ''`. Enquanto houver intervalo custom, mostrar o select como "Personalizado". |
| P2 | 🔴 | `marketing.js:1157-1162`, `:1262`, `:1501`, `:1537`, `:999-1000`, `:392`, `:768` | O **filtro de conta** só vale em parte da Executiva. Tráfego (KPIs, alertas, tabela de contas e de campanhas), Criativos, Semáforo, Por Marca, Gráficos (marca, top campanhas, funil), faixa de alertas e o donut da Executiva usam `_data.accounts/campaigns` **sem filtro**. | Seleciona só "Conquista": o Tráfego continua somando todas as contas, e os alertas mostram campanhas de outras marcas. | Trocar por `filteredAccounts()`/`filteredCampaigns()` em todas as abas. |
| P3 | 🟠 | `marketing.js:974-986`, `:144-156`, `:110-141` | **Condição de corrida**: não há token de requisição. Uma resposta antiga (timeseries, breakdown ou summary) pode chegar depois da nova e sobrescrever. | Trocar de período duas vezes rápido, ou o auto-refresh cair no meio: gráficos/sparklines ficam com o **período anterior** e os KPIs com o novo. | Usar um contador `_reqSeq`: descartar a resposta se `seq !== _reqSeq`, ou um `AbortController`. |
| P4 | 🟠 | `marketing.js:1827-1831` | Intervalo custom sem validação: `since > until`, datas futuras ou intervalo > 37 meses (limite da Meta). | O backend responde 200 com tudo zerado (ver B8) e o usuário acha que não houve gasto. | Validar no front e bloquear. No back, retornar 400. |
| P5 | 🟡 | `summary.py`, `meta_timeseries.py`, `meta_breakdowns.py`, `meta-ads.js` | O lado Meta **não usa `_window_lib`** e repassa o preset cru. O CRM usa `_window_lib`. As janelas Meta × CRM podem divergir; `year_YYYY` quebra só no Meta. `since/until` são concatenados crus no `time_range` (injeção de parâmetro Graph). | `year_2025` → CRM ok, Meta com todas as contas em erro, mas resposta 200 com `accounts: []`. | Passar tudo por `_window_lib.window()` e mandar sempre `time_range` explícito para a Meta. |
| P6 | 🟡 | `meta_timeseries.py:188-195` | A janela do "período anterior" é derivada do 1º e último dia **com dado** (a Meta omite dias sem veiculação). | `last_30d` com campanha ligada há 10 dias: compara com 10 dias anteriores; o "vs" mostra datas erradas e o delta fica distorcido. | Derivar do (since, until) resolvido. |
| P7 | 🟡 | `crm_metrics.py:228-229` | A query de deals não tem limite superior de data. | `last_month` puxa todos os deals até hoje: lento e pode bater o teto de 30k (`truncated`). | Adicionar `lt until+1` em cada ramo do OR. |
| P8 | 🟡 | `marketing.js:149`, `meta_breakdowns.py` | Breakdowns não aceitam `accounts`. `leads_creative` ignora `brands`. | Com 1 conta selecionada, breakdowns e ciclo por criativo mostram todas as contas. | Aceitar e repassar `accounts`/`brands`. |

## 2. TEMPO REAL / FRESCOR DO DADO

| # | Sev | Onde | Problema | Cenário | Correção |
|---|---|---|---|---|---|
| R1 | 🔴 | `marketing.js:94-100`, `summary.py:28`, `meta-ads.js:16,449` | O "⏱ Tempo real (60s)" **não é tempo real**: `reload(true)` não manda `nocache`. Ele relê o cache de 15 min do v3, que por sua vez pode ter sido gravado a partir do cache em memória de 5 min do Node, com `refreshed_at=now`. | O dado pode ter **~20 min** enquanto o selo diz "atualizado agora" e `age_s=0`. | Com o auto ligado: `nocache=1` a cada N minutos, ou TTL curto para `today`. O `summary.py` deve chamar o Node com `nocache=1` no miss. Mostrar a idade real do dado (`cache.age_s`) no cabeçalho. |
| R2 | 🔴 | `marketing.js:1875` | Depois de **Pausar/Retomar**, `reload()` roda sem `nocache`. | A campanha pausada continua "ATIVA" por até 15–20 min; o gestor clica de novo ou acha que falhou. | `_nocacheOnce = true` antes do reload, e atualização otimista do status. |
| R3 | 🟠 | `vercel.json`, `heartbeat.py:45` | `meta_cache_cron` **não está no `vercel.json`**. Só roda via heartbeat do front (no máximo 1×/h, 1 job por boot). Já ficou 4 dias sem rodar. | Cache frio: a primeira abertura de cada período é lenta e o TV pode mostrar dado antigo. | Colocar no `vercel.json` (ex.: a cada 15 min em horário comercial). |
| R4 | 🟠 | `marketing.js:121` | Todo `reload` (inclusive o auto de 60s) zera `_bd` e `_ts`. | O breakdown que o gestor pediu **some a cada 60s**, e os gráficos piscam e refazem a série. | No refresh silencioso do mesmo período, manter `_bd` e rebuscar `_ts` em segundo plano. |
| R5 | 🟠 | `marketing.js:98-99`, `render()` | O refresh silencioso recria o DOM inteiro (`_root.innerHTML`). | Perde o scroll, fecha o painel de limiares e tira o foco do campo de busca. | Re-renderizar só `#ma-tab-body` e o cabeçalho, preservando o estado da UI. |
| R6 | 🟡 | `marketing.js:136-139` | Erro num refresh silencioso **substitui a página inteira** pela tela de erro; no modo TV, grava no `_root` oculto e o TV segue com o dado velho sem aviso. | Uma falha de rede às 14h derruba o painel no iPad/TV. | No modo silencioso, manter o dado e mostrar um selo "⚠️ falha ao atualizar HH:MM". |
| R7 | 🟡 | `summary.py:79-101` | Quando **todas** as contas falham, o Node devolve 200 com `accounts: []`, e o fallback de cache vencido não é usado. | Token Meta expirado → o cockpit mostra "R$ 0 investido" em vez de "dado de ontem (desatualizado)". | Tratar `accounts == [] && errors` como erro: servir o cache vencido ou retornar 502. |
| R8 | 🟡 | `meta_timeseries.py:238` | A série parcial (com conta em erro) é cacheada por 30 min. A chave não inclui contas selecionadas nem varia com `nocache` após mexer nas contas. | A conta excluída continua no gráfico por até 30 min. | Não cachear parcial; incluir `accounts` ordenadas na chave. |

## 3. MÉTRICAS ERRADAS (números que enganam)

| # | Sev | Onde | Problema | Impacto | Correção |
|---|---|---|---|---|---|
| M1 | 🔴 | `meta-ads.js:140-143,192-195`, `meta_timeseries.py:32`, `meta_breakdowns.py:40-44` | Leads = `lead` + `offsite_conversion.fb_pixel_lead`. O `lead` da Meta **já inclui** o lead de pixel → **contagem dupla**. | Campanha com 10 leads de pixel mostra 20; o **CPL aparece pela metade**. Contamina o histórico mensal, os alertas e o semáforo. | Contar só `lead` (ou `onsite_conversion.lead_grouped` + `offsite_conversion.fb_pixel_lead`), com uma lista única compartilhada. |
| M2 | 🟠 | `meta_timeseries.py:161,213,221-223`, `marketing.js:689` | **Alcance somado** por dia e por conta (alcance é de pessoas únicas, não soma) e comparado com o alcance real do período anterior. | O card "👥 Alcance" mostra sempre um ▲ grande e falso. | O total de alcance deve vir de uma chamada sem `time_increment`. |
| M3 | 🟠 | `marketing.js:1492-1500` × `:302-312` | **Semáforo e Alertas se contradizem.** O semáforo usa CPL-alvo por marca (Conquista 25 / Imóveis 150 / Locação 60); os alertas e a faixa "🚀 ESCALAR" usam o limiar global de R$ 80. | Imóveis com CPL de R$ 120: alerta "CPL alto" **e** "Escalar vertical" ao mesmo tempo. Conquista com CPL de R$ 50: "Sangria" no semáforo e "ESCALAR" na faixa. | Uma regra só: limiar por marca, com o valor global como fallback. |
| M4 | 🟠 | `leads_geo.py:165-167`, `leads_creative.py:82-84` | `.limit(5000/10000)` sem paginação: o PostgREST corta em **1000 linhas**, sem aviso. | Em "Este ano", % fora de Rio Preto, total e alertas por campanha saem de uma amostra arbitrária. | Paginar com `.order('id').range()` e expor `truncated`. |
| M5 | 🟡 | `marketing.js:1407-1437` | "Ciclo de venda" diz **mediana**, mas é a média simples das médias por marca. Show-up e SLA também são médias sem peso; o Contact usa `leads_criados` em vez de `leads`. | A marca com 3 vendas pesa igual à marca com 300. | Calcular no backend (`global`), com ponderação. |
| M6 | 🟡 | `marketing.js:1031`, `:701` | O funil da aba Gráficos e o hero chamam `results` (mensagens + leads Meta) de "Leads" e comparam com vendas RD. As larguras do funil do hero usam fatores inventados (`×8`, `×40`). | Leitura errada da conversão. | Rotular "Resultados Meta"; larguras proporcionais (ou em log, declarado). |
| M7 | 🟡 | `marketing.js:1552-1565` | Aba Por Marca: 1 painel **por conta**, mas o CRM é **por marca**. Com 2 contas da mesma marca, cada painel mostra o CRM inteiro da marca e calcula o CAC só com o gasto daquela conta. | CAC e CPO distorcidos para marcas com mais de uma conta. | Agrupar por marca (somando as contas) ou avisar que o CRM é da marca inteira. |
| M8 | 🟡 | `meta-ads.js:74-79,165` | A lista de campanhas vem de `/campaigns?effective_status=[ACTIVE,PAUSED,CAMPAIGN_PAUSED,ARCHIVED]`: `CAMPAIGN_PAUSED` não é status de campanha, e faltam `DELETED`, `WITH_ISSUES`, `IN_PROCESS`. | O gasto de campanha deletada ou com problema entra no total da conta, mas some da tabela e do top 5: **total ≠ soma das linhas**. | Montar as linhas a partir de `insights level=campaign` e usar `/campaigns` só para o status. |
| M9 | 🟡 | todos os insights | Não há `action_attribution_windows` / `action_report_time`. | O lead Meta do dia não bate com o `created_at_rd` do RD (paridade e CPL-R). | Fixar `action_report_time=conversion` + janela. |
| M10 | 🟡 | `crm_metrics.py:294-313` | `deal_stage_events` em blocos de 150 deals sem paginação (corte em 1000 eventos). | Contact, Visita e SLA "reais" distorcidos. | Paginar cada bloco. |
| M11 | 🟡 | `heroAlertas` (`:780`) × `tabSemaforo` (`:1502`) | O contador "Escalar vertical/horizontal" da Executiva classifica **todas** as campanhas (inclusive pausadas); a aba Semáforo só as ativas. | Números diferentes para a mesma coisa. | Filtrar por ativas nos dois. |
| M12 | ⚪ | `marketing.js:1076` | Tempo médio de vídeo = média simples entre campanhas (sem peso por views). | Campanha pequena distorce. | Ponderar por `views`. |
| M13 | ⚪ | `marketing.js:1901` | `moneyShort()` é idêntica a `money()` (não abrevia). | "R$ 12.345.678,00" nos cards de VGV. | Abreviar (mil/mi). |
| M14 | ⚪ | `leads_geo.py` | Conta **todo** deal criado (captação e orgânico) como lead, enquanto o `crm_metrics.leads` conta só tráfego pago. | O "Total de leads" do painel Região ≠ "Leads de tráfego pago". | Aplicar o mesmo critério do Dicionário §2. |

## 4. FUNCIONALIDADES QUEBRADAS / QUE NÃO FUNCIONAM

| # | Sev | Onde | Problema | Correção |
|---|---|---|---|---|
| F1 | 🔴 | `marketing.js:1821` | **Campo de busca de campanha inutilizável**: cada tecla chama `render()`, que recria o `<input>` e **perde o foco**. Só dá para digitar 1 caractere. | Re-renderizar só a tabela, ou restaurar foco e cursor, com debounce. |
| F2 | 🔴 | `api/meta-ads.js:400-440` | **Segurança**: qualquer JWT válido (corretor lvl 1, ou usuário desativado há menos de 12h) consegue **pausar/retomar campanhas e mudar o orçamento diário** via `POST /api/meta-ads`, sem trilha de auditoria. O GET também expõe o gasto de todas as contas a qualquer nível. | Mover as ações para um endpoint v3 com `require_user(min_lvl>=7)` e registro de auditoria; no GET do Node, aceitar só `CRON_SECRET`. |
| F3 | 🟠 | `meta-ads.js:355,359` | Pausar/Retomar usa sempre `META_ACCESS_TOKEN`, ignorando `META_AD_ACCOUNT_TOKENS`, e chama Graph v22.0 (as leituras usam v21.0). | Pausar campanha de conta com token próprio **falha com erro de permissão**. | Resolver o token pela conta da campanha (`accountId`). |
| F4 | 🟠 | `marketing.js:994` | Gráficos no **modo TV**: a cor do texto vem de `--ink` do `documentElement` (tema claro), mas o TV redefine as variáveis só no overlay escuro. | Eixos e legendas **quase invisíveis** no TV. | Ler `getComputedStyle(overlay)` quando `_tv`. |
| F5 | 🟡 | `marketing.js:83-87`, `:451` | O cleanup da rota não para o `_tvTickTimer`, não remove o overlay `#ma-tv` nem o listener de teclado. | Sair da página pelo menu com o TV aberto deixa o overlay e o timer vivos. | Chamar `exitTV()` no `onCleanup`. |
| F6 | 🟡 | `marketing.js:752-773`, `:988-1033` | Instâncias do Chart.js só são destruídas no próximo build de gráfico; trocar para outra aba deixa charts presos a canvas desanexados. | Vazamento de memória em TV/iPad ligado o dia todo. | Destruir `_charts` no início de todo `render()`. |
| F7 | 🟡 | `marketing.js:37,66-68` | Os limiares de alerta ficam **só no localStorage** do navegador. | TV, iPad e desktop mostram alertas diferentes. | Persistir em `shared_kv` (config do sócio). |
| F8 | 🟡 | `meta_monthly_cron.py:115-128` | Se todas as contas falham (HTTP 200 com `accounts:[]`), o cron **grava zeros por cima de todos os meses do ano**. Excluir uma conta também reescreve o passado. Usa UTC e não BRT (cria o mês seguinte às 21h do último dia; dezembro perde o último dia). | Não gravar quando `errors` não está vazio ou `accounts_n` caiu; congelar meses fechados; usar `hoje_brt()`. |
| F9 | 🟡 | `_oo_lib.py:181`, `system_health.py:111,135` | A tabela `meta_ads_cache` é compartilhada entre summary/`ts:`/`bd:`/`google:`; o intel lê qualquer linha por `date_preset` e pega payload sem `accounts` → CPL vazio no One-on-One/Intel. O health checa a coluna `updated_at`, que não existe (é `captured_at`) → o alerta de histórico parado **nunca dispara**. | Filtrar por `cache_key` ou coluna `kind`; corrigir o nome da coluna. |
| F10 | ⚪ | `leads_creative.py:85-91,107` | Qualquer exceção (timeout) vira "tabela não criada" (`pending`); o erro da query de deals é engolido → vendas = 0. | Distinguir os erros. |
| F11 | ⚪ | `marketing.js:1516,1735-1737` | Os textos de roadmap estão desatualizados: "Ciclo por formato de criativo" aparece como roadmap, mas já existe (`creativeCyclePanel`); o texto aponta "Breakdown na aba Criativos", mas a aba foi fundida em Tráfego. | Atualizar a copy. |
| F12 | ⚪ | `meta_timeseries.py:57`, `meta_breakdowns.py:67` | `limit=500` sem seguir `paging.next`; contas buscadas em sequência (timeseries 2× por conta) → risco de timeout com muitas contas. | Paginar e paralelizar. |
| F13 | ⚪ | `summary.py` (lvl≥3) × página (lvl≥5) | Níveis de acesso inconsistentes; `v3_scope: "self"` não restringe nada. `CRON_SECRET` enviado via header `Host` (SSRF atrás de proxy) e `?key=` em log. | Alinhar os níveis; usar a URL interna fixa. |

---

## 5. ORDEM SUGERIDA DE CORREÇÃO

**Sprint A — "o filtro e o número estão certos" (1–2 dias)**
P1, P2, F1, M1, M3, P3, R2, F2 (segurança)

**Sprint B — "tempo real de verdade" (1–2 dias)**
R1, R3, R4, R5, R6, R7, R8, F3, F4, F5, F6

**Sprint C — "backend robusto" (2–3 dias)**
P4, P5, P6, P7, P8, M2, M4, M8, M9, M10, F8, F9

**Sprint D — polimento**
M5, M6, M7, M11–M14, F7, F10–F13

## 6. EVOLUÇÕES RECOMENDADAS (depois das correções)
- **Seletor de período unificado** (preset + custom + "comparar com") com a janela resolvida no backend e exibida igual em todas as abas.
- **Selo de frescor por bloco** (Meta · CRM · série · breakdown), cada um com a sua idade real.
- **Nível de anúncio/criativo** (`level=ad` + thumbnail) no laboratório de criativos. Hoje é só por campanha.
- **Log de ações** (quem pausou o quê, quando) visível no cockpit.
- **Limiar por marca editável** pelo sócio e compartilhado entre TV/iPad/desktop.
- **Teste automatizado de contrato** dos endpoints (`tests/`) cobrindo presets, custom e contas vazias.
