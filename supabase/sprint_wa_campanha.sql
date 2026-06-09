-- v77.23 — Campanha de Ofertas WhatsApp (Evolution API)
-- Log de cada envio + captura de resposta ("sim") + opt-out. Rode no Supabase SQL editor.

create table if not exists wa_sends (
  id          bigserial primary key,
  deal_id     text,
  phone       text not null,
  nome        text,
  mensagem    text,
  oferta      text,
  campaign    text,
  status      text default 'sent',     -- sent | failed | replied
  erro        text,
  reply_text  text,
  is_sim      boolean default false,
  sent_by     text,
  sent_at     timestamptz default now(),
  replied_at  timestamptz
);
create index if not exists idx_wa_sends_phone on wa_sends (phone);
create index if not exists idx_wa_sends_sent_at on wa_sends (sent_at desc);
create index if not exists idx_wa_sends_sim on wa_sends (is_sim) where is_sim = true;

create table if not exists wa_optout (
  phone      text primary key,
  motivo     text,
  created_at timestamptz default now()
);
