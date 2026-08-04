/* PSM-OS v2 — 🧠 Centro de Inteligência · hub (v85.5)
   Fusão de menu (pedido do Paulo): Dados de Mercado, Benchmark e
   Tendências viram abas do Centro de Inteligência — a seção Inteligência
   fica com 4 itens em vez de 7. As páginas originais seguem intactas e
   as rotas antigas continuam válidas por link direto. */
import { pageIntelCentro } from './intel-centro.js';
import { pageDadosMercado } from './dados-mercado.js';
import { pageBenchmark } from './benchmark.js';
import { pageTendencias } from './tendencias.js';

const ABAS = [
  { id: 'centro',     nome: '🧠 Centro',           page: pageIntelCentro },
  { id: 'dados',      nome: '📈 Dados de Mercado', page: pageDadosMercado },
  { id: 'benchmark',  nome: '📊 Benchmark',        page: pageBenchmark },
  { id: 'tendencias', nome: '📉 Tendências',       page: pageTendencias },
];

let _aba = 'centro';

export async function pageIntelHub(ctx, root) {
  root.innerHTML = `
    <div class="flex" style="gap:8px;flex-wrap:wrap;margin-bottom:12px" id="ih-tabs">
      ${ABAS.map(a => `<button class="btn btn-sm ${_aba === a.id ? 'btn-primary' : 'btn-ghost'}" data-ih="${a.id}">${a.nome}</button>`).join('')}
    </div>
    <div id="ih-body"></div>`;
  root.querySelectorAll('[data-ih]').forEach(b => b.onclick = () => { _aba = b.dataset.ih; pageIntelHub(ctx, root); });
  const aba = ABAS.find(a => a.id === _aba) || ABAS[0];
  await aba.page(ctx, root.querySelector('#ih-body'));
}
