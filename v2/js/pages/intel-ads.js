/* PSM-OS v2 — 🎯 Raio-X de Anúncios dos Concorrentes (v77.35).
   Foco 100% no CONCORRENTE (Paulo: "não quero meus dados aqui, quero o volume de
   anúncios ativos dos concorrentes, média de investimento e tempo de anúncio ativo").
   REALIDADE (honesta): a Biblioteca do Meta não expõe anúncios imobiliários por API
   no BR — só por PRINT + IA. E o Meta NÃO publica o gasto de anúncio comercial; então:
     • Anúncios ativos (volume)  → REAL, lido do print pela IA.
     • Tempo médio ativo (dias)  → REAL, da data "Veiculação iniciada em" de cada anúncio.
     • Investimento/mês          → ESTIMATIVA transparente = volume × premissa de custo
                                    que VOCÊ define (Meta não dá o número real). */
import { api } from '../api.js';

let _root = null, _conc = [], _segFilter = 'all', _pendingPrint = null;
const SEGMENTOS = ['all', 'MAP', 'MCMV', 'Terceiros', 'Locacao'];
const PREMISSA_KEY = 'psm.intelads.premissa_mes';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f$ = n => 'R$ ' + Math.round(+n || 0).toLocaleString('pt-BR');
const fNum = n => (+n || 0).toLocaleString('pt-BR');
const premissa = () => Math.max(0, parseInt(localStorage.getItem(PREMISSA_KEY) || '1500') || 1500);
function adLibUrl(name) {
  return 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q='
    + encodeURIComponent((name || '').replace(/[&]/g, '')) + '&search_type=keyword_unordered';
}
function fmtDate(s) { try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } }
function investOf(c) { return (c.investimento_estimado != null && c.investimento_estimado !== '') ? { v: +c.investimento_estimado, manual: true } : { v: (+c.anuncios_count || 0) * premissa(), manual: false }; }

export async function pageIntelAds(ctx, root) {
  _root = root;
  render(true);
  const r = await api.request('/api/v3/concorrentes/list').catch(() => ({ concorrentes: [] }));
  _conc = (r.concorrentes || []).map(c => ({ ...c, anuncios_count: +(c.anuncios_count || 0) }));
  render(false);
}

function render(loading) {
  if (!_root) return;
  _root.innerHTML = `
    <div class="card" style="background:#0b1120;color:#e2e8f0;padding:22px;min-height:80vh">
      <div class="flex" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:6px">
        <div class="flex" style="align-items:center;gap:14px">
          <span style="font-size:34px">🎯</span>
          <div>
            <h2 style="margin:0;color:#fff;font-size:22px">Raio-X de Anúncios dos Concorrentes</h2>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">Quem está anunciando, quantos anúncios, há quanto tempo e investimento estimado.</p>
          </div>
        </div>
        <a href="https://www.facebook.com/ads/library/?country=BR&ad_type=all&active_status=active" target="_blank" rel="noopener" class="btn" style="background:#fffbea;color:#0a1628;font-weight:700">🔗 Meta Ads Library</a>
      </div>
      <div id="ads-body">${loading ? '<div class="muted tiny" style="color:#94a3b8;padding:20px"><span class="spinner"></span> Carregando concorrentes…</div>' : ''}</div>
    </div>`;
  if (!loading) renderContent();
}

function kpi(label, value, color, sub) {
  return `<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px">
    <div style="color:#64748b;font-size:10px;text-transform:uppercase;font-weight:700;margin-bottom:4px">${label}</div>
    <div style="color:${color};font-size:21px;font-weight:800">${value}</div>
    ${sub ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(sub)}</div>` : ''}</div>`;
}
const tierColor = t => t === 'A' ? '#f59e0b' : t === 'B' ? '#3b82f6' : '#64748b';

function renderContent() {
  const body = document.getElementById('ads-body');
  const filtered = _segFilter === 'all' ? _conc : _conc.filter(c => (c.segmento || '').toLowerCase() === _segFilter.toLowerCase());
  filtered.sort((a, b) => (b.anuncios_count - a.anuncios_count) || (b.investimento_estimado || 0) - (a.investimento_estimado || 0));

  const comAds = filtered.filter(c => c.anuncios_count > 0);
  const totalAds = comAds.reduce((s, c) => s + c.anuncios_count, 0);
  const top = comAds[0];
  const diasVals = filtered.map(c => +c.anuncios_dias_medio).filter(v => v > 0);
  const tempoMedio = diasVals.length ? Math.round(diasVals.reduce((a, b) => a + b, 0) / diasVals.length) : null;
  const investTotal = filtered.reduce((s, c) => s + investOf(c).v, 0);
  const capturados = comAds.length;

  body.innerHTML = `
    <div class="tiny" style="color:#cbd5e1;margin-bottom:12px;background:#1e293b;padding:10px 12px;border-radius:8px;border-left:3px solid #fffbea;line-height:1.6">
      📡 <b>Como ler:</b> <b>Anúncios</b> e <b>tempo ativo</b> são REAIS (lidos da Biblioteca do Meta por print+IA — clique <b>📷</b> na linha). O Meta <b>não publica</b> o gasto de anúncio imobiliário no BR, então <b>Investimento/mês é ESTIMATIVA</b> = nº de anúncios × sua premissa de custo.
      <span style="display:inline-flex;align-items:center;gap:6px;margin-left:8px">💰 Premissa por anúncio/mês: R$ <input id="ia-prem" type="number" value="${premissa()}" style="width:90px;background:#0b1120;border:1px solid #334155;color:#fff;border-radius:6px;padding:3px 6px;font-size:12px"></span>
      <span id="ads-status" style="font-weight:700;margin-left:8px"></span>
    </div>

    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      ${SEGMENTOS.map(s => `<button class="btn btn-sm ${_segFilter === s ? 'btn-primary' : 'btn-ghost'}" data-seg="${s}" style="font-size:12px">${s === 'all' ? '🌐 Todos' : s}</button>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px">
      ${kpi('📢 Anúncios ativos (mercado)', fNum(totalAds), '#22c55e', capturados + ' concorrentes mapeados')}
      ${kpi('🔥 Mais agressivo', top ? fNum(top.anuncios_count) : '—', '#ef4444', top ? top.nome : 'capture um print')}
      ${kpi('⏱ Tempo médio ativo', tempoMedio != null ? tempoMedio + ' dias' : '—', '#3b82f6', 'campanhas no ar')}
      ${kpi('💰 Investimento estimado/mês', f$(investTotal), '#fffbea', '≈ volume × premissa')}
    </div>

    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#1e293b;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#0f172a">
        <th style="padding:10px;text-align:left;color:#fffbea;font-size:11px">#</th>
        <th style="padding:10px;text-align:left;color:#fffbea;font-size:11px">CONCORRENTE</th>
        <th style="padding:10px;text-align:center;color:#fffbea;font-size:11px">TIER</th>
        <th style="padding:10px;text-align:left;color:#fffbea;font-size:11px">SEGMENTO</th>
        <th style="padding:10px;text-align:right;color:#fffbea;font-size:11px">ANÚNCIOS</th>
        <th style="padding:10px;text-align:right;color:#fffbea;font-size:11px">TEMPO ATIVO</th>
        <th style="padding:10px;text-align:right;color:#fffbea;font-size:11px">INVEST./MÊS (≈)</th>
        <th style="padding:10px;text-align:center;color:#fffbea;font-size:11px">ESPIONAR</th>
      </tr></thead>
      <tbody>
        ${filtered.map((c, i) => {
          const inv = investOf(c);
          return `<tr style="border-bottom:1px solid #334155">
            <td style="padding:8px 10px;color:#94a3b8">${i + 1}</td>
            <td style="padding:8px 10px;color:#fff;font-weight:600">${esc(c.nome || '—')}${c.handle ? `<div style="font-size:10px;color:#94a3b8">${esc(c.handle)}</div>` : ''}</td>
            <td style="padding:8px 10px;text-align:center"><span style="padding:2px 8px;border-radius:4px;background:${tierColor(c.tier)};color:#fff;font-size:11px;font-weight:700">${esc(c.tier || '—')}</span></td>
            <td style="padding:8px 10px;color:#94a3b8">${esc(c.segmento || '—')}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:800;color:${c.anuncios_count > 0 ? '#22c55e' : '#475569'}">${c.anuncios_count || '—'}${c.ultima_atualizacao && c.anuncios_count ? `<div class="tiny" style="font-weight:400;color:#64748b">${fmtDate(c.ultima_atualizacao)}</div>` : ''}</td>
            <td style="padding:8px 10px;text-align:right;color:${c.anuncios_dias_medio ? '#e2e8f0' : '#475569'}">${c.anuncios_dias_medio ? Math.round(c.anuncios_dias_medio) + 'd' : '—'}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:${inv.v ? '#fffbea' : '#475569'}">${inv.v ? '≈ ' + f$(inv.v) : '—'}${inv.manual ? '<div class="tiny" style="font-weight:400;color:#64748b">manual</div>' : ''}</td>
            <td style="padding:8px 10px;text-align:center;white-space:nowrap">
              <a href="${adLibUrl(c.nome)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" title="Ver anúncios na Biblioteca Meta" style="font-size:11px">🔗</a>
              <button class="btn btn-ghost btn-sm" data-print="${c.id}" title="Contar anúncios + tempo por print (IA)" style="font-size:11px">📷</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
    <input type="file" accept="image/*" id="ads-file" style="display:none">`;

  const prem = document.getElementById('ia-prem');
  if (prem) prem.addEventListener('change', () => { localStorage.setItem(PREMISSA_KEY, String(Math.max(0, parseInt(prem.value) || 0))); renderContent(); });
  body.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { _segFilter = b.dataset.seg; renderContent(); }));
  body.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => startPrint(b.dataset.print)));
  const fi = document.getElementById('ads-file');
  if (fi) fi.addEventListener('change', onFile);
}

function setStatus(msg, color) { const s = document.getElementById('ads-status'); if (s) { s.textContent = msg || ''; s.style.color = color || '#22c55e'; } }
function startPrint(id) { _pendingPrint = id; const f = document.getElementById('ads-file'); if (f) { f.value = ''; f.click(); } }
async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || _pendingPrint == null) return;
  const id = _pendingPrint;
  setStatus('⏳ IA lendo o print (volume + tempo)…', '#f59e0b');
  try {
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const r = await api.request('/api/v3/ia/ad_count', { method: 'POST', body: { id: Number(id), image: dataUrl } });
    if (r && r.ok) {
      const c = _conc.find(x => String(x.id) === String(id));
      if (c) { c.anuncios_count = r.count; if (r.dias_medio != null) c.anuncios_dias_medio = r.dias_medio; c.ultima_atualizacao = new Date().toISOString(); }
      renderContent();
      setStatus(`✅ ${(c && c.nome) || ''}: ${r.count} anúncios${r.dias_medio != null ? ' · ~' + r.dias_medio + 'd ativos' : ''}${r.saved === false ? ' (não salvou)' : ''}`, '#22c55e');
    } else {
      setStatus('⚠️ Não li' + (r && r.error ? ': ' + r.error : '') + '. Print nítido com "~X resultados".', '#ef4444');
    }
  } catch (err) { setStatus('⚠️ Erro: ' + err.message, '#ef4444'); }
}
