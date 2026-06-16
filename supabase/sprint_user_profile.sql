-- v77.50 — Meu Painel completo p/ TODOS os usuários (corretor, marketing, adm,
-- financeiro...). Perfil de desenvolvimento + metas (produtividade e resultado).
create table if not exists user_profile (
  user_id               text primary key references users(id),
  data_inicio           date,        -- início na PSM
  contrato_url          text,        -- link do contrato de vínculo (Drive/URL)
  perfil_comportamental text,        -- DISC / eneagrama / observações
  meta_produtividade    text,        -- meta de PRODUTIVIDADE (atividades/processo)
  meta_resultado        text,        -- meta de RESULTADO (output)
  metas_pessoais        text,        -- objetivos pessoais
  pontos_atencao        text,        -- pontos de atenção (gestor)
  rotina                text,        -- rotina / agenda padrão
  updated_at            timestamptz default now(),
  updated_by            text
);
