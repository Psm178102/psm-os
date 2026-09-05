/* PSM-OS v2 — 🎯 CMO · Marketing (v87.37 — cockpit completo)
   Pedido do Paulo (05/set): "no painel do CMO deverá mostrar todo fluxograma,
   todo monitoramento, escopo dos agentes de marketing, pra acompanhar com
   clareza e facilidade tudo". 5 abas:
   🎛 Painel · 🏭 Esteira (fluxograma) · 🏢 Departamento (13 cadeiras) ·
   📜 Relatórios · 📊 Monitoramento (notas do Auditor + backlog ICE + decisões).
   SÓ sócio (lvl>=10, front + backend /api/v3/diretoria/cmo).
   Estado do CMO em 4 chaves do shared_kv: cmo_relatorios / cmo_notas /
   cmo_backlog / cmo_decisoes (rotina roda no Windows 24h e grava lá).
   Documento-mãe: artifact "Esteira Conquista". */
import { api } from '../api.js';
import { auth } from '../auth.js';

const TIPO_LBL = { diario: '📅 Diário (19h15)', semanal: '🗓 Placar Semanal (seg)', mensal: '📊 Fechamento de mês', trimestral: '♟️ Plano do trimestre' };
const TIPO_COR = { diario: '#fb923c', semanal: '#38bdf8', mensal: '#22c55e', trimestral: '#a855f7' };
const TABS = [
  { id: 'painel', lbl: '🎛 Painel' },
  { id: 'esteira', lbl: '🏭 Esteira' },
  { id: 'depto', lbl: '🏢 Departamento' },
  { id: 'relatorios', lbl: '📜 Relatórios' },
  { id: 'monitor', lbl: '📊 Monitoramento' },
];

/* Organograma oficial (espelho do cmo-psm.md + artifact Esteira Conquista). */
const DEPTO = [
  { n: 1, nome: 'Curador', ico: '🔎', ok: false, est: '1-2 · insumo', dono: 'Garimpo (Radar de Virais, NotebookLM, Pinterest, benchmark IG), pauta semanal por canal, distribuição 30/30/40.', cobra: 'Pauta na sexta 12h com evidência de padrão validado.' },
  { n: 2, nome: 'Copywriter', ico: '✍️', ok: true, est: '3 · produção', dono: 'Legendas, headlines, roteiros, campanhas Meta, scripts WhatsApp/DM, landing pages.', cobra: 'Vícios de IA zerados, [CONFIRMAR] listados, zero contaminação de alto padrão.' },
  { n: 3, nome: 'Design', ico: '🎨', ok: false, est: '3 · produção', dono: 'Artes de feed, carrossel, stories, capas e criativos — SEMPRE brand kit Canva da Conquista.', cobra: 'DoD do Padrão de Entrega + linguagem do board Pinterest; final nunca em Pillow.' },
  { n: 4, nome: 'Gerador de Vídeo IA & Captação', ico: '🎥', ok: false, est: '3 · matéria-prima', dono: 'Vídeo 100% IA (Kling, TTS PT-BR, b-roll) + banco de brutos: shotlist pro time gravar e cobrança do material. Decide "grava ou gera".', cobra: 'Bruto/gerado disponível ANTES do editor precisar.' },
  { n: 5, nome: 'Editor de vídeo e cortes', ico: '✂️', ok: false, est: '3 · produção', dono: 'Reels/TikTok/Shorts: cortes, montagem, legendas queimadas, capa, trilha.', cobra: 'Gancho nos 2 primeiros segundos + formato citado do Banco de Formatos.' },
  { n: 6, nome: 'Social Media', ico: '📱', ok: false, est: '1, 5-7', dono: 'Presença e calendário por canal (IG/FB/TikTok/YT), identidade de cada rede, ritmo de stories.', cobra: 'Cadência cumprida vs planejada; canal sem post no prazo = anomalia.' },
  { n: 7, nome: 'Community / Relacionamento', ico: '💬', ok: false, est: '7+ · pós-publicação', dono: 'Responder TODO comentário e DM (tom Sol), triagem comentário→lead→Sol/comercial, escuta social.', cobra: '100% respondido < 4h úteis; lead com origem marcada.' },
  { n: 8, nome: 'Agendador de postagens', ico: '📆', ok: false, est: '6 · publicação', dono: 'Agendamento nativo: Business Suite (IG+FB), TikTok Studio/Canva Planner, YouTube Studio.', cobra: 'Checklist T1 100% antes de agendar; T2 verificação no ar em 1h.' },
  { n: 9, nome: 'SEO', ico: '🔍', ok: false, est: 'território próprio', dono: 'SEO local (Google Meu Negócio, reviews, mapa), SEO de YouTube (título/tag/capítulos), legenda/hashtag.', cobra: 'Ranking nas buscas-chave locais; GMB vivo; vídeos indexando.' },
  { n: 10, nome: 'Gestor de Tráfego Orgânico', ico: '📈', ok: false, est: 'consultor est. 1/5/6', dono: 'Alcance não pago: algoritmo por canal, trending sounds, horários, colabs.', cobra: 'Alcance/seguidor local rumo aos 5.000; aprendizado registrado.' },
  { n: 11, nome: 'Gestor de Tráfego Pago', ico: '🚦', ok: true, est: 'mídia', dono: 'Meta Ads: campanhas, verba, públicos (com MRR), relatório 19h. Form novo Cod.<campanha> por anúncio.', cobra: 'CPL por nicho, ROAS, gasto vs capacidade de atendimento.' },
  { n: 12, nome: 'MKT MRR', ico: '🧲', ok: true, est: 'base/RD', dono: 'TUDO do RD Station Marketing: réguas, automações, fluxos, segmentação, e-mail, lead scoring, tracking.', cobra: '% base rastreada, MQLs entregues, conversão por régua.' },
  { n: 13, nome: 'Auditor de Marketing', ico: '⚖️', ok: false, est: '4 + esteira inteira', dono: 'NOTA 0-10 EM TUDO (entregáveis, fluxos, tarefas e agentes). Status de toda tarefa (feita/pendente/recusada/erro), tempo vs SLA, bugs e ERROS INVISÍVEIS. Sem compliance CRECI.', cobra: 'Corte 8: <8 volta AUTOMÁTICO pra refazer até ≥8. Nenhuma tarefa sem classificação.' },
  { n: 14, nome: 'Vigia de Concorrência', ico: '🕵️', ok: true, est: 'inteligência', dono: 'Coleta 100% da Ad Library dos concorrentes 3x/dia (Windows) + IA analisa snapshots a cada 6h. Detecta quem ligou/desligou verba, hooks novos, empreendimentos disputados.', cobra: 'Cobertura 100% verificada por rodada; movimento relevante vira insumo do Curador, do Tráfego e do war-gaming do CMO.' },
];

const HANDOFFS = [
  ['Curador → CMO', 'Pauta da semana com evidência (viral/garimpo/NotebookLM), distribuição 30/30/40', 'sex 12h', 'toda pauta com evidência de padrão validado'],
  ['CMO → Copy / Design / Vídeo IA', 'Briefing de 8 campos (objetivo, marca, entregável, hipótese, critério numérico, prazo, referências, restrições)', '24h', 'briefing incompleto volta pro CMO'],
  ['Copywriter → Design / Editor', 'Copy final + roteiro com gancho 0-2s + instruções de arte', '48h', 'vícios de IA zerados'],
  ['Vídeo IA → Editor', 'Bruto: vídeo IA (Kling/TTS) OU gravação do time (shotlist cobrado)', 'antes do editor precisar', 'bruto faltando = anomalia, não improviso'],
  ['Design / Editor → Auditor', 'Peça final no Definition of Done (dimensões, zonas seguras, capa, nomenclatura)', '2-3 dias úteis', 'DoD 100% — fora do DoD nem entra na fila de nota'],
  ['Auditor → Paulo/Isabella', 'Peça + nota 0-10 item a item (rubrica)', '24h', 'corte 8: <8 volta AUTOMÁTICO pra refazer até ≥8 · conversão = 2 avaliadores'],
  ['Paulo → Agendador', 'Lote aprovado item a item', '—', 'reprovação vira regra escrita em 24h'],
  ['Agendador → Canais', 'Post agendado no sistema nativo de cada rede', 'T2 em 1h', 'T1: link testado de verdade, UTM única, versão aprovada'],
  ['Canais → Community', 'Comentários, DMs, menções — monitoração contínua', '< 4h úteis', '100% respondido · crise nunca no impulso'],
  ['Community → Sol / MRR', 'Lead de comentário/DM com origem marcada; dúvida repetida vira pauta', 'no ato', 'lead sem origem = incidente de tracking'],
  ['Auditor → CMO', 'Placar de Notas (média 0-10 por agente) + status de TODAS as tarefas + tempo vs SLA + bugs + erros invisíveis', 'seg 8h', 'nenhuma tarefa sem classificação'],
  ['Todos → CMO', 'Métricas da semana + anomalias + aprendizado do ciclo', 'seg 8h', 'sem dado = declarar lacuna, nunca inventar'],
  ['CMO → Paulo + CEO', 'Placar Semanal (1 tela) · Reporte mensal (1 página) · budget via CFO', 'seg 8h / dia 1º', 'CMO recomenda, Paulo decide — sempre'],
];

const LEIS = [
  ['1 · Nada fura portão', 'Urgência comprime SLA, nunca elimina estação. TUDO recebe nota 0-10 e abaixo de 8 não passa: volta automático pra refazer até ≥8.'],
  ['2 · Quem cria não avalia', 'Auditor é independente e adversarial. Nota 0-10 em entregáveis, fluxos, tarefas e agentes; conversão = 2 avaliadores.'],
  ['3 · Reprovação vira regra', 'Todo "não" do Paulo tem motivo de 1 linha e vira regra escrita em 24h. Nunca corrigir o mesmo detalhe duas vezes.'],
  ['4 · WIP limitado', 'Máx. 2 lotes simultâneos por executor. Esteira entupida = repriorizar pelo ICE, não empurrar.'],
  ['5 · Publicar = aprovação do Paulo', 'Nenhum agente posta, dispara ou gasta por conta própria. Sem exceção.'],
  ['6 · Tom de marca sagrado', 'Conquista = Sol, MCMV, didático. Zero contaminação de alto padrão e zero vícios de IA.'],
];

let _root = null, _tab = 'painel', _dados = null, _filtro = 'todos', _formAberto = false;

export async function pageCMO(ctx, root) {
  _root = root;
  _tab = (ctx?.query?.tab) || 'painel';
  render();
  await load(true);
}

async function load(rerender) {
  try { _dados = await api.request('/api/v3/diretoria/cmo'); }
  catch (e) { _dados = { erro: e.message }; }
  if (rerender) render();
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function md(txt) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', inList = false;
  for (const ln of String(txt || '').split(/\r?\n/)) {
    const t = ln.trim();
    const li = t.match(/^(?:[*\-•▪]|\d+[.)])\s+(.*)/);
    if (li) { if (!inList) { html += '<ul class="cmomd-ul">'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (!t || /^[─—-]{4,}$/.test(t)) continue;
    const h = t.match(/^(#{1,4})\s*(.*)/);
    if (h) { html += `<div class="cmomd-h${Math.min(h[1].length, 3)}">${inline(h[2])}</div>`; continue; }
    html += `<p class="cmomd-p">${inline(t)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function fmtTs(ts) { return esc(String(ts || '').slice(0, 16).replace('T', ' ')) + ' UTC'; }
function rels() { return Array.isArray(_dados?.relatorios) ? _dados.relatorios : []; }
function notas() { return Array.isArray(_dados?.notas) ? _dados.notas : []; }
function backlog() { return Array.isArray(_dados?.backlog) ? _dados.backlog : []; }
function decisoes() { return Array.isArray(_dados?.decisoes) ? _dados.decisoes : []; }

/* ─────────────────────────── shell ─────────────────────────── */
function render() {
  _root.innerHTML = `
  <style>
    .cmomd-p{margin:5px 0;line-height:1.55}
    .cmomd-ul{margin:5px 0 5px 18px;line-height:1.55}
    .cmomd-h1,.cmomd-h2{font-weight:800;margin:12px 0 4px;font-size:14px}
    .cmomd-h3{font-weight:700;margin:9px 0 3px;font-size:12.5px}
    .cmo-chip{display:inline-block;padding:4px 12px;border-radius:999px;border:1px solid var(--bd);cursor:pointer;font-size:11.5px;user-select:none}
    .cmo-chip.on{background:#38bdf8;color:#04121f;border-color:transparent;font-weight:800}
    .cmo-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
    .cmo-tab{padding:7px 14px;border-radius:999px;border:1px solid var(--bd);cursor:pointer;font-size:12.5px;font-weight:600;user-select:none}
    .cmo-tab.on{background:#22c55e;color:#04170c;border-color:transparent;font-weight:800}
    .cmo-card{background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px}
    .cmo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
    .cmo-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px}
    .cmo-table{width:100%;border-collapse:collapse;font-size:12.5px}
    .cmo-table th{text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55;padding:8px 10px;border-bottom:1px solid var(--bd)}
    .cmo-table td{padding:9px 10px;border-bottom:1px solid var(--bd);vertical-align:top}
    .cmo-table tr:last-child td{border-bottom:none}
    .cmo-gate{color:#f87171;font-weight:600}
    .cmo-sla{white-space:nowrap;color:#eab308;font-weight:700}
    .cmo-flowline{display:flex;align-items:stretch;gap:0;flex-wrap:nowrap;overflow-x:auto;padding:4px 0}
    .cmo-fnode{min-width:150px;flex:0 0 auto;background:var(--bg-3);border:1px solid #22c55e55;border-radius:10px;padding:8px 12px;font-size:11.5px}
    .cmo-fnode b{display:block;font-size:12px}
    .cmo-fnode.ext{border-color:#38bdf855}
    .cmo-fnode.gate{border-color:#f43f5e88;background:rgba(244,63,94,.07)}
    .cmo-fnode.hum{border-style:dashed;border-color:#eab30888}
    .cmo-farr{flex:0 0 auto;align-self:center;padding:0 6px;color:var(--muted);font-size:11px;text-align:center;min-width:44px}
    .cmo-svgwrap{overflow-x:auto;background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:12px}
    .cmo-nota{display:inline-block;min-width:34px;text-align:center;font-weight:900;border-radius:8px;padding:2px 8px}
    .cmo-kpi{background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:12px 14px;text-align:center}
    .cmo-kpi .v{font-size:22px;font-weight:900}
    .cmo-kpi .l{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;opacity:.55;margin-top:2px}
  </style>

  <div style="background:linear-gradient(135deg,var(--bg-3),transparent);border:1px solid var(--bd);border-radius:12px;padding:14px 18px;margin-bottom:14px">
    <div class="flex" style="align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-weight:900;font-size:16px">🎯 CMO · Marketing</div>
      <span class="tiny muted">C-level do marketing · Conquista primeiro · só sócios</span>
      <span style="margin-left:auto" class="tiny"><a href="#/agentes-diretoria" style="color:#38bdf8">💬 conversar com o CMO →</a></span>
    </div>
    <div class="tiny" style="margin-top:4px;color:var(--muted)">Decide onde o dinheiro entra, aciona a esteira, cobra os 13 agentes e fecha CAC/ROAS por nicho. Ele recomenda, o sócio decide. Rotina no Windows 24h → relatórios chegam aqui sozinhos.</div>
  </div>

  <div class="cmo-tabs">${TABS.map(t => `<span class="cmo-tab ${_tab === t.id ? 'on' : ''}" data-cmo-tab="${t.id}">${t.lbl}</span>`).join('')}</div>
  <div id="cmo-body"></div>`;

  _root.querySelectorAll('[data-cmo-tab]').forEach(el => el.onclick = () => { _tab = el.dataset.cmoTab; render(); });
  const body = _root.querySelector('#cmo-body');
  if (_dados === null) { body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando cockpit do CMO…</div>'; return; }
  if (_dados.erro) { body.innerHTML = `<div class="muted">⚠️ ${esc(_dados.erro)}</div>`; return; }
  if (_tab === 'painel') renderPainel(body);
  else if (_tab === 'esteira') renderEsteira(body);
  else if (_tab === 'depto') renderDepto(body);
  else if (_tab === 'relatorios') renderRelatorios(body);
  else renderMonitor(body);
}

/* ─────────────────────────── 🎛 Painel ─────────────────────────── */
function renderPainel(body) {
  const r = rels();
  const alerta = r.find(x => x.tipo === 'diario' && x.alerta && (Date.now() - Date.parse(x.ts || 0)) < 48 * 3600e3);
  const ultimo = t => r.find(x => x.tipo === t);
  const ns = notas();
  const media = ns.length ? (ns.reduce((s, n) => s + (+n.nota || 0), 0) / ns.length) : null;
  const reprov = ns.length ? Math.round(100 * ns.filter(n => (+n.nota || 0) < 8).length / ns.length) : null;
  const aRevisar = decisoes().filter(d => d.revisao_em && Date.parse(d.revisao_em) <= Date.now() && !d.resultado).length;
  const testando = backlog().filter(b => b.status === 'testando').length;

  body.innerHTML = `
  ${alerta ? `<div style="background:rgba(244,63,94,.12);border:1px solid #f43f5e;border-radius:10px;padding:10px 14px;margin-bottom:12px">
    <b>🚨 Alerta vivo do CMO</b> <span class="tiny muted">· ${fmtTs(alerta.ts)}</span>
    <div class="tiny" style="margin-top:4px">${md(alerta.texto)}</div></div>` : ''}

  <div class="cmo-grid" style="margin-bottom:12px">
    <div class="cmo-kpi"><div class="v">${DEPTO.filter(d => d.ok).length}/${DEPTO.length}</div><div class="l">agentes ativos</div></div>
    <div class="cmo-kpi"><div class="v">${media !== null ? media.toFixed(1) : '—'}</div><div class="l">nota média (Auditor)</div></div>
    <div class="cmo-kpi"><div class="v">${reprov !== null ? reprov + '%' : '—'}</div><div class="l">reprovado no corte 8</div></div>
    <div class="cmo-kpi"><div class="v">${testando}</div><div class="l">testes rodando</div></div>
    <div class="cmo-kpi"><div class="v">${aRevisar}</div><div class="l">decisões a revisar</div></div>
  </div>

  <div class="cmo-grid3">
    ${['diario', 'semanal', 'mensal'].map(t => {
      const u = ultimo(t);
      return `<div class="cmo-card">
        <div style="font-weight:800;color:${TIPO_COR[t]}">${TIPO_LBL[t]}</div>
        ${u ? `<div class="tiny muted" style="margin:2px 0 6px">${fmtTs(u.ts)}${u.periodo ? ' · ' + esc(u.periodo) : ''}</div>
               <div class="tiny" style="line-height:1.5;max-height:110px;overflow:hidden">${md(String(u.texto || '').slice(0, 400))}</div>
               <div class="tiny" style="margin-top:6px"><a href="#" data-cmo-ir="relatorios" style="color:#38bdf8">ver completo →</a></div>`
             : `<div class="tiny muted" style="margin-top:6px">Ainda sem rodada. A tarefa roda no Windows (${t === 'diario' ? 'todo dia 19h15' : t === 'semanal' ? 'segunda 8h' : 'dia 1º 9h'}) e aparece aqui sozinha.</div>`}
      </div>`;
    }).join('')}
  </div>

  <div class="cmo-card" style="margin-top:12px">
    <b>🧭 Como ler este cockpit</b>
    <div class="tiny muted" style="margin-top:4px;line-height:1.6">
      <b>🏭 Esteira</b> = o fluxograma oficial (4 fluxos, handoffs com SLA, 6 leis). ·
      <b>🏢 Departamento</b> = as 13 cadeiras com escopo e o que o CMO cobra de cada uma. ·
      <b>📜 Relatórios</b> = as rodadas da rotina (diário/semanal/mensal/trimestral). ·
      <b>📊 Monitoramento</b> = Placar de Notas do Auditor (0-10, corte 8), backlog de ideias/testes (ICE) e Decision Log com data de revisão.
    </div>
  </div>`;
  body.querySelectorAll('[data-cmo-ir]').forEach(el => el.onclick = e => { e.preventDefault(); _tab = el.dataset.cmoIr; render(); });
}

/* ─────────────────────────── 🏭 Esteira ─────────────────────────── */
function svgFabrica() {
  /* Porte do fluxograma-mãe (artifact Esteira Conquista) pro tema do House. */
  const V = '#22c55e', VT = 'rgba(34,197,94,.10)', T = '#f43f5e', TT = 'rgba(244,63,94,.08)', A = '#eab308', AT = 'rgba(234,179,8,.10)', Z = '#38bdf8', ZT = 'rgba(56,189,248,.08)';
  const box = (x, y, w, h, fill, stroke, dash, lines, bold) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="${fill}" stroke="${stroke}" stroke-width="${bold ? 2.4 : 1.6}" ${dash ? 'stroke-dasharray="5 4"' : ''}/>
    ${lines.map((l, i) => `<text x="${x + w / 2}" y="${y + 24 + i * 16}" text-anchor="middle" font-size="${i ? 10.5 : 12.5}" ${i ? 'opacity=".75"' : 'font-weight="800"'} fill="currentColor">${l}</text>`).join('')}`;
  return `<svg viewBox="0 0 1560 540" role="img" aria-label="Fluxo da fábrica de conteúdo Conquista" style="min-width:1240px;display:block;height:auto">
    <defs>
      <marker id="cmoAr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>
      <marker id="cmoArG" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${V}"/></marker>
    </defs>
    <g stroke="currentColor" stroke-width="1.5" fill="none">
      <line x1="180" y1="120" x2="248" y2="120" marker-end="url(#cmoAr)"/>
      <line x1="428" y1="120" x2="470" y2="120"/><line x1="470" y1="120" x2="470" y2="60"/>
      <line x1="470" y1="60" x2="516" y2="60" marker-end="url(#cmoAr)"/>
      <line x1="470" y1="120" x2="516" y2="120" marker-end="url(#cmoAr)"/>
      <line x1="470" y1="120" x2="470" y2="188"/><line x1="470" y1="188" x2="516" y2="188" marker-end="url(#cmoAr)"/>
      <line x1="696" y1="60" x2="740" y2="60"/><line x1="740" y1="60" x2="740" y2="118"/>
      <line x1="696" y1="120" x2="740" y2="120"/><line x1="696" y1="188" x2="740" y2="188"/><line x1="740" y1="188" x2="740" y2="122"/>
      <line x1="740" y1="120" x2="782" y2="120" marker-end="url(#cmoAr)"/>
      <line x1="962" y1="120" x2="1006" y2="120" marker-end="url(#cmoAr)"/>
      <line x1="1118" y1="120" x2="1162" y2="120" marker-end="url(#cmoAr)"/>
      <line x1="1318" y1="120" x2="1362" y2="120" marker-end="url(#cmoAr)"/>
      <line x1="1452" y1="164" x2="1452" y2="208" marker-end="url(#cmoAr)"/>
      <line x1="1362" y1="252" x2="1130" y2="252" marker-end="url(#cmoAr)"/>
      <line x1="940" y1="252" x2="826" y2="252" marker-end="url(#cmoAr)"/>
    </g>
    <g stroke="${T}" stroke-width="1.5" fill="none" stroke-dasharray="6 4">
      <path d="M1062 164 L1062 320 L606 320 L606 216" marker-end="url(#cmoAr)"/>
    </g>
    <g stroke="${V}" stroke-width="2" fill="none">
      <path d="M520 452 L104 452 L104 166" marker-end="url(#cmoArG)"/>
      <path d="M1035 296 L1035 428 L892 428" marker-end="url(#cmoArG)"/>
    </g>
    <g fill="currentColor" font-size="10.5" opacity=".7">
      <text x="150" y="104" text-anchor="middle">sex · pauta</text>
      <text x="452" y="44" text-anchor="middle">briefing 8 campos · 24h</text>
      <text x="877" y="102" text-anchor="middle">2-3 dias úteis</text>
      <text x="1246" y="104" text-anchor="middle">valida 1 a 1</text>
      <text x="1246" y="248" text-anchor="middle">no ar</text>
    </g>
    <g fill="${T}" font-size="10.5" font-weight="600"><text x="700" y="340">nota &lt;8: volta AUTOMÁTICO pra refazer (nota + motivos) até ≥8</text></g>
    <g fill="${V}" font-size="10.5" font-weight="700"><text x="262" y="442">APRENDIZADO: métricas da semana realimentam a pauta seguinte</text></g>
    ${box(28, 86, 152, 72, VT, V, 0, ['1 · CURADOR', 'garimpo + NotebookLM', 'pauta 30/30/40'])}
    ${box(248, 86, 180, 72, VT, V, 0, ['2 · CMO', 'prioriza (ICE + gargalo)', 'briefing + critério'], 1)}
    ${box(516, 32, 180, 56, VT, V, 0, ['3a · COPYWRITER ✓', 'copy · roteiro · headline'])}
    ${box(516, 92, 180, 56, VT, V, 0, ['3b · DESIGN', 'Canva + brand kit'])}
    ${box(516, 160, 180, 56, VT, V, 0, ['3c · VÍDEO IA', 'gera IA ou shotlist'])}
    ${box(782, 86, 180, 72, VT, V, 0, ['4 · EDITOR', 'corte · legenda · capa', 'gancho 0-2s'])}
    <polygon points="1062,76 1118,120 1062,164 1006,120" fill="${TT}" stroke="${T}" stroke-width="1.8"/>
    <text x="1062" y="114" text-anchor="middle" font-size="11.5" font-weight="800" fill="currentColor">AUDITOR</text>
    <text x="1062" y="130" text-anchor="middle" font-size="10" opacity=".8" fill="currentColor">nota 0-10 · ≥8?</text>
    ${box(1162, 86, 156, 72, AT, A, 1, ['PAULO / ISA', 'aprova · ajusta', '· reprova'])}
    ${box(1362, 86, 180, 78, VT, V, 0, ['5 · AGENDADOR', 'T1 pré-voo 100%', 'nativo · T2 em 1h'])}
    ${box(1362, 208, 180, 88, ZT, Z, 0, ['CANAIS', 'IG+FB · Business Suite', 'TikTok · Canva/Studio', 'Shorts · YT Studio'])}
    ${box(940, 216, 190, 72, VT, V, 0, ['6 · COMMUNITY', '100% respondido < 4h', 'dúvida · lead · crise'])}
    ${box(656, 222, 170, 60, ZT, Z, 0, ['SOL → COMERCIAL', 'lead com origem'])}
    ${box(520, 400, 372, 56, VT, V, 0, ['7 · CMO · MEDIÇÃO (Placar seg 8h)', 'melhor/pior peça · veredito · decisão no log'], 1)}
  </svg>`;
}

function flowChips(itens) {
  return `<div class="cmo-flowline">${itens.map((it, i) => `
    ${i ? `<div class="cmo-farr">${esc(it.lblArr || '')}<br>→</div>` : ''}
    <div class="cmo-fnode ${it.cls || ''}"><b>${esc(it.t)}</b><span class="tiny muted">${esc(it.s)}</span></div>`).join('')}</div>`;
}

function renderEsteira(body) {
  body.innerHTML = `
  <div class="tiny muted" style="margin-bottom:10px">Fluxograma oficial (documento-mãe: <a href="https://claude.ai/code/artifact/4bb315e9-fdc6-4151-af1d-39fca18303e2" target="_blank" style="color:#38bdf8">artifact Esteira Conquista ↗</a>). Verde = estação · vermelho = portão · tracejado amarelo = humano decide · azul = sistema externo.</div>

  <div style="font-weight:800;margin-bottom:6px">FLUXO 1 · Fábrica de conteúdo orgânico (ciclo semanal)</div>
  <div class="cmo-svgwrap">${svgFabrica()}</div>

  <div style="font-weight:800;margin:18px 0 6px">FLUXO 2 · Tráfego pago (Meta Ads)</div>
  ${flowChips([
    { t: 'CMO', s: 'budget por nicho + CFO' },
    { t: 'PAULO', s: 'verba é decisão dele', cls: 'hum', lblArr: 'aprova' },
    { t: 'GESTOR DE TRÁFEGO ✓', s: 'campanha + form Cod.<campanha>' },
    { t: 'META ADS', s: 'relatório 19h · alarmes', cls: 'ext', lblArr: 'sobe' },
    { t: 'RD + HOUSE', s: 'duplo destino · paridade ≥99%', cls: 'ext', lblArr: 'lead' },
    { t: 'MKT MRR ✓', s: 'origem · segmento · score', lblArr: 'rastreado' },
    { t: 'SOL → CORRETOR', s: 'pré-venda IA · fila do dia', cls: 'ext', lblArr: '< 5 min' },
  ])}
  <div class="tiny muted" style="margin-top:2px">Criativo de anúncio passa pela MESMA fábrica do Fluxo 1 (briefing → copy/design → Auditor → Paulo). Anúncio novo = form NOVO nomeado — o form é a chave do CAC.</div>

  <div style="font-weight:800;margin:18px 0 6px">FLUXO 3 · RD Station Marketing (MKT MRR)</div>
  ${flowChips([
    { t: 'LEAD ENTRA', s: 'form · LP · DM · indicação', cls: 'ext' },
    { t: 'MRR · FUNDAÇÃO', s: 'UTM/origem · dedupe · segmento' },
    { t: 'SCORE', s: 'perfil × engajamento', cls: 'gate', lblArr: 'corte' },
    { t: 'MQL → COMERCIAL', s: 'ordenado por calor', lblArr: 'quente' },
    { t: 'RÉGUA POR NICHO', s: 'boas-vindas · pós-visita 48h', lblArr: 'morno' },
    { t: 'ATE_2250 → NUTRIÇÃO', s: 'educação MCMV até mudar de faixa', lblArr: 'fora de faixa' },
  ])}
  <div class="tiny muted" style="margin-top:2px">Interação vira score de volta (loop). Score recalibrado todo mês contra venda REAL. Disparo = sempre aprovação do Paulo.</div>

  <div style="font-weight:800;margin:18px 0 6px">FLUXO 4 · Alcance orgânico & SEO</div>
  ${flowChips([
    { t: 'ORGÂNICO', s: 'algoritmo · trending · horários' },
    { t: 'SEO', s: 'GMB · reviews · YouTube SEO', lblArr: '+' },
    { t: 'SOCIAL MEDIA + CURADOR', s: 'pauta nasce otimizada', lblArr: 'abastecem' },
    { t: '5.000 SEGUIDORES LOCAIS', s: 'meta antes da chave de conversão', cls: 'ext', lblArr: 'alcance' },
    { t: 'CMO · PLACAR', s: 'aprendizado vira regra da pauta', lblArr: 'resultado' },
  ])}

  <div style="font-weight:800;margin:18px 0 6px">HANDOFFS · passagem de bastão (o Auditor fiscaliza cada linha)</div>
  <div style="overflow-x:auto;border:1px solid var(--bd);border-radius:12px"><table class="cmo-table">
    <thead><tr><th>#</th><th>De → Para</th><th>O que passa de mão</th><th>SLA</th><th>Portão</th></tr></thead>
    <tbody>${HANDOFFS.map((h, i) => `<tr><td>${i + 1}</td><td style="font-weight:700;white-space:nowrap">${esc(h[0])}</td><td>${esc(h[1])}</td><td class="cmo-sla">${esc(h[2])}</td><td class="cmo-gate">${esc(h[3])}</td></tr>`).join('')}</tbody>
  </table></div>

  <div style="font-weight:800;margin:18px 0 6px">AS 6 LEIS DA ESTEIRA</div>
  <div class="cmo-grid3">${LEIS.map(l => `<div class="cmo-card"><b>${esc(l[0])}</b><div class="tiny muted" style="margin-top:3px">${esc(l[1])}</div></div>`).join('')}</div>`;
}

/* ─────────────────────────── 🏢 Departamento ─────────────────────────── */
function renderDepto(body) {
  const ativos = DEPTO.filter(d => d.ok).length;
  body.innerHTML = `
  <div class="tiny muted" style="margin-bottom:10px">As ${DEPTO.length} cadeiras do departamento Conquista — <b>${ativos} ativas</b>, ${DEPTO.length - ativos} a criar (uma por conversa, lendo o fluxograma-mãe antes). Todo agente nasce subordinado ao CMO e herda os guardrails: publicar/disparar/gastar = só com aprovação do Paulo.</div>
  <div class="cmo-grid3">
    ${DEPTO.map(d => `
    <div class="cmo-card" style="border-left:4px solid ${d.ok ? '#22c55e' : 'var(--bd)'}">
      <div class="flex" style="align-items:center;gap:8px">
        <span style="font-size:18px">${d.ico}</span>
        <b>${d.n} · ${esc(d.nome)}</b>
        <span style="margin-left:auto" class="tiny ${d.ok ? '' : 'muted'}">${d.ok ? '✅ ativo' : '⏳ a criar'}</span>
      </div>
      <div class="tiny" style="margin-top:2px;color:#38bdf8">estação ${esc(d.est)}</div>
      <div class="tiny" style="margin-top:6px;line-height:1.5"><b>Dono de:</b> ${esc(d.dono)}</div>
      <div class="tiny" style="margin-top:5px;line-height:1.5;color:var(--muted)"><b>CMO cobra:</b> ${esc(d.cobra)}</div>
    </div>`).join('')}
  </div>`;
}

/* ─────────────────────────── 📜 Relatórios ─────────────────────────── */
function renderRelatorios(body) {
  const lista = _filtro === 'todos' ? rels() : rels().filter(r => r.tipo === _filtro);
  body.innerHTML = `
  <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:12px;align-items:center">
    ${[['todos', '📚 Todos'], ...Object.entries(TIPO_LBL)].map(([k, v]) =>
      `<span class="cmo-chip ${_filtro === k ? 'on' : ''}" data-cmo-fl="${k}">${v}${k !== 'todos' ? ` (${rels().filter(r => r.tipo === k).length})` : ''}</span>`).join('')}
    <button class="btn btn-ghost tiny" id="cmo-add" style="margin-left:auto">➕ Registrar relatório</button>
    <button class="btn btn-ghost tiny" id="cmo-reload" title="recarregar">🔄</button>
  </div>
  <div id="cmo-form" ${_formAberto ? '' : 'hidden'} style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:12px">
    <div class="tiny muted" style="margin-bottom:8px">Contingência manual — a rotina do Windows grava sozinha.</div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:8px">
      <select id="cmo-f-tipo" class="input" style="max-width:230px">${Object.entries(TIPO_LBL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input id="cmo-f-periodo" class="input" placeholder="período (2026-09 ou S36)" style="max-width:200px">
      <label class="tiny" style="align-self:center"><input type="checkbox" id="cmo-f-alerta"> é alerta</label>
    </div>
    <textarea id="cmo-f-texto" class="input" rows="8" placeholder="texto (markdown simples)"></textarea>
    <div style="margin-top:8px"><button class="btn btn-primary tiny" id="cmo-f-salvar">Salvar</button></div>
  </div>
  ${lista.length ? lista.map((r, i) => `
    <div style="background:var(--bg-3);border-left:4px solid ${r.alerta ? '#f43f5e' : (TIPO_COR[r.tipo] || '#fb923c')};border-radius:10px;padding:12px 16px;margin-bottom:10px">
      <div class="flex" style="align-items:center;gap:8px;cursor:pointer;flex-wrap:wrap" data-cmo-tg="${i}">
        <b>${r.alerta ? '🚨 ' : ''}${TIPO_LBL[r.tipo] || esc(r.tipo)}</b>
        ${r.periodo ? `<span class="tiny" style="opacity:.8">· ${esc(r.periodo)}</span>` : ''}
        <span class="tiny muted">· ${fmtTs(r.ts)}${r.gerado_por && r.gerado_por !== 'cmo-windows' ? ' · manual (' + esc(r.gerado_por) + ')' : ''}</span>
        <button class="btn btn-ghost tiny" data-cmo-cp="${i}" title="copiar" style="margin-left:auto">📋</button>
        <span data-cmo-ar="${i}">${i === 0 ? '▼' : '▶'}</span>
      </div>
      <div data-cmo-bd="${i}" ${i === 0 ? '' : 'hidden'} style="margin-top:10px;border-top:1px solid var(--bd);padding-top:6px">${md(r.texto)}</div>
    </div>`).join('')
  : `<div class="cmo-card tiny muted" style="text-align:center">Nenhum relatório ainda — a rotina do Windows (cmo-abre-o-dia 19h15 · cmo-fecha-a-semana seg 8h · cmo-fecha-o-mes dia 1º) grava aqui sozinha.</div>`}`;

  body.querySelectorAll('[data-cmo-fl]').forEach(el => el.onclick = () => { _filtro = el.dataset.cmoFl; render(); });
  body.querySelectorAll('[data-cmo-tg]').forEach(el => el.onclick = () => {
    const i = el.dataset.cmoTg;
    const bd = body.querySelector(`[data-cmo-bd="${i}"]`);
    bd.hidden = !bd.hidden;
    body.querySelector(`[data-cmo-ar="${i}"]`).textContent = bd.hidden ? '▶' : '▼';
  });
  body.querySelectorAll('[data-cmo-cp]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    const r = lista[+el.dataset.cmoCp];
    navigator.clipboard?.writeText(r?.texto || '').then(() => { el.textContent = '✓'; setTimeout(() => { el.textContent = '📋'; }, 1500); });
  });
  const add = body.querySelector('#cmo-add');
  if (add) add.onclick = () => { _formAberto = !_formAberto; render(); };
  const rl = body.querySelector('#cmo-reload');
  if (rl) rl.onclick = () => { _dados = null; render(); load(true); };
  const sv = body.querySelector('#cmo-f-salvar');
  if (sv) sv.onclick = async () => {
    const texto = body.querySelector('#cmo-f-texto').value.trim();
    if (!texto) return alert('Texto vazio.');
    sv.disabled = true; sv.textContent = '⏳…';
    try {
      await api.request('/api/v3/diretoria/cmo', { method: 'POST', body: {
        tipo: body.querySelector('#cmo-f-tipo').value,
        periodo: body.querySelector('#cmo-f-periodo').value.trim(),
        alerta: body.querySelector('#cmo-f-alerta').checked,
        texto,
      } });
      _formAberto = false; _dados = null; render(); load(true);
    } catch (e) { alert('Falha: ' + e.message); sv.disabled = false; sv.textContent = 'Salvar'; }
  };
}

/* ─────────────────────────── 📊 Monitoramento ─────────────────────────── */
function notaCor(n) { return n >= 8 ? 'background:rgba(34,197,94,.18);color:#22c55e' : n >= 6 ? 'background:rgba(234,179,8,.18);color:#eab308' : 'background:rgba(244,63,94,.18);color:#f43f5e'; }

function renderMonitor(body) {
  const ns = notas(), bl = backlog(), dc = decisoes();
  // média por agente
  const porAgente = {};
  ns.forEach(n => {
    const a = n.agente || '?';
    (porAgente[a] = porAgente[a] || []).push(+n.nota || 0);
  });
  const medias = Object.entries(porAgente).map(([a, arr]) => ({ a, m: arr.reduce((s, x) => s + x, 0) / arr.length, q: arr.length })).sort((x, y) => x.m - y.m);
  const ICE = b => ((+b.ice?.i || 0) * (+b.ice?.c || 0) * (+b.ice?.e || 0)) || null;
  const stChip = { ideia: '💡 ideia', aprovado: '👍 aprovado', testando: '🧪 testando', validado: '✅ validado', morto: '🪦 morto' };

  body.innerHTML = `
  <div class="cmo-card" style="margin-bottom:12px">
    <b>⚖️ Placar de Notas do Auditor</b> <span class="tiny muted">· nota 0-10 em entregáveis, fluxos, tarefas e agentes · CORTE 8: &lt;8 volta automático pra refazer</span>
    ${ns.length ? `
      <div class="cmo-grid" style="margin-top:10px">
        ${medias.map(m => `<div class="cmo-kpi"><div class="v"><span class="cmo-nota" style="${notaCor(m.m)}">${m.m.toFixed(1)}</span></div><div class="l">${esc(m.a)} · ${m.q} notas</div></div>`).join('')}
      </div>
      <div style="overflow-x:auto;margin-top:10px"><table class="cmo-table">
        <thead><tr><th>Quando</th><th>Agente</th><th>Entregável/tarefa</th><th>Nota</th><th>Motivo</th></tr></thead>
        <tbody>${ns.slice(0, 30).map(n => `<tr><td class="tiny muted" style="white-space:nowrap">${fmtTs(n.ts)}</td><td style="font-weight:700">${esc(n.agente || '—')}</td><td>${esc(n.entregavel || n.tipo || '—')}</td><td><span class="cmo-nota" style="${notaCor(+n.nota || 0)}">${esc(n.nota)}</span></td><td class="tiny muted">${esc(n.motivo || '')}</td></tr>`).join('')}</tbody>
      </table></div>`
    : `<div class="tiny muted" style="margin-top:8px">Sem notas ainda — o Auditor de Marketing (a criar) grava aqui em <code>shared_kv cmo_notas</code>: <code>{itens:[{ts, agente, entregavel, nota, motivo}]}</code>. Assim que ele rodar o 1º ciclo, este placar acende.</div>`}
  </div>

  <div class="cmo-card" style="margin-bottom:12px">
    <b>💡 Backlog de ideias & testes (ICE)</b> <span class="tiny muted">· 1 teste ativo por nicho · kill criteria na largada</span>
    ${bl.length ? `<div style="overflow-x:auto;margin-top:10px"><table class="cmo-table">
        <thead><tr><th>Status</th><th>Ideia</th><th>Hipótese</th><th>ICE</th><th>Nicho</th></tr></thead>
        <tbody>${bl.slice(0, 30).map(b => `<tr><td style="white-space:nowrap">${stChip[b.status] || esc(b.status || '💡')}</td><td style="font-weight:700">${esc(b.ideia || '')}</td><td class="tiny muted">${esc(b.hipotese || '')}</td><td style="font-weight:800">${ICE(b) ?? '—'}</td><td class="tiny">${esc(b.nicho || '')}</td></tr>`).join('')}</tbody>
      </table></div>`
    : `<div class="tiny muted" style="margin-top:8px">Backlog vazio — o CMO alimenta em <code>shared_kv cmo_backlog</code> nos ritos (toda ideia entra pontuada por Impacto × Confiança × Esforço).</div>`}
  </div>

  <div class="cmo-card">
    <b>🗃️ Decision Log</b> <span class="tiny muted">· toda decisão com data de revisão · taxa de acerto declarada no fechamento</span>
    ${dc.length ? `<div style="overflow-x:auto;margin-top:10px"><table class="cmo-table">
        <thead><tr><th>Quando</th><th>Decisão</th><th>Número-base</th><th>Revisão</th><th>Resultado</th></tr></thead>
        <tbody>${dc.slice(0, 30).map(d => {
          const venc = d.revisao_em && Date.parse(d.revisao_em) <= Date.now() && !d.resultado;
          return `<tr><td class="tiny muted" style="white-space:nowrap">${fmtTs(d.ts)}</td><td style="font-weight:700">${esc(d.decisao || '')}</td><td class="tiny">${esc(d.numero_base || '')}</td><td class="tiny" style="${venc ? 'color:#f43f5e;font-weight:800' : ''}">${esc(String(d.revisao_em || '—').slice(0, 10))}${venc ? ' ⚠ vencida' : ''}</td><td class="tiny">${esc(d.resultado || 'aguardando')}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`
    : `<div class="tiny muted" style="margin-top:8px">Log vazio — o CMO registra decisões em <code>shared_kv cmo_decisoes</code> (decisão, contexto, número-base, alternativa rejeitada, resultado esperado, revisão em). Antes de decidir de novo, ele consulta aqui.</div>`}
  </div>`;
}
