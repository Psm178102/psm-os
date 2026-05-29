-- Sprint 9.12 — Cache compartilhado de Meta Ads (escala p/ vários logins)
--
-- Problema: /api/meta-ads.js tem cache em memória (var __cache) que vive POR
-- instância Lambda. No Vercel cada instância é efêmera e NÃO é compartilhada,
-- então com vários corretores logados ao mesmo tempo cada instância fria
-- re-busca na Graph API → risco de rate-limit e lentidão no 1º load de cada um.
--
-- Solução: esta tabela guarda a resposta JÁ MONTADA por date_preset. Um cron
-- (meta_cache_cron) pré-aquece os presets do dashboard a cada ~10min, e o
-- summary.py passa a ler daqui (compartilhado entre TODOS os logins/instâncias),
-- caindo pro fetch live só se o cache estiver velho/ausente.
--
-- payload = exatamente o JSON que /api/meta-ads devolve
-- (success, partial, period, accounts[], campaigns[], errors[], fetchedAt).

create table if not exists meta_ads_cache (
  cache_key    text primary key,            -- preset|since|until (chave estável)
  date_preset  text,
  since_date   text,
  until_date   text,
  payload      jsonb not null,              -- resposta completa do meta-ads
  source       text not null default 'cron',-- cron | live (quem gravou por último)
  fetched_at   timestamptz,                 -- quando o Meta foi consultado (payload.fetchedAt)
  refreshed_at timestamptz not null default now()  -- quando esta linha foi gravada
);

create index if not exists idx_meta_cache_refreshed on meta_ads_cache (refreshed_at desc);
create index if not exists idx_meta_cache_preset     on meta_ads_cache (date_preset);
