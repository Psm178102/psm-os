/* PSM-OS v2 — 🤖 Central da Sol · cockpit da atendente IA da Conquista (WhatsApp)
   Só sócio (lvl>=10). Backend: GET /api/v3/sol/painel + POST /api/v3/sol/config.
   Layout no padrão BÚSSOLA/Gestão Comercial: KPIs do dia → gráfico 14d →
   conversas ativas → feed de eventos → card de config (autonomia copiloto/autônoma).
   Gráfico: Chart.js (loadChartLib, como a GC); se o CDN falhar, cai em barras CSS. */
import { api } from '../api.js';
import { loadChartLib } from '../premium.js';

let _host = null, _d = null, _busyCfg = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = v => Number(v || 0);

/* ═══ CSS do módulo (paleta semântica, mesmo esquema da GC) — injetado 1× ═══ */
const SOL_CSS = `
.sol{--sol-ok:#22c55e;--sol-warn:#f59e0b;--sol-err:#ef4444;--sol-acc:#60a5fa;font-variant-numeric:tabular-nums}
:root:not(.dark) .sol{--sol-ok:#16a34a;--sol-warn:#d97706;--sol-err:#dc2626;--sol-acc:#2563eb}
.sol .sol-pan{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md,12px);padding:14px 16px;margin-top:12px}
.sol .sol-pan-t{font-weight:800;font-size:13px;margin-bottom:10px;letter-spacing:.01em}
.sol .sol-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;margin-top:12px}
.sol .sol-kpi{background:var(--bg-2);border:1px solid var(--border);border-left:4px solid var(--kc,var(--border-2));border-radius:var(--r-md,12px);padding:10px 12px;min-width:0}
.sol .sol-kpi .l{font-size:10.5px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sol .sol-kpi .v{font-size:22px;font-weight:900;margin-top:2px}
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
`;
function injectCss() {
  if (document.getElementById('sol-css')) return;
  const st = document.createElement('style');
  st.id = 'sol-css'; st.textContent = SOL_CSS;
  document.head.appendChild(st);
}

/* ═══ helpers de rótulo ═══ */
const EV_ICO = {
  msg_in: '📩', msg_recebida: '📩', msg_out: '📤', msg_enviada: '📤',
  toque_regua: '⏰', qualificado: '✅', qualificacao: '✅', simulacao: '🧮',
  agendamento: '📅', handoff: '🤝', escalacao: '🚨', erro: '❌',
  conversa_iniciada: '🌅', conversa_encerrada: '🌇',
};
const evIco = t => EV_ICO[String(t || '').toLowerCase()] || '•';

const STATUS_CONV = {
  ativa: ['var(--sol-ok)', 'ativa'], aguardando: ['var(--sol-warn)', 'aguardando'],
  regua: ['var(--sol-acc)', 'régua'], escalada: ['var(--sol-err)', 'escalada'],
  handoff: ['var(--sol-warn)', 'handoff'],
};
function statusPill(s) {
  const k = String(s || '').toLowerCase();
  const [c, lbl] = STATUS_CONV[k] || ['var(--ink-muted)', k || '—'];
  return `<span class="sol-pill" style="background:color-mix(in srgb,${c} 14%,transparent);color:${c}">${esc(lbl)}</span>`;
}

const fmtDT = iso => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};
const fmtDia = iso => { try { const [, m, d] = String(iso).split('-'); return `${d}/${m}`; } catch { return iso; } };

/* ═══ página ═══ */
export async function pageCentralSol(ctx, root) {
  _host = root;
  injectCss();
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

function cfgVal(chave) { return ((_d.config || {})[chave] || {}).valor || {}; }

function render() {
  const hoje = _d.hoje || {};
  const convs = _d.conversas || [];
  const evs = _d.eventos || [];
  const wa = cfgVal('numero_whatsapp');
  const conectada = String(wa.status || '') !== 'aguardando_token' && !!_d.config?.token_env_ok;
  const modo = String((cfgVal('autonomia_padrao').modo) || 'copiloto');
  const persona = cfgVal('persona_versao').versao || '—';
  const semDados = !convs.length && !evs.length;

  const kpi = (lbl, v, cor) => `
    <div class="sol-kpi" style="--kc:${cor || 'var(--border-2)'}">
      <div class="l">${lbl}</div><div class="v" style="${cor ? `color:${cor}` : ''}">${v}</div>
    </div>`;
  const erros = n0(hoje.erros);

  _host.innerHTML = `<div class="sol">
    <div class="card" style="padding:10px 14px">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0;font-size:16px">🤖 Central da Sol</h2>
        <span class="sol-pill" style="background:color-mix(in srgb,${conectada ? 'var(--sol-ok)' : 'var(--sol-warn)'} 14%,transparent);color:${conectada ? 'var(--sol-ok)' : 'var(--sol-warn)'}">
          ${conectada ? '🟢 conectada ao WhatsApp' : '⏳ aguardando token da WABA'}</span>
        <span class="tiny muted">atendente IA da PSM Conquista · visão do sócio</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-sm btn-ghost" id="sol-reload" title="Atualizar">🔄</button>
      </div>
    </div>

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
      <div class="sol-pan-t">💬 Conversas ativas <span class="tiny muted">(${convs.length} · prioridade desc)</span></div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Lead</th><th>Origem</th><th>Etapa</th><th>Régua</th><th>Próximo toque</th><th style="text-align:right">Prior.</th><th>Status</th></tr></thead>
        <tbody>
          ${convs.map(c => `<tr>
            <td><b>${esc(c.nome || '(sem nome)')}</b> <span class="tiny muted">${esc(c.telefone || '')}</span></td>
            <td>${esc(c.origem || '—')}</td>
            <td>${esc(c.etapa_funil || '—')}</td>
            <td>${esc(c.regua || '—')}${c.passo != null ? ` <span class="tiny muted">#${esc(c.passo)}</span>` : ''}</td>
            <td>${fmtDT(c.proximo_toque_em)}</td>
            <td style="text-align:right;font-weight:800">${n0(c.prioridade).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
            <td>${statusPill(c.status)}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="tiny muted" style="text-align:center;padding:14px">nenhuma conversa ativa agora</td></tr>'}
        </tbody>
      </table>
      </div>
    </div>

    <div class="sol-pan">
      <div class="sol-pan-t">📜 Últimos eventos</div>
      <div class="sol-feed">
        ${evs.map(ev => `<div class="sol-ev">
          <span>${evIco(ev.tipo)}</span>
          <span style="font-weight:700">${esc(ev.tipo || '?')}</span>
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
            <span class="sol-pill" style="background:color-mix(in srgb,${_d.config?.token_env_ok ? 'var(--sol-ok)' : 'var(--sol-warn)'} 14%,transparent);color:${_d.config?.token_env_ok ? 'var(--sol-ok)' : 'var(--sol-warn)'}">
              ${_d.config?.token_env_ok ? 'token ok' : 'sem token no Vercel'}</span>
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
      </div>
    </div>
  </div>`;

  _host.querySelector('#sol-reload').onclick = () => reload();
  const btC = _host.querySelector('#sol-md-copiloto');
  const btA = _host.querySelector('#sol-md-autonoma');
  if (btC) btC.onclick = () => setModo('copiloto');
  if (btA) btA.onclick = () => setModo('autonoma');
  if (!semDados) desenhaGrafico();
}

async function setModo(modo) {
  if (_busyCfg || String(cfgVal('autonomia_padrao').modo || 'copiloto') === modo) return;
  if (modo === 'autonoma' && !confirm('⚡ Colocar a Sol em modo AUTÔNOMO? Ela passa a responder leads sozinha (escalando quando travar).')) return;
  _busyCfg = true;
  try {
    await api.request('/api/v3/sol/config', { method: 'POST', body: { chave: 'autonomia_padrao', valor: { modo } } });
    (_d.config = _d.config || {}).autonomia_padrao = { valor: { modo } };
    render();
  } catch (e) {
    alert('❌ Não salvou: ' + (e.message || e));
  }
  _busyCfg = false;
}

/* ═══ gráfico 14d — Chart.js; fallback barras CSS se o CDN falhar ═══ */
async function desenhaGrafico() {
  const dias = _d.dias || [];
  const wrap = _host.querySelector('#sol-graf');
  if (!wrap || !dias.length) return;
  const labels = dias.map(d => fmtDia(d.dia));
  const ag = dias.map(d => n0(d.agendamentos));
  const qa = dias.map(d => n0(d.qualificados));
  let Chart = null;
  try { Chart = await loadChartLib(); } catch (_) { /* cai no fallback CSS */ }
  const el = wrap.querySelector('#sol-canvas');
  if (Chart && el && el.isConnected) {
    const css = getComputedStyle(document.documentElement);
    const ink = (css.getPropertyValue('--ink-muted') || '#94a3b8').trim();
    new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Agendamentos', data: ag, backgroundColor: '#22c55e', borderRadius: 3 },
          { label: 'Qualificados', data: qa, backgroundColor: '#60a5fa', borderRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: ink, font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: ink, font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: ink, font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(148,163,184,.14)' }, beginAtZero: true },
        },
      },
    });
    return;
  }
  // fallback: barras CSS puras (mesmo dado, sem lib)
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
