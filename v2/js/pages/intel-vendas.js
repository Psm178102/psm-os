/* PSM-OS v2 — Cérebro de Vendas (Sales Intelligence)
   Pontua cada lead aberto (0-100 + probabilidade calibrada por taxa real de
   canal × etapa × recência × engajamento), prioriza o que atacar hoje,
   clusteriza os motivos de perda, projeta o fechamento do mês ponderado pelo
   pipeline e gera o "plano de ataque" com Opus 4.8 sob demanda.
   Tudo dado real do RD — probabilidade é estimativa calibrada, não ML treinado. */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { montarDecisoes } from '../decisoes.js';   // v87.95 🧭 Decidir agora (tela cerebro)

let _root = null, _d = null, _lookback = 120, _tab = 'top', _aiBusy = false;

const TEMP = {
  quente: { c: '#16a34a', lbl: '🟢 Quente', sub: 'alta probabilidade' },
  morno: { c: '#d97706', lbl: '🟡 Morno', sub: 'média' },
  frio: { c: '#64748b', lbl: '⚪ Frio', sub: 'baixa' },
};

export async function pageIntelVendas(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder ou acima.</div>';
    return;
  }
  await reload();
}

async function reload(fresh) {
  _root.innerHTML = spinner('Pontuando o pipeline e projetando o fechamento…');
  try {
    if (fresh) { try { await api.request('/api/v3/crm/sync_if_stale?hours=0'); } catch (_) {} }   // 🔄 renova a FONTE (RD) antes de recalcular
    const r = await api.request('/api/v3/intel/sales_brain?lookback=' + _lookback + (fresh ? '&fresh=1' : ''));
    _d = r && r.ok ? r : null;
    if (!_d) { _root.innerHTML = `<div class="alert alert-err">Não consegui carregar o Cérebro de Vendas: ${escapeHtml((r && r.error) || 'erro')}</div>`; return; }
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
    return;
  }
  render();
}

/* ───────────────────────── RENDER ───────────────────────── */
function render() {
  const s = _d.summary || {}, fc = _d.forecast || {}, wr = _d.winrate || {};
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">🧠 Cérebro de Vendas</h2>
          <p class="card-sub">${fmtNum(s.open_total || 0)} negócios abertos pontuados · ${fmtNum(s.quentes || 0)} 🟢 quentes${fc.projecao_oficial ? ` · 📈 provável do mês R$ ${moneyShort(fc.projecao_oficial.provavel.vgv)} (${fmtN1(fc.projecao_oficial.provavel.vendas)} vendas)` : ''} · win rate ${wr.overall_pct != null ? pct2(wr.overall_pct) : '—'}${_d.dados_de_hhmm ? ` · dados de <b title="último sync do RD — o mesmo retrato em todas as telas">${escapeHtml(_d.dados_de_hhmm)}</b>` : ''}</p>
        </div>
        <select id="cv-lb" class="select" style="padding:5px 10px;font-size:12px" title="Janela de análise de fechamentos/perdas">
          ${[90, 120, 180, 365].map(n => `<option value="${n}"${n === _lookback ? ' selected' : ''}>Perdas: ${n}d</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="cv-fresh" title="sincroniza o RD agora e recalcula">🔄</button>
        <button class="btn btn-primary" id="cv-ai">🧠 Plano de ataque (IA)</button>
      </div>

      <div id="cv-dec" style="margin-top:10px"></div>

      ${forecastPanel(fc)}

      <!-- pills -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px">
        ${pill('🟢 Quentes', fmtNum(s.quentes || 0), 'alta prob. de fechar', TEMP.quente.c)}
        ${pill('🟡 Mornos', fmtNum(s.mornos || 0), 'prob. média', TEMP.morno.c)}
        ${pill('⚪ Frios', fmtNum(s.frios || 0), 'prob. baixa', TEMP.frio.c)}
        ${pill('💎 Pipeline quente', 'R$ ' + moneyShort(s.pipeline_quente_vgv || 0), 'score × valor dos quentes (prioridade)', '#7c3aed')}
        ${pill('📉 Perdas analisadas', fmtNum((_d.loss && _d.loss.total) || 0), `últimos ${s.lookback_dias || _lookback}d`, '#dc2626')}
      </div>

      <div id="cv-ai-box" style="margin-top:14px"></div>

      <!-- mesa de prioridade -->
      <div style="margin-top:16px">
        <div class="flex items-center gap-2" style="flex-wrap:wrap">
          <h3 class="card-title">🎯 Mesa de prioridade — atacar primeiro</h3>
          <div style="margin-left:auto;display:flex;gap:4px">
            ${tabBtn('top', '🔝 Maior score')}
            ${tabBtn('urg', '🔥 Mais urgentes')}
          </div>
        </div>
        ${priorityTable(_tab === 'urg' ? (_d.urgentes || []) : (_d.top_priority || []), _tab)}
      </div>

      <!-- por etapa + win rate canal -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:16px">
        ${etapaPanel(_d.etapas || [])}
        ${canalPanel(wr)}
      </div>

      <!-- motivos de perda -->
      ${lossPanel(_d.loss || {})}

      <!-- por corretor -->
      <h3 class="card-title" style="margin-top:18px">👤 Por corretor</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:8px">
        ${(_d.corretores || []).map(corretorCard).join('') || '<div class="tiny muted">Sem corretores no filtro.</div>'}
      </div>

      <div class="tiny muted" style="margin-top:14px">
        ${_d.model ? escapeHtml(_d.model.nota) : ''} A IA escreve o plano de ataque a partir destes fatos — clique em "Plano de ataque (Opus 4.8)".
      </div>
    </div>`;

  document.getElementById('cv-lb').addEventListener('change', e => { _lookback = parseInt(e.target.value, 10) || 120; reload(); });
  document.getElementById('cv-ai').addEventListener('click', runAI);
  document.getElementById('cv-fresh').addEventListener('click', () => reload(true));
  montarDecisoes(document.getElementById('cv-dec'), { tela: 'cerebro', max: 5 });
  _root.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => { _tab = el.dataset.tab; render(); }));
}

function pill(title, big, sub, color) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${color};border-radius:var(--r-md);padding:10px 12px">
    <div style="font-size:11px;font-weight:700;color:var(--ink-muted)">${title}</div>
    <div style="font-size:22px;font-weight:900;color:${color};margin:2px 0">${big}</div>
    <div class="tiny muted">${sub}</div></div>`;
}

/* v87.95 — número-título = PROJEÇÃO OFICIAL do mês (Dicionário §8A), a mesma da Gestão Comercial, do 1:1 e do Meu dia.
   O pipeline ponderado fica como leitura de prioridade: soma score × valor de todos os abertos e não é calibrado. */
const PSTATUS = {
  batida: ['🏆 meta batida', '#16a34a'], no_ritmo: ['🟢 vai bater', '#16a34a'], atras: ['🟡 atrás (70–99%)', '#d97706'],
  fora: ['🔴 fora (<70%)', '#dc2626'], sem_meta: ['sem meta', '#64748b'],
};
function forecastPanel(fc) {
  const p = fc && fc.projecao_oficial;
  if (!p) {
    if (!fc || !fc.pipeline_ponderado_vgv) return '';
    return `<div class="alert alert-warn tiny" style="margin-top:12px">Projeção oficial do mês indisponível agora — tente 🔄 em instantes. Pipeline ponderado (score dos abertos, não é previsão): R$ ${moneyShort(fc.pipeline_ponderado_vgv)}.</div>`;
  }
  const [stLbl, stCor] = PSTATUS[p.status] || ['—', '#64748b'];
  const hz = fc.horizonte || {}, du = hz.dias_uteis || {};
  return `<div style="margin-top:12px;background:linear-gradient(180deg,rgba(124,58,237,.07),transparent);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px">
    <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:10px"><div style="font-weight:800;font-size:13px">🎯 Meta · Realizado · Projeção do mês</div><span class="tiny" style="font-weight:800;color:${stCor}">● ${stLbl}</span><span class="tiny muted" style="margin-left:auto">mesma projeção da Gestão Comercial e do 1:1${du.total ? ` · dia útil ${du.decorridos}/${du.total}` : ''}</span></div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end">
      <div><div class="tiny muted">✅ Realizado</div><div style="font-size:20px;font-weight:900">R$ ${moneyShort(p.realizado.vgv)}</div><div class="tiny muted">${fmtNum(p.realizado.vendas)} venda(s)${p.realizado.pct_meta != null ? ' · ' + pct2(p.realizado.pct_meta) + ' da meta' : ''}</div></div>
      <div style="border-left:1px solid var(--border);padding-left:20px"><div class="tiny muted">📈 Provável <span title="Realizado + o maior entre o ritmo dos últimos 180 dias e as propostas abertas × taxa real proposta→venda que cabe no prazo">ⓘ</span></div><div style="font-size:26px;font-weight:900;color:var(--roxo)">R$ ${moneyShort(p.provavel.vgv)}</div><div class="tiny muted">${fmtN1(p.provavel.vendas)} vendas${p.provavel.pct_meta != null ? ' · ' + pct2(p.provavel.pct_meta) + ' da meta' : ''} · faixa R$ ${moneyShort(p.conservador.vgv)}–${moneyShort(p.otimista.vgv)}</div></div>
      <div style="border-left:1px solid var(--border);padding-left:20px"><div class="tiny muted">🎯 Meta do mês</div><div style="font-size:20px;font-weight:900">${p.meta.vgv ? 'R$ ' + moneyShort(p.meta.vgv) : '—'}</div><div class="tiny muted">${p.meta.vendas ? '≈ ' + fmtN1(p.meta.vendas) + ' vendas' : 'sem meta cadastrada'}</div></div>
      ${p.falta_vgv ? `<div style="border-left:1px solid var(--border);padding-left:20px"><div class="tiny muted">Falta</div><div style="font-size:20px;font-weight:900">R$ ${moneyShort(p.falta_vgv)}</div><div class="tiny muted">${p.falta_vendas ? '≈ ' + fmtN1(p.falta_vendas) + ' vendas' : ''}${p.por_dia_util_vgv ? ' · R$ ' + moneyShort(p.por_dia_util_vgv) + '/dia útil' : ''}</div></div>` : ''}
    </div>
    <div class="tiny muted" style="margin-top:10px">💎 Pipeline ponderado dos abertos: R$ ${moneyShort(fc.pipeline_ponderado_vgv || 0)} (${fc.pipeline_ponderado_vendas || 0} negócios-equivalentes) — serve pra <b>ordenar a fila de ataque</b>, não é previsão do mês.</div>
  </div>`;
}

function tabBtn(id, lbl) {
  const on = _tab === id;
  return `<button data-tab="${id}" class="btn" style="padding:4px 10px;font-size:12px;${on ? 'background:var(--accent,#7c3aed);color:#fff;border-color:transparent' : ''}">${lbl}</button>`;
}

function scoreBadge(sc, temp) {
  const c = (TEMP[temp] || TEMP.frio).c;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:24px;border-radius:6px;background:${c}1a;color:${c};font-weight:900;font-size:13px;border:1px solid ${c}55">${sc}</span>`;
}

function priorityTable(rows, mode) {
  if (!rows.length) return '<div class="tiny muted" style="padding:10px">Nenhum lead nesta lista. 🎉</div>';
  return `<div style="overflow-x:auto;margin-top:8px">
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:680px">
      <thead><tr style="text-align:left;color:var(--ink-muted);font-size:11px">
        <th style="padding:6px 8px">Score</th><th>Negócio</th><th>Etapa</th><th style="text-align:right">Valor</th><th>Canal</th><th style="text-align:center">Parado</th><th>Próxima ação</th><th>Corretor</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const stale = r.dias_parado != null ? r.dias_parado + 'd' : '—';
        const staleC = (r.dias_parado || 0) > 14 ? '#dc2626' : (r.dias_parado || 0) > 7 ? '#d97706' : 'var(--ink-muted)';
        return `<tr style="border-top:1px solid var(--border)">
          <td style="padding:7px 8px">${scoreBadge(r.score, r.temp)}</td>
          <td style="max-width:200px"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.title)}</div></td>
          <td><span class="tiny" style="color:var(--ink-muted)">${escapeHtml(r.ms_label || '—')}</span></td>
          <td style="text-align:right;font-weight:700;white-space:nowrap">R$ ${moneyShort(r.amount)}</td>
          <td><span class="tiny">${escapeHtml(r.canal || '—')}</span></td>
          <td style="text-align:center;color:${staleC};font-weight:700">${stale}</td>
          <td style="font-size:12px">${escapeHtml(r.acao || '')}</td>
          <td><span class="tiny" style="color:var(--ink-muted)">${escapeHtml(r.owner_name || '—')}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function etapaPanel(etapas) {
  if (!etapas.length) return '';
  const max = Math.max(...etapas.map(e => e.expected_vgv || 0), 1);
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">📊 Pipeline por etapa <span class="tiny muted" style="font-weight:400">(valor esperado)</span></div>
    ${etapas.map(e => `<div style="margin:6px 0">
      <div class="flex items-center gap-2" style="font-size:12px"><span style="flex:1">${escapeHtml(e.etapa)}</span><span class="tiny muted">${e.n}</span><span style="font-weight:700">R$ ${moneyShort(e.expected_vgv)}</span></div>
      <div style="height:6px;background:var(--bg-3);border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${Math.round((e.expected_vgv || 0) / max * 100)}%;background:#7c3aed"></div></div>
    </div>`).join('')}
  </div>`;
}

function canalPanel(wr) {
  const rows = wr.por_canal || [];
  if (!rows.length) return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px"><div style="font-weight:800;font-size:13px">🎯 Conversão por canal</div><div class="tiny muted" style="margin-top:6px">Sem base suficiente de fechamentos para calcular.</div></div>`;
  const max = Math.max(...rows.map(r => r.wr_pct || 0), 1);
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px">
    <div style="font-weight:800;font-size:13px;margin-bottom:8px">🎯 Conversão real por canal <span class="tiny muted" style="font-weight:400">(base do scoring)</span></div>
    ${rows.map(r => `<div style="margin:6px 0">
      <div class="flex items-center gap-2" style="font-size:12px"><span style="flex:1">${escapeHtml(r.canal)}</span><span class="tiny muted">${r.n} fech.</span><span style="font-weight:700">${pct2(r.wr_pct)}</span></div>
      <div style="height:6px;background:var(--bg-3);border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${Math.round((r.wr_pct || 0) / max * 100)}%;background:#16a34a"></div></div>
    </div>`).join('')}
  </div>`;
}

function lossPanel(loss) {
  const cats = loss.categorias || [];
  if (!cats.length) return '';
  const max = Math.max(...cats.map(c => c.n || 0), 1);
  return `<div style="margin-top:16px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px">
    <div class="flex items-center gap-2" style="margin-bottom:4px">
      <div style="font-weight:800;font-size:13px">📉 Por que estamos perdendo</div>
      <span class="tiny muted" style="margin-left:auto">${loss.total || 0} perdas · ${pct2(loss.trash_pct || 0)} lixo/desqualificado</span>
    </div>
    <div style="display:grid;gap:6px;margin-top:8px">
      ${cats.map(c => `<div>
        <div class="flex items-center gap-2" style="font-size:12.5px"><span style="font-weight:600">${escapeHtml(c.label)}</span><span class="tiny muted">${c.exemplos && c.exemplos.length ? '· ' + escapeHtml(c.exemplos.slice(0, 2).join(' · ')) : ''}</span><span style="margin-left:auto;font-weight:800">${c.n} <span class="tiny muted">(${pct2(c.pct)})</span></span></div>
        <div style="height:6px;background:var(--bg-3);border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${Math.round((c.n || 0) / max * 100)}%;background:#dc2626"></div></div>
      </div>`).join('')}
    </div>
  </div>`;
}

function corretorCard(c) {
  const alvo = c.sem_contato_48h > 0 || c.parados_14d > 0;
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px">
    <div class="flex items-center gap-2" style="margin-bottom:8px">
      <div style="width:28px;height:28px;border-radius:50%;background:${c.color || '#7c3aed'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${escapeHtml(c.ini || (c.name || '?').slice(0, 2).toUpperCase())}</div>
      <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name || '—')}</div><div class="tiny muted">${escapeHtml(c.team || '')} · ${c.open_count} abertos</div></div>
      ${c.projecao_mes
        ? `<div style="text-align:right" title="projeção oficial do mês · pipeline ponderado R$ ${moneyShort(c.pipeline_ponderado_vgv)} (prioridade)"><div style="font-weight:900;font-size:15px;color:${(PSTATUS[c.projecao_mes.status] || [0, 'var(--roxo)'])[1]}">R$ ${moneyShort(c.projecao_mes.provavel.vgv)}</div><div class="tiny muted">📈 provável · ${fmtN1(c.projecao_mes.provavel.vendas)} vendas</div></div>`
        : `<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:var(--roxo)">R$ ${moneyShort(c.pipeline_ponderado_vgv)}</div><div class="tiny muted">pipeline pond.</div></div>`}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
      <span style="background:${TEMP.quente.c}1a;color:${TEMP.quente.c};font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px">${c.quentes} 🟢</span>
      <span style="background:${TEMP.morno.c}1a;color:${TEMP.morno.c};font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px">${c.mornos} 🟡</span>
      ${c.sem_contato_48h > 0 ? `<span style="background:#dc26261a;color:var(--err);font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px">${c.sem_contato_48h} sem 1º contato</span>` : ''}
      ${c.parados_14d > 0 ? `<span style="background:#d977061a;color:var(--warn);font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px">${c.parados_14d} parados +14d</span>` : ''}
    </div>
    ${(c.top_leads || []).slice(0, 3).map(l => `<div class="flex items-center gap-2" style="font-size:11.5px;padding:3px 0;border-top:1px solid var(--border)">
      ${scoreBadge(l.score, l.temp)}<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(l.acao)}</span><span class="tiny muted">R$ ${moneyShort(l.amount)}</span></div>`).join('')}
  </div>`;
}

/* ───────────────────────── IA (Opus 4.8) ───────────────────────── */
async function runAI() {
  const box = document.getElementById('cv-ai-box');
  if (_aiBusy) return;
  _aiBusy = true;
  box.innerHTML = `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:14px"><span class="spinner"></span> O Cérebro de Vendas está montando o plano de ataque…</div>`;
  try {
    const fc = _d.forecast || {}, wr = _d.winrate || {}, loss = _d.loss || {};
    const urg = (_d.urgentes || []).slice(0, 10).map(r => `- ${r.title} (score ${r.score}, ${r.ms_label}, R$ ${money(r.amount)}, parado ${r.dias_parado ?? '?'}d, ${r.owner_name}) → ${r.acao}`).join('\n');
    const corr = (_d.corretores || []).filter(c => c.sem_contato_48h || c.parados_14d || c.quentes)
      .map(c => `- ${c.name}: ${c.quentes} quentes, ${c.sem_contato_48h} sem 1º contato, ${c.parados_14d} parados +14d${c.projecao_mes ? `, provável do mês R$ ${money(c.projecao_mes.provavel.vgv)} (${c.projecao_mes.provavel.vendas} vendas, ${(PSTATUS[c.projecao_mes.status] || ['—'])[0]})` : ''}`).join('\n');
    const po = fc.projecao_oficial;
    const lossTxt = (loss.categorias || []).map(c => `- ${c.label}: ${c.n} (${c.pct}%)`).join('\n');
    const canalTxt = (wr.por_canal || []).map(c => `- ${c.canal}: ${c.wr_pct}% (${c.n} fech.)`).join('\n');
    const prompt = `Você é o diretor de inteligência de vendas da PSM Imobiliária (São José do Rio Preto, alto padrão + MCMV + locação). Com base nos FATOS REAIS do pipeline (RD CRM), escreva um PLANO DE ATAQUE DE VENDAS desta semana pro sócio Paulo, em markdown, direto e acionável. NÃO invente números além dos fatos.

Estruture em:
1) **Leitura rápida** (2-3 linhas: saúde do funil e da projeção do mês).
2) **Atacar HOJE** (os leads/corretores mais urgentes e por quê).
3) **Onde está o dinheiro travado** (pipeline quente: o que destravar pra fechar o mês).
4) **Padrão de perdas** (o que os motivos revelam — ajustar qualificação? segmentação de ads? script?).
5) **1 recado por corretor crítico** (curto).

== PROJEÇÃO OFICIAL DO MÊS (a única previsão — mesma da Gestão Comercial e do 1:1) ==
${po ? `Realizado: R$ ${money(po.realizado.vgv)} (${po.realizado.vendas} vendas). Provável: R$ ${money(po.provavel.vgv)} (${po.provavel.vendas} vendas${po.provavel.pct_meta != null ? `, ${po.provavel.pct_meta}% da meta` : ''}); faixa R$ ${money(po.conservador.vgv)} a R$ ${money(po.otimista.vgv)}. Meta: R$ ${money(po.meta.vgv)}. Status: ${(PSTATUS[po.status] || ['—'])[0]}.${po.falta_vgv ? ` Falta R$ ${money(po.falta_vgv)}${po.por_dia_util_vgv ? ` (R$ ${money(po.por_dia_util_vgv)} por dia útil)` : ''}.` : ''}` : '(indisponível)'}
Pipeline ponderado dos abertos (score × valor; serve para PRIORIZAR, NÃO é previsão — não use como projeção): R$ ${money(fc.pipeline_ponderado_vgv)}; quentes R$ ${money(fc.pipeline_quente_vgv)}. Win rate global: ${wr.overall_pct ?? '—'}%.

== CONVERSÃO POR CANAL ==
${canalTxt || '(sem base)'}

== LEADS MAIS URGENTES ==
${urg || '(nenhum urgente)'}

== CORRETORES (atenção) ==
${corr || '(todos ok)'}

== MOTIVOS DE PERDA (${loss.total || 0} perdas) ==
${lossTxt || '(sem dados)'}`;
    const j = await api.request('/api/v3/ia/analyze', { method: 'POST', body: { prompt, max_tokens: 3500, dossie: true } });   // cérebro novo (Sonnet 5 + dossiê) v84.4
    if (j.ok && j.text) {
      box.innerHTML = `<div style="background:linear-gradient(180deg,rgba(124,58,237,.06),transparent);border:1px solid rgba(124,58,237,.25);border-radius:var(--r-md);padding:14px 16px">
        <div style="font-weight:800;font-size:13px;margin-bottom:8px;color:var(--roxo)">🧠 Plano de ataque <span class="tiny muted" style="font-weight:400">· ${escapeHtml(j.model_used || 'IA')}</span></div>
        <div style="font-size:13px;line-height:1.55">${mdLite(j.text)}</div></div>`;
    } else {
      box.innerHTML = `<div class="alert alert-warn">IA indisponível: ${escapeHtml(j.error || 'erro')}</div>`;
    }
  } catch (e) {
    box.innerHTML = `<div class="alert alert-err">Erro na análise: ${escapeHtml(e.message)}</div>`;
  } finally { _aiBusy = false; }
}

/* ─── helpers ─── */
function mdLite(t) {
  return escapeHtml(t)
    .replace(/^#### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^## (.*)$/gm, '<div style="font-weight:800;font-size:14px;margin:10px 0 4px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*] (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}
function spinner(t) { return `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${t}</div></div>`; }
function money(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function moneyShort(v) { return money(v); }
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function fmtNum(v) { return (v || 0).toLocaleString('pt-BR'); }
function fmtN1(v) { return (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
