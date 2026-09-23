-- v88.31 — Timeouts (57014) nas leituras de deals: índices que faltavam. Aditiva, já aplicada em 23/09/2026.
-- • updated_at_rd DESC: o indicador de saúde do cabeçalho (system_health.py) pergunta "último negócio
--   atualizado" a cada poucos minutos em TODA aba aberta — sem índice ordenava os 17 mil deals (218 ms,
--   pico 7,7 s; 7.458 chamadas = 27 min de CPU do banco). Com o índice: 1,3 ms.
-- • created_at_rd: janelas por data de criação (motor, oo/comercial, alertas_cron, leads_geo, crm_metrics)
--   varriam a tabela inteira pela PK filtrando. Com o índice: ~3 ms.
create index if not exists deals_updated_at_rd_idx on public.deals (updated_at_rd desc);
create index if not exists deals_created_at_rd_idx on public.deals (created_at_rd);
analyze public.deals;
