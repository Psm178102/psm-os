/* PSM-OS v2 — 🧭 SALA DE COMANDO (v86.93) — unificação Cockpit de Decisão + Dashboard Diretoria.
   Decisão do Paulo (01/set): um item só no menu, acesso SÓ SÓCIO (lvl≥10).
   3 camadas: FARÓIS (semáforo c/ pace do mês, financeiro vem do PSM HUB — NIBO aposentado),
   ALERTAS & DECISÕES (cruza fronts; alerta vira tarefa com 1 clique) e DRILL-DOWN por área.
   Cada bloco carrega INDEPENDENTE (um cair não derruba os outros).
   Recados: widget no topo (leitura + atalho); CRUD completo segue na rota /diretoria (fora do menu). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
const _d = {};            // resultados por fonte
let _tarefasCriadas = new Set();

const hoje = new Date();
const DIA = hoje.getDate();
const DIAS_MES = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
const PACE = DIA / DIAS_MES;
const MES_LBL = hoje.toLocaleDateString('pt-BR', { month: 'long' });

const money = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyK = n => { const v = Number(n) || 0; return Math.abs(v) >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M' : (Math.abs(v) >= 1e3 ? 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k' : money(v)); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

const COR = { ok: '#16a34a', warn: '#d97706', bad: '#dc2626', mute: 'var(--ink-muted)' };
const farolDot = c => `<span style="color:${c};font-size:13px">●</span>`;

export async function pageSalaComando(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 10) { root.innerHTML = '<div class="alert alert-warn">🔒 Sala de Comando é restrita a Sócios.</div>'; return; }
  shell();
  carregar();   // dispara tudo em paralelo; cada bloco redesenha o próprio slot
}

function shell() {
  _root.innerHTML = `
    <div id="sc-recados" style="margin-bottom:12px"></div>
    <div class="card" style="margin-bottom:12px">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🧭 Sala de Comando</h2>
        <span class="tiny muted">dia ${DIA}/${DIAS_MES} de ${MES_LBL} · ${Math.round(PACE * 100)}% do mês decorrido</span>
        <button class="btn btn-ghost btn-sm" id="sc-reload" style="margin-left:auto">🔄 Atualizar</button>
      </div>
      <div id="sc-farois" class="mt-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px"></div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <b>🚨 Alertas & Decisões</b>
      <div class="tiny muted" style="margin:2px 0 8px">cruzamento dos fronts — cada alerta pode virar tarefa com um clique</div>
      <div id="sc-alertas"><span class="spinner"></span></div>
    </div>
    <div class="card">
      <b>🔎 Drill-down por área</b>
      <div id="sc-areas" class="mt-2" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px"></div>
    </div>`;
  document.getElementById('sc-reload').onclick = () => { Object.keys(_d).forEach(k => delete _d[k]); shell(); carregar(true); };
  farois();   // esqueleto dos faróis (spinners)
  areas();
}

async function carregar(fresh) {
  const nc = fresh ? '&nocache=1' : '';
  const ini = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
  const fim = hoje.toISOString().slice(0, 10);
  const calls = {
    overview:  () => api.request('/api/v3/metrics/overview'),
    metas:     () => api.request('/api/v3/metas/atingimento?ano=' + hoje.getFullYear()),
    health:    () => api.request('/api/v3/system_health'),
    recados:   () => api.request('/api/v3/diretoria/recados'),
    hubPainel: () => api.request('/api/v3/psmhub/financeiro?secao=painel' + nc),
    hubContas: () => api.request('/api/v3/psmhub/financeiro?secao=contas' + nc),
    hubAcomp:  () => api.request('/api/v3/psmhub/financeiro?secao=acompanhamento' + nc),
    gc:        () => api.request(`/api/v3/oo/comercial?since=${ini}&until=${fim}`),
  };
  await Promise.all(Object.entries(calls).map(async ([k, fn]) => {
    try { _d[k] = await fn(); } catch (e) { _d[k] = { _err: e.message }; }
    farois(); alertas(); areas();
    if (k === 'recados') recados();
  }));
}

/* ── Recados (widget de leitura; gestão completa continua em #/diretoria) ── */
function recados() {
  const el = document.getElementById('sc-recados');
  if (!el) return;
  const rs = (_d.recados && _d.recados.recados) || [];
  if (!rs.length) { el.innerHTML = ''; return; }
  const PRIOR = { critico: ['🔴', '#fee2e2', '#991b1b'], atencao: ['🟡', '#fef3c7', '#92400e'], info: ['🔵', 'var(--bg-3)', 'var(--ink)'] };
  el.innerHTML = rs.slice(0, 3).map(r => {
    const [ico, bg, fg] = PRIOR[r.prioridade] || PRIOR.info;
    return `<div style="background:${bg};color:${fg};border-radius:var(--r-sm);padding:8px 14px;margin-bottom:4px;font-size:13px">
      ${ico} <b>${esc(r.titulo || '')}</b> ${esc(r.mensagem || r.texto || '')}</div>`;
  }).join('') + `<div class="tiny" style="text-align:right"><a href="#/diretoria?tab=recados">📢 gerenciar recados (${rs.length})</a></div>`;
}

/* ── Camada 1: FARÓIS ── */
function hubDados(sec) { const d = _d[sec]; return (d && d.ok && d.dados) ? d.dados : null; }

function calcContas() {
  const dd = hubDados('hubContas');
  if (!dd || !Array.isArray(dd.lancamentos)) return null;
  const hj = hoje.toISOString().slice(0, 10);
  const out = { pagar_venc: 0, receber_venc: 0, pagar_7d: 0, receber_7d: 0 };
  const em7 = new Date(hoje.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  for (const l of dd.lancamentos) {
    const aberto = String(l.status || '').toLowerCase() !== 'pago';
    if (!aberto) continue;
    const falta = Math.max(0, num(l.amount) - num(l.amountPaid));
    if (!falta) continue;
    const due = String(l.dueDate || '').slice(0, 10);
    const ehPagar = String(l.type || '').toLowerCase().includes('pag');
    if (due && due < hj) { ehPagar ? out.pagar_venc += falta : out.receber_venc += falta; }
    else if (due && due <= em7) { ehPagar ? out.pagar_7d += falta : out.receber_7d += falta; }
  }
  return out;
}

function calcCaixa() {
  const dd = hubDados('hubPainel');
  if (!dd || !Array.isArray(dd.contas_bancarias)) return null;
  let total = 0, achou = false;
  for (const c of dd.contas_bancarias) {
    for (const k of ['currentBalance', 'balance', 'saldo', 'saldoAtual', 'initialBalance']) {
      if (c[k] != null && !isNaN(parseFloat(c[k]))) { total += parseFloat(c[k]); achou = true; break; }
    }
  }
  return achou ? total : null;
}

function farois() {
  const el = document.getElementById('sc-farois');
  if (!el) return;
  const cards = [];
  const card = (titulo, valor, sub, cor) => cards.push(`
    <div style="background:var(--bg-3);border-radius:12px;padding:12px 14px">
      <div class="tiny muted" style="display:flex;justify-content:space-between;align-items:center">${titulo}${cor ? farolDot(cor) : ''}</div>
      <div style="font-weight:800;font-size:19px;margin:2px 0">${valor}</div>
      <div class="tiny muted">${sub || ''}</div>
    </div>`);
  const spin = t => card(t, '<span class="spinner"></span>', 'carregando…');

  // 1) Vendas do mês × pace
  const ov = _d.overview;
  if (!ov) spin('Vendas do mês');
  else if (ov._err || !ov.sales) card('Vendas do mês', '—', 'overview indisponível', COR.mute);
  else {
    const mt = _d.metas && _d.metas.totals;
    const metaMes = mt && mt.meta_vgv ? mt.meta_vgv / 12 : null;   // sem grade mensal → meta anual ÷12
    const vm = ov.sales.vgv_mes || 0;
    const ritmo = metaMes ? vm / (metaMes * PACE) : null;
    card(`Vendas de ${MES_LBL}`, `${ov.sales.vendas_mes || 0} · ${moneyK(vm)}`,
      metaMes ? `meta ÷12 ${moneyK(metaMes)} · ritmo ${Math.round((ritmo || 0) * 100)}% do pace` : 'sem meta definida',
      ritmo == null ? COR.mute : ritmo >= 1 ? COR.ok : ritmo >= 0.7 ? COR.warn : COR.bad);
  }

  // 2) VGV do ano × meta
  const m = _d.metas;
  if (!m) spin('VGV do ano × meta');
  else if (m._err || !m.totals) card('VGV do ano × meta', '—', 'metas indisponível', COR.mute);
  else {
    const pct = m.totals.meta_vgv ? m.totals.atingido_vgv / m.totals.meta_vgv : 0;
    const paceAno = ((hoje - new Date(hoje.getFullYear(), 0, 1)) / 864e5) / 365;
    card('VGV do ano × meta', `${moneyK(m.totals.atingido_vgv)} <span class="tiny muted">/ ${moneyK(m.totals.meta_vgv)}</span>`,
      `${m.total_vendas || 0} vendas · ${Math.round(pct * 100)}% da meta (ano ${Math.round(paceAno * 100)}% decorrido)`,
      pct >= paceAno ? COR.ok : pct >= paceAno * 0.7 ? COR.warn : COR.bad);
  }

  // 3) Pipeline esperado (forecast GC do mês)
  const gc = _d.gc;
  if (!gc) spin('Pipeline esperado');
  else if (gc._err || !gc.forecast) card('Pipeline esperado', '—', 'gestão comercial indisponível', COR.mute);
  else {
    let tv = 0, tvgv = 0;
    Object.values(gc.forecast).forEach(f => { if (f && typeof f === 'object') { tv += num(f.pipeline_vendas_esp); tvgv += num(f.pipeline_vgv_esp); } });
    card('Pipeline esperado', `${tv.toFixed(1)} vendas`, `${moneyK(tvgv)} esperados da esteira atual`, tv > 0 ? COR.ok : COR.warn);
  }

  // 4) Caixa (contas bancárias do HUB)
  if (!_d.hubPainel) spin('Caixa (HUB)');
  else {
    const cx = calcCaixa();
    card('Caixa (contas HUB)', cx == null ? '—' : moneyK(cx),
      cx == null ? 'saldo não informado no Hub — <a href="#/financeiro?tab=psmhub">ver Financeiro</a>' : `${(hubDados('hubPainel')?.contas_bancarias || []).length} contas`,
      cx == null ? COR.mute : cx > 0 ? COR.ok : COR.bad);
  }

  // 5/6) Vencidos a pagar / a receber
  if (!_d.hubContas) { spin('A pagar vencido'); spin('A receber vencido'); }
  else {
    const c = calcContas();
    if (!c) { card('A pagar vencido', '—', 'contas do HUB indisponíveis', COR.mute); card('A receber vencido', '—', '', COR.mute); }
    else {
      card('A pagar vencido', moneyK(c.pagar_venc), `+ ${moneyK(c.pagar_7d)} vencem em 7d`, c.pagar_venc > 0 ? COR.bad : COR.ok);
      card('A receber vencido', moneyK(c.receber_venc), `+ ${moneyK(c.receber_7d)} vencem em 7d`, c.receber_venc > 0 ? COR.warn : COR.ok);
    }
  }

  // 7) Custo fixo mês: orçado × realizado (HUB acompanhamento)
  if (!_d.hubAcomp) spin('Custos (orç × real)');
  else {
    const dd = hubDados('hubAcomp');
    const mesIdx = hoje.getMonth() + 1;
    let orc = null, real = null;
    try {
      const rz = dd && dd.realizado; const oc = dd && dd.orcado;
      const soma = (x) => { let t = 0, ok = false; JSON.stringify(x, (k2, v2) => { if ((k2 === String(mesIdx) || k2 === 'total') && typeof v2 === 'number') { t += v2; ok = true; } return v2; }); return ok ? t : null; };
      real = rz ? soma(rz) : null; orc = Array.isArray(oc) && !oc.length ? null : (oc ? soma(oc) : null);
    } catch (_) { /* shape desconhecido → link */ }
    card('Custos (orç × real)', real != null ? moneyK(real) : '—',
      orc != null ? `orçado ${moneyK(orc)}` : '<a href="#/financeiro?tab=psmhub">detalhe no Financeiro · PSM HUB</a>',
      real != null && orc != null ? (real <= orc ? COR.ok : COR.bad) : COR.mute);
  }

  // 8) Saúde do sistema
  const h = _d.health;
  if (!h) spin('Sistema');
  else {
    const okc = h.ok !== false && !h._err;
    const falhas = (h.checks || h.items || []).filter ? (h.checks || h.items || []).filter(x => x && x.ok === false).length : 0;
    card('Sistema', okc && !falhas ? 'saudável' : (falhas ? `${falhas} falha(s)` : 'instável'),
      '<a href="#/qualidade">saúde dos cadastros</a>', okc && !falhas ? COR.ok : COR.bad);
  }

  el.innerHTML = cards.join('');
}

/* ── Camada 2: ALERTAS & DECISÕES ── */
function geraAlertas() {
  const its = [];
  const push = (nivel, texto, tarefa) => its.push({ nivel, texto, tarefa });

  const gc = _d.gc;
  if (gc && !gc._err && gc.alertas && Array.isArray(gc.alertas.itens)) {
    for (const a of gc.alertas.itens.slice(0, 8)) {
      const t = `${a.team ? '[' + a.team + '] ' : ''}${a.label || a.metrica || 'métrica'}: ${a.valor}${a.unidade === 'pct' ? '%' : ''} (régua ${a.tipo === 'min' ? '≥' : '≤'} ${a.limite})`;
      push('bad', t, `Corrigir ${a.label || a.metrica} — ${a.team || 'equipe'}`);
    }
  }
  const c = calcContas();
  if (c && c.pagar_venc > 0) push('bad', `Contas a PAGAR vencidas: ${money(c.pagar_venc)} em aberto no Hub`, `Quitar/renegociar contas vencidas (${moneyK(c.pagar_venc)})`);
  if (c && c.receber_venc > 0) push('warn', `A RECEBER vencido: ${money(c.receber_venc)} — cobrar`, `Cobrar recebíveis vencidos (${moneyK(c.receber_venc)})`);
  const m = _d.metas, ov = _d.overview;
  if (m && m.totals && ov && ov.sales) {
    const metaMes = m.totals.meta_vgv ? m.totals.meta_vgv / 12 : 0;
    if (metaMes && DIA >= 5 && (ov.sales.vgv_mes || 0) < metaMes * PACE * 0.7)
      push('warn', `Ritmo do mês abaixo de 70% do pace (${moneyK(ov.sales.vgv_mes)} vs esperado ${moneyK(metaMes * PACE)})`, 'Plano de recuperação do ritmo do mês');
  }
  const h = _d.health;
  if (h && (h._err || h.ok === false)) push('bad', 'Saúde do sistema com falha — ver /qualidade', 'Investigar falha de sistema');
  return its;
}

function alertas() {
  const el = document.getElementById('sc-alertas');
  if (!el) return;
  const pend = ['gc', 'hubContas', 'metas', 'overview'].filter(k => !_d[k]).length;
  const its = geraAlertas();
  if (!its.length) { el.innerHTML = pend ? '<span class="spinner"></span> <span class="tiny muted">cruzando fronts…</span>' : '<div class="tiny" style="color:#16a34a">✅ Nenhum alerta fora da régua agora.</div>'; return; }
  el.innerHTML = its.map((a, i) => `
    <div class="flex items-center gap-2" style="border-top:1px solid var(--border);padding:7px 0;font-size:13px">
      ${farolDot(a.nivel === 'bad' ? COR.bad : COR.warn)}
      <span style="flex:1">${esc(a.texto)}</span>
      ${_tarefasCriadas.has(i) ? '<span class="tiny" style="color:#16a34a">✅ tarefa criada</span>'
        : `<button class="btn btn-ghost btn-sm" data-sc-task="${i}" style="font-size:11px;white-space:nowrap">📌 virar tarefa</button>`}
    </div>`).join('') + (pend ? '<div class="tiny muted" style="padding-top:6px"><span class="spinner"></span> ainda cruzando…</div>' : '');
  el.querySelectorAll('[data-sc-task]').forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.scTask); const a = geraAlertas()[i];
    if (!a) return;
    b.disabled = true;
    try {
      await api.request('/api/v3/tasks/upsert', { method: 'POST', body: {
        titulo: a.tarefa || a.texto.slice(0, 80), descricao: `Gerada pela Sala de Comando em ${hoje.toLocaleDateString('pt-BR')}: ${a.texto}`,
        prioridade: a.nivel === 'bad' ? 'alta' : 'media', responsavel: (auth.user() || {}).id, status: 'aberta', categoria: 'Sala de Comando',
      } });
      _tarefasCriadas.add(i); alertas();
    } catch (e) { b.disabled = false; b.textContent = '⚠️ ' + (e.message || 'erro'); }
  });
}

/* ── Camada 3: DRILL-DOWN ── */
function areas() {
  const el = document.getElementById('sc-areas');
  if (!el) return;
  const ov = _d.overview && _d.overview.sales;
  const c = calcContas();
  const A = [
    ['📊 Gestão Comercial', '#/gestao-comercial', ov ? `${ov.vendas_mes || 0} vendas no mês · pipeline ${moneyK(ov.pipeline_vgv)}` : '…'],
    ['💵 Financeiro · PSM HUB', '#/financeiro?tab=psmhub', c ? `vencidos: pagar ${moneyK(c.pagar_venc)} · receber ${moneyK(c.receber_venc)}` : '…'],
    ['💼 CRM House', '#/crm-house', 'kanban nativo (piloto)'],
    ['💚 Sucesso do Cliente', '#/sucesso-cliente', 'carteira, churn e LTV'],
    ['🧑‍🤝‍🧑 Pessoas & RH', '#/gestao-pessoas', 'clima, avaliações, ATS'],
    ['📣 Marketing', '#/marketing', 'campanhas e criativos'],
  ];
  el.innerHTML = A.map(([t, href, sub]) => `
    <a href="${href}" style="text-decoration:none;color:inherit;background:var(--bg-3);border-radius:12px;padding:12px 14px;display:block">
      <div style="font-weight:800">${t}</div><div class="tiny muted" style="margin-top:2px">${sub}</div>
    </a>`).join('');
}
