/* ============================================================================
   PSM-OS v2 — Editor de Menu (v77.62 · organizar v81.48)
   Só sócio (lvl>=10). Duas abas:
   • ✏️ Renomear — troca nome/ícone de itens + título de seção (menu_labels).
   • 🗂 Organizar — move item entre seções + reordena itens/seções (menu_layout).
   Tudo vale p/ TODOS os usuários. Organizar NÃO mexe em permissão (quem vê segue
   na matriz por papel) — só na posição visual.
============================================================================ */
import { auth } from '../auth.js';
import { enumerateMenu, saveMenuLabels, enumerateMenuFull, saveMenuLayout } from '../menu-labels.js';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let _tab = 'rename';

export async function pageConfigMenu(ctx, root) {
  const me = auth.user();
  if ((me?.lvl || 0) < 10) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Só o sócio (lvl ≥ 10) pode editar o menu.</div>';
    return;
  }
  root.innerHTML = `
    <style>
      .cm-group{margin-bottom:14px;padding:10px 14px}
      .cm-row{display:grid;grid-template-columns:1fr 300px;gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#eef0f3)}
      .cm-row:last-child{border-bottom:none}
      .cm-sec-row{background:var(--bg-1,#f8fafc);margin:0 -14px;padding:9px 14px;border-radius:8px}
      .cm-def{font-size:13.5px;color:var(--ink,#111)}
      .cm-curico{font-size:15px}
      .cm-route{font-size:11px;color:var(--ink-muted,#94a3b8);margin-left:6px;font-family:ui-monospace,monospace}
      .cm-edit{display:flex;gap:8px;align-items:center}
      .cm-edit .input{min-width:0;flex:1}
      .cm-ico{flex:0 0 56px !important;width:56px;text-align:center;font-size:16px}
      .cm-inp{width:100%}
      .cm-bar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:flex-end;
              background:var(--bg-2,#fff);border-top:1px solid var(--border,#e5e7eb);padding:12px;margin-top:8px;z-index:5}
      .cm-msg{margin-right:auto;font-size:13px}
      .cm-tab{background:none;border:none;padding:9px 16px;cursor:pointer;font-weight:800;font-size:14px;border-bottom:3px solid transparent;color:var(--ink-muted,#64748b)}
      .cm-tab.on{border-bottom-color:var(--psm-gold,#c79a3a);color:var(--ink,#0f172a)}
      .og-sec{margin-bottom:12px;padding:8px 12px;border:1px solid rgba(148,163,184,.2);border-radius:10px}
      .og-sechd{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;padding:4px 0 8px;border-bottom:1px dashed rgba(148,163,184,.25);margin-bottom:6px}
      .og-item{display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:7px}
      .og-item:hover{background:var(--bg-3,#f1f5f9)}
      .og-item .lbl{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .og-mini{background:none;border:1px solid rgba(148,163,184,.3);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;flex:0 0 auto}
      .og-mini:disabled{opacity:.3;cursor:default}
      .og-grip{cursor:grab;color:var(--ink-muted,#94a3b8);font-size:15px;padding:0 4px;flex:0 0 auto;user-select:none;line-height:1}
      .og-grip:active{cursor:grabbing}
      .og-dragging{opacity:.45}
      .og-over{outline:2px dashed var(--psm-gold,#c79a3a);outline-offset:-2px;background:rgba(199,154,58,.08)}
      .og-sel{font-size:12px;max-width:190px}
      @media(max-width:640px){.cm-row{grid-template-columns:1fr;gap:4px}.og-sel{max-width:130px}}
    </style>
    <div class="card" style="margin-bottom:12px;padding:6px 8px;display:flex;gap:2px;flex-wrap:wrap">
      <button class="cm-tab ${_tab === 'rename' ? 'on' : ''}" data-cmtab="rename">✏️ Renomear</button>
      <button class="cm-tab ${_tab === 'org' ? 'on' : ''}" data-cmtab="org">🗂 Organizar</button>
    </div>
    <div id="cm-body"></div>`;
  root.querySelectorAll('[data-cmtab]').forEach(b => b.onclick = () => { _tab = b.dataset.cmtab; route(root); });
  route(root);
}

function route(root) {
  root.querySelectorAll('.cm-tab').forEach(b => b.classList.toggle('on', b.dataset.cmtab === _tab));
  const body = root.querySelector('#cm-body');
  if (_tab === 'org') return renderOrganize(body);
  return renderRename(body);
}

/* ─────────────── ABA RENOMEAR (comportamento original) ─────────────── */
function renderRename(body) {
  const groups = enumerateMenu();
  if (!groups.length) { body.innerHTML = '<div class="alert alert-warn">Menu ainda não carregou. Recarregue a página.</div>'; return; }
  const secHtml = groups.map(g => {
    const secInput = g.secKey ? `
      <div class="cm-row cm-sec-row">
        <div class="cm-def">📂 Seção · <b>${esc(g.secDef)}</b></div>
        <input class="input cm-inp" data-key="${esc(g.secKey)}" data-def="${esc(g.secDef)}"
               value="${esc(g.secCurrent !== g.secDef ? g.secCurrent : '')}" placeholder="${esc(g.secDef)}"></div>` : '';
    const items = g.items.map(it => `
      <div class="cm-row">
        <div class="cm-def"><span class="cm-curico">${esc(it.ico)}</span> ${esc(it.def)} <span class="cm-route">${esc(it.nav)}</span></div>
        <div class="cm-edit">
          <input class="input cm-inp cm-ico" data-key="ico:${esc(it.nav)}" data-def="${esc(it.defico)}"
                 value="${esc(it.ico !== it.defico ? it.ico : '')}" placeholder="${esc(it.defico)}" maxlength="16" title="Ícone (emoji)">
          <input class="input cm-inp" data-key="${esc(it.nav)}" data-def="${esc(it.def)}"
                 value="${esc(it.current !== it.def ? it.current : '')}" placeholder="${esc(it.def)}" title="Nome do item">
        </div>
      </div>`).join('');
    return `<div class="card cm-group">${secInput}${items}</div>`;
  }).join('');
  body.innerHTML = `
    <div class="card" style="margin-bottom:14px"><p class="muted" style="margin:0;font-size:13px">
      Renomeie itens, troque o <b>ícone</b> (cole um emoji no campo esquerdo) e os títulos de seção. Em branco = padrão. Vale p/ todos.</p></div>
    ${secHtml}
    <div class="cm-bar"><span class="cm-msg muted" id="cm-msg"></span>
      <button class="btn" id="cm-reset">Restaurar nomes</button>
      <button class="btn btn-primary" id="cm-save">Salvar nomes</button></div>`;
  const msg = body.querySelector('#cm-msg');
  const collect = () => { const map = {}; body.querySelectorAll('.cm-inp').forEach(inp => { const v = (inp.value || '').trim(); if (v && v !== inp.dataset.def) map[inp.dataset.key] = v; }); return map; };
  const doSave = async (map, okText) => {
    const btn = body.querySelector('#cm-save'); const orig = btn.textContent; btn.disabled = true; btn.textContent = '…'; msg.textContent = '';
    try {
      const r = await saveMenuLabels(map);
      if (!r || !r.ok) throw new Error((r && r.error) || 'falha ao salvar');
      btn.textContent = '✓ ' + (okText || 'Salvo'); msg.style.color = 'var(--ok,#16a34a)'; msg.textContent = 'Aplicado na barra ao lado.';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1400);
    } catch (e) { btn.textContent = '✕ Erro'; msg.style.color = 'var(--err,#dc2626)'; msg.textContent = e.message; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2200); }
  };
  body.querySelector('#cm-save').addEventListener('click', () => doSave(collect(), 'Salvo'));
  body.querySelector('#cm-reset').addEventListener('click', () => {
    if (!confirm('Restaurar TODOS os nomes do menu para o padrão?')) return;
    body.querySelectorAll('.cm-inp').forEach(inp => { inp.value = ''; }); doSave({}, 'Restaurado');
  });
}

/* ─────────────── ABA ORGANIZAR (mover / reordenar) ─────────────── */
let _model = null;   // [{id, name, items:[{nav,label,ico}]}] — modelo de trabalho
let _drag = null;    // estado do drag-and-drop {kind:'item'|'sec', si, ii}

function renderOrganize(body) {
  if (!_model) _model = enumerateMenuFull();
  if (!_model.length) { body.innerHTML = '<div class="alert alert-warn">Menu ainda não carregou. Recarregue a página.</div>'; return; }
  const secOpts = _model.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  const secsHtml = _model.map((sec, si) => `
    <div class="og-sec" data-si="${si}">
      <div class="og-sechd">
        <button class="og-mini" data-secup="${si}" ${si === 0 ? 'disabled' : ''} title="Subir seção">▲</button>
        <button class="og-mini" data-secdn="${si}" ${si === _model.length - 1 ? 'disabled' : ''} title="Descer seção">▼</button>
        <span class="og-grip" data-gsec="${si}" draggable="true" title="Arrastar seção">⠿</span>
        <span style="flex:1">${esc(sec.name)}</span>
        <span class="tiny muted">${sec.items.length} item(s)</span>
      </div>
      ${sec.items.length ? sec.items.map((it, ii) => `
        <div class="og-item" data-it="${si}:${ii}">
          <span class="og-grip" data-git="${si}:${ii}" draggable="true" title="Arrastar item">⠿</span>
          <button class="og-mini" data-up="${si}:${ii}" ${ii === 0 ? 'disabled' : ''} title="Subir">▲</button>
          <button class="og-mini" data-dn="${si}:${ii}" ${ii === sec.items.length - 1 ? 'disabled' : ''} title="Descer">▼</button>
          <span class="lbl">${esc(it.ico)} ${esc(it.label)}</span>
          <select class="select og-sel" data-mv="${si}:${ii}" title="Mover para seção">${
            _model.map(s => `<option value="${esc(s.id)}"${s.id === sec.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>`).join('') : '<div class="tiny muted" style="padding:6px 4px">— vazia —</div>'}
    </div>`).join('');
  body.innerHTML = `
    <div class="card" style="margin-bottom:12px"><p class="muted" style="margin:0;font-size:13px">
      Reorganize o menu: <b>arraste pelo punho ⠿</b> (itens e seções) <b>ou</b> use as setas <b>▲▼</b>. Pra jogar um item em outra seção também dá pelo seletor <b>"mover para"</b> (ex.: Diretoria → Locação).
      Lembre de clicar em <b>Salvar organização</b>. É só <b>posição visual</b> — quem vê cada item continua na matriz <i>Permissões por papel</i>.</p></div>
    ${secsHtml}
    <div class="cm-bar"><span class="cm-msg muted" id="og-msg"></span>
      <button class="btn" id="og-reset">Restaurar organização</button>
      <button class="btn btn-primary" id="og-save">Salvar organização</button></div>`;

  const rerender = () => renderOrganize(body);
  // reordenar item
  body.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const [si, ii] = b.dataset.up.split(':').map(Number); const a = _model[si].items; [a[ii - 1], a[ii]] = [a[ii], a[ii - 1]]; rerender(); });
  body.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const [si, ii] = b.dataset.dn.split(':').map(Number); const a = _model[si].items; [a[ii + 1], a[ii]] = [a[ii], a[ii + 1]]; rerender(); });
  // reordenar seção
  body.querySelectorAll('[data-secup]').forEach(b => b.onclick = () => { const si = +b.dataset.secup; [_model[si - 1], _model[si]] = [_model[si], _model[si - 1]]; rerender(); });
  body.querySelectorAll('[data-secdn]').forEach(b => b.onclick = () => { const si = +b.dataset.secdn; [_model[si + 1], _model[si]] = [_model[si], _model[si + 1]]; rerender(); });
  // mover item p/ outra seção (dropdown)
  body.querySelectorAll('[data-mv]').forEach(sel => sel.onchange = () => {
    const [si, ii] = sel.dataset.mv.split(':').map(Number);
    const tgt = _model.find(s => s.id === sel.value);
    if (!tgt || tgt === _model[si]) return;
    const [it] = _model[si].items.splice(ii, 1);
    tgt.items.push(it);
    rerender();
  });

  // ── DRAG-AND-DROP (arrastar pelo punho ⠿) ──
  body.querySelectorAll('.og-grip').forEach(g => {
    g.addEventListener('dragstart', e => {
      if (g.dataset.git != null) { _drag = { kind: 'item', si: +g.dataset.git.split(':')[0], ii: +g.dataset.git.split(':')[1] }; }
      else if (g.dataset.gsec != null) { _drag = { kind: 'sec', si: +g.dataset.gsec }; }
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'x'); } catch (_) {}
      const card = g.closest('.og-item, .og-sec'); if (card) setTimeout(() => card.classList.add('og-dragging'), 0);
    });
    g.addEventListener('dragend', () => { _drag = null; body.querySelectorAll('.og-dragging,.og-over').forEach(el => el.classList.remove('og-dragging', 'og-over')); });
  });
  const overEl = e => (_drag && _drag.kind === 'sec') ? e.target.closest('.og-sec') : (e.target.closest('.og-item') || e.target.closest('.og-sec'));
  body.querySelectorAll('.og-item, .og-sec').forEach(el => {
    el.addEventListener('dragover', e => { if (!_drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const t = overEl(e); body.querySelectorAll('.og-over').forEach(x => x.classList.remove('og-over')); if (t) t.classList.add('og-over'); });
    el.addEventListener('drop', e => {
      if (!_drag) return; e.preventDefault(); e.stopPropagation();
      if (_drag.kind === 'item') {
        const itemEl = e.target.closest('.og-item');
        const secEl = e.target.closest('.og-sec');
        const [it] = _model[_drag.si].items.splice(_drag.ii, 1);
        if (!it) { _drag = null; return; }
        if (itemEl && itemEl.dataset.it) {
          let [tsi, tii] = itemEl.dataset.it.split(':').map(Number);
          if (tsi === _drag.si && _drag.ii < tii) tii--;     // ajusta índice após remoção
          _model[tsi].items.splice(tii, 0, it);
        } else if (secEl && secEl.dataset.si != null) {
          _model[+secEl.dataset.si].items.push(it);          // soltou na seção (vazia/fim)
        } else { _model[_drag.si].items.splice(_drag.ii, 0, it); }
        rerender();
      } else if (_drag.kind === 'sec') {
        const secEl = e.target.closest('.og-sec');
        if (secEl && secEl.dataset.si != null) {
          const tsi = +secEl.dataset.si;
          if (tsi !== _drag.si) { const [s] = _model.splice(_drag.si, 1); _model.splice(tsi, 0, s); rerender(); }
        }
      }
      _drag = null;
    });
  });

  const msg = body.querySelector('#og-msg');
  body.querySelector('#og-save').onclick = async () => {
    const layout = { secOrder: _model.map(s => s.id), items: {} };
    _model.forEach(sec => sec.items.forEach((it, i) => { layout.items[it.nav] = { sec: sec.id, ord: i }; }));
    const btn = body.querySelector('#og-save'); const orig = btn.textContent; btn.disabled = true; btn.textContent = '…'; msg.textContent = '';
    try {
      const r = await saveMenuLayout(layout);
      if (!r || !r.ok) throw new Error((r && r.error) || 'falha');
      btn.textContent = '✓ Salvo'; msg.style.color = 'var(--ok,#16a34a)'; msg.textContent = 'Menu reorganizado pra todos.';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1400);
    } catch (e) { btn.textContent = '✕ Erro'; msg.style.color = 'var(--err,#dc2626)'; msg.textContent = e.message; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2200); }
  };
  body.querySelector('#og-reset').onclick = async () => {
    if (!confirm('Restaurar a organização do menu para o padrão? A página vai recarregar.')) return;
    try { await saveMenuLayout({ secOrder: [], items: {} }); location.reload(); }   // reload → barra volta ao layout original
    catch (e) { msg.style.color = 'var(--err,#dc2626)'; msg.textContent = e.message; }
  };
}
