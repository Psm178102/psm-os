-- v77.59 — checklist de produção das aulas da Academy (e conteúdo em geral).
-- jsonb {chave:true} marcando etapas concluídas (roteiro, gravado, editado, thumb…).
alter table paulo_cards add column if not exists checklist jsonb;
