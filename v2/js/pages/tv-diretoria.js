/* ============================================================================
   PSM-OS v2 — 📺 TV DIRETORIA (v88.80 — centro de comando)
   Segunda tela em tempo real do Paulo e da Isa (SÓ SÓCIO, lvl 10).

   Linguagem pedida pelo Paulo (referências Pinterest, 27/set): fundo preto,
   neon com brilho, alta densidade — KPIs com ícone + variação + minigráfico,
   área com degradê, funil em destaque, rosca com total no centro, ranking em
   barras, mapa de calor, velocímetro e faixa de insights no rodapé.

   Painéis (tudo lido dos motores oficiais — nada é recalculado aqui):
     KPIs ........ projeção §8A, arena/tv (vs mesmo ponto do mês passado), HUB,
                   Farol PSM + histórico (minigráficos de 12 meses)
     VGV no ano .. metas/atingimento (realizado × meta por mês) + provável do mês
     Funil ....... Farol PSM: leads, agendamentos, visitas, propostas, vendas × meta
     Pipeline .... metrics/overview.pipeline_frentes
     Ranking ..... metas/atingimento, célula do mês corrente de cada corretor
     Pilares ..... Farol PSM (saúde) × histórico de 12 meses
     Conta cheia . Farol PSM (cobertura + resultado projetado) + HUB (vencidos)
     Ação ........ metricas/decisoes + tasks/list · Ao vivo: arena/live + checkin/uso
   Atualiza a cada 20s (ao vivo), 60s (dia) e 5min (pesado); aba oculta não consulta.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { icon } from '../icons.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const FAST_MS = 60000, SLOW_MS = 300000, LIVE_MS = 20000;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// cor por FRENTE (identidade da marca): Conquista laranja, PSM Imóveis/MAP creme, Locação violeta, Terceiros turquesa
const FRENTE_COR = { conquista: '#ff8a1f', map: '#f3ebcb', imoveis: '#f3ebcb', locacao: '#a78bfa', locacoes: '#a78bfa', terceiros: '#2ee6c5' };
const CAT = ['#9ef01a', '#ffd23f', '#ff8a1f', '#ff5c5c', '#a78bfa', '#2ee6c5', '#f3ebcb'];

let _root = null;
const _d = {};
let _timers = [];
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
  Object.keys(_d).forEach(k => delete _d[k]);
  _lastSaleTs = null; _celebra = null;
  shell();
  tudo();
  _timers = [
    setInterval(() => carregar('fast'), FAST_MS),
    setInterval(() => carregar('slow'), SLOW_MS),
    setInterval(() => carregar('live'), LIVE_MS),
    setInterval(relogio, 1000),
  ];
  document.addEventListener('visibilitychange', aoVoltar);
  window.addEventListener('hashchange', cleanup, { once: true });
}

function tudo() { carregar('fast'); carregar('slow'); carregar('live'); }

function cleanup() {
  document.body.classList.remove('tv-mode');
  _timers.forEach(t => clearInterval(t)); _timers = [];
  if (_celebTimer) clearTimeout(_celebTimer);
  document.removeEventListener('visibilitychange', aoVoltar);
  disableWakeLock();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function aoVoltar() { if (!document.hidden) tudo(); }

/* ─────────────────────────── DADOS ─────────────────────────── */
function fontes(grupo) {
  const D = datas();
  if (grupo === 'live') return { arena: () => api.request('/api/v3/arena/live') };
  if (grupo === 'fast') return {
    overview: () => api.request('/api/v3/metrics/overview'),
    pjMes:    () => api.request('/api/v3/metricas/projecao?h=mes'),
    tv:       () => api.request('/api/v3/arena/tv'),
    tasks:    () => api.request('/api/v3/tasks/list'),
    uso:      () => api.request('/api/v3/checkin/uso?dias=1'),
    recados:  () => api.request('/api/v3/diretoria/recados'),
  };
  return {
    scorecard: () => api.request('/api/v3/diretoria/scorecard?ym=' + D.ym),
    hist:      () => api.request('/api/v3/diretoria/scorecard?hist=12'),
    metas:     () => api.request('/api/v3/metas/atingimento?ano=' + D.ano),
    decisoes:  () => api.request('/api/v3/metricas/decisoes?tela=sala'),
    hubPainel: () => api.request('/api/v3/psmhub/financeiro?secao=painel'),
    hubContas: () => api.request('/api/v3/psmhub/financeiro?secao=contas'),
    users:     () => api.request('/api/v3/users/list'),
  };
}

async function carregar(grupo) {
  if (document.hidden && _d.overview) return;
  await Promise.all(Object.entries(fontes(grupo)).map(async ([k, fn]) => {
    try { _d[k] = await fn(); }
    catch (e) { if (!_d[k] || _d[k]._err) _d[k] = { _err: e.message || 'erro' }; }   // falha passageira mantém o último dado bom
  }));
  if (grupo === 'live') checaVenda();
  pintar();
}

function checaVenda() {
  const v = ((_d.arena && _d.arena.events) || []).find(e => e.type === 'venda');
  if (v && _lastSaleTs != null && v.ts > _lastSaleTs) {
    _celebra = v;
    try { window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' })); } catch {}
    if (_celebTimer) clearTimeout(_celebTimer);
    _celebTimer = setTimeout(() => { _celebra = null; pintar(); }, 12000);
    carregar('fast');
  }
  if (v) _lastSaleTs = v.ts; else if (_lastSaleTs == null) _lastSaleTs = '';
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

/* ─────────────────────────── SHELL ─────────────────────────── */
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
      <div id="tvd-rec"></div>
      <div class="kpis" id="tvd-kpis"></div>
      <div class="g2">${PANEL('p-ano', 'c-ano')}${PANEL('p-fun', 'c-fun')}${PANEL('p-pipe', 'c-pipe')}</div>
      <div class="g3">${PANEL('p-rank', 'c-rank')}${PANEL('p-pil', 'c-pil')}${PANEL('p-cx', 'c-cx')}<div class="stack">${PANEL('p-act', 'c-act')}${PANEL('p-viv', 'c-viv')}</div></div>
      <footer class="ins" id="tvd-ins"></footer>
      <div id="tvd-cel"></div>
    </div>`;
  document.getElementById('tvd-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  document.getElementById('tvd-rel').onclick = tudo;
  // anima só na abertura; depois as atualizações (a cada 20s) trocam o dado sem replay
  setTimeout(() => document.getElementById('tvd')?.classList.add('calmo'), 4000);
  relogio(); pintar();
}

function relogio() {
  const D = datas();
  const c = document.getElementById('tvd-clk'); if (c) c.textContent = hhmm(D.h);
  const d = document.getElementById('tvd-data'); if (d) d.textContent = D.longa;
}

function pintar() {
  if (!document.getElementById('tvd')) return;
  _uid = 0;
  kpis(); pAno(); pFunil(); pPipe(); pRank(); pPilares(); pCaixa(); pAcao(); pVivo(); insights(); recados(); celebracao();
  const st = document.getElementById('tvd-stamp'), ov = ok('overview');
  if (st) st.textContent = ov && ov.dados_de_hhmm ? `RD sincronizado às ${ov.dados_de_hhmm}` : 'carregando…';
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
`;
