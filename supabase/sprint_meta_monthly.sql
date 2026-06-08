-- Histórico MENSAL do Meta Ads (Sprint v77.8)
-- A Graph API só devolve um retrato por período; pra ter histórico (leads/CPL/
-- campanha campeã por mês de 2026), guardamos um snapshot mensal aqui.
-- O cron /api/v3/marketing/meta_monthly_cron preenche e faz backfill do ano.
create table if not exists meta_ads_monthly (
  ano                 int     not null,
  mes                 int     not null,
  spend               numeric default 0,   -- investimento do mês
  results             numeric default 0,   -- leads de formulário (results)
  messages            numeric default 0,   -- conversas iniciadas
  leads               numeric default 0,   -- campo "leads" do payload (quando vem)
  impressions         numeric default 0,
  clicks              numeric default 0,
  cpl                 numeric default 0,   -- spend / results
  cpm                 numeric default 0,
  accounts_n          int     default 0,   -- nº de contas somadas
  top_campaign        text,                -- campanha campeã do mês (mais leads)
  top_campaign_leads  numeric default 0,
  captured_at         timestamptz default now(),
  primary key (ano, mes)
);
create index if not exists idx_meta_monthly_ano on meta_ads_monthly (ano, mes);
