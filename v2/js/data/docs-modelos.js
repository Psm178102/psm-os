/* ============================================================================
   PSM-OS v2 — Modelos PADRÃO do Gerador de Documentos  v88.12
   ----------------------------------------------------------------------------
   Textos transcritos dos modelos oficiais da biblioteca "Minutas padrão"
   (Drive do Paulo, versões 2026) — o conteúdo jurídico é o MESMO do Word
   original; só os "xxxx" viraram campos {{...}}. Qualquer ajuste de cláusula
   deve vir da advogada: o sócio edita o texto na própria tela (⚙️ Modelos) e
   a versão editada fica no banco (shared_kv docs_gerador) por cima desta.

   Fontes (22/09/2026):
   - proposta_cv  ← "Proposta de compra e venda 2026" (Drive 1Qxf-56vI84EPfbL5A-MWxN17ugIFCKmC)
   - contrato_cv  ← "Minuta preenchível - COMPRA E VENDA 2026" / "Ctt COMPRA E VENDA (2026)"
                    (Drive 1rHdi1pDEqPfgoA0UiK28UB8xle_oJwO-)
============================================================================ */

import { MODELOS_LOCACAO } from './docs-modelos-locacao.js';
import { MODELOS_EXTRA } from './docs-modelos-extra.js';

/* Imobiliárias que assinam/intermediam. O sócio corrige na tela ⚙️. */
export const EMPRESAS_PADRAO = {
  psm_negocios: {
    nome: 'PSM NEGÓCIOS & LOCAÇÃO LTDA',
    cnpj: '45.078.081/0001-80',
    creci: '50.431-J',
    banco: 'Banco Itaú, ag. 1569, c.c 97360-3',
    pix: '45.078.081/0001-80',
    fone: '(17) 99661-2193',
    email: 'comercial@imobiliariapsm.com.br',
    endereco: 'Av. Anísio Haddad, 8001 – Georgina Business Park, Torre Madri Norte, sala 202 – São José do Rio Preto/SP – CEP 15091-751',
    instagram: '@psm.imoveis',
    representante: '',
    logo: '/v2/img/logo-psm-imoveis-doc.png',
  },
  psm_assessoria: {
    nome: 'PSM ASSESSORIA & NEGÓCIOS IMOBILIÁRIOS LTDA',
    cnpj: '50.741.349/0001-52',
    creci: '43.471-J',
    banco: '',
    pix: '',
    fone: '(17) 99200-8291',
    email: 'comercial@imobiliariapsm.com.br',
    endereco: 'Av. Anísio Haddad, 8001 – Georgina Business Park, Torre Madri Norte, sala 202 – São José do Rio Preto/SP – CEP 15091-751',
    instagram: '@psm.imoveis',
    representante: '',
    logo: '/v2/img/logo-psm-imoveis-doc.png',
  },
  // Locação usa as mesmas empresas com o contato do setor (locacao@) — como nos modelos de 2026
  psm_negocios_locacao: {
    nome: 'PSM NEGÓCIOS & LOCAÇÃO LTDA', cnpj: '45.078.081/0001-80', creci: '50.431-J',
    banco: 'Banco Itaú, ag. 1569, c.c 97360-3', pix: '45.078.081/0001-80',
    fone: '(17) 99600-2192', email: 'locacao@imobiliariapsm.com.br',
    endereco: 'Av. Anísio Haddad, 8001 – Georgina Business Park, Torre Madri Norte, sala 202 – São José do Rio Preto/SP – CEP 15091-751',
    instagram: '@psm.imoveis', representante: '', logo: '/v2/img/logo-psm-imoveis-doc.png',
  },
  psm_assessoria_locacao: {
    nome: 'PSM ASSESSORIA E NEGÓCIOS IMOBILIÁRIOS LTDA', cnpj: '50.741.349/0001-52', creci: '43.471-J',
    banco: '', pix: '',
    fone: '(17) 99661-2193', email: 'locacao@imobiliariapsm.com.br',
    endereco: 'Av. Anísio Haddad, 8001 – Georgina Business Park, Torre Madri Norte, sala 202 – São José do Rio Preto/SP – CEP 15091-751',
    instagram: '@psm.imoveis', representante: '', logo: '/v2/img/logo-psm-imoveis-doc.png',
  },
};

export const PADROES_GERAIS = {
  cidade_foro: 'São José do Rio Preto-SP',
  testemunha1: 'Isabella Flores Morimatsu',
  testemunha2: 'Mariane Evaristo Barbosa da Silva',
};

/* ─────────────── campos que aparecem no formulário ───────────────
   [chave, rótulo, grupo, tipo]  tipo: text | area | data | valor | pct | select:a;b;c
   Os campos das PESSOAS (c1_, c2_, v1_, v2_) são gerados por PESSOA_CAMPOS. */
export const ESTADOS_CIVIS = ['solteiro(a)', 'casado(a)', 'união estável', 'divorciado(a)', 'viúvo(a)', 'separado(a)'];
export const REGIMES = ['comunhão parcial de bens', 'comunhão universal de bens', 'separação total de bens', 'participação final nos aquestos'];
export const PESSOA_CAMPOS = [
  ['nome', 'Nome completo', 'text'],
  ['cpf', 'CPF', 'text'],
  ['rg', 'RG (com órgão emissor)', 'text'],
  ['nascimento', 'Data de nascimento', 'data'],
  ['nacionalidade', 'Nacionalidade', 'text'],
  ['estado_civil', 'Estado civil', 'select:' + ESTADOS_CIVIS.join(';')],
  ['regime', 'Regime de casamento', 'select:' + REGIMES.join(';')],
  ['profissao', 'Profissão', 'text'],
  ['email', 'E-mail', 'text'],
  ['fone', 'Telefone', 'text'],
  ['endereco', 'Endereço completo (rua, nº, bairro, cidade/UF, CEP)', 'text'],
];
/* c = quem compra/aluga · v = quem vende/é dono · f = fiador. Cada modelo pode
   renomear os papéis em `papeis` (ex.: locatário/locador, contratante). */
export const PESSOAS = {
  c1: '1º comprador', c2: 'Cônjuge / 2º comprador',
  v1: '1º vendedor', v2: 'Cônjuge / 2º vendedor',
  f1: 'Fiador(a)', f2: 'Cônjuge do fiador(a)',
};

export const CAMPOS = {
  imovel_empreendimento: ['Empreendimento / edifício', 'Imóvel', 'text'],
  imovel_unidade: ['Unidade / bloco / torre', 'Imóvel', 'text'],
  imovel_endereco: ['Endereço completo do imóvel', 'Imóvel', 'text'],
  imovel_cep: ['CEP do imóvel', 'Imóvel', 'text'],
  imovel_area: ['Área privativa (m²)', 'Imóvel', 'text'],
  imovel_matricula: ['Matrícula nº', 'Imóvel', 'text'],
  imovel_cartorio: ['Cartório de Registro de Imóveis', 'Imóvel', 'text'],
  imovel_matriculas_texto: ['Matrícula(s) como vai no contrato (ex.: matrícula nº 14.376 do 2º CRI de São José do Rio Preto-SP)', 'Imóvel', 'text'],
  imovel_descricao: ['Descrição do imóvel (transcrição da matrícula)', 'Imóvel', 'area'],
  valor: ['Valor (R$)', 'Negócio', 'valor'],
  valor_ato: ['Valor do ato / sinal (R$)', 'Negócio', 'valor'],
  forma_pagamento: ['Forma de pagamento', 'Negócio', 'select:À vista;Parcelado;Financiamento bancário;Carta de crédito/consórcio;Permuta'],
  condicoes: ['Condições da proposta (uma por linha)', 'Negócio', 'area'],
  condicoes_especiais: ['Condições especiais e observações do contrato (uma por linha — vazio = cláusula não aparece)', 'Negócio', 'area'],
  pagamento_detalhe: ['Como o valor será pago (texto da cláusula 3ª)', 'Negócio', 'area'],
  prazo_desistencia: ['Prazo sem multa para desistência (dias)', 'Negócio', 'text'],
  aluguel: ['Aluguel mensal (R$)', 'Locação', 'valor'],
  dia_vencimento: ['Dia do vencimento do aluguel', 'Locação', 'text'],
  prazo_meses: ['Prazo da locação (meses)', 'Locação', 'text'],
  data_inicio: ['Início da locação', 'Locação', 'data'],
  data_fim: ['Término previsto', 'Locação', 'data'],
  finalidade: ['Finalidade', 'Locação', 'select:Residencial;Comercial;Industrial;Misto'],
  uso_imovel: ['Uso do imóvel', 'Locação', 'select:residencial;comercial;industrial;misto'],
  outras_condicoes: ['Outras condições de uso e/ou alterações', 'Locação', 'area'],
  seguro_incendio: ['Cobertura mínima do seguro incêndio (R$)', 'Locação', 'valor'],
  taxa_adm_pct: ['Taxa de administração (%)', 'Locação', 'pct'],
  garantia: ['Garantia locatícia', 'Garantia', 'select:Fiança;Seguro-fiança;Título de capitalização;Caução'],
  garantia_instituicao: ['Seguradora / instituição da garantia', 'Garantia', 'text'],
  garantia_numero: ['Nº da apólice / do título', 'Garantia', 'text'],
  garantia_vigencia: ['Vigência da apólice (de … a …)', 'Garantia', 'text'],
  garantia_cobertura: ['Cobertura (nº de aluguéis e encargos)', 'Garantia', 'text'],
  garantia_valor: ['Valor do título de capitalização (R$)', 'Garantia', 'valor'],
  imovel_tipologia: ['Tipologia (apto, casa, sala…, nº, edifício/condomínio)', 'Imóvel', 'text'],
  locatario_razao: ['Razão social do locatário (se empresa — vazio = pessoa física)', 'Locatário empresa', 'text'],
  locatario_cnpj: ['CNPJ do locatário', 'Locatário empresa', 'text'],
  locatario_sede: ['Sede do locatário (endereço completo)', 'Locatário empresa', 'text'],
  pj_razao: ['Razão social (se a parte for empresa — vazio = pessoa física)', 'Parte empresa', 'text'],
  pj_cnpj: ['CNPJ da empresa', 'Parte empresa', 'text'],
  pj_sede: ['Sede da empresa (endereço completo)', 'Parte empresa', 'text'],
  imovel_bloco: ['Bloco / pavimento', 'Imóvel', 'text'],
  imovel_area_comum: ['Área comum (m²)', 'Imóvel', 'text'],
  imovel_area_total: ['Área total (m²)', 'Imóvel', 'text'],
  imovel_fracao: ['Fração ideal', 'Imóvel', 'text'],
  imovel_rural: ['Se rural: INCRA nº e NIRF nº', 'Imóvel', 'text'],
  incorporadora: ['Incorporadora (razão social, sede, CNPJ, registro)', 'Cessão', 'area'],
  contrato_origem: ['Contrato de origem cedido', 'Cessão', 'text'],
  posse_clausula: ['Como a posse é transferida (cláusula 4ª)', 'Cessão', 'area'],
  prazo_cessao: ['Prazo para a cessão definitiva após a quitação (dias)', 'Cessão', 'text'],
  data_visita: ['Data da visita', 'Visita', 'data'],
  visita1_endereco: ['Imóvel 1 · endereço', 'Visita', 'text'],
  visita1_empreendimento: ['Imóvel 1 · empreendimento/condomínio', 'Visita', 'text'],
  visita1_unidade: ['Imóvel 1 · unidade (nº ou quadra/lote)', 'Visita', 'text'],
  visita2_endereco: ['Imóvel 2 · endereço (vazio = só 1 imóvel)', 'Visita', 'text'],
  visita2_empreendimento: ['Imóvel 2 · empreendimento/condomínio', 'Visita', 'text'],
  visita2_unidade: ['Imóvel 2 · unidade', 'Visita', 'text'],
  corretor_creci: ['CRECI do corretor', 'Assinaturas', 'text'],
  ramo_atividade: ['Ramo de atividade', 'Atividade', 'text'],
  cnae_principal: ['CNAE principal', 'Atividade', 'text'],
  cnae_secundarios: ['CNAE(s) secundário(s) admitido(s)', 'Atividade', 'text'],
  horario_funcionamento: ['Horário de funcionamento previsto', 'Atividade', 'text'],
  imovel_iptu: ['Código IPTU / cadastro municipal', 'Imóvel', 'text'],
  imovel_cpfl: ['Código CPFL (energia)', 'Imóvel', 'text'],
  imovel_semae: ['Código SeMAE (água/esgoto)', 'Imóvel', 'text'],
  imovel_condominio: ['Administradora do condomínio (razão social, CNPJ, contato)', 'Imóvel', 'text'],
  imovel_senha: ['Senha da fechadura eletrônica (se houver)', 'Imóvel', 'text'],
  imovel_mobilia: ['Acessórios e mobília (se houver)', 'Imóvel', 'area'],
  locador_banco: ['Conta do proprietário p/ repasses (banco, agência, conta, tipo, PIX)', 'Imóvel', 'text'],
  comissao_pct: ['Comissão (%)', 'Comissão', 'pct'],
  comissao_quando: ['Quando a comissão é paga', 'Comissão', 'text'],
  corretor_nome: ['Corretor responsável', 'Assinaturas', 'text'],
  testemunha1: ['1ª testemunha', 'Assinaturas', 'text'],
  testemunha2: ['2ª testemunha', 'Assinaturas', 'text'],
  cidade_foro: ['Foro (comarca)', 'Assinaturas', 'text'],
  data_doc: ['Data do documento', 'Assinaturas', 'data'],
};

/* Variáveis CALCULADAS (não aparecem no formulário) — referência pro editor */
export const CALCULADAS = {
  empresa_nome: 'Razão social da imobiliária escolhida',
  empresa_cnpj: 'CNPJ', empresa_creci: 'CRECI', empresa_banco: 'Dados bancários', empresa_pix: 'PIX',
  empresa_endereco: 'Endereço', empresa_fone: 'Telefone', empresa_email: 'E-mail',
  valor_moeda: 'R$ 190.000,00', valor_extenso: 'R$ 190.000,00 (cento e noventa mil reais)',
  valor_ato_extenso: 'sinal por extenso',
  comissao_pct_extenso: '5% (cinco por cento)', comissao_valor_extenso: 'valor da comissão por extenso',
  compradores_qualificacao: 'qualificação completa dos compradores (texto corrido)',
  vendedores_qualificacao: 'qualificação completa dos vendedores (texto corrido)',
  data_extenso: '23 de setembro de 2026',
  data_doc_br: '23/09/2026',
  data_visita_br: 'data da visita dd/mm/aaaa',
  aluguel_extenso: 'R$ 3.500,00 (três mil e quinhentos reais)',
  data_inicio_br: 'início dd/mm/aaaa', data_fim_br: 'término dd/mm/aaaa',
  garantia_maiuscula: 'FIANÇA / SEGURO-FIANÇA / …',
  garantia_fianca: 'marcador: garantia = fiança (use em {{#garantia_fianca}}…{{/garantia_fianca}})',
  garantia_seguro: 'marcador: garantia = seguro-fiança', garantia_titulo: 'marcador: garantia = título de capitalização',
  taxa_adm_pct_extenso: '10% (dez por cento)',
  locadores_qualificacao: 'qualificação dos locadores/proprietários (v1+v2) com telefone',
  locatarios_qualificacao: 'qualificação dos locatários (c1+c2) com telefone',
  fiadores_qualificacao: 'qualificação do fiador e cônjuge (f1+f2)',
  empresa_representante: 'representante legal da imobiliária',
  c1_estado_civil_linha: 'estado civil + regime numa linha (idem c2_, v1_, v2_)',
  c1_nascimento_br: 'nascimento dd/mm/aaaa (idem c2_, v1_, v2_)',
};

/* ─────────────── MODELOS ─────────────── */
export const MODELOS_PADRAO = [
  {
    id: 'proposta_cv',
    titulo: 'Proposta de compra e venda',
    categoria: 'Compra e venda',
    empresa: 'psm_assessoria',
    arquivo: 'Proposta de compra e venda',
    corpo: `# PROPOSTA DE COMPRA E VENDA DE IMÓVEL E OUTRAS AVENÇAS
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
## PROMISSÁRIO COMPRADOR(A)(S):
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
## CÔNJUGE E/OU 2º COMPRADOR(A)(S):
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
## DADOS DO IMÓVEL:
**EMPREENDIMENTO / UNIDADE:** {{imovel_empreendimento}} – {{imovel_unidade}}
**ENDEREÇO COMPLETO:** {{imovel_endereco}}
**CEP:** {{imovel_cep}}
**ÁREA PRIVATIVA:** {{imovel_area}}
**MATRÍCULA NÚMERO:** {{imovel_matricula}}
**CARTÓRIO DE REGISTRO DE IMÓVEIS:** {{imovel_cartorio}}
**COMARCA:** {{cidade_foro}}
---
**VALOR PROPOSTO:** {{valor_extenso}}
**FORMA DE PAGAMENTO:** {{forma_pagamento}}
## CONDIÇÕES DA PROPOSTA:
{{condicoes}}
---
## PROMITENTE VENDEDOR(A)(S):
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
## CÔNJUGE E/OU 2º VENDEDOR(A)(S):
**NOME:** {{v2_nome}}
**RG:** {{v2_rg}}
**CPF:** {{v2_cpf}}
**DATA DE NASCIMENTO:** {{v2_nascimento_br}}
**E-MAIL:** {{v2_email}}
**ESTADO CIVIL / REGIME DE CASAMENTO:** {{v2_estado_civil_linha}}
**NACIONALIDADE:** {{v2_nacionalidade}}
**PROFISSÃO:** {{v2_profissao}}
{{/v2_nome}}---
## DISPOSIÇÕES GERAIS:
1) A presente proposta, uma vez aceita formalmente pela parte contrária (cedente/vendedor), torna-se irrevogável e irretratável, obrigando ambas as partes aos seus termos e condições.
2) Após aceita pelo(s) cedente(s)/proprietário(s)/vendedor(es) a proposta tornar-se-á um contrato preliminar, nos moldes estabelecidos no art. 462 a 466 do Código Civil, sendo que as partes se obrigam a cumpri-la no prazo máximo de 07 (sete) dias contados do aceite.
3) Após aceita a proposta, o(s) proprietário(s) vendedores no prazo estipulado acima, providenciarão todos os documentos relacionados ao imóvel e seus proprietários para que seja realizada a due diligence, oportunidade que referidos documentos não apontando nenhuma causa impeditiva, será elaborado o competente contrato e, agendada a data e local para outorga da escritura.
3.1) havendo qualquer apontamento nos documentos apresentados, o(s) proprietário(s) vendedor(es) deverão apresentar certidão de objeto e pé e ou esclarecimentos sobre os mesmos.
4) A parte que der causa ao arrependimento ou a inexecução do contrato preliminar suportará, além das perdas e danos devidas à parte inocente, o pagamento imediato dos honorários profissionais do corretor de imóveis, no mesmo percentual estabelecido nos termos da Lei e regulamentados pelo CRECI/SP, nos moldes estabelecidos no art. 725 do Código Civil.
6) A presente proposta é confidencial nos termos da lei e, não poderá em hipótese alguma ser divulgada sob pena de ferir a LGPD.
7) A comissão deverá ser suportada pelo(s) proprietário(s) vendedor(es) no valor equivalente a {{comissao_pct_extenso}} do negócio realizado.
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
Por terem lido e por estarem as partes em pleno acordo com o disposto neste instrumento, assinam-no conjuntamente com as testemunhas de forma eletrônica, por meio do certificado digital e/ou de plataformas de assinatura eletrônica, devidamente autorizadas pela Infraestrutura de Chaves Públicas Brasileira – ICP-Brasil (e.g., ClickSign), em conformidade com a MP nº 2.200-2/2001 e a Lei 14.063 e, serão consideradas como assinaturas válidas, sendo este Contrato, conforme seus próprios termos e no que for aplicável, considerado como exequível, válido e vigente entre as Partes.
---
{{cidade_foro}}, {{data_extenso}}.
## ASSINATURA DO(S) PROPONENTE(S) COMPRADOR(ES):
[[ASSINATURAS]]{{c1_nome}}|1º PROPONENTE COMPRADOR{{#c2_nome}}||{{c2_nome}}|2º PROPONENTE COMPRADOR{{/c2_nome}}
[[ASSINATURAS]]{{empresa_nome}}|Corretor(a): {{corretor_nome}}
## ASSINATURA DO(S) PROPRIETÁRIO(S)/VENDEDOR(ES):
[[ASSINATURAS]]{{v1_nome}}|1º PROPONENTE VENDEDOR{{#v2_nome}}||{{v2_nome}}|2º PROPONENTE VENDEDOR{{/v2_nome}}`,
  },
  {
    id: 'contrato_cv',
    titulo: 'Contrato de compra e venda',
    categoria: 'Compra e venda',
    empresa: 'psm_negocios',
    arquivo: 'Contrato de compra e venda',
    corpo: `# INSTRUMENTO PARTICULAR DE CONTRATO DE VENDA E COMPRA DE BEM IMÓVEL E OUTRAS AVENÇAS
**{{valor_moeda}}**
---
Pelo presente instrumento e na melhor forma de direito, de um lado como PROMITENTE(S) VENDEDOR(ES): {{vendedores_qualificacao}}, e, de outro lado, como PROMISSÁRIO(S) COMPRADOR(ES): {{compradores_qualificacao}}, firmam entre si, justo, combinado e contratado, o seguinte negócio de venda e compra de bem imóvel, conforme cláusulas e condições abaixo pactuadas.
## DO OBJETO:
Cláusula 1ª - Constitui objeto deste instrumento a promessa de venda e compra, irrevogável e irretratável (exceto no caso de inadimplência do PROMISSÁRIO COMPRADOR, no tocante ao preço ajustado na Cláusula 3ª), que os PROMITENTES VENDEDORES, fazem ao PROMISSÁRIO COMPRADOR, pelo preço, forma de pagamento, e demais condições a seguir pactuadas, o(s) imóvel(is), oriundo(s) da {{imovel_matriculas_texto}}, a seguir descrito(s), que o fazem de comum acordo, considerando que ambas as partes: a) tem ciência da atual situação socioeconômica do País; b) tem plena ciência das cláusulas, condições e seus impactos ora firmados, exceto nos casos em que dependermos de qualquer repartição pública ou bancária. c) possuem plena capacidade para honrar o contrato ora firmado o qual permanecerá intacto, independentemente de qualquer mudança governamental ou socioeconômica global e, d) compreendem o que de fato está escrito.
---
{{imovel_descricao}}
---
Declaram os PROMISSÁRIOS COMPRADORES que vistoriaram o imóvel, e que o presente compromisso é celebrado em caráter “ad corpus”.
Os PROMISSÁRIOS COMPRADORES declaram ter vistoriado o local por tempo e modo suficiente para realização do negócio, tendo visitado o imóvel e a vizinhança em dias e horários distintos, e adquiri-lo no estado em que se encontra, admitem inteiramente, de acordo com a exposição que lhes foi feita, nada tendo a reclamar ou exigir, sendo que os PROMITENTES(S) VENDEDOR(ES) comprometem a entregá-lo com todas as contas de consumo, tributos, taxas e demais encargos incidentes sob imóvel devidamente quitadas e, livre de pessoas e coisas, inclusive devidamente averbado.
Os PROMISSÁRIOS COMPRADORES previamente diligenciaram junto aos órgãos públicos competentes, para conhecerem quanto ao uso e ocupação do solo de acordo com o plano diretor e a Lei de posturas, e o imóvel recebido atende as expectativas.
Os PROMITENTES VENDEDORES declaram para os devidos fins que, o imóvel objetos deste contrato foi adquirido por eles exclusivamente, sem a participação ou intervenção de terceiros, podendo livremente dispor.
O imóvel transacionado está inserido em condomínio, e existem normas e regras internas, os PROMISSÁRIOS COMPRADORES declaram expressamente que delas tem conhecimento, se obrigando a respeitar integralmente, bem como, pagar as taxas necessárias, ainda que decorrente de infrações, desde que imitidos na posse.
Cláusula 2ª - Por força deste instrumento, os PROMITENTES VENDEDORES prometem vender, como de fato vendido fica aos PROMISSÁRIOS COMPRADORES, o imóvel especificado na cláusula anterior, totalmente livre e desembaraçado de quaisquer ônus reais, pessoais ou fiscais, judiciais ou extrajudiciais, demais gravames, hipotecas legais ou convencionais, dúvidas, dívidas, litígios, penhora, impostos, taxas ou restrições de qualquer natureza.
2.1. Os PROMITENTES VENDEDORES declaram, ainda, que o imóvel retro não é objeto de penhora ou de discussão em nenhuma esfera das áreas cível, criminal, fiscal, trabalhista, previdenciária e eleitoral, bem como ainda, que sua alienação não compromete o patrimônio dos PROMITENTES VENDEDORES possibilitando com isso a presente venda.
## DO PREÇO, DA FORMA E DAS CONDIÇÕES DE PAGAMENTO:
Cláusula 3ª – Tendo em vista a natureza do presente instrumento, foi atribuído valor ao bem transacionado e, para fins fiscais fica estipulado o valor de {{valor_extenso}}, sendo que pelo imóvel dos VENDEDORES, os COMPRADORES pagarão o referido valor da seguinte forma:
{{pagamento_detalhe}}
Os pagamentos descritos acima são em caráter PRÓ-SOLVENDO.
A presente transação está sendo realizada em caráter ad corpus, não cabendo dessa forma nenhuma reclamação sobre os imóveis seja a que título for;
A mora dos PROMISSÁRIOS COMPRADORES no cumprimento da obrigação pecuniária assumida na cláusula 3ª, na data e valor supras aprazados, acarretar-lhe-á a responsabilidade nas seguintes penalidades:
Multa de 10% (dez por cento), além de correção monetária, respeitando os índices do IGPM/FGV, calculado “pro rata die”;
Juros de mora no percentual de 1% (um por cento) ao mês, ou fração, calculados dia a dia, que incidirão sobre o valor pendente;
Se houver necessidade, honorários de advogado, na base de 10% (dez por cento) se extrajudicial e 20% (vinte por cento) se judicial, sobre o valor total do débito atualizado, bem como as respectivas despesas de cobranças.
Na hipótese de inadimplemento dos PROMISSÁRIOS COMPRADORES no cumprimento das obrigações assumidas na cláusula 3ª, acima, poderão os PROMITENTES VENDEDORES após decorridos 10 (dez) dias da inadimplência (independentemente de qualquer notificação) optar, a seu único e exclusivo critério, por:
Ou, considerar vencida por antecipação a totalidade do preço, e, por consequência, compelir judicialmente os PROMISSÁRIOS COMPRADORES a efetivarem o pagamento do valor remanescente, acrescido da multa por descumprimento contratual estipulada abaixo, tudo cobrável mediante o ajuizamento da ação competente, considerando este documento como título extrajudicial (artigo 784, inciso III, do CPC);
Ou, então, renunciando à faculdade acima prevista, considerar resolvido, de pleno direito e em sua integralidade, o presente contrato, mediante simples notificação extrajudicial, inclusive por WhatsApp.
A desistência de ambas as partes antes do prazo de {{prazo_desistencia}} dias corridos, a contar da data de assinatura deste instrumento, acarretará em multa contratual de 10% (dez por cento), além de correção monetária, respeitando os índices do IGPM/FGV do valor de compra e venda.
Em caso de não apresentação da averbação de quitação do financiamento na matrícula do imóvel após o prazo respeitado dos {{prazo_desistencia}} dias corridos, os PROMISSÁRIOS COMPRADORES possuirão o direito de desistir do presente contrato, sem mais ônus.
Fica desde já, estabelecido entre as partes que será extinto o presente contrato por resolução do contrato em CLÁUSULA RESOLUTIVA EXPRESSA em caso de inadimplemento, pactuado entre a partes. Esta cláusula, terá seus efeitos e eficácia caso não seja efetuado o pagamento nos termos da cláusula 3.4, voltará o presente contrato ao status “quo ante” anterior a assinatura deste contrato, nos termos dos art. 418 e 419 do Código Civil. Os PROMITENTES VENDEDORES considerarão rescindido o presente contrato com a consequente reintegração de posse. Não havendo mais interesse na venda.
No caso de rescisão, por CLÁUSULA RESOLUTIVA EXPRESSA, as benfeitorias eventualmente realizadas se incorporarão ao imóvel. Ficando extinto o contrato por INADIMPLEMENTO.
Qualquer recebimento fora do prazo, pelos PROMITENTES VENDEDORES, será considerado mera liberalidade, não alterando qualquer cláusula do presente contrato.
A tolerância ao recebimento fora do prazo e forma estabelecida neste instrumento ou o não exercício de qualquer direito acima previsto constituirá mera liberalidade dos PROMITENTES VENDEDORES, que não afetará de forma alguma as demais cláusulas e condições do presente instrumento, nem importará novação ou modificação do ora ajustado, inclusive quanto aos encargos resultantes da mora.
## DA POSSE:
Cláusula 4ª - A posse provisória do imóvel objeto deste instrumento será transmitida após o pagamento descrito na cláusula 3ª, a; sendo que a posse definitiva se dará com a outorga da Escritura Pública de Venda e Compra.
No ato da outorga da posse, as partes convalidam a devida “tradição”, conforme dispõe o artigo 1.267 do CC do imóvel descrito neste instrumento.
No ato da tradição, os PROMITENTES VENDEDORES deverão exibir as contas de consumo devidamente quitadas, referente ao mês corrente e a do mês anterior, observando que caso na data da tradição ainda não tenha sido emitida a fatura referente a uma ou mais contas de consumo do imóvel, comprometem-se a realizar o acerto das contas na data em que a referida fatura for disponibilizada.
Deverão os PROMISSÁRIOS COMPRADORES promover os necessários ajustes nos cadastros das concessionárias de serviço público.
## DA ESCRITURA PÚBLICA:
Cláusula 5ª - A Escritura Pública de Venda e Compra ou documento equivalente do Imóvel objeto deste instrumento será outorgada pelos VENDEDORES em favor dos PROMISSÁRIOS COMPRADORES ou a quem os estes expressamente indicarem, após o pagamento integral do valor descrito na cláusula 3ª.
5.1. Todas as despesas necessárias para a transmissão definitiva do referido imóvel, através da lavratura da escritura pública de compra e venda ou documento equivalente, bem como seu registro no cartório competente, e ainda os impostos de transmissão incidentes sobre a venda, serão de responsabilidade exclusiva dos PROMISSÁRIOS COMPRADORES.
5.2 Negando-se os PROMITENTES VENDEDORES a outorgarem as escrituras definitivas ou documento equivalente pela qual se obrigaram, poderão ser compelidos a fazê-lo através de ação de adjudicação compulsória, sem prejuízo da cobrança da multa por descumprimento contratual estipulada neste instrumento.
## DOS ÔNUS, TRIBUTOS E MULTAS:
Cláusula 6ª - Os PROMITENTES VENDEDORES declaram inexistir, até a data da assinatura do presente instrumento, qualquer tributo em atraso, sendo certo, que eventual tributo ou despesa pendente (não descrita nos itens acima mencionados), ficará por conta dos VENDEDORES.
6.1. Já os tributos incidentes após a outorga da posse do imóvel objeto do presente instrumento, serão de responsabilidade exclusiva dos PROMISSÁRIOS COMPRADORES.
Cláusula 7ª - A presente transação é feita livre de ônus, dívidas, encargos, hipotecas legais ou convencionais, razão pela qual os PROMITENTES VENDEDORES respondem pelos riscos de evicção do imóvel objeto deste.
## DAS CONDIÇÕES GERAIS:
Cláusula 8ª - Os PROMITENTES VENDEDORES e PROMISSÁRIOS COMPRADORES declaram expressamente que não possuem títulos protestados, e não existem ações contra eles em processamento, que impossibilitem ou o presente negócio; declaram também que não possuem passivos ou embaraços jurídicos em seus nomes e que possam, de alguma forma, onerar o imóvel e/ou frustrar a viabilidade jurídica deste negócio por eventual fraude à execução ou a credores; declaram ainda que não estão sujeitos as exigências previdenciárias para este ato e que não possuem em trâmite ação fundada em direito real ou pessoal reipersecutória, que tenha incidência sobre o imóvel objeto do presente contrato e que de alguma forma possa prejudicá-lo.
8.1. Os PROMITENTES VENDEDORES e PROMISSÁRIOS COMPRADORES declaram, sob responsabilidade civil e criminal, que o imóvel objeto deste Contrato está completamente livre e desembaraçado de todos e quaisquer ônus reais, pessoais ou fiscais, judiciais ou extrajudiciais, demais gravames, hipotecas legais ou convencionais, dúvidas, dívidas, litígios, penhora, impostos, taxas ou restrições de qualquer natureza, tampouco quanto as suas pessoas e de que não estão vinculados ao Instituto Nacional do Seguro Social como empregador ou produtor rural.
Cláusula 9ª - Declaram os PROMITENTES VENDEDORES e PROMISSÁRIOS COMPRADORES que não existem pendências trabalhistas e previdenciárias que possam afetar este negócio, assumindo o mesmo todos os encargos dessa natureza com respeito a fatos geradores verificados até esta data.
Cláusula 10ª - Nenhuma das partes poderá ser responsabilizada pela falta de cumprimento de suas obrigações quando motivada por caso fortuito ou de força maior, conforme disposto no artigo 393 e seu parágrafo único do Código Civil, tais como, exemplificativamente, mas não exaustivamente, greves, comoções sociais, incêndios, enchentes, terremotos, atos de autoridades competentes impedindo, restringindo ou retardando o funcionamento de qualquer das partes, que inviabilizem a execução do presente Instrumento. Tal desoneração prevalecerá pelo tempo e na medida em que a parte inadimplente estiver sob a ação do evento, cabendo-lhe dar imediato aviso à outra parte das razões e da extensão do fato, bem como da data em que for possível o reinício do cumprimento do Instrumento.
Cláusula 11ª - O presente negócio de compra e venda é irrevogável e irretratável, com exceção das cláusulas resolutivas aqui eventualmente expressas, obrigando não só as partes contratantes, mas também seus herdeiros e/ou sucessores a qualquer título, para honrá-lo em sua plenitude. As partes contratantes renunciam também expressamente o direito de arrependimento, sendo, por isso, obrigatória à outorga e aceitação da escritura definitiva de venda e compra nos termos aqui ajustados.
Cláusula 12ª - A infração a qualquer cláusula deste instrumento ou ainda a parte que obrigar a outra a ingressar em juízo, para o cumprimento total ou parcial desta avença, ficará sujeita à multa de 10% (dez por cento) e juros de mora de 1% (um por cento) ao mês sobre o valor da venda ou, em se tratando do INTERMEDIADOR, o valor da comissão de intermediação, além de arcar com custas, despesas processuais e honorários advocatícios da parte inocente, independentemente da aplicação de quaisquer outras penalidades por ventura aplicadas ou devidas.
Cláusula 13ª - As partes não poderão ceder e/ou transferir, no todo ou em parte, os direitos e obrigações resultantes deste contrato, sem que haja anuência por escrito da outra.
## DAS CONDIÇÕES GERAIS
Cláusula 14ª - 14.o Efeito Vinculante. O presente Contrato consiste em uma obrigação irrevogável das Partes e de seus respectivos sucessores e cessionários autorizados, exceto nos casos expressamente previstos no presente instrumento, especialmente na CLÁUSULA DE RESOLUÇÃO EXPRESSA.
- Acordo Integral. O presente consiste no acordo integral firmado entre as Partes, devendo prevalecer sobre todos e quaisquer acordos e entendimentos anteriores, sejam eles verbais ou escritos, a respeito do objeto deste Contrato.
- Alterações. Nenhuma alteração a qualquer um dos termos ou condições previstas no presente Contrato deverá ter qualquer efeito, a menos que ela seja feita por escrito e assinada por cada uma das Partes.
- Cessão. Nenhuma das Partes poderá ceder ou transferir qualquer direito ou obrigação decorrente do presente Contrato ou relacionado a ele sem o consentimento prévio por escrito das outras Partes.
- Disposições Inválidas. Caso qualquer disposição ou parte de uma disposição deste Contrato seja considerada por qualquer tribunal de jurisdição competente, inválida ou inexequível, tal invalidez ou inexequibilidade não afetará as outras disposições ou partes desta disposição ou deste Contrato, sendo que todas permanecerão em pleno vigor e efeito. As Partes deverão negociar de boa-fé a substituição da disposição inválida, ilegal ou inexequível por disposições válidas, legais e exequíveis cujo efeito econômico e outras implicações relevantes fiquem o mais próximo possível do efeito econômico e de outras implicações relevantes da referida disposição inválida, ilegal ou inexequível.
- Renúncia e tolerância. As Partes reconhecem que, salvo se de outro modo expressamente aqui previsto: (i) o exercício parcial, o não exercício, a concessão de um prazo, a tolerância ou o atraso em relação a qualquer direito concedido a elas pelo presente Contrato e/ou por Lei não deverá consistir em renovação ou renúncia a esse direito, tampouco deverá prejudicar o seu exercício no futuro; (ii) a renúncia a qualquer direito deverá ser interpretada de modo restrito e não deverá ser considerada como uma renúncia a qualquer outro direito conferido pelo presente Contrato ou por Lei a qualquer uma das Partes; e (iii) quaisquer renúncias somente serão consideradas se concedidas por escrito.
- Taxas, Tributos e Despesas. Cada uma das Partes deverá arcar com suas respectivas taxas, Tributos (e deverão entregar todas as declarações, relatórios ou outros protocolos necessários em relação a todos os Tributos) e despesas (incluindo o pagamento de quaisquer comissões e/ou representações que possam ser devidas por qualquer uma delas a terceiros, tais como corretores, agentes, negociantes, consultores ou quaisquer outras pessoas que tenham sido contratadas pela respectiva Parte, bem como os custos de registro e outros protocolos de qualquer tipo, seja qual for) relacionados à negociação e à conclusão da Transação e à preparação, assinatura e implementação do presente Contrato e de qualquer outro contrato ou documento nele contemplado, exceto se de outra forma estiver expressamente previsto neste Contrato.
- Contrato Válido e Exequível. Este Contrato foi devidamente celebrado e formalizado pelas Partes e constitui obrigação legalmente válida e vinculante. As Partes reconhecem todos os termos e condições deste Contrato, comprometendo-se a cumprir todas as suas disposições e a comunicar imediatamente as outras Partes sobre a existência de qualquer ato, fato ou omissão que possa constituir uma violação deste Contrato, bem como a tomar qualquer providência que possa vir a ser exigida para a manutenção da validade e eficácia deste Contrato.
- Força Maior. Nenhuma das Partes terá obrigações perante a outra Parte por atos fortuitos ou casos de força maior imprevistos e inevitáveis, que afetarem a capacidade dessa Parte de cumprir suas obrigações segundo este instrumento, sendo certo, no entanto, que cada uma das Partes se obriga a envidar seus melhores esforços, respectivamente, para minimizar a extensão e o impacto de tal incapacidade.
14.09 - Assinatura Digital. As Partes acordam que as assinaturas eletrônicas do presente Contrato, por meio do certificado digital e/ou de plataformas de assinatura eletrônica, devidamente autorizadas pela Infraestrutura de Chaves Públicas Brasileira – ICP-Brasil (e.g., ClickSign), serão consideradas como assinaturas válidas, sendo este Contrato, conforme seus próprios termos e no que for aplicável, considerado como exequível, válido e vigente entre as Partes.
Cláusula 15ª - DA CONFIDENCIALIDADE. Todas as informações, dados, documentos, e informações que forem disponibilizadas entre os contratantes, para execução do objeto do presente Contrato, são e serão consideradas, a todo momento, e mesmo após o encerramento da vigência, como confidenciais.
15.1- Os contratantes comprometem-se, por si e seus prepostos, a manter como confidenciais todos as informações que tomem conhecimento por ocasião do presente contrato.
15.2- É terminantemente proibida, no todo ou em parte, a divulgação, utilização ou pulverização de informação, utilização ou fornecimento de conhecimentos por qualquer meio, para fins diversos daqueles objetos do presente Contrato, das Informações Confidenciais sem o prévio e expresso consentimento da outra parte.
15.3 Os contratantes comprometem-se a manter e preservar o caráter confidencial e sigiloso das Informações Confidenciais não permitindo que terceiros tenham ou venham a ter acesso, publiquem ou divulguem as Informações Confidenciais, ainda que parcialmente, a qualquer momento, sem a autorização formal e exclusiva.
15.4- A menos que seja exigido por lei, nacional ou estrangeira, por critérios de governança corporativa ou obrigatoriedade de divulgação de informações relevantes ao mercado e/ou investidores ou acionistas, nesse caso dentro dos limites necessários, ou para exercício de direitos no âmbito do presente contrato, ou especificamente aqui permitido, nenhuma das partes revelará quaisquer informações a terceiros com relação aos termos deste Contrato, sem o prévio consentimento da outra parte, como também fazer cópias de documentos, ou por qualquer outro modo duplicar ou reproduzir, total ou parcialmente, quaisquer informações, sejam elas confidenciais ou não, reveladas e/ou documentos apresentados em razão deste instrumento, mesmo após o término deste contrato, exceto se tais informações e documentos forem de forma lícita levados a público.
15.5- Na eventualidade de uma das partes for obrigada por qualquer juízo ou autoridade governamental a revelar qualquer informação confidencial recebida, esta deverá imediatamente comunicar a outra parte.
15.6- Não se considera sigilosa ou confidencial a informação que, comprovadamente:
Seja de domínio público no momento da revelação ou após a revelação, exceto se isto ocorrer em decorrência de ato ou omissão;
Passarem a ser de domínio público, após sua revelação por terceiros, estranhos na presente relação e fora do âmbito deste Contrato;
Devam ser reveladas pelos contratantes em razão de ordem emitida por órgão administrativo ou judiciário com jurisdição, somente até a extensão de tal ordem, desde que: forem agrupadas e/ou apresentadas em formato sumarizado e fornecê-las após ter comunicado a parte contrária, por escrito da existência de tal ordem, dando a esta tempo hábil, para pleitear medidas de proteção que julgar cabíveis;
Tenham sido recebidas de terceiros, estranhos ao presente Contrato;
15.7- A violação das disposições previstas nesta cláusula não apenas representa infração contratual grave quanto à relação contratual havida, como também poderá caracterizar crime de concorrência desleal, tipificado no artigo 195, inciso XI da Lei nº 9.279/96 (Lei de Propriedade Industrial), sem prejuízo de eventual responsabilização por crime de violação de segredo profissional, conforme artigo 154 do Código Penal.
15.8- A parte infratora da presente cláusula permanecerá obrigada a ressarcir a parte inocente de qualquer dano ou prejuízo causado a qualquer tempo, em decorrência de eventual descumprimento da obrigação de confidencialidade ora estabelecida pela parte infratora.
## DA INEXISTÊNCIA DE RESTRIÇÕES NAS MATRÍCULAS:
Cláusula 16ª - Para fins do Artigo 54 da Lei nº 13.097/2.015, alterado recentemente pela Lei nº 14.825/24, foram emitidas certidões das matrículas dos imóveis constantes deste instrumento nesta data, conforme documentos que ficam fazendo parte integrante deste instrumento.
## DA COMISSÃO:
Cláusula 17ª - A presente negociação foi intermediada pela imobiliária {{empresa_nome}}, CNPJ {{empresa_cnpj}} CRECI {{empresa_creci}} e, a comissão pela intermediação será devida a mesma, no valor equivalente a {{comissao_pct_extenso}} da negociação e, totalizando, o valor de {{comissao_valor_extenso}}, valor que será satisfeito pelos VENDEDORES {{comissao_quando}}; sendo os dados bancários: {{empresa_banco}} e PIX {{empresa_pix}}.
17.1- Caso ocorra resilição deste instrumento de contrato, a parte culpada deverá pagar o valor integral da comissão devida ao CORRETOR, conforme ora estipulado, e em conformidade do que está previsto no artigo 725, do Capítulo XIII, Lei nº 10.406 de 10/01/2002, Código Civil Brasileiro, salvo na hipótese de recusa de financiamento pela instituição financeira por quaisquer irregularidades no imóvel descrito na cláusula 1ª.
17.2 - O CORRETOR orientou cada qual das partes buscar o aconselhamento junto ao profissional habilitado para que fossem verificados os reflexos tributários e fiscais deste negócio jurídico, não há reservas de responsabilidade pela intermediadora quanto a tais institutos.
17.3 – O PROMITENTES VENDEDOR declara que não comprometeu o imóvel a terceiros, sendo este único compromisso sob o bem. Caso ocorra tal interveniência, os PROMITENTES VENDEDORES ficarão obrigado a realizar o pagamento da comissão ora contratada.
17.4- Todo trâmite concernente à transferência do imóvel será de exclusiva responsabilidade dos CONTRATANTES, inclusive a contratação de cartório de notas/instituição financeira de sua confiança para a confecção dos documentos necessários à concretização do negócio jurídico aqui posto.
17.5- Declaram os CONTRATANTES que analisaram todas as propostas ofertadas pelo CORRETOR, escolhendo, sem qualquer tipo vício de vontade, a que melhor atendesse aos seus interesses, devendo o CORRETOR, caso ainda existam aquelas propostas ou outras, informar a indisponibilidade do imóvel.
17.6- O não cumprimento das obrigações descritas nesta cláusula sujeitará a parte infratora nas mesmas penalidades deste instrumento, bem como sua execução de forma autônoma, servindo o presente como título executivo extrajudicial.
## LEI GERAL DE PROTEÇÃO DE DADOS:
Cláusula 18ª – As partes, incluindo todos os seus colaboradores, caso tenham acesso, compromete-se a tratar todos os Dados Pessoais como confidenciais, na régua da Lei nº 13.709/18, ainda que este Contrato venha a ser resolvido e independentemente dos motivos que derem causa ao seu término ou resolução.
18.1- É vedado as partes a usar, compartilhar ou comercializar quaisquer eventuais dados, produtos ou subprodutos que se originem ou sejam criados a partir do tratamento de dados estabelecido por este Contrato.
## DO FORO DE ELEIÇÃO:
Cláusula 19ª – Fica eleito o foro da Comarca de {{cidade_foro}}, com renúncia expressa a qualquer outro, ainda que privilegiado, para que as partes possam dirimir quaisquer dúvidas ou questões oriundas deste contrato.
{{#condicoes_especiais}}## CONDIÇÕES ESPECIAIS E OBSERVAÇÕES
As Partes ajustam, ainda, as seguintes condições especiais, que prevalecem sobre as cláusulas gerais naquilo que com elas conflitarem:
{{condicoes_especiais}}
{{/condicoes_especiais}}
Por terem lido e por estarem as partes em pleno acordo com o disposto neste instrumento particular de venda e compra, assinam-no conjuntamente com as testemunhas de forma eletrônica, por meio do certificado digital e/ou de plataformas de assinatura eletrônica, devidamente autorizadas pela Infraestrutura de Chaves Públicas Brasileira – ICP-Brasil (e.g., ClickSign), em conformidade com a MP nº 2.200-2/2001 e a Lei 14.063 e, serão consideradas como assinaturas válidas, sendo este Contrato, conforme seus próprios termos e no que for aplicável, considerado como exequível, válido e vigente entre as Partes.
---
{{cidade_foro}}, {{data_extenso}}.
## PROMITENTE(S) VENDEDOR(ES):
[[ASSINATURAS]]{{v1_nome}}|CPF {{v1_cpf}}{{#v2_nome}}||{{v2_nome}}|CPF {{v2_cpf}}{{/v2_nome}}
## PROMISSÁRIO(S) COMPRADOR(ES):
[[ASSINATURAS]]{{c1_nome}}|CPF {{c1_cpf}}{{#c2_nome}}||{{c2_nome}}|CPF {{c2_cpf}}{{/c2_nome}}
## TESTEMUNHAS:
[[ASSINATURAS]]{{testemunha1}}|1ª testemunha||{{testemunha2}}|2ª testemunha`,
  },
];

// v88.17: locação (proposta, contratos residencial/comercial, administração) e
// cessão/exclusividade/visita — ver docs-modelos-locacao.js e docs-modelos-extra.js
MODELOS_PADRAO.push(...MODELOS_LOCACAO, ...MODELOS_EXTRA);
