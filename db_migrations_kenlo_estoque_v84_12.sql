-- v84.12 — Estoque Kenlo inteligente (06/07/2026)
-- (1) Colunas estruturadas extraídas do raw do Kenlo (tipo/dorms/área/vagas etc.)
--     → viram filtros e análises sem reprocessar jsonb a cada tela.
-- (2) Snapshot diário do estoque (série histórica pro gráfico de evolução do VGV).
-- Aditivo e idempotente. RLS ligado sem policies (acesso só pelo service role).

alter table kenlo_imoveis add column if not exists tipo text;
alter table kenlo_imoveis add column if not exists finalidade text;   -- venda | locacao | venda_locacao
alter table kenlo_imoveis add column if not exists dorms int;
alter table kenlo_imoveis add column if not exists banheiros int;
alter table kenlo_imoveis add column if not exists suites int;
alter table kenlo_imoveis add column if not exists vagas int;
alter table kenlo_imoveis add column if not exists area_util numeric;
alter table kenlo_imoveis add column if not exists area_total numeric;
alter table kenlo_imoveis add column if not exists condominio numeric;

create index if not exists kenlo_imoveis_tipo_idx on kenlo_imoveis (tipo);
create index if not exists kenlo_imoveis_bairro_idx on kenlo_imoveis (bairro);

create table if not exists kenlo_estoque_snapshots (
  dia date primary key,
  total int,
  vgv_venda numeric,
  aluguel_mensal numeric,
  sem_foto int,
  d90 int,
  d180 int,
  por_tipo jsonb,
  criado_em timestamptz default now()
);

alter table kenlo_estoque_snapshots enable row level security;
