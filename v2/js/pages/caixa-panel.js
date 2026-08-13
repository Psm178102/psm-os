/* ═══════════════════════════════════════════════════════════════════════════
   💵 PAINEL DE CAIXA (v86.11) — componente ÚNICO montado em 2 lugares:
   Métricas de Viabilidade (aba CAIXA) e Financeiro (aba 💵 Caixa).
   Realizado detalhado (competência) + fluxo a receber/a pagar por semana
   (caixa) + meta mínima de break-even. Fonte de cada número explícita.
   ═══════════════════════════════════════════════════════════════════════════ */
import { api } from '../api.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kR$ = v => {
  const n = Number(v) || 0, a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M';
  if (a >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};
const fN = v => { const x = Number(v) || 0; return Number.isInteger(x) ? x.toLocaleString('pt-BR') : x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
const dBR = s => { try { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}`; } catch { return s || '—'; } };

let _host = null, _d = null, _ym = null;

export async function mountCaixa(host, ym) {
  _host = host;
  _ym = ym || _ym || null;
  host.innerHTML = '<div class="flex items-center gap-2 muted" style="padding:14px"><span class="spinner"></span> Consolidando caixa (CRM + Radar + NIBO)…</div>';
  try {
    _d = await api.request('/api/v3/diretoria/caixa' + (_ym ? `?ym=${_ym}` : ''));
    _ym = _d.ym;
    render();
  } catch (e) {
    host.innerHTML = `<div class="alert alert-err">Caixa indisponível: ${esc(e.message || e)}</div>`;
  }
}

function pan(title, inner, extraStyle) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;${extraStyle || ''}">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">${title}</div>${inner}</div>`;
}

function render() {
  const d = _d, f = d.fontes || {}, r = d.realizado || {}, cx = d.caixa || {}, be = d.breakeven || {};
  const chip = (ok, lbl, tip) => `<span title="${esc(tip || '')}" style="display:inline-block;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;border:1px solid ${ok ? '#bbf7d0' : '#fde68a'};background:${ok ? '#f0fdf4' : '#fffbeb'};color:${ok ? '#166534' : '#92400e'}">${ok ? '✓' : '⚠'} ${lbl}</span>`;
  const [anoS, mesS] = _ym.split('-');
  const mesNome = new Date(+anoS, +mesS - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  _host.innerHTML = `
    <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:10px">
      <div style="font-weight:900;font-size:15px">💵 Caixa · ${esc(mesNome)}</div>
      <input type="month" class="input" id="cx-ym" value="${_ym}" style="width:auto;padding:4px 8px;font-size:12px">
      <span style="flex:1"></span>
      ${chip(true, 'CRM (RD)', 'VGV/vendas reais por frente')}
      ${chip(f.recebiveis, 'Radar de Recebíveis', 'a receber vem do radar (valor, data, marco)')}
      ${chip(f.nibo, 'NIBO', f.nibo ? 'a pagar = agenda real dos 2 CNPJs' : (d.fontes.nibo_err || []).join(' · ') || 'sem envs — a pagar usa o orçado')}
      ${chip(true, 'Meta Ads', 'tráfego real do mês entra no custo')}
    </div>
    ${(d.avisos || []).length ? `<div class="alert alert-warn" style="font-size:12px">${d.avisos.map(esc).join('<br>')}</div>` : ''}
    ${blocoRealizado(r)}
    <div style="margin-top:14px">${blocoFluxo(cx)}</div>
    <div style="margin-top:14px">${blocoBreakeven(be)}</div>`;

  _host.querySelector('#cx-ym')?.addEventListener('change', ev => mountCaixa(_host, ev.target.value));
  _host.querySelector('#cx-setpos')?.addEventListener('click', async () => {
    const atual = cx.posicao_inicial;
    const v = prompt('Posição de caixa HOJE (R$) — ponto de partida do acumulado semanal:', atual ?? '');
    if (v === null) return;
    const num = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    if (isNaN(num)) { alert('Valor inválido.'); return; }
    try {
      await api.request('/api/v3/diretoria/caixa', { method: 'POST', body: { action: 'set_caixa', valor: num } });
      mountCaixa(_host, _ym);
    } catch (e) { alert('Não salvou: ' + (e.message || e)); }
  });
}

/* ── 1) REALIZADO detalhado (competência: o que foi VENDIDO/gerado) ── */
function blocoRealizado(r) {
  const c = (r.mes || {}).consolidado || {}, pl = (r.mes || {}).por_linha || {}, ac = r.acumulado_ano || {};
  const LN = { map: ['🏢', 'PSM M.A.P'], conquista: ['🏠', 'PSM Conquista'], terceiros: ['🤝', 'Terceiros'], locacoes: ['🔑', 'Locações'] };
  const rows = Object.keys(LN).map(i => {
    const s = pl[i] || {};
    return `<tr>
      <td style="font-size:12px;font-weight:600;white-space:nowrap;padding:4px 6px 4px 0">${LN[i][0]} ${LN[i][1]}</td>
      <td style="text-align:right;font-size:12px">${fN(s.vendas || 0)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(s.vgv)}</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(s.receita)}</td>
      <td style="text-align:right;font-size:12px;color:#b45309">R$ ${kR$((s.com_corretor || 0) + (s.com_senior || 0) + (s.com_gerente || 0))}</td>
      <td style="text-align:right;font-size:12px;color:#b45309">R$ ${kR$(s.imposto)}</td>
      <td style="text-align:right;font-size:12px;font-weight:800;color:${(s.lucro || 0) >= 0 ? '#166534' : '#dc2626'}">R$ ${kR$(s.lucro)}</td>
      <td style="text-align:right;font-size:11px;color:var(--ink-muted)">${s.margem != null ? fN(s.margem) + '%' : '—'}</td>
    </tr>`;
  }).join('');
  return pan('📈 Realizado do mês — competência (motor da Viabilidade: CRM + premissas + custos + Meta)', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:10px;text-align:center">
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">${fN(c.vendas || 0)}</div><div class="tiny muted">vendas no mês</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">R$ ${kR$(c.vgv)}</div><div class="tiny muted">VGV</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">R$ ${kR$(c.receita)}</div><div class="tiny muted">receita bruta PSM</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900;color:${(c.lucro || 0) >= 0 ? '#166534' : '#dc2626'}">R$ ${kR$(c.lucro)}</div><div class="tiny muted">lucro (margem ${c.margem != null ? fN(c.margem) + '%' : '—'})</div></div>
      ${r.recebido_caixa_mes != null ? `<div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">R$ ${kR$(r.recebido_caixa_mes)}</div><div class="tiny muted">ENTROU no caixa (radar)</div></div>` : ''}
      ${r.nibo_mes ? `<div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">R$ ${kR$(r.nibo_mes.pago)}</div><div class="tiny muted">pago no mês (NIBO)</div></div>` : ''}
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Frente</th><th>Vendas</th><th>VGV</th><th>Receita</th><th>Comissões</th><th>Imposto</th><th>Lucro</th><th>Mg</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">Acumulado ${_ym.slice(0, 4)} (${ac.meses || 0} mês/es): <b>${fN(ac.vendas || 0)} vendas</b> · VGV <b>R$ ${kR$(ac.vgv)}</b> · receita <b>R$ ${kR$(ac.receita)}</b> · lucro <b style="color:${(ac.lucro || 0) >= 0 ? '#166534' : '#dc2626'}">R$ ${kR$(ac.lucro)}</b>. Competência = quando VENDEU; o caixa (embaixo) = quando o dinheiro ENTRA.</div>`);
}

/* ── 2) FLUXO DE CAIXA — a receber × a pagar, semana a semana ── */
function blocoFluxo(cx) {
  const sem = cx.semanas || [], rs = cx.recebiveis_resumo || {};
  const maxAbs = Math.max(1, ...sem.map(s => Math.max(s.entra_total || 0, s.sai_total || 0)));
  const cols = sem.map(s => {
    const hE = Math.round((s.entra_total || 0) / maxAbs * 64);
    const hEc = Math.round((s.entra_confirmado || 0) / maxAbs * 64);
    const hS = Math.round((s.sai_total || 0) / maxAbs * 64);
    const neg = (s.acumulado || 0) < 0;
    return `<div style="flex:1;min-width:64px;text-align:center" title="entra R$ ${brl(s.entra_total)} (conf. R$ ${brl(s.entra_confirmado)} · trav. R$ ${brl(s.entra_travado)}) · sai R$ ${brl(s.sai_total)} (${s.base_pagar === 'nibo' ? 'agenda NIBO' : 'custo orçado'} + comissões)">
      <div style="height:70px;display:flex;align-items:flex-end;justify-content:center;gap:3px">
        <div style="width:16px;background:#bbf7d0;height:${hE}px;border-radius:3px 3px 0 0;position:relative"><div style="position:absolute;bottom:0;left:0;right:0;height:${hEc}px;background:#16a34a;border-radius:${hEc === hE ? '3px 3px 0 0' : '0'}"></div></div>
        <div style="width:16px;background:#fca5a5;height:${hS}px;border-radius:3px 3px 0 0"></div>
      </div>
      <div class="tiny" style="font-weight:700;margin-top:2px">${dBR(s.ini)}</div>
      <div class="tiny" style="font-weight:800;color:${neg ? '#dc2626' : '#166534'}">${neg ? '−' : ''}R$ ${kR$(Math.abs(s.acumulado))}</div>
    </div>`;
  }).join('');
  const STB = { confirmado: ['#16a34a', '✅'], previsto: ['#2563eb', '📅'], travado: ['#dc2626', '🔒'] };
  const prox = (cx.proximos || []).slice(0, 12).map(p => {
    const [cor, ico] = STB[p.status] || ['#64748b', '•'];
    return `<div style="display:flex;gap:8px;align-items:center;border-left:3px solid ${cor};background:var(--bg-3);border-radius:6px;padding:5px 9px">
      <span class="tiny" style="font-weight:800;white-space:nowrap">${p.data ? dBR(p.data) : '<span style="color:#d97706">s/ data</span>'}</span>
      <span class="tiny" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ico} ${esc(p.desc || '')}${p.corretor ? ' · ' + esc(p.corretor) : ''}${p.bloqueio && p.bloqueio !== 'nenhum' ? ` <b style="color:#dc2626">⛔ ${esc(p.bloqueio)}</b>` : ''}</span>
      <span class="tiny" style="font-weight:800;white-space:nowrap">R$ ${kR$(p.valor)}${p.estimado ? '<span class="muted" title="valor estimado pela premissa — preencher no Radar">*</span>' : ''}</span>
    </div>`;
  }).join('');
  return pan(`📆 Fluxo de caixa · próximas ${sem.length} semanas — a receber (Radar) × a pagar (${sem[0]?.base_pagar === 'nibo' ? 'agenda NIBO' : 'custo orçado'} + comissões casadas)`, `
    <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:8px">
      <span class="tiny">Ponto de partida: <b>${cx.posicao_inicial != null ? 'R$ ' + brl(cx.posicao_inicial) : 'R$ 0 (fluxo puro)'}</b></span>
      <button class="btn btn-ghost btn-sm" id="cx-setpos">✏️ posição de caixa</button>
      ${cx.furo ? `<span class="tiny" style="font-weight:800;color:#dc2626">🚨 fura na semana de ${dBR(cx.furo)}</span>` : '<span class="tiny" style="font-weight:700;color:#166534">✓ não fura no horizonte</span>'}
      <span style="flex:1"></span>
      <span class="tiny muted">🟩 entra (escuro = confirmado) · 🟥 sai · nº = acumulado</span>
    </div>
    <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px">${cols}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:10px 0;text-align:center">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:7px"><div style="font-weight:900">R$ ${kR$(rs.confirmado)}</div><div class="tiny muted">confirmado</div></div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:7px"><div style="font-weight:900">R$ ${kR$(rs.previsto)}</div><div class="tiny muted">previsto</div></div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:7px"><div style="font-weight:900">R$ ${kR$(rs.travado)}</div><div class="tiny muted">travado (fora do saldo)</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:7px"><div style="font-weight:900">${rs.sem_data || 0} / ${rs.sem_valor || 0}</div><div class="tiny muted">sem data / sem valor ⚠</div></div>
    </div>
    <div style="display:grid;gap:4px">${prox || '<div class="tiny muted">Nenhum recebível ativo no Radar.</div>'}</div>
    <div class="tiny muted" style="margin-top:6px">Saldo NÃO conta o travado (realista). Atrasados caem na 1ª semana. * = valor estimado pela premissa da frente — o número fino se preenche no Radar de Recebíveis.</div>`);
}

/* ── 3) BREAK-EVEN — meta mínima do mês ── */
function blocoBreakeven(be) {
  const FAROL = { coberto: ['#16a34a', '✅ mês já se paga'], perto: ['#d97706', '⚠️ quase — falta pouco'], descoberto: ['#dc2626', '🚨 abaixo do break-even'] };
  const [cor, lbl] = FAROL[be.farol] || ['#94a3b8', '—'];
  const pct = Math.min(140, be.cobertura_pct || 0);
  const rows = (be.por_frente || []).map(l => `<tr>
      <td style="font-size:12px;font-weight:600;white-space:nowrap;padding:4px 6px 4px 0">${l.icon} ${esc(l.nome)}</td>
      <td style="text-align:right;font-size:12px">${fN(l.margem_pct)}%</td>
      <td style="text-align:right;font-size:12px">${fN(l.share_pct)}%</td>
      <td style="text-align:right;font-size:12px">R$ ${kR$(l.vgv_min)}</td>
      <td style="text-align:right;font-size:12px">${l.ticket ? 'R$ ' + kR$(l.ticket) : '—'}</td>
      <td style="text-align:right;font-size:12px;font-weight:800">${l.vendas_min != null ? fN(l.vendas_min) : '—'}</td>
    </tr>`).join('');
  return pan('🎯 Meta mínima do mês — break-even (custo ÷ margem marginal das premissas)', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px;text-align:center">
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">R$ ${kR$(be.custo_mes)}</div><div class="tiny muted">custo do mês (orçado + Meta real)</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">${fN(be.margem_ponderada_pct)}%</div><div class="tiny muted">margem marginal ponderada</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">${be.vgv_minimo ? 'R$ ' + kR$(be.vgv_minimo) : '—'}</div><div class="tiny muted">VGV mínimo pra zerar</div></div>
      <div style="background:var(--bg-3);border-radius:8px;padding:8px"><div style="font-size:18px;font-weight:900">R$ ${kR$(be.gerado_mes)}</div><div class="tiny muted">gerado no mês (receita − com. − imposto)</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="flex:1;height:16px;background:var(--bg-3);border-radius:8px;overflow:hidden;position:relative">
        <div style="height:100%;width:${Math.min(100, pct / 140 * 100)}%;background:${cor};border-radius:8px"></div>
        <div style="position:absolute;left:${100 / 140 * 100}%;top:-2px;bottom:-2px;width:2px;background:var(--ink)" title="break-even (100%)"></div>
      </div>
      <span class="tiny" style="font-weight:800;color:${cor};white-space:nowrap">${be.cobertura_pct != null ? fN(be.cobertura_pct) + '%' : '—'} · ${lbl}</span>
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr class="tiny muted" style="text-align:right"><th style="text-align:left">Frente</th><th>Margem</th><th>Peso</th><th>VGV mín.</th><th>Ticket</th><th>Vendas mín.</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="tiny muted" style="margin-top:6px">Margem marginal = comissão bruta − comissões internas − imposto (premissas da Viabilidade, editáveis lá). Peso = VGV orçado do mês (sem orçado, realizado do ano). É a MESMA conta do break-even dos Cenários — aqui vira meta mínima acompanhada.</div>`);
}
