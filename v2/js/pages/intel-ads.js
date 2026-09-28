/* PSM-OS v2 — 🏙 Mercado · Investimento (v88.82; ex-"Intel Ads / Raio-X", v77.35)
   Quem está anunciando, quanto e o investimento ESTIMADO de cada concorrente.
     • Anúncios ativos → REAL: o coletor do Vigia atualiza todo dia a partir da Biblioteca
       do Meta (concorrentes.anuncios_count). O 📷 (print lido pela IA) fica como correção manual.
     • Investimento/mês → ESTIMATIVA = nº de anúncios × custo por criativo/mês.
       O Meta não publica gasto de anúncio imobiliário no BR.
   v88.82: o custo por criativo saiu do navegador (localStorage — cada sócio via um número)
   e passou a ser um só pra casa, em settings/kv_config 'intel_ads_premissas'. */
import { api } from '../api.js';

let _root = null, _conc = [], _segFilter = 'all', _pendingPrint = null;
const SEGMENTOS = ['all', 'MAP', 'MCMV', 'Terceiros', 'Locação'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f$ = n => 'R$ ' + (Number(+n || 0) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fNum = n => (+n || 0).toLocaleString('pt-BR');
const semAc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Régua calibrada nas NOSSAS contas (v87.15): MCMV ← conta Conquista (≈ R$ 700/criativo/mês);
// MAP/Terceiros/Locação ← contas PSM Imóveis + Paulo (≈ R$ 430). Editável na tela (sócio).
const PREM_DEFAULT = { MCMV: 700, MAP: 430 };
const PREM_LEGACY_KEY = 'psm.intelads.premissas_v2';
let _prem = { ...PREM_DEFAULT };

const premissaDe = seg => (String(seg || '').toUpperCase() === 'MCMV' ? _prem.MCMV : _prem.MAP);
function investOf(c) {
  return (c.investimento_estimado != null && c.investimento_estimado !== '')
    ? { v: +c.investimento_estimado, manual: true }
    : { v: (+c.anuncios_count || 0) * premissaDe(c.segmento || c.seg), manual: false };
}
function adLibUrl(name) {
  return 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q='
    + encodeURIComponent((name || '').replace(/[&]/g, '')) + '&search_type=keyword_unordered';
}
function fmtDate(s) { try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } }

async function loadPremissas() {
  try {
    const r = await api.request('/api/v3/settings/kv_config?key=intel_ads_premissas');
    const v = r && r.value;
    if (v && +v.MCMV > 0 && +v.MAP > 0) { _prem = { MCMV: +v.MCMV, MAP: +v.MAP }; return; }
  } catch (_) { /* sem valor salvo ainda — usa o padrão (ou o que estava neste navegador) */ }
  try {
    const old = JSON.parse(localStorage.getItem(PREM_LEGACY_KEY) || 'null');
    if (old && +old.MCMV > 0 && +old.MAP > 0) _prem = { MCMV: +old.MCMV, MAP: +old.MAP };
  } catch (_) {}
}

async function salvaPremissas() {
  const m = Math.max(1, parseInt(document.getElementById('ia-prem-mcmv')?.value, 10) || PREM_DEFAULT.MCMV);
  const a = Math.max(1, parseInt(document.getElementById('ia-prem-map')?.value, 10) || PREM_DEFAULT.MAP);
  _prem = { MCMV: m, MAP: a };
  renderContent();
  try {
    await api.request('/api/v3/settings/kv_config', { method: 'POST', body: { key: 'intel_ads_premissas', value: _prem } });
    try { localStorage.removeItem(PREM_LEGACY_KEY); } catch (_) {}
    setStatus('✅ Custo por criativo salvo para todos os sócios.', 'var(--ok)');
  } catch (e) { setStatus('⚠️ Não salvou: ' + e.message, 'var(--err)'); }
}

export async function pageIntelAds(ctx, root) {
  _root = root;
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando concorrentes…</div></div>`;
  const [r] = await Promise.all([
    api.request('/api/v3/concorrentes/list').catch(() => ({ concorrentes: [] })),
    loadPremissas(),
  ]);
  _conc = (r.concorrentes || []).map(c => ({ ...c, anuncios_count: +(c.anuncios_count || 0) }));
  root.innerHTML = `
    <div class="card">
      <div class="flex" style="align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">💰 Investimento dos concorrentes</h2>
          <p class="card-sub">Quem está anunciando, quanto e a verba estimada de cada um.</p>
        </div>
        <a href="https://www.facebook.com/ads/library/?country=BR&ad_type=all&active_status=active" target="_blank" rel="noopener" class="btn btn-ghost">🔗 Biblioteca do Meta</a>
      </div>
      <div id="ads-body"></div>
    </div>`;
  renderContent();
}

function renderContent() {
  const body = document.getElementById('ads-body');
  if (!body) return;
  const filtered = (_segFilter === 'all' ? _conc.slice() : _conc.filter(c => semAc(c.segmento) === semAc(_segFilter)))
    .sort((a, b) => (b.anuncios_count - a.anuncios_count) || (investOf(b).v - investOf(a).v));
  const comAds = filtered.filter(c => c.anuncios_count > 0);
  const totalAds = comAds.reduce((s, c) => s + c.anuncios_count, 0);
  const top = comAds[0];
  const investTotal = filtered.reduce((s, c) => s + investOf(c).v, 0);
  const temDias = filtered.some(c => +c.anuncios_dias_medio > 0);
  const diasVals = filtered.map(c => +c.anuncios_dias_medio).filter(v => v > 0);
  const tempoMedio = diasVals.length ? Math.round(diasVals.reduce((a, b) => a + b, 0) / diasVals.length) : null;
  const th = (t, al = 'left') => `<th style="padding:8px 10px;text-align:${al};font-size:11px;color:var(--ink-muted)">${t}</th>`;

  body.innerHTML = `
    <div class="tiny" style="margin:12px 0;background:var(--bg-3);padding:10px 12px;border-radius:var(--r-md);line-height:1.7">
      📡 <b>Anúncios ativos</b> são reais: o Vigia atualiza todo dia pela Biblioteca do Meta (📷 corrige um concorrente por print).
      <b>Investimento/mês é estimativa</b> = anúncios × custo por criativo/mês, porque o Meta não publica a verba.
      <div class="flex gap-3" style="flex-wrap:wrap;align-items:center;margin-top:6px">
        <label>MCMV (régua: conta Conquista) R$ <input id="ia-prem-mcmv" class="input" type="number" min="1" value="${_prem.MCMV}" style="width:90px;padding:3px 6px;font-size:12px;display:inline-block"></label>
        <label>MAP / Terceiros / Locação (régua: Imóveis + Paulo) R$ <input id="ia-prem-map" class="input" type="number" min="1" value="${_prem.MAP}" style="width:90px;padding:3px 6px;font-size:12px;display:inline-block"></label>
        <span id="ads-status" style="font-weight:600"></span>
      </div>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:12px">
      ${SEGMENTOS.map(s => `<button class="btn btn-sm ${_segFilter === s ? 'btn-primary' : 'btn-ghost'}" data-seg="${s}">${s === 'all' ? 'Todos' : s}</button>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px">
      ${kpi('Anúncios ativos (mercado)', fNum(totalAds), comAds.length + ' concorrentes anunciando')}
      ${kpi('Mais agressivo', top ? fNum(top.anuncios_count) : '—', top ? top.nome : 'sem anúncios capturados')}
      ${kpi('Verba estimada/mês', f$(investTotal), 'soma do filtro')}
      ${tempoMedio != null ? kpi('Tempo médio no ar', tempoMedio + ' dias', 'dos anúncios lidos por print') : ''}
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
        <thead><tr style="border-bottom:2px solid var(--border)">
          ${th('#')}${th('Concorrente')}${th('Tier', 'center')}${th('Segmento')}${th('Anúncios', 'right')}${temDias ? th('Tempo no ar', 'right') : ''}${th('Verba/mês (≈)', 'right')}${th('', 'center')}
        </tr></thead>
        <tbody>
          ${filtered.map((c, i) => {
            const inv = investOf(c);
            return `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 10px" class="muted">${i + 1}</td>
              <td style="padding:8px 10px;font-weight:600">${esc(c.nome || '—')}${c.handle ? `<div class="tiny muted" style="font-weight:400">${esc(c.handle)}</div>` : ''}</td>
              <td style="padding:8px 10px;text-align:center">${esc(c.tier || '—')}</td>
              <td style="padding:8px 10px" class="muted">${esc(c.segmento || '—')}</td>
              <td style="padding:8px 10px;text-align:right;font-weight:600">${c.anuncios_count || '—'}${c.ultima_atualizacao && c.anuncios_count ? `<div class="tiny muted" style="font-weight:400">${fmtDate(c.ultima_atualizacao)}</div>` : ''}</td>
              ${temDias ? `<td style="padding:8px 10px;text-align:right">${c.anuncios_dias_medio ? Math.round(c.anuncios_dias_medio) + 'd' : '—'}</td>` : ''}
              <td style="padding:8px 10px;text-align:right;font-weight:600">${inv.v ? '≈ ' + f$(inv.v) : '—'}${inv.manual ? '<div class="tiny muted" style="font-weight:400">manual</div>' : ''}</td>
              <td style="padding:8px 10px;text-align:center;white-space:nowrap">
                <a href="${adLibUrl(c.nome)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" title="Ver anúncios na Biblioteca do Meta">🔗</a>
                <button class="btn btn-ghost btn-sm" data-print="${c.id}" title="Corrigir por print (a IA conta os anúncios)">📷</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <input type="file" accept="image/*" id="ads-file" style="display:none">`;

  ['ia-prem-mcmv', 'ia-prem-map'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', salvaPremissas); });
  body.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { _segFilter = b.dataset.seg; renderContent(); }));
  body.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => startPrint(b.dataset.print)));
  const fi = document.getElementById('ads-file');
  if (fi) fi.addEventListener('change', onFile);
}

function kpi(label, value, sub) {
  return `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:12px 14px">
    <div class="tiny muted" style="font-weight:600">${label}</div>
    <div style="font-size:20px;font-weight:600;margin-top:2px">${value}</div>
    ${sub ? `<div class="tiny muted">${esc(sub)}</div>` : ''}</div>`;
}

function setStatus(msg, color) { const s = document.getElementById('ads-status'); if (s) { s.textContent = msg || ''; s.style.color = color || 'var(--ok)'; } }
function startPrint(id) { _pendingPrint = id; const f = document.getElementById('ads-file'); if (f) { f.value = ''; f.click(); } }
async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || _pendingPrint == null) return;
  const id = _pendingPrint;
  setStatus('⏳ IA lendo o print…', 'var(--warn)');
  try {
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const r = await api.request('/api/v3/ia/ad_count', { method: 'POST', body: { id: Number(id), image: dataUrl } });
    if (r && r.ok) {
      const c = _conc.find(x => String(x.id) === String(id));
      if (c) { c.anuncios_count = r.count; if (r.dias_medio != null) c.anuncios_dias_medio = r.dias_medio; c.ultima_atualizacao = new Date().toISOString(); }
      renderContent();
      setStatus(`✅ ${(c && c.nome) || ''}: ${r.count} anúncios${r.dias_medio != null ? ' · ~' + r.dias_medio + 'd no ar' : ''}${r.saved === false ? ' (não salvou)' : ''}`, 'var(--ok)');
    } else {
      setStatus('⚠️ Não li' + (r && r.error ? ': ' + r.error : '') + '. Use um print nítido com "~X resultados".', 'var(--err)');
    }
  } catch (err) { setStatus('⚠️ Erro: ' + err.message, 'var(--err)'); }
}
