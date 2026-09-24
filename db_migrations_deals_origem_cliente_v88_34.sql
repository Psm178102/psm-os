-- v88.34 (Paulo 23/09/2026) — origem do lead = campo personalizado "Origem do cliente" do RD
-- Achado: desde ago/26 a equipe preenche a origem no campo personalizado "Origem do cliente"
-- (97–98% dos negócios), e não no "Fonte" padrão do RD (deal_source) — set/26: 144 de 486 sem
-- deal_source, zero indicação/networking/carteira no deal_source, mas 8 indicações, 8 carteira,
-- 2 networking… no campo personalizado. O motor lia só o deal_source.
--
-- Coluna materializada por gatilho (e não calculada na leitura): extrair do jsonb na hora custa
-- ~2,2 s sobre os 12,5 mil abertos (8× a leitura atual) e traria de volta os timeouts da v88.31.
-- Coluna comum + gatilho BEFORE: não quebra os upserts do sync (quem não manda a coluna, o
-- gatilho preenche; quem manda, o gatilho recalcula a partir do rd_raw).

alter table public.deals add column if not exists origem_cliente text;

create or replace function public.deals_origem_cliente_de(raw jsonb)
returns text language sql immutable as $$
  select nullif(trim(jsonb_path_query_first(raw,
    '$.deal_custom_fields[*] ? (@.custom_field.label == "Origem do cliente" || @.custom_field._id == "6a31978c0b56a8001e70e971").value'
  ) #>> '{}'), '')
$$;

create or replace function public.deals_set_origem_cliente()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.rd_raw is distinct from old.rd_raw or new.origem_cliente is distinct from old.origem_cliente then
    new.origem_cliente := public.deals_origem_cliente_de(new.rd_raw);
  end if;
  return new;
end $$;

drop trigger if exists trg_deals_origem_cliente on public.deals;
create trigger trg_deals_origem_cliente before insert or update on public.deals
  for each row execute function public.deals_set_origem_cliente();

-- backfill (17 mil linhas; só as que têm o campo)
update public.deals set origem_cliente = public.deals_origem_cliente_de(rd_raw)
 where rd_raw ? 'deal_custom_fields' and origem_cliente is distinct from public.deals_origem_cliente_de(rd_raw);
