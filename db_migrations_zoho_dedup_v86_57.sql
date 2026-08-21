-- v86.57 — Sync Zoho: fim do loop de duplicação de eventos.
-- Aditiva e idempotente. RODADA no SQL Editor em 2026-08-21.
--
-- O QUE ACONTECEU
-- A tabela `eventos` chegou a 672 mil linhas (269 MB, 72% do banco) para ~1.900
-- eventos reais — mariane sozinha tinha 534.219 linhas para 782 eventos. Isso
-- estourou a cota de egress do plano Free (7,36 GB de 5 GB no ciclo de agosto).
--
-- A CAUSA (achada pelo padrão dos inserts: todo dia de explosão criava milhares
-- de linhas de eventos com data = created_at MENOS 8 dias, sempre 8):
--   • o sync pede ao Zoho a janela [agora-7d, agora+60d] em datetime UTC;
--   • o índice de "o que já existe no House" era montado com filtro
--     data >= hoje-7 (data local, sem hora);
--   • o evento da BORDA volta do Zoho com data local = hoje-8 → nunca aparecia
--     no índice → o sync concluía "não existe" e INSERIA de novo;
--   • o cron rodava a cada 2 minutos (vercel.json dizia */2 enquanto a docstring
--     do sync_cron dizia 30 min): 720 rodadas por dia, para sempre;
--   • com a tabela inchada, o antigo .limit(3000) do índice passou a truncar e
--     realimentou o estrago.
--
-- A CORREÇÃO
--   1. cron do zoho/sync_cron: */2 → */30 (vercel.json)
--   2. o casamento passa a ser por zoho_uid SEM janela de data, via a função
--      zoho_index abaixo (DISTINCT ON no banco: 911 linhas em vez de 534.219)
--   3. o PUSH filtra origem <> 'zoho' no banco (era o grosso do egress)
--   4. deleção de órfãos restrita à janela com folga de 2 dias nas bordas
--   5. fail-safe: sem índice confiável, o sync NÃO insere nada
--
-- PENDENTE (precisa de decisão): a limpeza das ~720 mil duplicatas já gravadas.
-- Enquanto elas existirem, o banco segue em 372 MB (limite Free: 500 MB). O
-- índice único (owner_id, zoho_uid) — a trava definitiva — só pode ser criado
-- DEPOIS dessa limpeza, senão falha por violação.

CREATE INDEX IF NOT EXISTS idx_eventos_owner_data ON eventos (owner_id, data) WHERE zoho_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eventos_data_origem ON eventos (data, origem);
CREATE INDEX IF NOT EXISTS idx_eventos_owner_uid  ON eventos (owner_id, zoho_uid) WHERE zoho_uid IS NOT NULL;

-- 'origem' nunca pode ser NULL: o PUSH agora filtra por ela no banco e NULL não
-- passa em `origem <> 'zoho'` (sumiria da sincronização em silêncio).
UPDATE eventos SET origem = 'house' WHERE origem IS NULL;
ALTER TABLE eventos ALTER COLUMN origem SET DEFAULT 'house';

-- Uma linha por evento real do usuário, independente de quantas cópias existam.
-- Mantém a MAIS ANTIGA (created_at ASC) — mesma regra que a limpeza deve usar.
--
-- SKIP SCAN (v86.57b): a primeira versão usava DISTINCT ON e estourava o
-- statement_timeout (57014) nas contas grandes — com 534 mil linhas o Postgres
-- varria o índice inteiro. Aqui a CTE recursiva SALTA de zoho_uid em zoho_uid
-- (um seek por uid, ~911 saltos em vez de 534 mil leituras) e o LATERAL pega a
-- linha mais antiga de cada um. Responde em milissegundos mesmo com a tabela
-- inchada — e continua correta depois que a limpeza acontecer.
CREATE INDEX IF NOT EXISTS idx_eventos_owner_uid_created
  ON eventos (owner_id, zoho_uid, created_at) WHERE zoho_uid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.zoho_index(p_owner text)
RETURNS TABLE(id text, zoho_uid text, zoho_etag text, data date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH RECURSIVE uids AS (
    (SELECT e.zoho_uid AS u FROM eventos e
      WHERE e.owner_id = p_owner AND e.zoho_uid IS NOT NULL
      ORDER BY e.zoho_uid LIMIT 1)
    UNION ALL
    SELECT (SELECT e.zoho_uid FROM eventos e
             WHERE e.owner_id = p_owner AND e.zoho_uid > uids.u
             ORDER BY e.zoho_uid LIMIT 1)
      FROM uids WHERE uids.u IS NOT NULL
  )
  SELECT x.id, x.zoho_uid, x.zoho_etag, x.data
    FROM uids
    CROSS JOIN LATERAL (
      SELECT e.id, e.zoho_uid, e.zoho_etag, e.data FROM eventos e
       WHERE e.owner_id = p_owner AND e.zoho_uid = uids.u
       ORDER BY e.created_at ASC LIMIT 1
    ) x
   WHERE uids.u IS NOT NULL
$fn$;

REVOKE ALL ON FUNCTION public.zoho_index(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zoho_index(text) TO service_role;

-- VERIFICADO em produção 21/ago/2026, com a tabela ainda inchada:
--   zoho_index devolve 911 (mariane), 245 (leire), 24 (paulo), 5 (rafaela)
--   sync_cron: criados_house = 0 em todos — antes eram 27 por rodada na mariane
