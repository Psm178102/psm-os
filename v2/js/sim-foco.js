/* ============================================================================
   PSM-OS v2 — Re-render SEM roubar o foco (v86.54)
   ----------------------------------------------------------------------------
   POR QUE ISSO EXISTE: os simuladores recalculam re-renderizando a página
   inteira (innerHTML) 250ms depois de cada tecla. Isso DESTRÓI o input onde o
   usuário está digitando: o foco cai, o valor cru some ("754." vira "754"),
   e preencher o formulário vira tortura — relato do Paulo, 18/ago.

   Este helper embrulha o render: guarda QUAL campo estava ativo (data-key,
   data-ap/apk ou id), o texto CRU digitado e a posição do cursor; roda o
   render; e devolve foco + texto + cursor exatamente onde estavam.

   Uso:  renderSemPerderFoco(_root, render)
   (em vez de chamar render() direto nos handlers de input)
============================================================================ */

export function renderSemPerderFoco(rootEl, renderFn) {
  const ae = document.activeElement;
  let foco = null;
  if (ae && rootEl && rootEl.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '')) {
    const cssq = v => (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/"/g, '\\"');
    let sel = null;
    if (ae.dataset && ae.dataset.key != null) sel = `[data-key="${cssq(ae.dataset.key)}"]`;
    else if (ae.dataset && ae.dataset.ap != null) sel = `[data-ap="${cssq(ae.dataset.ap)}"][data-apk="${cssq(ae.dataset.apk || '')}"]`;
    else if (ae.id) sel = `#${cssq(ae.id)}`;
    if (sel) {
      let s = null, e = null;
      try { s = ae.selectionStart; e = ae.selectionEnd; } catch (_) { /* input number não expõe */ }
      foco = { sel, raw: ae.value, s, e };
    }
  }

  renderFn();

  if (!foco) return;
  const el = rootEl.querySelector(foco.sel);
  if (!el) return;
  el.value = foco.raw;   // preserva EXATAMENTE o que estava digitado (ex.: "1.5" no meio)
  try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} }
  if (foco.s != null) { try { el.setSelectionRange(foco.s, foco.e); } catch (_) { /* number */ } }
}
