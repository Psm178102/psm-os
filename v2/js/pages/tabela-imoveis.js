/* PSM-OS v2 — Tabela de Imóveis do mês (Conquista + MAP) — v81.0
   A planilha (xlsx/csv) é PARSEADA no upload e RENDERIZADA como tabela HTML dentro do
   sistema (antes o iframe baixava o arquivo). PDF/imagem/Drive continuam embutidos em iframe.
   Atualização mensal: o gestor sobe o arquivo do mês e a tabela troca na hora. */
import { getLinks, saveLinks, canEditLinks, driveEmbed, promptLink } from '../links.js';
import { api } from '../api.js';

let _root = null;
let _links = {};
let _dados = { conquista: null, map: null };
let _canEdit = false;

const SECOES = [
  { label: 'Conquista', linkKey: 'tabela_conquista', equipe: 'conquista', cor: '#dc2626' },
  { label: 'MAP', linkKey: 'tabela_map', equipe: 'map', cor: '#d4a843' },
];

export async function pageTabelaImoveis(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  await loadAll();
  render();
}

async function loadAll() {
  _links = await getLinks(true).catch(() => ({}));
  try {
    const r = await api.request('/api/v3/tabelas/dados');
    _dados = { conquista: r.conquista || null, map: r.map || null };
    _canEdit = !!r.can_edit;
  } catch (_) { _dados = { conquista: null, map: null }; _canEdit = canEditLinks(); }
}

function loadXLSX() {
  return new Promise((resolve) => {
    if (window.XLSX) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve; s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📊 Tabela de Lançamentos PSM (mês)</h2>
      <p class="card-sub">Renderizada dentro do sistema — <b>Conquista</b> e <b>MAP</b>. O gestor sobe o arquivo do mês (xlsx/csv) e a tabela atualiza na hora.</p>
      <div id="ti-msg"></div>
      ${SECOES.map(s => section(s)).join('')}
    </div>`;
  wire();
}

function section({ label, linkKey, equipe, cor }) {
  const url = _links[linkKey] || '';
  const d = _dados[equipe];
  const temTabela = d && Array.isArray(d.linhas) && d.linhas.length;
  const dl = (temTabela && d.url) ? d.url : url;   // arquivo original p/ baixar

  return `
    <div class="mt-4" style="border-top:3px solid ${cor};border-radius:10px;padding-top:10px">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0;color:${cor}">🏢 ${label}${temTabela ? ` <span class="tiny muted" style="font-weight:600">· ${d.linhas.length} linha(s) · atualizado ${fmtData(d.atualizado_em)}</span>` : ''}</h3>
        <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
          ${temTabela ? `<input class="input" data-search="${equipe}" placeholder="🔍 buscar…" style="height:30px;font-size:12px;width:160px">` : ''}
          ${dl ? `<a class="btn btn-ghost btn-sm" href="${esc(dl)}" target="_blank" rel="noopener" download>↓ Baixar original</a>` : ''}
          ${_canEdit ? `<label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">📤 Atualizar (arquivo do mês)<input type="file" data-upload="${equipe}" accept=".xlsx,.xls,.csv,.pdf,image/*" style="display:none"></label>` : ''}
          ${_canEdit ? `<button class="btn btn-ghost btn-sm" data-edit="${linkKey}">⚙️ ${url ? 'Trocar' : 'Definir'} link Drive</button>` : ''}
        </div>
      </div>
      ${temTabela
        ? tabelaHtml(d, equipe, cor)
        : (url
          ? `<iframe src="${esc(driveEmbed(url))}" style="width:100%;height:72vh;border:1px solid var(--border);border-radius:10px;background:#fff"></iframe>`
          : `<div class="alert alert-warn">Sem tabela de ${label}. ${_canEdit ? 'Clique em <b>📤 Atualizar (arquivo do mês)</b> e suba a planilha (xlsx/csv) — ela renderiza aqui dentro.' : 'Peça a um gestor para subir a tabela do mês.'}</div>`)}
    </div>`;
}

function tabelaHtml(d, equipe, cor) {
  const cols = d.colunas && d.colunas.length ? d.colunas : (d.linhas[0] || []).map((_, i) => 'Col ' + (i + 1));
  const head = `<thead><tr>${cols.map(c => `<th style="position:sticky;top:0;background:${cor};color:#fff;padding:7px 9px;font-size:11.5px;text-align:left;white-space:nowrap;z-index:1">${esc(c)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${d.linhas.map(r => `<tr style="border-bottom:1px solid var(--border)">${cols.map((_, i) => `<td style="padding:6px 9px;font-size:12px;white-space:nowrap">${esc(r[i] != null ? r[i] : '')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div data-tablewrap="${equipe}" style="max-height:72vh;overflow:auto;border:1px solid var(--border);border-radius:10px;background:var(--bg-2)">
      <table style="border-collapse:collapse;width:100%;min-width:max-content">${head}${body}</table>
    </div>`;
}

function wire() {
  _root.querySelectorAll('[data-upload]').forEach(inp => inp.addEventListener('change', () => handleUpload(inp)));
  _root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const key = b.dataset.edit;
    const lbl = key === 'tabela_conquista' ? 'Conquista' : 'MAP';
    const v = promptLink('Link da Tabela ' + lbl + ' (Google Drive/Sheets)', _links[key]);
    if (v === null) return;
    try { _links = await saveLinks({ [key]: v }); render(); } catch (e) { alert('Erro: ' + e.message); }
  }));
  // busca client-side (filtra linhas por texto)
  _root.querySelectorAll('[data-search]').forEach(inp => inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase();
    const wrap = _root.querySelector(`[data-tablewrap="${inp.dataset.search}"]`);
    if (!wrap) return;
    wrap.querySelectorAll('tbody tr').forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }));
}

function fileToB64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
}

async function handleUpload(input) {
  const equipe = input.dataset.upload;
  const file = input.files && input.files[0];
  if (!file) return;
  const lbl = equipe === 'conquista' ? 'Conquista' : 'MAP';
  const msg = document.getElementById('ti-msg');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isSheet = ['xlsx', 'xls', 'csv'].includes(ext);
  const setMsg = (h) => { const m = document.getElementById('ti-msg'); if (m) m.innerHTML = h; };
  setMsg(`<div class="muted tiny"><span class="spinner"></span> Processando tabela ${lbl}…</div>`);

  try {
    if (isSheet) {
      await loadXLSX();
      if (!window.XLSX) throw new Error('não consegui carregar o leitor de planilha');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      if (!aoa.length) throw new Error('planilha vazia');
      const colunas = (aoa[0] || []).map(c => String(c == null ? '' : c));
      const linhas = aoa.slice(1).filter(r => r.some(c => String(c).trim() !== ''))
        .map(r => r.map(c => (c == null ? '' : String(c))));
      // mantém o arquivo original p/ download (se couber)
      let url = '';
      try {
        if (file.size <= 4 * 1024 * 1024) {
          const up = await api.request('/api/v3/upload_file', { method: 'POST', body: { folder: 'tabelas', filename: file.name, content_b64: await fileToB64(file) } });
          if (up.ok && up.url) url = up.url;
        }
      } catch (_) {}
      await api.request('/api/v3/tabelas/dados', { method: 'POST', body: { equipe, colunas, linhas, filename: file.name, url } });
      await loadAll(); render();
      setMsg(`<div class="alert alert-ok">✅ Tabela ${lbl} atualizada — ${linhas.length} linha(s) renderizada(s).</div>`);
    } else {
      // PDF/imagem → embute em iframe (não dá pra virar tabela); limpa dados parseados
      if (file.size > 4 * 1024 * 1024) { setMsg(`<div class="alert alert-warn">Arquivo de ${lbl} tem ${(file.size / 1048576).toFixed(1)}MB (limite 4MB). Use <b>Definir link</b> do Drive.</div>`); input.value = ''; return; }
      const up = await api.request('/api/v3/upload_file', { method: 'POST', body: { folder: 'tabelas', filename: file.name, content_b64: await fileToB64(file) } });
      if (!up.ok || !up.url) throw new Error(up.error || 'falha no upload');
      _links = await saveLinks({ ['tabela_' + equipe]: up.url });
      try { await api.request('/api/v3/tabelas/dados', { method: 'POST', body: { equipe, colunas: [], linhas: [], filename: file.name, url: up.url } }); } catch (_) {}
      await loadAll(); render();
      setMsg(`<div class="alert alert-ok">✅ ${lbl}: ${ext.toUpperCase()} embutido.</div>`);
    }
  } catch (e) {
    setMsg(`<div class="alert alert-err">Erro ao processar ${lbl}: ${esc(e.message)}</div>`);
    input.value = '';
  }
}

function fmtData(iso) {
  if (!iso) return '—';
  try { const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
