-- Sprint 8.1 — Gestão de Pessoas + Premiações

CREATE TABLE IF NOT EXISTS gp_treinamentos (
  id          TEXT PRIMARY KEY,
  titulo      TEXT NOT NULL,
  publico     TEXT,
  tipo        TEXT DEFAULT 'tecnico',      -- tecnico|comportamental|comercial|lideranca|integracao
  prazo       DATE,
  status      TEXT DEFAULT 'planejado',    -- planejado|em_andamento|concluido
  conteudo    TEXT,
  criado_em   TIMESTAMPTZ DEFAULT now(),
  criado_por  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gp_treinamentos_status ON gp_treinamentos(status);

CREATE TABLE IF NOT EXISTS gp_talentos (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  email       TEXT,
  contato     TEXT,
  instagram   TEXT,
  data        DATE,
  setor       TEXT,
  funcao      TEXT,
  cenario     TEXT,
  status      TEXT,   -- aceito|analisando|aguardando|agendar|postergado|futuro
  criado_em   TIMESTAMPTZ DEFAULT now(),
  criado_por  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gp_talentos_setor ON gp_talentos(setor);

CREATE TABLE IF NOT EXISTS premiacoes (
  id              TEXT PRIMARY KEY,
  titulo          TEXT NOT NULL,
  incorporadora   TEXT,
  produto         TEXT,
  inicio          DATE NOT NULL,
  fim             DATE NOT NULL,
  descricao       TEXT,
  premio          TEXT,
  icon            TEXT DEFAULT '🏆',
  criado_em       TIMESTAMPTZ DEFAULT now(),
  criado_por      UUID REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_premiacoes_periodo ON premiacoes(inicio, fim);
