/* PSM-OS v2 — Modo TV (Sprint 7.23) */
import { api } from '../api.js';

let _root = null, _events = [], _ranking = [], _mode = 'arena', _pollTimer = null;

export async function pageTV(ctx, root) {
  _root = root;
  // Esconde sidebar/header pra fullscreen
  document.body.classList.add('tv-mode');
  document.documentElement.requestFullscreen?.().catch(() => {});
  await reload();
  startPoll();
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  document.body.classList.remove('tv-mode');
  if (_pollTimer) clearInterval(_pollTimer);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

async function reload() {
  try {
    const [arena, ranking] = await Promise.all([
      api.request('/api/v3/arena/live'),
      api.request('/api/v3/metas/atingimento?ano=' + new Date().getFullYear()).catch(() => null),
    ]);
    _events = (arena.events || []).slice(0, 15);
    if (ranking) {
      _ranking = (ranking.grid || []).filter(g => g.totals?.atingido_vgv > 0)
        .sort((a, b) => b.totals.atingido_vgv - a.totals.atingido_vgv).slice(0, 10);
    }
    render();
  } catch (e) {
    _root.innerHTML = `<div style="padding:40px;color:#fff">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function startPoll() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(reload, 30000);
}

function render() {
  _root.innerHTML = `
    <style>
      body.tv-mode .app-sidebar, body.tv-mode .app-header { display: none !important; }
      body.tv-mode .app-shell { grid-template-columns: 1fr; grid-template-rows: 1fr; grid-template-areas: "main"; }
      body.tv-mode .app-main { padding: 0; background: linear-gradient(135deg, #0f172a, #1e293b); color: #fff; min-height: 100vh; }
    </style>
    <div style="padding:32px;font-family:system-ui">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:24px">
        <h1 style="font-size:48px;font-weight:900;letter-spacing:2px;margin:0;background:linear-gradient(90deg,#d4a843,#fff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">PSM ARENA LIVE</h1>
        <div style="text-align:right">
          <button class="btn btn-ghost" data-tv="arena" style="color:#fff;background:${_mode==='arena'?'rgba(212,168,67,0.3)':'transparent'};border:1px solid #d4a843">📡 Arena</button>
          <button class="btn btn-ghost" data-tv="ranking" style="color:#fff;background:${_mode==='ranking'?'rgba(212,168,67,0.3)':'transparent'};border:1px solid #d4a843">🏆 Ranking</button>
          <a href="#/" style="color:#fff;background:transparent;border:1px solid #d4a843;padding:6px 14px;border-radius:6px;text-decoration:none;font-weight:700">✕ Sair</a>
        </div>
      </div>

      ${_mode === 'arena' ? arenaView() : rankingView()}

      <div style="position:fixed;bottom:16px;right:24px;font-size:13px;opacity:0.6">
        ${new Date().toLocaleString('pt-BR')} · refresh 30s
      </div>
    </div>
  `;
  document.querySelectorAll('[data-tv]').forEach(b => b.addEventListener('click', () => { _mode = b.dataset.tv; render(); }));
}

function arenaView() {
  return `
    <div style="display:grid;gap:14px;max-height:calc(100vh - 140px);overflow:hidden">
      ${_events.length === 0 ? '<div style="font-size:24px;opacity:0.7;text-align:center;padding:60px">Aguardando atividade…</div>' :
        _events.map(e => `
          <div style="display:grid;grid-template-columns:60px 1fr auto;gap:18px;padding:18px 24px;background:rgba(255,255,255,0.08);border-left:6px solid ${e.color};border-radius:12px;align-items:center;font-size:20px">
            <div style="font-size:36px;text-align:center">${e.ico}</div>
            <div>
              <div style="font-weight:800;font-size:24px">${escapeHtml(e.title)}</div>
              ${e.subtitle ? `<div style="font-size:16px;opacity:0.8;margin-top:4px">${escapeHtml(e.subtitle)}</div>` : ''}
              ${e.actor ? `<div style="font-size:14px;color:#d4a843;margin-top:4px;font-weight:600">👤 ${escapeHtml(e.actor.name)}</div>` : ''}
            </div>
            <div style="font-size:14px;opacity:0.6">${e.ts ? new Date(e.ts).toLocaleString('pt-BR') : ''}</div>
          </div>
        `).join('')}
    </div>
  `;
}

function rankingView() {
  if (_ranking.length === 0) return '<div style="font-size:24px;opacity:0.7;text-align:center;padding:60px">Sem vendas no ano ainda.</div>';
  return `
    <div style="display:grid;gap:10px">
      ${_ranking.map((g, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const ini = escapeHtml((g.user.ini || (g.user.name || '?').substring(0, 2)).toUpperCase());
        return `
          <div style="display:grid;grid-template-columns:80px 60px 1fr auto;gap:18px;padding:18px 24px;background:rgba(255,255,255,0.08);border-radius:12px;align-items:center;font-size:22px">
            <div style="font-size:36px;text-align:center;font-weight:800">${medal}</div>
            <div style="width:56px;height:56px;border-radius:8px;background:${g.user.color || '#d4a843'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px">${ini}</div>
            <div>
              <div style="font-weight:800;font-size:26px">${escapeHtml(g.user.name)}</div>
              <div style="font-size:14px;opacity:0.7">${g.totals.vendas_count} vendas</div>
            </div>
            <div style="font-size:30px;font-weight:900;color:#d4a843">R$ ${money(g.totals.atingido_vgv)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function money(n) { return n == null || isNaN(n) ? '0' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
