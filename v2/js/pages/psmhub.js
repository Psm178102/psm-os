/* ============================================================================
   PSM-OS v2 — PSM HUB · Conquista (auditoria/cruzamento) · v77.73
   Puxa os dados do sistema psmhub.com.br (Equipe Conquista) via ponte do backend
   e cruza com os números do RD/House PSM. Diretoria (lvl≥7).
============================================================================ */
import { api } from '../api.js';

let _root = null;
let _mes = null, _ano = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtKM = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = n => Number(n || 0).toLocaleString('pt-BR');
const pct2 = v => v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

export async function pagePsmHub(ctx, root) {
  _root = root;
  const now = new Date(Date.now() - 3 * 3600 * 1000);
  if (!_mes) _mes = now.getMonth() + 1;
  if (!_ano) _ano = now.getFullYear();
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Conectando ao PSM HUB…</div></div>';
  try {
    const [hub, ov, rec] = await Promise.all([
      api.request(`/api/v3/psmhub/hub?month=${_mes}&year=${_ano}`),
      api.request('/api/v3/metrics/overview').catch(() => null),
      api.request(`/api/v3/psmhub/reconcile?month=${_mes}&year=${_ano}`).catch(() => null),
    ]);
    render(hub, ov, rec);
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function render(hub, ov, rec) {
  if (hub && hub.pending_config) {
    _root.innerHTML = `<div class="card"><h2 class="card-title">🔌 PSM HUB · Conquista</h2>
      <div class="alert alert-warn">${esc(hub.error)}</div>
      <p class="tiny muted">No Vercel → Settings → Environment Variables, adicione <b>PSMHUB_EMAIL</b> e <b>PSMHUB_PASSWORD</b> (de preferência um usuário de serviço dedicado) e refaça o deploy.</p></div>`;
    return;
  }
  const d = (hub && hub.data) || {};
  const k = d.kpis || {};
  const cfg = d.metas_config || {};
  const esteira = (d.esteira && d.esteira.rows) || [];
  const sources = (d.lead_sources && d.lead_sources.sources) || [];
  const funnel = d.funnel_ratios || {};

  // cruzamento VGV: psmhub (Conquista) × RD/House PSM (overview = empresa)
  const vgvHub = Number(k.vendasVgv || 0);
  const vgvRd = Number(ov?.sales?.vgv_mes || 0);
  const diffPct = vgvRd > 0 ? (vgvHub - vgvRd) / vgvRd * 100 : null;
  const bate = diffPct !== null && Math.abs(diffPct) <= 5;

  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const metaPct = cfg.metaVgv > 0 ? (vgvHub / cfg.metaVgv * 100) : null;

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">🔌 PSM HUB · Conquista</h2>
          <p class="tiny muted" style="margin:2px 0 0">Dados ao vivo do <b>psmhub.com.br</b> (Equipe Conquista) cruzados com o RD/House PSM · ${esc((k.label || ''))}</p>
        </div>
        <div class="flex gap-2" style="align-items:center">
          <select id="ph-mes" class="select">${meses.map((m, i) => `<option value="${i + 1}"${_mes === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select>
          <select id="ph-ano" class="select">${[_ano - 1, _ano, _ano + 1].map(y => `<option value="${y}"${_ano === y ? ' selected' : ''}>${y}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" id="ph-reload">🔄</button>
        </div>
      </div>

      <!-- 🔎 CRUZAMENTO / AUDITORIA -->
      <div class="card mt-3" style="background:var(--bg-3)">
        <h3 class="card-title" style="font-size:14px">🔎 Auditoria — VGV PSM HUB × RD</h3>
        <div class="flex gap-3" style="flex-wrap:wrap">
          ${audCard('PSM HUB (Conquista)', 'R$ ' + fmtKM(vgvHub), `${fmtN(k.totalPastas)} pastas · ${fmtN(k.pastasAprovadas)} aprovadas`, '#0891b2')}
          ${audCard('RD / House PSM', 'R$ ' + fmtKM(vgvRd), `${fmtN(ov?.sales?.vendas_mes)} venda(s) no RD (empresa)`, '#16a34a')}
          ${audCard('Divergência', diffPct === null ? '—' : (diffPct > 0 ? '+' : '') + pct2(diffPct), bate ? '🟢 batem (±5%)' : (diffPct === null ? 'sem base RD' : '🔴 conferir'), bate ? '#16a34a' : '#dc2626')}
        </div>
        <p class="tiny muted" style="margin:6px 0 0">RD/overview é da empresa toda; PSM HUB é só Conquista. Quando a Conquista domina as vendas do mês, os números convergem. A reconciliação corretor-a-corretor (via rdUserId) é o próximo passo.</p>
      </div>

      <!-- KPIs do PSM HUB -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('🎯 Leads', fmtN(k.totalLeads), `${fmtN(k.leadsDescartados)} descartados`, '#2563eb')}
        ${kpi('👁 Visitas', fmtN(k.totalVisitas), 'no mês', '#8b5cf6')}
        ${kpi('📁 Pastas', fmtN(k.totalPastas), `${fmtN(k.pastasAprovadas)}✓ · ${fmtN(k.pastasReprovadas)}✕ · ${fmtN(k.pastasRepasse)} repasse`, '#f59e0b')}
        ${kpi('💰 VGV', 'R$ ' + fmtKM(k.vendasVgv), 'ticket ' + 'R$ ' + fmtKM(k.ticketMedio), '#16a34a')}
        ${kpi('🎯 Meta VGV', 'R$ ' + fmtKM(cfg.metaVgv), metaPct === null ? '' : `${metaPct >= 100 ? '🟢' : metaPct >= 70 ? '🟡' : '🔴'} ${pct2(metaPct)} atingido`, '#d4a843')}
        ${kpi('📣 Invest. Ads', 'R$ ' + fmtKM(cfg.investimentoAds), cfg.investimentoAds && k.totalLeads ? `CPL R$ ${(cfg.investimentoAds / k.totalLeads).toFixed(2)}` : '', '#dc2626')}
      </div>

      <!-- ESTEIRA POR CORRETOR -->
      ${esteira.length ? `
      <div class="card mt-3">
        <h3 class="card-title" style="font-size:14px">🚚 Esteira por corretor (${esteira.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead><tr style="background:var(--bg-3)">
            <th style="text-align:left;padding:7px">Corretor</th><th style="padding:7px">Prosp.</th><th style="padding:7px">Agend.</th><th style="padding:7px">Atend.</th><th style="padding:7px">Pasta</th><th style="padding:7px">Vendas</th><th style="text-align:right;padding:7px">VGV</th>
          </tr></thead>
          <tbody>
            ${esteira.slice().sort((a, b) => (b.vendaTotal || 0) - (a.vendaTotal || 0) || (b.prospeccao || 0) - (a.prospeccao || 0)).map(r => `
              <tr style="border-bottom:1px solid var(--bd)">
                <td style="padding:7px;font-weight:700">${esc(r.agentName)}</td>
                <td style="padding:7px;text-align:center">${fmtN(r.prospeccao)}</td>
                <td style="padding:7px;text-align:center">${fmtN(r.agendamento)}</td>
                <td style="padding:7px;text-align:center">${fmtN(r.atendimento)}</td>
                <td style="padding:7px;text-align:center">${fmtN(r.pasta)}</td>
                <td style="padding:7px;text-align:center;font-weight:700;color:${(r.vendaCount || 0) > 0 ? '#16a34a' : 'var(--muted)'}">${fmtN(r.vendaCount)}</td>
                <td style="padding:7px;text-align:right;font-weight:800">${(r.vendaTotal || 0) > 0 ? 'R$ ' + fmtKM(r.vendaTotal) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <!-- 🤝 RECONCILIAÇÃO CORRETOR-A-CORRETOR -->
      ${reconcileCard(rec)}

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap;align-items:flex-start">
        <!-- FONTES DE LEAD -->
        ${sources.length ? `
        <div class="card" style="flex:1;min-width:300px">
          <h3 class="card-title" style="font-size:14px">📥 Fontes de lead</h3>
          ${sources.slice(0, 10).map(s => `
            <div style="margin-bottom:7px">
              <div class="flex" style="justify-content:space-between"><span class="tiny" style="font-weight:600">${esc(s.source)}</span><span class="tiny muted">${fmtN(s.count)} · ${pct2(s.pct)}</span></div>
              <div style="height:6px;border-radius:3px;background:rgba(148,163,184,.2);overflow:hidden"><div style="height:100%;width:${Math.min(100, s.pct)}%;background:#2563eb"></div></div>
            </div>`).join('')}
        </div>` : ''}

        <!-- FUNIL -->
        ${Object.keys(funnel).length ? `
        <div class="card" style="flex:1;min-width:260px">
          <h3 class="card-title" style="font-size:14px">🪜 Funil (médias)</h3>
          ${[['prospeccoes', '📞 Prospecções'], ['agendamentos', '📅 Agendamentos'], ['visitas', '👁 Visitas'], ['pastas', '📁 Pastas'], ['vendas', '💰 Vendas']].map(([key, lbl]) => `
            <div class="flex" style="justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd)">
              <span class="tiny" style="font-weight:600">${lbl}</span><span style="font-weight:800">${fmtN(funnel[key])}</span>
            </div>`).join('')}
        </div>` : ''}
      </div>

      ${hub.errors ? `<div class="alert alert-warn tiny mt-3">Algumas seções do psmhub falharam: ${esc(Object.keys(hub.errors).join(', '))}</div>` : ''}
      <p class="tiny muted mt-2">Fonte: psmhub.com.br · atualizado ${hub.fetched_at ? new Date(hub.fetched_at).toLocaleString('pt-BR') : '—'}</p>
    </div>`;

  const reload = () => { _mes = +document.getElementById('ph-mes').value; _ano = +document.getElementById('ph-ano').value; pagePsmHub(null, _root); };
  document.getElementById('ph-mes').onchange = reload;
  document.getElementById('ph-ano').onchange = reload;
  document.getElementById('ph-reload').onclick = reload;
}

function audCard(label, big, sub, cor) {
  return `<div style="flex:1;min-width:150px;background:var(--bg-1,#fff);border:1px solid ${cor}44;border-radius:12px;padding:12px 14px">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">${label}</div>
    <div style="font-size:24px;font-weight:900;color:${cor};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub}</div></div>`;
}
function kpi(label, big, sub, cor) {
  return `<div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:12px;padding:12px 14px;border-left:4px solid ${cor}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${cor};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub || ''}</div></div>`;
}

// badge da BASE do match (quão confiável é o cruzamento daquele corretor)
const MATCH_BADGE = {
  'email':     { t: '🟢 e-mail', c: '#16a34a' },
  'rd_id':     { t: '🔵 rd_id',  c: '#0891b2' },
  'nome':      { t: '🟡 nome',   c: '#d4a843' },
  'sem match': { t: '⚪ s/ match', c: '#94a3b8' },
};
function matchBadge(m) {
  const b = MATCH_BADGE[m] || MATCH_BADGE['sem match'];
  return `<span class="tiny" style="background:${b.c}1f;color:${b.c};padding:1px 7px;border-radius:999px;font-weight:700;white-space:nowrap">${b.t}</span>`;
}
// célula de divergência (semáforo) por corretor
function diffCell(r) {
  if (r.rd_zero) return `<span style="color:#d97706;font-weight:800;white-space:nowrap">🟠 RD sem registro</span>`;
  if (r.diff_pct === null || r.diff_pct === undefined) return `<span class="muted">—</span>`;
  const cor = r.ok ? '#16a34a' : '#dc2626';
  return `<span style="color:${cor};font-weight:800;white-space:nowrap">${r.ok ? '🟢' : '🔴'} ${r.diff_pct > 0 ? '+' : ''}${pct2(r.diff_pct)}</span>`;
}

function reconcileCard(rec) {
  if (!rec) return '';
  if (rec.pending_config) return '';
  if (!rec.ok) return `<div class="alert alert-warn tiny mt-3">Reconciliação por corretor indisponível agora${rec.error ? `: ${esc(rec.error)}` : ''}.</div>`;
  const rows = rec.rows || [];
  if (!rows.length) return '';
  const t = rec.totals || {};
  const okN = rows.filter(r => r.ok).length;
  const divN = rows.filter(r => !r.ok && !r.rd_zero && r.diff_pct !== null).length;
  const zeroN = rows.filter(r => r.rd_zero).length;
  const tDiff = t.rd_conquista_vgv > 0 ? (t.psmhub_vgv - t.rd_conquista_vgv) / t.rd_conquista_vgv * 100 : null;

  return `
  <div class="card mt-3">
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h3 class="card-title" style="font-size:14px;margin:0">🤝 Reconciliação por corretor — PSM HUB × RD (${rows.length})</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <span class="tiny" style="background:#16a34a1f;color:#16a34a;padding:2px 8px;border-radius:999px;font-weight:700">🟢 ${okN} batem</span>
        ${divN ? `<span class="tiny" style="background:#dc26261f;color:#dc2626;padding:2px 8px;border-radius:999px;font-weight:700">🔴 ${divN} divergem</span>` : ''}
        ${zeroN ? `<span class="tiny" style="background:#d977061f;color:#d97706;padding:2px 8px;border-radius:999px;font-weight:700">🟠 ${zeroN} sem registro no RD</span>` : ''}
      </div>
    </div>
    <p class="tiny muted" style="margin:4px 0 8px">Elo pelo <b>e-mail</b> do corretor (psmhub ↔ RD). Cada linha mostra a <b>base do match</b> — nunca cruzamos no chute. Divergência verde = dentro de ±5%.</p>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr style="background:var(--bg-3)">
        <th style="text-align:left;padding:7px">Corretor</th>
        <th style="padding:7px">Match</th>
        <th style="text-align:right;padding:7px">VGV PSM HUB</th>
        <th style="padding:7px">Vd.</th>
        <th style="text-align:right;padding:7px">VGV RD</th>
        <th style="padding:7px">Vd.</th>
        <th style="text-align:right;padding:7px">Divergência</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr style="border-bottom:1px solid var(--bd)">
            <td style="padding:7px;font-weight:700">${esc(r.nome)}${r.team ? `<div class="tiny muted" style="font-weight:400">${esc(r.team)}</div>` : ''}</td>
            <td style="padding:7px;text-align:center">${matchBadge(r.match)}</td>
            <td style="padding:7px;text-align:right;font-weight:800">${(r.psmhub_vgv || 0) > 0 ? 'R$ ' + fmtKM(r.psmhub_vgv) : '—'}</td>
            <td style="padding:7px;text-align:center">${fmtN(r.psmhub_vendas)}</td>
            <td style="padding:7px;text-align:right;font-weight:800">${(r.rd_vgv || 0) > 0 ? 'R$ ' + fmtKM(r.rd_vgv) : '—'}</td>
            <td style="padding:7px;text-align:center">${fmtN(r.rd_vendas)}</td>
            <td style="padding:7px;text-align:right">${diffCell(r)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="border-top:2px solid var(--bd);font-weight:800;background:var(--bg-3)">
          <td style="padding:7px">TOTAL Conquista</td>
          <td></td>
          <td style="padding:7px;text-align:right">R$ ${fmtKM(t.psmhub_vgv)}</td>
          <td style="padding:7px;text-align:center">${fmtN(t.psmhub_vendas)}</td>
          <td style="padding:7px;text-align:right">R$ ${fmtKM(t.rd_conquista_vgv)}</td>
          <td style="padding:7px;text-align:center">${fmtN(t.rd_conquista_vendas)}</td>
          <td style="padding:7px;text-align:right">${tDiff === null ? '—' : `<span style="color:${Math.abs(tDiff) <= 5 ? '#16a34a' : '#dc2626'}">${tDiff > 0 ? '+' : ''}${pct2(tDiff)}</span>`}</td>
        </tr>
      </tfoot>
    </table>
    </div>
    <p class="tiny muted" style="margin:8px 0 0">
      📊 No RD a empresa fechou <b>R$ ${fmtKM(t.rd_empresa_vgv)}</b> (${fmtN(t.rd_empresa_vendas)} venda(s)) no mês.
      Destes, <b>R$ ${fmtKM(t.rd_conquista_vgv)}</b> são da Conquista (reconciliados acima) e
      <b>R$ ${fmtKM(t.outros_times_vgv)}</b> (${fmtN(t.outros_times_vendas)}) são de <b>outros times</b> — por isso o total da empresa &gt; Conquista.
      ${rec.errors ? `<br>⚠️ Fontes psmhub com falha: ${esc(Object.keys(rec.errors).join(', '))}.` : ''}
    </p>
  </div>`;
}
