-- v81.39 — Equipes gerenciáveis (tabela `teams` = fonte da verdade; FK users.team).
-- Mudanças de DADOS feitas via Management API (documentadas aqui).

-- 1) Cria a equipe MAP "de verdade" (antes a "Equipe MAP" estava sob id='lancamento'),
--    cria 'geral' (fallback) e desativa o 'lancamento' legado (estava sem usuários).
insert into teams(id,name,icon,color,active) values('map','Equipe MAP','🗺️','#a855f7',true)
  on conflict(id) do update set name='Equipe MAP', icon='🗺️', color='#a855f7', active=true;
insert into teams(id,name,icon,color,active) values('geral','Geral','📁','#64748b',true)
  on conflict(id) do update set active=true;
update teams set active=false where id='lancamento';

-- 2) Reatribuição dos 18 corretores puros: todos -> Corretor Conquista (role+team),
--    exceto Yara Fetti -> Corretor MAP.
update users set role='corretor_conquista', team='conquista' where role='corretor' and id <> 'yara';
update users set role='corretor_map', team='map' where id='yara';

-- Endpoint /api/v3/settings/teams passou a LER/GRAVAR a tabela `teams` (antes shared_kv).
-- O 'psm_teams' (shared_kv, usado por teams/manage.py da página Equipes) é OUTRO sistema
-- e NÃO é a fonte da verdade do FK — cuidado ao mexer.
