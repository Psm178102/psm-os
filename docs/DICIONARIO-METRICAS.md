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

**Venda de quem saiu da PSM (revisão de 17/09/2026, v88.0):** a venda continua sendo venda da empresa (§1) — soma no total da empresa, com aviso, igual à venda sem corretor. Quem saiu não é membro de equipe (§4), então essa venda fica fora do total da equipe, da meta e das projeções. Medido em 17/09: 19 vendas de 2026 (~R$ 6,1 mi, jan–jul) eram de corretores já desligados e sumiam do total da empresa nas visões de ano e de meses passados.

## 2. Origem e lead

Origem do negócio (v88.33d) = campo personalizado **"Origem do cliente"** do RD (coluna `deals.origem_cliente`, preenchida por gatilho a partir do `rd_raw`); vazio → "Fonte" padrão do RD (`rd_raw.deal_source.name`). Motivo: desde ago/2026 a equipe preenche a "Origem do cliente" em ~98% dos negócios, e o "Fonte" ficava vazio em ~30% e nunca trazia indicação, carteira ou networking. Valores do campo personalizado: Trafego pago PSM → `trafego_pago_psm`; Trafego pago corretor → `trafego_pago_corretor`; Instagram PSM, Whatsapp PSM, Instagram corretor, Marketplace, PAP Digital → `organico_site`; Carteira, Ativo de rua → `carteira`; Indicação; Networking; Lista, Reativação → `reativacao`.

Toda origem cai em exatamente uma categoria:

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
- **Em andamento no período** (v88.16, pedido do Paulo 23/09/2026 — bloco mínimo de TODO painel de gestor/diretor) = negócios abertos (`win` nulo) **criados na janela**, contados por equipe (§4) × categoria de origem acima. Colunas na tela: Tráfego Orgânico (`organico_site`), Carteira Própria (`carteira`), Indicação, Networking, Lead · Tráfego Pago PSM e Lead · Tráfego Pago Corretor (colunas separadas; lead = só tráfego pago — confirmado pelo Paulo 23/09) e Outros (reativação + não classificada). Sem origem segue a regra deste § (conta como tráfego pago PSM — reconfirmado pelo Paulo 23/09) e aparece com aviso. Campos: `abertos_periodo`, `abertos_por_origem`, `abertos_sem_origem`. Componente: `v2/js/leads-origem.js`.
- **Prospecção** (v88.34, Paulo 23/09/2026: "prospecção é a soma de todos") = mesmo número que **Interessados novos**: tudo que entrou no período (aberto, ganho ou perdido), somando todas as origens. É a visão padrão do quadro de origens ("Entraram no período"); "Em andamento agora" virou a segunda visão. Não existe categoria "Ativo" separada: Ativo de rua e Plantão seguem em `carteira`. Campos: `por_origem`, `interessados`, `entradas_sem_origem`. No total da empresa, `por_origem` inclui os negócios sem corretor no House e de quem saiu, então a soma das origens bate com `interessados`. O aviso de sem origem mostra o % do total e o nome de quem precisa preencher.
- **Uma regra só de origem** (v88.33c): a aba Funil → Fontes & Funil, o histórico mês a mês e o CAC da Gestão Comercial (`api/v3/oo/comercial.py`) usam estas mesmas categorias (`origem_categoria`). A regra antiga por palavra-chave (`channel` em `_oo_lib.py`) não vale mais ali. **Venda de origem paga** (CAC mídia) = só `trafego_pago_psm`.
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

**Visitas** (o número oficial, fora da Conquista) = o **maior** entre (a) tarefas do RD com `type = visit` e `done = true`, `done_date` no período, e (b) entradas na coluna "visita realizada" no período (v88.37). A tarefa é creditada ao **dono do negócio** (`deal_id` → dono pelo §3); sem negócio conhecido, ao responsável da tarefa (`users[].email` ↔ `users.email`). Motivo (Paulo, 24/09/2026): o MAP move o card para "visita realizada" sem fechar a tarefa "Visita", e a tarefa costuma ficar no nome de quem co-conduz (Paulo/Isa) — a Rafaela aparecia com 0 visita no mês e 7 no ano, contra 17 pela coluna. As tarefas vêm do sync `GET /api/v1/tasks` → `rd_tasks`.

### Funil em 7 degraus nas telas (revisão de 17/09/2026, v87.97)
Toda tela que desenha funil, conversão por etapa, saúde ou meta × realizado por etapa usa `funil_de()` do motor, com as chaves de sempre (a matriz de conversão, o mapa de habilidades e as metas do Norte dependem delas):

| Chave | Conquista (esteira do HUB) | MAP / Terceiros / Locação (coluna do RD) |
|---|---|---|
| lead | Prospecção | Atendimento (`novo_atend`) |
| contato | Qualificação | Contato / qualificação |
| agendamento | Agendamento | Agendamento |
| visita | Atendimento (visita) | Visita realizada (maior entre tarefa do RD e coluna — v88.37) |
| proposta | Pasta / proposta | Proposta |
| pasta | Pasta (espelho: no MCMV é a mesma etapa; a tela não repete) | Contrato |
| venda | Venda (RD) | Venda (RD) |

Taxa entre degraus = entradas no degrau ÷ entradas no anterior **no período** (fluxo): pode passar de 100%. Na Gestão Comercial, "pasta/proposta" é uma coluna só = degrau `proposta`. Onde vale: 1:1 (cards, cockpit, equipe do gestor, matriz de conversão, gargalo, habilidade prioritária, funil reverso, Norte do Mês e Norte do Dia) e Gestão Comercial (esteira individual, contagens e "quantos pra 1 venda" da aba Métricas, custo por etapa — CPL divide pelo lead do §2). Produtividade Real (v87.98): coluna Visitas = visita oficial da janela; o registro manual (`producao_eventos`) aparece como "registradas 7d" e segue sendo base de esforço e no-show. O funil por posição de etapa do RD saiu do 1:1. Continuam análise própria (não são contagem de marco): safras, tempos entre etapas, % das pastas que viraram venda, fontes por canal e as lanes de abertos agora.

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

**Telas que tinham previsão própria (revisão de 17/09/2026):**
- **Cérebro de Vendas / Meu Cérebro / Cockpit Conquista (v87.95):** número-título = Provável do §8A (empresa, equipe ou corretor). O pipeline ponderado continua só para ordenar a fila de ataque, rotulado "não é previsão".
- **Tela Projeção do menu Financeiro (`/forecast`, `api/v3/forecast/summary`) — aposentada na v87.96:** somava valor × peso da etapa (`PIPELINE_PESOS`) de todos os abertos do ano, uma terceira previsão. O link antigo abre a Gestão Comercial → 🎯 Meta · Realizado · Projeção, que tem os horizontes mês a ano.

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

## 11. Situação em 17/09/2026 (v87.95 → v88.4) e teste noturno

**No motor único ou na projeção oficial:** 1:1 (cards, funil, conversão, saúde, alertas, funil reverso, Norte), Gestão Comercial (visão, 🎯 Meta · Realizado · Projeção, esteira, métricas, custo por etapa, produtividade), Produtividade Real (leads, vendas, visita oficial), Cérebro de Vendas / Meu Cérebro / Cockpit Conquista (projeção oficial; ponderado só ordena a fila), Dashboard / Sala de Comando / KPIs, Agenda e Meu dia, Metas / Ranking / Relatórios, Modo TV (meta, projeção, leads, pipeline ponderado), Dashboard da Diretoria (meta, equipe ativa, ranking, projeção do ano), Marketing (VGV, lead pago no CPL), conciliação HUB × RD (lado RD), relatórios do CEO e do CMO, Sr. Gerência e chat dos agentes da diretoria. A tela Projeção (`/forecast`) foi aposentada.

**Continuam com cálculo próprio de propósito (não é contagem do Dicionário):** Comissão (valor por negócio, faixa por origem e por funil de produto — usa o mesmo VGV); atribuição por canal e cobertura de origem do Marketing (mede quanto do RD está com origem preenchida); funis de coorte/safra (Marketing, Gestão Comercial → safras e tempos); destaques da TV (maior ticket, venda do dia, plantão, visitas agendadas); casamento corretor HUB ↔ House na conciliação (por e-mail, rd_id e nome).

**Teste noturno (`api/v3/_consistencia_lib.py`, `/api/v3/system/consistency?cron=1`):** toda noite (cron 23h30 BRT + heartbeat; recupera de manhã se a noite passar em branco) recalcula pelo caminho de cada tela e compara com o motor: projeção oficial (empresa e equipes), Metas (mês, ano, por pessoa), Modo TV, Diretoria, conciliação HUB × RD e Marketing, além do frescor do sync do RD. Divergência vira aviso no sino e no celular dos sócios (1×/dia) e aparece no aviso de saúde da diretoria. Tela nova com número do Dicionário entra nesta lista.
