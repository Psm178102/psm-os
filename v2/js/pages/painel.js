/* ============================================================================
   PSM-OS v2 — Painel do Corretor (vista personalizada)
   Sprint 7.3
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;

export async function pagePainel(ctx, root) {
  _root = root;
  const me = auth.user();
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando seus dados…</div></div>';

  try {
    // Reusa overview com scope auto-determinado pelo backend
    const data = await api.request('/api/v3/metrics/overview');
    // E pega audit pessoal
    const audit = await api.request('/api/v3/audit/list?target_id=' + encodeURIComponent(me.id) + '&limit=20').catch(() => ({ entries: [] }));
    render(me, data, audit);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render(me, d, audit) {
  const ini = escapeHtml((me.ini || (me.name || '?').substring(0, 2)).toUpperCase());

  _root.innerHTML = `
    <div class="card">
      <!-- Header hero do corretor -->
      <div style="display:flex;align-items:center;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--border)">
        <div style="width:64px;height:64px;border-radius:var(--r-md);background:${me.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:24px">${ini}</div>
        <div>
          <h2 class="card-title" style="margin:0">${escapeHtml(me.name)}</h2>
          <div class="muted tiny">${escapeHtml(me.email || '')} · ${escapeHtml(me.role || '')} L${me.lvl} · ${escapeHtml(me.team || me.frente || 'Geral')}</div>
          ${me.last_login_at ? `<div class="tiny" style="color:var(--info);margin-top:4px">Último login: ${new Date(me.last_login_at).toLocaleString('pt-BR')}</div>` : ''}
        </div>
      </div>

      <!-- SEU DESEMPENHO (RD ao vivo + Metas) -->
      <h3 class="card-title mt-4">💰 Seu Desempenho do Mês</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('🏆 Vendas',        d.sales?.vendas_mes || 0, '#16a34a')}
        ${kpi('💰 VGV',           'R$ ' + fmtKM(d.sales?.vgv_mes || 0), '#16a34a')}
        ${kpi('🎯 Sua Meta',      'R$ ' + fmtKM(d.metas?.meta_vgv || 0), '#d4a843')}
        ${kpi('📊 Atingimento',   pctMeta(d.sales?.vgv_mes, d.metas?.meta_vgv), pctColor(d.sales?.vgv_mes, d.metas?.meta_vgv))}
        ${kpi('📈 Pipeline',      'R$ ' + fmtKM(d.sales?.pipeline_vgv || 0), '#3b82f6')}
        ${kpi('💎 VGV no Ano',    'R$ ' + fmtKM(d.sales?.vgv_ano || 0), '#0891b2')}
      </div>

      <!-- Suas comissões -->
      <h3 class="card-title mt-4">💎 Suas comissões</h3>
      ${(d.commissions?.count || 0) > 0 ? `
        <div class="flex gap-3" style="flex-wrap:wrap">
          ${kpi('# Comissões',  d.commissions.count)}
          ${kpi('Pagas',         d.commissions.pagas, '#16a34a')}
          ${kpi('Pendentes',     d.commissions.pendentes, '#d97706')}
          ${kpi('Valor total',   'R$ ' + fmtMoney(d.commissions.valor_total))}
          ${kpi('Valor pendente','R$ ' + fmtMoney(d.commissions.valor_pendente), '#d97706')}
        </div>
      ` : '<div class="muted tiny">Nenhuma comissão registrada ainda.</div>'}

      <!-- Suas tarefas -->
      <h3 class="card-title mt-4">📋 Suas tarefas</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('✅ Feitas',       d.tasks?.done || 0, '#16a34a')}
        ${kpi('⏳ Pendentes',    d.tasks?.pending || 0, '#f59e0b')}
        ${kpi('📊 Total',        d.tasks?.total || 0)}
      </div>

      <!-- Sua atividade -->
      <h3 class="card-title mt-4">📜 Sua atividade recente</h3>
      ${(audit.entries || []).length ? `
        <div style="display:grid;gap:6px;max-height:400px;overflow-y:auto">
          ${audit.entries.map(e => activityRow(e, me.id)).join('')}
        </div>
        <a href="#/auditoria" class="tiny mt-2" style="display:inline-block">Trilha completa →</a>
      ` : '<div class="muted tiny">Nenhuma atividade registrada ainda.</div>'}

      <!-- Atalhos -->
      <h3 class="card-title mt-4">⚡ Atalhos</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <a href="#/conta" class="btn btn-ghost">⚙️ Minha conta</a>
        <a href="#/usuarios" class="btn btn-ghost">👥 Usuários</a>
        <a href="#/auditoria" class="btn btn-ghost">📜 Auditoria</a>
        <a href="/" class="btn btn-ghost" title="Sistema atual">↩ Sistema v1 (legacy)</a>
      </div>

    </div>
  `;
}

function pctMeta(real, meta) {
  if (!meta || meta <= 0) return '—';
  const pct = Math.round((real || 0) / meta * 100);
  return pct + '%';
}

function pctColor(real, meta) {
  if (!meta || meta <= 0) return 'var(--muted)';
  const pct = (real || 0) / meta;
  if (pct >= 1) return '#16a34a';
  if (pct >= 0.7) return '#f59e0b';
  return '#dc2626';
}

function fmtKM(n) {
  if (n == null) return '0';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
  return Math.round(v).toLocaleString('pt-BR');
}

function kpi(label, value, color) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:150px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
    </div>
  `;
}

function activityRow(e, myId) {
  const ts = new Date(e.ts).toLocaleString('pt-BR');
  const actor = e.actor_name || e.actor_id || 'sistema';
  const who = e.actor_id === myId ? `<b>Você</b>` : `<b>${escapeHtml(actor)}</b>`;
  const action = escapeHtml(e.action || '');
  return `
    <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px">
      <code style="font-size:11px;color:var(--info);align-self:center">${action}</code>
      <div>${who}${e.notes ? ' · <span class="muted">' + escapeHtml(e.notes) + '</span>' : ''}</div>
      <span class="tiny muted">${ts}</span>
    </div>
  `;
}

function fmtMoney(n) {
  if (n == null) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
