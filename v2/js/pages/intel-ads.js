/* PSM-OS v2 — 🎯 Inteligência de Ads / Guerra de Tráfego (v77.33, reconstruído).
   ANTES: tela morta que só mostrava anuncios_count (sempre 0, depende de print manual).
   AGORA: cruza os SEUS números reais de anúncio (Meta Ads, via /marketing/history)
   com a presença dos concorrentes (seguidores reais + deep-links que funcionam +
   contagem opcional por print). Honesto: a Biblioteca do Meta não expõe anúncios
   imobiliários por API no BR, então o nº de anúncios do concorrente é manual/print —
   mas a tela já entrega valor SEM isso (seus KPIs + espionagem 1-clique). */
import { api } from '../api.js';

let _root = null, _concorrentes = [], _meu = null, _segFilter = 'all', _pendingPrint = null;
const SEGMENTOS = ['all', 'MAP', 'MCMV', 'Terceiros', 'Locacao'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f$ = n => 'R$ ' + Math.round(+n || 0).toLocaleString('pt-BR');
const fNum = n => (+n || 0).toLocaleString('pt-BR');
function parseFollowers(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).toLowerCase().replace(/\./g, '').replace(',', '.');
  const m = parseFloat(s);
  if (isNaN(m)) return 0;
  if (s.includes('k') || s.includes('mil')) return Math.round(m * 1000);
  if (s.includes('m')) return Math.round(m * 1000000);
  return Math.round(m);
}
function igUrl(handle) {
  const u = String(handle || '').trim().replace(/^@/, '').split('?')[0];
  return u ? 'https://instagram.com/' + encodeURIComponent(u) : null;
}
function adLibUrl(name) {
  return 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q='
    + encodeURIComponent((name || '').replace(/[&]/g, '')) + '&search_type=keyword_unordered';
}
function fmtDate(s) { try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } }

export async function pageIntelAds(ctx, root) {
  _root = root;
  render(true);
  const [conc, hist] = await Promise.all([
    api.request('/api/v3/concorrentes/list').catch(() => ({ concorrentes: [] })),
    api.request('/api/v3/marketing/history').catch(() => ({ meses: [] })),
  ]);
  _concorrentes = (conc.concorrentes || []).map(c => ({ ...c, _follow: parseFollowers(c.seguidores), anuncios_count: +(c.anuncios_count || 0) }));
  _meu = computeMeu(hist);
  render(false);
}

function computeMeu(hist) {
  const meses = (hist && (hist.meses || hist.history)) || [];
  const comDado = meses.filter(m => (+m.spend || 0) > 0);
  if (!comDado.length) return null;
  const ult = comDado[comDado.length - 1];
  const n = comDado.length;
  const soma = comDado.reduce((a, m) => ({ spend: a.spend + (+m.spend || 0), leads: a.leads + (+m.leads || 0) }), { spend: 0, leads: 0 });
  return {
    mes_spend: +ult.spend || 0, mes_leads: +ult.leads || 0, mes_cpl: +ult.cpl || (ult.leads ? ult.spend / ult.leads : 0),
    mes_ref: (ult.mes ? String(ult.mes).padStart(2, '0') + '/' + ult.ano : ''),
    media_spend: soma.spend / n, media_leads: Math.round(soma.leads / n),
    media_cpl: soma.leads ? soma.spend / soma.leads : 0,
    top_campaign: ult.top_campaign || '', meses_n: n,
  };
}

function render(loading) {
  if (!_root) return;
  _root.innerHTML = `
    <div class="card" style="background:#0b1120;color:#e2e8f0;padding:22px;min-height:80vh">
      <div class="flex" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:6px">
        <div class="flex" style="align-items:center;gap:14px">
          <span style="font-size:34px">🎯</span>
          <div>
            <h2 style="margin:0;color:#fff;font-size:22px">Inteligência de Ads — Guerra de Tráfego</h2>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">Seus números de anúncio (Meta) × presença dos concorrentes. Espionagem em 1 clique.</p>
          </div>
        </div>
        <a href="https://www.facebook.com/ads/library/?country=BR&ad_type=all&active_status=active" target="_blank" rel="noopener" class="btn" style="background:#d4af37;color:#0a1628;font-weight:700">🔗 Meta Ads Library</a>
      </div>
      <div id="ads-body">${loading ? '<div class="muted tiny" style="color:#94a3b8;padding:20px"><span class="spinner"></span> Carregando seus números + concorrentes…</div>' : ''}</div>
    </div>`;
  if (!loading) renderContent();
}

function kpi(label, value, color, sub) {
  return `<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px">
    <div style="color:#64748b;font-size:10px;text-transform:uppercase;font-weight:700;margin-bottom:4px">${label}</div>
    <div style="color:${color};font-size:21px;font-weight:800">${value}</div>
    ${sub ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(sub)}</div>` : ''}</div>`;
}
function tierColor(t) { return t === 'A' ? '#f59e0b' : t === 'B' ? '#3b82f6' : '#64748b'; }

function renderContent() {
  const body = document.getElementById('ads-body');
  const filtered = _segFilter === 'all' ? _concorrentes : _concorrentes.filter(c => (c.segmento || '').toLowerCase() === _segFilter.toLowerCase());
  filtered.sort((a, b) => (b._follow - a._follow) || (b.anuncios_count - a.anuncios_count));
  const comAds = filtered.filter(c => c.anuncios_count > 0).length;
  const somaFollow = filtered.reduce((s, c) => s + c._follow, 0);
  const top = filtered[0];

  // ── Bloco VOCÊ (PSM) — dados reais do Meta ──
  const meu = _meu;
  const meuBloco = meu ? `
    <div style="background:linear-gradient(135deg,#16a34a22,transparent);border:1px solid #16a34a55;border-radius:12px;padding:16px;margin-bottom:18px">
      <div style="color:#22c55e;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🟢 VOCÊ (PSM) — Meta Ads ${meu.mes_ref ? '· ' + meu.mes_ref : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${kpi('💰 Investimento/mês', f$(meu.mes_spend), '#22c55e', 'média ' + f$(meu.media_spend))}
        ${kpi('🎯 Leads/mês', fNum(meu.mes_leads), '#3b82f6', 'média ' + fNum(meu.media_leads))}
        ${kpi('📉 CPL', f$(meu.mes_cpl), '#f59e0b', 'média ' + f$(meu.media_cpl))}
        ${kpi('🏆 Top campanha', (meu.top_campaign || '—').slice(0, 22) + (meu.top_campaign && meu.top_campaign.length > 22 ? '…' : ''), '#d4af37', meu.meses_n + ' meses de dado')}
      </div>
    </div>` : `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:18px;color:#94a3b8;font-size:13px">
      ⚠️ Sem dados do seu Meta Ads ainda — abra <b>Histórico Meta</b> e clique "Atualizar agora" pra puxar investimento/leads/CPL reais e comparar com os concorrentes aqui.
    </div>`;

  body.innerHTML = `
    ${meuBloco}

    <div class="tiny" style="color:#cbd5e1;margin-bottom:12px;background:#1e293b;padding:9px 12px;border-radius:8px;border-left:3px solid #d4af37">
      📷 <b>Nº de anúncios do concorrente é manual:</b> a Biblioteca do Meta não libera anúncios imobiliários por API no BR. Clique <b>🔗</b> na linha pra ver os anúncios dele agora, ou <b>📷</b> pra mandar um print e a IA contar. <span id="ads-status" style="font-weight:700;margin-left:6px"></span>
    </div>

    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      ${SEGMENTOS.map(s => `<button class="btn btn-sm ${_segFilter === s ? 'btn-primary' : 'btn-ghost'}" data-seg="${s}" style="font-size:12px">${s === 'all' ? '🌐 Todos' : s}</button>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px">
      ${kpi('Concorrentes', filtered.length, '#3b82f6', 'monitorados em RP')}
      ${kpi('Alcance somado', fNum(somaFollow), '#a855f7', 'seguidores no Instagram')}
      ${kpi('Maior player', top ? fNum(top._follow) : '—', '#d4af37', top ? top.nome : '')}
      ${kpi('Com anúncios contados', comAds + '/' + filtered.length, '#22c55e', 'via print/IA')}
    </div>

    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#1e293b;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#0f172a">
        <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px">#</th>
        <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px">CONCORRENTE</th>
        <th style="padding:10px;text-align:center;color:#d4af37;font-size:11px">TIER</th>
        <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px">SEGMENTO</th>
        <th style="padding:10px;text-align:right;color:#d4af37;font-size:11px">SEGUIDORES</th>
        <th style="padding:10px;text-align:right;color:#d4af37;font-size:11px">ANÚNCIOS</th>
        <th style="padding:10px;text-align:center;color:#d4af37;font-size:11px">ESPIONAR</th>
      </tr></thead>
      <tbody>
        ${filtered.map((c, i) => {
          const ig = igUrl(c.handle);
          return `<tr style="border-bottom:1px solid #334155">
            <td style="padding:8px 10px;color:#94a3b8">${i + 1}</td>
            <td style="padding:8px 10px;color:#fff;font-weight:600">${esc(c.nome || '—')}${c.handle ? `<div style="font-size:10px;color:#94a3b8">${esc(c.handle)}</div>` : ''}</td>
            <td style="padding:8px 10px;text-align:center"><span style="padding:2px 8px;border-radius:4px;background:${tierColor(c.tier)};color:#fff;font-size:11px;font-weight:700">${esc(c.tier || '—')}</span></td>
            <td style="padding:8px 10px;color:#94a3b8">${esc(c.segmento || '—')}</td>
            <td style="padding:8px 10px;text-align:right;color:#e2e8f0;font-weight:700">${c._follow ? fNum(c._follow) : '—'}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:800;color:${c.anuncios_count > 0 ? '#22c55e' : '#475569'}">${c.anuncios_count || '—'}${c.ultima_atualizacao && c.anuncios_count ? `<div class="tiny" style="font-weight:400;color:#64748b">${fmtDate(c.ultima_atualizacao)}</div>` : ''}</td>
            <td style="padding:8px 10px;text-align:center;white-space:nowrap">
              ${ig ? `<a href="${ig}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" title="Ver Instagram" style="font-size:11px">📸</a>` : ''}
              <a href="${adLibUrl(c.nome)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" title="Ver anúncios na Biblioteca Meta" style="font-size:11px">🔗</a>
              <button class="btn btn-ghost btn-sm" data-print="${c.id}" title="Contar anúncios por print (IA)" style="font-size:11px">📷</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
    <input type="file" accept="image/*" id="ads-file" style="display:none">`;

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
  setStatus('⏳ IA lendo o print…', '#f59e0b');
  try {
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const r = await api.request('/api/v3/ia/ad_count', { method: 'POST', body: { id: Number(id), image: dataUrl } });
    if (r && r.ok) {
      const c = _concorrentes.find(x => String(x.id) === String(id));
      if (c) { c.anuncios_count = r.count; c.ultima_atualizacao = new Date().toISOString(); }
      renderContent();
      setStatus(`✅ ${(c && c.nome) || ''}: ${r.count} anúncios${r.saved === false ? ' (não salvou no banco)' : ''}`, '#22c55e');
    } else {
      setStatus('⚠️ Não li o número' + (r && r.error ? ': ' + r.error : '') + '. Print nítido com o "~X resultados".', '#ef4444');
    }
  } catch (err) { setStatus('⚠️ Erro: ' + err.message, '#ef4444'); }
}
