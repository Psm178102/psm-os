/* ============================================================================
   PSM-OS v2 — 🏢 Sistema e Drive Incorporadoras (Secretaria de Vendas)
   Um card por incorporadora reunindo tudo: WhatsApp do gerente e do coordenador,
   link do grupo PSM↔incorporadora, link de tabelas, link do Drive, e o acesso ao
   sistema (nome, URL, login, senha mascarável). Vê: quem alcança a Secretaria.
   Gerencia (add/editar/excluir): só o sócio (lvl10), pois guarda senha.
============================================================================ */
import { api } from '../api.js';

let _root = null, _items = [], _canManage = false, _editing = null, _busy = false, _q = '';
const _shown = new Set();   // ids com senha revelada nesta sessão de tela

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const incColor = c => { let h = 0; for (const ch of String(c || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h},55%,45%)`; };
const waLink = num => { const d = String(num || '').replace(/\D/g, ''); return d ? 'https://wa.me/' + (d.length <= 11 ? '55' + d : d) : ''; };

export async function pageSistemasIncorporadoras(ctx, root) {
  _root = root; _editing = null; _busy = false; _q = ''; _shown.clear();
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando incorporadoras…</div></div>';
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/secretaria/sistemas');
    _items = r.items || [];
    _canManage = !!r.can_manage;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`;
  }
}

function filtrados() {
  const q = _q.trim().toLowerCase();
  let list = _items.slice();
  if (q) list = list.filter(it => [it.incorporadora, it.gerente, it.coordenador, it.sistema, it.obs].some(v => String(v || '').toLowerCase().includes(q)));
  return list.sort((a, b) => String(a.incorporadora || '').localeCompare(String(b.incorporadora || ''), 'pt-BR'));
}

function render() {
  const list = filtrados();
  _root.innerHTML = `
    <style>
      .si-card{border:1px solid var(--bd);border-left:4px solid var(--c);border-radius:12px;padding:13px 15px;margin-bottom:11px}
      .si-h{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
      .si-sec{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-muted,#94a3b8);font-weight:800;margin:9px 0 4px}
      .si-row{display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap;margin-bottom:3px}
      .si-row .lbl{font-size:11px;color:var(--ink-muted,#64748b);min-width:74px;flex:0 0 74px}
      .si-val{font-family:ui-monospace,monospace;font-size:12.5px;background:var(--bg-3);padding:3px 9px;border-radius:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .si-ico{cursor:pointer;border:0;background:transparent;font-size:14px;padding:2px 5px;border-radius:6px}
      .si-ico:hover{background:var(--bg-3)}
      .si-links{display:flex;gap:6px;flex-wrap:wrap}
    </style>
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">🏢 Sistema e Drive Incorporadoras</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:720px">${_canManage
            ? 'Tudo de cada incorporadora num lugar: WhatsApp do gerente/coordenador, grupo, tabelas, Drive e o acesso ao sistema. Você gerencia; a senha fica mascarada.'
            : 'Contatos, grupos, Drive e acessos das incorporadoras. A senha fica mascarada (revele/copie quando precisar). 🔒'}
            ${_items.length ? `<b> · ${_items.length} incorporadora(s)</b>` : ''}</p>
        </div>
        ${_canManage ? `<button class="btn btn-primary btn-sm" id="si-new">➕ Nova incorporadora</button>` : ''}
      </div>

      ${_editing !== null ? formHTML() : ''}

      ${_items.length ? `<input id="si-q" class="input mt-2" placeholder="🔎 Buscar por incorporadora, gerente, coordenador, sistema…" value="${esc(_q)}">` : ''}

      ${!_items.length ? `
        <div class="card mt-3" style="text-align:center;padding:32px;background:var(--bg-3)">
          <div style="font-size:30px">🏢</div>
          <div class="muted tiny" style="margin-top:6px">${_canManage ? 'Nenhuma incorporadora cadastrada ainda. Clique em “➕ Nova incorporadora”.' : 'Nenhuma incorporadora cadastrada ainda.'}</div>
        </div>`
        : (list.length ? list.map(cardHTML).join('') : '<div class="muted tiny mt-3">Nada encontrado para a busca.</div>')}

      ${_canManage ? '<p class="tiny muted mt-3">🔒 A senha do sistema fica guardada com acesso restrito do servidor e aparece mascarada — clique 👁 pra revelar. Edição só pelo sócio.</p>' : ''}
    </div>`;
  wire();
}

function cardHTML(it) {
  const cor = incColor(it.incorporadora);
  const rev = _shown.has(it.id);
  const waG = waLink(it.gerente_whatsapp), waC = waLink(it.coordenador_whatsapp);
  const links = [
    it.grupo_link && `<a class="btn btn-ghost btn-sm" href="${esc(it.grupo_link)}" target="_blank" rel="noopener">💬 Grupo PSM</a>`,
    it.tabelas_link && `<a class="btn btn-ghost btn-sm" href="${esc(it.tabelas_link)}" target="_blank" rel="noopener">📊 Tabelas</a>`,
    it.drive_link && `<a class="btn btn-ghost btn-sm" href="${esc(it.drive_link)}" target="_blank" rel="noopener">📁 Drive</a>`,
  ].filter(Boolean).join('');
  const temContato = it.gerente || it.gerente_whatsapp || it.coordenador || it.coordenador_whatsapp;
  const temSistema = it.sistema || it.sistema_url || it.sistema_login || it.sistema_senha;
  return `<div class="si-card" style="--c:${cor}">
    <div class="si-h">
      <b style="font-size:15px">${esc(it.incorporadora)}</b>
      ${_canManage ? `<div class="flex gap-1">
        <button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">✏️</button>
        <button class="btn btn-ghost btn-sm" data-del="${esc(it.id)}" style="color:#dc2626">🗑</button></div>` : ''}
    </div>

    ${temContato ? `<div class="si-sec">👤 Contatos</div>
      ${(it.gerente || it.gerente_whatsapp) ? `<div class="si-row"><span class="lbl">Gerente</span><span>${esc(it.gerente || '—')}</span>${waG ? `<a class="btn btn-sm" href="${esc(waG)}" target="_blank" rel="noopener" style="background:#16a34a;color:#fff;border-color:#16a34a">💬 ${esc(it.gerente_whatsapp)}</a>` : ''}</div>` : ''}
      ${(it.coordenador || it.coordenador_whatsapp) ? `<div class="si-row"><span class="lbl">Coordenador</span><span>${esc(it.coordenador || '—')}</span>${waC ? `<a class="btn btn-sm" href="${esc(waC)}" target="_blank" rel="noopener" style="background:#16a34a;color:#fff;border-color:#16a34a">💬 ${esc(it.coordenador_whatsapp)}</a>` : ''}</div>` : ''}` : ''}

    ${links ? `<div class="si-sec">🔗 Links</div><div class="si-links">${links}</div>` : ''}

    ${temSistema ? `<div class="si-sec">🔐 Sistema${it.sistema ? ' · ' + esc(it.sistema) : ''}</div>
      ${it.sistema_url ? `<div class="si-row"><span class="lbl">Acesso</span><a class="btn btn-ghost btn-sm" href="${esc(it.sistema_url)}" target="_blank" rel="noopener">🌐 abrir sistema</a></div>` : ''}
      ${it.sistema_login ? `<div class="si-row"><span class="lbl">Login</span><span class="si-val">${esc(it.sistema_login)}</span><button class="si-ico" data-copy="login|${esc(it.id)}" title="Copiar">📋</button></div>` : ''}
      ${it.sistema_senha ? `<div class="si-row"><span class="lbl">Senha</span><span class="si-val" data-senha="${esc(it.id)}">${rev ? esc(it.sistema_senha) : '••••••••••'}</span>
        <button class="si-ico" data-reveal="${esc(it.id)}" title="${rev ? 'Ocultar' : 'Revelar'}">${rev ? '🙈' : '👁'}</button>
        <button class="si-ico" data-copy="senha|${esc(it.id)}" title="Copiar">📋</button></div>` : ''}` : ''}

    ${it.obs ? `<div class="tiny muted" style="margin-top:6px">📝 ${esc(it.obs)}</div>` : ''}
  </div>`;
}

function formHTML() {
  const it = _editing && _editing !== 'new' ? _items.find(i => i.id === _editing) : null;
  const v = it || {};
  return `<div class="card mt-3" style="background:var(--bg-3);border:1px solid var(--bd)">
    <h3 class="card-title" style="font-size:14px">${it ? '✏️ Editar incorporadora' : '➕ Nova incorporadora'}</h3>
    <div class="mt-1"><label class="tiny muted">Incorporadora *</label><input id="if-inc" class="input" value="${esc(v.incorporadora || '')}" placeholder="Ex.: MRV, Cyrela, Tarraf…"></div>

    <div class="si-sec" style="margin-top:10px">👤 Contatos</div>
    <div class="flex gap-2" style="flex-wrap:wrap">
      <div style="flex:2;min-width:180px"><label class="tiny muted">Gerente</label><input id="if-ger" class="input" value="${esc(v.gerente || '')}" placeholder="Nome do gerente"></div>
      <div style="flex:1;min-width:150px"><label class="tiny muted">WhatsApp gerente</label><input id="if-gerw" class="input" value="${esc(v.gerente_whatsapp || '')}" placeholder="(11) 99999-9999"></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:2;min-width:180px"><label class="tiny muted">Coordenador</label><input id="if-coo" class="input" value="${esc(v.coordenador || '')}" placeholder="Nome do coordenador"></div>
      <div style="flex:1;min-width:150px"><label class="tiny muted">WhatsApp coordenador</label><input id="if-coow" class="input" value="${esc(v.coordenador_whatsapp || '')}" placeholder="(11) 99999-9999"></div>
    </div>

    <div class="si-sec" style="margin-top:10px">🔗 Links</div>
    <div class="mt-1"><label class="tiny muted">Grupo PSM ↔ incorporadora (WhatsApp)</label><input id="if-grupo" class="input" value="${esc(v.grupo_link || '')}" placeholder="https://chat.whatsapp.com/…"></div>
    <div class="mt-2"><label class="tiny muted">Tabelas (coordenador/gerente)</label><input id="if-tab" class="input" value="${esc(v.tabelas_link || '')}" placeholder="Link das tabelas"></div>
    <div class="mt-2"><label class="tiny muted">Drive da incorporadora</label><input id="if-drive" class="input" value="${esc(v.drive_link || '')}" placeholder="https://drive.google.com/…"></div>

    <div class="si-sec" style="margin-top:10px">🔐 Sistema</div>
    <div class="flex gap-2" style="flex-wrap:wrap">
      <div style="flex:1;min-width:160px"><label class="tiny muted">Nome do sistema</label><input id="if-sis" class="input" value="${esc(v.sistema || '')}" placeholder="Ex.: VIMOB, CV CRM…"></div>
      <div style="flex:2;min-width:200px"><label class="tiny muted">URL do sistema</label><input id="if-sisurl" class="input" value="${esc(v.sistema_url || '')}" placeholder="https://…"></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
      <div style="flex:1;min-width:180px"><label class="tiny muted">Login</label><input id="if-login" class="input" value="${esc(v.sistema_login || '')}"></div>
      <div style="flex:1;min-width:180px"><label class="tiny muted">Senha</label><input id="if-senha" type="text" class="input" value="${esc(v.sistema_senha || '')}"></div>
    </div>
    <div class="mt-2"><label class="tiny muted">Observação</label><input id="if-obs" class="input" value="${esc(v.obs || '')}" placeholder="2FA, ramal, horário, etc."></div>

    <div class="flex gap-2 mt-3">
      <button class="btn btn-primary btn-sm" id="if-save">${_busy ? '⏳ Salvando…' : '💾 Salvar'}</button>
      <button class="btn btn-ghost btn-sm" id="if-cancel">Cancelar</button>
    </div>
  </div>`;
}

function wire() {
  const $ = s => _root.querySelector(s);
  $('#si-new') && ($('#si-new').onclick = () => { _editing = 'new'; render(); });
  _root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { _editing = b.dataset.edit; render(); });
  _root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
  _root.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => { const id = b.dataset.reveal; _shown.has(id) ? _shown.delete(id) : _shown.add(id); render(); });
  _root.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const [campo, id] = b.dataset.copy.split('|');
    const it = _items.find(x => x.id === id); if (!it) return;
    const val = campo === 'senha' ? (it.sistema_senha || '') : (it.sistema_login || '');
    navigator.clipboard.writeText(val).then(() => { b.textContent = '✅'; setTimeout(() => { b.textContent = '📋'; }, 1200); }).catch(() => {});
  });
  $('#if-cancel') && ($('#if-cancel').onclick = () => { _editing = null; render(); });
  $('#if-save') && ($('#if-save').onclick = save);
  const q = $('#si-q');
  if (q) q.oninput = () => { _q = q.value; const pos = q.selectionStart; render(); const nq = _root.querySelector('#si-q'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (_) {} } };
}

async function save() {
  if (_busy) return;
  const $ = s => _root.querySelector(s);
  const item = {
    incorporadora: $('#if-inc').value.trim(),
    gerente: $('#if-ger').value.trim(), gerente_whatsapp: $('#if-gerw').value.trim(),
    coordenador: $('#if-coo').value.trim(), coordenador_whatsapp: $('#if-coow').value.trim(),
    grupo_link: $('#if-grupo').value.trim(), tabelas_link: $('#if-tab').value.trim(), drive_link: $('#if-drive').value.trim(),
    sistema: $('#if-sis').value.trim(), sistema_url: $('#if-sisurl').value.trim(),
    sistema_login: $('#if-login').value.trim(), sistema_senha: $('#if-senha').value,
    obs: $('#if-obs').value.trim(),
  };
  if (!item.incorporadora) return alert('Informe a incorporadora.');
  _busy = true; render();
  try {
    const isNew = _editing === 'new';
    await api.request('/api/v3/secretaria/sistemas', { method: 'POST', body: isNew ? { action: 'add', item } : { action: 'update', id: _editing, item } });
    _editing = null; _busy = false; await load();
  } catch (e) { _busy = false; render(); alert('Erro ao salvar: ' + e.message); }
}

async function del(id) {
  const it = _items.find(i => i.id === id);
  if (!confirm(`Excluir a incorporadora "${it?.incorporadora || ''}"?`)) return;
  try { await api.request('/api/v3/secretaria/sistemas', { method: 'POST', body: { action: 'delete', id } }); await load(); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}
