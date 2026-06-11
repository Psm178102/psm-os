-- v77.35 — Intel Ads focada no concorrente: tempo médio de anúncio + investimento estimado.
alter table concorrentes add column if not exists anuncios_dias_medio numeric;   -- tempo médio ativo (dias), lido da Biblioteca via IA
alter table concorrentes add column if not exists investimento_estimado numeric; -- R$/mês estimado (manual; Meta não publica gasto comercial)
