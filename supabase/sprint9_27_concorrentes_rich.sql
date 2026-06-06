-- Sprint 9.27 — Concorrentes vira base ÚNICA editável (Radar + Benchmark + Intel-Dash)
-- Estende a tabela `concorrentes` com os campos ricos que o Radar (seed curado) e o
-- Benchmark já esperavam. Idempotente. + slug único pra import idempotente da base curada.

alter table concorrentes add column if not exists slug           text;
alter table concorrentes add column if not exists handle         text;
alter table concorrentes add column if not exists tipo           text;   -- imobiliaria | corretor
alter table concorrentes add column if not exists tier           text;   -- A | B | C
alter table concorrentes add column if not exists seguidores     int;
alter table concorrentes add column if not exists posts          int;
alter table concorrentes add column if not exists creci          text;
alter table concorrentes add column if not exists fb             text;   -- page id p/ Biblioteca de Anúncios Meta
alter table concorrentes add column if not exists bio            text;
alter table concorrentes add column if not exists engajamento    numeric;
alter table concorrentes add column if not exists imoveis_ativos int;

-- Índice único NÃO-parcial (ON CONFLICT (slug) do upsert exige; NULLs já são
-- distintos no Postgres, então linhas sem slug não colidem).
create unique index if not exists concorrentes_slug_ux on concorrentes (slug);
