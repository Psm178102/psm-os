/* ============================================================================
   PSM-OS v2 — Recrutamento & Seleção (ATS) · v81.87
   ----------------------------------------------------------------------------
   • 🟢 RD ao vivo — deals do funil "Parceiros" / etapa "Base de Talentos" do
     RD Station CRM, em tempo real (auto-refresh 60s + botão atualizar).
   • 📋 Pipeline R&S — base interna (gp_talentos) como ATS completo: kanban por
     etapa (triagem → onboarding), filtros, ficha rica do candidato (origem,
     currículo, perfil comportamental, due diligence jurídica/comercial,
     feedback de entrevista) e avaliação interna multi-parte (RH+sócio+depto).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { router } from '../router.js';
import { getResourcePerms, canSeeResource } from '../links.js';
let _talPerms = {};   // resource_perms (visibilidade das abas RD/manual). v81.85

let _root = null;
let _tab = 'rd';
let _talentos = [];   // manuais
let _editing = null;  // candidato aberto na ficha
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

// ── ATS / Pipeline R&S (v81.87) ──
const ETAPAS = ['Triagem', 'Entrevista RH', 'Entrevista Gestor', 'Avaliação interna', 'Due Diligence', 'Proposta', 'Contratado', 'Banco de Talentos'];
const ETAPA_COR = { 'Triagem': '#64748b', 'Entrevista RH': '#2563eb', 'Entrevista Gestor': '#7c3aed', 'Avaliação interna': '#b45309', 'Due Diligence': '#dc2626', 'Proposta': '#0891b2', 'Contratado': '#16a34a', 'Banco de Talentos': '#94a3b8' };
const CANAIS = ['Indicação', 'Indicação interna', 'Prospecção ativa', 'Campanha / Anúncio', 'LinkedIn', 'Instagram', 'Site / Trabalhe conosco', 'RD Station', 'Banco de Talentos', 'Headhunter', 'Evento / Feira', 'Outro'];
const DECISOES = ['Em andamento', 'Aprovado', 'Reprovado', 'Standby'];
const VOTOS = ['Aprovo', 'Reprovo', 'Standby'];
const DISC = ['Dominância (D)', 'Influência (I)', 'Estabilidade (S)', 'Conformidade (C)'];

// filtros / visualização do pipeline
let _viewMode = 'kanban';   // kanban | lista
let _search = '', _fEtapa = '', _fSetor = '', _fCanal = '', _fResp = '', _fDecisao = '';
let _cargosCfg = { recrutamento: {}, offboarding: {} };   // requisitos/impeditivos por cargo (v81.92)

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function waLink(phone) { const d = String(phone || '').replace(/\D/g, ''); return d ? `https://wa.me/${d}` : null; }
function igLink(ig) { ig = String(ig || '').trim(); if (!ig) return null; if (/^https?:\/\//i.test(ig)) return ig; return 'https://instagram.com/' + ig.replace(/^@/, '').replace(/\s+/g, ''); }
function stars(n) { n = Math.max(0, Math.min(5, parseInt(n) || 0)); return '★'.repeat(n) + '☆'.repeat(5 - n); }
function chip(txt, cor) { return txt ? `<span style="display:inline-block;background:${cor}1a;color:${cor};font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap">${esc(txt)}</span>` : ''; }
const optTag = (v, sel) => `<option value="${esc(v)}"${v === (sel || '') ? ' selected' : ''}>${esc(v)}</option>`;

export async function pageTalentos(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder/Diretoria (lvl 5+).</div>';
    return;
  }
  try { _talPerms = await getResourcePerms(); } catch (_) { _talPerms = {}; }
  const canRd = canSeeResource('talentos_rd', _talPerms);
  const canMan = canSeeResource('talentos_manual', _talPerms);
  if (_tab === 'rd' && !canRd) _tab = canMan ? 'manual' : 'rd';
  if (_tab === 'manual' && !canMan) _tab = canRd ? 'rd' : 'manual';
  render();
  if (!canRd && !canMan) { const b = document.getElementById('tal-body'); if (b) b.innerHTML = '<div class="alert alert-warn">Você não tem acesso às abas da Base de Talentos. Fale com o sócio.</div>'; return; }
  if (_tab === 'rd') loadRd(); else loadManual();
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🌟 Recrutamento & Seleção</h2>
      <p class="card-sub">ATS completo — pipeline da triagem ao onboarding, conectado ao RD Station (funil de Parceria · etapa Banco de Talentos) + base interna com ficha rica e avaliação interna.</p>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
        ${canSeeResource('talentos_rd', _talPerms) ? `<button class="btn ${_tab === 'rd' ? 'btn-primary' : 'btn-ghost'}" data-tab="rd">🟢 RD ao vivo</button>` : ''}
        ${canSeeResource('talentos_manual', _talPerms) ? `<button class="btn ${_tab === 'manual' ? 'btn-primary' : 'btn-ghost'}" data-tab="manual">📋 Pipeline R&S</button>` : ''}
      </div>
      <div id="tal-body" class="mt-4"></div>
    </div>
  `;
  _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    if (_tab === b.dataset.tab) return;
    _tab = b.dataset.tab;
    _editing = null;
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
            const ig = igLink((t.campos || {}).Instagram || (t.campos || {}).instagram || (t.campos || {}).IG);
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
                ${ig ? `<a class="btn btn-ghost btn-sm" href="${ig}" target="_blank" rel="noopener" title="Instagram">📷</a>` : ''}
                ${wa ? `<a class="btn btn-ghost btn-sm" href="${wa}" target="_blank" rel="noopener" title="WhatsApp">💬</a>` : ''}
                <a class="btn btn-ghost btn-sm" href="${esc(t.rd_url)}" target="_blank" rel="noopener" title="Abrir no RD">🔗</a>
                <button class="btn btn-ghost btn-sm" data-add-manual="${esc(t.id)}" title="Trazer pro pipeline interno">⭐</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `}
  `;
  document.getElementById('rd-refresh')?.addEventListener('click', () => loadRd(true));
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
        status: 'em análise', origem: 'rd', canal: 'RD Station', etapa: 'Triagem',
      } });
      b.textContent = '✓ ficha';
      _editing = saved.row || null;
      _tab = 'manual'; stopRdTimer(); render(); await loadManual();
    } catch (e) { b.textContent = '✕'; b.disabled = false; alert('Erro: ' + e.message); }
  }));
}

/* ─────────────────── Pipeline R&S (gp_talentos) ─────────────────── */
async function loadManual() {
  const body = document.getElementById('tal-body');
  if (!body) return;
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const [r, u, cc] = await Promise.all([
      api.request('/api/v3/gp/talentos'),
      (_users.length ? Promise.resolve({ users: _users }) : api.listUsers().catch(() => ({ users: [] }))),
      api.request('/api/v3/gp/cargos').catch(() => ({ recrutamento: {}, offboarding: {} })),
    ]);
    _talentos = r.talentos || [];
    _users = (u && u.users) || _users;
    _cargosCfg = { recrutamento: (cc && cc.recrutamento) || {}, offboarding: (cc && cc.offboarding) || {} };
    renderManual();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderManual() {
  const body = document.getElementById('tal-body');
  if (!body) return;
  if (_editing) { body.innerHTML = renderDetail(_editing); bindDetail(); return; }

  const respOpts = [...new Set(_talentos.map(t => t.responsavel).filter(Boolean))];
  body.innerHTML = `
    <div class="flex items-center gap-2 mb-2" style="flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="tal-new">➕ Novo candidato</button>
      ${(auth.user()?.lvl || 0) >= 5 ? '<button class="btn btn-ghost btn-sm" id="tal-cargos-req">📋 Requisitos por cargo</button>' : ''}
      <div class="flex gap-1" style="margin-left:auto">
        <button class="btn ${_viewMode === 'kanban' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-vm="kanban">▦ Kanban</button>
        <button class="btn ${_viewMode === 'lista' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-vm="lista">☰ Lista</button>
      </div>
    </div>
    <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
      <input id="f-search" class="input" placeholder="🔍 Buscar nome/cargo/CRECI…" style="max-width:210px" value="${esc(_search)}">
      <select id="f-etapa" class="select" style="max-width:160px"><option value="">Todas as etapas</option>${ETAPAS.map(x => optTag(x, _fEtapa)).join('')}</select>
      <select id="f-setor" class="select" style="max-width:150px"><option value="">Todo setor</option>${SETORES.map(x => optTag(x, _fSetor)).join('')}</select>
      <select id="f-canal" class="select" style="max-width:160px"><option value="">Toda origem</option>${CANAIS.map(x => optTag(x, _fCanal)).join('')}</select>
      <select id="f-resp" class="select" style="max-width:160px"><option value="">Todo responsável</option>${respOpts.map(x => optTag(x, _fResp)).join('')}</select>
      <select id="f-decisao" class="select" style="max-width:150px"><option value="">Toda decisão</option>${DECISOES.map(x => optTag(x, _fDecisao)).join('')}</select>
    </div>
    ${funnelHTML()}
    <div id="tal-view" class="mt-2"></div>
  `;
  document.getElementById('tal-new').addEventListener('click', () => { _editing = { etapa: 'Triagem', decisao: 'Em andamento' }; renderManual(); });
  const cq = document.getElementById('tal-cargos-req'); if (cq) cq.onclick = openCargosReqModal;
  body.querySelectorAll('[data-vm]').forEach(b => b.addEventListener('click', () => { _viewMode = b.dataset.vm; renderManual(); }));
  const reF = () => drawView();
  document.getElementById('f-search').addEventListener('input', e => { _search = e.target.value; reF(); });
  document.getElementById('f-etapa').addEventListener('change', e => { _fEtapa = e.target.value; reF(); });
  document.getElementById('f-setor').addEventListener('change', e => { _fSetor = e.target.value; reF(); });
  document.getElementById('f-canal').addEventListener('change', e => { _fCanal = e.target.value; reF(); });
  document.getElementById('f-resp').addEventListener('change', e => { _fResp = e.target.value; reF(); });
  document.getElementById('f-decisao').addEventListener('change', e => { _fDecisao = e.target.value; reF(); });
  drawView();
}

function funnelHTML() {
  const counts = {};
  ETAPAS.forEach(e => counts[e] = 0);
  _talentos.forEach(t => { const e = t.etapa || 'Triagem'; if (e in counts) counts[e]++; });
  return `<div id="tal-funnel" class="flex gap-1" style="flex-wrap:wrap;font-size:11px">
    ${ETAPAS.map(e => `<span style="background:${ETAPA_COR[e]}1a;color:${ETAPA_COR[e]};font-weight:700;padding:2px 8px;border-radius:6px">${esc(e)}: ${counts[e]}</span>`).join('')}
  </div>`;
}

function filterManual() {
  const q = (_search || '').toLowerCase();
  return _talentos.filter(t => {
    if (_fEtapa && (t.etapa || 'Triagem') !== _fEtapa) return false;
    if (_fSetor && (t.setor || '') !== _fSetor) return false;
    if (_fCanal && (t.canal || '') !== _fCanal) return false;
    if (_fResp && (t.responsavel || '') !== _fResp) return false;
    if (_fDecisao && (t.decisao || 'Em andamento') !== _fDecisao) return false;
    if (!q) return true;
    return [t.nome, t.setor, t.cargo, t.funcao, t.categoria, t.responsavel, t.creci, t.experiencia, t.vaga, t.canal].some(v => (v || '').toLowerCase().includes(q));
  });
}

function drawView() {
  const host = document.getElementById('tal-view');
  if (!host) return;
  const items = filterManual();
  host.innerHTML = _viewMode === 'kanban' ? renderKanban(items) : renderLista(items);
  bindView();
}

function renderKanban(items) {
  return `<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;align-items:flex-start">
    ${ETAPAS.map(et => {
      const col = items.filter(t => (t.etapa || 'Triagem') === et);
      return `<div style="min-width:228px;max-width:240px;flex:0 0 auto;background:var(--bg-3);border-radius:10px;padding:8px">
        <div style="font-weight:800;font-size:11.5px;color:${ETAPA_COR[et]};display:flex;justify-content:space-between;align-items:center"><span>${esc(et)}</span><span style="background:${ETAPA_COR[et]}22;border-radius:999px;padding:1px 7px">${col.length}</span></div>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
          ${col.map(cardHTML).join('') || '<div class="tiny muted" style="text-align:center;padding:10px">—</div>'}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function cardHTML(t) {
  const ig = igLink(t.instagram), wa = waLink(t.contato), cv = t.curriculo_url, ln = t.linkedin;
  const corr = _isCorretor(t.cargo || t.funcao);
  const dec = t.decisao === 'Aprovado' ? ' ✅' : t.decisao === 'Reprovado' ? ' ⛔' : t.decisao === 'Standby' ? ' ⏸' : '';
  const nav = avResumo(t);
  return `<div class="tal-card" style="background:var(--bg-2);border:1px solid var(--bd);border-radius:8px;padding:8px;cursor:pointer" data-open="${t.id}">
    <div style="font-weight:700;font-size:12.5px">${esc(t.nome)}${dec}</div>
    <div class="tiny muted">${esc(t.cargo || t.funcao || '—')}${t.setor ? ' · ' + esc(t.setor) : ''}</div>
    <div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">
      ${chip(t.canal, '#7c3aed')}
      ${corr && t.categoria ? chip(t.categoria, '#d6249f') : ''}
      ${t.score ? `<span class="tiny" style="color:#f59e0b" title="Score">${stars(t.score)}</span>` : ''}
      ${nav ? `<span class="tiny muted" title="Pareceres">🗳 ${nav}</span>` : ''}
    </div>
    ${t.responsavel ? `<div class="tiny muted" style="margin-top:4px">👤 ${esc(t.responsavel)}</div>` : ''}
    <div style="margin-top:6px;display:flex;gap:3px;align-items:center">
      ${ig ? `<a class="btn btn-ghost btn-sm" href="${ig}" target="_blank" rel="noopener" title="Instagram" onclick="event.stopPropagation()">📷</a>` : ''}
      ${wa ? `<a class="btn btn-ghost btn-sm" href="${wa}" target="_blank" rel="noopener" title="WhatsApp" onclick="event.stopPropagation()">💬</a>` : ''}
      ${ln ? `<a class="btn btn-ghost btn-sm" href="${esc(ln)}" target="_blank" rel="noopener" title="LinkedIn" onclick="event.stopPropagation()">in</a>` : ''}
      ${cv ? `<a class="btn btn-ghost btn-sm" href="${esc(cv)}" target="_blank" rel="noopener" title="Currículo" onclick="event.stopPropagation()">📄</a>` : ''}
      <select class="select tal-move" data-id="${t.id}" title="Mover de etapa" style="margin-left:auto;font-size:10px;padding:2px;max-width:118px" onclick="event.stopPropagation()">
        ${ETAPAS.map(e => `<option value="${esc(e)}"${(t.etapa || 'Triagem') === e ? ' selected' : ''}>${esc(e)}</option>`).join('')}
      </select>
    </div>
  </div>`;
}

function avResumo(t) {
  const av = Array.isArray(t.avaliacoes) ? t.avaliacoes : [];
  if (!av.length) return '';
  const ap = av.filter(a => /aprov/i.test(a.voto || '')).length;
  const rp = av.filter(a => /reprov/i.test(a.voto || '')).length;
  return `${ap}✓ ${rp}✕`;
}

function renderLista(items) {
  if (!items.length) return '<div class="muted tiny" style="text-align:center;padding:20px">Nenhum candidato.</div>';
  return `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:880px">
      <thead><tr style="background:var(--bg-3)">
        <th style="text-align:left;padding:8px">Nome / contato</th>
        <th style="text-align:left;padding:8px">Etapa</th>
        <th style="text-align:left;padding:8px">Setor / cargo</th>
        <th style="text-align:left;padding:8px">Origem</th>
        <th style="text-align:left;padding:8px">Responsável</th>
        <th style="text-align:left;padding:8px">Decisão</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${items.map(t => {
          const cargo = t.cargo || t.funcao || '';
          const ig = igLink(t.instagram), wa = waLink(t.contato), cv = t.curriculo_url;
          const sub = [t.contato, t.creci ? 'CRECI ' + t.creci : ''].filter(Boolean).join(' · ');
          const et = t.etapa || 'Triagem';
          return `
          <tr style="border-bottom:1px solid var(--bd)">
            <td style="padding:8px"><div style="font-weight:700">${esc(t.nome)}${t.origem === 'rd' ? ' <span class="tiny" style="color:#16a34a">🟢RD</span>' : ''}</div>${sub ? `<div class="tiny muted">${esc(sub)}</div>` : ''}</td>
            <td style="padding:8px">${chip(et, ETAPA_COR[et] || '#64748b')}</td>
            <td style="padding:8px">${esc(cargo) || '—'}${t.setor ? `<div class="tiny muted">${esc(t.setor)}</div>` : ''}</td>
            <td style="padding:8px">${chip(t.canal, '#7c3aed') || '—'}</td>
            <td style="padding:8px">${esc(t.responsavel || '—')}</td>
            <td style="padding:8px">${chip(t.decisao || 'Em andamento', t.decisao === 'Aprovado' ? '#16a34a' : t.decisao === 'Reprovado' ? '#dc2626' : '#64748b')}</td>
            <td style="padding:8px;text-align:right;white-space:nowrap">
              ${ig ? `<a class="btn btn-ghost btn-sm" href="${ig}" target="_blank" rel="noopener" title="Instagram">📷</a>` : ''}
              ${wa ? `<a class="btn btn-ghost btn-sm" href="${wa}" target="_blank" rel="noopener" title="WhatsApp">💬</a>` : ''}
              ${cv ? `<a class="btn btn-ghost btn-sm" href="${esc(cv)}" target="_blank" rel="noopener" title="Currículo">📄</a>` : ''}
              <button class="btn btn-ghost btn-sm" data-open="${t.id}">✏️ Abrir</button>
              <button class="btn btn-ghost btn-sm" data-del-tal="${t.id}">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function bindView() {
  document.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
    _editing = _talentos.find(x => x.id === el.dataset.open) || null;
    if (_editing) renderManual();
  }));
  document.querySelectorAll('.tal-move').forEach(s => s.addEventListener('change', () => moverEtapa(s.dataset.id, s.value)));
  document.querySelectorAll('[data-del-tal]').forEach(b => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!confirm('Remover candidato?')) return;
    try { await api.request('/api/v3/gp/talentos?id=' + encodeURIComponent(b.dataset.delTal), { method: 'DELETE' }); loadManual(); }
    catch (e) { alert('Erro: ' + e.message); }
  }));
}

async function moverEtapa(id, etapa) {
  try {
    await api.request('/api/v3/gp/talentos', { method: 'POST', body: { action: 'mover', id, etapa } });
    const t = _talentos.find(x => x.id === id); if (t) t.etapa = etapa;
    drawView();
    const fn = document.getElementById('tal-funnel'); if (fn) fn.outerHTML = funnelHTML();
  } catch (e) { alert('Erro ao mover: ' + e.message); loadManual(); }
}

/* ─────────────────── Ficha do candidato ─────────────────── */
const fInput = (id, lbl, val, ph = '', type = 'text') => `<label class="tiny muted">${lbl}<input id="${id}" class="input" type="${type}" placeholder="${esc(ph)}" value="${esc(val ?? '')}"></label>`;
const fArea = (id, lbl, val, ph = '', rows = 2) => `<label class="tiny muted" style="display:block">${lbl}<textarea id="${id}" class="input" rows="${rows}" placeholder="${esc(ph)}">${esc(val ?? '')}</textarea></label>`;
const fSel = (id, lbl, val, opts, blank = '—') => `<label class="tiny muted">${lbl}<select id="${id}" class="select"><option value="">${blank}</option>${opts.map(o => optTag(o, val)).join('')}</select></label>`;
const sec = (titulo, html) => `<div style="margin-top:12px;padding:10px;border:1px solid var(--bd);border-radius:10px;background:var(--bg-2)"><div style="font-weight:800;font-size:12.5px;margin-bottom:8px">${titulo}</div>${html}</div>`;
const grid = html => `<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(185px, 1fr));gap:8px">${html}</div>`;

function renderDetail(e) {
  const userOpts = `<option value="">—</option>` + _users.map(u => optTag(u.name || u.id, e.responsavel)).join('');
  const showCorr = _isCorretor(e.cargo || e.funcao);
  const ig = igLink(e.instagram), wa = waLink(e.contato), cv = e.curriculo_url, ln = e.linkedin;
  const av = Array.isArray(e.avaliacoes) ? e.avaliacoes : [];
  const hist = Array.isArray(e.historico) ? e.historico : [];
  const ap = av.filter(a => /aprov/i.test(a.voto || '')).length;
  const rp = av.filter(a => /reprov/i.test(a.voto || '')).length;
  const sb = av.filter(a => /standby/i.test(a.voto || '')).length;
  return `
    <div class="flex items-center gap-2 mb-2" style="flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="det-back">← Voltar ao pipeline</button>
      <div style="font-weight:800;font-size:15px">${e.id ? '👤 ' + esc(e.nome || 'Candidato') : '➕ Novo candidato'}</div>
      <div style="margin-left:auto;display:flex;gap:4px">
        ${ig ? `<a class="btn btn-ghost btn-sm" href="${ig}" target="_blank" rel="noopener" title="Instagram">📷 IG</a>` : ''}
        ${wa ? `<a class="btn btn-ghost btn-sm" href="${wa}" target="_blank" rel="noopener" title="WhatsApp">💬 Zap</a>` : ''}
        ${ln ? `<a class="btn btn-ghost btn-sm" href="${esc(ln)}" target="_blank" rel="noopener" title="LinkedIn">in</a>` : ''}
        ${cv ? `<a class="btn btn-ghost btn-sm" href="${esc(cv)}" target="_blank" rel="noopener" title="Currículo">📄 CV</a>` : ''}
      </div>
    </div>

    ${sec('🪪 Identificação & vaga', grid(`
      ${fInput('tal-nome', 'Nome completo *', e.nome)}
      ${fInput('tal-contato', 'Contato (WhatsApp/tel)', e.contato)}
      ${fInput('tal-email', 'E-mail', e.email, 'email@…')}
      ${fInput('tal-instagram', 'Instagram', e.instagram, '@perfil')}
      ${fInput('tal-linkedin', 'LinkedIn (URL)', e.linkedin, 'https://linkedin.com/in/…')}
      ${fSel('tal-responsavel', 'Responsável (recrutador)', e.responsavel, _users.map(u => u.name || u.id))}
      ${fSel('tal-canal', 'Origem (canal)', e.canal, CANAIS)}
      ${fInput('tal-depto', 'Departamento solicitante', e.departamento_solicitante, 'ex.: Comercial Conquista')}
      ${fInput('tal-vaga', 'Vaga / posição', e.vaga, 'ex.: Corretor Conquista')}
      ${fSel('tal-setor', 'Setor', e.setor, SETORES)}
      <label class="tiny muted">Cargo<input id="tal-cargo" class="input" list="tal-cargos" placeholder="ex.: Corretor, Secretária de Vendas" value="${esc(e.cargo || e.funcao || '')}"><datalist id="tal-cargos">${_allCargos.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      ${fSel('tal-atividade', 'Atividade atual', e.atividade_atual, ATIVIDADES)}
      ${fInput('tal-pretensao', 'Pretensão salarial', e.pretensao, 'R$ …')}
      ${fInput('tal-disponibilidade', 'Disponibilidade', e.disponibilidade, 'imediata / 30 dias…')}
      ${fSel('tal-score', 'Score (estrelas)', String(e.score || ''), ['1', '2', '3', '4', '5'])}
      ${fSel('tal-etapa', 'Etapa do pipeline', e.etapa || 'Triagem', ETAPAS, 'Triagem')}
      ${fSel('tal-decisao', 'Decisão', e.decisao || 'Em andamento', DECISOES, 'Em andamento')}
    `) + `
      <div id="tal-corretor" style="display:${showCorr ? 'grid' : 'none'};grid-template-columns:repeat(auto-fit, minmax(185px, 1fr));gap:8px;margin-top:8px;padding:8px;border:1px dashed var(--bd);border-radius:8px;background:rgba(214,36,159,.05)">
        <label class="tiny muted" style="grid-column:1/-1;font-weight:700;color:#d6249f">🏠 Corretor — classificação</label>
        ${fSel('tal-categoria', 'Categoria', e.categoria, CATEGORIAS)}
        ${fInput('tal-creci', 'CRECI', e.creci, 'CRECI (se tiver)')}
      </div>`)}

    ${sec('📄 Currículo, requisitos & experiência', `
      <label class="tiny muted" style="display:block">Currículo (link Google Drive)
        <div style="display:flex;gap:6px"><input id="tal-cv" class="input" placeholder="cole o link compartilhável do Drive" value="${esc(e.curriculo_url || '')}" style="flex:1">${cv ? `<a class="btn btn-ghost" href="${esc(cv)}" target="_blank" rel="noopener">Abrir</a>` : ''}</div>
      </label>
      ${cargoRefHTML(e.cargo, 'requisitos')}
      ${fArea('tal-requisitos', 'Requisitos de contratação (o que a vaga exige)', e.requisitos, 'CRECI ativo, CNH, experiência mínima, metas…', 2)}
      ${fArea('tal-experiencia', 'Experiência', e.experiencia, 'Tempo de mercado, onde trabalhou, resultados…', 2)}
    `)}

    ${sec('🗣 Entrevista & perfil comportamental', `
      ${fArea('tal-feedback', 'Feedback da entrevista', e.feedback_entrevista, 'Como foi, pontos fortes, atenção, fit cultural…', 3)}
      ${fArea('tal-perfil', 'Perfil comportamental (após entrevista)', e.perfil_comportamental, `DISC: ${DISC.join(' · ')} — descreva o perfil, âncoras, motivadores…`, 2)}
    `)}

    ${sec('⚖️ Due diligence — análise jurídica & comercial', grid(`
      ${fInput('tal-cpf', 'CPF', e.cpf, '000.000.000-00')}
      ${fInput('tal-cnd', 'CNDs (situação)', e.cnd, 'federal/estadual/trabalhista…')}
    `) + `
      ${fArea('tal-referencias', 'Referências (profissionais/comerciais)', e.referencias, 'Quem indicou, contatos, retorno das referências…', 2)}
      ${fArea('tal-processos', 'Processos (tipos / situação)', e.processos, 'Trabalhistas, cíveis, criminais — números e status…', 2)}
      ${fArea('tal-antecedentes', 'Antecedentes criminais', e.antecedentes, 'Resultado da consulta de antecedentes…', 2)}
      ${fArea('tal-juridica', 'Parecer jurídico', e.analise_juridica, 'Análise do jurídico sobre risco/impedimentos…', 2)}
      ${fArea('tal-comercial', 'Parecer comercial', e.analise_comercial, 'Análise comercial: reputação no mercado, carteira, conflitos…', 2)}
      ${cargoRefHTML(e.cargo, 'impeditivos')}
      ${fArea('tal-impeditivos', '⛔ Impeditivos de contratação', e.impeditivos, 'Algo que impede a contratação? (cláusula, processo, conflito…)', 2)}
    `)}

    ${e.id ? sec(`🗳 Avaliação interna (RH · sócios · departamento) — ${ap}✓ ${rp}✕ ${sb}⏸`, `
      ${av.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">${av.map(a => `
        <div style="border:1px solid var(--bd);border-radius:8px;padding:7px;background:var(--bg-3)">
          <div style="display:flex;gap:6px;align-items:center;font-size:12px"><b>${esc(a.by_nome || '—')}</b>${a.papel ? `<span class="tiny muted">${esc(a.papel)}</span>` : ''}
            <span style="margin-left:auto">${chip(a.voto || '—', /aprov/i.test(a.voto || '') ? '#16a34a' : /reprov/i.test(a.voto || '') ? '#dc2626' : '#64748b')}</span>
            ${a.nota ? `<span class="tiny" style="color:#f59e0b">${stars(a.nota)}</span>` : ''}</div>
          ${a.texto ? `<div class="tiny" style="margin-top:4px">${esc(a.texto)}</div>` : ''}
          <div class="tiny muted" style="margin-top:3px">${a.at ? new Date(a.at).toLocaleString('pt-BR') : ''}</div>
        </div>`).join('')}</div>` : '<div class="tiny muted" style="margin-bottom:8px">Sem pareceres ainda — registre o seu abaixo.</div>'}
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:8px;align-items:end">
        ${fSel('av-voto', 'Seu voto', '', VOTOS, 'escolha…')}
        ${fSel('av-nota', 'Nota (1-5)', '', ['1', '2', '3', '4', '5'])}
      </div>
      ${fArea('av-texto', 'Parecer', '', 'Sua justificativa / recomendação…', 2)}
      <button class="btn btn-primary btn-sm mt-2" id="av-add">＋ Registrar meu parecer</button>
    `) : ''}

    ${hist.length ? sec('🕓 Histórico de etapas', `<div class="tiny muted">${hist.slice().reverse().map(h => `${h.at ? new Date(h.at).toLocaleDateString('pt-BR') : ''}: ${esc(h.de || '—')} → <b>${esc(h.para || '')}</b> (${esc(h.by || '')})`).join('<br>')}</div>`) : ''}

    ${sec('📝 Observações', fArea('tal-cenario', '', e.cenario, 'Cenário, disponibilidade, prazo, notas livres…', 2) + fInput('tal-status', 'Status livre (legado)', e.status, 'em análise, aprovado…'))}

    <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
      <button class="btn btn-primary" id="tal-save">${e.id ? '💾 Salvar ficha' : '➕ Criar candidato'}</button>
      ${e.id ? '<button class="btn btn-ghost" id="tal-contratar" title="Mover p/ Contratado + aprovar">✅ Contratar → Onboarding</button>' : ''}
      <button class="btn btn-ghost" id="tal-cancel">Cancelar</button>
      ${e.id ? '<button class="btn btn-ghost" id="tal-del" style="margin-left:auto;color:#dc2626">🗑️ Excluir</button>' : ''}
    </div>
  `;
}

function bindDetail() {
  const cargoEl = document.getElementById('tal-cargo'), corrEl = document.getElementById('tal-corretor');
  if (cargoEl) cargoEl.addEventListener('input', () => { if (corrEl) corrEl.style.display = _isCorretor(cargoEl.value) ? 'grid' : 'none'; });
  const setorEl = document.getElementById('tal-setor');
  if (setorEl) {
    const apply = () => { const dl = document.getElementById('tal-cargos'); if (dl) dl.innerHTML = (CARGOS[setorEl.value] || _allCargos).map(c => `<option value="${esc(c)}">`).join(''); };
    setorEl.addEventListener('change', apply); apply();
  }
  document.getElementById('det-back').addEventListener('click', () => { _editing = null; renderManual(); });
  document.getElementById('tal-cancel').addEventListener('click', () => { _editing = null; renderManual(); });
  document.getElementById('tal-save').addEventListener('click', () => saveDetail(false));
  const cont = document.getElementById('tal-contratar');
  if (cont) cont.addEventListener('click', () => saveDetail(true));
  const del = document.getElementById('tal-del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Excluir candidato?')) return;
    try { await api.request('/api/v3/gp/talentos?id=' + encodeURIComponent(_editing.id), { method: 'DELETE' }); _editing = null; await loadManual(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
  const avAdd = document.getElementById('av-add');
  if (avAdd) avAdd.addEventListener('click', addAvaliacao);
}

function captureDetail() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  const cargo = g('tal-cargo');
  const corr = _isCorretor(cargo);
  Object.assign(_editing, {
    nome: g('tal-nome'), contato: g('tal-contato'), email: g('tal-email'),
    instagram: g('tal-instagram'), linkedin: g('tal-linkedin'),
    responsavel: g('tal-responsavel'), canal: g('tal-canal'),
    departamento_solicitante: g('tal-depto'), vaga: g('tal-vaga'),
    setor: g('tal-setor'), cargo, funcao: cargo,
    categoria: corr ? g('tal-categoria') : '', creci: corr ? g('tal-creci') : '',
    atividade_atual: g('tal-atividade'), pretensao: g('tal-pretensao'),
    disponibilidade: g('tal-disponibilidade'), score: g('tal-score'),
    etapa: g('tal-etapa') || 'Triagem', decisao: g('tal-decisao') || 'Em andamento',
    curriculo_url: g('tal-cv'), requisitos: g('tal-requisitos'), experiencia: g('tal-experiencia'),
    feedback_entrevista: g('tal-feedback'), perfil_comportamental: g('tal-perfil'),
    cpf: g('tal-cpf'), cnd: g('tal-cnd'), referencias: g('tal-referencias'),
    processos: g('tal-processos'), antecedentes: g('tal-antecedentes'),
    analise_juridica: g('tal-juridica'), analise_comercial: g('tal-comercial'),
    impeditivos: g('tal-impeditivos'), cenario: g('tal-cenario'), status: g('tal-status'),
  });
}

async function saveDetail(contratar) {
  captureDetail();
  if (!_editing.nome) { alert('Nome obrigatório'); return; }
  if (contratar) { _editing.etapa = 'Contratado'; _editing.decisao = 'Aprovado'; }
  const payload = { ...(_editing.id ? { id: _editing.id } : {}), ..._editing, origem: _editing.origem || 'manual' };
  delete payload.avaliacoes; delete payload.historico;   // gerenciados pelo backend
  try {
    await api.request('/api/v3/gp/talentos', { method: 'POST', body: payload });
    _editing = null;
    await loadManual();
    if (contratar) alert('✅ Candidato movido para "Contratado". Registre o onboarding na aba RH → Onboarding.');
  } catch (e) { alert('Erro: ' + e.message); }
}

async function addAvaliacao() {
  const voto = document.getElementById('av-voto')?.value || '';
  const nota = document.getElementById('av-nota')?.value || '';
  const texto = (document.getElementById('av-texto')?.value || '').trim();
  if (!voto && !texto) { alert('Escolha um voto ou escreva um parecer.'); return; }
  captureDetail();   // preserva edições não salvas da ficha
  try {
    const r = await api.request('/api/v3/gp/talentos', { method: 'POST', body: { action: 'avaliar', id: _editing.id, voto, nota: parseInt(nota) || 0, texto } });
    _editing.avaliacoes = r.avaliacoes || _editing.avaliacoes || [];
    const t = _talentos.find(x => x.id === _editing.id); if (t) t.avaliacoes = _editing.avaliacoes;
    renderManual();
  } catch (e) { alert('Erro ao avaliar: ' + e.message); }
}

/* ─────────────── Requisitos & impeditivos por cargo (v81.92) ─────────────── */
function cargoRefHTML(cargo, field) {
  const c = (_cargosCfg.recrutamento || {})[cargo]; const v = c && c[field];
  if (!v) return '';
  const lbl = field === 'requisitos' ? '📋 Requisitos padrão do cargo' : '⛔ Impeditivos padrão do cargo';
  const cor = field === 'requisitos' ? '#2563eb' : '#dc2626';
  return `<div style="background:${cor}0e;border:1px solid ${cor}33;border-radius:8px;padding:7px 9px;margin-bottom:6px;font-size:12px"><b style="color:${cor}">${lbl} «${esc(cargo)}»</b><br>${esc(v).replace(/\n/g, '<br>')}</div>`;
}

function openCargosReqModal() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow:auto';
  const cargos = [...new Set([..._allCargos, ...Object.keys(_cargosCfg.recrutamento || {})])];
  let sel = cargos[0] || 'Corretor';
  const draw = () => {
    const c = (_cargosCfg.recrutamento || {})[sel] || {};
    ov.innerHTML = `
      <div class="card" style="max-width:560px;width:100%;margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title" style="margin:0">📋 Requisitos & impeditivos por cargo</h3>
          <button class="btn btn-ghost btn-sm" id="cq-x">✕</button>
        </div>
        <p class="tiny muted" style="margin:4px 0 8px">Define o padrão de cada cargo — aparece como referência na ficha do candidato com aquele cargo.</p>
        <label class="tiny muted">Cargo<input id="cq-cargo" class="input" list="cq-list" value="${esc(sel)}"><datalist id="cq-list">${cargos.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="tiny muted" style="display:block;margin-top:8px">Requisitos de contratação<textarea id="cq-req" class="input" rows="3" placeholder="CRECI ativo, CNH, experiência mínima, metas…">${esc(c.requisitos || '')}</textarea></label>
        <label class="tiny muted" style="display:block;margin-top:6px">Impeditivos de contratação<textarea id="cq-imp" class="input" rows="3" placeholder="Processos, conflito de interesse, cláusula de não-concorrência…">${esc(c.impeditivos || '')}</textarea></label>
        <div class="flex gap-2 mt-3" style="align-items:center"><button class="btn btn-primary" id="cq-save">💾 Salvar cargo</button><span class="tiny muted" id="cq-msg"></span><button class="btn btn-ghost" id="cq-close" style="margin-left:auto">Fechar</button></div>
        ${Object.keys(_cargosCfg.recrutamento || {}).length ? `<div class="tiny muted" style="margin-top:10px">Configurados: ${Object.keys(_cargosCfg.recrutamento).map(esc).join(' · ')}</div>` : ''}
      </div>`;
    ov.querySelector('#cq-x').onclick = ov.querySelector('#cq-close').onclick = () => ov.remove();
    ov.querySelector('#cq-cargo').addEventListener('change', e => { sel = e.target.value.trim() || sel; draw(); });
    ov.querySelector('#cq-save').onclick = async () => {
      const cargo = ov.querySelector('#cq-cargo').value.trim(); if (!cargo) return alert('Informe o cargo.');
      try {
        const r = await api.request('/api/v3/gp/cargos', { method: 'POST', body: { action: 'set_recrutamento', cargo, requisitos: ov.querySelector('#cq-req').value, impeditivos: ov.querySelector('#cq-imp').value } });
        _cargosCfg.recrutamento = r.recrutamento || _cargosCfg.recrutamento; sel = cargo;
        ov.querySelector('#cq-msg').textContent = '✅ salvo';
      } catch (e) { alert('Erro: ' + e.message); }
    };
  };
  document.body.appendChild(ov); ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); }); draw();
}
