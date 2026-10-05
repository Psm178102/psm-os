-- v89.35 — Documentação do candidato (anexos na ficha do Recrutamento & Seleção)
-- Aditiva e idempotente.
alter table public.gp_talentos add column if not exists documentos jsonb not null default '[]'::jsonb;

-- Bucket PRIVADO: os arquivos só abrem por link assinado gerado pelo backend.
insert into storage.buckets (id, name, public)
values ('talentos-docs', 'talentos-docs', false)
on conflict (id) do update set public = false;
