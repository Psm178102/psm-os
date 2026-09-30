/* PSM-OS v2 — 🎯 Rotina de Gestão · PSM Conquista (v88.33)
   A rotina da DIRETORA da Conquista (Isabella) com o GERENTE da equipe (Kaue), numa tela:
     1. Esta semana — as reuniões Isa × Kaue (e as da diretoria de que ela participa) dia a dia:
        ✓ ata registrada · ⚠ passou sem ata · ⏳ por vir. "Registrar ata" aqui mesmo.
     2. Tarefas recorrentes de cada um (dia/semana/quinzena/mês/trimestre) com check no período.
     3. Acompanhamento — Scorecard da Conquista, pendências abertas das reuniões e aderência.
     4. Funções e responsabilidades — mandato de cada um e quem decide o quê (RACI).
   Reuniões = formatos da rotina v2.3 (/api/v3/gp/reunioes_formatos: lembrete, ata, pendência);
   tarefas/aderência = /api/v3/diretoria/rotina; placar = /api/v3/diretoria/scorecard.
   v88.37: a MESMA tela serve a Rotina · PSM Imóveis (Paulo × equipe MAP) — pageRotinaImoveis
   passa unidade='imoveis'; papéis, tarefas, reuniões e placar vêm do backend.
   v89.17: a rotina deixou de ser engessada — sócio clica ✏️ Editar rotina e muda tarefas (texto,
   cadência, dono, porquê, tela), papéis/mandato e a matriz RACI; "Restaurar padrão" volta ao original. */
import { api } from '../api.js';

let _root = null;
let _r = null, _f = null, _sc = null;
let _ataAberta = null;
let _un = 'conquista';
let _ed = null;   // v89.17: rascunho da edição {tarefas, papeis, raci} — null = modo leitura
const qs = () => (_un === 'conquista' ? '' : `?unidade=${_un}`);
const primeiro = q => String(_r?.papeis?.[q]?.nome || q).split(/[ —]/)[0];

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex'];
const CAD = [
  { id: 'diario', lbl: 'Todo dia' }, { id: 'semanal', lbl: 'Toda semana' }, { id: 'quinzenal', lbl: 'A cada 15 dias' },
  { id: 'mensal', lbl: 'Todo mês' }, { id: 'trimestral', lbl: 'Todo trimestre' },
];
const COR = { verde: '#239a5b', amarelo: '#c7861a', vermelho: '#d64545', cinza: '#8a8579', info: '#806d50' };

export async function pageRotinaConquista(ctx, root) { return pageRotina(root, 'conquista'); }
export async function pageRotinaImoveis(ctx, root) { return pageRotina(root, 'imoveis'); }

async function pageRotina(root, unidade) {
  _root = root; _un = unidade; _sc = null; _ed = null;
  _root.innerHTML = '<div class="card"><div class="muted tiny"><span class="spinner"></span> Carregando a rotina…</div></div>';
  await load();
}

async function load() {
  try {
    const [r, f] = await Promise.all([api.request('/api/v3/diretoria/rotina' + qs()), api.request('/api/v3/gp/reunioes_formatos')]);
    _r = r; _f = f;
    render();
    // placar é mais pesado — chega depois sem travar a tela
    api.request('/api/v3/diretoria/scorecard').then(sc => { _sc = sc; const el = document.getElementById('rc-placar'); if (el) el.innerHTML = placarHTML(); }).catch(() => {
      const el = document.getElementById('rc-placar'); if (el) el.innerHTML = '<div class="tiny muted">Scorecard indisponível agora.</div>';
    });
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

/* ─── datas / cadência (mesma regra do lembrete em gp/reunioes_formatos) ─── */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/* v89.22 — feriado (nacional, SP, Rio Preto, Carnaval, Sexta Santa, Corpus Christi): a reunião vai pro próximo dia útil.
   Mesma regra de api/v3/_ritmo_lib.py (feriados/bate). */
function pascoa(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, g = Math.floor((8 * b + 13) / 25);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
  return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1, 12);
}
const _fer = {};
function feriados(y) {
  if (!_fer[y]) {
    const p = pascoa(y), mv = k => { const x = new Date(p); x.setDate(x.getDate() + k); return ymd(x); };
    _fer[y] = new Set([...['01-01', '03-19', '04-21', '05-01', '07-09', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(md => `${y}-${md}`),
      mv(-48), mv(-47), mv(-2), mv(60)]);
  }
  return _fer[y];
}
const diaUtil = d => d.getDay() !== 0 && d.getDay() !== 6 && !feriados(d.getFullYear()).has(ymd(d));
function bate(f, d) {   // v89.29: + "cede_para" (sai do dia em que a outra reunião acontece)
  if (!baseBate(f, d)) return false;
  const ced = f.cede_para || [];
  return !ced.length || !(_f?.formatos || []).some(g => ced.includes(g.id) && !(g.desde && ymd(d) < g.desde) && baseBate(g, d));
}
function baseBate(f, d) {
  if (!diaUtil(d)) return false;
  if (((f.excecoes || {})[ymd(d)] || {}).cancelada) return false;   // v89.25: cancelada só naquele dia
  if (bateBruto(f, d)) return true;
  if (f.feriado_pula) return false;   // v89.30: no feriado não muda de dia, só não acontece
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
  while (!diaUtil(x)) {
    if (x.getDay() !== 0 && x.getDay() !== 6 && bateBruto(f, x)) return true;
    x.setDate(x.getDate() - 1);
  }
  return false;
}
function bateBruto(f, d) {
  const c = f.cadencia || {}, wd = (d.getDay() + 6) % 7;
  if (c.tipo === 'semanal') return (c.dias || []).includes(wd) && !(c.pular_1a && d.getDate() <= 7);   // v89.21
  if (c.tipo === 'quinzenal') {
    if (wd !== c.dia || !c.ref) return false;
    const ref = new Date(c.ref + 'T12:00:00');
    return Math.floor((new Date(ymd(d) + 'T12:00:00') - ref) / 864e5 / 7) % 2 === 0;
  }
  if (c.tipo === 'mensal_nth') return wd === c.dia && Math.floor((d.getDate() - 1) / 7) + 1 === Number(c.nth || 1);
  if (c.tipo === 'mensal_ultima') return wd === c.dia && d.getDate() > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - 7;
  if (c.tipo === 'mensal_dias') return (c.dias_mes || []).some(n => {   // v89.20: 10/20/último; fim de semana → sexta
    const ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const x = new Date(d.getFullYear(), d.getMonth(), Math.min(+n, ult), 12);
    while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() - 1);
    return ymd(x) === ymd(d);
  });
  return false;
}
const dataBRT = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });   // AAAA-MM-DD

/* ─── render ─────────────────────────────────────────────────────────── */
function render() {
  const r = _r;
  const [qa, qb] = r.quens || ['isa', 'kaue'];
  const a = r.aderencia;
  const pend = pendencias();
  const venc = pend.filter(p => p.prazo && p.prazo < r.hoje).length;
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <h2 class="card-title">${_un === 'imoveis' ? '🏠' : '🎯'} Rotina de Gestão · ${esc(r.titulo || 'PSM Conquista')}</h2>
        ${r.eu?.socio && !_ed ? `<button class="btn btn-ghost btn-sm" id="rc-editar">✏️ Editar rotina</button>` : ''}</div>
      <p class="card-sub"><b>${esc(r.papeis[qa].nome)}</b> — ${esc(r.papeis[qa].cargo)} × <b>${esc(r.papeis[qb].nome)}</b> — ${esc(r.papeis[qb].cargo)}.</p>
      <div class="tiny" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px;margin-top:6px">
        <div><b>1.</b> Fez a tarefa? <b>Marque ✓</b> na sua lista abaixo.</div>
        <div><b>2.</b> Teve reunião? <b>Registre a ata</b> no quadro da semana.</div>
        <div><b>3.</b> Combinou algo? Vira <b>pendência</b> com dono e prazo.</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px" class="mt-2">
        ${tile('Rotina cumprida · semana', pct(a.semana.pct), `${esc(primeiro(qa))} ${pct(a.semana[qa])} · ${esc(primeiro(qb))} ${pct(a.semana[qb])}`, corPct(a.semana.pct))}
        ${tile('Rotina cumprida · mês', pct(a.mes.pct), `${a.mes.feito}/${a.mes.esperado} tarefas`, corPct(a.mes.pct))}
        ${tile('Combinados em aberto', pend.length, venc ? `${venc} vencida(s)` : 'nenhuma vencida', venc ? COR.vermelho : pend.length ? COR.amarelo : COR.verde)}
        ${tile('Reuniões da semana', semanaStats().feitas + '/' + semanaStats().previstas, 'com ata registrada', corPct(semanaStats().previstas ? semanaStats().feitas / semanaStats().previstas * 100 : null))}
      </div>
      ${trilhaHTML()}
    </div>
    ${_ed ? editorHTML() : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px" class="mt-3">
      ${tarefasHTML(qa)}
      ${tarefasHTML(qb)}
    </div>`}
    ${semanaHTML()}
    <div id="rc-ata"></div>
    ${pendenciasHTML(pend)}
    <div class="card mt-3"><div style="font-weight:600">📊 Placar da unidade — Farol ${esc(r.titulo || 'PSM Conquista')}</div>
      <div id="rc-placar" class="mt-2">${_sc ? placarHTML() : '<div class="tiny muted"><span class="spinner"></span> Carregando o placar…</div>'}</div></div>
    ${_ed ? '' : funcoesHTML()}`;
  bind();
  if (_ed) bindEditor();
}

function tile(lbl, val, sub, cor) {
  return `<div style="background:var(--bg-3);border-radius:var(--radius-md);padding:10px;border-top:3px solid ${cor || COR.cinza}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">${lbl}</div>
    <div style="font-size:20px;font-weight:600;color:${cor || 'inherit'}">${val}</div><div class="tiny muted">${sub}</div></div>`;
}
const pct = v => v == null ? '—' : v + '%';
const corPct = v => v == null ? COR.cinza : v >= 80 ? COR.verde : v >= 50 ? COR.amarelo : COR.vermelho;

function trilhaHTML() {
  const s = _r.semanas || [];
  if (!s.length) return '';
  return `<div class="tiny muted mt-2">Rotina cumprida nas últimas 8 semanas (vale desde ${_r.inicio ? _r.inicio.split('-').reverse().join('/') : '—'}):</div>
    <div class="flex gap-1" style="align-items:flex-end;height:46px;margin-top:4px">
      ${s.map(w => `<div title="semana de ${w.semana.split('-').reverse().slice(0, 2).join('/')}: ${pct(w.pct)}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="width:100%;max-width:38px;height:${w.pct == null ? 3 : Math.max(3, w.pct * 0.34)}px;background:${w.pct == null ? 'var(--bg-3)' : corPct(w.pct)};border-radius:3px 3px 0 0"></div>
        <div class="tiny muted" style="font-size:11px">${w.semana.split('-').reverse().slice(0, 2).join('/')}</div></div>`).join('')}
    </div>`;
}

/* ─── semana ─────────────────────────────────────────────────────────── */
function formatosRotina() {
  const ids = _r.formatos || [];
  return (_f.formatos || []).filter(f => ids.includes(f.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}
function diasSemana() {
  const h = new Date(_r.hoje + 'T12:00:00'), seg = new Date(h); seg.setDate(h.getDate() - ((h.getDay() + 6) % 7));
  return DIAS.map((_, i) => { const d = new Date(seg); d.setDate(seg.getDate() + i); return d; });
}
function ataDe(fid, d) { return (_f.atas || []).find(a => a.formato_id === fid && (a.data || dataBRT(a.ts)) === ymd(d)); }
function semanaStats() {
  let previstas = 0, feitas = 0;
  for (const f of formatosRotina()) for (const d of diasSemana()) {
    if (f.sem_ata || !bate(f, d) || ymd(d) > _r.hoje || (f.desde && ymd(d) < f.desde)) continue;   // v89.27
    previstas++; if (ataDe(f.id, d)) feitas++;
  }
  return { previstas, feitas };
}
function semanaHTML() {
  const dias = diasSemana();
  const fs = formatosRotina();
  return `<div class="card mt-3">
    <div style="font-weight:600">📅 Esta semana — reuniões</div>
    <div class="tiny muted">${_un === 'imoveis' ? 'A Semanal MAP + as reuniões da diretoria/equipe de que a unidade participa' : 'As 5 reuniões Isa × Kaue + as da diretoria/equipe de que ela participa'}. Lembrete automático 30 min antes; sem ata, o rito não aconteceu.</div>
    <div style="overflow-x:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
      <thead><tr class="tiny muted"><th style="text-align:left;padding:4px 6px">Reunião</th>
        ${dias.map(d => `<th style="padding:4px;text-align:center;${ymd(d) === _r.hoje ? 'color:var(--psm-navy);font-weight:600' : ''}">${DIAS[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}</th>`).join('')}</tr></thead>
      <tbody>${fs.map(f => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:6px"><div style="font-weight:600">${esc(f.emoji || '📋')} ${esc(f.nome)}</div>
          <div class="tiny muted">${esc(f.hora || '')} · ${f.dur_min || '?'} min · dono ${esc(f.dono || '—')} · <a href="${esc(f.painel || '#/')}">${esc(f.painel_nome || 'painel')}</a></div></td>
        ${dias.map(d => celula(f, d)).join('')}</tr>`).join('')}</tbody>
    </table></div></div>`;
}
function celula(f, d) {
  if (!bate(f, d) || (f.desde && ymd(d) < f.desde)) return '<td style="padding:4px;text-align:center" class="muted">·</td>';
  const dia = ymd(d), ata = ataDe(f.id, d);
  let ico, cor, tit;
  if (ata) { ico = '✓'; cor = COR.verde; tit = 'ata registrada'; }
  else if (dia < _r.hoje) { ico = '⚠'; cor = COR.vermelho; tit = 'passou sem ata'; }
  else if (dia === _r.hoje) { ico = '●'; cor = COR.amarelo; tit = 'hoje'; }
  else { ico = '⏳'; cor = COR.cinza; tit = 'por vir'; }
  if (f.sem_ata && !ata) { ico = dia < _r.hoje ? '•' : ico; cor = dia < _r.hoje ? COR.cinza : cor; tit = 'bloco de trabalho (sem ata)'; }
  const pode = _f.pode_ata && !ata && dia <= _r.hoje && !f.sem_ata;
  return `<td style="padding:3px;text-align:center"><div title="${tit}" style="border-radius:var(--radius-sm);padding:4px 0;background:${cor}1f;color:${cor};font-weight:600">${ico}
    ${pode ? `<div><a href="javascript:void 0" class="tiny" data-ata="${esc(f.id)}" data-dia="${dia}">registrar ata</a></div>` : ''}</div></td>`;
}

function ataForm(fid, dia) {
  const f = (_f.formatos || []).find(x => x.id === fid) || {};
  const el = document.getElementById('rc-ata');
  _ataAberta = { fid, pend: [{ txt: '', dono: primeiro((_r.quens || [])[1] || 'kaue'), prazo: '' }] };
  el.innerHTML = `<div class="card mt-3" style="border:2px solid var(--psm-navy)">
    <div class="flex" style="justify-content:space-between"><div style="font-weight:600">📝 Ata — ${esc(f.emoji || '')} ${esc(f.nome || fid)} · ${dia.split('-').reverse().join('/')}</div>
      <button class="btn btn-ghost btn-sm" id="rc-ata-x">✕</button></div>
    <div class="tiny muted mb-2">Pauta: ${(f.pauta || []).map(esc).join(' · ')}</div>
    <label class="tiny muted">Decisões (3 linhas bastam)</label>
    <textarea id="rc-ata-dec" class="input" rows="3" placeholder="O que foi decidido"></textarea>
    <div class="tiny muted mt-2" style="font-weight:600">Pendências — sem dono e prazo, não existe</div>
    <div id="rc-ata-pend"></div>
    <div class="flex gap-1 mt-2"><button class="btn btn-ghost btn-sm" id="rc-ata-add">➕ pendência</button>
      <button class="btn btn-primary" id="rc-ata-ok" style="margin-left:auto">💾 Salvar ata</button></div>
  </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const desenha = () => {
    document.getElementById('rc-ata-pend').innerHTML = _ataAberta.pend.map((p, i) => `<div class="flex gap-1 mt-1" style="flex-wrap:wrap">
      <input class="input" style="flex:3;min-width:180px" placeholder="O quê" data-p="txt" data-i="${i}" value="${esc(p.txt)}">
      <input class="input" style="flex:1;min-width:90px" placeholder="Dono" data-p="dono" data-i="${i}" value="${esc(p.dono)}">
      <input class="input" style="flex:1;min-width:120px" type="date" data-p="prazo" data-i="${i}" value="${esc(p.prazo)}"></div>`).join('');
    document.querySelectorAll('#rc-ata-pend [data-p]').forEach(inp => inp.addEventListener('input', () => { _ataAberta.pend[+inp.dataset.i][inp.dataset.p] = inp.value; }));
  };
  desenha();
  document.getElementById('rc-ata-x').onclick = () => { el.innerHTML = ''; };
  document.getElementById('rc-ata-add').onclick = () => { _ataAberta.pend.push({ txt: '', dono: '', prazo: '' }); desenha(); };
  document.getElementById('rc-ata-ok').onclick = async () => {
    const pendencias = _ataAberta.pend.filter(p => p.txt.trim());
    try {
      await api.request('/api/v3/gp/reunioes_formatos', { method: 'POST', body: { action: 'ata', formato_id: fid, data: dia, decisoes: document.getElementById('rc-ata-dec').value, pendencias } });
      el.innerHTML = ''; await load();
    } catch (e) { alert('Erro: ' + e.message); }
  };
}

/* ─── tarefas ────────────────────────────────────────────────────────── */
function tarefasHTML(quem) {
  const p = _r.papeis[quem];
  const ts = _r.tarefas.filter(t => t.quem === quem);
  const a = _r.aderencia.semana[quem];
  return `<div class="card" style="border-top:4px solid ${quem === (_r.quens || ['isa'])[0] ? 'var(--psm-gold,var(--accent-ink))' : 'var(--psm-navy,var(--accent-ink))'}">
    <div class="flex" style="justify-content:space-between;align-items:center"><div style="font-weight:600">✅ Tarefas — ${esc(p.nome)}</div>
      <span class="tiny" style="font-weight:600;color:${corPct(a)}">semana ${pct(a)}</span></div>
    <div class="tiny muted">${esc(p.cargo)}</div>
    ${CAD.map(c => {
      const g = ts.filter(t => t.cad === c.id);
      if (!g.length) return '';
      return `<div class="tiny" style="font-weight:600;letter-spacing:1px;text-transform:uppercase;opacity:.55;margin-top:10px">${c.lbl}</div>
        ${g.map(t => `<label class="flex gap-2" style="align-items:flex-start;padding:5px 0;border-top:1px dashed var(--border);cursor:${t.pode ? 'pointer' : 'default'}">
          <input type="checkbox" data-t="${t.id}" ${t.feito ? 'checked' : ''} ${t.pode ? '' : 'disabled'} style="margin-top:3px">
          <span style="flex:1;font-size:13px;${t.feito ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.txt)}
            ${t.porque ? `<span class="tiny muted"> — ${esc(t.porque)}</span>` : ''}
            ${t.feito ? `<span class="tiny muted"> · ✓ ${esc(t.feito.por || '')} ${new Date(t.feito.ts).toLocaleDateString('pt-BR')}</span>` : ''}</span>
          ${t.link ? `<a href="${esc(t.link)}" class="tiny" title="abrir a tela">abrir →</a>` : ''}
        </label>`).join('')}`;
    }).join('')}
  </div>`;
}

/* ─── placar / pendências / funções ──────────────────────────────────── */
function placarHTML() {
  const sc = (_sc?.scorecards || []).find(s => s.id === (_r.scorecard || 'un_conquista'));
  if (!sc) return `<div class="tiny muted">Placar da ${esc(_r.titulo || 'unidade')} não disponível para este usuário.</div>`;
  const fmt = (v, un) => v == null ? '—' : un === 'R$' ? 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : un === '%' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%' : v.toLocaleString('pt-BR');
  return `<div class="tiny muted">Mês em andamento: ${_sc.ritmo}% decorrido · dono do placar: ${esc(sc.dono_nome)} · <a href="#/scorecard">abrir Farol PSM →</a></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;margin-top:6px">
    ${sc.indicadores.map(i => `<div style="background:var(--bg-3);border-radius:var(--radius-md);padding:8px;border-left:3px solid ${COR[i.farol] || COR.cinza}">
      <div class="tiny muted">${esc(i.label)}</div><div style="font-weight:600">${fmt(i.valor, i.un)}</div>
      <div class="tiny" style="color:${COR[i.farol] || COR.cinza}">${i.meta != null ? 'meta ' + fmt(i.meta, i.un) + (i.pct != null ? ' · ' + i.pct + '%' : '') : 'sem meta'}</div></div>`).join('')}
  </div>`;
}

function pendencias() {
  const ids = _r.formatos || [];
  return (_f.pendencias_abertas || []).filter(p => ids.includes(p.formato_id));
}
function pendenciasHTML(pend) {
  const nome = id => ((_f.formatos || []).find(f => f.id === id) || {}).nome || id;
  return `<div class="card mt-3"><div style="font-weight:600">📌 Combinados em aberto das reuniões (${pend.length})</div>
    ${pend.length ? pend.sort((a, b) => String(a.prazo).localeCompare(String(b.prazo))).map(p => `<div class="flex gap-2" style="align-items:center;padding:5px 0;border-top:1px dashed var(--border);font-size:13px;flex-wrap:wrap">
      <span style="flex:1;min-width:200px">${esc(p.txt)}<div class="tiny muted">${esc(nome(p.formato_id))}</div></span>
      <span class="tiny">👤 ${esc(p.dono)}</span>
      <span class="tiny" style="color:${p.prazo < _r.hoje ? COR.vermelho : 'inherit'};font-weight:600">${p.prazo < _r.hoje ? '⚠ ' : ''}${String(p.prazo).split('-').reverse().join('/')}</span>
      ${_f.pode_ata ? `<button class="btn btn-ghost btn-sm" data-baixa="${esc(p.ata_id)}" data-idx="${p.idx}">✓ feito</button>` : ''}
    </div>`).join('') : '<div class="tiny muted mt-1">Nenhuma — toda pendência sai de uma ata, com dono e prazo.</div>'}
  </div>`;
}

function funcoesHTML() {
  const p = _r.papeis;
  const [qa, qb] = _r.quens || ['isa', 'kaue'];
  const COL = { R: ['Executa', COR.info], A: ['Aprova / responde', COR.verde], C: ['Consultado', COR.amarelo], I: ['Informado', COR.cinza] };
  const tag = v => !COL[v] ? '<span class="muted">—</span>' : `<span title="${COL[v][0]}" style="display:inline-block;min-width:26px;text-align:center;font-weight:600;border-radius:var(--radius-sm);padding:2px 6px;background:${COL[v][1]}22;color:${COL[v][1]}">${v}</span>`;
  const mand = q => `<div><div style="font-weight:600">${esc(p[q].nome)}</div><div class="tiny muted">${esc(p[q].cargo)}</div>
    <ul style="margin:6px 0 0 18px;font-size:13px;line-height:1.6">${(p[q].mandato || []).map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  return `<details class="card mt-3"><summary style="font-weight:600;cursor:pointer">🧭 Funções e responsabilidades <span class="tiny muted" style="font-weight:400">— quem faz e quem decide o quê (clique para abrir)</span></summary>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:8px">${mand(qa)}${mand(qb)}</div>
    <div style="font-weight:600;margin-top:14px">Quem decide o quê</div>
    <div class="tiny muted">R = executa · A = aprova e responde pelo resultado · C = é consultado antes · I = é informado depois</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;min-width:420px">
      <thead><tr class="tiny muted"><th style="text-align:left;padding:4px 6px">Assunto</th><th style="padding:4px">${esc(primeiro(qa))}</th><th style="padding:4px">${esc(qb === 'map' ? 'Equipe MAP' : primeiro(qb))}</th></tr></thead>
      <tbody>${_r.raci.map(x => `<tr style="border-top:1px solid var(--border)"><td style="padding:5px 6px">${esc(x.assunto)}</td><td style="text-align:center">${tag(x[qa])}</td><td style="text-align:center">${tag(x[qb])}</td></tr>`).join('')}</tbody>
    </table></div></details>`;
}

/* ─── v89.17 · edição da rotina (só sócio) ───────────────────────────── */
function abrirEditor() {
  const [qa, qb] = _r.quens;
  _ed = {
    tarefas: _r.tarefas.map(t => ({ id: t.id, quem: t.quem, cad: t.cad, txt: t.txt, porque: t.porque || '', link: t.link || '' })),
    papeis: Object.fromEntries([qa, qb].map(q => [q, { nome: _r.papeis[q].nome, cargo: _r.papeis[q].cargo || '', mandato: [...(_r.papeis[q].mandato || [])] }])),
    raci: _r.raci.map(x => ({ assunto: x.assunto, [qa]: x[qa] || '', [qb]: x[qb] || '' })),
    formatos: [...(_r.formatos || [])],
  };
  render();
  document.getElementById('rc-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const primeiroEd = q => String(_ed?.papeis?.[q]?.nome || _r.papeis?.[q]?.nome || q).split(/[ —]/)[0];

function editorHTML() {
  const [qa, qb] = _r.quens;
  const opt = (v, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>`;
  const cadSel = (i, cur) => `<select class="input" data-e="cad" data-i="${i}" style="flex:0 0 150px">${CAD.map(c => `${opt(c.id, cur)}${c.lbl}</option>`).join('')}</select>`;
  const quemSel = (i, cur) => `<select class="input" data-e="quem" data-i="${i}" style="flex:0 0 150px" title="de quem é a tarefa">${[qa, qb].map(q => `${opt(q, cur)}${esc(primeiroEd(q))}</option>`).join('')}</select>`;
  const racSel = (i, q, cur) => `<select class="input" data-r="${q}" data-i="${i}" style="width:64px">${['', 'R', 'A', 'C', 'I'].map(v => `${opt(v, cur)}${v || '—'}</option>`).join('')}</select>`;
  const tarefas = q => `<div class="mt-3"><div style="font-weight:600">✅ Tarefas — ${esc(_ed.papeis[q].nome)}</div>
    ${_ed.tarefas.map((t, i) => t.quem !== q ? '' : `<div style="border-top:1px dashed var(--border);padding:6px 0">
      <div class="flex gap-1" style="flex-wrap:wrap">
        <input class="input" style="flex:3;min-width:220px" data-e="txt" data-i="${i}" value="${esc(t.txt)}" placeholder="O que fazer">
        ${cadSel(i, t.cad)} ${quemSel(i, t.quem)}
        <button class="btn btn-ghost btn-sm" data-del="${i}" title="remover tarefa">🗑</button></div>
      <div class="flex gap-1 mt-1" style="flex-wrap:wrap">
        <input class="input tiny" style="flex:2;min-width:180px" data-e="porque" data-i="${i}" value="${esc(t.porque)}" placeholder="Por quê (opcional)">
        <input class="input tiny" style="flex:1;min-width:140px" data-e="link" data-i="${i}" value="${esc(t.link)}" placeholder="Tela, ex. #/scorecard (opcional)"></div>
    </div>`).join('')}
    <button class="btn btn-ghost btn-sm mt-1" data-add="${q}">➕ tarefa de ${esc(primeiroEd(q))}</button></div>`;
  const papel = q => `<div><input class="input" data-pn="${q}" value="${esc(_ed.papeis[q].nome)}" placeholder="Nome">
    <input class="input mt-1" data-pc="${q}" value="${esc(_ed.papeis[q].cargo)}" placeholder="Cargo">
    <label class="tiny muted mt-1" style="display:block">Mandato — uma responsabilidade por linha</label>
    <textarea class="input" data-pm="${q}" rows="6">${esc(_ed.papeis[q].mandato.join('\n'))}</textarea></div>`;
  return `<div class="card mt-3" id="rc-editor" style="border:2px solid var(--psm-navy,var(--accent-ink))">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
      <div style="font-weight:600">✏️ Editando a rotina · ${esc(_r.titulo)}</div>
      <div class="flex gap-1">
        ${_r.editada ? '<button class="btn btn-ghost btn-sm" id="rc-ed-rest">↺ Restaurar padrão</button>' : ''}
        <button class="btn btn-ghost btn-sm" id="rc-ed-x">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="rc-ed-ok">💾 Salvar rotina</button></div></div>
    <div class="tiny muted">Os checks já marcados continuam valendo. Remover uma tarefa tira ela da aderência daqui pra frente.
      ${_r.editada && _r.config_por ? `Última edição: ${esc(_r.config_por)} em ${new Date(_r.config_ts).toLocaleString('pt-BR')}.` : ''}
      Horário e pauta das reuniões se mudam na aba <a href="#/reunioes?tab=agenda">📅 Agenda de reuniões</a>.</div>
    ${tarefas(qa)}${tarefas(qb)}
    <div style="font-weight:600;margin-top:16px">📅 Reuniões desta rotina</div>
    <div class="tiny muted">Marque as reuniões que aparecem no quadro "Esta semana".</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px;margin-top:6px">
      ${(_f.formatos || []).map(f => `<label class="tiny flex gap-1" style="align-items:center"><input type="checkbox" data-fmt="${esc(f.id)}" ${_ed.formatos.includes(f.id) ? 'checked' : ''}> ${esc(f.emoji || '📋')} ${esc(f.nome)}</label>`).join('')}
    </div>
    <div style="font-weight:600;margin-top:16px">🧭 Funções e responsabilidades</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:6px">${papel(qa)}${papel(qb)}</div>
    <div style="font-weight:600;margin-top:16px">Quem decide o quê (RACI)</div>
    <div class="tiny muted">R = executa · A = aprova e responde · C = consultado · I = informado</div>
    ${_ed.raci.map((x, i) => `<div class="flex gap-1 mt-1" style="align-items:center">
      <input class="input" style="flex:1" data-r="assunto" data-i="${i}" value="${esc(x.assunto)}" placeholder="Assunto">
      <span class="tiny muted">${esc(primeiroEd(qa))}</span>${racSel(i, qa, x[qa])}
      <span class="tiny muted">${esc(primeiroEd(qb))}</span>${racSel(i, qb, x[qb])}
      <button class="btn btn-ghost btn-sm" data-rdel="${i}" title="remover linha">🗑</button></div>`).join('')}
    <button class="btn btn-ghost btn-sm mt-1" id="rc-ed-radd">➕ linha na RACI</button>
  </div>`;
}

function bindEditor() {
  const ed = document.getElementById('rc-editor');
  ed.querySelectorAll('[data-e]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    _ed.tarefas[+el.dataset.i][el.dataset.e] = el.value;
    if (el.dataset.e === 'quem') render();
  }));
  ed.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const t = _ed.tarefas[+b.dataset.del];
    if (t.txt.trim() && !confirm(`Remover a tarefa "${t.txt}"?`)) return;
    _ed.tarefas.splice(+b.dataset.del, 1); render();
  }));
  ed.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.add;
    _ed.tarefas.push({ id: `${q[0]}_${Date.now().toString(36)}`, quem: q, cad: 'semanal', txt: '', porque: '', link: '' });
    render();
    const ins = document.querySelectorAll('#rc-editor [data-e="txt"]');
    const alvo = [...ins].find(x => _ed.tarefas[+x.dataset.i].txt === '' && _ed.tarefas[+x.dataset.i].quem === q);
    alvo?.focus();
  }));
  ed.querySelectorAll('[data-pn]').forEach(el => el.addEventListener('input', () => { _ed.papeis[el.dataset.pn].nome = el.value; }));
  ed.querySelectorAll('[data-pc]').forEach(el => el.addEventListener('input', () => { _ed.papeis[el.dataset.pc].cargo = el.value; }));
  ed.querySelectorAll('[data-pm]').forEach(el => el.addEventListener('input', () => { _ed.papeis[el.dataset.pm].mandato = el.value.split('\n'); }));
  ed.querySelectorAll('[data-r]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { _ed.raci[+el.dataset.i][el.dataset.r] = el.value; }));
  ed.querySelectorAll('[data-fmt]').forEach(el => el.addEventListener('change', () => {
    _ed.formatos = _ed.formatos.filter(x => x !== el.dataset.fmt);
    if (el.checked) _ed.formatos.push(el.dataset.fmt);
  }));
  ed.querySelectorAll('[data-rdel]').forEach(b => b.addEventListener('click', () => { _ed.raci.splice(+b.dataset.rdel, 1); render(); }));
  document.getElementById('rc-ed-radd').onclick = () => { const [qa, qb] = _r.quens; _ed.raci.push({ assunto: '', [qa]: '', [qb]: '' }); render(); };
  document.getElementById('rc-ed-x').onclick = () => { _ed = null; render(); };
  const rest = document.getElementById('rc-ed-rest');
  if (rest) rest.onclick = async () => {
    if (!confirm('Voltar a rotina ao padrão original? As edições somem (os checks continuam).')) return;
    try { await api.request('/api/v3/diretoria/rotina', { method: 'POST', body: { action: 'restaurar', unidade: _un } }); _ed = null; await load(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  document.getElementById('rc-ed-ok').onclick = async ev => {
    const tarefas = _ed.tarefas.filter(t => t.txt.trim());
    if (!tarefas.length) return alert('A rotina precisa de pelo menos uma tarefa.');
    const papeis = Object.fromEntries(Object.entries(_ed.papeis).map(([q, p]) => [q, { ...p, mandato: p.mandato.map(m => m.trim()).filter(Boolean) }]));
    const raci = _ed.raci.filter(x => x.assunto.trim());
    ev.target.disabled = true;
    try {
      await api.request('/api/v3/diretoria/rotina', { method: 'POST', body: { action: 'config', unidade: _un, tarefas, papeis, raci, formatos: _ed.formatos } });
      _ed = null; await load();
    } catch (e) { alert('Erro: ' + e.message); ev.target.disabled = false; }
  };
}


/* ─── eventos ────────────────────────────────────────────────────────── */
function bind() {
  document.getElementById('rc-editar')?.addEventListener('click', abrirEditor);
  _root.querySelectorAll('[data-t]').forEach(cb => cb.addEventListener('change', async () => {
    cb.disabled = true;
    try { await api.request('/api/v3/diretoria/rotina', { method: 'POST', body: { action: 'check', unidade: _un, item: cb.dataset.t, feito: cb.checked } }); await load(); }
    catch (e) { alert('Erro: ' + e.message); cb.checked = !cb.checked; cb.disabled = false; }
  }));
  _root.querySelectorAll('[data-ata]').forEach(a => a.addEventListener('click', () => ataForm(a.dataset.ata, a.dataset.dia)));
  _root.querySelectorAll('[data-baixa]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api.request('/api/v3/gp/reunioes_formatos', { method: 'POST', body: { action: 'baixar_pendencia', ata_id: b.dataset.baixa, idx: +b.dataset.idx } }); await load(); }
    catch (e) { alert('Erro: ' + e.message); b.disabled = false; }
  }));
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
