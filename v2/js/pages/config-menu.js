/* ============================================================================
   PSM-OS v2 — Editor de Nomes do Menu (v77.62)
   Só sócio (lvl>=10). Lê a barra lateral renderizada e deixa o Paulo renomear
   cada item do menu + os títulos de seção. Salva em shared_kv (vale p/ todos).
   O título da página no topo herda automaticamente o nome custom da rota.
============================================================================ */
import { auth } from '../auth.js';
import { enumerateMenu, saveMenuLabels } from '../menu-labels.js';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export async function pageConfigMenu(ctx, root) {
  const me = auth.user();
  if ((me?.lvl || 0) < 10) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Só o sócio (lvl ≥ 10) pode renomear o menu.</div>';
    return;
  }

  const groups = enumerateMenu();
  if (!groups.length) {
    root.innerHTML = '<div class="alert alert-warn">Menu ainda não carregou. Recarregue a página.</div>';
    return;
  }

  const secHtml = groups.map(g => {
    const secInput = g.secKey ? `
      <div class="cm-row cm-sec-row">
        <div class="cm-def">📂 Seção · <b>${esc(g.secDef)}</b></div>
        <input class="input cm-inp" data-key="${esc(g.secKey)}" data-def="${esc(g.secDef)}"
               value="${esc(g.secCurrent !== g.secDef ? g.secCurrent : '')}" placeholder="${esc(g.secDef)}">
      </div>` : '';
    const items = g.items.map(it => `
      <div class="cm-row">
        <div class="cm-def">${esc(it.def)} <span class="cm-route">${esc(it.nav)}</span></div>
        <input class="input cm-inp" data-key="${esc(it.nav)}" data-def="${esc(it.def)}"
               value="${esc(it.current !== it.def ? it.current : '')}" placeholder="${esc(it.def)}">
      </div>`).join('');
    return `<div class="card cm-group">${secInput}${items}</div>`;
  }).join('');

  root.innerHTML = `
    <style>
      .cm-group{margin-bottom:14px;padding:10px 14px}
      .cm-row{display:grid;grid-template-columns:1fr 240px;gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#eef0f3)}
      .cm-row:last-child{border-bottom:none}
      .cm-sec-row{background:var(--bg-1,#f8fafc);margin:0 -14px;padding:9px 14px;border-radius:8px}
      .cm-def{font-size:13.5px;color:var(--ink,#111)}
      .cm-route{font-size:11px;color:var(--ink-muted,#94a3b8);margin-left:6px;font-family:ui-monospace,monospace}
      .cm-inp{width:100%}
      .cm-bar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:flex-end;
              background:var(--bg-2,#fff);border-top:1px solid var(--border,#e5e7eb);padding:12px;margin-top:8px;z-index:5}
      .cm-msg{margin-right:auto;font-size:13px}
      @media(max-width:640px){.cm-row{grid-template-columns:1fr;gap:4px}}
    </style>
    <div class="card" style="margin-bottom:14px">
      <h2 style="margin:0 0 4px">✏️ Nomes do Menu</h2>
      <p class="muted" style="margin:0;font-size:13px">
        Renomeie qualquer item da barra lateral e os títulos de seção. Deixe em branco pra manter o padrão.
        O nome novo vale para <b>todos os usuários</b> e o título da página no topo acompanha automaticamente.
      </p>
    </div>
    ${secHtml}
    <div class="cm-bar">
      <span class="cm-msg muted" id="cm-msg"></span>
      <button class="btn" id="cm-reset">Restaurar padrão</button>
      <button class="btn btn-primary" id="cm-save">Salvar nomes</button>
    </div>
  `;

  const msg = root.querySelector('#cm-msg');
  const collect = () => {
    const map = {};
    root.querySelectorAll('.cm-inp').forEach(inp => {
      const v = (inp.value || '').trim();
      if (v && v !== inp.dataset.def) map[inp.dataset.key] = v;
    });
    return map;
  };

  const doSave = async (map, okText) => {
    const btn = root.querySelector('#cm-save');
    const orig = btn.textContent; btn.disabled = true; btn.textContent = '…'; msg.textContent = '';
    try {
      const r = await saveMenuLabels(map);
      if (!r || !r.ok) throw new Error((r && r.error) || 'falha ao salvar');
      btn.textContent = '✓ ' + (okText || 'Salvo');
      msg.style.color = 'var(--ok,#16a34a)';
      msg.textContent = 'Aplicado na barra ao lado. Vale para todos os usuários.';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1400);
    } catch (e) {
      btn.textContent = '✕ Erro'; msg.style.color = 'var(--err,#dc2626)'; msg.textContent = e.message;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2200);
    }
  };

  root.querySelector('#cm-save').addEventListener('click', () => doSave(collect(), 'Salvo'));
  root.querySelector('#cm-reset').addEventListener('click', () => {
    if (!confirm('Restaurar TODOS os nomes do menu para o padrão?')) return;
    root.querySelectorAll('.cm-inp').forEach(inp => { inp.value = ''; });
    doSave({}, 'Restaurado');
  });
}
