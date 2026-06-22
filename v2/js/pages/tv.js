/* ============================================================================
   PSM-OS v2 — 📺 MODO TV / ARENA INTELIGENTE (v81.9)
   Auto-rotaciona painéis configuráveis, todos com DADO REAL (mesmas fontes do
   Dashboard, nunca diverge). Painéis disponíveis:
     placar    🎯 VGV mês × meta, % com barra, vendas/ticket/pipeline/ano
     ritmo     🔮 dias úteis, run-rate, projeção de fechamento, R$/dia p/ bater, MoM
     ranking   🏆 pódio do mês (oo/overview) com setas ↑↓ de quem subiu/caiu
     destaques 🏅 venda do dia, maior ticket do mês, vendas/leads de hoje, MoM
     funil     📊 Leads→Contatos→Visitas→Vendas (crm_metrics, com flag real/estimativa)
     hoje      🗓 plantão de hoje + visitas agendadas (plantoes/eventos)
     arena     🎉 feed de vendas/conquistas ao vivo
   Venda nova → celebração + som. VGV cruzando um MARCO → celebração de marco.
   Config (painéis/tempo/marcos) editável na própria TV (engrenagem, Líder+).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { sounds } from '../sounds.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const PDEF = {
  placar:    { lbl: '🎯 Placar' },
  ritmo:     { lbl: '🔮 Ritmo' },
  ranking:   { lbl: '🏆 Ranking' },
  destaques: { lbl: '🏅 Destaques' },
  funil:     { lbl: '📊 Funil' },
  hoje:      { lbl: '🗓 Hoje' },
  arena:     { lbl: '🎉 Arena' },
};
const REFRESH_MS = 20000;
const CELEBRATE_MS = 9000;

let _root = null;
let _tv = null, _ov = null, _arena = [], _funil = null, _cfg = null;
let _err = '';
let _idx = 0, _auto = true;
let _rotTimer = null, _pollTimer = null, _clock = null;
let _lastSaleTs = null, _prevVgv = null;
let _prevRank = {}, _rankDelta = {};
let _celebrate = null, _celebTimer = null;
let _cfgModal = false, _booted = false;

function panels() { return (_cfg?.paineis?.length ? _cfg.paineis : ['placar', 'ritmo', 'ranking', 'destaques', 'funil', 'hoje', 'arena']).filter(p => PDEF[p]); }
function rotMs() { return (_cfg?.rotacao_s || 15) * 1000; }

export async function pageTV(ctx, root) {
  _root = root;
  _idx = 0; _auto = true; _err = ''; _celebrate = null; _booted = false; _prevRank = {}; _rankDelta = {};
  document.body.classList.add('tv-mode');
  document.documentElement.requestFullscreen?.().catch(() => {});
  enableWakeLock(updateWakeBadge);
  _root.innerHTML = shell('<div style="font-size:30px;opacity:.7;text-align:center;padding:120px">📺 Preparando a Arena…</div>');
  try { const c = await api.request('/api/v3/arena/tv_config'); _cfg = c.config; _cfg.can_edit = c.can_edit; } catch { _cfg = null; }
  await reload();
  _booted = true;
  startTimers();
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  document.body.classList.remove('tv-mode');
  [_rotTimer, _pollTimer, _clock, _celebTimer].forEach(t => t && clearInterval(t));
  _rotTimer = _pollTimer = _clock = _celebTimer = null;
  disableWakeLock();
  document.getElementById('tv-wake')?.remove();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function startTimers() {
  [_rotTimer, _pollTimer, _clock].forEach(t => t && clearInterval(t));
  _rotTimer = setInterval(() => { if (_auto && !_celebrate && !_cfgModal) { _idx = (_idx + 1) % panels().length; render(); } }, rotMs());
  _pollTimer = setInterval(reload, REFRESH_MS);
  _clock = setInterval(() => { const el = document.getElementById('tv-clock'); if (el) el.textContent = nowStr(); }, 1000);
}

async function reload() {
  try {
    const wantFunil = panels().includes('funil');
    const [tv, ov, arena, funil] = await Promise.all([
      api.request('/api/v3/arena/tv').catch(e => ({ _err: e.message })),
      api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null),
      api.request('/api/v3/arena/live').catch(() => ({ events: [] })),
      wantFunil ? api.request('/api/v3/marketing/crm_metrics?date_preset=this_month').catch(() => null) : Promise.resolve(_funil),
    ]);
    if (tv && !tv._err) { _tv = tv; _err = ''; } else if (tv?._err && !_tv) { _err = tv._err; }
    if (ov) { _ov = ov; computeRankDelta(); }
    _arena = (arena && arena.events) || [];
    if (funil) _funil = funil;

    // venda nova → celebração + som
    const lastSale = _arena.find(e => e.type === 'venda');
    if (lastSale && _lastSaleTs != null && lastSale.ts > _lastSaleTs) celebrate({ kind: 'venda', ev: lastSale });
    _lastSaleTs = lastSale ? lastSale.ts : (_lastSaleTs == null ? 0 : _lastSaleTs);

    // VGV cruzou um marco → celebração de marco
    const vgv = _tv?.placar?.vgv_mes;
    if (vgv != null) {
      if (_prevVgv != null) {
        const cruzou = (_cfg?.marcos || []).filter(m => _prevVgv < m && vgv >= m).sort((a, b) => b - a)[0];
        if (cruzou) celebrate({ kind: 'marco', valor: cruzou });
      }
      _prevVgv = vgv;
    }

    if (_booted) render();
  } catch (e) {
    _err = e.message || 'erro'; if (_booted) render();
  }
}

function computeRankDelta() {
  const cur = ranked();
  const pos = {}; cur.forEach((c, i) => { pos[c.id || c.name] = i; });
  const delta = {};
  cur.forEach((c, i) => { const k = c.id || c.name; delta[k] = (k in _prevRank) ? (_prevRank[k] - i) : 0; });
  _rankDelta = delta; _prevRank = pos;
}

function celebrate(c) {
  _celebrate = c;
  try { window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' })); } catch {}
  if (_celebTimer) clearTimeout(_celebTimer);
  _celebTimer = setTimeout(() => { _celebrate = null; render(); }, CELEBRATE_MS);
  render();
}

/* ─────────────────────────── SHELL ─────────────────────────── */
function shell(inner) {
  const ps = panels();
  return `
    <style>
      body.tv-mode .app-sidebar, body.tv-mode .app-header { display:none !important; }
      body.tv-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
      body.tv-mode .app-main { padding:0; color:#fff; min-height:100vh;
        background: radial-gradient(circle at 18% 12%, rgba(212,168,67,.18), transparent 46%),
                    radial-gradient(circle at 82% 88%, rgba(220,38,38,.14), transparent 48%),
                    linear-gradient(135deg,#0b1220,#1e293b); }
      .tv-wrap { padding:28px 40px; font-family:system-ui,-apple-system,sans-serif; min-height:100vh; box-sizing:border-box; }
      @keyframes tvIn { from { transform:translateY(18px); opacity:0 } to { transform:translateY(0); opacity:1 } }
      @keyframes tvSlide { from { transform:translateX(-26px); opacity:0 } to { transform:translateX(0); opacity:1 } }
      @keyframes tvPulse { 0%,100% { opacity:1 } 50% { opacity:.45 } }
      @keyframes tvPop { 0% { transform:scale(.6); opacity:0 } 60% { transform:scale(1.06) } 100% { transform:scale(1); opacity:1 } }
      @keyframes tvShine { to { background-position:200% center } }
      @keyframes tvBar { from { width:0 } }
      .tv-anim { animation:tvIn .5s ease-out }
      .tv-row { animation:tvSlide .45s ease-out both }
      .tv-title { background:linear-gradient(90deg,#d4a843,#fff,#d4a843); background-size:200% auto;
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; animation:tvShine 5s linear infinite }
      .tv-tab { padding:8px 14px; border:1px solid #d4a843; border-radius:10px; cursor:pointer; font-weight:800; font-size:13px; background:transparent; color:#fff; transition:all .2s }
      .tv-tab.on { background:#d4a843; color:#0b1220 }
      .tv-dot { width:11px; height:11px; border-radius:50%; display:inline-block; transition:all .3s }
    </style>
    <div class="tv-wrap">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:20px;gap:12px;flex-wrap:wrap">
        <h1 class="tv-title" style="font-size:44px;font-weight:900;letter-spacing:2px;margin:0">PSM ARENA</h1>
        <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;justify-content:flex-end">
          ${ps.map((p, i) => `<button class="tv-tab ${i === _idx ? 'on' : ''}" data-tv="${i}">${PDEF[p].lbl}</button>`).join('')}
          <button class="tv-tab ${_auto ? 'on' : ''}" data-auto="1" title="Liga/desliga troca automática">${_auto ? '⏸ Auto' : '▶ Auto'}</button>
          ${_cfg?.can_edit ? '<button class="tv-tab" data-cfg="1" title="Configurar a TV">⚙</button>' : ''}
          <a href="#/" class="tv-tab" style="border-color:#dc2626">✕ Sair</a>
        </div>
      </div>
      ${inner}
      <div style="position:fixed;left:0;right:0;bottom:14px;display:flex;justify-content:center;gap:9px;align-items:center;pointer-events:none">
        ${ps.map((p, i) => `<span class="tv-dot" style="background:${i === _idx ? '#d4a843' : 'rgba(255,255,255,.25)'};${i === _idx ? 'width:26px;border-radius:6px' : ''}"></span>`).join('')}
      </div>
      <div style="position:fixed;bottom:12px;right:22px;font-size:13px;opacity:.55">
        <span id="tv-clock">${nowStr()}</span> · ${_auto ? 'rotação ' + (rotMs() / 1000) + 's' : '⏸ fixado'} · 🔊 ${sounds.isEnabled() ? 'on' : 'off'}
      </div>
    </div>`;
}

function render() {
  if (!_root) return;
  if (_cfgModal) { _root.innerHTML = shell(configModal()); wire(); return; }
  if (_celebrate) { _root.innerHTML = shell(celebrationView(_celebrate)); wire(); return; }
  const ps = panels();
  if (_idx >= ps.length) _idx = 0;
  let body;
  if (_err && !_tv && !_ov && !_arena.length) {
    body = `<div style="font-size:26px;opacity:.8;text-align:center;padding:110px">⚠️ ${escapeHtml(_err)}
      <div style="font-size:16px;opacity:.6;margin-top:10px">A TV precisa estar logada como Líder ou acima (nível ≥ 5).</div></div>`;
  } else {
    body = ({ placar: placarView, ritmo: ritmoView, ranking: rankingView, destaques: destaquesView, funil: funilView, hoje: hojeView, arena: arenaView })[ps[_idx]]();
  }
  _root.innerHTML = shell(body);
  wire();
}

function wire() {
  document.querySelectorAll('[data-tv]').forEach(b => b.addEventListener('click', () => { _idx = parseInt(b.dataset.tv, 10) || 0; _auto = false; render(); }));
  document.querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', () => { _auto = !_auto; render(); }));
  document.querySelectorAll('[data-cfg]').forEach(b => b.addEventListener('click', () => { _cfgModal = true; render(); }));
  document.querySelectorAll('[data-cfg-close]').forEach(b => b.addEventListener('click', () => { _cfgModal = false; render(); }));
  document.querySelectorAll('[data-cfg-save]').forEach(b => b.addEventListener('click', saveConfig));
}

/* ─────────────────────────── PAINEL · PLACAR ─────────────────────────── */
function placarView() {
  const p = _tv?.placar || {}, mt = _tv?.meta || {};
  const vgv = num(p.vgv_mes), metaVgv = num(mt.meta_vgv);
  const pct = mt.pct;
  const cor = pct == null ? '#94a3b8' : pct >= 100 ? '#16a34a' : pct >= 70 ? '#22c55e' : pct >= 40 ? '#d97706' : '#dc2626';
  const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long' });
  return `
    <div class="tv-anim" style="display:grid;gap:24px">
      <div style="display:grid;grid-template-columns:1.1fr 1fr;gap:24px">
        <div style="background:rgba(22,163,74,.14);border:2px solid #16a34a;border-radius:20px;padding:28px 32px">
          <div style="font-size:19px;letter-spacing:3px;opacity:.8;text-transform:uppercase">💰 VGV em ${escapeHtml(mesNome)}</div>
          <div style="font-size:68px;font-weight:900;color:#4ade80;line-height:1.05;margin-top:8px">R$ ${money(vgv)}</div>
          <div style="font-size:21px;opacity:.85;margin-top:6px">${int(p.vendas_mes)} venda(s) fechada(s)</div>
        </div>
        <div style="background:rgba(212,168,67,.12);border:2px solid #d4a843;border-radius:20px;padding:28px 32px;display:flex;flex-direction:column;justify-content:center">
          <div style="font-size:19px;letter-spacing:3px;opacity:.8;text-transform:uppercase">🎯 Meta do mês</div>
          <div style="font-size:48px;font-weight:900;color:#fde68a;margin-top:6px">R$ ${money(metaVgv)}</div>
          ${mt.meta_vendas ? `<div style="font-size:17px;opacity:.7;margin-top:4px">meta de ${int(mt.meta_vendas)} venda(s)</div>` : ''}
        </div>
      </div>
      <div style="background:rgba(255,255,255,.06);border-radius:20px;padding:26px 32px">
        <div class="flex" style="justify-content:space-between;align-items:flex-end;margin-bottom:14px">
          <div style="font-size:21px;letter-spacing:2px;opacity:.8;text-transform:uppercase">% da meta atingido</div>
          <div style="font-size:60px;font-weight:900;color:${cor};line-height:1">${pct == null ? '—' : pct2(pct)}</div>
        </div>
        <div style="background:rgba(0,0,0,.35);height:32px;border-radius:16px;overflow:hidden">
          <div style="height:100%;width:${pct == null ? 0 : Math.min(100, pct)}%;background:linear-gradient(90deg,${cor},${cor}cc);border-radius:16px;animation:tvBar 1s ease-out"></div>
        </div>
        <div style="font-size:19px;margin-top:13px;text-align:center;font-weight:700;color:${cor}">
          ${pct == null ? 'Defina metas do mês pra ver o placar' : pct >= 100 ? '🎉 META BATIDA! Bora pro recorde!' : `Faltam R$ ${money(mt.falta)} pra bater a meta 🔥`}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px">
        ${kpiBox('🎟 Ticket médio', 'R$ ' + money(p.ticket_medio_mes), 'média da venda no mês', '#8b5cf6')}
        ${kpiBox('📈 Pipeline', 'R$ ' + money(p.pipeline_vgv), int(p.pipeline_count) + ' negócios em aberto', '#3b82f6')}
        ${kpiBox('💎 VGV no ano', 'R$ ' + money(p.vgv_ano), int(p.vendas_ano) + ' vendas em ' + new Date().getFullYear(), '#0891b2')}
      </div>
    </div>`;
}

/* ─────────────────────────── PAINEL · RITMO & PROJEÇÃO ─────────────────────────── */
function ritmoView() {
  const pr = _tv?.projecao || {}, mt = _tv?.meta || {}, p = _tv?.placar || {};
  const metaVgv = num(mt.meta_vgv);
  const proj = num(pr.projecao_fim);
  const bate = pr.bate_meta;
  const projCor = bate == null ? '#fde68a' : bate ? '#4ade80' : '#f87171';
  const mom = pr.mom_pct;
  const momCor = mom == null ? '#94a3b8' : mom >= 0 ? '#4ade80' : '#f87171';
  return `
    <div class="tv-anim" style="display:grid;gap:24px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
        ${kpiBig('📅 Dias úteis restantes', int(pr.uteis_restantes), `${int(pr.uteis_decorridos)} de ${int(pr.uteis_total)} já passaram`, '#3b82f6')}
        ${kpiBig('⚡ Ritmo atual', 'R$ ' + money(pr.run_rate_dia), 'VGV por dia útil até agora', '#8b5cf6')}
        ${kpiBig('🎯 Precisa por dia', 'R$ ' + money(pr.precisa_por_dia), 'por dia útil restante p/ bater a meta', '#d4a843')}
      </div>
      <div style="background:rgba(255,255,255,.06);border-radius:20px;padding:28px 32px;text-align:center">
        <div style="font-size:20px;letter-spacing:2px;opacity:.8;text-transform:uppercase">🔮 Projeção de fechamento do mês</div>
        <div style="font-size:66px;font-weight:900;color:${projCor};margin-top:8px">R$ ${money(proj)}</div>
        <div style="font-size:20px;margin-top:6px;font-weight:700;color:${projCor}">
          ${bate == null ? 'no ritmo atual' : bate ? `✅ no ritmo, BATE a meta de R$ ${money(metaVgv)}` : `⚠️ no ritmo, fica R$ ${money(Math.max(0, metaVgv - proj))} abaixo da meta`}
        </div>
        ${metaVgv > 0 ? `<div style="background:rgba(0,0,0,.3);height:16px;border-radius:8px;margin-top:18px;overflow:hidden;position:relative">
          <div style="height:100%;width:${Math.min(100, proj / metaVgv * 100)}%;background:${projCor};animation:tvBar 1s ease-out"></div>
        </div><div style="font-size:14px;opacity:.6;margin-top:6px">projeção vs meta do mês</div>` : ''}
      </div>
      <div style="background:rgba(255,255,255,.06);border-radius:16px;padding:22px 30px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div style="font-size:20px;opacity:.85">📊 Comparado ao mês anterior <span style="opacity:.6;font-size:15px">(mesmo ponto do mês)</span></div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="font-size:17px;opacity:.7">mês passado: R$ ${money(pr.mes_anterior_ponto_vgv)}</div>
          <div style="font-size:38px;font-weight:900;color:${momCor}">${mom == null ? '—' : (mom >= 0 ? '▲ +' : '▼ ') + pct2(Math.abs(mom)).replace('%', '') + '%'}</div>
        </div>
      </div>
    </div>`;
}

/* ─────────────────────────── PAINEL · RANKING ─────────────────────────── */
function ranked() {
  if (!_ov?.corretores) return [];
  const comp = c => { const r = (c.role || '').toLowerCase(); return !c.is_team && !['socio', 'diretor', 'gerente'].includes(r) && !c.hide_from_ranking; };
  return _ov.corretores.filter(comp).sort((a, b) => num(b.vgv) - num(a.vgv) || int(b.vendas) - int(a.vendas));
}
function rankingView() {
  if ((auth.user()?.lvl || 0) < 5) return `<div style="font-size:26px;opacity:.8;text-align:center;padding:110px">🏆 Ranking de vendas<div style="font-size:17px;opacity:.6;margin-top:10px">Deixe a TV logada como Líder+ (nível ≥ 5) pra exibir o pódio.</div></div>`;
  const lista = ranked();
  const comVenda = lista.filter(c => int(c.vendas) > 0);
  const show = (comVenda.length ? comVenda : lista).slice(0, 10);
  if (!show.length) return `<div style="font-size:30px;opacity:.8;text-align:center;padding:110px">🏁 Ranking zerado neste mês<div style="font-size:20px;opacity:.6;margin-top:10px">A primeira venda abre o pódio. Quem vai ser? 🔥</div></div>`;
  const topVgv = num(show[0].vgv);
  return `
    <div class="tv-anim" style="display:grid;gap:10px;max-height:calc(100vh - 150px);overflow:hidden">
      <div style="font-size:20px;opacity:.7;letter-spacing:2px;text-transform:uppercase">🏆 Ranking de vendas · ${escapeHtml(new Date().toLocaleDateString('pt-BR', { month: 'long' }))}</div>
      ${show.map((c, i) => rankRow(c, i, topVgv)).join('')}
    </div>`;
}
function rankRow(c, i, topVgv) {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
  const ini = escapeHtml((c.ini || (c.name || '?').substring(0, 2)).toUpperCase());
  const top3 = i < 3;
  const barW = topVgv > 0 ? Math.max(4, num(c.vgv) / topVgv * 100) : 0;
  const d = _rankDelta[c.id || c.name] || 0;
  const seta = d > 0 ? `<span style="color:#4ade80;font-weight:900" title="subiu ${d}">▲${d}</span>` : d < 0 ? `<span style="color:#f87171;font-weight:900" title="caiu ${-d}">▼${-d}</span>` : '<span style="opacity:.35">—</span>';
  return `
    <div class="tv-row" style="animation-delay:${i * 55}ms;display:grid;grid-template-columns:60px 44px 60px 1fr auto auto;gap:16px;align-items:center;padding:15px 20px;border-radius:14px;background:rgba(255,255,255,${top3 ? '.13' : '.06'});${top3 ? 'border:2px solid #d4a843' : ''}">
      <div style="font-size:${top3 ? 38 : 28}px;font-weight:900;text-align:center">${medal}</div>
      <div style="font-size:20px;text-align:center">${seta}</div>
      <div style="width:56px;height:56px;border-radius:12px;background:${c.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:21px">${ini}</div>
      <div style="min-width:0">
        <div style="font-weight:800;font-size:25px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name || '—')}</div>
        <div style="font-size:15px;opacity:.65">${escapeHtml(c.team || 'geral')}${c.meta_attainment_pct != null ? ` · ${pct2(c.meta_attainment_pct)} da meta` : ''}</div>
        <div style="background:rgba(0,0,0,.3);height:7px;border-radius:4px;margin-top:7px;overflow:hidden;max-width:420px"><div style="height:100%;width:${barW}%;background:#d4a843;animation:tvBar .9s ease-out"></div></div>
      </div>
      <div style="text-align:right"><div style="font-size:14px;opacity:.6">vendas</div><div style="font-size:25px;font-weight:900;color:#93c5fd">${int(c.vendas)}</div></div>
      <div style="text-align:right;min-width:170px"><div style="font-size:14px;opacity:.6">VGV</div><div style="font-size:28px;font-weight:900;color:#4ade80">R$ ${money(c.vgv)}</div></div>
    </div>`;
}

/* ─────────────────────────── PAINEL · DESTAQUES ─────────────────────────── */
function destaquesView() {
  const d = _tv?.destaques || {}, pr = _tv?.projecao || {};
  const mt = d.maior_ticket_mes, vd = d.venda_do_dia;
  const mom = pr.mom_pct;
  const momCor = mom == null ? '#94a3b8' : mom >= 0 ? '#4ade80' : '#f87171';
  return `
    <div class="tv-anim" style="display:grid;gap:22px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px">
        <div style="background:rgba(220,38,38,.14);border:2px solid #ef4444;border-radius:20px;padding:28px 32px">
          <div style="font-size:19px;letter-spacing:2px;opacity:.8;text-transform:uppercase">🔥 Venda do dia</div>
          ${vd ? `<div style="font-size:52px;font-weight:900;color:#fca5a5;margin-top:8px">R$ ${money(vd.amount)}</div>
            <div style="font-size:24px;color:#fde68a;font-weight:800;margin-top:6px">👤 ${escapeHtml(vd.corretor)}</div>
            ${vd.marca ? `<div style="font-size:16px;opacity:.65;margin-top:2px">${escapeHtml(vd.marca)}</div>` : ''}`
            : '<div style="font-size:24px;opacity:.6;margin-top:18px">Nenhuma venda fechada hoje… ainda. 👀</div>'}
        </div>
        <div style="background:rgba(212,168,67,.12);border:2px solid #d4a843;border-radius:20px;padding:28px 32px">
          <div style="font-size:19px;letter-spacing:2px;opacity:.8;text-transform:uppercase">🏆 Maior ticket do mês</div>
          ${mt ? `<div style="font-size:52px;font-weight:900;color:#fde68a;margin-top:8px">R$ ${money(mt.amount)}</div>
            <div style="font-size:24px;color:#fff;font-weight:800;margin-top:6px">👤 ${escapeHtml(mt.corretor)}</div>
            ${mt.marca ? `<div style="font-size:16px;opacity:.65;margin-top:2px">${escapeHtml(mt.marca)}</div>` : ''}`
            : '<div style="font-size:24px;opacity:.6;margin-top:18px">Sem vendas no mês ainda.</div>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px">
        ${kpiBox('✅ Vendas hoje', int(d.vendas_hoje), 'R$ ' + money(d.vgv_hoje) + ' em VGV', '#16a34a')}
        ${kpiBox('🌱 Leads hoje', int(d.leads_hoje), 'novos negócios criados hoje', '#3b82f6')}
        ${kpiBox('📊 vs mês anterior', (mom == null ? '—' : (mom >= 0 ? '+' : '') + pct2(mom)), 'no mesmo ponto do mês', momCor === '#94a3b8' ? '#64748b' : (mom >= 0 ? '#16a34a' : '#dc2626'))}
      </div>
    </div>`;
}

/* ─────────────────────────── PAINEL · FUNIL ─────────────────────────── */
function funilView() {
  const g = _funil?.global;
  if (!g) return `<div style="font-size:26px;opacity:.8;text-align:center;padding:110px">📊 Funil de conversão<div style="font-size:16px;opacity:.6;margin-top:10px">Carregando dados do CRM… (precisa de login Líder+).</div></div>`;
  const real = _funil.metrics_basis === 'real';
  const stages = [
    { lbl: 'Leads', n: int0(g.leads_criados), cor: '#3b82f6' },
    { lbl: 'Contatos', n: int0(g.leads_contatados), cor: '#8b5cf6' },
    { lbl: 'Visitas', n: int0(g.leads_visita), cor: '#d4a843' },
    { lbl: 'Vendas', n: int0(g.vendas), cor: '#16a34a' },
  ];
  const top = Math.max(1, stages[0].n);
  return `
    <div class="tv-anim" style="display:grid;gap:14px">
      <div class="flex" style="justify-content:space-between;align-items:center">
        <div style="font-size:20px;opacity:.7;letter-spacing:2px;text-transform:uppercase">📊 Funil de conversão · mês</div>
        <span style="font-size:14px;padding:4px 12px;border-radius:20px;background:${real ? 'rgba(22,163,74,.2)' : 'rgba(217,119,6,.2)'};color:${real ? '#86efac' : '#fcd34d'};font-weight:700">${real ? '✓ dados reais' : '≈ estimativa'}</span>
      </div>
      ${stages.map((s, i) => {
        const w = Math.max(6, s.n / top * 100);
        const conv = i > 0 && stages[i - 1].n > 0 ? (s.n / stages[i - 1].n * 100) : null;
        return `<div class="tv-row" style="animation-delay:${i * 70}ms">
          <div class="flex" style="justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <span style="font-size:22px;font-weight:800">${s.lbl}</span>
            <span style="font-size:30px;font-weight:900;color:${s.cor}">${int(s.n)}${conv != null ? ` <span style="font-size:16px;opacity:.7;font-weight:700">(${pct2(conv)} ↓)</span>` : ''}</span>
          </div>
          <div style="background:rgba(0,0,0,.3);height:30px;border-radius:10px;overflow:hidden"><div style="height:100%;width:${w}%;background:linear-gradient(90deg,${s.cor},${s.cor}aa);border-radius:10px;animation:tvBar 1s ease-out"></div></div>
        </div>`;
      }).join('')}
      <div style="text-align:center;font-size:18px;opacity:.75;margin-top:6px">
        Conversão geral lead→venda: <b style="color:#4ade80">${stages[0].n > 0 ? pct2(stages[3].n / stages[0].n * 100) : '—'}</b>
      </div>
    </div>`;
}

/* ─────────────────────────── PAINEL · HOJE ─────────────────────────── */
function hojeView() {
  const h = _tv?.hoje || {};
  const plantao = h.plantao || [], visitas = h.visitas || [];
  return `
    <div class="tv-anim" style="display:grid;grid-template-columns:1fr 1.4fr;gap:22px;max-height:calc(100vh - 150px)">
      <div style="background:rgba(255,255,255,.06);border-radius:18px;padding:24px 28px">
        <div style="font-size:22px;font-weight:800;margin-bottom:14px">📍 Plantão de hoje</div>
        ${plantao.length ? plantao.map(p => `<div class="tv-row" style="display:flex;justify-content:space-between;align-items:center;padding:13px 16px;background:rgba(255,255,255,.06);border-radius:10px;margin-bottom:8px;font-size:20px">
          <span style="font-weight:700">👤 ${escapeHtml(p.corretor)}</span>${p.periodo ? `<span style="opacity:.7;font-size:16px">${escapeHtml(p.periodo)}</span>` : ''}</div>`).join('')
          : '<div style="font-size:18px;opacity:.55;padding:10px">Ninguém escalado pra hoje.</div>'}
      </div>
      <div style="background:rgba(255,255,255,.06);border-radius:18px;padding:24px 28px;overflow:hidden">
        <div style="font-size:22px;font-weight:800;margin-bottom:14px">🗓 Visitas agendadas hoje <span style="opacity:.6;font-size:16px">(${int(h.visitas_total || visitas.length)})</span></div>
        ${visitas.length ? visitas.map(v => `<div class="tv-row" style="display:grid;grid-template-columns:72px 1fr auto;gap:14px;align-items:center;padding:12px 14px;background:rgba(255,255,255,.06);border-radius:10px;margin-bottom:7px;font-size:18px">
          <span style="font-weight:900;color:#d4a843">${escapeHtml(v.hora || '--:--')}</span>
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(v.titulo)}${v.local ? ` · <span style="opacity:.6">${escapeHtml(v.local)}</span>` : ''}</span>
          <span style="opacity:.8;font-size:15px;white-space:nowrap">👤 ${escapeHtml(v.corretor)}</span></div>`).join('')
          : '<div style="font-size:18px;opacity:.55;padding:10px">Nenhuma visita agendada pra hoje na agenda.</div>'}
      </div>
    </div>`;
}

/* ─────────────────────────── PAINEL · ARENA (eventos) ─────────────────────────── */
function arenaView() {
  const evs = _arena.slice(0, 9);
  if (!evs.length) return `<div style="font-size:30px;opacity:.8;text-align:center;padding:110px">📡 Tudo quieto por aqui…<div style="font-size:20px;opacity:.6;margin-top:10px">As vendas e conquistas aparecem aqui ao vivo. 🎉</div></div>`;
  return `
    <div class="tv-anim" style="display:grid;gap:12px;max-height:calc(100vh - 150px);overflow:hidden">
      <div style="font-size:20px;opacity:.7;letter-spacing:2px;text-transform:uppercase">🎉 Últimas vendas & conquistas</div>
      ${evs.map((e, i) => `<div class="tv-row" style="animation-delay:${i * 55}ms;display:grid;grid-template-columns:64px 1fr auto;gap:18px;align-items:center;padding:17px 22px;border-radius:14px;background:rgba(255,255,255,.07);border-left:7px solid ${e.color || '#d4a843'}">
        <div style="font-size:42px;text-align:center">${e.ico || '⭐'}</div>
        <div style="min-width:0"><div style="font-weight:800;font-size:25px">${escapeHtml(e.title || '')}</div>
          ${e.subtitle ? `<div style="font-size:17px;opacity:.8;margin-top:2px">${escapeHtml(e.subtitle)}</div>` : ''}
          ${e.actor?.name ? `<div style="font-size:15px;color:#fde68a;font-weight:700;margin-top:2px">👤 ${escapeHtml(e.actor.name)}</div>` : ''}</div>
        <div style="font-size:15px;opacity:.6;white-space:nowrap">${e.ts ? whenStr(e.ts) : ''}</div>
      </div>`).join('')}
    </div>`;
}

/* ─────────────────────────── CELEBRAÇÃO ─────────────────────────── */
function celebrationView(c) {
  if (c.kind === 'marco') {
    return `<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(circle at 50% 40%, rgba(212,168,67,.4), rgba(11,18,32,.96));z-index:50">
      <div style="font-size:120px;animation:tvPop .6s ease-out">🏆</div>
      <div style="font-size:30px;letter-spacing:6px;opacity:.85;animation:tvPulse 1.1s infinite">MARCO BATIDO!</div>
      <div style="font-size:72px;font-weight:900;color:#fde68a;margin-top:14px;animation:tvPop .7s ease-out">R$ ${money(c.valor)}</div>
      <div style="font-size:28px;opacity:.9;margin-top:10px">de VGV no mês — que time! 🚀</div>
      <div style="font-size:80px;margin-top:24px;letter-spacing:18px">🎉🏆🎉</div>
    </div>`;
  }
  const ev = c.ev || {};
  return `<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(circle at 50% 40%, rgba(22,163,74,.35), rgba(11,18,32,.96));z-index:50">
    <div style="font-size:120px;animation:tvPop .6s ease-out">🎉</div>
    <div style="font-size:30px;letter-spacing:6px;opacity:.85;animation:tvPulse 1.1s infinite">VENDA FECHADA!</div>
    <div style="font-size:54px;font-weight:900;margin-top:14px;animation:tvPop .7s ease-out">${escapeHtml(ev.title || 'Nova venda PSM')}</div>
    ${ev.subtitle ? `<div style="font-size:30px;opacity:.9;margin-top:10px">${escapeHtml(ev.subtitle)}</div>` : ''}
    ${ev.actor?.name ? `<div style="font-size:34px;color:#fde68a;font-weight:800;margin-top:18px">👏 ${escapeHtml(ev.actor.name)}</div>` : ''}
    <div style="font-size:90px;margin-top:24px;letter-spacing:18px">🏆🔥🏆</div>
  </div>`;
}

/* ─────────────────────────── CONFIG (modal) ─────────────────────────── */
function configModal() {
  const sel = new Set(panels());
  const ordem = panels().concat(Object.keys(PDEF).filter(k => !sel.has(k)));  // selecionados primeiro
  return `
    <div style="position:fixed;inset:0;background:rgba(11,18,32,.8);z-index:60;display:flex;align-items:center;justify-content:center;padding:5vh 16px">
      <div style="background:#0f172a;border:1px solid #334155;border-radius:18px;padding:28px 32px;max-width:560px;width:100%;max-height:88vh;overflow:auto">
        <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="font-size:26px;font-weight:800;margin:0">⚙ Configurar Modo TV</h2>
          <button class="tv-tab" data-cfg-close="1">✕</button>
        </div>
        <div style="font-size:15px;opacity:.7;margin-bottom:8px">Painéis que giram (marque e a ordem segue de cima pra baixo):</div>
        <div id="tvcfg-paineis" style="display:grid;gap:8px;margin-bottom:18px">
          ${ordem.map(k => `<label style="display:flex;align-items:center;gap:10px;font-size:18px;padding:9px 12px;background:rgba(255,255,255,.05);border-radius:10px;cursor:pointer">
            <input type="checkbox" data-painel="${k}" ${sel.has(k) ? 'checked' : ''} style="width:20px;height:20px"> ${PDEF[k].lbl}</label>`).join('')}
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px">
          <label style="font-size:16px">Tempo por painel (s)<br><input id="tvcfg-rot" type="number" min="6" max="120" value="${_cfg?.rotacao_s || 15}" style="margin-top:6px;width:120px;padding:8px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#fff;font-size:18px"></label>
          <label style="font-size:16px;flex:1;min-width:220px">Marcos de VGV p/ celebrar (R$, vírgula)<br><input id="tvcfg-marcos" value="${(_cfg?.marcos || []).join(', ')}" style="margin-top:6px;width:100%;padding:8px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#fff;font-size:16px"></label>
        </div>
        <div id="tvcfg-msg" style="font-size:15px;margin-bottom:10px;min-height:20px"></div>
        <div class="flex gap-2" style="justify-content:flex-end;gap:10px">
          <button class="tv-tab" data-cfg-close="1">Cancelar</button>
          <button class="tv-tab on" data-cfg-save="1">💾 Salvar</button>
        </div>
      </div>
    </div>`;
}

async function saveConfig() {
  const paineis = [...document.querySelectorAll('[data-painel]')].filter(c => c.checked).map(c => c.dataset.painel);
  const msg = document.getElementById('tvcfg-msg');
  if (!paineis.length) { if (msg) { msg.textContent = '⚠️ Selecione ao menos um painel.'; msg.style.color = '#fca5a5'; } return; }
  const rotacao_s = Math.max(6, Math.min(120, parseInt(document.getElementById('tvcfg-rot')?.value, 10) || 15));
  const marcos = (document.getElementById('tvcfg-marcos')?.value || '').split(',').map(x => parseInt(String(x).replace(/\D/g, ''), 10)).filter(n => n > 0);
  if (msg) { msg.textContent = '⏳ salvando…'; msg.style.color = '#cbd5e1'; }
  try {
    const r = await api.request('/api/v3/arena/tv_config', { method: 'POST', body: { config: { paineis, rotacao_s, marcos } } });
    _cfg = { ...r.config, can_edit: true };
    _cfgModal = false; _idx = 0;
    startTimers();
    const wantFunil = paineis.includes('funil');
    if (wantFunil && !_funil) { await reload(); } else { render(); }
  } catch (e) { if (msg) { msg.textContent = '⚠️ ' + e.message; msg.style.color = '#fca5a5'; } }
}

/* ─────────────────────────── selo wakelock ─────────────────────────── */
function updateWakeBadge(s) {
  let el = document.getElementById('tv-wake');
  if (!el) {
    el = document.createElement('div'); el.id = 'tv-wake';
    el.style.cssText = 'position:fixed;left:22px;bottom:8px;z-index:99999;font:600 12px system-ui,sans-serif;padding:4px 11px;border-radius:999px;pointer-events:none;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);transition:opacity .4s';
    document.body.appendChild(el);
  }
  if (s.on && s.method === 'wakelock') { el.style.background = '#16a34a'; el.textContent = '🔆 Tela travada acesa'; setTimeout(() => { if (el) el.style.opacity = '0.3'; }, 6000); }
  else if (s.on && s.method === 'video') { el.style.background = '#0891b2'; el.textContent = '🔆 Tela acesa (vídeo)'; setTimeout(() => { if (el) el.style.opacity = '0.3'; }, 6000); }
  else { el.style.opacity = '1'; el.style.background = '#d97706'; el.textContent = '⚠️ A TV pode dormir — desligue o descanso de tela'; }
}

/* ─────────────────────────── helpers ─────────────────────────── */
function num(n) { return Number(n) || 0; }
function int0(n) { return Number(n) || 0; }
function int(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function money(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function nowStr() { return new Date().toLocaleString('pt-BR'); }
function whenStr(ts) { const d = new Date(ts); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('pt-BR'); }
function kpiBox(lbl, val, sub, cor) {
  return `<div style="background:rgba(255,255,255,.06);border-left:6px solid ${cor};border-radius:16px;padding:20px 24px">
    <div style="font-size:16px;opacity:.7;letter-spacing:1px;text-transform:uppercase">${lbl}</div>
    <div style="font-size:38px;font-weight:900;margin-top:6px;color:${cor}">${val}</div>
    <div style="font-size:15px;opacity:.65;margin-top:2px">${sub}</div></div>`;
}
function kpiBig(lbl, val, sub, cor) {
  return `<div style="background:rgba(255,255,255,.06);border:2px solid ${cor};border-radius:18px;padding:24px 26px;text-align:center">
    <div style="font-size:17px;opacity:.75;letter-spacing:1px;text-transform:uppercase">${lbl}</div>
    <div style="font-size:46px;font-weight:900;margin-top:8px;color:${cor}">${val}</div>
    <div style="font-size:15px;opacity:.65;margin-top:4px">${sub}</div></div>`;
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
