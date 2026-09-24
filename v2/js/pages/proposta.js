/* ============================================================================
   PSM-OS v2 — 📑 Proposta comercial (v88.34)
   ----------------------------------------------------------------------------
   Nasceu da proposta da Thais Cruz (Cubo 123 × Áuri, 23/09/2026): o PDF saía
   montado à mão no Canva, com print de planilha ilegível no celular, sem
   comparativo e com sobra de outra proposta escondida na página. Agora:

   · o corretor preenche 1 a 4 opções e o documento se monta sozinho (9:16,
     feito para o WhatsApp): capa → lado a lado → gráficos → cada opção
     (apresentação, planta, fotos, localização, fluxo, condições) → próximos
     passos → cartão do corretor com links clicáveis e o Georgina ao fundo;
   · o fluxo e o INCC saem do MESMO motor do Simulador INCC (compute() de
     sim-incc.js) — a proposta nunca diverge do simulador;
   · a empresa (razão, CRECI, endereço, Instagram) vem de EMPRESAS_PADRAO
     (fonte única do Gerador de Documentos);
   · dados no banco via /api/v3/propostas/dados (shared_kv): propostas,
     cartão do corretor e a biblioteca de empreendimentos do time.

   PDF: janela própria + window.print() (mesmo padrão dos simuladores). O
   Chrome mantém os links (WhatsApp, Instagram, site, mapas) clicáveis.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { compute as calcINCC } from './sim-incc.js';
import { propostaTableHTML, PP_CSS } from './sim-vpl.js';
import { EMPRESAS_PADRAO } from '../data/docs-modelos.js';
import { ATTR_NUM, parseNum } from '../sim-campos.js';
import qrcode from '../vendor/qrcode.js';

const EP = '/api/v3/propostas/dados';
const LS_ULTIMA = 'psm_v2_proposta_ultima';            // preferência de UI: qual proposta reabrir
const EMPRESA = EMPRESAS_PADRAO.psm_assessoria;         // CRECI 43.471-J (o da proposta MAP)
// as duas marcas no fim de toda proposta (pedido do Paulo 23/set); a 1ª assina o documento
const MARCAS = [
  { nome: 'PSM Imóveis', site: 'psmimoveis.com', ig: 'psm.imoveis', logo: '/v2/img/logo-psm-imoveis-creme.png', h: 24, tag: 'Médio e alto padrão: lançamentos, prontos e revenda' },
  { nome: 'PSM Conquista', site: 'psmconquista.com.br', ig: 'psmconquista', logo: '/v2/img/logo-psm-conquista.png', h: 44, tag: 'Seu primeiro imóvel, com Minha Casa Minha Vida' },
];
const CORES = ['#1E2650', '#B8955A', '#3E7C74', '#9A5B6E'];
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MAX_OPCOES = 4;

/* ═══════════ helpers ═══════════ */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v === '' || v == null) ? NaN : parseNum(String(v));
const brl = v => isFinite(v) ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const pct = (v, d = 1) => isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: d }) + '%' : '—';
const ym = s => { if (!s) return NaN; const [y, m] = String(s).split('-').map(Number); return (y && m) ? y * 12 + m - 1 : NaN; };
const mlab = i => isFinite(i) ? MES[((i % 12) + 12) % 12] + '/' + String(Math.floor(i / 12)).slice(2) : '—';
const mlong = i => isFinite(i) ? MES_L[((i % 12) + 12) % 12] + ' de ' + Math.floor(i / 12) : '—';
const linhas = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const p2 = n => String(n).padStart(2, '0');
const iniciais = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
const digitos = s => String(s || '').replace(/\D/g, '');
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const dataLonga = iso => { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return `${d.getDate()} de ${MES_L[d.getMonth()]} de ${d.getFullYear()}`; };
const somaDias = (iso, n) => { const d = new Date((iso || hojeISO()) + 'T12:00:00'); d.setDate(d.getDate() + (Number(n) || 0)); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };
// texto digitado volta como está ("323.900" é trezentos e vinte e três mil); só número JS vira vírgula
const numTxt = v => typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
const getPath = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };
const abs = u => !u ? '' : /^(https?:|data:)/.test(u) ? u : location.origin + u;

// endereço da empresa: "Av. Anísio Haddad, 8001 – Georgina Business Park, Torre Madri Norte, sala 202 – São José do Rio Preto/SP – CEP ..."
function enderecoEmpresa() {
  const [rua = '', bloco = '', cidade = '', cep = ''] = String(EMPRESA.endereco || '').split(/\s+–\s+/);
  const [predio, ...resto] = bloco.split(/,\s*/);
  return { rua, predio: predio || 'Georgina Business Park', sala: resto.join(' · '), cidade, cep };
}
const waLink = c => { let d = digitos(c.whats); if (d.length && d.length <= 11) d = '55' + d; return d ? `https://wa.me/${d}?text=${encodeURIComponent(c.msg || '')}` : ''; };
const qrSVG = t => { try { const q = qrcode(0, 'M'); q.addData(t); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { return ''; } };
const mapsLink = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

/* ═══════════ modelo de dados ═══════════ */
function fluxoVazio(inicio) {
  return { inicio: inicio || hojeISO().slice(0, 7), chavesMes: '', ato: '10', semCorr: '10', mensaisPct: '20', mensaisN: '36',
    reforcosPct: '0', reforcosN: '0', reforcosTipo: 'Anuais', balaoMes1: '', balaoIntervalo: '12', chavesPct: '70', incc: true, extrato: true };
}
function opcaoVazia(inicio) {
  return { modeloId: '', empreendimento: '', incorporadora: '', status: 'Lançamento', entrega: '', endereco: '',
    unidade: '', andar: '', tipologia: '', area: '', vagas: '', vista: '', mobiliado: false, preco: '',
    perfil: '', destaques: '', aluguel: '', condominio: '', pontos: '', alternativas: '',
    img: { fachada: '', planta: '', mapa: '', fotos: [] }, f: fluxoVazio(inicio) };
}
function propostaVazia() {
  const d = hojeISO();
  return { id: '', owner: '', cliente: { nome: '', objetivo: 'ambos', data: d, validade: '7', abertura: '' },
    prem: { projetar: false, incc: '6', taxa: '11,5', prazo: '360', comp: '30', itbi: '2', cartorio: '1,5' },
    opcoes: [opcaoVazia(d.slice(0, 7))] };
}
// campos do empreendimento que vão para a biblioteca (unidade, preço e fluxo também: viram o "padrão" editável)
const CAMPOS_MODELO = ['empreendimento', 'incorporadora', 'status', 'entrega', 'endereco', 'unidade', 'andar', 'tipologia', 'area',
  'vagas', 'vista', 'mobiliado', 'preco', 'perfil', 'destaques', 'aluguel', 'condominio', 'pontos', 'alternativas', 'img', 'f'];

/* ═══════════ cálculo (motor do Simulador INCC) ═══════════ */
export function calcular(o, S) {
  const f = o.f || {}, P = num(o.preco), area = num(o.area);
  const m0 = ym(f.inicio), prazo = ym(f.chavesMes) - m0;
  const tipo = f.reforcosTipo, rp = num(f.reforcosPct) || 0, rn = Math.round(num(f.reforcosN) || 0);
  const ok = isFinite(P) && P > 0 && isFinite(prazo) && prazo >= 0;
  const c = ok ? calcINCC({
    valorTotal: P, prazo, inccAA: (f.incc && S.prem.projetar) ? (num(S.prem.incc) || 0) : 0, pctSemCorrecao: num(f.semCorr) || 0,
    pctAto: num(f.ato) || 0, numAto: 1, pctMensal: num(f.mensaisPct) || 0, numMensais: Math.round(num(f.mensaisN) || 0),
    pctSemestral: tipo === 'Semestrais' ? rp : 0, numSemestrais: tipo === 'Semestrais' ? rn : 0,
    pctAnual: tipo === 'Anuais' ? rp : 0, numAnuais: tipo === 'Anuais' ? rn : 0,
    pctBalao: tipo === 'Balão' ? rp : 0, numBaloes: tipo === 'Balão' ? rn : 0,
    intervaloBalao: Math.round(num(f.balaoIntervalo) || 12), inicioBalao: tipo === 'Balão' ? Math.max(0, ym(f.balaoMes1) - m0) : 0,
    pctFinanc: num(f.chavesPct) || 0, valorizacaoAA: 0,
  }) : null;
  const somaPct = ['ato', 'mensaisPct', 'reforcosPct', 'chavesPct'].reduce((s, k) => s + (num(f[k]) || 0), 0);
  const base = ym(String(S.cliente.data || '').slice(0, 7));
  const r = {
    ok, P, area, m2: P / area, m0, prazo, mk: m0 + prazo, somaPct, avisos: c ? c.avisos : [],
    ateChaves: m0 + prazo - base, ateEntrega: ym(o.entrega) - base,
    custos: P * ((num(S.prem.itbi) || 0) + (num(S.prem.cartorio) || 0)) / 100,
    aluguel: num(o.aluguel), cond: num(o.condominio),
  };
  r.rendaA = r.aluguel * 12 / P;
  if (!c) return Object.assign(r, { itens: [], cum: [], total: NaN, incc: NaN, chavesC: NaN, obraC: NaN, ato: NaN, mensal: NaN, nMensais: 0, ref: NaN, nRef: 0, refNome: '', sac1: NaN, renda: NaN });
  // quebra cada mês nas parcelas, já com a fração corrigida da linha
  const itens = [];
  const partes = [['ent', 'Ato'], ['m', 'Mensal'], ['s', 'Semestral'], ['a', 'Anual'], ['b', 'Balão'], ['f', 'Chaves']];
  c.rows.forEach(row => partes.forEach(([k, nome]) => {
    if (row[k] > 0.005) itens.push({ m: row.mes, tipo: nome, v: row[k], vc: row.total > 0 ? row[k] * row.corrigido / row.total : row[k] });
  }));
  let acc = 0; const cum = [];
  c.rows.forEach(row => { acc += itens.filter(i => i.m === row.mes && i.tipo !== 'Chaves').reduce((s, i) => s + i.vc, 0); cum.push([m0 + row.mes, acc]); });
  const refNome = tipo === 'Balão' ? 'Balão' : tipo === 'Semestrais' ? 'Semestral' : 'Anual';
  const ref = tipo === 'Balão' ? c.balao : tipo === 'Semestrais' ? c.semestral : c.anual;
  const nRef = tipo === 'Balão' ? c.nBaloes : tipo === 'Semestrais' ? c.nSemestrais : c.nAnuais;
  const ib = Math.pow(1 + (num(S.prem.taxa) || 0) / 100, 1 / 12) - 1, n = Math.round(num(S.prem.prazo) || 360);
  const sac1 = c.financCorrigido / n + c.financCorrigido * ib;
  return Object.assign(r, {
    itens, cum, rows: c.rows, totN: c.tot, total: c.tot.corrigido, incc: c.tot.custo, chavesC: c.financCorrigido, obraC: c.tot.corrigido - c.financCorrigido,
    ato: c.ato, mensal: c.mensal, nMensais: c.nMensais, mensal1: c.mensal1, mensalN: c.mensalN, ref, nRef, refNome,
    chaves: c.financ, sac1, renda: sac1 / ((num(S.prem.comp) || 30) / 100),
  });
}

/* ═══════════ ícones ═══════════ */
const IC = {
  check: `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#E9DCC3"/><path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="#1E2650" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pin: `<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="#B8955A" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`,
  wa: `<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>`,
  ig: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>`,
  web: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  mail: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 6.5L12 13l8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  doc: `<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l5 5v15H6z" fill="none" stroke="#B8955A" stroke-width="1.8"/><path d="M14 2v5h5" fill="none" stroke="#B8955A" stroke-width="1.8"/></svg>`,
};

/* ═══════════ CSS do documento (tela e PDF usam o mesmo) ═══════════ */
function docCSS() {
  const fonte = abs('/v2/assets/fonts/CaviarDreams.ttf'), fonteB = abs('/v2/assets/fonts/CaviarDreams-Bold.ttf');
  return `
@font-face{font-family:"PP Caviar";src:url("${fonte}") format("truetype");font-weight:400}
@font-face{font-family:"PP Caviar";src:url("${fonteB}") format("truetype");font-weight:700}
${PP_CSS}
.ppd{--navy:#1E2650;--navy2:#141939;--navy3:#2C3568;--gold:#B8955A;--goldsoft:#E9DCC3;--soft:#F7F5EF;--paper:#fff;
  --ink:#1B1E2E;--muted:#6B6F86;--line:#E4E1D8;--ok:#2F7D5B;--oksoft:#E3F1EA;--warn:#A8681A;--warnsoft:#F7EBD9;
  --disp:"PP Caviar","Caviar Dreams","Futura","Avenir Next",system-ui,sans-serif;--body:"IBM Plex Sans","Helvetica Neue",Arial,sans-serif;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;color:var(--ink);font-family:var(--body)}
.ppd *{box-sizing:border-box}
.ppd .pg{width:540px;height:960px;position:relative;overflow:hidden;background:var(--paper);padding:46px 42px 70px;display:flex;flex-direction:column;font-size:13px;line-height:1.45;color:var(--ink);text-align:left}
.ppd a{color:inherit;text-decoration:none}
.ppd .num{font-variant-numeric:tabular-nums}
.ppd .eyebrow{font:500 10.5px var(--body);letter-spacing:.28em;text-transform:uppercase;color:var(--gold)}
.ppd h2{font:400 33px/1.1 var(--disp);margin:6px 0 0;color:var(--navy);letter-spacing:0;text-wrap:balance;border:0;padding:0}
.ppd .lede{color:var(--muted);font-size:13px;margin:8px 0 0;max-width:46ch}
.ppd .foot{position:absolute;left:42px;right:42px;bottom:24px;display:flex;justify-content:space-between;align-items:center;font-size:9.5px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px}
.ppd .foot img{height:12px;width:auto}
.ppd .dark{background:var(--navy);color:#fff}
.ppd .dark .foot{color:rgba(255,255,255,.55);border-color:rgba(255,255,255,.15)}
.ppd .note{font-size:10px;color:var(--muted);line-height:1.4}
.ppd .badge{display:inline-flex;align-items:center;gap:6px;font:600 9.5px var(--body);letter-spacing:.14em;text-transform:uppercase;padding:5px 10px;border-radius:99px;background:#fff;color:var(--navy)}
.ppd .badge i{width:7px;height:7px;border-radius:50%;background:currentColor}
.ppd .badge.l{color:#6E4A9A}.ppd .badge.o{color:var(--warn)}.ppd .badge.p{color:var(--ok)}
.ppd .chip{background:var(--soft);border-radius:8px;padding:8px 10px;min-width:0}
.ppd .chip small{display:block;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.ppd .chip b{display:block;font:700 13.5px/1.25 var(--disp);color:var(--navy);margin-top:2px}
.ppd .chip.hl{background:var(--navy)}.ppd .chip.hl small{color:var(--goldsoft)}.ppd .chip.hl b{color:#fff}
.ppd .chip.ok{background:var(--oksoft)}.ppd .chip.ok small,.ppd .chip.ok b{color:var(--ok)}
.ppd .chip.warn{background:var(--warnsoft)}.ppd .chip.warn small{color:var(--warn)}
.ppd .chip .v{font:600 13px/1.25 var(--body);color:var(--ink);display:block;margin-top:2px}
.ppd .chip.hl .v{color:#fff}.ppd .chip.ok .v{color:var(--ok)}
.ppd .av{border-radius:50%;background:var(--navy3) center/cover no-repeat;border:1.5px solid var(--gold);display:grid;place-items:center;font-family:var(--disp);color:#fff;flex:none}
/* capa */
.ppd .cover .logo{height:22px;width:auto;align-self:flex-start}
.ppd .cover .name{font:400 54px/1.02 var(--disp);margin:12px 0 0;color:#fff}
.ppd .cover .rule{width:64px;height:2px;background:var(--gold);margin:22px 0 18px}
.ppd .cover .intro{font-size:14px;line-height:1.6;color:rgba(255,255,255,.84);max-width:44ch;margin:0}
.ppd .cover .valid{display:inline-flex;margin-top:18px;font-size:11.5px;color:var(--goldsoft);border:1px solid rgba(184,149,90,.55);border-radius:99px;padding:5px 12px;align-self:flex-start}
.ppd .cover .list{margin-top:24px;display:flex;flex-direction:column;gap:10px}
.ppd .cover .it{display:grid;grid-template-columns:28px 64px 1fr auto;gap:12px;align-items:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px 10px 12px}
.ppd .cover .it .n{font:400 22px var(--disp);color:var(--gold)}
.ppd .cover .it .ph{width:64px;height:64px;border-radius:7px;background:#2C3568 center/cover no-repeat}
.ppd .cover .it b{font:700 15px var(--disp);display:block;color:#fff}
.ppd .cover .it span{font-size:11.5px;color:rgba(255,255,255,.66);display:block}
.ppd .cover .it .pr{text-align:right;font:500 14.5px var(--body);color:#fff;white-space:nowrap}
.ppd .cover .it .pr small{display:block;font-size:10.5px;color:var(--goldsoft);font-weight:400}
.ppd .cover .who{margin-top:auto;display:flex;align-items:center;gap:12px;font-size:12px;color:rgba(255,255,255,.75)}
.ppd .cover .who .av{width:44px;height:44px;font-size:16px}
.ppd .cover .who b{color:#fff;font-weight:500;display:block;font-size:13px}
/* opção: fachada + planta + localização numa página só */
.ppd .op{padding:0}
.ppd .op .img{height:290px;background:var(--navy2) center/cover no-repeat;position:relative;flex:none}
.ppd .op .img::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,25,57,.45) 0%,rgba(20,25,57,0) 30%,rgba(20,25,57,0) 45%,rgba(20,25,57,.92) 100%)}
.ppd .op .top{position:absolute;top:26px;left:42px;right:42px;display:flex;justify-content:space-between;align-items:center;z-index:2}
.ppd .op .top img{height:15px;width:auto}
.ppd .op .ttl{position:absolute;left:42px;right:42px;top:176px;z-index:2;color:#fff}
.ppd .op .ttl .eyebrow{color:var(--goldsoft)}
.ppd .op .ttl h2{color:#fff;font-size:36px;margin-top:4px}
.ppd .op .ttl p{margin:4px 0 0;font-size:11.5px;opacity:.88}
.ppd .op .body{padding:16px 42px 62px;display:flex;flex-direction:column;gap:10px;flex:1;min-height:0}
.ppd .pricerow{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
.ppd .pricerow .u{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.ppd .pricerow .p{font:500 30px/1 var(--body);color:var(--navy);margin-top:5px;letter-spacing:-.01em}
.ppd .pricerow .m2{text-align:right;font-size:10.5px;color:var(--muted)}
.ppd .pricerow .m2 b{display:block;font:500 14px var(--body);color:var(--ink)}
.ppd .chips{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.ppd .duo{display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1;min-height:0}
.ppd .duo>div{display:flex;flex-direction:column;min-height:0}
.ppd .duo small.t{font:600 9px var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:5px}
.ppd .duo .plan{flex:1;min-height:0;background:var(--soft);border-radius:10px;display:grid;place-items:center;overflow:hidden}
.ppd .duo .plan img{max-width:94%;max-height:94%;object-fit:contain}
.ppd .duo .map{flex:1;min-height:110px;border-radius:10px;background:var(--soft) center/cover no-repeat;border:1px solid var(--line);position:relative}
.ppd .duo .map a{position:absolute;right:6px;bottom:6px;background:#fff;border-radius:99px;padding:3px 9px;font-size:9.5px;font-weight:600;color:var(--navy);box-shadow:0 1px 4px rgba(0,0,0,.2)}
.ppd .pts{list-style:none;margin:6px 0 0;padding:0}
.ppd .pts li{display:flex;justify-content:space-between;gap:6px;padding:3px 0;border-bottom:1px dashed var(--line);font-size:10.5px;line-height:1.3}
.ppd .pts li span{display:flex;gap:5px;align-items:flex-start}
.ppd .pts li svg{flex:none;margin-top:1px}
.ppd .pts li b{font-weight:500;color:var(--navy);white-space:nowrap}
.ppd .checks{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:5px 14px}
.ppd .checks li{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;line-height:1.3}
.ppd .checks li svg{flex:none;margin-top:1px}
.ppd .gal{margin-top:16px;display:grid;gap:6px;flex:1;min-height:0}
.ppd .gal div{background:var(--soft) center/cover no-repeat;border-radius:6px}
/* fluxo no padrão do Simulador VPL */
.ppd .fx .sub{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-top:6px;font-size:11px;color:var(--muted)}
.ppd .fx .sub b{color:var(--ink);font-weight:600}
.ppd .vplw{margin-top:12px;flex:none;align-self:center}
.ppd .vplw .pp-table{max-width:none}
.ppd .vplw .pp-money{min-width:92px}.ppd .vplw .pp-table .pp-c{padding:2px 5px}
.ppd .fx .res{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px}
.ppd .fx .res .chip b{font:600 12.5px/1.2 var(--body)}
.ppd .alts{margin-top:10px}
.ppd .alts>small{display:block;font:600 9.5px var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
.ppd .alt{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--line)}
.ppd .alt b{font:700 13.5px var(--disp);color:var(--navy);display:block}
.ppd .alt span{font-size:10.5px;color:var(--muted)}
.ppd .alt .v{font:600 15px var(--body);color:var(--ink);white-space:nowrap}
/* comparativo */
.ppd table.cmp{width:100%;border-collapse:collapse;margin-top:12px;font-size:11.5px;background:none;table-layout:fixed}
.ppd .cmp th,.ppd .cmp td{padding:5px 6px;text-align:left;vertical-align:middle;border:0;border-bottom:1px solid var(--line);background:none;color:var(--ink);height:auto}
.ppd .cmp thead th{border-bottom:0;padding:0 4px 8px;vertical-align:bottom;font-weight:400}
.ppd .cmp th.lbh{width:104px;padding-left:0;font-size:10px;color:var(--muted);line-height:1.35;vertical-align:bottom}
.ppd .cmp th.lbh span{display:block}.ppd .cmp th.lbh .bp{display:inline-block;margin-top:6px;font-size:9.5px}
.ppd .cmp .oh .th{height:58px;border-radius:7px;background:var(--soft) center/cover no-repeat;border-bottom:3px solid var(--c);margin-bottom:6px}
.ppd .cmp .oh small{display:block;font:600 8.5px var(--body);letter-spacing:.14em;color:var(--c);text-transform:uppercase}
.ppd .cmp .oh b{display:block;font:700 12.5px/1.15 var(--disp);color:var(--navy);margin-top:1px}
.ppd .cmp .oh span{display:block;font-size:9.5px;color:var(--muted);margin-top:1px}
.ppd .cmp td.lb{color:var(--muted);font-size:10.5px;padding-left:0;line-height:1.25}
.ppd .cmp tr.grp td{border-bottom:1px solid var(--navy);padding:10px 0 3px;font:600 9px var(--body);letter-spacing:.18em;text-transform:uppercase;color:var(--gold)}
.ppd .cmp td.v{font-variant-numeric:tabular-nums;font-size:11px;padding-left:4px}
.ppd .cmp td.v small{color:var(--muted);font-size:9.5px}
.ppd .cmp tr.forte td.v{font-weight:600;color:var(--navy)}
.ppd .bp{background:var(--oksoft);color:var(--ok);font-weight:600;border-radius:99px;padding:2px 7px;margin-left:-7px}
.ppd .cmp th.lbh .bp{margin-left:0}
.ppd .rzs{margin-top:14px}
.ppd .rzs>small{display:block;font:600 9px var(--body);letter-spacing:.18em;text-transform:uppercase;color:var(--gold);margin-bottom:6px}
.ppd .rzs .gr{display:grid;gap:6px}
.ppd .rz{background:var(--soft);border-radius:8px;padding:8px 9px;border-top:3px solid var(--c)}
.ppd .rz small{display:block;font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.ppd .rz b{display:block;font:700 12px/1.2 var(--disp);color:var(--navy);margin-top:3px}
.ppd .rz span{display:block;font:600 11px var(--body);color:var(--ink);margin-top:2px}
.ppd .chart{margin-top:14px}
.ppd .chart h4{margin:0 0 2px;font:700 14px var(--disp);color:var(--navy)}
.ppd .chart p{margin:0 0 6px;font-size:11px;color:var(--muted)}
.ppd .chart svg{display:block;width:100%;height:auto;overflow:visible}
.ppd .chart text{font-family:var(--body);fill:var(--muted);font-size:10px}
.ppd .keyleg{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:10.5px;color:var(--muted);margin-top:6px}
.ppd .keyleg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
/* decisão */
.ppd .decs{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.ppd .dec{border:1px solid var(--line);border-radius:12px;padding:12px 14px 12px 18px;position:relative}
.ppd .dec::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:4px;border-radius:0 4px 4px 0;background:var(--c)}
.ppd .dec .hd{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.ppd .dec .hd small{font:600 9px var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.ppd .dec .hd b{display:block;font:700 16px/1.2 var(--disp);color:var(--navy);margin-top:2px}
.ppd .dec .hd .pr{font:600 14px var(--body);white-space:nowrap}
.ppd .dec p{margin:6px 0 0;font-size:12px;line-height:1.45;color:var(--ink)}
.ppd .dec .fatos{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;font-size:10.5px;color:var(--muted)}
.ppd .dec .fatos b{color:var(--ink);font-weight:600}
.ppd .dec .res{display:inline-flex;align-items:center;gap:7px;margin-top:9px;background:var(--navy);color:#fff;border-radius:99px;padding:6px 13px;font-size:11.5px;font-weight:600}
.ppd .validbox{margin-top:auto;background:var(--navy);color:#fff;border-radius:12px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:16px}
.ppd .validbox b{font:400 24px var(--disp);display:block}
.ppd .validbox small{font-size:10.5px;color:var(--goldsoft);letter-spacing:.06em}
.ppd .validbox p{margin:0;font-size:10.5px;opacity:.85;max-width:34ch;text-align:right;line-height:1.45}
/* contato */
.ppd .contact{padding:0;color:#fff;background:var(--navy2)}
.ppd .contact .foto{height:280px;background:var(--navy2) 50% 20%/cover no-repeat;position:relative;flex:none}
.ppd .contact .foto::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,25,57,.1) 0%,rgba(20,25,57,0) 55%,rgba(20,25,57,1) 100%)}
.ppd .office small{font:600 9.5px var(--body);letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.ppd .office .gb{font:400 24px/1.1 var(--disp);letter-spacing:.12em;text-transform:uppercase;margin-top:4px}
.ppd .office p{margin:4px 0 0;font-size:11px;color:rgba(255,255,255,.85);line-height:1.45}
.ppd .office a{color:var(--goldsoft);border-bottom:1px solid rgba(233,220,195,.45)}
.ppd .contact .in{padding:6px 42px 62px;display:flex;flex-direction:column;gap:12px;flex:1;min-height:0}
.ppd .contact .me{display:grid;grid-template-columns:88px 1fr 96px;gap:14px;align-items:start}
.ppd .contact .me .av{width:88px;height:88px;font-size:32px;border-width:2.5px}
.ppd .contact .nm{font:400 28px/1.05 var(--disp)}
.ppd .contact .role{font-size:11px;color:var(--goldsoft);margin-top:4px;line-height:1.4}
.ppd .contact .bio{font-size:11px;color:rgba(255,255,255,.82);margin-top:6px;line-height:1.45}
.ppd .qr{background:#fff;border-radius:8px;padding:6px;text-align:center}
.ppd .qr svg{width:84px;height:84px;display:block}
.ppd .qr span{display:block;font-size:7.5px;color:var(--navy);margin-top:3px;line-height:1.2}
.ppd .cta{display:flex;align-items:center;gap:12px;border-radius:10px;padding:9px 14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#fff}
.ppd .cta.main{background:#fff;color:var(--navy);border-color:#fff}
.ppd .cta .ic{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.1);flex:none}
.ppd .cta.main .ic{background:var(--navy);color:#fff}
.ppd .cta b{font:600 14px var(--body);display:block}
.ppd .cta span{font-size:10px;opacity:.72;display:block}
.ppd .cta .go{margin-left:auto;font-size:15px;opacity:.6}
.ppd .marcas>small{display:block;font:600 9.5px var(--body);letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:6px}
.ppd .marcas .gr{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ppd .marca{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.ppd .marca .lg{height:44px;display:flex;align-items:center}
.ppd .marca .lg img{max-height:100%;max-width:100%;width:auto}
.ppd .marca .tag{font-size:9.5px;color:rgba(255,255,255,.6);line-height:1.3}
.ppd .marca a{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500;color:#fff}
.ppd .marca a svg{width:13px;height:13px;flex:none;opacity:.85}
.ppd .legal{margin-top:auto;padding-top:8px;border-top:1px solid rgba(255,255,255,.14);font-size:9px;color:rgba(255,255,255,.55);line-height:1.45}
`;
}

/* ═══════════ páginas ═══════════ */
// linhas da tabela VPL que cabem por página; acima disso o fluxo continua na página seguinte
const LINHAS_VPL = 48;

// estimativa do tamanho natural da tabela do VPL (PP_CSS) para encaixar por zoom
function tabelaVPL(c, linhasFluxo, disponivelAltura) {
  const temBalao = c.rows.some(r => r.b > 0.005);
  const cv = { fluxo: linhasFluxo, nAto: 1, temBalao, tot: c.totN };
  const colsDinheiro = temBalao ? 7 : 6;
  const natW = 44 + 74 + colsDinheiro * 104, natH = 84 + linhasFluxo.length * 21 + 24;
  const z = Math.min(1, 456 / natW, disponivelAltura / natH);
  return `<div class="vplw" style="width:${natW}px;zoom:${z.toFixed(3)}">${propostaTableHTML(cv, i => mlab(c.m0 + i))}</div>`;
}

function montarDocumento(S, C0) {
  const cartao = C0 || {};
  const LOGO_CLARO = abs('/v2/img/logo-psm-imoveis-creme.png'), LOGO_ESCURO = abs('/v2/img/logo-psm-imoveis-doc.png');
  const O = S.opcoes, C = O.map(o => calcular(o, S));
  const nome = o => o.empreendimento + (o.unidade ? ' · Un. ' + o.unidade : '');
  let n = 0;
  const foot = dark => { n++; return `<div class="foot"><span>${esc(MARCAS[0].nome)} · Proposta para ${esc(S.cliente.nome || 'cliente')} · ${dataLonga(S.cliente.data)}</span><span style="display:flex;gap:10px;align-items:center"><span class="num">${p2(n)}</span><img src="${dark ? LOGO_CLARO : LOGO_ESCURO}" alt=""></span></div>`; };
  const pg = (cls, html, rot) => ({ rot, html: `<section class="pg ${cls}">${html}</section>` });
  const bgUrl = u => u ? `background-image:url('${esc(abs(u))}')` : '';
  const validade = somaDias(S.cliente.data, num(S.cliente.validade) || 7);
  const wa = waLink(cartao);
  const pages = [];

  /* 1. capa */
  pages.push(pg('dark cover', `
    <img class="logo" src="${LOGO_CLARO}" alt="${esc(MARCAS[0].nome)}">
    <div class="eyebrow" style="margin-top:54px">Proposta personalizada</div>
    <div class="name">${esc(S.cliente.nome || 'Nome do cliente')}</div>
    <div class="rule"></div>
    ${S.cliente.abertura ? `<p class="intro">${esc(S.cliente.abertura)}</p>` : ''}
    <div class="valid">Condições válidas até ${validade}</div>
    <div class="list">${O.map((o, i) => `<div class="it"><div class="n">${p2(i + 1)}</div><div class="ph" style="${bgUrl(o.img.fachada)}"></div>
      <div><b>${esc(o.empreendimento || 'Empreendimento')}</b><span>${esc(o.tipologia)}${o.area ? ' · ' + esc(o.area) + ' m²' : ''}${o.unidade ? ' · Un. ' + esc(o.unidade) : ''}</span>
      <span>Chaves em ${mlab(C[i].mk)} · ${o.f.incc ? 'correção INCC mensal' : 'sem correção'}</span></div>
      <div class="pr num">${brl(C[i].P)}<small>${esc(o.status)}</small></div></div>`).join('')}</div>
    <div class="who"><div class="av" style="${bgUrl(cartao.foto)}">${cartao.foto ? '' : esc(iniciais(cartao.nome))}</div>
      <div><b>${esc(cartao.nome || '')}</b>${esc(cartao.cargo || '')}${cartao.whats ? ' · WhatsApp ' + esc(cartao.whats) : ''}</div></div>
    ${foot(true)}`, 'Capa'));

  /* 2. cada opção: [fachada + planta + localização] → [fotos, se houver] → [fluxo VPL] */
  O.forEach((o, i) => {
    const c = C[i], cab = `<div class="eyebrow">Opção ${p2(i + 1)} · ${esc(nome(o))}</div>`;
    const chips = [['Área', o.area ? `${esc(o.area)} m²` : '—'], ['Tipologia', esc(o.tipologia || '—')], ['Vaga', esc(o.vagas || '—')],
      o.vista ? ['Vista', esc(o.vista)] : ['Andar', esc(o.andar || '—')], ['Mobiliado', o.mobiliado ? 'Sim, completo' : 'Não'],
      ['Chaves', isFinite(c.ateChaves) ? `${mlab(c.mk)} · ${c.ateChaves} meses` : '—']];
    const pts = linhas(o.pontos).map(l => l.split('|').map(x => x.trim())).slice(0, 5);
    const dest = linhas(o.destaques).slice(0, 4);
    const qMapa = `${o.empreendimento}, ${String(o.endereco).split('·')[0]}, São José do Rio Preto`;
    pages.push(pg('op', `
      <div class="img" style="${bgUrl(o.img.fachada)}"></div>
      <div class="top"><img src="${LOGO_CLARO}" alt=""><span class="badge ${o.status === 'Lançamento' ? 'l' : o.status === 'Em obras' ? 'o' : 'p'}"><i></i>${esc(o.status)}</span></div>
      <div class="ttl"><div class="eyebrow">Opção ${p2(i + 1)}${o.incorporadora ? ' · ' + esc(o.incorporadora) : ''}</div><h2>${esc(o.empreendimento || 'Empreendimento')}</h2><p>${esc(o.endereco)}</p></div>
      <div class="body">
        <div class="pricerow"><div><div class="u">${o.unidade ? 'Unidade ' + esc(o.unidade) : ''}${o.andar ? ' · ' + esc(o.andar) : ''}</div><div class="p num">${brl(c.P)}</div></div>
          <div class="m2">Preço por m²<b class="num">${brl(c.m2)}</b></div></div>
        <div class="chips">${chips.map(([k, v], j) => `<div class="chip ${j === 5 ? 'hl' : ''}"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
        <div class="duo">
          <div><small class="t">Planta${o.mobiliado ? '' : ' · ilustrativa'}</small><div class="plan">${o.img.planta ? `<img src="${esc(abs(o.img.planta))}" alt="Planta">` : '<span class="note">planta não enviada</span>'}</div></div>
          <div><small class="t">Localização</small><div class="map" style="${bgUrl(o.img.mapa)}"><a href="${mapsLink(qMapa)}" target="_blank" rel="noopener">Abrir no mapa ↗</a></div>
            ${pts.length ? `<ul class="pts">${pts.map(([a, b]) => `<li><span>${IC.pin}${esc(a)}</span>${b ? `<b>${esc(b)}</b>` : ''}</li>`).join('')}</ul>` : ''}</div>
        </div>
        ${dest.length ? `<ul class="checks">${dest.map(d => `<li>${IC.check}<span>${esc(d)}</span></li>`).join('')}</ul>` : ''}
      </div>${foot()}`, `Opção ${i + 1} · empreendimento`));

    const fotos = (o.img.fotos || []).slice(0, 6);
    if (fotos.length) {
      const cols = fotos.length <= 2 ? 1 : 2, rowsN = Math.ceil((fotos.length + (fotos.length === 3 ? 1 : 0)) / cols);
      pages.push(pg('', `${cab}<h2>${o.mobiliado ? 'Como ele é entregue' : 'Por dentro'}</h2>
        <div class="gal" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rowsN},1fr)">${fotos.map((u, k) => `<div style="${bgUrl(u)}${fotos.length === 3 && k === 0 ? ';grid-column:1/-1' : ''}"></div>`).join('')}</div>
        <div class="note" style="margin-top:6px">Imagens ilustrativas.</div>${foot()}`, `Opção ${i + 1} · fotos`));
    }

    fluxoPaginas(o, c, i, S).forEach((html, k, arr) => pages.push(pg('fx', `${cab}${html}${foot()}`, `Opção ${i + 1} · fluxo${arr.length > 1 ? ` (${k + 1}/${arr.length})` : ''}`)));
  });

  /* 3. comparativos (depois das opções individuais) */
  if (O.length > 1) {
    const investe = S.cliente.objetivo !== 'morar', projeta = !!S.prem.projetar;
    const V = (t, v) => ({ t, v });
    const melhor = (vals, regra) => {
      if (!regra) return -1;
      const ns = vals.map(x => x.v), ok = ns.filter(isFinite);
      if (ok.length < 2 || new Set(ok.map(x => Math.round(x * 100))).size < 2) return -1;
      return ns.indexOf(regra === 'min' ? Math.min(...ok) : Math.max(...ok));
    };
    const linha = (rot, vals, regra, forte) => {
      const b = melhor(vals, regra);
      return `<tr class="${forte ? 'forte' : ''}"><td class="lb">${rot}</td>${vals.map((x, k) => `<td class="v">${k === b ? `<span class="bp">${x.t}</span>` : x.t}</td>`).join('')}</tr>`;
    };
    const grp = t => `<tr class="grp"><td colspan="${O.length + 1}">${t}</td></tr>`;
    let rows = grp('O imóvel')
      + linha('Área privativa', C.map(c => V(isFinite(c.area) ? c.area.toLocaleString('pt-BR') + ' m²' : '—', c.area)), 'max')
      + linha('Preço por m²', C.map(c => V(brl(c.m2), c.m2)), 'min')
      + linha('Vaga', O.map(o => V(esc(o.vagas || '—'))))
      + linha('Mobiliado', O.map(o => V(o.mobiliado ? 'Sim' : 'Não', o.mobiliado ? 1 : 0)), 'max')
      + linha('Chaves', C.map(c => V(isFinite(c.ateChaves) ? `${mlab(c.mk)} <small>(${c.ateChaves} meses)</small>` : '—', c.ateChaves)), 'min')
      + grp('Quanto custa')
      + linha('Preço de tabela', C.map(c => V(brl(c.P), c.P)), 'min', true)
      + linha('Correção', O.map(o => V(o.f.incc ? 'INCC mensal' : 'Sem correção', o.f.incc ? 1 : 0)), 'min');
    if (projeta) rows += linha('INCC estimado', C.map((c, k) => V(O[k].f.incc ? '+ ' + brl(c.incc) : '—', O[k].f.incc ? c.incc : 0)), 'min')
      + linha('Valor final c/ INCC', C.map(c => V(brl(c.total), c.total)), 'min', true);
    rows += linha('ITBI + registro (est.)', C.map(c => V(brl(c.custos), c.custos)))
      + grp('Como você paga')
      + linha('Entrada no ato', C.map(c => V(brl(c.ato), c.ato)), 'min')
      + linha('Parcela mensal', C.map(c => V(c.nMensais ? `${c.nMensais}× ${brl(c.mensal)}` : '—', c.nMensais ? c.mensal : NaN)), 'min')
      + linha('Reforços', C.map(c => V(c.nRef ? `${c.nRef}× ${brl(c.ref)}` : '—')))
      + linha('Saldo nas chaves', C.map(c => V(brl(c.chavesC), c.chavesC)), 'min', true)
      + grp('Depois das chaves (estimativa)')
      + linha('1ª parcela do banco', C.map(c => V(brl(c.sac1), c.sac1)), 'min')
      + linha('Renda sugerida', C.map(c => V(brl(c.renda), c.renda)), 'min');
    if (investe && C.some(c => isFinite(c.aluguel))) rows += linha('Aluguel estimado', C.map(c => V(isFinite(c.aluguel) ? brl(c.aluguel) : '—', c.aluguel)), 'max')
      + linha('Rentabilidade bruta', C.map(c => V(isFinite(c.rendaA) ? pct(c.rendaA * 100) + ' a.a.' : '—', c.rendaA)), 'max');
    if (C.some(c => isFinite(c.cond))) rows += linha('Condomínio (est.)', C.map(c => V(isFinite(c.cond) ? brl(c.cond) : '—', c.cond)), 'min');
    // "em resumo": quem ganha nos critérios que mais pesam na decisão
    const destaques = [
      ['Chaves mais cedo', C.map(c => V(mlab(c.mk), c.ateChaves)), 'min'],
      ['Menor entrada', C.map(c => V(brl(c.ato), c.ato)), 'min'],
      ['Menor mensal', C.map(c => V(c.nMensais ? brl(c.mensal) : '—', c.nMensais ? c.mensal : NaN)), 'min'],
      ['Mais espaço', C.map(c => V(isFinite(c.area) ? c.area.toLocaleString('pt-BR') + ' m²' : '—', c.area)), 'max'],
      ['Menor preço por m²', C.map(c => V(brl(c.m2), c.m2)), 'min'],
    ].map(([rot, vals, regra]) => { const k = melhor(vals, regra); return k < 0 ? '' : `<div class="rz" style="--c:${CORES[k]}"><small>${rot}</small><b>${esc(O[k].empreendimento)}${O[k].unidade ? ' · ' + esc(O[k].unidade) : ''}</b><span>${vals[k].t}</span></div>`; }).filter(Boolean).slice(0, 4);
    pages.push(pg('cmpg', `
      <div class="eyebrow">Comparativo</div><h2>Lado a lado</h2>
      <table class="cmp"><thead><tr><th class="lbh"><span>Os mesmos critérios para as ${['', 'uma', 'duas', 'três', 'quatro'][O.length]} opções.</span><span class="bp">melhor da linha</span></th>${O.map((o, k) => `<th><div class="oh" style="--c:${CORES[k]}"><div class="th" style="${bgUrl(o.img.fachada)}"></div><small>Opção ${p2(k + 1)}</small><b>${esc(o.empreendimento)}</b><span>${esc(o.tipologia)}${o.unidade ? ' · Un. ' + esc(o.unidade) : ''}</span></div></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      ${destaques.length ? `<div class="rzs"><small>Em resumo</small><div class="gr" style="grid-template-columns:repeat(${destaques.length},1fr)">${destaques.join('')}</div></div>` : ''}
      <div class="note" style="margin-top:8px">${projeta ? `INCC projetado a ${pct(num(S.prem.incc))} a.a. ` : 'Valores de tabela; as opções com INCC têm correção mensal até as chaves. '}Financiamento: SAC em ${Math.round((num(S.prem.prazo) || 360) / 12)} anos a ${pct(num(S.prem.taxa))} a.a., parcela até ${pct(num(S.prem.comp), 0)} da renda. Estimativas.</div>
      ${foot()}`, 'Comparativo'));
    const gr = graficos(O, C, S);
    if (gr) pages.push(pg('', `<div class="eyebrow">Comparativo · visual</div><h2>Quanto sai do bolso, e quando</h2>${gr}${foot()}`, 'Comparativo visual'));
  }

  /* 4. decisão: qual combina + reservar pelo WhatsApp */
  const msgReserva = (o, i) => `Olá${cartao.nome ? ', ' + cartao.nome.split(' ')[0] : ''}! Quero reservar a opção ${p2(i + 1)}: ${o.empreendimento}${o.unidade ? ', unidade ' + o.unidade : ''} (${brl(C[i].P)}).`;
  const waReserva = (o, i) => { const d = waLink(cartao); return d ? d.replace(/\?text=.*$/, '') + '?text=' + encodeURIComponent(msgReserva(o, i)) : ''; };
  pages.push(pg('', `
    <div class="eyebrow">Sua decisão</div><h2>${O.length > 1 ? 'Qual combina com você?' : 'Esta combina com você?'}</h2>
    <p class="lede">O essencial de cada opção. Escolheu? Toque em reservar e a mensagem chega pronta no meu WhatsApp.</p>
    <div class="decs">${O.map((o, i) => { const c = C[i], lk = waReserva(o, i); return `<div class="dec" style="--c:${CORES[i]}">
      <div class="hd"><div><small>Opção ${p2(i + 1)} · ${esc(o.status)}</small><b>${esc(o.empreendimento)}${o.tipologia ? ' · ' + esc(o.tipologia) : ''}${o.area ? ' ' + esc(o.area) + ' m²' : ''}</b></div><span class="pr num">${brl(c.P)}</span></div>
      ${o.perfil ? `<p>${esc(o.perfil)}</p>` : ''}
      <div class="fatos"><span>${o.f.incc && S.prem.projetar ? 'Valor final est.' : 'Valor'} <b>${brl(c.total)}</b></span>${o.f.incc && !S.prem.projetar ? '<span><b>INCC mensal</b></span>' : ''}<span>Ato <b>${brl(c.ato)}</b></span>${c.nMensais ? `<span>Mensal <b>${brl(c.mensal)}</b></span>` : ''}<span>Chaves <b>${mlab(c.mk)}</b></span></div>
      ${lk ? `<a class="res" href="${lk}" target="_blank" rel="noopener">${IC.wa} Quero reservar esta opção</a>` : ''}</div>`; }).join('')}</div>
    <div class="validbox"><div><small>CONDIÇÕES VÁLIDAS ATÉ</small><b>${validade}</b></div><p>Reserva em 3 passos: unidade, ficha e contrato. E seguimos juntos depois das chaves: vendemos a sua unidade quando quiser e administramos a locação.</p></div>
    ${foot()}`, 'Decisão'));

  /* 5. contato: Georgina + corretor + as duas marcas */
  const end = enderecoEmpresa();
  pages.push(pg('contact', `
    <div class="foto" style="${bgUrl('/v2/img/georgina-business-park.jpg')}"></div>
    <div class="in">
      <div class="office"><small>Nosso escritório</small><div class="gb">${esc(end.predio)}</div>
        <p>Setor Europa · ${esc(end.sala)}<br>${esc(end.rua)} · ${esc(end.cidade)} · <a href="${mapsLink(`${end.predio}, ${end.rua}, ${end.cidade}`)}" target="_blank" rel="noopener">Como chegar ↗</a></p></div>
      <div class="me"><div class="av" style="${bgUrl(cartao.foto)}">${cartao.foto ? '' : esc(iniciais(cartao.nome))}</div>
        <div><div class="nm">${esc(cartao.nome || '')}</div><div class="role">${esc(cartao.cargo || '')}${cartao.creci ? ' · CRECI ' + esc(cartao.creci) : ''}</div>${cartao.bio ? `<div class="bio">${esc(cartao.bio)}</div>` : ''}</div>
        ${wa ? `<div class="qr">${qrSVG(wa)}<span>Aponte a câmera e fale comigo</span></div>` : '<div></div>'}</div>
      ${wa ? `<a class="cta main" href="${wa}" target="_blank" rel="noopener"><span class="ic">${IC.wa}</span><span><b>${esc(cartao.whats)}</b><span>Toque para falar comigo no WhatsApp</span></span><span class="go">→</span></a>` : ''}
      ${cartao.email ? `<a class="cta" href="mailto:${esc(cartao.email)}"><span class="ic">${IC.mail}</span><span><b style="font-size:13px">${esc(cartao.email)}</b><span>E-mail</span></span><span class="go">→</span></a>` : ''}
      <div class="marcas"><small>Nossas marcas</small><div class="gr">${MARCAS.map(m => `<div class="marca">
        <div class="lg"><img src="${abs(m.logo)}" alt="${esc(m.nome)}" style="max-height:${m.h}px"></div><div class="tag">${esc(m.tag)}</div>
        <a href="https://${m.site}" target="_blank" rel="noopener">${IC.web}${m.site}</a>
        <a href="https://instagram.com/${m.ig}" target="_blank" rel="noopener">${IC.ig}@${m.ig}</a></div>`).join('')}</div></div>
      <div class="legal">${esc(EMPRESA.nome)} · CRECI ${esc(EMPRESA.creci)}. Valores e condições de tabela vigente, sujeitos a alteração pela incorporadora. Imagens ilustrativas. INCC e financiamento são estimativas.</div>
    </div>${foot(true)}`, 'Contato'));

  return { pages, calc: C };
}

/* fluxo no padrão do Simulador VPL (tabela PROPOSTA PERSONALIZADA) + resumo; quebra em páginas se passar de LINHAS_VPL */
function fluxoPaginas(o, c, i, S) {
  if (!c.ok) return [`<h2>Fluxo de pagamento</h2><div class="chip warn" style="margin-top:14px"><small>Fluxo incompleto</small><span class="v">Preencha preço, mês do ato e mês das chaves.</span></div>`];
  const f = o.f;
  const partes = [`${pct(num(f.ato))} ato`];
  if (c.nMensais) partes.push(`${pct(num(f.mensaisPct))} em ${c.nMensais} mensais`);
  if (c.nRef) partes.push(`${pct(num(f.reforcosPct))} em ${c.nRef} ${c.refNome === 'Balão' ? (c.nRef > 1 ? 'balões' : 'balão') : (c.refNome === 'Anual' ? 'anuais' : 'semestrais')}`);
  partes.push(`${pct(num(f.chavesPct))} no financiamento`);
  const sub = `<div class="sub"><span>${partes.join(' · ')}</span><b>${mlab(c.m0)} → ${mlab(c.mk)}</b></div>`;
  const alts = linhas(o.alternativas).map(l => l.split('|').map(x => x.trim()));
  const somaRuim = Math.abs(c.somaPct - 100) > 0.001;
  const projeta = f.incc && S.prem.projetar;
  const res = `<div class="res">
      ${!f.incc ? `<div class="chip ok"><small>Sem correção INCC</small><b class="num">${brl(c.P)}</b></div>`
        : projeta ? `<div class="chip warn"><small>Valor final c/ INCC</small><b class="num">${brl(c.total)}</b></div>`
        : `<div class="chip warn"><small>Correção</small><b>INCC mensal</b></div>`}
      <div class="chip"><small>Saldo nas chaves${projeta ? ' (est.)' : ''}</small><b class="num">${brl(c.chavesC)}</b></div>
      <div class="chip"><small>1ª parcela banco</small><b class="num">${brl(c.sac1)}</b></div>
      <div class="chip hl"><small>Renda sugerida</small><b class="num">${brl(c.renda)}</b></div></div>
    <div class="note" style="margin-top:6px">${somaRuim ? `<b style="color:#9A3B3B">⚠ O fluxo soma ${pct(c.somaPct)}: ajuste até fechar 100%.</b> ` : ''}${!f.incc ? 'Sem correção de INCC durante todo o período. '
      : projeta ? `Tabela em valores de tabela; o INCC projetado de ${pct(num(S.prem.incc))} a.a.${num(f.semCorr) > 0 ? ` (primeiros ${pct(num(f.semCorr))} do fluxo sem correção)` : ''} soma ${brl(c.incc)} até as chaves. `
      : `Valores de tabela. As parcelas e o saldo têm <b>correção mensal pelo INCC</b> até as chaves${num(f.semCorr) > 0 ? ` (os primeiros ${pct(num(f.semCorr))} do fluxo não corrigem)` : ''}; se quiser, simulamos o fluxo com a projeção do INCC. `}Financiamento: SAC ${Math.round((num(S.prem.prazo) || 360) / 12)} anos a ${pct(num(S.prem.taxa))} a.a.; aprovação final do banco.</div>`;
  const altHTML = alts.length ? `<div class="alts"><small>Alternativas ao plano padrão</small>${alts.map(([a, b, v]) => `<div class="alt"><div><b>${esc(a)}</b><span>${esc(b || '')}</span></div><div class="v num">${isFinite(num(v)) ? brl(num(v)) : esc(v || '')}</div></div>`).join('')}</div>` : '';
  const rows = c.rows.map(r => ({ mes: r.mes, ent: r.ent, m: r.m, s: r.s, a: r.a, b: r.b, f: r.f, total: r.total, chaves: r.chaves }));
  const partesTab = [];
  for (let k = 0; k < rows.length; k += LINHAS_VPL) partesTab.push(rows.slice(k, k + LINHAS_VPL));
  // altura útil: 844 (página sem margens) − cabeçalho (~122) − resumo com nota (~128) − alternativas
  const altAlts = alts.length ? 26 + alts.length * 42 : 0;
  return partesTab.map((lin, k) => {
    const ultima = k === partesTab.length - 1;
    const h = 844 - 122 - (ultima ? 128 + altAlts : 0);
    return `<h2>Fluxo de pagamento${partesTab.length > 1 ? ` <span style="font-size:18px;color:var(--muted)">${k + 1}/${partesTab.length}</span>` : ''}</h2>${sub}
      ${tabelaVPL(c, lin, h)}${ultima ? res + altHTML : ''}`;
  });
}

function graficos(O, C, S) {
  const ok = C.map((c, i) => [c, i]).filter(([c]) => c.ok);
  if (!ok.length) return '';
  const a = Math.min(...ok.map(([c]) => c.m0)), b = Math.max(...ok.map(([c]) => c.mk)), span = Math.max(1, b - a);
  const W = 456, x = m => (m - a) / span * W;
  const ticks = []; for (let m = a; m <= b; m++) if (span > 18 ? m % 12 === 0 : true) ticks.push(m);
  const tl = m => span > 18 ? String(Math.floor(m / 12)) : mlab(m);
  const rot = i => `${p2(i + 1)} · ${O[i].empreendimento}${O[i].unidade ? ' ' + O[i].unidade : ''}`;
  // linha do tempo
  const rh = 34, gh = O.length * rh + 22;
  let g = `<svg viewBox="0 0 ${W} ${gh}" role="img" aria-label="Linha do tempo até as chaves">`;
  ticks.forEach(m => { g += `<line x1="${x(m)}" x2="${x(m)}" y1="0" y2="${gh - 18}" stroke="#E4E1D8"/><text x="${x(m)}" y="${gh - 4}" text-anchor="middle">${tl(m)}</text>`; });
  ok.forEach(([c, i]) => {
    const y = i * rh + 6, x1 = x(c.m0), x2 = x(c.mk);
    g += `<rect x="${x1}" y="${y + 8}" width="${Math.max(2, x2 - x1)}" height="10" rx="5" fill="${CORES[i]}"/><circle cx="${x2}" cy="${y + 13}" r="7" fill="#fff" stroke="${CORES[i]}" stroke-width="2"/>`;
    g += `<text x="${x1}" y="${y + 2}" style="fill:#1B1E2E;font-weight:500">${esc(rot(i))}</text>`;
    const fim = x2 > W - 90; g += fim ? `<text x="${x2}" y="${y + 2}" text-anchor="end" style="fill:${CORES[i]};font-weight:600">chaves ${mlab(c.mk)}</text>`
      : `<text x="${x2 + 12}" y="${y + 17}" style="fill:${CORES[i]};font-weight:600">chaves ${mlab(c.mk)}</text>`;
  });
  g += '</svg>';
  // desembolso acumulado até as chaves
  const H = 200, maxY = Math.max(1, ...ok.flatMap(([c]) => c.cum.map(p => p[1])));
  const pw = Math.pow(10, Math.floor(Math.log10(maxY))), topo = [1, 2, 2.5, 5, 10].find(k => k * pw >= maxY) * pw;
  const y = v => H - v / topo * H;
  let s = `<svg viewBox="-84 -8 ${W + 92} ${H + 26}" role="img" aria-label="Quanto você paga até as chaves">`;
  for (let k = 0; k <= 4; k++) { const v = topo * k / 4; s += `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E1D8"/><text x="-8" y="${y(v) + 3}" text-anchor="end">${brl(v)}</text>`; }
  ticks.forEach(m => { s += `<text x="${x(m)}" y="${H + 16}" text-anchor="middle">${tl(m)}</text>`; });
  ok.forEach(([c, i]) => {
    let d = ''; c.cum.forEach(([m, v], k) => { d += k === 0 ? `M${x(m)},${y(0)}V${y(v)}` : `H${x(m)}V${y(v)}`; });
    const u = c.cum[c.cum.length - 1];
    s += `<path d="${d}" fill="none" stroke="${CORES[i]}" stroke-width="2.2" stroke-linejoin="round"/><circle cx="${x(u[0])}" cy="${y(u[1])}" r="3.5" fill="${CORES[i]}"/>`;
  });
  s += `<line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="#6B6F86"/></svg>`;
  // custo total
  const maxV = Math.max(...ok.map(([c]) => c.total + c.custos)), bw = v => Math.max(0, v / maxV * 290);
  let v = `<svg viewBox="0 0 ${W} ${O.length * 40}" role="img" aria-label="Custo total estimado">`;
  ok.forEach(([c, i]) => {
    const yy = i * 40; let xx = 0;
    v += `<text x="0" y="${yy + 10}" style="fill:#1B1E2E;font-weight:500">${esc(rot(i))}</text><rect x="0" y="${yy + 16}" width="${bw(c.P)}" height="14" fill="${CORES[i]}"/>`; xx += bw(c.P);
    if (c.incc > 1) { v += `<rect x="${xx}" y="${yy + 16}" width="${bw(c.incc)}" height="14" fill="${CORES[i]}" opacity=".42"/>`; xx += bw(c.incc); }
    v += `<rect x="${xx}" y="${yy + 16}" width="${bw(c.custos)}" height="14" fill="#C9C6BC"/>`; xx += bw(c.custos);
    v += `<text x="${xx + 8}" y="${yy + 27}" style="fill:#1B1E2E;font-weight:600">${brl(c.total + c.custos)}</text>`;
  });
  v += '</svg>';
  return `
    <div class="chart"><h4>Linha do tempo até as chaves</h4><p>Do ato até a entrega das chaves de cada opção.</p>${g}</div>
    <div class="chart"><h4>Quanto você paga até as chaves</h4><p>Ato, mensais e reforços somados mês a mês${S.prem.projetar ? ' (com INCC estimado)' : ', em valores de tabela'}, sem o financiamento.</p>${s}
      <div class="keyleg">${ok.map(([c, i]) => `<span><i style="background:${CORES[i]}"></i>${esc(rot(i))}: ${brl(c.obraC)}</span>`).join('')}</div></div>
    <div class="chart"><h4>Custo total estimado</h4><p>Preço de tabela${S.prem.projetar ? ' + INCC projetado' : ''} + ITBI e registro.</p>${v}
      <div class="keyleg"><span><i style="background:#1E2650"></i>Preço de tabela</span>${S.prem.projetar ? '<span><i style="background:#1E2650;opacity:.42"></i>INCC estimado</span>' : ''}<span><i style="background:#C9C6BC"></i>ITBI + registro</span></div></div>`;
}

/* HTML completo para a janela de impressão (e para o teste local) */
export function documentoCompleto(S, cartao) {
  const { pages } = montarDocumento(S, cartao);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Proposta ${esc(MARCAS[0].nome)} - ${esc(S.cliente.nome || 'cliente')}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap">
  <style>
    @page{size:540px 960px;margin:0}
    html,body{margin:0;background:#E7E5DF}
    .barra{position:sticky;top:0;z-index:9;display:flex;gap:8px;align-items:center;justify-content:center;padding:10px;background:#1E2650;font:13px Arial,sans-serif;color:#fff}
    .barra button{padding:8px 14px;border:0;border-radius:8px;background:#B8955A;color:#fff;font-weight:700;cursor:pointer}
    .barra button.sec{background:rgba(255,255,255,.15)}
    .barra span{opacity:.75}
    .folhas{display:flex;flex-direction:column;align-items:center;gap:18px;padding:18px 0 40px}
    .folhas .pg{box-shadow:0 8px 24px rgba(0,0,0,.15)}
    @media print{.barra{display:none}html,body{background:#fff}.folhas{display:block;padding:0}.folhas .pg{box-shadow:none;break-after:page;page-break-after:always}}
    ${docCSS()}
  </style></head><body>
  <div class="barra"><button onclick="window.print()">Salvar PDF</button><button class="sec" onclick="window.close()">Fechar</button>
    <span>No Chrome: Destino "Salvar como PDF" · Margens "Nenhuma" · marque "Gráficos de plano de fundo"</span></div>
  <div class="folhas ppd">${pages.map(p => p.html).join('')}</div></body></html>`;
}

/* ═══════════ TELA ═══════════ */
const TELA_CSS = `
.pp-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.pp-top .acts{display:flex;flex-wrap:wrap;gap:6px}
.pp-status{font-size:12px;color:var(--ink-muted)}
.pp-lista{margin-top:12px;display:none}.pp-lista.on{display:block}
.pp-lista table{width:100%;border-collapse:collapse;font-size:13px}
.pp-lista td,.pp-lista th{padding:8px 6px;border-bottom:1px solid var(--border);text-align:left}
.pp-lista th{font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em}
.pp-grid{display:grid;grid-template-columns:400px minmax(0,1fr);gap:14px;margin-top:12px;align-items:start}
@media(max-width:1000px){.pp-grid{grid-template-columns:minmax(0,1fr)}}
.pp-form{background:var(--bg-3);border-radius:10px;padding:6px 14px 14px;max-height:calc(100vh - 150px);overflow:auto;position:sticky;top:8px}
.pp-form details{border-bottom:1px solid var(--border)}
.pp-form summary{cursor:pointer;padding:11px 0;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink);list-style:none;display:flex;justify-content:space-between}
.pp-form summary::-webkit-details-marker{display:none}
.pp-form summary::after{content:"+";color:var(--psm-gold,#B8955A)}.pp-form details[open]>summary::after{content:"–"}
.pp-g{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-bottom:12px}
.pp-f{display:flex;flex-direction:column;gap:3px;min-width:0}.pp-f.full{grid-column:1/-1}
.pp-f label{font-size:11.5px;font-weight:600;color:var(--ink-muted)}
.pp-f input,.pp-f select,.pp-f textarea{width:100%;font-size:12.5px;padding:6px 8px}
.pp-f textarea{min-height:64px;resize:vertical;line-height:1.4}
.pp-f .chk{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--ink);padding:4px 0;font-weight:500}
.pp-f .chk input{width:auto}
.pp-dica{grid-column:1/-1;font-size:11px;color:var(--ink-muted);line-height:1.4}
.pp-sub{grid-column:1/-1;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--psm-gold,#B8955A);margin-top:6px}
.pp-tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.pp-tab{border:1px solid var(--border);background:var(--bg-2);color:var(--ink);border-radius:6px;padding:5px 9px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px}
.pp-tab i{width:9px;height:9px;border-radius:50%}
.pp-tab[aria-selected=true]{background:var(--psm-navy,#1E2650);color:#fff;border-color:var(--psm-navy,#1E2650)}
.pp-bar{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.pp-bar .btn{font-size:11.5px;padding:5px 9px}
.pp-soma{grid-column:1/-1;font-size:12px;padding:7px 9px;border-radius:6px;line-height:1.4}
.pp-soma.ok{background:rgba(47,125,91,.15);color:#3fae7d}.pp-soma.bad{background:rgba(200,60,60,.15);color:#e06b6b}
.pp-img{display:flex;align-items:center;gap:8px}
.pp-img .th{width:46px;height:46px;border-radius:6px;background:var(--bg-2) center/cover no-repeat;border:1px solid var(--border);flex:none}
.pp-img input[type=file]{font-size:11px;min-width:0;flex:1;padding:0}
.pp-thumbs{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.pp-thumbs span{width:48px;height:48px;border-radius:5px;background:center/cover no-repeat;position:relative;border:1px solid var(--border)}
.pp-thumbs button{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:0;background:#000;color:#fff;font-size:11px;line-height:18px;padding:0;cursor:pointer}
.pp-prev{background:#D9D6CE;border-radius:10px;padding:14px;overflow:auto;max-height:calc(100vh - 150px)}
.pp-prevbar{display:flex;gap:10px;align-items:center;font-size:12px;color:#444;margin-bottom:10px}
.pp-pages{display:flex;flex-wrap:wrap;gap:22px;zoom:var(--ppz,.5)}
.pp-pages figure{margin:0;display:flex;flex-direction:column;gap:6px}
.pp-pages figcaption{font-size:18px;color:#555;font-family:system-ui}
.pp-pages .pg{box-shadow:0 8px 22px rgba(20,25,57,.18)}
`;

let _root, _S, _cartao = {}, _modelos = [], _cur = 0, _me = {}, _tmrPrev, _tmrSave, _dirty = false, _salvando = false;

export async function pageProposta(ctx, root) {
  _root = root;
  _me = auth.user() || {};
  root.innerHTML = `<div class="card"><p class="card-sub">Carregando propostas…</p></div>`;
  const [rc, rm] = await Promise.all([
    api.request(EP + '?acao=cartao').catch(() => ({})),
    api.request(EP + '?acao=modelos').catch(() => ({})),
  ]);
  _cartao = Object.assign({ nome: _me.name || '', cargo: 'Consultor(a) imobiliário(a)', creci: '', whats: '', foto: '', bio: '',
    msg: 'Olá! Vi a proposta que você me enviou e quero conversar sobre as unidades.' }, (rc && rc.cartao) || {});
  _cartao.email = _me.email || _cartao.email || '';   // sempre o e-mail do login
  _modelos = (rm && rm.modelos) || [];
  _S = propostaVazia();
  const q = ctx && ctx.query || {};
  let ultima = null; try { ultima = JSON.parse(localStorage.getItem(LS_ULTIMA) || 'null'); } catch {}
  const abrir = q.id ? { id: q.id, owner: q.owner || _me.id } : ultima;
  if (abrir && abrir.id) await carregar(abrir.id, abrir.owner, true);
  desenharTela();
  const sair = () => { clearTimeout(_tmrSave); if (_dirty) salvar(true); };
  window.addEventListener('hashchange', sair, { once: true });
}

async function carregar(id, owner, silencioso) {
  try {
    const r = await api.request(`${EP}?acao=abrir&id=${encodeURIComponent(id)}&owner=${encodeURIComponent(owner || '')}`);
    if (r && r.proposta) { _S = Object.assign(propostaVazia(), r.proposta); _cur = 0; _dirty = false; lembrar(); return true; }
  } catch (e) { if (!silencioso) alert('Não consegui abrir: ' + e.message); }
  try { localStorage.removeItem(LS_ULTIMA); } catch {}
  return false;
}
function lembrar() { try { localStorage.setItem(LS_ULTIMA, JSON.stringify(_S.id ? { id: _S.id, owner: _S.owner } : null)); } catch {} }

function desenharTela() {
  _root.innerHTML = `<style>${TELA_CSS}${docCSS()}</style>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap">
  <div class="card">
    <div class="pp-top">
      <div><h2 class="card-title">📑 Apresentação comercial</h2><p class="card-sub">Até 4 opções, comparativo, fluxo com INCC do simulador oficial e o seu cartão. Sai em PDF pronto pro WhatsApp.</p></div>
      <div class="acts">
        <button class="btn btn-ghost" data-a="lista">📂 Minhas propostas</button>
        <button class="btn btn-ghost" data-a="nova">＋ Nova</button>
        <button class="btn btn-ghost" data-a="duplicar">⧉ Duplicar</button>
        <button class="btn btn-primary" data-a="salvar">💾 Salvar</button>
        <button class="btn btn-gold" data-a="pdf">📄 Gerar PDF</button>
      </div>
    </div>
    <div class="pp-status" id="ppStatus"></div>
    <div class="pp-lista" id="ppLista"></div>
    <div class="pp-grid">
      <div class="pp-form" id="ppForm"></div>
      <div class="pp-prev"><div class="pp-prevbar"><label for="ppZoom">Zoom</label><input id="ppZoom" type="range" min=".3" max="1" step=".01" value=".5"><span id="ppInfo"></span></div>
        <div class="pp-pages ppd" id="ppPages"></div></div>
    </div>
  </div>`;
  _root.querySelector('.pp-top').addEventListener('click', onTopo);
  _root.querySelector('#ppZoom').oninput = e => _root.querySelector('#ppPages').style.setProperty('--ppz', e.target.value);
  const form = _root.querySelector('#ppForm');
  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);
  form.addEventListener('click', onClick);
  desenharForm(); previa(); status();
}

function status(msg) {
  const el = _root && _root.querySelector('#ppStatus'); if (!el) return;
  el.textContent = msg || (_S.id ? (_dirty ? 'Alterações não salvas…' : `Salva · ${_S.cliente.nome || 'sem nome'}`) : 'Proposta nova, ainda não salva.');
}

/* ─── formulário ─── */
const F_GERAL = [
  ['Cliente', true, [['cliente.nome', 'Nome do cliente', 't'], ['cliente.objetivo', 'Objetivo', 's', [['morar', 'Morar'], ['investir', 'Investir'], ['ambos', 'Morar ou investir']]],
    ['cliente.data', 'Data da proposta', 'date'], ['cliente.validade', 'Validade (dias)', 'n'],
    ['cliente.abertura', 'Mensagem de abertura: cite o que o cliente valorizou nas visitas', 'ta']]],
  ['Meu cartão (última página)', false, [['_pend', '', 'pend'], ['c.nome', 'Nome e sobrenome', 't'], ['c.cargo', 'Cargo', 't'], ['c.whats', 'Seu WhatsApp', 't'], ['c.creci', 'CRECI (pessoa física)', 't'],
    ['c.bio', 'Bio: 1 ou 2 frases sobre você (aparece na última página)', 'ta'], ['c.msg', 'Mensagem que chega no seu WhatsApp', 'ta'], ['c.foto', 'Sua foto', 'img'],
    ['_email', '', 'dica'], ['_d', 'O cartão é seu: fica salvo e entra em todas as suas propostas.', 'dica']]],
  ['Premissas de cálculo', false, [['prem.projetar', 'Incluir a projeção do INCC (só quando o cliente pedir)', 'chk', 'full'], ['prem.incc', 'INCC projetado (% a.a.)', 'n'], ['prem.taxa', 'Juros do banco (% a.a.)', 'n'], ['prem.prazo', 'Prazo do financiamento (meses)', 'n'],
    ['prem.comp', 'Parcela até (% da renda)', 'n'], ['prem.itbi', 'ITBI (%)', 'n'], ['prem.cartorio', 'Escritura e registro (%)', 'n']]],
];
const F_OPCAO = [
  ['Empreendimento', [['empreendimento', 'Empreendimento', 't'], ['incorporadora', 'Incorporadora', 't'], ['status', 'Fase', 's', [['Lançamento', 'Lançamento'], ['Em obras', 'Em obras'], ['Pronto para morar', 'Pronto para morar']]],
    ['entrega', 'Entrega prevista', 'month'], ['endereco', 'Endereço / referência', 't', 'full']]],
  ['Unidade', [['unidade', 'Unidade', 't'], ['andar', 'Andar', 't'], ['tipologia', 'Tipologia (ex.: Studio)', 't'], ['area', 'Área privativa (m²)', 'n'], ['vagas', 'Vaga', 't'], ['vista', 'Vista', 't'],
    ['preco', 'Preço de tabela (R$)', 'n'], ['mobiliado', 'Entregue mobiliado', 'chk']]],
  ['Argumento de venda', [['perfil', 'Para quem é (1 frase)', 'ta'], ['destaques', 'Destaques (1 por linha, até 6)', 'ta'], ['aluguel', 'Aluguel estimado (R$/mês)', 'n'], ['condominio', 'Condomínio estimado (R$/mês)', 'n']]],
  ['Localização', [['pontos', 'Pontos próximos: nome | tempo (1 por linha)', 'ta']]],
  ['Fluxo de pagamento', [['f.inicio', 'Mês do ato', 'month'], ['f.chavesMes', 'Mês das chaves', 'month'], ['f.ato', 'Ato (%)', 'n'], ['f.chavesPct', 'Chaves / financiamento (%)', 'n'],
    ['f.mensaisPct', 'Mensais (% do total)', 'n'], ['f.mensaisN', 'Nº de mensais', 'n'], ['f.reforcosTipo', 'Reforços', 's', [['Anuais', 'Anuais (a cada 12 meses)'], ['Semestrais', 'Semestrais'], ['Balão', 'Balão (mês escolhido)']]],
    ['f.reforcosPct', 'Reforços (% do total)', 'n'], ['f.reforcosN', 'Nº de reforços', 'n'], ['f.balaoMes1', 'Mês do 1º balão', 'month'], ['f.balaoIntervalo', 'Meses entre balões', 'n'],
    ['f.semCorr', 'Parte do fluxo sem INCC (%)', 'n'], ['f.incc', 'Corrige pelo INCC até as chaves', 'chk'], ['f.extrato', 'Mostrar extrato mês a mês', 'chk'], ['_soma', '', 'soma'],
    ['_d', 'O cálculo é o do Simulador INCC. "Parte sem INCC" é a regra da incorporadora (em geral, o ato).', 'dica']]],
  ['Planos alternativos', [['alternativas', 'Título | observação | valor da parcela (1 por linha)', 'ta']]],
  ['Imagens', [['img.fachada', 'Fachada', 'img'], ['img.planta', 'Planta', 'img'], ['img.mapa', 'Mapa', 'img'], ['img.fotos', 'Fotos (até 6)', 'imgs']]],
];
function campo([k, rot, tipo, extra, extra2], escopo) {
  const id = `pp_${escopo}_${k.replace(/\W/g, '_')}`;
  const alvo = escopo === 'o' ? _S.opcoes[_cur] : escopo === 'c' ? _cartao : _S;
  const key = escopo === 'c' ? k.slice(2) : k;
  const val = getPath(alvo, key);
  const bind = `data-e="${escopo}" data-k="${key}"`;
  const full = (extra === 'full' || extra2 === 'full' || ['ta', 'img', 'imgs'].includes(tipo)) ? ' full' : '';
  if (tipo === 'dica') return `<div class="pp-dica">${k === '_email' ? `E-mail na proposta: <b>${esc(_cartao.email || '—')}</b> (o do seu login).` : rot}</div>`;
  if (tipo === 'pend') return `<div class="pp-soma bad" id="ppPend" hidden></div>`;
  if (tipo === 'soma') return `<div class="pp-soma" id="ppSoma"></div>`;
  if (tipo === 'chk') return `<div class="pp-f"><label class="chk"><input type="checkbox" id="${id}" ${bind} ${val ? 'checked' : ''}> ${rot}</label></div>`;
  if (tipo === 's') return `<div class="pp-f"><label for="${id}">${rot}</label><select id="${id}" ${bind}>${extra.map(([v, t]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  if (tipo === 'ta') return `<div class="pp-f full"><label for="${id}">${rot}</label><textarea id="${id}" ${bind}>${esc(val)}</textarea></div>`;
  if (tipo === 'img') return `<div class="pp-f full"><label for="${id}">${rot}</label><div class="pp-img"><span class="th" style="${val ? `background-image:url('${esc(abs(val))}')` : ''}"></span><input type="file" accept="image/*" id="${id}" data-up="${escopo}" data-k="${key}">${val ? `<button type="button" class="btn btn-ghost" data-limpa="${escopo}" data-k="${key}">Remover</button>` : ''}</div></div>`;
  if (tipo === 'imgs') return `<div class="pp-f full"><label for="${id}">${rot}</label><input type="file" accept="image/*" multiple id="${id}" data-fotos="1"><div class="pp-thumbs">${(val || []).map((u, j) => `<span style="background-image:url('${esc(abs(u))}')"><button type="button" data-rmfoto="${j}" aria-label="Remover foto">×</button></span>`).join('')}</div></div>`;
  const attrs = tipo === 'n' ? ATTR_NUM : `type="${tipo === 't' ? 'text' : tipo}"`;
  return `<div class="pp-f${full}"><label for="${id}">${rot}</label><input ${attrs} id="${id}" ${bind} value="${esc(tipo === 'n' ? numTxt(val) : val)}"></div>`;
}
function desenharForm() {
  const form = _root.querySelector('#ppForm');
  const aberto = {}; form.querySelectorAll('details').forEach(d => { aberto[d.dataset.id] = d.open; });
  const isOpen = (id, def) => id in aberto ? aberto[id] : def;
  const O = _S.opcoes, o = O[_cur];
  let h = F_GERAL.map(([t, def, fs]) => `<details data-id="${t}" ${isOpen(t, def) ? 'open' : ''}><summary>${t}</summary><div class="pp-g">${fs.map(f => campo(f, t.startsWith('Meu cartão') ? 'c' : 'g')).join('')}</div></details>`).join('');
  h += `<details data-id="opcoes" ${isOpen('opcoes', true) ? 'open' : ''}><summary>Opções (${O.length} de ${MAX_OPCOES})</summary>
    <div class="pp-tabs" role="tablist">${O.map((x, i) => `<button type="button" class="pp-tab" role="tab" aria-selected="${i === _cur}" data-tab="${i}"><i style="background:${CORES[i]}"></i>${i + 1}. ${esc(x.empreendimento || 'Nova opção')}${x.unidade ? ' ' + esc(x.unidade) : ''}</button>`).join('')}</div>
    <div class="pp-bar">
      <button type="button" class="btn btn-ghost" data-o="add" ${O.length >= MAX_OPCOES ? 'disabled' : ''}>＋ Opção</button>
      <button type="button" class="btn btn-ghost" data-o="dup" ${O.length >= MAX_OPCOES ? 'disabled' : ''}>⧉ Outra unidade</button>
      <button type="button" class="btn btn-ghost" data-o="esq" ${_cur === 0 ? 'disabled' : ''}>←</button>
      <button type="button" class="btn btn-ghost" data-o="dir" ${_cur === O.length - 1 ? 'disabled' : ''}>→</button>
      <button type="button" class="btn btn-ghost" data-o="del" ${O.length <= 1 ? 'disabled' : ''}>🗑 Excluir</button>
    </div>
    <div class="pp-g"><div class="pp-f full"><label for="ppModelo">📚 Biblioteca de empreendimentos</label>
      <select id="ppModelo"><option value="">Preencher com um empreendimento salvo…</option>${_modelos.map(m => `<option value="${esc(m.id)}" ${m.id === o.modeloId ? 'selected' : ''}>${esc(m.empreendimento)}${m.tipologia ? ' · ' + esc(m.tipologia) : ''}${m.unidade ? ' · un. ' + esc(m.unidade) : ''}</option>`).join('')}</select></div>
      <div class="pp-bar" style="grid-column:1/-1;margin:0"><button type="button" class="btn btn-ghost" data-o="modelo">📚 Salvar esta opção na biblioteca</button>
      ${o.modeloId ? `<button type="button" class="btn btn-ghost" data-o="modelo-del">Excluir da biblioteca</button>` : ''}</div></div>
    ${F_OPCAO.map(([t, fs]) => `<div class="pp-g"><div class="pp-sub">${t}</div>${fs.map(f => campo(f, 'o')).join('')}</div>`).join('')}
  </details>`;
  form.innerHTML = h;
  soma(); avisoCartao();
}
function soma() {
  const el = _root.querySelector('#ppSoma'); if (!el) return;
  const c = calcular(_S.opcoes[_cur], _S);
  const fechou = Math.abs(c.somaPct - 100) < 0.001;
  el.className = 'pp-soma ' + (fechou && c.ok && !c.avisos.length ? 'ok' : 'bad');
  el.innerHTML = !c.ok ? 'Preencha preço, mês do ato e mês das chaves.'
    : !fechou ? `O fluxo soma ${pct(c.somaPct)}. Ajuste até fechar 100%.`
    : `Fecha 100% · ato ${brl(c.ato)} · ${c.nMensais} mensais de ${brl(c.mensal)}${c.nRef ? ` · ${c.nRef}× ${brl(c.ref)}` : ''}${f_incc(c)}${c.avisos.length ? '<br>⚠ ' + c.avisos.map(esc).join('<br>⚠ ') : ''}`;
}
const f_incc = c => isFinite(c.incc) && c.incc > 0.5 ? ` · INCC estimado ${brl(c.incc)}` : '';

/* ─── cartão ─── */
// proposta de outro corretor (líder abrindo a do time) sai com o cartão de quem a fez
const minha = () => !_S.owner || String(_S.owner) === String(_me.id);
const cartaoDoc = () => (!minha() && _S.cartao) ? _S.cartao : _cartao;
function pendencias(c = _cartao) {
  const p = [];
  if (String(c.nome || '').trim().split(/\s+/).filter(Boolean).length < 2) p.push('use nome e sobrenome');
  if (digitos(c.whats).length < 10) p.push('informe seu WhatsApp com DDD');
  if (!c.foto) p.push('adicione sua foto');
  if (!String(c.bio || '').trim()) p.push('escreva sua bio');
  return p;
}
function avisoCartao() {
  const el = _root && _root.querySelector('#ppPend'); if (!el) return;
  const p = pendencias(); el.hidden = !p.length;
  el.textContent = p.length ? 'Falta no seu cartão: ' + p.join(' · ') + '.' : '';
}

/* ─── prévia ─── */
function previa() {
  const el = _root && _root.querySelector('#ppPages'); if (!el) return;
  const { pages } = montarDocumento(_S, cartaoDoc());
  el.innerHTML = pages.map(p => `<figure><figcaption>${esc(p.rot)}</figcaption>${p.html}</figure>`).join('');
  const info = _root.querySelector('#ppInfo'); if (info) info.textContent = `${pages.length} páginas · ${_S.opcoes.length} ${_S.opcoes.length === 1 ? 'opção' : 'opções'}`;
}
function mudou(cartao) {
  _dirty = true; status();
  clearTimeout(_tmrPrev); _tmrPrev = setTimeout(() => { previa(); soma(); }, 220);
  clearTimeout(_tmrSave); _tmrSave = setTimeout(() => { if (_S.cliente.nome) salvar(true); }, 4000);
  if (cartao) { avisoCartao(); clearTimeout(mudou._c); mudou._c = setTimeout(salvarCartao, 1500); }
}

/* ─── eventos ─── */
function alvoDe(e) { return e === 'o' ? _S.opcoes[_cur] : e === 'c' ? _cartao : _S; }
function onInput(ev) {
  const t = ev.target, e = t.dataset.e, k = t.dataset.k; if (!e || !k || t.type === 'file') return;
  setPath(alvoDe(e), k, t.type === 'checkbox' ? t.checked : t.value);
  if (e === 'o' && (k === 'empreendimento' || k === 'unidade')) {
    const tab = _root.querySelector(`[data-tab="${_cur}"]`); const o = _S.opcoes[_cur];
    if (tab) tab.lastChild.textContent = `${_cur + 1}. ${o.empreendimento || 'Nova opção'}${o.unidade ? ' ' + o.unidade : ''}`;
  }
  mudou(e === 'c');
}
async function onChange(ev) {
  const t = ev.target;
  if (t.id === 'ppModelo') { aplicarModelo(t.value); return; }
  if (t.dataset.up) {
    const f = t.files[0]; if (!f) return;
    const url = await subir(f, t.dataset.k === 'foto' ? 700 : 1600); if (!url) return;
    setPath(alvoDe(t.dataset.up), t.dataset.k, url);
    desenharForm(); previa(); mudou(t.dataset.up === 'c'); return;
  }
  if (t.dataset.fotos) {
    const o = _S.opcoes[_cur]; o.img.fotos = o.img.fotos || [];
    for (const f of [...t.files]) { if (o.img.fotos.length >= 6) break; const url = await subir(f, 1400); if (url) o.img.fotos.push(url); }
    desenharForm(); previa(); mudou(); return;
  }
  if (t.type === 'checkbox' || t.tagName === 'SELECT') onInput(ev);
}
function onClick(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  const O = _S.opcoes;
  if (b.dataset.tab != null) { _cur = +b.dataset.tab; desenharForm(); return; }
  if (b.dataset.limpa) { setPath(alvoDe(b.dataset.limpa), b.dataset.k, ''); desenharForm(); previa(); mudou(b.dataset.limpa === 'c'); return; }
  if (b.dataset.rmfoto != null) { O[_cur].img.fotos.splice(+b.dataset.rmfoto, 1); desenharForm(); previa(); mudou(); return; }
  const a = b.dataset.o; if (!a) return;
  if (a === 'add' && O.length < MAX_OPCOES) { O.push(opcaoVazia(String(_S.cliente.data || '').slice(0, 7))); _cur = O.length - 1; }
  else if (a === 'dup' && O.length < MAX_OPCOES) { const n = structuredClone(O[_cur]); n.unidade = ''; O.splice(_cur + 1, 0, n); _cur++; }
  else if (a === 'esq' && _cur > 0) { [O[_cur - 1], O[_cur]] = [O[_cur], O[_cur - 1]]; _cur--; }
  else if (a === 'dir' && _cur < O.length - 1) { [O[_cur + 1], O[_cur]] = [O[_cur], O[_cur + 1]]; _cur++; }
  else if (a === 'del' && O.length > 1) { if (!confirm(`Excluir a opção ${_cur + 1} (${O[_cur].empreendimento || 'sem nome'}) desta proposta?`)) return; O.splice(_cur, 1); _cur = Math.max(0, _cur - 1); }
  else if (a === 'modelo') { salvarModelo(); return; }
  else if (a === 'modelo-del') { excluirModelo(); return; }
  else return;
  desenharForm(); previa(); mudou();
}
async function onTopo(ev) {
  const b = ev.target.closest('button'); if (!b || !b.dataset.a) return;
  const a = b.dataset.a;
  if (a === 'pdf') return gerarPDF();
  if (a === 'salvar') return salvar(false);
  if (a === 'lista') return lista();
  if (a === 'nova') { if (_dirty && _S.cliente.nome) await salvar(true); _S = propostaVazia(); _cur = 0; _dirty = false; lembrar(); desenharForm(); previa(); status(); return; }
  if (a === 'duplicar') { if (_dirty && _S.id) await salvar(true); _S = structuredClone(_S); _S.id = ''; _S.owner = ''; _S.cliente = { ..._S.cliente, nome: '', abertura: '', data: hojeISO() }; _cur = 0; _dirty = false; desenharForm(); previa(); status('Cópia criada: troque o cliente e salve.'); }
}

/* ─── servidor ─── */
async function salvar(auto) {
  if (_salvando) return;
  if (!_S.cliente.nome) { if (!auto) alert('Preencha o nome do cliente antes de salvar.'); return; }
  _salvando = true; clearTimeout(_tmrSave);
  try {
    if (minha()) _S.cartao = { ..._cartao };
    const r = await api.request(EP, { method: 'POST', body: { acao: 'salvar', proposta: _S } });
    _S.id = r.id; _S.owner = r.owner; _dirty = false; lembrar();
    status(auto ? `Salva automaticamente às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Proposta salva.');
  } catch (e) { status('⚠ Não salvou: ' + e.message); if (!auto) alert('Não consegui salvar: ' + e.message); }
  finally { _salvando = false; }
}
async function salvarCartao() {
  try { const r = await api.request(EP, { method: 'POST', body: { acao: 'cartao', cartao: _cartao } }); if (r && r.cartao) _cartao = r.cartao; }
  catch (e) { status('⚠ Cartão não salvou: ' + e.message); }
}
async function subir(file, max) {
  status(`Enviando ${file.name}…`);
  try {
    const dataUrl = await reduzir(file, max);
    const nome = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    const r = await api.request(EP, { method: 'POST', body: { acao: 'upload', filename: nome, content_b64: dataUrl } });
    status('Imagem enviada.'); return r.url;
  } catch (e) { status('⚠ Imagem não subiu: ' + e.message); alert('Não consegui enviar a imagem: ' + e.message); return ''; }
}
function reduzir(file, max) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const im = new Image(); im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
      res(cv.toDataURL('image/jpeg', .84)); }; im.onerror = rej; im.src = fr.result; };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}
async function lista() {
  const box = _root.querySelector('#ppLista');
  if (box.classList.toggle('on') === false) return;
  const time = (_me.lvl || 0) >= 5;
  box.innerHTML = '<p class="card-sub">Carregando…</p>';
  const ver = async todos => {
    try {
      const r = await api.request(`${EP}?acao=listar${todos ? '&todos=1' : ''}`);
      const ps = r.propostas || [];
      box.innerHTML = `${time ? `<label class="pp-status" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input type="checkbox" id="ppTodos" ${todos ? 'checked' : ''}> Ver as propostas do time</label>` : ''}
        ${ps.length ? `<table><thead><tr><th>Cliente</th><th>Opções</th>${todos ? '<th>Corretor</th>' : ''}<th>Atualizada</th><th></th></tr></thead><tbody>
        ${ps.map(p => `<tr><td><b>${esc(p.cliente || 'sem nome')}</b></td><td>${p.opcoes.map(o => esc(o.empreendimento) + (o.unidade ? ' ' + esc(o.unidade) : '')).join(' · ')}</td>${todos ? `<td>${esc(p.owner_nome || '')}</td>` : ''}
          <td>${p.updated_at ? new Date(p.updated_at).toLocaleDateString('pt-BR') : ''}</td>
          <td style="white-space:nowrap"><button class="btn btn-ghost" data-abre="${esc(p.id)}" data-owner="${esc(p.owner)}">Abrir</button> <button class="btn btn-ghost" data-apaga="${esc(p.id)}" data-owner="${esc(p.owner)}" data-nome="${esc(p.cliente)}">🗑</button></td></tr>`).join('')}
        </tbody></table>` : '<p class="card-sub">Nenhuma proposta salva ainda. Monte a primeira abaixo e clique em Salvar.</p>'}`;
      const td = box.querySelector('#ppTodos'); if (td) td.onchange = () => ver(td.checked);
      box.querySelectorAll('[data-abre]').forEach(b => b.onclick = async () => { if (_dirty && _S.cliente.nome) await salvar(true); if (await carregar(b.dataset.abre, b.dataset.owner)) { box.classList.remove('on'); desenharForm(); previa(); status(); } });
      box.querySelectorAll('[data-apaga]').forEach(b => b.onclick = async () => {
        if (!confirm(`Excluir a proposta de ${b.dataset.nome || 'sem nome'}? Não dá para desfazer.`)) return;
        try { await api.request(EP, { method: 'POST', body: { acao: 'excluir', id: b.dataset.apaga, owner: b.dataset.owner } }); if (_S.id === b.dataset.apaga) { _S = propostaVazia(); _dirty = false; lembrar(); desenharForm(); previa(); status(); } ver(todos); }
        catch (e) { alert('Não consegui excluir: ' + e.message); }
      });
    } catch (e) { box.innerHTML = `<p class="card-sub">⚠ ${esc(e.message)}</p>`; }
  };
  ver(false);
}
function aplicarModelo(id) {
  const m = _modelos.find(x => x.id === id); if (!m) return;
  const o = _S.opcoes[_cur];
  const preenchida = o.empreendimento || o.preco;
  if (preenchida && !confirm(`Substituir os dados da opção ${_cur + 1} pelos de "${m.empreendimento}"?`)) { desenharForm(); return; }
  const n = opcaoVazia(String(_S.cliente.data || '').slice(0, 7));
  CAMPOS_MODELO.forEach(k => { if (m[k] !== undefined) n[k] = structuredClone(m[k]); });
  n.modeloId = m.id;
  _S.opcoes[_cur] = n; desenharForm(); previa(); mudou();
}
async function salvarModelo() {
  const o = _S.opcoes[_cur];
  if (!o.empreendimento) { alert('Dê um nome ao empreendimento antes de salvar na biblioteca.'); return; }
  const existente = _modelos.find(x => x.id === o.modeloId);
  const atualizar = existente && confirm(`Atualizar "${existente.empreendimento}" na biblioteca com os dados desta opção?\n\nOK = atualizar · Cancelar = salvar como novo`);
  const modelo = { id: atualizar ? existente.id : '' };
  CAMPOS_MODELO.forEach(k => { modelo[k] = structuredClone(o[k]); });
  modelo.tipologia = o.tipologia;
  try {
    const r = await api.request(EP, { method: 'POST', body: { acao: 'modelo_salvar', modelo } });
    _modelos = [..._modelos.filter(x => x.id !== r.modelo.id), r.modelo].sort((a, b) => a.empreendimento.localeCompare(b.empreendimento));
    o.modeloId = r.modelo.id; desenharForm(); mudou();
    status(`"${o.empreendimento}" salvo na biblioteca: o time já pode usar.`);
  } catch (e) { alert('Não consegui salvar na biblioteca: ' + e.message); }
}
async function excluirModelo() {
  const o = _S.opcoes[_cur], m = _modelos.find(x => x.id === o.modeloId); if (!m) return;
  if (!confirm(`Tirar "${m.empreendimento}" da biblioteca do time? As propostas já feitas não mudam.`)) return;
  try { await api.request(EP, { method: 'POST', body: { acao: 'modelo_excluir', id: m.id } }); _modelos = _modelos.filter(x => x.id !== m.id); o.modeloId = ''; desenharForm(); status('Removido da biblioteca.'); }
  catch (e) { alert('Não consegui excluir: ' + e.message); }
}
function gerarPDF() {
  const falta = minha() ? pendencias() : [];
  if (falta.length && !confirm(`Seu cartão da última página está incompleto:\n- ${falta.join('\n- ')}\n\nGerar o PDF mesmo assim?`)) return;
  if (_dirty && _S.cliente.nome) salvar(true);
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela. Libere pop-ups para gerar o PDF.'); return; }
  w.document.write(documentoCompleto(_S, cartaoDoc()));
  w.document.close();
}
