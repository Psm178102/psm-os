-- ════════════════════════════════════════════════════════════════════════
-- Sprint 9.5b — One-on-One (tabela one_on_ones)
-- A página /one-on-one (oo.js) + endpoints /api/v3/oo/* já existiam, mas a
-- tabela NUNCA tinha sido criada no banco → aparecia "vazio". Criada via Chrome
-- MCP em 2026-05-28. Colunas espelham api/v3/oo/upsert.py.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists one_on_ones (
  id           bigserial primary key,
  corretor_id  text references users(id),
  lider_id     text references users(id),
  data         date,
  proxima_data date,
  observacoes  text,
  acoes        jsonb default '[]'::jsonb,
  criado_por   text references users(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_oo_corretor on one_on_ones(corretor_id);
create index if not exists idx_oo_data on one_on_ones(data desc);
