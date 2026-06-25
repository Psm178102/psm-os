/* ============================================================================
   PSM-OS v2 — 📚 Scripts & Cadências (playbook de vendas) — v81.19
   Organizado por LINHA (M.A.P, Conquista, MCMV, Locação…) → ETAPA do funil.
   Cada linha tem sua própria linguagem/estratégia. Todos veem (corretores também);
   gestão (lvl≥5) edita. Conteúdo livre (regras, scripts, cadência, gatilhos).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _linhas = [], _canEdit = false;
let _selL = 0, _selE = 0, _edit = false, _busy = false, _msg = '';

export async function pageScripts(ctx, root) {
  _root = root; _selL = 0; _selE = 0; _edit = false; _msg = '';
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando playbook…</div></div>';
  try {
    const r = await api.request('/api/v3/scripts/playbook');
    _linhas = r.linhas || []; _canEdit = !!r.can_edit;
    // Corretor PSM Conquista só consulta a linha MCMV (as outras ficam ocultas). v81.61
    if ((auth.user()?.role || '').toLowerCase() === 'corretor_conquista') {
      _linhas = _linhas.filter(l => /mcmv/i.test(l.nome || ''));
      _canEdit = false;
    }
  } catch (e) { _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return; }
  render();
}

const SWATCHES = ['#5b7fb4', '#dc2626', '#16a34a', '#d4a843', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#475569'];

function render() {
  if (_selL >= _linhas.length) _selL = 0;
  const L = _linhas[_selL];
  const etapas = (L?.etapas || []);
  if (_selE >= etapas.length) _selE = 0;
  const E = etapas[_selE];
  const cor = L?.cor || '#5b7fb4';
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">📚 Scripts & Cadências</h2>
          <p class="card-sub" style="margin:2px 0 0">Playbook por linha → etapa do funil. Cada linha tem sua estratégia e linguagem.${_canEdit ? ' Você edita; todos consultam.' : ''}</p>
        </div>
        ${_canEdit ? `<div class="flex gap-2">
          ${_edit ? `<button class="btn btn-ghost btn-sm" id="sc-cancel">Cancelar</button><button class="btn btn-primary btn-sm" id="sc-save" ${_busy ? 'disabled' : ''}>${_busy ? '⏳' : '💾'} Salvar</button>`
            : `<button class="btn btn-ghost btn-sm" id="sc-edit">✏️ Editar</button>`}
        </div>` : ''}
      </div>
      <div id="sc-msg" class="tiny" style="margin:4px 0;min-height:14px;color:${_msg[0] === '⚠' ? '#dc2626' : '#16a34a'}">${esc(_msg)}</div>

      <!-- LINHAS -->
      <div class="flex gap-2" style="flex-wrap:wrap;border-bottom:2px solid var(--border);padding-bottom:8px;margin-top:6px">
        ${_linhas.map((l, i) => `<button class="btn btn-sm ${i === _selL ? '' : 'btn-ghost'}" data-l="${i}" style="${i === _selL ? `background:${l.cor || '#5b7fb4'};color:#fff;border-color:${l.cor || '#5b7fb4'}` : ''}">
          ${esc(l.nome)} <span class="tiny" style="opacity:.7">(${(l.etapas || []).length})</span></button>`).join('')}
        ${_edit ? '<button class="btn btn-ghost btn-sm" id="sc-newl">➕ Linha</button>' : ''}
      </div>

      ${!_linhas.length ? `<div class="muted tiny" style="padding:30px;text-align:center">Nenhuma linha ainda${_canEdit ? ' — clique em ➕ Linha.' : '.'}</div>` : `
      ${_edit ? linhaEditBar(L, cor) : ''}
      <div style="display:grid;grid-template-columns:260px 1fr;gap:14px;margin-top:12px" class="sc-grid">
        <!-- ETAPAS -->
        <div style="border-right:1px solid var(--border);padding-right:10px">
          <div class="tiny muted" style="font-weight:800;text-transform:uppercase;margin-bottom:6px">Etapas</div>
          <div style="display:grid;gap:4px">
            ${etapas.map((e, i) => `<div class="flex gap-1" style="align-items:center">
              <button class="btn btn-sm ${i === _selE ? '' : 'btn-ghost'}" data-e="${i}" style="flex:1;text-align:left;${i === _selE ? `background:${cor};color:#fff;border-color:${cor}` : ''}">${esc(e.nome)}</button>
              ${_edit ? `<button class="btn btn-ghost btn-sm" data-eup="${i}" ${i === 0 ? 'disabled' : ''} style="padding:2px 5px">↑</button><button class="btn btn-ghost btn-sm" data-edn="${i}" ${i === etapas.length - 1 ? 'disabled' : ''} style="padding:2px 5px">↓</button><button class="btn btn-ghost btn-sm" data-edel="${i}" style="padding:2px 5px;color:#dc2626">✕</button>` : ''}
            </div>`).join('')}
            ${_edit ? '<button class="btn btn-ghost btn-sm" id="sc-newe" style="margin-top:4px">➕ Etapa</button>' : ''}
          </div>
        </div>
        <!-- CONTEÚDO -->
        <div style="min-width:0">
          ${E ? (_edit ? `
            <input class="input" id="sc-ename" value="${esc(E.nome)}" placeholder="Nome da etapa" style="font-weight:700;margin-bottom:8px">
            <textarea class="input" id="sc-cont" rows="22" style="width:100%;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.5" placeholder="Regras, scripts, cadência, gatilhos…">${esc(E.conteudo || '')}</textarea>
            <div class="tiny muted" style="margin-top:4px">Dica: LINHAS EM MAIÚSCULAS viram títulos · **negrito** · - listas.</div>`
            : `<div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                 <h3 style="margin:0;font-size:17px;border-left:4px solid ${cor};padding-left:8px">${esc(E.nome)}</h3>
                 <button class="btn btn-ghost btn-sm" data-copy="1">📋 Copiar</button>
               </div>
               <div id="sc-view" style="max-height:70vh;overflow:auto;font-size:13.5px;padding:4px 2px">${mdHTML(E.conteudo || '')}</div>`)
          : '<div class="muted tiny" style="padding:20px">Sem etapa selecionada.</div>'}
        </div>
      </div>`}
    </div>
    <style>@media(max-width:760px){.sc-grid{grid-template-columns:1fr !important}.sc-grid>div:first-child{border-right:0;border-bottom:1px solid var(--border);padding-bottom:8px}}</style>`;
  wire(E);
}

function linhaEditBar(L, cor) {
  return `<div class="flex gap-2 mt-2" style="align-items:center;flex-wrap:wrap;background:var(--bg-3);border-radius:8px;padding:8px 10px">
    <span class="tiny muted" style="font-weight:800">Linha:</span>
    <input class="input" id="sc-lname" value="${esc(L.nome)}" style="height:30px;width:200px;font-size:13px">
    <span class="tiny muted" style="font-weight:800">🎨</span>
    ${SWATCHES.map(s => `<button data-lcor="${s}" title="${s}" style="width:20px;height:20px;border-radius:5px;background:${s};border:2px solid ${(L.cor || '') === s ? '#111' : 'transparent'};cursor:pointer"></button>`).join('')}
    <input type="color" id="sc-lcor" value="${esc(L.cor || cor)}" style="width:30px;height:26px;padding:0;border:0;background:none;cursor:pointer">
    <button class="btn btn-ghost btn-sm" data-lup="1" ${_selL === 0 ? 'disabled' : ''}>↑</button>
    <button class="btn btn-ghost btn-sm" data-ldn="1" ${_selL === _linhas.length - 1 ? 'disabled' : ''}>↓</button>
    <button class="btn btn-ghost btn-sm" id="sc-ldel" style="color:#dc2626">🗑 excluir linha</button>
  </div>`;
}

function wire(E) {
  const $ = id => _root.querySelector('#' + id);
  _root.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { _selL = +b.dataset.l; _selE = 0; render(); });
  _root.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { _selE = +b.dataset.e; render(); });
  const cp = _root.querySelector('[data-copy]'); if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(E.conteudo || ''); cp.textContent = '✅ Copiado'; setTimeout(() => cp.textContent = '📋 Copiar', 1500); } catch {} };

  if ($('sc-edit')) $('sc-edit').onclick = () => { _edit = true; render(); };
  if ($('sc-cancel')) $('sc-cancel').onclick = () => pageScripts(null, _root);
  if ($('sc-save')) $('sc-save').onclick = salvar;

  // edição estrutural
  if ($('sc-newl')) $('sc-newl').onclick = () => { _linhas.push({ id: 'l_' + Date.now(), nome: 'Nova linha', cor: '#475569', ordem: _linhas.length, etapas: [] }); _selL = _linhas.length - 1; _selE = 0; render(); };
  if ($('sc-newe')) $('sc-newe').onclick = () => { syncContent(); _linhas[_selL].etapas.push({ id: 'et_' + Date.now(), nome: 'Nova etapa', ordem: _linhas[_selL].etapas.length, conteudo: '' }); _selE = _linhas[_selL].etapas.length - 1; render(); };
  if ($('sc-ldel')) $('sc-ldel').onclick = () => { if (confirm('Excluir a linha "' + _linhas[_selL].nome + '" e todas as suas etapas?')) { _linhas.splice(_selL, 1); _selL = 0; _selE = 0; render(); } };

  // rename/cor linha (atualiza modelo, sem re-render por tecla)
  if ($('sc-lname')) $('sc-lname').addEventListener('input', e => { _linhas[_selL].nome = e.target.value; });
  _root.querySelectorAll('[data-lcor]').forEach(b => b.onclick = () => { _linhas[_selL].cor = b.dataset.lcor; render(); });
  if ($('sc-lcor')) $('sc-lcor').addEventListener('input', e => { _linhas[_selL].cor = e.target.value; });
  const lup = _root.querySelector('[data-lup]'); if (lup) lup.onclick = () => { swap(_linhas, _selL, _selL - 1); _selL--; render(); };
  const ldn = _root.querySelector('[data-ldn]'); if (ldn) ldn.onclick = () => { swap(_linhas, _selL, _selL + 1); _selL++; render(); };

  // etapa rename/conteudo
  if ($('sc-ename')) $('sc-ename').addEventListener('input', e => { _linhas[_selL].etapas[_selE].nome = e.target.value; });
  if ($('sc-cont')) $('sc-cont').addEventListener('input', e => { _linhas[_selL].etapas[_selE].conteudo = e.target.value; });
  _root.querySelectorAll('[data-eup]').forEach(b => b.onclick = () => { syncContent(); const i = +b.dataset.eup; swap(_linhas[_selL].etapas, i, i - 1); if (_selE === i) _selE--; else if (_selE === i - 1) _selE++; render(); });
  _root.querySelectorAll('[data-edn]').forEach(b => b.onclick = () => { syncContent(); const i = +b.dataset.edn; swap(_linhas[_selL].etapas, i, i + 1); if (_selE === i) _selE++; else if (_selE === i + 1) _selE--; render(); });
  _root.querySelectorAll('[data-edel]').forEach(b => b.onclick = () => { const i = +b.dataset.edel; if (confirm('Excluir a etapa "' + _linhas[_selL].etapas[i].nome + '"?')) { _linhas[_selL].etapas.splice(i, 1); _selE = 0; render(); } });
}

function syncContent() {
  const c = _root.querySelector('#sc-cont'); if (c && _linhas[_selL]?.etapas[_selE]) _linhas[_selL].etapas[_selE].conteudo = c.value;
  const n = _root.querySelector('#sc-ename'); if (n && _linhas[_selL]?.etapas[_selE]) _linhas[_selL].etapas[_selE].nome = n.value;
  const ln = _root.querySelector('#sc-lname'); if (ln && _linhas[_selL]) _linhas[_selL].nome = ln.value;
}

async function salvar() {
  if (_busy) return;
  syncContent();
  _busy = true; _msg = ''; render();
  try {
    const r = await api.request('/api/v3/scripts/playbook', { method: 'POST', body: { linhas: _linhas } });
    _linhas = r.linhas || _linhas; _busy = false; _edit = false; _msg = '💾 salvo.'; render();
  } catch (e) { _busy = false; _msg = '⚠️ ' + e.message; render(); }
}

function swap(arr, i, j) { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }

/* markdown leve: MAIÚSCULAS→título · **negrito** · - listas */
function mdHTML(s) {
  let t = esc(s || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = []; let inList = false;
  const flush = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of t.split('\n')) {
    const l = raw.trim();
    if (!l) { flush(); out.push('<div style="height:7px"></div>'); continue; }
    if (/^#{1,3}\s/.test(l)) { flush(); out.push(`<div style="font-weight:800;font-size:15px;margin:10px 0 4px;color:var(--psm-gold,#b8860b)">${l.replace(/^#{1,3}\s/, '')}</div>`); continue; }
    const plain = l.replace(/<\/?b>/g, '');
    if (plain.length <= 70 && plain === plain.toUpperCase() && /[A-ZÀ-Ý]/.test(plain) && !/[.:;,?]$/.test(plain)) {
      flush(); out.push(`<div style="font-weight:800;font-size:13.5px;letter-spacing:.4px;margin:13px 0 5px;color:var(--psm-gold,#b8860b)">${l}</div>`); continue;
    }
    if (/^[-•▸*]\s+/.test(l)) { if (!inList) { out.push('<ul style="margin:2px 0 4px 18px;padding:0">'); inList = true; } out.push(`<li style="margin:2px 0;line-height:1.45">${l.replace(/^[-•▸*]\s+/, '')}</li>`); continue; }
    flush(); out.push(`<div style="margin:3px 0;line-height:1.5">${l}</div>`);
  }
  flush();
  return out.join('');
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
