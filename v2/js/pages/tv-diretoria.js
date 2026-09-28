/* ============================================================================
   PSM-OS v2 — 📺 TV DIRETORIA (v88.74)
   Tela SECUNDÁRIA em tempo real do Paulo e da Isa (SÓ SÓCIO, lvl 10): tudo que a
   diretoria precisa olhar, de TODOS os pilares, numa parede só — sem rotação
   (é monitor de trabalho, não TV de salão: tudo visível ao mesmo tempo).

   Nada é calculado aqui — só lido dos motores oficiais (mesmos números das telas):
     • Faixa do topo: Sala de Comando (metrics/overview, metricas/projecao §8A,
       metas/atingimento, PSM HUB: caixa e vencidos)
     • Pilares: Farol PSM (diretoria/scorecard) — Presidência, UNs e Áreas,
       com saúde, farol e os indicadores fora do ritmo primeiro
     • Decisões (metricas/decisoes?tela=sala), Checklist da diretoria (tasks/list),
       Ao vivo (arena/live) e quem está no House agora (checkin/uso)
   Atualização: rápida (60s) no que muda no dia, lenta (5min) no que é pesado
   (scorecard tem cache de 10min no servidor). Aba oculta = não consulta
   (banco frágil — nada de martelar). Venda nova → faixa de celebração + som.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const FAST_MS = 60000, SLOW_MS = 300000, LIVE_MS = 20000;

let _root = null;
const _d = {};
const _at = {};                 // quando cada fonte chegou
let _timers = [];
let _lastSaleTs = null, _celebra = null, _celebTimer = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const money = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyInt = n => 'R$ ' + Math.round(Number(n || 0)).toLocaleString('pt-BR');
const hhmm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const COR = { verde: 'var(--ok)', amarelo: 'var(--warn)', vermelho: 'var(--err)', cinza: 'var(--ink-muted)', info: 'var(--info)' };
const ORDEM = { vermelho: 0, amarelo: 1, verde: 2, info: 3, cinza: 4 };

function datas() {
  const h = new Date();
  const dia = h.getDate(), diasMes = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
  return { h, dia, diasMes, pace: dia / diasMes, ym: `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`,
    iso: `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
    mes: h.toLocaleDateString('pt-BR', { month: 'long' }) };
}

export async function pageTVDiretoria(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 10) { root.innerHTML = '<div class="alert alert-warn">🔒 A TV Diretoria é restrita aos Sócios.</div>'; return; }
  document.body.classList.add('tv-mode');
  enableWakeLock(() => {});
  Object.keys(_d).forEach(k => delete _d[k]);
  _lastSaleTs = null; _celebra = null;
  shell();
  carregar('fast'); carregar('slow'); carregar('live');
  _timers = [
    setInterval(() => carregar('fast'), FAST_MS),
    setInterval(() => carregar('slow'), SLOW_MS),
    setInterval(() => carregar('live'), LIVE_MS),
    setInterval(relogio, 1000),
  ];
  document.addEventListener('visibilitychange', aoVoltar);
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  document.body.classList.remove('tv-mode');
  _timers.forEach(t => clearInterval(t)); _timers = [];
  if (_celebTimer) clearTimeout(_celebTimer);
  document.removeEventListener('visibilitychange', aoVoltar);
  disableWakeLock();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

// voltou pra aba depois de um tempo oculta → atualiza tudo na hora
function aoVoltar() { if (!document.hidden) { carregar('fast'); carregar('slow'); carregar('live'); } }

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
    metas:     () => api.request('/api/v3/metas/atingimento?ano=' + D.h.getFullYear()),
    decisoes:  () => api.request('/api/v3/metricas/decisoes?tela=sala'),
    hubPainel: () => api.request('/api/v3/psmhub/financeiro?secao=painel'),
    hubContas: () => api.request('/api/v3/psmhub/financeiro?secao=contas'),
    users:     () => api.request('/api/v3/users/list'),
  };
}

async function carregar(grupo) {
  if (document.hidden && _d.overview) return;
  await Promise.all(Object.entries(fontes(grupo)).map(async ([k, fn]) => {
    try { const r = await fn(); _d[k] = r; _at[k] = new Date(); }
    catch (e) { if (!_d[k] || _d[k]._err) _d[k] = { _err: e.message || 'erro' }; }   // falha passageira mantém o último dado bom
  }));
  if (grupo === 'live') checaVenda();
  pintar(grupo);
}

function checaVenda() {
  const evs = (_d.arena && _d.arena.events) || [];
  const v = evs.find(e => e.type === 'venda');
  if (v && _lastSaleTs != null && v.ts > _lastSaleTs) {
    _celebra = v;
    try { window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' })); } catch {}
    if (_celebTimer) clearTimeout(_celebTimer);
    _celebTimer = setTimeout(() => { _celebra = null; celebracao(); }, 12000);
    carregar('fast');   // venda nova muda o placar — não espera o próximo ciclo
  }
  if (v) _lastSaleTs = v.ts; else if (_lastSaleTs == null) _lastSaleTs = '';
  celebracao();
}

/* ─────────────────────────── SHELL ─────────────────────────── */
function shell() {
  const D = datas();
  _root.innerHTML = `
    <style>
      body.tv-mode .app-sidebar, body.tv-mode .app-header { display:none !important; }
      body.tv-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
      body.tv-mode .app-main { padding:0; min-height:100vh; }
      .tvd { background:var(--bg); color:var(--ink); min-height:100vh; padding:18px 22px 14px; box-sizing:border-box;
        display:flex; flex-direction:column; gap:12px; font-variant-numeric:tabular-nums }
      .tvd-hd { display:flex; align-items:center; gap:14px; flex-wrap:wrap }
      .tvd-hd h1 { margin:0; font-size:24px; font-weight:600; letter-spacing:2px; color:var(--accent-ink) }
      .tvd-hd .sub { font-size:14px; color:var(--ink-muted) }
      .tvd-hd .clk { margin-left:auto; font-size:32px; font-weight:600; letter-spacing:1px }
      .tvd-btn { padding:6px 12px; border:1px solid var(--border-2); border-radius:var(--radius-md); background:transparent; color:var(--ink-2); cursor:pointer; font-size:12px; text-decoration:none }
      .tvd-btn:hover { border-color:var(--accent-ink); color:var(--ink); text-decoration:none }
      .tvd-live { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--ok); margin-right:6px; animation:tvdP 1.6s infinite }
      @keyframes tvdP { 0%,100% { opacity:1 } 50% { opacity:.3 } }
      .tvd-kpis { display:grid; grid-template-columns:repeat(8, minmax(0,1fr)); gap:10px }
      .tvd-k { background:var(--surface-2); border-radius:var(--radius-md); padding:11px 13px; border-top:3px solid var(--kc, var(--border-2)); min-width:0 }
      .tvd-k .t { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--ink-muted) }
      .tvd-k .v { font-size:25px; font-weight:600; margin:4px 0 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
      .tvd-k .s { font-size:12.5px; color:var(--ink-2); line-height:1.3 }
      .tvd-bar { height:5px; background:var(--bg-3); border-radius:3px; margin-top:6px; overflow:hidden; position:relative }
      .tvd-bar i { position:absolute; left:0; top:0; bottom:0; border-radius:3px }
      .tvd-bar b { position:absolute; top:-2px; bottom:-2px; width:2px; background:var(--ink) }
      .tvd-sec { font-size:12px; text-transform:uppercase; letter-spacing:1.5px; color:var(--ink-muted); display:flex; align-items:center; gap:8px }
      .tvd-sec .x { margin-left:auto; text-transform:none; letter-spacing:0 }
      .tvd-pil { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px }
      .tvd-p { background:var(--surface-2); border-radius:var(--radius-md); padding:10px 12px; border-left:4px solid var(--pc, var(--border-2)); min-width:0; text-decoration:none; color:inherit; display:block }
      .tvd-p:hover { text-decoration:none; background:var(--bg-3) }
      .tvd-p .h { display:flex; align-items:baseline; gap:6px }
      .tvd-p .n { font-weight:600; font-size:15.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
      .tvd-p .sc { margin-left:auto; font-size:26px; font-weight:600; color:var(--pc) }
      .tvd-p .dn { font-size:12px; color:var(--ink-muted); margin-bottom:6px }
      .tvd-p .fr { display:flex; gap:8px; font-size:12px; color:var(--ink-2); margin-bottom:5px }
      .tvd-i { display:grid; grid-template-columns:9px 1fr auto; gap:6px; align-items:center; font-size:13.5px; padding:2px 0 }
      .tvd-i .d { width:8px; height:8px; border-radius:50% }
      .tvd-i .l { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--ink-2) }
      .tvd-i .val { font-weight:600; white-space:nowrap }
      .tvd-i .val small { font-weight:400; color:var(--ink-muted) }
      .tvd-low { display:grid; grid-template-columns:1.25fr 1fr 1fr; gap:10px; flex:1; min-height:0 }
      .tvd-box { background:var(--surface-2); border-radius:var(--radius-md); padding:11px 13px; display:flex; flex-direction:column; gap:7px; min-height:0; overflow:hidden }
      .tvd-row { display:grid; grid-template-columns:4px 1fr auto; gap:9px; align-items:start; font-size:14px; padding:6px 0; border-bottom:1px solid var(--border) }
      .tvd-row:last-child { border-bottom:0 }
      .tvd-row .bar { align-self:stretch; border-radius:2px }
      .tvd-row .tt { font-weight:600; line-height:1.3 }
      .tvd-row .mt { font-size:12px; color:var(--ink-muted); margin-top:1px }
      .tvd-row .rt { font-size:12.5px; white-space:nowrap; color:var(--ink-muted) }
      .tvd-pills { display:flex; gap:6px; flex-wrap:wrap }
      .tvd-pill { font-size:12px; padding:1px 8px; border-radius:10px; background:var(--bg-3); color:var(--ink-2) }
      .tvd-pill.err { background:var(--err-soft); color:var(--err) } .tvd-pill.ok { background:var(--ok-soft); color:var(--ok) } .tvd-pill.warn { background:var(--warn-soft); color:var(--warn) }
      .tvd-empty { font-size:13px; color:var(--ink-muted); padding:10px 0 }
      .tvd-cel { position:fixed; left:50%; top:16px; transform:translateX(-50%); z-index:60; background:var(--ok-soft); border:2px solid var(--ok);
        color:var(--ink); border-radius:var(--radius-lg); padding:14px 28px; font-size:22px; font-weight:600; box-shadow:0 10px 40px rgba(0,0,0,.5); animation:tvdIn .5s ease-out }
      @keyframes tvdIn { from { transform:translate(-50%,-20px); opacity:0 } to { transform:translate(-50%,0); opacity:1 } }
      .tvd-rec { font-size:12.5px; border-radius:var(--radius-sm); padding:6px 12px }
      @media (max-width: 1400px) { .tvd-kpis { grid-template-columns:repeat(4, minmax(0,1fr)) } .tvd-pil { grid-template-columns:repeat(3, minmax(0,1fr)) } }
      @media (max-width: 900px) { .tvd-kpis, .tvd-pil, .tvd-low { grid-template-columns:1fr 1fr } }
      @media (max-width: 560px) { .tvd-kpis, .tvd-pil, .tvd-low { grid-template-columns:1fr } }
    </style>
    <div class="tvd force-dark">
      <div class="tvd-hd">
        <h1>PSM · TV DIRETORIA</h1>
        <span class="sub"><span class="tvd-live"></span>ao vivo · dia ${D.dia}/${D.diasMes} de ${esc(D.mes)} · ${Math.round(D.pace * 100)}% do mês decorrido <span id="tvd-stamp"></span></span>
        <span class="clk" id="tvd-clk">${hhmm(D.h)}</span>
        <button class="tvd-btn" id="tvd-full" title="tela cheia (use no segundo monitor)">⛶ Tela cheia</button>
        <button class="tvd-btn" id="tvd-rel" title="recarrega todas as fontes agora">🔄</button>
        <a class="tvd-btn" href="#/cockpit">✕ Sair</a>
      </div>
      <div id="tvd-rec"></div>
      <div class="tvd-kpis" id="tvd-kpis"></div>
      <div class="tvd-sec">🚦 Pilares — Farol PSM <span class="x" id="tvd-pil-x"></span></div>
      <div class="tvd-pil" id="tvd-pil"></div>
      <div class="tvd-low">
        <div class="tvd-box" id="tvd-dec"></div>
        <div class="tvd-box" id="tvd-tar"></div>
        <div class="tvd-box" id="tvd-viv"></div>
      </div>
    </div>
    <div id="tvd-cel"></div>`;
  document.getElementById('tvd-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  document.getElementById('tvd-rel').onclick = () => { carregar('fast'); carregar('slow'); carregar('live'); };
  pintar('all');
}

function relogio() {
  const el = document.getElementById('tvd-clk');
  if (el) el.textContent = hhmm(new Date());
}

function pintar(grupo) {
  if (!document.getElementById('tvd-kpis')) return;
  kpis();
  if (grupo === 'fast' || grupo === 'all') { tarefas(); recados(); }
  if (grupo === 'slow' || grupo === 'all') { pilares(); decisoes(); tarefas(); }
  vivo();
  const st = document.getElementById('tvd-stamp');
  const ov = _d.overview;
  if (st) st.textContent = ov && ov.dados_de_hhmm ? `· RD de ${ov.dados_de_hhmm}` : '';
}

/* ─────────────────────────── FAIXA DO TOPO ─────────────────────────── */
function kpi(t, v, s, cor, bar) {
  return `<div class="tvd-k" style="--kc:${cor || 'var(--border-2)'}">
    <div class="t">${t}</div><div class="v">${v}</div><div class="s">${s || ''}</div>
    ${bar ? `<div class="tvd-bar"><i style="width:${Math.max(0, Math.min(100, bar.pct))}%;background:${cor}"></i>${bar.marca != null ? `<b style="left:${Math.min(100, bar.marca)}%"></b>` : ''}</div>` : ''}
  </div>`;
}
const carregando = t => kpi(t, '<span class="spinner"></span>', 'carregando…');
const semDado = (t, s) => kpi(t, '—', s || 'fonte indisponível', 'var(--ink-muted)');

function hubDados(k) { const d = _d[k]; return d && d.ok && d.dados ? d.dados : null; }

function calcCaixa() {
  const dd = hubDados('hubPainel');
  if (!dd || !Array.isArray(dd.contas_bancarias)) return null;
  let total = 0, achou = false;
  for (const c of dd.contas_bancarias) {
    for (const k of ['currentBalance', 'balance', 'saldo', 'saldoAtual', 'initialBalance']) {
      if (c[k] != null && !isNaN(parseFloat(c[k]))) { total += parseFloat(c[k]); achou = true; break; }
    }
  }
  return achou ? { total, contas: dd.contas_bancarias.length } : null;
}

function calcContas() {
  const dd = hubDados('hubContas');
  if (!dd || !Array.isArray(dd.lancamentos)) return null;
  const D = datas();
  const em7 = new Date(D.h.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  const out = { pagar_venc: 0, receber_venc: 0, pagar_7d: 0, receber_7d: 0 };
  for (const l of dd.lancamentos) {
    if (String(l.status || '').toLowerCase() === 'pago') continue;
    const falta = Math.max(0, num(l.amount) - num(l.amountPaid));
    if (!falta) continue;
    const due = String(l.dueDate || '').slice(0, 10);
    const pagar = String(l.type || '').toLowerCase().includes('pag');
    if (due && due < D.iso) { pagar ? out.pagar_venc += falta : out.receber_venc += falta; }
    else if (due && due <= em7) { pagar ? out.pagar_7d += falta : out.receber_7d += falta; }
  }
  return out;
}

function indScore(id) {
  const sc = _d.scorecard;
  if (!sc || !sc.scorecards) return null;
  for (const s of sc.scorecards) for (const i of s.indicadores || []) if (i.id === id) return i;
  return null;
}

function kpis() {
  const el = document.getElementById('tvd-kpis');
  if (!el) return;
  const D = datas();
  const c = [];

  // 1) Vendas do mês × ritmo (mesma conta da Sala de Comando, §6/§8A)
  const ov = _d.overview, PJ = _d.pjMes;
  if (!ov) c.push(carregando('Vendas do mês'));
  else if (ov._err || !ov.sales) c.push(semDado('Vendas do mês'));
  else {
    const PE = PJ && !PJ._err ? PJ.empresa : null;
    const vm = ov.sales.vgv_mes || 0;
    const meta = PE && PE.meta ? PE.meta.vgv : null;
    const esperado = PE && PE.meta ? PE.meta.vgv_ate_hoje : null;
    const pctMeta = PE && PE.realizado ? PE.realizado.pct_meta : null;
    const vDaMeta = pctMeta != null && meta ? pctMeta / 100 * meta : vm;
    const ritmo = esperado ? vDaMeta / esperado : null;
    const cor = ritmo == null ? 'var(--ink-muted)' : ritmo >= 1 ? 'var(--ok)' : ritmo >= 0.7 ? 'var(--warn)' : 'var(--err)';
    c.push(kpi(`Vendas de ${esc(D.mes)}`, `${ov.sales.vendas_mes || 0} · ${moneyInt(vm)}`,
      meta ? `${pctMeta != null ? Math.round(pctMeta) : '—'}% da meta ${moneyInt(meta)} · ${Math.round((ritmo || 0) * 100)}% do esperado` : (PJ ? 'sem meta no mês' : 'carregando a meta…'),
      cor, meta ? { pct: pctMeta || 0, marca: esperado && meta ? esperado / meta * 100 : null } : null));
  }

  // 2) Fechamento provável (projeção oficial §8A)
  if (!PJ) c.push(carregando('Fechamento provável'));
  else if (PJ._err || !PJ.empresa) c.push(semDado('Fechamento provável'));
  else {
    const P = PJ.empresa, st = P.status;
    const cor = st === 'batida' || st === 'no_ritmo' ? 'var(--ok)' : st === 'atras' ? 'var(--warn)' : st === 'fora' ? 'var(--err)' : 'var(--ink-muted)';
    c.push(kpi('Fechamento provável', `${(P.provavel?.vendas ?? 0).toLocaleString('pt-BR')} vendas`,
      `${moneyInt(P.provavel?.vgv)}${P.provavel?.pct_meta != null ? ` · ${Math.round(P.provavel.pct_meta)}% da meta` : ''}${P.por_dia_util_vgv ? `<br>faltam ${moneyInt(P.por_dia_util_vgv)}/dia útil` : ''}`, cor));
  }

  // 3) VGV do ano × meta
  const m = _d.metas;
  if (!m) c.push(carregando('VGV do ano'));
  else if (m._err || !m.totals) c.push(semDado('VGV do ano'));
  else {
    const daMeta = m.totals.atingido_vgv_da_meta != null ? m.totals.atingido_vgv_da_meta : m.totals.atingido_vgv;
    const pct = m.totals.meta_vgv ? daMeta / m.totals.meta_vgv : 0;
    const paceAno = ((D.h - new Date(D.h.getFullYear(), 0, 1)) / 864e5) / 365;
    const cor = pct >= paceAno ? 'var(--ok)' : pct >= paceAno * 0.7 ? 'var(--warn)' : 'var(--err)';
    c.push(kpi('VGV do ano', moneyInt(m.totals.atingido_vgv), `${m.total_vendas || 0} vendas · ${Math.round(pct * 100)}% de ${moneyInt(m.totals.meta_vgv)}`,
      cor, { pct: pct * 100, marca: paceAno * 100 }));
  }

  // 4) Resultado do mês projetado e 5) cobertura da conta cheia (Farol PSM · Presidência)
  const res = indScore('p.resultado'), cob = indScore('p.breakeven');
  if (!_d.scorecard) { c.push(carregando('Resultado do mês')); c.push(carregando('Conta cheia')); }
  else {
    if (res && res.valor != null) c.push(kpi('Resultado do mês (proj.)', money(res.valor), 'com pró-labore · Regra do Positivo ≥ 0', COR[res.farol]));
    else c.push(semDado('Resultado do mês (proj.)', res?.motivo || 'sem dado'));
    if (cob && cob.valor != null) c.push(kpi('Cobertura da conta cheia', `${Math.round(cob.valor)}%`, 'contribuição proj. ÷ (fixo + pró-labore + mídia)', COR[cob.farol], { pct: cob.valor, marca: 100 }));
    else c.push(semDado('Cobertura da conta cheia', cob?.motivo || 'sem dado'));
  }

  // 6) Caixa · 7) a pagar vencido · 8) a receber vencido (PSM HUB)
  if (!_d.hubPainel) c.push(carregando('Caixa (HUB)'));
  else {
    const cx = calcCaixa();
    c.push(cx ? kpi('Caixa (HUB)', money(cx.total), `${cx.contas} conta(s) bancária(s)`, cx.total > 0 ? 'var(--ok)' : 'var(--err)')
      : semDado('Caixa (HUB)', 'saldo não informado no Hub'));
  }
  if (!_d.hubContas) { c.push(carregando('A pagar vencido')); c.push(carregando('A receber vencido')); }
  else {
    const ct = calcContas();
    if (!ct) { c.push(semDado('A pagar vencido')); c.push(semDado('A receber vencido')); }
    else {
      c.push(kpi('A pagar vencido', money(ct.pagar_venc), `+ ${money(ct.pagar_7d)} em 7 dias`, ct.pagar_venc > 0 ? 'var(--err)' : 'var(--ok)'));
      c.push(kpi('A receber vencido', money(ct.receber_venc), `+ ${money(ct.receber_7d)} em 7 dias`, ct.receber_venc > 0 ? 'var(--warn)' : 'var(--ok)'));
    }
  }
  el.innerHTML = c.join('');
}

/* ─────────────────────────── PILARES (Farol PSM) ─────────────────────────── */
function fmtVal(v, un) {
  if (v == null) return '—';
  if (un === 'R$') return moneyInt(v);
  if (un === '%') return `${Math.round(v)}%`;
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function pilares() {
  const el = document.getElementById('tvd-pil');
  if (!el) return;
  const sc = _d.scorecard;
  const x = document.getElementById('tvd-pil-x');
  if (!sc) { el.innerHTML = '<div class="tvd-empty"><span class="spinner"></span> montando os placares…</div>'; return; }
  if (sc._err || !sc.scorecards) { el.innerHTML = `<div class="tvd-empty">Farol PSM indisponível: ${esc(sc._err || 'sem dados')}</div>`; return; }
  const tot = { verde: 0, amarelo: 0, vermelho: 0 };
  sc.scorecards.forEach(s => { tot[s.farol] = (tot[s.farol] || 0) + 1; });
  if (x) x.innerHTML = `<span class="tvd-pill ok">${tot.verde || 0} verdes</span> <span class="tvd-pill warn">${tot.amarelo || 0} amarelos</span> <span class="tvd-pill err">${tot.vermelho || 0} vermelhos</span> <a class="tvd-btn" href="#/scorecard" style="padding:2px 8px">abrir Farol →</a>`;
  el.innerHTML = sc.scorecards.map(s => {
    const cor = COR[s.farol] || COR.cinza;
    const inds = [...(s.indicadores || [])].sort((a, b) => (ORDEM[a.farol] ?? 9) - (ORDEM[b.farol] ?? 9)).slice(0, 6);
    const f = s.farois || {};
    return `<a class="tvd-p" href="#/scorecard" style="--pc:${cor}">
      <div class="h"><span class="n">${esc(s.ico || '')} ${esc(s.nome)}</span><span class="sc">${s.saude == null ? '—' : s.saude}</span></div>
      <div class="dn">👤 ${esc(s.dono_nome || s.dono || '—')}</div>
      <div class="fr"><span style="color:var(--ok)">● ${f.verde || 0}</span><span style="color:var(--warn)">● ${f.amarelo || 0}</span><span style="color:var(--err)">● ${f.vermelho || 0}</span>${f.cinza ? `<span style="color:var(--ink-muted)">● ${f.cinza} s/ dado</span>` : ''}</div>
      ${inds.map(i => `<div class="tvd-i" title="${esc(i.label)}${i.motivo ? ' — ' + esc(i.motivo) : ''}">
        <span class="d" style="background:${COR[i.farol] || COR.cinza}"></span>
        <span class="l">${esc(i.label)}</span>
        <span class="val">${fmtVal(i.valor, i.un)}${i.meta != null ? ` <small>/ ${fmtVal(i.meta, i.un)}</small>` : ''}</span>
      </div>`).join('')}
    </a>`;
  }).join('');
}

/* ─────────────────────────── CAIXAS DE BAIXO ─────────────────────────── */
// título + link numa linha, contadores (pílulas) na linha de baixo — não quebra no meio
function boxHead(titulo, href, link, pills) {
  return `<div class="tvd-sec"><span style="white-space:nowrap">${titulo}</span><a class="tvd-btn" href="${href}" style="padding:2px 8px;margin-left:auto;text-transform:none;letter-spacing:0">${link}</a></div>
    ${pills ? `<div class="tvd-pills">${pills}</div>` : ''}`;
}

/* ─────────────────────────── DECISÕES ─────────────────────────── */
function decisoes() {
  const el = document.getElementById('tvd-dec');
  if (!el) return;
  const d = _d.decisoes;
  const head = pills => boxHead('🧭 Decisões da empresa', '#/pontos-atencao', 'agir →', pills);
  if (!d) { el.innerHTML = head() + '<div class="tvd-empty"><span class="spinner"></span> vendo o que precisa de ação…</div>'; return; }
  if (d._err) { el.innerHTML = head() + `<div class="tvd-empty">Indisponível: ${esc(d._err)}</div>`; return; }
  const c = d.contagem || {};
  const ds = (d.decisoes || []).filter(x => x.estado?.status !== 'dispensada');
  const hoje = d.hoje || datas().iso;
  const pills = `${c.atrasadas ? `<span class="tvd-pill err">${c.atrasadas} atrasada(s)</span>` : ''}${c.sem_dono_agindo ? `<span class="tvd-pill err">${c.sem_dono_agindo} sem ninguém agindo</span>` : ''}${c.em_andamento ? `<span class="tvd-pill ok">${c.em_andamento} em andamento</span>` : ''}`;
  el.innerHTML = head(pills) + (ds.length ? ds.slice(0, 7).map(x => {
    const cor = x.nivel === 'critico' ? 'var(--err)' : 'var(--warn)';
    const venc = x.prazo && x.prazo < hoje;
    return `<div class="tvd-row"><span class="bar" style="background:${cor}"></span>
      <div><div class="tt">${esc(x.titulo)}</div><div class="mt">👤 ${esc(x.dono?.name || '—')} · ${esc(x.tipo_label || '')}${x.team ? ' · ' + esc(x.team) : ''}</div></div>
      <span class="rt" style="${venc ? 'color:var(--err);font-weight:600' : ''}">${x.prazo ? (venc ? 'venceu ' : 'até ') + x.prazo.slice(8, 10) + '/' + x.prazo.slice(5, 7) : ''}</span>
    </div>`;
  }).join('') + (ds.length > 7 ? `<div class="tvd-empty" style="padding:2px 0">+ ${ds.length - 7} decisão(ões) em Pontos de Atenção</div>` : '')
    : '<div class="tvd-empty">✅ Nada pendente — o que precisava de ação já tem dono agindo.</div>');
}

/* ─────────────────────────── CHECKLIST DA DIRETORIA ─────────────────────────── */
function nome(id) {
  const u = ((_d.users && _d.users.users) || []).find(x => x.id === id);
  return u ? u.name : null;
}

function tarefas() {
  const el = document.getElementById('tvd-tar');
  if (!el) return;
  const r = _d.tasks;
  const head = pills => boxHead('✅ Checklist da diretoria', '#/checklist-diretoria', 'abrir →', pills);
  if (!r) { el.innerHTML = head() + '<div class="tvd-empty"><span class="spinner"></span></div>'; return; }
  if (r._err) { el.innerHTML = head() + `<div class="tvd-empty">Indisponível: ${esc(r._err)}</div>`; return; }
  const D = datas();
  const lista = r.tasks || r.items || r.data || [];
  const abertas = lista.filter(t => !['concluida', 'cancelada'].includes(t.status));
  const atras = abertas.filter(t => t.prazo && String(t.prazo).slice(0, 10) < D.iso);
  const hoje = abertas.filter(t => t.prazo && String(t.prazo).slice(0, 10) === D.iso);
  const feitasMes = lista.filter(t => t.status === 'concluida' && String(t.updated_at || '').slice(0, 7) === D.ym).length;
  const prio = t => ({ urgente: 0, alta: 1, media: 2, baixa: 3 }[t.prioridade] ?? 2);
  const foco = [...atras, ...hoje].sort((a, b) => String(a.prazo).localeCompare(String(b.prazo)) || prio(a) - prio(b));
  const pills = `${atras.length ? `<span class="tvd-pill err">${atras.length} atrasada(s)</span>` : ''}${hoje.length ? `<span class="tvd-pill warn">${hoje.length} p/ hoje</span>` : ''}<span class="tvd-pill">${abertas.length} abertas</span><span class="tvd-pill ok">${feitasMes} feitas no mês</span>`;
  el.innerHTML = head(pills) + (foco.length ? foco.slice(0, 8).map(t => {
    const p = String(t.prazo).slice(0, 10);
    const venc = p < D.iso;
    return `<div class="tvd-row"><span class="bar" style="background:${venc ? 'var(--err)' : 'var(--warn)'}"></span>
      <div><div class="tt">${esc(t.titulo)}</div><div class="mt">👤 ${esc(nome(t.responsavel) || '—')}${t.categoria ? ' · ' + esc(t.categoria) : ''}</div></div>
      <span class="rt" style="${venc ? 'color:var(--err);font-weight:600' : ''}">${venc ? 'venceu ' + p.slice(8, 10) + '/' + p.slice(5, 7) : 'hoje'}</span>
    </div>`;
  }).join('') + (foco.length > 8 ? `<div class="tvd-empty" style="padding:2px 0">+ ${foco.length - 8} no Checklist</div>` : '')
    : '<div class="tvd-empty">✅ Nada atrasado nem vencendo hoje.</div>');
}

/* ─────────────────────────── AO VIVO + QUEM ESTÁ NO HOUSE ─────────────────────────── */
function quando(ts) {
  const t = new Date(ts); if (isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  if (min < 1440 && t.getDate() === new Date().getDate()) return hhmm(t);
  return t.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function vivo() {
  const el = document.getElementById('tvd-viv');
  if (!el) return;
  const u = _d.uso;
  const on = u && !u._err ? (u.pessoas || []).filter(p => p.online && !p.is_service) : null;
  const evs = ((_d.arena && _d.arena.events) || []).filter(e => e.type === 'venda' || e.type === 'recado').slice(0, 6);
  el.innerHTML = `${boxHead('📡 Ao vivo', '#/checkin', 'uso →', on ? `<span class="tvd-pill ok">${on.length} no House agora</span>` : '')}
    ${on && on.length ? `<div style="font-size:13.5px;color:var(--ink-2);line-height:1.5">🟢 ${on.map(p => esc(String(p.name || '').split(' ')[0])).join(' · ')}</div>` : ''}
    ${!_d.arena ? '<div class="tvd-empty"><span class="spinner"></span></div>'
      : evs.length ? evs.map(e => `<div class="tvd-row"><span class="bar" style="background:${e.type === 'venda' ? 'var(--ok)' : 'var(--warn)'}"></span>
          <div><div class="tt">${esc(e.ico || '')} ${esc(e.title || '')}</div>${e.subtitle || e.actor?.name || nome(e.actor_id) ? `<div class="mt">${esc(e.subtitle || '')}${(e.actor?.name || nome(e.actor_id)) ? ' · 👤 ' + esc(e.actor?.name || nome(e.actor_id)) : ''}</div>` : ''}</div>
          <span class="rt">${e.ts ? quando(e.ts) : ''}</span></div>`).join('')
      : '<div class="tvd-empty">Nenhuma venda ou recado recente.</div>'}`;
}

function recados() {
  const el = document.getElementById('tvd-rec');
  if (!el) return;
  const rs = ((_d.recados && _d.recados.recados) || []).filter(r => r.prioridade === 'critico' || r.prioridade === 'critica');
  el.innerHTML = rs.slice(0, 2).map(r => `<div class="tvd-rec" style="background:var(--err-soft);color:var(--err)">🔴 <b>${esc(r.titulo || '')}</b> ${esc(r.mensagem || r.texto || '')}</div>`).join('');
  el.style.display = rs.length ? 'grid' : 'none';
  el.style.gap = '4px';
}

function celebracao() {
  const el = document.getElementById('tvd-cel');
  if (!el) return;
  if (!_celebra) { el.innerHTML = ''; return; }
  const e = _celebra;
  el.innerHTML = `<div class="tvd-cel force-dark">🎉 VENDA FECHADA! ${esc(e.subtitle || '')}${(e.actor?.name || nome(e.actor_id)) ? ` · ${esc(e.actor?.name || nome(e.actor_id))}` : ''}</div>`;
}
