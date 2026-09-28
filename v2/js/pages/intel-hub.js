/* PSM-OS v2 — 🧠 Inteligência · Painel (v88.82)
   Reorganização da seção (decisão do Paulo, 28/09): 4 itens — Painel, Vendas,
   Mercado e Briefing — e só sócio. O Painel é o antigo Centro (Diagnóstico +
   Perguntar à IA). Saíram daqui: Dados de Mercado e Tendências (aposentadas) e
   Benchmark/Landscape (viraram abas do Mercado, /concorrencia). */
import { pageIntelCentro } from './intel-centro.js';

export async function pageIntelHub(ctx, root) {
  await pageIntelCentro(ctx, root);
}
