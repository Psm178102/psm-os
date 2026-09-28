/* PSM-OS v2 — 🏭 Central de Marketing (v88.62)
   Pedido do Paulo (27/set): "melhore uso, interface e layout do sistema de marketing com os
   agentes (fluxograma); unifique o simulador de criativos e o estúdio; organize, senão vira bagunça".
   Uma tela só, em abas, no lugar de 5 entradas soltas no menu:
     🏭 Esteira   — o fluxograma VIVO: 9 estações em ordem, dono, SLA, skills e agente de cada uma,
                    cards por etapa do quadro e o que está parado > 2× o SLA
     📸 Estúdio   — as skills /ig-* + 📣 Anúncio Meta (substitui o Simulador Criativos)
     🤖 Equipe    — os agentes da Esteira em chat
     🗂️ Quadro    — o quadro de conteúdo PSM Conquista (pauta → no ar)
     🎨 Pedidos   — solicitações de criativos dos corretores
   As telas antigas (/estudio-ig, /equipe-marketing, /sim-criativos) redirecionam pra cá.
   Fluxograma completo (documento): artifact Esteira Conquista v2. */
import { api } from '../api.js';
import { pageEstudioIg } from './estudio-ig.js';
import { pageEquipeMarketing } from './equipe-marketing.js';
import { pageConteudoConquista } from './paulo-conteudo.js';
import { pageCriativos } from './criativos.js';

const TABS = [
  { id: 'esteira', lbl: '🏭 Esteira', dica: 'o fluxo ao vivo' },
  { id: 'estudio', lbl: '📸 Estúdio', dica: 'pedir peça' },
  { id: 'equipe',  lbl: '🤖 Equipe', dica: 'falar com agente' },
  { id: 'quadro',  lbl: '🗂️ Quadro', dica: 'pauta → no ar' },
  { id: 'pedidos', lbl: '🎨 Pedidos', dica: 'criativos dos corretores' },
];
const FLUXOGRAMA_URL = 'https://claude.ai/artifact/6orb4SeL1yKZhfc2hMU8tr';

// Estações na ORDEM da Esteira. agente = id do chat (Equipe); skills = ids do Estúdio.
const ESTACOES = [
  { n: '1', nome: 'Pauta', dono: 'Curador', agente: 'curador', sla: 'sex 12h', faz: 'Garimpa virais e dúvidas reais; entrega a pauta com evidência.', skills: ['ig-viral', 'ig-plan'] },
  { n: '2', nome: 'Briefing', dono: 'CMO', agente: null, cmo: true, sla: '24h', faz: 'Prioriza pelo ICE e escreve os briefings de 8 campos.', skills: [] },
  { n: '3', nome: 'Texto e roteiro', dono: 'Copywriter', agente: 'copywriter', sla: '2–3 dias', faz: 'Roteiro, legenda, carrossel, stories, anúncio.', skills: ['ig-reel', 'ig-caption', 'ig-carousel', 'ig-story', 'anuncio-meta', 'ig-repurpose'] },
  { n: '4', nome: 'Arte e vídeo', dono: 'Design · Vídeo IA · Editor', agente: 'designer', extra: [['video_ia', 'Vídeo IA'], ['editor_video', 'Editor']], sla: '2 dias', faz: 'Arte final no Canva, bruto gravado ou gerado, corte e legenda queimada.', skills: [] },
  { n: '5', nome: 'Anti-robô + nota', dono: 'Auditor', agente: 'auditor_mkt', gate: true, sla: '24h', faz: 'Bloqueia vício de IA e regra da Sol; nota 0–10, abaixo de 8 volta.', skills: ['ig-human'] },
  { n: '6', nome: 'Validação', dono: 'Paulo', agente: null, paulo: true, gate: true, sla: 'lote dom/qua', faz: 'Aprova, pede ajuste ou reprova. O motivo vira regra.', skills: [] },
  { n: '7', nome: 'Calendário e agenda', dono: 'Social media · Agendador', agente: 'social_media', extra: [['agendador', 'Agendador']], sla: 'no horário', faz: 'Encaixa no calendário, agenda, confere no ar em 1h.', skills: ['ig-plan', 'ig-story', 'ig-profile'] },
  { n: '8', nome: 'Resposta', dono: 'Community', agente: 'community', sla: '< 4h úteis', faz: 'Responde tudo; separa dúvida, lead e crise.', skills: ['ig-reply', 'ig-dm', 'ig-comment'] },
  { n: '9', nome: 'Aprendizado', dono: 'Orgânico · SEO · CMO', agente: 'organico', extra: [['seo', 'SEO']], sla: 'seg 8h', faz: 'Post-mortem, placar e decisões. O que funcionou vira regra.', skills: ['ig-audit', 'ig-viral'] },
];
const SKILL_LBL = {
  'ig-viral': '🔥 virais', 'ig-plan': '🗓️ plano', 'ig-reel': '🎬 reel', 'ig-caption': '📝 legenda', 'ig-carousel': '🗂️ carrossel',
  'ig-story': '📱 stories', 'anuncio-meta': '📣 anúncio', 'ig-repurpose': '♻️ reaproveitar', 'ig-human': '🧽 anti-IA',
  'ig-profile': '🪪 perfil', 'ig-reply': '↩️ comentários', 'ig-dm': '✉️ DM', 'ig-comment': '💬 engajar', 'ig-audit': '📊 post-mortem',
};
const ETAPA_LBL = { curadoria: '📚 Pauta', gravacao: '🎬 Gravação', edicao: '✂️ Edição', aprovacao: '👁 Aprovação', agendamento: '📆 Agendar', publicado: '🚀 No ar' };

let _root = null, _tab = 'esteira', _dados = null;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const go = (tab, extra = '') => `#/marketing-central?tab=${tab}${extra}`;

export async function pageMarketingCentral(ctx, root) {
  _root = root;
  _tab = TABS.some(t => t.id === ctx?.query?.tab) ? ctx.query.tab : 'esteira';
  root.innerHTML = `
  <style>
    .mc-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:1px solid var(--bd);padding-bottom:10px}
    .mc-tab{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:7px 14px;border-radius:10px;border:1px solid var(--bd);background:var(--bg-3);color:inherit;text-decoration:none;font-weight:700;font-size:13px}
    .mc-tab small{font-weight:500;font-size:10.5px;color:var(--muted)}
    .mc-tab.on{border-color:#e88530;box-shadow:0 0 0 1px #e88530;background:rgba(232,133,48,.10)}
    .mc-rail{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:8px}
    .mc-st{background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:11px 13px;display:flex;flex-direction:column;gap:5px}
    .mc-st.gate{border-color:#f43f5e66;background:rgba(244,63,94,.05)}
    .mc-n{font-weight:900;font-size:22px;color:#e88530;line-height:1}
    .mc-st.gate .mc-n{color:#f43f5e}
    .mc-chip{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--bd);color:inherit;text-decoration:none;margin:2px 3px 0 0}
    .mc-chip:hover{border-color:#e88530}
    .mc-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px}
    .mc-k{background:var(--bg-3);border:1px solid var(--bd);border-radius:10px;padding:9px 12px}
    .mc-k b{font-size:20px;display:block;font-variant-numeric:tabular-nums}
    @media (max-width:520px){.mc-tab{padding:6px 10px}.mc-tab small{display:none}}
  </style>
  <nav class="mc-tabs" aria-label="Central de Marketing">
    ${TABS.map(t => `<a class="mc-tab ${_tab === t.id ? 'on' : ''}" href="${go(t.id)}">${t.lbl}<small>${t.dica}</small></a>`).join('')}
  </nav>
  <div id="mc-body"></div>`;
  const body = root.querySelector('#mc-body');
  if (_tab === 'estudio') return pageEstudioIg(ctx, body);
  if (_tab === 'equipe') return pageEquipeMarketing(ctx, body);
  if (_tab === 'quadro') return pageConteudoConquista(ctx, body);
  if (_tab === 'pedidos') return pageCriativos(ctx, body);
  body.innerHTML = '<div class="tiny muted" style="padding:16px"><span class="spinner"></span> carregando a Esteira…</div>';
  try { _dados = await api.request('/api/v3/marketing/estudio'); } catch (e) { _dados = { erro: e.message }; }
  renderEsteira(body);
}

function renderEsteira(body) {
  const e = _dados?.esteira || {};
  const hist = _dados?.historico || [];
  const fila = hist.filter(h => h.peca_id && (h.veredito || 'pendente') === 'pendente').length;
  const ajustar = hist.filter(h => h.veredito === 'ajustar').length;
  const semana = hist.filter(h => Date.now() - new Date(h.ts).getTime() < 7 * 864e5);
  const notas = semana.map(h => h.auditoria?.nota).filter(n => n != null);
  const media = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1) : '–';
  const par = e.parados || [];
  body.innerHTML = `
  <div class="flex" style="align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">
    <b style="font-size:16px">A Esteira Conquista agora</b>
    <span class="tiny muted">Pauta → texto → arte → anti-robô e nota → Paulo → agenda → resposta → aprendizado</span>
    <a class="tiny" href="${FLUXOGRAMA_URL}" target="_blank" rel="noopener" style="margin-left:auto;color:#38bdf8">📐 fluxograma completo ↗</a>
  </div>
  ${_dados?.erro ? `<div class="mc-k tiny" style="color:#fb923c;margin-bottom:10px">⚠️ ${esc(_dados.erro)}</div>` : ''}
  <div class="mc-kpi">
    <div class="mc-k"><span class="tiny muted">na fila do Paulo</span><b style="color:${fila ? '#eab308' : 'inherit'}">${fila}</b></div>
    <div class="mc-k"><span class="tiny muted">voltaram pra ajuste</span><b style="color:${ajustar ? '#fb923c' : 'inherit'}">${ajustar}</b></div>
    <div class="mc-k"><span class="tiny muted">peças na semana</span><b>${semana.length}</b></div>
    <div class="mc-k"><span class="tiny muted">nota média do Auditor</span><b style="color:${media !== '–' && +media >= 8 ? '#22c55e' : media === '–' ? 'inherit' : '#eab308'}">${media}</b></div>
    <div class="mc-k"><span class="tiny muted">parados além do SLA</span><b style="color:${par.length ? '#f43f5e' : '#22c55e'}">${par.length}</b></div>
  </div>

  <div class="mc-k" style="margin-bottom:12px">
    <div class="flex" style="align-items:center;gap:8px;flex-wrap:wrap">
      <b class="tiny">🗂️ Quadro PSM Conquista</b><span class="tiny muted">${e.total ?? 0} card(s)</span>
      <a class="tiny" href="${go('quadro')}" style="margin-left:auto;color:#38bdf8">abrir o quadro →</a>
    </div>
    <div style="margin-top:6px">${Object.keys(ETAPA_LBL).map(k => `<span class="mc-chip">${ETAPA_LBL[k]} <b>${esc(e.por_etapa?.[k] ?? 0)}</b>${e.sla?.[k] ? ` <span class="muted">· ${e.sla[k]}d</span>` : ''}</span>`).join('')}</div>
    ${par.length ? `<ul class="tiny" style="margin:8px 0 0 18px;line-height:1.55;color:#f43f5e">${par.map(p => `<li>${esc(p.titulo || '(sem título)')} · ${ETAPA_LBL[p.etapa] || esc(p.etapa)} há ${esc(p.dias)} dias${p.responsavel ? ` · ${esc(p.responsavel)}` : ''}</li>`).join('')}</ul>` : ''}
  </div>

  <div class="mc-rail">
    ${ESTACOES.map(s => `
    <div class="mc-st ${s.gate ? 'gate' : ''}">
      <div class="flex" style="align-items:baseline;gap:8px"><span class="mc-n">${s.n}</span><b>${esc(s.nome)}</b>
        ${s.gate ? '<span class="tiny" style="margin-left:auto;color:#f43f5e;font-weight:700">portão</span>' : ''}</div>
      <div class="tiny"><b>${esc(s.dono)}</b> <span class="muted">· ${esc(s.sla)}</span></div>
      <div class="tiny muted" style="line-height:1.45">${esc(s.faz)}</div>
      <div>
        ${s.skills.map(k => `<a class="mc-chip" href="${go('estudio', '&skill=' + k)}">${SKILL_LBL[k] || k}</a>`).join('')}
        ${s.agente ? `<a class="mc-chip" href="${go('equipe', '&agente=' + s.agente)}">💬 ${esc(s.dono.split(' · ')[0])}</a>` : ''}
        ${(s.extra || []).map(([id, l]) => `<a class="mc-chip" href="${go('equipe', '&agente=' + id)}">💬 ${esc(l)}</a>`).join('')}
        ${s.paulo ? `<a class="mc-chip" href="#/cmo?tab=validar">✅ fila de validação</a>` : ''}
        ${s.cmo ? `<a class="mc-chip" href="#/cmo">🎯 cockpit do CMO</a>` : ''}
      </div>
    </div>`).join('')}
  </div>
  <div class="tiny muted" style="margin-top:10px;line-height:1.6">
    Leis: nada fura portão · quem cria não avalia · nota abaixo de 8 volta · reprovação vira regra em 24h · no máximo 2 lotes por estação · publicar, disparar ou gastar só com o OK do Paulo.
  </div>`;
}
