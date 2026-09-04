-- ============================================================================
-- SEED — 🏛️ Diretoria (sala do CEO IA) · v87.31
-- Cria a key "diretoria_dossies" no shared_kv com 1 dossiê de boas-vindas.
-- IDEMPOTENTE: on conflict do nothing — se a key já existe (o Agente CEO já
-- publicou algo), NADA é sobrescrito. Rodar no SQL Editor do projeto "PSM"
-- (ref fdlnvpmlertjdgfkduzc). Só aditivo.
-- ============================================================================

insert into public.shared_kv (key, value, updated_at)
values (
  'diretoria_dossies',
  jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object(
      'id',        'boas-vindas-2026-09-04',
      'tipo',      'insight',
      'titulo',    'A Diretoria está no ar',
      'manchete',  'A sala fechada dos sócios: dossiês do Agente CEO, toda segunda às 7h.',
      'corpo_md',  E'## Bem-vindo à Diretoria\n\nEsta é a sala do CEO IA — só sócios entram aqui.\n\n**Como funciona a rotina:**\n\n- Toda **segunda-feira às 7h**, o Agente CEO publica o **Estado da União**: a leitura executiva da semana (números, riscos, prioridades).\n- **Pareceres** sobre decisões específicas e **insights** avulsos chegam conforme o CEO os produz.\n- O **Plano Estratégico** da holding será publicado e mantido aqui.\n\nNada aqui gera notificação pra equipe — a Diretoria nunca faz broadcast.',
      'autor',     'CEO',
      'criado_em', '2026-09-04T12:00:00Z',
      'fontes',    jsonb_build_array()
    )
  )),
  now()
)
on conflict (key) do nothing;
