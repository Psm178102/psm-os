/* PSM-OS v2 — Tabela de Imóveis do mês (Conquista + MAP) — Sprint 9.3
   Embute os PDFs/planilhas do Google Drive. Gestão troca o link; o arquivo é
   atualizado no Drive e aqui reflete sozinho (zero re-upload mensal). */
import { getLinks, saveLinks, canEditLinks, driveEmbed, promptLink } from '../links.js';

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
      <p class="card-sub">Tabelas mensais de imóveis — <b>Conquista</b> e <b>MAP</b>. Atualize o arquivo no Google Drive que aqui reflete automaticamente.</p>
      ${section('Conquista', 'tabela_conquista', '#dc2626')}
      ${section('MAP', 'tabela_map', '#d4a843')}
    </div>`;
  _root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const key = b.dataset.edit;
    const lbl = key === 'tabela_conquista' ? 'Conquista' : 'MAP';
    const v = promptLink('Link da Tabela ' + lbl, _links[key]);
    if (v === null) return;
    try { _links = await saveLinks({ [key]: v }); render(); }
    catch (e) { alert('Erro: ' + e.message); }
  }));
}

function section(label, key, cor) {
  const url = _links[key] || '';
  const emb = driveEmbed(url);
  return `
    <div class="mt-4" style="border-top:3px solid ${cor};border-radius:10px;padding-top:10px">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0;color:${cor}">🏢 ${label}</h3>
        <div class="flex gap-2">
          ${url ? `<a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">↗ Abrir no Drive</a>` : ''}
          ${canEditLinks() ? `<button class="btn btn-ghost btn-sm" data-edit="${key}">⚙️ ${url ? 'Trocar' : 'Definir'} link</button>` : ''}
        </div>
      </div>
      ${url
        ? `<iframe src="${esc(emb)}" style="width:100%;height:72vh;border:1px solid var(--bd,#e5e7eb);border-radius:10px;background:#fff"></iframe>`
        : `<div class="alert alert-warn">Sem tabela ${label} configurada. ${canEditLinks() ? 'Clique em <b>Definir link</b> e cole o link do Google Drive (PDF/planilha compartilhada).' : 'Peça a um gestor para configurar.'}</div>`}
    </div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
