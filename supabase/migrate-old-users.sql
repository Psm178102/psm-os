-- ============================================================
-- PSM OS - Migracao de usuarios legacy (psm_senhas) para auth.users
-- ============================================================
-- ATENCAO: este SQL eh um TEMPLATE. Nao rode direto.
--
-- Estrategia:
--   1. O Paulo exporta o psm_senhas atual do localStorage (JSON).
--   2. Claude converte esse JSON num bloco de INSERTs aqui.
--   3. Paulo roda este arquivo UMA VEZ no SQL Editor.
--   4. Paulo dispara "Forgot password" no Supabase Dashboard pra
--      cada corretor, que recebe email e define senha propria.
--
-- Por que nao importar senha direta?
--   O psm_senhas guarda hash custom. Supabase usa bcrypt via
--   servico proprio. Nao vale a pena migrar hash. O caminho
--   seguro eh reset de senha via email (uma vez so).
-- ============================================================

-- ---- EXEMPLO (Claude vai gerar as linhas reais a partir do export) ----

-- Criar usuario em auth.users (via funcao service_role, precisa chave secreta)
-- NAO RODE ISSO DIRETAMENTE NO SQL EDITOR — use a Admin API no passo 2.

-- Opcao A (recomendada): via Admin API do Supabase
-- ------------------------------------------------
-- Rodar via curl (exemplo):
-- curl -X POST 'https://xxxx.supabase.co/auth/v1/admin/users' \
--   -H "apikey: <SERVICE_ROLE_KEY>" \
--   -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
--   -H "Content-Type: application/json" \
--   -d '{
--     "email": "paulo@housepsm.com.br",
--     "email_confirm": true,
--     "user_metadata": {"legacy_id": "b_paulo", "nome": "Paulo Morimatsu"}
--   }'
--
-- Depois de criar todos, rodar o SQL abaixo pra popular profiles:

-- Opcao B: popular profiles depois que auth.users estiver pronto
-- --------------------------------------------------------------
-- Este bloco eh SEGURO de rodar. Ele le auth.users pelo email e
-- liga ao legacy_id via user_metadata.

insert into public.profiles (user_id, legacy_id, nome, email, role, equipe, ativo)
select
  u.id,
  (u.raw_user_meta_data->>'legacy_id')::text,
  coalesce(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1)),
  u.email,
  coalesce(u.raw_user_meta_data->>'role', 'corretor'),
  u.raw_user_meta_data->>'equipe',
  true
from auth.users u
where u.raw_user_meta_data ? 'legacy_id'
on conflict (user_id) do update
  set legacy_id = excluded.legacy_id,
      nome      = excluded.nome,
      email     = excluded.email,
      role      = excluded.role,
      equipe    = excluded.equipe;

-- Promover Paulo a diretor (ajustar email real)
update public.profiles
   set role = 'diretor'
 where email = 'paulomorimatsu@gmail.com'
    or email = 'paulo@housepsm.com.br';

-- ============================================================
-- PASSO FINAL: disparar reset de senha pra todo mundo
-- ============================================================
-- Isso NAO eh SQL, eh feito no Dashboard:
-- Authentication > Users > (selecionar todos) > "Send password recovery"
--
-- Alternativamente, via Admin API em loop:
-- for email in lista.txt; do
--   curl -X POST 'https://xxxx.supabase.co/auth/v1/recover' \
--     -H "apikey: <ANON_KEY>" \
--     -H "Content-Type: application/json" \
--     -d "{\"email\":\"$email\"}"
-- done
