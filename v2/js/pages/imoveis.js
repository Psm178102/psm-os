/* PSM-OS v2 — Imóveis (Tabela PSM) Sprint 7.23 */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';

const STATUS = [
  { id: 'disponivel',    lbl: 'Disponível',     color: '#16a34a' },
  { id: 'em_negociacao', lbl: 'Em negociação',  color: '#d97706' },
  { id: 'vendido',       lbl: 'Vendido',        color: '#7c3aed' },
  { id: 'inativo',       lbl: 'Inativo',        color: '#64748b' },
];
const TIPOS = ['Apartamento', 'Casa', 'Cobertura', 'Sobrado', 'Terreno', 'Comercial', 'Rural'];

let _root = null, _items = [], _users = [], _kpis = {}, _filterStatus = '', _filterOrigem = '';

export async function pageImoveis(ctx, root) { _root = root; await reload(); }

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const qs = new URLSearchParams();
    if (_filterStatus) qs.set('status', _filterStatus);
    if (_filterOrigem) qs.set('origem', _filterOrigem);
    const [r, u] = await Promise.all([
      api.request('/api/v3/imoveis/list' + (qs.toString() ? '?' + qs : '')),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _items = r.imoveis || []; _kpis = r.kpis || {};
    if (u.users) _users = u.users;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🏘 Imóveis · Tabela PSM</h2>
      <p class="card-sub">${_kpis.total || 0} cadastrados · R$ ${money(_kpis.valor_total)} disponíveis · ${_kpis.proprios || 0} próprios · ${_kpis.terceiros || 0} terceiros</p>

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpi('🟢 Disponíveis', _kpis.disponiveis || 0, '', '#16a34a')}
        ${kpi('💰 Valor estoque', 'R$ ' + money(_kpis.valor_total), 'soma disponíveis', '#7c3aed')}
        ${kpi('🏠 Próprios', _kpis.proprios || 0, 'do PSM', '#2563eb')}
        ${kpi('🤝 Terceiros', _kpis.terceiros || 0, 'Kenlo/outros', '#d97706')}
      </div>

      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted">STATUS:</label>
        <select id="f-st" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todos</option>
          ${STATUS.map(s => `<option value="${s.id}"${_filterStatus===s.id?' selected':''}>${s.lbl}</option>`).join('')}
        </select>
        <label class="tiny muted" style="margin-left:10px">ORIGEM:</label>
        <select id="f-or" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todas</option>
          <option value="proprio"${_filterOrigem==='proprio'?' selected':''}>Próprio</option>
          <option value="terceiros"${_filterOrigem==='terceiros'?' selected':''}>Terceiros</option>
        </select>
        <button class="btn btn-primary" id="btn-novo" style="margin-left:auto">+ Novo</button>
      </div>

      <div class="mt-4" style="display:grid;gap:8px">
        ${_items.length === 0 ? '<div class="muted text-center" style="padding:30px">Nenhum imóvel.</div>' :
          _items.map(i => itemCard(i)).join('')}
      </div>
      <div id="modal-im" style="display:none"></div>
    </div>
  `;
  document.getElementById('f-st').addEventListener('change', async e => { _filterStatus = e.target.value; await reload(); });
  document.getElementById('f-or').addEventListener('change', async e => { _filterOrigem = e.target.value; await reload(); });
  document.getElementById('btn-novo').addEventListener('click', () => openModal());
  document.querySelectorAll('[data-im]').forEach(el => el.addEventListener('click', () => openModal(el.dataset.im)));
}

function itemCard(i) {
  const st = STATUS.find(s => s.id === i.status) || STATUS[0];
  const cap = _users.find(u => u.id === i.captador_id);
  return `
    <div data-im="${i.id}" style="background:var(--bg-3);border-left:4px solid ${st.color};border-radius:var(--r-md);padding:12px 16px;cursor:pointer">
      <div class="flex items-center gap-2" style="margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${escapeHtml(i.endereco)}${i.codigo ? ` <span class="tiny muted">#${escapeHtml(i.codigo)}</span>` : ''}</div>
          <div class="tiny muted">${escapeHtml(i.tipo || '')} · ${escapeHtml(i.bairro || '')}${i.cidade ? ' · ' + escapeHtml(i.cidade) : ''}</div>
        </div>
        ${i.fonte === 'captacao' ? `<span class="tiny" title="Veio do kanban de Captações (etapa: ${escapeHtml(i.etapa_captacao || '')})" style="background:#0891b2;color:#fff;padding:3px 10px;border-radius:var(--r-full);font-weight:700">📥 Captação</span>` : ''}
        <span class="tiny" style="background:${st.color};color:#fff;padding:3px 10px;border-radius:var(--r-full);font-weight:700">${st.lbl}</span>
      </div>
      <div class="flex gap-3" style="flex-wrap:wrap;font-size:12px">
        <div>💰 <b>R$ ${money(i.valor)}</b></div>
        ${i.area_m2 ? `<div>📐 ${i.area_m2}m²</div>` : ''}
        ${i.dormitorios ? `<div>🛏 ${i.dormitorios} dorm</div>` : ''}
        ${i.vagas ? `<div>🚗 ${i.vagas} vagas</div>` : ''}
        <div>🏷 ${escapeHtml(i.origem === 'terceiros' ? 'Terceiros' : 'Próprio')}</div>
        ${cap ? `<div>📋 ${escapeHtml(cap.name)}</div>` : ''}
      </div>
    </div>
  `;
}

function openModal(iid) {
  // Imóveis vindos de Captações são read-only aqui — edite no kanban de Captações.
  if (iid && String(iid).startsWith('cap_')) { location.hash = '#/captacoes'; return; }
  const i = iid ? _items.find(x => x.id === iid) : null;
  const modal = document.getElementById('modal-im');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:580px;width:100%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">${i ? '✏️ Editar' : '➕ Novo'} imóvel</h3>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Código</label><input id="im-cod" class="input" value="${i?escapeHtml(i.codigo||''):''}" placeholder="ex: AP-2024-001"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Tipo</label><select id="im-tipo" class="select">${TIPOS.map(t => `<option value="${t}"${i?.tipo===t?' selected':''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Endereço *</label><input id="im-end" class="input" value="${i?escapeHtml(i.endereco):''}"></div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px"><label>Bairro</label><input id="im-bairro" class="input" value="${i?escapeHtml(i.bairro||''):''}"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Cidade</label><input id="im-cidade" class="input" value="${i?escapeHtml(i.cidade||'São José do Rio Preto'):'São José do Rio Preto'}"></div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Valor R$</label><input id="im-val" type="number" step="0.01" class="input" value="${i?.valor||0}"></div>
        <div class="field" style="flex:1;min-width:100px"><label>Área m²</label><input id="im-area" type="number" step="0.1" class="input" value="${i?.area_m2||''}"></div>
        <div class="field" style="flex:1;min-width:80px"><label>Dorm</label><input id="im-dorm" type="number" class="input" value="${i?.dormitorios||''}"></div>
        <div class="field" style="flex:1;min-width:80px"><label>Vagas</label><input id="im-vagas" type="number" class="input" value="${i?.vagas||''}"></div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Status</label><select id="im-st" class="select">${STATUS.map(s => `<option value="${s.id}"${(i?.status||'disponivel')===s.id?' selected':''}>${s.lbl}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;min-width:140px"><label>Origem</label><select id="im-or" class="select"><option value="proprio"${(i?.origem||'proprio')==='proprio'?' selected':''}>Próprio</option><option value="terceiros"${i?.origem==='terceiros'?' selected':''}>Terceiros</option></select></div>
        <div class="field" style="flex:1;min-width:160px"><label>Captador</label><select id="im-cap" class="select"><option value="">— —</option>${selectableUsers(_users, i?.captador_id).map(u => `<option value="${escapeHtml(u.id)}"${i?.captador_id===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Descrição</label><textarea id="im-desc" class="input" rows="3">${i?.descricao?escapeHtml(i.descricao):''}</textarea></div>
      <div class="field"><label>Link fotos</label><input id="im-link" class="input" value="${i?escapeHtml(i.link_fotos||''):''}" placeholder="https://..."></div>
      <div id="im-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${i?'<button class="btn btn-danger" id="im-del">🗑</button>':'<span></span>'}
        <div class="flex gap-2"><button class="btn btn-ghost" id="im-cancel">Cancelar</button><button class="btn btn-primary" id="im-save">${i?'Salvar':'Criar'}</button></div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('im-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('im-save').addEventListener('click', async () => {
    const body = { id: i?.id, codigo: document.getElementById('im-cod').value.trim()||null, tipo: document.getElementById('im-tipo').value, endereco: document.getElementById('im-end').value.trim(), bairro: document.getElementById('im-bairro').value.trim()||null, cidade: document.getElementById('im-cidade').value.trim()||null, valor: parseFloat(document.getElementById('im-val').value)||0, area_m2: parseFloat(document.getElementById('im-area').value)||null, dormitorios: parseInt(document.getElementById('im-dorm').value)||null, vagas: parseInt(document.getElementById('im-vagas').value)||null, status: document.getElementById('im-st').value, origem: document.getElementById('im-or').value, captador_id: document.getElementById('im-cap').value||null, descricao: document.getElementById('im-desc').value.trim()||null, link_fotos: document.getElementById('im-link').value.trim()||null };
    if (!body.endereco) { document.getElementById('im-msg').innerHTML = '<div class="alert alert-err">Endereço obrigatório.</div>'; return; }
    try { await api.request('/api/v3/imoveis/upsert', { method: 'POST', body }); modal.style.display='none'; await reload(); }
    catch (e) { document.getElementById('im-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; }
  });
  if (i) document.getElementById('im-del').addEventListener('click', async () => {
    if (!confirm('Apagar?')) return;
    try { await api.request('/api/v3/imoveis/upsert', { method: 'POST', body: { id: i.id, _delete: true } }); modal.style.display='none'; await reload(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}"><div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div><div style="font-size:20px;font-weight:900;color:${color};margin-top:2px">${big}</div><div class="tiny muted">${sub||''}</div></div>`;
}
function money(n) { return n == null || isNaN(n) ? '0' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
