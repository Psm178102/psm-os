-- Sprint 9.17 — HOTFIX constraint de status/prioridade das tarefas (dir_tasks)
--
-- Bug encontrado no teste ao vivo (2026-05-29): a tabela dir_tasks em produção
-- tinha uma check constraint ANTIGA cujo status só aceitava valores legados
-- (ex.: 'backlog', 'em_andamento', ...), enquanto o backend (Sprint 7.6) envia
-- 'aberta'/'em_andamento'/'concluida'/'cancelada'/'atrasada'. Resultado: TODA
-- criação de tarefa falhava com 23514 (violates check constraint
-- "dir_tasks_status_check"). Tarefas nunca salvavam.
--
-- Fix: alinhar as constraints aos valores que o backend realmente usa.
-- Já aplicado em produção via SQL editor; versionado aqui pra reprodutibilidade.
-- Seguro (drop if exists + add). dir_tasks tinha 0 linhas, sem risco de violar.

alter table dir_tasks drop constraint if exists dir_tasks_status_check;
alter table dir_tasks add constraint dir_tasks_status_check
  check (status in ('aberta','em_andamento','concluida','cancelada','atrasada'));

alter table dir_tasks drop constraint if exists dir_tasks_prioridade_check;
alter table dir_tasks add constraint dir_tasks_prioridade_check
  check (prioridade in ('baixa','media','alta','critica'));

notify pgrst, 'reload schema';
