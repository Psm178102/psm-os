-- Sprint 9.20 — Briefing de Guerra (boletim do comandante semanal)
-- Histórico dos briefings gerados (manual ou pelo cron de segunda). Cada linha
-- guarda o texto da IA + o snapshot de fatos que o embasou. Degrada gracioso:
-- se a tabela não existir, o briefing ainda é gerado e exibido, só não persiste.

create table if not exists war_briefings (
  id          bigserial primary key,
  briefing    text,                          -- markdown gerado pela IA
  facts       jsonb default '{}'::jsonb,       -- snapshot de fatos (vendas/ads/concorrência)
  model       text,                           -- modelo de IA usado
  criado_por  text,                           -- user id (null = cron/sistema)
  created_at  timestamptz not null default now()
);
create index if not exists idx_warbrief_recent on war_briefings (created_at desc);
