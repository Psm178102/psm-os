/* PSM-OS v2 — Gerador de Documentos: valores do formulário → variáveis do modelo  v88.12
   Puro (sem DOM/API) — testável no Node. */
import { VAZIO, valorComExtenso, extensoReais, moeda, dataExtenso, dataBR, numBR } from '../docx-psm.js';

const tem = v => v !== undefined && v !== null && String(v).trim() !== '';
const fem = s => s; // o texto já usa "(a)" — não flexionamos gênero automaticamente

/* "casado(a) sob o regime de comunhão parcial de bens" */
function estadoCivilLinha(p) {
  const ec = p.estado_civil || '';
  if (!ec) return '';
  const casado = /casad|união/i.test(ec);
  return casado && tem(p.regime) ? `${ec}, sob o regime de ${p.regime}` : ec;
}

/* Qualificação em texto corrido, no padrão do contrato da PSM:
   "FULANO DE TAL, brasileiro(a), casado(a) sob o regime…, empresário, nascido(a) em
    18/01/1954, portador(a) do RG n. X e do CPF n. Y, residente e domiciliado(a) à …"
   Campo essencial vazio (RG/CPF/endereço) vira linha em branco pra completar no Word. */
export function qualificacao(p) {
  if (!tem(p.nome)) return '';
  const partes = [String(p.nome).trim().toUpperCase()];
  if (tem(p.nacionalidade)) partes.push(p.nacionalidade);
  const ec = estadoCivilLinha(p); if (ec) partes.push(fem(ec));
  if (tem(p.profissao)) partes.push(p.profissao);
  if (tem(p.nascimento)) partes.push(`nascido(a) em ${dataBR(p.nascimento)}`);
  partes.push(`portador(a) do RG n. ${tem(p.rg) ? p.rg : VAZIO} e do CPF n. ${tem(p.cpf) ? p.cpf : VAZIO}`);
  if (tem(p.email)) partes.push(`e-mail ${p.email}`);
  partes.push(`residente e domiciliado(a) à ${tem(p.endereco) ? p.endereco : VAZIO}`);
  return partes.join(', ');
}

function pessoa(v, pre) {
  const p = {};
  for (const k of ['nome', 'cpf', 'rg', 'nascimento', 'nacionalidade', 'estado_civil', 'regime', 'profissao', 'email', 'fone', 'endereco']) p[k] = v[`${pre}_${k}`];
  return p;
}
function juntar(lista) { return lista.filter(Boolean).join('; e ') ; }

function pctExtenso(pct) {
  const n = numBR(pct);
  if (!n) return '';
  const inteiro = Math.round(n) === n;
  const txt = inteiro ? extensoReais(n).replace(/ (reais|real)$/, '') : String(n).replace('.', ',');
  const num = String(n).replace('.', ',');
  return inteiro ? `${num}% (${txt} por cento)` : `${num}%`;
}

/**
 * @param {object} v        valores do formulário (chaves = variáveis)
 * @param {object} empresa  dados da imobiliária escolhida
 * @returns {object}        contexto completo para preencher()
 */
export function montarContexto(v, empresa = {}) {
  const c = { ...v };
  for (const pre of ['c1', 'c2', 'v1', 'v2']) {
    const p = pessoa(v, pre);
    c[`${pre}_estado_civil_linha`] = estadoCivilLinha(p);
    c[`${pre}_nascimento_br`] = tem(p.nascimento) ? dataBR(p.nascimento) : '';
  }
  c.compradores_qualificacao = juntar([qualificacao(pessoa(v, 'c1')), qualificacao(pessoa(v, 'c2'))]);
  c.vendedores_qualificacao = juntar([qualificacao(pessoa(v, 'v1')), qualificacao(pessoa(v, 'v2'))]);

  const valor = numBR(v.valor), ato = numBR(v.valor_ato), pct = numBR(v.comissao_pct);
  c.valor = valor ? `R$ ${moeda(valor)}` : '';
  c.valor_moeda = c.valor;
  c.valor_extenso = valorComExtenso(valor);
  c.valor_ato = ato ? `R$ ${moeda(ato)}` : '';
  c.valor_ato_extenso = valorComExtenso(ato);
  c.comissao_pct_extenso = pctExtenso(pct);
  c.comissao_valor_extenso = valor && pct ? valorComExtenso(Math.round(valor * pct) / 100) : '';

  c.data_extenso = dataExtenso(v.data_doc);
  for (const [k, val] of Object.entries(empresa || {})) c[`empresa_${k}`] = val;
  return c;
}

/* Sugestão do texto da cláusula 3ª a partir do valor/sinal/forma (o corretor ajusta) */
export function sugerirPagamento(v) {
  const valor = numBR(v.valor), ato = numBR(v.valor_ato);
  if (!valor) return '';
  const forma = String(v.forma_pagamento || '').toLowerCase();
  const linhas = [];
  let resto = valor;
  let letra = 'a';
  const prox = () => { const l = letra; letra = String.fromCharCode(letra.charCodeAt(0) + 1); return l; };
  if (ato && ato < valor) {
    linhas.push(`${prox()}) ${valorComExtenso(ato)}, a título de sinal e princípio de pagamento, pago(s) no ato da assinatura deste instrumento;`);
    resto = Math.round((valor - ato) * 100) / 100;
  }
  if (forma.includes('financ')) linhas.push(`${prox()}) ${valorComExtenso(resto)}, em moeda corrente deste País, através de financiamento imobiliário, o qual deverá ser satisfeito no prazo de até 90 dias.`);
  else if (forma.includes('consórcio') || forma.includes('carta')) linhas.push(`${prox()}) ${valorComExtenso(resto)}, através de carta de crédito/consórcio, no prazo de até 90 dias.`);
  else if (forma.includes('permuta')) linhas.push(`${prox()}) ${valorComExtenso(resto)}, mediante permuta pelo imóvel ${VAZIO}.`);
  else if (forma.includes('parcel')) linhas.push(`${prox()}) ${valorComExtenso(resto)}, em ${VAZIO} parcelas mensais e consecutivas de R$ ${VAZIO}, vencendo-se a primeira em ${VAZIO}.`);
  else linhas.push(`${prox()}) ${valorComExtenso(resto)}, à vista, em moeda corrente deste País, na data de ${VAZIO}.`);
  return linhas.join('\n');
}
