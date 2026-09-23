/* ============================================================================
   PSM-OS v2 — Modelos PADRÃO de LOCAÇÃO do Gerador de Documentos  v88.17
   ----------------------------------------------------------------------------
   Texto oficial das minutas de locação 2026 (biblioteca "Minutas e fichas ·
   Locação" do House → Drive do Paulo). Só os "[•]" viraram campos {{...}};
   blocos "caso houver" viraram {{#campo}}…{{/campo}} (somem se vazios).
   Papéis: c = LOCATÁRIO · v = LOCADOR/PROPRIETÁRIO · f = FIADOR.

   Fontes (23/09/2026):
   - proposta_locacao   ← "PROPOSTA LOCACAO 2026"          (Drive 1UhNuNuACn-m7BPwAQVz9qD4EySjT88s3)
   - contrato_loc_res   ← "CttLocacao-Residencial2026-ok"  (Drive 1mBVuvp6GdtDVhVmoRNUyeCwUoOlSkJrB)
   - contrato_adm       ← "Minuta-ADM-PSM-2026-25_04"      (Drive 1gRvPzSm5wKbCxRK9_X1uzWc2KQFLigbU)
   - contrato_loc_com   ← "CttLocacao-Comercial-2026"      (Drive 1xYKOVp4Hbh7OuzwoJh1CSMZsaNwU5aBf)
============================================================================ */

const PAPEIS_LOCACAO = {
  c1: '1º locatário', c2: 'Cônjuge / 2º locatário',
  v1: 'Locador(a)', v2: 'Cônjuge / 2º locador(a)',
  f1: 'Fiador(a)', f2: 'Cônjuge do fiador(a)',
};

/* bloco de identificação do imóvel — igual no contrato de locação e no de administração */
const IDENT_IMOVEL = (quem) => `(a) Descrição: {{imovel_tipologia}}, endereço {{imovel_endereco}}, CEP {{imovel_cep}};
(b) Matrícula nº {{imovel_matricula}} do {{imovel_cartorio}};
(c) Código IPTU / Cadastro Municipal nº {{imovel_iptu}};
(d) Código CPFL (energia elétrica) nº {{imovel_cpfl}};
(e) Código SeMAE (água/esgoto) nº {{imovel_semae}};
{{#imovel_condominio}}(f) Administradora de condomínio: {{imovel_condominio}};
{{/imovel_condominio}}{{#imovel_senha}}(g) Senha de fechadura eletrônica: {{imovel_senha}} — informação confidencial, custodiada pela ${quem} sob sigilo, com troca obrigatória ao fim ${quem === 'ADMINISTRADORA' ? 'da locação' : 'de cada locação ou sempre que solicitado pelo CONTRATANTE'};
{{/imovel_senha}}(h) Conta corrente ${quem === 'ADMINISTRADORA' ? 'do LOCADOR para repasses' : 'em nome do CONTRATANTE para recebimentos e repasses'}: {{locador_banco}};`;

export const MODELOS_LOCACAO = [
  /* ─────────────────────────── 1. PROPOSTA DE LOCAÇÃO ─────────────────────────── */
  {
    id: 'proposta_locacao',
    titulo: 'Proposta de locação',
    categoria: 'Locação',
    empresa: 'psm_negocios_locacao',
    arquivo: 'Proposta de locação',
    papeis: PAPEIS_LOCACAO,
    valorCampo: 'aluguel',
    corpo: `# PROPOSTA DE LOCAÇÃO DE IMÓVEL
---
**IMOBILIÁRIA RESPONSÁVEL:** {{empresa_nome}} – CNPJ {{empresa_cnpj}}
**CRECI JURÍDICO:** {{empresa_creci}}
**ENDEREÇO:** {{empresa_endereco}}
**CONTATO:** {{empresa_fone}}
**E-MAIL:** {{empresa_email}}
---
O presente instrumento visa demonstrar a intenção de propor e garantir ao LOCATÁRIO INTERESSADO a locação do imóvel supra descrito pelas condições seguintes:
---
## LOCATÁRIO(S)
**NOME:** {{c1_nome}}
**RG:** {{c1_rg}}
**CPF:** {{c1_cpf}}
**DATA DE NASCIMENTO:** {{c1_nascimento_br}}
**E-MAIL:** {{c1_email}}
**ESTADO CIVIL / REGIME DE CASAMENTO:** {{c1_estado_civil_linha}}
**NACIONALIDADE:** {{c1_nacionalidade}}
**PROFISSÃO:** {{c1_profissao}}
**ENDEREÇO ATUAL:** {{c1_endereco}}
{{#c2_nome}}---
## CÔNJUGE E/OU 2º LOCATÁRIO(S)
**NOME:** {{c2_nome}}
**RG:** {{c2_rg}}
**CPF:** {{c2_cpf}}
**DATA DE NASCIMENTO:** {{c2_nascimento_br}}
**E-MAIL:** {{c2_email}}
**ESTADO CIVIL / REGIME DE CASAMENTO:** {{c2_estado_civil_linha}}
**NACIONALIDADE:** {{c2_nacionalidade}}
**PROFISSÃO:** {{c2_profissao}}
**ENDEREÇO ATUAL:** {{c2_endereco}}
{{/c2_nome}}---
## DADOS DO IMÓVEL
**NÚMERO DA MATRÍCULA:** {{imovel_matricula}}
**ENDEREÇO COMPLETO:** {{imovel_endereco}}
**CEP:** {{imovel_cep}}
**QUADRA/LOTE/NÚMERO DA UNIDADE:** {{imovel_unidade}}
---
## CONDIÇÕES DA PROPOSTA
**VALOR PROPOSTO DE LOCAÇÃO:** {{aluguel_extenso}} + despesas de condomínio e IPTU.
**FINALIDADE:** {{finalidade}}
**PRAZO DA LOCAÇÃO:** {{prazo_meses}} meses
**GARANTIA LOCATÍCIA:** {{garantia}}
*Qualquer modalidade de garantia será aceita mediante análise.
**OUTRAS CONDIÇÕES DE USO E/OU ALTERAÇÕES:** {{outras_condicoes}}
---
## LOCADOR(ES):
**NOME:** {{v1_nome}}
**RG:** {{v1_rg}}
**CPF:** {{v1_cpf}}
**DATA DE NASCIMENTO:** {{v1_nascimento_br}}
**E-MAIL:** {{v1_email}}
**ESTADO CIVIL / REGIME DE CASAMENTO:** {{v1_estado_civil_linha}}
**NACIONALIDADE:** {{v1_nacionalidade}}
**PROFISSÃO:** {{v1_profissao}}
**ENDEREÇO ATUAL:** {{v1_endereco}}
{{#v2_nome}}---
## CÔNJUGE E/OU 2º LOCADOR:
**NOME:** {{v2_nome}}
**RG:** {{v2_rg}}
**CPF:** {{v2_cpf}}
**DATA DE NASCIMENTO:** {{v2_nascimento_br}}
**E-MAIL:** {{v2_email}}
**ESTADO CIVIL / REGIME DE CASAMENTO:** {{v2_estado_civil_linha}}
**NACIONALIDADE:** {{v2_nacionalidade}}
**PROFISSÃO:** {{v2_profissao}}
**ENDEREÇO ATUAL:** {{v2_endereco}}
{{/v2_nome}}---
## CLÁUSULAS DA PROPOSTA:
1) A presente Proposta de Locação, uma vez aceita formalmente pela parte contrária (Locador ou Locatário), torna-se irrevogável e irretratável, obrigando ambas as partes aos seus termos e condições.
2) Em caso de desistência imotivada de qualquer das partes após a aceitação desta proposta, a parte desistente pagará à parte inocente uma multa compensatória no valor equivalente a 2 (dois) meses de aluguel proposto e aceito neste documento.
3) O valor da multa deverá ser pago no prazo máximo de 5 (cinco) dias corridos a contar da notificação da desistência, sem prejuízo de outras medidas cabíveis.
4) As partes reconhecem a intermediação da {{empresa_nome}}, inscrito(a) no CRECI sob o nº {{empresa_creci}}, nesta operação de locação.
5) Em caso de desistência de uma das partes após a aceitação da proposta, a parte desistente será responsável por reembolsar a imobiliária pelos serviços já prestados como: análise de crédito dos envolvidos, vistoria do imóvel terceirizada (caso já efetuada), confecção de contrato entre as partes e guia atualizada da matrícula do imóvel.
6) Pela prestação dos serviços de corretagem, o(a) Locador, pagará a imobiliária a comissão ajustada conforme acordo entre as partes, respeitando a tabela de honorários do CRECI.
7) Este documento proposta atualmente é formado por todos os conteúdos, informações e cláusulas das páginas 1 e 2.
8) Caso houver contra proposta, a mesma será formalizada e integrará a este documento inicial.
---
**VALIDADE DA PROPOSTA:** 07 dias corridos a contar a data de emissão da proposta.
**DATA DE EMISSÃO:** {{data_doc_br}}
---
Por terem lido e por estarem as partes em pleno acordo com o disposto neste instrumento, assinam-no conjuntamente com as testemunhas de forma eletrônica, por meio do certificado digital e/ou de plataformas de assinatura eletrônica, devidamente autorizadas pela Infraestrutura de Chaves Públicas Brasileira – ICP-Brasil (e.g., ClickSign), em conformidade com a MP nº 2.200-2/2001 e a Lei 14.063 e, serão consideradas como assinaturas válidas, sendo este Contrato, conforme seus próprios termos e no que for aplicável, considerado como exequível, válido e vigente entre as Partes.
---
{{cidade_foro}}, {{data_extenso}}.
## ASSINATURA DO(S) PROPONENTE(S) LOCATÁRIO(S)
[[ASSINATURAS]]{{c1_nome}}|1º LOCATÁRIO{{#c2_nome}}||{{c2_nome}}|CÔNJUGE E/OU 2º LOCATÁRIO{{/c2_nome}}
## ASSINATURA DA IMOBILIÁRIA RESPONSÁVEL PELA INTERMEDIAÇÃO
[[ASSINATURAS]]{{empresa_nome}}|Corretor(a): {{corretor_nome}}`,
  },

  /* ─────────────────────── 2. CONTRATO DE LOCAÇÃO RESIDENCIAL ─────────────────────── */
  {
    id: 'contrato_loc_res',
    titulo: 'Contrato de locação residencial',
    categoria: 'Locação',
    empresa: 'psm_assessoria_locacao',
    arquivo: 'Contrato de locação residencial',
    papeis: PAPEIS_LOCACAO,
    valorCampo: 'aluguel',
    corpo: `# CONTRATO DE LOCAÇÃO DE IMÓVEL — RESIDENCIAL URBANO
---
Pelo presente Contrato de Locação de Imóvel Residencial Urbano ("Contrato"), regido pela Lei nº 8.245/1991 (Lei do Inquilinato) e pelo Código Civil, as partes adiante qualificadas:
**LOCADOR(A):** {{locadores_qualificacao}}, doravante "LOCADOR";
**LOCATÁRIO(A):** {{locatarios_qualificacao}}, doravante "LOCATÁRIO";
{{#f1_nome}}**FIADOR(A):** {{fiadores_qualificacao}}, doravante "FIADOR".
{{/f1_nome}}**ADMINISTRADORA / INTERMEDIADORA:** {{empresa_nome}}, CNPJ {{empresa_cnpj}}, CRECI {{empresa_creci}}, com sede na {{empresa_endereco}}, doravante "PSM" ou "ADMINISTRADORA".
As partes acima, conjuntamente denominadas "Partes", têm entre si justo e contratado o presente Contrato, mediante as cláusulas e condições seguintes:
## CLÁUSULA 1 — OBJETO E IDENTIFICAÇÃO DO IMÓVEL
1.1. O LOCADOR dá em locação ao LOCATÁRIO, que aceita, o imóvel a seguir descrito ("Imóvel"), destinado exclusivamente a uso residencial:
${IDENT_IMOVEL('ADMINISTRADORA')}
{{#imovel_mobilia}}(i) Acessórios e mobília: {{imovel_mobilia}}, conforme Termo de Vistoria de Entrada lavrado nesta data e parte integrante deste Contrato.
{{/imovel_mobilia}}1.2. O LOCATÁRIO declara que vistoriou o Imóvel previamente à assinatura, conhecendo o estado em que se encontra, recebendo-o em condições de uso para a finalidade residencial, conforme descrito no Termo de Vistoria de Entrada.
1.3. O LOCADOR declara, sob as penas da lei, ser legítimo proprietário ou regularmente investido nos poderes de administração e disposição sobre o Imóvel, livre e desembaraçado de ônus que comprometam a locação, à exceção de eventual gravame declarado por escrito.
## CLÁUSULA 2 — DESTINAÇÃO E USO DO IMÓVEL
2.1. O LOCATÁRIO obriga-se a utilizar o Imóvel exclusivamente para fins residenciais, vedado uso comercial, industrial, profissional autônomo (consultórios, escritórios) ou misto, salvo prévia anuência escrita do LOCADOR.
2.2. É vedada a alteração da destinação, sob pena de infração contratual de natureza grave, autorizando a rescisão imediata, com multa proporcional na forma da Cláusula 16.
2.3. Considerar-se-ão residentes do Imóvel as pessoas declaradas pelo LOCATÁRIO em ficha cadastral, vedada habitação por número de pessoas superior à compatibilidade do Imóvel ou às normas do condomínio.
## CLÁUSULA 3 — PRAZO E PRORROGAÇÃO
3.1. O prazo da locação é de {{prazo_meses}} meses, com início em {{data_inicio_br}} e término previsto para {{data_fim_br}}.
3.2. Findo o prazo determinado, a locação se prorrogará automaticamente por prazo indeterminado caso o LOCATÁRIO continue na posse do Imóvel sem oposição do LOCADOR, nos termos do art. 46, §1º, da Lei do Inquilinato.
3.3. Durante o período de prorrogação por prazo indeterminado, qualquer das Partes poderá denunciar a locação mediante notificação escrita com 30 (trinta) dias de antecedência, sem incidência de multa rescisória.
3.4. A intenção de não renovar a locação ao final do prazo determinado será comunicada por escrito, com no mínimo 30 (trinta) dias de antecedência. Comunicação omissa enseja prorrogação por prazo indeterminado, na forma da Cláusula 3.2.
## CLÁUSULA 4 — ALUGUEL, REAJUSTE E ENCARGOS
**4.1 Aluguel**
4.1.1. O aluguel mensal é de {{aluguel_extenso}}, a ser pago pelo LOCATÁRIO até o {{dia_vencimento}}º dia do mês subsequente ao vencido, em moeda corrente nacional.
**4.2 Reajuste anual**
4.2.1. O aluguel será reajustado anualmente, na menor periodicidade legalmente admitida (atualmente anual, art. 18 da Lei nº 8.245/1991, c/c Lei nº 10.192/2001), pela seguinte cascata de indexadores: (i) IPCA/IBGE como índice principal; (ii) IVAR/FGV como subsidiário, em caso de extinção ou descontinuidade do IPCA; (iii) IGP-M/FGV como último recurso. Inviabilizados todos, as Partes negociarão de boa-fé, no prazo de 30 (trinta) dias, novo índice ou percentual fixo.
4.2.2. O reajuste incide sobre o último aluguel pago e não tem efeito retroativo.
**4.3 Encargos da locação**
4.3.1. São encargos do LOCATÁRIO: contas de consumo (energia elétrica/CPFL, água/SeMAE, gás), taxas ordinárias de condomínio, IPTU/TLP (caso transferido), tributos e multas decorrentes do uso do Imóvel.
4.3.2. São encargos do LOCADOR: taxas extraordinárias de condomínio (art. 22, X, Lei 8.245/91), reparos estruturais, IRRF sobre o aluguel quando devido.
**4.4 Forma de pagamento**
4.4.1. O aluguel e demais encargos serão pagos por meio de boleto bancário, transferência eletrônica ou PIX, em favor da ADMINISTRADORA ou diretamente ao LOCADOR, conforme indicação. A ADMINISTRADORA disponibilizará os meios de pagamento e os comprovantes em portal ou e-mail cadastrado.
4.4.2. O recebimento do aluguel após o vencimento não implica novação contratual nem renúncia ao direito de cobrança dos encargos legais ou de rescindir o Contrato.
**4.5 Mora e juros**
4.5.1. O atraso no pagamento sujeitará o LOCATÁRIO, cumulativamente, a: (i) atualização monetária pelo IPCA pro rata die; (ii) juros de mora de 1% (um por cento) ao mês; e (iii) multa moratória de 2% (dois por cento) sobre o valor em atraso, sem prejuízo da cobrança judicial e da rescisão por inadimplência.
## CLÁUSULA 5 — GARANTIA LOCATÍCIA
5.1. A garantia desta locação, dentre as modalidades do art. 37 da Lei nº 8.245/1991, é {{garantia_maiuscula}}, excluída expressamente a caução em dinheiro, e formalizada nos seguintes termos:
{{#garantia_fianca}}**5.2 Fiança**
5.2.1. O FIADOR responde solidariamente com o LOCATÁRIO por todas as obrigações deste Contrato, inclusive aluguéis, encargos, multas, indenizações, custas e honorários, até a efetiva entrega das chaves e quitação integral, prorrogando-se a fiança até o término da locação, ainda que prorrogada por prazo indeterminado, salvo notificação de exoneração nos termos do art. 40, X, e art. 835 do CC.
{{/garantia_fianca}}{{#garantia_seguro}}**5.3 Seguro-fiança**
5.3.1. Modalidade contratada junto a {{garantia_instituicao}}, apólice nº {{garantia_numero}}, vigência de {{garantia_vigencia}}, cobertura mínima de {{garantia_cobertura}} aluguéis e encargos.
5.3.2. O LOCATÁRIO obriga-se a renovar tempestivamente a apólice ao final da vigência e a comprovar a renovação à ADMINISTRADORA com antecedência mínima de 30 (trinta) dias. A não renovação caracteriza falta grave e enseja, à escolha do LOCADOR: (i) substituição da modalidade de garantia, na forma do art. 40 Lei 8.245; ou (ii) rescisão por descumprimento.
{{/garantia_seguro}}{{#garantia_titulo}}**5.4 Título de capitalização**
5.4.1. Modalidade contratada junto a {{garantia_instituicao}}, título nº {{garantia_numero}}, valor {{garantia_valor}}, com cláusula de pagamento a favor do LOCADOR em caso de inadimplência, e devolução ao LOCATÁRIO ao término da locação, observada a quitação integral.
{{/garantia_titulo}}**5.5 Substituição**
5.5.1. Qualquer alteração na modalidade de garantia depende de prévia anuência por escrito do LOCADOR, sem prejuízo do direito do LOCADOR de exigir reforço ou substituição na hipótese de falecimento, insolvência, recuperação judicial, exoneração ou inadequação superveniente da garantia (art. 40 Lei 8.245).
## CLÁUSULA 6 — SEGURO DO IMÓVEL
6.1. O LOCATÁRIO obriga-se a contratar e manter vigente, durante toda a locação, seguro contra incêndio, raio, explosão, vendaval e desmoronamento, em seguradora idônea, com cobertura mínima de {{seguro_incendio}}, figurando o LOCADOR como beneficiário, ressalvada legislação consumerista aplicável.
6.2. O LOCATÁRIO comprovará a contratação dentro de 30 (trinta) dias da assinatura e a renovação anual, sob pena de a ADMINISTRADORA contratá-lo às expensas do LOCATÁRIO, mediante prévia notificação.
6.3. O seguro de conteúdo (móveis, eletrodomésticos, objetos pessoais do LOCATÁRIO) é de exclusiva responsabilidade do LOCATÁRIO, recomendando-se, mas não exigindo-se, sua contratação.
## CLÁUSULA 7 — VISTORIA DE ENTRADA, INTERMEDIÁRIAS E SAÍDA
7.1. O Termo de Vistoria de Entrada, lavrado nesta data e assinado pelas Partes, descreve o estado do Imóvel, mobília e equipamentos, e constitui prova pré-constituída para todos os fins.
7.2. O LOCATÁRIO disporá de 5 (cinco) Dias Úteis, contados da assinatura, para impugnar fundamentadamente o Termo de Vistoria de Entrada. Decorrido o prazo sem manifestação, presume-se aceito.
7.3. A ADMINISTRADORA poderá realizar vistorias intermediárias mediante prévio agendamento com o LOCATÁRIO, com antecedência mínima de 48 (quarenta e oito) horas, em horário compatível com a rotina residencial.
7.4. Ao término da locação, será realizada Vistoria de Saída, com laudo técnico fotográfico/audiovisual. O LOCATÁRIO obriga-se a entregar o Imóvel no estado em que recebeu, ressalvado o desgaste natural pelo uso regular. Divergências serão indicadas no laudo, com prazo de 5 (cinco) Dias Úteis para impugnação fundamentada.
7.5. A entrega das chaves não substitui a Vistoria de Saída. Locatário responde pelos aluguéis e encargos até a efetiva quitação dos reparos eventualmente devidos.
## CLÁUSULA 8 — CONSERVAÇÃO, REPAROS E BENFEITORIAS
8.1. Cabe ao LOCATÁRIO a conservação ordinária do Imóvel, incluindo reparos decorrentes do uso (lâmpadas, registros, vedações, manutenção de pisos e pinturas comuns), bem como os danos causados por si, seus dependentes, prepostos ou visitantes.
8.2. Cabe ao LOCADOR os reparos estruturais (telhado, fundações, alvenaria, vícios redibitórios, problemas de origem construtiva), salvo causados por culpa do LOCATÁRIO.
8.3. Benfeitorias úteis e voluptuárias dependem de prévia anuência por escrito do LOCADOR. Salvo expressa concordância em contrário, o LOCATÁRIO renuncia a indenização e ao direito de retenção sobre benfeitorias úteis e voluptuárias (Súmula 335 STJ).
8.4. Benfeitorias necessárias serão comunicadas imediatamente ao LOCADOR e à ADMINISTRADORA. Quando devidamente autorizadas ou indispensáveis e urgentes, serão indenizadas, salvo se decorrentes de uso anormal ou culpa do LOCATÁRIO (CC, art. 1.219).
## CLÁUSULA 9 — OBRIGAÇÕES DO LOCATÁRIO
Sem prejuízo das demais obrigações deste Contrato e da Lei do Inquilinato, o LOCATÁRIO obriga-se a:
9.1. Pagar pontualmente o aluguel e os encargos.
9.2. Servir-se do Imóvel para a destinação contratada, com cuidado e diligência, e tratá-lo como se seu fosse.
9.3. Restituir o Imóvel, ao término, no estado em que o recebeu, salvo desgaste natural.
9.4. Comunicar imediatamente ao LOCADOR e à ADMINISTRADORA qualquer dano ou defeito que demande reparo de responsabilidade do LOCADOR.
9.5. Permitir vistoria do Imóvel, mediante agendamento prévio, conforme Cláusula 7.
9.6. Cumprir o regulamento interno do condomínio (caso houver) e respeitar as normas de vizinhança.
9.7. Realizar a transferência da titularidade da conta de energia elétrica (CPFL) para seu nome, no prazo de 30 (trinta) dias contados do início da locação.
9.8. Não sublocar, ceder ou emprestar o Imóvel, no todo ou em parte, sem prévia anuência escrita do LOCADOR.
9.9. Manter atualizados, perante a ADMINISTRADORA, seus dados cadastrais e os dos residentes do Imóvel.
9.10. Não realizar atividades incompatíveis com a destinação residencial, nem armazenar materiais inflamáveis, tóxicos ou ilícitos.
## CLÁUSULA 10 — OBRIGAÇÕES DO LOCADOR
10.1. Entregar o Imóvel em estado de servir ao uso residencial, com instalações em funcionamento adequado.
10.2. Garantir, durante a locação, o uso pacífico do Imóvel pelo LOCATÁRIO.
10.3. Responder pelos vícios ou defeitos anteriores à locação.
10.4. Pagar as taxas extraordinárias de condomínio (art. 22, X, Lei 8.245/91) e tributos cuja transferência ao LOCATÁRIO não esteja prevista.
10.5. Manter atualizada, perante a ADMINISTRADORA, sua documentação cadastral, dados bancários e endereço de notificação.
10.6. Comunicar previamente qualquer ato de alienação, oneração ou inventário relativo ao Imóvel.
## CLÁUSULA 11 — CESSÃO, SUBLOCAÇÃO E EMPRÉSTIMO
11.1. Vedadas a cessão deste Contrato e a sublocação, total ou parcial, do Imóvel, salvo prévia anuência escrita do LOCADOR, que não a recusará sem motivo razoável.
11.2. Igualmente vedados o empréstimo do Imóvel, o uso por terceiros não declarados em ficha cadastral e a hospedagem onerosa eventual (incluindo plataformas de aluguel por temporada como Airbnb, Booking e similares), salvo autorização expressa por escrito do LOCADOR.
## CLÁUSULA 12 — RESCISÃO ANTECIPADA E MULTA
12.1. O LOCATÁRIO poderá rescindir o presente Contrato antes do prazo, mediante notificação escrita com antecedência mínima de 30 (trinta) dias, sujeitando-se ao pagamento de multa equivalente a 3 (três) aluguéis vigentes na data da rescisão, reduzida proporcionalmente ao período já cumprido, na forma do art. 4º da Lei nº 8.245/1991 e da Súmula 412 do STJ.
12.2. A multa será dispensada exclusivamente nas hipóteses do art. 4º, parágrafo único, da Lei do Inquilinato, especialmente em caso de transferência laboral do LOCATÁRIO para localidade diversa, comprovada com 30 dias de antecedência.
12.3. O descumprimento de qualquer cláusula deste Contrato — não-pagamento, mudança de destinação, sublocação não autorizada, recusa de vistoria, falta de seguro, danos relevantes — autoriza o LOCADOR a rescindir o Contrato, com cobrança da multa proporcional e demais perdas e danos, na forma da Lei nº 8.245/1991.
## CLÁUSULA 13 — INADIMPLÊNCIA E DESPEJO
13.1. O não pagamento do aluguel ou de qualquer encargo na data ajustada autoriza, independentemente de notificação prévia, a cobrança extrajudicial e judicial dos valores em atraso, atualizados, com juros, multa e honorários.
13.2. O LOCADOR poderá ajuizar ação de despejo por falta de pagamento, cumulada com cobrança, com pedido de liminar nos termos do art. 59, §1º, IX, da Lei nº 8.245/1991, quando configurada hipótese legal.
13.3. Faculta-se ao LOCATÁRIO emendar a mora nos termos do art. 62 da Lei do Inquilinato, observados os limites legais quanto à frequência.
13.4. Vedação à auto-tutela. É expressamente vedado ao LOCADOR ou a quem por ele atue adentrar o Imóvel mediante força, arrombamento ou medidas extrajudiciais coercitivas. A reintegração da posse, em caso de abandono, ocupação irregular ou inadimplência, dar-se-á exclusivamente pela via judicial competente.
13.5. Abandono do Imóvel. Considera-se abandono a desocupação do Imóvel sem aviso prévio, com inadimplemento superior a 30 (trinta) dias, ausência de comunicação do LOCATÁRIO, devendo o fato ser comprovado por meio de notificação escrita seguida de constatação cartorária ou ação judicial específica.
## CLÁUSULA 14 — ALIENAÇÃO DO IMÓVEL E PREFERÊNCIA DO LOCATÁRIO
14.1. Em caso de pretensão do LOCADOR de alienar o Imóvel, o LOCATÁRIO terá preferência na aquisição em igualdade de condições com terceiros, nos termos dos arts. 27 a 34 da Lei nº 8.245/1991.
14.2. O LOCADOR comunicará ao LOCATÁRIO, por escrito, a melhor proposta recebida, contendo preço, condições, forma de pagamento e prazo. O LOCATÁRIO disporá de 30 (trinta) dias para manifestação inequívoca de exercício da preferência.
14.3. Não exercida a preferência, o LOCADOR fica livre para alienar o Imóvel a terceiros. Em locação por prazo determinado e cláusula de vigência averbada na matrícula, o adquirente respeitará o prazo restante (art. 8º, §1º, Lei 8.245/91).
## CLÁUSULA 15 — INTERMEDIAÇÃO E ADMINISTRAÇÃO PSM
15.1. A presente locação foi intermediada pela ADMINISTRADORA, na qualidade de mandatária do LOCADOR, em decorrência de Contrato de Prestação de Serviços de Administração de Imóvel celebrado em separado entre LOCADOR e ADMINISTRADORA.
15.2. A ADMINISTRADORA atua como receptora dos aluguéis e encargos, repassando-os ao LOCADOR, mediante prévia dedução da Taxa de Administração e da Comissão de Intermediação devidas, conforme aquele instrumento.
15.3. Comunicações, notificações, solicitações de manutenção e demais relacionamentos cotidianos entre LOCATÁRIO e LOCADOR serão feitos preferencialmente por intermédio da ADMINISTRADORA, nos canais indicados na Cláusula 18.
15.4. O LOCATÁRIO declara estar ciente do papel da ADMINISTRADORA e do fluxo de pagamento por ela operado.
## CLÁUSULA 16 — PROTEÇÃO DE DADOS PESSOAIS (LGPD)
16.1. As Partes obrigam-se a observar a Lei nº 13.709/2018 (LGPD), tratando dados pessoais de LOCADOR, LOCATÁRIO, FIADOR (caso houver), dependentes e prepostos exclusivamente para as finalidades de execução deste Contrato, cumprimento de obrigação legal/regulatória e exercício regular de direitos.
16.2. São controladores conjuntos o LOCADOR e a ADMINISTRADORA, cada qual respondendo pelo tratamento que executar autonomamente; a ADMINISTRADORA atua como operadora quando processar dados sob orientação específica do LOCADOR.
16.3. Bases legais: execução de contrato (art. 7º, V), cumprimento de obrigação legal/regulatória (art. 7º, II), legítimo interesse (art. 7º, IX) para prevenção a fraudes e cobrança, e consentimento (art. 7º, I) para finalidades específicas.
16.4. Os dados pessoais serão retidos enquanto durar a relação contratual e por mais 5 (cinco) anos após o término, ou pelo prazo exigido por lei.
16.5. Em caso de incidente de segurança envolvendo dados pessoais, a Parte que tomar conhecimento comunicará a outra em até 24 (vinte e quatro) horas, e a ADMINISTRADORA notificará a ANPD na forma do art. 48 da LGPD quando aplicável.
16.6. Os direitos dos titulares previstos no art. 18 da LGPD serão atendidos pela ADMINISTRADORA no prazo legal (15 dias).
## CLÁUSULA 17 — COMPLIANCE, PLD-FT E ANTICORRUPÇÃO
17.1. As Partes declaram conhecer e cumprir a Lei nº 9.613/1998 (PLD-FT), a Resolução COFECI nº 36/2022 e a Lei nº 12.846/2013 (Anticorrupção), abstendo-se de qualquer prática vedada por essas normas, próprias ou de terceiros vinculados a este Contrato.
17.2. As Partes declaram ser ou não ser PEP (Pessoa Exposta Politicamente, Resolução COAF nº 40/2021) e identificar beneficiário final quando pessoa jurídica.
17.3. As Partes autorizam a ADMINISTRADORA a comunicar ao COAF/SISCOAF, independentemente de aviso prévio, operações ou propostas que se enquadrem nas hipóteses de comunicação obrigatória.
17.4. Sanções Internacionais. As Partes declaram não constar de listas de sanções OFAC, ONU, União Europeia, e comprometem-se a não realizar operações com pessoas listadas.
## CLÁUSULA 18 — NOTIFICAÇÕES E COMUNICAÇÕES
18.1. Todas as comunicações, avisos e notificações entre as Partes deverão ser feitas por escrito, considerando-se válidas quando enviadas: (i) por carta registrada com aviso de recebimento; (ii) por e-mail com confirmação de recebimento; ou (iii) por meio de plataforma de assinatura eletrônica com trilha de auditoria.
18.2. Endereços para notificação:
(a) LOCADOR: endereço constante do preâmbulo — e-mail {{v1_email}};
(b) LOCATÁRIO: endereço do Imóvel locado e/ou o constante do preâmbulo — e-mail {{c1_email}};
{{#f1_nome}}(c) FIADOR: endereço do preâmbulo — e-mail {{f1_email}};
{{/f1_nome}}(d) ADMINISTRADORA: Av. Anísio Haddad, 8001, Torre Madri Sul, sala 03, São José do Rio Preto/SP, CEP 15091-751 — telefone (17) 99661-2193 — e-mail locacao@imobiliariapsm.com.br.
18.3. A alteração de endereço de notificação dependerá de prévia comunicação por escrito, com 10 (dez) dias de antecedência. A ausência de atualização autoriza a notificação válida no último endereço cadastrado.
## CLÁUSULA 19 — DEVOLUÇÃO DAS CHAVES E ENCERRAMENTO
19.1. A devolução das chaves somente se efetivará mediante: (i) Vistoria de Saída concluída e quitação de eventuais reparos; (ii) apresentação de comprovantes de pagamento de IPTU, condomínio, energia, água e gás até a data da entrega; (iii) baixa da titularidade nas concessionárias; e (iv) quitação integral de aluguéis e encargos.
19.2. Não se considera entregue o Imóvel pelo simples abandono das chaves em qualquer local. Persiste a obrigação de pagamento dos aluguéis e encargos enquanto não cumpridos os requisitos da Cláusula 19.1.
## CLÁUSULA 20 — DISPOSIÇÕES GERAIS
20.1. Acordo Integral. Este Contrato representa o acordo integral entre as Partes e prevalece sobre quaisquer entendimentos verbais ou escritos anteriores.
20.2. Alterações. Qualquer alteração somente terá eficácia se formalizada por escrito e assinada pelas Partes, sob a forma de Aditivo Contratual numerado.
20.3. Cessão. Nenhuma das Partes poderá ceder direitos ou obrigações sem prévio consentimento por escrito da outra, salvo na hipótese de alienação do Imóvel pelo LOCADOR (Cláusula 14).
20.4. Disposições Inválidas. A eventual invalidade de uma cláusula não afetará as demais; as Partes substituirão a cláusula inválida, em boa-fé, por disposição válida que preserve o equilíbrio econômico original.
20.5. Tolerância. A tolerância ou o atraso no exercício de direito não implica renúncia, sendo eficaz apenas a renúncia expressa e por escrito.
20.6. Direitos Cumulativos. Os direitos previstos neste Contrato são cumulativos com os direitos previstos em lei.
20.7. Força Executiva. As obrigações deste Contrato, em especial os aluguéis, encargos, multas e indenizações, têm força executiva extrajudicial, autorizando o ajuizamento de ação executiva (CPC, art. 784, III).
20.8. Força Maior. Caso fortuito e força maior, devidamente comprovados, suspendem as obrigações afetadas pelo período do impedimento, devendo a Parte impactada notificar a outra em até 5 (cinco) Dias Úteis.
20.9. Assinatura Eletrônica. As Partes reconhecem como válida a assinatura por meio de certificado digital ICP-Brasil e/ou plataformas de assinatura eletrônica autorizadas (e.g., ClickSign, DocuSign, Autentique), nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020.
20.10. Lei de Regência. Este Contrato é regido e interpretado pelas leis da República Federativa do Brasil, em especial pela Lei nº 8.245/1991 (Lei do Inquilinato) e pelo Código Civil.
## CLÁUSULA 21 — SOLUÇÃO DE CONTROVÉRSIAS E FORO
21.1. Surgida controvérsia, as Partes se comprometem a tentar, previamente à via judicial, resolução por mediação presencial ou eletrônica, no prazo de 30 (trinta) dias da notificação inaugural, perante câmara de mediação reconhecida ou mediador particular de comum acordo, custos rateados.
21.2. Frustrada a mediação, fica eleito o Foro da Comarca de São José do Rio Preto/SP, com renúncia a qualquer outro, por mais privilegiado que seja, para dirimir as questões oriundas deste Contrato.
## CLÁUSULA 22 — FUNDAMENTAÇÃO DO CONTRATO
As Partes registram, para fins de interpretação deste Contrato, os seguintes:
(A) Que o LOCADOR é proprietário ou regularmente investido nos poderes de administração e disposição sobre o Imóvel, encontrando-se a documentação dominial regular;
(B) Que o LOCATÁRIO declara ter visitado e vistoriado o Imóvel, conhecendo seu estado de conservação, e tem interesse em utilizá-lo para fins residenciais nos termos pactuados;
(C) Que a ADMINISTRADORA é sociedade empresária especializada em intermediação imobiliária e administração de locações, regularmente inscrita no CRECI/SP sob nº {{empresa_creci}};
(D) Que as Partes celebram o presente Contrato no exercício de sua liberdade e autonomia contratual (arts. 421 e 421-A do Código Civil), cientes do dever de boa-fé objetiva (art. 422);
(E) Que este Contrato observará a Lei nº 8.245/1991 (Lei do Inquilinato), o Código Civil, a Lei nº 13.709/2018 (LGPD), a Lei nº 9.613/1998 e a Resolução COFECI nº 36/2022 (PLD-FT), a Lei nº 12.846/2013 (Anticorrupção) e demais normas aplicáveis.
## CLÁUSULA 23 — DEFINIÇÕES E INTERPRETAÇÃO
23.1. Para os fins deste Contrato, os termos abaixo, sempre que utilizados em letra inicial maiúscula, terão os seguintes significados:
"ADMINISTRADORA" significa {{empresa_nome}}, na qualidade de mandatária do LOCADOR;
"ANPD" significa Autoridade Nacional de Proteção de Dados;
"Aluguel" significa o valor mensal previsto na Cláusula 4.1.1, reajustado anualmente conforme a Cláusula 4.2;
"Dia Útil" significa qualquer dia, exceto sábados, domingos e feriados nacionais, estaduais (SP) ou municipais (São José do Rio Preto/SP);
"Imóvel" significa o bem identificado na Cláusula 1;
"Lei do Inquilinato" significa a Lei nº 8.245/1991;
"LGPD" significa a Lei nº 13.709/2018;
"PEP" significa Pessoa Exposta Politicamente, conforme Resolução COAF nº 40/2021;
"PLD-FT" significa Prevenção à Lavagem de Dinheiro e ao Financiamento do Terrorismo;
"Termo de Vistoria" significa o laudo descritivo do estado do Imóvel, lavrado nas datas de entrada, intermediárias e saída;
23.2. Os títulos têm função meramente referencial. As referências a leis e regulamentos compreendem suas alterações e sucessoras. Prazos em "dias" são corridos, salvo se expressamente indicados como Dias Úteis.
{{#condicoes_especiais}}## CONDIÇÕES ESPECIAIS E OBSERVAÇÕES
As Partes ajustam, ainda, as seguintes condições especiais, que prevalecem sobre as cláusulas gerais naquilo que com elas conflitarem:
{{condicoes_especiais}}
{{/condicoes_especiais}}
---
E, por estarem assim justos e contratados, as Partes assinam o presente Contrato, na presença das testemunhas abaixo identificadas.
São José do Rio Preto/SP, {{data_extenso}}.
## LOCADOR(A)
[[ASSINATURAS]]{{v1_nome}}|CPF {{v1_cpf}}{{#v2_nome}}||{{v2_nome}}|CPF {{v2_cpf}}{{/v2_nome}}
## LOCATÁRIO(A)
[[ASSINATURAS]]{{c1_nome}}|CPF {{c1_cpf}}{{#c2_nome}}||{{c2_nome}}|CPF {{c2_cpf}}{{/c2_nome}}
{{#f1_nome}}## FIADOR(A)
[[ASSINATURAS]]{{f1_nome}}|CPF {{f1_cpf}}{{#f2_nome}}||{{f2_nome}}|CPF {{f2_cpf}}{{/f2_nome}}
{{/f1_nome}}## ADMINISTRADORA
[[ASSINATURAS]]{{empresa_nome}}|Representante Legal: {{empresa_representante}}
## TESTEMUNHAS
[[ASSINATURAS]]{{testemunha1}}|1ª testemunha||{{testemunha2}}|2ª testemunha`,
  },

  /* ─────────────────── 3. CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO ─────────────────── */
  {
    id: 'contrato_adm',
    titulo: 'Contrato de administração de locação',
    categoria: 'Locação',
    empresa: 'psm_assessoria_locacao',
    arquivo: 'Contrato de administração de imóvel',
    papeis: { ...PAPEIS_LOCACAO, v1: 'Contratante / proprietário(a)', v2: 'Cônjuge / 2º proprietário(a)' },
    cliente: 'v1',
    valorCampo: 'aluguel',
    corpo: `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ADMINISTRAÇÃO DE IMÓVEL — LOCAÇÃO
---
Pelo presente Contrato de Prestação de Serviços de Administração de Imóvel ("Contrato"), as partes adiante qualificadas e identificadas como "Partes" — quando referidas conjuntamente — ou "Parte" — individualmente:
**CONTRATADA / ADMINISTRADORA:** {{empresa_nome}}, sociedade empresária limitada inscrita no CNPJ/MF sob nº {{empresa_cnpj}}, com sede na {{empresa_endereco}}, registrada no CRECI/SP sob nº {{empresa_creci}}, doravante "CONTRATADA" ou "PSM", neste ato representada por seu Representante Legal devidamente constituído nos termos de seu contrato social;
**CONTRATANTE / PROPRIETÁRIO:** {{locadores_qualificacao}}, doravante "CONTRATANTE";
Têm entre si justo e contratado o presente Contrato, que se regerá pelas seguintes cláusulas e condições:
## CLÁUSULA 1 — OBJETO E IDENTIFICAÇÃO DO IMÓVEL
1.1. O presente Contrato tem por objeto a prestação, pela CONTRATADA, de serviços de administração imobiliária e intermediação locatícia sobre o Imóvel, de propriedade do CONTRATANTE — destinado a uso {{uso_imovel}} —, incluindo: (a) captação, análise cadastral e seleção de Locatário; (b) negociação e celebração do Contrato de Locação; (c) gestão da Garantia Locatícia; (d) recebimento e repasse de aluguéis e encargos; (e) realização de vistorias; (f) prestação de contas; (g) defesa administrativa dos interesses do CONTRATANTE perante terceiros; e (h) demais atos compatíveis com a finalidade locatícia, observada a Lei nº 8.245/1991, que rege tanto locações residenciais quanto não residenciais.
1.2. Identificação do Imóvel:
${IDENT_IMOVEL('CONTRATADA')}
1.3. O CONTRATANTE declara, sob as penas da lei, ser legítimo proprietário ou detentor de poderes regulares de administração e disposição sobre o Imóvel, comprometendo-se a manter atualizada a documentação dominial e a comunicar imediatamente à CONTRATADA qualquer ato que afete a titularidade ou disponibilidade do bem (transferência, gravame, penhora, arresto, inventário, ação real ou possessória).
## CLÁUSULA 2 — MANDATO E OUTORGA DE PODERES
2.1. O CONTRATANTE outorga à CONTRATADA mandato remunerado, com poderes especiais para: contratar, aditar, prorrogar e rescindir Contratos de Locação; receber chaves e imitir-se na posse, sempre com prévia ciência do CONTRATANTE; veicular anúncios; receber aluguéis e encargos, fornecer recibos e dar quitação; realizar lançamentos de débito e crédito na conta do Imóvel; aplicar reajustes legais e contratuais; representar o CONTRATANTE perante repartições públicas, concessionárias, condomínio e cartórios; e, mediante prévia anuência por escrito do CONTRATANTE, contratar advogado e ajuizar ou contestar ações relativas à locação.
2.2. A outorga é limitadamente irrevogável durante o período de captação ativa do Locatário e enquanto vigente Contrato de Locação intermediado pela CONTRATADA, nos termos do art. 684 do Código Civil, sem prejuízo da rescisão prevista na Cláusula 14. Os poderes não autorizam alienação, oneração ou cessão do Imóvel, nem o recebimento de valores fora do escopo locatício, salvo procuração em separado.
2.3. Para o ajuizamento de ações em face do Locatário e/ou fiadores (caso houver), o CONTRATANTE outorgará procuração específica ao advogado indicado e por ele aprovado, arcando com honorários e custas na forma da Cláusula 7.
2.4. A revogação do mandato fora das hipóteses de justa causa, durante o período de irrevogabilidade limitada (Cláusula 2.2), sujeitará o CONTRATANTE à indenização prevista na Cláusula 14.4.
## CLÁUSULA 3 — RECEBIMENTO DO IMÓVEL E VISTORIA
3.1. A CONTRATADA recebe nesta data o Imóvel em condições de uso, conforme Termo de Vistoria de Entrada lavrado e assinado pelas Partes, parte integrante e indissociável deste Contrato.
3.2. As vistorias de entrada e saída serão realizadas pela CONTRATADA, presencialmente ou por laudo técnico fotográfico/audiovisual com geolocalização. O CONTRATANTE disporá de 5 (cinco) Dias Úteis para impugnação fundamentada de cada laudo; transcorrido o prazo sem manifestação, presume-se aceito. Vistorias intermediárias serão admitidas mediante prévio agendamento com o Locatário, com 48 (quarenta e oito) horas de antecedência.
3.3. Vistorias especiais (sinistro, dano relevante, perícia judicial) serão remuneradas em separado, mediante orçamento prévio aprovado por escrito pelo CONTRATANTE.
3.4. A CONTRATADA é depositária das chaves do Imóvel durante o período em que o Imóvel estiver sob sua administração, respondendo por extravio decorrente de culpa ou dolo.
## CLÁUSULA 4 — REMUNERAÇÃO E EXCLUSIVIDADE
**4.1 Taxa de Administração**
4.1.1. Pela administração do Imóvel será devida à CONTRATADA a Taxa de Administração de {{taxa_adm_pct_extenso}} sobre o valor bruto mensal do aluguel efetivamente recebido, deduzida diretamente no momento do repasse, conforme a Cláusula 6.
4.1.2. A Taxa de Administração será reajustada anualmente, na mesma data e pelo mesmo índice aplicado ao aluguel.
**4.2 Comissão de Intermediação**
4.2.1. Pela intermediação na celebração do Contrato de Locação, será devida à CONTRATADA Comissão de Intermediação equivalente a 01 (um) aluguel mensal vigente, a cada novo Contrato de Locação firmado, observado o art. 725 do Código Civil. A Comissão é devida com a assinatura do Contrato de Locação.
4.2.2. Caso o CONTRATANTE celebre Contrato de Locação diretamente com Locatário apresentado pela CONTRATADA — ou com pessoa de seu núcleo familiar, sócio ou empresa relacionada — em até 12 (doze) meses da apresentação, a Comissão de Intermediação será integralmente devida.
**4.3 Exclusividade na recolocação**
4.3.1. A cada desocupação do Imóvel, a CONTRATADA terá exclusividade pelo prazo de 60 (sessenta) dias, contados da efetiva entrega das chaves, para captação e celebração de novo Contrato de Locação. Durante esse período, fica vedado ao CONTRATANTE celebrar contrato de locação com terceiros — diretamente, por intermédio de outra imobiliária ou corretor — sob pena de incidência integral da Comissão de Intermediação prevista na Cláusula 4.2.1, devida à CONTRATADA.
4.3.2. Enquanto vigente este Contrato, a CONTRATADA mantém-se a única intermediadora autorizada da locação do Imóvel. Caso o CONTRATANTE pretenda contratar outros intermediários, deverá previamente rescindir este Contrato nos termos da Cláusula 14, sob pena de incidência integral da Comissão de Intermediação.
## CLÁUSULA 5 — VALOR DO ALUGUEL E REAJUSTE
5.1. O valor mensal inicial proposto para a locação será de {{aluguel_extenso}}, podendo sofrer ajustes mediante anuência expressa do CONTRATANTE antes da assinatura do Contrato de Locação.
5.2. Os reajustes anuais observarão a seguinte cascata: (i) IPCA/IBGE como índice principal; (ii) IVAR/FGV como subsidiário; (iii) IGPM/FGV como último recurso. Inviabilizados todos, as Partes negociarão, em boa-fé, novo índice ou percentual fixo, no prazo de 30 (trinta) dias.
5.3. Os reajustes ocorrerão na menor periodicidade legalmente admitida (atualmente anual, art. 18 da Lei nº 8.245/1991, c/c Lei nº 10.192/2001).
## CLÁUSULA 6 — RECEBIMENTO, REPASSE E CONTA VINCULADA
6.1. A CONTRATADA receberá os aluguéis e encargos por meio de Conta Vinculada, mantendo segregação patrimonial dos recursos próprios. Os valores recebidos pertencem ao CONTRATANTE e são apenas custodiados pela CONTRATADA para fins de repasse e prestação de contas.
6.2. O repasse, deduzidas a Taxa de Administração e despesas comprovadamente incorridas no interesse do Imóvel, ocorrerá em até 5 (cinco) Dias Úteis do efetivo recebimento, mediante transferência eletrônica ou PIX para a conta indicada pelo CONTRATANTE em ficha cadastral.
6.3. O atraso no repasse, por culpa exclusiva da CONTRATADA, importará atualização monetária pelo IPCA, juros de 1% (um por cento) ao mês e multa moratória de 2% (dois por cento), compensáveis na próxima Taxa de Administração devida.
6.4. O CONTRATANTE poderá, mediante aviso de 15 (quinze) Dias Úteis, exercer direito de auditoria sobre os registros do Imóvel, às suas expensas, em horário comercial e sem prejuízo da operação da CONTRATADA. Qualquer divergência apurada será corrigida em até 10 (dez) Dias Úteis.
6.5. Anualmente, a CONTRATADA remeterá ao CONTRATANTE o informe consolidado dos rendimentos para fins de IRPF/IRRF e DIMOB, observada a legislação tributária aplicável.
## CLÁUSULA 7 — DESPESAS, HONORÁRIOS E AÇÕES JUDICIAIS
7.1. Correm por conta do CONTRATANTE as despesas com cobrança extrajudicial, custas processuais, honorários advocatícios e periciais decorrentes de ações relacionadas à locação (despejo por falta de pagamento, execução, cobrança de reparos, despejo para uso próprio, renovatória, revisional e congêneres), isentando-se a CONTRATADA de quaisquer custos, despesas, honorários advocatícios e/ou condenações por ventura ocasionadas, ressalvada a hipótese de dolo ou culpa comprovada da CONTRATADA, caso em que responderá proporcionalmente à sua participação, nos termos dos arts. 186, 422, 667 e 668 do Código Civil.
7.2. A CONTRATADA envidará seus melhores esforços em medidas administrativas prévias para evitar o ajuizamento, mantendo o CONTRATANTE informado por relatório bimestral.
## CLÁUSULA 8 — OBRIGAÇÕES DA CONTRATADA
Constituem obrigações da CONTRATADA, sem prejuízo de outras decorrentes da legislação e da boa-fé contratual:
8.1. Divulgar o Imóvel nos meios pertinentes (portais imobiliários, redes sociais profissionais e canais próprios), com material compatível com o padrão do Imóvel.
8.2. Selecionar Locatário e fiadores (caso houver) mediante análise criteriosa de capacidade financeira, idoneidade cadastral (SPC, Serasa, Receita Federal, tribunais) e referências, observando os requisitos de KYC e PEP descritos na Cláusula 13.
8.3. Avaliar com o CONTRATANTE, previamente a cada novo Contrato de Locação, a modalidade de Garantia Locatícia mais adequada dentre as previstas no art. 37 da Lei nº 8.245/1991: (i) fiança (caso houver fiador disponível); (ii) seguro-fiança; ou (iii) título de capitalização, vedada a exigência cumulativa de mais de uma modalidade e excluída expressamente a modalidade de caução em dinheiro. A escolha será formalizada por escrito.
8.4. Receber aluguéis e encargos, repassar nos prazos da Cláusula 6 e prestar contas mensais.
8.5. Realizar vistoria de entrada e saída e vistorias intermediárias, conforme a Cláusula 3.
8.6. Comunicar imediatamente ao CONTRATANTE qualquer notificação, intimação, citação, autuação ou demanda relacionada ao Imóvel ou à locação.
8.7. Cumprir as obrigações decorrentes da Lei nº 8.245/1991, do Código Civil, da LGPD, da Lei nº 9.613/1998 e da Resolução COFECI nº 36/2022 (PLD-FT), e demais normas aplicáveis ao setor.
8.8. Atuar como agente independente, sem vínculo empregatício, societário ou de subordinação com o CONTRATANTE; é vedado à CONTRATADA representar simultaneamente locador e Locatário no mesmo Contrato de Locação sem expressa ciência das Partes.
8.9. Subcontratação. A CONTRATADA poderá subcontratar serviços operacionais (vistoria, limpeza, manutenção, advocacia para cobrança), permanecendo solidariamente responsável perante o CONTRATANTE pelos atos dos subcontratados, ressalvada a Cláusula 7.1.
8.10. Ao final da relação, a CONTRATADA prestará serviços de transição (handover) por até 30 (trinta) dias, transferindo de forma ordenada à nova administradora ou ao CONTRATANTE: chaves, contratos, ficha cadastral do Locatário, históricos financeiros, vistorias, dados do condomínio e qualquer documentação relevante.
**8.11 Valor agregado da administração profissional**
8.11.1. As Partes reconhecem que a gestão cotidiana de Locatário — atendimento de demandas, vistorias periódicas, mediação de conflitos, cobrança de aluguéis e encargos em atraso, articulação com condomínio e concessionárias, manutenção corretiva e preventiva, vistorias de entrada e saída e devolução de chaves — é notoriamente trabalhosa e desgastante para o proprietário que opta por administrar seu Imóvel diretamente, exigindo disponibilidade, conhecimento técnico, jurídico e psicológico, além de tempo significativo.
8.11.2. Ao contratar a CONTRATADA, o CONTRATANTE transfere integralmente a operação descrita acima a equipe especializada, sistemas próprios e protocolos profissionais, beneficiando-se de: (i) isolamento operacional — todas as solicitações do Locatário transitam pela CONTRATADA, preservando a tranquilidade do CONTRATANTE; (ii) disciplina financeira — recebimento, repasse e prestação de contas com tempestividade e rastreabilidade; (iii) redução de litígio — análise cadastral robusta, contratos bem redigidos e mediação prévia minimizam ações judiciais; (iv) rede técnica — fornecedores qualificados, vistoriadores e advogados especializados; (v) compliance e proteção de dados — observância obrigatória de LGPD, PLD-FT e demais regulamentações.
## CLÁUSULA 9 — OBRIGAÇÕES DO CONTRATANTE
Constituem obrigações do CONTRATANTE:
9.1. Cumprir as cláusulas deste Contrato e do Contrato de Locação intermediado pela CONTRATADA.
9.2. Manter atualizados, perante a CONTRATADA, seus dados cadastrais, endereço, telefone, e-mail e dados bancários, sob pena de serem considerados válidos os constantes da última ficha cadastral para todos os fins, inclusive notificações, comunicações e citações.
9.3. Manter o Imóvel em condições adequadas ao uso destinado (residencial, comercial ou industrial, conforme o caso), incluindo habitabilidade quando residencial e funcionalidade quando não residencial, custeando reparos estruturais, salvo mútuo acordo em contrário.
9.4. Acompanhar e assinar — quando convocado — as vistorias, sob pena de aceitação tácita do laudo elaborado pela CONTRATADA, observado o prazo da Cláusula 3.2.
9.5. Pagar o IPTU/TLP e tributos incidentes sobre o Imóvel quando não repassados ao Locatário, e arcar com taxas extraordinárias de condomínio (art. 22, X, da Lei nº 8.245/1991).
9.6. Suportar custas, despesas e honorários advocatícios na forma da Cláusula 7.
9.7. Prestar à CONTRATADA todas as informações de KYC, beneficiário final e PEP, atualizando-as a cada alteração relevante.
9.8. Não negociar diretamente com Locatário ou fiador (caso houver), nem celebrar acordos relativos à locação, sem prévia ciência por escrito da CONTRATADA.
9.9. Comunicar imediatamente à CONTRATADA quaisquer eventos que afetem a propriedade ou a posse do Imóvel (penhora, falência, inventário, separação, venda, doação, etc.).
## CLÁUSULA 10 — DECLARAÇÕES E GARANTIAS
10.1. Cada Parte declara e garante à outra, na data deste Contrato e enquanto vigente:
(a) Estar devidamente constituída/qualificada e em pleno gozo de seus direitos civis e sociais;
(b) Possuir poderes e autorizações necessárias para celebrar e executar este Contrato, sendo este válido, vinculante e exequível;
(c) A celebração e a execução deste Contrato não violam (i) lei aplicável, (ii) atos constitutivos, (iii) decisão judicial ou arbitral, ou (iv) contrato do qual seja parte;
(d) Inexistirem litígios judiciais ou administrativos relevantes que comprometam a execução deste Contrato;
(e) As informações prestadas para celebração deste Contrato são verdadeiras, completas e atualizadas.
10.2. O CONTRATANTE declara, ainda, ser legítimo proprietário ou detentor regular dos poderes de administração sobre o Imóvel, livre e desembaraçado de quaisquer ônus, gravames ou litígios que comprometam a locação, à exceção dos eventualmente declarados por escrito à CONTRATADA na data deste Contrato.
## CLÁUSULA 11 — RESPONSABILIDADES, ISENÇÕES E INDENIZAÇÕES
11.1. A CONTRATADA não terá qualquer responsabilidade ou obrigação perante o CONTRATANTE quanto a eventuais débitos inadimplidos, danos ao Imóvel ou descumprimento contratual praticados pelo Locatário e/ou fiadores (caso houver), cuja responsabilidade é integralmente atribuída a estes, conforme Contrato de Locação.
11.2. Caso o Locatário interrompa o pagamento do aluguel em razão de avaria grave alheia à sua culpa e o CONTRATANTE, devidamente notificado, não adote as providências cabíveis, fica a CONTRATADA isenta de responsabilidade pela inadimplência decorrente.
11.3. Estando o Imóvel desocupado, ficam a cargo do CONTRATANTE os pagamentos relativos ao bem (condomínio, IPTU, energia, água, segurança e conservação) e a coleta de correspondências.
11.4. A CONTRATADA não responde por estragos ou depredações sofridos pelo Imóvel no intervalo entre locações, bem como durante o período em que estiver desocupado, salvo decorrência direta de seu dolo ou culpa.
11.5. Qualquer acordo entre o CONTRATANTE e o Locatário só poderá ser celebrado mediante prévio e escrito consentimento da CONTRATADA.
11.6. Indenização recíproca. Cada Parte indenizará a outra por perdas e danos diretos comprovadamente causados por dolo, culpa, fraude ou violação a este Contrato. A responsabilidade indenizatória, ressalvadas hipóteses de dolo ou fraude, fica limitada ao montante equivalente a 12 (doze) meses da Taxa de Administração devida no exercício imediatamente anterior ao evento, e não abrange lucros cessantes ou danos indiretos.
## CLÁUSULA 12 — PROTEÇÃO DE DADOS PESSOAIS (LGPD)
12.1. As Partes obrigam-se a observar a LGPD (Lei nº 13.709/2018), tratando dados pessoais de CONTRATANTE, Locatários, fiadores (caso houver), dependentes e prepostos exclusivamente para as finalidades de execução deste Contrato, cumprimento de obrigação legal/regulatória e exercício regular de direitos.
12.2. São controladores conjuntos o CONTRATANTE e a CONTRATADA, cada qual respondendo pelo tratamento que executar autonomamente; a CONTRATADA atua como operadora quando processar dados sob orientação específica do CONTRATANTE.
12.3. Bases legais: execução de contrato (art. 7º, V), cumprimento de obrigação legal/regulatória (art. 7º, II), legítimo interesse (art. 7º, IX) para prevenção a fraudes e cobrança, e consentimento (art. 7º, I) para finalidades específicas.
12.4. Os dados pessoais serão retidos enquanto durar a relação contratual e por mais 5 (cinco) anos após o término, ou pelo prazo exigido por lei.
12.5. A CONTRATADA poderá utilizar subcontratados (assinatura eletrônica, gateways de pagamento, sistemas de gestão imobiliária, ferramentas de cobrança), os quais aderirão a padrões equivalentes de proteção. Lista atualizada de operadores está disponível mediante solicitação.
12.6. Em caso de incidente de segurança envolvendo dados pessoais, a Parte que tomar conhecimento comunicará a outra em até 24 (vinte e quatro) horas, e a CONTRATADA notificará a ANPD na forma do art. 48 da LGPD quando aplicável.
12.7. Os direitos dos titulares previstos no art. 18 da LGPD serão atendidos pela CONTRATADA no prazo legal, com cópia ao CONTRATANTE quando relacionados ao Imóvel.
## CLÁUSULA 13 — COMPLIANCE, PLD-FT, ANTICORRUPÇÃO E SANÇÕES
13.1. As Partes declaram conhecer e cumprir a Lei nº 9.613/1998 (PLD-FT), a Resolução COFECI nº 36/2022 e a Lei nº 12.846/2013 (Anticorrupção), abstendo-se de qualquer prática vedada por essas normas, próprias ou de terceiros vinculados a este Contrato.
13.2. O CONTRATANTE declara, sob as penas da lei, ser ou não ser PEP (Pessoa Exposta Politicamente, conforme Resolução COAF nº 40/2021) e identificar seu beneficiário final quando pessoa jurídica, mediante declaração específica firmada na celebração deste Contrato.
13.3. O CONTRATANTE autoriza a CONTRATADA a comunicar ao COAF/SISCOAF, independentemente de aviso prévio, operações ou propostas que se enquadrem nas hipóteses de comunicação obrigatória, sem que isso configure violação de sigilo ou descumprimento contratual.
13.4. Sanções Internacionais. As Partes declaram não constar de listas de sanções internacionais (OFAC, ONU, União Europeia) e comprometem-se a não realizar operações com pessoas listadas.
13.5. A constatação de descumprimento desta Cláusula autoriza a CONTRATADA a rescindir imediatamente este Contrato, sem ônus, e a comunicar as autoridades competentes.
## CLÁUSULA 14 — VIGÊNCIA, RESCISÃO E TRANSIÇÃO
14.1. Este Contrato vigora por prazo indeterminado, a partir da data de sua assinatura.
14.2. Qualquer das Partes poderá rescindi-lo, mediante notificação escrita com antecedência mínima de 60 (sessenta) dias, a fim de permitir transição ordenada.
14.3. Não sendo do interesse do CONTRATANTE a renovação do Contrato de Locação, a CONTRATADA deverá ser informada por escrito com 60 (sessenta) dias de antecedência. Na falta deste aviso, fica a CONTRATADA, de pleno direito, autorizada a manter a locação prorrogada por prazo indeterminado, nos termos do art. 46, §1º, da Lei nº 8.245/1991.
14.4. No caso de o CONTRATANTE rescindir o Contrato sem justa causa, a CONTRATADA fará jus à remuneração descrita no caput da Cláusula 4.1 durante toda a vigência do Contrato de Locação celebrado e, caso este esteja vencido e prorrogado por prazo indeterminado, pelo prazo de 3 (três) meses da prorrogação, além das despesas comprovadamente custeadas.
14.5. Justa causa para rescisão imediata, sem aviso prévio: (i) descumprimento reiterado e não-sanado em 15 dias; (ii) decretação de falência, insolvência civil ou recuperação judicial; (iii) violação à Cláusula 13; (iv) prática de atos contrários à Lei nº 6.530/1978 (Profissão de Corretor).
14.6. Caso o CONTRATANTE inviabilize a captação (preço fora de mercado, ausência injustificada de manutenção, recusa imotivada de propostas dentro da margem de mercado etc.), arcará com o reembolso linear de despesas comprovadas (anúncios, vistoria, deslocamentos) e, havendo Locatário apresentado, com a Comissão de Intermediação.
14.7. Sobrevivência. Sobrevivem ao término deste Contrato as Cláusulas 11, 12, 13, 17 e 21, bem como quaisquer obrigações pecuniárias pendentes.
## CLÁUSULA 15 — MULTA POR RESCISÃO ANTECIPADA DA LOCAÇÃO
15.1. O Contrato de Locação preverá multa equivalente a 3 (três) aluguéis mensais vigentes na ocasião do rompimento, observada a redução proporcional ao período já cumprido nos termos do art. 4º da Lei nº 8.245/1991.
15.2. A multa poderá ser dispensada, de comum acordo entre o CONTRATANTE e a CONTRATADA, na hipótese da Cláusula 4.2 ou após decurso mínimo de 12 (doze) meses da locação.
## CLÁUSULA 16 — VENDA E PERMUTA — DIREITO DE PREFERÊNCIA
16.1. Em caso de venda ou permuta do Imóvel, tem a CONTRATADA preferência sobre quaisquer outras pessoas físicas ou jurídicas para realizar a intermediação de compra e venda.
16.2. O CONTRATANTE comunicará por escrito a melhor proposta recebida; a CONTRATADA disporá de 10 (dez) Dias Úteis para igualar ou superar a proposta.
16.3. O exercício deste direito não substitui a preferência legal do Locatário (art. 27 e ss. da Lei nº 8.245/1991), cujo cumprimento será operacionalizado pela CONTRATADA.
## CLÁUSULA 17 — CONFIDENCIALIDADE E PROPRIEDADE INTELECTUAL
17.1. As Partes manterão sigilo recíproco sobre informações financeiras, patrimoniais, comerciais e pessoais a que tiverem acesso em razão deste Contrato, durante sua vigência e por 5 (cinco) anos após o término, salvo determinação legal ou judicial.
17.2. Excluem-se do sigilo as informações públicas, as comunicadas por força da Cláusula 13 e as exigidas por autoridades competentes.
17.3. Material publicitário. Fotografias, vídeos, tours 360º e demais materiais produzidos pela CONTRATADA permanecem de sua propriedade intelectual, sendo concedida ao CONTRATANTE licença gratuita, não-exclusiva e por prazo indeterminado para uso não-comercial relacionado ao Imóvel.
## CLÁUSULA 18 — FORÇA MAIOR E CASO FORTUITO
18.1. Caso fortuito ou força maior, devidamente comprovados, suspendem as obrigações afetadas pelo período do impedimento, devendo a Parte impactada notificar a outra em até 5 (cinco) Dias Úteis e empregar seus melhores esforços para minimizar efeitos e prazos.
18.2. Persistindo o evento por mais de 90 (noventa) dias, qualquer Parte poderá rescindir o Contrato sem ônus, mediante notificação escrita.
## CLÁUSULA 19 — NOTIFICAÇÕES
19.1. Todas as comunicações, avisos e notificações entre as Partes deverão ser feitas por escrito, considerando-se válidas quando enviadas: (i) por carta registrada com aviso de recebimento; (ii) por e-mail com confirmação de recebimento; ou (iii) por meio de plataforma de assinatura eletrônica com trilha de auditoria.
19.2. Endereços para notificação:
(a) CONTRATADA: Av. Anísio Haddad, 8001, Torre Madri Sul, sala 03, São José do Rio Preto/SP, CEP 15091-751 — telefone (17) 99661-2193 — e-mail locacao@imobiliariapsm.com.br;
(b) CONTRATANTE: endereço constante do preâmbulo — e-mail {{v1_email}}.
19.3. A alteração de endereços de notificação dependerá de prévia comunicação por escrito, com 10 (dez) dias de antecedência.
## CLÁUSULA 20 — DISPOSIÇÕES GERAIS
20.1. Acordo Integral. Este Contrato representa o acordo integral entre as Partes e prevalece sobre quaisquer entendimentos verbais ou escritos anteriores.
20.2. Alterações. Qualquer alteração somente terá eficácia se formalizada por escrito e assinada pelas Partes, sob a forma de Aditivo Contratual numerado.
20.3. Cessão. Nenhuma das Partes poderá ceder direitos ou obrigações sem prévio consentimento por escrito da outra, salvo nos casos de reorganização societária da CONTRATADA, mediante notificação prévia.
20.4. Disposições Inválidas. A eventual invalidade de uma Cláusula não afetará as demais, comprometendo-se as Partes a substituí-la, de boa-fé, por disposição válida que preserve o equilíbrio econômico original.
20.5. Tolerância. A tolerância ou o atraso no exercício de direito não implica renúncia, sendo eficaz apenas a renúncia expressa e por escrito.
20.6. Direitos Cumulativos. Os direitos previstos neste Contrato são cumulativos com os direitos previstos em lei, podendo ser exercidos isoladamente ou em conjunto, sem que o exercício de um implique renúncia aos demais.
20.7. Independência. Este Contrato não cria vínculo empregatício, societário, de mandato exclusivo (salvo Cláusula 4.3), de joint venture, parceria ou consórcio entre as Partes.
20.8. Assinatura Eletrônica. As Partes reconhecem como válida a assinatura por meio de certificado digital ICP-Brasil e/ou plataformas de assinatura eletrônica autorizadas (e.g., ClickSign, DocuSign, Autentique), nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020.
20.9. Vias. Este Contrato é firmado em via única eletrônica, com força equivalente a tantas vias quantas forem as Partes signatárias.
20.10. Lei de Regência. Este Contrato é regido e interpretado pelas leis da República Federativa do Brasil.
## CLÁUSULA 21 — SOLUÇÃO DE CONTROVÉRSIAS E FORO
21.1. Surgida controvérsia, as Partes se comprometem a tentar, previamente à via judicial, resolução por mediação presencial ou eletrônica, no prazo de 30 (trinta) dias da notificação inaugural, perante câmara de mediação reconhecida ou mediador particular de comum acordo, custos rateados.
21.2. Frustrada a mediação, fica eleito o Foro da Comarca de São José do Rio Preto/SP, com renúncia a qualquer outro, por mais privilegiado que seja, para dirimir as questões oriundas deste Contrato.
## CLÁUSULA 22 — CONSIDERANDOS — FUNDAMENTAÇÃO DO CONTRATO
As Partes registram, para fins de interpretação deste Contrato, os seguintes Considerandos:
(A) Que a CONTRATADA é sociedade empresária dedicada à intermediação imobiliária e à administração de imóveis para locação, com inscrição regular no CRECI/SP, equipe especializada, sistemas de gestão imobiliária e protocolos de Compliance, Prevenção à Lavagem de Dinheiro e Proteção de Dados Pessoais;
(B) Que o CONTRATANTE é proprietário ou regularmente investido nos poderes de administração e disposição do Imóvel descrito na Cláusula 1.2 e tem interesse em terceirizar a gestão da locação a profissional especializado;
(C) Que a CONTRATADA detém capacidade técnica e operacional para captar Locatários, conduzir a análise de risco, formalizar contratos de locação, recolher e repassar aluguéis e encargos, e prestar contas com transparência e tempestividade;
(D) Que as Partes, exercendo sua liberdade e autonomia contratual (arts. 421 e 421-A do Código Civil) e cientes do dever de boa-fé objetiva (art. 422), ajustam relação de natureza estritamente civil, sem qualquer vínculo trabalhista, societário ou de exclusividade fora das hipóteses expressamente previstas;
(E) Que a gestão direta de Locatário pelo proprietário é notoriamente trabalhosa, demandando tempo, conhecimento técnico-jurídico e disponibilidade emocional para mediar conflitos, cobrar aluguéis, administrar manutenções e lidar com o condomínio — razão pela qual a contratação de administradora profissional representa benefício concreto ao CONTRATANTE, conforme detalhado na Cláusula 8.11;
(F) Que este Contrato observará a Lei nº 8.245/1991 (Lei do Inquilinato), o Código Civil, a Lei nº 6.530/1978 (Profissão de Corretor de Imóveis), a Lei nº 13.709/2018 (LGPD), a Lei nº 9.613/1998 e a Resolução COFECI nº 36/2022 (PLD-FT), a Lei nº 12.846/2013 (Anticorrupção) e demais normas aplicáveis.
## CLÁUSULA 23 — DEFINIÇÕES E INTERPRETAÇÃO
23.1. Para os fins deste Contrato, os termos abaixo, sempre que utilizados em letra inicial maiúscula, terão os seguintes significados:
"Aluguel Bruto" significa o valor mensal bruto do aluguel pago pelo Locatário, antes da dedução de quaisquer taxas, descontos ou despesas, conforme a Cláusula 5;
"ANPD" significa a Autoridade Nacional de Proteção de Dados, criada pela Lei nº 13.709/2018;
"Comissão de Intermediação" significa a remuneração devida à CONTRATADA pela intermediação na celebração de novo Contrato de Locação, conforme a Cláusula 4.2;
"Conta Vinculada" significa a conta bancária ou subconta de identificação específica em que a CONTRATADA custodia os valores recebidos em nome do CONTRATANTE, com segregação patrimonial;
"Contrato de Locação" significa o contrato de locação a ser celebrado entre o CONTRATANTE (na qualidade de locador, representado pela CONTRATADA) e o Locatário, regido pela Lei nº 8.245/1991;
"Dia Útil" significa qualquer dia, exceto sábados, domingos e feriados nacionais, estaduais (SP) ou municipais (São José do Rio Preto/SP);
"Garantia Locatícia" significa qualquer das modalidades de garantia previstas no art. 37 da Lei nº 8.245/1991, conforme acordado nos termos da Cláusula 8.3;
"Imóvel" significa o imóvel identificado na Cláusula 1.2;
"LGPD" significa a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais);
"Locatário" significa a pessoa física ou jurídica que, selecionada pela CONTRATADA e aprovada pelo CONTRATANTE, celebrar o Contrato de Locação;
"PEP" significa Pessoa Exposta Politicamente, conforme Resolução COAF nº 40/2021;
"PLD-FT" significa Prevenção à Lavagem de Dinheiro e ao Financiamento do Terrorismo, regida pela Lei nº 9.613/1998 e pela Resolução COFECI nº 36/2022;
"Taxa de Administração" significa a remuneração mensal devida à CONTRATADA pela administração do Imóvel, conforme a Cláusula 4.1;
23.2. Os títulos e índices têm função meramente referencial. As referências a leis, decretos e regulamentos compreendem suas alterações e sucessoras. Os prazos em "dias" são corridos, salvo se expressamente indicados como Dias Úteis. Os termos no singular incluem o plural e vice-versa, conforme o contexto.
{{#condicoes_especiais}}## CONDIÇÕES ESPECIAIS E OBSERVAÇÕES
As Partes ajustam, ainda, as seguintes condições especiais, que prevalecem sobre as cláusulas gerais naquilo que com elas conflitarem:
{{condicoes_especiais}}
{{/condicoes_especiais}}
---
E, por estarem assim justas e contratadas, assinam as Partes o presente Contrato, na presença das testemunhas abaixo identificadas.
São José do Rio Preto/SP, {{data_extenso}}.
## CONTRATADA
[[ASSINATURAS]]{{empresa_nome}}|Representante Legal: {{empresa_representante}}
## CONTRATANTE
[[ASSINATURAS]]{{v1_nome}}|CPF/CNPJ {{v1_cpf}}{{#v2_nome}}||{{v2_nome}}|CPF {{v2_cpf}}{{/v2_nome}}
## TESTEMUNHAS
[[ASSINATURAS]]{{testemunha1}}|1ª testemunha||{{testemunha2}}|2ª testemunha`,
  },

  /* ─────────────────────── 4. CONTRATO DE LOCAÇÃO COMERCIAL ─────────────────────── */
  {
    id: 'contrato_loc_com',
    titulo: 'Contrato de locação comercial',
    categoria: 'Locação',
    empresa: 'psm_assessoria_locacao',
    arquivo: 'Contrato de locação comercial',
    papeis: { ...PAPEIS_LOCACAO, c1: 'Locatário(a) — ou representante legal da empresa', c2: '2º locatário / 2º representante' },
    valorCampo: 'aluguel',
    corpo: `# CONTRATO DE LOCAÇÃO DE IMÓVEL — COMERCIAL URBANO
---
Pelo presente Contrato de Locação de Imóvel para fins não residenciais ("Contrato"), regido pela Lei nº 8.245/1991 (Lei do Inquilinato) — em especial seus arts. 51 a 57, aplicáveis às locações não residenciais — e pelo Código Civil, as partes adiante qualificadas:
**LOCADOR(A):** {{locadores_qualificacao}}, doravante "LOCADOR";
**LOCATÁRIO(A):** {{#locatario_razao}}{{locatario_razao}}, CNPJ nº {{locatario_cnpj}}, com sede em {{locatario_sede}}, neste ato representada por seu(s) representante(s) legal(is) {{/locatario_razao}}{{locatarios_qualificacao}}, doravante "LOCATÁRIO";
{{#f1_nome}}**FIADOR(A):** {{fiadores_qualificacao}}, doravante "FIADOR".
{{/f1_nome}}**ADMINISTRADORA / INTERMEDIADORA:** {{empresa_nome}}, CNPJ {{empresa_cnpj}}, CRECI {{empresa_creci}}, com sede na {{empresa_endereco}}, doravante "PSM" ou "ADMINISTRADORA".
As partes acima, conjuntamente denominadas "Partes", têm entre si justo e contratado o presente Contrato, mediante as cláusulas e condições seguintes:
## CLÁUSULA 1 — OBJETO E IDENTIFICAÇÃO DO IMÓVEL
1.1. O LOCADOR dá em locação ao LOCATÁRIO, que aceita, o imóvel a seguir descrito ("Imóvel"), destinado exclusivamente a uso comercial / não residencial no ramo de atividade indicado na Cláusula 2.
1.2. Identificação do Imóvel:
(a) Descrição: {{imovel_tipologia}}, endereço {{imovel_endereco}}, CEP {{imovel_cep}};
(b) Matrícula nº {{imovel_matricula}} do {{imovel_cartorio}};
(c) Código IPTU / Cadastro Municipal nº {{imovel_iptu}};
(d) Código CPFL (energia elétrica) nº {{imovel_cpfl}};
(e) Código SeMAE (água/esgoto) nº {{imovel_semae}};
{{#imovel_condominio}}(f) Administradora de condomínio: {{imovel_condominio}};
{{/imovel_condominio}}{{#imovel_senha}}(g) Senha de fechadura eletrônica: {{imovel_senha}} — informação confidencial, custodiada pela ADMINISTRADORA;
{{/imovel_senha}}(h) Conta corrente da ADMINISTRADORA para recebimento do aluguel: titular {{empresa_nome}}, CNPJ {{empresa_cnpj}}, {{empresa_banco}}, Chave PIX {{empresa_pix}}. Pagamentos diretos ao LOCADOR são vedados;
{{#imovel_mobilia}}(i) Acessórios e instalações: {{imovel_mobilia}}, conforme Termo de Vistoria de Entrada.
{{/imovel_mobilia}}1.3. O LOCATÁRIO declara ter visitado e vistoriado o Imóvel previamente à assinatura, conhecendo o estado em que se encontra, e que o Imóvel é adequado ao ramo de atividade pretendido, conforme análise de viabilidade técnica e regulatória de sua exclusiva responsabilidade.
1.4. O LOCADOR declara ser legítimo proprietário ou regularmente investido nos poderes de administração e disposição sobre o Imóvel, livre e desembaraçado de ônus que comprometam a locação.
## CLÁUSULA 2 — DESTINAÇÃO, RAMO DE ATIVIDADE E USO
2.1. O LOCATÁRIO obriga-se a utilizar o Imóvel exclusivamente para o ramo de atividade abaixo descrito, sob pena de rescisão imediata por infração grave:
(a) Ramo de atividade: {{ramo_atividade}};
(b) CNAE principal: {{cnae_principal}};
(c) CNAE(s) secundário(s) admitido(s): {{cnae_secundarios}};
(d) Horário de funcionamento previsto: {{horario_funcionamento}}, observadas normas do condomínio e da legislação municipal.
2.2. Vedada a alteração do ramo de atividade, do CNAE ou da destinação sem prévia anuência escrita do LOCADOR, sob pena de rescisão imediata e cobrança da multa proporcional da Cláusula 16.
2.3. É vedado o exercício de atividades que: (i) gerem ruído, vibração, fumaça, odores ou poluição incompatível com o entorno; (ii) envolvam materiais inflamáveis, tóxicos, radioativos ou ilícitos sem licença específica; (iii) afrontem normas de zoneamento, posturas municipais ou regulamento condominial; (iv) configurem casa de festas, prostíbulo, jogos de azar ou atividades de moralidade duvidosa.
2.4. O Imóvel não poderá ser utilizado, ainda que em parte, como residência do LOCATÁRIO, de seus sócios, prepostos ou empregados, salvo autorização expressa e documental do LOCADOR para imóvel de uso misto.
## CLÁUSULA 3 — ALVARÁS, LICENÇAS E REGULARIZAÇÕES
3.1. São de exclusiva responsabilidade do LOCATÁRIO, às suas expensas, a obtenção e manutenção, durante toda a locação, de: (i) Alvará de Funcionamento Municipal; (ii) Auto de Vistoria do Corpo de Bombeiros (AVCB/CLCB); (iii) Vigilância Sanitária quando aplicável; (iv) Licença Ambiental quando aplicável; (v) Inscrição estadual e municipal; (vi) Demais licenças setoriais exigíveis ao ramo de atividade.
3.2. O LOCATÁRIO obriga-se a apresentar à ADMINISTRADORA cópia das licenças exigíveis em até 90 (noventa) dias contados da assinatura do Contrato, e suas renovações nos prazos legais.
3.3. Multas administrativas, autuações ou sanções decorrentes do exercício da atividade ou da ausência de licenças correm exclusivamente por conta do LOCATÁRIO, não respondendo o LOCADOR ou a ADMINISTRADORA por quaisquer encargos dessa natureza.
3.4. A ausência ou perda das licenças necessárias por culpa do LOCATÁRIO não constitui hipótese de extinção do Contrato por caso fortuito, persistindo as obrigações contratuais até a extinção regular.
## CLÁUSULA 4 — PRAZO E PRORROGAÇÃO
4.1. O prazo da locação é de {{prazo_meses}} meses, com início em {{data_inicio_br}} e término previsto para {{data_fim_br}}.
4.2. Findo o prazo determinado, a locação se prorrogará automaticamente por prazo indeterminado caso o LOCATÁRIO permaneça na posse do Imóvel sem oposição do LOCADOR, nos termos do art. 56, parágrafo único, da Lei do Inquilinato.
4.3. Durante a prorrogação por prazo indeterminado, o LOCADOR poderá denunciar a locação mediante notificação escrita com 30 (trinta) dias de antecedência, sem incidência de multa rescisória.
4.4. A intenção de não renovar ou de promover ação renovatória será comunicada por escrito, com no mínimo 30 (trinta) dias de antecedência ao término do prazo determinado, ressalvado o prazo específico do art. 51, §5º, para a renovatória.
## CLÁUSULA 5 — AÇÃO RENOVATÓRIA (LEI Nº 8.245/91, ART. 51)
5.1. As Partes reconhecem ao LOCATÁRIO o direito de propor ação renovatória, desde que cumulativamente: (i) o contrato a renovar tenha sido celebrado por escrito e por prazo determinado de no mínimo 5 (cinco) anos, admitida a soma dos prazos ininterruptos; (ii) o LOCATÁRIO esteja explorando seu comércio, no mesmo ramo, pelo prazo mínimo de 3 (três) anos ininterruptos.
5.2. A ação renovatória deverá ser proposta no interregno do decenário anterior aos 6 (seis) últimos meses da vigência do Contrato, sob pena de decadência do direito (art. 51, §5º).
5.3. O LOCATÁRIO obriga-se, em juízo, a apresentar a documentação prevista no art. 71 da Lei do Inquilinato, em especial: (i) prova do exercício do mesmo ramo; (ii) cumprimento integral do contrato anterior; (iii) quitação dos impostos e taxas; (iv) indicação clara das condições oferecidas; (v) garantia da locação renovada.
5.4. Inexistindo o exercício do direito no prazo legal, a locação extingue-se ao final do prazo determinado, observada a Cláusula 4.
## CLÁUSULA 6 — ALUGUEL, REAJUSTE E ENCARGOS
**6.1 Aluguel — modalidade Pague e Use**
6.1.1. O aluguel mensal é de {{aluguel_extenso}}, contratado na modalidade PAGUE E USE, devendo ser pago pelo LOCATÁRIO antecipadamente, até o {{dia_vencimento}}º dia do mês de competência (mês corrente de uso do Imóvel), em moeda corrente nacional.
6.1.2. O LOCATÁRIO declara expressa ciência e concordância com a modalidade Pague e Use, reconhecendo que o pagamento antecipado é condição essencial à manutenção do uso e fruição do Imóvel durante o respectivo mês.
**6.2 Reajuste anual**
6.2.1. O aluguel será reajustado anualmente, na menor periodicidade legalmente admitida, pela seguinte cascata de indexadores: (i) IPCA/IBGE como índice principal; (ii) IVAR/FGV como subsidiário, em caso de extinção do IPCA; (iii) IGP-M/FGV como último recurso. Inviabilizados todos, as Partes negociarão de boa-fé novo índice no prazo de 30 (trinta) dias.
6.2.2. Sem prejuízo do reajuste anual, observa-se a possibilidade de revisão judicial do aluguel após 3 (três) anos de vigência, nos termos do art. 19 da Lei do Inquilinato.
**6.3 Encargos da locação**
6.3.1. São encargos do LOCATÁRIO: contas de consumo (energia/CPFL, água/SeMAE, gás, internet), taxas ordinárias de condomínio, IPTU/TLP, ISS sobre atividades exercidas no Imóvel, tributos e multas decorrentes do uso do Imóvel.
6.3.2. São encargos do LOCADOR: taxas extraordinárias de condomínio (art. 22, X, Lei 8.245/91), reparos estruturais, IRRF sobre o aluguel quando devido.
**6.4 Forma de pagamento**
6.4.1. O aluguel e demais encargos serão pagos pelo LOCATÁRIO exclusivamente em favor da ADMINISTRADORA, por meio de boleto bancário, transferência eletrônica ou PIX, na conta indicada na Cláusula 1.2(h). A ADMINISTRADORA disponibilizará mensalmente os meios de pagamento.
6.4.2. Pagamentos diretos ao LOCADOR são vedados e não serão considerados quitados perante este Contrato, salvo orientação expressa por escrito da ADMINISTRADORA.
6.4.3. O recebimento do aluguel após o vencimento não implica novação contratual nem renúncia ao direito de cobrança ou rescisão.
**6.5 Mora e juros**
6.5.1. O atraso sujeitará o LOCATÁRIO, cumulativamente, a: (i) atualização monetária pelo IPCA pro rata die; (ii) juros de mora de 1% (um por cento) ao mês; e (iii) multa moratória de 10% (dez por cento) sobre o valor em atraso, sem prejuízo da cobrança judicial e da rescisão por inadimplência (locação não residencial).
## CLÁUSULA 7 — GARANTIA LOCATÍCIA
7.1. A garantia desta locação, dentre as modalidades do art. 37 da Lei nº 8.245/1991, é {{garantia_maiuscula}}, excluída expressamente a caução em dinheiro, e formalizada nos seguintes termos:
{{#garantia_fianca}}**7.2 Fiança**
7.2.1. O FIADOR responde solidariamente com o LOCATÁRIO por todas as obrigações deste Contrato, incluindo aluguéis, encargos, multas, indenizações, custas e honorários, até a efetiva entrega das chaves e quitação integral, prorrogando-se a fiança até o término da locação, ainda que prorrogada, salvo notificação de exoneração nos termos do art. 40, X, da Lei 8.245/91 e art. 835 do Código Civil.
7.2.2. Em locação não residencial, admite-se a contratação de fiança bancária, mediante carta-fiança emitida por instituição financeira de primeira linha, com cobertura mínima equivalente a 12 (doze) aluguéis e renovação anual obrigatória.
{{/garantia_fianca}}{{#garantia_seguro}}**7.3 Seguro-fiança**
7.3.1. Modalidade contratada junto a {{garantia_instituicao}}, apólice nº {{garantia_numero}}, vigência de {{garantia_vigencia}}, cobertura mínima de {{garantia_cobertura}} aluguéis e encargos.
7.3.2. O LOCATÁRIO obriga-se a renovar tempestivamente a apólice e a comprovar a renovação à ADMINISTRADORA com antecedência mínima de 30 (trinta) dias. A não renovação caracteriza falta grave e enseja, à escolha do LOCADOR: (i) substituição da modalidade, na forma do art. 40 da Lei 8.245/91; ou (ii) rescisão por descumprimento.
7.3.3. Apólice parcelada e proteção contra cobertura inferior a 100%. Caso o prêmio do seguro-fiança seja contratado de forma parcelada (boleto, cartão ou outra forma) ou esteja sujeito a cláusula de cobertura proporcional ao adimplemento, o LOCATÁRIO obriga-se a: (i) manter o pagamento de todas as parcelas em dia, comprovando à ADMINISTRADORA em até 5 (cinco) Dias Úteis do vencimento; (ii) comunicar imediatamente notificação da Seguradora relativa a inadimplência, redução de cobertura, suspensão ou cancelamento; e (iii) assegurar cobertura efetiva de 100% (cem por cento) durante toda a vigência da locação.
7.3.4. A inadimplência de qualquer parcela, redução de cobertura abaixo de 100%, cancelamento, suspensão ou ausência de comprovação tempestiva caracterizam falta grave, autorizando o LOCADOR a: (a) exigir, de forma IMEDIATA — no prazo máximo improrrogável de 48 (quarenta e oito) horas da notificação —, reforço, regularização ou substituição integral da garantia (art. 40 Lei 8.245/91); (b) promover, às expensas do LOCATÁRIO, a quitação direta junto à Seguradora; ou (c) rescindir o Contrato por descumprimento, com multa proporcional e perdas e danos.
7.3.5. Os prêmios e despesas decorrentes da contratação, manutenção e renovação do seguro-fiança são de exclusiva responsabilidade do LOCATÁRIO.
{{/garantia_seguro}}{{#garantia_titulo}}**7.4 Título de capitalização**
7.4.1. Modalidade contratada junto a {{garantia_instituicao}}, título nº {{garantia_numero}}, valor {{garantia_valor}}, com cláusula de pagamento a favor do LOCADOR em caso de inadimplência, e devolução ao LOCATÁRIO ao término da locação, observada a quitação integral.
{{/garantia_titulo}}**7.5 Substituição**
7.5.1. Qualquer alteração na modalidade de garantia depende de prévia anuência por escrito do LOCADOR, ressalvado o direito do LOCADOR de exigir reforço ou substituição na hipótese de falecimento, insolvência, recuperação judicial, exoneração ou inadequação superveniente da garantia (art. 40 Lei 8.245).
## CLÁUSULA 8 — SEGURO DO IMÓVEL E DAS OPERAÇÕES
8.1. O LOCATÁRIO obriga-se a contratar e manter vigente, durante toda a locação, seguro contra incêndio, raio, explosão, vendaval, desmoronamento e responsabilidade civil, em seguradora idônea, com cobertura mínima de {{seguro_incendio}}, figurando o LOCADOR como beneficiário do seguro patrimonial.
8.2. O LOCATÁRIO comprovará a contratação dentro de 30 (trinta) dias da assinatura e a renovação anual, sob pena de a ADMINISTRADORA contratá-lo às expensas do LOCATÁRIO, mediante prévia notificação.
8.3. Em atividades de maior risco (gastronomia, indústria, serviços com manipulação de produtos perigosos), poderão ser exigidas coberturas adicionais (responsabilidade civil ampliada, danos a terceiros, lucros cessantes do entorno).
## CLÁUSULA 9 — VISTORIA DE ENTRADA, INTERMEDIÁRIAS E SAÍDA
9.1. O Termo de Vistoria de Entrada, lavrado nesta data e assinado pelas Partes, descreve o estado do Imóvel, instalações e equipamentos, e constitui prova pré-constituída para todos os fins.
9.2. O LOCATÁRIO disporá de 5 (cinco) Dias Úteis, contados da assinatura, para impugnar fundamentadamente o Termo de Vistoria de Entrada. Decorrido o prazo sem manifestação, presume-se aceito.
9.3. A ADMINISTRADORA poderá realizar vistorias intermediárias mediante prévio agendamento, com antecedência mínima de 48 (quarenta e oito) horas, em horário compatível com o funcionamento comercial.
9.4. Ao término da locação, será realizada Vistoria de Saída na forma da Cláusula 23.
## CLÁUSULA 10 — CONSERVAÇÃO, REPAROS E BENFEITORIAS
10.1. Cabe ao LOCATÁRIO a conservação ordinária do Imóvel, incluindo manutenção corretiva e preventiva de instalações elétricas, hidráulicas, redes lógicas, ar-condicionado e sanitários, bem como danos causados por si, seus prepostos, empregados, clientes ou visitantes.
10.2. Cabe ao LOCADOR os reparos estruturais (telhado, fundações, alvenaria, vícios redibitórios, problemas de origem construtiva), salvo causados por culpa do LOCATÁRIO.
10.3. Benfeitorias úteis e voluptuárias dependem de prévia anuência por escrito do LOCADOR. O LOCATÁRIO renuncia expressamente a indenização e ao direito de retenção sobre benfeitorias úteis e voluptuárias (Súmula 335 STJ), as quais incorporar-se-ão definitivamente ao Imóvel.
10.4. Benfeitorias necessárias serão comunicadas imediatamente ao LOCADOR e à ADMINISTRADORA. Quando autorizadas ou indispensáveis e urgentes, serão indenizadas, salvo se decorrentes de uso anormal ou culpa do LOCATÁRIO (CC, art. 1.219).
## CLÁUSULA 11 — OBRAS DE ADEQUAÇÃO COMERCIAL
11.1. Toda e qualquer obra de adequação ao ramo de atividade — divisórias, instalações sanitárias, redes lógicas, exaustão, refrigeração, layout, acabamentos — depende de prévia anuência por escrito do LOCADOR e, quando aplicável, do condomínio.
11.2. As obras seguirão projeto técnico aprovado, com responsabilidade técnica formalizada por meio de ART (CREA) ou RRT (CAU), conforme o caso, custeadas pelo LOCATÁRIO.
11.3. O LOCATÁRIO obriga-se a obter alvarás e regularizações junto à Prefeitura, Bombeiros, Vigilância Sanitária e demais órgãos exigíveis.
11.4. Ao término da locação, à exclusiva escolha do LOCADOR, comunicada com 90 (noventa) dias de antecedência: (i) o LOCATÁRIO removerá as adequações e restituirá o Imóvel ao estado original, às suas expensas; ou (ii) as adequações serão incorporadas definitivamente ao Imóvel, sem direito a indenização ou retenção.
11.5. Eventuais encargos fiscais ou tributários majorados em decorrência das adequações são de exclusiva responsabilidade do LOCATÁRIO.
## CLÁUSULA 12 — PLACAS, LETREIROS, FACHADA E COMUNICAÇÃO VISUAL
12.1. A instalação de placas, letreiros, totens, painéis luminosos, vinis e demais elementos de comunicação visual dependem de prévia anuência por escrito do LOCADOR e do condomínio (caso houver), e da obtenção de licença municipal específica.
12.2. Os elementos de comunicação visual deverão observar as normas do condomínio quanto a padrão arquitetônico, dimensões, iluminação e horário de funcionamento.
12.3. Ao término da locação, o LOCATÁRIO removerá integralmente os elementos instalados, restituindo a fachada ao estado original, às suas expensas, salvo expressa autorização em contrário.
## CLÁUSULA 13 — OBRIGAÇÕES DO LOCATÁRIO
Sem prejuízo das demais obrigações deste Contrato e da Lei do Inquilinato, o LOCATÁRIO obriga-se a:
13.1. Pagar pontualmente o aluguel e os encargos.
13.2. Servir-se do Imóvel para a destinação contratada, com diligência, e tratá-lo como se seu fosse.
13.3. Restituir o Imóvel, ao término, no estado em que o recebeu, salvo desgaste natural decorrente de uso comercial regular.
13.4. Comunicar imediatamente ao LOCADOR e à ADMINISTRADORA qualquer dano ou defeito que demande reparo de responsabilidade do LOCADOR.
13.5. Permitir vistoria do Imóvel, mediante agendamento prévio, conforme Cláusula 9.
13.6. Cumprir o regulamento interno do condomínio (caso houver) e respeitar as normas de zoneamento e posturas municipais.
13.7. Realizar a transferência da titularidade da conta de energia (CPFL) e demais utilidades para seu nome em até 30 (trinta) dias do início da locação.
13.8. Não sublocar, ceder, dar em comodato ou emprestar o Imóvel, no todo ou em parte, sem prévia anuência escrita do LOCADOR, ressalvada a hipótese da Cláusula 15.
13.9. Manter atualizadas as licenças, alvarás e demais regularizações de funcionamento.
13.10. Não realizar atividades incompatíveis com a destinação ou com a Cláusula 2.3.
## CLÁUSULA 14 — OBRIGAÇÕES DO LOCADOR
14.1. Entregar o Imóvel em estado de servir ao uso comercial pactuado.
14.2. Garantir, durante a locação, o uso pacífico do Imóvel pelo LOCATÁRIO.
14.3. Responder pelos vícios ou defeitos anteriores à locação.
14.4. Pagar as taxas extraordinárias de condomínio (art. 22, X, Lei 8.245/91) e tributos cuja transferência ao LOCATÁRIO não esteja prevista.
14.5. Manter atualizada documentação cadastral, dados bancários e endereço de notificação perante a ADMINISTRADORA.
## CLÁUSULA 15 — CESSÃO, SUBLOCAÇÃO E SUCESSÃO EMPRESARIAL
15.1. Vedadas a cessão deste Contrato e a sublocação total ou parcial do Imóvel, salvo prévia anuência escrita do LOCADOR, que não a recusará sem motivo razoável.
15.2. Sucessão empresarial. Em caso de fusão, incorporação, cisão ou trespasse de estabelecimento comercial do LOCATÁRIO, a locação poderá ser transferida ao sucessor empresarial, desde que: (i) seja comunicada por escrito ao LOCADOR e à ADMINISTRADORA com antecedência mínima de 30 (trinta) dias; (ii) o sucessor apresente garantias equivalentes ou superiores; (iii) o LOCADOR não se oponha fundamentadamente no prazo de 30 (trinta) dias do recebimento da comunicação (art. 13, §§ 1º e 2º, da Lei 8.245/91).
15.3. Sublocação parcial autorizada deverá ser formalizada por instrumento próprio, com anuência expressa do LOCADOR, mantida a responsabilidade integral do LOCATÁRIO original perante o LOCADOR e a ADMINISTRADORA.
15.4. Vedada hospedagem onerosa eventual, uso por plataformas de aluguel por temporada e qualquer subutilização que descaracterize a destinação comercial pactuada.
## CLÁUSULA 16 — RESCISÃO ANTECIPADA E MULTA
16.1. O LOCATÁRIO poderá rescindir o presente Contrato antes do prazo, mediante notificação escrita com antecedência mínima de 30 (trinta) dias, sujeitando-se ao pagamento de multa equivalente a 3 (três) aluguéis vigentes na data da rescisão, reduzida proporcionalmente ao período já cumprido, na forma do art. 4º da Lei nº 8.245/1991.
16.2. A multa será integralmente dispensada após o decurso de 12 (doze) meses da locação, desde que o LOCATÁRIO promova notificação escrita com antecedência mínima de 30 (trinta) dias e cumpra integralmente as obrigações dos arts. 22 e 23 da Lei do Inquilinato.
16.3. Em qualquer hipótese, a dispensa não exime o LOCATÁRIO do pagamento de aluguéis e encargos vencidos até a efetiva entrega das chaves nos termos da Cláusula 23, nem suprime obrigações decorrentes da Vistoria de Saída e das Cláusulas 11 e 12 (adequações e fachada).
16.4. O descumprimento de qualquer cláusula deste Contrato — não-pagamento, mudança de destinação ou ramo, sublocação não autorizada, recusa de vistoria, falta de seguro, perda de licenças, danos relevantes, descumprimento de adequações — autoriza o LOCADOR a rescindir o Contrato, com cobrança da multa proporcional e demais perdas e danos.
## CLÁUSULA 17 — INADIMPLÊNCIA E DESPEJO
17.1. O não pagamento do aluguel ou de qualquer encargo na data ajustada autoriza, independentemente de notificação prévia, a cobrança extrajudicial e judicial dos valores em atraso, atualizados, com juros, multa e honorários.
17.2. O LOCADOR poderá ajuizar ação de despejo por falta de pagamento, cumulada com cobrança, com pedido de liminar nos termos do art. 59, §1º, IX, da Lei nº 8.245/1991.
17.3. Faculta-se ao LOCATÁRIO emendar a mora nos termos do art. 62 da Lei do Inquilinato, observados os limites legais.
17.4. Vedação à auto-tutela. É expressamente vedado ao LOCADOR ou a quem por ele atue adentrar o Imóvel mediante força, arrombamento ou medidas extrajudiciais coercitivas. A reintegração da posse, em caso de abandono, ocupação irregular ou inadimplência, dar-se-á exclusivamente pela via judicial competente.
17.5. Considera-se abandono a desocupação do Imóvel sem aviso prévio, com inadimplemento superior a 30 (trinta) dias e ausência de comunicação do LOCATÁRIO, devendo o fato ser comprovado por notificação escrita seguida de constatação cartorária ou ação judicial específica.
## CLÁUSULA 18 — ALIENAÇÃO DO IMÓVEL E PREFERÊNCIA
18.1. Em caso de pretensão do LOCADOR de alienar o Imóvel, o LOCATÁRIO terá preferência na aquisição em igualdade de condições com terceiros, nos termos dos arts. 27 a 34 da Lei nº 8.245/1991.
18.2. O LOCADOR comunicará por escrito a melhor proposta recebida, contendo preço, condições, forma de pagamento e prazo. O LOCATÁRIO disporá de 30 (trinta) dias para manifestação inequívoca de exercício da preferência.
18.3. Não exercida a preferência, o LOCADOR fica livre para alienar a terceiros. Em locação por prazo determinado e cláusula de vigência averbada na matrícula, o adquirente respeitará o prazo restante (art. 8º, §1º, Lei 8.245/91).
## CLÁUSULA 19 — INTERMEDIAÇÃO E ADMINISTRAÇÃO PSM
19.1. A presente locação foi intermediada pela ADMINISTRADORA, na qualidade de mandatária do LOCADOR, em decorrência de Contrato de Prestação de Serviços de Administração de Imóvel celebrado em separado entre LOCADOR e ADMINISTRADORA.
19.2. A ADMINISTRADORA atua como receptora dos aluguéis e encargos, repassando-os ao LOCADOR, mediante prévia dedução da Taxa de Administração e da Comissão de Intermediação devidas.
19.3. Comunicações, notificações, solicitações de manutenção e demais relacionamentos cotidianos entre LOCATÁRIO e LOCADOR serão feitos preferencialmente por intermédio da ADMINISTRADORA.
## CLÁUSULA 20 — PROTEÇÃO DE DADOS PESSOAIS (LGPD)
20.1. As Partes obrigam-se a observar a Lei nº 13.709/2018 (LGPD), tratando dados pessoais de LOCADOR, sócios e representantes legais do LOCATÁRIO, FIADOR (caso houver) e prepostos exclusivamente para as finalidades de execução deste Contrato, cumprimento de obrigação legal/regulatória e exercício regular de direitos.
20.2. São controladores conjuntos o LOCADOR e a ADMINISTRADORA; a ADMINISTRADORA atua como operadora quando processar dados sob orientação específica do LOCADOR.
20.3. Bases legais: execução de contrato (art. 7º, V), cumprimento de obrigação legal (art. 7º, II), legítimo interesse (art. 7º, IX), consentimento (art. 7º, I).
20.4. Os dados pessoais serão retidos enquanto durar a relação contratual e por mais 5 (cinco) anos após o término, ou pelo prazo exigido por lei.
20.5. Em caso de incidente de segurança, comunicação à outra Parte em até 24 horas; ANPD na forma do art. 48 LGPD quando aplicável.
20.6. Direitos dos titulares (art. 18 LGPD) atendidos pela ADMINISTRADORA no prazo legal.
## CLÁUSULA 21 — COMPLIANCE, PLD-FT E ANTICORRUPÇÃO
21.1. As Partes declaram conhecer e cumprir a Lei nº 9.613/1998 (PLD-FT), a Resolução COFECI nº 36/2022 e a Lei nº 12.846/2013 (Anticorrupção).
21.2. As Partes declaram ser ou não ser PEP (Pessoa Exposta Politicamente, Resolução COAF nº 40/2021) e identificar beneficiário final quando pessoa jurídica.
21.3. As Partes autorizam a ADMINISTRADORA a comunicar ao COAF/SISCOAF, independentemente de aviso prévio, operações ou propostas que se enquadrem nas hipóteses de comunicação obrigatória.
21.4. As Partes declaram não constar de listas de sanções OFAC, ONU, União Europeia.
## CLÁUSULA 22 — NOTIFICAÇÕES E COMUNICAÇÕES
22.1. Todas as comunicações, avisos e notificações entre as Partes deverão ser feitas por escrito, considerando-se válidas quando enviadas: (i) por carta registrada com AR; (ii) por e-mail com confirmação de recebimento; ou (iii) por plataforma de assinatura eletrônica com trilha de auditoria.
22.2. Endereços para notificação:
(a) LOCADOR: endereço do preâmbulo — e-mail {{v1_email}};
(b) LOCATÁRIO: sede e/ou Imóvel locado — e-mail {{c1_email}};
{{#f1_nome}}(c) FIADOR: endereço do preâmbulo — e-mail {{f1_email}};
{{/f1_nome}}(d) ADMINISTRADORA: Av. Anísio Haddad, 8001, Torre Madri Sul, sala 03, São José do Rio Preto/SP, CEP 15091-751 — telefone (17) 99661-2193 — e-mail locacao@imobiliariapsm.com.br.
22.3. Alteração de endereço depende de prévia comunicação por escrito com 10 (dez) dias de antecedência.
## CLÁUSULA 23 — DEVOLUÇÃO DAS CHAVES E ENCERRAMENTO
23.1. A devolução das chaves somente se efetivará mediante o Termo de Entrega e Recebimento de Chaves, documento único e suficiente, assinado pelo LOCATÁRIO e pela ADMINISTRADORA — não se admitindo qualquer outra forma de comprovação de devolução.
23.2. Checklist obrigatório de entrega de chaves. Por ocasião da assinatura do Termo de Entrega e Recebimento de Chaves, o LOCATÁRIO deverá apresentar:
(a) Comprovante de quitação do aluguel e demais encargos do mês corrente e meses anteriores;
(b) Comprovante de pagamento de IPTU/TLP, ISS e demais tributos vinculados ao Imóvel;
(c) Comprovante de quitação de condomínio (ordinário e taxas) até a data da entrega;
(d) Comprovante de quitação ou de baixa de titularidade da conta de energia (CPFL);
(e) Comprovante de quitação ou de baixa de titularidade da conta de água/esgoto (SeMAE);
(f) Comprovante de quitação de gás, telefonia, internet e demais utilidades (quando aplicável);
(g) Devolução integral das chaves, controles, códigos/senhas de fechadura eletrônica e cartões de acesso;
(h) Devolução de instalações, mobiliário ou equipamentos entregues conforme Termo de Vistoria de Entrada;
(i) Comprovação da remoção de placas, letreiros e elementos de comunicação visual (Cláusula 12), restituindo a fachada ao estado original;
(j) Comprovação do destino das adequações comerciais (Cláusula 11) — remoção ou incorporação ao Imóvel, conforme escolha do LOCADOR;
(k) Encerramento de inscrição estadual/municipal vinculada ao Imóvel, se aplicável;
(l) Termo de Vistoria de Saída assinado, na forma da Cláusula 23.3.
23.3. Vistoria de Saída e prazo de impugnação. A Vistoria de Saída será conduzida pela ADMINISTRADORA, com laudo técnico fotográfico/audiovisual, em até 5 (cinco) Dias Úteis da entrega das chaves. O LOCATÁRIO disporá de 5 (cinco) Dias Úteis, contados do recebimento do laudo, para (i) assinar a vistoria final; (ii) apresentar, por escrito, apontamentos, ressalvas ou reclamações fundamentadas; ou (iii) nomear preposto de sua confiança, mediante procuração pública com poderes específicos, para acompanhamento, assinatura e impugnação. Decorrido o prazo de 5 (cinco) Dias Úteis sem qualquer das providências acima, a Vistoria de Saída será automaticamente considerada finalizada e aceita pelo LOCATÁRIO, operando-se preclusão e renúncia ao direito de reclamação ou impugnação posterior, para todos os fins de direito. Esta presunção alcança o estado do Imóvel, eventuais danos, reparos devidos e demais elementos do laudo.
23.4. Persistirá a obrigação de pagamento de aluguéis, encargos e responsabilidade pela conservação do Imóvel até a efetiva assinatura do Termo de Entrega e Recebimento de Chaves, atendido integralmente o checklist da Cláusula 23.2 e cumpridos os requisitos da Cláusula 23.3.
23.5. Reparos identificados na Vistoria de Saída e não impugnados tempestivamente serão executados às expensas do LOCATÁRIO, mediante orçamento prévio, podendo o valor ser deduzido de garantias ou cobrado por via própria.
## CLÁUSULA 24 — DISPOSIÇÕES GERAIS
24.1. Acordo Integral. Este Contrato representa o acordo integral entre as Partes.
24.2. Alterações. Qualquer alteração somente terá eficácia se formalizada por escrito, sob a forma de Aditivo Contratual numerado.
24.3. Cessão. Nenhuma das Partes poderá ceder direitos ou obrigações sem prévio consentimento por escrito da outra, salvo nas hipóteses das Cláusulas 15 e 18.
24.4. Disposições Inválidas. A eventual invalidade de uma cláusula não afetará as demais.
24.5. Tolerância. A tolerância ou o atraso no exercício de direito não implica renúncia.
24.6. Direitos Cumulativos. Os direitos previstos neste Contrato são cumulativos com os direitos previstos em lei.
24.7. Força Executiva. As obrigações deste Contrato têm força executiva extrajudicial (CPC, art. 784, III).
24.8. Força Maior. Caso fortuito e força maior suspendem as obrigações afetadas pelo período do impedimento, com notificação em 5 (cinco) Dias Úteis.
24.9. Assinatura Eletrônica. As Partes reconhecem como válida a assinatura por certificado digital ICP-Brasil e plataformas autorizadas (ClickSign, DocuSign, Autentique), nos termos da MP nº 2.200-2/2001 e Lei nº 14.063/2020.
24.10. Lei de Regência. Este Contrato é regido pelas leis da República Federativa do Brasil, em especial a Lei nº 8.245/1991 e o Código Civil.
## CLÁUSULA 25 — SOLUÇÃO DE CONTROVÉRSIAS E FORO
25.1. Surgida controvérsia, as Partes se comprometem a tentar, previamente à via judicial, resolução por mediação, no prazo de 30 (trinta) dias da notificação inaugural, perante câmara de mediação reconhecida ou mediador particular, custos rateados.
25.2. Frustrada a mediação, fica eleito o Foro da Comarca de São José do Rio Preto/SP, com renúncia a qualquer outro, para dirimir as questões oriundas deste Contrato.
## CLÁUSULA 26 — CONSIDERANDOS — FUNDAMENTAÇÃO
As Partes registram, para fins de interpretação deste Contrato:
(A) Que o LOCADOR é proprietário ou regularmente investido nos poderes de administração e disposição sobre o Imóvel;
(B) Que o LOCATÁRIO declara ter visitado e vistoriado o Imóvel, conhecendo seu estado, e tem interesse em utilizá-lo para o ramo de atividade descrito na Cláusula 2;
(C) Que a ADMINISTRADORA é sociedade especializada em intermediação imobiliária e administração de locações, regularmente inscrita no CRECI/SP sob nº {{empresa_creci}};
(D) Que a presente locação é não residencial, regida especialmente pelos arts. 51 a 57 da Lei nº 8.245/1991;
(E) Que as Partes celebram o presente Contrato no exercício de sua liberdade e autonomia contratual (arts. 421 e 421-A do Código Civil), cientes do dever de boa-fé objetiva (art. 422);
(F) Que este Contrato observará a LGPD, a Lei nº 9.613/1998 e a Resolução COFECI nº 36/2022 (PLD-FT), a Lei nº 12.846/2013 (Anticorrupção) e demais normas aplicáveis.
## CLÁUSULA 27 — DEFINIÇÕES E INTERPRETAÇÃO
27.1. Para os fins deste Contrato, os termos abaixo, sempre que utilizados em letra inicial maiúscula, terão os seguintes significados:
"ADMINISTRADORA" significa {{empresa_nome}};
"Aluguel" significa o valor mensal previsto na Cláusula 6.1.1, reajustado anualmente conforme a Cláusula 6.2;
"ANPD" significa Autoridade Nacional de Proteção de Dados;
"CNAE" significa Classificação Nacional de Atividades Econômicas;
"Dia Útil" significa qualquer dia, exceto sábados, domingos e feriados nacionais, estaduais (SP) ou municipais (São José do Rio Preto/SP);
"Imóvel" significa o bem identificado na Cláusula 1.2;
"Lei do Inquilinato" significa a Lei nº 8.245/1991;
"LGPD" significa a Lei nº 13.709/2018;
"PEP" significa Pessoa Exposta Politicamente, conforme Resolução COAF nº 40/2021;
"PLD-FT" significa Prevenção à Lavagem de Dinheiro e ao Financiamento do Terrorismo;
"Termo de Vistoria" significa o laudo descritivo do estado do Imóvel, lavrado nas datas de entrada, intermediárias e saída;
27.2. Os títulos têm função meramente referencial. As referências a leis e regulamentos compreendem suas alterações e sucessoras.
{{#condicoes_especiais}}## CONDIÇÕES ESPECIAIS E OBSERVAÇÕES
As Partes ajustam, ainda, as seguintes condições especiais, que prevalecem sobre as cláusulas gerais naquilo que com elas conflitarem:
{{condicoes_especiais}}
{{/condicoes_especiais}}
---
E, por estarem assim justos e contratados, as Partes assinam o presente Contrato, na presença das testemunhas abaixo identificadas.
São José do Rio Preto/SP, {{data_extenso}}.
## LOCADOR(A)
[[ASSINATURAS]]{{v1_nome}}|CPF/CNPJ {{v1_cpf}}{{#v2_nome}}||{{v2_nome}}|CPF {{v2_cpf}}{{/v2_nome}}
## LOCATÁRIO(A)
[[ASSINATURAS]]{{#locatario_razao}}{{locatario_razao}}|representada por {{/locatario_razao}}{{c1_nome}}|CPF {{c1_cpf}}{{#c2_nome}}||{{c2_nome}}|CPF {{c2_cpf}}{{/c2_nome}}
{{#f1_nome}}## FIADOR(A)
[[ASSINATURAS]]{{f1_nome}}|CPF {{f1_cpf}}{{#f2_nome}}||{{f2_nome}}|CPF {{f2_cpf}}{{/f2_nome}}
{{/f1_nome}}## ADMINISTRADORA
[[ASSINATURAS]]{{empresa_nome}}|Representante Legal: {{empresa_representante}}
## TESTEMUNHAS
[[ASSINATURAS]]{{testemunha1}}|1ª testemunha||{{testemunha2}}|2ª testemunha`,
  },

];
