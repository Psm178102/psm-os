-- v88.82 — 🏙 Mercado: base ÚNICA de concorrentes.
-- A planilha "Dados de Mercado" (estrategia_boards.board='dados_mercado') foi aposentada
-- (decisão do Paulo, 28/09). Os campos de estrutura comercial dela passam a morar na
-- própria tabela concorrentes, editáveis no Radar. Aditivo e idempotente.

alter table public.concorrentes
  add column if not exists equipes     integer,
  add column if not exists corretores  integer,
  add column if not exists nichos      text,
  add column if not exists comissao    text,
  add column if not exists salario     numeric,
  add column if not exists verba_mkt   numeric,
  add column if not exists vendas_mes  integer,
  add column if not exists vendas_ano  integer;

-- Transporte dos 5 registros da planilha pra base única (só preenche o que está vazio;
-- anotações entram em observacoes, preservando o que já existir).
update public.concorrentes set equipes = coalesce(equipes, 4), corretores = coalesce(corretores, 26),
  nichos = coalesce(nichos, 'MCMV FAIXA 1 e 1,5'),
  observacoes = concat_ws(E'\n\n', nullif(observacoes, ''), '[Dados de Mercado, jun/2026]' || E'\n' ||
    (select c->>'obs' from public.estrategia_boards b, jsonb_array_elements(b.data->'concorrentes') c
      where b.board = 'dados_mercado' and c->>'id' = 'c_mq2n9ki4315'))
where id = 24 and coalesce(observacoes, '') not like '%[Dados de Mercado%';

update public.concorrentes set equipes = coalesce(equipes, 1), corretores = coalesce(corretores, 17),
  nichos = coalesce(nichos, 'MCMV'),
  observacoes = concat_ws(E'\n\n', nullif(observacoes, ''), '[Dados de Mercado, jun/2026]' || E'\n' ||
    (select c->>'obs' from public.estrategia_boards b, jsonb_array_elements(b.data->'concorrentes') c
      where b.board = 'dados_mercado' and c->>'id' = 'c_mq2ndm1w3ae'))
where id = 60 and coalesce(observacoes, '') not like '%[Dados de Mercado%';

update public.concorrentes set equipes = coalesce(equipes, 3), corretores = coalesce(corretores, 60),
  nichos = coalesce(nichos, 'MAP + MCMV'),
  observacoes = concat_ws(E'\n\n', nullif(observacoes, ''), '[Dados de Mercado, jun/2026]' || E'\n' ||
    (select c->>'obs' from public.estrategia_boards b, jsonb_array_elements(b.data->'concorrentes') c
      where b.board = 'dados_mercado' and c->>'id' = 'c_mq2w5ooj55i'))
where id = 3 and coalesce(observacoes, '') not like '%[Dados de Mercado%';

update public.concorrentes set equipes = coalesce(equipes, 1), corretores = coalesce(corretores, 8),
  nichos = coalesce(nichos, 'MAP'),
  observacoes = concat_ws(E'\n\n', nullif(observacoes, ''), '[Dados de Mercado, jun/2026]' || E'\n' ||
    (select c->>'obs' from public.estrategia_boards b, jsonb_array_elements(b.data->'concorrentes') c
      where b.board = 'dados_mercado' and c->>'id' = 'c_mq9so9pc3go'))
where id = 4 and coalesce(observacoes, '') not like '%[Dados de Mercado%';

-- G4 não é imobiliária de Rio Preto: entra como referência de modelo comercial (tier C).
insert into public.concorrentes (slug, nome, tipo, tier, observacoes, ultima_atualizacao)
select 'g4-referencia', 'G4 (referência de modelo comercial)', 'imobiliaria', 'C',
  '[Dados de Mercado, jun/2026]' || E'\n' ||
  (select c->>'obs' from public.estrategia_boards b, jsonb_array_elements(b.data->'concorrentes') c
    where b.board = 'dados_mercado' and c->>'id' = 'c_mqjqu2pb759'),
  now()
where not exists (select 1 from public.concorrentes where slug = 'g4-referencia');

-- A planilha antiga NÃO é apagada (fica como backup em estrategia_boards); só deixa de ter tela.
