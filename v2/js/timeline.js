/* ============================================================================
   PSM-OS v2 — 📣 Timeline de Recados (faixa no topo do sistema)
   Sócios (lvl10) publicam recados que aparecem pra todos numa faixa acima do
   conteúdo, com tempo de exibição e opção de notificar (sino + push no celular).
   Cada usuário pode dispensar (some só pra ele, via localStorage). v78.7
============================================================================ */
import { api } from './api.js';

let _bar = null, _items = [], _canManage = false;
const DISMISS_KEY = 'psm.tl.dismissed';
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch (_) { return new Set(); } };
const setDismissed = s => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-200))); } catch (_) {} };
const CORES = ['#0f172a', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed'];

function rel(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'agora'; if (d < 3600) return Math.floor(d / 60) + 'min'; if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
}
// tempo ATÉ uma data futura (expiração)
function relAte(iso) {
  if (!iso) return '';
  const d = (new Date(iso).getTime() - Date.now()) / 1000;
  if (d <= 0) return 'expirando';
  if (d < 3600) return 'expira em ' + Math.ceil(d / 60) + 'min';
  if (d < 86400) return 'expira em ' + Math.ceil(d / 3600) + 'h';
  return 'expira em ' + Math.ceil(d / 86400) + 'd';
}

export async function initTimeline() {
  _bar = document.getElementById('timeline-bar');
  if (!_bar) return;
  await load();
  // re-checa de tempo em tempo (recados novos de outros sócios + expiração)
  setInterval(() => load().catch(() => {}), 60000);
}

// Recarrega os recados sob demanda (ex.: ao focar a aba). v81.26
export function reloadTimeline() { return load().catch(() => {}); }

async function load() {
  try {
    const r = await api.request('/api/v3/timeline/recados');
    _items = r.items || []; _canManage = !!r.can_manage;
  } catch (_) { _items = []; }
  render();
}

function render() {
  const dim = dismissed();
  const vis = _items.filter(it => !dim.has(it.id));
  if (!vis.length && !_canManage) { _bar.innerHTML = ''; _bar.style.display = 'none'; return; }
  _bar.style.display = '';
  if (!vis.length) {           // sócio sem recados ativos → só o botão de criar
    _bar.innerHTML = `<div class="tl-strip" style="border-left-color:#94a3b8">
      <span class="tl-ico">📣</span><span class="tl-txt muted">Sem recados ativos.</span>
      <button class="tl-new" id="tl-new">＋ Novo recado</button></div>`;
    wire(); return;
  }
  const cur = vis[0];
  _bar.innerHTML = `<div class="tl-strip" style="border-left-color:${esc(cur.cor || '#0f172a')}">
    <span class="tl-ico">📣</span>
    <div class="tl-txt"><b>${esc(cur.texto)}</b> <span class="tl-meta">— ${esc(cur.autor || 'Diretoria')} · ${rel(cur.criado_em)}${cur.expira_em ? ' · ' + relAte(cur.expira_em) : ' · fixo'}</span></div>
    ${vis.length > 1 ? `<button class="tl-more" id="tl-more">+${vis.length - 1}</button>` : ''}
    ${_canManage ? `<button class="tl-new" id="tl-new">＋</button>${_canManage ? `<button class="tl-del" id="tl-del" title="Excluir este recado">🗑</button>` : ''}` : ''}
    <button class="tl-x" id="tl-x" title="Dispensar">✕</button>
  </div>
  <div class="tl-list" id="tl-list" style="display:none">${vis.map(rowHTML).join('')}</div>`;
  wire();
}

function rowHTML(it) {
  return `<div class="tl-row" style="border-left-color:${esc(it.cor || '#0f172a')}">
    <div style="flex:1;min-width:0"><b>${esc(it.texto)}</b><div class="tl-meta">${esc(it.autor || 'Diretoria')} · ${rel(it.criado_em)}${it.expira_em ? ' · ' + relAte(it.expira_em) : ' · fixo'}</div></div>
    ${_canManage ? `<button class="tl-del" data-del="${esc(it.id)}" title="Excluir">🗑</button>` : ''}
    <button class="tl-xrow" data-x="${esc(it.id)}" title="Dispensar">✕</button>
  </div>`;
}

function wire() {
  const $ = s => _bar.querySelector(s);
  ensureStyle();
  $('#tl-x') && ($('#tl-x').onclick = () => { const d = dismissed(); if (_items[0]) d.add(_items.filter(it => !dismissed().has(it.id))[0].id); setDismissed(d); render(); });
  $('#tl-more') && ($('#tl-more').onclick = () => { const l = $('#tl-list'); l.style.display = l.style.display === 'none' ? 'block' : 'none'; });
  $('#tl-new') && ($('#tl-new').onclick = compose);
  $('#tl-del') && ($('#tl-del').onclick = () => { const vis = _items.filter(it => !dismissed().has(it.id)); if (vis[0]) del(vis[0].id); });
  _bar.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  _bar.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { const d = dismissed(); d.add(b.dataset.x); setDismissed(d); render(); });
}

async function del(id) {
  if (!confirm('Excluir este recado da timeline?')) return;
  try { const r = await api.request('/api/v3/timeline/recados', { method: 'POST', body: { action: 'delete', id } }); _items = r.items || []; render(); }
  catch (e) { alert('Erro: ' + e.message); }
}

function compose() {
  if (document.getElementById('tl-ov')) return;
  const ov = document.createElement('div');
  ov.id = 'tl-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.6);backdrop-filter:blur(2px);display:flex;align-items:flex-start;justify-content:center;padding:60px 16px';
  ov.innerHTML = `<div style="width:520px;max-width:96vw;background:var(--bg-2,#fff);color:var(--ink,#0f172a);border:1px solid var(--bd);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.4);padding:16px 18px">
    <div class="flex items-center" style="justify-content:space-between;margin-bottom:8px"><b style="font-size:15px">📣 Novo recado na timeline</b><button class="btn btn-ghost btn-sm" id="tl-cx">✕</button></div>
    <label class="tiny muted">Recado</label>
    <textarea id="tl-txt" class="input" rows="3" maxlength="500" placeholder="Ex.: Reunião geral hoje às 18h na Arena. Presença obrigatória!"></textarea>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap;align-items:flex-end">
      <div><label class="tiny muted">Cor</label><div id="tl-cores" style="display:flex;gap:6px;margin-top:4px">${CORES.map((c, i) => `<span data-cor="${c}" style="width:22px;height:22px;border-radius:6px;background:${c};cursor:pointer;border:2px solid ${i === 0 ? '#fff' : 'transparent'};box-shadow:0 0 0 1px var(--bd)"></span>`).join('')}</div></div>
      <div style="flex:1;min-width:160px"><label class="tiny muted">Ficar visível por</label>
        <select id="tl-dur" class="input">
          <option value="6">6 horas</option><option value="24" selected>24 horas</option>
          <option value="72">3 dias</option><option value="168">7 dias</option>
          <option value="720">30 dias</option><option value="0">Permanente (até excluir)</option>
        </select></div>
    </div>
    <div class="flex gap-3 mt-2" style="flex-wrap:wrap">
      <label class="tiny" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="tl-sis" checked> 🔔 Notificar no sistema (sino)</label>
      <label class="tiny" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="tl-push"> 📱 Notificar no celular (push)</label>
    </div>
    <div class="flex gap-2 mt-3"><button class="btn btn-primary btn-sm" id="tl-pub">📣 Publicar</button><button class="btn btn-ghost btn-sm" id="tl-cancel">Cancelar</button><span id="tl-msg" class="tiny"></span></div>
  </div>`;
  document.body.appendChild(ov);
  let cor = CORES[0];
  ov.querySelectorAll('[data-cor]').forEach(s => s.onclick = () => { cor = s.dataset.cor; ov.querySelectorAll('[data-cor]').forEach(x => x.style.borderColor = 'transparent'); s.style.borderColor = '#fff'; });
  const close = () => ov.remove();
  ov.querySelector('#tl-cx').onclick = close; ov.querySelector('#tl-cancel').onclick = close;
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  ov.querySelector('#tl-pub').onclick = async () => {
    const texto = ov.querySelector('#tl-txt').value.trim();
    const msg = ov.querySelector('#tl-msg');
    if (!texto) { msg.textContent = 'Escreva o recado.'; msg.style.color = '#dc2626'; return; }
    const btn = ov.querySelector('#tl-pub'); btn.disabled = true; btn.textContent = 'Publicando…';
    try {
      const r = await api.request('/api/v3/timeline/recados', { method: 'POST', body: {
        action: 'add', texto, cor,
        dur_horas: Number(ov.querySelector('#tl-dur').value),
        notif_sistema: ov.querySelector('#tl-sis').checked,
        notif_push: ov.querySelector('#tl-push').checked,
      } });
      _items = r.items || [];
      close(); render();
    } catch (e) { btn.disabled = false; btn.textContent = '📣 Publicar'; msg.textContent = 'Erro: ' + e.message; msg.style.color = '#dc2626'; }
  };
  setTimeout(() => ov.querySelector('#tl-txt').focus(), 30);
}

function ensureStyle() {
  if (document.getElementById('tl-style')) return;
  const st = document.createElement('style'); st.id = 'tl-style';
  st.textContent = `
    #timeline-bar{background:var(--bg-2,#fff);border:1px solid var(--bd,#e5e7eb);border-radius:12px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05)}
    .tl-strip{display:flex;align-items:center;gap:10px;padding:7px 16px;border-left:4px solid #0f172a}
    .tl-ico{font-size:15px;flex:0 0 auto}
    .tl-txt{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tl-meta{color:var(--ink-muted,#64748b);font-weight:400;font-size:11.5px}
    .tl-more,.tl-new,.tl-del,.tl-x{border:0;background:var(--bg-3,#f1f5f9);border-radius:7px;padding:3px 9px;font-size:12px;font-weight:700;cursor:pointer;flex:0 0 auto}
    .tl-x,.tl-del{background:transparent;opacity:.55;font-weight:400}.tl-x:hover,.tl-del:hover{opacity:1}
    .tl-new{background:var(--psm-gold,#d4af37);color:#0f172a}
    .tl-list{border-top:1px solid var(--bg-3,#f1f5f9);max-height:50vh;overflow:auto}
    .tl-row{display:flex;align-items:center;gap:10px;padding:8px 16px;border-left:4px solid #0f172a;border-bottom:1px solid var(--bg-3,#f1f5f9);font-size:13px}
    .tl-xrow{border:0;background:transparent;opacity:.5;cursor:pointer}.tl-xrow:hover{opacity:1}`;
  document.head.appendChild(st);
}
