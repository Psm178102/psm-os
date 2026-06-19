/* ============================================================================
   PSM-OS v2 — Formatos de Reunião (playbook editável da PSM) · Diretoria
   Cada formato: cadência + objetivo + pauta (roteiro) + checklist + arquivos
   editáveis (links do Drive). Visualiza quem vê a aba; edita lvl≥7.
============================================================================ */
import { api } from '../api.js';

let _root = null, _items = [], _canEdit = false, _editing = null, _busy = false;
let _drive = {}, _driveEdit = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');

export async function pageReunioes(ctx, root) {
  _root = root; _editing = null; _busy = false;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando formatos de reunião…</div></div>';
  await load(true);
}

async function load(maybeSeed) {
  try {
    const r = await api.request('/api/v3/docs/reunioes');
    _items = r.items || [];
    _drive = r.drive || {};
    _canEdit = !!r.can_edit;
    // 1ª vez: semeia os 4 formatos padrão da PSM (silencioso, só diretoria)
    if (maybeSeed && !r.seeded && _canEdit) {
      try { await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'seed' } }); return load(false); } catch (_) {}
    }
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">🤝 Formatos de Reunião</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:680px">Métodos, formatos e arquivos editáveis das reuniões da PSM. ${_canEdit ? 'Edite a pauta, o objetivo, o checklist e anexe arquivos (links do Drive).' : 'Somente leitura.'}</p>
        </div>
        ${_canEdit ? `<button class="btn btn-primary btn-sm" id="rn-new">➕ Novo formato</button>` : ''}
      </div>
      ${driveHTML()}
    </div>
    ${_editing === 'new' ? formHTML(null) : ''}
    ${_items.map(it => _editing === it.id ? formHTML(it) : cardHTML(it)).join('')}
    ${!_items.length ? '<div class="card mt-3 muted tiny" style="text-align:center;padding:24px">Nenhum formato cadastrado.</div>' : ''}`;
  wire();
}

function driveHTML() {
  if (_driveEdit) {
    return `
      <div class="mt-3" style="background:var(--bg-3);border:1px solid var(--bd);border-radius:10px;padding:12px 14px">
        <div class="tiny muted" style="font-weight:800;margin-bottom:6px">📂 Pasta / arquivo das reuniões no Google Drive</div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <input id="dr-label" class="input" style="flex:1;min-width:160px" placeholder="Rótulo (ex.: Pasta das reuniões)" value="${esc(_drive.label || '')}">
          <input id="dr-url" class="input" style="flex:2;min-width:240px" placeholder="https://drive.google.com/…" value="${esc(_drive.url || '')}">
        </div>
        <div class="flex gap-2 mt-2">
          <button class="btn btn-primary btn-sm" id="dr-save">💾 Salvar link</button>
          <button class="btn btn-ghost btn-sm" id="dr-cancel">Cancelar</button>
        </div>
        <p class="tiny muted mt-2">💡 No Drive: clique direito → <b>Compartilhar</b> → "Qualquer pessoa com o link" → <b>Copiar link</b>. Pode ser uma pasta (todos baixam os arquivos) ou um arquivo só.</p>
      </div>`;
  }
  if (_drive.url) {
    return `<div class="flex items-center gap-2 mt-3" style="flex-wrap:wrap">
      <a class="btn btn-primary btn-sm" href="${esc(_drive.url)}" target="_blank" rel="noopener noreferrer">📂 ${esc(_drive.label || 'Arquivos no Drive')} — Abrir / baixar</a>
      ${_canEdit ? `<button class="btn btn-ghost btn-sm" id="dr-edit">✏️ Editar link</button>` : ''}
    </div>`;
  }
  return _canEdit ? `<div class="mt-3"><button class="btn btn-ghost btn-sm" id="dr-edit">📂 Definir link do Drive (pasta de arquivos)</button></div>` : '';
}

function cardHTML(it) {
  const meta = [
    it.cadencia && ['🔁 Cadência', it.cadencia],
    it.quando && ['📆 Quando', it.quando],
    it.duracao && ['⏱ Duração', it.duracao],
    it.participantes && ['👥 Participantes', it.participantes],
  ].filter(Boolean);
  return `
    <div class="card mt-3">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h3 class="card-title" style="margin:0;font-size:16px">${it.emoji || '📋'} ${esc(it.nome)}</h3>
        <div class="flex gap-2">
          ${it.cadencia ? `<span class="tiny" style="background:#2563eb1a;color:#2563eb;padding:3px 10px;border-radius:999px;font-weight:700">${esc(it.cadencia)}</span>` : ''}
          ${_canEdit ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">✏️ Editar</button>
            <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" style="color:#dc2626">🗑</button>` : ''}
        </div>
      </div>
      ${it.objetivo ? `<p class="tiny" style="margin:6px 0 0;color:var(--ink-muted,#475569)"><b>🎯 Objetivo:</b> ${esc(it.objetivo)}</p>` : ''}
      ${meta.length ? `<div class="flex gap-3 mt-2" style="flex-wrap:wrap">${meta.map(([k, v]) => `<span class="tiny muted"><b>${k}:</b> ${esc(v)}</span>`).join('')}</div>` : ''}

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap;align-items:flex-start">
        ${it.pauta ? `<div style="flex:2;min-width:280px;background:var(--bg-3);border-radius:10px;padding:12px 14px">
          <div class="tiny muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📋 Pauta / roteiro</div>
          <div style="font-size:13px;line-height:1.6">${nl2br(it.pauta)}</div></div>` : ''}
        ${(it.checklist && it.checklist.length) ? `<div style="flex:1;min-width:220px;background:var(--bg-3);border-radius:10px;padding:12px 14px">
          <div class="tiny muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">✅ Checklist</div>
          ${it.checklist.map(c => `<div style="font-size:13px;line-height:1.7">☐ ${esc(c)}</div>`).join('')}</div>` : ''}
      </div>

      ${(it.arquivos && it.arquivos.length) ? `
        <div class="mt-3">
          <div class="tiny muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📎 Arquivos editáveis</div>
          <div class="flex gap-2" style="flex-wrap:wrap">
            ${it.arquivos.map(a => `<a class="btn btn-ghost btn-sm" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">📄 ${esc(a.nome || 'Arquivo')}</a>`).join('')}
          </div>
        </div>` : ''}
    </div>`;
}

function formHTML(it) {
  const v = it || {};
  const arquivosTxt = (v.arquivos || []).map(a => `${a.nome || ''} | ${a.url || ''}`).join('\n');
  const checklistTxt = (v.checklist || []).join('\n');
  return `
    <div class="card mt-3" style="border:1px solid var(--bd);background:var(--bg-3)">
      <h3 class="card-title" style="font-size:15px">${it ? '✏️ Editar formato' : '➕ Novo formato de reunião'}</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div style="width:70px"><label class="tiny muted">Emoji</label><input id="rf-emoji" class="input" maxlength="8" value="${esc(v.emoji || '')}" placeholder="📋"></div>
        <div style="flex:2;min-width:200px"><label class="tiny muted">Nome *</label><input id="rf-nome" class="input" value="${esc(v.nome || '')}" placeholder="Ex.: Reunião Matinal"></div>
        <div style="flex:1;min-width:140px"><label class="tiny muted">Cadência</label><input id="rf-cad" class="input" value="${esc(v.cadencia || '')}" placeholder="3x por semana"></div>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <div style="flex:2;min-width:200px"><label class="tiny muted">Quando</label><input id="rf-quando" class="input" value="${esc(v.quando || '')}" placeholder="Seg, Qua, Sex — 8h30"></div>
        <div style="flex:1;min-width:120px"><label class="tiny muted">Duração</label><input id="rf-dur" class="input" value="${esc(v.duracao || '')}" placeholder="15 min"></div>
        <div style="flex:2;min-width:200px"><label class="tiny muted">Participantes</label><input id="rf-part" class="input" value="${esc(v.participantes || '')}" placeholder="Equipe de vendas"></div>
      </div>
      <div class="mt-2"><label class="tiny muted">🎯 Objetivo</label><input id="rf-obj" class="input" value="${esc(v.objetivo || '')}" placeholder="Para que serve esta reunião"></div>
      <div class="mt-2"><label class="tiny muted">📋 Pauta / roteiro (uma linha por tópico)</label>
        <textarea id="rf-pauta" class="input" rows="7" style="resize:vertical;font-family:inherit">${esc(v.pauta || '')}</textarea></div>
      <div class="mt-2"><label class="tiny muted">✅ Checklist (uma linha por item)</label>
        <textarea id="rf-check" class="input" rows="4" style="resize:vertical;font-family:inherit">${esc(checklistTxt)}</textarea></div>
      <div class="mt-2"><label class="tiny muted">📎 Arquivos editáveis — uma por linha no formato <b>Nome | link do Drive</b></label>
        <textarea id="rf-arq" class="input" rows="3" style="resize:vertical;font-family:inherit" placeholder="Ata padrão | https://docs.google.com/...">${esc(arquivosTxt)}</textarea></div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary btn-sm" id="rf-save">${_busy ? '⏳ Salvando…' : '💾 Salvar'}</button>
        <button class="btn btn-ghost btn-sm" id="rf-cancel">Cancelar</button>
      </div>
    </div>`;
}

function wire() {
  const $ = s => _root.querySelector(s);
  $('#rn-new') && ($('#rn-new').onclick = () => { _editing = 'new'; render(); });
  _root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { _editing = b.dataset.edit; render(); });
  _root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  $('#rf-cancel') && ($('#rf-cancel').onclick = () => { _editing = null; render(); });
  $('#rf-save') && ($('#rf-save').onclick = save);
  // link mestre do Drive
  $('#dr-edit') && ($('#dr-edit').onclick = () => { _driveEdit = true; render(); });
  $('#dr-cancel') && ($('#dr-cancel').onclick = () => { _driveEdit = false; render(); });
  $('#dr-save') && ($('#dr-save').onclick = saveDrive);
}

async function saveDrive() {
  const $ = s => _root.querySelector(s);
  const url = ($('#dr-url').value || '').trim();
  const label = ($('#dr-label').value || '').trim();
  if (url && !/^https?:\/\//i.test(url)) return alert('Cole um link válido do Google Drive (começando com http/https).');
  try {
    await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'set_drive', drive: { url, label } } });
    _driveEdit = false;
    await load(false);
  } catch (e) { alert('Erro ao salvar o link: ' + e.message); }
}

function parseArquivos(txt) {
  return (txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf('|');
    if (i < 0) return { nome: '', url: l.trim() };
    return { nome: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
  }).filter(a => /^https?:\/\//i.test(a.url));
}

async function save() {
  if (_busy) return;
  const $ = s => _root.querySelector(s);
  const item = {
    emoji: $('#rf-emoji').value.trim(), nome: $('#rf-nome').value.trim(),
    cadencia: $('#rf-cad').value.trim(), quando: $('#rf-quando').value.trim(),
    duracao: $('#rf-dur').value.trim(), participantes: $('#rf-part').value.trim(),
    objetivo: $('#rf-obj').value.trim(), pauta: $('#rf-pauta').value,
    checklist: $('#rf-check').value.split('\n').map(s => s.trim()).filter(Boolean),
    arquivos: parseArquivos($('#rf-arq').value),
  };
  if (!item.nome) return alert('Informe o nome do formato.');
  _busy = true; render();
  try {
    const id = _editing !== 'new' ? _editing : null;
    await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'upsert', id, item } });
    _editing = null; _busy = false;
    await load(false);
  } catch (e) {
    _busy = false; render();
    alert('Erro ao salvar: ' + e.message);
  }
}

async function del(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir o formato "${it?.nome || ''}"?`)) return;
  try {
    await api.request('/api/v3/docs/reunioes', { method: 'POST', body: { action: 'delete', id } });
    await load(false);
  } catch (e) { alert('Erro ao excluir: ' + e.message); }
}
