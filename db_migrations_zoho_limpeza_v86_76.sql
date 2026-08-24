-- v86.76 — Zoho: LIMPEZA das 720 mil duplicatas + trava definitiva.
-- EXECUTADO em produção no SQL Editor em 24/ago/2026 (pedido do Paulo).
-- Fecha a pendência que a v86.57 deixou aberta ("PENDENTE: precisa de decisão").
--
-- ANTES → DEPOIS
--   linhas em `eventos` .......... 721.637 → 1.194
--   eventos Zoho reais ........... 1.192 (inalterado)
--   linhas só do House ........... 2 (inalterado)
--   tabela `eventos` ............. 342 MB → 1,2 MB
--   banco inteiro ................ ~372 MB → 97 MB   (limite do plano Free: 500 MB)
--
-- POR QUE ISSO ERA URGENTE
-- O painel do Supabase avisava: "Projects will be restricted from 30 Aug, 2026 if
-- your organization remains over quota". Com 342 MB de lixo numa tabela de 1.192
-- eventos reais, o projeto caminhava pra restrição.
--
-- A DÚVIDA QUE QUASE FEZ APAGAR ERRADO (checagem que vale registrar)
-- A regra da v86.57 era "manter a linha MAIS ANTIGA de cada (owner_id, zoho_uid)".
-- Antes de apagar, medimos uma amostra de 300 grupos e o resultado ASSUSTOU:
--   274 de 300 grupos tinham cópias com CONTEÚDO e ORIGEM divergentes.
-- Parecia que as cópias eram versões editadas e que manter a mais antiga
-- reverteria edições reais dos usuários. Investigando um caso concreto:
--   origem=house · tipo=tarefa  ·   1 cópia  · criada 06/ago 20:02  ← ORIGINAL do usuário
--   origem=zoho  · tipo=evento  · 720 cópias · criadas 16/ago 00:01→23:58  ← eco do sync
-- Ou seja: a "divergência" era só a representação house (tarefa) vs zoho (evento)
-- do MESMO evento — e a linha mais antiga é justamente a original do usuário.
-- A checagem decisiva confirmou a segurança da regra:
--   mantidos_house = 281 | mantidos_zoho = 18 | HOUSE_QUE_SERIAM_APAGADOS = 0
-- Nenhuma linha criada no House seria perdida. Só então a deleção foi executada.
--
-- COMO FOI FEITO (em lotes, porque a tabela inchada estourava o statement_timeout)
--   1. tabela auxiliar `eventos_keep` com o id da linha a preservar por
--      (owner_id, zoho_uid), montada com a função zoho_index() da v86.57 (skip
--      scan, milissegundos) → 1.192 ids;
--   2. DELETE em lotes de 100k/150k por ctid, com DUAS travas:
--        • NOT EXISTS na eventos_keep (não apaga o que deve ficar);
--        • origem IS DISTINCT FROM 'house' (cinto e suspensório: linha do House
--          nunca é apagada, mesmo que algo escapasse da lista);
--   3. índice ÚNICO (a trava definitiva — o CREATE só passa se não houver
--      duplicata, então ele próprio é a prova de que a limpeza ficou correta);
--   4. VACUUM FULL ANALYZE pra devolver o disco (DELETE sozinho não devolve).
--
-- VERIFICADO DEPOIS: com o índice no ar, o sync do Zoho rodou às 17:10 (↓10 ↑0)
-- e a contagem seguiu em 1.194 — não duplicou mais. Agenda do app normal.

-- (1) lista do que fica — 1 linha por evento real, a mais antiga
DROP TABLE IF EXISTS eventos_keep;
CREATE TABLE eventos_keep AS
SELECT z.id
FROM (SELECT DISTINCT owner_id FROM eventos WHERE zoho_uid IS NOT NULL) o
CROSS JOIN LATERAL zoho_index(o.owner_id) z;
ALTER TABLE eventos_keep ADD PRIMARY KEY (id);

-- (2) deleção em lotes — repetir até `restantes` estabilizar
WITH alvo AS (
  SELECT e.ctid FROM eventos e
  WHERE e.zoho_uid IS NOT NULL
    AND e.origem IS DISTINCT FROM 'house'
    AND NOT EXISTS (SELECT 1 FROM eventos_keep k WHERE k.id = e.id)
  LIMIT 150000
)
DELETE FROM eventos e USING alvo WHERE e.ctid = alvo.ctid;
SELECT count(*) AS restantes FROM eventos;

-- (3) trava definitiva: o sync não consegue mais inserir a mesma linha 2x
CREATE UNIQUE INDEX IF NOT EXISTS uq_eventos_owner_zoho_uid
  ON eventos (owner_id, zoho_uid) WHERE zoho_uid IS NOT NULL;
DROP TABLE IF EXISTS eventos_keep;

-- (4) devolve o disco (DELETE só marca as linhas como mortas)
VACUUM FULL ANALYZE eventos;
