-- ============================================================
-- PSM OS - Supabase Schema
-- ============================================================
-- Execute este arquivo no SQL Editor do Supabase APOS criar o projeto.
-- Ordem: (1) cria extensions, (2) tabelas, (3) funcoes, (4) RLS,
--        (5) triggers, (6) realtime.
--
-- IMPORTANTE: depois de rodar, va em Database > Replication e
-- confirme que shared_kv esta publicada em supabase_realtime.
-- ============================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto";

-- ============================================================
-- TABELAS
-- ============================================================

-- Perfis (liga auth.users ao legacy BROKERS id usado no index.html)
create table if not exists public.profiles (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  legacy_id text unique,               -- ex: "b_paulo", "b_nani"... usado hoje no codigo
  nome      text not null,
  email     text,
  role      text not null default 'corretor'
            check (role in ('diretor','gerente','corretor','staff','admin')),
  equipe    text,                      -- "Conquista","MAP","Terceiros","Locacao"
  ativo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_legacy_id_idx on public.profiles(legacy_id);
create index if not exists profiles_role_idx on public.profiles(role);

-- KV por usuario (cada corretor tem SEUS dados privados aqui)
-- Ex.: key = "oo_reunioes_b_paulo", value = {...jsonb...}
create table if not exists public.user_kv (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index if not exists user_kv_updated_idx on public.user_kv(updated_at desc);

-- KV compartilhado (substitui os SYNC_KEYS atuais no Firebase)
-- Ex.: key = "BROKERS", "PROJETOS", "LEADS_POOL"...
create table if not exists public.shared_kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index if not exists shared_kv_updated_idx on public.shared_kv(updated_at desc);

-- Audit log (tudo que toca shared_kv fica aqui; diretores leem)
create table if not exists public.audit_log (
  id         bigserial primary key,
  user_id    uuid references auth.users(id),
  table_name text not null,
  key        text,
  operation  text not null check (operation in ('insert','update','delete')),
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);
create index if not exists audit_log_key_idx on public.audit_log(key);

-- ============================================================
-- FUNCOES
-- ============================================================

-- Helper: retorna true se o usuario atual eh diretor/admin
create or replace function public.is_diretor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and role in ('diretor','admin')
      and ativo = true
  );
$$;

-- Trigger: atualiza updated_at automaticamente
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger: grava em audit_log toda mudanca em shared_kv
create or replace function public.log_shared_kv()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'DELETE') then
    insert into public.audit_log(user_id, table_name, key, operation, old_value, new_value)
    values (auth.uid(), 'shared_kv', old.key, 'delete', old.value, null);
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.audit_log(user_id, table_name, key, operation, old_value, new_value)
    values (auth.uid(), 'shared_kv', new.key, 'update', old.value, new.value);
    new.updated_by := auth.uid();
    return new;
  elsif (tg_op = 'INSERT') then
    insert into public.audit_log(user_id, table_name, key, operation, old_value, new_value)
    values (auth.uid(), 'shared_kv', new.key, 'insert', null, new.value);
    new.updated_by := auth.uid();
    return new;
  end if;
  return null;
end;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists user_kv_touch on public.user_kv;
create trigger user_kv_touch
  before update on public.user_kv
  for each row execute function public.touch_updated_at();

drop trigger if exists shared_kv_touch on public.shared_kv;
create trigger shared_kv_touch
  before update on public.shared_kv
  for each row execute function public.touch_updated_at();

drop trigger if exists shared_kv_audit on public.shared_kv;
create trigger shared_kv_audit
  after insert or update or delete on public.shared_kv
  for each row execute function public.log_shared_kv();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles  enable row level security;
alter table public.user_kv   enable row level security;
alter table public.shared_kv enable row level security;
alter table public.audit_log enable row level security;

-- --- profiles ---
drop policy if exists profiles_read       on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_diretor_all on public.profiles;

-- Todos autenticados leem todos os perfis (precisam pra montar a UI do time)
create policy profiles_read
  on public.profiles for select
  to authenticated
  using (true);

-- Usuario so edita o proprio perfil
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Diretores/admin podem tudo
create policy profiles_diretor_all
  on public.profiles for all
  to authenticated
  using (public.is_diretor())
  with check (public.is_diretor());

-- --- user_kv ---
drop policy if exists user_kv_self         on public.user_kv;
drop policy if exists user_kv_diretor_read on public.user_kv;

-- Cada usuario mexe APENAS no proprio user_kv
create policy user_kv_self
  on public.user_kv for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Diretores podem LER (nao escrever) user_kv dos outros pra relatorios
create policy user_kv_diretor_read
  on public.user_kv for select
  to authenticated
  using (public.is_diretor());

-- --- shared_kv ---
drop policy if exists shared_kv_read  on public.shared_kv;
drop policy if exists shared_kv_write on public.shared_kv;

create policy shared_kv_read
  on public.shared_kv for select
  to authenticated
  using (true);

create policy shared_kv_write
  on public.shared_kv for all
  to authenticated
  using (true)
  with check (true);

-- --- audit_log ---
drop policy if exists audit_log_diretor on public.audit_log;

create policy audit_log_diretor
  on public.audit_log for select
  to authenticated
  using (public.is_diretor());

-- ============================================================
-- REALTIME
-- ============================================================
-- Realtime fica ligado em shared_kv (substitui os listeners Firebase
-- de BROKERS, PROJETOS, LEADS_POOL etc).
-- user_kv NAO vai em realtime de proposito: evita broadcast de
-- dados privados de corretor.

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.shared_kv;

-- ============================================================
-- FIM
-- ============================================================
