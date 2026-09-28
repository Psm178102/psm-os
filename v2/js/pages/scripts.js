/* ============================================================================
   PSM-OS v2 — 🧭 Playbook da Venda — v88.89
   Une as antigas abas 📚 Scripts & Cadências (v81.19) e 🗺 Mapa da Venda (v88.37)
   numa tela só, didática, em 3 passos:
     ① escolha o NICHO  →  ② veja o MAPA (o caminho inteiro, PDF)  →
     ③ siga as ETAPAS (o que falar em cada passo: scripts & cadência).
   Os dados continuam nos mesmos lugares: linhas/etapas em /api/v3/scripts/playbook
   e o PDF do mapa na coleção 'mapa_venda' de /api/v3/apresentacoes/deck.
   Todos veem (corretores também); gestão (lvl≥5) edita os scripts; sócio anexa o mapa.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { NICHOS, renderMapa } from './mapa-venda.js';

let _root = null, _linhas = [], _canEdit = false;
let _selL = 0, _selE = 0, _edit = false, _busy = false, _msg = '';
let _ver = 'etapas', _mapaMeta = null, _soConquista = false;

// linha do playbook ↔ nicho do mapa (pelo id do seed; senão pelo nome)
const LINHA_NICHO = { conquista: 'conquista', map: 'map', terceiros: 'terceiros', locacao: 'locacao', captacao: 'captacoes' };
function nichoDaLinha(l) {
  if (!l) return null;
  if (LINHA_NICHO[l.id]) return LINHA_NICHO[l.id];
  const n = (l.nome || '').toLowerCase();
  if (/conquista|mcmv/.test(n)) return 'conquista';
  if (/m\.?a\.?p\b/.test(n)) return 'map';
  if (/terceir/.test(n)) return 'terceiros';
  if (/loca/.test(n)) return 'locacao';
  if (/capta/.test(n)) return 'captacoes';
  return null;
}
const ehFundamentos = l => l?.id === 'psm' || /fundament/i.test(l?.nome || '');

export async function pageScripts(ctx, root) {
  _root = root; _selE = 0; _edit = false; _msg = '';
  _ver = ctx?.query?.ver === 'mapa' ? 'mapa' : (ctx ? 'etapas' : _ver);
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando o playbook da venda…</div></div>';
  const [pb, mp] = await Promise.allSettled([
    api.request('/api/v3/scripts/playbook'),
    api.request('/api/v3/apresentacoes/deck?colecao=mapa_venda'),
  ]);
  if (pb.status !== 'fulfilled') { _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(pb.reason?.message || pb.reason)}</div>`; return; }
  _linhas = pb.value.linhas || []; _canEdit = !!pb.value.can_edit;
  _mapaMeta = mp.status === 'fulfilled' ? mp.value : null;
  // Corretor PSM Conquista só consulta a linha MCMV (as outras ficam ocultas). v81.61
  _soConquista = (auth.user()?.role || '').toLowerCase() === 'corretor_conquista';
  if (_soConquista) { _linhas = _linhas.filter(l => /mcmv/i.test(l.nome || '')); _canEdit = false; }
  // abre no nicho pedido (?nicho=) — senão no primeiro que não é a base comum
  const pedido = ctx?.query?.nicho;
  const iPed = pedido ? _linhas.findIndex(l => nichoDaLinha(l) === pedido || l.id === pedido) : -1;
  if (iPed >= 0) _selL = iPed;
  else if (ctx) { const i = _linhas.findIndex(l => !ehFundamentos(l)); _selL = i >= 0 ? i : 0; }
  render();
}

/* rota antiga /mapa-venda → mesma tela, já na visão do mapa */
export function pageMapaVenda(ctx, root) {
  return pageScripts({ ...(ctx || {}), query: { ...(ctx?.query || {}), ver: 'mapa' } }, root);
}

const SWATCHES = ['#5b7fb4', 'var(--err)', 'var(--ok)', 'var(--accent-ink)', '#806d50', 'var(--accent-ink)', '#db2777', 'var(--warn)', 'var(--ink-2)'];

function corTexto(cor) { return cor === 'var(--accent)' ? 'var(--on-accent)' : '#fff'; }

function render() {
  if (_selL >= _linhas.length) _selL = 0;
  const L = _linhas[_selL];
  const etapas = (L?.etapas || []);
  if (_selE >= etapas.length) _selE = 0;
  const E = etapas[_selE];
  const cor = L?.cor || '#5b7fb4';
  const nicho = nichoDaLinha(L);
  const temMapa = !!nicho;
  if (!temMapa && _ver === 'mapa') _ver = 'etapas';
  const mapaPronto = temMapa && !!(_mapaMeta?.marcas || {})[nicho];
  const nichos = _linhas.map((l, i) => ({ l, i })).filter(x => !ehFundamentos(x.l));
  const fund = _linhas.map((l, i) => ({ l, i })).filter(x => ehFundamentos(x.l));

  _root.innerHTML = `
    <div class="card pv">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="flex:1;min-width:220px">
          <h2 class="card-title" style="margin:0">🧭 Playbook da Venda</h2>
          <p class="card-sub" style="margin:2px 0 0">O caminho da venda de cada nicho e o que falar em cada passo — do primeiro contato à assinatura.</p>
        </div>
        ${_canEdit && _ver === 'etapas' ? `<div class="flex gap-2">
          ${_edit ? `<button class="btn btn-ghost btn-sm" id="sc-cancel">Cancelar</button><button class="btn btn-primary btn-sm" id="sc-save" ${_busy ? 'disabled' : ''}>${_busy ? '⏳' : '💾'} Salvar</button>`
            : `<button class="btn btn-ghost btn-sm" id="sc-edit">✏️ Editar scripts</button>`}
        </div>` : ''}
      </div>
      <div id="sc-msg" class="tiny" style="margin:4px 0;min-height:14px;color:${_msg[0] === '⚠' ? 'var(--err)' : 'var(--ok)'}">${esc(_msg)}</div>

      ${_edit ? '' : `
      <!-- COMO USAR: os 3 passos -->
      <div class="pv-passos">
        <div class="pv-passo on"><span class="pv-n">1</span><div><b>Escolha o nicho</b><div class="tiny muted">quem é o cliente</div></div></div>
        <div class="pv-seta">→</div>
        <div class="pv-passo ${_ver === 'mapa' ? 'on' : ''}"><span class="pv-n">2</span><div><b>Veja o mapa</b><div class="tiny muted">o caminho inteiro</div></div></div>
        <div class="pv-seta">→</div>
        <div class="pv-passo ${_ver === 'etapas' ? 'on' : ''}"><span class="pv-n">3</span><div><b>Siga as etapas</b><div class="tiny muted">o que falar em cada passo</div></div></div>
      </div>`}

      <!-- ① NICHOS -->
      <div class="tiny muted pv-rot">① Nicho</div>
      <div class="pv-nichos">
        ${nichos.map(({ l, i }) => cartaoNicho(l, i)).join('')}
        ${_edit ? '<button class="btn btn-ghost btn-sm" id="sc-newl" style="align-self:center">➕ Linha</button>' : ''}
      </div>
      ${fund.length ? `<div class="pv-fund">${fund.map(({ l, i }) => `<button class="pv-fund-b ${i === _selL ? 'on' : ''}" data-l="${i}" style="--c:${l.cor || '#7c3aed'}">
          ${esc(l.nome)} <span class="tiny" style="opacity:.75">· base comum a todos os nichos · ${(l.etapas || []).length} lições</span></button>`).join('')}</div>` : ''}

      ${!_linhas.length ? `<div class="muted tiny" style="padding:30px;text-align:center">Nenhuma linha ainda${_canEdit ? ' — clique em ✏️ Editar scripts e ➕ Linha.' : '.'}</div>` : `
      ${_edit ? linhaEditBar(L, cor) : `
      <!-- ② / ③ VISÃO -->
      <div class="pv-vis">
        ${temMapa ? `<button class="pv-vis-b ${_ver === 'mapa' ? 'on' : ''}" data-ver="mapa" style="--c:${cor}">② 🗺 O caminho <span class="tiny">(mapa${mapaPronto ? '' : ' · ainda sem PDF'})</span></button>` : ''}
        <button class="pv-vis-b ${_ver === 'etapas' ? 'on' : ''}" data-ver="etapas" style="--c:${cor}">${temMapa ? '③ ' : ''}📚 O que falar <span class="tiny">(${etapas.length} etapa${etapas.length === 1 ? '' : 's'} · scripts & cadência)</span></button>
      </div>`}
      ${_ver === 'mapa' && !_edit ? `<div id="pv-mapa" style="margin-top:12px"></div>` : (_edit ? corpoEdicao(L, E, etapas, cor) : corpoEtapas(L, E, etapas, cor))}`}
    </div>
    <style>
      .pv-passos{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 14px;padding:10px 12px;background:var(--bg-3);border-radius:var(--radius-md)}
      .pv-passo{display:flex;align-items:center;gap:8px;opacity:.55;font-size:13px}
      .pv-passo.on{opacity:1}
      .pv-n{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--ink-2);color:#fff;font-weight:700;font-size:12px;flex:none}
      .pv-passo.on .pv-n{background:var(--accent-ink,#b8860b)}
      .pv-seta{color:var(--ink-muted);font-weight:700}
      .pv-rot{font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
      .pv-nichos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
      .pv-nicho{text-align:left;border:2px solid var(--border);background:var(--bg-2,transparent);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer;color:inherit;font:inherit;border-top:4px solid var(--c)}
      .pv-nicho:hover{border-color:var(--c)}
      .pv-nicho.on{background:var(--c);border-color:var(--c);color:#fff}
      .pv-nicho b{display:block;font-size:14px;margin-bottom:4px}
      .pv-nicho .pv-sel{display:flex;gap:6px;flex-wrap:wrap;font-size:11px;opacity:.85}
      .pv-fund{margin-top:8px}
      .pv-fund-b{width:100%;text-align:left;border:1px dashed var(--c);background:transparent;color:inherit;font:inherit;font-size:13px;border-radius:var(--radius-md);padding:7px 12px;cursor:pointer}
      .pv-fund-b.on{background:var(--c);color:#fff;border-style:solid}
      .pv-vis{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px;border-bottom:2px solid var(--border)}
      .pv-vis-b{border:none;background:transparent;color:var(--ink-muted);font:inherit;font-weight:600;font-size:14px;padding:8px 14px;cursor:pointer;border-radius:var(--r-sm,6px) var(--r-sm,6px) 0 0;margin-bottom:-2px;border-bottom:3px solid transparent}
      .pv-vis-b.on{color:var(--ink);border-bottom-color:var(--c);background:var(--bg-3)}
      .pv-trilha{display:flex;gap:0;overflow-x:auto;padding:14px 2px 6px;margin-top:6px;scrollbar-width:thin}
      .pv-et{flex:1 0 96px;max-width:170px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;background:none;border:none;color:inherit;font:inherit;position:relative;padding:0 4px}
      .pv-et::before{content:'';position:absolute;top:15px;left:0;right:0;height:3px;background:var(--border);z-index:0}
      .pv-et:first-child::before{left:50%}.pv-et:last-child::before{right:50%}
      .pv-et.feito::before{background:var(--c)}
      .pv-et .pv-bola{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;background:var(--bg-1,#fff);border:3px solid var(--border);color:var(--ink-muted);position:relative;z-index:1}
      .pv-et.feito .pv-bola{border-color:var(--c);color:var(--c)}
      .pv-et.on .pv-bola{background:var(--c);border-color:var(--c);color:#fff;transform:scale(1.12)}
      .pv-et .pv-nome{font-size:11.5px;line-height:1.25;text-align:center;color:var(--ink-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .pv-et.on .pv-nome{color:var(--ink);font-weight:600}
      .pv-conteudo{border:1px solid var(--border);border-left:5px solid var(--c);border-radius:var(--radius-md);padding:12px 14px;margin-top:8px}
      .pv-nav{display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap}
      @media(max-width:760px){.sc-grid{grid-template-columns:1fr !important}.sc-grid>div:first-child{border-right:0;border-bottom:1px solid var(--border);padding-bottom:8px}.pv-seta{display:none}.pv-vis{flex-wrap:nowrap}.pv-vis-b{flex:1;padding:8px 6px;font-size:13px}.pv-vis-b .tiny{display:none}}
    </style>`;
  wire(E);
  if (_ver === 'mapa' && !_edit && temMapa) {
    const box = _root.querySelector('#pv-mapa');
    if (box) renderMapa(box, nicho, _mapaMeta, { onPublicado: () => pageScripts({ query: { ver: 'mapa', nicho } }, _root), irEtapas: () => { _ver = 'etapas'; render(); } });
  }
}

function cartaoNicho(l, i) {
  const n = nichoDaLinha(l);
  const on = i === _selL;
  const nEt = (l.etapas || []).length;
  const mapa = n && (_mapaMeta?.marcas || {})[n];
  return `<button class="pv-nicho ${on ? 'on' : ''}" data-l="${i}" style="--c:${l.cor || '#5b7fb4'}">
    <b>${esc(l.nome)}</b>
    <span class="pv-sel">${n ? `<span>${mapa ? '🗺 mapa ✓' : '🗺 sem mapa'}</span>` : ''}<span>📚 ${nEt} etapa${nEt === 1 ? '' : 's'}</span></span>
  </button>`;
}

/* ③ leitura: trilha numerada (a jornada) + conteúdo da etapa + anterior/próxima */
function corpoEtapas(L, E, etapas, cor) {
  if (!etapas.length) return `<div class="muted tiny" style="padding:24px;text-align:center">Esta linha ainda não tem etapas${_canEdit ? ' — clique em ✏️ Editar scripts.' : '.'}</div>`;
  return `
    <div class="tiny muted" style="margin-top:12px">Clique numa etapa da trilha — ela está na ordem em que a venda acontece.</div>
    <div class="pv-trilha" style="--c:${cor}">
      ${etapas.map((e, i) => `<button class="pv-et ${i === _selE ? 'on' : ''} ${i < _selE ? 'feito' : ''}" data-e="${i}" title="${esc(e.nome)}">
        <span class="pv-bola">${i + 1}</span><span class="pv-nome">${esc(limpaNome(e.nome))}</span></button>`).join('')}
    </div>
    <div class="pv-conteudo" style="--c:${cor}">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div>
          <div class="tiny muted" style="font-weight:600;text-transform:uppercase">Etapa ${_selE + 1} de ${etapas.length} · ${esc(L.nome)}</div>
          <h3 style="margin:2px 0 0;font-size:16px">${esc(E.nome)}</h3>
        </div>
        <button class="btn btn-ghost btn-sm" data-copy="1">📋 Copiar</button>
      </div>
      <div id="sc-view" style="max-height:62vh;overflow:auto;font-size:13px;padding:4px 2px">${mdHTML(E.conteudo || '') || '<span class="muted">Sem conteúdo ainda.</span>'}</div>
      <div class="pv-nav">
        <button class="btn btn-ghost btn-sm" data-pass="-1" ${_selE === 0 ? 'disabled' : ''}>← ${_selE > 0 ? esc(limpaNome(etapas[_selE - 1].nome)).slice(0, 40) : 'Início'}</button>
        <button class="btn btn-sm" data-pass="1" ${_selE === etapas.length - 1 ? 'disabled' : ''} style="background:${cor};color:${corTexto(cor)};border-color:${cor}">${_selE < etapas.length - 1 ? 'Próxima: ' + esc(limpaNome(etapas[_selE + 1].nome)).slice(0, 40) + ' →' : 'Fim da trilha ✓'}</button>
      </div>
    </div>`;
}

/* modo edição: o layout antigo (lista de etapas + editor), que é o mais prático pra editar */
function corpoEdicao(L, E, etapas, cor) {
  return `
      <div style="display:grid;grid-template-columns:260px 1fr;gap:14px;margin-top:12px" class="sc-grid">
        <div style="border-right:1px solid var(--border);padding-right:10px">
          <div class="tiny muted" style="font-weight:600;text-transform:uppercase;margin-bottom:6px">Etapas</div>
          <div style="display:grid;gap:4px">
            ${etapas.map((e, i) => `<div class="flex gap-1" style="align-items:center">
              <button class="btn btn-sm ${i === _selE ? '' : 'btn-ghost'}" data-e="${i}" style="flex:1;text-align:left;${i === _selE ? `background:${cor};color:${corTexto(cor)};border-color:${cor}` : ''}">${esc(e.nome)}</button>
              <button class="btn btn-ghost btn-sm" data-eup="${i}" ${i === 0 ? 'disabled' : ''} style="padding:2px 5px">↑</button><button class="btn btn-ghost btn-sm" data-edn="${i}" ${i === etapas.length - 1 ? 'disabled' : ''} style="padding:2px 5px">↓</button><button class="btn btn-ghost btn-sm" data-edel="${i}" style="padding:2px 5px;color:var(--err)">✕</button>
            </div>`).join('')}
            <button class="btn btn-ghost btn-sm" id="sc-newe" style="margin-top:4px">➕ Etapa</button>
          </div>
        </div>
        <div style="min-width:0">
          ${E ? `
            <input class="input" id="sc-ename" value="${esc(E.nome)}" placeholder="Nome da etapa" style="font-weight:600;margin-bottom:8px">
            <textarea class="input" id="sc-cont" rows="22" style="width:100%;font-family:ui-monospace,monospace;font-size:13px;line-height:1.5" placeholder="Regras, scripts, cadência, gatilhos…">${esc(E.conteudo || '')}</textarea>
            <div class="tiny muted" style="margin-top:4px">Dica: LINHAS EM MAIÚSCULAS viram títulos · **negrito** · - listas.</div>`
          : '<div class="muted tiny" style="padding:20px">Sem etapa selecionada.</div>'}
        </div>
      </div>`;
}

/* "ETAPA 3 — SONDAGEM" → "Sondagem"; "📘 Vendas · 4. Atendimento — …" → "Atendimento — …" (só na trilha) */
function limpaNome(n) {
  let t = String(n || '').replace(/^ETAPA\s*\d+\s*[—–-]\s*/i, '').replace(/^📘\s*Vendas\s*·\s*\d+\.\s*/, '').trim();
  if (t && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t || n;
}

function linhaEditBar(L, cor) {
  return `<div class="flex gap-2 mt-2" style="align-items:center;flex-wrap:wrap;background:var(--bg-3);border-radius:var(--radius-md);padding:8px 10px">
    <span class="tiny muted" style="font-weight:600">Linha:</span>
    <input class="input" id="sc-lname" value="${esc(L.nome)}" style="height:30px;width:200px;font-size:13px">
    <span class="tiny muted" style="font-weight:600">🎨</span>
    ${SWATCHES.map(s => `<button data-lcor="${s}" title="${s}" style="width:20px;height:20px;border-radius:var(--radius-sm);background:${s};border:2px solid ${(L.cor || '') === s ? '#111' : 'transparent'};cursor:pointer"></button>`).join('')}
    <input type="color" id="sc-lcor" value="${esc(L.cor || cor)}" style="width:30px;height:26px;padding:0;border:0;background:none;cursor:pointer">
    <button class="btn btn-ghost btn-sm" data-lup="1" ${_selL === 0 ? 'disabled' : ''}>↑</button>
    <button class="btn btn-ghost btn-sm" data-ldn="1" ${_selL === _linhas.length - 1 ? 'disabled' : ''}>↓</button>
    <button class="btn btn-ghost btn-sm" id="sc-ldel" style="color:var(--err)">🗑 excluir linha</button>
  </div>`;
}

function wire(E) {
  const $ = id => _root.querySelector('#' + id);
  _root.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { if (_edit) syncContent(); _selL = +b.dataset.l; _selE = 0; render(); });
  _root.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { if (_edit) syncContent(); _selE = +b.dataset.e; render(); });
  _root.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { _ver = b.dataset.ver; render(); });
  _root.querySelectorAll('[data-pass]').forEach(b => b.onclick = () => { _selE += +b.dataset.pass; render(); _root.querySelector('.pv-conteudo')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  const cp = _root.querySelector('[data-copy]'); if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(E.conteudo || ''); cp.textContent = '✅ Copiado'; setTimeout(() => cp.textContent = '📋 Copiar', 1500); } catch {} };

  if ($('sc-edit')) $('sc-edit').onclick = () => { _edit = true; _ver = 'etapas'; render(); };
  if ($('sc-cancel')) $('sc-cancel').onclick = () => pageScripts(null, _root);
  if ($('sc-save')) $('sc-save').onclick = salvar;

  // edição estrutural
  if ($('sc-newl')) $('sc-newl').onclick = () => { _linhas.push({ id: 'l_' + Date.now(), nome: 'Nova linha', cor: 'var(--ink-2)', ordem: _linhas.length, etapas: [] }); _selL = _linhas.length - 1; _selE = 0; render(); };
  if ($('sc-newe')) $('sc-newe').onclick = () => { syncContent(); _linhas[_selL].etapas.push({ id: 'et_' + Date.now(), nome: 'Nova etapa', ordem: _linhas[_selL].etapas.length, conteudo: '' }); _selE = _linhas[_selL].etapas.length - 1; render(); };
  if ($('sc-ldel')) $('sc-ldel').onclick = () => { if (confirm('Excluir a linha "' + _linhas[_selL].nome + '" e todas as suas etapas?')) { _linhas.splice(_selL, 1); _selL = 0; _selE = 0; render(); } };

  // rename/cor linha (atualiza modelo, sem re-render por tecla)
  if ($('sc-lname')) $('sc-lname').addEventListener('input', e => { _linhas[_selL].nome = e.target.value; });
  _root.querySelectorAll('[data-lcor]').forEach(b => b.onclick = () => { _linhas[_selL].cor = b.dataset.lcor; render(); });
  if ($('sc-lcor')) $('sc-lcor').addEventListener('input', e => { _linhas[_selL].cor = e.target.value; });
  const lup = _root.querySelector('[data-lup]'); if (lup) lup.onclick = () => { swap(_linhas, _selL, _selL - 1); _selL--; render(); };
  const ldn = _root.querySelector('[data-ldn]'); if (ldn) ldn.onclick = () => { swap(_linhas, _selL, _selL + 1); _selL++; render(); };

  // etapa rename/conteudo
  if ($('sc-ename')) $('sc-ename').addEventListener('input', e => { _linhas[_selL].etapas[_selE].nome = e.target.value; });
  if ($('sc-cont')) $('sc-cont').addEventListener('input', e => { _linhas[_selL].etapas[_selE].conteudo = e.target.value; });
  _root.querySelectorAll('[data-eup]').forEach(b => b.onclick = () => { syncContent(); const i = +b.dataset.eup; swap(_linhas[_selL].etapas, i, i - 1); if (_selE === i) _selE--; else if (_selE === i - 1) _selE++; render(); });
  _root.querySelectorAll('[data-edn]').forEach(b => b.onclick = () => { syncContent(); const i = +b.dataset.edn; swap(_linhas[_selL].etapas, i, i + 1); if (_selE === i) _selE++; else if (_selE === i + 1) _selE--; render(); });
  _root.querySelectorAll('[data-edel]').forEach(b => b.onclick = () => { const i = +b.dataset.edel; if (confirm('Excluir a etapa "' + _linhas[_selL].etapas[i].nome + '"?')) { _linhas[_selL].etapas.splice(i, 1); _selE = 0; render(); } });
}

function syncContent() {
  const c = _root.querySelector('#sc-cont'); if (c && _linhas[_selL]?.etapas[_selE]) _linhas[_selL].etapas[_selE].conteudo = c.value;
  const n = _root.querySelector('#sc-ename'); if (n && _linhas[_selL]?.etapas[_selE]) _linhas[_selL].etapas[_selE].nome = n.value;
  const ln = _root.querySelector('#sc-lname'); if (ln && _linhas[_selL]) _linhas[_selL].nome = ln.value;
}

async function salvar() {
  if (_busy) return;
  syncContent();
  _busy = true; _msg = ''; render();
  try {
    const r = await api.request('/api/v3/scripts/playbook', { method: 'POST', body: { linhas: _linhas } });
    _linhas = r.linhas || _linhas; _busy = false; _edit = false; _msg = '💾 salvo.'; render();
  } catch (e) { _busy = false; _msg = '⚠️ ' + e.message; render(); }
}

function swap(arr, i, j) { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }

/* markdown leve: MAIÚSCULAS→título · **negrito** · - listas */
function mdHTML(s) {
  let t = esc(s || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = []; let inList = false;
  const flush = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of t.split('\n')) {
    const l = raw.trim();
    if (!l) { flush(); out.push('<div style="height:7px"></div>'); continue; }
    if (/^#{1,3}\s/.test(l)) { flush(); out.push(`<div style="font-weight:600;font-size:14px;margin:10px 0 4px;color:var(--psm-gold,#b8860b)">${l.replace(/^#{1,3}\s/, '')}</div>`); continue; }
    const plain = l.replace(/<\/?b>/g, '');
    if (plain.length <= 70 && plain === plain.toUpperCase() && /[A-ZÀ-Ý]/.test(plain) && !/[.:;,?]$/.test(plain)) {
      flush(); out.push(`<div style="font-weight:600;font-size:13px;letter-spacing:.4px;margin:13px 0 5px;color:var(--psm-gold,#b8860b)">${l}</div>`); continue;
    }
    if (/^[-•▸*]\s+/.test(l)) { if (!inList) { out.push('<ul style="margin:2px 0 4px 18px;padding:0">'); inList = true; } out.push(`<li style="margin:2px 0;line-height:1.45">${l.replace(/^[-•▸*]\s+/, '')}</li>`); continue; }
    flush(); out.push(`<div style="margin:3px 0;line-height:1.5">${l}</div>`);
  }
  flush();
  return out.join('');
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
