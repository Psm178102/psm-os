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
let _users = [];      // pra escolher o responsável

// Classificação (v81.83) — secretaria de vendas é cargo dentro do Comercial
const SETORES = ['Comercial', 'Backoffice', 'Marketing', 'Administrativo', 'Financeiro', 'RH', 'Jurídico', 'Contábil'];
const CARGOS = {
  'Comercial': ['Corretor', 'Secretária de Vendas', 'SDR', 'Gerente Comercial', 'Líder de Equipe'],
  'Backoffice': ['Backoffice', 'Coordenador de Backoffice'],
  'Marketing': ['Social Media', 'Gestor de Tráfego', 'Designer', 'Audiovisual', 'Gerente de Marketing'],
  'Administrativo': ['Assistente Administrativo', 'Recepção', 'Gerente Administrativo'],
  'Financeiro': ['Analista Financeiro', 'Contas a Pagar/Receber', 'Gerente Financeiro'],
  'RH': ['Analista de RH', 'Recrutamento & Seleção', 'Departamento Pessoal', 'Gerente de RH'],
  'Jurídico': ['Advogado(a)', 'Assistente Jurídico'],
  'Contábil': ['Contador(a)', 'Assistente Contábil'],
};
const CATEGORIAS = ['Conquista', 'MAP', 'Terceiros', 'Locação'];   // só quando cargo = Corretor
const ATIVIDADES = ['Concorrente', 'Outro do mercado', 'Incorporadora', 'Imobiliária', 'Autônomo', 'Livre'];
const _allCargos = [...new Set(Object.values(CARGOS).flat())];
const _isCorretor = v => /corretor/i.test(v || '');

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
      <p class="card-sub">Pipeline de recrutamento — conectado ao RD Station (funil de Parceria · etapa Banco de Talentos) em tempo real + base interna.</p>
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
      <span class="tiny muted">${esc(r.pipeline?.name || 'FUNIL DE PARCERIA – PAULO')} · ${esc(r.stage?.name || 'BANCO DE TALENTOS')}</span>
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
    const cp = t.campos || {};
    try {
      const saved = await api.request('/api/v3/gp/talentos', { method: 'POST', body: {
        nome: t.name || t.contato || 'Talento', contato: t.phone || '', email: t.email || '',
        instagram: cp.Instagram || cp.instagram || cp.IG || cp.ig || '',
        responsavel: t.owner || '',
        cenario: 'Importado do RD (funil Parceiros · Base de Talentos).' + (t.rd_url ? ' ' + t.rd_url : ''),
        status: 'em análise', origem: 'rd',
      } });
      b.textContent = '✓ classificar';
      // leva pra base manual com o talento aberto pra classificar (setor/cargo/etc.)
      _editing = saved.row || null;
      _tab = 'manual'; stopRdTimer(); render(); await loadManual();
    } catch (e) { b.textContent = '✕'; b.disabled = false; alert('Erro: ' + e.message); }
  }));
}

/* ─────────────────── Base manual (gp_talentos) ─────────────────── */
async function loadManual() {
  const body = document.getElementById('tal-body');
  if (!body) return;
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const [r, u] = await Promise.all([
      api.request('/api/v3/gp/talentos'),
      (_users.length ? Promise.resolve({ users: _users }) : api.listUsers().catch(() => ({ users: [] }))),
    ]);
    _talentos = r.talentos || [];
    _users = (u && u.users) || _users;
    renderManual();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderManual() {
  const body = document.getElementById('tal-body');
  const e = _editing || {};
  const opt = (v, sel) => `<option value="${esc(v)}"${v === (sel || '') ? ' selected' : ''}>${esc(v)}</option>`;
  const userOpts = _users.map(u => opt(u.name || u.id, e.responsavel)).join('');
  const showCorr = _isCorretor(e.cargo);
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);margin-bottom:14px;padding:14px">
      <div style="font-weight:800;margin-bottom:10px">👤 ${e.id ? 'Editar' : 'Classificar / Adicionar'} Talento</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(190px, 1fr));gap:8px">
        <label class="tiny muted">Nome completo *<input id="tal-nome" class="input" value="${esc(e.nome || '')}"></label>
        <label class="tiny muted">Contato (WhatsApp/tel)<input id="tal-contato" class="input" value="${esc(e.contato || '')}"></label>
        <label class="tiny muted">Instagram<input id="tal-instagram" class="input" placeholder="@perfil" value="${esc(e.instagram || '')}"></label>
        <label class="tiny muted">Responsável<select id="tal-responsavel" class="select"><option value="">—</option>${userOpts}</select></label>
        <label class="tiny muted">Setor<select id="tal-setor" class="select"><option value="">—</option>${SETORES.map(s => opt(s, e.setor)).join('')}</select></label>
        <label class="tiny muted">Cargo<input id="tal-cargo" class="input" list="tal-cargos" placeholder="ex.: Corretor, Secretária de Vendas" value="${esc(e.cargo || e.funcao || '')}"><datalist id="tal-cargos">${_allCargos.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="tiny muted">Atual atividade<select id="tal-atividade" class="select"><option value="">—</option>${ATIVIDADES.map(a => opt(a, e.atividade_atual)).join('')}</select></label>
        <label class="tiny muted">Status (recrutamento)<input id="tal-status" class="input" placeholder="em análise, aprovado..." value="${esc(e.status || '')}"></label>
      </div>
      <div id="tal-corretor" style="display:${showCorr ? 'grid' : 'none'};grid-template-columns:repeat(auto-fit, minmax(190px, 1fr));gap:8px;margin-top:8px;padding:8px;border:1px dashed var(--bd);border-radius:8px;background:rgba(214,36,159,.05)">
        <label class="tiny muted" style="grid-column:1/-1;font-weight:700;color:#d6249f">🏠 Corretor — classificação</label>
        <label class="tiny muted">Categoria<select id="tal-categoria" class="select"><option value="">—</option>${CATEGORIAS.map(c => opt(c, e.categoria)).join('')}</select></label>
        <label class="tiny muted">CRECI<input id="tal-creci" class="input" placeholder="CRECI (se tiver)" value="${esc(e.creci || '')}"></label>
      </div>
      <label class="tiny muted" style="display:block;margin-top:8px">Experiência<textarea id="tal-experiencia" class="input" rows="2" placeholder="Tempo de mercado, onde trabalhou, resultados...">${esc(e.experiencia || '')}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:8px">Observações<textarea id="tal-cenario" class="input" rows="2" placeholder="Cenário, perfil, disponibilidade, prazo...">${esc(e.cenario || '')}</textarea></label>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <button class="btn btn-primary" id="tal-save">${e.id ? '💾 Salvar' : '➕ Adicionar'}</button>
        ${e.id ? '<button class="btn btn-ghost" id="tal-cancel">Cancelar</button>' : ''}
      </div>
    </div>
    <div class="flex items-center gap-2 mb-2" style="flex-wrap:wrap">
      <div style="font-weight:800">Base de Talentos interna (${_talentos.length})</div>
      <select id="tal-fsetor" class="select" style="max-width:170px;margin-left:auto"><option value="">Todos os setores</option>${SETORES.map(s => opt(s, _fSetor)).join('')}</select>
      <input id="tal-search" class="input" placeholder="🔍 Buscar..." style="max-width:230px">
    </div>
    <div id="tal-list">${renderManualList(filterManual())}</div>
  `;
  // corretor: mostra/esconde Categoria+CRECI conforme o cargo
  const cargoEl = document.getElementById('tal-cargo'), corrEl = document.getElementById('tal-corretor');
  const toggleCorr = () => { corrEl.style.display = _isCorretor(cargoEl.value) ? 'grid' : 'none'; };
  cargoEl.addEventListener('input', toggleCorr);
  // setor sugere o cargo (datalist filtra pelo setor escolhido)
  const setorEl = document.getElementById('tal-setor');
  setorEl.addEventListener('change', () => {
    const dl = document.getElementById('tal-cargos');
    const lista = CARGOS[setorEl.value] || _allCargos;
    dl.innerHTML = lista.map(c => `<option value="${esc(c)}">`).join('');
  });
  setorEl.dispatchEvent(new Event('change'));
  document.getElementById('tal-save').addEventListener('click', saveManual);
  const cancel = document.getElementById('tal-cancel');
  if (cancel) cancel.addEventListener('click', () => { _editing = null; renderManual(); });
  const reFilter = () => { document.getElementById('tal-list').innerHTML = renderManualList(filterManual()); bindManualActions(); };
  document.getElementById('tal-search').addEventListener('input', e2 => { _search = e2.target.value; reFilter(); });
  document.getElementById('tal-fsetor').addEventListener('change', e2 => { _fSetor = e2.target.value; reFilter(); });
  bindManualActions();
}

let _search = '', _fSetor = '';
function filterManual() {
  const q = (_search || '').toLowerCase();
  return _talentos.filter(t => {
    if (_fSetor && (t.setor || '') !== _fSetor) return false;
    if (!q) return true;
    return [t.nome, t.setor, t.cargo, t.funcao, t.categoria, t.responsavel, t.creci, t.experiencia].some(v => (v || '').toLowerCase().includes(q));
  });
}

function renderManualList(items) {
  if (!items.length) return '<div class="muted tiny" style="text-align:center;padding:20px">Nenhum talento.</div>';
  const chip = (txt, cor) => txt ? `<span style="display:inline-block;background:${cor}1a;color:${cor};font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap">${esc(txt)}</span>` : '';
  return `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:760px">
      <thead><tr style="background:var(--bg-3)">
        <th style="text-align:left;padding:8px">Nome / contato</th>
        <th style="text-align:left;padding:8px">Setor</th>
        <th style="text-align:left;padding:8px">Cargo</th>
        <th style="text-align:left;padding:8px">Categoria</th>
        <th style="text-align:left;padding:8px">Atividade atual</th>
        <th style="text-align:left;padding:8px">Responsável</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${items.map(t => {
          const corr = _isCorretor(t.cargo) || _isCorretor(t.funcao);
          const cargo = t.cargo || t.funcao || '';
          const sub = [t.contato, t.instagram, t.creci ? 'CRECI ' + t.creci : ''].filter(Boolean).join(' · ');
          return `
          <tr style="border-bottom:1px solid var(--bd)">
            <td style="padding:8px"><div style="font-weight:700">${esc(t.nome)}${t.origem === 'rd' ? ' <span class="tiny" style="color:#16a34a">🟢RD</span>' : ''}</div>${sub ? `<div class="tiny muted">${esc(sub)}</div>` : ''}</td>
            <td style="padding:8px">${chip(t.setor, '#2563eb') || '—'}</td>
            <td style="padding:8px">${esc(cargo) || '—'}</td>
            <td style="padding:8px">${corr ? (chip(t.categoria, '#d6249f') || '<span class="tiny muted">—</span>') : '<span class="tiny muted">·</span>'}</td>
            <td style="padding:8px">${chip(t.atividade_atual, '#b45309') || '—'}</td>
            <td style="padding:8px">${esc(t.responsavel || '—')}</td>
            <td style="padding:8px;text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-edit-tal="${t.id}">✏️</button>
              <button class="btn btn-ghost btn-sm" data-del-tal="${t.id}">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
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
  const g = id => (document.getElementById(id)?.value || '').trim();
  const cargo = g('tal-cargo');
  const corr = _isCorretor(cargo);
  const payload = {
    id: _editing?.id,
    nome: g('tal-nome'),
    contato: g('tal-contato'),
    instagram: g('tal-instagram'),
    responsavel: g('tal-responsavel'),
    setor: g('tal-setor'),
    cargo, funcao: cargo,              // mantém 'funcao' espelhado p/ compatibilidade
    categoria: corr ? g('tal-categoria') : '',
    creci: corr ? g('tal-creci') : '',
    atividade_atual: g('tal-atividade'),
    experiencia: g('tal-experiencia'),
    status: g('tal-status'),
    cenario: g('tal-cenario'),
    origem: _editing?.origem || 'manual',
  };
  if (!payload.nome) { alert('Nome obrigatório'); return; }
  try {
    await api.request('/api/v3/gp/talentos', { method: 'POST', body: payload });
    _editing = null;
    await loadManual();
  } catch (e) { alert('Erro: ' + e.message); }
}
