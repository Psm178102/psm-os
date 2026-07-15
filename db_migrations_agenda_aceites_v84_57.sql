-- v84.57 — Agenda privada: cada um vê a própria + convites que aceitou
-- Aditiva e idempotente.
--
-- DESENHO (importante): a ausência de marca = ACEITO.
-- Guardamos só o que foge do padrão: {user_id: "pendente"|"recusado"}.
-- Por que assim: os ~46 eventos que já existem (follow-ups de kanban, visitas,
-- plantões) continuam aparecendo pra quem já os via, SEM precisar de um UPDATE
-- em massa — que é exatamente onde alguém perderia um compromisso. Só convite
-- NOVO nasce "pendente". Decisão do Paulo: "já nascem aceitos".

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS aceites jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN eventos.aceites IS
  'Convites que fogem do padrão: {user_id: "pendente"|"recusado"}. SEM entrada = aceito (legado e criador/responsável nunca precisam aceitar).';

-- a Agenda varre por data + participante
CREATE INDEX IF NOT EXISTS idx_eventos_participantes ON eventos USING gin (participantes);
