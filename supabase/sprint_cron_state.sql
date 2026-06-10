-- v77.31 — heartbeat: rastreio de última execução dos jobs (cron de auto-cura pelo uso)
create table if not exists cron_state (key text primary key, ran_at timestamptz, note text);
