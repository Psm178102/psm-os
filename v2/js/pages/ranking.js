/* PSM-OS v2 — Ranking dedicado (Sprint 7.23) */
import { api } from '../api.js';

let _root = null, _data = null;

export async function pageRanking(ctx, root) { _root = root; await reload(); }

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando ranking…</div></div>';
  try {
    // Reusa /metrics/activity_ranking + cruza com deals ganhos do ano
    const [act, atin] = await Promise.all([
      api.request('/api/v3/metrics/activity_ranking?days=30&limit=30'),
      api.request('/api/v3/metas/atingimento?ano=' + new Date().getFullYear()).catch(() => null),
    ]);
    _data = { activity: act.ranking || [], atingimento: atin };
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  // Combina dados: ranking por VGV atingido
  const byUser = {};
  (_data.activity || []).forEach(u => { byUser[u.id] = { ...u, vgv: 0, vendas: 0 }; });
  (_data.atingimento?.grid || []).forEach(g => {
    if (byUser[g.user?.id]) {
      byUser[g.user.id].vgv = g.totals?.atingido_vgv || 0;
      byUser[g.user.id].vendas = g.totals?.vendas_count || 0;
    }
  });

  // Sócios, diretores e gerentes NÃO entram em ranking público (só corretores/líderes)
  const isCompetidor = (u) => {
    const r = (u.role || '').toLowerCase();
    if (['socio', 'diretor', 'gerente'].includes(r)) return false;
    if (u.hide_from_ranking) return false;
    return true;
  };
  const competidores = Object.values(byUser).filter(isCompetidor);

  // Ranking por VGV (descrescente) + fallback por score
  const rankVgv = competidores.filter(u => u.vgv > 0).sort((a, b) => b.vgv - a.vgv).slice(0, 20);
  const rankActivity = competidores.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20);

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🏆 Ranking PSM</h2>
      <p class="card-sub">Ranking unificado: VGV atingido (RD) + Atividade no sistema (30 dias)</p>

      <h3 class="card-title mt-4">💰 Top VGV Vendido — ${new Date().getFullYear()}</h3>
      ${rankVgv.length === 0 ? '<div class="muted tiny">Nenhuma venda registrada no ano ainda.</div>' : `
        <div style="display:grid;gap:6px">
          ${rankVgv.map((u, i) => rankRow(u, i, 'vgv')).join('')}
        </div>
      `}

      <h3 class="card-title mt-4">⚡ Top Atividade — Últimos 30 dias</h3>
      <div style="display:grid;gap:6px">
        ${rankActivity.map((u, i) => rankRow(u, i, 'activity')).join('')}
      </div>
    </div>
  `;
}

function rankRow(u, i, mode) {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const bg = i < 3 ? ['#fef3c7','#e5e7eb','#fed7aa'][i] : 'var(--bg-3)';
  return `
    <div style="display:grid;grid-template-columns:40px 36px 1fr auto;gap:10px;padding:10px 14px;background:${bg};border-radius:var(--r-sm);align-items:center">
      <div style="font-size:${i < 3 ? '20px' : '14px'};font-weight:800;text-align:center">${medal}</div>
      <div style="width:32px;height:32px;border-radius:var(--r-sm);background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px">${ini}</div>
      <div style="min-width:0">
        <div style="font-weight:700;font-size:13px">${escapeHtml(u.name)}</div>
        <div class="tiny muted">${escapeHtml(u.role || '')} · ${escapeHtml(u.team || 'geral')}</div>
      </div>
      ${mode === 'vgv' ? `
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:900;color:#7c3aed">R$ ${money(u.vgv)}</div>
          <div class="tiny muted">${u.vendas} vendas</div>
        </div>
      ` : `
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:900;color:#16a34a">${u.score} pts</div>
          <div class="tiny muted">${u.events_as_actor || 0} ator · ${u.events_as_target || 0} alvo</div>
        </div>
      `}
    </div>
  `;
}

function money(n) { return n == null || isNaN(n) ? '0' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
