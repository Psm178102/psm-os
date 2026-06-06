-- Sprint 9.25 — PSM Academy vira faculdade (níveis + módulos + progresso por aluno)
-- Idempotente. Acrescenta a coluna 'modulo' às aulas e cria o tracking de progresso.

-- 1) Coluna de módulo nas aulas (academy_items já existe da sprint 9.22)
alter table academy_items add column if not exists modulo text;

-- 2) Progresso por aluno: 1 linha por (usuário, aula concluída)
create table if not exists academy_progress (
  user_id      text not null,
  item_id      text not null,
  completed_at timestamptz default now(),
  primary key (user_id, item_id)
);

create index if not exists academy_progress_user_idx on academy_progress (user_id);
