/* PSM-OS v2 — 🏙 Mercado · Visão geral (v88.82, ex-Landscape do Centro de Inteligência)
   Consolida o que é REAL e automático:
     (1) o que o Vigia leu da concorrência (análise diária por IA — gestor_vigia);
     (2) volume de anúncios do mercado (coleta diária da Biblioteca do Meta — ad_library);
     (3) seu tráfego Meta e a tendência mês × mês (marketing/history);
     (4) os maiores players da base única (concorrentes);
     (5) v88.86: indicadores do Banco Central (Selic, IPCA, INCC-DI, TR, poupança) — /intel/indicadores.
   A lista manual de Tendências (0 registros em 4 meses) foi aposentada. Só sócio (hub). */
import { api } from '../api.js';

let _root = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f$ = n => 'R$ ' + (Number(+n || 0) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fNum = n => (+n || 0).toLocaleString('pt-BR');
const fDT = s => { try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
function parseFollowers(v) {
  if (v == null) return 0; if (typeof v === 'number') return v;
  const s = String(v).toLowerCase().replace(/\./g, '').replace(',', '.'); const m = parseFloat(s);
  if (isNaN(m)) return 0; if (s.includes('k') || s.includes('mil')) return Math.round(m * 1000);
  if (s.includes('m')) return Math.round(m * 1e6); return Math.round(m);
}

export async function pageIntelDash(ctx, root) {
  _root = root;
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Consolidando concorrência, anúncios e seu tráfego…</div></div>`;
  const [conc, hist, lib, vigia, ind] = await Promise.all([
    api.request('/api/v3/concorrentes/list').catch(() => ({ concorrentes: [] })),
    api.request('/api/v3/marketing/history').catch(() => ({ meses: [] })),
    api.request('/api/v3/marketing/ad_library').catch(() => ({})),
    api.request('/api/v3/marketing/gestor_vigia').catch(() => ({})),
    api.request('/api/v3/intel/indicadores').catch(() => ({})),
  ]);
  renderContent(
    (conc.concorrentes || []).map(c => ({ ...c, _f: parseFollowers(c.seguidores) })),
    (hist && (hist.meses || hist.history)) || [],
    lib || {},
    vigia || {},
    ind || {}
  );
}

// Tendências AUTOMÁTICAS: último mês com gasto vs o anterior (Meta history).
function autoTrends(meses) {
  const com = (meses || []).filter(m => (+m.spend || 0) > 0);
  if (com.length < 2) return [];
  const ult = com[com.length - 1], pre = com[com.length - 2];
  const mk = (titulo, atual, anterior, inverso) => {
    if (!anterior) return null;
    const d = (atual - anterior) / anterior * 100;
    if (Math.abs(d) < 3) return { titulo, direcao: 'estavel', txt: 'estável vs mês anterior' };
    const subindo = d > 0;
    return { titulo, direcao: subindo ? 'alta' : 'baixa', ruim: inverso ? subindo : !subindo,
             txt: `${subindo ? '+' : ''}${d.toFixed(0)}% vs mês anterior` };
  };
  const cplU = +ult.cpl || (ult.leads ? ult.spend / ult.leads : 0);
  const cplP = +pre.cpl || (pre.leads ? pre.spend / pre.leads : 0);
  return [mk('CPL (custo por lead)', cplU, cplP, true),
          mk('Investimento em tráfego', +ult.spend, +pre.spend, false),
          mk('Volume de leads', +ult.leads, +pre.leads, false)].filter(Boolean);
}

function renderContent(concorrentes, meses, lib, vigia, ind) {
  const tierA = concorrentes.filter(c => (c.tier || '').toUpperCase() === 'A').length;
  const top5 = [...concorrentes].sort((a, b) => b._f - a._f).slice(0, 5);
  const com = meses.filter(m => (+m.spend || 0) > 0);
  const ult = com[com.length - 1];
  const cpl = ult ? (+ult.cpl || (ult.leads ? ult.spend / ult.leads : 0)) : 0;
  const trends = autoTrends(meses);
  const insights = (vigia.insights || []).slice(0, 4);
  const ultimaColeta = (lib.latest || []).reduce((m, s) => (s.captured_at > m ? s.captured_at : m), '');

  const corDir = t => t.direcao === 'estavel' ? 'var(--ink-muted)' : (t.ruim ? 'var(--err)' : 'var(--ok)');
  const icoDir = t => t.direcao === 'alta' ? '📈' : t.direcao === 'baixa' ? '📉' : '➡️';
  const box = 'background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px';

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔍 Visão geral do mercado</h2>
      <p class="card-sub">O que o Vigia leu da concorrência, o volume de anúncios do mercado e o seu tráfego — tudo coletado automaticamente.</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px">
        ${card('Concorrentes', fNum(concorrentes.length), `${tierA} no Tier A`)}
        ${card('Anúncios ativos (mercado)', fNum(lib.total_ads || 0), `${fNum(lib.total_concorrentes || 0)} anunciantes${ultimaColeta ? ' · coleta ' + fDT(ultimaColeta) : ''}`)}
        ${card('Seu investimento/mês', ult ? f$(ult.spend) : '—', 'Meta Ads, último mês')}
        ${card('Seu CPL', ult ? f$(cpl) : '—', ult ? fNum(ult.leads) + ' leads no mês' : '')}
      </div>

      ${indicadores(ind, box)}

      <div style="${box};margin-top:14px">
        <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
          <h3 class="card-title" style="font-size:14px;margin:0">🕵️ Últimos movimentos da concorrência</h3>
          <span class="tiny muted">Vigia${vigia.last_run && vigia.last_run.ts ? ' · última leitura ' + fDT(vigia.last_run.ts) : ''}</span>
          <button class="btn btn-ghost btn-sm" data-go="ads" style="margin-left:auto">Ver anúncios →</button>
        </div>
        ${insights.length ? insights.map(i => `
          <div style="padding:10px 0;border-top:1px solid var(--border)">
            <div class="flex items-center gap-2"><b style="font-size:13px">${esc(i.titulo)}</b><span class="tiny muted" style="margin-left:auto">${fDT(i.ts)}</span></div>
            ${i.insight ? `<div style="font-size:13px;line-height:1.5;margin-top:3px">${esc(i.insight)}</div>` : ''}
            ${(i.acoes || []).length ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;line-height:1.5">${i.acoes.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          </div>`).join('')
          : '<div class="tiny muted">O Vigia ainda não publicou leituras.</div>'}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px">
        <div style="${box}">
          <h3 class="card-title" style="font-size:14px;margin:0 0 4px">📊 Seu tráfego mês a mês</h3>
          <div class="tiny muted" style="margin-bottom:8px">Calculado do histórico do Meta — último mês vs anterior.</div>
          ${trends.length === 0 ? '<div class="tiny muted">São precisos 2 meses de Meta Ads com gasto para comparar.</div>' :
            trends.map(t => `
              <div class="flex" style="justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--border)">
                <span style="font-weight:600;font-size:13px">${icoDir(t)} ${esc(t.titulo)}</span>
                <span style="color:${corDir(t)};font-weight:600;font-size:13px">${esc(t.txt)}</span>
              </div>`).join('')}
        </div>
        <div style="${box}">
          <div class="flex items-center" style="margin-bottom:8px">
            <h3 class="card-title" style="font-size:14px;margin:0">🥊 Maiores players (seguidores)</h3>
            <button class="btn btn-ghost btn-sm" data-go="radar" style="margin-left:auto">Radar →</button>
          </div>
          ${top5.length === 0 ? '<div class="tiny muted">Sem concorrentes na base.</div>' :
            top5.map((c, i) => `
              <div class="flex" style="justify-content:space-between;padding:7px 0;border-top:1px solid var(--border)">
                <span style="font-weight:600;font-size:13px">${i + 1}. ${esc(c.nome)}<span class="tiny muted"> · Tier ${esc(c.tier || '—')}${c.anuncios_count ? ' · ' + fNum(c.anuncios_count) + ' anúncios' : ''}</span></span>
                <span style="font-weight:600;font-size:13px">${c._f ? fNum(c._f) : '—'}</span>
              </div>`).join('')}
        </div>
      </div>
    </div>`;
  _root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { location.hash = '#/concorrencia?tab=' + b.dataset.go; }));
}

// v88.86: juros, inflação e custo de obra — os números que mexem no financiamento e no preço da planta
function indicadores(ind, box) {
  const itens = (ind && ind.itens) || [];
  if (!itens.length) return `<div style="${box};margin-top:14px" class="tiny muted">🏦 Indicadores do Banco Central indisponíveis agora.</div>`;
  const fmt = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dRef = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}`; };
  return `<div style="${box};margin-top:14px">
    <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:8px">
      <h3 class="card-title" style="font-size:14px;margin:0">🏦 Indicadores do mercado</h3>
      <span class="tiny muted">Banco Central (SGS) · atualiza sozinho${ind.stale ? ' · BC fora do ar, mostrando o último valor' : ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      ${itens.map(i => `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:10px 12px" title="${esc(i.nota || '')}">
        <div class="tiny muted" style="font-weight:600">${esc(i.label)}</div>
        <div style="font-size:18px;font-weight:600;margin-top:2px">${fmt(i.valor)}<span class="tiny muted" style="font-weight:400"> ${esc(i.unidade)}</span></div>
        <div class="tiny muted">ref. ${dRef(i.ref)}${i.anterior ? ' · valor anterior' : ''}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

function card(label, value, sub) {
  return `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:12px 14px">
    <div class="tiny muted" style="font-weight:600">${label}</div>
    <div style="font-size:22px;font-weight:600;margin-top:2px">${value}</div>
    ${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
}
