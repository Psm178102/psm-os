/* PSM-OS v2 — 🦉 CONSELHO (v89.31)
   Seção própria do menu, antes da Diretoria (pedido do Paulo, 30/set): um
   conselho consultivo de IA com 6 cadeiras, cada uma INSPIRADA no modo de
   pensar público de uma referência de negócio — Jobs (Produto), Bezos
   (Cliente), Hormozi (Monetização), Altman (Estratégia), Buffett (Capital)
   e Dalio (Risco).

   Três superfícies:
   - 🏛 Mesa do Conselho: uma pauta → os conselheiros dão parecer em paralelo
     (cada um pela sua cadeira) → o Presidente da Mesa fecha a ATA (placar,
     consenso, divergência, recomendação, próximos passos). Dá pra rebater e
     abrir nova rodada; cada conselheiro lembra do que disse.
   - Chat individual com cada conselheiro.
   - 📜 Atas: histórico das pautas (shared_kv 'conselho_atas', api/v3/ia/conselho).

   São simulações: não são as pessoas reais nem falam por elas. O conselho
   aconselha, o sócio decide. Contexto vivo do House vem do api/v3/ia/chat.
   SÓ sócio (lvl>=10) — o contexto carrega caixa, dívida e Plano de Resgate. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const LARANJA = '#f26a1b';

const CONS = [
  {
    id: 'jobs', agent: 'cons_jobs', nome: 'Jobs', cadeira: 'Produto', ico: '📦', ini: 'SJ',
    ref: 'Steve Jobs',
    lente: 'Foco, simplicidade e experiência de ponta a ponta. Corta o que é médio pra sobrar o que é excelente.',
    sugestoes: [
      'Temos 5 frentes (Conquista, Imóveis, Locação, Morimatsu, Academy). O que você cortaria?',
      'Olha a jornada de quem compra o primeiro imóvel com a gente. Onde ela é medíocre?',
      'O House PSM está virando um produto ou um amontoado de telas?',
    ],
  },
  {
    id: 'bezos', agent: 'cons_bezos', nome: 'Bezos', cadeira: 'Cliente', ico: '👥', ini: 'JB',
    ref: 'Jeff Bezos',
    lente: 'Começa pelo cliente e volta de trás pra frente. Separa decisão reversível de irreversível e troca boa intenção por mecanismo.',
    sugestoes: [
      'Escreve o comunicado de imprensa do LUX JK como se já tivesse vendido tudo. O que o cliente diz?',
      'Qual decisão eu estou tratando como irreversível e é reversível?',
      'Onde o cliente espera mais do que deveria na nossa esteira?',
    ],
  },
  {
    id: 'hormozi', agent: 'cons_hormozi', nome: 'Hormozi', cadeira: 'Monetização', ico: '📊', ini: 'AH',
    ref: 'Alex Hormozi',
    lente: 'Oferta tão boa que dá vergonha recusar. Equação de valor, LTV sobre CAC e volume antes de otimização.',
    sugestoes: [
      'Monta a oferta da Conquista pela equação de valor. O que falta pra ficar irrecusável?',
      'Qual é a restrição do negócio hoje: lead, conversão ou entrega?',
      'Como fazer a base parada pagar o tráfego do mês?',
    ],
  },
  {
    id: 'altman', agent: 'cons_altman', nome: 'Altman', cadeira: 'Estratégia', ico: '🧠', ini: 'SA',
    ref: 'Sam Altman',
    lente: 'Poucas apostas grandes, crescimento composto e IA como alavanca. Pergunta o que fica difícil de copiar.',
    sugestoes: [
      'Sol, Vera, House e CRM próprio: qual dessas apostas vira vantagem que concorrente não copia?',
      'Se eu só pudesse fazer uma coisa até dezembro, qual seria?',
      'Onde a IA muda o custo da operação nos próximos 12 meses?',
    ],
  },
  {
    id: 'buffett', agent: 'cons_buffett', nome: 'Buffett', cadeira: 'Capital', ico: '💰', ini: 'WB',
    ref: 'Warren Buffett',
    lente: 'Regra número um: não perder dinheiro. Margem de segurança, círculo de competência e custo de oportunidade de cada real.',
    sugestoes: [
      'Onde está o próximo real mais bem alocado: tráfego, gente ou dívida?',
      'Qual frente está fora do nosso círculo de competência?',
      'Olha a dívida (FGI e PRONAMP) e o caixa. O que você faria?',
    ],
  },
  {
    id: 'dalio', agent: 'cons_dalio', nome: 'Dalio', cadeira: 'Risco', ico: '⚠️', ini: 'RD',
    ref: 'Ray Dalio',
    lente: 'Verdade radical e teste de estresse. Diagnostica a causa-raiz, procura o risco de ruína e o que está concentrado demais.',
    sugestoes: [
      'Qual é o risco de ruína da holding hoje? Faz o teste de estresse.',
      'O que está concentrado demais: receita, pessoa ou canal?',
      'Qual problema se repete e eu ainda não ataquei a causa-raiz?',
    ],
  },
];
const byId = id => CONS.find(c => c.id === id);

const PAUTAS = [
  'Vale concentrar 40% do meu tempo no LUX JK até dezembro, ou estou largando a Conquista?',
  'Devo cancelar o RD Station e ficar só com o CRM do House?',
  'Contrato um closer com CRECI agora ou espero o caixa virar?',
  'Abro a PSM Academy pro mercado em janeiro ou seguro até a operação estar no azul?',
];

const LS_CHAT = id => `psm_v2_conselho_${id}_chat`;
const LS_MESA = 'psm_v2_conselho_mesa';

let _st = { root: null, tab: 'mesa', msgs: {}, busy: false, mesa: null, atas: null, ataAberta: null };

function mesaNova() {
  return { id: 'ata-' + Date.now(), pauta: '', ativos: CONS.map(c => c.id), rodadas: [], threads: {} };
}

export async function pageConselho(ctx, root, preset) {
  _st.root = root;
  _st.tab = preset || 'mesa';
  _st.busy = false;
  for (const c of CONS) {
    try { _st.msgs[c.id] = JSON.parse(localStorage.getItem(LS_CHAT(c.id)) || '[]'); }
    catch { _st.msgs[c.id] = []; }
  }
  if (!_st.mesa) {
    try { _st.mesa = JSON.parse(localStorage.getItem(LS_MESA) || 'null'); } catch { _st.mesa = null; }
    if (!_st.mesa || !Array.isArray(_st.mesa.rodadas)) _st.mesa = mesaNova();
    // rodada que ficou "pensando" numa sessão anterior não volta: vira falha visível
    _st.mesa.rodadas.forEach(r => {
      Object.values(r.pareceres || {}).forEach(p => { if (p.status === 'pensando' || p.status === 'fila') { p.status = 'erro'; p.txt = 'A página foi fechada antes da resposta.'; } });
      if (r.sintese && r.sintese.status === 'pensando') { r.sintese.status = 'erro'; r.sintese.txt = 'A página foi fechada antes da ata.'; }
    });
  }
  render();
  if (_st.tab === 'atas') loadAtas();
}

function saveChat(id) { try { localStorage.setItem(LS_CHAT(id), JSON.stringify((_st.msgs[id] || []).slice(-30))); } catch {} }
function saveMesa() { try { localStorage.setItem(LS_MESA, JSON.stringify(_st.mesa)); } catch {} }
const vivo = () => !!document.getElementById('cons-body');

/* ── Casca ─────────────────────────────────────────────────────────── */
function render() {
  const tabs = [
    { id: 'mesa', lbl: '🏛 Mesa do Conselho' },
    ...CONS.map(c => ({ id: c.id, lbl: `${c.ico} ${c.nome}` })),
    { id: 'atas', lbl: '📜 Atas' },
  ];
  _st.root.innerHTML = `
    <div class="card">
      <div style="background:#0b0b0c;padding:20px 22px;margin:-16px -16px 16px;border-radius:14px 14px 0 0;color:#e7e5e4">
        <div style="font-size:22px;font-weight:800;letter-spacing:-.01em;color:#fff;line-height:1.15">CONSELHO <span style="color:${LARANJA}">PSM</span></div>
        <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#a8a29e;margin-top:6px">6 mentes de negócio · 6 agentes de IA · um conselho</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:14px">
          ${CONS.map(c => `
            <button data-tab="${c.id}" title="${esc(c.lente)}" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:8px">
              ${avatar(c, 34)}
              <span style="line-height:1.15"><span style="display:block;font-size:12px;font-weight:700;color:#fff">${c.nome.toUpperCase()}</span><span style="display:block;font-size:10px;font-weight:700;color:${LARANJA};letter-spacing:.06em">${c.cadeira.toUpperCase()}</span></span>
            </button>`).join('')}
        </div>
        <div style="font-size:11px;color:#a8a29e;margin-top:14px;line-height:1.5;max-width:760px">
          Conselheiros de IA inspirados no modo de pensar público de cada referência (livros, cartas, entrevistas). São simulações: não são as pessoas reais nem falam por elas. O conselho aconselha com os dados vivos do House. Quem decide é o sócio.
        </div>
      </div>

      <div class="flex gap-2" style="flex-wrap:wrap;border-bottom:1px solid var(--bd);padding-bottom:8px;margin-bottom:14px">
        ${tabs.map(t => `<button class="btn ${_st.tab === t.id ? 'btn-primary' : 'btn-ghost'}" data-tab="${t.id}">${t.lbl}</button>`).join('')}
      </div>

      <div id="cons-body"></div>
    </div>
  `;
  _st.root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    _st.tab = b.dataset.tab;
    render();
    if (_st.tab === 'atas') loadAtas();
  }));
  renderBody();
}

function renderBody() {
  if (!vivo()) return;
  if (_st.tab === 'mesa') return renderMesa();
  if (_st.tab === 'atas') return renderAtas();
  renderChat(byId(_st.tab) || CONS[0]);
}

function avatar(c, px) {
  return `<span style="width:${px}px;height:${px}px;border-radius:50%;background:#1c1917;border:2px solid ${LARANJA};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(px * 0.34)}px;font-weight:700;flex-shrink:0;letter-spacing:.02em">${c.ini}</span>`;
}

/* ── Mesa do Conselho ──────────────────────────────────────────────── */
function renderMesa() {
  const body = document.getElementById('cons-body');
  if (!body) return;
  const m = _st.mesa;
  const temRodada = m.rodadas.length > 0;
  body.innerHTML = `
    ${temRodada ? '' : `
      <div style="background:var(--bg-3);border-radius:var(--radius-md);padding:16px;margin-bottom:14px">
        <div style="font-weight:600;margin-bottom:4px">Qual é a pauta?</div>
        <div class="tiny muted" style="margin-bottom:10px">Traga uma decisão, não um assunto. Cada conselheiro dá o parecer pela sua cadeira e o Presidente da Mesa fecha a ata com placar, divergências e recomendação.</div>
        <textarea id="mesa-pauta" class="input" rows="3" style="width:100%;box-sizing:border-box" placeholder="Ex.: Devo contratar um closer agora ou esperar o caixa virar? (Cmd/Ctrl+Enter convoca)"></textarea>
        <div class="tiny muted" style="margin:12px 0 6px">Quem senta à mesa</div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${CONS.map(c => {
            const on = m.ativos.includes(c.id);
            return `<button class="btn ${on ? 'btn-primary' : 'btn-ghost'} tiny" data-ativo="${c.id}" aria-pressed="${on}">${c.ico} ${c.nome} · ${c.cadeira}</button>`;
          }).join('')}
        </div>
        <div class="flex gap-2" style="margin-top:14px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="mesa-convocar">Convocar o conselho</button>
          <span class="tiny muted">${m.ativos.length} conselheiro(s) · falam um de cada vez, leva de 1 a 2 minutos</span>
        </div>
        <div class="tiny muted" style="margin:16px 0 6px">Ou comece por uma destas</div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
          ${PAUTAS.map(p => `<button class="btn btn-ghost tiny" data-pauta="${esc(p)}" style="white-space:normal;text-align:left">💬 ${esc(p)}</button>`).join('')}
        </div>
      </div>`}

    ${m.rodadas.map((r, i) => rodadaHtml(r, i)).join('')}

    ${temRodada ? `
      <div style="background:var(--bg-3);border-radius:var(--radius-md);padding:14px;margin-top:6px">
        <div style="font-weight:600;margin-bottom:6px">Rebater e abrir nova rodada</div>
        <div class="tiny muted" style="margin-bottom:8px">Discorde, traga um dado novo ou aperte um conselheiro. Todos leem a ata anterior e respondem de novo.</div>
        <div class="flex gap-2" style="align-items:flex-end">
          <textarea id="mesa-replica" class="input" rows="2" style="flex:1;min-width:0" placeholder="Sua réplica… (Cmd/Ctrl+Enter envia)" ${_st.busy ? 'disabled' : ''}></textarea>
          <button class="btn btn-primary" id="mesa-rodada" ${_st.busy ? 'disabled' : ''}>${_st.busy ? '…' : 'Nova rodada'}</button>
        </div>
        <div class="flex gap-2" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-ghost tiny" id="mesa-nova" ${_st.busy ? 'disabled' : ''}>＋ Nova pauta</button>
          <button class="btn btn-ghost tiny" id="mesa-copiar">📋 Copiar a ata</button>
          <button class="btn btn-ghost tiny" data-tab-go="atas">📜 Ver atas anteriores</button>
        </div>
      </div>` : ''}
  `;

  body.querySelectorAll('[data-ativo]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.ativo;
    const rascunho = document.getElementById('mesa-pauta')?.value || '';
    m.ativos = m.ativos.includes(id) ? m.ativos.filter(x => x !== id) : CONS.map(c => c.id).filter(x => x === id || m.ativos.includes(x));
    saveMesa(); renderMesa();
    const ta = document.getElementById('mesa-pauta'); if (ta) ta.value = rascunho;
  }));
  body.querySelectorAll('[data-pauta]').forEach(b => b.addEventListener('click', () => convocar(b.dataset.pauta)));
  document.getElementById('mesa-convocar')?.addEventListener('click', () => convocar(document.getElementById('mesa-pauta')?.value));
  document.getElementById('mesa-pauta')?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) convocar(e.target.value); });
  document.getElementById('mesa-rodada')?.addEventListener('click', () => convocar(document.getElementById('mesa-replica')?.value));
  document.getElementById('mesa-replica')?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) convocar(e.target.value); });
  document.getElementById('mesa-nova')?.addEventListener('click', () => {
    if (!confirm('Encerrar esta pauta e abrir uma nova? A ata fica guardada em Atas.')) return;
    _st.mesa = mesaNova(); saveMesa(); renderMesa();
  });
  document.getElementById('mesa-copiar')?.addEventListener('click', e => copiar(ataTexto(_st.mesa), e.currentTarget));
  body.querySelectorAll('[data-tab-go]').forEach(b => b.addEventListener('click', () => { _st.tab = b.dataset.tabGo; render(); loadAtas(); }));
  body.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => refazer(+b.dataset.rodada, b.dataset.retry)));
}

function rodadaHtml(r, i) {
  const ids = Object.keys(r.pareceres || {});
  return `
    <div style="margin-bottom:18px">
      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px">
        <span style="font-size:11px;font-weight:700;letter-spacing:.08em;color:${LARANJA};padding-top:3px;white-space:nowrap">${i === 0 ? 'PAUTA' : 'RODADA ' + (i + 1)}</span>
        <div style="font-weight:600;font-size:15px;line-height:1.4;white-space:pre-wrap">${esc(r.pergunta)}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(290px,100%),1fr));gap:10px">
        ${ids.map(id => parecerCard(byId(id), r.pareceres[id], i)).join('')}
      </div>
      ${r.sintese ? `
        <div style="background:var(--bg-2);border:1px solid ${LARANJA}66;border-radius:var(--radius-md);padding:14px 16px;margin-top:10px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:${LARANJA};margin-bottom:8px">⚖️ ATA DO CONSELHO${i > 0 ? ' · RODADA ' + (i + 1) : ''}</div>
          ${r.sintese.status === 'pensando'
            ? '<div class="muted tiny"><span class="spinner"></span> O Presidente da Mesa está fechando a ata…</div>'
            : r.sintese.status === 'erro'
              ? `<div class="tiny" style="color:var(--err)">⚠ ${esc(r.sintese.txt)}</div><button class="btn btn-ghost tiny" data-retry="mesa" data-rodada="${i}" style="margin-top:8px">Tentar de novo</button>`
              : `<div style="font-size:13px;line-height:1.6">${fmt(r.sintese.txt)}</div>`}
        </div>` : ''}
    </div>`;
}

function parecerCard(c, p, i) {
  if (!c) return '';
  const cor = veredito(p.txt);
  return `
    <div style="background:var(--bg-2);border-radius:var(--radius-md);padding:12px 14px;border-top:3px solid ${p.status === 'ok' ? cor.cor : 'var(--bd)'};min-width:0">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
        ${avatar(c, 30)}
        <div style="line-height:1.2;min-width:0">
          <div style="font-weight:700;font-size:13px">${c.nome}</div>
          <div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:${LARANJA}">${c.ico} ${c.cadeira.toUpperCase()}</div>
        </div>
        ${p.status === 'ok' && cor.lbl ? `<span style="margin-left:auto;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${cor.cor}22;color:${cor.cor};white-space:nowrap">${cor.lbl}</span>` : ''}
      </div>
      ${p.status === 'fila'
        ? '<div class="muted tiny">aguardando a vez…</div>'
        : p.status === 'pensando'
        ? '<div class="muted tiny"><span class="spinner"></span> analisando os dados…</div>'
        : p.status === 'erro'
          ? `<div class="tiny" style="color:var(--err)">⚠ ${esc(p.txt)}</div><button class="btn btn-ghost tiny" data-retry="${c.id}" data-rodada="${i}" style="margin-top:8px">Tentar de novo</button>`
          : `<div style="font-size:13px;line-height:1.55;word-wrap:break-word">${fmt(p.txt)}</div>`}
    </div>`;
}

// Lê o veredito da 1ª linha do parecer pra pintar o card (a ordem importa: "a favor com condição" antes de "a favor").
function veredito(txt) {
  // só o começo da linha do VEREDITO conta — "contra R$ 250 mil" na justificativa não é voto
  const m = /veredito\W{0,6}(.{0,36})/i.exec(String(txt || '').slice(0, 400));
  const l = m ? m[1].toLowerCase() : '';
  if (/^a favor com condi|^com condi|^favor[aá]vel com condi/.test(l)) return { cor: '#c7861a', lbl: 'COM CONDIÇÃO' };
  if (/^contra/.test(l)) return { cor: '#d64545', lbl: 'CONTRA' };
  if (/^a favor|^favor[aá]vel/.test(l)) return { cor: '#239a5b', lbl: 'A FAVOR' };
  return { cor: 'var(--bd)', lbl: '' };
}

const limite = e => /429|too many|quota|rate|sem resposta|nenhum provider|50[234]/i.test(String(e && e.message || e));
const erroAmigavel = e => limite(e)
  ? 'A IA está no limite de chamadas por minuto. Espere 1 minuto e toque em "Tentar de novo".'
  : (e && e.message) || 'falha';

async function chamar(agent, messages) {
  const esperas = [12000, 25000];   // limite por minuto do provedor: espera e tenta de novo
  let ultimo;
  for (let t = 0; t <= esperas.length; t++) {
    try {
      const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: { agent, messages } });
      if (r && r.reply) return r.reply;
      ultimo = new Error('sem resposta');
    } catch (e) { ultimo = e; if (!limite(e)) break; }
    if (t < esperas.length) await new Promise(ok => setTimeout(ok, esperas[t]));
  }
  throw ultimo || new Error('falha');
}

function promptRodada(m, pergunta, n) {
  if (n === 0) return `PAUTA DO CONSELHO (trazida pelo Paulo):\n${pergunta}\n\nDê o seu PARECER pela sua cadeira, no formato do conselho.`;
  const ant = m.rodadas[n - 1];
  const ata = ant && ant.sintese && ant.sintese.status === 'ok' ? ant.sintese.txt : '(a ata da rodada anterior não fechou)';
  return `NOVA RODADA. Ata da rodada anterior (o que os colegas disseram):\n${ata}\n\nRÉPLICA DO PAULO:\n${pergunta}\n\nResponda à réplica pela sua cadeira, no formato do conselho. Diga se mantém ou muda o veredito e por quê. Se discorda de um colega, diga de quem.`;
}

async function convocar(texto) {
  if (_st.busy) return;
  const pergunta = String(texto || '').trim();
  const m = _st.mesa;
  if (!pergunta) return alert('Escreva a pauta.');
  if (!m.ativos.length) return alert('Escolha pelo menos um conselheiro.');
  const n = m.rodadas.length;
  if (n === 0) m.pauta = pergunta;
  const rodada = { pergunta, pareceres: {}, sintese: null };
  m.ativos.forEach(id => { rodada.pareceres[id] = { status: 'fila', txt: '' }; });
  m.rodadas.push(rodada);
  _st.busy = true;
  saveMesa(); renderBody();

  const prompt = promptRodada(m, pergunta, n);
  // Um por vez, de propósito: o provedor de IA limita chamadas por minuto e 6 em
  // paralelo estouravam o limite (429) — metade da mesa voltava com erro.
  for (const id of m.ativos) await parecer(m, rodada, id, prompt);
  await fecharAta(m, rodada, n);
  _st.busy = false;
  saveMesa();
  if (_st.tab === 'mesa') renderBody();
  salvarAta(m);
}

async function parecer(m, rodada, id, prompt) {
  const c = byId(id);
  const th = (m.threads[id] = m.threads[id] || []);
  th.push({ role: 'user', content: prompt });
  rodada.pareceres[id] = { status: 'pensando', txt: '' };
  if (_st.mesa === m && _st.tab === 'mesa') renderBody();
  try {
    const txt = await chamar(c.agent, th.slice(-12));
    th.push({ role: 'assistant', content: txt });
    rodada.pareceres[id] = { status: 'ok', txt };
  } catch (e) {
    th.pop();   // a pergunta sem resposta sai do fio, senão a próxima rodada manda 2 turnos seguidos do usuário
    rodada.pareceres[id] = { status: 'erro', txt: erroAmigavel(e) };
  }
  saveMesa();
  if (_st.mesa === m && _st.tab === 'mesa') renderBody();
}

async function fecharAta(m, rodada, n) {
  const ok = Object.entries(rodada.pareceres).filter(([, p]) => p.status === 'ok');
  if (!ok.length) { rodada.sintese = { status: 'erro', txt: 'Nenhum conselheiro respondeu. Tente de novo em instantes.' }; return; }
  rodada.sintese = { status: 'pensando', txt: '' };
  if (_st.mesa === m && _st.tab === 'mesa') renderBody();
  const anteriores = m.rodadas.slice(0, n).filter(r => r.sintese && r.sintese.status === 'ok')
    .map((r, i) => `RODADA ${i + 1}: ${r.pergunta}\nATA: ${r.sintese.txt}`).join('\n\n');
  const msg = (anteriores ? `HISTÓRICO DESTA PAUTA:\n${anteriores}\n\n` : '')
    + `${n === 0 ? 'PAUTA' : 'RÉPLICA DO PAULO (rodada ' + (n + 1) + ')'}:\n${rodada.pergunta}\n\nPARECERES DOS CONSELHEIROS:\n\n`
    + ok.map(([id, p]) => { const c = byId(id); return `[${c.nome} · cadeira ${c.cadeira}]\n${p.txt}`; }).join('\n\n———\n\n')
    + '\n\nFeche a ATA desta rodada.';
  try {
    rodada.sintese = { status: 'ok', txt: await chamar('cons_mesa', [{ role: 'user', content: msg }]) };
  } catch (e) {
    rodada.sintese = { status: 'erro', txt: erroAmigavel(e) };
  }
}

async function refazer(i, quem) {
  if (_st.busy) return;
  const m = _st.mesa, rodada = m.rodadas[i];
  if (!rodada) return;
  _st.busy = true;
  if (quem !== 'mesa') {
    await parecer(m, rodada, quem, promptRodada(m, rodada.pergunta, i));
  }
  await fecharAta(m, rodada, i);
  _st.busy = false;
  saveMesa();
  if (_st.tab === 'mesa') renderBody();
  salvarAta(m);
}

/* ── Atas ──────────────────────────────────────────────────────────── */
function ataPayload(m) {
  return {
    id: m.id, pauta: m.pauta,
    rodadas: m.rodadas.map(r => ({
      pergunta: r.pergunta,
      pareceres: Object.fromEntries(Object.entries(r.pareceres).filter(([, p]) => p.status === 'ok').map(([id, p]) => [id, p.txt])),
      sintese: r.sintese && r.sintese.status === 'ok' ? r.sintese.txt : '',
    })).filter(r => Object.keys(r.pareceres).length),
  };
}

async function salvarAta(m) {
  const ata = ataPayload(m);
  if (!ata.rodadas.length) return;
  try { await api.request('/api/v3/ia/conselho', { method: 'POST', body: { action: 'save', ata } }); _st.atas = null; }
  catch (e) { console.warn('[conselho] ata não foi salva:', e.message || e); }
}

function ataTexto(a) {
  const linhas = [`CONSELHO PSM — ${a.pauta || ''}`];
  (a.rodadas || []).forEach((r, i) => {
    linhas.push('', `${i === 0 ? 'PAUTA' : 'RODADA ' + (i + 1)}: ${r.pergunta}`);
    Object.entries(r.pareceres || {}).forEach(([id, p]) => {
      const c = byId(id), txt = typeof p === 'string' ? p : (p.status === 'ok' ? p.txt : '');
      if (c && txt) linhas.push('', `[${c.nome} · ${c.cadeira}]`, txt);
    });
    const s = typeof r.sintese === 'string' ? r.sintese : (r.sintese && r.sintese.status === 'ok' ? r.sintese.txt : '');
    if (s) linhas.push('', 'ATA DO CONSELHO', s);
  });
  return linhas.join('\n');
}

async function copiar(txt, btn) {
  try { await navigator.clipboard.writeText(txt); if (btn) { const o = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = o; }, 1600); } }
  catch { alert('Não deu pra copiar automaticamente.'); }
}

async function loadAtas() {
  try { const r = await api.request('/api/v3/ia/conselho'); _st.atas = r.atas || []; }
  catch (e) { _st.atas = _st.atas || []; _st.atasErro = e.message || 'falha'; }
  if (_st.tab === 'atas') renderAtas();
}

function renderAtas() {
  const body = document.getElementById('cons-body');
  if (!body) return;
  const atas = _st.atas;
  body.innerHTML = atas === null ? '<div class="muted tiny"><span class="spinner"></span> carregando as atas…</div>'
    : atas.length === 0 ? `
      <div style="text-align:center;padding:30px;color:var(--muted)">
        <div style="font-size:36px;margin-bottom:8px">📜</div>
        <div>Nenhuma ata ainda. Leve a primeira pauta à Mesa do Conselho. Cada rodada fechada fica guardada aqui.</div>
        <button class="btn btn-primary" data-tab-go="mesa" style="margin-top:14px">Ir pra Mesa</button>
      </div>`
    : atas.map(a => {
      const aberta = _st.ataAberta === a.id;
      const quando = String(a.ts || '').slice(0, 16).replace('T', ' ');
      return `
        <div style="background:var(--bg-2);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:8px;border-left:4px solid ${LARANJA}">
          <div class="flex" style="gap:8px;align-items:flex-start">
            <button data-abrir="${esc(a.id)}" style="all:unset;cursor:pointer;flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px;line-height:1.4">${aberta ? '▾' : '▸'} ${esc(a.pauta)}</div>
              <div class="tiny muted" style="margin-top:3px">${esc(quando)}${a.por ? ' · ' + esc(a.por) : ''} · ${(a.rodadas || []).length} rodada(s)</div>
            </button>
            <button class="btn btn-ghost tiny" data-copiar="${esc(a.id)}" title="Copiar a ata">📋</button>
            <button class="btn btn-ghost tiny" data-del="${esc(a.id)}" title="Apagar a ata">🗑</button>
          </div>
          ${aberta ? `<div style="margin-top:12px">${(a.rodadas || []).map((r, i) => rodadaHtml({
            pergunta: r.pergunta,
            pareceres: Object.fromEntries(Object.entries(r.pareceres || {}).map(([id, txt]) => [id, { status: 'ok', txt }])),
            sintese: r.sintese ? { status: 'ok', txt: r.sintese } : null,
          }, i)).join('')}</div>` : ''}
        </div>`;
    }).join('');
  body.querySelectorAll('[data-tab-go]').forEach(b => b.addEventListener('click', () => { _st.tab = b.dataset.tabGo; render(); }));
  body.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => { _st.ataAberta = _st.ataAberta === b.dataset.abrir ? null : b.dataset.abrir; renderAtas(); }));
  body.querySelectorAll('[data-copiar]').forEach(b => b.addEventListener('click', () => { const a = (_st.atas || []).find(x => x.id === b.dataset.copiar); if (a) copiar(ataTexto(a), b); }));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Apagar esta ata? Não dá pra desfazer.')) return;
    try {
      await api.request('/api/v3/ia/conselho', { method: 'POST', body: { action: 'del', id: b.dataset.del } });
      _st.atas = (_st.atas || []).filter(a => a.id !== b.dataset.del);
      renderAtas();
    } catch (e) { alert('Erro: ' + (e.message || 'falha')); }
  }));
}

/* ── Chat individual ───────────────────────────────────────────────── */
function renderChat(c) {
  const body = document.getElementById('cons-body');
  if (!body) return;
  const msgs = _st.msgs[c.id] || [];
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:560px">
      <div style="background:var(--bg-3);border-left:4px solid ${LARANJA};border-radius:var(--radius-md);padding:10px 14px;margin-bottom:10px;display:flex;gap:12px;align-items:center">
        ${avatar(c, 40)}
        <div style="min-width:0">
          <div style="font-weight:700;font-size:14px">${c.nome} <span style="color:${LARANJA};font-size:11px;letter-spacing:.06em">· ${c.ico} ${c.cadeira.toUpperCase()}</span></div>
          <div class="tiny muted" style="margin-top:2px">${esc(c.lente)} Conselheiro de IA inspirado nos princípios públicos de ${esc(c.ref)}.</div>
        </div>
      </div>

      <div id="cons-msgs" style="flex:1;overflow-y:auto;padding:10px;background:var(--bg-3);border-radius:var(--radius-md);margin-bottom:10px;display:flex;flex-direction:column;gap:8px">
        ${msgs.length === 0 ? `
          <div style="text-align:center;padding:24px;color:var(--muted)">
            <div style="font-size:36px;margin-bottom:8px">${c.ico}</div>
            <div class="tiny">Comece por uma destas:</div>
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;align-items:center">
              ${c.sugestoes.map(s => `<button class="btn btn-ghost tiny" data-sug="${esc(s)}" style="max-width:460px;white-space:normal;text-align:left">💬 ${esc(s)}</button>`).join('')}
            </div>
          </div>
        ` : msgs.map(m => bubble(m, c)).join('')}
        ${_st.busy ? `<div class="muted tiny"><span class="spinner"></span> ${esc(c.nome)} analisando os dados…</div>` : ''}
      </div>

      <div class="flex gap-2" style="align-items:flex-end">
        <textarea id="cons-input" class="input" rows="2" style="flex:1;min-width:0" placeholder="Pergunte pela cadeira de ${esc(c.cadeira)}… (Cmd/Ctrl+Enter envia)" ${_st.busy ? 'disabled' : ''}></textarea>
        <button class="btn btn-primary" id="cons-send" ${_st.busy ? 'disabled' : ''}>${_st.busy ? '…' : 'Enviar'}</button>
        ${msgs.length ? '<button class="btn btn-ghost" id="cons-clear" title="Limpar conversa">🗑</button>' : ''}
      </div>
    </div>
  `;
  body.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => send(c, b.dataset.sug)));
  document.getElementById('cons-send')?.addEventListener('click', () => send(c));
  document.getElementById('cons-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(c); });
  document.getElementById('cons-clear')?.addEventListener('click', () => {
    if (confirm('Limpar a conversa com ' + c.nome + '?')) { _st.msgs[c.id] = []; saveChat(c.id); renderChat(c); }
  });
  const box = document.getElementById('cons-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

function bubble(m, c) {
  const isUser = m.role === 'user';
  return `
    <div style="display:flex;${isUser ? 'justify-content:flex-end' : ''};gap:8px">
      ${!isUser ? avatar(c, 32) : ''}
      <div style="max-width:78%;background:${isUser ? 'var(--accent)' : 'var(--bg-2)'};color:${isUser ? 'var(--on-accent)' : 'var(--tx)'};padding:10px 14px;border-radius:var(--radius-md);font-size:13px;line-height:1.55;word-wrap:break-word">${isUser ? esc(m.content).replace(/\n/g, '<br>') : fmt(m.content)}</div>
      ${isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-weight:600;flex-shrink:0">${esc((auth.user()?.ini || '?').toUpperCase())}</div>` : ''}
    </div>
  `;
}

async function send(c, textoPronto) {
  if (_st.busy) return;
  const inp = document.getElementById('cons-input');
  const text = (textoPronto || inp?.value || '').trim();
  if (!text) return;
  (_st.msgs[c.id] = _st.msgs[c.id] || []).push({ role: 'user', content: text });
  saveChat(c.id);
  _st.busy = true;
  renderChat(c);
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: c.agent,
      messages: _st.msgs[c.id].slice(-20).map(m => ({ role: m.role, content: m.content })),
    }});
    _st.msgs[c.id].push({ role: 'assistant', content: r.reply || '(sem resposta)' });
    saveChat(c.id);
  } catch (e) {
    _st.msgs[c.id].push({ role: 'assistant', content: '⚠ Erro: ' + (e.message || 'falha') });
  } finally {
    _st.busy = false;
    if (_st.tab === c.id) renderChat(c);
  }
}

/* ── Texto ─────────────────────────────────────────────────────────── */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

// Resposta do modelo → HTML seguro: escapa tudo, depois destaca os rótulos do
// formato do conselho (VEREDITO:, POR QUÊ:…) e o **negrito** que o modelo insiste em usar.
function fmt(s) {
  return esc(s).split('\n').map(l => {
    let x = l.replace(/^#{1,4}\s*/, '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    x = x.replace(/^(\s*)([A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 \-]{2,48}):/, `$1<b style="font-size:11px;letter-spacing:.05em;color:${LARANJA}">$2:</b>`);
    return x;
  }).join('<br>');
}
