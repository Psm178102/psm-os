/* PSM-OS v2 — Locações (Sprint 7.21) */
import { api } from '../api.js';
import { auth } from '../auth.js';

const STATUS = [
  { id: 'disponivel',   lbl: 'Disponível',    color: '#16a34a', ico: '🟢' },
  { id: 'ocupado',      lbl: 'Ocupado',       color: '#2563eb', ico: '🔵' },
  { id: 'em_renovacao', lbl: 'Em renovação',  color: '#d97706', ico: '🟡' },
  { id: 'em_atraso',    lbl: 'Em atraso',     color: '#dc2626', ico: '🔴' },
];

let _root = null, _items = [], _users = [], _kpis = {}, _filterStatus = '';

export async function pageLocacoes(ctx, root) { _root = root; await reload(); }

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const qs = _filterStatus ? '?status=' + _filterStatus : '';
    const [l, u] = await Promise.all([
      api.request('/api/v3/locacoes/list' + qs),
      _users.length ? Promise.resolve({ users: _users }) : api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _items = l.locacoes || [];
    _kpis = l.kpis || {};
    if (u.users) _users = u.users;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const canEdit = (me?.lvl || 0) >= 7;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔑 Locações — Gestão da Carteira</h2>
      <p class="card-sub">${_kpis.total || 0} contratos · <b style="color:#16a34a">R$ ${money(_kpis.receita_adm)}/mês</b> de receita de administração (recorrente PSM) · R$ ${money(_kpis.receita_aluguel)} de aluguel sob gestão</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px">
        ${kpi('💼 Receita ADM/mês', 'R$ ' + money(_kpis.receita_adm), 'recorrente da PSM', '#16a34a')}
        ${kpi('🔵 Contratos ativos', _kpis.ocupadas || 0, _kpis.ocupacao_pct != null ? _kpis.ocupacao_pct + '% de ocupação' : '', '#2563eb')}
        ${kpi('🏦 Aluguel sob gestão', 'R$ ' + money(_kpis.receita_aluguel), 'soma dos ativos', '#0891b2')}
        ${kpi('⏰ A vencer 30/60/90d', (_kpis.vence_30d || 0) + ' / ' + (_kpis.vence_60d || 0) + ' / ' + (_kpis.vence_90d || 0), 'renovar contrato', '#d97706')}
        ${kpi('🔴 Em atraso', _kpis.em_atraso || 0, 'inadimplência', '#dc2626')}
        ${kpi('🟢 Disponíveis', _kpis.disponiveis || 0, 'sem inquilino', '#64748b')}
      </div>

      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center;padding:10px;background:var(--bg-3);border-radius:var(--r-sm)">
        <label class="tiny muted" style="font-weight:700">STATUS:</label>
        <select id="f-st" class="select" style="padding:5px 10px;font-size:12px">
          <option value="">Todos</option>
          ${STATUS.map(s => `<option value="${s.id}"${_filterStatus===s.id?' selected':''}>${s.ico} ${s.lbl}</option>`).join('')}
        </select>
        ${canEdit ? '<button class="btn btn-ghost" id="btn-import" style="margin-left:auto">📤 Importar planilha</button>' : ''}
        ${canEdit ? '<button class="btn btn-primary" id="btn-novo">+ Novo contrato</button>' : ''}
      </div>

      <div class="mt-4" style="display:grid;gap:8px">
        ${_items.length === 0 ? '<div class="muted text-center" style="padding:30px">Nenhuma locação cadastrada.</div>' :
          _items.map(i => itemCard(i, canEdit)).join('')}
      </div>

      <div id="modal-lo" style="display:none"></div>
      <div id="modal-import" style="display:none"></div>
    </div>
  `;
  document.getElementById('f-st').addEventListener('change', async e => { _filterStatus = e.target.value; await reload(); });
  const btnNovo = document.getElementById('btn-novo');
  if (btnNovo) btnNovo.addEventListener('click', () => openModal());
  const btnImp = document.getElementById('btn-import');
  if (btnImp) btnImp.addEventListener('click', openImport);
  document.querySelectorAll('[data-lo]').forEach(el => el.addEventListener('click', () => openModal(el.dataset.lo)));
}

function itemCard(i, canEdit) {
  const status = STATUS.find(s => s.id === i.status) || STATUS[0];
  const resp = _users.find(u => u.id === i.responsavel_id);
  const fim = i.data_fim_contrato ? new Date(i.data_fim_contrato) : null;
  const today = new Date();
  const venceEm = fim ? Math.round((fim - today) / 86400000) : null;
  return `
    <div ${canEdit ? `data-lo="${i.id}"` : ''} style="background:var(--bg-3);border-left:4px solid ${status.color};border-radius:var(--r-md);padding:12px 16px;${canEdit ? 'cursor:pointer' : ''}">
      <div class="flex items-center gap-2" style="margin-bottom:6px">
        <span style="font-size:18px">${status.ico}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${escapeHtml(i.endereco)}</div>
          <div class="tiny muted">${escapeHtml(i.bairro || '')}${i.cidade ? ' · ' + escapeHtml(i.cidade) : ''}</div>
        </div>
        <span class="tiny" style="background:${status.color};color:#fff;padding:3px 10px;border-radius:var(--r-full);font-weight:700">${status.lbl}</span>
      </div>
      <div class="flex gap-3" style="flex-wrap:wrap;font-size:12px">
        ${i.inquilino_nome ? `<div>👤 <b>${escapeHtml(i.inquilino_nome)}</b></div>` : ''}
        <div>💰 <b>R$ ${money(i.valor_aluguel)}</b>${i.dia_vencimento ? ' (venc dia ' + i.dia_vencimento + ')' : ''}</div>
        ${venceEm != null ? `<div style="color:${venceEm < 0 ? '#dc2626' : venceEm < 30 ? '#d97706' : 'var(--ink-muted)'}">📅 ${venceEm < 0 ? 'vencido há ' + Math.abs(venceEm) + 'd' : venceEm + 'd até fim'}</div>` : ''}
        ${resp ? `<div>🛡 ${escapeHtml(resp.name)}</div>` : ''}
      </div>
    </div>
  `;
}

function openModal(lid) {
  const i = lid ? _items.find(x => x.id === lid) : null;
  const modal = document.getElementById('modal-lo');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:580px;width:100%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">${i ? '✏️ Editar' : '➕ Novo'} imóvel</h3>
      <div class="field"><label>Endereço *</label><input id="lo-end" class="input" value="${i ? escapeHtml(i.endereco) : ''}"></div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px"><label>Bairro</label><input id="lo-bairro" class="input" value="${i ? escapeHtml(i.bairro||'') : ''}"></div>
        <div class="field" style="flex:1;min-width:160px"><label>Cidade</label><input id="lo-cidade" class="input" value="${i ? escapeHtml(i.cidade||'São José do Rio Preto') : 'São José do Rio Preto'}"></div>
      </div>
      <h4 style="margin:10px 0 6px;font-size:13px;color:var(--ink-muted)">PROPRIETÁRIO</h4>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px"><label>Nome</label><input id="lo-prop" class="input" value="${i ? escapeHtml(i.proprietario_nome||'') : ''}"></div>
        <div class="field" style="flex:1;min-width:160px"><label>Contato</label><input id="lo-pcont" class="input" value="${i ? escapeHtml(i.proprietario_contato||'') : ''}"></div>
      </div>
      <h4 style="margin:10px 0 6px;font-size:13px;color:var(--ink-muted)">INQUILINO</h4>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:160px"><label>Nome</label><input id="lo-inq" class="input" value="${i ? escapeHtml(i.inquilino_nome||'') : ''}"></div>
        <div class="field" style="flex:1;min-width:160px"><label>Contato</label><input id="lo-icont" class="input" value="${i ? escapeHtml(i.inquilino_contato||'') : ''}"></div>
      </div>
      <h4 style="margin:10px 0 6px;font-size:13px;color:var(--ink-muted)">VALORES</h4>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:120px"><label>Aluguel R$</label><input id="lo-val" type="number" step="0.01" class="input" value="${i?.valor_aluguel || 0}"></div>
        <div class="field" style="flex:1;min-width:120px"><label>Condomínio R$</label><input id="lo-cond" type="number" step="0.01" class="input" value="${i?.valor_condominio || 0}"></div>
        <div class="field" style="flex:1;min-width:120px"><label>IPTU R$</label><input id="lo-iptu" type="number" step="0.01" class="input" value="${i?.valor_iptu || 0}"></div>
        <div class="field" style="flex:1;min-width:110px"><label>💼 Taxa ADM %</label><input id="lo-adm" type="number" step="0.1" class="input" value="${i?.taxa_adm_pct ?? 10}"></div>
        <div class="field" style="flex:1;min-width:100px"><label>Venc dia</label><input id="lo-dia" type="number" min="1" max="31" class="input" value="${i?.dia_vencimento || ''}"></div>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Início contrato</label><input id="lo-ini" type="date" class="input" value="${i?.data_inicio_contrato || ''}"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Fim contrato</label><input id="lo-fim" type="date" class="input" value="${i?.data_fim_contrato || ''}"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Status</label><select id="lo-st" class="select">${STATUS.map(s => `<option value="${s.id}"${(i?.status||'disponivel')===s.id?' selected':''}>${s.ico} ${s.lbl}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Responsável</label><select id="lo-resp" class="select"><option value="">— —</option>${_users.map(u => `<option value="${escapeHtml(u.id)}"${i?.responsavel_id===u.id?' selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Observações</label><textarea id="lo-obs" class="input" rows="2">${i?.observacoes ? escapeHtml(i.observacoes) : ''}</textarea></div>
      <div id="lo-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        ${i ? '<button class="btn btn-danger" id="lo-del">🗑 Apagar</button>' : '<span></span>'}
        <div class="flex gap-2">
          <button class="btn btn-ghost" id="lo-cancel">Cancelar</button>
          <button class="btn btn-primary" id="lo-save">${i ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  document.getElementById('lo-cancel').addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('lo-save').addEventListener('click', async () => {
    const body = {
      id: i?.id,
      endereco: document.getElementById('lo-end').value.trim(),
      bairro: document.getElementById('lo-bairro').value.trim() || null,
      cidade: document.getElementById('lo-cidade').value.trim() || null,
      proprietario_nome: document.getElementById('lo-prop').value.trim() || null,
      proprietario_contato: document.getElementById('lo-pcont').value.trim() || null,
      inquilino_nome: document.getElementById('lo-inq').value.trim() || null,
      inquilino_contato: document.getElementById('lo-icont').value.trim() || null,
      valor_aluguel: parseFloat(document.getElementById('lo-val').value) || 0,
      valor_condominio: parseFloat(document.getElementById('lo-cond').value) || 0,
      valor_iptu: parseFloat(document.getElementById('lo-iptu').value) || 0,
      taxa_adm_pct: parseFloat(document.getElementById('lo-adm').value) || 0,
      dia_vencimento: parseInt(document.getElementById('lo-dia').value) || null,
      data_inicio_contrato: document.getElementById('lo-ini').value || null,
      data_fim_contrato: document.getElementById('lo-fim').value || null,
      status: document.getElementById('lo-st').value,
      responsavel_id: document.getElementById('lo-resp').value || null,
      observacoes: document.getElementById('lo-obs').value.trim() || null,
    };
    if (!body.endereco) { document.getElementById('lo-msg').innerHTML = '<div class="alert alert-err">Endereço obrigatório.</div>'; return; }
    try {
      await api.request('/api/v3/locacoes/upsert', { method: 'POST', body });
      modal.style.display = 'none';
      await reload();
    } catch (e) { document.getElementById('lo-msg').innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; }
  });
  if (i) {
    document.getElementById('lo-del').addEventListener('click', async () => {
      if (!confirm('Apagar?')) return;
      try {
        await api.request('/api/v3/locacoes/upsert', { method: 'POST', body: { id: i.id, _delete: true } });
        modal.style.display = 'none';
        await reload();
      } catch (e) { alert('Erro: ' + e.message); }
    });
  }
}

/* ── 📤 Importação de planilha (CSV) ── */
const IMP_HEADER = 'codigo,endereco,bairro,proprietario,proprietario_contato,inquilino,inquilino_contato,aluguel,condominio,iptu,taxa_adm,dia_vencimento,inicio,fim,status';
function parseCSV(text) {
  const lines = (text || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  const split = line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === delim && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out.map(s => s.trim());
  };
  const headers = split(lines[0]);
  return lines.slice(1).map(l => { const cells = split(l); const o = {}; headers.forEach((h, i) => o[h] = cells[i] ?? ''); return o; });
}
function openImport() {
  const modal = document.getElementById('modal-import');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="margin:0;max-width:700px;width:100%;max-height:90vh;overflow-y:auto">
      <h3 class="card-title">📤 Importar contratos (planilha / Kenlo)</h3>
      <p class="card-sub">Exporte do Kenlo ou Excel pra <b>CSV</b> e cole abaixo. 1ª linha = cabeçalho. Aceita <code>;</code> ou <code>,</code>. Datas em dd/mm/aaaa e valores em R$ são convertidos.</p>
      <div class="tiny muted" style="margin:8px 0">Colunas reconhecidas (ordem livre, use o que tiver): <code style="font-size:11px">${IMP_HEADER}</code> <button class="btn btn-ghost btn-sm" id="imp-modelo">copiar modelo</button></div>
      <textarea id="imp-csv" class="input" rows="9" placeholder="cole o CSV aqui..." style="width:100%;font-family:monospace;font-size:12px"></textarea>
      <div id="imp-msg" class="mt-2"></div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between">
        <button class="btn btn-ghost" id="imp-cancel">Cancelar</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="imp-previa">👁 Prévia</button><button class="btn btn-primary" id="imp-go">Importar</button></div>
      </div>
    </div>`;
  modal.style.display = 'flex';
  const msg = () => document.getElementById('imp-msg');
  document.getElementById('imp-cancel').onclick = () => { modal.style.display = 'none'; };
  document.getElementById('imp-modelo').onclick = () => { try { navigator.clipboard.writeText(IMP_HEADER); } catch {} msg().innerHTML = '<div class="tiny" style="color:#16a34a">modelo copiado ✓ — cole no Excel, preencha e exporte CSV</div>'; };
  document.getElementById('imp-previa').onclick = () => {
    const rows = parseCSV(document.getElementById('imp-csv').value);
    msg().innerHTML = rows.length ? `<div class="tiny muted">✅ ${rows.length} linha(s) lida(s). Exemplo da 1ª: ${escapeHtml(JSON.stringify(rows[0]).slice(0, 220))}</div>` : '<div class="alert alert-warn">Nada reconhecido — confira se tem cabeçalho na 1ª linha.</div>';
  };
  document.getElementById('imp-go').onclick = async () => {
    const rows = parseCSV(document.getElementById('imp-csv').value);
    if (!rows.length) { msg().innerHTML = '<div class="alert alert-err">Cole o CSV com cabeçalho na 1ª linha.</div>'; return; }
    msg().innerHTML = `<div class="muted tiny"><span class="spinner"></span> Importando ${rows.length}…</div>`;
    try {
      const r = await api.request('/api/v3/locacoes/import', { method: 'POST', body: { rows } });
      msg().innerHTML = `<div class="alert" style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3)">✅ ${r.inserted} contrato(s) importado(s)${r.ignorados ? ' · ' + r.ignorados + ' ignorado(s) (linha sem dados)' : ''}.</div>`;
      setTimeout(async () => { modal.style.display = 'none'; await reload(); }, 1400);
    } catch (e) { msg().innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`; }
  };
}

function kpi(label, big, sub, color) {
  return `<div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
    <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
    <div style="font-size:20px;font-weight:900;color:${color};margin-top:2px">${big}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}
function money(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
