/* PSM-OS v2 — 🧭 Sala de Comando (v88.37: UMA tela, sem abas).
   Pedido do Paulo (24/set): "unifique todas essas abas". Antes eram 4 abas medindo
   a mesma coisa; agora Sala de Comando + KPIs Executivos + Insights vêm empilhados
   numa rolagem só, e 🚨 Pontos de Atenção virou item próprio do menu Diretoria
   (#/pontos-atencao). Cada bloco DELEGA à página original (zero duplicação) num
   sub-root próprio. Links antigos #/cockpit?tab=… caem aqui mesmo; ?tab=atencao
   vai pro item novo. */
import { auth } from '../auth.js';
import { pageSalaComando } from './sala-comando.js';
import { pageKpis } from './kpis.js';
import { pageInsights } from './insights.js';

const BLOCOS = [
  { id: 'comando',  page: pageSalaComando },
  { id: 'kpis',     page: pageKpis },
  { id: 'insights', page: pageInsights },
];

export async function pageCockpitHub(ctx, root) {
  if ((auth.user()?.lvl || 0) < 10) { root.innerHTML = '<div class="alert alert-warn">🔒 Sala de Comando é restrita a Sócios (lvl 10).</div>'; return; }
  if (ctx?.query?.tab === 'atencao') { location.hash = '#/pontos-atencao'; return; }

  root.innerHTML = `<div class="cockpit-hub" style="display:flex;flex-direction:column;gap:16px"></div>`;
  const host = root.querySelector('.cockpit-hub');
  const subs = BLOCOS.map(b => {
    const sub = document.createElement('section');
    sub.dataset.bloco = b.id;
    host.appendChild(sub);
    return sub;
  });
  // os três carregam em paralelo; um bloco com erro não derruba os outros
  await Promise.all(BLOCOS.map(async (b, i) => {
    try { await b.page(ctx, subs[i]); }
    catch (e) { subs[i].innerHTML = `<div class="alert alert-err">Erro no bloco: ${String(e.message || e)}</div>`; }
  }));
  const alvo = ctx?.query?.tab && host.querySelector(`[data-bloco="${ctx.query.tab}"]`);
  if (alvo) alvo.scrollIntoView({ block: 'start' });
}
