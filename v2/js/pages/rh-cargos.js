/* ============================================================================
   PSM-OS v2 — Funções & Organograma (RH) · v84.7 (reconstruído)
   ----------------------------------------------------------------------------
   • Organograma por EMPRESA: 🏛 Holding PSM (sócios + estrutura compartilhada),
     🏢 PSM Imóveis (MAP/Terceiros/Locações) e 🏠 PSM Conquista — com hierarquia.
   • CLIQUE num cargo → visão individual: hierarquia, empresa, 📋 Funções &
     Tarefas, ⏰ Rotina sugerida e 🎯 Responsabilidades (+ pessoas do cargo).
   • PLAYBOOK COMPLETO pré-carregado pros 17 cargos (editável pelo sócio — o
     salvo sobrepõe o padrão campo a campo). Inclui as designações atuais
     (Estúdio no marketing, Distribuição+Fila de Reativação no backoffice).
   Backend: /api/v3/settings/funcoes_tarefas (cargo{} + perfil{}).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const EP = '/api/v3/settings/funcoes_tarefas';

const CARGO_LBL = {
  socio: '👑 Sócio', diretor: '👑 Diretor', lider: '🛡 Líder de Equipe',
  secretaria_vendas: '🗂️ Secretária de Vendas', backoffice: '📋 Back Office / Recepção',
  marketing: '📢 Marketing / Estúdio', financeiro: '💰 Financeiro',
  gerente: '🎯 Gerente (geral)', gerente_conquista: '🎯 Gerente Conquista', gerente_map: '🎯 Gerente MAP',
  gerente_locacao: '🎯 Gerente Locação', gerente_terceiros: '🎯 Gerente Terceiros',
  corretor: '🏠 Corretor (geral)', corretor_conquista: '🏠 Corretor Conquista', corretor_map: '🏗️ Corretor MAP',
  corretor_locacao: '🔑 Corretor Locação', corretor_terceiros: '🤝 Corretor Terceiros',
};
const CARGO_LVL = { socio: 10, diretor: 10, gerente: 7, gerente_conquista: 7, gerente_map: 7, gerente_locacao: 7, gerente_terceiros: 7, backoffice: 6, lider: 5, financeiro: 4, marketing: 3, secretaria_vendas: 3, corretor: 2, corretor_conquista: 2, corretor_map: 2, corretor_locacao: 2, corretor_terceiros: 2 };

// ── ESTRUTURA SOCIETÁRIA (pedido do Paulo, v84.7) ──
const ORG = [
  {
    id: 'holding', nome: '🏛 HOLDING PSM', cor: '#7c3aed',
    sub: 'Sócios + estrutura compartilhada que atende as duas empresas',
    niveis: [
      { titulo: 'Sociedade', cargos: ['socio', 'diretor'] },
      { titulo: 'Estrutura compartilhada', cargos: ['lider', 'backoffice', 'secretaria_vendas', 'financeiro', 'marketing'] },
    ],
  },
  {
    id: 'imoveis', nome: '🏢 PSM IMÓVEIS', cor: '#0891b2',
    sub: 'Alto padrão: MAP (empreendimentos) · Terceiros · Locações',
    niveis: [
      { titulo: 'Gestão', cargos: ['gerente', 'gerente_map', 'gerente_terceiros', 'gerente_locacao'] },
      { titulo: 'Comercial', cargos: ['corretor_map', 'corretor_terceiros', 'corretor_locacao', 'corretor'] },
    ],
  },
  {
    id: 'conquista', nome: '🏠 PSM CONQUISTA', cor: '#f59e0b',
    sub: 'Residencial / MCMV / primeiro imóvel',
    niveis: [
      { titulo: 'Gestão', cargos: ['gerente_conquista'] },
      { titulo: 'Comercial', cargos: ['corretor_conquista'] },
    ],
  },
];

/* ── PLAYBOOK PADRÃO DOS CARGOS (v84.7) — o salvo pelo sócio sobrepõe campo a campo.
   Inclui as designações definidas em jul/2026 somadas ao cargo respectivo. ── */
const PB = {
  socio: {
    funcoes: '• Decisão estratégica e últimas alçadas (metas, custos, contratações)\n• FECHAMENTO de alto ticket: carteira própria + leads qualificados + 🔥 quentes da reativação (retém ~4,5%)\n• Governança: one-on-ones com gestão, aprovação de campanhas e investimentos\n• Representação institucional (incorporadoras, parceiros, banco)',
    rotina: '08h00 — Briefing do dia + ponto de saúde do sistema (5 min)\n09h00–12h00 — Bloco COMERCIAL: visitas e fechamentos (quentes primeiro)\n14h00 — Fila de 🔥 quentes da reativação/campanha (agendar/fechar)\n15h30 — Gestão: 1:1, decisões pendentes, aprovações\n17h30 — Revisão do funil próprio no CRM\nSEG — Ler o Briefing de Guerra e definir as ordens da semana\nSEX — Métricas de Viabilidade + fechamento da semana',
    responsabilidades: '• Break-even da holding (objetivo 1: sem pró-labore; objetivo 2: com)\n• Margem por frente dentro da premissa\n• Nenhum 🔥 quente esperando mais de 24h\n• Ordens da semana executadas ou justificadas',
  },
  diretor: {
    funcoes: '• Gestão executiva das operações no dia a dia\n• Desdobrar as decisões dos sócios em planos com dono e prazo\n• Acompanhar KPIs por frente e cobrar cadência\n• Resolver travas operacionais entre áreas',
    rotina: '08h30 — Cockpit de Decisão + pendências do dia\n09h00 — Ronda com gestores (15 min cada)\n11h00 — Destravar prioridades da semana\n14h00 — Projetos estratégicos\n17h00 — Report do dia pros sócios',
    responsabilidades: '• Metas das frentes acompanhadas semanalmente\n• Nenhuma decisão parada por mais de 48h\n• One-on-ones da gestão em dia',
  },
  gerente: {
    funcoes: '• Liderar a equipe comercial da frente: distribuir leads, acompanhar negociações\n• Treinar (role-play, objeções, produto) e desenvolver corretores\n• Garantir cadência e higiene do CRM (nenhum negócio sem próxima tarefa)\n• One-on-one quinzenal com cada corretor',
    rotina: '08h30 — Funil da equipe: SLA de 1º contato + negócios parados\n09h00 — Daily de 15 min com a equipe (prioridades do dia)\n10h00–12h00 — Acompanhar negociações quentes (junto quando precisar)\n14h00 — Ter/Qui: treino de 40 min (produto/objeções)\n16h30 — Feedbacks individuais rápidos\n17h30 — Forecast e pipeline pro dia seguinte',
    responsabilidades: '• Meta de VGV da frente no mês\n• SLA de 1º contato < 30 min na equipe\n• Taxa de conversão e motivo de perda auditados\n• CRM 100% com próxima tarefa marcada',
  },
  lider: {
    funcoes: '• Referência tática da equipe no dia a dia (braço do gerente)\n• Primeiro apoio do corretor em negociação e sistema\n• Puxar a energia da Arena/ranking e rituais do time',
    rotina: '08h45 — Conferir fila do dia dos corretores\n10h00 — Campo: acompanhar visitas/negociações\n15h00 — Apoio a propostas e fichas\n17h00 — Repassar pro gerente o pulso do time',
    responsabilidades: '• Nenhum corretor travado sem apoio no mesmo dia\n• Rituais do time acontecendo (daily, arena)',
  },
  backoffice: {
    funcoes: 'BASE DO CARGO:\n• Recepção e atendimento (telefone/WhatsApp da recepção)\n• Rotinas administrativas, contratos e suporte a vendas\n\nDESIGNAÇÕES ATUAIS (jul/2026):\n• DISTRIBUIÇÃO (Leire): Campanhas WhatsApp, campanhas de captação, tabelas e materiais atualizados, imóveis no Kenlo\n• FILA DE REATIVAÇÃO (Mariane): lote diário 1-a-1, qualificar, agendar visita pro sócio fechar',
    rotina: '08h00 — Abrir recepção + WhatsApp; responder pendências da noite\n09h00 — Mariane: lote do dia na 🔁 Reativação MAP · Leire: Kenlo + tabelas/materiais\n11h00 — 🔥 Quentes: repassar respostas pro closer em até 1h\n14h00 — Mariane: 2º bloco da fila + retornos · Leire: campanhas (WA/captação)\n16h30 — Registrar TODOS os desfechos no sistema\n17h30 — Recepção fechada com zero mensagem sem resposta',
    responsabilidades: '• 100% do lote diário da fila trabalhado e registrado\n• Quente repassado em menos de 1 hora\n• Tabelas, materiais e Kenlo sempre atualizados\n• Nenhum lead do dia sem resposta',
  },
  secretaria_vendas: {
    funcoes: '• Agenda de plantões e escala\n• Fichas, propostas e documentação de venda\n• Suporte ao corretor em cadastro e sistema\n• Organização de eventos/ações de venda',
    rotina: '08h30 — Conferir plantões e agenda do dia\n09h30 — Fichas/propostas pendentes\n14h00 — Documentação e follow de assinaturas\n17h00 — Preparar o dia seguinte (escala + materiais)',
    responsabilidades: '• Nenhuma proposta parada por documentação\n• Escala de plantões publicada com antecedência',
  },
  financeiro: {
    funcoes: '• Contas a pagar/receber e conciliação (NIBO)\n• Comissões: cálculo, conferência e repasses\n• Lançar custos reais na Viabilidade (fonte única)\n• Relatório semanal de caixa pros sócios',
    rotina: '08h30 — Conciliação bancária do dia\n10h00 — Contas do dia (pagar/receber)\n14h00 — Comissões e repasses da semana\n16h00 — Atualizar custos na Viabilidade\nSEX 16h — Relatório de caixa da semana',
    responsabilidades: '• Zero atraso em obrigações\n• Custos reais SEMPRE atualizados no sistema\n• Comissão paga certa e no prazo',
  },
  marketing: {
    funcoes: 'BASE DO CARGO:\n• Gestão de mídia, criativos e presença digital\n\nDESIGNAÇÃO ATUAL — ESTÚDIO PSM (Guilherme, jul/2026):\n• Social media: movimentar os Instagrams e TikToks (linhas editoriais prontas)\n• Video maker: reels, vídeos de imóveis e conteúdo (Conquista + marca Paulo)\n• Foto/vídeo dos imóveis captados (SÓ a mídia — a captação é do corretor)\n• Anúncios ORGÂNICOS: Marketplace/OLX/grupos, com renovação semanal\n• Criativos pro tráfego pago (a distribuição é da Leire)\n⚠️ REGRA: NÃO atende lead — resposta padrão manda pro WhatsApp da recepção',
    rotina: '08h30 — Pauta do dia (linha editorial do mês)\n09h00–11h00 — Gravação/edição (reels, vídeos)\n11h30 — Publicar + renovar anúncios do Marketplace/OLX\n14h00 — Foto/vídeo dos imóveis agendados (meta: mídia em 48h da captação)\n16h00 — Criativos pra tráfego + preparar pauta seguinte\nSEX — Fechar o calendário da semana seguinte',
    responsabilidades: '• Reels/posts da semana publicados no prazo da linha editorial\n• 100% dos imóveis novos com foto/vídeo em 48h\n• Anúncios orgânicos ativos e renovados (sem anúncio morto)\n• Leads orgânicos/mês crescendo (origem marcada no CRM)',
  },
  corretor: {
    funcoes: '• Atender leads dentro do SLA e conduzir até o fechamento\n• Visitas, propostas e negociação\n• Manter o CRM vivo: todo negócio com próxima tarefa\n• Prospecção ativa da própria carteira',
    rotina: '08h30 — Fila do dia (Cérebro de Vendas) + follow-ups\n09h00 — Bloco de contatos (ligação > WhatsApp)\n10h00–12h30 — Visitas\n14h00 — Novas oportunidades + propostas\n17h00 — CRM zerado: desfecho e próxima tarefa em tudo\n18h00 — Confirmar visitas de amanhã',
    responsabilidades: '• SLA de 1º contato < 30 min\n• Mínimo de visitas semanais combinado com o gerente\n• Meta mensal de vendas/VGV\n• Zero negócio parado +7 dias sem justificativa',
  },
  corretor_conquista: {
    funcoes: 'BASE: tudo do Corretor (geral) +\n• Especialista MCMV/financiamento: simulação Caixa, subsídio, doc do cliente\n• Conduzir o cliente no processo bancário até a assinatura\n• Plantões de lançamento/feirões',
    rotina: '08h30 — Fila do dia + retorno de aprovações bancárias\n09h00 — Contatos e simulações (Simulador Conquista)\n10h00–12h30 — Visitas/decorado\n14h00 — Docs de clientes em aprovação + novas oportunidades\n17h00 — CRM zerado + status do banco atualizado',
    responsabilidades: '• Meta mensal da Conquista (venda/VGV)\n• Nenhum cliente parado por documentação sem follow\n• Simulação feita em TODO atendimento qualificado',
  },
  corretor_map: {
    funcoes: 'BASE: tudo do Corretor (geral) +\n• Especialista em EMPREENDIMENTOS/lançamentos (produto, tabela, INCC, repasse)\n• CLOSER DE TRANSBORDO da 🔁 Reativação: atende as visitas agendadas que não couberem na agenda do sócio\n• Plantões de lançamento',
    rotina: '08h30 — Fila do dia + agenda de visitas da reativação\n09h00 — Contatos (transbordo dos quentes primeiro)\n10h00–12h30 — Visitas/plantão\n14h00 — Propostas + follow de repasses\n17h00 — CRM + desfechos da reativação registrados',
    responsabilidades: '• Meta mensal MAP\n• Todo quente da reativação atendido em 24h\n• Tabelas e condições dos empreendimentos na ponta da língua',
  },
  corretor_locacao: {
    funcoes: 'BASE: tudo do Corretor (geral) +\n• CAPTAÇÃO de imóveis pra locação (construir a carteira recorrente — o piso da PSM)\n• Fechamento de contratos de locação (1º aluguel + adm ~10%)\n• Relação com proprietários',
    rotina: '08h30 — Leads de locação do dia\n09h30 — Bloco de CAPTAÇÃO (proprietários, indicações, placas)\n11h00 — Visitas de locação\n14h00 — Propostas/contratos + vistorias\n17h00 — CRM + pipeline de captação atualizado',
    responsabilidades: '• Meta de captações/mês (cada contrato = renda recorrente da casa)\n• Contrato fechado sem pendência de vistoria/doc\n• Proprietário informado semanalmente',
  },
  corretor_terceiros: {
    funcoes: 'BASE: tudo do Corretor (geral) +\n• Venda de imóveis de TERCEIROS (comissão 40% vendedor / 10% captador / 50% casa)\n• Captação de imóveis de terceiros com exclusividade\n• Parcerias com outros corretores/imobiliárias',
    rotina: '08h30 — Fila do dia\n09h30 — Bloco de captação/parcerias\n10h30–12h30 — Visitas\n14h00 — Propostas e negociação (proprietário × comprador)\n17h00 — CRM + funil de captação',
    responsabilidades: '• Meta mensal de vendas de terceiros\n• Captações com exclusividade documentada\n• Split de comissão correto em toda venda',
  },
};
// gerentes por frente herdam o playbook do gerente geral + foco da frente
PB.gerente_conquista = { ...PB.gerente, funcoes: PB.gerente.funcoes + '\n• FOCO CONQUISTA: funil MCMV, ritmo de simulações e aprovação bancária da equipe' };
PB.gerente_map = { ...PB.gerente, funcoes: PB.gerente.funcoes + '\n• FOCO MAP: domínio dos empreendimentos/tabelas e distribuição do transbordo da reativação' };
PB.gerente_locacao = { ...PB.gerente, funcoes: PB.gerente.funcoes + '\n• FOCO LOCAÇÃO: meta de captações e crescimento da carteira recorrente (o piso da PSM)' };
PB.gerente_terceiros = { ...PB.gerente, funcoes: PB.gerente.funcoes + '\n• FOCO TERCEIROS: rede de captadores/parcerias e split 40/10/50 auditado' };

let _root = null, _cargo = {}, _perfil = {}, _users = [];
const me = () => auth.user() || {};
const isSocio = () => (me().lvl || 0) >= 10;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cargoLbl = r => CARGO_LBL[r] || ('🏷️ ' + r);
const peopleOf = role => _users.filter(u => (u.status || 'ativo') === 'ativo' && (u.role || '') === role);
const nl2br = s => esc(s).replace(/\n/g, '<br>');
// playbook efetivo: salvo pelo sócio sobrepõe o padrão CAMPO a CAMPO
function playbook(role) {
  const d = PB[role] || {};
  const s = _cargo[role] || {};
  return {
    funcoes: s.funcoes || d.funcoes || '', tarefas: s.tarefas || '',
    objetivos: s.objetivos || '', rotina: s.rotina || d.rotina || '',
    responsabilidades: s.responsabilidades || d.responsabilidades || '',
    custom: !!(s.funcoes || s.rotina || s.responsabilidades),
  };
}

export async function pageRhCargos(ctx, root) {
  _root = root;
  if ((me().lvl || 0) < 2) { root.innerHTML = '<div class="alert alert-warn">🔒 Sem acesso.</div>'; return; }
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const [r, u] = await Promise.all([api.request(EP), api.listUsers().catch(() => ({ users: [] }))]);
    _cargo = r.cargo || {}; _perfil = r.perfil || {}; _users = (u && u.users) || [];
  } catch (e) { root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return; }
  render();
}

function avatar(u, size = 34) {
  const p = _perfil[u.id] || {};
  const ini = esc((u.ini || (u.name || '?').slice(0, 2)).toUpperCase());
  if (p.foto) return `<img src="${esc(p.foto)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex:none" alt="">`;
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.36)}px;flex:none">${ini}</div>`;
}

function render() {
  const u = me();
  const meuPB = playbook(u.role);
  const myP = _perfil[u.id] || {};
  _root.innerHTML = `
    <style>
      .og-emp{border:1px solid var(--border);border-top:4px solid var(--c);border-radius:14px;overflow:hidden;background:var(--bg-2)}
      .og-emp-h{background:linear-gradient(135deg,var(--c),transparent 300%);color:#fff;padding:12px 14px}
      .og-nivel{padding:4px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;font-weight:800;color:var(--c);opacity:.9;border-top:1px dashed var(--border);margin-top:6px}
      .og-cargo{background:var(--bg-1,#fff);border:1px solid var(--border);border-radius:10px;padding:9px 11px;margin:6px 10px;cursor:pointer;transition:box-shadow .12s,transform .12s}
      .og-cargo:hover{box-shadow:0 8px 22px rgba(0,0,0,.14);transform:translateY(-1px)}
      .og-pessoa{display:flex;align-items:center;gap:6px;font-size:11.5px}
    </style>
    <div class="card">
      <h2 class="card-title">🗂 Funções & Organograma</h2>
      <p class="card-sub"><b>Clique em qualquer cargo</b> pra abrir a visão individual: hierarquia, funções & tarefas, rotina sugerida e responsabilidades.${isSocio() ? ' Você (sócio) pode editar o playbook de cada cargo.' : ''}</p>
    </div>

    <!-- Meu cargo -->
    <div class="card mt-3">
      <div style="font-weight:800;margin-bottom:8px">👤 Meu perfil & meu cargo</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
        <div style="text-align:center">
          ${avatar(u, 84)}
          <div style="margin-top:6px"><label class="btn btn-ghost btn-sm" style="cursor:pointer">📷 Trocar foto<input type="file" id="cg-foto" accept="image/*" style="display:none"></label></div>
          ${myP.foto ? '<div><button class="btn btn-ghost btn-sm" id="cg-foto-rm" style="color:#dc2626">remover</button></div>' : ''}
        </div>
        <div style="flex:1;min-width:220px">
          <div style="font-weight:700">${esc(u.name || '')} <span class="tiny muted">· ${esc(cargoLbl(u.role))} · nível ${CARGO_LVL[u.role] || u.lvl || '?'}</span></div>
          <label class="tiny muted" style="display:block;margin-top:6px">Sua bio (texto livre)
            <textarea id="cg-bio" class="input" rows="3" placeholder="Conte um pouco sobre você…">${esc(myP.bio || '')}</textarea></label>
          <button class="btn btn-primary btn-sm mt-2" id="cg-bio-save">💾 Salvar perfil</button>
          <button class="btn btn-ghost btn-sm mt-2" id="cg-meu-cargo">📌 Ver meu playbook completo</button>
          <span class="tiny muted" id="cg-msg"></span>
        </div>
        ${meuPB.responsabilidades ? `
        <div style="flex:1;min-width:250px;background:var(--bg-3);border-radius:10px;padding:10px;font-size:12px">
          <div style="font-weight:800;margin-bottom:4px">🎯 Suas responsabilidades</div>
          <div>${nl2br(meuPB.responsabilidades)}</div>
        </div>` : ''}
      </div>
    </div>

    <!-- Organograma societário -->
    <div class="card mt-3">
      <div style="font-weight:800;margin-bottom:2px">🌳 Organograma PSM</div>
      <div class="tiny muted" style="margin-bottom:12px">Estrutura societária: a Holding no topo (sócios + time compartilhado) e as duas operações. Número = pessoas ativas no cargo.</div>
      <div style="max-width:760px;margin:0 auto 14px">${empBloco(ORG[0])}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
        ${empBloco(ORG[1])}
        ${empBloco(ORG[2])}
      </div>
    </div>`;

  // wiring
  const fi = _root.querySelector('#cg-foto');
  if (fi) fi.addEventListener('change', () => {
    const f = fi.files && fi.files[0]; if (!f) return;
    resizePhoto(f, async dataUrl => {
      try { await api.request(EP, { method: 'POST', body: { action: 'set_perfil', foto: dataUrl } }); _perfil[u.id] = { ...(_perfil[u.id] || {}), foto: dataUrl }; render(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
  });
  const rm = _root.querySelector('#cg-foto-rm');
  if (rm) rm.onclick = async () => { try { await api.request(EP, { method: 'POST', body: { action: 'set_perfil', foto: '' } }); _perfil[u.id] = { ...(_perfil[u.id] || {}), foto: '' }; render(); } catch (e) { alert(e.message); } };
  _root.querySelector('#cg-bio-save').onclick = async () => {
    const bio = _root.querySelector('#cg-bio').value;
    try { await api.request(EP, { method: 'POST', body: { action: 'set_perfil', bio } }); _perfil[u.id] = { ...(_perfil[u.id] || {}), bio: bio.trim() }; _root.querySelector('#cg-msg').textContent = '✅ salvo'; }
    catch (e) { alert('Erro: ' + e.message); }
  };
  _root.querySelector('#cg-meu-cargo')?.addEventListener('click', () => openCargoView(u.role));
  _root.querySelectorAll('[data-cargo]').forEach(el => el.addEventListener('click', () => openCargoView(el.dataset.cargo)));
}

function empBloco(emp) {
  return `
    <div class="og-emp" style="--c:${emp.cor}">
      <div class="og-emp-h">
        <div style="font-weight:900;font-size:15px">${esc(emp.nome)}</div>
        <div style="font-size:11.5px;opacity:.9">${esc(emp.sub)}</div>
      </div>
      ${emp.niveis.map(nv => {
        const cards = nv.cargos.map(cargoMini).filter(Boolean).join('');
        if (!cards) return '';
        return `<div class="og-nivel">${esc(nv.titulo)}</div>${cards}`;
      }).join('')}
      <div style="height:8px"></div>
    </div>`;
}

function cargoMini(role) {
  const ppl = peopleOf(role);
  // cargo sem gente E sem playbook custom: mostra mesmo assim (estrutura alvo), mais discreto
  const pb = playbook(role);
  return `
    <div class="og-cargo" data-cargo="${esc(role)}" style="${ppl.length ? '' : 'opacity:.65'}">
      <div class="flex items-center" style="justify-content:space-between;gap:6px">
        <span style="font-weight:700;font-size:12.5px">${esc(cargoLbl(role))}</span>
        <span class="tiny" style="background:var(--bg-3);border-radius:99px;padding:1px 8px;font-weight:700">${ppl.length || '—'}</span>
      </div>
      ${ppl.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:7px">${ppl.map(p => `<span class="og-pessoa">${avatar(p, 22)}<span>${esc((p.name || '').split(' ')[0])}</span></span>`).join('')}</div>` : ''}
      <div class="tiny muted" style="margin-top:5px">nível ${CARGO_LVL[role] || '?'} · clique pra ver funções, rotina e responsabilidades${pb.custom ? ' · ✏️ personalizado' : ''}</div>
    </div>`;
}

/* ── VISÃO INDIVIDUAL DO CARGO (funções & tarefas + rotina + responsabilidades) ── */
function openCargoView(role) {
  const pb = playbook(role);
  const ppl = peopleOf(role);
  const emp = ORG.find(e => e.niveis.some(n => n.cargos.includes(role)));
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 14px;overflow:auto';
  const bloco = (ico, titulo, txt) => txt ? `
    <div style="background:var(--bg-3);border-radius:12px;padding:12px 14px;margin-top:10px">
      <div style="font-weight:800;font-size:13px;margin-bottom:6px">${ico} ${titulo}</div>
      <div style="font-size:12.5px;line-height:1.65">${nl2br(txt)}</div>
    </div>` : '';
  ov.innerHTML = `
    <div class="card" style="max-width:680px;width:100%;margin:auto">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <h3 class="card-title" style="margin:0">${esc(cargoLbl(role))}</h3>
          <div class="tiny muted" style="margin-top:2px">${emp ? esc(emp.nome) : 'PSM'} · hierarquia: <b>nível ${CARGO_LVL[role] || '?'}</b> de 10 ${pb.custom ? ' · ✏️ playbook personalizado pelo sócio' : ' · playbook padrão PSM'}</div>
        </div>
        <span style="display:flex;gap:6px">
          ${isSocio() ? `<button class="btn btn-ghost btn-sm" id="cv-edit">✏️ Editar</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="cv-x">✕</button>
        </span>
      </div>
      ${ppl.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${ppl.map(p => {
        const bio = (_perfil[p.id] || {}).bio;
        return `<span class="og-pessoa" title="${esc(bio || '')}" style="background:var(--bg-3);border-radius:99px;padding:3px 10px 3px 4px">${avatar(p, 24)}<b style="font-size:12px">${esc(p.name || '')}</b></span>`;
      }).join('')}</div>` : '<div class="tiny muted" style="margin-top:8px">Nenhuma pessoa neste cargo hoje (estrutura-alvo).</div>'}
      ${bloco('📋', 'Funções & Tarefas', [pb.funcoes, pb.tarefas].filter(Boolean).join('\n'))}
      ${bloco('⏰', 'Rotina sugerida (pra cumprir os objetivos do cargo)', pb.rotina)}
      ${bloco('🎯', 'Responsabilidades (o que é cobrado)', pb.responsabilidades)}
      ${bloco('🏁', 'Objetivos', pb.objetivos)}
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#cv-x').onclick = () => ov.remove();
  ov.querySelector('#cv-edit')?.addEventListener('click', () => { ov.remove(); openCargoEditor(role); });
}

/* ── editor do sócio (agora com rotina + responsabilidades) ── */
function openCargoEditor(role) {
  const pb = playbook(role);
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 14px;overflow:auto';
  ov.innerHTML = `
    <div class="card" style="max-width:620px;width:100%;margin:auto">
      <div class="flex" style="justify-content:space-between;align-items:center"><h3 class="card-title" style="margin:0">✏️ ${esc(cargoLbl(role))}</h3><button class="btn btn-ghost btn-sm" id="ce-x">✕</button></div>
      <p class="tiny muted" style="margin:4px 0 8px">O texto abaixo já vem com o playbook padrão PSM — edite à vontade; o que salvar vale pra todo mundo do cargo.</p>
      <label class="tiny muted" style="display:block">📋 Funções & tarefas (o que o cargo faz)<textarea id="ce-func" class="input" rows="6">${esc(pb.funcoes)}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:6px">⏰ Rotina sugerida (agenda pra cumprir os objetivos)<textarea id="ce-rot" class="input" rows="6">${esc(pb.rotina)}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:6px">🎯 Responsabilidades (o que é cobrado)<textarea id="ce-resp" class="input" rows="4">${esc(pb.responsabilidades)}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:6px">🏁 Objetivos (opcional)<textarea id="ce-obj" class="input" rows="2">${esc(pb.objetivos)}</textarea></label>
      <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="ce-save">💾 Salvar cargo</button><span class="tiny muted" id="ce-msg"></span></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#ce-x').onclick = () => ov.remove();
  ov.querySelector('#ce-save').onclick = async () => {
    const body = {
      action: 'set_cargo', role,
      funcoes: ov.querySelector('#ce-func').value, objetivos: ov.querySelector('#ce-obj').value,
      tarefas: '', rotina: ov.querySelector('#ce-rot').value, responsabilidades: ov.querySelector('#ce-resp').value,
    };
    try {
      await api.request(EP, { method: 'POST', body });
      _cargo[role] = { funcoes: body.funcoes.trim(), objetivos: body.objetivos.trim(), tarefas: '', rotina: body.rotina.trim(), responsabilidades: body.responsabilidades.trim() };
      ov.remove(); render();
    } catch (e) { alert('Erro: ' + e.message); }
  };
}

function resizePhoto(file, cb) {
  const r = new FileReader();
  r.onload = e => {
    const img = new Image();
    img.onload = () => {
      const max = 256; let w = img.width, h = img.height; const s = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => alert('Imagem inválida.');
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}
