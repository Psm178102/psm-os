-- ════════════════════════════════════════════════════════════════════════
-- Sprint 9.4/9.7 — Captações + Prospecção SDR (funil CARTEIRA MAP do RD CRM)
-- Leire trabalha a carteira: chama 1 a 1 no WhatsApp → SDR → tem imóvel
-- (CAPTAR IMÓVEL, cria captação) ou não tem (90 dias). Follow-up dos parados.
--
-- NOTA: a tabela `captacoes` (Sprint 9.5) NUNCA tinha sido criada no banco —
-- só existia como query salva no dashboard. Incluída aqui pra ser idempotente
-- e reproduzível. Executado em produção via Chrome MCP em 2026-05-28.
-- ════════════════════════════════════════════════════════════════════════

-- Captações Kanban (modelo Notion PSM) — Sprint 9.5
create table if not exists captacoes (
  id                text primary key,
  objetivo          text default 'venda',          -- venda | locacao
  tipo_imovel       text,
  condominio        text,                           -- Condomínio/Bairro
  localizacao       text,                           -- Quadra/Lote/Unidade/APT/Rua e Nº
  responsavel       text,
  status            text default 'colher_dados',
  situacao_imovel   text,
  pendencia         text,
  termo_autorizacao text,
  proprietario      text,
  contato           text,
  email             text,
  valor_venda       numeric,
  valor_locacao     text,
  codigo_kenlo      text,
  descricao         text,
  observacao        text,
  data_agendamento  date,
  data_inicial      date,
  data_final        date,
  precisa_fotos     boolean default false,
  precisa_videos    boolean default false,
  precisa_avaliacao boolean default false,
  rd_deal_id        text,                           -- link p/ deal RD (origem SDR)
  criado_por        text,
  updated_at        timestamptz default now(),
  created_at        timestamptz default now()
);
-- dedup/rastreio origem SDR (caso captacoes já existisse sem a coluna)
alter table captacoes add column if not exists rd_deal_id text;
create index if not exists idx_captacoes_rd_deal on captacoes(rd_deal_id);

-- Toques/follow-ups registrados pela equipe (fonte da verdade do nosso lado,
-- já que o WhatsApp acontece fora do RD). Usado pra calcular "precisa follow-up".
create table if not exists sdr_touchpoints (
  id          bigserial primary key,
  deal_id     text not null,
  pipeline_id text,
  deal_name   text,
  action      text not null default 'followup',  -- chamei | followup | sem_resposta | tem_imovel | nao_tem
  note        text,
  by_user     text references users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_sdr_touch_deal    on sdr_touchpoints(deal_id);
create index if not exists idx_sdr_touch_created  on sdr_touchpoints(created_at desc);
