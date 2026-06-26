/* ============================================================================
   PSM-OS v2 — Backoffice & Adm · v81.93
   Abas: 🛒 Compras (+ controle de estoque) · 🏢 Patrimônio · 🛠 Manutenções
   Backend: /api/v3/adm/registros (shared_kv: adm_compras/estoque/patrimonio/manutencoes)
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const EP = '/api/v3/adm/registros';
const CAT_COMPRA = ['Água & copa', 'Limpeza', 'Escritório / papelaria', 'Equipamentos', 'TI / informática', 'Mobiliário', 'Marketing / brindes', 'Manutenção predial', 'Outro'];
const UNIDADES = ['un', 'cx', 'pct', 'fardo', 'L', 'kg', 'm', 'par'];
const URGENCIA = ['Baixa', 'Média', 'Alta', 'Urgente'];
const PGTO = ['PIX', 'Boleto', 'Cartão corporativo', 'Dinheiro', 'Transferência', 'A combinar'];
const ST_COMPRA = ['solicitado', 'aprovado', 'comprado', 'recebido', 'cancelado'];
const ST_COMPRA_LBL = { solicitado: '🟡 Solicitado', aprovado: '🔵 Aprovado', comprado: '🟣 Comprado', recebido: '🟢 Recebido', cancelado: '⚪ Cancelado' };
const ESTADOS = ['Novo', 'Ótimo', 'Bom', 'Regular', 'Ruim', 'Inservível'];
const ESTADO_COR = { 'Novo': '#16a34a', 'Ótimo': '#16a34a', 'Bom': '#0891b2', 'Regular': '#f59e0b', 'Ruim': '#ef4444', 'Inservível': '#991b1b' };
const CAT_PATR = ['Mobiliário', 'Informática', 'Eletrônicos', 'Veículos', 'Eletrodomésticos', 'Imóvel', 'Decoração', 'Outro'];
const TIPO_MANUT = ['Preventiva', 'Corretiva', 'Instalação', 'Reforma'];
const ST_MANUT = ['solicitada', 'orcamento', 'aprovada', 'em_andamento', 'concluida', 'cancelada'];
const ST_MANUT_LBL = { solicitada: '🟡 Solicitada', orcamento: '🔵 Em orçamento', aprovada: '🟣 Aprovada', em_andamento: '🟠 Em andamento', concluida: '🟢 Concluída', cancelada: '⚪ Cancelada' };

let _adm = { compras: [], estoque: [], patrimonio: [], manutencoes: [] };
let _users = [];
let _loaded = false;
let _comprasTab = 'solicitacoes';   // solicitacoes | estoque

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const optT = (v, sel) => `<option value="${esc(v)}"${v === (sel || '') ? ' selected' : ''}>${esc(v)}</option>`;
const userOpts = sel => '<option value="">—</option>' + _users.map(u => optT(u.name || u.id, sel)).join('');
const fI = (id, lbl, val, ph = '', type = 'text') => `<label class="tiny muted">${lbl}<input id="${id}" class="input" type="${type}" placeholder="${esc(ph)}" value="${esc(val ?? '')}"></label>`;
const fS = (id, lbl, val, opts, blank = '—') => `<label class="tiny muted">${lbl}<select id="${id}" class="select"><option value="">${blank}</option>${opts.map(o => optT(o, val)).join('')}</select></label>`;
const fA = (id, lbl, val, ph = '') => `<label class="tiny muted" style="display:block">${lbl}<textarea id="${id}" class="input" rows="2" placeholder="${esc(ph)}">${esc(val ?? '')}</textarea></label>`;
const grid = h => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">${h}</div>`;

async function ensure(root) {
  if (_loaded) return true;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const [r, u] = await Promise.all([api.request(EP), api.listUsers().catch(() => ({ users: [] }))]);
    _adm = { compras: r.compras || [], estoque: r.estoque || [], patrimonio: r.patrimonio || [], manutencoes: r.manutencoes || [] };
    _users = (u && u.users) || [];
    _loaded = true; return true;
  } catch (e) { root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return false; }
}

async function save(modulo, registro) {
  const r = await api.request(EP, { method: 'POST', body: { action: 'upsert', modulo, registro } });
  if (r[modulo]) _adm[modulo] = r[modulo];
  return r;
}
async function del(modulo, id) {
  const r = await api.request(EP, { method: 'POST', body: { action: 'delete', modulo, id } });
  if (r[modulo]) _adm[modulo] = r[modulo];
}
function modal(html) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow:auto';
  ov.innerHTML = `<div class="card" style="max-width:600px;width:100%;margin:auto">${html}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  return ov;
}

/* ═══════════════════ 🛒 COMPRAS + ESTOQUE ═══════════════════ */
export async function pageCompras(ctx, root) {
  if (!await ensure(root)) return;
  renderCompras(root);
}
function renderCompras(root) {
  const c = _adm.compras, est = _adm.estoque;
  const baixo = est.filter(e => Number(e.qtd_atual) <= Number(e.qtd_minima || 0)).length;
  const abertas = c.filter(x => !['recebido', 'cancelado'].includes(x.status)).length;
  root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><h2 class="card-title" style="margin:0">🛒 Compras</h2>
          <p class="card-sub">Solicitações de compra (água, limpeza, equipamentos…) + controle de estoque com alerta de reposição.</p></div>
      </div>
      <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
        <button class="btn ${_comprasTab === 'solicitacoes' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-ct="solicitacoes">🛒 Solicitações (${abertas} abertas)</button>
        <button class="btn ${_comprasTab === 'estoque' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-ct="estoque">📦 Estoque ${baixo ? `<span style="color:#ef4444">· ${baixo} p/ repor</span>` : ''}</button>
      </div>
      <div id="adm-body" class="mt-3"></div>
    </div>`;
  root.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { _comprasTab = b.dataset.ct; renderCompras(root); });
  const body = root.querySelector('#adm-body');
  if (_comprasTab === 'estoque') return renderEstoque(body, root);
  // solicitações
  body.innerHTML = `
    <button class="btn btn-primary btn-sm" id="cp-new">➕ Nova solicitação</button>
    <div class="mt-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
      ${c.length ? c.map(compraCard).join('') : '<div class="muted tiny">Nenhuma solicitação ainda.</div>'}
    </div>`;
  body.querySelector('#cp-new').onclick = () => editCompra(root, null);
  body.querySelectorAll('[data-cp]').forEach(el => el.onclick = () => editCompra(root, c.find(x => x.id === el.dataset.cp)));
}
function compraCard(r) {
  return `<div class="card" style="padding:12px;cursor:pointer;border-left:4px solid #2563eb" data-cp="${esc(r.id)}">
    <div class="flex items-center" style="justify-content:space-between;gap:6px">
      <div style="font-weight:800;font-size:13.5px">${esc(r.item || '—')}</div>
      <span class="tiny" style="font-weight:700">${ST_COMPRA_LBL[r.status] || r.status || ''}</span></div>
    <div class="tiny muted" style="margin:3px 0">${esc(r.qtd || '')} ${esc(r.unidade || '')} · ${esc(r.categoria || '')}${r.urgencia ? ' · ' + esc(r.urgencia) : ''}</div>
    <div class="tiny">${r.valor_estimado ? '~' + money(r.valor_estimado) : ''}${r.valor_final ? ' → <b>' + money(r.valor_final) + '</b>' : ''}</div>
    ${r.responsavel_compra ? `<div class="tiny muted">👤 ${esc(r.responsavel_compra)}${r.metodo_pagto ? ' · ' + esc(r.metodo_pagto) : ''}</div>` : ''}
  </div>`;
}
function editCompra(root, r0) {
  const r = r0 ? { ...r0 } : { status: 'solicitado', solicitante: auth.user()?.name || '' };
  const ov = modal(`
    <div class="flex" style="justify-content:space-between;align-items:center"><h3 class="card-title" style="margin:0">${r.id ? 'Editar' : 'Nova'} solicitação de compra</h3><button class="btn btn-ghost btn-sm" id="x">✕</button></div>
    ${grid(`
      ${fI('f-item', 'Item *', r.item, 'ex.: Galão de água 20L')}
      ${fS('f-categoria', 'Categoria', r.categoria, CAT_COMPRA)}
      ${fI('f-qtd', 'Quantidade', r.qtd, 'ex.: 10', 'number')}
      ${fS('f-unidade', 'Unidade', r.unidade, UNIDADES)}
      ${fS('f-urgencia', 'Urgência', r.urgencia, URGENCIA)}
      ${fI('f-fornecedor', 'Fornecedor', r.fornecedor)}
      ${fS('f-responsavel_compra', 'Responsável pela compra', r.responsavel_compra, _users.map(u => u.name || u.id))}
      ${fS('f-metodo_pagto', 'Método de pagamento', r.metodo_pagto, PGTO)}
      ${fI('f-valor_estimado', 'Valor estimado (R$)', r.valor_estimado, '0,00', 'number')}
      ${fI('f-valor_final', 'Valor final (R$)', r.valor_final, '0,00', 'number')}
      ${fS('f-status', 'Status', r.status, ST_COMPRA, 'solicitado')}
    `)}
    ${fA('f-obs', 'Observações', r.obs)}
    <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="sv">💾 Salvar</button>${r.id ? '<button class="btn btn-ghost" id="dl" style="margin-left:auto;color:#dc2626">🗑 Excluir</button>' : ''}</div>`);
  const g = id => ov.querySelector('#' + id).value.trim();
  ov.querySelector('#x').onclick = () => ov.remove();
  ov.querySelector('#sv').onclick = async () => {
    const item = g('f-item'); if (!item) return alert('Item obrigatório.');
    const reg = { id: r.id, item, categoria: g('f-categoria'), qtd: g('f-qtd'), unidade: g('f-unidade'), urgencia: g('f-urgencia'), fornecedor: g('f-fornecedor'), responsavel_compra: g('f-responsavel_compra'), metodo_pagto: g('f-metodo_pagto'), valor_estimado: g('f-valor_estimado'), valor_final: g('f-valor_final'), status: g('f-status') || 'solicitado', obs: g('f-obs'), solicitante: r.solicitante || auth.user()?.name || '' };
    try { await save('compras', reg); ov.remove(); renderCompras(root); } catch (e) { alert('Erro: ' + e.message); }
  };
  const dl = ov.querySelector('#dl'); if (dl) dl.onclick = async () => { if (!confirm('Excluir?')) return; try { await del('compras', r.id); ov.remove(); renderCompras(root); } catch (e) { alert(e.message); } };
}

function renderEstoque(body, root) {
  const est = _adm.estoque;
  body.innerHTML = `
    <button class="btn btn-primary btn-sm" id="es-new">➕ Item de estoque</button>
    <div class="mt-3" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:620px">
      <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:8px">Item</th><th style="padding:8px">Atual</th><th style="padding:8px">Mín.</th><th style="text-align:left;padding:8px">Local</th><th style="text-align:left;padding:8px">Responsável</th><th></th></tr></thead>
      <tbody>${est.length ? est.map(e => {
        const low = Number(e.qtd_atual) <= Number(e.qtd_minima || 0);
        return `<tr style="border-bottom:1px solid var(--bd)${low ? ';background:#fef2f2' : ''}">
          <td style="padding:8px"><b>${esc(e.item || '—')}</b> <span class="tiny muted">${esc(e.categoria || '')}</span>${low ? ' <span class="tiny" style="color:#ef4444;font-weight:800">⚠ REPOR</span>' : ''}</td>
          <td style="padding:8px;text-align:center;font-weight:700">${esc(e.qtd_atual || 0)} ${esc(e.unidade || '')}</td>
          <td style="padding:8px;text-align:center" class="tiny muted">${esc(e.qtd_minima || 0)}</td>
          <td style="padding:8px">${esc(e.local || '—')}</td>
          <td style="padding:8px">${esc(e.responsavel || '—')}</td>
          <td style="padding:8px;text-align:right;white-space:nowrap">
            ${low ? `<button class="btn btn-ghost btn-sm" data-es-buy="${esc(e.id)}" title="Solicitar compra">🛒</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-es="${esc(e.id)}">✏️</button></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="muted tiny" style="text-align:center;padding:20px">Nenhum item no estoque.</td></tr>'}</tbody></table></div>`;
  body.querySelector('#es-new').onclick = () => editEstoque(root, null);
  body.querySelectorAll('[data-es]').forEach(b => b.onclick = () => editEstoque(root, est.find(x => x.id === b.dataset.es)));
  body.querySelectorAll('[data-es-buy]').forEach(b => b.onclick = () => {
    const e = est.find(x => x.id === b.dataset.esBuy);
    _comprasTab = 'solicitacoes'; renderCompras(root);
    editCompra(root, { item: e.item, categoria: e.categoria, unidade: e.unidade, status: 'solicitado', obs: 'Reposição de estoque (mín. ' + (e.qtd_minima || 0) + ').' });
  });
}
function editEstoque(root, r0) {
  const r = r0 ? { ...r0 } : {};
  const ov = modal(`
    <div class="flex" style="justify-content:space-between;align-items:center"><h3 class="card-title" style="margin:0">${r.id ? 'Editar' : 'Novo'} item de estoque</h3><button class="btn btn-ghost btn-sm" id="x">✕</button></div>
    ${grid(`
      ${fI('e-item', 'Item *', r.item, 'ex.: Água 20L')}
      ${fS('e-categoria', 'Categoria', r.categoria, CAT_COMPRA)}
      ${fI('e-qtd_atual', 'Qtd atual', r.qtd_atual, '0', 'number')}
      ${fI('e-qtd_minima', 'Qtd mínima (alerta)', r.qtd_minima, '0', 'number')}
      ${fS('e-unidade', 'Unidade', r.unidade, UNIDADES)}
      ${fI('e-local', 'Local', r.local, 'ex.: Copa / Almoxarifado')}
      ${fS('e-responsavel', 'Responsável', r.responsavel, _users.map(u => u.name || u.id))}
    `)}
    ${fA('e-obs', 'Observações', r.obs)}
    <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="sv">💾 Salvar</button>${r.id ? '<button class="btn btn-ghost" id="dl" style="margin-left:auto;color:#dc2626">🗑 Excluir</button>' : ''}</div>`);
  const g = id => ov.querySelector('#' + id).value.trim();
  ov.querySelector('#x').onclick = () => ov.remove();
  ov.querySelector('#sv').onclick = async () => {
    const item = g('e-item'); if (!item) return alert('Item obrigatório.');
    const reg = { id: r.id, item, categoria: g('e-categoria'), qtd_atual: g('e-qtd_atual'), qtd_minima: g('e-qtd_minima'), unidade: g('e-unidade'), local: g('e-local'), responsavel: g('e-responsavel'), obs: g('e-obs') };
    try { await save('estoque', reg); ov.remove(); renderCompras(root); } catch (e) { alert('Erro: ' + e.message); }
  };
  const dl = ov.querySelector('#dl'); if (dl) dl.onclick = async () => { if (!confirm('Excluir?')) return; try { await del('estoque', r.id); ov.remove(); renderCompras(root); } catch (e) { alert(e.message); } };
}

/* ═══════════════════ 🏢 PATRIMÔNIO ═══════════════════ */
export async function pagePatrimonio(ctx, root) {
  if (!await ensure(root)) return;
  renderPatrimonio(root);
}
function renderPatrimonio(root) {
  const p = _adm.patrimonio;
  const total = p.reduce((a, x) => a + (Number(x.valor_estimado) || 0), 0);
  root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><h2 class="card-title" style="margin:0">🏢 Patrimônio</h2>
          <p class="card-sub">Equipamentos, mobiliário e bens da empresa — valor, código e estado de conservação.</p></div>
        <button class="btn btn-primary btn-sm" id="pt-new">➕ Novo bem</button>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <div class="card" style="padding:10px 14px"><div class="tiny muted">Itens</div><div style="font-size:20px;font-weight:800">${p.length}</div></div>
        <div class="card" style="padding:10px 14px"><div class="tiny muted">Valor estimado total</div><div style="font-size:20px;font-weight:800;color:#16a34a">${money(total)}</div></div>
      </div>
      <div class="mt-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px">
        ${p.length ? p.map(patrCard).join('') : '<div class="muted tiny">Nenhum bem cadastrado.</div>'}
      </div>
    </div>`;
  root.querySelector('#pt-new').onclick = () => editPatr(root, null);
  root.querySelectorAll('[data-pt]').forEach(el => el.onclick = () => editPatr(root, p.find(x => x.id === el.dataset.pt)));
}
function patrCard(r) {
  const cor = ESTADO_COR[r.estado_conservacao] || '#64748b';
  return `<div class="card" style="padding:12px;cursor:pointer;border-left:4px solid ${cor}" data-pt="${esc(r.id)}">
    <div class="flex items-center" style="justify-content:space-between;gap:6px">
      <div style="font-weight:800;font-size:13.5px">${esc(r.nome || '—')}</div>
      ${r.estado_conservacao ? `<span style="background:${cor}1a;color:${cor};font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px">${esc(r.estado_conservacao)}</span>` : ''}</div>
    <div class="tiny muted" style="margin:3px 0">${esc(r.categoria || '')}${r.codigo ? ' · 🏷 ' + esc(r.codigo) : ''}</div>
    <div class="tiny">${r.valor_estimado ? '<b>' + money(r.valor_estimado) + '</b>' : ''}${r.local ? ' · 📍 ' + esc(r.local) : ''}</div>
    ${r.responsavel ? `<div class="tiny muted">👤 ${esc(r.responsavel)}</div>` : ''}
  </div>`;
}
function editPatr(root, r0) {
  const r = r0 ? { ...r0 } : {};
  const ov = modal(`
    <div class="flex" style="justify-content:space-between;align-items:center"><h3 class="card-title" style="margin:0">${r.id ? 'Editar' : 'Novo'} bem</h3><button class="btn btn-ghost btn-sm" id="x">✕</button></div>
    ${grid(`
      ${fI('p-nome', 'Nome / descrição *', r.nome, 'ex.: Notebook Dell i7')}
      ${fS('p-categoria', 'Categoria', r.categoria, CAT_PATR)}
      ${fI('p-codigo', 'Código de identificação', r.codigo, 'ex.: PSM-NB-014')}
      ${fI('p-valor_estimado', 'Valor estimado (R$)', r.valor_estimado, '0,00', 'number')}
      ${fS('p-estado_conservacao', 'Estado de conservação', r.estado_conservacao, ESTADOS)}
      ${fI('p-local', 'Local', r.local, 'ex.: Sala comercial')}
      ${fS('p-responsavel', 'Responsável', r.responsavel, _users.map(u => u.name || u.id))}
      ${fI('p-data_aquisicao', 'Data de aquisição', r.data_aquisicao, '', 'date')}
      ${fI('p-nota_url', 'Nota fiscal (link)', r.nota_url, 'Drive / URL')}
    `)}
    ${fA('p-obs', 'Observações', r.obs)}
    <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="sv">💾 Salvar</button>${r.id ? '<button class="btn btn-ghost" id="dl" style="margin-left:auto;color:#dc2626">🗑 Excluir</button>' : ''}</div>`);
  const g = id => ov.querySelector('#' + id).value.trim();
  ov.querySelector('#x').onclick = () => ov.remove();
  ov.querySelector('#sv').onclick = async () => {
    const nome = g('p-nome'); if (!nome) return alert('Nome obrigatório.');
    const reg = { id: r.id, nome, categoria: g('p-categoria'), codigo: g('p-codigo'), valor_estimado: g('p-valor_estimado'), estado_conservacao: g('p-estado_conservacao'), local: g('p-local'), responsavel: g('p-responsavel'), data_aquisicao: g('p-data_aquisicao'), nota_url: g('p-nota_url'), obs: g('p-obs') };
    try { await save('patrimonio', reg); ov.remove(); renderPatrimonio(root); } catch (e) { alert('Erro: ' + e.message); }
  };
  const dl = ov.querySelector('#dl'); if (dl) dl.onclick = async () => { if (!confirm('Excluir?')) return; try { await del('patrimonio', r.id); ov.remove(); renderPatrimonio(root); } catch (e) { alert(e.message); } };
}

/* ═══════════════════ 🛠 MANUTENÇÕES ═══════════════════ */
export async function pageManutencoes(ctx, root) {
  if (!await ensure(root)) return;
  renderManut(root);
}
function renderManut(root) {
  const m = _adm.manutencoes;
  const abertas = m.filter(x => !['concluida', 'cancelada'].includes(x.status)).length;
  root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><h2 class="card-title" style="margin:0">🛠 Manutenções</h2>
          <p class="card-sub">Solicite manutenções, colete orçamentos, aprove e acompanhe. ${abertas} em aberto.</p></div>
        <button class="btn btn-primary btn-sm" id="mt-new">➕ Nova manutenção</button>
      </div>
      <div class="mt-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px">
        ${m.length ? m.map(manutCard).join('') : '<div class="muted tiny">Nenhuma manutenção ainda.</div>'}
      </div>
    </div>`;
  root.querySelector('#mt-new').onclick = () => editManut(root, null);
  root.querySelectorAll('[data-mt]').forEach(el => el.onclick = () => editManut(root, m.find(x => x.id === el.dataset.mt)));
}
function manutCard(r) {
  const orc = Array.isArray(r.orcamentos) ? r.orcamentos : [];
  return `<div class="card" style="padding:12px;cursor:pointer;border-left:4px solid #ea580c" data-mt="${esc(r.id)}">
    <div class="flex items-center" style="justify-content:space-between;gap:6px">
      <div style="font-weight:800;font-size:13.5px">${esc(r.equipamento || '—')}</div>
      <span class="tiny" style="font-weight:700">${ST_MANUT_LBL[r.status] || r.status || ''}</span></div>
    <div class="tiny muted" style="margin:3px 0">${esc(r.tipo || '')}${r.urgencia ? ' · ' + esc(r.urgencia) : ''}${r.descricao ? ' · ' + esc(r.descricao).slice(0, 50) : ''}</div>
    <div class="tiny">${orc.length ? '📄 ' + orc.length + ' orçamento(s)' : ''}${r.valor_aprovado ? ' · ✅ ' + money(r.valor_aprovado) : ''}</div>
    ${r.responsavel ? `<div class="tiny muted">👤 ${esc(r.responsavel)}</div>` : ''}
  </div>`;
}
let _orcEdit = [];
function editManut(root, r0) {
  const r = r0 ? JSON.parse(JSON.stringify(r0)) : { status: 'solicitada' };
  _orcEdit = Array.isArray(r.orcamentos) ? r.orcamentos.map(o => ({ ...o })) : [];
  const ov = modal('');
  const drawOrc = () => `<div id="orc-rows">${_orcEdit.map((o, i) => `
      <div class="flex gap-2" style="align-items:center;margin-bottom:5px;${o.escolhido ? 'background:#16a34a14;border-radius:6px;padding:3px' : ''}">
        <input class="input orc-forn" data-i="${i}" placeholder="Fornecedor" value="${esc(o.fornecedor || '')}" style="flex:1">
        <input class="input orc-val" data-i="${i}" type="number" placeholder="R$" value="${esc(o.valor || '')}" style="width:90px">
        <input class="input orc-link" data-i="${i}" placeholder="link" value="${esc(o.link || '')}" style="width:90px">
        <button class="btn ${o.escolhido ? 'btn-primary' : 'btn-ghost'} btn-sm orc-pick" data-i="${i}" type="button" title="Escolher">✓</button>
        <button class="btn btn-ghost btn-sm orc-del" data-i="${i}" type="button">🗑</button>
      </div>`).join('')}</div>`;
  const render = () => {
    ov.querySelector('.card').innerHTML = `
      <div class="flex" style="justify-content:space-between;align-items:center"><h3 class="card-title" style="margin:0">${r.id ? 'Editar' : 'Nova'} manutenção</h3><button class="btn btn-ghost btn-sm" id="x">✕</button></div>
      ${grid(`
        ${fI('m-equipamento', 'Equipamento / local *', r.equipamento, 'ex.: Ar-condicionado sala 2')}
        ${fS('m-tipo', 'Tipo', r.tipo, TIPO_MANUT)}
        ${fS('m-urgencia', 'Urgência', r.urgencia, URGENCIA)}
        ${fS('m-status', 'Status', r.status, ST_MANUT, 'solicitada')}
        ${fS('m-responsavel', 'Responsável', r.responsavel, _users.map(u => u.name || u.id))}
        ${fI('m-data', 'Data', r.data, '', 'date')}
      `)}
      ${fA('m-descricao', 'Descrição do problema/serviço', r.descricao)}
      <div style="font-weight:700;font-size:12.5px;margin:10px 0 5px">📄 Orçamentos <span class="tiny muted">(marque ✓ no escolhido)</span></div>
      ${drawOrc()}
      <button class="btn btn-ghost btn-sm mt-1" id="orc-add" type="button">+ Orçamento</button>
      <div class="tiny muted" style="margin-top:6px">Valor aprovado: <b id="m-aprov">${r.valor_aprovado ? money(r.valor_aprovado) : '—'}</b></div>
      ${fA('m-obs', 'Observações', r.obs)}
      <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="sv">💾 Salvar</button>${r.id ? '<button class="btn btn-ghost" id="dl" style="margin-left:auto;color:#dc2626">🗑 Excluir</button>' : ''}</div>`;
    bind();
  };
  const captureOrc = () => {
    ov.querySelectorAll('.orc-forn').forEach(inp => { const i = +inp.dataset.i; if (_orcEdit[i]) _orcEdit[i].fornecedor = inp.value; });
    ov.querySelectorAll('.orc-val').forEach(inp => { const i = +inp.dataset.i; if (_orcEdit[i]) _orcEdit[i].valor = inp.value; });
    ov.querySelectorAll('.orc-link').forEach(inp => { const i = +inp.dataset.i; if (_orcEdit[i]) _orcEdit[i].link = inp.value; });
  };
  const bind = () => {
    ov.querySelector('#x').onclick = () => ov.remove();
    ov.querySelector('#orc-add').onclick = () => { captureOrc(); _orcEdit.push({ fornecedor: '', valor: '', link: '', escolhido: false }); render(); };
    ov.querySelectorAll('.orc-del').forEach(b => b.onclick = () => { captureOrc(); _orcEdit.splice(+b.dataset.i, 1); render(); });
    ov.querySelectorAll('.orc-pick').forEach(b => b.onclick = () => { captureOrc(); _orcEdit.forEach((o, i) => o.escolhido = (i === +b.dataset.i ? !o.escolhido : false)); render(); });
    ov.querySelector('#sv').onclick = saveM;
    const dl = ov.querySelector('#dl'); if (dl) dl.onclick = async () => { if (!confirm('Excluir?')) return; try { await del('manutencoes', r.id); ov.remove(); renderManut(root); } catch (e) { alert(e.message); } };
  };
  const saveM = async () => {
    captureOrc();
    const g = id => ov.querySelector('#' + id).value.trim();
    const equip = g('m-equipamento'); if (!equip) return alert('Equipamento obrigatório.');
    const chosen = _orcEdit.find(o => o.escolhido);
    const reg = { id: r.id, equipamento: equip, tipo: g('m-tipo'), urgencia: g('m-urgencia'), status: g('m-status') || 'solicitada', responsavel: g('m-responsavel'), data: g('m-data'), descricao: g('m-descricao'), obs: g('m-obs'), orcamentos: _orcEdit.filter(o => (o.fornecedor || '').trim() || o.valor), valor_aprovado: chosen ? chosen.valor : (r.valor_aprovado || '') };
    try { await save('manutencoes', reg); ov.remove(); renderManut(root); } catch (e) { alert('Erro: ' + e.message); }
  };
  render();
}
