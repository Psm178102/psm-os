/* ============================================================================
   PSM-OS v2 — 🏆 RANKING HUB · MODO TV (v86.97)
   Réplica do Modo TV do Ranking do PSM HUB (psmhub.com.br/tv), com os dados
   vindos DO PRÓPRIO HUB via ponte /api/v3/psmhub/ranking (login de serviço).
   Pódio 1º/2º/3º + fila 4º+, badges por regra (Prosp/Agend/Aten/Doc/Venda/Perdas),
   filtro por equipe, relógio, tela cheia e atualização automática a cada 30s.
============================================================================ */
import { api } from '../api.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const REFRESH_MS = 30000;

let _root = null, _data = null, _err = '', _pending = false;
let _team = 'GERAL';
let _pollTimer = null, _clock = null;
let _fetchedAt = null;

export async function pageRankingHub(ctx, root) {
  _root = root; _err = ''; _data = null; _team = 'GERAL';
  document.body.classList.add('tv-mode');
  document.documentElement.requestFullscreen?.().catch(() => {});
  enableWakeLock(() => {});
  _root.innerHTML = shell('<div style="font-size:26px;opacity:.7;text-align:center;padding:120px">🏆 Carregando o Ranking do PSM HUB…</div>');
  await reload();
  startTimers();
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  document.body.classList.remove('tv-mode');
  [_pollTimer, _clock].forEach(t => t && clearInterval(t));
  _pollTimer = _clock = null;
  disableWakeLock();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function startTimers() {
  [_pollTimer, _clock].forEach(t => t && clearInterval(t));
  _pollTimer = setInterval(reload, REFRESH_MS);
  _clock = setInterval(() => { const el = document.getElementById('rh-clock'); if (el) el.textContent = nowStr(); }, 1000);
}

async function reload() {
  try {
    const r = await api.request('/api/v3/psmhub/ranking');
    if (r.ok) { _data = r.data; _fetchedAt = new Date(); _err = ''; }
    else { _err = r.error || 'PSM HUB indisponível'; if (r.pending_config) _pending = true; }
  } catch (e) { _err = e.message || 'erro'; }
  render();
}

/* ── classificação de regra → badge (mesma legenda do Modo TV do HUB) ── */
const BADGES = {
  prosp: { ab: 'Prosp.', lbl: 'Prospecção',      bg: '#3b3b8f', fg: '#c7c9ff' },
  agend: { ab: 'Agend.', lbl: 'Visita Agendada', bg: '#1e3a8a', fg: '#bfdbfe' },
  aten:  { ab: 'Aten.',  lbl: 'Visita Realizada',bg: '#134e4a', fg: '#99f6e4' },
  doc:   { ab: 'Doc.',   lbl: 'Proposta',        bg: '#4c1d95', fg: '#ddd6fe' },
  venda: { ab: 'Venda',  lbl: 'Venda',           bg: '#14532d', fg: '#bbf7d0' },
  perdas:{ ab: 'Perdas', lbl: 'Penalidades',     bg: '#7f1d1d', fg: '#fecaca' },
};
function classifyRule(rb) {
  const t = `${rb.label || ''} ${rb.stageName || ''}`.toLowerCase();
  if (rb.type === 'penalidade' || t.includes('penal') || t.includes('perda')) return 'perdas';
  if (t.includes('venda')) return 'venda';
  if (t.includes('aprova') || t.includes('proposta') || t.includes('document') || t.includes('pasta')) return 'doc';
  if (t.includes('atend') || t.includes('visita realizada')) return 'aten';
  if (t.includes('agend')) return 'agend';
  return 'prosp';
}
function badgesOf(agent) {
  const acc = {};
  (agent.ruleBreakdown || []).forEach(rb => {
    const k = classifyRule(rb);
    acc[k] = (acc[k] || 0) + (rb.totalPoints || 0);
  });
  return ['prosp', 'agend', 'aten', 'doc', 'venda', 'perdas'].filter(k => acc[k]).map(k => {
    const b = BADGES[k];
    return `<span style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:600;background:${b.bg};color:${b.fg}">${b.ab} <b>${fmtPts(acc[k])}</b></span>`;
  }).join(' ');
}

/* ── filtro por equipe ── */
function teams() {
  const set = new Set((_data?.ranking || []).map(a => (a.teamName || '').trim()).filter(Boolean));
  return [...set];
}
function shortTeam(t) { return t.replace(/^EQUIPE\s+/i, '').toUpperCase(); }
function ranked() {
  let list = _data?.ranking || [];
  if (_team !== 'GERAL') list = list.filter(a => (a.teamName || '').trim() === _team);
  list = [...list].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  return list.map((a, i) => ({ ...a, pos: i + 1 }));
}

/* ── render ── */
function render() {
  if (!_root) return;
  if (!_data) {
    _root.innerHTML = shell(`<div style="text-align:center;padding:120px">
      <div style="font-size:26px;margin-bottom:12px">${_pending ? '🔌 Ponte com o PSM HUB não configurada' : '⚠️ Sem dados do PSM HUB'}</div>
      <div style="opacity:.6;font-size:16px">${escapeHtml(_err || '')}</div></div>`);
    bind(); return;
  }
  const list = ranked();
  const podium = list.slice(0, 3);
  const rest = list.slice(3);
  const ord = [podium[1], podium[0], podium[2]].filter(Boolean);   // 2º · 1º · 3º

  _root.innerHTML = shell(`
    <div style="display:grid;grid-template-columns:repeat(${Math.max(ord.length, 1)},1fr);gap:18px;padding:22px 26px 6px">
      ${ord.map(a => podiumCard(a)).join('') || '<div style="opacity:.6;text-align:center;padding:60px">Ninguém pontuou ainda.</div>'}
    </div>
    <div style="padding:14px 26px;display:grid;gap:10px">
      ${rest.map(rowCard).join('')}
    </div>
  `);
  bind();
}

function podiumCard(a) {
  const first = a.pos === 1;
  const style = a.pos === 1
    ? 'border:2px solid #eab308;background:radial-gradient(120% 120% at 50% 0%,rgba(234,179,8,.14),rgba(10,13,22,.6));box-shadow:0 0 40px rgba(234,179,8,.25)'
    : a.pos === 2
      ? 'border:1px solid #475569;background:rgba(30,41,59,.45)'
      : 'border:1px solid #b45309;background:rgba(69,26,3,.35)';
  const posColor = a.pos === 1 ? '#facc15' : a.pos === 3 ? '#fb923c' : '#e2e8f0';
  return `
    <div style="border-radius:16px;padding:${first ? '26px' : '22px'} 18px;text-align:center;${style}">
      <div style="font-size:${first ? '30px' : '24px'};font-weight:800;color:${posColor}">${a.pos}°</div>
      <div style="font-size:${first ? '28px' : '22px'};font-weight:700;color:#f1f5f9;margin-top:2px">${escapeHtml(a.agentName || '—')}</div>
      <div style="font-size:${first ? '84px' : '58px'};font-weight:900;line-height:1.1;color:${posColor}">${fmtPts(a.totalPoints)}</div>
      <div style="font-size:12px;letter-spacing:.1em;color:${posColor};opacity:.8">pontos</div>
      ${a.vgvReal ? `<div style="margin-top:6px;color:#86efac;font-weight:700">VGV ${fmtBRL(a.vgvReal)}</div>` : ''}
      <div style="height:1px;background:rgba(148,163,184,.25);margin:14px 40px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:26px">${badgesOf(a)}</div>
    </div>`;
}

function rowCard(a) {
  return `
    <div style="display:flex;align-items:center;gap:16px;background:rgba(30,41,59,.35);border:1px solid rgba(71,85,105,.4);border-radius:12px;padding:14px 20px">
      <div style="font-size:20px;font-weight:800;color:#94a3b8;width:44px">${a.pos}°</div>
      <div style="font-size:20px;font-weight:700;color:#f1f5f9">${escapeHtml(a.agentName || '—')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${badgesOf(a)}</div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:26px;font-weight:900;color:#f1f5f9;line-height:1">${fmtPts(a.totalPoints)}</div>
        <div style="font-size:11px;color:#64748b">pts${a.vgvReal ? ` · VGV ${fmtBRL(a.vgvReal)}` : ''}</div>
      </div>
    </div>`;
}

function shell(body) {
  const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const titulo = _data ? `Ranking — ${meses[_data.month] || ''} ${_data.year}` : 'Ranking — PSM HUB';
  const tabs = ['GERAL', ...teams()];
  return `
  <style>
    body.tv-mode .app-sidebar, body.tv-mode .app-header { display:none !important; }
    body.tv-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
    body.tv-mode .app-main { padding:0; }
  </style>
  <div style="position:fixed;inset:0;z-index:50;background:#0a0d16;color:#e2e8f0;display:flex;flex-direction:column;overflow:auto;font-family:inherit">
    <div style="display:flex;align-items:center;gap:18px;padding:14px 26px;background:#0d1120;border-bottom:1px solid rgba(71,85,105,.3);position:sticky;top:0;z-index:2">
      <div style="font-weight:800;font-size:18px;color:#f8fafc">🏆 PSM HUB</div>
      <div style="color:#475569">|</div>
      <div style="font-weight:600;font-size:16px;color:#cbd5e1">${titulo}</div>
      <div style="display:flex;gap:4px;background:rgba(30,41,59,.6);border-radius:10px;padding:4px;margin-left:14px">
        ${tabs.map(t => {
          const key = t === 'GERAL' ? 'GERAL' : t;
          const on = _team === key;
          return `<button data-team="${escapeHtml(key)}" style="border:0;cursor:pointer;padding:6px 14px;border-radius:8px;font-weight:700;font-size:12px;letter-spacing:.05em;background:${on ? '#eab308' : 'transparent'};color:${on ? '#1c1917' : '#94a3b8'}">${escapeHtml(t === 'GERAL' ? 'GERAL' : shortTeam(t))}</button>`;
        }).join('')}
      </div>
      <div style="margin-left:auto;text-align:right">
        <div id="rh-clock" style="font-size:30px;font-weight:800;color:#facc15;font-variant-numeric:tabular-nums">${nowStr()}</div>
        <div style="font-size:11px;color:#64748b">${_fetchedAt ? `Atualizado às ${_fetchedAt.toLocaleTimeString('pt-BR')}` : '&nbsp;'}</div>
      </div>
      <button id="rh-fs" title="Tela cheia" style="border:1px solid rgba(148,163,184,.35);background:transparent;color:#cbd5e1;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:16px">⛶</button>
    </div>
    <div style="flex:1">${body}</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 26px;background:#0d1120;border-top:1px solid rgba(71,85,105,.3)">
      ${Object.values(BADGES).map(b => `<span style="padding:3px 10px;border-radius:99px;font-size:11px;background:${b.bg};color:${b.fg}">${b.ab} <b>${b.lbl}</b></span>`).join('')}
      <span style="font-size:11px;color:#475569">💲 VGV Real</span>
      <span style="margin-left:auto;font-size:11px;color:#475569">Dados do PSM HUB · atualização automática a cada 30 segundos</span>
    </div>
  </div>`;
}

function bind() {
  _root.querySelectorAll('[data-team]').forEach(b => b.addEventListener('click', () => { _team = b.dataset.team; render(); }));
  document.getElementById('rh-fs')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

/* ── utils ── */
function nowStr() { return new Date().toLocaleTimeString('pt-BR'); }
function fmtPts(n) { return (n || 0).toLocaleString('pt-BR'); }
function fmtBRL(n) { return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
