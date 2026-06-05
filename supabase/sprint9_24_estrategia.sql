-- Sprint 9.24 — Estratégia: quadros visuais (mapa mental, organograma, cronograma)
-- Cada quadro é um documento JSON único. Idempotente.
-- O endpoint /api/v3/diretoria/strategy degrada gracioso se a tabela não existir.

create table if not exists estrategia_boards (
  board       text primary key,   -- 'mindmap' | 'orgchart' | 'cronograma'
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);
