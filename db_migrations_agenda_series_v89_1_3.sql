-- v89.1.3 — 🔁 Agenda: compromisso que repete toda semana (série)
-- Aditiva e idempotente.
--
-- DESENHO: o House continua com UMA LINHA POR OCORRÊNCIA (a Agenda lista por
-- data — nada muda na tela). As linhas da mesma série têm o mesmo serie_id e
-- id = serie_id || '_' || AAAAMMDD. A PRIMEIRA ocorrência é a "mestra": só ela
-- tem rrule e só ela vai pro Zoho — como UM evento recorrente no calendário do
-- dono, com os demais participantes como CONVIDADOS (attendees). Assim aparece
-- no Zoho de todos, inclusive de quem não conectou o Zoho no House.
-- As outras ocorrências nunca são enviadas individualmente.
-- O sync_cron estende a série no House (sempre ~120 dias à frente).

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS serie_id text;
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS rrule text;

COMMENT ON COLUMN eventos.serie_id IS 'Série recorrente (ids = serie_id_AAAAMMDD). NULL = evento avulso.';
COMMENT ON COLUMN eventos.rrule IS 'Só na ocorrência mestra da série: RRULE (ex. FREQ=WEEKLY;INTERVAL=1;BYDAY=TU). É ela que vira o evento recorrente no Zoho.';

CREATE INDEX IF NOT EXISTS idx_eventos_serie ON eventos (serie_id) WHERE serie_id IS NOT NULL;
