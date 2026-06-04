/* PSM-OS v2 — Biblioteca de Anúncios dos Concorrentes (Meta Ad Library)
   Snapshots por concorrente + análise da IA (produto, formatos, ganchos,
   frequência, teste×escala). Dado real da Biblioteca pública do Meta; gasto é
   sempre ESTIMATIVA (Meta não publica verba de anúncio comercial). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _latest = [], _pending = false, _detail = null, _aiPreview = null, _aiBusy = false;

export async function pageBibliotecaAds(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder ou acima.</div>'; return; }
  await reload();
}

async function reload() {
  _root.innerHTML = spinner('Carregando inteligência de biblioteca…');
  try {
    const r = await api.request('/api/v3/marketing/ad_library');
    _latest = r.latest || []; _pending = !!r.pending;
    renderList(r);
  } catch (e) { _root.innerHTML = err(e.message); }
}

function renderList(r) {
  _detail = null;
  const tip = '📚 Abra a Biblioteca de Anúncios do Meta (facebook.com/ads/library), filtre o concorrente, copie os anúncios e cole aqui pra a IA analisar. Faça de tempos em tempos pra acompanhar a evolução.';
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">📚 Biblioteca de Anúncios · Concorrentes</h2>
          <p class="card-sub">${(r.total_concorrentes||0)} concorrentes monitorados · ${(r.total_ads||0)} anúncios ativos somados · análise por IA.</p>
        </div>
        <a class="btn btn-ghost" href="https://www.facebook.com/ads/library/" target="_blank" rel="noopener">🔎 Abrir Biblioteca do Meta</a>
        <button class="btn btn-primary" id="bl-new">+ Novo snapshot</button>
      </div>
      ${_pending ? `<div class="alert alert-warn mt-3">⏳ Tabela ainda não criada — rode <code>supabase/sprint9_19_ad_library.sql</code> no Supabase pra ativar.</div>` : ''}
      ${(!_latest.length && !_pending) ? `<div class="muted" style="padding:20px;text-align:center">Nenhum snapshot ainda. <br><span class="tiny">${tip}</span></div>` : ''}
      <div class="mt-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">
        ${_latest.map(card).join('')}
      </div>
      <div class="tiny muted" style="margin-top:14px">⚠️ O Meta não publica o gasto de anúncio comercial — o "investimento" é estimativa qualitativa (teste×escala) pela quantidade/variação/tempo dos criativos, não R$ real.</div>
      <div id="bl-modal" style="display:none"></div>
    </div>`;
  document.getElementById('bl-new').addEventListener('click', () => openForm());
  _root.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.open)));
}

function card(s) {
  const d = s.delta;
  const deltaTxt = d == null ? '' : (d > 0 ? `<span style="color:#16a34a">▲ ${d}</span>` : d < 0 ? `<span style="color:#dc2626">▼ ${Math.abs(d)}</span>` : '<span class="muted">=</span>');
  const inv = { alto: ['#dc2626', '🔴 Alto'], medio: ['#d97706', '🟡 Médio'], baixo: ['#16a34a', '🟢 Baixo'] }[s.nivel_invest] || ['#64748b', '—'];
  return `<div data-open="${escapeHtml(s.concorrente)}" style="cursor:pointer;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
    <div class="flex items-center gap-2" style="margin-bottom:6px">
      <div style="font-weight:800;font-size:14px;flex:1">${escapeHtml(s.concorrente)}</div>
      <div style="text-align:right"><div style="font-size:22px;font-weight:900">${s.ads_count || 0}</div><div class="tiny muted">anúncios ${deltaTxt}</div></div>
    </div>
    ${s.segmento ? `<div class="tiny muted">🏷 ${escapeHtml(s.segmento)}</div>` : ''}
    <div class="flex items-center gap-2" style="margin-top:6px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;color:${inv[0]}">💸 ${inv[1]}</span>
      <span class="tiny muted" style="margin-left:auto">${fmtD(s.captured_at)}</span>
    </div>
    ${s.ai_analysis ? '<div class="tiny" style="margin-top:6px;color:#7c3aed;font-weight:600">🧠 análise IA disponível</div>' : ''}
  </div>`;
}

async function openDetail(conc) {
  _root.innerHTML = spinner('Carregando histórico de ' + conc + '…');
  try {
    const r = await api.request('/api/v3/marketing/ad_library?concorrente=' + encodeURIComponent(conc));
    _detail = { conc, history: r.history || [] };
    renderDetail();
  } catch (e) { _root.innerHTML = err(e.message); }
}

function renderDetail() {
  const { conc, history } = _detail;
  const cur = history[0] || {};
  const maxC = Math.max(1, ...history.map(h => h.ads_count || 0));
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:8px">
        <button class="btn btn-ghost" id="bl-back">← Concorrentes</button>
        ${cur.url ? `<a class="btn btn-ghost" href="${escapeHtml(cur.url)}" target="_blank" rel="noopener">🔎 Abrir na Biblioteca</a>` : ''}
        <button class="btn btn-primary" id="bl-new" style="margin-left:auto">+ Novo snapshot</button>
      </div>
      <h2 class="card-title">📚 ${escapeHtml(conc)}</h2>
      <p class="card-sub">${history.length} snapshot(s) · último ${fmtD(cur.captured_at)} · ${cur.ads_count || 0} anúncios ativos${cur.segmento ? ' · ' + escapeHtml(cur.segmento) : ''}</p>

      ${history.length > 1 ? `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px;margin-top:10px">
        <div style="font-weight:800;font-size:13px;margin-bottom:8px">📈 Volume de anúncios ao longo do tempo</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px">
          ${history.slice().reverse().map(h => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px" title="${fmtD(h.captured_at)}: ${h.ads_count||0} anúncios">
            <div style="font-size:9px;font-weight:700">${h.ads_count||0}</div>
            <div style="width:100%;max-width:34px;height:${Math.max(4,(h.ads_count||0)/maxC*60)}px;background:#7c3aed;border-radius:4px 4px 0 0"></div>
            <div style="font-size:8px;color:var(--ink-muted)">${fmtD(h.captured_at).slice(0,5)}</div>
          </div>`).join('')}
        </div></div>` : ''}

      ${cur.ai_analysis ? `<div style="margin-top:12px;background:linear-gradient(180deg,rgba(124,58,237,.06),transparent);border:1px solid rgba(124,58,237,.25);border-radius:var(--r-md);padding:14px 16px">
        <div style="font-weight:800;font-size:13px;color:#7c3aed;margin-bottom:8px">🧠 Análise da IA</div>
        <div style="font-size:13px;line-height:1.55">${mdLite(cur.ai_analysis)}</div></div>` : '<div class="muted tiny" style="margin-top:12px">Sem análise da IA neste snapshot.</div>'}

      ${cur.conteudo ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700;font-size:13px">📋 Anúncios capturados (texto)</summary>
        <pre style="white-space:pre-wrap;font-size:12px;background:var(--bg-3);border-radius:8px;padding:12px;margin-top:8px;max-height:400px;overflow:auto">${escapeHtml(cur.conteudo)}</pre></details>` : ''}

      <div id="bl-modal" style="display:none"></div>
    </div>`;
  document.getElementById('bl-back').addEventListener('click', () => reload());
  document.getElementById('bl-new').addEventListener('click', () => openForm(conc));
}

function openForm(conc) {
  _aiPreview = null;
  const modal = document.getElementById('bl-modal');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto';
  modal.innerHTML = `
    <div class="card" style="margin:20px 0;max-width:640px;width:100%">
      <h3 class="card-title">📚 Novo snapshot de biblioteca</h3>
      <p class="card-sub">Abra a Biblioteca do Meta, filtre o concorrente, copie os anúncios e cole abaixo. A IA analisa.</p>
      <div class="flex gap-2" style="flex-wrap:wrap;margin-top:6px">
        <div class="field" style="flex:1;min-width:180px"><label>Concorrente *</label><input id="bl-conc" class="input" value="${escapeHtml(conc || '')}" placeholder="Ex.: Imobiliária X"></div>
        <div class="field" style="min-width:120px"><label>Nº anúncios ativos</label><input id="bl-count" class="input" type="number" min="0" value="0"></div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:180px"><label>Link da Biblioteca</label><input id="bl-url" class="input" placeholder="https://www.facebook.com/ads/library/?...">
        </div>
        <div class="field" style="min-width:140px"><label>Produto/linha</label><input id="bl-seg" class="input" placeholder="MCMV / Alto padrão…"></div>
      </div>
      <div class="field"><label>Anúncios colados (copies, um por bloco)</label>
        <textarea id="bl-cont" class="input" rows="6" placeholder="Cole aqui os textos dos anúncios da Biblioteca (separe por linha em branco). Opcional se você anexar prints dos criativos abaixo."></textarea></div>
      <div class="field"><label>🖼️ Prints dos criativos — a IA ENXERGA a imagem (opcional)</label>
        <input id="bl-imgs" class="input" type="file" accept="image/*" multiple>
        <div class="tiny muted" style="margin-top:3px">Tire prints dos anúncios na Biblioteca do Meta e anexe (até 6). A IA analisa gancho visual, overlay de oferta, cores e prova social — não só o texto.</div></div>
      <div class="flex gap-2" style="align-items:center">
        <button class="btn btn-ghost" id="bl-ai">🧠 Analisar com IA (visão)</button>
        <span id="bl-ai-status" class="tiny muted"></span>
      </div>
      <div id="bl-ai-prev" style="margin-top:8px"></div>
      <div id="bl-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="bl-cancel">Cancelar</button>
        <button class="btn btn-primary" id="bl-save">Salvar snapshot</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
  const close = () => { modal.style.display = 'none'; modal.innerHTML = ''; };
  document.getElementById('bl-cancel').addEventListener('click', close);
  document.getElementById('bl-ai').addEventListener('click', analyzeAI);
  document.getElementById('bl-save').addEventListener('click', async () => {
    const concV = document.getElementById('bl-conc').value.trim();
    if (!concV) { document.getElementById('bl-msg').innerHTML = err('Concorrente obrigatório'); return; }
    const body = {
      concorrente: concV,
      ads_count: parseInt(document.getElementById('bl-count').value || '0', 10),
      url: document.getElementById('bl-url').value.trim() || null,
      segmento: document.getElementById('bl-seg').value.trim() || null,
      conteudo: document.getElementById('bl-cont').value.trim() || null,
      ai_analysis: _aiPreview ? _aiPreview.text : null,
      nivel_invest: _aiPreview ? _aiPreview.nivel : null,
    };
    try { await api.request('/api/v3/marketing/ad_library', { method: 'POST', body }); close(); await reload(); }
    catch (e) { document.getElementById('bl-msg').innerHTML = err(e.message); }
  });
}

async function analyzeAI() {
  if (_aiBusy) return;
  const conc = document.getElementById('bl-conc').value.trim();
  const cont = document.getElementById('bl-cont').value.trim();
  const count = document.getElementById('bl-count').value || '?';
  const seg = document.getElementById('bl-seg').value.trim();
  const fileInput = document.getElementById('bl-imgs');
  const status = document.getElementById('bl-ai-status');
  const hasImgs = fileInput && fileInput.files && fileInput.files.length;
  if (!cont && !hasImgs) { status.textContent = 'Cole os anúncios ou anexe prints primeiro.'; return; }
  _aiBusy = true;
  status.innerHTML = '<span class="spinner"></span> lendo imagens…';
  let imgs = [];
  try { imgs = await collectImages(fileInput); } catch (_) { imgs = []; }
  status.innerHTML = '<span class="spinner"></span> a IA está analisando' + (imgs.length ? ` ${imgs.length} criativo(s)…` : '…');
  const prompt = `Você é estrategista de tráfego imobiliário com olho de diretor de criação. Analise a BIBLIOTECA DE ANÚNCIOS do concorrente "${conc}" (${count} anúncios ativos${seg ? ', linha: ' + seg : ''}) no mercado de São José do Rio Preto.
${imgs.length ? `Você está VENDO ${imgs.length} print(s) de criativo anexado(s) — analise a IMAGEM: gancho visual dos primeiros segundos, overlay de preço/oferta, paleta de cores, identidade visual, prova social e qualidade de produção.` : ''}
${cont ? 'Considere também as copies coladas no fim.' : ''}
Entregue em markdown curto e prático:
1) **Produto/oferta** que ele empurra.
2) **Formatos** (vídeo/carrossel/imagem).
3) **Ganchos** visuais e textuais (3-5 que param o scroll).
4) **Teste×escala** (muitos criativos variados = teste; poucos repetidos = escala).
5) **Investimento estimado** (qualitativo BAIXO/MÉDIO/ALTO — deixe claro que NÃO é gasto real, é leitura por volume/variação).
6) **Pra PSM**: o que copiar, o que evitar, e 1 ideia de CONTRA-CRIATIVO concreto.
Na ÚLTIMA linha escreva só: NIVEL_INVEST: baixo|medio|alto${cont ? '\n\nANÚNCIOS (texto):\n' + cont.slice(0, 8000) : ''}`;
  try {
    const r = await fetch('/api/ai-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, max_tokens: 1400, images: imgs }) });
    const j = await r.json();
    if (j.ok && j.text) {
      let txt = j.text, nivel = null;
      const m = txt.match(/NIVEL_INVEST:\s*(baixo|medio|m[ée]dio|alto)/i);
      if (m) { nivel = m[1].toLowerCase().replace('é', 'e'); txt = txt.replace(/NIVEL_INVEST:.*/i, '').trim(); }
      _aiPreview = { text: txt, nivel };
      status.innerHTML = `<span style="color:#16a34a">✓ análise pronta${imgs.length ? ' · ' + imgs.length + ' criativo(s) lido(s) pela visão' : ''} · ${escapeHtml(j.model_used || 'IA')} (será salva)</span>`;
      document.getElementById('bl-ai-prev').innerHTML = `<div style="background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.25);border-radius:8px;padding:12px;font-size:12.5px;line-height:1.5;max-height:320px;overflow:auto">${mdLite(txt)}</div>`;
    } else {
      status.innerHTML = '<span style="color:#dc2626">IA indisponível: ' + escapeHtml(j.error || 'erro') + '</span>';
    }
  } catch (e) {
    status.innerHTML = '<span style="color:#dc2626">Erro: ' + escapeHtml(e.message) + '</span>';
  } finally { _aiBusy = false; }
}

/* Lê os arquivos de imagem, redimensiona (≤1024px, JPEG) e devolve base64 —
   mantém o payload leve pro limite de corpo da função serverless. */
async function collectImages(input, max = 6) {
  if (!input || !input.files || !input.files.length) return [];
  const files = Array.from(input.files).slice(0, max);
  const out = [];
  for (const f of files) {
    if (!/^image\//.test(f.type || '')) continue;
    const im = await readImageScaled(f).catch(() => null);
    if (im && im.base64) out.push(im);
  }
  return out;
}
function readImageScaled(file, maxDim = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('img'));
      img.onload = () => {
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h || 1));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = c.toDataURL('image/jpeg', quality);
        resolve({ base64: (dataUrl.split(',')[1] || ''), media_type: 'image/jpeg' });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ─── helpers ─── */
function mdLite(t) {
  return escapeHtml(t)
    .replace(/^#{1,3} (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*\d+\)\s*(.*)$/gm, '<div style="margin:3px 0"><b>•</b> $1</div>')
    .replace(/^\s*[-*] (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}
function spinner(t) { return `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${t}</div></div>`; }
function err(m) { return `<div class="alert alert-err">Erro: ${escapeHtml(m)}</div>`; }
function fmtD(s) { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; } }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
