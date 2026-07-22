-- v84.83 — 💰 Radar de Recebíveis + Esteira Pós-Venda (Estratégia)
-- Crise de liquidez 21/07: R$30k de R$47k travados em burocracia invisível.
-- O radar dá visibilidade do que trava cada comissão. Aditiva e idempotente.

create table if not exists recebiveis (
  id text primary key,
  deal_ref text,
  descricao text not null,
  frente text not null default 'conquista',
  valor_bruto numeric,
  valor_liquido_estimado numeric,          -- EDITÁVEL (Paulo preenche; sem 4% forçado)
  premiacao jsonb,                          -- {tipo: produto|percentual|valor, valor, detalhe} — editável
  data_prevista date,
  status text not null default 'previsto',  -- previsto|travado|confirmado|recebido|perdido
  bloqueio text default 'nenhum',           -- nenhum|nota_fiscal|assinatura_financiamento|liberacao_incorporadora|outro
  bloqueio_obs text,
  marco_atual text default 'ganho',         -- ganho→dossie_correspondente→credito_aprovado→contrato_assinado→nota_solicitada→comissao_liberada→recebido
  dono_cobranca text,
  corretor_id text,
  pagador text,
  notas text,
  nibo_id text,                             -- GANCHO Nibo: conciliação automática entra aqui quando o plano subir
  historico jsonb default '[]'::jsonb,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);
alter table recebiveis enable row level security;
create index if not exists recebiveis_data_idx  on recebiveis (data_prevista);
create index if not exists recebiveis_status_idx on recebiveis (status);
create index if not exists recebiveis_deal_idx  on recebiveis (deal_ref);

-- SEED julho (agregados EDITÁVEIS — detalhar na tela; split 15k/15k é placeholder)
insert into recebiveis (id, descricao, frente, valor_liquido_estimado, data_prevista, status, bloqueio, marco_atual, dono_cobranca, pagador, notas)
values
 ('rc_seed_conf_2407',  'Comissões confirmadas 24/07 (agregado — detalhar por deal)', 'conquista', 17000, '2026-07-24', 'confirmado', 'nenhum', 'comissao_liberada', 'mariane', 'a detalhar', 'Seed 21/07 — detalhar itens reais na tela'),
 ('rc_seed_trava_nf',   'Travado: incorporadora não solicitou a NOTA FISCAL (agregado)', 'conquista', 15000, '2026-07-24', 'travado', 'nota_fiscal', 'contrato_assinado', 'mariane', 'a detalhar', 'Seed 21/07 — split 30k placeholder, ajustar valor real'),
 ('rc_seed_trava_ass',  'Travado: cliente sem ASSINAR contrato de financiamento (agregado)', 'conquista', 15000, '2026-07-24', 'travado', 'assinatura_financiamento', 'credito_aprovado', 'mariane', 'a detalhar', 'Seed 21/07 — split 30k placeholder, ajustar valor real')
on conflict (id) do nothing;
