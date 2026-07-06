/* PSM-OS v2 — 📊 Dashboard Locação (v84.17)
   Visão executiva SÓ de locação: carteira administrada (tabela locacoes),
   estoque de anúncios p/ alugar (kenlo_imoveis) e funil CRM de locação.
   Backend: /api/v3/locacoes/dash */
import { api } from '../api.js';

let _root = null, _d = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TIPO_PT = { apartment: 'Apartamento', house: 'Casa', land: 'Terreno', commercial: 'Comercial',
  studio: 'Studio', penthouse: 'Cobertura', penthouse_apartment: 'Cobertura', room: 'Sala comercial',
  office: 'Sala', store: 'Loja', shed: 'Galpão/Barracão', hall: 'Salão', small_farm: 'Chácara',
  two_story_house: 'Sobrado', area: 'Área', outhouse: 'Edícula', smallholding: 'Sítio', flat: 'Flat' };
const tipoPt = t => TIPO_PT[String(t || '').toLowerCase()] || String(t || '').replace(/^./, c => c.toUpperCase());
const STATUS_LBL = { ocupado: ['🔵 Ocupados', '#2563eb'], disponivel: ['🟢 Disponíveis', '#16a34a'],
  em_renovacao: ['🟡 Em renovação', '#d97706'], em_atraso: ['🔴 Em atraso', '#dc2626'] };

export async function pageLocacaoDash(ctx, root) {
  _root = root;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Montando o painel de locação…</div></div>';
  try {
    _d = await api.request('/api/v3/locacoes/dash');
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  render();
}

function kpi(lbl, val, sub = '', borda = '') {
  return `<div style="flex:1;min-width:160px;background:var(--bg-3);border-radius:10px;padding:10px 12px${borda ? ';border-left:3px solid ' + borda : ''}">
    <div class="tiny muted">${lbl}</div><div style="font-size:19px;font-weight:900">${val}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
}

function barra(lbl, n, max, cor = '#0891b2', extra = '') {
  const pct = max ? Math.max(2, Math.round(n / max * 100)) : 0;
  return `<div class="flex items-center tiny" style="gap:8px;margin:3px 0">
    <span style="width:150px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lbl}</span>
    <div style="flex:1;background:var(--bg-3);border-radius:6px;height:15px"><div style="width:${pct}%;background:${cor}99;height:15px;border-radius:6px"></div></div>
    <span style="width:${extra ? '120px' : '32px'};text-align:right;flex-shrink:0;font-weight:600">${n}${extra}</span></div>`;
}

function render() {
  const c = _d.carteira || {}, e = _d.estoque || {}, crm = _d.crm || {};
  const st = c.status || {};
  const maxSt = Math.max(1, ...Object.values(st));
  const maxB = Math.max(1, ...(e.por_bairro || []).map(x => x[1]));
  const fmtD = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return iso; } };
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🔑 Dashboard Locação</h2>
        <span class="tiny muted">carteira administrada + estoque p/ alugar + funil</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-ghost btn-sm" data-nav="/locacoes">🗂 Carteira</button>
        <button class="btn btn-ghost btn-sm" data-nav="/locacao-estoque">🏠 Imóveis p/ alugar</button>
      </div>
      <div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
        ${kpi('🔑 Contratos ativos', c.ocupadas || 0, (c.total || 0) + ' na carteira')}
        ${kpi('🏠 Aluguel sob gestão/mês', brl(c.aluguel_mes), 'ticket médio ' + brl(c.ticket_medio))}
        ${kpi('💰 Receita de administração/mês', brl(c.receita_adm_mes), 'taxa média ' + (c.taxa_adm_media || 0).toFixed(1) + '%', '#16a34a')}
        ${kpi('⏳ Vencendo', `${c.vence_30 || 0} · ${c.vence_60 || 0} · ${c.vence_90 || 0}`, '30 · 60 · 90 dias', (c.vence_30 ? '#dc2626' : '#d97706'))}
      </div>
      ${!c.total ? `<div class="alert alert-warn mt-2" style="font-size:12px">A carteira ainda está vazia no House. Cadastre os contratos em <b>🗂 Carteira</b> (ou importe CSV) — referência do painel Kenlo em 04/07/2026: <b>11 contratos · R$ 39.065,47 de aluguéis · R$ 3.752,77/mês de taxa adm</b>.</div>` : ''}
    </div>

    <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:stretch">
      <div class="card" style="flex:1;min-width:280px;margin:0">
        <b>🗂 Carteira por status</b>
        <div class="mt-1">${Object.entries(STATUS_LBL).map(([k, [lbl, cor]]) => barra(lbl, st[k] || 0, maxSt, cor)).join('')}</div>
      </div>
      <div class="card" style="flex:1.4;min-width:300px;margin:0">
        <b>📅 Renovações nos próximos 90 dias</b>
        ${(c.vencendo || []).length ? `<div class="mt-1">${c.vencendo.map(v => `
          <div class="flex items-center tiny" style="gap:8px;padding:4px 0;border-bottom:1px solid var(--bg-3)">
            <span class="badge" style="background:#d9770622;color:#d97706;font-weight:700">${fmtD(v.fim)}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.endereco)}${v.inquilino ? ' · ' + esc(v.inquilino) : ''}</span>
            <b>${brl(v.aluguel)}</b>
          </div>`).join('')}</div>`
      : '<div class="tiny muted mt-1">Nenhum contrato vencendo em 90 dias (ou datas de fim não cadastradas).</div>'}
      </div>
    </div>

    <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:stretch">
      <div class="card" style="flex:1;min-width:300px;margin:0">
        <b>🏠 Estoque p/ alugar (anúncios no site)</b>
        <div class="flex mt-1" style="gap:8px;flex-wrap:wrap">
          ${kpi('Anúncios', e.n || 0)}
          ${kpi('Aluguel anunciado/mês', brl(e.aluguel_anunciado_mes), 'ticket ' + brl(e.ticket_medio))}
        </div>
        <div class="tiny muted mt-1">Por tipo: ${(e.por_tipo || []).map(([t, n]) => `${tipoPt(t)} (${n})`).join(' · ') || '—'}</div>
        <button class="btn btn-ghost btn-sm mt-1" data-nav="/locacao-estoque">ver os anúncios →</button>
      </div>
      <div class="card" style="flex:1;min-width:300px;margin:0">
        <b>📍 Onde está o estoque de locação</b>
        <div class="mt-1">${(e.por_bairro || []).map(([b, n]) => barra(esc(b), n, maxB)).join('') || '<span class="tiny muted">Sem anúncios de locação no ar.</span>'}</div>
      </div>
      <div class="card" style="flex:1;min-width:240px;margin:0">
        <b>🎯 Funil CRM · Locação</b>
        ${crm.n ? `<div class="flex mt-1" style="gap:8px;flex-wrap:wrap">
            ${kpi('Leads abertos', crm.n)}${kpi('Valor no funil', brl(crm.valor))}
          </div>`
      : '<div class="tiny muted mt-1">Nenhum funil de locação identificado no CRM (pipeline com "locação" no nome). Quando existir, os leads aparecem aqui sozinhos.</div>'}
      </div>
    </div>`;
  _root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { location.hash = '#' + b.dataset.nav; });
}
