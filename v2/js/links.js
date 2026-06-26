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

/** Converte link do Google Drive/Docs para a URL de DOWNLOAD DIRETO (baixa em vez de abrir). */
export function driveDownload(url) {
  if (!url) return url;
  let m;
  if ((m = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/))) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  if (/drive\.google\.com/.test(url) && (m = url.match(/[?&]id=([^&]+)/))) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  if ((m = url.match(/docs\.google\.com\/document\/d\/([^/?#]+)/))) return `https://docs.google.com/document/d/${m[1]}/export?format=docx`;
  if ((m = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/?#]+)/))) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
  if ((m = url.match(/docs\.google\.com\/presentation\/d\/([^/?#]+)/))) return `https://docs.google.com/presentation/d/${m[1]}/export/pptx`;
  return url;
}

/** Dispara o download de uma URL (cria <a download> temporário). */
export function triggerDownload(url, filename) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener';
  if (filename) a.download = filename; else a.setAttribute('download', '');
  document.body.appendChild(a); a.click(); a.remove();
}

/** Prompt simples pra gestão colar/editar um link. Retorna o novo valor ou null. */
export function promptLink(label, current) {
  const v = prompt(`${label}\n\nCole o link do Google Drive/Docs (ou deixe vazio pra remover):`, current || '');
  return v === null ? null : v.trim();
}

/* ─────────────────────────────────────────────────────────────────────────
   VISIBILIDADE DE RECURSOS POR PAPEL (resource_perms) — v81.81
   Controla quem vê recursos granulares que não são rotas (abas do Mapa,
   categorias da Biblioteca de Anúncios). Sócio administra; sócio sempre vê.
   ───────────────────────────────────────────────────────────────────────── */
export const ROLE_OPTIONS = [
  ['diretor', 'Diretor'], ['gerente', 'Gerente (geral)'], ['lider', 'Líder'],
  ['gerente_conquista', 'Gerente Conquista'], ['gerente_map', 'Gerente MAP'],
  ['gerente_locacao', 'Gerente Locação'], ['gerente_terceiros', 'Gerente Terceiros'],
  ['backoffice', 'Backoffice'], ['secretaria_vendas', 'Secretária de Vendas'],
  ['financeiro', 'Financeiro'], ['marketing', 'Marketing'],
  ['corretor', 'Corretor'],
  ['corretor_conquista', 'Corretor Conquista'], ['corretor_map', 'Corretor MAP'],
  ['corretor_locacao', 'Corretor Locação'], ['corretor_terceiros', 'Corretor Terceiros'],
];

let _resPerms = null;
export async function getResourcePerms(force = false) {
  if (_resPerms && !force) return _resPerms;
  try { const r = await api.request('/api/v3/settings/resource_perms'); _resPerms = (r && r.perms) || {}; }
  catch (_) { _resPerms = {}; }
  return _resPerms;
}
export async function saveResourcePerms(patch) {
  const r = await api.request('/api/v3/settings/resource_perms', { method: 'POST', body: { perms: patch } });
  _resPerms = (r && r.perms) || _resPerms;
  return _resPerms;
}
/** Pode ver o recurso `key`? Sócio sempre; lista vazia/ausente/"*" = todos; senão só os papéis listados. */
export function canSeeResource(key, perms, user) {
  const u = user || auth.user() || {};
  if ((u.lvl || 0) >= 10) return true;                 // sócio vê tudo
  const list = (perms || {})[key];
  if (!Array.isArray(list) || list.length === 0 || list.includes('*')) return true;
  return list.includes((u.role || '').toLowerCase());
}

/* ─── Bibliotecas de Anúncios do Meta (ads_library) — múltiplos links/categoria ─── */
let _adsLib = null;
export async function getAdsLibrary(force = false) {
  if (_adsLib && !force) return _adsLib;
  try { const r = await api.request('/api/v3/settings/ads_library'); _adsLib = (r && r.ads_library) || {}; }
  catch (_) { _adsLib = {}; }
  return _adsLib;
}
export async function saveAdsLink(categoria, link) {
  const r = await api.request('/api/v3/settings/ads_library', { method: 'POST', body: { action: 'upsert', categoria, link } });
  _adsLib = (r && r.ads_library) || _adsLib;
  return _adsLib;
}
export async function deleteAdsLink(categoria, id) {
  const r = await api.request('/api/v3/settings/ads_library', { method: 'POST', body: { action: 'delete', categoria, id } });
  _adsLib = (r && r.ads_library) || _adsLib;
  return _adsLib;
}

/** Modal reutilizável (sócio): escolhe QUAIS papéis veem um recurso. onSave() após salvar. */
export async function openResourcePermsModal(key, titulo, onSave) {
  const perms = await getResourcePerms(true);
  const cur = Array.isArray(perms[key]) ? perms[key] : [];
  const todos = cur.length === 0 || cur.includes('*');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:460px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3)">
      <h3 style="margin:0 0 4px;font-size:17px;font-weight:800">👁 Quem vê: ${esc(titulo)}</h3>
      <p class="tiny muted" style="margin:0 0 14px">O sócio sempre vê. Marque os papéis que podem ver. <b>Nenhum marcado = todos veem.</b></p>
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;background:var(--bg-3);font-weight:700;margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="rp-todos" ${todos ? 'checked' : ''}> 🌐 Todos os papéis
      </label>
      <div id="rp-roles" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:46vh;overflow:auto">
        ${ROLE_OPTIONS.map(([v, l]) => `<label style="display:flex;align-items:center;gap:7px;padding:7px;border-radius:7px;background:var(--bg-2);font-size:13px;cursor:pointer"><input type="checkbox" class="rp-r" value="${v}" ${(!todos && cur.includes(v)) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost" id="rp-cancel">Cancelar</button>
        <button class="btn btn-primary" id="rp-save">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#rp-cancel').addEventListener('click', close);
  const todosCb = ov.querySelector('#rp-todos');
  const roleCbs = () => [...ov.querySelectorAll('.rp-r')];
  todosCb.addEventListener('change', () => { if (todosCb.checked) roleCbs().forEach(c => c.checked = false); });
  roleCbs().forEach(c => c.addEventListener('change', () => { if (c.checked) todosCb.checked = false; }));
  ov.querySelector('#rp-save').addEventListener('click', async () => {
    const roles = todosCb.checked ? [] : roleCbs().filter(c => c.checked).map(c => c.value);
    try { await saveResourcePerms({ [key]: roles }); close(); if (onSave) onSave(); }
    catch (e) { alert('Erro ao salvar: ' + e.message); }
  });
}
