/* PSM-OS v2 — 📊 GESTÃO COMERCIAL (v86.19)
   Painel comercial por equipe/linha: Visão Geral (real × projetado × meta) ·
   Fontes & Funil (qual origem converte visita/pasta/venda) · Custo do Funil
   (R$/etapa + CAC mídia e completo) · Produtividade (razões por corretor) ·
   Safras & Tempos. Gate lvl>=5; individual restrito à equipe do gestor. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _tab = 'visao', _busy = false;
let _since = null, _until = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fN = v => { const x = Number(v) || 0; return Number.isInteger(x) ? x.toLocaleString('pt-BR') : x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
const kR$ = v => { const n = Number(v) || 0, a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M'; if (a >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'; return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    _d = await api.request(`/api/v3/oo/comercial?since=${_since}&until=${_until}${fresh ? '&fresh=1' : ''}`);
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
  const tabs = [['visao', '🎯 Visão Geral'], ['fontes', '🔀 Fontes & Funil'], ['custos', '💰 Custo do Funil'],
                ['prod', '📊 Produtividade'], ['safras', '📈 Safras & Tempos']];
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">📊 Gestão Comercial</h2>
        <span class="tiny muted">coorte de ${fN(d.coorte_n)} leads · origem preenchida em ${d.cobertura_origem_pct != null ? fN(d.cobertura_origem_pct) + '%' : '—'} · ${d.janela.since} → ${d.janela.until}</span>
        <span style="flex:1"></span>
        <input type="date" class="input" id="gc-since" value="${_since}" style="width:auto;padding:4px 8px;font-size:12px">
        <input type="date" class="input" id="gc-until" value="${_until}" style="width:auto;padding:4px 8px;font-size:12px">
        <button class="btn btn-ghost btn-sm" id="gc-aplicar">Aplicar</button>
        <button class="btn btn-ghost btn-sm" id="gc-fresh" title="ignora o cache de 10min">🔄</button>
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
  const body = _root.querySelector('#gc-body');
  body.innerHTML = { visao: tabVisao, fontes: tabFontes, custos: tabCustos, prod: tabProd, safras: tabSafras }[_tab]();
}

/* ── 🎯 VISÃO GERAL: real × projetado × meta por equipe (mês corrente) ── */
function tabVisao() {
  const rows = (_d.visao || []).map(v => {
    const ok = v.meta_vendas > 0 ? (v.real_vendas >= (v.poisson?.lo ?? 0)) : null;
    const cor = v.meta_vendas <= 0 ? 'var(--ink-muted)' : v.real_vendas >= v.meta_vendas ? '#16a34a' : ok ? '#2563eb' : '#dc2626';
    return `<tr>
      <td style="font-weight:700;font-size:12.5px;padding:6px 8px 6px 0;white-space:nowrap">${v.label}</td>
      <td style="text-align:right;font-weight:900;font-size:14px;color:${cor}">${fN(v.real_vendas)}</td>
      <td style="text-align:right;font-size:12px">${v.proj_vendas ? fN(v.proj_vendas) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.meta_vendas ? fN(v.meta_vendas) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.poisson ? `${v.poisson.lo}–${v.poisson.hi} <span class="muted tiny">normal</span>` : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(v.real_vgv)}</td>
      <td style="text-align:right;font-size:12px">${v.meta_vgv ? 'R$ ' + kR$(v.meta_vgv) : '—'}</td>
      <td style="text-align:right;font-size:12px">${v.real_ticket ? 'R$ ' + kR$(v.real_ticket) : '—'}</td>
      <td class="tiny muted" style="text-align:right">${v.corretores_com_meta} c/ meta</td>
    </tr>`;
  }).join('');
  const hub = _d.hub_conquista;
  return pan('🎯 Mês corrente — REAL × PROJETADO (Norte) × META, por equipe', `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Equipe</th><th>Vendas REAL</th><th>Projetado</th><th>Meta</th><th>🎲 Faixa</th><th>VGV real</th><th>VGV meta</th><th>Ticket</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${hub ? `<div class="tiny" style="margin-top:8px;background:var(--bg-3);border-radius:8px;padding:6px 10px">🌉 Cruzamento Conquista: esteira do PSM HUB marca <b>${fN(hub.vendas)} venda(s) · R$ ${kR$(hub.vgv)}</b> no mês — divergência com o RD é sinal de lançamento pendente num dos dois.</div>` : ''}
    <div class="tiny muted" style="margin-top:6px">Venda dentro da 🎲 faixa Poisson da meta = azul (normal estatístico — o mês cobra atividade; a venda se julga no trimestre). Projetado = motor do Norte do Mês de cada corretor.</div>`);
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
    <div class="tiny muted" style="margin-top:8px">Safra = lead NASCIDO na janela, acompanhado até hoje (fontes se comparam por coorte; visão instantânea mente com jornada de meses). Linhas apagadas = amostra pequena.</div>`;
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
    <div class="tiny muted" style="margin-top:8px">${esc(c.nota || '')}. Qualificado começa no AGENDAMENTO (decisão 14/ago). Indicação/orgânico não pagam mídia — o CAC deles vive no custo fixo.</div>`);
}

/* ── 📊 PRODUTIVIDADE: razões por corretor e equipe ── */
function tabProd() {
  const p = _d.produtividade || {};
  const eq = p.equipes || {};
  const eqRows = Object.keys(eq).map(t => {
    const e = eq[t];
    return `<tr style="font-weight:700;background:var(--bg-3)">
      <td style="font-size:12.5px;padding:5px 8px 5px 0">${TEAM_LBL[t] || t}</td>
      <td style="text-align:right">${fN(e.leads)}</td><td style="text-align:right">${fN(e.venda)}</td>
      <td style="text-align:right">${e.leads_por_venda ?? '—'}</td><td style="text-align:right">${e.atend_por_venda ?? '—'}</td>
      <td style="text-align:right">${e.visitas_por_venda ?? '—'}</td><td style="text-align:right">${e.pastas_por_venda ?? '—'}</td>
      <td style="text-align:right">${e.ticket ? 'R$ ' + kR$(e.ticket) : '—'}</td><td style="text-align:right">R$ ${kR$(e.vgv)}</td></tr>`;
  }).join('');
  const rows = (p.corretores || []).map(cr => `<tr>
      <td style="font-size:12px;padding:4px 8px 4px 0;white-space:nowrap">${esc(cr.nome)} <span class="tiny muted">${(TEAM_LBL[cr.team] || cr.team || '').replace(/^..\s/, '')}</span></td>
      <td style="text-align:right;font-size:12px">${fN(cr.leads)}</td>
      <td style="text-align:right;font-weight:800;font-size:12px">${fN(cr.venda)}</td>
      <td style="text-align:right;font-size:12px">${cr.leads_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.atend_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.visitas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.pastas_por_venda ?? '—'}</td>
      <td style="text-align:right;font-size:12px">${cr.ticket ? 'R$ ' + kR$(cr.ticket) : '—'}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(cr.vgv)}</td>
    </tr>`).join('');
  return pan(`📊 Quantos X pra 1 venda — equipe e corretor (safra da janela)${p.restrito_a ? ` · <span class="tiny" style="color:#d97706">visão restrita à sua equipe (${p.restrito_a})</span>` : ''}`, `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Corretor / Equipe</th><th>Leads</th><th>Vendas</th><th>Leads/venda</th><th>Atend./venda</th><th>Visitas/venda</th><th>Pastas/venda</th><th>Ticket</th><th>VGV</th></tr></thead>
      <tbody>${eqRows}${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">Razões calculadas na safra da janela (lead nascido nela). Corretor sem venda na safra mostra — (sem denominador não há razão honesta).</div>`);
}

/* ── 📈 SAFRAS & TEMPOS ── */
function tabSafras() {
  const rows = (_d.safras || []).map(s => `<tr>
      <td style="font-weight:700;font-size:12px;padding:4px 8px 4px 0">${s.ym}</td>
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
  return `
    ${pan('📈 Safras — cada mês de lead, o que virou até hoje', `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Safra</th><th>Leads</th><th>Vendas até hoje</th><th>Conv.</th><th>VGV</th><th>Lead→venda</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="tiny muted" style="margin-top:6px">Safras recentes SEMPRE parecem piores — o lead ainda não teve tempo de maturar (MAP ~3 meses). Compare safras da mesma idade.</div>`)}
    ${pan('⏱ Tempo mediano entre etapas (esteira — onde empaca)', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${tempos}</div>`)}`;
}
