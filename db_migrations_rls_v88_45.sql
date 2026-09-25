-- v88.45 — vistoria 24/09: tabelas públicas sem RLS (legíveis com a anon key,
-- que o /api/supabase-config entrega). Só o backend (service key) usa essas
-- tabelas, então ligar o RLS sem policy não quebra nada. JÁ APLICADA em 25/09.
ALTER TABLE public.rd_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gp_avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gp_feedbacks  ENABLE ROW LEVEL SECURITY;
