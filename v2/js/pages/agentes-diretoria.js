/* PSM-OS v2 — 🏛 AGENTES DIRETORIA (v87.31)
   Submenu Diretoria → Agentes Diretoria: CEO, CFO e CMO (e futuros agentes
   C-level) + a REDE DE AGENTES que os interliga.

   Como funciona a rede: todo agente da rede (CEO/CFO/CMO/Sr. Tráfego/Sr.
   Performance/Sr. Gerência) recebe no contexto os recados dos colegas
   (shared_kv 'agentes_rede') e pode publicar achados/alertas/incongruências
   via bloco [[REDE]] — o backend (api/v3/ia/chat.py) grava e os outros leem
   na próxima conversa. A aba 🕸 Rede é a janela humana desse quadro.
   SÓ sócio (lvl>=10). */
import { api } from '../api.js';
import { auth } from '../auth.js';

const AGENTS = [
  {
    id: 'ceo', name: 'CEO PSM', ico: '🎩', color: '#0ea5e9',
    line: 'Braço direito executivo',
    desc: 'Visão de dono do todo: prioridades, preparo de decisão, fiscalização do Plano de Resgate e arbitragem entre áreas.',
    links: [{ nav: '/cockpit', lbl: '🧭 Sala de Comando' }, { nav: '/diretoria-ceo', lbl: '🏛️ Dossiês (Estado da União)' }],
    sugestoes: [
      'Como está a empresa este mês? Me dá o Estado da União.',
      'Quais são as 3 prioridades da semana e por quê?',
      'Revisa o Plano de Resgate contra o realizado e aponta desvios.',
      'Onde estamos perdendo dinheiro agora?',
    ],
  },
  {
    id: 'cfo', name: 'Sr. CFO', ico: '💰', color: '#22c55e',
    line: 'Cérebro financeiro da holding',
    desc: 'Caixa, dívida, margens, break-even, orçado×realizado e gates do Plano de Resgate. Aponta risco, erro e acerto com R$ e prazo.',
    links: [{ nav: '/sr-cfo', lbl: '🧠 Dossiês & Radar de Riscos' }],
    sugestoes: [
      'Como está o caixa e o runway agora?',
      'Qual o risco 🔴 mais quente hoje?',
      'O mês fecha positivo? Mostra a conta.',
      'Audita incongruências entre vendas, comissões e custos.',
    ],
  },
  {
    id: 'cmo', name: 'CMO PSM', ico: '📣', color: '#f59e0b',
    line: 'Estratégia de marketing integrada',
    desc: 'Budget de mídia por nicho, CAC/ROAS integrado, priorização entre conteúdo × tráfego × base e arbitragem dos executores.',
    links: [{ nav: '/cmo', lbl: '🎯 Relatórios da rotina' }, { nav: '/gestor-trafego', lbl: '🚦 Sr. Gestor de Tráfego' }],
    sugestoes: [
      'O marketing tá funcionando? Fecha a conta CAC/ROAS por nicho.',
      'Como dividir o budget de mídia este mês?',
      'CMO, fecha a semana: exceções e decisões.',
      'O que cobrar do Sr. Gestor de Tráfego hoje?',
    ],
  },
];

const REDE_DESTINOS = [
  { id: 'todos', lbl: '🌐 Todos' },
  { id: 'ceo', lbl: '🎩 CEO' },
  { id: 'cfo', lbl: '💰 CFO' },
  { id: 'cmo', lbl: '📣 CMO' },
  { id: 'gestor_trafego', lbl: '🚦 Sr. Tráfego' },
  { id: 'sr_performance', lbl: '🤖 Sr. Performance' },
  { id: 'sr_gerencia', lbl: '👔 Sr. Gerência' },
];
const TIPO_META = {
  achado:        { ico: '💡', lbl: 'Achado',        color: '#0ea5e9' },
  alerta:        { ico: '🚨', lbl: 'Alerta',        color: '#ef4444' },
  incongruencia: { ico: '⚠️', lbl: 'Incongruência', color: '#f59e0b' },
  plano:         { ico: '🗺', lbl: 'Plano',         color: '#8b5cf6' },
  decisao:       { ico: '⚖️', lbl: 'Decisão',       color: '#22c55e' },
  pergunta:      { ico: '❓', lbl: 'Pergunta',      color: '#64748b' },
  resposta:      { ico: '💬', lbl: 'Resposta',      color: '#06b6d4' },
};
const AUTOR_META = {
  ceo: '🎩 CEO', cfo: '💰 CFO', cmo: '📣 CMO', gestor_trafego: '🚦 Sr. Tráfego',
  sr_performance: '🤖 Sr. Performance', sr_gerencia: '👔 Sr. Gerência', socio: '👑 Sócio',
};

const STORAGE = id => `psm_v2_agdir_${id}_chat`;

let _st = { root: null, tab: 'ceo', msgs: {}, busy: false, notas: null };

export async function pageAgentesDiretoria(ctx, root, presetTab) {
  _st.root = root;
  _st.tab = presetTab || (ctx?.query?.tab) || 'ceo';
  _st.busy = false;
  for (const a of AGENTS) {
    try { _st.msgs[a.id] = JSON.parse(localStorage.getItem(STORAGE(a.id)) || '[]'); }
    catch { _st.msgs[a.id] = []; }
  }
  render();
  loadRede();   // sempre carrega em background (badge de recados)
}

function saveMsgs(id) {
  try { localStorage.setItem(STORAGE(id), JSON.stringify((_st.msgs[id] || []).slice(-30))); } catch {}
}

async function loadRede() {
  try {
    const r = await api.request('/api/v3/ia/rede');
    _st.notas = r.notas || [];
  } catch { _st.notas = _st.notas || []; }
  if (_st.tab === 'rede') renderBody();
  const badge = document.getElementById('agd-rede-badge');
  if (badge && _st.notas.length) { badge.textContent = _st.notas.length; badge.style.display = 'inline-block'; }
}

function render() {
  const tabs = [
    ...AGENTS.map(a => ({ id: a.id, lbl: `${a.ico} ${a.name}` })),
    { id: 'rede', lbl: '🕸 Rede' },
  ];
  _st.root.innerHTML = `
    <div class="card">
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:18px 22px;margin:-16px -16px 16px;border-radius:14px 14px 0 0;color:#e2e8f0">
        <div style="font-size:20px;font-weight:900;color:#fff">🏛 Agentes Diretoria</div>
        <div class="tiny" style="color:#94a3b8;margin-top:4px">
          A mesa C-level da holding: CEO, CFO e CMO com os dados vivos do House — interligados entre si e com o
          Sr. Tráfego, Sr. Performance e Sr. Gerência pela <b>Rede de Agentes</b>: o que um descobre, os outros leem.
        </div>
      </div>

      <div class="flex gap-2" style="flex-wrap:wrap;border-bottom:1px solid var(--bd);padding-bottom:8px;margin-bottom:14px">
        ${tabs.map(t => `<button class="btn ${_st.tab === t.id ? 'btn-primary' : 'btn-ghost'}" data-tab="${t.id}" style="position:relative">${t.lbl}${t.id === 'rede' ? ` <span id="agd-rede-badge" style="display:none;background:#ef4444;color:#fff;font-size:10px;font-weight:800;border-radius:9px;padding:0 5px;margin-left:4px">${(_st.notas || []).length || ''}</span>` : ''}</button>`).join('')}
      </div>

      <div id="agd-body"></div>
    </div>
  `;
  _st.root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    _st.tab = b.dataset.tab;
    render();
    if (_st.tab === 'rede') loadRede();
  }));
  renderBody();
}

function renderBody() {
  if (_st.tab === 'rede') return renderRede();
  const a = AGENTS.find(x => x.id === _st.tab) || AGENTS[0];
  renderChat(a);
}

/* ── Chat de um agente ─────────────────────────────────────────────── */
function renderChat(a) {
  const body = document.getElementById('agd-body');
  if (!body) return;
  const msgs = _st.msgs[a.id] || [];
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:560px">
      <div style="background:${a.color}11;border-left:4px solid ${a.color};border-radius:10px;padding:10px 14px;margin-bottom:10px">
        <div style="font-weight:800;color:${a.color};font-size:13px">${a.ico} ${esc(a.name)} · <span style="font-weight:600">${esc(a.line)}</span></div>
        <div class="tiny muted" style="margin-top:2px">${esc(a.desc)} Responde com os dados reais do House (vendas, caixa/HUB, Plano de Resgate, Meta Ads, dossiês da rotina) e publica achados na rede.</div>
        ${(a.links || []).length ? `<div class="flex gap-2" style="margin-top:8px;flex-wrap:wrap">${a.links.map(l => `<button class="btn btn-ghost tiny" data-nav="${l.nav}">${l.lbl} →</button>`).join('')}</div>` : ''}
      </div>

      <div id="agd-msgs" style="flex:1;overflow-y:auto;padding:10px;background:var(--bg-3);border-radius:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px">
        ${msgs.length === 0 ? `
          <div style="text-align:center;padding:24px;color:var(--muted)">
            <div style="font-size:36px;margin-bottom:8px">${a.ico}</div>
            <div class="tiny">Comece por uma destas:</div>
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;align-items:center">
              ${a.sugestoes.map(s => `<button class="btn btn-ghost tiny" data-sug="${esc(s)}" style="max-width:420px;white-space:normal;text-align:left">💬 ${esc(s)}</button>`).join('')}
            </div>
          </div>
        ` : msgs.map(m => bubble(m, a)).join('')}
        ${_st.busy ? `<div class="muted tiny"><span class="spinner"></span> ${esc(a.name)} analisando os dados…</div>` : ''}
      </div>

      <div class="flex gap-2" style="align-items:flex-end">
        <textarea id="agd-input" class="input" rows="2" placeholder="Pergunte ao ${esc(a.name)}… (Cmd/Ctrl+Enter envia)" ${_st.busy ? 'disabled' : ''}></textarea>
        <button class="btn btn-primary" id="agd-send" ${_st.busy ? 'disabled' : ''}>${_st.busy ? '…' : 'Enviar'}</button>
        ${msgs.length ? '<button class="btn btn-ghost" id="agd-clear" title="Limpar conversa">🗑</button>' : ''}
      </div>
    </div>
  `;
  body.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => send(a, b.dataset.sug)));
  body.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { location.hash = '#' + b.dataset.nav; }));
  const inp = document.getElementById('agd-input');
  document.getElementById('agd-send')?.addEventListener('click', () => send(a));
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(a); });
  document.getElementById('agd-clear')?.addEventListener('click', () => {
    if (confirm('Limpar a conversa com ' + a.name + '?')) { _st.msgs[a.id] = []; saveMsgs(a.id); renderChat(a); }
  });
  const box = document.getElementById('agd-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

function bubble(m, a) {
  const isUser = m.role === 'user';
  const redeTag = m.rede_pub ? `<div class="tiny" style="margin-top:6px;color:#06b6d4;font-weight:700">📡 publicou ${m.rede_pub} recado(s) na rede de agentes</div>` : '';
  return `
    <div style="display:flex;${isUser ? 'justify-content:flex-end' : ''};gap:8px">
      ${!isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:${a.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${a.ico}</div>` : ''}
      <div style="max-width:78%;background:${isUser ? 'var(--psm-navy)' : 'var(--bg-2)'};color:${isUser ? '#fff' : 'var(--tx)'};padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word">${esc(m.content)}${redeTag}</div>
      ${isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:var(--psm-navy);color:var(--psm-cream);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">${esc((auth.user()?.ini || '?').toUpperCase())}</div>` : ''}
    </div>
  `;
}

async function send(a, textoPronto) {
  if (_st.busy) return;
  const inp = document.getElementById('agd-input');
  const text = (textoPronto || inp?.value || '').trim();
  if (!text) return;
  (_st.msgs[a.id] = _st.msgs[a.id] || []).push({ role: 'user', content: text });
  saveMsgs(a.id);
  if (inp) inp.value = '';
  _st.busy = true;
  renderChat(a);
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: a.id,
      messages: _st.msgs[a.id].slice(-20).map(m => ({ role: m.role, content: m.content })),
    }});
    _st.msgs[a.id].push({ role: 'assistant', content: r.reply || '(sem resposta)', rede_pub: r.rede_pub || 0 });
    saveMsgs(a.id);
    if (r.rede_pub) loadRede();
  } catch (e) {
    _st.msgs[a.id].push({ role: 'assistant', content: '⚠ Erro: ' + (e.message || 'falha') });
  } finally {
    _st.busy = false;
    renderChat(a);
  }
}

/* ── Aba Rede ──────────────────────────────────────────────────────── */
function renderRede() {
  const body = document.getElementById('agd-body');
  if (!body) return;
  const notas = _st.notas;
  body.innerHTML = `
    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-weight:800;margin-bottom:8px">📮 Publicar recado pra rede</div>
      <div class="tiny muted" style="margin-bottom:8px">O recado entra no contexto dos agentes destinatários na próxima conversa de cada um — use pra dar ordem, contexto ou cobrar posição.</div>
      <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:8px">
        <select id="rede-para" class="input" style="max-width:180px">
          ${REDE_DESTINOS.map(d => `<option value="${d.id}">${d.lbl}</option>`).join('')}
        </select>
        <select id="rede-tipo" class="input" style="max-width:180px">
          ${Object.entries(TIPO_META).map(([k, t]) => `<option value="${k}">${t.ico} ${t.lbl}</option>`).join('')}
        </select>
        <input id="rede-titulo" class="input" style="flex:1;min-width:200px" placeholder="Título (1 linha)">
      </div>
      <div class="flex gap-2" style="align-items:flex-end">
        <textarea id="rede-corpo" class="input" rows="2" placeholder="Detalhe (opcional)"></textarea>
        <button class="btn btn-primary" id="rede-add">Publicar</button>
      </div>
    </div>

    <div id="rede-feed">
      ${notas === null ? '<div class="muted tiny"><span class="spinner"></span> carregando o quadro…</div>'
        : notas.length === 0 ? `
          <div style="text-align:center;padding:30px;color:var(--muted)">
            <div style="font-size:40px;margin-bottom:8px">🕸</div>
            <div>O quadro está vazio. Converse com os agentes — quando um descobrir algo relevante, publica aqui e os colegas passam a considerar.</div>
          </div>`
        : notas.map(n => notaCard(n)).join('')}
    </div>
  `;
  document.getElementById('rede-add')?.addEventListener('click', addNota);
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Apagar este recado do quadro?')) return;
    try {
      await api.request('/api/v3/ia/rede', { method: 'POST', body: { action: 'del', id: b.dataset.del } });
      _st.notas = (_st.notas || []).filter(n => n.id !== b.dataset.del);
      renderRede();
    } catch (e) { alert('Erro: ' + (e.message || 'falha')); }
  }));
}

function notaCard(n) {
  const t = TIPO_META[n.tipo] || TIPO_META.achado;
  const autor = AUTOR_META[n.autor] || n.autor;
  const para = (n.para || []).map(p => p === 'todos' ? '🌐 todos' : (AUTOR_META[p] || p)).join(', ');
  const quando = String(n.ts || '').slice(0, 16).replace('T', ' ');
  return `
    <div style="background:var(--bg-2);border-left:4px solid ${t.color};border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div class="flex" style="align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:12px;background:${t.color}22;color:${t.color}">${t.ico} ${t.lbl.toUpperCase()}</span>
        <span class="tiny" style="font-weight:700">${esc(autor)}</span>
        <span class="tiny muted">→ ${esc(para)}</span>
        <span class="tiny muted" style="margin-left:auto">${esc(quando)}${n.por ? ' · via ' + esc(n.por) : ''}</span>
        <button class="btn btn-ghost tiny" data-del="${esc(n.id)}" title="Apagar" style="padding:2px 6px">🗑</button>
      </div>
      <div style="font-weight:700;font-size:13px;margin-top:6px">${esc(n.titulo)}</div>
      ${n.corpo ? `<div class="tiny" style="margin-top:4px;line-height:1.5;white-space:pre-wrap">${esc(n.corpo)}</div>` : ''}
    </div>
  `;
}

async function addNota() {
  const titulo = (document.getElementById('rede-titulo')?.value || '').trim();
  if (!titulo) return alert('Escreva um título.');
  const para = document.getElementById('rede-para')?.value || 'todos';
  const tipo = document.getElementById('rede-tipo')?.value || 'achado';
  const corpo = (document.getElementById('rede-corpo')?.value || '').trim();
  try {
    const r = await api.request('/api/v3/ia/rede', { method: 'POST', body: { action: 'add', para: [para], tipo, titulo, corpo } });
    _st.notas = [r.nota, ...(_st.notas || [])];
    renderRede();
  } catch (e) { alert('Erro: ' + (e.message || 'falha')); }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
