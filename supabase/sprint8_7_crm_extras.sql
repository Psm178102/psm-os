-- Sprint 8.7 — CRM Extras: Oportunidades PSM + Cadência + Fichas/Propostas

-- Quadro de oportunidades publicadas pela diretoria pra equipe pegar
CREATE TABLE IF NOT EXISTS oportunidades_psm (
  id          TEXT PRIMARY KEY,
  titulo      TEXT NOT NULL,
  descricao   TEXT,
  tipo        TEXT DEFAULT 'lead',          -- lead|imovel|parceria|investidor|outro
  origem      TEXT,                          -- ex: indicação Paulo, Instagram, evento X
  contato     TEXT,                          -- WhatsApp/email/etc
  valor_est   NUMERIC,                       -- valor estimado da oportunidade
  prazo       DATE,
  status      TEXT DEFAULT 'aberta',         -- aberta|pegou|fechada|perdida
  pegou_por   TEXT REFERENCES users(id),
  pegou_em    TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ DEFAULT now(),
  criado_por  TEXT REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_op_psm_status ON oportunidades_psm(status);

-- Cadências de follow-up pra leads CRM
CREATE TABLE IF NOT EXISTS cadencia_psm (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,                 -- ex: "Cadência Lead Quente MAP"
  publico     TEXT,                          -- a quem se aplica
  passos      JSONB DEFAULT '[]',            -- [{dia, canal, mensagem, status}]
  ativa       BOOLEAN DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT now(),
  criado_por  TEXT REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Fichas de proposta (precificação enviada ao cliente)
CREATE TABLE IF NOT EXISTS fichas_propostas (
  id              TEXT PRIMARY KEY,
  cliente         TEXT NOT NULL,
  cliente_doc     TEXT,                      -- CPF
  cliente_contato TEXT,
  imovel          TEXT,                      -- empreendimento + unidade
  valor_imovel    NUMERIC,
  valor_proposta  NUMERIC,
  forma_pagto     TEXT,                      -- entrada + mensais + financ
  observacoes     TEXT,
  status          TEXT DEFAULT 'em_analise', -- em_analise|aprovada|recusada|fechada
  corretor_id     TEXT REFERENCES users(id),
  data_envio      DATE,
  data_resposta   DATE,
  criado_em       TIMESTAMPTZ DEFAULT now(),
  criado_por      TEXT REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fichas_status ON fichas_propostas(status);
CREATE INDEX IF NOT EXISTS idx_fichas_corretor ON fichas_propostas(corretor_id);
