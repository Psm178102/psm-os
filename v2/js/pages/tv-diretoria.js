/* ============================================================================
   PSM-OS v2 — 📺 TV DIRETORIA (v88.88 — centro de comando em 5 telas)
   Segunda tela em tempo real do Paulo e da Isa (SÓ SÓCIO, lvl 10).

   Linguagem pedida pelo Paulo (referências Pinterest, 27/set): fundo preto, neon
   com brilho, alta densidade. 5 telas que giram sozinhas a cada 45s (clique numa
   aba fixa; teclas 1–5, ← →, espaço liga/desliga o giro):
     1 Visão geral — KPIs, VGV no ano, funil, pipeline, ranking, pilares, conta cheia
     2 Comercial   — placar por equipe (funil + projeção), hoje (plantão/visitas),
                     perdas e motivos, resposta/conversão por marca, carteira em risco
     3 Mídia→Venda — a mídia vira venda? corrente R$ → lead → atendido → visita →
                     venda → VGV por marca; vazamentos de REGIÃO (lead fora da praça)
                     e VELOCIDADE (1º contato); qual canal vende de verdade
     4 Financeiro  — caixa HUB, recebíveis (recebido/previsto/travado), caixa 10
                     semanas com furo, Plano de Resgate, vencidos, equilíbrio por frente
     5 Pilares     — os 10 placares do Farol PSM com TODOS os indicadores
   Nada é recalculado aqui — só lido dos motores oficiais. Cada fonte tem validade
   própria e só é buscada quando a tela dela está à mostra (banco frágil).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { icon } from '../icons.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const ROT_MS = 45000, TICK_MS = 20000;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// cor por FRENTE (identidade da marca): Conquista laranja, PSM Imóveis/MAP creme, Locação violeta, Terceiros turquesa
const FRENTE_COR = { conquista: '#ff8a1f', map: '#f3ebcb', imoveis: '#f3ebcb', locacao: '#a78bfa', locacoes: '#a78bfa', terceiros: '#2ee6c5' };
const FRENTE_NOME = { conquista: 'PSM Conquista', map: 'MAP · PSM Imóveis', imoveis: 'PSM Imóveis', terceiros: 'Terceiros', locacao: 'Locação', locacoes: 'Locação' };
const CAT = ['#9ef01a', '#ffd23f', '#ff8a1f', '#ff5c5c', '#a78bfa', '#2ee6c5', '#f3ebcb'];

// As telas da TV (giram sozinhas a cada 45s; 1–5 / ← → no teclado; clique fixa)
const TELAS = [
  { id: 'geral',      lbl: 'Visão geral', ico: 'gauge' },
  { id: 'comercial',  lbl: 'Comercial',   ico: 'handshake' },
  { id: 'marketing',  lbl: 'Mídia → Venda', ico: 'megaphone' },
  { id: 'financeiro', lbl: 'Financeiro',  ico: 'wallet' },
  { id: 'pilares',    lbl: 'Pilares',     ico: 'shield' },
];

// Fontes: URL, validade (s) e em quais telas são usadas ('*' = sempre).
// Carrega SÓ o que a tela à mostra precisa (+ a próxima, pouco antes da troca) — banco frágil.
// arena/tv varre todos os negócios SEM cache: 5 min, nunca menos.
const FONTES = {
  arena:     { url: () => '/api/v3/arena/live', ttl: 20, telas: '*' },
  overview:  { url: () => '/api/v3/metrics/overview', ttl: 60, telas: '*' },
  pjMes:     { url: () => '/api/v3/metricas/projecao?h=mes', ttl: 60, telas: '*' },
  recados:   { url: () => '/api/v3/diretoria/recados', ttl: 120, telas: '*' },
  scorecard: { url: D => '/api/v3/diretoria/scorecard?ym=' + D.ym, ttl: 300, telas: '*' },
  metas:     { url: D => '/api/v3/metas/atingimento?ano=' + D.ano, ttl: 300, telas: '*' },
  tv:        { url: () => '/api/v3/arena/tv', ttl: 300, telas: '*' },
  users:     { url: () => '/api/v3/users/list', ttl: 900, telas: '*' },
  tasks:     { url: () => '/api/v3/tasks/list', ttl: 60, telas: ['geral'] },
  uso:       { url: () => '/api/v3/checkin/uso?dias=1', ttl: 60, telas: ['geral'] },
  hist:      { url: () => '/api/v3/diretoria/scorecard?hist=12', ttl: 900, telas: ['geral', 'pilares'] },
  decisoes:  { url: () => '/api/v3/metricas/decisoes?tela=sala', ttl: 300, telas: ['geral'] },
  hubPainel: { url: () => '/api/v3/psmhub/financeiro?secao=painel', ttl: 300, telas: ['geral', 'financeiro'] },
  hubContas: { url: () => '/api/v3/psmhub/financeiro?secao=contas', ttl: 300, telas: ['geral', 'financeiro'] },
  resumo:    { url: () => '/api/v3/metricas/resumo?preset=this_month', ttl: 300, telas: ['comercial'] },
  crm:       { url: () => '/api/v3/marketing/crm_metrics?date_preset=this_month', ttl: 600, telas: ['comercial', 'marketing'] },
  oo:        { url: () => '/api/v3/oo/overview?date_preset=this_month', ttl: 300, telas: ['comercial'] },
  mkt:       { url: () => '/api/v3/marketing/summary?date_preset=this_month', ttl: 600, telas: ['marketing'] },
  geo:       { url: () => '/api/v3/marketing/leads_geo?date_preset=this_month', ttl: 1800, telas: ['marketing'] },   // varre os deals do mês sem cache: 30 min
  adsTh:     { url: () => '/api/v3/marketing/ads_thresholds', ttl: 3600, telas: ['marketing'] },
  planoAds:  { url: () => '/api/v3/diretoria/plano_ads', ttl: 900, telas: ['marketing'] },
  caixa:     { url: D => '/api/v3/diretoria/caixa?ym=' + D.ym, ttl: 900, telas: ['financeiro'] },
  receb:     { url: () => '/api/v3/diretoria/recebiveis', ttl: 600, telas: ['financeiro'] },
  resgate:   { url: () => '/api/v3/diretoria/plano_resgate', ttl: 900, telas: ['financeiro'] },
  locdash:   { url: () => '/api/v3/locacoes/dash', ttl: 900, telas: ['pilares'] },
};

let _root = null;
const _d = {}, _at = {}, _voando = {};
let _timers = [];
let _tela = 0, _auto = true, _trocaEm = 0;
let _lastSaleTs = null, _celebra = null, _celebTimer = null;
let _uid = 0;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const nn = v => (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
const brl = n => { const v = Math.round(Number(n || 0)); return (v < 0 ? '−R$ ' : 'R$ ') + Math.abs(v).toLocaleString('pt-BR'); };
const eixo = n => n >= 1e6 ? `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : n >= 1e3 ? `R$ ${Math.round(n / 1e3)} mil` : `R$ ${Math.round(n)}`;   // só rótulo de EIXO
const int = n => Math.round(Number(n || 0)).toLocaleString('pt-BR');
const pct = n => n == null ? '—' : `${Math.round(n)}%`;
const hhmm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ic = (n, s = 16) => icon(n, { size: s });
const primeiro = n => String(n || '').split(' ')[0];
const uid = p => `${p}${++_uid}`;

const EST = {
  ok:   { c: 'var(--n-ok)',   i: 'circle-check',   w: 'no ritmo' },
  warn: { c: 'var(--n-warn)', i: 'triangle-alert', w: 'atenção' },
  bad:  { c: 'var(--n-bad)',  i: 'octagon-x',      w: 'crítico' },
  mute: { c: 'var(--n-mute)', i: 'circle-dot',     w: 'sem dado' },
};
const farolEst = f => ({ verde: 'ok', amarelo: 'warn', vermelho: 'bad' }[f] || 'mute');
const saudeEst = s => s == null ? 'mute' : s >= 80 ? 'ok' : s >= 55 ? 'warn' : 'bad';

function datas() {
  const h = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const dia = h.getDate();
  return { h, dia, mes: h.getMonth() + 1, ano: h.getFullYear(),
    ym: `${h.getFullYear()}-${p2(h.getMonth() + 1)}`, iso: `${h.getFullYear()}-${p2(h.getMonth() + 1)}-${p2(dia)}`,
    mesNome: h.toLocaleDateString('pt-BR', { month: 'long' }),
    longa: h.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
}

/* ─────────────────────────── CICLO DE VIDA ─────────────────────────── */
export async function pageTVDiretoria(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 10) { root.innerHTML = '<div class="alert alert-warn">🔒 A TV Diretoria é restrita aos Sócios.</div>'; return; }
  document.body.classList.add('tv-mode');
  enableWakeLock(() => {});
  Object.keys(_d).forEach(k => delete _d[k]); Object.keys(_at).forEach(k => delete _at[k]);
  _lastSaleTs = null; _celebra = null;
  const pedida = TELAS.findIndex(t => t.id === ctx?.query?.tela);
  try { _tela = pedida >= 0 ? pedida : Math.max(0, TELAS.findIndex(t => t.id === localStorage.getItem('tvd.tela'))); } catch { _tela = Math.max(0, pedida); }
  try { _auto = localStorage.getItem('tvd.auto') !== '0'; } catch { _auto = true; }
  _trocaEm = Date.now() + ROT_MS;
  shell();
  carregar(true);
  _timers = [
    setInterval(() => carregar(false), TICK_MS),
    setInterval(relogio, 1000),
    setInterval(() => { if (_auto && !_celebra && Date.now() >= _trocaEm) irPara(_tela + 1, true); }, 1000),
  ];
  document.addEventListener('visibilitychange', aoVoltar);
  document.addEventListener('keydown', teclas);
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  document.body.classList.remove('tv-mode');
  _timers.forEach(t => clearInterval(t)); _timers = [];
  if (_celebTimer) clearTimeout(_celebTimer);
  document.removeEventListener('visibilitychange', aoVoltar);
  document.removeEventListener('keydown', teclas);
  disableWakeLock();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function aoVoltar() { if (!document.hidden) carregar(false); }

function teclas(e) {
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') irPara(_tela + 1);
  else if (e.key === 'ArrowLeft') irPara(_tela - 1);
  else if (/^[1-9]$/.test(e.key) && +e.key <= TELAS.length) irPara(+e.key - 1);
  else if (e.key === ' ') { _auto = !_auto; salvarPref(); _trocaEm = Date.now() + ROT_MS; abas(); e.preventDefault(); }
}

function salvarPref() { try { localStorage.setItem('tvd.tela', TELAS[_tela].id); localStorage.setItem('tvd.auto', _auto ? '1' : '0'); } catch {} }

// troca de tela: automática (rotação) mantém o auto; manual (clique/tecla) fixa a tela
function irPara(i, automatico) {
  _tela = (i + TELAS.length) % TELAS.length;
  if (!automatico) _auto = false;
  _trocaEm = Date.now() + ROT_MS;
  salvarPref();
  montarTela();
  carregar(false);
}

/* ─────────────────────────── DADOS ─────────────────────────── */
function precisa(k, id) { const t = FONTES[k].telas; return t === '*' || t.includes(id); }

async function buscar(k) {
  if (_voando[k]) return;
  _voando[k] = true;
  try { _d[k] = await api.request(FONTES[k].url(datas())); _at[k] = Date.now(); }
  catch (e) { if (!_d[k] || _d[k]._err) _d[k] = { _err: e.message || 'erro' }; _at[k] = Date.now(); }   // falha passageira mantém o último dado bom
  finally { _voando[k] = false; }
}

async function carregar(forcar) {
  if (document.hidden && _d.overview && !forcar) return;
  const agora = Date.now(), atual = TELAS[_tela].id;
  const proxima = TELAS[(_tela + 1) % TELAS.length].id;
  const chaves = Object.keys(FONTES).filter(k => {
    const venceu = !_at[k] || agora - _at[k] > FONTES[k].ttl * 1000;
    if (precisa(k, atual)) return venceu;
    // pré-carrega a próxima tela ~15s antes da troca (só o que ainda não tem)
    return _auto && _trocaEm - agora < 16000 && precisa(k, proxima) && !_at[k];
  });
  if (!chaves.length) return;
  await Promise.all(chaves.map(k => buscar(k).then(() => { if (precisa(k, TELAS[_tela].id)) pintarTela(); })));
  if (chaves.includes('arena')) checaVenda();
  pintarGlobal();
}

function checaVenda() {
  const v = ((_d.arena && _d.arena.events) || []).find(e => e.type === 'venda');
  if (v && _lastSaleTs != null && v.ts > _lastSaleTs) {
    _celebra = v;
    try { window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' })); } catch {}
    if (_celebTimer) clearTimeout(_celebTimer);
    _celebTimer = setTimeout(() => { _celebra = null; celebracao(); }, 12000);
    ['overview', 'pjMes', 'metas'].forEach(k => { _at[k] = 0; });   // venda muda o placar: busca de novo
    carregar(false);
  }
  if (v) _lastSaleTs = v.ts; else if (_lastSaleTs == null) _lastSaleTs = '';
  celebracao();
}

const ok = k => _d[k] && !_d[k]._err ? _d[k] : null;
function nome(id) { const u = ((ok('users') || {}).users || []).find(x => x.id === id); return u ? u.name : null; }
function ind(id) {
  for (const s of (ok('scorecard') || {}).scorecards || []) for (const i of s.indicadores || []) if (i.id === id) return i;
  return null;
}
function serieInd(id) {   // valores dos últimos 12 meses (histórico do Farol), mês corrente = leitura ao vivo
  const h = ok('hist'); const s = (h?.series?.[id] || []).map(x => nn(x && x[0]));
  const atual = ind(id); if (s.length && atual) s[s.length - 1] = nn(atual.valor);
  return s;
}
function serieAno() {
  const m = ok('metas'); if (!m || !Array.isArray(m.grid)) return null;
  const s = Array.from({ length: 12 }, () => ({ real: 0, meta: 0 }));
  for (const g of m.grid) for (const c of g.cells || []) {
    const i = (c.mes || 0) - 1; if (i < 0 || i > 11) continue;
    s[i].real += num(c.atingido_vgv); s[i].meta += num(c.meta_vgv);
  }
  for (const [k, v] of Object.entries(m.fora_do_grid_mensal || {})) { const i = +k - 1; if (s[i]) s[i].real += num(v.vgv); }
  return s;
}

/* ─────────────────────────── SVG: peças ─────────────────────────── */
function spark(vals, cor) {
  const v = vals.map(nn); const pts = v.map((y, i) => [i, y]).filter(p => p[1] != null);
  if (pts.length < 2) return '<div class="spark-empty"></div>';
  const W = 120, H = 34, xs = W / (v.length - 1);
  const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])), rg = hi - lo || 1;
  const P = pts.map(([i, y]) => [i * xs, H - 3 - (y - lo) / rg * (H - 8)]);
  const line = P.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const g = uid('sg');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cor}" stop-opacity=".45"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line}L${P[P.length - 1][0]},${H}L${P[0][0]},${H}Z" fill="url(#${g})"/>
    <path d="${line}" fill="none" stroke="${cor}" stroke-width="1.8" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 4px ${cor})"/></svg>`;
}

function donut(segs, centro, sub) {
  const tot = segs.reduce((a, s) => a + s.v, 0) || 1;
  const R = 70, C = 2 * Math.PI * R; let acc = 0;
  const gap = segs.length > 1 ? 3 : 0;
  const arcs = segs.map(s => {
    const len = Math.max(0, s.v / tot * C - gap);
    const a = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${s.c}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 90 90)" style="filter:drop-shadow(0 0 5px ${s.c})"><title>${esc(s.l)}: ${brl(s.v)} (${pct(s.v / tot * 100)})</title></circle>`;
    acc += s.v / tot * C; return a;
  }).join('');
  return `<svg class="donut" viewBox="0 0 180 180"><circle r="${R}" cx="90" cy="90" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="20"/>${arcs}
    <text x="90" y="84" text-anchor="middle" class="dc-s">${esc(sub)}</text><text x="90" y="106" text-anchor="middle" class="dc-v">${esc(centro)}</text></svg>`;
}

function gauge(v, farolK) {   // semicírculo 0–150%, marca em 100%
  const max = 150, val = Math.max(0, Math.min(max, v ?? 0));
  const R = 80, cx = 100, cy = 96, L = Math.PI * R;
  const f = val / max, a = Math.PI * (1 - 100 / max);
  const cor = { ok: '#9ef01a', warn: '#ffb020', bad: '#ff5c5c', mute: '#7b8378' }[farolK];
  return `<svg class="gauge" viewBox="0 0 200 112">
    <path d="M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="16" stroke-linecap="round"/>
    <path d="M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}" fill="none" stroke="${cor}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${f * L} ${L}" style="filter:drop-shadow(0 0 7px ${cor})" class="g-arc"/>
    <line x1="${cx + (R - 13) * Math.cos(a)}" y1="${cy - (R - 13) * Math.sin(a)}" x2="${cx + (R + 13) * Math.cos(a)}" y2="${cy - (R + 13) * Math.sin(a)}" stroke="#fff" stroke-width="2.5"/>
    <text x="${cx + (R + 16) * Math.cos(a)}" y="${cy - (R + 16) * Math.sin(a)}" class="g-m">100%</text>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="g-v" style="fill:${cor}">${v == null ? '—' : pct(v)}</text></svg>`;
}

/* ─────────────────────────── SHELL + ABAS ─────────────────────────── */
const PANEL = (id, cls = '') => `<section class="pn ${cls}" id="${id}"></section>`;
function shell() {
  _root.innerHTML = `
    <style>${CSS}</style>
    <div class="tvd" id="tvd">
      <header class="hd">
        <div class="logo"><span class="lg">PSM</span><span class="lg-s">holding</span></div>
        <div class="ttl"><h1>Painel da Diretoria</h1><p>Todos os pilares, ao vivo · <span id="tvd-stamp">conectando…</span></p></div>
        <div class="chips">
          <span class="chip dt">${ic('calendar', 15)}<span id="tvd-data"></span></span>
          <span class="chip live"><i></i>Ao vivo</span>
          <span class="chip clk" id="tvd-clk"></span>
          <button class="chip btn" id="tvd-full" title="tela cheia">${ic('maximize', 15)}</button>
          <button class="chip btn" id="tvd-rel" title="atualizar agora">${ic('refresh-cw', 15)}</button>
          <a class="chip btn" href="#/cockpit" title="sair">${ic('x', 15)}</a>
        </div>
      </header>
      <nav class="tabs" id="tvd-tabs"></nav>
      <div id="tvd-rec"></div>
      <main class="body" id="tvd-body"></main>
      <footer class="ins" id="tvd-ins"></footer>
      <div id="tvd-cel"></div>
    </div>`;
  document.getElementById('tvd-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  document.getElementById('tvd-rel').onclick = () => { Object.keys(_at).forEach(k => { if (precisa(k, TELAS[_tela].id)) _at[k] = 0; }); carregar(true); };
  relogio();
  montarTela();
}

function abas() {
  const el = document.getElementById('tvd-tabs'); if (!el) return;
  el.innerHTML = TELAS.map((t, i) => `<button class="tab${i === _tela ? ' on' : ''}" data-tela="${i}"><span class="tn">${i + 1}</span>${ic(t.ico, 15)}${t.lbl}${i === _tela && _auto ? `<i class="prog" style="animation-duration:${Math.max(1, _trocaEm - Date.now())}ms"></i>` : ''}</button>`).join('') +
    `<button class="tab auto${_auto ? ' on' : ''}" id="tvd-auto" title="troca automática (barra de espaço)">${ic(_auto ? 'refresh-cw' : 'circle-dot', 14)}${_auto ? 'girando a cada 45s' : 'tela fixa · clique p/ girar'}</button>`;
  el.querySelectorAll('[data-tela]').forEach(b => b.onclick = () => irPara(+b.dataset.tela));
  document.getElementById('tvd-auto').onclick = () => { _auto = !_auto; _trocaEm = Date.now() + ROT_MS; salvarPref(); abas(); };
}

// esqueleto de cada tela (os painéis se preenchem sozinhos conforme os dados chegam)
const ESQ = {
  geral: () => `<div class="kpis" id="tvd-kpis"></div>
    <div class="g2">${PANEL('p-ano', 'c-ano')}${PANEL('p-fun', 'c-fun')}${PANEL('p-pipe', 'c-pipe')}</div>
    <div class="g3">${PANEL('p-rank', 'c-rank')}${PANEL('p-pil', 'c-pil')}${PANEL('p-cx', 'c-cx')}<div class="stack">${PANEL('p-act', 'c-act')}${PANEL('p-viv', 'c-viv')}</div></div>`,
  comercial: () => `<div class="eq4" id="c-eq"></div>
    <div class="gc">${PANEL('c-hoje')}${PANEL('c-perdas')}${PANEL('c-marcas')}${PANEL('c-risco')}</div>`,
  marketing: () => `<div class="kpis" id="m-kpis"></div>
    <div class="gm1">${PANEL('m-flow')}</div>
    <div class="gm2">${PANEL('m-reg')}${PANEL('m-vel')}${PANEL('m-can')}</div>`,
  financeiro: () => `<div class="kpis" id="f-kpis"></div>
    <div class="gf1">${PANEL('f-caixa')}${PANEL('f-resg')}</div>
    <div class="gf2">${PANEL('f-trav')}${PANEL('f-prox')}${PANEL('f-contas')}${PANEL('f-be')}</div>`,
  pilares: () => `<div class="gp" id="p-all"></div>`,
};

function montarTela() {
  const body = document.getElementById('tvd-body'); if (!body) return;
  const t = TELAS[_tela].id;
  const tvd = document.getElementById('tvd');
  tvd.classList.remove('calmo'); tvd.dataset.tela = t;
  clearTimeout(montarTela._t); montarTela._t = setTimeout(() => tvd.classList.add('calmo'), 3500);   // anima só na entrada da tela
  body.innerHTML = ESQ[t]();
  abas();
  pintarTela();
  pintarGlobal();
}

function pintarTela() {
  if (!document.getElementById('tvd-body')) return;
  _uid = 0;
  const t = TELAS[_tela].id;
  if (t === 'geral') { kpis(); pAno(); pFunil(); pPipe(); pRank(); pPilares(); pCaixa(); pAcao(); pVivo(); }
  else if (t === 'comercial') { cEquipes(); cHoje(); cPerdas(); cMarcas(); cRisco(); }
  else if (t === 'marketing') { mKpis(); mCorrente(); mRegiao(); mVelocidade(); mCanais(); }
  else if (t === 'financeiro') { fKpis(); fCaixa(); fResgate(); fTravados(); fProximos(); fContas(); fBreakeven(); }
  else if (t === 'pilares') pTodos();
}

function pintarGlobal() {
  if (!document.getElementById('tvd')) return;
  insights(); recados(); celebracao();
  if (TELAS[_tela].id === 'geral') { pVivo(); }
  const st = document.getElementById('tvd-stamp'), ov = ok('overview');
  if (st) st.textContent = ov && ov.dados_de_hhmm ? `RD sincronizado às ${ov.dados_de_hhmm}` : 'carregando…';
}

function relogio() {
  const D = datas();
  const c = document.getElementById('tvd-clk'); if (c) c.textContent = hhmm(D.h);
  const d = document.getElementById('tvd-data'); if (d) d.textContent = D.longa;
}

function head(ico, cor, titulo, extra = '') {
  return `<div class="ph"><span class="pi" style="--ic:${cor}">${ic(ico, 16)}</span><h3>${titulo}</h3>${extra}</div>`;
}
const esperando = '<div class="wait"><span class="spinner"></span></div>';
const falhou = e => `<div class="wait muted">${esc(e || 'fonte indisponível')}</div>`;
function selo(k, palavra) { const e = EST[k] || EST.mute; return `<span class="selo" style="--sc:${e.c}">${ic(e.i, 13)}${esc(palavra || e.w)}</span>`; }
function delta(v, sufixo) {
  if (v == null || !isFinite(v)) return `<span class="dl-s">${esc(sufixo || '')}</span>`;
  const up = v >= 0;
  return `<span class="dl ${up ? 'up' : 'dn'}">${ic(up ? 'arrow-up' : 'arrow-down', 13)}${Math.abs(Math.round(v))}%</span><span class="dl-s">${esc(sufixo || '')}</span>`;
}

/* ─────────────────────────── KPIs ─────────────────────────── */
function kpis() {
  const el = document.getElementById('tvd-kpis'); if (!el) return;
  const D = datas();
  const P = ok('pjMes')?.empresa, ov = ok('overview'), tv = ok('tv'), s = serieAno();
  const presid = ((ok('scorecard') || {}).scorecards || []).find(x => x.id === 'presidencia');
  const cx = calcCaixa(), res = ind('p.resultado');
  const vendasHist = serieInd('p.vendas');
  const antVendas = vendasHist.length > 1 ? vendasHist[vendasHist.length - 2] : null;
  const vgvMes = P ? num(P.realizado?.vgv) : ov?.sales?.vgv_mes;
  const mesAnt = MESES[(D.mes + 10) % 12];
  const resV = res ? nn(res.valor) : null;
  const tiles = [
    { i: 'coins', c: '#9ef01a', t: `VGV de ${D.mesNome}`, v: vgvMes != null ? brl(vgvMes) : null,
      d: delta(tv?.projecao?.mom_pct, `vs mesmo dia de ${mesAnt}`), sp: s ? s.map(x => x.real).slice(0, D.mes) : [] },
    { i: 'handshake', c: '#ffd23f', t: 'Vendas no mês', v: ov?.sales ? int(ov.sales.vendas_mes) : P ? int(P.realizado?.vendas) : null,
      d: antVendas ? delta(((ov?.sales?.vendas_mes ?? 0) / antVendas - 1) * 100, `vs ${mesAnt} inteiro`) : '', sp: vendasHist },
    { i: 'target', c: '#ff8a1f', t: 'Fechamento provável', v: P ? brl(P.provavel?.vgv) : null,
      d: P ? `<span class="dl ${num(P.provavel?.pct_meta) >= 100 ? 'up' : 'dn'}">${pct(P.provavel?.pct_meta)}</span><span class="dl-s">da meta de ${brl(P.meta?.vgv)}</span>` : '',
      bar: P && P.meta?.vgv ? Math.min(100, num(P.provavel?.pct_meta)) : null },
    { i: 'wallet', c: '#2ee6c5', t: 'Caixa (PSM HUB)', v: _d.hubPainel ? (cx == null ? '—' : brl(cx)) : null,
      d: `<span class="dl-s">${cx == null && _d.hubPainel ? 'saldo não informado no Hub' : 'saldo nas contas bancárias'}</span>` },
    { i: resV != null && resV < 0 ? 'trending-down' : 'trending-up', c: resV != null && resV < 0 ? '#ff5c5c' : '#9ef01a',
      t: 'Resultado do mês (proj.)', v: resV != null ? brl(resV) : (_d.scorecard ? '—' : null),
      d: `<span class="dl-s">com pró-labore · Regra do Positivo ≥ 0</span>`, sp: serieInd('p.resultado') },
    { i: 'shield', c: '#a78bfa', t: 'Saúde da empresa', v: presid ? (presid.saude == null ? '—' : `${presid.saude}<small> /100</small>`) : null,
      d: presid ? `<span class="dl-s">${presid.farois?.verde || 0} verdes · ${presid.farois?.amarelo || 0} amarelos · ${presid.farois?.vermelho || 0} vermelhos</span>` : '',
      sp: (ok('hist')?.saude?.presidencia || []).map((x, i, a) => i === a.length - 1 && presid ? presid.saude : x) },
  ];
  el.innerHTML = tiles.map((k, n) => `
    <div class="kpi" style="--kc:${k.c};animation-delay:${n * 50}ms">
      <div class="k-top"><span class="k-ic">${ic(k.i, 22)}</span><span class="k-t">${k.t}</span></div>
      <div class="k-v">${k.v == null ? '<span class="spinner"></span>' : k.v}</div>
      <div class="k-d">${k.d || ''}</div>
      ${k.bar != null ? `<div class="k-bar"><i style="width:${k.bar}%"></i></div>` : k.sp ? spark(k.sp, k.c) : '<div class="spark-empty"></div>'}
    </div>`).join('');
}

/* ─────────────────────────── VGV NO ANO (área) ─────────────────────────── */
function pAno() {
  const el = document.getElementById('p-ano'); if (!el) return;
  const D = datas(), m = ok('metas'), s = serieAno();
  const T = `VGV mês a mês · ${D.ano}`;
  if (!_d.metas) { el.innerHTML = head('chart-column', '#9ef01a', T) + esperando; return; }
  if (!m || !s) { el.innerHTML = head('chart-column', '#9ef01a', T) + falhou(_d.metas._err); return; }
  const prov = num(ok('pjMes')?.empresa?.provavel?.vgv);
  const box = el.querySelector('.area');
  const W = Math.max(320, Math.round(box?.clientWidth || 640)), H = Math.max(120, Math.round(box?.clientHeight || 250));
  const n = D.mes, L = 64, R = 12, Tp = 16, B = 26, pw = W - L - R, ph = H - Tp - B;
  const max = Math.max(...s.map(v => Math.max(v.real, v.meta)), prov) * 1.12 || 1;
  const x = i => L + i * pw / 11, y = v => Tp + ph - v / max * ph;
  const pts = s.slice(0, n).map((v, i) => [x(i), y(v.real)]);
  const curva = pts.map((p, i) => {
    if (!i) return `M${p[0]},${p[1]}`;
    const q = pts[i - 1], cxm = (q[0] + p[0]) / 2;
    return `C${cxm},${q[1]} ${cxm},${p[1]} ${p[0]},${p[1]}`;
  }).join('');
  const g = uid('ga');
  const ticks = [0, .25, .5, .75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/><text x="${L - 8}" y="${y(max * f) + 4}" text-anchor="end" class="ax">${eixo(max * f)}</text>`).join('');
  const metaPts = s.map((v, i) => v.meta > 0 ? [x(i), y(v.meta)] : null).filter(Boolean);
  const metaLine = metaPts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  const best = s.slice(0, n).reduce((b, v, i) => v.real > (b?.v ?? -1) ? { v: v.real, i } : b, null);
  const cur = pts[n - 1];
  const provPt = cur && prov > s[n - 1].real ? `<line x1="${cur[0]}" y1="${cur[1]}" x2="${cur[0]}" y2="${y(prov)}" stroke="#9ef01a" stroke-width="2" stroke-dasharray="3 4" opacity=".8"/>
    <circle cx="${cur[0]}" cy="${y(prov)}" r="5" fill="#050607" stroke="#9ef01a" stroke-width="2"/><text x="${cur[0] + 9}" y="${y(prov) + 4}" class="ax hi">provável ${eixo(prov)}</text>` : '';
  const dots = pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === n - 1 ? 5.5 : 3.5}" fill="${i === n - 1 ? '#9ef01a' : '#050607'}" stroke="#9ef01a" stroke-width="2"><title>${MESES[i]}: ${brl(s[i].real)}${s[i].meta ? ` · meta ${brl(s[i].meta)} (${pct(s[i].real / s[i].meta * 100)})` : ''}</title></circle>`).join('');
  const labels = s.map((v, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax${i === n - 1 ? ' on' : ''}">${MESES[i]}</text>`).join('');
  const daMeta = m.totals.atingido_vgv_da_meta != null ? m.totals.atingido_vgv_da_meta : m.totals.atingido_vgv;
  const pAnoV = m.totals.meta_vgv ? daMeta / m.totals.meta_vgv * 100 : null;
  el.innerHTML = head('chart-column', '#9ef01a', T,
      `<div class="ph-r"><span class="lgd"><i style="background:#9ef01a"></i>realizado</span><span class="lgd"><i class="ln"></i>meta</span></div>`) + `
    <div class="ano-top"><div><span class="lbl">Acumulado no ano</span><b class="glowt">${brl(m.totals.atingido_vgv)}</b><small>${pct(pAnoV)} da meta de ${brl(m.totals.meta_vgv)} · ${int(m.total_vendas)} vendas</small></div>
      ${best ? `<div class="callout"><span>Melhor mês</span><b>${brl(best.v)}</b><small>${MESES[best.i]} de ${D.ano}</small></div>` : ''}</div>
    <svg class="area" viewBox="0 0 ${W} ${H}" data-wh="${W}x${H}">
      <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ef01a" stop-opacity=".42"/><stop offset="1" stop-color="#9ef01a" stop-opacity="0"/></linearGradient></defs>
      ${ticks}
      ${pts.length > 1 ? `<path d="${curva}L${cur[0]},${Tp + ph}L${pts[0][0]},${Tp + ph}Z" fill="url(#${g})" class="a-fill"/>` : ''}
      ${metaLine ? `<path d="${metaLine}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5" stroke-dasharray="5 5"/>` : ''}
      <path d="${curva}" fill="none" stroke="#9ef01a" stroke-width="2.6" class="a-line" pathLength="1000"/>
      ${provPt}${dots}${labels}</svg>`;
  // 1ª pintura usa um tamanho padrão; se o espaço real for outro, redesenha no tamanho certo
  const real = el.querySelector('.area');
  if (real && !pAno._again) {
    const wh = `${Math.max(320, Math.round(real.clientWidth))}x${Math.max(120, Math.round(real.clientHeight))}`;
    if (wh !== real.dataset.wh) { pAno._again = true; requestAnimationFrame(() => { pAno(); pAno._again = false; }); }
  }
}

/* ─────────────────────────── FUNIL ─────────────────────────── */
function pFunil() {
  const el = document.getElementById('p-fun'); if (!el) return;
  const D = datas();
  const T = `Funil comercial · ${D.mesNome}`;
  if (!_d.scorecard) { el.innerHTML = head('zap', '#ffd23f', T) + esperando; return; }
  if (!ok('scorecard')) { el.innerHTML = head('zap', '#ffd23f', T) + falhou(_d.scorecard._err); return; }
  const et = [['Leads', 'mk.leads'], ['Agendamentos', 'co.agend'], ['Visitas', 'co.visitas'], ['Propostas', 'co.propostas'], ['Vendas', 'p.vendas']]
    .map(([l, id]) => { const i = ind(id) || {}; return { l, v: nn(i.valor), meta: nn(i.meta), f: i.farol }; });
  const W = 520, H = 290, top = 6, h = (H - top - 36) / et.length, FW = 300, fx = FW / 2;
  const wTop = 290, wBot = 72;
  const wAt = k => wTop - (wTop - wBot) * k / et.length;
  const corF = f => ({ ok: '#9ef01a', warn: '#ffb020', bad: '#ff5c5c', mute: '#7b8378' }[farolEst(f)]);
  const shapes = et.map((e, k) => {
    const y0 = top + k * h, y1 = y0 + h - 5, a = wAt(k) / 2, b = wAt(k + 1) / 2, ym = (y0 + y1) / 2;
    const prox = et[k + 1];
    const conv = prox && e.v && prox.v != null ? prox.v / e.v * 100 : null;
    const pm = e.meta ? e.v / e.meta * 100 : null;
    return `<path d="M${fx - a},${y0} L${fx + a},${y0} L${fx + b},${y1} L${fx - b},${y1} Z" fill="url(#fg)" fill-opacity="${0.95 - k * 0.12}" stroke="#d9ff8a" stroke-opacity=".55" stroke-width="1" class="f-sl" style="animation-delay:${k * 90}ms"/>
      <text x="${fx}" y="${ym + 7}" text-anchor="middle" class="f-v">${e.v == null ? '—' : int(e.v)}</text>
      <line x1="${fx + (a + b) / 2 + 6}" x2="${FW + 14}" y1="${ym}" y2="${ym}" stroke="rgba(158,240,26,.28)" stroke-dasharray="2 3"/>
      <circle cx="${FW + 16}" cy="${ym}" r="3" fill="${corF(e.f)}" style="filter:drop-shadow(0 0 4px ${corF(e.f)})"/>
      <text x="${FW + 26}" y="${ym - 6}" class="f-l">${e.l}</text>
      <text x="${FW + 26}" y="${ym + 10}" class="f-m">${e.meta ? `${pct(pm)} da meta (${int(e.meta)})` : 'sem meta no mês'}</text>
      ${conv != null ? `<text x="${FW + 26}" y="${ym + 24}" class="f-c">↓ ${conv.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% seguem</text>` : ''}`;
  }).join('');
  const baseY = top + et.length * h + 8;
  const halo = `<ellipse cx="${fx}" cy="${baseY + 6}" rx="72" ry="11" fill="none" stroke="#9ef01a" stroke-opacity=".45"/><ellipse cx="${fx}" cy="${baseY + 6}" rx="46" ry="7" fill="none" stroke="#9ef01a" stroke-opacity=".7"/><ellipse cx="${fx}" cy="${baseY + 6}" rx="16" ry="4" fill="#d9ff8a" class="core"/>`;
  const fv = ind('p.vendas')?.farol;
  el.innerHTML = head('zap', '#ffd23f', T, `<div class="ph-r">${selo(farolEst(fv), fv === 'verde' ? 'vendas no ritmo' : fv === 'amarelo' ? 'vendas em atenção' : fv === 'vermelho' ? 'vendas abaixo do ritmo' : 'sem meta')}</div>`) + `
    <svg viewBox="0 0 ${W} ${H}" class="fsvg"><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ef01a" stop-opacity=".6"/><stop offset="1" stop-color="#3f7d0a" stop-opacity=".35"/></linearGradient></defs>${shapes}${halo}</svg>`;
}

/* ─────────────────────────── PIPELINE POR FRENTE (rosca) ─────────────────────────── */
function pPipe() {
  const el = document.getElementById('p-pipe'); if (!el) return;
  const T = 'Pipeline por frente';
  const ov = _d.overview;
  if (!ov) { el.innerHTML = head('chart-pie', '#ff8a1f', T) + esperando; return; }
  const S = ok('overview')?.sales;
  if (!S) { el.innerHTML = head('chart-pie', '#ff8a1f', T) + falhou(ov._err); return; }
  const fr = (S.pipeline_frentes || []).filter(f => num(f[2]) > 0);
  let ci = 0;
  const segs = fr.slice(0, 6).map(f => { const k = String(f[0] || 'outras').toLowerCase(); return { l: f[0] || 'sem frente', v: num(f[2]), n: f[1], c: FRENTE_COR[k] || CAT[(ci++ % CAT.length)] }; });
  const resto = fr.slice(6).reduce((a, f) => a + num(f[2]), 0);
  if (resto) segs.push({ l: 'outras', v: resto, n: fr.slice(6).reduce((a, f) => a + num(f[1]), 0), c: '#5b5f63' });
  const tot = segs.reduce((a, s) => a + s.v, 0);
  el.innerHTML = head('chart-pie', '#ff8a1f', T, `<div class="ph-r"><span class="mini">${int(S.pipeline_count)} negócios em andamento</span></div>`) + (segs.length ? `
    <div class="pipe">${donut(segs, eixo(tot), 'pipeline')}
      <ul class="lg-l">${segs.map(s => `<li><i style="background:${s.c};color:${s.c}"></i><span>${esc(s.l)}</span><b>${pct(s.v / tot * 100)}</b><small>${brl(s.v)} · ${int(s.n)} neg.</small></li>`).join('')}</ul></div>
    ${S.pipeline_sem_valor ? `<div class="note">${ic('triangle-alert', 13)} ${int(S.pipeline_sem_valor)} negócio(s) em andamento sem valor no RD, fora da soma</div>` : ''}`
    : '<div class="wait muted">Sem pipeline com valor.</div>');
}

/* ─────────────────────────── RANKING DE CORRETORES ─────────────────────────── */
function pRank() {
  const el = document.getElementById('p-rank'); if (!el) return;
  const D = datas(), T = `Ranking · ${D.mesNome}`;
  if (!_d.metas) { el.innerHTML = head('trophy', '#ffd23f', T) + esperando; return; }
  const m = ok('metas'); if (!m) { el.innerHTML = head('trophy', '#ffd23f', T) + falhou(_d.metas._err); return; }
  const rows = (m.grid || []).map(g => {
    const c = (g.cells || []).find(x => x.mes === D.mes) || {};
    return { n: g.user?.name || '—', team: String(g.user?.team || '').toLowerCase(), v: num(c.atingido_vgv), meta: num(c.meta_vgv), q: num(c.vendas_count) };
  }).filter(r => r.v > 0 || r.meta > 0).sort((a, b) => b.v - a.v || b.meta - a.meta).slice(0, 8);
  const max = Math.max(...rows.map(r => Math.max(r.v, r.meta)), 1);
  el.innerHTML = head('trophy', '#ffd23f', T, `<div class="ph-r"><span class="mini">VGV · traço = meta</span></div>`) + (rows.length ? `<ol class="rank">${rows.map((r, i) => `
    <li style="animation-delay:${i * 45}ms">
      <span class="rk ${i < 3 && r.v > 0 ? 'p' + (i + 1) : ''}">${i === 0 && r.v > 0 ? ic('crown', 13) : i + 1}</span>
      <span class="rn">${esc(primeiro(r.n))} <small>${esc(r.n.split(' ').slice(1, 2).join(' '))}</small></span>
      <span class="rb"><i style="width:${r.v / max * 100}%;background:${FRENTE_COR[r.team] || '#9ef01a'};color:${FRENTE_COR[r.team] || '#9ef01a'}"></i>${r.meta ? `<b style="left:${r.meta / max * 100}%"></b>` : ''}</span>
      <span class="rv">${brl(r.v)}<small>${r.q ? int(r.q) + ' venda' + (r.q > 1 ? 's' : '') : 'sem venda'}${r.meta ? ' · ' + pct(r.v / r.meta * 100) : ''}</small></span>
    </li>`).join('')}</ol>
    <div class="lg-row"><span class="lgd"><i style="background:#ff8a1f"></i>Conquista</span><span class="lgd"><i style="background:#f3ebcb"></i>MAP</span><span class="lgd"><i style="background:#2ee6c5"></i>Terceiros</span></div>`
    : '<div class="wait muted">Nenhuma venda no mês ainda.</div>');
}

/* ─────────────────────────── PILARES × 12 MESES ─────────────────────────── */
function pPilares() {
  const el = document.getElementById('p-pil'); if (!el) return;
  const T = 'Saúde dos pilares · 12 meses';
  const sc = _d.scorecard;
  if (!sc) { el.innerHTML = head('shield', '#a78bfa', T) + esperando; return; }
  if (!ok('scorecard')) { el.innerHTML = head('shield', '#a78bfa', T) + falhou(sc._err); return; }
  const H = ok('hist'), meses = H?.meses || [];
  const cont = { ok: 0, warn: 0, bad: 0 };
  sc.scorecards.forEach(s => { const k = saudeEst(s.saude); if (cont[k] != null) cont[k]++; });
  const cols = Math.max(1, meses.length);
  const linhas = sc.scorecards.map(s => {
    const serie = (H?.saude?.[s.id] || []).slice();
    if (serie.length) serie[serie.length - 1] = s.saude;
    const cells = (serie.length ? serie : [s.saude]).map((v, i, a) => `<span class="cl${i === a.length - 1 ? ' on' : ''}${v == null ? ' nd' : ''}" style="--cc:${{ ok: '#9ef01a', warn: '#ffb020', bad: '#ff5c5c', mute: '#7b8378' }[saudeEst(v)]}" title="${esc(s.nome)} · ${meses[i] || 'agora'}: ${v == null ? 'sem avaliação' : 'saúde ' + v}">${v == null ? '' : v}</span>`).join('');
    const pior = [...(s.indicadores || [])].filter(i => i.farol === 'vermelho' || i.farol === 'amarelo').sort((a, b) => (a.farol === 'vermelho' ? 0 : 1) - (b.farol === 'vermelho' ? 0 : 1))[0];
    const k = saudeEst(s.saude);
    return `<a class="pr" href="#/scorecard" title="${pior ? 'puxa pra baixo: ' + esc(pior.label) : ''}">
      <span class="pnm">${esc(s.nome)}<small>${esc(primeiro(s.dono_nome || s.dono))}</small></span>
      <span class="cls" style="grid-template-columns:repeat(${cols},1fr)">${cells}</span>
      <span class="psc" style="color:${EST[k].c}">${s.saude == null ? '—' : s.saude}</span></a>`;
  }).join('');
  el.innerHTML = head('shield', '#a78bfa', T, `<div class="ph-r">${selo('ok', cont.ok + '')}${selo('warn', cont.warn + '')}${selo('bad', cont.bad + '')}</div>`) + `
    <div class="pil">
      <div class="pr hdr"><span></span><span class="cls" style="grid-template-columns:repeat(${cols},1fr)">${meses.map((ym, i) => `<span class="${i === meses.length - 1 ? 'on' : ''}">${MESES[+ym.slice(5, 7) - 1].slice(0, 1)}</span>`).join('')}</span><span>nota</span></div>
      ${linhas}
    </div>`;
}

/* ─────────────────────────── CONTA CHEIA (velocímetro) ─────────────────────────── */
function hub(k) { const d = _d[k]; return d && d.ok && d.dados ? d.dados : null; }
function calcCaixa() {
  const dd = hub('hubPainel'); if (!dd || !Array.isArray(dd.contas_bancarias)) return null;
  let t = 0, achou = false;
  for (const c of dd.contas_bancarias) for (const k of ['currentBalance', 'balance', 'saldo', 'saldoAtual', 'initialBalance']) {
    if (c[k] != null && !isNaN(parseFloat(c[k]))) { t += parseFloat(c[k]); achou = true; break; }
  }
  return achou ? t : null;
}
function calcContas() {
  const dd = hub('hubContas'); if (!dd || !Array.isArray(dd.lancamentos)) return null;
  const D = datas(), em7 = new Date(D.h.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  const o = { pv: 0, rv: 0, p7: 0, r7: 0 };
  for (const l of dd.lancamentos) {
    if (String(l.status || '').toLowerCase() === 'pago') continue;
    const f = Math.max(0, num(l.amount) - num(l.amountPaid)); if (!f) continue;
    const due = String(l.dueDate || '').slice(0, 10), pagar = String(l.type || '').toLowerCase().includes('pag');
    if (due && due < D.iso) pagar ? o.pv += f : o.rv += f;
    else if (due && due <= em7) pagar ? o.p7 += f : o.r7 += f;
  }
  return o;
}

function pCaixa() {
  const el = document.getElementById('p-cx'); if (!el) return;
  const T = 'Conta cheia do mês';
  const cob = ind('p.breakeven'), res = ind('p.resultado'), cheia = ind('f.fixo');
  const ct = _d.hubContas ? calcContas() : undefined;
  const k = cob ? farolEst(cob.farol) : 'mute';
  const resV = res ? nn(res.valor) : null;
  el.innerHTML = head('gauge', '#2ee6c5', T) + (!_d.scorecard ? esperando : `
    <div class="gwrap">${gauge(nn(cob?.valor), k)}<div class="g-cap">coberta pela contribuição projetada</div></div>
    <dl class="kv">
      <div><dt>Conta cheia</dt><dd>${cheia && nn(cheia.valor) != null ? brl(cheia.valor) : '—'}</dd></div>
      <div><dt>Resultado proj.</dt><dd style="color:${resV != null ? (resV >= 0 ? 'var(--n-ok)' : 'var(--n-bad)') : 'inherit'}">${resV != null ? brl(resV) : '—'}</dd></div>
      <div><dt>A pagar vencido</dt><dd style="color:${ct && ct.pv > 0 ? 'var(--n-bad)' : 'inherit'}">${ct === undefined ? '…' : ct ? brl(ct.pv) : '—'}</dd></div>
      <div><dt>A receber vencido</dt><dd style="color:${ct && ct.rv > 0 ? 'var(--n-warn)' : 'inherit'}">${ct === undefined ? '…' : ct ? brl(ct.rv) : '—'}</dd></div>
    </dl>`);
}

/* ─────────────────────────── PRECISA DE VOCÊ ─────────────────────────── */
function pAcao() {
  const el = document.getElementById('p-act'); if (!el) return;
  const D = datas();
  const dec = _d.decisoes, tk = _d.tasks, dd = dec && !dec._err ? dec : null;
  const hojeD = dd?.hoje || D.iso;
  const ds = (dd?.decisoes || []).filter(x => x.estado?.status !== 'dispensada')
    .sort((a, b) => (a.nivel === 'critico' ? 0 : 1) - (b.nivel === 'critico' ? 0 : 1) || String(a.prazo).localeCompare(String(b.prazo)));
  const lista = (tk && !tk._err ? tk.tasks : null) || [];
  const abertas = lista.filter(t => !['concluida', 'cancelada'].includes(t.status));
  const venc = abertas.filter(t => t.prazo && String(t.prazo).slice(0, 10) <= D.iso).sort((a, b) => String(a.prazo).localeCompare(String(b.prazo)));
  const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const itens = [
    ...ds.map(x => ({ c: x.nivel === 'critico' ? 'var(--n-bad)' : 'var(--n-warn)', t: x.titulo, s: `${primeiro(x.dono?.name) || '—'} · decisão`, q: x.prazo ? (x.prazo < hojeD ? 'venceu ' : 'até ') + dm(x.prazo) : '', v: x.prazo && x.prazo < hojeD })),
    ...venc.map(t => { const p = String(t.prazo).slice(0, 10); return { c: p < D.iso ? 'var(--n-bad)' : 'var(--n-warn)', t: t.titulo, s: `${primeiro(nome(t.responsavel)) || '—'} · tarefa`, q: p < D.iso ? 'venceu ' + dm(p) : 'hoje', v: p < D.iso }; }),
  ];
  const nAtr = itens.filter(i => i.v).length;
  el.innerHTML = head('triangle-alert', '#ff5c5c', 'Precisa de você', `<div class="ph-r"><span class="big-n" style="color:${nAtr ? 'var(--n-bad)' : 'var(--n-ok)'}">${dec || tk ? itens.length : '…'}</span></div>`) +
    (!dec && !tk ? esperando : itens.length ? `<ul class="acts">${itens.slice(0, 4).map(i => `<li style="--ic:${i.c}"><div><b>${esc(i.t)}</b><small>${esc(i.s)}</small></div><time class="${i.v ? 'venc' : ''}">${i.q}</time></li>`).join('')}</ul>
      ${itens.length > 4 ? `<a class="more" href="#/pontos-atencao">+ ${itens.length - 4} em Pontos de Atenção e Checklist</a>` : ''}`
      : `<div class="wait ok">${ic('circle-check', 16)} Nada atrasado.</div>`);
}

/* ─────────────────────────── AO VIVO ─────────────────────────── */
function quando(ts) {
  const t = new Date(ts); if (isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'agora'; if (min < 60) return `há ${min} min`;
  if (t.toDateString() === new Date().toDateString()) return hhmm(t);
  return t.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function pVivo() {
  const el = document.getElementById('p-viv'); if (!el) return;
  const u = ok('uso'), on = u ? (u.pessoas || []).filter(p => p.online && !p.is_service) : null;
  const vendas = ((_d.arena && _d.arena.events) || []).filter(e => e.type === 'venda').slice(0, 3);
  el.innerHTML = head('radio-tower', '#9ef01a', 'Ao vivo', `<div class="ph-r"><a class="mini" href="#/checkin">${ic('users', 13)} ${on ? on.length : '…'} no House</a></div>`) + `
    <ul class="feed">${!_d.arena ? '<li class="wait"><span class="spinner"></span></li>' : vendas.length ? vendas.map(e => `<li><span class="fi">${ic('trophy', 14)}</span><div><b>${esc(e.subtitle || e.title || '')}</b><small>${esc(e.actor?.name || nome(e.actor_id) || '')}</small></div><time>${quando(e.ts)}</time></li>`).join('')
      : '<li class="muted">Nenhuma venda nos últimos 7 dias.</li>'}</ul>
    ${on && on.length ? `<div class="who">${on.slice(0, 9).map(p => `<span title="${esc(p.name)}">${esc(String(p.name || '?').split(' ').map(x => x[0]).slice(0, 2).join(''))}</span>`).join('')}${on.length > 9 ? `<span>+${on.length - 9}</span>` : ''}</div>` : ''}`;
}

/* ─────────────────────────── INSIGHTS (frases a partir dos dados) ─────────────────────────── */
function insights() {
  const el = document.getElementById('tvd-ins'); if (!el) return;
  const D = datas(), I = [];
  const tv = ok('tv'), P = ok('pjMes')?.empresa, S = ok('overview')?.sales, m = ok('metas');
  const mom = tv?.projecao?.mom_pct;
  if (mom != null && isFinite(mom)) I.push([mom >= 0 ? 'trending-up' : 'trending-down', mom >= 0 ? '#9ef01a' : '#ff5c5c', `VGV <b>${Math.abs(Math.round(mom))}% ${mom >= 0 ? 'acima' : 'abaixo'}</b> do mesmo dia de ${MESES[(D.mes + 10) % 12]}.`]);
  if (P && P.status === 'batida') I.push(['trophy', '#ffd23f', `<b>Meta do mês batida.</b> Agora é recorde.`]);
  else if (P && P.por_dia_util_vgv) I.push(['target', '#ff8a1f', `Para bater a meta: <b>${brl(P.por_dia_util_vgv)}</b> por dia útil.`]);
  const fr = (S?.pipeline_frentes || []).filter(f => num(f[2]) > 0);
  const totP = fr.reduce((a, f) => a + num(f[2]), 0);
  if (fr.length && totP) I.push(['chart-pie', '#ff8a1f', `<b style="text-transform:capitalize">${esc(fr[0][0])}</b> concentra <b>${pct(num(fr[0][2]) / totP * 100)}</b> do pipeline.`]);
  if (m?.grid) {
    const top = m.grid.map(g => ({ n: g.user?.name, v: num(((g.cells || []).find(c => c.mes === D.mes) || {}).atingido_vgv) })).sort((a, b) => b.v - a.v)[0];
    if (top && top.v > 0) I.push(['crown', '#ffd23f', `<b>${esc(primeiro(top.n))}</b> lidera ${D.mesNome} com <b>${brl(top.v)}</b>.`]);
  }
  const scs = (ok('scorecard')?.scorecards || []).filter(s => s.saude != null).sort((a, b) => a.saude - b.saude);
  if (scs.length && scs[0].saude < 55) I.push(['triangle-alert', '#ff5c5c', `Pilar mais crítico: <b>${esc(scs[0].nome)}</b> (nota ${scs[0].saude}).`]);
  const resV = nn(ind('p.resultado')?.valor);
  if (resV != null) I.push([resV >= 0 ? 'circle-check' : 'octagon-x', resV >= 0 ? '#9ef01a' : '#ff5c5c', resV >= 0 ? `Mês projetado <b>no positivo</b>: ${brl(resV)}.` : `Regra do Positivo em risco: <b>${brl(resV)}</b> projetado.`]);
  el.innerHTML = `<span class="ins-h">${ic('lightbulb', 18)}Leitura do momento</span>` +
    (I.length ? I.slice(0, 5).map(([i, c, t]) => `<span class="ins-i"><span class="ins-ic" style="--ic:${c}">${ic(i, 15)}</span><span>${t}</span></span>`).join('') : '<span class="muted">montando a leitura…</span>');
}

function recados() {
  const el = document.getElementById('tvd-rec'); if (!el) return;
  const rs = ((ok('recados') || {}).recados || []).filter(r => r.prioridade === 'critico' || r.prioridade === 'critica');
  el.className = rs.length ? 'rec' : '';
  el.innerHTML = rs.slice(0, 1).map(r => `<div>${ic('triangle-alert', 15)}<b>${esc(r.titulo || '')}</b> ${esc(r.mensagem || r.texto || '')}</div>`).join('');
}

function celebracao() {
  const el = document.getElementById('tvd-cel'); if (!el) return;
  if (!_celebra) { el.innerHTML = ''; return; }
  const e = _celebra;
  el.innerHTML = `<div class="cel"><span class="cel-ic">${ic('trophy', 30)}</span><div><span>Venda fechada</span><b>${esc(e.subtitle || '')}</b>${(e.actor?.name || nome(e.actor_id)) ? `<small>${esc(e.actor?.name || nome(e.actor_id))}</small>` : ''}</div></div>`;
}

/* ═══════════════════════════ PEÇAS COMUNS DAS TELAS 2–5 ═══════════════════════════ */
function tilesHTML(tiles) {
  return tiles.map((k, n) => `
    <div class="kpi" style="--kc:${k.c};animation-delay:${n * 50}ms">
      <div class="k-top"><span class="k-ic">${ic(k.i, 22)}</span><span class="k-t">${k.t}</span></div>
      <div class="k-v">${k.v == null ? '<span class="spinner"></span>' : k.v}</div>
      <div class="k-d">${k.d || ''}</div>
      ${k.bar != null ? `<div class="k-bar"><i style="width:${Math.max(0, Math.min(100, k.bar))}%"></i>${k.marca != null ? `<b style="left:${Math.min(100, k.marca)}%"></b>` : ''}</div>` : k.sp ? spark(k.sp, k.c) : '<div class="spark-empty"></div>'}
    </div>`).join('');
}
function hbars(rows, opt = {}) {   // barras horizontais com valor na ponta
  const max = Math.max(...rows.map(r => Math.abs(r.v || 0)), opt.max || 0, 1e-9);
  return `<ul class="hb">${rows.map((r, i) => `<li style="animation-delay:${i * 40}ms" title="${esc(r.tt || '')}">
    <span class="hb-l">${r.dot ? `<i style="background:${r.dot}"></i>` : ''}${esc(r.l)}${r.s ? `<small>${esc(r.s)}</small>` : ''}</span>
    <span class="hb-b"><i style="width:${Math.abs(r.v || 0) / max * 100}%;background:${r.c || '#9ef01a'};color:${r.c || '#9ef01a'}"></i>${opt.linha != null ? `<b style="left:${opt.linha / max * 100}%"></b>` : ''}</span>
    <span class="hb-v">${r.fv ?? int(r.v)}</span></li>`).join('')}</ul>`;
}
const pendente = (id, ico, cor, t) => { const el = document.getElementById(id); if (el) el.innerHTML = head(ico, cor, t) + esperando; return null; };
function quadro(id, ico, cor, t, fonte) {   // devolve o dado ou pinta espera/erro e devolve null
  const el = document.getElementById(id); if (!el) return null;
  if (!_d[fonte]) return pendente(id, ico, cor, t);
  if (!ok(fonte)) { el.innerHTML = head(ico, cor, t) + falhou(_d[fonte]._err); return null; }
  return el;
}
const fmtPct = v => v == null ? '—' : `${num(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/* ═══════════════════════════ TELA 2 · COMERCIAL ═══════════════════════════ */
const EQUIPES = ['conquista', 'map', 'terceiros', 'locacao'];
function cEquipes() {
  const el = document.getElementById('c-eq'); if (!el) return;
  const R = ok('resumo'), pj = ok('pjMes');
  if (!R) { el.innerHTML = EQUIPES.map(() => `<section class="pn">${_d.resumo?._err ? falhou(_d.resumo._err) : esperando}</section>`).join(''); return; }
  const eqs = EQUIPES.filter(k => R.equipes?.[k]);
  el.innerHTML = eqs.map((k, n) => {
    const b = R.equipes[k], m = b.meta || {}, cor = FRENTE_COR[k];
    const pctM = b.atingimento_vgv_pct ?? (m.meta_vgv ? b.vgv / m.meta_vgv * 100 : null);
    const proj = b.projecao?.atingira_vgv_pct;
    const st = pj?.equipes?.[k]?.status;
    const [sk, sw] = { batida: ['ok', 'meta batida'], no_ritmo: ['ok', 'no ritmo'], atras: ['warn', 'atrás do ritmo'], fora: ['bad', 'fora do ritmo'] }[st] || (proj == null ? ['mute', 'sem projeção'] : proj >= 100 ? ['ok', 'no ritmo'] : proj >= 70 ? ['warn', 'atrás do ritmo'] : ['bad', 'fora do ritmo']);
    const et = [['Interessados', b.interessados, null], ['Agendamentos', b.agendamentos, m.meta_agendamentos], ['Visitas', b.visitas ?? b.visitas_coluna, m.meta_visitas], ['Propostas', b.propostas, m.meta_propostas], ['Vendas', b.vendas, m.meta_vendas]];
    const topo = Math.max(num(b.interessados), 1);
    return `<section class="pn eq" style="--ec:${cor};animation-delay:${n * 60}ms">
      <div class="ph"><span class="pi" style="--ic:${cor}">${ic(k === 'conquista' ? 'house' : k === 'locacao' ? 'key' : k === 'map' ? 'building-2' : 'handshake', 16)}</span><h3>${esc(FRENTE_NOME[k])}</h3><div class="ph-r">${selo(sk, sw)}</div></div>
      <div class="eq-v"><b>${brl(b.vgv)}</b><small>${int(b.vendas)} venda${b.vendas === 1 ? '' : 's'} · ${int(b.n_corretores)} corretores</small></div>
      <div class="eq-m"><div class="k-bar"><i style="width:${Math.min(100, num(pctM))}%;background:${cor};box-shadow:0 0 12px ${cor}"></i>${proj != null ? `<b style="left:${Math.min(100, proj)}%" title="projeção"></b>` : ''}</div>
        <span>${m.meta_vgv ? `${pct(pctM)} de ${brl(m.meta_vgv)}` : 'sem meta no mês'}${proj != null ? ` · projeção <b>${pct(proj)}</b>` : ''}</span></div>
      <ul class="eq-f">${et.map(([l, v, mt]) => `<li><span>${l}</span><span class="bar"><i style="width:${Math.max(2, num(v) / topo * 100)}%;background:${cor}"></i></span><b>${v == null ? '—' : int(v)}</b><small>${mt ? pct(num(v) / mt * 100) + ' da meta' : ''}</small></li>`).join('')}</ul>
      <div class="eq-p"><span>Pipeline quente <b>${brl(b.pipeline?.quente_vgv)}</b></span><span>Em atendimento <b>${int(b.em_atendimento)}</b></span><span>Perdidos <b>${int(b.perdidos)}</b></span></div>
    </section>`;
  }).join('') || '<section class="pn">' + falhou('sem equipes no resumo') + '</section>';
}

function cHoje() {
  const el = quadro('c-hoje', 'calendar', '#2ee6c5', 'Hoje na operação', 'tv'); if (!el) return;
  const t = ok('tv'), dz = t.destaques || {}, h = t.hoje || {};
  el.innerHTML = head('calendar', '#2ee6c5', 'Hoje na operação', `<div class="ph-r"><span class="mini">${esc(h.data ? h.data.slice(8, 10) + '/' + h.data.slice(5, 7) : '')}</span></div>`) + `
    <div class="hj-n"><div><b>${int(dz.vendas_hoje)}</b><span>vendas</span></div><div><b>${brl(dz.vgv_hoje)}</b><span>VGV hoje</span></div><div><b>${int(dz.interessados_hoje ?? dz.leads_hoje)}</b><span>interessados</span></div><div><b>${int(h.visitas_total ?? (h.visitas || []).length)}</b><span>visitas</span></div></div>
    <div class="sub">Plantão</div>
    <div class="plant">${(h.plantao || []).length ? h.plantao.map(p => `<span>${ic('shield', 12)}${esc(primeiro(p.corretor))}<small>${esc(p.periodo || '')}</small></span>`).join('') : '<span class="muted">ninguém escalado</span>'}</div>
    <div class="sub">Visitas agendadas</div>
    <ul class="feed">${(h.visitas || []).length ? h.visitas.slice(0, 6).map(v => `<li><span class="fi" style="color:#2ee6c5;background:rgba(46,230,197,.12)">${ic('house', 14)}</span><div><b>${esc(v.titulo || 'Visita')}</b><small>${esc(primeiro(v.corretor))}${v.local ? ' · ' + esc(v.local) : ''}</small></div><time>${esc(String(v.hora || '').slice(0, 5))}</time></li>`).join('') : '<li class="muted">Nenhuma visita agendada hoje.</li>'}</ul>`;
}

function cPerdas() {
  const el = quadro('c-perdas', 'heart-crack', '#ff5c5c', 'Perdas do mês', 'crm'); if (!el) return;
  const g = ok('crm').global || {}, S = ok('overview')?.sales || {};
  const mot = (g.motivos_perda || []).slice(0, 6);
  el.innerHTML = head('heart-crack', '#ff5c5c', 'Perdas do mês', `<div class="ph-r"><span class="mini">conversão ${fmtPct(g.taxa_conversao)}</span></div>`) + `
    <div class="hj-n two"><div><b style="color:var(--n-bad)">${int(S.perdidos_mes ?? g.perdas)}</b><span>negócios perdidos</span></div><div><b>${brl(S.vgv_perdido_mes)}</b><span>VGV que escapou</span></div></div>
    <div class="sub">Por que perdemos</div>
    ${mot.length ? hbars(mot.map(m => ({ l: m.motivo || 'sem motivo', v: m.n, fv: `${int(m.n)} · ${pct(m.pct)}`, c: '#ff5c5c' }))) : '<div class="wait muted">Sem motivo de perda registrado.</div>'}`;
}

function cMarcas() {
  const el = quadro('c-marcas', 'zap', '#ffd23f', 'Resposta e conversão por marca', 'crm'); if (!el) return;
  const B = ok('crm').brands || {};
  const ks = Object.keys(B).filter(k => k !== 'captacao');
  const nota = (v, bom, ruim, menor) => v == null ? 'var(--n-mute)' : (menor ? (v <= bom ? 'var(--n-ok)' : v <= ruim ? 'var(--n-warn)' : 'var(--n-bad)') : (v >= bom ? 'var(--n-ok)' : v >= ruim ? 'var(--n-warn)' : 'var(--n-bad)'));
  el.innerHTML = head('zap', '#ffd23f', 'Resposta e conversão por marca') + (ks.length ? `
    <table class="tb"><thead><tr><th>Marca</th><th>Leads</th><th>Resposta</th><th>Contato</th><th>Visita</th><th>Conversão</th><th>Ciclo</th></tr></thead><tbody>
    ${ks.map(k => { const b = B[k]; return `<tr><td><i class="dotc" style="background:${FRENTE_COR[k] || '#9ef01a'}"></i>${esc(b.label || k)}</td><td>${int(b.leads_criados)}</td>
      <td style="color:${nota(b.sla_horas_aprox, 1, 4, true)}">${b.sla_horas_aprox == null ? '—' : num(b.sla_horas_aprox).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' h'}</td>
      <td style="color:${nota(b.contact_rate, 80, 60)}">${fmtPct(b.contact_rate)}</td><td>${fmtPct(b.visita_rate)}</td>
      <td style="color:${nota(b.taxa_conversao, 20, 10)}">${fmtPct(b.taxa_conversao)}</td><td>${b.ciclo_medio_dias == null ? '—' : int(b.ciclo_medio_dias) + ' d'}</td></tr>`; }).join('')}
    </tbody></table><div class="note muted">Resposta = tempo até o 1º contato (aprox.). Ciclo = dias do lead à venda (mediana).</div>` : '<div class="wait muted">Sem dados por marca.</div>');
}

function cRisco() {
  const el = quadro('c-risco', 'triangle-alert', '#ffb020', 'Carteira em risco · por corretor', 'oo'); if (!el) return;
  const rows = (ok('oo').corretores || []).filter(c => !c.is_team && !/^(socio|diretor|gerente)/.test(String(c.role || '')))
    .map(c => ({ ...c, risco: num(c.pendencias?.parados_14d) + num(c.pendencias?.sem_contato_48h) })).sort((a, b) => b.risco - a.risco || num(a.meta_attainment_pct) - num(b.meta_attainment_pct)).slice(0, 8);
  const hc = { verde: '#9ef01a', amarelo: '#ffb020', vermelho: '#ff5c5c' };
  el.innerHTML = head('triangle-alert', '#ffb020', 'Carteira em risco · por corretor', `<div class="ph-r"><a class="mini" href="#/one-on-one">abrir 1:1 →</a></div>`) + (rows.length ? `
    <table class="tb"><thead><tr><th>Corretor</th><th>Parados +14d</th><th>Sem contato 48h</th><th>Meta</th><th>Saúde</th></tr></thead><tbody>
    ${rows.map(c => `<tr><td><i class="dotc" style="background:${FRENTE_COR[String(c.team || '').toLowerCase()] || '#9ef01a'}"></i>${esc(c.name)}</td>
      <td style="color:${num(c.pendencias?.parados_14d) ? 'var(--n-bad)' : 'inherit'};font-weight:700">${int(c.pendencias?.parados_14d)}</td>
      <td style="color:${num(c.pendencias?.sem_contato_48h) ? 'var(--n-warn)' : 'inherit'};font-weight:700">${int(c.pendencias?.sem_contato_48h)}</td>
      <td>${c.meta_attainment_pct == null ? '—' : pct(c.meta_attainment_pct)}</td>
      <td><span class="hdot" style="--hc:${hc[c.health_color] || '#7b8378'}">${c.health == null ? '—' : int(c.health)}</span></td></tr>`).join('')}
    </tbody></table>` : '<div class="wait ok">' + ic('circle-check', 16) + ' Nenhum corretor com carteira parada.</div>');
}

/* ═══════════════════════════ TELA 3 · MÍDIA → VENDA ═══════════════════════════
   A pergunta do sócio não é "quanto custou o clique", é "a mídia está virando venda?".
   Diagnóstico de 28/09 (funil Conquista): os dois vazamentos são REGIÃO (lead fora da
   praça) e VELOCIDADE (1º atendimento lento, perda sem contato). A tela mostra os dois
   ao vivo, a corrente R$ → venda por marca e qual canal vende de fato. */
const MARCAS_MIDIA = [
  { k: 'conquista', nome: 'PSM Conquista', frentes: ['conquista'], cor: '#ff8a1f' },
  { k: 'imoveis', nome: 'PSM Imóveis', frentes: ['map', 'terceiros'], cor: '#f3ebcb' },
];
const ALVO_1O_CONTATO_H = 1;   // referência de mercado pra lead de mídia: responder na 1ª hora

function midiaMarca(M) {
  const P = ok('planoAds'), C = ok('crm'), G = ok('geo');
  const b = C?.brands?.[M.k] || null;
  const spend = (P?.frentes || []).filter(f => M.frentes.includes(f.frente)).reduce((s, f) => s + num(f.spend), 0);
  const g = (G?.by_brand || []).find(x => String(x.marca || '').toLowerCase().includes(M.k === 'imoveis' ? 'imó' : 'conquista') || String(x.marca || '').toLowerCase().includes(M.k));
  return { b, spend, g, leads: b ? num(b.leads ?? b.leads_criados) : null };
}

function mKpis() {
  const el = document.getElementById('m-kpis'); if (!el) return;
  const D = datas(), C = contasMkt(), R = ok('crm'), G = ok('geo');
  const diasMes = new Date(D.ano, D.mes, 0).getDate(), ritmo = D.dia / diasMes * 100;
  const pacing = C && C.t.orc ? C.t.spend / C.t.orc * 100 : null;
  const gl = R?.global || {}, vendasMidia = R ? num(gl.vendas_pago) : null;
  const spend = C ? C.t.spend : (ok('planoAds')?.global?.spend ?? null);
  const bs = Object.entries(R?.brands || {}).filter(([k]) => k !== 'captacao').map(([, b]) => b);
  const leadsP = bs.reduce((s, b) => s + num(b.leads ?? b.leads_criados), 0);
  const semAtend = bs.reduce((s, b) => s + Math.max(0, num(b.leads ?? b.leads_criados) - num(b.leads_contatados)), 0);
  const slaPond = bs.filter(b => b.sla_horas_aprox != null).reduce((a, b) => ({ s: a.s + num(b.sla_horas_aprox) * num(b.leads_criados), n: a.n + num(b.leads_criados) }), { s: 0, n: 0 });
  const sla = slaPond.n ? slaPond.s / slaPond.n : null;
  el.innerHTML = tilesHTML([
    { i: 'banknote', c: '#9ef01a', t: 'Investido em mídia no mês', v: spend != null ? brl(spend) : (_d.mkt?._err && _d.planoAds?._err ? '—' : null),
      d: pacing != null ? `<span class="dl ${pacing <= ritmo + 5 ? 'up' : 'dn'}">${pct(pacing)}</span><span class="dl-s">do orçamento · mês em ${pct(ritmo)}</span>` : '<span class="dl-s">orçamento por conta não cadastrado</span>', bar: pacing, marca: ritmo },
    { i: 'trophy', c: vendasMidia ? '#9ef01a' : '#ff5c5c', t: 'Vendas vindas da mídia', v: R ? int(vendasMidia) : null,
      d: R ? `<span class="dl-s">${brl(gl.vgv_pago)} de VGV · de ${int(gl.vendas)} vendas no total</span>` : '' },
    { i: 'coins', c: '#ff8a1f', t: 'Custo por venda de mídia', v: R && spend != null ? (vendasMidia ? brl(spend / vendasMidia) : 'sem venda') : null,
      d: `<span class="dl-s">${vendasMidia ? 'investido ÷ vendas de tráfego pago' : 'todo o investimento ainda sem retorno'}</span>` },
    { i: 'map-pin', c: G?.alerta_global ? '#ff5c5c' : '#2ee6c5', t: 'Leads fora de Rio Preto', v: G ? fmtPct(G.pct_outras) : (_d.geo?._err ? '—' : null),
      d: G ? `<span class="dl ${G.alerta_global ? 'dn' : 'up'}">limite ${pct(G.threshold_pct)}</span><span class="dl-s">${int(G.outras)} de ${int(num(G.rio_preto) + num(G.outras))} com DDD</span>` : '' },
    { i: 'clock', c: sla != null && sla > ALVO_1O_CONTATO_H ? '#ff5c5c' : '#9ef01a', t: 'Tempo até o 1º contato', v: R ? (sla == null ? '—' : horas(sla)) : null,
      d: `<span class="dl ${sla != null && sla <= ALVO_1O_CONTATO_H ? 'up' : 'dn'}">alvo ${ALVO_1O_CONTATO_H} h</span><span class="dl-s">média ponderada por marca</span>` },
    { i: 'eye-off', c: semAtend ? '#ff5c5c' : '#9ef01a', t: 'Leads nunca atendidos', v: R ? int(semAtend) : null,
      d: R ? `<span class="dl-s">de ${int(leadsP)} leads no mês · ${leadsP ? pct(semAtend / leadsP * 100) : '—'}</span>` : '' },
  ]);
}
const horas = h => h < 1 ? `${Math.round(h * 60)} min` : `${num(h).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;

// A corrente: R$ → leads → atendidos → visitas → vendas → VGV, com o custo e a perda em cada elo
function mCorrente() {
  const el = document.getElementById('m-flow'); if (!el) return;
  const T = 'Para onde vai cada R$ 1 de mídia · mês';
  if (!_d.crm || !_d.planoAds) { el.innerHTML = head('zap', '#9ef01a', T) + esperando; return; }
  if (!ok('crm')) { el.innerHTML = head('zap', '#9ef01a', T) + falhou(_d.crm._err); return; }
  const linhas = MARCAS_MIDIA.map(M => {
    const { b, spend } = midiaMarca(M);
    if (!b) return `<div class="fl-row"><div class="fl-m" style="--mc:${M.cor}"><b>${M.nome}</b><small>sem dados no mês</small></div></div>`;
    const leads = num(b.leads ?? b.leads_criados), at = num(b.leads_contatados), vi = num(b.leads_visita), ve = num(b.vendas_pago), vgv = num(b.vgv_pago);
    const custo = (n) => spend && n ? brl(spend / n) : '—';
    const perda = (de, para) => de ? Math.max(0, 100 - para / de * 100) : null;
    const no = (ico, rot, v, sub, k, n) => `<div class="fl-n ${k || ''}" style="animation-delay:${n * 90}ms"><span class="fl-i">${ic(ico, 16)}</span><span class="fl-r">${rot}</span><b>${v}</b><small>${sub}</small></div>`;
    const seta = (p) => `<div class="fl-a${p != null && p >= 70 ? ' vaza' : ''}"><i></i>${p != null ? `<span>${p >= 70 ? ic('triangle-alert', 11) : ''}−${Math.round(p)}%</span>` : ''}</div>`;
    const ret = spend ? vgv / spend : null;
    return `<div class="fl-row">
      <div class="fl-m" style="--mc:${M.cor}"><b>${M.nome}</b><small>${ret != null ? `cada R$ 1 virou <em>R$ ${ret.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</em> de VGV` : 'sem mídia no mês'}</small></div>
      ${no('banknote', 'Investido', brl(spend), 'mídia paga', '', 0)}${seta(null)}
      ${no('users', 'Leads', int(leads), `${custo(leads)} por lead`, '', 1)}${seta(perda(leads, at))}
      ${no('phone', 'Atendidos', int(at), `${fmtPct(b.contact_rate)} dos leads`, perda(leads, at) >= 70 ? 'bad' : '', 2)}${seta(perda(at, vi))}
      ${no('house', 'Visitas', int(vi), `${custo(vi)} por visita`, '', 3)}${seta(perda(vi, ve))}
      ${no('trophy', 'Vendas', int(ve), ve ? `${custo(ve)} por venda` : 'nenhuma de mídia', ve ? 'ok' : 'bad', 4)}${seta(null)}
      ${no('coins', 'VGV', brl(vgv), ret != null ? `${ret.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}x o investido` : '—', vgv ? 'ok' : '', 5)}
    </div>`;
  }).join('');
  el.innerHTML = head('zap', '#9ef01a', T, `<div class="ph-r"><span class="mini">${ic('triangle-alert', 12)} seta vermelha = perde 70% ou mais na passagem</span></div>`) + `<div class="fl">${linhas}</div>`;
}

function mRegiao() {
  const el = quadro('m-reg', 'map-pin', '#ff5c5c', 'Vazamento 1 · mídia fora da praça', 'geo'); if (!el) return;
  const G = ok('geo'), lim = num(G.threshold_pct) || 30;
  const camp = (G.by_campaign || []).filter(c => num(c.leads) >= 5 && c.pct_outras != null).sort((a, b) => num(b.pct_outras) - num(a.pct_outras)).slice(0, 4);
  const marcas = (G.by_brand || []).filter(m => m.pct_outras != null);
  el.innerHTML = head('map-pin', '#ff5c5c', 'Vazamento 1 · mídia fora da praça', `<div class="ph-r">${selo(G.alerta_global ? 'bad' : 'ok', G.alerta_global ? 'acima do limite' : 'dentro do limite')}</div>`) + `
    <div class="reg-top"><div class="reg-g">${gaugePct(num(G.pct_outras), lim)}</div>
      <div class="reg-t"><b>${fmtPct(G.pct_outras)}</b><span>dos leads com DDD vêm de fora de Rio Preto</span>
      ${marcas.map(m => `<span class="reg-m"><i class="dotc" style="background:${String(m.marca).toLowerCase().includes('conquista') ? '#ff8a1f' : '#f3ebcb'}"></i>${esc(m.marca)} <b style="color:${num(m.pct_outras) > lim ? 'var(--n-bad)' : 'var(--n-ok)'}">${fmtPct(m.pct_outras)}</b></span>`).join('')}</div></div>
    <div class="sub">Campanhas que mais trazem gente de fora</div>
    ${camp.length ? hbars(camp.map(c => ({ l: c.campanha || '—', s: `${int(c.leads)} leads · ${int(c.outras)} de fora`, v: num(c.pct_outras), fv: fmtPct(c.pct_outras), c: num(c.pct_outras) > lim ? '#ff5c5c' : '#ffb020' })), { linha: lim, max: 100 })
      : '<div class="wait ok">' + ic('circle-check', 16) + ' Nenhuma campanha fora do limite.</div>'}
    <div class="note muted">Região pelo DDD do telefone · traço = limite de ${pct(lim)}.</div>`;
}
function gaugePct(v, lim) {   // anel 0–100% com a marca do limite
  const R = 42, C = 2 * Math.PI * R, f = Math.min(100, v) / 100, cor = v > lim ? '#ff5c5c' : '#9ef01a';
  const a = -Math.PI / 2 + lim / 100 * 2 * Math.PI;
  return `<svg viewBox="0 0 110 110" class="ring"><circle cx="55" cy="55" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="11"/>
    <circle cx="55" cy="55" r="${R}" fill="none" stroke="${cor}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${f * C} ${C}" transform="rotate(-90 55 55)" style="filter:drop-shadow(0 0 6px ${cor})"/>
    <line x1="${55 + (R - 9) * Math.cos(a)}" y1="${55 + (R - 9) * Math.sin(a)}" x2="${55 + (R + 9) * Math.cos(a)}" y2="${55 + (R + 9) * Math.sin(a)}" stroke="#fff" stroke-width="2.5"/></svg>`;
}

function mVelocidade() {
  const el = quadro('m-vel', 'clock', '#ffb020', 'Vazamento 2 · lead esperando atendimento', 'crm'); if (!el) return;
  const B = ok('crm').brands || {};
  const ks = Object.keys(B).filter(k => k !== 'captacao' && num(B[k].leads ?? B[k].leads_criados) > 0);
  const maxH = Math.max(...ks.map(k => num(B[k].sla_horas_aprox)), ALVO_1O_CONTATO_H * 2, 1);
  el.innerHTML = head('clock', '#ffb020', 'Vazamento 2 · lead esperando atendimento') + (ks.length ? `
    <div class="sub">Tempo até o 1º contato</div>
    ${hbars(ks.map(k => { const b = B[k], h = nn(b.sla_horas_aprox); return { l: b.label || k, dot: FRENTE_COR[k] || '#9ef01a', v: h ?? 0, fv: h == null ? '—' : horas(h), c: h == null ? '#5b5f63' : h <= ALVO_1O_CONTATO_H ? '#9ef01a' : h <= 4 ? '#ffb020' : '#ff5c5c' }; }), { linha: ALVO_1O_CONTATO_H, max: maxH })}
    <div class="sub">Quanto do lead é trabalhado</div>
    <table class="tb"><thead><tr><th>Marca</th><th>Leads</th><th>Atendidos</th><th>Nunca atendidos</th><th>Visita</th></tr></thead><tbody>
    ${ks.map(k => { const b = B[k], L = num(b.leads ?? b.leads_criados), s = Math.max(0, L - num(b.leads_contatados)); return `<tr><td><i class="dotc" style="background:${FRENTE_COR[k] || '#9ef01a'}"></i>${esc(b.label || k)}</td><td>${int(L)}</td>
      <td style="color:${num(b.contact_rate) >= 80 ? 'var(--n-ok)' : num(b.contact_rate) >= 60 ? 'var(--n-warn)' : 'var(--n-bad)'}">${fmtPct(b.contact_rate)}</td>
      <td style="color:${s ? 'var(--n-bad)' : 'var(--n-ok)'};font-weight:700">${int(s)}</td><td>${fmtPct(b.visita_rate)}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="note muted">Traço branco = alvo de ${ALVO_1O_CONTATO_H} h. Lead de mídia esfria rápido: cada hora conta.</div>` : '<div class="wait muted">Sem leads no mês.</div>');
}

function mCanais() {
  const el = quadro('m-can', 'chart-pie', '#a78bfa', 'Qual canal vende de verdade · mês', 'crm'); if (!el) return;
  const A = ok('crm').global?.attribution || {}, rows = (A.by_channel || []).filter(r => r.channel !== 'nao_atribuido' || num(r.vendas));
  const maxV = Math.max(...rows.map(r => num(r.vgv)), 1);
  el.innerHTML = head('chart-pie', '#a78bfa', 'Qual canal vende de verdade · mês', `<div class="ph-r"><span class="mini">${A.coverage_pct != null ? `${fmtPct(A.coverage_pct)} do VGV com origem` : ''}</span></div>`) + (rows.length ? `
    <table class="tb can"><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th style="width:34%">VGV</th><th>Conversão</th></tr></thead><tbody>
    ${rows.map(r => { const conv = num(r.leads) ? num(r.vendas) / num(r.leads) * 100 : null; const pago = /pago|meta|ads|trafego/i.test(r.channel + r.label);
      return `<tr><td>${pago ? ic('megaphone', 12) : ''} ${esc(r.label || r.channel)}</td><td>${int(r.leads)}</td>
      <td style="color:${num(r.vendas) ? 'var(--n-ok)' : (num(r.leads) >= 20 ? 'var(--n-bad)' : 'inherit')};font-weight:700">${int(r.vendas)}</td>
      <td><span class="mbar"><i style="width:${num(r.vgv) / maxV * 100}%;background:#a78bfa"></i></span><small>${brl(r.vgv)}</small></td>
      <td>${conv == null ? '—' : fmtPct(conv)}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="note muted">Venda atribuída pela origem do negócio no RD. Canal com muito lead e zero venda aparece em vermelho.</div>` : '<div class="wait muted">Sem atribuição no mês.</div>');
}

function contasMkt() {
  const M = ok('mkt'); if (!M) return null;
  const th = ok('adsTh') || {}, cfg = th.contas || {};
  const acc = (M.accounts || []).map(a => ({ ...a, orc: num(cfg[a.id]?.orcamento_mes), alvo: nn(cfg[a.id]?.cpl) }));
  const t = acc.reduce((s, a) => ({ spend: s.spend + num(a.spend), res: s.res + num(a.results), orc: s.orc + a.orc }), { spend: 0, res: 0, orc: 0 });
  return { acc, t, M };
}
/* ═══════════════════════════ TELA 4 · FINANCEIRO ═══════════════════════════ */
const BLOQ = { nota_fiscal: 'Nota fiscal', assinatura_financiamento: 'Financiamento', liberacao_incorporadora: 'Incorporadora', outro: 'Outro', nenhum: 'Status travado' };
function fKpis() {
  const el = document.getElementById('f-kpis'); if (!el) return;
  const K = ok('receb')?.kpis || null, cx = calcCaixa(), res = nn(ind('p.resultado')?.valor), be = ok('caixa')?.breakeven;
  el.innerHTML = tilesHTML([
    { i: 'wallet', c: '#2ee6c5', t: 'Caixa (PSM HUB)', v: _d.hubPainel ? (cx == null ? '—' : brl(cx)) : null, d: '<span class="dl-s">saldo nas contas bancárias</span>' },
    { i: 'circle-check', c: '#9ef01a', t: 'Recebido no mês', v: K ? brl(K.recebido_mes) : (_d.receb?._err ? '—' : null), d: `<span class="dl-s">comissões que já entraram</span>` },
    { i: 'calendar', c: '#ffd23f', t: 'Previsto no mês', v: K ? brl(K.previsto_mes) : (_d.receb?._err ? '—' : null), d: K ? `<span class="dl-s">+ ${brl(K.confirmado_7d)} confirmados p/ 7 dias</span>` : '' },
    { i: 'octagon-x', c: '#ff5c5c', t: 'Recebíveis travados', v: K ? brl(K.travado_total) : (_d.receb?._err ? '—' : null), d: `<span class="dl-s">dinheiro parado por bloqueio</span>` },
    { i: res != null && res < 0 ? 'trending-down' : 'trending-up', c: res != null && res < 0 ? '#ff5c5c' : '#9ef01a', t: 'Resultado do mês (proj.)', v: res != null ? brl(res) : (_d.scorecard ? '—' : null), d: '<span class="dl-s">com pró-labore · Regra do Positivo</span>', sp: serieInd('p.resultado') },
    { i: 'gauge', c: '#a78bfa', t: 'Ponto de equilíbrio', v: be ? (be.cobertura_pct == null ? '—' : pct(be.cobertura_pct)) : (_d.caixa?._err ? '—' : null),
      d: be ? `<span class="dl-s">VGV mínimo ${brl(be.vgv_minimo)} · custo ${brl(be.custo_mes)}</span>` : '', bar: be ? num(be.cobertura_pct) : null, marca: be ? 100 : null },
  ]);
}
function fCaixa() {
  const el = quadro('f-caixa', 'chart-column', '#2ee6c5', 'Caixa projetado · 10 semanas', 'caixa'); if (!el) return;
  const C = ok('caixa').caixa || {}, S = C.semanas || [];
  if (!S.length) { el.innerHTML = head('chart-column', '#2ee6c5', 'Caixa projetado · 10 semanas') + '<div class="wait muted">Sem projeção.</div>'; return; }
  const W = 1000, H = 220, pad = 8, bw = (W - pad * 2) / S.length;
  const mx = Math.max(...S.map(s => Math.max(num(s.entra_total), num(s.sai_total))), 1);
  const acc = S.map(s => num(s.acumulado)); const amx = Math.max(...acc.map(Math.abs), 1);
  const mid = H / 2, y = v => mid - v / mx * (mid - 12), ya = v => mid - v / amx * (mid - 12);
  const barras = S.map((s, i) => { const x = pad + i * bw; return `<rect x="${x + bw * .18}" y="${y(num(s.entra_total))}" width="${bw * .3}" height="${mid - y(num(s.entra_total))}" rx="2" fill="#9ef01a" opacity=".85"><title>entra ${brl(s.entra_total)}</title></rect>
    <rect x="${x + bw * .52}" y="${mid}" width="${bw * .3}" height="${mid - y(num(s.sai_total))}" rx="2" fill="#ff5c5c" opacity=".8"><title>sai ${brl(s.sai_total)}</title></rect>`; }).join('');
  const linha = acc.map((v, i) => `${i ? 'L' : 'M'}${pad + i * bw + bw / 2},${ya(v)}`).join('');
  const furo = C.furo;
  el.innerHTML = head('chart-column', '#2ee6c5', 'Caixa projetado · 10 semanas', `<div class="ph-r"><span class="lgd"><i style="background:#9ef01a"></i>entra</span><span class="lgd"><i style="background:#ff5c5c"></i>sai</span><span class="lgd"><i style="background:#ffd23f;height:3px"></i>saldo acumulado</span></div>`) + `
    ${furo ? `<div class="alerta">${ic('triangle-alert', 16)} <b>Furo de caixa previsto na semana de ${esc(furo.slice(8, 10) + '/' + furo.slice(5, 7))}</b> — o acumulado fica negativo.</div>` : `<div class="alerta ok">${ic('circle-check', 16)} Sem furo nas próximas 10 semanas${C.posicao_inicial != null ? ` · posição inicial ${brl(C.posicao_inicial)}` : ''}.</div>`}
    <div class="chart"><svg class="colsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="rgba(255,255,255,.18)"/>${barras}
      <path d="${linha}" fill="none" stroke="#ffd23f" stroke-width="2.4" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 5px #ffd23f)"/></svg></div>
    <div class="ax-x wk">${S.map(s => `<span title="saldo acumulado ${brl(s.acumulado)}">${esc(String(s.ini).slice(8, 10) + '/' + String(s.ini).slice(5, 7))}<b style="color:${num(s.acumulado) < 0 ? 'var(--n-bad)' : 'var(--n-ink2)'}">${eixo(Math.abs(num(s.acumulado))).replace('R$ ', num(s.acumulado) < 0 ? '−' : '')}</b></span>`).join('')}</div>`;
}
function fResgate() {
  const el = quadro('f-resg', 'rocket', '#ffd23f', 'Plano de Resgate · amortecedor', 'resgate'); if (!el) return;
  const R = ok('resgate'), A = R.real?.amortecedor, mes = (R.plano?.meses || []).find(m => m.id === R.real?.mes_id);
  const sem = { verde: 'ok', amarelo: 'warn', vermelho: 'bad' }[A?.semaforo] || 'mute';
  const gateOk = mes && R.plano?.checklist?.[`${mes.id}:gate`];
  el.innerHTML = head('rocket', '#ffd23f', 'Plano de Resgate · amortecedor', `<div class="ph-r">${selo(sem, A ? 'semáforo ' + A.semaforo : 'sem cálculo')}</div>`) + (A ? `
    <dl class="kv big">
      <div><dt>Conta cheia do mês</dt><dd>${brl(A.conta_cheia)}</dd></div>
      <div><dt>Contribuição Conquista (real)</dt><dd>${brl(A.contrib_conquista_real)}</dd></div>
      <div><dt>Contribuição Conquista (projetada)</dt><dd>${brl(A.contrib_conquista_projetada)}</dd></div>
      <div><dt>Venda própria já feita</dt><dd>${brl(A.proprio_ja_vendido)}</dd></div>
      <div><dt>Venda própria necessária</dt><dd>${brl(A.proprio_necessario_total)}</dd></div>
      <div><dt>Falta de venda própria</dt><dd style="color:${num(A.falta_proprio) > 0 ? 'var(--n-bad)' : 'var(--n-ok)'}">${brl(A.falta_proprio)}</dd></div>
    </dl>
    ${mes ? `<div class="gate ${gateOk ? 'ok' : ''}">${ic(gateOk ? 'circle-check' : 'target', 15)}<div><b>Gate de ${esc(mes.nome || mes.id)}</b><small>${esc(mes.gate || '')}</small></div></div>` : ''}` : '<div class="wait muted">Amortecedor sem cálculo neste mês.</div>');
}
function fTravados() {
  const el = quadro('f-trav', 'octagon-x', '#ff5c5c', 'Recebíveis travados · por motivo', 'receb'); if (!el) return;
  const K = ok('receb').kpis || {}, T = K.travado || {};
  const rows = Object.entries(T).filter(([, v]) => num(v) > 0).sort((a, b) => num(b[1]) - num(a[1]));
  const n = (ok('receb').itens || []).filter(i => i.status === 'travado' || (i.bloqueio && i.bloqueio !== 'nenhum')).filter(i => !['recebido', 'perdido'].includes(i.status)).length;
  el.innerHTML = head('octagon-x', '#ff5c5c', 'Recebíveis travados · por motivo', `<div class="ph-r"><span class="mini">${int(n)} itens</span></div>`) + `
    <div class="tot"><b style="color:#ff5c5c;text-shadow:0 0 16px rgba(255,92,92,.5)">${brl(K.travado_total)}</b><small>parados esperando destravar</small></div>
    ${rows.length ? hbars(rows.map(([k, v]) => ({ l: BLOQ[k] || k, v: num(v), fv: brl(v), c: '#ff5c5c' }))) : `<div class="wait ok">${ic('circle-check', 16)} Nada travado.</div>`}
    <div class="note muted">Soma do líquido estimado; itens sem valor não entram.</div>`;
}
function fProximos() {
  const el = quadro('f-prox', 'calendar', '#9ef01a', 'Próximos recebimentos', 'caixa'); if (!el) return;
  const P = (ok('caixa').caixa?.proximos || []).slice(0, 7);
  const cst = { confirmado: 'var(--n-ok)', previsto: 'var(--n-warn)', travado: 'var(--n-bad)' };
  el.innerHTML = head('calendar', '#9ef01a', 'Próximos recebimentos') + (P.length ? `<ul class="acts">${P.map(p => `<li style="--ic:${cst[p.status] || '#7b8378'}">
      <div><b>${esc(p.desc || '—')}</b><small><i class="dotc" style="background:${FRENTE_COR[p.frente] || '#7b8378'}"></i>${esc(p.status || '')}${p.bloqueio && p.bloqueio !== 'nenhum' ? ' · ' + esc(BLOQ[p.bloqueio] || p.bloqueio) : ''}${p.corretor ? ' · ' + esc(primeiro(p.corretor)) : ''}</small></div>
      <time style="text-align:right">${brl(p.valor)}${p.estimado ? '*' : ''}<br><span class="muted">${p.data ? esc(p.data.slice(8, 10) + '/' + p.data.slice(5, 7)) : 'sem data'}</span></time></li>`).join('')}</ul>
      <div class="note muted">* valor estimado</div>` : '<div class="wait muted">Nenhum recebimento previsto.</div>');
}
function fContas() {
  const el = document.getElementById('f-contas'); if (!el) return;
  const T = 'Contas a pagar e a receber · HUB';
  if (!_d.hubContas) { el.innerHTML = head('banknote', '#ffb020', T) + esperando; return; }
  const c = calcContas();
  if (!c) { el.innerHTML = head('banknote', '#ffb020', T) + falhou(_d.hubContas?._err || 'contas do Hub indisponíveis'); return; }
  el.innerHTML = head('banknote', '#ffb020', T) + `
    <div class="cc">
      <div class="cc-b bad"><span>A pagar vencido</span><b>${brl(c.pv)}</b></div>
      <div class="cc-b warn"><span>A receber vencido</span><b>${brl(c.rv)}</b></div>
      <div class="cc-b"><span>A pagar em 7 dias</span><b>${brl(c.p7)}</b></div>
      <div class="cc-b"><span>A receber em 7 dias</span><b>${brl(c.r7)}</b></div>
    </div>
    ${hbars([{ l: 'Sai em 7 dias', v: c.p7 + c.pv, fv: brl(c.p7 + c.pv), c: '#ff5c5c' }, { l: 'Entra em 7 dias', v: c.r7 + c.rv, fv: brl(c.r7 + c.rv), c: '#9ef01a' }])}
    <div class="note muted">Inclui o que já venceu e ainda não foi pago/recebido.</div>`;
}
function fBreakeven() {
  const el = quadro('f-be', 'target', '#a78bfa', 'Ponto de equilíbrio por frente', 'caixa'); if (!el) return;
  const B = ok('caixa').breakeven || {}, F = B.por_frente || [];
  el.innerHTML = head('target', '#a78bfa', 'Ponto de equilíbrio por frente', `<div class="ph-r">${selo({ coberto: 'ok', perto: 'warn', descoberto: 'bad' }[B.farol] || 'mute', B.farol || 'sem cálculo')}</div>`) + (F.length ? `
    <table class="tb"><thead><tr><th>Frente</th><th>Margem</th><th>Peso</th><th>VGV mínimo</th><th>Vendas mín.</th></tr></thead><tbody>
    ${F.map(f => `<tr><td><i class="dotc" style="background:${FRENTE_COR[f.id] || '#7b8378'}"></i>${esc(f.nome || f.id)}</td><td>${fmtPct(f.margem_pct)}</td><td>${fmtPct(f.share_pct)}</td><td>${brl(f.vgv_min)}</td><td>${f.vendas_min == null ? '—' : num(f.vendas_min).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>`).join('')}
    </tbody></table>
    <div class="note muted">Quanto cada frente precisa vender no mês pra pagar ${brl(B.custo_mes)} de custo, no mix atual.</div>` : '<div class="wait muted">Sem cálculo de equilíbrio.</div>');
}

/* ═══════════════════════════ TELA 5 · PILARES (Farol completo) ═══════════════════════════ */
function pTodos() {
  const el = document.getElementById('p-all'); if (!el) return;
  const sc = _d.scorecard;
  if (!sc) { el.innerHTML = `<section class="pn">${esperando}</section>`; return; }
  if (!ok('scorecard')) { el.innerHTML = `<section class="pn">${falhou(sc._err)}</section>`; return; }
  const H = ok('hist'), L = ok('locdash')?.carteira;
  const cor = k => ({ ok: '#9ef01a', warn: '#ffb020', bad: '#ff5c5c', mute: '#7b8378' }[k]);
  const fmt = (v, un) => v == null ? '—' : un === 'R$' ? brl(v) : un === '%' ? pct(v) : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  el.innerHTML = sc.scorecards.map((s, n) => {
    const k = saudeEst(s.saude);
    const serie = (H?.saude?.[s.id] || []).map((x, i, a) => i === a.length - 1 ? s.saude : x);
    const inds = [...(s.indicadores || [])].sort((a, b) => ({ vermelho: 0, amarelo: 1, verde: 2, info: 3, cinza: 4 }[a.farol] ?? 5) - ({ vermelho: 0, amarelo: 1, verde: 2, info: 3, cinza: 4 }[b.farol] ?? 5));
    const extra = s.id === 'un_locacao' && L ? `<div class="p-ex">${ic('key', 12)} ${int(L.ativos)} contratos · aluguel ${brl(L.aluguel_mes)}/mês · vencem ${int(L.vence_30)}/${int(L.vence_60)}/${int(L.vence_90)} em 30/60/90d</div>` : '';
    return `<a class="pn pc" href="#/scorecard" style="--pk:${cor(k)};animation-delay:${n * 40}ms">
      <div class="pc-h"><div><b>${esc(s.nome)}</b><small>${esc(primeiro(s.dono_nome || s.dono))} · ${s.avaliados}/${s.total} avaliados</small></div>
        <span class="pc-s">${s.saude == null ? '—' : s.saude}</span></div>
      ${serie.filter(x => x != null).length > 1 ? spark(serie, cor(k)) : '<div class="spark-empty sm"></div>'}
      <ul class="pc-i">${inds.map(i => { const p = i.meta ? num(i.valor) / i.meta * 100 : null; const ik = farolEst(i.farol);
        return `<li title="${esc(i.label)}${i.nota ? ' — ' + esc(i.nota) : ''}${i.motivo ? ' (' + esc(i.motivo) + ')' : ''}"><i style="background:${i.farol === 'info' ? '#6ec1ff' : cor(ik)}"></i><span>${esc(i.label)}</span>
          <b>${fmt(nn(i.valor), i.un)}</b><small>${i.meta != null ? '/ ' + fmt(i.meta, i.un) : i.valor == null ? esc(i.motivo || '') : ''}</small>
          ${p != null ? `<span class="pb"><em style="width:${Math.min(100, p)}%;background:${cor(ik)}"></em></span>` : '<span class="pb vazio"></span>'}</li>`; }).join('')}</ul>${extra}
    </a>`;
  }).join('');
}

/* ─────────────────────────── ESTILO ─────────────────────────── */
const CSS = `
body.tv-mode .app-sidebar, body.tv-mode .app-header { display:none !important; }
body.tv-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
body.tv-mode .app-main { padding:0; min-height:100vh; background:#050607; }
.tvd { --n-bg:#050607; --n-pn:#0b0e0d; --n-bd:rgba(158,240,26,.13); --n-ink:#f2f5ef; --n-ink2:#b9c0b4; --n-mute:#7b8378;
  --n-ok:#9ef01a; --n-warn:#ffb020; --n-bad:#ff5c5c; --n-lime:#9ef01a;
  --gap:clamp(8px, .7vw, 14px);
  color:var(--n-ink); font-family:'Geist', system-ui, sans-serif; min-height:100vh; box-sizing:border-box; padding:clamp(10px, .9vw, 18px);
  display:flex; flex-direction:column; gap:var(--gap);
  background: radial-gradient(900px 420px at 30% -8%, rgba(158,240,26,.09), transparent 60%), radial-gradient(700px 380px at 100% 100%, rgba(255,138,31,.06), transparent 60%), var(--n-bg); }
.tvd .spinner { border-color:rgba(255,255,255,.15); border-top-color:var(--n-lime) }
.tvd a { color:inherit; text-decoration:none }
.tvd .muted { color:var(--n-mute) }
.glowt { text-shadow:0 0 18px rgba(158,240,26,.55) }

/* cabeçalho */
.hd { display:flex; align-items:center; gap:clamp(14px, 1.4vw, 26px) }
.logo { display:flex; flex-direction:column; line-height:1; padding-right:clamp(14px, 1.4vw, 26px); border-right:1px solid var(--n-bd) }
.lg { font-size:clamp(28px, 2.2vw, 42px); font-weight:700; letter-spacing:.06em; color:var(--n-lime); text-shadow:0 0 22px rgba(158,240,26,.6) }
.lg-s { font-size:11px; letter-spacing:.42em; text-transform:uppercase; color:var(--n-ink2); margin-top:4px }
.ttl h1 { margin:0; font-size:clamp(22px, 1.9vw, 36px); font-weight:650; letter-spacing:-.02em; color:#fff }
.ttl p { margin:2px 0 0; font-size:clamp(12px, .8vw, 15px); color:var(--n-ink2) }
.chips { margin-left:auto; display:flex; gap:8px; align-items:center }
.chip { display:inline-flex; align-items:center; gap:8px; height:38px; padding:0 14px; border-radius:10px; background:var(--n-pn); border:1px solid var(--n-bd); color:var(--n-ink2); font-size:13px; white-space:nowrap }
.chip.dt span { text-transform:capitalize }
.chip.live { color:var(--n-lime) } .chip.live i { width:8px; height:8px; border-radius:50%; background:var(--n-lime); box-shadow:0 0 10px var(--n-lime); animation:nPulse 1.6s infinite }
.chip.clk { font-size:22px; font-weight:600; color:#fff; letter-spacing:.02em; min-width:88px; justify-content:center }
.chip.btn { width:38px; padding:0; justify-content:center; cursor:pointer } .chip.btn:hover { color:#fff; border-color:rgba(158,240,26,.45) }
@keyframes nPulse { 50% { opacity:.35 } }
.rec > div { display:flex; align-items:center; gap:10px; padding:8px 14px; border-radius:10px; background:rgba(255,92,92,.12); border:1px solid rgba(255,92,92,.35); color:#ffb3b3; font-size:14px }
.rec b { color:#fff }

/* KPIs */
.kpis { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:var(--gap); flex:none }
.kpi { position:relative; overflow:hidden; background:linear-gradient(160deg, color-mix(in srgb, var(--kc) 9%, var(--n-pn)), var(--n-pn) 55%); border:1px solid color-mix(in srgb, var(--kc) 28%, transparent);
  border-radius:14px; padding:12px 14px 0; display:flex; flex-direction:column; min-width:0; animation:nIn .6s both }
.kpi::before { content:''; position:absolute; inset:0 0 auto; height:2px; background:linear-gradient(90deg, transparent, var(--kc), transparent); opacity:.8 }
.k-top { display:flex; align-items:center; gap:10px }
.k-ic { width:38px; height:38px; flex:none; display:grid; place-items:center; border-radius:10px; color:var(--kc); background:color-mix(in srgb, var(--kc) 15%, transparent); box-shadow:0 0 18px color-mix(in srgb, var(--kc) 25%, transparent) }
.k-t { font-size:clamp(12px, .74vw, 14px); color:var(--n-ink2); line-height:1.2 }
.k-t::first-letter { text-transform:uppercase }
.k-v { margin-top:8px; font-size:clamp(22px, 1.75vw, 34px); font-weight:650; letter-spacing:-.02em; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 0 16px color-mix(in srgb, var(--kc) 40%, transparent) }
.k-v small { font-size:.5em; color:var(--n-mute); font-weight:500 }
.k-d { display:flex; align-items:center; gap:6px; font-size:12px; margin-top:2px; min-height:18px; white-space:nowrap; overflow:hidden }
.dl { display:inline-flex; align-items:center; gap:2px; font-weight:600 } .dl.up { color:var(--n-ok) } .dl.dn { color:var(--n-bad) }
.dl-s { color:var(--n-mute); overflow:hidden; text-overflow:ellipsis }
.spark { width:calc(100% + 28px); margin:6px -14px 0; height:38px; display:block }
.spark-empty { height:44px }
.k-bar { margin:14px 0 22px; height:8px; border-radius:4px; background:rgba(255,255,255,.07); overflow:hidden }
.k-bar i { display:block; height:100%; border-radius:4px; background:linear-gradient(90deg, color-mix(in srgb, var(--kc) 50%, transparent), var(--kc)); box-shadow:0 0 12px var(--kc); animation:nGrow 1.2s both }

/* grade */
.g2 { display:grid; grid-template-columns: 1.55fr 1.1fr 1fr; gap:var(--gap); flex:1 1 0; min-height:0 }
.g3 { display:grid; grid-template-columns: 1.05fr 1.2fr .8fr 1.05fr; gap:var(--gap); flex:1 1 0; min-height:0 }
.stack { display:flex; flex-direction:column; gap:var(--gap); min-height:0 } .stack .pn { flex:1 1 0 }
.pn { position:relative; background:var(--n-pn); border:1px solid var(--n-bd); border-radius:14px; padding:12px 14px; min-width:0; min-height:0; overflow:hidden; display:flex; flex-direction:column; animation:nIn .7s both;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03) }
@keyframes nIn { from { opacity:0; transform:translateY(8px) } }
@keyframes nGrow { from { width:0 } }
.ph { display:flex; align-items:center; gap:10px; margin-bottom:8px; flex:none; min-width:0 }
.pi { width:28px; height:28px; flex:none; display:grid; place-items:center; border-radius:8px; color:var(--ic); background:color-mix(in srgb, var(--ic) 15%, transparent) }
.ph h3 { margin:0; font-size:clamp(14px, .9vw, 17px); font-weight:600; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0 }
.ph h3::first-letter { text-transform:uppercase }
.ph-r { margin-left:auto; display:flex; gap:6px; align-items:center; flex:none }
.mini { font-size:12px; color:var(--n-mute); display:inline-flex; align-items:center; gap:5px }
.lgd { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--n-ink2) } .lgd i { width:10px; height:10px; border-radius:3px } .lgd i.ln { height:0; border-top:2px dashed rgba(255,255,255,.6); border-radius:0 }
.selo { display:inline-flex; align-items:center; gap:4px; padding:3px 9px 3px 7px; border-radius:99px; font-size:12px; font-weight:600; color:var(--sc); background:color-mix(in srgb, var(--sc) 14%, transparent); border:1px solid color-mix(in srgb, var(--sc) 30%, transparent); white-space:nowrap }
.wait { padding:20px 0; font-size:14px; display:flex; align-items:center; gap:8px } .wait.ok { color:var(--n-ok) }

/* ano */
.ano-top { display:flex; align-items:flex-start; gap:14px; flex:none }
.ano-top > div:first-child { display:flex; flex-direction:column }
.lbl { font-size:12px; color:var(--n-mute) }
.ano-top b { font-size:clamp(24px, 1.9vw, 36px); font-weight:650; letter-spacing:-.02em; color:#fff }
.ano-top small { font-size:12.5px; color:var(--n-ink2) }
.callout { margin-left:auto; padding:8px 12px; border-radius:10px; border:1px solid rgba(158,240,26,.3); background:rgba(158,240,26,.06); display:flex; flex-direction:column; align-items:flex-end }
.callout span { font-size:11px; color:var(--n-mute) } .ano-top .callout b { font-size:18px; color:var(--n-lime); text-shadow:0 0 12px rgba(158,240,26,.5) } .callout small { font-size:11px }
.area { width:100%; flex:1; min-height:110px; margin-top:6px; overflow:visible; display:block }
.area .grid { stroke:rgba(255,255,255,.06); stroke-width:1 }
.area .ax { font-size:11px; fill:var(--n-mute); font-family:inherit } .area .ax.on { fill:#fff; font-weight:700 } .area .ax.hi { fill:var(--n-lime); font-weight:600 }
.a-line { filter:drop-shadow(0 0 6px rgba(158,240,26,.8)); stroke-dasharray:1000; stroke-dashoffset:1000; animation:nDraw 1.6s .2s ease-out forwards }
@keyframes nDraw { to { stroke-dashoffset:0 } }
.a-fill { animation:nFade 1.2s .6s both } @keyframes nFade { from { opacity:0 } }

/* funil */
.fsvg { width:100%; flex:1; min-height:0; overflow:visible }
.f-sl { filter:drop-shadow(0 0 8px rgba(158,240,26,.45)); animation:nFade .7s both }
.f-v { font-size:21px; font-weight:700; fill:#fff; font-family:inherit; paint-order:stroke; stroke:rgba(0,0,0,.55); stroke-width:3 }
.core { filter:drop-shadow(0 0 10px #9ef01a) drop-shadow(0 0 22px #9ef01a); animation:nPulse 2.2s infinite }
.f-l { font-size:15px; fill:#fff; font-weight:600; font-family:inherit } .f-m { font-size:12.5px; fill:var(--n-ink2); font-family:inherit } .f-c { font-size:11.5px; fill:var(--n-mute); font-family:inherit }

/* pipeline */
.pipe { display:grid; grid-template-columns: minmax(110px, 1fr) 1.1fr; gap:10px; align-items:center; flex:1; min-height:0 }
.donut { width:100%; max-height:100%; min-height:0 }
.donut circle { animation:nFade 1s both }
.dc-s { font-size:11px; fill:var(--n-mute); font-family:inherit } .dc-v { font-size:17px; font-weight:700; fill:#fff; font-family:inherit }
.lg-l { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px; min-width:0 }
.lg-l li { display:grid; grid-template-columns:10px 1fr auto; gap:2px 8px; align-items:center; font-size:13px }
.lg-l i { width:10px; height:10px; border-radius:3px; box-shadow:0 0 8px currentColor } .lg-l span { text-transform:capitalize; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .lg-l b { font-weight:700 }
.lg-l small { grid-column:2 / 4; font-size:11px; color:var(--n-mute) }
.lg-l.tight { gap:4px } .lg-l.tight small { display:none }
.note { flex:none; font-size:11.5px; color:var(--n-warn); display:flex; align-items:center; gap:6px; margin-top:6px }

/* ranking */
.rank { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; flex:1; justify-content:space-around; min-height:0 }
.rank li { display:grid; grid-template-columns:22px minmax(64px, .9fr) 1.2fr auto; gap:8px; align-items:center; font-size:13px; animation:nIn .5s both }
.rk { width:22px; height:22px; display:grid; place-items:center; border-radius:6px; font-size:11px; font-weight:700; color:var(--n-mute); background:rgba(255,255,255,.05) }
.rk.p1 { color:#1a1400; background:#ffd23f; box-shadow:0 0 12px rgba(255,210,63,.6) } .rk.p2 { color:#111; background:#d7dbe0 } .rk.p3 { color:#1a0c00; background:#d98a4a }
.rn { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#fff; font-weight:500 } .rn small { color:var(--n-mute); font-weight:400 }
.rb { position:relative; height:10px; border-radius:5px; background:rgba(255,255,255,.05) }
.rb i { position:absolute; left:0; top:0; bottom:0; border-radius:5px; box-shadow:0 0 10px currentColor; animation:nGrow 1s both }
.rb b { position:absolute; top:-3px; bottom:-3px; width:2px; background:#fff; opacity:.85 }
.rv { text-align:right; font-weight:650; white-space:nowrap; display:flex; flex-direction:column; line-height:1.15 } .rv small { font-size:10.5px; font-weight:400; color:var(--n-mute) }
.lg-row { flex:none; display:flex; gap:12px; margin-top:6px }

/* pilares */
.pil { display:flex; flex-direction:column; flex:1; min-height:0 }
.pr { display:grid; grid-template-columns: minmax(96px, 1fr) 2fr 30px; gap:8px; align-items:center; flex:1; min-height:0 }
.pr.hdr { flex:none; font-size:10.5px; color:var(--n-mute); padding-bottom:3px } .pr.hdr .cls span { text-align:center } .pr.hdr .cls span.on { color:#fff; font-weight:700 }
.pnm { font-size:12.5px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .pnm small { margin-left:6px; color:var(--n-mute); font-size:11px }
.cls { display:grid; gap:2px; height:100%; padding:1.5px 0 }
.cl { display:grid; place-items:center; border-radius:3px; font-size:9.5px; font-family:'Geist Mono', ui-monospace, monospace; color:rgba(255,255,255,.88); min-height:0; overflow:hidden;
  background:color-mix(in srgb, var(--cc) 34%, #0b0e0d) }
.cl.nd { background:rgba(255,255,255,.025) }
.cl.on { background:var(--cc); color:#050607; font-weight:700; box-shadow:0 0 10px var(--cc) }
.psc { font-size:15px; font-weight:700; text-align:right }

/* conta cheia */
.gwrap { display:flex; flex-direction:column; align-items:center; flex:1; min-height:0; justify-content:center }
.gauge { width:100%; max-width:220px; min-height:0; overflow:visible }
.g-arc { animation:nFade 1s both }
.g-v { font-size:30px; font-weight:700; font-family:inherit }
.g-m { font-size:10px; fill:var(--n-ink2); font-family:inherit }
.g-cap { font-size:11.5px; color:var(--n-mute); text-align:center; line-height:1.3 }
.kv { margin:8px 0 0; flex:none }
.kv > div { display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-top:1px solid rgba(255,255,255,.06); font-size:12.5px }
.kv dt { color:var(--n-ink2); white-space:nowrap } .kv dd { margin:0; font-weight:650; white-space:nowrap }

/* ação / ao vivo */
.big-n { font-size:24px; font-weight:700; text-shadow:0 0 14px currentColor }
.acts, .feed { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; min-height:0; overflow:hidden }
.acts li { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:baseline; padding:5px 0 5px 10px; position:relative; border-top:1px solid rgba(255,255,255,.05); font-size:12.5px }
.acts li::before { content:''; position:absolute; left:0; top:7px; bottom:7px; width:3px; border-radius:2px; background:var(--ic); box-shadow:0 0 8px var(--ic) }
.acts b, .feed b { font-weight:500; color:#fff; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.acts small, .feed small { color:var(--n-mute); font-size:11px }
.acts > li > div, .feed > li > div { min-width:0 }
.acts time, .feed time { font-size:11px; color:var(--n-mute); white-space:nowrap } .acts time.venc { color:var(--n-bad); font-weight:700 }
.more { font-size:11.5px; color:var(--n-lime); margin-top:auto; padding-top:4px }
.feed li { display:grid; grid-template-columns:26px 1fr auto; gap:8px; align-items:center; padding:4px 0; font-size:12.5px }
.fi { width:26px; height:26px; display:grid; place-items:center; border-radius:8px; color:#ffd23f; background:rgba(255,210,63,.12) }
.who { display:flex; gap:4px; margin-top:auto; padding-top:6px; flex-wrap:wrap }
.who span { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-size:10px; font-weight:700; color:#050607; background:var(--n-lime); box-shadow:0 0 8px rgba(158,240,26,.5) }

/* insights */
.ins { display:flex; align-items:center; gap:clamp(12px, 1.2vw, 24px); padding:10px 16px; border-radius:14px; background:var(--n-pn); border:1px solid var(--n-bd); flex:none; overflow:hidden }
.ins-h { display:inline-flex; align-items:center; gap:8px; font-weight:650; color:var(--n-lime); font-size:clamp(14px, .9vw, 17px); white-space:nowrap; padding-right:clamp(12px, 1.2vw, 24px); border-right:1px solid var(--n-bd) }
.ins-i { display:flex; align-items:center; gap:10px; font-size:clamp(12px, .74vw, 14px); color:var(--n-ink2); min-width:0; flex:1; line-height:1.3 }
.ins-i + .ins-i { padding-left:clamp(12px, 1.2vw, 24px); border-left:1px solid rgba(255,255,255,.06) }
.ins-i b { color:#fff; font-weight:600 }
.ins-ic { width:32px; height:32px; flex:none; display:grid; place-items:center; border-radius:9px; color:var(--ic); background:color-mix(in srgb, var(--ic) 14%, transparent) }

/* celebração */
.cel { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:80; display:flex; align-items:center; gap:20px; padding:26px 40px; border-radius:22px;
  background:rgba(8,14,4,.94); border:1px solid var(--n-lime); box-shadow:0 0 0 1px rgba(158,240,26,.3), 0 0 80px rgba(158,240,26,.45); animation:nPop .6s cubic-bezier(.2,.9,.3,1.3) both }
.cel-ic { width:64px; height:64px; display:grid; place-items:center; border-radius:16px; color:#1a1400; background:#ffd23f; box-shadow:0 0 30px rgba(255,210,63,.7) }
.cel span { font-size:13px; letter-spacing:.24em; text-transform:uppercase; color:var(--n-lime) } .cel b { display:block; font-size:30px; font-weight:700; color:#fff } .cel small { font-size:16px; color:var(--n-ink2) }
@keyframes nPop { from { opacity:0; transform:translate(-50%,-50%) scale(.8) } }

/* abas das telas */
.tabs { display:flex; gap:6px; flex:none; align-items:center }
.tab { position:relative; overflow:hidden; display:inline-flex; align-items:center; gap:8px; height:36px; padding:0 14px; border-radius:10px; border:1px solid var(--n-bd); background:var(--n-pn); color:var(--n-ink2); font:inherit; font-size:13.5px; font-weight:600; cursor:pointer }
.tab:hover { color:#fff; border-color:rgba(158,240,26,.4) }
.tab .tn { width:18px; height:18px; display:grid; place-items:center; border-radius:5px; font-size:11px; background:rgba(255,255,255,.06); color:var(--n-mute) }
.tab.on { color:#050607; background:var(--n-lime); border-color:var(--n-lime); box-shadow:0 0 18px rgba(158,240,26,.45) }
.tab.on .tn { background:rgba(0,0,0,.18); color:#050607 }
.tab .prog { position:absolute; left:0; bottom:0; height:3px; width:100%; background:rgba(0,0,0,.45); transform-origin:left; animation:nProg linear both }
@keyframes nProg { from { transform:scaleX(0) } to { transform:scaleX(1) } }
.tab.auto { margin-left:auto; font-weight:500; font-size:12.5px } .tab.auto.on { background:rgba(158,240,26,.12); color:var(--n-lime); box-shadow:none }
.body { flex:1 1 0; min-height:0; display:flex; flex-direction:column; gap:var(--gap) }
.tvd.calmo .tab .prog { animation:nProg linear both !important }

/* comuns */
.k-bar { position:relative } .k-bar b { position:absolute; top:-3px; bottom:-3px; width:2px; background:#fff; opacity:.9 }
.chart { flex:1; min-height:60px; position:relative }
.colsvg { width:100%; height:100%; display:block; overflow:visible }
.ax-x { display:flex; justify-content:space-between; font-size:11px; color:var(--n-mute); margin-top:4px; flex:none }
.ax-x.wk span { display:flex; flex-direction:column; align-items:center; flex:1 } .ax-x.wk b { font-size:10.5px; font-weight:600 }
.tot { display:flex; align-items:baseline; gap:10px; flex:none; margin-bottom:4px } .tot b { font-size:clamp(22px, 1.6vw, 30px); font-weight:650; color:#fff } .tot small { font-size:12px; color:var(--n-mute) }
.sub { margin:8px 0 4px; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--n-mute); flex:none }
.hb { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px; flex:none }
.hb li { display:grid; grid-template-columns:minmax(90px, 1.1fr) 1.4fr auto; gap:10px; align-items:center; font-size:12.5px; animation:nIn .5s both }
.hb-l { color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; flex-direction:column } .hb-l i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:6px } .hb-l small { color:var(--n-mute); font-size:10.5px }
.hb-b { position:relative; height:10px; border-radius:5px; background:rgba(255,255,255,.05) } .hb-b i { position:absolute; left:0; top:0; bottom:0; border-radius:5px; box-shadow:0 0 10px currentColor; animation:nGrow 1s both }
.hb-b b { position:absolute; top:-4px; bottom:-4px; width:2px; background:#fff }
.hb-v { font-weight:650; white-space:nowrap; text-align:right }
.tb { width:100%; border-collapse:collapse; font-size:12.5px; font-variant-numeric:tabular-nums }
.tb th { text-align:left; font-weight:500; font-size:11px; color:var(--n-mute); padding:0 6px 6px 0; border-bottom:1px solid rgba(255,255,255,.08); white-space:nowrap }
.tb td { padding:6px 6px 6px 0; border-bottom:1px solid rgba(255,255,255,.05); white-space:nowrap; color:#fff }
.tb td:first-child { max-width:180px; overflow:hidden; text-overflow:ellipsis }
.tb small { color:var(--n-mute); font-size:10.5px; margin-left:4px }
.dotc { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:7px; vertical-align:1px }
.hdot { display:inline-grid; place-items:center; min-width:30px; height:20px; padding:0 6px; border-radius:6px; font-size:11px; font-weight:700; color:#050607; background:var(--hc); box-shadow:0 0 8px var(--hc) }
.mbar { position:relative; display:inline-block; width:70%; height:7px; border-radius:4px; background:rgba(255,255,255,.07); vertical-align:middle } .mbar i { position:absolute; left:0; top:0; bottom:0; border-radius:4px } .mbar b { position:absolute; top:-3px; bottom:-3px; width:2px; background:#fff }
.alerta { flex:none; display:flex; align-items:center; gap:8px; padding:7px 12px; border-radius:10px; font-size:13px; background:rgba(255,92,92,.12); border:1px solid rgba(255,92,92,.35); color:#ffc4c4; margin-bottom:6px }
.alerta b { color:#fff } .alerta.ok { background:rgba(158,240,26,.08); border-color:rgba(158,240,26,.3); color:var(--n-lime) }

/* tela 2 — comercial */
.eq4 { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:var(--gap); flex:1.15 1 0; min-height:0 }
.eq { border-top:2px solid var(--ec) }
.eq-v { display:flex; flex-direction:column; flex:none } .eq-v b { font-size:clamp(24px, 1.9vw, 36px); font-weight:650; letter-spacing:-.02em; color:#fff; text-shadow:0 0 16px color-mix(in srgb, var(--ec) 45%, transparent) } .eq-v small { font-size:12px; color:var(--n-ink2) }
.eq-m { flex:none; margin:8px 0 6px } .eq-m .k-bar { margin:0 0 5px } .eq-m span { font-size:12px; color:var(--n-ink2) } .eq-m span b { color:#fff }
.eq-f { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; justify-content:space-around; flex:1; min-height:0 }
.eq-f li { display:grid; grid-template-columns:92px 1fr 44px 78px; gap:8px; align-items:center; font-size:12px; color:var(--n-ink2) }
.eq-f .bar { height:8px; border-radius:4px; background:rgba(255,255,255,.05); overflow:hidden } .eq-f .bar i { display:block; height:100%; border-radius:4px; opacity:.85; animation:nGrow 1s both }
.eq-f b { color:#fff; text-align:right } .eq-f small { font-size:10.5px; color:var(--n-mute) }
.eq-p { flex:none; display:flex; justify-content:space-between; gap:6px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,.06); font-size:11.5px; color:var(--n-mute) } .eq-p b { color:#fff; font-weight:650; margin-left:3px }
.gc { display:grid; grid-template-columns: .95fr .95fr 1.25fr 1.25fr; gap:var(--gap); flex:1 1 0; min-height:0 }
.hj-n { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; flex:none } .hj-n.two { grid-template-columns:1fr 1fr }
.hj-n div { padding:8px 10px; border-radius:10px; background:rgba(255,255,255,.035); display:flex; flex-direction:column } .hj-n b { font-size:18px; font-weight:700; color:#fff; white-space:nowrap } .hj-n span { font-size:11px; color:var(--n-mute) }
.plant { display:flex; gap:6px; flex-wrap:wrap; flex:none } .plant span { display:inline-flex; align-items:center; gap:5px; padding:4px 9px; border-radius:99px; background:rgba(46,230,197,.1); color:#2ee6c5; font-size:12px } .plant small { color:var(--n-mute) }

/* tela 3 — marketing */


/* tela 3 — mídia → venda */
.gm1 { display:grid; grid-template-columns:1fr; gap:var(--gap); flex:1 1 0; min-height:0 }
.gm2 { display:grid; grid-template-columns: 1fr 1fr 1.15fr; gap:var(--gap); flex:1.45 1 0; min-height:0 }
.fl { display:flex; flex-direction:column; justify-content:space-around; flex:1; min-height:0; gap:8px }
.fl-row { display:grid; grid-template-columns: 170px 1fr 34px 1fr 34px 1fr 34px 1fr 34px 1fr 34px 1fr; align-items:center; gap:0 }
.fl-m { display:flex; flex-direction:column; padding-right:12px; border-left:3px solid var(--mc); padding-left:10px }
.fl-m b { font-size:15px; color:#fff } .fl-m small { font-size:11.5px; color:var(--n-mute); line-height:1.3 } .fl-m em { font-style:normal; color:var(--n-lime); font-weight:700 }
.fl-n { position:relative; display:grid; grid-template-columns:auto 1fr; grid-template-rows:auto auto auto; column-gap:8px; align-items:center; padding:8px 12px; border-radius:12px;
  background:linear-gradient(160deg, rgba(158,240,26,.08), rgba(255,255,255,.02)); border:1px solid rgba(158,240,26,.22); box-shadow:0 0 16px rgba(158,240,26,.08); animation:nIn .6s both; min-width:0 }
.fl-n .fl-i { grid-row:1 / 3; width:30px; height:30px; display:grid; place-items:center; border-radius:9px; color:var(--n-lime); background:rgba(158,240,26,.12) }
.fl-n .fl-r { font-size:11px; color:var(--n-mute); text-transform:uppercase; letter-spacing:.08em }
.fl-n b { font-size:clamp(16px, 1.25vw, 24px); font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.fl-n small { grid-column:1 / 3; font-size:11px; color:var(--n-ink2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.fl-n.bad { border-color:rgba(255,92,92,.5); background:linear-gradient(160deg, rgba(255,92,92,.12), rgba(255,255,255,.02)); box-shadow:0 0 18px rgba(255,92,92,.18) } .fl-n.bad .fl-i { color:var(--n-bad); background:rgba(255,92,92,.14) } .fl-n.bad b { color:#ffb3b3 }
.fl-n.ok { border-color:rgba(158,240,26,.5); box-shadow:0 0 20px rgba(158,240,26,.22) }
.fl-a { position:relative; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center }
.fl-a i { width:100%; height:2px; background:repeating-linear-gradient(90deg, rgba(158,240,26,.7) 0 6px, transparent 6px 10px); background-size:20px 2px; animation:nFlow 1s linear infinite; position:relative }
.fl-a i::after { content:''; position:absolute; right:-1px; top:-4px; border:5px solid transparent; border-left:7px solid rgba(158,240,26,.8); border-right:0 }
.fl-a span { position:absolute; top:calc(50% + 6px); font-size:10.5px; color:var(--n-mute); white-space:nowrap; display:flex; align-items:center; gap:2px }
.fl-a.vaza i { background:repeating-linear-gradient(90deg, rgba(255,92,92,.85) 0 6px, transparent 6px 10px); background-size:20px 2px } .fl-a.vaza i::after { border-left-color:rgba(255,92,92,.9) } .fl-a.vaza span { color:var(--n-bad); font-weight:700 }
@keyframes nFlow { to { background-position:20px 0 } }
.tvd.calmo .fl-a i { animation:nFlow 1s linear infinite !important }
.reg-top { display:flex; gap:14px; align-items:center; flex:none }
.reg-g { width:78px; flex:none } .ring { width:100%; display:block }
.reg-t { display:flex; flex-direction:column; gap:2px; min-width:0 } .reg-t > b { font-size:26px; font-weight:700; color:#fff; line-height:1 } .reg-t > span { font-size:12px; color:var(--n-ink2) }
.reg-m { font-size:12px !important; color:var(--n-ink2) } .reg-m b { margin-left:4px }
.tb.can td:first-child { max-width:150px }

/* tela 4 — financeiro */
.gf1 { display:grid; grid-template-columns: 1.9fr 1fr; gap:var(--gap); flex:1 1 0; min-height:0 }
.gf2 { display:grid; grid-template-columns: 1fr 1.15fr 1fr 1.15fr; gap:var(--gap); flex:1 1 0; min-height:0 }
.kv.big > div { padding:3px 0; font-size:12.5px } .kv.big dd { font-size:14px }
.gate { display:flex; gap:10px; align-items:flex-start; margin-top:auto; padding:9px 12px; border-radius:10px; background:rgba(255,210,63,.08); border:1px solid rgba(255,210,63,.3); color:#ffd23f; font-size:12.5px }
.gate b { display:block; color:#fff } .gate small { color:var(--n-ink2); line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden } .gate.ok { background:rgba(158,240,26,.08); border-color:rgba(158,240,26,.3); color:var(--n-lime) }
.cc { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px; flex:none }
.cc-b { padding:8px 10px; border-radius:10px; background:rgba(255,255,255,.035); display:flex; flex-direction:column } .cc-b span { font-size:11px; color:var(--n-mute) } .cc-b b { font-size:16px; font-weight:700; color:#fff }
.cc-b.bad b { color:var(--n-bad) } .cc-b.warn b { color:var(--n-warn) }

/* tela 5 — pilares */
.gp { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); grid-auto-rows:minmax(0,1fr); gap:var(--gap); flex:1 1 0; min-height:0 }
.pc { border-top:2px solid var(--pk); color:inherit; text-decoration:none; padding-bottom:6px } .pc:hover { border-color:var(--pk) }
.pc-h { display:flex; align-items:flex-start; gap:8px; flex:none } .pc-h > div { display:flex; flex-direction:column; min-width:0 }
.pc-h b { font-size:14.5px; color:#fff; font-weight:650; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .pc-h small { font-size:11px; color:var(--n-mute) }
.pc-s { margin-left:auto; font-size:30px; font-weight:700; line-height:1; color:var(--pk); text-shadow:0 0 16px var(--pk) }
.pc .spark { height:30px; margin:4px -14px 6px; width:calc(100% + 28px) } .spark-empty.sm { height:10px }
.pc-i { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; justify-content:flex-start; gap:5px }
.pc-i li { display:grid; grid-template-columns:8px 1fr auto; grid-template-rows:auto 4px; column-gap:7px; row-gap:2px; align-items:center; font-size:11.5px; padding:2px 0 }
.pc-i li > i { width:7px; height:7px; border-radius:50%; grid-row:1 } .pc-i li > span:first-of-type { color:var(--n-ink2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.pc-i li b { color:#fff; font-weight:650; white-space:nowrap; text-align:right } .pc-i li small { display:none }
.pc-i li .pb { grid-column:2 / 4; height:3px; border-radius:2px; background:rgba(255,255,255,.06); overflow:hidden } .pc-i li .pb em { display:block; height:100% } .pc-i li .pb.vazio { background:transparent }
.p-ex { flex:none; font-size:11px; color:#a78bfa; margin-top:4px; display:flex; gap:5px; align-items:center }

/* depois da abertura: sem replay de animação a cada atualização (só o que pulsa segue pulsando) */
.tvd.calmo *, .tvd.calmo *::before { animation:none !important }
.tvd.calmo .chip.live i, .tvd.calmo .core { animation:nPulse 2s infinite !important }
.tvd.calmo .a-line { stroke-dashoffset:0 }

/* cabe numa tela só (segundo monitor 1080p+) */
@media (min-width: 1500px) and (min-height: 860px) { .tvd { height:100vh; overflow:hidden } }
@media (max-width: 1499px), (max-height: 859px) {
  .g2, .g3 { flex:none } .pn { min-height:300px } .stack .pn { min-height:200px } .area { flex:none; height:230px }
}
@media (max-width: 1499px) {
  .kpis { grid-template-columns:repeat(3, minmax(0,1fr)) }
  .g2 { grid-template-columns:1fr 1fr } .g2 .c-ano { grid-column:1 / -1 }
  .g3 { grid-template-columns:1fr 1fr }
  .ins { flex-wrap:wrap } .ins-i { flex:1 1 40% }
}
@media (max-width: 760px) {
  .hd { flex-wrap:wrap } .chips { margin-left:0; flex-wrap:wrap } .chip.dt { display:none }
  .kpis { grid-template-columns:1fr 1fr } .g2, .g3 { grid-template-columns:1fr } 
  .ins-h { border:0 } .ins-i { flex:1 1 100%; padding-left:0 !important; border-left:0 !important }
}

@media (max-width: 1499px) {
  .eq4 { grid-template-columns:repeat(2, minmax(0,1fr)) } .gc, .gm1, .gm2, .gf1, .gf2 { grid-template-columns:1fr 1fr } .gp { grid-template-columns:repeat(3, minmax(0,1fr)) }
  .tabs { flex-wrap:wrap } .tab.auto { margin-left:0 }
}
@media (max-width: 1499px), (max-height: 859px) { .eq4, .gc, .gm1, .gm2, .gf1, .gf2, .gp { flex:none } .gp { grid-auto-rows:auto } .body { flex:none } .chart { height:160px; flex:none } }
@media (max-width: 1499px) { .fl-row { grid-template-columns:1fr 1fr 1fr; gap:8px } .fl-a { display:none } .fl-m { grid-column:1 / -1 } .gm1 { flex:none; grid-template-columns:1fr } }
@media (max-width: 760px) { .fl-row { grid-template-columns:1fr 1fr } .eq4, .gc, .gm1, .gm2, .gf1, .gf2, .gp { grid-template-columns:1fr } .tab { flex:1 1 40% } .eq-f li { grid-template-columns:84px 1fr 38px } .eq-f small { display:none } .tb { font-size:11.5px } }
`;
