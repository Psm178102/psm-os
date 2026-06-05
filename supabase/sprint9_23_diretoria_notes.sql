-- Sprint 9.23 — Anotações da diretoria (pontos de atenção manuais + insights manuais)
-- Dois canais no mesmo lugar via coluna kind ('atencao' | 'insight').
-- Idempotente. O endpoint /api/v3/diretoria/notes degrada gracioso se não existir.

create table if not exists diretoria_notes (
  id          text primary key,
  kind        text not null,                 -- 'atencao' | 'insight'
  titulo      text not null,
  texto       text,
  prioridade  text default 'media',          -- alta | media | baixa
  status      text default 'aberto',         -- aberto | resolvido | arquivado
  tags        text,
  autor       text,
  autor_nome  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists diretoria_notes_kind_idx on diretoria_notes (kind, status, updated_at desc);
