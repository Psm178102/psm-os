-- v84.66 — CNDs: partes múltiplas (PF/PJ + sócios), locação, garantia e Drive
-- Aditiva e idempotente.
--
-- O módulo antigo tinha 1 comprador PF + 1 vendedor PF, hardcoded. Agora:
--   partes[]        vários compradores/vendedores/locatários/locadores/FIADOR,
--                   cada um PF ou PJ; PJ carrega os sócios representantes
--   tipo_negocio    venda | locacao (o mesmo dossiê serve os dois)
--   garantia        só locação: tipo/detalhe/status + QUEM decidiu e QUANDO
--   responsavel_id  quem emite (Leire/Mariane) — sem isso ela nem via o dossiê
--   corretor_id     o corretor do caso (entra na visibilidade)
--   drive_url       pasta do Drive com os PDFs
--
-- As colunas comprador/vendedor ficam (não removo dado histórico); o código
-- novo lê partes[]. Dossiês antigos continuam abrindo.

ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS tipo_negocio text NOT NULL DEFAULT 'venda';
ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS partes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS garantia jsonb;
ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS responsavel_id text;
ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS corretor_id text;
ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS drive_url text;
ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS envolvidos_extra jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cnd_responsavel ON cnd_dossies (responsavel_id) WHERE responsavel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cnd_tipo ON cnd_dossies (tipo_negocio);

COMMENT ON COLUMN cnd_dossies.partes IS 'Partes do negócio: [{id,papel,tipo:pf|pj,...,socios:[]}]. Fiador é parte e gera CND completa.';
COMMENT ON COLUMN cnd_dossies.garantia IS 'Só locação: {tipo,detalhe,valor,status,decidido_por,decidido_em}.';
