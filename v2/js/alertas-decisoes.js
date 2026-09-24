/* PSM-OS v2 — 🚨 Alertas & Decisões (componente) — v88.42
   Saiu da Sala de Comando e mora em Diretoria → Pontos de Atenção (pedido do Paulo, 24/set).
   Cruza os fronts e cada alerta vira tarefa do ✅ Checklist da Diretoria com 1 clique, já com
   o SETOR certo. Busca os próprios dados (cada fonte independente — uma cair não derruba as outras):
     • régua comercial (oo/comercial → alertas por equipe: CAC, conversão, leads sem contato…)
     • contas vencidas a pagar/receber (PSM HUB)
     • ritmo do mês vs META DO MÊS da aba Metas (antes: meta anual ÷ 12 — dava "esperado" errado)
     • saúde do sistema */
import { api } from './api.js';
import { auth } from './auth.js';

const COR = { bad: '#dc2626', warn: '#d97706' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

export function montarAlertasDecisoes(el) {
  if (!el) return;
  const d = {};
  const criadas = new Set();
  const hoje = new Date();
  const DIA = hoje.getDate();
  const PACE = DIA / new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const ini = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
  const fim = hoje.toISOString().slice(0, 10);

  el.innerHTML = `<div class="card" style="margin-bottom:12px">
    <b>🚨 Alertas & Decisões</b>
    <div class="tiny muted" style="margin:2px 0 8px">cruzamento dos fronts — cada alerta vira tarefa do <a href="#/checklist-diretoria">✅ Checklist da Diretoria</a> com um clique</div>
    <div class="ad-lista"><span class="spinner"></span> <span class="tiny muted">cruzando fronts…</span></div></div>`;
  const lista = el.querySelector('.ad-lista');

  const calls = {
    gc: () => api.request(`/api/v3/oo/comercial?since=${ini}&until=${fim}`),
    hubContas: () => api.request('/api/v3/psmhub/financeiro?secao=contas'),
    metas: () => api.request('/api/v3/metas/atingimento?ano=' + hoje.getFullYear()),
    health: () => api.request('/api/v3/system_health'),
  };
  const fontes = Object.keys(calls);
  fontes.forEach(async k => {
    try { d[k] = await calls[k](); } catch (e) { d[k] = { _err: e.message }; }
    desenhar();
  });

  function contas() {
    const dd = d.hubContas && d.hubContas.ok && d.hubContas.dados;
    if (!dd || !Array.isArray(dd.lancamentos)) return null;
    const hj = hoje.toISOString().slice(0, 10);
    const out = { pagar_venc: 0, receber_venc: 0 };
    for (const l of dd.lancamentos) {
      if (String(l.status || '').toLowerCase() === 'pago') continue;
      const falta = Math.max(0, num(l.amount) - num(l.amountPaid));
      const due = String(l.dueDate || '').slice(0, 10);
      if (!falta || !due || due >= hj) continue;
      String(l.type || '').toLowerCase().includes('pag') ? out.pagar_venc += falta : out.receber_venc += falta;
    }
    return out;
  }

  function ritmoMes() {
    const m = d.metas;
    if (!m || m._err || !Array.isArray(m.grid)) return null;
    const mes = hoje.getMonth() + 1;
    let meta = 0, real = 0;
    for (const g of m.grid) for (const c of (g.cells || [])) if (c.mes === mes) { meta += num(c.meta_vgv); real += num(c.atingido_vgv); }
    const fg = (m.fora_do_grid_mensal || {})[mes] || (m.fora_do_grid_mensal || {})[String(mes)];
    if (fg) real += num(fg.vgv);
    return meta ? { meta, real, esperado: meta * PACE } : null;
  }

  function gerar() {
    const its = [];
    const push = (nivel, texto, tarefa, setor) => its.push({ nivel, texto, tarefa, setor });
    const gc = d.gc;
    if (gc && !gc._err && gc.alertas && Array.isArray(gc.alertas.itens)) {
      for (const a of gc.alertas.itens.slice(0, 8)) {
        const lbl = a.label || a.metrica || 'métrica';
        const t = `${a.team ? '[' + a.team + '] ' : ''}${lbl}: ${a.valor}${a.unidade === 'pct' ? '%' : ''} (régua ${a.tipo === 'min' ? '≥' : '≤'} ${a.limite})`;
        const setor = /cac|cpl|roas|m[íi]dia|tr[áa]fego|an[úu]ncio/i.test(lbl + ' ' + (a.metrica || '')) ? 'Marketing' : 'Comercial';
        push('bad', t, `Corrigir ${lbl} — ${a.team || 'equipe'}`, setor);
      }
    }
    const c = contas();
    if (c && c.pagar_venc > 0) push('bad', `Contas a PAGAR vencidas: ${money(c.pagar_venc)} em aberto no Hub`, `Quitar/renegociar contas vencidas (${money(c.pagar_venc)})`, 'Financeiro');
    if (c && c.receber_venc > 0) push('warn', `A RECEBER vencido: ${money(c.receber_venc)} — cobrar`, `Cobrar recebíveis vencidos (${money(c.receber_venc)})`, 'Financeiro');
    const r = ritmoMes();
    if (r && DIA >= 5 && r.real < r.esperado * 0.7)
      push('warn', `Ritmo do mês abaixo de 70% do esperado (${money(r.real)} vendidos vs ${money(r.esperado)} esperados hoje pela meta do mês de ${money(r.meta)})`, 'Plano de recuperação do ritmo do mês', 'Comercial');
    const h = d.health;
    if (h && (h._err || h.ok === false)) push('bad', 'Saúde do sistema com falha — ver Qualidade dos Dados', 'Investigar falha de sistema', 'Tecnologia & Sistema');
    return its;
  }

  function desenhar() {
    if (!lista.isConnected) return;
    const pend = fontes.filter(k => !d[k]).length;
    const its = gerar();
    if (!its.length) {
      lista.innerHTML = pend ? '<span class="spinner"></span> <span class="tiny muted">cruzando fronts…</span>' : '<div class="tiny" style="color:#16a34a">✅ Nenhum alerta fora da régua agora.</div>';
      return;
    }
    lista.innerHTML = its.map((a, i) => `
      <div class="flex items-center gap-2" style="border-top:1px solid var(--border);padding:7px 0;font-size:13px;flex-wrap:wrap">
        <span style="color:${COR[a.nivel] || COR.warn};font-size:13px">●</span>
        <span style="flex:1;min-width:200px">${esc(a.texto)} <span class="tiny muted">· ${esc(a.setor)}</span></span>
        ${criadas.has(a.texto) ? '<a class="tiny" style="color:#16a34a" href="#/checklist-diretoria">✅ tarefa criada no Checklist</a>'
          : `<button class="btn btn-ghost btn-sm" data-ad="${i}" style="font-size:11px;white-space:nowrap">📌 virar tarefa</button>`}
      </div>`).join('') + (pend ? '<div class="tiny muted" style="padding-top:6px"><span class="spinner"></span> ainda cruzando…</div>' : '');
    lista.querySelectorAll('[data-ad]').forEach(b => b.onclick = async () => {
      const a = gerar()[Number(b.dataset.ad)];
      if (!a) return;
      b.disabled = true;
      try {
        await api.request('/api/v3/tasks/upsert', { method: 'POST', body: {
          titulo: a.tarefa || a.texto.slice(0, 80),
          descricao: `Gerada em Pontos de Atenção (${hoje.toLocaleDateString('pt-BR')}): ${a.texto}`,
          prioridade: a.nivel === 'bad' ? 'alta' : 'media', responsavel: (auth.user() || {}).id, status: 'aberta', categoria: a.setor,
        } });
        criadas.add(a.texto); desenhar();
      } catch (e) { b.disabled = false; b.textContent = '⚠️ ' + (e.message || 'erro'); }
    });
  }
}
