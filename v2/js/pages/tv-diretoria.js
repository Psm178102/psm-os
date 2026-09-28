/* ============================================================================
   PSM-OS v2 — 📺 TV DIRETORIA (v88.77 — redesenho)
   Segunda tela em tempo real do Paulo e da Isa (SÓ SÓCIO, lvl 10).

   Direção: terminal de banco privado. Grafite, creme da PSM como ÚNICA cor de
   dado; verde/âmbar/vermelho só onde significa ESTADO (sempre com ícone +
   palavra ou número — verde↔âmbar não se separa pra daltônico protan).
   Três perguntas, nesta ordem de leitura:
     1. O MÊS   — número-herói + régua de ritmo (realizado, esperado hoje,
                  faixa conservador–otimista, provável e meta) — projeção §8A
     2. O ANO   — colunas jan→dez: realizado × meta de cada mês (aba Metas)
     3. O CAIXA — caixa HUB, resultado projetado, cobertura da conta cheia, vencidos
   Depois: mapa de calor dos 10 PILARES × 12 meses (Farol PSM, histórico) com o
   pior indicador de cada um, a coluna "Precisa de você" (decisões + checklist)
   e a faixa AO VIVO (vendas + quem está no House).

   Nada é calculado aqui — só lido dos motores oficiais. Atualiza a cada 20s
   (ao vivo), 60s (dia) e 5min (pesado); aba oculta não consulta (banco frágil).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { icon } from '../icons.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const FAST_MS = 60000, SLOW_MS = 300000, LIVE_MS = 20000;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

let _root = null;
const _d = {};
let _timers = [];
let _lastSaleTs = null, _celebra = null, _celebTimer = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const brl = n => 'R$ ' + Math.round(Number(n || 0)).toLocaleString('pt-BR');
const brlC = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => n == null ? '—' : `${Math.round(n)}%`;
const hhmm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ic = (n, s = 16) => icon(n, { size: s });

// estado → cor + ícone + palavra (nunca cor sozinha)
const EST = {
  ok:   { c: 'var(--ok)',   i: 'circle-check',   w: 'no ritmo' },
  warn: { c: 'var(--warn)', i: 'triangle-alert', w: 'atenção' },
  bad:  { c: 'var(--err)',  i: 'octagon-x',      w: 'crítico' },
  mute: { c: 'var(--ink-muted)', i: 'circle-dot', w: 'sem dado' },
};
const farolEst = f => ({ verde: 'ok', amarelo: 'warn', vermelho: 'bad' }[f] || 'mute');
const saudeEst = s => s == null ? 'mute' : s >= 80 ? 'ok' : s >= 55 ? 'warn' : 'bad';

function datas() {
  const h = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const dia = h.getDate(), diasMes = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
  return { h, dia, diasMes, pace: dia / diasMes, mes: h.getMonth() + 1, ano: h.getFullYear(),
    ym: `${h.getFullYear()}-${p2(h.getMonth() + 1)}`, iso: `${h.getFullYear()}-${p2(h.getMonth() + 1)}-${p2(dia)}`,
    mesNome: h.toLocaleDateString('pt-BR', { month: 'long' }),
    longa: h.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) };
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
const primeiro = n => String(n || '').split(' ')[0];

/* ─────────────────────────── SHELL ─────────────────────────── */
function shell() {
  _root.innerHTML = `
    <style>${CSS}</style>
    <div class="tvd force-dark" id="tvd">
      <header class="tvd-top">
        <div class="brand"><span class="mark">PSM</span><span class="sep"></span><span>Diretoria</span></div>
        <div class="when"><span class="live"></span><span id="tvd-data"></span><span class="muted" id="tvd-stamp"></span></div>
        <div class="clock" id="tvd-clk"></div>
        <nav>
          <button id="tvd-full" title="tela cheia">${ic('maximize', 15)}</button>
          <button id="tvd-rel" title="atualizar tudo agora">${ic('refresh-cw', 15)}</button>
          <a href="#/cockpit" title="sair">${ic('x', 16)}</a>
        </nav>
      </header>
      <div id="tvd-rec"></div>
      <section class="tvd-a">
        <article class="blk" id="tvd-mes"></article>
        <article class="blk" id="tvd-ano"></article>
        <article class="blk" id="tvd-cx"></article>
      </section>
      <section class="tvd-b">
        <article class="blk" id="tvd-pil"></article>
        <article class="blk" id="tvd-act"></article>
      </section>
      <footer class="tvd-live" id="tvd-viv"></footer>
      <div id="tvd-cel"></div>
    </div>`;
  document.getElementById('tvd-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  document.getElementById('tvd-rel').onclick = tudo;
  relogio();
  pintar();
}

function relogio() {
  const D = datas();
  const c = document.getElementById('tvd-clk'); if (c) c.textContent = hhmm(D.h);
  const d = document.getElementById('tvd-data'); if (d) d.textContent = D.longa;
}

function pintar() {
  if (!document.getElementById('tvd')) return;
  blocoMes(); blocoAno(); blocoCaixa(); blocoPilares(); blocoAcao(); faixaVivo(); recados(); celebracao();
  const st = document.getElementById('tvd-stamp');
  const ov = ok('overview');
  if (st) st.textContent = ov && ov.dados_de_hhmm ? `RD sincronizado às ${ov.dados_de_hhmm}` : '';
}

const aguardando = (t) => `<div class="eyebrow">${t}</div><div class="wait"><span class="spinner"></span></div>`;
const indisponivel = (t, why) => `<div class="eyebrow">${t}</div><div class="wait muted">${esc(why || 'fonte indisponível')}</div>`;
function selo(k, palavra) {
  const e = EST[k] || EST.mute;
  return `<span class="selo" style="--sc:${e.c}">${ic(e.i, 14)}${esc(palavra || e.w)}</span>`;
}

/* ─────────────────────────── 1 · O MÊS ─────────────────────────── */
const PJ_EST = { batida: ['ok', 'Meta batida'], no_ritmo: ['ok', 'No ritmo da meta'], atras: ['warn', 'Atrás do ritmo'], fora: ['bad', 'Fora do ritmo'], sem_meta: ['mute', 'Sem meta no mês'] };

function blocoMes() {
  const el = document.getElementById('tvd-mes'); if (!el) return;
  const D = datas();
  const T = `O mês · ${D.mesNome}`;
  const pj = _d.pjMes, ov = ok('overview');
  if (!pj) { el.innerHTML = aguardando(T); return; }
  const P = pj._err ? null : pj.empresa;
  if (!P) { el.innerHTML = indisponivel(T, pj._err); return; }
  const real = num(P.realizado?.vgv), meta = num(P.meta?.vgv), esp = num(P.meta?.vgv_ate_hoje);
  const cons = num(P.conservador?.vgv), oti = num(P.otimista?.vgv), prov = num(P.provavel?.vgv);
  const [ek, ew] = PJ_EST[P.status] || PJ_EST.sem_meta;
  const vendas = ov?.sales?.vendas_mes ?? P.realizado?.vendas ?? 0;
  const frase = P.status === 'batida' ? 'A meta do mês já está no bolso.'
    : P.falta_vgv > 0 ? `Faltam <b>${brl(P.falta_vgv)}</b>${P.por_dia_util_vgv ? ` — <b>${brl(P.por_dia_util_vgv)}</b> por dia útil` : ''}.` : '';
  el.innerHTML = `
    <div class="eyebrow">${T}${selo(ek, ew)}</div>
    <div class="hero">${brl(real)}</div>
    <div class="hero-sub">${meta ? `<b>${pct(P.realizado?.pct_meta)}</b> da meta de ${brl(meta)}` : 'sem meta cadastrada'} · ${vendas} venda${vendas === 1 ? '' : 's'}</div>
    ${meta ? regua({ real, meta, esp, cons, oti, prov, cor: EST[ek].c }) : ''}
    <div class="trio">
      <div><span>Fechamento provável</span><b>${brl(prov)}</b><i>${P.provavel?.pct_meta != null ? pct(P.provavel.pct_meta) + ' da meta · ' : ''}${(P.provavel?.vendas ?? 0).toLocaleString('pt-BR')} vendas</i></div>
      <div><span>Ticket médio</span><b>${ov?.sales?.ticket_medio_mes ? brl(ov.sales.ticket_medio_mes) : P.ticket ? brl(P.ticket) : '—'}</b><i>no mês</i></div>
      <div><span>Pipeline em andamento</span><b>${ov?.sales ? brl(ov.sales.pipeline_vgv) : '—'}</b><i>${ov?.sales?.pipeline_count != null ? ov.sales.pipeline_count + ' negócios' : ''}</i></div>
    </div>
    ${frase ? `<div class="frase">${frase}</div>` : ''}`;
}

// régua de ritmo: 0 → escala; faixa conservador–otimista, realizado, esperado hoje, provável, meta
function regua({ real, meta, esp, cons, oti, prov, cor }) {
  const max = Math.max(meta, oti, real) * 1.06 || 1;
  const x = v => Math.max(0, Math.min(100, v / max * 100));
  const tt = `Realizado ${brl(real)} · esperado até hoje ${brl(esp)} · provável ${brl(prov)} (faixa ${brl(cons)} a ${brl(oti)}) · meta ${brl(meta)}`;
  return `<div class="regua" title="${esc(tt)}">
    <div class="trk">
      <div class="band" style="left:${x(cons)}%;width:${Math.max(0.6, x(oti) - x(cons))}%"></div>
      <div class="fill" style="width:${x(real)}%;background:var(--accent)"></div>
      <div class="tick esp" style="left:${x(esp)}%"><span>esperado hoje</span></div>
      <div class="dot" style="left:${x(prov)}%;--dc:${cor}"></div>
      <div class="tick meta" style="left:${x(meta)}%"><span>meta</span></div>
    </div>
    <div class="leg"><span><i class="sw sw-fill"></i>realizado</span><span><i class="sw sw-band"></i>faixa provável ${brl(cons)} – ${brl(oti)}</span><span><i class="sw sw-dot" style="--dc:${cor}"></i>provável</span></div>
  </div>`;
}

/* ─────────────────────────── 2 · O ANO ─────────────────────────── */
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

function blocoAno() {
  const el = document.getElementById('tvd-ano'); if (!el) return;
  const D = datas();
  const T = `O ano · ${D.ano}`;
  if (!_d.metas) { el.innerHTML = aguardando(T); return; }
  const m = ok('metas'), s = serieAno();
  if (!m || !s) { el.innerHTML = indisponivel(T, _d.metas._err); return; }
  const daMeta = m.totals.atingido_vgv_da_meta != null ? m.totals.atingido_vgv_da_meta : m.totals.atingido_vgv;
  const pAno = m.totals.meta_vgv ? daMeta / m.totals.meta_vgv * 100 : null;
  const paceAno = ((D.h - new Date(D.ano, 0, 1)) / 864e5) / 365 * 100;
  const ek = pAno == null ? 'mute' : pAno >= paceAno ? 'ok' : pAno >= paceAno * 0.8 ? 'warn' : 'bad';
  const prov = num(ok('pjMes')?.empresa?.provavel?.vgv);

  // colunas — SVG com viewBox, escala única (uma só régua de R$)
  const W = 600, H = 210, top = 22, base = H - 24, cw = W / 12, bw = cw * 0.52;
  const max = Math.max(...s.map(v => Math.max(v.real, v.meta)), prov) * 1.08 || 1;
  const y = v => base - v / max * (base - top);
  const cols = s.map((v, i) => {
    const cx = i * cw + cw / 2, x0 = cx - bw / 2;
    const atual = i + 1 === D.mes, futuro = i + 1 > D.mes;
    const bar = v.real > 0 ? `<path d="M${x0},${base} V${y(v.real) + 4} q0,-4 4,-4 H${x0 + bw - 4} q4,0 4,4 V${base} Z" fill="${atual ? 'var(--accent)' : 'var(--ink-2)'}" opacity="${atual ? 1 : 0.42}"/>` : '';
    const ghost = atual && prov > v.real ? `<rect x="${x0}" y="${y(prov)}" width="${bw}" height="${y(v.real) - y(prov)}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3 3" opacity=".8"/>` : '';
    const alvo = v.meta > 0 ? `<line x1="${cx - cw * 0.4}" x2="${cx + cw * 0.4}" y1="${y(v.meta)}" y2="${y(v.meta)}" stroke="var(--ink)" stroke-width="2" opacity="${futuro ? 0.35 : 0.9}"/>` : '';
    const lbl = atual ? `<text x="${cx}" y="${Math.min(y(v.real), v.meta ? y(v.meta) : base, prov ? y(prov) : base) - 10}" text-anchor="middle" class="vl">${brl(v.real)}</text>` : '';
    return `<g><title>${MESES[i]}: realizado ${brl(v.real)}${v.meta ? ` · meta ${brl(v.meta)} (${pct(v.real / v.meta * 100)})` : ''}${atual && prov ? ` · provável ${brl(prov)}` : ''}</title>
      <rect x="${i * cw}" y="0" width="${cw}" height="${H}" fill="transparent"/>${bar}${ghost}${alvo}${lbl}
      <text x="${cx}" y="${H - 6}" text-anchor="middle" class="ax${atual ? ' on' : ''}">${MESES[i]}</text></g>`;
  }).join('');
  el.innerHTML = `
    <div class="eyebrow">${T}${selo(ek, pAno == null ? 'sem meta' : pAno >= paceAno ? 'à frente do calendário' : 'atrás do calendário')}</div>
    <div class="big">${brl(m.totals.atingido_vgv)}</div>
    <div class="hero-sub"><b>${pct(pAno)}</b> da meta de ${brl(m.totals.meta_vgv)} · ${Math.round(paceAno)}% do ano já passou · ${m.total_vendas || 0} vendas</div>
    <svg class="cols" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="VGV realizado por mês contra a meta">
      <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--border-2)" stroke-width="1"/>${cols}</svg>
    <div class="leg"><span><i class="sw sw-fill"></i>realizado (${esc(datas().mesNome)} em destaque)</span><span><i class="sw sw-ghost"></i>provável do mês</span><span><i class="sw sw-meta"></i>meta do mês</span></div>`;
}

/* ─────────────────────────── 3 · O CAIXA ─────────────────────────── */
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
function indScore(id) {
  for (const s of (ok('scorecard') || {}).scorecards || []) for (const i of s.indicadores || []) if (i.id === id) return i;
  return null;
}

function blocoCaixa() {
  const el = document.getElementById('tvd-cx'); if (!el) return;
  const T = 'O caixa';
  const cx = _d.hubPainel ? calcCaixa() : undefined;
  const ct = _d.hubContas ? calcContas() : undefined;
  const res = indScore('p.resultado'), cob = indScore('p.breakeven');
  const cxHtml = cx === undefined ? '<span class="spinner"></span>' : cx == null ? '—' : brlC(cx);
  const resK = res ? farolEst(res.farol) : 'mute';
  const covV = cob && cob.valor != null ? cob.valor : null;
  el.innerHTML = `
    <div class="eyebrow">${T}${resK === 'bad' ? selo('bad', 'Regra do Positivo em risco') : res && res.valor != null ? selo('ok', 'mês no positivo') : ''}</div>
    <div class="big">${cxHtml}</div>
    <div class="hero-sub">${cx == null && cx !== undefined ? 'saldo não informado no PSM HUB' : 'saldo nas contas do PSM HUB'}</div>
    <dl class="kv">
      <div><dt>Resultado do mês <small>projetado, com pró-labore</small></dt>
        <dd style="color:${res && res.valor != null ? (res.valor >= 0 ? 'var(--ok)' : 'var(--err)') : 'var(--ink-muted)'}">${res && res.valor != null ? `${ic(res.valor >= 0 ? 'trending-up' : 'trending-down', 15)} ${brlC(res.valor)}` : (_d.scorecard ? '—' : '<span class="spinner"></span>')}</dd></div>
      <div class="meter-row"><dt>Conta cheia coberta <small>fixo + pró-labore + mídia</small></dt>
        <dd>${covV != null ? `${pct(covV)}` : '—'}</dd>
        ${covV != null ? `<div class="meter"><i style="width:${Math.min(100, covV / 1.2)}%;background:${EST[farolEst(cob.farol)].c}"></i><b style="left:${100 / 1.2}%"></b></div>` : ''}</div>
      <div><dt>A pagar vencido <small>${ct ? '+ ' + brl(ct.p7) + ' em 7 dias' : ''}</small></dt>
        <dd style="color:${ct ? (ct.pv > 0 ? 'var(--err)' : 'var(--ok)') : 'var(--ink-muted)'}">${ct === undefined ? '<span class="spinner"></span>' : ct ? brlC(ct.pv) : '—'}</dd></div>
      <div><dt>A receber vencido <small>${ct ? '+ ' + brl(ct.r7) + ' em 7 dias' : ''}</small></dt>
        <dd style="color:${ct ? (ct.rv > 0 ? 'var(--warn)' : 'var(--ok)') : 'var(--ink-muted)'}">${ct === undefined ? '<span class="spinner"></span>' : ct ? brlC(ct.rv) : '—'}</dd></div>
    </dl>
    `;
}

/* ─────────────────────────── 4 · PILARES × 12 MESES ─────────────────────────── */
function blocoPilares() {
  const el = document.getElementById('tvd-pil'); if (!el) return;
  const T = 'Pilares · Farol PSM, últimos 12 meses';
  const sc = _d.scorecard;
  if (!sc) { el.innerHTML = aguardando(T); return; }
  if (sc._err || !sc.scorecards) { el.innerHTML = indisponivel(T, sc._err); return; }
  const H = ok('hist');
  const meses = H?.meses || [];
  const cont = { ok: 0, warn: 0, bad: 0 };
  sc.scorecards.forEach(s => { const k = saudeEst(s.saude); if (cont[k] != null) cont[k]++; });
  const cab = meses.map((ym, i) => `<span class="${i === meses.length - 1 ? 'on' : ''}">${MESES[+ym.slice(5, 7) - 1]}</span>`).join('');
  const linhas = sc.scorecards.map((s, r) => {
    const serie = (H?.saude?.[s.id] || []).slice();
    if (serie.length) serie[serie.length - 1] = s.saude;   // mês corrente = leitura ao vivo
    const cells = (serie.length ? serie : [s.saude]).map((v, i, a) => {
      const k = saudeEst(v), atual = i === a.length - 1;
      return `<span class="cell${atual ? ' on' : ''}${v == null ? ' nd' : ''}" style="--cc:${EST[k].c}" title="${esc(s.nome)} · ${meses[i] || 'agora'}: ${v == null ? 'sem avaliação' : 'saúde ' + v}">${v == null ? '' : v}</span>`;
    }).join('');
    const pior = [...(s.indicadores || [])].filter(i => i.farol === 'vermelho' || i.farol === 'amarelo')
      .sort((a, b) => (a.farol === 'vermelho' ? 0 : 1) - (b.farol === 'vermelho' ? 0 : 1))[0];
    const fmt = (v, un) => v == null ? '—' : un === 'R$' ? brl(v) : un === '%' ? pct(v) : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const k = saudeEst(s.saude);
    return `<a class="prow" href="#/scorecard" style="animation-delay:${r * 40}ms">
      <span class="pn"><b>${esc(s.nome)}</b><small>${esc(primeiro(s.dono_nome || s.dono))}</small></span>
      <span class="cells" style="grid-template-columns:repeat(${Math.max(1, serie.length || 1)},1fr)">${cells}</span>
      <span class="ps" style="color:${EST[k].c}">${ic(EST[k].i, 15)}${s.saude == null ? '—' : s.saude}</span>
      <span class="pw">${pior ? `<i style="background:${EST[farolEst(pior.farol)].c}"></i>${esc(pior.label)} <b>${fmt(pior.valor, pior.un)}</b>${pior.meta != null ? `<small> / ${fmt(pior.meta, pior.un)}</small>` : ''}`
        : s.saude == null ? `<small>${s.avaliados || 0} de ${s.total ?? (s.indicadores || []).length} indicadores avaliados</small>` : '<small>todos os indicadores no ritmo</small>'}</span>
    </a>`;
  }).join('');
  el.innerHTML = `
    <div class="eyebrow">${T}<span class="counts">${selo('ok', cont.ok + ' saudáveis')}${selo('warn', cont.warn + ' em atenção')}${selo('bad', cont.bad + ' críticos')}</span></div>
    <div class="pgrid">
      <div class="phead"><span>pilar · dono</span><span class="cells" style="grid-template-columns:repeat(${Math.max(1, meses.length)},1fr)">${cab}</span><span>saúde</span><span>o que puxa pra baixo</span></div>
      ${linhas}
    </div>`;
}

/* ─────────────────────────── 5 · PRECISA DE VOCÊ ─────────────────────────── */
function blocoAcao() {
  const el = document.getElementById('tvd-act'); if (!el) return;
  const D = datas();
  const dec = _d.decisoes, tk = _d.tasks;
  const dd = dec && !dec._err ? dec : null;
  const hojeD = dd?.hoje || D.iso;
  const ds = (dd?.decisoes || []).filter(x => x.estado?.status !== 'dispensada')
    .sort((a, b) => (a.nivel === 'critico' ? 0 : 1) - (b.nivel === 'critico' ? 0 : 1) || String(a.prazo).localeCompare(String(b.prazo)));
  const lista = (tk && !tk._err ? tk.tasks : null) || [];
  const abertas = lista.filter(t => !['concluida', 'cancelada'].includes(t.status));
  const atras = abertas.filter(t => t.prazo && String(t.prazo).slice(0, 10) < D.iso).sort((a, b) => String(a.prazo).localeCompare(String(b.prazo)));
  const hoje = abertas.filter(t => t.prazo && String(t.prazo).slice(0, 10) === D.iso);
  const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const item = (cor, tit, quem, quando, venc) => `<li style="--ic:${cor}"><div><b>${esc(tit)}</b><small>${esc(quem)}</small></div><time class="${venc ? 'venc' : ''}">${quando}</time></li>`;
  const nAtras = dd?.contagem?.atrasadas || 0;
  el.innerHTML = `
    <div class="eyebrow">Precisa de você</div>
    <div class="nums">
      <a href="#/pontos-atencao"><b style="color:${nAtras ? 'var(--err)' : 'var(--ink)'}">${dd ? ds.length : '…'}</b><span>decisões abertas${nAtras ? ` · <em>${nAtras} atrasada${nAtras > 1 ? 's' : ''}</em>` : ''}</span></a>
      <a href="#/checklist-diretoria"><b style="color:${atras.length ? 'var(--err)' : 'var(--ink)'}">${tk ? atras.length + hoje.length : '…'}</b><span>tarefas vencidas ou de hoje · ${abertas.length} abertas</span></a>
    </div>
    <div class="sub">Decisões</div>
    <ul class="acts">${!dec ? '<li class="wait"><span class="spinner"></span></li>' : dec._err ? `<li class="muted">${esc(dec._err)}</li>`
      : ds.length ? ds.slice(0, 3).map(x => item(x.nivel === 'critico' ? 'var(--err)' : 'var(--warn)', x.titulo, `${x.dono?.name || '—'} · ${x.tipo_label || ''}`,
          x.prazo ? (x.prazo < hojeD ? 'venceu ' : 'até ') + dm(x.prazo) : '', x.prazo && x.prazo < hojeD)).join('')
      : `<li class="muted">${ic('circle-check', 14)} Nada pendente — quem precisava agir já está agindo.</li>`}</ul>
    <div class="sub">Checklist da diretoria</div>
    <ul class="acts">${!tk ? '<li class="wait"><span class="spinner"></span></li>' : tk._err ? `<li class="muted">${esc(tk._err)}</li>`
      : [...atras, ...hoje].length ? [...atras, ...hoje].slice(0, 3).map(t => { const p = String(t.prazo).slice(0, 10), v = p < D.iso;
          return item(v ? 'var(--err)' : 'var(--warn)', t.titulo, `${nome(t.responsavel) || '—'}${t.categoria ? ' · ' + t.categoria : ''}`, v ? 'venceu ' + dm(p) : 'hoje', v); }).join('')
      : `<li class="muted">${ic('circle-check', 14)} Nada atrasado nem vencendo hoje.</li>`}</ul>`;
}

/* ─────────────────────────── AO VIVO ─────────────────────────── */
function quando(ts) {
  const t = new Date(ts); if (isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'agora'; if (min < 60) return `há ${min} min`;
  if (t.toDateString() === new Date().toDateString()) return 'hoje ' + hhmm(t);
  return t.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function faixaVivo() {
  const el = document.getElementById('tvd-viv'); if (!el) return;
  const u = ok('uso');
  const on = u ? (u.pessoas || []).filter(p => p.online && !p.is_service) : null;
  const vendas = ((_d.arena && _d.arena.events) || []).filter(e => e.type === 'venda').slice(0, 5);
  el.innerHTML = `
    <span class="lbl"><span class="live"></span>Ao vivo</span>
    <span class="feed">${!_d.arena ? '<span class="spinner"></span>' : vendas.length
      ? vendas.map(e => `<span class="ev">${ic('trending-up', 14)}<b>${esc(e.subtitle || e.title || '')}</b>${(e.actor?.name || nome(e.actor_id)) ? ` · ${esc(primeiro(e.actor?.name || nome(e.actor_id)))}` : ''}<time>${quando(e.ts)}</time></span>`).join('')
      : '<span class="muted">nenhuma venda nos últimos 7 dias</span>'}</span>
    <a class="who" href="#/checkin">${ic('users', 14)}${on ? `<b>${on.length}</b> no House agora${on.length ? ': ' + on.slice(0, 6).map(p => esc(primeiro(p.name))).join(', ') + (on.length > 6 ? '…' : '') : ''}` : '…'}</a>`;
}

function recados() {
  const el = document.getElementById('tvd-rec'); if (!el) return;
  const rs = ((ok('recados') || {}).recados || []).filter(r => r.prioridade === 'critico' || r.prioridade === 'critica');
  el.className = rs.length ? 'tvd-rec' : '';
  el.innerHTML = rs.slice(0, 2).map(r => `<div>${ic('triangle-alert', 15)}<b>${esc(r.titulo || '')}</b> ${esc(r.mensagem || r.texto || '')}</div>`).join('');
}

function celebracao() {
  const el = document.getElementById('tvd-cel'); if (!el) return;
  document.getElementById('tvd-mes')?.classList.toggle('won', !!_celebra);
  if (!_celebra) { el.innerHTML = ''; return; }
  const e = _celebra;
  el.innerHTML = `<div class="tvd-cel"><span>Venda fechada</span><b>${esc(e.subtitle || '')}</b>${(e.actor?.name || nome(e.actor_id)) ? `<small>${esc(e.actor?.name || nome(e.actor_id))}</small>` : ''}</div>`;
}

/* ─────────────────────────── ESTILO ─────────────────────────── */
const CSS = `
body.tv-mode .app-sidebar, body.tv-mode .app-header { display:none !important; }
body.tv-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
body.tv-mode .app-main { padding:0; min-height:100vh; }
.tvd { --gap: clamp(10px, .9vw, 18px); --pad: clamp(12px, 1.1vw, 22px);
  font-family:'Geist', system-ui, sans-serif; color:var(--ink); min-height:100vh; box-sizing:border-box;
  padding: var(--pad) calc(var(--pad) * 1.3); display:flex; flex-direction:column; gap:var(--gap);
  background: radial-gradient(1200px 500px at 12% -10%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%), var(--bg); }
.tvd .muted { color:var(--ink-muted) }
.tvd a { color:inherit; text-decoration:none }
.tvd .spinner { opacity:.6 }

/* topo */
.tvd-top { display:flex; align-items:center; gap:clamp(12px, 1.6vw, 28px); padding-bottom:calc(var(--gap) * .5); border-bottom:1px solid var(--border) }
.tvd-top .brand { display:flex; align-items:center; gap:12px; font-size:clamp(13px, .8vw, 16px); letter-spacing:.24em; text-transform:uppercase; color:var(--ink-2) }
.tvd-top .mark { font-weight:600; color:var(--accent); letter-spacing:.3em }
.tvd-top .sep { width:1px; height:16px; background:var(--border-2) }
.tvd-top .when { display:flex; align-items:center; gap:12px; font-size:clamp(12px, .75vw, 15px); color:var(--ink-2); text-transform:capitalize }
.tvd-top .when .muted { text-transform:none }
.tvd-top .clock { margin-left:auto; font-size:clamp(26px, 2vw, 40px); font-weight:500; letter-spacing:-.01em }
.tvd-top nav { display:flex; gap:4px }
.tvd-top nav > * { width:34px; height:34px; display:grid; place-items:center; border-radius:var(--radius-md); background:none; border:1px solid transparent; color:var(--ink-muted); cursor:pointer }
.tvd-top nav > *:hover { border-color:var(--border-2); color:var(--ink) }
.tvd .live { width:8px; height:8px; border-radius:50%; background:var(--ok); box-shadow:0 0 0 0 var(--ok); animation:tvdLive 2s infinite; display:inline-block }
@keyframes tvdLive { 0% { box-shadow:0 0 0 0 color-mix(in srgb, var(--ok) 60%, transparent) } 70%,100% { box-shadow:0 0 0 8px transparent } }

.tvd-rec { display:grid; gap:4px }
.tvd-rec > div { display:flex; align-items:center; gap:10px; padding:9px 14px; border-radius:var(--radius-md); background:var(--err-soft); color:var(--err); font-size:clamp(13px, .8vw, 16px) }

/* blocos */
.tvd-a { display:grid; grid-template-columns: 1.15fr 1.25fr .85fr; gap:var(--gap); flex:none }
.tvd-b { display:grid; grid-template-columns: 1.9fr 1fr; gap:var(--gap); flex:1 1 auto; min-height:0 }
.blk { container-type:inline-size; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:var(--pad); min-width:0;
  display:flex; flex-direction:column; animation:tvdIn .6s cubic-bezier(.2,.7,.2,1) both }
.tvd-a .blk:nth-child(2) { animation-delay:.06s } .tvd-a .blk:nth-child(3) { animation-delay:.12s }
.tvd-b .blk { animation-delay:.18s }
@keyframes tvdIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:none } }
.eyebrow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:clamp(11px, .68vw, 13px); letter-spacing:.16em; text-transform:uppercase; color:var(--ink-muted); margin-bottom:clamp(6px, .6vw, 12px) }
.eyebrow .counts { margin-left:auto; display:flex; gap:6px; letter-spacing:0; text-transform:none }
.selo { display:inline-flex; align-items:center; gap:5px; padding:2px 9px 2px 7px; border-radius:99px; font-size:clamp(11px, .68vw, 13px); letter-spacing:0; text-transform:none;
  color:var(--sc); background:color-mix(in srgb, var(--sc) 13%, transparent) }
.eyebrow > .selo { margin-left:auto }
.wait { padding:30px 0; font-size:14px }

.hero { white-space:nowrap; font-size:min(15.5cqw, 92px); font-weight:500; letter-spacing:-.035em; line-height:.95; color:var(--ink) }
.big { white-space:nowrap; font-size:min(11cqw, 56px); font-weight:500; letter-spacing:-.03em; line-height:1 }
.hero-sub { margin-top:8px; font-size:clamp(13px, .85vw, 17px); color:var(--ink-2) }
.hero-sub b { color:var(--ink); font-weight:600 }
.frase { margin-top:auto; padding-top:8px; font-size:clamp(13px, .82vw, 16px); color:var(--ink-2); display:flex; align-items:center; gap:6px }
.frase b { color:var(--ink); font-weight:600 }
.blk.won { border-color:var(--ok); box-shadow:0 0 0 1px var(--ok), 0 0 60px -10px color-mix(in srgb, var(--ok) 50%, transparent) }
.blk.won .hero { color:var(--ok); transition:color .4s }

/* régua de ritmo */
.regua { margin-top:clamp(16px, 1.4vw, 26px) }
.regua .trk { position:relative; height:16px; background:var(--bg-3); border-radius:4px }
.regua .band { position:absolute; top:-6px; bottom:-6px; background:color-mix(in srgb, var(--accent) 16%, transparent); border-radius:4px }
.regua .fill { position:absolute; left:0; top:0; bottom:0; border-radius:4px; animation:tvdGrow 1.1s cubic-bezier(.2,.7,.2,1) both }
@keyframes tvdGrow { from { width:0 } }
.regua .tick { position:absolute; top:-10px; bottom:-10px; width:2px; background:var(--ink); transform:translateX(-1px) }
.regua .tick span { position:absolute; top:-18px; left:50%; transform:translateX(-50%); white-space:nowrap; font-size:11px; color:var(--ink-2) }
.regua .tick.esp { background:var(--ink-2) } .regua .tick.esp span { top:auto; bottom:-19px }
.regua .dot { position:absolute; top:50%; width:14px; height:14px; border-radius:50%; background:var(--dc); transform:translate(-50%,-50%); box-shadow:0 0 0 3px var(--surface) }
.leg { display:flex; gap:6px 16px; flex-wrap:wrap; margin-top:22px; font-size:clamp(11px, .66vw, 13px); color:var(--ink-muted) }
.leg span { display:inline-flex; align-items:center; gap:6px }
.sw { display:inline-block; width:12px; height:8px; border-radius:2px }
.sw-fill { background:var(--accent) } .sw-band { background:color-mix(in srgb, var(--accent) 22%, transparent) }
.sw-dot { width:9px; height:9px; border-radius:50%; background:var(--dc) }
.sw-ghost { border:1.5px dashed var(--accent); height:7px; box-sizing:border-box }
.sw-meta { height:2px; background:var(--ink) }
.trio { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:clamp(10px, 1vw, 18px); padding-top:clamp(8px, .8vw, 14px); border-top:1px solid var(--border) }
.trio div { display:flex; flex-direction:column; gap:3px; min-width:0 }
.trio span { font-size:clamp(11px, .66vw, 13px); color:var(--ink-muted) }
.trio b { font-size:clamp(16px, 1.15vw, 23px); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.trio i { font-style:normal; font-size:clamp(11px, .66vw, 13px); color:var(--ink-2) }

/* colunas do ano */
.cols { width:100%; flex:1; min-height:110px; max-height:150px; margin-top:clamp(12px, 1.2vw, 20px); overflow:visible }
.cols .ax { font-size:12px; fill:var(--ink-muted); font-family:inherit }
.cols .ax.on { fill:var(--ink); font-weight:600 }
.cols .vl { font-size:12px; fill:var(--ink); font-weight:600; font-family:inherit }
.cols path { transform-origin:bottom; transform-box:fill-box; animation:tvdCol .9s cubic-bezier(.2,.7,.2,1) both }
@keyframes tvdCol { from { transform:scaleY(0) } }
.blk#tvd-ano .leg { margin-top:8px }

/* caixa */
.kv { margin:clamp(8px, .8vw, 16px) 0 0; display:flex; flex-direction:column }
.kv > div { display:grid; grid-template-columns:1fr auto; align-items:center; gap:4px 10px; padding:clamp(5px, .45vw, 9px) 0; border-top:1px solid var(--border) }
.kv dt { font-size:clamp(12px, .75vw, 15px); color:var(--ink-2) }
.kv dt small { display:block; font-size:clamp(10.5px, .62vw, 12px); color:var(--ink-muted) }
.kv dd { margin:0; font-size:clamp(16px, 1.1vw, 22px); font-weight:500; white-space:nowrap; display:flex; align-items:center; gap:6px; justify-content:flex-end }
.meter { grid-column:1 / -1; position:relative; height:6px; background:var(--bg-3); border-radius:3px }
.meter i { position:absolute; left:0; top:0; bottom:0; border-radius:3px; animation:tvdGrow 1s both }
.meter b { position:absolute; top:-4px; bottom:-4px; width:2px; background:var(--ink) }

/* pilares — mapa de calor */
.pgrid { display:flex; flex-direction:column; flex:1; min-height:0 }
.phead, .prow { display:grid; grid-template-columns: minmax(150px, 1.25fr) minmax(0, 2.4fr) 70px minmax(0, 2fr); gap:clamp(10px, 1vw, 18px); align-items:center }
.phead { font-size:11px; color:var(--ink-muted); padding-bottom:6px; letter-spacing:.04em }
.phead .cells span { text-align:center } .phead .cells span.on { color:var(--ink); font-weight:600 }
.prow { flex:1; min-height:24px; overflow:hidden; border-top:1px solid var(--border); padding:2px 0; animation:tvdIn .5s both }
.prow:hover { background:color-mix(in srgb, var(--ink) 3%, transparent) }
.pn { display:flex; align-items:baseline; gap:8px; min-width:0; white-space:nowrap; overflow:hidden }
.pn b { font-weight:500; font-size:clamp(13px, .82vw, 16px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.pn small { flex:none; font-size:clamp(11px, .62vw, 12px); color:var(--ink-muted) }
.pn b { min-width:0 }
.cells { display:grid; gap:3px; height:100% }
.cell { display:grid; place-items:center; min-height:22px; border-radius:3px; font-size:11px; font-family:'Geist Mono', ui-monospace, monospace;
  color:var(--ink); background:color-mix(in srgb, var(--cc) 30%, var(--surface)) }
.cell.nd { background:transparent; box-shadow:inset 0 0 0 1px var(--border) }
.cell.on { background:color-mix(in srgb, var(--cc) 62%, var(--surface)); font-weight:600; box-shadow:0 0 0 1.5px var(--ink) }
.ps { display:flex; align-items:center; gap:6px; font-size:clamp(18px, 1.25vw, 24px); font-weight:500 }
.pw { display:flex; align-items:center; gap:7px; font-size:clamp(12px, .72vw, 14px); color:var(--ink-2); min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.pw i { flex:none; width:7px; height:7px; border-radius:50% }
.pw b { color:var(--ink); font-weight:600 } .pw small { color:var(--ink-muted) }

/* precisa de você */
.nums { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:6px }
.nums a { display:flex; flex-direction:column; gap:2px; padding:10px 12px; border-radius:var(--radius-md); background:var(--bg-3) }
.nums b { font-size:clamp(30px, 2.4vw, 48px); font-weight:500; line-height:1; letter-spacing:-.02em }
.nums span { font-size:clamp(11px, .68vw, 13px); color:var(--ink-2) } .nums em { font-style:normal; color:var(--err) }
.sub { margin:12px 0 4px; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-muted) }
.acts { list-style:none; margin:0; padding:0 }
.acts li { display:grid; grid-template-columns:1fr auto; gap:10px; align-items:baseline; padding:7px 0 7px 12px; border-top:1px solid var(--border); position:relative; font-size:clamp(12.5px, .78vw, 15px) }
.acts li::before { content:''; position:absolute; left:0; top:10px; bottom:10px; width:3px; border-radius:2px; background:var(--ic, transparent) }
.acts li.muted, .acts li.wait { padding-left:0; display:flex; gap:6px; align-items:center }
.acts li.muted::before, .acts li.wait::before { display:none }
.acts b { font-weight:500; display:block; line-height:1.3 }
.acts small { color:var(--ink-muted); font-size:.85em }
.acts time { font-size:.85em; color:var(--ink-muted); white-space:nowrap } .acts time.venc { color:var(--err); font-weight:600 }

/* faixa ao vivo */
.tvd-live { display:flex; align-items:center; gap:18px; padding:10px 16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface); font-size:clamp(12.5px, .78vw, 15px); min-width:0 }
.tvd-live .lbl { display:flex; align-items:center; gap:8px; letter-spacing:.16em; text-transform:uppercase; font-size:11px; color:var(--ink-muted); flex:none }
.tvd-live .feed { display:flex; gap:26px; overflow:hidden; white-space:nowrap; flex:1; min-width:0; mask-image:linear-gradient(90deg, #000 90%, transparent) }
.tvd-live .ev { display:inline-flex; align-items:center; gap:7px; color:var(--ink-2) } .tvd-live .ev svg { color:var(--ok) }
.tvd-live .ev b { color:var(--ink); font-weight:500 } .tvd-live .ev time { color:var(--ink-muted); margin-left:4px }
.tvd-live .who { flex:none; display:inline-flex; align-items:center; gap:7px; color:var(--ink-2) } .tvd-live .who b { color:var(--ok) }

/* celebração */
.tvd-cel { position:fixed; left:50%; top:24px; transform:translateX(-50%); z-index:60; display:flex; align-items:baseline; gap:14px; padding:16px 30px;
  border-radius:99px; background:var(--ok-soft); border:1px solid var(--ok); box-shadow:0 20px 60px rgba(0,0,0,.55); animation:tvdDrop .6s cubic-bezier(.2,.9,.3,1.2) both }
.tvd-cel span { font-size:12px; letter-spacing:.2em; text-transform:uppercase; color:var(--ok) }
.tvd-cel b { font-size:24px; font-weight:500 } .tvd-cel small { color:var(--ink-2); font-size:15px }
@keyframes tvdDrop { from { opacity:0; transform:translate(-50%,-30px) } to { opacity:1; transform:translate(-50%,0) } }


/* cabe numa tela só (segundo monitor): a fileira de baixo ocupa o que sobra */
@media (min-width: 1500px) and (min-height: 820px) {
  .tvd { height:100vh; overflow:hidden }
  .tvd-b { min-height:0 } .tvd-b .blk { min-height:0; overflow:hidden }
  .prow { min-height:0 } .cell { min-height:0 }
}
@media (max-width: 1500px) { .tvd-a { grid-template-columns:1fr 1fr } .tvd-a .blk:nth-child(3) { grid-column:1 / -1 } .tvd-b { grid-template-columns:1fr } }
@media (max-width: 820px) {
  .tvd-a { grid-template-columns:1fr } .trio { grid-template-columns:1fr 1fr }
  .phead, .prow { grid-template-columns: minmax(110px, 1fr) minmax(0, 1.6fr) 56px } .phead > :last-child, .prow .pw { display:none }
  .tvd-top .when { display:none } .tvd-live { flex-wrap:wrap } }
`;
