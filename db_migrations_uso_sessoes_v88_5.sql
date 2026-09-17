-- ============================================================================
-- PSM-OS v88.5 — 🕵️ MAPA DE USO DO SISTEMA (quem realmente usa o House)
--
-- Pedido do Paulo (17/09/2026): a aba "Check-in / Check-out" para de ser o botão
-- de presença que todo corretor aperta e vira um painel SÓ DE SÓCIO que mostra,
-- por login: quando entrou, quanto tempo ficou e quando fechou o login.
--
-- Como o tempo é medido: o app já bate em /api/v3/pulse a cada 6s enquanto a aba
-- está VISÍVEL. O pulso passa a gravar um "sinal de vida" na sessão (no máximo 1
-- gravação por 45s). Assim nenhuma requisição nova aparece no navegador de quem
-- está sendo medido e o tempo é de uso REAL (aba fechada não conta).
--
-- Aditivo e idempotente. NADA é apagado — a tabela `check_ins` da presença física
-- e todo o histórico dela continuam intactos.
-- ============================================================================

-- 1) Presença real na sessão (user_sessions existe desde o Sprint 7.0)
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS last_seen   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beats       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ativo_seg   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ended_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_reason  TEXT;

COMMENT ON COLUMN user_sessions.last_seen  IS 'Último sinal de vida desta sessão. É o "quando fechou o login" quando a pessoa só fechou a aba (sem clicar Sair).';
COMMENT ON COLUMN user_sessions.beats      IS 'Quantos sinais de vida esta sessão emitiu (1 por ~1min de tela aberta).';
COMMENT ON COLUMN user_sessions.ativo_seg  IS 'Segundos de uso REAL: soma dos intervalos entre sinais. Intervalo > 3min = aba fechada/oculta e NÃO é contado.';
COMMENT ON COLUMN user_sessions.ended_at   IS 'Quando a sessão foi encerrada de propósito (botão Sair).';
COMMENT ON COLUMN user_sessions.end_reason IS 'logout = clicou Sair. NULL = fechou a aba ou o token expirou.';

-- 2) Backfill: sessão antiga sem sinal nenhum usa o próprio login como último sinal
UPDATE user_sessions SET last_seen = created_at WHERE last_seen IS NULL;

-- 3) Índices do painel (janela por data + histórico por pessoa)
CREATE INDEX IF NOT EXISTS idx_sessions_created  ON user_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_crt ON user_sessions(user_id, created_at DESC);

-- 4) Sinal de vida ATÔMICO (uma chamada só, sem ler-depois-escrever no Python).
--    Chamado por api/v3/pulse.py. Grava no máximo 1x por 45s por sessão.
CREATE OR REPLACE FUNCTION psm_session_beat(
  p_jti  TEXT,
  p_user TEXT,
  p_iat  TIMESTAMPTZ DEFAULT NULL,
  p_exp  TIMESTAMPTZ DEFAULT NULL,
  p_ua   TEXT DEFAULT NULL,
  p_ip   TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last TIMESTAMPTZ;
  v_gap  INTEGER;
BEGIN
  IF p_jti IS NULL OR p_user IS NULL THEN
    RETURN;
  END IF;

  SELECT last_seen INTO v_last FROM user_sessions WHERE jti = p_jti;

  IF NOT FOUND THEN
    -- Sessão que nasceu antes desta versão (ou cujo insert do login falhou).
    -- created_at = iat do token = a hora do login DE VERDADE, não "agora".
    INSERT INTO user_sessions (jti, user_id, created_at, expires_at,
                               user_agent, ip, last_seen, beats, ativo_seg)
    VALUES (p_jti, p_user, COALESCE(p_iat, NOW()),
            COALESCE(p_exp, NOW() + INTERVAL '12 hours'),
            LEFT(COALESCE(p_ua, ''), 255), LEFT(COALESCE(p_ip, ''), 64),
            NOW(), 1, 0)
    ON CONFLICT (jti) DO NOTHING;
    RETURN;
  END IF;

  -- Trava de escrita: no máximo 1 gravação por 45s por sessão (o pulso bate a cada 6s)
  IF v_last IS NOT NULL AND NOW() - v_last < INTERVAL '45 seconds' THEN
    RETURN;
  END IF;

  v_gap := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(v_last, NOW())))::INTEGER);

  UPDATE user_sessions SET
    last_seen = NOW(),
    beats     = COALESCE(beats, 0) + 1,
    -- intervalo <= 3min = continuou na tela; acima disso a aba estava fechada
    ativo_seg = COALESCE(ativo_seg, 0) + CASE WHEN v_gap <= 180 THEN v_gap ELSE 0 END
  WHERE jti = p_jti;
END $$;

-- Só o backend (service_role, que ignora RLS) chama isto. A anon key não.
REVOKE ALL ON FUNCTION psm_session_beat(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC;

-- ============================================================================
-- VALIDAÇÃO (rodar depois)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'user_sessions' ORDER BY 1;
--   SELECT proname FROM pg_proc WHERE proname = 'psm_session_beat';
--   SELECT user_id, created_at, last_seen, ativo_seg, beats, end_reason
--     FROM user_sessions ORDER BY created_at DESC LIMIT 20;
-- ============================================================================
