/* PSM-OS v2 — 🔍 Centro de Inteligência (v77.34, reconstruído).
   ANTES: KPIs de "anúncios ativos" (0) + tendências manuais (vazias) + banner
   "IA em breve" (vaporware). Ignorava os seguidores reais dos 46 concorrentes.
   AGORA: consolida 3 fontes REAIS — (1) landscape de concorrência por seguidores/
   tier/segmento; (2) seu tráfego Meta (invest/CPL/leads); (3) TENDÊNCIAS AUTOMÁTICAS
   calculadas do seu histórico Meta (CPL/investimento/leads mês a mês) + as manuais. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f$ = n => 'R$ ' + (Number(+n || 0) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fNum = n => (+n || 0).toLocaleString('pt-BR');
function parseFollowers(v) {
  if (v == null) return 0; if (typeof v === 'number') return v;
  const s = String(v).toLowerCase().replace(/\./g, '').replace(',', '.'); const m = parseFloat(s);
  if (isNaN(m)) return 0; if (s.includes('k') || s.includes('mil')) return Math.round(m * 1000);
  if (s.includes('m')) return Math.round(m * 1e6); return Math.round(m);
}

export async function pageIntelDash(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>'; return; }
  render();
  const [conc, hist, tend] = await Promise.all([
    api.request('/api/v3/concorrentes/list').catch(() => ({ concorrentes: [] })),
    api.request('/api/v3/marketing/history').catch(() => ({ meses: [] })),
    api.request('/api/v3/tendencias/list').catch(() => ({ tendencias: [] })),
  ]);
  renderContent(
    (conc.concorrentes || []).map(c => ({ ...c, _f: parseFollowers(c.seguidores) })),
    (hist && (hist.meses || hist.history)) || [],
    tend.tendencias || []
  );
}

function render() {
  _root.innerHTML = `
    <div class="card" style="background:var(--surface-2);color:#e2e8f0;padding:24px;min-height:80vh">
      <div class="flex" style="align-items:center;gap:14px;margin-bottom:20px">
        <span style="font-size:36px">🔍</span>
        <div>
          <h2 style="margin:0;color:#fff;font-size:26px">Centro de Inteligência</h2>
          <p style="margin:4px 0 0;color:var(--ink-muted);font-size:13px">Concorrência + seu tráfego + tendências calculadas dos seus dados</p>
        </div>
      </div>
      <div id="id-body"><div class="muted tiny" style="color:var(--ink-muted)"><span class="spinner"></span> Consolidando dados reais…</div></div>
    </div>`;
}

// Tendências AUTOMÁTICAS: compara o último mês com dado vs o anterior (Meta history).
function autoTrends(meses) {
  const com = (meses || []).filter(m => (+m.spend || 0) > 0);
  if (com.length < 2) return [];
  const ult = com[com.length - 1], pre = com[com.length - 2];
  const out = [];
  const mk = (titulo, atual, anterior, inverso) => {
    if (!anterior) return null;
    const d = (atual - anterior) / anterior * 100;
    if (Math.abs(d) < 3) return { titulo, direcao: 'estavel', impacto: 'baixo', delta: d, txt: 'estável vs mês anterior' };
    const subindo = d > 0;
    // inverso=true → subir é RUIM (ex.: CPL). impacto alto se |d|>20%.
    const ruim = inverso ? subindo : !subindo;
    return { titulo, direcao: subindo ? 'alta' : 'baixa', impacto: Math.abs(d) > 20 ? 'alto' : 'medio',
             delta: d, ruim, txt: `${subindo ? '+' : ''}${d.toFixed(0)}% vs mês anterior` };
  };
  const cplU = +ult.cpl || (ult.leads ? ult.spend / ult.leads : 0);
  const cplP = +pre.cpl || (pre.leads ? pre.spend / pre.leads : 0);
  [mk('CPL (custo por lead)', cplU, cplP, true),
   mk('Investimento em tráfego', +ult.spend, +pre.spend, false),
   mk('Volume de leads', +ult.leads, +pre.leads, false)].forEach(t => t && out.push(t));
  return out;
}

function renderContent(concorrentes, meses, tendManual) {
  const body = document.getElementById('id-body');
  const totalConc = concorrentes.length;
  const tierA = concorrentes.filter(c => (c.tier || '').toUpperCase() === 'A').length;
  const somaFollow = concorrentes.reduce((s, c) => s + c._f, 0);
  const top5 = [...concorrentes].sort((a, b) => b._f - a._f).slice(0, 5);

  const com = meses.filter(m => (+m.spend || 0) > 0);
  const ult = com[com.length - 1];
  const cpl = ult ? (+ult.cpl || (ult.leads ? ult.spend / ult.leads : 0)) : 0;
  const trends = autoTrends(meses);

  const corDir = t => t.direcao === 'estavel' ? '#64748b' : (t.ruim ? '#ef4444' : '#22c55e');
  const icoDir = t => t.direcao === 'alta' ? '📈' : t.direcao === 'baixa' ? '📉' : '➡️';

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:22px">
      ${card('🎯 Concorrentes', totalConc, '#806d50')}
      ${card('🏆 Tier A', tierA, '#f59e0b')}
      ${card('👥 Alcance somado', fNum(somaFollow), '#a855f7')}
      ${card('💰 Seu invest/mês', ult ? f$(ult.spend) : '—', '#22c55e')}
      ${card('📉 Seu CPL', ult ? f$(cpl) : '—', '#10b981')}
      ${card('🎯 Seus leads/mês', ult ? fNum(ult.leads) : '—', '#806d50')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);padding:18px">
        <h3 style="color:#fff;margin:0 0 6px;font-size:14px">📊 Tendências dos seus dados (Meta)</h3>
        <div class="tiny" style="color:var(--ink-muted);margin-bottom:10px">Calculadas automaticamente — último mês vs anterior.</div>
        ${trends.length === 0 ? '<div class="muted tiny" style="color:var(--ink-muted)">Preciso de ≥2 meses de Meta Ads pra calcular tendência. Abra Histórico Meta e atualize.</div>' :
          trends.map(t => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
              <span style="color:#fff;font-weight:600;font-size:13px">${icoDir(t)} ${esc(t.titulo)}</span>
              <span style="color:${corDir(t)};font-weight:600;font-size:13px">${esc(t.txt)}</span>
            </div>`).join('')}
      </div>

      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);padding:18px">
        <h3 style="color:#fff;margin:0 0 12px;font-size:14px">🥊 Maiores players (seguidores)</h3>
        ${top5.length === 0 ? '<div class="muted tiny">Sem dados.</div>' :
          top5.map((c, i) => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
              <span style="color:#fff;font-weight:600;font-size:13px">${i + 1}. ${esc(c.nome)}<span style="color:var(--ink-muted);font-size:11px"> · ${esc(c.tier || '—')}</span></span>
              <span style="color:var(--lilas);font-weight:600;font-size:13px">${c._f ? fNum(c._f) : '—'}</span>
            </div>`).join('')}
        <div class="mt-3 flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="location.hash='/intel-ads'">🎯 Guerra de Tráfego</button>
          <button class="btn btn-ghost btn-sm" onclick="location.hash='/concorrencia'">🥊 Radar</button>
          <button class="btn btn-ghost btn-sm" onclick="location.hash='/benchmark'">📊 Benchmark</button>
        </div>
      </div>
    </div>

    <div class="mt-4" style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);padding:18px">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="color:#fff;margin:0;font-size:14px">📝 Tendências de mercado (anotadas pela equipe)</h3>
        <button class="btn btn-ghost btn-sm" onclick="location.hash='/tendencias'">+ Gerenciar</button>
      </div>
      ${tendManual.length === 0
        ? '<div class="muted tiny" style="color:var(--ink-muted)">Nenhuma anotada ainda. Use a tela Tendências pra registrar movimentos do mercado (juros, lançamentos, comportamento) que a IA e a diretoria devem acompanhar.</div>'
        : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">` + tendManual.slice(0, 8).map(t => `
            <div style="padding:10px;background:var(--surface-2);border-left:3px solid ${t.impacto === 'alto' ? 'var(--err)' : t.impacto === 'medio' ? 'var(--warn)' : 'var(--border-strong)'};border-radius:var(--radius-sm)">
              <div style="color:#fff;font-weight:600;font-size:13px">${t.direcao === 'alta' ? '📈' : t.direcao === 'baixa' ? '📉' : '➡️'} ${esc(t.titulo)}</div>
              <div style="color:var(--ink-muted);font-size:11px;margin-top:2px">${esc(t.categoria || '—')}${t.descricao ? ' · ' + esc(String(t.descricao).slice(0, 70)) : ''}</div>
            </div>`).join('') + `</div>`}
    </div>`;
}

function card(label, value, color) {
  return `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;border-left:4px solid ${color}">
    <div style="color:var(--ink-muted);font-size:11px;text-transform:uppercase;font-weight:600;margin-bottom:6px">${label}</div>
    <div style="color:${color};font-size:26px;font-weight:600">${value}</div></div>`;
}
