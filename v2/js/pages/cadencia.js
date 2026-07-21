/* PSM-OS v2 — Cadências de Follow-up (Sprint 8.7 + 9.3 anexos por equipe) */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { getLinks, saveLinks, canEditLinks, promptLink } from '../links.js';

const CAD_TEAMS = [
  { key: 'map',       lbl: 'MAP',       cor: '#d4a843' },
  { key: 'conquista', lbl: 'Conquista', cor: '#dc2626' },
  { key: 'terceiros', lbl: 'Terceiros', cor: '#3b82f6' },
  { key: 'locacao',   lbl: 'Locação',   cor: '#10b981' },
];

let _root = null;
let _items = [];
let _editing = null;
let _open = null;        // id da cadência aberta (modo detalhe com materiais embutidos)
let _openFileIdx = 0;    // arquivo selecionado no visualizador

const CANAIS = ['WhatsApp', 'Email', 'Ligação', 'Visita', 'SMS', 'Instagram'];
const CANAL_ICO = { WhatsApp: '💬', Email: '📧', 'Ligação': '📞', Visita: '🚪', SMS: '📱', Instagram: '📸' };

export async function pageCadencia(ctx, root) {
  _root = root; _open = null; _editing = null; _openFileIdx = 0;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+).</div>';
    return;
  }
  render();
  loadAnexos();
  await load();
}

async function loadAnexos() {
  const host = document.getElementById('cad-anexos');
  if (!host) return;
  const links = await getLinks();
  const cad = links.cadencia || {};
  host.innerHTML = `
    <div class="card">
      <h2 class="card-title">📎 Materiais de Cadência por equipe</h2>
      <p class="card-sub">Roteiros/arquivos de cadência de cada equipe (Google Drive)${canEditLinks() ? ' · gestão edita o link' : ''}.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:10px">
        ${CAD_TEAMS.map(t => {
          const u = cad[t.key] || '';
          return `<div style="border:1px solid var(--bd,#e5e7eb);border-top:3px solid ${t.cor};border-radius:10px;padding:12px">
            <div style="font-weight:800;color:${t.cor};margin-bottom:8px">${t.lbl}</div>
            ${u ? `<a class="btn btn-primary btn-sm btn-block" href="${esc(u)}" target="_blank" rel="noopener">📂 Abrir materiais</a>`
                : `<div class="tiny muted">Sem material ainda.</div>`}
            ${canEditLinks() ? `<button class="btn btn-ghost btn-sm btn-block mt-1" data-cadlink="${t.key}">⚙️ ${u ? 'Trocar' : 'Definir'} link</button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  host.querySelectorAll('[data-cadlink]').forEach(b => b.addEventListener('click', async () => {
    const key = b.dataset.cadlink;
    const t = CAD_TEAMS.find(x => x.key === key);
    const links2 = await getLinks();
    const v = promptLink('Materiais de Cadência — ' + t.lbl, (links2.cadencia || {})[key]);
    if (v === null) return;
    try { await saveLinks({ cadencia: { [key]: v } }); await loadAnexos(); }
    catch (e) { alert('Erro: ' + e.message); }
  }));
}

async function load() {
  try {
    const r = await api.request('/api/v3/crm_extra/cadencia');
    _items = r.cadencias || [];
    if (_open && _items.find(c => c.id === _open)) renderDetail();
    else { _open = null; renderList(); }
  } catch (e) {
    document.getElementById('cad-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div id="cad-anexos" style="margin-bottom:14px"></div>
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🔄 Fluxos de Cadência</h2>
          <p class="card-sub">Sequências automatizadas de follow-up com leads — múltiplos passos × canais</p>
        </div>
        <button class="btn btn-primary" id="cad-new">➕ Nova Cadência</button>
      </div>
      <div id="cad-body" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  document.getElementById('cad-new').addEventListener('click', () => {
    _editing = { nome: '', publico: '', ativa: true, passos: [{ dia: 0, canal: 'WhatsApp', mensagem: '' }] };
    showForm();
  });
}

function renderList() {
  const body = document.getElementById('cad-body');
  if (_items.length === 0) {
    body.innerHTML = '<div class="muted tiny" style="text-align:center;padding:40px">Nenhuma cadência ainda.</div>';
    return;
  }
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px">
      ${_items.map(c => cadCard(c)).join('')}
    </div>
  `;
  body.querySelectorAll('[data-open-cad]').forEach(b => b.addEventListener('click', () => {
    _open = b.dataset.openCad; _openFileIdx = 0; renderDetail();
  }));
  body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    _editing = JSON.parse(JSON.stringify(_items.find(x => x.id === b.dataset.edit)));
    showForm();
  }));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover cadência?')) return;
    try {
      await api.request('/api/v3/crm_extra/cadencia?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      await load();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

function cadCard(c) {
  return `
    <div class="card" style="border-left:4px solid ${c.ativa ? '#22c55e' : '#64748b'}">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="flex:1">
          <div style="font-weight:800">${esc(c.nome)}</div>
          <div class="tiny muted">${esc(c.publico || '—')} · ${c.ativa ? '🟢 Ativa' : '⚫ Pausada'}</div>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" data-edit="${c.id}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${c.id}">🗑</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">
        ${(c.passos || []).map((p, i) => `
          <div class="flex" style="gap:6px;align-items:center;font-size:12px;padding:4px 8px;background:var(--bg-3);border-radius:6px">
            <span style="background:var(--psm-navy);color:var(--psm-cream);font-weight:800;border-radius:4px;padding:2px 6px;font-size:10px">D+${p.dia || 0}</span>
            <span>${CANAL_ICO[p.canal] || '📨'} ${esc(p.canal)}</span>
            <span class="tiny muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.mensagem || '—')}</span>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-ghost btn-sm btn-block mt-2" data-open-cad="${c.id}">📎 Materiais (${(c.arquivos || []).length}) · abrir</button>
    </div>
  `;
}

function showForm() {
  const c = _editing;
  const body = document.getElementById('cad-body');
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);padding:18px;margin-bottom:14px">
      <div class="flex" style="justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800">${c.id ? '✏️ Editar' : '➕ Nova'} Cadência</div>
        <button class="btn btn-ghost btn-sm" id="cad-cancel">✕ Cancelar</button>
      </div>
      <div style="display:grid;gap:10px">
        <div>
          <label class="tiny muted">Nome *</label>
          <input id="cd-nome" class="input" placeholder="Ex: Cadência Lead Quente MAP" value="${esc(c.nome || '')}">
        </div>
        <div>
          <label class="tiny muted">Público / Aplicação</label>
          <input id="cd-pub" class="input" placeholder="Lead que respondeu primeira mensagem" value="${esc(c.publico || '')}">
        </div>
        <div>
          <label class="flex gap-2" style="align-items:center"><input id="cd-ativa" type="checkbox" ${c.ativa ? 'checked' : ''}> Cadência ativa</label>
        </div>
        <div>
          <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:6px">
            <label class="tiny muted" style="font-weight:700">Passos</label>
            <button class="btn btn-ghost btn-sm" id="cd-add">➕ Adicionar passo</button>
          </div>
          <div id="cd-passos"></div>
        </div>
        <button class="btn btn-primary mt-2" id="cd-save">💾 Salvar Cadência</button>
      </div>
    </div>
  `;
  document.getElementById('cad-cancel').addEventListener('click', () => { _editing = null; render(); renderList(); });
  document.getElementById('cd-add').addEventListener('click', () => {
    _editing.passos.push({ dia: _editing.passos.length, canal: 'WhatsApp', mensagem: '' });
    renderPassos();
  });
  document.getElementById('cd-save').addEventListener('click', save);
  renderPassos();
}

function renderPassos() {
  const wrap = document.getElementById('cd-passos');
  wrap.innerHTML = _editing.passos.map((p, i) => `
    <div style="background:var(--bg-2);border-radius:8px;padding:10px;margin-bottom:6px">
      <div class="flex" style="justify-content:space-between;margin-bottom:6px">
        <div class="tiny muted">Passo ${i + 1}</div>
        <button class="btn btn-ghost btn-sm" data-rem-p="${i}" style="color:#ef4444">🗑</button>
      </div>
      <div style="display:grid;grid-template-columns:80px 140px 1fr;gap:6px">
        <input class="input" type="number" placeholder="Dia" data-p-key="dia" data-p-idx="${i}" value="${p.dia || 0}">
        <select class="select" data-p-key="canal" data-p-idx="${i}">
          ${CANAIS.map(c => `<option value="${c}" ${p.canal === c ? 'selected' : ''}>${CANAL_ICO[c]} ${c}</option>`).join('')}
        </select>
        <input class="input" placeholder="Mensagem / instrução" data-p-key="mensagem" data-p-idx="${i}" value="${esc(p.mensagem || '')}">
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-p-key]').forEach(el => el.addEventListener('input', e => {
    const i = +el.dataset.pIdx, k = el.dataset.pKey;
    let v = e.target.value;
    if (k === 'dia') v = parseInt(v) || 0;
    _editing.passos[i][k] = v;
  }));
  wrap.querySelectorAll('[data-rem-p]').forEach(b => b.addEventListener('click', () => {
    _editing.passos.splice(+b.dataset.remP, 1);
    renderPassos();
  }));
}

async function save() {
  _editing.nome = document.getElementById('cd-nome').value.trim();
  _editing.publico = document.getElementById('cd-pub').value.trim();
  _editing.ativa = document.getElementById('cd-ativa').checked;
  if (!_editing.nome) { alert('Nome obrigatório'); return; }
  try {
    await api.request('/api/v3/crm_extra/cadencia', { method: 'POST', body: _editing });
    _editing = null;
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

/* ───────── DETALHE + MATERIAIS (anexos múltiplos, ordem lógica, render embutido) ───────── */
const canEdit = () => (auth.user()?.lvl || 0) >= 5;

function fileKind(nome) {
  const ext = (String(nome || '').split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return 'office';
  return 'other';
}
const KIND_ICO = { pdf: '📕', image: '🖼', office: '📊', other: '📄' };
// ordem lógica = natural sort por nome (1,2,…,10; D+0, D+1…); reordenável manualmente depois
function natSort(arr) { return arr.slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { numeric: true, sensitivity: 'base' })); }
function fileToB64(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }

function renderEmbed(a) {
  const k = fileKind(a.nome), url = esc(a.url);
  if (k === 'pdf') return `<iframe src="${url}" style="width:100%;height:74vh;border:1px solid var(--bd,#e5e7eb);border-radius:8px;background:#fff"></iframe>`;
  if (k === 'image') return `<div style="text-align:center;background:var(--bg-3);border-radius:8px;padding:10px"><img src="${url}" alt="${esc(a.nome)}" style="max-width:100%;max-height:74vh;border-radius:6px"></div>`;
  if (k === 'office') return `<iframe src="https://docs.google.com/viewer?url=${encodeURIComponent(a.url)}&embedded=true" style="width:100%;height:74vh;border:1px solid var(--bd,#e5e7eb);border-radius:8px;background:#fff"></iframe>`;
  return `<div class="card" style="text-align:center;padding:30px"><div style="font-size:34px">📄</div><div class="muted tiny" style="margin:8px 0">Este tipo não tem visualização embutida.</div><a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener">⬇️ Abrir / baixar ${esc(a.nome)}</a></div>`;
}

function renderDetail() {
  const c = _items.find(x => x.id === _open);
  const body = document.getElementById('cad-body');
  if (!c || !body) { _open = null; return renderList(); }
  const arqs = c.arquivos || [];
  if (_openFileIdx >= arqs.length) _openFileIdx = 0;
  const sel = arqs[_openFileIdx];
  body.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" id="cad-back">← Voltar</button>
      <button class="btn btn-ghost btn-sm" id="cad-editthis">✏️ Editar passos</button>
    </div>
    <div class="card" style="border-left:4px solid ${c.ativa ? '#22c55e' : '#64748b'};margin-bottom:12px">
      <div style="font-weight:800;font-size:17px">${esc(c.nome)}</div>
      <div class="tiny muted">${esc(c.publico || '—')} · ${c.ativa ? '🟢 Ativa' : '⚫ Pausada'} · ${(c.passos || []).length} passo(s)</div>
    </div>

    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <h3 class="card-title" style="margin:0">📎 Materiais da cadência <span class="tiny muted" style="font-weight:600">· ${arqs.length} arquivo(s) · ordem lógica</span></h3>
          <p class="card-sub" style="margin:2px 0 0">Anexe vários arquivos — eles entram em ordem (nome) e abrem aqui dentro do sistema. PDF, imagem, Word, Excel.</p>
        </div>
        ${canEdit() ? `<label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">📥 Anexar arquivos<input type="file" id="cad-up" multiple style="display:none"></label>` : ''}
      </div>
      <div id="cad-up-msg" class="tiny" style="margin:6px 0;min-height:16px"></div>

      ${arqs.length ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px">
          ${arqs.map((a, i) => `
            <div class="flex" style="gap:4px;align-items:center;background:${i === _openFileIdx ? 'var(--psm-gold,#d4a843)' : 'var(--bg-3)'};color:${i === _openFileIdx ? '#000' : 'inherit'};border-radius:8px;padding:5px 8px;font-size:12px">
              <button data-selfile="${i}" style="background:none;border:0;cursor:pointer;font-weight:700;color:inherit;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${KIND_ICO[fileKind(a.nome)]} ${i + 1}. ${esc(a.nome)}</button>
              ${canEdit() ? `<button data-mvup="${i}" title="subir" ${i === 0 ? 'disabled' : ''} style="background:none;border:0;cursor:pointer;color:inherit">↑</button>
              <button data-mvdn="${i}" title="descer" ${i === arqs.length - 1 ? 'disabled' : ''} style="background:none;border:0;cursor:pointer;color:inherit">↓</button>
              <button data-delfile="${i}" title="remover" style="background:none;border:0;cursor:pointer;color:#dc2626">✕</button>` : ''}
            </div>`).join('')}
        </div>
        ${sel ? renderEmbed(sel) : ''}
      ` : `<div class="muted tiny" style="text-align:center;padding:30px">Nenhum material ainda${canEdit() ? ' — clique em “📥 Anexar arquivos”.' : '.'}</div>`}
    </div>
  `;
  document.getElementById('cad-back').addEventListener('click', () => { _open = null; renderList(); });
  document.getElementById('cad-editthis').addEventListener('click', () => { _editing = JSON.parse(JSON.stringify(c)); _open = null; showForm(); });
  const up = document.getElementById('cad-up');
  if (up) up.addEventListener('change', () => uploadArquivos(c, up));
  body.querySelectorAll('[data-selfile]').forEach(b => b.addEventListener('click', () => { _openFileIdx = +b.dataset.selfile; renderDetail(); }));
  body.querySelectorAll('[data-mvup]').forEach(b => b.addEventListener('click', () => moveArquivo(c, +b.dataset.mvup, -1)));
  body.querySelectorAll('[data-mvdn]').forEach(b => b.addEventListener('click', () => moveArquivo(c, +b.dataset.mvdn, +1)));
  body.querySelectorAll('[data-delfile]').forEach(b => b.addEventListener('click', () => delArquivo(c, +b.dataset.delfile)));
}

async function saveCad(c) {
  const body = { id: c.id, nome: c.nome, publico: c.publico, ativa: c.ativa, passos: c.passos || [], arquivos: c.arquivos || [] };
  const r = await api.request('/api/v3/crm_extra/cadencia', { method: 'POST', body });
  const row = (r && r.row) || c;
  const i = _items.findIndex(x => x.id === c.id);
  if (i >= 0) _items[i] = row;
  _open = row.id;
  return row;
}

async function uploadArquivos(c, input) {
  const files = [...(input.files || [])]; if (!files.length) return;
  const msg = h => { const e = document.getElementById('cad-up-msg'); if (e) e.textContent = h; };
  const novos = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.size > 4 * 1024 * 1024) { msg(`⚠️ "${f.name}" tem ${(f.size / 1048576).toFixed(1)}MB (limite 4MB) — pulado.`); continue; }
    msg(`⏳ enviando ${i + 1}/${files.length}: ${f.name}…`);
    try {
      const up = await api.request('/api/v3/upload_file', { method: 'POST', body: { folder: 'cadencia', filename: f.name, content_b64: await fileToB64(f) } });
      if (up && up.ok && up.url) novos.push({ nome: f.name, url: up.url, tipo: fileKind(f.name), criado_em: new Date().toISOString() });
      else msg('⚠️ falha em ' + f.name + (up && up.error ? ': ' + up.error : ''));
    } catch (e) { msg('⚠️ ' + e.message); }
  }
  if (!novos.length) { input.value = ''; return; }
  c.arquivos = natSort([...(c.arquivos || []), ...novos]);   // auto-organiza em ordem lógica
  msg('⏳ salvando…');
  try { await saveCad(c); _openFileIdx = 0; renderDetail(); }
  catch (e) { msg('⚠️ ' + e.message); }
  input.value = '';
}

async function moveArquivo(c, idx, dir) {
  const arr = c.arquivos || []; const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  c.arquivos = arr;
  try { await saveCad(c); _openFileIdx = j; renderDetail(); } catch (e) { alert('Erro: ' + e.message); }
}

async function delArquivo(c, idx) {
  const arr = c.arquivos || [];
  if (!confirm('Remover "' + (arr[idx]?.nome || '') + '" desta cadência?')) return;
  arr.splice(idx, 1); c.arquivos = arr;
  try { await saveCad(c); _openFileIdx = 0; renderDetail(); } catch (e) { alert('Erro: ' + e.message); }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
