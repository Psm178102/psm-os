-- ============================================================================
-- PSM-OS v3 — Auth Schema (Sprint 7.0) — VERSÃO QUE RODOU EM PROD 2026-05-25
-- Adiciona password_hash + last_login + last_ip na tabela users existente.
-- Adiciona tabelas password_reset_tokens, user_sessions e view users_public.
-- Idempotente: pode rodar várias vezes sem efeito colateral.
-- ============================================================================

-- 1) password_hash, last_login, last_ip em users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip TEXT,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

COMMENT ON COLUMN users.password_hash    IS 'bcrypt hash (rounds=12). NULL = sem senha definida.';
COMMENT ON COLUMN users.last_login_at    IS 'Último login bem-sucedido.';
COMMENT ON COLUMN users.last_login_ip    IS 'IP do último login.';
COMMENT ON COLUMN users.password_set_at  IS 'Quando a senha foi definida.';

-- 2) Tabela de tokens de reset (futuro fluxo "Esqueci minha senha")
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_exp  ON password_reset_tokens(expires_at);
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- 3) Tabela de sessões (revogação opcional)
CREATE TABLE IF NOT EXISTS user_sessions (
  jti         TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON user_sessions(expires_at);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- 4) View pública (sem password_hash) — somente colunas que existem no schema atual
CREATE OR REPLACE VIEW users_public AS
  SELECT id, name, email, role, team, ini, color, rd_id, meta_id, status,
         hide_from_ranking, created_at, updated_at, last_login_at
  FROM users;

COMMENT ON VIEW users_public IS 'View sem password_hash — usar em frontend / endpoints não-auth.';
