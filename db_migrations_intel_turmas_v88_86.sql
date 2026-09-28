-- v88.86 — 🧠 Inteligência · Fase 3: turmas e funil por canal.
-- Uma consulta agregada no banco (≈40 ms, ~300 linhas) em vez de puxar milhares de negócios pela API
-- (o banco é pequeno — ver memória "house-psm-db-fragil").
--
-- Para cada negócio criado desde p_desde: o degrau MAIS ALTO que ele alcançou no funil do RD
-- (histórico de colunas em deal_stage_events + coluna atual + venda), agrupado por mês de entrada,
-- funil, origem e dono. Degraus (Dicionário §5): 1 atendimento · 2 contato/qualificação ·
-- 3 agendamento · 4 visita realizada · 5 proposta · 6 contrato/venda.
-- Leitura pura (STABLE, SECURITY INVOKER). Só o service_role executa: a anon key é pública.

create or replace function public.intel_turmas(p_desde date)
returns table (
  mes text, pipeline text, origem text, user_email text, user_id text,
  entraram int, contato int, agendamento int, visita int, proposta int, contrato int,
  vendas int, vendas_30 int, vendas_60 int, vendas_90 int, vgv numeric, dias_venda_soma numeric
)
language sql stable security invoker set search_path = public as $$
  with lv as (
    select id, case psm_stage_key
      when 'novo_atend' then 1 when 'contato_qual' then 2 when 'precisa_ag' then 3 when 'vis_agend' then 3
      when 'vis_real' then 4 when 'proposta' then 5 when 'contrato' then 6 else 0 end as nivel
    from rd_stages
  ),
  d as (
    select id, pipeline_name, origem_cliente, user_email, user_id, created_at_rd, closed_at, win, amount, stage_id
    from deals where created_at_rd >= p_desde
  ),
  ev as (
    select e.deal_id, max(lv.nivel) as nivel
    from deal_stage_events e join d on d.id = e.deal_id join lv on lv.id = e.stage_id
    group by e.deal_id
  ),
  x as (
    select d.*, greatest(coalesce(ev.nivel, 0), coalesce(lv.nivel, 0), case when d.win then 6 else 0 end, 1) as nivel
    from d left join ev on ev.deal_id = d.id left join lv on lv.id = d.stage_id
  )
  select to_char(created_at_rd at time zone 'America/Sao_Paulo', 'YYYY-MM'),
         coalesce(pipeline_name, ''), coalesce(origem_cliente, ''), user_email, user_id,
         count(*)::int,
         (count(*) filter (where nivel >= 2))::int, (count(*) filter (where nivel >= 3))::int,
         (count(*) filter (where nivel >= 4))::int, (count(*) filter (where nivel >= 5))::int,
         (count(*) filter (where nivel >= 6))::int, (count(*) filter (where win))::int,
         (count(*) filter (where win and closed_at - created_at_rd <= interval '30 days'))::int,
         (count(*) filter (where win and closed_at - created_at_rd <= interval '60 days'))::int,
         (count(*) filter (where win and closed_at - created_at_rd <= interval '90 days'))::int,
         coalesce(sum(amount) filter (where win), 0),
         coalesce(sum(extract(epoch from closed_at - created_at_rd) / 86400) filter (where win), 0)::numeric
  from x group by 1, 2, 3, 4, 5
$$;

revoke all on function public.intel_turmas(date) from public, anon, authenticated;
grant execute on function public.intel_turmas(date) to service_role;
