-- v81.37 — 3 sub-tipos de corretor (lvl 2) como PAPÉIS, pra ter permissões próprias.
-- Recria a CHECK constraint de users.role incluindo os novos valores (mantém todos
-- os papéis já existentes — não quebra nenhuma linha). Idempotente.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'socio', 'diretor', 'gerente', 'backoffice',
    'lider', 'financeiro', 'marketing', 'corretor',
    'corretor_conquista', 'corretor_map', 'corretor_locacao'
  ));

-- Conferência:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='users_role_check';
