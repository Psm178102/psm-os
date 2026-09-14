/* ============================================================================
   PSM-OS v2 — 📅 Agenda & Tarefas (v87.81)
   ----------------------------------------------------------------------------
   UMA tela no lugar de três: a Home ('/', que já se chamava "Agenda" no menu e
   tinha um card de tarefas + a agenda embutida + um 2º calendário "Plano do mês")
   e a Central de Tarefas ('/tarefas'). Eram 3 formulários de criar, 2 calendários
   e 2 listas do MESMO feed. Agora:
     • topo: saudação, números do dia clicáveis e ✍️ adicionar rápido em português
       ("Visita com Ana amanhã 15h") — data/hora/prioridade/@pessoa saem do texto;
     • 5 visões do mesmo dado: Dia (linha do tempo + horários livres), Semana, Mês,
       Lista (por urgência) e Quadro — com arrastar pra reagendar;
     • painel de detalhes com concluir/reagendar/editar/WhatsApp/comentários e
       "desfazer" em toda ação rápida;
     • 👥 visão da equipe pra gestão (lvl≥7), filtros por tipo e busca;
     • lateral: minicalendário, 🔔 alertas e conexões (push, lembretes, Zoho,
       assinatura Google/iPhone/Outlook) e 🚪 salas de reunião;
     • 📊 indicadores do mês (o que era o resto da Home) recolhível no fim.
   Fonte única dos dados: GET /api/v3/tasks/feed (inclui `pode` por item, com as
   mesmas regras dos endpoints que executam cada ação).
============================================================================ */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';
import { router } from '../router.js';
import { mountComments } from '../comments.js';
import { ativarDrag } from '../kanban-drag.js';
import { interpretar, rotuloData, datas } from '../agenda-rapida.js';
import { esc, CORES, injetarCss, toast, abrirModal, fecharModal, abrirPop, fecharPop } from '../agenda-ui.js';
import { montarConexoes, montarSalas, sincronizarZohoSeVelho, carregarPrefs, prefsAtuais, LEMBRETE_OPCOES, rotuloLembrete } from '../agenda-conexoes.js';
import { montarIndicadores, injectMeuAcompanhamento } from './dashboard.js';

const { iso, deIso, somaDias } = datas;
const hoje = () => iso(new Date());

const TIPO_EVT = {
  reuniao: { lbl: 'Reunião', ico: '💼' }, visita: { lbl: 'Visita', ico: '🏠' }, plantao: { lbl: 'Plantão', ico: '🛡' },
  evento: { lbl: 'Evento', ico: '🎉' }, outro: { lbl: 'Compromisso', ico: '📅' }, tarefa: { lbl: 'Tarefa', ico: '✅' },
};
const KIND = {
  tarefa: { lbl: 'Tarefa', ico: '📋' }, treino: { lbl: 'Treinamento', ico: '🎓' }, academy: { lbl: 'Academy', ico: '🎬' },
  projeto: { lbl: 'Projeto', ico: '📌' }, captacao: { lbl: 'Captação', ico: '📥' }, criativo: { lbl: 'Criativo', ico: '🎨' },
  conteudo: { lbl: 'Conteúdo', ico: '🎬' }, oneonone: { lbl: 'One-on-One', ico: '👥' }, plantao: { lbl: 'Plantão', ico: '🛡' },
};
const PRIORIDADES = [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta'], ['critica', 'Crítica']];
const STATUS_TAREFA = [['aberta', 'A fazer'], ['em_andamento', 'Em andamento'], ['concluida', 'Concluída'], ['cancelada', 'Cancelada']];
const STATUS_EVT = [['agendado', 'Agendado'], ['confirmado', 'Confirmado'], ['realizado', 'Realizado'], ['cancelado', 'Cancelado']];
const ATRASAVEL = { tarefa: 1, criativo: 1, conteudo: 1 };   // compromisso que passou não "atrasa": já aconteceu
const VIEWS = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['lista', 'Lista'], ['quadro', 'Quadro']];
const FILTROS = [
  ['tudo', 'Tudo', '#94a3b8', () => true],
  ['tarefas', 'Tarefas', CORES.tarefa, i => i.kind === 'tarefa'],
  ['compromissos', 'Compromissos', CORES.reuniao, i => i.kind === 'evento' && i.tipo !== 'plantao'],
  ['visitas', 'Visitas', CORES.visita, i => i.kind === 'evento' && i.tipo === 'visita'],
  ['plantoes', 'Plantões', CORES.plantao, i => i.kind === 'plantao' || (i.kind === 'evento' && i.tipo === 'plantao')],
  ['treinos', 'Treinamentos', CORES.treino, i => i.kind === 'treino'],
  ['outros', 'Outros módulos', CORES.captacao, i => ['captacao', 'criativo', 'conteudo', 'academy', 'projeto', 'oneonone'].includes(i.kind)],
];

const P = 'psm.v2.agenda.';
const lerPref = (k, d) => { try { return localStorage.getItem(P + k) ?? d; } catch { return d; } };
const gravarPref = (k, v) => { try { localStorage.setItem(P + k, v); } catch { /* aba anônima */ } };
const celular = () => window.matchMedia && window.matchMedia('(max-width: 760px)').matches;

const S = {
  root: null, mont: 0,
  itens: [], convites: [], prod: {}, janela: null, podeTime: false, carregando: false,
  users: null, forms: null,
  view: lerPref('view', 'dia'), cursor: hoje(), filtro: 'tudo', busca: '', feitos: false,
  escopo: 'self', pessoa: '', quickTipo: null, aberto: null,
};
if (!VIEWS.some(([v]) => v === S.view)) S.view = 'dia';

/* ═══════════════════════════ entrada ═══════════════════════════ */
export async function pageAgendaTarefas(ctx, root) {
  injetarCss();
  S.root = root;
  const mont = ++S.mont;
  S.cursor = S.cursor || hoje();
  root.innerHTML = casca();
  ligarEventos(root, mont);
  pintarVisaoCarregando();
  await Promise.all([
    carregar(),
    S.users ? null : api.request('/api/v3/users/list').then(r => { S.users = r.users || []; }).catch(() => { S.users = []; }),
    S.forms ? null : api.request('/api/v3/settings/conclusao_forms').then(r => { S.forms = r.forms || {}; }).catch(() => { S.forms = {}; }),
    carregarPrefs(),
  ]);
  if (mont !== S.mont) return;
  renderTudo();
  setTimeout(() => injectMeuAcompanhamento(root), 0);
  const con = root.querySelector('#at-conexoes');
  montarConexoes(con, { aoMudarAgenda: () => carregar({ quiet: true }).then(renderTudo) });
  montarSalasSeAberto();
  sincronizarZohoSeVelho().then(mudou => { if (mudou && mont === S.mont) carregar({ quiet: true }).then(renderTudo); });
  abrirIndicadoresSeAberto();
  tratarLinkProfundo(ctx && ctx.query);
}

function casca() {
  const me = auth.user() || {};
  const h = new Date().getHours();
  const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const dataLonga = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, c => c.toUpperCase());
  return `<div class="at-wrap">
    <section class="at-card at-top" aria-label="Resumo e adicionar rápido">
      <div class="at-top-l">
        <div><h2 class="at-hello">${saud}, ${esc((me.name || '').split(' ')[0])}</h2><div class="at-date">${esc(dataLonga)}</div></div>
        <div class="at-kpis" id="at-kpis"></div>
      </div>
      <form class="at-quick" id="at-quick" autocomplete="off">
        <div class="at-seg" role="radiogroup" aria-label="Tipo do item">
          <button type="button" data-qt="tarefa" role="radio">✅ Tarefa</button>
          <button type="button" data-qt="compromisso" role="radio">📅 Compromisso</button>
        </div>
        <div class="at-quick-in"><span class="at-plus">＋</span>
          <input id="at-quick-txt" maxlength="200" placeholder='Adicionar rápido — ex.: "Visita com Ana amanhã 15h" ou "Ligar pro João sexta"' aria-label="Adicionar rápido"></div>
        <button type="submit" class="btn btn-primary">Adicionar</button>
        <button type="button" class="btn btn-ghost" data-act="novo">Mais opções</button>
      </form>
      <div class="at-preview" id="at-preview" aria-live="polite"></div>
    </section>
    <section class="at-card at-conv" id="at-conv" hidden></section>
    <div class="at-grid">
      <section class="at-card at-main" aria-label="Agenda">
        <div class="at-bar" id="at-bar"></div>
        <div class="at-chips" id="at-chips"></div>
        <div class="at-view" id="at-view"></div>
      </section>
      <aside class="at-side">
        <div class="at-card" id="at-mini"></div>
        <div class="at-card" id="at-conexoes"></div>
        <div class="at-card" id="at-salas-box">
          <button type="button" class="at-ind-h" style="padding:0" data-act="salas"><span style="margin:0;font-family:var(--font-display);font-size:13px;color:var(--ink)">🚪 Salas de reunião</span><span id="at-salas-seta">${lerPref('salas', '0') === '1' ? 'ocultar' : 'ver'}</span></button>
          <div id="at-salas"></div>
        </div>
      </aside>
    </div>
    <section class="at-card" id="at-ind">
      <button type="button" class="at-ind-h" data-act="ind">📊 Meus indicadores do mês <span id="at-ind-seta"></span></button>
      <div class="at-ind-b" id="at-ind-b" hidden></div>
    </section>
  </div>`;
}

/* ═══════════════════════════ dados ═══════════════════════════ */
function janelaNecessaria() {
  const [a, b] = intervaloDaVisao();
  const h = hoje();
  if (S.escopo === 'time') {
    return { since: a < somaDias(h, -7) ? a : somaDias(h, -7), until: b > somaDias(h, 30) ? b : somaDias(h, 30) };
  }
  return { since: a < somaDias(h, -30) ? a : somaDias(h, -30), until: b > somaDias(h, 180) ? b : somaDias(h, 180) };
}

function intervaloDaVisao(view = S.view, cursor = S.cursor) {
  if (view === 'semana') { const s = inicioSemana(cursor); return [s, somaDias(s, 6)]; }
  if (view === 'mes') { const g = gradeMes(cursor); return [g[0], g[g.length - 1]]; }
  return [cursor, cursor];
}

function precisaRecarregar() {
  const j = janelaNecessaria(), J = S.janela;
  return !J || J.escopo !== S.escopo || J.pessoa !== S.pessoa || j.since < J.since || j.until > J.until;
}

async function carregar({ quiet } = {}) {
  const j = janelaNecessaria();
  const qs = new URLSearchParams({ since: j.since, until: j.until });
  if (S.escopo === 'time') { qs.set('escopo', 'time'); if (S.pessoa) qs.set('pessoa', S.pessoa); }
  S.carregando = true;
  if (quiet) marcarCarregando(true);
  try {
    const f = await api.request('/api/v3/tasks/feed?' + qs.toString());
    S.itens = (f.items || []).map(normalizar);
    S.convites = (f.convites || []).map(normalizar);
    S.prod = f.prod || {};
    S.podeTime = !!f.pode_ver_time;
    if (f.escopo !== S.escopo) S.escopo = f.escopo || 'self';
    S.janela = { since: f.since || j.since, until: f.until || j.until, escopo: S.escopo, pessoa: S.pessoa };
    S.erro = null;
  } catch (e) {
    S.erro = e.message || String(e);
  } finally {
    S.carregando = false;
    marcarCarregando(false);
  }
}

function normalizar(i) {
  const key = `${i.kind}:${i.id}`;
  const pode = i.pode || {};
  return { ...i, key, pode, hora_inicio: i.hora_inicio ? String(i.hora_inicio).slice(0, 5) : null, hora_fim: i.hora_fim ? String(i.hora_fim).slice(0, 5) : null };
}

const achar = key => S.itens.find(i => i.key === key) || S.convites.find(i => i.key === key);

/* ═══════════════════════════ helpers de item ═══════════════════════════ */
const corDe = i => i.kind === 'evento' ? (CORES[i.tipo] || CORES.evento) : (CORES[i.kind] || CORES.outro);
const icoDe = i => i.kind === 'evento' ? (TIPO_EVT[i.tipo] || TIPO_EVT.outro).ico : (KIND[i.kind] || {}).ico || '•';
const rotuloDe = i => i.kind === 'evento' ? (i.fonte === 'zoho' ? 'Zoho' : (TIPO_EVT[i.tipo] || TIPO_EVT.outro).lbl) : (KIND[i.kind] || {}).lbl || i.origem || '';
const horario = i => (!i.hora_inicio || (i.kind === 'evento' && i.all_day)) ? '' : i.hora_inicio + (i.hora_fim && i.hora_fim > i.hora_inicio ? '–' + i.hora_fim : '');
const atrasado = i => !i.done && ATRASAVEL[i.kind] && i.data && i.data < hoje();
const concluivel = i => !!(i.pode && i.pode.concluir) && i.kind !== 'evento' && i.kind !== 'treino' && i.kind !== 'oneonone';
const ehMeu = i => { const me = auth.user() || {}; return i.quem_id === me.id; };

function filtrados() {
  const f = (FILTROS.find(x => x[0] === S.filtro) || FILTROS[0])[3];
  const q = S.busca.trim().toLowerCase();
  return S.itens.filter(i => f(i) && (!q || `${i.titulo} ${i.sub || ''} ${i.local || ''} ${i.quem || ''} ${i.categoria || ''}`.toLowerCase().includes(q)));
}
const doDia = (lista, d) => lista.filter(i => i.data === d);
function ordenar(lista) {
  return lista.slice().sort((a, b) => {
    const ha = a.hora_inicio && !(a.kind === 'evento' && a.all_day) ? a.hora_inicio : '';
    const hb = b.hora_inicio && !(b.kind === 'evento' && b.all_day) ? b.hora_inicio : '';
    if (ha !== hb) return ha === '' ? -1 : hb === '' ? 1 : ha.localeCompare(hb);
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const pr = { critica: 0, alta: 1, media: 2, baixa: 3 };
    return (pr[a.prioridade] ?? 2) - (pr[b.prioridade] ?? 2) || String(a.titulo).localeCompare(String(b.titulo));
  });
}
function inicioSemana(d) { const x = deIso(d); return somaDias(d, -x.getDay()); }
function gradeMes(d) {
  const x = deIso(d); const primeiro = iso(new Date(x.getFullYear(), x.getMonth(), 1, 12));
  const ini = inicioSemana(primeiro);
  return Array.from({ length: 42 }, (_, k) => somaDias(ini, k));
}
const fmtBR = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function contagens(lista = S.itens) {
  const h = hoje(), s7 = somaDias(h, 7);
  const pend = lista.filter(i => !i.done);
  return {
    atrasados: pend.filter(atrasado).length,
    hoje: pend.filter(i => i.data === h).length,
    semana: pend.filter(i => i.data && i.data > h && i.data <= s7).length,
    convites: S.convites.length,
  };
}

/* ═══════════════════════════ render ═══════════════════════════ */
function renderTudo() {
  if (!S.root || !S.root.isConnected) return;
  renderKpis(); renderConvites(); renderBarra(); renderChips(); renderVisao(); renderMini(); renderPreview();
  if (S.aberto) { const i = achar(S.aberto); if (i) desenharDrawer(i); else fecharDrawer(); }
}

function renderKpis() {
  const el = S.root.querySelector('#at-kpis'); if (!el) return;
  const c = contagens();
  const k = (n, lbl, cls, go, titulo) => `<button type="button" class="at-kpi ${n ? cls : ''}" data-go="${go}" title="${esc(titulo)}"><b>${n}</b>${lbl}</button>`;
  el.innerHTML = (S.escopo === 'time' ? '<span class="at-pill" style="align-self:center">👥 Visão da equipe</span>' : '')
    + k(c.atrasados, c.atrasados === 1 ? 'atrasada' : 'atrasadas', 'err', 'atrasados', 'Tarefas com prazo vencido')
    + k(c.hoje, 'hoje', 'ok', 'hoje', 'Pendências de hoje')
    + k(c.semana, 'próx. 7 dias', 'warn', 'semana', 'Pendências dos próximos 7 dias')
    + (S.escopo === 'self' && c.convites ? k(c.convites, c.convites === 1 ? 'convite' : 'convites', 'info', 'convites', 'Convites esperando sua resposta') : '');
}

function renderConvites() {
  const el = S.root.querySelector('#at-conv'); if (!el) return;
  if (S.escopo === 'time' || !S.convites.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><b>📨 ${S.convites.length === 1 ? 'Um convite espera' : S.convites.length + ' convites esperam'} sua resposta</b>
      <span class="at-muted" style="font-size:12px">Só entram na sua agenda (e no seu Zoho) se você aceitar.</span></div>
    ${S.convites.map(c => `<div class="at-conv-row" style="--c:${corDe(c)}">
      <span class="at-ico">${icoDe(c)}</span>
      <div style="flex:1;min-width:180px"><b style="font-size:13px">${esc(c.titulo)}</b>
        <div class="at-m">${esc(rotuloData(c.data, hoje()))}${horario(c) ? ' · ' + esc(horario(c)) : ' · dia todo'}${c.local ? ' · 📍 ' + esc(c.local) : ''} · de ${esc(c.de || '—')}</div></div>
      <button class="btn btn-primary btn-sm" data-conv="aceitar" data-key="${esc(c.key)}">Aceitar</button>
      <button class="btn btn-ghost btn-sm" data-conv="recusar" data-key="${esc(c.key)}">Recusar</button>
    </div>`).join('')}`;
}

function periodoLabel() {
  const d = deIso(S.cursor);
  if (S.view === 'dia') return `${SEM[d.getDay()]}, ${d.getDate()} de ${MES[d.getMonth()]}${S.cursor === hoje() ? ' · hoje' : ''}`;
  if (S.view === 'semana') {
    const a = deIso(inicioSemana(S.cursor)), b = deIso(somaDias(inicioSemana(S.cursor), 6));
    return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} de ${MES[b.getMonth()]}` : `${a.getDate()} ${MES_C[a.getMonth()]} – ${b.getDate()} ${MES_C[b.getMonth()]}`;
  }
  if (S.view === 'mes') return `${MES[d.getMonth()].replace(/^./, c => c.toUpperCase())} ${d.getFullYear()}`;
  return S.view === 'lista' ? 'Por urgência' : 'Quadro por prazo';
}

function renderBarra() {
  const el = S.root.querySelector('#at-bar'); if (!el) return;
  const navegavel = ['dia', 'semana', 'mes'].includes(S.view);
  const pessoas = S.escopo === 'time' ? selectableUsers(S.users || [], S.pessoa) : [];
  const buscaAtual = el.querySelector('#at-busca');
  const tinhaFoco = buscaAtual && document.activeElement === buscaAtual;
  el.innerHTML = `
    <div class="at-seg" role="tablist" aria-label="Visão">${VIEWS.map(([v, l]) => `<button type="button" role="tab" aria-selected="${S.view === v}" class="${S.view === v ? 'on' : ''}" data-view="${v}">${l}</button>`).join('')}</div>
    ${navegavel ? `<div class="at-nav"><button type="button" class="at-ib" data-nav="-1" aria-label="Anterior" title="Anterior (←)">‹</button>
      <button type="button" class="at-tb" data-nav="0" title="Voltar pra hoje (T)">Hoje</button>
      <button type="button" class="at-ib" data-nav="1" aria-label="Próximo" title="Próximo (→)">›</button></div>` : ''}
    <span class="at-period">${esc(periodoLabel())}</span>
    <span class="at-sp"></span>
    ${S.podeTime ? `<div class="at-seg" aria-label="De quem"><button type="button" class="${S.escopo === 'self' ? 'on' : ''}" data-escopo="self">👤 Minha</button><button type="button" class="${S.escopo === 'time' ? 'on' : ''}" data-escopo="time">👥 Equipe</button></div>` : ''}
    ${S.escopo === 'time' ? `<select class="at-sel" id="at-pessoa" aria-label="Pessoa"><option value="">Todas as pessoas</option>${pessoas.map(u => `<option value="${esc(u.id)}"${S.pessoa === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
    <label class="at-search"><span>🔎</span><input id="at-busca" type="search" placeholder="Buscar" value="${esc(S.busca)}" aria-label="Buscar na agenda"></label>`;
  if (tinhaFoco) { const b = el.querySelector('#at-busca'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
}

function renderChips() {
  const el = S.root.querySelector('#at-chips'); if (!el) return;
  const pend = S.itens.filter(i => !i.done);
  el.innerHTML = FILTROS.map(([id, lbl, cor, fn]) => {
    const n = id === 'tudo' ? pend.length : pend.filter(fn).length;
    if (!n && !['tudo', 'tarefas', 'compromissos'].includes(id) && S.filtro !== id) return '';
    return `<button type="button" class="at-fchip ${S.filtro === id ? 'on' : ''}" data-filtro="${id}" style="--c:${cor}">${id === 'tudo' ? '' : '<i></i>'}${lbl}${n ? ` <em>${n}</em>` : ''}</button>`;
  }).join('') + `<label class="at-check-lbl"><input type="checkbox" id="at-feitos" ${S.feitos ? 'checked' : ''}> Mostrar concluídos</label>`;
}

function pintarVisaoCarregando() {
  const v = S.root.querySelector('#at-view');
  if (v) v.innerHTML = '<div class="at-empty" style="border-style:solid"><span class="spinner"></span> Carregando sua agenda…</div>';
}
function marcarCarregando(on) {
  const v = S.root && S.root.querySelector('#at-view'); if (!v) return;
  let el = v.querySelector('.at-loading');
  if (on && !el) { el = document.createElement('div'); el.className = 'at-loading'; el.innerHTML = '<span class="spinner"></span> atualizando'; v.prepend(el); }
  if (!on && el) el.remove();
}

function renderVisao() {
  const v = S.root.querySelector('#at-view'); if (!v) return;
  if (S.erro && !S.itens.length) {
    v.innerHTML = `<div class="alert alert-err">Não consegui carregar a agenda: ${esc(S.erro)} <button class="btn btn-ghost btn-sm" data-act="recarregar">Tentar de novo</button></div>`;
    return;
  }
  const lista = filtrados();
  v.innerHTML = ({ dia: visaoDia, semana: visaoSemana, mes: visaoMes, lista: visaoLista, quadro: visaoQuadro }[S.view] || visaoDia)(lista);
}

/* ── linha de item (Dia, Lista, Quadro) ─────────────────────────────────── */
function linha(i, { data, arrastavel } = {}) {
  const late = atrasado(i);
  const meta = [];
  if (data) meta.push(`<span class="${late ? 'late' : ''}">${esc(rotuloData(i.data, hoje()))}${late ? ' · atrasada' : ''}</span>`);
  if (!data && late) meta.push('<span class="late">atrasada</span>');
  const hr = horario(i); if (hr && data) meta.push(esc(hr));
  if (i.local) meta.push('📍 ' + esc(i.local));
  if (i.kind === 'captacao' && i.desde) meta.push('desde ' + esc(rotuloData(i.desde, hoje())));
  if (i.quem && (S.escopo === 'time' || !ehMeu(i))) meta.push('👤 ' + esc(i.quem));
  if (i.kind !== 'evento' && i.kind !== 'tarefa' && i.sub) meta.push(esc(String(i.sub).slice(0, 60)));
  if (i.kind === 'tarefa' && i.categoria) meta.push(esc(i.categoria));
  meta.push(`<span class="at-tag"><i></i>${esc(rotuloDe(i))}</span>`);
  const ck = concluivel(i)
    ? `<button type="button" class="at-ck ${i.done ? 'on' : ''}" data-ck="${esc(i.key)}" aria-label="${i.done ? 'Reabrir' : 'Concluir'}" title="${i.done ? 'Reabrir' : 'Concluir'}">✓</button>`
    : `<span class="at-ico" aria-hidden="true">${icoDe(i)}</span>`;
  const prio = i.kind === 'tarefa' && (i.prioridade === 'alta' || i.prioridade === 'critica') ? `<span class="at-prio ${i.prioridade}">${i.prioridade === 'critica' ? 'Crítica' : 'Alta'}</span>` : '';
  const acoes = !i.done && i.pode && i.pode.reagendar ? `<button type="button" class="at-mini-b" data-rea="${esc(i.key)}" title="Reagendar">📆</button>` : '';
  return `<div class="at-item ${i.done ? 'done' : ''} ${late ? 'late' : ''} ${arrastavel && i.pode.reagendar && !i.done ? 'at-dg' : ''}" style="--c:${corDe(i)}" data-open="${esc(i.key)}" data-id="${esc(i.key)}" role="button" tabindex="0">
    ${ck}
    <div style="min-width:0"><div class="at-t">${esc(i.titulo)}${prio}</div><div class="at-m">${meta.join('<span aria-hidden="true">·</span>')}</div></div>
    <div class="at-acts">${acoes}<button type="button" class="at-mini-b" data-mais="${esc(i.key)}" aria-label="Mais ações">⋯</button></div>
  </div>`;
}

const vazio = (emoji, txt, extra = '') => `<div class="at-empty"><b>${emoji}</b>${txt}${extra}</div>`;

/* ── DIA ─────────────────────────────────────────────────────────────── */
function visaoDia(lista) {
  const d = S.cursor, h = hoje(), ehHoje = d === h;
  const doDiaTodos = doDia(lista, d);
  const feitosN = doDiaTodos.filter(i => i.done).length;
  const doD = ordenar(doDiaTodos.filter(i => S.feitos || !i.done));
  const semHora = doD.filter(i => !horario(i));
  const comHora = doD.filter(i => horario(i));
  let html = '';

  if (ehHoje) {
    const atr = ordenar(lista.filter(atrasado)).sort((a, b) => a.data.localeCompare(b.data));
    if (atr.length) {
      const mostrar = lerPref('atr_todos', '0') === '1' ? atr : atr.slice(0, 5);
      html += `<div class="at-sec" style="--sc:var(--err)"><b>⏰ Atrasadas</b> <em>${atr.length}</em>
        ${atr.length > 5 ? `<button class="at-mini-b at-sec-a" data-act="atr-todos">${mostrar.length < atr.length ? 'ver todas' : 'mostrar menos'}</button>` : ''}</div>
        <div class="at-list">${mostrar.map(i => linha(i, { data: true })).join('')}</div>`;
    }
  }
  if (!doD.length && !(ehHoje && html)) {
    html += vazio(d < h ? '🗂' : '🌤', d < h ? 'Nada registrado neste dia.' : 'Dia livre por enquanto.',
      d >= h ? `<div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-novo-data="${d}">+ Adicionar neste dia</button></div>` : '');
  }
  if (semHora.length) {
    html += `<div class="at-sec"><b>${ehHoje ? 'Pra hoje' : 'No dia'}</b> <em>${semHora.length}</em><span class="at-muted" style="text-transform:none;letter-spacing:0;font-weight:600">sem horário marcado</span></div>
      <div class="at-list">${semHora.map(i => linha(i)).join('')}</div>`;
  }
  if (comHora.length || (doD.length && d >= h)) {
    html += `<div class="at-sec"><b>Horários</b> <em>${comHora.length}</em></div><div class="at-list">`;
    const agora = new Date(); const agoraHM = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    let nowPosto = !ehHoje;
    let cursorLivre = d >= h ? (ehHoje ? maxHM('08:00', arredonda(agoraHM)) : '08:00') : null;
    let livres = 0;
    for (const i of comHora) {
      if (cursorLivre && livres < 4 && diffMin(cursorLivre, i.hora_inicio) >= 60 && i.hora_inicio <= '19:00') {
        html += livre(d, cursorLivre, i.hora_inicio); livres++;
      }
      if (!nowPosto && i.hora_inicio > agoraHM) { html += linhaAgora(agoraHM); nowPosto = true; }
      html += `<div class="at-slot"><div class="at-hr">${esc(i.hora_inicio)}${i.hora_fim ? `<small>${esc(i.hora_fim)}</small>` : ''}</div>${linha(i)}</div>`;
      const fim = i.hora_fim && i.hora_fim > i.hora_inicio ? i.hora_fim : somaMin(i.hora_inicio, 60);
      if (cursorLivre) cursorLivre = maxHM(cursorLivre, fim);
    }
    if (!nowPosto) html += linhaAgora(agoraHM);
    if (cursorLivre && livres < 4 && diffMin(cursorLivre, '19:00') >= 60) html += livre(d, cursorLivre, '19:00');
    html += '</div>';
  }
  if (feitosN && !S.feitos) html += `<div style="margin-top:12px"><button class="at-mini-b" data-act="ver-feitos">✓ ${feitosN} concluído(s) neste dia — mostrar</button></div>`;
  return html;
}
const livre = (d, a, b) => `<div class="at-free"><div></div><button type="button" data-livre="${d}|${a}|${b}">Livre das ${a} às ${b} · <b>+ marcar</b></button></div>`;
const linhaAgora = hm => `<div class="at-now" aria-label="Agora"><span>${hm}</span><i></i></div>`;
const minDe = hm => { const [a, b] = String(hm).split(':').map(Number); return a * 60 + (b || 0); };
const hmDe = m => `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, '0')}:${String(Math.min(m, 1439) % 60).padStart(2, '0')}`;
const diffMin = (a, b) => minDe(b) - minDe(a);
const somaMin = (hm, n) => hmDe(minDe(hm) + n);
const maxHM = (a, b) => (a > b ? a : b);
const arredonda = hm => hmDe(Math.ceil(minDe(hm) / 30) * 30);

/* ── SEMANA ──────────────────────────────────────────────────────────── */
function visaoSemana(lista) {
  const ini = inicioSemana(S.cursor), h = hoje();
  const dias = Array.from({ length: 7 }, (_, k) => somaDias(ini, k));
  if (celular()) {
    return dias.map(d => {
      const its = ordenar(doDia(lista, d).filter(i => S.feitos || !i.done));
      return `<div class="at-sec" style="${d === h ? '--sc:var(--info)' : ''}"><b>${esc(rotuloData(d, h))}</b> <em>${its.length}</em>
        <button class="at-mini-b at-sec-a" data-novo-data="${d}" aria-label="Adicionar em ${esc(rotuloData(d, h))}">+</button></div>
        ${its.length ? `<div class="at-list">${its.map(i => linha(i)).join('')}</div>` : '<div class="at-muted" style="font-size:12px;padding:2px 4px 6px">—</div>'}`;
    }).join('');
  }
  return `<div class="at-week">${dias.map(d => {
    const x = deIso(d);
    const its = ordenar(doDia(lista, d).filter(i => S.feitos || !i.done));
    return `<div class="at-wcol ${d === h ? 'today' : ''} ${d < h ? 'past' : ''}" data-drop="${d}">
      <div class="at-whead" data-dia="${d}" title="Abrir o dia"><span>${SEM[x.getDay()]}</span><b>${x.getDate()}</b>
        <button type="button" class="at-add" data-novo-data="${d}" aria-label="Adicionar neste dia">+</button></div>
      <div class="at-wbody">${its.map(i => `<div class="at-mc ${i.done ? 'done' : ''} ${i.pode.reagendar && !i.done ? 'at-dg' : ''}" style="--c:${corDe(i)}" data-open="${esc(i.key)}" data-id="${esc(i.key)}" title="${esc(i.titulo)}">
          ${horario(i) ? `<small>${esc(i.hora_inicio)}</small>` : `<small>${icoDe(i)}</small>`}<b>${esc(i.titulo)}</b></div>`).join('')}</div>
    </div>`;
  }).join('')}</div>
  <div class="at-muted" style="font-size:11.5px;margin-top:8px">Arraste um item pra outro dia pra reagendar · clique no dia pra ver os horários.</div>`;
}

/* ── MÊS ─────────────────────────────────────────────────────────────── */
function visaoMes(lista) {
  const grade = gradeMes(S.cursor), h = hoje(), mesAtual = deIso(S.cursor).getMonth();
  return `<div class="at-mhead">${SEM.map(s => `<div>${s}</div>`).join('')}</div>
  <div class="at-month">${grade.map(d => {
    const x = deIso(d);
    const its = ordenar(doDia(lista, d).filter(i => S.feitos || !i.done));
    return `<div class="at-mcell ${x.getMonth() !== mesAtual ? 'out' : ''} ${d === h ? 'today' : ''}" data-drop="${d}" data-dia="${d}">
      <div class="at-mnum"><b>${x.getDate()}</b></div>
      ${its.slice(0, 3).map(i => `<div class="at-mchip ${i.done ? 'done' : ''} ${i.pode.reagendar && !i.done ? 'at-dg' : ''}" style="--c:${corDe(i)}" data-open="${esc(i.key)}" data-id="${esc(i.key)}" title="${esc((horario(i) ? horario(i) + ' · ' : '') + i.titulo)}">${horario(i) ? esc(i.hora_inicio) + ' ' : ''}${esc(i.titulo)}</div>`).join('')}
      ${its.length > 3 ? `<div class="at-more">+${its.length - 3} mais</div>` : ''}
      ${its.length ? `<div class="at-dots">${its.slice(0, 5).map(i => `<i style="--c:${corDe(i)}"></i>`).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

/* ── LISTA ───────────────────────────────────────────────────────────── */
function gruposPorPrazo(lista) {
  const h = hoje(), am = somaDias(h, 1), s7 = somaDias(h, 7);
  const G = [
    ['atrasados', '⏰ Atrasadas', 'var(--err)', i => atrasado(i)],
    ['hoje', '☀️ Hoje', 'var(--ok)', i => i.data === h],
    ['amanha', '🌤 Amanhã', 'var(--info)', i => i.data === am],
    ['semana', '📆 Próximos 7 dias', 'var(--warn)', i => i.data > am && i.data <= s7],
    ['depois', '🗓 Depois', 'var(--ink-muted)', i => i.data > s7],
    ['semdata', '— Sem data', 'var(--ink-muted)', i => !i.data],
  ];
  const out = G.map(g => ({ id: g[0], lbl: g[1], cor: g[2], itens: [] }));
  for (const i of lista) {
    if (!S.feitos && i.done) continue;
    if (i.data && i.data < h && !atrasado(i)) continue;   // compromisso que já passou não é pendência
    const k = G.findIndex(g => g[3](i));
    if (k >= 0) out[k].itens.push(i);
  }
  out.forEach(g => { g.itens = g.id === 'atrasados' ? g.itens.sort((a, b) => a.data.localeCompare(b.data)) : ordenar(g.itens).sort((a, b) => (a.data || '').localeCompare(b.data || '')); });
  return out;
}
function visaoLista(lista) {
  const grupos = gruposPorPrazo(lista).filter(g => g.itens.length);
  if (!grupos.length) return vazio('🎉', 'Nada pendente por aqui. Tudo em dia!');
  const lim = Number(lerPref('lista_lim', '40')) || 40;
  return grupos.map(g => `<div class="at-sec" id="at-g-${g.id}" style="--sc:${g.cor}"><b>${g.lbl}</b> <em>${g.itens.length}</em></div>
    <div class="at-list">${g.itens.slice(0, lim).map(i => linha(i, { data: g.id !== 'hoje' && g.id !== 'amanha' })).join('')}</div>
    ${g.itens.length > lim ? `<button class="at-mini-b" style="margin-top:6px" data-act="lista-mais">Ver mais ${g.itens.length - lim}</button>` : ''}`).join('');
}

/* ── QUADRO ──────────────────────────────────────────────────────────── */
function visaoQuadro(lista) {
  const grupos = gruposPorPrazo(lista);
  return `<div class="at-board">${grupos.map(g => `<div class="at-bcol" data-drop="col:${g.id}" style="--sc:${g.cor}">
      <div class="at-bcol-h">${g.lbl}<em>${g.itens.length}</em></div>
      <div class="at-list">${g.itens.length ? g.itens.map(i => linha(i, { data: !['hoje', 'amanha'].includes(g.id), arrastavel: true })).join('') : '<div class="at-muted" style="font-size:12px;text-align:center;padding:14px 0">—</div>'}</div>
    </div>`).join('')}</div>
    <div class="at-muted" style="font-size:11.5px;margin-top:6px">Arraste pra Hoje, Amanhã ou Sem data · nas outras colunas você escolhe o dia.</div>`;
}

/* ── minicalendário ──────────────────────────────────────────────────── */
function renderMini() {
  const el = S.root.querySelector('#at-mini'); if (!el) return;
  const base = S.miniMes || S.cursor;
  const grade = gradeMes(base), mes = deIso(base).getMonth(), h = hoje();
  const tem = {}, late = {};
  S.itens.forEach(i => { if (i.data && !i.done) { tem[i.data] = 1; if (atrasado(i)) late[i.data] = 1; } });
  const [a, b] = intervaloDaVisao();
  el.innerHTML = `<div class="at-mini-h"><button type="button" class="at-ib" data-mini="-1" aria-label="Mês anterior">‹</button>
      <b style="font-size:13px">${MES[mes].replace(/^./, c => c.toUpperCase())} ${deIso(base).getFullYear()}</b>
      <button type="button" class="at-ib" data-mini="1" aria-label="Próximo mês">›</button></div>
    <div class="at-mini-g">${SEM.map(s => `<span>${s[0]}</span>`).join('')}
      ${grade.map(d => `<button type="button" data-dia="${d}" class="${deIso(d).getMonth() !== mes ? 'out' : ''} ${d === h ? 'today' : ''} ${d >= a && d <= b && S.view !== 'lista' && S.view !== 'quadro' ? 'sel' : ''} ${tem[d] ? 'has' : ''} ${late[d] ? 'late' : ''}" aria-label="${esc(fmtBR(d))}">${deIso(d).getDate()}</button>`).join('')}
    </div>`;
}

/* ── preview do adicionar rápido ─────────────────────────────────────── */
function lerRapido() {
  const txt = (S.root.querySelector('#at-quick-txt') || {}).value || '';
  if (!txt.trim()) return null;
  const r = interpretar(txt, { hoje: hoje(), usuarios: selectableUsers(S.users || []) });
  r.tipoFinal = S.quickTipo || r.tipo;
  if (!r.data) {
    if (S.view === 'dia' && S.cursor >= hoje()) r.dataFinal = S.cursor;
    else r.dataFinal = r.tipoFinal === 'compromisso' ? hoje() : null;
    r.dataPadrao = true;
  } else r.dataFinal = r.data;
  return r;
}
function renderPreview() {
  const el = S.root.querySelector('#at-preview'); if (!el) return;
  const r = lerRapido();
  S.root.querySelectorAll('[data-qt]').forEach(b => {
    const on = (r ? r.tipoFinal : (S.quickTipo || 'tarefa')) === b.dataset.qt;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  });
  if (!r) { el.innerHTML = '<span class="at-pv dica">Dica: escreva a data e o horário no texto — "hoje", "sexta 10h", "dia 20", "14h-15h", "@nome", "!alta". Tecla N abre aqui.</span>'; return; }
  const chips = [];
  chips.push(`<span class="at-pv">${r.tipoFinal === 'compromisso' ? '📅 ' + ((TIPO_EVT[r.tipoEvento] || {}).lbl || 'Compromisso') : '✅ Tarefa'}</span>`);
  chips.push(`<span class="at-pv${r.dataPadrao ? ' dica' : ''}">🗓 ${esc(r.dataFinal ? rotuloData(r.dataFinal, hoje()) : 'Sem data')}</span>`);
  if (r.hora_inicio) chips.push(`<span class="at-pv">🕒 ${r.hora_inicio}${r.hora_fim ? '–' + r.hora_fim : ''}</span>`);
  else if (r.tipoFinal === 'compromisso') chips.push('<span class="at-pv dica">dia todo</span>');
  if (r.prioridade) chips.push(`<span class="at-pv">⚑ ${esc((PRIORIDADES.find(p => p[0] === r.prioridade) || [])[1] || r.prioridade)}</span>`);
  if (r.responsavel_nome) chips.push(`<span class="at-pv">👤 ${esc(r.responsavel_nome)}</span>`);
  chips.push(`<span class="at-pv dica">“${esc(r.titulo || '…')}” · Enter pra criar</span>`);
  el.innerHTML = chips.join('');
}

/* ═══════════════════════════ eventos ═══════════════════════════ */
function ligarEventos(root, mont) {
  const vivo = () => mont === S.mont && root.isConnected;

  root.addEventListener('click', async ev => {
    const t = ev.target.closest('button, [data-open], [data-dia], [data-go]');
    if (!t || !root.contains(t)) return;
    const ds = t.dataset;
    if (ds.view) return trocarVisao(ds.view);
    if (ds.nav) return navegar(Number(ds.nav));
    if (ds.escopo) { if (S.escopo !== ds.escopo) { S.escopo = ds.escopo; S.pessoa = ''; pintarVisaoCarregando(); await carregar(); if (vivo()) renderTudo(); } return; }
    if (ds.filtro) { S.filtro = ds.filtro; renderChips(); renderVisao(); return; }
    if (ds.qt) { S.quickTipo = ds.qt; renderPreview(); root.querySelector('#at-quick-txt').focus(); return; }
    if (ds.go) return irPara(ds.go);
    if (ds.mini) { const b = deIso(S.miniMes || S.cursor); S.miniMes = iso(new Date(b.getFullYear(), b.getMonth() + Number(ds.mini), 1, 12)); renderMini(); return; }
    if (ds.ck) { ev.stopPropagation(); const i = achar(ds.ck); if (i) (i.done ? reabrir(i) : concluir(i)); return; }
    if (ds.rea) { ev.stopPropagation(); const i = achar(ds.rea); if (i) menuReagendar(t, i); return; }
    if (ds.mais) { ev.stopPropagation(); const i = achar(ds.mais); if (i) menuMais(t, i); return; }
    if (ds.conv) { const i = achar(ds.key); if (i) responderConvite(i, ds.conv, t); return; }
    if (ds.novoData) { ev.stopPropagation(); abrirForm({ preset: { data: ds.novoData } }); return; }
    if (ds.livre) { const [d, a, b] = ds.livre.split('|'); abrirForm({ preset: { tipo: 'compromisso', data: d, hora_inicio: a, hora_fim: somaMin(a, 60) > b ? b : somaMin(a, 60) } }); return; }
    if (ds.act) return acaoGeral(ds.act, t);
    if (ds.open && !t.classList.contains('at-dg')) return abrirItem(ds.open);
    if (ds.dia && !ev.target.closest('[data-open]')) {
      S.cursor = ds.dia; S.miniMes = null;
      if (S.view !== 'dia') { S.view = 'dia'; gravarPref('view', 'dia'); }
      return atualizarVisao();
    }
  });

  root.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.matches('[data-open]')) { ev.preventDefault(); abrirItem(ev.target.dataset.open); }
  });
  root.addEventListener('change', async ev => {
    if (ev.target.id === 'at-feitos') { S.feitos = ev.target.checked; renderVisao(); }
    if (ev.target.id === 'at-pessoa') { S.pessoa = ev.target.value; pintarVisaoCarregando(); await carregar(); if (vivo()) renderTudo(); }
  });
  let tBusca = null;
  root.addEventListener('input', ev => {
    if (ev.target.id === 'at-busca') { clearTimeout(tBusca); tBusca = setTimeout(() => { S.busca = ev.target.value; renderVisao(); }, 150); }
    if (ev.target.id === 'at-quick-txt') { if (!ev.target.value) S.quickTipo = null; renderPreview(); }
  });
  root.querySelector('#at-quick').addEventListener('submit', ev => { ev.preventDefault(); criarRapido(); });
  // Enter no campo cria direto (não depende da submissão implícita do form, que alguns
  // teclados virtuais/atalhos globais engolem); Esc limpa.
  root.querySelector('#at-quick-txt').addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); criarRapido(); }
    else if (ev.key === 'Escape') { ev.target.value = ''; S.quickTipo = null; renderPreview(); ev.target.blur(); }
  });

  // arrastar pra reagendar (Semana, Mês e Quadro) — Pointer Events: mouse, trackpad e dedo
  ativarDrag({
    host: root.querySelector('#at-view'), card: '.at-dg', coluna: '[data-drop]',
    colDe: el => el.dataset.drop,
    aoClicar: key => abrirItem(key),
    aoSoltar: (key, destino) => soltar(key, destino),
  });

  // atalhos de teclado (fora de campo de texto, sem modal aberto)
  const tecla = ev => {
    if (!vivo()) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.getElementById('at-modal') || document.getElementById('at-pop')) return;
    if (ev.key === 'Escape' && S.aberto) { fecharDrawer(); return; }
    if (S.aberto) return;
    const k = ev.key.toLowerCase();
    const mapa = { d: 'dia', s: 'semana', m: 'mes', l: 'lista', q: 'quadro' };
    if (k === 'n') { ev.preventDefault(); const q = root.querySelector('#at-quick-txt'); q.focus(); q.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else if (k === 't') navegar(0);
    else if (mapa[k]) trocarVisao(mapa[k]);
    else if (ev.key === 'ArrowLeft' && ['dia', 'semana', 'mes'].includes(S.view)) navegar(-1);
    else if (ev.key === 'ArrowRight' && ['dia', 'semana', 'mes'].includes(S.view)) navegar(1);
  };
  document.addEventListener('keydown', tecla);
  // a linha do "agora" anda sozinha na visão Dia de hoje
  const relogio = setInterval(() => { if (vivo() && S.view === 'dia' && S.cursor === hoje() && !S.aberto) renderVisao(); }, 60000);
  router.onCleanup(() => { document.removeEventListener('keydown', tecla); clearInterval(relogio); fecharDrawer(); fecharPop(); });
}

function trocarVisao(v) {
  if (S.view === v) return;
  S.view = v; gravarPref('view', v);
  atualizarVisao();
}
async function atualizarVisao() {
  renderBarra(); renderMini();
  if (precisaRecarregar()) { pintarVisaoCarregando(); await carregar(); renderTudo(); }
  else renderVisao();
}
function navegar(passo) {
  if (passo === 0) S.cursor = hoje();
  else if (S.view === 'dia') S.cursor = somaDias(S.cursor, passo);
  else if (S.view === 'semana') S.cursor = somaDias(S.cursor, 7 * passo);
  else if (S.view === 'mes') { const d = deIso(S.cursor); S.cursor = iso(new Date(d.getFullYear(), d.getMonth() + passo, 1, 12)); }
  S.miniMes = null;
  atualizarVisao();
}
function irPara(go) {
  if (go === 'convites') { const c = S.root.querySelector('#at-conv'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  S.filtro = 'tudo';
  if (go === 'hoje') { S.view = 'dia'; S.cursor = hoje(); }
  if (go === 'semana') { S.view = 'lista'; }
  if (go === 'atrasados') { S.view = 'lista'; }
  gravarPref('view', S.view);
  renderChips();
  atualizarVisao().then(() => {
    const alvo = S.root.querySelector(go === 'atrasados' ? '#at-g-atrasados' : go === 'semana' ? '#at-g-semana' : '#at-view');
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function acaoGeral(act, btn) {
  if (act === 'novo') { const r = lerRapido(); return abrirForm({ preset: r ? presetDeRapido(r) : { data: S.view === 'dia' ? S.cursor : null } }); }
  if (act === 'recarregar') { pintarVisaoCarregando(); return carregar().then(renderTudo); }
  if (act === 'ver-feitos') { S.feitos = true; renderChips(); return renderVisao(); }
  if (act === 'atr-todos') { gravarPref('atr_todos', lerPref('atr_todos', '0') === '1' ? '0' : '1'); return renderVisao(); }
  if (act === 'lista-mais') { gravarPref('lista_lim', String((Number(lerPref('lista_lim', '40')) || 40) + 40)); return renderVisao(); }
  if (act === 'ind') {
    const b = S.root.querySelector('#at-ind-b'); const abrir = b.hidden;
    gravarPref('ind', abrir ? '1' : '0'); return abrirIndicadoresSeAberto();
  }
  if (act === 'salas') {
    gravarPref('salas', lerPref('salas', '0') === '1' ? '0' : '1'); return montarSalasSeAberto();
  }
}

function abrirIndicadoresSeAberto() {
  const b = S.root.querySelector('#at-ind-b'), seta = S.root.querySelector('#at-ind-seta'); if (!b) return;
  const me = auth.user() || {};
  const comercial = /^(corretor|lider|líder|gerente|socio|sócio|diretor)/.test(String(me.role || '').toLowerCase());
  const aberto = lerPref('ind', comercial ? '1' : '0') === '1';
  b.hidden = !aberto;
  seta.textContent = aberto ? 'ocultar' : 'mostrar';
  if (aberto && !b.dataset.montado) { b.dataset.montado = '1'; montarIndicadores(b, { prod: S.prod }); }
}
function montarSalasSeAberto() {
  const box = S.root.querySelector('#at-salas'), seta = S.root.querySelector('#at-salas-seta'); if (!box) return;
  const aberto = lerPref('salas', '0') === '1';
  seta.textContent = aberto ? 'ocultar' : 'ver';
  if (!aberto) { box.innerHTML = ''; return; }
  const dia = S.view === 'dia' ? S.cursor : hoje();
  box.style.marginTop = '8px';
  montarSalas(box, dia, fmtBR).then(() => { if (box.hidden) { box.hidden = false; box.innerHTML = '<div class="at-help">Salas indisponíveis (Zoho não configurado).</div>'; } });
}

function tratarLinkProfundo(q) {
  if (!q) return;
  const limpa = () => { try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch { /* noop */ } };
  if (q.item) {
    const i = achar(q.item);
    if (i) abrirItem(i.key);
    else toast('Esse item não está na sua agenda (ou já foi removido).');
    limpa();
  } else if (q.convites) { setTimeout(() => irPara('convites'), 50); limpa(); }
  else if (q.novo) { abrirForm({ preset: {} }); limpa(); }
}

/* ═══════════════════════════ ações ═══════════════════════════ */
async function recarregarERender() { await carregar({ quiet: true }); renderTudo(); }

async function executar(promessa, { ok, desfazer } = {}) {
  try {
    await promessa;
    await recarregarERender();
    if (ok) toast(ok, desfazer ? { acao: 'Desfazer', onAcao: async () => { try { await desfazer(); await recarregarERender(); toast('↩️ Desfeito'); } catch (e) { toast('❌ ' + e.message); } } } : {});
    return true;
  } catch (e) {
    toast('❌ ' + (e.message || e));
    await recarregarERender();
    return false;
  }
}

const upsertTarefa = body => api.request('/api/v3/tasks/upsert', { method: 'POST', body });
const upsertEvento = body => api.request('/api/v3/agenda/upsert', { method: 'POST', body });

function concluir(i) {
  if (!concluivel(i) && i.kind !== 'evento') return;
  const campos = (S.forms && S.forms[i.kind]) || [];
  if (campos.some(f => f.required) || (i.kind !== 'tarefa' && i.kind !== 'evento' && campos.length)) return formConclusao(i, campos);
  if (i.kind === 'tarefa' && i.pode.editar) {
    const antes = i.status;
    return executar(upsertTarefa({ id: i.id, status: 'concluida' }), { ok: '✅ Tarefa concluída', desfazer: () => upsertTarefa({ id: i.id, status: antes || 'aberta' }) });
  }
  if (i.kind === 'evento') {
    const antes = i.status;
    return executar(upsertEvento({ id: i.id, status: 'realizado' }), { ok: '✅ Marcado como realizado', desfazer: () => upsertEvento({ id: i.id, status: antes || 'agendado' }) });
  }
  if (!confirm(`Concluir "${i.titulo}"?`)) return;
  return executar(api.request('/api/v3/tasks/conclude', { method: 'POST', body: { kind: i.kind, id: i.id, fields: {} } }), { ok: '✅ Concluído' });
}
function reabrir(i) {
  if (i.kind === 'tarefa' && i.pode.editar) return executar(upsertTarefa({ id: i.id, status: 'aberta' }), { ok: '↩️ Tarefa reaberta' });
  if (i.kind === 'evento' && i.pode.editar) return executar(upsertEvento({ id: i.id, status: 'agendado' }), { ok: '↩️ Compromisso reaberto' });
  toast('Esse item é reaberto no módulo de origem.');
}

function formConclusao(i, defs) {
  const campo = f => {
    const id = 'cf-' + esc(f.key);
    const lbl = `${esc(f.label)}${f.required ? ' *' : ''}`;
    if (f.type === 'select') return `<label class="c6">${lbl}<select id="${id}"><option value="">—</option>${(f.options || []).map(o => `<option>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.type === 'textarea') return `<label class="c6">${lbl}<textarea id="${id}" rows="2"></textarea></label>`;
    return `<label class="c6">${lbl}<input id="${id}" type="${f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'}" ${f.type === 'url' ? 'placeholder="https://…"' : ''}></label>`;
  };
  const { el, fechar } = abrirModal({
    titulo: `✓ Concluir — ${i.titulo}`,
    corpo: `<p class="at-muted" style="margin:0 0 10px;font-size:12.5px">Preencha pra registrar a entrega:</p><div class="at-f">${defs.map(campo).join('')}<div class="c6 at-err" id="cf-err"></div></div>`,
    rodape: `<span class="at-sp"></span><button class="btn btn-ghost" data-x>Cancelar</button><button class="btn btn-primary" data-ok>✓ Concluir</button>`,
    largura: 460,
  });
  el.querySelector('[data-x]').onclick = fechar;
  el.querySelector('[data-ok]').onclick = async () => {
    const fields = {}; let falta = '';
    defs.forEach(f => { const v = (el.querySelector('#cf-' + CSS.escape(f.key)) || {}).value || ''; fields[f.key] = v.trim(); if (f.required && !v.trim() && !falta) falta = f.label; });
    if (falta) { el.querySelector('#cf-err').textContent = 'Preencha: ' + falta; return; }
    fechar();
    executar(api.request('/api/v3/tasks/conclude', { method: 'POST', body: { kind: i.kind, id: i.id, fields } }), { ok: '✅ Concluído' });
  };
  const primeiro = el.querySelector('input, select, textarea'); if (primeiro) primeiro.focus();
}

function reagendar(i, nova, { silencioso } = {}) {
  if (!i.pode.reagendar) { toast('Só quem criou (ou o sócio) muda a data deste item.'); return Promise.resolve(false); }
  const antes = i.data || '';
  if ((nova || '') === antes) return Promise.resolve(true);
  if (!nova && i.kind !== 'tarefa') { toast('Compromisso precisa de data.'); return Promise.resolve(false); }
  // otimista: move na tela na hora, o servidor confirma em seguida
  i.data = nova || null; renderVisao(); renderKpis(); renderMini();
  const chamar = d => i.kind === 'tarefa' ? upsertTarefa({ id: i.id, prazo: d || '' }) : upsertEvento({ id: i.id, data: d });
  return executar(chamar(nova), {
    ok: silencioso ? null : (nova ? `📆 Reagendado para ${rotuloData(nova, hoje()).toLowerCase()}` : '📆 Tarefa ficou sem data'),
    desfazer: () => chamar(antes),
  });
}

function soltar(key, destino) {
  const i = achar(key); if (!i || !destino) return;
  const h = hoje();
  if (/^\d{4}-\d{2}-\d{2}$/.test(destino)) return reagendar(i, destino);
  const col = destino.replace('col:', '');
  if (col === 'hoje') return reagendar(i, h);
  if (col === 'amanha') return reagendar(i, somaDias(h, 1));
  if (col === 'semdata') return reagendar(i, null);
  if (col === 'atrasados') { toast('Pra marcar como atrasada, é só deixar o prazo passar 🙂'); return; }
  const card = S.root.querySelector(`[data-drop="${CSS.escape(destino)}"]`) || S.root.querySelector('#at-view');
  menuReagendar(card, i, col === 'semana' ? [2, 7] : [8, 30]);
}

function menuReagendar(ancora, i, faixa) {
  if (!i.pode.reagendar) { toast('Só quem criou (ou o sócio) muda a data deste item.'); return; }
  const h = hoje();
  const proxSeg = somaDias(h, ((8 - deIso(h).getDay()) % 7) || 7);
  let itens;
  if (faixa) {
    itens = [];
    for (let k = faixa[0]; k <= Math.min(faixa[1], faixa[0] + 6); k++) { const d = somaDias(h, k); itens.push({ lbl: rotuloData(d, h), dica: fmtBR(d).slice(0, 5), on: () => reagendar(i, d) }); }
  } else {
    itens = [
      { lbl: '☀️ Hoje', dica: SEM[deIso(h).getDay()], on: () => reagendar(i, h) },
      { lbl: '🌤 Amanhã', dica: SEM[deIso(somaDias(h, 1)).getDay()], on: () => reagendar(i, somaDias(h, 1)) },
      { lbl: '📆 Próxima segunda', dica: fmtBR(proxSeg).slice(0, 5), on: () => reagendar(i, proxSeg) },
      { lbl: '⏭ Daqui a 1 semana', dica: fmtBR(somaDias(i.data && i.data > h ? i.data : h, 7)).slice(0, 5), on: () => reagendar(i, somaDias(i.data && i.data > h ? i.data : h, 7)) },
    ];
    if (i.kind === 'tarefa' && i.data) itens.push({ lbl: '— Sem data', on: () => reagendar(i, null) });
  }
  const pop = abrirPop(ancora, itens);
  const extra = document.createElement('div');
  extra.innerHTML = `<hr><label style="font-size:11px;font-weight:800;color:var(--ink-muted);padding:4px 6px;display:block">Escolher dia<input type="date" value="${esc(i.data || h)}"></label>`;
  pop.appendChild(extra);
  extra.querySelector('input').addEventListener('change', e => { if (e.target.value) { fecharPop(); reagendar(i, e.target.value); } });
}

function menuMais(ancora, i) {
  const itens = [{ lbl: '👁 Abrir detalhes', on: () => abrirItem(i.key) }];
  if (i.pode.editar) itens.push({ lbl: '✏️ Editar', on: () => abrirForm({ item: i }) });
  if (!i.done && i.pode.reagendar) itens.push({ lbl: '📆 Reagendar…', on: () => menuReagendar(ancora, i) });
  if (i.kind === 'evento' && i.pode.concluir && !i.done) itens.push({ lbl: '✅ Marcar como realizado', on: () => concluir(i) });
  if (i.kind === 'evento') itens.push({ lbl: '💬 Enviar no WhatsApp', on: () => whatsapp(i) });
  if (!['tarefa', 'evento'].includes(i.kind) && i.link) itens.push({ lbl: `↗ Abrir em ${rotuloDe(i)}`, on: () => { location.hash = i.link; } });
  if (i.pode.excluir) itens.push('-', { lbl: '🗑 Excluir', on: () => excluir(i) });
  abrirPop(ancora, itens);
}

async function excluir(i) {
  if (!confirm(`Excluir "${i.titulo}"? Não dá pra desfazer.`)) return;
  fecharDrawer();
  const url = i.kind === 'tarefa' ? '/api/v3/tasks/delete' : '/api/v3/agenda/delete';
  executar(api.request(url, { method: 'POST', body: { id: i.id } }), { ok: '🗑 Excluído' });
}

function whatsapp(i) {
  const d = deIso(i.data || hoje());
  const quando = `${SEM[d.getDay()].toLowerCase()}, ${fmtBR(i.data).slice(0, 5)}${horario(i) ? ' às ' + i.hora_inicio : ''}`;
  const msg = `Olá! Confirmando: *${i.titulo}* — ${quando}${i.local ? ` · 📍 ${i.local}` : ''}. Qualquer imprevisto me avise por aqui. 😉`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}

async function responderConvite(i, acao, btn) {
  btn.disabled = true;
  try {
    await api.request('/api/v3/agenda/convite', { method: 'POST', body: { id: i.id, acao } });
    toast(acao === 'aceitar' ? '✅ Convite aceito — já está na sua agenda' : 'Convite recusado');
    await recarregarERender();
  } catch (e) { btn.disabled = false; toast('❌ ' + e.message); }
}

function presetDeRapido(r) {
  return {
    tipo: r.tipoFinal, tipoEvento: r.tipoEvento || 'reuniao', titulo: r.titulo, data: r.dataFinal,
    hora_inicio: r.hora_inicio, hora_fim: r.hora_fim, prioridade: r.prioridade, responsavel: r.responsavel_id,
  };
}

async function criarRapido() {
  const inp = S.root.querySelector('#at-quick-txt');
  const r = lerRapido();
  if (!r || !r.titulo) { inp.focus(); toast('Escreva o que precisa ser feito 🙂'); return; }
  const me = auth.user() || {};
  const btn = S.root.querySelector('#at-quick [type=submit]');
  btn.disabled = true;
  try {
    let res, key;
    if (r.tipoFinal === 'compromisso') {
      res = await upsertEvento({
        tipo: r.tipoEvento || 'reuniao', titulo: r.titulo, data: r.dataFinal || hoje(),
        hora_inicio: r.hora_inicio, hora_fim: r.hora_fim || (r.hora_inicio ? somaMin(r.hora_inicio, 60) : null),
        all_day: !r.hora_inicio, corretor_id: r.responsavel_id || me.id, status: 'agendado',
      });
      key = res && res.evento ? 'evento:' + res.evento.id : null;
    } else {
      res = await upsertTarefa({
        titulo: r.titulo, prazo: r.dataFinal, hora_inicio: r.hora_inicio, hora_fim: r.hora_fim,
        prioridade: r.prioridade || 'media', responsavel: r.responsavel_id || me.id, status: 'aberta',
      });
      key = res && res.task ? 'tarefa:' + res.task.id : null;
    }
    inp.value = ''; S.quickTipo = null; renderPreview();
    await recarregarERender();
    const quando = r.dataFinal ? rotuloData(r.dataFinal, hoje()).toLowerCase() : 'sem data';
    toast(`${r.tipoFinal === 'compromisso' ? '📅 Compromisso marcado' : '✅ Tarefa criada'} · ${quando}${r.hora_inicio ? ' ' + r.hora_inicio : ''}`,
      key ? { acao: 'Abrir', onAcao: () => abrirItem(key) } : {});
  } catch (e) {
    toast('❌ ' + (e.message || e));
  } finally { btn.disabled = false; inp.focus(); }
}

/* ═══════════════════════════ painel de detalhes ═══════════════════════════ */
function abrirItem(key) {
  const i = achar(key); if (!i) return;
  S.aberto = key;
  desenharDrawer(i);
}
function fecharDrawer() {
  S.aberto = null;
  document.getElementById('at-dr')?.remove();
  document.getElementById('at-dr-bg')?.remove();
}

function desenharDrawer(i) {
  let bg = document.getElementById('at-dr-bg'), dr = document.getElementById('at-dr');
  const novo = !dr;
  if (novo) {
    bg = document.createElement('div'); bg.className = 'at-dr-bg'; bg.id = 'at-dr-bg'; bg.onclick = fecharDrawer;
    dr = document.createElement('aside'); dr.className = 'at-dr'; dr.id = 'at-dr'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true');
    document.body.append(bg, dr);
  }
  const h = hoje();
  const nome = id => ((S.users || []).find(u => u.id === id) || {}).name || id || '—';
  const late = atrasado(i);
  const statusLbl = i.kind === 'tarefa' ? (STATUS_TAREFA.find(s => s[0] === i.status) || [0, i.status])[1]
    : i.kind === 'evento' ? (STATUS_EVT.find(s => s[0] === i.status) || [0, i.status])[1] : (i.status || '');
  const quando = i.data ? `${rotuloData(i.data, h)}${i.data !== h && Math.abs(deIso(i.data) - deIso(h)) < 8 * 864e5 ? ' · ' + fmtBR(i.data).slice(0, 5) : ''}` : 'Sem data';
  const linhas = [];
  linhas.push(['🗓', `${esc(quando)}${horario(i) ? ` · <b>${esc(horario(i))}</b>` : (i.kind === 'evento' ? ' · dia todo' : '')}${late ? ' <span class="at-pill" style="color:var(--err)">atrasada</span>' : ''}`]);
  if (i.local) linhas.push(['📍', `${esc(i.local)} <small><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(i.local)}" target="_blank" rel="noopener">abrir no mapa ↗</a></small>`]);
  if (i.kind === 'tarefa') {
    linhas.push(['👤', `${esc(nome(i.responsavel) || '—')}<small>responsável${i.criado_por && i.criado_por !== i.responsavel ? ' · criada por ' + esc(nome(i.criado_por)) : ''}</small>`]);
    linhas.push(['⚑', `${esc((PRIORIDADES.find(p => p[0] === i.prioridade) || [0, 'Média'])[1])}${i.categoria ? ` · ${esc(i.categoria)}` : ''}<small>prioridade${i.categoria ? ' · categoria' : ''}</small>`]);
  } else if (i.kind === 'evento') {
    linhas.push(['👤', `${esc(i.quem || '—')}<small>responsável${i.criado_por && i.criado_por !== i.corretor_id ? ' · marcado por ' + esc(nome(i.criado_por)) : ''}</small>`]);
    const parts = (i.participantes || []).filter(p => p !== i.corretor_id && p !== i.criado_por);
    if (parts.length) linhas.push(['👥', parts.map(p => { const m = (i.aceites || {})[p]; return `${esc(nome(p))} <small style="display:inline">${m === 'pendente' ? '· aguardando' : m === 'recusado' ? '· recusou' : '· confirmado'}</small>`; }).join('<br>')]);
    if (i.fonte === 'zoho') linhas.push(['📮', 'Veio do seu Zoho Calendar<small>edite por lá — a mudança chega aqui na próxima sincronização</small>']);
    else if (i.no_zoho) linhas.push(['📮', 'Sincronizado com o Zoho']);
  } else if (i.quem) linhas.push(['👤', esc(i.quem)]);
  if (i.kind === 'captacao' && i.desde) linhas.push(['⏱', `Última movimentação ${esc(rotuloData(i.desde, h).toLowerCase())}`]);
  if (['tarefa', 'evento'].includes(i.kind) && horario(i)) {
    const pr = prefsAtuais() && prefsAtuais().prefs;
    const padrao = pr ? (i.kind === 'tarefa' ? pr.lembrete_tarefa_min : pr.lembrete_evento_min) : null;
    const m = i.lembrete_min != null ? i.lembrete_min : padrao;
    if (m != null) linhas.push(['🔔', `${esc(rotuloLembrete(m))}${i.lembrete_min == null ? '<small>seu padrão</small>' : ''}`]);
  }
  if (statusLbl) linhas.push(['🏷', `${esc(statusLbl)}<small>${esc(rotuloDe(i))}</small>`]);

  const btns = [];
  if (concluivel(i)) btns.push(i.done ? `<button class="btn btn-ghost" data-d="reabrir">↩️ Reabrir</button>` : `<button class="btn btn-primary" data-d="concluir">✓ Concluir</button>`);
  if (i.kind === 'evento' && i.pode.concluir) btns.push(i.done ? `<button class="btn btn-ghost" data-d="reabrir">↩️ Reabrir</button>` : `<button class="btn btn-primary" data-d="concluir">✓ Realizado</button>`);
  if (!i.done && i.pode.reagendar) btns.push('<button class="btn btn-ghost" data-d="reagendar">📆 Reagendar</button>');
  if (i.pode.editar) btns.push('<button class="btn btn-ghost" data-d="editar">✏️ Editar</button>');
  if (i.kind === 'evento') btns.push('<button class="btn btn-ghost" data-d="whats" title="Enviar confirmação no WhatsApp">💬 WhatsApp</button>');
  if (i.convite) btns.push('<button class="btn btn-primary" data-d="aceitar">Aceitar convite</button><button class="btn btn-ghost" data-d="recusar">Recusar</button>');
  if (!['tarefa', 'evento'].includes(i.kind) && i.link) btns.push(`<button class="btn btn-ghost" data-d="origem">↗ Abrir em ${esc(rotuloDe(i))}</button>`);
  if (i.pode.excluir) btns.push('<button class="btn btn-ghost" data-d="excluir" style="margin-left:auto;color:var(--err)" title="Excluir">🗑</button>');

  const desc = i.kind === 'tarefa' ? i.descricao : i.kind === 'evento' ? i.descricao : i.sub;
  dr.style.setProperty('--c', corDe(i));
  dr.setAttribute('aria-label', i.titulo);
  dr.innerHTML = `<div class="at-dr-h">
      <div class="at-dr-k">${icoDe(i)} ${esc(rotuloDe(i))}${i.kind === 'tarefa' && i.historico_n ? ` · ${i.historico_n} alteraç${i.historico_n === 1 ? 'ão' : 'ões'}` : ''}<button type="button" class="at-ib" data-d="fechar" aria-label="Fechar">✕</button></div>
      <h3 class="at-dr-t">${esc(i.titulo)}</h3></div>
    <div class="at-dr-b">
      <dl class="at-dl">${linhas.map(([ic, v]) => `<dt aria-hidden="true">${ic}</dt><dd>${v}</dd>`).join('')}</dl>
      ${desc ? `<div class="at-dr-desc">${esc(desc)}</div>` : ''}
      ${i.kind === 'tarefa' && i.observacoes ? `<div class="at-dr-desc"><b style="font-size:11px;text-transform:uppercase;color:var(--ink-muted)">Observações</b><br>${esc(i.observacoes)}</div>` : ''}
      ${i.kind === 'tarefa' ? '<h4 style="margin:18px 0 6px;font-size:13px">💬 Comentários</h4><div id="at-dr-com"></div>' : ''}
    </div>
    <div class="at-dr-a">${btns.join('')}</div>`;
  dr.onclick = ev => {
    const b = ev.target.closest('[data-d]'); if (!b) return;
    const a = b.dataset.d;
    if (a === 'fechar') return fecharDrawer();
    if (a === 'concluir') return concluir(i);
    if (a === 'reabrir') return reabrir(i);
    if (a === 'reagendar') return menuReagendar(b, i);
    if (a === 'editar') return abrirForm({ item: i });
    if (a === 'whats') return whatsapp(i);
    if (a === 'excluir') return excluir(i);
    if (a === 'origem') { fecharDrawer(); location.hash = i.link; return; }
    if (a === 'aceitar' || a === 'recusar') { fecharDrawer(); return responderConvite(i, a, b); }
  };
  if (i.kind === 'tarefa') mountComments(dr.querySelector('#at-dr-com'), { target_type: 'task', target_id: i.id });
  if (novo) setTimeout(() => dr.querySelector('[data-d="fechar"]')?.focus(), 30);
}

/* ═══════════════════════════ criar / editar ═══════════════════════════ */
function atribuiveis(atual) {
  const me = auth.user() || {};
  const lvl = me.lvl || 2;
  const team = String(me.team || '').trim().toLowerCase();
  const ativos = selectableUsers(S.users || [], atual);
  let lista;
  if (lvl >= 10) lista = ativos;
  else if (lvl >= 7) lista = ativos.filter(u => (u.lvl || 2) < 7);
  else if (lvl >= 5) lista = ativos.filter(u => String(u.team || '').trim().toLowerCase() === team && (u.lvl || 2) < 5);
  else lista = [];
  lista = lista.filter(u => u.id !== me.id);
  if (atual && atual !== me.id && !lista.some(u => u.id === atual)) { const u = (S.users || []).find(x => x.id === atual); if (u) lista.unshift(u); }
  return [{ id: me.id, name: (me.name || 'Eu') + ' (você)' }, ...lista.sort((a, b) => String(a.name).localeCompare(String(b.name)))];
}

function abrirForm({ item, preset = {} } = {}) {
  fecharPop();
  const me = auth.user() || {};
  const ed = item || null;
  let tipo = ed ? (ed.kind === 'tarefa' ? 'tarefa' : 'compromisso') : (preset.tipo || (S.filtro === 'compromissos' || S.filtro === 'visitas' ? 'compromisso' : 'tarefa'));
  const podeTudo = !ed || (ed.kind === 'tarefa' ? ed.pode.editar_tudo : ed.pode.editar);
  const prefs = prefsAtuais() || {};
  const porItem = !!prefs.lembrete_por_item;
  let participantes = ed && ed.kind === 'evento' ? (ed.participantes || []).filter(p => p !== ed.corretor_id) : [];

  const v = (k, d = '') => esc(ed ? (ed[k] ?? d) : (preset[k] ?? d));
  const pr = prefs.prefs || {};
  const opLembrete = (tp, atual) => `<option value="">Padrão (${esc(rotuloLembrete(tp === 'tarefa' ? (pr.lembrete_tarefa_min ?? 15) : (pr.lembrete_evento_min ?? 30)).toLowerCase())})</option>`
    + LEMBRETE_OPCOES.map(([val, l]) => `<option value="${val}"${atual != null && atual !== '' && Number(atual) === val ? ' selected' : ''}>${l}</option>`).join('');

  const corpo = () => {
    const ehT = tipo === 'tarefa';
    const diaTodo = !ehT && (ed ? !!ed.all_day && !ed.hora_inicio : !preset.hora_inicio);
    const pessoas = selectableUsers(S.users || [], ed && ed.corretor_id);
    return `<div class="at-f">
      ${ed ? '' : `<div class="c6"><div class="at-seg" role="radiogroup" aria-label="Tipo" style="width:100%">
        <button type="button" data-ft="tarefa" class="${ehT ? 'on' : ''}" style="flex:1;min-height:34px">✅ Tarefa</button>
        <button type="button" data-ft="compromisso" class="${!ehT ? 'on' : ''}" style="flex:1;min-height:34px">📅 Compromisso</button></div></div>`}
      <label class="c6">${ehT ? 'O que precisa ser feito' : 'Compromisso'} *<input class="at-title-in" id="f-titulo" maxlength="200" value="${v('titulo')}" placeholder="${ehT ? 'Ex.: Enviar proposta ao cliente' : 'Ex.: Visita no Residencial Bela Vista'}" ${podeTudo ? '' : 'disabled'}></label>
      ${!ehT ? `<label class="c3">Tipo<select id="f-tipoevt">${Object.entries(TIPO_EVT).filter(([k]) => k !== 'tarefa').map(([k, t]) => `<option value="${k}"${(ed ? ed.tipo : (preset.tipoEvento || 'reuniao')) === k ? ' selected' : ''}>${t.ico} ${t.lbl}</option>`).join('')}</select></label>
        <label class="c3">Responsável<select id="f-resp">${pessoas.map(u => `<option value="${esc(u.id)}"${(ed ? (ed.corretor_id || ed.criado_por) : (preset.responsavel || me.id)) === u.id ? ' selected' : ''}>${esc(u.name)}${u.id === me.id ? ' (você)' : ''}</option>`).join('')}</select></label>` : ''}
      <label class="c2 keep">${ehT ? 'Prazo' : 'Data *'}<input type="date" id="f-data" value="${esc(ed ? (ed.data || '') : (preset.data || (ehT ? '' : hoje())))}" ${ehT && !podeTudo ? 'disabled' : ''}></label>
      <label class="c2 keep">Início<input type="time" id="f-hi" value="${v('hora_inicio')}" ${diaTodo ? 'disabled' : ''}></label>
      <label class="c2 keep">Término<input type="time" id="f-hf" value="${v('hora_fim')}" ${diaTodo ? 'disabled' : ''}></label>
      ${!ehT ? `<label class="c6 inline"><input type="checkbox" id="f-diatodo" ${diaTodo ? 'checked' : ''}> Dia todo</label>` : ''}
      ${ehT ? `<label class="c3">Responsável<select id="f-resp" ${podeTudo ? '' : 'disabled'}>${atribuiveis(ed ? ed.responsavel : preset.responsavel).map(u => `<option value="${esc(u.id)}"${(ed ? ed.responsavel : (preset.responsavel || me.id)) === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label class="c3">Prioridade<select id="f-prio" ${podeTudo ? '' : 'disabled'}>${PRIORIDADES.map(([k, l]) => `<option value="${k}"${(ed ? (ed.prioridade || 'media') : (preset.prioridade || 'media')) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${!ehT ? `<label class="c6">Local<input id="f-local" maxlength="200" value="${v('local')}" placeholder="Endereço, sala ou link da reunião"></label>
        <div class="c6"><label>Convidados</label>
          <select id="f-part-add" style="margin-top:4px"><option value="">+ Convidar alguém…</option>${selectableUsers(S.users || []).filter(u => !participantes.includes(u.id)).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>
          <div class="at-pchips" id="f-parts">${participantes.map(p => `<span class="at-pchip">${esc(((S.users || []).find(u => u.id === p) || {}).name || p)}<button type="button" data-rm="${esc(p)}" aria-label="Remover">✕</button></span>`).join('')}</div>
          <div class="at-muted" style="font-size:11.5px;margin-top:4px;text-transform:none;letter-spacing:0;font-weight:500">Cada convidado recebe o convite no sino/celular e decide se entra na agenda dele.</div></div>` : ''}
      ${ed ? `<label class="c3">Status<select id="f-status">${(ehT ? STATUS_TAREFA : STATUS_EVT).map(([k, l]) => `<option value="${k}"${ed.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${ehT ? `<label class="c3">Categoria<input id="f-cat" maxlength="60" value="${v('categoria')}" placeholder="Ex.: Follow-up" list="f-cats"></label>
        <datalist id="f-cats">${[...new Set(S.itens.filter(x => x.categoria).map(x => x.categoria))].slice(0, 30).map(c => `<option value="${esc(c)}">`).join('')}</datalist>` : ''}
      ${porItem ? `<label class="c3">Lembrete<select id="f-lembrete">${opLembrete(tipo, ed ? ed.lembrete_min : null)}</select></label>` : ''}
      <label class="c6">Descrição<textarea id="f-desc" rows="3" placeholder="${ehT ? 'Contexto, links, o que é “pronto”…' : 'Pauta, cliente, observações…'}">${esc(ed ? (ed.descricao || '') : '')}</textarea></label>
      ${ehT && ed ? `<label class="c6">Observações / andamento<textarea id="f-obs" rows="2">${esc(ed.observacoes || '')}</textarea></label>` : ''}
      ${ed && ed.kind === 'tarefa' && !podeTudo ? '<div class="c6 at-muted" style="font-size:12px">Título, prazo, prioridade e responsável são definidos por quem criou a tarefa.</div>' : ''}
      <div class="c6 at-err" id="f-err" role="alert"></div>
    </div>`;
  };

  const { el, fechar } = abrirModal({
    titulo: ed ? (tipo === 'tarefa' ? '✏️ Editar tarefa' : '✏️ Editar compromisso') : '➕ Novo',
    corpo: corpo(),
    rodape: `${ed && ed.pode.excluir ? '<button class="btn btn-ghost" data-f="excluir" style="color:var(--err)">🗑 Excluir</button>' : ''}
      <span class="at-sp"></span><span class="at-muted" style="font-size:11px">Ctrl+Enter salva</span>
      <button class="btn btn-ghost" data-f="cancelar">Cancelar</button>
      <button class="btn btn-primary" data-f="salvar">${ed ? 'Salvar' : 'Criar'}</button>`,
  });
  const $ = s => el.querySelector(s);
  const religar = () => {
    el.querySelectorAll('[data-ft]').forEach(b => b.onclick = () => {
      const t = $('#f-titulo').value, d = $('#f-data').value, hi = $('#f-hi').value, hf = $('#f-hf').value, desc = $('#f-desc').value;
      tipo = b.dataset.ft; preset = { ...preset, titulo: t, data: d || (tipo === 'compromisso' ? hoje() : ''), hora_inicio: hi, hora_fim: hf };
      el.querySelector('.at-mo-b').innerHTML = corpo(); $('#f-desc').value = desc; religar(); $('#f-titulo').focus();
    });
    const dt = $('#f-diatodo');
    if (dt) dt.onchange = () => { $('#f-hi').disabled = dt.checked; $('#f-hf').disabled = dt.checked; if (!dt.checked && !$('#f-hi').value) { $('#f-hi').value = '09:00'; $('#f-hf').value = '10:00'; } };
    const hi = $('#f-hi');
    if (hi) hi.onchange = () => { const hf = $('#f-hf'); if (hi.value && (!hf.value || hf.value <= hi.value)) hf.value = somaMin(hi.value, 60); };
    const add = $('#f-part-add');
    if (add) add.onchange = () => { if (add.value && !participantes.includes(add.value)) { participantes.push(add.value); redesenharParts(); } };
    el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { participantes = participantes.filter(p => p !== b.dataset.rm); redesenharParts(); });
  };
  const redesenharParts = () => {
    const box = $('#f-parts'), add = $('#f-part-add');
    box.innerHTML = participantes.map(p => `<span class="at-pchip">${esc(((S.users || []).find(u => u.id === p) || {}).name || p)}<button type="button" data-rm="${esc(p)}" aria-label="Remover">✕</button></span>`).join('');
    add.innerHTML = `<option value="">+ Convidar alguém…</option>${selectableUsers(S.users || []).filter(u => !participantes.includes(u.id)).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}`;
    religar();
  };
  religar();

  const salvar = async () => {
    const err = $('#f-err'); err.textContent = '';
    const titulo = $('#f-titulo').value.trim();
    if (!titulo) { err.textContent = 'Dê um título.'; $('#f-titulo').focus(); return; }
    const data = $('#f-data').value;
    const diaTodo = $('#f-diatodo') ? $('#f-diatodo').checked : false;
    const hi = diaTodo ? '' : $('#f-hi').value, hf = diaTodo ? '' : $('#f-hf').value;
    if (hf && !hi) { err.textContent = 'Informe o início antes do término.'; return; }
    if (hi && hf && hf <= hi) { err.textContent = 'O término precisa ser depois do início.'; return; }
    const lemb = $('#f-lembrete') ? $('#f-lembrete').value : undefined;
    const bSalvar = el.querySelector('[data-f="salvar"]'); bSalvar.disabled = true; bSalvar.textContent = 'Salvando…';
    try {
      let chave;
      if (tipo === 'tarefa') {
        const body = {
          titulo, prazo: data || '', hora_inicio: hi || '', hora_fim: hf || '',
          responsavel: $('#f-resp').value || me.id, prioridade: $('#f-prio').value,
          categoria: ($('#f-cat').value || '').trim(), descricao: $('#f-desc').value.trim(),
        };
        if ($('#f-obs')) body.observacoes = $('#f-obs').value.trim();
        if (lemb !== undefined) body.lembrete_min = lemb;
        if (ed) { body.id = ed.id; body.status = $('#f-status').value; }
        else { body.status = 'aberta'; Object.keys(body).forEach(k => { if (body[k] === '') body[k] = null; }); }
        const r = await upsertTarefa(body);
        chave = 'tarefa:' + (ed ? ed.id : r.task && r.task.id);
      } else {
        if (!data) { throw new Error('Compromisso precisa de data.'); }
        const resp = $('#f-resp').value || me.id;
        const body = {
          tipo: $('#f-tipoevt').value, titulo, data, hora_inicio: hi || null, hora_fim: hf || (hi ? somaMin(hi, 60) : null),
          all_day: diaTodo || !hi, corretor_id: resp, local: $('#f-local').value.trim() || null,
          descricao: $('#f-desc').value.trim() || null, participantes: [...new Set([resp, ...participantes])].filter(Boolean),
        };
        if (lemb !== undefined) body.lembrete_min = lemb === '' ? null : Number(lemb);
        if (ed) { body.id = ed.id; body.status = $('#f-status').value; if (!body.descricao) body.descricao = ''; if (!body.local) body.local = ''; }
        else body.status = 'agendado';
        const r = await upsertEvento(body);
        chave = 'evento:' + (ed ? ed.id : r.evento && r.evento.id);
        const novosConv = participantes.filter(p => p !== resp && !(ed && (ed.participantes || []).includes(p))).length;
        if (novosConv) preset._convites = novosConv;
      }
      fechar();
      await recarregarERender();
      const msg = ed ? '💾 Alterações salvas' : (tipo === 'tarefa' ? '✅ Tarefa criada' : '📅 Compromisso marcado') + (preset._convites ? ` · convite enviado a ${preset._convites} pessoa(s)` : '');
      toast(msg, !ed && chave ? { acao: 'Abrir', onAcao: () => abrirItem(chave) } : {});
    } catch (e) {
      bSalvar.disabled = false; bSalvar.textContent = ed ? 'Salvar' : 'Criar';
      err.textContent = e.message || String(e);
    }
  };
  el.querySelector('[data-f="salvar"]').onclick = salvar;
  el.querySelector('[data-f="cancelar"]').onclick = fechar;
  const bx = el.querySelector('[data-f="excluir"]'); if (bx) bx.onclick = () => { fechar(); excluir(ed); };
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); salvar(); }
    else if (e.key === 'Enter' && e.target.id === 'f-titulo') { e.preventDefault(); salvar(); }
  });
  setTimeout(() => { const t = $('#f-titulo'); if (t && !t.disabled) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30);
}

export { fecharModal };
