/* ============================================================================
   PSM-OS v2 — CRM (RD Station live)
   Sprint 7.7 — funis configurados + deals ao vivo por stage
============================================================================ */
import { api, ApiError } from '../api.js';

let _root = null;
let _funnels = [];
let _selectedFunnel = null;  // external_id selecionado
let _deals = null;

export async function pageCrm(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando funis…</div></div>';
  try {
    const r = await api.request('/api/v3/crm/funnels');
    _funnels = r.funnels || [];
    if (!_selectedFunnel && _funnels.length) {
      _selectedFunnel = _funnels[0].external_id || _funnels[0].id;
    }
    await renderShell();
    if (_selectedFunnel) await loadDeals();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderShell() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔗 CRM · Funis + Deals ao vivo</h2>

      <!-- Tabs de funis -->
      <div class="flex gap-1" style="margin-top:6px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        ${_funnels.map(f => funnelTab(f)).join('')}
      </div>

      <div id="crm-body" style="margin-top:14px">
        <div class="flex items-center gap-2 muted"><span class="spinner"></span> Buscando deals do RD…</div>
      </div>
    </div>
  `;
  document.querySelectorAll('[data-funnel]').forEach(b => b.addEventListener('click', async () => {
    _selectedFunnel = b.dataset.funnel;
    await renderShell();
    await loadDeals();
  }));
}

function funnelTab(f) {
  const id = f.external_id || f.id;
  const active = _selectedFunnel === id;
  const label = f.name || '—';
  return `
    <button data-funnel="${escapeHtml(id)}" class="btn" style="border-radius:var(--r-sm) var(--r-sm) 0 0;background:${active ? 'var(--psm-navy)' : 'transparent'};color:${active ? '#fff' : 'var(--ink-muted)'};border-bottom:none;font-weight:700">
      ${escapeHtml(label)}${f.excluded ? ' <span class="tiny">⊘</span>' : ''}
    </button>
  `;
}

async function loadDeals() {
  const body = document.getElementById('crm-body');
  if (!body) return;
  body.innerHTML = '<div class="flex items-center gap-2 muted"><span class="spinner"></span> Buscando deals…</div>';
  try {
    _deals = await api.request('/api/v3/crm/deals?pipeline_id=' + encodeURIComponent(_selectedFunnel));
    renderDeals();
  } catch (e) {
    if (e instanceof ApiError && e.status === 503 && (e.message || '').includes('RD_API_TOKEN')) {
      body.innerHTML = `
        <div class="alert alert-warn">
          <b>⚙ Configuração pendente:</b> ${escapeHtml(e.message)}<br>
          Adicione <code>RD_API_TOKEN</code> em <a href="https://vercel.com/psms-projects-de52568f/psm-os/settings/environment-variables" target="_blank">Vercel → Settings → Environment Variables</a> e dispare redeploy.
        </div>
        ${stagesOnly()}
      `;
    } else {
      body.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>${stagesOnly()}`;
    }
  }
}

function stagesOnly() {
  // Fallback: mostra stages do funil selecionado sem deals
  const f = _funnels.find(f => (f.external_id || f.id) === _selectedFunnel);
  if (!f) return '';
  return `
    <div class="card mt-4" style="margin-top:14px">
      <h3 class="card-title">${escapeHtml(f.name || '')} — ${f.stages.length} stages</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px">
        ${f.stages.map(s => `
          <div style="padding:10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px">
            <div class="tiny muted">Stage #${s.position ?? '?'}</div>
            <div style="font-weight:700">${escapeHtml(s.name)}</div>
            <div class="tiny" style="margin-top:4px">${s.is_won ? '🏆 Ganho' : s.is_lost ? '❌ Perdido' : '🔄 Em andamento'}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderDeals() {
  const body = document.getElementById('crm-body');
  if (!body) return;
  const d = _deals;
  const f = _funnels.find(f => (f.external_id || f.id) === _selectedFunnel);
  const stages = f?.stages || [];

  // Mapeia by_stage do summary pro objeto
  const byStageMap = {};
  (d.summary?.by_stage || []).forEach(s => { byStageMap[s.stage] = s; });

  // Order: usa stages cadastrados (ordem certa) + qualquer stage extra do RD que vier
  const stageNames = stages.map(s => s.name).filter(Boolean);
  const extraStages = Object.keys(byStageMap).filter(n => !stageNames.includes(n));
  const orderedStages = [...stageNames, ...extraStages];

  body.innerHTML = `
    <div class="tiny muted" style="margin-bottom:10px">
      ${d.cached ? `📦 Cache ${d.cache_age_s}s · ` : '🔥 Fresh · '}
      Scope: <b>${escapeHtml(d.scope)}</b> ·
      ${d.raw_count} deals brutos · ${d.user_scope_count} no seu scope ·
      Atualizado ${d.fetched_at ? new Date(d.fetched_at * 1000).toLocaleString('pt-BR') : 'agora'}
    </div>

    <div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpi('# Deals',  d.summary?.total_count || 0)}
      ${kpi('Em aberto', d.summary?.open  || 0, '#2563eb')}
      ${kpi('🏆 Ganho',  d.summary?.won   || 0, '#16a34a')}
      ${kpi('❌ Perdido',d.summary?.lost  || 0, '#dc2626')}
      ${kpi('💰 VGV',    'R$ ' + money(d.summary?.total_valor || 0), '#7c3aed')}
    </div>

    <!-- Stages com deals -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));gap:10px">
      ${orderedStages.map(name => stageCard(name, byStageMap[name], stages.find(s => s.name === name))).join('') || '<div class="muted">Nenhum deal nesse funil.</div>'}
    </div>

    <div class="tiny muted mt-3">
      Cache 60s · Esses são deals REAIS do RD Station, não do Postgres. Eventos de venda continuam sincronizando como antes no /v1.
    </div>
  `;
}

function stageCard(name, data, stageMeta) {
  const count = data?.count || 0;
  const valor = data?.valor || 0;
  const isWon = stageMeta?.is_won;
  const isLost = stageMeta?.is_lost;
  const accent = isWon ? '#16a34a' : isLost ? '#dc2626' : '#2563eb';
  const ico = isWon ? '🏆' : isLost ? '❌' : '🔄';

  return `
    <div class="card" style="margin:0;border-top:3px solid ${accent}">
      <div class="flex items-center gap-2" style="margin-bottom:6px">
        <div style="font-weight:700;font-size:13px;flex:1">${ico} ${escapeHtml(name)}</div>
        <span class="tiny" style="background:${accent};color:#fff;padding:2px 8px;border-radius:var(--r-full);font-weight:700">${count}</span>
      </div>
      <div style="font-size:14px;font-weight:800;color:${accent};margin-bottom:6px">R$ ${money(valor)}</div>
      ${data?.deals_amostra?.length ? `
        <div style="display:grid;gap:3px;font-size:11px">
          ${data.deals_amostra.map(dx => `
            <div style="padding:4px 6px;background:var(--bg);border-radius:3px">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(dx.name || '')}">${escapeHtml(dx.name || '—')}</div>
              <div class="tiny muted">${escapeHtml(dx.user || '')} · R$ ${money(dx.amount)}</div>
            </div>
          `).join('')}
          ${count > data.deals_amostra.length ? `<div class="tiny muted">+${count - data.deals_amostra.length} mais</div>` : ''}
        </div>
      ` : '<div class="tiny muted">Sem deals nesse stage.</div>'}
    </div>
  `;
}

function kpi(label, value, color) {
  return `<div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:140px">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
    <div style="font-size:18px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
  </div>`;
}
function money(n) {
  if (n == null || isNaN(n)) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
