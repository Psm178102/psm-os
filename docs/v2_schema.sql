-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PSM-OS v2 — Schema Postgres (Supabase)                                  ║
-- ║  Sprint 1: users + teams                                                 ║
-- ║                                                                           ║
-- ║  COMO RODAR:                                                              ║
-- ║    1. Acesse https://supabase.com/dashboard → seu projeto                ║
-- ║    2. SQL Editor → New query                                              ║
-- ║    3. Cole TODO este arquivo e execute (Run)                              ║
-- ║    4. Confira em Table Editor: tabelas `users` e `teams` apareceram       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- =============================================================================
-- TABELA: teams
-- =============================================================================
-- Equipes da PSM (Conquista, MAP, Terceiros, Locação, etc).
-- Cada equipe tem 0 ou 1 gerente (manager_id aponta pra users.id).
-- Foi criada ANTES de users porque users.team referencia teams.id.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.teams (
  id           TEXT PRIMARY KEY,                -- 'conquista', 'lancamento', 'terceiros', 'locacao'
  name         TEXT NOT NULL,                   -- 'Equipe Conquista', 'Equipe MAP', etc
  icon         TEXT,                            -- emoji opcional
  color        TEXT,                            -- cor hex pra UI
  manager_id   TEXT,                            -- gerente da equipe (FK adicionada depois)
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABELA: users
-- =============================================================================
-- Fonte ÚNICA da verdade dos usuários da PSM.
-- ANTES: hardcoded em USERS array no index.html (linha ~1500). PERDÍAMOS mudanças
-- a cada deploy.
-- AGORA: aqui. Mudança via UI → UPDATE → persiste para sempre.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id           TEXT PRIMARY KEY,                -- 'paulo', 'isa', 'kbordini', 'marcus_l', etc
  name         TEXT NOT NULL,
  email        TEXT UNIQUE,
  role         TEXT NOT NULL DEFAULT 'corretor'
                 CHECK (role IN ('socio','diretor','lider','corretor','backoffice','marketing','inativo')),
  team         TEXT REFERENCES public.teams(id) ON DELETE SET NULL,
  ini          TEXT,                            -- iniciais 2 chars 'PA', 'IS'
  color        TEXT,                            -- cor hex
  rd_id        TEXT,                            -- ID no RD Station
  meta_id      TEXT,                            -- ID conta Meta Ads
  status       TEXT NOT NULL DEFAULT 'ativo'
                 CHECK (status IN ('ativo','inativo','ferias','licenca')),
  hide_from_ranking  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK reversa: teams.manager_id → users.id
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_manager_fkey;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_manager_fkey
  FOREIGN KEY (manager_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- =============================================================================
-- ÍNDICES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_role   ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_team   ON public.users(team);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

-- =============================================================================
-- TRIGGER: updated_at auto
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS teams_updated_at ON public.teams;
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Backend usa service_role key → bypassa RLS automaticamente.
-- Cliente direto (anon key) NÃO consegue ler/escrever (defesa em profundidade).
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- SEED INICIAL: teams
-- =============================================================================
INSERT INTO public.teams (id, name, icon, color) VALUES
  ('conquista',  'Equipe Conquista', '🏆', '#22c55e'),
  ('lancamento', 'Equipe MAP',       '🏢', '#8b5cf6'),
  ('terceiros',  'Equipe Terceiros', '🤝', '#f59e0b'),
  ('locacao',    'Equipe Locação',   '🔑', '#10b981')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- SEED INICIAL: sócios + Mariane (apenas o esqueleto pra primeira validação)
-- =============================================================================
-- O seed COMPLETO de usuários (incluindo todos os corretores e o Kaue como
-- gerente da Conquista) vai num arquivo separado /docs/v2_seed_users.sql
-- depois que Paulo confirmar a lista atual.
INSERT INTO public.users (id, name, email, role, ini, color) VALUES
  ('paulo', 'Paulo',    'paulo@imobiliariapsm.com.br',    'socio',      'PA', '#d4a843'),
  ('isa',   'Isabella', 'isabella@imobiliariapsm.com.br', 'socio',      'IS', '#d4a843'),
  ('mariane','Mariane', NULL,                              'backoffice', 'MA', '#3b82f6')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- VERIFICAÇÃO RÁPIDA
-- =============================================================================
-- Rode estas SELECTs depois pra confirmar:
-- SELECT * FROM public.teams ORDER BY id;
-- SELECT id, name, role, team FROM public.users ORDER BY role, name;
