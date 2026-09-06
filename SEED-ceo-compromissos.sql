-- ============================================================================
-- SEED — 📋 Caderninho de cobrança do Agente CEO (Onda 1 · v87.43)
-- Cria a key "ceo_compromissos" no shared_kv com os 8 compromissos do
-- Plano Estratégico set/2026. IDEMPOTENTE: on conflict do nothing — se a key
-- já existe (o sócio já mexeu no caderninho), NADA é sobrescrito.
-- Rodar no projeto "PSM" (ref fdlnvpmlertjdgfkduzc). Só aditivo.
-- ============================================================================

insert into public.shared_kv (key, value, updated_at)
values (
  'ceo_compromissos',
  jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object(
      'id', 'comp_motor_proprio', 'o_que', 'Religar motor próprio: ≥R$700k de VGV próprio/mês',
      'dono', 'Paulo', 'prazo', '2026-10-31', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z'),
    jsonb_build_object(
      'id', 'comp_cadencia_v13', 'o_que', 'Cadência da rotina v13 implantada; setembro fecha ≥R$1,8M',
      'dono', 'Paulo+Isabella', 'prazo', '2026-09-30', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z'),
    jsonb_build_object(
      'id', 'comp_sol_f1', 'o_que', 'Sol F1 no ar',
      'dono', 'Paulo', 'prazo', '2026-09-15', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z'),
    jsonb_build_object(
      'id', 'comp_corretores_exp', 'o_que', '2–3 corretores experientes assinados',
      'dono', 'Isabella', 'prazo', '2026-09-30', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z'),
    jsonb_build_object(
      'id', 'comp_retroativo_rd', 'o_que', 'Retroativo do RD (deal_stage_histories) rodado',
      'dono', 'Paulo', 'prazo', '2026-09-12', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z'),
    jsonb_build_object(
      'id', 'comp_regua_seletivas', 'o_que', 'Decisão: régua das seletivas de 11 e 25/set',
      'dono', 'Paulo', 'prazo', '2026-09-10', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z'),
    jsonb_build_object(
      'id', 'comp_contradicoes_onb', 'o_que', 'Decisão: 4 contradições do onboarding',
      'dono', 'Paulo', 'prazo', '2026-09-19', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z'),
    jsonb_build_object(
      'id', 'comp_pendencias_tec', 'o_que', 'Bloco de 1h nas pendências técnicas (VAULT_KEY, META_APP_SECRET, users.login, Zoho)',
      'dono', 'Paulo', 'prazo', '2026-09-19', 'origem', 'Plano Estratégico set/2026',
      'status', 'aberto', 'criado_em', '2026-09-06T12:00:00Z', 'atualizado_em', '2026-09-06T12:00:00Z')
  )),
  now()
)
on conflict (key) do nothing;
