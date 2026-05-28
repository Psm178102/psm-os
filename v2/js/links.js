/* PSM-OS v2 — Links configuráveis (Google Drive/Earth) — Sprint 9.3
   Lê/edita o config de links (Mapa, Tabela Imóveis, Cadência) via /api/v3/settings/links. */
import { api } from './api.js';
import { auth } from './auth.js';

let _cache = null;

export async function getLinks(force = false) {
  if (_cache && !force) return _cache;
  try {
    const r = await api.request('/api/v3/settings/links');
    _cache = r.links || {};
  } catch (e) {
    _cache = {};
  }
  return _cache;
}

export async function saveLinks(patch) {
  const r = await api.request('/api/v3/settings/links', { method: 'POST', body: { links: patch } });
  _cache = r.links || _cache;
  return _cache;
}

export function canEditLinks() {
  return (auth.user()?.lvl || 0) >= 5;
}

/** Converte link de compartilhamento do Drive/Docs numa URL embutível (/preview). */
export function driveEmbed(url) {
  if (!url) return '';
  let m = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  m = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/?#]+)/);
  if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/preview`;
  m = url.match(/docs\.google\.com\/document\/d\/([^/?#]+)/);
  if (m) return `https://docs.google.com/document/d/${m[1]}/preview`;
  return url;
}

export function isEmbeddable(url) {
  return /drive\.google\.com\/file|docs\.google\.com/.test(url || '');
}

/** Prompt simples pra gestão colar/editar um link. Retorna o novo valor ou null. */
export function promptLink(label, current) {
  const v = prompt(`${label}\n\nCole o link do Google Drive/Docs (ou deixe vazio pra remover):`, current || '');
  return v === null ? null : v.trim();
}
