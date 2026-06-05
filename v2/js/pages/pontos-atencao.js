/* ============================================================================
   PSM-OS v2 — Pontos de Atenção (radar automático de riscos · Diretoria)
   ----------------------------------------------------------------------------
   Compila SOZINHO os sinais reais já existentes no sistema e os prioriza num
   painel acionável. Nada de cadastro manual, nada inventado:
     • Infra & Integrações  → /api/v3/system_health
     • Vendas & Metas       → /api/v3/metrics/overview (run-rate, pipeline, perdas)
     • Captações            → /api/v3/captacoes/kanban (paradas, sem dono, mídia)
     • Equipe               → /api/v3/oo/overview (concentração, sem venda)
     • Financeiro/Operação  → comissões a pagar (metrics)
   Cada sinal vira um cartão com severidade 🔴/🟡 e deep-link pra resolver.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;

const TERMINAIS = new Set(['aprovado', 'concluido']); // captação encerrada

export async function pagePontosAtencao(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Gerência/Diretoria.</div>';
    return;
  }
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Varrendo o sistema em busca de pontos de atenção…</div></div>`;

  const isGestor = (auth.user()?.lvl || 0) >= 5;
  const [health, metrics, oo, caps] = await Promise.all([
    api.request('/api/v3/system_health').catch(() => null),
    api.request('/api/v3/metrics/overview').catch(() => null),
    isGestor ? api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null) : Promise.resolve(null),
    api.request('/api/v3/captacoes/kanban').catch(() => null),
  ]);

  const signals = [];
  collectInfra(signals, health);
  collectVendas(signals, metrics);
  collectCaptacoes(signals, caps);
  collectEquipe(signals, oo);
  collectOperacao(signals, metrics);

  render(signals);
}

/* ─── Coletores de sinais ─────────────────────────────────────────────── */

function push(arr, sev, area, icon, title, detail, href, hrefLabel) {
  arr.push({ sev, area, icon, title, detail, href, hrefLabel });
}

function collectInfra(arr, health) {
  if (!health) {
    push(arr, 'warn', 'Infra', '🩺', 'Saúde do sistema indisponível', 'Não consegui consultar /system_health agora.', '#/configuracoes', 'Configurações');
    return;
  }
  const AREA_HREF = {
    banco: ['#/configuracoes', 'Configurações'],
    crm: ['#/crm', 'CRM'],
    meta: ['#/marketing', 'Marketing'],
    captura: ['#/configuracoes', 'Configurações'],
    financeiro: ['#/financeiro', 'Financeiro'],
  };
  (health.issues || []).forEach(it => {
    const sev = it.severity === 'error' ? 'crit' : 'warn';
    const [href, lbl] = AREA_HREF[it.area] || ['#/configuracoes', 'Configurações'];
    push(arr, sev, 'Infra & Integrações', '🔌', `${cap(it.area)} — ${it.severity === 'error' ? 'falha' : 'atenção'}`, it.message, href, lbl);
  });
}

function collectVendas(arr, m) {
  if (!m || !m.sales) return;
  const s = m.sales, meta = (m.metas && m.metas.meta_vgv) || 0;
  // 1) Projeção de meta no ritmo atual (run-rate por dia corrido do mês)
  if (meta > 0) {
    const now = new Date();
    const dia = now.getDate();
    const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const frac = Math.max(dia / diasMes, 0.01);
    const proj = (s.vgv_mes || 0) / frac;
    const pct = Math.round(proj / meta * 100);
    const pctReal = Math.round((s.vgv_mes || 0) / meta * 100);
    if (pct < 80) {
      push(arr, 'crit', 'Vendas & Metas', '🎯', `Meta do mês em risco — projeção ~${pct}%`,
        `Hoje ${pctReal}% atingido (R$ ${km(s.vgv_mes)} de R$ ${km(meta)}). No ritmo atual o mês fecha em ~${pct}% da meta.`,
        '#/metas', 'Metas');
    } else if (pct < 100) {
      push(arr, 'warn', 'Vendas & Metas', '🎯', `Meta do mês apertada — projeção ~${pct}%`,
        `${pctReal}% atingido (R$ ${km(s.vgv_mes)} de R$ ${km(meta)}). Projeção no ritmo atual: ~${pct}%.`,
        '#/metas', 'Metas');
    }
    // 2) Pipeline cobre o que falta?
    const falta = Math.max(meta - (s.vgv_mes || 0), 0);
    if (falta > 0 && (s.pipeline_vgv || 0) < falta) {
      push(arr, 'warn', 'Vendas & Metas', '📈', 'Pipeline não cobre o restante da meta',
        `Falta R$ ${km(falta)} pra meta, mas o pipeline aberto soma só R$ ${km(s.pipeline_vgv)} (${s.pipeline_count || 0} negócios). Precisa gerar oportunidade.`,
        '#/crm', 'CRM');
    }
  }
  // 3) Mais perdas que vendas no mês
  if ((s.perdidos_mes || 0) >= 3 && (s.perdidos_mes || 0) > (s.vendas_mes || 0)) {
    push(arr, 'warn', 'Vendas & Metas', '❌', 'Mais perdas que vendas no mês',
      `${s.perdidos_mes} oportunidade(s) perdida(s) (R$ ${km(s.vgv_perdido_mes)}) contra ${s.vendas_mes || 0} venda(s). Revisar motivos de perda.`,
      '#/cerebro-vendas', 'Cérebro de Vendas');
  }
  // 4) Pipeline vazio
  if ((s.pipeline_count || 0) === 0) {
    push(arr, 'crit', 'Vendas & Metas', '🫙', 'Pipeline vazio',
      'Nenhum negócio aberto no CRM. Sem pipeline não há previsibilidade de receita.',
      '#/crm', 'CRM');
  }
}

function collectCaptacoes(arr, c) {
  const items = (c && c.captacoes) || [];
  if (!items.length) return;
  const ativos = items.filter(x => !TERMINAIS.has(x.status));
  const now = Date.now();
  const ageDays = x => {
    const t = x.updated_at || x.created_at;
    if (!t) return null;
    const d = new Date(t).getTime();
    return isNaN(d) ? null : (now - d) / 86400000;
  };
  // 1) Paradas há muito tempo
  const paradas14 = ativos.filter(x => (ageDays(x) || 0) > 14);
  const paradas7 = ativos.filter(x => { const a = ageDays(x) || 0; return a > 7 && a <= 14; });
  if (paradas14.length) {
    push(arr, 'crit', 'Captações', '📥', `${paradas14.length} captação(ões) parada(s) +14 dias`,
      `Sem movimentação há mais de 2 semanas: ${paradas14.slice(0, 3).map(nomeCap).join(', ')}${paradas14.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
  if (paradas7.length) {
    push(arr, 'warn', 'Captações', '📥', `${paradas7.length} captação(ões) parada(s) +7 dias`,
      `Estão estagnando: ${paradas7.slice(0, 3).map(nomeCap).join(', ')}${paradas7.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
  // 2) Sem responsável
  const semDono = ativos.filter(x => !(x.responsavel || x.responsavel_id));
  if (semDono.length) {
    push(arr, 'warn', 'Captações', '👤', `${semDono.length} captação(ões) sem responsável`,
      `Ninguém atribuído — risco de cair no esquecimento: ${semDono.slice(0, 3).map(nomeCap).join(', ')}${semDono.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
  // 3) Mídia pendente (precisa fotos/vídeos sem link)
  const midia = ativos.filter(x => (x.precisa_fotos && !x.link_fotos) || (x.precisa_videos && !x.link_videos));
  if (midia.length) {
    push(arr, 'warn', 'Captações', '📸', `${midia.length} captação(ões) aguardando mídia`,
      `Precisam de fotos/vídeos ainda não entregues — trava o anúncio: ${midia.slice(0, 3).map(nomeCap).join(', ')}${midia.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
}

function collectEquipe(arr, oo) {
  if (!oo) return;
  const all = (oo.corretores || []).filter(c => !c.is_team);
  if (all.length < 3) return;
  const totalVgv = all.reduce((s, c) => s + (c.vgv || 0), 0);
  // 1) Concentração de receita num único corretor
  if (totalVgv > 0) {
    const top = all.slice().sort((a, b) => (b.vgv || 0) - (a.vgv || 0))[0];
    const share = Math.round((top.vgv || 0) / totalVgv * 100);
    if (share >= 60) {
      push(arr, 'warn', 'Equipe', '⚠️', `Receita concentrada em 1 pessoa (${share}%)`,
        `${esc(top.name || 'um corretor')} responde por ${share}% do VGV do mês. Dependência alta — risco se faltar.`,
        '#/equipe', 'Equipes');
    }
  }
  // 2) Quantos corretores sem nenhuma venda no mês
  const semVenda = all.filter(c => (c.vendas || 0) === 0);
  if (semVenda.length && semVenda.length >= Math.ceil(all.length / 2)) {
    push(arr, 'warn', 'Equipe', '😴', `${semVenda.length}/${all.length} sem venda neste mês`,
      `Metade ou mais do time ainda não fechou no mês. Olhar pipeline e atividade individual.`,
      '#/arena', 'Arena Live');
  }
}

function collectOperacao(arr, m) {
  if (!m) return;
  const co = m.commissions || {};
  if ((co.pendentes || 0) > 0 && (co.valor_pendente || 0) > 0) {
    push(arr, 'warn', 'Operação', '💎', `${co.pendentes} comissão(ões) a pagar`,
      `R$ ${km(co.valor_pendente)} em comissões pendentes de repasse.`,
      '#/financeiro', 'Financeiro');
  }
}

/* ─── Render ───────────────────────────────────────────────────────────── */

function render(signals) {
  const crit = signals.filter(s => s.sev === 'crit');
  const warn = signals.filter(s => s.sev === 'warn');
  const total = signals.length;

  const grupos = {};
  signals.forEach(s => { (grupos[s.area] = grupos[s.area] || []).push(s); });
  // ordena cada grupo: críticos primeiro
  Object.values(grupos).forEach(g => g.sort((a, b) => (a.sev === 'crit' ? 0 : 1) - (b.sev === 'crit' ? 0 : 1)));
  const ordemAreas = ['Infra & Integrações', 'Vendas & Metas', 'Captações', 'Equipe', 'Operação'];
  const areas = Object.keys(grupos).sort((a, b) => (ordemAreas.indexOf(a) + 1 || 99) - (ordemAreas.indexOf(b) + 1 || 99));

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">🚨 Pontos de Atenção</h2>
          <p class="card-sub">Radar automático — sinais reais do sistema, priorizados. Atualizado ${new Date().toLocaleString('pt-BR')}.</p>
        </div>
        <button class="btn btn-ghost" id="pa-reload">🔄 Reverificar</button>
      </div>

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${sumCard('🔴 Críticos', crit.length, '#dc2626')}
        ${sumCard('🟡 Atenção', warn.length, '#d97706')}
        ${sumCard('📋 Total', total, '#2563eb')}
      </div>

      ${total === 0 ? `
        <div style="text-align:center;padding:42px 20px;margin-top:16px;background:linear-gradient(135deg,rgba(22,163,74,.10),transparent);border:1px solid rgba(22,163,74,.3);border-radius:14px">
          <div style="font-size:46px">✅</div>
          <h3 style="margin:8px 0 4px">Tudo sob controle</h3>
          <p class="muted" style="margin:0">Nenhum ponto de atenção detectado agora. As metas, captações, integrações e a equipe estão dentro do esperado.</p>
        </div>
      ` : areas.map(area => `
        <div class="card mt-4" style="background:var(--bg-2)">
          <h3 class="card-title" style="font-size:14px">${esc(area)} <span class="tiny muted">· ${grupos[area].length}</span></h3>
          <div style="display:grid;gap:8px;margin-top:8px">
            ${grupos[area].map(sigRow).join('')}
          </div>
        </div>
      `).join('')}

      <div class="tiny muted" style="margin-top:14px">Sinais derivados de dados reais (saúde do sistema, deals do RD, captações, equipe). Sem cadastro manual — resolva pela origem e o ponto some na próxima verificação.</div>
    </div>
  `;
  document.getElementById('pa-reload').addEventListener('click', () => pagePontosAtencao(null, _root));
}

function sigRow(s) {
  const cor = s.sev === 'crit' ? '#dc2626' : '#d97706';
  const dot = s.sev === 'crit' ? '🔴' : '🟡';
  return `
    <div style="display:flex;gap:11px;align-items:flex-start;background:var(--bg-3);border-left:4px solid ${cor};border-radius:10px;padding:11px 13px">
      <div style="font-size:16px;line-height:1.2">${dot}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13.5px">${s.icon} ${esc(s.title)}</div>
        <div class="tiny muted" style="margin-top:2px;line-height:1.45">${esc(s.detail)}</div>
      </div>
      ${s.href ? `<a href="${s.href}" class="btn btn-ghost btn-sm" style="white-space:nowrap;align-self:center">${esc(s.hrefLabel || 'Abrir')} →</a>` : ''}
    </div>`;
}

function sumCard(label, n, color) {
  return `
    <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:var(--r-md);padding:12px 16px;border-left:4px solid ${color}">
      <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">${label}</div>
      <div style="font-size:30px;font-weight:900;color:${color}">${n}</div>
    </div>`;
}

/* ─── helpers ─── */
function nomeCap(x) {
  return esc(x.endereco || x.nome_imovel || x.condominio || x.proprietario || x.localizacao || 'Imóvel');
}
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function km(n) {
  if (n == null) return '0';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
  return Math.round(v).toLocaleString('pt-BR');
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
