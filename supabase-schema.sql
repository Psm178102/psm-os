-- ═════════════════════════════════════════════════════════════════════════════
-- PSM OS · Schema Supabase v73.0.0
-- Rodar este SQL no Supabase Dashboard > SQL Editor > New query
-- Cria 3 tabelas + RLS policies + indices + funcao de audit trigger
--
-- ATENCAO: este script eh idempotente — usa CREATE TABLE IF NOT EXISTS e
-- CREATE OR REPLACE para policies. Mas eh boa pratica rodar primeiro num
-- projeto de staging antes de aplicar em producao.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── EXTENSOES ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── TABELA: shared_kv (dados globais — todos veem) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.shared_kv (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT NOT NULL DEFAULT 'anonymous'
);

CREATE INDEX IF NOT EXISTS idx_shared_kv_updated_at ON public.shared_kv (updated_at DESC);

-- ─── TABELA: user_kv (dados individuais por usuario) ────────────────────────
CREATE TABLE IF NOT EXISTS public.user_kv (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_kv_user ON public.user_kv (user_id);
CREATE INDEX IF NOT EXISTS idx_user_kv_updated ON public.user_kv (updated_at DESC);

-- ─── TABELA: audit_log (rastreabilidade) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,                  -- 'insert' | 'update' | 'delete' | acao custom
  table_name  TEXT NOT NULL,
  key         TEXT,
  value       JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_ts     ON public.audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON public.audit_log (actor);
CREATE INDEX IF NOT EXISTS idx_audit_table  ON public.audit_log (table_name, ts DESC);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
ALTER TABLE public.shared_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_kv   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ─── POLICIES: shared_kv ────────────────────────────────────────────────────
-- Qualquer usuario autenticado pode LER e ESCREVER (regras de negocio
-- ficam na aplicacao via campo updated_by).
DROP POLICY IF EXISTS shared_kv_read ON public.shared_kv;
CREATE POLICY shared_kv_read ON public.shared_kv
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS shared_kv_write ON public.shared_kv;
CREATE POLICY shared_kv_write ON public.shared_kv
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ─── POLICIES: user_kv (cada usuario so ve/edita o proprio) ────────────────
DROP POLICY IF EXISTS user_kv_own_read ON public.user_kv;
CREATE POLICY user_kv_own_read ON public.user_kv
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_kv_own_write ON public.user_kv;
CREATE POLICY user_kv_own_write ON public.user_kv
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── POLICIES: audit_log (insert-only, leitura admin) ───────────────────────
-- Qualquer usuario autenticado pode INSERIR (apendice). Nenhum pode UPDATE/DELETE.
-- Leitura: somente service_role (admin). Configurar admin app com Service Role Key.
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT
  USING (auth.role() = 'service_role');

-- ─── TRIGGER OPCIONAL: log automatico de mudancas em shared_kv ──────────────
-- Descomente se quiser audit automatico sem precisar do client chamar audit()
/*
CREATE OR REPLACE FUNCTION public.shared_kv_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_log (actor, action, table_name, key, value)
  VALUES (
    COALESCE(NEW.updated_by, 'system'),
    TG_OP,
    'shared_kv',
    COALESCE(NEW.key, OLD.key),
    COALESCE(NEW.value, OLD.value)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS shared_kv_audit ON public.shared_kv;
CREATE TRIGGER shared_kv_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shared_kv
  FOR EACH ROW EXECUTE FUNCTION public.shared_kv_audit_trigger();
*/

-- ─── REALTIME: publicar tabelas para subscriptions client-side ──────────────
-- Realtime ja eh ativo por default em Supabase; mas para garantir:
ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_kv;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_kv;

-- ─── VERIFICACOES FINAIS ────────────────────────────────────────────────────
-- Apos rodar, verifique:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
--   SELECT policyname, tablename FROM pg_policies WHERE schemaname='public';
-- Deve mostrar shared_kv, user_kv, audit_log com rowsecurity=true e 6 policies.

-- ═════════════════════════════════════════════════════════════════════════════
-- FIM DO SCHEMA. Verifique no Dashboard > Database > Tables se foi tudo criado.
-- Em seguida configure as env vars SUPABASE_URL e SUPABASE_ANON_KEY no Vercel.
-- ═════════════════════════════════════════════════════════════════════════════
