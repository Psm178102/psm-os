-- v77.25 — Locação: dashboard + import. Colunas pra receita de administração + código.
alter table locacoes add column if not exists taxa_adm_pct numeric default 10;
alter table locacoes add column if not exists codigo text;
