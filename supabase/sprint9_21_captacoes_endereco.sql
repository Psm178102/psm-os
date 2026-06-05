-- Sprint 9.21 — Captações: endereço estruturado (vira o título do card)
-- Campos novos pra compor o título "endereço completo + quadra/lote ou bloco".
-- Idempotente. O upsert de captação é tolerante: sem estas colunas ele só não
-- persiste os campos; com elas, salva tudo.

alter table captacoes add column if not exists endereco text;
alter table captacoes add column if not exists bairro    text;
alter table captacoes add column if not exists quadra    text;
alter table captacoes add column if not exists lote      text;
alter table captacoes add column if not exists bloco     text;
alter table captacoes add column if not exists unidade   text;
