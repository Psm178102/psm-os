/* ============================================================================
   PSM-OS v2 — 📺 MODO TV (refeito do zero · v81.8)
   TV de parede pra Arena de Vendas. Auto-rotaciona 3 painéis com DADO REAL do mês
   (as mesmas fontes do Dashboard, pra nunca divergir):
     🎯 Placar do Mês   → metrics/overview  (VGV mês × meta mês, %, vendas, ticket, pipeline)
     🏆 Ranking         → oo/overview?date_preset=this_month (pódio real por corretor)
     🎉 Últimas Vendas  → arena/live (feed de celebração + som em venda nova)
   Auto-rotação ~15s · barra manual (fixa o painel) · celebração full-screen em venda nova.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { sounds } from '../sounds.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const PANELS = [
  { id: 'placar',  lbl: '🎯 Placar do Mês' },
  { id: 'ranking', lbl: '🏆 Ranking' },
  { id: 'arena',   lbl: '🎉 Últimas Vendas' },
];
const ROTATE_MS = 15000;   // troca de painel
const REFRESH_MS = 20000;  // recarrega dados
const CELEBRATE_MS = 9000; // duração da celebração de venda nova

let _root = null;
let _ov = null;            // metrics/overview
let _board = null;         // oo/overview (ranking)
let _arena = [];           // arena/live events
let _err = '';
let _idx = 0;              // painel atual
let _auto = true;          // auto-rotação ligada?
let _rotTimer = null, _pollTimer = null, _clock = null;
let _lastSaleTs = null;    // pra detectar venda nova
let _celebrate = null;     // evento de venda em celebração
let _celebTimer = null;
let _booted = false;

export async function pageTV(ctx, root) {
  _root = root;
  _idx = 0; _auto = true; _err = ''; _celebrate = null; _booted = false;
  document.body.classList.add('tv-mode');
  document.documentElement.requestFullscreen?.().catch(() => {});
  enableWakeLock(updateWakeBadge);
  _root.innerHTML = shell('<div style="font-size:30px;opacity:.7;text-align:center;padding:120px">📺 Preparando a Arena…</div>');
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
  if (_rotTimer) clearInterval(_rotTimer);
  if (_pollTimer) clearInterval(_pollTimer);
  if (_clock) clearInterval(_clock);
  _rotTimer = setInterval(() => { if (_auto && !_celebrate) { _idx = (_idx + 1) % PANELS.length; render(); } }, ROTATE_MS);
  _pollTimer = setInterval(reload, REFRESH_MS);
  _clock = setInterval(() => { const el = document.getElementById('tv-clock'); if (el) el.textContent = nowStr(); }, 1000);
}

async function reload() {
  try {
    const lvl = auth.user()?.lvl || 0;
    const [ov, board, arena] = await Promise.all([
      api.request('/api/v3/metrics/overview').catch(() => null),
      lvl >= 5 ? api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null) : Promise.resolve(null),
      api.request('/api/v3/arena/live').catch(() => ({ events: [] })),
    ]);
    if (ov) _ov = ov;
    if (board) _board = board;
    _arena = (arena && arena.events) || [];
    _err = '';

    // venda nova? → som + celebração full-screen
    const lastSale = _arena.find(e => e.type === 'venda');
    if (lastSale && _lastSaleTs != null && lastSale.ts > _lastSaleTs) {
      triggerCelebration(lastSale);
    }
    if (lastSale) _lastSaleTs = lastSale.ts;
    else if (_lastSaleTs == null) _lastSaleTs = 0;

    if (_booted) render();
  } catch (e) {
    _err = e.message || 'erro ao carregar';
    if (_booted) render();
  }
}

function triggerCelebration(ev) {
  _celebrate = ev;
  try { window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' })); } catch {}
  if (_celebTimer) clearTimeout(_celebTimer);
  _celebTimer = setTimeout(() => { _celebrate = null; render(); }, CELEBRATE_MS);
  render();
}

/* ─────────────────────────── RENDER ─────────────────────────── */

function shell(inner) {
  return `
    <style>
      body.tv-mode .app-sidebar, body.tv-mode .app-header { display:none !important; }
      body.tv-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
      body.tv-mode .app-main { padding:0; color:#fff; min-height:100vh;
        background: radial-gradient(circle at 18% 12%, rgba(212,168,67,.18), transparent 46%),
                    radial-gradient(circle at 82% 88%, rgba(220,38,38,.14), transparent 48%),
                    linear-gradient(135deg, #0b1220, #1e293b); }
      .tv-wrap { padding:30px 40px; font-family:system-ui,-apple-system,sans-serif; min-height:100vh; box-sizing:border-box; }
      @keyframes tvIn { from { transform:translateY(18px); opacity:0 } to { transform:translateY(0); opacity:1 } }
      @keyframes tvSlide { from { transform:translateX(-26px); opacity:0 } to { transform:translateX(0); opacity:1 } }
      @keyframes tvPulse { 0%,100% { opacity:1 } 50% { opacity:.45 } }
      @keyframes tvPop { 0% { transform:scale(.6); opacity:0 } 60% { transform:scale(1.06) } 100% { transform:scale(1); opacity:1 } }
      @keyframes tvShine { to { background-position:200% center } }
      @keyframes tvBar { from { width:0 } }
      .tv-anim { animation:tvIn .5s ease-out }
      .tv-row { animation:tvSlide .45s ease-out both }
      .tv-title { background:linear-gradient(90deg,#d4a843,#fff,#d4a843); background-size:200% auto;
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; animation:tvShine 5s linear infinite; }
      .tv-tab { padding:9px 16px; border:1px solid #d4a843; border-radius:10px; cursor:pointer; font-weight:800; font-size:14px; background:transparent; color:#fff; transition:all .2s }
      .tv-tab.on { background:#d4a843; color:#0b1220 }
      .tv-dot { width:11px; height:11px; border-radius:50%; display:inline-block; transition:all .3s }
    </style>
    <div class="tv-wrap">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:22px;gap:14px;flex-wrap:wrap">
        <h1 class="tv-title" style="font-size:46px;font-weight:900;letter-spacing:2px;margin:0">PSM ARENA</h1>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end">
          ${PANELS.map((p, i) => `<button class="tv-tab ${i === _idx ? 'on' : ''}" data-tv="${i}">${p.lbl}</button>`).join('')}
          <button class="tv-tab ${_auto ? 'on' : ''}" data-auto="1" title="Liga/desliga a troca automática">${_auto ? '⏸ Auto' : '▶ Auto'}</button>
          <a href="#/" class="tv-tab" style="border-color:#dc2626">✕ Sair</a>
        </div>
      </div>
      ${inner}
      <div style="position:fixed;left:0;right:0;bottom:14px;display:flex;justify-content:center;gap:9px;align-items:center;pointer-events:none">
        ${PANELS.map((p, i) => `<span class="tv-dot" style="background:${i === _idx ? '#d4a843' : 'rgba(255,255,255,.25)'};${i === _idx ? 'width:26px;border-radius:6px' : ''}"></span>`).join('')}
      </div>
      <div style="position:fixed;bottom:12px;right:22px;font-size:13px;opacity:.55">
        <span id="tv-clock">${nowStr()}</span> · ${_auto ? 'rotação ' + (ROTATE_MS / 1000) + 's' : '⏸ fixado'} · 🔊 ${sounds.isEnabled() ? 'on' : 'off'}
      </div>
    </div>`;
}

function render() {
  if (!_root) return;
  if (_celebrate) { _root.innerHTML = shell(celebrationView(_celebrate)); wire(); return; }
  let body;
  if (_err && !_ov && !_board && !_arena.length) {
    body = `<div style="font-size:26px;opacity:.8;text-align:center;padding:110px">⚠️ ${escapeHtml(_err)}</div>`;
  } else {
    body = ({ placar: placarView, ranking: rankingView, arena: arenaView })[PANELS[_idx].id]();
  }
  _root.innerHTML = shell(body);
  wire();
}

function wire() {
  document.querySelectorAll('[data-tv]').forEach(b => b.addEventListener('click', () => {
    _idx = parseInt(b.dataset.tv, 10) || 0; _auto = false; render();
  }));
  document.querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', () => {
    _auto = !_auto; render();
  }));
}

/* ─────────────────────────── PAINEL 1 · PLACAR DO MÊS ─────────────────────────── */
function placarView() {
  const s = _ov?.sales || {}, m = _ov?.metas || {};
  const metaVgv = num(m.meta_vgv), vgv = num(s.vgv_mes);
  const pct = metaVgv > 0 ? (vgv / metaVgv * 100) : null;
  const falta = metaVgv > 0 ? Math.max(0, metaVgv - vgv) : 0;
  const cor = pct == null ? '#94a3b8' : pct >= 100 ? '#16a34a' : pct >= 70 ? '#22c55e' : pct >= 40 ? '#d97706' : '#dc2626';
  const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long' });

  return `
    <div class="tv-anim" style="display:grid;gap:26px">
      <!-- VGV × META + gauge -->
      <div style="display:grid;grid-template-columns:1.1fr 1fr;gap:26px">
        <div style="background:rgba(22,163,74,.14);border:2px solid #16a34a;border-radius:20px;padding:30px 34px">
          <div style="font-size:20px;letter-spacing:3px;opacity:.8;text-transform:uppercase">💰 VGV em ${escapeHtml(mesNome)}</div>
          <div style="font-size:72px;font-weight:900;color:#4ade80;line-height:1.05;margin-top:8px">R$ ${money(vgv)}</div>
          <div style="font-size:22px;opacity:.85;margin-top:6px">${int(s.vendas_mes)} venda(s) fechada(s)</div>
        </div>
        <div style="background:rgba(212,168,67,.12);border:2px solid #d4a843;border-radius:20px;padding:30px 34px;display:flex;flex-direction:column;justify-content:center">
          <div style="font-size:20px;letter-spacing:3px;opacity:.8;text-transform:uppercase">🎯 Meta do mês</div>
          <div style="font-size:50px;font-weight:900;color:#fde68a;margin-top:6px">R$ ${money(metaVgv)}</div>
          ${m.meta_vendas ? `<div style="font-size:18px;opacity:.7;margin-top:4px">meta de ${int(m.meta_vendas)} venda(s)</div>` : ''}
        </div>
      </div>

      <!-- % atingimento (barra gigante) -->
      <div style="background:rgba(255,255,255,.06);border-radius:20px;padding:28px 34px">
        <div class="flex" style="justify-content:space-between;align-items:flex-end;margin-bottom:14px">
          <div style="font-size:22px;letter-spacing:2px;opacity:.8;text-transform:uppercase">% da meta atingido</div>
          <div style="font-size:64px;font-weight:900;color:${cor};line-height:1">${pct == null ? '—' : pct2(pct)}</div>
        </div>
        <div style="background:rgba(0,0,0,.35);height:34px;border-radius:17px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct == null ? 0 : Math.min(100, pct)}%;background:linear-gradient(90deg,${cor},${cor}cc);border-radius:17px;animation:tvBar 1s ease-out"></div>
        </div>
        <div style="font-size:20px;margin-top:14px;text-align:center;font-weight:700;color:${cor}">
          ${pct == null ? 'Defina metas do mês pra ver o placar' :
            pct >= 100 ? '🎉 META BATIDA! Vamos pra cima do recorde!' :
            `Faltam R$ ${money(falta)} pra bater a meta — bora! 🔥`}
        </div>
      </div>

      <!-- KPIs de apoio -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
        ${kpiBox('🎟 Ticket médio', 'R$ ' + money(s.ticket_medio_mes), 'média da venda no mês', '#8b5cf6')}
        ${kpiBox('📈 Pipeline', 'R$ ' + money(s.pipeline_vgv), int(s.pipeline_count) + ' negócios em aberto', '#3b82f6')}
        ${kpiBox('💎 VGV no ano', 'R$ ' + money(s.vgv_ano), int(s.vendas_ano) + ' vendas em ' + new Date().getFullYear(), '#0891b2')}
      </div>
    </div>`;
}

function kpiBox(lbl, val, sub, cor) {
  return `<div style="background:rgba(255,255,255,.06);border-left:6px solid ${cor};border-radius:16px;padding:22px 26px">
    <div style="font-size:17px;opacity:.7;letter-spacing:1px;text-transform:uppercase">${lbl}</div>
    <div style="font-size:40px;font-weight:900;margin-top:6px">${val}</div>
    <div style="font-size:16px;opacity:.65;margin-top:2px">${sub}</div>
  </div>`;
}

/* ─────────────────────────── PAINEL 2 · RANKING ─────────────────────────── */
function ranked() {
  if (!_board || !_board.corretores) return [];
  const competidor = c => {
    const r = (c.role || '').toLowerCase();
    return !c.is_team && !['socio', 'diretor', 'gerente'].includes(r) && !c.hide_from_ranking;
  };
  return (_board.corretores || []).filter(competidor)
    .sort((a, b) => num(b.vgv) - num(a.vgv) || int(b.vendas) - int(a.vendas));
}

function rankingView() {
  if ((auth.user()?.lvl || 0) < 5) {
    return `<div style="font-size:26px;opacity:.8;text-align:center;padding:110px">🏆 Ranking de vendas
      <div style="font-size:17px;opacity:.6;margin-top:10px">Pra exibir o pódio, deixe a TV logada como Líder ou acima (nível ≥ 5).</div></div>`;
  }
  const lista = ranked();
  const comVenda = lista.filter(c => int(c.vendas) > 0);
  const show = (comVenda.length ? comVenda : lista).slice(0, 10);
  if (!show.length) {
    return `<div style="font-size:30px;opacity:.8;text-align:center;padding:110px">🏁 Ranking zerado neste mês
      <div style="font-size:20px;opacity:.6;margin-top:10px">A primeira venda do mês abre o pódio. Quem vai ser? 🔥</div></div>`;
  }
  const lider = show[0];
  return `
    <div class="tv-anim" style="display:grid;gap:11px;max-height:calc(100vh - 150px);overflow:hidden">
      <div style="font-size:20px;opacity:.7;letter-spacing:2px;text-transform:uppercase">🏆 Ranking de vendas · ${escapeHtml(new Date().toLocaleDateString('pt-BR', { month: 'long' }))}</div>
      ${show.map((c, i) => rankRow(c, i, num(lider.vgv))).join('')}
    </div>`;
}

function rankRow(c, i, topVgv) {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
  const ini = escapeHtml((c.ini || (c.name || '?').substring(0, 2)).toUpperCase());
  const top3 = i < 3;
  const barW = topVgv > 0 ? Math.max(4, num(c.vgv) / topVgv * 100) : 0;
  const pctMeta = c.meta_attainment_pct;
  return `
    <div class="tv-row" style="animation-delay:${i * 60}ms;display:grid;grid-template-columns:64px 64px 1fr auto auto;gap:18px;align-items:center;
        padding:16px 22px;border-radius:14px;background:rgba(255,255,255,${top3 ? '.13' : '.06'});${top3 ? 'border:2px solid #d4a843' : ''}">
      <div style="font-size:${top3 ? 40 : 30}px;font-weight:900;text-align:center">${medal}</div>
      <div style="width:58px;height:58px;border-radius:12px;background:${c.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px">${ini}</div>
      <div style="min-width:0">
        <div style="font-weight:800;font-size:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name || '—')}</div>
        <div style="font-size:15px;opacity:.65">${escapeHtml(c.team || 'geral')}${pctMeta != null ? ` · ${pct2(pctMeta)} da meta` : ''}</div>
        <div style="background:rgba(0,0,0,.3);height:7px;border-radius:4px;margin-top:7px;overflow:hidden;max-width:420px"><div style="height:100%;width:${barW}%;background:#d4a843;animation:tvBar .9s ease-out"></div></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14px;opacity:.6">vendas</div>
        <div style="font-size:26px;font-weight:900;color:#93c5fd">${int(c.vendas)}</div>
      </div>
      <div style="text-align:right;min-width:180px">
        <div style="font-size:14px;opacity:.6">VGV</div>
        <div style="font-size:30px;font-weight:900;color:#4ade80">R$ ${money(c.vgv)}</div>
      </div>
    </div>`;
}

/* ─────────────────────────── PAINEL 3 · ÚLTIMAS VENDAS (ARENA) ─────────────────────────── */
function arenaView() {
  const evs = _arena.slice(0, 9);
  if (!evs.length) {
    return `<div style="font-size:30px;opacity:.8;text-align:center;padding:110px">📡 Tudo quieto por aqui…
      <div style="font-size:20px;opacity:.6;margin-top:10px">As vendas e conquistas do time aparecem aqui ao vivo. 🎉</div></div>`;
  }
  return `
    <div class="tv-anim" style="display:grid;gap:13px;max-height:calc(100vh - 150px);overflow:hidden">
      <div style="font-size:20px;opacity:.7;letter-spacing:2px;text-transform:uppercase">🎉 Últimas vendas & conquistas</div>
      ${evs.map((e, i) => `
        <div class="tv-row" style="animation-delay:${i * 55}ms;display:grid;grid-template-columns:66px 1fr auto;gap:20px;align-items:center;
            padding:18px 24px;border-radius:14px;background:rgba(255,255,255,.07);border-left:7px solid ${e.color || '#d4a843'}">
          <div style="font-size:44px;text-align:center">${e.ico || '⭐'}</div>
          <div style="min-width:0">
            <div style="font-weight:800;font-size:26px">${escapeHtml(e.title || '')}</div>
            ${e.subtitle ? `<div style="font-size:18px;opacity:.8;margin-top:3px">${escapeHtml(e.subtitle)}</div>` : ''}
            ${e.actor?.name ? `<div style="font-size:16px;color:#fde68a;font-weight:700;margin-top:3px">👤 ${escapeHtml(e.actor.name)}</div>` : ''}
          </div>
          <div style="font-size:15px;opacity:.6;white-space:nowrap">${e.ts ? whenStr(e.ts) : ''}</div>
        </div>`).join('')}
    </div>`;
}

/* ─────────────────────────── CELEBRAÇÃO (venda nova) ─────────────────────────── */
function celebrationView(ev) {
  return `
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
        background:radial-gradient(circle at 50% 40%, rgba(22,163,74,.35), rgba(11,18,32,.96));z-index:50">
      <div style="font-size:120px;animation:tvPop .6s ease-out">🎉</div>
      <div style="font-size:30px;letter-spacing:6px;opacity:.85;animation:tvPulse 1.1s infinite">VENDA FECHADA!</div>
      <div style="font-size:54px;font-weight:900;margin-top:14px;animation:tvPop .7s ease-out">${escapeHtml(ev.title || 'Nova venda PSM')}</div>
      ${ev.subtitle ? `<div style="font-size:30px;opacity:.9;margin-top:10px">${escapeHtml(ev.subtitle)}</div>` : ''}
      ${ev.actor?.name ? `<div style="font-size:34px;color:#fde68a;font-weight:800;margin-top:18px">👏 ${escapeHtml(ev.actor.name)}</div>` : ''}
      <div style="font-size:90px;margin-top:24px;letter-spacing:18px">🏆🔥🏆</div>
    </div>`;
}

/* ─────────────────────────── selo wakelock ─────────────────────────── */
function updateWakeBadge(s) {
  let el = document.getElementById('tv-wake');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tv-wake';
    el.style.cssText = 'position:fixed;left:22px;bottom:8px;z-index:99999;font:600 12px system-ui,sans-serif;padding:4px 11px;border-radius:999px;pointer-events:none;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);transition:opacity .4s';
    document.body.appendChild(el);
  }
  if (s.on && s.method === 'wakelock') {
    el.style.background = '#16a34a'; el.textContent = '🔆 Tela travada acesa';
    setTimeout(() => { if (el) el.style.opacity = '0.3'; }, 6000);
  } else if (s.on && s.method === 'video') {
    el.style.background = '#0891b2'; el.textContent = '🔆 Tela acesa (modo vídeo)';
    setTimeout(() => { if (el) el.style.opacity = '0.3'; }, 6000);
  } else {
    el.style.opacity = '1'; el.style.background = '#d97706';
    el.textContent = '⚠️ A TV pode dormir — desligue o descanso de tela nas Configurações da TV';
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */
function num(n) { return Number(n) || 0; }
function int(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function money(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function nowStr() { return new Date().toLocaleString('pt-BR'); }
function whenStr(ts) {
  const d = new Date(ts); const hoje = new Date();
  const sameDay = d.toDateString() === hoje.toDateString();
  return sameDay ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('pt-BR');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
