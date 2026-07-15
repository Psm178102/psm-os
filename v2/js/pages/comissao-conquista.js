/* PSM-OS v2 — 💰 Comissionamento Conquista + Mariane (v84.45)
   Matriz por origem (N1–N4), acelerador de R$ 850k, desconto de indicação na
   fonte e comissão fixa da Mariane. Tudo config-driven (shared_kv comissao_cfg),
   editável pela direção. Origem híbrida: RD (mapa) + ajuste manual por venda.
   Backend: /api/v3/comissao/calc */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _mes = '', _aba = 'corretores', _busy = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + '%';
const NIVEL_COR = { 1: '#64748b', 2: '#2563eb', 3: '#7c3aed', 4: '#16a34a' };

export async function pageComissaoConquista(ctx, root) { _root = root; await reload(); }

async function reload() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Calculando comissões…</div></div>';
  try {
    _d = await api.request('/api/v3/comissao/calc' + (_mes ? '?mes=' + _mes : ''));
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  _mes = _d.mes;
  render();
}

async function post(body, okMsg) {
  if (_busy) return null;
  _busy = true;
  let r = null;
  try { r = await api.request('/api/v3/comissao/calc', { method: 'POST', body }); if (okMsg) alert(okMsg); }
  catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
  _busy = false;
  return r;
}

function mesShift(delta) {
  const [y, m] = _mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  _mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  reload();
}

const canEdit = () => (auth.user()?.lvl || 0) >= 7;

function render() {
  const podeEditar = canEdit();
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">💰 Comissionamento Conquista</h2>
        <span class="tiny muted">matriz por origem · acelerador R$ 850k → 1,9% · indicação da operação descontada na fonte</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-ghost btn-sm" id="cm-prev">‹</button>
        <b class="tiny" style="min-width:74px;text-align:center">${esc(_mes)}</b>
        <button class="btn btn-ghost btn-sm" id="cm-next">›</button>
        <button class="btn btn-ghost btn-sm" id="cm-reload">↻</button>
      </div>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm ${_aba === 'corretores' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-c">👥 Corretores</button>
        <button class="btn btn-sm ${_aba === 'mariane' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-m">🎁 Mariane (Indicação)</button>
        <button class="btn btn-sm ${_aba === 'leire' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-l">🔁 Leire (Reativação)</button>
        <button class="btn btn-sm ${_aba === 'map' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-map">🏢 MAP (Empreendimentos)</button>
        <button class="btn btn-sm ${_aba === 'config' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-cfg">📊 Regras & Origens</button>
      </div>
    </div>
    <div class="mt-2">${
      _aba === 'corretores' ? htmlCorretores()
      : _aba === 'mariane' ? htmlOperador(_d.mariane, { unidade: 'indicação', o_que: 'indicações que a OPERAÇÃO gerou e viraram venda' })
      : _aba === 'leire' ? htmlLeire()
      : _aba === 'map' ? htmlMap()
      : htmlConfig(podeEditar)}</div>`;
  _root.querySelector('#cm-prev').onclick = () => mesShift(-1);
  _root.querySelector('#cm-next').onclick = () => mesShift(1);
  _root.querySelector('#cm-reload').onclick = reload;
  _root.querySelector('#cm-ab-c').onclick = () => { _aba = 'corretores'; render(); };
  _root.querySelector('#cm-ab-m').onclick = () => { _aba = 'mariane'; render(); };
  _root.querySelector('#cm-ab-l').onclick = () => { _aba = 'leire'; render(); };
  _root.querySelector('#cm-ab-map').onclick = () => { _aba = 'map'; render(); };
  _root.querySelector('#cm-ab-cfg').onclick = () => { _aba = 'config'; render(); };
  if (_aba === 'corretores') wireCorretores();
  if (_aba === 'leire') wireLeire();
  if (_aba === 'map') wireMap();
  if (_aba === 'config') wireConfig();
}

/* ── 👥 Corretores ──────────────────────────────────────────────────────── */
function htmlCorretores() {
  const cs = _d.corretores || [];
  if (!cs.length) return '<div class="card muted" style="text-align:center;padding:26px">Nenhuma venda Conquista fechada neste mês.</div>';
  const totalGeral = cs.reduce((s, c) => s + c.comissao_total, 0);
  const vgvGeral = cs.reduce((s, c) => s + c.vgv_total, 0);
  return `
    <div class="flex" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div style="flex:1;min-width:150px;background:var(--bg-2);border-radius:10px;padding:8px 12px"><div class="tiny muted">VGV Conquista do mês</div><div style="font-weight:900;font-size:17px">${brl(vgvGeral)}</div></div>
      <div style="flex:1;min-width:150px;background:var(--bg-2);border-radius:10px;padding:8px 12px;border-left:3px solid #16a34a"><div class="tiny muted">Comissão total a pagar</div><div style="font-weight:900;font-size:17px">${brl(totalGeral)}</div></div>
      <div style="flex:1;min-width:120px;background:var(--bg-2);border-radius:10px;padding:8px 12px"><div class="tiny muted">Corretores</div><div style="font-weight:900;font-size:17px">${cs.length}</div></div>
    </div>
    ${cs.map(corretorCard).join('')}`;
}

function corretorCard(c) {
  const acel = c.acelerador;
  return `<div class="card" style="margin:0 0 10px;padding:12px 14px">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>${esc(c.corretor_nome)}</b>
      <span class="badge">${c.n_vendas} venda(s)</span>
      <span class="tiny muted">VGV ${brl(c.vgv_total)} · N2/N3 ${brl(c.vgv_n2n3)}</span>
      ${acel ? '<span class="badge" style="background:#16a34a22;color:#16a34a;font-weight:800">🚀 Acelerador N4 (1,9%)</span>'
             : `<span class="tiny muted">faltam ${brl(Math.max(0, (_d.cfg.acelerador?.vgv_min || 850000) - c.vgv_n2n3))} p/ o N4</span>`}
      <b style="margin-left:auto;color:#16a34a;font-size:16px">${brl(c.comissao_total)}</b>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:3px 6px">Cliente</th><th>Origem</th><th style="text-align:right">VGV</th><th style="text-align:right">Taxa</th><th style="text-align:right">Desc. indic.</th><th style="text-align:right">Comissão</th><th></th></tr>
      ${c.vendas.map(v => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:5px 6px">${esc(v.cliente || '—')}</td>
        <td><span style="color:${v.definida ? (NIVEL_COR[v.acelerada ? 4 : v.nivel] || '#64748b') : '#dc2626'};font-weight:700">${esc(v.origem_lbl)}${v.acelerada ? ' 🚀' : ''}</span>${v.fonte_rd ? `<div class="tiny muted">RD: ${esc(v.fonte_rd)}</div>` : ''}</td>
        <td style="text-align:right">${brl(v.vgv)}</td>
        <td style="text-align:right;font-weight:700">${pct(v.taxa_aplicada)}</td>
        <td style="text-align:right;color:${v.desconto_indicacao ? '#dc2626' : 'inherit'}">${v.desconto_indicacao ? '− ' + brl(v.desconto_indicacao) : '—'}</td>
        <td style="text-align:right;font-weight:800">${brl(v.comissao_liquida)}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm cm-ori" data-did="${esc(v.deal_id)}" title="Definir/corrigir a origem desta venda" style="padding:1px 7px;font-size:11px">✏️</button></td>
      </tr>`).join('')}
    </table>
  </div>`;
}

function wireCorretores() {
  _root.querySelectorAll('.cm-ori').forEach(b => b.onclick = () => abrirOrigem(b.dataset.did));
}

function abrirOrigem(did) {
  const origens = _d.cfg.origens || [];
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `<div class="card" style="max-width:440px;width:100%;background:var(--bg-2)">
    <h3 class="card-title" style="margin:0">✏️ Origem da venda</h3>
    <div class="tiny muted">Ajuste manual (vale mais que o RD). Decide o nível e a taxa.</div>
    <div class="flex mt-2" style="gap:5px;flex-wrap:wrap">
      ${origens.map(o => `<button class="btn btn-ghost btn-sm cm-op" data-o="${esc(o.id)}" style="padding:3px 10px;border:1px solid ${NIVEL_COR[o.nivel]}55">N${o.nivel} · ${esc(o.rotulo)} (${pct(o.taxa)})</button>`).join('')}
    </div>
    <div class="flex mt-3" style="gap:6px;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="cm-op-clear">Limpar (voltar pro RD)</button>
      <button class="btn btn-ghost btn-sm" id="cm-op-x">Fechar</button>
    </div></div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  if (!canEdit()) { ov.querySelectorAll('button').forEach(b => { if (!b.id) b.disabled = true; }); }
  ov.querySelectorAll('.cm-op').forEach(b => b.onclick = async () => {
    const r = await post({ action: 'set_origem', deal_id: did, origem: b.dataset.o }); if (r) { ov.remove(); reload(); }
  });
  ov.querySelector('#cm-op-clear').onclick = async () => { const r = await post({ action: 'set_origem', deal_id: did, origem: '' }); if (r) { ov.remove(); reload(); } };
  ov.querySelector('#cm-op-x').onclick = () => ov.remove();
}

/* ── 🎁 Mariane ─────────────────────────────────────────────────────────── */
function faixaLbl(fx, i, arr) {
  const [teto] = fx;
  const de = i === 0 ? 1 : Number(arr[i - 1][0]) + 1;
  if (teto >= 999999) return `${de}+`;
  return de === teto ? `${teto}` : `${de} a ${teto}`;
}

function htmlOperador(m, opts) {
  m = m || {};
  const faixas = m.faixas || [];
  const un = opts.unidade;
  return `<div class="card">
    <div class="flex items-center" style="gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:150px"><div class="tiny muted">${un.charAt(0).toUpperCase() + un.slice(1)}(s) fechada(s) em ${esc(_mes)}</div><div style="font-weight:900;font-size:22px">${m.qtd || 0}</div></div>
      <div style="min-width:120px"><div class="tiny muted">Faixa atual</div><div style="font-weight:800;font-size:16px">${m.qtd ? brl(m.rate) + '/un' : '—'}</div></div>
      <div style="min-width:180px;background:#16a34a15;border-radius:10px;padding:8px 12px;border-left:3px solid #16a34a"><div class="tiny muted">Comissão no mês</div><div style="font-weight:900;font-size:20px">${brl(m.total)}${m.no_teto ? ' <span class="tiny" style="color:#d97706">(no teto)</span>' : ''}</div></div>
    </div>
    <div class="tiny muted mt-2">Tabela PROGRESSIVA e retroativa: a faixa do total do mês vale pra todas. Teto mensal: <b>${brl(m.teto)}</b>. Conta ${esc(opts.o_que)}.</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;max-width:420px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Fechamentos no mês</th><th style="text-align:right">R$ por ${esc(un)}</th></tr>
      ${faixas.map((fx, i) => { const ativa = m.qtd && m.rate === Number(fx[1]) && (i === 0 ? m.qtd <= fx[0] : (m.qtd > faixas[i - 1][0] && m.qtd <= fx[0])); return `<tr style="border-top:1px solid var(--bd,#eef2f7);${ativa ? 'background:#16a34a12;font-weight:800' : ''}"><td style="padding:5px 8px">${faixaLbl(fx, i, faixas)}${ativa ? ' ← agora' : ''}</td><td style="text-align:right">${brl(fx[1])}</td></tr>`; }).join('')}
    </table>
    <div class="mt-2">${(m.fechadas || []).length ? `<b class="tiny">Fechamentos deste mês:</b><table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Cliente</th><th></th><th style="text-align:right">VGV</th></tr>
      ${m.fechadas.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)"><td style="padding:6px 8px">${esc(f.indicador || f.nome || '—')}</td><td class="tiny muted">${f.indicado ? '→ ' + esc(f.indicado) : ''}</td><td style="text-align:right">${f.vgv ? brl(f.vgv) : '—'}</td></tr>`).join('')}
    </table>` : `<div class="muted tiny" style="text-align:center;padding:16px">Nenhuma ${esc(un)} fechou neste mês ainda.</div>`}</div>
  </div>`;
}

/* ── 🔁 Leire (Reativação MAP: VGV × tipo × volume) ─────────────────────── */
function bandaLbl(fx, i, arr) {
  const teto = Number(fx[0]);
  const de = i === 0 ? 0 : Number(arr[i - 1][0]);
  if (teto >= 999999999) return 'acima de ' + brl(de);
  return (i === 0 ? 'até ' : brl(de) + ' – ') + brl(teto);
}

function htmlLeire() {
  const m = _d.leire || {};
  const est = m.estoque || [], lanc = m.lancamento || [], vol = m.volume || [];
  return `<div class="card">
    <div class="flex items-center" style="gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px"><div class="tiny muted">Reativações fechadas em ${esc(_mes)}</div><div style="font-weight:900;font-size:22px">${m.qtd || 0}</div></div>
      <div style="min-width:110px"><div class="tiny muted">Base do mês</div><div style="font-weight:800;font-size:15px">${brl(m.base)}</div></div>
      <div style="min-width:110px"><div class="tiny muted">Bônus volume</div><div style="font-weight:800;font-size:15px">×${(m.mult || 1).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</div></div>
      <div style="min-width:170px;background:#16a34a15;border-radius:10px;padding:8px 12px;border-left:3px solid #16a34a"><div class="tiny muted">Comissão da Leire no mês</div><div style="font-weight:900;font-size:20px">${brl(m.total)}${m.no_teto ? ' <span class="tiny" style="color:#d97706">(no teto)</span>' : ''}</div></div>
    </div>
    <div class="tiny muted mt-2">Cada reativação vale pela faixa de VGV × tipo; o total é multiplicado pelo bônus de volume (progressivo) e travado no teto de <b>${brl(m.teto)}</b>. Marque 🚀 nos fechamentos de lançamento (pagam menos, é mais fácil).</div>
    <div class="flex mt-2" style="gap:10px;flex-wrap:wrap">
      <table style="flex:1;min-width:280px;border-collapse:collapse;font-size:12px">
        <tr class="tiny muted" style="text-align:left"><th style="padding:3px 6px">VGV</th><th style="text-align:right">🎯 Estoque</th><th style="text-align:right">🚀 Lançam.</th></tr>
        ${est.map((fx, i) => `<tr style="border-top:1px solid var(--bd,#eef2f7)"><td style="padding:4px 6px">${bandaLbl(fx, i, est)}</td><td style="text-align:right;font-weight:700">${brl(fx[1])}</td><td style="text-align:right">${brl((lanc[i] || [])[1] || 0)}</td></tr>`).join('')}
      </table>
      <table style="width:190px;border-collapse:collapse;font-size:12px;align-self:flex-start">
        <tr class="tiny muted" style="text-align:left"><th style="padding:3px 6px">Fechamentos</th><th style="text-align:right">Bônus</th></tr>
        ${vol.map((fx, i) => { const de = i === 0 ? 1 : Number(vol[i - 1][0]) + 1; const lbl = fx[0] >= 999999 ? de + '+' : (de === fx[0] ? de : de + ' a ' + fx[0]); const ativa = m.qtd && m.mult === Number(fx[1]) && (i === 0 ? m.qtd <= fx[0] : (m.qtd > vol[i - 1][0] && m.qtd <= fx[0])); return `<tr style="border-top:1px solid var(--bd,#eef2f7);${ativa ? 'background:#16a34a12;font-weight:800' : ''}"><td style="padding:4px 6px">${lbl}${ativa ? ' ←' : ''}</td><td style="text-align:right">×${Number(fx[1]).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</td></tr>`; }).join('')}
      </table>
    </div>
    <div class="mt-2">${(m.fechadas || []).length ? `<b class="tiny">Fechamentos deste mês:</b><table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Cliente</th><th style="text-align:right">VGV</th><th style="text-align:right">Vale</th><th>Tipo</th></tr>
      ${m.fechadas.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px 8px">${esc(f.nome || '—')}</td>
        <td style="text-align:right">${brl(f.vgv)}</td>
        <td style="text-align:right;font-weight:700">${brl(f.valor)}</td>
        <td><button class="btn btn-ghost btn-sm lei-tipo" data-did="${esc(f.deal_id)}" data-lanc="${f.tipo === 'lancamento' ? '1' : '0'}" style="padding:2px 9px;font-size:11px">${f.tipo === 'lancamento' ? '🚀 Lançamento' : '🎯 Estoque'}</button></td>
      </tr>`).join('')}
    </table><div class="tiny muted mt-1">Clique no tipo pra alternar estoque ⇄ lançamento (recalcula na hora).</div>` : '<div class="muted tiny" style="text-align:center;padding:16px">Nenhuma reativação fechou neste mês ainda.</div>'}</div>
  </div>`;
}

function wireLeire() {
  _root.querySelectorAll('.lei-tipo').forEach(b => b.onclick = async () => {
    if (!canEdit()) { alert('Só a direção (nível ≥ 7) marca estoque/lançamento.'); return; }
    const virar = b.dataset.lanc !== '1';  // se não é lançamento, vira lançamento
    const r = await post({ action: 'set_leire_tipo', deal_id: b.dataset.did, lancamento: virar });
    if (r) reload();
  });
}

/* ── 🏢 MAP / Empreendimentos (origem × senioridade) ────────────────────── */
const SEN_COR = { estagiario: '#94a3b8', corretor: '#2563eb', senior: '#16a34a' };

function htmlMap() {
  const m = _d.map || {};
  const origens = m.origens || [], cs = m.corretores || [];
  const total = cs.reduce((s, c) => s + (c.comissao_total || 0), 0);
  const vgv = cs.reduce((s, c) => s + (c.vgv_total || 0), 0);
  const naoDef = cs.reduce((s, c) => s + (c.vendas || []).filter(v => !v.definida).length, 0);
  return `<div class="card">
    <div class="flex items-center" style="gap:10px;flex-wrap:wrap">
      <div><div class="tiny muted">VGV MAP do mês</div><div style="font-weight:900;font-size:20px">${brl(vgv)}</div></div>
      <div style="background:#16a34a15;border-radius:10px;padding:8px 12px;border-left:3px solid #16a34a"><div class="tiny muted">Comissão total a pagar</div><div style="font-weight:900;font-size:20px">${brl(total)}</div></div>
      <div><div class="tiny muted">Corretores</div><div style="font-weight:800;font-size:18px">${cs.length}</div></div>
      ${naoDef ? `<div style="background:#f59e0b15;border-radius:10px;padding:8px 12px;border-left:3px solid #f59e0b"><div class="tiny muted">Vendas sem origem</div><div style="font-weight:800;font-size:18px">${naoDef}</div></div>` : ''}
    </div>
    <div class="tiny muted mt-2">A origem do cliente (comprovada no CRM) define a taxa, cruzada com a senioridade. <b>Sênior é automático</b>: sai sozinho quando o VGV MAP acumulado no ano cruza ${brl(m.senior_vgv_min)}. Estagiário é a única marcação manual.</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 6px">Origem do cliente</th><th style="text-align:right">Estagiário</th><th style="text-align:right">Corretor</th><th style="text-align:right">Sênior</th></tr>
      ${origens.map(o => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:5px 6px">${esc(o.rotulo)}</td>
        ${['estagiario', 'corretor', 'senior'].map(s => `<td style="text-align:right;font-weight:700;color:${SEN_COR[s]}">${pct((o.taxas || {})[s])}</td>`).join('')}
      </tr>`).join('')}
    </table>
  </div>
  ${cs.length ? cs.map(c => `<div class="card mt-2">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>${esc(c.corretor_nome || '—')}</b>
      <span class="tiny" style="background:${SEN_COR[c.senioridade]}20;color:${SEN_COR[c.senioridade]};border-radius:20px;padding:2px 9px;font-weight:800">${esc(c.senioridade_lbl)}</span>
      <span class="tiny muted">${c.n_vendas} venda(s) · VGV mês ${brl(c.vgv_total)}</span>
      <span class="tiny muted">· ano ${brl(c.vgv_ano)}${c.senioridade === 'corretor' ? ` · faltam <b>${brl(c.falta_senior)}</b> p/ Sênior` : ''}</span>
      ${canEdit() ? `<button class="btn btn-ghost btn-sm mp-estag" data-uid="${esc(c.corretor_id)}" data-on="${c.senioridade === 'estagiario' ? '1' : '0'}" style="padding:1px 8px;font-size:11px">${c.senioridade === 'estagiario' ? '↩︎ tirar estagiário' : '🎓 marcar estagiário'}</button>` : ''}
      <span style="margin-left:auto;font-weight:900;font-size:17px;color:#16a34a">${brl(c.comissao_total)}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Cliente</th><th>Origem</th><th style="text-align:right">VGV</th><th style="text-align:right">Taxa</th><th style="text-align:right">Comissão</th></tr>
      ${(c.vendas || []).map(v => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px 8px">${esc(v.cliente || '—')}</td>
        <td>${canEdit() ? `<select class="input mp-org" data-did="${esc(v.deal_id)}" style="padding:2px 6px;font-size:12px">
            <option value="">— indefinida —</option>
            ${origens.map(o => `<option value="${esc(o.id)}"${v.origem === o.id ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('')}
          </select>` : `<span class="tiny ${v.definida ? '' : 'muted'}">${esc(v.origem_lbl)}</span>`}
          ${v.fonte_rd ? `<div class="tiny muted">RD: ${esc(v.fonte_rd)}</div>` : ''}</td>
        <td style="text-align:right">${brl(v.vgv)}</td>
        <td style="text-align:right;font-weight:700">${pct(v.taxa)}</td>
        <td style="text-align:right;font-weight:700">${brl(v.comissao)}</td>
      </tr>`).join('')}
    </table>
  </div>`).join('') : '<div class="card mt-2"><div class="muted tiny" style="text-align:center;padding:18px">Nenhuma venda MAP fechou neste mês.</div></div>'}`;
}

function wireMap() {
  _root.querySelectorAll('.mp-org').forEach(s => s.onchange = async () => {
    const r = await post({ action: 'set_map_origem', deal_id: s.dataset.did, origem: s.value }, '✅ Origem atualizada.');
    if (r) reload();
  });
  _root.querySelectorAll('.mp-estag').forEach(b => b.onclick = async () => {
    const r = await post({ action: 'set_map_estagiario', user_id: b.dataset.uid, on: b.dataset.on !== '1' });
    if (r) reload();
  });
}

/* ── 📊 Regras & Origens ────────────────────────────────────────────────── */
function htmlConfig(podeEditar) {
  const cfg = _d.cfg || {};
  const porNivel = {};
  (cfg.origens || []).forEach(o => { (porNivel[o.nivel] = porNivel[o.nivel] || []).push(o); });
  const acel = cfg.acelerador || {};
  const fontes = _d.fontes_rd || [];
  const origens = cfg.origens || [];
  return `
    <div class="card">
      <b class="tiny">🎯 Matriz de comissão por origem</b>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
        <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Nível</th><th>Origens</th><th style="text-align:right">Taxa</th></tr>
        <tr style="border-top:1px solid var(--bd,#eef2f7)"><td style="padding:6px 8px"><b style="color:${NIVEL_COR[1]}">N1</b></td><td>Estagiário</td><td style="text-align:right;font-weight:800">${pct(cfg.taxa_estagiario)}</td></tr>
        ${[1, 2, 3].map(n => (porNivel[n] || []).length ? `<tr style="border-top:1px solid var(--bd,#eef2f7)"><td style="padding:6px 8px"><b style="color:${NIVEL_COR[n]}">N${n}</b></td><td>${porNivel[n].map(o => esc(o.rotulo)).join(' · ')}</td><td style="text-align:right;font-weight:800">${pct(porNivel[n][0].taxa)}</td></tr>` : '').join('')}
        <tr style="border-top:1px solid var(--bd,#eef2f7);background:#16a34a10"><td style="padding:6px 8px"><b style="color:${NIVEL_COR[4]}">N4 🚀</b></td><td>Acelerador: VGV mensal N2/N3 ≥ ${brl(acel.vgv_min)} → todas as vendas N2/N3 do mês sobem</td><td style="text-align:right;font-weight:800">${pct(acel.taxa)}</td></tr>
      </table>
      ${podeEditar ? `<div class="flex mt-2" style="gap:6px;flex-wrap:wrap;align-items:center">
        <label class="tiny">Estagiário <input class="input" id="cf-estag" type="number" step="0.1" value="${cfg.taxa_estagiario}" style="width:70px;padding:2px 6px">%</label>
        ${origens.map(o => `<label class="tiny">${esc(o.rotulo)} <input class="input cf-taxa" data-o="${esc(o.id)}" type="number" step="0.1" value="${o.taxa}" style="width:64px;padding:2px 6px">%</label>`).join('')}
        <label class="tiny">Acelerador ≥ <input class="input" id="cf-acmin" type="number" value="${acel.vgv_min}" style="width:110px;padding:2px 6px"> → <input class="input" id="cf-actaxa" type="number" step="0.1" value="${acel.taxa}" style="width:64px;padding:2px 6px">%</label>
        <button class="btn btn-primary btn-sm" id="cf-save">💾 Salvar regras</button>
      </div>` : '<div class="tiny muted mt-1">Só a direção (nível ≥ 7) edita as regras.</div>'}
    </div>
    <div class="card mt-2">
      <b class="tiny">🎁 Tabela progressiva da Mariane</b>
      <div class="tiny muted">R$ por indicação da operação que fecha no mês, por faixa (retroativa). Teto mensal trava o total.</div>
      <div id="cf-mfaixas" style="margin-top:6px">
        ${(cfg.mariane_faixas || []).map((fx, i, arr) => `<div class="flex" style="gap:6px;margin-top:4px;align-items:center" data-mf>
          <span class="tiny muted" style="width:130px">${faixaLbl(fx, i, arr)} fechamentos</span>
          <span class="tiny muted">até</span>
          <input class="input mf-teto" type="number" min="1" value="${fx[0] >= 999999 ? '' : fx[0]}" placeholder="∞" style="width:80px;padding:2px 6px" ${!podeEditar ? 'disabled' : ''}>
          <span class="tiny muted">→ R$</span>
          <input class="input mf-rate" type="number" min="0" value="${fx[1]}" style="width:90px;padding:2px 6px" ${!podeEditar ? 'disabled' : ''}>
          ${podeEditar ? '<button class="btn btn-ghost btn-sm mf-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>' : ''}
        </div>`).join('')}
      </div>
      ${podeEditar ? `<div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" id="cf-mfadd" type="button">+ faixa</button>
        <label class="tiny" style="margin-left:auto">Teto mensal R$ <input class="input" id="cf-mteto" type="number" value="${cfg.mariane_teto}" style="width:110px;padding:2px 6px"></label>
        <button class="btn btn-primary btn-sm" id="cf-msave">💾 Salvar tabela da Mariane</button>
      </div>` : `<div class="tiny muted mt-1">Teto mensal: ${brl(cfg.mariane_teto)}</div>`}
    </div>
    <div class="card mt-2">
      <b class="tiny">🔁 Tabela da Leire (Reativação MAP) — VGV × tipo × volume</b>
      <div class="tiny muted">Cada reativação que fecha vale pela faixa de VGV e pelo tipo (🎯 estoque / 🚀 lançamento). O total do mês é multiplicado pelo bônus de volume e travado no teto.</div>
      <div class="tiny muted mt-1" style="font-weight:700">Valor por faixa de VGV</div>
      <div id="cf-lbands" style="margin-top:4px">
        ${(cfg.leire_estoque || []).map((fx, i, arr) => `<div class="flex" style="gap:6px;margin-top:4px;align-items:center" data-lb>
          <span class="tiny muted">VGV até R$</span>
          <input class="input lb-teto" type="number" min="1" value="${fx[0] >= 999999999 ? '' : fx[0]}" placeholder="∞" style="width:100px;padding:2px 6px" ${!podeEditar ? 'disabled' : ''}>
          <span class="tiny muted">🎯 R$</span>
          <input class="input lb-est" type="number" min="0" value="${fx[1]}" style="width:80px;padding:2px 6px" ${!podeEditar ? 'disabled' : ''}>
          <span class="tiny muted">🚀 R$</span>
          <input class="input lb-lanc" type="number" min="0" value="${((cfg.leire_lancamento || [])[i] || [])[1] || 0}" style="width:80px;padding:2px 6px" ${!podeEditar ? 'disabled' : ''}>
          ${podeEditar ? '<button class="btn btn-ghost btn-sm lb-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>' : ''}
        </div>`).join('')}
      </div>
      ${podeEditar ? '<button class="btn btn-ghost btn-sm mt-1" id="cf-lbadd" type="button">+ faixa de VGV</button>' : ''}
      <div class="tiny muted mt-2" style="font-weight:700">Bônus por volume de fechamentos no mês</div>
      <div id="cf-lvol" style="margin-top:4px">
        ${(cfg.leire_volume || []).map((fx, i, arr) => `<div class="flex" style="gap:6px;margin-top:4px;align-items:center" data-lv>
          <span class="tiny muted" style="width:90px">até</span>
          <input class="input lv-teto" type="number" min="1" value="${fx[0] >= 999999 ? '' : fx[0]}" placeholder="∞" style="width:80px;padding:2px 6px" ${!podeEditar ? 'disabled' : ''}>
          <span class="tiny muted">fechamentos → ×</span>
          <input class="input lv-mult" type="number" min="1" step="0.05" value="${fx[1]}" style="width:80px;padding:2px 6px" ${!podeEditar ? 'disabled' : ''}>
          ${podeEditar ? '<button class="btn btn-ghost btn-sm lv-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>' : ''}
        </div>`).join('')}
      </div>
      ${podeEditar ? `<div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" id="cf-lvadd" type="button">+ faixa de volume</button>
        <label class="tiny" style="margin-left:auto">Teto mensal R$ <input class="input" id="cf-lteto" type="number" value="${cfg.leire_teto}" style="width:110px;padding:2px 6px"></label>
        <button class="btn btn-primary btn-sm" id="cf-lsave">💾 Salvar tabela da Leire</button>
      </div>` : `<div class="tiny muted mt-1">Teto mensal: ${brl(cfg.leire_teto)}</div>`}
    </div>
    <div class="card mt-2">
      <b class="tiny">🔗 Origens do RD → nível ${podeEditar ? '(mapeie cada fonte que aparece nas vendas)' : ''}</b>
      <div class="tiny muted">Fontes que apareceram nas vendas Conquista deste mês. As não mapeadas caem em "origem indefinida" (ajuste manual por venda também funciona).</div>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
        <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Fonte no RD</th><th style="text-align:right">Vendas</th><th>Mapeia para</th></tr>
        ${fontes.length ? fontes.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
          <td style="padding:6px 8px">${esc(f.fonte)}</td>
          <td style="text-align:right">${f.n}</td>
          <td>${podeEditar ? `<select class="input cf-map" data-fonte="${esc(f.fonte)}" style="padding:2px 6px;font-size:12px">
            <option value="">— indefinida —</option>
            ${origens.map(o => `<option value="${esc(o.id)}"${(cfg.mapa_rd || {})[f.fonte.toLowerCase()] === o.id ? ' selected' : ''}>N${o.nivel} · ${esc(o.rotulo)}</option>`).join('')}
          </select>` : `<span class="tiny ${f.mapeada ? '' : 'muted'}">${f.mapeada ? 'mapeada' : '⚠️ indefinida'}</span>`}</td>
        </tr>`).join('') : '<tr><td colspan="3" class="muted tiny" style="padding:12px;text-align:center">Nenhuma venda no mês pra listar fontes.</td></tr>'}
      </table>
      ${podeEditar && fontes.length ? '<button class="btn btn-primary btn-sm mt-2" id="cf-savemap">💾 Salvar mapeamento</button>' : ''}
    </div>
    ${htmlConfigMap(podeEditar)}`;
}

function htmlConfigMap(podeEditar) {
  const m = _d.map || {};
  const origens = m.origens || [], mfontes = m.fontes_rd || [];
  return `<div class="card mt-2">
    <b class="tiny">🏢 Matriz MAP / Empreendimentos (PSM Imóveis) — origem × senioridade</b>
    <div class="tiny muted">Matriz PRÓPRIA, separada da Conquista. A origem do cliente (comprovada no CRM) define a taxa; a senioridade do corretor define a coluna.</div>
    <div id="cf-mpmatriz" style="margin-top:6px">
      <div class="flex tiny muted" style="gap:6px;padding:0 6px"><span style="flex:1">Origem do cliente</span><span style="width:78px;text-align:center">Estagiário</span><span style="width:78px;text-align:center">Corretor</span><span style="width:78px;text-align:center">Sênior</span></div>
      ${origens.map(o => `<div class="flex" style="gap:6px;margin-top:4px;align-items:center" data-mp data-id="${esc(o.id)}">
        <span class="tiny" style="flex:1">${esc(o.rotulo)}</span>
        ${['estagiario', 'corretor', 'senior'].map(s => `<input class="input mp-t" data-s="${s}" type="number" min="0" step="0.1" value="${(o.taxas || {})[s]}" style="width:78px;padding:2px 6px;text-align:right" ${!podeEditar ? 'disabled' : ''}>`).join('')}
      </div>`).join('')}
    </div>
    ${podeEditar ? `<div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:center">
      <label class="tiny">Vira <b style="color:#16a34a">Sênior</b> com VGV no ano ≥ R$ <input class="input" id="cf-mpsen" type="number" value="${m.senior_vgv_min}" style="width:130px;padding:2px 6px"></label>
      <button class="btn btn-primary btn-sm" id="cf-mpsave" style="margin-left:auto">💾 Salvar matriz MAP</button>
    </div>` : `<div class="tiny muted mt-1">Sênior automático a partir de ${brl(m.senior_vgv_min)} de VGV no ano.</div>`}
    <div class="tiny muted mt-2" style="font-weight:700">🔗 Fontes do RD nas vendas MAP → origem</div>
    <table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Fonte no RD</th><th style="text-align:right">Vendas</th><th>Mapeia para</th></tr>
      ${mfontes.length ? mfontes.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px 8px">${esc(f.fonte)}</td>
        <td style="text-align:right">${f.n}</td>
        <td>${podeEditar ? `<select class="input cf-mpmap" data-fonte="${esc(f.fonte)}" style="padding:2px 6px;font-size:12px">
          <option value="">— indefinida —</option>
          ${origens.map(o => `<option value="${esc(o.id)}"${(_mpMapa())[f.fonte.toLowerCase()] === o.id ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('')}
        </select>` : `<span class="tiny ${f.mapeada ? '' : 'muted'}">${f.mapeada ? 'mapeada' : '⚠️ indefinida'}</span>`}</td>
      </tr>`).join('') : '<tr><td colspan="3" class="muted tiny" style="padding:12px;text-align:center">Nenhuma venda MAP no mês pra listar fontes.</td></tr>'}
    </table>
    ${podeEditar && mfontes.length ? '<button class="btn btn-primary btn-sm mt-2" id="cf-mpsavemap">💾 Salvar mapeamento MAP</button>' : ''}
  </div>`;
}

function _mpMapa() { return (_d.cfg && _d.cfg.map_mapa_rd) || {}; }

function wireConfig() {
  const $ = s => _root.querySelector(s);
  if ($('#cf-save')) $('#cf-save').onclick = async () => {
    const origens = (_d.cfg.origens || []).map(o => {
      const inp = _root.querySelector(`.cf-taxa[data-o="${o.id}"]`);
      return { ...o, taxa: inp ? Number(inp.value) : o.taxa };
    });
    const cfg = {
      taxa_estagiario: Number($('#cf-estag').value) || _d.cfg.taxa_estagiario,
      origens,
      acelerador: { ...(_d.cfg.acelerador || {}), vgv_min: Number($('#cf-acmin').value) || 850000, taxa: Number($('#cf-actaxa').value) || 1.9 },
      mariane_valor_indicacao: Number($('#cf-mari').value) || 0,
    };
    const r = await post({ action: 'set_cfg', cfg }, '💾 Regras atualizadas.'); if (r) reload();
  };
  if ($('#cf-savemap')) $('#cf-savemap').onclick = async () => {
    const mapa = {};
    _root.querySelectorAll('.cf-map').forEach(s => { if (s.value) mapa[s.dataset.fonte.toLowerCase()] = s.value; });
    const r = await post({ action: 'set_cfg', cfg: { mapa_rd: mapa } }, '💾 Mapeamento salvo.'); if (r) reload();
  };
  const box = $('#cf-mfaixas');
  if ($('#cf-mfadd')) $('#cf-mfadd').onclick = () => {
    const d = document.createElement('div');
    d.innerHTML = `<div class="flex" style="gap:6px;margin-top:4px;align-items:center" data-mf>
      <span class="tiny muted" style="width:130px">nova faixa</span><span class="tiny muted">até</span>
      <input class="input mf-teto" type="number" min="1" placeholder="∞" style="width:80px;padding:2px 6px">
      <span class="tiny muted">→ R$</span><input class="input mf-rate" type="number" min="0" value="0" style="width:90px;padding:2px 6px">
      <button class="btn btn-ghost btn-sm mf-del" type="button" style="color:#dc2626;padding:1px 7px">×</button></div>`;
    const row = d.firstElementChild;
    row.querySelector('.mf-del').onclick = () => row.remove();
    box.appendChild(row);
  };
  _root.querySelectorAll('.mf-del').forEach(b => b.onclick = () => b.closest('[data-mf]').remove());
  if ($('#cf-msave')) $('#cf-msave').onclick = async () => {
    const faixas = [...box.querySelectorAll('[data-mf]')].map(r => {
      const teto = r.querySelector('.mf-teto').value.trim();
      return [teto ? Number(teto) : 999999, Number(r.querySelector('.mf-rate').value) || 0];
    }).filter(f => f[1] >= 0).sort((a, b) => a[0] - b[0]);
    if (!faixas.length) { alert('Deixe ao menos 1 faixa.'); return; }
    const teto = Number($('#cf-mteto').value) || 0;
    const r = await post({ action: 'set_cfg', cfg: { mariane_faixas: faixas, mariane_teto: teto } }, '💾 Tabela da Mariane salva.');
    if (r) reload();
  };
  const boxB = $('#cf-lbands');
  if ($('#cf-lbadd')) $('#cf-lbadd').onclick = () => {
    const d = document.createElement('div');
    d.innerHTML = `<div class="flex" style="gap:6px;margin-top:4px;align-items:center" data-lb>
      <span class="tiny muted">VGV até R$</span>
      <input class="input lb-teto" type="number" min="1" placeholder="∞" style="width:100px;padding:2px 6px">
      <span class="tiny muted">🎯 R$</span><input class="input lb-est" type="number" min="0" value="0" style="width:80px;padding:2px 6px">
      <span class="tiny muted">🚀 R$</span><input class="input lb-lanc" type="number" min="0" value="0" style="width:80px;padding:2px 6px">
      <button class="btn btn-ghost btn-sm lb-del" type="button" style="color:#dc2626;padding:1px 7px">×</button></div>`;
    const row = d.firstElementChild;
    row.querySelector('.lb-del').onclick = () => row.remove();
    boxB.appendChild(row);
  };
  _root.querySelectorAll('.lb-del').forEach(b => b.onclick = () => b.closest('[data-lb]').remove());
  const boxV = $('#cf-lvol');
  if ($('#cf-lvadd')) $('#cf-lvadd').onclick = () => {
    const d = document.createElement('div');
    d.innerHTML = `<div class="flex" style="gap:6px;margin-top:4px;align-items:center" data-lv>
      <span class="tiny muted" style="width:90px">até</span>
      <input class="input lv-teto" type="number" min="1" placeholder="∞" style="width:80px;padding:2px 6px">
      <span class="tiny muted">fechamentos → ×</span><input class="input lv-mult" type="number" min="1" step="0.05" value="1" style="width:80px;padding:2px 6px">
      <button class="btn btn-ghost btn-sm lv-del" type="button" style="color:#dc2626;padding:1px 7px">×</button></div>`;
    const row = d.firstElementChild;
    row.querySelector('.lv-del').onclick = () => row.remove();
    boxV.appendChild(row);
  };
  _root.querySelectorAll('.lv-del').forEach(b => b.onclick = () => b.closest('[data-lv]').remove());
  if ($('#cf-mpsave')) $('#cf-mpsave').onclick = async () => {
    const base = (_d.map && _d.map.origens) || [];
    const origens = [..._root.querySelectorAll('[data-mp]')].map(r => {
      const o = base.find(x => x.id === r.dataset.id) || { id: r.dataset.id, rotulo: r.dataset.id };
      const taxas = {};
      r.querySelectorAll('.mp-t').forEach(i => { taxas[i.dataset.s] = Number(i.value) || 0; });
      return { ...o, taxas };
    });
    if (!origens.length) { alert('Matriz vazia.'); return; }
    const sen = Number($('#cf-mpsen').value) || 3000000;
    const r = await post({ action: 'set_cfg', cfg: { map_origens: origens, map_senior_vgv_min: sen } }, '💾 Matriz MAP salva.');
    if (r) reload();
  };
  if ($('#cf-mpsavemap')) $('#cf-mpsavemap').onclick = async () => {
    const mapa = {};
    _root.querySelectorAll('.cf-mpmap').forEach(s => { if (s.value) mapa[s.dataset.fonte.toLowerCase()] = s.value; });
    const r = await post({ action: 'set_cfg', cfg: { map_mapa_rd: mapa } }, '💾 Mapeamento MAP salvo.');
    if (r) reload();
  };
  if ($('#cf-lsave')) $('#cf-lsave').onclick = async () => {
    const rows = [...boxB.querySelectorAll('[data-lb]')].map(r => {
      const teto = r.querySelector('.lb-teto').value.trim();
      return { teto: teto ? Number(teto) : 999999999, est: Number(r.querySelector('.lb-est').value) || 0, lanc: Number(r.querySelector('.lb-lanc').value) || 0 };
    }).sort((a, b) => a.teto - b.teto);
    if (!rows.length) { alert('Deixe ao menos 1 faixa de VGV.'); return; }
    const estoque = rows.map(r => [r.teto, r.est]);
    const lancamento = rows.map(r => [r.teto, r.lanc]);
    const volume = [...boxV.querySelectorAll('[data-lv]')].map(r => {
      const teto = r.querySelector('.lv-teto').value.trim();
      return [teto ? Number(teto) : 999999, Number(r.querySelector('.lv-mult').value) || 1];
    }).sort((a, b) => a[0] - b[0]);
    if (!volume.length) { alert('Deixe ao menos 1 faixa de volume.'); return; }
    const teto = Number($('#cf-lteto').value) || 0;
    const r = await post({ action: 'set_cfg', cfg: { leire_estoque: estoque, leire_lancamento: lancamento, leire_volume: volume, leire_teto: teto } }, '💾 Tabela da Leire salva.');
    if (r) reload();
  };
}
