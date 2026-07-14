-- v84.43 — Integração Zoho Calendar (duas vias, por usuário)
-- Cada usuário conecta o próprio Zoho (OAuth); o refresh_token fica por usuário.
-- eventos ganha vínculo com o evento espelho no Zoho (evita duplicar no 2-way).

create table if not exists zoho_conexoes (
  user_id text primary key,
  zoho_email text,
  refresh_token text not null,
  api_domain text,                       -- retornado no OAuth (ex.: https://www.zohoapis.com)
  calendar_uid text,                     -- uid da agenda default do usuário no Zoho
  last_sync_at timestamptz,
  last_sync_res jsonb,
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz default now()
);
alter table zoho_conexoes enable row level security;

alter table eventos add column if not exists zoho_uid text;    -- uid do evento espelho no Zoho
alter table eventos add column if not exists zoho_etag text;   -- etag p/ detectar mudança
alter table eventos add column if not exists origem text;      -- house | zoho
alter table eventos add column if not exists owner_id text;    -- dono da conexão (sync por usuário)
create index if not exists eventos_zoho_uid_idx on eventos (zoho_uid);
create index if not exists eventos_owner_idx on eventos (owner_id);
