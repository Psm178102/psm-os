/* PSM-OS v2 — Tabela de Imóveis do mês (Conquista + MAP) — Sprint 9.3 / 9.16
   Dois jeitos de atualizar a tabela do mês:
   1) 📤 Upload do arquivo (PDF/planilha) → Supabase Storage (até ~4MB) — botão.
   2) ⚙️ Link do Google Drive (arquivo grande / reflete sozinho ao trocar no Drive). */
import { getLinks, saveLinks, canEditLinks, driveEmbed, promptLink } from '../links.js';
import { api } from '../api.js';

let _root = null;
let _links = {};

export async function pageTabelaImoveis(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  _links = await getLinks(true);
  render();
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📊 Tabela de Imóveis (mês)</h2>
      <p class="card-sub">Tabelas mensais — <b>Conquista</b> e <b>MAP</b>. Faça o <b>upload do arquivo do mês</b> ou aponte um link do Google Drive.</p>
      <div id="ti-msg"></div>
      ${section('Conquista', 'tabela_conquista', '#dc2626')}
      ${section('MAP', 'tabela_map', '#d4a843')}
    </div>`;

  // Trocar link (Drive)
  _root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const key = b.dataset.edit;
    const lbl = key === 'tabela_conquista' ? 'Conquista' : 'MAP';
    const v = promptLink('Link da Tabela ' + lbl, _links[key]);
    if (v === null) return;
    try { _links = await saveLinks({ [key]: v }); render(); }
    catch (e) { alert('Erro: ' + e.message); }
  }));

  // Upload de arquivo
  _root.querySelectorAll('[data-upload]').forEach(inp => inp.addEventListener('change', () => handleUpload(inp)));
}

function section(label, key, cor) {
  const url = _links[key] || '';
  const emb = driveEmbed(url);
  const edit = canEditLinks();
  return `
    <div class="mt-4" style="border-top:3px solid ${cor};border-radius:10px;padding-top:10px">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0;color:${cor}">🏢 ${label}</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${url ? `<a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">↗ Abrir</a>` : ''}
          ${edit ? `<label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">📤 Upload do mês<input type="file" data-upload="${key}" accept=".pdf,.xlsx,.xls,.csv,image/*" style="display:none"></label>` : ''}
          ${edit ? `<button class="btn btn-ghost btn-sm" data-edit="${key}">⚙️ ${url ? 'Trocar' : 'Definir'} link</button>` : ''}
        </div>
      </div>
      ${url
        ? `<iframe src="${esc(emb)}" style="width:100%;height:72vh;border:1px solid var(--bd,#e5e7eb);border-radius:10px;background:#fff"></iframe>`
        : `<div class="alert alert-warn">Sem tabela ${label} configurada. ${edit ? 'Clique em <b>📤 Upload do mês</b> (PDF/planilha até 4MB) ou <b>Definir link</b> do Drive.' : 'Peça a um gestor para configurar.'}</div>`}
    </div>`;
}

function fileToB64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function handleUpload(input) {
  const key = input.dataset.upload;
  const file = input.files && input.files[0];
  if (!file) return;
  const lbl = key === 'tabela_conquista' ? 'Conquista' : 'MAP';
  const msg = document.getElementById('ti-msg');
  if (file.size > 4 * 1024 * 1024) {
    if (msg) msg.innerHTML = `<div class="alert alert-warn">Arquivo de ${lbl} tem ${(file.size/1048576).toFixed(1)}MB (limite 4MB). Use <b>Definir/Trocar link</b> com o Google Drive.</div>`;
    input.value = '';
    return;
  }
  if (msg) msg.innerHTML = `<div class="muted tiny"><span class="spinner"></span> Enviando tabela ${lbl}…</div>`;
  try {
    const b64 = await fileToB64(file);
    const r = await api.request('/api/v3/upload_file', { method: 'POST', body: { folder: 'tabelas', filename: file.name, content_b64: b64 } });
    if (!r.ok || !r.url) throw new Error(r.error || 'falha no upload');
    _links = await saveLinks({ [key]: r.url });
    render();
    const m2 = document.getElementById('ti-msg');
    if (m2) m2.innerHTML = `<div class="alert alert-ok">✅ Tabela ${lbl} atualizada.</div>`;
  } catch (e) {
    if (msg) msg.innerHTML = `<div class="alert alert-err">Erro no upload de ${lbl}: ${esc(e.message)}</div>`;
    input.value = '';
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
