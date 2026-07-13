/* PSM-OS v2 — 🎁 Indicação Premiada (v84.24) · Mariane
   Funil da indicação até o prêmio pago, amarrado no RD CRM e nas faixas de
   VGV da config (mesma fonte do Painel de Fiscalização) — faixas editáveis
   pela gestão. Aba 💬 Fluxos de Abordagem: sequências de WhatsApp por origem
   (frio → NPS alto), com copiar 1-clique e edição pela gestão.
   Backend: /api/v3/producao/indicacoes */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _filtro = '', _deals = null, _busy = false, _formAberto = false;
let _aba = 'funil', _editFaixas = false, _editFluxo = null; // id do fluxo em edição | '__novo__'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ST = {
  nova: ['🆕 Nova', '#64748b'], qualificada: ['⭐ Qualificada', '#2563eb'],
  no_crm: ['🔗 No CRM', '#7c3aed'], vendida: ['💰 Vendida — prêmio a pagar', '#d97706'],
  premio_aprovado: ['✔ Prêmio aprovado', '#0891b2'], premio_pago: ['✅ Prêmio pago', '#16a34a'],
  perdida: ['❌ Perdida', '#dc2626'],
};

export async function pageIndicacaoPremiada(ctx, root) { _root = root; await reload(); }

async function reload() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando o funil de indicações…</div></div>';
  try {
    _d = await api.request('/api/v3/producao/indicacoes');
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div>
      <div class="tiny muted mt-1">Se for a 1ª vez: a tabela "indicacoes" precisa da migração no Supabase.</div></div>`;
    return;
  }
  render();
}

async function post(body, okMsg) {
  if (_busy) return;
  _busy = true;
  try {
    const r = await api.request('/api/v3/producao/indicacoes', { method: 'POST', body });
    if (okMsg) {
      let m = okMsg;
      if (r.premio != null) m += ` Prêmio pela faixa: ${brl(r.premio)}.`;
      if (r.premio === null && body.action === 'status' && body.status === 'vendida') m += ' Acima da última faixa — prêmio personalizável.';
      alert(m);
    }
  } catch (e) {
    alert('❌ NÃO SALVOU: ' + e.message);
  }
  _busy = false;
  reload();
}

/* ── Faixas de prêmio (visão + editor da gestão) ─────────────────────────── */
function faixasBox() {
  const fv = _d.faixas_venda || [], fl = _d.faixas_locacao || [];
  if (_editFaixas) return faixasEditor(fv, fl);
  const fmt = ([teto, p], i) => `${i === 0 ? 'até' : ''} ${teto >= 999999999 ? 'acima' : 'R$ ' + Number(teto).toLocaleString('pt-BR')} → <b>${brl(p)}</b>`;
  return `<div class="tiny muted" style="background:var(--bg-3);border-radius:10px;padding:8px 10px">
    <div class="flex items-center" style="gap:8px">
      <b>💰 Faixas de prêmio:</b>
      ${_d.can_edit ? '<button class="btn btn-ghost btn-sm" id="ip-edfaixas" style="padding:1px 8px;font-size:11px;margin-left:auto">✏️ Editar faixas</button>' : ''}
    </div>
    VENDA (por VGV): ${fv.map(fmt).join(' · ')} · acima da última: personalizável<br>
    LOCAÇÃO (por aluguel): ${fl.map(fmt).join(' · ')}
  </div>`;
}

function faixasEditor(fv, fl) {
  const linha = (grupo, [teto, p], i) => `
    <div class="flex items-center" style="gap:6px;margin-top:4px" data-fx-row="${grupo}">
      <span class="tiny muted" style="width:52px">${i === 0 ? 'até' : 'até'}</span>
      <input class="input fx-teto" type="number" min="1" value="${teto}" style="width:130px;padding:3px 8px" title="Teto da faixa (R$)">
      <span class="tiny muted">→ prêmio R$</span>
      <input class="input fx-premio" type="number" min="0" value="${p}" style="width:100px;padding:3px 8px" title="Prêmio (R$)">
      <button class="btn btn-ghost btn-sm fx-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>
    </div>`;
  return `<div style="background:var(--bg-3);border-radius:10px;padding:10px 12px">
    <b class="tiny">✏️ Editar faixas de prêmio</b>
    <div class="tiny muted">Cada linha = "negócio até R$ X → prêmio R$ Y". Tetos em ordem crescente. Na VENDA, valor acima da última faixa fica como prêmio personalizável.</div>
    <div class="tiny mt-2" style="font-weight:800">🏠 VENDA (por VGV)</div>
    <div id="fx-venda">${fv.map((f, i) => linha('venda', f, i)).join('')}</div>
    <button class="btn btn-ghost btn-sm mt-1" id="fx-add-venda" type="button">+ faixa de venda</button>
    <div class="tiny mt-2" style="font-weight:800">🔑 LOCAÇÃO (por aluguel mensal) <span class="muted" style="font-weight:400">— use teto 999999999 na última pra valer "acima de"</span></div>
    <div id="fx-locacao">${fl.map((f, i) => linha('locacao', f, i)).join('')}</div>
    <button class="btn btn-ghost btn-sm mt-1" id="fx-add-locacao" type="button">+ faixa de locação</button>
    <div class="flex gap-2 mt-2" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="fx-cancel" type="button">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="fx-save" type="button">💾 Salvar faixas</button>
    </div>
  </div>`;
}

function wireFaixas() {
  const $ = s => _root.querySelector(s);
  if ($('#ip-edfaixas')) $('#ip-edfaixas').onclick = () => { _editFaixas = true; render(); };
  if (!_editFaixas) return;
  const addRow = grupo => {
    const box = $(`#fx-${grupo}`);
    const div = document.createElement('div');
    div.innerHTML = `<div class="flex items-center" style="gap:6px;margin-top:4px" data-fx-row="${grupo}">
      <span class="tiny muted" style="width:52px">até</span>
      <input class="input fx-teto" type="number" min="1" value="" style="width:130px;padding:3px 8px">
      <span class="tiny muted">→ prêmio R$</span>
      <input class="input fx-premio" type="number" min="0" value="" style="width:100px;padding:3px 8px">
      <button class="btn btn-ghost btn-sm fx-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>
    </div>`;
    const row = div.firstElementChild;
    row.querySelector('.fx-del').onclick = () => row.remove();
    box.appendChild(row);
  };
  $('#fx-add-venda').onclick = () => addRow('venda');
  $('#fx-add-locacao').onclick = () => addRow('locacao');
  _root.querySelectorAll('.fx-del').forEach(b => b.onclick = () => b.closest('[data-fx-row]').remove());
  $('#fx-cancel').onclick = () => { _editFaixas = false; render(); };
  $('#fx-save').onclick = () => {
    const ler = grupo => [..._root.querySelectorAll(`[data-fx-row="${grupo}"]`)]
      .map(r => [Number(r.querySelector('.fx-teto').value), Number(r.querySelector('.fx-premio').value)])
      .filter(([t, p]) => t > 0 && p >= 0);
    const fv = ler('venda'), fl = ler('locacao');
    if (!fv.length || !fl.length) { alert('Deixe ao menos 1 faixa em cada grupo.'); return; }
    _editFaixas = false;
    post({ action: 'set_faixas', faixas_venda: fv, faixas_locacao: fl }, '💰 Faixas atualizadas — já valem pros próximos prêmios.');
  };
}

/* ── Aba 💬 Fluxos de Abordagem (WhatsApp da Mariane) ────────────────────── */
function fluxoCard(f) {
  if (_editFluxo === f.id) return fluxoEditor(f);
  const passo = (p, i) => `
    <div style="border-top:1px solid var(--bd,#eef2f7);padding:8px 0 6px">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <b class="tiny">${i + 1}. ${esc(p.titulo || 'Mensagem')}</b>
        ${p.envio ? `<span class="tiny" style="background:#2563eb1a;color:#2563eb;padding:1px 8px;border-radius:999px">⏱ ${esc(p.envio)}</span>` : ''}
        <button class="btn btn-ghost btn-sm ipf-copy" data-fluxo="${esc(f.id)}" data-passo="${i}" style="margin-left:auto;padding:2px 9px;font-size:11px">📋 Copiar</button>
      </div>
      <div class="tiny" style="white-space:pre-wrap;background:var(--bg-3);border-radius:8px;padding:7px 9px;margin-top:4px">${esc(p.texto)}</div>
    </div>`;
  return `<div class="card" style="margin:0 0 10px;padding:12px 14px">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>${esc(f.emoji || '💬')} ${esc(f.nome)}</b>
      ${_d.can_edit ? `<button class="btn btn-ghost btn-sm ipf-edit" data-id="${esc(f.id)}" style="margin-left:auto;padding:2px 9px;font-size:11px">✏️ Editar</button>` : ''}
    </div>
    ${f.quando_usar ? `<div class="tiny muted" style="margin-top:2px">🎯 ${esc(f.quando_usar)}</div>` : ''}
    <div class="mt-1">${(f.passos || []).map(passo).join('')}</div>
  </div>`;
}

function fluxoEditor(f) {
  const novo = f.id === '__novo__';
  const passoEd = (p, i) => `
    <div style="border-top:1px dashed var(--bd,#e2e8f0);padding:8px 0" data-passo-ed="${i}">
      <div class="flex" style="gap:6px;flex-wrap:wrap">
        <input class="input pe-titulo" value="${esc(p.titulo || '')}" placeholder="Título do passo (ex.: Quebra-gelo)" style="flex:2;min-width:160px;padding:4px 8px">
        <input class="input pe-envio" value="${esc(p.envio || '')}" placeholder="Quando enviar (ex.: manhã / após resposta)" style="flex:1;min-width:150px;padding:4px 8px">
        <button class="btn btn-ghost btn-sm pe-del" type="button" style="color:#dc2626;padding:1px 8px">×</button>
      </div>
      <textarea class="input pe-texto" rows="2" style="margin-top:4px;resize:vertical" placeholder="Mensagem (use {nome} pro nome do cliente)">${esc(p.texto || '')}</textarea>
    </div>`;
  return `<div class="card" style="margin:0 0 10px;padding:12px 14px;border:1px solid #2563eb55" id="ipf-editor">
    <b class="tiny">${novo ? '➕ Novo fluxo' : '✏️ Editando fluxo'}</b>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <input class="input fe-emoji" value="${esc(f.emoji || '💬')}" style="width:58px;padding:4px 8px" title="Emoji">
      <input class="input fe-nome" value="${esc(f.nome || '')}" placeholder="Nome do fluxo (ex.: Base fria MAP)" style="flex:2;min-width:180px;padding:4px 8px">
    </div>
    <input class="input fe-quando mt-1" value="${esc(f.quando_usar || '')}" placeholder="Quando usar este fluxo (situação do cliente)" style="width:100%;padding:4px 8px">
    <div id="fe-passos" class="mt-1">${(f.passos || []).map(passoEd).join('')}</div>
    <button class="btn btn-ghost btn-sm" id="fe-add" type="button">+ passo</button>
    <div class="flex gap-2 mt-2" style="justify-content:flex-end">
      ${!novo ? '<button class="btn btn-ghost btn-sm" id="fe-del" type="button" style="color:#dc2626;margin-right:auto">🗑 Excluir fluxo</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="fe-cancel" type="button">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="fe-save" type="button">💾 Salvar fluxos</button>
    </div>
  </div>`;
}

function htmlFluxos() {
  const fluxos = _d.fluxos || [];
  return `
    <div class="tiny" style="background:#d977061a;color:#a16207;border-radius:10px;padding:8px 10px;font-weight:700">
      💡 Regra de ouro: UMA mensagem por vez, curta e pessoal. Espere a resposta antes do próximo passo — textão mata a conversa.
    </div>
    ${_d.can_edit ? '<div class="flex mt-2" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" id="ipf-novo">➕ Novo fluxo</button></div>' : ''}
    <div class="mt-2">
      ${_editFluxo === '__novo__' ? fluxoEditor({ id: '__novo__', emoji: '💬', nome: '', quando_usar: '', passos: [{ titulo: '', envio: '', texto: '' }] }) : ''}
      ${fluxos.map(fluxoCard).join('') || '<div class="card muted">Nenhum fluxo ainda.</div>'}
    </div>`;
}

function wireFluxos() {
  const $ = s => _root.querySelector(s);
  _root.querySelectorAll('.ipf-copy').forEach(b => b.onclick = async () => {
    const f = (_d.fluxos || []).find(x => x.id === b.dataset.fluxo);
    const p = f?.passos?.[Number(b.dataset.passo)];
    if (!p) return;
    try { await navigator.clipboard.writeText(p.texto); } catch (_) { prompt('Copie a mensagem:', p.texto); return; }
    const old = b.textContent; b.textContent = '✅ Copiado'; setTimeout(() => { b.textContent = old; }, 1400);
  });
  _root.querySelectorAll('.ipf-edit').forEach(b => b.onclick = () => { _editFluxo = b.dataset.id; render(); });
  if ($('#ipf-novo')) $('#ipf-novo').onclick = () => { _editFluxo = '__novo__'; render(); };

  const ed = $('#ipf-editor');
  if (!ed) return;
  const addPasso = () => {
    const box = ed.querySelector('#fe-passos');
    const div = document.createElement('div');
    div.innerHTML = `<div style="border-top:1px dashed var(--bd,#e2e8f0);padding:8px 0" data-passo-ed="x">
      <div class="flex" style="gap:6px;flex-wrap:wrap">
        <input class="input pe-titulo" placeholder="Título do passo" style="flex:2;min-width:160px;padding:4px 8px">
        <input class="input pe-envio" placeholder="Quando enviar" style="flex:1;min-width:150px;padding:4px 8px">
        <button class="btn btn-ghost btn-sm pe-del" type="button" style="color:#dc2626;padding:1px 8px">×</button>
      </div>
      <textarea class="input pe-texto" rows="2" style="margin-top:4px;resize:vertical" placeholder="Mensagem (use {nome})"></textarea>
    </div>`;
    box.appendChild(div.firstElementChild);
  };
  ed.querySelector('#fe-add').onclick = addPasso;
  ed.addEventListener('click', e => {
    if (e.target.classList?.contains('pe-del')) e.target.closest('[data-passo-ed]')?.remove();
  });
  ed.querySelector('#fe-cancel').onclick = () => { _editFluxo = null; render(); };

  const montarESalvar = (removerId) => {
    const fluxos = (_d.fluxos || []).map(f => ({ ...f, passos: (f.passos || []).map(p => ({ ...p })) }));
    let novoFluxo = null;
    if (!removerId) {
      const passos = [...ed.querySelectorAll('[data-passo-ed]')].map(r => ({
        titulo: r.querySelector('.pe-titulo').value.trim(),
        envio: r.querySelector('.pe-envio').value.trim(),
        texto: r.querySelector('.pe-texto').value.trim(),
      })).filter(p => p.texto);
      novoFluxo = {
        id: _editFluxo === '__novo__' ? '' : _editFluxo,
        emoji: ed.querySelector('.fe-emoji').value.trim() || '💬',
        nome: ed.querySelector('.fe-nome').value.trim(),
        quando_usar: ed.querySelector('.fe-quando').value.trim(),
        passos,
      };
      if (!novoFluxo.nome || !passos.length) { alert('Dê um nome ao fluxo e preencha ao menos 1 mensagem.'); return; }
    }
    let final;
    if (removerId) final = fluxos.filter(f => f.id !== removerId);
    else if (_editFluxo === '__novo__') final = [novoFluxo, ...fluxos];
    else final = fluxos.map(f => f.id === _editFluxo ? novoFluxo : f);
    if (!final.length) { alert('Deixe ao menos 1 fluxo.'); return; }
    _editFluxo = null;
    post({ action: 'set_fluxos', fluxos: final }, '💬 Fluxos salvos.');
  };
  ed.querySelector('#fe-save').onclick = () => montarESalvar(null);
  const del = ed.querySelector('#fe-del');
  if (del) del.onclick = () => { if (confirm('Excluir este fluxo inteiro?')) montarESalvar(_editFluxo); };
}

/* ── Funil (aba original) ────────────────────────────────────────────────── */
function botoes(it) {
  const lvl = auth.user()?.lvl || 0;
  const b = [];
  const add = (act, lbl) => b.push(`<button class="btn btn-ghost btn-sm ip-act" data-id="${esc(it.id)}" data-act="${act}" style="padding:2px 8px">${lbl}</button>`);
  if (it.status === 'nova') { add('qualificar', '⭐ Qualificar'); add('vincular', '🔗 Vincular ao RD'); add('perder', '❌'); }
  if (it.status === 'qualificada') { add('vincular', '🔗 Vincular ao RD'); add('vender', '💰 Registrar venda'); add('perder', '❌'); }
  if (it.status === 'no_crm') { add('vender', '💰 Registrar venda'); add('perder', '❌'); }
  if (it.status === 'vendida' && lvl >= 7) add('aprovar', '✔ Aprovar prêmio');
  if (it.status === 'premio_aprovado' && lvl >= 7) add('pagar', '💸 Marcar pago');
  return b.join('');
}

function cardIndicacao(it) {
  const [lbl, cor] = ST[it.status] || [it.status, '#64748b'];
  const deal = it.deal;
  return `<div class="card" style="margin:0 0 8px;padding:10px 12px;border-left:3px solid ${cor}">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>${esc(it.indicador_nome)}</b>
      <span class="tiny muted">indicou</span>
      <b>${esc(it.indicado_nome || '?')}</b>
      <span class="badge" style="background:${cor}22;color:${cor};font-weight:700">${lbl}</span>
      <span class="badge">${it.tipo === 'locacao' ? '🔑 Locação' : '🏠 Venda'}</span>
      ${it.origem === 'nps_promotor' ? '<span class="badge" style="background:#7c3aed22;color:#7c3aed">🌟 promotor NPS</span>' : ''}
      ${it.premio != null ? `<b style="color:#d97706">🎁 ${brl(it.premio)}</b>` : (it.status === 'vendida' ? '<span class="badge" style="background:#d9770622;color:#d97706">prêmio personalizável</span>' : '')}
      <span style="margin-left:auto"></span>
      ${botoes(it)}
    </div>
    <div class="tiny muted" style="margin-top:3px">
      ${it.indicador_contato ? '📱 ' + esc(it.indicador_contato) + ' · ' : ''}
      ${it.valor_negocio ? 'negócio ' + brl(it.valor_negocio) + ' · ' : ''}
      ${deal ? `RD: ${esc(deal.nome || '')} (${deal.win === true ? '🏆 ganho' : deal.win === false ? 'perdido' : esc(deal.estagio || 'aberto')}) · ` : ''}
      ${esc(it.obs || '')}
    </div>
  </div>`;
}

function htmlFunil() {
  const k = _d.kpis || {}, itens = _d.itens || [];
  const vis = _filtro ? itens.filter(i => i.status === _filtro) : itens;
  return `
      <div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">🆕 Novas</div><div style="font-weight:900;font-size:18px">${k.nova || 0}</div></div>
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">⭐ Qualificadas</div><div style="font-weight:900;font-size:18px">${k.qualificada || 0}</div></div>
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">🔗 No CRM</div><div style="font-weight:900;font-size:18px">${k.no_crm || 0}</div></div>
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px;border-left:3px solid #d97706"><div class="tiny muted">💰 Prêmios a pagar</div><div style="font-weight:900;font-size:16px">${brl(k.premio_a_pagar)}</div></div>
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px;border-left:3px solid #16a34a"><div class="tiny muted">✅ Prêmios pagos</div><div style="font-weight:900;font-size:16px">${brl(k.premio_pago)}</div></div>
      </div>
      <div class="flex mt-2" style="gap:5px;flex-wrap:wrap">
        <button class="btn btn-sm ${_filtro === '' ? 'btn-primary' : 'btn-ghost'} ip-f" data-f="">Todas (${itens.length})</button>
        ${Object.entries(ST).map(([s, [lbl]]) => `<button class="btn btn-sm ${_filtro === s ? 'btn-primary' : 'btn-ghost'} ip-f" data-f="${s}" style="padding:3px 9px">${lbl} (${k[s] || 0})</button>`).join('')}
      </div>
      <div class="mt-2" id="ip-faixas">${faixasBox()}</div>
      <div id="ip-form" class="mt-2"></div>
    </div>
    <div class="mt-2">${vis.map(cardIndicacao).join('') || '<div class="card muted">Nenhuma indicação aqui ainda. Registre a primeira — ou puxe os promotores do NPS.</div>'}</div>`;
}

function render() {
  const fluxosAba = _aba === 'fluxos';
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🎁 Indicação Premiada</h2>
        <span class="tiny muted">indicou → qualificou → RD → venda → prêmio pela faixa de VGV · Mariane roda, Isabella atende</span>
        <span style="margin-left:auto"></span>
        ${fluxosAba ? '' : `
        <button class="btn btn-primary btn-sm" id="ip-nova">➕ Nova indicação</button>
        <button class="btn btn-ghost btn-sm" id="ip-prom">🌟 Puxar promotores do NPS</button>
        <button class="btn btn-ghost btn-sm" id="ip-conferir">🔄 Conferir vendas no RD</button>`}
        <button class="btn btn-ghost btn-sm" id="ip-reload">↻</button>
      </div>
      <div class="flex mt-2" style="gap:6px">
        <button class="btn btn-sm ${!fluxosAba ? 'btn-primary' : 'btn-ghost'}" id="ip-aba-funil">🎯 Funil</button>
        <button class="btn btn-sm ${fluxosAba ? 'btn-primary' : 'btn-ghost'}" id="ip-aba-fluxos">💬 Fluxos de abordagem</button>
      </div>
    ${fluxosAba ? htmlFluxos() + '</div>' : htmlFunil()}`;

  _root.querySelector('#ip-reload').onclick = reload;
  _root.querySelector('#ip-aba-funil').onclick = () => { _aba = 'funil'; _editFluxo = null; render(); };
  _root.querySelector('#ip-aba-fluxos').onclick = () => { _aba = 'fluxos'; _editFaixas = false; render(); };
  if (fluxosAba) { wireFluxos(); return; }
  _root.querySelector('#ip-conferir').onclick = () => post({ action: 'conferir_vendas' }, '🔄 Conferido no RD.');
  _root.querySelector('#ip-prom').onclick = () => post({ action: 'puxar_promotores' }, '🌟 Promotores puxados pro funil.');
  _root.querySelectorAll('.ip-f').forEach(b => b.onclick = () => { _filtro = b.dataset.f; render(); });
  _root.querySelector('#ip-nova').onclick = () => { _formAberto = !_formAberto; desenhaForm(); };
  if (_formAberto) desenhaForm();
  _root.querySelectorAll('.ip-act').forEach(b => b.onclick = () => acao(b.dataset.id, b.dataset.act));
  wireFaixas();
}

function desenhaForm() {
  const host = _root.querySelector('#ip-form');
  if (!_formAberto) { host.innerHTML = ''; return; }
  host.innerHTML = `<div style="background:var(--bg-3);border-radius:10px;padding:10px">
    <div class="flex" style="gap:8px;flex-wrap:wrap">
      <input class="input" id="ipf-indicador" placeholder="Quem indicou *" style="flex:1;min-width:160px">
      <input class="input" id="ipf-icontato" placeholder="Contato do indicador (fone)" style="flex:1;min-width:150px">
      <input class="input" id="ipf-indicado" placeholder="Quem foi indicado" style="flex:1;min-width:160px">
      <input class="input" id="ipf-dcontato" placeholder="Contato do indicado" style="flex:1;min-width:150px">
      <select class="input" id="ipf-tipo" style="flex:0 0 auto;width:auto"><option value="venda">🏠 Venda</option><option value="locacao">🔑 Locação</option></select>
      <button class="btn btn-primary btn-sm" id="ipf-salvar">💾 Salvar</button>
    </div>
  </div>`;
  host.querySelector('#ipf-salvar').onclick = () => {
    const v = id => host.querySelector(id).value.trim();
    if (!v('#ipf-indicador')) { alert('Informe quem indicou.'); return; }
    _formAberto = false;
    post({ action: 'upsert', indicador_nome: v('#ipf-indicador'), indicador_contato: v('#ipf-icontato'),
           indicado_nome: v('#ipf-indicado'), indicado_contato: v('#ipf-dcontato'),
           tipo: host.querySelector('#ipf-tipo').value, origem: 'abordagem' }, '✅ Indicação registrada.');
  };
}

async function acao(id, act) {
  if (act === 'qualificar') return post({ action: 'status', id, status: 'qualificada' }, '⭐ Qualificada — contou na Fiscalização.');
  if (act === 'perder') { if (!confirm('Marcar como perdida?')) return; return post({ action: 'status', id, status: 'perdida' }); }
  if (act === 'aprovar') return post({ action: 'status', id, status: 'premio_aprovado' }, '✔ Prêmio aprovado.');
  if (act === 'pagar') { if (!confirm('Confirmar prêmio PAGO?')) return; return post({ action: 'status', id, status: 'premio_pago' }, '💸 Prêmio marcado como pago.'); }
  if (act === 'vender') {
    const v = prompt('Valor do negócio (VGV da venda ou aluguel mensal, só números):');
    if (!v) return;
    return post({ action: 'status', id, status: 'vendida', valor: Number(v) }, '💰 Venda registrada!');
  }
  if (act === 'vincular') {
    if (!_deals) {
      try {
        const r = await api.request('/api/v3/crm/deals?status=aberto&limit=300');
        _deals = (r.deals || r.itens || r.data || []).slice(0, 300);
      } catch (e) { _deals = []; }
    }
    const nome = prompt('Buscar negócio no RD (parte do nome do cliente):');
    if (!nome) return;
    const achados = _deals.filter(d => (d.name || '').toLowerCase().includes(nome.toLowerCase())).slice(0, 8);
    if (!achados.length) { alert('Nenhum negócio aberto com esse nome. Confira no RD.'); return; }
    const lista = achados.map((d, i) => `${i + 1}. ${d.name}${d.amount ? ' · ' + brl(d.amount) : ''}`).join('\n');
    const n = prompt(`Qual deles? (número)\n${lista}`);
    const sel = achados[Number(n) - 1];
    if (!sel) return;
    return post({ action: 'vincular', id, deal_id: sel.id }, '🔗 Vinculada ao RD.');
  }
}
