/* ============================================================================
   PSM-OS v2 — Base de Talentos (Diretoria) · v77.63
   ----------------------------------------------------------------------------
   Movida de Gestão de Pessoas para a Diretoria. Duas frentes:
   • 🟢 RD ao vivo — deals do funil "Parceiros" / etapa "Base de Talentos" do
     RD Station CRM, em tempo real (auto-refresh 60s + botão atualizar).
   • 📝 Base manual — cadastro próprio (tabela gp_talentos), com busca e CRUD.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { router } from '../router.js';

let _root = null;
let _tab = 'rd';
let _talentos = [];   // manuais
let _editing = null;
let _rdTimer = null;
let _lastRd = null;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function waLink(phone) { const d = String(phone || '').replace(/\D/g, ''); return d ? `https://wa.me/${d}` : null; }

export async function pageTalentos(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder/Diretoria (lvl 5+).</div>';
    return;
  }
  render();
  if (_tab === 'rd') loadRd(); else loadManual();
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🌟 Base de Talentos</h2>
      <p class="card-sub">Pipeline de recrutamento — conectado ao RD Station (funil Parceiros · etapa Base de Talentos) em tempo real + base interna.</p>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        <button class="btn ${_tab === 'rd' ? 'btn-primary' : 'btn-ghost'}" data-tab="rd">🟢 RD ao vivo</button>
        <button class="btn ${_tab === 'manual' ? 'btn-primary' : 'btn-ghost'}" data-tab="manual">📝 Base manual</button>
      </div>
      <div id="tal-body" class="mt-4"></div>
    </div>
  `;
  _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    if (_tab === b.dataset.tab) return;
    _tab = b.dataset.tab;
    stopRdTimer();
    render();
    if (_tab === 'rd') loadRd(); else loadManual();
  }));
}

/* ─────────────────── RD ao vivo ─────────────────── */
function stopRdTimer() { if (_rdTimer) { clearInterval(_rdTimer); _rdTimer = null; } }

async function loadRd(refresh = false) {
  const body = document.getElementById('tal-body');
  if (!body) return;
  if (!_lastRd) body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Conectando ao RD…</div>';
  try {
    const r = await api.request('/api/v3/crm/talentos' + (refresh ? '?refresh=1' : ''));
    _lastRd = r;
    renderRd(r);
  } catch (e) {
    // erro de funil/etapa não encontrados vem no corpo (data) do ApiError
    const d = e.data || {};
    if (d.funis_disponiveis || d.etapas_disponiveis) {
      body.innerHTML = `
        <div class="alert alert-warn">⚠️ ${esc(e.message)}</div>
        ${d.funis_disponiveis ? `<div class="tiny muted mt-2">Funis no RD: ${d.funis_disponiveis.map(esc).join(' · ') || '—'}</div>` : ''}
        ${d.etapas_disponiveis ? `<div class="tiny muted mt-2">Etapas no funil ${esc(d.funil || '')}: ${d.etapas_disponiveis.map(esc).join(' · ') || '—'}</div>` : ''}
        <button class="btn btn-ghost mt-3" id="rd-retry">🔄 Tentar de novo</button>`;
      document.getElementById('rd-retry')?.addEventListener('click', () => loadRd(true));
    } else {
      body.innerHTML = `<div class="alert alert-err">Erro ao ler o RD: ${esc(e.message)}</div>
        <button class="btn btn-ghost mt-3" id="rd-retry">🔄 Tentar de novo</button>`;
      document.getElementById('rd-retry')?.addEventListener('click', () => loadRd(true));
    }
  }
  // auto-refresh em tempo real (60s) — só uma vez
  if (!_rdTimer) {
    _rdTimer = setInterval(() => { if (_tab === 'rd' && document.getElementById('tal-body')) loadRd(true); }, 60000);
    router.onCleanup(stopRdTimer);
  }
}

function renderRd(r) {
  const body = document.getElementById('tal-body');
  if (!body) return;
  const ts = r.fetched_at ? new Date(r.fetched_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  const list = r.talentos || [];
  body.innerHTML = `
    <div class="flex items-center gap-2 mb-3" style="flex-wrap:wrap">
      <span class="badge" style="background:#16a34a22;color:#16a34a;font-weight:700">🟢 ${list.length} talento(s)</span>
      <span class="tiny muted">${esc(r.pipeline?.name || 'Parceiros')} · ${esc(r.stage?.name || 'Base de Talentos')}</span>
      <span class="tiny muted" style="margin-left:auto">Atualizado ${ts} · auto a cada 60s</span>
      <button class="btn btn-ghost btn-sm" id="rd-refresh">🔄 Atualizar</button>
    </div>
    ${r.error_parcial ? `<div class="alert alert-warn tiny mb-2">Aviso do RD: ${esc(r.error_parcial)}</div>` : ''}
    ${list.length === 0 ? '<div class="muted tiny" style="text-align:center;padding:24px">Nenhum talento nessa etapa do RD agora.</div>' : `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg-3)">
          <th style="text-align:left;padding:8px">Nome</th>
          <th style="text-align:left;padding:8px">Contato</th>
          <th style="text-align:left;padding:8px">Responsável</th>
          <th style="text-align:left;padding:8px">Na etapa há</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${list.map(t => {
            const wa = waLink(t.phone);
            const camposTxt = Object.entries(t.campos || {}).slice(0, 3).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ');
            return `
            <tr style="border-bottom:1px solid var(--bd)">
              <td style="padding:8px">
                <div style="font-weight:700">${esc(t.name || t.contato || '—')}</div>
                ${t.contato && t.contato !== t.name ? `<div class="tiny muted">${esc(t.contato)}</div>` : ''}
                ${camposTxt ? `<div class="tiny muted">${camposTxt}</div>` : ''}
              </td>
              <td style="padding:8px">
                ${t.phone ? `<div>${esc(t.phone)}</div>` : ''}
                ${t.email ? `<div class="tiny muted">${esc(t.email)}</div>` : ''}
                ${!t.phone && !t.email ? '<span class="muted">—</span>' : ''}
              </td>
              <td style="padding:8px">${esc(t.owner || '—')}</td>
              <td style="padding:8px">${t.dias_na_etapa != null ? t.dias_na_etapa + 'd' : '—'}</td>
              <td style="padding:8px;text-align:right;white-space:nowrap">
                ${wa ? `<a class="btn btn-ghost btn-sm" href="${wa}" target="_blank" rel="noopener" title="WhatsApp">💬</a>` : ''}
                <a class="btn btn-ghost btn-sm" href="${esc(t.rd_url)}" target="_blank" rel="noopener" title="Abrir no RD">🔗</a>
                <button class="btn btn-ghost btn-sm" data-add-manual="${esc(t.id)}" title="Salvar na base interna">⭐</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `}
  `;
  document.getElementById('rd-refresh')?.addEventListener('click', () => loadRd(true));
  // ⭐ salva um talento do RD na base manual
  body.querySelectorAll('[data-add-manual]').forEach(b => b.addEventListener('click', async () => {
    const t = list.find(x => x.id === b.dataset.addManual);
    if (!t) return;
    b.textContent = '…'; b.disabled = true;
    try {
      await api.request('/api/v3/gp/talentos', { method: 'POST', body: {
        nome: t.name || t.contato || 'Talento', contato: t.phone || '', email: t.email || '',
        funcao: t.owner ? ('Resp.: ' + t.owner) : '', setor: 'RD · Parceiros',
        cenario: 'Importado do RD (funil Parceiros · Base de Talentos).' + (t.rd_url ? ' ' + t.rd_url : ''),
        status: 'em análise',
      } });
      b.textContent = '✓';
    } catch (e) { b.textContent = '✕'; b.disabled = false; alert('Erro: ' + e.message); }
  }));
}

/* ─────────────────── Base manual (gp_talentos) ─────────────────── */
async function loadManual() {
  const body = document.getElementById('tal-body');
  if (!body) return;
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/talentos');
    _talentos = r.talentos || [];
    renderManual();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderManual() {
  const body = document.getElementById('tal-body');
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);margin-bottom:14px;padding:14px">
      <div style="font-weight:800;margin-bottom:8px">👤 ${_editing?.id ? 'Editar' : 'Adicionar'} Talento</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px">
        <input id="tal-nome" class="input" placeholder="Nome completo *" value="${esc(_editing?.nome || '')}">
        <input id="tal-setor" class="input" placeholder="Setor / Origem" value="${esc(_editing?.setor || '')}">
        <input id="tal-funcao" class="input" placeholder="Função / Empresa atual" value="${esc(_editing?.funcao || '')}">
        <input id="tal-contato" class="input" placeholder="Contato (WhatsApp/tel)" value="${esc(_editing?.contato || '')}">
        <input id="tal-instagram" class="input" placeholder="@instagram" value="${esc(_editing?.instagram || '')}">
        <input id="tal-status" class="input" placeholder="Status (aceito, analisando, etc)" value="${esc(_editing?.status || '')}">
      </div>
      <textarea id="tal-cenario" class="input mt-2" rows="2" placeholder="Cenário / observações (CRECI, perfil, vaga, disp, prazo...)">${esc(_editing?.cenario || '')}</textarea>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-primary" id="tal-save">${_editing?.id ? '💾 Salvar' : '➕ Adicionar'}</button>
        ${_editing?.id ? '<button class="btn btn-ghost" id="tal-cancel">Cancelar</button>' : ''}
        <input id="tal-search" class="input" placeholder="🔍 Buscar talento..." style="flex:1;max-width:250px;margin-left:auto">
      </div>
    </div>
    <div style="font-weight:800;margin-bottom:8px">Base de Talentos interna (${_talentos.length})</div>
    <div id="tal-list">${renderManualList(_talentos)}</div>
  `;
  document.getElementById('tal-save').addEventListener('click', saveManual);
  const cancel = document.getElementById('tal-cancel');
  if (cancel) cancel.addEventListener('click', () => { _editing = null; renderManual(); });
  document.getElementById('tal-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = _talentos.filter(t => (t.nome || '').toLowerCase().includes(q) || (t.setor || '').toLowerCase().includes(q) || (t.funcao || '').toLowerCase().includes(q));
    document.getElementById('tal-list').innerHTML = renderManualList(filtered);
    bindManualActions();
  });
  bindManualActions();
}

function renderManualList(items) {
  if (!items.length) return '<div class="muted tiny" style="text-align:center;padding:20px">Nenhum talento.</div>';
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--bg-3)">
        <th style="text-align:left;padding:8px">Nome</th>
        <th style="text-align:left;padding:8px">Setor</th>
        <th style="text-align:left;padding:8px">Função</th>
        <th style="text-align:left;padding:8px">Cenário</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${items.map(t => `
          <tr style="border-bottom:1px solid var(--bd)">
            <td style="padding:8px;font-weight:700">${esc(t.nome)}</td>
            <td style="padding:8px">${esc(t.setor || '—')}</td>
            <td style="padding:8px">${esc(t.funcao || '—')}</td>
            <td style="padding:8px;font-size:11px;color:var(--muted)">${esc((t.cenario || '').substring(0, 100))}</td>
            <td style="padding:8px;text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-edit-tal="${t.id}">✏️</button>
              <button class="btn btn-ghost btn-sm" data-del-tal="${t.id}">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function bindManualActions() {
  document.querySelectorAll('[data-edit-tal]').forEach(b => b.addEventListener('click', () => {
    _editing = _talentos.find(x => x.id === b.dataset.editTal);
    renderManual();
  }));
  document.querySelectorAll('[data-del-tal]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover talento?')) return;
    try {
      await api.request('/api/v3/gp/talentos?id=' + encodeURIComponent(b.dataset.delTal), { method: 'DELETE' });
      loadManual();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

async function saveManual() {
  const payload = {
    id: _editing?.id,
    nome: document.getElementById('tal-nome').value.trim(),
    setor: document.getElementById('tal-setor').value.trim(),
    funcao: document.getElementById('tal-funcao').value.trim(),
    contato: document.getElementById('tal-contato').value.trim(),
    instagram: document.getElementById('tal-instagram').value.trim(),
    status: document.getElementById('tal-status').value.trim(),
    cenario: document.getElementById('tal-cenario').value.trim(),
  };
  if (!payload.nome) { alert('Nome obrigatório'); return; }
  try {
    await api.request('/api/v3/gp/talentos', { method: 'POST', body: payload });
    _editing = null;
    await loadManual();
  } catch (e) { alert('Erro: ' + e.message); }
}
