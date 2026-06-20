/* ============================================================================
   PSM-OS v2 — 📞 SAC Incorporadoras (Secretaria de Vendas & Backoffice)
   Agenda de contatos das incorporadoras: SAC (tel/WhatsApp) + coordenador e
   gerente POR PRODUTO. Agrupa por incorporadora; botões diretos de ligar,
   WhatsApp e e-mail. Gerencia lvl>=5 (backoffice/líder/gerente/sócio).
============================================================================ */
import { api } from '../api.js';

let _root = null, _items = [], _tipos = [], _canManage = false, _editing = null, _busy = false, _q = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const incColor = c => { let h = 0; for (const ch of String(c || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h},55%,45%)`; };

// ordem dos tipos dentro de cada incorporadora (SAC primeiro)
function tipoOrd(t) {
  const x = String(t || '').toLowerCase();
  if (x.includes('sac')) return 0;
  if (x.includes('coorden')) return 1;
  if (x.includes('gerente')) return 2;
  if (x.includes('comercial')) return 3;
  return 5;
}
// WhatsApp → wa.me só com dígitos; sem DDI assume Brasil (55)
function waLink(num) {
  const d = String(num || '').replace(/\D/g, '');
  if (!d) return '';
  return 'https://wa.me/' + (d.length <= 11 ? '55' + d : d);
}
function telLink(num) {
  const d = String(num || '').replace(/[^\d+]/g, '');
  return d ? 'tel:' + d : '';
}

export async function pageSacIncorporadoras(ctx, root) {
  _root = root; _editing = null; _busy = false; _q = '';
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando contatos…</div></div>';
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/secretaria/sac');
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
  if (!q) return _items.slice();
  return _items.filter(it => [it.incorporadora, it.tipo, it.produto, it.nome, it.telefone, it.whatsapp, it.email, it.obs]
    .some(v => String(v || '').toLowerCase().includes(q)));
}

function render() {
  const list = filtrados();
  const groups = {};
  list.forEach(it => { const c = (it.incorporadora || '').trim() || 'Sem incorporadora'; (groups[c] = groups[c] || []).push(it); });
  const order = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const totalInc = new Set(_items.map(it => (it.incorporadora || '').trim()).filter(Boolean)).size;

  _root.innerHTML = `
    <style>
      .sac-row{display:flex;align-items:center;gap:10px;border:1px solid var(--bd);border-radius:10px;padding:10px 13px;margin-bottom:8px;flex-wrap:wrap}
      .sac-row .nm{font-size:14px;font-weight:700}
      .sac-badge{display:inline-block;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:20px;background:#e0e7ff;color:#3730a3}
      .sac-meta{display:flex;flex-wrap:wrap;gap:3px 12px;font-size:12px;color:var(--ink-muted,#64748b);margin-top:1px}
      .sac-acts{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
      .sac-inc-h{font-size:14px;display:flex;align-items:center;gap:8px;margin:0 0 4px}
    </style>
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">📞 SAC Incorporadoras</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:700px">${_canManage
            ? 'Contatos das incorporadoras: SAC, coordenador e gerente por produto. Ligue ou chame no WhatsApp num toque.'
            : 'Contatos das incorporadoras (SAC, coordenador, gerente). Toque para ligar ou abrir o WhatsApp. 📞'}
            ${totalInc ? `<b> · ${totalInc} incorporadora(s), ${_items.length} contato(s)</b>` : ''}</p>
        </div>
        ${_canManage ? `<button class="btn btn-primary btn-sm" id="sac-new">➕ Novo contato</button>` : ''}
      </div>

      ${_editing !== null ? formHTML() : ''}

      ${_items.length ? `<input id="sac-q" class="input mt-2" placeholder="🔎 Buscar por incorporadora, produto, nome, telefone…" value="${esc(_q)}">` : ''}

      ${!_items.length ? `
        <div class="card mt-3" style="text-align:center;padding:32px;background:var(--bg-3)">
          <div style="font-size:30px">📞</div>
          <div class="muted tiny" style="margin-top:6px">${_canManage ? 'Nenhum contato cadastrado ainda. Clique em “➕ Novo contato”.' : 'Nenhum contato cadastrado ainda.'}</div>
        </div>`
        : (list.length ? order.map(c => groupHTML(c, groups[c])).join('') : '<div class="muted tiny mt-3">Nada encontrado para a busca.</div>')}

      ${_canManage ? '<p class="tiny muted mt-3">💬 No WhatsApp, informe o número com DDD (ex.: 17 99999-9999) — se faltar o DDI, assumimos Brasil (55).</p>' : ''}
    </div>`;
  wire();
}

function groupHTML(inc, items) {
  const cor = incColor(inc);
  items = items.slice().sort((a, b) => tipoOrd(a.tipo) - tipoOrd(b.tipo) || String(a.produto || '').localeCompare(String(b.produto || ''), 'pt-BR'));
  return `<div class="card mt-3">
    <h3 class="sac-inc-h"><span style="width:11px;height:11px;border-radius:3px;background:${cor};display:inline-block"></span>${esc(inc)} <span class="tiny muted" style="font-weight:400">(${items.length})</span></h3>
    ${items.map(rowHTML).join('')}</div>`;
}

function rowHTML(it) {
  const wa = waLink(it.whatsapp), tel = telLink(it.telefone);
  const meta = [
    it.produto && `🏗 ${esc(it.produto)}`,
    it.telefone && `📞 ${esc(it.telefone)}`,
    it.whatsapp && `💬 ${esc(it.whatsapp)}`,
    it.email && `✉️ ${esc(it.email)}`,
  ].filter(Boolean).join('  ');
  return `<div class="sac-row">
    <div style="flex:1;min-width:180px">
      <div class="nm">${esc(it.nome || it.tipo || 'Contato')} ${it.tipo ? `<span class="sac-badge">${esc(it.tipo)}</span>` : ''}</div>
      ${meta ? `<div class="sac-meta">${meta}</div>` : ''}
      ${it.obs ? `<div class="tiny muted" style="margin-top:1px">📝 ${esc(it.obs)}</div>` : ''}
    </div>
    <div class="sac-acts">
      ${wa ? `<a class="btn btn-primary btn-sm" href="${esc(wa)}" target="_blank" rel="noopener" style="background:#16a34a;border-color:#16a34a">💬 WhatsApp</a>` : ''}
      ${tel ? `<a class="btn btn-ghost btn-sm" href="${esc(tel)}">📞 Ligar</a>` : ''}
      ${it.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(it.email)}">✉️</a>` : ''}
      ${_canManage ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">✏️</button>
        <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" style="color:#dc2626">🗑</button>` : ''}
    </div>
  </div>`;
}

function formHTML() {
  const it = _editing && _editing !== 'new' ? _items.find(i => i.id === _editing) : null;
  const v = it || {};
  const incs = [...new Set(_items.map(i => (i.incorporadora || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return `<div class="card mt-3" style="background:var(--bg-3);border:1px solid var(--bd)">
    <h3 class="card-title" style="font-size:14px">${it ? '✏️ Editar contato' : '➕ Novo contato'}</h3>
    <div class="flex gap-2" style="flex-wrap:wrap">
      <div style="flex:2;min-width:200px"><label class="tiny muted">Incorporadora *</label>
        <input id="sf-inc" class="input" list="sf-incs" value="${esc(v.incorporadora || '')}" placeholder="Ex.: MRV, Cyrela, Plano&Plano…">
        <datalist id="sf-incs">${incs.map(i => `<option value="${esc(i)}">`).join('')}</datalist></div>
      <div style="flex:1;min-width:160px"><label class="tiny muted">Tipo de contato</label>
        <input id="sf-tipo" class="input" list="sf-tipos" value="${esc(v.tipo || '')}" placeholder="SAC, Coordenador, Gerente…">
        <datalist id="sf-tipos">${_tipos.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:1;min-width:200px"><label class="tiny muted">Produto / empreendimento</label><input id="sf-prod" class="input" value="${esc(v.produto || '')}" placeholder="Ex.: Residencial Jardins (deixe vazio se for geral)"></div>
      <div style="flex:1;min-width:200px"><label class="tiny muted">Nome do contato</label><input id="sf-nome" class="input" value="${esc(v.nome || '')}" placeholder="Pessoa responsável (opcional p/ SAC)"></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:1;min-width:150px"><label class="tiny muted">Telefone</label><input id="sf-tel" class="input" value="${esc(v.telefone || '')}" placeholder="(17) 3000-0000"></div>
      <div style="flex:1;min-width:150px"><label class="tiny muted">WhatsApp</label><input id="sf-wa" class="input" value="${esc(v.whatsapp || '')}" placeholder="(17) 99999-9999"></div>
      <div style="flex:1;min-width:180px"><label class="tiny muted">E-mail</label><input id="sf-mail" class="input" value="${esc(v.email || '')}" placeholder="sac@incorporadora.com.br"></div>
    </div>
    <div class="mt-2"><label class="tiny muted">Observação</label><input id="sf-obs" class="input" value="${esc(v.obs || '')}" placeholder="Horário de atendimento, ramal, observações…"></div>
    <div class="flex gap-2 mt-3">
      <button class="btn btn-primary btn-sm" id="sf-save">${_busy ? '⏳ Salvando…' : '💾 Salvar'}</button>
      <button class="btn btn-ghost btn-sm" id="sf-cancel">Cancelar</button>
    </div>
  </div>`;
}

function wire() {
  const $ = s => _root.querySelector(s);
  $('#sac-new') && ($('#sac-new').onclick = () => { _editing = 'new'; render(); });
  _root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { _editing = b.dataset.edit; render(); });
  _root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  $('#sf-cancel') && ($('#sf-cancel').onclick = () => { _editing = null; render(); });
  $('#sf-save') && ($('#sf-save').onclick = save);
  const q = $('#sac-q');
  if (q) q.oninput = () => { _q = q.value; const pos = q.selectionStart; render(); const nq = _root.querySelector('#sac-q'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (_) {} } };
}

async function save() {
  if (_busy) return;
  const $ = s => _root.querySelector(s);
  const item = {
    incorporadora: $('#sf-inc').value.trim(), tipo: $('#sf-tipo').value.trim(),
    produto: $('#sf-prod').value.trim(), nome: $('#sf-nome').value.trim(),
    telefone: $('#sf-tel').value.trim(), whatsapp: $('#sf-wa').value.trim(),
    email: $('#sf-mail').value.trim(), obs: $('#sf-obs').value.trim(),
  };
  if (!item.incorporadora) return alert('Informe a incorporadora.');
  _busy = true; render();
  try {
    const isNew = _editing === 'new';
    await api.request('/api/v3/secretaria/sac', { method: 'POST', body: isNew ? { action: 'add', item } : { action: 'update', id: _editing, item } });
    _editing = null; _busy = false; await load();
  } catch (e) { _busy = false; render(); alert('Erro ao salvar: ' + e.message); }
}

async function del(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir o contato "${it?.nome || it?.tipo || ''}" de ${it?.incorporadora || ''}?`)) return;
  try { await api.request('/api/v3/secretaria/sac', { method: 'POST', body: { action: 'delete', id } }); await load(); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}
