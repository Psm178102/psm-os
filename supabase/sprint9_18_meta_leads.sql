-- Sprint 9.18 — Captura de Lead Ads do Meta (webhook leadgen) + cache de criativo
-- Captura, em TEMPO REAL e independente, cada lead enviado num formulário do Meta,
-- com ad_id / campaign / form / formato do criativo (vídeo/carrossel/imagem).
-- Depois casamos com o deal do RD por telefone/email → atribuição lead→criativo.

create table if not exists meta_leads (
  leadgen_id      text primary key,            -- id do lead no Meta (idempotência)
  form_id         text,
  ad_id           text,
  adset_id        text,
  campaign_id     text,
  ad_name         text,
  campaign_name   text,
  creative_type   text,                        -- video | carousel | image | unknown
  full_name       text,
  phone           text,                        -- só dígitos (normalizado)
  email           text,
  created_time    timestamptz,                 -- quando o lead foi gerado no Meta
  matched_deal_id text,                        -- deal do RD casado (telefone/email), se houver
  matched_at      timestamptz,
  raw             jsonb,
  captured_at     timestamptz not null default now()
);
create index if not exists idx_meta_leads_phone    on meta_leads (phone);
create index if not exists idx_meta_leads_email     on meta_leads (email);
create index if not exists idx_meta_leads_ad        on meta_leads (ad_id);
create index if not exists idx_meta_leads_created   on meta_leads (created_time desc);
create index if not exists idx_meta_leads_unmatched on meta_leads (matched_deal_id) where matched_deal_id is null;

-- cache ad_id → formato do criativo (evita bater no Graph a cada lead)
create table if not exists meta_creatives (
  ad_id         text primary key,
  creative_type text,                          -- video | carousel | image | unknown
  ad_name       text,
  campaign_id   text,
  campaign_name text,
  refreshed_at  timestamptz not null default now()
);
