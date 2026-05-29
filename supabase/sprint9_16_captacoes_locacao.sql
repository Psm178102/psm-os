-- Sprint 9.16 — Captações: campos de locação + links + responsável por id + nome do imóvel
-- Seguro: ADD COLUMN IF NOT EXISTS (no-op se já existir). Tabela base: sprint9_4.

alter table captacoes add column if not exists nome_imovel      text;
alter table captacoes add column if not exists valor_condominio numeric;
alter table captacoes add column if not exists valor_iptu       numeric;
alter table captacoes add column if not exists taxa_adm_tipo    text;     -- 'pct' | 'valor'
alter table captacoes add column if not exists taxa_adm_valor   numeric;  -- % ou R$ conforme tipo
alter table captacoes add column if not exists link_fotos       text;
alter table captacoes add column if not exists link_videos      text;
alter table captacoes add column if not exists responsavel_id   text;     -- id do user (dropdown)
