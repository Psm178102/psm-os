/* PSM-OS v2 — 🗺 Mapa da Venda (Imóveis & Vendas) — v88.37
   Pedido do Paulo (24/set): aba onde o PDF do mapa da venda aparece renderizado na
   tela, separado por nicho: Conquista · MAP · Terceiros · Locação · Captações.
   Mesmo motor das Apresentações PSM (coleção 'mapa_venda' em /api/v3/apresentacoes/deck):
   o sócio anexa o PDF, o navegador converte cada página em imagem e só as imagens
   sobem pro Storage privado. Aqui as páginas aparecem empilhadas na própria tela,
   com botão de tela cheia. */
import { api } from '../api.js';
import { enviarPdfComoSlides } from './apresentacoes.js';

const COLECAO = 'mapa_venda';
const NICHOS = [
  { id: 'conquista', nome: 'Conquista', emoji: '🏆', cor: '#1e2650' },
  { id: 'map',       nome: 'MAP',       emoji: '🏢', cor: '#343434' },
  { id: 'terceiros', nome: 'Terceiros', emoji: '🤝', cor: '#b8860b' },
  { id: 'locacao',   nome: 'Locação',   emoji: '🔑', cor: '#6e6752' },
  { id: 'captacoes', nome: 'Captações', emoji: '📥', cor: '#0f766e' },
];

let _root = null;
let _meta = null;
let _nicho = 'conquista';
const _paginas = {};   // cache das URLs assinadas por nicho (valem 1h)

export async function pageMapaVenda(ctx, root) {
  _root = root;
  if (NICHOS.some(n => n.id === ctx?.query?.nicho)) _nicho = ctx.query.nicho;
  await load();
}

async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando o mapa da venda…</div></div>';
  try { _meta = await api.request(`/api/v3/apresentacoes/deck?colecao=${COLECAO}`); }
  catch (e) { _root.innerHTML = `<div class="alert alert-err">Não carregou: ${esc(e?.message || e)}</div>`; return; }
  await render();
}

async function render() {
  const pode = !!_meta?.pode_anexar;
  const n = NICHOS.find(x => x.id === _nicho);
  const d = (_meta?.marcas || {})[_nicho];
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <h2 class="card-title" style="margin:0">🗺 Mapa da Venda</h2>
          <p class="card-sub" style="margin:2px 0 0">O caminho da venda de cada nicho, do primeiro contato à assinatura.</p>
        </div>
        ${pode ? `<button class="btn btn-ghost btn-sm" id="mv-anexar">📤 ${d ? 'Substituir' : 'Anexar'} PDF · ${n.nome}</button>` : ''}
        ${d ? '<button class="btn btn-primary btn-sm" id="mv-cheia">⛶ Tela cheia</button>' : ''}
      </div>
      <div class="flex gap-1" style="margin-top:14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        ${NICHOS.map(x => {
          const on = x.id === _nicho, tem = !!(_meta?.marcas || {})[x.id];
          return `<button class="btn" data-nicho="${x.id}" style="border-radius:var(--r-sm) var(--r-sm) 0 0;background:${on ? x.cor : 'transparent'};color:${on ? '#fff' : 'var(--ink-muted)'};border-bottom:none">${x.emoji} ${x.nome}${tem ? '' : ' <span style="opacity:.6">·</span>'}</button>`;
        }).join('')}
      </div>
      <div class="tiny" id="mv-prog" style="margin-top:8px"></div>
      <div id="mv-corpo" style="margin-top:10px">${d
        ? `<div class="tiny muted" style="margin-bottom:8px">📑 ${d.n_slides} página(s)${d.nome ? ` · ${esc(d.nome)}` : ''} · atualizado em ${new Date(d.ts).toLocaleDateString('pt-BR')}</div><div class="muted tiny"><span class="spinner"></span> Carregando páginas…</div>`
        : `<div class="muted" style="padding:32px;text-align:center">Ainda não há mapa da venda de <b>${n.nome}</b>.${pode ? ' Clique em “📤 Anexar PDF”.' : ''}</div>`}</div>
    </div>
    <input type="file" id="mv-file" accept="application/pdf" style="display:none">`;

  _root.querySelectorAll('[data-nicho]').forEach(b => b.onclick = () => { _nicho = b.dataset.nicho; render(); });
  const anexar = _root.querySelector('#mv-anexar');
  if (anexar) anexar.onclick = () => {
    const inp = _root.querySelector('#mv-file');
    inp.onchange = () => { if (inp.files?.length) enviar(inp.files[0]); inp.value = ''; };
    inp.click();
  };
  if (!d) return;
  const paginas = await carregarPaginas(_nicho);
  const corpo = _root.querySelector('#mv-corpo');
  if (!corpo || _nicho !== n.id) return;   // trocou de aba enquanto carregava
  corpo.innerHTML = `<div class="tiny muted" style="margin-bottom:8px">📑 ${d.n_slides} página(s)${d.nome ? ` · ${esc(d.nome)}` : ''} · atualizado em ${new Date(d.ts).toLocaleDateString('pt-BR')}</div>`
    + (paginas.length
      ? `<div style="display:flex;flex-direction:column;gap:12px;align-items:center">${paginas.map((u, i) =>
          `<img src="${u}" alt="Página ${i + 1}" loading="lazy" draggable="false" style="width:100%;max-width:1200px;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.15)">`).join('')}</div>`
      : '<div class="alert alert-warn">As páginas não carregaram — tente atualizar.</div>');
  const cheia = _root.querySelector('#mv-cheia');
  if (cheia) cheia.onclick = () => telaCheia(n, paginas);
}

async function carregarPaginas(nicho) {
  const c = _paginas[nicho];
  if (c && Date.now() - c.t < 50 * 60 * 1000) return c.urls;
  try {
    const r = await api.request(`/api/v3/apresentacoes/deck?colecao=${COLECAO}&marca=${nicho}`);
    _paginas[nicho] = { t: Date.now(), urls: r.slides || [] };
    return _paginas[nicho].urls;
  } catch (_) { return []; }
}

async function enviar(file) {
  const prog = _root.querySelector('#mv-prog');
  const diga = t => { if (prog) prog.innerHTML = t; };
  const nicho = _nicho;
  try {
    const n = await enviarPdfComoSlides({ colecao: COLECAO, marca: nicho, file, diga });
    if (!n) return;
    delete _paginas[nicho];
    diga(`✅ Publicado — ${n} página(s).`);
    setTimeout(load, 900);
  } catch (e) { diga('⚠️ Falhou: ' + esc(e?.message || e) + ' — tente de novo.'); }
}

function telaCheia(n, paginas) {
  if (!paginas.length) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:#0b0e1a;z-index:1000;display:flex;align-items:center;justify-content:center';
  let i = 0;
  const paint = () => {
    ov.innerHTML = `
      <div style="position:absolute;top:12px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;color:#fffbea">
        <b>${n.emoji} Mapa da Venda · ${n.nome}</b>
        <span class="flex items-center" style="gap:14px"><span style="font-size:13px;opacity:.8">${i + 1} / ${paginas.length}</span>
        <button id="mvc-x" style="background:rgba(255,251,234,.15);color:#fffbea;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:700">✕ Fechar</button></span>
      </div>
      <img src="${paginas[i]}" draggable="false" style="max-width:96vw;max-height:88vh;border-radius:6px">
      ${i > 0 ? '<button id="mvc-prev" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:30px;background:rgba(255,251,234,.12);color:#fffbea;border:none;border-radius:10px;padding:14px 16px;cursor:pointer">‹</button>' : ''}
      ${i < paginas.length - 1 ? '<button id="mvc-next" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:30px;background:rgba(255,251,234,.12);color:#fffbea;border:none;border-radius:10px;padding:14px 16px;cursor:pointer">›</button>' : ''}`;
    ov.querySelector('#mvc-x').onclick = fechar;
    const p = ov.querySelector('#mvc-prev'); if (p) p.onclick = () => { i--; paint(); };
    const x = ov.querySelector('#mvc-next'); if (x) x.onclick = () => { i++; paint(); };
  };
  const teclas = e => {
    if (e.key === 'Escape') fechar();
    if (e.key === 'ArrowRight' && i < paginas.length - 1) { i++; paint(); }
    if (e.key === 'ArrowLeft' && i > 0) { i--; paint(); }
  };
  const fechar = () => { document.removeEventListener('keydown', teclas); ov.remove(); };
  document.addEventListener('keydown', teclas);
  document.body.appendChild(ov);
  paint();
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
