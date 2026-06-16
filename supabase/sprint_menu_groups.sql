-- v77.53 — override de menu por usuário (lista branca de grupos de menu).
-- NULL = usa o padrão do cargo. Array de grupos = vê só esses + os sempre-visíveis
-- (inicio / conta / academy). Ex.: ["inicio","academy"] = só Início + PSM Academy.
alter table users add column if not exists menu_groups jsonb;

-- Kauê (gestor Conquista): por enquanto só Início + PSM Academy
update users set menu_groups = '["inicio","academy"]'::jsonb
  where email = 'kauebordini@imobiliariapsm.com.br';
