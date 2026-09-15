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

## 8. Projeção e ritmo

- Run-rate em dias úteis (seg–sáb), como já definido em v87.82.
- Pipeline ponderado usa uma tabela só de pesos por marco (a de `MS_PRIOR`, calibrada pelo win-rate real); `PIPELINE_PESOS` deixa de existir.

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
