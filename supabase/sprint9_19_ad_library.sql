-- Sprint 9.19 — Inteligência de Biblioteca de Anúncios dos Concorrentes
-- Snapshots periódicos da Biblioteca de Anúncios do Meta (facebook.com/ads/library)
-- por concorrente. A API oficial NÃO devolve anúncios comerciais no BR (só
-- políticos) e o Meta NÃO publica gasto de anúncio comercial — então a captura é
-- por colagem do conteúdo da Biblioteca + nº de anúncios ativos, e a "verba" é
-- SEMPRE estimativa (teste×escala por heurística). A IA analisa os padrões.

create table if not exists ad_library_snapshots (
  id           bigserial primary key,
  concorrente  text not null,                 -- nome do concorrente
  page_name    text,                          -- nome da página no Meta
  url          text,                          -- link da Biblioteca de Anúncios
  ads_count    int default 0,                 -- nº de anúncios ATIVOS no momento
  formats      jsonb default '{}'::jsonb,      -- {video, carousel, image} (contagem, opcional)
  conteudo     text,                          -- copies/anúncios colados da Biblioteca (base da análise)
  ai_analysis  text,                          -- análise estruturada gerada pela IA
  nivel_invest text,                          -- estimativa qualitativa: baixo|medio|alto (NÃO é R$ real)
  segmento     text,                          -- linha/produto principal observado
  notes        text,
  captured_at  timestamptz not null default now(),
  criado_por   text
);
create index if not exists idx_adlib_conc on ad_library_snapshots (concorrente, captured_at desc);
create index if not exists idx_adlib_recent on ad_library_snapshots (captured_at desc);
