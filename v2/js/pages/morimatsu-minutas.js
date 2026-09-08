/* PSM-OS v2 — 🏯 Morimatsu & Associados · 📜 MINUTAS  v87.56
   ----------------------------------------------------------------------------
   Biblioteca de minutas EDITÁVEL dentro do House (pedido do Paulo, 08/set):
   contratos e recibos adaptados das minutas da GM Leilões para a Morimatsu,
   guardados no banco (shared_kv morimatsu_minutas), preenchidos com os dados
   reais de investidor / imóvel / operação e exportados em WORD (.docx de
   verdade, gerado no navegador) ou impressos em PDF.

   ⚠️ ADAPTAÇÃO JURÍDICA: os modelos originais da GM são contratos de prestação
   de serviços ADVOCATÍCIOS (Rodrigo Gumiero, OAB/SP 224.466) — com mandato
   procuratório e honorários de sucumbência (art. 23 da Lei 8.906/94). A
   Morimatsu NÃO é sociedade de advogados: essas cláusulas foram REMOVIDAS e o
   objeto virou assessoria técnica e comercial (obrigação de meio), mantendo a
   ressalva de que atos privativos de advocacia são da sociedade parceira.
   Os originais da GM seguem valendo para o advogado parceiro, não para cá.

   Formato do corpo: texto puro com marcadores simples —
     # Título          → título centralizado
     ## Cláusula       → subtítulo
     ---               → linha em branco
     **negrito**       → negrito no meio da linha
     {{variavel}}      → preenchido com o dado real (ou deixado em branco)
============================================================================ */
import {
  S, COR, esc, uid, num, brl, dtBR, hojeISO, cfg, setCol, invPorId, imvPorId, feeExito,
  abrirModal, fecharModal, campo, select, input, mini, render, autorNome,
} from './morimatsu.js';

/* ─────────────────────── variáveis disponíveis ─────────────────────── */
export const VARS = [
  ['cliente_nome', 'Nome do investidor', 'investidor'],
  ['cliente_qualificacao', 'Qualificação (nacionalidade, estado civil…)', 'investidor'],
  ['cliente_doc', 'CPF / CNPJ', 'investidor'],
  ['cliente_rg', 'RG', 'investidor'],
  ['cliente_endereco', 'Endereço completo', 'investidor'],
  ['cliente_cidade', 'Cidade', 'investidor'],
  ['cliente_fone', 'WhatsApp', 'investidor'],
  ['cliente_email', 'E-mail', 'investidor'],
  ['imovel_titulo', 'Identificação do imóvel', 'imóvel'],
  ['imovel_matricula', 'Matrícula nº', 'imóvel'],
  ['imovel_cartorio', 'Cartório / CRI', 'imóvel'],
  ['imovel_cidade', 'Cidade do imóvel', 'imóvel'],
  ['imovel_modalidade', 'Modalidade (venda direta, leilão…)', 'imóvel'],
  ['imovel_credor', 'Instituição credora', 'imóvel'],
  ['valor', 'Valor do documento (R$)', 'operação'],
  ['valor_extenso', 'Valor por extenso', 'operação'],
  ['arremat_valor', 'Valor da arrematação', 'operação'],
  ['arremat_data', 'Data da arrematação', 'operação'],
  ['parcela_ref', 'Parcela referente (análise/certame/êxito)', 'operação'],
  ['fee_analise', 'Honorário de análise', 'honorários'],
  ['fee_certame', 'Honorário de certame', 'honorários'],
  ['fee_exito_pct', 'Percentual de êxito', 'honorários'],
  ['fee_piso', 'Piso do êxito', 'honorários'],
  ['comissao_pct', 'Comissão PSM na venda', 'honorários'],
  ['adm_pct', 'Administração de locação', 'honorários'],
  ['honorario_mensal', 'Honorário mensal (recorrente)', 'honorários'],
  ['dia_vencimento', 'Dia do vencimento mensal', 'honorários'],
  ['prazo_meses', 'Prazo em meses', 'honorários'],
  ['escritorio_nome', 'Razão social da Morimatsu', 'escritório'],
  ['escritorio_cnpj', 'CNPJ da Morimatsu', 'escritório'],
  ['escritorio_endereco', 'Endereço do escritório', 'escritório'],
  ['escritorio_socio', 'Sócio responsável', 'escritório'],
  ['escritorio_pix', 'Chave PIX', 'escritório'],
  ['data_extenso', 'Data por extenso', 'data'],
  ['cidade_foro', 'Cidade do foro', 'escritório'],
];
export const ESCRITORIO_DEFAULT = {
  nome: 'MORIMATSU & ASSOCIADOS — [razão social]',
  cnpj: '[CNPJ]',
  endereco: 'São José do Rio Preto/SP',
  socio: 'Paulo Sérgio Morimatsu',
  pix: '[CNPJ]',
  cidade_foro: 'São José do Rio Preto/SP',
};
export const escritorio = () => ({ ...ESCRITORIO_DEFAULT, ...(S.config?.escritorio || {}) });

/* ─────────────────────── minutas padrão (adaptadas da GM) ─────────────────────── */
export const MINUTAS_PADRAO = [
  {
    id: 'assessoria_aquisicao', slug: 'assessoria_aquisicao', cat: 'Contrato', ordem: 1,
    titulo: 'Contrato de Assessoria em Aquisição (por operação)',
    desc: 'Porta de entrada: análise + certame + êxito. Traz a Trava 1 (exclusividade PSM na saída) e a ressalva de advocacia.',
    corpo: `# INSTRUMENTO PARTICULAR DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ASSESSORIA TÉCNICA E COMERCIAL EM AQUISIÇÃO DE IMÓVEIS

## CLÁUSULA 1ª — DAS PARTES
**CONTRATANTE:** {{cliente_nome}}, {{cliente_qualificacao}}, CPF/CNPJ nº {{cliente_doc}}, RG nº {{cliente_rg}}, residente/estabelecido(a) em {{cliente_endereco}}, telefone {{cliente_fone}}, e-mail {{cliente_email}}, doravante “CONTRATANTE”.
**CONTRATADA:** {{escritorio_nome}}, pessoa jurídica de direito privado, CNPJ nº {{escritorio_cnpj}}, com sede em {{escritorio_endereco}}, neste ato representada por {{escritorio_socio}}, doravante “CONTRATADA” ou “MORIMATSU”.
---
## CLÁUSULA 2ª — DO OBJETO
O presente contrato tem por objeto a prestação de serviços de assessoria técnica e comercial para aquisição de imóveis nas modalidades venda online, venda direta online, leilão extrajudicial e leilão judicial, compreendendo:
I — diagnóstico do perfil patrimonial e dos critérios de aquisição do CONTRATANTE;
II — curadoria e filtragem de oportunidades conforme perfil, região e faixa de valor;
III — análise de viabilidade comercial do imóvel, com levantamento do custo total da operação;
IV — coordenação da due diligence documental e processual, executada por sociedade de advocacia parceira;
V — representação operacional e atuação estratégica no certame ou na compra direta;
VI — acompanhamento pós-arrematação até a entrega das chaves, em conjunto com a assessoria jurídica contratada pelo CONTRATANTE;
VII — orientação sobre o destino do ativo adquirido (revenda ou locação).
---
## CLÁUSULA 3ª — DA NATUREZA DOS SERVIÇOS
Os serviços têm natureza consultiva, técnica e comercial, constituindo **obrigação de meio**, sem garantia de arrematação, de desocupação, de prazo ou de resultado econômico.
Parágrafo único. Este contrato **NÃO abrange atos privativos de advocacia** (Lei 8.906/94). Pareceres jurídicos, medidas judiciais e extrajudiciais — inclusive imissão na posse, embargos, anulações e negociações de desocupação — serão prestados por sociedade de advocacia parceira indicada pela CONTRATADA, mediante contrato de honorários próprio e autônomo entre o CONTRATANTE e aquela sociedade.
---
## CLÁUSULA 4ª — DOS HONORÁRIOS
(a) **Análise por imóvel:** {{fee_analise}} por imóvel analisado, pagos antecipadamente.
(b) **Participação em certame:** {{fee_certame}} por certame, pagos antecipadamente.
(c) **Honorários de êxito:** {{fee_exito_pct}}% sobre o valor da arrematação ou da compra, observado o piso mínimo de {{fee_piso}}, devidos e exigíveis na data da arrematação/assinatura da compra.
§1º Em caso de arrematação, o valor da parcela (b) será deduzido dos honorários de êxito (c).
§2º Não havendo arrematação, as parcelas (a) e (b) permanecem com a CONTRATADA como remuneração dos serviços efetivamente executados.
§3º O atraso no pagamento implicará multa de 10%, juros de 1% ao mês e correção monetária pelo IPCA.
§4º Os honorários de êxito serão devidos ainda que o CONTRATANTE, diretamente ou por interposta pessoa, arremate ou adquira imóvel apresentado ou analisado pela CONTRATADA, no prazo de 12 (doze) meses contados da apresentação.
---
## CLÁUSULA 5ª — DAS DESPESAS DO CONTRATANTE
Correm exclusivamente por conta do CONTRATANTE: valor do lance/arrematação, comissão do leiloeiro, ITBI, emolumentos de registro e cartório, certidões, débitos incidentes sobre o imóvel (tributários, condominiais e demais passivos propter rem), custas processuais, honorários da sociedade de advocacia e despesas de deslocamento fora da comarca de {{cidade_foro}}, estas últimas previamente comunicadas.
---
## CLÁUSULA 6ª — DA EXCLUSIVIDADE DE DESTINO DO ATIVO
O CONTRATANTE outorga às empresas do grupo PSM (PSM Assessoria & Negócios Imobiliários e/ou PSM Imóveis), indicadas pela CONTRATADA, exclusividade na intermediação da revenda e/ou locação de todo imóvel adquirido com a assessoria objeto deste contrato, pelo prazo de 180 (cento e oitenta) dias contados da disponibilização do imóvel para revenda ou locação, prorrogável automaticamente por iguais períodos enquanto perdurar a oferta, nas condições de corretagem praticadas pelo mercado local ({{comissao_pct}}% na venda; na locação, taxa de intermediação e administração de {{adm_pct}}% ao mês).
Parágrafo único. A alienação ou locação do imóvel a terceiros no período de exclusividade, sem a intermediação das empresas indicadas, sujeitará o CONTRATANTE ao pagamento da corretagem integral que seria devida, a título de multa compensatória.
---
## CLÁUSULA 7ª — DAS OBRIGAÇÕES DO CONTRATANTE
I — fornecer informações e documentos completos e verídicos, inclusive quanto à disponibilidade de recursos;
II — manter recursos disponíveis para pagamento do lance nos prazos do edital (em regra, 24 a 48 horas);
III — declarar eventual condição de empregado da instituição credora ou vínculo de parentesco, quando o edital o exigir (ex.: leilões da CAIXA Econômica Federal);
IV — comunicar imediatamente fatos relevantes e mudanças de dados de contato;
V — não utilizar as análises, pareceres e curadorias para aquisição sem a participação da CONTRATADA, sob pena da Cláusula 4ª, §4º.
---
## CLÁUSULA 8ª — DA CONFIDENCIALIDADE E DA PROTEÇÃO DE DADOS
As partes manterão sigilo sobre informações negociais, financeiras e patrimoniais a que tiverem acesso, subsistindo o dever após o encerramento do contrato. O tratamento de dados pessoais observará a Lei 13.709/2018 (LGPD), limitado às finalidades deste contrato, garantidos ao titular os direitos de acesso, correção e eliminação, ressalvadas as hipóteses legais de retenção.
---
## CLÁUSULA 9ª — DA VIGÊNCIA E DA RESCISÃO
O contrato vigora por {{prazo_meses}} meses, renovando-se automaticamente por iguais períodos, podendo ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias.
Parágrafo único. A rescisão não afeta: (i) honorários devidos por serviços já executados; (ii) honorários de êxito de operações em curso ou enquadradas na Cláusula 4ª, §4º; (iii) a exclusividade da Cláusula 6ª quanto aos imóveis já adquiridos.
---
## CLÁUSULA 10ª — DAS DISPOSIÇÕES FINAIS
As comunicações formais serão feitas por e-mail e WhatsApp indicados pelas partes. As partes reconhecem a validade das assinaturas eletrônicas. Fica eleito o foro da Comarca de {{cidade_foro}}. Este instrumento constitui título executivo extrajudicial, assinado em 2 (duas) vias na presença de 2 (duas) testemunhas.
---
{{cidade_foro}}, {{data_extenso}}.
[[ASSINATURAS]]{{cliente_nome}}|CONTRATANTE||{{escritorio_nome}}|{{escritorio_socio}} — CONTRATADA
---
**TESTEMUNHAS:**
1. Nome: ______________________________________ CPF: ____________________
2. Nome: ______________________________________ CPF: ____________________`,
  },
  {
    id: 'assessoria_mensal', slug: 'assessoria_mensal', cat: 'Contrato', ordem: 2,
    titulo: 'Contrato de Assessoria Patrimonial Recorrente (honorários mensais)',
    desc: 'Trava 3 do ciclo: cliente com carteira sob mandato. Adaptado do modelo mensal da GM — sem sucumbência e sem mandato procuratório (não é advocacia).',
    corpo: `# INSTRUMENTO PARTICULAR DE CONTRATO DE ASSESSORIA PATRIMONIAL IMOBILIÁRIA RECORRENTE

## DAS PARTES
Pelo presente instrumento particular, de um lado:
**CONTRATADA:** {{escritorio_nome}}, pessoa jurídica de direito privado, CNPJ nº {{escritorio_cnpj}}, com sede em {{escritorio_endereco}}, neste ato representada por {{escritorio_socio}}, doravante denominada CONTRATADA ou MORIMATSU;
E, de outro lado:
**CONTRATANTE:** {{cliente_nome}}, {{cliente_qualificacao}}, CPF/CNPJ nº {{cliente_doc}}, RG nº {{cliente_rg}}, residente/estabelecido(a) em {{cliente_endereco}}, telefone {{cliente_fone}}, e-mail {{cliente_email}}, doravante denominado(a) CONTRATANTE;
Têm entre si justo e contratado o seguinte:
---
## CLÁUSULA PRIMEIRA — DO OBJETO
O presente contrato tem por objeto a prestação continuada de serviços de assessoria técnica e comercial em gestão patrimonial imobiliária, compreendendo:
I — curadoria contínua de oportunidades de aquisição conforme o perfil e os critérios do CONTRATANTE;
II — análise de viabilidade comercial e levantamento do custo total das operações apresentadas;
III — acompanhamento da carteira de imóveis do CONTRATANTE, com mesa periódica de decisão sobre o destino de cada ativo (revenda ou locação);
IV — coordenação, junto às empresas do grupo PSM, da colocação dos ativos em venda ou locação;
V — relatórios periódicos de desempenho da carteira e de resultado por operação;
VI — interlocução com a sociedade de advocacia parceira, com os leiloeiros e com as instituições credoras.
Parágrafo Primeiro. **Não estão incluídos** neste contrato: (a) os honorários de êxito por arrematação, regidos por instrumento próprio; (b) atos privativos de advocacia; (c) a corretagem devida às empresas do grupo PSM pela intermediação de venda ou locação; (d) obras, reformas e administração predial; (e) atuação fora do escopo de gestão patrimonial imobiliária, salvo ajuste específico.
---
## CLÁUSULA SEGUNDA — DA NATUREZA DA OBRIGAÇÃO
Os serviços constituem **obrigação de meio**, inexistindo garantia de resultado econômico, de valorização, de arrematação, de locação ou de prazo, comprometendo-se a CONTRATADA a atuar com diligência técnica e profissional.
Parágrafo único. Este contrato **NÃO abrange atos privativos de advocacia** (Lei 8.906/94). Pareceres jurídicos, due diligence assinada e medidas judiciais ou extrajudiciais serão prestados por sociedade de advocacia parceira, mediante contrato de honorários próprio e autônomo entre o CONTRATANTE e aquela sociedade. A atuação da CONTRATADA ocorrerá por seus sócios ou colaboradores.
---
## CLÁUSULA TERCEIRA — DOS HONORÁRIOS
O CONTRATANTE pagará à CONTRATADA honorários mensais no valor de {{honorario_mensal}}.
§1º Os pagamentos deverão ocorrer até o dia {{dia_vencimento}} de cada mês, por transferência eletrônica ou PIX, chave {{escritorio_pix}}.
§2º O atraso implicará multa de 10%, juros de 1% ao mês e correção monetária pelo IPCA.
§3º A inadimplência superior a 15 (quinze) dias autoriza a suspensão dos serviços, independentemente de notificação judicial.
§4º Os valores serão reajustados anualmente pela variação do IPCA/IBGE, ou por índice que venha a substituí-lo.
§5º Sobre os imóveis da carteira colocados em locação por indicação da CONTRATADA, é devida às empresas do grupo PSM a taxa de administração de {{adm_pct}}% ao mês sobre o aluguel, cobrada diretamente pela administradora, não se confundindo com os honorários desta cláusula.
---
## CLÁUSULA QUARTA — DAS DESPESAS
Custas, emolumentos, certidões, tributos, deslocamentos fora da comarca de {{cidade_foro}}, viagens e demais despesas necessárias correrão por conta do CONTRATANTE.
§1º Sempre que possível, serão previamente comunicadas.
§2º Despesas urgentes poderão ser antecipadas pela CONTRATADA, devendo ser reembolsadas em até 5 (cinco) dias.
---
## CLÁUSULA QUINTA — DO PRAZO
O contrato terá prazo inicial de {{prazo_meses}} meses, renovando-se automaticamente por iguais períodos, salvo manifestação contrária com 30 (trinta) dias de antecedência.
---
## CLÁUSULA SEXTA — DA RESCISÃO
O contrato poderá ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias.
§1º Em caso de rescisão imotivada pelo CONTRATANTE antes do término do período vigente, será devida multa correspondente a 03 (três) mensalidades.
§2º Permanecem devidos os honorários proporcionais às atividades já realizadas e os honorários de êxito de operações em curso.
§3º A rescisão não afeta a exclusividade de intermediação já constituída sobre os imóveis adquiridos com a assessoria da CONTRATADA.
---
## CLÁUSULA SÉTIMA — DAS OBRIGAÇÕES DO CONTRATANTE
I — fornecer documentos e informações completos e verídicos, inclusive quanto à disponibilidade de recursos;
II — manter dados de contato atualizados;
III — comunicar imediatamente fatos relevantes, propostas recebidas e tratativas diretas com terceiros sobre os ativos da carteira;
IV — não utilizar as análises e curadorias fornecidas para adquirir imóvel sem a participação da CONTRATADA.
O descumprimento exime a CONTRATADA de responsabilidade por eventual prejuízo.
---
## CLÁUSULA OITAVA — DA LIMITAÇÃO DE RESPONSABILIDADE
A CONTRATADA não será responsável por: I — informações não fornecidas; II — omissões do CONTRATANTE; III — alterações legislativas, tributárias ou de mercado supervenientes; IV — decisões de lance, compra ou venda tomadas pelo CONTRATANTE em desacordo com a recomendação técnica. Ressalva-se responsabilidade apenas em caso de dolo ou culpa grave.
---
## CLÁUSULA NONA — DA CONFIDENCIALIDADE
As partes obrigam-se a manter absoluto sigilo sobre informações, dados, documentos, estratégias comerciais, patrimoniais, fiscais, societárias e financeiras a que tenham acesso em razão deste contrato.
§1º O dever de confidencialidade subsiste por prazo indeterminado após o encerramento do contrato.
§2º A violação sujeita o infrator à reparação dos danos comprovados.
---
## CLÁUSULA DÉCIMA — DA PROTEÇÃO DE DADOS (LGPD)
As partes comprometem-se a cumprir integralmente a Lei 13.709/2018.
§1º O tratamento será limitado às finalidades deste contrato, observados os princípios da necessidade, adequação e segurança.
§2º Em caso de incidente de segurança relevante, a outra parte será comunicada.
§3º A CONTRATADA poderá manter os dados pelo prazo necessário ao cumprimento de obrigações legais e à defesa de seus direitos.
---
## CLÁUSULA DÉCIMA PRIMEIRA — DAS COMUNICAÇÕES E DO FORO
Comunicações formais ocorrerão por e-mail e WhatsApp indicados pelas partes, com confirmação de recebimento. As partes reconhecem a validade das assinaturas eletrônicas. Fica eleito o foro da Comarca de {{cidade_foro}}, com renúncia a qualquer outro. Este instrumento constitui título executivo extrajudicial.
---
E por estarem justas e contratadas, firmam o presente instrumento em 2 (duas) vias.
{{cidade_foro}}, {{data_extenso}}.
[[ASSINATURAS]]{{cliente_nome}}|CONTRATANTE||{{escritorio_nome}}|{{escritorio_socio}} — CONTRATADA
---
**TESTEMUNHAS:**
1. Nome: ______________________________________ CPF: ____________________
2. Nome: ______________________________________ CPF: ____________________`,
  },
  {
    id: 'honorarios_parcelado', slug: 'honorarios_parcelado', cat: 'Contrato', ordem: 3,
    titulo: 'Contrato de Honorários por Operação (valor fechado / parcelado)',
    desc: 'Para operação específica com valor fechado em parcelas. Adaptado do contrato de honorários da GM — sem mandato e sem sucumbência; mantidas as hipóteses de vencimento antecipado.',
    corpo: `# CONTRATO DE HONORÁRIOS DE ASSESSORIA — OPERAÇÃO DETERMINADA

Pelo presente instrumento particular, as partes abaixo indicadas, objetivando preservar direitos e obrigações, têm entre si como justo e contratado o seguinte:
---
**I. CONTRATANTE:** {{cliente_nome}}, {{cliente_qualificacao}}, CPF/CNPJ nº {{cliente_doc}}, RG nº {{cliente_rg}}, residente e domiciliado(a) em {{cliente_endereco}}, telefone {{cliente_fone}}, e-mail {{cliente_email}}.
**II. CONTRATADA:** {{escritorio_nome}}, CNPJ nº {{escritorio_cnpj}}, com sede em {{escritorio_endereco}}, neste ato representada por {{escritorio_socio}}.
**III. DO OBJETO:** assessoria técnica e comercial para aquisição do imóvel {{imovel_titulo}}, situado em {{imovel_cidade}}, matrícula nº {{imovel_matricula}} do {{imovel_cartorio}}, na modalidade {{imovel_modalidade}}, junto a {{imovel_credor}}, compreendendo curadoria, análise de viabilidade e do custo total, coordenação da due diligence documental executada por sociedade de advocacia parceira, representação no certame ou na compra direta e acompanhamento pós-aquisição.
---
## IV — DAS CONDIÇÕES DA CONTRATAÇÃO
**1.** A CONTRATADA obriga-se a prestar seus serviços profissionais como **atividade meio**, não dependendo de êxito na aquisição, agindo com zelo e diligência na defesa dos interesses do CONTRATANTE relativamente ao objeto contratado. Este contrato **não abrange atos privativos de advocacia** (Lei 8.906/94), que serão prestados por sociedade de advocacia parceira mediante contrato autônomo.
**2.** O CONTRATANTE obriga-se a fornecer à CONTRATADA todos os documentos (originais ou cópias autenticadas) e informações solicitados, necessários à instrução da operação.
**3.** O CONTRATANTE obriga-se a fornecer antecipadamente o numerário necessário ao pagamento das despesas extrajudiciais ou judiciais que se fizerem necessárias, incluídas as relativas a locomoção e estadia em comarca diversa da sede da CONTRATADA. A CONTRATADA obriga-se a comprovar, por recibos, notas fiscais, certidões ou outro documento hábil, a destinação do numerário recebido. As demais despesas autorizadas pelo CONTRATANTE e arcadas pela CONTRATADA serão pagas junto com os honorários, devidamente corrigidas.
**4.** O CONTRATANTE obriga-se a manter a CONTRATADA informada quanto a mudanças de endereço, telefone e e-mail, bem como quanto à disponibilidade de recursos para o lance, cujo pagamento em regra ocorre em 24 a 48 horas após a arrematação. Não cumprida essa obrigação, a CONTRATADA não responderá pela perda de prazos ou de oportunidades.
**5.** O CONTRATANTE pagará à CONTRATADA, pelos serviços prestados, o valor de **{{valor}}** ({{valor_extenso}}), pago na forma ajustada entre as partes no ato da assinatura.
**5.1** Considerar-se-ão automaticamente vencidas e exigíveis todas as parcelas vincendas nas seguintes hipóteses:
a) aquisição do imóvel objeto deste contrato pelo CONTRATANTE, diretamente ou por interposta pessoa, sem a participação da CONTRATADA;
b) composição amigável realizada diretamente entre o CONTRATANTE e o credor, o devedor ou o leiloeiro;
c) atraso no pagamento das despesas previstas no item 3;
d) não fornecimento, pelo CONTRATANTE, dos documentos ou informações solicitados, ou abandono ou desistência da operação pelo CONTRATANTE;
e) destituição da CONTRATADA sem motivo justo;
f) desistência da aquisição após a habilitação no certame;
g) inadimplemento ou mora no pagamento das parcelas acordadas.
**6.** A parte que der causa à rescisão deste instrumento, inclusive nas hipóteses do item anterior, pagará à outra multa correspondente a 02 (dois) salários mínimos vigentes à época do fato, sem prejuízo dos valores contratados e já devidos.
**7.** Este contrato abrange somente a operação descrita no item III. Novas aquisições, medidas incidentais ou operações correlatas serão objeto de contrato próprio.
**8.** O CONTRATANTE outorga às empresas do grupo PSM, indicadas pela CONTRATADA, **exclusividade** na intermediação da revenda e/ou locação do imóvel adquirido, pelo prazo de 180 (cento e oitenta) dias contados da disponibilização para revenda ou locação, prorrogável automaticamente enquanto perdurar a oferta, nas condições de mercado ({{comissao_pct}}% na venda; {{adm_pct}}% ao mês na administração da locação). A alienação ou locação a terceiros no período, sem a intermediação das empresas indicadas, sujeitará o CONTRATANTE ao pagamento da corretagem integral, a título de multa compensatória.
**9. Declaração de integridade.** A CONTRATADA declara que está comprometida com o comportamento ético e probo nas relações mantidas com entidades e órgãos públicos e privados, abstendo-se de práticas de corrupção, suborno ou fraude, e que conduz suas operações em cumprimento à Lei nº 12.846/2013 e às normas de prevenção à lavagem de dinheiro.
**10. Proteção de dados.** Em cumprimento à Lei 13.709/2018 (LGPD), a CONTRATADA obriga-se a respeitar a privacidade do CONTRATANTE, protegendo e mantendo em sigilo os dados pessoais fornecidos em razão deste contrato, salvo nos casos em que seja obrigada, por autoridade pública, a revelá-los. O tratamento é autorizado para a execução deste contrato e para o exercício regular de direitos.
**11.** As comunicações formais ocorrerão por e-mail e WhatsApp indicados pelas partes. As partes reconhecem a validade das assinaturas eletrônicas. Fica eleito o foro da Comarca de {{cidade_foro}}, com renúncia a qualquer outro. Este instrumento constitui título executivo extrajudicial.
---
{{cidade_foro}}, {{data_extenso}}.
[[ASSINATURAS]]{{cliente_nome}}|CONTRATANTE||{{escritorio_nome}}|{{escritorio_socio}} — CONTRATADA
---
**TESTEMUNHAS:**
1. Nome: ______________________________________ CPF: ____________________
2. Nome: ______________________________________ CPF: ____________________`,
  },
  {
    id: 'recibo', slug: 'recibo', cat: 'Recibo', ordem: 4,
    titulo: 'Recibo de Pagamento',
    desc: 'Modelo da GM adaptado: mantém RG, endereço completo, instituição credora, modalidade e valor por extenso. Sai da operação (parcela de honorários) já preenchido.',
    corpo: `# RECIBO DE PAGAMENTO

Referente a assessoria em aquisição — {{imovel_modalidade}} — Matrícula nº {{imovel_matricula}}
---
## 1. VALOR DO PAGAMENTO
Valor total: **{{valor}}** ({{valor_extenso}}).
Referente a: {{parcela_ref}}.
---
## 2. IDENTIFICAÇÃO DAS PARTES
**2.1. Pagador**
Nome: {{cliente_nome}}
CPF/CNPJ: {{cliente_doc}}
RG: {{cliente_rg}}
Endereço: {{cliente_endereco}}
**2.2. Recebedora**
Empresa: {{escritorio_nome}}
CNPJ: {{escritorio_cnpj}}
---
## 3. DECLARAÇÃO E DESCRIÇÃO
{{escritorio_nome}} declara, para os devidos fins, que recebeu de {{cliente_nome}}, por depósito ou transferência, a importância acima mencionada de {{valor}}, outorgando plena, geral e irrevogável quitação do valor recebido.
O referido pagamento é relativo à assessoria em aquisição de imóvel na modalidade {{imovel_modalidade}}, realizada junto a {{imovel_credor}}, tendo por objeto o imóvel {{imovel_titulo}}, em {{imovel_cidade}}, devidamente registrado sob a matrícula nº {{imovel_matricula}} do {{imovel_cartorio}}.
---
## 4. FORMA DE PAGAMENTO
Favorecida: {{escritorio_nome}}
Modalidade: PIX — Chave: {{escritorio_pix}}
---
{{cidade_foro}}, {{data_extenso}}.
[[ASSINATURAS]]{{escritorio_nome}}|{{escritorio_socio}}`,
  },
  {
    id: 'proposta', slug: 'proposta', cat: 'Proposta', ordem: 5,
    titulo: 'Proposta de Assessoria (carta de apresentação)',
    desc: 'Uma página pra mandar antes do contrato: o que a Morimatsu faz, como cobra e o que o cliente paga à parte.',
    corpo: `# PROPOSTA DE ASSESSORIA EM AQUISIÇÃO DE IMÓVEIS

Para: {{cliente_nome}} — {{cliente_cidade}}
De: {{escritorio_nome}} · Gestão Patrimonial Imobiliária
Data: {{data_extenso}}
---
## O QUE FAZEMOS
A Morimatsu & Associados assessora o ciclo completo do patrimônio imobiliário: **comprar bem, gerir bem, sair melhor.** Atuamos em três frentes — **Aquisição** (leilão e venda direta de imóveis retomados), **Gestão** (carteira sob mandato, locação e administração) e **Desinvestimento** (saída do ativo pelas empresas do grupo PSM).
Antes do lance, a análise. Depois do martelo, as chaves.
---
## COMO TRABALHAMOS
**1. Diagnóstico patrimonial** — 20 minutos para mapear objetivo, capital disponível, prazo e apetite a risco.
**2. Curadoria** — oportunidades filtradas pelo seu perfil, região e faixa de valor.
**3. Análise por imóvel** — viabilidade comercial, leitura do edital e da matrícula, mapeamento de ocupação e débitos, e o **custo total da operação** antes de qualquer lance.
**4. Representação** — atuação estratégica no certame ou na compra direta, com lance máximo definido por método, não por impulso.
**5. Pós-arrematação** — acompanhamento até as chaves, junto à assessoria jurídica parceira.
**6. Destino do ativo** — revenda ou locação pelas empresas do grupo PSM.
---
## HONORÁRIOS
Análise comercial por imóvel: {{fee_analise}} por imóvel.
Participação em certame (representação): {{fee_certame}} por certame, deduzidos do êxito em caso de arrematação.
Honorários de êxito: {{fee_exito_pct}}% sobre a arrematação, com piso de {{fee_piso}} — pagos somente se você arrematar.
Gestão de carteira sob mandato: {{adm_pct}}% ao mês sobre a locação, via administradora do grupo PSM.
---
## O QUE NÃO ESTÁ INCLUÍDO
Ações judiciais (imissão na posse, embargos, anulações), conduzidas pela sociedade de advocacia parceira e contratadas à parte; custas processuais e cartorárias; ITBI e registro; débitos incidentes sobre o imóvel; comissão do leiloeiro; deslocamentos fora da comarca de {{cidade_foro}}.
---
## O QUE ESPERAMOS DE VOCÊ
Capital disponível para o lance no prazo do edital (em regra 24 a 48 horas) e reserva de 15% a 20% além do lance para as custas da operação.
---
Esta proposta é válida por 30 dias e não constitui promessa de resultado. A aquisição em leilão envolve riscos que mapeamos e precificamos antes do lance — nunca depois.
[[ASSINATURAS]]{{escritorio_nome}}|{{escritorio_socio}}`,
  },
];

export const minutas = () => {
  const salvas = Array.isArray(S.minutas) ? S.minutas : [];
  const ids = new Set(salvas.map(m => m.id));
  return salvas.concat(MINUTAS_PADRAO.filter(m => !ids.has(m.id))).sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
};
export const minutaPorSlug = slug => minutas().find(m => m.slug === slug || m.id === slug);

/* ─────────────────────── valor por extenso ─────────────────────── */
const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function trio(n) {
  if (!n) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), d = n % 100;
  const p = [];
  if (c) p.push(CEM[c]);
  if (d < 20) { if (d) p.push(UNI[d]); }
  else { const dz = Math.floor(d / 10), u = d % 10; p.push(DEZ[dz] + (u ? ' e ' + UNI[u] : '')); }
  return p.join(' e ');
}
export function extenso(v) {
  const n = Math.round(num(v) * 100);
  const reais = Math.floor(n / 100), cent = n % 100;
  if (!reais && !cent) return 'zero reais';
  // blocos {valor, texto}: o "e" antes do último só entra se ele for < 100 ou
  // centena/milhar redondo (mil e quinhentos ✓ · cinco mil, setecentos e noventa e cinco ✓)
  const blocos = [];
  let resto = reais;
  for (const [base, sing, plur] of [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil']]) {
    const q = Math.floor(resto / base);
    if (q) { blocos.push({ v: q * base, t: (base === 1e3 && q === 1) ? 'mil' : trio(q) + ' ' + (q === 1 ? sing : plur) }); resto %= base; }
  }
  if (resto) blocos.push({ v: resto, t: trio(resto) });
  let s = '';
  if (blocos.length === 1) s = blocos[0].t;
  else if (blocos.length) {
    const ult = blocos.pop();
    s = blocos.map(b => b.t).join(', ') + ((ult.v < 100 || ult.v % 100 === 0) ? ' e ' : ', ') + ult.t;
  }
  if (reais) s += reais === 1 ? ' real' : ((reais >= 1e6 && reais % 1e6 === 0) ? ' de reais' : ' reais');   // dois milhões DE reais
  if (cent) s = (reais ? s + ' e ' : '') + trio(cent) + (cent === 1 ? ' centavo' : ' centavos');
  return s;
}
/* Dinheiro em documento vai SEMPRE com centavos (R$ 5.795,57 — brl() arredonda) */
export const moeda = v => 'R$ ' + num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ─────────────────────── preenchimento ─────────────────────── */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dataExtenso = d => { const x = d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d) : new Date(); return `${x.getDate()} de ${MESES[x.getMonth()]} de ${x.getFullYear()}`; };
const MODAL_LBL = { online: 'venda online', direta: 'venda direta online', extra: 'leilão extrajudicial', judicial: 'leilão judicial' };
const PARCELA_LBL = { analise: 'análise de imóvel', certame: 'participação em certame', exito: 'honorários de êxito' };

export function contexto({ inv, imv, op, extra } = {}) {
  const f = cfg().fee, e = escritorio();
  const c = {
    cliente_nome: inv?.nome || '', cliente_doc: inv?.documento || '', cliente_rg: inv?.rg || '',
    cliente_endereco: inv?.endereco || '', cliente_cidade: inv?.cidade || '', cliente_fone: inv?.fone || '', cliente_email: inv?.email || '',
    cliente_qualificacao: inv?.qualificacao || (inv?.pj === 'pj' ? 'pessoa jurídica de direito privado' : 'brasileiro(a)'),
    imovel_titulo: imv?.titulo || '', imovel_matricula: imv?.matricula || '', imovel_cartorio: imv?.cartorio || '',
    imovel_cidade: imv?.cidade || '', imovel_modalidade: MODAL_LBL[imv?.modalidade] || '', imovel_credor: imv?.credor || '',
    arremat_valor: op ? moeda(op.valor) : '', arremat_data: op ? dtBR(op.data_arrematacao) : '',
    fee_analise: moeda(f.analise), fee_certame: moeda(f.certame), fee_exito_pct: String(f.exito_pct).replace('.', ','),
    fee_piso: moeda(f.piso), comissao_pct: String(f.comissao_pct).replace('.', ','), adm_pct: String(f.adm_pct).replace('.', ','),
    prazo_meses: '12 (doze)', dia_vencimento: '10 (dez)', honorario_mensal: '', parcela_ref: '',
    escritorio_nome: e.nome, escritorio_cnpj: e.cnpj, escritorio_endereco: e.endereco, escritorio_socio: e.socio,
    escritorio_pix: e.pix, cidade_foro: e.cidade_foro, data_extenso: dataExtenso(),
    valor: '', valor_extenso: '',
  };
  Object.assign(c, extra || {});
  if (c.valor && !c.valor_extenso) c.valor_extenso = extenso(c.valor);
  if (typeof c.valor === 'number') c.valor = moeda(c.valor);
  return c;
}
export const preencher = (corpo, ctx) => String(corpo || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (ctx[k] ?? '') || '__________');

/* ─────────────────────── .docx de verdade (zip store, sem dependência) ─────────────────────── */
const TXT = new TextEncoder();
let _crcT = null;
function crcTab() {
  if (_crcT) return _crcT;
  _crcT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crcT[i] = c >>> 0; }
  return _crcT;
}
function crc32(u8) { const t = crcTab(); let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const chunks = [], central = []; let off = 0;
  const w32 = (a, v) => { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };
  const w16 = (a, v) => { a.push(v & 255, (v >>> 8) & 255); };
  for (const f of files) {
    const name = TXT.encode(f.name), data = f.data, crc = crc32(data);
    const h = []; w32(h, 0x04034b50); w16(h, 20); w16(h, 0); w16(h, 0); w16(h, 0); w16(h, 0);
    w32(h, crc); w32(h, data.length); w32(h, data.length); w16(h, name.length); w16(h, 0);
    const head = new Uint8Array(h);
    chunks.push(head, name, data);
    const c = []; w32(c, 0x02014b50); w16(c, 20); w16(c, 20); w16(c, 0); w16(c, 0); w16(c, 0); w16(c, 0);
    w32(c, crc); w32(c, data.length); w32(c, data.length); w16(c, name.length); w16(c, 0); w16(c, 0); w16(c, 0); w16(c, 0); w32(c, 0); w32(c, off);
    central.push(new Uint8Array(c), name);
    off += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const e = []; w32(e, 0x06054b50); w16(e, 0); w16(e, 0); w16(e, files.length); w16(e, files.length); w32(e, cdSize); w32(e, off); w16(e, 0);
  return new Blob([...chunks, ...central, new Uint8Array(e)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function runs(txt, base) {
  return String(txt).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(p => {
    const b = p.startsWith('**') && p.endsWith('**');
    const t = b ? p.slice(2, -2) : p;
    return `<w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="${base}"/>${b ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
  }).join('');
}
function paras(corpo) {
  const out = [];
  const P = (inner, jc, spacing) => out.push(`<w:p><w:pPr>${jc ? `<w:jc w:val="${jc}"/>` : ''}<w:spacing w:after="${spacing ?? 120}" w:line="276" w:lineRule="auto"/></w:pPr>${inner}</w:p>`);
  for (const raw of String(corpo).split('\n')) {
    const l = raw.trimEnd();
    if (l.startsWith('[[ASSINATURAS]]')) {
      const cols = l.slice(15).split('||').map(c => c.split('|'));
      P('', null, 480);
      cols.forEach(c => { P(runs('_________________________________________', 22), 'center', 0); c.forEach(x => P(runs(x, 22), 'center', 60)); P('', null, 240); });
      continue;
    }
    if (l === '---') { P('', null, 120); continue; }
    if (l.startsWith('## ')) { P(runs('**' + l.slice(3) + '**', 24), null, 100); continue; }
    if (l.startsWith('# ')) { P(runs('**' + l.slice(2) + '**', 28), 'center', 300); continue; }
    if (!l.trim()) { P('', null, 60); continue; }
    P(runs(l, 22), 'both');
  }
  return out.join('');
}
export function baixarDocx(nomeArquivo, corpo) {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras(corpo)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1418"/></w:sectPr></w:body></w:document>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const blob = zipStore([
    { name: '[Content_Types].xml', data: TXT.encode(ct) },
    { name: '_rels/.rels', data: TXT.encode(rels) },
    { name: 'word/document.xml', data: TXT.encode(doc) },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo.replace(/[^\w\s.\-–—áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ&]/g, '').slice(0, 90) + '.docx';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/* ─────────────────────── impressão / PDF ─────────────────────── */
export function imprimirDoc(titulo, corpo) {
  const w = window.open('', '_blank');
  if (!w) return alert('O navegador bloqueou a janela. Libere pop-ups para www.housepsm.com.br.');
  const html = String(corpo).split('\n').map(l => {
    const t = l.trimEnd();
    if (t.startsWith('[[ASSINATURAS]]')) return '<div class="ass">' + t.slice(15).split('||').map(c => `<div>${c.split('|').map(x => esc(x)).join('<br>')}</div>`).join('') + '</div>';
    if (t === '---') return '<div style="height:6px"></div>';
    if (t.startsWith('## ')) return `<h2>${esc(t.slice(3))}</h2>`;
    if (t.startsWith('# ')) return `<h1>${esc(t.slice(2))}</h1>`;
    if (!t.trim()) return '<div style="height:6px"></div>';
    return `<p>${esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</p>`;
  }).join('');
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#1B201D;background:#fff;margin:0;padding:34px 48px;font-size:12pt;line-height:1.55}
    .top{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #9C7A3C;padding-bottom:12px;margin-bottom:22px}
    .top img{height:52px}.top .sub{font-size:9pt;letter-spacing:2px;text-transform:uppercase;color:#1F4A3D;text-align:right}
    h1{font-size:14pt;text-align:center;letter-spacing:.5px;margin:0 0 14px}h2{font-size:11.5pt;margin:16px 0 4px;color:#1F4A3D}
    p{margin:5px 0;text-align:justify}
    .ass{display:flex;gap:40px;margin-top:44px;page-break-inside:avoid}.ass div{flex:1;text-align:center;border-top:1px solid #333;padding-top:6px;font-size:10.5pt}
    .bar{position:fixed;top:0;left:0;right:0;background:#1F4A3D;color:#fff;padding:8px 16px;font-family:sans-serif;font-size:13px;display:flex;gap:12px;align-items:center}
    .bar button{font-size:13px;padding:6px 14px;cursor:pointer}
    @media print{.bar{display:none}body{padding:0}}@page{margin:22mm 20mm}
  </style></head><body>
  <div class="bar"><b>Morimatsu & Associados</b> · ${esc(titulo)} <span style="flex:1"></span><button onclick="window.print()">🖨 Imprimir / salvar PDF</button><button onclick="window.close()">Fechar</button></div>
  <div style="height:44px"></div>
  <div class="top"><img src="${location.origin}/v2/img/morimatsu-logo-marfim.png" alt="Morimatsu & Associados"><div class="sub">Gestão Patrimonial Imobiliária<br>${esc(escritorio().cidade_foro)}</div></div>
  ${html}
  <div style="margin-top:26px;font-size:9pt;color:#666;border-top:1px solid #ddd;padding-top:8px">Documento gerado pelo House PSM em ${new Date().toLocaleString('pt-BR')}.</div>
  </body></html>`);
  w.document.close();
}

/* ─────────────────────── aba 📜 MINUTAS ─────────────────────── */
export function renderMinutas() {
  const lista = minutas(), e = escritorio();
  const custom = new Set((S.minutas || []).map(m => m.id));
  const pendente = !S.config?.escritorio?.cnpj || String(e.cnpj).includes('[');
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div><h2 class="card-title" style="margin:0">📜 Minutas</h2><div class="card-sub" style="margin:0">Contratos, recibos e propostas da Morimatsu — editáveis aqui dentro, preenchidos com os dados reais e exportados em Word (.docx) ou PDF.</div></div>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" id="ma-esc">⚙️ Dados do escritório</button>
        <button class="btn btn-primary" id="ma-min-nova">＋ Nova minuta</button>
      </div>
      ${pendente ? `<div class="alert alert-warn mt-2" style="font-size:12.5px">⚠️ Razão social e CNPJ da Morimatsu ainda não preenchidos — os documentos saem com o campo em branco. Preencha em <b>⚙️ Dados do escritório</b> assim que a alteração da FOLK sair.</div>` : ''}
    </div>
    <div class="ma-list">
      ${lista.map(m => `<div class="ma-li" style="grid-template-columns:1fr auto;cursor:default">
        <div>
          <div class="flex items-center gap-2" style="flex-wrap:wrap"><b>${esc(m.titulo)}</b><span class="ma-tag" style="background:${m.cat === 'Recibo' ? '#0ea5e9' : m.cat === 'Proposta' ? COR.verde : COR.dourado}">${esc(m.cat)}</span>${custom.has(m.id) ? '<span class="ma-tag" style="background:#64748b">editada</span>' : '<span class="ma-tag" style="background:#334155">padrão</span>'}</div>
          <div class="tiny muted" style="margin-top:2px">${esc(m.desc || '')}</div>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap;justify-content:flex-end">
          <button class="btn btn-primary m-gerar" data-id="${esc(m.id)}" style="font-size:11.5px">📄 Gerar preenchida</button>
          <button class="btn btn-ghost m-edit" data-id="${esc(m.id)}" style="font-size:11.5px">✏️ Editar</button>
          <button class="btn btn-ghost m-docx" data-id="${esc(m.id)}" style="font-size:11.5px" title="modelo em branco">⬇ .docx</button>
          ${custom.has(m.id) ? `<button class="btn btn-ghost m-del" data-id="${esc(m.id)}" style="font-size:11.5px" title="${MINUTAS_PADRAO.some(p => p.id === m.id) ? 'voltar ao padrão' : 'excluir'}">${MINUTAS_PADRAO.some(p => p.id === m.id) ? '↩︎' : '🗑'}</button>` : ''}
        </div>
      </div>`).join('')}
    </div>
    <div class="card">
      <h2 class="card-title">De onde vieram estas minutas</h2>
      <p class="card-sub">Adaptadas dos modelos da <b>GM Leilões (Gumiero & Morimatsu)</b> em 08/set/2026. Os originais são contratos de prestação de serviços <b>advocatícios</b> (Rodrigo Gumiero, OAB/SP 224.466), com mandato procuratório e honorários de sucumbência (art. 23 da Lei 8.906/94).</p>
      <ul class="ma-ul">
        <li>A Morimatsu <b>não</b> é sociedade de advogados: sucumbência, mandato procuratório e a expressão “serviços advocatícios” foram <b>removidos</b>.</li>
        <li>O objeto virou <b>assessoria técnica e comercial</b> (obrigação de meio), com a ressalva expressa de que atos privativos de advocacia ficam com a sociedade parceira, em contrato próprio do cliente com ela.</li>
        <li>Foi <b>acrescentada</b> em todos os contratos a exclusividade de saída pelas empresas PSM (Trava 1 do ciclo) e a tabela de honorários vigente.</li>
        <li>Os modelos originais da GM seguem válidos para o <b>advogado parceiro</b>, não para a Morimatsu.</li>
      </ul>
      <p class="tiny muted mt-2">Recomendação: submeter as três minutas de contrato à revisão da advogada parceira antes do primeiro uso com cliente (item do Roteiro, Semanas 3–4).</p>
    </div>`;
}

export function wireMinutas(root) {
  const $ = s => root.querySelector(s);
  $('#ma-min-nova').onclick = () => editarMinuta(null);
  $('#ma-esc').onclick = editarEscritorio;
  root.querySelectorAll('.m-edit').forEach(b => b.onclick = () => editarMinuta(minutas().find(m => m.id === b.dataset.id)));
  root.querySelectorAll('.m-gerar').forEach(b => b.onclick = () => gerarMinuta(minutas().find(m => m.id === b.dataset.id)));
  root.querySelectorAll('.m-docx').forEach(b => { const m = minutas().find(x => x.id === b.dataset.id); b.onclick = () => baixarDocx(m.titulo + ' — modelo', preencher(m.corpo, contexto({}))); });
  root.querySelectorAll('.m-del').forEach(b => b.onclick = async () => {
    const padrao = MINUTAS_PADRAO.some(p => p.id === b.dataset.id);
    if (!confirm(padrao ? 'Descartar suas edições e voltar ao texto padrão desta minuta?' : 'Excluir esta minuta? Não tem volta.')) return;
    await setCol('minutas', (S.minutas || []).filter(m => m.id !== b.dataset.id));
  });
}

function editarMinuta(m) {
  const nova = !m;
  m = m || { id: uid('min'), cat: 'Contrato', titulo: '', desc: '', corpo: '# TÍTULO DO DOCUMENTO\n\n## CLÁUSULA PRIMEIRA\nTexto…\n', ordem: 90 };
  const chips = VARS.map(([k, l]) => `<button type="button" class="ma-chip v-chip" data-v="${k}" title="${esc(l)}">{{${k}}}</button>`).join('');
  abrirModal(nova ? '＋ Nova minuta' : '✏️ ' + esc(m.titulo), `<form id="f-min">
    <div class="ma-form">
      ${campo('Título *', input('titulo', m.titulo, 'text', 'required'), true)}
      ${campo('Categoria', select('cat', { Contrato: 'Contrato', Recibo: 'Recibo', Proposta: 'Proposta', Termo: 'Termo', Outro: 'Outro' }, m.cat))}
      ${campo('Ordem na lista', input('ordem', m.ordem ?? 90, 'number'))}
      ${campo('Descrição curta', input('desc', m.desc), true)}
    </div>
    <div class="ma-sec">Variáveis — clique para inserir no ponto do cursor</div>
    <div class="ma-chips">${chips}</div>
    <div class="ma-sec">Corpo do documento</div>
    <div class="tiny muted" style="margin-bottom:4px"><code># </code> título · <code>## </code> cláusula · <code>---</code> espaço · <code>**negrito**</code> · <code>[[ASSINATURAS]]</code>linha1|linha2<code>||</code>outra coluna</div>
    <textarea class="input" name="corpo" id="min-corpo" rows="20" style="width:100%;font-family:var(--font-mono,monospace);font-size:12px;line-height:1.5">${esc(m.corpo)}</textarea>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" type="submit">💾 Salvar minuta</button>
      <button class="btn btn-ghost" type="button" id="f-prev">👁 Pré-visualizar</button>
      <button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button>
      ${MINUTAS_PADRAO.some(p => p.id === m.id) ? '<span class="tiny muted" style="margin-left:auto">Editando uma minuta padrão — dá pra voltar ao original depois (↩︎ na lista).</span>' : ''}
    </div></form>`, box => {
    const ta = box.querySelector('#min-corpo');
    box.querySelectorAll('.v-chip').forEach(c => c.onclick = () => {
      const v = `{{${c.dataset.v}}}`, i = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, i) + v + ta.value.slice(ta.selectionEnd ?? i);
      ta.focus(); ta.selectionStart = ta.selectionEnd = i + v.length;
    });
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#f-prev').onclick = () => imprimirDoc(box.querySelector('[name=titulo]').value || 'Minuta', preencher(ta.value, contexto({})));
    box.querySelector('#f-min').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const it = { ...m, titulo: String(fd.get('titulo')).trim(), cat: fd.get('cat') || 'Contrato', desc: String(fd.get('desc')).trim(), ordem: num(fd.get('ordem')) || 90, corpo: ta.value };
      if (!it.titulo) return;
      const lista = (S.minutas || []).filter(x => x.id !== it.id).concat([it]);
      fecharModal(); await setCol('minutas', lista);
    };
  }, 900);
}

function editarEscritorio() {
  const e = escritorio();
  abrirModal('⚙️ Dados do escritório', `<form class="ma-form" id="f-esc">
    ${campo('Razão social *', input('nome', e.nome, 'text', 'required'), true)}
    ${campo('CNPJ', input('cnpj', e.cnpj))}
    ${campo('Chave PIX', input('pix', e.pix))}
    ${campo('Endereço da sede', input('endereco', e.endereco), true)}
    ${campo('Sócio responsável', input('socio', e.socio))}
    ${campo('Cidade do foro', input('cidade_foro', e.cidade_foro))}
    <div class="tiny muted" style="grid-column:1/-1">Estes dados entram automaticamente em toda minuta, contrato e recibo gerados.</div>
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div></form>`, box => {
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#f-esc').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const o = {}; ['nome', 'cnpj', 'pix', 'endereco', 'socio', 'cidade_foro'].forEach(k => { o[k] = String(fd.get(k) || '').trim(); });
      fecharModal(); await setCol('config', { ...S.config, escritorio: o });
    };
  });
}

/* Gerar preenchida: escolhe investidor / imóvel / operação + campos extras */
export function gerarMinuta(m, pre) {
  if (!m) return;
  const invs = Object.fromEntries(S.investidores.map(i => [i.id, i.nome]));
  const imvs = Object.fromEntries(S.imoveis.map(i => [i.id, i.titulo]));
  const ops = Object.fromEntries(S.operacoes.map(o => [o.id, `${invPorId(o.investidor_id)?.nome || '?'} · ${imvPorId(o.imovel_id)?.titulo || '?'}`]));
  const usa = k => m.corpo.includes('{{' + k + '}}');
  const p = pre || {};
  abrirModal(`📄 Gerar — ${esc(m.titulo)}`, `<form class="ma-form" id="f-ger">
    ${campo('Investidor', select('inv', invs, p.inv), true)}
    ${usa('imovel_titulo') || usa('imovel_matricula') ? campo('Imóvel', select('imv', imvs, p.imv)) : ''}
    ${usa('arremat_valor') || usa('parcela_ref') ? campo('Operação', select('op', ops, p.op)) : ''}
    ${usa('valor') ? campo('Valor do documento (R$)', input('valor', p.valor ?? '', 'number')) : ''}
    ${usa('parcela_ref') ? campo('Parcela referente', select('parcela', PARCELA_LBL, p.parcela || 'exito')) : ''}
    ${usa('honorario_mensal') ? campo('Honorário mensal (R$)', input('mensal', p.mensal ?? 1500, 'number')) : ''}
    ${usa('dia_vencimento') ? campo('Dia do vencimento', input('dia', p.dia ?? 10, 'number')) : ''}
    ${usa('prazo_meses') ? campo('Prazo (meses)', input('prazo', p.prazo ?? 12, 'number')) : ''}
    ${campo('Data do documento', input('data', hojeISO(), 'date'))}
    <div class="flex gap-2" style="grid-column:1/-1;flex-wrap:wrap">
      <button class="btn btn-primary" type="submit">⬇ Baixar Word (.docx)</button>
      <button class="btn btn-gold" type="button" id="g-print">🖨 Imprimir / PDF</button>
      <button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button>
    </div>
    <div class="tiny muted" style="grid-column:1/-1">Campos sem dado na ficha saem como <code>__________</code> para preencher à mão. Complete CPF, RG e endereço na ficha do investidor para o documento sair inteiro.</div>
  </form>`, box => {
    const montar = () => {
      const fd = new FormData(box.querySelector('#f-ger'));
      const inv = invPorId(fd.get('inv')), op = S.operacoes.find(o => o.id === fd.get('op'));
      const imv = imvPorId(fd.get('imv')) || (op ? imvPorId(op.imovel_id) : null);
      const extra = { data_extenso: dataExtenso(fd.get('data')) };
      if (usa('prazo_meses') && fd.get('prazo')) extra.prazo_meses = `${num(fd.get('prazo'))} (${extenso(num(fd.get('prazo'))).replace(/ reais?$/, '')})`;   // extenso() devolve moeda; corta o sufixo
      if (usa('dia_vencimento') && fd.get('dia')) extra.dia_vencimento = String(num(fd.get('dia')));
      if (usa('honorario_mensal') && fd.get('mensal')) extra.honorario_mensal = `${moeda(fd.get('mensal'))} (${extenso(fd.get('mensal'))})`;
      if (usa('parcela_ref')) extra.parcela_ref = PARCELA_LBL[fd.get('parcela') || 'exito'];
      let v = num(fd.get('valor'));
      if (!v && op && fd.get('parcela')) v = num(op.honorarios?.[fd.get('parcela')]?.valor);
      if (v) { extra.valor = moeda(v); extra.valor_extenso = extenso(v); }
      const ctx = contexto({ inv: inv || (op ? invPorId(op.investidor_id) : null), imv, op, extra });
      const nome = `${m.titulo} — ${ctx.cliente_nome || 'modelo'}`;
      return { texto: preencher(m.corpo, ctx), nome };
    };
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#g-print').onclick = () => { const r = montar(); imprimirDoc(r.nome, r.texto); };
    box.querySelector('#f-ger').onsubmit = ev => { ev.preventDefault(); const r = montar(); baixarDocx(r.nome, r.texto); };
  }, 720);
}
