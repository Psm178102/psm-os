-- v84.23 — Reuniões confidenciais (🔒 só participantes veem, nem gestão fora da lista)
-- Aditivo e idempotente. Rodar no SQL Editor do Supabase (projeto PSM fdlnvpmlertjdgfkduzc).
alter table reunioes_atas add column if not exists confidencial boolean not null default false;
