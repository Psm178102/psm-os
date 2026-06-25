/* ============================================================================
   PSM-OS v2 — Rótulos editáveis do menu/páginas (v77.62)
   ----------------------------------------------------------------------------
   O sócio renomeia itens do menu lateral + títulos de seção. Os overrides ficam
   em shared_kv (server) e valem pra TODOS os usuários. Este módulo:
     • carrega os overrides no boot (loadMenuLabels)
     • reescreve os rótulos da barra preservando ícone/badges (applyMenuLabels)
     • sobrescreve o título da página no topo quando navega (applyHeaderOverride)
     • enumera o menu renderizado pro editor (enumerateMenu)
     • salva (saveMenuLabels) — só sócio (backend exige lvl>=10)
   Chave do override: a rota ("/captacoes") p/ itens; "sec:<texto padrão>" p/ seções.
============================================================================ */
import { api } from './api.js';

let LABELS = {};

export function getLabels() { return LABELS; }

// texto padrão de um botão = concatenação dos text nodes (sem ícone/badge), trimado
function btnDefaultLabel(btn) {
  let t = '';
  btn.childNodes.forEach(n => { if (n.nodeType === 3) t += n.textContent; });
  return t.trim();
}

// troca SÓ o text node do rótulo, mantendo <span class="sb-ico"> e eventuais badges
function setBtnLabel(btn, label) {
  let node = null;
  btn.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) node = n; });
  if (node) { node.textContent = ' ' + label; return; }
  const ico = btn.querySelector('.sb-ico');
  const tn = document.createTextNode(' ' + label);
  if (ico && ico.after) ico.after(tn); else btn.appendChild(tn);
}

function btnDefaultIcon(btn) {
  const ico = btn.querySelector('.sb-ico');
  return ico ? ico.textContent.trim() : '';
}

function setBtnIcon(btn, icon) {
  const ico = btn.querySelector('.sb-ico');
  if (ico) ico.textContent = icon;
}

export function applyMenuLabels() {
  document.querySelectorAll('.sb-link[data-nav]').forEach(btn => {
    if (!btn.dataset.deflabel) btn.dataset.deflabel = btnDefaultLabel(btn);  // captura padrão 1x
    if (!btn.dataset.defico) btn.dataset.defico = btnDefaultIcon(btn);
    const nav = btn.dataset.nav;
    setBtnLabel(btn, LABELS[nav] || btn.dataset.deflabel);
    setBtnIcon(btn, LABELS['ico:' + nav] || btn.dataset.defico);
  });
  document.querySelectorAll('.app-sidebar .sb-sec').forEach(sec => {
    if (!sec.dataset.deflabel) sec.dataset.deflabel = sec.textContent.trim();
    const key = 'sec:' + sec.dataset.deflabel;
    sec.textContent = LABELS[key] || sec.dataset.deflabel;
  });
}

export async function loadMenuLabels() {
  try {
    const r = await api.request('/api/v3/settings/menu_labels');
    LABELS = (r && r.labels) || {};
  } catch (_) { LABELS = {}; }
  applyMenuLabels();
  return LABELS;
}

export async function saveMenuLabels(map) {
  const r = await api.request('/api/v3/settings/menu_labels', { method: 'POST', body: { labels: map } });
  if (r && r.ok) { LABELS = r.labels || {}; applyMenuLabels(); }
  return r;
}

// sobrescreve o título do topo se a rota tiver rótulo custom (chamado em highlight)
export function applyHeaderOverride(path) {
  const o = LABELS[(path || '').split('?')[0]];
  if (o) { const el = document.getElementById('h-title'); if (el) el.textContent = o; }
}

/* ════════════════════════════════════════════════════════════════════════
   LAYOUT do menu (v81.48) — organização editável: em qual seção cada item
   fica + ordem de itens/seções. Reaproveita o menu estático como catálogo e
   reorganiza o DOM. NÃO mexe em permissão (quem vê segue na matriz por papel).
═══════════════════════════════════════════════════════════════════════════ */
let LAYOUT = { secOrder: [], items: {} };
export function getLayout() { return LAYOUT; }

const isMenuNode = el => el && el.classList && (el.classList.contains('sb-sec') || el.classList.contains('sb-link') || el.classList.contains('sb-subsec'));

// esconde seções (sb-sec) sem nenhum link visível — espelha applyPermissions
function rehideEmptySections(sidebar) {
  const nodes = [...sidebar.children];
  nodes.forEach((node, i) => {
    if (!node.classList || !node.classList.contains('sb-sec')) return;
    let visible = 0;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].classList && nodes[j].classList.contains('sb-sec')) break;
      if (nodes[j].classList && nodes[j].classList.contains('sb-link') && nodes[j].style.display !== 'none') visible++;
    }
    node.style.display = visible === 0 ? 'none' : '';
  });
}

export function applyMenuLayout() {
  const sidebar = document.querySelector('.app-sidebar');
  if (!sidebar) return;
  const secNodes = [...sidebar.querySelectorAll('.sb-sec')];
  if (!secNodes.length) return;
  secNodes.forEach(s => { if (!s.dataset.deflabel) s.dataset.deflabel = s.textContent.trim(); });

  const firstSec = secNodes[0];
  let anchor = null;   // 1º nó após a região do menu que não é menu (footer); null = menu é o último
  for (let c = firstSec; c; c = c.nextElementSibling) { if (!isMenuNode(c)) { anchor = c; break; } }

  const secById = new Map();   // id(deflabel) -> {node, subsecs:[], items:[]}
  secNodes.forEach(node => secById.set(node.dataset.deflabel, { node, subsecs: [], items: [] }));

  let curId = null, idx = 0, pendingSubs = [];   // sub-divisores (sb-subsec) ancoram no item seguinte
  for (let c = firstSec; c && isMenuNode(c); c = c.nextElementSibling) {
    if (c.classList.contains('sb-sec')) {
      if (pendingSubs.length && secById.get(curId)) secById.get(curId).subsecs.push({ anchor: null, nodes: pendingSubs });
      curId = c.dataset.deflabel; pendingSubs = [];
    } else if (c.classList.contains('sb-subsec')) {
      pendingSubs.push(c);
    } else if (c.classList.contains('sb-link') && c.dataset.nav) {
      const route = c.dataset.nav;
      if (pendingSubs.length && secById.get(curId)) { secById.get(curId).subsecs.push({ anchor: route, nodes: pendingSubs }); pendingSubs = []; }
      const cfg = LAYOUT.items && LAYOUT.items[route];
      const tgt = (cfg && cfg.sec && secById.has(cfg.sec)) ? cfg.sec : curId;
      (secById.get(tgt) || secById.get(curId)).items.push({ route, node: c, ord: (cfg && typeof cfg.ord === 'number') ? cfg.ord : null, defIdx: idx });
    }
    idx++;
  }
  if (pendingSubs.length && secById.get(curId)) secById.get(curId).subsecs.push({ anchor: null, nodes: pendingSubs });

  // ordem das seções: as do layout primeiro, resto na ordem padrão
  const ordered = [];
  (LAYOUT.secOrder || []).forEach(id => { if (secById.has(id) && !ordered.includes(id)) ordered.push(id); });
  secNodes.forEach(s => { const id = s.dataset.deflabel; if (!ordered.includes(id)) ordered.push(id); });

  const frag = document.createDocumentFragment();
  ordered.forEach(id => {
    const b = secById.get(id);
    if (!b) return;
    frag.appendChild(b.node);
    b.items.sort((a, z) => ((a.ord ?? a.defIdx) - (z.ord ?? z.defIdx)));
    // sub-divisores agrupados pela rota do item-âncora (vão logo antes dele)
    const subByAnchor = {};
    b.subsecs.forEach(g => { const k = g.anchor || '__end'; (subByAnchor[k] = subByAnchor[k] || []).push(...g.nodes); });
    const have = new Set(b.items.map(it => it.route));
    b.items.forEach(it => { (subByAnchor[it.route] || []).forEach(n => frag.appendChild(n)); frag.appendChild(it.node); });
    // divisores de fim, ou cujo item-âncora saiu desta seção → no fim
    Object.keys(subByAnchor).forEach(k => { if (k === '__end' || !have.has(k)) subByAnchor[k].forEach(n => frag.appendChild(n)); });
  });
  sidebar.insertBefore(frag, anchor);
  rehideEmptySections(sidebar);
}

export async function loadMenuLayout() {
  try { const r = await api.request('/api/v3/settings/menu_layout'); LAYOUT = (r && r.layout) || { secOrder: [], items: {} }; }
  catch (_) { LAYOUT = { secOrder: [], items: {} }; }
  if (!LAYOUT.items) LAYOUT.items = {};
  if (!Array.isArray(LAYOUT.secOrder)) LAYOUT.secOrder = [];
  applyMenuLayout();
  return LAYOUT;
}

export async function saveMenuLayout(layout) {
  const r = await api.request('/api/v3/settings/menu_layout', { method: 'POST', body: { layout } });
  if (r && r.ok) { LAYOUT = r.layout || { secOrder: [], items: {} }; applyMenuLayout(); }
  return r;
}

// estrutura ATUAL da barra (já reorganizada) p/ o editor: [{id, name, items:[{nav,label,ico}]}]
export function enumerateMenuFull() {
  const sidebar = document.querySelector('.app-sidebar');
  const sections = [];
  if (!sidebar) return sections;
  [...sidebar.querySelectorAll('.sb-sec')].forEach(node => {
    if (!node.dataset.deflabel) node.dataset.deflabel = node.textContent.trim();
    const sec = { id: node.dataset.deflabel, name: LABELS['sec:' + node.dataset.deflabel] || node.dataset.deflabel, items: [] };
    let c = node.nextElementSibling;
    while (c && !(c.classList && c.classList.contains('sb-sec'))) {
      if (c.classList && c.classList.contains('sb-link') && c.dataset.nav) {
        const def = c.dataset.deflabel || btnDefaultLabel(c);
        sec.items.push({ nav: c.dataset.nav, label: LABELS[c.dataset.nav] || def, ico: LABELS['ico:' + c.dataset.nav] || btnDefaultIcon(c) });
      }
      c = c.nextElementSibling;
    }
    sections.push(sec);
  });
  return sections;
}

// lê a barra renderizada e devolve [{secKey,secDef,secCurrent,items:[{nav,def,current}]}]
export function enumerateMenu() {
  const sidebar = document.querySelector('.app-sidebar');
  const groups = [];
  let cur = null;
  if (!sidebar) return groups;
  [...sidebar.children].forEach(node => {
    if (!node.classList) return;
    if (node.classList.contains('sb-sec')) {
      const def = node.dataset.deflabel || node.textContent.trim();
      cur = { secKey: 'sec:' + def, secDef: def, secCurrent: LABELS['sec:' + def] || def, items: [] };
      groups.push(cur);
    } else if (node.classList.contains('sb-link') && node.dataset.nav) {
      if (!cur) { cur = { secKey: null, secDef: '', secCurrent: '', items: [] }; groups.push(cur); }
      const def = node.dataset.deflabel || btnDefaultLabel(node);
      const defico = node.dataset.defico || btnDefaultIcon(node);
      const nav = node.dataset.nav;
      cur.items.push({
        nav, def, current: LABELS[nav] || def,
        defico, ico: LABELS['ico:' + nav] || defico,
      });
    }
  });
  return groups;
}
