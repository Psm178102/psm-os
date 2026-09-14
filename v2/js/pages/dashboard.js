/* ============================================================================
   PSM-OS v2 — 📊 Indicadores do mês (o que sobrou da Home)
   ----------------------------------------------------------------------------
   v87.81: a rota '/' virou a tela 📅 Agenda & Tarefas (pages/agenda-tarefas.js).
   O card "✅ Tarefas & pendências", a Agenda embutida e o "Plano do mês" (um 2º
   calendário do mesmo feed) foram absorvidos por ela. Este módulo mantém só os
   NÚMEROS — VGV/meta/pipeline, produtividade, ranking real (OO), comissões,
   equipe e atalhos — e é montado recolhível no fim daquela tela.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const SCOPE_LBL = {
  global: '👁 Visão global (Sócio/Gerente)',
  team:   '👥 Sua equipe (Líder)',
  self:   '👤 Seus dados',
};

// rótulos das frentes (Central de Frentes) pro breakdown do pipeline
const FRENTE_LBL = { conquista: '🏆 Conquista', map: '🏠 MAP', terceiros: '🔁 Terceiros',
  locacoes: '🔑 Locação', outros: '📦 Outros' };

// Time comercial vê os números de venda (VGV/meta/pipeline/ticket/ranking).
// Backoffice/secretaria, marketing e financeiro NÃO — não faz sentido pra eles.
const COMERCIAL_ROLES = ['corretor', 'lider', 'líder', 'gerente', 'socio', 'sócio', 'diretor'];
function ehComercial() { return COMERCIAL_ROLES.includes((auth.user()?.role || '').toLowerCase()); }

const CSS = `<style>
.gz{flex:1;min-width:230px;background:var(--bg-1,#fff);border:1px solid var(--bd);border-radius:14px;padding:15px 17px}
.gz-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.gz-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:800;color:var(--ink-muted,#94a3b8)}
.gz-pct{font-size:28px;font-weight:900;line-height:1}
.gz-track{height:10px;border-radius:6px;background:rgba(148,163,184,.18);overflow:hidden;margin-top:10px}
.gz-fill{height:100%;border-radius:6px;transition:width .4s}
.gz-sub{font-size:11px;color:var(--ink-muted,#94a3b8);margin-top:7px}
</style>`;

/** Monta os indicadores dentro de `host`. `prod` = produtividade que o feed já trouxe. */
export async function montarIndicadores(host, { prod, overview } = {}) {
  if (!host) return;
  host.innerHTML = '<div class="flex items-center gap-2 muted" style="padding:8px 0"><span class="spinner"></span> Carregando indicadores…</div>';
  const isGestor = (auth.user()?.lvl || 0) >= 5;
  let d = null, oo = null;
  try {
    // a tela já carregou o overview pra faixa de projeção → não busca 2x (v87.82)
    const calls = [overview ? Promise.resolve(overview) : api.request('/api/v3/metrics/overview')];
    // Ranking de vendas real (mês) — só gestor (o endpoint exige lvl>=5)
    if (isGestor) calls.push(api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null));
    const res = await Promise.all(calls);
    d = res[0]; oo = isGestor ? res[1] : null;
  } catch (e) {
    host.innerHTML = `<div class="alert alert-err">Não consegui carregar os indicadores: ${escapeHtml(e.message)}</div>`;
    return;
  }
  if (!host.isConnected) return;
  host.innerHTML = render(d || {}, oo, prod || {});
}

function render(d, board, prod) {
  const comercial = ehComercial();
  const hasFunis = (d.pipelines?.count_total || 0) > 0;
  return `${CSS}
    <div class="tiny muted" style="margin-bottom:10px">${SCOPE_LBL[d.scope] || ''} · atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>

    ${metricsRow(d, prod)}

    <!-- HERO KPIs — VENDAS + META (só time comercial) -->
    ${comercial ? `<div class="flex gap-3" style="flex-wrap:wrap">
      ${heroKpi('💰 VGV no Mês',  'R$ ' + fmtKM(d.sales?.vgv_mes), `${d.sales?.vendas_mes || 0} venda(s) fechada(s)`,          '#16a34a')}
      ${heroKpi('🎯 Meta do Mês', 'R$ ' + fmtKM(d.metas?.meta_vgv), pctMeta(d.sales?.vgv_mes, d.metas?.meta_vgv),               '#d4a843')}
      ${heroKpi('📈 Pipeline em andamento', 'R$ ' + fmtKM(d.sales?.pipeline_vgv), `${d.sales?.pipeline_count || 0} em atendimento (ativ. ≤${d.sales?.pipeline_dias || 30}d)`, '#3b82f6')}
      ${heroKpi('🏆 Ticket Médio','R$ ' + fmtKM(d.sales?.ticket_medio_mes), 'média da venda no mês',                             '#8b5cf6')}
    </div>
    ${(d.sales?.pipeline_frentes || []).length ? `<div class="tiny muted" style="margin-top:6px">
      📈 Por funil: ${(d.sales.pipeline_frentes).map(([f, n, vgv, sv]) =>
        `<b>${escapeHtml(FRENTE_LBL[f] || f)}</b> R$ ${fmtKM(vgv)} (${n}${sv ? `, ${sv} s/ valor` : ''})`).join(' · ')}
      · base total: ${fmtNum(d.sales?.pipeline_base_count)} abertos (R$ ${fmtKM(d.sales?.pipeline_base_vgv)})
    </div>` : ''}` : ''}

    <!-- KPIs SECUNDÁRIOS (VGV são comerciais; Tarefas vale pra todos) -->
    <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
      ${comercial ? `
      ${kpiCard('💰 VGV 30 dias',  'R$ ' + fmtKM(d.sales?.vgv_30d),    `${d.sales?.vendas_30d || 0} vendas`,                  '#16a34a')}
      ${kpiCard('💎 VGV no Ano',   'R$ ' + fmtKM(d.sales?.vgv_ano),    `${d.sales?.vendas_ano || 0} vendas no ano`,           '#0891b2')}
      ${kpiCard('❌ Perdidos mês', 'R$ ' + fmtKM(d.sales?.vgv_perdido_mes), `${d.sales?.perdidos_mes || 0} oportunidades`,    '#dc2626')}` : ''}
      ${kpiCard('📋 Tarefas',      fmtNum(d.tasks?.pending),          `${d.tasks?.done || 0} feitas / ${d.tasks?.total || 0} total`, '#f59e0b')}
    </div>

    <!-- KPIs DE APOIO (limpos, sem ruído de sistema) -->
    <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
      ${kpiCard('👥 Equipe',    fmtNum(d.users?.total),         `${d.users?.ativos || 0} ativos`,         '#2563eb')}
      ${kpiCard('💎 Comissões', 'R$ ' + fmtKM(d.commissions?.valor_pendente), `${d.commissions?.pendentes || 0} a pagar`, '#7c3aed')}
      ${hasFunis ? kpiCard('🔗 Funis RD', fmtNum(d.pipelines?.count_active), `de ${d.pipelines?.count_total} ativos`, '#0d9488') : ''}
    </div>

    <!-- DISTRIBUIÇÃO POR EQUIPE -->
    ${(d.users?.by_team && Object.keys(d.users.by_team).length > 1) ? `
    <div class="card mt-4">
      <h3 class="card-title">👥 Distribuição por equipe</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        ${Object.entries(d.users.by_team).map(([t, n]) => teamChip(t, n)).join('')}
      </div>
    </div>` : ''}

    <!-- 🏆 RANKING DE VENDAS DO MÊS (dado real do RD, só gestor) -->
    ${salesBoard(board)}

    <!-- 💎 COMISSÕES -->
    ${(d.commissions?.count || 0) > 0 ? `
      <div class="card mt-4">
        <h3 class="card-title">💎 Resumo de Comissões</h3>
        <div class="flex gap-3" style="flex-wrap:wrap">
          ${kpiMini('Total registrado', 'R$ ' + fmtMoney(d.commissions.valor_total))}
          ${kpiMini('Pendente',          'R$ ' + fmtMoney(d.commissions.valor_pendente), '#d97706')}
          ${kpiMini('# pagas',           d.commissions.pagas, '#16a34a')}
          ${kpiMini('# pendentes',       d.commissions.pendentes, '#d97706')}
        </div>
      </div>
    ` : ''}

    <!-- atalhos -->
    <div class="card mt-4">
      <h3 class="card-title">⚡ Atalhos</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        ${shortcut('🔗 CRM (RD)', '#/crm')}
        ${shortcut('🎯 Cérebro de Vendas', '#/cerebro-vendas')}
        ${shortcut('📥 Captações', '#/captacoes')}
        ${shortcut('💰 Financeiro', '#/financeiro')}
        ${shortcut('📊 Metas', '#/metas')}
        ${shortcut('👥 One-on-One', '#/one-on-one')}
      </div>
    </div>`;
}

/* ═══ % da meta + % de produtividade ═══ */
function gauge(label, pct, sub, cor) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="gz" style="border-color:${cor}55">
    <div class="gz-top"><span class="gz-lbl">${label}</span><span class="gz-pct" style="color:${cor}">${pct2(pct)}</span></div>
    <div class="gz-track"><div class="gz-fill" style="width:${p}%;background:${cor}"></div></div>
    <div class="gz-sub">${sub || ''}</div></div>`;
}
function miniMetric(label, big, sub, cor) {
  return `<div style="flex:1;min-width:160px;background:var(--bg-3);border-radius:14px;padding:14px 16px;border-left:4px solid ${cor}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:800">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${cor};margin-top:2px">${big}</div><div class="tiny muted">${sub || ''}</div></div>`;
}

function metricsRow(d, prod) {
  const isCorretor = (auth.user()?.role || '').toLowerCase().startsWith('corretor');
  const metaVgv = d.metas?.meta_vgv || 0, vgvMes = d.sales?.vgv_mes || 0;
  const metaPct = metaVgv > 0 ? (vgvMes / metaVgv * 100) : null;
  const cards = [];
  if (metaPct !== null) cards.push(gauge('🎯 Meta do mês', metaPct, `R$ ${fmtKM(vgvMes)} de R$ ${fmtKM(metaVgv)}`, metaPct >= 100 ? '#16a34a' : metaPct >= 70 ? '#d4a843' : '#dc2626'));
  if (isCorretor) {
    cards.push(miniMetric('💰 VGV no mês', 'R$ ' + fmtKM(vgvMes), `${d.sales?.vendas_mes || 0} venda(s)`, '#16a34a'));
    cards.push(miniMetric('📈 Pipeline', 'R$ ' + fmtKM(d.sales?.pipeline_vgv), `${d.sales?.pipeline_count || 0} aberto(s)`, '#3b82f6'));
  } else {
    const pct = prod.pct;
    const sub = prod.solicitadas != null && prod.solicitadas > 0
      ? `${prod.concluidas || 0}/${prod.solicitadas} concluídas · ${prod.atrasadas || 0} atrasada(s)`
      : 'sem tarefas atribuídas ainda';
    cards.push(gauge('⚡ Produtividade', pct, sub, pct == null ? '#94a3b8' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d4a843' : '#dc2626'));
  }
  if (!cards.length) return '';
  return `<div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">${cards.join('')}</div>`;
}

/* ─── Ranking de vendas do mês (real, via OO) ─── */
function salesBoard(board) {
  if (!ehComercial()) return '';               // backoffice/marketing/financeiro não veem ranking de vendas
  if ((auth.user()?.lvl || 0) < 5) return ''; // corretor não vê ranking de todos
  if (!board) return '';
  const all = (board.corretores || []).filter(c => !c.is_team);
  if (!all.length) return '';
  const ranked = all.slice().sort((a, b) => (b.vgv || 0) - (a.vgv || 0) || (b.vendas || 0) - (a.vendas || 0));
  const comVenda = ranked.filter(c => (c.vendas || 0) > 0);
  const lista = (comVenda.length ? comVenda : ranked).slice(0, 8);
  const totalVgv = ranked.reduce((s, c) => s + (c.vgv || 0), 0);
  const totalVendas = ranked.reduce((s, c) => s + (c.vendas || 0), 0);
  return `
    <div class="card mt-4">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h3 class="card-title" style="flex:1;min-width:200px">🏆 Ranking de Vendas — mês</h3>
        <span class="tiny muted">${totalVendas} venda(s) · R$ ${fmtKM(totalVgv)} VGV no time</span>
      </div>
      ${comVenda.length === 0 ? '<div class="muted tiny" style="margin-top:6px">Ainda sem vendas fechadas neste mês — ranking por pipeline/atividade aparece aqui assim que fechar a primeira.</div>' : ''}
      <div style="display:grid;gap:6px;margin-top:8px">
        ${lista.map((c, i) => salesRow(c, i)).join('')}
      </div>
    </div>`;
}

function salesRow(c, i) {
  const ini = escapeHtml((c.ini || (c.name || '?').substring(0, 2)).toUpperCase());
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
  return `
    <div style="display:grid;grid-template-columns:34px 30px 1fr auto auto;gap:10px;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:13px">
      <div style="font-size:16px;text-align:center">${medal}</div>
      <div style="width:28px;height:28px;border-radius:50%;background:${c.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${ini}</div>
      <div style="min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name || '—')}</div><div class="tiny muted">${escapeHtml(c.team || 'geral')}</div></div>
      <div style="text-align:right"><div class="tiny muted">vendas</div><div style="font-weight:800;color:var(--info)">${c.vendas || 0}</div></div>
      <div style="text-align:right"><div class="tiny muted">VGV</div><div style="font-weight:900;color:var(--ok)">R$ ${fmtKM(c.vgv)}</div></div>
    </div>`;
}

function shortcut(label, href) {
  return `<a href="${href}" class="btn btn-ghost" style="font-size:13px">${label}</a>`;
}

/* ─── KPI helpers ─── */
function kpiCard(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:28px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
      <div class="tiny muted">${sub || ''}</div>
    </div>
  `;
}

function heroKpi(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:200px;background:linear-gradient(135deg, ${color}22, ${color}05);border:1px solid ${color}44;border-radius:var(--r-md);padding:16px 18px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:30px;font-weight:900;color:${color};margin-top:4px;line-height:1.1">${big ?? '—'}</div>
      <div class="tiny muted" style="margin-top:2px">${sub || ''}</div>
    </div>
  `;
}

function pctMeta(real, meta) {
  if (!meta || meta <= 0) return 'meta não definida';
  const pct = (real || 0) / meta * 100;
  const emoji = pct >= 100 ? '🟢' : pct >= 70 ? '🟡' : '🔴';
  return `${emoji} ${pct2(pct)} atingido`;
}

function fmtKM(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }

function kpiMini(label, value, color) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:140px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
      <div style="font-size:18px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
    </div>
  `;
}

function teamChip(team, n) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-full);padding:6px 14px;font-size:12px;font-weight:600">
      ${escapeHtml(team)} <span class="muted">·</span> <b>${n}</b>
    </div>
  `;
}

function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function fmtMoney(n) {
  if (n == null) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── 📈 Meu Acompanhamento na tela inicial (v84.19) ─────────────────────
   Se o user logado é colaborador do Painel de Fiscalização (Mariane/Guilherme…),
   injeta um card compacto com o semáforo pessoal logo abaixo do topo da tela.
   Best-effort: quem não é colaborador não vê NADA (nem erro). */
export async function injectMeuAcompanhamento(root) {
  let card = null;
  try {
    const r = await api.request('/api/v3/producao/painel?visao=me');
    card = (r.cards || [])[0];
  } catch (_) { return; }
  if (!card || !root || !root.isConnected) return;
  if (root.querySelector('#dash-fisc')) return;
  const COR = { verde: '#16a34a', amarelo: '#d97706', vermelho: '#dc2626' };
  const cor = COR[card.semaforo] || '#64748b';
  let miolo = '';
  if (card.placar_mes) {
    const p = card.placar_mes;
    const done = Object.entries(p.metas).filter(([f, m]) => m > 0 && (p.feito[f] || 0) >= m).length;
    miolo = `placar do mês: <b>${done}</b>/${Object.keys(p.metas).length} frentes na meta (rampa ${escapeHtml((card.rampa || '').toUpperCase())})`;
  } else {
    const f = card.motor_feito || {}, m = card.motor_meta || {};
    miolo = `hoje: <b>${f.dia || 0}</b>/${m.dia || 0} · esperado até agora: ${card.esperado_agora}`;
  }
  const el = document.createElement('div');
  el.id = 'dash-fisc';
  el.className = 'card';
  el.style.cssText = `border-left:4px solid ${cor};margin:0`;
  el.innerHTML = `<div class="flex items-center" style="gap:10px;flex-wrap:wrap">
      <span style="width:13px;height:13px;border-radius:50%;background:${cor};flex-shrink:0"></span>
      <b>📈 Meu Acompanhamento</b>
      <span class="tiny">${miolo}</span>
      ${(card.alertas || []).map(a => `<span class="badge" style="background:#dc262622;color:var(--err);font-weight:700">${escapeHtml(a)}</span>`).join(' ')}
      <button class="btn btn-primary btn-sm" style="margin-left:auto" id="dash-fisc-abrir">registrar produção →</button>
    </div>`;
  const topo = root.querySelector('.at-top') || root.querySelector('.card');
  if (!topo) return;
  topo.parentNode.insertBefore(el, topo.nextSibling);
  el.querySelector('#dash-fisc-abrir').onclick = () => { location.hash = '#/minha-producao'; };
}
