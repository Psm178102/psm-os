# Lead do WhatsApp com roleta — v88.9

A mensagem que chega no número da Vera vira card com dono, no RD e no House.
Quem responde a conversa (IA nativa do Meta no app, ou a nossa) é indiferente:
o gatilho é a mensagem do cliente chegando no webhook da Cloud API.

## O caminho

```
cliente escreve → cloud_webhook → _leads_lib.processar_mensagem
   ├─ classifica a trilha pela frase de origem (comprar · captação · locação · conquista)
   ├─ dedupe: mesmo número em 30 dias = mesma conversa; cliente com negócio aberto avisa o dono
   ├─ roleta escolhe o corretor (menor carga do dia, ou rodízio)
   ├─ RD: cria contato + deal na etapa de entrada, já com o dono
   ├─ House: espelha em `deals` (aparece no kanban na hora; o sync faz upsert por id depois)
   └─ avisa o corretor (notificação + push) — nunca broadcast
```

## Ligar (na ordem)

1. **SQL** — rode `supabase/sprint_wa_leads_roleta.sql` no editor do Supabase. Aditivo e idempotente.
2. **Coexistência** — o número da Vera precisa estar na Cloud API *e* continuar no app.
   Sem isso não há webhook e nada aqui roda. Checklist em `api/v3/wa/config.py`.
3. **Envs no Vercel** — `META_APP_SECRET` (**obrigatória**: sem ela um POST forjado cria
   lead e consome a roleta), `WA_CLOUD_TOKEN`, `WA_PHONE_ID`, `WA_CLOUD_VERIFY_TOKEN`,
   `RD_CRM_TOKEN`, `CRON_SECRET`.
4. **Etapas do RD** — `rd_stage` por trilha: o id da etapa de entrada de cada funil.
   Sem o id, o lead nasce local mas não vira card no RD (o erro fica em `wa_leads.erro`).
5. **Filas** — `trilhas`: os `users.id` de cada trilha, na ordem. Fila vazia = cai no fallback.
6. **Portão** — `ativo: true`. Enquanto for `false`, o webhook só registra o lead e não
   distribui nada; é o modo sombra para medir a classificação sem mexer no funil de ninguém.

Tudo isso em `POST /api/v3/wa/roleta {action:"config", cfg:{...}}` (lvl ≥ 7), guardado em
`shared_kv.wa_roleta_config`.

## Operação

- `GET /api/v3/wa/roleta` — meus leads, os do dia e o placar por trilha.
- `POST {action:"assumir", lead_id}` — o corretor pega o lead. É esse clique que para o SLA:
  com um número só, ele não tem como "responder no WhatsApp dele" para provar que assumiu.
- `POST {action:"classificar", lead_id, trilha}` — lead que chegou sem etiqueta ("oi").
- `POST {action:"simular", texto}` — testa a classificação sem gravar nada.
- Cron `*/10` (11h–23h UTC ≈ 8h–20h BRT): distribui o que dormiu na fila e cobra o SLA.
  `repique_auto` passa para o próximo da fila; nasce desligado.

## Teste

```
python3 tests/test_wa_roleta.py
```

Roda sem rede e sem credenciais. Cobre classificação, roleta, idempotência, SLA e repique.
