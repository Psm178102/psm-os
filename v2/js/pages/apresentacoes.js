/* PSM-OS v2 — 🎬 Apresentações PSM (v84.92)
   Menu Início: todo colaborador ASSISTE dentro do sistema (sem download);
   3 marcas: Conquista · Assessoria Imobiliária · Locações. Sócio anexa PDF —
   o navegador converte em slides (pdf.js) e só as imagens sobem pro Storage. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const PDFJS = 'https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs';
const PDFJS_WORKER = 'https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs';

const MARCAS = [
  { id: 'conquista', nome: 'PSM CONQUISTA', emoji: '🏆', cor: '#1e2650',
    sub: 'Residencial · MCMV · primeiro imóvel' },
  { id: 'assessoria', nome: 'PSM ASSESSORIA IMOBILIÁRIA', emoji: '🏛', cor: '#343434',
    sub: 'Alto padrão · assessoria completa' },
  { id: 'locacoes', nome: 'PSM LOCAÇÕES', emoji: '🔑', cor: '#6e6752',
    sub: 'Locação e administração' },
];

let _root = null;
let _meta = null;

export async function pageApresentacoes(ctx, root) {
  _root = root;
  await load();
}

async function load() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando apresentações…</div></div>';
  try { _meta = await api.request('/api/v3/apresentacoes/deck'); }
  catch (e) {
    _root.innerHTML = `<div class="card"><b>⚠️ Não carregou.</b> <span class="tiny muted">${esc(e?.message || e)}</span></div>`;
    return;
  }
  render();
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function render() {
  const podeAnexar = !!_meta?.pode_anexar;
  _root.innerHTML = `
    <div class="card">
      <b style="font-size:16px">🎬 Apresentações PSM</b>
      <p class="tiny muted" style="margin:4px 0 14px">Apresentações institucionais oficiais, por marca — assista direto por aqui.
        Visualização apenas${podeAnexar ? ' · como sócio, você pode anexar/substituir o PDF de cada marca' : ''}.</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        ${MARCAS.map(m => {
          const d = (_meta?.marcas || {})[m.id];
          return `
          <div class="card" style="margin:0;border-top:4px solid ${m.cor}">
            <div style="font-size:34px">${m.emoji}</div>
            <b style="font-family:var(--font-display)">${m.nome}</b>
            <div class="tiny muted">${m.sub}</div>
            <div class="tiny" style="margin:8px 0">${d
              ? `📑 ${d.n_slides} slides${d.nome ? ` · <span class="muted">${esc(d.nome)}</span>` : ''}<br><span class="muted">atualizada em ${new Date(d.ts).toLocaleDateString('pt-BR')}</span>`
              : '<span class="muted">— ainda sem apresentação —</span>'}</div>
            <div class="flex gap-2" style="flex-wrap:wrap">
              ${d ? `<button class="btn btn-primary btn-sm" data-ver="${m.id}">▶️ Assistir</button>` : ''}
              ${podeAnexar ? `<button class="btn btn-ghost btn-sm" data-anexar="${m.id}">📤 ${d ? 'Substituir' : 'Anexar'} PDF</button>` : ''}
            </div>
            <div class="tiny" id="ap-prog-${m.id}" style="margin-top:6px"></div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <input type="file" id="ap-file" accept="application/pdf" style="display:none">`;

  _root.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => abrirViewer(b.dataset.ver));
  _root.querySelectorAll('[data-anexar]').forEach(b => b.onclick = () => escolherPdf(b.dataset.anexar));
}

/* ── visualizador (sem download: só imagens assinadas, sem menu, sem botão salvar) ── */
async function abrirViewer(marca) {
  const info = MARCAS.find(m => m.id === marca);
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:#0b0e1a;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center';
  ov.innerHTML = '<div style="color:#fffbea"><span class="spinner"></span> Carregando apresentação…</div>';
  ov.oncontextmenu = (e) => e.preventDefault();
  document.body.appendChild(ov);
  let d;
  try { d = await api.request('/api/v3/apresentacoes/deck?marca=' + marca); }
  catch (e) { ov.remove(); alert('Falhou: ' + (e?.message || e)); return; }
  const slides = d?.slides || [];
  if (!slides.length) { ov.remove(); alert('Apresentação vazia.'); return; }

  let i = 0;
  const paint = () => {
    ov.innerHTML = `
      <div style="position:absolute;top:12px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;color:#fffbea;z-index:2">
        <b style="font-family:var(--font-display)">${info.emoji} ${info.nome}</b>
        <span class="flex items-center" style="gap:14px">
          <span style="font-size:13px;opacity:.8">${i + 1} / ${slides.length}</span>
          <button id="apv-x" style="background:rgba(255,251,234,.15);color:#fffbea;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:700">✕ Fechar</button>
        </span>
      </div>
      <img src="${slides[i]}" draggable="false"
           style="max-width:96vw;max-height:88vh;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.6);user-select:none;-webkit-user-drag:none">
      ${i > 0 ? '<button id="apv-prev" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:30px;background:rgba(255,251,234,.12);color:#fffbea;border:none;border-radius:10px;padding:14px 16px;cursor:pointer">‹</button>' : ''}
      ${i < slides.length - 1 ? '<button id="apv-next" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:30px;background:rgba(255,251,234,.12);color:#fffbea;border:none;border-radius:10px;padding:14px 16px;cursor:pointer">›</button>' : ''}`;
    ov.oncontextmenu = (e) => e.preventDefault();
    ov.querySelector('#apv-x').onclick = fechar;
    const p = ov.querySelector('#apv-prev'); p && (p.onclick = () => { i--; paint(); });
    const n = ov.querySelector('#apv-next'); n && (n.onclick = () => { i++; paint(); });
    if (i < slides.length - 1) { const pre = new Image(); pre.src = slides[i + 1]; }  // pré-carrega o próximo
  };
  const teclas = (e) => {
    if (e.key === 'Escape') fechar();
    if (e.key === 'ArrowRight' && i < slides.length - 1) { i++; paint(); }
    if (e.key === 'ArrowLeft' && i > 0) { i--; paint(); }
  };
  const fechar = () => { document.removeEventListener('keydown', teclas); ov.remove(); };
  document.addEventListener('keydown', teclas);
  paint();
}

/* ── upload do sócio: PDF → slides JPEG no navegador → Storage ── */
function escolherPdf(marca) {
  const inp = document.getElementById('ap-file');
  inp.onchange = () => { if (inp.files?.length) converterEEnviar(marca, inp.files[0]); inp.value = ''; };
  inp.click();
}

async function converterEEnviar(marca, file) {
  const prog = document.getElementById('ap-prog-' + marca);
  const diga = (t) => { if (prog) prog.innerHTML = t; };
  try {
    diga('<span class="spinner"></span> Lendo o PDF…');
    const pdfjs = await import(/* @vite-ignore */ PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const n = pdf.numPages;
    if (n < 1 || n > 80) { diga('⚠️ PDF com número de páginas fora do limite (1–80).'); return; }
    const pasta = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 8) + '_' + new Date().toISOString().replace(/[-:T]/g, '').slice(8, 14);
    for (let p = 1; p <= n; p++) {
      diga(`<span class="spinner"></span> Convertendo e enviando slide ${p}/${n}…`);
      const page = await pdf.getPage(p);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, 1600 / vp0.width);        // largura ~1600px — nítido em TV
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const jpeg = cv.toDataURL('image/jpeg', 0.85);
      await api.request('/api/v3/apresentacoes/deck', { method: 'POST',
        body: { action: 'slide', marca, pasta, idx: p - 1, jpeg } });
    }
    diga('<span class="spinner"></span> Publicando…');
    await api.request('/api/v3/apresentacoes/deck', { method: 'POST',
      body: { action: 'publicar', marca, pasta, nome: file.name.replace(/\.pdf$/i, ''), n_slides: n } });
    diga(`✅ Publicada — ${n} slides no ar pra equipe inteira.`);
    setTimeout(load, 1200);
  } catch (e) {
    diga('⚠️ Falhou: ' + esc(e?.message || e) + ' — tente de novo.');
  }
}
