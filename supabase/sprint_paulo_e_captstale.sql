-- v77.48 — (1) captações: data de entrada na etapa (alerta de parado) +
--          (2/3) boards pessoais do Paulo: negócios + conteúdo (1 tabela).

-- (1) quando o card mudou de etapa — base do "X dias parado nesta etapa"
alter table captacoes add column if not exists stage_changed_at timestamptz;

-- (2/3) cards dos boards pessoais do Paulo
create table if not exists paulo_cards (
  id          text primary key,
  board       text not null,             -- 'negocios' | 'conteudo'
  owner_id    text,                       -- dono (negocios = privado por dono; conteudo = compartilhado)
  titulo      text,
  status      text,
  plataforma  text,                       -- conteudo: instagram | tiktok | youtube
  formato     text,                       -- conteudo: reel | post | carrossel | video | short
  valor       numeric,                    -- negocios: valor/potencial
  link        text,
  data_ref    date,                       -- data do post / prazo
  obs         text,
  ordem       int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_paulo_cards_board on paulo_cards (board, owner_id);
