-- v84.37 — Dossiês de CNDs (Jurídico): comprador + vendedor + imóvel,
-- checklist de certidões com status/validade/anexo. Visão por hierarquia
-- (criador vê os seus; lvl>=7 vê todos — filtro no backend, service role).
create table if not exists cnd_dossies (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  status text not null default 'aberto',      -- aberto | completo | arquivado
  comprador jsonb,
  vendedor jsonb,
  imovel jsonb,
  certidoes jsonb not null default '[]'::jsonb,
  obs text,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz default now()
);
create index if not exists cndd_criador_idx on cnd_dossies (criado_por);
alter table cnd_dossies enable row level security;
