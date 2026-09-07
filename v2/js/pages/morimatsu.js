/* PSM-OS v2 — 🏯 MORIMATSU & ASSOCIADOS · Gestão Patrimonial Imobiliária  v87.51
   ----------------------------------------------------------------------------
   Escritório de patrimônio (boutique pessoal do Paulo — NÃO é imobiliária).
   Ciclo em 3 práticas: AQUISIÇÃO (leilão/venda direta Caixa, fee na arrematação)
   → GESTÃO (carteira/locação 10%/mês via PSM) → DESINVESTIMENTO (saída pela PSM,
   exclusividade contratada na entrada). Marca batida em 26/ago/2026; briefing,
   contrato, recibo e ficha v2 em set/2026 (pasta Desktop/MORIMATSU/MORIMATSU &
   ASSOCIADOS — cópias em /v2/assets/morimatsu/).

   SÓ SÓCIO (lvl>=10) — menu próprio "🏯 Morimatsu & Associados"; 6 rotas
   (/morimatsu, -investidores, -honorarios, -roteiro, -documentos, -marca) que
   abrem a MESMA página na aba certa. Estado (funil de investidores, checklist
   do roteiro, notas) em shared_kv 'morimatsu_state' via /api/v3/morimatsu/state.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { ativarDrag } from '../kanban-drag.js';

const API = '/api/v3/morimatsu/state';
const ASSETS = '/v2/assets/morimatsu/';

const TABS = [
  { id: 'visao',        rota: '/morimatsu',              lbl: '🏯 Visão' },
  { id: 'investidores', rota: '/morimatsu-investidores', lbl: '💼 Investidores' },
  { id: 'honorarios',   rota: '/morimatsu-honorarios',   lbl: '💰 Honorários' },
  { id: 'roteiro',      rota: '/morimatsu-roteiro',      lbl: '🗓 Roteiro 90 dias' },
  { id: 'documentos',   rota: '/morimatsu-documentos',   lbl: '📄 Documentos' },
  { id: 'marca',        rota: '/morimatsu-marca',        lbl: '🎨 Marca' },
];

/* Paleta oficial (IDENTIDADE v1): verde profundo, dourado, tinta, marfim */
const COR = { verde: '#1F4A3D', dourado: '#9C7A3C', tinta: '#1B201D', marfim: '#F4F2EC' };

/* ── Funil do investidor (etapas do ciclo, da ficha v2 até o destino do ativo) ── */
const COLUNAS = [
  { id: 'pre',        nome: 'Pré-cadastro',        emoji: '📥', cor: '#64748b', hint: 'ficha v2 recebida · SLA 48h úteis' },
  { id: 'diagnostico', nome: 'Diagnóstico',        emoji: '🩺', cor: '#0ea5e9', hint: '20 min: objetivos + esteira de aquisição' },
  { id: 'curadoria',  nome: 'Curadoria',           emoji: '🔎', cor: '#8b5cf6', hint: 'oportunidades filtradas por perfil' },
  { id: 'analise',    nome: 'Análise · R$ 500',    emoji: '📑', cor: '#f59e0b', hint: 'viabilidade + risco + custo total' },
  { id: 'certame',    nome: 'Certame · R$ 500',    emoji: '🔨', cor: '#ef4444', hint: 'representação no lance / compra direta' },
  { id: 'arrematado', nome: 'Arrematado · fee',    emoji: '🏁', cor: COR.dourado, hint: '5% · piso R$ 6 mil · pago no ato' },
  { id: 'destino',    nome: 'Destino do ativo',    emoji: '🔁', cor: COR.verde, hint: 'flip (Conquista/PSM) ou renda (Locação 10%)' },
  { id: 'fora',       nome: 'Fora / Porta 2',      emoji: '⛔', cor: '#334155', hint: 'sem fit, ou moradia MCMV → PSM Conquista' },
];
const OBJETIVO  = { revenda: 'REVENDA', renda: 'RENDA', uso: 'USO PRÓPRIO', indef: 'INDEFINIDO' };
const PAGAMENTO = { vista: 'À vista (próprio)', mobiliza: 'À vista (mobilizando)', financ: 'Financiamento', mcmv: 'FGTS + MCMV' };
const FAIXA     = { f100: 'Até R$ 100 mil', f180: 'R$ 100–180 mil (foco CAIXA)', f300: 'R$ 180–300 mil', f500: 'R$ 300–500 mil', f1m: 'R$ 500 mil–1 mi', f1mp: 'Acima de R$ 1 mi' };
const CAPITAL   = { c100: 'Até R$ 100 mil', c200: 'R$ 100–200 mil', c400: 'R$ 200–400 mil', c1m: 'R$ 400 mil–1 mi', c1mp: 'Acima de R$ 1 mi' };
const DISP      = { imediato: 'Imediato', dias: 'Em dias', d30: 'Até 30 dias', d30p: 'Mais de 30 dias' };
const MODAL     = { online: '01 Venda online', direta: '02 Venda direta', extra: '03 Leilão extrajudicial', judicial: '04 Leilão judicial' };
const RAIO      = ['São José do Rio Preto', 'Mirassol', 'Bady Bassitt', 'Cedral', 'Guapiaçu', 'Bálsamo', 'Neves Paulista', 'Jaci', 'Ipiguá'];
const ORIGEM    = ['Indicação', 'Instagram/LinkedIn', 'Canal P&A', 'Google', 'Apresentação/evento', 'Outro'];
const FAIXA_MAX = { f100: 100, f180: 180, f300: 300, f500: 500, f1m: 1000, f1mp: 9999 };
const CAP_MAX   = { c100: 100, c200: 200, c400: 400, c1m: 1000, c1mp: 9999 };

/* Score de fit (ficha v2): 25 faixa foco · 15 região · 10 modalidade · 30 capital≥faixa · 20 recurso ≤30d */
function scoreDe(c) {
  let s = 0;
  if (c.faixa === 'f180') s += 25;
  if (RAIO.includes(c.regiao)) s += 15;
  if ((c.modalidades || []).length) s += 10;
  if (c.capital && c.faixa && (CAP_MAX[c.capital] || 0) >= (FAIXA_MAX[c.faixa] || 0)) s += 30;
  if (['imediato', 'dias', 'd30'].includes(c.disp)) s += 20;
  return s;
}
/* Porta 2 = moradia MCMV: objetivo USO PRÓPRIO + financiamento/MCMV + faixa ≤ 400k → vitrine PSM Conquista */
const porta2 = c => c.objetivo === 'uso' && ['financ', 'mcmv'].includes(c.pagamento) && (FAIXA_MAX[c.faixa] || 0) <= 500;
const alertaCapital = c => c.capital && c.faixa && (CAP_MAX[c.capital] || 0) < (FAIXA_MAX[c.faixa] || 0);

/* ── Roteiro de retomada (artifact "Plano Morimatsu & Associados", 26/ago/2026) ── */
const ROTEIRO = [
  { id: 's1', quando: 'SEMANA 1', titulo: 'Fundações que não custam nada', itens: [
    { id: 's1a', t: 'Registrar morimatsuassociados.com.br e morimatsu.com.br (registro.br) + reservar @morimatsuassociados no Instagram', quem: 'Paulo' },
    { id: 's1b', t: 'Conversa com a Ariane: a FOLK vira a casca da Morimatsu — Folk 3.0 encerra ou muda de CNPJ', quem: 'Paulo + Ariane' },
    { id: 's1c', t: 'Validar o plano com a Isabella: sociedade, papéis das PSMs, portões', quem: 'Paulo + Isabella' },
    { id: 's1d', t: 'Isabella cria Login Caixa e vincula o CNPJ dela no Portal de Licitações (Área do Fornecedor → Cadastrar Novo CNPJ)', quem: 'Isabella' },
    { id: 's1e', t: 'Publicar a vaga do advogado no ATS (Talentos) com o desenho de 3 fases', quem: 'Paulo' },
  ] },
  { id: 's2', quando: 'SEMANAS 2–3', titulo: 'Estrutura legal e identidade', itens: [
    { id: 's2a', t: 'Contador: alteração contratual da FOLK — razão social Morimatsu & Associados, CNAE 7022-0/00, endereço (R$ 500–1.500)', quem: 'Contador' },
    { id: 's2b', t: 'Identidade visual mínima: logotipo, papel timbrado, modelo de proposta e de parecer (código de firma)', quem: 'Paulo' },
    { id: 's2c', t: 'Entrevistar advogados imobiliaristas com arrematação real; selecionar 2 pra Fase 1 ("me conta uma desocupação que você conduziu")', quem: 'Paulo' },
  ] },
  { id: 's3', quando: 'SEMANAS 3–4', titulo: 'Produto e esteira', itens: [
    { id: 's3a', t: 'Fechar a tabela (5% · piso R$ 6 mil) e minutar o contrato de assessoria com a Trava 1; advogado Fase 1 revisa', quem: 'Paulo + advogado' },
    { id: 's3b', t: 'Esteira de garimpo: rotina diária no portal da Caixa (Rio Preto e região) com ficha de análise padronizada', quem: 'Paulo' },
    { id: 's3c', t: 'Ensaio geral: 2–3 imóveis reais rodando o ciclo completo sem cliente (garimpo → parecer → lance máximo → plano de saída)', quem: 'Time' },
  ] },
  { id: 'm2', quando: 'MÊS 2', titulo: 'Piloto com dinheiro de verdade', itens: [
    { id: 'm2a', t: 'Selecionar 3–5 investidores fundadores na base MAP / P&A (condição especial por case e depoimento)', quem: 'Paulo' },
    { id: 'm2b', t: 'Primeira aquisição assessorada (venda direta ou leilão) — o fee entra no ato', quem: 'Time' },
    { id: 'm2c', t: 'Teste controlado da Porta 2: retomados financiáveis pros leads ATE_2250 da Conquista', quem: 'Conquista' },
  ] },
  { id: 'm3', quando: 'MÊS 3', titulo: 'Escala e formalização', itens: [
    { id: 'm3a', t: 'Publicar os primeiros cases no canal P&A (formato "Ativo") e no IG Paulo Morimatsu', quem: 'Paulo' },
    { id: 'm3b', t: 'Avaliar a passagem do advogado à Fase 2 (exclusividade + participação no fee)', quem: 'Paulo + Isabella' },
    { id: 'm3c', t: 'Portão de investimento: os números do piloto decidem site, mídia e cadência de contratação', quem: 'Sócios' },
  ] },
];
const PORTOES = [
  { t: 'Portão A · fim da Semana 4', d: 'Contrato minutado, advogado Fase 1 ativo e ensaio geral rodado em 2–3 imóveis reais. Sem isso, não se fala com investidor.' },
  { t: 'Portão B · fim do Mês 2', d: 'Primeira aquisição concluída com fee pago e cliente satisfeito. Sem isso: revisar preço, esteira ou perfil — não escalar.' },
  { t: 'Portão C · fim do Mês 3', d: '2+ giros contratados e 1 case publicável. Destrava investimento em marca e a Fase 2 do advogado.' },
];
const ADV_FASES = [
  { t: 'Fase 1 · Por demanda', d: 'Parecer avulso pago por peça (R$ 1,5–3 mil, embutido no fee). Zero custo fixo. Dois candidatos em paralelo, casos reais.' },
  { t: 'Fase 2 · Exclusividade', d: 'Quem performa recebe percentual do fee de cada aquisição, com dedicação ao funil Morimatsu.' },
  { t: 'Fase 3 · Sociedade', d: 'Sócio minoritário na Morimatsu + sociedade OAB própria assinando o jurídico. Vesting por entrega.' },
];

const DOCS = [
  { arq: 'Briefing-Posicionamento-Morimatsu-v1.docx', ico: '🧭', t: 'Briefing de Posicionamento v1', d: 'Marca, modelo em 3 práticas, duas portas, dores/objeções, tabela de honorários, vocabulário, tom de voz, compliance e métricas-norte. set/2026.' },
  { arq: 'Contrato-Assessoria-Aquisicao-Morimatsu-v1.docx', ico: '📜', t: 'Contrato de Assessoria em Aquisição v1', d: 'Objeto (7 frentes), natureza consultiva (obrigação de meio, sem advocacia), honorários (a) R$ 500/imóvel (b) R$ 500/certame (c) 5% piso R$ 6 mil, §4º 12 meses, Cláusula 6ª exclusividade PSM 180 dias, vigência 12m, título executivo.' },
  { arq: 'Recibo-Pagamento-Morimatsu-modelo-v1.docx', ico: '🧾', t: 'Recibo de Pagamento — modelo v1', d: 'Nº ANO-SEQ · modalidade · matrícula; quitação plena; PIX chave CNPJ.' },
  { arq: 'Ficha-Pre-Cadastro-Investidor-v2.docx', ico: '📋', t: 'Ficha de Pré-Cadastro do Investidor v2', d: 'Etapa 01 do funil: 8 seções, roteio automático Porta 1 × Porta 2, validação capital × faixa, trava CAIXA, score de fit (≥70 qualificado · 40–69 nutrição · <40 fora). É a mesma ficha da aba Investidores.' },
];

let _root = null, _tab = 'visao', _state = null, _err = null, _edit = null, _busca = '';

export async function pageMorimatsu(ctx, root, tab) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 10) { root.innerHTML = '<div class="alert alert-warn">🔒 Morimatsu & Associados é restrito aos sócios.</div>'; return; }
  _tab = tab || (ctx?.query?.tab) || 'visao';
  if (!TABS.some(t => t.id === _tab)) _tab = 'visao';
  injectCss();
  render();
  await load();
}

async function load() {
  try { const r = await api.request(API); _state = r.state || { investidores: [], roteiro: {}, notas: '' }; _err = null; }
  catch (e) { _err = e.message || 'falha ao carregar'; _state = _state || { investidores: [], roteiro: {}, notas: '' }; }
  render();
}
async function salvar(patch) {
  try { const r = await api.request(API, { method: 'POST', body: { patch } }); if (r?.state) _state = r.state; _err = null; }
  catch (e) { _err = 'Não salvou: ' + (e.message || e); }
  render();
}

/* ─────────────────────────── render ─────────────────────────── */
function render() {
  if (!_root) return;
  const dark = document.documentElement.classList.contains('dark');
  const logo = dark ? '/v2/img/morimatsu-logo-negativa.png' : '/v2/img/morimatsu-logo-marfim.png';
  _root.innerHTML = `
    <div class="ma-wrap">
      <div class="ma-head">
        <img src="${logo}" alt="Morimatsu & Associados" class="ma-logo">
        <div class="ma-head-txt">
          <div class="ma-kicker">Escritório de patrimônio · boutique do sócio · só sócios</div>
          <div class="ma-frase">“O ciclo completo do patrimônio imobiliário: <b>comprar bem, gerir bem, sair melhor.</b>”</div>
        </div>
      </div>
      <div class="ma-tabs">${TABS.map(t => `<button class="btn ${t.id === _tab ? 'btn-primary' : 'btn-ghost'} ma-tab" data-tab="${t.id}" data-rota="${t.rota}">${t.lbl}</button>`).join('')}</div>
      ${_err ? `<div class="alert alert-err" style="margin-bottom:10px">${esc(_err)}</div>` : ''}
      <div id="ma-body">${({ visao, investidores, honorarios, roteiro, documentos, marca })[_tab]()}</div>
    </div>`;
  // trocar de aba = trocar de rota (o router re-renderiza na aba certa e o menu destaca o item)
  _root.querySelectorAll('.ma-tab').forEach(b => b.onclick = () => { _edit = null; location.hash = '#' + b.dataset.rota; });
  wire();
}

/* ─────────────────────────── 🏯 VISÃO ─────────────────────────── */
function visao() {
  const inv = _state?.investidores || [];
  const ativos = inv.filter(c => !['fora'].includes(c.coluna));
  const arrem = inv.filter(c => ['arrematado', 'destino'].includes(c.coluna)).length;
  const feito = Object.values(_state?.roteiro || {}).filter(x => x?.done).length;
  const total = ROTEIRO.reduce((n, f) => n + f.itens.length, 0);
  const mini = (l, v, h) => `<div class="ma-mini"><div class="tiny muted">${l}</div><div class="ma-mini-v">${v}</div>${h ? `<div class="tiny muted">${h}</div>` : ''}</div>`;
  return `
    <div class="ma-minis">
      ${mini('💼 Investidores na esteira', ativos.length, `${inv.length} no total`)}
      ${mini('🏁 Arrematações com fee', arrem, 'meta de rampa 1 → 2 → 4 giros/mês')}
      ${mini('🗓 Roteiro 90 dias', `${feito}/${total}`, 'itens concluídos')}
      ${mini('🚫 Linha vermelha', 'R$ 0 fixo', 'nenhum custo fixo novo até dez/2026')}
    </div>

    <div class="card">
      <h2 class="card-title">A tese</h2>
      <p class="card-sub">Três frentes paradas (Terceiros, lançamentos MAP e Locações) viram um único ciclo com o <b>investidor no centro</b>: a Morimatsu assessora a compra (leilão e venda direta Caixa), a PSM executa a saída (venda ou locação) — e a exclusividade deixa de ser pedida pra ser consequência.</p>
      <p class="card-sub">Alto padrão de verdade não acontece em imobiliária: acontece em <b>escritórios que gerem a vida patrimonial do cliente</b>. Em Rio Preto ninguém ocupa essa categoria. O qualificador "imobiliária" é inegociável — inaugura categoria própria e evita terreno CVM. Vocabulário de family office vive na copy, nunca no nome.</p>
    </div>

    <div class="ma-grid3">
      <div class="ma-pratica"><div class="ma-pratica-n">01</div><b>AQUISIÇÃO</b><div class="ma-pratica-s">porta de entrada</div><p>Garimpo, análise e representação em leilões e compra direta de retomados. Foco: <b>CAIXA, ticket R$ 100–180 mil</b>. Fee de êxito pago na arrematação — caixa imediato.</p></div>
      <div class="ma-pratica"><div class="ma-pratica-n">02</div><b>GESTÃO</b><div class="ma-pratica-s">recorrência</div><p>Carteira sob mandato: locação e administração <b>10%/mês</b> via bandeira de Locação PSM. Ativa quando o cliente acumula 3–4 ativos (Trava 3).</p></div>
      <div class="ma-pratica"><div class="ma-pratica-n">03</div><b>DESINVESTIMENTO</b><div class="ma-pratica-s">saída pela PSM</div><p>Revenda com exclusividade contratada na entrada (Trava 1, Cláusula 6ª). A corretagem flui pelos CRECIs das PSMs; a Morimatsu fatura só o fee.</p></div>
    </div>

    <div class="card">
      <h2 class="card-title">O ciclo — jornada do investidor com as 3 travas de exclusividade</h2>
      <ol class="ma-ciclo">
        <li><b>Etapa 0 · Entrada</b> — contrato de assessoria (canal P&A, IG Paulo Morimatsu, indicação). Reunião de tese: capital, retorno, flip ou renda. <span class="ma-trava">Trava 1 — cláusula de saída exclusiva pela PSM assinada aqui</span></li>
        <li><b>Etapa 1 · Aquisição</b> — garimpo → parecer OAB → lance máximo com regra de deságio → posse. Fee no ato. Quem calculou o preço de entrada sabe o preço de saída.</li>
        <li><b>Etapa 2 · Mesa de ciclo</b> — imóvel regularizado, decisão formal do destino: flip ou renda. <span class="ma-trava">Trava 2 — contrato padrão PSM (exclusividade, 6%, título executivo)</span></li>
        <li><b>Etapa 3 · Saída</b> — flip pela Conquista (estoque exclusivo com deságio, vende rápido e vira case) · renda pela Locação (taxa de 1º aluguel + 10%/mês, investidor entra na régua de CS).</li>
        <li><b>Etapa 4 · Reciclagem</b> — relatório de TIR → próximo edital. Quem acumula 3–4 ativos evolui de contrato. <span class="ma-trava">Trava 3 — mandato de gestão de carteira</span></li>
      </ol>
    </div>

    <div class="card">
      <h2 class="card-title">Duas portas, uma esteira</h2>
      <div style="overflow-x:auto"><table class="ma-tbl">
        <tr><th></th><th>Porta 1 · Investidor de giro</th><th>Porta 2 · Moradia final</th></tr>
        <tr><td><b>Marca que atende</b></td><td>Morimatsu & Associados</td><td>PSM Conquista (a Morimatsu <b>nunca</b> fala com comprador MCMV)</td></tr>
        <tr><td><b>Imóvel-alvo</b></td><td>Ocupado, à vista — deságio máximo; a desocupação é o serviço</td><td>Desocupado, financiável — MCMV + FGTS</td></tr>
        <tr><td><b>Cliente</b></td><td>35–54 anos, capital próprio, carteira de 3 a 30 imóveis ou começando; base MAP / P&A; tese R$ 500k</td><td>Lead que a Conquista já tem — inclusive ATE_2250 da nutrição</td></tr>
        <tr><td><b>Receita</b></td><td>Fee 5% · piso R$ 6 mil + saída pela PSM</td><td>Fee reduzido; comissão da Caixa (~5%) quando o credenciamento sair</td></tr>
      </table></div>
      <p class="tiny muted mt-2">Anti-público: quem quer "tentar a sorte", dica grátis, impulso sem reserva pra custas, promessa de retorno.</p>
    </div>

    <div class="card">
      <h2 class="card-title">📝 Notas do sócio</h2>
      <p class="card-sub">Bloco livre (decisões, contatos, próximos passos). Salva pra todos os sócios.</p>
      <textarea id="ma-notas" class="input" rows="6" style="width:100%;font-family:inherit">${esc(_state?.notas || '')}</textarea>
      <div class="flex gap-2 mt-2"><button class="btn btn-primary" id="ma-notas-save">💾 Salvar notas</button><span class="tiny muted" id="ma-notas-st"></span></div>
    </div>

    <div class="card">
      <h2 class="card-title">Salvaguardas de operação</h2>
      <ul class="ma-ul">
        <li><b>Ocupação:</b> boa parte do estoque Caixa vem ocupado. Desocupação precificada <i>antes</i> do lance (acordo ~R$ 3–5 mil ou ação de imissão), dita ao cliente por escrito.</li>
        <li><b>Débitos de condomínio:</b> o edital de cada unidade define quem paga o atrasado. Item obrigatório do parecer.</li>
        <li><b>Estado do imóvel:</b> venda direta muitas vezes sem visita interna — reforma pelo pior cenário do padrão do prédio.</li>
        <li><b>Marca pessoal na porta:</b> com "Morimatsu" no nome, um caso malconduzido custa reputação. Nenhum cliente antes do Portão A.</li>
        <li><b>Enquadramento MCMV (Porta 2):</b> faixa de renda, teto por cidade e ficha do imóvel validados antes de o cliente se empolgar.</li>
        <li><b>Credenciamento Caixa:</b> a PSM NÃO está na lista oficial; é por edital com janela (monitor diário 9h). O modelo Morimatsu não depende dele — o fee vem do comprador.</li>
      </ul>
    </div>`;
}

/* ─────────────────────────── 💼 INVESTIDORES ─────────────────────────── */
function investidores() {
  const inv = (_state?.investidores || []).filter(c => !_busca || (c.nome + ' ' + (c.cidade || '') + ' ' + (c.fone || '')).toLowerCase().includes(_busca.toLowerCase()));
  const porCol = {};
  inv.forEach(c => { (porCol[c.coluna || 'pre'] = porCol[c.coluna || 'pre'] || []).push(c); });
  const qual = inv.filter(c => scoreDe(c) >= 70 && c.coluna !== 'fora').length;
  const mini = (l, v, cor) => `<div class="ma-mini" style="border-left-color:${cor}"><div class="tiny muted">${l}</div><div class="ma-mini-v">${v}</div></div>`;
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div><h2 class="card-title" style="margin:0">💼 Funil do investidor</h2><div class="card-sub" style="margin:0">Ficha v2 → diagnóstico → curadoria → análise → certame → arrematação → destino. Arraste o card; clique pra abrir.</div></div>
        <span class="h-spacer" style="flex:1"></span>
        <input class="input" id="ma-busca" placeholder="🔍 nome, cidade, fone" value="${esc(_busca)}" style="max-width:220px">
        <button class="btn btn-primary" id="ma-novo">＋ Novo investidor</button>
      </div>
      <div class="ma-minis" style="margin-top:10px">
        ${mini('📥 Na esteira', inv.filter(c => c.coluna !== 'fora').length, '#64748b')}
        ${mini('✅ Qualificados (score ≥ 70)', qual, '#16a34a')}
        ${mini('🏁 Arrematados', inv.filter(c => ['arrematado', 'destino'].includes(c.coluna)).length, COR.dourado)}
        ${mini('🚪 Porta 2 → Conquista', inv.filter(porta2).length, '#0ea5e9')}
      </div>
    </div>
    ${_edit ? formInvestidor(_edit) : ''}
    <div class="ma-kanban" id="ma-kanban">
      ${COLUNAS.map(col => {
        const lista = (porCol[col.id] || []).slice().sort((a, b) => scoreDe(b) - scoreDe(a));
        return `<div class="ma-col" data-col="${col.id}" style="border-top-color:${col.cor}">
          <div class="ma-col-h"><b>${col.emoji} ${esc(col.nome)}</b><span class="muted">${lista.length}</span></div>
          <div class="tiny muted" style="padding:0 4px 6px">${esc(col.hint)}</div>
          <div class="ma-col-b">${lista.map(cardHtml).join('') || '<div class="tiny muted" style="text-align:center;padding:14px 0">vazio</div>'}</div>
        </div>`;
      }).join('')}
    </div>`;
}
function cardHtml(c) {
  const s = scoreDe(c);
  const cor = s >= 70 ? '#16a34a' : s >= 40 ? '#d97706' : '#64748b';
  return `<div class="ma-card" data-id="${esc(c.id)}">
    <div class="flex items-center gap-2"><b style="flex:1">${esc(c.nome)}</b><span class="ma-score" style="background:${cor}">${s}</span></div>
    <div class="tiny muted">${esc([OBJETIVO[c.objetivo], FAIXA[c.faixa], c.cidade].filter(Boolean).join(' · '))}</div>
    <div class="ma-tags">
      ${porta2(c) ? '<span class="ma-tag" style="background:#0ea5e9">🚪 Porta 2</span>' : ''}
      ${c.caixa ? '<span class="ma-tag" style="background:#ef4444">🔴 vínculo CAIXA</span>' : ''}
      ${alertaCapital(c) ? '<span class="ma-tag" style="background:#d97706">🟡 capital &lt; faixa</span>' : ''}
      ${c.fone ? `<a class="ma-tag" style="background:#16a34a" href="https://wa.me/55${esc(String(c.fone).replace(/\D/g, ''))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
    </div>
  </div>`;
}
function formInvestidor(c) {
  const sel = (name, map, val, multi) => `<select class="input" name="${name}" ${multi ? 'multiple size="4"' : ''}>${!multi ? '<option value="">—</option>' : ''}${Object.entries(map).map(([k, v]) => `<option value="${k}" ${(multi ? (val || []).includes(k) : val === k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  const f = (lbl, inner) => `<label class="field"><span class="tiny muted">${lbl}</span>${inner}</label>`;
  return `<div class="card" id="ma-form">
    <h2 class="card-title">${c.id ? '✏️ Editar' : '＋ Novo'} investidor <span class="tiny muted">(ficha de pré-cadastro v2)</span></h2>
    <form class="ma-form">
      ${f('Nome completo *', `<input class="input" name="nome" required value="${esc(c.nome || '')}">`)}
      ${f('WhatsApp (com DDD)', `<input class="input" name="fone" value="${esc(c.fone || '')}">`)}
      ${f('Cidade onde mora', `<input class="input" name="cidade" value="${esc(c.cidade || '')}">`)}
      ${f('Objetivo (roteio)', sel('objetivo', OBJETIVO, c.objetivo))}
      ${f('Como pretende pagar', sel('pagamento', PAGAMENTO, c.pagamento))}
      ${f('Faixa de valor do imóvel', sel('faixa', FAIXA, c.faixa))}
      ${f('Capital disponível (lance + custas)', sel('capital', CAPITAL, c.capital))}
      ${f('Disponibilidade do recurso', sel('disp', DISP, c.disp))}
      ${f('Modalidades (ctrl/cmd p/ várias)', sel('modalidades', MODAL, c.modalidades, true))}
      ${f('Região de interesse', `<select class="input" name="regiao"><option value="">—</option>${RAIO.map(r => `<option ${c.regiao === r ? 'selected' : ''}>${r}</option>`).join('')}<option value="Outra" ${c.regiao === 'Outra' ? 'selected' : ''}>Outra (fora do raio)</option></select>`)}
      ${f('Ocupação aceita', `<select class="input" name="ocupacao"><option value="">—</option>${['Preferência por desocupado', 'Aceito ocupado', 'Indiferente'].map(o => `<option ${c.ocupacao === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`)}
      ${f('Como conheceu', `<select class="input" name="origem"><option value="">—</option>${ORIGEM.map(o => `<option ${c.origem === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`)}
      ${f('Etapa', `<select class="input" name="coluna">${COLUNAS.map(k => `<option value="${k.id}" ${(c.coluna || 'pre') === k.id ? 'selected' : ''}>${k.emoji} ${esc(k.nome)}</option>`).join('')}</select>`)}
      ${f('Vínculo CAIXA (empregado ou parente)', `<select class="input" name="caixa"><option value="">Não</option><option value="1" ${c.caixa ? 'selected' : ''}>Sim — trava leilões CAIXA</option></select>`)}
      <label class="field" style="grid-column:1/-1"><span class="tiny muted">Observações / histórico</span><textarea class="input" name="obs" rows="3">${esc(c.obs || '')}</textarea></label>
      <div class="flex gap-2" style="grid-column:1/-1;align-items:center">
        <button class="btn btn-primary" type="submit">💾 Salvar</button>
        <button class="btn btn-ghost" type="button" id="ma-cancel">Cancelar</button>
        ${c.id ? '<button class="btn btn-danger" type="button" id="ma-del" style="margin-left:auto">🗑 Excluir</button>' : ''}
        <span class="tiny muted">Score de fit calculado ao salvar: 25 faixa foco · 15 região · 10 modalidade · 30 capital ≥ faixa · 20 recurso ≤ 30d</span>
      </div>
    </form>
  </div>`;
}

/* ─────────────────────────── 💰 HONORÁRIOS ─────────────────────────── */
function honorarios() {
  return `
    <div class="card">
      <h2 class="card-title">Tabela de honorários — v1 aprovada (set/2026)</h2>
      <div style="overflow-x:auto"><table class="ma-tbl">
        <tr><th>Serviço</th><th>Valor</th><th>Observação</th></tr>
        <tr><td>Análise comercial e jurídica por imóvel</td><td class="ma-num">R$ 500 / imóvel</td><td>Viabilidade + risco + custas totais. Produto de entrada.</td></tr>
        <tr><td>Participação em certame (representação)</td><td class="ma-num">R$ 500 / certame</td><td>Antecipada. Deduzida do êxito em caso de arrematação.</td></tr>
        <tr><td><b>Honorários de êxito</b></td><td class="ma-num"><b>5% da arrematação · piso R$ 6.000</b></td><td>Pago na arrematação (caixa imediato). 3–5% negociável em tickets altos; o piso protege o ticket CAIXA.</td></tr>
        <tr><td>Curadoria de oportunidades (volume)</td><td class="ma-num">Sob consulta</td><td>10 imóveis/semana filtrados por perfil, pra investidor com volume.</td></tr>
        <tr><td>Gestão de carteira (mandato)</td><td class="ma-num">10% / mês sobre locação</td><td>Via bandeira de Locação PSM. Trava 3 do ciclo.</td></tr>
      </table></div>
      <p class="tiny muted mt-2"><b>Não incluso, cobrado à parte:</b> ações judiciais (imissão, embargos, anulações — sociedade de advocacia parceira), custas processuais e cartorárias, ITBI, registro, débitos do imóvel, comissão do leiloeiro, deslocamentos fora da comarca.</p>
    </div>

    <div class="card">
      <h2 class="card-title">🧮 Calculadora de giro</h2>
      <p class="card-sub">Quanto o grupo fatura num giro: fee Morimatsu na arrematação + comissão PSM na saída. Referência do plano: avaliação R$ 180k, compra R$ 120k, revenda R$ 175k → ~R$ 16,5k pro grupo.</p>
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <label class="field"><span class="tiny muted">Avaliação Caixa (R$)</span><input class="input" id="g-aval" type="number" value="180000"></label>
        <label class="field"><span class="tiny muted">Lance / compra (R$)</span><input class="input" id="g-lance" type="number" value="120000"></label>
        <label class="field"><span class="tiny muted">Fee de êxito (%)</span><input class="input" id="g-fee" type="number" step="0.5" value="5"></label>
        <label class="field"><span class="tiny muted">Piso do fee (R$)</span><input class="input" id="g-piso" type="number" value="6000"></label>
        <label class="field"><span class="tiny muted">Custos do investidor (R$)</span><input class="input" id="g-custos" type="number" value="18000"></label>
        <label class="field"><span class="tiny muted">Revenda pela PSM (R$)</span><input class="input" id="g-rev" type="number" value="175000"></label>
        <label class="field"><span class="tiny muted">Comissão PSM na venda (%)</span><input class="input" id="g-com" type="number" step="0.5" value="6"></label>
        <label class="field"><span class="tiny muted">Aluguel mensal se for renda (R$)</span><input class="input" id="g-alug" type="number" value="1200"></label>
      </div>
      <div class="ma-minis" id="g-out" style="margin-top:12px"></div>
      <p class="tiny muted mt-2">Trilha renda: taxa de 1º aluguel + 10%/mês perpétuos na administração. Três giros/mês ≈ R$ 50 mil/mês — o tamanho do buraco que o Plano de Resgate cobre hoje do bolso.</p>
    </div>

    <div class="card">
      <h2 class="card-title">Como o dinheiro flui na holding</h2>
      <ul class="ma-ul">
        <li><b>Morimatsu & Associados</b> (casca = CNPJ FOLK alterado, CNAE consultoria) fatura <b>só o fee de assessoria</b>.</li>
        <li><b>Corretagem</b> (venda 6% e locação) flui pelas <b>PSM 180 / 152</b> — CRECIs jurídicos de Paulo e Isabella. Caixa segue no Plano de Resgate.</li>
        <li><b>Advogado</b>: sócio minoritário na Morimatsu E sociedade OAB própria que assina due diligence e desocupação. OAB proíbe não-advogado como sócio de advocacia e proíbe advocacia de captar/anunciar/receber corretagem — advocacia é o <b>selo</b>, nunca o motor.</li>
        <li><b>Linha vermelha:</b> nenhum custo fixo novo até dez/2026 — a vertical nasce 100% variável.</li>
      </ul>
    </div>`;
}
function calcGiro() {
  const n = id => parseFloat(_root.querySelector('#' + id)?.value) || 0;
  const aval = n('g-aval'), lance = n('g-lance'), feeP = n('g-fee'), piso = n('g-piso'), custos = n('g-custos'), rev = n('g-rev'), comP = n('g-com'), alug = n('g-alug');
  const fee = Math.max(lance * feeP / 100, piso);
  const com = rev * comP / 100;
  const lucro = rev - lance - custos - fee - com;
  const desc = aval ? Math.round((1 - lance / aval) * 100) : 0;
  const brl = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  const mini = (l, v, h, cor) => `<div class="ma-mini" style="border-left-color:${cor || COR.verde}"><div class="tiny muted">${l}</div><div class="ma-mini-v">${v}</div>${h ? `<div class="tiny muted">${h}</div>` : ''}</div>`;
  const out = _root.querySelector('#g-out');
  if (out) out.innerHTML = [
    mini('🏯 Fee Morimatsu (no ato)', brl(fee), fee === piso && lance * feeP / 100 < piso ? 'piso aplicado' : `${feeP}% do lance`, COR.dourado),
    mini('🏘 Comissão PSM na saída', brl(com), `${comP}% de ${brl(rev)}`),
    mini('💼 Receita do grupo por giro', brl(fee + com), '', COR.verde),
    mini('📈 Lucro bruto do investidor', brl(lucro), `${lance ? Math.round(lucro / (lance + custos + fee) * 100) : 0}% sobre o capital · desconto ${desc}% vs avaliação`, lucro > 0 ? '#16a34a' : '#ef4444'),
    mini('🔑 Se virar renda: adm 10%/mês', brl(alug * 0.10) + '/mês', `${brl(alug * 0.10 * 12)}/ano perpétuos + 1º aluguel`, '#0ea5e9'),
  ].join('');
}

/* ─────────────────────────── 🗓 ROTEIRO ─────────────────────────── */
function roteiro() {
  const st = _state?.roteiro || {};
  const total = ROTEIRO.reduce((n, f) => n + f.itens.length, 0);
  const feito = ROTEIRO.reduce((n, f) => n + f.itens.filter(i => st[i.id]?.done).length, 0);
  const pct = total ? Math.round(feito / total * 100) : 0;
  return `
    <div class="card">
      <h2 class="card-title">Roteiro de retomada — 90 dias</h2>
      <p class="card-sub">Do artifact "Plano Morimatsu & Associados" (26/ago/2026). Marque o que foi feito — fica salvo pra todos os sócios.</p>
      <div class="ma-bar"><div style="width:${pct}%"></div></div>
      <div class="tiny muted">${feito}/${total} concluídos · ${pct}%</div>
    </div>
    ${ROTEIRO.map(f => `<div class="card">
      <div class="flex items-center gap-2"><span class="ma-when">${f.quando}</span><h2 class="card-title" style="margin:0">${esc(f.titulo)}</h2></div>
      <div class="ma-check">
        ${f.itens.map(i => { const d = st[i.id]; return `<label class="ma-item ${d?.done ? 'done' : ''}">
          <input type="checkbox" data-rot="${i.id}" ${d?.done ? 'checked' : ''}>
          <span>${esc(i.t)} <span class="ma-quem">${esc(i.quem)}</span>${d?.done && d.em ? `<span class="tiny muted"> · ✓ ${esc(String(d.em).slice(0, 10))}</span>` : ''}</span>
        </label>`; }).join('')}
      </div>
    </div>`).join('')}
    <div class="card">
      <h2 class="card-title">Trilhas paralelas — já rodando</h2>
      <ul class="ma-ul">
        <li>✓ Cadastro de fornecedor da PSM (50.741.349/0001-52) verificado no Portal Licitações — pronto pra próxima janela.</li>
        <li>✓ Monitor diário do credenciamento Caixa às 9h — alerta com edital, prazo e passos no dia em que a janela abrir.</li>
        <li>Locação Georgina + Platz segue em paralelo — é o destino da trilha renda, não espera o leilão maturar.</li>
        <li>Documentos de habilitação: emitir só quando o edital abrir — lista de certidões mapeada pra emissão rápida.</li>
      </ul>
    </div>
    <div class="ma-grid3">${PORTOES.map(p => `<div class="ma-gate"><b>${esc(p.t)}</b><p>${esc(p.d)}</p></div>`).join('')}</div>
    <div class="card"><h2 class="card-title">O sócio jurídico — advogado em 3 fases</h2>
      <div class="ma-grid3">${ADV_FASES.map(p => `<div class="ma-gate"><b>${esc(p.t)}</b><p>${esc(p.d)}</p></div>`).join('')}</div>
      <p class="tiny muted mt-2">Apresentação ao cliente: "análise jurídica por [Escritório X] Advocacia". Hoje a parceira de referência do briefing é a Dra. Rafaela.</p>
    </div>`;
}

/* ─────────────────────────── 📄 DOCUMENTOS ─────────────────────────── */
function documentos() {
  return `
    <div class="card">
      <h2 class="card-title">Documentos oficiais (v1 · set/2026)</h2>
      <p class="card-sub">Cópias servidas pelo House. Os originais moram em <code>Desktop/MORIMATSU/MORIMATSU & ASSOCIADOS</code>. Ao revisar um documento, suba a versão nova na pasta e peça pra atualizar aqui.</p>
      <div class="ma-docs">
        ${DOCS.map(d => `<div class="ma-doc"><div class="ma-doc-ico">${d.ico}</div><div style="flex:1"><b>${esc(d.t)}</b><div class="tiny muted">${esc(d.d)}</div></div><a class="btn btn-ghost" href="${ASSETS}${d.arq}" download>⬇ .docx</a></div>`).join('')}
      </div>
    </div>
    <div class="card">
      <h2 class="card-title">Pontos do contrato que sustentam o ciclo</h2>
      <ul class="ma-ul">
        <li><b>Cláusula 3ª</b> — natureza consultiva, obrigação de meio, sem garantia de arrematação/desocupação/prazo. NÃO abrange atos privativos de advocacia (Lei 8.906/94): pareceres e ações são da sociedade parceira, contrato próprio.</li>
        <li><b>Cláusula 4ª</b> — (a) R$ 500/imóvel antecipado · (b) R$ 500/certame antecipado, deduzido do êxito · (c) 5% sobre arrematação, piso R$ 6.000, devidos na arrematação. §4º: êxito devido mesmo se o cliente arrematar por fora imóvel apresentado, por 12 meses.</li>
        <li><b>Cláusula 6ª (Trava 1)</b> — exclusividade às empresas PSM na revenda/locação de todo imóvel adquirido: 180 dias prorrogáveis; venda por fora = corretagem integral como multa.</li>
        <li><b>Cláusula 7ª</b> — cliente mantém recurso pro lance (24–48h do edital) e declara vínculo com a instituição credora (leilões CAIXA).</li>
        <li><b>Cláusula 9ª/10ª</b> — 12 meses renováveis, aviso 30 dias; foro Rio Preto; título executivo extrajudicial, 2 testemunhas.</li>
      </ul>
    </div>
    <div class="card">
      <h2 class="card-title">Links e pendências</h2>
      <ul class="ma-ul">
        <li>📐 Plano completo (artifact 26/ago): <a href="https://claude.ai/code/artifact/3a939795-b5af-4020-89ef-7af6945d1533" target="_blank" rel="noopener">Plano Morimatsu & Associados</a></li>
        <li>🌐 Domínios livres em 26/ago (registro.br): <b>morimatsuassociados.com.br</b>, <b>morimatsueassociados.com.br</b>, <b>morimatsu.com.br</b> — registrar (item 1 do roteiro).</li>
        <li>🏦 Credenciamento Caixa: <a href="https://licitacoes.caixa.gov.br" target="_blank" rel="noopener">licitacoes.caixa.gov.br</a> — modalidade Credenciamento, editais regionais por GILOG; PSM fora da lista oficial; Isabella ainda precisa vincular o CNPJ dela.</li>
        <li>🗂 Ficha de pré-cadastro: hoje Google Form interino → nativo no House (aba Investidores já recebe manualmente; formulário público cai aqui na Onda 3).</li>
        <li>🧑‍⚖️ Vaga do advogado: publicar no ATS (<a href="#/talentos">Talentos</a>) com as 3 fases.</li>
      </ul>
    </div>`;
}

/* ─────────────────────────── 🎨 MARCA ─────────────────────────── */
function marca() {
  const sw = (n, hex) => `<div class="ma-swatch"><div style="background:${hex};border:1px solid var(--border)"></div><b>${n}</b><span class="tiny muted">${hex}</span></div>`;
  return `
    <div class="card">
      <h2 class="card-title">Identidade v1 — logotipo</h2>
      <div class="ma-logos">
        <div class="ma-logo-box" style="background:${COR.marfim}"><img src="/v2/img/morimatsu-logo-marfim.png" alt="logo fundo marfim"><span class="tiny">fundo marfim</span></div>
        <div class="ma-logo-box" style="background:${COR.verde}"><img src="/v2/img/morimatsu-logo-negativa.png" alt="logo negativa"><span class="tiny" style="color:#fff">negativa em verde</span></div>
        <div class="ma-logo-box" style="background:${COR.marfim};flex:0 0 160px"><img src="/v2/img/morimatsu-monograma.png" alt="monograma MA" style="max-height:110px"><span class="tiny">monograma MA (perfil)</span></div>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <a class="btn btn-ghost" href="${ASSETS}LOGO-Morimatsu-principal-transparente.png" download>⬇ logo transparente (PNG 3000px)</a>
        <a class="btn btn-ghost" href="/v2/img/morimatsu-logo-negativa.png" download>⬇ negativa</a>
        <a class="btn btn-ghost" href="/v2/img/morimatsu-monograma.png" download>⬇ monograma</a>
        <a class="btn btn-ghost" href="${ASSETS}identidade-v1-paleta.png" download>⬇ prancha da paleta</a>
      </div>
    </div>
    <div class="card">
      <h2 class="card-title">Paleta e tipografia</h2>
      <div class="ma-swatches">${sw('Verde profundo', COR.verde)}${sw('Dourado', COR.dourado)}${sw('Tinta', COR.tinta)}${sw('Marfim', COR.marfim)}</div>
      <p class="card-sub mt-2"><b>Display:</b> Didot (títulos, logotipo) · <b>Documentos:</b> Georgia · base herdada da GM, nome novo. Código de firma, não de imobiliária.</p>
    </div>
    <div class="ma-grid2">
      <div class="card"><h2 class="card-title">Tom de voz</h2><ul class="ma-ul">
        <li><b>Técnico</b> — domínio de edital, matrícula e processo sustenta a marca.</li>
        <li><b>Direto ao ponto</b> — investidor sério não tolera enrolação.</li>
        <li><b>Sóbrio</b> — código de escritório, não de imobiliária. Sem urgência artificial.</li>
        <li><b>Provocador com método</b> — derruba mitos do leilão sempre com base técnica.</li>
        <li><b>Acolhedor nos cases</b> — foco na transformação e no prejuízo evitado.</li>
      </ul></div>
      <div class="card"><h2 class="card-title">Bordões</h2><ul class="ma-ul">
        <li>“Antes do lance, a análise. Depois do martelo, as chaves.”</li>
        <li>“Leilão não é sorte — é leitura técnica.”</li>
        <li>“Imóvel barato sem análise é dívida disfarçada.”</li>
        <li>“Patrimônio não se improvisa.”</li>
        <li>“Comprar bem, gerir bem, sair melhor.”</li>
      </ul></div>
      <div class="card"><h2 class="card-title">Vocabulário próprio</h2><p class="card-sub">Análise antes do lance · custo total da operação · due diligence documental · mapeamento de ocupação · imissão na posse · curadoria por perfil · modalidades (venda online, venda direta, extrajudicial, judicial) · carta de arrematação · passivo propter rem · êxito sobre arrematação · ciclo do patrimônio · destino do ativo.</p></div>
      <div class="card"><h2 class="card-title">🚫 Vocabulário proibido</h2><p class="card-sub">Gírias ("galera", "bora") · sensacionalismo ("metade do preço", "lucro garantido", "oportunidade do ano") · promessa de retorno ou de êxito · linguagem de coach ("fique rico", "liberdade financeira", "destrave") · clichê de IA ("no mundo dinâmico de hoje", "é importante destacar").</p></div>
    </div>
    <div class="card"><h2 class="card-title">Restrições e compliance</h2><ul class="ma-ul">
      <li>A Morimatsu presta assessoria técnica e comercial — <b>não</b> exerce atos privativos de advocacia. Pareceres, due diligence assinada e ações são da sociedade parceira, contratada à parte.</li>
      <li>Peças com tese jurídica passam pela advogada antes de publicar. Vedações OAB (promessa de êxito, captação ostensiva, mercantilização) valem pra tudo que a sociedade dela assinar.</li>
      <li>Nunca indicar imóvel específico em conteúdo aberto — análise pública é didática; recomendação é privada.</li>
      <li>Nunca citar credor, devedor ou processo nominal em conteúdo.</li>
    </ul></div>
    <div class="card"><h2 class="card-title">Métricas-norte</h2><ul class="ma-ul">
      <li><b>Norte:</b> arrematações concluídas/mês com fee pago (rampa 1 → 2 → 4 giros/mês).</li>
      <li>Análises avulsas vendidas/mês e conversão análise → representação.</li>
      <li>Taxa de recompra do investidor (2º giro em até 6 meses).</li>
      <li>Ativos sob mandato de gestão (Trava 3) e saídas com exclusividade PSM (Trava 1).</li>
    </ul></div>`;
}

/* ─────────────────────────── wire ─────────────────────────── */
function wire() {
  const $ = s => _root.querySelector(s);
  if (_tab === 'visao') {
    const b = $('#ma-notas-save');
    if (b) b.onclick = async () => { $('#ma-notas-st').textContent = 'salvando…'; await salvar({ notas: $('#ma-notas').value }); };
  }
  if (_tab === 'honorarios') {
    _root.querySelectorAll('#ma-body input[type=number]').forEach(i => i.oninput = calcGiro);
    calcGiro();
  }
  if (_tab === 'roteiro') {
    _root.querySelectorAll('[data-rot]').forEach(cb => cb.onchange = () => {
      const r = { ...(_state?.roteiro || {}) };
      r[cb.dataset.rot] = { done: cb.checked, em: cb.checked ? new Date().toISOString() : null };
      salvar({ roteiro: r });
    });
  }
  if (_tab === 'investidores') {
    const busca = $('#ma-busca');
    if (busca) busca.oninput = e => { _busca = e.target.value; render(); const el = _root.querySelector('#ma-busca'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
    $('#ma-novo').onclick = () => { _edit = { coluna: 'pre' }; render(); _root.querySelector('#ma-form')?.scrollIntoView({ behavior: 'smooth' }); };
    const form = _root.querySelector('.ma-form');
    if (form && _edit) {
      $('#ma-cancel').onclick = () => { _edit = null; render(); };
      const del = $('#ma-del');
      if (del) del.onclick = () => {
        if (!confirm(`Excluir ${_edit.nome}? Não tem volta.`)) return;
        const lista = (_state.investidores || []).filter(c => c.id !== _edit.id);
        _edit = null; salvar({ investidores: lista });
      };
      form.onsubmit = ev => {
        ev.preventDefault();
        const fd = new FormData(form);
        const c = { ..._edit };
        ['nome', 'fone', 'cidade', 'objetivo', 'pagamento', 'faixa', 'capital', 'disp', 'regiao', 'ocupacao', 'origem', 'coluna', 'obs'].forEach(k => { c[k] = String(fd.get(k) || '').trim(); });
        c.modalidades = fd.getAll('modalidades');
        c.caixa = !!fd.get('caixa');
        if (!c.nome) return;
        const agora = new Date().toISOString();
        c.atualizado_em = agora;
        if (!c.id) { c.id = 'inv_' + Date.now().toString(36); c.criado_em = agora; c.hist = [{ em: agora, o: 'criado' }]; }
        c.score = scoreDe(c); c.porta = porta2(c) ? 2 : 1;
        const lista = (_state.investidores || []).filter(x => x.id !== c.id).concat([c]);
        _edit = null; salvar({ investidores: lista });
      };
    }
    ativarDrag({
      host: $('#ma-kanban'), card: '.ma-card', coluna: '.ma-col',
      colDe: col => col.dataset.col,
      aoClicar: id => { _edit = { ...((_state.investidores || []).find(c => c.id === id) || {}) }; render(); _root.querySelector('#ma-form')?.scrollIntoView({ behavior: 'smooth' }); },
      aoSoltar: async (id, destino) => {
        const lista = (_state.investidores || []).map(c => c.id === id && c.coluna !== destino
          ? { ...c, coluna: destino, atualizado_em: new Date().toISOString(), hist: [...(c.hist || []), { em: new Date().toISOString(), o: 'mover:' + destino }] } : c);
        await salvar({ investidores: lista });
      },
    });
  }
}

/* ─────────────────────────── css ─────────────────────────── */
function injectCss() {
  if (document.getElementById('ma-css')) return;
  const st = document.createElement('style'); st.id = 'ma-css';
  st.textContent = `
    .ma-wrap{max-width:1180px}
    .ma-head{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:14px 18px;border-radius:14px;background:var(--bg-2);border:1px solid var(--border);border-left:4px solid ${COR.dourado};margin-bottom:12px}
    .ma-logo{height:64px;max-width:100%;object-fit:contain}
    .ma-kicker{font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;opacity:.6;font-weight:800}
    .ma-frase{font-family:Georgia,'Times New Roman',serif;font-size:15px;margin-top:4px}
    .ma-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
    .ma-tab{font-size:12.5px;padding:7px 12px}
    .ma-minis{display:flex;gap:8px;flex-wrap:wrap}
    .ma-mini{flex:1;min-width:150px;background:var(--bg-2);border:1px solid var(--border);border-left:3px solid ${COR.verde};border-radius:10px;padding:8px 12px}
    .ma-mini-v{font-weight:900;font-size:18px;line-height:1.2;margin:2px 0}
    .ma-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:0 0 12px}
    .ma-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}
    .ma-pratica{background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${COR.verde};border-radius:12px;padding:14px 16px}
    .ma-pratica-n{font-family:Georgia,serif;color:${COR.dourado};font-size:22px;font-weight:700}
    .ma-pratica-s{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;opacity:.6;font-weight:800;margin:2px 0 8px}
    .ma-pratica p{margin:0;font-size:13px;opacity:.85;line-height:1.5}
    .ma-ciclo{padding-left:22px;margin:6px 0 0;line-height:1.55;font-size:13.5px}
    .ma-ciclo li{margin:8px 0}
    .ma-ciclo li::marker,.ma-ul li::marker{color:${COR.dourado}}
    .ma-trava{display:inline-block;margin-top:4px;font-size:11px;font-weight:700;color:${COR.dourado};border:1px solid ${COR.dourado};padding:1px 8px;border-radius:4px}
    .ma-ul{padding-left:20px;margin:6px 0 0;font-size:13.5px;line-height:1.55}
    .ma-ul li{margin:6px 0}
    .ma-tbl{border-collapse:collapse;width:100%;font-size:13px;min-width:520px}
    .ma-tbl th{text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${COR.dourado};padding:8px 10px;border-bottom:2px solid var(--border)}
    .ma-tbl td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
    .ma-num{font-family:var(--font-mono,monospace);white-space:nowrap}
    .ma-kanban{display:flex;gap:10px;overflow-x:auto;align-items:flex-start;padding-bottom:8px}
    .ma-col{flex:0 0 250px;background:var(--bg-3);border-radius:12px;padding:8px;border-top:3px solid}
    .ma-col-h{display:flex;align-items:center;justify-content:space-between;padding:0 4px 2px;font-size:12.5px}
    .ma-col-b{max-height:60vh;overflow-y:auto}
    .ma-card{background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-bottom:8px;cursor:grab;user-select:none;font-size:13px}
    .ma-card:hover{border-color:${COR.dourado}}
    .ma-score{color:#fff;font-weight:900;font-size:11px;padding:1px 7px;border-radius:999px}
    .ma-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
    .ma-tag{color:#fff;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;text-decoration:none}
    .ma-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
    .ma-form .field{display:flex;flex-direction:column;gap:3px}
    .ma-bar{height:8px;background:var(--bg-3);border-radius:999px;overflow:hidden;margin:8px 0 4px}
    .ma-bar>div{height:100%;background:linear-gradient(90deg,${COR.verde},${COR.dourado})}
    .ma-when{font-family:var(--font-mono,monospace);font-size:11.5px;color:${COR.dourado};font-weight:700;white-space:nowrap;border:1px solid ${COR.dourado};padding:2px 8px;border-radius:4px}
    .ma-check{display:flex;flex-direction:column;gap:4px;margin-top:8px}
    .ma-item{display:flex;gap:10px;align-items:flex-start;padding:7px 10px;border-radius:8px;background:var(--bg-2);border:1px solid var(--border);font-size:13.5px;cursor:pointer;line-height:1.45}
    .ma-item.done{opacity:.6;text-decoration:line-through}
    .ma-item input{margin-top:3px}
    .ma-quem{font-size:10.5px;letter-spacing:1px;text-transform:uppercase;opacity:.6;font-weight:800;margin-left:6px;text-decoration:none;display:inline-block}
    .ma-gate{background:var(--bg-2);border:1px solid var(--border);border-left:3px solid ${COR.dourado};border-radius:12px;padding:12px 14px}
    .ma-gate b{color:${COR.dourado}}
    .ma-gate p{margin:6px 0 0;font-size:13px;opacity:.85;line-height:1.5}
    .ma-docs{display:flex;flex-direction:column;gap:8px;margin-top:8px}
    .ma-doc{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-2)}
    .ma-doc-ico{font-size:24px}
    .ma-logos{display:flex;gap:10px;flex-wrap:wrap}
    .ma-logo-box{flex:1;min-width:240px;border-radius:12px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:8px;border:1px solid var(--border)}
    .ma-logo-box img{max-width:100%;max-height:90px;object-fit:contain}
    .ma-swatches{display:flex;gap:10px;flex-wrap:wrap}
    .ma-swatch{flex:1;min-width:120px;display:flex;flex-direction:column;gap:4px;font-size:12.5px}
    .ma-swatch>div{height:64px;border-radius:10px}
    @media(max-width:640px){.ma-logo{height:44px}.ma-col{flex-basis:220px}}
  `;
  document.head.appendChild(st);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
