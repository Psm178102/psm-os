/* PSM-OS v2 — 🎁 Indicação Premiada (v84.22) · Mariane
   Funil da indicação até o prêmio pago, amarrado no RD CRM e nas faixas de
   VGV da config (mesma fonte do Painel de Fiscalização). Substitui a antiga
   aba genérica "Programa de Indicações" do CS.
   Backend: /api/v3/producao/indicacoes */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _filtro = '', _deals = null, _busy = false, _formAberto = false;

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

function faixasBox() {
  const fv = _d.faixas_venda || [], fl = _d.faixas_locacao || [];
  const fmt = ([teto, p], i, arr) => `${i === 0 ? 'até' : ''} ${teto >= 999999999 ? 'acima' : 'R$ ' + Number(teto).toLocaleString('pt-BR')} → <b>${brl(p)}</b>`;
  return `<div class="tiny muted" style="background:var(--bg-3);border-radius:10px;padding:8px 10px">
    <b>💰 Faixas (config da Fiscalização, sem hardcode):</b><br>
    VENDA (por VGV): ${fv.map(fmt).join(' · ')} · 1M+ personalizável<br>
    LOCAÇÃO (por aluguel): ${fl.map(fmt).join(' · ')}
  </div>`;
}

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

function render() {
  const k = _d.kpis || {}, itens = _d.itens || [];
  const vis = _filtro ? itens.filter(i => i.status === _filtro) : itens;
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🎁 Indicação Premiada</h2>
        <span class="tiny muted">indicou → qualificou → RD → venda → prêmio pela faixa de VGV · Mariane roda, Isabella atende</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-primary btn-sm" id="ip-nova">➕ Nova indicação</button>
        <button class="btn btn-ghost btn-sm" id="ip-prom">🌟 Puxar promotores do NPS</button>
        <button class="btn btn-ghost btn-sm" id="ip-conferir">🔄 Conferir vendas no RD</button>
        <button class="btn btn-ghost btn-sm" id="ip-reload">↻</button>
      </div>
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
      <div class="mt-2">${faixasBox()}</div>
      <div id="ip-form" class="mt-2"></div>
    </div>
    <div class="mt-2">${vis.map(cardIndicacao).join('') || '<div class="card muted">Nenhuma indicação aqui ainda. Registre a primeira — ou puxe os promotores do NPS.</div>'}</div>`;

  _root.querySelector('#ip-reload').onclick = reload;
  _root.querySelector('#ip-conferir').onclick = () => post({ action: 'conferir_vendas' }, '🔄 Conferido no RD.');
  _root.querySelector('#ip-prom').onclick = () => post({ action: 'puxar_promotores' }, '🌟 Promotores puxados pro funil.');
  _root.querySelectorAll('.ip-f').forEach(b => b.onclick = () => { _filtro = b.dataset.f; render(); });
  _root.querySelector('#ip-nova').onclick = () => { _formAberto = !_formAberto; desenhaForm(); };
  if (_formAberto) desenhaForm();
  _root.querySelectorAll('.ip-act').forEach(b => b.onclick = () => acao(b.dataset.id, b.dataset.act));
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
