/* PSM-OS v2 — 📊 GESTÃO COMERCIAL (v86.19)
   Painel comercial por equipe/linha: Visão Geral (real × projetado × meta) ·
   Fontes & Funil (qual origem converte visita/pasta/venda) · Custo do Funil
   (R$/etapa + CAC mídia e completo) · Produtividade (razões por corretor) ·
   Safras & Tempos. Gate lvl>=5; individual restrito à equipe do gestor. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _tab = 'visao', _busy = false;
let _since = null, _until = null, _spendPreset = 'last_30d';
let _tv = false, _tvRotate = true, _tvTimer = null, _tvDataTimer = null, _tvTickTimer = null, _tvNextAt = 0;
const TV_ROT_MS = 20000, TV_REFRESH_MS = 300000;   // aba a cada 20s · dados a cada 5min

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fN = v => { const x = Number(v) || 0; return Number.isInteger(x) ? x.toLocaleString('pt-BR') : x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
const kR$ = v => { const n = Number(v) || 0, a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M'; if (a >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'; return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesNome = ym => { const m = parseInt(String(ym).slice(5, 7), 10); return MESES_NOME[m - 1] || ym; };
const fmtDHM = h => {   // horas → "00d 03h 27min" (formato exigido: duas casas em cada)
  if (h == null) return '—';
  const tot = Math.max(0, Math.round(h * 60)), d = Math.floor(tot / 1440), hh = Math.floor((tot % 1440) / 60), mm = tot % 60;
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d)}d ${p2(hh)}h ${p2(mm)}min`;
};
const TEAM_LBL = { conquista: '🏠 Conquista', map: '🏢 MAP', terceiros: '🤝 Terceiros', locacao: '🔑 Locação', outros: '— Outros' };

export async function pageGestaoComercial(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Gestão Comercial é para gestores, gerentes e sócios.</div>'; return; }
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
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message || e)}</div>`;
  } finally { _busy = false; }
}

function pan(title, inner) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;margin-top:12px">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">${title}</div>${inner}</div>`;
}

function render() {
  const d = _d;
  const tabs = [['visao', '🎯 Visão Geral'], ['funilrd', '⏬ Funil RD'], ['fontes', '🔀 Fontes & Funil'],
                ['camp', '📣 Campanhas'], ['custos', '💰 Custo do Funil'], ['prod', '📊 Produtividade'], ['safras', '📈 Safras & Tempos']];
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">📊 Gestão Comercial</h2>
        ${d.escopo ? `<span class="tiny" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:999px;padding:2px 10px;font-weight:800">🔒 visão da equipe ${(TEAM_LBL[d.escopo] || d.escopo).replace(/^..\s/, '')}</span>` : ''}
        <span class="tiny muted">coorte de ${fN(d.coorte_n)} leads · origem preenchida em ${d.cobertura_origem_pct != null ? fN(d.cobertura_origem_pct) + '%' : '—'} · ${d.janela.since} → ${d.janela.until}</span>
        <span style="flex:1"></span>
        <select class="select" id="gc-preset" style="width:auto;padding:4px 8px;font-size:12px">
          <option value="">Período…</option>
          <option value="semana">Semana atual</option>
          <option value="quinzena">Quinzena (15d)</option>
          <option value="mes">Mês atual</option>
          <option value="90d">Últimos 90d</option>
          <option value="tri">Trimestre atual</option>
          <option value="sem">Semestre atual</option>
          <option value="ytd">Janeiro até hoje</option>
        </select>
        <input type="date" class="input" id="gc-since" value="${_since}" style="width:auto;padding:4px 8px;font-size:12px">
        <input type="date" class="input" id="gc-until" value="${_until}" style="width:auto;padding:4px 8px;font-size:12px">
        <button class="btn btn-ghost btn-sm" id="gc-aplicar">Aplicar</button>
        <button class="btn btn-ghost btn-sm" id="gc-fresh" title="ignora o cache de 10min">🔄</button>
        <button class="btn btn-sm" id="gc-tv" style="background:#0f172a;color:#fff;font-weight:800">📺 TV</button>
      </div>
      ${(d.avisos || []).length ? `<div class="alert alert-warn tiny" style="margin-top:8px">${d.avisos.map(esc).join('<br>')}</div>` : ''}
      <div class="flex gap-1" style="margin-top:10px;flex-wrap:wrap">
        ${tabs.map(([id, l]) => `<button class="btn ${_tab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-gct="${id}">${l}</button>`).join('')}
      </div>
      <div id="gc-body"></div>
    </div>`;
  _root.querySelectorAll('[data-gct]').forEach(b => b.onclick = () => { _tab = b.dataset.gct; render(); });
  _root.querySelector('#gc-aplicar').onclick = () => { _since = _root.querySelector('#gc-since').value; _until = _root.querySelector('#gc-until').value; load(); };
  _root.querySelector('#gc-fresh').onclick = () => load(true);
  _root.querySelector('#gc-tv').onclick = enterTV;
  _root.querySelector('#gc-preset').onchange = ev => {
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
    _since = f(ini()); _until = f(h);
    load();
  };
  const body = _root.querySelector('#gc-body');
  body.innerHTML = tabBody();
}

const GC_TABS = [['visao', '🎯 Visão Geral'], ['funilrd', '⏬ Funil RD'], ['fontes', '🔀 Fontes & Funil'],
                 ['camp', '📣 Campanhas'], ['custos', '💰 Custo do Funil'], ['prod', '📊 Produtividade'], ['safras', '📈 Safras & Tempos']];
function tabBody() {
  return { visao: tabVisao, funilrd: tabFunilRD, fontes: tabFontes, camp: tabCampanhas, custos: tabCustos, prod: tabProd, safras: tabSafras }[_tab]();
}

/* ═══════════ 📺 MODO TV — todas as abas em rotação (pedido 15/ago) ═══════════ */
function enterTV() {
  if (_tv) return;
  _tv = true; _tvRotate = true;
  if (_root) _root.style.display = 'none';
  let ov = document.getElementById('gc-tv-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'gc-tv-ov'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0b1220;color:#e2e8f0;overflow-y:auto;overflow-x:hidden;'
    + '--bg:#0b1220;--bg-2:#111827;--bg-3:rgba(255,255,255,0.07);--ink:#f1f5f9;--ink-muted:#94a3b8;'
    + '--border:rgba(255,255,255,0.12);--border-2:rgba(255,255,255,0.08);--psm-navy:#1e293b';
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
    try {
      _d = await api.request(`/api/v3/oo/comercial?since=${_since}&until=${_until}&spend_preset=${_spendPreset}&fresh=1`);
      renderTV();
    } catch (_) {}
  }, TV_REFRESH_MS);
  clearInterval(_tvTickTimer);
  _tvTickTimer = setInterval(() => {
    const el = document.getElementById('gc-tv-age');
    if (!el || !_tv) return;
    const age = _d?.fetched_at ? Math.max(0, Math.round((Date.now() - new Date(_d.fetched_at).getTime()) / 1000)) : null;
    const nxt = Math.max(0, Math.round((_tvNextAt - Date.now()) / 1000));
    const f = s => s < 90 ? s + 's' : Math.round(s / 60) + 'min';
    const cor = age == null ? '#94a3b8' : age < 720 ? '#4ade80' : age < 1800 ? '#fbbf24' : '#f87171';
    el.innerHTML = `<span style="color:${cor};font-weight:800">● dado de ${age != null ? f(age) : '—'} atrás</span><span style="opacity:.7"> · atualiza em ${f(nxt)}</span>`;
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

function tvStep(dir) {
  const i = GC_TABS.findIndex(t => t[0] === _tab);
  _tab = GC_TABS[(i + dir + GC_TABS.length) % GC_TABS.length][0];
  renderTV();
}

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
  const BTN = 'border:none;cursor:pointer;padding:7px 12px;border-radius:8px;background:rgba(255,255,255,0.08);color:#e2e8f0;font-weight:800';
  ov.innerHTML = `
    <div style="position:sticky;top:0;z-index:5;background:rgba(11,18,32,.94);backdrop-filter:blur(6px);border-bottom:1px solid rgba(255,255,255,.08);padding:12px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:19px;font-weight:900;color:#fff;white-space:nowrap">📊 PSM · Gestão Comercial</div>
      <div style="font-size:12px;color:#94a3b8;white-space:nowrap">${_d.janela.since} → ${_d.janela.until} · ${fN(_d.coorte_n)} leads</div>
      <div id="gc-tv-age" style="font-size:12px;white-space:nowrap"></div>
      <div style="flex:1;min-width:10px"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
        ${GC_TABS.map(([id, l]) => `<button class="gctv-dot" data-t="${id}" style="border:none;cursor:pointer;padding:6px 12px;border-radius:999px;font-weight:800;font-size:13px;background:${id === _tab ? '#2563eb' : 'rgba(255,255,255,0.08)'};color:${id === _tab ? '#fff' : '#94a3b8'}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button id="gctv-prev" style="${BTN}">◀</button>
        <button id="gctv-rot" style="${BTN}${_tvRotate ? ';background:#16a34a;color:#fff' : ''}">${_tvRotate ? '⏸' : '▶'}</button>
        <button id="gctv-next" style="${BTN}">▶</button>
        <button id="gctv-exit" style="${BTN};background:#dc2626;color:#fff">✕</button>
      </div>
    </div>
    <div style="padding:18px 22px 48px;font-size:15px;max-width:1700px;margin:0 auto">${tabBody()}</div>`;
  ov.querySelectorAll('.gctv-dot').forEach(b => b.onclick = () => { _tab = b.dataset.t; renderTV(); });
  ov.querySelector('#gctv-prev').onclick = () => tvStep(-1);
  ov.querySelector('#gctv-next').onclick = () => tvStep(1);
  ov.querySelector('#gctv-rot').onclick = () => { _tvRotate = !_tvRotate; renderTV(); };
  ov.querySelector('#gctv-exit').onclick = exitTV;
}

/* ── 📣 CAMPANHAS → FUNIL → VENDA: escalar/pausar pela VENDA, não pelo CPL ── */
function tabCampanhas() {
  const cp = _d.campanhas || {};
  const its = cp.itens || [];
  if (!its.length) return pan('📣 Campanhas', '<div class="tiny muted">Nenhum lead da janela com campanha preenchida no RD.</div>');
  const VCOR = { escalar: '#16a34a', manter: '#2563eb', maturando: '#d97706', pausar: '#dc2626', observar: '#94a3b8' };
  const podio = (campo, titulo, ico) => {
    const top = its.filter(x => (x[campo] || 0) > 0).sort((a, b) => b[campo] - a[campo]).slice(0, 3);
    return `<div><div class="tiny" style="font-weight:800;margin-bottom:4px">${ico} ${titulo}</div><div style="display:grid;gap:4px">
      ${top.map((x, i) => `<div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:8px;padding:6px 10px">
        <span>${['🥇', '🥈', '🥉'][i]}</span><span class="tiny" style="flex:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(x.campanha)}">${esc(x.campanha.slice(0, 46))}</span>
        <b>${fN(x[campo])}</b></div>`).join('') || '<div class="tiny muted">—</div>'}</div></div>`;
  };
  const rows = its.map(x => `<tr>
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
    </tr>`).join('');
  const SPENDS = [['this_month', 'Este mês'], ['last_7d', 'Últimos 7d'], ['last_14d', 'Últimos 14d'], ['last_30d', 'Últimos 30d'], ['last_month', 'Mês passado']];
  const spendSel = `<div class="flex items-center gap-2" style="margin-bottom:8px">
    <span class="tiny" style="font-weight:800">🎚 Período do spend/CPL (Meta):</span>
    <select class="select" id="gc-spend" style="width:auto;padding:3px 8px;font-size:12px">
      ${SPENDS.map(([v, l]) => `<option value="${v}"${_spendPreset === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${cp.spend_preset_usado && cp.spend_preset_usado !== cp.spend_preset_pedido ? `<span class="tiny" style="color:#d97706;font-weight:700">⚠ cache da Meta não tinha "${esc(cp.spend_preset_pedido)}" — usando "${esc(cp.spend_preset_usado)}"</span>` : ''}
    <span class="tiny muted">o funil segue a janela de safra lá de cima — aqui você troca só a base de CUSTO</span>
  </div>`;
  setTimeout(() => { document.getElementById('gc-spend')?.addEventListener('change', ev => { _spendPreset = ev.target.value; load(); }); }, 0);
  return spendSel + pan('🏅 Pódio de campanhas — pelo FUNDO do funil, não pelo CPL', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">
        ${podio('visita', 'MAIS VISITAS', '🚶')}${podio('pasta', 'MAIS PASTAS', '📁')}${podio('proposta', 'MAIS PROPOSTAS', '📄')}${podio('venda', 'MAIS VENDAS', '💰')}
      </div>`)
    + pan('📣 Campanha → funil → venda (com veredito de escala)', `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Campanha</th><th>Leads</th><th>Agend.</th><th>Visitas</th><th>Prop.</th><th>Pastas</th><th>Vendas</th><th>VGV</th><th>Receita≈</th><th>Spend 30d</th><th>CPL</th><th>ROAS</th><th style="text-align:left">Veredito</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="tiny muted" style="margin-top:8px">${esc(cp.nota || '')} · ${fN(cp.sem_campanha || 0)} lead(s) da janela sem campanha no RD. Régua do veredito: 💰 ESCALAR = vende e a receita cobre ≥1,5× o spend · ⏳ MATURANDO = sem venda mas com pastas/propostas andando · 🔴 REVER = gasta ≥R$300/30d sem gerar UMA visita na safra. O CPL está aí de contexto — a decisão é pelo fundo do funil.</div>`);
}

/* Δ% verde/vermelho (histórico mensal — pedido 15/ago) */
function delta(cur, prev, invertido) {
  if (prev == null || cur == null || !prev) return '';
  const p = (cur - prev) / Math.abs(prev) * 100;
  if (!isFinite(p) || Math.abs(p) < 0.05) return '<span class="tiny muted">＝</span>';
  const bom = invertido ? p < 0 : p > 0;
  return `<span class="tiny" style="font-weight:800;color:${bom ? '#16a34a' : '#dc2626'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>`;
}

/* 📆 tabela do histórico do ano: colunas = meses (mês atual destacado + parcial),
   Δ% vs mês anterior em cada célula. rows = [{lbl, get(mesObj), fmt, invertido}] */
function histTable(titulo, rows) {
  const hs = _d.historico || [];
  if (!hs.length) return '';
  const meses = hs.map(h => mesNome(h.ym));
  const head = `<tr class="tiny muted"><th style="text-align:left"></th>${hs.map((h, i) =>
    `<th style="text-align:right;padding:2px 8px;${h.parcial ? 'background:var(--bg-3);border-radius:6px 6px 0 0' : ''}">${meses[i]}${h.parcial ? '<div style="font-weight:400">parcial</div>' : ''}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr>
    <td class="tiny" style="font-weight:700;white-space:nowrap;padding:3px 8px 3px 0">${r.lbl}</td>
    ${hs.map((h, i) => {
      const v = r.get(h), pv = i > 0 ? r.get(hs[i - 1]) : null;
      return `<td style="text-align:right;padding:3px 8px;font-size:12px;${h.parcial ? 'background:var(--bg-3);font-weight:800' : ''}">${v != null ? r.fmt(v) : '—'}<div>${i > 0 ? delta(v, pv, r.invertido) : ''}</div></td>`;
    }).join('')}</tr>`).join('');
  return pan(`📆 ${titulo} — mês a mês ${new Date().getFullYear()} (Δ% vs mês anterior · mês atual destacado)`, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${head}${body}</table></div>`);
}

/* ── 🎯 VISÃO GERAL: real × projeções ×3 × meta, por equipe + corretor ── */
function tabVisao() {
  const rows = (_d.visao || []).map(v => {
    const ok = v.meta_vendas > 0 ? (v.real_vendas >= (v.poisson?.lo ?? 0)) : null;
    const cor = v.meta_vendas <= 0 ? 'var(--ink-muted)' : v.real_vendas >= v.meta_vendas ? '#16a34a' : ok ? '#2563eb' : '#dc2626';
    const pa = v.pipeline_agora || {};
    return `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:6px 8px 6px 0;white-space:nowrap">${v.label}</td>
      <td style="text-align:right;font-weight:900;font-size:14px;color:${cor}">${fN(v.real_vendas)}</td>
      <td style="text-align:right;font-size:12px" title="motor do Norte (mix × conversão de cada corretor)">${v.proj_vendas ? fN(v.proj_vendas) : '—'}</td>
      <td style="text-align:right;font-size:12px" title="ritmo: vendas até hoje ÷ dias corridos × dias do mês">${v.proj_ritmo != null ? fN(v.proj_ritmo) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.meta_vendas ? fN(v.meta_vendas) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.poisson ? `${v.poisson.lo}–${v.poisson.hi} <span class="muted tiny">normal</span>` : '—'}</td>
      <td style="text-align:right;font-size:12px" title="deals abertos AGORA parados em proposta / pasta">${fN(pa.propostas || 0)} / ${fN(pa.pastas || 0)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(v.real_vgv)}</td>
      <td style="text-align:right;font-size:12px">${v.meta_vgv ? 'R$ ' + kR$(v.meta_vgv) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.real_ticket ? 'R$ ' + kR$(v.real_ticket) : '—'}</td>
    </tr>`;
  }).join('');
  const hub = _d.hub_conquista;
  const detalhes = (_d.visao || []).filter(v => (v.por_corretor || []).length).map(v => `
    <details style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-weight:800;font-size:12.5px">${v.label} — corretor a corretor (real × meta × projetado)</summary>
      <div style="overflow-x:auto;margin-top:6px"><table style="width:100%;border-collapse:collapse">
        <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Corretor</th><th>Real (mês)</th><th>Meta</th><th>Projetado</th><th>VGV real</th><th>vs meta</th></tr></thead>
        <tbody>${v.por_corretor.map(c => {
          const pct = c.meta > 0 ? c.real / c.meta * 100 : null;
          const cc = pct == null ? 'var(--ink-muted)' : pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
          return `<tr><td style="font-size:12px;padding:3px 8px 3px 0">${esc(c.nome)}</td>
            <td style="text-align:right;font-weight:800;font-size:12px">${fN(c.real)}</td>
            <td style="text-align:right;font-size:12px">${c.meta ? fN(c.meta) : '—'}</td>
            <td style="text-align:right;font-size:12px">${c.proj ? fN(c.proj) : '—'}</td>
            <td style="text-align:right;font-size:12px">R$ ${kR$(c.vgv)}</td>
            <td style="text-align:right;font-size:11px;font-weight:800;color:${cc}">${pct != null ? fN(pct) + '%' : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>
    </details>`).join('');
  return pan('🎯 Mês corrente — REAL × PROJETADO (Norte · Ritmo) × META, por equipe', `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>Vendas REAL</th><th>Proj. Norte</th><th>Proj. Ritmo</th><th>Meta</th><th>🎲 Faixa</th><th>Prop./Pastas abertas</th><th>VGV real</th><th>VGV meta</th><th>Ticket</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${hub ? `<div class="tiny" style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:6px 10px">🌉 Cruzamento Conquista: esteira do PSM HUB marca <b>${fN(hub.vendas)} venda(s) · R$ ${kR$(hub.vgv)}</b> no mês — divergência com o RD é sinal de lançamento pendente num dos dois.</div>` : ''}
    ${detalhes}
    <div class="tiny muted" style="margin-top:6px">Metas = painel 🎯 Metas oficial do House (por corretor/mês). Duas projeções lado a lado: <b>Norte</b> (mix×conversão calibrada de cada corretor) e <b>Ritmo</b> (velocidade real do mês extrapolada). Venda dentro da 🎲 faixa = azul (normal estatístico). Prop./Pastas = pipeline vivo agora.</div>`)
    + metricasChave()
    + forecastPanel()
    + histTable('Vendas & VGV — real', [
      ...(_d.visao || []).map(v => ({ lbl: v.label + ' vendas', get: h => h.equipes?.[v.team]?.vendas, fmt: fN })),
      { lbl: 'TOTAL vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'TOTAL VGV', get: h => h.total?.vgv, fmt: x => 'R$ ' + kR$(x) },
      { lbl: 'Ticket médio', get: h => h.total?.ticket, fmt: x => 'R$ ' + kR$(x) },
    ]);
}

/* 📐 métricas-chave por equipe (pedido 15/ago: tudo que o Paulo listou, na Visão) */
function metricasChave() {
  const custos = ((_d.custos || {}).equipes || []);
  const prod = (_d.produtividade || {}).equipes || {};
  const rows = custos.map(c => {
    const p = prod[c.team] || {};
    return `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${c.label}</td>
      <td style="text-align:right;font-size:12px">${c.custo_agend != null ? 'R$ ' + kR$(c.custo_agend) : '—'}</td>
      <td style="text-align:right;font-size:12px">${c.custo_visita != null ? 'R$ ' + kR$(c.custo_visita) : '—'}</td>
      <td style="text-align:right;font-size:12px">${c.custo_pasta != null ? 'R$ ' + kR$(c.custo_pasta) : '—'}</td>
      <td style="text-align:right;font-size:12px;font-weight:800;color:#b45309">${c.cac_midia != null ? 'R$ ' + kR$(c.cac_midia) : '—'}</td>
      <td style="text-align:right;font-size:12px">${p.visitas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${p.pastas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px;font-weight:800">${p.dias_por_venda != null ? fN(p.dias_por_venda) + 'd' : '—'}</td>
      <td style="text-align:right;font-size:11.5px;white-space:nowrap">${fmtDHM(p.contato_h_mediana)}</td>
    </tr>`;
  }).join('');
  // contatos de cada fonte pra 1 visita (leads da fonte ÷ visitas da fonte, geral)
  const fontesVisita = ((_d.fontes || {}).geral || []).filter(f => f.visita > 0).map(f =>
    `<span style="display:inline-block;background:var(--bg-3);border-radius:999px;padding:3px 10px;font-size:11.5px;margin:2px">${esc(f.label)}: <b>${fN(Math.round(f.leads / f.visita * 10) / 10)}</b> contatos → 1 visita</span>`).join('');
  return pan('📐 Métricas-chave por equipe (custo do mês · razões e ritmo da safra)', `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>R$/agend.</th><th>R$/visita</th><th>R$/pasta</th><th>R$/venda (CAC)</th><th>Visitas→1 venda</th><th>Pastas→1 venda</th><th>Dias p/ nova venda</th><th>1º contato (mediano)</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${fontesVisita ? `<div style="margin-top:8px"><span class="tiny" style="font-weight:800">🔀 Contatos de cada fonte pra gerar 1 visita:</span><div style="margin-top:4px">${fontesVisita}</div></div>` : ''}
    <div class="tiny muted" style="margin-top:6px">Custos = spend do mês da conta da equipe. Razões/dias/1º contato = safra da janela. Individual: aba 📊 Produtividade tem as mesmas colunas corretor a corretor.</div>`);
}

/* 🔮 forecast ponderado: pipeline aberto × taxas reais da equipe (mês e tri) */
function forecastPanel() {
  const fc = _d.forecast || {};
  const teams = Object.keys(fc).filter(t => (fc[t].termos || []).length || fc[t].mes_esp);
  if (!teams.length) return '';
  const rows = teams.map(t => {
    const f = fc[t];
    const termos = (f.termos || []).map(x => `${fN(x.abertos)} ${x.etapa}s×${fN(x.taxa_pct)}%`).join(' + ') || '—';
    return `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${TEAM_LBL[t] || t}</td>
      <td style="text-align:right;font-weight:900;font-size:13px">${fN(f.mes_esp)}</td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:#2563eb">${fN(f.tri_esp)}</td>
      <td style="text-align:right;font-size:12px">${f.pipeline_vgv_esp ? 'R$ ' + kR$(f.pipeline_vgv_esp) : '—'}</td>
      <td class="tiny muted">${termos}${f.mediana_pasta_venda_d != null ? ` · pasta→venda ~${f.mediana_pasta_venda_d}d` : ''}</td>
    </tr>`;
  }).join('');
  return pan('🔮 Forecast ponderado — o pipeline aberto × as taxas REAIS da equipe', `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>Esperado MÊS</th><th>Esperado TRI</th><th>VGV do pipeline</th><th style="text-align:left">Como foi calculado</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">MÊS = vendas já feitas + pastas abertas × taxa pasta→venda (só quando a mediana de dias cabe no que resta do mês). TRI = vendas + pipeline inteiro ponderado. Taxa sem amostra mínima fica de fora — sem invenção.</div>`);
}

/* ── ⏬ FUNIL RD: as lanes EXATAS de cada funil, números do RD + % passagem ── */
function tabFunilRD() {
  const fr = _d.funil_rd || {};
  const teams = Object.keys(fr);
  if (!teams.length) return pan('⏬ Funil RD', '<div class="tiny muted">Nenhum funil espelhado encontrado (rd_stages).</div>');
  const bloco = tk => {
    const f = fr[tk];
    const lanes = f.lanes || [];
    const maxA = Math.max(1, ...lanes.filter(l => !l.base).map(l => l.alcancaram || 0));
    return pan(`${TEAM_LBL[tk] || tk} — funil “${esc(f.pipeline)}” (nomes exatos do RD)`, `
      <div style="display:grid;gap:3px">
        ${lanes.map(l => {
          if (l.base) return `<div style="display:flex;gap:8px;align-items:center;opacity:.75">
            <span class="tiny" style="min-width:210px;font-weight:600">🗂 ${esc(l.nome)}</span>
            <span class="tiny muted">lane de base · <b>${fN(l.abertos)}</b> parado(s) — conta como entrada, fora da cadeia</span></div>`;
          const w = Math.max(3, Math.round((l.alcancaram || 0) / maxA * 100));
          return `<div style="display:flex;gap:8px;align-items:center">
            <span class="tiny" style="min-width:210px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(l.nome)}">${esc(l.nome)}</span>
            <div style="flex:1;height:20px;background:var(--bg-3);border-radius:5px;overflow:hidden;position:relative">
              <div style="height:100%;width:${w}%;background:linear-gradient(90deg,#1e3a8a,#2563eb);border-radius:5px"></div>
              <span class="tiny" style="position:absolute;left:8px;top:2px;color:#fff;font-weight:800">${fN(l.alcancaram || 0)} alcançaram</span>
            </div>
            <span class="tiny" style="min-width:86px;text-align:right"><b>${fN(l.abertos)}</b> <span class="muted">abertos</span></span>
            <span class="tiny" style="min-width:64px;text-align:right;font-weight:800;color:${l.passagem_pct == null ? 'var(--ink-muted)' : l.passagem_pct >= 50 ? '#16a34a' : l.passagem_pct >= 25 ? '#d97706' : '#dc2626'}">${l.passagem_pct != null ? '↓ ' + fN(l.passagem_pct) + '%' : ''}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="tiny muted" style="margin-top:6px">Barra = quantos deals ALCANÇARAM a etapa (abertos de agora + ganhos do ano; aproximação pela etapa atual — dado real, sem invenção). ↓% = passagem pra próxima etapa. “Abertos” = parados na lane HOJE, igual ao RD.</div>`);
  };
  return teams.map(bloco).join('');
}

/* ── 🔀 FONTES & FUNIL: qual origem converte visita/pasta/venda ── */
function tabFontes() {
  const pod = _d.fontes?.podio || {};
  const medal = (arr, campo) => (arr || []).map((f, i) => `<div style="display:flex;gap:8px;align-items:center;background:var(--bg-3);border-radius:8px;padding:6px 10px">
      <span style="font-size:16px">${['🥇', '🥈', '🥉'][i]}</span><b style="flex:1;font-size:12.5px">${esc(f.label)}</b>
      <span style="font-weight:900">${fN(f[campo])}%</span><span class="tiny muted">(${fN(f.leads)} leads · ${fN(f.venda)} vendas)</span></div>`).join('') || '<div class="tiny muted">Sem fonte com amostra suficiente na janela.</div>';
  const tabela = (lista) => `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Origem</th><th>Leads</th><th>Agend.</th><th>Visitas</th><th>Pastas</th><th>Vendas</th><th>%→Visita</th><th>%→Pasta</th><th>%→Venda</th><th>VGV</th></tr></thead>
    <tbody>${(lista || []).map(f => `<tr${f.rankeavel ? '' : ' style="opacity:.55" title="amostra pequena — fora do pódio"'}>
      <td style="font-weight:600;font-size:12px;padding:4px 6px 4px 0">${esc(f.label)}${f.rankeavel ? '' : ' <span class="tiny">⚠</span>'}</td>
      <td style="text-align:right;font-size:12px">${fN(f.leads)}</td><td style="text-align:right;font-size:12px">${fN(f.agend)}</td>
      <td style="text-align:right;font-size:12px">${fN(f.visita)}</td><td style="text-align:right;font-size:12px">${fN(f.pasta)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(f.venda)}</td>
      <td style="text-align:right;font-size:12px">${f.pc_visita != null ? fN(f.pc_visita) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">${f.pc_pasta != null ? fN(f.pc_pasta) + '%' : '—'}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${f.pc_venda != null ? fN(f.pc_venda) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(f.vgv)}</td></tr>`).join('')}</tbody></table></div>`;
  const porEquipe = ['conquista', 'map', 'terceiros', 'locacao'].filter(t => _d.fontes?.[t]?.length)
    .map(t => pan(`${TEAM_LBL[t]} — funil por origem (safra da janela)`, tabela(_d.fontes[t]))).join('');
  return `
    ${pan('🏅 Pódio das fontes (safra da janela, amostra mínima ' + 30 + ' leads)', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">🚶 CONVERTE MAIS VISITA</div><div style="display:grid;gap:4px">${medal(pod.visita, 'pc_visita')}</div></div>
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">📁 CONVERTE MAIS PASTA</div><div style="display:grid;gap:4px">${medal(pod.pasta, 'pc_pasta')}</div></div>
        <div><div class="tiny" style="font-weight:800;margin-bottom:4px">💰 CONVERTE MAIS VENDA</div><div style="display:grid;gap:4px">${medal(pod.venda, 'pc_venda')}</div></div>
      </div>`)}
    ${pan('🌎 Geral — todas as equipes', tabela(_d.fontes?.geral))}
    ${porEquipe}
    <div class="tiny muted" style="margin-top:8px">Safra = lead NASCIDO na janela, acompanhado até hoje (fontes se comparam por coorte; visão instantânea mente com jornada de meses). Linhas apagadas = amostra pequena. Sem fonte e Outro contam como <b>Tráfego pago Imob</b> (regra 15/ago).</div>
    ${histFontes()}`;
}

/* 📆 histórico por ORIGEM (leads criados e vendas convertidas por mês — o Paulo
   tinha razão: data de conversão + origem de cada negociação resolvem) */
function histFontes() {
  const hs = _d.historico || [];
  const lblCanal = {};
  (_d.fontes?.geral || []).forEach(f => { lblCanal[f.canal] = f.label; });
  const tot = {};
  hs.forEach(h => Object.entries(h.canais || {}).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + (v.leads || 0); }));
  const canais = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, 8);
  if (!canais.length) return '';
  return histTable('Fontes — leads que ENTRARAM por origem, mês a mês',
    canais.map(k => ({ lbl: lblCanal[k] || k, get: h => h.canais?.[k]?.leads, fmt: fN })))
    + histTable('Fontes — VENDAS convertidas por origem (mês da conversão)',
      canais.map(k => ({ lbl: lblCanal[k] || k, get: h => h.canais?.[k]?.vendas, fmt: fN })));
}

/* ── 💰 CUSTO DO FUNIL: R$ por etapa + CAC mídia/completo (mês corrente) ── */
function tabCustos() {
  const c = _d.custos || {};
  const rows = (c.equipes || []).map(e => `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:5px 8px 5px 0;white-space:nowrap">${e.label}<div class="tiny muted">${e.conta ? 'conta ' + esc(e.conta) : 'sem conta Meta'}</div></td>
      <td style="text-align:right;font-size:12px">R$ ${brl(e.spend)}<div class="tiny muted">+ fixo R$ ${kR$(e.fixo_mes)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_lead != null ? 'R$ ' + brl(e.custo_lead) : '—'}<div class="tiny muted">${fN(e.leads)} leads</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_agend != null ? 'R$ ' + brl(e.custo_agend) : '—'}<div class="tiny muted">${fN(e.agend)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_visita != null ? 'R$ ' + brl(e.custo_visita) : '—'}<div class="tiny muted">${fN(e.visita)}</div></td>
      <td style="text-align:right;font-size:12px">${e.custo_pasta != null ? 'R$ ' + brl(e.custo_pasta) : '—'}<div class="tiny muted">${fN(e.pasta)}</div></td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:#b45309">${e.cac_midia != null ? 'R$ ' + kR$(e.cac_midia) : '—'}</td>
      <td style="text-align:right;font-weight:900;font-size:13px;color:#dc2626">${e.cac_completo != null ? 'R$ ' + kR$(e.cac_completo) : '—'}<div class="tiny muted">${fN(e.vendas)} venda(s)</div></td>
    </tr>`).join('');
  return pan(`💰 Unit economics do mês (${c.mes || ''}) — do lead ao CAC, por equipe`, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>Spend Meta</th><th>R$/lead</th><th>R$/agendamento</th><th>R$/visita</th><th>R$/pasta</th><th>CAC mídia</th><th>CAC completo</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${c.payback_midia ? `<div class="tiny" style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:6px 10px">💸 <b>Payback de mídia:</b> a venda vira caixa em mediana <b>${fN(c.payback_midia.mediana_dias)} dias</b> (${esc(c.payback_midia.fonte)}, n=${fN(c.payback_midia.n)}) — é o tempo entre o real investido e o real voltando.</div>` : ''}
    <div class="tiny muted" style="margin-top:8px">${esc(c.nota || '')}. Qualificado começa no AGENDAMENTO (decisão 14/ago). Indicação/orgânico não pagam mídia — o CAC deles vive no custo fixo.</div>`)
    + histTable('Custo — mês a mês (spend GLOBAL da Meta; histórico por equipe não existe na base mensal)', [
      { lbl: 'Spend Meta', get: h => h.total?.spend, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'CPL global', get: h => h.total?.cpl_global, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'CAC global (mídia)', get: h => h.total?.cac_global, fmt: x => 'R$ ' + kR$(x), invertido: true },
      { lbl: 'Vendas TOTAL', get: h => h.total?.vendas, fmt: fN },
    ]);
}

/* ── 📊 PRODUTIVIDADE: razões por corretor e equipe ── */
function tabProd() {
  const p = _d.produtividade || {};
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
      `<span style="display:inline-block;background:var(--bg-2);border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:10.5px;margin:1px">${esc(c.label)}: <b>${fN(c.share_vendas_pct)}%</b> das vendas · conv ${c.conv_pct != null ? fN(c.conv_pct) + '%' : '—'}</span>`).join('');
    return `<tr>
      <td style="font-size:12px;padding:4px 8px 4px 0">${esc(cr.nome)} <span class="tiny muted">${(TEAM_LBL[cr.team] || cr.team || '').replace(/^..\s/, '')}</span>
        ${chips ? `<div style="margin-top:2px">${chips}</div>` : ''}</td>
      <td style="font-size:11.5px;font-weight:800;color:#166534;white-space:nowrap">${cr.top_canal ? '🏆 ' + esc(cr.top_canal) : '—'}</td>
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
  return pan(`📊 Quantos X pra 1 venda — equipe e corretor (safra da janela)${p.restrito_a ? ` · <span class="tiny" style="color:#d97706">visão restrita à sua equipe (${p.restrito_a})</span>` : ''}`, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Corretor / Equipe</th><th style="text-align:left">Canal 🏆 (converte melhor)</th><th>Leads</th><th>Vendas</th><th>Leads/venda</th><th>Atend./venda</th><th>Visitas/venda</th><th>Pastas/venda</th><th>Dias p/ venda</th><th>1º contato</th><th>Ticket</th><th>VGV</th></tr></thead>
      <tbody>${eqRows}${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">Razões calculadas na safra da janela (lead nascido nela). Corretor sem venda na safra mostra — (sem denominador não há razão honesta).</div>`)
    + histTable('Produção — mês a mês', [
      ...['conquista', 'map', 'terceiros', 'locacao'].map(t => ({ lbl: (TEAM_LBL[t] || t) + ' vendas', get: h => h.equipes?.[t]?.vendas, fmt: fN })),
      { lbl: 'TOTAL vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'TOTAL VGV', get: h => h.total?.vgv, fmt: x => 'R$ ' + kR$(x) },
    ]);
}

/* ── 📈 SAFRAS & TEMPOS ── */
function tabSafras() {
  const rows = (_d.safras || []).map(s => `<tr>
      <td style="font-weight:700;font-size:12px;padding:4px 8px 4px 0">${mesNome(s.ym)}</td>
      <td style="text-align:right;font-size:12px">${fN(s.leads)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(s.vendas)}</td>
      <td style="text-align:right;font-size:12px">${s.pc != null ? fN(s.pc) + '%' : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(s.vgv)}</td>
      <td style="text-align:right;font-size:12px">${s.dias_medio != null ? fN(s.dias_medio) + 'd' : '—'}</td>
    </tr>`).join('');
  const tempos = Object.keys(_d.tempos || {}).map(t => `
    <div><div class="tiny" style="font-weight:800;margin-bottom:4px">${TEAM_LBL[t] || t}</div>
      ${(_d.tempos[t] || []).map(l => `<div style="display:flex;justify-content:space-between;font-size:12px;border-bottom:1px dashed var(--border);padding:3px 0">
        <span>${esc(l.passo)}</span><span><b>${l.mediana_dias != null ? l.mediana_dias + 'd' : '—'}</b> <span class="tiny muted">n=${l.n}</span></span></div>`).join('')}
    </div>`).join('');
  const resp = _d.resposta || {};
  const respBlocos = Object.keys(resp).filter(t => (resp[t] || []).some(b => b.n)).map(t => `
    <div><div class="tiny" style="font-weight:800;margin-bottom:4px">${TEAM_LBL[t] || t} · mediano: <span style="color:#2563eb">${fmtDHM(((_d.produtividade || {}).equipes || {})[t]?.contato_h_mediana)}</span></div>
      ${(resp[t] || []).map(b => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;border-bottom:1px dashed var(--border);padding:3px 0">
        <span>${esc(b.bucket)}</span>
        <span><b>${fN(b.n)}</b> leads · <b>${fN(b.vendas)}</b> venda(s) · <b style="color:${(b.conv_pct || 0) >= 2 ? '#16a34a' : 'var(--ink)'}">${b.conv_pct != null ? fN(b.conv_pct) + '%' : '—'}</b></span>
      </div>`).join('')}</div>`).join('');
  return `
    ${respBlocos ? pan('⚡ Velocidade do 1º contato × conversão (a prova de quanto custa demorar)', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${respBlocos}</div><div class="tiny muted" style="margin-top:6px">1º contato = primeira chegada ao marco de contato/agendamento (eventos reais do RD, safra da janela).</div>`) : ''}
    ${pan('📈 Safras — cada mês de lead, o que virou até hoje', `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Safra</th><th>Leads</th><th>Vendas até hoje</th><th>Conv.</th><th>VGV</th><th>Lead→venda</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="tiny muted" style="margin-top:6px">Safras recentes SEMPRE parecem piores — o lead ainda não teve tempo de maturar (MAP ~3 meses). Compare safras da mesma idade.</div>`)}
    ${pan('⏱ Tempo mediano entre etapas (esteira — onde empaca)', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${tempos}</div>`)}
    ${histTable('Ano — leads × vendas × ticket', [
      { lbl: 'Leads', get: h => h.total?.leads, fmt: fN },
      { lbl: 'Vendas', get: h => h.total?.vendas, fmt: fN },
      { lbl: 'Ticket', get: h => h.total?.ticket, fmt: x => 'R$ ' + kR$(x) },
    ])}`;
}
