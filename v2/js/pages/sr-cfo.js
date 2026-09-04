/* PSM-OS v2 — 🧠 Sr. CFO (agente financeiro da holding) v87.31
   SÓ SÓCIOS (lvl>=10). O agente roda no PC Windows 24h (kit MIGRACAO-WINDOWS)
   e publica aqui: dossiês (fechamento/auditoria/fluxo 13 semanas), radar de
   riscos 🔴🟡🔵, diário de decisões e pendências aguardando o sócio.
   Backend: /api/v3/diretoria/sr_cfo. Dossiês = shared_kv diretoria_dossies
   (mesmo kv do agente CEO — o toggle "todos os agentes" mostra os dele também). */
import { api } from '../api.js';

const TABS = [
  { id: 'dossies', lbl: '📊 Dossiês' },
  { id: 'radar', lbl: '🚨 Radar de Riscos' },
  { id: 'diario', lbl: '📓 Diário de Decisões' },
  { id: 'pendencias', lbl: '⏳ Aguardando o sócio' },
];
const NIVEL = {
  vermelho: { ico: '🔴', lbl: 'EXISTENCIAL', cor: '#e5484d', hint: 'fura caixa em <60 dias' },
  amarelo: { ico: '🟡', lbl: 'ESTRUTURAL', cor: '#f5a623', hint: 'corrói margem/runway' },
  azul: { ico: '🔵', lbl: 'LATENTE', cor: '#4c9ffe', hint: 'vira problema se nada mudar' },
};
const TIPO_ICO = { fechamento: '🧾', auditoria: '🔎', caixa: '💧', relatorio: '📊', 'estado-da-uniao': '🏛' };

let _root = null, _tab = 'dossies', _data = null, _todos = false, _aberto = null;

export async function pageSrCfo(ctx, root) {
  _root = root;
  _tab = (ctx?.query?.tab) || 'dossies';
  render();
  await load();
}

async function load() {
  try {
    _data = await api.request(`/api/v3/diretoria/sr_cfo?autor=${_todos ? 'todos' : 'CFO'}`);
  } catch (e) {
    _data = { ok: false, error: e.message || 'falha ao carregar' };
  }
  render();
}

async function post(body) {
  try {
    await api.request('/api/v3/diretoria/sr_cfo', { method: 'POST', body });
    await load();
  } catch (e) { alert('Falhou: ' + (e.message || e)); }
}

function render() {
  if (!_root) return;
  const d = _data;
  _root.innerHTML = `
  <div style="max-width:1100px;margin:0 auto;padding:14px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <div style="font-size:20px;font-weight:900">🧠 Sr. CFO</div>
      <span style="font-size:11px;opacity:.6">o cérebro financeiro da holding · SÓ SÓCIOS</span>
      <span style="margin-left:auto;font-size:11px;opacity:.55">🖥️ rotina roda no PC Windows 24h · aqui é a vitrine</span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">
      ${TABS.map(t => `<button class="btn ${_tab === t.id ? 'btn-primary' : ''}" data-tab="${t.id}" style="font-size:12px">${t.lbl}${badge(t.id)}</button>`).join('')}
    </div>
    <div id="cfo-body">${!d ? loading() : !d.ok ? errBox(d.error) : bodyHtml(d)}</div>
  </div>`;
  _root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { _tab = b.dataset.tab; render(); });
  wire();
}

function badge(tab) {
  if (!_data?.ok) return '';
  if (tab === 'radar') {
    const n = (_data.radar?.itens || []).filter(i => i.nivel === 'vermelho').length;
    return n ? ` <span style="background:#e5484d;color:#fff;border-radius:8px;padding:0 6px;font-size:10px">${n}</span>` : '';
  }
  if (tab === 'pendencias') {
    const n = (_data.pendencias || []).filter(p => !p.resolvida).length;
    return n ? ` <span style="background:#f5a623;color:#111;border-radius:8px;padding:0 6px;font-size:10px">${n}</span>` : '';
  }
  return '';
}

function bodyHtml(d) {
  if (_tab === 'radar') return radarHtml(d);
  if (_tab === 'diario') return diarioHtml(d);
  if (_tab === 'pendencias') return pendHtml(d);
  return dossiesHtml(d);
}

/* ---------- 📊 Dossiês ---------- */
function dossiesHtml(d) {
  const list = d.dossies || [];
  const head = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <label style="font-size:12px;opacity:.75;cursor:pointer"><input type="checkbox" id="cfo-todos" ${_todos ? 'checked' : ''}> mostrar todos os agentes (CEO etc.)</label>
      <span style="margin-left:auto;font-size:11px;opacity:.5">${d.total_dossies || 0} dossiê(s)</span>
    </div>`;
  if (!list.length) return head + vazio('Nenhum dossiê ainda. A rotina do Sr. CFO no Windows publica aqui (fechamento até dia 5, caixa toda segunda, auditoria trimestral).');
  return head + list.map(x => {
    const open = _aberto === x.id;
    return `
    <div class="card" style="padding:12px;margin-bottom:8px;border-left:3px solid ${x.autor === 'CFO' ? '#4c9ffe' : '#8a63d2'}">
      <div style="display:flex;gap:8px;align-items:baseline;cursor:pointer" data-dossie="${esc(x.id)}">
        <span>${TIPO_ICO[x.tipo] || '📊'}</span>
        <b style="font-size:14px">${esc(x.titulo)}</b>
        <span style="font-size:11px;opacity:.55">${esc(x.autor || '')} · ${dt(x.criado_em)}</span>
        <span style="margin-left:auto;opacity:.5">${open ? '▲' : '▼'}</span>
      </div>
      ${x.manchete ? `<div style="font-size:12.5px;margin-top:4px;opacity:.85">💬 ${esc(x.manchete)}</div>` : ''}
      ${open ? `<div style="margin-top:10px;font-size:13px;line-height:1.55;border-top:1px solid rgba(128,128,128,.2);padding-top:10px">${mdLite(x.corpo_md || '')}</div>
        ${(x.fontes || []).length ? `<div style="font-size:10.5px;opacity:.5;margin-top:8px">fontes: ${x.fontes.map(esc).join(' · ')}</div>` : ''}` : ''}
    </div>`;
  }).join('');
}

/* ---------- 🚨 Radar ---------- */
function radarHtml(d) {
  const itens = d.radar?.itens || [];
  const head = `<div style="font-size:11px;opacity:.55;margin-bottom:8px">Atualizado ${d.radar?.atualizado_em ? dt(d.radar.atualizado_em) : 'nunca'} · classificação viva mantida pelo Sr. CFO</div>`;
  if (!itens.length) return head + vazio('Radar vazio — a rotina do Sr. CFO ainda não publicou a classificação de riscos.');
  const ordem = { vermelho: 0, amarelo: 1, azul: 2 };
  return head + itens.slice().sort((a, b) => (ordem[a.nivel] ?? 9) - (ordem[b.nivel] ?? 9)).map(i => {
    const n = NIVEL[i.nivel] || NIVEL.azul;
    return `<div class="card" style="padding:12px;margin-bottom:8px;border-left:4px solid ${n.cor}">
      <div style="display:flex;gap:8px;align-items:baseline">
        <span>${n.ico}</span><b>${esc(i.titulo)}</b>
        <span style="font-size:10px;font-weight:800;color:${n.cor};letter-spacing:1px">${n.lbl}</span>
        ${i.prazo ? `<span style="margin-left:auto;font-size:11px;opacity:.6">⏱ ${esc(i.prazo)}</span>` : ''}
      </div>
      ${i.detalhe ? `<div style="font-size:12.5px;margin-top:4px;opacity:.85">${mdLite(i.detalhe)}</div>` : ''}
    </div>`;
  }).join('');
}

/* ---------- 📓 Diário ---------- */
function diarioHtml(d) {
  const items = d.diario || [];
  if (!items.length) return vazio('Diário vazio. Cada decisão financeira relevante entra aqui com premissa e resultado esperado — e volta no fechamento pra virar acerto/erro com R$.');
  const V = { acerto: '🟢 acerto', erro: '🔴 erro', cedo: '⏳ cedo p/ saber' };
  return items.map(x => `
    <div class="card" style="padding:12px;margin-bottom:8px">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
        <b>${esc(x.decisao)}</b>
        <span style="font-size:11px;opacity:.55">${dt(x.criado_em)}</span>
        <span style="margin-left:auto;font-size:12px">${x.veredito ? V[x.veredito] : '<span style="opacity:.5">sem veredito</span>'}
          ${x.delta_reais != null ? ` · <b style="color:${x.delta_reais >= 0 ? '#30a46c' : '#e5484d'}">R$ ${num(x.delta_reais)}</b>` : ''}</span>
      </div>
      ${x.premissa ? `<div style="font-size:12px;margin-top:4px"><b>Premissa:</b> ${esc(x.premissa)}</div>` : ''}
      ${x.resultado_esperado ? `<div style="font-size:12px"><b>Esperado:</b> ${esc(x.resultado_esperado)}${x.revisao_em ? ` · <span style="opacity:.6">revisar em ${esc(x.revisao_em)}</span>` : ''}</div>` : ''}
      ${x.licao ? `<div style="font-size:12px;margin-top:4px;padding:6px 8px;background:rgba(128,128,128,.1);border-radius:6px">📌 <b>Lição:</b> ${esc(x.licao)}</div>` : ''}
    </div>`).join('');
}

/* ---------- ⏳ Pendências ---------- */
function pendHtml(d) {
  const items = d.pendencias || [];
  const abertas = items.filter(p => !p.resolvida), fechadas = items.filter(p => p.resolvida);
  let h = '';
  if (!abertas.length) h += vazio('Nada aguardando decisão do sócio. 👌');
  h += abertas.map(p => `
    <div class="card" style="padding:12px;margin-bottom:8px;border-left:3px solid #f5a623">
      <div style="display:flex;gap:8px;align-items:baseline">
        <b>${esc(p.titulo)}</b><span style="font-size:11px;opacity:.55">${dt(p.criado_em)}</span>
        <button class="btn" data-resolver="${esc(p.id)}" style="margin-left:auto;font-size:11px">✓ Decidido</button>
      </div>
      ${p.detalhe ? `<div style="font-size:12.5px;margin-top:4px;opacity:.85">${mdLite(p.detalhe)}</div>` : ''}
    </div>`).join('');
  if (fechadas.length) h += `<details style="margin-top:12px;opacity:.65"><summary style="cursor:pointer;font-size:12px">${fechadas.length} resolvida(s)</summary>
    ${fechadas.map(p => `<div style="font-size:12px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,.15)">✓ ${esc(p.titulo)} <span style="opacity:.5">· ${dt(p.resolvida_em)} por ${esc(p.por || '')}</span></div>`).join('')}</details>`;
  return h;
}

function wire() {
  const t = _root.querySelector('#cfo-todos');
  if (t) t.onchange = () => { _todos = t.checked; load(); };
  _root.querySelectorAll('[data-dossie]').forEach(el => el.onclick = () => {
    _aberto = _aberto === el.dataset.dossie ? null : el.dataset.dossie; render();
  });
  _root.querySelectorAll('[data-resolver]').forEach(b => b.onclick = () =>
    post({ action: 'resolver_pendencia', id: b.dataset.resolver }));
}

/* ---------- helpers ---------- */
function loading() { return '<div style="opacity:.6;padding:30px;text-align:center">Carregando…</div>'; }
function errBox(e) { return `<div class="card" style="padding:14px;border-left:3px solid #e5484d">⚠️ ${esc(e || 'erro')}</div>`; }
function vazio(t) { return `<div class="card" style="padding:16px;opacity:.7;font-size:12.5px">${esc(t)}</div>`; }
function dt(iso) { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function num(n) { return (Math.round(+n || 0)).toLocaleString('pt-BR'); }
function mdLite(t) {
  return esc(t)
    .replace(/^#### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^## (.*)$/gm, '<div style="font-weight:800;font-size:14px;margin:12px 0 4px">$1</div>')
    .replace(/^# (.*)$/gm, '<div style="font-weight:900;font-size:15px;margin:12px 0 4px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*\d+\.\s+(.*)$/gm, '<div style="margin:3px 0 3px 6px">▸ $1</div>')
    .replace(/^\s*[-*] (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
