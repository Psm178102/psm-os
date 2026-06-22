-- ───────────────────────────────────────────────────────────────────────────
-- v81.4 — Fichas/Propostas: coluna anexo_url (arquivo da ficha/proposta preenchida).
-- Rodar no Supabase → SQL Editor (projeto "PSM", ref fdlnvpmlertjdgfkduzc).
-- Sem isso, salvar ficha com anexo falha (coluna inexistente).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.fichas_propostas
  ADD COLUMN IF NOT EXISTS anexo_url text;
