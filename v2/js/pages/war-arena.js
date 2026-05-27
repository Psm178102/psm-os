/* PSM-OS v2 — War Arena (modo combate full-screen) (Sprint 8.5)
   Variante visual da Arena Live focada em batalha entre equipes — exibição em TV / projetor */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _interval = null;
let _data = null;

export async function pageWarArena(ctx, root) {
  _root = root;
  render();
  await load();
  // Auto-refresh 20s
  if (_interval) clearInterval(_interval);
  _interval = setInterval(load, 20000);
}

async function load() {
  try {
    const [atg, deals, users] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/crm/deals?limit=50').catch(() => ({ deals: [] })),
      api.listUsers().catch(() => ({ users: [] })),
    ]);
    _data = { atingimento: atg, deals: deals.deals || [], users: users.users || [] };
    renderContent();
  } catch (e) {
    document.getElementById('wa-body').innerHTML = `<div style="color:#ef4444;text-align:center;padding:30px">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div style="background:linear-gradient(135deg,#1a0b2e 0%,#0a0f1c 50%,#1f0a1f 100%);min-height:calc(100vh - 130px);border-radius:14px;padding:24px;color:#fff;position:relative;overflow:hidden">
      <!-- Glow background -->
      <div style="position:absolute;inset:0;background:radial-gradient(circle at 20% 20%, rgba(239,68,68,.15), transparent 50%), radial-gradient(circle at 80% 80%, rgba(251,191,36,.12), transparent 50%);pointer-events:none"></div>

      <div style="position:relative;z-index:1">
        <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:20px">
          <div class="flex" style="align-items:center;gap:14px">
            <span style="font-size:44px;filter:drop-shadow(0 0 12px rgba(251,191,36,.6))">⚔️</span>
            <div>
              <h1 style="margin:0;font-size:32px;font-weight:900;background:linear-gradient(135deg,#fbbf24,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:1px">WAR ARENA</h1>
              <div style="color:#cbd5e1;font-size:12px;margin-top:2px">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} · poll 20s</div>
            </div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="document.documentElement.requestFullscreen()" style="color:#fff;border-color:#fff3">⛶ Tela cheia</button>
            <button class="btn btn-ghost btn-sm" id="wa-back" style="color:#fff;border-color:#fff3">← Sair</button>
          </div>
        </div>

        <div id="wa-body"><div style="text-align:center;padding:60px;color:#94a3b8"><span class="spinner"></span> Posicionando tropas…</div></div>
      </div>
    </div>
  `;
  document.getElementById('wa-back').addEventListener('click', () => {
    if (_interval) { clearInterval(_interval); _interval = null; }
    location.hash = '/arena';
  });
}

function renderContent() {
  const eqs = aggregateByEquipe(_data);
  const events = buildEvents(_data);
  const body = document.getElementById('wa-body');

  body.innerHTML = `
    <!-- Ticker de eventos -->
    <div style="background:rgba(15,23,42,.6);border:1px solid #ef444440;border-radius:10px;padding:12px 16px;margin-bottom:18px;overflow:hidden">
      <div style="display:flex;gap:32px;animation:warMarquee 60s linear infinite;white-space:nowrap;color:#fbbf24;font-weight:700">
        ${events.length === 0 ? '<span>📡 Aguardando movimento das tropas…</span>' : events.map(e => `<span>${esc(e)}</span>`).join('')}
      </div>
    </div>

    <!-- Confronto entre equipes -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px">
      ${eqs.map(e => warCard(e)).join('')}
    </div>

    <style>
      @keyframes warMarquee {
        from { transform: translateX(100%); }
        to { transform: translateX(-100%); }
      }
      @keyframes warPulse {
        0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
        50% { box-shadow: 0 0 20px 4px currentColor; opacity: .9; }
      }
    </style>
  `;
}

function aggregateByEquipe(data) {
  const cores = { MAP: '#6366f1', Conquista: '#f59e0b', Terceiros: '#a855f7', Lancamentos: '#10b981', Locacao: '#06b6d4' };
  const eqs = {};
  const corretorAtg = (data.atingimento.por_corretor || []).reduce((m, x) => { m[x.id] = x; return m; }, {});

  (data.users || []).filter(u => (u.role === 'corretor' || u.role === 'lider') && u.status !== 'inativo').forEach(u => {
    const fr = u.team || u.frente || 'Sem Equipe';
    if (!eqs[fr]) eqs[fr] = { nome: fr, color: cores[fr] || '#64748b', vendas: 0, vgv: 0, meta: 0, corretores: [] };
    const a = corretorAtg[u.id] || {};
    eqs[fr].vendas += +a.vendas || 0;
    eqs[fr].vgv += +a.vgv_atingido || 0;
    eqs[fr].meta += +a.meta_vgv || 0;
    eqs[fr].corretores.push({ nome: u.name, vgv: +a.vgv_atingido || 0, vendas: +a.vendas || 0 });
  });
  return Object.values(eqs).sort((a, b) => b.vgv - a.vgv);
}

function buildEvents(data) {
  const ev = [];
  (data.deals || []).filter(d => d.win).slice(0, 10).forEach(d => {
    ev.push(`🏆 ${d.user_email || d.user_name || '?'} fechou R$ ${(+d.amount || 0).toLocaleString('pt-BR')}`);
  });
  return ev;
}

function warCard(e) {
  const pct = e.meta > 0 ? (e.vgv / e.meta * 100) : 0;
  const onFire = pct >= 100;
  const top = [...e.corretores].sort((a, b) => b.vgv - a.vgv).slice(0, 5);
  return `
    <div style="background:linear-gradient(180deg,rgba(15,23,42,.95),rgba(15,23,42,.7));border:2px solid ${e.color};border-radius:14px;padding:18px;${onFire ? `color:${e.color};animation:warPulse 2s ease-in-out infinite` : ''}">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:20px;font-weight:900;color:${e.color}">⚔️ ${esc(e.nome).toUpperCase()}</div>
          <div style="font-size:11px;color:#94a3b8">${e.corretores.length} guerreiros</div>
        </div>
        ${onFire ? '<span style="font-size:32px">🔥</span>' : ''}
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="background:#0a0f1c;padding:10px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:900;color:${e.color}">${e.vendas}</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase">Vendas</div>
        </div>
        <div style="background:#0a0f1c;padding:10px;border-radius:6px;text-align:center">
          <div style="font-size:18px;font-weight:900;color:#fbbf24">${fmtKM(e.vgv)}</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase">VGV</div>
        </div>
        <div style="background:#0a0f1c;padding:10px;border-radius:6px;text-align:center">
          <div style="font-size:24px;font-weight:900;color:${onFire ? '#22c55e' : pct >= 60 ? '#fbbf24' : '#ef4444'}">${pct.toFixed(0)}%</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase">Meta</div>
        </div>
      </div>

      <div style="background:#0a0f1c;height:8px;border-radius:4px;overflow:hidden;margin-bottom:14px">
        <div style="background:linear-gradient(90deg, ${e.color}, ${onFire ? '#22c55e' : e.color});height:100%;width:${Math.min(100, pct).toFixed(0)}%;transition:width .4s"></div>
      </div>

      <div style="font-size:10px;color:#94a3b8;font-weight:700;margin-bottom:6px;text-transform:uppercase">⚔️ TROPA EM CAMPO</div>
      ${top.map((c, i) => `
        <div class="flex" style="justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e293b;font-size:12px">
          <span>${['🥇','🥈','🥉','🎖','🎖'][i]} ${esc(c.nome)}</span>
          <span style="color:${e.color};font-weight:700">${c.vendas}v · ${fmtKM(c.vgv)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function fmtKM(n) {
  if (n >= 1_000_000) return 'R$ ' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return 'R$ ' + (n / 1000).toFixed(0) + 'k';
  return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
