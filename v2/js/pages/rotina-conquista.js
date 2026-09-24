/* PSM-OS v2 — 🎯 Rotina de Gestão · PSM Conquista (v88.33)
   A rotina da DIRETORA da Conquista (Isabella) com o GERENTE da equipe (Kaue), numa tela:
     1. Esta semana — as reuniões Isa × Kaue (e as da diretoria de que ela participa) dia a dia:
        ✓ ata registrada · ⚠ passou sem ata · ⏳ por vir. "Registrar ata" aqui mesmo.
     2. Tarefas recorrentes de cada um (dia/semana/quinzena/mês/trimestre) com check no período.
     3. Acompanhamento — Scorecard da Conquista, pendências abertas das reuniões e aderência.
     4. Funções e responsabilidades — mandato de cada um e quem decide o quê (RACI).
   Reuniões = formatos da rotina v2.3 (/api/v3/gp/reunioes_formatos: lembrete, ata, pendência);
   tarefas/aderência = /api/v3/diretoria/rotina; placar = /api/v3/diretoria/scorecard. */
import { api } from '../api.js';

let _root = null;
let _r = null, _f = null, _sc = null;
let _ataAberta = null;

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex'];
const CAD = [
  { id: 'diario', lbl: 'Todo dia' }, { id: 'semanal', lbl: 'Toda semana' }, { id: 'quinzenal', lbl: 'A cada 15 dias' },
  { id: 'mensal', lbl: 'Todo mês' }, { id: 'trimestral', lbl: 'Todo trimestre' },
];
const COR = { verde: '#16a34a', amarelo: '#d97706', vermelho: '#dc2626', cinza: '#94a3b8', info: '#0891b2' };

export async function pageRotinaConquista(ctx, root) {
  _root = root;
  _root.innerHTML = '<div class="card"><div class="muted tiny"><span class="spinner"></span> Carregando a rotina…</div></div>';
  await load();
}

async function load() {
  try {
    const [r, f] = await Promise.all([api.request('/api/v3/diretoria/rotina'), api.request('/api/v3/gp/reunioes_formatos')]);
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
function bate(f, d) {
  const c = f.cadencia || {}, wd = (d.getDay() + 6) % 7;
  if (c.tipo === 'semanal') return (c.dias || []).includes(wd);
  if (c.tipo === 'quinzenal') {
    if (wd !== c.dia || !c.ref) return false;
    const ref = new Date(c.ref + 'T12:00:00');
    return Math.floor((new Date(ymd(d) + 'T12:00:00') - ref) / 864e5 / 7) % 2 === 0;
  }
  if (c.tipo === 'mensal_nth') return wd === c.dia && Math.floor((d.getDate() - 1) / 7) + 1 === Number(c.nth || 1);
  if (c.tipo === 'mensal_ultima') return wd === c.dia && d.getDate() > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - 7;
  return false;
}
const dataBRT = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });   // AAAA-MM-DD

/* ─── render ─────────────────────────────────────────────────────────── */
function render() {
  const r = _r;
  const a = r.aderencia;
  const pend = pendencias();
  const venc = pend.filter(p => p.prazo && p.prazo < r.hoje).length;
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🎯 Rotina de Gestão · PSM Conquista</h2>
      <p class="card-sub"><b>${esc(r.papeis.isa.nome)}</b> — ${esc(r.papeis.isa.cargo)} × <b>${esc(r.papeis.kaue.nome)}</b> — ${esc(r.papeis.kaue.cargo)}.
        Reuniões com pauta e ata, tarefas com dono e cadência, e o placar que diz se está funcionando.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px" class="mt-2">
        ${tile('Aderência da semana', pct(a.semana.pct), `Isa ${pct(a.semana.isa)} · Kaue ${pct(a.semana.kaue)}`, corPct(a.semana.pct))}
        ${tile('Aderência do mês', pct(a.mes.pct), `${a.mes.feito}/${a.mes.esperado} tarefas`, corPct(a.mes.pct))}
        ${tile('Pendências abertas', pend.length, venc ? `${venc} vencida(s)` : 'nenhuma vencida', venc ? COR.vermelho : pend.length ? COR.amarelo : COR.verde)}
        ${tile('Reuniões da semana', semanaStats().feitas + '/' + semanaStats().previstas, 'com ata registrada', corPct(semanaStats().previstas ? semanaStats().feitas / semanaStats().previstas * 100 : null))}
      </div>
      ${trilhaHTML()}
    </div>
    ${semanaHTML()}
    <div id="rc-ata"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px" class="mt-3">
      ${tarefasHTML('isa')}
      ${tarefasHTML('kaue')}
    </div>
    <div class="card mt-3"><div style="font-weight:800">📊 Acompanhamento — Scorecard PSM Conquista</div>
      <div id="rc-placar" class="mt-2"><div class="tiny muted"><span class="spinner"></span> Carregando o placar…</div></div></div>
    ${pendenciasHTML(pend)}
    ${funcoesHTML()}`;
  bind();
}

function tile(lbl, val, sub, cor) {
  return `<div style="background:var(--bg-3);border-radius:8px;padding:10px;border-top:3px solid ${cor || COR.cinza}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">${lbl}</div>
    <div style="font-size:22px;font-weight:800;color:${cor || 'inherit'}">${val}</div><div class="tiny muted">${sub}</div></div>`;
}
const pct = v => v == null ? '—' : v + '%';
const corPct = v => v == null ? COR.cinza : v >= 80 ? COR.verde : v >= 50 ? COR.amarelo : COR.vermelho;

function trilhaHTML() {
  const s = _r.semanas || [];
  if (!s.length) return '';
  return `<div class="tiny muted mt-2">Aderência das últimas 8 semanas (a rotina vale desde ${_r.inicio ? _r.inicio.split('-').reverse().join('/') : '—'}):</div>
    <div class="flex gap-1" style="align-items:flex-end;height:46px;margin-top:4px">
      ${s.map(w => `<div title="semana de ${w.semana.split('-').reverse().slice(0, 2).join('/')}: ${pct(w.pct)}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="width:100%;max-width:38px;height:${w.pct == null ? 3 : Math.max(3, w.pct * 0.34)}px;background:${w.pct == null ? 'var(--bg-3)' : corPct(w.pct)};border-radius:3px 3px 0 0"></div>
        <div class="tiny muted" style="font-size:9px">${w.semana.split('-').reverse().slice(0, 2).join('/')}</div></div>`).join('')}
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
    if (!bate(f, d) || ymd(d) > _r.hoje || (f.desde && ymd(d) < f.desde)) continue;
    previstas++; if (ataDe(f.id, d)) feitas++;
  }
  return { previstas, feitas };
}
function semanaHTML() {
  const dias = diasSemana();
  const fs = formatosRotina();
  return `<div class="card mt-3">
    <div style="font-weight:800">📅 Esta semana — reuniões</div>
    <div class="tiny muted">As 5 reuniões Isa × Kaue + as da diretoria/equipe de que ela participa. Lembrete automático 30 min antes; sem ata, o rito não aconteceu.</div>
    <div style="overflow-x:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px">
      <thead><tr class="tiny muted"><th style="text-align:left;padding:4px 6px">Reunião</th>
        ${dias.map(d => `<th style="padding:4px;text-align:center;${ymd(d) === _r.hoje ? 'color:var(--psm-navy);font-weight:800' : ''}">${DIAS[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}</th>`).join('')}</tr></thead>
      <tbody>${fs.map(f => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:6px"><div style="font-weight:700">${esc(f.emoji || '📋')} ${esc(f.nome)}</div>
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
  const pode = _f.pode_ata && !ata && dia <= _r.hoje;
  return `<td style="padding:3px;text-align:center"><div title="${tit}" style="border-radius:6px;padding:4px 0;background:${cor}1f;color:${cor};font-weight:800">${ico}
    ${pode ? `<div><a href="javascript:void 0" class="tiny" data-ata="${esc(f.id)}" data-dia="${dia}">registrar ata</a></div>` : ''}</div></td>`;
}

function ataForm(fid, dia) {
  const f = (_f.formatos || []).find(x => x.id === fid) || {};
  const el = document.getElementById('rc-ata');
  _ataAberta = { fid, pend: [{ txt: '', dono: 'Kaue', prazo: '' }] };
  el.innerHTML = `<div class="card mt-3" style="border:2px solid var(--psm-navy)">
    <div class="flex" style="justify-content:space-between"><div style="font-weight:800">📝 Ata — ${esc(f.emoji || '')} ${esc(f.nome || fid)} · ${dia.split('-').reverse().join('/')}</div>
      <button class="btn btn-ghost btn-sm" id="rc-ata-x">✕</button></div>
    <div class="tiny muted mb-2">Pauta: ${(f.pauta || []).map(esc).join(' · ')}</div>
    <label class="tiny muted">Decisões (3 linhas bastam)</label>
    <textarea id="rc-ata-dec" class="input" rows="3" placeholder="O que foi decidido"></textarea>
    <div class="tiny muted mt-2" style="font-weight:700">Pendências — sem dono e prazo, não existe</div>
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
  return `<div class="card" style="border-top:4px solid ${quem === 'isa' ? 'var(--psm-gold,#d4a843)' : 'var(--psm-navy,#0b1f3a)'}">
    <div class="flex" style="justify-content:space-between;align-items:center"><div style="font-weight:800">✅ Tarefas — ${esc(p.nome)}</div>
      <span class="tiny" style="font-weight:700;color:${corPct(a)}">semana ${pct(a)}</span></div>
    <div class="tiny muted">${esc(p.cargo)}</div>
    ${CAD.map(c => {
      const g = ts.filter(t => t.cad === c.id);
      if (!g.length) return '';
      return `<div class="tiny" style="font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.55;margin-top:10px">${c.lbl}</div>
        ${g.map(t => `<label class="flex gap-2" style="align-items:flex-start;padding:5px 0;border-top:1px dashed var(--border);cursor:${t.pode ? 'pointer' : 'default'}">
          <input type="checkbox" data-t="${t.id}" ${t.feito ? 'checked' : ''} ${t.pode ? '' : 'disabled'} style="margin-top:3px">
          <span style="flex:1;font-size:12.5px;${t.feito ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.txt)}
            ${t.porque ? `<span class="tiny muted"> — ${esc(t.porque)}</span>` : ''}
            ${t.feito ? `<span class="tiny muted"> · ✓ ${esc(t.feito.por || '')} ${new Date(t.feito.ts).toLocaleDateString('pt-BR')}</span>` : ''}</span>
          ${t.link ? `<a href="${esc(t.link)}" class="tiny" title="abrir a tela">abrir →</a>` : ''}
        </label>`).join('')}`;
    }).join('')}
  </div>`;
}

/* ─── placar / pendências / funções ──────────────────────────────────── */
function placarHTML() {
  const sc = (_sc?.scorecards || []).find(s => s.id === 'un_conquista');
  if (!sc) return '<div class="tiny muted">Placar da Conquista não disponível para este usuário.</div>';
  const fmt = (v, un) => v == null ? '—' : un === 'R$' ? 'R$ ' + (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi' : Math.abs(v) >= 1e4 ? (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })) : un === '%' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%' : v.toLocaleString('pt-BR');
  return `<div class="tiny muted">Mês em andamento: ${_sc.ritmo}% decorrido · dono do placar: ${esc(sc.dono_nome)} · <a href="#/scorecard">abrir Scorecards →</a></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;margin-top:6px">
    ${sc.indicadores.map(i => `<div style="background:var(--bg-3);border-radius:8px;padding:8px;border-left:3px solid ${COR[i.farol] || COR.cinza}">
      <div class="tiny muted">${esc(i.label)}</div><div style="font-weight:800">${fmt(i.valor, i.un)}</div>
      <div class="tiny" style="color:${COR[i.farol] || COR.cinza}">${i.meta != null ? 'meta ' + fmt(i.meta, i.un) + (i.pct != null ? ' · ' + i.pct + '%' : '') : 'sem meta'}</div></div>`).join('')}
  </div>`;
}

function pendencias() {
  const ids = _r.formatos || [];
  return (_f.pendencias_abertas || []).filter(p => ids.includes(p.formato_id));
}
function pendenciasHTML(pend) {
  const nome = id => ((_f.formatos || []).find(f => f.id === id) || {}).nome || id;
  return `<div class="card mt-3"><div style="font-weight:800">📌 Pendências abertas das reuniões (${pend.length})</div>
    ${pend.length ? pend.sort((a, b) => String(a.prazo).localeCompare(String(b.prazo))).map(p => `<div class="flex gap-2" style="align-items:center;padding:5px 0;border-top:1px dashed var(--border);font-size:12.5px;flex-wrap:wrap">
      <span style="flex:1;min-width:200px">${esc(p.txt)}<div class="tiny muted">${esc(nome(p.formato_id))}</div></span>
      <span class="tiny">👤 ${esc(p.dono)}</span>
      <span class="tiny" style="color:${p.prazo < _r.hoje ? COR.vermelho : 'inherit'};font-weight:700">${p.prazo < _r.hoje ? '⚠ ' : ''}${String(p.prazo).split('-').reverse().join('/')}</span>
      ${_f.pode_ata ? `<button class="btn btn-ghost btn-sm" data-baixa="${esc(p.ata_id)}" data-idx="${p.idx}">✓ feito</button>` : ''}
    </div>`).join('') : '<div class="tiny muted mt-1">Nenhuma — toda pendência sai de uma ata, com dono e prazo.</div>'}
  </div>`;
}

function funcoesHTML() {
  const p = _r.papeis;
  const COL = { R: ['Executa', COR.info], A: ['Aprova / responde', COR.verde], C: ['Consultado', COR.amarelo], I: ['Informado', COR.cinza] };
  const tag = v => `<span title="${COL[v][0]}" style="display:inline-block;min-width:26px;text-align:center;font-weight:800;border-radius:6px;padding:2px 6px;background:${COL[v][1]}22;color:${COL[v][1]}">${v}</span>`;
  const mand = q => `<div><div style="font-weight:800">${esc(p[q].nome)}</div><div class="tiny muted">${esc(p[q].cargo)}</div>
    <ul style="margin:6px 0 0 18px;font-size:12.5px;line-height:1.6">${p[q].mandato.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  return `<div class="card mt-3"><div style="font-weight:800">🧭 Funções e responsabilidades</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:8px">${mand('isa')}${mand('kaue')}</div>
    <div style="font-weight:700;margin-top:14px">Quem decide o quê</div>
    <div class="tiny muted">R = executa · A = aprova e responde pelo resultado · C = é consultado antes · I = é informado depois</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px;min-width:420px">
      <thead><tr class="tiny muted"><th style="text-align:left;padding:4px 6px">Assunto</th><th style="padding:4px">Isabella</th><th style="padding:4px">Kaue</th></tr></thead>
      <tbody>${_r.raci.map(x => `<tr style="border-top:1px solid var(--border)"><td style="padding:5px 6px">${esc(x.assunto)}</td><td style="text-align:center">${tag(x.isa)}</td><td style="text-align:center">${tag(x.kaue)}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

/* ─── eventos ────────────────────────────────────────────────────────── */
function bind() {
  _root.querySelectorAll('[data-t]').forEach(cb => cb.addEventListener('change', async () => {
    cb.disabled = true;
    try { await api.request('/api/v3/diretoria/rotina', { method: 'POST', body: { action: 'check', item: cb.dataset.t, feito: cb.checked } }); await load(); }
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
