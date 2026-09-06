-- ============================================================================
-- SEED — 🎯 Diretrizes do CEO (Onda 3 · v87.47)
-- Cria a key "ceo_diretrizes" no shared_kv com as 5 prioridades de 90 dias já
-- DECIDIDAS no Plano Estratégico set/2026, como diretrizes 'aprovada' (o sócio
-- já bateu o martelo nelas — não voltam pra fila de proposta).
-- IDEMPOTENTE: on conflict do nothing — se a key já existe (o ciclo já rodou),
-- NADA é sobrescrito. Rodar no projeto "PSM" (ref fdlnvpmlertjdgfkduzc). Só aditivo.
-- ============================================================================

insert into public.shared_kv (key, value, updated_at)
values (
  'ceo_diretrizes',
  jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object(
      'id', 'dir_2026-09-06_religar-motor-proprio-700k',
      'titulo', 'Religar motor próprio: ≥R$700k de VGV próprio/mês',
      'descricao', 'Prioridade 1 dos 90 dias — motor de vendas próprias da PSM Imóveis parado desde abril.',
      'dono', 'Paulo', 'prazo', '2026-10-31', 'origem', 'plano-estrategico-set-2026',
      'status', 'aprovada', 'criado_em', '2026-09-06T18:00:00Z', 'atualizado_em', '2026-09-06T18:00:00Z',
      'resultado', null, 'criado_por', 'seed'),
    jsonb_build_object(
      'id', 'dir_2026-09-06_cadencia-v13-setembro-1-8m',
      'titulo', 'Cadência v13 ligada; setembro fecha ≥R$1,8M',
      'descricao', 'Prioridade 2 dos 90 dias — rotina e gestão v13 rodando na semana.',
      'dono', 'Isabella', 'prazo', '2026-09-30', 'origem', 'plano-estrategico-set-2026',
      'status', 'aprovada', 'criado_em', '2026-09-06T18:00:00Z', 'atualizado_em', '2026-09-06T18:00:00Z',
      'resultado', null, 'criado_por', 'seed'),
    jsonb_build_object(
      'id', 'dir_2026-09-06_sol-f1-no-ar',
      'titulo', 'Sol F1 no ar',
      'descricao', 'Prioridade 3 dos 90 dias — gate da Sol em 30/set condiciona a seletiva de 25/set.',
      'dono', 'Paulo', 'prazo', '2026-09-15', 'origem', 'plano-estrategico-set-2026',
      'status', 'aprovada', 'criado_em', '2026-09-06T18:00:00Z', 'atualizado_em', '2026-09-06T18:00:00Z',
      'resultado', null, 'criado_por', 'seed'),
    jsonb_build_object(
      'id', 'dir_2026-09-06_2-3-corretores-experientes',
      'titulo', '2–3 corretores experientes assinados',
      'descricao', 'Prioridade 4 dos 90 dias — banca experiente pra religar o motor próprio.',
      'dono', 'Paulo', 'prazo', '2026-09-30', 'origem', 'plano-estrategico-set-2026',
      'status', 'aprovada', 'criado_em', '2026-09-06T18:00:00Z', 'atualizado_em', '2026-09-06T18:00:00Z',
      'resultado', null, 'criado_por', 'seed'),
    jsonb_build_object(
      'id', 'dir_2026-09-06_backlog-decisoes-retroativo-rd',
      'titulo', 'Backlog de decisões zerado + retroativo do RD rodado',
      'descricao', 'Prioridade 5 dos 90 dias — retroativo de deal_stage_histories roda ANTES de cancelar o RD.',
      'dono', 'Paulo', 'prazo', '2026-09-12', 'origem', 'plano-estrategico-set-2026',
      'status', 'aprovada', 'criado_em', '2026-09-06T18:00:00Z', 'atualizado_em', '2026-09-06T18:00:00Z',
      'resultado', null, 'criado_por', 'seed')
  )),
  now()
)
on conflict (key) do nothing;
