/* PSM-OS v2 — Painel Agente Vera (Sprint 8.2) */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { renderAgentePainel } from './_agente-painel.js';

const AGENT = {
  id: 'vera',
  name: 'Vera',
  ico: '💜',
  color: '#8b5cf6',
  line: 'PSM Assessoria Imobiliária',
  desc: 'Atendimento de leads, qualificação, nutrição e captação para assessoria imobiliária',
  capacidades: [
    '💬 Atende WhatsApp 24/7 com tom humano e PSM',
    '🎯 Qualifica leads (orçamento, prazo, perfil)',
    '🏠 Sugere imóveis disponíveis do estoque PSM',
    '📞 Direciona ao corretor responsável quando lead é qualificado',
    '📋 Cria lead automaticamente no RD Station',
    '💜 Acompanha conversas de pré-venda em fluxo de nutrição',
  ],
  exemplos: [
    'Olá! Sou a Vera, da PSM Imóveis. Vi seu interesse em apartamentos em Rio Preto. Posso te ajudar?',
    'Pra te indicar as melhores opções: você busca pra morar ou investir? Quantos quartos? Bairro de preferência?',
    'Temos 3 opções na faixa que você procura. Quer ver a tabela ou prefere visitar?',
  ],
};

export async function pageAgenteVera(ctx, root) {
  await renderAgentePainel(root, AGENT, ctx);
}
