/* ============================================================================
   PSM-OS v2 — 🎓 TREINAMENTOS (v87.77)
   ----------------------------------------------------------------------------
   Ciclo de vida: agendar (convoca → agenda de cada um + Zoho + sino) → chamada
   feita pela gestão → realizado. Visões:
     • Visão geral (gestão): o que precisa de chamada, próximos, realizados
     • Calendário (gestão)
     • Meus treinamentos (todo mundo): próximos com confirmação, presença, horas
   + a ficha do treino (#/rh-treinamentos?id=…) e o bloco do One-on-One
     (habilidade prioritária pelo gargalo do funil + treino individual).
   Backend: /api/v3/gp/treinamentos3 (tabelas treinamentos + treinamento_participantes).
============================================================================ */
import { api, selectableUsers, hojeISO } from '../api.js';
import { auth } from '../auth.js';
import { router } from '../router.js';
import { CURRICULUM } from './academy.js';
import { HABILIDADES, habilidade, diagnosticar } from '../habilidades.js';

const API = '/api/v3/gp/treinamentos3';
const TIPO_LBL = { tecnico: 'Técnico', comportamental: 'Comportamental', comercial: 'Comercial', lideranca: 'Liderança', integracao: 'Integração' };
const PRES = {
  presente:    { l: 'Presente',   c: '#16a34a' },
  atrasado:    { l: 'Atrasou',    c: '#d97706' },
  ausente:     { l: 'Faltou',     c: '#dc2626' },
  justificado: { l: 'Justificou', c: '#6366f1' },
};
const EST = {
  agendado:  { l: 'Agendado',           c: '#0ea5e9', ico: '📅' },
  hoje:      { l: 'É hoje',             c: '#f59e0b', ico: '🔔' },
  chamada:   { l: 'Aguardando chamada', c: '#dc2626', ico: '⏳' },
  realizado: { l: 'Realizado',          c: '#16a34a', ico: '✅' },
  cancelado: { l: 'Cancelado',          c: '#94a3b8', ico: '🚫' },
};
const EQUIPES = ['Conquista', 'MAP', 'Locação', 'Terceiros'];
const EQUIPE_LBL = { conquista: 'Conquista', map: 'MAP', locacao: 'Locação', terceiros: 'Terceiros' };
const MAT_ICO = { link: '🔗', video: '🎬', pdf: '📄', slide: '📊', imagem: '🖼' };
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_L = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

let _root = null, _ctx = null;
let _d = null;            // lista { treinos, admin, usuarios?, zoho_ids?, modulos? }
let _tab = null;          // geral | calendario | meus
let _f = { q: '', equipe: '', formato: '', habilidade: '' };
let _verTodos = false;
let _mes = 0;             // deslocamento do calendário
let _ficha = null, _fichaGerir = false;
let _chamada = null;      // { p:{uid:{presenca,obs}}, carga_real, observacao } em edição
let _extras = null;       // { usuarios, zoho_ids, modulos } — editor

/* ─── utilitários ─── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const equipeLbl = t => EQUIPE_LBL[norm(t)] || (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : '');
const hoje = () => hojeISO();
const hm = h => (h ? String(h).slice(0, 5) : '');
const d10 = v => String(v || '').slice(0, 10);
const eu = () => (auth.user() || {}).id;
const presente = p => !!p && (p.presenca === 'presente' || p.presenca === 'atrasado');
const ini = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const pctTxt = v => (v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('pt-BR') + '%');
const fmt1 = v => (Math.round(Number(v) * 10) / 10).toLocaleString('pt-BR');
function dParts(iso) { const [y, m, d] = d10(iso).split('-').map(Number); return { y, m, d }; }
function diaSemana(iso) { const { y, m, d } = dParts(iso); return y ? new Date(y, m - 1, d).getDay() : 0; }
function somaDias(iso, n) { const { y, m, d } = dParts(iso); return hojeISO(new Date(y, m - 1, d + n)); }
function fmtData(iso) { if (!d10(iso)) return '—'; const { m, d } = dParts(iso); return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`; }
function horario(t) { return t.hora_inicio ? `${hm(t.hora_inicio)}${t.hora_fim ? '–' + hm(t.hora_fim) : ''}` : 'dia todo'; }
function estado(t) {
  if (t.status === 'cancelado') return 'cancelado';
  if (t.status === 'realizado') return 'realizado';
  const d = d10(t.data), h = hoje();
  return d > h ? 'agendado' : d === h ? 'hoje' : 'chamada';
}
function minutos(txt) {
  const s = String(txt || '').toLowerCase().replace(',', '.').trim();
  if (!s) return 0;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)?/); if (m) return Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
  m = s.match(/^(\d+)\s*min/); if (m) return parseInt(m[1], 10);
  m = s.match(/^(\d+):(\d{2})$/); if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  m = s.match(/^(\d+(?:\.\d+)?)$/); if (m) return Math.round(parseFloat(m[1]) * 60);
  return 0;
}
function difMin(a, b) {
  if (!a || !b) return 0;
  const [h1, m1] = hm(a).split(':').map(Number), [h2, m2] = hm(b).split(':').map(Number);
  return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1));
}
const cargaMin = t => minutos(t.carga_real) || minutos(t.carga_horaria) || difMin(t.hora_inicio, t.hora_fim);
const fmtHoras = min => { if (!min) return '0h'; const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`; };
const spinner = t => `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${t}</div></div>`;
const vazio = txt => `<div class="trn-vazio">${txt}</div>`;
const kpi = (ico, l, v, c) => `<div class="trn-kpi"${c ? ` style="border-top-color:${c}"` : ''}><span class="tiny muted">${ico} ${l}</span><b${c ? ` style="color:${c}"` : ''}>${v}</b></div>`;
const irPara = (id, extra = '') => { location.hash = '#/rh-treinamentos' + (id ? '?id=' + encodeURIComponent(id) + extra : ''); };
const recarregarLista = () => pageTreinamentos({ query: {} }, _root);
const podeAbrir = p => { try { return typeof router.pode === 'function' ? router.pode(p) : true; } catch (_) { return true; } };

function toast(txt) {
  const el = document.createElement('div');
  el.textContent = txt;
  el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10050;background:#0f172a;color:#fff;padding:11px 18px;border-radius:12px;font-size:13.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:92vw;transition:opacity .4s';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 4200);
  setTimeout(() => el.remove(), 4700);
}

const CSS = `<style>
.trn{--trn-acc:#0d9488}
.trn-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.trn-h1{font-size:22px;font-weight:800;letter-spacing:-.01em;line-height:1.2}
.trn-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:14px;overflow-x:auto}
.trn-tab{background:none;border:0;border-bottom:2px solid transparent;padding:9px 13px;font-weight:700;font-size:13px;color:var(--ink-muted);cursor:pointer;white-space:nowrap}
.trn-tab.on{color:var(--ink);border-bottom-color:var(--trn-acc,#0d9488)}
.trn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.trn-kpi{background:var(--bg-2);border:1px solid var(--border);border-top:3px solid var(--border);border-radius:12px;padding:10px 13px}
.trn-kpi b{display:block;font-size:22px;font-weight:800;line-height:1.15;margin-top:3px}
.trn-filtros{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.trn-sec-t{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-muted);margin:18px 2px 8px}
.trn-card{display:flex;gap:12px;align-items:center;background:var(--bg-2);border:1px solid var(--border);border-left:4px solid var(--c,#0ea5e9);border-radius:12px;padding:11px 13px;cursor:pointer;transition:transform .12s,box-shadow .12s;margin-bottom:8px}
.trn-card:hover{transform:translateY(-1px);box-shadow:var(--shadow-md,0 6px 18px rgba(0,0,0,.12))}
.trn-card-acao{background:color-mix(in srgb,#dc2626 7%,var(--bg-2))}
.trn-date{flex:0 0 52px;text-align:center;border-radius:10px;background:var(--bg-3);padding:6px 0;line-height:1.05}
.trn-date .d{font-size:20px;font-weight:900}
.trn-date .m{font-size:10.5px;font-weight:800;text-transform:uppercase;color:var(--ink-muted)}
.trn-date .w{font-size:10px;color:var(--ink-muted)}
.trn-date.lg{flex-basis:74px;padding:10px 0}
.trn-date.lg .d{font-size:30px}
.trn-main{flex:1;min-width:0}
.trn-t{font-weight:800;font-size:14.5px;line-height:1.25;overflow:hidden;text-overflow:ellipsis}
.trn-chips{display:flex;gap:5px;flex-wrap:wrap;margin:5px 0}
.trn-chip{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--bg-3);color:var(--ink-muted);white-space:nowrap}
.trn-side{text-align:right;flex:0 0 auto}
.trn-big{font-size:20px;font-weight:900;line-height:1}
.trn-bar{height:6px;background:var(--bg-3);border-radius:99px;overflow:hidden;width:110px;margin-top:3px}
.trn-bar i{display:block;height:100%}
.trn-row{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;cursor:pointer}
.trn-row:hover{background:var(--bg-3)}
.trn-row-d{font-weight:800;font-size:12px;min-width:44px;color:var(--ink-muted)}
.trn-vazio{padding:22px;text-align:center;color:var(--ink-muted);font-size:13px;border:1px dashed var(--border);border-radius:12px}
.trn-hero{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;background:var(--bg-2);border:1px solid var(--border);border-left:5px solid var(--c);border-radius:14px;padding:16px}
.trn-h2{font-size:21px;font-weight:800;margin:2px 0 0;line-height:1.2}
.trn-state{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
.trn-meta{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-muted);margin-top:6px}
.trn-act{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-left:auto}
.trn-grid2{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;margin-top:14px;align-items:start}
.trn-sec{padding:14px;margin-bottom:12px}
.trn-sec h4{margin:0 0 8px;font-size:13.5px;font-weight:800}
.trn-p{display:flex;gap:10px;align-items:center;padding:9px 2px;border-top:1px solid var(--border);flex-wrap:wrap}
.trn-av{width:32px;height:32px;border-radius:50%;background:var(--bg-3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:0 0 auto}
.trn-seg{display:inline-flex;border:1px solid var(--border);border-radius:9px;overflow:hidden;flex-wrap:wrap}
.trn-seg button{background:transparent;border:0;padding:6px 11px;font-size:12px;font-weight:700;color:var(--ink-muted);cursor:pointer;border-right:1px solid var(--border)}
.trn-seg button:last-child{border-right:0}
.trn-seg button.on{color:#fff;background:var(--c,#0d9488)}
.trn-foot{border-top:1px solid var(--border);padding-top:12px;margin-top:10px}
.trn-mat{display:block;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trn-modal-bg{position:fixed;inset:0;background:rgba(2,6,23,.62);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:22px 10px;overflow:auto}
.trn-modal{background:var(--bg-1);border:1px solid var(--border);border-radius:16px;max-width:760px;width:100%;box-shadow:var(--shadow-lg,0 20px 60px rgba(0,0,0,.35));margin:auto 0}
.trn-modal-h,.trn-modal-f{display:flex;align-items:center;gap:10px;padding:14px 18px}
.trn-modal-h{border-bottom:1px solid var(--border)}
.trn-modal-f{border-top:1px solid var(--border);position:sticky;bottom:0;background:var(--bg-1);border-radius:0 0 16px 16px;flex-wrap:wrap}
.trn-modal-b{padding:4px 18px 10px}
.trn-fs{padding:12px 0;border-bottom:1px dashed var(--border)}
.trn-fs:last-child{border-bottom:0}
.trn-fs-t{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#0d9488;margin-bottom:8px}
.trn-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.trn-l{display:block;font-size:11.5px;color:var(--ink-muted);margin:0 0 3px;font-weight:600}
.trn-check{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px;cursor:pointer}
.trn-pchip{display:inline-flex;align-items:center;gap:4px;background:var(--bg-3);border-radius:999px;padding:3px 4px 3px 10px;font-size:12px;margin:0 5px 5px 0}
.trn-pchip button{background:none;border:0;color:var(--ink-muted);cursor:pointer;font-size:12px;padding:0 5px}
.trn-sug{border:1px solid var(--border);border-radius:10px;max-height:200px;overflow:auto;margin-top:4px;background:var(--bg-1)}
.trn-sug div{padding:7px 10px;cursor:pointer;font-size:13px}
.trn-sug div:hover{background:var(--bg-3)}
.trn-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.trn-cal-h{font-size:10.5px;font-weight:800;text-transform:uppercase;color:var(--ink-muted);text-align:center;padding:4px 0}
.trn-cal-d{min-height:88px;background:var(--bg-2);border:1px solid var(--border);border-radius:9px;padding:5px;font-size:11px;cursor:default}
.trn-cal-d.fora{background:transparent;border-style:dashed;opacity:.35}
.trn-cal-d.hj{outline:2px solid #0d9488}
.trn-cal-d.add{cursor:copy}
.trn-cal-n{font-weight:800;font-size:11px;color:var(--ink-muted)}
.trn-cal-e{display:block;border-radius:5px;padding:2px 5px;margin-top:3px;color:#fff;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.trn-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px}
.trn-oo-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px}
.trn-oo-sub{font-weight:800;font-size:13px;margin-bottom:8px}
.trn-diag{border:1px solid var(--border);border-left:4px solid #dc2626;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--bg-2)}
.trn-rank{display:inline-block;background:#dc2626;color:#fff;border-radius:6px;font-size:10px;font-weight:900;padding:1px 6px}
@media (max-width:860px){.trn-grid2,.trn-oo-grid{grid-template-columns:1fr}.trn-act{margin-left:0}}
</style>`;

/* ═══════════════════════════ PÁGINA ═══════════════════════════ */
export async function pageTreinamentos(ctx, root) {
  _root = root; _ctx = ctx || {};
  const q = _ctx.query || {};
  if (q.id) return abrirFicha(q.id, q.chamada === '1');
  root.innerHTML = CSS + spinner('Carregando treinamentos…');
  try {
    _d = await api.request(API);
    if (_d.usuarios) _extras = { usuarios: _d.usuarios, zoho_ids: _d.zoho_ids || [], modulos: _d.modulos || [] };
    _tab = _d.admin ? (_tab || 'geral') : 'meus';
    render();
  } catch (e) {
    root.innerHTML = `${CSS}<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  const admin = !!_d.admin;
  _root.innerHTML = `${CSS}
  <div class="trn">
    <div class="trn-head">
      <div>
        <div class="trn-h1">🎓 Treinamentos</div>
        <div class="tiny muted">${admin ? 'Agende, faça a chamada e acompanhe quem treinou o quê. Cada treino entra na agenda e no Zoho de quem foi convocado.' : 'O que vem aí, a sua presença e as suas horas de formação.'}</div>
      </div>
      ${admin ? '<button class="btn btn-primary" id="trn-novo">+ Agendar treinamento</button>' : ''}
    </div>
    ${_d.pending ? '<div class="alert alert-warn">⏳ As tabelas de treinamento ainda não foram criadas no banco.</div>' : ''}
    ${admin ? `<div class="trn-tabs">${[['geral', '📋 Visão geral'], ['calendario', '📅 Calendário'], ['meus', '🙋 Meus treinamentos']].map(([id, l]) => `<button class="trn-tab${_tab === id ? ' on' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>` : ''}
    <div id="trn-body"></div>
  </div>`;
  _root.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { _tab = b.dataset.tab; render(); }; });
  const nv = _root.querySelector('#trn-novo');
  if (nv) nv.onclick = () => openTreinoEditor({}, recarregarLista);
  const body = _root.querySelector('#trn-body');
  if (_tab === 'calendario') renderCalendario(body);
  else if (_tab === 'meus') renderMeus(body);
  else renderGeral(body);
}

/* ─── pedaços reutilizados ─── */
function chips(t, { estadoChip = false } = {}) {
  const h = habilidade(t.habilidade), e = EST[estado(t)];
  return `<div class="trn-chips">
    ${estadoChip ? `<span class="trn-chip" style="background:${e.c}22;color:${e.c}">${e.ico} ${e.l}</span>` : ''}
    ${t.formato === 'individual' ? '<span class="trn-chip" style="background:#d6249f22;color:#d6249f">👤 Individual</span>' : ''}
    ${t.obrigatorio ? '<span class="trn-chip" style="background:#dc262622;color:#dc2626">❗ Obrigatório</span>' : ''}
    ${h ? `<span class="trn-chip" style="background:#0d948822;color:#0d9488">${h.ico} ${esc(h.nome)}</span>` : ''}
    ${t.equipe ? `<span class="trn-chip">${esc(t.equipe)}</span>` : ''}
    ${t.modalidade ? `<span class="trn-chip">${t.modalidade === 'online' ? '💻 Online' : '📍 Presencial'}</span>` : ''}
  </div>`;
}
function dataBox(iso, lg = false) {
  const { m, d } = dParts(iso);
  return `<div class="trn-date${lg ? ' lg' : ''}"><div class="d">${d ? String(d).padStart(2, '0') : '—'}</div><div class="m">${m ? MESES[m - 1] : ''}</div><div class="w">${d ? DIAS[diaSemana(iso)] : ''}</div></div>`;
}
function metaLinha(t) {
  return [`🕘 ${horario(t)}`, t.local && !/^https?:\/\//i.test(t.local) ? `📍 ${esc(t.local)}` : (t.local ? '💻 online' : ''), t.instrutor ? `🎤 ${esc(t.instrutor)}` : '']
    .filter(Boolean).join(' · ');
}
function bindAbrir(host) {
  host.querySelectorAll('[data-chamada]').forEach(b => { b.onclick = ev => { ev.stopPropagation(); irPara(b.dataset.chamada, '&chamada=1'); }; });
  host.querySelectorAll('[data-open]').forEach(el => { el.onclick = () => irPara(el.dataset.open); });
}

/* ─── filtros ─── */
function filtrosHtml() {
  return `<div class="trn-filtros">
    <input class="input" id="trf-q" placeholder="🔎 Buscar treino ou pessoa" value="${esc(_f.q)}" style="max-width:240px">
    <select class="select" id="trf-equipe" style="max-width:150px"><option value="">Equipe: todas</option>${EQUIPES.map(e => `<option${_f.equipe === e ? ' selected' : ''}>${e}</option>`).join('')}</select>
    <select class="select" id="trf-formato" style="max-width:150px"><option value="">Formato: todos</option><option value="coletivo"${_f.formato === 'coletivo' ? ' selected' : ''}>👥 Coletivo</option><option value="individual"${_f.formato === 'individual' ? ' selected' : ''}>👤 Individual</option></select>
    <select class="select" id="trf-hab" style="max-width:230px"><option value="">Habilidade: todas</option>${HABILIDADES.map(h => `<option value="${h.id}"${_f.habilidade === h.id ? ' selected' : ''}>${h.ico} ${esc(h.nome)}</option>`).join('')}</select>
  </div>`;
}
function filtroOk(t) {
  if (_f.equipe && t.equipe !== _f.equipe) return false;
  if (_f.formato && (t.formato || 'coletivo') !== _f.formato) return false;
  if (_f.habilidade && t.habilidade !== _f.habilidade) return false;
  if (_f.q) {
    const hay = norm([t.titulo, t.instrutor, t.local, ...(t.participantes || []).map(p => p.nome)].join(' '));
    if (!hay.includes(norm(_f.q))) return false;
  }
  return true;
}
function bindFiltros(host, rerender) {
  const q = host.querySelector('#trf-q');
  if (q) q.oninput = () => {
    _f.q = q.value; clearTimeout(q._t);
    q._t = setTimeout(() => { rerender(); const n = host.querySelector('#trf-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250);
  };
  [['#trf-equipe', 'equipe'], ['#trf-formato', 'formato'], ['#trf-hab', 'habilidade']].forEach(([s, k]) => {
    const el = host.querySelector(s); if (el) el.onchange = () => { _f[k] = el.value; rerender(); };
  });
}

/* ═══════════════════════ VISÃO GERAL (gestão) ═══════════════════════ */
function cardProx(t) {
  const ps = t.participantes || [], n = ps.length, e = EST[estado(t)];
  const conf = ps.filter(p => p.confirmacao === 'confirmado').length, nv = ps.filter(p => p.confirmacao === 'nao_vai').length;
  return `<div class="trn-card" style="--c:${e.c}" data-open="${esc(t.id)}">
    ${dataBox(t.data)}
    <div class="trn-main"><div class="trn-t">${esc(t.titulo)}</div>${chips(t)}<div class="tiny muted">${metaLinha(t)}</div></div>
    <div class="trn-side">
      <div class="trn-big">${n}</div><div class="tiny muted">convocado${n === 1 ? '' : 's'}</div>
      <div class="tiny" style="margin-top:3px"><span style="color:#16a34a">✓ ${conf}</span>${nv ? ` · <span style="color:#dc2626">✗ ${nv}</span>` : ''}</div>
    </div>
  </div>`;
}
function cardAcao(t) {
  const n = (t.participantes || []).length || t.n_participantes || 0, e = EST[estado(t)];
  return `<div class="trn-card trn-card-acao" style="--c:${e.c}" data-open="${esc(t.id)}">
    ${dataBox(t.data)}
    <div class="trn-main"><div class="trn-t">${esc(t.titulo)}</div>${chips(t, { estadoChip: true })}<div class="tiny muted">${metaLinha(t)} · ${n} convocado${n === 1 ? '' : 's'}</div></div>
    <button class="btn btn-primary" data-chamada="${esc(t.id)}">📋 Fazer chamada</button>
  </div>`;
}
function linhaRealizado(t) {
  const ps = t.participantes || [], n = ps.length, pres = ps.filter(presente).length;
  const pct = n ? Math.round(pres / n * 100) : 0, cor = pct >= 85 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  return `<div class="trn-row" data-open="${esc(t.id)}">
    <div class="trn-row-d">${fmtData(t.data)}</div>
    <div style="flex:1;min-width:0"><div class="trn-t" style="font-size:13.5px">${esc(t.titulo)}</div>${chips(t)}</div>
    ${t.status === 'cancelado'
      ? `<span class="tiny" style="color:#94a3b8">🚫 cancelado</span>`
      : `<div style="text-align:right"><div class="tiny"><b>${pres}/${n}</b> presentes</div><div class="trn-bar"><i style="width:${pct}%;background:${cor}"></i></div></div>`}
  </div>`;
}

function renderGeral(host) {
  const ts = _d.treinos || [];
  const lista = ts.filter(filtroOk);
  const h = hoje();
  const byData = (a, b) => (d10(a.data) + hm(a.hora_inicio)).localeCompare(d10(b.data) + hm(b.hora_inicio));
  const acao = lista.filter(t => ['chamada', 'hoje'].includes(estado(t))).sort(byData);
  const prox = lista.filter(t => estado(t) === 'agendado').sort(byData);
  const real = lista.filter(t => t.status === 'realizado').sort((a, b) => byData(b, a));
  const canc = lista.filter(t => t.status === 'cancelado');
  const d90 = somaDias(h, -90), d30 = somaDias(h, 30), mesIni = h.slice(0, 8) + '01';
  let pres = 0, tot = 0, faltas = 0;
  ts.filter(t => t.status === 'realizado' && d10(t.data) >= d90).forEach(t => (t.participantes || []).forEach(p => {
    tot++; if (presente(p)) pres++; if (t.obrigatorio && p.presenca === 'ausente') faltas++;
  }));
  const aguard = ts.filter(t => estado(t) === 'chamada').length;
  host.innerHTML = `
    <div class="trn-kpis">
      ${kpi('⏳', 'Aguardando chamada', aguard, aguard ? '#dc2626' : '')}
      ${kpi('📅', 'Próximos 30 dias', ts.filter(t => estado(t) === 'agendado' && d10(t.data) <= d30).length, '#0ea5e9')}
      ${kpi('✅', 'Realizados no mês', ts.filter(t => t.status === 'realizado' && d10(t.data) >= mesIni).length, '#16a34a')}
      ${kpi('👥', 'Presença · 90 dias', tot ? Math.round(pres / tot * 100) + '%' : '—', '#7c3aed')}
      ${kpi('❗', 'Faltas em obrigatórios', faltas, faltas ? '#dc2626' : '')}
    </div>
    ${filtrosHtml()}
    ${acao.length ? `<div class="trn-sec-t">⏳ Precisa de você</div><div class="tiny muted" style="margin:-4px 2px 8px">Já aconteceu (ou é hoje) e ainda não teve chamada.</div>${acao.map(cardAcao).join('')}` : ''}
    <div class="trn-sec-t">📅 Próximos</div>
    ${prox.length ? prox.map(cardProx).join('') : vazio(ts.length ? 'Nenhum treino agendado com esse filtro.' : 'Nenhum treino agendado ainda. Clique em <b>+ Agendar treinamento</b>.')}
    <div class="trn-sec-t">✅ Realizados</div>
    ${real.length
      ? `<div class="card" style="padding:6px">${real.slice(0, _verTodos ? 9999 : 8).map(linhaRealizado).join('')}</div>${real.length > 8 && !_verTodos ? `<button class="btn btn-ghost btn-sm mt-2" id="trn-vertodos">Ver todos (${real.length})</button>` : ''}`
      : vazio('Nenhum treino realizado ainda.')}
    ${canc.length ? `<details style="margin-top:12px"><summary class="tiny muted" style="cursor:pointer">🚫 Cancelados (${canc.length})</summary><div class="card" style="padding:6px;margin-top:6px">${canc.map(linhaRealizado).join('')}</div></details>` : ''}`;
  bindFiltros(host, () => renderGeral(host));
  bindAbrir(host);
  const vt = host.querySelector('#trn-vertodos');
  if (vt) vt.onclick = () => { _verTodos = true; renderGeral(host); };
}

/* ═══════════════════════ CALENDÁRIO (gestão) ═══════════════════════ */
function renderCalendario(host) {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + _mes);
  const y = base.getFullYear(), m = base.getMonth();
  const primeiro = new Date(y, m, 1).getDay(), dias = new Date(y, m + 1, 0).getDate();
  const porDia = {};
  (_d.treinos || []).filter(filtroOk).forEach(t => { (porDia[d10(t.data)] = porDia[d10(t.data)] || []).push(t); });
  const h = hoje();
  let cells = '';
  for (let i = 0; i < primeiro; i++) cells += '<div class="trn-cal-d fora"></div>';
  for (let d = 1; d <= dias; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const evs = (porDia[iso] || []).sort((a, b) => hm(a.hora_inicio).localeCompare(hm(b.hora_inicio)));
    cells += `<div class="trn-cal-d${iso === h ? ' hj' : ''}${_d.admin && iso >= h ? ' add' : ''}" data-dia="${iso}"><div class="trn-cal-n">${d}</div>${evs.map(t => `<span class="trn-cal-e" style="background:${EST[estado(t)].c}" data-open="${esc(t.id)}" title="${esc(t.titulo)}">${t.hora_inicio ? hm(t.hora_inicio) + ' ' : ''}${esc(t.titulo)}</span>`).join('')}</div>`;
  }
  host.innerHTML = `
    <div class="flex items-center gap-2" style="margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="cal-prev" aria-label="Mês anterior">‹</button>
      <b style="min-width:150px;text-align:center;font-size:15px">${MESES_L[m]} ${y}</b>
      <button class="btn btn-ghost btn-sm" id="cal-next" aria-label="Próximo mês">›</button>
      <button class="btn btn-ghost btn-sm" id="cal-hoje">Hoje</button>
      ${_d.admin ? '<span class="tiny muted" style="margin-left:auto">Clique num dia pra agendar.</span>' : ''}
    </div>
    ${filtrosHtml()}
    <div style="overflow-x:auto;margin-top:8px"><div class="trn-cal" style="min-width:640px">${DIAS.map(d => `<div class="trn-cal-h">${d}</div>`).join('')}${cells}</div></div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">${Object.values(EST).map(e => `<span class="tiny"><i class="trn-dot" style="background:${e.c}"></i>${e.l}</span>`).join('')}</div>`;
  bindFiltros(host, () => renderCalendario(host));
  host.querySelector('#cal-prev').onclick = () => { _mes--; renderCalendario(host); };
  host.querySelector('#cal-next').onclick = () => { _mes++; renderCalendario(host); };
  host.querySelector('#cal-hoje').onclick = () => { _mes = 0; renderCalendario(host); };
  host.querySelectorAll('[data-open]').forEach(el => { el.onclick = ev => { ev.stopPropagation(); irPara(el.dataset.open); }; });
  if (_d.admin) host.querySelectorAll('.trn-cal-d.add').forEach(el => { el.onclick = () => openTreinoEditor({ data: el.dataset.dia }, recarregarLista); });
}

/* ═══════════════════════ MEUS TREINAMENTOS (todos) ═══════════════════════ */
function meusTreinos() {
  const me = eu();
  if (!_d.admin) return _d.treinos || [];
  return (_d.treinos || [])
    .filter(t => t.instrutor_id === me || (t.participantes || []).some(p => p.user_id === me))
    .map(t => ({ ...t, eu: (t.participantes || []).find(p => p.user_id === me) || null }));
}
function confirmBox(t) {
  const c = t.eu && t.eu.confirmacao;
  if (c === 'confirmado') return `<div class="tiny" style="color:#16a34a;font-weight:800">✓ Você confirmou</div><button class="btn btn-ghost btn-sm mt-1" data-conf="nao_vai" data-id="${esc(t.id)}">Não vou poder</button>`;
  if (c === 'nao_vai') return `<div class="tiny" style="color:#dc2626;font-weight:800">✗ Você avisou que não vai</div><button class="btn btn-ghost btn-sm mt-1" data-conf="confirmado" data-id="${esc(t.id)}">Vou sim</button>`;
  return `<div class="flex gap-1" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-conf="confirmado" data-id="${esc(t.id)}">✓ Vou</button><button class="btn btn-ghost btn-sm" data-conf="nao_vai" data-id="${esc(t.id)}">Não vou</button></div>`;
}
function bindConfirmar(host, depois) {
  host.querySelectorAll('[data-conf]').forEach(b => {
    b.onclick = async ev => {
      ev.stopPropagation();
      let motivo = null;
      if (b.dataset.conf === 'nao_vai') { motivo = prompt('Qual o motivo? (vai pro seu gestor)'); if (motivo === null) return; }
      b.disabled = true;
      try {
        await api.request(API, { method: 'POST', body: { action: 'confirmar', id: b.dataset.id, confirmacao: b.dataset.conf, motivo } });
        depois();
      } catch (e) { alert('Erro: ' + e.message); b.disabled = false; }
    };
  });
}
function cardMeu(t) {
  const e = EST[estado(t)], instrutor = t.instrutor_id === eu();
  return `<div class="trn-card" style="--c:${e.c}" data-open="${esc(t.id)}">
    ${dataBox(t.data)}
    <div class="trn-main"><div class="trn-t">${esc(t.titulo)}</div>${chips(t)}<div class="tiny muted">${metaLinha(t)}</div></div>
    <div class="trn-side">${instrutor ? '<span class="trn-chip" style="background:#0d948822;color:#0d9488">🎤 Você ministra</span>' : (t.eu ? confirmBox(t) : '')}</div>
  </div>`;
}
function linhaMinha(t) {
  const p = t.eu, pr = p && p.presenca ? PRES[p.presenca] : null;
  return `<div class="trn-row" data-open="${esc(t.id)}">
    <div class="trn-row-d">${fmtData(t.data)}</div>
    <div style="flex:1;min-width:0"><div class="trn-t" style="font-size:13.5px">${esc(t.titulo)}</div>${chips(t)}</div>
    ${pr ? `<span class="trn-chip" style="background:${pr.c}22;color:${pr.c}">${pr.l}</span>` : '<span class="tiny muted">—</span>'}
    <span class="tiny muted" style="min-width:42px;text-align:right">${fmtHoras(cargaMin(t))}</span>
  </div>`;
}
// Formação PSM (Kiwify) saiu do menu (v87.78). Vários papéis de corretor não enxergam a Academy
// na matriz — chegam na Formação por aqui. Só aparece pra quem pode abrir /formacao.
function formacaoCard() {
  if (!podeAbrir('/formacao')) return '';
  return `<div class="trn-sec-t">📚 Mais formação</div>
    <a class="trn-card" href="#/formacao" style="--c:#7c3aed;text-decoration:none;color:inherit">
      <div class="trn-date" style="font-size:24px;padding:10px 0">📚</div>
      <div class="trn-main"><div class="trn-t">Formação PSM · Kiwify</div><div class="tiny muted">Onboarding, tutoriais, mercado básico, mentorias e MCMV na plataforma externa.</div></div>
      <span class="tiny muted">Abrir →</span>
    </a>`;
}
function renderMeus(host) {
  const me = eu();
  const ts = meusTreinos().filter(t => t.status !== 'cancelado');
  const byData = (a, b) => d10(a.data).localeCompare(d10(b.data));
  const prox = ts.filter(t => ['agendado', 'hoje'].includes(estado(t))).sort(byData);
  const real = ts.filter(t => t.status === 'realizado' && t.eu).sort((a, b) => byData(b, a));
  const ano = hoje().slice(0, 4);
  const horas = real.filter(t => d10(t.data).startsWith(ano) && presente(t.eu)).reduce((s, t) => s + cargaMin(t), 0);
  const presN = real.filter(t => presente(t.eu)).length;
  const pend = real.filter(t => t.obrigatorio && t.eu.presenca === 'ausente');
  const instr = ts.filter(t => estado(t) === 'chamada' && t.instrutor_id === me);
  host.innerHTML = `
    <div class="trn-kpis">
      ${kpi('📅', 'Próximos', prox.length, '#0ea5e9')}
      ${kpi('⏱', `Horas de treino em ${ano}`, fmtHoras(horas), '#0d9488')}
      ${kpi('👥', 'Sua presença', real.length ? Math.round(presN / real.length * 100) + '%' : '—', '#7c3aed')}
      ${kpi('❗', 'Obrigatórios perdidos', pend.length, pend.length ? '#dc2626' : '')}
    </div>
    ${instr.length ? `<div class="trn-sec-t">🎤 Você é o instrutor — falta a chamada</div>${instr.map(cardAcao).join('')}` : ''}
    <div class="trn-sec-t">📅 Próximos</div>
    ${prox.length ? prox.map(cardMeu).join('') : vazio('Nenhum treino marcado pra você agora.')}
    ${pend.length ? `<div class="trn-sec-t">❗ Pra repor</div><div class="tiny muted" style="margin:-4px 2px 8px">Treinos obrigatórios em que você faltou. Combine a reposição com o seu gestor.</div><div class="card" style="padding:6px">${pend.map(linhaMinha).join('')}</div>` : ''}
    <div class="trn-sec-t">🗂 Histórico</div>
    ${real.length ? `<div class="card" style="padding:6px">${real.map(linhaMinha).join('')}</div>` : vazio('Seu histórico aparece aqui depois da chamada de cada treino.')}
    ${formacaoCard()}`;
  bindAbrir(host);
  bindConfirmar(host, recarregarLista);
}

/* ═══════════════════════ FICHA DO TREINO ═══════════════════════ */
async function abrirFicha(id, comChamada) {
  _root.innerHTML = CSS + spinner('Abrindo o treinamento…');
  try {
    const r = await api.request(API + '?id=' + encodeURIComponent(id));
    _ficha = r.treino; _fichaGerir = !!r.gerir;
    if (r.usuarios) _extras = { usuarios: r.usuarios, zoho_ids: r.zoho_ids || [], modulos: r.modulos || [] };
    _chamada = null;
    if (comChamada && _fichaGerir && _ficha.status !== 'cancelado' && d10(_ficha.data) <= hoje()) iniciarChamada();
    renderFicha();
  } catch (e) {
    _root.innerHTML = `${CSS}<div class="trn"><button class="btn btn-ghost" id="trn-voltar">← Treinamentos</button><div class="alert alert-err mt-2">${esc(e.message)}</div></div>`;
    _root.querySelector('#trn-voltar').onclick = () => irPara(null);
  }
}
function iniciarChamada() {
  const p = {};
  (_ficha.participantes || []).forEach(x => { p[x.user_id] = { presenca: x.presenca || null, obs: x.presenca_obs || '' }; });
  const planejada = cargaMin(_ficha);
  _chamada = { p, carga_real: _ficha.carga_real || _ficha.carga_horaria || (planejada ? fmtHoras(planejada) : ''), observacao: _ficha.observacao || '' };
}
function nomeDe(id) {
  const u = ((_extras && _extras.usuarios) || []).find(x => x.id === id);
  return u ? (u.name || id) : (id || '—');
}
function dataHora(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return String(ts).slice(0, 16); }
}
function historico(t) {
  const linhas = [];
  if (t.created_at) linhas.push(`Agendado em ${dataHora(t.created_at)}${t.criado_por ? ' por ' + esc(nomeDe(t.criado_por)) : ''}${t.origem === 'one-on-one' ? ' · nasceu no One-on-One' : t.origem === 'migrado' ? ' · veio da versão anterior' : ''}`);
  if (t.realizado_em) linhas.push(`Chamada fechada em ${dataHora(t.realizado_em)}${t.realizado_por ? ' por ' + esc(nomeDe(t.realizado_por)) : ''}`);
  if (t.status === 'cancelado') linhas.push(`Cancelado${t.cancel_motivo ? ': ' + esc(t.cancel_motivo) : ''}`);
  return linhas.join('<br>') || '—';
}

function renderFicha() {
  const t = _ficha, st = estado(t), e = EST[st], g = _fichaGerir;
  const ps = (t.participantes || []).slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  const h = habilidade(t.habilidade);
  const lvl = (auth.user() || {}).lvl || 0;
  const acoes = [];
  if (g) {
    if ((st === 'hoje' || st === 'chamada') && !_chamada) acoes.push('<button class="btn btn-primary" id="f-chamada">📋 Fazer chamada</button>');
    if (st === 'realizado' && !_chamada) acoes.push('<button class="btn btn-ghost" id="f-chamada">✏️ Ajustar chamada</button>');
    if (st !== 'cancelado') acoes.push(`<button class="btn btn-ghost" id="f-editar">✏️ ${st === 'realizado' ? 'Editar dados' : 'Editar'}</button>`);
    if (st !== 'cancelado' && st !== 'realizado') acoes.push('<button class="btn btn-ghost" id="f-cancelar">🚫 Cancelar</button>');
    if (lvl >= 7) acoes.push('<button class="btn btn-ghost" id="f-excluir" title="Excluir de vez">🗑</button>');
  }
  const souPart = !g && t.eu && ['agendado', 'hoje'].includes(st);
  const local = t.local ? (/^https?:\/\//i.test(t.local) ? `<a href="${esc(t.local)}" target="_blank" rel="noopener">💻 entrar na reunião</a>` : `📍 ${esc(t.local)}`) : '';
  _root.innerHTML = `${CSS}
  <div class="trn">
    <div class="flex items-center gap-2" style="margin-bottom:10px"><button class="btn btn-ghost" id="trn-voltar">← Treinamentos</button></div>
    <div class="trn-hero" style="--c:${e.c}">
      ${dataBox(t.data, true)}
      <div class="trn-main">
        <div class="trn-state" style="color:${e.c}">${e.ico} ${e.l}</div>
        <h2 class="trn-h2">${esc(t.titulo)}</h2>
        ${chips(t)}
        <div class="trn-meta">
          <span>🕘 ${horario(t)}</span>
          ${local ? `<span>${local}</span>` : ''}
          ${t.instrutor ? `<span>🎤 ${esc(t.instrutor)}</span>` : ''}
          ${cargaMin(t) ? `<span>⏱ ${fmtHoras(cargaMin(t))}${t.carga_real ? ' reais' : ''}</span>` : ''}
        </div>
      </div>
      <div class="trn-act">${acoes.join('')}${souPart ? `<div style="text-align:right">${confirmBox(t)}</div>` : ''}</div>
    </div>
    <div class="trn-grid2">
      <div class="card trn-sec" id="f-parts">${_chamada ? painelChamada(t, ps) : painelParticipantes(t, ps)}</div>
      <div>
        ${t.descricao ? `<div class="card trn-sec"><h4>📝 Objetivo</h4><div style="white-space:pre-wrap;font-size:13px;line-height:1.5">${esc(t.descricao)}</div></div>` : ''}
        <div class="card trn-sec"><h4>🎯 Habilidade e Academy</h4>
          <div class="tiny" style="margin-bottom:6px">${h ? `${h.ico} <b>${esc(h.nome)}</b>${h.etapa ? ` <span class="muted">· etapa do funil: ${esc(h.etapa)}</span>` : ''}` : '<span class="muted">Sem habilidade marcada.</span>'}</div>
          <div class="tiny">${t.trilha ? `📚 Alimenta a Academy em <b>${esc(t.trilha)}${t.modulo ? ' › ' + esc(t.modulo) : ''}</b> · <a href="#/academy">abrir →</a>` : '<span class="muted">Sem destino na Academy.</span>'}</div>
        </div>
        <div class="card trn-sec"><h4>📎 Materiais</h4>${(t.materiais || []).length ? t.materiais.map(mt => `<a class="trn-mat" href="${esc(mt.url)}" target="_blank" rel="noopener">${MAT_ICO[mt.tipo] || '🔗'} ${esc(mt.titulo || mt.url)}</a>`).join('') : '<div class="tiny muted">Nenhum material anexado.</div>'}</div>
        ${t.observacao ? `<div class="card trn-sec"><h4>🗒 Observação do instrutor</h4><div style="white-space:pre-wrap;font-size:13px">${esc(t.observacao)}</div></div>` : ''}
        <div class="card trn-sec"><h4>🕓 Histórico</h4><div class="tiny muted" style="line-height:1.7">${historico(t)}</div></div>
      </div>
    </div>
  </div>`;
  _root.querySelector('#trn-voltar').onclick = () => irPara(null);
  const bc = _root.querySelector('#f-chamada'); if (bc) bc.onclick = () => { iniciarChamada(); renderFicha(); };
  const be = _root.querySelector('#f-editar'); if (be) be.onclick = () => openTreinoEditor(t, () => abrirFicha(t.id));
  const bx = _root.querySelector('#f-cancelar');
  if (bx) bx.onclick = async () => {
    const motivo = prompt('Motivo do cancelamento (vai pros convocados):');
    if (motivo === null) return;
    try {
      const r = await api.request(API, { method: 'POST', body: { action: 'cancelar', id: t.id, motivo } });
      toast(`🚫 Treinamento cancelado · ${r.avisados || 0} avisado(s) · saiu das agendas`);
      abrirFicha(t.id);
    } catch (err) { alert('Erro: ' + err.message); }
  };
  const bd = _root.querySelector('#f-excluir');
  if (bd) bd.onclick = async () => {
    if (!confirm('Excluir este treinamento de vez? Ele some da agenda e do Zoho de todo mundo.')) return;
    try { await api.request(API, { method: 'POST', body: { action: 'excluir', id: t.id } }); toast('🗑 Treinamento excluído'); irPara(null); }
    catch (err) { alert('Erro: ' + err.message); }
  };
  if (_chamada) bindChamada();
  bindConfirmar(_root, () => abrirFicha(t.id));
}

function painelParticipantes(t, ps) {
  const g = _fichaGerir, st = estado(t);
  const zoho = new Set((_extras && _extras.zoho_ids) || []);
  const futuro = st === 'agendado' || st === 'hoje';
  const conf = ps.filter(p => p.confirmacao === 'confirmado').length, nv = ps.filter(p => p.confirmacao === 'nao_vai').length;
  const pres = ps.filter(presente).length, marcou = ps.filter(p => p.presenca).length;
  const semZoho = g && futuro ? ps.filter(p => !zoho.has(p.user_id)).length : 0;
  const resumo = (t.status === 'realizado' || marcou)
    ? `<b>${pres}</b> de ${ps.length} presentes`
    : `${ps.length} convocado${ps.length === 1 ? '' : 's'} · <span style="color:#16a34a">✓ ${conf} confirmou</span>${nv ? ` · <span style="color:#dc2626">✗ ${nv} não vai</span>` : ''}`;
  const aviso = g && st === 'chamada' ? '<div class="tiny" style="margin:6px 0;color:#dc2626">⏳ O treino já passou — falta a chamada pra fechar.</div>' : '';
  return `<div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><h4 style="margin:0">👥 ${g ? 'Participantes' : 'Sua participação'}</h4>${g ? `<span class="tiny muted">${resumo}</span>` : ''}</div>
    ${aviso}
    ${semZoho ? `<div class="tiny muted" style="margin:6px 0">📵 ${semZoho} sem Zoho conectado — recebem pela agenda do House e pelo sino.</div>` : ''}
    <div style="margin-top:6px">${ps.map(p => linhaPart(p, zoho.has(p.user_id), futuro, g)).join('') || '<div class="tiny muted">Ninguém convocado.</div>'}</div>
    ${!g && (t.n_participantes || 0) > 1 ? `<div class="tiny muted" style="margin-top:6px">Turma com ${t.n_participantes} pessoas.</div>` : ''}`;
}
function linhaPart(p, temZoho, futuro, gerir) {
  const pr = p.presenca ? PRES[p.presenca] : null;
  const c = p.confirmacao === 'confirmado' ? '<span class="tiny" style="color:#16a34a">✓ confirmou</span>'
    : p.confirmacao === 'nao_vai' ? `<span class="tiny" style="color:#dc2626">✗ não vai${p.confirmacao_motivo ? ': ' + esc(p.confirmacao_motivo) : ''}</span>`
    : (futuro ? '<span class="tiny muted">sem resposta</span>' : '');
  return `<div class="trn-p">
    <div class="trn-av">${esc(ini(p.nome))}</div>
    <div style="flex:1;min-width:120px"><div style="font-weight:700;font-size:13px">${esc(p.nome || p.user_id)}</div><div>${c}${gerir && futuro && !temZoho ? ' <span class="tiny muted" title="Sem Zoho conectado">· 📵 sem Zoho</span>' : ''}</div></div>
    ${pr ? `<span class="trn-chip" style="background:${pr.c}22;color:${pr.c}">${pr.l}${p.presenca_obs ? ' · ' + esc(p.presenca_obs) : ''}</span>` : ''}
  </div>`;
}

function painelChamada(t, ps) {
  const falta = ps.filter(p => !(_chamada.p[p.user_id] || {}).presenca).length;
  const realizado = t.status === 'realizado';
  return `<div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
      <h4 style="margin:0">📋 Chamada <span class="tiny muted" style="font-weight:600">· ${ps.length} convocado${ps.length === 1 ? '' : 's'}</span></h4>
      <button class="btn btn-ghost btn-sm" id="ch-todos">✓ Todos presentes</button>
    </div>
    <div class="tiny muted" style="margin:4px 0 4px">Marque cada pessoa. Quem faltou, atrasou ou justificou pode levar uma observação.</div>
    <div>${ps.map(linhaChamada).join('')}</div>
    <div class="trn-foot">
      <div class="trn-g">
        <div><label class="trn-l" for="ch-carga">Carga horária real</label><input class="input" id="ch-carga" value="${esc(_chamada.carga_real || '')}" placeholder="ex.: 4h"></div>
      </div>
      <label class="trn-l" for="ch-obs" style="margin-top:8px">Observação do instrutor (opcional)</label>
      <textarea class="input" id="ch-obs" rows="2" placeholder="Como foi, o que ficou de tarefa, quem se destacou…">${esc(_chamada.observacao || '')}</textarea>
      <div class="flex items-center gap-2" style="margin-top:10px;flex-wrap:wrap">
        <span class="tiny" id="ch-status" style="font-weight:700;color:${falta ? '#d97706' : '#16a34a'}">${falta ? `Falta marcar ${falta}` : 'Chamada completa ✓'}</span>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" id="ch-cancel">Cancelar</button>
        ${realizado ? '' : '<button class="btn btn-ghost" id="ch-rascunho">💾 Salvar rascunho</button>'}
        <button class="btn btn-primary" id="ch-ok"${falta ? ' disabled' : ''}>${realizado ? '💾 Salvar ajustes' : '✅ Marcar como realizado'}</button>
      </div>
      <div class="tiny" id="ch-msg" style="margin-top:6px"></div>
    </div>`;
}
function linhaChamada(p) {
  const v = _chamada.p[p.user_id] || {};
  return `<div class="trn-p" data-ch="${esc(p.user_id)}">
    <div class="trn-av">${esc(ini(p.nome))}</div>
    <div style="flex:1;min-width:120px"><div style="font-weight:700;font-size:13px">${esc(p.nome || p.user_id)}</div>${p.confirmacao === 'nao_vai' ? `<div class="tiny" style="color:#dc2626">avisou que não ia${p.confirmacao_motivo ? ': ' + esc(p.confirmacao_motivo) : ''}</div>` : ''}</div>
    <div class="trn-seg" role="group" aria-label="Presença de ${esc(p.nome || '')}">${Object.entries(PRES).map(([k, x]) => `<button type="button" data-pr="${k}" class="${v.presenca === k ? 'on' : ''}" style="--c:${x.c}">${x.l}</button>`).join('')}</div>
    <input class="input" data-obs placeholder="observação (opcional)" value="${esc(v.obs || '')}" style="${v.presenca && v.presenca !== 'presente' ? '' : 'display:none;'}flex:1 1 100%">
  </div>`;
}
function bindChamada() {
  const box = _root.querySelector('#f-parts'); if (!box) return;
  const ps = _ficha.participantes || [];
  const atualiza = () => {
    const falta = ps.filter(p => !(_chamada.p[p.user_id] || {}).presenca).length;
    const s = box.querySelector('#ch-status');
    if (s) { s.textContent = falta ? `Falta marcar ${falta}` : 'Chamada completa ✓'; s.style.color = falta ? '#d97706' : '#16a34a'; }
    const ok = box.querySelector('#ch-ok'); if (ok) ok.disabled = !!falta;
  };
  box.querySelectorAll('[data-ch]').forEach(row => {
    const uid = row.dataset.ch;
    row.querySelectorAll('[data-pr]').forEach(b => {
      b.onclick = () => {
        _chamada.p[uid] = { ...(_chamada.p[uid] || {}), presenca: b.dataset.pr };
        row.querySelectorAll('[data-pr]').forEach(x => x.classList.toggle('on', x === b));
        const obs = row.querySelector('[data-obs]'); if (obs) obs.style.display = b.dataset.pr === 'presente' ? 'none' : '';
        atualiza();
      };
    });
    const obs = row.querySelector('[data-obs]');
    if (obs) obs.oninput = () => { _chamada.p[uid] = { ...(_chamada.p[uid] || {}), obs: obs.value }; };
  });
  box.querySelector('#ch-todos').onclick = () => {
    ps.forEach(p => { _chamada.p[p.user_id] = { ...(_chamada.p[p.user_id] || {}), presenca: 'presente' }; });
    box.innerHTML = painelChamada(_ficha, ps.slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')));
    bindChamada();
  };
  box.querySelector('#ch-carga').oninput = ev => { _chamada.carga_real = ev.target.value; };
  box.querySelector('#ch-obs').oninput = ev => { _chamada.observacao = ev.target.value; };
  box.querySelector('#ch-cancel').onclick = () => { _chamada = null; renderFicha(); };
  const salvar = async (action, btn) => {
    const msg = box.querySelector('#ch-msg');
    btn.disabled = true; msg.style.color = ''; msg.textContent = '⏳ salvando…';
    try {
      const r = await api.request(API, { method: 'POST', body: { action, id: _ficha.id, presencas: _chamada.p, carga_real: _chamada.carga_real, observacao: _chamada.observacao } });
      _ficha = { ..._ficha, ...(r.treino || {}) };
      _chamada = null;
      renderFicha();
      toast(action === 'realizar' ? '✅ Treinamento realizado — presença registrada' : '💾 Chamada salva');
    } catch (err) { msg.textContent = '⚠️ ' + err.message; msg.style.color = '#dc2626'; btn.disabled = false; }
  };
  const ok = box.querySelector('#ch-ok'); if (ok) ok.onclick = () => salvar(_ficha.status === 'realizado' ? 'chamada' : 'realizar', ok);
  const ra = box.querySelector('#ch-rascunho'); if (ra) ra.onclick = () => salvar('chamada', ra);
}

/* ═══════════════════════ EDITOR (agendar / editar) ═══════════════════════ */
export async function openTreinoEditor(seed = {}, onSaved) {
  if (!_extras) {
    try {
      const r = await api.request(API + '?extras=1');
      _extras = { usuarios: r.usuarios || [], zoho_ids: r.zoho_ids || [], modulos: r.modulos || [] };
    } catch (e) { alert('Não consegui abrir o editor: ' + e.message); return; }
  }
  const seedParts = (seed.participantes || []).map(p => (p && p.user_id) || p).filter(Boolean);
  const users = selectableUsers(_extras.usuarios, ...seedParts, seed.instrutor_id)
    .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  const umap = Object.fromEntries((_extras.usuarios || []).map(u => [u.id, u]));
  const zoho = new Set(_extras.zoho_ids || []);
  const times = {};
  users.forEach(u => { const k = norm(u.team); if (k && k !== 'geral') (times[k] = times[k] || []).push(u); });
  const f = {
    id: seed.id || null, titulo: seed.titulo || '', descricao: seed.descricao || '',
    formato: seed.formato || 'coletivo', tipo: seed.tipo || '', habilidade: seed.habilidade || '',
    obrigatorio: !!seed.obrigatorio, data: d10(seed.data), hora_inicio: hm(seed.hora_inicio), hora_fim: hm(seed.hora_fim),
    modalidade: seed.modalidade || 'presencial', local: seed.local || '',
    instrutor_id: seed.instrutor_id || '', instrutor: seed.instrutor || '', externo: !!(seed.instrutor && !seed.instrutor_id),
    equipe: seed.equipe || '', trilha: seed.trilha || '', modulo: seed.modulo || '', moduloNovo: false,
    materiais: JSON.parse(JSON.stringify(seed.materiais || [])),
    parts: seedParts, origem: seed.origem || null,
  };
  let busca = '';
  let sugestao = habilidade(f.habilidade);
  const ov = document.createElement('div');
  ov.className = 'trn-modal-bg';
  ov.innerHTML = CSS + '<div class="trn-modal" role="dialog" aria-modal="true" aria-label="Treinamento"></div>';
  document.body.appendChild(ov);
  const m = ov.querySelector('.trn-modal');
  const fechar = () => ov.remove();
  ov.addEventListener('mousedown', ev => { if (ev.target === ov) fechar(); });

  const trilhas = () => { const s = new Set(CURRICULUM.map(c => c.trilha)); (_extras.modulos || []).forEach(x => s.add(x.trilha)); return [...s]; };
  const modulosDe = tr => {
    const s = new Set(); const c = CURRICULUM.find(x => x.trilha === tr);
    if (c) c.modulos.forEach(x => s.add(x.nome));
    (_extras.modulos || []).filter(x => x.trilha === tr).forEach(x => s.add(x.modulo));
    return [...s];
  };
  const ler = () => {
    const g = id => m.querySelector('#' + id);
    ['titulo', 'descricao', 'tipo', 'habilidade', 'data', 'hora_inicio', 'hora_fim', 'local', 'equipe', 'instrutor'].forEach(k => { const el = g('te-' + k); if (el) f[k] = el.value; });
    const ob = g('te-obrig'); if (ob) f.obrigatorio = ob.checked;
    const it = g('te-instrutor_id'); if (it) { f.externo = it.value === '__ext'; f.instrutor_id = f.externo ? '' : it.value; }
    const tr = g('te-trilha'); if (tr) f.trilha = tr.value;
    const mo = g('te-modulo'); if (mo) { f.moduloNovo = mo.value === '__novo'; if (!f.moduloNovo) f.modulo = mo.value; }
    const mn = g('te-modulo-novo'); if (mn) f.modulo = mn.value;
    const pe = g('te-pessoa'); if (pe && f.formato === 'individual') f.parts = pe.value ? [pe.value] : [];
    m.querySelectorAll('[data-mt]').forEach(el => { const i = +el.dataset.i; if (f.materiais[i]) f.materiais[i][el.dataset.mt] = el.value; });
  };
  const sugHtml = () => {
    const q = norm(busca);
    if (!q) return '';
    const achados = users.filter(u => !f.parts.includes(u.id) && norm(u.name).includes(q)).slice(0, 12);
    return achados.length
      ? `<div class="trn-sug">${achados.map(u => `<div data-add="${esc(u.id)}">${esc(u.name || u.id)} <span class="tiny muted">${esc(equipeLbl(u.team))}</span></div>`).join('')}</div>`
      : '<div class="tiny muted" style="margin-top:4px">Ninguém com esse nome (ou já está na lista).</div>';
  };
  const bindSug = () => {
    m.querySelectorAll('[data-add]').forEach(el => {
      el.onclick = () => { ler(); f.parts.push(el.dataset.add); busca = ''; render(); const n = m.querySelector('#te-busca'); if (n) n.focus(); };
    });
  };

  const render = () => {
    const nome = id => (umap[id] && umap[id].name) || id;
    const semZoho = f.parts.filter(id => !zoho.has(id)).length;
    const h = habilidade(f.habilidade);
    const tr = trilhas(), mods = f.trilha ? modulosDe(f.trilha) : [];
    const moduloFora = !!f.modulo && !mods.includes(f.modulo);
    const mostraNovo = f.moduloNovo || moduloFora;
    const ordemTimes = Object.keys(times).sort((a, b) => (EQUIPES.map(norm).indexOf(a) + 1 || 99) - (EQUIPES.map(norm).indexOf(b) + 1 || 99));
    m.innerHTML = `
      <div class="trn-modal-h"><b style="font-size:16px">${f.id ? '✏️ Editar treinamento' : '🎓 Agendar treinamento'}</b><span style="flex:1"></span><button class="btn btn-ghost btn-sm" id="te-x" aria-label="Fechar">✕</button></div>
      <div class="trn-modal-b">
        <div class="trn-fs"><div class="trn-fs-t">1 · O quê</div>
          <label class="trn-l" for="te-titulo">Título *</label>
          <input class="input" id="te-titulo" value="${esc(f.titulo)}" placeholder="Ex.: Posicionamento — Parte 2">
          <label class="trn-l" for="te-descricao" style="margin-top:8px">Objetivo</label>
          <textarea class="input" id="te-descricao" rows="2" placeholder="O que a pessoa sai sabendo fazer">${esc(f.descricao)}</textarea>
          <div class="trn-g" style="margin-top:8px">
            <div><label class="trn-l" for="te-habilidade">Habilidade que desenvolve</label><select class="select" id="te-habilidade"><option value="">—</option>${HABILIDADES.map(x => `<option value="${x.id}"${f.habilidade === x.id ? ' selected' : ''}>${x.ico} ${esc(x.nome)}</option>`).join('')}</select>${h && h.etapa ? `<div class="tiny muted" style="margin-top:3px">Etapa do funil: ${esc(h.etapa)}</div>` : ''}</div>
            <div><label class="trn-l" for="te-tipo">Tipo</label><select class="select" id="te-tipo"><option value="">—</option>${Object.entries(TIPO_LBL).map(([k, l]) => `<option value="${k}"${f.tipo === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          </div>
          <label class="trn-check"><input type="checkbox" id="te-obrig"${f.obrigatorio ? ' checked' : ''}> <span><b>Obrigatório</b> <span class="tiny muted">— quem faltar fica com reposição pendente</span></span></label>
        </div>
        <div class="trn-fs"><div class="trn-fs-t">2 · Quando e onde</div>
          <div class="trn-g">
            <div><label class="trn-l" for="te-data">Data *</label><input class="input" type="date" id="te-data" value="${esc(f.data)}"></div>
            <div><label class="trn-l" for="te-hora_inicio">Início</label><input class="input" type="time" id="te-hora_inicio" value="${esc(f.hora_inicio)}"></div>
            <div><label class="trn-l" for="te-hora_fim">Fim</label><input class="input" type="time" id="te-hora_fim" value="${esc(f.hora_fim)}"></div>
          </div>
          <div class="trn-g" style="margin-top:8px">
            <div><span class="trn-l">Modalidade</span><div class="trn-seg">${[['presencial', '📍 Presencial'], ['online', '💻 Online']].map(([k, l]) => `<button type="button" data-mod="${k}" class="${f.modalidade === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
            <div style="grid-column:span 2"><label class="trn-l" for="te-local">${f.modalidade === 'online' ? 'Link da reunião' : 'Local'}</label><input class="input" id="te-local" value="${esc(f.local)}" placeholder="${f.modalidade === 'online' ? 'https://meet.google.com/…' : 'Ex.: Sala de treinamento'}"></div>
          </div>
        </div>
        <div class="trn-fs"><div class="trn-fs-t">3 · Quem</div>
          <div class="trn-g">
            <div><span class="trn-l">Formato</span><div class="trn-seg">${[['coletivo', '👥 Coletivo'], ['individual', '👤 Individual']].map(([k, l]) => `<button type="button" data-fmt="${k}" class="${f.formato === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
            <div><label class="trn-l" for="te-instrutor_id">Instrutor</label><select class="select" id="te-instrutor_id"><option value="">—</option>${users.map(u => `<option value="${esc(u.id)}"${f.instrutor_id === u.id ? ' selected' : ''}>${esc(u.name || u.id)}</option>`).join('')}<option value="__ext"${f.externo ? ' selected' : ''}>Outro (de fora)…</option></select>${f.externo ? `<input class="input" id="te-instrutor" value="${esc(f.instrutor)}" placeholder="Nome do instrutor" style="margin-top:5px">` : ''}</div>
            <div><label class="trn-l" for="te-equipe">Equipe</label><select class="select" id="te-equipe"><option value="">—</option>${EQUIPES.map(e => `<option${f.equipe === e ? ' selected' : ''}>${e}</option>`).join('')}</select></div>
          </div>
          ${f.formato === 'individual' ? `
            <label class="trn-l" for="te-pessoa" style="margin-top:10px">Pessoa *</label>
            <select class="select" id="te-pessoa"><option value="">Escolha…</option>${users.map(u => `<option value="${esc(u.id)}"${f.parts[0] === u.id ? ' selected' : ''}>${esc(u.name || u.id)}${u.team ? ' · ' + esc(equipeLbl(u.team)) : ''}</option>`).join('')}</select>
            <div class="tiny muted" style="margin-top:4px">Fica no One-on-One dessa pessoa, junto com o histórico de treinos dela.</div>` : `
            <span class="trn-l" style="margin-top:10px">Convocados * <span class="muted">(${f.parts.length})</span></span>
            <div class="flex gap-1" style="flex-wrap:wrap;margin-bottom:6px">${ordemTimes.map(k => `<button type="button" class="btn btn-ghost btn-sm" data-eq="${esc(k)}">+ ${esc(equipeLbl(k))} (${times[k].length})</button>`).join('')}<button type="button" class="btn btn-ghost btn-sm" data-eq="__todos">+ Todos (${users.length})</button>${f.parts.length ? '<button type="button" class="btn btn-ghost btn-sm" data-eq="__limpar">Limpar</button>' : ''}</div>
            <input class="input" id="te-busca" placeholder="🔎 Adicionar pessoa pelo nome" value="${esc(busca)}" autocomplete="off" aria-label="Adicionar pessoa pelo nome">
            <div id="te-sug">${sugHtml()}</div>
            <div style="margin-top:8px">${f.parts.map(id => `<span class="trn-pchip">${esc(nome(id))}${zoho.has(id) ? '' : ' <span title="Sem Zoho conectado">📵</span>'}<button type="button" data-rm="${esc(id)}" aria-label="Remover ${esc(nome(id))}">✕</button></span>`).join('') || '<span class="tiny muted">Ninguém convocado ainda.</span>'}</div>`}
          ${f.parts.length ? `<div class="tiny muted" style="margin-top:4px">${semZoho ? `📵 ${semZoho} sem Zoho conectado — recebe${semZoho === 1 ? '' : 'm'} pela agenda do House e pelo sino.` : '📆 Todos recebem o convite também no Zoho.'}</div>` : ''}
        </div>
        <div class="trn-fs"><div class="trn-fs-t">4 · Academy</div>
          <div class="tiny muted" style="margin-bottom:6px">Em que módulo esse conteúdo entra. É o que vai alimentar a Academy depois do treino.</div>
          <div class="trn-g">
            <div><label class="trn-l" for="te-trilha">Trilha</label><select class="select" id="te-trilha"><option value="">—</option>${tr.map(x => `<option${f.trilha === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
            <div><label class="trn-l" for="te-modulo">Módulo</label><select class="select" id="te-modulo"${f.trilha ? '' : ' disabled'}><option value="">—</option>${mods.map(x => `<option${!mostraNovo && f.modulo === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}<option value="__novo"${mostraNovo ? ' selected' : ''}>➕ Assunto novo…</option></select>
              ${mostraNovo ? `<input class="input" id="te-modulo-novo" value="${esc(f.modulo)}" placeholder="Nome do módulo novo" style="margin-top:5px">` : ''}</div>
          </div>
        </div>
        <div class="trn-fs"><div class="trn-fs-t">5 · Materiais</div>
          ${f.materiais.map((mt, i) => `<div class="flex gap-1" style="margin-bottom:5px">
            <select class="select" data-mt="tipo" data-i="${i}" style="flex:0 0 110px" aria-label="Tipo do material">${Object.keys(MAT_ICO).map(k => `<option value="${k}"${mt.tipo === k ? ' selected' : ''}>${MAT_ICO[k]} ${k}</option>`).join('')}</select>
            <input class="input" data-mt="titulo" data-i="${i}" value="${esc(mt.titulo || '')}" placeholder="Nome" style="flex:0 0 30%" aria-label="Nome do material">
            <input class="input" data-mt="url" data-i="${i}" value="${esc(mt.url || '')}" placeholder="Link" style="flex:1;min-width:0" aria-label="Link do material">
            <button type="button" class="btn btn-ghost btn-sm" data-mrm="${i}" aria-label="Remover material">✕</button></div>`).join('')}
          <button type="button" class="btn btn-ghost btn-sm" id="te-addmat">+ material (slides, vídeo, PDF…)</button>
        </div>
      </div>
      <div class="trn-modal-f"><span class="tiny" id="te-msg" style="flex:1;min-width:160px"></span><button class="btn btn-ghost" id="te-cancel">Cancelar</button><button class="btn btn-primary" id="te-save">${f.id ? '💾 Salvar' : `📣 Agendar e convocar${f.parts.length ? ' ' + f.parts.length : ''}`}</button></div>`;
    bind();
  };

  const bind = () => {
    m.querySelector('#te-x').onclick = fechar;
    m.querySelector('#te-cancel').onclick = fechar;
    m.querySelectorAll('[data-mod]').forEach(b => { b.onclick = () => { ler(); f.modalidade = b.dataset.mod; render(); }; });
    m.querySelectorAll('[data-fmt]').forEach(b => {
      b.onclick = () => { ler(); f.formato = b.dataset.fmt; if (f.formato === 'individual' && f.parts.length > 1) f.parts = f.parts.slice(0, 1); render(); };
    });
    m.querySelector('#te-habilidade').onchange = () => {
      ler();
      const nova = habilidade(f.habilidade);
      // trilha/módulo acompanham a habilidade enquanto ninguém mexeu neles
      const intocado = !f.trilha || (sugestao && f.trilha === sugestao.trilha && f.modulo === sugestao.modulo);
      if (nova && nova.trilha && intocado) { f.trilha = nova.trilha; f.modulo = nova.modulo; f.moduloNovo = false; }
      sugestao = nova; render();
    };
    m.querySelector('#te-instrutor_id').onchange = () => { ler(); render(); };
    m.querySelector('#te-trilha').onchange = () => { ler(); f.modulo = ''; f.moduloNovo = false; render(); };
    const mo = m.querySelector('#te-modulo');
    if (mo) mo.onchange = () => { ler(); if (f.moduloNovo) f.modulo = ''; render(); const mn = m.querySelector('#te-modulo-novo'); if (mn) mn.focus(); };
    m.querySelectorAll('[data-eq]').forEach(b => {
      b.onclick = () => {
        ler();
        const k = b.dataset.eq;
        if (k === '__limpar') f.parts = [];
        else {
          (k === '__todos' ? users : (times[k] || [])).forEach(u => { if (!f.parts.includes(u.id)) f.parts.push(u.id); });
          if (k !== '__todos' && !f.equipe && EQUIPES.includes(equipeLbl(k))) f.equipe = equipeLbl(k);
        }
        render();
      };
    });
    const bs = m.querySelector('#te-busca');
    if (bs) bs.oninput = () => { busca = bs.value; const box = m.querySelector('#te-sug'); if (box) { box.innerHTML = sugHtml(); bindSug(); } };
    bindSug();
    m.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { ler(); f.parts = f.parts.filter(x => x !== b.dataset.rm); render(); }; });
    m.querySelector('#te-addmat').onclick = () => { ler(); f.materiais.push({ tipo: 'link', titulo: '', url: '' }); render(); };
    m.querySelectorAll('[data-mrm]').forEach(b => { b.onclick = () => { ler(); f.materiais.splice(+b.dataset.mrm, 1); render(); }; });
    m.querySelector('#te-save').onclick = salvar;
  };

  const salvar = async () => {
    ler();
    const msg = m.querySelector('#te-msg'), btn = m.querySelector('#te-save');
    const erro = !f.titulo.trim() ? 'Dê um título ao treino.'
      : !f.data ? 'Escolha a data.'
      : !f.parts.length ? (f.formato === 'individual' ? 'Escolha a pessoa.' : 'Convoque ao menos 1 pessoa.')
      : (f.hora_inicio && f.hora_fim && f.hora_fim <= f.hora_inicio) ? 'O fim precisa ser depois do início.'
      : (f.externo && !f.instrutor.trim()) ? 'Escreva o nome do instrutor de fora.' : '';
    if (erro) { msg.textContent = '⚠️ ' + erro; msg.style.color = '#dc2626'; return; }
    btn.disabled = true; msg.style.color = ''; msg.textContent = f.id ? '⏳ salvando…' : '⏳ agendando e convocando…';
    const dur = difMin(f.hora_inicio, f.hora_fim);
    const treino = {
      id: f.id, titulo: f.titulo.trim(), descricao: f.descricao, formato: f.formato, tipo: f.tipo || null,
      habilidade: f.habilidade || null, obrigatorio: f.obrigatorio, data: f.data,
      hora_inicio: f.hora_inicio || null, hora_fim: f.hora_inicio ? (f.hora_fim || null) : null,
      modalidade: f.modalidade, local: f.local.trim(),
      instrutor_id: f.externo ? null : (f.instrutor_id || null),
      instrutor: f.externo ? f.instrutor.trim() : (f.instrutor_id ? ((umap[f.instrutor_id] || {}).name || '') : ''),
      equipe: f.equipe || null, trilha: f.trilha || null, modulo: (f.modulo || '').trim() || null,
      carga_horaria: dur ? fmtHoras(dur) : (seed.carga_horaria || null),
      materiais: f.materiais.filter(x => (x.url || '').trim() || (x.titulo || '').trim()),
    };
    try {
      const r = await api.request(API, { method: 'POST', body: { action: 'salvar', treino, participantes: f.parts, origem: f.origem } });
      fechar();
      const z = r.agenda || {};
      toast(f.id
        ? `💾 Treinamento salvo${r.avisados ? ` · ${r.avisados} avisado(s)` : ''}`
        : `📣 Convocação enviada · ${r.avisados || 0} no sino · ${z.zoho || 0} no Zoho${z.zoho_pendente ? ` (+${z.zoho_pendente} em até 30 min)` : ''}`);
      if (onSaved) onSaved(r);
    } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.style.color = '#dc2626'; btn.disabled = false; }
  };

  render();
  setTimeout(() => { const t = m.querySelector('#te-titulo'); if (t && !f.titulo) t.focus(); }, 40);
}

/* ═══════════════════════ BLOCO DO ONE-ON-ONE ═══════════════════════ */
function itemDiag(it, i, podeAgendar, treinado) {
  const hb = it.hab;
  const evid = it.taxa != null
    ? `${esc(it.etapa)}: <b style="color:#dc2626">${pctTxt(it.taxa)}</b>${it.ref != null ? ` <span class="muted">· ${esc(it.refLbl || 'média da equipe')}</span> <b>${pctTxt(it.ref)}</b>` : ''}`
    : `${esc(it.etapa)}: <b style="color:#dc2626">${esc(it.texto || '')}</b>`;
  return `<div class="trn-diag"${i ? ' style="border-left-color:#f59e0b"' : ''}>
    <div class="flex items-center gap-1" style="flex-wrap:wrap"><span class="trn-rank"${i ? ' style="background:#f59e0b"' : ''}>${i + 1}º</span> <span style="font-size:15px">${hb.ico}</span> <b>${esc(hb.nome)}</b></div>
    <div class="tiny" style="margin-top:4px">${evid}</div>
    ${it.vendas != null && it.vendas >= 0.05 ? `<div class="tiny" style="margin-top:2px;color:#16a34a">≈ +${fmt1(it.vendas)} ${it.vendas >= 2 ? 'vendas' : 'venda'} no período se chegar no nível da equipe${it.vgv ? ` (≈ R$ ${Math.round(it.vgv).toLocaleString('pt-BR')})` : ''}</div>` : ''}
    ${treinado ? `<div class="tiny" style="margin-top:2px;color:#0d9488">✔ Treinou isso em ${fmtData(treinado.data)} — acompanhe se a taxa sobe.</div>` : ''}
    <div class="flex items-center gap-2" style="margin-top:6px;flex-wrap:wrap">
      ${hb.trilha ? `<a class="tiny" href="#/academy">📚 ${esc(hb.trilha)} › ${esc(hb.modulo)}</a>` : ''}
      ${podeAgendar ? `<button class="btn btn-ghost btn-sm" data-tr-hab="${i}" style="margin-left:auto">🎓 Agendar treino individual</button>` : ''}
    </div>
  </div>`;
}

/* Bloco "Treinamentos & desenvolvimento" dentro do 1:1 de um corretor.
   gestor=true quando quem olha NÃO é o próprio corretor. */
export async function montarBlocoOO(host, { det, gestor }) {
  const c = det && det.corretor;
  if (!host || !c) return;
  host.innerHTML = '<div class="tiny muted"><span class="spinner"></span> Carregando treinamentos…</div>';
  let r;
  try { r = await api.request(API + '?user_id=' + encodeURIComponent(c.id)); }
  catch (e) { host.innerHTML = `<div class="card tiny muted">🎓 Treinamentos: ${esc(e.message)}</div>`; return; }
  if (r.pending) { host.innerHTML = ''; return; }
  const podeAgendar = !!(gestor && r.admin);
  const ts = r.treinos || [];
  const diag = diagnosticar(det);
  const ano = hoje().slice(0, 4);
  const byData = (a, b) => d10(a.data).localeCompare(d10(b.data));
  const prox = ts.filter(t => ['agendado', 'hoje'].includes(estado(t))).sort(byData);
  const real = ts.filter(t => t.status === 'realizado' && t.eu).sort((a, b) => byData(b, a));
  const presN = real.filter(t => presente(t.eu)).length;
  const horas = real.filter(t => d10(t.data).startsWith(ano) && presente(t.eu)).reduce((s, t) => s + cargaMin(t), 0);
  const faltasOb = real.filter(t => t.obrigatorio && t.eu.presenca === 'ausente').length;
  const nomeCurto = String(c.name || '').split(' ')[0];
  const equipe = EQUIPES.includes(equipeLbl(c.team)) ? equipeLbl(c.team) : '';
  const treinou = id => real.find(t => t.habilidade === id && presente(t.eu));
  const fonteTxt = diag.fonte === 'equipe' ? '· comparado com a equipe no período'
    : diag.fonte === 'funil' ? (diag.semEquipe
      ? '· maior perda do funil dele (a comparação com a equipe não vem nesta visão)'
      : '· maior perda do funil dele (a equipe ainda não tem volume no período pra comparar)') : '';
  host.innerHTML = `${CSS}
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <h3 class="card-title" style="margin:0">🎓 Treinamentos e desenvolvimento${gestor ? ' — ' + esc(nomeCurto) : ''}</h3>
        ${podeAgendar ? '<button class="btn btn-primary btn-sm" id="oo-tr-novo">+ Treino individual</button>' : ''}
      </div>
      <div class="trn-oo-grid">
        <div>
          <div class="trn-oo-sub">🎯 Habilidade prioritária <span class="tiny muted" style="font-weight:500">${fonteTxt}</span></div>
          ${diag.itens.length ? diag.itens.map((it, i) => itemDiag(it, i, podeAgendar, treinou(it.hab.id))).join('') : vazio('Sem gargalo claro no período — ou pouco volume pra comparar.')}
        </div>
        <div>
          <div class="trn-oo-sub">📚 Histórico de treino</div>
          <div class="trn-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:8px">
            ${kpi('👥', 'Presença', real.length ? Math.round(presN / real.length * 100) + '%' : '—', '#7c3aed')}
            ${kpi('⏱', 'Horas ' + ano, fmtHoras(horas), '#0d9488')}
            ${kpi('❗', 'Faltas obrig.', faltasOb, faltasOb ? '#dc2626' : '')}
          </div>
          ${prox.length ? `<div class="tiny muted" style="margin:6px 2px 4px;font-weight:800;letter-spacing:.06em">PRÓXIMOS</div>${prox.slice(0, 3).map(t => `<div class="trn-row" data-open="${esc(t.id)}"><div class="trn-row-d">${fmtData(t.data)}</div><div class="trn-t" style="flex:1;min-width:0;font-size:13px">${esc(t.titulo)}</div>${t.formato === 'individual' ? '<span class="trn-chip">👤 individual</span>' : ''}</div>`).join('')}` : ''}
          <div class="tiny muted" style="margin:8px 2px 4px;font-weight:800;letter-spacing:.06em">ÚLTIMOS</div>
          ${real.length ? real.slice(0, 5).map(linhaMinha).join('') : '<div class="tiny muted" style="padding:4px 2px">Nenhum treino realizado ainda.</div>'}
          <a class="tiny" href="#/rh-treinamentos" style="display:inline-block;margin-top:6px">Ver todos os treinamentos →</a>
        </div>
      </div>
    </div>`;
  host.querySelectorAll('[data-open]').forEach(el => { el.onclick = () => irPara(el.dataset.open); });
  const recarregar = () => montarBlocoOO(host, { det, gestor });
  const nv = host.querySelector('#oo-tr-novo');
  if (nv) nv.onclick = () => openTreinoEditor({ formato: 'individual', participantes: [c.id], equipe, titulo: `Treino individual · ${nomeCurto}`, origem: 'one-on-one' }, recarregar);
  host.querySelectorAll('[data-tr-hab]').forEach(b => {
    b.onclick = () => {
      const it = diag.itens[+b.dataset.trHab]; if (!it) return;
      const hb = it.hab;
      const evid = it.taxa != null ? `${it.etapa}: ${pctTxt(it.taxa)}${it.ref != null ? ` (${it.refLbl || 'média da equipe'} ${pctTxt(it.ref)})` : ''}` : `${it.etapa}: ${it.texto || ''}`;
      openTreinoEditor({
        formato: 'individual', participantes: [c.id], habilidade: hb.id, trilha: hb.trilha || '', modulo: hb.modulo || '', equipe,
        titulo: `${hb.nome} · ${nomeCurto}`, descricao: `Gargalo apontado no 1:1 — ${evid}.`, origem: 'one-on-one',
      }, recarregar);
    };
  });
}
