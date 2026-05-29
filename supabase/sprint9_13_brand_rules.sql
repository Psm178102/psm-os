-- Sprint 9.13 — Mapeamento de marcas config-driven (substitui regex no código)
--
-- Antes: a função _brand() em crm_metrics.py tinha o regex chumbado no código.
-- Pra adicionar uma marca nova (ex.: PSM Lançamentos) ou ajustar um padrão era
-- preciso editar Python + deploy. Profissional = gerenciável sem deploy.
--
-- Agora: cada regra é uma linha aqui. crm_metrics carrega as regras (cache 5min),
-- testa o pipeline_name do RD contra cada `pattern` (regex, case-insensitive),
-- por ordem de `priority` (menor primeiro); o 1º que casar define a marca. Se
-- nada casar, usa a regra marcada is_default. Se a tabela estiver vazia, o código
-- cai no regex hardcoded antigo (nunca quebra).
--
-- pattern  = regex POSIX/Python (re.I). Ex.: 'loca|aluguel|locaç'
-- brand_key = chave técnica usada internamente (conquista/imoveis/locacao/captacao)
-- label     = rótulo exibido no dashboard
-- is_default = regra usada quando nenhum pattern casa (deve haver exatamente 1)

create table if not exists brand_rules (
  id         bigserial primary key,
  pattern    text,                         -- regex; null/'' = só rótulo (ex.: default)
  brand_key  text not null,
  label      text not null,
  priority   int  not null default 100,    -- menor = avaliado primeiro
  is_default boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brand_rules_active on brand_rules (active, priority);

-- Seed com as MESMAS regras que estavam no código (paridade exata).
-- Idempotente: só insere se a tabela estiver vazia.
insert into brand_rules (pattern, brand_key, label, priority, is_default)
select * from (values
  ('conquista|mcmv|minha casa|1[ºo]\s*im[óo]vel|primeiro im', 'conquista', 'PSM Conquista (MCMV)',       10, false),
  ('loca|aluguel|locaç',                                       'locacao',   'Locação',                     20, false),
  ('carteira|prospec|capta|sdr',                               'captacao',  'Captação / Prospecção',       30, false),
  (null,                                                       'imoveis',   'PSM Imóveis (Alto Padrão)',  100, true)
) as v(pattern, brand_key, label, priority, is_default)
where not exists (select 1 from brand_rules);
