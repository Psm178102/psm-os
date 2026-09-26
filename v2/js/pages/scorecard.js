/* PSM-OS v2 — 📊 Scorecards (v88.26)
   Um só formato de placar para a Presidência, cada Unidade de Negócio e cada Área:
   indicador · realizado · meta · % · farol · dono. Mesma régua pra todos (ver "Como ler").
   Números vêm dos motores oficiais (backend /api/v3/diretoria/scorecard) — aqui só se
   define meta própria, lança indicador manual e troca o dono (sócio). */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { parseNum } from '../sim-campos.js';   // v88.46: aceita "450.000", "450.000,00", "450000"

let _root = null;
let _d = null;
let _ym = ymDe(new Date());
let _users = null;
let _h = null;        // histórico mês a mês (v88.30)

const FAROL = {
  verde:    { cor: '#16a34a', ico: '🟢', lbl: 'No alvo' },
  amarelo:  { cor: '#d97706', ico: '🟡', lbl: 'Atenção' },
  vermelho: { cor: '#dc2626', ico: '🔴', lbl: 'Fora' },
  cinza:    { cor: '#94a3b8', ico: '⚪', lbl: 'Sem dado' },
  info:     { cor: '#0891b2', ico: '📈', lbl: 'Acompanhamento' },
};
const GRUPOS = [
  { id: 'presidencia', nome: 'Presidência', sub: 'a empresa inteira' },
  { id: 'un', nome: 'Unidades de Negócio', sub: 'cada frente como uma empresa' },
  { id: 'area', nome: 'Áreas', sub: 'cada diretoria funcional' },
];
const socio = () => (auth.user()?.lvl || 0) >= 10;

export async function pageScorecard(ctx, root) {
  _root = root;
  if (ctx?.query?.ym && /^\d{4}-\d{2}$/.test(ctx.query.ym)) _ym = ctx.query.ym;
  renderShell();
  await load(false);
}

async function load(fresh) {
  const body = document.getElementById('sc-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Montando os placares (motor comercial + financeiro + mídia)…</div>';
  try {
    // placar primeiro, histórico depois: o cálculo do mês é o que REGISTRA o mês no histórico —
    // pedidos juntos, a 1ª abertura do mês mostrava o mapa de calor sem o mês corrente. v88.32
    const d = await api.request(`/api/v3/diretoria/scorecard?ym=${_ym}${fresh ? '&fresh=1' : ''}`);
    const h = await api.request('/api/v3/diretoria/scorecard?hist=12').catch(() => null);
    _d = d; _h = h;
    render();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderShell() {
  const meses = [];
  const d = new Date(); d.setDate(1);
  for (let i = 0; i < 12; i++) { meses.push(ymDe(d)); d.setMonth(d.getMonth() - 1); }
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🚦 Farol PSM</h2>
          <p class="card-sub">Um placar padrão por nível: <b>Presidência → Unidades de Negócio → Áreas</b>. Cada indicador tem meta, farol e dono.</p>
        </div>
        <div class="flex gap-1" style="align-items:center;flex-wrap:wrap">
          <select id="sc-ym" class="select" style="width:auto">${meses.map(m => `<option value="${m}" ${m === _ym ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
          <button class="btn btn-ghost" id="sc-fresh" title="Recalcular agora, ignorando o cache">↻ Recalcular</button>
        </div>
      </div>
      <details class="mt-2" style="background:var(--bg-3);border-radius:8px;padding:8px 12px">
        <summary style="cursor:pointer;font-weight:700;font-size:13px">📐 Como ler o farol (régua única)</summary>
        <div class="tiny" style="margin-top:6px;line-height:1.7">
          <b>Maior é melhor, acumula no mês</b> (VGV, vendas, visitas…): compara com o <b>ritmo</b>, ou seja, com quanto do mês já passou.
          🟢 ≥ 90% do esperado · 🟡 ≥ 70% · 🔴 abaixo. No dia 15 de um mês de 30, esperado = 50% da meta.<br>
          <b>Maior é melhor, foto</b> (taxas, carteira, NPS): 🟢 ≥ 90% da meta · 🟡 ≥ 70% · 🔴 abaixo.<br>
          <b>Menor é melhor</b> (CPL, CAC, atrasos): 🟢 ≤ meta · 🟡 até 15% acima · 🔴 mais que isso.<br>
          📈 = acompanhamento (ainda sem meta — o sócio define no ✏️) · ⚪ = sem dado ou indicador manual ainda não lançado.
          <b>Saúde do placar</b> = verdes valem 100, amarelos 50, vermelhos 0 (média dos avaliados) — só aparece com pelo menos 2 indicadores e 40% do placar com meta.<br>
          Meta: <i>aba Metas</i> (comercial, a mesma do 1:1 e do Ranking) · <i>orçado</i> (tela Orçado × Realizado) · <i>padrão</i> (definida no sistema) · <i>própria</i> (definida aqui pelo sócio).
        </div>
      </details>
      <div id="sc-body" class="mt-3"></div>
    </div>`;
  document.getElementById('sc-ym').addEventListener('change', e => { _ym = e.target.value; load(false); });
  document.getElementById('sc-fresh').addEventListener('click', () => load(true));
}

function render() {
  const d = _d;
  const body = document.getElementById('sc-body');
  const fech = d.ritmo >= 100;
  body.innerHTML = `
    <div class="tiny muted mb-2">
      ${fech ? '📁 Mês fechado — farol contra a meta cheia.' : `⏱ Mês em andamento: <b>${d.ritmo}%</b> do mês decorrido (é o esperado dos indicadores que acumulam).`}
      ${d.dados_de ? ` · CRM de ${esc(d.dados_de)}` : ''}${d.cached ? ` · cache de ${Math.round((d.cache_age_s || 0) / 60)} min` : ''}
    </div>
    ${(d.avisos || []).length ? `<div class="alert alert-warn mb-3">${d.avisos.map(esc).join('<br>')}</div>` : ''}
    ${d.escopo === 'dono' ? '<div class="tiny muted mb-2">👤 Você está vendo os placares de que é dono.</div>' : ''}
    ${placarGeral(d.scorecards)}
    ${evolucaoHTML()}
    ${GRUPOS.map(g => {
      const scs = d.scorecards.filter(s => s.grupo === g.id);
      if (!scs.length) return '';
      return `<div class="mt-3"><div style="font-weight:800;font-size:15px">${g.nome} <span class="tiny muted" style="font-weight:400">· ${g.sub}</span></div>
        ${scs.map(scCard).join('')}</div>`;
    }).join('')}`;
  bind(body);
}

function placarGeral(scs) {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px">
    ${scs.map(s => {
      const f = FAROL[s.farol] || FAROL.cinza;
      return `<a href="javascript:void 0" data-goto="${s.id}" style="text-decoration:none;color:inherit;background:var(--bg-3);border-radius:8px;padding:10px;border-left:4px solid ${f.cor};display:block">
        <div class="flex" style="justify-content:space-between;align-items:center;gap:6px">
          <span style="font-weight:800;font-size:13px">${s.ico} ${esc(s.nome)}</span>
          <b style="color:${f.cor};font-size:16px">${s.saude == null ? '—' : s.saude}</b>
        </div>
        <div class="tiny muted" style="margin-top:2px">👤 ${esc(s.dono_nome || '—')} · ${s.avaliados}/${s.total} com farol</div>
        <div class="tiny" style="margin-top:4px">🟢 ${s.farois.verde} · 🟡 ${s.farois.amarelo} · 🔴 ${s.farois.vermelho}${s.farois.cinza ? ' · ⚪ ' + s.farois.cinza : ''}${s.farois.info ? ' · 📈 ' + s.farois.info : ''}</div>
      </a>`;
    }).join('')}
  </div>`;
}

function scCard(s) {
  const f = FAROL[s.farol] || FAROL.cinza;
  return `<div id="sc-${s.id}" class="card mt-2" style="border-left:5px solid ${f.cor};padding:12px">
    <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div style="font-weight:800;font-size:15px">${s.ico} ${esc(s.nome)}</div>
        <div class="tiny muted">${esc(s.nota_sc || '')}</div>
      </div>
      <div class="flex gap-2" style="align-items:center">
        ${socio() ? `<select class="select" data-dono="${s.id}" style="width:auto;font-size:12px" title="Dono do placar"><option value="${esc(s.dono)}">👤 ${esc(s.dono_nome || s.dono)}</option></select>`
                  : `<span class="tiny">👤 <b>${esc(s.dono_nome || '—')}</b></span>`}
        <span title="${s.avaliados} de ${s.total} indicadores com farol" style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${f.cor}22;color:${f.cor}">saúde ${s.saude == null ? '— (defina metas)' : s.saude}</span>
      </div>
    </div>
    <div style="overflow-x:auto;margin-top:8px">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:680px">
        <thead><tr class="tiny muted" style="text-align:left">
          <th style="padding:4px 6px;width:22px"></th><th style="padding:4px 6px">Indicador</th>
          <th style="padding:4px 6px;text-align:right">Realizado</th><th style="padding:4px 6px;text-align:right">Meta</th>
          <th style="padding:4px 6px;width:150px">Atingimento</th><th style="padding:4px 6px;width:110px">12 meses</th></tr></thead>
        <tbody>${s.indicadores.map(linha).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

function linha(i) {
  const f = FAROL[i.farol] || FAROL.cinza;
  const valor = i.manual && socio()
    ? `<input class="input" type="number" step="any" data-manual="${i.id}" value="${i.valor ?? ''}" placeholder="lançar" style="width:110px;text-align:right;padding:3px 6px;font-size:12px">`
    : (i.valor == null ? '<span class="muted">—</span>' : fmt(i.valor, i.un));
  const meta = `${i.meta == null ? '<span class="muted">—</span>' : (i.dir === 'menor' ? '≤ ' : '') + fmt(i.meta, i.un)}
    ${i.meta_origem ? `<div class="tiny muted">${esc(i.meta_origem)}</div>` : ''}
    ${socio() ? `<a href="javascript:void 0" class="tiny" data-meta="${i.id}" title="Definir meta própria">✏️</a>` : ''}`;
  let ating = '';
  if (i.pct != null) {
    const w = Math.max(0, Math.min(100, i.dir === 'menor' ? (i.valor <= i.meta ? 100 : Math.round(i.meta / i.valor * 100)) : i.pct));
    const marca = i.esperado != null && i.esperado > 0 && i.esperado < 100 && i.dir !== 'menor'
      ? `<div title="esperado hoje: ${i.esperado}%" style="position:absolute;top:-3px;left:${i.esperado}%;width:2px;height:13px;background:var(--ink,#0b1f3a);opacity:.5"></div>` : '';
    ating = `<div class="flex gap-1" style="align-items:center"><div style="position:relative;flex:1;height:7px;background:var(--bg-2);border-radius:4px">
      <div style="height:100%;width:${w}%;background:${f.cor};border-radius:4px"></div>${marca}</div>
      <b class="tiny" style="color:${f.cor};width:40px;text-align:right">${i.pct}%</b></div>`;
  } else {
    ating = `<span class="tiny" style="color:${f.cor}">${i.motivo ? esc(i.motivo) : f.ico + ' ' + f.lbl}</span>`;
  }
  return `<tr style="border-top:1px solid var(--border)">
    <td style="padding:6px" title="${f.lbl}">${f.ico}</td>
    <td style="padding:6px"><div style="font-weight:600">${esc(i.label)}${i.manual ? ' <span class="tiny muted">✍️ manual</span>' : ''}</div>
      ${i.nota ? `<div class="tiny muted">${esc(i.nota)}</div>` : ''}${i.amostra ? `<div class="tiny" style="color:#b45309">${esc(i.amostra)}</div>` : ''}</td>
    <td style="padding:6px;text-align:right;white-space:nowrap">${valor}</td>
    <td style="padding:6px;text-align:right;white-space:nowrap">${meta}</td>
    <td style="padding:6px">${ating}</td>
    <td style="padding:6px">${spark(i)}</td>
  </tr>`;
}

/* ─── histórico (v88.30) ─────────────────────────────────────────────── */
const corSaude = v => v == null ? FAROL.cinza.cor : v >= 80 ? FAROL.verde.cor : v >= 55 ? FAROL.amarelo.cor : FAROL.vermelho.cor;
const TIPO = { final: ['✓', 'fechado no dia 1º'], parcial: ['◐', 'mês em andamento'], reconstruido: ['↺', 'reconstruído depois (fotos do mês ficam em branco)'] };

function evolucaoHTML() {
  const h = _h;
  if (!h || !h.meses) return '';
  const visiveis = new Set((_d.scorecards || []).map(s => s.id));
  const scs = (h.scorecards || []).filter(s => visiveis.has(s.id));
  const falt = (h.faltando || []).length;
  return `<div class="card mt-3" style="padding:12px">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div><div style="font-weight:800">📈 Evolução — saúde de cada placar mês a mês</div>
        <div class="tiny muted">✓ fechado no dia 1º · ◐ mês em andamento · ↺ reconstruído depois (indicadores de foto — carteira, pipeline, corretores — só existem a partir do registro)</div></div>
      ${falt && socio() ? `<button class="btn btn-ghost" id="sc-completar">↺ Completar histórico (${falt} ${falt === 1 ? 'mês' : 'meses'})</button>` : ''}
    </div>
    <div id="sc-completar-status" class="tiny muted"></div>
    <div style="overflow-x:auto;margin-top:8px">
      <table style="border-collapse:collapse;font-size:12px;min-width:640px;width:100%">
        <thead><tr class="tiny muted"><th style="text-align:left;padding:4px 6px">Placar</th>
          ${h.meses.map(ym => { const t = TIPO[(h.registros[ym] || {}).tipo]; return `<th style="padding:4px;text-align:center" title="${t ? t[1] : 'sem registro'}">${nomeMes(ym).replace('/20', '/')}${t ? ' ' + t[0] : ''}</th>`; }).join('')}
        </tr></thead>
        <tbody>${scs.map(s => `<tr style="border-top:1px solid var(--border)">
          <td style="padding:4px 6px;white-space:nowrap;font-weight:600">${s.ico} ${esc(s.nome)}</td>
          ${(h.saude[s.id] || []).map(v => `<td style="padding:3px;text-align:center"><div style="border-radius:6px;padding:4px 0;font-weight:800;background:${v == null ? 'var(--bg-3)' : corSaude(v) + '26'};color:${corSaude(v)}">${v == null ? '·' : v}</div></td>`).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

// v88.50: indicadores cuja REGRA mudou na v88.47 (CAC e conversão por venda de tráfego pago) — a
// variação contra meses gravados antes de 2026-09 compara réguas diferentes (ex.: CAC "▲82%" falso)
const REGRA_NOVA_DESDE = { 'p.cac': '2026-09', 'mk.cac': '2026-09', 'c.conv': '2026-09' };

function spark(i) {
  const ser = (_h && _h.series && _h.series[i.id]) || [];
  const pts = ser.map((x, k) => ({ k, v: x && x[0] != null ? Number(x[0]) : null, f: x && x[2] })).filter(p => p.v != null && isFinite(p.v));
  if (pts.length < 2) return '<span class="tiny muted">' + (pts.length ? '1 mês' : '—') + '</span>';
  const W = 84, H = 22, n = ser.length - 1 || 1;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), rg = hi - lo || 1;
  const xy = p => [(p.k / n * (W - 4) + 2).toFixed(1), (H - 3 - (p.v - lo) / rg * (H - 6)).toFixed(1)];
  const ult = pts[pts.length - 1], pen = pts[pts.length - 2];
  const cor = (FAROL[ult.f] || FAROL.info).cor;
  const bom = i.dir === 'menor' ? ult.v < pen.v : ult.v > pen.v;
  const desde = REGRA_NOVA_DESDE[i.id];
  const penYm = desde && _h && _h.meses ? _h.meses[pen.k] : null;
  const regraMudou = !!(desde && penYm && penYm < desde);
  const dlt = regraMudou ? null : (pen.v ? Math.round((ult.v - pen.v) / Math.abs(pen.v) * 100) : null);
  const [lx, ly] = xy(ult);
  return `<div class="flex gap-1" style="align-items:center" title="${pts.length} meses registrados${regraMudou ? ' · regra do cálculo mudou em set/2026 (só venda de tráfego pago) — sem comparação com os meses anteriores' : ''}">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline fill="none" stroke="${cor}" stroke-width="1.6" stroke-linejoin="round" points="${pts.map(p => xy(p).join(',')).join(' ')}"/><circle cx="${lx}" cy="${ly}" r="2.4" fill="${cor}"/></svg>
    ${dlt != null && ult.v !== pen.v ? `<span class="tiny" style="color:${bom ? FAROL.verde.cor : FAROL.vermelho.cor};font-weight:700">${ult.v > pen.v ? '▲' : '▼'}${Math.abs(dlt)}%</span>` : ''}
  </div>`;
}

async function completarHistorico() {
  const falt = (_h && _h.faltando) || [];
  const st = document.getElementById('sc-completar-status');
  const btn = document.getElementById('sc-completar');
  if (btn) btn.disabled = true;
  for (let k = 0; k < falt.length; k++) {
    if (st) st.textContent = `↺ Reconstruindo ${nomeMes(falt[k])} (${k + 1}/${falt.length}) — cada mês leva alguns segundos…`;
    try { await api.request(`/api/v3/diretoria/scorecard?ym=${falt[k]}`); }
    catch (e) { if (st) st.textContent = `Falhou em ${nomeMes(falt[k])}: ${e.message}`; if (btn) btn.disabled = false; return; }
  }
  await load(false);
}

async function bind(body) {
  document.getElementById('sc-completar')?.addEventListener('click', completarHistorico);
  body.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', () =>
    document.getElementById('sc-' + a.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  body.querySelectorAll('[data-meta]').forEach(a => a.addEventListener('click', async () => {
    const ind = findInd(a.dataset.meta);
    const atual = ind?.meta_origem === 'própria' ? ind.meta : '';
    const v = prompt(`Meta própria para "${ind?.label}"${ind?.un === '%' ? ' (em %)' : ind?.un === 'R$' ? ' (em R$)' : ''}.\nDeixe vazio para voltar à meta ${ind?.meta_origem && ind.meta_origem !== 'própria' ? 'da ' + ind.meta_origem : 'padrão'}.`, atual ?? '');
    if (v === null) return;
    // v88.46: "1.500.000" virava NaN → null → apagava a meta sem aviso
    if (v.trim() !== '' && !/\d/.test(v)) { alert('Valor inválido — nada foi salvo.'); return; }
    await post({ action: 'set_meta', ind: a.dataset.meta, meta: v.trim() === '' ? null : parseNum(v) });
  }));
  body.querySelectorAll('[data-manual]').forEach(inp => inp.addEventListener('change', async () => {
    const v = inp.value.trim();
    if (v !== '' && !/\d/.test(v)) { alert('Valor inválido — nada foi salvo.'); return; }
    await post({ action: 'set_manual', ym: _ym, ind: inp.dataset.manual, valor: v === '' ? null : parseNum(v) });
  }));
  const donos = body.querySelectorAll('[data-dono]');
  if (donos.length) {
    if (!_users) {
      try { const r = await api.request('/api/v3/users/list'); _users = (r.users || []).filter(u => u.id && u.name).sort((a, b) => a.name.localeCompare(b.name)); }
      catch (_) { _users = []; }
    }
    donos.forEach(sel => {
      const atual = sel.value;
      sel.innerHTML = _users.map(u => `<option value="${esc(u.id)}" ${u.id === atual ? 'selected' : ''}>👤 ${esc(u.name)}</option>`).join('')
        + (_users.some(u => u.id === atual) ? '' : `<option value="${esc(atual)}" selected>👤 ${esc(atual)}</option>`);
      sel.addEventListener('change', () => post({ action: 'set_dono', sc: sel.dataset.dono, dono: sel.value }));
    });
  }
}

async function post(body) {
  try { await api.request('/api/v3/diretoria/scorecard', { method: 'POST', body }); await load(false); }
  catch (e) { alert('Erro: ' + e.message); }
}

function findInd(id) { for (const s of _d.scorecards) for (const i of s.indicadores) if (i.id === id) return i; return null; }

function fmt(v, un) {
  const n = Number(v) || 0;
  if (un === 'R$') {
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    return `${s}R$ ${a.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;   // v88.37: sem mil/mi
  }
  if (un === '%') return n.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 }) + '%';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
function ymDe(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function nomeMes(ym) { const [a, m] = ym.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m - 1] + '/' + a; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
