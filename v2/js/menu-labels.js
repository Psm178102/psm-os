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
