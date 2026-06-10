/* PSM-OS v2 — 🧭 Cockpit de Decisão HUB (v77.30, evolução do menu Diretoria).
   Consolida em UMA tela com abas o que eram 4 itens de menu medindo a mesma coisa:
   🧭 Decisão (fronts do cockpit) · 📈 KPIs Executivos · 💡 Insights · 🚨 Pontos de Atenção.
   Cada aba DELEGA à página original (zero duplicação) num sub-root próprio, lazy
   (só renderiza ao clicar). Deep-link: #/cockpit?tab=kpis|insights|atencao. */
import { auth } from '../auth.js';
import { pageCockpit } from './cockpit.js';
import { pageKpis } from './kpis.js';
import { pageInsights } from './insights.js';
import { pagePontosAtencao } from './pontos-atencao.js';

const TABS = [
  { id: 'fronts',   lbl: '🧭 Decisão',            page: pageCockpit },
  { id: 'kpis',     lbl: '📈 KPIs Executivos',    page: pageKpis },
  { id: 'insights', lbl: '💡 Insights',           page: pageInsights },
  { id: 'atencao',  lbl: '🚨 Pontos de Atenção',  page: pagePontosAtencao },
];

export async function pageCockpitHub(ctx, root) {
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Diretor (lvl 7+).</div>'; return; }
  const inicial = TABS.some(t => t.id === ctx?.query?.tab) ? ctx.query.tab : 'fronts';

  root.innerHTML = `
    <div class="cockpit-hub">
      <div id="ch-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;position:sticky;top:0;z-index:5;background:var(--bg-1,transparent);padding:4px 0">
        ${TABS.map(t => `<button class="btn ${t.id === inicial ? 'btn-primary' : 'btn-ghost'}" data-chtab="${t.id}" style="font-size:12.5px;padding:7px 14px">${t.lbl}</button>`).join('')}
      </div>
      <div id="ch-body"></div>
    </div>`;

  const body = root.querySelector('#ch-body');
  const rendered = {};   // sub-root por aba — renderiza 1x, depois só alterna (mantém estado/IA gerada)

  async function showTab(id) {
    const tab = TABS.find(t => t.id === id) || TABS[0];
    root.querySelectorAll('[data-chtab]').forEach(b => {
      const on = b.dataset.chtab === tab.id;
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-ghost', !on);
    });
    Object.values(rendered).forEach(el => { el.style.display = 'none'; });
    if (!rendered[tab.id]) {
      const sub = document.createElement('div');
      rendered[tab.id] = sub;
      body.appendChild(sub);
      try {
        await tab.page(ctx, sub);
      } catch (e) {
        sub.innerHTML = `<div class="alert alert-err">Erro na aba: ${String(e.message || e)}</div>`;
      }
    }
    rendered[tab.id].style.display = '';
  }

  root.querySelectorAll('[data-chtab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.chtab)));
  await showTab(inicial);
}
