/* ============================================================================
   PSM-OS v2 — Financeiro (PSM HUB)
   v88.37: NIBO cancelado (13/ago) → saíram as abas que dependiam dele (Resumo, DRE 12m,
   Métricas, Custos Fixos, Comissões, Repasses) e o filtro por CNPJ. Ficam o 💵 Caixa
   (CRM + Radar + PSM HUB) e o 🌉 PSM HUB (financeiro oficial, via ponte).
============================================================================ */
import { api } from '../api.js';
import { mountCaixa } from './caixa-panel.js';
import { auth } from '../auth.js';

let _root = null;
let _tab = 'psmhub';            // psmhub | caixa

export async function pageFinanceiro(ctx, root) {
  _root = root;
  const me = auth.user();
  const ehFinanceiro = (me?.role || '').toLowerCase() === 'financeiro';
  if ((me?.lvl || 0) < 4 && !ehFinanceiro) {
    root.innerHTML = `<div class="alert alert-warn">🔒 Requer nível Financeiro (4) ou superior. Você é <code>${me?.role}</code> (L${me?.lvl}).</div>`;
    return;
  }
  if (['psmhub', 'caixa'].includes(ctx?.query?.tab)) _tab = ctx.query.tab;
  await loadAndRender();
}

async function loadAndRender() {
  drawShell();
  await drawBody();
}

function drawShell() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">💰 Financeiro · PSM HUB</h2>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost" id="btn-reload" style="margin-left:auto">🔄 Atualizar</button>
      </div>
      <div class="flex gap-1" style="margin-top:14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        ${tabBtn('psmhub', '🌉 PSM HUB')}
        ${tabBtn('caixa',  '💵 Caixa')}
      </div>
      <div id="fin-body" style="margin-top:14px">
        <div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div>
      </div>
    </div>
  `;
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', async () => {
    _tab = b.dataset.tab; await loadAndRender();
  }));
  document.getElementById('btn-reload').addEventListener('click', async () => {
    _hubFin = null; _hubMes = ''; _hubSecData = {};   // zera o cache do PSM HUB (módulo-level)
    await loadAndRender();
  });
}

async function drawBody() {
  const body = document.getElementById('fin-body');
  if (!body) return;
  try {
    if (_tab === 'caixa') { body.innerHTML = '<div id="fin-caixa"></div>'; await mountCaixa(document.getElementById('fin-caixa')); }
    else { body.innerHTML = await renderPsmHub(); wirePsmHub(); }
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function tabBtn(id, lbl) {
  return `<button class="btn" data-tab="${id}" style="border-radius:var(--r-sm) var(--r-sm) 0 0;background:${_tab === id ? 'var(--psm-navy)' : 'transparent'};color:${_tab === id ? '#fff' : 'var(--ink-muted)'};border-bottom:none">${lbl}</button>`;
}
function money(n) {
  if (n == null || isNaN(n)) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


/* ─── Tab: 🌉 PSM HUB (financeiro do Hub da Equipe Conquista, via ponte) — v84.97 ───
   v86.89: o Hub ganhou mais páginas de financeiro (Painel, Acompanhamento, Contas,
   Recorrências, Conciliação, DRE, Viabilidade) → viraram sub-abas aqui, cada uma
   espelhando os endpoints que a tela do Hub chama (ponte ?secao=). */
let _hubFin = null, _hubMes = '';   // '' = todos os meses
let _hubSec = 'comissoes';
let _hubSecData = {};               // cache local por seção
let _hubAno = String(new Date().getFullYear());

const HUB_SECOES = [
  ['comissoes',      '💰 Comissões'],
  ['painel',         '📊 Painel Geral'],
  ['acompanhamento', '🎯 Orçado × Realizado'],
  ['contas',         '📒 Contas a Pagar/Receber'],
  ['recorrencias',   '🔁 Recorrências'],
  ['conciliacao',    '🤝 Conciliação'],
  ['dre',            '📈 DRE'],
  ['viabilidade',    '🧮 Viabilidade'],
];

async function renderPsmHub() {
  const subBar = `<div class="flex gap-1 mb-3" style="flex-wrap:wrap">
    ${HUB_SECOES.map(([k, lbl]) => `<button class="btn btn-sm ${_hubSec === k ? '' : 'btn-ghost'}" data-hubsec="${k}" style="font-size:11px">${lbl}</button>`).join('')}
  </div>`;
  if (_hubSec !== 'comissoes') return subBar + await renderHubSecao(_hubSec);
  return subBar + await renderHubComissoes();
}

async function renderHubComissoes() {
  if (!_hubFin) {
    try { _hubFin = await api.request('/api/v3/psmhub/financeiro'); }
    catch (e) { return `<div class="alert alert-err">Ponte PSM HUB: ${escapeHtml(e.message)}</div>`; }
  }
  if (_hubFin && _hubFin.sem_permissao) return `<div class="alert alert-warn">🔑 ${escapeHtml(_hubFin.error)}</div>`;
  if (!_hubFin || !_hubFin.ok) return `<div class="alert alert-err">${escapeHtml((_hubFin && _hubFin.error) || 'ponte indisponível')}</div>`;
  const todos = (_hubFin.financeiro || []).map(v => ({
    ...v,
    _vgv: parseFloat(v.vgv) || 0, _bruto: parseFloat(v.valorBruto) || 0,
    _imp: parseFloat(v.imposto) || 0, _liq: parseFloat(v.valorLiquido) || 0,
    _cCor: parseFloat(v.comissaoCorretor) || 0, _cGes: parseFloat(v.comissaoGestor) || 0,
    _mes: String(v.dataVenda || v.createdAt || '').slice(0, 7),
  }));
  const meses = [...new Set(todos.map(v => v._mes).filter(Boolean))].sort().reverse();
  const vs = _hubMes ? todos.filter(v => v._mes === _hubMes) : todos;
  const sum = k => vs.reduce((a, v) => a + v[k], 0);
  const casa = sum('_liq') - sum('_cCor') - sum('_cGes');
  const money = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const kpi = (lbl, val, cor) => `<div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:10px;padding:10px 12px">
    <div class="tiny muted">${lbl}</div><div style="font-weight:800;font-size:16px;color:${cor || 'inherit'}">${val}</div></div>`;

  const porCorretor = {};
  vs.forEach(v => { const n = v.vendorName || '?'; porCorretor[n] = porCorretor[n] || { n: 0, vgv: 0, liq: 0, com: 0 };
    porCorretor[n].n++; porCorretor[n].vgv += v._vgv; porCorretor[n].liq += v._liq; porCorretor[n].com += v._cCor; });

  return `
    <div class="alert" style="background:var(--bg-3);border:none;font-size:12px">🌉 <b>Financeiro do PSM HUB</b> (Equipe Conquista) — venda a venda, direto da ponte, cache de 10min.
      Fonte externa: quem lança/edita é o Hub; aqui é leitura consolidada.</div>
    <div class="flex gap-2 mb-2" style="align-items:center;flex-wrap:wrap">
      <select id="hub-mes" class="select" style="width:auto;font-size:12px">
        <option value="">Todos os meses (${todos.length} vendas)</option>
        ${meses.map(m => `<option value="${m}"${_hubMes === m ? ' selected' : ''}>${m.split('-').reverse().join('/')}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="hub-reload">🔄 Atualizar agora</button>
      <span class="tiny muted">${_hubFin.cache && _hubFin.cache.hit ? `cache de ${Math.round(_hubFin.cache.age_s / 60)}min` : 'ao vivo'}</span>
    </div>
    <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
      ${kpi('Vendas', vs.length)}
      ${kpi('VGV', money(sum('_vgv')))}
      ${kpi('Receita bruta', money(sum('_bruto')))}
      ${kpi('Impostos', money(sum('_imp')), '#d97706')}
      ${kpi('Receita líquida', money(sum('_liq')))}
      ${kpi('Comissões corretor', money(sum('_cCor')), '#2563eb')}
      ${kpi('Comissões gestor', money(sum('_cGes')), '#2563eb')}
      ${kpi('Sobra da casa', money(casa), casa >= 0 ? '#16a34a' : '#dc2626')}
    </div>
    <div class="card" style="margin:0 0 12px"><b class="tiny">Por corretor</b>
      <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr class="muted" style="text-align:left"><th style="padding:4px">Corretor</th><th>Vendas</th><th>VGV</th><th>Receita líq.</th><th>Comissão dele</th></tr></thead>
        <tbody>${Object.entries(porCorretor).sort((a, b) => b[1].vgv - a[1].vgv).map(([n, x]) =>
          `<tr style="border-top:1px solid var(--border)"><td style="padding:4px;font-weight:700">${escapeHtml(n)}</td><td style="text-align:center">${x.n}</td><td>${money(x.vgv)}</td><td>${money(x.liq)}</td><td>${money(x.com)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card" style="margin:0"><b class="tiny">Venda a venda</b>
      <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:900px">
        <thead><tr class="muted" style="text-align:left"><th style="padding:4px">Data</th><th>Corretor</th><th>Cliente</th><th>Produto</th><th>Tipo</th><th>VGV</th><th>Bruto</th><th>Líquido</th><th>Com. corretor</th><th>Com. gestor</th><th>NF</th></tr></thead>
        <tbody>${vs.slice().sort((a, b) => String(b.dataVenda).localeCompare(String(a.dataVenda))).map(v =>
          `<tr style="border-top:1px solid var(--border)">
            <td style="padding:4px;white-space:nowrap">${String(v.dataVenda || '').split('-').reverse().join('/')}</td>
            <td style="font-weight:700">${escapeHtml(v.vendorName || '—')}</td>
            <td>${escapeHtml(v.cliente || '—')}</td>
            <td>${escapeHtml(v.produto || '—')}</td>
            <td class="tiny muted">${escapeHtml(v.tipoVenda || '—')}</td>
            <td>${money(v._vgv)}</td><td>${money(v._bruto)}</td><td>${money(v._liq)}</td>
            <td>${money(v._cCor)}</td><td>${money(v._cGes)}</td>
            <td>${(v.nfs && v.nfs.length) ? '🧾 ' + v.nfs.length : '<span class="tiny muted">—</span>'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

/* ── Seções novas do Hub (v86.89): renderização resiliente ──
   Ainda não conhecemos o shape exato de cada payload do Hub, então cada bloco é
   desenhado de forma genérica (tabela automática/cartões) + status por endpoint.
   Quando os dados reais aparecerem dá pra refinar o layout por seção. */
const HUB_MONEY_RE = /valor|amount|total|vgv|saldo|price|liquido|bruto|imposto|comiss|receita|despesa|lucro|balance/i;
const HUB_DATE_RE = /^(data|date|venc|due|created|updated|paid|competencia)|(_at|At|Date|data)$/i;

function hubFmtCell(k, v) {
  if (v == null || v === '') return '<span class="tiny muted">—</span>';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (Array.isArray(v)) return `<span class="tiny muted">${v.length} itens</span>`;
  if (typeof v === 'object') return `<span class="tiny muted">{…}</span>`;
  const s = String(v);
  if (HUB_DATE_RE.test(k) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).split('-').reverse().join('/');
  const num = Number(s);
  if (s !== '' && !isNaN(num) && HUB_MONEY_RE.test(k)) return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return escapeHtml(s.length > 80 ? s.slice(0, 77) + '…' : s);
}

function hubSmartTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return '<div class="tiny muted" style="padding:8px">sem registros</div>';
  const cols = Object.keys(rows[0]).filter(k => !/^(id|.*Id|_.*)$/.test(k) || /valor|total/i.test(k)).slice(0, 12);
  return `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:600px">
    <thead><tr class="muted" style="text-align:left">${cols.map(c => `<th style="padding:4px;white-space:nowrap">${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, 300).map(r => `<tr style="border-top:1px solid var(--border)">${cols.map(c => `<td style="padding:4px">${hubFmtCell(c, r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>${rows.length > 300 ? `<div class="tiny muted" style="padding:4px">mostrando 300 de ${rows.length}</div>` : ''}</div>`;
}

function hubKvCards(obj) {
  const ent = Object.entries(obj).filter(([, v]) => typeof v !== 'object' || v == null);
  if (!ent.length) return '';
  return `<div class="flex gap-2" style="flex-wrap:wrap">${ent.map(([k, v]) =>
    `<div style="min-width:130px;background:var(--bg-3);border-radius:10px;padding:8px 12px">
      <div class="tiny muted">${escapeHtml(k)}</div><div style="font-weight:800">${hubFmtCell(k, v)}</div></div>`).join('')}</div>`;
}

function hubBloco(nome, dado) {
  let corpo;
  if (dado == null) corpo = '<div class="tiny muted" style="padding:8px">sem dados (ver status acima)</div>';
  else if (Array.isArray(dado)) corpo = hubSmartTable(dado);
  else if (typeof dado === 'object') {
    // objeto: cartões com os escalares + tabela pra cada lista interna
    corpo = hubKvCards(dado) + Object.entries(dado).filter(([, v]) => Array.isArray(v) && v.length)
      .map(([k, v]) => `<div class="mt-2"><b class="tiny">${escapeHtml(k)}</b>${hubSmartTable(v)}</div>`).join('');
    if (!corpo) corpo = '<div class="tiny muted" style="padding:8px">vazio</div>';
  } else corpo = `<div style="padding:8px">${escapeHtml(String(dado))}</div>`;
  return `<div class="card" style="margin:0 0 12px"><b class="tiny" style="text-transform:capitalize">${escapeHtml(nome.replace(/_/g, ' '))}</b>${corpo}</div>`;
}

async function renderHubSecao(sec) {
  const key = `${sec}:${_hubAno}`;
  if (!_hubSecData[key]) {
    try { _hubSecData[key] = await api.request(`/api/v3/psmhub/financeiro?secao=${sec}&ano=${_hubAno}`); }
    catch (e) { return `<div class="alert alert-err">Ponte PSM HUB: ${escapeHtml(e.message)}</div>`; }
  }
  const d = _hubSecData[key];
  if (d && d.sem_permissao) return `<div class="alert alert-warn">🔑 ${escapeHtml(d.error)}</div>`;
  if (!d || (!d.ok && !d.dados)) return `<div class="alert alert-err">${escapeHtml((d && d.error) || 'ponte indisponível')}</div>`;

  const eps = d.endpoints || {};
  const chip = (nome, ep) => {
    const ok = ep.status === 'ok';
    const cor = ok ? '#16a34a' : (ep.status === 'sem_permissao' ? '#d97706' : '#dc2626');
    const lbl = ok ? 'ok' : (ep.status === 'sem_permissao' ? 'sem permissão no Hub' : ep.status);
    return `<span class="tiny" style="background:var(--bg-3);border-radius:99px;padding:2px 10px;white-space:nowrap">
      <span style="color:${cor}">●</span> ${escapeHtml(nome.replace(/_/g, ' '))} · ${escapeHtml(lbl)}</span>`;
  };
  const anos = []; for (let a = new Date().getFullYear(); a >= 2025; a--) anos.push(String(a));

  return `
    <div class="alert" style="background:var(--bg-3);border:none;font-size:12px">🌉 Espelho da página <b>${escapeHtml((HUB_SECOES.find(s => s[0] === sec) || [])[1] || sec)}</b> do PSM HUB — leitura via ponte, cache de 10min.</div>
    <div class="flex gap-2 mb-2" style="align-items:center;flex-wrap:wrap">
      <select id="hub-ano" class="select" style="width:auto;font-size:12px">
        ${anos.map(a => `<option value="${a}"${_hubAno === a ? ' selected' : ''}>${a}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="hub-sec-reload">🔄 Atualizar agora</button>
      <span class="tiny muted">${d.cache && d.cache.hit ? `cache de ${Math.round(d.cache.age_s / 60)}min` : 'ao vivo'}</span>
    </div>
    <div class="flex gap-1 mb-3" style="flex-wrap:wrap">${Object.entries(eps).map(([n, e]) => chip(n, e)).join('')}</div>
    ${Object.entries(d.dados || {}).map(([nome, dado]) => hubBloco(nome, dado)).join('')}`;
}

function wirePsmHub() {
  document.querySelectorAll('[data-hubsec]').forEach(b => {
    b.onclick = async () => { _hubSec = b.dataset.hubsec; await drawBody(); };
  });
  const sel = document.getElementById('hub-mes');
  if (sel) sel.onchange = async () => { _hubMes = sel.value; await drawBody(); };
  const anoSel = document.getElementById('hub-ano');
  if (anoSel) anoSel.onchange = async () => { _hubAno = anoSel.value; await drawBody(); };
  const rl = document.getElementById('hub-reload');
  if (rl) rl.onclick = async () => {
    rl.disabled = true;
    try { _hubFin = await api.request('/api/v3/psmhub/financeiro?nocache=1'); } catch (_) {}
    await drawBody();
  };
  const rls = document.getElementById('hub-sec-reload');
  if (rls) rls.onclick = async () => {
    rls.disabled = true;
    try { _hubSecData[`${_hubSec}:${_hubAno}`] = await api.request(`/api/v3/psmhub/financeiro?secao=${_hubSec}&ano=${_hubAno}&nocache=1`); } catch (_) {}
    await drawBody();
  };
}
