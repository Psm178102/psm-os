-- ════════════════════════════════════════════════════════════════════════
-- v84.86 — Leads LP Conquista (receptor do duplo destino LP → RD + House)
-- Aditivo e idempotente. RLS trancado (padrão das 57 tabelas: sem policy
-- pra anon/authenticated; só a service key do backend acessa).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists leads_lp (
  id                   text primary key default ('lp_' || replace(gen_random_uuid()::text, '-', '')),
  lead_id              text not null unique,          -- idempotência do retry da LP
  nome                 text,
  whatsapp             text,                          -- normalizado 55DDDNÚMERO
  email                text,
  faixa_renda          text,                          -- ex F2_3500_4000 · ATE_2250
  nutricao             boolean default false,         -- ATE_2250 → lista da Mariane/CS
  origem               text default 'lp_psmconquista',
  utms                 jsonb default '{}'::jsonb,
  pagina_ancora        text,
  ts_submit            timestamptz,                   -- quando enviou na LP
  ts_recebido          timestamptz default now(),     -- quando chegou aqui
  rd_deal_ref          text,                          -- casado com o deal do RD (paridade)
  status_atendimento   text default 'novo',           -- novo|em_atendimento|agendado|descartado|nutricao
  atendido_por         text,                          -- user id do ✋ Atendi
  ts_primeira_resposta timestamptz,                   -- speed-to-lead
  historico            jsonb default '[]'::jsonb
);
create index if not exists idx_leads_lp_whatsapp on leads_lp (whatsapp);
create index if not exists idx_leads_lp_recebido on leads_lp (ts_recebido desc);
create index if not exists idx_leads_lp_status   on leads_lp (status_atendimento);

-- recibo de entrega da LP: toda tentativa (ok/falha), base do rate-limit
create table if not exists lp_webhook_log (
  id       bigint generated always as identity primary key,
  ts       timestamptz default now(),
  ok       boolean,
  status   int,
  motivo   text,
  lead_id  text,
  ip       text
);
create index if not exists idx_lp_whlog_ts on lp_webhook_log (ts desc);
create index if not exists idx_lp_whlog_ip on lp_webhook_log (ip, ts desc);

alter table leads_lp       enable row level security;
alter table lp_webhook_log enable row level security;

select 'leads_lp'       as tabela, count(*) from leads_lp
union all
select 'lp_webhook_log', count(*) from lp_webhook_log;
