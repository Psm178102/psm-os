-- Sprint 9.26 — HOTFIX: remove triggers legados de auditoria do shared_kv
-- ----------------------------------------------------------------------------
-- PROBLEMA: havia DOIS triggers de auditoria no shared_kv (shared_kv_audit →
-- log_shared_kv() e tg_audit_shared_kv → tg_log_kv_changes()) herdados do app
-- v1. Ambos inserem em audit_log(USER_ID, ...). Mas o audit_log do app v2 usa
-- actor_id (não user_id). Resultado: TODO upsert no shared_kv quebrava com
--   ERROR 42703: column "user_id" of relation "audit_log" does not exist
-- derrubando o upload da Tabela de Imóveis, links do Mapa, Cadência e settings.
--
-- FIX: remove os triggers legados. A auditoria do v2 é feita na camada de
-- aplicação (api/v3/_auth_lib.py → audit(), que grava actor_id/action/...).
-- O trigger shared_kv_touch (touch_updated_at) é inofensivo e permanece.
-- Idempotente.

drop trigger if exists shared_kv_audit    on public.shared_kv;
drop trigger if exists tg_audit_shared_kv on public.shared_kv;

-- Funções órfãs (não mais referenciadas por nenhum trigger). Seguro remover.
drop function if exists public.log_shared_kv()     cascade;
drop function if exists public.tg_log_kv_changes()  cascade;
