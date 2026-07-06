/* PSM-OS v2 — 🏠 Estoque Kenlo (v84.11)
   Os anúncios publicados no Kenlo Imob DENTRO do House, via Kenlo Open API
   (sync diário → tabela kenlo_imoveis). 3 abas:
   📦 Estoque (busca/filtros) · 🔴 Desatualizados (pauta Leire/Guilherme) ·
   🤝 Match CRM (casa lead do RD com o estoque).
   Backend: /api/v3/kenlo/estoque (lista+match) e /api/v3/kenlo/sync (lvl>=5). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _aba = 'estoque', _q = '', _transacao = '', _ordem = 'atualizado', _busy = false;
let _tipo = '', _bairro = '', _dormsMin = '', _pmin = '', _pmax = '';
let _match = null, _matchQ = '', _deals = null, _an = null;
let _iaQ = '', _ia = null, _iaBusy = false;

// site público (Kenlo Sites) resolve o anúncio só pelo código — slug é reescrito
const SITE_IMOVEL = c => 'https://www.psmimoveis.com/imovel/i/' + encodeURIComponent(c) + '-PSMA';
const md = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•] (.+)$/gm, '· $1').replace(/\n/g, '<br>');

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
    const qs = new URLSearchParams({ q: _q, transacao: _transacao, ordem: _ordem, pageSize: '400',
      tipo: _tipo, bairro: _bairro, dorms_min: _dormsMin, preco_min: _pmin, preco_max: _pmax });
    _d = await api.request('/api/v3/kenlo/estoque?' + qs);
    _an = null; // análises recarregam junto
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div>
      <div class="tiny muted mt-1">Se for a 1ª vez: o estoque precisa de 1 sync (⚙ sócio) ou aguarde o cron diário das 05:00.</div></div>`;
    return;
  }
  render();
}

function fichaTec(im) {
  return [
    im.tipo ? esc(tipoPt(im.tipo)) : null,
    im.dorms ? `🛏 ${im.dorms}` : null,
    im.vagas ? `🚗 ${im.vagas}` : null,
    (im.area_util || im.area_total) ? `📐 ${Math.round(im.area_util || im.area_total)}m²` : null,
  ].filter(Boolean).join(' · ');
}
const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
// propertyType do Kenlo vem em inglês — traduz só na exibição (filtro usa o valor cru)
const TIPO_PT = { apartment: 'Apartamento', house: 'Casa', land: 'Terreno', commercial: 'Comercial',
  studio: 'Studio', penthouse: 'Cobertura', farm: 'Chácara/Sítio', ranch: 'Rancho',
  condominium: 'Condomínio', office: 'Sala', store: 'Loja', warehouse: 'Galpão',
  twostoryhouse: 'Sobrado', 'two-story house': 'Sobrado', flat: 'Flat', loft: 'Loft' };
const tipoPt = t => TIPO_PT[String(t || '').toLowerCase()] || cap(t);

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
          ${im.property_code ? `<a href="${SITE_IMOVEL(im.property_code)}" target="_blank" rel="noopener" class="badge" style="background:#0891b222;color:#0891b2;text-decoration:none;font-weight:700">🌐 site</a>` : ''}
          ${extra}
        </div>
        <div class="tiny" style="margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(im.titulo || '')}</div>
        <div class="tiny muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📍 ${esc([im.bairro, im.cidade].filter(Boolean).join(', ') || im.endereco || '')}
          ${fichaTec(im) ? ' · ' + fichaTec(im) : ''}</div>
      </div>
    </div>
  </div>`;
}

function render() {
  const k = _d.kpis || {};
  const me = auth.user();
  const canSync = (me?.lvl || 0) >= 5;
  const ultima = _d.ultima_sync ? new Date(_d.ultima_sync).toLocaleString('pt-BR') : 'nunca';
  const abas = [['estoque', '📦 Estoque'], ['analises', '📊 Análises'],
    ['desatualizados', `🔴 Desatualizados (${k.desat_90 || 0})`], ['match', '🤝 Match CRM']];
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
  else if (_aba === 'analises') renderAnalises(corpo);
  else if (_aba === 'desatualizados') renderDesatualizados(corpo);
  else renderMatch(corpo);
}

function renderEstoque(corpo) {
  const itens = _d.itens || [];
  const f = _d.facetas || {};
  const opts = (lista, sel) => (lista || []).map(([v, n]) =>
    `<option value="${esc(v)}" ${sel === String(v) ? 'selected' : ''}>${esc(tipoPt(v))} (${n})</option>`).join('');
  corpo.innerHTML = `
    <div class="card" style="border:1px solid #7c3aed55">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <input class="input" id="ek-ia" placeholder='🤖 pergunte ao estoque: "3 dorms zona sul até 700 mil" · "o que é boa oportunidade?" · "o que está abandonado?"' value="${esc(_iaQ)}" style="flex:1;min-width:260px">
        <button class="btn btn-primary btn-sm" id="ek-iago" ${_iaBusy ? 'disabled' : ''}>${_iaBusy ? '⏳ Analisando…' : '🤖 Perguntar'}</button>
        ${_ia && !_iaBusy ? '<button class="btn btn-ghost btn-sm" id="ek-ialimpa" title="limpar resposta">✕</button>' : ''}
      </div>
      ${_ia ? `<div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:10px 12px">
        <div class="tiny">${md(_ia.resposta || '')}</div>
        <div class="tiny muted mt-1">🤖 ${esc(_ia.provider || 'ia')} · ${_ia.avaliados || 0} imóveis avaliados</div>
      </div>
      <div class="mt-2">${(_ia.itens || []).map(im => cardImovel(im)).join('')}</div>` : ''}
    </div>
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
      <div class="flex items-center mt-2" style="gap:8px;flex-wrap:wrap">
        <select class="input" id="ek-tipo" style="flex:1;min-width:140px;width:auto">
          <option value="">🏷 Todos os tipos</option>${opts(f.tipos, _tipo)}
        </select>
        <select class="input" id="ek-bairro" style="flex:1;min-width:150px;width:auto">
          <option value="">📍 Todos os bairros</option>${opts(f.bairros, _bairro)}
        </select>
        <select class="input" id="ek-dorms" style="flex:0 0 auto;width:auto">
          <option value="">🛏 Dorms</option>
          ${[1, 2, 3, 4].map(n => `<option value="${n}" ${_dormsMin === String(n) ? 'selected' : ''}>${n}+</option>`).join('')}
        </select>
        <input class="input" id="ek-pmin" type="number" placeholder="R$ mín" value="${esc(_pmin)}" style="flex:0 0 110px">
        <input class="input" id="ek-pmax" type="number" placeholder="R$ máx" value="${esc(_pmax)}" style="flex:0 0 110px">
        ${(_tipo || _bairro || _dormsMin || _pmin || _pmax) ? '<button class="btn btn-ghost btn-sm" id="ek-limpar">✕ limpar filtros</button>' : ''}
      </div>
    </div>
    <div class="mt-2">${itens.map(im => cardImovel(im)).join('') || '<div class="card muted">Nada encontrado. Ajuste a busca — ou rode a 1ª sincronização.</div>'}</div>`;
  const inp = corpo.querySelector('#ek-q');
  let t = null;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(() => { _q = inp.value; reload(); }, 450); };
  corpo.querySelector('#ek-tr').onchange = e => { _transacao = e.target.value; reload(); };
  corpo.querySelector('#ek-ord').onchange = e => { _ordem = e.target.value; reload(); };
  corpo.querySelector('#ek-tipo').onchange = e => { _tipo = e.target.value; reload(); };
  corpo.querySelector('#ek-bairro').onchange = e => { _bairro = e.target.value; reload(); };
  corpo.querySelector('#ek-dorms').onchange = e => { _dormsMin = e.target.value; reload(); };
  let tp = null;
  const precoInput = el => { clearTimeout(tp); tp = setTimeout(() => {
    _pmin = corpo.querySelector('#ek-pmin').value; _pmax = corpo.querySelector('#ek-pmax').value; reload(); }, 600); };
  corpo.querySelector('#ek-pmin').oninput = precoInput;
  corpo.querySelector('#ek-pmax').oninput = precoInput;
  const lp = corpo.querySelector('#ek-limpar');
  if (lp) lp.onclick = () => { _tipo = _bairro = _dormsMin = _pmin = _pmax = ''; reload(); };
  const iaGo = async () => {
    const v = corpo.querySelector('#ek-ia').value.trim();
    if (!v || _iaBusy) return;
    _iaQ = v; _iaBusy = true; render();
    try {
      _ia = await api.request('/api/v3/kenlo/pergunte', { method: 'POST', body: JSON.stringify({ q: v }) });
    } catch (e) {
      _ia = { resposta: '❌ ' + e.message, itens: [] };
    }
    _iaBusy = false; render();
  };
  corpo.querySelector('#ek-iago').onclick = iaGo;
  corpo.querySelector('#ek-ia').onkeydown = e => { if (e.key === 'Enter') iaGo(); };
  const il = corpo.querySelector('#ek-ialimpa');
  if (il) il.onclick = () => { _ia = null; _iaQ = ''; render(); };
}

function barra(lbl, n, max, dir = '#2563eb', extra = '') {
  const pct = max ? Math.max(2, Math.round(n / max * 100)) : 0;
  return `<div class="flex items-center tiny" style="gap:8px;margin:3px 0">
    <span style="width:132px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lbl}</span>
    <div style="flex:1;background:var(--bg-3);border-radius:6px;height:15px"><div style="width:${pct}%;background:${dir}99;height:15px;border-radius:6px"></div></div>
    <span style="width:${extra ? '140px' : '36px'};text-align:right;flex-shrink:0;font-weight:600">${n}${extra}</span>
  </div>`;
}

async function renderAnalises(corpo) {
  if (!_an) {
    corpo.innerHTML = '<div class="card"><span class="spinner"></span> Calculando análises do estoque…</div>';
    try {
      const r = await api.request('/api/v3/kenlo/estoque?modo=analise');
      _an = r.analise || {};
    } catch (e) {
      corpo.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
      return;
    }
  }
  const a = _an;
  const brlK = n => n >= 1e6 ? 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'
    : 'R$ ' + Math.round(n / 1000).toLocaleString('pt-BR') + ' mil';
  const kpi = (lbl, val, sub = '') => `<div style="flex:1;min-width:150px;background:var(--bg-3);border-radius:10px;padding:10px 12px">
    <div class="tiny muted">${lbl}</div><div style="font-size:18px;font-weight:900">${val}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
  const maxTipo = Math.max(1, ...(a.por_tipo || []).map(x => x[1]));
  const maxBairro = Math.max(1, ...(a.por_bairro || []).map(x => x[1]));
  const ag = a.aging_atualizacao || {}, ar = a.aging_no_ar || {};
  const maxFx = Math.max(1, ...(a.faixas_venda || []).map(x => x[1]));
  const snaps = a.snapshots || [];
  const maxSnap = Math.max(1, ...snaps.map(s => Number(s.vgv_venda || 0)));
  const cores = { '0-30': '#16a34a', '31-90': '#65a30d', '91-180': '#d97706', '180+': '#dc2626', '?': '#64748b' };
  corpo.innerHTML = `
    <div class="card">
      <div class="flex" style="gap:8px;flex-wrap:wrap">
        ${kpi('💰 VGV do estoque (venda)', brl(a.vgv_venda), a.n_venda + ' anúncios de venda')}
        ${kpi('🎯 Ticket médio', brl(a.ticket_medio))}
        ${kpi('🏠 Aluguel anunciado/mês', brl(a.aluguel_mensal), a.n_locacao + ' p/ locação')}
        ${kpi('📷 Fotos', (a.media_fotos || 0).toFixed(1) + ' por anúncio', a.sem_foto + ' sem foto')}
      </div>
    </div>
    <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:stretch">
      <div class="card" style="flex:1;min-width:300px;margin:0">
        <b>🏷 Por tipo</b><div class="tiny muted">nº de anúncios · VGV de venda</div>
        <div class="mt-1">${(a.por_tipo || []).map(([t, n, v]) => barra(esc(tipoPt(t)), n, maxTipo, '#2563eb', ` · ${brlK(v)}`)).join('') || '<span class="tiny muted">Rode 1 sync pós-v84.12 pra preencher os tipos.</span>'}</div>
      </div>
      <div class="card" style="flex:1;min-width:300px;margin:0">
        <b>📍 Por bairro (top 12)</b><div class="tiny muted">onde o estoque está concentrado</div>
        <div class="mt-1">${(a.por_bairro || []).map(([b, n, v]) => barra(esc(b), n, maxBairro, '#7c3aed', ` · ${brlK(v)}`)).join('')}</div>
      </div>
    </div>
    <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:stretch">
      <div class="card" style="flex:1;min-width:280px;margin:0">
        <b>⏱ Tempo sem atualizar</b><div class="tiny muted">pauta de saúde do anúncio</div>
        <div class="mt-1">${Object.entries(ag).filter(([k]) => k !== '?' || ag['?']).map(([k, n]) => barra(k + ' dias', n, Math.max(1, ...Object.values(ag)), cores[k])).join('')}</div>
      </div>
      <div class="card" style="flex:1;min-width:280px;margin:0">
        <b>📅 Tempo no ar (idade do anúncio)</b><div class="tiny muted">quanto mais velho sem vender, mais atenção</div>
        <div class="mt-1">${Object.entries(ar).filter(([k]) => k !== '?' || ar['?']).map(([k, n]) => barra(k + ' dias', n, Math.max(1, ...Object.values(ar)), cores[k])).join('')}</div>
      </div>
      <div class="card" style="flex:1;min-width:280px;margin:0">
        <b>💵 Faixas de preço (venda)</b><div class="tiny muted">onde está o volume</div>
        <div class="mt-1">${(a.faixas_venda || []).map(([f, n]) => barra(esc(f), n, maxFx, '#0891b2')).join('')}</div>
      </div>
    </div>
    <div class="card mt-2">
      <b>📈 Evolução do VGV do estoque</b><div class="tiny muted">1 ponto por dia (cron 05:00) — total no ar × VGV de venda</div>
      ${snaps.length >= 2 ? `
        <div class="flex mt-2" style="gap:2px;align-items:flex-end;height:90px">
          ${snaps.map(s => `<div title="${esc(s.dia)} · ${brl(s.vgv_venda)} · ${s.total} imóveis" style="flex:1;background:#2563eb88;border-radius:3px 3px 0 0;height:${Math.max(4, Math.round(Number(s.vgv_venda || 0) / maxSnap * 100))}%"></div>`).join('')}
        </div>
        <div class="flex tiny muted" style="justify-content:space-between"><span>${esc(snaps[0]?.dia || '')}</span><span>${esc(snaps[snaps.length - 1]?.dia || '')}</span></div>`
    : `<div class="tiny muted mt-2">A série histórica começa a acumular agora — 1 snapshot por dia a partir do próximo sync. Volte em alguns dias pra ver a curva.</div>`}
    </div>`;
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
