-- v88.43 — tarefa com MAIS DE UM responsável. Aditivo + idempotente.
-- `responsavel` continua sendo o principal; os demais ficam em `corresponsaveis`
-- (ids de users). Enquanto esta coluna não existir, o sistema segue funcionando
-- com um responsável só (o save descarta o campo e avisa).
alter table dir_tasks
  add column if not exists corresponsaveis text[] not null default '{}';

create index if not exists idx_dir_tasks_corresponsaveis
  on dir_tasks using gin (corresponsaveis);

-- A lista de categorias editável mora no shared_kv (key 'tarefas_categorias') —
-- não precisa de tabela nova.
