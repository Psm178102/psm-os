-- v81.35 — 3 datas por demanda (Início / Entrega / Post)
-- Criativos + Conteúdos (paulo_cards) e Captações (captacoes).
-- Idempotente: pode rodar mais de uma vez sem erro.

-- 1) Colunas novas
alter table paulo_cards
  add column if not exists data_inicio  date,
  add column if not exists data_entrega date,
  add column if not exists data_post    date;

alter table captacoes
  add column if not exists data_inicio  date,
  add column if not exists data_entrega date,
  add column if not exists data_post    date;

-- 2) Migra a data legada (data_ref) pro campo certo, sem sobrescrever nada já preenchido:
--    Criativos: data_ref era o "prazo" -> vira Entrega.
--    Conteúdos: data_ref era a "data do post" -> vira Post.
update paulo_cards
   set data_entrega = nullif(left(data_ref::text, 10), '')::date
 where board = 'criativos'
   and data_entrega is null
   and data_ref is not null;

update paulo_cards
   set data_post = nullif(left(data_ref::text, 10), '')::date
 where board like 'conteudo%'
   and data_post is null
   and data_ref is not null;
