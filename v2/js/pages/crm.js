/* ============================================================================
   PSM-OS v2 — CRM (RD Station funis configurados)
   Sprint 7.4
============================================================================ */
import { api } from '../api.js';

let _root = null;

export async function pageCrm(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando funis…</div></div>';
  try {
    const r = await api.request('/api/v3/crm/funnels');
    render(r);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render(r) {
  const funnels = r.funnels || [];
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔗 CRM · Funis configurados</h2>
      <p class="card-sub">
        ${funnels.length} pipeline(s) sincronizados do RD Station. Stages e ordens vêm do <code>rd_stages</code>.
        <br>Scope: <b>${r.user_scope}</b> · usuários não-sócio não veem pipelines excluídos das métricas.
      </p>

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(360px, 1fr));gap:14px;margin-top:14px">
        ${funnels.map(funnelCard).join('') || '<div class="muted">Nenhum funil configurado.</div>'}
      </div>

      <div class="alert alert-warn mt-4">
        <b>Em construção (Sprint 7.4 fase 2):</b> Deals ao vivo do RD (com count + valor por stage), drag-and-drop entre stages, filtro por corretor e período.
        Por enquanto, a operação RD acontece no /v1. Volte aqui depois do push da próxima sprint.
      </div>
    </div>
  `;
}

function funnelCard(f) {
  const stages = f.stages || [];
  const wonCount  = stages.filter(s => s.is_won).length;
  const lostCount = stages.filter(s => s.is_lost).length;
  return `
    <div class="card" style="margin:0">
      <div class="flex items-center gap-2" style="margin-bottom:8px">
        <div style="font-weight:800;font-size:14px;flex:1">${escapeHtml(f.name || 'sem nome')}</div>
        ${f.excluded ? '<span class="tiny" style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:var(--r-full);font-weight:700">excluído métricas</span>' : ''}
        ${!f.active ? '<span class="tiny" style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:var(--r-full);font-weight:700">inativo</span>' : ''}
      </div>
      <div class="tiny muted" style="margin-bottom:10px">
        ${stages.length} stages · ${wonCount} ganho · ${lostCount} perdido
      </div>
      <div style="display:grid;gap:4px;max-height:280px;overflow-y:auto">
        ${stages.map(s => `
          <div style="display:grid;grid-template-columns:24px 1fr auto;gap:6px;padding:6px 8px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12px">
            <span class="tiny muted">${s.position ?? '·'}</span>
            <span>${escapeHtml(s.name || '')}</span>
            <span>${s.is_won ? '🏆' : s.is_lost ? '❌' : ''}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
