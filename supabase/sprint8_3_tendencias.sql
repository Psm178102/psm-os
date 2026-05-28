-- Sprint 8.3 — Tendências de Mercado

CREATE TABLE IF NOT EXISTS tendencias (
  id          TEXT PRIMARY KEY,
  titulo      TEXT NOT NULL,
  categoria   TEXT DEFAULT 'Geral',         -- Mercado|Digital|Preços|Comportamento|Tecnologia|Geral
  direcao     TEXT DEFAULT 'estavel',       -- alta|estavel|baixa
  impacto     TEXT DEFAULT 'medio',         -- alto|medio|baixo
  descricao   TEXT,
  data        DATE DEFAULT CURRENT_DATE,
  criado_em   TIMESTAMPTZ DEFAULT now(),
  criado_por  TEXT REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tendencias_data ON tendencias(data DESC);
CREATE INDEX IF NOT EXISTS idx_tendencias_categoria ON tendencias(categoria);
