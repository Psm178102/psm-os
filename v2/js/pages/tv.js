/* PSM-OS v2 — Modo TV expandido (Sprint 7.25) */
import { api } from '../api.js';
import { sounds } from '../sounds.js';

let _root = null, _arena = [], _ranking = [], _funnels = [], _atin = null, _users = [];
let _mode = 'arena', _pollTimer = null, _lastSaleId = null;

const MODES = [
  { id: 'arena',    lbl: '📡 Arena Live'   },
  { id: 'ranking',  lbl: '🏆 Ranking'      },
  { id: 'metas',    lbl: '🎯 Metas vs Real'},
  { id: 'funil',    lbl: '🔗 Funil RD'     },
  { id: 'equipes',  lbl: '🛡 Equipes'      },
];

export async function pageTV(ctx, root) {
  _root = root;
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
    const [arena, atin, funnels, usr] = await Promise.all([
      api.request('/api/v3/arena/live').catch(() => ({ events: [] })),
      api.request('/api/v3/metas/atingimento?ano=' + new Date().getFullYear()).catch(() => null),
      api.request('/api/v3/crm/funnels').catch(() => ({ funnels: [] })),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _arena = arena.events || [];
    _atin = atin;
    if (atin) {
      // Exclui sócios/diretores/gerentes do ranking público (TV)
      const ehCompetidor = g => {
        const r = (g.user?.role || '').toLowerCase();
        return !['socio', 'diretor', 'gerente'].includes(r) && !g.user?.hide_from_ranking;
      };
      _ranking = (atin.grid || []).filter(g => g.totals?.atingido_vgv > 0 && ehCompetidor(g))
        .sort((a, b) => b.totals.atingido_vgv - a.totals.atingido_vgv).slice(0, 10);
    }
    _funnels = funnels.funnels || [];
    if (usr.users) _users = usr.users;

    // Detecta venda nova → toca som
    const lastSale = _arena.find(e => e.type === 'venda');
    if (lastSale && _lastSaleId && lastSale.ts > _lastSaleId) {
      try { window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' })); } catch {}
    }
    if (lastSale) _lastSaleId = lastSale.ts;

    render();
  } catch (e) {
    if (_root) _root.innerHTML = `<div style="padding:40px;color:#fff">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function startPoll() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(reload, 20000);
}

function render() {
  _root.innerHTML = `
    <style>
      body.tv-mode .app-sidebar, body.tv-mode .app-header { display: none !important; }
      body.tv-mode .app-shell { grid-template-columns: 1fr; grid-template-rows: 1fr; grid-template-areas: "main"; }
      body.tv-mode .app-main { padding: 0; background: radial-gradient(circle at 20% 20%, rgba(212,168,67,0.15), transparent 50%), radial-gradient(circle at 80% 80%, rgba(220,38,38,0.1), transparent 50%), linear-gradient(135deg, #0f172a, #1e293b); color: #fff; min-height: 100vh; }
      @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
      @keyframes slideIn { from { transform: translateX(-30px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      .tv-event { animation: slideIn 0.4s ease-out }
    </style>
    <div style="padding:32px;font-family:system-ui">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:24px">
        <h1 style="font-size:48px;font-weight:900;letter-spacing:2px;margin:0;background:linear-gradient(90deg,#d4a843,#fff,#d4a843);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-size:200% 100%">PSM ARENA LIVE</h1>
        <div style="text-align:right;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${MODES.map(m => `<button data-tv="${m.id}" style="padding:8px 14px;background:${_mode===m.id?'#d4a843':'transparent'};color:${_mode===m.id?'#0f172a':'#fff'};border:1px solid #d4a843;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px">${m.lbl}</button>`).join('')}
          <a href="#/" style="color:#fff;background:transparent;border:1px solid #dc2626;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">✕ Sair</a>
        </div>
      </div>

      ${({
        arena:   arenaView,
        ranking: rankingView,
        metas:   metasView,
        funil:   funilView,
        equipes: equipesView,
      })[_mode]()}

      <div style="position:fixed;bottom:16px;right:24px;font-size:13px;opacity:0.6">
        ${new Date().toLocaleString('pt-BR')} · refresh 20s · 🔊 sons ${sounds.isEnabled() ? 'on' : 'off'}
      </div>
    </div>
  `;
  document.querySelectorAll('[data-tv]').forEach(b => b.addEventListener('click', () => { _mode = b.dataset.tv; render(); }));
}

function arenaView() {
  if (_arena.length === 0) return '<div style="font-size:28px;opacity:0.7;text-align:center;padding:80px">Aguardando atividade…</div>';
  return `
    <div style="display:grid;gap:14px;max-height:calc(100vh - 140px);overflow:hidden">
      ${_arena.slice(0, 12).map(e => `
        <div class="tv-event" style="display:grid;grid-template-columns:60px 1fr auto;gap:18px;padding:18px 24px;background:rgba(255,255,255,0.08);border-left:6px solid ${e.color};border-radius:12px;align-items:center;font-size:22px;backdrop-filter:blur(8px)">
          <div style="font-size:42px;text-align:center">${e.ico}</div>
          <div>
            <div style="font-weight:800;font-size:26px">${escapeHtml(e.title)}</div>
            ${e.subtitle ? `<div style="font-size:17px;opacity:0.8;margin-top:4px">${escapeHtml(e.subtitle)}</div>` : ''}
            ${e.actor ? `<div style="font-size:14px;color:#d4a843;margin-top:4px;font-weight:600">👤 ${escapeHtml(e.actor.name)}</div>` : ''}
          </div>
          <div style="font-size:14px;opacity:0.6">${e.ts ? new Date(e.ts).toLocaleString('pt-BR') : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function rankingView() {
  if (_ranking.length === 0) return '<div style="font-size:28px;opacity:0.7;text-align:center;padding:80px">Sem vendas no ano ainda.</div>';
  return `
    <div style="display:grid;gap:10px">
      ${_ranking.map((g, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const ini = escapeHtml((g.user.ini || (g.user.name || '?').substring(0, 2)).toUpperCase());
        return `
          <div class="tv-event" style="display:grid;grid-template-columns:80px 60px 1fr auto;gap:18px;padding:18px 24px;background:rgba(255,255,255,${i<3?'0.14':'0.08'});border-radius:12px;align-items:center;font-size:22px;${i<3?'border:2px solid #d4a843':''}">
            <div style="font-size:42px;text-align:center;font-weight:800">${medal}</div>
            <div style="width:56px;height:56px;border-radius:8px;background:${g.user.color || '#d4a843'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px">${ini}</div>
            <div>
              <div style="font-weight:800;font-size:26px">${escapeHtml(g.user.name)}</div>
              <div style="font-size:14px;opacity:0.7">${g.totals.vendas_count} vendas · ${escapeHtml(g.user.team || 'geral')}</div>
            </div>
            <div style="font-size:32px;font-weight:900;color:#d4a843">R$ ${money(g.totals.atingido_vgv)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function metasView() {
  const t = _atin?.totals || {};
  const pct = t.meta_vgv > 0 ? (t.atingido_vgv / t.meta_vgv * 100) : null;
  const pctColor = pct == null ? '#fff' : pct < 50 ? '#dc2626' : pct < 90 ? '#d97706' : '#16a34a';
  return `
    <div style="display:grid;gap:24px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
        <div style="background:rgba(37,99,235,0.2);border:2px solid #2563eb;border-radius:14px;padding:24px;text-align:center">
          <div style="font-size:18px;opacity:0.7;letter-spacing:2px">META ANUAL</div>
          <div style="font-size:48px;font-weight:900;margin-top:8px">R$ ${money(t.meta_vgv)}</div>
        </div>
        <div style="background:rgba(124,58,237,0.2);border:2px solid #7c3aed;border-radius:14px;padding:24px;text-align:center">
          <div style="font-size:18px;opacity:0.7;letter-spacing:2px">ATINGIDO</div>
          <div style="font-size:48px;font-weight:900;margin-top:8px;color:#a78bfa">R$ ${money(t.atingido_vgv)}</div>
          <div style="opacity:0.7;margin-top:4px">${t.vendas_count || 0} vendas</div>
        </div>
        <div style="background:rgba(${pct>=90?22:pct>=50?217:220},${pct>=90?163:pct>=50?119:38},${pct>=90?74:pct>=50?6:38},0.2);border:2px solid ${pctColor};border-radius:14px;padding:24px;text-align:center">
          <div style="font-size:18px;opacity:0.7;letter-spacing:2px">% ATINGIMENTO</div>
          <div style="font-size:72px;font-weight:900;margin-top:8px;color:${pctColor}">${pct == null ? '—' : pct.toFixed(1) + '%'}</div>
        </div>
      </div>
      <div style="text-align:center;font-size:22px;opacity:0.8">
        ${pct >= 90 ? '🎉 Meta sendo batida' : pct >= 50 ? '⚠ Atenção: ' + (100 - (pct||0)).toFixed(0) + '% pra meta' : '🔴 Atrás da meta'}
      </div>
    </div>
  `;
}

function funilView() {
  if (_funnels.length === 0) return '<div style="font-size:28px;opacity:0.7;text-align:center;padding:80px">Sem funis configurados.</div>';
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(380px, 1fr));gap:14px">
      ${_funnels.slice(0, 6).map(f => `
        <div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:20px">
          <h3 style="font-size:24px;font-weight:800;margin:0 0 12px">${escapeHtml(f.name)}</h3>
          <div style="display:grid;gap:6px">
            ${(f.stages || []).slice(0, 8).map(s => `
              <div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.2);border-radius:6px;font-size:15px">
                <span>${s.is_won?'🏆 ':''}${s.is_lost?'❌ ':''}${escapeHtml(s.name)}</span>
                <span class="muted" style="opacity:0.6">${s.position ?? ''}</span>
              </div>
            `).join('')}
            ${f.stages.length > 8 ? `<div style="text-align:center;opacity:0.5;font-size:13px">+${f.stages.length - 8} stages</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function equipesView() {
  if (!_atin?.grid) return '<div style="font-size:28px;opacity:0.7;text-align:center;padding:80px">Sem dados de equipes.</div>';
  // Agrupa por team
  const byTeam = {};
  _atin.grid.forEach(g => {
    const t = (g.user.team || 'geral').toLowerCase();
    if (!byTeam[t]) byTeam[t] = { team: t, meta: 0, atingido: 0, count: 0 };
    byTeam[t].meta += g.totals?.meta_vgv || 0;
    byTeam[t].atingido += g.totals?.atingido_vgv || 0;
    byTeam[t].count += 1;
  });
  const arr = Object.values(byTeam).sort((a, b) => b.atingido - a.atingido);
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(380px, 1fr));gap:14px">
      ${arr.map(t => {
        const pct = t.meta > 0 ? (t.atingido / t.meta * 100) : null;
        const color = pct == null ? '#64748b' : pct < 50 ? '#dc2626' : pct < 90 ? '#d97706' : '#16a34a';
        return `
          <div style="background:rgba(255,255,255,0.08);border-left:6px solid ${color};border-radius:12px;padding:20px">
            <div style="font-size:28px;font-weight:800;text-transform:uppercase;letter-spacing:2px">${escapeHtml(t.team)}</div>
            <div style="font-size:14px;opacity:0.6;margin-bottom:14px">${t.count} corretores</div>
            <div style="font-size:32px;font-weight:900;color:${color}">R$ ${money(t.atingido)}</div>
            <div style="opacity:0.7;margin-top:2px">de R$ ${money(t.meta)} (${pct == null ? '—' : pct.toFixed(0) + '%'})</div>
            ${t.meta > 0 ? `<div style="background:rgba(0,0,0,0.3);height:10px;border-radius:5px;margin-top:12px;overflow:hidden"><div style="background:${color};height:100%;width:${Math.min(100, pct || 0)}%"></div></div>` : ''}
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
