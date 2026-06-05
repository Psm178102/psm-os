-- Sprint 9.22 — PSM Academy (academia interna)
-- Biblioteca de treinamento: trilhas, playbooks, scripts, vídeos e docs.
-- Conteúdo real cadastrado pela diretoria (links Drive/YouTube ou texto inline).
-- Idempotente. O endpoint /api/v3/diretoria/academy degrada gracioso se a
-- tabela não existir; com ela, persiste tudo.

create table if not exists academy_items (
  id          text primary key,
  trilha      text not null default 'Geral',  -- trilha/categoria (Onboarding, Captação, Negociação…)
  tipo        text not null default 'link',   -- video | doc | script | playbook | link | curso
  titulo      text not null,
  descricao   text,
  url         text,                            -- Drive / YouTube / link externo
  conteudo    text,                            -- texto inline (scripts/playbooks sem link)
  cargo       text default 'todos',            -- público-alvo: todos | corretor | sdr | lider | gerente
  nivel       text,                            -- iniciante | intermediario | avancado
  duracao     text,                            -- ex.: "12 min", "1h30"
  tags        text,
  ordem       int  default 0,
  criado_por  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists academy_items_trilha_idx on academy_items (trilha, ordem);
create index if not exists academy_items_cargo_idx  on academy_items (cargo);
