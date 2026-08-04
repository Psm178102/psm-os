/* PSM-OS v2 — 🔗 Links & Incorporadoras (v85.5)
   Fusão de menu (pedido do Paulo): Links úteis + SAC Incorporadoras +
   Sistema e Drive Incorporadoras viram 3 abas de UM item da Secretaria.
   As páginas originais seguem intactas (e acessíveis por link direto,
   ex. atalhos do Qualidade dos Dados) — aqui é só a casca de abas. */
import { pageLinksUteis } from './links-uteis.js';
import { pageSacIncorporadoras } from './sac-incorporadoras.js';
import { pageSistemasIncorporadoras } from './sistemas-incorporadoras.js';

const ABAS = [
  { id: 'links',    nome: '🔗 Links úteis',           page: pageLinksUteis },
  { id: 'sac',      nome: '📞 SAC Incorporadoras',    page: pageSacIncorporadoras },
  { id: 'sistemas', nome: '🏢 Sistema e Drive',       page: pageSistemasIncorporadoras },
];

let _aba = 'links';

export async function pageCentralLinks(ctx, root) {
  root.innerHTML = `
    <div class="flex" style="gap:8px;flex-wrap:wrap;margin-bottom:12px" id="cl-tabs">
      ${ABAS.map(a => `<button class="btn btn-sm ${_aba === a.id ? 'btn-primary' : 'btn-ghost'}" data-cl="${a.id}">${a.nome}</button>`).join('')}
    </div>
    <div id="cl-body"></div>`;
  root.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => { _aba = b.dataset.cl; pageCentralLinks(ctx, root); });
  const aba = ABAS.find(a => a.id === _aba) || ABAS[0];
  await aba.page(ctx, root.querySelector('#cl-body'));
}
