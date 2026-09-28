/* PSM-OS v2 — 🗺 Mapa da Venda (Imóveis & Vendas) — v88.37 · componente desde v88.89
   Pedido do Paulo (24/set): aba onde o PDF do mapa da venda aparece renderizado na
   tela, separado por nicho: Conquista · MAP · Terceiros · Locação · Captações.
   Mesmo motor das Apresentações PSM (coleção 'mapa_venda' em /api/v3/apresentacoes/deck):
   o sócio anexa o PDF, o navegador converte cada página em imagem e só as imagens
   sobem pro Storage privado. Aqui as páginas aparecem empilhadas na própria tela,
   com botão de tela cheia. */
import { api } from '../api.js';
import { enviarPdfComoSlides } from './apresentacoes.js';

const COLECAO = 'mapa_venda';
export const NICHOS = [
  { id: 'conquista', nome: 'Conquista', emoji: '🏆', cor: '#806d50' },
  { id: 'map',       nome: 'MAP',       emoji: '🏢', cor: '#343434' },
  { id: 'terceiros', nome: 'Terceiros', emoji: '🤝', cor: '#b8860b' },
  { id: 'locacao',   nome: 'Locação',   emoji: '🔑', cor: 'var(--ink-muted)' },
  { id: 'captacoes', nome: 'Captações', emoji: '📥', cor: '#0f766e' },
];

/* v88.89 — a aba própria saiu do menu: o mapa agora é o passo ② do 🧭 Playbook da Venda
   (scripts.js). A rota antiga /mapa-venda continua funcionando e abre lá, na visão do mapa. */
export { pageMapaVenda } from './scripts.js';

const _paginas = {};   // cache das URLs assinadas por nicho (valem 1h)

/* Desenha o mapa de um nicho dentro de `box`. meta = GET da coleção (marcas + pode_anexar). */
export async function renderMapa(box, nicho, meta, { onPublicado, irEtapas } = {}) {
  const pode = !!meta?.pode_anexar;
  const n = NICHOS.find(x => x.id === nicho);
  if (!n) { box.innerHTML = ''; return; }
  const d = (meta?.marcas || {})[nicho];
  const info = d ? `📑 ${d.n_slides} página(s)${d.nome ? ` · ${esc(d.nome)}` : ''} · atualizado em ${new Date(d.ts).toLocaleDateString('pt-BR')}` : '';
  box.innerHTML = `
    <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:8px">
      <div class="tiny muted" style="flex:1;min-width:200px">${d ? info : 'O caminho inteiro da venda, numa olhada. Depois, em ③, veja o que falar em cada etapa.'}</div>
      ${pode ? `<button class="btn btn-ghost btn-sm" data-mv="anexar">📤 ${d ? 'Substituir' : 'Anexar'} PDF · ${n.nome}</button>` : ''}
      ${d ? '<button class="btn btn-ghost btn-sm" data-mv="cheia">⛶ Tela cheia</button>' : ''}
      ${irEtapas ? '<button class="btn btn-primary btn-sm" data-mv="etapas">③ Ver o que falar em cada etapa →</button>' : ''}
    </div>
    <div class="tiny" data-mv="prog"></div>
    <div data-mv="corpo">${d
      ? '<div class="muted tiny"><span class="spinner"></span> Carregando páginas…</div>'
      : `<div class="muted" style="padding:32px;text-align:center">Ainda não há mapa da venda de <b>${n.nome}</b>.${pode ? ' Clique em “📤 Anexar PDF”.' : ''}</div>`}</div>
    <input type="file" accept="application/pdf" data-mv="file" style="display:none">`;
  const $ = k => box.querySelector(`[data-mv="${k}"]`);
  if ($('etapas')) $('etapas').onclick = irEtapas;
  if ($('anexar')) $('anexar').onclick = () => {
    const inp = $('file');
    inp.onchange = () => { if (inp.files?.length) enviar(inp.files[0], nicho, $('prog'), onPublicado); inp.value = ''; };
    inp.click();
  };
  if (!d) return;
  const paginas = await carregarPaginas(nicho);
  const corpo = $('corpo');
  if (!corpo || !box.isConnected) return;   // trocou de aba enquanto carregava
  corpo.innerHTML = paginas.length
    ? `<div style="display:flex;flex-direction:column;gap:12px;align-items:center">${paginas.map((u, i) =>
        `<img src="${u}" alt="Página ${i + 1}" loading="lazy" draggable="false" style="width:100%;max-width:1200px;border-radius:var(--radius-sm);box-shadow:var(--shadow-1)">`).join('')}</div>`
    : '<div class="alert alert-warn">As páginas não carregaram — tente atualizar.</div>';
  if ($('cheia')) $('cheia').onclick = () => telaCheia(n, paginas);
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

async function enviar(file, nicho, prog, onPublicado) {
  const diga = t => { if (prog) prog.innerHTML = t; };
  try {
    const n = await enviarPdfComoSlides({ colecao: COLECAO, marca: nicho, file, diga });
    if (!n) return;
    delete _paginas[nicho];
    diga(`✅ Publicado — ${n} página(s).`);
    if (onPublicado) setTimeout(onPublicado, 900);
  } catch (e) { diga('⚠️ Falhou: ' + esc(e?.message || e) + ' — tente de novo.'); }
}

function telaCheia(n, paginas) {
  if (!paginas.length) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:#0b0e1a;z-index:1000;display:flex;align-items:center;justify-content:center'; ov.classList.add('force-dark');
  let i = 0;
  const paint = () => {
    ov.innerHTML = `
      <div style="position:absolute;top:12px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;color:#fffbea">
        <b>${n.emoji} Mapa da Venda · ${n.nome}</b>
        <span class="flex items-center" style="gap:14px"><span style="font-size:13px;opacity:.8">${i + 1} / ${paginas.length}</span>
        <button id="mvc-x" style="background:rgba(255,251,234,.15);color:#fffbea;border:none;border-radius:var(--radius-md);padding:6px 14px;cursor:pointer;font-weight:600">✕ Fechar</button></span>
      </div>
      <img src="${paginas[i]}" draggable="false" style="max-width:96vw;max-height:88vh;border-radius:var(--radius-sm)">
      ${i > 0 ? '<button id="mvc-prev" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:26px;background:rgba(255,251,234,.12);color:#fffbea;border:none;border-radius:var(--radius-md);padding:14px 16px;cursor:pointer">‹</button>' : ''}
      ${i < paginas.length - 1 ? '<button id="mvc-next" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:26px;background:rgba(255,251,234,.12);color:#fffbea;border:none;border-radius:var(--radius-md);padding:14px 16px;cursor:pointer">›</button>' : ''}`;
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
