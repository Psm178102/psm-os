/* ============================================================================
   PSM-OS v2 — Dashboard (role-based KPIs)
   Sprint 7.3
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const SCOPE_LBL = {
  global: '👁 Visão global (Sócio/Gerente)',
  team:   '👥 Sua equipe (Líder)',
  self:   '👤 Seus dados',
};

let _root = null;
let _data = null;
let _ranking = null;

export async function pageDashboard(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando KPIs…</div></div>';
  try {
    const [d, r] = await Promise.all([
      api.request('/api/v3/metrics/overview'),
      api.request('/api/v3/metrics/activity_ranking?days=30&limit=20').catch(() => ({ ranking: [] })),
    ]);
    _data = d;
    _ranking = r;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const d = _data;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👋 Olá, ${escapeHtml(me.name || '')}</h2>
      <p class="card-sub">
        ${SCOPE_LBL[d.scope] || ''} ·
        <span class="tiny muted">Última atualização: ${new Date().toLocaleString('pt-BR')}</span>
      </p>

      <!-- HERO KPIs -->
      <div class="flex gap-3 mt-4" style="flex-wrap:wrap">
        ${kpiCard('👥 Usuários',  fmtNum(d.users?.total),         `${d.users?.ativos || 0} ativos`,         '#2563eb')}
        ${kpiCard('💎 Comissões', fmtNum(d.commissions?.count),   `R$ ${fmtMoney(d.commissions?.valor_pendente)} pendentes`, '#7c3aed')}
        ${kpiCard('🔗 RD Funis',  fmtNum(d.pipelines?.count_active), `de ${d.pipelines?.count_total || 0} configurados`,      '#dc2626')}
        ${kpiCard('📜 Audit 24h', fmtNum(d.audit?.last_24h),      `${d.audit?.last_7d || 0} nos últimos 7 dias`,             '#16a34a')}
      </div>

      <!-- USERS BY TEAM -->
      ${(d.users?.by_team && Object.keys(d.users.by_team).length > 1) ? `
      <div class="card mt-4">
        <h3 class="card-title">👥 Distribuição por equipe</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${Object.entries(d.users.by_team).map(([t, n]) => teamChip(t, n)).join('')}
        </div>
      </div>` : ''}

      <!-- AUDIT TOP ACTIONS + RECENT -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div class="card">
          <h3 class="card-title">📊 Ações mais frequentes (30 dias)</h3>
          ${(d.audit?.top_actions || []).length ? `
            <table style="width:100%;font-size:13px">
              ${d.audit.top_actions.map(a => `
                <tr><td style="padding:6px 0"><code>${escapeHtml(a.action)}</code></td><td style="text-align:right;font-weight:700">${a.count}</td></tr>
              `).join('')}
            </table>
          ` : '<div class="muted tiny">Nenhuma ação registrada ainda.</div>'}
        </div>
        <div class="card">
          <h3 class="card-title">⏱ Últimos eventos</h3>
          ${(d.audit?.recent || []).length ? `
            <div style="display:grid;gap:6px;max-height:240px;overflow-y:auto">
              ${d.audit.recent.map(e => recentRow(e)).join('')}
            </div>
            <a href="#/auditoria" class="tiny mt-2" style="display:inline-block">Ver tudo →</a>
          ` : '<div class="muted tiny">Nenhum evento ainda.</div>'}
        </div>
      </div>

      <!-- COMISSÕES / FINANCEIRO -->
      ${(d.commissions?.count || 0) > 0 ? `
        <div class="card mt-4">
          <h3 class="card-title">💎 Resumo de Comissões</h3>
          <div class="flex gap-3" style="flex-wrap:wrap">
            ${kpiMini('Total registrado', 'R$ ' + fmtMoney(d.commissions.valor_total))}
            ${kpiMini('Pendente',          'R$ ' + fmtMoney(d.commissions.valor_pendente), '#d97706')}
            ${kpiMini('# pagas',           d.commissions.pagas, '#16a34a')}
            ${kpiMini('# pendentes',       d.commissions.pendentes, '#d97706')}
          </div>
        </div>
      ` : `
        <div class="card mt-4">
          <h3 class="card-title">💎 Comissões</h3>
          <div class="muted tiny">Nenhuma comissão registrada no Postgres ainda. Os dados vivem hoje no /v1 (NIBO + Excel). Será migrado em Sprint 7.4.</div>
        </div>
      `}

      <!-- RANKING ATIVIDADE -->
      ${(_ranking?.ranking || []).length ? `
        <div class="card mt-4">
          <h3 class="card-title">🏆 Top usuários ativos (30 dias)</h3>
          <p class="card-sub">Score = 2× eventos como ator + 1× eventos como alvo. Quando RD migrar, vira ranking de VGV/vendas.</p>
          <div style="display:grid;gap:6px">
            ${_ranking.ranking.map((u, i) => rankingRow(u, i)).join('')}
          </div>
        </div>
      ` : ''}

      <!-- ROADMAP -->
      <div class="card mt-4">
        <h3 class="card-title">🚀 Roadmap Sprint 7</h3>
        <ul style="line-height:1.7;font-size:13px;margin:0;padding-left:20px">
          <li><b>✓ 7.0</b> — Backend auth (bcrypt + JWT)</li>
          <li><b>✓ 7.1</b> — Shell /v2 modular</li>
          <li><b>✓ 7.2</b> — Tela Usuários + Auditoria</li>
          <li><b>✓ 7.3</b> — Dashboard + Painel do Corretor <span class="muted">← você está aqui</span></li>
          <li><b>7.4</b> — Migrar CRM + Financeiro (NIBO + RD live)</li>
          <li><b>7.5</b> — Cutover: <code>/</code> → <code>/v2/</code></li>
        </ul>
      </div>
    </div>
  `;
}

function kpiCard(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:28px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
      <div class="tiny muted">${sub || ''}</div>
    </div>
  `;
}

function kpiMini(label, value, color) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:140px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
      <div style="font-size:18px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
    </div>
  `;
}

function teamChip(team, n) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-full);padding:6px 14px;font-size:12px;font-weight:600">
      ${escapeHtml(team)} <span class="muted">·</span> <b>${n}</b>
    </div>
  `;
}

function recentRow(e) {
  const ts = new Date(e.ts).toLocaleString('pt-BR');
  const actor = e.actor_name || e.actor_id || '<sistema>';
  return `
    <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:6px 8px;background:var(--bg);border-radius:var(--r-sm);font-size:12px">
      <code style="font-size:11px;color:var(--info)">${escapeHtml(e.action || '')}</code>
      <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${escapeHtml(actor)}</b>${e.target_id ? ' → ' + escapeHtml(e.target_id) : ''}</div>
      <span class="tiny muted">${ts}</span>
    </div>
  `;
}

function rankingRow(u, i) {
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
  const lastLogin = u.last_login_at ? relTime(u.last_login_at) : 'nunca';
  const lastAction = u.last_action_ts ? relTime(u.last_action_ts) : '—';
  return `
    <div style="display:grid;grid-template-columns:36px 32px 1fr auto auto auto;gap:10px;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:12.5px">
      <div style="font-size:16px;text-align:center">${medal}</div>
      <div style="width:28px;height:28px;border-radius:var(--r-sm);background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${ini}</div>
      <div style="min-width:0">
        <div style="font-weight:700">${escapeHtml(u.name || 'Sem nome')}</div>
        <div class="tiny muted">${escapeHtml(u.role || '')} · ${escapeHtml(u.team || 'geral')} · login ${lastLogin} · ação ${lastAction}</div>
      </div>
      <div style="text-align:right">
        <div class="tiny muted">ator</div>
        <div style="font-weight:800;color:#2563eb">${u.events_as_actor}</div>
      </div>
      <div style="text-align:right">
        <div class="tiny muted">alvo</div>
        <div style="font-weight:800;color:#a855f7">${u.events_as_target}</div>
      </div>
      <div style="text-align:right">
        <div class="tiny muted">score</div>
        <div style="font-weight:900;color:#16a34a">${u.score}</div>
      </div>
    </div>
  `;
}

function relTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return m + 'min';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.round(h / 24);
  if (d < 30) return d + 'd';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function fmtMoney(n) {
  if (n == null) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
