/* ============================================================================
   PSM-OS v2 — Mapa de habilidades (v87.77)
   ----------------------------------------------------------------------------
   Liga GARGALO do funil → HABILIDADE → módulo da Academy. É a régua que o
   One-on-One usa pra dizer QUAL treino cada corretor precisa, e a etiqueta que
   todo treinamento carrega (pra depois medir o antes × depois).
   Trilha/módulo são sugestões — o gestor troca no treino se quiser.
============================================================================ */

export const HABILIDADES = [
  { id: 'abordagem',      ico: '📞', nome: '1º contato e qualificação',         etapa: 'Lead → Contato',            trilha: 'Vendas',           modulo: 'Atendimento e qualificação' },
  { id: 'agendamento',    ico: '📅', nome: 'Conexão e agendamento',             etapa: 'Contato → Agendamento',     trilha: 'PNL',              modulo: 'PNL aplicada a vendas' },
  { id: 'comparecimento', ico: '✅', nome: 'Confirmação e comparecimento',      etapa: 'Agendamento → Visita',      trilha: 'Vendas',           modulo: 'Atendimento e qualificação' },
  { id: 'visita',         ico: '🏠', nome: 'Condução de visita e apresentação', etapa: 'Visita → Proposta',         trilha: 'Vendas',           modulo: 'Atendimento e qualificação' },
  { id: 'negociacao',     ico: '🤝', nome: 'Negociação e objeções',             etapa: 'Proposta → Pasta',          trilha: 'Vendas',           modulo: 'Negociação' },
  { id: 'fechamento',     ico: '🖊', nome: 'Fechamento e financiamento',        etapa: 'Pasta → Venda',             trilha: 'Lançamentos MCMV', modulo: 'Produto e financiamento' },
  { id: 'velocidade',     ico: '⚡', nome: 'Velocidade de atendimento',         etapa: 'Tempo até o 1º contato',    trilha: 'Vendas',           modulo: 'A base da venda' },
  { id: 'followup',       ico: '🔁', nome: 'Follow-up e cadência',              etapa: 'Descarte e negócio parado', trilha: 'Vendas',           modulo: 'Máquina de vendas PSM' },
  { id: 'posicionamento', ico: '🎯', nome: 'Posicionamento e marca pessoal',    etapa: null, trilha: 'Marketing',      modulo: 'Marketing imobiliário' },
  { id: 'produto',        ico: '🏗', nome: 'Produto e mercado',                 etapa: null, trilha: 'Mercado Básico', modulo: 'Produto e precificação' },
  { id: 'comportamental', ico: '🧠', nome: 'Comportamental e alta performance', etapa: null, trilha: 'PNL',            modulo: 'Alta performance pessoal' },
  { id: 'lideranca',      ico: '🛡', nome: 'Liderança e gestão',                etapa: null, trilha: null, modulo: null },
  { id: 'ferramentas',    ico: '🧰', nome: 'Ferramentas e processos',           etapa: null, trilha: null, modulo: null },
];

export function habilidade(id) { return HABILIDADES.find(h => h.id === id) || null; }

// As 6 passagens do funil canônico do 1:1 (Lead → Contato → Agend. → Visita → Proposta → Pasta → Venda)
const ETAPA_HAB = ['abordagem', 'agendamento', 'comparecimento', 'visita', 'negociacao', 'fechamento'];
const ETAPA_LBL = ['Lead → Contato', 'Contato → Agendamento', 'Agendamento → Visita', 'Visita → Proposta', 'Proposta → Pasta', 'Pasta → Venda'];
const MIN_VOL = 5;      // menos que isso entrando na etapa = taxa é ruído, não gargalo
const GAP_MIN = 0.15;   // 15% abaixo da média da equipe já é gargalo

/* Diagnóstico do corretor a partir do payload do 1:1 (/api/v3/oo/corretor).
   • Com a equipe no payload (sócio ou o próprio corretor): compara cada etapa com a
     MÉDIA DOS COLEGAS e estima quantas vendas o gargalo custa no período
     (gente a mais que passaria da etapa × o resto do funil dele).
   • Sem a equipe (líder/gerente abrindo um corretor): aponta a etapa em que ELE
     mais perde — e diz isso, pra ninguém confundir com comparação.
   Devolve { itens:[{hab, etapa, taxa, ref, vendas, vgv, texto}], fonte:'equipe'|'funil'|null }. */
export function diagnosticar(det) {
  const f = (det && det.funnel) || [];
  if (f.length < 7) return { itens: [], fonte: null };
  const own = f.slice(1).map(s => (s.conv_from_prev == null ? null : Number(s.conv_from_prev)));
  const vol = f.slice(0, 6).map(s => Number(s.n) || 0);
  const selfId = det.corretor && det.corretor.id;
  const pares = ((det.team && det.team.members) || []).filter(m => m.id !== selfId && Array.isArray(m.conv));
  const bench = ETAPA_HAB.map((_, j) => {
    const vals = pares.map(m => m.conv[j]).filter(v => v != null).map(Number);
    return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const temBench = bench.some(v => v != null);
  const taxa = j => (own[j] != null ? own[j] : bench[j]);
  const vendasExtra = (j, alvo) => {
    let x = vol[j] * Math.max(0, alvo - own[j]) / 100;
    for (let k = j + 1; k < 6; k++) { const r = taxa(k); if (r == null) return null; x *= r / 100; }
    return x;
  };
  const tm = det.team && det.team.metrics;
  const ticket = det.ticket_medio || (tm && tm.ticket_medio) || null;
  const itens = [];
  ETAPA_HAB.forEach((hid, j) => {
    if (own[j] == null || vol[j] < MIN_VOL || bench[j] == null) return;
    const gap = bench[j] - own[j];
    if (gap <= 0 || gap / bench[j] < GAP_MIN) return;
    const v = vendasExtra(j, bench[j]);
    itens.push({ hab: habilidade(hid), etapa: ETAPA_LBL[j], taxa: own[j], ref: bench[j], vendas: v,
                 vgv: v != null && ticket ? v * ticket : null, peso: v != null ? v : gap / 100 });
  });
  let fonte = itens.length ? 'equipe' : null;
  if (!itens.length && !temBench) {
    let pior = -1;
    ETAPA_HAB.forEach((_, j) => { if (own[j] != null && vol[j] >= MIN_VOL && (pior < 0 || own[j] < own[pior])) pior = j; });
    if (pior >= 0) {
      itens.push({ hab: habilidade(ETAPA_HAB[pior]), etapa: ETAPA_LBL[pior], taxa: own[pior], ref: null, vendas: null, vgv: null, peso: 1 });
      fonte = 'funil';
    }
  }
  // velocidade: 1º contato bem mais lento que a equipe
  const pc = det.primeiro_contato_h, pcT = tm && tm.primeiro_contato_h;
  if (pc != null && pcT != null && pc > Math.max(2, pcT * 1.5)) {
    itens.push({ hab: habilidade('velocidade'), etapa: 'Tempo até o 1º contato', taxa: null, ref: null,
                 texto: `${fmt1(pc)} h (equipe ${fmt1(pcT)} h)`, vendas: null, vgv: null, peso: 0.5 });
    fonte = fonte || 'equipe';
  }
  // follow-up: descarte bem acima da equipe
  const dr = det.descarte_rate, drT = tm && tm.descarte_rate;
  if (dr != null && drT != null && dr > drT * 1.25 && dr - drT >= 8) {
    itens.push({ hab: habilidade('followup'), etapa: 'Descarte', taxa: null, ref: null,
                 texto: `${fmt1(dr)}% de descarte (equipe ${fmt1(drT)}%)`, vendas: null, vgv: null, peso: 0.4 });
    fonte = fonte || 'equipe';
  }
  itens.sort((a, b) => (b.peso || 0) - (a.peso || 0));
  return { itens: itens.slice(0, 3), fonte };
}

function fmt1(v) { return (Math.round(Number(v) * 10) / 10).toLocaleString('pt-BR'); }
