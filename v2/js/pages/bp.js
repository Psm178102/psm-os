/* PSM-OS v2 — Plano Consolidado (BP) Sprint 7.23 */
import { api } from '../api.js';
import { auth } from '../auth.js';

const MES_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let _root = null, _ano = new Date().getFullYear();

export async function pageBP(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Gerente.</div>'; return; }
  await reload();
}

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Consolidando plano…</div></div>';
  try {
    const [atin, dre, custos] = await Promise.all([
      api.request('/api/v3/metas/atingimento?ano=' + _ano),
      api.request('/api/v3/finance/dre?months=12&company=all').catch(() => null),
      api.request('/api/v3/finance/custos_fixos?months=12&company=all').catch(() => null),
    ]);
    render(atin, dre, custos);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render(atin, dre, custos) {
  const t = atin.totals || {};
  const totMeta = t.meta_vgv || 0;
  const totAtingido = t.atingido_vgv || 0;
  const pct = totMeta > 0 ? (totAtingido / totMeta * 100) : null;

  const dreT = (dre?.rows || []).reduce((a, r) => ({
    receita_real: a.receita_real + (r.receita_real || 0),
    despesa_real: a.despesa_real + (r.despesa_real || 0),
    receita_prev: a.receita_prev + (r.receita_prev || 0),
    despesa_prev: a.despesa_prev + (r.despesa_prev || 0),
  }), { receita_real: 0, despesa_real: 0, receita_prev: 0, despesa_prev: 0 });
  const saldoReal = dreT.receita_real - dreT.despesa_real;

  const custosTotal = (custos?.totals?.total) || 0;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📋 Plano Consolidado (BP) ${_ano}</h2>
      <p class="card-sub">Visão consolidada anual: metas vs atingimento + DRE NIBO + custos fixos</p>

      <div class="flex gap-2 mt-2" style="align-items:center">
        <label class="tiny muted">ANO:</label>
        <select id="bp-ano" class="select" style="padding:5px 10px;font-size:12px">
          ${[2024,2025,2026,2027].map(a => `<option value="${a}"${a===_ano?' selected':''}>${a}</option>`).join('')}
        </select>
      </div>

      <h3 class="card-title mt-4">🎯 Vendas (RD x Metas)</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('Meta VGV ano', 'R$ ' + money(totMeta), atin.grid?.length + ' corretores', '#2563eb')}
        ${kpi('Atingido VGV', 'R$ ' + money(totAtingido), t.vendas_count + ' vendas', '#7c3aed')}
        ${kpi('% Atingimento', pct == null ? '—' : pct.toFixed(1) + '%', 'do ano', pct >= 90 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626')}
        ${kpi('Falta/Sobra', 'R$ ' + money(totAtingido - totMeta), totAtingido >= totMeta ? 'sobra' : 'falta', totAtingido >= totMeta ? '#16a34a' : '#dc2626')}
      </div>

      <h3 class="card-title mt-4">💰 DRE consolidado (12 meses)</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('Receita real', 'R$ ' + money(dreT.receita_real), 'recebida 12m', '#16a34a')}
        ${kpi('Despesa real', 'R$ ' + money(dreT.despesa_real), 'paga 12m', '#dc2626')}
        ${kpi('Saldo real', 'R$ ' + money(saldoReal), 'caixa líquido', saldoReal >= 0 ? '#16a34a' : '#dc2626')}
        ${kpi('Receita prev', 'R$ ' + money(dreT.receita_prev), 'a receber', '#0891b2')}
      </div>

      <h3 class="card-title mt-4">🏢 Custos Fixos (3 meses)</h3>
      <div class="flex gap-3" style="flex-wrap:wrap">
        ${kpi('Total custos', 'R$ ' + money(custosTotal), (custos?.buckets || []).length + ' categorias', '#7c3aed')}
        ${kpi('Folha+SaaS', 'R$ ' + money(((custos?.buckets || []).find(b => b.bucket==='Folha de Pagamento')?.total || 0) + ((custos?.buckets || []).find(b => b.bucket==='Softwares & SaaS')?.total || 0)), 'principais fixos', '#d97706')}
      </div>

      ${(atin.grid || []).length > 0 ? `
        <h3 class="card-title mt-4">👥 Atingimento por corretor (top 10)</h3>
        <div style="display:grid;gap:6px">
          ${atin.grid.filter(g => g.totals?.meta_vgv > 0 || g.totals?.atingido_vgv > 0).sort((a,b) => (b.totals?.atingido_vgv||0) - (a.totals?.atingido_vgv||0)).slice(0, 10).map(g => {
            const tt = g.totals || {};
            const p = tt.pct == null ? '—' : tt.pct.toFixed(0) + '%';
            const cor = tt.pct >= 90 ? '#16a34a' : tt.pct >= 50 ? '#d97706' : '#dc2626';
            return `<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:10px;padding:8px 12px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px">
              <div style="font-weight:600">${escapeHtml(g.user.name)}</div>
              <div class="tiny muted">Meta R$ ${money(tt.meta_vgv)}</div>
              <div style="color:#7c3aed;font-weight:700">↑ R$ ${money(tt.atingido_vgv)}</div>
              <div style="color:${cor};font-weight:800;min-width:50px;text-align:right">${p}</div>
            </div>`;
          }).join('')}
        </div>
      ` : ''}

      <div class="alert alert-warn mt-3">
        Esse é o consolidado executivo. Detalhes em <a href="#/metas">Metas</a>, <a href="#/financeiro">Financeiro</a>, <a href="#/diretoria">Diretoria</a>.
      </div>
    </div>
  `;
  document.getElementById('bp-ano').addEventListener('change', async e => { _ano = parseInt(e.target.value); await reload(); });
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}"><div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div><div style="font-size:18px;font-weight:900;color:${color};margin-top:2px">${big}</div><div class="tiny muted">${sub}</div></div>`;
}
function money(n) { return n == null || isNaN(n) ? '0' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
