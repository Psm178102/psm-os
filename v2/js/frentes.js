/* PSM-OS v2 — FONTE ÚNICA das frentes/empresas (v84.0, auditoria A1).
   Antes cada página tinha sua cópia (nomes/cores divergiam). Agora todas importam daqui.
   FRENTES é mutável in-place: o boot chama loadFrentes() e as páginas que renderizam
   depois já veem a config do sócio (nome/ícone/cor/funis/ativa) vinda do backend. */
import { api } from './api.js';

// default = espelho do backend (settings/frentes.py) — funciona offline/antes do load
export const FRENTES = [
  { id: 'map',       nome: 'PSM M.A.P',     icon: '🏢', cor: '#3d3a33', funis: ['MAP'],       ativa: true },
  { id: 'conquista', nome: 'PSM Conquista', icon: '🏠', cor: '#b85400', funis: ['CONQUISTA'],                 ativa: true },
  { id: 'terceiros', nome: 'PSM Terceiros', icon: '🤝', cor: '#b03a62', funis: ['TERCEIRO'],     ativa: true },
  { id: 'locacoes',  nome: 'PSM Locações',  icon: '🔑', cor: '#6d3fd1', funis: ['LOCA'],     ativa: true },
];
// v88.62 (DS House PSM): a cor da frente vem do token --frente-<id> do tema atual
// (M.A.P creme/grafite, Conquista laranja, Terceiros rosa, Locações roxo — sem azul).
// Getter: gráficos em canvas recebem o hex resolvido; o set (config salva/backend) é ignorado.
for (const f of FRENTES) {
  const fallback = f.cor;
  Object.defineProperty(f, 'cor', {
    enumerable: true,
    get() {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--frente-' + f.id).trim();
        return v || fallback;
      } catch (_) { return fallback; }
    },
    set(_) { /* cor é do Design System */ },
  });
}
export const FRENTE_IDS = FRENTES.map(f => f.id);
export const frenteById = id => FRENTES.find(f => f.id === id) || null;
export const frentesAtivas = () => FRENTES.filter(f => f.ativa !== false);

let _loaded = false;
export async function loadFrentes(force) {
  if (_loaded && !force) return FRENTES;
  try {
    const r = await api.request('/api/v3/settings/frentes');
    if (r && Array.isArray(r.frentes)) {
      for (const f of r.frentes) {
        const cur = FRENTES.find(x => x.id === f.id);
        if (cur) Object.assign(cur, f);   // mutação in-place: quem importou FRENTES vê a config nova
      }
      _loaded = true;
    }
  } catch (_) { /* mantém o default — nunca quebra a navegação */ }
  return FRENTES;
}

// frente de um pipeline do RD (casefold/contains) — mesma regra do backend (frente_of)
export function frenteDoFunil(pipelineName) {
  const p = String(pipelineName || '').toUpperCase();
  for (const f of FRENTES) if ((f.funis || []).some(x => p.includes(String(x).toUpperCase()))) return f.id;
  return 'outros';
}
