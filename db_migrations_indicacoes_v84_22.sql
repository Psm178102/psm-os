-- v84.22 — Indicação Premiada (funil da indicação até o prêmio pago)
-- Aditivo e idempotente. RLS ligado sem policies (acesso via service role).

create table if not exists indicacoes (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  tipo text not null default 'venda',      -- venda | locacao
  origem text,                             -- nps_promotor | abordagem | espontanea
  indicador_nome text not null,
  indicador_contato text,
  indicado_nome text,
  indicado_contato text,
  status text not null default 'nova',     -- nova|qualificada|no_crm|vendida|premio_aprovado|premio_pago|perdida
  deal_id text,                            -- vínculo com o negócio no RD (tabela deals)
  valor_negocio numeric,                   -- VGV da venda OU aluguel mensal (locação)
  premio numeric,                          -- calculado pela faixa da fiscalizacao_cfg
  premio_pago_em timestamptz,
  obs text,
  criado_por text,
  atualizado_em timestamptz default now()
);
create index if not exists indicacoes_status_idx on indicacoes (status);
create index if not exists indicacoes_deal_idx on indicacoes (deal_id);
alter table indicacoes enable row level security;
