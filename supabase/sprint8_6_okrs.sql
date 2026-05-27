-- Sprint 8.6 — OKRs (Objectives & Key Results)

CREATE TABLE IF NOT EXISTS okrs (
  id          TEXT PRIMARY KEY,
  objetivo    TEXT NOT NULL,
  ciclo       TEXT DEFAULT 'Q1 2026',     -- ex: Q1 2026, S1 2026, ANO 2026
  status      TEXT DEFAULT 'on_track',    -- on_track|at_risk|off_track|completed
  krs         JSONB DEFAULT '[]',         -- [{label, curr, target, unit, status, pct}]
  responsavel UUID REFERENCES users(id),
  criado_em   TIMESTAMPTZ DEFAULT now(),
  criado_por  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_okrs_ciclo ON okrs(ciclo);
CREATE INDEX IF NOT EXISTS idx_okrs_status ON okrs(status);
