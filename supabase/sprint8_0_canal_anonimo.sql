-- Sprint 8.0 — Canal Anônimo
-- Tabela pra mensagens enviadas pelo Canal direto à diretoria

CREATE TABLE IF NOT EXISTS canal_anonimo (
  id            SERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ DEFAULT now(),
  de            TEXT NOT NULL DEFAULT 'Anônimo',  -- nome ou "Anônimo"
  msg           TEXT NOT NULL,
  anexo         TEXT,                              -- nome do arquivo
  anexo_data    TEXT,                              -- base64 (max ~2MB)
  anexo_type    TEXT,                              -- mime type
  anexo_size    INT,
  lido          BOOLEAN DEFAULT FALSE,
  lido_por      UUID REFERENCES users(id),
  lido_em       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_canal_ts ON canal_anonimo(ts DESC);
CREATE INDEX IF NOT EXISTS idx_canal_lido ON canal_anonimo(lido) WHERE lido = FALSE;

-- RLS: ninguém lê via API direto (só via endpoints com lvl check)
ALTER TABLE canal_anonimo ENABLE ROW LEVEL SECURITY;

-- Política: service_role bypassa, anon não acessa nada
-- (endpoints usam service_role no backend, RLS bloqueia leitura direta)
