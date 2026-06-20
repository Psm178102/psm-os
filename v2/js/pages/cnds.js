/* ============================================================================
   PSM-OS v2 — ⚖️ CND's (Certidões Negativas de Débitos) · Jurídico
   Registro personalizável das certidões da imobiliária. Só o sócio (lvl10)
   adiciona / edita / exclui — igual ao Cofre de Logins. Quem alcança a aba
   visualiza e baixa (link do Google Drive). Rastreia VENCIMENTO: cada CND tem
   validade → badge válida / vence em Nd / VENCIDA, e ordena por quem vence antes.
============================================================================ */
import { api } from '../api.js';

let _root = null, _items = [], _tipos = [], _canManage = false, _editing = null, _busy = false, _q = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const tipoColor = t => { let h = 0; for (const ch of String(t || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h},55%,45%)`; };

function brDate(s) {
  if (!s) return '—';
  const p = String(s).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
}

// dias até a validade (negativo = já venceu). null se sem validade.
function diasAteVencer(validade) {
  if (!validade) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(String(validade).slice(0, 10) + 'T00:00:00');
  if (isNaN(v)) return null;
  return Math.round((v - hoje) / 86400000);
}

// {label, cor, bg, ord} — ord menor = mais urgente (pra ordenar)
function statusCND(validade) {
  const d = diasAteVencer(validade);
  if (d === null) return { label: 'Sem validade', cor: '#64748b', bg: '#f1f5f9', ord: 3, dias: null };
  if (d < 0) return { label: `Vencida há ${Math.abs(d)}d`, cor: '#991b1b', bg: '#fee2e2', ord: 0, dias: d };
  if (d <= 30) return { label: `Vence em ${d}d`, cor: '#9a3412', bg: '#ffedd5', ord: 1, dias: d };
  return { label: `Válida (${d}d)`, cor: '#166534', bg: '#dcfce7', ord: 2, dias: d };
}

export async function pageCnds(ctx, root) {
  _root = root; _editing = null; _busy = false; _q = '';
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando certidões…</div></div>';
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/juridico/cnds');
    _items = r.items || [];
    _tipos = r.tipos || [];
    _canManage = !!r.can_manage;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function filtrados() {
  const q = _q.trim().toLowerCase();
  let list = _items.slice();
  if (q) list = list.filter(it => [it.titulo, it.tipo, it.empresa, it.numero, it.obs].some(v => String(v || '').toLowerCase().includes(q)));
  // ordena: mais urgente primeiro (vencidas → a vencer → válidas → sem validade), depois por validade
  list.sort((a, b) => {
    const sa = statusCND(a.validade), sb = statusCND(b.validade);
    if (sa.ord !== sb.ord) return sa.ord - sb.ord;
    return String(a.validade || '9999').localeCompare(String(b.validade || '9999'));
  });
  return list;
}

function render() {
  const list = filtrados();
  const vencidas = _items.filter(it => { const d = diasAteVencer(it.validade); return d !== null && d < 0; }).length;
  const aVencer = _items.filter(it => { const d = diasAteVencer(it.validade); return d !== null && d >= 0 && d <= 30; }).length;
  const validas = _items.filter(it => { const d = diasAteVencer(it.validade); return d !== null && d > 30; }).length;

  _root.innerHTML = `
    <style>
      .cnd-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--bd);border-left:4px solid var(--c);border-radius:11px;padding:12px 14px;margin-bottom:10px}
      .cnd-badge{display:inline-block;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:20px}
      .cnd-meta{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--ink-muted,#64748b)}
      .cnd-meta b{color:var(--ink,#0f172a);font-weight:700}
      .cnd-stat{display:flex;gap:10px;flex-wrap:wrap;margin:2px 0 4px}
      .cnd-stat .s{flex:1;min-width:120px;border:1px solid var(--bd);border-radius:10px;padding:9px 12px;text-align:center}
      .cnd-stat .n{font-size:22px;font-weight:800;line-height:1}
      .cnd-stat .l{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-top:3px;color:var(--ink-muted,#64748b)}
    </style>
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">⚖️ CND's — Certidões Negativas de Débitos</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:680px">${_canManage
            ? 'Registro das certidões da imobiliária. Você adiciona, edita e exclui. O sistema acompanha o <b>vencimento</b> de cada uma.'
            : 'Certidões negativas de débitos da imobiliária. Baixe pelo link. 📎'}</p>
        </div>
        ${_canManage ? `<button class="btn btn-primary btn-sm" id="cnd-new">➕ Nova CND</button>` : ''}
      </div>

      ${_items.length ? `<div class="cnd-stat">
        <div class="s" style="${vencidas ? 'border-color:#fca5a5;background:#fef2f2' : ''}"><div class="n" style="color:#dc2626">${vencidas}</div><div class="l">🔴 Vencidas</div></div>
        <div class="s" style="${aVencer ? 'border-color:#fdba74;background:#fff7ed' : ''}"><div class="n" style="color:#ea580c">${aVencer}</div><div class="l">🟡 Vence em ≤30d</div></div>
        <div class="s"><div class="n" style="color:#16a34a">${validas}</div><div class="l">🟢 Válidas</div></div>
      </div>` : ''}

      ${_editing !== null ? formHTML() : ''}

      ${_items.length ? `<input id="cnd-q" class="input mt-2" placeholder="🔎 Buscar por título, tipo, empresa, número…" value="${esc(_q)}">` : ''}

      ${!_items.length ? `
        <div class="card mt-3" style="text-align:center;padding:32px;background:var(--bg-3)">
          <div style="font-size:30px">⚖️</div>
          <div class="muted tiny" style="margin-top:6px">${_canManage ? 'Nenhuma CND cadastrada ainda. Clique em “➕ Nova CND”.' : 'Nenhuma certidão cadastrada ainda.'}</div>
        </div>`
        : (list.length ? list.map(cardHTML).join('') : '<div class="muted tiny mt-3">Nada encontrado para a busca.</div>')}

      ${_canManage ? '<p class="tiny muted mt-3">📎 Anexe a certidão por link do Google Drive (visualização/download). As datas controlam o vencimento.</p>' : ''}
    </div>`;
  wire();
}

function cardHTML(it) {
  const st = statusCND(it.validade);
  const cor = tipoColor(it.tipo);
  return `<div class="cnd-card" style="--c:${cor}">
    <div class="flex items-center" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div class="flex items-center" style="gap:9px;flex-wrap:wrap">
        <b style="font-size:14.5px">${esc(it.titulo)}</b>
        ${it.tipo ? `<span class="cnd-badge" style="background:${cor}22;color:${cor}">${esc(it.tipo)}</span>` : ''}
        <span class="cnd-badge" style="background:${st.bg};color:${st.cor}">${st.label}</span>
      </div>
      <div class="flex gap-1">
        ${it.link ? `<a class="btn btn-ghost btn-sm" href="${esc(it.link)}" target="_blank" rel="noopener">📎 abrir</a>` : ''}
        ${_canManage ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" style="color:#dc2626">🗑</button>` : ''}
      </div>
    </div>
    <div class="cnd-meta">
      ${it.empresa ? `<span>🏢 <b>${esc(it.empresa)}</b></span>` : ''}
      ${it.numero ? `<span>Nº <b>${esc(it.numero)}</b></span>` : ''}
      <span>Emissão: <b>${brDate(it.emissao)}</b></span>
      <span>Validade: <b>${brDate(it.validade)}</b></span>
    </div>
    ${it.obs ? `<div class="tiny muted">📝 ${esc(it.obs)}</div>` : ''}
  </div>`;
}

function formHTML() {
  const it = _editing && _editing !== 'new' ? _items.find(i => i.id === _editing) : null;
  const v = it || {};
  const curTipo = (v.tipo || '').trim();
  const tipoOpts = _tipos.slice();
  if (curTipo && !tipoOpts.includes(curTipo)) tipoOpts.unshift(curTipo);
  return `<div class="card mt-3" style="background:var(--bg-3);border:1px solid var(--bd)">
    <h3 class="card-title" style="font-size:14px">${it ? '✏️ Editar CND' : '➕ Nova CND'}</h3>
    <div class="flex gap-2" style="flex-wrap:wrap">
      <div style="flex:2;min-width:220px"><label class="tiny muted">Título *</label><input id="cf-tit" class="input" value="${esc(v.titulo || '')}" placeholder="Ex.: CND Federal — PSM Imóveis"></div>
      <div style="flex:1;min-width:160px"><label class="tiny muted">Tipo</label>
        <select id="cf-tipo" class="input">
          <option value="">— Selecione —</option>
          ${tipoOpts.map(t => `<option value="${esc(t)}" ${t === curTipo ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:2;min-width:200px"><label class="tiny muted">Empresa / CNPJ</label><input id="cf-emp" class="input" value="${esc(v.empresa || '')}" placeholder="PSM CONQUISTA / PSM IMÓVEIS / Incorporadora…"></div>
      <div style="flex:1;min-width:150px"><label class="tiny muted">Nº da certidão</label><input id="cf-num" class="input" value="${esc(v.numero || '')}"></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:1;min-width:150px"><label class="tiny muted">Emissão</label><input id="cf-emi" type="date" class="input" value="${esc((v.emissao || '').slice(0, 10))}"></div>
      <div style="flex:1;min-width:150px"><label class="tiny muted">Validade</label><input id="cf-val" type="date" class="input" value="${esc((v.validade || '').slice(0, 10))}"></div>
    </div>
    <div class="mt-2"><label class="tiny muted">Link do Google Drive (PDF da certidão)</label><input id="cf-link" class="input" value="${esc(v.link || '')}" placeholder="https://drive.google.com/…"></div>
    <div class="mt-2"><label class="tiny muted">Observação</label><input id="cf-obs" class="input" value="${esc(v.obs || '')}" placeholder="Ex.: renovar 5 dias antes, responsável…"></div>
    <div class="flex gap-2 mt-3">
      <button class="btn btn-primary btn-sm" id="cf-save">${_busy ? '⏳ Salvando…' : '💾 Salvar'}</button>
      <button class="btn btn-ghost btn-sm" id="cf-cancel">Cancelar</button>
    </div>
  </div>`;
}

function wire() {
  const $ = s => _root.querySelector(s);
  $('#cnd-new') && ($('#cnd-new').onclick = () => { _editing = 'new'; render(); });
  _root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { _editing = b.dataset.edit; render(); });
  _root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  $('#cf-cancel') && ($('#cf-cancel').onclick = () => { _editing = null; render(); });
  $('#cf-save') && ($('#cf-save').onclick = save);
  const q = $('#cnd-q');
  if (q) q.oninput = () => { _q = q.value; const list = filtrados(); /* re-render só a lista seria ideal; render simples */ const pos = q.selectionStart; render(); const nq = _root.querySelector('#cnd-q'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (_) {} } };
}

async function save() {
  if (_busy) return;
  const $ = s => _root.querySelector(s);
  const item = {
    titulo: $('#cf-tit').value.trim(), tipo: $('#cf-tipo').value.trim(),
    empresa: $('#cf-emp').value.trim(), numero: $('#cf-num').value.trim(),
    emissao: $('#cf-emi').value, validade: $('#cf-val').value,
    link: $('#cf-link').value.trim(), obs: $('#cf-obs').value.trim(),
  };
  if (!item.titulo) return alert('Informe o título.');
  _busy = true; render();
  try {
    const isNew = _editing === 'new';
    await api.request('/api/v3/juridico/cnds', { method: 'POST', body: isNew ? { action: 'add', item } : { action: 'update', id: _editing, item } });
    _editing = null; _busy = false; await load();
  } catch (e) { _busy = false; render(); alert('Erro ao salvar: ' + e.message); }
}

async function del(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir a CND "${it?.titulo || ''}"?`)) return;
  try { await api.request('/api/v3/juridico/cnds', { method: 'POST', body: { action: 'delete', id } }); await load(); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}
