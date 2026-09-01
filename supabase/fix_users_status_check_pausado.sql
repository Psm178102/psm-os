-- ============================================================
-- FIX: constraint users_status_check não aceitava 'pausado'
--   code 23514 · "new row for relation \"users\" violates check
--   constraint \"users_status_check\""
--   Sintoma: no /usuarios, o botão de status (ativo → pausado →
--   inativo) quebrava no primeiro clique — impossível desativar
--   um usuário (caso Bruno, 28/ago/2026).
--   Valores antigos: ativo, inativo, ferias, licenca.
-- APLICADO em produção (projeto PSM fdlnvpmlertjdgfkduzc)
--   via SQL Editor em 28/ago/2026. Idempotente.
-- ============================================================
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;

ALTER TABLE public.users ADD CONSTRAINT users_status_check
  CHECK (status IS NULL OR status IN ('ativo','inativo','ferias','licenca','pausado'));

-- Conferência:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'users_status_check';
