-- v86.56 — CNDs: categoria INTERNO (candidato) + ponte com o Recrutamento
-- Aditiva e idempotente.
--
-- O módulo CND's tinha duas categorias: venda e locação. Entra a terceira,
-- INTERNO: a due diligence de quem está para ENTRAR na empresa (candidato do
-- pipeline de Recrutamento & Seleção). O dossiê interno nasce da ficha do
-- candidato (gp_talentos) — nome, CPF, contato e cargo descem de lá — e o
-- andamento das certidões sobe de volta pro campo `cnd` da ficha. Ninguém
-- digita a mesma coisa duas vezes.
--
--   talento_id  vínculo 1:1 com gp_talentos.id (só dossiê interno usa)
--   cargo       cargo/vaga do candidato — é o que decide se entra CRECI
--
-- tipo_negocio passa a aceitar 'interno' (coluna text livre, sem CHECK: nada
-- a alterar). Dossiês de venda/locação seguem intactos.

ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS talento_id text;
ALTER TABLE cnd_dossies ADD COLUMN IF NOT EXISTS cargo text;

-- 1 dossiê por candidato: dois dossiês da mesma pessoa = duas verdades sobre
-- ela. O índice único parcial é a trava (o backend também é idempotente).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cnd_talento
  ON cnd_dossies (talento_id) WHERE talento_id IS NOT NULL;

COMMENT ON COLUMN cnd_dossies.talento_id IS 'gp_talentos.id do candidato (dossiê tipo_negocio=interno). 1:1.';
COMMENT ON COLUMN cnd_dossies.cargo IS 'Cargo/vaga do candidato no dossiê interno; contendo "corretor" adiciona a consulta CRECI ao checklist.';
