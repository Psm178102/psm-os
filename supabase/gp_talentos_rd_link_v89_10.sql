-- v89.10 — vínculo do kanban de R&S com o funil de Parceria do RD (aplicada 30/09/2026 via MCP)
alter table public.gp_talentos add column if not exists rd_deal_id text;
alter table public.gp_talentos add column if not exists rd_etapa text;
alter table public.gp_talentos add column if not exists rd_status text;
alter table public.gp_talentos add column if not exists rd_sync_at timestamptz;
create unique index if not exists gp_talentos_rd_deal_id_uq on public.gp_talentos(rd_deal_id) where rd_deal_id is not null;
