-- v77.88 — coluna 'marca' (MAP / Conquista) na tabela de lançamentos.
-- Rodar uma vez no Supabase (SQL Editor). É idempotente.
alter table public.lancamentos add column if not exists marca text;
-- (opcional) índice pra filtrar por marca
create index if not exists idx_lancamentos_marca on public.lancamentos (marca);
