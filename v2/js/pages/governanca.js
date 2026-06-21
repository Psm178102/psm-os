/* PSM-OS v2 — Governança (Sprint 7.23 · v77.30: abas Status + Mapa dos Ciclos) */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { pageMapaCiclos } from './mapa-ciclos.js';

let _root = null;

export async function pageGovernanca(ctx, root) {
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Gerente.</div>'; return; }
  const inicial = (ctx?.query?.tab === 'mapa') ? 'mapa' : 'status';
  root.innerHTML = `
    <div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn ${inicial === 'status' ? 'btn-primary' : 'btn-ghost'}" data-gvtab="status" style="font-size:12.5px;padding:7px 14px">⚖️ Status & Auditoria</button>
        <button class="btn ${inicial === 'mapa' ? 'btn-primary' : 'btn-ghost'}" data-gvtab="mapa" style="font-size:12.5px;padding:7px 14px">🗺️ Mapa dos Ciclos</button>
      </div>
      <div id="gv-status" style="display:none"></div>
      <div id="gv-mapa" style="display:none"></div>
    </div>`;
  const subs = { status: root.querySelector('#gv-status'), mapa: root.querySelector('#gv-mapa') };
  const done = {};
  async function show(id) {
    root.querySelectorAll('[data-gvtab]').forEach(b => {
      const on = b.dataset.gvtab === id;
      b.classList.toggle('btn-primary', on); b.classList.toggle('btn-ghost', !on);
    });
    subs.status.style.display = id === 'status' ? '' : 'none';
    subs.mapa.style.display = id === 'mapa' ? '' : 'none';
    if (done[id]) return;
    done[id] = true;
    if (id === 'status') { _root = subs.status; await reload(); }
    else { try { await pageMapaCiclos(ctx, subs.mapa); } catch (e) { subs.mapa.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message || e)}</div>`; } }
  }
  root.querySelectorAll('[data-gvtab]').forEach(b => b.addEventListener('click', () => show(b.dataset.gvtab)));
  await show(inicial);
}

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando governança…</div></div>';
  try {
    const [health, audit, dashboard] = await Promise.all([
      api.request('/api/v3/health').catch(e => ({ ok: false, error: e.message })),
      api.request('/api/v3/audit/list?limit=20').catch(() => ({ entries: [] })),
      api.request('/api/v3/diretoria/dashboard').catch(() => null),
    ]);
    render(health, audit, dashboard);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render(health, audit, dash) {
  const env = health.env || {};
  const sb = health.supabase || {};
  const k = dash?.kpis || {};

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">⚖️ Governança & Compliance</h2>
      <p class="card-sub">Saúde do sistema, auditoria, integrações ativas. Apenas Sócio/Gerente.</p>

      <h3 class="card-title mt-4">🩺 Status do sistema</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('Sistema', health.ok ? '✅ OK' : '⚠ Erro', health.version, health.ok ? '#16a34a' : '#dc2626')}
        ${kpi('Postgres', sb.connected ? '✅ Conectado' : '✕ Off', `${sb.users_total || 0} users, ${sb.users_with_password || 0} com senha`, sb.connected ? '#16a34a' : '#dc2626')}
        ${kpi('Audit 24h', k.audit_24h || 0, 'eventos registrados', '#7c3aed')}
        ${kpi('Notificações ativas', k.recados_ativos || 0, `${k.recados_criticos || 0} críticos`, '#d97706')}
      </div>

      <h3 class="card-title mt-4">🔐 Integrações (env vars)</h3>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        ${Object.entries(env).map(([k, v]) => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 12px"><code>${escapeHtml(k.toUpperCase())}</code></td>
            <td style="padding:8px 12px;text-align:right">${v ? '<span style="color:#16a34a;font-weight:700">✅ configurado</span>' : '<span style="color:#dc2626;font-weight:700">✕ ausente</span>'}</td>
          </tr>
        `).join('')}
      </table>

      <h3 class="card-title mt-4">📊 Operação atual</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('Users ativos', k.users_ativos || 0, `${k.users_total || 0} cadastrados`, '#2563eb')}
        ${kpi('Tarefas abertas', k.tarefas_abertas || 0, '', '#d97706')}
        ${kpi('Eventos próximos 7d', k.eventos_proxima_semana || 0, '', '#7c3aed')}
        ${kpi('Atingimento ano', k.atingimento_pct == null ? '—' : pct2(k.atingimento_pct), `R$ ${money(k.atingido_vgv_ano)}`, '#16a34a')}
      </div>

      <h3 class="card-title mt-4">📜 Últimos 20 eventos do audit</h3>
      <div style="display:grid;gap:4px;max-height:340px;overflow-y:auto">
        ${(audit.entries || []).length === 0 ? '<div class="muted tiny">Sem eventos.</div>' :
          audit.entries.map(e => `
            <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:6px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:11.5px">
              <code style="color:var(--info);font-size:10.5px">${escapeHtml(e.action || '')}</code>
              <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${escapeHtml(e.actor_name || e.actor_id || 'sistema')}</b>${e.target_id ? ' → ' + escapeHtml(e.target_id) : ''}</div>
              <span class="tiny muted">${new Date(e.ts).toLocaleString('pt-BR')}</span>
            </div>
          `).join('')}
      </div>
      <a href="#/auditoria" class="tiny mt-2" style="display:inline-block">Ver trilha completa →</a>

      <div class="alert alert-warn mt-4">
        Sistema PSM-OS v2 · ${health.version || 'v3'} · Postgres Supabase · Auth bcrypt+JWT 12h · Cron 3×/dia · Audit log de tudo · Mobile responsivo.
      </div>
    </div>
  `;
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}"><div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div><div style="font-size:18px;font-weight:900;color:${color};margin-top:2px">${big}</div><div class="tiny muted">${sub||''}</div></div>`;
}
function money(n) { return n == null || isNaN(n) ? '0' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct2(v){ return v==null?'—':(Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
