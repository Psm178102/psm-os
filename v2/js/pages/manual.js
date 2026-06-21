/* PSM-OS v2 — Manual de Cultura (config-driven, editável pelo sócio) — v80.5 */
import { auth } from '../auth.js';
import { api } from '../api.js';

let _root = null, _m = null, _canEdit = false, _editing = false, _draft = null, _msg = '', _isDefault = false;

export async function pageManual(ctx, root) {
  _root = root; _editing = false; _msg = '';
  root.innerHTML = '<div class="card"><div class="muted tiny"><span class="spinner"></span> Carregando Manual de Cultura…</div></div>';
  try {
    const r = await api.request('/api/v3/cultura/manual');
    _m = (r && r.manual) || { missao: '', visao: '', valores: [], secoes: [] };
    _canEdit = !!(r && r.can_edit);
    _isDefault = !!(r && r.is_default);
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-warn">Erro ao carregar: ${escapeHtml(e.message)}</div></div>`;
    return;
  }
  render();
}

function esc(s) { return escapeHtml(s); }
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

/* ───────────────── VIEW ───────────────── */
function render() {
  const m = _m;
  const valores = m.valores || [], secoes = m.secoes || [];
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div>
          <h2 class="card-title">📖 Manual de Cultura PSM Imóveis</h2>
          <p class="card-sub">Valores, missão e visão que guiam a equipe PSM</p>
        </div>
        ${_canEdit ? '<button class="btn btn-primary btn-sm" id="man-edit">✏️ Editar Manual</button>' : ''}
      </div>

      ${_isDefault ? `<div class="alert" style="background:rgba(217,119,6,.10);border:1px solid rgba(217,119,6,.35);padding:10px 12px;border-radius:8px;margin-top:10px;font-size:12.5px">
        📌 <b>Base importada do Manual v2.0</b> — conteúdo real da PSM, porém desatualizado. ${_canEdit ? 'Clique em <b>✏️ Editar Manual</b> para revisar e atualizar para a 3.8.' : 'Em revisão para a versão 3.8.'}</div>` : ''}

      ${m.missao ? `<div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">🎯 Nossa Missão</h3>
        <p style="line-height:1.7">${nl2br(m.missao)}</p></div>` : ''}

      ${m.visao ? `<div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">👁 Nossa Visão</h3>
        <p style="line-height:1.7">${nl2br(m.visao)}</p></div>` : ''}

      ${valores.length ? `<div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">💛 Nossos Valores</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:10px">
          ${valores.map(v => `<div style="background:var(--bg-3);border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:28px;margin-bottom:6px">${esc(v.ico) || '•'}</div>
            <div style="font-weight:800;color:var(--psm-gold);font-size:13px">${esc(v.t)}</div>
            <div class="tiny muted mt-1">${esc(v.d)}</div></div>`).join('')}
        </div></div>` : ''}

      ${secoes.map(s => `<div class="mt-4">
        <h3 style="color:var(--psm-gold);font-size:15px;margin-bottom:8px">${esc(s.ico)} ${esc(s.titulo)}</h3>
        ${s.tipo === 'lista'
          ? `<ul style="list-style:none;padding:0;line-height:2">${(s.itens || []).map(i => `<li>✅ ${esc(i)}</li>`).join('')}</ul>`
          : `<p style="line-height:1.7">${nl2br(s.conteudo)}</p>`}
      </div>`).join('')}

      <div class="mt-4" style="background:linear-gradient(135deg, #0b1f3a 0%, #1e3a5f 100%);color:#fff;padding:24px;border-radius:12px;text-align:center">
        <div style="font-size:20px;font-weight:900;margin-bottom:6px">PSM Assessoria Imobiliária</div>
        <div style="font-size:13px;opacity:.8;max-width:500px;margin:0 auto">Transformamos sonhos em endereços. Cada negociação é uma oportunidade de impactar vidas com ética, excelência e resultado.</div>
      </div>

      <div class="mt-4 flex gap-2" style="flex-wrap:wrap">
        <button class="btn btn-primary" data-nav="/etica">⚖️ Ver Código de Ética →</button>
        <button class="btn btn-ghost" data-nav="/base">📚 Voltar pra Base de Conhecimento</button>
      </div>
    </div>`;
  const eb = document.getElementById('man-edit');
  if (eb) eb.onclick = () => { _editing = true; _draft = JSON.parse(JSON.stringify(_m)); renderEditor(); };
  _root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.nav; }));
}

/* ───────────────── EDITOR (sócio) ───────────────── */
function renderEditor() {
  const d = _draft;
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <h2 class="card-title">✏️ Editar Manual de Cultura</h2>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" id="man-cancel">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="man-save">💾 Salvar</button>
        </div>
      </div>
      <div class="tiny muted" id="man-msg" style="margin-bottom:8px">${esc(_msg)}</div>

      <label class="tiny muted" style="font-weight:800">🎯 Missão</label>
      <textarea class="input" data-m="missao" rows="3" style="width:100%;margin:4px 0 12px">${esc(d.missao)}</textarea>

      <label class="tiny muted" style="font-weight:800">👁 Visão</label>
      <textarea class="input" data-m="visao" rows="3" style="width:100%;margin:4px 0 12px">${esc(d.visao)}</textarea>

      <div class="flex items-center" style="justify-content:space-between;margin:6px 0">
        <label class="tiny muted" style="font-weight:800">💛 Valores</label>
        <button class="btn btn-ghost btn-sm" id="man-add-valor">+ valor</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px">
        ${(d.valores || []).map((v, i) => `<div style="background:var(--bg-3);border-radius:8px;padding:8px">
          <div class="flex gap-1" style="margin-bottom:4px">
            <input class="input" data-v-ico="${i}" value="${esc(v.ico)}" placeholder="🎯" style="width:48px;text-align:center">
            <input class="input" data-v-t="${i}" value="${esc(v.t)}" placeholder="Título" style="flex:1">
            <button class="btn btn-ghost btn-sm" data-v-del="${i}">✕</button>
          </div>
          <input class="input" data-v-d="${i}" value="${esc(v.d)}" placeholder="Descrição" style="width:100%">
        </div>`).join('')}
      </div>

      <div class="flex items-center" style="justify-content:space-between;margin:16px 0 6px">
        <label class="tiny muted" style="font-weight:800">📑 Seções (pilares, carreira, rituais, regras…)</label>
        <div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" id="man-add-texto">+ seção texto</button>
          <button class="btn btn-ghost btn-sm" id="man-add-lista">+ seção lista</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${(d.secoes || []).map((s, j) => `<div style="background:var(--bg-3);border-radius:8px;padding:10px">
          <div class="flex gap-1" style="margin-bottom:6px;align-items:center">
            <input class="input" data-s-ico="${j}" value="${esc(s.ico)}" placeholder="🏢" style="width:48px;text-align:center">
            <input class="input" data-s-titulo="${j}" value="${esc(s.titulo)}" placeholder="Título da seção" style="flex:1">
            <span class="tiny muted">${s.tipo === 'lista' ? '• lista' : '¶ texto'}</span>
            <button class="btn btn-ghost btn-sm" data-s-up="${j}" ${j === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-ghost btn-sm" data-s-down="${j}" ${j === d.secoes.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn btn-ghost btn-sm" data-s-del="${j}">✕</button>
          </div>
          ${s.tipo === 'lista'
            ? `<textarea class="input" data-s-itens="${j}" rows="${Math.max(3, (s.itens || []).length + 1)}" placeholder="Um item por linha" style="width:100%">${esc((s.itens || []).join('\n'))}</textarea>`
            : `<textarea class="input" data-s-cont="${j}" rows="4" placeholder="Conteúdo da seção" style="width:100%">${esc(s.conteudo)}</textarea>`}
        </div>`).join('')}
      </div>
    </div>`;
  wireEditor();
}

function syncDraft() {
  const d = _draft, q = sel => _root.querySelector(sel), qa = sel => _root.querySelectorAll(sel);
  const mm = q('[data-m="missao"]'); if (mm) d.missao = mm.value;
  const mv = q('[data-m="visao"]'); if (mv) d.visao = mv.value;
  (d.valores || []).forEach((v, i) => {
    const ico = q(`[data-v-ico="${i}"]`), t = q(`[data-v-t="${i}"]`), de = q(`[data-v-d="${i}"]`);
    if (ico) v.ico = ico.value; if (t) v.t = t.value; if (de) v.d = de.value;
  });
  (d.secoes || []).forEach((s, j) => {
    const ico = q(`[data-s-ico="${j}"]`), tit = q(`[data-s-titulo="${j}"]`);
    if (ico) s.ico = ico.value; if (tit) s.titulo = tit.value;
    if (s.tipo === 'lista') { const ta = q(`[data-s-itens="${j}"]`); if (ta) s.itens = ta.value.split('\n').map(x => x.trim()).filter(Boolean); }
    else { const ta = q(`[data-s-cont="${j}"]`); if (ta) s.conteudo = ta.value; }
  });
}

function wireEditor() {
  const d = _draft;
  document.getElementById('man-cancel').onclick = () => { _editing = false; render(); };
  document.getElementById('man-save').onclick = saveManual;
  document.getElementById('man-add-valor').onclick = () => { syncDraft(); (d.valores = d.valores || []).push({ ico: '⭐', t: '', d: '' }); renderEditor(); };
  document.getElementById('man-add-texto').onclick = () => { syncDraft(); (d.secoes = d.secoes || []).push({ id: 'sec' + Date.now(), ico: '📌', titulo: '', tipo: 'texto', conteudo: '', itens: [] }); renderEditor(); };
  document.getElementById('man-add-lista').onclick = () => { syncDraft(); (d.secoes = d.secoes || []).push({ id: 'sec' + Date.now(), ico: '📋', titulo: '', tipo: 'lista', conteudo: '', itens: [] }); renderEditor(); };
  _root.querySelectorAll('[data-v-del]').forEach(b => b.onclick = () => { syncDraft(); d.valores.splice(+b.dataset.vDel, 1); renderEditor(); });
  _root.querySelectorAll('[data-s-del]').forEach(b => b.onclick = () => { syncDraft(); d.secoes.splice(+b.dataset.sDel, 1); renderEditor(); });
  _root.querySelectorAll('[data-s-up]').forEach(b => b.onclick = () => { const j = +b.dataset.sUp; if (j > 0) { syncDraft(); const a = d.secoes; [a[j - 1], a[j]] = [a[j], a[j - 1]]; renderEditor(); } });
  _root.querySelectorAll('[data-s-down]').forEach(b => b.onclick = () => { const j = +b.dataset.sDown; if (j < d.secoes.length - 1) { syncDraft(); const a = d.secoes; [a[j + 1], a[j]] = [a[j], a[j + 1]]; renderEditor(); } });
}

async function saveManual() {
  syncDraft();
  _msg = '⏳ salvando…';
  const m = document.getElementById('man-msg'); if (m) m.textContent = _msg;
  try {
    const r = await api.request('/api/v3/cultura/manual', { method: 'POST', body: { manual: _draft } });
    if (r && r.ok) { _m = r.manual; _editing = false; render(); }
    else { _msg = '⚠️ ' + ((r && r.error) || 'erro'); const mm = document.getElementById('man-msg'); if (mm) mm.textContent = _msg; }
  } catch (e) { _msg = '⚠️ ' + e.message; const mm = document.getElementById('man-msg'); if (mm) mm.textContent = _msg; }
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
