/* PSM-OS v2 — 📅 Histórico Meta (mensal). Lê /api/v3/marketing/history (tabela
   meta_ads_monthly, preenchida pelo cron). Mostra leads/CPL/investimento/campanha
   campeã por mês de 2026 — o histórico que antes não era guardado. Líder+ (lvl≥5). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _ano = new Date().getFullYear();
const MES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const f$ = n => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
const f1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('pt-BR');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function pageMarketingHistorico(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder+ (lvl 5+).</div>'; return; }
  render(null, true);
  try { const d = await api.request('/api/v3/marketing/history?ano=' + _ano); render(d, false); }
  catch (e) { render({ erro: e.message }, false); }
}

function render(d, loading) {
  const anos = [];
  const y = new Date().getFullYear();
  for (let a = y; a >= y - 2; a--) anos.push(a);
  let body;
  if (loading) body = '<div class="muted tiny"><span class="spinner"></span> Carregando histórico…</div>';
  else if (d && d.erro) body = `<div class="alert alert-err">${esc(d.erro)}</div>`;
  else if (d && d.pending) body = `<div class="alert alert-warn">⏳ Tabela ainda não criada. Rode <b>supabase/sprint_meta_monthly.sql</b> e dispare o cron <b>/api/v3/marketing/meta_monthly_cron</b> (backfill do ano).</div>`;
  else {
    const meses = (d && d.meses) || [];
    if (!meses.length) body = `<div class="alert" style="background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.3);padding:12px;border-radius:8px">Sem dados de ${_ano} ainda. O cron preenche diariamente (e faz backfill do ano). Pra forçar agora, dispare <b>/api/v3/marketing/meta_monthly_cron?ano=${_ano}</b> com a chave do cron.</div>`;
    else {
      const t = d.totais || {};
      body = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        ${kpi('💸 Investimento (ano)', f$(t.spend), '#1e293b')}
        ${kpi('👥 Leads (ano)', f1(t.results), '#0ea5e9')}
        ${kpi('🎯 CPL médio (ano)', f$(t.cpl), '#d97706')}
        ${kpi('💬 Mensagens (ano)', f1(t.messages), '#7c3aed')}
      </div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:680px">
        <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:9px 10px">Mês</th>
          <th style="text-align:right;padding:9px 10px">💸 Investimento</th>
          <th style="text-align:right;padding:9px 10px">👥 Leads</th>
          <th style="text-align:right;padding:9px 10px">🎯 CPL</th>
          <th style="text-align:right;padding:9px 10px">💬 Msgs</th>
          <th style="text-align:left;padding:9px 10px">🏆 Campanha campeã</th>
        </tr></thead>
        <tbody>${meses.map(m => `<tr style="border-bottom:1px solid var(--border)">
          <td style="text-align:left;padding:8px 10px;font-weight:700">${MES[m.mes] || m.mes}</td>
          <td style="text-align:right;padding:8px 10px">${f$(m.spend)}</td>
          <td style="text-align:right;padding:8px 10px">${f1(m.results)}</td>
          <td style="text-align:right;padding:8px 10px">${f$(m.cpl)}</td>
          <td style="text-align:right;padding:8px 10px">${f1(m.messages)}</td>
          <td style="text-align:left;padding:8px 10px">${esc(m.top_campaign || '—')}${m.top_campaign_leads ? ` <span class="tiny muted">(${f1(m.top_campaign_leads)})</span>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="tiny muted" style="margin-top:8px">📅 ${d.meses_com_dado} mês(es) arquivado(s). O cron atualiza o mês corrente diariamente. CPL = investimento ÷ leads.</div>`;
    }
  }
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div><h2 class="card-title">📅 Histórico Meta (mensal)</h2>
        <p class="card-sub">Leads · CPL · investimento · campanha campeã por mês — agora ARMAZENADO (antes era só ao vivo).</p></div>
        <select class="input" id="hist-ano" style="font-size:12px;padding:6px 10px">${anos.map(a => `<option value="${a}"${a === _ano ? ' selected' : ''}>${a}</option>`).join('')}</select>
      </div>
      <div style="margin-top:14px">${body}</div>
    </div>`;
  const sel = document.getElementById('hist-ano');
  if (sel) sel.addEventListener('change', () => { _ano = +sel.value; pageMarketingHistorico(null, _root); });
}
function kpi(l, v, bg) { return `<div style="background:${bg};color:#fff;border-radius:10px;padding:12px;text-align:center"><div style="font-size:10px;text-transform:uppercase;opacity:.85;font-weight:700">${l}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${v}</div></div>`; }
