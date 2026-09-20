-- v88.9 — Lead do WhatsApp com roleta (Vera/Cloud API)
-- Cada primeira mensagem de um número novo vira lead: trilha, corretor da roleta,
-- deal no RD e espelho local. Aditivo e idempotente — pode rodar de novo sem medo.
-- RLS ligado sem policy: só o backend (service_role) enxerga, igual às demais tabelas.

create table if not exists public.wa_leads (
  id            bigserial primary key,
  wa_phone      text not null,                 -- 55DDDNÚMERO (norm_phone)
  wa_msg_id     text,                          -- id da mensagem que abriu o lead (idempotência)
  nome          text,
  trilha        text not null default 'indefinido',  -- comprar|captacao|locacao|conquista|indefinido
  primeira_msg  text,
  origem        text default 'wa_vera',
  status        text not null default 'novo',  -- novo|distribuido|assumido|descartado|duplicado
  corretor_id   uuid,                          -- users.id do House
  distribuido_em timestamptz,
  assumido_em   timestamptz,
  repiques      int not null default 0,
  rd_deal_id    text,
  rd_contact_id text,
  ficha         jsonb not null default '{}'::jsonb,
  historico     jsonb not null default '[]'::jsonb,
  erro          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- idempotência da Meta: o mesmo wa_msg_id nunca abre dois leads
create unique index if not exists wa_leads_msg_uidx on public.wa_leads (wa_msg_id) where wa_msg_id is not null;
create index if not exists wa_leads_phone_idx   on public.wa_leads (wa_phone, created_at desc);
create index if not exists wa_leads_status_idx  on public.wa_leads (status, created_at desc);
create index if not exists wa_leads_corretor_idx on public.wa_leads (corretor_id, created_at desc);
-- fila do repique: quem foi distribuído e ninguém assumiu
create index if not exists wa_leads_pendente_idx on public.wa_leads (distribuido_em)
  where status = 'distribuido' and assumido_em is null;

alter table public.wa_leads enable row level security;

-- recibo de entrega do webhook (mesmo espírito do lp_webhook_log)
create table if not exists public.wa_leads_log (
  id       bigserial primary key,
  ok       boolean not null default true,
  acao     text,                              -- criado|duplicado|sem_trilha|reatribuido|erro_rd
  motivo   text,
  wa_phone text,
  lead_id  bigint,
  ts       timestamptz not null default now()
);
create index if not exists wa_leads_log_ts_idx on public.wa_leads_log (ts desc);
alter table public.wa_leads_log enable row level security;
