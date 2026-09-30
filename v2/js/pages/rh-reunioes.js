/* PSM-OS v2 — 📋 Formatos de Reunião (rotina v2.3) — v84.99
   Cards de formato (pauta fixa, participantes, cadência, dono, painel-fonte),
   ata rápida (pendência sem dono+prazo NÃO existe), lembrete automático por
   alçada (heartbeat) e histórico de atas. Regras universais no topo.
   v89.18: deixou de ser engessada — diretoria (lvl>=8) cria, edita e remove reunião fixa aqui
   (POST set_formato / del_formato, que já existiam no backend sem tela). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null;
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

export async function pageRhReunioes(ctx, root) {
  _root = root;
  await load();
}

async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando formatos…</div></div>';
  try { _d = await api.request('/api/v3/gp/reunioes_formatos'); }
  catch (e) { _root.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; return; }
  render();
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function cadenciaTxt(f) {
  const c = f.cadencia || {};
  if (c.tipo === 'semanal') return ((c.dias || []).length === 5 ? 'seg–sex' : (c.dias || []).map(d => DIAS[d]).join('/')) + (c.pular_1a ? ' (menos na 1ª do mês)' : '');
  if (c.tipo === 'quinzenal') return `quinzenal (${DIAS[c.dia]})`;
  if (c.tipo === 'mensal_nth') return `${c.nth}ª ${DIAS[c.dia]} do mês`;
  if (c.tipo === 'mensal_ultima') return `última semana (${DIAS[c.dia]})`;
  if (c.tipo === 'mensal_dias') return 'dia ' + (c.dias_mes || []).map(n => +n >= 31 ? 'último' : n).join(', ').replace(/, ([^,]*)$/, ' e $1') + ' do mês';
  if (c.tipo === 'sob_demanda') return 'quando precisar';
  return '—';
}

function cargaSemanal(formatos) {
  // minutos/semana aproximados por formato (quinzenal=0.5x, mensal=0.25x)
  let tot = 0;
  formatos.forEach(f => {
    const c = f.cadencia || {}; const d = f.dur_min || 30;
    if (c.tipo === 'semanal') tot += d * (c.dias || []).length;
    else if (c.tipo === 'quinzenal') tot += d / 2;
    else if (c.tipo === 'mensal_dias') tot += d * (c.dias_mes || []).length / 4.3;
    else if (c.tipo !== 'sob_demanda') tot += d / 4.3;
  });
  return Math.round(tot);
}

function render() {
  const fs = _d.formatos || [];
  const pend = _d.pendencias_abertas || [];
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <b style="font-size:16px">📅 Agenda de reuniões</b>
        <div class="flex gap-2" style="align-items:center;flex-wrap:wrap">
          <span class="tiny" style="background:var(--accent);color:var(--on-accent);border-radius:var(--radius-full);padding:3px 12px;font-weight:600">carga total ≈ ${cargaSemanal(fs)} min/semana (todas as cadeiras)</span>
          ${_d.pode_editar ? '<button class="btn btn-primary btn-sm" id="rp-novo">➕ Nova reunião fixa</button>' : ''}</div>
      </div>
      <div class="alert" style="background:var(--bg-3);border:none;font-size:12px;margin-top:8px;line-height:1.6">
        <b>Regras universais:</b> toda reunião tem <b>DONO, PAUTA FIXA e PAINEL ABERTO NA TELA</b> (dado, não opinião) ·
        começa e termina no horário · <b>caiu em feriado, vai pro próximo dia útil</b> · ata de 3 linhas no ato · <b>pendência sem dono+prazo não existe</b> ·
        reunião sem painel/pauta = cancelada. <span class="muted">Anti-inflação: formato novo só entra se outro sair ou justificar contra a carga acima.</span>
      </div>
      ${pend.length ? `<div class="card" style="margin:10px 0 0;background:var(--err-soft);border:1px solid var(--err)">
        <b class="tiny" style="color:var(--err)">⏳ ${pend.length} pendência(s) aberta(s) de reuniões</b>
        ${pend.slice(0, 8).map(p => `<div class="tiny" style="margin-top:4px;display:flex;gap:6px;align-items:center">
          <button class="btn btn-ghost btn-sm rp-baixa" data-ata="${esc(p.ata_id)}" data-idx="${p.idx}" style="padding:0 6px" title="marcar como feita">☑️</button>
          <span><b>${esc(p.txt)}</b> — ${esc(p.dono)} até ${esc(p.prazo)}</span></div>`).join('')}
      </div>` : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:12px">
        ${fs.map(f => `
          <div class="card" style="margin:0;border-left:4px solid var(--psm-navy)">
            <div class="flex" style="justify-content:space-between;align-items:flex-start">
              <b>${f.emoji || '📋'} ${esc(f.nome)}</b>
              <span class="tiny" style="background:var(--bg-3);border-radius:var(--radius-full);padding:2px 9px;font-weight:600;white-space:nowrap">${cadenciaTxt(f)} · ${esc(f.hora)} · ${f.dur_min}min</span>
            </div>
            ${f.calendario ? '<div class="tiny" style="margin-top:4px;color:var(--ok,#239a5b)">📅 no calendário (House + Zoho)</div>' : ''}
            ${Object.entries(f.excecoes || {}).filter(([d]) => d >= new Date().toISOString().slice(0, 10)).map(([d, x]) => `<div class="tiny" style="margin-top:2px">🔀 ${d.split('-').reverse().slice(0, 2).join('/')}: ${x.cancelada ? 'não acontece' : 'às ' + esc(x.hora) + ' (só neste dia)'}</div>`).join('')}
            <div class="tiny muted" style="margin-top:4px">👑 ${esc(f.dono)} · 👥 ${(f.participantes || []).map(esc).join(', ')}${(f.papeis || []).length ? ' + ' + f.papeis.map(p => p === '*' ? 'empresa inteira' : esc(p)).join(', ') : ''}${f.obs ? ` · <i>${esc(f.obs)}</i>` : ''}</div>
            <div class="tiny" style="margin-top:4px">🖥 Painel: <a href="${esc(f.painel)}" style="color:var(--info)">${esc(f.painel_nome)}</a></div>
            <ol class="tiny" style="margin:6px 0 0 16px;line-height:1.5">${(f.pauta || []).map(p => `<li>${esc(p)}</li>`).join('')}</ol>
            <div class="flex gap-1 mt-2">
              ${_d.pode_ata ? `<button class="btn btn-primary btn-sm rp-ata" data-f="${esc(f.id)}">📝 Registrar reunião</button>` : ''}
              ${_d.pode_editar ? `<button class="btn btn-ghost btn-sm rp-edit" data-f="${esc(f.id)}">✏️ Editar</button>` : ''}</div>
            ${historicoHTML(f.id)}
          </div>`).join('')}
      </div>
    </div>
    <div id="rp-modal"></div>`;
  wire();
}

function historicoHTML(fid) {
  const atas = (_d.atas || []).filter(a => a.formato_id === fid).slice(0, 3);
  if (!atas.length) return '';
  return `<details style="margin-top:8px"><summary class="tiny muted" style="cursor:pointer">🗂 últimas atas (${atas.length})</summary>
    ${atas.map(a => `<div class="tiny" style="margin-top:6px;border-top:1px dashed var(--border);padding-top:5px">
      <b>${new Date(a.ts).toLocaleDateString('pt-BR')}</b> <span class="muted">· ${esc(a.por || '')}</span><br>${esc(a.decisoes || '—')}
      ${(a.pendencias || []).map(p => `<div style="margin-left:8px">${p.feito ? '☑️' : '⏳'} ${esc(p.txt)} — ${esc(p.dono)} até ${esc(p.prazo)}</div>`).join('')}
    </div>`).join('')}</details>`;
}

function wire() {
  _root.querySelectorAll('.rp-ata').forEach(b => b.onclick = () => abrirAta(b.dataset.f));
  _root.querySelectorAll('.rp-edit').forEach(b => b.onclick = () => abrirForm((_d.formatos || []).find(x => x.id === b.dataset.f)));
  const novo = _root.querySelector('#rp-novo');
  if (novo) novo.onclick = () => abrirForm(null);
  _root.querySelectorAll('.rp-baixa').forEach(b => b.onclick = async () => {
    try { await api.request('/api/v3/gp/reunioes_formatos', { method: 'POST', body: { action: 'baixar_pendencia', ata_id: b.dataset.ata, idx: +b.dataset.idx } }); }
    catch (e) { alert(e.message); }
    load();
  });
}

function abrirAta(fid) {
  const f = (_d.formatos || []).find(x => x.id === fid) || {};
  const m = document.getElementById('rp-modal');
  m.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:600px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <b>📝 Ata — ${f.emoji || ''} ${esc(f.nome || '')}</b>
          <button class="btn btn-ghost btn-sm" id="rp-x">✕</button>
        </div>
        <label class="tiny muted" style="font-weight:600;margin-top:8px;display:block">Decisões (3 linhas, no ato)</label>
        <textarea id="rp-dec" class="input" rows="3" style="width:100%" placeholder="O que foi DECIDIDO — dado, não opinião…"></textarea>
        <label class="tiny muted" style="font-weight:600;margin-top:8px;display:block">Pendências <span style="color:var(--err)">(sem dono+prazo não existe)</span></label>
        <div id="rp-pends">${[0, 1, 2].map(i => `
          <div class="flex gap-1 mb-1">
            <input class="input rp-p-txt" placeholder="pendência ${i + 1}" style="flex:2;font-size:12px">
            <input class="input rp-p-dono" placeholder="dono" style="flex:1;font-size:12px">
            <input class="input rp-p-prazo" type="date" style="width:135px;font-size:12px">
          </div>`).join('')}</div>
        <div id="rp-err" class="tiny" style="color:var(--err);margin-top:6px"></div>
        <div class="flex gap-2 mt-2" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="rp-cancel">Cancelar</button>
          <button class="btn btn-primary" id="rp-save">💾 Registrar</button>
        </div>
      </div>
    </div>`;
  const fecha = () => { m.innerHTML = ''; };
  m.querySelector('#rp-x').onclick = fecha; m.querySelector('#rp-cancel').onclick = fecha;
  m.querySelector('#rp-save').onclick = async () => {
    const txts = [...m.querySelectorAll('.rp-p-txt')].map(e => e.value.trim());
    const donos = [...m.querySelectorAll('.rp-p-dono')].map(e => e.value.trim());
    const prazos = [...m.querySelectorAll('.rp-p-prazo')].map(e => e.value);
    const pendencias = txts.map((t, i) => ({ txt: t, dono: donos[i], prazo: prazos[i] })).filter(p => p.txt);
    try {
      await api.request('/api/v3/gp/reunioes_formatos', { method: 'POST',
        body: { action: 'ata', formato_id: fid, decisoes: m.querySelector('#rp-dec').value, pendencias } });
      fecha(); load();
    } catch (e) { m.querySelector('#rp-err').textContent = e.message; }
  };
}

/* ─── v89.18 · criar / editar / remover reunião fixa (diretoria) ─────────── */
function abrirForm(f) {
  const novo = !f;
  f = f || { emoji: '📋', nome: '', dono: '', participantes: [], cadencia: { tipo: 'semanal', dias: [0] }, hora: '09:00', dur_min: 30, painel: '', painel_nome: '', pauta: [], obs: '' };
  const c = f.cadencia || { tipo: 'semanal', dias: [0] };
  const m = document.getElementById('rp-modal');
  const diaSel = (id, cur) => `<select class="input" id="${id}" style="width:auto">${DIAS.slice(0, 6).map((d, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${d}</option>`).join('')}</select>`;
  const lbl = t => `<label class="tiny muted" style="font-weight:600;margin-top:10px;display:block">${t}</label>`;
  m.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:640px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <b>${novo ? '➕ Nova reunião fixa' : '✏️ Editar reunião'}</b>
          <button class="btn btn-ghost btn-sm" id="rf-x">✕</button>
        </div>
        ${lbl('Nome da reunião')}
        <div class="flex gap-1"><input class="input" id="rf-emoji" value="${esc(f.emoji || '📋')}" style="width:56px;text-align:center">
          <input class="input" id="rf-nome" value="${esc(f.nome)}" placeholder="ex.: Semanal Comercial MAP" style="flex:1"></div>
        ${lbl('Quem conduz (dono) e quem participa')}
        <div class="flex gap-1" style="flex-wrap:wrap"><input class="input" id="rf-dono" value="${esc(f.dono)}" placeholder="Dono (ex.: Paulo)" style="flex:1;min-width:140px">
          <input class="input" id="rf-part" value="${esc((f.participantes || []).join(', '))}" placeholder="Participantes, separados por vírgula" style="flex:2;min-width:220px"></div>
        ${lbl('Quando acontece')}
        <div class="flex gap-1" style="flex-wrap:wrap;align-items:center">
          <select class="input" id="rf-tipo" style="width:auto">
            <option value="semanal" ${c.tipo === 'semanal' ? 'selected' : ''}>Toda semana</option>
            <option value="quinzenal" ${c.tipo === 'quinzenal' ? 'selected' : ''}>A cada 15 dias</option>
            <option value="mensal_nth" ${c.tipo === 'mensal_nth' ? 'selected' : ''}>Uma vez por mês (ex.: 2ª terça)</option>
            <option value="mensal_ultima" ${c.tipo === 'mensal_ultima' ? 'selected' : ''}>Na última semana do mês</option>
            <option value="mensal_dias" ${c.tipo === 'mensal_dias' ? 'selected' : ''}>Em dias fixos do mês (ex.: 10, 20 e último)</option>
            <option value="sob_demanda" ${c.tipo === 'sob_demanda' ? 'selected' : ''}>Quando precisar (sem data fixa)</option>
          </select>
          <span class="tiny muted">às</span><input class="input" id="rf-hora" type="time" value="${esc(f.hora || '09:00')}" style="width:auto">
          <span class="tiny muted">duração</span><input class="input" id="rf-dur" type="number" min="5" step="5" value="${f.dur_min || 30}" style="width:80px"><span class="tiny muted">min</span>
        </div>
        <div id="rf-cad" class="mt-1"></div>
        <label class="tiny" style="display:block;margin-top:8px"><input type="checkbox" id="rf-cal" ${f.calendario ? 'checked' : ''}>
          📅 Colocar no calendário de todos os participantes (House + Zoho, com convite)</label>
        <label class="tiny" style="display:block;margin-top:4px"><input type="checkbox" id="rf-semata" ${f.sem_ata ? 'checked' : ''}>
          🧱 É bloco de trabalho, não reunião: lembra e vai pro calendário, mas não cobra ata</label>
        ${lbl('Pauta — um item por linha')}
        <textarea class="input" id="rf-pauta" rows="5" style="width:100%" placeholder="Números da semana&#10;Travas&#10;Decisões">${esc((f.pauta || []).join('\n'))}</textarea>
        ${lbl('Painel aberto na tela durante a reunião (opcional)')}
        <div class="flex gap-1" style="flex-wrap:wrap"><input class="input" id="rf-pnome" value="${esc(f.painel_nome || '')}" placeholder="Nome (ex.: Farol PSM)" style="flex:1;min-width:160px">
          <input class="input" id="rf-painel" value="${esc(f.painel || '')}" placeholder="Tela (ex.: #/scorecard)" style="flex:1;min-width:160px"></div>
        ${lbl('Observação (opcional)')}
        <input class="input" id="rf-obs" value="${esc(f.obs || '')}" style="width:100%">
        <div id="rf-err" class="tiny" style="color:var(--err);margin-top:6px"></div>
        <div class="flex gap-2 mt-2" style="justify-content:space-between;align-items:center">
          ${novo ? '<span></span>' : '<button class="btn btn-ghost btn-sm" id="rf-del" style="color:var(--err)">🗑 Remover reunião</button>'}
          <div class="flex gap-2"><button class="btn btn-ghost" id="rf-cancel">Cancelar</button>
            <button class="btn btn-primary" id="rf-save">💾 Salvar</button></div>
        </div>
      </div>
    </div>`;
  const cadBox = () => {
    const t = m.querySelector('#rf-tipo').value;
    const box = m.querySelector('#rf-cad');
    if (t === 'semanal') box.innerHTML = `<div class="flex gap-2 tiny" style="flex-wrap:wrap">${DIAS.slice(0, 6).map((d, i) => `<label><input type="checkbox" class="rf-dia" value="${i}" ${(c.dias || []).includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}
      <label style="margin-left:8px"><input type="checkbox" id="rf-pula1" ${c.pular_1a ? 'checked' : ''}> não acontece na 1ª semana do mês</label></div>`;
    else if (t === 'quinzenal') box.innerHTML = `<span class="tiny muted">no dia</span> ${diaSel('rf-dia1', c.dia ?? 0)} <span class="tiny muted">começando em</span> <input class="input" type="date" id="rf-ref" value="${esc(c.ref || '')}" style="width:auto">`;
    else if (t === 'mensal_dias') box.innerHTML = `<span class="tiny muted">dias do mês</span> <input class="input" id="rf-dmes" value="${esc((c.dias_mes || [10, 20, 31]).map(n => +n >= 31 ? 'último' : n).join(', '))}" style="width:180px"> <span class="tiny muted">(escreva "último" pro último dia; sábado/domingo passa pra sexta antes)</span>`;
    else if (t === 'sob_demanda') box.innerHTML = '<span class="tiny muted">Sem data fixa: fica na agenda pra registrar a ata quando acontecer, sem lembrete nem cobrança.</span>';
    else if (t === 'mensal_nth') box.innerHTML = `<select class="input" id="rf-nth" style="width:auto">${[1, 2, 3, 4].map(n => `<option value="${n}" ${Number(c.nth || 1) === n ? 'selected' : ''}>${n}ª</option>`).join('')}</select> ${diaSel('rf-dia1', c.dia ?? 0)} <span class="tiny muted">do mês</span>`;
    else box.innerHTML = `<span class="tiny muted">no dia</span> ${diaSel('rf-dia1', c.dia ?? 0)}`;
  };
  cadBox();
  m.querySelector('#rf-tipo').onchange = cadBox;
  const fecha = () => { m.innerHTML = ''; };
  m.querySelector('#rf-x').onclick = fecha; m.querySelector('#rf-cancel').onclick = fecha;
  const envia = async (body, erro) => {
    try { await api.request('/api/v3/gp/reunioes_formatos', { method: 'POST', body }); fecha(); load(); }
    catch (e) { m.querySelector('#rf-err').textContent = erro + e.message; }
  };
  const del = m.querySelector('#rf-del');
  if (del) del.onclick = () => { if (confirm(`Remover "${f.nome}" da agenda? As atas antigas continuam no histórico.`)) envia({ action: 'del_formato', id: f.id }, ''); };
  m.querySelector('#rf-save').onclick = () => {
    const v = id => m.querySelector('#' + id)?.value?.trim() || '';
    const tipo = v('rf-tipo');
    let cad;
    if (tipo === 'semanal') cad = { tipo, dias: [...m.querySelectorAll('.rf-dia:checked')].map(x => +x.value), ...(m.querySelector('#rf-pula1')?.checked ? { pular_1a: true } : {}) };
    else if (tipo === 'quinzenal') cad = { tipo, dia: +v('rf-dia1'), ref: v('rf-ref') };
    else if (tipo === 'mensal_nth') cad = { tipo, dia: +v('rf-dia1'), nth: +v('rf-nth') };
    else if (tipo === 'mensal_dias') cad = { tipo, dias_mes: v('rf-dmes').split(/[,\s]+/).map(x => /[uú]lt/i.test(x) ? 31 : parseInt(x, 10)).filter(n => n >= 1 && n <= 31) };
    else if (tipo === 'sob_demanda') cad = { tipo };
    else cad = { tipo, dia: +v('rf-dia1') };
    const err = m.querySelector('#rf-err');
    if (!v('rf-nome')) return (err.textContent = 'Dê um nome à reunião.');
    if (!v('rf-dono')) return (err.textContent = 'Toda reunião tem um dono — quem conduz.');
    if (tipo === 'semanal' && !cad.dias.length) return (err.textContent = 'Escolha pelo menos um dia da semana.');
    if (tipo === 'mensal_dias' && !cad.dias_mes.length) return (err.textContent = 'Escreva pelo menos um dia do mês (ex.: 10, 20, último).');
    if (tipo === 'quinzenal' && !cad.ref) return (err.textContent = 'Diga a data da primeira reunião (para contar os 15 dias).');
    const pauta = v('rf-pauta').split('\n').map(x => x.trim()).filter(Boolean);
    if (!pauta.length) return (err.textContent = 'Toda reunião tem pauta — escreva pelo menos um item.');
    envia({ action: 'set_formato', formato: { ...f, emoji: v('rf-emoji') || '📋', nome: v('rf-nome'), dono: v('rf-dono'),
      participantes: v('rf-part').split(',').map(x => x.trim()).filter(Boolean), cadencia: cad, hora: v('rf-hora'),
      dur_min: +v('rf-dur') || 30, pauta, calendario: !!m.querySelector('#rf-cal')?.checked, sem_ata: !!m.querySelector('#rf-semata')?.checked, painel: v('rf-painel'), painel_nome: v('rf-pnome'), obs: v('rf-obs') } }, 'Erro: ');
  };
}
