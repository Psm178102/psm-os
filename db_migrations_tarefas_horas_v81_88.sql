-- v81.88 — hora de início/fim nas tarefas. Aditivo + idempotente.
alter table dir_tasks
  add column if not exists hora_inicio text,
  add column if not exists hora_fim text;
