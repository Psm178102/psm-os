/* PSM-OS v2 — Gestão de Pessoas (Sprint 8.1) */
import { api, hojeISO } from '../api.js';
import { auth } from '../auth.js';
import { pageTalentos } from './talentos.js';
import { renderAvaliacoes } from './avaliacoes.js';
import { pageTreinamentos } from './treinamentos.js';

let _root = null;
let _ctx = null;
let _tab = 'treinamentos';
let _treinamentos = [];
let _editing = null;
let _rh = { onboarding: [], offboarding: [] };   // processos de admissão/desligamento (sócio)
let _cargosOff = {};   // offboarding por cargo (requisitos/métricas/checklist). v81.92
const isSocio = () => (auth.user()?.lvl || 0) >= 10;
const SETORES = ['Comercial', 'SDR / Prospecção', 'Marketing', 'Backoffice', 'Financeiro', 'RH', 'Diretoria', 'Locação'];
const EQUIPES_COM = ['Conquista', 'MAP', 'Locação', 'Terceiros'];
let _trSetor = '', _trEquipe = '';   // filtros do Treinamentos

// Abas do hub de Pessoas, na ordem pedida (v81.52). Onboarding/Offboarding = só
// sócio (lvl 10); o resto = líder+ (lvl 5).
function visibleTabs() {
  // v81.58: cada aba é rota própria na barra lateral e o acesso é decidido na matriz
  // por papel (Configurações → Permissões). Aqui só validamos o _tab do deep-link —
  // por isso TODAS entram (sem filtro de sócio, que resetava o tab errado).
  return [
    { id: 'treinamentos', lbl: '🎓 Treinamentos' },
    { id: 'onboarding', lbl: '🚀 Onboarding' },
    { id: 'offboarding', lbl: '👋 Offboarding' },
    { id: 'talentos', lbl: '🧲 Recrutamento & Seleção' },
    { id: 'plano', lbl: '📈 Plano de Crescimento' },
    { id: 'clima', lbl: '🌡 Clima Interno' },
    { id: 'avaliacoes', lbl: '⭐ Avaliações & Feedbacks' },
  ];
}

// Entradas diretas (deep-link) — cada aba é um item próprio na barra lateral (v81.55)
export async function pageOnboarding(ctx, root) { _tab = 'onboarding'; return pageGestaoPessoas(ctx, root); }
export async function pageOffboarding(ctx, root) { _tab = 'offboarding'; return pageGestaoPessoas(ctx, root); }
export async function pageRhTreinamentos(ctx, root) { _tab = 'treinamentos'; return pageGestaoPessoas(ctx, root); }
export async function pageRhRecrutamento(ctx, root) { _tab = 'talentos'; return pageGestaoPessoas(ctx, root); }
export async function pageRhPlano(ctx, root) { _tab = 'plano'; return pageGestaoPessoas(ctx, root); }
export async function pageRhClima(ctx, root) { _tab = 'clima'; return pageGestaoPessoas(ctx, root); }
export async function pageRhAvaliacoes(ctx, root) { _tab = 'avaliacoes'; return pageGestaoPessoas(ctx, root); }

export async function pageGestaoPessoas(ctx, root) {
  _root = root; _ctx = ctx;
  // v81.58: quem vê isto é decidido na matriz por papel (Configurações → Permissões).
  // Piso mínimo só pra barrar não-autenticado/sem cargo.
  if ((auth.user()?.lvl || 0) < 2) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Sem acesso a este módulo.</div>';
    return;
  }
  const valid = visibleTabs().map(t => t.id);
  if (!valid.includes(_tab)) _tab = valid[0];   // default = 1ª aba visível (sócio→Onboarding)
  render();
  await loadData();
}

// v81.56: cada aba é um item próprio no menu lateral — sem barra de abas interna.
// A página renderiza direto o conteúdo do módulo da rota (_tab) em #gp-body.
function render() {
  _root.innerHTML = `<div id="gp-body"></div>`;
}

async function loadData() {
  if (_tab === 'talentos') return pageTalentos(_ctx, document.getElementById('gp-body'));
  if (_tab === 'onboarding' || _tab === 'offboarding') return loadRH(_tab);
  if (_tab === 'avaliacoes') return renderAvaliacoes(document.getElementById('gp-body'));
  if (_tab === 'plano' || _tab === 'clima') return loadReg(_tab);
  return loadTreinamentos();
}

/* TREINAMENTOS — v87.78: virou módulo próprio (pages/treinamentos.js: ciclo de vida,
   chamada, agenda/Zoho, Meus treinamentos). Esta aba só delega pra lá. */
function loadTreinamentos() { return pageTreinamentos(_ctx, document.getElementById('gp-body')); }

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ════════════════════════════════════════════════════════════════════════
   ONBOARDING & OFFBOARDING (admissão / desligamento) — só sócio (lvl 10)
   Trilha por etapas com checklist. O template (etapas+itens) mora aqui; o
   backend (gp/rh_processos, shared_kv) só guarda nome/dados + quais itens
   estão marcados. Progresso = itens marcados / total do template. v81.44
═══════════════════════════════════════════════════════════════════════════ */
/* v86.50 — trilha evoluída a partir do PSM_ONBOARDING v4.0 (abr/26, normativo) +
   Onboarding 3.10 (mar/26, operacional), corrigida pro estado ATUAL da casa
   (House PSM como sistema oficial; papéis por FUNÇÃO, não por nome — pessoas mudam). */
const RH_TPL = {
  onboarding: {
    titulo: '🚀 Onboarding — admissão', cor: '#16a34a', dataLbl: 'Data de início',
    sub: 'Jornada 0→90 dias: da papelada à primeira avaliação formal. Base: Onboarding PSM v4.0 + 3.10, evoluído.',
    campos: ['cargo', 'equipe', 'data', 'responsavel'],
    etapas: [
      { id: 'fase0', lbl: '📄 Fase 0 — antes do dia 1 (bloqueante)', itens: [
        ['creci', 'CRECI/SP ativo — sem CRECI, sem operação'],
        ['pj', 'PJ regular: CNPJ ativo, contador, NF emissível'],
        ['contrato', 'Contrato de Associação assinado'],
        ['termos', 'Termos de aceite: Manual de Cultura + Código de Ética'],
        ['leituras', 'Leituras obrigatórias: Manual, Código de Ética e Dress Code (Cap. 4)'],
        ['banco', 'Dados bancários/PJ p/ comissão (pagamentos dias 5 e 20)'],
        ['marca', 'Marca foco definida com a liderança (Imóveis / Conquista / Locações)'] ] },
      { id: 'dia1', lbl: '🔑 Dia 1 — chegada e acessos', itens: [
        ['tour', 'Tour pela sede + apresentação ao time + primeira matinal'],
        ['facial', 'Acesso facial + senha da fechadura digital'],
        ['house', 'Login House PSM criado (papel e equipe corretos)'],
        ['rd', 'Acesso ao CRM (RD) com funil da equipe'],
        ['kenlo', 'Acesso ao Kenlo (estoque, autorização de visita)'],
        ['drive', 'Acesso ao Drive PSM (tabelas, fichas, propostas)'],
        ['wpp', 'WhatsApp corporativo + entrada nos grupos oficiais'],
        ['mentor', 'Mentor designado + contato trocado'],
        ['foto', 'Foto profissional p/ site e organograma agendada'] ] },
      { id: 'sem1', lbl: '🎓 Semana 1 — imersão', itens: [
        ['sistemas', 'Tour guiado dos sistemas (House, CRM, Kenlo, Drive)'],
        ['cultura', 'Sessão de cultura: valores, anti-padrões e rituais'],
        ['marca_det', 'Imersão na marca foco: produto, ticket, ciclo, scripts, tabelas'],
        ['shadow', 'Shadowing: acompanhar mentor em visita/plantão/atendimento real'],
        ['leitura', 'Leitura crítica (Manual + Código + Contrato) com dúvidas anotadas'],
        ['oo1', 'Primeira 1:1 com o mentor realizada'] ] },
      { id: 'd30', lbl: '🚀 Dias 8–30 — rotina ativa', itens: [
        ['rituais', 'Nos rituais: matinal diária + play + roleta (opt-in 09h)'],
        ['crm', 'CRM impecável: registro em ≤24h, próximo passo com dia e hora'],
        ['lead1', 'Primeiro lead atendido'],
        ['plantao', 'Primeiro plantão realizado'],
        ['academy', 'Trilha obrigatória de formação concluída (Comunidade PSM)'],
        ['meta', 'Meta de rampa 30/60/90 definida e registrada (Norte do Mês)'] ] },
      { id: 'd60', lbl: '📈 Dias 31–60 — funil vivo', itens: [
        ['funil', 'Funil ativo com KPIs acompanhados na Gestão Comercial'],
        ['venda_and', 'Primeira venda em andamento (proposta/pasta na esteira)'],
        ['captacao', 'Primeira captação registrada (autorização documentada)'],
        ['carteira', 'Início de carteira própria'] ] },
      { id: 'd90', lbl: '🏁 Dias 61–90 — consolidação', itens: [
        ['performance', 'Performance consolidada vs meta de rampa'],
        ['avaliacao', 'Avaliação formal com mentor e sócio realizada'],
        ['trilha', 'Trilha de carreira definida (Estágio → Corretor PJ → Sênior → Head → Sócio)'],
        ['plano6m', 'Plano dos próximos 6 meses registrado'],
        ['nps_onb', 'Feedback do novato sobre o onboarding colhido'] ] },
    ],
  },
  offboarding: {
    titulo: '👋 Offboarding — desligamento', cor: '#ef4444', dataLbl: 'Data de saída',
    sub: '"Quando alguém sai, sai inteiro": aviso 30d · bloqueio de acessos em 48h · devolução em 5 dias úteis · carteira sem perder cliente.',
    campos: ['cargo', 'equipe', 'motivo', 'data', 'responsavel', 'carteira_destino'],
    etapas: [
      { id: 'com', lbl: '📢 Comunicação (dia 0)', itens: [
        ['motivo', 'Motivo registrado (pediu / desligado / fim de contrato)'],
        ['data', 'Data de saída definida'],
        ['aviso', 'Aviso prévio de 30 dias formalizado por escrito (execução plena no período)'],
        ['lider', 'Líder e time comunicados'],
        ['transicao', 'Plano de transição do período de aviso definido'] ] },
      { id: 'acessos', lbl: '🔒 Acessos — bloqueio em até 48h', itens: [
        ['house', 'Status no House: ⏸ pausado (licença) ou 🔒 inativo (saída)'],
        ['rd', 'Remover do CRM (RD)'], ['kenlo', 'Remover do Kenlo'],
        ['wpp', 'Sair dos grupos de WhatsApp oficiais'],
        ['email', 'Encerrar e-mail corporativo'],
        ['facial', 'Revogar acesso facial + senha da fechadura'],
        ['site', 'Remover do site e do organograma'] ] },
      { id: 'devolucao', lbl: '📦 Devolução — até 5 dias úteis', itens: [
        ['materiais', 'Materiais, equipamentos e cartões devolvidos'],
        ['docs', 'Fichas e documentos de clientes restituídos'],
        ['mailing', 'Mailings/bases destruídos ou restituídos (LGPD — multa contratual)'] ] },
      { id: 'fin', lbl: '💰 Financeiro', itens: [
        ['comissoes', 'Acerto de comissões pendentes + pipeline em andamento (quem recebe o quê)'],
        ['repasses', 'Repasses em aberto liquidados'],
        ['rescisao', 'Rescisão / quitação + notas fiscais finais'] ] },
      { id: 'carteira', lbl: '🤝 Carteira e negócios (crítico — não perder cliente)', itens: [
        ['leads', 'Leads/clientes ativos reatribuídos no CRM'],
        ['negocios', 'Negócios em andamento repassados à PSM ou corretor indicado'],
        ['captacoes', 'Captações em andamento transferidas'],
        ['herdeiro', 'Herdeiro da carteira definido'],
        ['clientes', 'Clientes da carteira comunicados pelo canal oficial'] ] },
      { id: 'marca', lbl: '📱 Marca e redes', itens: [
        ['redes', 'Referências à PSM removidas das redes em 48h'],
        ['perfis', 'Perfis institucionais transferidos via termo'],
        ['criativos', 'Criativos e materiais com a marca recolhidos'] ] },
      { id: 'pos', lbl: '🧠 Conhecimento e pós-saída', itens: [
        ['exit', 'Entrevista de saída realizada'],
        ['doc', 'Aprendizados e feedback documentados'],
        ['confid', 'Confidencialidade/LGPD reforçadas por escrito'],
        ['naoconc', 'Não-concorrência (6m) e não-aliciamento (12m) comunicados formalmente'] ] },
    ],
  },
};
const CARGOS = ['Corretor Conquista', 'Corretor MAP', 'Corretor Locação', 'Corretor Terceiros', 'SDR', 'Líder', 'Backoffice', 'Marketing', 'Financeiro', 'Outro'];
const EQUIPES = ['Conquista', 'MAP', 'Locação', 'Terceiros', '—'];
const MOTIVOS = ['Pediu demissão', 'Desligado', 'Fim de contrato', 'Outro'];

const tplItems = tipo => RH_TPL[tipo].etapas.flatMap(e => e.itens.map(([k]) => e.id + '.' + k));
function rhProgress(tipo, proc) {
  const all = tplItems(tipo);
  const done = all.filter(k => proc.checklist && proc.checklist[k]).length;
  return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
}

async function loadRH(tipo) {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/rh_processos');
    _rh = { onboarding: r.onboarding || [], offboarding: r.offboarding || [] };
    if (tipo === 'offboarding') { try { const cc = await api.request('/api/v3/gp/cargos'); _cargosOff = (cc && cc.offboarding) || {}; } catch { /* noop */ } }
    renderRH(tipo);
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderRH(tipo) {
  const T = RH_TPL[tipo];
  const list = _rh[tipo] || [];
  const ativos = list.filter(p => (p.status || 'em_andamento') !== 'concluido');
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:18px;font-weight:800;color:${T.cor}">${T.titulo}</div>
        <div class="tiny muted">${T.sub}</div>
      </div>
      <div class="flex gap-2">
        ${tipo === 'offboarding' && (auth.user()?.lvl || 0) >= 5 ? '<button class="btn btn-ghost" id="off-cargo">📋 Por cargo</button>' : ''}
        <button class="btn btn-primary" id="rh-new">+ Novo processo</button>
      </div>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Em andamento</div><div style="font-size:20px;font-weight:800;color:${T.cor}">${ativos.length}</div></div>
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Concluídos</div><div style="font-size:20px;font-weight:800">${list.length - ativos.length}</div></div>
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Total</div><div style="font-size:20px;font-weight:800">${list.length}</div></div>
    </div>
    ${!list.length
      ? `<div class="card muted tiny" style="text-align:center;padding:34px">Nenhum processo de ${tipo === 'onboarding' ? 'admissão' : 'desligamento'} ainda. Clique em <b>+ Novo processo</b>.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">${list.map(p => rhCard(tipo, p)).join('')}</div>`}`;
  document.getElementById('rh-new').onclick = () => openRHEditor(tipo, null);
  const oc = document.getElementById('off-cargo'); if (oc) oc.onclick = openOffCargoModal;
  body.querySelectorAll('[data-rh-open]').forEach(b => b.onclick = () => openRHEditor(tipo, list.find(p => p.id === b.dataset.rhOpen)));
}

function rhCard(tipo, p) {
  const T = RH_TPL[tipo];
  const pr = rhProgress(tipo, p);
  const done = (p.status || 'em_andamento') === 'concluido';
  const barcor = done ? '#16a34a' : (pr.pct >= 67 ? '#16a34a' : pr.pct >= 34 ? '#f59e0b' : '#ef4444');
  return `
    <div class="card" style="padding:14px;cursor:pointer;border-left:4px solid ${T.cor}" data-rh-open="${esc(p.id)}">
      <div class="flex items-center" style="justify-content:space-between;gap:8px">
        <div style="font-weight:800;font-size:14px">${esc(p.nome || 'Sem nome')}</div>
        <span class="tiny" style="font-weight:800;color:${done ? '#16a34a' : T.cor}">${done ? '✓ Concluído' : pr.pct + '%'}</span>
      </div>
      <div class="tiny muted" style="margin:3px 0 8px">${esc(p.cargo || '—')}${p.equipe && p.equipe !== '—' ? ' · ' + esc(p.equipe) : ''}${p.data ? ' · ' + esc(p.data.split('-').reverse().join('/')) : ''}</div>
      <div style="height:7px;background:var(--bg-3,#e2e8f0);border-radius:99px;overflow:hidden"><div style="height:100%;width:${pr.pct}%;background:${barcor};transition:width .2s"></div></div>
      <div class="tiny muted" style="margin-top:5px">${pr.done}/${pr.total} itens${p.responsavel ? ' · 👤 ' + esc(p.responsavel) : ''}</div>
      ${tipo === 'offboarding' && p.carteira_destino ? `<div class="tiny" style="margin-top:5px;color:var(--ciano);font-weight:700">🤝 carteira → ${esc(p.carteira_destino)}</div>` : ''}
    </div>`;
}

function openRHEditor(tipo, p0) {
  const T = RH_TPL[tipo];
  const p = p0 ? JSON.parse(JSON.stringify(p0)) : { checklist: {}, status: 'em_andamento' };
  if (!p.checklist) p.checklist = {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  const campo = (k) => {
    if (k === 'cargo') return `<div><label class="tiny muted">Cargo</label><select id="rh-cargo" class="select"><option value="">—</option>${CARGOS.map(c => `<option${p.cargo === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'equipe') return `<div><label class="tiny muted">Equipe</label><select id="rh-equipe" class="select">${EQUIPES.map(c => `<option${(p.equipe || '—') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'motivo') return `<div><label class="tiny muted">Motivo</label><select id="rh-motivo" class="select"><option value="">—</option>${MOTIVOS.map(c => `<option${p.motivo === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'data') return `<div><label class="tiny muted">${T.dataLbl}</label><input id="rh-data" class="input" type="date" value="${esc((p.data || '').substring(0, 10))}"></div>`;
    if (k === 'responsavel') return `<div><label class="tiny muted">Responsável (padrinho/líder)</label><input id="rh-responsavel" class="input" value="${esc(p.responsavel || '')}" placeholder="Quem acompanha"></div>`;
    if (k === 'carteira_destino') return `<div><label class="tiny muted">🤝 Carteira vai pra</label><input id="rh-carteira_destino" class="input" value="${esc(p.carteira_destino || '')}" placeholder="Quem herda os leads/clientes"></div>`;
    return '';
  };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:620px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:4px;color:${T.cor}">${p.id ? 'Editar' : 'Novo'} — ${T.titulo}</div>
      <label class="tiny muted">Nome do colaborador *</label>
      <input id="rh-nome" class="input" value="${esc(p.nome || '')}" placeholder="Nome completo" style="margin-bottom:10px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:12px">
        ${T.campos.map(campo).join('')}
        <div><label class="tiny muted">Status</label><select id="rh-status" class="select"><option value="em_andamento"${(p.status || 'em_andamento') === 'em_andamento' ? ' selected' : ''}>Em andamento</option><option value="concluido"${p.status === 'concluido' ? ' selected' : ''}>Concluído</option></select></div>
      </div>
      <div style="font-weight:800;font-size:13px;margin-bottom:8px">✅ Checklist</div>
      <div id="rh-checklist">${T.etapas.map(e => `
        <div style="margin-bottom:12px">
          <div style="font-weight:700;font-size:12px;color:${T.cor};margin-bottom:5px">${e.lbl}</div>
          ${e.itens.map(([k, lbl]) => { const key = e.id + '.' + k; return `
            <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;cursor:pointer;font-size:13px" onmouseover="this.style.background='var(--bg-3,#f1f5f9)'" onmouseout="this.style.background=''">
              <input type="checkbox" data-ck="${key}"${p.checklist[key] ? ' checked' : ''} style="width:16px;height:16px;cursor:pointer">
              <span>${esc(lbl)}</span>
            </label>`; }).join('')}
        </div>`).join('')}
      </div>
      ${tipo === 'offboarding' ? offCargoRefHTML(p.cargo) + `
      <label class="tiny muted">🗣 Entrevista de desligamento</label>
      <textarea id="rh-entrevista" class="input" rows="3" placeholder="Motivos reais da saída, clima/relacionamento, o que faríamos diferente, sugestões do colaborador…" style="margin-bottom:8px">${esc(p.entrevista || '')}</textarea>` : ''}
      <label class="tiny muted">Observações</label>
      <textarea id="rh-obs" class="input" rows="2" placeholder="Anotações do processo">${esc(p.obs || '')}</textarea>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="rh-del" ${p.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="rh-cancel">Cancelar</button><button class="btn btn-primary" id="rh-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#rh-cancel').onclick = () => ov.remove();
  ov.querySelector('#rh-save').onclick = async () => {
    const g = id => (ov.querySelector('#rh-' + id)?.value || '').trim();
    const checklist = {};
    ov.querySelectorAll('[data-ck]').forEach(c => { if (c.checked) checklist[c.dataset.ck] = true; });
    const proc = { id: p.id, nome: g('nome'), status: g('status') || 'em_andamento', obs: g('obs'), checklist };
    if (tipo === 'offboarding') proc.entrevista = g('entrevista');
    T.campos.forEach(k => { proc[k] = g(k); });
    if (!proc.nome) { ov.querySelector('#rh-nome').focus(); return; }
    ov.querySelector('#rh-save').disabled = true;
    try { await api.request('/api/v3/gp/rh_processos', { method: 'POST', body: { action: 'upsert', tipo, proc } }); ov.remove(); await loadRH(tipo); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#rh-save').disabled = false; }
  };
  ov.querySelector('#rh-del').onclick = async () => {
    if (!p.id || !confirm('Excluir este processo?')) return;
    try { await api.request('/api/v3/gp/rh_processos', { method: 'POST', body: { action: 'delete', tipo, id: p.id } }); ov.remove(); await loadRH(tipo); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#rh-nome')?.focus(), 50);
}

/* ════════════════════════════════════════════════════════════════════════
   MÓDULOS GENÉRICOS DE RH (Plano de Crescimento · Clima Interno · Avaliações)
   Lista de fichas via shared_kv (gp/rh_registros). O template (campos) mora
   aqui no front — adicionar campo/módulo é só editar isto. Líder+ (lvl 5). v81.52
═══════════════════════════════════════════════════════════════════════════ */
const REG_TPL = {
  plano: {
    titulo: '📈 Plano de Crescimento', cor: '#0ea5e9', titleField: 'pessoa',
    sub: 'Trilha de cargos e PDI: onde cada um está e o próximo passo.',
    campos: [
      { k: 'pessoa', lbl: 'Colaborador', type: 'text', req: true },
      { k: 'cargo_atual', lbl: 'Cargo atual', type: 'select', opts: CARGOS },
      { k: 'proximo_cargo', lbl: 'Próximo cargo (meta)', type: 'select', opts: CARGOS },
      { k: 'competencias', lbl: 'Competências a desenvolver', type: 'textarea' },
      { k: 'prazo', lbl: 'Prazo', type: 'date' },
      { k: 'status', lbl: 'Status', type: 'select', opts: ['Em andamento', 'No prazo', 'Atrasado', 'Concluído'] },
      { k: 'obs', lbl: 'Observações', type: 'textarea' },
    ],
    chips: r => [r.cargo_atual, r.proximo_cargo ? '→ ' + r.proximo_cargo : '', r.status].filter(Boolean),
  },
  clima: {
    titulo: '🌡 Clima Interno', cor: '#16a34a', titleField: 'periodo',
    sub: 'Pesquisas de clima / pulso — participação, eNPS e ações.',
    campos: [
      { k: 'periodo', lbl: 'Período (ex.: Jun/2026)', type: 'text', req: true },
      { k: 'participacao', lbl: 'Participação (%)', type: 'number' },
      { k: 'enps', lbl: 'eNPS (-100 a 100)', type: 'number' },
      { k: 'destaques', lbl: 'Destaques (o que está bom)', type: 'textarea' },
      { k: 'pontos_atencao', lbl: 'Pontos de atenção', type: 'textarea' },
      { k: 'acoes', lbl: 'Ações definidas', type: 'textarea' },
    ],
    chips: r => [r.participacao ? r.participacao + '% part.' : '', (r.enps !== undefined && r.enps !== '') ? 'eNPS ' + r.enps : ''].filter(Boolean),
  },
  avaliacoes: {
    titulo: '⭐ Avaliações & Feedbacks', cor: '#f59e0b', titleField: 'pessoa',
    sub: 'Avaliações de desempenho e feedbacks estruturados por colaborador.',
    campos: [
      { k: 'pessoa', lbl: 'Colaborador', type: 'text', req: true },
      { k: 'periodo', lbl: 'Período / ciclo', type: 'text' },
      { k: 'nota', lbl: 'Nota (0–10)', type: 'number' },
      { k: 'pontos_fortes', lbl: 'Pontos fortes', type: 'textarea' },
      { k: 'a_desenvolver', lbl: 'A desenvolver', type: 'textarea' },
      { k: 'feedback', lbl: 'Feedback', type: 'textarea' },
      { k: 'proximos_passos', lbl: 'Próximos passos', type: 'textarea' },
    ],
    chips: r => [r.periodo, (r.nota !== undefined && r.nota !== '') ? 'nota ' + r.nota : ''].filter(Boolean),
  },
};

let _regs = { plano: [], clima: [], avaliacoes: [] };

async function loadReg(modulo) {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/rh_registros');
    const reg = (r && r.registros) || {};
    _regs = { plano: reg.plano || [], clima: reg.clima || [], avaliacoes: reg.avaliacoes || [] };
    renderReg(modulo);
  } catch (e) { body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

function renderReg(modulo) {
  const T = REG_TPL[modulo], list = _regs[modulo] || [];
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div><div style="font-size:17px;font-weight:800;color:${T.cor}">${T.titulo}</div><div class="tiny muted">${T.sub}</div></div>
      <button class="btn btn-primary" id="reg-new">+ Nova ficha</button>
    </div>
    ${!list.length ? `<div class="card muted tiny" style="text-align:center;padding:30px">Nenhuma ficha ainda. Clique em <b>+ Nova ficha</b>.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${list.map(r => regCard(modulo, r)).join('')}</div>`}`;
  document.getElementById('reg-new').onclick = () => openRegEditor(modulo, null);
  body.querySelectorAll('[data-reg]').forEach(b => b.onclick = () => openRegEditor(modulo, list.find(r => r.id === b.dataset.reg)));
}

function regCard(modulo, r) {
  const T = REG_TPL[modulo];
  const title = r[T.titleField] || '—';
  const chips = (T.chips(r) || []).map(c => `<span style="background:${T.cor}1f;color:${T.cor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px">${esc(c)}</span>`).join(' ');
  const pf = T.campos.find(c => c.type === 'textarea' && r[c.k]);
  const prev = pf ? esc(String(r[pf.k]).slice(0, 90)) : '';
  return `<div class="card" style="padding:13px;cursor:pointer;border-left:4px solid ${T.cor}" data-reg="${esc(r.id)}">
    <div style="font-weight:800;font-size:14px">${esc(title)}</div>
    <div class="flex gap-1" style="flex-wrap:wrap;margin:6px 0">${chips}</div>
    ${prev ? `<div class="tiny muted">${prev}${String(r[pf.k]).length > 90 ? '…' : ''}</div>` : ''}
  </div>`;
}

function openRegEditor(modulo, r0) {
  const T = REG_TPL[modulo], r = r0 ? { ...r0 } : {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  const field = c => {
    const v = r[c.k] != null ? r[c.k] : '';
    if (c.type === 'textarea') return `<div><label class="tiny muted">${c.lbl}</label><textarea id="rg-${c.k}" class="input" rows="2">${esc(v)}</textarea></div>`;
    if (c.type === 'select') return `<div><label class="tiny muted">${c.lbl}</label><select id="rg-${c.k}" class="select"><option value="">—</option>${c.opts.map(o => `<option${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    const t = c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text';
    return `<div><label class="tiny muted">${c.lbl}</label><input id="rg-${c.k}" class="input" type="${t}" value="${esc(c.type === 'date' ? String(v).slice(0, 10) : v)}"></div>`;
  };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:520px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px;color:${T.cor}">${r.id ? 'Editar' : 'Nova'} — ${T.titulo}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${T.campos.map(field).join('')}</div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="rg-del" ${r.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="rg-cancel">Cancelar</button><button class="btn btn-primary" id="rg-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#rg-cancel').onclick = () => ov.remove();
  ov.querySelector('#rg-save').onclick = async () => {
    const rec = { id: r.id };
    T.campos.forEach(c => { const el = ov.querySelector('#rg-' + c.k); if (el) rec[c.k] = (el.value || '').trim(); });
    const reqF = T.campos.find(c => c.req);
    if (reqF && !rec[reqF.k]) { ov.querySelector('#rg-' + reqF.k).focus(); return; }
    ov.querySelector('#rg-save').disabled = true;
    try { await api.request('/api/v3/gp/rh_registros', { method: 'POST', body: { action: 'upsert', modulo, registro: rec } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); ov.querySelector('#rg-save').disabled = false; }
  };
  ov.querySelector('#rg-del').onclick = async () => {
    if (!r.id || !confirm('Excluir esta ficha?')) return;
    try { await api.request('/api/v3/gp/rh_registros', { method: 'POST', body: { action: 'delete', modulo, id: r.id } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => { const f = ov.querySelector('.input'); if (f) f.focus(); }, 50);
}

/* ─────────────── Offboarding por cargo (requisitos/métricas/checklist) v81.92 ─────────────── */
function offCargoRefHTML(cargo) {
  const c = _cargosOff[cargo];
  if (!c || !(c.requisitos || c.metricas || (c.checklist && c.checklist.length))) return '';
  return `<div style="background:#ef44440e;border:1px solid #ef444433;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:12px">
    <div style="font-weight:800;color:var(--err-suave);margin-bottom:3px">📋 Padrão do cargo «${esc(cargo)}»</div>
    ${c.requisitos ? `<div><b>Requisitos p/ desligar:</b> ${esc(c.requisitos)}</div>` : ''}
    ${c.metricas ? `<div><b>Métricas:</b> ${esc(c.metricas)}</div>` : ''}
    ${(c.checklist && c.checklist.length) ? `<div><b>Checkout:</b><ul style="margin:3px 0 0 16px">${c.checklist.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

function openOffCargoModal() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow:auto';
  const cargos = [...new Set([...CARGOS, ...Object.keys(_cargosOff)])];
  let sel = cargos[0] || 'Corretor Conquista';
  const draw = () => {
    const c = _cargosOff[sel] || {};
    ov.innerHTML = `
      <div class="card" style="max-width:580px;width:100%;margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title" style="margin:0">📋 Offboarding por cargo</h3>
          <button class="btn btn-ghost btn-sm" id="oc-x">✕</button>
        </div>
        <p class="tiny muted" style="margin:4px 0 8px">Requisitos, métricas e checklist de checkout padrão de cada cargo no desligamento — aparecem no processo daquele cargo.</p>
        <label class="tiny muted">Cargo<input id="oc-cargo" class="input" list="oc-list" value="${esc(sel)}"><datalist id="oc-list">${cargos.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="tiny muted" style="display:block;margin-top:8px">Requisitos para desligamento<textarea id="oc-req" class="input" rows="2" placeholder="Aviso prévio, devolução de equipamentos, repasse de carteira…">${esc(c.requisitos || '')}</textarea></label>
        <label class="tiny muted" style="display:block;margin-top:6px">Métricas para desligamento<textarea id="oc-met" class="input" rows="2" placeholder="Indicadores que disparam/justificam o desligamento (metas, produtividade…)">${esc(c.metricas || '')}</textarea></label>
        <label class="tiny muted" style="display:block;margin-top:6px">Checklist de checkout (1 por linha)<textarea id="oc-chk" class="input" rows="4" placeholder="Bloquear acessos&#10;Recolher crachá/chip&#10;Repassar clientes&#10;Termo de rescisão assinado">${esc((c.checklist || []).join('\n'))}</textarea></label>
        <div class="flex gap-2 mt-3" style="align-items:center"><button class="btn btn-primary" id="oc-save">💾 Salvar cargo</button><span class="tiny muted" id="oc-msg"></span><button class="btn btn-ghost" id="oc-close" style="margin-left:auto">Fechar</button></div>
        ${Object.keys(_cargosOff).length ? `<div class="tiny muted" style="margin-top:8px">Configurados: ${Object.keys(_cargosOff).map(esc).join(' · ')}</div>` : ''}
      </div>`;
    ov.querySelector('#oc-x').onclick = ov.querySelector('#oc-close').onclick = () => ov.remove();
    ov.querySelector('#oc-cargo').addEventListener('change', e => { sel = e.target.value.trim() || sel; draw(); });
    ov.querySelector('#oc-save').onclick = async () => {
      const cargo = ov.querySelector('#oc-cargo').value.trim(); if (!cargo) return alert('Informe o cargo.');
      const checklist = ov.querySelector('#oc-chk').value.split('\n').map(s => s.trim()).filter(Boolean);
      try {
        const r = await api.request('/api/v3/gp/cargos', { method: 'POST', body: { action: 'set_offboarding', cargo, requisitos: ov.querySelector('#oc-req').value, metricas: ov.querySelector('#oc-met').value, checklist } });
        _cargosOff = r.offboarding || _cargosOff; sel = cargo; ov.querySelector('#oc-msg').textContent = '✅ salvo';
      } catch (e) { alert('Erro: ' + e.message); }
    };
  };
  document.body.appendChild(ov); ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); }); draw();
}
