/* ============================================================================
   PSM-OS v2 — 🏆 RANKING HUB · MODO TV (v86.97)
   Réplica do Modo TV do Ranking do PSM HUB (psmhub.com.br/tv), com os dados
   vindos DO PRÓPRIO HUB via ponte /api/v3/psmhub/ranking (login de serviço).
   Pódio 1º/2º/3º + fila 4º+, badges por regra (Prosp/Agend/Aten/Doc/Venda/Perdas),
   filtro por equipe, relógio, tela cheia e atualização automática a cada 30s.
   v86.99: letreiro de jornal no rodapé (padrão da timeline v86.90) com os
   RECADOS ativos (timeline) + OPORTUNIDADES abertas (quadro, onde o Radar
   Incorporadoras publica) — texto passando, pausa no mouse, só re-renderiza
   quando o dado muda (senão o letreiro reiniciava a cada poll).
============================================================================ */
import { api } from '../api.js';
import { sounds } from '../sounds.js';
import { enableWakeLock, disableWakeLock } from '../wakelock.js';

const REFRESH_MS = 30000;

/* ── ARENA TV 2.0 (v87.21, decisão do Paulo 04/set) ─────────────────────────
   Telas INTEIRAS alternando, ranking de vendas como âncora (~70% do tempo):
   vendas → pastas → vendas → visitas → vendas → atendimentos → vendas →
   criativos → vendas → premiações → vendas → placar → …
   Os rankings de pastas/visitas/atendimentos saem do MESMO ruleBreakdown do
   HUB (pontos por categoria). + GONGO DA VENDA: pontos de venda/VGV de alguém
   subiram entre polls → overlay de 10s + som (sounds.venda). */
/* v87.22 (feedback do Paulo: 60s de âncora ficou lento) — CARROSSEL DE TEMPO
   IGUAL: 20s por tela, sempre girando. O ranking de vendas aparece 2× por
   ciclo (abre e volta no meio) pra continuar sendo o foco sem travar o ritmo. */
/* v87.25/87.26 — ⚙️ ENGRENAGEM: tempo por tela, telas ativas/ordem e "vendas
   volta a cada N" vêm do /api/v3/arena/tv2_config (shared_kv) — calibra sem
   deploy; a TV pega no próximo poll. (87.26 = hotfix: a definição não tinha
   entrado no 87.25 e a TV quebrou com CICLO_ATUAL undefined.) */
let _cfg = { slide_s: 20, telas: ['recado', 'duelo', 'doc', 'aten', 'prosp', 'placar', 'cronograma', 'corrida', 'premiacoes'], ocultar_nomes: ['Isabella', 'Paulo', 'Comercial', 'Yara'] };
let _cfgCanEdit = false, _cfgAt = 0;
const SLIDE_MS = () => _cfg.slide_s * 1000;
// v87.73: ranking geral abre a volta e NÃO volta no meio (Paulo: "2 telas gerais")
function CICLO_ATUAL() { return ['vendas', ..._cfg.telas]; }
/* v87.23 (pacote 'vida imediata' + corrida, aprovado pelo Paulo): duelo pela
   liderança e Corrida da Meta entram no ciclo; voz no gongo; streaks/secas;
   Modo Fechamento na última semana; abertura do dia às 8h30; ticker de
   atividade ao vivo pelos DELTAS de pontos do HUB entre polls (sem backend). */
/* v87.24 (Paulo): criativos SAI do ciclo; entra 📣 RECADO em tela cheia (recados
   da Timeline marcados c/ 📺 pelo gestor); navegação manual ‹ › + setas do
   teclado/controle; rankings mostram QUANTIDADE real + pontos em sequência. */
/* v87.73 (Paulo 10/set) — FONTE POR TELA + nenhuma tela repetida:
   • Ranking geral e Duelo → ranking do HUB (/api/v3/psmhub/ranking).
   • Pastas, Visitas, Prospecção e Placar do mês → ESTEIRA DE PRODUTIVIDADE do
     HUB (/api/v3/psmhub/esteira: prospeccao/qualificacao/agendamento/
     atendimento/pasta/vendaCount/vendaTotal por corretor), não mais o
     ruleBreakdown de pontos do ranking.
   • A geral passa 1× por volta (o "vendas volta a cada N" a duplicava) e tela
     sem conteúdo é PULADA — antes a Corrida sem meta caía no Placar (placar 2×)
     e o Duelo/Recado vazios caíam na geral.
   • + 🗓️ CRONOGRAMA DA SEMANA (Rotina de Ações Direcionadas, foto do quadro). */
/* v87.75 (Paulo 10/set, 2ª rodada):
   • 📣 Timeline de recados = 1/4 da tela (faixa fixa de 25vh fora do corpo que
     troca a cada tela — antes o letreiro recomeçava a cada 20s).
   • "comercial" e Yara fora de TODOS os rankings (lista de ocultos da ⚙) —
     inclusive gongo/atividade e Corrida, que não passavam pelo filtro.
   • Placar: projeção PELO FUNIL (antes era só o ritmo do vendido → mês sem
     venda lançada = todo mundo 0% mesmo produzindo) + o que falta pra meta por
     corretor e o gargalo do time. */
const CELEB_MS = 10000;
const TELAS_SEC = [
  { id: 'doc',        lbl: '🗂 Ranking de Pastas',       sub: 'pastas no mês · Esteira de Produtividade do PSM HUB', un: 'pasta(s)', campo: 'pasta' },
  { id: 'aten',       lbl: '🚶 Ranking de Visitas',      sub: 'visitas realizadas no mês (coluna Atendimento) · Esteira de Produtividade do PSM HUB', un: 'visita(s)', campo: 'atendimento' },
  { id: 'prosp',      lbl: '📞 Ranking de Prospecções',  sub: 'prospecções no mês · Esteira de Produtividade do PSM HUB', un: 'prospecção(ões)', campo: 'prospeccao' },
  { id: 'criativos',  lbl: '🎨 Criativos do mês' },
  { id: 'premiacoes', lbl: '🏆 Premiações ativas' },
  { id: 'placar',     lbl: '🎯 Placar do mês' },
  { id: 'duelo',      lbl: '⚔️ Duelo pela liderança' },
  { id: 'corrida',    lbl: '🏁 Corrida da Meta' },
  { id: 'recado',     lbl: '📣 Recado da gestão' },
  { id: 'cronograma', lbl: '🗓️ Cronograma da semana' },
];
// v87.73: origem de cada tela no rodapé — a gestão quer a fonte explícita
const EST_HUB = 'Esteira de Produtividade do PSM HUB';
const FONTE_TELA = { vendas: 'Ranking do PSM HUB', duelo: 'Ranking do PSM HUB', doc: EST_HUB, aten: EST_HUB,
  prosp: EST_HUB, placar: `${EST_HUB} · meta do HUB · projeção pelo funil`, cronograma: 'Rotina de Ações Direcionadas' };

let _root = null, _data = null, _err = '', _pending = false;
let _team = 'GERAL';
let _pollTimer = null, _clock = null;
let _fetchedAt = null;
let _recados = [], _oport = [], _sig = '';
let _screen = 'vendas', _secIdx = 0, _rotTimer = null, _rotPauseAte = 0;
let _criativos = [], _ov = null, _metas = null, _extraAt = 0;
let _prevVendas = null, _celeb = null, _celebTimer = null;
let _ritmo = {}, _ritmoAt = 0;
let _est = null, _estErr = '', _estAt = 0;   // 🧮 esteira de produtividade do HUB (v87.73)
let _recTvIdx = 0;               // alterna entre recados 📺 a cada passada        // streaks/secas (GC ritmo_vendas, 1º nome → dias)
let _atividade = [];                  // ticker ao vivo: deltas de pontos entre polls
let _taxas = null, _taxasAt = 0;      // 📐 conversão real do funil (esteira dos 3 meses fechados) — v87.75
let _tkOn = false;                    // 📣 timeline de recados visível (reserva 1/4 da tela)

export async function pageRankingHub(ctx, root) {
  _root = root; _err = ''; _data = null; _team = 'GERAL';
  document.body.classList.add('tv-mode');
  document.documentElement.requestFullscreen?.().catch(() => {});
  enableWakeLock(() => {});
  _root.innerHTML = shell('<div style="font-size:26px;opacity:.7;text-align:center;padding:120px">🏆 Carregando o Ranking do PSM HUB…</div>');
  await reload();
  startTimers();
  window.addEventListener('hashchange', cleanup, { once: true });
}

function cleanup() {
  closeTickerOverlay();
  document.getElementById('rh-timeline')?.remove();
  document.getElementById('rh-tk-style')?.remove();
  _tkSig = ''; _tkOn = false;
  document.body.classList.remove('tv-mode');
  [_pollTimer, _clock].forEach(t => t && clearInterval(t));
  if (_rotTimer) clearTimeout(_rotTimer);
  if (_celebTimer) clearTimeout(_celebTimer);
  _rotTimer = _celebTimer = null;
  _pollTimer = _clock = null;
  disableWakeLock();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function startTimers() {
  [_pollTimer, _clock].forEach(t => t && clearInterval(t));
  _pollTimer = setInterval(reload, REFRESH_MS);
  agendaRotacao();
  _clock = setInterval(() => { const el = document.getElementById('rh-clock'); if (el) el.textContent = nowStr(); }, 1000);
}

function mudaTela(passo) {
  // navegação manual (botões ‹ › ou setas do controle): pausa a rotação por 90s
  _rotPauseAte = Date.now() + 90000;
  const CICLO = CICLO_ATUAL();
  for (let t = 0; t < CICLO.length; t++) {
    _secIdx = ((_secIdx + passo) % CICLO.length + CICLO.length) % CICLO.length;
    const id = CICLO[_secIdx];
    if (!temConteudo(id)) continue;
    _screen = id; break;
  }
  render();
  agendaRotacao();
}

function agendaRotacao() {
  if (_rotTimer) clearTimeout(_rotTimer);
  _rotTimer = setTimeout(() => {
    if (_celeb || Date.now() < _rotPauseAte || document.getElementById('rh-overlay')) { agendaRotacao(); return; }
    const CICLO = CICLO_ATUAL();
    // avança no ciclo pulando telas sem conteúdo (ver temConteudo)
    for (let t = 0; t < CICLO.length; t++) {
      _secIdx = (_secIdx + 1) % CICLO.length;
      const id = CICLO[_secIdx];
      if (!temConteudo(id)) continue;
      _screen = id; break;
    }
    render();
    agendaRotacao();
  }, SLIDE_MS());
}

/* v87.73: tela sem conteúdo é PULADA — nunca cai em outra tela (era isso que
   repetia o Placar via Corrida sem meta, e a geral via Duelo/Recado vazios) */
function temConteudo(id) {
  if (id === 'recado') return _recados.some(r => r.tv);
  if (id === 'premiacoes') return _oport.length > 0;
  if (id === 'criativos') return _criativos.length > 0;
  if (id === 'duelo') return ranked().length >= 2;
  if (id === 'corrida') return corridaLanes().length > 0;
  return true;
}

async function reload() {
  // 🧮 esteira do HUB a cada 60s (a tela da própria esteira no HUB usa staleTime de 60s)
  const querEst = Date.now() - _estAt > 60000;
  if (querEst) _estAt = Date.now();
  const [r, rec, op, est] = await Promise.all([
    api.request('/api/v3/psmhub/ranking').catch(e => ({ _err: e.message })),
    api.request('/api/v3/timeline/recados').catch(() => null),
    api.request('/api/v3/crm_extra/oportunidades').catch(() => null),
    querEst ? api.request('/api/v3/psmhub/esteira').catch(e => ({ _err: e.message })) : null,
  ]);
  if (r && r.ok) { _data = r.data; _fetchedAt = new Date(); _err = ''; }
  else if (r) { _err = r.error || r._err || 'PSM HUB indisponível'; if (r.pending_config) _pending = true; }
  if (est && est.ok) { _est = est.data; _estErr = ''; }
  else if (est) _estErr = est.error || est._err || 'Esteira do PSM HUB indisponível';

  // 📐 base da projeção do placar: esteira dos 3 meses fechados anteriores (1×/6h;
  // se nenhum mês voltar, tenta de novo em 10 min)
  if (Date.now() - _taxasAt > 6 * 3600e3) {
    _taxasAt = Date.now();
    const hj = new Date();
    const meses = [1, 2, 3].map(k => { const d = new Date(hj.getFullYear(), hj.getMonth() - k, 1); return { m: d.getMonth() + 1, y: d.getFullYear() }; });
    Promise.all(meses.map(({ m, y }) => api.request(`/api/v3/psmhub/esteira?month=${m}&year=${y}`).catch(() => null))).then(rs => {
      const base = rs.map((x, i) => ({ ...meses[i], rows: x && x.ok && x.data && Array.isArray(x.data.rows) ? x.data.rows : null }));
      if (!base.some(b => b.rows)) _taxasAt = Date.now() - 6 * 3600e3 + 600e3;
      _taxas = calcTaxas(base);
      if (_screen === 'placar') render();
    }).catch(() => {});
  }
  if (rec) _recados = rec.items || [];
  if (op) _oport = (op.oportunidades || []).filter(o => o.status === 'aberta');

  // ⚙️ config da TV (shared_kv) — a cada 60s; calibragem vale sem deploy
  if (Date.now() - _cfgAt > 60000) {
    _cfgAt = Date.now();
    api.request('/api/v3/arena/tv2_config').then(r => {
      if (r && r.ok && r.config) { _cfg = r.config; _cfgCanEdit = !!r.can_edit; }
    }).catch(() => {});
  }

  // dados das telas extras (criativos/placar) — a cada 5min basta
  if (Date.now() - _extraAt > 300000) {
    _extraAt = Date.now();
    api.request('/api/v3/paulo/cards?board=criativos_lib').then(r => {
      _criativos = ((r && r.cards) || []).filter(c => driveFileId(c.link)).slice(0, 24);
    }).catch(() => {});
    api.request('/api/v3/metrics/overview').then(r => { _ov = r; }).catch(() => {});
    api.request('/api/v3/metas/atingimento?ano=' + new Date().getFullYear()).then(r => { _metas = r; }).catch(() => {});
  }

  // 🔥 streaks/secas — ritmo do GC (1×/10min; nome de guerra → dias desde última venda)
  if (Date.now() - _ritmoAt > 600000) {
    _ritmoAt = Date.now();
    const ini = new Date(); ini.setDate(1);
    api.request(`/api/v3/oo/comercial?since=${ini.toISOString().slice(0, 10)}&until=${new Date().toISOString().slice(0, 10)}`).then(r => {
      const m = {};
      ((r && r.ritmo_vendas && r.ritmo_vendas.corretores) || []).forEach(c => {
        const key = String(c.nome || '').split(' ')[0].toLowerCase();
        if (!(key in m) || (c.dias_desde_ultima_venda != null && c.dias_desde_ultima_venda < m[key])) m[key] = c.dias_desde_ultima_venda;
      });
      _ritmo = m;
    }).catch(() => {});
  }

  // 🔔 GONGO (venda/VGV subiu) + ⚡ TICKER DE ATIVIDADE (demais categorias subiram)
  if (_data && _data.ranking) {
    const ATIV_LBL = { prosp: 'Prospecção', agend: 'Visita agendada', aten: 'Visita realizada', doc: 'Pasta/Proposta' };
    const atual = {};
    // ocultos da TV (sócios, conta comercial…) também não tocam o gongo nem entram no letreiro
    _data.ranking.filter(a => !ocultoNaTV(a.agentName)).forEach(a => {
      const cats = { v: 0, vgv: a.vgvReal || 0, prosp: 0, agend: 0, aten: 0, doc: 0 };
      (a.ruleBreakdown || []).forEach(rb => {
        const k = classifyRule(rb);
        if (k === 'venda') cats.v += rb.totalPoints || 0;
        else if (cats[k] != null) cats[k] += rb.totalPoints || 0;
      });
      atual[a.agentName] = cats;
    });
    if (_prevVendas) {
      let gongou = false;
      for (const [nome, x] of Object.entries(atual)) {
        const antes = _prevVendas[nome];
        if (!antes) continue;
        if (!gongou && (x.v > antes.v || x.vgv > antes.vgv + 1)) { gongo(nome, x.vgv - (antes.vgv || 0)); gongou = true; }
        for (const k of ['aten', 'doc', 'agend', 'prosp']) {
          if (x[k] > antes[k]) _atividade.unshift({ nome, lbl: ATIV_LBL[k], hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) });
        }
      }
      _atividade = _atividade.slice(0, 12);
    }
    _prevVendas = atual;
  }

  // ☀️ abertura do dia (08:20–09:00, uma vez por dia)
  aberturaDoDia();

  // só re-renderiza se o DADO mudou — senão o letreiro reiniciava a cada 30s
  const sig = JSON.stringify([_data, _est, _recados.map(x => x.id + (x.texto || '')), _oport.map(x => x.id + (x.titulo || '')), _err, _estErr]);
  if (sig !== _sig) { _sig = sig; render(); }
  else { const el = document.getElementById('rh-upd'); if (el && _fetchedAt) el.textContent = `Atualizado às ${_fetchedAt.toLocaleTimeString('pt-BR')}`; }
}

function fala(txt) {
  try {
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = 'pt-BR'; u.rate = 0.95; u.pitch = 1.05; u.volume = 1;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (_) {}
}

/* ── 🔔 gongo da venda: overlay de 10s + som + VOZ ── */
function gongo(nome, vgvDelta) {
  try { sounds.venda(); } catch (_) {}
  setTimeout(() => fala(`Venda confirmada! ${nome}!`), 900);
  _celeb = { nome, vgvDelta };
  const ov = document.createElement('div');
  ov.id = 'rh-gongo';
  ov.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(5,8,15,.92);display:flex;align-items:center;justify-content:center';
  ov.innerHTML = `
    <div style="text-align:center;animation:rhPop .3s ease">
      <div style="font-size:110px;line-height:1">🔔🎉</div>
      <div style="font-size:26px;font-weight:900;letter-spacing:.2em;color:#facc15;margin-top:10px">VENDA CONFIRMADA</div>
      <div style="font-size:64px;font-weight:900;color:#f8fafc;margin-top:8px">${escapeHtml(nome)}</div>
      ${vgvDelta > 1 ? `<div style="font-size:34px;font-weight:800;color:#4ade80;margin-top:8px">+ ${fmtBRL(vgvDelta)}</div>` : ''}
      <div style="font-size:18px;color:#94a3b8;margin-top:16px">👏 Arena, aplausos!</div>
    </div>`;
  document.body.appendChild(ov);
  if (_celebTimer) clearTimeout(_celebTimer);
  _celebTimer = setTimeout(() => { ov.remove(); _celeb = null; _screen = 'vendas'; render(); agendaRotacao(); }, CELEB_MS);
}

/* ── ☀️ abertura do dia: overlay de 45s com placar + líder, 1×/dia ── */
function aberturaDoDia() {
  const h = new Date();
  const hm = h.getHours() * 60 + h.getMinutes();
  if (hm < 500 || hm > 540) return;                       // janela 08:20–09:00
  const flag = 'psm_arena_tv_abertura';
  const hojeStr = h.toISOString().slice(0, 10);
  try { if (localStorage.getItem(flag) === hojeStr) return; localStorage.setItem(flag, hojeStr); } catch (_) { return; }
  const sv = (_ov && _ov.sales) || {};
  const lider = ranked()[0];
  const ov = document.createElement('div');
  ov.id = 'rh-abertura';
  ov.style.cssText = 'position:fixed;inset:0;z-index:85;background:linear-gradient(180deg,#0c1a2e,#0a0d16);display:flex;align-items:center;justify-content:center';
  ov.innerHTML = `
    <div style="text-align:center;animation:rhPop .4s ease">
      <div style="font-size:90px">☀️</div>
      <div style="font-size:52px;font-weight:900;color:#facc15;margin-top:6px">BOM DIA, ARENA!</div>
      <div style="font-size:24px;color:#cbd5e1;margin-top:16px">${h.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div style="display:flex;gap:20px;justify-content:center;margin-top:26px">
        <div style="background:#0d1120;border:1px solid rgba(71,85,105,.4);border-radius:14px;padding:18px 26px">
          <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.1em">VGV do mês</div>
          <div style="font-size:34px;font-weight:900;color:#4ade80">${fmtBRL(sv.vgv_mes || 0)}</div>
        </div>
        ${lider ? `<div style="background:#0d1120;border:1px solid rgba(234,179,8,.5);border-radius:14px;padding:18px 26px">
          <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.1em">Líder do ranking</div>
          <div style="font-size:34px;font-weight:900;color:#facc15">👑 ${escapeHtml(lider.agentName || '')}</div>
        </div>` : ''}
      </div>
      <div style="font-size:20px;color:#94a3b8;margin-top:24px">Bora fazer desse dia o melhor do mês. 💪</div>
    </div>`;
  document.body.appendChild(ov);
  fala('Bom dia, Arena! Bora fazer desse dia o melhor do mês!');
  setTimeout(() => ov.remove(), 45000);
}

/* ── 📣 tela: recado da gestão em TELA CHEIA (Timeline c/ flag 📺) ── */
function telaRecado() {
  const tvs = _recados.filter(r => r.tv);
  if (!tvs.length) return vazio('📣', 'Nenhum recado 📺 ativo na Timeline.');
  const r = tvs[_recTvIdx % tvs.length];
  _recTvIdx++;
  const cor = r.cor && r.cor !== '#0f172a' ? r.cor : '#eab308';
  return `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;padding:5vh 7vw">
      <div style="max-width:1100px;width:100%;text-align:center;border-radius:26px;padding:56px 54px;background:linear-gradient(180deg,${cor}26,#0d1120 65%);border:3px solid ${cor};box-shadow:0 0 90px ${cor}33">
        <div style="font-size:64px">📣</div>
        <div style="font-size:14px;font-weight:900;letter-spacing:.2em;color:${cor};margin-top:6px">RECADO DA GESTÃO</div>
        <div style="font-size:44px;font-weight:900;color:#f8fafc;line-height:1.35;margin-top:18px;white-space:pre-wrap">${escapeHtml(r.texto || '')}</div>
        <div style="font-size:19px;color:#94a3b8;margin-top:26px">— ${escapeHtml(r.autor || 'Diretoria')}${r.expira_em ? ` · vale até ${new Date(r.expira_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
      </div>
    </div>`;
}

/* ── ⚔️ tela: duelo pela liderança (1º vs 2º) ── */
function telaDuelo() {
  const l = ranked();
  const [a, b] = [l[0], l[1]];
  if (!a || !b) return vazio('⚔️', 'O duelo começa quando 2 corretores pontuarem no mês.');
  const diff = (a.totalPoints || 0) - (b.totalPoints || 0);
  const lado = (x, cor, coroa) => `
    <div style="flex:1;text-align:center;border-radius:20px;padding:34px 20px;background:${coroa ? 'radial-gradient(120% 120% at 50% 0%,rgba(234,179,8,.16),#0d1120)' : 'rgba(30,41,59,.4)'};border:2px solid ${cor}">
      ${coroa ? '<div style="font-size:44px">👑</div>' : '<div style="font-size:44px">🥈</div>'}
      <div style="font-size:38px;font-weight:900;color:#f8fafc;margin-top:6px">${escapeHtml(x.agentName || '')}</div>
      <div style="font-size:76px;font-weight:900;color:${cor};line-height:1.1">${fmtPts(x.totalPoints)}</div>
      <div style="font-size:14px;letter-spacing:.12em;color:#64748b">PONTOS</div>
      ${x.vgvReal ? `<div style="font-size:22px;font-weight:800;color:#4ade80;margin-top:8px">${fmtBRL(x.vgvReal)}</div>` : ''}
    </div>`;
  return `
    <div style="text-align:center;padding:18px 0 0">
      <span style="font-size:30px;font-weight:900;color:#facc15">⚔️ Duelo pela liderança</span>
    </div>
    <div style="display:flex;gap:24px;align-items:stretch;padding:24px 50px">
      ${lado(a, '#facc15', true)}
      <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px">
        <div style="font-size:40px;font-weight:900;color:#94a3b8">VS</div>
        <div style="background:#7c2d12;border:1px solid #fb923c;border-radius:12px;padding:10px 16px;text-align:center">
          <div style="font-size:26px;font-weight:900;color:#fb923c">${fmtPts(diff)} pts</div>
          <div style="font-size:12px;color:#fdba74">separam os dois</div>
        </div>
      </div>
      ${lado(b, '#94a3b8', false)}
    </div>
    <div style="text-align:center;font-size:22px;font-weight:800;color:#e2e8f0">${escapeHtml(b.agentName || '')} precisa de <span style="color:#fb923c">${fmtPts(diff + 1)} pontos</span> pra tomar a ponta 🔥</div>`;
}

/* ── 🏁 tela: Corrida da Meta (% da meta individual do ano, com linha de pace) ── */
function corridaLanes() {
  // sócio/diretor NUNCA na TV da Arena (Paulo, 05/set: 'retire ela daquilo imediatamente')
  return ((_metas && _metas.por_corretor) || []).filter(c => !c.inativo && (c.meta_vgv || 0) > 0
    && !/socio|diretor/i.test(String(c.role || '')) && !ocultoNaTV(c.name))
    .map(c => ({ ...c, pct: Math.min(120, Math.round((c.vgv_atingido || 0) / c.meta_vgv * 100)) }))
    .sort((a, b2) => b2.pct - a.pct).slice(0, 8);
}
function telaCorrida() {
  const lanes = corridaLanes();
  if (!lanes.length) return vazio('🏁', 'Sem metas individuais de VGV cadastradas para a Corrida.');
  const paceAno = Math.round(((Date.now() - new Date(new Date().getFullYear(), 0, 1)) / 864e5) / 365 * 100);
  return `
    <div style="text-align:center;padding:18px 0 0">
      <span style="font-size:30px;font-weight:900;color:#facc15">🏁 Corrida da Meta ${new Date().getFullYear()}</span>
      <div style="font-size:14px;color:#64748b;margin-top:2px">% da meta individual de VGV · a linha tracejada é onde o ano está (${paceAno}%)</div>
    </div>
    <div style="padding:20px 50px;display:grid;gap:14px">
      ${lanes.map((c, i) => `
        <div>
          <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#e2e8f0">
            <span>${i === 0 ? '🥇 ' : ''}${escapeHtml(c.name || '')}</span>
            <span style="color:${c.pct >= paceAno ? '#4ade80' : '#fb923c'}">${c.pct}% · ${fmtBRL(c.vgv_atingido || 0)} <span style="color:#64748b;font-weight:400">/ ${fmtBRL(c.meta_vgv)}</span></span>
          </div>
          <div style="position:relative;height:22px;background:#1e293b;border-radius:99px;margin-top:4px;overflow:visible">
            <div style="height:100%;width:${Math.min(100, c.pct)}%;border-radius:99px;background:linear-gradient(90deg,${c.pct >= paceAno ? '#22c55e,#4ade80' : '#f59e0b,#fb923c'})"></div>
            <div style="position:absolute;top:-4px;bottom:-4px;left:${Math.min(100, paceAno)}%;width:0;border-left:2px dashed rgba(226,232,240,.5)"></div>
            <div style="position:absolute;top:-6px;left:calc(${Math.min(100, c.pct)}% - 14px);font-size:20px">🏎️</div>
          </div>
        </div>`).join('')}
    </div>`;
}

const driveFileId = u => { const m = String(u || '').match(/\/file\/d\/([-\w]{15,})/) || String(u || '').match(/[?&]id=([-\w]{15,})/) || String(u || '').match(/([-\w]{25,})/); return m ? m[1] : ''; };
const driveThumb = id => id ? `https://drive.google.com/thumbnail?id=${id}&sz=w800` : '';

/* ── classificação de regra → badge (mesma legenda do Modo TV do HUB) ── */
const BADGES = {
  prosp: { ab: 'Prosp.', lbl: 'Prospecção',      bg: '#3b3b8f', fg: '#c7c9ff' },
  agend: { ab: 'Agend.', lbl: 'Visita Agendada', bg: '#1e3a8a', fg: '#bfdbfe' },
  aten:  { ab: 'Aten.',  lbl: 'Visita Realizada',bg: '#134e4a', fg: '#99f6e4' },
  doc:   { ab: 'Doc.',   lbl: 'Proposta',        bg: '#4c1d95', fg: '#ddd6fe' },
  venda: { ab: 'Venda',  lbl: 'Venda',           bg: '#14532d', fg: '#bbf7d0' },
  perdas:{ ab: 'Perdas', lbl: 'Penalidades',     bg: '#7f1d1d', fg: '#fecaca' },
};
function classifyRule(rb) {
  const t = `${rb.label || ''} ${rb.stageName || ''}`.toLowerCase();
  if (rb.type === 'penalidade' || t.includes('penal') || t.includes('perda')) return 'perdas';
  if (t.includes('venda')) return 'venda';
  if (t.includes('aprova') || t.includes('proposta') || t.includes('document') || t.includes('pasta')) return 'doc';
  if (t.includes('atend') || t.includes('visita realizada')) return 'aten';
  if (t.includes('agend')) return 'agend';
  return 'prosp';
}
function catAgg(agent) {
  // v87.24: quantidade REAL (rb.count) + pontos, por categoria
  const acc = {};
  (agent.ruleBreakdown || []).forEach(rb => {
    const k = classifyRule(rb);
    acc[k] = acc[k] || { pts: 0, n: 0 };
    acc[k].pts += rb.totalPoints || 0;
    acc[k].n += rb.count || 0;
  });
  return acc;
}
function badgesOf(agent) {
  const acc = catAgg(agent);
  return ['prosp', 'agend', 'aten', 'doc', 'venda', 'perdas'].filter(k => acc[k] && (acc[k].pts || acc[k].n)).map(k => {
    const b = BADGES[k];
    return `<span style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:600;background:${b.bg};color:${b.fg}">${b.ab} <b>${acc[k].n}</b> · ${fmtPts(acc[k].pts)}pts</span>`;
  }).join(' ');
}

/* ── filtro por equipe ── */
function teams() {
  const set = new Set((_data?.ranking || []).map(a => (a.teamName || '').trim()).filter(Boolean));
  return [...set];
}
function shortTeam(t) { return t.replace(/^EQUIPE\s+/i, '').toUpperCase(); }
function ocultoNaTV(nome) {
  // sócios (e quem mais a gestão listar na ⚙) nunca aparecem na TV pública
  const alvo = String(nome || '').split(' ')[0].toLowerCase();
  return (_cfg.ocultar_nomes || []).some(n => String(n).split(' ')[0].toLowerCase() === alvo);
}
// ranking do HUB (pontos) — tela geral, duelo e a meta individual (vgvMeta) do placar
function ranked() {
  let list = (_data?.ranking || []).filter(a => !ocultoNaTV(a.agentName));
  if (_team !== 'GERAL') list = list.filter(a => (a.teamName || '').trim() === _team);
  return [...list].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0)).map((a, i) => ({ ...a, pos: i + 1 }));
}

/* ── 🧮 esteira de produtividade do HUB (v87.73) — uma linha por corretor ── */
const normNome = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
function noRanking(row) {
  // a esteira não traz equipe nem meta: herda do ranking do HUB (agentId; senão nome)
  return (_data?.ranking || []).find(a => (row.agentId != null && a.agentId != null && String(a.agentId) === String(row.agentId))
    || normNome(a.agentName) === normNome(row.agentName));
}
function estRows() {
  let list = ((_est && _est.rows) || []).filter(r => !ocultoNaTV(r.agentName));
  if (_team !== 'GERAL') list = list.filter(r => ((noRanking(r) || {}).teamName || '').trim() === _team);
  return list;
}
function rankedEst(cat) {
  const campo = (TELAS_SEC.find(t => t.id === cat) || {}).campo;
  return estRows().map(r => ({ agentName: r.agentName, _n: Number(r[campo]) || 0 }))
    .filter(a => a._n > 0)
    .sort((a, b) => b._n - a._n || normNome(a.agentName).localeCompare(normNome(b.agentName)))
    .map((a, i) => ({ ...a, pos: i + 1 }));
}
function semEsteira() {
  return `<div style="text-align:center;padding:120px 40px">
    <div style="font-size:26px;margin-bottom:12px">⚠️ Sem dados da Esteira de Produtividade do PSM HUB</div>
    <div style="opacity:.6;font-size:16px">${escapeHtml(_estErr || 'carregando…')}</div></div>`;
}
function vazio(ico, msg) {
  return `<div style="text-align:center;padding:140px 40px;opacity:.7">
    <div style="font-size:54px">${ico}</div><div style="font-size:24px;margin-top:10px">${escapeHtml(msg)}</div></div>`;
}

/* ── render ── */
function render() {
  if (!_root) return;
  _tkOn = syncTicker();      // a timeline vive fora do _root; o quadro reserva 1/4 da tela pra ela
  if (!_data) {
    _root.innerHTML = shell(`<div style="text-align:center;padding:120px">
      <div style="font-size:26px;margin-bottom:12px">${_pending ? '🔌 Ponte com o PSM HUB não configurada' : '⚠️ Sem dados do PSM HUB'}</div>
      <div style="opacity:.6;font-size:16px">${escapeHtml(_err || '')}</div></div>`);
    bind(); return;
  }
  let corpo;
  if (_screen === 'criativos') corpo = telaCriativos();
  else if (_screen === 'recado') corpo = telaRecado();
  else if (_screen === 'duelo') corpo = telaDuelo();
  else if (_screen === 'corrida') corpo = telaCorrida();
  else if (_screen === 'premiacoes') corpo = telaPremiacoes();
  else if (_screen === 'placar') corpo = telaPlacar();
  else if (_screen === 'cronograma') corpo = telaCronograma();
  else corpo = telaRanking(_screen === 'vendas' ? null : _screen);
  _root.innerHTML = shell(corpo);
  bind();
}

function telaRanking(cat) {
  if (cat && !_est) return semEsteira();
  const list = cat ? rankedEst(cat) : ranked();
  const podium = list.slice(0, 3);
  const rest = list.slice(3, cat ? 7 : list.length);   // telas extras: top 7 (cabe sem rolar)
  const ord = [podium[1], podium[0], podium[2]].filter(Boolean);   // 2º · 1º · 3º
  const meta = cat ? TELAS_SEC.find(t => t.id === cat) : null;
  return `
    ${meta ? `<div style="text-align:center;padding:18px 0 0">
      <span style="font-size:30px;font-weight:900;color:#facc15">${meta.lbl}</span>
      <div style="font-size:14px;color:#64748b;margin-top:2px">${meta.sub || ''}</div></div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(${Math.max(ord.length, 1)},1fr);gap:18px;padding:22px 26px 6px">
      ${ord.map(a => podiumCard(a, cat)).join('') || '<div style="opacity:.6;text-align:center;padding:60px">Ninguém pontuou ainda.</div>'}
    </div>
    <div style="padding:14px 26px;display:grid;gap:10px">
      ${rest.map(a => rowCard(a, cat)).join('')}
    </div>`;
}

/* ── 🎨 tela: criativos do mês (thumbs do Drive, board criativos_lib) ── */
function telaCriativos() {
  const cs = _criativos.slice(0, 8);
  return `
    <div style="text-align:center;padding:18px 0 0">
      <span style="font-size:30px;font-weight:900;color:#facc15">🎨 Criativos do mês</span>
      <div style="font-size:14px;color:#64748b;margin-top:2px">prontos pra usar — baixe na Biblioteca de Criativos do House</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:20px 26px">
      ${cs.map(c => `
        <div style="border-radius:14px;overflow:hidden;border:1px solid rgba(71,85,105,.4);background:#0d1120">
          <div style="aspect-ratio:4/5;background:#111827">
            <img src="${escapeHtml(driveThumb(driveFileId(c.link)))}" referrerpolicy="no-referrer" loading="lazy"
                 style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">
          </div>
          <div style="padding:10px 12px;font-size:14px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.titulo || '')}</div>
        </div>`).join('')}
    </div>`;
}

/* ── 🏆 tela: premiações/campanhas ativas em formato grande ── */
function telaPremiacoes() {
  const ops = _oport.slice(0, 4);
  const dias = o => { if (!o.expira_em && !o.validade) return null; const d = Math.ceil((new Date(o.expira_em || o.validade) - Date.now()) / 864e5); return isFinite(d) ? d : null; };
  return `
    <div style="text-align:center;padding:18px 0 0">
      <span style="font-size:30px;font-weight:900;color:#facc15">🏆 Premiações & Oportunidades ativas</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(${Math.min(ops.length, 2) || 1},1fr);gap:18px;padding:22px 30px">
      ${ops.map(o => { const d = dias(o); return `
        <div style="border-radius:18px;padding:28px 30px;background:linear-gradient(180deg,rgba(34,197,94,.14),#0d1120 70%);border:2px solid rgba(34,197,94,.5)">
          <div style="font-size:40px">${OP_ICO[o.tipo] || '💡'}</div>
          <div style="font-size:26px;font-weight:800;color:#f8fafc;line-height:1.3;margin-top:10px">${escapeHtml(o.titulo || '')}</div>
          ${o.descricao ? `<div style="font-size:17px;color:#cbd5e1;margin-top:8px;line-height:1.5">${escapeHtml(String(o.descricao).slice(0, 180))}</div>` : ''}
          <div style="display:flex;gap:14px;margin-top:14px;align-items:center">
            ${o.valor_est ? `<span style="font-size:22px;font-weight:900;color:#4ade80">${fmtBRL(o.valor_est)}</span>` : ''}
            ${d != null ? `<span style="font-size:15px;font-weight:800;color:${d <= 2 ? '#f87171' : '#facc15'}">⏳ ${d <= 0 ? 'último dia!' : `expira em ${d}d`}</span>` : ''}
          </div>
        </div>`; }).join('') || '<div style="opacity:.6;text-align:center;padding:60px">Nenhuma premiação ativa.</div>'}
    </div>`;
}

/* ── 🗓️ tela: CRONOGRAMA DA SEMANA (v87.73) — Rotina de Ações Direcionadas,
   transcrita da foto do quadro que o Paulo mandou em 10/set (inclui o que foi
   anotado à caneta: ONE ON ONE de segunda e os TREINOs de quarta e sexta).
   Hoje fica em destaque e o horário em curso ganha o selo AGORA. ── */
const CRONO_DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const CRONO_COR = { reuniao: '#facc15', oneonone: '#a78bfa', ligacao: '#38bdf8', indicacao: '#4ade80',
  treino: '#f472b6', decorado: '#fb923c', market: '#2dd4bf', corujao: '#818cf8', atend: '#22c55e' };
const LIG_AGENDOU = 'Clientes atuais e os que agendaram mas não vieram (foco em encher o sábado → eventos)';
const DECORADO = 'Escala de gravação: 3 corretores no decorado gravam os criativos';
const CORUJAO = 'Leads atuais > listas · 1h → 20min → 1h';
const CRONOGRAMA = [
  { h: '08:30 às 09:30', ini: '08:30', fim: '09:30', dias: [{ t: 'REUNIÃO SEMANAL', k: 'reuniao' }, null, null, null, null, { t: 'MARKETPLACE', k: 'market' }] },
  { h: '10:00 às 11:00', ini: '10:00', fim: '11:00', dias: [{ t: 'ONE ON ONE (2)', k: 'oneonone' }, { t: 'ONE ON ONE (1)', k: 'oneonone' },
    { t: 'ONE ON ONE (1)', k: 'oneonone' }, { t: 'ONE ON ONE (2)', k: 'oneonone' }, null, { t: 'ATENDIMENTOS', k: 'atend' }] },
  { h: '11:00 às 12:00', ini: '11:00', fim: '12:00', dias: [null, { t: 'SALA DE LIGAÇÃO', d: 'Reativação — leads +90 dias', k: 'ligacao' },
    { t: 'SALA DA INDICAÇÃO', d: 'Pedir indicações a clientes ativos e a quem já comprou', k: 'indicacao' },
    { t: 'SALA DE LIGAÇÃO', d: LIG_AGENDOU, k: 'ligacao' }, { t: 'SALA DE LIGAÇÃO', d: LIG_AGENDOU, k: 'ligacao' }, { t: 'ATENDIMENTOS', k: 'atend' }] },
  { h: '14:00 às 14:30', ini: '14:00', fim: '14:30', dias: [null, null, { t: 'TREINO', k: 'treino' }, null, { t: 'TREINO', k: 'treino' }, null] },
  { h: '15:00 às 17:00', ini: '15:00', fim: '17:00', dias: [null, { t: 'VISITAS EM DECORADOS', d: DECORADO, k: 'decorado' },
    { t: 'VISITAS EM DECORADOS', d: DECORADO, k: 'decorado' }, null, null, null] },
  { h: 'Fim de tarde · 17:30 às 18:00', ini: '17:30', fim: '18:00', dias: [null, null, { t: 'MARKETPLACE', k: 'market' }, { t: 'MARKETPLACE', k: 'market' }, null, null] },
  { h: '17:30 às 20:00', ini: '17:30', fim: '20:00', dias: [null, { t: 'CORUJÃO', d: CORUJAO, k: 'corujao' }, null,
    { t: 'CORUJÃO', d: CORUJAO, k: 'corujao' }, null, null] },
];
function telaCronograma() {
  const agora = new Date();
  const hojeIdx = agora.getDay() - 1;                 // seg=0 … sáb=5 (domingo: nenhum)
  const hm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  const th = (dia, i) => `<div style="padding:8px 8px;text-align:center;font-size:17px;font-weight:900;letter-spacing:.06em;border-radius:10px;${i === hojeIdx ? 'background:#eab308;color:#1c1917' : 'background:#141a2c;color:#cbd5e1'}">${dia.toUpperCase()}${i === hojeIdx ? ' · HOJE' : ''}</div>`;
  const cel = (c, i, emCurso) => {
    const hoje = i === hojeIdx;
    if (!c) return `<div style="border-radius:10px;background:${hoje ? 'rgba(234,179,8,.06)' : 'rgba(30,41,59,.25)'};border:1px dashed rgba(71,85,105,.35)"></div>`;
    const cor = CRONO_COR[c.k] || '#94a3b8';
    const agoraAqui = hoje && emCurso;
    return `<div style="border-radius:10px;padding:8px 12px;background:linear-gradient(180deg,${cor}${hoje ? '33' : '1f'},#0d1120);border:${agoraAqui ? `3px solid ${cor}` : `1px solid ${cor}77`};border-left:6px solid ${cor};${agoraAqui ? `box-shadow:0 0 28px ${cor}66;` : ''}${hoje ? '' : 'opacity:.82;'}">
      ${agoraAqui ? `<div style="display:inline-block;font-size:11px;font-weight:900;letter-spacing:.14em;color:#1c1917;background:${cor};padding:2px 8px;border-radius:99px;margin-bottom:4px">● AGORA</div>` : ''}
      <div style="font-size:16px;font-weight:900;color:#f8fafc;line-height:1.2">${escapeHtml(c.t)}</div>
      ${c.d ? `<div style="font-size:13px;color:#cbd5e1;line-height:1.35;margin-top:4px">${escapeHtml(c.d)}</div>` : ''}
    </div>`;
  };
  return `
    <div style="text-align:center;padding:10px 0 0">
      <span style="font-size:30px;font-weight:900;color:#facc15">🗓️ Rotina de Ações Direcionadas</span>
      <div style="font-size:14px;color:#64748b;margin-top:2px">cronograma da semana · hoje em destaque</div>
    </div>
    <div style="display:grid;grid-template-columns:150px repeat(6,1fr);gap:7px;padding:10px 30px 6px">
      <div style="padding:10px 8px;font-size:13px;font-weight:800;letter-spacing:.1em;color:#64748b;align-self:end">HORÁRIO</div>
      ${CRONO_DIAS.map(th).join('')}
      ${CRONOGRAMA.map(l => {
        const emCurso = hm >= l.ini && hm < l.fim;
        return `<div style="display:flex;align-items:center;padding:8px 12px;border-radius:10px;font-size:15px;font-weight:900;${emCurso ? 'background:rgba(234,179,8,.15);color:#facc15' : 'background:#0d1120;color:#e2e8f0'}">${escapeHtml(l.h)}</div>
          ${l.dias.map((c, i) => cel(c, i, emCurso)).join('')}`;
      }).join('')}
    </div>
    <div style="margin:4px 30px 10px;padding:9px 18px;border-radius:12px;background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.35);font-size:16px;font-weight:700;color:#fde68a;text-align:center">
      ⚠️ “Sem rotina, não existe organização &amp; sem organização, não existe nada além do curto prazo.”
    </div>`;
}

/* ── 🎯 tela: PLACAR DO MÊS 3.0 (v87.75) — vendido (esteira) × meta (HUB) ×
   PROJEÇÃO PELO FUNIL. Pedido do Paulo (10/set): "tá tudo 0%… ninguém tá
   projetando nada? não tá produzindo nada? fica contraditório". A projeção era
   só o ritmo do VENDIDO (real ÷ dias × dias do mês): mês sem venda lançada = 0
   pra todo mundo, mesmo com o funil cheio. Agora cada corretor é projetado pelo
   que JÁ PRODUZIU no mês (agendamentos, visitas e pastas no ritmo atual até o
   fim do mês) × conversão real do TIME nos 3 meses fechados anteriores ×
   ticket médio — nunca abaixo do já vendido — e ganha "o que falta pra meta".
   Rendimento individual NÃO vai pra TV (spec): a taxa é sempre a do time. ── */
const ETAPAS_PROJ = [['agendamento', 'agendamentos'], ['atendimento', 'visitas'], ['pasta', 'pastas']];
const PROP_PADRAO_HUB = { agendamento: 8, atendimento: 5, pasta: 5 };   // X por 1 venda — padrão da tela de Metas do HUB
const FOCO_ETAPA = { agendamento: 'encher a agenda (Sala de Ligação e Corujão)',
  atendimento: 'virar agendamento em visita (confirmar na véspera)',
  pasta: 'virar visita em pasta (pedir a documentação já na visita)' };
function calcTaxas(meses) {
  const ok = meses.filter(x => Array.isArray(x.rows));
  const soma = { vendaCount: 0, vendaTotal: 0, agendamento: 0, atendimento: 0, pasta: 0 };
  ok.forEach(x => x.rows.filter(r => !ocultoNaTV(r.agentName))
    .forEach(r => Object.keys(soma).forEach(k => { soma[k] += Number(r[k]) || 0; })));
  const r = {};
  ETAPAS_PROJ.forEach(([k]) => { if (soma.vendaCount > 0 && soma[k] > 0) r[k] = Math.min(1, soma.vendaCount / soma[k]); });
  const historico = Object.keys(r).length > 0;
  if (!historico) ETAPAS_PROJ.forEach(([k]) => { r[k] = 1 / PROP_PADRAO_HUB[k]; });
  return { r, historico, vendas: soma.vendaCount,
           ticket: soma.vendaCount > 0 ? soma.vendaTotal / soma.vendaCount : null,
           meses: ok.map(x => `${String(x.m).padStart(2, '0')}/${String(x.y).slice(2)}`) };
}
function projecao(row, tx, fator) {
  const vend = Number(row.vendaCount) || 0, real = Number(row.vendaTotal) || 0;
  // média do que agendamento, visita e pasta indicam (cada um no ritmo até o fim do mês × conversão do time)
  const est = ETAPAS_PROJ.filter(([k]) => tx.r[k]).map(([k]) => (Number(row[k]) || 0) * fator * tx.r[k]);
  const funil = est.length ? est.reduce((a, b) => a + b, 0) / est.length : 0;
  const vendas = Math.max(vend, funil);
  const ticket = vend > 0 ? real / vend : tx.ticket;
  return { vendas, vgv: ticket ? Math.max(real, vendas * ticket) : real, semTicket: !ticket };
}
function paraMeta(row, meta, tx, fator) {
  if (!meta || !tx.ticket) return null;
  if ((Number(row.vendaTotal) || 0) >= meta) return { batida: true };
  const n = Math.ceil(meta / tx.ticket);                        // vendas que a meta pede no mês
  return { n, itens: [['atendimento', 'visitas'], ['pasta', 'pastas']].filter(([k]) => tx.r[k]).map(([k, lbl]) => {
    const precisa = Math.ceil(n / tx.r[k]), feito = Number(row[k]) || 0;
    return { lbl, faltam: Math.max(0, precisa - feito), noRitmo: feito * fator >= precisa };
  }) };
}
function fmtMi(n) {
  n = n || 0;
  if (n >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
  if (n >= 1e3) return `R$ ${Math.round(n / 1e3).toLocaleString('pt-BR')} mil`;
  return fmtBRL(n);
}
function telaPlacar() {
  if (!_est) return semEsteira();
  const rows = estRows();                            // já respeita o filtro de equipe e os ocultos
  const tx = _taxas || calcTaxas([]);
  const hj = new Date(); const dia = hj.getDate();
  const diasMes = new Date(hj.getFullYear(), hj.getMonth() + 1, 0).getDate();
  const fator = dia > 0 ? diasMes / dia : 1;
  let uteis = 0; const fimMes = new Date(hj.getFullYear(), hj.getMonth() + 1, 0);
  for (let d = new Date(hj); d <= fimMes; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) uteis++; }
  // meta do mês: soma das metas individuais do HUB; fallback meta anual ÷12
  const metaHub = ranked().reduce((t, a) => t + (a.vgvMeta || 0), 0);
  const metaMes = metaHub || ((_metas && _metas.totals && _metas.totals.meta_vgv) ? _metas.totals.meta_vgv / 12 : 0);
  const pessoas = rows.map(r => ({ r, nome: r.agentName, meta: (noRanking(r) || {}).vgvMeta || 0,
                                   real: Number(r.vendaTotal) || 0, vendas: Number(r.vendaCount) || 0, p: projecao(r, tx, fator) }));
  const vendido = pessoas.reduce((t, x) => t + x.real, 0);
  const nVend = pessoas.reduce((t, x) => t + x.vendas, 0);
  const proj = pessoas.reduce((t, x) => t + x.p.vgv, 0);
  const projVendas = pessoas.reduce((t, x) => t + x.p.vendas, 0);
  const pct = metaMes ? Math.round(100 * vendido / metaMes) : 0;
  const pctProj = metaMes ? Math.round(100 * proj / metaMes) : 0;
  const falta = Math.max(0, metaMes - vendido);
  const farol = p => p >= 100 ? '#4ade80' : p >= 70 ? '#facc15' : '#f87171';
  // produção do mês — as colunas da esteira do HUB
  const prod = { prospeccao: 0, qualificacao: 0, agendamento: 0, atendimento: 0, pasta: 0, vendaCount: 0 };
  rows.forEach(r => Object.keys(prod).forEach(k => { prod[k] += Number(r[k]) || 0; }));
  // gargalo do time: a etapa mais longe do que a meta pede, no ritmo atual
  let gargalo = null;
  if (metaMes && tx.ticket && falta > 0) {
    const nTime = Math.ceil(metaMes / tx.ticket);
    ETAPAS_PROJ.filter(([k]) => tx.r[k]).forEach(([k, lbl]) => {
      const precisa = Math.ceil(nTime / tx.r[k]), ritmo = Math.round(prod[k] * fator);
      const g = { k, lbl, precisa, ritmo, pct: ritmo / precisa };
      if (g.pct < 1 && (!gargalo || g.pct < gargalo.pct)) gargalo = g;
    });
  }
  const kpi = (lbl, v, sub, cor) => `
    <div style="background:#0d1120;border:1px solid rgba(71,85,105,.45);border-radius:12px;padding:8px 16px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.1em;color:#64748b">${lbl}</div>
      <div style="font-size:28px;font-weight:900;color:${cor};line-height:1.15">${v}</div>
      <div style="font-size:12px;color:#94a3b8">${sub}</div>
    </div>`;
  const chip = (ico, lbl, n) => `<span style="display:inline-flex;align-items:baseline;gap:6px;background:#0d1120;border:1px solid rgba(71,85,105,.4);border-radius:10px;padding:5px 12px"><span style="font-size:15px">${ico}</span><b style="font-size:19px;color:#f8fafc">${n}</b><span style="font-size:11px;letter-spacing:.06em;color:#64748b;text-transform:uppercase">${lbl}</span></span>`;
  const baseTxt = tx.historico
    ? `conversão real do time em ${tx.meses.join(', ')} (${tx.vendas} venda${tx.vendas === 1 ? '' : 's'})`
    : 'proporções padrão do funil do HUB (sem histórico da esteira)';
  const linhas = pessoas.filter(x => x.meta > 0 || x.real > 0 || x.p.vendas > 0)
    .sort((a, b) => b.p.vgv - a.p.vgv || b.meta - a.meta).slice(0, 9).map(x => {
      const pP = x.meta && !x.p.semTicket ? Math.round(100 * x.p.vgv / x.meta) : null;   // sem ticket não há R$ pra comparar
      const cor = pP != null ? farol(pP) : '#94a3b8';
      const pm = paraMeta(x.r, x.meta, tx, fator);
      const sug = !pm ? '' : pm.batida ? '<span style="color:#4ade80">✅ meta batida</span>'
        : pm.itens.every(i => !i.faltam) ? '<span style="color:#4ade80">✅ produção já cobre a meta</span>'
        : `faltam ${pm.itens.filter(i => i.faltam).map(i => `<b style="color:${i.noRitmo ? '#4ade80' : '#fde047'}">${i.faltam}</b> ${i.lbl}`).join(' · ')}`;
      const wReal = x.meta ? Math.min(100, 100 * x.real / x.meta) : 0;
      const wProj = x.meta ? Math.min(100, 100 * x.p.vgv / x.meta) : 0;
      return `<div style="display:flex;align-items:center;gap:12px;background:rgba(30,41,59,.35);border:1px solid rgba(71,85,105,.35);border-radius:10px;padding:6px 14px">
        <span style="flex:1;min-width:0;font-size:17px;font-weight:800;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(x.nome || '')}</span>
        <span style="width:150px;font-size:13px;color:#94a3b8" title="agendamentos · visitas · pastas no mês">📅 ${Number(x.r.agendamento) || 0} · 🚶 ${Number(x.r.atendimento) || 0} · 🗂 ${Number(x.r.pasta) || 0}</span>
        <span style="width:115px;font-size:13px;color:#cbd5e1">${fmtMi(x.real)} <span style="color:#64748b">· ${x.vendas} vd</span></span>
        <div style="width:210px">
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700"><span style="color:${cor}">→ ${x.p.semTicket ? `${x.p.vendas.toFixed(1).replace('.', ',')} venda(s)` : fmtMi(x.p.vgv)}</span><span style="color:#64748b">${x.meta ? `meta ${fmtMi(x.meta)}` : 'sem meta'}</span></div>
          <div style="position:relative;height:9px;background:#1e293b;border-radius:99px;overflow:hidden">
            <div style="position:absolute;top:0;bottom:0;left:0;width:${wProj}%;background:${cor};opacity:.35"></div>
            <div style="position:absolute;top:0;bottom:0;left:0;width:${wReal}%;background:${cor}"></div>
          </div>
        </div>
        <span style="width:56px;text-align:right;font-size:18px;font-weight:900;color:${cor}">${pP != null ? pP + '%' : '—'}</span>
        <span style="width:250px;font-size:13px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sug}</span>
      </div>`;
    }).join('');
  return `
    <div style="display:flex;align-items:baseline;justify-content:center;gap:12px;padding:10px 0 0">
      <span style="font-size:26px;font-weight:900;color:#facc15">🎯 Placar de ${hj.toLocaleDateString('pt-BR', { month: 'long' })}</span>
      <span style="font-size:13px;color:#64748b">dia ${dia}/${diasMes} · ${uteis} dia(s) útil(eis) restando · ${EST_HUB}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:8px 36px 0">
      ${kpi('VENDIDO', fmtMi(vendido), `${nVend} venda(s) · ${pct}% da meta`, '#f8fafc')}
      ${tx.ticket ? kpi('PROJEÇÃO DO MÊS', fmtMi(proj), `${pctProj}% da meta · pelo funil`, farol(pctProj))
        : kpi('PROJEÇÃO DO MÊS', `≈ ${projVendas.toFixed(1).replace('.', ',')} vendas`, 'pelo funil · sem ticket médio no histórico pra virar R$', '#facc15')}
      ${kpi('META DO MÊS', fmtMi(metaMes), metaHub ? 'soma das metas do HUB' : 'meta anual ÷ 12', '#cbd5e1')}
      ${kpi('FALTA VENDER', falta > 0 ? fmtMi(falta) : '✅', falta > 0 ? `${tx.ticket ? `≈ ${Math.ceil(falta / tx.ticket)} venda(s) · ` : ''}${uteis ? `${fmtMi(falta / uteis)}/dia útil` : ''}` : 'meta batida — agora é recorde', '#fb923c')}
    </div>
    <div style="padding:8px 36px 0">
      <div style="position:relative;height:12px;background:#1e293b;border-radius:99px;overflow:hidden">
        <div style="position:absolute;top:0;bottom:0;left:0;width:${Math.min(100, pctProj)}%;background:${farol(pctProj)};opacity:.3"></div>
        <div style="position:absolute;top:0;bottom:0;left:0;width:${Math.min(100, pct)}%;background:linear-gradient(90deg,#facc15,#4ade80)"></div>
        <div style="position:absolute;top:0;bottom:0;left:${Math.min(100, Math.round(dia / diasMes * 100))}%;width:0;border-left:2px dashed rgba(226,232,240,.6)"></div>
      </div>
      <div style="font-size:11.5px;color:#64748b;margin-top:3px">cheio = vendido · claro = projeção · tracejado = pace do mês (${Math.round(dia / diasMes * 100)}%) — <b style="color:#94a3b8">projeção</b> = agendamentos, visitas e pastas do mês no ritmo atual até o dia ${diasMes} × ${baseTxt}${tx.ticket ? ` × ticket médio ${fmtMi(tx.ticket)}` : ''}; nunca abaixo do já vendido</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 36px 0">
      ${chip('📞', 'prospecções', prod.prospeccao)}${chip('✅', 'qualificações', prod.qualificacao)}${chip('📅', 'agendamentos', prod.agendamento)}${chip('🚶', 'visitas', prod.atendimento)}${chip('🗂', 'pastas', prod.pasta)}${chip('💰', 'vendas', prod.vendaCount)}
      ${gargalo ? `<span style="margin-left:auto;font-size:13px;color:#fed7aa">🎯 <b style="color:#fb923c">Gargalo do time: ${gargalo.lbl}</b> — no ritmo atual o mês fecha com ${gargalo.ritmo} de ${gargalo.precisa} · foco: ${FOCO_ETAPA[gargalo.k]}</span>` : ''}
    </div>
    <div style="padding:8px 36px 10px;display:grid;gap:5px">
      <div style="font-size:12px;font-weight:800;color:#94a3b8;letter-spacing:.08em">INDIVIDUAIS — 📅 agendamentos · 🚶 visitas · 🗂 pastas do mês · vendido · → projeção × meta (HUB) · o que falta pra meta (verde = já no ritmo)</div>
      ${linhas || '<div style="color:#64748b;font-size:14px">nenhum corretor com produção, venda ou meta no mês</div>'}
    </div>`;
}

function podiumCard(a, cat) {
  const first = a.pos === 1;
  const style = a.pos === 1
    ? 'border:2px solid #eab308;background:radial-gradient(120% 120% at 50% 0%,rgba(234,179,8,.14),rgba(10,13,22,.6));box-shadow:0 0 40px rgba(234,179,8,.25)'
    : a.pos === 2
      ? 'border:1px solid #475569;background:rgba(30,41,59,.45)'
      : 'border:1px solid #b45309;background:rgba(69,26,3,.35)';
  const posColor = a.pos === 1 ? '#facc15' : a.pos === 3 ? '#fb923c' : '#e2e8f0';
  return `
    <div style="border-radius:16px;padding:${first ? '26px' : '22px'} 18px;text-align:center;${style}">
      <div style="font-size:${first ? '30px' : '24px'};font-weight:800;color:${posColor}">${a.pos}°</div>
      <div style="font-size:${first ? '28px' : '22px'};font-weight:700;color:#f1f5f9;margin-top:2px">${escapeHtml(a.agentName || '—')}</div>
      <div style="font-size:${first ? '84px' : '58px'};font-weight:900;line-height:1.1;color:${posColor}">${cat ? a._n : fmtPts(a.totalPoints)}</div>
      <div style="font-size:${cat ? '15px' : '12px'};letter-spacing:.08em;color:${posColor};opacity:.85">${cat ? (TELAS_SEC.find(t => t.id === cat) || {}).un || '' : 'pontos'}</div>
      ${a.vgvReal ? `<div style="margin-top:6px;color:#86efac;font-weight:700">VGV ${fmtBRL(a.vgvReal)}</div>` : ''}
      <div style="height:1px;background:rgba(148,163,184,.25);margin:14px 40px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:26px">${cat ? '' : badgesOf(a) + ' ' + streakChip(a)}</div>
    </div>`;
}

function streakChip(a) {
  const d = _ritmo[String(a.agentName || '').split(' ')[0].toLowerCase()];
  if (d == null) return '';
  if (d <= 7) return `<span style="padding:3px 10px;border-radius:99px;font-size:12px;font-weight:800;background:rgba(34,197,94,.16);color:#4ade80">🔥 vendeu há ${d}d</span>`;
  if (d >= 21) return `<span style="padding:3px 10px;border-radius:99px;font-size:12px;font-weight:800;background:rgba(239,68,68,.14);color:#f87171">⏰ ${d}d sem venda</span>`;
  return '';
}

function rowCard(a, cat) {
  return `
    <div style="display:flex;align-items:center;gap:16px;background:rgba(30,41,59,.35);border:1px solid rgba(71,85,105,.4);border-radius:12px;padding:14px 20px">
      <div style="font-size:20px;font-weight:800;color:#94a3b8;width:44px">${a.pos}°</div>
      <div style="font-size:20px;font-weight:700;color:#f1f5f9">${escapeHtml(a.agentName || '—')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${cat ? '' : badgesOf(a) + ' ' + streakChip(a)}</div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:26px;font-weight:900;color:#f1f5f9;line-height:1">${cat ? a._n : fmtPts(a.totalPoints)}</div>
        <div style="font-size:11px;color:#64748b">${cat ? (TELAS_SEC.find(t => t.id === cat) || {}).un || '' : `pts${a.vgvReal ? ` · VGV ${fmtBRL(a.vgvReal)}` : ''}`}</div>
      </div>
    </div>`;
}

/* ── 📣 TIMELINE DE RECADOS (v87.75, Paulo 10/set: "1/4 da tela") ─────────
   Faixa FIXA de 25% da altura, fora do _root: o corpo troca a cada tela e a
   faixa segue rodando (antes o letreiro era redesenhado a cada 20s e voltava
   pro começo). Só é refeita quando os itens mudam. Os recados da Timeline
   voltam a cada 4 itens — a fila tem ~55 oportunidades do Radar, e sem isso um
   recado passava 1× a cada ~10 min; das oportunidades, só as 12 primeiras. */
const OP_ICO = { lead: '🎯', imovel: '🏠', parceria: '🤝', investidor: '💼', outro: '📌' };
const TK_ALTURA = '25vh';
const TK_OPORT_MAX = 12;
let _tkItems = [], _tkSig = '';
function tickerItems() {
  const rec = _recados.map(r => ({ kind: 'recado', tag: 'RECADO', ico: '📣', cor: r.cor || '#eab308', texto: r.texto || '', extra: r.autor || '' }));
  const outros = [
    ..._atividade.slice(0, 6).map(a => ({ kind: 'atividade', tag: 'ATIVIDADE', ico: '⚡', cor: '#38bdf8', texto: `${a.nome} · ${a.lbl}`, extra: a.hora })),
    ..._oport.slice(0, TK_OPORT_MAX).map(o => ({ kind: 'oportunidade', tag: 'OPORTUNIDADE', ico: OP_ICO[o.tipo] || '💡', cor: '#22c55e',
      texto: o.titulo || '', extra: o.valor_est ? fmtBRL(o.valor_est) : '', desc: o.descricao || '' })),
  ];
  const its = [...rec];
  outros.forEach((x, i) => { its.push(x); if (rec.length && (i + 1) % 4 === 0 && i < outros.length - 1) its.push(...rec); });
  return its;
}
function tkCard(i, idx) {
  return `
    <button class="rh-item" data-tk="${idx}" style="flex:none;display:flex;flex-direction:column;justify-content:center;gap:1vh;height:20.5vh;min-width:22vw;max-width:42vw;margin-right:1.6vw;padding:1.4vh 1.8vw;border-radius:18px;white-space:normal;text-align:left;cursor:pointer;border:2px solid ${i.cor}88;background:linear-gradient(180deg,${i.cor}33,${i.cor}0d);color:#f1f5f9;font-family:inherit">
      <span style="display:flex;align-items:center;gap:.8vw;white-space:nowrap">
        <span style="font-size:3.6vh;line-height:1">${i.ico}</span>
        <span style="font-size:1.5vh;font-weight:900;letter-spacing:.14em;color:${i.cor};background:${i.cor}22;padding:.4vh .8vw;border-radius:99px">${i.tag}</span>
        ${i.extra ? `<span style="font-size:2.1vh;font-weight:800;color:${i.kind === 'oportunidade' ? '#4ade80' : '#94a3b8'}">${escapeHtml(i.extra)}</span>` : ''}
      </span>
      <span style="font-size:3vh;font-weight:800;line-height:1.2;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(i.texto)}</span>
    </button>`;
}
function tkEstilo() {
  if (document.getElementById('rh-tk-style')) return;
  const st = document.createElement('style');
  st.id = 'rh-tk-style';
  st.textContent = `@keyframes rhTkMove { from { transform:translateX(0) } to { transform:translateX(-50%) } }
    @keyframes rhTkLive { 0%,100% { opacity:1 } 50% { opacity:.35 } }
    #rh-timeline:hover .rh-track { animation-play-state:paused; }
    @media (prefers-reduced-motion: reduce) { #rh-timeline .rh-track { animation:none !important } }`;
  document.head.appendChild(st);
}
function syncTicker() {
  const its = tickerItems();
  let el = document.getElementById('rh-timeline');
  if (!its.length) { el?.remove(); _tkItems = []; _tkSig = ''; return false; }
  const sig = JSON.stringify(its.map(i => [i.kind, i.texto, i.extra]));
  if (el && sig === _tkSig) return true;         // mesma fila: não mexe (a faixa segue de onde está)
  _tkItems = its; _tkSig = sig;
  tkEstilo();
  if (!el) {
    el = document.createElement('div');
    el.id = 'rh-timeline';
    el.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${TK_ALTURA};z-index:55;display:flex;background:#0d1120;border-top:2px solid rgba(234,179,8,.4);color:#e2e8f0;font-family:inherit;overflow:hidden`;
    el.addEventListener('click', e => { const b = e.target.closest('[data-tk]'); const it = b && _tkItems[+b.dataset.tk]; if (it) showTickerItem(it); });
    document.body.appendChild(el);
  }
  const chunk = its.map(tkCard).join('');
  el.innerHTML = `
    <div style="flex:none;width:12vw;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.2vh;background:linear-gradient(90deg,#1c1917,#0d1120);border-right:2px solid rgba(234,179,8,.4)">
      <span style="font-size:6vh;line-height:1">📣</span>
      <span style="font-size:2.6vh;font-weight:900;letter-spacing:.12em;color:#facc15">RECADOS</span>
      <span style="display:flex;align-items:center;gap:.5vw;font-size:1.5vh;font-weight:800;letter-spacing:.16em;color:#fca5a5"><span style="width:1.1vh;height:1.1vh;border-radius:99px;background:#ef4444;animation:rhTkLive 1.4s ease infinite"></span>AO VIVO</span>
    </div>
    <div style="flex:1;min-width:0;display:flex;align-items:center;overflow:hidden">
      <div class="rh-track" style="display:flex;width:max-content;will-change:transform;animation:rhTkMove 60s linear infinite">
        <div style="display:flex;padding-left:1.6vw">${chunk}</div><div style="display:flex;padding-left:1.6vw">${chunk}</div>
      </div>
    </div>`;
  // velocidade constante (~7% da altura da tela por segundo), qualquer tamanho de fila
  const tr = el.querySelector('.rh-track');
  tr.style.animationDuration = `${Math.max(20, Math.round((tr.scrollWidth / 2) / (window.innerHeight * 0.07)))}s`;
  return true;
}

/* overlay grande (pra TV): clique no item amplia; Esc/✕/fora fecha */
function showTickerItem(i) {
  closeTickerOverlay();
  document.querySelector('.rh-track')?.style.setProperty('animation-play-state', 'paused');
  const ov = document.createElement('div');
  ov.id = 'rh-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(5,8,15,.88);display:flex;align-items:center;justify-content:center;padding:6vh 6vw';
  ov.innerHTML = `
    <div style="max-width:900px;width:100%;border-radius:22px;padding:44px 48px;background:linear-gradient(180deg,${i.cor}24,#0d1120 60%);border:2px solid ${i.cor}88;box-shadow:0 0 80px ${i.cor}33;text-align:center;animation:rhPop .25s ease">
      <div style="font-size:56px">${i.ico}</div>
      <div style="font-size:13px;font-weight:900;letter-spacing:.16em;color:${i.cor};margin-top:6px">${i.tag}</div>
      <div style="font-size:34px;font-weight:800;color:#f8fafc;line-height:1.3;margin-top:14px">${escapeHtml(i.texto)}</div>
      ${i.desc ? `<div style="font-size:19px;color:#cbd5e1;line-height:1.5;margin-top:12px">${escapeHtml(i.desc)}</div>` : ''}
      ${i.extra ? `<div style="font-size:26px;font-weight:900;color:${i.kind === 'oportunidade' ? '#4ade80' : '#94a3b8'};margin-top:12px">${escapeHtml(i.extra)}</div>` : ''}
      <div style="display:flex;gap:12px;justify-content:center;margin-top:26px">
        ${i.kind === 'oportunidade' ? `<button id="rh-ov-go" style="cursor:pointer;border:0;border-radius:12px;padding:12px 22px;font-size:16px;font-weight:800;background:#22c55e;color:#052e16">💡 Abrir Oportunidades</button>` : ''}
        <button id="rh-ov-x" style="cursor:pointer;border:1px solid rgba(148,163,184,.4);border-radius:12px;padding:12px 22px;font-size:16px;font-weight:700;background:transparent;color:#e2e8f0">Fechar ✕</button>
      </div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeTickerOverlay(); });
  document.body.appendChild(ov);
  document.getElementById('rh-ov-x')?.addEventListener('click', closeTickerOverlay);
  document.getElementById('rh-ov-go')?.addEventListener('click', () => { closeTickerOverlay(); location.hash = '#/oportunidades'; });
  document.addEventListener('keydown', escCloseOverlay);
}
function escCloseOverlay(e) { if (e.key === 'Escape') closeTickerOverlay(); }
function closeTickerOverlay() {
  document.getElementById('rh-overlay')?.remove();
  document.removeEventListener('keydown', escCloseOverlay);
  document.querySelector('.rh-track')?.style.removeProperty('animation-play-state');
}

function modoFechamento() {
  const h = new Date();
  const fim = new Date(h.getFullYear(), h.getMonth() + 1, 0);
  const diasRestantes = fim.getDate() - h.getDate();
  if (diasRestantes > 6) return '';
  let uteis = 0;
  for (let d = new Date(h); d <= fim; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) uteis++; }
  const sv = (_ov && _ov.sales) || {};
  const metaMes = (_metas && _metas.totals && _metas.totals.meta_vgv) ? _metas.totals.meta_vgv / 12 : 0;
  const falta = Math.max(0, metaMes - (sv.vgv_mes || 0));
  const porDia = uteis > 0 ? falta / uteis : falta;
  return `
    <div style="display:flex;align-items:center;justify-content:center;gap:16px;padding:9px 20px;background:linear-gradient(90deg,#7f1d1d,#9a3412);border-bottom:1px solid rgba(251,146,60,.5)">
      <span style="font-size:15px;font-weight:900;letter-spacing:.14em;color:#fecaca">🔥 MODO FECHAMENTO</span>
      <span style="font-size:15px;font-weight:700;color:#fed7aa">faltam <b>${uteis}</b> dia(s) útil(eis) no mês</span>
      ${metaMes && falta > 0 ? `<span style="font-size:15px;font-weight:800;color:#fff">precisamos de <b style="color:#fde047">${fmtBRL(porDia)}/dia</b> pra bater a meta</span>`
        : metaMes ? '<span style="font-size:15px;font-weight:800;color:#86efac">✅ meta do mês batida — agora é recorde!</span>' : ''}
    </div>`;
}

function shell(body) {
  const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const telaMeta = TELAS_SEC.find(t => t.id === _screen);
  const titulo = telaMeta ? telaMeta.lbl
    : (_data ? `Ranking — ${meses[_data.month] || ''} ${_data.year}` : 'Ranking — PSM HUB');
  const CICLO = CICLO_ATUAL();
  const dots = `<span style="display:inline-flex;gap:5px;margin-left:10px;align-items:center">
    ${CICLO.map((id, i) => `<span style="width:8px;height:8px;border-radius:99px;background:${i === ((_secIdx % CICLO.length) + CICLO.length) % CICLO.length ? '#facc15' : '#334155'}"></span>`).join('')}</span>`;
  const tabs = ['GERAL', ...teams()];
  return `
  <style>
    body.tv-mode .app-sidebar, body.tv-mode .app-header { display:none !important; }
    body.tv-mode .app-shell { grid-template-columns:1fr; grid-template-rows:1fr; grid-template-areas:"main"; }
    body.tv-mode .app-main { padding:0; }
    @keyframes rhLive { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(239,68,68,.6) } 50% { opacity:.5; box-shadow:0 0 0 6px rgba(239,68,68,0) } }
    @keyframes rhPop { from { transform:scale(.9); opacity:0 } to { transform:scale(1); opacity:1 } }
    @keyframes rhFade { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
    @keyframes rhBar { from { transform:scaleX(0) } to { transform:scaleX(1) } }
    .rh-body { animation:rhFade .45s ease; }
    .rh-bar { transform-origin:left; animation:rhBar ${SLIDE_MS()}ms linear; }
    .rh-live { animation:rhLive 1.4s ease infinite; }
    .rh-item { transition:transform .15s ease, box-shadow .15s ease; }
    .rh-item:hover { transform:scale(1.03); box-shadow:0 0 22px rgba(250,204,21,.25); }
    @media (prefers-reduced-motion: reduce) { .rh-live { animation:none !important } }
  </style>
  <div style="position:fixed;inset:0 0 ${_tkOn ? TK_ALTURA : '0'} 0;z-index:50;background:#0a0d16;color:#e2e8f0;display:flex;flex-direction:column;overflow:hidden;font-family:inherit">
    <div style="display:flex;align-items:center;gap:18px;padding:14px 26px;background:#0d1120;border-bottom:1px solid rgba(71,85,105,.3);position:sticky;top:0;z-index:2">
      <div style="font-weight:800;font-size:18px;color:#f8fafc">🏆 PSM HUB</div>
      <div style="color:#475569">|</div>
      <div style="font-weight:600;font-size:16px;color:#cbd5e1">${titulo}</div>${dots}
      <div style="display:flex;gap:4px;background:rgba(30,41,59,.6);border-radius:10px;padding:4px;margin-left:14px">
        ${tabs.map(t => {
          const key = t === 'GERAL' ? 'GERAL' : t;
          const on = _team === key;
          return `<button data-team="${escapeHtml(key)}" style="border:0;cursor:pointer;padding:6px 14px;border-radius:8px;font-weight:700;font-size:12px;letter-spacing:.05em;background:${on ? '#eab308' : 'transparent'};color:${on ? '#1c1917' : '#94a3b8'}">${escapeHtml(t === 'GERAL' ? 'GERAL' : shortTeam(t))}</button>`;
        }).join('')}
      </div>
      <div style="margin-left:auto;text-align:right">
        <div id="rh-clock" style="font-size:30px;font-weight:800;color:#facc15;font-variant-numeric:tabular-nums">${nowStr()}</div>
        <div id="rh-upd" style="font-size:11px;color:#64748b">${_fetchedAt ? `Atualizado às ${_fetchedAt.toLocaleTimeString('pt-BR')}` : '&nbsp;'}</div>
      </div>
      ${_cfgCanEdit ? '<button id="rh-cfg" title="Configurar a TV (gestão)" style="border:1px solid rgba(148,163,184,.35);background:transparent;color:#cbd5e1;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:16px">⚙️</button>' : ''}
      <button id="rh-prev" title="Tela anterior (←)" style="border:1px solid rgba(148,163,184,.35);background:transparent;color:#cbd5e1;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:18px;font-weight:900">‹</button>
      <button id="rh-next" title="Próxima tela (→)" style="border:1px solid rgba(234,179,8,.5);background:rgba(234,179,8,.12);color:#facc15;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:18px;font-weight:900">›</button>
      <button id="rh-fs" title="Tela cheia" style="border:1px solid rgba(148,163,184,.35);background:transparent;color:#cbd5e1;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:16px">⛶</button>
    </div>
    ${modoFechamento()}
    <div class="rh-bar" style="height:3px;background:linear-gradient(90deg,#facc15,#fb923c);flex:none"></div>
    <div class="rh-body" style="flex:1;min-height:0;overflow:auto">${body}</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 26px;background:#0d1120;border-top:1px solid rgba(71,85,105,.3)">
      ${Object.values(BADGES).map(b => `<span style="padding:3px 10px;border-radius:99px;font-size:11px;background:${b.bg};color:${b.fg}">${b.ab} <b>${b.lbl}</b></span>`).join('')}
      <span style="font-size:11px;color:#475569">💲 VGV Real</span>
      <span style="margin-left:auto;font-size:11px;color:#475569">Fonte desta tela: ${FONTE_TELA[_screen] || 'House PSM'} · atualização automática a cada 30 segundos</span>
    </div>
  </div>`;
}

function bind() {
  sounds.initSounds?.();
  document.getElementById('rh-cfg')?.addEventListener('click', abrirConfig);
  document.getElementById('rh-prev')?.addEventListener('click', () => mudaTela(-1));
  document.getElementById('rh-next')?.addEventListener('click', () => mudaTela(1));
  if (!window._rhKeys) {
    window._rhKeys = true;
    document.addEventListener('keydown', e => {
      if (!document.body.classList.contains('tv-mode')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); mudaTela(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); mudaTela(-1); }
    });
  }
  _root.querySelectorAll('[data-team]').forEach(b => b.addEventListener('click', () => { _team = b.dataset.team; _rotPauseAte = Date.now() + 90000; render(); }));
  document.getElementById('rh-fs')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

/* ── ⚙️ engrenagem: modal de configuração da TV (gestão, salva no banco) ── */
const CFG_LBL = { recado: '📣 Recado da gestão', duelo: '⚔️ Duelo pela liderança', doc: '🗂 Ranking de Pastas',
  aten: '🚶 Ranking de Visitas', prosp: '📞 Ranking de Prospecções', corrida: '🏁 Corrida da Meta',
  premiacoes: '🏆 Premiações', placar: '🎯 Placar do mês', cronograma: '🗓️ Cronograma da semana',
  criativos: '🎨 Criativos do mês' };
function abrirConfig() {
  _rotPauseAte = Date.now() + 600000;   // pausa a rotação enquanto configura
  const todas = [..._cfg.telas, ...Object.keys(CFG_LBL).filter(t => !_cfg.telas.includes(t))];
  const ligadas = new Set(_cfg.telas);
  const ov = document.createElement('div');
  ov.id = 'rh-cfgov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:95;background:rgba(5,8,15,.9);display:flex;align-items:center;justify-content:center;padding:4vh';
  const linha = (t) => `
    <div class="rhc-row" data-tela="${t}" style="display:flex;align-items:center;gap:12px;background:#141a2c;border:1px solid rgba(71,85,105,.4);border-radius:10px;padding:10px 14px">
      <input type="checkbox" class="rhc-on" ${ligadas.has(t) ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer">
      <span style="flex:1;font-size:16px;font-weight:700;color:#e2e8f0">${CFG_LBL[t] || t}</span>
      <button class="rhc-up" style="border:1px solid rgba(148,163,184,.3);background:transparent;color:#cbd5e1;border-radius:6px;padding:4px 10px;cursor:pointer">▲</button>
      <button class="rhc-dn" style="border:1px solid rgba(148,163,184,.3);background:transparent;color:#cbd5e1;border-radius:6px;padding:4px 10px;cursor:pointer">▼</button>
    </div>`;
  ov.innerHTML = `
    <div style="max-width:620px;width:100%;max-height:92vh;overflow:auto;border-radius:18px;background:#0d1120;border:1px solid rgba(71,85,105,.5);padding:26px 28px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:22px;font-weight:900;color:#facc15">⚙️ Configurar a Arena TV</span>
        <button id="rhc-x" style="margin-left:auto;border:0;background:transparent;color:#94a3b8;font-size:20px;cursor:pointer">✕</button>
      </div>
      <div style="display:flex;gap:18px;margin:18px 0">
        <label style="flex:1;font-size:13px;color:#94a3b8">Segundos por tela
          <input id="rhc-slide" type="number" min="8" max="120" value="${_cfg.slide_s}" style="width:100%;margin-top:4px;background:#141a2c;border:1px solid rgba(71,85,105,.5);border-radius:8px;color:#f8fafc;padding:8px 10px;font-size:16px"></label>
      </div>
      <label style="display:block;font-size:13px;color:#94a3b8;margin-bottom:12px">🙈 Ocultar da TV (nomes separados por vírgula — sócios ficam de fora dos rankings)
        <input id="rhc-ocultar" value="${escapeHtml((_cfg.ocultar_nomes || []).join(', '))}" style="width:100%;margin-top:4px;background:#141a2c;border:1px solid rgba(71,85,105,.5);border-radius:8px;color:#f8fafc;padding:8px 10px;font-size:15px"></label>
      <div style="font-size:13px;color:#94a3b8;margin-bottom:8px">Telas extras — ligue/desligue e arraste a ordem (▲▼). O ranking geral é fixo e abre cada volta (1× por volta); tela sem conteúdo é pulada.</div>
      <div id="rhc-list" style="display:grid;gap:8px">${todas.map(linha).join('')}</div>
      <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:20px">
        <button id="rhc-cancel" style="border:1px solid rgba(148,163,184,.4);background:transparent;color:#e2e8f0;border-radius:10px;padding:10px 20px;font-size:15px;font-weight:700;cursor:pointer">Cancelar</button>
        <button id="rhc-save" style="border:0;background:#eab308;color:#1c1917;border-radius:10px;padding:10px 22px;font-size:15px;font-weight:900;cursor:pointer">Salvar pra todas as TVs</button>
      </div>
      <div id="rhc-msg" style="font-size:13px;color:#f87171;margin-top:8px;min-height:16px"></div>
    </div>`;
  document.body.appendChild(ov);
  const fecha = () => { ov.remove(); _rotPauseAte = Date.now() + 5000; };
  ov.addEventListener('click', e => { if (e.target === ov) fecha(); });
  ov.querySelector('#rhc-x').onclick = fecha;
  ov.querySelector('#rhc-cancel').onclick = fecha;
  ov.querySelectorAll('.rhc-up, .rhc-dn').forEach(b => b.onclick = () => {
    const row = b.closest('.rhc-row');
    if (b.classList.contains('rhc-up') && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    if (b.classList.contains('rhc-dn') && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
  });
  ov.querySelector('#rhc-save').onclick = async () => {
    const telas = [...ov.querySelectorAll('.rhc-row')].filter(r => r.querySelector('.rhc-on').checked).map(r => r.dataset.tela);
    const cfg = { slide_s: Number(ov.querySelector('#rhc-slide').value) || 20, telas,
                  ocultar_nomes: String(ov.querySelector('#rhc-ocultar').value || '').split(',').map(x => x.trim()).filter(Boolean) };
    if (!telas.length) { ov.querySelector('#rhc-msg').textContent = 'Ligue ao menos uma tela extra.'; return; }
    ov.querySelector('#rhc-save').disabled = true;
    try {
      const r = await api.request('/api/v3/arena/tv2_config', { method: 'POST', body: { config: cfg } });
      if (r && r.ok) { _cfg = r.config; _cfgAt = Date.now(); fecha(); _secIdx = 0; _screen = 'vendas'; render(); agendaRotacao(); }
      else { ov.querySelector('#rhc-msg').textContent = (r && r.error) || 'erro ao salvar'; ov.querySelector('#rhc-save').disabled = false; }
    } catch (e) { ov.querySelector('#rhc-msg').textContent = e.message; ov.querySelector('#rhc-save').disabled = false; }
  };
}

/* ── utils ── */
function nowStr() { return new Date().toLocaleTimeString('pt-BR'); }
function fmtPts(n) { return (n || 0).toLocaleString('pt-BR'); }
function fmtBRL(n) { return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
