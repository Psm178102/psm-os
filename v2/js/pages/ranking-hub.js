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
const SLIDE_MS = 20000;
/* v87.23 (pacote 'vida imediata' + corrida, aprovado pelo Paulo): duelo pela
   liderança e Corrida da Meta entram no ciclo; voz no gongo; streaks/secas;
   Modo Fechamento na última semana; abertura do dia às 8h30; ticker de
   atividade ao vivo pelos DELTAS de pontos do HUB entre polls (sem backend). */
/* v87.24 (Paulo): criativos SAI do ciclo; entra 📣 RECADO em tela cheia (recados
   da Timeline marcados c/ 📺 pelo gestor); navegação manual ‹ › + setas do
   teclado/controle; rankings mostram QUANTIDADE real + pontos em sequência. */
const CICLO = ['vendas', 'recado', 'duelo', 'doc', 'aten', 'prosp', 'vendas', 'corrida', 'premiacoes', 'placar'];
const CELEB_MS = 10000;
const TELAS_SEC = [
  { id: 'doc',        lbl: '🗂 Ranking de Pastas',       sub: 'quantidade de pastas/propostas no HUB · pontos em sequência', un: 'pasta(s)' },
  { id: 'aten',       lbl: '🚶 Ranking de Visitas',      sub: 'quantidade de visitas realizadas no HUB · pontos em sequência', un: 'visita(s)' },
  { id: 'prosp',      lbl: '📞 Ranking de Atendimentos', sub: 'quantidade de prospecções/atendimentos no HUB · pontos em sequência', un: 'atendimento(s)' },
  { id: 'criativos',  lbl: '🎨 Criativos do mês' },
  { id: 'premiacoes', lbl: '🏆 Premiações ativas' },
  { id: 'placar',     lbl: '🎯 Placar do mês' },
  { id: 'duelo',      lbl: '⚔️ Duelo pela liderança' },
  { id: 'corrida',    lbl: '🏁 Corrida da Meta' },
  { id: 'recado',     lbl: '📣 Recado da gestão' },
];

let _root = null, _data = null, _err = '', _pending = false;
let _team = 'GERAL';
let _pollTimer = null, _clock = null;
let _fetchedAt = null;
let _recados = [], _oport = [], _sig = '';
let _screen = 'vendas', _secIdx = 0, _rotTimer = null, _rotPauseAte = 0;
let _criativos = [], _ov = null, _metas = null, _extraAt = 0;
let _prevVendas = null, _celeb = null, _celebTimer = null;
let _ritmo = {}, _ritmoAt = 0;
let _recTvIdx = 0;               // alterna entre recados 📺 a cada passada        // streaks/secas (GC ritmo_vendas, 1º nome → dias)
let _atividade = [];                  // ticker ao vivo: deltas de pontos entre polls

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
    if (id === 'recado' && !_recados.some(r => r.tv)) continue;
    if (id === 'premiacoes' && !_oport.length) continue;
    if (id === 'criativos' && !_criativos.length) continue;
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
    // avança no ciclo pulando telas sem conteúdo (sem recado 📺/premiação/criativo)
    for (let t = 0; t < CICLO.length; t++) {
      _secIdx = (_secIdx + 1) % CICLO.length;
      const id = CICLO[_secIdx];
      if (id === 'recado' && !_recados.some(r => r.tv)) continue;
      if (id === 'premiacoes' && !_oport.length) continue;
      if (id === 'criativos' && !_criativos.length) continue;
      _screen = id; break;
    }
    render();
    agendaRotacao();
  }, SLIDE_MS());
}

async function reload() {
  const [r, rec, op] = await Promise.all([
    api.request('/api/v3/psmhub/ranking').catch(e => ({ _err: e.message })),
    api.request('/api/v3/timeline/recados').catch(() => null),
    api.request('/api/v3/crm_extra/oportunidades').catch(() => null),
  ]);
  if (r && r.ok) { _data = r.data; _fetchedAt = new Date(); _err = ''; }
  else if (r) { _err = r.error || r._err || 'PSM HUB indisponível'; if (r.pending_config) _pending = true; }
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
    _data.ranking.forEach(a => {
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
  const sig = JSON.stringify([_data, _recados.map(x => x.id + (x.texto || '')), _oport.map(x => x.id + (x.titulo || '')), _err]);
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
  if (!tvs.length) return telaRanking(null);
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
  if (!a || !b) return telaRanking(null);
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
function telaCorrida() {
  const pc = ((_metas && _metas.por_corretor) || []).filter(c => !c.inativo && (c.meta_vgv || 0) > 0);
  if (!pc.length) return telaPlacar();
  const paceAno = Math.round(((Date.now() - new Date(new Date().getFullYear(), 0, 1)) / 864e5) / 365 * 100);
  const lanes = pc.map(c => ({ ...c, pct: Math.min(120, Math.round((c.vgv_atingido || 0) / c.meta_vgv * 100)) }))
    .sort((a, b2) => b2.pct - a.pct).slice(0, 8);
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
function catPts(a, cat) {
  return (a.ruleBreakdown || []).filter(rb => classifyRule(rb) === cat)
    .reduce((t, rb) => t + (rb.totalPoints || 0), 0);
}
function catCount(a, cat) {
  return (a.ruleBreakdown || []).filter(rb => classifyRule(rb) === cat)
    .reduce((t, rb) => t + (rb.count || 0), 0);
}
function ranked(cat) {
  let list = _data?.ranking || [];
  if (_team !== 'GERAL') list = list.filter(a => (a.teamName || '').trim() === _team);
  const val = a => cat ? catPts(a, cat) : (a.totalPoints || 0);
  list = [...list].sort((a, b) => (cat ? catCount(b, cat) : val(b)) - (cat ? catCount(a, cat) : val(a)) || val(b) - val(a));
  if (cat) list = list.filter(a => catCount(a, cat) > 0 || val(a) > 0);
  return list.map((a, i) => ({ ...a, pos: i + 1, _val: val(a), _n: cat ? catCount(a, cat) : null }));
}

/* ── render ── */
function render() {
  if (!_root) return;
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
  else corpo = telaRanking(_screen === 'vendas' ? null : _screen);
  _root.innerHTML = shell(corpo);
  bind();
}

function telaRanking(cat) {
  const list = ranked(cat);
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

/* ── 🎯 tela: placar do mês (VGV × meta + destaques) ── */
function telaPlacar() {
  const sv = (_ov && _ov.sales) || {};
  const meta = (_metas && _metas.totals) || {};
  const metaMes = meta.meta_vgv ? meta.meta_vgv / 12 : 0;
  const pct = metaMes ? Math.min(100, Math.round(100 * (sv.vgv_mes || 0) / metaMes)) : 0;
  const topVgv = ranked().slice().sort((a, b) => (b.vgvReal || 0) - (a.vgvReal || 0))[0];
  const big = (lbl, val, cor) => `
    <div style="background:#0d1120;border:1px solid rgba(71,85,105,.4);border-radius:16px;padding:24px;text-align:center">
      <div style="font-size:14px;letter-spacing:.12em;color:#64748b;text-transform:uppercase">${lbl}</div>
      <div style="font-size:44px;font-weight:900;color:${cor || '#f8fafc'};margin-top:6px">${val}</div>
    </div>`;
  return `
    <div style="text-align:center;padding:18px 0 0">
      <span style="font-size:30px;font-weight:900;color:#facc15">🎯 Placar de ${new Date().toLocaleDateString('pt-BR', { month: 'long' })}</span>
    </div>
    <div style="padding:24px 40px">
      <div style="display:flex;justify-content:space-between;font-size:16px;color:#cbd5e1;font-weight:700">
        <span>VGV do mês: ${fmtBRL(sv.vgv_mes || 0)}</span><span>${metaMes ? 'meta ÷12: ' + fmtBRL(metaMes) : ''}</span>
      </div>
      <div style="height:26px;background:#1e293b;border-radius:99px;margin-top:8px;overflow:hidden">
        <div style="height:100%;width:${pct}%;border-radius:99px;background:linear-gradient(90deg,#facc15,#4ade80);transition:width 1s"></div>
      </div>
      <div style="text-align:center;font-size:22px;font-weight:900;color:#facc15;margin-top:6px">${pct}% da meta do mês</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:6px 40px">
      ${big('Vendas no mês', sv.vendas_mes || 0)}
      ${big('Vendas · 30 dias', sv.vendas_30d || 0)}
      ${big('Maior VGV do ranking', topVgv && topVgv.vgvReal ? `${escapeHtml(topVgv.agentName || '')}` : '—', '#4ade80')}
    </div>
    ${topVgv && topVgv.vgvReal ? `<div style="text-align:center;font-size:20px;font-weight:800;color:#4ade80;margin-top:6px">${fmtBRL(topVgv.vgvReal)}</div>` : ''}`;
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
      <div style="font-size:${cat ? '15px' : '12px'};letter-spacing:.08em;color:${posColor};opacity:.85">${cat ? `${(TELAS_SEC.find(t => t.id === cat) || {}).un || ''} · ${fmtPts(a._val)} pts` : 'pontos'}</div>
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
        <div style="font-size:11px;color:#64748b">${cat ? `${(TELAS_SEC.find(t => t.id === cat) || {}).un || ''} · ${fmtPts(a._val)} pts` : `pts${a.vgvReal ? ` · VGV ${fmtBRL(a.vgvReal)}` : ''}`}</div>
      </div>
    </div>`;
}

/* ── letreiro de jornal: recados da timeline + oportunidades abertas ── */
const OP_ICO = { lead: '🎯', imovel: '🏠', parceria: '🤝', investidor: '💼', outro: '📌' };
let _tkItems = [];
function tickerItems() {
  const its = [];
  _atividade.slice(0, 6).forEach(a => its.push({
    kind: 'atividade', tag: 'ATIVIDADE', ico: '⚡', cor: '#38bdf8',
    texto: `${a.nome} · ${a.lbl}`, extra: a.hora,
  }));
  _recados.forEach(r => its.push({
    kind: 'recado', tag: 'RECADO', ico: '📣', cor: r.cor || '#eab308',
    texto: r.texto || '', extra: r.autor || '',
  }));
  _oport.forEach(o => its.push({
    kind: 'oportunidade', tag: 'OPORTUNIDADE', ico: OP_ICO[o.tipo] || '💡', cor: '#22c55e',
    texto: o.titulo || '', extra: o.valor_est ? fmtBRL(o.valor_est) : '',
    desc: o.descricao || '',
  }));
  return its;
}
function tkChip(i, idx) {
  return `
    <button class="rh-item" data-tk="${idx}" style="display:inline-flex;align-items:center;gap:10px;margin-right:22px;padding:7px 16px;border-radius:99px;white-space:nowrap;cursor:pointer;border:1px solid ${i.cor}66;background:linear-gradient(180deg,${i.cor}2e,${i.cor}14);color:#f1f5f9;font-family:inherit">
      <span style="font-size:20px;line-height:1">${i.ico}</span>
      <span style="font-size:10px;font-weight:900;letter-spacing:.12em;color:${i.cor};background:${i.cor}22;padding:2px 8px;border-radius:99px">${i.tag}</span>
      <span style="font-size:19px;font-weight:700">${escapeHtml(i.texto)}</span>
      ${i.extra ? `<span style="font-size:16px;font-weight:800;color:${i.kind === 'oportunidade' ? '#4ade80' : '#94a3b8'}">${escapeHtml(i.extra)}</span>` : ''}
    </button>`;
}
function ticker() {
  _tkItems = tickerItems();
  if (!_tkItems.length) return '';
  const chunk = _tkItems.map(tkChip).join('');
  const chars = _tkItems.reduce((a, i) => a + i.texto.length + (i.extra || '').length + 16, 0);
  const dur = Math.max(10, Math.round(chars * 0.16));   // bem mais rápido, mínimo 10s por volta
  return `
    <div class="rh-ticker" style="display:flex;align-items:center;background:#0d1120;border-top:1px solid rgba(71,85,105,.3)">
      <div style="flex:none;display:flex;align-items:center;gap:8px;padding:12px 18px;background:linear-gradient(90deg,#1c1917,#0d1120);border-right:1px solid rgba(234,179,8,.35)">
        <span class="rh-live" style="width:10px;height:10px;border-radius:99px;background:#ef4444"></span>
        <span style="font-size:13px;font-weight:900;letter-spacing:.14em;color:#facc15">AGORA</span>
      </div>
      <div style="flex:1;overflow:hidden;padding:8px 0">
        <div class="rh-track" style="display:inline-flex;white-space:nowrap;will-change:transform;animation:rhTicker ${dur}s linear infinite">
          <span style="display:inline-flex">${chunk}</span><span style="display:inline-flex">${chunk}</span>
        </div>
      </div>
    </div>`;
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
    @keyframes rhTicker { from { transform:translateX(0) } to { transform:translateX(-50%) } }
    @keyframes rhLive { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(239,68,68,.6) } 50% { opacity:.5; box-shadow:0 0 0 6px rgba(239,68,68,0) } }
    @keyframes rhPop { from { transform:scale(.9); opacity:0 } to { transform:scale(1); opacity:1 } }
    @keyframes rhFade { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
    @keyframes rhBar { from { transform:scaleX(0) } to { transform:scaleX(1) } }
    .rh-body { animation:rhFade .45s ease; }
    .rh-bar { transform-origin:left; animation:rhBar ${SLIDE_MS()}ms linear; }
    .rh-live { animation:rhLive 1.4s ease infinite; }
    .rh-ticker:hover .rh-track { animation-play-state:paused; }
    .rh-item { transition:transform .15s ease, box-shadow .15s ease; }
    .rh-item:hover { transform:scale(1.06); box-shadow:0 0 22px rgba(250,204,21,.25); }
    @media (prefers-reduced-motion: reduce) { .rh-track, .rh-live { animation:none !important } }
  </style>
  <div style="position:fixed;inset:0;z-index:50;background:#0a0d16;color:#e2e8f0;display:flex;flex-direction:column;overflow:hidden;font-family:inherit">
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
    ${ticker()}
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 26px;background:#0d1120;border-top:1px solid rgba(71,85,105,.3)">
      ${Object.values(BADGES).map(b => `<span style="padding:3px 10px;border-radius:99px;font-size:11px;background:${b.bg};color:${b.fg}">${b.ab} <b>${b.lbl}</b></span>`).join('')}
      <span style="font-size:11px;color:#475569">💲 VGV Real</span>
      <span style="margin-left:auto;font-size:11px;color:#475569">Dados do PSM HUB · atualização automática a cada 30 segundos</span>
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
  _root.querySelector('.rh-ticker')?.addEventListener('click', e => {
    const b = e.target.closest('[data-tk]');
    if (!b) return;
    const it = _tkItems[+b.dataset.tk];
    if (it) showTickerItem(it);
  });
  document.getElementById('rh-fs')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

/* ── ⚙️ engrenagem: modal de configuração da TV (gestão, salva no banco) ── */
const CFG_LBL = { recado: '📣 Recado da gestão', duelo: '⚔️ Duelo pela liderança', doc: '🗂 Ranking de Pastas',
  aten: '🚶 Ranking de Visitas', prosp: '📞 Ranking de Atendimentos', corrida: '🏁 Corrida da Meta',
  premiacoes: '🏆 Premiações', placar: '🎯 Placar do mês', criativos: '🎨 Criativos do mês' };
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
        <label style="flex:1;font-size:13px;color:#94a3b8">Vendas volta a cada X telas
          <input id="rhc-cada" type="number" min="1" max="8" value="${_cfg.vendas_cada}" style="width:100%;margin-top:4px;background:#141a2c;border:1px solid rgba(71,85,105,.5);border-radius:8px;color:#f8fafc;padding:8px 10px;font-size:16px"></label>
      </div>
      <div style="font-size:13px;color:#94a3b8;margin-bottom:8px">Telas extras — ligue/desligue e arraste a ordem (▲▼). O ranking de vendas é fixo e intercala sozinho.</div>
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
    const cfg = { slide_s: Number(ov.querySelector('#rhc-slide').value) || 20,
                  vendas_cada: Number(ov.querySelector('#rhc-cada').value) || 5, telas };
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
