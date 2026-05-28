-- ════════════════════════════════════════════════════════════════════════
-- Sprint 9.8 — Importação das 47 captações do Notion (🏛️ CAPTAÇÕES PSM)
-- Extraído da base "Nova base de dados" via Chrome MCP (get_page_text).
-- Idempotente: ON CONFLICT (id) DO NOTHING. Executado em produção 2026-05-28.
-- Status/Tipo/Situação mapeados pro modelo do sistema. Notas (VENDIDO etc.)
-- preservadas em observacao.
-- ════════════════════════════════════════════════════════════════════════

-- A DDL original do Sprint 9.5 não tinha created_at; adiciona pra completar.
alter table captacoes add column if not exists created_at timestamptz default now();

insert into captacoes (id, objetivo, tipo_imovel, condominio, localizacao, responsavel, status, situacao_imovel, data_agendamento, proprietario, observacao, criado_por, created_at, updated_at) values
('cap_imp_001','venda','Apartamento','TIME - GARETTI',null,'Leire','concluido',null,null,'LUIS GUSTAVO DE CAMPOS','VENDIDO · Importado do Notion','paulo',now(),now()),
('cap_imp_002','venda','Casa em condomínio','DAMHA 3',null,'Leire','agendar_prop',null,null,'FABIO ROCHA','Importado do Notion','paulo',now(),now()),
('cap_imp_003','venda','Studio','Hype','1413','Mariane','agendar_prop',null,null,'Andrea Carvalho','Importado do Notion','paulo',now(),now()),
('cap_imp_004','venda','Casa em condomínio','Gaivota 1','Quadra 13 lote 3','Mariane','a_fazer',null,null,'Emir Abrao','Importado do Notion','paulo',now(),now()),
('cap_imp_005','venda','Casa em condomínio','Village Damha 2',null,'Leire','a_fazer',null,null,'Flavia Calvo','Importado do Notion','paulo',now(),now()),
('cap_imp_006','venda','Sala Comercial','Rua Albuquerque Pessoa 390','Sala 106','Leire','a_fazer',null,null,'Angela Bogaz','Importado do Notion','paulo',now(),now()),
('cap_imp_007','locacao','Salão','Rua Floresmilha Ferraz da Silva 100',null,'Mariane','a_fazer',null,null,'Jair Moretti','Importado do Notion','paulo',now(),now()),
('cap_imp_008','venda','Apartamento','Piazza Del Fiori','Apto.23 Torre 3','Leire','agendar_prop','desocupado','2026-02-20','Kelly','Importado do Notion','paulo',now(),now()),
('cap_imp_009','venda','Casa','Alto Rio Preto','Rua Guatemala','Leire','colher_dados','desocupado','2026-02-20','Silvia','Importado do Notion','paulo',now(),now()),
('cap_imp_010','locacao','Apartamento','Alameda','apto 73','Leire','subir_kenlo','desocupado',null,'Cleber Marconi','Importado do Notion','paulo',now(),now()),
('cap_imp_011','venda','Casa em condomínio','SAN LORENZO',null,'Leire','a_fazer',null,null,'LUIS HENRIQUE GOUVEIA','VERIFICAR · Importado do Notion','paulo',now(),now()),
('cap_imp_012','venda','Casa em condomínio','Jardim Botanico',null,'Leire','concluido',null,null,'KARINA PANTANO','NAO VAI VENDER MAIS · Importado do Notion','paulo',now(),now()),
('cap_imp_013','venda','Terreno condomínio','FLAMBOYANT',null,'Leire','a_fazer',null,null,'JOAO MATIOLLI','Importado do Notion','paulo',now(),now()),
('cap_imp_014','venda','Apartamento','PLATZ BY TARRAF',null,'Leire','concluido',null,null,'YOHAN','VENDIDO · Importado do Notion','paulo',now(),now()),
('cap_imp_015','venda','Apartamento','MURANO',null,'Paulo','a_fazer',null,null,'ANGELO','Importado do Notion','paulo',now(),now()),
('cap_imp_016','venda','Studio','PLATZ',null,'Paulo','a_fazer',null,null,'MARIANGELA','Importado do Notion','paulo',now(),now()),
('cap_imp_017','venda','Casa em condomínio','JARDIM BOTANICO',null,'Leire','a_fazer',null,null,'KLEBER','Importado do Notion','paulo',now(),now()),
('cap_imp_018','venda','Apartamento','FERES REYES',null,'Leire','a_fazer',null,null,'TATIANE EVANGELISTA','Importado do Notion','paulo',now(),now()),
('cap_imp_019','venda','Casa em condomínio','LA MONTAGNE',null,'Leire','a_fazer',null,null,'GABRIEL MATHEUS BRAMBILA','Importado do Notion','paulo',now(),now()),
('cap_imp_020','venda','Casa em condomínio','JARDIM DO CEDRO',null,'Leire','a_fazer',null,null,'DANIELE GOUVEIA','Importado do Notion','paulo',now(),now()),
('cap_imp_021','venda','Casa em condomínio','HARMONIA RESIDENCE',null,'Paulo','a_fazer',null,null,'ESPESSOTO','Importado do Notion','paulo',now(),now()),
('cap_imp_022','venda','Terreno comercial','MIRASSOL','TERRENO AV DO COND SETLIFE','Leire','a_fazer',null,null,'GABRIEL MINELLI','Importado do Notion','paulo',now(),now()),
('cap_imp_023','venda','Studio','HYPE 017 - 40m2',null,'Leire','a_fazer',null,null,'ELPIDIO','Importado do Notion','paulo',now(),now()),
('cap_imp_024','venda','Apartamento','V3RSO JK',null,'Paulo','a_fazer',null,null,'DIEGO FERNANDO','Importado do Notion','paulo',now(),now()),
('cap_imp_025','venda','Apartamento','LEGACY',null,'Paulo','a_fazer',null,null,'DIEGO FERNANDO','Importado do Notion','paulo',now(),now()),
('cap_imp_026','venda','Studio','TARRAF SQUARE',null,'Paulo','a_fazer',null,null,'DIEGO FERNANDO','Importado do Notion','paulo',now(),now()),
('cap_imp_027','venda','Casa em condomínio','QUINTA DO GOLFE JARDIN',null,'Paulo','a_fazer',null,null,'ANTONIO BRANDI','Importado do Notion','paulo',now(),now()),
('cap_imp_028','locacao','Loja','CENTRO - GALERIA',null,'Paulo','a_fazer',null,null,'RUBINHO','Importado do Notion','paulo',now(),now()),
('cap_imp_029','venda','Apartamento','MYRA JK',null,'Paulo','a_fazer',null,null,'CLAUDIO ISMAEL','Importado do Notion','paulo',now(),now()),
('cap_imp_030','venda','Apartamento','MYRA JK',null,'Paulo','a_fazer',null,null,'CLAUDIO ISMAEL','Importado do Notion (2a unidade)','paulo',now(),now()),
('cap_imp_031','venda','Studio','HYPE 017',null,'Leire','a_fazer',null,null,'RENATA','Importado do Notion','paulo',now(),now()),
('cap_imp_032','venda','Terreno condomínio','QUINTA DO LAGO 2','10 TERRENOS','Paulo','a_fazer',null,null,'MARGARETH','Importado do Notion','paulo',now(),now()),
('cap_imp_033','venda','Terreno condomínio','BOTANIC','Q6 L5','Paulo','a_fazer',null,null,'MARGARETH','Importado do Notion','paulo',now(),now()),
('cap_imp_034','venda','Terreno condomínio','BOTANIC','Q7 L11','Paulo','a_fazer',null,null,'MARGARETH','Importado do Notion','paulo',now(),now()),
('cap_imp_035','venda','Studio','UNIQUE LUPEMA','157','Paulo','a_fazer',null,null,'MARGARETH','Importado do Notion','paulo',now(),now()),
('cap_imp_036','venda','Studio','UNIQUE LUPEMA','163','Paulo','a_fazer',null,null,'MARGARETH','Importado do Notion','paulo',now(),now()),
('cap_imp_037','venda','Casa Comercial','RUA PAQUETA',null,'Paulo','a_fazer',null,null,'MARGARETH','Venda e Locação · Importado do Notion','paulo',now(),now()),
('cap_imp_038','venda','Casa em condomínio','GAIVOTA 2','Q10 L9','Paulo','a_fazer',null,null,'MARGARETH','Importado do Notion','paulo',now(),now()),
('cap_imp_039','locacao','Studio','HYPE',null,'Leire','a_fazer',null,null,'GUSTAVO CARVALHO','Importado do Notion','paulo',now(),now()),
('cap_imp_040','venda','Apartamento','INTEGRATO',null,'Paulo','a_fazer',null,null,'NETO CRESCENCIO','Importado do Notion','paulo',now(),now()),
('cap_imp_041','venda','Apartamento','GREEN FIELDS',null,'Paulo','a_fazer',null,null,'CELSO MATHEUS','Importado do Notion','paulo',now(),now()),
('cap_imp_042','venda','Sala Comercial','georgina setor asia 44m2','tokyo sul sala 408','Paulo','a_fazer',null,null,'ALINE ADM','Importado do Notion','paulo',now(),now()),
('cap_imp_043','venda','Apartamento','INTEGRATTO',null,'Paulo','a_fazer',null,null,'NETO','Importado do Notion','paulo',now(),now()),
('cap_imp_044','venda','Casa em condomínio','PROVENCE',null,'Gui','edicao_videos','ocupado_proprietario',null,'THAYNA','Importado do Notion','paulo',now(),now()),
('cap_imp_045','venda','Apartamento','GUYRAS',null,'Isabella','aguardando_autorizacao','desocupado',null,'MARCELO','Importado do Notion','paulo',now(),now()),
('cap_imp_046','venda','Studio','HYPE','601','Leire','a_fazer','desocupado',null,'RAFA CORDEIRO','Venda e Locação · Importado do Notion','paulo',now(),now()),
('cap_imp_047','venda','Casa em condomínio','RESIDENCIAL PARATY - BADY',null,'Paulo','a_fazer',null,null,'JONATAS MORO','Importado do Notion','paulo',now(),now())
on conflict (id) do nothing;
