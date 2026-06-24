-- v81.38 — INÍCIO configurável por papel + Corretor Terceiros (4º sub-tipo).
-- Idempotente.

-- 1) Constraint: adiciona corretor_terceiros (mantém 'corretor' p/ usuários legados).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'socio','diretor','gerente','backoffice','lider','financeiro','marketing','corretor',
    'corretor_conquista','corretor_map','corretor_locacao','corretor_terceiros'
  ));

-- 2) Migração de DADOS (feita via Management API, documentada aqui):
--    Como o grupo 'inicio' deixou de ser "sempre visível" e passou a ser granular na
--    matriz, os papéis JÁ customizados em shared_kv.role_perms precisaram receber as
--    rotas de início pra não perderem o menu. Rotas adicionadas a cada papel salvo:
--    ['/', '/painel', '/checkin', '/ranking', '/agenda', '/tarefas', '/base',
--     '/manual', '/etica', '/canal', '/premiacoes'].
--    (Conta e Academy seguem sempre visíveis, fora da matriz.)
