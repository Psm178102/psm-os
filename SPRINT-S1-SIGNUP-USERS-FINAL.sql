-- ════════════════════════════════════════════════════════════════════════════
-- PSM Sprint S1.2 FINAL — Signup dos 16 usuarios PSM (v64.4)
-- ════════════════════════════════════════════════════════════════════════════
-- Roda APOS criar todos no Supabase Dashboard > Authentication > Users.
-- Senha temporaria padrao: 'psm2026!'
-- 2 socios + 2 lideres + 9 corretores + 2 backoffice + 1 marketing = 16
--
-- ESTRUTURA DE LIDERANCA:
--   Marcus Lopes  → lider MAP/Lancamento  (Gabriel Brito + Vitor Oliveira)
--   Kaue          → lider Conquista       (Kadu, Julia, Danilo, Rafaela, Bruno)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── SÓCIOS (2) ────────────────────────────────────────────────────────────
insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'paulo', 'Paulo', email, 'socio', null, '6424999d9a0341000c568131'
  from auth.users where email = 'paulo@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'isa', 'Isabella', email, 'socio', null, '68c1ff7171fd1000149f2a94'
  from auth.users where email = 'isabella@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

-- ─── LÍDERES (2) ──────────────────────────────────────────────────────────
insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'marcus_l', 'Marcus Lopes', email, 'lider', 'lancamento', '67f9516f6fed0c0014bf9130'
  from auth.users where email = 'marcus@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'kaue', 'Kaue', email, 'lider', 'conquista', ''
  from auth.users where email = 'kaue@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

-- ─── CORRETORES MAP / Lançamento (2) — sob Marcus ─────────────────────────
insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'gabriel_b', 'Gabriel Brito', email, 'corretor', 'lancamento', '693972e731eb790020fedd95'
  from auth.users where email = 'gabriel@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'vitor_o', 'Vitor Oliveira', email, 'corretor', 'lancamento', ''
  from auth.users where email = 'vitor@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

-- ─── CORRETORES Conquista (5) — sob Kaue ──────────────────────────────────
insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'kadu', 'Kadu Ozório', email, 'corretor', 'conquista', '67f94eb43d0c4b001b46e207'
  from auth.users where email = 'kadu@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'julia', 'Júlia', email, 'corretor', 'conquista', '67f94fb8dbc14a0018e56426'
  from auth.users where email = 'julia@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'danilo_a', 'Danilo Andrade', email, 'corretor', 'conquista', '692d96629eb9ee0017ab0893'
  from auth.users where email = 'danilo@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'rafaela_m', 'Rafaela Metzger', email, 'corretor', 'conquista', '6953c9c51dd6d5001392a7b1'
  from auth.users where email = 'rafaela@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'bruno', 'Bruno', email, 'corretor', 'conquista', ''
  from auth.users where email = 'bruno@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

-- ─── CORRETORES Terceiros (2) ─────────────────────────────────────────────
insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'rodrigo_c', 'Rodrigo Camargo', email, 'corretor', 'terceiros', '692d933389c0150019aff0be'
  from auth.users where email = 'rodrigocamargo@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'yara', 'Yara Fetti', email, 'corretor', 'terceiros', '693ad5782b10d20016341650'
  from auth.users where email = 'yara@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

-- ─── BACKOFFICE (2) ──────────────────────────────────────────────────────
insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'leire', 'Leire', email, 'backoffice', null, ''
  from auth.users where email = 'leire@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'mariane', 'Mariane', email, 'backoffice', null, ''
  from auth.users where email = 'mariane@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

-- ─── MARKETING (1) ───────────────────────────────────────────────────────
insert into public.profiles (user_id, legacy_id, nome, email, role, frente, rd_id)
  select id, 'guilherme', 'Guilherme', email, 'marketing', null, ''
  from auth.users where email = 'guilherme@imobiliariapsm.com.br'
on conflict (legacy_id) do update set user_id = excluded.user_id;

-- ─── Resultado ────────────────────────────────────────────────────────────
select 'Profiles cadastrados:' as status, count(*) as total, role from public.profiles group by role order by role;
