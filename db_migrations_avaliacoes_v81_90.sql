-- v81.90 — Avaliações & Feedbacks (gestão de desempenho). Aditivo + idempotente.
create table if not exists gp_avaliacoes (
  id text primary key,
  ciclo_id text,
  avaliado_id text,
  avaliador_id text,
  tipo text,                 -- auto | gestor | par | subordinado
  cargo text,
  notas jsonb default '{}'::jsonb,
  nota_final numeric,
  nota_calibrada numeric,
  calibrado_por text,
  desempenho int,            -- 9-box X (1-3)
  potencial int,             -- 9-box Y (1-3)
  comentario text,
  pontos_fortes text,
  a_desenvolver text,
  status text default 'rascunho',
  criado_em timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_gp_avaliacoes_avaliado on gp_avaliacoes(avaliado_id);
create index if not exists idx_gp_avaliacoes_ciclo on gp_avaliacoes(ciclo_id);

create table if not exists gp_feedbacks (
  id text primary key,
  para_id text,
  de_id text,
  tipo text,                 -- elogio | melhoria | 1a1 | reconhecimento
  texto text,
  publico boolean default false,
  ciclo_id text,
  criado_em timestamptz default now()
);
create index if not exists idx_gp_feedbacks_para on gp_feedbacks(para_id);
