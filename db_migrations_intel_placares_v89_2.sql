-- v89.2 — 🎯 Placares da Inteligência (semana 1): o sistema passa a medir se ACERTA.
-- Decisão do Paulo (29/09/2026): "o agente prepara, eu decido".
--   intel_placar_projecao  — foto diária da projeção oficial (empresa + equipes). No fim do mês
--                            compara com o realizado: a partir de que dia útil a projeção é confiável.
--   intel_placar_notas     — foto semanal da nota (0-100) dos negócios abertos dos últimos 60 dias.
--                            30/60 dias depois: os "quentes" venderam mais que os "frios"?
-- Tabelas pequenas (5 linhas/dia; ~1.500 linhas/semana). RLS ligado SEM políticas: só o
-- service_role (backend) lê e grava — a anon key é pública.

create table if not exists public.intel_placar_projecao (
  dia              date not null,
  equipe           text not null,          -- '_empresa' | conquista | map | terceiros | locacao
  mes              text not null,          -- 'AAAA-MM'
  realizado_vgv    numeric, realizado_vendas numeric,
  provavel_vgv     numeric, provavel_vendas  numeric,
  conservador_vgv  numeric, otimista_vgv     numeric,
  meta_vgv         numeric, meta_vendas      numeric,
  du_decorridos    int, du_total int,
  criado_em        timestamptz not null default now(),
  primary key (dia, equipe)
);

create table if not exists public.intel_placar_notas (
  semana         date not null,            -- segunda-feira da semana da foto
  deal_id        text not null,
  score          int, temp text, ms int, canal text,
  user_id        text, user_email text, pipeline text,
  amount         numeric, created_at_rd timestamptz,
  criado_em      timestamptz not null default now(),
  primary key (semana, deal_id)
);
create index if not exists intel_placar_notas_deal on public.intel_placar_notas (deal_id);

alter table public.intel_placar_projecao enable row level security;
alter table public.intel_placar_notas enable row level security;
