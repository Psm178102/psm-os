/* ============================================================================
   PSM-OS v2 — 🔎 Busca Global (paleta estilo Cmd+K)
   Indexa as páginas do menu + tudo que foi cadastrado (Links úteis, CND's, SAC,
   Sistema/Drive Incorporadoras, Cofre) e deixa achar/ir em 1 atalho. Front puro,
   reusa os GET existentes. Atalho: Cmd/Ctrl+K (ou botão 🔎 no topo).
   Nunca mostra senha — itens sensíveis só levam à página onde se revela.
============================================================================ */
import { api } from './api.js';

let _idx = null, _building = null, _open = false, _sel = 0, _results = [];

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

async function buildIndex() {
  const idx = [];
  // 1) Páginas do menu (navegação)
  document.querySelectorAll('.app-sidebar [data-nav]').forEach(b => {
    const label = b.textContent.trim().replace(/\s+/g, ' ');
    const path = b.dataset.nav;
    if (label && path) idx.push({ tipo: 'Página', ico: '📄', titulo: label, sub: 'Abrir página', hash: '#' + path, kw: label });
  });
  // 2) Diretórios cadastrados (tolera falha/permção — cada um isolado)
  const safe = u => api.request(u).catch(() => null);
  const [lk, cnd, sac, sist, vault] = await Promise.all([
    safe('/api/v3/secretaria/links'), safe('/api/v3/juridico/cnds'),
    safe('/api/v3/secretaria/sac'), safe('/api/v3/secretaria/sistemas'),
    safe('/api/v3/vault/creds'),
  ]);
  (lk && lk.items || []).forEach(it => idx.push({ tipo: 'Link útil', ico: '🔗', titulo: it.titulo,
    sub: [it.categoria, it.orgao, it.cidade].filter(Boolean).join(' · '), url: it.link, hash: '#/links-uteis',
    kw: [it.titulo, it.categoria, it.orgao, it.cidade].join(' ') }));
  (cnd && cnd.items || []).forEach(it => idx.push({ tipo: 'CND', ico: '⚖️', titulo: it.titulo,
    sub: [it.categoria, it.orgao, it.comarca].filter(Boolean).join(' · '), url: it.link, hash: '#/cnds',
    kw: [it.titulo, it.categoria, it.orgao, it.comarca].join(' ') }));
  (sac && sac.items || []).forEach(it => idx.push({ tipo: 'SAC', ico: '📞', titulo: (it.incorporadora || '') + (it.nome ? ' · ' + it.nome : ''),
    sub: [it.tipo, it.produto].filter(Boolean).join(' · '), hash: '#/sac-incorporadoras',
    kw: [it.incorporadora, it.nome, it.tipo, it.produto, it.telefone, it.whatsapp].join(' ') }));
  (sist && sist.items || []).forEach(it => idx.push({ tipo: 'Incorporadora', ico: '🏢', titulo: it.incorporadora,
    sub: [it.sistema, it.gerente && ('Gerente: ' + it.gerente)].filter(Boolean).join(' · '), hash: '#/sistemas-incorporadoras',
    kw: [it.incorporadora, it.sistema, it.gerente, it.coordenador, it.sistema_login].join(' ') }));
  (vault && vault.items || []).forEach(it => idx.push({ tipo: 'Cofre', ico: '🔐', titulo: it.titulo,
    sub: 'Logins e Senhas' + (it.categoria ? ' · ' + it.categoria : ''), hash: '#/logins',
    kw: [it.titulo, it.categoria, it.login].join(' ') }));
  return idx;
}

function ensureIndex() {
  if (_idx) return Promise.resolve(_idx);
  if (!_building) _building = buildIndex().then(r => { _idx = r; return r; }).catch(() => { _idx = []; return []; });
  return _building;
}
// chamado após salvar algo em alguma página → próxima busca reindexar
export function invalidateSearchIndex() { _idx = null; _building = null; }

function score(item, tokens) {
  const t = norm(item.titulo), k = norm(item.kw);
  let s = 0;
  for (const tok of tokens) {
    if (!k.includes(tok)) return -1;            // todo token precisa bater em algum lugar
    if (t.startsWith(tok)) s += 5;
    else if (t.includes(tok)) s += 3;
    else s += 1;
  }
  if (item.tipo === 'Página') s += 0.5;          // leve preferência por navegação
  return s;
}

function runQuery(q) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) { _results = (_idx || []).filter(i => i.tipo === 'Página').slice(0, 8); return; }
  _results = (_idx || []).map(i => ({ i, s: score(i, tokens) })).filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.i);
}

function resultsHTML() {
  if (!_results.length) return '<div style="padding:18px;text-align:center;color:#94a3b8;font-size:13px">Nada encontrado. Tente outro termo.</div>';
  return _results.map((r, n) => `
    <div class="gs-row ${n === _sel ? 'on' : ''}" data-i="${n}">
      <span class="gs-ico">${r.ico}</span>
      <span class="gs-body"><span class="gs-t">${esc(r.titulo)}</span>${r.sub ? `<span class="gs-s">${esc(r.sub)}</span>` : ''}</span>
      <span class="gs-tag">${esc(r.tipo)}</span>
      ${r.url ? '<span class="gs-go">🔗</span>' : '<span class="gs-go">↵</span>'}
    </div>`).join('');
}

function paint() {
  const list = document.getElementById('gs-list');
  if (list) list.innerHTML = resultsHTML();
}

function choose(n) {
  const r = _results[n];
  if (!r) return;
  close();
  if (r.url) { try { window.open(r.url, '_blank', 'noopener'); return; } catch (_) {} }
  if (r.hash) location.hash = r.hash;
}

export function openSearch() {
  if (_open) return;
  _open = true; _sel = 0;
  if (!document.getElementById('gs-style')) {
    const st = document.createElement('style'); st.id = 'gs-style';
    st.textContent = `
      #gs-ov{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.6);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:72px 16px}
      #gs-box{width:640px;max-width:96vw;background:var(--bg-2,#fff);color:var(--ink,#0f172a);border:1px solid var(--bd,#e5e7eb);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.4);overflow:hidden;animation:gspop .15s ease}
      @keyframes gspop{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
      #gs-input{width:100%;border:0;border-bottom:1px solid var(--bd,#e5e7eb);padding:16px 18px;font-size:16px;outline:none;background:transparent;color:inherit}
      #gs-list{max-height:56vh;overflow:auto}
      .gs-row{display:flex;align-items:center;gap:11px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--bg-3,#f1f5f9)}
      .gs-row.on{background:var(--bg-3,#f1f5f9)}
      .gs-ico{font-size:17px;width:22px;text-align:center;flex:0 0 22px}
      .gs-body{flex:1;min-width:0;display:flex;flex-direction:column}
      .gs-t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gs-s{font-size:11.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gs-tag{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#475569;background:var(--bg-3,#f1f5f9);padding:2px 7px;border-radius:20px}
      .gs-go{opacity:.4;font-size:13px;width:16px;text-align:center}
      #gs-foot{padding:8px 16px;font-size:11px;color:#94a3b8;border-top:1px solid var(--bg-3,#f1f5f9);display:flex;gap:14px;flex-wrap:wrap}`;
    document.head.appendChild(st);
  }
  const ov = document.createElement('div');
  ov.id = 'gs-ov';
  ov.innerHTML = `<div id="gs-box">
    <input id="gs-input" placeholder="🔎 Buscar páginas, links, CND's, incorporadoras, contatos, logins…" autocomplete="off">
    <div id="gs-list"></div>
    <div id="gs-foot"><span>↑↓ navegar</span><span>↵ abrir</span><span>esc fechar</span><span style="margin-left:auto">indexa o que você cadastrou</span></div>
  </div>`;
  document.body.appendChild(ov);
  const input = document.getElementById('gs-input');
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  document.getElementById('gs-list').addEventListener('click', e => { const row = e.target.closest('.gs-row'); if (row) choose(+row.dataset.i); });
  input.addEventListener('input', () => { _sel = 0; runQuery(input.value); paint(); });
  input.addEventListener('keydown', onKey);
  ensureIndex().then(() => { runQuery(input.value); paint(); });
  runQuery(''); paint();
  setTimeout(() => input.focus(), 30);
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); _sel = Math.min(_sel + 1, _results.length - 1); paint(); scrollSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _sel = Math.max(_sel - 1, 0); paint(); scrollSel(); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(_sel); }
}
function scrollSel() { const el = document.querySelector('.gs-row.on'); if (el) el.scrollIntoView({ block: 'nearest' }); }

function close() { _open = false; const ov = document.getElementById('gs-ov'); if (ov) ov.remove(); }

// Liga atalho global Cmd/Ctrl+K + o botão 🔎 do topo
export function initSearch() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); _open ? close() : openSearch(); }
  });
  document.getElementById('btn-search')?.addEventListener('click', openSearch);
}
