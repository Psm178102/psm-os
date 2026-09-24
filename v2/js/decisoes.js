/* ============================================================================
   🧭 DECIDIR AGORA — painel único de decisões (v87.92)
   Pedido do Paulo (16/09/2026): "a função real, prática, que gera tomada de decisões claras, no tempo
   certo, não está funcionando. Precisamos que seja FUNCIONAL, REAL, e não um monte de dados cruzados."

   Cada linha = O QUE FAZER · QUEM · ATÉ QUANDO · POR QUÊ (com o número) · estado da execução.
   1 clique vira tarefa na Agenda do dono; se a tarefa atrasa ou é concluída e o problema continua,
   a decisão volta ao topo como crítica. Fonte: /api/v3/metricas/decisoes (api/v3/_decisoes_lib.py).

   Uso:  montarDecisoes(el, { tela: 'gestao', team: 'conquista', pessoa: 'kadu', max: 5, titulo: '…' })
============================================================================ */
import { api } from './api.js';
import { auth } from './auth.js';

const CSS = `
.dz{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md,12px);padding:14px 16px;margin:0 0 14px}
.dz-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dz-h h3{margin:0;font-size:16px;font-weight:900;letter-spacing:-.01em}
.dz-cnt{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.dz-pill{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;border:1px solid var(--border);white-space:nowrap}
.dz-pill.err{color:var(--err,#dc2626);border-color:color-mix(in srgb,var(--err,#dc2626) 45%,transparent);background:color-mix(in srgb,var(--err,#dc2626) 9%,transparent)}
.dz-pill.warn{color:var(--warn,#d97706);border-color:color-mix(in srgb,var(--warn,#d97706) 45%,transparent)}
.dz-pill.ok{color:var(--ok,#16a34a);border-color:color-mix(in srgb,var(--ok,#16a34a) 45%,transparent)}
.dz-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.dz-it{display:grid;grid-template-columns:4px minmax(0,1fr) auto;gap:0 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.dz-it .bar{background:var(--dzc,var(--border))}
.dz-it .body{padding:10px 0;min-width:0}
.dz-it .tt{font-weight:800;font-size:14px;line-height:1.35}
.dz-it .meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:11.5px}
.dz-it .meta span{white-space:nowrap}
.dz-it .why{font-size:12.5px;color:var(--ink-2,inherit);margin-top:5px;line-height:1.45}
.dz-it details{margin-top:5px;font-size:12px}.dz-it summary{cursor:pointer;color:var(--ink-muted);font-weight:700}
.dz-it ul{margin:4px 0 0;padding-left:18px}.dz-it li{margin:1px 0}
.dz-it .acts{display:flex;flex-direction:column;gap:6px;justify-content:center;padding:10px 12px 10px 0;min-width:150px}
.dz-it .acts .btn{white-space:nowrap;font-size:12px}
.dz-est{font-weight:800}
.dz-empty{padding:14px;text-align:center;font-size:13px;color:var(--ink-muted)}
.dz-more{margin-top:8px;font-size:12px;font-weight:700;background:none;border:0;color:var(--ink-muted);cursor:pointer;padding:0}
@media (max-width:640px){.dz-it{grid-template-columns:4px minmax(0,1fr)}.dz-it .acts{grid-column:2;flex-direction:row;flex-wrap:wrap;padding:0 0 10px;min-width:0}}
`;
function css() {
  if (document.getElementById('dz-css')) return;
  const s = document.createElement('style'); s.id = 'dz-css'; s.textContent = CSS; document.head.appendChild(s);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ESTADO = {
  nova: ['● sem ninguém agindo', 'var(--err,#dc2626)'],
  persistiu: ['↺ tarefa concluída, problema continua', 'var(--err,#dc2626)'],
  atrasada: ['⏰ tarefa atrasada', 'var(--err,#dc2626)'],
  em_andamento: ['▶ em andamento', 'var(--ok,#16a34a)'],
  resolvendo: ['✓ concluída — conferindo', 'var(--ok,#16a34a)'],
  dispensada: ['⊘ dispensada', 'var(--ink-muted)'],
};
const _cache = new Map();   // chave da consulta → {t, data}

function qs(o) {
  return Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
function fmtPrazo(iso, hoje) {
  if (!iso) return '—';
  if (iso === hoje) return 'hoje';
  const [y, m, d] = iso.split('-');
  return (iso < hoje ? 'venceu ' : 'até ') + `${d}/${m}`;
}

export async function montarDecisoes(el, opts = {}) {
  if (!el) return;
  css();
  const o = { max: 5, titulo: '🧭 Decidir agora', ...opts };
  const key = qs({ tela: o.tela, team: o.team, pessoa: o.pessoa });
  el.innerHTML = `<div class="dz"><div class="dz-h"><h3>${esc(o.titulo)}</h3><span class="tiny muted"><span class="spinner"></span> vendo o que precisa de ação…</span></div></div>`;
  let data;
  try {
    const c = _cache.get(key);
    if (c && !o.fresh && Date.now() - c.t < 60000) data = c.data;
    else {
      data = await api.request('/api/v3/metricas/decisoes?' + key + (o.fresh ? '&fresh=1' : ''));
      _cache.set(key, { t: Date.now(), data });
    }
  } catch (e) {
    el.innerHTML = `<div class="dz"><div class="dz-h"><h3>${esc(o.titulo)}</h3></div><div class="alert alert-err tiny" style="margin-top:8px">Não consegui montar as decisões: ${esc(e.message || e)}</div></div>`;
    return;
  }
  render(el, o, data, false);
}

function render(el, o, data, todas) {
  const me = auth.user() || {};
  const lvl = me.lvl || 0;
  const hoje = data.hoje;
  const ds = (data.decisoes || []).filter(d => d.estado.status !== 'dispensada' || todas);
  const c = data.contagem || {};
  const lista = todas ? ds : ds.slice(0, o.max);
  const pills = `
    ${c.atrasadas ? `<span class="dz-pill err">${c.atrasadas} atrasada${c.atrasadas > 1 ? 's' : ''}</span>` : ''}
    ${c.sem_dono_agindo ? `<span class="dz-pill err">${c.sem_dono_agindo} sem ninguém agindo</span>` : ''}
    ${c.em_andamento ? `<span class="dz-pill ok">${c.em_andamento} em andamento</span>` : ''}
    ${!c.total ? '<span class="dz-pill ok">tudo em dia</span>' : ''}`;
  const item = d => {
    const [elbl, ecor] = ESTADO[d.estado.status] || ['', 'var(--ink-muted)'];
    const cor = d.estado.status === 'dispensada' ? 'var(--border)' : d.nivel === 'critico' ? 'var(--err,#dc2626)' : 'var(--warn,#d97706)';
    const souDono = d.dono.id === me.id;
    const podeTarefa = ['nova', 'persistiu'].includes(d.estado.status) && (souDono || lvl >= 5);
    const itens = (d.itens || []).length ? `<details><summary>${d.itens.length} ${d.tipo.startsWith('meta') ? 'pessoa(s)' : 'negócio(s)'}</summary><ul>${d.itens.map(i =>
      `<li>${esc(i.nome)}${i.dias != null ? ` — <b>${i.dias} dias</b> parado` : ''}${i.horas != null ? ` — <b>${i.horas}h</b> sem contato` : ''}${i.valor ? ` — R$ ${(Number(i.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}</li>`).join('')}</ul></details>` : '';
    const prazoVencido = d.prazo < hoje;
    return `<div class="dz-it" style="--dzc:${cor}" data-dz="${esc(d.id)}">
      <div class="bar"></div>
      <div class="body">
        <div class="tt">${esc(d.titulo)}</div>
        <div class="meta">
          <span>👤 <b>${souDono ? 'você' : esc(d.dono.name)}</b></span>
          <span style="${prazoVencido ? 'color:var(--err,#dc2626);font-weight:800' : ''}">📅 ${fmtPrazo(d.prazo, hoje)}</span>
          <span class="dz-est" style="color:${ecor}">${elbl}${d.estado.prazo && d.estado.status !== 'nova' ? ` · tarefa ${fmtPrazo(String(d.estado.prazo).slice(0, 10), hoje)}` : ''}</span>
          <span class="muted">${esc(d.tipo_label)}${d.team ? ' · ' + esc(d.team) : ''}</span>
        </div>
        <div class="why">${esc(d.porque)}</div>
        ${d.estado.status === 'dispensada' && d.estado.motivo ? `<div class="tiny muted" style="margin-top:4px">Motivo: ${esc(d.estado.motivo)}</div>` : ''}
        ${itens}
      </div>
      <div class="acts">
        ${podeTarefa ? `<button class="btn btn-primary btn-sm" data-dz-t="${esc(d.id)}">📌 ${souDono ? 'Pôr na minha agenda' : 'Delegar a ' + esc(d.dono.name.split(' ')[0])}</button>` : ''}
        ${d.link ? `<a class="btn btn-ghost btn-sm" href="${esc(d.link)}">Ir agir →</a>` : ''}
        ${lvl >= 5 && d.estado.status !== 'dispensada' ? `<button class="btn btn-ghost btn-sm" data-dz-x="${esc(d.id)}" title="some por 7 dias, com motivo registrado">Dispensar</button>` : ''}
      </div>
    </div>`;
  };
  el.innerHTML = `<div class="dz">
    <div class="dz-h"><h3>${esc(o.titulo)}</h3><span class="tiny muted">o que fazer, quem faz e até quando</span><div class="dz-cnt">${pills}</div></div>
    ${lista.length ? `<div class="dz-list">${lista.map(item).join('')}</div>`
      : `<div class="dz-empty">✅ Nada pendente aqui. O que precisava de ação já tem dono agindo.</div>`}
    ${ds.length > o.max && !todas ? `<button class="dz-more" data-dz-all>ver todas as ${ds.length} decisões →</button>` : ''}
  </div>`;
  el.querySelector('[data-dz-all]')?.addEventListener('click', () => render(el, o, data, true));
  el.querySelectorAll('[data-dz-t]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'criando…';
    try {
      const r = await api.request('/api/v3/metricas/decisoes', { method: 'POST', body: { acao: 'tarefa', id: b.dataset.dzT } });
      b.textContent = r.ja_existe ? '✓ já estava na agenda' : '✓ na agenda';
      _cache.clear();
      setTimeout(() => montarDecisoes(el, { ...o, fresh: true }), 700);
    } catch (e) { b.disabled = false; b.textContent = '⚠️ ' + (e.message || 'erro'); }
  }));
  el.querySelectorAll('[data-dz-x]').forEach(b => b.addEventListener('click', async () => {
    const motivo = prompt('Por que dispensar esta decisão? (fica registrado e ela some por 7 dias)');
    if (!motivo || motivo.trim().length < 5) return;
    b.disabled = true;
    try {
      await api.request('/api/v3/metricas/decisoes', { method: 'POST', body: { acao: 'dispensar', id: b.dataset.dzX, motivo: motivo.trim() } });
      _cache.clear();
      montarDecisoes(el, { ...o, fresh: true });
    } catch (e) { b.disabled = false; alert(e.message || e); }
  }));
}
