-- v84.11 — Estoque Kenlo dentro do House (04/07/2026)
-- Tabela alimentada pelo sync diário /api/v3/kenlo/sync (Kenlo Open API v2,
-- GET /v2/listings). Aditivo e idempotente. RLS ligado sem policies (acesso
-- só pelo service role do backend, padrão do lockdown v84).

create table if not exists kenlo_imoveis (
  id text primary key,                 -- id do anúncio no Kenlo (ex.: l_001)
  property_code text,                  -- código de negócio (ex.: AP0022)
  titulo text,
  descricao text,
  endereco text,                       -- unparsedAddress
  bairro text,
  cidade text,
  uf text,
  preco_venda numeric,
  preco_locacao numeric,
  foto_capa text,
  n_fotos int default 0,
  criado_kenlo timestamptz,
  atualizado_kenlo timestamptz,        -- updatedAt do Kenlo (base da pauta de desatualizados)
  ativo boolean default true,          -- false = sumiu do ar no Kenlo (histórico preservado)
  raw jsonb,
  synced_at timestamptz default now()
);

create index if not exists kenlo_imoveis_code_idx on kenlo_imoveis (property_code);
create index if not exists kenlo_imoveis_ativo_idx on kenlo_imoveis (ativo);

alter table kenlo_imoveis enable row level security;
