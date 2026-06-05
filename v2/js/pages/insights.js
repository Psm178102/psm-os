/* ============================================================================
   PSM-OS v2 — Insights (Diretoria)
   ----------------------------------------------------------------------------
   Leitura estratégica do negócio em dois níveis:
     1) CARDS computados (determinísticos, sempre funcionam): run-rate da meta,
        cobertura de pipeline, eficiência (vendas×perdas), ticket, momentum
        30d, concentração de receita por corretor.
     2) IA SOB DEMANDA: compila os fatos reais e pede ao motor de IA
        (/api/ai-analysis = gemini) a leitura estratégica — oportunidades,
        riscos e 3 ações da semana. Nunca inventa número além dos fatos.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _m = null, _oo = null, _busy = false;

export async function pageInsights(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Gerência/Diretoria.</div>';
    return;
  }
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Lendo os números…</div></div>`;
  const [m, oo] = await Promise.all([
    api.request('/api/v3/metrics/overview').catch(() => null),
    api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null),
  ]);
  _m = m; _oo = oo;
  render();
}

/* ─── Insights computados ─────────────────────────────────────────────── */
function computeCards() {
  const cards = [];
  const s = (_m && _m.sales) || {};
  const meta = (_m && _m.metas && _m.metas.meta_vgv) || 0;

  // run-rate da meta
  const now = new Date();
  const dia = now.getDate();
  const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const frac = Math.max(dia / diasMes, 0.01);
  if (meta > 0) {
    const proj = (s.vgv_mes || 0) / frac;
    const pct = Math.round(proj / meta * 100);
    const pctReal = Math.round((s.vgv_mes || 0) / meta * 100);
    cards.push({
      icon: '🎯', titulo: 'Ritmo da meta', valor: pctReal + '%',
      tom: pct >= 100 ? 'good' : pct >= 80 ? 'warn' : 'bad',
      insight: pct >= 100
        ? `No ritmo atual o mês fecha em ~${pct}% da meta. Mantenha a pressão.`
        : `Atingido ${pctReal}%. Projeção no ritmo de hoje: ~${pct}% — ${pct < 80 ? 'precisa acelerar forte' : 'falta um empurrão'}.`,
    });
    const falta = Math.max(meta - (s.vgv_mes || 0), 0);
    const cob = falta > 0 ? (s.pipeline_vgv || 0) / falta : 99;
    cards.push({
      icon: '📈', titulo: 'Cobertura de pipeline', valor: falta > 0 ? (cob).toFixed(1) + '×' : 'meta batida',
      tom: cob >= 3 ? 'good' : cob >= 1.5 ? 'warn' : 'bad',
      insight: falta > 0
        ? `Falta R$ ${km(falta)} e o pipeline aberto é R$ ${km(s.pipeline_vgv)} (${cob.toFixed(1)}× o gap). ${cob < 1.5 ? 'Cobertura baixa — gere oportunidade.' : cob < 3 ? 'Saudável, mas sem folga.' : 'Cobertura confortável.'}`
        : 'Meta do mês já atingida — foco em adiantar o próximo mês.',
    });
  }

  // eficiência vendas × perdas
  const v = s.vendas_mes || 0, p = s.perdidos_mes || 0;
  if (v + p > 0) {
    const wr = Math.round(v / (v + p) * 100);
    cards.push({
      icon: '⚖️', titulo: 'Aproveitamento (mês)', valor: wr + '%',
      tom: wr >= 50 ? 'good' : wr >= 30 ? 'warn' : 'bad',
      insight: `${v} ganha(s) × ${p} perdida(s) no mês. ${wr < 30 ? 'Aproveitamento baixo — revisar qualificação/atendimento.' : wr < 50 ? 'Dá pra melhorar a conversão.' : 'Boa taxa de conversão.'}`,
    });
  }

  // momentum 30d vs ritmo do mês
  if ((s.vgv_30d || 0) > 0 || (s.vgv_mes || 0) > 0) {
    cards.push({
      icon: '⚡', titulo: 'Momentum (30d)', valor: 'R$ ' + km(s.vgv_30d),
      tom: 'info',
      insight: `${s.vendas_30d || 0} venda(s) em 30 dias · ticket médio R$ ${km(s.ticket_medio_mes)}. VGV no ano: R$ ${km(s.vgv_ano)}.`,
    });
  }

  // concentração de receita
  const all = ((_oo && _oo.corretores) || []).filter(c => !c.is_team);
  const totalVgv = all.reduce((a, c) => a + (c.vgv || 0), 0);
  if (all.length >= 3 && totalVgv > 0) {
    const ranked = all.slice().sort((a, b) => (b.vgv || 0) - (a.vgv || 0));
    const top = ranked[0];
    const share = Math.round((top.vgv || 0) / totalVgv * 100);
    const comVenda = all.filter(c => (c.vendas || 0) > 0).length;
    cards.push({
      icon: '👥', titulo: 'Concentração de receita', valor: share + '%',
      tom: share >= 60 ? 'bad' : share >= 40 ? 'warn' : 'good',
      insight: `${esc(top.name || 'Top')} faz ${share}% do VGV. ${comVenda}/${all.length} bateram venda no mês. ${share >= 60 ? 'Dependência alta de uma pessoa.' : 'Distribuição razoável.'}`,
    });
  }

  return cards;
}

function render() {
  const cards = computeCards();
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">💡 Insights</h2>
          <p class="card-sub">Leitura estratégica do negócio — cards computados dos dados reais + análise da IA sob demanda.</p>
        </div>
        <button class="btn btn-primary" id="in-gen">✨ Gerar insights com IA</button>
      </div>

      ${cards.length ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:12px">
          ${cards.map(card).join('')}
        </div>` : `<div class="alert alert-warn" style="margin-top:12px">Ainda não há números suficientes (vendas/meta/pipeline) pra computar insights. Configure metas e sincronize o CRM.</div>`}

      <div id="in-out" style="margin-top:14px"></div>

      <div class="tiny muted" style="margin-top:14px">Cards 100% determinísticos (dados do RD + metas). A IA escreve a leitura estratégica a partir desses mesmos fatos — não inventa números.</div>
    </div>
  `;
  document.getElementById('in-gen').addEventListener('click', generate);
}

function card(c) {
  const COR = { good: '#16a34a', warn: '#d97706', bad: '#dc2626', info: '#2563eb' };
  const cor = COR[c.tom] || '#2563eb';
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${cor};border-radius:var(--r-md);padding:12px 14px">
      <div class="tiny muted" style="font-weight:700">${c.icon} ${esc(c.titulo)}</div>
      <div style="font-size:24px;font-weight:900;color:${cor};margin:2px 0">${esc(c.valor)}</div>
      <div class="tiny muted" style="line-height:1.45">${esc(c.insight)}</div>
    </div>`;
}

/* ─── IA sob demanda ──────────────────────────────────────────────────── */
async function generate() {
  if (_busy) return;
  _busy = true;
  const out = document.getElementById('in-out');
  out.innerHTML = `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:14px"><span class="spinner"></span> A IA está lendo os números e montando a análise estratégica…</div>`;
  try {
    const prompt = buildPrompt();
    const r = await fetch('/api/ai-analysis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, max_tokens: 1400 }),
    });
    const j = await r.json();
    if (j.ok && j.text) {
      out.innerHTML = `<div style="background:linear-gradient(180deg,rgba(37,99,235,.06),transparent);border:1px solid rgba(37,99,235,.28);border-radius:var(--r-md);padding:16px 18px">
        <div style="font-weight:800;font-size:13px;color:#2563eb;margin-bottom:8px">💡 Leitura estratégica <span class="tiny muted" style="font-weight:400">· ${esc(j.model_used || 'IA')}</span></div>
        <div style="font-size:13.5px;line-height:1.6">${mdLite(j.text)}</div></div>`;
    } else {
      out.innerHTML = `<div class="alert alert-warn">IA indisponível: ${esc(j.error || 'erro')}. Os cards acima seguem válidos (são computados, não dependem de IA).</div>`;
    }
  } catch (e) {
    out.innerHTML = `<div class="alert alert-err">Erro na análise: ${esc(e.message)}</div>`;
  } finally { _busy = false; }
}

function buildPrompt() {
  const s = (_m && _m.sales) || {};
  const meta = (_m && _m.metas && _m.metas.meta_vgv) || 0;
  const u = (_m && _m.users) || {};
  const co = (_m && _m.commissions) || {};
  const all = ((_oo && _oo.corretores) || []).filter(c => !c.is_team);
  const ranked = all.slice().sort((a, b) => (b.vgv || 0) - (a.vgv || 0));
  const topTxt = ranked.slice(0, 5).map(c => `- ${c.name}: ${c.vendas || 0} venda(s), R$ ${km(c.vgv)} VGV (${c.team || 'geral'})`).join('\n');
  const semVenda = all.filter(c => (c.vendas || 0) === 0).length;

  return `Você é o conselheiro estratégico da PSM Imóveis (imobiliária de alto padrão, em expansão agressiva para virar a maior do estado). Analise os FATOS REAIS abaixo e escreva uma leitura executiva curta e afiada para a diretoria. Não invente nenhum número além dos fatos.

== VENDAS (mês corrente) ==
VGV mês: R$ ${km(s.vgv_mes)} (${s.vendas_mes || 0} vendas) · Meta mês: R$ ${km(meta)}
VGV 30 dias: R$ ${km(s.vgv_30d)} (${s.vendas_30d || 0} vendas) · VGV ano: R$ ${km(s.vgv_ano)}
Pipeline aberto: R$ ${km(s.pipeline_vgv)} (${s.pipeline_count || 0} negócios) · Ticket médio: R$ ${km(s.ticket_medio_mes)}
Perdidos no mês: ${s.perdidos_mes || 0} (R$ ${km(s.vgv_perdido_mes)})

== EQUIPE ==
Ativos: ${u.ativos || 0} · Corretores sem venda no mês: ${semVenda}/${all.length}
Top corretores:
${topTxt || '(sem dados de ranking)'}

== OPERAÇÃO ==
Comissões a pagar: ${co.pendentes || 0} (R$ ${km(co.valor_pendente)})

Escreva em português, com esta estrutura (markdown leve, sem floreio):
## Diagnóstico (2-3 linhas)
## Oportunidades (2-3 bullets concretos)
## Riscos (2-3 bullets)
## 3 ações para esta semana (numeradas, específicas e mensuráveis)`;
}

/* ─── helpers ─── */
function mdLite(t) {
  return esc(t)
    .replace(/^#### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^## (.*)$/gm, '<div style="font-weight:800;font-size:14px;margin:12px 0 4px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*\d+\.\s+(.*)$/gm, '<div style="margin:3px 0 3px 6px">▸ $1</div>')
    .replace(/^\s*[-*] (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}
function km(n) {
  if (n == null) return '0';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
  return Math.round(v).toLocaleString('pt-BR');
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
