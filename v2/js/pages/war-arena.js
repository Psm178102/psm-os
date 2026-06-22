/* ============================================================================
   PSM-OS v2 — 🔥 WAR ARENA (TV de GUERRA, pública) — v81.16
   Painel de parede que TODOS veem (inclusive corretores): pura competição —
   conquista da meta, batalha de equipes e ranking de guerreiros. Só dado seguro
   (VGV / vendas / % meta), via /api/v3/arena/war (lvl≥2). Sem CPL/financeiro.
   Auto-rotaciona 3 cenas + celebração de venda nova (som) + setas ↑↓ no ranking.
============================================================================ */
import { api } from '../api.js';
import { sounds } from '../sounds.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const SCENES = [
  { id: 'placar', lbl: '🏰 Conquista' },
  { id: 'equipes', lbl: '⚔️ Batalha de Equipes' },
  { id: 'guerreiros', lbl: '🎖 Guerreiros' },
];
const ROTATE_MS = 14000, REFRESH_MS = 20000, CELEB_MS = 9000;

let _root = null, _idx = 0, _auto = true;
let _d = null, _events = [], _err = '', _booted = false;
let _rotTimer = null, _pollTimer = null, _clock = null;
let _lastSaleTs = null, _celebrate = null, _celebTimer = null;
let _prevRank = {}, _rankDelta = {};

export async function pageWarArena(ctx, root) {
  _root = root; _idx = 0; _auto = true; _err = ''; _booted = false; _celebrate = null; _prevRank = {}; _rankDelta = {};
  document.body.classList.add('wa-mode');
  document.documentElement.requestFullscreen?.().catch(() => {});
  enableWakeLock(() => {});
  _root.innerHTML = shell('<div style="font-size:30px;opacity:.75;text-align:center;padding:130px">🔥 Preparando o campo de batalha…</div>');
  await reload();
  _booted = true;
  startTimers();
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  document.body.classList.remove('wa-mode');
  [_rotTimer, _pollTimer, _clock, _celebTimer].forEach(t => t && clearInterval(t));
  _rotTimer = _pollTimer = _clock = _celebTimer = null;
  disableWakeLock();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function startTimers() {
  [_rotTimer, _pollTimer, _clock].forEach(t => t && clearInterval(t));
  _rotTimer = setInterval(() => { if (_auto && !_celebrate) { _idx = (_idx + 1) % SCENES.length; render(); } }, ROTATE_MS);
  _pollTimer = setInterval(reload, REFRESH_MS);
  _clock = setInterval(() => { const el = document.getElementById('wa-clock'); if (el) el.textContent = new Date().toLocaleString('pt-BR'); }, 1000);
}

async function reload() {
  try {
    const [war, live] = await Promise.all([
      api.request('/api/v3/arena/war').catch(e => ({ _err: e.message })),
      api.request('/api/v3/arena/live').catch(() => ({ events: [] })),
    ]);
    if (war && !war._err) { _d = war; _err = ''; } else if (war?._err && !_d) { _err = war._err; }
    _events = (live && live.events) || [];
    computeRankDelta();
    const lastSale = _events.find(e => e.type === 'venda');
    if (lastSale && _lastSaleTs != null && lastSale.ts > _lastSaleTs) celebrate(lastSale);
    _lastSaleTs = lastSale ? lastSale.ts : (_lastSaleTs == null ? 0 : _lastSaleTs);
    if (_booted) render();
  } catch (e) { _err = e.message || 'erro'; if (_booted) render(); }
}

function competidores() { return (_d?.guerreiros || []).filter(g => (g.vgv || 0) > 0); }
function computeRankDelta() {
  const cur = competidores(); const pos = {}; const delta = {};
  cur.forEach((g, i) => { pos[g.name] = i; });
  cur.forEach((g, i) => { delta[g.name] = (g.name in _prevRank) ? (_prevRank[g.name] - i) : 0; });
  _rankDelta = delta; _prevRank = pos;
}
function celebrate(ev) {
  _celebrate = ev;
  try { window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' })); } catch {}
  if (_celebTimer) clearTimeout(_celebTimer);
  _celebTimer = setTimeout(() => { _celebrate = null; render(); }, CELEB_MS);
  render();
}

/* ───────── shell ───────── */
function shell(body) {
  return `
    <style>
      body.wa-mode .app-sidebar, body.wa-mode .app-header { display:none !important; }
      body.wa-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
      body.wa-mode .app-main { padding:0; color:#fff; min-height:100vh;
        background: radial-gradient(circle at 15% 10%, rgba(220,38,38,.28), transparent 45%),
                    radial-gradient(circle at 85% 90%, rgba(251,191,36,.16), transparent 48%),
                    linear-gradient(135deg,#180606,#0b1020 55%,#1a0b06); }
      .wa-wrap{padding:26px 40px;font-family:system-ui,-apple-system,sans-serif;min-height:100vh;box-sizing:border-box}
      @keyframes waIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
      @keyframes waSlide{from{transform:translateX(-30px);opacity:0}to{transform:translateX(0);opacity:1}}
      @keyframes waPulse{0%,100%{opacity:1}50%{opacity:.5}}
      @keyframes waPop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.07)}100%{transform:scale(1);opacity:1}}
      @keyframes waShine{to{background-position:200% center}}
      @keyframes waBar{from{width:0}}
      @keyframes waFlame{0%,100%{transform:scale(1) rotate(-2deg)}50%{transform:scale(1.12) rotate(2deg)}}
      .wa-anim{animation:waIn .55s ease-out}.wa-row{animation:waSlide .5s ease-out both}
      .wa-title{background:linear-gradient(90deg,#dc2626,#fbbf24,#dc2626);background-size:200% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:waShine 5s linear infinite}
      .wa-tab{padding:8px 15px;border:1px solid #fbbf24;border-radius:10px;cursor:pointer;font-weight:800;font-size:13px;background:transparent;color:#fff;transition:.2s}
      .wa-tab.on{background:#fbbf24;color:#180606}
      .wa-dot{width:11px;height:11px;border-radius:50%;display:inline-block;transition:.3s}
    </style>
    <div class="wa-wrap">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px;flex-wrap:wrap">
        <h1 class="wa-title" style="font-size:46px;font-weight:900;letter-spacing:3px;margin:0">🔥 GUERRA DE VENDAS</h1>
        <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;justify-content:flex-end">
          ${SCENES.map((s, i) => `<button class="wa-tab ${i === _idx ? 'on' : ''}" data-wa="${i}">${s.lbl}</button>`).join('')}
          <button class="wa-tab ${_auto ? 'on' : ''}" data-auto="1">${_auto ? '⏸' : '▶'}</button>
          <a href="#/" class="wa-tab" style="border-color:#dc2626">✕</a>
        </div>
      </div>
      ${body}
      <div style="position:fixed;left:0;right:0;bottom:14px;display:flex;justify-content:center;gap:9px;pointer-events:none">
        ${SCENES.map((s, i) => `<span class="wa-dot" style="background:${i === _idx ? '#fbbf24' : 'rgba(255,255,255,.25)'};${i === _idx ? 'width:26px;border-radius:6px' : ''}"></span>`).join('')}
      </div>
      <div style="position:fixed;bottom:12px;right:22px;font-size:13px;opacity:.55"><span id="wa-clock">${new Date().toLocaleString('pt-BR')}</span> · ${_d?.casa?.mes || ''} · 🔊 ${sounds.isEnabled() ? 'on' : 'off'}</div>
    </div>`;
}

function render() {
  if (!_root) return;
  if (_celebrate) { _root.innerHTML = shell(celebView(_celebrate)); wire(); return; }
  let body;
  if (_err && !_d) body = `<div style="font-size:26px;opacity:.8;text-align:center;padding:120px">⚠️ ${esc(_err)}<div style="font-size:16px;opacity:.6;margin-top:10px">A TV precisa estar logada (qualquer usuário serve).</div></div>`;
  else body = ({ placar: placarScene, equipes: equipesScene, guerreiros: guerreirosScene })[SCENES[_idx].id]();
  _root.innerHTML = shell(body);
  wire();
}
function wire() {
  document.querySelectorAll('[data-wa]').forEach(b => b.addEventListener('click', () => { _idx = +b.dataset.wa || 0; _auto = false; render(); }));
  document.querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', () => { _auto = !_auto; render(); }));
}

/* ───────── CENA 1 · CONQUISTA (casa × meta) ───────── */
function placarScene() {
  const c = _d?.casa || {};
  const pct = c.pct;
  const cor = pct == null ? '#fbbf24' : pct >= 100 ? '#22c55e' : pct >= 60 ? '#fbbf24' : '#ef4444';
  const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long' });
  return `
    <div class="wa-anim" style="display:grid;gap:24px;max-width:1100px;margin:0 auto">
      <div style="text-align:center">
        <div style="font-size:22px;letter-spacing:4px;opacity:.8;text-transform:uppercase">🏰 Território conquistado · ${esc(mesNome)}</div>
        <div style="font-size:118px;font-weight:900;line-height:1;color:${cor};margin:4px 0;text-shadow:0 4px 30px ${cor}55">${pct == null ? '—' : pct1(pct)}</div>
        <div style="background:rgba(0,0,0,.45);height:40px;border-radius:20px;overflow:hidden;border:2px solid ${cor}66">
          <div style="height:100%;width:${pct == null ? 0 : Math.min(100, pct)}%;background:linear-gradient(90deg,${cor},${cor}aa);border-radius:20px;animation:waBar 1.1s ease-out"></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:22px">
        <div style="background:rgba(34,197,94,.12);border:2px solid #16a34a;border-radius:18px;padding:24px 30px;text-align:center">
          <div style="font-size:18px;opacity:.8;letter-spacing:2px">💰 CONQUISTADO</div>
          <div style="font-size:46px;font-weight:900;color:#4ade80;margin-top:6px">${money(c.vgv_mes)}</div>
          <div style="font-size:18px;opacity:.85">${int(c.vendas_mes)} venda(s)</div>
        </div>
        <div style="background:rgba(251,191,36,.12);border:2px solid #fbbf24;border-radius:18px;padding:24px 30px;text-align:center">
          <div style="font-size:18px;opacity:.8;letter-spacing:2px">🎯 ALVO DO MÊS</div>
          <div style="font-size:46px;font-weight:900;color:#fde68a;margin-top:6px">${money(c.meta_vgv)}</div>
          <div style="font-size:18px;opacity:.85">${c.uteis_restantes != null ? c.uteis_restantes + ' dias úteis restantes' : ''}</div>
        </div>
      </div>
      <div style="text-align:center;font-size:30px;font-weight:800;color:${cor};animation:waPulse 1.6s infinite">
        ${pct == null ? 'Defina as metas pra começar a guerra' : pct >= 100 ? '🏆 VITÓRIA! META CONQUISTADA!' : `⚔️ Faltam ${money(c.falta)} para a vitória — AVANÇAR!`}
      </div>
      ${c.meta_vgv > 0 ? `<div style="text-align:center;font-size:17px;opacity:.7">No ritmo atual, fecha em <b style="color:${c.bate_meta ? '#4ade80' : '#fca5a5'}">${money(c.projecao_fim)}</b> — ${c.bate_meta ? 'a vitória está no caminho ✅' : 'precisa acelerar 🔥'}</div>` : ''}
    </div>`;
}

/* ───────── CENA 2 · BATALHA DE EQUIPES ───────── */
function equipesScene() {
  const eq = _d?.equipes || [];
  if (!eq.length) return vazio('⚔️ As equipes entram em batalha quando registrarem as primeiras vendas.');
  const maxV = Math.max(1, ...eq.map(e => e.vgv || 0));
  const medal = i => ['👑', '🥈', '🥉'][i] || `${i + 1}º`;
  return `
    <div class="wa-anim" style="display:grid;gap:14px;max-width:1100px;margin:0 auto">
      <div style="font-size:20px;opacity:.75;letter-spacing:2px;text-transform:uppercase;text-align:center">⚔️ Batalha de equipes · ${esc(new Date().toLocaleDateString('pt-BR', { month: 'long' }))}</div>
      ${eq.map((e, i) => {
        const w = (e.vgv || 0) / maxV * 100, lider = i === 0;
        return `<div class="wa-row" style="animation-delay:${i * 80}ms;background:rgba(255,255,255,${lider ? '.12' : '.06'});border-radius:16px;padding:18px 22px;${lider ? 'border:2px solid #fbbf24' : 'border:1px solid #ffffff14'}">
          <div class="flex" style="justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:10px;flex-wrap:wrap">
            <div style="font-size:27px;font-weight:900">${medal(i)} ${esc((e.team || 'geral').toUpperCase())} <span style="font-size:15px;opacity:.6;font-weight:600">· ${int(e.corretores)} guerreiro(s)</span></div>
            <div style="text-align:right"><span style="font-size:30px;font-weight:900;color:#4ade80">${money(e.vgv)}</span> <span style="font-size:16px;opacity:.75">· ${int(e.vendas)}v${e.pct != null ? ` · ${pct1(e.pct)} da meta` : ''}</span></div>
          </div>
          <div style="background:rgba(0,0,0,.4);height:22px;border-radius:11px;overflow:hidden"><div style="height:100%;width:${Math.max(3, w)}%;background:linear-gradient(90deg,${lider ? '#fbbf24,#f59e0b' : '#3b82f6,#60a5fa'});border-radius:11px;animation:waBar 1s ease-out"></div></div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ───────── CENA 3 · GUERREIROS (ranking) ───────── */
function guerreirosScene() {
  const lista = competidores().slice(0, 12);
  if (!lista.length) return vazio('🎖 O primeiro a vender abre o ranking dos guerreiros. Quem será o general? 🔥');
  const topVgv = lista[0].vgv || 1;
  return `
    <div class="wa-anim" style="display:grid;gap:9px;max-width:1100px;margin:0 auto;max-height:calc(100vh - 150px);overflow:hidden">
      <div style="font-size:20px;opacity:.75;letter-spacing:2px;text-transform:uppercase;text-align:center">🎖 Ranking dos guerreiros · ${esc(new Date().toLocaleDateString('pt-BR', { month: 'long' }))}</div>
      ${lista.map((g, i) => {
        const top3 = i < 3, medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
        const bar = (g.vgv || 0) / topVgv * 100, d = _rankDelta[g.name] || 0;
        const seta = d > 0 ? `<span style="color:#4ade80;font-weight:900">▲${d}</span>` : d < 0 ? `<span style="color:#f87171;font-weight:900">▼${-d}</span>` : '<span style="opacity:.3">—</span>';
        return `<div class="wa-row" style="animation-delay:${i * 55}ms;display:grid;grid-template-columns:54px 40px 54px 1fr auto auto;gap:14px;align-items:center;padding:12px 18px;border-radius:13px;background:rgba(255,255,255,${top3 ? '.13' : '.06'});${top3 ? 'border:2px solid #fbbf24' : ''}">
          <div style="font-size:${top3 ? 32 : 25}px;font-weight:900;text-align:center">${medal}</div>
          <div style="font-size:18px;text-align:center">${seta}</div>
          <div style="width:50px;height:50px;border-radius:11px;background:${g.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:19px">${esc(g.ini)}</div>
          <div style="min-width:0">
            <div style="font-weight:800;font-size:23px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}${i === 0 ? ' <span style="font-size:13px;color:#fbbf24">★ GENERAL</span>' : ''}</div>
            <div style="font-size:14px;opacity:.6">${esc(g.team || 'geral')}${g.meta_pct != null ? ` · ${pct1(g.meta_pct)} da meta` : ''}</div>
            <div style="background:rgba(0,0,0,.3);height:6px;border-radius:3px;margin-top:6px;overflow:hidden;max-width:360px"><div style="height:100%;width:${bar}%;background:#fbbf24;animation:waBar .9s ease-out"></div></div>
          </div>
          <div style="text-align:right"><div style="font-size:13px;opacity:.6">vendas</div><div style="font-size:23px;font-weight:900;color:#93c5fd">${int(g.vendas)}</div></div>
          <div style="text-align:right;min-width:155px"><div style="font-size:13px;opacity:.6">VGV</div><div style="font-size:26px;font-weight:900;color:#4ade80">${money(g.vgv)}</div></div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ───────── celebração de venda ───────── */
function celebView(ev) {
  return `<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(circle at 50% 40%,rgba(220,38,38,.4),rgba(11,16,32,.97));z-index:60">
    <div style="font-size:130px;animation:waFlame 1s infinite">🔥</div>
    <div style="font-size:32px;letter-spacing:8px;opacity:.9;animation:waPulse 1s infinite">VITÓRIA NO CAMPO!</div>
    <div style="font-size:56px;font-weight:900;margin-top:14px;animation:waPop .7s ease-out">${esc(ev.title || 'VENDA FECHADA!')}</div>
    ${ev.subtitle ? `<div style="font-size:30px;opacity:.92;margin-top:10px">${esc(ev.subtitle)}</div>` : ''}
    ${ev.actor?.name ? `<div style="font-size:36px;color:#fde68a;font-weight:800;margin-top:18px">⚔️ ${esc(ev.actor.name)} conquistou!</div>` : ''}
    <div style="font-size:88px;margin-top:22px;letter-spacing:16px">🏆🔥🏆</div>
  </div>`;
}

/* ───────── helpers ───────── */
function vazio(msg) { return `<div style="font-size:28px;opacity:.8;text-align:center;padding:120px;max-width:800px;margin:0 auto">${msg}</div>`; }
function money(n) { return 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function int(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
function pct1(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
