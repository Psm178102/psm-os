-- v84.25 — Kanban de Abordagem da Indicação Premiada (Mariane)
-- Cards vindos do RD CRM em 3 bases automáticas + gestão manual.
-- Aditivo e idempotente. RLS ligado sem policies (acesso via service role).

create table if not exists indicacao_kanban (
  id uuid primary key default gen_random_uuid(),
  deal_id text unique,                       -- vínculo com deals (RD); null = card manual
  base text not null default 'manual',       -- carteira_map | visita_60d | fechou_12m | manual
  nome text not null,
  contato text,
  coluna text not null default 'a_abordar',
  etiquetas jsonb not null default '[]'::jsonb,
  obs text,
  objetivo text,                             -- venda | captacao | locacao
  valor_indicacao numeric,
  premio numeric,
  descarte_motivo text,                      -- duplicado | nao_quis | nao_responde | outro: ...
  tarefa jsonb,                              -- {data, hora_ini, hora_fim, titulo, evento_id}
  indicacao_id uuid,                         -- se virou indicação no funil
  abordado_em timestamptz,                   -- 1ª abordagem (conta na Fiscalização)
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz default now(),
  atualizado_por text
);
create index if not exists ik_coluna_idx on indicacao_kanban (coluna);
create index if not exists ik_base_idx on indicacao_kanban (base);
alter table indicacao_kanban enable row level security;
