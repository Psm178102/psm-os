/* PSM-OS v2 — 🏯 Morimatsu & Associados · ⚖️ VIABILIDADE DE LEILÕES  v87.71
   ----------------------------------------------------------------------------
   A etapa que vem ANTES da conta. O Simulador já responde "quanto posso dar";
   esta aba responde as duas perguntas que vêm antes e que derrubam o negócio
   quando ninguém faz: "esse imóvel TEM SAÍDA?" e "ele é FINANCIÁVEL?".

   Doutrina do agente `leiloes-caixa-psm` (cérebro em Desktop/MORIMATSU/
   MORIMATSU & ASSOCIADOS/07-CEREBRO-LEILOES/01-BASE-CONHECIMENTO-v2.md),
   destilada do módulo de leilões do Financiamento PRO (Murilo Arjona, Jorge
   Kodama, Priscila Perini, Rafaella Marcon):

     LEI Nº 1 — a saída vem antes do deságio. Um imóvel de leilão não vale
     pelo desconto, vale por QUEM CONSEGUE COMPRÁ-LO DE VOCÊ DEPOIS. O próprio
     professor diz ao público de leilão: "não compra imóvel que tu vai vender
     na faixa três". O caso que ele desmonta: 280 mil saindo por 180 mil,
     financiável a 95%, e ainda assim compra errada — sem comprador financiável.

     LEI Nº 2 — toda regra tem data. As duas que mais mexem aqui viraram em
     17/jan/2025 (dívidas passam ao arrematante) e em nov/2025 (faixa 3 usado
     volta a 80%). Número sem data leva a decisão errada.

   Três réguas nesta tela: SAÍDA (quem compra) · FINANCIABILIDADE (o imóvel
   serve de garantia?) · DÍVIDAS (o que sobra para você desde jan/2025).
   O parecer só sai APROVADO com as três de pé e as pendências de campo
   levantadas — as três coisas que nenhum link entrega: condomínio, IPTU e
   ocupação. Persistência: `imovel.saida` (mesma coleção do garimpo).
============================================================================ */
import {
  S, esc, num, brl, hojeISO, dtBR, autorNome, upsert, imvPorId, setCol,
  campo, input, render, irPara, cfg,
} from './morimatsu.js';
import { veredito, carregarImovel } from './morimatsu-ops.js';

/* ═════════════════ dicionários da doutrina (com data na fonte) ═════════════════ */

/* Impeditivos de garantia — se tiver, o financiamento não sai (nem na entrada
   nem na saída). Módulo 08 do curso, gravado em 2022: confirmar no normativo
   vigente antes de usar como veto definitivo. */
export const IMPEDITIVOS = [
  ['multifamiliar', 'Duas moradias no mesmo terreno (multifamiliar)', 'Impeditivo normativo. Comum em imóvel popular — casa na frente e nos fundos.'],
  ['usufruto', 'Usufruto não renunciado e averbado', 'Terceiro tem direito de morar. Só destrava com renúncia em cartório averbada na matrícula.'],
  ['inalienabilidade', 'Cláusula de inalienabilidade', 'Impede a transferência. Servidão, incomunicabilidade e impenhorabilidade são toleradas.'],
  ['matricula_bloq', 'Matrícula bloqueada', 'Sem transferência possível.'],
  ['inventario', 'Inventário sem alvará judicial', 'Com alvará do juiz a Caixa aceita.'],
  ['gleba', 'Gleba / terreno não desmembrado', 'Sem matrícula individualizada o banco não aceita como garantia.'],
  ['rural', 'Imóvel rural', 'Fora do crédito habitacional.'],
  ['sem_averbacao', 'Imóvel pronto sem NENHUMA área averbada', 'Precisa existir alguma área averbada. Área a mais não averbada é aceita.'],
  ['ex_proponente', 'Foi do proponente nos últimos 2 anos', 'Vedação normativa — atenção quando o comprador é ligado ao ex-mutuário.'],
  ['em_obra', 'Unidade em prédio ainda em construção', 'Entra como associativo, não como usado.'],
];

/* Não impedem, mas mudam a conta — e mudam a SAÍDA. */
export const PENALIDADES = [
  ['comercial', 'Comercial (sala, loja, barracão)', 'Vai para SFI: cota 70% (não 80%), prazo 20 anos (não 35), sem FGTS e com IOF (~3%). É por isso que comercial de leilão encalha mesmo com desconto grande.'],
  ['madeira', 'Madeira, steel frame ou wood frame', 'Financiável, mas o engenheiro fixa a vida útil e o prazo cai para 10 a 20 anos. Parcela alta reduz o público. Simular já no prazo curto.'],
  ['misto', 'Imóvel misto (residencial + comercial)', 'Só a parte residencial entra no SFH. FGTS vedado na parte comercial.'],
  ['nao_averbada', 'Área construída não averbada', 'A Caixa avalia o imóvel inteiro sem limitador — vantagem real. Bradesco limita a 30% e Santander a 40%, então o comprador que usa outro banco pode travar.'],
  ['locado', 'Ocupado por INQUILINO com contrato de locação', 'Se a locação estiver averbada na matrícula, pare: o inquilino pode requerer o imóvel para si. Sem averbação, notificar o direito de preferência (30 dias) e colher renúncia expressa por escrito. Pergunta em aberto para o advogado: locação firmada depois da alienação fiduciária é oponível ao arrematante?'],
];

/* As três coisas que NENHUM link entrega. Sem elas o parecer não fecha. */
export const PENDENCIAS = [
  ['cond_ok', '📞 Dívida de condomínio levantada', 'Administradora ou síndico. Desde 17/jan/2025 você absorve até 10% do valor do imóvel.'],
  ['iptu_ok', '🏛 Dívida de IPTU levantada', 'Prefeitura, pelo número que está na ficha do imóvel. Desde 17/jan/2025 é 100% do arrematante.'],
  ['ocup_ok', '👀 Ocupação verificada no local', 'Alguém passou na frente. O portal não diz se está ocupado, e na Porta 1 a desocupação é o serviço que você vende.'],
];

/* Linha do tempo — o agente nunca cita número sem dizer de quando ele é. */
export const REGRAS = [
  ['2024', 'Faixa 3 até R$ 350 mil; faixa 2 por recorte de município; renda até R$ 8 mil.', 'Saída ampla.', 'neutro'],
  ['2025 (ano todo)', 'Faixa 3 usado financiava só 65% (35% de entrada) e o imóvel ficou limitado a R$ 270 mil. Quem ganhava R$ 4.700–8.600 não podia comprar usado no programa. Usado fora do programa exigia 50% de entrada no Sul/Sudeste.', 'Imóvel de leilão entre R$ 250 e 300 mil ficou invendável. É a origem do "não compra para vender na faixa 3".', 'ruim'],
  ['nov/2025', 'Ministério das Cidades e Conselho Curador do FGTS: faixa 3 volta a financiar 80% (20% de entrada) e os imóveis voltam a passar de R$ 350 mil.', 'A trava caiu e ficou demanda reprimida de usado no Sudeste. O veto de 2025 não vale mais como regra absoluta.', 'bom'],
  ['nov/2025', 'Curva de subsídio achatada: teto de R$ 55 mil sobe para quem ganha até R$ 1.750 e some para quem ganha de R$ 4.000 a R$ 4.400.', 'Assinatura mais rápida na faixa 2.', 'bom'],
  ['17/jan/2025', 'Vendas diretas e online: IPTU 100% do arrematante; condomínio, a Caixa só paga o que exceder 10% do valor do imóvel.', 'Levantar dívida antes do lance virou obrigatório.', 'ruim'],
  ['2026', 'Pró-Cotista voltou a 80% na tabela SAC, mas só imóvel NOVO (ou associativo), até R$ 500 mil.', 'O comprador da sua revenda de usado não pode usar essa rota.', 'ruim'],
  ['2026', 'Em discussão: faixa 4, teto de faixa 2 a R$ 300 mil e renda até R$ 21 mil.', 'Proposta, ainda não vigente. Acompanhar.', 'neutro'],
];

/* Casos que o agente usa como precedente — os três do módulo. */
export const CASOS = [
  {
    id: 'trap',
    t: '❌ O desconto que não valia nada',
    n: 'R$ 280 mil por R$ 180 mil · cidade de 100 mil habitantes',
    fonte: 'Café com Financiamento, ep. 27 e 48 (2025)',
    o: 'R$ 100 mil de desconto e financiável a 95%. Parecia a compra do ano.',
    p: 'Na regra daquele momento, quem ganhava de R$ 4.700 a R$ 8.600 era faixa 3 e não podia comprar usado no programa. Para o crédito tradicional, faltava renda. O comprador simplesmente não existia.',
    l: 'Deságio não é liquidez. O professor fecha assim: "não compra imóvel que tu vai vender na faixa três". Hoje a regra afrouxou (nov/2025), mas o teste continua: quem compra de você depois?',
  },
  {
    id: 'comercial',
    t: '🏚 O comercial que ninguém quis',
    n: 'Avaliado em R$ 1,48 mi, saindo por R$ 884 mil, sem um único licitante',
    fonte: 'Jorge Kodama, módulo 22 (2025)',
    o: 'Quarenta por cento de desconto num imóvel grande, com o cronômetro correndo e nenhuma proposta.',
    p: 'Não aceitava financiamento habitacional. Comercial vai para SFI: cota de 70%, prazo de 20 anos, sem FGTS e com IOF. O público que consegue pagar isso é pequeno.',
    l: 'Antes de olhar o deságio, olhe a linha "Financiamento: consulte condições" na ficha. Sem financiamento, o mercado comprador encolhe para quem tem o valor à vista.',
  },
  {
    id: 'win',
    t: '✅ O que deu certo e por quê',
    n: 'Dois arremates a R$ 98 mil onde os vizinhos anunciam R$ 180 a 200 mil',
    fonte: 'Café com Financiamento, ep. 75 (nov/2025)',
    o: 'O professor comprou dois, anunciou a R$ 170–175 mil e contava vender em 30 dias.',
    p: 'Ele não precificou pelo teto do mercado, precificou por liquidez. Ninguém anunciava abaixo de R$ 180 mil, então ele virou o único preço da praça.',
    l: 'Ganho vem do giro, não do último real da tabela. E imóvel de oportunidade é máquina de lead: quem não leva aquele leva o próximo.',
  },
];

/* Tetos de faixa 2 conhecidos — 2024, referência apenas. O da nossa praça
   está na planilha de recortes do curso e é PENDÊNCIA aberta. */
export const TETOS_REF = [
  ['São Paulo capital (recorte A1, acima de 750 mil hab.)', 275000],
  ['Cidade de 100 a 300 mil habitantes (recorte B3)', 240000],
  ['Cidade abaixo de 100 mil habitantes (capital regional)', 225000],
  ['Cidade abaixo de 100 mil habitantes (sub-regional)', 210000],
];

const TETO_F3 = 350000;   // nov/2025: faixa 3 volta a passar de R$ 350 mil

/* ═════════════════ estado local ═════════════════ */
let _sel = '';        // id do imóvel em análise ('' = avulso)
let _avulso = { venda: 0, cidade: 'São José do Rio Preto', tipo: 'apartamento', cond: 0, iptu: 0, valor: 0 };
let _caso = '';

const conf = () => (S.config?.saida || {});
const tetoCidade = (cidade) => num((conf().tetos || {})[String(cidade || '').trim()]);
const imovelSel = () => (_sel ? imvPorId(_sel) : null);

/* dados em análise: do imóvel selecionado ou do modo avulso */
function dados() {
  const i = imovelSel();
  if (!i) return { ..._avulso, saida: (conf().avulso || {}), i: null };
  const A = i.analise || {};
  const merc = num(A.mercado) || num(i.avaliacao);
  return {
    venda: num(A.venda_esperada) || Math.round(merc * (num(A.fator_venda) || 92) / 100),
    cidade: i.cidade || 'São José do Rio Preto',
    tipo: i.tipo || 'apartamento',
    cond: A.debitos_cond != null ? num(A.debitos_cond) : num(i.debitos_cond),
    iptu: num(A.debitos_iptu),
    valor: num(i.lance_min) || num(i.avaliacao),
    saida: i.saida || {},
    i,
  };
}

/* ═════════════════ RÉGUA 1 — a saída ═════════════════ */
export function classificarSaida(venda, cidade) {
  const V = num(venda), T = tetoCidade(cidade);
  if (!V) return { id: 'sem_dados', rot: 'SEM DADOS', cor: '#64748b', ico: '⚪', txt: 'Informe o valor de venda esperado para o motor rodar.', ok: false };
  if (!T) return {
    id: 'sem_teto', rot: 'TETO DA CIDADE PENDENTE', cor: '#64748b', ico: '⚪', ok: false,
    txt: `Sem o teto de faixa 2 de ${esc(cidade || 'sua cidade')} não dá para dizer quem compra este imóvel. Cadastre o teto abaixo — ele está na planilha de recortes do curso (módulo 06).`,
  };
  if (V <= T) return {
    id: 'f2', rot: 'FAIXA 2 — SAÍDA LÍQUIDA', cor: '#16a34a', ico: '🟢', ok: true,
    txt: `Venda esperada de ${brl(V)} cabe no teto de faixa 2 (${brl(T)}). O comprador tem subsídio, cota alta e é o público mais líquido do país — a mesma base que a PSM Conquista já atende. É a zona onde o ticket de R$ 100–180 mil foi desenhado para operar.`,
  };
  if (V <= TETO_F3) return {
    id: 'f3', rot: 'FAIXA 3 USADO — ZONA DE ATENÇÃO', cor: '#d97706', ico: '🟡', ok: true,
    txt: `Venda esperada de ${brl(V)} passa do teto de faixa 2 (${brl(T)}) e cai na faixa 3 usado. Durante 2025 esta faixa ficou invendável (financiava 65%, teto de R$ 270 mil) e é a origem do "não compra para vender na faixa 3". <b>Em nov/2025 voltou a financiar 80% com 20% de entrada</b>, criando demanda reprimida no Sudeste. Dá para operar, mas confirme a norma vigente antes do lance e conte com um comprador que tenha 20% de entrada.`,
  };
  return {
    id: 'sbpe', rot: 'ACIMA DA FAIXA 3 — PÚBLICO ESTREITO', cor: '#0ea5e9', ico: '🔵', ok: true,
    txt: `Venda esperada de ${brl(V)} passa dos R$ ${(TETO_F3 / 1000).toLocaleString('pt-BR')} mil do programa. A saída depende do crédito tradicional, com entrada maior e público bem menor na nossa praça. Fora do recorte da casa (R$ 100–180 mil) — só com investidor que aceite prazo longo de venda.`,
  };
}

/* ═════════════════ RÉGUA 2 — financiabilidade ═════════════════ */
export function reguaFinanciabilidade(d) {
  const s = d.saida || {}, marc = s.flags || {};
  const vetos = IMPEDITIVOS.filter(([k]) => marc[k]);
  const pen = PENALIDADES.filter(([k]) => marc[k]);
  // auto-detecção pelo tipo cadastrado no garimpo
  const auto = [];
  if (['comercial', 'barracao'].includes(d.tipo) && !marc.comercial) auto.push(PENALIDADES.find(p => p[0] === 'comercial'));
  if (d.tipo === 'rural' && !marc.rural) auto.push(['rural_auto', 'Imóvel rural (pelo tipo cadastrado)', 'Fora do crédito habitacional.']);
  return { vetos, pen, auto: auto.filter(Boolean), ok: vetos.length === 0 };
}

/* ═════════════════ RÉGUA 3 — dívidas desde 17/jan/2025 ═════════════════ */
export function reguaDividas(valor, cond, iptu) {
  const V = num(valor), C = num(cond), I = num(iptu);
  const limite = V * 0.10;                    // a Caixa só paga o que EXCEDE 10% do valor
  const seuCond = Math.min(C, limite);
  const caixaCond = Math.max(0, C - limite);
  return { V, C, I, limite, seuCond, caixaCond, total: seuCond + I };
}

/* ═════════════════ PARECER DO AGENTE ═════════════════ */
export function parecer(d) {
  const sa = classificarSaida(d.venda, d.cidade);
  const fi = reguaFinanciabilidade(d);
  const di = reguaDividas(d.valor, d.cond, d.iptu);
  const s = d.saida || {}, p = s.pend || {};
  const faltam = PENDENCIAS.filter(([k]) => !p[k]);

  let status, rot, cor, frase;
  if (!fi.ok) {
    status = 'passar'; rot = 'PASSAR'; cor = '#ef4444';
    frase = `Impeditivo de garantia marcado: ${fi.vetos.map(v => v[1].toLowerCase()).join('; ')}. Sem financiamento não há comprador nesta faixa de preço — o deságio não muda isso.`;
  } else if (sa.id === 'sem_dados' || sa.id === 'sem_teto') {
    status = 'incompleto'; rot = 'INCOMPLETO — NÃO LANÇAR'; cor = '#64748b';
    frase = sa.id === 'sem_teto'
      ? 'Falta o teto de faixa 2 da cidade. Sem ele não dá para dizer quem compra este imóvel depois.'
      : 'Falta o valor de venda esperado.';
  } else if (faltam.length) {
    status = 'incompleto'; rot = 'INCOMPLETO — NÃO LANÇAR'; cor = '#d97706';
    frase = `A saída fecha (${sa.rot.toLowerCase()}), mas ${faltam.length === 1 ? 'falta 1 levantamento de campo' : `faltam ${faltam.length} levantamentos de campo`}: ${faltam.map(f => f[1].replace(/^..\s/, '').toLowerCase()).join('; ')}. Nenhum link entrega esses números.`;
  } else if (sa.id === 'sbpe') {
    status = 'ressalva'; rot = 'FORA DO RECORTE'; cor = '#0ea5e9';
    frase = 'As réguas passam, mas o imóvel está acima da faixa onde a casa opera. Só com investidor que aceite prazo longo de venda.';
  } else {
    status = 'aprovado'; rot = 'APROVADO PARA A CONTA'; cor = '#16a34a';
    frase = `Saída identificada (${sa.rot.toLowerCase()}), imóvel financiável e dívidas levantadas. Agora sim vale rodar o número no Simulador para achar o lance máximo.`;
  }
  return { status, rot, cor, frase, sa, fi, di, faltam };
}

/* ═════════════════ render ═════════════════ */
export function renderViabilidade() {
  const d = dados(), P = parecer(d), i = d.i;
  const imoveis = (S.imoveis || []).filter(x => !['descartado', 'perdido'].includes(x.status));
  const mapa = Object.fromEntries(imoveis.map(x => [x.id, `${x.titulo}${x.cidade ? ' · ' + x.cidade : ''}`]));

  return `<div class="ma-viab">
    ${cabecalho()}

    <div class="card mb-3">
      <div class="ma-row">
        <label class="field" style="min-width:280px;flex:1">
          <span class="tiny muted">Imóvel em análise</span>
          <select class="input" id="vb-sel">
            <option value="">— avulso (não salva no imóvel) —</option>
            ${Object.entries(mapa).map(([k, v]) => `<option value="${esc(k)}" ${_sel === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </label>
        ${i ? `<div class="tiny muted" style="align-self:flex-end;padding-bottom:8px">
          ${i.modalidade ? esc(i.modalidade) + ' · ' : ''}${i.lance_min ? 'mínimo ' + brl(i.lance_min) : ''}${i.avaliacao ? ' · avaliação ' + brl(i.avaliacao) : ''}
          ${i.link ? ` · <a href="${esc(i.link)}" target="_blank" rel="noopener">abrir anúncio ↗</a>` : ''}
        </div>` : `<div class="tiny muted" style="align-self:flex-end;padding-bottom:8px">Selecione um imóvel do garimpo para o parecer ficar salvo nele.</div>`}
      </div>
    </div>

    ${selo(P, d)}

    <div class="mb-3">${cardSaida(d, P)}</div>
    <div class="mb-3">${cardFinanc(d, P)}</div>

    <div class="ma-grid2">
      ${cardDividas(d, P)}
      ${cardPendencias(d, P)}
    </div>

    ${cardNumero(d, P)}
    ${cardCasos()}
    ${cardRegras()}
    ${cardFonte()}
  </div>`;
}

function cabecalho() {
  return `<div class="card ma-hero mb-3">
    <div class="ma-hero-t">⚖️ Viabilidade de Leilões</div>
    <p class="card-sub" style="margin:6px 0 0">
      A etapa antes da conta. O Simulador responde <i>quanto posso dar</i>; aqui a gente responde
      <b>quem compra este imóvel de você depois</b> e <b>se ele é financiável</b> — as duas perguntas que
      derrubam a operação quando ninguém faz.
    </p>
    <blockquote class="ma-quote">"Não compra imóvel que tu vai vender na faixa três."
      <span class="tiny muted">— Murilo Arjona, falando ao público de leilão (Café com Financiamento, ep. 48)</span>
    </blockquote>
  </div>`;
}

function selo(P, d) {
  return `<div class="card ma-selo" style="border-left:6px solid ${P.cor}">
    <div class="ma-selo-rot" style="color:${P.cor}">${P.rot}</div>
    <p class="ma-selo-frase">${P.frase}</p>
    <div class="ma-selo-mini">
      ${miniSelo('Saída', P.sa.ico + ' ' + P.sa.rot, P.sa.cor)}
      ${miniSelo('Financiabilidade', P.fi.ok ? '🟢 sem impeditivo' : '🔴 ' + P.fi.vetos.length + ' impeditivo(s)', P.fi.ok ? '#16a34a' : '#ef4444')}
      ${miniSelo('Dívidas com você', brl(P.di.total), P.di.total > 0 ? '#d97706' : '#16a34a')}
      ${miniSelo('Levantamentos', P.faltam.length ? '⏳ faltam ' + P.faltam.length : '✅ completos', P.faltam.length ? '#d97706' : '#16a34a')}
    </div>
    ${d.i ? `<div class="flex gap-2 mt-2">
      <button class="btn btn-ghost" id="vb-salvar">💾 Salvar parecer no imóvel</button>
      <button class="btn btn-ghost" id="vb-simular">🧮 Levar para o Simulador</button>
      <button class="btn btn-ghost" id="vb-imprimir">🖨 Imprimir parecer</button>
    </div>` : `<div class="flex gap-2 mt-2"><button class="btn btn-ghost" id="vb-imprimir">🖨 Imprimir parecer</button></div>`}
  </div>`;
}
const miniSelo = (lbl, val, cor) => `<div class="ma-vmini"><span class="tiny muted">${lbl}</span><b style="color:${cor}">${val}</b></div>`;

/* ── régua 1 ── */
function cardSaida(d, P) {
  const sa = P.sa, T = tetoCidade(d.cidade);
  return `<div class="card">
    <h4 class="card-t">1 · Quem compra de você depois</h4>
    <div class="ma-row">
      ${campo('Venda esperada (R$)', input('vb_venda', d.venda || '', 'number', 'id="vb-venda"'))}
      ${campo('Cidade', input('vb_cidade', d.cidade, 'text', 'id="vb-cidade"'))}
    </div>
    <div class="ma-band" style="border-color:${sa.cor}">
      <b style="color:${sa.cor}">${sa.ico} ${sa.rot}</b>
      <p class="tiny" style="margin:4px 0 0">${sa.txt}</p>
    </div>
    <div class="ma-teto">
      <label class="field" style="flex:1">
        <span class="tiny muted">Teto de faixa 2 de <b>${esc(d.cidade || '—')}</b> (R$)</span>
        <input class="input" type="number" id="vb-teto" value="${T || ''}" placeholder="pendente — puxar da planilha de recortes">
      </label>
      <button class="btn btn-ghost" id="vb-teto-salvar" style="align-self:flex-end;margin-bottom:2px">Gravar teto</button>
    </div>
    <details class="ma-det"><summary class="tiny muted">Referências de teto (2024) — a nossa praça ainda é pendência</summary>
      <table class="ma-tab"><tbody>
        ${TETOS_REF.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="r"><b>${brl(v)}</b></td></tr>`).join('')}
      </tbody></table>
      <p class="tiny muted" style="margin:6px 0 0">O teto de faixa 2 é por recorte de município. O de São José do Rio Preto e região está na planilha do módulo 06 do curso e ainda não foi capturado — enquanto isso, o parecer de imóvel acima de R$ 200 mil sai incompleto.</p>
    </details>
    <p class="tiny muted" style="margin:8px 0 0">⚠️ Pró-Cotista voltou a 80% em 2026, mas <b>só imóvel novo</b> — o comprador da sua revenda de usado não pode usar essa rota.</p>
  </div>`;
}

/* ── régua 2 ── */
function cardFinanc(d, P) {
  const marc = (d.saida || {}).flags || {};
  return `<div class="card">
    <h4 class="card-t">2 · O imóvel serve de garantia?</h4>
    <p class="tiny muted" style="margin:0 0 8px">Marque o que existir. Qualquer item da primeira lista derruba o financiamento — e sem financiamento não há comprador nesta faixa.</p>
    <div class="ma-chk-t">🔴 Impeditivos — qualquer um derruba o financiamento</div>
    <div class="ma-chk-cols">${IMPEDITIVOS.map(([k, lbl, hint]) => linhaChk('imp', k, lbl, hint, marc[k])).join('')}</div>
    <div class="ma-chk-t" style="margin-top:12px">🟡 Não impedem, mas mudam a conta e o público</div>
    <div class="ma-chk-cols">${PENALIDADES.map(([k, lbl, hint]) => linhaChk('pen', k, lbl, hint, marc[k])).join('')}</div>
    ${P.fi.auto.length ? `<div class="ma-band" style="border-color:#d97706;margin-top:10px">
      <b style="color:#d97706">Detectado pelo cadastro</b>
      ${P.fi.auto.map(a => `<p class="tiny" style="margin:4px 0 0"><b>${esc(a[1])}</b> — ${esc(a[2])}</p>`).join('')}
    </div>` : ''}
    <p class="tiny muted" style="margin:8px 0 0">Régua do módulo 08 do curso, gravado em 2022 — confirmar no normativo vigente antes de usar como veto definitivo.</p>
  </div>`;
}
function linhaChk(grp, k, lbl, hint, on) {
  return `<label class="ma-chk"><input type="checkbox" data-flag="${esc(k)}" ${on ? 'checked' : ''}>
    <span><b>${esc(lbl)}</b><br><span class="tiny muted">${esc(hint)}</span></span></label>`;
}

/* ── régua 3 ── */
function cardDividas(d, P) {
  const di = P.di;
  return `<div class="card">
    <h4 class="card-t">3 · Dívidas que sobram para você</h4>
    <p class="tiny muted" style="margin:0 0 8px">Regra vigente desde <b>17/jan/2025</b> nas vendas diretas e online: IPTU é 100% do arrematante e, no condomínio, a Caixa só paga o que <b>exceder 10% do valor do imóvel</b>.</p>
    <div class="ma-row">
      ${campo('Valor do imóvel (R$)', input('vb_valor', d.valor || '', 'number', 'id="vb-valor"'))}
      ${campo('Condomínio em atraso (R$)', input('vb_cond', d.cond || '', 'number', 'id="vb-cond"'))}
      ${campo('IPTU em atraso (R$)', input('vb_iptu', d.iptu || '', 'number', 'id="vb-iptu"'))}
    </div>
    <table class="ma-tab"><tbody>
      <tr><td>Limite de 10% do valor</td><td class="r">${brl(di.limite)}</td></tr>
      <tr><td>Condomínio que <b>fica com você</b></td><td class="r"><b>${brl(di.seuCond)}</b></td></tr>
      <tr><td>Condomínio que a Caixa paga</td><td class="r">${brl(di.caixaCond)}</td></tr>
      <tr><td>IPTU (sempre seu)</td><td class="r"><b>${brl(di.I)}</b></td></tr>
      <tr class="ma-tot"><td><b>Total que entra no seu custo</b></td><td class="r"><b>${brl(di.total)}</b></td></tr>
    </tbody></table>
    ${d.i ? `<button class="btn btn-ghost mt-2" id="vb-levar-div">↧ Levar dívidas para a análise do imóvel</button>` : ''}
  </div>`;
}

/* ── pendências de campo ── */
function cardPendencias(d, P) {
  const p = (d.saida || {}).pend || {};
  return `<div class="card">
    <h4 class="card-t">4 · O que nenhum link entrega</h4>
    <p class="tiny muted" style="margin:0 0 8px">Três levantamentos que exigem uma pessoa. Enquanto faltar um, o parecer sai <b>incompleto</b> e o lance não é autorizado.</p>
    ${PENDENCIAS.map(([k, lbl, hint]) => `<label class="ma-chk"><input type="checkbox" data-pend="${esc(k)}" ${p[k] ? 'checked' : ''}>
      <span><b>${esc(lbl)}</b><br><span class="tiny muted">${esc(hint)}</span>${p[k + '_em'] ? `<br><span class="tiny" style="color:#16a34a">✓ ${dtBR(p[k + '_em'])}${p[k + '_por'] ? ' · ' + esc(p[k + '_por']) : ''}</span>` : ''}</span></label>`).join('')}
    <label class="field mt-2"><span class="tiny muted">Observações do levantamento</span>
      <textarea class="input" id="vb-obs" rows="3" placeholder="Quem atendeu na administradora, o que o vizinho disse, o que se viu na frente do imóvel…">${esc((d.saida || {}).obs || '')}</textarea></label>
  </div>`;
}

/* ── o número (motor existente) ── */
function cardNumero(d, P) {
  const i = d.i;
  if (!i) return `<div class="card mb-3"><h4 class="card-t">5 · O número</h4>
    <p class="tiny muted">Selecione um imóvel do garimpo para puxar o lance máximo do motor, ou vá direto ao <button class="btn btn-ghost" data-rota="/morimatsu-simulador" style="font-size:11.5px;padding:2px 8px">🧮 Simulador</button>.</p></div>`;
  let v;
  try { v = veredito(i, {}); } catch (_) { v = null; }
  if (!v) return '';
  const lm = v.lm || 0, min = num(i.lance_min);
  const trava = P.status !== 'aprovado';
  return `<div class="card mb-3">
    <h4 class="card-t">5 · O número, se as réguas passarem</h4>
    <div class="ma-num">
      <div><span class="tiny muted">Veredito do motor</span><b style="color:${v.cor};font-size:18px">${v.rotulo}</b></div>
      <div><span class="tiny muted">Lance máximo</span><b style="font-size:18px">${brl(lm)}</b></div>
      <div><span class="tiny muted">Mínimo do edital</span><b>${min ? brl(min) : '—'}</b></div>
      <div><span class="tiny muted">Lucro no cenário base</span><b>${brl(v.base?.lucro || 0)}</b></div>
    </div>
    ${v.cond?.length ? `<p class="tiny" style="margin:8px 0 0"><b>Destrava se:</b> ${v.cond.map(c => esc(c)).join(' · ')}</p>` : ''}
    ${v.motivo ? `<p class="tiny" style="margin:8px 0 0;color:#ef4444">${esc(v.motivo)}</p>` : ''}
    ${trava ? `<div class="ma-band" style="border-color:#d97706;margin-top:10px">
      <b style="color:#d97706">O número existe, mas o lance não está autorizado</b>
      <p class="tiny" style="margin:4px 0 0">${esc(P.frase)}</p></div>` : ''}
    <div class="flex gap-2 mt-2">
      <button class="btn btn-ghost" data-rota="/morimatsu-simulador">🧮 Abrir no Simulador</button>
      <button class="btn btn-ghost" data-rota="/morimatsu-imoveis">🏠 Ver o imóvel no garimpo</button>
    </div>
  </div>`;
}

/* ── casos ── */
function cardCasos() {
  return `<div class="card mb-3">
    <h4 class="card-t">📚 Casos que o agente usa como precedente</h4>
    <p class="tiny muted" style="margin:0 0 10px">Três operações reais contadas no módulo. Antes de cobrir um lance, ache o seu caso aqui.</p>
    <div class="ma-casos">${CASOS.map(c => `<button class="ma-caso ${_caso === c.id ? 'on' : ''}" data-caso="${c.id}">
      <b>${esc(c.t)}</b><span class="tiny muted">${esc(c.n)}</span></button>`).join('')}</div>
    ${_caso ? (() => {
      const c = CASOS.find(x => x.id === _caso); if (!c) return '';
      return `<div class="ma-band" style="margin-top:10px">
        <b>${esc(c.t)}</b> <span class="tiny muted">· ${esc(c.fonte)}</span>
        <p class="tiny" style="margin:6px 0 0"><b>O que se via:</b> ${esc(c.o)}</p>
        <p class="tiny" style="margin:4px 0 0"><b>O que estava escondido:</b> ${esc(c.p)}</p>
        <p class="tiny" style="margin:4px 0 0"><b>A lição:</b> ${esc(c.l)}</p></div>`;
    })() : ''}
  </div>`;
}

/* ── linha do tempo ── */
function cardRegras() {
  const cor = { bom: '#16a34a', ruim: '#ef4444', neutro: '#64748b' };
  return `<div class="card mb-3">
    <h4 class="card-t">🗓 Linha do tempo das regras</h4>
    <p class="tiny muted" style="margin:0 0 8px">O agente nunca cita número sem dizer de quando ele é. Regra de curso é doutrina, não lei — antes de operar, confirme a norma vigente.</p>
    <table class="ma-tab"><thead><tr><th>Quando</th><th>O que mudou</th><th>Efeito no leilão</th></tr></thead><tbody>
      ${REGRAS.map(([q, o, e, t]) => `<tr><td style="white-space:nowrap"><b style="color:${cor[t]}">${esc(q)}</b></td><td class="tiny">${esc(o)}</td><td class="tiny">${esc(e)}</td></tr>`).join('')}
    </tbody></table>
  </div>`;
}

function cardFonte() {
  return `<div class="card">
    <h4 class="card-t">🧠 De onde vem esta doutrina</h4>
    <p class="tiny muted" style="margin:0">
      Agente <code>leiloes-caixa-psm</code>, base de conhecimento v2 em
      <code>Desktop/MORIMATSU/MORIMATSU &amp; ASSOCIADOS/07-CEREBRO-LEILOES/</code>.
      Fontes: módulo Imóveis Caixa e Leilões do Financiamento PRO (Murilo Arjona), aulas de Jorge Kodama
      e Priscila Perini, módulo de contratos com Rafaella Marcon, módulos 06 e 08 do curso e episódios do
      Café com Financiamento. 28 fontes catalogadas, cada regra com id e data.
    </p>
    <p class="tiny muted" style="margin:6px 0 0">
      <b>Pendências abertas 🔴:</b> teto de faixa 2 de Rio Preto e região · edital vigente 2026 da Caixa ·
      texto da Lei 9.514/97 · parecer do advogado sobre locação firmada após a alienação fiduciária.
    </p>
  </div>`;
}

/* ═════════════════ wire ═════════════════ */
export function wireViabilidade(root) {
  const $ = s => root.querySelector(s);

  const sel = $('#vb-sel');
  if (sel) sel.onchange = () => { _sel = sel.value; render(); };

  root.querySelectorAll('[data-caso]').forEach(b => {
    b.onclick = () => { _caso = (_caso === b.dataset.caso ? '' : b.dataset.caso); render(); };
  });

  // campos que recalculam ao vivo (modo avulso) ou gravam no imóvel
  const campos = [['#vb-venda', 'venda'], ['#vb-cidade', 'cidade'], ['#vb-valor', 'valor'], ['#vb-cond', 'cond'], ['#vb-iptu', 'iptu']];
  campos.forEach(([sel_, k]) => {
    const el = $(sel_); if (!el) return;
    el.onchange = async () => {
      const v = k === 'cidade' ? el.value.trim() : num(el.value);
      const i = imovelSel();
      if (!i) { _avulso[k] = v; render(); return; }
      const it = { ...i, analise: { ...(i.analise || {}) } };
      if (k === 'venda') it.analise.venda_esperada = v;
      else if (k === 'cidade') it.cidade = v;
      else if (k === 'valor') it.lance_min = v;
      else if (k === 'cond') { it.analise.debitos_cond = v; it.debitos_cond = v; }
      else if (k === 'iptu') it.analise.debitos_iptu = v;
      await upsert('imoveis', it); render();
    };
  });

  // teto de faixa 2 por cidade (config do módulo)
  const bt = $('#vb-teto-salvar');
  if (bt) bt.onclick = async () => {
    const d = dados(), val = num($('#vb-teto')?.value);
    const cid = String(d.cidade || '').trim(); if (!cid) return;
    const s = { ...conf(), tetos: { ...(conf().tetos || {}), [cid]: val } };
    await setCol('config', { ...(S.config || {}), saida: s });
    render();
  };

  // flags de financiabilidade e pendências
  const gravarSaida = async (patch) => {
    const i = imovelSel();
    if (!i) { const s = { ...(conf().avulso || {}), ...patch }; await setCol('config', { ...(S.config || {}), saida: { ...conf(), avulso: s } }); render(); return; }
    const it = { ...i, saida: { ...(i.saida || {}), ...patch } };
    await upsert('imoveis', it); render();
  };

  root.querySelectorAll('[data-flag]').forEach(c => {
    c.onchange = () => {
      const d = dados(), flags = { ...((d.saida || {}).flags || {}) };
      flags[c.dataset.flag] = c.checked;
      gravarSaida({ flags });
    };
  });

  root.querySelectorAll('[data-pend]').forEach(c => {
    c.onchange = () => {
      const d = dados(), k = c.dataset.pend, pend = { ...((d.saida || {}).pend || {}) };
      pend[k] = c.checked;
      if (c.checked) { pend[k + '_em'] = hojeISO(); pend[k + '_por'] = autorNome(); }
      else { delete pend[k + '_em']; delete pend[k + '_por']; }
      gravarSaida({ pend });
    };
  });

  const obs = $('#vb-obs');
  if (obs) obs.onchange = () => gravarSaida({ obs: obs.value });

  const bs = $('#vb-salvar');
  if (bs) bs.onclick = async () => {
    const d = dados(), P = parecer(d);
    await gravarSaida({ parecer: { status: P.status, rotulo: P.rot, frase: P.frase, saida: P.sa.id, em: hojeISO(), por: autorNome() } });
    bs.textContent = '✅ Parecer salvo'; setTimeout(() => { bs.textContent = '💾 Salvar parecer no imóvel'; }, 1800);
  };

  const bsim = $('#vb-simular');
  if (bsim) bsim.onclick = () => { if (_sel) carregarImovel(_sel); irPara('/morimatsu-simulador'); };

  const bd = $('#vb-levar-div');
  if (bd) bd.onclick = async () => {
    const i = imovelSel(); if (!i) return;
    const d = dados(), di = reguaDividas(d.valor, d.cond, d.iptu);
    const it = { ...i, analise: { ...(i.analise || {}), debitos_cond: di.seuCond, debitos_iptu: di.I } };
    await upsert('imoveis', it);
    bd.textContent = '✅ Levado — a análise usa só o que fica com você'; setTimeout(() => render(), 1400);
  };

  const bp = $('#vb-imprimir');
  if (bp) bp.onclick = () => imprimirParecer(dados());

  root.querySelectorAll('[data-rota]').forEach(b => { b.onclick = () => irPara(b.dataset.rota); });
  injectCssViab();
}

/* ═════════════════ impressão ═════════════════ */
function imprimirParecer(d) {
  const P = parecer(d), i = d.i;
  const linhas = [
    ['Imóvel', i ? `${i.titulo}${i.cidade ? ' · ' + i.cidade : ''}` : 'Análise avulsa'],
    ['Modalidade', i?.modalidade || '—'],
    ['Lance mínimo do edital', i?.lance_min ? brl(i.lance_min) : '—'],
    ['Avaliação', i?.avaliacao ? brl(i.avaliacao) : '—'],
    ['Venda esperada', brl(d.venda)],
    ['Saída identificada', `${P.sa.rot}`],
    ['Impeditivos de garantia', P.fi.vetos.length ? P.fi.vetos.map(v => v[1]).join('; ') : 'nenhum marcado'],
    ['Pontos que mudam a conta', P.fi.pen.length ? P.fi.pen.map(v => v[1]).join('; ') : '—'],
    ['Dívidas que ficam com você', `${brl(P.di.total)} (condomínio ${brl(P.di.seuCond)} + IPTU ${brl(P.di.I)})`],
    ['Levantamentos pendentes', P.faltam.length ? P.faltam.map(f => f[1]).join('; ') : 'nenhum'],
  ];
  const w = window.open('', '_blank', 'width=900,height=1000'); if (!w) return;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Parecer de Viabilidade — Morimatsu</title>
  <style>
    body{font:13px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1B201D;max-width:760px;margin:32px auto;padding:0 20px}
    h1{font-size:19px;margin:0 0 2px;color:#1F4A3D} .sub{color:#666;font-size:11.5px;margin:0 0 18px}
    .selo{border-left:6px solid ${P.cor};padding:10px 14px;background:#F4F2EC;margin:0 0 16px}
    .selo b{color:${P.cor};font-size:15px;display:block}
    table{width:100%;border-collapse:collapse;margin:0 0 16px} td{padding:6px 8px;border-bottom:1px solid #e8e5dd;vertical-align:top}
    td:first-child{color:#666;width:38%} h2{font-size:13px;margin:18px 0 6px;color:#1F4A3D}
    .rod{color:#888;font-size:10.5px;border-top:1px solid #e8e5dd;padding-top:10px;margin-top:22px}
  </style>
  <h1>Parecer de Viabilidade de Leilão</h1>
  <p class="sub">Morimatsu &amp; Associados · Gestão Patrimonial Imobiliária · ${dtBR(hojeISO())} · ${esc(autorNome())}</p>
  <div class="selo"><b>${P.rot}</b>${esc(P.frase)}</div>
  <table>${linhas.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')}</table>
  <h2>Sobre a saída</h2><p>${P.sa.txt.replace(/<[^>]+>/g, '')}</p>
  ${(d.saida || {}).obs ? `<h2>Observações do levantamento</h2><p>${esc(d.saida.obs)}</p>` : ''}
  <p class="rod">Documento interno de decisão. Não é parecer jurídico: due diligence de matrícula e ação de imissão na posse são da sociedade de advogados parceira.
  Regras citadas conforme a base de conhecimento v2 do agente de leilões — confira o edital do lote e a norma vigente antes do lance.</p>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 350);
}

/* ═════════════════ css ═════════════════ */
function injectCssViab() {
  if (document.getElementById('ma-viab-css')) return;
  const s = document.createElement('style'); s.id = 'ma-viab-css';
  s.textContent = `
    .ma-viab .mb-3{margin-bottom:12px}
    .ma-hero{background:linear-gradient(135deg,#1F4A3D 0%,#2d5f4f 100%);color:#F4F2EC}
    .ma-hero .card-sub{color:#e6e2d8}
    .ma-hero-t{font-size:17px;font-weight:700}
    .ma-quote{margin:10px 0 0;padding:8px 12px;border-left:3px solid #9C7A3C;background:rgba(255,255,255,.08);font-style:italic;font-size:12.5px}
    .ma-quote .tiny{display:block;font-style:normal;margin-top:4px;color:#cfc9ba}
    .ma-selo{margin-bottom:12px}
    .ma-selo-rot{font-size:20px;font-weight:800;letter-spacing:.3px}
    .ma-selo-frase{margin:6px 0 10px;font-size:13px}
    .ma-selo-mini{display:flex;gap:18px;flex-wrap:wrap}
    .ma-vmini{display:flex;flex-direction:column;gap:1px}
    .ma-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;align-items:start}
    .ma-chk-cols{columns:2;column-gap:22px}
    @media(max-width:820px){.ma-chk-cols{columns:1}}
    .ma-chk{break-inside:avoid;-webkit-column-break-inside:avoid}
    @media(max-width:900px){.ma-grid2{grid-template-columns:1fr}}
    .ma-viab .ma-row{display:flex;gap:10px;flex-wrap:wrap}
    .ma-viab .ma-row .field{flex:1;min-width:150px}
    .ma-band{border-left:4px solid #64748b;padding:8px 12px;background:rgba(0,0,0,.03);border-radius:0 6px 6px 0;margin-top:10px}
    .dark .ma-band{background:rgba(255,255,255,.05)}
    .ma-teto{display:flex;gap:8px;align-items:flex-end;margin-top:10px}
    .ma-chk{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px dashed rgba(0,0,0,.08);cursor:pointer}
    .dark .ma-chk{border-color:rgba(255,255,255,.08)}
    .ma-chk input{margin-top:3px;flex:none}
    .ma-chk-t{font-size:11.5px;font-weight:700;margin:4px 0 2px;opacity:.85}
    .ma-tab{width:100%;border-collapse:collapse;font-size:12px}
    .ma-tab td,.ma-tab th{padding:5px 6px;border-bottom:1px solid rgba(0,0,0,.07);text-align:left}
    .dark .ma-tab td,.dark .ma-tab th{border-color:rgba(255,255,255,.08)}
    .ma-tab th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;opacity:.6}
    .ma-tab td.r{text-align:right;white-space:nowrap}
    .ma-tab tr.ma-tot td{border-top:2px solid #9C7A3C;border-bottom:none;padding-top:7px}
    .ma-num{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    @media(max-width:760px){.ma-num{grid-template-columns:1fr 1fr}}
    .ma-num>div{display:flex;flex-direction:column}
    .ma-casos{display:flex;gap:8px;flex-wrap:wrap}
    .ma-caso{flex:1;min-width:200px;text-align:left;padding:8px 10px;border:1px solid rgba(0,0,0,.12);border-radius:8px;background:transparent;cursor:pointer;display:flex;flex-direction:column;gap:2px}
    .dark .ma-caso{border-color:rgba(255,255,255,.14);color:inherit}
    .ma-caso.on{border-color:#9C7A3C;background:rgba(156,122,60,.10)}
    .ma-det{margin-top:10px}
    .ma-det summary{cursor:pointer}
  `;
  document.head.appendChild(s);
}
