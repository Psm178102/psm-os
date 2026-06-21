-- ───────────────────────────────────────────────────────────────────────────
-- v80.8 — Campos novos na Oportunidade: link Kenlo, mídia, condições, % comissão, prêmio
-- Rodar no Supabase → SQL Editor (projeto "PSM", ref fdlnvpmlertjdgfkduzc).
-- Sem isso, salvar oportunidade com os campos novos falha (coluna inexistente).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.oportunidades_psm
  ADD COLUMN IF NOT EXISTS kenlo_link   text,
  ADD COLUMN IF NOT EXISTS midia_url    text,
  ADD COLUMN IF NOT EXISTS condicoes    text,
  ADD COLUMN IF NOT EXISTS comissao_pct numeric,
  ADD COLUMN IF NOT EXISTS premio       text;
