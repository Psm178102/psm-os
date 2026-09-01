-- v86.94 — cascata Estratégia→Projetos: projeto (paulo_cards) ganha vínculo com OKR.
-- Aditivo e idempotente. Aplicar no SQL Editor do projeto PSM (fdlnvpmlertjdgfkduzc).
ALTER TABLE public.paulo_cards ADD COLUMN IF NOT EXISTS okr_id text;
-- Conferência: SELECT column_name FROM information_schema.columns WHERE table_name='paulo_cards' AND column_name='okr_id';
