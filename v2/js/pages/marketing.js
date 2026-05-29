/* ============================================================================
   PSM-OS v2 — Meta Ads · Cockpit do Gestor de Tráfego
   ----------------------------------------------------------------------------
   Dashboard tempo-real de alto nível: KPIs do período, Central de Alertas
   (verba queimando, CPL alto, fadiga de criativo, CTR baixo, ranking baixo),
   contas, campanhas ordenáveis com pausar/retomar e auto-refresh.
   Sprint 9.8 (v76.5). Lê /api/v3/marketing/summary (proxy do /api/meta-ads).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const PRESETS = [
  { id: 'today',      lbl: 'Hoje' },
  { id: 'yesterday',  lbl: 'Ontem' },
  { id: 'last_7d',    lbl: 'Últimos 7 dias' },
  { id: 'last_14d',   lbl: 'Últimos 14 dias' },
  { id: 'last_30d',   lbl: 'Últimos 30 dias' },
  { id: 'this_month', lbl: 'Mês atual' },
  { id: 'last_month', lbl: 'Mês anterior' },
];

const TH_KEY = 'psm.v2.ads_thresholds';
const DEFAULT_TH = { cpl: 80, freq: 3.0, ctr: 1.0, gasto: 30 };

let _root = null;
let _data = null;
let _preset = 'last_30d';
let _filter = '';
let _sort = 'spend';
let _statusFilter = 'todos';
let _auto = false;
let _timer = null;
let _busy = false;

function loadTh() {
  try { return { ...DEFAULT_TH, ...(JSON.parse(localStorage.getItem(TH_KEY) || '{}')) }; }
  catch { return { ...DEFAULT_TH }; }
}
function saveTh(th) { localStorage.setItem(TH_KEY, JSON.stringify(th)); }
let _th = loadTh();

export async function pageMarketing(ctx, root) {
  _root = root;
  stopAuto();
  const me = auth.user();
  if ((me?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl ≥ 5).</div>';
    return;
  }
  await reload();
  if (_auto) startAuto();
}

function stopAuto() { if (_timer) { clearInterval(_timer); _timer = null; } }
function startAuto() {
  stopAuto();
  if (!_auto) return;
  _timer = setInterval(() => {
    // pára sozinho se o usuário saiu da página (SPA usa mountEl único)
    if (!_root || !document.body.contains(_root) || !location.hash.startsWith('#/marketing')) { stopAuto(); return; }
    if (!_busy) reload(true);
  }, 60000);
}

async function reload(silent) {
  if (!_root) return;
  _busy = true;
  if (!silent) {
    _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando Meta Ads…</div></div>';
  }
  try {
    _data = await api.request('/api/v3/marketing/summary?date_preset=' + encodeURIComponent(_preset));
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro ao consultar Meta: ${escapeHtml(e.message)}</div>
      <div class="mt-2"><button class="btn btn-primary" id="ma-retry">🔄 Tentar de novo</button></div>`;
    const r = document.getElementById('ma-retry'); if (r) r.addEventListener('click', () => reload());
  } finally { _busy = false; }
}

// ── agregados do período (somando contas; ignora placeholders de erro) ──────
function periodTotals(accounts) {
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, purchaseValue: 0 };
  accounts.forEach(a => {
    t.spend += a.spend || 0;
    t.impressions += a.impressions || 0;
    t.reach += a.reach || 0;
    t.clicks += a.clicks || 0;
    t.results += a.results || 0;
    t.purchaseValue += a.purchaseValue || 0;
  });
  t.cpl = t.results > 0 ? t.spend / t.results : 0;
  t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
  t.cpm = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0;
  t.freq = t.reach > 0 ? t.impressions / t.reach : 0;
  t.roas = t.spend > 0 && t.purchaseValue > 0 ? t.purchaseValue / t.spend : 0;
  return t;
}

function computeAlerts(campaigns) {
  const active = campaigns.filter(c => (c.status || '').toLowerCase() === 'active');
  return {
    active,
    burning:  active.filter(c => (c.spend || 0) >= _th.gasto && (c.results || 0) === 0),
    cplHigh:  active.filter(c => (c.results || 0) > 0 && (c.cpr || 0) > _th.cpl),
    fadiga:   active.filter(c => (c.frequency || 0) > _th.freq),
    ctrLow:   active.filter(c => (c.impressions || 0) >= 500 && (c.ctr || 0) < _th.ctr),
    qualBaixo:active.filter(c => /BELOW_AVERAGE/.test(c.qualityRanking || '')),
  };
}

function render() {
  const d = _data || {};
  if (d.error) { _root.innerHTML = `<div class="alert alert-err">${escapeHtml(d.error)}</div>`; return; }

  const accounts = d.accounts || [];
  const allCampaigns = d.campaigns || [];
  const t = periodTotals(accounts);
  const al = computeAlerts(allCampaigns);
  const verbaRisco = al.burning.reduce((s, c) => s + (c.spend || 0), 0);

  // filtro + ordenação da tabela
  let campaigns = allCampaigns.slice();
  if (_statusFilter !== 'todos') campaigns = campaigns.filter(c => (c.status || '').toLowerCase() === _statusFilter);
  if (_filter) {
    const q = _filter.toLowerCase();
    campaigns = campaigns.filter(c => (c.name || '').toLowerCase().includes(q) || (c.account || '').toLowerCase().includes(q));
  }
  campaigns.sort((a, b) => {
    if (_sort === 'spend')       return (b.spend || 0) - (a.spend || 0);
    if (_sort === 'cpl')         return (b.cpr || 0) - (a.cpr || 0);
    if (_sort === 'results')     return (b.results || 0) - (a.results || 0);
    if (_sort === 'frequency')   return (b.frequency || 0) - (a.frequency || 0);
    if (_sort === 'ctr')         return (a.ctr || 0) - (b.ctr || 0);
    if (_sort === 'impressions') return (b.impressions || 0) - (a.impressions || 0);
    return 0;
  });

  const totalAlerts = al.burning.length + al.cplHigh.length + al.fadiga.length + al.ctrLow.length + al.qualBaixo.length;

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">📢 Cockpit de Tráfego · Meta Ads</h2>
          <p class="card-sub">
            ${accounts.length} conta(s) · período <strong>${escapeHtml(d.period || _preset)}</strong> ·
            atualizado ${d.fetchedAt ? new Date(d.fetchedAt).toLocaleTimeString('pt-BR') : 'agora'}
            ${d.partial ? ' · <span style="color:#d97706">⚠️ parcial</span>' : ''}
          </p>
        </div>
        <label class="tiny" style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer">
          <input type="checkbox" id="ma-auto" ${_auto ? 'checked' : ''}> ⏱ Tempo real (60s)
        </label>
        <button class="btn btn-ghost" id="ma-reload" title="Atualizar">🔄</button>
      </div>

      ${(d.errors && d.errors.length) ? `<div class="alert alert-warn mt-2">⚠️ ${d.errors.length} conta(s) com erro: ${escapeHtml(d.errors.map(e => e.label + ' — ' + e.error).join(' · '))}</div>` : ''}

      <!-- Controles de período -->
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted" style="font-weight:700">PERÍODO:</label>
        <select id="ma-preset" class="select" style="padding:5px 10px;font-size:12px">
          ${PRESETS.map(p => `<option value="${p.id}"${p.id === _preset ? ' selected' : ''}>${p.lbl}</option>`).join('')}
        </select>
      </div>

      <!-- Hero KPIs -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('💰 Investido', 'R$ ' + money(t.spend), 'no período', '#dc2626')}
        ${kpi('🎯 Resultados', fmtNum(t.results), t.cpl ? `CPL médio: R$ ${money(t.cpl)}` : 'sem conversões', '#16a34a')}
        ${kpi('👁 Alcance', fmtNum(t.reach), `${fmtNum(t.impressions)} impressões · freq ${t.freq.toFixed(2)}`, '#2563eb')}
        ${kpi('📊 CTR', t.ctr.toFixed(2) + '%', `CPM: R$ ${money(t.cpm)} · ${fmtNum(t.clicks)} cliques`, '#7c3aed')}
        ${t.roas > 0 ? kpi('📈 ROAS', t.roas.toFixed(2) + 'x', `R$ ${money(t.purchaseValue)} em vendas`, '#0891b2') : ''}
      </div>

      <!-- Central de Alertas -->
      <div class="mt-4" style="margin-top:18px">
        <div class="flex items-center gap-2" style="margin-bottom:10px">
          <h3 class="card-title" style="margin:0">⚠️ Central de Alertas</h3>
          <span class="tiny" style="background:${totalAlerts ? '#dc2626' : '#16a34a'};color:#fff;padding:2px 10px;border-radius:var(--r-full);font-weight:800">${totalAlerts}</span>
          ${verbaRisco > 0 ? `<span class="tiny" style="color:#dc2626;font-weight:800;margin-left:6px">🔥 R$ ${money(verbaRisco)} em risco</span>` : ''}
          <button class="btn btn-ghost tiny" id="ma-th" style="margin-left:auto">⚙️ Limiares</button>
        </div>
        <div id="ma-th-panel" style="display:none"></div>
        ${totalAlerts === 0
          ? '<div class="alert alert-ok">✅ Nenhum alerta. Campanhas ativas dentro dos limiares.</div>'
          : `<div style="display:grid;gap:10px">
              ${alertCard('🔴', 'CRÍTICO · Verba queimando sem resultado', '#dc2626', al.burning,
                  `Campanhas ativas que já gastaram ≥ R$ ${_th.gasto} e geraram 0 resultados.`,
                  c => `gastou <strong>R$ ${money(c.spend)}</strong> · 0 resultados`)}
              ${alertCard('🟠', 'CPL acima da meta', '#ea580c', al.cplHigh,
                  `CPL acima de R$ ${_th.cpl} (meta).`,
                  c => `CPL <strong>R$ ${money(c.cpr)}</strong> · ${fmtNum(c.results)} result.`)}
              ${alertCard('🟠', 'Fadiga de criativo (frequência alta)', '#d97706', al.fadiga,
                  `Frequência acima de ${_th.freq.toFixed(1)} — público saturado, hora de trocar o criativo.`,
                  c => `freq <strong>${(c.frequency || 0).toFixed(2)}</strong> · alcance ${fmtNum(c.reach)}`)}
              ${alertCard('🟡', 'CTR baixo (criativo fraco)', '#ca8a04', al.ctrLow,
                  `CTR abaixo de ${_th.ctr.toFixed(1)}% com volume relevante (≥ 500 impressões).`,
                  c => `CTR <strong>${(c.ctr || 0).toFixed(2)}%</strong> · ${fmtNum(c.impressions)} imp.`)}
              ${alertCard('🟡', 'Ranking de qualidade baixo', '#ca8a04', al.qualBaixo,
                  'A Meta classificou o anúncio abaixo da média — afeta entrega e custo.',
                  c => `qualidade <strong>${escapeHtml(rankLabel(c.qualityRanking))}</strong>`)}
            </div>`}
      </div>

      <!-- Contas Meta -->
      ${accounts.length > 0 ? `
        <div class="mt-4" style="margin-top:18px">
          <h3 class="card-title">🏢 Contas Meta</h3>
          <div style="overflow-x:auto">
            <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:620px">
              <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
                <th style="text-align:left;padding:6px 10px">Conta</th>
                <th style="text-align:right;padding:6px 8px">Investido</th>
                <th style="text-align:right;padding:6px 8px">Result.</th>
                <th style="text-align:right;padding:6px 8px">CPL</th>
                <th style="text-align:right;padding:6px 8px">CTR</th>
                <th style="text-align:right;padding:6px 8px">Freq</th>
                <th style="text-align:right;padding:6px 8px">ROAS</th>
              </tr></thead>
              <tbody>
                ${accounts.map(a => `
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:5px 10px;font-weight:600">${escapeHtml(a.label || a.id)}${a._error ? ' <span class="tiny" style="color:#dc2626">⚠️ erro</span>' : ''}</td>
                    <td style="text-align:right;padding:5px 8px;color:#dc2626">R$ ${money(a.spend)}</td>
                    <td style="text-align:right;padding:5px 8px;color:#16a34a">${fmtNum(a.results)}</td>
                    <td style="text-align:right;padding:5px 8px">${a.cpr ? 'R$ ' + money(a.cpr) : '—'}</td>
                    <td style="text-align:right;padding:5px 8px">${a.ctr != null ? a.ctr.toFixed(2) + '%' : '—'}</td>
                    <td style="text-align:right;padding:5px 8px">${a.frequency ? a.frequency.toFixed(2) : '—'}</td>
                    <td style="text-align:right;padding:5px 8px">${a.roas ? a.roas.toFixed(2) + 'x' : '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Campanhas -->
      <div class="mt-4" style="margin-top:18px">
        <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:8px">
          <h3 class="card-title" style="margin:0">🎯 Campanhas <span class="muted tiny" style="font-weight:400">(${campaigns.length}/${allCampaigns.length})</span></h3>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);margin-bottom:8px">
          <select id="ma-status" class="select" style="padding:5px 10px;font-size:12px">
            <option value="todos"${_statusFilter==='todos'?' selected':''}>Todos status</option>
            <option value="active"${_statusFilter==='active'?' selected':''}>Ativas</option>
            <option value="paused"${_statusFilter==='paused'?' selected':''}>Pausadas</option>
          </select>
          <select id="ma-sort" class="select" style="padding:5px 10px;font-size:12px">
            <option value="spend"${_sort==='spend'?' selected':''}>Maior gasto</option>
            <option value="cpl"${_sort==='cpl'?' selected':''}>Maior CPL</option>
            <option value="results"${_sort==='results'?' selected':''}>Mais resultados</option>
            <option value="frequency"${_sort==='frequency'?' selected':''}>Maior frequência</option>
            <option value="ctr"${_sort==='ctr'?' selected':''}>Menor CTR</option>
            <option value="impressions"${_sort==='impressions'?' selected':''}>Mais impressões</option>
          </select>
          <input id="ma-filter" class="input" placeholder="campanha ou conta…" value="${escapeHtml(_filter)}" style="padding:5px 10px;font-size:12px;width:200px;margin-left:auto">
        </div>
        ${campaigns.length === 0 ? '<div class="muted tiny">Sem campanhas no período/filtro.</div>' : `
          <div style="overflow-x:auto">
            <table style="width:100%;font-size:11.5px;border-collapse:collapse;min-width:920px">
              <thead><tr style="background:var(--bg-3);border-bottom:2px solid var(--border)">
                <th style="text-align:left;padding:6px 8px"></th>
                <th style="text-align:left;padding:6px 8px">Status</th>
                <th style="text-align:left;padding:6px 8px">Conta</th>
                <th style="text-align:left;padding:6px 8px">Campanha</th>
                <th style="text-align:right;padding:6px 8px">Gasto</th>
                <th style="text-align:right;padding:6px 8px">Imp.</th>
                <th style="text-align:right;padding:6px 8px">CTR</th>
                <th style="text-align:right;padding:6px 8px">Freq</th>
                <th style="text-align:right;padding:6px 8px">Result.</th>
                <th style="text-align:right;padding:6px 8px">CPL</th>
                <th style="text-align:center;padding:6px 8px">Ação</th>
              </tr></thead>
              <tbody>
                ${campaigns.map(campaignRow).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;

  wire();
}

function campaignRow(c) {
  const st = (c.status || '').toLowerCase();
  const statusColor = st === 'active' ? '#16a34a' : st === 'paused' ? '#d97706' : 'var(--ink-muted)';
  const statusLbl = st === 'active' ? 'ATIVA' : st === 'paused' ? 'PAUSADA' : (c.status || 'N/A').toUpperCase();

  // sinais de alerta por campanha (bolinha)
  const flags = [];
  if (st === 'active') {
    if ((c.spend || 0) >= _th.gasto && (c.results || 0) === 0) flags.push(['#dc2626', 'Verba sem resultado']);
    if ((c.results || 0) > 0 && (c.cpr || 0) > _th.cpl) flags.push(['#ea580c', 'CPL alto']);
    if ((c.frequency || 0) > _th.freq) flags.push(['#d97706', 'Fadiga (freq alta)']);
    if ((c.impressions || 0) >= 500 && (c.ctr || 0) < _th.ctr) flags.push(['#ca8a04', 'CTR baixo']);
    if (/BELOW_AVERAGE/.test(c.qualityRanking || '')) flags.push(['#ca8a04', 'Qualidade baixa']);
  }
  const dot = flags.length
    ? `<span title="${escapeHtml(flags.map(f => f[1]).join(', '))}" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${flags[0][0]}"></span>`
    : '';

  const cplHi = (c.results || 0) > 0 && (c.cpr || 0) > _th.cpl;
  const freqHi = (c.frequency || 0) > _th.freq;
  const ctrLo = (c.impressions || 0) >= 500 && (c.ctr || 0) < _th.ctr;

  const actBtn = st === 'active'
    ? `<button class="btn btn-ghost tiny" data-act="pause" data-cid="${c.id}" data-cname="${escapeHtml(c.name || '')}" title="Pausar campanha">⏸</button>`
    : st === 'paused'
      ? `<button class="btn btn-ghost tiny" data-act="resume" data-cid="${c.id}" data-cname="${escapeHtml(c.name || '')}" title="Retomar campanha">▶️</button>`
      : '';

  return `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px;text-align:center">${dot}</td>
      <td style="padding:5px 8px"><span style="background:${statusColor};color:#fff;padding:2px 8px;border-radius:var(--r-full);font-size:10px;font-weight:700">${statusLbl}</span></td>
      <td style="padding:5px 8px;font-size:11px" class="muted">${escapeHtml(c.account || '')}</td>
      <td style="padding:5px 8px;font-weight:600;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '—')}</td>
      <td style="text-align:right;padding:5px 8px;color:#dc2626">R$ ${money(c.spend)}</td>
      <td style="text-align:right;padding:5px 8px">${fmtNum(c.impressions)}</td>
      <td style="text-align:right;padding:5px 8px${ctrLo ? ';color:#ca8a04;font-weight:700' : ''}">${c.ctr != null ? c.ctr.toFixed(2) + '%' : '—'}</td>
      <td style="text-align:right;padding:5px 8px${freqHi ? ';color:#d97706;font-weight:700' : ''}">${c.frequency ? c.frequency.toFixed(2) : '—'}</td>
      <td style="text-align:right;padding:5px 8px;color:#16a34a">${fmtNum(c.results)}</td>
      <td style="text-align:right;padding:5px 8px;font-weight:700${cplHi ? ';color:#ea580c' : ''}">${c.cpr ? 'R$ ' + money(c.cpr) : '—'}</td>
      <td style="text-align:center;padding:5px 8px">${actBtn}</td>
    </tr>
  `;
}

function alertCard(icon, title, color, items, desc, fmtItem) {
  if (!items || items.length === 0) return '';
  const shown = items.slice(0, 8);
  return `
    <div style="background:${color}10;border-left:4px solid ${color};border-radius:var(--r-md);padding:12px 14px">
      <div style="font-weight:800;color:${color}">${icon} ${escapeHtml(title)} <span class="tiny" style="font-weight:700">· ${items.length}</span></div>
      <div class="tiny muted" style="margin:2px 0 8px">${escapeHtml(desc)}</div>
      <div style="display:grid;gap:4px">
        ${shown.map(c => `
          <div class="tiny" style="display:flex;gap:8px;align-items:center">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name || '')}">${escapeHtml(c.account ? '['+c.account+'] ' : '')}${escapeHtml(c.name || '—')}</span>
            <span style="white-space:nowrap">${fmtItem(c)}</span>
          </div>
        `).join('')}
        ${items.length > shown.length ? `<div class="tiny muted">+ ${items.length - shown.length} outra(s)…</div>` : ''}
      </div>
    </div>
  `;
}

function thresholdPanel() {
  return `
    <div class="card" style="margin:0 0 10px;background:var(--bg-3)">
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end">
        ${thInput('CPL alvo (R$)', 'th-cpl', _th.cpl, 1)}
        ${thInput('Freq. máx.', 'th-freq', _th.freq, 0.5)}
        ${thInput('CTR mín. (%)', 'th-ctr', _th.ctr, 0.1)}
        ${thInput('Gasto sem result. (R$)', 'th-gasto', _th.gasto, 5)}
        <button class="btn btn-primary" id="th-save">Salvar limiares</button>
        <button class="btn btn-ghost" id="th-reset">Padrão</button>
      </div>
      <p class="tiny muted mt-2">Os limiares definem quando uma campanha vira alerta. Salvos só neste navegador.</p>
    </div>
  `;
}
function thInput(label, id, val, step) {
  return `<div class="field" style="min-width:130px"><label class="tiny">${label}</label>
    <input id="${id}" type="number" step="${step}" class="input" value="${val}" style="padding:5px 8px;font-size:12px"></div>`;
}

function wire() {
  document.getElementById('ma-preset')?.addEventListener('change', async e => { _preset = e.target.value; await reload(); });
  document.getElementById('ma-status')?.addEventListener('change', e => { _statusFilter = e.target.value; render(); });
  document.getElementById('ma-sort')?.addEventListener('change', e => { _sort = e.target.value; render(); });
  document.getElementById('ma-filter')?.addEventListener('input', e => { _filter = e.target.value; render(); });
  document.getElementById('ma-reload')?.addEventListener('click', () => reload());
  document.getElementById('ma-auto')?.addEventListener('change', e => { _auto = e.target.checked; startAuto(); });

  // painel de limiares
  document.getElementById('ma-th')?.addEventListener('click', () => {
    const p = document.getElementById('ma-th-panel');
    if (!p) return;
    if (p.style.display === 'none' || !p.innerHTML) {
      p.innerHTML = thresholdPanel();
      p.style.display = 'block';
      document.getElementById('th-save').addEventListener('click', () => {
        _th = {
          cpl: parseFloat(document.getElementById('th-cpl').value) || DEFAULT_TH.cpl,
          freq: parseFloat(document.getElementById('th-freq').value) || DEFAULT_TH.freq,
          ctr: parseFloat(document.getElementById('th-ctr').value) || DEFAULT_TH.ctr,
          gasto: parseFloat(document.getElementById('th-gasto').value) || DEFAULT_TH.gasto,
        };
        saveTh(_th); render();
      });
      document.getElementById('th-reset').addEventListener('click', () => { _th = { ...DEFAULT_TH }; saveTh(_th); render(); });
    } else { p.style.display = 'none'; }
  });

  // ações pausar/retomar (clique explícito do usuário + confirmação)
  document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const act = btn.dataset.act, cid = btn.dataset.cid, cname = btn.dataset.cname;
    const verbo = act === 'pause' ? 'PAUSAR' : 'RETOMAR';
    if (!confirm(`${verbo} a campanha "${cname}"?\n\nIsso altera a campanha direto na conta Meta.`)) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      await api.request('/api/meta-ads', { method: 'POST', body: { action: act, campaign_id: cid } });
      await reload();
    } catch (e) {
      alert('Erro ao ' + verbo.toLowerCase() + ': ' + e.message);
      btn.disabled = false;
    }
  }));
}

function rankLabel(r) {
  if (!r) return '—';
  if (r === 'ABOVE_AVERAGE') return 'Acima da média';
  if (r === 'AVERAGE') return 'Na média';
  if (/BELOW_AVERAGE/.test(r)) return 'Abaixo da média';
  return r;
}
function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:170px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
    <div class="tiny muted">${sub || ''}</div>
  </div>`;
}
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function money(n) {
  if (n == null || isNaN(n)) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
