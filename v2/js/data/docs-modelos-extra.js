/* ============================================================================
   PSM-OS v2 — Modelos PADRÃO: cessão de direitos, exclusividade e visita  v88.17
   ----------------------------------------------------------------------------
   Fontes (biblioteca "Minutas padrão" → Drive do Paulo, 23/09/2026):
   - proposta_cessao   ← "proposta de cessão de direitos 2026"      (Drive 1K9kvpXYksOFau1Q1jyJoFGjoFwQPYh8K)
   - contrato_cessao   ← "Contrato Promessa de Cessão de direitos 2026"
                          (Drive 1m4OwLp8OCgr4pUemgotUQ6rnvehP8aGs). ⚠️ O arquivo do Drive é
                          um contrato REAL de 2024 (nomes, CPFs, contas): aqui só a
                          ESTRUTURA — nenhum dado daquele negócio foi copiado.
   - exclusividade     ← "Ctt EXCLUSIVIDADE - PSM IMOVEIS 2026"     (Drive 17_AuXkgtxi4nBGgHV2HszL6ooDC5AK_w)
   - ficha_visita      ← "Ficha de Visita a Imóvel com Potencial Comprador" (Drive 1IIp9Rt8GSQdiT-F53CoHxyT8n81CvSe-)
   Papéis: c = cessionário / interessado · v = cedente / proprietário.
============================================================================ */

const PAPEIS_CESSAO = {
  c1: '1º cessionário (comprador) — ou representante da empresa', c2: 'Cônjuge / 2º cessionário',
  v1: '1º cedente (vendedor)', v2: 'Cônjuge / 2º cedente',
};

const BLOCO_PESSOA = (p, titulo) => `## ${titulo}
**NOME:** {{${p}_nome}}
**RG:** {{${p}_rg}}
**CPF:** {{${p}_cpf}}
**DATA DE NASCIMENTO:** {{${p}_nascimento_br}}
**E-MAIL:** {{${p}_email}}
**ESTADO CIVIL / REGIME DE CASAMENTO:** {{${p}_estado_civil_linha}}
**NACIONALIDADE:** {{${p}_nacionalidade}}
**PROFISSÃO:** {{${p}_profissao}}
**ENDEREÇO ATUAL:** {{${p}_endereco}}`;

export const MODELOS_EXTRA = [
  /* ─────────────────────────── 5. PROPOSTA DE CESSÃO DE DIREITOS ─────────────────────────── */
  {
    id: 'proposta_cessao',
    titulo: 'Proposta de cessão de direitos',
    categoria: 'Cessão de direitos',
    empresa: 'psm_assessoria',
    arquivo: 'Proposta de cessão de direitos',
    papeis: PAPEIS_CESSAO,
    corpo: `# PROPOSTA DE PROMESSA DE CESSÃO DE DIREITOS E OUTRAS AVENÇAS
Instrumento com força executiva – Art. 784, III do CPC
---
**IMOBILIÁRIA RESPONSÁVEL:** {{empresa_nome}} – CNPJ {{empresa_cnpj}}
**CRECI JURÍDICO:** {{empresa_creci}}
**ENDEREÇO:** {{empresa_endereco}}
**CONTATO:** {{empresa_fone}}
**E-MAIL:** {{empresa_email}}
---
O presente instrumento visa demonstrar a intenção de propor e garantir ao COMPRADOR INTERESSADO a aquisição do imóvel supra descrito pelas condições seguintes:
---
${BLOCO_PESSOA('c1', 'CESSIONÁRIO(S):')}
{{#c2_nome}}---
${BLOCO_PESSOA('c2', 'CÔNJUGE E/OU 2º CESSIONÁRIO:')}
{{/c2_nome}}---
## DADOS DO IMÓVEL:
**EMPREENDIMENTO / UNIDADE:** {{imovel_empreendimento}} – {{imovel_unidade}}
**ENDEREÇO COMPLETO:** {{imovel_endereco}}
**CEP:** {{imovel_cep}}
**BLOCO/PAVIMENTO:** {{imovel_bloco}}
**ÁREA PRIVATIVA:** {{imovel_area}}
**ÁREA COMUM:** {{imovel_area_comum}}
**TOTALIZANDO UMA ÁREA DE:** {{imovel_area_total}}
**FRAÇÃO IDEAL:** {{imovel_fracao}}
---
**VALOR PROPOSTO:** {{valor_extenso}}
**FORMA DE PAGAMENTO:** {{forma_pagamento}}
## CONDIÇÕES DA PROPOSTA:
{{condicoes}}
---
${BLOCO_PESSOA('v1', 'CEDENTE(S):')}
{{#v2_nome}}---
${BLOCO_PESSOA('v2', 'CÔNJUGE E/OU 2º CEDENTE:')}
{{/v2_nome}}---
## DISPOSIÇÕES GERAIS:
1) A presente proposta, uma vez aceita formalmente pela parte contrária (cedente/vendedor), torna-se irrevogável e irretratável, obrigando ambas as partes aos seus termos e condições.
2) Após aceita pelo(s) cedente(s)/proprietário(s)/vendedor(es) a proposta tornar-se-á um contrato preliminar, nos moldes estabelecidos no art. 462 a 466 do Código Civil, sendo que as partes se obrigam a cumpri-la no prazo máximo de 07 (sete) dias contados do aceite.
3) Aceita a proposta, o(s) proprietário(s) vendedores no prazo estipulado acima, providenciarão todos os documentos relacionados ao imóvel e seus proprietários para que seja realizada a due diligence, oportunidade que referidos documentos não apontando nenhuma causa impeditiva, será elaborado o competente contrato.
4) O(s) cedentes providenciarão o extrato atualizado de pagamentos da unidade ou comprovante de quitação junto a loteadora/urbanista/incorporadora/construtora para apresentar junto aos documentos necessários para elaboração do respectivo contrato.
5) A parte que der causa ao arrependimento ou a inexecução do contrato preliminar suportará, além das perdas e danos devidas à parte inocente, o pagamento imediato dos honorários profissionais do corretor de imóveis, no mesmo percentual estabelecido nos termos da Lei e regulamentados pelo CRECI/SP, nos moldes estabelecidos no art. 725 do Código Civil.
6) A presente proposta é confidencial nos termos da lei e, não poderá em hipótese alguma ser divulgada sob pena de ferir a LGPD.
7) A comissão deverá ser suportada pelo(s) proprietário(s) CEDENTE(S) no valor equivalente a {{comissao_pct_extenso}} do negócio realizado.
8) Proposta aceita vincula juridicamente as partes.
9) Este instrumento constitui título executivo (CPC, art. 784, III).
10) Desistência injustificada após aceitação: multa de 10% sobre o valor total.
11) O valor da multa deverá ser pago no prazo máximo de 7 (sete) dias corridos a contar da notificação da desistência, sem prejuízo de outras medidas cabíveis.
12) As partes reconhecem a intermediação da {{empresa_nome}}, inscrito(a) no CRECI sob o nº {{empresa_creci}}, nesta operação imobiliária.
13) Este instrumento constitui título executivo (CPC, art. 784, III).
13) Este documento proposta atualmente é formado por todos os conteúdos, informações e cláusulas das páginas 1 e 2.
14) Caso houver contra proposta, a mesma será formalizada e integrará a este documento inicial.
15) Obrigações se estendem a herdeiros/sucessores.
16) Alterações só terão validade se feitas por escrito e assinadas por ambas as partes.
17) Considerando que ambas as partes declaram estarem cientes que o presente instrumento não transfere a propriedade, muito menos a posse do referido imóvel.
---
**VALIDADE DA PROPOSTA:** 07 dias corridos a contar a data de emissão da proposta.
**DATA DE EMISSÃO:** {{data_doc_br}}
---
Por terem lido e por estarem as partes em pleno acordo com o disposto neste instrumento, assinam-no conjuntamente com as testemunhas de forma eletrônica, por meio do certificado digital e/ou de plataformas de assinatura eletrônica, devidamente autorizadas pela Infraestrutura de Chaves Públicas Brasileira – ICP-Brasil (e.g., ClickSign), em conformidade com a MP nº 2.200-2/2001 e a Lei 14.063 e, serão consideradas como assinaturas válidas, sendo este Contrato, conforme seus próprios termos e no que for aplicável, considerado como exequível, válido e vigente entre as Partes.
---
{{cidade_foro}}, {{data_extenso}}.
## ASSINATURA DO(S) PROPONENTE(S) CESSIONÁRIO(S)
[[ASSINATURAS]]{{c1_nome}}|CESSIONÁRIO{{#c2_nome}}||{{c2_nome}}|CÔNJUGE E/OU 2º CESSIONÁRIO{{/c2_nome}}
## ASSINATURA DO(S) CEDENTE(S)
[[ASSINATURAS]]{{v1_nome}}|CEDENTE{{#v2_nome}}||{{v2_nome}}|CÔNJUGE E/OU 2º CEDENTE{{/v2_nome}}
## ASSINATURA DA IMOBILIÁRIA RESPONSÁVEL PELA INTERMEDIAÇÃO
[[ASSINATURAS]]{{empresa_nome}}|Corretor(a): {{corretor_nome}}`,
  },

  /* ────────────────── 6. CONTRATO DE PROMESSA DE CESSÃO DE DIREITOS ────────────────── */
  {
    id: 'contrato_cessao',
    titulo: 'Contrato de promessa de cessão de direitos',
    categoria: 'Cessão de direitos',
    empresa: 'psm_assessoria',
    arquivo: 'Promessa de cessão de direitos',
    papeis: PAPEIS_CESSAO,
    padrao: {
      contrato_origem: 'CONTRATO PARTICULAR DE INCORPORAÇÃO, COM PROMESSA DE VENDA E COMPRA DE UNIDADE FUTURA',
      posse_clausula: 'Tendo em vista que o imóvel aqui alienado está em fase final de edificação, a POSSE PRECÁRIA será transferida imediatamente após a entrega pela construtora, que deverá ocorrer em até 90 (noventa) dias após a assinatura do presente instrumento. Já a POSSE DEFINITIVA se transferirá com a quitação integral dos valores supra descritos.',
      prazo_cessao: '15',
      comissao_quando: 'no ato da assinatura deste instrumento',
    },
    corpo: `# INSTRUMENTO PARTICULAR DE PROMESSA DE CESSÃO DE DIREITOS E OBRIGAÇÕES
**{{valor_moeda}}**
---
Pelo presente instrumento e na melhor forma de direito, de um lado como PROMITENTE(S) CEDENTE(S): {{vendedores_qualificacao}}; e, de outro lado, como PROMISSÁRIO(S) CESSIONÁRIO(S): {{#pj_razao}}{{pj_razao}}, inscrita no CNPJ sob o nº {{pj_cnpj}}, com sede em {{pj_sede}}, neste ato representada por {{/pj_razao}}{{compradores_qualificacao}}, firmam entre si, justo, combinado e contratado, o seguinte negócio, conforme cláusulas e condições abaixo pactuadas.
## DO OBJETO:
Cláusula 1ª - Constitui objeto deste instrumento a promessa de cessão, irrevogável e irretratável, que o(s) PROMITENTE(S) CEDENTE(S) faz(em) ao(s) PROMISSÁRIO(S) CESSIONÁRIO(S), pelo preço, forma de pagamento e demais condições a seguir pactuadas, do imóvel a seguir descrito:
{{imovel_descricao}}
que o fazem de comum acordo, considerando que ambas as partes: a) tem ciência da atual situação socioeconômica do País; b) tem plena ciência das cláusulas, condições e seus impactos ora firmados, exceto nos casos em que dependermos de qualquer repartição pública ou bancária; c) possuem plena capacidade para honrar o contrato ora firmado o qual permanecerá intacto, independentemente de qualquer mudança governamental ou socioeconômica global e, compreendem o que de fato está escrito.
Parágrafo Único: O PROMITENTE CEDENTE é titular dos direitos sobre o imóvel por força do “{{contrato_origem}}” firmado junto a {{incorporadora}}, adiante denominada simplesmente INCORPORADORA.
Cláusula 2ª - Por força deste instrumento, o(s) PROMITENTE(S) CEDENTE(S) prometem ceder e transferir ao(s) PROMISSÁRIO(S) CESSIONÁRIO(S) todos os seus direitos e obrigações decorrentes do “{{contrato_origem}}”, como de fato cedido fica ao(s) PROMISSÁRIO(S) CESSIONÁRIO(S) o imóvel especificado na cláusula anterior, totalmente livre e desembaraçado de quaisquer ônus reais, pessoais ou fiscais, judiciais ou extrajudiciais, demais gravames, hipotecas legais ou convencionais, dúvidas, dívidas, litígios, penhora, impostos, taxas ou restrições de qualquer natureza.
O(s) PROMITENTE(S) CEDENTE(S) declaram, ainda, que o imóvel retro não é objeto de penhora ou de discussão em nenhuma esfera das áreas cível, criminal, fiscal, trabalhista, previdenciária e eleitoral, bem como ainda, que sua alienação não compromete o patrimônio do(s) PROMITENTE(S) CEDENTE(S).
## DO PREÇO, DA FORMA E DAS CONDIÇÕES DE PAGAMENTO:
Cláusula 3ª - O preço total, certo e ajustado para a presente transação é de {{valor_extenso}}, que será satisfeito pelo(s) PROMISSÁRIO(S) CESSIONÁRIO(S) em favor do(s) PROMITENTE(S) CEDENTE(S), da forma seguinte:
{{pagamento_detalhe}}
3.1 Os pagamentos são feitos sob o CARÁTER PRÓ-SOLVENDO.
3.2. Com os pagamentos acima descritos, o(s) PROMITENTE(S) CEDENTE(S) outorga(m) em favor do(s) PROMISSÁRIO(S) CESSIONÁRIO(S) a mais ampla, plena e irrevogável quitação, para nada mais poder reclamar, seja a que título for, quanto ao presente negócio.
A mora do PROMISSÁRIO CESSIONÁRIO no cumprimento das obrigações pecuniárias assumidas na cláusula 3ª (cada obrigação específica), nas datas e valores supras aprazados, acarretar-lhe-á a responsabilidade nas seguintes penalidades:
correção monetária, respeitando os índices do IGPM/FGV, calculado “pro rata die”;
multa de 10% (dez por cento) além de juros de mora no percentual de 1% (um por cento) ao mês, ou fração, calculados dia a dia, que incidirão sobre o valor pendente;
se houver necessidade, honorários de advogado, na base de 10% (dez por cento) se extrajudicial e 20% (vinte por cento) se judicial, sobre o valor total do débito atualizado, bem como as respectivas despesas de cobranças.
Na hipótese de inadimplemento do(s) PROMISSÁRIO(S) CESSIONÁRIO(S) no cumprimento das obrigações assumidas na cláusula 3ª acima, decorrido prazo superior a 05 (cinco) dias sem o pagamento com os consectários devidamente pactuados, poderá(ão) o/a(s) PROMITENTE(S) CEDENTE(S) optar, a seu único e exclusivo critério, por:
Ou, considerar vencida por antecipação a totalidade do preço, e, por consequência, compelir judicialmente o(s) PROMISSÁRIO(S) CESSIONÁRIO(S) a efetivar o pagamento do valor remanescente, acrescido da multa por descumprimento contratual estipulada abaixo, tudo cobrável mediante o ajuizamento da ação competente, considerando este documento como título extrajudicial (artigo 784, inciso III, do CPC);
Ou, então, renunciando à faculdade acima prevista, considerar resolvido, de pleno direito e em sua integralidade, o presente contrato, mediante simples notificação extrajudicial. Nesse caso, o(s) PROMITENTE(S) CEDENTE(S) devolverá(ão) ao(s) PROMISSÁRIO(S) CESSIONÁRIO(S) os valores até então recebidos, retendo-se, além da importância relativa ao ARRAS, à taxa de corretagem paga diretamente pelos PROMISSÁRIOS CESSIONÁRIOS aos corretores intermediadores, os valores eventualmente devidos a título de multa.
A tolerância ao recebimento fora do prazo e forma estabelecida neste instrumento ou o não exercício de qualquer direito acima previsto constituirá mera liberalidade do(s) PROMITENTE(S) CEDENTE(S), que não afetará de forma alguma as demais cláusulas e condições do presente instrumento, nem importará novação ou modificação do ora ajustado, inclusive quanto aos encargos resultantes da mora.
## DA POSSE:
Cláusula 4ª - {{posse_clausula}}
## DA CESSÃO DE DIREITOS:
Cláusula 5ª – Todas as partes declaram conhecer de que o referido imóvel citado como objeto deste contrato será entregue conforme memorial descritivo apresentado pela construtora.
Após quitação dos valores aqui pactuados o(s) PROMITENTE(S) CEDENTE(S) obriga(m)-se a outorgar cessão de direitos definitiva, no prazo de até {{prazo_cessao}} dias, junto à INCORPORADORA, sendo que os custos de cessão de direitos ficarão de responsabilidade exclusiva dos cessionários.
5.2 Negando-se os PROMITENTE(S) CEDENTE(S) a outorgarem a cessão de direitos pela qual se obrigaram, poderão ser compelidos a fazê-lo através de ação de adjudicação compulsória, sem prejuízo da cobrança da multa por descumprimento contratual estipulada neste instrumento.
## DOS ÔNUS, TRIBUTOS E MULTAS:
Cláusula 6ª - O(s) PROMITENTE(S) CEDENTE(S) declara(m) inexistir, até a data da assinatura do presente instrumento, qualquer tributo em atraso, sendo certo, que eventual tributo ou despesa pendente cujo fato gerador tenha ocorrido até a outorga da posse (precária) e ainda que exigível no futuro (não descrita nos itens acima mencionados), ficará por conta do(s) CEDENTE(S).
6.1. Já os tributos incidentes após a efetiva outorga da posse (mesmo que precária), serão de responsabilidade exclusiva do(s) PROMISSÁRIO(S) CESSIONÁRIO(S).
Cláusula 7ª - A presente transação é feita livre de ônus, dívidas, encargos, hipotecas legais ou convencionais, razão pela qual o(s) PROMITENTE(S) CEDENTE(S) respondem pelos riscos de evicção do imóvel objeto deste.
## DAS CONDIÇÕES GERAIS:
Cláusula 8ª - O(s) CONTRATANTE(S) declara(m) expressamente que não possui(em) títulos protestados, e não existem ações contra ele(s) em processamento, que impossibilitem ou o presente negócio; declaram também que não possuem passivos ou embaraços jurídicos em seus nomes e que possam, de alguma forma, onerar o imóvel e/ou frustrar a viabilidade jurídica deste negócio por eventual fraude à execução ou a credores; declaram ainda que não estão sujeitos as exigências previdenciárias para este ato e que não possuem em trâmite ação fundada em direito real ou pessoal reipersecutória, que tenha incidência sobre o imóvel objeto do presente contrato e que de alguma forma possa prejudicá-lo.
8.1. O(s) CONTRATANTES declara(m) sob responsabilidade civil e criminal, que o(s) imóvel(is) objeto deste Contrato está(ão) completamente livre(s) e desembaraçado(s) de todos e quaisquer ônus reais, pessoais ou fiscais, judiciais ou extrajudiciais, demais gravames, hipotecas legais ou convencionais, dúvidas, dívidas, litígios, penhora, impostos, taxas ou restrições de qualquer natureza, tampouco quanto as suas pessoas e de que não estão vinculados ao Instituto Nacional do Seguro Social como empregador ou produtor rural.
Cláusula 9ª - Declara(m) o(s) PROMITENTE(S) CEDENTE(S) que não existem pendências trabalhistas e previdenciárias que possam afetar este negócio, assumindo o mesmo todos os encargos dessa natureza com respeito a fatos geradores verificados até esta data.
Cláusula 10ª - Nenhuma das partes poderá ser responsabilizada pela falta de cumprimento de suas obrigações quando motivada por caso fortuito ou de força maior, conforme disposto no artigo 393 e seu parágrafo único do Código Civil, tais como, exemplificativamente, mas não exaustivamente, greves, comoções sociais, incêndios, enchentes, terremotos, atos de autoridades competentes impedindo, restringindo ou retardando o funcionamento de qualquer das partes, que inviabilizem a execução do presente Instrumento. Tal desoneração prevalecerá pelo tempo e na medida em que a parte inadimplente estiver sob a ação do evento, cabendo-lhe dar imediato aviso à outra parte das razões e da extensão do fato, bem como da data em que for possível o reinício do cumprimento do Instrumento.
Cláusula 11ª - O presente negócio é irrevogável e irretratável, com exceção das cláusulas resolutivas aqui eventualmente expressas, obrigando não só as partes contratantes, mas também seus herdeiros e/ou sucessores a qualquer título, para honrá-lo em sua plenitude, aberta à via da adjudicação compulsória. As partes contratantes renunciam também expressamente o direito de arrependimento, sendo, por isso, obrigatória à outorga e aceitação da cessão definitiva nos termos aqui ajustados.
Cláusula 12ª - A infração a qualquer cláusula deste instrumento ou ainda a parte que obrigar a outra a ingressar em juízo, para o cumprimento total ou parcial desta avença, ficará sujeita à multa de 10% (dez por cento) e juros de mora de 1% (um por cento) ao mês sobre o valor da venda ou, em se tratando do INTERMEDIADOR, o valor da comissão de intermediação, além de arcar com custas, despesas processuais e honorários advocatícios da parte inocente, independentemente da aplicação de quaisquer outras penalidades por ventura aplicadas ou devidas.
Cláusula 13ª - As partes não poderão ceder e/ou transferir, no todo ou em parte, os direitos e obrigações resultantes deste contrato, sem que haja anuência por escrito da outra.
## DAS CONDIÇÕES GERAIS
Cláusula 14ª - 14.0 Efeito Vinculante. O presente Contrato consiste em uma obrigação irrevogável das Partes e de seus respectivos sucessores e cessionários autorizados.
- Acordo Integral. O presente consiste no acordo integral firmado entre as Partes, devendo prevalecer sobre todos e quaisquer acordos e entendimentos anteriores, sejam eles verbais ou escritos, a respeito do objeto deste Contrato.
- Alterações. Nenhuma alteração a qualquer um dos termos ou condições previstas no presente Contrato deverá ter qualquer efeito, a menos que ela seja feita por escrito e assinada por cada uma das Partes.
- Cessão. Nenhuma das Partes poderá ceder ou transferir qualquer direito ou obrigação decorrente do presente Contrato ou relacionado a ele sem o consentimento prévio por escrito das outras partes.
- Disposições Inválidas. Caso qualquer disposição ou parte de uma disposição deste Contrato seja considerada por qualquer tribunal de jurisdição competente, inválida ou inexequível, tal invalidez ou inexequibilidade não afetará as outras disposições ou partes desta disposição ou deste Contrato, sendo que todas permanecerão em pleno vigor e efeito. As Partes deverão negociar de boa-fé a substituição da disposição inválida, ilegal ou inexequível por disposições válidas, legais e exequíveis cujo efeito econômico e outras implicações relevantes fiquem o mais próximo possível do efeito econômico e de outras implicações relevantes da referida disposição inválida, ilegal ou inexequível.
- Renúncia e tolerância. As Partes reconhecem que, salvo se de outro modo expressamente aqui previsto: (i) o exercício parcial, o não exercício, a concessão de um prazo, a tolerância ou o atraso em relação a qualquer direito concedido a elas pelo presente Contrato e/ou por Lei não deverá consistir em renovação ou renúncia a esse direito, tampouco deverá prejudicar o seu exercício no futuro; (ii) a renúncia a qualquer direito deverá ser interpretada de modo restrito e não deverá ser considerada como uma renúncia a qualquer outro direito conferido pelo presente Contrato ou por Lei a qualquer uma das Partes; e (iii) quaisquer renúncias somente serão consideradas se concedidas por escrito.
- Taxas, Tributos e Despesas. Cada uma das Partes deverá arcar com suas respectivas taxas, Tributos (e deverão entregar todas as declarações, relatórios ou outros protocolos necessários em relação a todos os Tributos) e despesas (incluindo o pagamento de quaisquer comissões e/ou representações que possam ser devidas por qualquer uma delas a terceiros, tais como corretores, agentes, negociantes, consultores ou quaisquer outras pessoas que tenham sido contratadas pela respectiva Parte, bem como os custos de registro e outros protocolos de qualquer tipo, seja qual for) relacionados à negociação e à conclusão da Transação e à preparação, assinatura e implementação do presente Contrato e de qualquer outro contrato ou documento nele contemplado, exceto se de outra forma estiver expressamente previsto neste Contrato.
- Contrato Válido e Exequível. Este Contrato foi devidamente celebrado e formalizado pelas Partes e constitui obrigação legalmente válida e vinculante. As Partes reconhecem todos os termos e condições deste Contrato, comprometendo-se a cumprir todas as suas disposições e a comunicar imediatamente as outras Partes sobre a existência de qualquer ato, fato ou omissão que possa constituir uma violação deste Contrato, bem como a tomar qualquer providência que possa vir a ser exigida para a manutenção da validade e eficácia deste Contrato.
Cláusula 15ª - A presente negociação foi intermediada pela imobiliária {{empresa_nome}}, CNPJ {{empresa_cnpj}}, CRECI {{empresa_creci}}, por meio do(a) corretor(a) {{corretor_nome}}, sendo a comissão livremente pactuada de {{comissao_pct_extenso}} sobre o valor do negócio, totalizando {{comissao_valor_extenso}}, que será paga pelos PROMITENTES CEDENTES {{comissao_quando}}, via PIX {{empresa_pix}}.
## LEI GERAL DE PROTEÇÃO DE DADOS
Cláusula 16ª – O(s) PROMISSÁRIO(S) CESSIONÁRIO(S) declara(m) expresso CONSENTIMENTO que o(s) PROMITENTE(S) CEDENTE(S) irão coletar, tratar e compartilhar os dados necessários ao cumprimento do contrato, bem como das obrigações legais, nos termos do Art. 7º, incisos II e V da LGPD.
Parágrafo único – Outros dados poderão ser coletados, tratados e compartilhados com autorização expressa do(s) PROMISSÁRIOS CESSIONÁRIOS, sendo certo ainda, que na necessidade de coleta e tratamento de dados dos CEDENTES a presente cláusula também autoriza e expressa seu consentimento.
## DO FORO DE ELEIÇÃO:
Cláusula 17ª – Fica eleito o foro da Comarca de {{cidade_foro}}, com renúncia expressa a qualquer outro, ainda que privilegiado, para que as partes possam dirimir quaisquer dúvidas ou questões oriundas deste contrato.
{{#condicoes_especiais}}## CONDIÇÕES ESPECIAIS E OBSERVAÇÕES
As Partes ajustam, ainda, as seguintes condições especiais, que prevalecem sobre as cláusulas gerais naquilo que com elas conflitarem:
{{condicoes_especiais}}
{{/condicoes_especiais}}
Por terem lido e por estarem as partes em pleno acordo com o disposto neste instrumento particular, assinam-no na presença de 02 (duas) testemunhas abaixo, em 03 (três) vias de igual teor e conteúdo, destinando-se uma via para cada uma das partes contratadas e uma para os corretores neste instrumento, para que faça a cada uma os mesmos efeitos e direitos.
---
{{cidade_foro}}, {{data_extenso}}.
## PROMITENTE(S) CEDENTE(S):
[[ASSINATURAS]]{{v1_nome}}|CPF {{v1_cpf}}{{#v2_nome}}||{{v2_nome}}|CPF {{v2_cpf}}{{/v2_nome}}
## PROMISSÁRIO(S) CESSIONÁRIO(S):
[[ASSINATURAS]]{{#pj_razao}}{{pj_razao}}|representada por {{/pj_razao}}{{c1_nome}}|CPF {{c1_cpf}}{{#c2_nome}}||{{c2_nome}}|CPF {{c2_cpf}}{{/c2_nome}}
## TESTEMUNHAS:
[[ASSINATURAS]]{{testemunha1}}|1ª testemunha||{{testemunha2}}|2ª testemunha`,
  },

  /* ──────────────────── 7. CONTRATO DE EXCLUSIVIDADE DE VENDA ──────────────────── */
  {
    id: 'exclusividade',
    titulo: 'Contrato de exclusividade de venda',
    categoria: 'Compra e venda',
    empresa: 'psm_negocios',
    arquivo: 'Contrato de exclusividade',
    papeis: { v1: 'Contratante / proprietário(a)', v2: 'Cônjuge / 2º proprietário(a)' },
    cliente: 'v1',
    padrao: { comissao_pct: '6', corretor_nome: 'Paulo Sérgio Morimatsu', corretor_creci: '188.052' },
    corpo: `# CONTRATO DE EXCLUSIVIDADE PARA INTERMEDIAÇÃO DE VENDA DE IMÓVEL
---
Pelo presente instrumento particular, de um lado:
**CONTRATANTE/PROPRIETÁRIO(A):** {{vendedores_qualificacao}}, doravante denominado(a) simplesmente CONTRATANTE;
E, de outro lado:
**CORRETORA/INTERMEDIADORA:** {{empresa_nome}}, pessoa jurídica de direito privado, inscrita no CNPJ sob nº {{empresa_cnpj}}, com inscrição no CRECI-PJ sob nº {{empresa_creci}}, com sede à {{empresa_endereco}}, neste ato representada por seu corretor responsável {{corretor_nome}}, corretor(a) de imóveis devidamente inscrito(a) no CRECI/SP sob nº {{corretor_creci}}, doravante denominada simplesmente CORRETORA;
Resolvem as partes celebrar o presente CONTRATO DE EXCLUSIVIDADE PARA INTERMEDIAÇÃO DE VENDA DE IMÓVEL, que se regerá pelos artigos 722 a 729 do Código Civil, artigo 784, inciso III, do Código de Processo Civil, pela Lei nº 6.530/78, e demais disposições legais aplicáveis, mediante as cláusulas e condições a seguir estabelecidas:
## CLÁUSULA 1ª — DA CAPACIDADE E LEGITIMIDADE
As partes declaram, sob as penas da lei:
I – Que são plenamente capazes para a prática dos atos da vida civil;
II – Que celebram o presente contrato por livre e espontânea manifestação de vontade;
III – Que o(a) CONTRATANTE é legítimo(a) proprietário(a) do imóvel objeto deste instrumento, possuindo plena disponibilidade do bem e inexistindo qualquer impedimento legal, judicial, fiscal ou contratual à sua alienação;
IV – Que o imóvel encontra-se livre e desembaraçado de quaisquer ônus, gravames, hipotecas, penhoras, usufrutos ou ações reais ou pessoais reipersecutórias, ressalvado o disposto em ato próprio escrito;
V – Que inexistem vícios de consentimento que maculem o presente negócio jurídico.
## CLÁUSULA 2ª — DO OBJETO
Constitui objeto do presente contrato a concessão de exclusividade plena e irrevogável à CORRETORA para a intermediação da venda do seguinte imóvel:
Imóvel: {{imovel_descricao}}, localizado à {{imovel_endereco}}, objeto da matrícula nº {{imovel_matricula}} do {{imovel_cartorio}}, inscrição municipal/cadastro nº {{imovel_iptu}}{{#imovel_rural}}, {{imovel_rural}}{{/imovel_rural}}.
## CLÁUSULA 3ª — DA EXCLUSIVIDADE, IRREVOGABILIDADE E IRRETRATABILIDADE
O presente contrato é celebrado em caráter IRREVOGÁVEL E IRRETRATÁVEL e terá vigência pelo prazo de 180 (cento e oitenta) dias contados a partir da data de sua assinatura, sendo certo que, decorrido esse período, caso não haja manifestação expressa de qualquer das partes em sentido contrário, com antecedência mínima de 30 (trinta) dias, o contrato passará a vigorar por prazo indeterminado, mantidas as demais condições aqui pactuadas.
§1º Durante todo o prazo contratual, a CORRETORA será a única e exclusiva autorizada a anunciar, divulgar, intermediar, apresentar propostas, conduzir visitas e negociar o imóvel objeto deste contrato.
§2º O(A) CONTRATANTE compromete-se, sob pena das sanções previstas neste instrumento, a NÃO:
a) negociar, direta ou indiretamente, o imóvel com terceiros, ainda que por meio de familiares, prepostos ou interpostas pessoas;
b) contratar outro(a) corretor(a) ou imobiliária para a intermediação do mesmo imóvel;
c) anunciar o imóvel por conta própria, em portais, redes sociais ou quaisquer outros meios;
d) concluir qualquer negócio à revelia da CORRETORA.
§3º A eventual revogação unilateral imotivada por parte do(a) CONTRATANTE não afastará o direito da CORRETORA à percepção integral da comissão pactuada, caso o negócio seja concretizado dentro do prazo contratual ou com cliente apresentado, visitado, cadastrado ou prospectado pela CORRETORA.
§4º A irrevogabilidade ora pactuada visa preservar o equilíbrio contratual, considerando os investimentos financeiros, materiais, técnicos e operacionais que a CORRETORA realizará para a promoção e divulgação do imóvel, incluindo, sem se limitar a: produção de mídia profissional (fotografia, vídeo, drone, tour virtual), campanhas publicitárias pagas, anúncios em portais especializados, ações de prospecção ativa e atendimento de clientes.
§5º — DA PRORROGAÇÃO AUTOMÁTICA POR NEGOCIAÇÃO EM ANDAMENTO. Caso, ao término do prazo contratual previsto no caput desta cláusula, exista negociação em andamento com um ou mais potenciais compradores apresentados pela CORRETORA, o presente contrato ficará automaticamente prorrogado, por igual período de 90 (noventa) dias, a contar da data do término original, nas mesmas condições ora pactuadas, independentemente de termo aditivo ou qualquer outra formalidade.
§6º Considera-se “negociação em andamento”, para os fins do parágrafo anterior, toda e qualquer tratativa ativa com potencial comprador, comprovável por qualquer meio idôneo, tais como: proposta formal apresentada por escrito, troca de mensagens (e-mail, WhatsApp ou similar), reuniões realizadas, análise de documentação do imóvel ou do comprador, due diligence em curso, pedido de elaboração de minuta, sinalização de interesse formalizada ou qualquer ato que demonstre intenção concreta de aquisição.
§7º A prorrogação prevista no §5º poderá ocorrer uma única vez, findo o qual, caso não haja manifestação expressa de qualquer das partes em sentido contrário com antecedência mínima de 30 (trinta) dias, o contrato passará a vigorar por prazo indeterminado, conforme disposto no caput desta cláusula.
## CLÁUSULA 4ª — DO VALOR DE VENDA
O valor mínimo de venda do imóvel objeto deste contrato é fixado em {{valor_extenso}}.
§1º Propostas em valor inferior ao acima estipulado somente poderão ser aceitas mediante autorização prévia, expressa e escrita do(a) CONTRATANTE.
§2º Eventual aceitação de proposta inferior não reduzirá o percentual da comissão pactuada na Cláusula 5ª deste contrato.
## CLÁUSULA 5ª — DA COMISSÃO DE CORRETAGEM
Pela intermediação do negócio, será devida à CORRETORA comissão no percentual de {{comissao_pct_extenso}} sobre o valor total da transação, a ser paga integralmente pelo(a) CONTRATANTE.
§1º A comissão será considerada devida e exigível no ato da assinatura de qualquer instrumento que formalize o negócio, seja contrato de promessa de compra e venda, instrumento particular de compromisso, escritura pública, recibo de sinal, proposta aceita por escrito ou qualquer outro documento que materialize o acordo entre as partes, ainda que sob condição suspensiva.
§2º Nos termos do artigo 725 do Código Civil, a comissão será igualmente devida ainda que o negócio não se conclua em razão de arrependimento das partes, bem como nos casos em que a CORRETORA tenha realizado a aproximação útil entre comprador e vendedor.
§3º — DA CLÁUSULA DE PROTEÇÃO PÓS-CONTRATUAL. Se o imóvel objeto deste contrato for vendido, no prazo de até 18 (dezoito) meses após o término ou rescisão deste contrato, a qualquer cliente que tenha sido apresentado, visitado, cadastrado, contatado ou prospectado pela CORRETORA durante a vigência contratual, será integralmente devida a comissão pactuada nesta cláusula, independentemente de quem tenha conduzido a fase final da negociação.
§4º Considera-se “cliente apresentado” todo aquele que tenha, durante a vigência deste contrato, recebido informações sobre o imóvel, participado de visita, reunião, troca de mensagens, ligação ou qualquer forma de negociação intermediada pela CORRETORA, bem como qualquer pessoa física ou jurídica a ele vinculada (familiares, sócios, controladores, controladas, coligadas ou prepostos).
§5º A CORRETORA manterá cadastro próprio dos clientes apresentados, o qual poderá ser apresentado a qualquer tempo, inclusive em juízo, como prova da intermediação.
§6º No caso de pagamento parcelado ao(à) CONTRATANTE, a comissão será paga integralmente no ato da assinatura do contrato de compra e venda, salvo acordo expresso e escrito em contrário.
## CLÁUSULA 6ª — DAS OBRIGAÇÕES E INVESTIMENTOS DA CORRETORA NA COMERCIALIZAÇÃO
Durante toda a vigência do presente contrato, a CORRETORA, em contrapartida à exclusividade ora conferida, assumirá as seguintes obrigações e investimentos para a adequada promoção, comercialização e formalização do negócio:
§1º — DA PRODUÇÃO DE MÍDIA PROFISSIONAL. A CORRETORA arcará, integralmente e às suas expensas, com a captação e produção de toda a mídia profissional necessária à divulgação do imóvel, incluindo, sem limitação: fotografia profissional, captação de imagens aéreas por drone, vídeo institucional, edição e tratamento de imagens, criação de materiais gráficos e demais peças publicitárias. Todo o material produzido permanecerá sob a titularidade da CORRETORA, sendo licenciado para uso exclusivo na divulgação do imóvel durante a vigência contratual.
§2º — DO INVESTIMENTO EM TRÁFEGO PAGO E PUBLICIDADE DIGITAL. Os investimentos em anúncios pagos para captação de clientes em potencial — incluindo, sem limitação, Meta Ads (Facebook/Instagram), Google Ads, plataformas imobiliárias premium e demais mídias digitais pagas — serão tratados caso a caso, podendo ser pactuados em uma das seguintes modalidades:
a) integralmente custeados pela CORRETORA, sem direito a reembolso pelo(a) CONTRATANTE;
b) integralmente custeados pelo(a) CONTRATANTE, mediante repasse prévio dos valores à CORRETORA;
c) custeados de forma compartilhada, na proporção de 50% (cinquenta por cento) para cada parte, mediante repasse prévio.
§3º A modalidade aplicável deverá ser formalizada por escrito — em termo apartado, e-mail, WhatsApp ou qualquer outro meio idôneo de comunicação eletrônica entre as partes — anteriormente ao início do investimento. Na ausência de manifestação expressa, presumir-se-á aplicável a modalidade prevista na alínea “a” do §2º acima.
§4º Em qualquer das modalidades, a estratégia de campanha, definição de público-alvo, criação dos criativos, gestão dos anúncios e mensuração de resultados serão de responsabilidade técnica e operacional exclusiva da CORRETORA.
§5º — DO LEVANTAMENTO DE CERTIDÕES E DOCUMENTOS LEGAIS. A CORRETORA se responsabilizará pelo levantamento, organização e análise prévia de todas as certidões negativas de débitos (CNDs) e demais documentos legais necessários à efetivação do negócio, abrangendo:
a) documentação do imóvel — matrícula atualizada, certidão negativa de ônus reais, certidões fiscais municipais (IPTU/ITR), certidão negativa de débitos condominiais (quando aplicável), certidões ambientais e demais documentos exigíveis;
b) documentação do(a) CONTRATANTE/VENDEDOR(A) — certidões cíveis, criminais, trabalhistas, fiscais (federal, estadual e municipal), certidões de protesto, certidões dos distribuidores das Justiças Federal e Estadual e demais documentos correlatos;
c) documentação dos eventuais COMPRADORES, submetendo-os à análise prévia de idoneidade financeira e jurídica antes da formalização do negócio, com o objetivo de mitigar riscos de inadimplemento, fraude ou litígio futuro.
§6º — DO SUPORTE JURÍDICO. A CORRETORA, por meio de escritório de advocacia parceiro previamente indicado, providenciará a elaboração e formalização de toda a documentação contratual relacionada à transação, incluindo, sem limitação: proposta formal de compra, contrapropostas, aditivos contratuais, contrato de promessa de compra e venda, instrumento particular de compromisso e demais documentos correlatos.
§7º Os honorários do escritório jurídico parceiro referentes à elaboração da documentação contratual ordinária da transação integram os investimentos da CORRETORA e não serão repassados ao(à) CONTRATANTE, ressalvadas as hipóteses de demandas judiciais, contenciosos ou serviços jurídicos extraordinários, os quais dependerão de pactuação específica e prévia entre as partes.
§8º — DA COOPERAÇÃO DO(A) CONTRATANTE. O(A) CONTRATANTE compromete-se a fornecer, com agilidade e fidedignidade, todos os documentos, informações e esclarecimentos solicitados pela CORRETORA ou pelo escritório jurídico parceiro, bem como a comparecer aos atos formais (cartórios, recolhimento de ITBI, registros, vistorias) nas datas e locais designados, sob pena de responder pelas perdas e danos decorrentes de sua omissão ou recusa injustificada.
## CLÁUSULA 7ª — DA NÃO-CIRCUNVENÇÃO (NON-CIRCUMVENTION)
Durante a vigência deste contrato e pelo prazo de proteção previsto na Cláusula 5ª, §3º, o(a) CONTRATANTE compromete-se a não contornar, ultrapassar ou prescindir, direta ou indiretamente, da atuação da CORRETORA nas relações com qualquer cliente, comprador, investidor ou interessado apresentado pela mesma.
§1º Fica expressamente vedado ao(à) CONTRATANTE, sem prévia e expressa autorização escrita da CORRETORA, negociar, celebrar contratos, formar sociedades, consórcios, condomínios, permutas ou quaisquer outras modalidades de transação com pessoas físicas ou jurídicas apresentadas pela CORRETORA.
§2º A violação desta cláusula importará nas penalidades previstas na Cláusula 8ª, sem prejuízo das perdas e danos cabíveis.
## CLÁUSULA 8ª — DA MULTA POR DESCUMPRIMENTO
O descumprimento de qualquer das obrigações previstas neste contrato, em especial das cláusulas de exclusividade e não-circunvenção, sujeitará o(a) CONTRATANTE ao pagamento de:
I – Multa compensatória equivalente ao valor integral da comissão pactuada na Cláusula 5ª, calculada sobre o valor de venda estipulado na Cláusula 4ª ou sobre o efetivo valor da transação, o que for maior;
II – Comissão integral, caso o imóvel venha a ser efetivamente vendido em descumprimento à exclusividade;
III – Reembolso integral de todas as despesas comprovadamente realizadas pela CORRETORA com a promoção, divulgação, produção de mídia e demais investimentos relacionados ao imóvel;
IV – Perdas e danos materiais e morais que se apurarem, na forma da lei.
## CLÁUSULA 9ª — DA VINCULAÇÃO A HERDEIROS, SUCESSORES E CESSIONÁRIOS
O presente contrato obriga as partes, seus herdeiros, sucessores a qualquer título, cessionários, cônjuges, companheiros e representantes legais.
§1º Em caso de falecimento do(a) CONTRATANTE, o presente contrato permanecerá plenamente válido e exigível perante o espólio e os herdeiros, devendo a comissão ser paga pelo espólio ou pelos sucessores, conforme o caso.
§2º Caso o imóvel venha a ser alienado por sucessão causa mortis, cessão de direitos hereditários, doação, integralização de capital em pessoa jurídica, partilha em divórcio ou qualquer outra forma de transferência de titularidade, será igualmente devida a comissão à CORRETORA caso reste caracterizada a intermediação, a apresentação do cliente ou a prospecção realizada durante a vigência contratual.
§3º A obrigação de pagamento da comissão possui natureza obrigacional autônoma e não se extingue com a alteração da titularidade do imóvel, vinculando os adquirentes que tenham conhecimento prévio deste contrato.
## CLÁUSULA 10ª — DA RESCISÃO
A rescisão antecipada imotivada do presente contrato por iniciativa do(a) CONTRATANTE não afastará:
I – O direito da CORRETORA à comissão integral sobre qualquer cliente apresentado, prospectado, cadastrado ou contatado durante a vigência contratual;
II – A cláusula de proteção pós-contratual prevista na Cláusula 5ª, §3º;
III – O pagamento da multa compensatória prevista na Cláusula 8ª, caso a rescisão tenha por objetivo burlar a exclusividade pactuada.
Parágrafo único. A rescisão por inadimplemento da CORRETORA dependerá de prévia notificação extrajudicial concedendo prazo mínimo de 30 (trinta) dias para a purgação da mora.
## CLÁUSULA 11ª — DA CONVERSÃO DA INTENÇÃO DE VENDA EM LOCAÇÃO
Na hipótese de o(a) CONTRATANTE, durante a vigência deste contrato ou de qualquer de suas prorrogações, alterar sua intenção de venda do imóvel para locação, a exclusividade conferida à CORRETORA permanecerá íntegra, passando a abranger automaticamente a intermediação locatícia e a administração do imóvel locado, nos seguintes termos:
§1º — DA COMISSÃO DE INTERMEDIAÇÃO LOCATÍCIA. Pela intermediação do contrato de locação, será devida à CORRETORA comissão equivalente a 100% (cem por cento) do valor do primeiro aluguel mensal, paga integralmente no ato da assinatura do contrato de locação.
§2º — DA TAXA DE ADMINISTRAÇÃO MENSAL. Pela administração mensal do imóvel locado, será devida à CORRETORA taxa equivalente a 10% (dez por cento) sobre o valor do aluguel mensal, descontada diretamente do repasse ao(à) CONTRATANTE.
§3º — DAS ATIVIDADES DE ADMINISTRAÇÃO LOCATÍCIA. A administração da locação compreenderá, sem se limitar, as seguintes atividades, todas a cargo exclusivo da CORRETORA:
a) divulgação, prospecção e seleção dos pretendentes a locatário;
b) análise cadastral, financeira e jurídica dos pretendentes a locatário e respectivos garantidores;
c) análise comercial e definição do valor locatício e demais condições contratuais;
d) avaliação, aprovação e formalização das garantias locatícias apresentadas (fiança, seguro-fiança, título de capitalização, caução ou outras), conforme o caso;
e) elaboração e formalização do contrato de locação, aditivos, renovações e demais documentos correlatos, por meio do escritório jurídico parceiro;
f) realização de vistorias de entrada, saída e periódicas, com elaboração dos respectivos laudos fotográficos e descritivos;
g) cobrança mensal dos aluguéis, encargos, IPTU, condomínio e demais despesas locatícias;
h) repasse dos valores ao(à) CONTRATANTE, deduzidos os encargos legais e a taxa de administração prevista no §2º;
i) gestão de inadimplência, envio de notificações extrajudiciais e suporte para eventuais ações judiciais cabíveis;
j) acompanhamento jurídico permanente do contrato, reajustes anuais conforme índice contratual, renovações e renegociações;
k) intermediação na resolução de questões cotidianas com o locatário (manutenções, reparos, comunicações).
§4º — DA FORMALIZAÇÃO. A administração da locação será formalizada por meio de contrato específico de administração imobiliária, o qual observará os termos e condições gerais ora pactuadas e demais cláusulas usuais do mercado, sendo as obrigações principais já desde já reconhecidas pelas partes neste instrumento.
§5º — DA EXTENSÃO DA EXCLUSIVIDADE. Aplicam-se à exclusividade locatícia, no que couber, todas as disposições do presente contrato, em especial a irrevogabilidade, a cláusula de proteção pós-contratual, a não-circunvenção, a multa por descumprimento e a vinculação a herdeiros e sucessores.
§6º — DA VENDA NA VIGÊNCIA DA LOCAÇÃO. Caso, na vigência da locação, o imóvel venha a ser vendido — seja ao próprio locatário ou a terceiros — fica integralmente devida à CORRETORA a comissão de venda na forma da Cláusula 5ª deste contrato, sem prejuízo das comissões locatícias e taxas de administração já pactuadas.
## CLÁUSULA 12ª — DA CONFISSÃO DE DÍVIDA E TÍTULO EXECUTIVO EXTRAJUDICIAL
O(A) CONTRATANTE reconhece e declara expressamente que:
I – A comissão pactuada constitui obrigação líquida, certa e exigível, configurando confissão de dívida para todos os efeitos legais;
II – O presente instrumento, assinado por duas testemunhas, constitui título executivo extrajudicial, nos termos do artigo 784, inciso III, do Código de Processo Civil, possibilitando à CORRETORA a propositura imediata de ação de execução;
III – Em caso de inadimplemento, sobre o valor devido incidirão cumulativamente:
a) correção monetária pelo IPCA (ou índice que vier a substituí-lo);
b) juros de mora de 1% (um por cento) ao mês, contados a partir da data do vencimento;
c) multa moratória de 2% (dois por cento) sobre o valor atualizado;
d) honorários advocatícios de 10% (dez por cento), na hipótese de cobrança extrajudicial, sem prejuízo dos honorários sucumbenciais em caso de cobrança judicial.
## CLÁUSULA 13ª — DA BOA-FÉ OBJETIVA E FUNÇÃO SOCIAL DO CONTRATO
O presente contrato é firmado com fundamento nos princípios da boa-fé objetiva (art. 422 do Código Civil), da função social do contrato (art. 421 do Código Civil) e da autonomia privada, obrigando as partes ao seu integral e fiel cumprimento, bem como a cooperarem mutuamente para a consecução de seu objeto.
## CLÁUSULA 14ª — DA ASSINATURA ELETRÔNICA
As partes reconhecem, desde já, a validade jurídica da assinatura eletrônica do presente contrato, realizada por meio de plataformas de assinatura digital, tais como ClickSign, DocuSign, D4Sign ou similares, inclusive aquelas baseadas em certificado digital ICP-Brasil, nos termos da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.
§1º A assinatura eletrônica produzirá os mesmos efeitos jurídicos da assinatura física, sendo o contrato considerado válido, exequível e vigente entre as partes a partir da última assinatura coletada.
§2º Alternativamente, o contrato poderá ser assinado de forma física, na presença de duas testemunhas, com igual validade.
§3º Eventuais comunicações entre as partes poderão ser realizadas por e-mail, WhatsApp ou outros meios eletrônicos, sendo consideradas válidas as enviadas aos endereços indicados no preâmbulo deste instrumento.
## CLÁUSULA 15ª — DAS DISPOSIÇÕES GERAIS
§1º — Acordo Integral. O presente instrumento representa o acordo integral entre as partes, prevalecendo sobre quaisquer entendimentos, tratativas ou contratos anteriores, verbais ou escritos, relativos ao seu objeto.
§2º — Alterações. Qualquer alteração ao presente contrato somente terá validade se feita por escrito e assinada por ambas as partes.
§3º — Cessão. Nenhuma das partes poderá ceder ou transferir os direitos e obrigações decorrentes deste contrato sem o consentimento prévio e escrito da outra, ressalvada a cessão a herdeiros e sucessores na forma da Cláusula 8ª.
§4º — Tolerância. A eventual tolerância de qualquer das partes quanto ao descumprimento das obrigações pactuadas não constituirá novação, renúncia ou modificação contratual, sendo mera liberalidade.
§5º — Disposições Inválidas. Caso qualquer disposição deste contrato venha a ser considerada inválida ou inexequível, as demais permanecerão em pleno vigor, devendo as partes negociar, de boa-fé, a substituição da disposição afetada por outra que produza efeito econômico equivalente.
§6º — Despesas. Salvo disposição expressa em contrário, cada parte arcará com suas próprias despesas relacionadas à execução deste contrato. As despesas de divulgação, produção de mídia e promoção do imóvel correrão por conta exclusiva da CORRETORA, sem direito a reembolso em caso de não concretização do negócio, salvo nas hipóteses previstas na Cláusula 7ª.
## CLÁUSULA 16ª — DO FORO
Fica eleito o foro da Comarca de São José do Rio Preto/SP, com renúncia expressa a qualquer outro, por mais privilegiado que seja, para dirimir quaisquer controvérsias oriundas do presente contrato.
{{#condicoes_especiais}}## CONDIÇÕES ESPECIAIS E OBSERVAÇÕES
As Partes ajustam, ainda, as seguintes condições especiais, que prevalecem sobre as cláusulas gerais naquilo que com elas conflitarem:
{{condicoes_especiais}}
{{/condicoes_especiais}}
E, por estarem assim justos e contratados, firmam o presente instrumento em 2 (duas) vias de igual teor e forma, ou eletronicamente conforme Cláusula 12ª, na presença de 2 (duas) testemunhas abaixo identificadas, que também o subscrevem, para que produza seus jurídicos e legais efeitos.
---
São José do Rio Preto/SP, {{data_extenso}}.
[[ASSINATURAS]]{{v1_nome}}|CONTRATANTE — CPF {{v1_cpf}}{{#v2_nome}}||{{v2_nome}}|CONTRATANTE — CPF {{v2_cpf}}{{/v2_nome}}
[[ASSINATURAS]]{{empresa_nome}}|CNPJ {{empresa_cnpj}} — CRECI-PJ {{empresa_creci}}|Representada por {{corretor_nome}} — CRECI/SP nº {{corretor_creci}}
## TESTEMUNHAS:
[[ASSINATURAS]]{{testemunha1}}|1ª testemunha||{{testemunha2}}|2ª testemunha`,
  },

  /* ─────────────────────────────── 8. FICHA DE VISITA ─────────────────────────────── */
  {
    id: 'ficha_visita',
    titulo: 'Ficha de visita',
    categoria: 'Compra e venda',
    empresa: 'psm_assessoria',
    arquivo: 'Ficha de visita',
    papeis: { c1: '1º interessado (comprador)', c2: '2º interessado' },
    pessoaCampos: ['nome', 'rg', 'cpf'],
    corpo: `# FICHA DE VISITA A IMÓVEL COM POTENCIAL COMPRADOR INTERESSADO
---
**Nome do Potencial Interessado/Comprador:** {{c1_nome}}
**RG:** {{c1_rg}}
**CPF:** {{c1_cpf}}
{{#c2_nome}}---
**Nome do Potencial Interessado/Comprador:** {{c2_nome}}
**RG:** {{c2_rg}}
**CPF:** {{c2_cpf}}
{{/c2_nome}}---
**Data da Visita:** {{data_visita_br}}
---
## Imóvel Visitado 1:
**Endereço:** {{visita1_endereco}}
**Empreendimento/condomínio:** {{visita1_empreendimento}}
**Unidade do imóvel (número ou quadra/lote):** {{visita1_unidade}}
{{#visita2_endereco}}---
## Imóvel Visitado 2:
**Endereço:** {{visita2_endereco}}
**Empreendimento/condomínio:** {{visita2_empreendimento}}
**Unidade do imóvel (número ou quadra/lote):** {{visita2_unidade}}
{{/visita2_endereco}}---
## Termos do CRECI-SP (Conselho Regional de Corretores de Imóveis de São Paulo):
1. O potencial comprador reconhece e concorda que a visita ao imóvel apresentado foi realizada por intermédio do corretor/imobiliária mencionados abaixo.
2. O potencial comprador entende que o corretor/imobiliária é o responsável pela apresentação e mediação na negociação do imóvel em questão.
3. O potencial comprador se compromete a não contatar diretamente o proprietário do imóvel ou outros corretores sem o conhecimento e consentimento do corretor/imobiliária mencionados abaixo.
4. Caso o potencial comprador decida efetuar a compra do imóvel visitado, ele se compromete a realizar a negociação por meio do corretor/imobiliária que realizou a primeira visita in loco.
5. O potencial comprador compreende que, ao adquirir o imóvel, poderá ser cobrada uma comissão de corretagem conforme estabelecido em contrato e de acordo com as práticas do mercado imobiliário.
---
**Nome do Corretor que apresentou o imóvel:** {{corretor_nome}}
**CRECI:** {{corretor_creci}}
**Imobiliária:** {{empresa_nome}}
**Contato da imobiliária:** {{empresa_fone}}
**Endereço da Imobiliária:** {{empresa_endereco}}
**CRECI:** {{empresa_creci}}
---
Ao assinar esta ficha de visita, o potencial comprador confirma ter compreendido e concordado com os termos acima mencionados, vinculando-se às práticas estabelecidas pelo CRECI-SP em relação à compra do imóvel apresentado.
---
{{cidade_foro}}, {{data_extenso}}.
[[ASSINATURAS]]{{c1_nome}}|Potencial Comprador 1{{#c2_nome}}||{{c2_nome}}|Potencial Comprador 2{{/c2_nome}}`,
  },
];
