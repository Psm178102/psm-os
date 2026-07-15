-- v84.53 — Zoho Calendar: coluna do hash de sincronização
-- Aditiva e idempotente. Pode rodar quantas vezes quiser.
--
-- POR QUE: o PUSH House → Zoho só sabia CRIAR (condição: zoho_uid IS NULL).
-- Editar um evento no House depois de sincronizado não refletia no Zoho.
-- zoho_hash guarda a impressão digital dos campos que o Zoho enxerga
-- (título/descrição/local/data/horas). Se o hash do evento diverge do gravado,
-- é porque mudou no House → re-envia. É o que destrava a edição bidirecional.

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS zoho_hash text;

-- acelera o PUSH, que varre por participante + janela de datas
CREATE INDEX IF NOT EXISTS idx_eventos_zoho_uid ON eventos (zoho_uid) WHERE zoho_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos (data);

COMMENT ON COLUMN eventos.zoho_hash IS
  'md5 dos campos espelhados no Zoho. Diferente do atual = editado no House, precisa re-enviar.';
