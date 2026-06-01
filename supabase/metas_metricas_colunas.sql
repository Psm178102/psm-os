-- ============================================================================
-- v76.33 — Garante TODAS as colunas de métricas na tabela `metas`.
-- Idempotente: "ADD COLUMN IF NOT EXISTS" não faz nada se a coluna já existe.
-- Necessário porque `schema_full.sql` usa "create table if not exists" (não
-- altera tabela já existente). O Planejador de Metas grava as 5 métricas:
-- VGV · Vendas · Agendamentos · Visitas · Pastas (+ Propostas/Pontos legado).
-- ============================================================================
alter table metas add column if not exists meta_vgv          numeric default 0;
alter table metas add column if not exists meta_vendas       int     default 0;
alter table metas add column if not exists meta_pontos       numeric default 0;
alter table metas add column if not exists meta_visitas      int     default 0;
alter table metas add column if not exists meta_pastas       int     default 0;
alter table metas add column if not exists meta_propostas    int     default 0;
alter table metas add column if not exists meta_agendamentos int     default 0;
alter table metas add column if not exists observacoes       text;
alter table metas add column if not exists criado_por        text;

-- Recarrega o schema cache do PostgREST (evita PGRST204 logo após o ALTER).
notify pgrst, 'reload schema';
