-- v87.81 — 📅 Agenda & Tarefas: lembrete POR ITEM (minutos antes do horário)
-- Aditiva e idempotente. Sem ela tudo funciona: o lembrete usa o padrão de cada
-- pessoa (agenda_prefs::<uid> no shared_kv — 30 min compromisso / 15 min tarefa)
-- e a tela esconde o campo "Lembrete" do formulário.
--   NULL = padrão da pessoa · -1 = sem lembrete · 0 = na hora · N = N minutos antes

ALTER TABLE eventos   ADD COLUMN IF NOT EXISTS lembrete_min integer;
ALTER TABLE dir_tasks ADD COLUMN IF NOT EXISTS lembrete_min integer;

-- o cron de lembretes (a cada 5 min) busca por data hoje..+2 — os índices de data já existem:
--   eventos: idx_eventos_data (data)
CREATE INDEX IF NOT EXISTS idx_dir_tasks_prazo ON dir_tasks (prazo);

-- validação
-- SELECT table_name, column_name, data_type FROM information_schema.columns
--  WHERE column_name = 'lembrete_min' AND table_name IN ('eventos','dir_tasks');
