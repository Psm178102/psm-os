/* PSM-OS v2 — 📂 Documentos PSM (Jurídico) — v88.37
   Pedido do Paulo (24/set): um índice dos documentos da PSM, separado por documento,
   pasta e o link do Google Drive. O arquivo fica no Drive; aqui fica o endereço dele.
   Backend: /api/v3/juridico/documentos (shared_kv 'juridico_documentos').
   Lê: quem tem o item no menu (lvl>=2). Edita: sócio/diretor (lvl>=8). */
import { api } from '../api.js';

let _root = null;
let _itens = [];
let _pode = false;
let _busca = '';
let _edit = null;   // item em edição (null = fechado; {} = novo)

export async function pageDocumentosPsm(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="muted tiny"><span class="spinner"></span> Carregando documentos…</div></div>';
  try {
    const r = await api.request('/api/v3/juridico/documentos');
    _itens = r.itens || [];
    _pode = !!r.pode_editar;
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Não deu pra carregar os documentos: ${esc(e.message)}</div>`;
    return;
  }
  render();
}

function render() {
  const q = _busca.trim().toLowerCase();
  const vis = _itens.filter(i => !q || [i.documento, i.pasta, i.obs].some(v => String(v || '').toLowerCase().includes(q)));
  const pastas = {};
  vis.forEach(i => { (pastas[i.pasta || 'Geral'] = pastas[i.pasta || 'Geral'] || []).push(i); });
  const nomes = Object.keys(pastas).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const todasPastas = [...new Set(_itens.map(i => i.pasta || 'Geral'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <h2 class="card-title" style="margin:0">📂 Documentos PSM</h2>
          <p class="card-sub" style="margin:2px 0 0">Índice dos documentos da empresa por pasta, com o link do Google Drive. O arquivo continua no Drive.</p>
        </div>
        <input class="input" id="dp-busca" placeholder="🔎 Buscar documento ou pasta" value="${esc(_busca)}" style="max-width:260px">
        ${_pode ? '<button class="btn btn-primary" id="dp-novo">＋ Novo documento</button>' : ''}
      </div>
      ${_edit ? form(todasPastas) : ''}
      <div class="tiny muted" style="margin-top:10px">${_itens.length} documento(s) em ${todasPastas.length} pasta(s)${q ? ` · ${vis.length} na busca` : ''}</div>
      ${nomes.length ? nomes.map(p => pasta(p, pastas[p])).join('') : `<div class="muted" style="padding:24px;text-align:center">${_itens.length ? 'Nada encontrado nessa busca.' : (_pode ? 'Nenhum documento ainda — clique em “＋ Novo documento”.' : 'Nenhum documento cadastrado ainda.')}</div>`}
    </div>`;
  wire();
}

function pasta(nome, itens) {
  itens.sort((a, b) => String(a.documento).localeCompare(String(b.documento), 'pt-BR'));
  return `
    <div style="margin-top:14px">
      <div style="font-weight:800;font-size:13px;padding:6px 0;border-bottom:2px solid var(--border)">📁 ${esc(nome)} <span class="tiny muted" style="font-weight:400">· ${itens.length}</span></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left" class="tiny muted"><th style="padding:6px 8px">Documento</th><th style="padding:6px 8px">Pasta</th><th style="padding:6px 8px">Link do Google Drive</th>${_pode ? '<th></th>' : ''}</tr></thead>
        <tbody>${itens.map(linha).join('')}</tbody>
      </table></div>
    </div>`;
}

function linha(i) {
  return `<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:7px 8px"><b>${esc(i.documento)}</b>${i.obs ? `<div class="tiny muted">${esc(i.obs)}</div>` : ''}</td>
    <td style="padding:7px 8px">${esc(i.pasta || 'Geral')}</td>
    <td style="padding:7px 8px;word-break:break-all">${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">🔗 Abrir no Drive</a>` : '<span class="muted">—</span>'}</td>
    ${_pode ? `<td style="padding:7px 8px;white-space:nowrap;text-align:right">
      <button class="btn btn-ghost btn-sm" data-dp-edit="${esc(i.id)}">✏️</button>
      <button class="btn btn-ghost btn-sm" data-dp-del="${esc(i.id)}" style="color:var(--err)">🗑</button></td>` : ''}
  </tr>`;
}

function form(todasPastas) {
  const e = _edit || {};
  return `
    <div style="margin-top:12px;background:var(--bg-3);border-radius:10px;padding:12px">
      <div style="font-weight:700;margin-bottom:8px">${e.id ? '✏️ Editar documento' : '＋ Novo documento'}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">
        <label class="tiny">Documento<input class="input" id="dp-doc" value="${esc(e.documento || '')}" placeholder="Ex.: Contrato social PSM Imóveis"></label>
        <label class="tiny">Pasta<input class="input" id="dp-pasta" list="dp-pastas" value="${esc(e.pasta || '')}" placeholder="Ex.: Societário"></label>
        <label class="tiny" style="grid-column:1/-1">Link do Google Drive<input class="input" id="dp-link" value="${esc(e.link || '')}" placeholder="https://drive.google.com/…"></label>
        <label class="tiny" style="grid-column:1/-1">Observação (opcional)<input class="input" id="dp-obs" value="${esc(e.obs || '')}"></label>
      </div>
      <datalist id="dp-pastas">${todasPastas.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-primary btn-sm" id="dp-salvar">💾 Salvar</button>
        <button class="btn btn-ghost btn-sm" id="dp-cancelar">Cancelar</button>
        <span class="tiny" id="dp-msg" style="align-self:center"></span>
      </div>
    </div>`;
}

function wire() {
  const q = s => _root.querySelector(s);
  const busca = q('#dp-busca');
  if (busca) busca.addEventListener('input', () => {
    _busca = busca.value; const pos = busca.selectionStart; render();
    const b2 = q('#dp-busca'); b2.focus(); b2.setSelectionRange(pos, pos);
  });
  q('#dp-novo')?.addEventListener('click', () => { _edit = {}; render(); q('#dp-doc')?.focus(); });
  q('#dp-cancelar')?.addEventListener('click', () => { _edit = null; render(); });
  q('#dp-salvar')?.addEventListener('click', salvar);
  _root.querySelectorAll('[data-dp-edit]').forEach(b => b.addEventListener('click', () => {
    _edit = _itens.find(i => i.id === b.dataset.dpEdit) || null; render(); _root.scrollIntoView({ block: 'start' });
  }));
  _root.querySelectorAll('[data-dp-del]').forEach(b => b.addEventListener('click', async () => {
    const it = _itens.find(i => i.id === b.dataset.dpDel);
    if (!it || !confirm(`Excluir "${it.documento}" do índice? (o arquivo no Drive não é apagado)`)) return;
    try { const r = await api.request('/api/v3/juridico/documentos', { method: 'POST', body: { action: 'delete', id: it.id } }); _itens = r.itens || []; render(); }
    catch (e) { alert('Não deu pra excluir: ' + e.message); }
  }));
}

async function salvar() {
  const v = id => (_root.querySelector(id)?.value || '').trim();
  const item = { id: _edit?.id, documento: v('#dp-doc'), pasta: v('#dp-pasta'), link: v('#dp-link'), obs: v('#dp-obs') };
  const msg = _root.querySelector('#dp-msg');
  if (!item.documento) { msg.textContent = '⚠️ Informe o nome do documento.'; return; }
  msg.textContent = 'Salvando…';
  try {
    const r = await api.request('/api/v3/juridico/documentos', { method: 'POST', body: { action: 'upsert', item } });
    _itens = r.itens || []; _edit = null; render();
  } catch (e) { msg.textContent = '❌ ' + e.message; }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
