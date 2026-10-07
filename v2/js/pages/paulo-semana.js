/* PSM-OS v2 — 🧭 Minha semana (só o Paulo) — v89.40
   A agenda real do Paulo, de hora em hora (08h–20h), separada por papel:
     🟧 laranja = gestor, com a equipe MAP · 🟦 azul = CEO e sócio · 🟨 amarelo = corretor (carteira, visita, proposta)
   Lê os compromissos de /api/v3/agenda/list (os ritos da Agenda, os 1:1 e o que veio do Zoho),
   então acompanha feriado, exceção e remarcação sozinha. Tela de uso pessoal: nada daqui
   aparece para o time. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAPEIS = {
  gestor: { nome: 'Gestor · com a equipe MAP', bg: '#fde0c2', ink: '#8a3f00', bd: '#f0a860' },
  ceo: { nome: 'CEO e sócio', bg: '#d9e8fb', ink: '#0c447c', bd: '#8fb8ea' },
  corretor: { nome: 'Corretor · carteira, visita e proposta', bg: '#fff1a8', ink: '#5e4a00', bd: '#e3c94a' },
};
const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const segDe = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const mais = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mins = s => { const [h, m] = String(s || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hm = s => String(s || '').slice(0, 5);

/* de que papel é o compromisso */
export function papelDe(ev) {
  const id = String(ev.id || ''), t = String(ev.titulo || '').toLowerCase(), tipo = String(ev.tipo || '').toLowerCase();
  if (id.startsWith('rito_carteira_paulo') || /visita|proposta|negocia|carteira paulo|capta[cç]/.test(t) || ['visita', 'proposta', 'atendimento'].includes(tipo)) return 'corretor';
  if (id.startsWith('rito_map_') || id.startsWith('rito_ceo_preparo_map') || id.startsWith('evoo_') || /\bmap\b|1:1|one on one/.test(t)) return 'gestor';
  return 'ceo';
}

let _root = null, _seg = segDe(new Date()), _evs = [];

export async function pagePauloSemana(ctx, root) {
  _root = root;
  if (auth.user()?.id !== 'paulo') { root.innerHTML = '<div class="card"><div class="muted">Esta tela é de uso pessoal do Paulo.</div></div>'; return; }
  await load();
}

async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando a sua semana…</div></div>';
  try {
    const r = await api.request(`/api/v3/agenda/list?since=${ymd(_seg)}&until=${ymd(mais(_seg, 5))}`);
    _evs = (r.eventos || r.events || r.items || []).filter(e => (e.status || '') !== 'cancelado');
  } catch (e) { _root.innerHTML = `<div class="alert alert-err">Não consegui carregar a agenda: ${esc(e.message)}</div>`; return; }
  render();
}

function render() {
  const hoje = ymd(new Date());
  const porDia = DIAS.map((_, i) => { const k = ymd(mais(_seg, i)); return _evs.filter(e => String(e.data).slice(0, 10) === k); });
  const tot = { gestor: 0, ceo: 0, corretor: 0 };
  porDia.flat().forEach(e => { if (e.hora_inicio && e.hora_fim && !e.all_day) tot[papelDe(e)] += Math.max(0, mins(e.hora_fim) - mins(e.hora_inicio)); });
  const horas = v => { const h = Math.floor(v / 60), m = v % 60; return v ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : '–'; };
  const chip = (e, h) => {
    const p = PAPEIS[papelDe(e)], a = mins(e.hora_inicio), b = mins(e.hora_fim);
    const comeca = a >= h * 60, termina = b <= h * 60 + 60;
    const quebra = [comeca && a % 60 ? hm(e.hora_inicio) : '', termina && b % 60 ? 'até ' + hm(e.hora_fim) : ''].filter(Boolean).join(' · ');
    return `<div title="${esc(e.titulo)} · ${hm(e.hora_inicio)}–${hm(e.hora_fim)}" style="background:${p.bg};color:${p.ink};border:1px solid ${p.bd};border-radius:4px;padding:2px 6px;font-size:11.5px;line-height:1.25;font-weight:${comeca ? 700 : 500};${comeca ? '' : 'opacity:.75;'}overflow:hidden">
      ${quebra ? `<span style="font-size:10px;font-weight:600">${quebra}</span> ` : ''}${esc(e.titulo)}</div>`;
  };
  const cab = DIAS.map((n, i) => { const d = mais(_seg, i), k = ymd(d);
    return `<th style="text-align:left;padding:6px 8px;font-size:12px;background:${k === hoje ? 'var(--accent)' : 'var(--bg-3)'};color:${k === hoje ? 'var(--on-accent)' : 'inherit'}">${n} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}</th>`; }).join('');
  let corpo = '';
  for (let h = 8; h < 20; h++) {
    corpo += `<tr><td class="tiny muted" style="text-align:right;padding:4px 6px;font-weight:700;vertical-align:top;width:40px">${String(h).padStart(2, '0')}h</td>` +
      porDia.map(evs => { const aqui = evs.filter(e => e.hora_inicio && e.hora_fim && !e.all_day && mins(e.hora_inicio) < h * 60 + 60 && mins(e.hora_fim) > h * 60).sort((a, b) => mins(a.hora_inicio) - mins(b.hora_inicio));
        return `<td style="border:1px solid var(--border);padding:3px;height:46px;vertical-align:top"><div style="display:grid;gap:2px">${aqui.map(e => chip(e, h)).join('')}</div></td>`; }).join('') + '</tr>';
  }
  const soltos = porDia.map(evs => evs.filter(e => !e.hora_inicio || !e.hora_fim || e.all_day));
  const linhaSoltos = soltos.some(x => x.length) ? `<tr><td class="tiny muted" style="text-align:right;padding:4px 6px;font-weight:700;vertical-align:top">sem hora</td>${soltos.map(evs =>
    `<td style="border:1px solid var(--border);padding:3px;vertical-align:top"><div style="display:grid;gap:2px">${evs.map(e => `<div class="tiny" style="border:1px dashed var(--border-2,var(--border));border-radius:4px;padding:2px 6px">${esc(e.titulo)}</div>`).join('')}</div></td>`).join('')}</tr>` : '';
  _root.innerHTML = `<div class="card">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div><h2 class="card-title" style="margin:0">🧭 Minha semana</h2>
        <p class="card-sub" style="margin:2px 0 0">A sua agenda de hora em hora, separada por papel. Só você vê esta tela.</p></div>
      <div class="flex gap-1" style="align-items:center">
        <button class="btn btn-ghost btn-sm" id="ps-ant">◀</button><button class="btn btn-ghost btn-sm" id="ps-hoje">Esta semana</button><button class="btn btn-ghost btn-sm" id="ps-prox">▶</button>
        <button class="btn btn-ghost btn-sm" id="ps-print">🖨 Imprimir</button></div></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:10px 0;font-size:13px">
      ${Object.entries(PAPEIS).map(([k, p]) => `<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:14px;height:14px;border-radius:3px;background:${p.bg};border:1px solid ${p.bd};display:inline-block"></i><b>${p.nome}</b> · ${horas(tot[k])}</span>`).join('')}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:860px;table-layout:fixed">
      <thead><tr><th style="width:44px"></th>${cab}</tr></thead><tbody>${corpo}${linhaSoltos}</tbody></table></div>
    <div class="tiny muted mt-2">Visita, negociação e proposta passam na frente de qualquer bloco. Sempre. · Faixa em branco é hora livre. · Os horários vêm da <a href="#/reunioes?tab=agenda">Agenda de reuniões</a> e do seu calendário.</div>
  </div>`;
  const $ = id => _root.querySelector('#' + id);
  $('ps-ant').onclick = () => { _seg = mais(_seg, -7); load(); };
  $('ps-prox').onclick = () => { _seg = mais(_seg, 7); load(); };
  $('ps-hoje').onclick = () => { _seg = segDe(new Date()); load(); };
  $('ps-print').onclick = () => window.print();
}
