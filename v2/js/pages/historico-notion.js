/* PSM-OS v2 — 📜 Histórico Notion (Diretoria · v88.35) — SÓ sócio.
   A gestão antiga da PSM no Notion (PSM VENDAS / PSM LOCAÇÃO, nov/2024–set/2026) + as vendas
   de 2023–2026 que foram registradas lá, para guardar a história e comparar:
     1. Visão geral — ano a ano (vendas, VGV, ticket, comissão) e o que muda de um ano pro outro.
     2. Comparar — qualquer recorte (mês, corretor, origem, empreendimento, tipo) × anos,
        mesmo período (acumulado até o mês X) e variação.
     3. Notion × RD — o que o Notion registrou contra as vendas ganhas no RD, mês a mês.
     4. Vendas — a lista completa, com filtros e exportação.
     5. Metas 2025 — meta × realizado por corretor.
     6. Arquivo — todas as páginas e bancos do Notion, com busca.
   Dados: /api/v3/diretoria/historico (tabela hist_notion, fechada). Entram por upload do
   arquivo gerado por historico-notion/_scripts/convert.py — nunca pelo repositório. */
import { api } from '../api.js';

let _root = null, _d = null, _tab = 'geral', _arq = null, _abertos = new Set();
const F = { dim: 'mes', met: 'vgv', anos: null, ate: null, vAno: '', vCorretor: '', vOrigem: '', vBusca: '', vOrd: 'data', rdAno: '', q: '' };

const TABS = [
  { id: 'geral', lbl: '📈 Visão geral' }, { id: 'comparar', lbl: '⚖️ Comparar' }, { id: 'rd', lbl: '🔁 Notion × RD' },
  { id: 'vendas', lbl: '🧾 Vendas' }, { id: 'metas', lbl: '🎯 Metas 2025' }, { id: 'arquivo', lbl: '🗂 Arquivo' },
];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const ORIGEM = {
  carteira: 'Carteira', trafego_pago_psm: 'Lead · tráfego PSM', trafego_pago_corretor: 'Lead · tráfego corretor',
  organico_site: 'Orgânico', indicacao: 'Indicação', networking: 'Networking', parceria: 'Parceria',
  reativacao: 'Reativação', outros: 'Outros', nao_classificada: 'Não classificada', sem_origem: 'Sem origem',
};
const DIMS = [
  { id: 'mes', lbl: 'Mês do ano' }, { id: 'corretor', lbl: 'Corretor' }, { id: 'origem_cat', lbl: 'Origem' },
  { id: 'empreendimento', lbl: 'Empreendimento' }, { id: 'tipo', lbl: 'Tipo de venda' },
];
const METS = [{ id: 'vgv', lbl: 'VGV' }, { id: 'n', lbl: 'Nº de vendas' }, { id: 'ticket', lbl: 'Ticket médio' }, { id: 'comissao', lbl: 'Comissão imob' }];

const CSS = `
.hn-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.hn-tab{border:1px solid var(--bd);background:var(--bg-2);border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;color:var(--tx)}
.hn-tab.on{background:var(--psm-navy);color:#fff;border-color:var(--psm-navy)}
.hn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.hn-kpi{border:1px solid var(--bd);border-radius:10px;padding:10px 12px;background:var(--bg-2)}
.hn-kpi .a{font-weight:900;font-size:15px}.hn-kpi .v{font-size:20px;font-weight:800;margin:2px 0}
.hn-kpi .l{font-size:12px;color:var(--muted);line-height:1.5}
.hn-up{color:var(--ok)}.hn-dn{color:var(--err)}
.hn-bars{display:flex;align-items:flex-end;gap:3px;height:150px;padding-top:6px;overflow-x:auto}
.hn-bar{flex:1 0 14px;min-width:14px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}
.hn-bar i{display:block;width:100%;border-radius:3px 3px 0 0;background:var(--psm-navy)}
.hn-bar b{font-size:9px;color:var(--muted);font-weight:500;margin-top:3px;white-space:nowrap}
.hn-tbl{width:100%;border-collapse:collapse;font-size:13px}
.hn-tbl th,.hn-tbl td{padding:6px 8px;border-bottom:1px solid var(--bd);text-align:left;vertical-align:top}
.hn-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);position:sticky;top:0;background:var(--bg-2)}
.hn-tbl td.n,.hn-tbl th.n{text-align:right;white-space:nowrap}
.hn-tbl tr.tot td{font-weight:800;border-top:2px solid var(--bd)}
.hn-wrap{overflow:auto;max-height:70vh}
.hn-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.hn-ctl label{font-size:12px;color:var(--muted);display:flex;gap:4px;align-items:center}
.hn-flag{display:inline-block;padding:1px 6px;border-radius:6px;font-size:11px;font-weight:700}
.hn-flag.ok{background:#dcfce7;color:var(--ok-escuro)}.hn-flag.warn{background:#fef3c7;color:var(--warn-escuro)}.hn-flag.err{background:#fee2e2;color:var(--err-forte)}
.hn-arq{display:grid;grid-template-columns:minmax(260px,1fr) 2fr;gap:12px}
@media(max-width:900px){.hn-arq{grid-template-columns:1fr}}
.hn-tree{max-height:70vh;overflow:auto;font-size:13px}
.hn-node{padding:3px 4px;border-radius:6px;cursor:pointer;display:flex;gap:4px}
.hn-node:hover{background:var(--bg-3)}.hn-node.sel{background:var(--bg-3);font-weight:700}
.hn-doc{max-height:70vh;overflow:auto;font-size:14px;line-height:1.55}
.hn-doc h1{font-size:20px;margin:0 0 8px}.hn-doc h2{font-size:17px;margin:14px 0 6px}.hn-doc h3,.hn-doc h4{font-size:15px;margin:12px 0 4px}
.hn-doc ul{margin:4px 0 4px 18px;padding:0}.hn-doc blockquote{border-left:3px solid var(--bd);margin:6px 0;padding:2px 10px;color:var(--ink-2)}
.hn-doc hr{border:0;border-top:1px solid var(--bd);margin:10px 0}.hn-doc table{border-collapse:collapse;margin:8px 0;font-size:13px}
.hn-doc td,.hn-doc th{border:1px solid var(--bd);padding:4px 6px}.hn-doc code{background:var(--bg-3);padding:0 4px;border-radius:4px}
.hn-doc pre{background:var(--bg-3);padding:8px;border-radius:6px;overflow:auto}
.hn-prog{height:8px;background:var(--bg-3);border-radius:4px;overflow:hidden}.hn-prog i{display:block;height:100%;background:var(--psm-navy)}
`;

export async function pageHistoricoNotion(ctx, root) {
  _root = root;
  _root.innerHTML = `<style>${CSS}</style><div id="hn"><div class="card"><div class="muted tiny"><span class="spinner"></span> Carregando o histórico…</div></div></div>`;
  await load();
}

async function load() {
  const el = document.getElementById('hn');
  try {
    _d = await api.request('/api/v3/diretoria/historico');
    if (_d.vazio) { el.innerHTML = importHTML(true); bindImport(); return; }
    const anos = [...new Set(_d.vendas.map(v => v.ano))].sort();
    if (!F.anos) F.anos = anos;
    if (!F.rdAno) F.rdAno = String(anos[anos.length - 1] - 1);
    render();
  } catch (e) {
    el.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  const el = document.getElementById('hn');
  const m = _d.meta || {};
  el.innerHTML = `
    <div class="card">
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:8px">
        <div>
          <div class="card-title">📜 Histórico da gestão no Notion</div>
          <div class="card-sub">Workspace ${esc(m.workspace || '')} · ${esc((m.teamspaces || []).join(' + '))} · ${num(m.paginas)} páginas, ${num(m.bancos)} bancos, ${num(m.vendas)} vendas (2023–2026) · extraído em ${dataBR(m.extraido_em)}</div>
        </div>
      </div>
      <div class="hn-tabs mt-3">${TABS.map(t => `<button class="hn-tab ${t.id === _tab ? 'on' : ''}" data-tab="${t.id}">${t.lbl}</button>`).join('')}</div>
      <div id="hn-body"></div>
    </div>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { _tab = b.dataset.tab; render(); });
  const body = document.getElementById('hn-body');
  const views = { geral: geralHTML, comparar: compararHTML, rd: rdHTML, vendas: vendasHTML, metas: metasHTML, arquivo: () => '<div id="hn-arq"></div>' };
  body.innerHTML = views[_tab]();
  bindControls(body);
  if (_tab === 'arquivo') renderArquivo();
}

/* ─── agregações ─────────────────────────────────────────────────────── */
const anosDe = () => [...new Set(_d.vendas.map(v => v.ano))].sort();
function soma(rows) {
  const n = rows.length, vgv = rows.reduce((a, v) => a + v.valor, 0), com = rows.reduce((a, v) => a + (v.comissao || 0), 0);
  return { n, vgv, ticket: n ? vgv / n : 0, comissao: com };
}
function chave(v, dim) {
  if (dim === 'mes') return v.mes ? Number(v.mes.slice(5, 7)) : 0;
  if (dim === 'origem_cat') return v.origem_cat || 'sem_origem';
  return v[dim] || '—';
}
function rotulo(k, dim) {
  if (dim === 'mes') return k ? MESES[k - 1] : 'Sem data';
  if (dim === 'origem_cat') return ORIGEM[k] || k;
  return k;
}
const mesMax = ano => Math.max(0, ...(_d.vendas.filter(v => v.ano === ano && v.mes).map(v => Number(v.mes.slice(5, 7)))));

/* ─── 1. visão geral ─────────────────────────────────────────────────── */
function geralHTML() {
  const anos = anosDe();
  const porAno = Object.fromEntries(anos.map(a => [a, soma(_d.vendas.filter(v => v.ano === a))]));
  const kpis = anos.map((a, i) => {
    const s = porAno[a], p = porAno[anos[i - 1]];
    const mm = mesMax(a), parcial = mm < 12;
    return `<div class="hn-kpi">
      <div class="a">${a}${parcial ? ` <span class="tiny muted">(até ${MESES[mm - 1] || '—'})</span>` : ''}</div>
      <div class="v">${brl(s.vgv)}</div>
      <div class="l">${s.n} vendas · ticket ${brl(s.ticket)}<br>comissão imob ≈ ${brl(s.comissao)}${p && !parcial ? `<br>VGV ${delta(s.vgv, p.vgv)} · ticket ${delta(s.ticket, p.ticket)}` : ''}</div>
    </div>`;
  }).join('');
  // barras mês a mês, todos os anos em sequência
  const meses = [];
  for (const a of anos) for (let m = 1; m <= 12; m++) {
    const ym = `${a}-${String(m).padStart(2, '0')}`;
    const rows = _d.vendas.filter(v => v.mes === ym);
    if (a === anos[anos.length - 1] && m > mesMax(a)) break;
    meses.push({ ym, a, m, ...soma(rows) });
  }
  const primeiro = meses.findIndex(x => x.n > 0);
  const serie = meses.slice(Math.max(0, primeiro));
  const max = Math.max(1, ...serie.map(x => x.vgv));
  const bars = serie.map(x => `<div class="hn-bar" title="${MESES[x.m - 1]}/${x.a}: ${x.n} vendas · ${brl(x.vgv)}">
      <i style="height:${Math.max(x.vgv ? 2 : 0, x.vgv / max * 100)}%;${x.a % 2 ? 'opacity:.6' : ''}"></i><b>${x.m === 1 || x === serie[0] ? `${MESES[x.m - 1]}/${String(x.a).slice(2)}` : MESES[x.m - 1][0]}</b></div>`).join('');
  return `
    <div class="hn-kpis">${kpis}</div>
    <div class="card mt-3"><div class="card-title">VGV mês a mês</div><div class="card-sub">Passe o mouse para ver cada mês. Anos alternam de tom.</div>
      <div class="hn-bars">${bars}</div></div>
    <div class="card mt-3"><div class="card-title">O que os números mostram</div>${leituras(anos, porAno).map(t => `<p class="tiny" style="margin:6px 0">${t}</p>`).join('')}</div>`;
}

function leituras(anos, porAno) {
  const out = [];
  for (const a of anos) {
    const rows = _d.vendas.filter(v => v.ano === a), s = porAno[a];
    if (!s.vgv) continue;
    const pm = {};
    rows.forEach(v => { if (v.mes) pm[v.mes] = (pm[v.mes] || 0) + v.valor; });
    const top2 = Object.entries(pm).sort((x, y) => y[1] - x[1]).slice(0, 2);
    const conc = top2.reduce((x, y) => x + y[1], 0) / s.vgv;
    const pc = {};
    rows.forEach(v => { pc[v.corretor] = (pc[v.corretor] || 0) + v.valor; });
    const lider = Object.entries(pc).sort((x, y) => y[1] - x[1])[0];
    const cart = rows.filter(v => v.origem_cat === 'carteira').reduce((x, v) => x + v.valor, 0) / s.vgv;
    out.push(`<b>${a}:</b> os 2 maiores meses (${top2.map(([m]) => MESES[Number(m.slice(5)) - 1]).join(' e ')}) fizeram <b>${pct(conc)}</b> do VGV · quem mais vendeu: <b>${esc(lider[0])}</b> (${pct(lider[1] / s.vgv)}) · carteira: ${pct(cart)} do VGV · ${Object.keys(pc).length} corretores venderam.`);
  }
  return out;
}

/* ─── 2. comparar ────────────────────────────────────────────────────── */
function compararHTML() {
  const anos = anosDe(), sel = anos.filter(a => F.anos.includes(a));
  const ultimo = anos[anos.length - 1];
  const ate = F.ate === null ? 12 : F.ate;
  const base = _d.vendas.filter(v => sel.includes(v.ano) && (ate === 12 || (v.mes && Number(v.mes.slice(5)) <= ate)));
  const ks = [...new Set(base.map(v => chave(v, F.dim)))];
  const cel = (k, a) => soma(base.filter(v => v.ano === a && chave(v, F.dim) === k));
  const val = s => s[F.met];
  const rows = ks.map(k => ({ k, por: Object.fromEntries(sel.map(a => [a, cel(k, a)])) }));
  const tot = Object.fromEntries(sel.map(a => [a, soma(base.filter(v => v.ano === a))]));
  if (F.dim === 'mes') rows.sort((x, y) => x.k - y.k);
  else rows.sort((x, y) => sel.reduce((s, a) => s + val(y.por[a]), 0) - sel.reduce((s, a) => s + val(x.por[a]), 0));
  const max = Math.max(1, ...rows.flatMap(r => sel.map(a => val(r.por[a]))));
  const [pa, ua] = [sel[sel.length - 2], sel[sel.length - 1]];
  const fmt = v => F.met === 'n' ? num(v) : brl(v);
  const cell = s => {
    const v = val(s);
    return `<td class="n" style="background:linear-gradient(90deg,rgba(30,38,80,.12) ${v / max * 100}%,transparent 0)">${v ? fmt(v) : '<span class="muted">—</span>'}</td>`;
  };
  return `
    <div class="hn-ctl">
      <label>Recorte <select class="select" data-f="dim">${DIMS.map(o => `<option value="${o.id}" ${o.id === F.dim ? 'selected' : ''}>${o.lbl}</option>`).join('')}</select></label>
      <label>Métrica <select class="select" data-f="met">${METS.map(o => `<option value="${o.id}" ${o.id === F.met ? 'selected' : ''}>${o.lbl}</option>`).join('')}</select></label>
      <label>Período <select class="select" data-f="ate"><option value="12">Ano inteiro</option>${MESES.map((m, i) => `<option value="${i + 1}" ${ate === i + 1 ? 'selected' : ''}>Jan até ${m} (mesmo período)</option>`).join('')}</select></label>
      <span class="tiny muted">Anos:</span>${anos.map(a => `<label><input type="checkbox" data-ano="${a}" ${F.anos.includes(a) ? 'checked' : ''}> ${a}</label>`).join('')}
      <button class="btn btn-ghost btn-sm" data-mesmo="${mesMax(ultimo)}">Mesmo período de ${ultimo} (até ${MESES[mesMax(ultimo) - 1]})</button>
    </div>
    <div class="hn-wrap"><table class="hn-tbl">
      <thead><tr><th>${DIMS.find(d => d.id === F.dim).lbl}</th>${sel.map(a => `<th class="n">${a}</th>`).join('')}${pa ? `<th class="n">${ua} × ${pa}</th>` : ''}</tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(rotulo(r.k, F.dim))}</td>${sel.map(a => cell(r.por[a])).join('')}${pa ? `<td class="n">${delta(val(r.por[ua]), val(r.por[pa]))}</td>` : ''}</tr>`).join('')}
        <tr class="tot"><td>Total</td>${sel.map(a => `<td class="n">${fmt(val(tot[a]))}</td>`).join('')}${pa ? `<td class="n">${delta(val(tot[ua]), val(tot[pa]))}</td>` : ''}</tr>
      </tbody></table></div>
    <div class="tiny muted mt-2">Ticket médio = VGV ÷ vendas da célula. Comissão imob = valor × % de comissão registrado no Notion. ${ate < 12 ? `Comparando só jan–${MESES[ate - 1]} de cada ano.` : ''} ${mesMax(ultimo) < 12 ? `${ultimo} tem registros só até ${MESES[mesMax(ultimo) - 1]} — use "mesmo período" para comparar de forma justa.` : ''}</div>`;
}

/* ─── 3. Notion × RD ─────────────────────────────────────────────────── */
function rdHTML() {
  const rd = _d.rd || {};
  if (rd.erro) return `<div class="alert alert-warn">RD indisponível agora: ${esc(rd.erro)}</div>`;
  const nm = {};
  _d.vendas.forEach(v => { if (!v.mes) return; const x = nm[v.mes] = nm[v.mes] || { n: 0, vgv: 0 }; x.n++; x.vgv += v.valor; });
  const rm = Object.fromEntries((rd.mensal || []).map(x => [x.mes, x]));
  const meses = [...new Set([...Object.keys(nm), ...Object.keys(rm)])].sort();
  const fimNotion = Object.keys(nm).sort().pop();
  const anos = [...new Set(meses.map(m => m.slice(0, 4)))];
  const porAno = anos.map(a => {
    const n = meses.filter(m => m.startsWith(a) && m <= fimNotion).reduce((s, m) => ({ n: s.n + (nm[m]?.n || 0), vgv: s.vgv + (nm[m]?.vgv || 0) }), { n: 0, vgv: 0 });
    const r = meses.filter(m => m.startsWith(a) && m <= fimNotion).reduce((s, m) => ({ n: s.n + (rm[m]?.n || 0), vgv: s.vgv + (rm[m]?.vgv || 0) }), { n: 0, vgv: 0 });
    return { a, n, r };
  });
  const flag = (a, b) => {
    if (!a && !b) return '';
    const d = b ? Math.abs(a - b) / b : 1;
    return d <= 0.05 ? '<span class="hn-flag ok">bate</span>' : d <= 0.2 ? '<span class="hn-flag warn">diverge</span>' : '<span class="hn-flag err">diverge muito</span>';
  };
  // por corretor / origem no ano escolhido
  const ano = F.rdAno;
  const nc = {}, rc = {};
  _d.vendas.filter(v => String(v.ano) === ano).forEach(v => { const x = nc[v.corretor] = nc[v.corretor] || { n: 0, vgv: 0 }; x.n++; x.vgv += v.valor; });
  (rd.por_corretor || []).filter(x => x.ano === ano).forEach(x => { rc[x.corretor] = x; });
  const corretores = [...new Set([...Object.keys(nc), ...Object.keys(rc)])].sort((x, y) => ((nc[y]?.vgv || 0) + (rc[y]?.vgv || 0)) - ((nc[x]?.vgv || 0) + (rc[x]?.vgv || 0)));
  return `
    <div class="tiny muted mb-2">RD = negócios com <b>ganho</b> no RD Station, pelo mês do fechamento (mesma regra do Dicionário de Métricas). O Notion tem registros até ${mesAno(fimNotion)}; depois disso só o RD (a gestão passou para o PSM OS).</div>
    <div class="hn-kpis">${porAno.map(x => `<div class="hn-kpi"><div class="a">${x.a}</div>
      <div class="l">Notion: <b>${x.n.n}</b> vendas · <b>${brl(x.n.vgv)}</b><br>RD: <b>${x.r.n}</b> vendas · <b>${brl(x.r.vgv)}</b><br>Diferença: ${brl(x.n.vgv - x.r.vgv)} ${flag(x.n.vgv, x.r.vgv)}</div></div>`).join('')}</div>
    <div class="card mt-3"><div class="card-title">Mês a mês</div>
      <div class="hn-wrap"><table class="hn-tbl"><thead><tr><th>Mês</th><th class="n">Notion · vendas</th><th class="n">Notion · VGV</th><th class="n">RD · vendas</th><th class="n">RD · VGV</th><th class="n">Diferença VGV</th><th></th></tr></thead>
      <tbody>${meses.map(m => { const a = nm[m], b = rm[m], depois = m > fimNotion; return `<tr>
        <td>${mesAno(m)}</td><td class="n">${depois ? '<span class="muted">—</span>' : a?.n || 0}</td><td class="n">${depois ? '<span class="muted">—</span>' : brl(a?.vgv || 0)}</td>
        <td class="n">${b?.n || 0}</td><td class="n">${brl(b?.vgv || 0)}</td>
        <td class="n">${depois ? '' : brl((a?.vgv || 0) - (b?.vgv || 0))}</td><td>${depois ? '<span class="tiny muted">só RD</span>' : flag(a?.vgv || 0, b?.vgv || 0)}</td></tr>`; }).join('')}</tbody></table></div></div>
    <div class="card mt-3"><div class="flex justify-between items-center"><div class="card-title">Por corretor</div>
      <select class="select" data-f="rdAno">${anos.filter(a => a <= (fimNotion || '').slice(0, 4)).map(a => `<option ${a === ano ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
      <div class="tiny muted mb-2">No RD o corretor é o dono do negócio (primeiro nome do cadastro); "Sem corretor" = negócio sem dono ou de quem já saiu.</div>
      <div class="hn-wrap"><table class="hn-tbl"><thead><tr><th>Corretor</th><th class="n">Notion · vendas</th><th class="n">Notion · VGV</th><th class="n">RD · vendas</th><th class="n">RD · VGV</th><th></th></tr></thead>
      <tbody>${corretores.map(c => `<tr><td>${esc(c)}</td><td class="n">${nc[c]?.n || 0}</td><td class="n">${brl(nc[c]?.vgv || 0)}</td><td class="n">${rc[c]?.n || 0}</td><td class="n">${brl(rc[c]?.vgv || 0)}</td><td>${flag(nc[c]?.vgv || 0, rc[c]?.vgv || 0)}</td></tr>`).join('')}</tbody></table></div></div>
    ${rd.sem_data ? `<div class="tiny muted mt-2">${rd.sem_data} venda(s) ganha(s) no RD sem data de fechamento ficaram fora.</div>` : ''}`;
}

/* ─── 4. vendas ──────────────────────────────────────────────────────── */
function vendasFiltradas() {
  const q = F.vBusca.trim().toLowerCase();
  let r = _d.vendas.filter(v => (!F.vAno || String(v.ano) === F.vAno) && (!F.vCorretor || v.corretor === F.vCorretor)
    && (!F.vOrigem || v.origem_cat === F.vOrigem)
    && (!q || `${v.cliente} ${v.produto} ${v.empreendimento}`.toLowerCase().includes(q)));
  r = [...r].sort(F.vOrd === 'valor' ? (a, b) => b.valor - a.valor : (a, b) => (b.data || '').localeCompare(a.data || ''));
  return r;
}
function vendasHTML() {
  const r = vendasFiltradas(), s = soma(r);
  const corretores = [...new Set(_d.vendas.map(v => v.corretor))].sort();
  const origens = [...new Set(_d.vendas.map(v => v.origem_cat))];
  return `
    <div class="hn-ctl">
      <select class="select" data-f="vAno"><option value="">Todos os anos</option>${anosDe().map(a => `<option ${String(a) === F.vAno ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <select class="select" data-f="vCorretor"><option value="">Todos os corretores</option>${corretores.map(c => `<option ${c === F.vCorretor ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select class="select" data-f="vOrigem"><option value="">Todas as origens</option>${origens.map(o => `<option value="${o}" ${o === F.vOrigem ? 'selected' : ''}>${ORIGEM[o] || o}</option>`).join('')}</select>
      <input class="input" style="max-width:220px" placeholder="Cliente, produto…" data-f="vBusca" value="${esc(F.vBusca)}">
      <select class="select" data-f="vOrd"><option value="data">Mais recentes</option><option value="valor" ${F.vOrd === 'valor' ? 'selected' : ''}>Maior valor</option></select>
      <button class="btn btn-ghost btn-sm" data-csv="1">⬇ Exportar CSV</button>
    </div>
    <div class="tiny muted mb-2"><b>${s.n}</b> vendas · VGV <b>${brl(s.vgv)}</b> · ticket ${brl(s.ticket)} · comissão imob ≈ ${brl(s.comissao)}</div>
    <div class="hn-wrap"><table class="hn-tbl"><thead><tr><th>Data</th><th>Cliente</th><th>Produto</th><th>Corretor</th><th>Origem</th><th>Tipo</th><th class="n">Valor</th><th class="n">% com.</th><th>NF</th></tr></thead>
    <tbody>${r.map(v => `<tr><td>${v.data ? dataBR(v.data) : '<span class="muted">sem data</span>'}</td><td>${esc(v.cliente)}</td><td>${esc(v.produto)}</td><td>${esc(v.corretor)}</td>
      <td>${esc(ORIGEM[v.origem_cat] || v.origem_cat)}${v.origem && ORIGEM[v.origem_cat] !== v.origem ? ` <span class="tiny muted">(${esc(v.origem)})</span>` : ''}</td><td>${esc(v.tipo || '—')}</td>
      <td class="n">${brl(v.valor, true)}</td><td class="n">${v.pct_comissao ? (v.pct_comissao * 100).toFixed(2).replace('.', ',') + '%' : '—'}</td><td>${v.nf ? '✓' : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function exportarCSV() {
  const r = vendasFiltradas();
  const cols = ['data', 'ano', 'cliente', 'produto', 'empreendimento', 'corretor', 'origem', 'origem_cat', 'tipo', 'valor', 'pct_comissao', 'comissao', 'pct_corretor', 'nf'];
  const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(';'), ...r.map(v => cols.map(c => q(v[c])).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `historico-vendas-notion${F.vAno ? '-' + F.vAno : ''}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ─── 5. metas ───────────────────────────────────────────────────────── */
function metasHTML() {
  const ms = _d.metas || [];
  if (!ms.length) return '<div class="muted tiny">Nenhuma meta registrada no Notion.</div>';
  const meses = [...new Set(ms.map(m => m.mes))].sort();
  const corr = [...new Set(ms.map(m => m.corretor))].sort();
  const idx = Object.fromEntries(ms.map(m => [`${m.mes}|${m.corretor}`, m]));
  const batidas = ms.filter(m => m.realizado >= m.meta && m.meta).length;
  const c = m => {
    if (!m) return '<td class="n"><span class="muted">—</span></td>';
    const p = m.meta ? m.realizado / m.meta : 0;
    const cls = p >= 1 ? 'ok' : p >= 0.6 ? 'warn' : 'err';
    return `<td class="n">${brl(m.realizado)}<br><span class="hn-flag ${cls}">${pct(p)}</span></td>`;
  };
  return `
    <div class="tiny muted mb-2">Meta por corretor registrada no Notion em 2025: R$ 600 mil/mês de fevereiro a maio e R$ 1,97 mi em junho. Depois de junho/2025 não houve mais meta registrada lá. <b>${batidas}</b> de ${ms.length} metas batidas.</div>
    <div class="hn-wrap"><table class="hn-tbl"><thead><tr><th>Corretor</th>${meses.map(m => `<th class="n">${mesAno(m)}<br><span class="tiny">meta ${brl(ms.find(x => x.mes === m).meta)}</span></th>`).join('')}</tr></thead>
    <tbody>${corr.map(k => `<tr><td>${esc(k)}</td>${meses.map(m => c(idx[`${m}|${k}`])).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ─── 6. arquivo ─────────────────────────────────────────────────────── */
async function renderArquivo() {
  const el = document.getElementById('hn-arq');
  if (!_arq) {
    el.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando o índice das páginas…</div>';
    try { _arq = (await api.request('/api/v3/diretoria/historico?secao=arquivo')).paginas || []; }
    catch (e) { el.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; return; }
  }
  el.innerHTML = `
    <div class="hn-ctl"><input class="input" id="hn-q" style="max-width:320px" placeholder="Buscar página por título ou pasta…" value="${esc(F.q)}">
      <span class="tiny muted">${_arq.length} páginas · ${(_d.bancos || []).length} bancos</span>
      <button class="btn btn-ghost btn-sm" id="hn-reimp">⬆ Reimportar extração</button></div>
    <div class="hn-arq"><div class="card"><div class="hn-tree" id="hn-tree"></div></div><div class="card"><div class="hn-doc" id="hn-doc"><div class="muted tiny">Escolha uma página ou um banco à esquerda.</div></div></div></div>`;
  const q = document.getElementById('hn-q');
  q.oninput = () => { F.q = q.value; arvore(); };
  document.getElementById('hn-reimp').onclick = () => { document.getElementById('hn-doc').innerHTML = importHTML(false); bindImport(); };
  arvore();
}

function arvore() {
  const tree = document.getElementById('hn-tree');
  const q = F.q.trim().toLowerCase();
  const bancos = _d.bancos || [];
  if (q) {
    const hits = _arq.filter(p => `${p.titulo} ${p.caminho}`.toLowerCase().includes(q)).slice(0, 300);
    const bh = bancos.filter(b => `${b.titulo} ${b.caminho}`.toLowerCase().includes(q));
    tree.innerHTML = bh.map(b => nodeBanco(b, 0)).join('') + hits.map(p => `<div class="hn-node" data-pg="${p.id}">📄 <span>${esc(p.titulo)}<br><span class="tiny muted">${esc(p.caminho)}</span></span></div>`).join('')
      + (hits.length === 300 ? '<div class="tiny muted">Mostrando 300 — refine a busca.</div>' : '') || '<div class="tiny muted">Nada encontrado.</div>';
  } else {
    // árvore pelos caminhos: cada prefixo é uma página (clicável) ou só uma pasta; bancos
    // aparecem dentro da página que os contém. Registros de banco ficam recolhidos na pasta 🗃.
    const pag = Object.fromEntries(_arq.map(p => [p.caminho, p]));
    const kids = {};
    for (const p of _arq) {
      const seg = p.caminho.split('/');
      for (let i = 1; i <= seg.length; i++) {
        const pai = seg.slice(0, i - 1).join('/'), eu = seg.slice(0, i).join('/');
        (kids[pai] = kids[pai] || new Set()).add(eu);
      }
    }
    const bancoEm = {};
    bancos.forEach(b => { (bancoEm[b.caminho] = bancoEm[b.caminho] || []).push(b); });
    const no = (cam, dep) => {
      const p = pag[cam], filhos = [...(kids[cam] || [])], bs = bancoEm[cam] || [];
      const tem = filhos.length || bs.length, aberto = _abertos.has(cam);
      const nome = cam.split('/').pop();
      const seta = tem ? `<span data-tg="${esc(cam)}">${aberto ? '▾' : '▸'}</span>` : '<span style="display:inline-block;width:9px"></span>';
      let h = p
        ? `<div class="hn-node" style="padding-left:${dep * 14 + 4}px" data-pg="${p.id}">${seta}📄 ${esc(p.titulo)}</div>`
        : `<div class="hn-node" style="padding-left:${dep * 14 + 4}px" data-tg="${esc(cam)}">${seta.replace('data-tg', 'data-x')}📁 <b>${esc(nome)}</b>${nome.startsWith('🗃') ? ` <span class="tiny muted">(${filhos.length})</span>` : ''}</div>`;
      if (tem && aberto) {
        h += bs.map(b => nodeBanco(b, dep + 1)).join('');
        filhos.sort((x, y) => (pag[x] ? 1 : 0) - (pag[y] ? 1 : 0) || x.localeCompare(y, 'pt-BR'));
        h += filhos.map(f => no(f, dep + 1)).join('');
      }
      return h;
    };
    const tops = [...(kids[''] || [])].sort();
    if (!_abertos.size) tops.forEach(t => _abertos.add(t));
    tree.innerHTML = tops.map(t => no(t, 0)).join('');
  }
  tree.querySelectorAll('[data-tg]').forEach(s => s.onclick = ev => { ev.stopPropagation(); const k = s.dataset.tg; _abertos.has(k) ? _abertos.delete(k) : _abertos.add(k); arvore(); });
  tree.querySelectorAll('[data-pg]').forEach(n => n.onclick = () => abrirPagina(n.dataset.pg, n));
  tree.querySelectorAll('[data-bc]').forEach(n => n.onclick = () => abrirBanco(n.dataset.bc, n));
}
const nodeBanco = (b, dep) => `<div class="hn-node" style="padding-left:${dep * 14 + 4}px" data-bc="${b.id}">🗃 ${esc(b.titulo)}</div>`;

async function abrirPagina(id, node) {
  const doc = document.getElementById('hn-doc');
  document.querySelectorAll('.hn-node.sel').forEach(n => n.classList.remove('sel')); node?.classList.add('sel');
  doc.innerHTML = '<div class="muted tiny"><span class="spinner"></span></div>';
  try {
    const p = (await api.request(`/api/v3/diretoria/historico?pagina=${encodeURIComponent(id)}`)).pagina;
    doc.innerHTML = `<div class="tiny muted mb-2">${esc(p.caminho)}</div>${mdHTML(p.conteudo)}`;
  } catch (e) { doc.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}
async function abrirBanco(id, node) {
  const doc = document.getElementById('hn-doc');
  document.querySelectorAll('.hn-node.sel').forEach(n => n.classList.remove('sel')); node?.classList.add('sel');
  doc.innerHTML = '<div class="muted tiny"><span class="spinner"></span></div>';
  try {
    const b = (await api.request(`/api/v3/diretoria/historico?banco=${encodeURIComponent(id)}`)).banco;
    const cols = b.dados?.colunas || [], linhas = b.dados?.linhas || [];
    const vis = cols.map((c, i) => i).filter(i => cols[i] !== 'notion_id' && linhas.some(l => l[i]));
    doc.innerHTML = `<h1>🗃 ${esc(b.titulo)}</h1><div class="tiny muted mb-2">${esc(b.caminho)} · ${linhas.length} registros${linhas.length > 500 ? ' (mostrando 500)' : ''}</div>
      <table class="hn-tbl"><thead><tr>${vis.map(i => `<th>${esc(cols[i])}</th>`).join('')}</tr></thead>
      <tbody>${linhas.slice(0, 500).map(l => `<tr>${vis.map(i => `<td>${esc(String(l[i] ?? '').replace(/\(attachment:[^)]*\)/g, '').slice(0, 300))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  } catch (e) { doc.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

/* markdown do conversor (títulos, listas, checkboxes, tabelas, citações, links) */
function mdHTML(src) {
  const inline = s => esc(s)
    .replace(/\[\[([^\]]+)\]\]/g, '<b>$1</b>')
    .replace(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let lista = false, tabela = null, code = null;
  const fecha = () => { if (lista) { out.push('</ul>'); lista = false; } if (tabela) { out.push(`<table>${tabela.join('')}</table>`); tabela = null; } };
  for (const ln of String(src || '').split('\n')) {
    if (code !== null) { if (ln.startsWith('```')) { out.push(`<pre>${esc(code)}</pre>`); code = null; } else code += ln + '\n'; continue; }
    if (ln.startsWith('```')) { fecha(); code = ''; continue; }
    const t = ln.trim();
    if (t.startsWith('|')) {
      if (lista) { out.push('</ul>'); lista = false; }
      if (/^\|(\s*-+\s*\|)+$/.test(t)) continue;
      tabela = tabela || [];
      tabela.push(`<tr>${t.slice(1, -1).split(/(?<!\\)\|/).map(c => `<td>${inline(c.trim().replace(/\\\|/g, '|'))}</td>`).join('')}</tr>`);
      continue;
    }
    const li = ln.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)/);
    if (li) {
      if (tabela) { out.push(`<table>${tabela.join('')}</table>`); tabela = null; }
      if (!lista) { out.push('<ul>'); lista = true; }
      const txt = li[2].replace(/^\[x\]\s*/, '☑ ').replace(/^\[ \]\s*/, '☐ ');
      out.push(`<li style="margin-left:${li[1].length / 2 * 14}px">${inline(txt)}</li>`);
      continue;
    }
    fecha();
    if (!t) continue;
    if (t === '---') { out.push('<hr>'); continue; }
    const h = t.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (t.startsWith('>')) { out.push(`<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    out.push(`<p style="margin:4px 0">${inline(t)}</p>`);
  }
  fecha();
  if (code !== null) out.push(`<pre>${esc(code)}</pre>`);
  return out.join('');
}

/* ─── importação (upload do arquivo gerado localmente) ───────────────── */
function importHTML(vazio) {
  return `<div class="card">
    <div class="card-title">${vazio ? '📜 Histórico Notion — ainda sem dados' : '⬆ Reimportar extração do Notion'}</div>
    <div class="card-sub">Selecione o arquivo <code>hist-notion-import.json</code> (gerado em <code>historico-notion/_import/</code> no computador do Paulo). Os dados vão direto para uma tabela fechada do banco — só sócios leem. ${vazio ? '' : 'A importação anterior é substituída.'}</div>
    <div class="flex gap-2 items-center mt-3"><input type="file" accept=".json,application/json" id="hn-file"><button class="btn btn-primary" id="hn-go" disabled>Importar</button></div>
    <div id="hn-imp" class="mt-3"></div></div>`;
}
function bindImport() {
  const f = document.getElementById('hn-file'), go = document.getElementById('hn-go'), st = document.getElementById('hn-imp');
  f.onchange = () => { go.disabled = !f.files.length; };
  go.onclick = async () => {
    go.disabled = true; f.disabled = true;
    try {
      const j = JSON.parse(await f.files[0].text());
      if (j.formato !== 'psm-hist-notion/1' || !Array.isArray(j.records)) throw new Error('Arquivo não reconhecido — use o hist-notion-import.json gerado pelo convert.py.');
      // lotes de até ~1,5 MB e 300 registros (limite de corpo da Vercel é 4,5 MB)
      const lotes = []; let cur = [], tam = 0;
      for (const r of j.records) {
        const t = JSON.stringify(r).length;
        if (cur.length && (tam + t > 1.5e6 || cur.length >= 300)) { lotes.push(cur); cur = []; tam = 0; }
        cur.push(r); tam += t;
      }
      if (cur.length) lotes.push(cur);
      // v88.46: o 1º lote devolve a hora de início (do servidor); só o último lote remove o que
      // não veio no arquivo — se algo falhar no meio, o histórico anterior continua inteiro.
      let inicio = null;
      for (let i = 0; i < lotes.length; i++) {
        st.innerHTML = `<div class="tiny muted mb-1">Enviando lote ${i + 1} de ${lotes.length}…</div><div class="hn-prog"><i style="width:${i / lotes.length * 100}%"></i></div>`;
        const r = await api.request('/api/v3/diretoria/historico', { method: 'POST', body: { action: 'import', records: lotes[i], primeiro: i === 0, inicio, fim: i === lotes.length - 1 } });
        if (i === 0) inicio = r.inicio;
      }
      st.innerHTML = `<div class="alert alert-ok">Importado: ${j.records.length} registros.</div>`;
      _arq = null; F.anos = null;
      setTimeout(load, 600);
    } catch (e) {
      st.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
      go.disabled = false; f.disabled = false;
    }
  };
}

/* ─── controles ──────────────────────────────────────────────────────── */
function bindControls(body) {
  body.querySelectorAll('[data-f]').forEach(el => {
    const ev = el.tagName === 'INPUT' ? 'input' : 'change';
    el.addEventListener(ev, () => {
      const k = el.dataset.f;
      F[k] = k === 'ate' ? Number(el.value) : el.value;
      if (k === 'vBusca') { const pos = el.selectionStart; render(); const n = document.querySelector('[data-f="vBusca"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
      render();
    });
  });
  body.querySelectorAll('[data-ano]').forEach(el => el.onchange = () => {
    const a = Number(el.dataset.ano);
    F.anos = el.checked ? [...new Set([...F.anos, a])].sort() : F.anos.filter(x => x !== a);
    render();
  });
  body.querySelectorAll('[data-mesmo]').forEach(el => el.onclick = () => { F.ate = Number(el.dataset.mesmo); render(); });
  body.querySelectorAll('[data-csv]').forEach(el => el.onclick = exportarCSV);
}

/* ─── formatação ─────────────────────────────────────────────────────── */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function brl(v) {   // v88.37: sempre cheio com centavos (nunca mil/mi)
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(x) { return `${Math.round((x || 0) * 100)}%`; }
function delta(a, b) {
  if (!b) return a ? '<span class="tiny muted">novo</span>' : '<span class="muted">—</span>';
  const d = (a - b) / b;
  return `<span class="${d >= 0 ? 'hn-up' : 'hn-dn'}">${d >= 0 ? '+' : ''}${Math.round(d * 100)}%</span>`;
}
function dataBR(s) { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function mesAno(ym) { if (!ym) return '—'; return `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`; }
