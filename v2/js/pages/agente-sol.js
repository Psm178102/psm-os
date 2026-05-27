/* PSM-OS v2 — Painel Agente Sol (Sprint 8.2) */
import { renderAgentePainel } from './_agente-painel.js';

const AGENT = {
  id: 'sol',
  name: 'Sol',
  ico: '☀️',
  color: '#f59e0b',
  line: 'PSM Conquista',
  desc: 'Prospecção, atendimento e nutrição de leads para incorporação e loteamento',
  capacidades: [
    '☀️ Atende leads de incorporação e loteamento via WhatsApp/IG',
    '🎯 Qualifica perfil pra MCMV, conquista e financiamento',
    '🏗 Apresenta empreendimentos da PSM (planta, valores, condições)',
    '📋 Cria lead no RD Station — funil PSM Conquista',
    '☎️ Repassa lead qualificado pro corretor de plantão',
    '🌱 Nutre leads frios com conteúdo (vídeos, depoimentos)',
  ],
  exemplos: [
    'Oi! Sou a Sol, da PSM Conquista. Vi seu interesse em apartamentos novos. Posso te ajudar com as condições?',
    'Pra dar a melhor proposta: você já se enquadra no MCMV (renda até 8 SM) ou é fora?',
    'Temos lançamentos com entrada facilitada. Quer ver as opções de Rio Preto, Mirassol ou Olímpia?',
  ],
};

export async function pageAgenteSol(ctx, root) {
  await renderAgentePainel(root, AGENT, ctx);
}
