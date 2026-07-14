-- v84.40 — Kanban de Reativação MAP (Leire, Secretaria de Vendas)
-- Leads do FUNIL MAP abertos e parados (com telefone) → kanban com cadência
-- de 40/dia, fluxos, IA e fiscalização automática (reativacao_tocada).
create table if not exists reativacao_kanban (
  id uuid primary key default gen_random_uuid(),
  deal_id text unique,
  nome text not null,
  contato text,
  corretor_email text,
  valor numeric,
  estagio text,
  parado_desde timestamptz,
  coluna text not null default 'a_reativar',
  etiquetas jsonb not null default '[]'::jsonb,
  obs text,
  descarte_motivo text,
  tarefa jsonb,
  abordado_em timestamptz,
  reativado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz default now(),
  atualizado_por text
);
create index if not exists rk_coluna_idx on reativacao_kanban (coluna);
alter table reativacao_kanban enable row level security;
