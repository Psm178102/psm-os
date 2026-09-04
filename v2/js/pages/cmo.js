/* PSM-OS v2 — 🎯 CMO · Marketing (v87.31)
   Agente C-level de marketing da holding (decisão do Paulo, 04/set/2026):
   mora na DIRETORIA e SÓ sócio vê (ROUTE_MIN_LVL=10 + backend lvl>=10).
   O CMO NÃO executa: decide alocação, cobra os executores (marketing-psm,
   Sr. MKT MRR, Sr. Gestor de Tráfego) e fecha CAC/ROAS integrado por nicho.
   A ROTINA roda no PC Windows 24h (tarefas do app Claude) e grava os
   relatórios no shared_kv 'cmo_relatorios' — esta página é o cockpit de
   leitura. Backend: /api/v3/diretoria/cmo. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const TIPO_LBL = { diario: '📅 Diário (19h15)', semanal: '🗓 Placar Semanal (seg)', mensal: '📊 Fechamento de mês', trimestral: '♟️ Plano do trimestre' };
const TIPO_COR = { diario: '#fb923c', semanal: '#38bdf8', mensal: '#22c55e', trimestral: '#a855f7' };

let _root = null, _relatorios = null, _filtro = 'todos', _formAberto = false;

export async function pageCMO(ctx, root) {
  _root = root;
  render();
  await load(true);
}

async function load(rerender) {
  try { _relatorios = (await api.request('/api/v3/diretoria/cmo'))?.relatorios || []; }
  catch (e) { _relatorios = { erro: e.message }; }
  if (rerender) render();
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function md(txt) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', inList = false;
  for (const ln of String(txt || '').split(/\r?\n/)) {
    const t = ln.trim();
    const li = t.match(/^(?:[*\-•▪]|\d+[.)])\s+(.*)/);
    if (li) { if (!inList) { html += '<ul class="cmomd-ul">'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (!t || /^[─—-]{4,}$/.test(t)) continue;
    const h = t.match(/^(#{1,4})\s*(.*)/);
    if (h) { html += `<div class="cmomd-h${Math.min(h[1].length, 3)}">${inline(h[2])}</div>`; continue; }
    html += `<p class="cmomd-p">${inline(t)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function render() {
  const carregando = _relatorios === null;
  const erro = _relatorios && !Array.isArray(_relatorios) ? _relatorios.erro : null;
  const lista = Array.isArray(_relatorios)
    ? (_filtro === 'todos' ? _relatorios : _relatorios.filter(r => r.tipo === _filtro))
    : [];
  const alertaVivo = Array.isArray(_relatorios)
    ? _relatorios.find(r => r.tipo === 'diario' && r.alerta && (Date.now() - Date.parse(r.ts || 0)) < 48 * 3600e3)
    : null;

  _root.innerHTML = `
  <style>
    .cmomd-p{margin:5px 0;line-height:1.55}
    .cmomd-ul{margin:5px 0 5px 18px;line-height:1.55}
    .cmomd-h1,.cmomd-h2{font-weight:800;margin:12px 0 4px;font-size:14px}
    .cmomd-h3{font-weight:700;margin:9px 0 3px;font-size:12.5px}
    .cmo-chip{display:inline-block;padding:4px 12px;border-radius:999px;border:1px solid var(--bd);cursor:pointer;font-size:11.5px;user-select:none}
    .cmo-chip.on{background:var(--acc,#38bdf8);color:#04121f;border-color:transparent;font-weight:800}
    .cmo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
    @media (max-width:720px){.cmo-grid{grid-template-columns:1fr}}
  </style>

  <div style="background:linear-gradient(135deg,var(--bg-3),transparent);border:1px solid var(--bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">
    <div style="font-weight:900;font-size:16px">🎯 CMO · Marketing <span class="tiny muted" style="font-weight:400">· agente C-level · só sócios</span></div>
    <div class="tiny" style="margin-top:6px;line-height:1.6;color:var(--muted)">
      O CMO <b>não produz peça, não compra mídia e não dispara régua</b> — decide onde o dinheiro entra, cobra os executores
      (marketing-psm · Sr. MKT MRR · Sr. Gestor de Tráfego) e fecha o número que só ele enxerga: <b>CAC e ROAS integrados por nicho</b>.
      Ele recomenda, o sócio decide. A rotina roda no <b>PC Windows 24h</b> e os relatórios chegam aqui sozinhos.
    </div>
    <div class="cmo-grid" style="margin-top:12px">
      <div style="background:var(--bg-3);border-radius:10px;padding:10px 12px"><b style="color:#fb923c">📅 Diário 19h15</b><div class="tiny muted" style="margin-top:3px">Leitura de exceção pós-relatório do Tráfego: CPL estourado, campanha pausada, fila parada. Dia normal = 1 linha.</div></div>
      <div style="background:var(--bg-3);border-radius:10px;padding:10px 12px"><b style="color:#38bdf8">🗓 Segunda 8h</b><div class="tiny muted" style="margin-top:3px">Placar Semanal: funil por nicho, anomalias dos executores, 3 decisões, pauta da mesa de marketing.</div></div>
      <div style="background:var(--bg-3);border-radius:10px;padding:10px 12px"><b style="color:#22c55e">📊 Dia 1º</b><div class="tiny muted" style="margin-top:3px">CAC/ROAS integrado + Reporte Executivo de 1 página + proposta de budget (custo real do CFO).</div></div>
      <div style="background:var(--bg-3);border-radius:10px;padding:10px 12px"><b style="color:#a855f7">♟️ Trimestre</b><div class="tiny muted" style="margin-top:3px">Mix de nichos, mata/mantém iniciativas, metas alinhadas ao gate do Plano de Resgate.</div></div>
    </div>
  </div>

  ${alertaVivo ? `<div style="background:rgba(244,63,94,.12);border:1px solid #f43f5e;border-radius:10px;padding:10px 14px;margin-bottom:12px">
      <b>🚨 Alerta vivo do CMO</b> <span class="tiny muted">· ${esc(String(alertaVivo.ts || '').slice(0, 16).replace('T', ' '))} UTC</span>
      <div class="tiny" style="margin-top:4px">${md(alertaVivo.texto)}</div>
    </div>` : ''}

  <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:12px;align-items:center">
    ${[['todos', '📚 Todos'], ...Object.entries(TIPO_LBL)].map(([k, v]) =>
      `<span class="cmo-chip ${_filtro === k ? 'on' : ''}" data-cmo-fl="${k}">${v}${k !== 'todos' && Array.isArray(_relatorios) ? ` (${_relatorios.filter(r => r.tipo === k).length})` : ''}</span>`).join('')}
    <button class="btn btn-ghost tiny" id="cmo-add" style="margin-left:auto">➕ Registrar relatório</button>
    <button class="btn btn-ghost tiny" id="cmo-reload" title="recarregar">🔄</button>
  </div>

  <div id="cmo-form" ${_formAberto ? '' : 'hidden'} style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:12px">
    <div class="tiny muted" style="margin-bottom:8px">Cole aqui um relatório gerado fora do fluxo (a rotina do Windows grava sozinha — isto é só contingência).</div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:8px">
      <select id="cmo-f-tipo" class="input" style="max-width:230px">${Object.entries(TIPO_LBL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input id="cmo-f-periodo" class="input" placeholder="período (ex.: 2026-09 ou S36)" style="max-width:200px">
      <label class="tiny" style="align-self:center"><input type="checkbox" id="cmo-f-alerta"> é alerta</label>
    </div>
    <textarea id="cmo-f-texto" class="input" rows="8" placeholder="texto do relatório (markdown simples)"></textarea>
    <div style="margin-top:8px"><button class="btn btn-primary tiny" id="cmo-f-salvar">Salvar</button></div>
  </div>

  ${carregando ? '<div class="muted tiny"><span class="spinner"></span> Buscando relatórios do CMO…</div>' : ''}
  ${erro ? `<div class="muted">⚠️ ${esc(erro)}</div>` : ''}
  ${!carregando && !erro ? (lista.length ? lista.map((r, i) => {
    const cor = TIPO_COR[r.tipo] || '#fb923c';
    return `
    <div style="background:var(--bg-3);border-left:4px solid ${r.alerta ? '#f43f5e' : cor};border-radius:10px;padding:12px 16px;margin-bottom:10px">
      <div class="flex" style="align-items:center;gap:8px;cursor:pointer;flex-wrap:wrap" data-cmo-tg="${i}">
        <b>${r.alerta ? '🚨 ' : ''}${TIPO_LBL[r.tipo] || esc(r.tipo)}</b>
        ${r.periodo ? `<span class="tiny" style="opacity:.8">· ${esc(r.periodo)}</span>` : ''}
        <span class="tiny muted">· ${esc(String(r.ts || '').slice(0, 16).replace('T', ' '))} UTC${r.gerado_por && r.gerado_por !== 'cmo-windows' ? ' · manual (' + esc(r.gerado_por) + ')' : ''}</span>
        <button class="btn btn-ghost tiny" data-cmo-cp="${i}" title="copiar texto" style="margin-left:auto">📋</button>
        <span data-cmo-ar="${i}">${i === 0 ? '▼' : '▶'}</span>
      </div>
      <div data-cmo-bd="${i}" ${i === 0 ? '' : 'hidden'} style="margin-top:10px;border-top:1px solid var(--bd);padding-top:6px">${md(r.texto)}</div>
    </div>`;
  }).join('')
    : `<div style="background:var(--bg-3);border-radius:10px;padding:18px;text-align:center" class="tiny muted">
        Nenhum relatório ainda. A rotina do CMO roda no PC Windows 24h (tarefas <code>cmo-abre-o-dia</code>,
        <code>cmo-fecha-a-semana</code> e <code>cmo-fecha-o-mes</code> do kit MIGRACAO-WINDOWS) e o primeiro
        relatório aparece aqui sozinho assim que rodar.</div>`) : ''}`;

  _root.querySelectorAll('[data-cmo-fl]').forEach(el => el.onclick = () => { _filtro = el.dataset.cmoFl; render(); });
  _root.querySelectorAll('[data-cmo-tg]').forEach(el => el.onclick = () => {
    const i = el.dataset.cmoTg;
    const bd = _root.querySelector(`[data-cmo-bd="${i}"]`);
    bd.hidden = !bd.hidden;
    _root.querySelector(`[data-cmo-ar="${i}"]`).textContent = bd.hidden ? '▶' : '▼';
  });
  _root.querySelectorAll('[data-cmo-cp]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    const r = lista[+el.dataset.cmoCp];
    navigator.clipboard?.writeText(r?.texto || '').then(() => { el.textContent = '✓'; setTimeout(() => { el.textContent = '📋'; }, 1500); });
  });
  const add = _root.querySelector('#cmo-add');
  if (add) add.onclick = () => { _formAberto = !_formAberto; render(); };
  const rl = _root.querySelector('#cmo-reload');
  if (rl) rl.onclick = () => { _relatorios = null; render(); load(true); };
  const sv = _root.querySelector('#cmo-f-salvar');
  if (sv) sv.onclick = async () => {
    const texto = _root.querySelector('#cmo-f-texto').value.trim();
    if (!texto) return alert('Texto vazio.');
    sv.disabled = true; sv.textContent = '⏳…';
    try {
      await api.request('/api/v3/diretoria/cmo', { method: 'POST', body: {
        tipo: _root.querySelector('#cmo-f-tipo').value,
        periodo: _root.querySelector('#cmo-f-periodo').value.trim(),
        alerta: _root.querySelector('#cmo-f-alerta').checked,
        texto,
      } });
      _formAberto = false; _relatorios = null; render(); load(true);
    } catch (e) { alert('Falha: ' + e.message); sv.disabled = false; sv.textContent = 'Salvar'; }
  };
}
