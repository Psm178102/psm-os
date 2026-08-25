/* PSM-OS v2 — 📋 Formatos de Reunião (rotina v2.3) — v84.99
   Cards de formato (pauta fixa, participantes, cadência, dono, painel-fonte),
   ata rápida (pendência sem dono+prazo NÃO existe), lembrete automático por
   alçada (heartbeat) e histórico de atas. Regras universais no topo. */
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
  if (c.tipo === 'semanal') return (c.dias || []).length === 5 ? 'seg–sex' : (c.dias || []).map(d => DIAS[d]).join('/');
  if (c.tipo === 'quinzenal') return `quinzenal (${DIAS[c.dia]})`;
  if (c.tipo === 'mensal_nth') return `${c.nth}ª ${DIAS[c.dia]} do mês`;
  if (c.tipo === 'mensal_ultima') return `última semana (${DIAS[c.dia]})`;
  return '—';
}

function cargaSemanal(formatos) {
  // minutos/semana aproximados por formato (quinzenal=0.5x, mensal=0.25x)
  let tot = 0;
  formatos.forEach(f => {
    const c = f.cadencia || {}; const d = f.dur_min || 30;
    if (c.tipo === 'semanal') tot += d * (c.dias || []).length;
    else if (c.tipo === 'quinzenal') tot += d / 2;
    else tot += d / 4.3;
  });
  return Math.round(tot);
}

function render() {
  const fs = _d.formatos || [];
  const pend = _d.pendencias_abertas || [];
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <b style="font-size:16px">📋 Formatos de Reunião</b>
        <span class="tiny" style="background:var(--psm-navy);color:#fffbea;border-radius:999px;padding:3px 12px;font-weight:700">carga total ≈ ${cargaSemanal(fs)} min/semana (todas as cadeiras)</span>
      </div>
      <div class="alert" style="background:var(--bg-3);border:none;font-size:12px;margin-top:8px;line-height:1.6">
        <b>Regras universais:</b> toda reunião tem <b>DONO, PAUTA FIXA e PAINEL ABERTO NA TELA</b> (dado, não opinião) ·
        começa e termina no horário · ata de 3 linhas no ato · <b>pendência sem dono+prazo não existe</b> ·
        reunião sem painel/pauta = cancelada. <span class="muted">Anti-inflação: formato novo só entra se outro sair ou justificar contra a carga acima.</span>
      </div>
      ${pend.length ? `<div class="card" style="margin:10px 0 0;background:#dc26260d;border:1px solid #dc262633">
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
              <span class="tiny" style="background:var(--bg-3);border-radius:999px;padding:2px 9px;font-weight:700;white-space:nowrap">${cadenciaTxt(f)} · ${esc(f.hora)} · ${f.dur_min}min</span>
            </div>
            <div class="tiny muted" style="margin-top:4px">👑 ${esc(f.dono)} · 👥 ${(f.participantes || []).map(esc).join(', ')}${(f.papeis || []).length ? ' + ' + f.papeis.map(p => p === '*' ? 'empresa inteira' : esc(p)).join(', ') : ''}${f.obs ? ` · <i>${esc(f.obs)}</i>` : ''}</div>
            <div class="tiny" style="margin-top:4px">🖥 Painel: <a href="${esc(f.painel)}" style="color:var(--info)">${esc(f.painel_nome)}</a></div>
            <ol class="tiny" style="margin:6px 0 0 16px;line-height:1.5">${(f.pauta || []).map(p => `<li>${esc(p)}</li>`).join('')}</ol>
            ${_d.pode_ata ? `<button class="btn btn-primary btn-sm mt-2 rp-ata" data-f="${esc(f.id)}">📝 Registrar reunião</button>` : ''}
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
        <label class="tiny muted" style="font-weight:700;margin-top:8px;display:block">Decisões (3 linhas, no ato)</label>
        <textarea id="rp-dec" class="input" rows="3" style="width:100%" placeholder="O que foi DECIDIDO — dado, não opinião…"></textarea>
        <label class="tiny muted" style="font-weight:700;margin-top:8px;display:block">Pendências <span style="color:var(--err)">(sem dono+prazo não existe)</span></label>
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
