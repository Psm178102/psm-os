-- v88.13 — Cascata de planejamento: Norte → Objetivo estratégico → OKR → KR (manual ou ligado às Metas) → Projeto.
-- Aditiva e idempotente. O OKR passa a apontar pro Objetivo (tabela estrategia, tipo='objetivo') e ganha área.
alter table public.okrs add column if not exists objetivo_id text;
alter table public.okrs add column if not exists area text;
create index if not exists okrs_objetivo_id_idx on public.okrs (objetivo_id);
