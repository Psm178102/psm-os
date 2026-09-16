# Dicionário de Métricas do House PSM — v1

Ratificado pelo Paulo em 15/09/2026. Este documento é a **única** definição válida das
métricas comerciais do House. Nenhum endpoint calcula venda, lead, funil, equipe ou período
por conta própria: todos leem de `api/v3/_metricas_lib.py`, que implementa o que está aqui.
Mudança de regra = mudança neste arquivo + na lib, nunca em uma tela isolada.

## 0. Régua geral

| Item | Regra |
|---|---|
| Fuso | Tudo em America/Sao_Paulo (UTC−3, sem horário de verão). "Hoje", "mês", "dia" sempre em Brasília. |
| Período padrão | Mês corrente, do dia 1 às 00:00 até agora. Outros períodos existem só como filtro nomeado: *Mês passado*, *Últimos 30 dias*, *Últimos 90 dias*, *Ano*. Nenhuma tela usa 90 dias ou "até o fim do mês" como padrão escondido. |
| Frescor | RD Station → banco a cada 30 min (07h–22h, seg–sáb) + webhook. Um cache só (5 min) para todas as telas. Toda tela mostra "dados de HH:MM" e tem um botão **Atualizar** que renova a fonte (sync + cache), não só a tela. |
| Erro de leitura | Nunca vira zero silencioso. Fonte indisponível = aviso visível na tela ("etapas do RD indisponíveis", "HUB fora do ar"). |
| Contas de serviço | `tv` e `comercial` são contas de serviço (`users.is_service = true`). Não entram em contagem de pessoas, cards, rankings, médias nem metas. Negócios no e-mail delas caem em "sem corretor". |

## 1. Venda

- **Definição:** negócio do RD com `win = true`.
- **Mês da venda:** `closed_at` convertido para Brasília. Sem fallback: venda sem `closed_at` não entra em mês nenhum e gera o aviso "venda sem data" para o gestor corrigir no RD.
- **Valor (VGV):** `amount`; se zero, `rd_raw.amount_total`; se zero, `rd_raw.amount_unique`. Venda com valor zero gera aviso "venda sem valor".
- **Conquista × PSM HUB:** a venda oficial é a do RD. A esteira do HUB é conferência: se o HUB tiver venda que o RD não tem (ou vice-versa), a tela mostra "N venda(s) no HUB sem ganho no RD" com o nome do corretor. (Em 15/09/2026: Christian tem 1 venda de R$ 194.652 no HUB e 0 no RD.)
- **Ticket médio:** VGV ÷ vendas do período.

## 2. Origem e lead

Toda origem do RD (`rd_raw.deal_source.name`) cai em exatamente uma categoria:

| Categoria | Origens do RD | Observação |
|---|---|---|
| `trafego_pago_psm` | Busca Paga \| Ads PSM · Busca Paga \| Facebook Ads · Busca Paga \| Google · Ads campanha whatsapp PSM | Anúncio pago pela PSM. Entra no CAC de mídia. |
| `trafego_pago_corretor` | Busca Paga \| Ads Kaue · Busca Paga \| ADS corretor | Anúncio pago pelo corretor. Conta como lead, em linha separada; fora do custo da empresa. |
| `sem_origem` → assumido `trafego_pago_psm` | (vazio) · Desconhecido | Decisão do Paulo: assume tráfego pago. A tela mostra "N leads com origem assumida" para o gestor corrigir no RD. |
| `organico_site` | Social \| Facebook · Social \| Instagram · Instagram corretor · Insta Psm Imóveis · Marketplace face corretor · PAP Digital corretor · Grupo Zap · Contato pelo Site · Contato por Cel da PSM · Contato por E-mail · Referência \| psmconquista.com.br · Tráfego Direto | Interessado novo por canal próprio. Não é lead pago; não entra no CAC de mídia. |
| `carteira` | Carteira do corretor · Plantão · Ativo de rua | Plantão e Ativo de rua classificados como carteira (premissa; ajustar aqui se o Paulo discordar). |
| `indicacao` | Indicação | |
| `networking` | Networking | |
| `reativacao` | Reativação · Lista | Base antiga ou lista fria. |

Origem nova que aparecer no RD e não estiver nesta tabela cai em `nao_classificada` e gera aviso ao sócio para classificar (a tabela vive em Configurações → Dicionário, editável, com estes valores como padrão).

- **Lead** = negócio criado no período (`created_at_rd` em Brasília) com categoria `trafego_pago_psm` ou `trafego_pago_corretor` (incluindo os "sem origem" assumidos).
- **Interessados novos** = negócios criados no período, todas as categorias (lead + orgânico + carteira + indicação + networking + reativação).
- **Em atendimento** = negócios abertos (`win` nulo) de qualquer época. É outro número, sempre com este nome; nunca se chama "lead".
- **Perdidos** = `win = false` com `closed_at` no período.

## 3. Dono do negócio

1. `deals.user_id` (resolvido na sincronização).
2. Se vazio, `deals.user_email` (minúsculo) casado com `users.email`.
3. Se não casar, ou se casar com conta de serviço: **"sem corretor"**. Continua somando no total da empresa e gera aviso "N negócios sem corretor".

## 4. Equipe e frente

- **Equipe** de uma pessoa e de tudo que ela produz = `users.team`. Só isso. A lista fixa de logins MAP no código deixa de existir.
- **Frente** = funil do RD do negócio (Conquista, MAP, Terceiros, Locação, Parceria). É rótulo para análise, nunca define equipe.
- **Membros da equipe** = usuários ativos, não-serviço, com `team` igual, papel `corretor*`, `gerente*` ou `lider*`.
- **Gestor** = papel começando com `gerente` ou `lider` (prefixo, nunca igualdade).

## 5. Marcos do funil

### Conquista (funil RD "FUNIL CONQUISTA")
Prospecção, qualificação, agendamento, atendimento e pasta vêm da **esteira de produção do PSM HUB** (`/api/dashboard/esteira`, por corretor, por mês), com os mesmos nomes e números do HUB. Venda vem do RD (item 1). A esteira é mensal: em período que não é mês inteiro, a tela mostra o mês e avisa "esteira do HUB é mensal". Corretor do HUB é casado ao usuário do House por nome; nome sem par gera aviso.

### MAP, Terceiros, Locação (funis do RD)
Contagem por **coluna do funil do RD**: negócios que **entraram** na coluna dentro do período (`deal_stage_events.occurred_at` em Brasília), agrupados pela chave `rd_stages.psm_stage_key`:

| Métrica | Chaves de coluna |
|---|---|
| Atendimentos | `novo_atend` |
| Contato/qualificação | `contato_qual` |
| Agendamentos | `precisa_ag`, `vis_agend` |
| Chegaram em "visita realizada" (coluna) | `vis_real` |
| Propostas | `proposta` |
| Contratos | `contrato` |

**Visitas** (o número oficial) = tarefas do RD com `type = visit` e `done = true`, `done_date` no período, atribuídas ao usuário (`users[].email` ↔ `users.email`). Exige sincronizar tarefas do RD (`GET /api/v1/tasks`) para a tabela `rd_tasks`. A coluna "visita realizada" fica como número secundário para conferência.

## 6. Meta

- Fonte: tabela `metas` (por corretor, ano, mês).
- Meta do período = soma mês a mês das metas dos meses cobertos (nunca "meta mais recente × nº de meses").
- Meta da equipe = soma das metas dos membros ativos não-serviço. Meta do gestor = meta da equipe, salvo meta própria cadastrada.
- Atingimento = realizado do período ÷ meta do período.

## 7. Card do gestor (decisão do Paulo: mantém a regra atual)

Sócio (e o próprio gestor) vê a equipe somada; outro gerente vê o individual do gestor. Obrigatório: o card carrega o rótulo **"equipe"** ou **"individual"** em destaque, e no individual a meta mostra "meta da equipe: R$ X" em vez de "Sem meta no período".

## 8A. Meta · Realizado · Projeção por horizonte (revisão de 16/09/2026 — substitui a "projeção oficial" do §8)

Pedido do Paulo: "as projeções são muito irreais e/ou erradas, zerando". Medido: o ritmo zerava sem venda no período e o pipeline ponderado do Cérebro somava milhares de abertos (21 vendas só pro Kadu contra ~6/mês da empresa). Implementação: `api/v3/_projecao_lib.py` + `GET /api/v3/metricas/projecao`; tela 🎯 na Gestão Comercial; mesmo número no card do mês da Gestão Comercial e no card do 1:1.

| Item | Regra |
|---|---|
| Horizontes | Semana (seg–sáb atual), Quinzena (1–15 ou 16–fim), Mês, Trimestre, Semestre, Ano, Personalizado (datas). Brasília. |
| Meta do horizonte | Metas mensais proporcionais aos dias úteis (seg–sáb) do período. Meta de vendas = `meta_vendas`, ou `meta_vgv ÷ ticket` quando só há meta de VGV. "Esperado até hoje" = mesma proporção até hoje. |
| Realizado | Vendas ganhas no RD de início até hoje (§1). |
| Ritmo histórico | Vendas por dia útil nos últimos 180 dias × dias úteis que faltam. Por corretor, suavizado pela média da equipe (peso de 26 dias úteis). Equipe = soma dos membros ativos; empresa = soma das pessoas ativas. |
| Funil | Propostas/contratos abertos e mexidos em 60 dias × taxa real proposta→venda da equipe (entradas em proposta de 240 a 30 dias atrás; amostra mínima 15, senão empresa, senão 15%) × fração que cabe no prazo (dias corridos restantes ÷ dias medianos proposta→venda). |
| **Provável (oficial)** | Realizado + o maior entre ritmo e funil. |
| Conservador / Otimista | Realizado + o menor dos dois / realizado + os dois somados. Faixa de vendas por Poisson 10–90%. |
| VGV | Realizado pelo valor real; ritmo × ticket (do corretor com 3+ vendas, senão da equipe); funil pelo valor do negócio ou ticket. |
| Status | batida · vai bater (provável ≥ 100%) · atrás (70–99%) · fora (< 70%) · sem meta. |
| Período encerrado | Projeção = realizado. |

## 8. Projeção e ritmo (revisado em 15/09/2026 à noite: as projeções também divergiam)

Existem **quatro** projeções, sempre com estes nomes, em toda tela. Nenhuma tela inventa uma quinta.

| Nome | Definição | Equipe |
|---|---|---|
| **Ritmo** | realizado ÷ dias úteis decorridos × dias úteis do mês (seg–sáb). Só no mês corrente. | soma dos membros ativos |
| **Pipeline ponderado** | Σ probabilidade × valor dos negócios abertos, pela régua do Cérebro de Vendas (`MS_PRIOR` por marco × taxa real do canal nos últimos 120 dias × recência × engajamento). "Quente" = probabilidade ≥ 55%. | soma |
| **Previsto do mês** | realizado + comprometido, onde comprometido = pipeline ponderado só dos negócios em proposta/pasta (marco ≥ 4). | soma |
| **Norte** | plano declarado no 1:1 (atendimentos × mix × taxa base × energia; VGV = vendas × ticket). Só existe para quem tem Norte definido no mês. | soma dos membros **ativos e não-serviço** que têm Norte |

Divergências que este item elimina: o 1:1 usava dias corridos (15/30) e a Gestão Comercial `dia do mês`; a Gestão Comercial somava o Norte de inativos e da conta `comercial` (5,92 vendas contra 5,03 no 1:1) e o card de equipe do gestor não tinha Norte; o "pipeline esperado" da Gestão Comercial vinha de taxas visita→venda da safra (zerava com amostra pequena) enquanto o Cérebro e a Agenda usavam o motor de probabilidade, e mesmo esses dois divergiam entre si por cache e base de fechados diferentes (Kadu em 15/09: R$ 1.013.128 × R$ 980.729 × R$ 0).

`PIPELINE_PESOS` (oo/_oo_lib) e as taxas de safra do forecast da Gestão Comercial deixam de ser exibidos como projeção.

**Negócio aberto sem valor no RD (decisão do Paulo, 16/09/2026):** entra no pipeline ponderado e no previsto com o **ticket de referência** da equipe = ticket médio das vendas ganhas da equipe nos últimos 120 dias; sem venda com valor, `meta_vgv ÷ meta_vendas` da equipe; sem meta, ticket da empresa. O valor é presumido (campo `pipeline.sem_valor` / `pipeline.vgv_presumido` e aviso "N negócios abertos sem valor") e o valor real substitui o presumido assim que alguém preencher o RD. **Venda ganha sem valor não é presumida**: entra com R$ 0 e gera aviso, porque VGV realizado alimenta comissão e relatório.

## 9. O que muda para o usuário

- O mesmo número aparece igual no 1:1, na Gestão Comercial, no Dashboard, na Agenda, em Metas, no Ranking e no Modo TV.
- "Lead" passa a significar interessado de tráfego pago. O número antigo do 1:1 (todo aberto) vira "Em atendimento".
- Contagem de pessoas para de incluir tv e comercial.
- Toda tela ganha "dados de HH:MM" e o botão Atualizar.

## 10. Plano de implementação

| Fase | Entrega |
|---|---|
| 0 | Bugs puros: contas de serviço fora; gestor por prefixo no ranking do 1:1; mês em Brasília e valor com fallback em TV, Forecast, Diretoria, Comissão e conciliação HUB; Rafaela em uma equipe; erro vira aviso. |
| 1 | `_metricas_lib.py` + `GET /api/v3/metricas/resumo?escopo=empresa|equipe|pessoa&since&until` com cache único 5 min e carimbo; tabela de origens e de marcos em Configurações; sync de tarefas do RD; sync do RD a cada 30 min. 1:1, Gestão Comercial, Dashboard, Agenda, Metas, Ranking e Modo TV passam a ler só do endpoint. |
| 2 | Comissão, Diretoria, CEO/CMO, Cérebro de Vendas, agentes de IA e relatórios migram para a lib. Teste noturno compara o mesmo número em todas as telas e avisa o sócio se divergir. |
