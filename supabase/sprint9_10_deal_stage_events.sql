-- ════════════════════════════════════════════════════════════════════════
-- Sprint 9.10 — deal_stage_events (event sourcing das transições de etapa RD)
--
-- O RD CRM v1 NÃO guarda histórico de transição de etapa (só created/updated/
-- closed/last_activity). Sem isso, SLA/1º contato/visita só dá pra calcular por
-- proxy (estimativa). Esta tabela passa a CAPTURAR cada vez que um deal entra
-- numa etapa — via webhook (instantâneo) e via sync (rede de segurança 3x/dia).
--
-- A partir daí as métricas ficam REAIS (do go-live em diante):
--   • 1º contato / SLA  = 1º evento em que o deal sai da etapa de entrada
--   • visita (show-up)  = 1º evento em que entra numa etapa de visita
--   • velocidade        = tempo entre etapas
--
-- Idempotência: occurred_at = RD updated_at do deal naquele estado. Reenvios do
-- webhook e re-syncs geram a MESMA chave (deal_id, stage_id, occurred_at) → o
-- unique abaixo dedup automaticamente, sem evento duplicado.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists deal_stage_events (
  id             bigserial primary key,
  deal_id        text not null,
  pipeline_id    text,
  pipeline_name  text,
  stage_id       text,
  stage_name     text,
  stage_position int,                       -- posição da etapa no funil (rd_stages)
  win            boolean,                    -- estado do deal no momento (true/false/null)
  amount         numeric,                    -- VGV/valor do deal no momento (snapshot)
  user_email     text,                       -- dono do deal (corretor)
  occurred_at    timestamptz not null,       -- quando o RD registrou (= deal.updated_at) → idempotência
  detected_at    timestamptz not null default now(),  -- quando NÓS capturamos
  source         text not null default 'webhook',     -- webhook | sync | backfill | sdr
  raw            jsonb,
  unique (deal_id, stage_id, occurred_at)
);

create index if not exists idx_dse_deal      on deal_stage_events(deal_id);
create index if not exists idx_dse_occurred  on deal_stage_events(occurred_at);
create index if not exists idx_dse_pipeline  on deal_stage_events(pipeline_id);
create index if not exists idx_dse_user      on deal_stage_events(user_email);

-- Marca quando a captura de eventos passou a valer (1ª linha 'real' não-backfill).
-- A API usa isto pra decidir, por janela, se mostra métrica REAL ou ≈ estimativa:
--   janela inteiramente após este marco  → real
--   janela antes/cruzando                → estimativa rotulada
-- (calculado on-the-fly via min(occurred_at) where source <> 'backfill')
