-- v87.77 · 🎓 Treinamentos com ciclo de vida (agendado → chamada → realizado)
-- Substitui o blob shared_kv 'gp_treinamentos2' (que fica intacto, como backup).
-- Aditivo e idempotente. RLS ligado sem policy (padrão do lockdown: só o backend,
-- com a service key, lê/escreve).

create table if not exists public.treinamentos (
  id            text primary key,
  titulo        text not null,
  descricao     text,
  formato       text not null default 'coletivo',      -- coletivo | individual
  tipo          text,                                   -- tecnico | comportamental | comercial | lideranca | integracao
  habilidade    text,                                   -- chave do mapa de habilidades (v2/js/habilidades.js)
  equipe        text,
  setor         text,
  modalidade    text,                                   -- presencial | online
  local         text,
  instrutor     text,
  instrutor_id  text,
  data          date,
  hora_inicio   time,
  hora_fim      time,
  carga_horaria text,
  carga_real    text,
  obrigatorio   boolean not null default false,
  status        text not null default 'agendado',      -- agendado | realizado | cancelado
  cancel_motivo text,
  trilha        text,                                   -- destino na Academy
  modulo        text,
  materiais     jsonb not null default '[]'::jsonb,
  observacao    text,                                   -- do instrutor, no fechamento
  origem        text,                                   -- treinamentos | one-on-one | migrado
  realizado_em  timestamptz,
  realizado_por text,
  criado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists treinamentos_data_idx on public.treinamentos (data);
create index if not exists treinamentos_instrutor_idx on public.treinamentos (instrutor_id);

create table if not exists public.treinamento_participantes (
  treinamento_id     text not null references public.treinamentos(id) on delete cascade,
  user_id            text not null,
  nome               text,
  confirmacao        text,                              -- confirmado | nao_vai
  confirmacao_motivo text,
  confirmado_em      timestamptz,
  presenca           text,                              -- presente | atrasado | ausente | justificado
  presenca_obs       text,
  nota               numeric,
  marcado_por        text,
  marcado_em         timestamptz,
  created_at         timestamptz not null default now(),
  primary key (treinamento_id, user_id)
);
create index if not exists treinamento_part_user_idx on public.treinamento_participantes (user_id);

alter table public.treinamentos enable row level security;
alter table public.treinamento_participantes enable row level security;
