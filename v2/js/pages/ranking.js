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

  // ── Atividade: separa CORRETORES (agrupados por equipe) do TIME INTERNO ──
  const ehCorretor = u => ['corretor', 'lider'].includes((u.role || '').toLowerCase());
  const corretores = competidores.filter(ehCorretor);
  const interno = competidores.filter(u => !ehCorretor(u)).sort((a, b) => (b.score || 0) - (a.score || 0));
  const teams = {};
  corretores.forEach(u => { const t = (u.team || '').trim() || 'Sem equipe'; (teams[t] = teams[t] || []).push(u); });
  const teamNames = Object.keys(teams).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  teamNames.forEach(t => teams[t].sort((a, b) => (b.score || 0) - (a.score || 0)));

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

      <h3 class="card-title mt-4">⚡ Atividade dos Corretores — por equipe (30 dias)</h3>
      ${teamNames.length === 0 ? '<div class="muted tiny">Sem corretores com atividade no período.</div>' : teamNames.map(t => `
        <div style="font-weight:800;font-size:13px;margin:14px 0 6px;display:flex;align-items:center;gap:8px">🛡 ${escapeHtml(t)} <span class="tiny muted" style="font-weight:400">· ${teams[t].length} pessoa(s)</span></div>
        <div style="display:grid;gap:6px">${teams[t].map((u, i) => rankRow(u, i, 'activity')).join('')}</div>
      `).join('')}

      <h3 class="card-title mt-4">🛠 Atividade do Time Interno — Backoffice · Marketing · Financeiro (30 dias)</h3>
      ${interno.length ? `<div style="display:grid;gap:6px">${interno.map((u, i) => rankRow(u, i, 'activity')).join('')}</div>` : '<div class="muted tiny">Sem registros do time interno no período.</div>'}

      <p class="tiny muted mt-3">💰 VGV e vendas vêm do <b>RD CRM</b> (fonte oficial). A auditoria abaixo confere com o PSM HUB.</p>
    </div>
    <div id="rk-audit"></div>
  `;
  loadAudit();
}

/* 🔎 Auditoria RD × PSM HUB (Conquista) — valida fidelidade; não altera o ranking.
   Só carrega pra diretoria (lvl≥7); pra quem não tem acesso, o endpoint nega e some. */
async function loadAudit() {
  const el = document.getElementById('rk-audit');
  if (!el) return;
  let r;
  try { r = await api.request('/api/v3/psmhub/reconcile'); }
  catch (_) { el.remove(); return; }                 // sem permissão / HUB off → nem mostra
  if (!r || !r.ok || r.pending_config) { el.remove(); return; }
  const rows = (r.rows || []).filter(x => (x.psmhub_vgv || 0) > 0 || (x.rd_vgv || 0) > 0);
  if (!rows.length) { el.innerHTML = `<div class="card mt-3"><h3 class="card-title">🔎 Auditoria RD × PSM HUB</h3><div class="muted tiny">Sem vendas da Conquista no período pra comparar. Conexão com o HUB OK ✅.</div></div>`; return; }
  const conf = rows.filter(x => x.ok && !x.rd_zero).length;
  const soHub = rows.filter(x => x.rd_zero && (x.psmhub_vgv || 0) > 0);
  const diverg = rows.filter(x => !x.ok && !x.rd_zero);
  const statusCell = x => {
    if (x.rd_zero && (x.psmhub_vgv || 0) > 0) return '<span style="color:#2563eb;font-weight:700">🟦 só no HUB</span>';
    if (x.ok) return '<span style="color:#16a34a;font-weight:700">✅ confere</span>';
    return `<span style="color:#dc2626;font-weight:700">⚠️ diverge ${x.diff_pct != null ? x.diff_pct + '%' : ''}</span>`;
  };
  el.innerHTML = `
    <div class="card mt-3">
      <h3 class="card-title">🔎 Auditoria RD × PSM HUB (Conquista)</h3>
      <p class="card-sub">Confere se o VGV/vendas do ranking (RD) batem com o PSM HUB. ${conf}/${rows.length} conferem${diverg.length ? ' · <b style="color:#dc2626">' + diverg.length + ' divergência(s)</b>' : ''}${soHub.length ? ' · <b style="color:#2563eb">' + soHub.length + ' só no HUB</b>' : ''}.</p>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:560px">
        <thead><tr style="color:var(--ink-muted);font-size:11px;text-align:left;border-bottom:1px solid var(--border)">
          <th style="padding:5px 6px">Corretor</th><th style="text-align:right">RD VGV</th><th style="text-align:right">HUB VGV</th><th style="text-align:right">RD vendas</th><th style="text-align:right">HUB vendas</th><th style="text-align:center">Status</th></tr></thead>
        <tbody>${rows.map(x => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${escapeHtml(x.nome || x.email || '—')}</td>
          <td style="text-align:right">R$ ${money(x.rd_vgv)}</td>
          <td style="text-align:right">R$ ${money(x.psmhub_vgv)}</td>
          <td style="text-align:right">${x.rd_vendas || 0}</td>
          <td style="text-align:right">${x.psmhub_vendas || 0}</td>
          <td style="text-align:center">${statusCell(x)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${soHub.length ? `<p class="tiny muted mt-2">🟦 "Só no HUB" = venda registrada na Conquista mas ainda não no RD — vale conferir/lançar no RD (fonte oficial).</p>` : ''}
      ${r.fetched_at ? `<p class="tiny muted" style="margin-top:4px">Reconciliado agora · mês ${r.month}/${r.year}.</p>` : ''}
    </div>`;
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
