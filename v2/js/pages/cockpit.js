/* PSM-OS v2 — 🧭 Cockpit de Decisão (Diretoria, lvl≥7)
   Une os mini-sistemas num só painel: cada front carrega INDEPENDENTE
   (Promise.allSettled — se um cai, os outros seguem), com semáforo 🟢🟡🔴,
   e uma camada de ALERTAS & AÇÕES cruza os fronts pra decisão clara. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
const _f = {}; // resultado normalizado de cada front

const hoje = new Date();
const DIA = hoje.getDate();
const DIAS_MES = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
const PACE = DIA / DIAS_MES; // fração do mês decorrida

export async function pageCockpit(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Diretor (lvl 7+).</div>'; return; }
  render();
  await load();
}

async function load() {
  const calls = {
    overview: api.request('/api/v3/metrics/overview'),
    atg: api.request('/api/v3/metas/atingimento'),
    dre: api.request('/api/v3/finance/dre?months=1&company=all'),
    imoveis: api.request('/api/v3/imoveis/list?limit=1'),
    oo: api.request('/api/v3/oo/overview'),
    health: api.request('/api/v3/system_health'),
    custos: api.request('/api/v3/diretoria/strategy?board=custos_compartilhados'),
    mkt: api.request('/api/v3/marketing/summary'),
  };
  const keys = Object.keys(calls);
  const res = await Promise.allSettled(keys.map(k => calls[k]));
  const d = {};
  keys.forEach((k, i) => { d[k] = res[i].status === 'fulfilled' ? res[i].value : { __err: true }; });
  Object.assign(_f, normalize(d));
  renderFronts(); renderAlertas(); renderVeredito();
}

/* ── normaliza cada front num resumo {status, kpis[], alerta} ── */
function normalize(d) {
  const f = {};
  const sales = d.overview?.sales || {}, metasOv = d.overview?.metas || {}, comm = d.overview?.commissions || {}, usersOv = d.overview?.users || {};
  const t = d.atg?.totals || {};

  // COMERCIAL (RD)
  f.comercial = okOrErr(d.overview, () => {
    const vgvMes = +sales.vgv_mes || 0, pipe = +sales.pipeline_vgv || 0, vendas = +sales.vendas_mes || 0;
    const vgvAno = +sales.vgv_ano || 0, vendasAno = +sales.vendas_ano || 0;
    return { nome: 'Comercial', icon: '📈', rota: '/crm',
      status: vgvMes > 0 ? 'ok' : (pipe > 0 ? 'warn' : 'bad'),
      kpis: [['Vendas mês', vendas], ['VGV mês', money(vgvMes)], ['Vendas ano', vendasAno], ['VGV ano', money(vgvAno)], ['Pipeline', money(pipe)]],
      _vgvMes: vgvMes, _pipe: pipe, _perdido: +sales.vgv_perdido_mes || 0 };
  });

  // METAS
  f.metas = okOrErr(d.atg, () => {
    const meta = +t.meta_vgv || +metasOv.meta_vgv || 0;
    const atg = +t.atingido_vgv || 0;
    const pct = meta > 0 ? atg / meta * 100 : 0;
    const gap = Math.max(0, meta - atg);
    const noRitmo = pct >= PACE * 100 * 0.9;
    return { nome: 'Metas', icon: '🎯', rota: '/metas',
      status: meta === 0 ? 'warn' : (noRitmo ? 'ok' : (pct >= PACE * 100 * 0.6 ? 'warn' : 'bad')),
      kpis: [['Atingido', pct2(pct)], ['Meta', money(meta)], ['Gap', money(gap)]],
      _meta: meta, _atg: atg, _gap: gap, _pct: pct };
  });

  // FINANCEIRO (NIBO/DRE)
  f.financeiro = okOrErr(d.dre, () => {
    const tot = d.dre?.totals || {};
    const receita = +tot.receita || 0, despesa = +tot.despesa || 0;
    const saldo = (tot.saldo != null) ? +tot.saldo : (receita - despesa);
    if (receita === 0 && despesa === 0) return { nome: 'Financeiro', icon: '💰', rota: '/financeiro', status: 'warn', kpis: [['NIBO', 'sem dados']], _nibo: false };
    return { nome: 'Financeiro', icon: '💰', rota: '/financeiro',
      status: saldo >= 0 ? 'ok' : 'bad',
      kpis: [['Receita', money(receita)], ['Despesa', money(despesa)], ['Saldo', money(saldo)]],
      _saldo: saldo, _nibo: true };
  });

  // CUSTOS / VIABILIDADE (board custos_compartilhados)
  f.viab = okOrErr(d.custos, () => {
    const items = d.custos?.data?.items || [];
    const custoTot = items.reduce((s, c) => s + (+c.valor || 0), 0);
    const lines = d.custos?.data?.lines || null;
    return { nome: 'Custos / Viab', icon: '🧪', rota: '/metricas-viab',
      status: custoTot > 0 ? 'ok' : 'warn',
      kpis: [['Custo fixo/mês', money(custoTot)], ['Itens', items.length], ['Linhas', lines ? Object.keys(lines).length : '—']],
      _custoTot: custoTot };
  });

  // MARKETING (Meta)
  f.marketing = okOrErr(d.mkt, () => {
    const accs = d.mkt?.accounts || d.mkt?.campaigns || [];
    const n = Array.isArray(accs) ? accs.length : 0;
    return { nome: 'Marketing', icon: '📣', rota: '/marketing',
      status: d.mkt?.ok === false ? 'warn' : 'ok',
      kpis: [['Contas/Camp.', n || '—'], ['Status', d.mkt?.ok === false ? 'token?' : 'ativo']] };
  });

  // ESTOQUE / CAPTAÇÃO
  f.estoque = okOrErr(d.imoveis, () => {
    const k = d.imoveis?.kpis || {};
    const disp = +k.disponiveis || 0, valor = +k.valor_total || 0;
    return { nome: 'Estoque', icon: '🏠', rota: '/imoveis',
      status: disp > 0 ? 'ok' : 'warn',
      kpis: [['Disponíveis', disp], ['VGV estoque', money(valor)], ['Total', +k.total || 0]],
      _disp: disp };
  });

  // EQUIPE
  f.equipe = okOrErr(d.atg, () => {
    const pc = d.atg?.por_corretor || [];
    const abaixo = pc.filter(c => (c.meta_vgv > 0) && (c.vgv_atingido / c.meta_vgv < 0.5)).length;
    const ativos = +usersOv.ativos || pc.length || 0;
    return { nome: 'Equipe', icon: '👥', rota: '/equipe',
      status: abaixo === 0 ? 'ok' : (abaixo <= 3 ? 'warn' : 'bad'),
      kpis: [['Ativos', ativos], ['< 50% meta', abaixo]],
      _abaixo: abaixo };
  });

  // SISTEMA
  f.sistema = okOrErr(d.health, () => {
    const issues = d.health?.issues || [];
    return { nome: 'Sistema', icon: '🩺', rota: '/governanca',
      status: issues.length === 0 ? 'ok' : (issues.length <= 2 ? 'warn' : 'bad'),
      kpis: [['Saúde', issues.length === 0 ? 'OK' : issues.length + ' alerta(s)']],
      _issues: issues };
  });

  // dados crus pra os cruzamentos
  f._raw = { comm, sales, t };
  return f;
}

function okOrErr(src, fn) {
  if (!src || src.__err || src.ok === false) {
    if (src && src.ok === false && !src.__err) { try { return { ...fn(), _soft: true }; } catch {} }
    return { __err: true };
  }
  try { return fn(); } catch { return { __err: true }; }
}

/* ── render ── */
function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🧭 Cockpit de Decisão</h2>
      <p class="card-sub">Todos os fronts num só painel — cada um independente, cruzados em alertas e ações. Sócio/Diretor.</p>
      <div id="ck-veredito"></div>
      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:16px 0 6px">Fronts (mini-sistemas)</div>
      <div id="ck-fronts" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px">
        <div class="muted tiny"><span class="spinner"></span> Carregando os fronts…</div>
      </div>
      <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:20px 0 6px">🔔 Alertas & Ações (cruzamentos)</div>
      <div id="ck-alertas"></div>

      <div class="flex" style="justify-content:space-between;align-items:center;margin:20px 0 6px;flex-wrap:wrap;gap:8px">
        <div class="tiny muted" style="text-transform:uppercase;font-weight:800">🧠 Recomendação da IA (decisão da semana)</div>
        <button class="btn btn-primary btn-sm" id="ck-ia-btn">🧠 Gerar recomendação</button>
      </div>
      <div id="ck-ia"><div class="tiny muted">A IA lê todos os fronts + alertas acima e escreve o foco da semana. Clique em "Gerar recomendação".</div></div>
    </div>`;
  const b = document.getElementById('ck-ia-btn'); if (b) b.addEventListener('click', pedirIA);
}

let _alertas = [];
async function pedirIA() {
  const btn = document.getElementById('ck-ia-btn'); const box = document.getElementById('ck-ia');
  if (btn) { btn.disabled = true; btn.textContent = '🧠 Pensando…'; }
  if (box) box.innerHTML = '<div class="tiny muted"><span class="spinner"></span> A IA está lendo o cockpit e priorizando…</div>';
  try {
    // monta o snapshot a partir do que já está carregado (dentro do try: qualquer erro aparece, não trava no spinner)
    const ORDER = ['comercial', 'metas', 'financeiro', 'custos', 'marketing', 'estoque', 'equipe', 'sistema'];
    const fronts = ORDER.map(k => _f[k]).filter(f => f && !f.__err).map(f => ({ nome: f.nome, status: f.status, kpis: f.kpis || [], alerta: f.alerta || '' }));
    if (!fronts.length) throw new Error('Os fronts ainda não carregaram — espere os semáforos acima aparecerem e clique de novo.');
    const veredito = (document.getElementById('ck-veredito')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const snapshot = { fronts, alertas: (_alertas || []).map(a => ({ sev: a.sev, txt: a.txt })), veredito, dia: DIA, dias_mes: DIAS_MES };
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('a IA demorou demais (timeout) — tente de novo.')), 55000));
    const r = await Promise.race([api.request('/api/v3/ia/cockpit', { method: 'POST', body: { snapshot } }), timeout]);
    if (r && r.ok && r.text) {
      box.innerHTML = `<div style="background:var(--bg-3);border:1px solid var(--border);border-left:4px solid #7c3aed;border-radius:12px;padding:16px;white-space:pre-wrap;font-size:13.5px;line-height:1.55">${esc(r.text)}</div>
        <div class="tiny muted" style="margin-top:6px">Gerado por ${esc(r.provider || 'IA')} · com base no estado atual dos fronts. Recomendação, não ordem — valide com o seu julgamento.</div>`;
    } else {
      box.innerHTML = `<div class="alert alert-warn">⚠️ Não consegui gerar agora${r && r.error ? ': ' + esc(r.error) : ''}.</div>`;
    }
  } catch (e) {
    if (box) box.innerHTML = `<div class="alert alert-err">⚠️ ${esc(e.message || e)}</div>`;
  }
  if (btn) { btn.disabled = false; btn.textContent = '🧠 Gerar recomendação'; }
}

const COR = { ok: '#16a34a', warn: '#d97706', bad: '#dc2626' };
const DOT = { ok: '🟢', warn: '🟡', bad: '🔴' };

function renderFronts() {
  const el = document.getElementById('ck-fronts'); if (!el) return;
  const order = ['comercial', 'metas', 'financeiro', 'viab', 'marketing', 'estoque', 'equipe', 'sistema'];
  el.innerHTML = order.map(k => {
    const f = _f[k];
    if (!f || f.__err) {
      const nome = { comercial: 'Comercial', metas: 'Metas', financeiro: 'Financeiro', viab: 'Custos/Viab', marketing: 'Marketing', estoque: 'Estoque', equipe: 'Equipe', sistema: 'Sistema' }[k];
      return `<div style="background:var(--bg-3);border-radius:10px;padding:14px;border-left:4px solid #94a3b8;opacity:.6">
        <div style="font-weight:800">⚪ ${nome}</div><div class="tiny muted" style="margin-top:6px">indisponível agora</div></div>`;
    }
    const cor = COR[f.status] || '#94a3b8';
    return `<div data-nav="${f.rota}" style="background:var(--bg-3);border-radius:10px;padding:14px;border-left:4px solid ${cor};cursor:pointer" title="abrir ${f.nome}">
      <div class="flex" style="justify-content:space-between;align-items:center">
        <div style="font-weight:800">${f.icon} ${f.nome}</div><div>${DOT[f.status] || '⚪'}</div>
      </div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:3px">
        ${(f.kpis || []).map(([l, v]) => `<div class="flex" style="justify-content:space-between;font-size:12.5px"><span class="muted">${l}</span><b>${v}</b></div>`).join('')}
      </div>${f._soft ? '<div class="tiny muted" style="margin-top:4px">parcial</div>' : ''}
    </div>`;
  }).join('');
  el.querySelectorAll('[data-nav]').forEach(c => c.addEventListener('click', () => { location.hash = c.dataset.nav; }));
}

function renderVeredito() {
  const el = document.getElementById('ck-veredito'); if (!el) return;
  const fronts = ['comercial', 'metas', 'financeiro', 'viab', 'estoque', 'equipe', 'sistema'].map(k => _f[k]).filter(f => f && !f.__err);
  const bad = fronts.filter(f => f.status === 'bad').length;
  const warn = fronts.filter(f => f.status === 'warn').length;
  const cor = bad > 0 ? COR.bad : (warn > 0 ? COR.warn : COR.ok);
  const txt = bad > 0 ? `${bad} front(s) em vermelho — atenção máxima` : (warn > 0 ? `${warn} ponto(s) de atenção` : 'todos os fronts saudáveis');
  el.innerHTML = `<div style="background:linear-gradient(135deg,${cor}22,transparent);border:1px solid ${cor}55;border-radius:10px;padding:14px;margin-top:10px">
    <div style="font-size:15px;font-weight:900;color:${cor}">${bad > 0 ? '🔴' : warn > 0 ? '🟡' : '🟢'} Estado da PSM: ${txt}</div>
    <div class="tiny muted" style="margin-top:2px">${fronts.length} fronts lidos · dia ${DIA}/${DIAS_MES} do mês (${pct2(PACE * 100)} decorrido)</div>
  </div>`;
}

function renderAlertas() {
  const el = document.getElementById('ck-alertas'); if (!el) return;
  const A = []; // {sev, txt, acao, rota}
  const add = (sev, txt, acao, rota) => A.push({ sev, txt, acao, rota });
  const m = _f.metas, c = _f.comercial, fin = _f.financeiro, eq = _f.equipe, est = _f.estoque, sis = _f.sistema;
  const comm = _f._raw?.comm || {};

  // CRUZAMENTO 1: meta vs pipeline (Metas × Comercial)
  if (m && !m.__err && c && !c.__err && m._gap > 0) {
    if (c._pipe < m._gap) add('bad', `Pipeline (${money(c._pipe)}) é MENOR que o gap de meta (${money(m._gap)}) — não fecha o mês no funil atual.`, 'Abrir CRM e puxar pipeline', '/crm');
    else add('ok', `Pipeline (${money(c._pipe)}) cobre o gap de meta (${money(m._gap)}). Foco em conversão.`, 'Ver funil', '/crm');
  }
  // CRUZAMENTO 2: ritmo da meta (Metas × calendário)
  if (m && !m.__err && m._meta > 0 && m._pct < PACE * 100 * 0.9) {
    add(m._pct < PACE * 100 * 0.6 ? 'bad' : 'warn', `Meta em ${pct2(m._pct)} com ${pct2(PACE * 100)} do mês decorrido — atrás do ritmo.`, 'Ver metas por corretor', '/metas');
  }
  // CRUZAMENTO 3: VGV perdido (Comercial)
  if (c && !c.__err && c._perdido > 0 && m && m._meta > 0 && c._perdido > m._meta * 0.15) {
    add('warn', `VGV perdido no mês (${money(c._perdido)}) já passa de 15% da meta — revisar motivos de perda.`, 'Cérebro de Vendas', '/cerebro-vendas');
  }
  // CRUZAMENTO 4: comissões a pagar (Financeiro)
  if (comm.valor_pendente > 0) add('warn', `Comissões pendentes de pagamento: ${money(comm.valor_pendente)}.`, 'Ver comissões', '/financeiro');
  // CRUZAMENTO 5: caixa negativo (Financeiro)
  if (fin && !fin.__err && fin._nibo && fin._saldo < 0) add('bad', `Caixa do mês negativo (${money(fin._saldo)}) no NIBO.`, 'Abrir Financeiro', '/financeiro');
  // CRUZAMENTO 6: estoque baixo (Estoque × Comercial)
  if (est && !est.__err && est._disp != null && est._disp < 10) add('warn', `Estoque disponível baixo (${est._disp} imóveis) — alimentar captação pra sustentar vendas.`, 'Ver Captações', '/captacoes');
  // CRUZAMENTO 7: equipe abaixo (Equipe)
  if (eq && !eq.__err && eq._abaixo > 0) add(eq._abaixo > 3 ? 'bad' : 'warn', `${eq._abaixo} corretor(es) abaixo de 50% da meta.`, 'Ver Sr. Gerência', '/sr-gerencia');
  // CRUZAMENTO 8: sistema (infra)
  if (sis && !sis.__err && (sis._issues || []).length) add('warn', `Sistema com ${sis._issues.length} alerta(s) de saúde.`, 'Ver Governança', '/governanca');

  _alertas = A;
  if (!A.length) { el.innerHTML = '<div class="alert" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);padding:12px;border-radius:8px">🟢 Nenhum alerta cruzado no momento — fronts alinhados.</div>'; return; }
  A.sort((a, b) => (a.sev === 'bad' ? -1 : 1) - (b.sev === 'bad' ? -1 : 1));
  el.innerHTML = A.map(a => {
    const cor = COR[a.sev];
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:${cor}11;border-left:4px solid ${cor};border-radius:8px;padding:10px 12px;margin-bottom:8px;flex-wrap:wrap">
      <div style="font-size:12.5px;flex:1;min-width:240px">${DOT[a.sev]} ${a.txt}</div>
      <button class="btn btn-ghost btn-sm" data-nav="${a.rota}">${a.acao} →</button></div>`;
  }).join('');
  el.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.nav; }));
}

/* ── helpers ── */
function money(n) {
  return 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
