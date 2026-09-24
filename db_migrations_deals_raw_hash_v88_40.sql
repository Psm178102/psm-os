-- v88.40 — sync do RD grava só o que mudou.
-- raw_hash = md5 do rd_raw + funil + dono resolvidos (api/v3/crm/_rdsync_lib.py). O sync lê
-- (id, raw_hash) e pula quem não mudou; o webhook zera o hash pra forçar a regravação no
-- formato da API. Coluna aditiva, nula nos existentes (1º sync após o deploy regrava tudo 1 vez).
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS raw_hash TEXT;
