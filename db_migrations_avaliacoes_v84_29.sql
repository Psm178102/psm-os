-- v84.29 — Avaliações & Feedbacks (Kanban NPS da Mariane)
-- Cards automáticos: visitas realizadas nos funis MAP/Conquista/Terceiros/Locação.
-- Aditivo e idempotente. RLS ligado sem policies (acesso via service role).

create table if not exists avaliacoes_kanban (
  id uuid primary key default gen_random_uuid(),
  deal_id text unique,                       -- vínculo com deals (RD); null = card manual
  origem text not null default 'manual',     -- map | conquista | terceiros | locacoes | manual
  nome text not null,
  contato text,
  corretor_email text,                       -- corretor do deal no RD (pra mencionar)
  coluna text not null default 'origens',
  nota numeric,                              -- 0 a 10
  feedback text,
  etiquetas jsonb not null default '[]'::jsonb,
  obs text,
  mencoes jsonb not null default '[]'::jsonb,
  descarte_motivo text,
  tarefa jsonb,
  indicacao_criada boolean default false,    -- promotor já virou card na Indicação Premiada
  visita_em timestamptz,
  abordado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz default now(),
  atualizado_por text
);
create index if not exists av_coluna_idx on avaliacoes_kanban (coluna);
create index if not exists av_origem_idx on avaliacoes_kanban (origem);
alter table avaliacoes_kanban enable row level security;
