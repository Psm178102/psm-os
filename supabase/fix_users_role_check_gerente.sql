-- ───────────────────────────────────────────────────────────────────────────
-- FIX: constraint users_role_check não aceitava 'gerente' (nem 'financeiro')
-- Sintoma: ao promover Kaue de Líder → Gerente, update falha com
--   code 23514 · "new row for relation \"users\" violates check constraint
--   \"users_role_check\""
-- Causa: a constraint foi criada com um subconjunto de papéis; o app (usuarios.js
--   ROLES) oferece socio/gerente/backoffice/lider/financeiro/marketing/corretor.
-- Correção: recria a constraint cobrindo TODOS os papéis do app (+ 'diretor', usado
--   nas permissões e no One-on-One). Inclui os papéis já existentes no banco
--   (corretor, marketing, socio, lider, backoffice) — não quebra nenhuma linha.
-- Rodar no Supabase → SQL Editor (projeto "PSM", ref fdlnvpmlertjdgfkduzc).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'socio', 'diretor', 'gerente', 'backoffice',
    'lider', 'financeiro', 'marketing', 'corretor'
  ));

-- Conferência (deve listar a nova definição):
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint WHERE conname = 'users_role_check';
