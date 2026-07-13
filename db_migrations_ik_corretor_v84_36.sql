-- v84.36 — corretor responsável (RD) no Kanban de Abordagem da Indicação Premiada
-- JÁ EXECUTADA em produção (13/07/2026, com backfill via join com deals.user_email).
alter table indicacao_kanban add column if not exists corretor_email text;
update indicacao_kanban k set corretor_email = lower(d.user_email)
from deals d where d.id = k.deal_id and k.corretor_email is null and d.user_email is not null;
