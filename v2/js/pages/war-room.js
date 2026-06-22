/* ============================================================================
   PSM-OS v2 — ⚔️ WAR ROOM (centro de comando) — v81.15
   Orquestra, numa tela só, todo o quadro de batalha do mês — reaproveitando os
   endpoints reais já existentes (nada inventado, bate com o resto do sistema):
     arena/tv .............. placar, projeção (run-rate), destaques, hoje
     oo/overview ........... tropa por corretor + investimento/CPL de ads
     marketing/crm_metrics . funil de conversão real (leads→contato→visita→venda)
     marketing/summary ..... tráfego (investido, CPL, campanhas sangrando)
   Camada de inteligência: WAR-SCORE (0–100), RISCOS auto-detectados + ações, e
   CONSELHO DE GUERRA (IA Opus lê o quadro e devolve prioridades).
   Dois modos: 🎯 Estratégico (mês/decisão) e ⚡ Tático (dia/ação).
   Liderança: lvl ≥ 7 (gerente/diretor/sócio).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { router } from '../router.js';

let _root = null, _mode = 'estrategico', _d = null, _err = '', _loading = true;
let _analysis = '', _analyzing = false;
let _clock = null;

export async function pageWarRoom(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 War Room é restrito à liderança (Gerente / Diretor / Sócio).</div>'; return; }
  router.onCleanup(() => { if (_clock) { clearInterval(_clock); _clock = null; } });
  _loading = true; _err = ''; render();
  await loadAll();
}

async function loadAll() {
  try {
    const [tv, oo, crm, mkt] = await Promise.all([
      api.request('/api/v3/arena/tv').catch(e => ({ _err: e.message })),
      api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null),
      api.request('/api/v3/marketing/crm_metrics?date_preset=this_month').catch(() => null),
      api.request('/api/v3/marketing/summary?date_preset=this_month').catch(() => null),
    ]);
    _d = consolidar(tv, oo, crm, mkt);
    _err = (tv && tv._err && !_d.placar) ? tv._err : '';
  } catch (e) { _err = e.message || 'falha ao carregar'; }
  _loading = false;
  render();
  if (!_clock) _clock = setInterval(() => { const el = document.getElementById('wr-clock'); if (el) el.textContent = new Date().toLocaleString('pt-BR'); }, 1000);
}

/* ───────── consolidação + inteligência ───────── */
function consolidar(tv, oo, crm, mkt) {
  const placar = tv?.placar || {}, meta = tv?.meta || {}, proj = tv?.projecao || {}, dest = tv?.destaques || {}, hoje = tv?.hoje || {};
  // tropa (só competidores)
  const competidor = c => { const r = (c.role || '').toLowerCase(); return !c.is_team && !['socio', 'diretor', 'gerente'].includes(r) && !c.hide_from_ranking; };
  const tropa = ((oo?.corretores) || []).filter(competidor).sort((a, b) => (+b.vgv || 0) - (+a.vgv || 0));
  // funil real
  const g = crm?.global || {};
  const funil = {
    basis: crm?.metrics_basis || null,
    leads: +g.leads_criados || 0, contatos: +g.leads_contatados || 0, visitas: +g.leads_visita || 0,
    vendas: +g.vendas || 0, conv: g.taxa_conversao, contactRate: g.contact_rate ?? (g.leads_criados ? g.leads_contatados / g.leads_criados * 100 : null),
  };
  // tráfego (ads)
  const accounts = (mkt?.accounts) || [];
  let spend = 0, results = 0; accounts.forEach(a => { spend += +a.spend || 0; results += +a.results || 0; });
  if (!spend && oo) { spend = +oo.meta_spend || 0; results = +oo.total_leads || 0; }
  const camps = (mkt?.campaigns) || [];
  const sangria = camps.filter(c => (+c.results || 0) === 0 && (+c.spend || 0) >= 30).sort((a, b) => (+b.spend || 0) - (+a.spend || 0));
  const verbaRisco = sangria.reduce((s, c) => s + (+c.spend || 0), 0);
  const cplGlobal = results > 0 ? spend / results : (oo?.cpl_global || 0);
  const ads = { spend, results, cplGlobal, sangria, verbaRisco, accounts };

  const d = { placar, meta, proj, dest, hoje, tropa, funil, ads, geradoEm: tv?.gerado_em };
  d.score = warScore(d);
  d.riscos = detectarRiscos(d);
  return d;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function warScore(d) {
  const metaV = +d.meta.meta_vgv || 0, proj = +d.proj.projecao_fim || 0;
  const pace = d.proj.uteis_total ? d.proj.uteis_decorridos / d.proj.uteis_total : 0;
  const sRitmo = metaV > 0 ? clamp(proj / metaV * 100, 0, 100) : 50;
  const atgs = d.tropa.map(c => +c.meta_attainment_pct).filter(v => !isNaN(v));
  const expectedAtg = pace * 100;
  const sTropa = atgs.length
    ? (expectedAtg > 0 ? clamp(avg(atgs) / expectedAtg * 100, 0, 100) : clamp(avg(atgs), 0, 100))
    : (d.tropa.length ? d.tropa.filter(c => (+c.vendas || 0) > 0).length / d.tropa.length * 100 : 50);
  const sAquis = d.ads.spend > 0 ? clamp(100 - (d.ads.verbaRisco / d.ads.spend) * 200, 0, 100) : 70;
  const sFunil = d.funil.contactRate != null ? clamp(+d.funil.contactRate, 0, 100) : 60;
  const total = Math.round(sRitmo * 0.45 + sTropa * 0.25 + sAquis * 0.20 + sFunil * 0.10);
  return { total: clamp(total, 0, 100), sRitmo: Math.round(sRitmo), sTropa: Math.round(sTropa), sAquis: Math.round(sAquis), sFunil: Math.round(sFunil) };
}

function detectarRiscos(d) {
  const r = [];
  const metaV = +d.meta.meta_vgv || 0, proj = +d.proj.projecao_fim || 0;
  if (metaV > 0 && proj < metaV * 0.97) {
    const falta = metaV - proj, pctAbaixo = falta / metaV * 100;
    r.push({ sev: pctAbaixo > 20 ? 'alta' : 'media', ico: '🎯', titulo: 'Meta do mês em risco',
      detalhe: `No ritmo atual fecha em ${money(proj)} — ${money(falta)} (${pctAbaixo.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%) abaixo da meta de ${money(metaV)}.`,
      acao: `Precisa de ${money(d.proj.precisa_por_dia)}/dia útil nos ${d.proj.uteis_restantes} dias restantes. Forçar fechamentos do pipeline quente.`, link: '#/crm' });
  }
  if (d.ads.sangria.length) {
    r.push({ sev: 'alta', ico: '🔥', titulo: `${d.ads.sangria.length} campanha(s) sangrando`,
      detalhe: `${money(d.ads.verbaRisco)} investidos sem gerar lead: ${d.ads.sangria.slice(0, 3).map(c => esc(c.name || c.campaign_name || 'campanha')).join(', ')}${d.ads.sangria.length > 3 ? '…' : ''}.`,
      acao: 'Pausar ou revisar criativo/segmentação dessas campanhas hoje.', link: '#/marketing' });
  }
  const parados = d.tropa.filter(c => (+c.vendas || 0) === 0);
  const paceElapsed = d.proj.uteis_total ? d.proj.uteis_decorridos / d.proj.uteis_total : 0;
  if (parados.length && paceElapsed >= 0.35) {
    r.push({ sev: parados.length >= Math.max(2, d.tropa.length * 0.4) ? 'alta' : 'media', ico: '👤', titulo: `${parados.length} corretor(es) sem venda no mês`,
      detalhe: `Com ${Math.round(paceElapsed * 100)}% do mês corrido: ${parados.slice(0, 5).map(c => esc((c.name || '').split(' ')[0])).join(', ')}${parados.length > 5 ? '…' : ''}.`,
      acao: '1:1 imediato, revisar pipeline e redistribuir leads quentes.', link: '#/one-on-one' });
  }
  if (d.funil.contactRate != null && d.funil.contactRate < 70 && d.funil.leads >= 10) {
    r.push({ sev: d.funil.contactRate < 50 ? 'alta' : 'media', ico: '📉', titulo: 'Gargalo no atendimento (SLA)',
      detalhe: `Só ${pct1(d.funil.contactRate)} dos ${fmtInt(d.funil.leads)} leads foram contatados${d.funil.basis === 'real' ? '' : ' (≈ estimativa)'}.`,
      acao: 'Cobrar primeiro contato rápido — lead frio derruba a conversão.', link: '#/cadencia' });
  }
  const cpls = d.ads.accounts.filter(a => (+a.results || 0) > 0).map(a => +a.spend / +a.results);
  const piorCpl = Math.max(0, ...cpls);
  if (d.ads.cplGlobal > 0 && piorCpl > d.ads.cplGlobal * 1.8) {
    const conta = d.ads.accounts.find(a => (+a.results || 0) > 0 && (+a.spend / +a.results) === piorCpl);
    r.push({ sev: 'media', ico: '💸', titulo: 'CPL desequilibrado entre contas',
      detalhe: `Conta "${esc(conta?.label || conta?.account || 'conta')}" com CPL ${money(piorCpl)} — ${(piorCpl / d.ads.cplGlobal).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× o CPL médio (${money(d.ads.cplGlobal)}).`,
      acao: 'Realocar verba para as contas/criativos mais eficientes.', link: '#/marketing' });
  }
  const ordem = { alta: 0, media: 1, baixa: 2 };
  return r.sort((a, b) => ordem[a.sev] - ordem[b.sev]);
}

/* ───────── render ───────── */
function render() {
  if (!_root) return;
  if (_loading && !_d) { _root.innerHTML = shell('<div style="padding:80px;text-align:center;color:#cbd5e1"><span class="spinner"></span> Montando o quadro de batalha…</div>'); return; }
  if (_err && !_d) { _root.innerHTML = shell(`<div style="padding:60px;text-align:center;color:#fca5a5">⚠️ ${esc(_err)}</div>`); return; }
  _root.innerHTML = shell(_mode === 'tatico' ? taticoView() : estrategicoView());
  wire();
}

function shell(body) {
  const s = _d?.score || { total: 0 };
  const cor = s.total >= 75 ? '#22c55e' : s.total >= 50 ? '#f59e0b' : '#ef4444';
  const lbl = s.total >= 75 ? 'NO RUMO' : s.total >= 50 ? 'ATENÇÃO' : 'CRÍTICO';
  return `
    <style>
      .wr-card{background:rgba(15,23,42,.55);border:1px solid #334155;border-radius:12px;padding:16px}
      .wr-h{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;font-weight:800;margin-bottom:10px}
      .wr-tab{padding:8px 16px;border:1px solid #475569;border-radius:9px;cursor:pointer;font-weight:800;font-size:13px;background:transparent;color:#e2e8f0}
      .wr-tab.on{background:#dc2626;border-color:#dc2626;color:#fff}
      .wr-grid{display:grid;gap:14px}
      @media(min-width:980px){.wr-2{grid-template-columns:1fr 1fr}.wr-3{grid-template-columns:1fr 1fr 1fr}}
    </style>
    <div style="background:radial-gradient(circle at 15% 0%,rgba(220,38,38,.18),transparent 45%),linear-gradient(135deg,#0a0f1c,#1a0b2e 55%,#0f172a);color:#fff;border-radius:14px;padding:0;overflow:hidden">
      <div style="padding:18px 22px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        ${gauge(s.total, cor)}
        <div style="flex:1;min-width:200px">
          <div style="font-size:26px;font-weight:900;letter-spacing:1px">⚔️ WAR ROOM</div>
          <div style="font-size:13px;color:#94a3b8">War-score <b style="color:${cor}">${s.total}/100 · ${lbl}</b> · <span id="wr-clock">${new Date().toLocaleString('pt-BR')}</span></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="wr-tab ${_mode === 'estrategico' ? 'on' : ''}" data-mode="estrategico">🎯 Estratégico</button>
          <button class="wr-tab ${_mode === 'tatico' ? 'on' : ''}" data-mode="tatico">⚡ Tático</button>
          <button class="wr-tab" data-refresh="1">🔄</button>
        </div>
      </div>
      <div style="padding:18px 22px">${body}</div>
    </div>`;
}

function gauge(v, cor) {
  const R = 30, C = 2 * Math.PI * R, off = C * (1 - v / 100);
  return `<svg width="86" height="86" viewBox="0 0 86 86" style="flex:0 0 auto">
    <circle cx="43" cy="43" r="${R}" fill="none" stroke="#334155" stroke-width="8"/>
    <circle cx="43" cy="43" r="${R}" fill="none" stroke="${cor}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 43 43)"/>
    <text x="43" y="40" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">${v}</text>
    <text x="43" y="56" text-anchor="middle" font-size="9" fill="#94a3b8">SCORE</text></svg>`;
}

/* ───────── MODO ESTRATÉGICO ───────── */
function estrategicoView() {
  const d = _d, p = d.placar, m = d.meta, pr = d.proj;
  const pctCor = m.pct == null ? '#94a3b8' : m.pct >= 100 ? '#22c55e' : m.pct >= 70 ? '#84cc16' : m.pct >= 40 ? '#f59e0b' : '#ef4444';
  return `
    <div class="wr-grid wr-2">
      <!-- ALVO & RITMO -->
      <div class="wr-card">
        <div class="wr-h">🎯 Alvo & Ritmo — ${esc(new Date().toLocaleDateString('pt-BR', { month: 'long' }))}</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
          <div><div style="font-size:11px;color:#94a3b8">VGV no mês</div><div style="font-size:30px;font-weight:900;color:#4ade80">${money(p.vgv_mes)}</div><div style="font-size:12px;color:#94a3b8">${fmtInt(p.vendas_mes)} venda(s)</div></div>
          <div><div style="font-size:11px;color:#94a3b8">Meta</div><div style="font-size:22px;font-weight:800;color:#fde68a">${money(m.meta_vgv)}</div></div>
          <div style="text-align:right;margin-left:auto"><div style="font-size:11px;color:#94a3b8">% atingido</div><div style="font-size:30px;font-weight:900;color:${pctCor}">${pct1(m.pct)}</div></div>
        </div>
        <div style="background:#1e293b;height:14px;border-radius:7px;margin:12px 0;overflow:hidden"><div style="height:100%;width:${m.pct == null ? 0 : clamp(m.pct, 0, 100)}%;background:${pctCor}"></div></div>
        <div class="wr-grid wr-3" style="gap:8px">
          ${miniDark('🔮 Projeção fim', money(pr.projecao_fim), pr.bate_meta ? 'bate a meta ✅' : 'abaixo da meta ⚠️')}
          ${miniDark('💪 Precisa/dia', money(pr.precisa_por_dia), `${pr.uteis_restantes} dias úteis restantes`)}
          ${miniDark('📊 vs mês ant.', pr.mom_pct == null ? '—' : (pr.mom_pct >= 0 ? '+' : '') + pct1(pr.mom_pct), 'mesmo ponto do mês')}
        </div>
        <div class="wr-grid wr-3" style="gap:8px;margin-top:8px">
          ${miniDark('📈 Pipeline', money(p.pipeline_vgv), `${fmtInt(p.pipeline_count)} em aberto`)}
          ${miniDark('🎟 Ticket médio', money(p.ticket_medio_mes), 'no mês')}
          ${miniDark('💎 VGV ano', money(p.vgv_ano), `${fmtInt(p.vendas_ano)} vendas`)}
        </div>
      </div>

      <!-- FUNIL -->
      <div class="wr-card">
        <div class="wr-h">📊 Funil de conversão ${d.funil.basis ? `<span style="color:${d.funil.basis === 'real' ? '#86efac' : '#fcd34d'}">· ${d.funil.basis === 'real' ? 'real' : '≈ estimativa'}</span>` : ''}</div>
        ${funilView(d.funil)}
      </div>

      <!-- TROPA -->
      <div class="wr-card">
        <div class="wr-h">🛡 Tropa & Riscos <span style="color:#94a3b8">· ${d.tropa.length} corretores</span></div>
        ${tropaView(d.tropa, pr)}
      </div>

      <!-- TRÁFEGO -->
      <div class="wr-card">
        <div class="wr-h">📣 Tráfego & Aquisição</div>
        ${trafegoView(d.ads)}
      </div>
    </div>

    <!-- RISCOS & DECISÕES -->
    <div class="wr-card" style="margin-top:14px">
      <div class="wr-h">🚨 Riscos & Decisões <span style="color:#94a3b8">· auto-detectados</span></div>
      ${riscosView(d.riscos)}
    </div>

    <!-- CONSELHO IA -->
    ${conselhoView()}`;
}

/* ───────── MODO TÁTICO ───────── */
function taticoView() {
  const d = _d, de = d.dest, h = d.hoje;
  const parados = d.tropa.filter(c => (+c.vendas || 0) === 0);
  const top = d.tropa.filter(c => (+c.vendas || 0) > 0).slice(0, 5);
  return `
    <div class="wr-grid wr-3">
      ${miniDark('🌱 Leads hoje', fmtInt(de.leads_hoje), 'novos negócios')}
      ${miniDark('✅ Vendas hoje', fmtInt(de.vendas_hoje), money(de.vgv_hoje) + ' VGV')}
      ${miniDark('🔥 Venda do dia', de.venda_do_dia ? money(de.venda_do_dia.amount) : '—', de.venda_do_dia ? esc(de.venda_do_dia.corretor) : 'nenhuma ainda')}
    </div>
    <div class="wr-grid wr-2" style="margin-top:14px">
      <div class="wr-card">
        <div class="wr-h">📍 Plantão de hoje</div>
        ${(h.plantao || []).length ? (h.plantao || []).map(p => `<div style="display:flex;justify-content:space-between;padding:7px 10px;background:#1e293b;border-radius:8px;margin-bottom:6px;font-size:14px"><span>👤 ${esc(p.corretor)}</span><span style="color:#94a3b8">${esc(p.periodo || '')}</span></div>`).join('') : '<div style="color:#64748b;font-size:13px">Ninguém escalado pra hoje.</div>'}
      </div>
      <div class="wr-card">
        <div class="wr-h">🗓 Visitas agendadas hoje <span style="color:#94a3b8">· ${fmtInt(h.visitas_total || (h.visitas || []).length)}</span></div>
        ${(h.visitas || []).length ? (h.visitas || []).slice(0, 8).map(v => `<div style="display:grid;grid-template-columns:54px 1fr auto;gap:8px;padding:6px 10px;background:#1e293b;border-radius:8px;margin-bottom:5px;font-size:13px"><b style="color:#fde68a">${esc(v.hora || '--:--')}</b><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.titulo)}</span><span style="color:#94a3b8;white-space:nowrap">${esc(v.corretor)}</span></div>`).join('') : '<div style="color:#64748b;font-size:13px">Nenhuma visita agendada hoje.</div>'}
      </div>
    </div>
    <div class="wr-grid wr-2" style="margin-top:14px">
      <div class="wr-card">
        <div class="wr-h">⚡ Quem age agora <span style="color:#94a3b8">· ${parados.length} sem venda no mês</span></div>
        ${parados.length ? parados.slice(0, 10).map(c => `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#1e293b;border-radius:8px;margin-bottom:5px;font-size:13px">
          <span style="width:24px;height:24px;border-radius:6px;background:${c.color || '#64748b'};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${esc((c.ini || c.name || '?').substring(0, 2).toUpperCase())}</span>
          <span style="flex:1">${esc(c.name)}</span>
          ${c.alertas_top && c.alertas_top.length ? `<span style="color:#fca5a5;font-size:11px">${esc(c.alertas_top[0])}</span>` : `<span style="color:#94a3b8;font-size:11px">${fmtInt(c.leads)} leads · ${fmtInt(c.visitas)} visitas</span>`}</div>`).join('') : '<div style="color:#86efac;font-size:13px">🎉 Todo mundo já vendeu este mês.</div>'}
        <a href="#/one-on-one" class="wr-tab" style="display:inline-block;margin-top:8px;text-decoration:none">→ Abrir One-on-One</a>
      </div>
      <div class="wr-card">
        <div class="wr-h">🏆 Em alta hoje/mês</div>
        ${top.length ? top.map((c, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#1e293b;border-radius:8px;margin-bottom:5px;font-size:13px">
          <b style="width:18px">${i + 1}º</b><span style="flex:1">${esc(c.name)}</span><b style="color:#4ade80">${money(c.vgv)}</b><span style="color:#94a3b8">${fmtInt(c.vendas)}v</span></div>`).join('') : '<div style="color:#64748b;font-size:13px">Ranking abre com a primeira venda.</div>'}
      </div>
    </div>

    <div class="wr-card" style="margin-top:14px">
      <div class="wr-h">🚨 Incêndios pra apagar agora</div>
      ${riscosView(_d.riscos)}
    </div>
    ${conselhoView()}`;
}

/* ───────── blocos ───────── */
function funilView(f) {
  const stages = [
    { l: 'Leads', n: f.leads, c: '#3b82f6' }, { l: 'Contatos', n: f.contatos, c: '#8b5cf6' },
    { l: 'Visitas', n: f.visitas, c: '#f59e0b' }, { l: 'Vendas', n: f.vendas, c: '#22c55e' },
  ];
  const top = Math.max(1, stages[0].n);
  if (!f.leads && !f.vendas) return '<div style="color:#64748b;font-size:13px">Sem dados de funil no período.</div>';
  return stages.map((s, i) => {
    const w = clamp(s.n / top * 100, 4, 100);
    const conv = i > 0 && stages[i - 1].n > 0 ? s.n / stages[i - 1].n * 100 : null;
    return `<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px"><span>${s.l}</span><b style="color:${s.c}">${fmtInt(s.n)}${conv != null ? ` <span style="color:#94a3b8;font-weight:400">(${pct1(conv)})</span>` : ''}</b></div>
      <div style="background:#1e293b;height:16px;border-radius:5px;overflow:hidden"><div style="height:100%;width:${w}%;background:${s.c}"></div></div></div>`;
  }).join('') + `<div style="text-align:center;font-size:12px;color:#94a3b8;margin-top:6px">Conversão lead→venda: <b style="color:#4ade80">${f.leads > 0 ? pct1(f.vendas / f.leads * 100) : '—'}</b></div>`;
}

function tropaView(tropa, pr) {
  if (!tropa.length) return '<div style="color:#64748b;font-size:13px">Sem dados de tropa (precisa de Líder+ no oo/overview).</div>';
  const topVgv = +tropa[0].vgv || 1;
  return `<div style="max-height:230px;overflow:auto">${tropa.slice(0, 12).map((c, i) => {
    const semVenda = (+c.vendas || 0) === 0;
    const bar = clamp((+c.vgv || 0) / topVgv * 100, 0, 100);
    const cor = c.health_color === 'red' || semVenda ? '#ef4444' : c.health_color === 'yellow' ? '#f59e0b' : '#22c55e';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;border-bottom:1px solid #1e293b">
      <b style="width:20px;color:#94a3b8">${i + 1}º</b>
      <span style="width:8px;height:8px;border-radius:50%;background:${cor}"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}${c.meta_attainment_pct != null ? ` <span style="color:#64748b;font-size:11px">· ${pct1(c.meta_attainment_pct)} meta</span>` : ''}</span>
      <span style="color:#93c5fd">${fmtInt(c.vendas)}v</span>
      <b style="color:#4ade80;min-width:90px;text-align:right">${money(c.vgv)}</b></div>`;
  }).join('')}</div>`;
}

function trafegoView(a) {
  if (!a.spend && !a.results) return '<div style="color:#64748b;font-size:13px">Sem dados de tráfego no período (requer Meta Ads conectado).</div>';
  return `<div class="wr-grid wr-3" style="gap:8px">
      ${miniDark('💸 Investido', money(a.spend), 'no mês')}
      ${miniDark('🌱 Leads', fmtInt(a.results), 'gerados')}
      ${miniDark('🎯 CPL médio', a.cplGlobal ? money(a.cplGlobal) : '—', 'custo por lead')}
    </div>
    ${a.sangria.length ? `<div style="margin-top:10px;background:rgba(220,38,38,.12);border:1px solid #dc2626;border-radius:8px;padding:10px">
      <div style="font-size:12px;color:#fca5a5;font-weight:800">🔥 ${a.sangria.length} campanha(s) sangrando · ${money(a.verbaRisco)} em risco</div>
      ${a.sangria.slice(0, 4).map(c => `<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px"><span style="color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name || c.campaign_name || 'campanha')}</span><b style="color:#fca5a5">${money(c.spend)} · 0 lead</b></div>`).join('')}
    </div>` : '<div style="margin-top:10px;font-size:12px;color:#86efac">✅ Sem campanhas sangrando.</div>'}`;
}

function riscosView(riscos) {
  if (!riscos.length) return '<div style="color:#86efac;font-size:14px;padding:6px 0">✅ Nenhum incêndio crítico detectado agora. Operação sob controle.</div>';
  const cor = { alta: '#ef4444', media: '#f59e0b', baixa: '#3b82f6' };
  const lbl = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA' };
  return riscos.map(r => `<div style="display:grid;grid-template-columns:34px 1fr;gap:10px;padding:11px;background:#1e293b;border-left:4px solid ${cor[r.sev]};border-radius:8px;margin-bottom:8px">
    <div style="font-size:24px">${r.ico}</div>
    <div>
      <div style="font-weight:800;font-size:14px">${esc(r.titulo)} <span style="font-size:10px;background:${cor[r.sev]}33;color:${cor[r.sev]};padding:1px 7px;border-radius:10px;font-weight:800">${lbl[r.sev]}</span></div>
      <div style="font-size:13px;color:#cbd5e1;margin-top:2px">${r.detalhe}</div>
      <div style="font-size:13px;color:#fde68a;margin-top:4px">👉 ${r.acao} ${r.link ? `<a href="${r.link}" style="color:#93c5fd">ir →</a>` : ''}</div>
    </div></div>`).join('');
}

function conselhoView() {
  return `<div class="wr-card" style="margin-top:14px;border-color:#6d28d9;background:rgba(109,40,217,.12)">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div class="wr-h" style="margin:0">🧠 Conselho de Guerra (IA Opus)</div>
      <button class="wr-tab" data-analyze="1" id="wr-analyze" ${_analyzing ? 'disabled' : ''}>${_analyzing ? '⏳ Analisando…' : (_analysis ? '🔁 Nova análise' : '⚡ Gerar análise')}</button>
    </div>
    <div id="wr-analysis" style="font-size:14px;line-height:1.55;color:#e2e8f0;margin-top:10px;white-space:pre-wrap">${_analysis ? esc(_analysis).replace(/\*\*(.+?)\*\*/g, '<b style="color:#fbbf24">$1</b>') : '<span style="color:#94a3b8">Clique em “Gerar análise” — a IA lê todo o quadro ao vivo (meta, ritmo, funil, tropa, tráfego, riscos) e devolve diagnóstico + prioridades da semana.</span>'}</div>
  </div>`;
}

/* ───────── IA ───────── */
async function analisar() {
  if (_analyzing || !_d) return;
  _analyzing = true; render();
  const d = _d;
  const brief = `Você é o Conselheiro de Guerra da PSM Imóveis (Rio Preto/SP). Quadro de batalha AO VIVO do mês:

WAR-SCORE: ${d.score.total}/100 (ritmo ${d.score.sRitmo}, tropa ${d.score.sTropa}, aquisição ${d.score.sAquis}, funil ${d.score.sFunil})
ALVO: VGV mês ${money(d.placar.vgv_mes)} de meta ${money(d.meta.meta_vgv)} (${pct1(d.meta.pct)}) · projeção fim ${money(d.proj.projecao_fim)} · precisa ${money(d.proj.precisa_por_dia)}/dia em ${d.proj.uteis_restantes} dias úteis · vs mês anterior ${d.proj.mom_pct == null ? '—' : pct1(d.proj.mom_pct)}
FUNIL: ${fmtInt(d.funil.leads)} leads → ${fmtInt(d.funil.contatos)} contatos → ${fmtInt(d.funil.visitas)} visitas → ${fmtInt(d.funil.vendas)} vendas (${d.funil.basis || 'n/d'})
TROPA: ${d.tropa.length} corretores, ${d.tropa.filter(c => (+c.vendas || 0) === 0).length} sem venda. Top: ${d.tropa.slice(0, 3).map(c => `${(c.name || '').split(' ')[0]} ${money(c.vgv)}`).join(', ')}
TRÁFEGO: investido ${money(d.ads.spend)}, ${fmtInt(d.ads.results)} leads, CPL ${money(d.ads.cplGlobal)}, ${d.ads.sangria.length} campanha(s) sangrando (${money(d.ads.verbaRisco)})
RISCOS DETECTADOS: ${d.riscos.map(r => r.titulo).join('; ') || 'nenhum'}

Entregue em até 220 palavras, tom direto e estratégico, **negrito** nos pontos-chave:
1. **DIAGNÓSTICO** (1 frase: estamos ganhando ou perdendo o mês?)
2. **TOP 3 PRIORIDADES** da semana (ações concretas, na ordem)
3. **VEREDICTO** (vamos bater a meta no ritmo atual? o que muda o jogo?)`;
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: { agent: 'sr_gerencia', messages: [{ role: 'user', content: brief }] } });
    _analysis = r.reply || '(IA não retornou resposta)';
  } catch (e) { _analysis = '⚠️ ' + (e.message || 'falha na IA'); }
  _analyzing = false; render();
}

function wire() {
  _root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { _mode = b.dataset.mode; render(); });
  const rf = _root.querySelector('[data-refresh]'); if (rf) rf.onclick = () => { _loading = true; render(); loadAll(); };
  const an = _root.querySelector('[data-analyze]'); if (an) an.onclick = analisar;
}

/* ───────── helpers ───────── */
function money(n) { return 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtInt(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
function pct1(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
function miniDark(lbl, val, sub) {
  return `<div style="background:#1e293b;border-radius:8px;padding:10px"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;font-weight:700">${lbl}</div><div style="font-size:17px;font-weight:900;color:#fff;margin-top:2px">${val}</div><div style="font-size:11px;color:#94a3b8">${sub}</div></div>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
