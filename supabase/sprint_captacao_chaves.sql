-- v77.39 — Captações: campo "Local de chaves ou senha" (texto livre) no cartão.
alter table captacoes add column if not exists local_chaves text;
