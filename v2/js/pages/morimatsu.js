/* PSM-OS v2 — 🏯 MORIMATSU & ASSOCIADOS · Gestão Patrimonial Imobiliária  v87.52
   ----------------------------------------------------------------------------
   Escritório de patrimônio (boutique pessoal do Paulo — NÃO é imobiliária).
   Ciclo em 3 práticas: AQUISIÇÃO (leilão/venda direta Caixa, fee na arrematação)
   → GESTÃO (carteira/locação 10%/mês via PSM) → DESINVESTIMENTO (saída pela PSM).

   v87.52 — SISTEMA COMPLETO do ciclo dentro do House (pedido do Paulo, 07/set):
   do pré-cadastro à saída do ativo, tudo com criar / editar / excluir / nutrir:
     💼 Investidores  — kanban + ficha completa + linha do tempo + nutrição
     🏠 Imóveis       — garimpo → análise (custo total, lance máximo) → certame
     🔁 Operações     — arrematação → honorários → pós-arrematação → destino → saída
     📅 Agenda        — tarefas e próximos contatos (atrasados / hoje / semana)
     💰 Honorários    — tabela EDITÁVEL + calculadora de giro
     🗓 Roteiro       — checklist EDITÁVEL (itens por fase)
     📄 Documentos    — .docx + gerar CONTRATO e RECIBO preenchidos (imprimir/PDF)
     🎨 Marca         — identidade, tom, bordões, compliance
   Este arquivo = casca + abas estáticas. As abas operacionais moram em
   morimatsu-ops.js. Banco: /api/v3/morimatsu/state (1 chave shared_kv por coleção).
   SÓ SÓCIO (lvl>=10).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { renderInvestidores, renderImoveis, renderOperacoes, renderAgenda, wireOps, gerarContrato, gerarRecibo } from './morimatsu-ops.js';

const API = '/api/v3/morimatsu/state';
export const ASSETS = '/v2/assets/morimatsu/';

export const TABS = [
  { id: 'visao',        rota: '/morimatsu',              lbl: '🏯 Visão' },
  { id: 'investidores', rota: '/morimatsu-investidores', lbl: '💼 Investidores' },
  { id: 'imoveis',      rota: '/morimatsu-imoveis',      lbl: '🏠 Imóveis' },
  { id: 'operacoes',    rota: '/morimatsu-operacoes',    lbl: '🔁 Operações' },
  { id: 'agenda',       rota: '/morimatsu-agenda',       lbl: '📅 Agenda' },
  { id: 'honorarios',   rota: '/morimatsu-honorarios',   lbl: '💰 Honorários' },
  { id: 'roteiro',      rota: '/morimatsu-roteiro',      lbl: '🗓 Roteiro' },
  { id: 'documentos',   rota: '/morimatsu-documentos',   lbl: '📄 Documentos' },
  { id: 'marca',        rota: '/morimatsu-marca',        lbl: '🎨 Marca' },
];

/* Paleta oficial (IDENTIDADE v1) */
export const COR = { verde: '#1F4A3D', dourado: '#9C7A3C', tinta: '#1B201D', marfim: '#F4F2EC' };

/* ── Dicionários da ficha v2 ── */
export const COLUNAS = [
  { id: 'pre',         nome: 'Pré-cadastro',     emoji: '📥', cor: '#64748b', hint: 'ficha recebida · SLA 48h úteis' },
  { id: 'diagnostico', nome: 'Diagnóstico',      emoji: '🩺', cor: '#0ea5e9', hint: '20 min: objetivos + esteira' },
  { id: 'curadoria',   nome: 'Curadoria',        emoji: '🔎', cor: '#8b5cf6', hint: 'oportunidades por perfil' },
  { id: 'analise',     nome: 'Análise',          emoji: '📑', cor: '#f59e0b', hint: 'R$ 500/imóvel · viabilidade' },
  { id: 'certame',     nome: 'Certame',          emoji: '🔨', cor: '#ef4444', hint: 'R$ 500 · representação' },
  { id: 'arrematado',  nome: 'Arrematado',       emoji: '🏁', cor: COR.dourado, hint: 'fee 5% · piso R$ 6 mil' },
  { id: 'carteira',    nome: 'Carteira ativa',   emoji: '🔁', cor: COR.verde, hint: 'ciclo rodando · recompra' },
  { id: 'fora',        nome: 'Fora / Porta 2',   emoji: '⛔', cor: '#334155', hint: 'sem fit ou moradia MCMV' },
];
export const OBJETIVO  = { revenda: 'REVENDA', renda: 'RENDA', uso: 'USO PRÓPRIO', indef: 'INDEFINIDO' };
export const PAGAMENTO = { vista: 'À vista (próprio)', mobiliza: 'À vista (mobilizando)', financ: 'Financiamento', mcmv: 'FGTS + MCMV' };
export const FAIXA     = { f100: 'Até R$ 100 mil', f180: 'R$ 100–180 mil (foco CAIXA)', f300: 'R$ 180–300 mil', f500: 'R$ 300–500 mil', f1m: 'R$ 500 mil–1 mi', f1mp: 'Acima de R$ 1 mi' };
export const CAPITAL   = { c100: 'Até R$ 100 mil', c200: 'R$ 100–200 mil', c400: 'R$ 200–400 mil', c1m: 'R$ 400 mil–1 mi', c1mp: 'Acima de R$ 1 mi' };
export const DISP      = { imediato: 'Imediato', dias: 'Em dias', d30: 'Até 30 dias', d30p: 'Mais de 30 dias' };
export const MODAL     = { online: '01 Venda online', direta: '02 Venda direta', extra: '03 Leilão extrajudicial', judicial: '04 Leilão judicial' };
export const RAIO      = ['São José do Rio Preto', 'Mirassol', 'Bady Bassitt', 'Cedral', 'Guapiaçu', 'Bálsamo', 'Neves Paulista', 'Jaci', 'Ipiguá'];
export const ORIGEM    = ['Indicação', 'Instagram/LinkedIn', 'Canal P&A', 'Google', 'Apresentação/evento', 'Outro'];
const FAIXA_MAX = { f100: 100, f180: 180, f300: 300, f500: 500, f1m: 1000, f1mp: 9999 };
const CAP_MAX   = { c100: 100, c200: 200, c400: 400, c1m: 1000, c1mp: 9999 };

export function scoreDe(c) {
  let s = 0;
  if (c.faixa === 'f180') s += 25;
  if (RAIO.includes(c.regiao)) s += 15;
  if ((c.modalidades || []).length) s += 10;
  if (c.capital && c.faixa && (CAP_MAX[c.capital] || 0) >= (FAIXA_MAX[c.faixa] || 0)) s += 30;
  if (['imediato', 'dias', 'd30'].includes(c.disp)) s += 20;
  return s;
}
export const porta2 = c => c.objetivo === 'uso' && ['financ', 'mcmv'].includes(c.pagamento) && (FAIXA_MAX[c.faixa] || 0) <= 500;
export const alertaCapital = c => !!(c.capital && c.faixa && (CAP_MAX[c.capital] || 0) < (FAIXA_MAX[c.faixa] || 0));

/* ── Defaults editáveis (semeados no 1º uso; depois vivem no banco) ── */
export const HONORARIOS_DEFAULT = [
  { id: 'h1', servico: 'Análise comercial e jurídica por imóvel', valor: 'R$ 500 / imóvel', num: 500, obs: 'Viabilidade + risco + custas totais. Produto de entrada.' },
  { id: 'h2', servico: 'Participação em certame (representação)', valor: 'R$ 500 / certame', num: 500, obs: 'Antecipada. Deduzida do êxito em caso de arrematação.' },
  { id: 'h3', servico: 'Honorários de êxito', valor: '5% da arrematação · piso R$ 6.000', num: 0, obs: 'Pago na arrematação (caixa imediato). 3–5% negociável em tickets altos; o piso protege o ticket CAIXA.' },
  { id: 'h4', servico: 'Curadoria de oportunidades (volume)', valor: 'Sob consulta', num: 0, obs: '10 imóveis/semana filtrados por perfil, pra investidor com volume.' },
  { id: 'h5', servico: 'Gestão de carteira (mandato)', valor: '10% / mês sobre locação', num: 0, obs: 'Via bandeira de Locação PSM. Trava 3 do ciclo.' },
];
export const NAO_INCLUSO_DEFAULT = 'Ações judiciais (imissão, embargos, anulações — sociedade de advocacia parceira), custas processuais e cartorárias, ITBI, registro, débitos do imóvel, comissão do leiloeiro, deslocamentos fora da comarca.';
export const FEE_DEFAULT = { analise: 500, certame: 500, exito_pct: 5, piso: 6000, comissao_pct: 6, adm_pct: 10 };

const ROTEIRO_DEFAULT = [
  ['s1', 'SEMANA 1', 'Fundações que não custam nada', [
    ['Registrar morimatsuassociados.com.br e morimatsu.com.br (registro.br) + reservar @morimatsuassociados no Instagram', 'Paulo'],
    ['Conversa com a Ariane: a FOLK vira a casca da Morimatsu — Folk 3.0 encerra ou muda de CNPJ', 'Paulo + Ariane'],
    ['Validar o plano com a Isabella: sociedade, papéis das PSMs, portões', 'Paulo + Isabella'],
    ['Isabella cria Login Caixa e vincula o CNPJ dela no Portal de Licitações (Área do Fornecedor → Cadastrar Novo CNPJ)', 'Isabella'],
    ['Publicar a vaga do advogado no ATS (Talentos) com o desenho de 3 fases', 'Paulo']]],
  ['s2', 'SEMANAS 2–3', 'Estrutura legal e identidade', [
    ['Contador: alteração contratual da FOLK — razão social Morimatsu & Associados, CNAE 7022-0/00, endereço (R$ 500–1.500)', 'Contador'],
    ['Identidade visual mínima: logotipo, papel timbrado, modelo de proposta e de parecer (código de firma)', 'Paulo'],
    ['Entrevistar advogados imobiliaristas com arrematação real; selecionar 2 pra Fase 1 ("me conta uma desocupação que você conduziu")', 'Paulo']]],
  ['s3', 'SEMANAS 3–4', 'Produto e esteira', [
    ['Fechar a tabela (5% · piso R$ 6 mil) e minutar o contrato de assessoria com a Trava 1; advogado Fase 1 revisa', 'Paulo + advogado'],
    ['Esteira de garimpo: rotina diária no portal da Caixa (Rio Preto e região) com ficha de análise padronizada', 'Paulo'],
    ['Ensaio geral: 2–3 imóveis reais rodando o ciclo completo sem cliente (garimpo → parecer → lance máximo → plano de saída)', 'Time']]],
  ['m2', 'MÊS 2', 'Piloto com dinheiro de verdade', [
    ['Selecionar 3–5 investidores fundadores na base MAP / P&A (condição especial por case e depoimento)', 'Paulo'],
    ['Primeira aquisição assessorada (venda direta ou leilão) — o fee entra no ato', 'Time'],
    ['Teste controlado da Porta 2: retomados financiáveis pros leads ATE_2250 da Conquista', 'Conquista']]],
  ['m3', 'MÊS 3', 'Escala e formalização', [
    ['Publicar os primeiros cases no canal P&A (formato "Ativo") e no IG Paulo Morimatsu', 'Paulo'],
    ['Avaliar a passagem do advogado à Fase 2 (exclusividade + participação no fee)', 'Paulo + Isabella'],
    ['Portão de investimento: os números do piloto decidem site, mídia e cadência de contratação', 'Sócios']]],
];
export const FASES = ROTEIRO_DEFAULT.map(([id, quando, titulo]) => ({ id, quando, titulo }));
function roteiroSeed() {
  const out = [];
  ROTEIRO_DEFAULT.forEach(([fase, , , itens]) => itens.forEach(([t, quem], i) => out.push({ id: `${fase}_${i}`, fase, t, quem, done: false, em: null })));
  return out;
}
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
  { arq: 'Contrato-Assessoria-Aquisicao-Morimatsu-v1.docx', ico: '📜', t: 'Contrato de Assessoria em Aquisição v1', d: 'Modelo-base em branco. Pra emitir preenchido, use "Gerar contrato" acima ou na ficha do investidor.' },
  { arq: 'Recibo-Pagamento-Morimatsu-modelo-v1.docx', ico: '🧾', t: 'Recibo de Pagamento — modelo v1', d: 'Modelo-base. O recibo preenchido sai da operação (Operações → honorários → 🧾).' },
  { arq: 'Ficha-Pre-Cadastro-Investidor-v2.docx', ico: '📋', t: 'Ficha de Pré-Cadastro do Investidor v2', d: 'Etapa 01 do funil: 8 seções, roteio Porta 1 × Porta 2, validação capital × faixa, trava CAIXA, score de fit. É a mesma ficha da aba Investidores.' },
];

/* ─────────────────────────── store ─────────────────────────── */
export const S = { investidores: [], imoveis: [], operacoes: [], atividades: [], roteiro: [], config: {}, loaded: false };
let _root = null, _tab = 'visao', _err = null, _q = {};
export const ctxQuery = () => _q;
export const tabAtual = () => _tab;

export async function pageMorimatsu(ctx, root, tab) {
  _root = root; _q = ctx?.query || {};
  if ((auth.user()?.lvl || 0) < 10) { root.innerHTML = '<div class="alert alert-warn">🔒 Morimatsu & Associados é restrito aos sócios.</div>'; return; }
  _tab = tab || _q.tab || 'visao';
  if (!TABS.some(t => t.id === _tab)) _tab = 'visao';
  fecharModal();   // v87.53: trocar de rota (menu/abas) fecha o modal aberto — antes a ficha ficava por cima da aba nova
  injectCss();
  render();
  await load();
}

export async function load() {
  try {
    const r = await api.request(API);
    Object.assign(S, r.cols || {}); S.loaded = true; _err = null;
  } catch (e) { _err = e.message || 'falha ao carregar'; }
  render();
}
/* Operações no banco — item a item (não clobbera o que outro sócio salvou) */
export async function upsert(col, item) { return op({ op: 'upsert', col, item }); }
export async function remover(col, id) { return op({ op: 'delete', col, id }); }
export async function setCol(col, value) { return op({ op: 'set', col, value }); }
async function op(body) {
  try {
    const r = await api.request(API, { method: 'POST', body });
    if (r?.col) S[r.col] = r.value;
    _err = null; render(); return true;
  } catch (e) { _err = 'Não salvou: ' + (e.message || e); render(); return false; }
}

/* ─────────────────────────── helpers ─────────────────────────── */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = p => (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const num = v => { if (typeof v === 'number') return isNaN(v) ? 0 : v; const s = String(v ?? '').trim(); const n = parseFloat(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')); return isNaN(n) ? 0 : n; };
export const brl = v => 'R$ ' + Math.round(num(v)).toLocaleString('pt-BR');
export const dtBR = s => { if (!s) return ''; const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? String(s) : d.toLocaleDateString('pt-BR'); };
export const hojeISO = () => new Date().toISOString().slice(0, 10);
export const autorNome = () => auth.user()?.nome || auth.user()?.name || auth.user()?.email || 'sócio';
export const cfg = () => ({ fee: { ...FEE_DEFAULT, ...(S.config?.fee || {}) }, honorarios: (S.config?.honorarios?.length ? S.config.honorarios : HONORARIOS_DEFAULT), nao_incluso: S.config?.nao_incluso ?? NAO_INCLUSO_DEFAULT, notas: S.config?.notas || '' });
export const invPorId = id => S.investidores.find(i => i.id === id);
export const imvPorId = id => S.imoveis.find(i => i.id === id);
export const feeExito = valor => { const f = cfg().fee; return Math.max(num(valor) * num(f.exito_pct) / 100, num(f.piso)); };

/* Modal genérico (overlay); devolve o nó do conteúdo. fecharModal() remove. */
export function abrirModal(titulo, html, aoMontar, largura) {
  fecharModal();
  const ov = document.createElement('div'); ov.id = 'ma-modal';
  ov.innerHTML = `<div class="ma-modal-box" style="max-width:${largura || 760}px">
    <div class="ma-modal-h"><b>${titulo}</b><button class="btn btn-ghost" id="ma-modal-x" type="button">✕</button></div>
    <div class="ma-modal-b">${html}</div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) fecharModal(); });
  ov.querySelector('#ma-modal-x').onclick = fecharModal;
  const box = ov.querySelector('.ma-modal-b');
  if (aoMontar) aoMontar(box);
  return box;
}
export function fecharModal() { document.getElementById('ma-modal')?.remove(); }
export const campo = (lbl, inner, span) => `<label class="field" ${span ? 'style="grid-column:1/-1"' : ''}><span class="tiny muted">${lbl}</span>${inner}</label>`;
export const select = (name, map, val, extra) => `<select class="input" name="${name}" ${extra || ''}><option value="">—</option>${Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${String(val) === String(k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
export const input = (name, val, type, extra) => `<input class="input" name="${name}" type="${type || 'text'}" value="${esc(val ?? '')}" ${extra || ''}>`;
export const irPara = rota => { location.hash = '#' + rota; };

/* ─────────────────────────── render ─────────────────────────── */
export function render() {
  if (!_root) return;
  const dark = document.documentElement.classList.contains('dark');
  const logo = dark ? '/v2/img/morimatsu-logo-negativa.png' : '/v2/img/morimatsu-logo-marfim.png';
  const body = { visao, investidores: renderInvestidores, imoveis: renderImoveis, operacoes: renderOperacoes, agenda: renderAgenda, honorarios, roteiro, documentos, marca }[_tab];
  const atrasadas = S.atividades.filter(a => !a.feito && a.quando && a.quando.slice(0, 10) < hojeISO()).length;
  _root.innerHTML = `
    <div class="ma-wrap">
      <div class="ma-head">
        <img src="${logo}" alt="Morimatsu & Associados" class="ma-logo">
        <div class="ma-head-txt">
          <div class="ma-kicker">Escritório de patrimônio · boutique do sócio · só sócios</div>
          <div class="ma-frase">“O ciclo completo do patrimônio imobiliário: <b>comprar bem, gerir bem, sair melhor.</b>”</div>
        </div>
      </div>
      <div class="ma-tabs">${TABS.map(t => `<button class="btn ${t.id === _tab ? 'btn-primary' : 'btn-ghost'} ma-tab" data-rota="${t.rota}">${t.lbl}${t.id === 'agenda' && atrasadas ? ` <span class="ma-badge">${atrasadas}</span>` : ''}</button>`).join('')}</div>
      ${_err ? `<div class="alert alert-err" style="margin-bottom:10px">${esc(_err)}</div>` : ''}
      ${!S.loaded ? '<div class="card"><span class="spinner"></span> <span class="muted">Carregando…</span></div>' : ''}
      <div id="ma-body">${S.loaded ? body() : ''}</div>
    </div>`;
  _root.querySelectorAll('.ma-tab').forEach(b => b.onclick = () => irPara(b.dataset.rota));
  if (!S.loaded) return;
  if (['investidores', 'imoveis', 'operacoes', 'agenda'].includes(_tab)) wireOps(_root, _tab);
  else wire();
}

export const mini = (l, v, h, cor) => `<div class="ma-mini" style="border-left-color:${cor || COR.verde}"><div class="tiny muted">${l}</div><div class="ma-mini-v">${v}</div>${h ? `<div class="tiny muted">${h}</div>` : ''}</div>`;

/* ─────────────────────────── 🏯 VISÃO (cockpit do ciclo) ─────────────────────────── */
function visao() {
  const inv = S.investidores, imv = S.imoveis, ops = S.operacoes, atv = S.atividades;
  const hoje = hojeISO(), mes = hoje.slice(0, 7);
  const em15 = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  const ativos = inv.filter(c => c.coluna !== 'fora');
  const qual = ativos.filter(c => scoreDe(c) >= 70).length;
  const certames = imv.filter(i => ['aprovado', 'certame'].includes(i.status) && i.data_certame && i.data_certame >= hoje && i.data_certame <= em15);
  const feeMes = ops.reduce((s, o) => s + ['analise', 'certame', 'exito'].reduce((t, k) => t + ((o.honorarios?.[k]?.pago && (o.honorarios[k].em || '').slice(0, 7) === mes) ? num(o.honorarios[k].valor) : 0), 0), 0);
  const feePend = ops.reduce((s, o) => s + ['analise', 'certame', 'exito'].reduce((t, k) => t + ((!o.honorarios?.[k]?.pago && num(o.honorarios?.[k]?.valor)) ? num(o.honorarios[k].valor) : 0), 0), 0);
  const atrasadas = atv.filter(a => !a.feito && a.quando && a.quando.slice(0, 10) < hoje);
  const deHoje = atv.filter(a => !a.feito && a.quando && a.quando.slice(0, 10) === hoje);
  const semContato = ativos.filter(c => !atv.some(a => !a.feito && a.investidor_id === c.id));
  const feito = S.roteiro.filter(r => r.done).length, total = (S.roteiro.length || roteiroSeed().length);
  const porCol = COLUNAS.map(c => ({ ...c, n: inv.filter(i => (i.coluna || 'pre') === c.id).length }));
  return `
    <div class="ma-minis">
      ${mini('💼 Investidores na esteira', ativos.length, `${qual} qualificados (score ≥ 70) · ${inv.length} no total`)}
      ${mini('🏠 Imóveis em análise / aprovados', `${imv.filter(i => i.status === 'analise').length} / ${imv.filter(i => i.status === 'aprovado').length}`, `${imv.length} garimpados`, '#8b5cf6')}
      ${mini('🔨 Certames nos próximos 15 dias', certames.length, certames.slice(0, 2).map(i => `${dtBR(i.data_certame)} · ${esc(i.titulo)}`).join(' · ') || 'nenhum agendado', '#ef4444')}
      ${mini('🔁 Operações em andamento', ops.filter(o => o.status !== 'concluida').length, `${ops.filter(o => o.status === 'concluida').length} concluídas`, COR.dourado)}
      ${mini('💰 Fee recebido no mês', brl(feeMes), `${brl(feePend)} a receber`, '#16a34a')}
      ${mini('📅 Nutrição', `${atrasadas.length} atrasadas · ${deHoje.length} hoje`, `${semContato.length} investidor(es) sem próximo passo`, atrasadas.length ? '#ef4444' : '#0ea5e9')}
      ${mini('🗓 Roteiro 90 dias', `${feito}/${total}`, 'itens concluídos')}
      ${mini('🚫 Linha vermelha', 'R$ 0 fixo', 'nenhum custo fixo novo até dez/2026', '#64748b')}
    </div>

    <div class="ma-grid2" style="margin-bottom:12px">
      <div class="card" style="margin:0">
        <h2 class="card-title">Funil do investidor</h2>
        <div class="ma-funil">${porCol.map(c => `<button class="ma-funil-i" data-rota="/morimatsu-investidores" style="border-left-color:${c.cor}"><span>${c.emoji} ${esc(c.nome)}</span><b>${c.n}</b></button>`).join('')}</div>
      </div>
      <div class="card" style="margin:0">
        <h2 class="card-title">Próximos passos</h2>
        ${(atrasadas.concat(deHoje)).slice(0, 8).map(a => `<div class="ma-linha"><span class="ma-tag" style="background:${a.quando.slice(0, 10) < hoje ? '#ef4444' : '#0ea5e9'}">${dtBR(a.quando)}</span> <span>${esc(a.texto)}</span> <span class="tiny muted">${esc(invPorId(a.investidor_id)?.nome || imvPorId(a.imovel_id)?.titulo || '')}</span></div>`).join('') || '<div class="tiny muted">Nada atrasado nem pra hoje. Veja a Agenda pra semana.</div>'}
        ${semContato.length ? `<div class="alert alert-warn mt-2" style="font-size:12.5px">⚠️ Sem próximo passo agendado: ${semContato.slice(0, 4).map(c => esc(c.nome)).join(', ')}${semContato.length > 4 ? '…' : ''}</div>` : ''}
        <div class="flex gap-2 mt-2"><button class="btn btn-ghost" data-rota="/morimatsu-agenda">📅 Abrir agenda</button><button class="btn btn-ghost" data-rota="/morimatsu-imoveis">🏠 Garimpo</button><button class="btn btn-ghost" data-rota="/morimatsu-investidores">💼 Investidores</button></div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">📝 Notas do sócio</h2>
      <textarea id="ma-notas" class="input" rows="4" style="width:100%;font-family:inherit">${esc(cfg().notas)}</textarea>
      <div class="flex gap-2 mt-2"><button class="btn btn-primary" id="ma-notas-save">💾 Salvar notas</button></div>
    </div>

    <details class="card"><summary class="card-title" style="cursor:pointer">A tese, o ciclo e as duas portas</summary>
      <p class="card-sub">Três frentes paradas (Terceiros, lançamentos MAP e Locações) viram um único ciclo com o <b>investidor no centro</b>: a Morimatsu assessora a compra (leilão e venda direta Caixa), a PSM executa a saída (venda ou locação) — e a exclusividade deixa de ser pedida pra ser consequência. Alto padrão de verdade acontece em <b>escritórios que gerem a vida patrimonial do cliente</b>; em Rio Preto ninguém ocupa essa categoria.</p>
      <div class="ma-grid3">
        <div class="ma-pratica"><div class="ma-pratica-n">01</div><b>AQUISIÇÃO</b><div class="ma-pratica-s">porta de entrada</div><p>Garimpo, análise e representação em leilões e compra direta de retomados. Foco: <b>CAIXA, ticket R$ 100–180 mil</b>. Fee de êxito pago na arrematação.</p></div>
        <div class="ma-pratica"><div class="ma-pratica-n">02</div><b>GESTÃO</b><div class="ma-pratica-s">recorrência</div><p>Carteira sob mandato: locação e administração <b>10%/mês</b> via Locação PSM. Ativa quando o cliente acumula 3–4 ativos (Trava 3).</p></div>
        <div class="ma-pratica"><div class="ma-pratica-n">03</div><b>DESINVESTIMENTO</b><div class="ma-pratica-s">saída pela PSM</div><p>Revenda com exclusividade contratada na entrada (Trava 1, Cláusula 6ª). Corretagem pelos CRECIs das PSMs; a Morimatsu fatura só o fee.</p></div>
      </div>
      <ol class="ma-ciclo">
        <li><b>Etapa 0 · Entrada</b> — contrato de assessoria. <span class="ma-trava">Trava 1 — cláusula de saída exclusiva pela PSM</span></li>
        <li><b>Etapa 1 · Aquisição</b> — garimpo → parecer OAB → lance máximo → posse. Fee no ato.</li>
        <li><b>Etapa 2 · Mesa de ciclo</b> — flip ou renda. <span class="ma-trava">Trava 2 — contrato padrão PSM</span></li>
        <li><b>Etapa 3 · Saída</b> — flip pela Conquista · renda pela Locação (10%/mês).</li>
        <li><b>Etapa 4 · Reciclagem</b> — relatório de TIR → próximo edital. <span class="ma-trava">Trava 3 — mandato de gestão de carteira</span></li>
      </ol>
      <div style="overflow-x:auto"><table class="ma-tbl">
        <tr><th></th><th>Porta 1 · Investidor de giro</th><th>Porta 2 · Moradia final</th></tr>
        <tr><td><b>Marca</b></td><td>Morimatsu & Associados</td><td>PSM Conquista (a Morimatsu <b>nunca</b> fala com comprador MCMV)</td></tr>
        <tr><td><b>Imóvel-alvo</b></td><td>Ocupado, à vista — deságio máximo; a desocupação é o serviço</td><td>Desocupado, financiável — MCMV + FGTS</td></tr>
        <tr><td><b>Receita</b></td><td>Fee 5% · piso R$ 6 mil + saída pela PSM</td><td>Fee reduzido; comissão da Caixa (~5%) quando o credenciamento sair</td></tr>
      </table></div>
      <ul class="ma-ul mt-2">
        <li><b>Ocupação:</b> desocupação precificada <i>antes</i> do lance (acordo ~R$ 3–5 mil ou imissão), dita ao cliente por escrito.</li>
        <li><b>Débitos de condomínio:</b> o edital de cada unidade define quem paga. Item obrigatório do parecer.</li>
        <li><b>Estado do imóvel:</b> venda direta sem visita interna — reforma pelo pior cenário.</li>
        <li><b>Marca pessoal na porta:</b> nenhum cliente antes do Portão A.</li>
      </ul>
    </details>`;
}

/* ─────────────────────────── 💰 HONORÁRIOS (editável) ─────────────────────────── */
function honorarios() {
  const c = cfg();
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap"><h2 class="card-title" style="margin:0;flex:1">Tabela de honorários</h2><button class="btn btn-ghost" id="ma-fee-cfg">⚙️ Parâmetros do fee</button><button class="btn btn-primary" id="ma-hon-add">＋ Linha</button></div>
      <p class="card-sub">Clique numa linha pra editar. Os parâmetros (%, piso, comissão) alimentam a calculadora, as operações e o contrato gerado.</p>
      <div style="overflow-x:auto"><table class="ma-tbl">
        <tr><th>Serviço</th><th>Valor</th><th>Observação</th><th></th></tr>
        ${c.honorarios.map(h => `<tr class="ma-row" data-hon="${esc(h.id)}"><td>${esc(h.servico)}</td><td class="ma-num">${esc(h.valor)}</td><td>${esc(h.obs)}</td><td><button class="btn btn-ghost ma-hon-del" data-id="${esc(h.id)}" title="excluir">🗑</button></td></tr>`).join('')}
      </table></div>
      <div class="mt-2"><span class="tiny muted"><b>Não incluso, cobrado à parte:</b></span> <span class="tiny" id="ma-ninc">${esc(c.nao_incluso)}</span> <button class="btn btn-ghost" id="ma-ninc-edit" style="font-size:11px;padding:2px 8px">✏️</button></div>
      <div class="tiny muted mt-2">Parâmetros atuais: análise ${brl(c.fee.analise)} · certame ${brl(c.fee.certame)} · êxito ${c.fee.exito_pct}% (piso ${brl(c.fee.piso)}) · comissão PSM ${c.fee.comissao_pct}% · adm locação ${c.fee.adm_pct}%</div>
    </div>

    <div class="card">
      <h2 class="card-title">🧮 Calculadora de giro</h2>
      <p class="card-sub">Quanto o grupo fatura num giro: fee Morimatsu na arrematação + comissão PSM na saída. Referência do plano: avaliação R$ 180k, compra R$ 120k, revenda R$ 175k → ~R$ 16,5k pro grupo.</p>
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        ${campo('Avaliação Caixa (R$)', input('g-aval', 180000, 'number'))}
        ${campo('Lance / compra (R$)', input('g-lance', 120000, 'number'))}
        ${campo('Fee de êxito (%)', input('g-fee', c.fee.exito_pct, 'number', 'step="0.5"'))}
        ${campo('Piso do fee (R$)', input('g-piso', c.fee.piso, 'number'))}
        ${campo('Custos do investidor (R$)', input('g-custos', 18000, 'number'))}
        ${campo('Revenda pela PSM (R$)', input('g-rev', 175000, 'number'))}
        ${campo('Comissão PSM (%)', input('g-com', c.fee.comissao_pct, 'number', 'step="0.5"'))}
        ${campo('Aluguel mensal se for renda (R$)', input('g-alug', 1200, 'number'))}
      </div>
      <div class="ma-minis" id="g-out" style="margin-top:12px"></div>
      <p class="tiny muted mt-2">Trilha renda: taxa de 1º aluguel + ${c.fee.adm_pct}%/mês perpétuos. Três giros/mês ≈ R$ 50 mil/mês — o buraco que o Plano de Resgate cobre hoje do bolso.</p>
    </div>

    <div class="card">
      <h2 class="card-title">Como o dinheiro flui na holding</h2>
      <ul class="ma-ul">
        <li><b>Morimatsu & Associados</b> (casca = CNPJ FOLK alterado, CNAE consultoria) fatura <b>só o fee de assessoria</b>.</li>
        <li><b>Corretagem</b> (venda e locação) flui pelas <b>PSM 180 / 152</b> — CRECIs de Paulo e Isabella. Caixa segue no Plano de Resgate.</li>
        <li><b>Advogado</b>: sócio minoritário na Morimatsu E sociedade OAB própria que assina due diligence e desocupação — advocacia é o <b>selo</b>, nunca o motor.</li>
        <li><b>Linha vermelha:</b> nenhum custo fixo novo até dez/2026 — a vertical nasce 100% variável.</li>
      </ul>
    </div>`;
}
function calcGiro() {
  const n = name => num(_root.querySelector(`[name="${name}"]`)?.value);
  const aval = n('g-aval'), lance = n('g-lance'), feeP = n('g-fee'), piso = n('g-piso'), custos = n('g-custos'), rev = n('g-rev'), comP = n('g-com'), alug = n('g-alug');
  const fee = Math.max(lance * feeP / 100, piso), com = rev * comP / 100, lucro = rev - lance - custos - fee - com;
  const desc = aval ? Math.round((1 - lance / aval) * 100) : 0, adm = cfg().fee.adm_pct;
  const out = _root.querySelector('#g-out');
  if (out) out.innerHTML = [
    mini('🏯 Fee Morimatsu (no ato)', brl(fee), lance * feeP / 100 < piso ? 'piso aplicado' : `${feeP}% do lance`, COR.dourado),
    mini('🏘 Comissão PSM na saída', brl(com), `${comP}% de ${brl(rev)}`),
    mini('💼 Receita do grupo por giro', brl(fee + com), '', COR.verde),
    mini('📈 Lucro bruto do investidor', brl(lucro), `${lance ? Math.round(lucro / (lance + custos + fee) * 100) : 0}% sobre o capital · desconto ${desc}% vs avaliação`, lucro > 0 ? '#16a34a' : '#ef4444'),
    mini(`🔑 Se virar renda: adm ${adm}%/mês`, brl(alug * adm / 100) + '/mês', `${brl(alug * adm / 100 * 12)}/ano perpétuos + 1º aluguel`, '#0ea5e9'),
  ].join('');
}
function editarHonorario(h) {
  abrirModal(h ? '✏️ Editar linha' : '＋ Nova linha de honorário', `<form class="ma-form" id="f-hon">
    ${campo('Serviço *', input('servico', h?.servico, 'text', 'required'), true)}
    ${campo('Valor (texto exibido)', input('valor', h?.valor))}
    ${campo('Valor numérico (R$, opcional)', input('num', h?.num ?? '', 'number'))}
    ${campo('Observação', `<textarea class="input" name="obs" rows="2">${esc(h?.obs || '')}</textarea>`, true)}
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div></form>`, box => {
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#f-hon').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const lista = cfg().honorarios.map(x => ({ ...x }));
      const item = { id: h?.id || uid('h'), servico: fd.get('servico').trim(), valor: fd.get('valor').trim(), num: num(fd.get('num')), obs: fd.get('obs').trim() };
      const i = lista.findIndex(x => x.id === item.id); if (i >= 0) lista[i] = item; else lista.push(item);
      fecharModal(); await setCol('config', { ...S.config, honorarios: lista });
    };
  });
}
function editarFee() {
  const f = cfg().fee;
  abrirModal('⚙️ Parâmetros do fee', `<form class="ma-form" id="f-fee">
    ${campo('Análise por imóvel (R$)', input('analise', f.analise, 'number'))}
    ${campo('Participação em certame (R$)', input('certame', f.certame, 'number'))}
    ${campo('Êxito (% da arrematação)', input('exito_pct', f.exito_pct, 'number', 'step="0.5"'))}
    ${campo('Piso do êxito (R$)', input('piso', f.piso, 'number'))}
    ${campo('Comissão PSM na venda (%)', input('comissao_pct', f.comissao_pct, 'number', 'step="0.5"'))}
    ${campo('Administração de locação (%/mês)', input('adm_pct', f.adm_pct, 'number', 'step="0.5"'))}
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div></form>`, box => {
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#f-fee').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const fee = {}; ['analise', 'certame', 'exito_pct', 'piso', 'comissao_pct', 'adm_pct'].forEach(k => { fee[k] = num(fd.get(k)); });
      fecharModal(); await setCol('config', { ...S.config, fee });
    };
  });
}

/* ─────────────────────────── 🗓 ROTEIRO (editável) ─────────────────────────── */
function roteiroLista() { return S.roteiro.length ? S.roteiro : roteiroSeed(); }
function roteiro() {
  const lista = roteiroLista();
  const feito = lista.filter(i => i.done).length, total = lista.length, pct = total ? Math.round(feito / total * 100) : 0;
  const fases = [...FASES]; lista.forEach(i => { if (!fases.some(f => f.id === i.fase)) fases.push({ id: i.fase, quando: '', titulo: i.fase }); });
  return `
    <div class="card">
      <div class="flex items-center gap-2"><h2 class="card-title" style="margin:0;flex:1">Roteiro de retomada — 90 dias</h2><button class="btn btn-primary" id="ma-rot-add">＋ Item</button></div>
      <p class="card-sub">Do artifact "Plano Morimatsu & Associados" (26/ago/2026). Marque, edite (✏️), exclua (🗑) ou adicione itens — fica salvo pra todos os sócios.</p>
      <div class="ma-bar"><div style="width:${pct}%"></div></div>
      <div class="tiny muted">${feito}/${total} concluídos · ${pct}%</div>
    </div>
    ${fases.map(f => { const itens = lista.filter(i => i.fase === f.id); if (!itens.length) return ''; return `<div class="card">
      <div class="flex items-center gap-2"><span class="ma-when">${esc(f.quando || f.id)}</span><h2 class="card-title" style="margin:0">${esc(f.titulo)}</h2></div>
      <div class="ma-check">
        ${itens.map(i => `<label class="ma-item ${i.done ? 'done' : ''}">
          <input type="checkbox" data-rot="${esc(i.id)}" ${i.done ? 'checked' : ''}>
          <span style="flex:1">${esc(i.t)} <span class="ma-quem">${esc(i.quem || '')}</span>${i.done && i.em ? `<span class="tiny muted"> · ✓ ${dtBR(i.em)}</span>` : ''}</span>
          <button class="btn btn-ghost ma-rot-edit" data-id="${esc(i.id)}" type="button" style="font-size:11px;padding:2px 6px">✏️</button>
          <button class="btn btn-ghost ma-rot-del" data-id="${esc(i.id)}" type="button" style="font-size:11px;padding:2px 6px">🗑</button>
        </label>`).join('')}
      </div>
    </div>`; }).join('')}
    <div class="ma-grid3">${PORTOES.map(p => `<div class="ma-gate"><b>${esc(p.t)}</b><p>${esc(p.d)}</p></div>`).join('')}</div>
    <div class="card"><h2 class="card-title">O sócio jurídico — advogado em 3 fases</h2>
      <div class="ma-grid3">${ADV_FASES.map(p => `<div class="ma-gate"><b>${esc(p.t)}</b><p>${esc(p.d)}</p></div>`).join('')}</div>
      <p class="tiny muted mt-2">Apresentação ao cliente: "análise jurídica por [Escritório X] Advocacia". Parceira de referência do briefing: Dra. Rafaela.</p>
    </div>`;
}
function editarRoteiro(item) {
  const fases = Object.fromEntries(FASES.map(f => [f.id, `${f.quando} — ${f.titulo}`]));
  abrirModal(item ? '✏️ Editar item do roteiro' : '＋ Novo item do roteiro', `<form class="ma-form" id="f-rot">
    ${campo('O que fazer *', `<textarea class="input" name="t" rows="2" required>${esc(item?.t || '')}</textarea>`, true)}
    ${campo('Fase', select('fase', fases, item?.fase || 's1'))}
    ${campo('Quem', input('quem', item?.quem))}
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div></form>`, box => {
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#f-rot').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const lista = roteiroLista().map(x => ({ ...x }));
      const it = { ...(item || { id: uid('r'), done: false, em: null }), t: fd.get('t').trim(), fase: fd.get('fase') || 's1', quem: fd.get('quem').trim() };
      const i = lista.findIndex(x => x.id === it.id); if (i >= 0) lista[i] = it; else lista.push(it);
      fecharModal(); await setCol('roteiro', lista);
    };
  });
}

/* ─────────────────────────── 📄 DOCUMENTOS ─────────────────────────── */
function documentos() {
  const invs = S.investidores.filter(i => i.coluna !== 'fora');
  const ops = S.operacoes;
  return `
    <div class="ma-grid2" style="margin-bottom:12px">
      <div class="card" style="margin:0">
        <h2 class="card-title">📜 Gerar contrato preenchido</h2>
        <p class="card-sub">Contrato de Assessoria em Aquisição (modelo v1) com os dados do investidor e os honorários atuais. Abre pra imprimir / salvar em PDF.</p>
        <div class="flex gap-2"><select class="input" id="ma-doc-inv" style="flex:1"><option value="">— escolha o investidor —</option>${invs.map(i => `<option value="${esc(i.id)}">${esc(i.nome)}</option>`).join('')}</select><button class="btn btn-primary" id="ma-doc-contrato">📜 Gerar</button></div>
        <p class="tiny muted mt-2">Faltando CPF/CNPJ ou endereço na ficha, o contrato sai com o campo em branco pra preencher à mão.</p>
      </div>
      <div class="card" style="margin:0">
        <h2 class="card-title">🧾 Gerar recibo</h2>
        <p class="card-sub">Recibo de pagamento (modelo v1) de uma parcela de honorários de uma operação.</p>
        <div class="flex gap-2" style="flex-wrap:wrap"><select class="input" id="ma-doc-op" style="flex:1;min-width:200px"><option value="">— operação —</option>${ops.map(o => `<option value="${esc(o.id)}">${esc(invPorId(o.investidor_id)?.nome || '?')} · ${esc(imvPorId(o.imovel_id)?.titulo || '?')}</option>`).join('')}</select>
        <select class="input" id="ma-doc-parc"><option value="analise">Análise</option><option value="certame">Certame</option><option value="exito" selected>Êxito</option></select><button class="btn btn-primary" id="ma-doc-recibo">🧾 Gerar</button></div>
        ${ops.length ? '' : '<p class="tiny muted mt-2">Ainda não há operação. Uma operação nasce quando um imóvel é marcado como arrematado.</p>'}
      </div>
    </div>
    <div class="card">
      <h2 class="card-title">Modelos oficiais (v1 · set/2026)</h2>
      <p class="card-sub">Cópias servidas pelo House. Originais em <code>Desktop/MORIMATSU/MORIMATSU & ASSOCIADOS</code>.</p>
      <div class="ma-docs">${DOCS.map(d => `<div class="ma-doc"><div class="ma-doc-ico">${d.ico}</div><div style="flex:1"><b>${esc(d.t)}</b><div class="tiny muted">${esc(d.d)}</div></div><a class="btn btn-ghost" href="${ASSETS}${d.arq}" download>⬇ .docx</a></div>`).join('')}</div>
    </div>
    <div class="card">
      <h2 class="card-title">Pontos do contrato que sustentam o ciclo</h2>
      <ul class="ma-ul">
        <li><b>Cláusula 3ª</b> — natureza consultiva, obrigação de meio. NÃO abrange atos privativos de advocacia (Lei 8.906/94).</li>
        <li><b>Cláusula 4ª</b> — (a) análise antecipada · (b) certame antecipado, deduzido do êxito · (c) êxito % com piso, devido na arrematação. §4º: devido mesmo se o cliente arrematar por fora imóvel apresentado, por 12 meses.</li>
        <li><b>Cláusula 6ª (Trava 1)</b> — exclusividade às empresas PSM na revenda/locação: 180 dias prorrogáveis; venda por fora = corretagem integral como multa.</li>
        <li><b>Cláusula 7ª</b> — recurso pro lance em 24–48h; declaração de vínculo com a instituição credora (CAIXA).</li>
        <li><b>Cláusula 9ª/10ª</b> — 12 meses renováveis, aviso 30 dias; foro Rio Preto; título executivo extrajudicial.</li>
      </ul>
    </div>
    <div class="card">
      <h2 class="card-title">Links e pendências</h2>
      <ul class="ma-ul">
        <li>📐 Plano completo: <a href="https://claude.ai/code/artifact/3a939795-b5af-4020-89ef-7af6945d1533" target="_blank" rel="noopener">Plano Morimatsu & Associados</a></li>
        <li>🌐 Domínios livres em 26/ago (registro.br): <b>morimatsuassociados.com.br</b>, <b>morimatsueassociados.com.br</b>, <b>morimatsu.com.br</b>.</li>
        <li>🏦 Credenciamento Caixa: <a href="https://licitacoes.caixa.gov.br" target="_blank" rel="noopener">licitacoes.caixa.gov.br</a> — por edital com janela; PSM fora da lista oficial; Isabella ainda precisa vincular o CNPJ dela.</li>
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
    <div class="ma-grid2" style="margin-bottom:12px">
      <div class="card" style="margin:0"><h2 class="card-title">Tom de voz</h2><ul class="ma-ul">
        <li><b>Técnico</b> — domínio de edital, matrícula e processo sustenta a marca.</li>
        <li><b>Direto ao ponto</b> — investidor sério não tolera enrolação.</li>
        <li><b>Sóbrio</b> — código de escritório, não de imobiliária. Sem urgência artificial.</li>
        <li><b>Provocador com método</b> — derruba mitos do leilão sempre com base técnica.</li>
        <li><b>Acolhedor nos cases</b> — foco na transformação e no prejuízo evitado.</li>
      </ul></div>
      <div class="card" style="margin:0"><h2 class="card-title">Bordões</h2><ul class="ma-ul">
        <li>“Antes do lance, a análise. Depois do martelo, as chaves.”</li>
        <li>“Leilão não é sorte — é leitura técnica.”</li>
        <li>“Imóvel barato sem análise é dívida disfarçada.”</li>
        <li>“Patrimônio não se improvisa.”</li>
        <li>“Comprar bem, gerir bem, sair melhor.”</li>
      </ul></div>
      <div class="card" style="margin:0"><h2 class="card-title">Vocabulário próprio</h2><p class="card-sub">Análise antes do lance · custo total da operação · due diligence documental · mapeamento de ocupação · imissão na posse · curadoria por perfil · modalidades (venda online, venda direta, extrajudicial, judicial) · carta de arrematação · passivo propter rem · êxito sobre arrematação · ciclo do patrimônio · destino do ativo.</p></div>
      <div class="card" style="margin:0"><h2 class="card-title">🚫 Vocabulário proibido</h2><p class="card-sub">Gírias ("galera", "bora") · sensacionalismo ("metade do preço", "lucro garantido", "oportunidade do ano") · promessa de retorno ou de êxito · linguagem de coach ("fique rico", "liberdade financeira", "destrave") · clichê de IA ("no mundo dinâmico de hoje", "é importante destacar").</p></div>
    </div>
    <div class="card"><h2 class="card-title">Restrições e compliance</h2><ul class="ma-ul">
      <li>A Morimatsu presta assessoria técnica e comercial — <b>não</b> exerce atos privativos de advocacia. Pareceres, due diligence assinada e ações são da sociedade parceira, contratada à parte.</li>
      <li>Peças com tese jurídica passam pela advogada antes de publicar. Vedações OAB valem pra tudo que a sociedade dela assinar.</li>
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

/* ─────────────────────────── wire (abas estáticas) ─────────────────────────── */
function wire() {
  const $ = s => _root.querySelector(s);
  _root.querySelectorAll('[data-rota]').forEach(b => { if (!b.classList.contains('ma-tab')) b.onclick = () => irPara(b.dataset.rota); });
  if (_tab === 'visao') {
    const b = $('#ma-notas-save');
    if (b) b.onclick = () => setCol('config', { ...S.config, notas: $('#ma-notas').value });
  }
  if (_tab === 'honorarios') {
    _root.querySelectorAll('#ma-body input[type=number]').forEach(i => i.oninput = calcGiro);
    calcGiro();
    $('#ma-hon-add').onclick = () => editarHonorario(null);
    $('#ma-fee-cfg').onclick = editarFee;
    _root.querySelectorAll('.ma-row').forEach(tr => tr.onclick = e => { if (e.target.closest('button')) return; editarHonorario(cfg().honorarios.find(h => h.id === tr.dataset.hon)); });
    _root.querySelectorAll('.ma-hon-del').forEach(b => b.onclick = async () => { if (!confirm('Excluir esta linha da tabela?')) return; await setCol('config', { ...S.config, honorarios: cfg().honorarios.filter(h => h.id !== b.dataset.id) }); });
    $('#ma-ninc-edit').onclick = () => { const v = prompt('Não incluso, cobrado à parte:', cfg().nao_incluso); if (v !== null) setCol('config', { ...S.config, nao_incluso: v.trim() }); };
  }
  if (_tab === 'roteiro') {
    $('#ma-rot-add').onclick = () => editarRoteiro(null);
    _root.querySelectorAll('[data-rot]').forEach(cb => cb.onchange = () => {
      const lista = roteiroLista().map(x => x.id === cb.dataset.rot ? { ...x, done: cb.checked, em: cb.checked ? new Date().toISOString() : null } : { ...x });
      setCol('roteiro', lista);
    });
    _root.querySelectorAll('.ma-rot-edit').forEach(b => b.onclick = e => { e.preventDefault(); editarRoteiro(roteiroLista().find(x => x.id === b.dataset.id)); });
    _root.querySelectorAll('.ma-rot-del').forEach(b => b.onclick = e => { e.preventDefault(); if (!confirm('Excluir este item do roteiro?')) return; setCol('roteiro', roteiroLista().filter(x => x.id !== b.dataset.id)); });
  }
  if (_tab === 'documentos') {
    $('#ma-doc-contrato').onclick = () => { const inv = invPorId($('#ma-doc-inv').value); if (!inv) return alert('Escolha o investidor.'); gerarContrato(inv); };
    $('#ma-doc-recibo').onclick = () => { const o = S.operacoes.find(x => x.id === $('#ma-doc-op').value); if (!o) return alert('Escolha a operação.'); gerarRecibo(o, $('#ma-doc-parc').value); };
  }
}

/* ─────────────────────────── css ─────────────────────────── */
function injectCss() {
  if (document.getElementById('ma-css')) return;
  const st = document.createElement('style'); st.id = 'ma-css';
  st.textContent = `
    .ma-wrap{max-width:1240px}
    .ma-head{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:12px 18px;border-radius:14px;background:var(--bg-2);border:1px solid var(--border);border-left:4px solid ${COR.dourado};margin-bottom:12px}
    .ma-logo{height:56px;max-width:100%;object-fit:contain}
    .ma-kicker{font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;opacity:.6;font-weight:800}
    .ma-frase{font-family:Georgia,'Times New Roman',serif;font-size:14.5px;margin-top:4px}
    .ma-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
    .ma-tab{font-size:12.5px;padding:7px 11px}
    .ma-badge{background:#ef4444;color:#fff;font-size:10.5px;font-weight:900;padding:0 6px;border-radius:999px}
    .ma-minis{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .ma-mini{flex:1;min-width:150px;background:var(--bg-2);border:1px solid var(--border);border-left:3px solid ${COR.verde};border-radius:10px;padding:8px 12px}
    .ma-mini-v{font-weight:900;font-size:18px;line-height:1.2;margin:2px 0}
    .ma-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:0 0 12px}
    .ma-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px}
    .ma-pratica{background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${COR.verde};border-radius:12px;padding:14px 16px}
    .ma-pratica-n{font-family:Georgia,serif;color:${COR.dourado};font-size:22px;font-weight:700}
    .ma-pratica-s{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;opacity:.6;font-weight:800;margin:2px 0 8px}
    .ma-pratica p{margin:0;font-size:13px;opacity:.85;line-height:1.5}
    .ma-ciclo{padding-left:22px;margin:6px 0 10px;line-height:1.55;font-size:13.5px}
    .ma-ciclo li{margin:6px 0}
    .ma-ciclo li::marker,.ma-ul li::marker{color:${COR.dourado}}
    .ma-trava{display:inline-block;margin-top:4px;font-size:11px;font-weight:700;color:${COR.dourado};border:1px solid ${COR.dourado};padding:1px 8px;border-radius:4px}
    .ma-ul{padding-left:20px;margin:6px 0 0;font-size:13.5px;line-height:1.55}
    .ma-ul li{margin:6px 0}
    .ma-tbl{border-collapse:collapse;width:100%;font-size:13px;min-width:520px}
    .ma-tbl th{text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${COR.dourado};padding:8px 10px;border-bottom:2px solid var(--border)}
    .ma-tbl td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
    .ma-row{cursor:pointer}.ma-row:hover td{background:var(--bg-3)}
    .ma-num{font-family:var(--font-mono,monospace);white-space:nowrap}
    .ma-kanban{display:flex;gap:10px;overflow-x:auto;align-items:flex-start;padding-bottom:8px}
    .ma-col{flex:0 0 250px;background:var(--bg-3);border-radius:12px;padding:8px;border-top:3px solid}
    .ma-col-h{display:flex;align-items:center;justify-content:space-between;padding:0 4px 2px;font-size:12.5px}
    .ma-col-b{max-height:60vh;overflow-y:auto}
    .ma-card{background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-bottom:8px;cursor:grab;user-select:none;font-size:13px}
    .ma-card:hover{border-color:${COR.dourado}}
    .ma-score{color:#fff;font-weight:900;font-size:11px;padding:1px 7px;border-radius:999px}
    .ma-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
    .ma-tag{color:#fff;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;text-decoration:none;white-space:nowrap}
    .ma-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
    .ma-form .field{display:flex;flex-direction:column;gap:3px}
    .ma-bar{height:8px;background:var(--bg-3);border-radius:999px;overflow:hidden;margin:8px 0 4px}
    .ma-bar>div{height:100%;background:linear-gradient(90deg,${COR.verde},${COR.dourado})}
    .ma-when{font-family:var(--font-mono,monospace);font-size:11.5px;color:${COR.dourado};font-weight:700;white-space:nowrap;border:1px solid ${COR.dourado};padding:2px 8px;border-radius:4px}
    .ma-check{display:flex;flex-direction:column;gap:4px;margin-top:8px}
    .ma-item{display:flex;gap:10px;align-items:flex-start;padding:7px 10px;border-radius:8px;background:var(--bg-2);border:1px solid var(--border);font-size:13.5px;cursor:pointer;line-height:1.45}
    .ma-item.done>span{opacity:.6;text-decoration:line-through}
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
    .ma-funil{display:flex;flex-direction:column;gap:4px}
    .ma-funil-i{display:flex;justify-content:space-between;align-items:center;background:var(--bg-2);border:1px solid var(--border);border-left:3px solid;border-radius:8px;padding:6px 10px;font-size:13px;cursor:pointer;color:inherit;text-align:left}
    .ma-funil-i:hover{border-color:${COR.dourado}}
    .ma-linha{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;flex-wrap:wrap}
    .ma-timeline{display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:46vh;overflow-y:auto}
    .ma-tl{display:flex;gap:10px;padding:7px 10px;border-radius:8px;background:var(--bg-2);border:1px solid var(--border);font-size:13px;align-items:flex-start}
    .ma-tl.feito{opacity:.6}.ma-tl.atrasada{border-color:#ef4444}
    .ma-tl .ma-tl-ico{font-size:16px}
    .ma-list{display:flex;flex-direction:column;gap:6px}
    .ma-li{display:grid;grid-template-columns:1fr auto;gap:8px;padding:9px 12px;border-radius:10px;background:var(--bg-2);border:1px solid var(--border);font-size:13px;cursor:pointer;align-items:center}
    .ma-li:hover{border-color:${COR.dourado}}
    .ma-status{color:#fff;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap}
    .ma-chk{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px}
    .ma-chk label{display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:8px;background:var(--bg-2);border:1px solid var(--border);font-size:12.5px;cursor:pointer}
    .ma-sec{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;opacity:.65;font-weight:800;margin:14px 0 6px;color:${COR.dourado}}
    .ma-drawer-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0 10px}
    #ma-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:var(--z-modal,1000);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto}
    .ma-modal-box{background:var(--bg);color:var(--ink);border:1px solid var(--border);border-top:3px solid ${COR.dourado};border-radius:14px;width:100%;box-shadow:var(--shadow-lg,0 10px 40px rgba(0,0,0,.4))}
    .ma-modal-h{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);font-size:15px}
    .ma-modal-b{padding:14px 16px}
    @media(max-width:640px){.ma-logo{height:40px}.ma-col{flex-basis:220px}}
  `;
  document.head.appendChild(st);
}
