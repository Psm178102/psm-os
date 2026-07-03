/* PSM-OS v2 — Centro de Inteligência (Ads × Marketing × Vendas)
   O "cérebro": cruza os dados que já temos (Meta + CRM + metas + corretores),
   roda regras de diagnóstico, prioriza por impacto, projeta o fechamento do mês
   e gera uma análise executiva com IA (sob demanda). Tudo dado real. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = {}, _preset = 'last_30d', _ai = null, _aiBusy = false;

const PRESETS = [
  { id: 'last_7d', lbl: '7 dias' }, { id: 'last_30d', lbl: '30 dias' },
  { id: 'last_90d', lbl: '90 dias' }, { id: 'this_month', lbl: 'Mês atual' },
  { id: 'this_year', lbl: 'Este ano' },
];

export async function pageIntelCentro(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder ou acima.</div>'; return; }
  await reload();
}

async function reload() {
  _root.innerHTML = spinner('Cruzando Ads × Marketing × Vendas…');
  const qp = '?date_preset=' + encodeURIComponent(_preset);
  const [sum, crm, geo, oo, dir] = await Promise.allSettled([
    api.request('/api/v3/marketing/summary' + qp),
    api.request('/api/v3/marketing/crm_metrics' + qp),
    api.request('/api/v3/marketing/leads_geo' + qp),
    api.request('/api/v3/oo/overview?date_preset=this_month'),
    api.request('/api/v3/diretoria/dashboard'),
  ]);
  const v = r => (r.status === 'fulfilled' ? r.value : null);
  _d = { sum: v(sum), crm: v(crm), geo: v(geo), oo: v(oo), dir: v(dir) };
  _ai = null;
  render();
}

/* ───────────────────────── REGRAS DE DIAGNÓSTICO ───────────────────────── */
function brandKey(label) {
  const s = (label || '').toLowerCase();
  if (/conquista|mcmv|minha casa/.test(s)) return 'conquista';
  if (/loca|aluguel/.test(s)) return 'locacao';
  return 'imoveis';
}
function spendByBrand(accounts) {
  const m = {};
  (accounts || []).forEach(a => { const k = brandKey(a.label || a.id); m[k] = (m[k] || 0) + (a.spend || 0); });
  return m;
}

function buildInsights() {
  const ins = [];
  const add = (pillar, sev, title, evidence, reco, link) => ins.push({ pillar, sev, title, evidence, reco, link });
  const sum = _d.sum || {}, crm = _d.crm || {}, geo = _d.geo || {}, oo = _d.oo || {}, dir = (_d.dir && _d.dir.kpis) || {};
  const camps = (sum.campaigns || []);
  const active = camps.filter(c => (c.status || '').toLowerCase() === 'active');
  const totalSpend = (sum.accounts || []).reduce((a, c) => a + (c.spend || 0), 0);

  // ── ADS ──
  active.filter(c => (c.spend || 0) >= 300 && (c.results || 0) === 0).forEach(c =>
    add('ads', 'alto', `Campanha queimando verba: ${c.name}`,
      `Gastou R$ ${money(c.spend)} no período e 0 resultados.`,
      'Pausar ou revisar criativo/segmentação imediatamente.', '#/marketing'));
  active.filter(c => (c.results || 0) > 0 && (c.cpr || 0) > 120).forEach(c =>
    add('ads', 'medio', `CPL alto: ${c.name}`,
      `Custo por resultado R$ ${money(c.cpr)} (${c.results} resultados, R$ ${money(c.spend)}).`,
      'Otimizar público/criativo ou realocar verba pra campanha mais eficiente.', '#/marketing'));
  active.filter(c => (c.frequency || 0) > 3.2 && (c.impressions || 0) > 1000).forEach(c =>
    add('ads', 'medio', `Fadiga de criativo: ${c.name}`,
      `Frequência ${(c.frequency || 0).toFixed(1)} — público vendo o mesmo anúncio demais.`,
      'Trocar o criativo / ampliar o público.', '#/marketing'));

  // ── MARKETING (ponte ads↔vendas) ──
  const sb = spendByBrand(sum.accounts);
  Object.keys(crm.brands || {}).forEach(k => {
    if (k === 'captacao') return;
    const b = crm.brands[k]; const spend = sb[k] || 0;
    const vgvPago = (b.attribution && b.attribution.vgv_paid) || 0;
    if (spend >= 500) {
      const roas = vgvPago ? vgvPago / spend : 0;
      if (roas < 1) add('mkt', roas === 0 ? 'alto' : 'medio', `ROAS baixo em ${b.label}`,
        `Investido R$ ${money(spend)}, retorno (comissão paga marcada) ${roas ? roas.toFixed(2) + 'x' : 'R$ 0'}.`,
        'Rever oferta/segmentação dessa linha ou mover verba pra linha mais rentável.', '#/marketing');
    }
    // rejeição por renda/crédito/perfil
    const mot = (b.motivos_perda || []);
    const ruim = mot.filter(x => /renda|cr[ée]dito|perfil|aprov/i.test(x.motivo)).reduce((a, x) => a + x.n, 0);
    if (b.perdas >= 10 && ruim / b.perdas > 0.3) add('mkt', 'medio', `${b.label}: lead fora do perfil financeiro`,
      `${pct2(ruim / b.perdas * 100)} das perdas por renda/crédito/perfil (${ruim} de ${b.perdas}).`,
      'Ajustar a segmentação socioeconômica no Meta dessa linha.', '#/marketing');
  });
  if (geo.pct_outras != null && geo.pct_outras > 30) add('mkt', 'medio', 'Muitos leads de fora de Rio Preto',
    `${pct2(geo.pct_outras)} dos leads são de fora do DDD 17 (${geo.outras} de ${geo.com_cidade}).`,
    'Refinar a segmentação geográfica das campanhas.', '#/marketing');

  // ── VENDAS ──
  const g = crm.global || {};
  if (g.taxa_conversao != null && g.taxa_conversao < 20 && (g.vendas + g.perdas) >= 10)
    add('vendas', 'medio', 'Conversão de fechamento baixa',
      `Win rate ${g.taxa_conversao}% (${g.vendas} ganhos / ${g.perdas} perdas).`,
      'Revisar qualificação e cadência de follow-up nas 1:1.', '#/one-on-one');
  // corretores em atenção + pendências
  const corr = (oo.corretores || []).filter(c => c.role !== 'lider');
  const vermelho = corr.filter(c => c.health_color === 'vermelho').length;
  const semContato = corr.reduce((a, c) => a + ((c.pendencias && c.pendencias.sem_contato_48h) || 0), 0);
  const parados = corr.reduce((a, c) => a + ((c.pendencias && c.pendencias.parados_14d) || 0), 0);
  if (semContato > 0) add('vendas', 'alto', `${semContato} leads sem 1º contato (+48h)`,
    'Leads novos parados sem ninguém falar — risco de perder pro concorrente.',
    'Cobrar contato imediato nas 1:1 / redistribuir.', '#/one-on-one');
  if (parados >= 10) add('vendas', 'medio', `${parados} negócios parados há +14 dias`,
    'Pipeline estagnado — deals sem movimentação.', 'Revisar e reativar ou descartar nas 1:1.', '#/one-on-one');
  if (vermelho > 0) add('vendas', vermelho >= 3 ? 'alto' : 'medio', `${vermelho} corretor(es) em estado crítico 🔴`,
    'Saúde baixa (meta + atividade + conversão).', 'Priorizar 1:1 com esses corretores.', '#/one-on-one');

  // ── META (ritmo) ──
  const fc = forecast();
  if (fc && fc.pct_meta != null && fc.pct_meta < 80)
    add('vendas', fc.pct_meta < 50 ? 'alto' : 'medio', 'Abaixo do ritmo da meta do mês',
      `Projeção de fechamento R$ ${moneyShort(fc.projecao)} vs meta R$ ${moneyShort(fc.meta)} (${pct2(fc.pct_meta)}).`,
      'Acelerar pipeline: priorizar deals quentes e visitas.', '#/diretoria');

  const ordem = { alto: 0, medio: 1, baixo: 2 };
  ins.sort((a, b) => ordem[a.sev] - ordem[b.sev]);
  return { ins, totalSpend };
}

function forecast() {
  const k = (_d.dir && _d.dir.kpis) || {};
  const vgvMes = k.atingido_vgv_mes || 0;
  const meta = k.meta_vgv_mes || 0;
  const now = new Date();
  const dia = now.getDate();
  const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projecao = dia > 0 ? vgvMes / dia * diasMes : 0;
  return { vgvMes, meta, projecao, dia, diasMes, pct_meta: meta > 0 ? projecao / meta * 100 : null };
}

/* ───────────────────────── RENDER ───────────────────────── */
function render() {
  const { ins, totalSpend } = buildInsights();
  const crm = _d.crm || {}, g = crm.global || {};
  const fc = forecast();
  const altos = ins.filter(i => i.sev === 'alto').length;
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
        <div style="flex:1;min-width:220px">
          <h2 class="card-title">🧠 Centro de Inteligência</h2>
          <p class="card-sub">Ads × Marketing × Vendas cruzados · ${ins.length} insights (${altos} 🚨 críticos) · dado real do período.</p>
        </div>
        <select id="ic-preset" class="select" style="padding:5px 10px;font-size:12px">
          ${PRESETS.map(p => `<option value="${p.id}"${p.id === _preset ? ' selected' : ''}>${p.lbl}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="ic-ai">🧠 Análise executiva da IA</button>
      </div>

      <!-- 3 pilares -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:10px">
        ${pillar('📢 Ads (Meta)', 'R$ ' + moneyShort(totalSpend), 'investido no período', '#f59e0b', [
          ['Leads', fmtNum((_d.sum && _d.sum.accounts || []).reduce((a, c) => a + (c.results || 0), 0))],
          ['CPL médio', cplMedio()],
        ])}
        ${pillar('🔗 Marketing', cac(), 'CAC (pago ÷ vendas)', '#7c3aed', [
          ['ROAS', roasGlobal()],
          ['Leads fora RP', (_d.geo && _d.geo.pct_outras != null) ? pct2(_d.geo.pct_outras) : '—'],
        ])}
        ${pillar('🤝 Vendas', fmtNum(g.vendas || 0) + ' vendas', 'R$ ' + moneyShort(g.vgv || 0) + ' VGV', '#16a34a', [
          ['Win rate', g.taxa_conversao != null ? pct2(g.taxa_conversao) : '—'],
          ['Atingimento mês', fc.pct_meta != null ? pct2(fc.pct_meta) : '—'],
        ])}
      </div>

      <!-- Forecast -->
      ${forecastPanel(fc)}

      <!-- AI narrative -->
      <div id="ic-ai-box" style="margin-top:14px"></div>

      <!-- Insights -->
      <h3 class="card-title mt-4" style="margin-top:16px">⚡ Diagnóstico priorizado</h3>
      ${ins.length ? `<div style="display:grid;gap:8px;margin-top:8px">${ins.map(insightCard).join('')}</div>`
        : '<div style="font-size:13px;color:#16a34a;padding:10px">✅ Nenhum problema crítico detectado no período. Tudo dentro dos parâmetros.</div>'}

      <div class="tiny muted" style="margin-top:12px">Regras determinísticas sobre dado real (Meta + CRM + metas). A IA escreve o plano executivo a partir desses fatos — clique em "Análise executiva da IA".</div>
    </div>`;
  document.getElementById('ic-preset').addEventListener('change', e => { _preset = e.target.value; reload(); });
  document.getElementById('ic-ai').addEventListener('click', runAI);
  _root.querySelectorAll('[data-link]').forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.link; }));
}

function pillar(title, big, sub, color, rows) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${color};border-radius:var(--r-md);padding:12px 14px">
    <div style="font-size:12px;font-weight:700;color:var(--ink-muted)">${title}</div>
    <div style="font-size:24px;font-weight:900;color:${color};margin:2px 0">${big}</div>
    <div class="tiny muted">${sub}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
      ${rows.map(r => `<div style="background:var(--bg-3);border-radius:6px;padding:5px 8px"><div style="font-weight:800;font-size:13px">${r[1]}</div><div style="font-size:10px;color:var(--ink-muted)">${r[0]}</div></div>`).join('')}
    </div></div>`;
}

function forecastPanel(fc) {
  if (!fc.meta && !fc.vgvMes) return '';
  const col = fc.pct_meta == null ? '#64748b' : fc.pct_meta >= 100 ? '#16a34a' : fc.pct_meta >= 80 ? '#d97706' : '#dc2626';
  return `<div style="margin-top:14px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">🔮 Forecast do mês (projeção pelo ritmo)</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end">
      <div><div style="font-size:11px;color:var(--ink-muted)">Realizado (dia ${fc.dia}/${fc.diasMes})</div><div style="font-size:20px;font-weight:900">R$ ${moneyShort(fc.vgvMes)}</div></div>
      <div style="font-size:20px;color:var(--ink-muted)">→</div>
      <div><div style="font-size:11px;color:var(--ink-muted)">Projeção de fechamento</div><div style="font-size:24px;font-weight:900;color:${col}">R$ ${moneyShort(fc.projecao)}</div></div>
      <div><div style="font-size:11px;color:var(--ink-muted)">Meta do mês</div><div style="font-size:20px;font-weight:900">R$ ${moneyShort(fc.meta)}</div></div>
      <div style="text-align:center"><div style="font-size:11px;color:var(--ink-muted)">vs meta</div><div style="font-size:24px;font-weight:900;color:${col}">${fc.pct_meta != null ? pct2(fc.pct_meta) : '—'}</div></div>
    </div>
    ${fc.meta > 0 ? `<div style="height:8px;background:var(--bg-3);border-radius:5px;overflow:hidden;margin-top:10px"><div style="height:100%;width:${Math.min(100, fc.pct_meta)}%;background:${col}"></div></div>` : ''}
  </div>`;
}

function insightCard(i) {
  const sevC = i.sev === 'alto' ? '#dc2626' : i.sev === 'medio' ? '#d97706' : '#64748b';
  const sevI = i.sev === 'alto' ? '🚨' : i.sev === 'medio' ? '⚠️' : 'ℹ️';
  const pill = { ads: ['📢 Ads', '#f59e0b'], mkt: ['🔗 Marketing', '#7c3aed'], vendas: ['🤝 Vendas', '#16a34a'] }[i.pillar] || ['', '#64748b'];
  return `<div data-link="${i.link}" style="cursor:pointer;background:var(--bg-2);border:1px solid var(--border);border-left:4px solid ${sevC};border-radius:var(--r-md);padding:10px 14px" onmouseover="this.style.background='var(--bg-3)'" onmouseout="this.style.background='var(--bg-2)'">
    <div class="flex items-center gap-2" style="flex-wrap:wrap">
      <span style="font-weight:700;font-size:13px">${sevI} ${escapeHtml(i.title)}</span>
      <span style="background:${pill[1]}22;color:${pill[1]};font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px">${pill[0]}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--ink-muted)">abrir →</span>
    </div>
    <div class="tiny muted" style="margin-top:3px">${escapeHtml(i.evidence)}</div>
    <div style="font-size:12px;margin-top:4px"><b style="color:${sevC}">Ação:</b> ${escapeHtml(i.reco)}</div>
  </div>`;
}

async function runAI() {
  const box = document.getElementById('ic-ai-box');
  if (_aiBusy) return;
  _aiBusy = true;
  box.innerHTML = `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:14px"><span class="spinner"></span> A IA está analisando os dados…</div>`;
  try {
    const { ins } = buildInsights();
    const fc = forecast();
    const g = (_d.crm && _d.crm.global) || {};
    const fatos = ins.map(i => `- [${i.sev.toUpperCase()}/${i.pillar}] ${i.title} — ${i.evidence} Ação sugerida: ${i.reco}`).join('\n');
    const prompt = `Você é o diretor de inteligência da PSM Imobiliária (São José do Rio Preto). Com base nos FATOS abaixo (extraídos do Meta Ads + CRM RD + metas, dado real do período "${_preset}"), escreva uma ANÁLISE EXECUTIVA curta e acionável pro sócio Paulo, em markdown:
1) **Resumo** (2-3 linhas: como está o funil ads→venda).
2) **Top 3 prioridades** desta semana (o que atacar primeiro e por quê).
3) **Onde está o dinheiro** (ads: o que pausar/escalar; vendas: onde destravar).
Seja direto, sem encher linguiça. Não invente números além dos fatos.

VENDAS GLOBAL: ${g.vendas || 0} vendas, R$ ${money(g.vgv || 0)} VGV, win rate ${g.taxa_conversao ?? '—'}%.
FORECAST DO MÊS: projeção R$ ${money(fc.projecao)} vs meta R$ ${money(fc.meta)} (${fc.pct_meta ?? '—'}%).

FATOS/DIAGNÓSTICOS:
${fatos || '(nenhum problema crítico detectado)'}`;
    const j = await api.request('/api/v3/ia/analyze', { method: 'POST', body: { prompt, max_tokens: 3000, dossie: true } });   // cérebro novo (Sonnet 5 + dossiê) v84.4
    if (j.ok && j.text) {
      box.innerHTML = `<div style="background:linear-gradient(180deg,rgba(124,58,237,.06),transparent);border:1px solid rgba(124,58,237,.25);border-radius:var(--r-md);padding:14px 16px">
        <div style="font-weight:800;font-size:13px;margin-bottom:8px;color:#7c3aed">🧠 Análise executiva da IA <span class="tiny muted" style="font-weight:400">· ${escapeHtml(j.model_used || 'IA')}</span></div>
        <div style="font-size:13px;line-height:1.55">${mdLite(j.text)}</div></div>`;
    } else {
      box.innerHTML = `<div class="alert alert-warn">IA indisponível: ${escapeHtml(j.error || 'erro')}</div>`;
    }
  } catch (e) {
    box.innerHTML = `<div class="alert alert-err">Erro na análise: ${escapeHtml(e.message)}</div>`;
  } finally { _aiBusy = false; }
}

/* ─── helpers ─── */
function cplMedio() {
  const a = (_d.sum && _d.sum.accounts) || [];
  const sp = a.reduce((x, c) => x + (c.spend || 0), 0), re = a.reduce((x, c) => x + (c.results || 0), 0);
  return re > 0 ? 'R$ ' + money(sp / re) : '—';
}
function roasGlobal() {
  const attr = (_d.crm && _d.crm.global && _d.crm.global.attribution) || {};
  const sp = ((_d.sum && _d.sum.accounts) || []).reduce((x, c) => x + (c.spend || 0), 0);
  return (sp > 0 && attr.vgv_paid) ? (attr.vgv_paid / sp).toFixed(2) + 'x' : '—';
}
function cac() {
  const sp = ((_d.sum && _d.sum.accounts) || []).reduce((x, c) => x + (c.spend || 0), 0);
  const v = (_d.crm && _d.crm.global && _d.crm.global.vendas) || 0;
  return v > 0 ? 'R$ ' + moneyShort(sp / v) : '—';
}
function mdLite(t) {
  return escapeHtml(t)
    .replace(/^### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^## (.*)$/gm, '<div style="font-weight:800;font-size:14px;margin:10px 0 4px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*] (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}
function spinner(t) { return `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${t}</div></div>`; }
function money(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function moneyShort(v) { return money(v); }
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function fmtNum(v) { return (v || 0).toLocaleString('pt-BR'); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
