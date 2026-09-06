/* PSM-OS v2 — 🏭 Equipe de Marketing (v87.41)
   Pedido do Paulo (05/set): "crie todos os agentes dentro de marketing do
   House PSM". As 14 cadeiras da Esteira Conquista viraram agentes VIVOS no
   House: cada um com persona no roteador /api/v3/ia/chat (MKT_SQUAD, lvl 5+)
   e chat próprio nesta página. Tráfego Pago e Vigia linkam pros módulos
   que já existem. O fluxograma completo mora em Diretoria → CMO (sócios).
   Histórico de chat: localStorage por agente (psm_v2_mkt_chat_<id>). */
import { api } from '../api.js';
import { auth } from '../auth.js';

const SQUAD = [
  { id: 'curador',      ico: '🔎', nome: 'Curador',              est: '1-2 · insumo',       desc: 'Pauta semanal (sexta 12h) com evidência obrigatória: Radar de Virais, Vigia, NotebookLM, datas do ano imobiliário.' },
  { id: 'copywriter',   ico: '✍️', nome: 'Copywriter',           est: '3a · produção',      desc: 'Legendas, roteiros com gancho 0-2s, headlines de anúncio, scripts de WhatsApp/DM. AIDA, CTA específico, zero vícios.' },
  { id: 'designer',     ico: '🎨', nome: 'Design',               est: '3b · produção',      desc: 'Artes e criativos no brand kit Canva da Conquista. Board Pinterest como referência; 🚫 cadeado/prédio/luxo.' },
  { id: 'video_ia',     ico: '🎥', nome: 'Gerador de Vídeo IA',  est: '3c · matéria-prima', desc: 'Vídeo por IA (Kling + TTS) ou shotlist pro time gravar. Decide "grava ou gera" e cobra o banco de brutos.' },
  { id: 'editor_video', ico: '✂️', nome: 'Editor de Vídeo',      est: '3 · produção',       desc: 'Cortes, montagem, legenda queimada, capa e trilha. Deriva as aulas do YouTube em 3 cortes verticais.' },
  { id: 'social_media', ico: '📱', nome: 'Social Media',         est: '1, 5-7',             desc: 'Calendário por canal, identidade de cada rede, ritmo de stories. Canal sem post no prazo = anomalia.' },
  { id: 'community',    ico: '💬', nome: 'Community',            est: '7+ · pós-publicação', desc: 'Todo comentário e DM respondido em <4h no tom Sol. Triagem: dúvida · lead (origem marcada) · crise.' },
  { id: 'agendador',    ico: '📆', nome: 'Agendador',            est: '6 · publicação',     desc: 'Checklist T1 pré-voo (link testado, UTM, versão aprovada), agenda nativa e verificação T2 em 1h.' },
  { id: 'seo',          ico: '🔍', nome: 'SEO',                  est: 'território próprio', desc: 'Google Meu Negócio vivo, reviews respondidos, SEO de YouTube e de legenda. Dono da busca local.' },
  { id: 'organico',     ico: '📈', nome: 'Tráfego Orgânico',     est: 'consultor 1/5/6',    desc: 'Algoritmo por canal, trending sounds, horários da NOSSA conta, colabs locais. Alcance sem verba.' },
  { id: 'mkt_mrr',      ico: '🧲', nome: 'MKT MRR',              est: 'base/RD',            desc: 'RD Station Marketing inteiro: tracking, segmentos, públicos, réguas, automações, scoring, higiene de base.' },
  { id: 'auditor_mkt',  ico: '⚖️', nome: 'Auditor de Marketing', est: '4 + esteira',        desc: 'Nota 0-10 em TUDO (corte 8: <8 volta automático). Status de toda tarefa, tempo vs SLA, bugs e erros invisíveis.' },
  { id: '_trafego',     ico: '🚦', nome: 'Gestor de Tráfego Pago', est: 'mídia',            desc: 'Meta Ads: campanhas, verba, públicos, relatório 19h. Módulo completo próprio.', link: '/gestor-trafego' },
  { id: '_vigia',       ico: '🕵️', nome: 'Vigia de Concorrência', est: 'inteligência',      desc: 'Ad Library dos concorrentes 3x/dia + IA analisando a cada 6h. Mora na página de Concorrência.', link: '/concorrencia' },
];

let _root = null, _sel = null, _msgs = [], _busy = false;

const chatKey = id => `psm_v2_mkt_chat_${id}`;

export async function pageEquipeMarketing(ctx, root) {
  _root = root;
  _sel = (ctx?.query?.agente && SQUAD.find(a => a.id === ctx.query.agente && !a.link)) ? ctx.query.agente : null;
  if (_sel) loadMsgs();
  render();
}

function loadMsgs() {
  try { _msgs = JSON.parse(localStorage.getItem(chatKey(_sel)) || '[]'); } catch { _msgs = []; }
}
function saveMsgs() {
  try { localStorage.setItem(chatKey(_sel), JSON.stringify(_msgs.slice(-40))); } catch {}
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function md(txt) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', inList = false;
  for (const ln of String(txt || '').split(/\r?\n/)) {
    const t = ln.trim();
    const li = t.match(/^(?:[*\-•]|\d+[.)])\s+(.*)/);
    if (li) { if (!inList) { html += '<ul style="margin:4px 0 4px 18px">'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (!t) continue;
    html += `<p style="margin:5px 0">${inline(t.replace(/^#{1,4}\s*/, ''))}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function render() {
  const socio = (auth.user()?.lvl || 0) >= 10;
  _root.innerHTML = `
  <style>
    .mkt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
    .mkt-card{background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px;cursor:pointer;transition:border-color .15s}
    .mkt-card:hover{border-color:#22c55e}
    .mkt-card.on{border-color:#22c55e;box-shadow:0 0 0 1px #22c55e}
    .mkt-chat{background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;display:flex;flex-direction:column;height:60vh;min-height:380px}
    .mkt-log{flex:1;overflow-y:auto;padding:14px}
    .mkt-b{max-width:82%;border-radius:12px;padding:9px 13px;margin-bottom:8px;font-size:13px;line-height:1.55}
    .mkt-b.user{margin-left:auto;background:rgba(34,197,94,.15);border:1px solid #22c55e44}
    .mkt-b.ia{background:var(--bg-2,rgba(255,255,255,.04));border:1px solid var(--bd)}
  </style>

  <div style="background:linear-gradient(135deg,var(--bg-3),transparent);border:1px solid var(--bd);border-radius:12px;padding:14px 18px;margin-bottom:14px">
    <div class="flex" style="align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-weight:900;font-size:16px">🏭 Equipe de Marketing · Esteira Conquista</div>
      <span class="tiny muted">14 cadeiras · cada agente é dono de uma estação</span>
      ${socio ? '<a href="#/cmo" class="tiny" style="margin-left:auto;color:#38bdf8">🎯 cockpit do CMO (fluxograma + notas) →</a>' : ''}
    </div>
    <div class="tiny" style="margin-top:4px;color:var(--muted)">Fluxo: Curador → CMO (briefing) → Copy/Design/Vídeo → Editor → <b>Auditor (nota 0-10, corte 8)</b> → Paulo valida → Agendador → canais → Community. Nenhum agente publica, dispara ou gasta sem aprovação do sócio.</div>
  </div>

  <div class="mkt-grid" style="margin-bottom:14px">
    ${SQUAD.map(a => `
    <div class="mkt-card ${_sel === a.id ? 'on' : ''}" data-mkt-ag="${a.id}">
      <div class="flex" style="align-items:center;gap:8px">
        <span style="font-size:18px">${a.ico}</span><b>${esc(a.nome)}</b>
        <span class="tiny" style="margin-left:auto;color:#38bdf8">${a.link ? 'módulo ↗' : '💬 chat'}</span>
      </div>
      <div class="tiny" style="color:#38bdf8;margin-top:2px">estação ${esc(a.est)}</div>
      <div class="tiny muted" style="margin-top:5px;line-height:1.5">${esc(a.desc)}</div>
    </div>`).join('')}
  </div>

  ${_sel ? chatHtml() : '<div class="cmo-card tiny muted" style="background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:16px;text-align:center">Clique num agente pra conversar — briefe, cobre, peça entregável. O que ele produzir segue a esteira: nota do Auditor + validação do sócio antes de ir ao ar.</div>'}`;

  _root.querySelectorAll('[data-mkt-ag]').forEach(el => el.onclick = () => {
    const a = SQUAD.find(x => x.id === el.dataset.mktAg);
    if (a.link) { location.hash = '#' + a.link; return; }
    _sel = a.id; loadMsgs(); render();
    _root.querySelector('#mkt-in')?.focus();
  });
  wireChat();
}

function chatHtml() {
  const a = SQUAD.find(x => x.id === _sel);
  return `
  <div class="mkt-chat">
    <div class="flex" style="align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bd)">
      <span style="font-size:16px">${a.ico}</span><b>${esc(a.nome)}</b>
      <span class="tiny muted">· estação ${esc(a.est)}</span>
      <button class="btn btn-ghost tiny" id="mkt-clear" style="margin-left:auto" title="limpar conversa">🗑</button>
    </div>
    <div class="mkt-log" id="mkt-log">
      ${_msgs.length ? _msgs.map(m => `<div class="mkt-b ${m.role === 'user' ? 'user' : 'ia'}">${m.role === 'user' ? esc(m.content) : md(m.content)}</div>`).join('')
        : `<div class="tiny muted" style="text-align:center;padding:24px 12px">Primeira conversa com ${esc(a.nome)}. Ele já conhece a esteira, a marca e os portões — pode briefar direto.</div>`}
      ${_busy ? '<div class="mkt-b ia tiny"><span class="spinner"></span> pensando…</div>' : ''}
    </div>
    <div class="flex" style="gap:8px;padding:10px 14px;border-top:1px solid var(--bd)">
      <input id="mkt-in" class="input" style="flex:1" placeholder="Mensagem pro ${esc(a.nome)}…" ${_busy ? 'disabled' : ''}>
      <button class="btn btn-primary" id="mkt-send" ${_busy ? 'disabled' : ''}>Enviar</button>
    </div>
  </div>`;
}

function wireChat() {
  const send = async () => {
    const inp = _root.querySelector('#mkt-in');
    const txt = (inp?.value || '').trim();
    if (!txt || _busy) return;
    _msgs.push({ role: 'user', content: txt });
    saveMsgs(); _busy = true; render();
    try {
      const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: { agent: _sel, messages: _msgs.slice(-16) } });
      _msgs.push({ role: 'assistant', content: r?.reply || '(sem resposta)' });
    } catch (e) {
      _msgs.push({ role: 'assistant', content: '⚠️ ' + e.message });
    }
    _busy = false; saveMsgs(); render();
    const log = _root.querySelector('#mkt-log'); if (log) log.scrollTop = log.scrollHeight;
    _root.querySelector('#mkt-in')?.focus();
  };
  const btn = _root.querySelector('#mkt-send');
  if (btn) btn.onclick = send;
  const inp = _root.querySelector('#mkt-in');
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const clr = _root.querySelector('#mkt-clear');
  if (clr) clr.onclick = () => { if (confirm('Limpar esta conversa?')) { _msgs = []; saveMsgs(); render(); } };
  const log = _root.querySelector('#mkt-log'); if (log) log.scrollTop = log.scrollHeight;
}
