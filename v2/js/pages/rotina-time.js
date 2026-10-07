/* PSM-OS v2 — 🗓 A rotina do time (passo ④ do Playbook da Venda) — v89.40
   Pedido do Paulo (02–07/10/2026): "já tem o mapa e os scripts, faltaria a rotina" e
   "divida sempre o dia em horários de 1 em 1 hora". Cada nicho tem a sua: o padrão que o
   time persegue, os inegociáveis, a semana de hora em hora, regras e gatilhos.
   Todos consultam; a gestão (lvl ≥ 5) edita. Dados em /api/v3/scripts/rotina?linha=<id>. */
import { api } from '../api.js';
import { esc, DIAS, MODOS, diaDeHoje, gradeHora, semanaTabela, legendaModos } from './rotina-hora.js';

let _host = null, _linha = '', _nome = '', _cor = 'var(--accent)';
let _r = null, _can = false, _dia = diaDeHoje(), _ed = null, _busy = false, _msg = '', _ver = 'dia';

export async function montarRotinaTime(host, { linha, nome, cor }) {
  _host = host; _linha = linha; _nome = nome || ''; _cor = cor || _cor; _ed = null; _msg = '';
  host.innerHTML = '<div class="tiny muted" style="padding:14px"><span class="spinner"></span> Carregando a rotina…</div>';
  try {
    const d = await api.request('/api/v3/scripts/rotina?linha=' + encodeURIComponent(linha));
    _r = d.rotina; _can = !!d.can_edit;
  } catch (e) {
    host.innerHTML = `<div class="alert alert-err">Não consegui carregar a rotina: ${esc(e.message)}</div>`; return;
  }
  render();
}

const VAZIA = () => ({ titulo: 'Rotina do time ' + _nome, vigencia: '', intro: '', padrao: [], inegociaveis: [], regras: [], gatilhos: [], dias: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } });
const box = (inner, extra = '') => `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md,10px);padding:12px 14px;${extra}">${inner}</div>`;
const tit = (t, sub) => `<div style="font-weight:800;font-size:15px;margin-bottom:6px">${t}${sub ? `<span class="tiny muted" style="font-weight:500"> · ${sub}</span>` : ''}</div>`;

function render() {
  if (_ed) return renderEditor();
  const r = _r;
  if (!r) {
    _host.innerHTML = box(`<div style="text-align:center;padding:20px 8px"><div style="font-size:30px">🗓</div>
      <div style="font-weight:800;margin-top:6px">A rotina deste nicho ainda não foi montada</div>
      <div class="tiny muted" style="margin-top:4px">${_can ? 'Monte a semana de hora em hora, o padrão e as regras do time.' : 'Assim que a gestão montar, ela aparece aqui.'}</div>
      ${_can ? '<button class="btn btn-primary btn-sm" id="rt-edit" style="margin-top:10px">➕ Montar a rotina</button>' : ''}</div>`);
    _host.querySelector('#rt-edit')?.addEventListener('click', () => { _ed = VAZIA(); render(); });
    return;
  }
  const padrao = (r.padrao || []).length ? box(tit('🎯 O padrão do time', 'por corretor') + `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:6px 8px">O quê</th><th style="padding:6px 8px">Por dia</th><th style="padding:6px 8px">Por semana</th><th style="padding:6px 8px">No mês</th></tr></thead>
      <tbody>${r.padrao.map(x => `<tr style="border-top:1px solid var(--border)"><td style="padding:6px 8px;font-weight:600">${esc(x.rotulo)}</td><td style="padding:6px 8px;text-align:center">${esc(x.dia)}</td><td style="padding:6px 8px;text-align:center;font-weight:800">${esc(x.semana)}</td><td style="padding:6px 8px;text-align:center">${esc(x.mes)}</td></tr>`).join('')}</tbody></table>
    <div class="tiny" style="margin-top:8px"><a href="#/placar-diario">📊 Lançar o placar do dia</a></div>`) : '';
  const ineg = (r.inegociaveis || []).length ? box(tit('✅ Os inegociáveis do dia') + r.inegociaveis.map((x, i) => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin:6px 0">
      <span style="background:${_cor};color:#fff;border-radius:999px;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex:none">${i + 1}</span>
      <div style="font-size:13px"><b>${esc(x.titulo)}</b><div>${esc(x.texto)}</div></div></div>`).join('')) : '';
  const regras = (r.regras || []).length ? box(tit('📌 Regras do jogo') + `<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">${r.regras.map((x, i) => `<li${i === 0 ? ' style="font-weight:700"' : ''}>${esc(x)}</li>`).join('')}</ul>`) : '';
  const gat = (r.gatilhos || []).length ? box(tit('🚦 Gatilhos da semana') + r.gatilhos.map(g => `
    <div style="border-left:4px solid ${_cor};background:var(--bg-3);border-radius:0 6px 6px 0;padding:6px 10px;margin:5px 0;font-size:13px"><b>${esc(g.sinal)}:</b> ${esc(g.acao)}</div>`).join('')) : '';
  _host.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div style="flex:1;min-width:240px"><div style="font-weight:800;font-size:16px">🗓 ${esc(r.titulo || 'A rotina do time')}</div>
        <div class="tiny muted">${esc(r.vigencia || '')}${r.intro ? ' · ' + esc(r.intro) : ''}</div></div>
      <div class="flex gap-1">${_can ? '<button class="btn btn-ghost btn-sm" id="rt-edit">✏️ Editar rotina</button>' : ''}<button class="btn btn-ghost btn-sm" id="rt-print">🖨 Imprimir</button></div>
    </div>
    ${_msg ? `<div class="tiny" style="color:var(--ok);margin-bottom:6px">${esc(_msg)}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start">${padrao}${ineg}</div>
    <div style="margin-top:12px">${box(`
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        ${tit('🕘 A semana, de hora em hora')}
        <div class="flex gap-1"><button class="btn btn-sm ${_ver === 'dia' ? 'btn-primary' : 'btn-ghost'}" data-rt-ver="dia">Um dia por vez</button><button class="btn btn-sm ${_ver === 'semana' ? 'btn-primary' : 'btn-ghost'}" data-rt-ver="semana">Semana inteira</button></div>
      </div>
      ${legendaModos()}
      ${_ver === 'semana' ? semanaTabela(r.dias) : gradeHora(r.dias, _dia)}`)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start;margin-top:12px">${regras}${gat}</div>`;
  _host.querySelectorAll('[data-rh-dia]').forEach(b => b.onclick = () => { _dia = b.dataset.rhDia; render(); });
  _host.querySelectorAll('[data-rt-ver]').forEach(b => b.onclick = () => { _ver = b.dataset.rtVer; render(); });
  _host.querySelector('#rt-edit')?.addEventListener('click', () => { _ed = JSON.parse(JSON.stringify(_r)); _ed.dias ||= {}; DIAS.forEach(([k]) => _ed.dias[k] ||= []); _msg = ''; render(); });
  _host.querySelector('#rt-print')?.addEventListener('click', () => { _ver = 'semana'; render(); setTimeout(() => window.print(), 50); });
}

/* ───────────── edição (gestão) ───────────── */
const linhas = (arr, f) => (arr || []).map(f).join('\n');
const partes = (txt, n) => String(txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split('|').map(x => x.trim()); while (p.length < n) p.push(''); return p; });

function renderEditor() {
  const e = _ed;
  const opt = (v, cur, lbl) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${lbl}</option>`;
  const faixa = (f, i) => `<div style="border-top:1px dashed var(--border);padding:8px 0">
    <div class="flex gap-1" style="flex-wrap:wrap;align-items:center">
      <input class="input" type="time" step="3600" data-f="ini" data-i="${i}" value="${esc(f.ini)}" style="width:104px" title="início">
      <input class="input" type="time" step="3600" data-f="fim" data-i="${i}" value="${esc(f.fim)}" style="width:104px" title="fim">
      <input class="input" data-f="bloco" data-i="${i}" value="${esc(f.bloco)}" placeholder="Nome do bloco" style="flex:2;min-width:200px">
      <select class="input" data-f="modo" data-i="${i}" style="width:190px">${Object.entries(MODOS).map(([k, m]) => opt(k, f.modo || 'i', m.nome)).join('')}</select>
      <select class="input" data-f="tipo" data-i="${i}" style="width:150px">${opt('', f.tipo || '', 'Bloco normal')}${opt('ouro', f.tipo, '🔥 Bloco de ouro')}${opt('gold', f.tipo, '⭐ Horário GOLD')}${opt('pausa', f.tipo, 'Pausa / almoço')}</select>
      <button class="btn btn-ghost btn-sm" data-del="${i}" title="remover esta faixa">🗑</button></div>
    <input class="input tiny mt-1" data-f="oque" data-i="${i}" value="${esc(f.oque)}" placeholder="Objetivo da faixa">
    <textarea class="input tiny mt-1" data-f="tarefas" data-i="${i}" rows="3" placeholder="Tarefas — uma por linha">${esc((f.tarefas || []).join('\n'))}</textarea></div>`;
  _host.innerHTML = `<div style="border:2px solid ${_cor};border-radius:var(--r-md,10px);padding:12px 14px">
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
      <div style="font-weight:800">✏️ Editando a rotina · ${esc(_nome)}</div>
      <div class="flex gap-1"><button class="btn btn-ghost btn-sm" id="rt-x">Cancelar</button><button class="btn btn-primary btn-sm" id="rt-ok" ${_busy ? 'disabled' : ''}>${_busy ? '⏳' : '💾'} Salvar rotina</button></div></div>
    <div class="tiny" style="min-height:14px;color:var(--err)">${esc(_msg)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px">
      <div><label class="tiny muted">Título</label><input class="input" id="rt-titulo" value="${esc(e.titulo)}"></div>
      <div><label class="tiny muted">Vigência</label><input class="input" id="rt-vig" value="${esc(e.vigencia)}" placeholder="a partir de…"></div></div>
    <label class="tiny muted mt-1" style="display:block">Jornada (uma frase)</label><input class="input" id="rt-intro" value="${esc(e.intro)}">

    <div style="font-weight:700;margin-top:14px">🕘 A semana, de hora em hora</div>
    <div class="tiny muted">Cada faixa é uma hora do dia. Bloco que começa no meio da hora vai escrito no nome (ex.: "Largada (até 9h30) · bloco de ouro").</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">${DIAS.map(([k, n]) => `<button class="btn btn-sm ${k === _dia ? 'btn-primary' : 'btn-ghost'}" data-ed-dia="${k}">${n} (${(e.dias[k] || []).length})</button>`).join('')}</div>
    ${(e.dias[_dia] || []).map(faixa).join('')}
    <div class="flex gap-1 mt-1"><button class="btn btn-ghost btn-sm" id="rt-add">➕ faixa de 1 hora</button>
      <select class="input" id="rt-copia" style="width:230px"><option value="">Copiar as faixas de outro dia…</option>${DIAS.filter(([k]) => k !== _dia).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:14px">
      <div><div style="font-weight:700">🎯 O padrão</div><label class="tiny muted">Uma linha por indicador: rótulo | por dia | por semana | no mês</label>
        <textarea class="input tiny" id="rt-padrao" rows="10">${esc(linhas(e.padrao, x => [x.rotulo, x.dia, x.semana, x.mes].join(' | ')))}</textarea></div>
      <div><div style="font-weight:700">✅ Inegociáveis</div><label class="tiny muted">Uma linha por item: título | explicação</label>
        <textarea class="input tiny" id="rt-ineg" rows="10">${esc(linhas(e.inegociaveis, x => [x.titulo, x.texto].join(' | ')))}</textarea></div>
      <div><div style="font-weight:700">📌 Regras do jogo</div><label class="tiny muted">Uma regra por linha (a primeira aparece em destaque)</label>
        <textarea class="input tiny" id="rt-regras" rows="10">${esc((e.regras || []).join('\n'))}</textarea></div>
      <div><div style="font-weight:700">🚦 Gatilhos</div><label class="tiny muted">Uma linha por gatilho: sinal | o que fazer</label>
        <textarea class="input tiny" id="rt-gat" rows="10">${esc(linhas(e.gatilhos, x => [x.sinal, x.acao].join(' | ')))}</textarea></div>
    </div></div>`;

  const $ = id => _host.querySelector('#' + id);
  const sync = () => {
    e.titulo = $('rt-titulo').value; e.vigencia = $('rt-vig').value; e.intro = $('rt-intro').value;
    e.padrao = partes($('rt-padrao').value, 4).map(p => ({ rotulo: p[0], dia: p[1], semana: p[2], mes: p[3] }));
    e.inegociaveis = partes($('rt-ineg').value, 2).map(p => ({ titulo: p[0], texto: p.slice(1).join(' | ') }));
    e.regras = $('rt-regras').value.split('\n').map(x => x.trim()).filter(Boolean);
    e.gatilhos = partes($('rt-gat').value, 2).map(p => ({ sinal: p[0], acao: p.slice(1).join(' | ') }));
    _host.querySelectorAll('[data-f]').forEach(el => {
      const f = e.dias[_dia][+el.dataset.i]; if (!f) return;
      f[el.dataset.f] = el.dataset.f === 'tarefas' ? el.value.split('\n').map(x => x.trim()).filter(Boolean) : el.value;
    });
  };
  _host.querySelectorAll('[data-ed-dia]').forEach(b => b.onclick = () => { sync(); _dia = b.dataset.edDia; render(); });
  _host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { sync(); e.dias[_dia].splice(+b.dataset.del, 1); render(); });
  $('rt-add').onclick = () => {
    sync();
    const ult = e.dias[_dia][e.dias[_dia].length - 1];
    const h = ult ? Math.min(22, parseInt(ult.fim, 10)) : 9;
    e.dias[_dia].push({ ini: String(h).padStart(2, '0') + ':00', fim: String(h + 1).padStart(2, '0') + ':00', bloco: '', modo: 'i', tipo: '', oque: '', tarefas: [] });
    render();
  };
  $('rt-copia').onchange = (ev) => { const k = ev.target.value; if (!k) return; sync(); e.dias[_dia] = JSON.parse(JSON.stringify(e.dias[k] || [])); render(); };
  $('rt-x').onclick = () => { _ed = null; _msg = ''; render(); };
  $('rt-ok').onclick = async () => {
    sync(); _busy = true; _msg = ''; render();
    try {
      const d = await api.request('/api/v3/scripts/rotina', { method: 'POST', body: { linha: _linha, rotina: _ed } });
      _r = d.rotina; _ed = null; _msg = '✅ Rotina salva.';
    } catch (err) { _msg = '⚠ ' + (err.message || 'não salvou'); }
    _busy = false; render();
  };
}
