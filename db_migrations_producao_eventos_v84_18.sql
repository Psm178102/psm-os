-- v84.18 — Painel de Fiscalização (produção diária Leire/Mariane/Guilherme)
-- Eventos IMUTÁVEIS logados no ato (número digitado no fim do dia é ficção).
-- Aditivo e idempotente. RLS ligado sem policies (acesso só pelo service role
-- do backend, padrão do lockdown v84).

create table if not exists producao_eventos (
  id uuid primary key default gen_random_uuid(),
  colaborador text not null,          -- chave da cfg: 'leire' | 'mariane' | 'guilherme'
  tipo text not null,                 -- reativacao_tocada, abordagem_indicacao, nps_coletado, contrato_locacao, conteudo_entregue, ...
  ts timestamptz not null default now(),
  ref_type text,                      -- deal | captacao | locacao | cliente | doc | ticket
  ref_id text,
  valor numeric,                      -- nota NPS, valor da venda, 1º aluguel...
  meta jsonb,                         -- {formato, marca} do conteúdo, {georgina}, etc.
  criado_por text                     -- user id de quem logou (auditoria)
);

create index if not exists producao_eventos_colab_ts_idx on producao_eventos (colaborador, ts desc);
create index if not exists producao_eventos_tipo_ts_idx on producao_eventos (tipo, ts desc);

alter table producao_eventos enable row level security;
