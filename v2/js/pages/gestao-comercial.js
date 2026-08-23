/* PSM-OS v2 — 📊 GESTÃO COMERCIAL (v86.61 — reforma "bússola", pedido do Paulo 23/ago)
   Abre no COCKPIT ("como está nosso mês?": vendas × meta, VGV, projeção, CAC +
   semáforo por equipe + alertas como ações) e desce em 4 abas:
     🎯 Meta & Projeção · ⏬ Funil · 💰 Mídia & Custo · 👤 Pessoas
   (as 9 abas antigas foram absorvidas — Gráficos morreu: cada aba já é visual).
   Paleta SEMÂNTICA fixa: verde = no ritmo/bateu · âmbar = atenção · vermelho =
   fora da régua · azul = projetado. Equipes se distinguem por rótulo, não por cor.
   Filtro de equipe no topo (sócio vê todas; gerente lvl<10 já chega filtrado do
   backend — filtra_escopo — e o chip mostra só a dele). 1 análise do 🧠 Sr.
   Performance por aba (era 1 por quadro). Notas explicativas ficam escondidas
   atrás do botão ⓘ. Modo TV = mesmo layout em tela cheia (gráficos consertados:
   antes desenhavam no canvas escondido da página e a TV ficava em branco). */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { loadChartLib } from '../premium.js';

let _root = null, _d = null, _v = null, _tab = 'meta', _team = null, _busy = false, _notas = false;
let _since = null, _until = null, _spendPreset = 'this_month';
let _tv = false, _tvRotate = true, _tvTimer = null, _tvDataTimer = null, _tvTickTimer = null, _tvNextAt = 0;
const TV_ROT_MS = 20000, TV_REFRESH_MS = 300000;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fN = v => { const x = Number(v) || 0; return Number.isInteger(x) ? x.toLocaleString('pt-BR') : x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
const kR$ = v => { const n = Number(v) || 0, a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M'; if (a >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'; return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesNome = ym => { const m = parseInt(String(ym).slice(5, 7), 10); return MESES_NOME[m - 1] || ym; };
const fmtDHM = h => {
  if (h == null) return '—';
  const tot = Math.max(0, Math.round(h * 60)), d = Math.floor(tot / 1440), hh = Math.floor((tot % 1440) / 60), mm = tot % 60;
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d)}d ${p2(hh)}h ${p2(mm)}min`;
};
const TEAM_LBL = { conquista: '🏠 Conquista', map: '🏢 MAP', terceiros: '🤝 Terceiros', locacao: '🔑 Locação', outros: '— Outros' };
const TEAMS4 = ['conquista', 'map', 'terceiros', 'locacao'];
const tLbl = t => (TEAM_LBL[t] || t || '').replace(/^..\s/, '');
const GC_TABS = [['meta', '🎯 Meta & Projeção'], ['funil', '⏬ Funil'], ['midia', '💰 Mídia & Custo'], ['pessoas', '👤 Pessoas']];

/* ═══════════ CSS do módulo (paleta semântica + layout) — injetado 1× ═══════════ */
const GC_CSS = `
.gc{--gc-ok:#22c55e;--gc-warn:#f59e0b;--gc-err:#ef4444;--gc-acc:#60a5fa;--gc-acc2:#a78bfa;--gc-acc-dim:#1d4ed8;font-variant-numeric:tabular-nums}
:root:not(.dark) .gc{--gc-ok:#16a34a;--gc-warn:#d97706;--gc-err:#dc2626;--gc-acc:#2563eb;--gc-acc2:#7c3aed;--gc-acc-dim:#1e3a8a}
.gc .gc-nota{display:none}.gc.notas .gc-nota{display:block}
.gc .gc-pan{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px;margin-top:12px}
.gc .gc-pan-t{font-weight:800;font-size:13px;margin-bottom:10px;letter-spacing:.01em}
.gc table{width:100%;border-collapse:collapse}.gc th{font-weight:600;font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em;padding:4px 8px}
.gc td{padding:5px 8px;border-top:1px solid var(--border);font-size:12.5px}
.gc tbody tr:hover td{background:color-mix(in srgb,var(--ink) 4%,transparent)}
.gc .gc-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gc .gc-chip{border:1px solid var(--border-2);background:transparent;color:var(--ink-2);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer}
.gc .gc-chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.gc .gc-tabs{display:flex;gap:4px;margin-top:14px;border-bottom:1px solid var(--border)}
.gc .gc-tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--ink-muted);padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:-1px}
.gc .gc-tab.on{color:var(--ink);border-bottom-color:var(--gc-acc)}
.gc .gc-q{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:14px}
.gc .gc-q h3{margin:0;font-size:20px;font-weight:900;letter-spacing:-.01em}
.gc .gc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:10px}
.gc .gc-kpi{background:var(--bg-2);border:1px solid var(--border);border-left:4px solid var(--kc,var(--border-2));border-radius:var(--r-md);padding:12px 14px;min-width:0}
.gc .gc-kpi .l{font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.gc .gc-kpi .v{font-size:30px;font-weight:900;line-height:1.1;margin-top:4px;white-space:nowrap}
.gc .gc-kpi .v small{font-size:14px;font-weight:600;color:var(--ink-muted)}
.gc .gc-kpi .s{font-size:12px;color:var(--ink-2);margin-top:4px}
.gc .gc-bar{height:6px;background:var(--bg-3);border-radius:4px;overflow:hidden;margin-top:8px}.gc .gc-bar i{display:block;height:100%;background:var(--kc,var(--gc-acc));border-radius:4px}
.gc .gc-teams{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:10px}
.gc .gc-team{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;cursor:pointer;position:relative}
.gc .gc-team:hover{border-color:var(--border-2)}.gc .gc-team.on{outline:2px solid var(--gc-acc);outline-offset:-1px}
.gc .gc-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--kc,var(--ink-muted));margin-right:6px;vertical-align:middle}
.gc .gc-team .n{font-weight:800;font-size:13px}.gc .gc-team .st{font-size:11px;font-weight:700;color:var(--kc,var(--ink-muted));margin-left:auto}
.gc .gc-team .big{font-size:24px;font-weight:900;margin-top:6px}.gc .gc-team .big small{font-size:12px;color:var(--ink-muted);font-weight:600}
.gc .gc-team .row{display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-2);margin-top:3px}
.gc .gc-alerts{margin-top:10px;background:color-mix(in srgb,var(--gc-err) 7%,transparent);border:1px solid color-mix(in srgb,var(--gc-err) 40%,transparent);border-radius:var(--r-md);padding:10px 14px}
.gc .gc-alert{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:12.5px;border-top:1px dashed color-mix(in srgb,var(--gc-err) 30%,transparent)}
.gc .gc-alert:first-of-type{border-top:0}.gc .gc-alert b.v{color:var(--gc-err)}.gc .gc-alert .act{margin-left:auto;white-space:nowrap}
.gc .gc-sr{margin-top:10px;background:color-mix(in srgb,var(--gc-acc) 8%,transparent);border:1px solid color-mix(in srgb,var(--gc-acc) 30%,transparent);border-radius:var(--r-md);padding:10px 14px;font-size:13px;line-height:1.55}
.gc .ok{color:var(--gc-ok)}.gc .warn{color:var(--gc-warn)}.gc .err{color:var(--gc-err)}.gc .acc{color:var(--gc-acc)}
.gc details.gc-det{margin-top:8px;background:var(--bg-3);border-radius:8px;padding:8px 12px}.gc details.gc-det summary{cursor:pointer;font-weight:800;font-size:12.5px}
.gc .gc-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.gc-tvov{position:fixed;inset:0;z-index:99999;background:var(--bg);color:var(--ink);overflow-y:auto;overflow-x:hidden}
.gc-tvov .gc{font-size:15px}
@media (max-width:720px){.gc .gc-kpi .v{font-size:24px}.gc .gc-q h3{font-size:17px}}
`;
function ensureCss() {
  if (document.getElementById('gc-css')) return;
  const st = document.createElement('style'); st.id = 'gc-css'; st.textContent = GC_CSS; document.head.appendChild(st);
}

export async function pageGestaoComercial(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Gestão Comercial é para gestores, gerentes e sócios.</div>'; return; }
  ensureCss();
  if (!_until) {
    const h = new Date();
    const f = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    _until = f(h); _since = f(new Date(h.getTime() - 89 * 86400000));
  }
  await load();
}

async function load(fresh) {
  _busy = true;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Consolidando comercial (RD + HUB + Meta + Norte)… primeira leitura da janela pode levar ~30s.</div></div>';
  try {
    _d = await api.request(`/api/v3/oo/comercial?since=${_since}&until=${_until}&spend_preset=${_spendPreset}${fresh ? '&fresh=1' : ''}`);
    if (fresh) _srCache = {};
    if (_d.escopo) _team = _d.escopo;   // gerente: chega filtrado do backend, chip fixo
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message || e)}</div>`;
  } finally { _busy = false; }
}

/* ═══════════ VISÃO FILTRADA POR EQUIPE (espelho do filtra_escopo do backend) ═══════════ */
function teamsIn(d) { return TEAMS4.filter(t => (d.visao || []).some(v => v.team === t)); }
function viewFor(d, tk) {
  if (!tk || !d) return d;
  const n = { ...d, filtro: tk };
  n.visao = (d.visao || []).filter(v => v.team === tk);
  const ft = (d.fontes || {})[tk] || [];
  const pod = (campo, flag) => ft.filter(f => f[flag]).sort((a, b) => (b[campo] || 0) - (a[campo] || 0)).slice(0, 3);
  n.fontes = { geral: ft, [tk]: ft, podio: { visita: pod('pc_visita', 'rankeavel'), pasta: pod('pc_pasta', 'rankeavel'), venda: pod('pc_venda', 'rankeavel_venda') } };
  ['funil_rd', 'forecast', 'resposta', 'tempos'].forEach(k => { n[k] = Object.fromEntries(Object.entries(d[k] || {}).filter(([t]) => t === tk)); });
  const cu = d.custos || {};
  n.custos = { ...cu, equipes: (cu.equipes || []).filter(c => c.team === tk), payback_midia: tk === 'conquista' ? cu.payback_midia : null };
  n.historico = (d.historico || []).map(h => { const e = (h.equipes || {})[tk] || {}; return { ...h, total: { ...h.total, vendas: e.vendas ?? 0, vgv: e.vgv ?? 0, spend: e.spend, cac_global: e.cac_midia, leads: e.leads ?? h.total?.leads } }; });
  const pr = d.produtividade || {};
  n.produtividade = { ...pr, corretores: (pr.corretores || []).filter(c => c.team === tk), equipes: Object.fromEntries(Object.entries(pr.equipes || {}).filter(([t]) => t === tk)) };
  const es = d.esteira || {};
  n.esteira = { ...es, corretores: (es.corretores || []).filter(c => c.team === tk), equipes: Object.fromEntries(Object.entries(es.equipes || {}).filter(([t]) => t === tk)) };
  n.performance_corretores = (d.performance_corretores || []).filter(c => c.team === tk);
  const rv = d.ritmo_vendas || {};
  n.ritmo_vendas = { ...rv, corretores: (rv.corretores || []).filter(c => c.team === tk), equipes: Object.fromEntries(Object.entries(rv.equipes || {}).filter(([t]) => t === tk)) };
  const cp = d.campanhas || {};
  n.campanhas = { ...cp, itens: (cp.itens || []).filter(x => (x.teams || []).some(t => String(t).toLowerCase().includes(tk))) };
  n.alertas = { ...(d.alertas || {}), itens: ((d.alertas || {}).itens || []).filter(a => a.team === tk) };
  n.hub_conquista = tk === 'conquista' ? d.hub_conquista : null;
  if ((d.safras_por_equipe || {})[tk]) n.safras = d.safras_por_equipe[tk];
  if ((d.coorte_por_equipe || {})[tk] != null) n.coorte_n = d.coorte_por_equipe[tk];
  const to = d.turnover || {};
  n.turnover = { ...to, saidas: (to.saidas || []).filter(x => x.team === tk), ativos_risco: (to.ativos_risco || []).filter(x => x.team === tk) };
  return n;
}

/* ═══════════ RENDER ═══════════ */
function pan(title, inner) {
  return `<div class="gc-pan"><div class="gc-pan-t">${title}</div>${inner}</div>`;
}

function pageHTML() {
  const d = _d;
  const teams = teamsIn(d);
  const chips = d.escopo
    ? `<span class="gc-chip on">🔒 ${tLbl(d.escopo)}</span>`
    : [['', 'Todas'], ...teams.map(t => [t, TEAM_LBL[t]])].map(([t, l]) => `<button class="gc-chip${(_team || '') === t ? ' on' : ''}" data-team="${t}">${l}</button>`).join('');
  return `
    <div class="gc-top">
      <h2 class="card-title" style="margin:0">📊 Gestão Comercial</h2>
      <span class="tiny muted">${d.janela.since} → ${d.janela.until} · ${fN(d.coorte_n)} leads · origem ${d.cobertura_origem_pct != null ? fN(d.cobertura_origem_pct) + '%' : '—'}</span>
    </div>
    <div class="gc-top" style="margin-top:8px">
      <select class="select" id="gc-preset" style="width:auto;padding:4px 8px;font-size:12px">
        <option value="">Período…</option><option value="semana">Semana atual</option><option value="quinzena">Quinzena (15d)</option>
        <option value="mes">Mês atual</option><option value="90d">Últimos 90d</option><option value="tri">Trimestre atual</option>
        <option value="sem">Semestre atual</option><option value="ytd">Janeiro até hoje</option>
      </select>
      <input type="date" class="input" id="gc-since" value="${_since}" style="width:auto;padding:4px 8px;font-size:12px">
      <input type="date" class="input" id="gc-until" value="${_until}" style="width:auto;padding:4px 8px;font-size:12px">
      <button class="btn btn-ghost btn-sm" id="gc-aplicar">Aplicar</button>
      <button class="btn btn-ghost btn-sm" id="gc-fresh" title="ignora o cache de 10min">🔄</button>
      <button class="btn btn-ghost btn-sm${_notas ? ' on' : ''}" id="gc-notas" title="mostrar/esconder notas de como ler cada quadro">ⓘ</button>
      ${_tv ? '' : '<button class="btn btn-primary btn-sm" id="gc-tv">📺 TV</button>'}
    </div>
    ${(d.avisos || []).length ? `<div class="alert alert-warn tiny" style="margin-top:8px">${d.avisos.map(esc).join('<br>')}</div>` : ''}
    <div class="gc-top" style="margin-top:10px">${chips}</div>
    ${cockpit()}
    <div class="gc-tabs">${GC_TABS.map(([id, l]) => `<button class="gc-tab${_tab === id ? ' on' : ''}" data-gct="${id}">${l}</button>`).join('')}</div>
    <div id="gc-body">${tabBody()}</div>`;
}

function render() {
  _v = viewFor(_d, _team);
  _root.innerHTML = `<div class="card gc${_notas ? ' notas' : ''}">${pageHTML()}</div>`;
  bind(_root);
  postRender();
}

function bind(scope) {
  scope.querySelectorAll('[data-gct]').forEach(b => b.onclick = () => { _tab = b.dataset.gct; _tv ? renderTV() : render(); });
  scope.querySelectorAll('[data-team]').forEach(b => b.onclick = () => { _team = b.dataset.team || null; _tv ? renderTV() : render(); });
  scope.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { _tab = b.dataset.goto; _tv ? renderTV() : render(); });
  const q = s => scope.querySelector(s);
  q('#gc-aplicar') && (q('#gc-aplicar').onclick = () => { _since = q('#gc-since').value; _until = q('#gc-until').value; load(); });
  q('#gc-fresh') && (q('#gc-fresh').onclick = () => load(true));
  q('#gc-notas') && (q('#gc-notas').onclick = () => { _notas = !_notas; scope.querySelector('.gc')?.classList.toggle('notas', _notas); q('#gc-notas').classList.toggle('on', _notas); });
  q('#gc-tv') && (q('#gc-tv').onclick = enterTV);
  q('#gc-preset') && (q('#gc-preset').onchange = ev => {
    const h = new Date();
    const f = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const ini = {
      semana: () => new Date(h.getTime() - ((h.getDay() + 6) % 7) * 86400000),
      quinzena: () => new Date(h.getTime() - 14 * 86400000),
      mes: () => new Date(h.getFullYear(), h.getMonth(), 1),
      '90d': () => new Date(h.getTime() - 89 * 86400000),
      tri: () => new Date(h.getFullYear(), Math.floor(h.getMonth() / 3) * 3, 1),
      sem: () => new Date(h.getFullYear(), h.getMonth() < 6 ? 0 : 6, 1),
      ytd: () => new Date(h.getFullYear(), 0, 1),
    }[ev.target.value];
    if (!ini) return;
    _since = f(ini()); _until = f(h); load();
  });
  q('#gc-spend') && (q('#gc-spend').onchange = ev => { _spendPreset = ev.target.value; load(); });
}

function tabBody() {
  return { meta: tabMeta, funil: tabFunil, midia: tabMidia, pessoas: tabPessoas }[_tab]();
}
function postRender() { initCharts(); srPerformance(); }

/* ═══════════ 🧭 COCKPIT — "Como está nosso mês?" ═══════════ */
function statusOf(v) {
  let meta = v.meta_vendas || 0, real = v.real_vendas || 0;
  let pr = v.proj_ritmo;
  if (!meta && v.meta_vgv) {   // v86.62: sem meta de VENDAS cadastrada → julga pelo VGV (ritmo do VGV pelo dia do mês)
    const h = new Date(), pm = h.getDate() / new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
    meta = v.meta_vgv; real = v.real_vgv || 0; pr = pm > 0 ? real / pm : real;
    if (real >= meta) return { k: 'ok', c: 'var(--gc-ok)', lbl: 'meta VGV batida' };
    if (pr >= meta) return { k: 'ok', c: 'var(--gc-ok)', lbl: 'no ritmo (VGV)' };
    if (pr >= meta * 0.7) return { k: 'warn', c: 'var(--gc-warn)', lbl: 'atrás do ritmo (VGV)' };
    return { k: 'err', c: 'var(--gc-err)', lbl: 'fora do ritmo (VGV)' };
  }
  if (!meta) return { k: 'none', c: 'var(--ink-muted)', lbl: 'sem meta' };
  if (real >= meta) return { k: 'ok', c: 'var(--gc-ok)', lbl: 'meta batida' };
  const p = pr != null ? pr : real;
  if (p >= meta) return { k: 'ok', c: 'var(--gc-ok)', lbl: 'no ritmo' };
  if (p >= meta * 0.7) return { k: 'warn', c: 'var(--gc-warn)', lbl: 'atrás do ritmo' };
  return { k: 'err', c: 'var(--gc-err)', lbl: 'fora do ritmo' };
}
const ACAO = {
  sem_contato: ['abrir fila de 1º contato', 'funil'], contato_h: ['cadência de resposta', 'funil'], conv_venda: ['ver gargalo do funil', 'funil'],
  custo_lead: ['revisar campanhas', 'midia'], custo_agend: ['revisar campanhas', 'midia'], cac_midia: ['revisar campanhas', 'midia'], roas: ['revisar campanhas', 'midia'],
  ritmo_meta: ['1:1 com a equipe', 'pessoas'],
};
function cockpit() {
  const v = _v, hoje = new Date();
  const diasMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate(), dia = hoje.getDate(), pctMes = dia / diasMes;
  const vis = v.visao || [];
  const sum = k => vis.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const real = sum('real_vendas'), meta = sum('meta_vendas'), vgv = sum('real_vgv'), vgvMeta = sum('meta_vgv');
  const projR = vis.some(x => x.proj_ritmo != null) ? vis.reduce((a, x) => a + (Number(x.proj_ritmo) || 0), 0) : null;
  const projN = vis.some(x => x.proj_vendas) ? sum('proj_vendas') : null;
  const agg = { real_vendas: real, meta_vendas: meta, proj_ritmo: projR, meta_vgv: vgvMeta, real_vgv: vgv };
  const st = statusOf(agg);
  const pct = meta ? Math.min(100, real / meta * 100) : 0;
  const cus = (v.custos || {}).equipes || [];
  const spend = cus.reduce((a, c) => a + (c.spend || 0), 0), vPagas = cus.reduce((a, c) => a + (c.vendas_pagas || 0), 0);
  const cac = vPagas ? spend / vPagas : null;
  const cfg = (v.alertas || {}).cfg || {};
  const cacSt = cac == null ? 'none' : cfg.max_cac_midia && cac > cfg.max_cac_midia ? 'err' : 'ok';
  const cor = k => ({ ok: 'var(--gc-ok)', warn: 'var(--gc-warn)', err: 'var(--gc-err)', none: 'var(--border-2)' }[k]);
  const ticket = real ? vgv / real : 0;
  const kpis = `
    <div class="gc-kpi" style="--kc:${st.c}"><div class="l">Vendas do mês</div>
      <div class="v">${fN(real)}${meta ? ` <small>/ ${fN(meta)}</small>` : ''}</div>
      <div class="s"><span style="color:${st.c};font-weight:800">● ${st.lbl}</span>${meta ? ` · ${fN(pct)}% da meta · faltam ${fN(Math.max(0, meta - real))}` : ''}</div>
      <div class="gc-bar"><i style="width:${pct}%"></i></div></div>
    <div class="gc-kpi" style="--kc:var(--gc-acc)"><div class="l">Projeção do mês</div>
      <div class="v acc">${projR != null ? fN(Math.round(projR * 10) / 10) : '—'}${meta ? ` <small>/ ${fN(meta)}</small>` : ''}</div>
      <div class="s">pelo ritmo (dia ${dia} de ${diasMes} · ${fN(Math.round(pctMes * 100))}% do mês)${projN != null ? ` · Norte ${fN(projN)}` : ''}</div></div>
    <div class="gc-kpi" style="--kc:${vgvMeta ? (vgv >= vgvMeta ? 'var(--gc-ok)' : vgv >= vgvMeta * pctMes * 0.9 ? 'var(--gc-ok)' : vgv >= vgvMeta * pctMes * 0.6 ? 'var(--gc-warn)' : 'var(--gc-err)') : 'var(--border-2)'}"><div class="l">VGV do mês</div>
      <div class="v">R$ ${kR$(vgv)}${vgvMeta ? ` <small>/ ${kR$(vgvMeta)}</small>` : ''}</div>
      <div class="s">${real ? `ticket R$ ${kR$(ticket)}` : 'sem venda ainda'}${vgvMeta ? ` · ${fN(vgv / vgvMeta * 100)}% da meta` : ''}</div></div>
    <div class="gc-kpi" style="--kc:${cor(cacSt)}"><div class="l">CAC mídia</div>
      <div class="v ${cacSt === 'err' ? 'err' : ''}">${cac != null ? 'R$ ' + kR$(cac) : '—'}</div>
      <div class="s">R$ ${kR$(spend)} spend · ${fN(vPagas)} venda(s) de tráfego${cfg.max_cac_midia ? ` · régua ≤ ${kR$(cfg.max_cac_midia)}` : ''}</div></div>`;
  // semáforo por equipe (só quando há mais de uma no recorte)
  const teamsAll = (_d.visao || []);
  const cards = (!_team && teamsAll.length > 1) ? `<div class="gc-teams">${teamsAll.map(x => {
    const s = statusOf(x), pa = x.pipeline_agora || {}, p = x.meta_vendas ? Math.min(100, (x.real_vendas || 0) / x.meta_vendas * 100) : 0;
    const al = ((_d.alertas || {}).itens || []).filter(a => a.team === x.team).length;
    return `<div class="gc-team" data-team="${x.team}" style="--kc:${s.c}">
      <div style="display:flex;align-items:center"><span class="gc-dot"></span><span class="n">${x.label}</span><span class="st">${s.lbl}${al ? ` · ${al} alerta${al > 1 ? 's' : ''}` : ''}</span></div>
      <div class="big">${fN(x.real_vendas)}${x.meta_vendas ? ` <small>/ ${fN(x.meta_vendas)} meta</small>` : ' <small>vendas</small>'}</div>
      <div class="gc-bar"><i style="width:${p}%"></i></div>
      <div class="row"><span>projeção ritmo</span><b class="acc">${x.proj_ritmo != null ? fN(x.proj_ritmo) : '—'}</b></div>
      <div class="row"><span>VGV</span><b>R$ ${kR$(x.real_vgv)}</b></div>
      <div class="row"><span>propostas / pastas abertas</span><b>${fN(pa.propostas || 0)} / ${fN(pa.pastas || 0)}</b></div>
    </div>`; }).join('')}</div>` : '';
  // alertas como lista de AÇÕES
  const its = (v.alertas || {}).itens || [];
  const alerts = its.length ? `<div class="gc-alerts">
    <div style="font-weight:900;font-size:12.5px;color:var(--gc-err);margin-bottom:4px">🚨 ${its.length} métrica${its.length > 1 ? 's' : ''} fora da régua — gestor e sócios notificados</div>
    ${its.map(a => { const [txt, tab] = ACAO[a.metrica] || ['ver detalhe', 'meta']; return `<div class="gc-alert">
      <span class="tiny" style="font-weight:700;white-space:nowrap">${tLbl(a.team)}</span>
      <span>${esc(a.label)}: <b class="v">${fN(a.valor)}</b> <span class="tiny muted">(${a.acima ? '▲' : '▼'} ${fN(Math.abs(a.delta_pct))}% ${a.acima ? 'acima' : 'abaixo'} da régua ${fN(a.limite)})</span></span>
      <button class="btn btn-ghost btn-sm act" data-goto="${tab}">→ ${txt}</button></div>`; }).join('')}</div>` : '';
  const hub = v.hub_conquista;
  return `<div class="gc-q"><h3>Como está nosso mês?</h3><span class="tiny muted">${MESES_NOME[hoje.getMonth()]} · ${_team ? tLbl(_team) : 'todas as equipes'} · metas do painel 🎯 Metas</span></div>
    <div class="gc-kpis">${kpis}</div>${cards}${alerts}
    ${hub && hub.vendas != null && hub.vendas !== real && _team !== null && _team !== 'conquista' ? '' : (hub && hub.vendas != null ? `<div class="tiny muted" style="margin-top:8px">🌉 PSM HUB (esteira Conquista) marca ${fN(hub.vendas)} venda(s) · R$ ${kR$(hub.vgv)} no mês — divergência com o RD = lançamento pendente num dos dois.</div>` : '')}
    <div class="gc-sr"><b>🧠 Sr. Performance:</b> <span class="gc-sr-txt" style="opacity:.7">analisando os números…</span></div>`;
}

/* ═══════════ 🧠 SR. PERFORMANCE — 1 análise por aba (v86.61) ═══════════ */
let _srCache = {}, _srKey = '';
function scopeEl() { return (_tv ? document.getElementById('gc-tv-ov') : _root) || document; }
function srPerformance() {
  const resumo = resumoTab();
  const key = _tab + ':' + (_team || 'all') + ':' + _since + ':' + _until + ':' + _spendPreset;
  _srKey = key;
  const fill = an => { if (_srKey !== key) return; scopeEl().querySelectorAll('.gc-sr-txt').forEach(tx => { tx.textContent = an.geral || 'sem análise pra este recorte.'; tx.style.opacity = '1'; }); };
  if (_srCache[key]) return fill(_srCache[key]);
  api.request('/api/v3/oo/comercial_analise', { method: 'POST', body: { tab: _tab, janela: _d.janela, resumo } })
    .then(r => { _srCache[key] = r.analises || {}; fill(_srCache[key]); })
    .catch(e => _srKey === key && scopeEl().querySelectorAll('.gc-sr-txt').forEach(t => {
      const m = e.message || 'erro';
      t.textContent = (/cota/i.test(m) ? '⚠️ ' : 'análise indisponível agora: ') + m; t.style.opacity = '1';
    }));
}
/* resumo COMPACTO: cockpit + o que a aba mostra → prompt do Sr. Performance (chave única "geral") */
function resumoTab() {
  const d = _v || {};
  const histCompact = (d.historico || []).map(h => ({ mes: h.ym, parcial: !!h.parcial, leads: h.total?.leads, vendas: h.total?.vendas, vgv: h.total?.vgv, spend: h.total?.spend, cac: h.total?.cac_global }));
  const eqProd = Object.entries((d.produtividade || {}).equipes || {}).map(([t, e]) => ({ equipe: tLbl(t), ...e, canais: undefined }));
  const g = {
    recorte: _team ? tLbl(_team) : 'todas as equipes', aba: GC_TABS.find(t => t[0] === _tab)?.[1],
    instrucao: 'Responda como UM parágrafo único (3 a 5 frases) pro gestor: como está o mês, o principal risco e UMA ação prática. Sem listas.',
    mes_corrente: (d.visao || []).map(v => ({ equipe: v.label, vendas_real: v.real_vendas, meta: v.meta_vendas, proj_ritmo: v.proj_ritmo, proj_norte: v.proj_vendas, vgv_real: v.real_vgv, vgv_meta: v.meta_vgv, pipeline_aberto: v.pipeline_agora })),
    alertas_fora_da_regua: (d.alertas || {}).itens || [],
  };
  if (_tab === 'meta') { g.projecao_ponderada = d.forecast || {}; g.historico_vendas = histCompact; }
  else if (_tab === 'funil') {
    g.funis_rd = Object.fromEntries(Object.entries(d.funil_rd || {}).map(([t, f]) => [tLbl(t), { pipeline: f.pipeline, lanes: (f.lanes || []).map(l => ({ etapa: l.nome, abertos: l.abertos, alcancaram: l.alcancaram, passagem_pct: l.passagem_pct })) }]));
    g.fontes = ((d.fontes || {}).geral || []).slice(0, 10).map(f => ({ fonte: f.label, leads: f.leads, vendas: f.venda, pc_visita: f.pc_visita, pc_venda: f.pc_venda }));
    g.esteira_equipes = Object.values((d.esteira || {}).equipes || {}).map(c => ({ equipe: tLbl(c.team), prospeccoes: c.prospec, qualificados: c.qualif, visitas: c.visita, pastas: c.pasta, vendas: c.venda, conversoes_pct: c.conv }));
    g.velocidade_contato = d.resposta || {};
  } else if (_tab === 'midia') {
    g.unit_economics = ((d.custos || {}).equipes || []).map(c => ({ equipe: c.label, spend: c.spend, leads: c.leads, custo_lead: c.custo_lead, custo_visita: c.custo_visita, cac_midia: c.cac_midia, cac_marketing: c.cac_marketing, roas: c.roas, vendas: c.vendas, vendas_pagas: c.vendas_pagas }));
    g.campanhas_top = ((d.campanhas || {}).itens || []).slice(0, 12).map(x => ({ campanha: x.campanha, ativa: x.ativa, leads: x.leads, visitas: x.visita, vendas: x.venda, spend: x.spend_30d, roas: x.roas, veredito: x.veredito }));
    g.historico_custo = histCompact;
  } else if (_tab === 'pessoas') {
    g.produtividade = { equipes: eqProd, corretores: ((d.produtividade || {}).corretores || []).slice(0, 25).map(c => ({ nome: c.nome, equipe: tLbl(c.team), leads: c.leads, vendas: c.venda, visitas_por_venda: c.visitas_por_venda, dias_por_venda: c.dias_por_venda, ticket: c.ticket })) };
    g.performance_vs_base = (d.performance_corretores || []).map(c => ({ corretor: c.nome, equipe: tLbl(c.team), atual: c.atual, delta_vendas_pct: c.delta_vendas_pct }));
    g.turnover = d.turnover || {}; g.safras = d.safras || [];
  }
  return { geral: g };
}

/* ═══════════ ABAS ═══════════ */
function tabMeta() {
  const rows = (_v.visao || []).map(v => {
    const s = statusOf(v), pct = v.meta_vendas ? v.real_vendas / v.meta_vendas * 100 : null;
    return `<tr>
      <td style="font-weight:700;white-space:nowrap"><span class="gc-dot" style="--kc:${s.c}"></span>${v.label}</td>
      <td style="text-align:right;font-weight:900;font-size:15px;color:${s.c}">${fN(v.real_vendas)}</td>
      <td style="text-align:right;font-weight:700">${v.meta_vendas ? fN(v.meta_vendas) : '—'}</td>
      <td style="text-align:right;font-weight:800;color:${s.c}">${pct != null ? fN(pct) + '%' : '—'}</td>
      <td style="text-align:right">${v.meta_vendas ? fN(Math.max(0, v.meta_vendas - v.real_vendas)) : '—'}</td>
      <td style="text-align:right" class="acc" title="vendas até hoje ÷ dias corridos × dias do mês">${v.proj_ritmo != null ? fN(v.proj_ritmo) : '—'}</td>
      <td style="text-align:right" class="acc" title="mix × conversão calibrada de cada corretor (Norte)">${v.proj_vendas ? fN(v.proj_vendas) : '—'}</td>
      <td style="text-align:right" title="faixa estatística normal (Poisson)">${v.poisson ? `${v.poisson.lo}–${v.poisson.hi}` : '—'}</td>
      <td style="text-align:right">R$ ${kR$(v.real_vgv)}${v.meta_vgv ? ` <span class="tiny muted">/ ${kR$(v.meta_vgv)}</span>` : ''}</td>
      <td style="text-align:right">${v.real_ticket ? 'R$ ' + kR$(v.real_ticket) : '—'}</td>
    </tr>`;
  }).join('');
  const detalhes = (_v.visao || []).filter(v => (v.por_corretor || []).length).map(v => `
    <details class="gc-det"><summary>${v.label} — corretor a corretor (real × meta × projetado)</summary>
      <div style="overflow-x:auto;margin-top:6px"><table>
        <thead><tr style="text-align:right"><th style="text-align:left">Corretor</th><th>Real</th><th>Meta</th><th>Projetado</th><th>VGV</th><th>% meta</th></tr></thead>
        <tbody>${v.por_corretor.slice().sort((a, b) => (b.real || 0) - (a.real || 0)).map(c => {
          const pct = c.meta > 0 ? c.real / c.meta * 100 : null;
          const cc = pct == null ? 'var(--ink-muted)' : pct >= 100 ? 'var(--gc-ok)' : pct >= 60 ? 'var(--gc-warn)' : 'var(--gc-err)';
          return `<tr><td>${esc(c.nome)}</td><td style="text-align:right;font-weight:800">${fN(c.real)}</td><td style="text-align:right">${c.meta ? fN(c.meta) : '—'}</td>
            <td style="text-align:right" class="acc">${c.proj ? fN(c.proj) : '—'}</td><td style="text-align:right">R$ ${kR$(c.vgv)}</td>
            <td style="text-align:right;font-weight:800;color:${cc}">${pct != null ? fN(pct) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div></details>`).join('');
  return pan('🎯 Mês corrente — real × meta × projeção, por equipe', `
    <div style="overflow-x:auto"><table>
      <thead><tr style="text-align:right"><th style="text-align:left">Equipe</th><th>Real</th><th>Meta</th><th>% meta</th><th>Faltam</th><th>Proj. ritmo</th><th>Proj. Norte</th><th>Faixa normal</th><th>VGV real / meta</th><th>Ticket</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" class="tiny muted">sem equipe no recorte</td></tr>'}</tbody></table></div>
    ${detalhes}
    <div class="tiny muted gc-nota" style="margin-top:6px">Metas = painel 🎯 Metas oficial (por corretor/mês). Projeção <b>ritmo</b> = velocidade real do mês extrapolada; <b>Norte</b> = mix × conversão calibrada de cada corretor. Faixa normal = intervalo estatístico (Poisson) — venda dentro dela é variação normal, não tendência. Equipe do deal = funil do RD onde ele vive (decisão 17/ago).</div>`)
    + forecastPanel()
    + ((_v.historico || []).length ? gwrap('gch-hist', '📆 Vendas por equipe (barras) × VGV (linha) — mês a mês') : '')
    + histTable('Vendas & VGV — real', [
      ...(_v.visao || []).map(v => ({ lbl: v.label + ' vendas', get: h => h.equipes?.[v.team]?.vendas, fmt: fN })),
      { lbl: 'TOTAL vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'TOTAL VGV', get: h => h.total?.vgv, fmt: x => 'R$ ' + kR$(x) },
      { lbl: 'Ticket médio', get: h => h.total?.ticket, fmt: x => 'R$ ' + kR$(x) },
    ]);
}

function tabFunil() {
  return tabFunilRD()
    + gwrap('gch-funil', '⏬ Funil da safra por equipe — leads → atendimento → agendamento → visita → pasta → venda')
    + tabFontes()
    + velocidadePanel()
    + tabEsteira();
}

function tabMidia() {
  return unitEconomicsCards()
    + gwrap(['gch-cac', 'gch-leads'], '💰 CAC por equipe (mês corrente) · 🧲 Leads × spend Meta — mês a mês')
    + tabCampanhas()
    + tabCustos();
}

function tabPessoas() {
  return tabProd() + tabSafras();
}

/* 📐 unit economics em cards — só equipes COM mídia (as sem conta não ocupam espaço) */
function unitEconomicsCards() {
  const custos = ((_v.custos || {}).equipes || []);
  const prod = (_v.produtividade || {}).equipes || {};
  const al = (_v.alertas || {}); const aIdx = {}; (al.itens || []).forEach(a => { aIdx[a.team + ':' + a.metrica] = a; });
  const comMidia = custos.filter(c => c.conta || c.spend > 0);
  const semMidia = custos.filter(c => !(c.conta || c.spend > 0));
  const val = x => x != null ? 'R$ ' + kR$(x) : '—';
  const tile = (team, mid, lbl, v, sub) => { const a = aIdx[team + ':' + mid]; return `<div class="gc-kpi" style="--kc:${a ? 'var(--gc-err)' : 'var(--border-2)'};padding:9px 12px"><div class="l">${lbl}</div><div class="v ${a ? 'err' : ''}" style="font-size:20px">${v}</div><div class="s">${a ? `<span class="err" style="font-weight:800">${a.acima ? '▲' : '▼'} ${fN(Math.abs(a.delta_pct))}% da régua</span>` : (sub || '')}</div></div>`; };
  const blocos = comMidia.map(c => { const t = c.team, p = prod[t] || {}; const conv = p.leads ? Math.round(p.venda / p.leads * 10000) / 100 : null; return `
    <div style="margin-top:10px"><div style="font-weight:800;font-size:12.5px;margin-bottom:6px">${c.label} <span class="tiny muted">· spend do mês R$ ${kR$(c.spend)}</span></div>
    <div class="gc-kpis" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-top:0">
      ${tile(t, 'custo_lead', 'R$ / lead', val(c.custo_lead), fN(c.leads) + ' leads')}
      ${tile(t, 'custo_agend', 'R$ / agendamento', val(c.custo_agend), fN(c.agend) + ' agend.')}
      ${tile(t, 'custo_visita', 'R$ / visita', val(c.custo_visita), fN(c.visita) + ' visitas')}
      ${tile(t, 'custo_pasta', 'R$ / pasta', val(c.custo_pasta), fN(c.pasta) + ' pastas')}
      ${tile(t, 'cac_midia', 'CAC mídia', val(c.cac_midia), fN(c.vendas_pagas || 0) + ' venda(s) de tráfego')}
      ${tile(t, 'cac_marketing', 'CAC marketing', val(c.cac_marketing), '+ R$ ' + kR$(c.premiacao_indicacao || 0) + ' indicação')}
      ${tile(t, 'roas', 'ROAS', c.roas != null ? fN(c.roas) + '×' : '—', 'receita ≈ 4% do VGV')}
      ${tile(t, 'conv_venda', 'Conv. lead → venda', conv != null ? fN(conv) + '%' : '—', 'safra da janela')}
    </div></div>`; }).join('');
  const cfg = al.cfg || {};
  return pan('📐 Unit economics do mês — custo por etapa e CAC (vermelho = fora da régua)', `
    ${blocos || '<div class="tiny muted">nenhuma equipe com mídia própria no recorte.</div>'}
    ${semMidia.length ? `<div class="tiny muted" style="margin-top:8px">Sem conta Meta própria (CAC vive no marketing/completo): ${semMidia.map(c => c.label).join(' · ')}</div>` : ''}
    <div class="tiny muted gc-nota" style="margin-top:6px">Régua: R$/lead ≤ ${fN(cfg.max_cpl || 0)} · CAC ≤ ${kR$(cfg.max_cac_midia || 0)} · 1º contato ≤ ${fN(cfg.max_contato_h || 0)}h · conv ≥ ${fN(cfg.min_conv_venda_pct || 0)}% · sem contato ≤ ${fN(cfg.max_sem_contato || 0)} · ritmo da meta ≥ ${fN(cfg.min_ritmo_meta_pct || 0)}% · ROAS ≥ ${fN(cfg.min_roas || 0)}×. Fora da régua notifica gestor + sócios 1×/dia.</div>`);
}

/* ⚡ velocidade do 1º contato — saiu de Safras pra viver no Funil (é gargalo de funil) */
function velocidadePanel() {
  const resp = _v.resposta || {};
  const linhaR = (lbl, val) => `<div style="display:flex;justify-content:space-between;font-size:12px;border-bottom:1px dashed var(--border);padding:3px 0"><span>${lbl}</span><b style="white-space:nowrap">${val}</b></div>`;
  const blocos = Object.keys(resp).filter(t => (resp[t] || {}).n_mediveis).map(t => { const r = resp[t]; return `<div><div class="tiny" style="font-weight:800;margin-bottom:4px">${TEAM_LBL[t] || t} <span class="muted">(${fN(r.n_mediveis)} medíveis)</span></div>
      ${linhaR('Mediana', fmtDHM(r.mediana_h))}${linhaR('P25 → P75', fmtDHM(r.p25_h) + ' → ' + fmtDHM(r.p75_h))}
      ${linhaR('Conv. metade RÁPIDA', `<span class="ok">${r.conv_rapidos_pct != null ? fN(r.conv_rapidos_pct) + '%' : '—'}</span>`)}
      ${linhaR('Conv. metade LENTA', `<span class="err">${r.conv_lentos_pct != null ? fN(r.conv_lentos_pct) + '%' : '—'}</span>`)}
      ${linhaR('SEM 1º contato até hoje', `<span class="err">${fN(r.sem_contato)}</span>`)}</div>`; }).join('');
  if (!blocos) return '';
  return pan('⚡ Velocidade do 1º contato × conversão', `<div class="gc-grid2">${blocos}</div>
    <div class="tiny muted gc-nota" style="margin-top:6px">Medido na safra da janela: criação do lead → primeira mudança de etapa. Metade rápida × lenta = a prova de quanto custa demorar.</div>`);
}

/* ═══════════ 📺 MODO TV ═══════════ */
function enterTV() {
  if (_tv) return;
  _tv = true; _tvRotate = true;
  if (_root) _root.style.display = 'none';
  let ov = document.getElementById('gc-tv-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'gc-tv-ov'; ov.className = 'gc-tvov'; document.body.appendChild(ov); }
  document.addEventListener('keydown', tvKey);
  try { const rf = ov.requestFullscreen || ov.webkitRequestFullscreen; if (rf) { const p = rf.call(ov); if (p && p.catch) p.catch(() => {}); } } catch (_) {}
  renderTV();
  clearInterval(_tvTimer);
  _tvTimer = setInterval(() => { if (_tv && _tvRotate) tvStep(1); }, TV_ROT_MS);
  clearInterval(_tvDataTimer);
  _tvNextAt = Date.now() + TV_REFRESH_MS;
  _tvDataTimer = setInterval(async () => {
    if (!_tv || _busy) return;
    _tvNextAt = Date.now() + TV_REFRESH_MS;
    try { _d = await api.request(`/api/v3/oo/comercial?since=${_since}&until=${_until}&spend_preset=${_spendPreset}&fresh=1`); renderTV(); } catch (_) {}
  }, TV_REFRESH_MS);
  clearInterval(_tvTickTimer);
  _tvTickTimer = setInterval(() => {
    const el = document.getElementById('gc-tv-age');
    if (!el || !_tv) return;
    const age = _d?.fetched_at ? Math.max(0, Math.round((Date.now() - new Date(_d.fetched_at).getTime()) / 1000)) : null;
    const nxt = Math.max(0, Math.round((_tvNextAt - Date.now()) / 1000));
    const f = s => s < 90 ? s + 's' : Math.round(s / 60) + 'min';
    const cor = age == null ? 'var(--ink-muted)' : age < 720 ? 'var(--gc-ok)' : age < 1800 ? 'var(--gc-warn)' : 'var(--gc-err)';
    el.innerHTML = `<span style="color:${cor};font-weight:800">● dado de ${age != null ? f(age) : '—'} atrás</span><span class="muted"> · atualiza em ${f(nxt)}</span>`;
  }, 1000);
}
function exitTV() {
  _tv = false;
  [_tvTimer, _tvDataTimer, _tvTickTimer].forEach(t => clearInterval(t));
  document.removeEventListener('keydown', tvKey);
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
  document.getElementById('gc-tv-ov')?.remove();
  if (_root) { _root.style.display = ''; render(); }
}
function tvStep(dir) { const i = GC_TABS.findIndex(t => t[0] === _tab); _tab = GC_TABS[(i + dir + GC_TABS.length) % GC_TABS.length][0]; renderTV(); }
function tvKey(e) {
  if (!_tv) return;
  if (e.key === 'Escape') exitTV();
  else if (e.key === 'ArrowRight') tvStep(1);
  else if (e.key === 'ArrowLeft') tvStep(-1);
  else if (e.key === ' ') { e.preventDefault(); _tvRotate = !_tvRotate; renderTV(); }
}
function renderTV() {
  const ov = document.getElementById('gc-tv-ov');
  if (!ov || !_d) return;
  _v = viewFor(_d, _team);
  ov.innerHTML = `
    <div style="position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);padding:10px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:18px;font-weight:900;white-space:nowrap">📊 PSM · Gestão Comercial</div>
      <div id="gc-tv-age" class="tiny"></div>
      <div style="flex:1"></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="gctv-prev">◀</button>
        <button class="btn btn-sm ${_tvRotate ? 'btn-primary' : 'btn-ghost'}" id="gctv-rot">${_tvRotate ? '⏸ rotação' : '▶ rotação'}</button>
        <button class="btn btn-ghost btn-sm" id="gctv-next">▶</button>
        <button class="btn btn-danger btn-sm" id="gctv-exit">✕ sair</button>
      </div>
    </div>
    <div class="gc${_notas ? ' notas' : ''}" style="padding:14px 22px 48px;max-width:1700px;margin:0 auto">${pageHTML()}</div>`;
  bind(ov);
  ov.querySelector('#gctv-prev').onclick = () => tvStep(-1);
  ov.querySelector('#gctv-next').onclick = () => tvStep(1);
  ov.querySelector('#gctv-rot').onclick = () => { _tvRotate = !_tvRotate; renderTV(); };
  ov.querySelector('#gctv-exit').onclick = exitTV;
  postRender();
}

/* ═══════════ QUADROS REAPROVEITADOS (v86.33–86.58) — cores → paleta semântica, notas → ⓘ ═══════════ */
function tabCampanhas() {
  const cp = _v.campanhas || {};
  const its = cp.itens || [];
  if (!its.length) return pan('📣 Campanhas', '<div class="tiny muted">Nenhum lead da janela com campanha preenchida no RD.</div>');
  const VCOR = { escalar: 'var(--gc-ok)', manter: 'var(--gc-acc)', maturando: 'var(--gc-warn)', pausar: 'var(--gc-err)', observar: 'var(--ink-muted)' };
  const podio = (campo, titulo, ico) => {
    const top = its.filter(x => (x[campo] || 0) > 0).sort((a, b) => b[campo] - a[campo]).slice(0, 3);
    return `<div><div class="tiny" style="font-weight:800;margin-bottom:4px">${ico} ${titulo}</div><div style="display:grid;gap:4px">
      ${top.map((x, i) => `<div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:8px;padding:6px 10px">
        <span>${['🥇', '🥈', '🥉'][i]}</span><span class="tiny" style="flex:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(x.campanha)}">${esc(x.campanha.slice(0, 46))}</span>
        <b>${fN(x[campo])}</b></div>`).join('') || '<div class="tiny muted">—</div>'}</div></div>`;
  };
  const linha = x => `<tr>
      <td style="font-size:11.5px;font-weight:600;padding:4px 8px 4px 0;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(x.campanha)}">${esc(x.campanha)}<div class="tiny muted">${(x.teams || []).join(' · ')}</div></td>
      <td style="text-align:right;font-size:12px">${fN(x.leads)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.agend)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.visita)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.proposta)}</td>
      <td style="text-align:right;font-size:12px">${fN(x.pasta)}</td>
      <td style="text-align:right;font-weight:900;font-size:13px">${fN(x.venda)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(x.vgv)}</td>
      <td style="text-align:right;font-size:12px" title="≈ 4% do VGV">R$ ${kR$(x.receita_est)}</td>
      <td style="text-align:right;font-size:12px">${x.spend_30d != null ? 'R$ ' + kR$(x.spend_30d) : '—'}</td>
      <td style="text-align:right;font-size:12px">${x.cpl_30d != null ? 'R$ ' + kR$(x.cpl_30d) : '—'}</td>
      <td style="text-align:right;font-size:12px;font-weight:800">${x.roas != null ? fN(x.roas) + '×' : '—'}</td>
      <td><span class="tiny" style="font-weight:800;color:${VCOR[x.veredito]};white-space:nowrap">${esc(x.veredito_lbl)}</span></td>
    </tr>`;
  const ativas = its.filter(x => x.ativa);
  const inativas = its.filter(x => !x.ativa);
  const cab = `<thead><tr style="text-align:right"><th style="text-align:left">Campanha</th><th>Leads</th><th>Agend.</th><th>Visitas</th><th>Prop.</th><th>Pastas</th><th>Vendas</th><th>VGV</th><th>Receita≈</th><th>Spend</th><th>CPL</th><th>ROAS</th><th style="text-align:left">Veredito</th></tr></thead>`;
  const SPENDS = [['this_month', 'Este mês'], ['last_7d', 'Últimos 7d'], ['last_14d', 'Últimos 14d'], ['last_30d', 'Últimos 30d'], ['last_month', 'Mês passado']];
  const spendSel = `<div class="flex items-center gap-2" style="margin-bottom:8px">
    <span class="tiny" style="font-weight:800">🎚 Período do spend/CPL (Meta):</span>
    <select class="select" id="gc-spend" style="width:auto;padding:3px 8px;font-size:12px">
      ${SPENDS.map(([v, l]) => `<option value="${v}"${_spendPreset === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${cp.spend_preset_usado && cp.spend_preset_usado !== cp.spend_preset_pedido ? `<span class="tiny" style="color:var(--gc-warn);font-weight:700">⚠ cache da Meta não tinha "${esc(cp.spend_preset_pedido)}" — usando "${esc(cp.spend_preset_usado)}"</span>` : ''}
    <span class="tiny muted">o funil segue a janela de safra lá de cima — aqui você troca só a base de CUSTO</span>
  </div>`;
  return spendSel + pan('🏅 Pódio de campanhas — pelo FUNDO do funil, não pelo CPL', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">
        ${podio('visita', 'MAIS VISITAS', '🚶')}${podio('pasta', 'MAIS PASTAS', '📁')}${podio('proposta', 'MAIS PROPOSTAS', '📄')}${podio('venda', 'MAIS VENDAS', '💰')}
      </div>`, 'podio_campanhas')
    + pan(`🟢 Campanhas ATIVAS na Meta agora (${ativas.length})`, ativas.length ? `
      <div style="overflow-x:auto"><table>${cab}
        <tbody>${ativas.map(linha).join('')}</tbody></table></div>` : '<div class="tiny muted">Nenhuma campanha ativa casou com leads da safra.</div>', 'campanhas_ativas')
    + pan(`⏸ Pausadas / encerradas / sem match na Meta (${inativas.length}) — histórico da safra`, `
      <div style="overflow-x:auto"><table>${cab}
        <tbody>${inativas.map(linha).join('')}</tbody></table></div>
      <div class="tiny muted gc-nota" style="margin-top:6px">${esc(cp.nota || '')} · ${fN(cp.sem_campanha || 0)} lead(s) da janela sem campanha no RD. Régua do veredito: 💰 ESCALAR = vende e a receita cobre ≥1,5× o spend · ⏳ MATURANDO = sem venda mas com pastas/propostas andando · 🔴 REVER = gasta ≥R$300/30d sem gerar UMA visita na safra. O CPL está aí de contexto — a decisão é pelo fundo do funil.</div>`, 'campanhas_pausadas');
}

/* Δ% verde/vermelho (histórico mensal — pedido 15/ago) */

function delta(cur, prev, invertido) {
  if (prev == null || cur == null || !prev) return '';
  const p = (cur - prev) / Math.abs(prev) * 100;
  if (!isFinite(p) || Math.abs(p) < 0.05) return '<span class="tiny muted">＝</span>';
  const bom = invertido ? p < 0 : p > 0;
  return `<span class="tiny" style="font-weight:800;color:${bom ? 'var(--gc-ok)' : 'var(--gc-err)'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>`;
}

/* 📆 tabela do histórico do ano: colunas = meses (mês atual destacado + parcial),
   Δ% vs mês anterior em cada célula. rows = [{lbl, get(mesObj), fmt, invertido}] */
function histTable(titulo, rows, srId) {
  const hs = _v.historico || [];
  if (!hs.length) return '';
  const meses = hs.map(h => mesNome(h.ym));
  const head = `<tr><th style="text-align:left"></th>${hs.map((h, i) =>
    `<th style="text-align:right;padding:2px 8px;${h.parcial ? 'background:var(--bg-3);border-radius:6px 6px 0 0' : ''}">${meses[i]}${h.parcial ? '<div style="font-weight:400">parcial</div>' : ''}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr>
    <td class="tiny" style="font-weight:700;white-space:nowrap;padding:3px 8px 3px 0">${r.lbl}</td>
    ${hs.map((h, i) => {
      const v = r.get(h), pv = i > 0 ? r.get(hs[i - 1]) : null;
      return `<td style="text-align:right;padding:3px 8px;font-size:12px;${h.parcial ? 'background:var(--bg-3);font-weight:800' : ''}">${v != null ? r.fmt(v) : '—'}<div>${i > 0 ? delta(v, pv, r.invertido) : ''}</div></td>`;
    }).join('')}</tr>`).join('');
  return pan(`📆 ${titulo} — mês a mês ${new Date().getFullYear()} (Δ% vs mês anterior · mês atual destacado)`, `
    <div style="overflow-x:auto"><table>${head}${body}</table></div>`, srId);
}

/* ── 🎯 VISÃO GERAL: real × projeções ×3 × meta, por equipe + corretor ── */

function forecastPanel() {
  const fc = _v.forecast || {};
  const teams = Object.keys(fc).filter(t => (fc[t].termos || []).length || fc[t].mes_esp
    || Object.values(fc[t].hz || {}).some(h => h && (h.esp || h.real)));
  if (!teams.length) return '';
  const HZ = [['semana', '📅 Semana'], ['mes', 'Mês'], ['tri', 'Trimestre'], ['semestre', 'Semestre'], ['ano', 'Ano']];
  const rows = teams.map(t => {
    const f = fc[t], hz = f.hz || {};
    const cel = k => {
      const h = hz[k];
      if (!h) return '<td style="text-align:right;font-size:12px">—</td>';
      return `<td style="text-align:right;font-weight:900;font-size:13px;white-space:nowrap${k === 'tri' ? ';color:var(--gc-acc)' : ''}">${fN(h.esp)} <span class="tiny muted" style="font-weight:400">(${fN(h.real)} já)</span></td>`;
    };
    const termos = (f.termos || []).map(x => `${fN(x.abertos)} ${x.etapa}s×${fN(x.taxa_pct)}%`).join(' + ') || '—';
    return `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${TEAM_LBL[t] || t}</td>
      ${HZ.map(([k]) => cel(k)).join('')}
      <td style="text-align:right;font-size:12px">${f.pipeline_vgv_esp ? 'R$ ' + kR$(f.pipeline_vgv_esp) : '—'}</td>
      <td class="tiny muted">${termos}${f.mediana_pasta_venda_d != null ? ` · pasta→venda ~${f.mediana_pasta_venda_d}d` : ''}${f.run_rate_mensal ? ` · run-rate ${fN(f.run_rate_mensal)}/mês` : ''}</td>
    </tr>`;
  }).join('');
  return pan('🔮 Projeção ponderada — semana · mês · trimestre · semestre · ano (pipeline aberto × taxas REAIS)', `
    <div style="overflow-x:auto"><table>
      <thead><tr style="text-align:right"><th style="text-align:left">Equipe</th>${HZ.map(([, l]) => `<th>${l}</th>`).join('')}<th>VGV do pipeline</th><th style="text-align:left">Como foi calculado</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="tiny muted gc-nota" style="margin-top:6px">Cada célula = <b>projetado (real já feito)</b> no período. SEMANA/MÊS = real + pastas abertas × taxa pasta→venda quando a mediana de dias CABE no que resta. TRIMESTRE = real + pipeline inteiro ponderado. SEMESTRE/ANO = real + pipeline + run-rate (média dos últimos 3 meses fechados) nos meses que o pipeline não enxerga. Taxa sem amostra mínima fica de fora — sem invenção.</div>`, 'projecao_ponderada');
}

/* ── ⏬ FUNIL RD: as lanes EXATAS de cada funil, números do RD + % passagem ── */

function tabFunilRD() {
  const fr = _v.funil_rd || {};
  const teams = Object.keys(fr);
  if (!teams.length) return pan('⏬ Funil RD', '<div class="tiny muted">Nenhum funil espelhado encontrado (rd_stages).</div>');
  const RECOM = [
    [/agendar|agendad/i, 'cadência de contato mais curta + agendamento na PRIMEIRA conversa (script de 2 opções de horário)'],
    [/visita/i, 'confirmação na véspera + lembrete no dia + reagendamento ATIVO de quem furou'],
    [/proposta|aprova|quente/i, 'follow de 24h pós-visita com proposta/simulação na mão'],
    [/pasta|contrato|venda|cr[eé]dito/i, 'esteira documental: checklist de pasta + follow diário com correspondente/incorporadora'],
    [/contato|ctt|sondagem|qualific|atend/i, 'velocidade de resposta (1º contato) + 3 tentativas em canais diferentes nas primeiras 24h'],
  ];
  const bloco = tk => {
    const f = fr[tk];
    const lanes = f.lanes || [];
    const maxA = Math.max(1, ...lanes.filter(l => !l.base).map(l => l.alcancaram || 0));
    // 🔥 gargalo: pior passagem com volume relevante (≥15 alcançaram)
    const cand = lanes.filter(l => !l.base && l.passagem_pct != null && (l.alcancaram || 0) >= 15);
    const garg = cand.length ? cand.reduce((a, b) => (b.passagem_pct < a.passagem_pct ? b : a)) : null;
    const proxDe = nm => { const i = lanes.findIndex(l => l.nome === nm); return (lanes[i + 1] || {}).nome || ''; };
    const rec = garg ? (RECOM.find(([rx]) => rx.test(proxDe(garg.nome) + ' ' + garg.nome)) || [null, 'destravar a etapa com rotina diária de fila zero'])[1] : null;
    return pan(`${TEAM_LBL[tk] || tk} — funil “${esc(f.pipeline)}” (nomes exatos do RD)`, `
      <div style="display:grid;gap:3px">
        ${lanes.map(l => {
          if (l.base) return `<div style="display:flex;gap:8px;align-items:center;opacity:.75">
            <span class="tiny" style="min-width:210px;font-weight:600">🗂 ${esc(l.nome)}</span>
            <span class="tiny muted">lane de base · <b>${fN(l.abertos)}</b> parado(s) — conta como entrada, fora da cadeia</span></div>`;
          const w = Math.max(3, Math.round((l.alcancaram || 0) / maxA * 100));
          const ehGarg = garg && l.nome === garg.nome;
          return `<div style="display:flex;gap:8px;align-items:center${ehGarg ? ';background:color-mix(in srgb, var(--gc-err) 8%, transparent);border-radius:6px;padding:2px 4px' : ''}">
            <span class="tiny" style="min-width:210px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(l.nome)}">${esc(l.nome)}</span>
            <div style="flex:1;height:20px;background:var(--bg-3);border-radius:5px;overflow:hidden;position:relative">
              <div style="height:100%;width:${w}%;background:linear-gradient(90deg,var(--gc-acc-dim),var(--gc-acc));border-radius:5px"></div>
              <span class="tiny" style="position:absolute;left:8px;top:2px;color:#fff;font-weight:800">${fN(l.alcancaram || 0)} alcançaram</span>
            </div>
            <span class="tiny" style="min-width:86px;text-align:right"><b>${fN(l.abertos)}</b> <span class="muted">abertos</span></span>
            <span class="tiny" style="min-width:64px;text-align:right;font-weight:800;color:${l.passagem_pct == null ? 'var(--ink-muted)' : l.passagem_pct >= 50 ? 'var(--gc-ok)' : l.passagem_pct >= 25 ? 'var(--gc-warn)' : 'var(--gc-err)'}">${l.passagem_pct != null ? '↓ ' + fN(l.passagem_pct) + '%' : ''}${ehGarg ? ' 🔥' : ''}</span>
          </div>`;
        }).join('')}
      </div>
      ${garg ? `<div style="margin-top:8px;background:color-mix(in srgb, var(--gc-err) 8%, transparent);border:1.5px solid var(--gc-err);border-radius:8px;padding:8px 12px;font-size:12.5px">
        🔥 <b>GARGALO:</b> ${esc(garg.nome)} → ${esc(proxDe(garg.nome))} passa só <b>${fN(garg.passagem_pct)}%</b> (${fN(garg.abertos)} parado(s) na lane agora).
        <b>O que fazer:</b> ${esc(rec)}.</div>` : ''}
      <div class="tiny muted gc-nota" style="margin-top:6px">Barra = quantos deals ALCANÇARAM a etapa (abertos de agora + ganhos do ano; aproximação pela etapa atual — dado real, sem invenção). ↓% = passagem pra próxima etapa. “Abertos” = parados na lane HOJE, igual ao RD.</div>`, 'funil_' + tk);
  };
  return teams.map(bloco).join('');
}

/* ── 🔀 FONTES & FUNIL: qual origem converte visita/pasta/venda ── */
function tabFontes() {
  const pod = _v.fontes?.podio || {};
  const medal = (arr, campo) => (arr || []).map((f, i) => `<div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:8px;padding:6px 10px">
      <span style="font-size:16px">${['🥇', '🥈', '🥉'][i]}</span><b style="flex:1;font-size:12.5px">${esc(f.label)}</b>
      <span style="font-weight:900">${fN(f[campo])}%</span><span class="tiny muted">(${fN(f.leads)} leads · ${fN(f.venda)} vendas)</span></div>`).join('') || '<div class="tiny muted">Sem fonte com amostra suficiente na janela.</div>';
  const tabela = (lista) => `<div style="overflow-x:auto"><table>
    <thead><tr style="text-align:right"><th style="text-align:left">Origem</th><th>Leads</th><th>Agend.</th><th>Visitas</th><th>Pastas</th><th>Vendas</th><th>%→Visita</th><th>%→Pasta</th><th>%→Venda</th><th>VGV</th></tr></thead>
    <tbody>${(lista || []).map(f => `<tr${f.rankeavel ? '' : ' style="opacity:.55" title="amostra pequena — fora do pódio"'}>
      <td style="font-weight:600;font-size:12px;padding:4px 6px 4px 0">${esc(f.label)}${f.rankeavel ? '' : ' <span class="tiny">⚠</span>'}</td>
      <td style="text-align:right;font-size:12px">${fN(f.leads)}</td><td style="text-align:right;font-size:12px">${fN(f.agend)}</td>
      <td style="text-align:right;font-size:12px">${fN(f.visita)}</td><td style="text-align:right;font-size:12px">${fN(f.pasta)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(f.venda)}</td>
      <td style="text-align:right;font-size:12px">${f.pc_visita != null ? fN(f.pc_visita) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">${f.pc_pasta != null ? fN(f.pc_pasta) + '%' : '—'}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${f.pc_venda != null ? fN(f.pc_venda) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(f.vgv)}</td></tr>`).join('')}</tbody></table></div>`;
  const porEquipe = ['conquista', 'map', 'terceiros', 'locacao'].filter(t => _v.fontes?.[t]?.length)
    .map(t => pan(`${TEAM_LBL[t]} — funil por origem (safra da janela)`, tabela(_v.fontes[t]), 'fontes_' + t)).join('');
  return `
    ${pan('🏅 Pódio das fontes (safra da janela, amostra mínima ' + 30 + ' leads)', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">🚶 CONVERTE MAIS VISITA</div><div style="display:grid;gap:4px">${medal(pod.visita, 'pc_visita')}</div></div>
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">📁 CONVERTE MAIS PASTA</div><div style="display:grid;gap:4px">${medal(pod.pasta, 'pc_pasta')}</div></div>
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">💰 CONVERTE MAIS VENDA</div><div style="display:grid;gap:4px">${medal(pod.venda, 'pc_venda')}</div></div>
      </div>`, 'podio_fontes')}
    ${pan('🌎 Geral — todas as equipes', tabela(_v.fontes?.geral), 'fontes_geral')}
    ${porEquipe}
    <div class="tiny muted gc-nota" style="margin-top:6px">Safra = lead NASCIDO na janela, acompanhado até hoje (fontes se comparam por coorte; visão instantânea mente com jornada de meses). Linhas apagadas = amostra pequena. Sem fonte e Outro contam como <b>Tráfego pago Imob</b> (regra 15/ago).</div>
    ${histFontes()}`;
}

/* 📆 histórico por ORIGEM (leads criados e vendas convertidas por mês — o Paulo
   tinha razão: data de conversão + origem de cada negociação resolvem) */
function histFontes() {
  const hs = _v.historico || [];
  const lblCanal = {};
  (_v.fontes?.geral || []).forEach(f => { lblCanal[f.canal] = f.label; });
  const tot = {};
  hs.forEach(h => Object.entries(h.canais || {}).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + (v.leads || 0); }));
  const canais = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, 8);
  if (!canais.length) return '';
  return histTable('Fontes — leads que ENTRARAM por origem, mês a mês',
    canais.map(k => ({ lbl: lblCanal[k] || k, get: h => h.canais?.[k]?.leads, fmt: fN })), 'hist_fontes_leads')
    + histTable('Fontes — VENDAS convertidas por origem (mês da conversão)',
      canais.map(k => ({ lbl: lblCanal[k] || k, get: h => h.canais?.[k]?.vendas, fmt: fN })), 'hist_fontes_vendas');
}

/* ── 💰 CUSTO DO FUNIL: R$ por etapa + CAC mídia/completo (mês corrente) ── */
function tabCustos() {
  const c = _v.custos || {};
  const rows = (c.equipes || []).map(e => `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${e.label}<div class="tiny muted">${e.conta ? 'conta ' + esc(e.conta) : 'sem conta Meta'}</div></td>
      <td style="text-align:right;font-size:12px">R$ ${brl(e.spend)}<div class="tiny muted">+ fixo R$ ${kR$(e.fixo_mes)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_lead != null ? 'R$ ' + brl(e.custo_lead) : '—'}<div class="tiny muted">${fN(e.leads)} leads</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_agend != null ? 'R$ ' + brl(e.custo_agend) : '—'}<div class="tiny muted">${fN(e.agend)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_visita != null ? 'R$ ' + brl(e.custo_visita) : '—'}<div class="tiny muted">${fN(e.visita)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_pasta != null ? 'R$ ' + brl(e.custo_pasta) : '—'}<div class="tiny muted">${fN(e.pasta)}</div></td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:var(--gc-warn)">${e.cac_midia != null ? 'R$ ' + kR$(e.cac_midia) : '—'}<div class="tiny muted">${fN(e.vendas_pagas || 0)} venda(s) de tráfego</div></td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:var(--gc-acc2)">${e.cac_marketing != null ? 'R$ ' + kR$(e.cac_marketing) : '—'}<div class="tiny muted">🎁 R$ ${kR$(e.premiacao_indicacao || 0)} (${fN(e.vendas_indicacao || 0)} indicação)</div></td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:var(--gc-err)">${e.cac_completo != null ? 'R$ ' + kR$(e.cac_completo) : '—'}<div class="tiny muted">${fN(e.vendas)} venda(s) no mês</div></td>
    </tr>`).join('');
  return pan(`💰 Unit economics do mês (${c.mes || ''}) — do lead ao CAC, por equipe`, `
    <div style="overflow-x:auto"><table>
      <thead><tr style="text-align:right"><th style="text-align:left">Equipe</th><th>Spend Meta</th><th>R$/lead</th><th>R$/agendamento</th><th>R$/visita</th><th>R$/pasta</th><th>CAC mídia</th><th>CAC marketing</th><th>CAC completo</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${c.payback_midia ? `<div class="tiny" style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:6px 10px">💸 <b>Payback de mídia:</b> a venda vira caixa em mediana <b>${fN(c.payback_midia.mediana_dias)} dias</b> (${esc(c.payback_midia.fonte)}, n=${fN(c.payback_midia.n)}) — é o tempo entre o real investido e o real voltando.</div>` : ''}
    <div class="tiny muted gc-nota" style="margin-top:6px">${esc(c.nota || '')}. Qualificado começa no AGENDAMENTO (decisão 14/ago). <b>CAC mídia</b> = spend ÷ vendas de TRÁFEGO PAGO · <b>CAC marketing</b> = (spend + 🎁 premiação de indicação pela faixa de VGV — só venda de origem INDICAÇÃO, tabela oficial) ÷ todas as vendas · <b>CAC completo</b> = (spend + premiação + fixo orçado da linha) ÷ todas as vendas (decisões 17/ago).</div>`, 'unit_economics')
    + histTable('Custo — mês a mês (global desde jan · POR EQUIPE desde ago/2026 — snapshot horário do cron)', [
      { lbl: 'Spend Meta', get: h => h.total?.spend, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'CPL global', get: h => h.total?.cpl_global, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'CAC global (mídia)', get: h => h.total?.cac_global, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'Vendas TOTAL', get: h => h.total?.vendas, fmt: fN },
      ...['conquista', 'map', 'terceiros', 'locacao'].filter(t => (_v.historico || []).some(h => h.equipes?.[t]?.spend != null)).flatMap(t => [
        { lbl: (TEAM_LBL[t] || t) + ' spend', get: h => h.equipes?.[t]?.spend, fmt: x => 'R$ ' + kR$(x), invertido: true },
        { lbl: (TEAM_LBL[t] || t) + ' CAC mídia', get: h => h.equipes?.[t]?.cac_midia, fmt: x => 'R$ ' + kR$(x), invertido: true },
      ]),
    ], 'historico_custo');
}

/* ── 🪜 ESTEIRA INDIVIDUAL: o funil de CADA corretor, medido por FLUXO ──
   A aba Produtividade responde "a safra que nasceu na janela rendeu o quê?".
   Esta responde "o que esta pessoa FEZ na janela?" — que é a pergunta do 1:1
   e a régua que o gestor usa na planilha dele.
   Diferença que mais confunde: aqui as etapas NÃO são subconjuntos. A pasta de
   agosto pode ser de um lead de abril, e pode nunca ter tido visita registrada.
   Por isso "10 pastas com 5 visitas" é resultado legítimo, não erro. */
function tabEsteira() {
  const E = _v.esteira || {};
  const corrs = E.corretores || [];
  const eqs = E.equipes || {};
  const pcc = x => x == null ? '<span class="muted">—</span>' : fN(x) + '%';
  const pv = x => x == null ? '<span class="muted">—</span>' : fN(x);

  const linha = (c, ehEquipe) => {
    const st = ehEquipe ? 'font-weight:800;background:var(--bg-3)' : '';
    const p = c.por_venda || {}, cv = c.conv || {};
    return `<tr style="${st}">
      <td style="font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${ehEquipe ? '' : '　'}${esc(c.nome)}${ehEquipe ? '' : ` <span class="tiny muted">${(TEAM_LBL[c.team] || c.team || '').replace(/^..\s/, '')}</span>`}</td>
      <td style="text-align:right;font-size:12px">${fN(c.prospec)}</td>
      <td style="text-align:right;font-size:12px">${fN(c.qualif)}</td>
      <td style="text-align:right;font-size:12px">${fN(c.visita)}</td>
      <td style="text-align:right;font-size:12px">${fN(c.pasta)}</td>
      <td style="text-align:right;font-size:12px;font-weight:800">${fN(c.venda)}</td>
      <td style="text-align:right;font-size:11.5px;color:var(--ink-muted)">${pcc(cv.prospec_qualif)}</td>
      <td style="text-align:right;font-size:11.5px;color:var(--ink-muted)">${pcc(cv.qualif_visita)}</td>
      <td style="text-align:right;font-size:11.5px;color:var(--ink-muted)">${pcc(cv.visita_pasta)}</td>
      <td style="text-align:right;font-size:11.5px;color:var(--ink-muted)">${pcc(cv.pasta_venda)}</td>
      <td style="text-align:right;font-size:12px">${pv(p.prospec)}</td>
      <td style="text-align:right;font-size:12px">${pv(p.visita)}</td>
      <td style="text-align:right;font-size:12px">${pv(p.pasta)}</td>
      <td style="text-align:right;font-size:12px">${c.ticket ? 'R$ ' + kR$(c.ticket) : '—'}</td>
    </tr>`;
  };

  // equipe primeiro, corretores dela logo abaixo — leitura de gestor
  const ordem = ['conquista', 'map', 'terceiros', 'locacao'];
  const blocos = ordem.filter(t => eqs[t] || corrs.some(c => c.team === t)).map(t => {
    const cab = eqs[t] ? linha({ ...eqs[t], nome: TEAM_LBL[t] || t }, true) : '';
    return cab + corrs.filter(c => c.team === t).map(c => linha(c, false)).join('');
  }).join('');

  const semHist = corrs.reduce((a, c) => a + (c.sem_historico || 0), 0);
  const aviso = semHist
    ? `<div class="tiny" style="margin-top:6px;color:var(--gc-warn)">⚠️ ${fN(semHist)} venda(s) da janela sem NENHUMA etapa datada no histórico do RD — entraram na coluna Vendas, mas não têm prospecção/visita/pasta para somar. Quanto mais o funil for movimentado no RD de verdade, mais fiel fica esta tabela.</div>`
    : '';

  return pan(`🪜 Esteira individual — o que cada um FEZ na janela${E.restrito_a ? ` · <span class="tiny" style="color:var(--gc-warn)">visão restrita à sua equipe</span>` : ''}`, `
    <div style="overflow-x:auto"><table>
      <thead>
        <tr style="text-align:right">
          <th style="text-align:left" rowspan="2">Corretor / Equipe</th>
          <th colspan="5" style="text-align:center;padding-bottom:2px">ETAPAS NO PERÍODO</th>
          <th colspan="4" style="text-align:center;padding-bottom:2px">CONVERSÃO ENTRE ETAPAS</th>
          <th colspan="3" style="text-align:center;padding-bottom:2px">QUANTOS PARA 1 VENDA</th>
          <th rowspan="2">Ticket</th>
        </tr>
        <tr style="text-align:right">
          <th>Prospecções</th><th>Qualificados</th><th>Visitas</th><th>Pastas</th><th>Vendas</th>
          <th>Prosp→Qual</th><th>Qual→Visita</th><th>Visita→Pasta</th><th>Pasta→Venda</th>
          <th>Prospec.</th><th>Visitas</th><th>Pastas</th>
        </tr>
      </thead>
      <tbody>${blocos || '<tr><td class="tiny muted" colspan="14">sem movimentação de etapas na janela</td></tr>'}</tbody>
    </table></div>
    <div class="tiny muted gc-nota" style="margin-top:6px"><b>Como ler:</b> cada etapa conta quando o negócio CHEGA nela pela primeira vez dentro da janela — a visita de hoje pode ser de um lead de abril, e a pasta de hoje pode nunca ter tido visita registrada. Por isso as colunas <b>não</b> caem sempre em cascata: mais pastas que visitas no mesmo mês é normal e não é erro de conta.</div>
    <div class="tiny muted gc-nota" style="margin-top:6px">É diferente da aba 📊 Produtividade de propósito: lá a conta é por <b>safra</b> (o que os leads nascidos na janela renderam), aqui é por <b>fluxo</b> (o que a pessoa fez na janela). Safra serve pra avaliar origem de lead; fluxo serve pra cobrar rotina no 1:1.</div>
    ${aviso}`, 'esteira_individual');
}

/* ── 📊 PRODUTIVIDADE: razões por corretor e equipe ── */
function tabProd() {
  const p = _v.produtividade || {};
  const eq = p.equipes || {};
  const eqRows = Object.keys(eq).map(t => {
    const e = eq[t];
    return `<tr style="font-weight:700;background:var(--bg-3)">
      <td style="font-size:12.5px;padding:5px 8px 5px 0">${TEAM_LBL[t] || t}</td>
      <td></td>
      <td style="text-align:right">${fN(e.leads)}</td><td style="text-align:right">${fN(e.venda)}</td>
      <td style="text-align:right">${e.leads_por_venda ?? '—'}</td><td style="text-align:right">${e.atend_por_venda ?? '—'}</td>
      <td style="text-align:right">${e.visitas_por_venda ?? '—'}</td><td style="text-align:right">${e.pastas_por_venda ?? '—'}</td>
      <td style="text-align:right">${e.dias_por_venda != null ? fN(e.dias_por_venda) + 'd' : '—'}</td>
      <td style="text-align:right;font-size:11px;white-space:nowrap">${fmtDHM(e.contato_h_mediana)}</td>
      <td style="text-align:right">${e.ticket ? 'R$ ' + kR$(e.ticket) : '—'}</td><td style="text-align:right">R$ ${kR$(e.vgv)}</td></tr>`;
  }).join('');
  const rows = (p.corretores || []).map(cr => {
    const chips = (cr.canais || []).filter(c => c.vendas > 0).map(c =>
      `<span style="display:inline-block;white-space:nowrap;background:var(--bg-2);border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:10.5px;margin:1px">${esc(c.label)}: <b>${fN(c.share_vendas_pct)}%</b> das vendas · conv ${c.conv_pct != null ? fN(c.conv_pct) + '%' : '—'}</span>`).join('');
    return `<tr>
      <td style="font-size:12px;padding:4px 8px 4px 0;min-width:240px;max-width:360px">${esc(cr.nome)} <span class="tiny muted">${(TEAM_LBL[cr.team] || cr.team || '').replace(/^..\s/, '')}</span>
        ${chips ? `<div style="margin-top:2px">${chips}</div>` : ''}</td>
      <td style="font-size:11.5px;font-weight:800;color:var(--gc-ok);white-space:nowrap">${cr.top_canal ? '🏆 ' + esc(cr.top_canal) : '—'}</td>
      <td style="text-align:right;font-size:12px">${fN(cr.leads)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(cr.venda)}</td>
      <td style="text-align:right;font-size:12px">${cr.leads_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.atend_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.visitas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.pastas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.dias_por_venda != null ? fN(cr.dias_por_venda) + 'd' : '—'}</td>
      <td style="text-align:right;font-size:11px;white-space:nowrap">${fmtDHM(cr.contato_h_mediana)}</td>
      <td style="text-align:right;font-size:12px">${cr.ticket ? 'R$ ' + kR$(cr.ticket) : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(cr.vgv)}</td>
    </tr>`;
  }).join('');
  return pan(`📊 Quantos X pra 1 venda — equipe e corretor (safra da janela)${p.restrito_a ? ` · <span class="tiny" style="color:var(--gc-warn)">visão restrita à sua equipe (${p.restrito_a})</span>` : ''}`, `
    <div style="overflow-x:auto"><table>
      <thead><tr style="text-align:right"><th style="text-align:left">Corretor / Equipe</th><th style="text-align:left">Canal 🏆 (converte melhor)</th><th>Leads</th><th>Vendas</th><th>Leads/venda</th><th>Atend./venda</th><th>Visitas/venda</th><th>Pastas/venda</th><th>Dias p/ venda</th><th>1º contato</th><th>Ticket</th><th>VGV</th></tr></thead>
      <tbody>${eqRows}${rows}</tbody></table></div>
    <div class="tiny muted gc-nota" style="margin-top:6px">Razões calculadas na safra da janela (lead nascido nela). Corretor sem venda na safra mostra — (sem denominador não há razão honesta).</div>`, 'produtividade')
    + histTable('Produção — mês a mês', [
      ...['conquista', 'map', 'terceiros', 'locacao'].map(t => ({ lbl: (TEAM_LBL[t] || t) + ' vendas', get: h => h.equipes?.[t]?.vendas, fmt: fN })),
      { lbl: 'TOTAL vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'TOTAL VGV', get: h => h.total?.vgv, fmt: x => 'R$ ' + kR$(x) },
    ], 'historico_producao');
}

/* ── 📈 SAFRAS & TEMPOS ── */
function tabSafras() {
  const rows = (_v.safras || []).map(s => `<tr>
      <td style="font-weight:700;font-size:12px;padding:4px 8px 4px 0">${mesNome(s.ym)}</td>
      <td style="text-align:right;font-size:12px">${fN(s.leads)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(s.vendas)}</td>
      <td style="text-align:right;font-size:12px">${s.pc != null ? fN(s.pc) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(s.vgv)}</td>
      <td style="text-align:right;font-size:12px">${s.dias_medio != null ? fN(s.dias_medio) + 'd' : '—'}</td>
    </tr>`).join('');
  const tempos = Object.keys(_v.tempos || {}).map(t => `
    <div><div class="tiny" style="font-weight:800;margin-bottom:4px">${TEAM_LBL[t] || t}</div>
      ${(_v.tempos[t] || []).map(l => `<div style="display:flex;justify-content:space-between;font-size:12px;border-bottom:1px dashed var(--border);padding:3px 0">
        <span>${esc(l.passo)}</span><span><b>${l.mediana_h != null ? fmtDHM(l.mediana_h) : '—'}</b> <span class="tiny muted">n=${l.n}</span></span></div>`).join('')}
    </div>`).join('');
  const resp = _v.resposta || {};
  const linhaR = (lbl, val) => `<div style="display:flex;justify-content:space-between;font-size:12px;border-bottom:1px dashed var(--border);padding:3px 0"><span>${lbl}</span><b style="white-space:nowrap">${val}</b></div>`;
  const respBlocos = Object.keys(resp).filter(t => (resp[t] || {}).n_mediveis).map(t => {
    const r = resp[t];
    return `<div><div class="tiny" style="font-weight:800;margin-bottom:4px">${TEAM_LBL[t] || t} <span class="muted">(${fN(r.n_mediveis)} medíveis)</span></div>
      ${linhaR('Mediana', fmtDHM(r.mediana_h))}
      ${linhaR('Média', fmtDHM(r.media_h))}
      ${linhaR('P25 → P75', fmtDHM(r.p25_h) + ' → ' + fmtDHM(r.p75_h))}
      ${linhaR('Mais rápido · mais lento', fmtDHM(r.mais_rapido_h) + ' · ' + fmtDHM(r.mais_lento_h))}
      ${linhaR('Conv. metade RÁPIDA', `<span style="color:var(--gc-ok)">${r.conv_rapidos_pct != null ? fN(r.conv_rapidos_pct) + '%' : '—'}</span>`)}
      ${linhaR('Conv. metade LENTA', `<span style="color:var(--gc-err)">${r.conv_lentos_pct != null ? fN(r.conv_lentos_pct) + '%' : '—'}</span>`)}
      ${linhaR('Nasceram já em atendimento', fN(r.nasceram_na_etapa))}
      ${linhaR('SEM 1º contato até hoje', `<span style="color:var(--gc-err)">${fN(r.sem_contato)}</span>`)}
    </div>`;
  }).join('');
  // 🏃 performance individual: janela atual × base 90d anterior — POR EQUIPE
  // (v86.33, pedido 17/ago: nichos diferentes não se misturam; desligado não
  // entra aqui — a análise dele vive só no 🚪 Turnover)
  const perf = _v.performance_corretores || [];
  const perfRow = c => {
    const dl = v => v == null ? '<span class="tiny muted">novo</span>' : `<span class="tiny" style="font-weight:800;color:${v >= 0 ? 'var(--gc-ok)' : 'var(--gc-err)'}">${v >= 0 ? '▲' : '▼'} ${fN(Math.abs(v))}%</span>`;
    const b = c.base_ajustada || c.base;   // v86.37: base AJUSTADA ao tamanho da janela
    return `<tr>
      <td style="font-size:12px;font-weight:600;padding:4px 8px 4px 0;white-space:nowrap">${esc(c.nome)}</td>
      <td style="text-align:right;font-size:12px">${fN(c.atual.leads)} <span class="tiny muted">/ ${fN(b.leads)}</span></td>
      <td style="text-align:right;font-weight:800;font-size:12.5px">${fN(c.atual.vendas)} <span class="tiny muted">/ ${fN(b.vendas)}</span></td>
      <td style="text-align:right">${dl(c.delta_vendas_pct)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(c.atual.vgv)} <span class="tiny muted">/ R$ ${kR$(b.vgv)}</span></td>
      <td style="text-align:right">${dl(c.delta_vgv_pct)}</td>
      <td style="text-align:right;font-size:12px">${c.atual.conv_pct != null ? fN(c.atual.conv_pct) + '%' : '—'} <span class="tiny muted">/ ${b.conv_pct != null ? fN(b.conv_pct) + '%' : '—'}</span></td>
    </tr>`;
  };
  const perfDias = perf[0]?.janela_dias;
  const perfCab = `<thead><tr style="text-align:right"><th style="text-align:left">Corretor</th><th>Leads</th><th>Vendas</th><th>Δ vendas</th><th>VGV</th><th>Δ VGV</th><th>Conv.</th></tr></thead>`;
  const perfBlocos = ['conquista', 'map', 'terceiros', 'locacao'].filter(t => perf.some(c => c.team === t)).map(t =>
    pan(`🏃 Performance individual — ${TEAM_LBL[t]} (janela atual × base 90d AJUSTADA ao período, atual / base)`, `
      <div style="overflow-x:auto"><table>${perfCab}
        <tbody>${perf.filter(c => c.team === t).map(perfRow).join('')}</tbody></table></div>
      <div class="tiny muted gc-nota" style="margin-top:6px">A base é a média móvel dos 90 dias anteriores do PRÓPRIO corretor, <b>proporcionalizada ao tamanho da janela${perfDias ? ` (${fN(perfDias)}d → base × ${fN(Math.round(perfDias / 90 * 100))}%)` : ''}</b> — sem isso, janela curta contra base de 90d dava queda falsa pra todo mundo. Cada equipe é um nicho: não compare entre quadros. Só corretores ATIVOS — quem saiu aparece no 🚪 Turnover.</div>`, 'perf_' + t)).join('');
  // ⏱ ritmo de venda: 1ª venda e cadência — individual × equipe (v86.39)
  const rv = _v.ritmo_vendas || {};
  const dM = d => d == null ? '—' : `${fN(d)}d <span class="tiny muted">(~${(d / 30.44).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m)</span>`;
  const rvRows = t => {
    const eq = (rv.equipes || {})[t] || {};
    const linhaEq = `<tr style="font-weight:700;background:var(--bg-3)">
      <td style="font-size:12.5px;padding:5px 8px 5px 0">${TEAM_LBL[t] || t} <span class="tiny muted" style="font-weight:400">(${fN(eq.n || 0)} corretores — média da equipe)</span></td>
      <td style="text-align:right">—</td>
      <td style="text-align:right">${dM(eq.media_dias_1a_venda)}<div class="tiny muted" style="font-weight:400">mediana ${dM(eq.mediana_dias_1a_venda)}</div></td>
      <td style="text-align:right">—</td>
      <td style="text-align:right">${dM(eq.intervalo_medio_d)}</td>
      <td style="text-align:right">${dM(eq.dias_por_venda_medio)}</td>
      <td style="text-align:right">—</td>
    </tr>`;
    const linhas = (rv.corretores || []).filter(c => c.team === t).map(c => `<tr>
      <td style="font-size:12px;font-weight:600;padding:4px 8px 4px 0;white-space:nowrap">${esc(c.nome)}</td>
      <td style="text-align:right;font-size:12px">${dM(c.tempo_casa_d)}</td>
      <td style="text-align:right;font-size:12px;font-weight:800">${dM(c.dias_ate_1a_venda)}</td>
      <td style="text-align:right;font-size:12px">${fN(c.vendas_total)}</td>
      <td style="text-align:right;font-size:12px">${dM(c.intervalo_medio_d)}</td>
      <td style="text-align:right;font-size:12px">${dM(c.dias_por_venda)}</td>
      <td style="text-align:right;font-size:12px;color:${c.dias_desde_ultima_venda == null ? 'var(--ink-muted)' : c.dias_desde_ultima_venda > 90 ? 'var(--gc-err)' : c.dias_desde_ultima_venda > 45 ? 'var(--gc-warn)' : 'var(--gc-ok)'};font-weight:700">${c.dias_desde_ultima_venda != null ? fN(c.dias_desde_ultima_venda) + 'd' : 'nunca vendeu'}</td>
    </tr>`).join('');
    const semVenda = (eq.sem_venda || []).length ? `<div class="tiny" style="margin-top:6px;color:var(--gc-warn);font-weight:700">⏳ Ainda sem 1ª venda: ${eq.sem_venda.map(x => `${esc(x.nome)} (${fN(x.dias)}d de casa)`).join(' · ')}</div>` : '';
    return `<div style="overflow-x:auto"><table>
      <thead><tr style="text-align:right"><th style="text-align:left">Corretor / Equipe</th><th>Tempo de casa</th><th>1ª venda em</th><th>Vendas</th><th>Entre vendas (média)</th><th>Dias p/ venda</th><th>Desde a última</th></tr></thead>
      <tbody>${linhaEq}${linhas}</tbody></table></div>${semVenda}`;
  };
  const rvBlocos = ['conquista', 'map', 'terceiros', 'locacao'].filter(t => (rv.corretores || []).some(c => c.team === t)).map(t =>
    pan(`⏱ Ritmo de venda — ${TEAM_LBL[t]} (1ª venda e cadência · histórico completo da base)`, rvRows(t) + `
      <div class="tiny muted gc-nota" style="margin-top:6px">${esc(rv.nota || '')}</div>`, 'ritmo_' + t)).join('');
  // 🚪 turnover ciclo 90d
  const to = _v.turnover || {};
  const toCor = to.dias_desde_ultima == null ? 'var(--ink-muted)' : to.dias_desde_ultima >= (to.regra_dias || 90) ? 'var(--gc-err)' : to.dias_desde_ultima >= 60 ? 'var(--gc-warn)' : 'var(--gc-ok)';
  const toBloco = pan('🚪 Turnover — regra da casa: 1 saída a cada ~90 dias', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px;text-align:center">
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:19px;font-weight:900">${to.intervalo_medio_dias != null ? fN(to.intervalo_medio_dias) + 'd' : '—'}</div><div class="tiny muted">ciclo REAL medido (média entre saídas)</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:19px;font-weight:900;color:${toCor}">${to.dias_desde_ultima != null ? fN(to.dias_desde_ultima) + 'd' : '—'}</div><div class="tiny muted">desde a última saída (régua: ${to.regra_dias || 90}d)</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:19px;font-weight:900">${fN((to.saidas || []).length)}</div><div class="tiny muted">saídas identificadas</div></div>
    </div>
    ${to.tempo_casa_medio_d != null ? `<div class="tiny" style="margin-bottom:8px;background:var(--bg-3);border-radius:8px;padding:6px 10px">🏠 <b>Tempo de casa médio de quem saiu:</b> ${fN(to.tempo_casa_medio_d)}d (~${(to.tempo_casa_medio_d / 30.44).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses)</div>` : ''}
    ${(to.saidas || []).length ? `<div class="tiny" style="font-weight:800;margin-bottom:4px">Saídas (última atividade no CRM · histórico completo):</div>
      <div>${to.saidas.map(x => `<span style="display:inline-block;background:var(--bg-3);border-radius:999px;padding:2px 10px;font-size:11.5px;margin:2px">${esc(x.nome)} · ${(TEAM_LBL[x.team] || x.team || '').replace(/^..\s/, '')} · saiu ${x.ultima_atividade}${x.tempo_casa_d != null ? ` · ${fN(x.tempo_casa_d)}d de casa` : ''} · ${fN(x.vendas_na_passagem || 0)} venda(s)${x.dias_ate_1a_venda != null ? ` · 1ª em ${fN(x.dias_ate_1a_venda)}d` : ''}</span>`).join('')}</div>` : ''}
    ${(to.ativos_risco || []).length ? `<div class="tiny" style="font-weight:800;margin:8px 0 4px;color:var(--gc-warn)">⚠ Ativos em zona de atenção (90d+ sem venda com volume de lead):</div>
      <div>${to.ativos_risco.map(x => `<span style="display:inline-block;background:color-mix(in srgb, var(--gc-warn) 12%, transparent);border:1px solid var(--gc-warn);border-radius:999px;padding:2px 10px;font-size:11.5px;margin:2px;font-weight:700">${esc(x.nome)} · ${fN(x.leads_janela)} leads · 0 vendas/90d</span>`).join('')}</div>` : ''}
    <div class="tiny muted gc-nota" style="margin-top:6px">${esc(to.nota || '')} Tempo de casa/média entre saídas e desligados vivem AQUI — performance individual acima é só de ativos.</div>`, 'turnover');
  return `
    ${perfBlocos}
    ${rvBlocos}
    ${toBloco}
    ${pan('📈 Safras — cada mês de lead, o que virou até hoje', `
      <div style="overflow-x:auto"><table>
        <thead><tr style="text-align:right"><th style="text-align:left">Safra</th><th>Leads</th><th>Vendas até hoje</th><th>Conv.</th><th>VGV</th><th>Lead→venda</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="tiny muted gc-nota" style="margin-top:6px">Safras recentes SEMPRE parecem piores — o lead ainda não teve tempo de maturar (MAP ~3 meses). Compare safras da mesma idade.</div>`, 'safras_meses')}
    ${pan('⏱ Tempo mediano entre etapas (esteira — onde empaca)', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${tempos}</div>`, 'tempos_etapas')}
    ${histTable('Ano — leads × vendas × ticket', [
      { lbl: 'Leads', get: h => h.total?.leads, fmt: fN },
      { lbl: 'Vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'Ticket', get: h => h.total?.ticket, fmt: x => 'R$ ' + kR$(x) },
    ], 'historico_ano')}`;
}

/* ── 📈 GRÁFICOS DE TUDO (v86.33, pedido 17/ago): o painel inteiro em visual ── */

/* ═══════════ GRÁFICOS (Chart.js) ═══════════ */
const TEAM_CORES = { conquista: '#60a5fa', map: '#a78bfa', terceiros: '#fbbf24', locacao: '#34d399', outros: '#64748b' };
const CORES8 = ['#60a5fa', '#a78bfa', '#fbbf24', '#34d399', '#f87171', '#38bdf8', '#f472b6', '#94a3b8'];

function gwrap(canvases, titulo, srId, alto) {
  const cv = (Array.isArray(canvases) ? canvases : [canvases])
    .map(id => `<div style="position:relative;height:${alto || 280}px;flex:1;min-width:min(320px,100%)"><canvas id="${id}"></canvas></div>`).join('');
  return pan(titulo, `<div style="display:flex;flex-wrap:wrap;gap:12px">${cv}</div>`, srId);
}


let _gcharts = [];
async function initCharts() {
  let Chart;
  try { Chart = await loadChartLib(); } catch (_) { return; }
  _gcharts.forEach(c => { try { c.destroy(); } catch (_) {} });
  _gcharts = [];
  const cs = getComputedStyle(document.documentElement);
  const ink = (cs.getPropertyValue('--ink-muted') || '#8f95ab').trim();
  const grid = document.documentElement.classList.contains('dark') ? 'rgba(148,163,184,.14)' : 'rgba(100,116,139,.14)';
  const base = extra => ({ responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: ink, font: { size: 11 }, boxWidth: 12 } } }, ...(extra || {}) });
  const sc = y2 => {
    const s = { x: { ticks: { color: ink, font: { size: 10 } }, grid: { color: grid } },
                y: { ticks: { color: ink, font: { size: 10 } }, grid: { color: grid }, beginAtZero: true } };
    if (y2) s.y2 = { position: 'right', ticks: { color: ink, font: { size: 10 } }, grid: { drawOnChartArea: false }, beginAtZero: true };
    return s;
  };
  const mk = (id, cfg) => { const el = scopeEl().querySelector('#' + id); if (el) _gcharts.push(new Chart(el, cfg)); };   // v86.61: busca no ESCOPO (TV ficava em branco desenhando no canvas escondido)
  const sigla = l => String(l || '').replace(/^[^\s]+\s/, '');
  const teams = ['conquista', 'map', 'terceiros', 'locacao'];
  const hs = _v.historico || [];
  const meses = hs.map(h => mesNome(h.ym).slice(0, 3));

  mk('gch-hist', { type: 'bar', data: { labels: meses, datasets: [
    ...teams.map(t => ({ label: sigla(TEAM_LBL[t]), data: hs.map(h => h.equipes?.[t]?.vendas || 0), backgroundColor: TEAM_CORES[t], stack: 'v' })),
    { type: 'line', label: 'VGV total (R$)', data: hs.map(h => h.total?.vgv || 0), borderColor: '#38bdf8', backgroundColor: '#38bdf8', yAxisID: 'y2', tension: .3 },
  ] }, options: base({ scales: sc(true) }) });

  mk('gch-leads', { type: 'bar', data: { labels: meses, datasets: [
    { label: 'Leads', data: hs.map(h => h.total?.leads || 0), backgroundColor: '#60a5fa' },
    { type: 'line', label: 'Spend Meta (R$)', data: hs.map(h => h.total?.spend || 0), borderColor: '#f59e0b', backgroundColor: '#f59e0b', yAxisID: 'y2', tension: .3 },
  ] }, options: base({ scales: sc(true) }) });

  const eq = (_v.produtividade || {}).equipes || {};
  const etapas = [['leads', 'Leads'], ['atend', 'Atend.'], ['agend', 'Agend.'], ['visita', 'Visitas'], ['pasta', 'Pastas'], ['venda', 'Vendas']];
  mk('gch-funil', { type: 'bar', data: { labels: etapas.map(e => e[1]),
    datasets: teams.filter(t => eq[t] && eq[t].leads).map(t => ({ label: sigla(TEAM_LBL[t]), data: etapas.map(e => eq[t][e[0]] || 0), backgroundColor: TEAM_CORES[t] })) },
    options: base({ scales: sc() }) });

  const fg = ((_v.fontes || {}).geral || []).slice(0, 8);
  mk('gch-fontes', { type: 'doughnut', data: { labels: fg.map(f => f.label), datasets: [{ data: fg.map(f => f.leads), backgroundColor: CORES8 }] },
    options: base({ plugins: { legend: { position: 'right', labels: { color: ink, font: { size: 10 }, boxWidth: 10 } } } }) });
  mk('gch-fontes-conv', { type: 'bar', data: { labels: fg.map(f => f.label), datasets: [
    { label: '%→Visita', data: fg.map(f => f.pc_visita || 0), backgroundColor: '#60a5fa' },
    { label: '%→Venda', data: fg.map(f => f.pc_venda || 0), backgroundColor: '#22c55e' },
  ] }, options: base({ indexAxis: 'y', scales: sc() }) });

  const sf = _v.safras || [];
  mk('gch-safras', { type: 'bar', data: { labels: sf.map(s => mesNome(s.ym).slice(0, 3)), datasets: [
    { label: 'Leads da safra', data: sf.map(s => s.leads), backgroundColor: '#94a3b8' },
    { type: 'line', label: 'Conv. até hoje (%)', data: sf.map(s => s.pc || 0), borderColor: '#22c55e', backgroundColor: '#22c55e', yAxisID: 'y2', tension: .3 },
  ] }, options: base({ scales: sc(true) }) });

  const ce = (_v.custos || {}).equipes || [];
  mk('gch-cac', { type: 'bar', data: { labels: ce.map(c => sigla(c.label)), datasets: [
    { label: 'CAC mídia (só vendas de tráfego)', data: ce.map(c => c.cac_midia ?? 0), backgroundColor: '#fbbf24' },
    { label: 'CAC marketing (+premiação indicação)', data: ce.map(c => c.cac_marketing ?? 0), backgroundColor: '#a78bfa' },
    { label: 'CAC completo (+fixo da linha)', data: ce.map(c => c.cac_completo ?? 0), backgroundColor: '#ef4444' },
  ] }, options: base({ scales: sc() }) });

  const ci = ((_v.campanhas || {}).itens || []).filter(x => x.venda > 0).slice(0, 10);
  mk('gch-camp', { type: 'bar', data: { labels: ci.map(x => x.campanha.slice(0, 30)), datasets: [
    { label: 'Vendas', data: ci.map(x => x.venda), backgroundColor: '#22c55e' },
  ] }, options: base({ indexAxis: 'y', scales: sc() }) });
}
