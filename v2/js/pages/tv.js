/* PSM-OS v2 — Modo TV expandido (Sprint 7.25) */
import { api } from '../api.js';
import { sounds } from '../sounds.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

let _root = null, _arena = [], _ranking = [], _funnels = [], _atin = null, _users = [];
let _mode = 'arena', _pollTimer = null, _lastSaleId = null;
let _meta = null;  // Tráfego (Meta Ads) — só carrega no modo 'trafego'

const MODES = [
  { id: 'arena',    lbl: '📡 Arena Live'   },
  { id: 'ranking',  lbl: '🏆 Ranking'      },
  { id: 'metas',    lbl: '🎯 Metas vs Real'},
  { id: 'funil',    lbl: '🔗 Funil RD'     },
  { id: 'equipes',  lbl: '🛡 Equipes'      },
  { id: 'trafego',  lbl: '📊 Tráfego'      },
];

export async function pageTV(ctx, root) {
  _root = root;
  document.body.classList.add('tv-mode');
  document.documentElement.requestFullscreen?.().catch(() => {});
  enableWakeLock(updateWakeBadge);   // 🔆 impede a TV de entrar em repouso
  await reload();
  startPoll();
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  document.body.classList.remove('tv-mode');
  if (_pollTimer) clearInterval(_pollTimer);
  disableWakeLock();
  document.getElementById('tv-wake')?.remove();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

// selo fixo (fora do _root, sobrevive aos re-renders) mostrando se a tela está travada acesa
function updateWakeBadge(s) {
  let el = document.getElementById('tv-wake');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tv-wake';
    el.style.cssText = 'position:fixed;right:10px;bottom:8px;z-index:99999;font:600 12px system-ui,sans-serif;padding:4px 11px;border-radius:999px;pointer-events:none;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);transition:opacity .4s';
    document.body.appendChild(el);
  }
  if (s.on && s.method === 'wakelock') {
    el.style.background = '#16a34a'; el.textContent = '🔆 Tela travada acesa';
    setTimeout(() => { if (el) el.style.opacity = '0.35'; }, 6000);
  } else if (s.on && s.method === 'video') {
    el.style.background = '#0891b2'; el.textContent = '🔆 Tela acesa (modo vídeo)';
    setTimeout(() => { if (el) el.style.opacity = '0.35'; }, 6000);
  } else {
    el.style.opacity = '1'; el.style.background = '#d97706';
    el.textContent = '⚠️ A TV pode dormir — desligue o descanso/economia de tela nas Configurações da TV';
  }
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

    // Tráfego (Meta Ads): só busca quando o painel está nesse modo. Lê do cache
    // compartilhado (rápido); requer Líder (lvl>=5) — se o login da TV não tiver,
    // o view mostra aviso gracioso.
    if (_mode === 'trafego') {
      try { _meta = await api.request('/api/v3/marketing/summary?date_preset=today'); }
      catch (e) { _meta = { _err: e.message }; }
    }

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
        trafego: trafegoView,
      })[_mode]()}

      <div style="position:fixed;bottom:16px;right:24px;font-size:13px;opacity:0.6">
        ${new Date().toLocaleString('pt-BR')} · refresh 20s · 🔊 sons ${sounds.isEnabled() ? 'on' : 'off'}
      </div>
    </div>
  `;
  document.querySelectorAll('[data-tv]').forEach(b => b.addEventListener('click', () => {
    _mode = b.dataset.tv;
    // Tráfego precisa buscar o Meta (e mostra "carregando" até chegar)
    if (_mode === 'trafego' && !_meta) { reload(); } else { render(); }
  }));
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
          <div style="font-size:72px;font-weight:900;margin-top:8px;color:${pctColor}">${pct2(pct)}</div>
        </div>
      </div>
      <div style="text-align:center;font-size:22px;opacity:0.8">
        ${pct >= 90 ? '🎉 Meta sendo batida' : pct >= 50 ? '⚠ Atenção: ' + pct2(100 - (pct||0)) + ' pra meta' : '🔴 Atrás da meta'}
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
            <div style="opacity:0.7;margin-top:2px">de R$ ${money(t.meta)} (${pct2(pct)})</div>
            ${t.meta > 0 ? `<div style="background:rgba(0,0,0,0.3);height:10px;border-radius:5px;margin-top:12px;overflow:hidden"><div style="background:${color};height:100%;width:${Math.min(100, pct || 0)}%"></div></div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function trafegoView() {
  const m = _meta;
  if (!m) return '<div style="font-size:28px;opacity:0.7;text-align:center;padding:80px">Carregando tráfego…</div>';
  if (m._err) {
    return `<div style="font-size:26px;opacity:0.85;text-align:center;padding:80px">📊 Tráfego indisponível
      <div style="font-size:16px;opacity:0.6;margin-top:10px">${escapeHtml(m._err)} — a TV precisa estar logada como Líder+ (nível ≥ 5)</div></div>`;
  }
  const accounts = m.accounts || [];
  let spend = 0, results = 0, impressions = 0, clicks = 0;
  accounts.forEach(a => { spend += a.spend || 0; results += a.results || 0; impressions += a.impressions || 0; clicks += a.clicks || 0; });
  const cpl = results > 0 ? spend / results : 0;
  const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
  const camps = m.campaigns || [];
  const sangria = camps.filter(c => (c.results || 0) === 0 && (c.spend || 0) >= 30)
    .sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const verbaRisco = sangria.reduce((s, c) => s + (c.spend || 0), 0);
  const acctColor = a => ((a.results || 0) === 0 && (a.spend || 0) >= 30) ? '#dc2626'
    : (a.results > 0 && (a.spend / a.results) <= 80) ? '#16a34a' : '#d4a843';
  const money2 = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px">
      <div style="background:rgba(220,38,38,0.18);border:2px solid #dc2626;border-radius:14px;padding:24px;text-align:center">
        <div style="font-size:17px;opacity:0.7;letter-spacing:2px">INVESTIDO HOJE</div>
        <div style="font-size:44px;font-weight:900;margin-top:6px">R$ ${money(spend)}</div>
      </div>
      <div style="background:rgba(37,99,235,0.18);border:2px solid #2563eb;border-radius:14px;padding:24px;text-align:center">
        <div style="font-size:17px;opacity:0.7;letter-spacing:2px">LEADS</div>
        <div style="font-size:44px;font-weight:900;margin-top:6px;color:#93c5fd">${fmtInt(results)}</div>
      </div>
      <div style="background:rgba(124,58,237,0.18);border:2px solid #7c3aed;border-radius:14px;padding:24px;text-align:center">
        <div style="font-size:17px;opacity:0.7;letter-spacing:2px">CPL</div>
        <div style="font-size:44px;font-weight:900;margin-top:6px;color:#c4b5fd">${cpl ? 'R$ ' + money2(cpl) : '—'}</div>
      </div>
      <div style="background:rgba(${sangria.length ? '220,38,38' : '22,163,74'},0.18);border:2px solid ${sangria.length ? '#dc2626' : '#16a34a'};border-radius:14px;padding:24px;text-align:center">
        <div style="font-size:17px;opacity:0.7;letter-spacing:2px">🔥 SANGRIA</div>
        <div style="font-size:44px;font-weight:900;margin-top:6px;color:${sangria.length ? '#fca5a5' : '#86efac'}">${sangria.length}</div>
        <div style="opacity:0.7;font-size:14px">${sangria.length ? 'R$ ' + money(verbaRisco) + ' em risco' : 'tudo no alvo'}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;margin-top:24px">
      ${accounts.length === 0 ? '<div style="font-size:22px;opacity:0.6">Sem contas Meta no período.</div>' :
        accounts.map(a => {
          const acpl = (a.results > 0) ? a.spend / a.results : 0;
          return `<div style="background:rgba(255,255,255,0.08);border-left:6px solid ${acctColor(a)};border-radius:12px;padding:20px">
            <div style="font-size:24px;font-weight:800">${escapeHtml(a.label || a.account || a.accountId || 'Conta')}</div>
            <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:18px">
              <span style="opacity:0.7">Investido</span><span style="font-weight:800;color:#fca5a5">R$ ${money(a.spend || 0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:18px">
              <span style="opacity:0.7">Leads</span><span style="font-weight:800;color:#93c5fd">${fmtInt(a.results || 0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:18px">
              <span style="opacity:0.7">CPL</span><span style="font-weight:900;color:${acctColor(a)}">${acpl ? 'R$ ' + money2(acpl) : '—'}</span>
            </div>
            ${a._error ? `<div style="font-size:13px;color:#fca5a5;margin-top:8px">⚠ ${escapeHtml(a._error)}</div>` : ''}
          </div>`;
        }).join('')}
    </div>

    ${sangria.length ? `<div style="margin-top:22px">
      <div style="font-size:20px;font-weight:800;color:#fca5a5;margin-bottom:10px">🔥 Campanhas sangrando (gasto sem lead)</div>
      <div style="display:grid;gap:8px">
        ${sangria.slice(0, 6).map(c => `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(220,38,38,0.12);border-radius:10px;padding:12px 18px;font-size:18px">
          <span style="font-weight:700">${escapeHtml(c.name || c.campaign_name || 'Campanha')}</span>
          <span style="font-weight:900;color:#fca5a5">R$ ${money(c.spend || 0)} · 0 lead</span>
        </div>`).join('')}
      </div>
    </div>` : ''}
  `;
}

function fmtInt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function money(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
