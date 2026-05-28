-- ════════════════════════════════════════════════════════════════════════
-- Sprint 9.9 — Web Push (notificações no navegador + celular/PWA)
-- Guarda as inscrições de push de cada usuário (uma por dispositivo/navegador).
-- ════════════════════════════════════════════════════════════════════════
create table if not exists push_subscriptions (
  id         bigserial primary key,
  user_id    text references users(id),
  endpoint   text unique not null,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_sub_user on push_subscriptions(user_id);
