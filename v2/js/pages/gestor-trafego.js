/* PSM-OS v2 — 🚦 Gestor de Tráfego (Sr. Tráfego) v87.5
   Agente IA de tráfego pago das 2 marcas (Conquista MCMV + Imóveis alto padrão).
   6 abas: Painel · Sala de Guerra (chat) · Públicos · Alertas · Ações · Cérebro.
   Backend: /api/v3/marketing/gestor (+ /api/v3/ia/chat agent=gestor_trafego).
   O dashboard Meta completo continua em /marketing — aqui mora o AGENTE. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const TABS = [
  { id: 'painel',   lbl: '🎛️ Painel' },
  { id: 'guerra',   lbl: '💬 Chat · Sala de Guerra' },
  { id: 'publicos', lbl: '👥 Públicos' },
  { id: 'alertas',  lbl: '🚨 Alertas' },
  { id: 'acoes',    lbl: '⚡ Ações' },
  { id: 'relatorios', lbl: '📜 Relatórios' },
  { id: 'cerebro',  lbl: '🧠 Cérebro' },
];

const CHAT_KEY = 'psm_v2_gestor_trafego_chat';
const METRICAS = ['cpl', 'spend', 'leads', 'ctr', 'frequency', 'cpm', 'ddd_fora_pct'];
const MET_LBL = { cpl: 'CPL (R$)', spend: 'Gasto (R$)', leads: 'Leads', ctr: 'CTR (%)', frequency: 'Frequência', cpm: 'CPM (R$)', ddd_fora_pct: '% leads DDD ≠ 17' };
const LIM_LBL = { cpl_alvo: 'CPL alvo (R$)', cpl_max: 'CPL máximo (R$)', freq_max: 'Frequência máx', ctr_min_pct: 'CTR mínimo (%)', ddd_fora_max_pct: '% máx DDD ≠ 17', escala_fator: 'Fator de escala (0-1)' };

let _root = null, _tab = 'painel';
let _painel = null, _summary = null;
let _messages = [], _busy = false;
let _seg = null, _segBusy = false;

export async function pageGestorTrafego(ctx, root) {
  _root = root;
  _tab = (ctx?.query?.tab) || 'painel';
  try { _messages = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); } catch { _messages = []; }
  render();
  syncChat();
  await load();
}

async function load() {
  try {
    _painel = await api.request('/api/v3/marketing/gestor?action=painel');
  } catch (e) {
    _painel = { ok: false, error: e.message || 'falha ao carregar' };
  }
  render();
}

async function loadSummary() {
  if (_summary) return _summary;
  try { _summary = await api.request('/api/v3/marketing/summary?date_preset=last_7d'); }
  catch { _summary = null; }
  return _summary;
}

function socio() { return (auth.user()?.lvl || 0) >= 10 || !!_painel?.pode_agir; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function brl(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }

/* ───────────────────────── shell ───────────────────────── */
function render() {
  _root.innerHTML = `
    <div class="card">
      <div style="background:linear-gradient(135deg,#7c2d12 0%,#1c1917 100%);color:#fff;padding:20px;border-radius:14px 14px 0 0;margin:-16px -16px 16px">
        <div class="flex" style="align-items:center;gap:14px;flex-wrap:wrap">
          <div style="width:56px;height:56px;border-radius:14px;background:#f9731633;display:flex;align-items:center;justify-content:center;font-size:28px">🚦</div>
          <div style="flex:1;min-width:220px">
            <div style="font-size:22px;font-weight:900;color:#fb923c">Sr. Gestor de Tráfego</div>
            <div style="opacity:.85;font-size:13px">Mídia paga sênior · Meta Ads, públicos, RD Station e estratégia · PSM Conquista + PSM Imóveis · relatórios 19h aos sócios</div>
          </div>
          <button class="btn btn-ghost" data-nav-mkt style="color:#fff;border-color:#ffffff44">📢 Dashboard Meta completo</button>
        </div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap;border-bottom:1px solid var(--bd);padding-bottom:8px;margin-bottom:14px">
        ${TABS.map(t => `<button class="btn ${_tab === t.id ? 'btn-primary' : 'btn-ghost'}" data-tab="${t.id}">${t.lbl}</button>`).join('')}
      </div>
      <div id="gt-body"></div>
    </div>`;
  _root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { _tab = b.dataset.tab; render(); });
  _root.querySelector('[data-nav-mkt]').onclick = () => { location.hash = '#/marketing'; };
  const body = document.getElementById('gt-body');
  if (_tab === 'painel') renderPainel(body);
  if (_tab === 'guerra') renderGuerra(body);
  if (_tab === 'publicos') renderPublicos(body);
  if (_tab === 'alertas') renderAlertas(body);
  if (_tab === 'acoes') renderAcoes(body);
  if (_tab === 'relatorios') renderRelatorios(body);
  if (_tab === 'cerebro') renderCerebro(body);
}

function aguarde(body) {
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando o gestor…</div>';
  return !_painel;
}

/* ───────────────────────── 🎛️ Painel (cockpit v87.15) ───────────────────────── */
function delta(cur, prev, invertido = false) {
  if (prev == null || cur == null || !isFinite(prev) || prev === 0) return '';
  const pct = (cur - prev) / Math.abs(prev) * 100;
  if (Math.abs(pct) < 0.5) return '<span class="tiny muted">= estável</span>';
  const bom = invertido ? pct < 0 : pct > 0;
  return `<span class="tiny" style="font-weight:800;color:${bom ? 'var(--ok, #22c55e)' : 'var(--err, #ef4444)'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</span>`;
}
function kpiCard(lbl, val, sub, deltaHtml = '') {
  return `<div style="background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px;min-width:140px;flex:1">
    <div class="tiny" style="font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">${lbl}</div>
    <div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:22px;font-weight:900">${val}</span>${deltaHtml}</div>
    ${sub ? `<div class="tiny muted">${sub}</div>` : ''}
  </div>`;
}
function barraFunil(lbl, n, base, cor) {
  const pct = base ? Math.max(1.5, n / base * 100) : 0;
  const conv = base ? (n / base * 100).toFixed(1) + '%' : '—';
  return `<div style="display:grid;grid-template-columns:110px 1fr 88px;gap:10px;align-items:center;font-size:13px;padding:3px 0">
    <div style="text-align:right;font-weight:700">${lbl}</div>
    <div style="background:var(--bg-2);border-radius:6px;height:18px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${cor}"></div></div>
    <div style="font-variant-numeric:tabular-nums"><b>${n}</b> <span class="tiny muted">${conv}</span></div>
  </div>`;
}

function renderPainel(body) {
  if (aguarde(body)) return;
  if (_painel.ok === false) { body.innerHTML = `<div class="muted">⚠️ ${esc(_painel.error)}</div>`; return; }
  const m7 = _painel.metricas?.last_7d, m30 = _painel.metricas?.last_30d;
  const d7 = _painel.deltas_prev?.last_7d || {};
  const mes = _painel.mes_atual || {};
  const fun = mes.funil || {};
  const cc = _painel.concorrencia || {};
  const contaPausada = m7 && (+m7.spend === 0);
  const custoPasta = mes.custo_pasta;
  const cpOk = custoPasta != null ? custoPasta <= (mes.meta_custo_pasta || 420) : null;
  const disparados = (_painel.alertas?.avaliacao || []).filter(a => a.estado === 'disparado');
  const sev = s => s === 'critico' ? '🔴' : s === 'atencao' ? '🟡' : '🔵';

  body.innerHTML = `
    <style>@media(max-width:900px){.gt-grid{grid-template-columns:1fr!important}.gt-grid3{grid-template-columns:1fr!important}}</style>
    ${contaPausada ? `<div style="background:var(--crit-bg, #7f1d1d22);border:1px solid #ef444455;border-left:5px solid #ef4444;border-radius:10px;padding:12px 16px;margin-bottom:14px">
      <b>🔴 CONTA SEM ENTREGA</b> <span class="tiny">— gasto de 7 dias em R$ 0. Campanhas pausadas: cada dia parado encarece a meta do mês. Plano de religada no último relatório abaixo.</span>
    </div>` : ''}

    <div class="tiny muted" style="font-weight:800;letter-spacing:.06em;margin-bottom:6px">ÚLTIMOS 7 DIAS ${m7?.period ? '· ' + esc(m7.period) : ''} <span style="font-weight:400">· vs 7 dias anteriores</span></div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      ${kpiCard('Investimento', m7 ? brl(m7.spend) : '—', '', delta(m7?.spend, d7.spend))}
      ${kpiCard('Leads', m7 ? m7.leads : '—', '', delta(m7?.leads, d7.leads))}
      ${kpiCard('CPL', m7?.cpl ? brl(m7.cpl) : '—', 'alvo ≤ ' + brl(_painel.limiares?.cpl_alvo || 12), delta(m7?.cpl, d7.cpl, true))}
      ${kpiCard('CTR', m7 ? (m7.ctr || 0) + '%' : '—', 'mín ' + (_painel.limiares?.ctr_min_pct || 1) + '%')}
      ${kpiCard('Frequência', m7?.frequency ?? '—', 'teto ' + (_painel.limiares?.freq_max || 2.6))}
      ${kpiCard('DDD ≠ 17', m7?.ddd_fora_pct != null ? m7.ddd_fora_pct + '%' : '—', 'teto ' + (_painel.limiares?.ddd_fora_max_pct || 25) + '%')}
    </div>

    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:14px" class="gt-grid">
      <div style="background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px">
        <div style="font-weight:800;margin-bottom:6px">📈 Ritmo diário (30 dias) <span class="tiny muted">barras = gasto · linha = leads</span></div>
        <canvas id="gt-spark" height="110" style="width:100%;display:block"></canvas>
        <div class="tiny muted" style="margin-top:4px">30d: ${m30 ? brl(m30.spend) + ' · ' + m30.leads + ' leads · CPL ' + (m30.cpl ? brl(m30.cpl) : '—') : 'sem cache ainda'}</div>
      </div>
      <div style="background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px">
        <div style="font-weight:800;margin-bottom:6px">🎯 Mês ${esc(mes.mes || '')} — régua de pastas</div>
        <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:8px">
          <div style="flex:1;min-width:100px"><div class="tiny muted">GASTO MÊS</div><b style="font-size:18px">${mes.spend != null ? brl(mes.spend) : '—'}</b></div>
          <div style="flex:1;min-width:80px"><div class="tiny muted">LEADS MÊS</div><b style="font-size:18px">${mes.leads ?? fun.leads ?? '—'}</b></div>
          <div style="flex:1;min-width:80px"><div class="tiny muted">PASTAS</div><b style="font-size:18px">${fun.pastas ?? '—'}<span class="tiny muted">/${mes.meta_pastas || 18}</span></b></div>
          <div style="flex:1;min-width:110px"><div class="tiny muted">CUSTO/PASTA</div><b style="font-size:18px;color:${cpOk == null ? 'inherit' : cpOk ? 'var(--ok, #22c55e)' : 'var(--err, #ef4444)'}">${custoPasta != null ? brl(custoPasta) : '—'}</b><span class="tiny muted"> alvo ≤ ${brl(mes.meta_custo_pasta || 420)}</span></div>
        </div>
        <div style="background:var(--bg-2);border-radius:8px;height:14px;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:${Math.min(100, ((fun.pastas || 0) / (mes.meta_pastas || 18)) * 100)}%;background:linear-gradient(90deg,#f97316,#fb923c)"></div></div>
        <div class="tiny muted" style="font-weight:800;margin-bottom:2px">FUNIL DO MÊS (Conquista)</div>
        ${barraFunil('Leads', fun.leads || 0, fun.leads || 0, '#3b82f6')}
        ${barraFunil('Em contato', fun.contato || 0, fun.leads || 0, '#6366f1')}
        ${barraFunil('Visitas', fun.visitas || 0, fun.leads || 0, '#a855f7')}
        ${barraFunil('Pastas', fun.pastas || 0, fun.leads || 0, '#f97316')}
        ${barraFunil('Vendas', fun.vendas || 0, fun.leads || 0, '#22c55e')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px" class="gt-grid3">
      <div style="background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px">
        <div style="font-weight:800;margin-bottom:6px">🥊 Praça agora <span class="tiny muted">${cc.anunciando ?? '—'}/${cc.monitorados ?? '—'} anunciando · ${cc.ativos_praca ?? '—'} anúncios</span></div>
        ${(cc.top || []).map((c, i) => `<div class="flex tiny" style="justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--bd)"><span>${i + 1}. ${esc(String(c.nome).slice(0, 26))} <span class="muted">[${esc(c.segmento || '')}]</span></span><b>${c.anuncios_count}</b></div>`).join('') || '<div class="tiny muted">sem coleta ainda</div>'}
        <div class="flex tiny" style="justify-content:space-between;padding:4px 0;font-weight:800;color:${contaPausada ? 'var(--err, #ef4444)' : 'inherit'}"><span>NÓS (Conquista)</span><span>${contaPausada ? '0 🔴' : 'ativa'}</span></div>
        <button class="btn btn-ghost tiny" data-ir-concorrencia style="margin-top:4px">abrir Concorrência →</button>
      </div>
      <div style="background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px">
        <div style="font-weight:800;margin-bottom:6px">🚨 Alertas & diagnóstico</div>
        ${disparados.length ? disparados.map(a => `<div class="tiny" style="padding:4px 0;border-bottom:1px solid var(--bd)">${sev(a.severidade)} <b>${esc(a.nome || a.metrica)}</b> — atual <b>${a.valor_atual}</b> (${esc(a.op)} ${a.valor})</div>`).join('') : '<div class="tiny muted">Nenhuma regra disparada.</div>'}
        ${(_painel.diagnosticos || []).slice(0, 4).map(d => `<div class="tiny" style="padding:4px 0;border-bottom:1px solid var(--bd)">${d.sev === 'critico' ? '🔴' : d.sev === 'atencao' ? '🟡' : '🟢'} <b>${esc(String(d.campanha).slice(0, 30))}</b><br>${esc(d.acao)}</div>`).join('')}
        <button class="btn btn-ghost tiny" data-ir-alertas style="margin-top:4px">todas as regras →</button>
      </div>
      <div style="background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px">
        <div style="font-weight:800;margin-bottom:6px">⚡ Últimas ações & bases</div>
        ${(_painel.log || []).slice(0, 4).map(l => `<div class="tiny" style="padding:3px 0;border-bottom:1px solid var(--bd)">${l.ok ? '✅' : '❌'} <b>${esc(l.op)}</b> ${esc(String(l.alvo?.nome || l.alvo?.id || '').slice(0, 30))} <span class="muted">${esc(String(l.ts || '').slice(5, 16).replace('T', ' '))}</span></div>`).join('') || '<div class="tiny muted">Nenhuma ação executada.</div>'}
        <div class="tiny" style="margin-top:6px">📡 ${(_painel.contas || []).length} contas Meta · 👥 ${(_painel.publicos || []).length} públicos · 📋 ${(_painel.listas || []).length} listas</div>
        <div class="tiny">🧠 Estratégia: ${_painel.config?.estrategia?.conquista ? 'definida ✓' : '<b>pendente</b>'} · 🕵️ Vigia: ${cc.ultima_coleta ? 'coleta ' + esc(String(cc.ultima_coleta).slice(5, 16).replace('T', ' ')) : 'sem coleta'}</div>
      </div>
    </div>

    <div id="gt-rel-painel"></div>`;

  body.querySelector('[data-ir-concorrencia]')?.addEventListener('click', () => { location.hash = '#/concorrencia'; });
  body.querySelector('[data-ir-alertas]')?.addEventListener('click', () => { _tab = 'alertas'; render(); });
  desenharSpark(_painel.serie_diaria || []);
  pintarRelatorioPainel();
}

function desenharSpark(serie) {
  const cv = document.getElementById('gt-spark');
  if (!cv || !serie.length) { if (cv) { const c = cv.getContext('2d'); c.font = '12px sans-serif'; c.fillStyle = '#94a3b8'; c.fillText('Sem série diária no cache (o cron aquece a cada ~10min).', 8, 40); } return; }
  const W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
  const H = cv.height = 110 * (window.devicePixelRatio || 1);
  const ctx = cv.getContext('2d');
  const spends = serie.map(d => +d.spend || 0), leads = serie.map(d => +(d.results || 0));
  const maxS = Math.max(...spends, 1), maxL = Math.max(...leads, 1);
  const n = serie.length, bw = W / n;
  serie.forEach((d, i) => {
    const h = (spends[i] / maxS) * (H - 18);
    ctx.fillStyle = spends[i] > 0 ? '#fb923c' : '#33415555';
    ctx.fillRect(i * bw + bw * 0.15, H - h - 14, bw * 0.7, Math.max(h, spends[i] > 0 ? 2 : 1));
  });
  ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2 * (window.devicePixelRatio || 1); ctx.beginPath();
  serie.forEach((d, i) => {
    const x = i * bw + bw / 2, y = H - 14 - (leads[i] / maxL) * (H - 26);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* v87.10: último relatório do gestor inline no Painel, junto dos KPIs */
async function pintarRelatorioPainel() {
  const el = document.getElementById('gt-rel-painel');
  if (!el) return;
  try {
    const r = await api.request('/api/v3/marketing/gestor_relatorio');
    const ult = (r?.relatorios || [])[0];
    if (!ult) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="background:var(--bg-3);border-left:4px solid #fb923c;border-radius:10px;padding:14px 16px">
        <div class="flex" style="align-items:center;gap:8px;flex-wrap:wrap">
          <b>📜 ${TIPO_LBL[ult.tipo] || esc(ult.tipo)} — último relatório</b>
          <span class="tiny muted">${esc(String(ult.ts || '').slice(0, 16).replace('T', ' '))} UTC</span>
          <button class="btn btn-ghost tiny" style="margin-left:auto" data-rel-ir>ver todos →</button>
        </div>
        <div style="white-space:pre-wrap;font-size:13px;line-height:1.55;margin-top:8px">${esc(ult.texto)}</div>
      </div>`;
    el.querySelector('[data-rel-ir]').onclick = () => { _tab = 'relatorios'; render(); };
  } catch { el.innerHTML = ''; }
}

/* ───────────────────────── 💬 Sala de Guerra ───────────────────────── */
function syncChat() {
  api.request('/api/v3/ia/chats?agent=gestor_trafego').then(r => {
    if (!r || !Array.isArray(r.messages)) return;
    if (r.messages.length >= _messages.length) { _messages = r.messages; if (_tab === 'guerra') render(); }
    else if (_messages.length) saveChat();
  }).catch(() => {});
}
function saveChat() {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(_messages.slice(-30))); } catch {}
  api.request('/api/v3/ia/chats', { method: 'POST', body: { agent: 'gestor_trafego', messages: _messages.slice(-30) } }).catch(() => {});
}
function bubble(m) {
  const mine = m.role === 'user';
  return `<div style="align-self:${mine ? 'flex-end' : 'flex-start'};max-width:85%;background:${mine ? 'var(--acc)' : 'var(--bg-2)'};color:${mine ? '#fff' : 'var(--tx)'};border-radius:12px;padding:9px 12px;white-space:pre-wrap;font-size:13px;line-height:1.5">${esc(m.content)}</div>`;
}

function renderGuerra(body) {
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:540px">
      <div id="gt-msgs" style="flex:1;overflow-y:auto;padding:8px;background:var(--bg-3);border-radius:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px">
        ${_messages.length === 0 ? `
          <div style="text-align:center;padding:26px;color:var(--muted)">
            <div style="font-size:42px;margin-bottom:8px">🚦</div>
            <div>Converse com o Sr. Gestor de Tráfego — dúvidas, estratégia, diagnóstico. Ele responde com os números REAIS do Meta, da base RD e dos concorrentes mapeados, e o histórico fica salvo.</div>
            <div class="tiny mt-2 muted">Exemplos:</div>
            <div class="tiny" style="font-style:italic;margin:4px 0">"Diagnóstico da semana: onde estou queimando verba?"</div>
            <div class="tiny" style="font-style:italic;margin:4px 0">"Monta a estratégia de públicos da Conquista pra outubro"</div>
            <div class="tiny" style="font-style:italic;margin:4px 0">"Que campanha eu pauso hoje e por quê?"</div>
            <div class="tiny" style="font-style:italic;margin:4px 0">"Me explica o que é CBO e se vale pra gente"</div>
            <div class="tiny" style="font-style:italic;margin:4px 0">"O que dá pra extrair do RD Station que não usamos?"</div>
          </div>` : _messages.map(bubble).join('')}
        ${_busy ? '<div class="muted tiny"><span class="spinner"></span> Sr. Gestor de Tráfego analisando…</div>' : ''}
      </div>
      <div class="flex gap-2" style="align-items:flex-end">
        <textarea id="gt-input" class="input" rows="2" placeholder="Pergunte sobre campanhas, públicos, verba, estratégia… (Ctrl+Enter envia)" ${_busy ? 'disabled' : ''}></textarea>
        <button class="btn btn-primary" id="gt-send" ${_busy ? 'disabled' : ''}>${_busy ? '…' : 'Enviar'}</button>
        ${_messages.length ? '<button class="btn btn-ghost" id="gt-clear" title="Limpar conversa">🗑</button>' : ''}
      </div>
    </div>`;
  const msgs = document.getElementById('gt-msgs');
  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('gt-send').onclick = sendMsg;
  document.getElementById('gt-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMsg();
  });
  const clr = document.getElementById('gt-clear');
  if (clr) clr.onclick = () => { _messages = []; saveChat(); render(); };
}

async function sendMsg() {
  const inp = document.getElementById('gt-input');
  const txt = (inp?.value || '').trim();
  if (!txt || _busy) return;
  _messages.push({ role: 'user', content: txt });
  _busy = true; render();
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: { agent: 'gestor_trafego', messages: _messages.slice(-20) } });
    _messages.push({ role: 'assistant', content: r?.reply || '(sem resposta)' });
  } catch (e) {
    _messages.push({ role: 'assistant', content: '⚠️ ' + (e.message || 'falha ao consultar o Sr. Tráfego') });
  }
  _busy = false; saveChat(); render();
}

/* ───────────────────────── 👥 Públicos ───────────────────────── */
function renderPublicos(body) {
  if (aguarde(body)) return;
  const planos = _painel.publicos || [];
  const listas = _painel.listas || [];
  const stBadge = s => ({ ideia: '💡 ideia', criado_no_meta: '🏗 criado no Meta', ativo: '🟢 ativo', pausado: '⏸ pausado' }[s] || s);
  body.innerHTML = `
    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-weight:800;margin-bottom:4px">🔎 Segmentador da base RD</div>
      <div class="tiny muted" style="margin-bottom:10px">Recorta a base do CRM (deals sincronizados do RD Station) pra virar público personalizado no Meta — exporta CSV pronto pro Ads Manager (fn, phone, email).</div>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end">
        <label class="tiny">Frente<br><select id="seg-frente" class="input">
          ${['todas', 'conquista', 'map', 'terceiros', 'locacoes', 'outros'].map(f => `<option value="${f}">${f}</option>`).join('')}
        </select></label>
        <label class="tiny">Status<br><select id="seg-status" class="input">
          ${['todos', 'aberto', 'ganho', 'perdido'].map(s => `<option value="${s}">${s}</option>`).join('')}
        </select></label>
        <label class="tiny">Parado há (dias)+<br><input id="seg-dias" class="input" type="number" min="0" value="0" style="width:90px"></label>
        <label class="tiny" style="display:flex;align-items:center;gap:6px;padding-bottom:8px"><input id="seg-fone" type="checkbox" checked> só com telefone</label>
        <button class="btn btn-primary" id="seg-contar" ${_segBusy ? 'disabled' : ''}>${_segBusy ? '…' : 'Contar'}</button>
        <button class="btn" id="seg-export" ${!_seg ? 'disabled' : ''}>⬇️ Exportar CSV</button>
        ${socio() ? `<button class="btn" id="seg-meta" ${!_seg ? 'disabled' : ''} style="border-color:#fb923c;color:#fb923c">🚀 Criar público no Meta</button>` : ''}
      </div>
      <div id="seg-out" style="margin-top:10px">
        ${_seg ? `<div class="tiny"><b>${_seg.total}</b> contatos no recorte · <b>${_seg.com_fone}</b> com fone · <b>${_seg.com_email}</b> com e-mail</div>
          <div style="overflow-x:auto;margin-top:6px"><table class="table tiny"><tr><th>Nome</th><th>Fone</th><th>Funil</th><th>Etapa</th><th>Status</th></tr>
          ${(_seg.preview || []).map(r => `<tr><td>${esc(r.nome)}</td><td>${esc(r.fone)}</td><td>${esc(r.funil)}</td><td>${esc(r.etapa)}</td><td>${esc(r.status)}</td></tr>`).join('')}</table></div>` : ''}
      </div>
      <div class="tiny muted" style="margin-top:8px">💡 Seeds clássicos: <b>ganhos</b> = semente de público semelhante (LAL 1-3%); <b>perdidos 90d+</b> = remarketing de reativação; <b>abertos</b> = exclusão pra não pagar duas vezes pelo mesmo lead.</div>
    </div>

    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-weight:800;margin-bottom:4px">📋 Listas & mailings</div>
      <div class="tiny muted" style="margin-bottom:8px">Suba planilhas/listas (CSV) que você já tem — viram fonte de público personalizado e entram no cérebro do gestor.</div>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input type="file" id="lst-file" accept=".csv,.txt" class="input" style="max-width:260px">
        <input type="text" id="lst-nome" class="input" placeholder="Nome da lista" style="max-width:200px">
        <select id="lst-marca" class="input" style="max-width:140px">
          <option value="ambas">ambas</option><option value="conquista">conquista</option><option value="imoveis">imóveis</option>
        </select>
        <button class="btn btn-primary" id="lst-up">Subir lista</button>
      </div>
      ${listas.length ? `<div style="overflow-x:auto"><table class="table tiny"><tr><th>Lista</th><th>Contatos</th><th>Marca</th><th>Origem</th><th>Quando</th><th></th></tr>
        ${listas.map(l => `<tr><td><b>${esc(l.nome)}</b></td><td>${l.n}</td><td>${esc(l.marca)}</td><td>${esc(l.origem)}</td>
          <td>${esc(String(l.criado_em || '').slice(0, 10))}</td>
          <td><button class="btn btn-ghost tiny" data-lst-dl="${esc(l.id)}">⬇️</button>
              ${socio() ? `<button class="btn btn-ghost tiny" data-lst-meta="${esc(l.id)}" title="Criar público no Meta com esta lista" style="color:#fb923c">🚀</button>
              <button class="btn btn-ghost tiny" data-lst-del="${esc(l.id)}">🗑</button>` : ''}</td></tr>`).join('')}</table></div>`
      : '<div class="tiny muted">Nenhuma lista ainda.</div>'}
    </div>

    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:14px">
      <div class="flex" style="align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-weight:800">🌐 Públicos no Meta (via API)</div>
        <select id="pm-conta" class="input tiny" style="max-width:220px">${(_painel?.contas || []).map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select>
        <button class="btn btn-ghost tiny" id="pm-reload">↻ atualizar</button>
      </div>
      <div class="tiny muted" style="margin:4px 0 8px">Os botões 🚀 (do segmentador e das listas) criam o público personalizado DIRETO na conta selecionada — contatos com hash SHA-256, sem CSV. Aqui você acompanha e cria os semelhantes (LAL).</div>
      <div id="pm-lista"><span class="tiny muted"><span class="spinner"></span> consultando o Meta…</span></div>
    </div>

    <div style="background:var(--bg-3);border-radius:10px;padding:14px">
      <div style="font-weight:800;margin-bottom:8px">🗺 Planos de público (mapeamento)</div>
      <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:10px">
        <input id="pub-nome" class="input" placeholder="Nome (ex.: LAL 1% ganhos Conquista)" style="max-width:240px">
        <select id="pub-marca" class="input" style="max-width:130px"><option value="conquista">conquista</option><option value="imoveis">imóveis</option><option value="ambas">ambas</option></select>
        <select id="pub-tipo" class="input" style="max-width:150px"><option value="personalizado">personalizado</option><option value="semelhante">semelhante</option><option value="salvo">salvo (interesses)</option><option value="envolvimento">envolvimento IG/FB</option></select>
        <select id="pub-status" class="input" style="max-width:150px"><option value="ideia">ideia</option><option value="criado_no_meta">criado no Meta</option><option value="ativo">ativo</option><option value="pausado">pausado</option></select>
        <input id="pub-fonte" class="input" placeholder="Fonte (ex.: CSV ganhos 12m / pixel 30d)" style="max-width:230px">
        <input id="pub-def" class="input" placeholder="Definição (ex.: LAL 1% BR, exclui abertos)" style="flex:1;min-width:200px">
        <button class="btn btn-primary" id="pub-add">Salvar plano</button>
      </div>
      ${planos.length ? planos.map(p => `
        <div style="padding:8px 0;border-bottom:1px solid var(--bd)" class="flex" >
          <div style="flex:1">
            <b>${esc(p.nome)}</b> <span class="tiny muted">[${esc(p.marca)}] · ${esc(p.tipo)} · ${stBadge(p.status)}</span>
            <div class="tiny muted">${esc(p.fonte || '')} ${p.definicao ? '— ' + esc(p.definicao) : ''}</div>
          </div>
          <button class="btn btn-ghost tiny" data-pub-del="${esc(p.id)}">🗑</button>
        </div>`).join('') : '<div class="tiny muted">Nenhum plano mapeado — peça um plano de públicos pro Sr. Tráfego na Sala de Guerra e registre aqui.</div>'}
    </div>`;

  document.getElementById('seg-contar').onclick = contarSegmento;
  document.getElementById('seg-export').onclick = exportarSegmento;
  const segMeta = document.getElementById('seg-meta');
  if (segMeta) segMeta.onclick = () => criarPublicoMeta({ fonte: 'crm', ...segParams() });
  const pmReload = document.getElementById('pm-reload');
  if (pmReload) pmReload.onclick = () => pintarPublicosMeta(true);
  const pmConta = document.getElementById('pm-conta');
  if (pmConta) pmConta.onchange = () => pintarPublicosMeta(true);
  pintarPublicosMeta();
  body.querySelectorAll('[data-lst-meta]').forEach(b => b.onclick = () => criarPublicoMeta({ fonte: 'lista', lista_id: b.dataset.lstMeta }));
  document.getElementById('lst-up').onclick = subirLista;
  document.getElementById('pub-add').onclick = salvarPublico;
  body.querySelectorAll('[data-pub-del]').forEach(b => b.onclick = async () => {
    await api.request('/api/v3/marketing/gestor', { method: 'POST', body: { action: 'publico', remover: b.dataset.pubDel } });
    await load();
  });
  body.querySelectorAll('[data-lst-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remover esta lista?')) return;
    await api.request('/api/v3/marketing/gestor', { method: 'POST', body: { action: 'lista_del', id: b.dataset.lstDel } });
    await load();
  });
  body.querySelectorAll('[data-lst-dl]').forEach(b => b.onclick = async () => {
    const r = await api.request('/api/v3/marketing/gestor', { method: 'POST', body: { action: 'segmento_csv', fonte: 'lista', lista_id: b.dataset.lstDl } });
    if (r?.csv) baixarCSV(r.nome + '.csv', r.csv);
  });
}

/* v87.16 — Públicos no Meta via API (custom + lookalike) */
let _pubMetaCache = null;
async function pintarPublicosMeta(force = false) {
  const el = document.getElementById('pm-lista');
  const conta = document.getElementById('pm-conta')?.value;
  if (!el || !conta) return;
  if (force || !_pubMetaCache || _pubMetaCache.conta !== conta) {
    el.innerHTML = '<span class="tiny muted"><span class="spinner"></span> consultando o Meta…</span>';
    try {
      const r = await api.request(`/api/v3/marketing/gestor_publicos?action=listar&conta=${encodeURIComponent(conta)}`);
      _pubMetaCache = { conta, pubs: r.publicos || [], erro: null };
    } catch (e) { _pubMetaCache = { conta, pubs: [], erro: e.message }; }
  }
  const { pubs, erro } = _pubMetaCache;
  if (erro) {
    el.innerHTML = `<div class="tiny" style="color:var(--err, #ef4444)">⚠️ ${esc(erro)}</div>`;
    return;
  }
  el.innerHTML = pubs.length ? `<div style="overflow-x:auto"><table class="table tiny"><tr><th>Público</th><th>Tipo</th><th class="num">Tamanho ≥</th><th>Status</th><th></th></tr>
    ${pubs.map(p => `<tr>
      <td><b>${esc(p.name)}</b></td>
      <td>${esc(p.subtype || '')}</td>
      <td>${p.approximate_count_lower_bound != null ? Number(p.approximate_count_lower_bound).toLocaleString('pt-BR') : '—'}</td>
      <td>${esc(p.operation_status?.description || p.delivery_status?.description || '')}</td>
      <td>${socio() && p.subtype === 'CUSTOM' ? `<button class="btn btn-ghost tiny" data-lal="${esc(p.id)}" data-lal-nome="${esc(p.name)}">✨ LAL</button>` : ''}</td>
    </tr>`).join('')}</table></div>`
  : '<div class="tiny muted">Nenhum público nesta conta ainda — crie o primeiro pelo 🚀 do segmentador ou de uma lista.</div>';
  el.querySelectorAll('[data-lal]').forEach(b => b.onclick = async () => {
    const pct = prompt(`Criar público SEMELHANTE (lookalike) a partir de:\n${b.dataset.lalNome}\n\n% de similaridade (1 = mais parecido, até 10):`, '1');
    if (!pct) return;
    try {
      const r = await api.request('/api/v3/marketing/gestor_publicos', { method: 'POST', body: {
        action: 'criar_lookalike', conta: document.getElementById('pm-conta').value,
        origem_id: b.dataset.lal, ratio: (parseFloat(String(pct).replace(',', '.')) || 1) / 100,
        nome: `LAL ${pct}% — ${b.dataset.lalNome}`.slice(0, 100),
      } });
      if (r?.ok) { alert('✨ Lookalike criado: ' + r.nome); pintarPublicosMeta(true); }
    } catch (e) { alert('❌ ' + e.message); }
  });
}

async function criarPublicoMeta(origem) {
  const conta = document.getElementById('pm-conta')?.value;
  if (!conta) return alert('Nenhuma conta Meta configurada.');
  const nome = prompt('Nome do público no Meta (ex.: "CRM perdidos 90d Conquista" ou "Mailing incorporadoras"):');
  if (!nome) return;
  try {
    const r = await api.request('/api/v3/marketing/gestor_publicos', { method: 'POST', body: {
      action: 'criar_personalizado', conta, nome, ...origem,
    } });
    if (r?.ok) { alert(`🚀 Público criado no Meta!\n${r.nome} — ${r.contatos_enviados} contatos enviados (com hash).\n${r.obs || ''}`); pintarPublicosMeta(true); }
  } catch (e) { alert('❌ ' + e.message); }
}

function segParams() {
  return {
    frente: document.getElementById('seg-frente').value,
    status: document.getElementById('seg-status').value,
    dias_parado_min: parseInt(document.getElementById('seg-dias').value || '0', 10),
    com_fone: document.getElementById('seg-fone').checked,
  };
}

async function contarSegmento() {
  const p = segParams();
  _segBusy = true; render();
  try {
    _seg = await api.request(`/api/v3/marketing/gestor?action=segmento&frente=${p.frente}&status=${p.status}&dias_parado_min=${p.dias_parado_min}${p.com_fone ? '&com_fone=1' : ''}`);
  } catch (e) { _seg = null; alert('Falha: ' + e.message); }
  _segBusy = false; render();
}

async function exportarSegmento() {
  const p = segParams();
  try {
    const r = await api.request('/api/v3/marketing/gestor', { method: 'POST', body: { action: 'segmento_csv', fonte: 'crm', ...p } });
    if (r?.csv) baixarCSV(r.nome + '.csv', r.csv);
  } catch (e) { alert('Falha: ' + e.message); }
}

function baixarCSV(nome, csv) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function parseCSV(text) {
  /* parser simples: detecta , ou ; · aspas básicas · 1ª linha = cabeçalho */
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { colunas: [], linhas: [] };
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const parseLine = ln => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < ln.length; i++) {
      const ch = ln[i];
      if (q) { if (ch === '"' && ln[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const cols = parseLine(lines[0]).map(c => c.trim() || 'col');
  const linhas = lines.slice(1, 20001).map(ln => {
    const vals = parseLine(ln);
    const o = {};
    cols.forEach((c, i) => { o[c] = (vals[i] || '').trim(); });
    return o;
  });
  return { colunas: cols, linhas };
}

async function subirLista() {
  const f = document.getElementById('lst-file').files[0];
  const nome = document.getElementById('lst-nome').value.trim();
  if (!f || !nome) return alert('Escolha o arquivo CSV e dê um nome à lista.');
  const text = await f.text();
  const { colunas, linhas } = parseCSV(text);
  if (!linhas.length) return alert('CSV vazio ou não reconhecido.');
  try {
    await api.request('/api/v3/marketing/gestor', { method: 'POST', body: {
      action: 'lista', nome, marca: document.getElementById('lst-marca').value,
      origem: f.name, colunas, linhas,
    } });
    await load();
  } catch (e) { alert('Falha no upload: ' + e.message); }
}

async function salvarPublico() {
  const nome = document.getElementById('pub-nome').value.trim();
  if (!nome) return alert('Dê um nome ao plano de público.');
  await api.request('/api/v3/marketing/gestor', { method: 'POST', body: { action: 'publico', plano: {
    nome,
    marca: document.getElementById('pub-marca').value,
    tipo: document.getElementById('pub-tipo').value,
    status: document.getElementById('pub-status').value,
    fonte: document.getElementById('pub-fonte').value,
    definicao: document.getElementById('pub-def').value,
  } } });
  await load();
}

/* ───────────────────────── 🚨 Alertas ───────────────────────── */
let _regras = null;

function renderAlertas(body) {
  if (aguarde(body)) return;
  if (_regras === null) _regras = JSON.parse(JSON.stringify(_painel.alertas?.regras || []));
  const aval = {};
  (_painel.alertas?.avaliacao || []).forEach(a => { aval[a.id] = a; });
  const podeEditar = socio();
  const lims = _painel.limiares || {};
  const diags = _painel.diagnosticos || [];
  body.innerHTML = `
    <div class="tiny muted" style="margin-bottom:10px">Métricas de alerta avaliadas contra o cache Meta (7d/30d) + base RD (DDD). Regra disparada aparece no Painel. ${podeEditar ? '' : 'Só o sócio edita.'}</div>

    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-weight:800;margin-bottom:4px">📏 Limiares de viabilidade</div>
      <div class="tiny muted" style="margin-bottom:8px">Alimentam o diagnóstico automático por campanha (saturação, CTR, público, escala) e a régua de DDD.</div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        ${Object.entries(LIM_LBL).map(([k, lbl]) => `
          <label class="tiny">${lbl}<br><input class="input tiny" type="number" step="0.1" data-lim="${k}" value="${lims[k] ?? ''}" style="width:110px" ${podeEditar ? '' : 'disabled'}></label>`).join('')}
      </div>
    </div>

    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-weight:800;margin-bottom:8px">🔬 Diagnóstico automático por campanha (7 dias)</div>
      ${diags.length ? diags.map(d => `
        <div style="padding:7px 0;border-bottom:1px solid var(--bd)" class="tiny">
          ${d.sev === 'critico' ? '🔴' : d.sev === 'atencao' ? '🟡' : '🟢'} <b>${esc(d.campanha)}</b>
          ${d.spend != null ? `<span class="muted">· ${brl(d.spend)} · ${d.leads ?? 0} leads · CPL ${d.cpl ? brl(d.cpl) : '—'} · freq ${d.freq ?? '—'} · CTR ${d.ctr ?? '—'}</span>` : ''}
          <div>${esc(d.acao)}</div>
        </div>`).join('')
      : '<div class="tiny muted">Nenhum diagnóstico no momento (sem campanhas com gasto na janela, ou tudo dentro dos limiares).</div>'}
    </div>

    <div style="font-weight:800;margin-bottom:8px">🚨 Regras de alerta</div>
    <div style="overflow-x:auto"><table class="table tiny" style="min-width:760px">
      <tr><th>Nome</th><th>Métrica</th><th>Condição</th><th>Valor</th><th>Janela</th><th>Severidade</th><th>Ativo</th><th>Estado agora</th>${podeEditar ? '<th></th>' : ''}</tr>
      ${_regras.map((r, i) => {
        const a = aval[r.id];
        const estado = a ? (a.estado === 'disparado' ? `🔴 disparado (${a.valor_atual})` : a.estado === 'ok' ? `🟢 ok (${a.valor_atual})` : '⚪ ' + a.estado) : '—';
        return `<tr>
          <td><input class="input tiny" data-r="${i}" data-f="nome" value="${esc(r.nome)}" ${podeEditar ? '' : 'disabled'}></td>
          <td><select class="input tiny" data-r="${i}" data-f="metrica" ${podeEditar ? '' : 'disabled'}>${METRICAS.map(m => `<option value="${m}" ${r.metrica === m ? 'selected' : ''}>${MET_LBL[m]}</option>`).join('')}</select></td>
          <td><select class="input tiny" data-r="${i}" data-f="op" ${podeEditar ? '' : 'disabled'}><option value=">" ${r.op === '>' ? 'selected' : ''}>maior que</option><option value="<" ${r.op === '<' ? 'selected' : ''}>menor que</option></select></td>
          <td><input class="input tiny" type="number" step="0.01" data-r="${i}" data-f="valor" value="${r.valor}" style="width:90px" ${podeEditar ? '' : 'disabled'}></td>
          <td><select class="input tiny" data-r="${i}" data-f="janela" ${podeEditar ? '' : 'disabled'}><option value="last_7d" ${r.janela === 'last_7d' ? 'selected' : ''}>7 dias</option><option value="last_30d" ${r.janela === 'last_30d' ? 'selected' : ''}>30 dias</option></select></td>
          <td><select class="input tiny" data-r="${i}" data-f="severidade" ${podeEditar ? '' : 'disabled'}><option value="info" ${r.severidade === 'info' ? 'selected' : ''}>🔵 info</option><option value="atencao" ${r.severidade === 'atencao' ? 'selected' : ''}>🟡 atenção</option><option value="critico" ${r.severidade === 'critico' ? 'selected' : ''}>🔴 crítico</option></select></td>
          <td style="text-align:center"><input type="checkbox" data-r="${i}" data-f="ativo" ${r.ativo !== false ? 'checked' : ''} ${podeEditar ? '' : 'disabled'}></td>
          <td class="tiny">${estado}</td>
          ${podeEditar ? `<td><button class="btn btn-ghost tiny" data-del-regra="${i}">🗑</button></td>` : ''}
        </tr>`;
      }).join('')}
    </table></div>
    ${podeEditar ? `<div class="flex gap-2" style="margin-top:10px">
      <button class="btn" id="al-add">➕ Nova regra</button>
      <button class="btn btn-primary" id="al-save">💾 Salvar regras</button>
    </div>
    <div class="tiny muted" style="margin-top:8px">Sugestões do gestor: CPL 7d &gt; teto da estratégia (crítico) · Leads 7d &lt; mínimo semanal (atenção) · Frequência &gt; 3 (fadiga de criativo) · Gasto 30d &gt; verba do mês.</div>` : ''}`;
  body.querySelectorAll('[data-r]').forEach(el => el.onchange = () => {
    const r = _regras[+el.dataset.r];
    r[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
  });
  body.querySelectorAll('[data-del-regra]').forEach(b => b.onclick = () => { _regras.splice(+b.dataset.delRegra, 1); render(); });
  const add = document.getElementById('al-add');
  if (add) add.onclick = () => { _regras.push({ nome: '', metrica: 'cpl', op: '>', valor: 0, janela: 'last_7d', severidade: 'atencao', ativo: true }); render(); };
  const sv = document.getElementById('al-save');
  if (sv) sv.onclick = async () => {
    try {
      const limiares = {};
      body.querySelectorAll('[data-lim]').forEach(el => { if (el.value !== '') limiares[el.dataset.lim] = parseFloat(el.value); });
      const r = await api.request('/api/v3/marketing/gestor', { method: 'POST', body: { action: 'alertas', limiares, regras: _regras.map(x => ({ ...x, valor: parseFloat(x.valor) })) } });
      _regras = null; _painel = null; await load();
      if (r?.ok) alert('Regras salvas ✓');
    } catch (e) { alert('Falha: ' + e.message); }
  };
}

/* ───────────────────────── ⚡ Ações ───────────────────────── */
function renderAcoes(body) {
  if (aguarde(body)) return;
  const g = _painel.guardrails || {};
  body.innerHTML = `
    <div class="tiny muted" style="margin-bottom:10px">Ações imediatas autorizadas — executam DE VERDADE no Meta, com guardrails e trilha de auditoria. ${socio() ? '' : '<b>Somente o sócio executa.</b>'}</div>
    <div style="background:var(--bg-3);border-radius:10px;padding:10px 14px;margin-bottom:12px" class="tiny">
      🛡 <b>Guardrails ativos:</b> ops ${((g.ops_permitidas || [])).join(', ') || 'nenhuma'} · orçamento máx ${brl(g.orcamento_max_brl_dia)}/dia · variação máx ${g.variacao_max_pct}% · máx ${g.max_acoes_dia} ações/dia <span class="muted">(edite na aba 🧠 Cérebro)</span>
    </div>
    <div id="gt-campanhas"><div class="muted tiny"><span class="spinner"></span> Buscando campanhas (7 dias)…</div></div>
    <div style="font-weight:800;margin:16px 0 8px">📜 Histórico de ações</div>
    ${(_painel.log || []).length ? `<div style="overflow-x:auto"><table class="table tiny"><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>OK</th><th>Resposta</th></tr>
      ${(_painel.log || []).map(l => `<tr><td>${esc(String(l.ts || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(l.user)}</td><td>${esc(l.op)}</td><td>${esc(l.alvo?.nome || l.alvo?.id || '')}</td><td>${l.ok ? '✅' : '❌'}</td><td class="muted">${esc(String(l.resp || '').slice(0, 80))}</td></tr>`).join('')}</table></div>`
    : '<div class="tiny muted">Nenhuma ação registrada.</div>'}`;
  pintarCampanhas();
}

async function pintarCampanhas() {
  const el = document.getElementById('gt-campanhas');
  const s = await loadSummary();
  if (!el) return;
  const camps = (s?.campaigns || []).filter(c => (c.spend || 0) > 0 || c.status === 'ACTIVE')
    .sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 30);
  if (!camps.length) { el.innerHTML = '<div class="tiny muted">Sem campanhas no período (ou cache Meta vazio).</div>'; return; }
  el.innerHTML = `<div style="overflow-x:auto"><table class="table tiny" style="min-width:820px">
    <tr><th>Campanha</th><th>Conta</th><th>Status</th><th>Gasto 7d</th><th>Leads</th><th>CPL</th><th>CTR</th>${socio() ? '<th>Ações</th>' : ''}</tr>
    ${camps.map(c => `<tr>
      <td><b>${esc(String(c.name || '').slice(0, 60))}</b></td>
      <td class="muted">${esc(c.account || '')}</td>
      <td>${c.status === 'ACTIVE' ? '🟢' : '⏸'} ${esc(c.status || '')}</td>
      <td>${brl(c.spend)}</td><td>${c.results || 0}</td>
      <td>${c.results ? brl((c.spend || 0) / c.results) : '—'}</td>
      <td>${c.ctr || 0}</td>
      ${socio() ? `<td class="flex gap-1">
        ${c.status === 'ACTIVE'
          ? `<button class="btn btn-ghost tiny" data-exec="pause" data-id="${esc(c.id)}" data-nome="${esc(c.name)}">⏸ Pausar</button>`
          : `<button class="btn btn-ghost tiny" data-exec="resume" data-id="${esc(c.id)}" data-nome="${esc(c.name)}">▶️ Reativar</button>`}
        <button class="btn btn-ghost tiny" data-exec="budget" data-id="${esc(c.id)}" data-nome="${esc(c.name)}">💰 Orçamento</button>
      </td>` : ''}
    </tr>`).join('')}
  </table></div>`;
  el.querySelectorAll('[data-exec]').forEach(b => b.onclick = () => executar(b.dataset.exec, b.dataset.id, b.dataset.nome));
}

async function executar(op, id, nome) {
  const body = { action: 'meta_exec', op, alvo_id: id, alvo_nome: nome };
  if (op === 'budget') {
    const v = prompt(`Novo orçamento DIÁRIO (R$) para:\n${nome}`);
    if (!v) return;
    body.orcamento_brl = parseFloat(String(v).replace(',', '.'));
  } else if (!confirm(`${op === 'pause' ? '⏸ PAUSAR' : '▶️ REATIVAR'} a campanha no Meta?\n\n${nome}`)) return;
  try {
    const r = await api.request('/api/v3/marketing/gestor', { method: 'POST', body });
    if (r?.ok) { alert('✅ Executado no Meta.'); _summary = null; _painel = null; await load(); }
  } catch (e) { alert('❌ ' + (e.message || 'falha')); _painel = null; await load(); }
}

/* ───────────────────────── 📜 Relatórios ───────────────────────── */
let _relatorios = null;
const TIPO_LBL = { diario: '📅 Diário (19h)', semanal: '🗓 Semanal (seg 18h)', quinzenal: '📆 Quinzenal (dia 15)', mensal: '📊 Fechamento de mês', vigia: '🕵️ Vigia de Concorrência' };

async function renderRelatorios(body) {
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Buscando relatórios…</div>';
  if (_relatorios === null) {
    try { _relatorios = (await api.request('/api/v3/marketing/gestor_relatorio'))?.relatorios || []; }
    catch (e) { body.innerHTML = `<div class="muted">⚠️ ${esc(e.message)}</div>`; return; }
  }
  body.innerHTML = `
    <div class="tiny muted" style="margin-bottom:10px">Cadência automática pros sócios: <b>diário 19h</b> · <b>semanal segunda 18h</b> · <b>quinzenal dia 15</b> · <b>fechamento de mês</b>. Chegam por notificação/push e ficam aqui.</div>
    ${socio() ? `<div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:12px;align-items:center">
      <select id="rel-tipo" class="input" style="max-width:220px">${Object.entries(TIPO_LBL).filter(([k]) => k !== 'vigia').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn btn-primary" id="rel-gerar">⚡ Gerar agora</button>
      <span class="tiny muted">(geração manual não espera o horário)</span>
    </div>` : ''}
    ${_relatorios.length ? _relatorios.map((r, i) => `
      <div style="background:var(--bg-3);border-radius:10px;padding:12px 14px;margin-bottom:10px">
        <div class="flex" style="align-items:center;gap:8px;cursor:pointer" data-rel-tg="${i}">
          <b>${TIPO_LBL[r.tipo] || esc(r.tipo)}</b>
          <span class="tiny muted">· ${esc(String(r.ts || '').slice(0, 16).replace('T', ' '))} UTC · ${esc(r.periodo || '')} ${r.gerado_por && r.gerado_por !== 'cron' ? '· manual (' + esc(r.gerado_por) + ')' : ''}</span>
          <span style="margin-left:auto">${i === 0 ? '▼' : '▶'}</span>
        </div>
        <div data-rel-bd="${i}" ${i === 0 ? '' : 'hidden'} style="white-space:pre-wrap;font-size:13px;line-height:1.55;margin-top:10px;border-top:1px solid var(--bd);padding-top:10px">${esc(r.texto)}</div>
      </div>`).join('')
    : '<div class="tiny muted">Nenhum relatório ainda — o primeiro diário sai hoje às 19h (ou gere um agora).</div>'}`;
  body.querySelectorAll('[data-rel-tg]').forEach(el => el.onclick = () => {
    const bd = body.querySelector(`[data-rel-bd="${el.dataset.relTg}"]`);
    bd.hidden = !bd.hidden;
    el.querySelector('span[style*="margin-left"]').textContent = bd.hidden ? '▶' : '▼';
  });
  const g = document.getElementById('rel-gerar');
  if (g) g.onclick = async () => {
    g.disabled = true; g.textContent = '⏳ Gerando…';
    try {
      await api.request('/api/v3/marketing/gestor_relatorio', { method: 'POST', body: { tipo: document.getElementById('rel-tipo').value } });
      _relatorios = null; render();
    } catch (e) { alert('Falha: ' + e.message); g.disabled = false; g.textContent = '⚡ Gerar agora'; }
  };
}

/* ───────────────────────── 🧠 Cérebro ───────────────────────── */
function renderCerebro(body) {
  if (aguarde(body)) return;
  const cfg = _painel.config || {};
  const g = _painel.guardrails || {};
  const podeEditar = socio();
  const dis = podeEditar ? '' : 'disabled';
  const mc = (cfg.metricas_custom || []).map(m => `${m.nome}: ${m.descricao || ''}`).join('\n');
  body.innerHTML = `
    <div class="tiny muted" style="margin-bottom:12px">Aqui o gestor EVOLUI: persona, estratégia por marca, conhecimento e limites de ação. Tudo entra no cérebro do Sr. Tráfego na próxima conversa. ${podeEditar ? '' : '<b>Só o sócio edita.</b>'}</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="gt-grid">
      <div style="background:var(--bg-3);border-radius:10px;padding:14px">
        <div style="font-weight:800">🏆 Estratégia PSM Conquista</div>
        <div class="tiny muted" style="margin-bottom:6px">Verba do mês, CPL alvo, empreendimentos prioritários, funil, campanhas âncora…</div>
        <textarea id="cb-est-conq" class="input" rows="7" ${dis}>${esc(cfg.estrategia?.conquista || '')}</textarea>
      </div>
      <div style="background:var(--bg-3);border-radius:10px;padding:14px">
        <div style="font-weight:800">💎 Estratégia PSM Imóveis</div>
        <div class="tiny muted" style="margin-bottom:6px">Posicionamento quiet luxury, LUX JK, ticket, abordagem NEPQ…</div>
        <textarea id="cb-est-imov" class="input" rows="7" ${dis}>${esc(cfg.estrategia?.imoveis || '')}</textarea>
      </div>
    </div>

    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-top:14px">
      <div style="font-weight:800">🎭 Ajuste de persona</div>
      <div class="tiny muted" style="margin-bottom:6px">Instruções extras de comportamento (ex.: "sempre proponha teste A/B", "responda com plano semanal").</div>
      <textarea id="cb-persona" class="input" rows="4" ${dis}>${esc(cfg.persona_extra || '')}</textarea>
    </div>

    <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-top:14px">
      <div style="font-weight:800">📚 Conhecimento extra</div>
      <div class="tiny muted" style="margin-bottom:6px">Cole aqui o que o gestor precisa saber: tabelas de empreendimento, benchmarks, aprendizados de campanha, regras MCMV…</div>
      <textarea id="cb-conhec" class="input" rows="7" ${dis}>${esc(cfg.conhecimento_extra || '')}</textarea>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px" class="gt-grid">
      <div style="background:var(--bg-3);border-radius:10px;padding:14px">
        <div style="font-weight:800">📐 Métricas personalizadas</div>
        <div class="tiny muted" style="margin-bottom:6px">Uma por linha: <code>Nome: como calcular/interpretar</code></div>
        <textarea id="cb-metricas" class="input" rows="6" ${dis}>${esc(mc)}</textarea>
      </div>
      <div style="background:var(--bg-3);border-radius:10px;padding:14px">
        <div style="font-weight:800">🛡 Guardrails de ação</div>
        <div class="tiny muted" style="margin-bottom:8px">Limites das ações imediatas no Meta.</div>
        <label class="tiny">Orçamento máx por objeto (R$/dia)<br><input id="cb-g-orc" class="input" type="number" value="${g.orcamento_max_brl_dia || 500}" ${dis}></label><br>
        <label class="tiny">Variação máx de orçamento (%)<br><input id="cb-g-var" class="input" type="number" value="${g.variacao_max_pct || 30}" ${dis}></label><br>
        <label class="tiny">Máx de ações por dia<br><input id="cb-g-max" class="input" type="number" value="${g.max_acoes_dia || 20}" ${dis}></label><br>
        <div class="tiny" style="margin-top:6px">Operações permitidas:</div>
        ${['pause', 'resume', 'budget'].map(op => `<label class="tiny" style="margin-right:10px"><input type="checkbox" data-g-op="${op}" ${(g.ops_permitidas || []).includes(op) ? 'checked' : ''} ${dis}> ${op}</label>`).join('')}
      </div>
    </div>

    ${podeEditar ? '<div style="margin-top:14px"><button class="btn btn-primary" id="cb-save">💾 Salvar cérebro do gestor</button></div>' : ''}
    <div class="tiny muted" style="margin-top:10px">Última atualização: ${esc(String(cfg.atualizado_em || '—').slice(0, 16).replace('T', ' '))}</div>`;

  const sv = document.getElementById('cb-save');
  if (sv) sv.onclick = async () => {
    const post = (chave, valor) => api.request('/api/v3/marketing/gestor', { method: 'POST', body: { action: 'config', chave, valor } });
    try {
      await post('estrategia', {
        conquista: document.getElementById('cb-est-conq').value,
        imoveis: document.getElementById('cb-est-imov').value,
      });
      await post('persona_extra', document.getElementById('cb-persona').value);
      await post('conhecimento_extra', document.getElementById('cb-conhec').value);
      await post('metricas_custom', document.getElementById('cb-metricas').value.split('\n')
        .map(l => l.trim()).filter(Boolean).slice(0, 20)
        .map(l => { const i = l.indexOf(':'); return i > 0 ? { nome: l.slice(0, i).trim(), descricao: l.slice(i + 1).trim() } : { nome: l, descricao: '' }; }));
      await post('guardrails', {
        orcamento_max_brl_dia: parseFloat(document.getElementById('cb-g-orc').value || '500'),
        variacao_max_pct: parseFloat(document.getElementById('cb-g-var').value || '30'),
        max_acoes_dia: parseFloat(document.getElementById('cb-g-max').value || '20'),
        ops_permitidas: [...document.querySelectorAll('[data-g-op]')].filter(c => c.checked).map(c => c.dataset.gOp),
      });
      _painel = null; await load();
      alert('🧠 Cérebro atualizado ✓');
    } catch (e) { alert('Falha: ' + e.message); }
  };
}
