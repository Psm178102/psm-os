/* PSM-OS v2 — 🤖 Central da Sol · cockpit COMPLETO da atendente IA (WhatsApp)
   Decisão do sócio (01/set): TODO o controle da Sol vive dentro do House.
   6 abas (padrão de abas da Gestão Comercial/Sucesso do Cliente):
     📊 Visão Geral  — KPIs do dia, gráfico 14d, fila, feed, config resumida
     💬 Conversas    — fila de APROVAÇÃO do copiloto + transcrições completas
     ⏰ Réguas       — editor das cadências (sol_config.reguas; defaults do motor)
     📄 Templates    — templates WABA c/ submit/sync na Graph API
     🔌 Integrações  — status por cabo (env presente × último evento visto)
     📈 Análises     — funil, tempos, performance por régua, custo, QA, heatmap
   Página gated em sócio (lvl>=10) no ROUTE_MIN_LVL; a fila de aprovação usa
   endpoint lvl 5 (a gestão vai operar — ver comentário em api/v3/sol/aprovacao.py).
   Gráficos: Chart.js via loadChartLib (padrão GC); fallback barras CSS.
   Backend: api/v3/sol/{painel,config,aprovacao,templates,analises}.py */
import { api } from '../api.js';
import { loadChartLib } from '../premium.js';

let _host = null, _d = null, _tab = 'visao', _busyCfg = false;
let _fila = null, _filaBusy = false;          // aba Conversas
let _busca = '';
let _an = null, _anDias = 14, _anBusy = false; // aba Análises
let _anOrigem = '__total__';
let _reguas = null, _reguasDirty = false;      // aba Réguas (estado de edição)
let _charts = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = v => Number(v || 0);
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABS = [
  ['visao', '📊 Visão Geral'], ['conversas', '💬 Conversas'], ['reguas', '⏰ Réguas'],
  ['templates', '📄 Templates'], ['integracoes', '🔌 Integrações'], ['analises', '📈 Análises'],
];

/* ═══ Réguas default do MOTOR (cópia dos valores de playground/reguas.py —
   copiado, não importado: o playground não roda no Vercel). Aparecem quando
   sol_config.reguas ainda não existe. ═══ */
const PORTAS = ['janela', 'utilidade', 'marketing'];
const INTENCOES = [
  'resposta_imediata', 'retomar_leve', 'valor_novo', 'simulacao_pronta',
  'condicao_ou_unidade', 'reabertura', 'nutricao', 'regras_mudaram',
  'nova_simulacao', 'case_parecido', 'reabertura_leve', 'novidade_produto',
  'retomar_de_onde_parou', 'reagendar_carinho', 'reagendar_escassez',
];
const REGUAS_DEFAULT = {
  followup_quente: [
    { dias: 0.02, porta: 'janela', intencao: 'resposta_imediata' },
    { dias: 0.2, porta: 'janela', intencao: 'retomar_leve' },
    { dias: 1, porta: 'janela', intencao: 'valor_novo' },
    { dias: 3, porta: 'utilidade', intencao: 'simulacao_pronta' },
    { dias: 7, porta: 'utilidade', intencao: 'condicao_ou_unidade' },
    { dias: 15, porta: 'marketing', intencao: 'reabertura' },
    { dias: 30, porta: 'marketing', intencao: 'nutricao' },
  ],
  reativacao_renda: [
    { dias: 0, porta: 'marketing', intencao: 'regras_mudaram' },
    { dias: 4, porta: 'utilidade', intencao: 'nova_simulacao' },
    { dias: 12, porta: 'marketing', intencao: 'case_parecido' },
    { dias: 30, porta: 'marketing', intencao: 'nutricao' },
  ],
  reativacao_sumiu: [
    { dias: 0, porta: 'marketing', intencao: 'reabertura_leve' },
    { dias: 5, porta: 'marketing', intencao: 'novidade_produto' },
    { dias: 20, porta: 'marketing', intencao: 'nutricao' },
    { dias: 45, porta: 'marketing', intencao: 'nutricao' },
  ],
  reativacao_pasta: [
    { dias: 0, porta: 'marketing', intencao: 'retomar_de_onde_parou' },
    { dias: 3, porta: 'utilidade', intencao: 'condicao_ou_unidade' },
    { dias: 10, porta: 'marketing', intencao: 'novidade_produto' },
    { dias: 30, porta: 'marketing', intencao: 'nutricao' },
  ],
  noshow: [
    { dias: 0.1, porta: 'utilidade', intencao: 'reagendar_carinho' },
    { dias: 1, porta: 'utilidade', intencao: 'reagendar_escassez' },
    { dias: 7, porta: 'marketing', intencao: 'reabertura' },
    { dias: 30, porta: 'marketing', intencao: 'nutricao' },
  ],
  nutricao: [
    { dias: 30, porta: 'marketing', intencao: 'nutricao' },
  ],
};

/* ═══ CSS do módulo (paleta semântica, mesmo esquema da GC) — injetado 1× ═══ */
const SOL_CSS = `
.sol{--sol-ok:#22c55e;--sol-warn:#f59e0b;--sol-err:#ef4444;--sol-acc:#60a5fa;font-variant-numeric:tabular-nums}
:root:not(.dark) .sol{--sol-ok:#16a34a;--sol-warn:#d97706;--sol-err:#dc2626;--sol-acc:#2563eb}
.sol .sol-pan{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md,12px);padding:14px 16px;margin-top:12px}
.sol .sol-pan-t{font-weight:800;font-size:13px;margin-bottom:10px;letter-spacing:.01em}
.sol .sol-tabs{display:flex;gap:4px;margin-top:10px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.sol .sol-tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--ink-muted);padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:-1px}
.sol .sol-tab.on{color:var(--ink);border-bottom-color:var(--sol-acc)}
.sol .sol-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;margin-top:12px}
.sol .sol-kpi{background:var(--bg-2);border:1px solid var(--border);border-left:4px solid var(--kc,var(--border-2));border-radius:var(--r-md,12px);padding:10px 12px;min-width:0}
.sol .sol-kpi .l{font-size:10.5px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sol .sol-kpi .v{font-size:22px;font-weight:900;margin-top:2px}
.sol .sol-kpi .s{font-size:11px;color:var(--ink-2);margin-top:2px}
.sol table{width:100%;border-collapse:collapse}
.sol th{font-weight:600;font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em;padding:4px 8px;text-align:left}
.sol td{padding:5px 8px;border-top:1px solid var(--border);font-size:12.5px}
.sol tbody tr:hover td{background:color-mix(in srgb,var(--ink) 4%,transparent)}
.sol .sol-pill{display:inline-block;padding:0 8px;border-radius:999px;font-size:11px;font-weight:800;line-height:18px;white-space:nowrap}
.sol .sol-feed{max-height:320px;overflow-y:auto}
.sol .sol-ev{display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px dashed var(--border);font-size:12.5px}
.sol .sol-ev:first-child{border-top:0}
.sol .sol-bars{display:flex;gap:4px;align-items:flex-end;height:140px;padding-top:8px}
.sol .sol-bcol{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;min-width:0}
.sol .sol-b{border-radius:3px 3px 0 0;min-height:2px}
.sol .sol-blbl{font-size:9px;color:var(--ink-muted);text-align:center;margin-top:4px;white-space:nowrap;overflow:hidden}
.sol .sol-toggle{display:inline-flex;border:1px solid var(--border-2);border-radius:999px;overflow:hidden}
.sol .sol-toggle button{background:transparent;border:0;color:var(--ink-2);padding:6px 14px;font-size:12.5px;font-weight:800;cursor:pointer}
.sol .sol-toggle button.on{background:var(--sol-acc);color:#fff}
.sol .sol-vazio{text-align:center;padding:34px 16px}
.sol .sol-vazio .big{font-size:40px}
.sol .sol-aprv{background:color-mix(in srgb,var(--sol-warn) 8%,transparent);border:1px solid color-mix(in srgb,var(--sol-warn) 35%,transparent);border-radius:var(--r-md,12px);padding:10px 12px;margin-top:8px}
.sol .sol-aprv .msg{background:var(--bg-3);border-radius:10px;padding:8px 10px;margin-top:6px;font-size:13px;white-space:pre-wrap}
.sol .sol-bub{max-width:78%;border-radius:12px;padding:7px 10px;margin-top:6px;font-size:13px;white-space:pre-wrap;word-break:break-word}
.sol .sol-bub.in{background:var(--bg-3);margin-right:auto;border-bottom-left-radius:4px}
.sol .sol-bub.out{background:color-mix(in srgb,var(--sol-acc) 18%,transparent);margin-left:auto;border-bottom-right-radius:4px}
.sol .sol-sys{text-align:center;font-size:11px;color:var(--ink-muted);margin-top:6px}
.sol .sol-fun{display:flex;flex-direction:column;gap:6px}
.sol .sol-fun .deg{display:flex;align-items:center;gap:8px}
.sol .sol-fun .deg .bar{height:22px;border-radius:5px;background:color-mix(in srgb,var(--sol-acc) 55%,transparent);min-width:2px}
.sol .sol-fun .deg .lbl{width:110px;font-size:11.5px;color:var(--ink-2);font-weight:700;text-align:right;flex:0 0 auto}
.sol .sol-fun .deg .num{font-size:12px;font-weight:800;white-space:nowrap}
.sol .sol-hm{display:grid;grid-template-columns:34px repeat(24,1fr);gap:2px;font-size:9px}
.sol .sol-hm .c{aspect-ratio:1;border-radius:2px;background:var(--bg-3)}
.sol .sol-hm .h{color:var(--ink-muted);text-align:center;align-self:center}
.sol .sol-ratebar{position:relative;background:var(--bg-3);border-radius:4px;height:16px;min-width:90px}
.sol .sol-ratebar i{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--sol-ok) 55%,transparent);border-radius:4px}
.sol .sol-ratebar b{position:relative;font-size:11px;padding-left:6px;line-height:16px}
.sol .input-mini{width:70px}
`;
function injectCss() {
  if (document.getElementById('sol-css')) return;
  const st = document.createElement('style');
  st.id = 'sol-css'; st.textContent = SOL_CSS;
  document.head.appendChild(st);
}

/* ═══ helpers ═══ */
const EV_ICO = {
  msg_in: '📩', msg_recebida: '📩', msg_out: '📤', msg_enviada: '📤',
  toque_regua: '⏰', qualificado: '✅', qualificacao: '✅', simulacao: '🧮',
  agendamento: '📅', handoff: '🤝', escalacao: '🚨', erro: '❌',
  conversa_iniciada: '🌅', conversa_encerrada: '🌇',
  aprovacao_pendente: '⏳', aprovado: '👍', corrigido: '✏️', bloqueado: '🚫',
};
const evIco = t => EV_ICO[String(t || '').toLowerCase()] || '•';

const STATUS_CONV = {
  ativa: ['var(--sol-ok)', 'ativa'], aguardando: ['var(--sol-warn)', 'aguardando'],
  regua: ['var(--sol-acc)', 'régua'], escalada: ['var(--sol-err)', 'escalada'],
  handoff: ['var(--sol-warn)', 'handoff'],
};
function pill(cor, lbl) {
  return `<span class="sol-pill" style="background:color-mix(in srgb,${cor} 14%,transparent);color:${cor}">${lbl}</span>`;
}
function statusPill(s) {
  const k = String(s || '').toLowerCase();
  const [c, lbl] = STATUS_CONV[k] || ['var(--ink-muted)', k || '—'];
  return pill(c, esc(lbl));
}
const STATUS_TPL = {
  aprovado: ['var(--sol-ok)', 'aprovado'], em_analise: ['var(--sol-warn)', 'em análise'],
  rejeitado: ['var(--sol-err)', 'rejeitado'], pausado: ['var(--sol-warn)', 'pausado'],
  rascunho: ['var(--ink-muted)', 'rascunho'],
};
function tplPill(s) {
  const [c, lbl] = STATUS_TPL[String(s || 'rascunho').toLowerCase()] || STATUS_TPL.rascunho;
  return pill(c, esc(lbl));
}
const fmtDT = iso => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};
const fmtDia = iso => { try { const [, m, d] = String(iso).split('-'); return `${d}/${m}`; } catch { return iso; } };
const fmtSeg = s => {
  if (s == null) return '—';
  return s < 60 ? `${Math.round(s)}s` : `${(s / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
};
function txtDoPayload(p) {
  p = p || {};
  return p.texto ?? p.texto_proposto ?? p.texto_final ?? p.text ?? p.body ?? p.mensagem ?? p.message ?? '';
}
function cfgVal(chave) { return ((_d?.config || {})[chave] || {}).valor || {}; }

/* ═══ página ═══ */
export async function pageCentralSol(ctx, root) {
  _host = root;
  injectCss();
  _tab = (ctx?.query?.tab && TABS.some(t => t[0] === ctx.query.tab)) ? ctx.query.tab : 'visao';
  _busca = ''; _fila = null; _an = null; _reguas = null; _reguasDirty = false; _anOrigem = '__total__';
  await reload();
}

async function reload() {
  if (!_host) return;
  _host.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando a Central da Sol…</div></div>';
  try {
    _d = await api.request('/api/v3/sol/painel');
  } catch (e) {
    _host.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message || e)}</div></div>`;
    return;
  }
  render();
}

function render() {
  const wa = cfgVal('numero_whatsapp');
  const conectada = String(wa.status || '') !== 'aguardando_token' && !!_d.config?.token_env_ok;

  _host.innerHTML = `<div class="sol">
    <div class="card" style="padding:10px 14px 0">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0;font-size:16px">🤖 Central da Sol</h2>
        ${pill(conectada ? 'var(--sol-ok)' : 'var(--sol-warn)', conectada ? '🟢 conectada ao WhatsApp' : '⏳ aguardando token da WABA')}
        <span class="tiny muted">atendente IA da PSM Conquista</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-sm btn-ghost" id="sol-reload" title="Atualizar">🔄</button>
      </div>
      <div class="sol-tabs">
        ${TABS.map(([id, lbl]) => `<button class="sol-tab ${id === _tab ? 'on' : ''}" data-tab="${id}">${lbl}</button>`).join('')}
      </div>
    </div>
    <div id="sol-body"></div>
  </div>`;

  _host.querySelector('#sol-reload').onclick = () => { _fila = null; _an = null; reload(); };
  _host.querySelectorAll('.sol-tab').forEach(b => {
    b.onclick = () => {
      if (_reguasDirty && _tab === 'reguas' && !confirm('Sair sem salvar as réguas editadas?')) return;
      _tab = b.dataset.tab; render();
    };
  });

  const body = _host.querySelector('#sol-body');
  ({ visao: rVisao, conversas: rConversas, reguas: rReguas, templates: rTemplates, integracoes: rIntegracoes, analises: rAnalises }[_tab] || rVisao)(body);
}

/* ═══════════════════ ABA 1 — VISÃO GERAL ═══════════════════ */
function rVisao(body) {
  const hoje = _d.hoje || {};
  const convs = _d.conversas || [];
  const evs = _d.eventos || [];
  const wa = cfgVal('numero_whatsapp');
  const conectada = String(wa.status || '') !== 'aguardando_token' && !!_d.config?.token_env_ok;
  const modo = String(cfgVal('autonomia_padrao').modo || 'copiloto');
  const persona = cfgVal('persona_versao').versao || '—';
  const semDados = !convs.length && !evs.length;
  const erros = n0(hoje.erros);

  const kpi = (lbl, v, cor) => `
    <div class="sol-kpi" style="--kc:${cor || 'var(--border-2)'}">
      <div class="l">${lbl}</div><div class="v" style="${cor ? `color:${cor}` : ''}">${v}</div>
    </div>`;

  body.innerHTML = `
    <div class="sol-kpis">
      ${kpi('Conversas ativas', convs.length, 'var(--sol-acc)')}
      ${kpi('Msgs recebidas', n0(hoje.msgs_recebidas))}
      ${kpi('Msgs enviadas', n0(hoje.msgs_enviadas))}
      ${kpi('Qualificados', n0(hoje.qualificados), 'var(--sol-ok)')}
      ${kpi('Simulações', n0(hoje.simulacoes))}
      ${kpi('Agendamentos', n0(hoje.agendamentos), 'var(--sol-ok)')}
      ${kpi('Escalações', n0(hoje.escalacoes), n0(hoje.escalacoes) > 0 ? 'var(--sol-warn)' : undefined)}
      ${kpi('Erros', erros, erros > 0 ? 'var(--sol-err)' : undefined)}
    </div>

    ${semDados ? `
    <div class="sol-pan sol-vazio">
      <div class="big">☀️</div>
      <div style="font-weight:800;font-size:15px;margin-top:6px">A Sol ainda não está conectada ao WhatsApp</div>
      <div class="tiny muted" style="margin-top:6px;max-width:440px;margin-left:auto;margin-right:auto">
        ${conectada
          ? 'Conexão ok — nenhuma conversa registrada ainda. Assim que o primeiro lead chamar, tudo aparece aqui.'
          : 'Aguardando o token da WABA (Meta Cloud API). Quando o token entrar no Vercel e o número for ativado, as conversas, métricas e a régua aparecem aqui automaticamente.'}
      </div>
    </div>` : `
    <div class="sol-pan">
      <div class="sol-pan-t">📆 Últimos 14 dias — <span style="color:var(--sol-ok)">agendamentos</span> × <span style="color:var(--sol-acc)">qualificados</span></div>
      <div id="sol-graf" style="position:relative;height:180px"><canvas id="sol-canvas"></canvas></div>
    </div>

    <div class="sol-pan">
      <div class="sol-pan-t">💬 Conversas ativas <span class="tiny muted">(${convs.length} · prioridade desc — detalhe na aba Conversas)</span></div>
      ${tabelaConversas(convs.slice(0, 15), false)}
    </div>

    <div class="sol-pan">
      <div class="sol-pan-t">📜 Últimos eventos</div>
      <div class="sol-feed">
        ${evs.map(ev => `<div class="sol-ev">
          <span>${evIco(ev.tipo)}</span><span style="font-weight:700">${esc(ev.tipo || '?')}</span>
          ${ev.conversa_id ? `<span class="tiny muted">conversa #${esc(ev.conversa_id)}</span>` : ''}
          <span class="tiny muted" style="margin-left:auto">${fmtDT(ev.criado_em)}</span>
        </div>`).join('') || '<div class="tiny muted" style="text-align:center;padding:12px">nenhum evento ainda</div>'}
      </div>
    </div>`}

    <div class="sol-pan">
      <div class="sol-pan-t">⚙️ Configuração</div>
      <div class="flex" style="gap:18px;flex-wrap:wrap;align-items:center">
        <div>
          <div class="tiny muted">Número WhatsApp</div>
          <div style="font-weight:800">${esc(wa.numero_mascarado || '—')}
            ${pill(_d.config?.token_env_ok ? 'var(--sol-ok)' : 'var(--sol-warn)', _d.config?.token_env_ok ? 'token ok' : 'sem token no Vercel')}
          </div>
        </div>
        <div>
          <div class="tiny muted">Modo de autonomia</div>
          <div class="sol-toggle" style="margin-top:2px">
            <button id="sol-md-copiloto" class="${modo === 'copiloto' ? 'on' : ''}">🧑‍✈️ Copiloto</button>
            <button id="sol-md-autonoma" class="${modo === 'autonoma' ? 'on' : ''}">⚡ Autônoma</button>
          </div>
          <div class="tiny muted" style="margin-top:3px">${modo === 'copiloto' ? 'a Sol sugere, humano aprova cada envio' : 'a Sol responde sozinha (escala quando trava)'}</div>
        </div>
        <div>
          <div class="tiny muted">Versão da persona</div>
          <div style="font-weight:800">${esc(persona)}</div>
        </div>
        <div>
          <div class="tiny muted">Custos fixos mensais <span title="rateados pro-rata/dia no bloco Gastos (aba Análises)">ℹ️</span></div>
          <div class="flex items-center" style="gap:6px;margin-top:2px;flex-wrap:wrap">
            <label class="tiny muted">infra R$</label>
            <input id="sol-fx-infra" type="number" min="0" max="100000" step="0.01" class="input input-sm input-mini" value="${esc(cfgVal('custos_fixos').infra_mensal_brl ?? '')}" placeholder="0">
            <label class="tiny muted">ElevenLabs R$</label>
            <input id="sol-fx-eleven" type="number" min="0" max="100000" step="0.01" class="input input-sm input-mini" value="${esc(cfgVal('custos_fixos').elevenlabs_mensal_brl ?? '')}" placeholder="0">
            <button class="btn btn-sm btn-ghost" id="sol-fx-save">💾</button>
          </div>
        </div>
      </div>
    </div>`;

  const btC = body.querySelector('#sol-md-copiloto');
  const btA = body.querySelector('#sol-md-autonoma');
  if (btC) btC.onclick = () => setModo('copiloto');
  if (btA) btA.onclick = () => setModo('autonoma');
  body.querySelector('#sol-fx-save').onclick = async () => {
    const valor = {
      infra_mensal_brl: Number(body.querySelector('#sol-fx-infra').value || 0),
      elevenlabs_mensal_brl: Number(body.querySelector('#sol-fx-eleven').value || 0),
    };
    try {
      await api.request('/api/v3/sol/config', { method: 'POST', body: { chave: 'custos_fixos', valor } });
      (_d.config = _d.config || {}).custos_fixos = { valor };
      _an = null;   // gastos da aba Análises mudam com o rateio novo
      alert('✅ Custos fixos salvos — o rateio entra no bloco Gastos.');
    } catch (e) { alert('❌ Não salvou: ' + (e.message || e)); }
  };
  if (!semDados) desenhaGraficoVisao(body);
}

function tabelaConversas(convs, clicavel) {
  return `<div style="overflow-x:auto"><table>
    <thead><tr><th>Lead</th><th>Origem</th><th>Etapa</th><th>Régua</th><th>Próximo toque</th><th style="text-align:right">Prior.</th><th>Status</th></tr></thead>
    <tbody>
      ${convs.map(c => `<tr ${clicavel ? `class="sol-conv-row" data-id="${esc(c.id)}" style="cursor:pointer"` : ''}>
        <td><b>${esc(c.nome || '(sem nome)')}</b> <span class="tiny muted">${esc(c.telefone || '')}</span></td>
        <td>${esc(c.origem || '—')}</td>
        <td>${esc(c.etapa_funil || '—')}</td>
        <td>${esc(c.regua || '—')}${c.passo != null ? ` <span class="tiny muted">#${esc(c.passo)}</span>` : ''}</td>
        <td>${fmtDT(c.proximo_toque_em)}</td>
        <td style="text-align:right;font-weight:800">${n0(c.prioridade).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
        <td>${statusPill(c.status)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="tiny muted" style="text-align:center;padding:14px">nenhuma conversa ativa agora</td></tr>'}
    </tbody>
  </table></div>`;
}

async function setModo(modo) {
  if (_busyCfg || String(cfgVal('autonomia_padrao').modo || 'copiloto') === modo) return;
  if (modo === 'autonoma' && !confirm('⚡ Colocar a Sol em modo AUTÔNOMO? Ela passa a responder leads sozinha (escalando quando travar).')) return;
  _busyCfg = true;
  try {
    await api.request('/api/v3/sol/config', { method: 'POST', body: { chave: 'autonomia_padrao', valor: { modo } } });
    (_d.config = _d.config || {}).autonomia_padrao = { valor: { modo } };
    render();
  } catch (e) { alert('❌ Não salvou: ' + (e.message || e)); }
  _busyCfg = false;
}

/* ═══════════════════ ABA 2 — CONVERSAS (fila copiloto + transcrição) ═══ */
async function rConversas(body) {
  const convs = _d.conversas || [];
  if (_fila === null && !_filaBusy) {
    _filaBusy = true;
    body.innerHTML = '<div class="sol-pan"><span class="spinner"></span> <span class="muted">Carregando a fila de aprovação…</span></div>';
    try { _fila = (await api.request('/api/v3/sol/aprovacao')).fila || []; }
    catch (e) { _fila = []; console.warn('[sol] fila:', e.message); }
    _filaBusy = false;
  }
  const q = _busca.toLowerCase();
  const lista = q ? convs.filter(c => (c.nome || '').toLowerCase().includes(q) || (c.telefone || '').includes(q)) : convs;

  body.innerHTML = `
    <div class="sol-pan">
      <div class="sol-pan-t">⏳ Fila de aprovação <span class="tiny muted">(modo copiloto — cada mensagem proposta espera um humano)</span></div>
      ${(_fila || []).map(p => `
        <div class="sol-aprv" data-eid="${esc(p.id)}">
          <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
            <b style="font-size:13px">${esc(p.nome || '(sem nome)')}</b>
            <span class="tiny muted">${esc(p.telefone || '')} · ${esc(p.origem || '—')} · ${fmtDT(p.criado_em)}</span>
          </div>
          <div class="msg">${esc(txtDoPayload(p.payload) || '(mensagem vazia)')}</div>
          <div class="flex" style="gap:6px;margin-top:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-primary sol-ap" data-eid="${esc(p.id)}" data-acao="aprovado">👍 Aprovar</button>
            <button class="btn btn-sm btn-ghost sol-ap-fix" data-eid="${esc(p.id)}">✏️ Corrigir</button>
            <button class="btn btn-sm btn-ghost sol-ap" data-eid="${esc(p.id)}" data-acao="bloqueado" style="color:var(--sol-err)">🚫 Bloquear</button>
          </div>
          <div class="sol-fixbox" data-eid="${esc(p.id)}" style="display:none;margin-top:8px">
            <textarea class="input" rows="3" style="width:100%">${esc(txtDoPayload(p.payload))}</textarea>
            <button class="btn btn-sm btn-primary sol-ap-send" data-eid="${esc(p.id)}" style="margin-top:6px">Enviar correção</button>
          </div>
        </div>`).join('') || '<div class="tiny muted" style="padding:8px 0">nada esperando aprovação 🎉</div>'}
    </div>

    <div class="sol-pan">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <div class="sol-pan-t" style="margin:0">💬 Conversas <span class="tiny muted">(${lista.length})</span></div>
        <span style="margin-left:auto"></span>
        <input id="sol-busca" class="input input-sm" placeholder="🔎 nome ou telefone" value="${esc(_busca)}" style="width:200px">
      </div>
      <div style="margin-top:8px">${tabelaConversas(lista, true)}</div>
      <div class="tiny muted" style="margin-top:6px">clique numa conversa pra ver a transcrição completa</div>
    </div>`;

  const busca = body.querySelector('#sol-busca');
  let t = null;
  busca.oninput = () => { clearTimeout(t); t = setTimeout(() => { _busca = busca.value; rConversas(body); }, 250); };
  body.querySelectorAll('.sol-conv-row').forEach(r => { r.onclick = () => abrirTranscricao(r.dataset.id); });
  body.querySelectorAll('.sol-ap').forEach(b => { b.onclick = () => decidir(b.dataset.eid, b.dataset.acao, null, body); });
  body.querySelectorAll('.sol-ap-fix').forEach(b => {
    b.onclick = () => {
      const box = body.querySelector(`.sol-fixbox[data-eid="${b.dataset.eid}"]`);
      if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    };
  });
  body.querySelectorAll('.sol-ap-send').forEach(b => {
    b.onclick = () => {
      const box = body.querySelector(`.sol-fixbox[data-eid="${b.dataset.eid}"]`);
      const texto = box ? box.querySelector('textarea').value.trim() : '';
      if (!texto) return alert('Escreva o texto corrigido.');
      decidir(b.dataset.eid, 'corrigido', texto, body);
    };
  });
}

async function decidir(eventoId, acao, texto, body) {
  if (acao === 'bloqueado' && !confirm('🚫 Bloquear esta mensagem? A Sol NÃO vai enviar nada pra esse lead neste toque.')) return;
  try {
    await api.request('/api/v3/sol/aprovacao', { method: 'POST', body: { evento_id: Number(eventoId), acao, texto: texto || undefined } });
    _fila = (_fila || []).filter(p => String(p.id) !== String(eventoId));
    rConversas(body);
  } catch (e) { alert('❌ ' + (e.message || e)); }
}

async function abrirTranscricao(conversaId) {
  let d = null;
  try { d = await api.request('/api/v3/sol/aprovacao?conversa_id=' + encodeURIComponent(conversaId)); }
  catch (e) { return alert('❌ ' + (e.message || e)); }
  const c = d.conversa || {};
  const evs = d.eventos || [];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  wrap.innerHTML = `
    <div class="card sol" style="max-width:560px;width:100%;max-height:84vh;display:flex;flex-direction:column;padding:16px" onclick="event.stopPropagation()">
      <div class="flex items-center" style="gap:8px">
        <h3 style="margin:0;flex:1;font-size:15px">💬 ${esc(c.nome || '(sem nome)')} <span class="tiny muted">${esc(c.telefone || '')}</span></h3>
        <button class="btn btn-sm btn-ghost" id="solm-x">✕</button>
      </div>
      <div class="tiny muted" style="margin-top:4px">${esc(c.origem || '—')} · etapa ${esc(c.etapa_funil || '—')} · régua ${esc(c.regua || '—')} · ${statusPill(c.status)}</div>
      <div style="overflow-y:auto;margin-top:10px;padding-right:4px;display:flex;flex-direction:column">
        ${evs.map(ev => {
          const tipo = String(ev.tipo || '').toLowerCase();
          const txt = txtDoPayload(ev.payload);
          if (tipo === 'msg_recebida' || tipo === 'msg_in') return `<div class="sol-bub in">${esc(txt || '(sem texto)')}<div class="tiny muted" style="margin-top:2px">${fmtDT(ev.criado_em)}</div></div>`;
          if (tipo === 'msg_enviada' || tipo === 'msg_out') return `<div class="sol-bub out">${esc(txt || '(sem texto)')}<div class="tiny muted" style="margin-top:2px">${fmtDT(ev.criado_em)}</div></div>`;
          return `<div class="sol-sys">${evIco(tipo)} ${esc(tipo)}${txt ? ` · ${esc(String(txt).slice(0, 80))}` : ''} · ${fmtDT(ev.criado_em)}</div>`;
        }).join('') || '<div class="tiny muted" style="text-align:center;padding:16px">sem eventos nessa conversa</div>'}
      </div>
    </div>`;
  wrap.onclick = () => wrap.remove();
  wrap.querySelector('#solm-x').onclick = () => wrap.remove();
  document.body.appendChild(wrap);
  const roll = wrap.querySelector('[style*="overflow-y"]');
  if (roll) roll.scrollTop = roll.scrollHeight;
}

/* ═══════════════════ ABA 3 — RÉGUAS (editor de cadências) ═══════════════ */
function rReguas(body) {
  const salvas = cfgVal('reguas');
  const usandoDefault = !salvas || !Object.keys(salvas).length;
  if (_reguas === null) _reguas = JSON.parse(JSON.stringify(usandoDefault ? REGUAS_DEFAULT : salvas));

  const selPorta = (v, r, i) => `<select class="input input-sm sol-rg" data-r="${esc(r)}" data-i="${i}" data-f="porta">
    ${PORTAS.map(p => `<option value="${p}" ${p === v ? 'selected' : ''}>${p}</option>`).join('')}</select>`;
  const selInt = (v, r, i) => {
    const ops = INTENCOES.includes(v) ? INTENCOES : [v, ...INTENCOES];
    return `<select class="input input-sm sol-rg" data-r="${esc(r)}" data-i="${i}" data-f="intencao">
      ${ops.map(p => `<option value="${esc(p)}" ${p === v ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`;
  };

  body.innerHTML = `
    <div class="sol-pan">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <div class="sol-pan-t" style="margin:0">⏰ Réguas de cadência</div>
        ${usandoDefault && !_reguasDirty ? pill('var(--ink-muted)', 'usando padrão do motor') : ''}
        ${_reguasDirty ? pill('var(--sol-warn)', 'alterações não salvas') : ''}
        <span style="margin-left:auto"></span>
        <button class="btn btn-sm btn-ghost" id="sol-rg-reset">↩︎ Voltar ao padrão</button>
        <button class="btn btn-sm btn-primary" id="sol-rg-save">💾 Salvar réguas</button>
      </div>
      <div class="tiny muted" style="margin-top:4px">
        LEI FUNDAMENTAL do motor: nenhum lead sem próximo toque. dias = corridos desde o último evento
        (0.02 ≈ 30min) · porta: janela (grátis, 24h aberta) / utilidade (~R$0,04) / marketing (~R$0,35).
      </div>
      ${Object.entries(_reguas).map(([nome, passos]) => `
        <div style="margin-top:14px">
          <div class="flex items-center" style="gap:8px">
            <b style="font-size:13px">${esc(nome)}</b>
            <span class="tiny muted">${passos.length} passo(s)</span>
            <button class="btn btn-sm btn-ghost sol-rg-add" data-r="${esc(nome)}" style="margin-left:auto">+ passo</button>
          </div>
          <div style="overflow-x:auto"><table style="margin-top:4px">
            <thead><tr><th>#</th><th>dias</th><th>porta</th><th>intenção</th><th></th></tr></thead>
            <tbody>
              ${passos.map((p, i) => `<tr>
                <td class="tiny muted">${i + 1}</td>
                <td><input type="number" min="0" max="365" step="0.01" class="input input-sm input-mini sol-rg" data-r="${esc(nome)}" data-i="${i}" data-f="dias" value="${esc(p.dias)}"></td>
                <td>${selPorta(p.porta, nome, i)}</td>
                <td>${selInt(p.intencao, nome, i)}</td>
                <td><button class="btn btn-sm btn-ghost sol-rg-del" data-r="${esc(nome)}" data-i="${i}" title="remover passo">✕</button></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>`).join('')}
    </div>`;

  body.querySelectorAll('.sol-rg').forEach(el => {
    el.onchange = () => {
      const { r, i, f } = el.dataset;
      _reguas[r][Number(i)][f] = f === 'dias' ? Number(el.value) : el.value;
      _reguasDirty = true;
    };
  });
  body.querySelectorAll('.sol-rg-add').forEach(b => {
    b.onclick = () => { _reguas[b.dataset.r].push({ dias: 30, porta: 'marketing', intencao: 'nutricao' }); _reguasDirty = true; rReguas(body); };
  });
  body.querySelectorAll('.sol-rg-del').forEach(b => {
    b.onclick = () => {
      const l = _reguas[b.dataset.r];
      if (l.length <= 1) return alert('Régua precisa de pelo menos 1 passo (lei do motor: sempre há próximo toque).');
      l.splice(Number(b.dataset.i), 1); _reguasDirty = true; rReguas(body);
    };
  });
  body.querySelector('#sol-rg-reset').onclick = () => {
    if (!confirm('Voltar TODAS as réguas ao padrão do motor? (só aplica de verdade ao Salvar)')) return;
    _reguas = JSON.parse(JSON.stringify(REGUAS_DEFAULT)); _reguasDirty = true; rReguas(body);
  };
  body.querySelector('#sol-rg-save').onclick = async () => {
    try {
      await api.request('/api/v3/sol/config', { method: 'POST', body: { chave: 'reguas', valor: _reguas } });
      (_d.config = _d.config || {}).reguas = { valor: JSON.parse(JSON.stringify(_reguas)) };
      _reguasDirty = false;
      rReguas(body);
      alert('✅ Réguas salvas — o motor passa a usar essa cadência.');
    } catch (e) { alert('❌ Não salvou: ' + (e.message || e)); }
  };
}

/* ═══════════════════ ABA 4 — TEMPLATES (WABA × Graph API) ═══════════════ */
function rTemplates(body) {
  const tpls = (cfgVal('templates') && Array.isArray(cfgVal('templates'))) ? cfgVal('templates')
    : (Array.isArray((_d.config?.templates || {}).valor) ? _d.config.templates.valor : []);
  body.innerHTML = `
    <div class="sol-pan">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <div class="sol-pan-t" style="margin:0">📄 Templates de WhatsApp</div>
        <span class="tiny muted">mensagens fora da janela de 24h precisam de template aprovado pela Meta</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-sm btn-ghost" id="sol-tpl-sync">🔄 Sincronizar status</button>
      </div>
      ${tpls.length ? `<div style="overflow-x:auto;margin-top:8px"><table>
        <thead><tr><th>Nome</th><th>Categoria</th><th>Corpo</th><th>Status Meta</th><th></th></tr></thead>
        <tbody>
          ${tpls.map(t => `<tr>
            <td><b>${esc(t.nome)}</b>${t.template_id ? `<div class="tiny muted">id ${esc(t.template_id)}</div>` : ''}</td>
            <td>${esc(t.categoria || 'UTILITY')}</td>
            <td class="tiny" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.corpo || '')}">${esc(t.corpo || '—')}</td>
            <td>${tplPill(t.status_meta)}</td>
            <td><button class="btn btn-sm btn-ghost sol-tpl-sub" data-nome="${esc(t.nome)}" ${String(t.status_meta || '') === 'aprovado' ? 'disabled' : ''}>📨 Submeter à Meta</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `
      <div class="sol-vazio">
        <div class="big">📄</div>
        <div style="font-weight:800;margin-top:6px">Nenhum template cadastrado ainda</div>
        <div class="tiny muted" style="margin-top:4px;max-width:440px;margin-left:auto;margin-right:auto">
          Os templates (toques de utilidade e marketing das réguas) entram na chave
          <code>templates</code> de sol_config e aparecem aqui pra submeter à Meta quando a WABA sair.</div>
      </div>`}
    </div>`;

  body.querySelector('#sol-tpl-sync').onclick = () => acaoTemplate({ action: 'sync' });
  body.querySelectorAll('.sol-tpl-sub').forEach(b => {
    b.onclick = () => {
      if (!confirm(`📨 Submeter o template "${b.dataset.nome}" pra aprovação da Meta?`)) return;
      acaoTemplate({ action: 'submit', nome: b.dataset.nome });
    };
  });
}

async function acaoTemplate(payload) {
  try {
    const r = await api.request('/api/v3/sol/templates', { method: 'POST', body: payload });
    alert(payload.action === 'sync' ? `✅ Sincronizado — ${r.atualizados || 0} status atualizados.` : '✅ Submetido — em análise na Meta.');
    reload();
  } catch (e) { alert('⚠️ ' + (e.message || e)); }
}

/* ═══════════════════ ABA 5 — INTEGRAÇÕES (cabos) ════════════════════════ */
function rIntegracoes(body) {
  const cabos = _d.integracoes || {};
  const card = (id, c) => {
    // cinza = env ausente · verde = env ok E já viu evento · vermelho = env ok mas cabo MUDO
    const cor = !c.env_ok ? 'var(--ink-muted)' : (c.ultimo_evento ? 'var(--sol-ok)' : 'var(--sol-err)');
    const lbl = !c.env_ok ? 'não configurado' : (c.ultimo_evento ? 'ativo' : 'sem eventos');
    return `<div class="sol-kpi" style="--kc:${cor}">
      <div class="l">${esc(c.lbl || id)}</div>
      <div style="margin-top:4px">${pill(cor, lbl)}</div>
      <div class="s">${c.ultimo_evento ? `último: ${esc(c.ultimo_evento.tipo)} · ${fmtDT(c.ultimo_evento.criado_em)}` : (c.env_ok ? 'nenhum evento com esse cabo ainda' : 'aguardando envs no Vercel')}</div>
      <div class="tiny muted" style="margin-top:4px;font-family:monospace">${(c.envs || []).map(esc).join(' · ')}</div>
    </div>`;
  };
  body.innerHTML = `
    <div class="sol-pan">
      <div class="sol-pan-t">🔌 Cabos da Sol <span class="tiny muted">(env presente no Vercel × último evento com payload.origem_cabo)</span></div>
      <div class="sol-kpis" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
        ${Object.entries(cabos).map(([id, c]) => card(id, c)).join('') || '<div class="tiny muted">painel ainda não devolveu integrações — atualize a página</div>'}
      </div>
      <div class="tiny muted" style="margin-top:8px">o valor dos tokens NUNCA aparece aqui — só a presença (booleano) de cada env.</div>
    </div>`;
}

/* ═══════════════════ ABA 6 — ANÁLISES ═══════════════════════════════════ */
async function rAnalises(body) {
  if ((_an === null || _an.dias !== _anDias) && !_anBusy) {
    _anBusy = true;
    body.innerHTML = '<div class="sol-pan"><span class="spinner"></span> <span class="muted">Rodando as análises…</span></div>';
    try { _an = await api.request('/api/v3/sol/analises?dias=' + _anDias); }
    catch (e) { _anBusy = false; body.innerHTML = `<div class="sol-pan"><div class="alert alert-err">${esc(e.message || e)}</div></div>`; return; }
    _anBusy = false;
  }
  const an = _an || {};
  const funil = an.funil || [];
  const tot = an.funil_total || {};
  const linha = _anOrigem === '__total__' ? tot : (funil.find(f => f.origem === _anOrigem) || tot);
  const tempos = an.tempos || {};
  const reguas = an.reguas || [];
  const custos = an.custos || {};
  const qual = an.qualidade || {};
  const heat = an.heatmap || [];

  const ETAPAS = [
    ['conversas', 'Conversas'], ['qualificados', 'Qualificados'], ['simularam', 'Simularam'],
    ['viram_card', 'Viraram card'], ['agendaram', 'Agendaram'], ['handoffs', 'Handoffs'], ['ganhos', 'Ganhos'],
  ];
  const base = n0(linha.conversas);
  const degraus = ETAPAS.map(([k, lbl], i) => {
    const v = n0(linha[k]);
    const ant = i === 0 ? v : n0(linha[ETAPAS[i - 1][0]]);
    const convPct = i === 0 ? null : (ant ? Math.round(100 * v / ant) : 0);
    const w = base ? Math.max(2, Math.round(100 * v / base)) : 2;
    return `<div class="deg">
      <span class="lbl">${lbl}</span>
      <div class="bar" style="width:${w}%"></div>
      <span class="num">${v}${convPct !== null ? ` <span class="tiny muted">(${convPct}%)</span>` : ''}</span>
    </div>`;
  }).join('');

  const kpi = (lbl, v, sub, cor) => `
    <div class="sol-kpi" style="--kc:${cor || 'var(--border-2)'}">
      <div class="l">${lbl}</div><div class="v" style="${cor ? `color:${cor}` : ''}">${v}</div>
      ${sub ? `<div class="s">${sub}</div>` : ''}
    </div>`;

  // heatmap 7×24 — CSS puro (dia_semana: 0=domingo, padrão extract(dow))
  const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const hmap = {};
  let hmax = 0;
  heat.forEach(r => { const v = n0(r.respostas); hmap[`${r.dia_semana}:${r.hora}`] = v; if (v > hmax) hmax = v; });
  const heatHtml = `<div class="sol-hm">
    <span></span>${Array.from({ length: 24 }, (_, h) => `<span class="h">${h % 3 === 0 ? h : ''}</span>`).join('')}
    ${DIAS_SEM.map((dl, dsi) => `<span class="h" style="text-align:right;padding-right:4px">${dl}</span>` +
      Array.from({ length: 24 }, (_, h) => {
        const v = hmap[`${dsi}:${h}`] || 0;
        const alpha = hmax ? Math.round(100 * v / hmax) : 0;
        return `<span class="c" title="${dl} ${h}h — ${v} resposta(s)" style="${v ? `background:color-mix(in srgb,var(--sol-acc) ${Math.max(12, alpha)}%,var(--bg-3))` : ''}"></span>`;
      }).join('')).join('')}
  </div>`;

  body.innerHTML = `
    <div class="sol-pan">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <div class="sol-pan-t" style="margin:0">⏬ Funil da Sol</div>
        <select id="sol-an-origem" class="input input-sm" style="width:auto">
          <option value="__total__">todas as origens</option>
          ${funil.map(f => `<option value="${esc(f.origem)}" ${f.origem === _anOrigem ? 'selected' : ''}>${esc(f.origem || '(sem origem)')}</option>`).join('')}
        </select>
        <span style="margin-left:auto"></span>
        <div class="sol-toggle">
          ${[14, 30, 90].map(d => `<button class="sol-an-dias ${d === _anDias ? 'on' : ''}" data-d="${d}">${d}d</button>`).join('')}
        </div>
      </div>
      <div class="tiny muted" style="margin-top:2px">funil e réguas são acumulados (all-time); tempos, custo e qualidade seguem a janela escolhida</div>
      ${base ? `<div class="sol-fun" style="margin-top:12px">${degraus}</div>
      <div class="tiny muted" style="margin-top:8px">🚪 opt-outs: ${n0(linha.opt_outs)}</div>`
      : '<div class="sol-vazio"><div class="big">⏬</div><div class="tiny muted" style="margin-top:6px">sem conversas no funil ainda — os degraus aparecem com o primeiro lead</div></div>'}
    </div>

    <div class="sol-kpis" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      ${kpi('Mediana 1ª resposta', fmtSeg(tempos.mediana_1a_resposta_s), `${n0(tempos.conversas)} conversa(s) na janela`, 'var(--sol-acc)')}
      ${kpi('Respondidas < 1 min', tempos.pct_menos_1min != null ? tempos.pct_menos_1min + '%' : '—', null, 'var(--sol-ok)')}
      ${kpi('Média msgs/conversa', tempos.media_msgs_por_conversa ?? '—')}
    </div>

    <div class="sol-pan">
      <div class="sol-pan-t">⏰ Performance por régua <span class="tiny muted">(taxa de resposta por passo)</span></div>
      ${reguas.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>Régua</th><th>#</th><th>Intenção</th><th style="text-align:right">Toques</th><th style="text-align:right">Respostas</th><th>Taxa</th></tr></thead>
        <tbody>${reguas.map(r => {
          const pct = Number(r.taxa_resposta_pct || 0);
          return `<tr>
            <td><b>${esc(r.regua)}</b></td><td class="tiny muted">${esc(r.passo)}</td><td>${esc(r.intencao || '—')}</td>
            <td style="text-align:right">${n0(r.toques_enviados)}</td><td style="text-align:right">${n0(r.respostas)}</td>
            <td><div class="sol-ratebar"><i style="width:${Math.min(100, pct)}%"></i><b>${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b></div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div class="tiny muted" style="padding:8px 0">nenhum toque de régua enviado ainda</div>'}
    </div>

    <div class="sol-pan">
      <div class="sol-pan-t">💰 Gastos <span class="tiny muted">(custo Meta + IA declarado por evento · fixos rateados/dia · janela de ${_anDias}d)</span></div>
      ${Number(custos.total) > 0 || Number(custos.acumulado_mes) > 0 ? `
      <div class="sol-kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        ${kpi('Gasto no período', brl(custos.total), `Meta ${brl(custos.templates)} · IA ${brl(custos.ia)} · fixos ${brl(custos.fixos)}`, 'var(--sol-warn)')}
        ${kpi('Acumulado do mês', brl(custos.acumulado_mes))}
        ${kpi('Projeção do mês', custos.projecao_mes != null ? brl(custos.projecao_mes) : '—', 'projeção pela média diária', 'var(--sol-acc)')}
        ${kpi('Por qualificado', custos.por_qualificado != null ? brl(custos.por_qualificado) : '—', `${n0(custos.qualificados)} qualificado(s)`)}
        ${kpi('Por agendamento', custos.por_agendamento != null ? brl(custos.por_agendamento) : '—', `${n0(custos.agendamentos)} agendamento(s)`)}
      </div>
      <div id="sol-custo-graf" style="position:relative;height:170px;margin-top:10px"><canvas id="sol-custo-canvas"></canvas></div>
      <div class="tiny muted" style="margin-top:6px">pilha: <span style="color:#f59e0b">Meta (templates)</span> · <span style="color:#a78bfa">IA</span> · <span style="color:#64748b">fixos rateados</span> — linha = acumulado no período${Number(custos.fixo_mensal_brl) ? ` · fixos declarados: ${brl(custos.fixo_mensal_brl)}/mês` : ''}</div>`
      : `<div class="sol-vazio"><div class="big">💰</div>
        <div class="tiny muted" style="margin-top:6px">os gastos aparecem junto com as primeiras conversas — cada evento da Sol declara seu custo</div></div>`}
    </div>

    <div class="sol-pan">
      <div class="sol-pan-t">🧑‍⚖️ Qualidade (juiz de QA)</div>
      ${qual.auditorias ? `<div class="sol-kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        ${kpi('Nota média', qual.nota_media ?? '—', `${n0(qual.auditorias)} auditoria(s)`, Number(qual.nota_media) >= 8 ? 'var(--sol-ok)' : Number(qual.nota_media) >= 7 ? 'var(--sol-warn)' : 'var(--sol-err)')}
        ${kpi('Abaixo de 7', n0(qual.abaixo_de_7), 'conversas pra revisar', n0(qual.abaixo_de_7) > 0 ? 'var(--sol-err)' : 'var(--sol-ok)')}
      </div>` : `<div class="sol-vazio"><div class="big">🧑‍⚖️</div>
        <div class="tiny muted" style="margin-top:6px">o juiz de QA começa a auditar junto com o piloto</div></div>`}
    </div>

    <div class="sol-pan">
      <div class="sol-pan-t">🕒 Quando os leads respondem <span class="tiny muted">(dia da semana × hora)</span></div>
      ${hmax ? `<div style="overflow-x:auto;min-width:0">${heatHtml}</div>`
      : '<div class="tiny muted" style="padding:8px 0">sem respostas registradas ainda — o mapa esquenta com o uso</div>'}
    </div>`;

  body.querySelector('#sol-an-origem').onchange = ev => { _anOrigem = ev.target.value; rAnalises(body); };
  body.querySelectorAll('.sol-an-dias').forEach(b => {
    b.onclick = () => { _anDias = Number(b.dataset.d); _an = null; rAnalises(body); };
  });
  if ((Number(custos.total) > 0 || Number(custos.acumulado_mes) > 0) && (custos.serie || []).length) desenhaGraficoGastos(body, custos.serie);
}

/* ═══ gráficos — Chart.js (padrão GC); fallback barras CSS ═══ */
function destroiCharts() { _charts.forEach(c => { try { c.destroy(); } catch (_) {} }); _charts = []; }

async function desenhaGraficoVisao(body) {
  destroiCharts();
  const dias = _d.dias || [];
  const wrap = body.querySelector('#sol-graf');
  if (!wrap || !dias.length) return;
  const labels = dias.map(d => fmtDia(d.dia));
  const ag = dias.map(d => n0(d.agendamentos));
  const qa = dias.map(d => n0(d.qualificados));
  let Chart = null;
  try { Chart = await loadChartLib(); } catch (_) { /* fallback CSS */ }
  const el = wrap.querySelector('#sol-canvas');
  if (Chart && el && el.isConnected) {
    const ink = (getComputedStyle(document.documentElement).getPropertyValue('--ink-muted') || '#94a3b8').trim();
    _charts.push(new Chart(el, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Agendamentos', data: ag, backgroundColor: '#22c55e', borderRadius: 3 },
        { label: 'Qualificados', data: qa, backgroundColor: '#60a5fa', borderRadius: 3 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: ink, font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: ink, font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: ink, font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(148,163,184,.14)' }, beginAtZero: true },
        },
      },
    }));
    return;
  }
  const max = Math.max(1, ...ag, ...qa);
  wrap.style.height = 'auto';
  wrap.innerHTML = `<div class="sol-bars">
    ${dias.map((d, i) => `<div class="sol-bcol" title="${labels[i]} · 📅 ${ag[i]} · ✅ ${qa[i]}">
      <div class="sol-b" style="height:${Math.round(ag[i] / max * 120)}px;background:#22c55e"></div>
      <div class="sol-b" style="height:${Math.round(qa[i] / max * 120)}px;background:#60a5fa"></div>
      <div class="sol-blbl">${labels[i]}</div>
    </div>`).join('')}
  </div>`;
}

async function desenhaGraficoGastos(body, serie) {
  const wrap = body.querySelector('#sol-custo-graf');
  if (!wrap) return;
  const labels = serie.map(r => fmtDia(r.dia));
  const tpl = serie.map(r => Number(r.templates || 0));
  const ia = serie.map(r => Number(r.ia || 0));
  const fx = serie.map(r => Number(r.fixos || 0));
  const acum = serie.map(r => Number(r.acumulado || 0));
  let Chart = null;
  try { Chart = await loadChartLib(); } catch (_) { /* fallback CSS */ }
  const el = wrap.querySelector('#sol-custo-canvas');
  if (Chart && el && el.isConnected) {
    const ink = (getComputedStyle(document.documentElement).getPropertyValue('--ink-muted') || '#94a3b8').trim();
    _charts.push(new Chart(el, {
      data: {
        labels,
        datasets: [
          { type: 'line', label: 'Acumulado (R$)', data: acum, borderColor: '#22c55e', pointRadius: 0, tension: .25, yAxisID: 'y2' },
          { type: 'bar', label: 'Meta (templates)', data: tpl, backgroundColor: '#f59e0b', stack: 's' },
          { type: 'bar', label: 'IA', data: ia, backgroundColor: '#a78bfa', stack: 's' },
          { type: 'bar', label: 'Fixos', data: fx, backgroundColor: '#64748b', stack: 's' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: ink, font: { size: 10 } } } },
        scales: {
          x: { stacked: true, ticks: { color: ink, font: { size: 9 } }, grid: { display: false } },
          y: { stacked: true, ticks: { color: ink, font: { size: 10 } }, grid: { color: 'rgba(148,163,184,.14)' }, beginAtZero: true },
          y2: { position: 'right', ticks: { color: '#22c55e', font: { size: 10 } }, grid: { drawOnChartArea: false }, beginAtZero: true },
        },
      },
    }));
    return;
  }
  // fallback CSS: pilha por dia (Meta/IA/Fixos) — acumulado fica no card
  const max = Math.max(1, ...serie.map(r => Number(r.total || 0)));
  wrap.style.height = 'auto';
  wrap.innerHTML = `<div class="sol-bars" style="height:100px">
    ${serie.map((r, i) => `<div class="sol-bcol" title="${labels[i]} · total ${brl(r.total)} · acumulado ${brl(r.acumulado)}">
      <div class="sol-b" style="height:${Math.round(fx[i] / max * 84)}px;background:#64748b;border-radius:0"></div>
      <div class="sol-b" style="height:${Math.round(ia[i] / max * 84)}px;background:#a78bfa;border-radius:0"></div>
      <div class="sol-b" style="height:${Math.round(tpl[i] / max * 84)}px;background:#f59e0b"></div>
      <div class="sol-blbl">${labels[i]}</div>
    </div>`).join('')}
  </div>`;
}
