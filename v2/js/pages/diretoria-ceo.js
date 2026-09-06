/* PSM-OS v2 — 🏛️ Diretoria (sala do CEO IA) · v87.43 (Onda 1: CEO diário)
   Só sócio (lvl>=10). Três camadas nesta página:
     1. Faixa "Leitura de hoje" + mini-histórico 14 dias (✅/🚨) — o cron do CEO
        roda TODO DIA 7h BRT (ceo_cron) e grava o log em shared_kv ceo_diario.
     2. 📋 Compromissos — caderninho de cobrança (ceo_compromissos): o sócio
        marca "✔ feito"; quem marca 'atrasado' é o cron.
     3. Dossiês (como sempre): estado-da-uniao · plano-estrategico · parecer ·
        insight, de GET /api/v3/diretoria/dossies (shared_kv diretoria_dossies).
   Badge "novo" no menu: dossiê <3 dias ainda não aberto (localStorage) põe
   um ponto no item — sem push, sem sino (Diretoria nunca notifica broadcast). */
import { api } from '../api.js';
import { auth } from '../auth.js';

const SEEN_KEY = 'psm.v2.diretoria_ceo.seen';   // id do dossiê mais novo já aberto
const ROUTE = '/diretoria-ceo';

let _root = null;
let _items = null;      // null = carregando · [] = vazio
let _err = null;
let _openId = null;     // dossiê aberto no leitor
let _leituras = [];     // log do ceo_diario (leituras diárias do CEO)
let _comps = [];        // compromissos do caderninho
let _leituraAberta = false;  // corpo da leitura de hoje expandido
let _compBusy = null;   // id do compromisso sendo salvo

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TIPO = {
  'estado-da-uniao':   { lbl: 'Estado da União',   ico: '🏛️', color: '#7c3aed', bg: '#7c3aed22' },
  'plano-estrategico': { lbl: 'Plano Estratégico', ico: '♟️', color: '#2563eb', bg: '#2563eb22' },
  'parecer':           { lbl: 'Parecer',           ico: '⚖️', color: '#d97706', bg: '#d9770622' },
  'insight':           { lbl: 'Insight',           ico: '💡', color: '#16a34a', bg: '#16a34a22' },
  'fechamento-mensal': { lbl: 'Fechamento do mês', ico: '🗓️', color: '#0e7490', bg: '#0e749022' },
};
// fallback genérico: outros agentes publicam no mesmo kv com tipos próprios
// (ex.: Sr. CFO usa tipo 'relatorio', v87.32) — mostra o tipo cru, sem mentir.
const tipoDe = t => TIPO[t] || { lbl: (t || 'Dossiê'), ico: '📄', color: '#64748b', bg: '#64748b22' };

/* ─── data relativa ─── */
function rel(iso) {
  const d = new Date(iso || 0);
  if (isNaN(d)) return '';
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return d.toLocaleDateString('pt-BR');
}

/* ─── markdown leve (padrão da casa — vanilla, sem lib; cf. gestor-trafego v87.27) ─── */
function md(txt) {
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', inList = false;
  for (const ln of String(txt || '').split(/\r?\n/)) {
    const t = ln.trim();
    const li = t.match(/^(?:[*\-•▪]|\d+[.)])\s+(.*)/);
    if (li) { if (!inList) { html += '<ul class="dcmd-ul">'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^[─—-]{4,}$/.test(t)) { html += '<hr class="dcmd-hr">'; continue; }
    if (!t) continue;
    const h = t.match(/^(#{1,4})\s*(.*)/);
    if (h) { html += `<div class="dcmd-h${Math.min(h[1].length, 3)}">${inline(h[2])}</div>`; continue; }
    const q = t.match(/^>\s?(.*)/);
    if (q) { html += `<blockquote class="dcmd-q">${inline(q[1])}</blockquote>`; continue; }
    html += `<p class="dcmd-p">${inline(t)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

/* ─── badge "novo" no menu (chamado no boot pelo main.js, SÓ pra sócio) ───
   Regra: dossiê mais recente tem <3 dias E ainda não foi aberto aqui
   (localStorage) → ponto no item do menu. Nada de push/sino. */
export async function initDiretoriaBadge() {
  if ((auth.user()?.lvl || 0) < 10) return;
  try {
    const r = await api.request('/api/v3/diretoria/dossies?meta=1');
    const l = r && r.latest;
    if (!l || !l.id || !l.criado_em) return;
    const idadeDias = (Date.now() - new Date(l.criado_em).getTime()) / 86400000;
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch (_) {}
    if (idadeDias >= 0 && idadeDias < 3 && seen !== String(l.id)) _dot(true);
  } catch (_) { /* silencioso — badge é conveniência */ }
}

function _dot(on) {
  const btn = document.querySelector(`.app-sidebar .sb-link[data-nav="${ROUTE}"]`);
  if (!btn) return;
  let dot = btn.querySelector('.dc-menu-dot');
  if (on && !dot) {
    dot = document.createElement('span');
    dot.className = 'dc-menu-dot';
    dot.style.cssText = 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;margin-left:6px;vertical-align:middle';
    btn.appendChild(dot);
  }
  if (!on && dot) dot.remove();
}

function _markSeen() {
  const top = (_items && _items[0]) || null;
  if (top && top.id != null) { try { localStorage.setItem(SEEN_KEY, String(top.id)); } catch (_) {} }
  _dot(false);
}

/* ─── página ─── */
export async function pageDiretoriaCeo(ctx, root) {
  _root = root;
  // Defesa em profundidade: o server já 403a, mas nem renderiza pra lvl<10.
  if ((auth.user()?.lvl || 0) < 10) {
    root.innerHTML = '<div class="card"><h2 class="card-title">🏛️ Diretoria</h2><p class="muted">Área restrita aos sócios.</p></div>';
    return;
  }
  _items = null; _err = null; _openId = null; _leituras = []; _comps = []; _leituraAberta = false;
  render();
  const [rd, rl, rc] = await Promise.allSettled([
    api.request('/api/v3/diretoria/dossies'),
    api.request('/api/v3/diretoria/ceo_cron?log=1'),
    api.request('/api/v3/diretoria/compromissos'),
  ]);
  if (rd.status === 'fulfilled') {
    _items = (rd.value && Array.isArray(rd.value.items)) ? rd.value.items : [];
    // desktop abre o mais novo direto; mobile começa na LISTA (leitor é tela cheia)
    if (_items.length && window.innerWidth > 900) _openId = _items[0].id;
    _markSeen();
  } else {
    _items = []; _err = (rd.reason && rd.reason.message) || 'falha ao carregar';
  }
  if (rl.status === 'fulfilled' && Array.isArray(rl.value?.items)) _leituras = rl.value.items;
  if (rc.status === 'fulfilled' && Array.isArray(rc.value?.items)) _comps = rc.value.items;
  render();
}

async function _marcarComp(id, status) {
  if (_compBusy) return;
  _compBusy = id; render();
  try {
    await api.request('/api/v3/diretoria/compromissos', { method: 'POST', body: { id, status } });
    const r = await api.request('/api/v3/diretoria/compromissos');
    if (Array.isArray(r?.items)) _comps = r.items;
  } catch (e) {
    alert('Não deu pra salvar: ' + (e.message || e));
  }
  _compBusy = null; render();
}

const CSS = `
  .dc-wrap{display:grid;grid-template-columns:340px minmax(0,1fr);gap:14px;align-items:start}
  .dc-list{display:flex;flex-direction:column;gap:8px;min-width:0}
  .dc-item{text-align:left;background:var(--bg-1);border:1px solid var(--bd);border-radius:12px;padding:11px 13px;cursor:pointer;width:100%;font:inherit;color:var(--tx)}
  .dc-item:hover{border-color:var(--border-2)}
  .dc-item.on{border-color:var(--psm-blue);box-shadow:0 0 0 1px var(--psm-blue)}
  .dc-badge{display:inline-block;border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:800;letter-spacing:.3px}
  .dc-titulo{font-weight:800;font-size:13.5px;margin:6px 0 2px;line-height:1.35}
  .dc-manchete{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dc-reader{background:var(--bg-1);border:1px solid var(--bd);border-radius:14px;padding:20px 22px;min-width:0}
  .dc-back{display:none;background:none;border:none;color:var(--psm-blue);font-weight:800;font-size:13px;cursor:pointer;padding:0;margin-bottom:10px}
  .dcmd-h1,.dcmd-h2{font-weight:900;font-size:16px;margin:16px 0 6px;padding-bottom:5px;border-bottom:1px solid var(--bd)}
  .dcmd-h3{font-weight:800;font-size:14px;margin:13px 0 3px}
  .dcmd-p{margin:7px 0;font-size:13.5px;line-height:1.65}
  .dcmd-ul{margin:5px 0 9px;padding-left:20px}
  .dcmd-ul li{font-size:13.5px;line-height:1.6;margin:3px 0}
  .dcmd-q{margin:8px 0;padding:6px 12px;border-left:3px solid var(--psm-blue);background:var(--bg-3);border-radius:0 8px 8px 0;font-size:13px}
  .dcmd-hr{border:none;border-top:1px solid var(--bd);margin:14px 0}
  .dc-fontes{margin-top:16px;padding-top:10px;border-top:1px dashed var(--bd);font-size:11.5px;color:var(--muted)}
  @media(max-width:900px){
    .dc-wrap{grid-template-columns:1fr}
    .dc-wrap.reading .dc-list{display:none}
    .dc-wrap.reading .dc-back{display:inline-block}
    .dc-wrap:not(.reading) .dc-reader{display:none}
  }
  .dc-hoje{border:1px solid var(--bd);border-radius:12px;padding:12px 14px;margin-bottom:14px;background:var(--bg-1)}
  .dc-hoje.ok{border-color:#16a34a55}
  .dc-hoje.alerta{border-color:#ef4444;box-shadow:0 0 0 1px #ef444455;background:linear-gradient(0deg,#ef44440d,#ef44440d),var(--bg-1)}
  .dc-hoje-linha{font-weight:800;font-size:13.5px;line-height:1.45;cursor:pointer}
  .dc-hoje.ok .dc-hoje-linha{color:#16a34a}
  .dc-hoje.alerta .dc-hoje-linha{color:#ef4444}
  .dc-hist{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:9px}
  .dc-dot{width:14px;height:14px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;line-height:1}
  .dc-dot.ok{background:#16a34a33}
  .dc-dot.alerta{background:#ef4444;color:#fff}
  .dc-dot.vazio{background:var(--bg-3);border:1px solid var(--bd)}
  .dc-comps{margin-bottom:14px}
  .dc-comps table{width:100%;border-collapse:collapse;font-size:12.5px}
  .dc-comps th{text-align:left;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--bd)}
  .dc-comps td{padding:7px 8px;border-bottom:1px solid var(--bd);vertical-align:middle}
  .dc-comps tr.atrasado td{color:#ef4444}
  .dc-comps tr.done td{opacity:.5;text-decoration:line-through}
  .dc-comp-st{display:inline-block;border-radius:999px;padding:2px 8px;font-size:10.5px;font-weight:800}
  .dc-comp-feito{background:#16a34a22;color:#16a34a}
  .dc-comp-aberto{background:#2563eb22;color:#2563eb}
  .dc-comp-atrasado{background:#ef4444;color:#fff}
  .dc-comp-cancelado{background:#64748b22;color:#64748b}
  .dc-btn-feito{background:none;border:1px solid #16a34a;color:#16a34a;border-radius:8px;padding:3px 10px;font-size:11.5px;font-weight:800;cursor:pointer;white-space:nowrap}
  .dc-btn-feito:hover{background:#16a34a22}
  .dc-btn-feito:disabled{opacity:.4;cursor:wait}
  @media(max-width:700px){.dc-comps .dc-col-origem{display:none}}
`;

/* ─── faixa "Leitura de hoje" + mini-histórico 14 dias (ceo_diario) ─── */
function leituraHtml() {
  const hoje = new Date();
  const iso = d => {
    const b = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return b.toISOString().slice(0, 10);
  };
  const ult = _leituras[0] || null;

  // mini-histórico: 14 dias, do mais antigo pro mais novo
  const porData = {};
  // dia 1º pode ter 2 entradas (leitura diária + fechamento mensal, v87.44) —
  // a bolinha do dia mostra a leitura diária; o fechamento vive nos dossiês
  for (const l of _leituras) {
    const k = String(l.data);
    if (!(k in porData) || porData[k].tipo === 'fechamento-mensal') porData[k] = l;
  }
  let dots = '';
  for (let i = 13; i >= 0; i--) {
    const d = new Date(hoje.getTime() - i * 86400000);
    const k = iso(d);
    const l = porData[k];
    const tit = k.slice(8, 10) + '/' + k.slice(5, 7) + (l ? ' — ' + String(l.primeira_linha || '').slice(0, 90) : ' — sem leitura');
    dots += `<span class="dc-dot ${l ? (l.alerta ? 'alerta' : 'ok') : 'vazio'}" title="${esc(tit)}">${l ? (l.alerta ? '🚨' : '✅') : ''}</span>`;
  }
  const hist = `<div class="dc-hist"><span class="tiny muted" style="margin-right:2px">14 dias:</span>${dots}</div>`;

  if (!ult) {
    return `
    <div class="dc-hoje">
      <div class="tiny muted" style="margin-bottom:4px">☀️ Leitura de hoje · o CEO lê o negócio todo dia às 7h</div>
      <div class="muted" style="font-size:13px">Ainda sem leitura registrada — a primeira chega no próximo cron das 7h.</div>
      ${hist}
    </div>`;
  }
  const ehHoje = String(ult.data) === iso(hoje);
  const cls = ult.alerta ? 'alerta' : 'ok';
  const rotulo = ult.tipo === 'estado-da-uniao' ? '🏛️ Estado da União'
    : ult.tipo === 'fechamento-mensal' ? '🗓️ Fechamento do mês' : '☀️ Leitura de hoje';
  return `
    <div class="dc-hoje ${cls}">
      <div class="tiny muted" style="margin-bottom:4px">${rotulo} · ${ehHoje ? 'hoje' : esc(rel(ult.criado_em) || String(ult.data))} · 7h</div>
      <div class="dc-hoje-linha" data-leitura-toggle title="${_leituraAberta ? 'Recolher' : 'Ver a leitura completa'}">${esc(ult.primeira_linha || '')} <span class="tiny" style="font-weight:600;opacity:.7">${_leituraAberta ? '▲' : '▼ ver'}</span></div>
      ${_leituraAberta ? `<div style="margin-top:8px">${md(ult.corpo_md)}</div>` : ''}
      ${hist}
    </div>`;
}

/* ─── 📋 Compromissos (caderninho de cobrança) ─── */
function compsHtml() {
  if (!_comps.length) return '';
  const fmtPrazo = p => {
    if (!p) return '—';
    const [y, m, d] = String(p).slice(0, 10).split('-');
    return `${d}/${m}/${y.slice(2)}`;
  };
  const ST = { aberto: 'dc-comp-aberto', feito: 'dc-comp-feito', atrasado: 'dc-comp-atrasado', cancelado: 'dc-comp-cancelado' };
  const rows = _comps.map(c => {
    const st = String(c.status || 'aberto');
    const podeFeito = st === 'aberto' || st === 'atrasado';
    return `
      <tr class="${st === 'atrasado' ? 'atrasado' : (st === 'feito' || st === 'cancelado' ? 'done' : '')}">
        <td>${esc(c.o_que)}</td>
        <td style="white-space:nowrap">${esc(c.dono || '—')}</td>
        <td style="white-space:nowrap">${fmtPrazo(c.prazo)}</td>
        <td class="dc-col-origem tiny muted">${esc(c.origem || '')}</td>
        <td><span class="dc-comp-st ${ST[st] || 'dc-comp-aberto'}">${esc(st)}</span></td>
        <td>${podeFeito ? `<button class="dc-btn-feito" data-comp-feito="${esc(c.id)}" ${_compBusy ? 'disabled' : ''}>✔ feito</button>` : ''}</td>
      </tr>`;
  }).join('');
  return `
    <div class="dc-comps">
      <div style="font-weight:900;font-size:14px;margin-bottom:6px">📋 Compromissos <span class="tiny muted" style="font-weight:600">— o CEO cobra estes na leitura diária</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>O quê</th><th>Dono</th><th>Prazo</th><th class="dc-col-origem">Origem</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}

function _wireExtras() {
  const tg = _root.querySelector('[data-leitura-toggle]');
  if (tg) tg.addEventListener('click', () => { _leituraAberta = !_leituraAberta; render(); });
  _root.querySelectorAll('[data-comp-feito]').forEach(b =>
    b.addEventListener('click', () => _marcarComp(b.dataset.compFeito, 'feito')));
}

function render() {
  const hero = `
    <div style="background:linear-gradient(135deg,var(--psm-navy) 0%,var(--psm-navy-2) 100%);color:var(--psm-cream);padding:20px;border-radius:14px 14px 0 0;margin:-16px -16px 16px">
      <div class="flex" style="align-items:center;gap:14px">
        <div style="width:56px;height:56px;border-radius:14px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:28px">🏛️</div>
        <div>
          <div style="font-size:22px;font-weight:900">Diretoria</div>
          <div style="font-size:12.5px;opacity:.85">A sala do CEO IA — dossiês, pareceres e o Estado da União. Só sócios.</div>
        </div>
      </div>
    </div>`;

  if (_items === null) {
    _root.innerHTML = `<style>${CSS}</style><div class="card">${hero}<div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando dossiês…</div></div>`;
    return;
  }

  const extras = leituraHtml() + compsHtml();

  if (!_items.length) {
    _root.innerHTML = `<style>${CSS}</style><div class="card">${hero}${extras}
      <div style="text-align:center;padding:44px 20px">
        <div style="font-size:44px;margin-bottom:10px">🗞️</div>
        <div style="font-weight:900;font-size:16px;margin-bottom:6px">O CEO publica o Estado da União toda segunda às 7h</div>
        <p class="muted" style="font-size:13px;max-width:480px;margin:0 auto;line-height:1.6">A Diretoria é a sala fechada dos sócios: aqui chegam os dossiês do Agente CEO —<br>leitura executiva do negócio, pareceres sobre decisões e o Plano Estratégico.</p>
        ${_err ? `<p class="tiny" style="color:var(--err);margin-top:12px">⚠️ ${esc(_err)}</p>` : ''}
      </div>
    </div>`;
    _wireExtras();
    return;
  }

  const lista = _items.map(it => {
    const t = tipoDe(it.tipo);
    return `
      <button class="dc-item ${String(it.id) === String(_openId) ? 'on' : ''}" data-open="${esc(it.id)}">
        <div class="flex" style="align-items:center;gap:8px;justify-content:space-between">
          <span class="dc-badge" style="background:${t.bg};color:${t.color}">${t.ico} ${t.lbl}</span>
          <span class="tiny muted">${rel(it.criado_em)}</span>
        </div>
        <div class="dc-titulo">${esc(it.titulo)}</div>
        <div class="dc-manchete">${esc(it.manchete || '')}</div>
      </button>`;
  }).join('');

  const aberto = _items.find(it => String(it.id) === String(_openId));
  let reader = '<div class="muted" style="padding:30px;text-align:center">Escolha um dossiê na lista.</div>';
  if (aberto) {
    const t = tipoDe(aberto.tipo);
    const fontes = Array.isArray(aberto.fontes) && aberto.fontes.length
      ? `<div class="dc-fontes"><b>Fontes:</b> ${aberto.fontes.map(f => esc(f)).join(' · ')}</div>` : '';
    reader = `
      <button class="dc-back" data-back>← Voltar pra lista</button>
      <span class="dc-badge" style="background:${t.bg};color:${t.color}">${t.ico} ${t.lbl}</span>
      <h2 style="margin:10px 0 2px;font-size:20px;font-weight:900">${esc(aberto.titulo)}</h2>
      <div class="tiny muted" style="margin-bottom:6px">por <b>${esc(aberto.autor || 'CEO')}</b> · ${rel(aberto.criado_em)}${aberto.criado_em ? ` (${new Date(aberto.criado_em).toLocaleDateString('pt-BR')})` : ''}</div>
      ${aberto.manchete ? `<p style="font-size:14px;font-weight:600;color:var(--muted);margin:4px 0 10px;line-height:1.5">${esc(aberto.manchete)}</p>` : ''}
      <div>${md(aberto.corpo_md)}</div>
      ${fontes}`;
  }

  _root.innerHTML = `<style>${CSS}</style>
    <div class="card">${hero}${extras}
      <div style="font-weight:900;font-size:14px;margin-bottom:8px">🗞️ Dossiês</div>
      <div class="dc-wrap${_openId != null && aberto ? ' reading' : ''}">
        <div class="dc-list">${lista}</div>
        <div class="dc-reader">${reader}</div>
      </div>
    </div>`;

  _wireExtras();
  _root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    _openId = b.dataset.open;
    render();
    const rd = _root.querySelector('.dc-reader');
    if (rd) rd.scrollIntoView({ block: 'nearest' });
  }));
  const back = _root.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => { _openId = null; render(); });
}
