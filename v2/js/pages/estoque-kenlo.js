/* PSM-OS v2 — 🏠 Estoque Kenlo (v84.11)
   Os anúncios publicados no Kenlo Imob DENTRO do House, via Kenlo Open API
   (sync diário → tabela kenlo_imoveis). 3 abas:
   📦 Estoque (busca/filtros) · 🔴 Desatualizados (pauta Leire/Guilherme) ·
   🤝 Match CRM (casa lead do RD com o estoque).
   Backend: /api/v3/kenlo/estoque (lista+match) e /api/v3/kenlo/sync (lvl>=5). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _aba = 'estoque', _q = '', _transacao = '', _ordem = 'atualizado', _busy = false;
let _match = null, _matchQ = '', _deals = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function pageEstoqueKenlo(ctx, root) {
  _root = root;
  await reload();
}

async function reload() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Puxando o estoque do Kenlo…</div></div>';
  try {
    const qs = new URLSearchParams({ q: _q, transacao: _transacao, ordem: _ordem, pageSize: '400' });
    _d = await api.request('/api/v3/kenlo/estoque?' + qs);
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div>
      <div class="tiny muted mt-1">Se for a 1ª vez: o estoque precisa de 1 sync (⚙ sócio) ou aguarde o cron diário das 05:00.</div></div>`;
    return;
  }
  render();
}

function badgeDias(d) {
  if (d == null) return '';
  const cor = d > 180 ? '#dc2626' : d > 90 ? '#d97706' : '#16a34a';
  return `<span class="badge" style="background:${cor}22;color:${cor};font-weight:700">⏱ ${d}d</span>`;
}

function cardImovel(im, extra = '') {
  const preco = im.preco_venda ? brl(im.preco_venda) : (im.preco_locacao ? brl(im.preco_locacao) + '/mês' : '—');
  const foto = im.foto_capa
    ? `<img src="${esc(im.foto_capa)}" loading="lazy" style="width:86px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">`
    : `<div style="width:86px;height:64px;border-radius:8px;background:var(--bg-3);display:flex;align-items:center;justify-content:center;flex-shrink:0" class="muted">📷?</div>`;
  return `<div class="card" style="margin:0 0 8px;padding:10px 12px">
    <div class="flex" style="gap:10px">
      ${foto}
      <div style="flex:1;min-width:0">
        <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
          <span class="badge" style="font-weight:800">${esc(im.property_code || '?')}</span>
          <b style="font-size:13px">${preco}</b>
          ${badgeDias(im.dias_sem_atualizar)}
          ${!im.n_fotos ? '<span class="badge" style="background:#dc262622;color:#dc2626">sem foto</span>' : `<span class="tiny muted">📷 ${im.n_fotos}</span>`}
          ${extra}
        </div>
        <div class="tiny" style="margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(im.titulo || '')}</div>
        <div class="tiny muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📍 ${esc([im.bairro, im.cidade].filter(Boolean).join(', ') || im.endereco || '')}</div>
      </div>
    </div>
  </div>`;
}

function render() {
  const k = _d.kpis || {};
  const me = auth.user();
  const canSync = (me?.lvl || 0) >= 5;
  const ultima = _d.ultima_sync ? new Date(_d.ultima_sync).toLocaleString('pt-BR') : 'nunca';
  const abas = [['estoque', '📦 Estoque'], ['desatualizados', `🔴 Desatualizados (${k.desat_90 || 0})`], ['match', '🤝 Match CRM']];
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🏠 Estoque Kenlo</h2>
        <span class="tiny muted">anúncios publicados no Kenlo Imob · sync diário 05:00 · última: ${esc(ultima)}</span>
        <span style="margin-left:auto"></span>
        ${canSync ? '<button class="btn btn-ghost btn-sm" id="ek-sync">🔄 Sincronizar agora</button>' : ''}
        <button class="btn btn-ghost btn-sm" id="ek-reload">↻</button>
      </div>
      <div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">📦 No ar</div><div style="font-size:19px;font-weight:900">${k.total || 0}</div></div>
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px;border-left:3px solid #d97706"><div class="tiny muted">⏱ 90d+ sem atualizar</div><div style="font-size:19px;font-weight:900">${k.desat_90 || 0}</div></div>
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px;border-left:3px solid #dc2626"><div class="tiny muted">🚨 180d+</div><div style="font-size:19px;font-weight:900">${k.desat_180 || 0}</div></div>
        <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">📷 Sem foto</div><div style="font-size:19px;font-weight:900">${k.sem_foto || 0}</div></div>
        <div style="flex:2;min-width:200px;background:var(--bg-3);border-radius:10px;padding:8px 10px"><div class="tiny muted">💰 Valor de venda somado</div><div style="font-size:16px;font-weight:900">${brl(k.valor_venda)}</div></div>
      </div>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        ${abas.map(([id, lbl]) => `<button class="btn btn-sm ek-aba ${_aba === id ? 'btn-primary' : 'btn-ghost'}" data-aba="${id}">${lbl}</button>`).join('')}
      </div>
    </div>
    <div id="ek-corpo" class="mt-2"></div>`;
  _root.querySelectorAll('.ek-aba').forEach(b => b.onclick = () => { _aba = b.dataset.aba; render(); });
  _root.querySelector('#ek-reload').onclick = reload;
  const bs = _root.querySelector('#ek-sync');
  if (bs) bs.onclick = doSync;
  const corpo = _root.querySelector('#ek-corpo');
  if (_aba === 'estoque') renderEstoque(corpo);
  else if (_aba === 'desatualizados') renderDesatualizados(corpo);
  else renderMatch(corpo);
}

function renderEstoque(corpo) {
  const itens = _d.itens || [];
  corpo.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <input class="input" id="ek-q" placeholder="🔎 buscar por código, título, bairro, cidade…" value="${esc(_q)}" style="flex:2;min-width:200px">
        <select class="input" id="ek-tr" style="flex:0 0 auto;width:auto">
          <option value="" ${_transacao === '' ? 'selected' : ''}>Venda + Locação</option>
          <option value="venda" ${_transacao === 'venda' ? 'selected' : ''}>Só venda</option>
          <option value="locacao" ${_transacao === 'locacao' ? 'selected' : ''}>Só locação</option>
        </select>
        <select class="input" id="ek-ord" style="flex:0 0 auto;width:auto">
          <option value="atualizado" ${_ordem === 'atualizado' ? 'selected' : ''}>Mais parados primeiro</option>
          <option value="preco" ${_ordem === 'preco' ? 'selected' : ''}>Maior preço</option>
          <option value="codigo" ${_ordem === 'codigo' ? 'selected' : ''}>Código</option>
        </select>
        <span class="tiny muted">${_d.total || 0} imóveis</span>
      </div>
    </div>
    <div class="mt-2">${itens.map(im => cardImovel(im)).join('') || '<div class="card muted">Nada encontrado. Ajuste a busca — ou rode a 1ª sincronização.</div>'}</div>`;
  const inp = corpo.querySelector('#ek-q');
  let t = null;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(() => { _q = inp.value; reload(); }, 450); };
  corpo.querySelector('#ek-tr').onchange = e => { _transacao = e.target.value; reload(); };
  corpo.querySelector('#ek-ord').onchange = e => { _ordem = e.target.value; reload(); };
}

function renderDesatualizados(corpo) {
  const itens = (_d.itens || []).filter(i => (i.dias_sem_atualizar || 0) > 90);
  corpo.innerHTML = `
    <div class="card">
      <b>📋 Pauta de atualização</b>
      <div class="tiny muted mt-1">Anúncio parado não vende: preço velho, foto velha, portal derruba relevância.
      Ordem = mais parado primeiro. <b>Leire</b> revisa preço/descrição no Kenlo · <b>Guilherme (Estúdio)</b> refaz foto/vídeo dos sem mídia.</div>
    </div>
    <div class="mt-2">${itens.map(im => cardImovel(im)).join('') || '<div class="card">✅ Nenhum anúncio parado há mais de 90 dias.</div>'}</div>`;
}

async function renderMatch(corpo) {
  corpo.innerHTML = `
    <div class="card">
      <b>🤝 Casar lead com o estoque</b>
      <div class="tiny muted mt-1">Escolha um lead do CRM (ou descreva o que o cliente procura) — o House pontua os ${_d.total || 0} imóveis do Kenlo por tipo, dorms, região e verba.</div>
      <div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
        <select class="input" id="ek-deal" style="flex:2;min-width:220px"><option value="">— escolher lead do CRM (em aberto) —</option></select>
        <span class="tiny muted" style="align-self:center">ou</span>
        <input class="input" id="ek-mq" placeholder='texto livre: ex. "apartamento 3 dorms Iguatemi até 700 mil"' value="${esc(_matchQ)}" style="flex:3;min-width:220px">
        <button class="btn btn-primary btn-sm" id="ek-go">🔍 Buscar match</button>
      </div>
    </div>
    <div id="ek-mres" class="mt-2">${_match ? '' : '<div class="card muted tiny">Os resultados aparecem aqui, com o motivo de cada match.</div>'}</div>`;
  const sel = corpo.querySelector('#ek-deal');
  if (!_deals) {
    try {
      const r = await api.request('/api/v3/crm/deals?status=aberto&limit=300');
      _deals = (r.deals || r.itens || r.data || []).slice(0, 300);
    } catch (e) { _deals = []; }
  }
  sel.innerHTML = '<option value="">— escolher lead do CRM (em aberto) —</option>' +
    _deals.map(d => `<option value="${esc(d.id)}">${esc((d.name || '?').slice(0, 60))}${d.amount ? ' · ' + brl(d.amount) : ''}</option>`).join('');
  const go = async () => {
    const dealId = sel.value, q = corpo.querySelector('#ek-mq').value.trim();
    _matchQ = q;
    if (!dealId && !q) return;
    const res = corpo.querySelector('#ek-mres');
    res.innerHTML = '<div class="card"><span class="spinner"></span> Pontuando o estoque…</div>';
    try {
      const qs = dealId ? 'deal_id=' + encodeURIComponent(dealId) : 'q=' + encodeURIComponent(q);
      _match = await api.request('/api/v3/kenlo/estoque?modo=match&' + qs);
    } catch (e) { res.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`; return; }
    const cr = _match.criterios || {};
    const crTxt = [cr.tipos?.length ? 'tipo: ' + cr.tipos.join('/') : null, cr.dorms ? cr.dorms + ' dorms' : null,
      cr.verba ? 'verba ' + brl(cr.verba) : null].filter(Boolean).join(' · ') || 'texto livre';
    res.innerHTML = `
      <div class="card tiny muted">Critérios extraídos${_match.deal_nome ? ' de "' + esc(_match.deal_nome) + '"' : ''}: <b>${esc(crTxt)}</b> · ${_match.avaliados} imóveis avaliados</div>
      <div class="mt-2">${(_match.itens || []).map(im =>
        cardImovel(im, `<span class="badge" style="background:#2563eb22;color:#2563eb;font-weight:800">★ ${im.score}</span><span class="tiny muted">${esc((im.motivos || []).join(' · '))}</span>`)
      ).join('') || '<div class="card">Nenhum imóvel pontuou. Tente descrever de outro jeito (bairro, tipo, verba).</div>'}</div>`;
  };
  corpo.querySelector('#ek-go').onclick = go;
  corpo.querySelector('#ek-mq').onkeydown = e => { if (e.key === 'Enter') go(); };
  sel.onchange = () => { if (sel.value) go(); };
}

async function doSync() {
  if (_busy) return;
  _busy = true;
  const b = _root.querySelector('#ek-sync');
  if (b) { b.disabled = true; b.textContent = '⏳ Sincronizando…'; }
  try {
    const r = await api.request('/api/v3/kenlo/sync', { method: 'POST' });
    alert(`✅ Sync ok: ${r.upserted} imóveis atualizados (${r.total_kenlo} no Kenlo, ${r.desativados} saíram do ar).`);
  } catch (e) {
    alert('❌ ' + e.message);
  }
  _busy = false;
  reload();
}
