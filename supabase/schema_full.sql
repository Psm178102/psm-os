-- ============================================================================
-- PSM-OS — SCHEMA REPRODUTÍVEL (tabelas core que não tinham DDL versionado)
-- ----------------------------------------------------------------------------
-- POR QUE ESTE ARQUIVO EXISTE
-- O diagnóstico de 2026-05-29 encontrou 18 tabelas centrais usadas pelo backend
-- que NÃO tinham `create table` em NENHUM .sql do repositório — existiam só no
-- Supabase de produção (criadas na mão). Isso é a raiz do "fica incompleto / dá
-- erro": se uma tabela some, o Supabase reseta, ou você monta um ambiente novo,
-- o sistema quebra sem schema pra recriar.
--
-- Este arquivo reconstrói essas tabelas a partir do USO REAL no código
-- (colunas vistas em insert/upsert/select/filtros). É a fonte única reproduzível.
--
-- SEGURANÇA: tudo é `create table if not exists` + `add column if not exists`.
-- Em um banco que JÁ tem essas tabelas (produção), rodar isto é NO-OP seguro —
-- não apaga, não sobrescreve dados. Em banco novo, recria tudo.
--
-- TIPOS: inferidos do código (valores gerados). Revise contra produção se tiver
-- dúvida — colunas extras enviadas só pelo frontend podem não estar aqui.
-- IDs: tabelas com id gerado no código = TEXT (prefixos rc_/ev_/im_/…);
--      tabelas sem id no código = bigserial (gerado pelo banco).
-- ============================================================================

-- ── deals (CRM RD sincronizado) ─────────────────────────────────────────────
create table if not exists deals (
  id            text primary key,           -- id externo do RD
  name          text,
  amount        numeric default 0,
  win           boolean,                     -- tri-state: true/false/null
  closed_at     timestamptz,
  created_at_rd timestamptz,
  updated_at_rd timestamptz,
  pipeline_id   text,
  pipeline_name text,
  stage_id      text,
  stage_name    text,
  user_email    text,
  user_id       text,
  rd_raw        jsonb,
  synced_at     timestamptz default now()
);
create index if not exists idx_deals_updated   on deals (updated_at_rd desc);
create index if not exists idx_deals_pipeline   on deals (pipeline_id);
create index if not exists idx_deals_user_email on deals (user_email);
create index if not exists idx_deals_closed     on deals (closed_at);

-- ── notifications ────────────────────────────────────────────────────────────
create table if not exists notifications (
  id          text primary key,             -- "nt_"+uuid
  user_id     text,
  tipo        text,
  title       text,
  body        text,
  link        text,
  target_type text,
  target_id   text,
  lida        boolean default false,
  lida_em     timestamptz,
  created_at  timestamptz default now()
);
create index if not exists idx_notif_user on notifications (user_id, lida);
create index if not exists idx_notif_created on notifications (created_at desc);

-- ── metas (id gerado pelo banco; unique por corretor/ano/mês) ────────────────
create table if not exists metas (
  id               bigserial primary key,
  corretor_id      text not null,
  ano              int  not null,
  mes              int  not null,
  meta_vgv         numeric default 0,
  meta_vendas      int     default 0,
  meta_pontos      numeric default 0,
  meta_visitas     int     default 0,
  meta_pastas      int     default 0,
  meta_propostas   int     default 0,
  meta_agendamentos int    default 0,
  observacoes      text,
  criado_por       text,
  created_at       timestamptz default now(),
  unique (corretor_id, ano, mes)
);

-- ── eventos (agenda) ─────────────────────────────────────────────────────────
create table if not exists eventos (
  id            text primary key,           -- "ev_"+uuid
  tipo          text,
  titulo        text,
  descricao     text,
  data          date,
  hora_inicio   text,
  hora_fim      text,
  all_day       boolean default false,
  corretor_id   text,
  participantes jsonb,
  local         text,
  cor           text,
  status        text default 'agendado',
  criado_por    text,
  created_at    timestamptz default now()
);
create index if not exists idx_eventos_data on eventos (data);

-- ── rd_stages / rd_pipelines (config de funil; populadas externamente) ───────
create table if not exists rd_pipelines (
  id                     text primary key,
  external_id            text,
  name                   text,
  frente                 text,
  active                 boolean default true,
  excluded               boolean default false,
  excluded_from_metrics  boolean default false
);

create table if not exists rd_stages (
  id              text primary key,
  external_id     text,
  stage_id        text,
  pipeline_id     text,
  rd_pipeline_id  text,
  pipeline        text,
  name            text,
  position        int,
  "order"         int,                       -- palavra reservada → entre aspas
  psm_stage_key   text,
  weight          numeric,
  active          boolean default true,
  is_won          boolean default false,
  is_lost         boolean default false,
  nickname        text
);
create index if not exists idx_rd_stages_pipeline on rd_stages (pipeline_id);

-- ── imoveis ──────────────────────────────────────────────────────────────────
create table if not exists imoveis (
  id          text primary key,             -- "im_"+uuid
  codigo      text,
  tipo        text,
  endereco    text,
  bairro      text,
  cidade      text,
  valor       numeric,
  area_m2     numeric,
  dormitorios int,
  vagas       int,
  descricao   text,
  link_fotos  text,
  captador_id text,
  criado_por  text,
  origem      text,
  status      text default 'disponivel',
  created_at  timestamptz default now()
);

-- ── recados (mural diretoria) ────────────────────────────────────────────────
create table if not exists recados (
  id          text primary key,             -- "rc_"+uuid
  texto       text,
  autor_id    text,
  audiencia   text default 'todos',
  prioridade  text default 'info',
  data_inicio timestamptz default now(),
  data_fim    timestamptz,
  fixado      boolean default false
);
create index if not exists idx_recados_fim on recados (data_fim);

-- ── comments (polimórfico) ───────────────────────────────────────────────────
create table if not exists comments (
  id          text primary key,             -- "cm_"+uuid
  target_type text,
  target_id   text,
  autor_id    text,
  texto       text,
  mentions    jsonb,
  created_at  timestamptz default now()
);
create index if not exists idx_comments_target on comments (target_type, target_id);

-- ── dir_tasks (tarefas diretoria) ────────────────────────────────────────────
create table if not exists dir_tasks (
  id          text primary key,             -- "t_"+uuid
  titulo      text,
  descricao   text,
  status      text default 'aberta',
  prioridade  text default 'media',
  categoria   text,
  responsavel text,
  criado_por  text,
  criado_em   bigint,                        -- epoch ms (NÃO timestamptz)
  inicio      text,
  prazo       text,
  observacoes text,
  historico   jsonb
);
create index if not exists idx_dir_tasks_status on dir_tasks (status);

-- ── locacoes ─────────────────────────────────────────────────────────────────
create table if not exists locacoes (
  id                    text primary key,   -- "lo_"+uuid
  endereco              text,
  bairro                text,
  cidade                text,
  proprietario_nome     text,
  proprietario_contato  text,
  inquilino_nome        text,
  inquilino_contato     text,
  valor_aluguel         numeric,
  valor_condominio      numeric,
  valor_iptu            numeric,
  dia_vencimento        int,
  data_inicio_contrato  date,
  data_fim_contrato     date,
  status                text,
  responsavel_id        text,
  observacoes           text,
  criado_por            text,
  created_at            timestamptz default now()
);

-- ── lancamentos ──────────────────────────────────────────────────────────────
create table if not exists lancamentos (
  id                 text primary key,      -- "lc_"+uuid
  nome               text,
  construtora        text,
  data_lancamento    date,
  etapa              text,
  comissao_pct       numeric,
  vgv_total          numeric,
  unidades_total     int,
  unidades_vendidas  int,
  status             text,
  responsavel_id     text,
  descricao          text,
  link_pasta         text,
  criado_por         text,
  created_at         timestamptz default now()
);

-- ── concorrentes (radar) ─────────────────────────────────────────────────────
create table if not exists concorrentes (
  id                 bigserial primary key,
  nome               text,
  segmento           text,
  anuncios_count     int default 0,
  link               text,
  observacoes        text,
  ultima_atualizacao timestamptz default now(),
  criado_por         text
);

-- ── plantoes ─────────────────────────────────────────────────────────────────
create table if not exists plantoes (
  id          bigserial primary key,
  data        date,
  periodo     text,
  corretor_id text,
  status      text,
  observacoes text,
  criado_por  text,
  created_at  timestamptz default now()
);
create index if not exists idx_plantoes_data on plantoes (data);

-- ── check_ins ────────────────────────────────────────────────────────────────
create table if not exists check_ins (
  id         bigserial primary key,
  user_id    text,
  tipo       text,                           -- in | out
  ts         timestamptz default now(),
  ip         text,
  observacao text
);
create index if not exists idx_checkins_user on check_ins (user_id, ts desc);

-- ── commissions (id uuid gerado pelo banco) ──────────────────────────────────
create table if not exists commissions (
  id             text primary key default gen_random_uuid()::text,
  corretor_id    text,
  corretor_nome  text,
  valor          numeric,
  status         text,
  data           date,
  data_pagamento date,
  created_at     timestamptz default now()
);

-- ── estrategia (visão/missão/OKR diretoria) ─────────────────────────────────
create table if not exists estrategia (
  id         bigserial primary key,
  ano        int,
  tipo       text,
  titulo     text,
  descricao  text,
  status     text default 'ativo',
  ordem      int default 0,
  progresso  int default 0,
  criado_por text,
  created_at timestamptz default now()
);

-- ── transfers (id uuid gerado pelo banco) ────────────────────────────────────
create table if not exists transfers (
  id         text primary key default gen_random_uuid()::text,
  descricao  text,
  valor      numeric,
  data       date,
  created_at timestamptz default now()
);

-- ============================================================================
-- FIM. Tabelas que JÁ têm DDL versionado (não repetidas aqui, evitar divergência):
--   profiles, user_kv, shared_kv, audit_log        → supabase/schema.sql
--   users, teams                                    → docs/v2_schema.sql
--   user_sessions, password_reset_tokens            → docs/v3_auth_schema.sql
--   cadencia_psm, canal_anonimo, fichas_propostas, gp_talentos, gp_treinamentos,
--   okrs, oportunidades_psm, premiacoes, tendencias → supabase/SPRINT8_COMPLETE.sql
--   captacoes, sdr_touchpoints                       → supabase/sprint9_4_sdr_prospeccao.sql
--   one_on_ones                                      → supabase/sprint9_5b_one_on_ones.sql
--   deal_stage_events                                → supabase/sprint9_10_deal_stage_events.sql
--   push_subscriptions                               → supabase/sprint9_9_push_subscriptions.sql
--   meta_ads_cache                                   → supabase/sprint9_12_meta_ads_cache.sql
--   brand_rules                                      → supabase/sprint9_13_brand_rules.sql
-- Para montar um ambiente novo do zero: rode todos os .sql de supabase/ + docs/.
-- ============================================================================
