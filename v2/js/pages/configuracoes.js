/* ============================================================================
   PSM-OS v2 — Configurações (Connectors, API Keys, Integrações)
   Sprint 7.17
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { ROUTE_GROUP, ROLE_ALLOWED, ROUTE_MIN_LVL } from '../main.js';

let _root = null;
let _data = null;
let _reveal = false;

// ── Editor de Permissões por papel (matriz editável pelo sócio) ──
const PERM_GROUP_LBL = {
  secretaria: '🗂 Secretaria de Vendas & Backoffice', vendas: '🏘 Imóveis & Vendas', locacao: '🔑 Locação',
  financeiro: '💰 Financeiro', marketing: '📊 Marketing', performance: '🎯 Metas & Performance',
  diretoria: '🏛 Diretoria', ia: '🤖 IA', rh: '🧑‍💼 Gestão de Pessoas & RH', ferramentas: '🧮 Ferramentas',
  sistema: '⚙️ Sistema',
};
const PERM_ROLES = [   // socio é fixo (vê tudo) → fora da edição
  ['diretor', '👑 Diretor', 10], ['gerente', '🎯 Gerente', 7], ['lider', '🛡️ Líder', 5],
  ['backoffice', '📋 Back Office', 6], ['financeiro', '💰 Financeiro', 4],
  ['marketing', '📢 Marketing', 3], ['corretor', '🏠 Corretor', 2],
];
const PERM_ALWAYS = new Set(['inicio', 'conta', 'academy']);  // sempre visíveis
let _permCatalog = null;   // [{key,label,items:[{route,label,icon,minlvl}]}]
let _permState = {};       // { role: Set(routes) }
let _permDefault = {};     // { role: Set(routes) } — default p/ comparar/restaurar
let _permRole = 'corretor';
let _permCanEdit = false;

export async function pageConfiguracoes(ctx, root) {
  _root = root;
  const me = auth.user();
  if ((me?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Gerente (lvl ≥ 7).</div>';
    return;
  }
  await reload();
}

async function reload() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando settings…</div></div>';
  try {
    _data = await api.request('/api/v3/settings/list' + (_reveal ? '?reveal=1' : ''));
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function render() {
  const me = auth.user();
  const isSocio10 = (me?.lvl || 0) >= 10;
  const groups = _data.groups || [];
  const ts = _data.updated_at ? new Date(_data.updated_at).toLocaleString('pt-BR') : '—';

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">⚙️ Configurações do sistema</h2>
      <p class="card-sub">
        Tokens, API keys e integrações compartilhadas. ${_data.count || 0} setting(s) configurado(s) · Atualizado ${ts}
        ${!isSocio10 ? '<br><b>Apenas Sócio (L10) pode editar e revelar secrets.</b>' : ''}
      </p>

      ${isSocio10 ? `
        <div class="flex gap-2 mt-2" style="padding:10px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center">
          <label class="flex items-center gap-2" style="font-size:13px;font-weight:600;cursor:pointer">
            <input type="checkbox" id="rev-tog" ${_reveal ? 'checked' : ''}>
            👁 Revelar valores reais (Sócio)
          </label>
          <span class="tiny muted" style="margin-left:auto">${_reveal ? '⚠ Valores em texto claro' : '🔒 Valores mascarados'}</span>
        </div>
      ` : ''}

      ${groups.map(g => groupCard(g, isSocio10)).join('')}

      ${permissoesCard()}

      <div class="alert alert-warn mt-4">
        <b>⚠ Chaves sensíveis</b> aparecem com bullets (••••) por segurança.
        ${isSocio10 ? 'Toggle "Revelar" exibe valor real. ' : ''}
        Tokens NIBO/JWT/Supabase ficam nas env vars do Vercel (não aqui).
      </div>
    </div>
  `;

  const rev = document.getElementById('rev-tog');
  if (rev) rev.addEventListener('change', async e => { _reveal = e.target.checked; await reload(); });

  document.querySelectorAll('[data-setting-save]').forEach(b => b.addEventListener('click', saveSetting));

  initPermEditor();   // monta a matriz editável de permissões por papel
}

// Matriz de permissões por papel — EDITÁVEL pelo sócio (lvl≥10). Granular por item de menu.
function permissoesCard() {
  return `
    <div class="card mt-4" id="perm-card" style="margin-top:14px">
      <h3 class="card-title">🔐 Permissões por papel</h3>
      <p class="card-sub">Escolha o papel e marque <b>cada item de menu</b> que ele pode ver. Início, Conta e Academy são sempre visíveis. O papel de cada pessoa é definido em <b>Usuários</b>.</p>
      <div id="perm-editor"><div class="flex items-center gap-2 muted tiny" style="padding:10px 0"><span class="spinner"></span> Carregando matriz…</div></div>
    </div>`;
}

// monta o catálogo de itens de menu a partir da barra lateral renderizada (reflete o menu real)
function buildPermCatalog() {
  const buckets = {};   // group -> [{route,label,icon,minlvl}]
  const order = [];
  document.querySelectorAll('.app-sidebar .sb-link[data-nav]').forEach(btn => {
    const route = btn.dataset.nav;
    const grp = ROUTE_GROUP[route] || 'inicio';
    if (PERM_ALWAYS.has(grp) || !PERM_GROUP_LBL[grp]) return;   // pula sempre-visíveis e grupos sem rótulo
    const icon = (btn.querySelector('.sb-ico')?.textContent || '').trim();
    const label = (btn.textContent || '').replace(icon, '').trim();
    if (!buckets[grp]) { buckets[grp] = []; order.push(grp); }
    if (!buckets[grp].some(i => i.route === route))
      buckets[grp].push({ route, label, icon, minlvl: ROUTE_MIN_LVL[route] || 0 });
  });
  return order.map(g => ({ key: g, label: PERM_GROUP_LBL[g], items: buckets[g] }));
}

function defaultSetFor(role) {
  const allow = ROLE_ALLOWED[role];
  const set = new Set();
  (_permCatalog || []).forEach(g => g.items.forEach(it => {
    if (allow === '*' || (Array.isArray(allow) && (allow.includes(it.route) || allow.includes(g.key)))) set.add(it.route);
  }));
  return set;
}

async function initPermEditor() {
  const host = document.getElementById('perm-editor');
  if (!host) return;
  _permCanEdit = (auth.user()?.lvl || 0) >= 10;
  _permCatalog = buildPermCatalog();
  let saved = {};
  try { const r = await api.request('/api/v3/settings/role_perms'); saved = (r && r.perms) || {}; } catch (_) {}
  _permState = {}; _permDefault = {};
  PERM_ROLES.forEach(([role]) => {
    _permDefault[role] = defaultSetFor(role);
    _permState[role] = Array.isArray(saved[role]) ? new Set(saved[role]) : new Set(_permDefault[role]);
  });
  renderPermEditor();
}

function renderPermEditor() {
  const host = document.getElementById('perm-editor');
  if (!host) return;
  const roleLvl = (PERM_ROLES.find(r => r[0] === _permRole) || [, , 0])[2];
  const st = _permState[_permRole] || new Set();
  const dis = !_permCanEdit;

  const groupsHTML = (_permCatalog || []).map(g => {
    const total = g.items.length;
    const on = g.items.filter(it => st.has(it.route)).length;
    const allOn = on === total, noneOn = on === 0;
    return `
      <div class="card" style="margin:0 0 10px;background:var(--bg-3)">
        <label class="flex items-center gap-2" style="font-weight:800;font-size:13px;cursor:${dis ? 'default' : 'pointer'}">
          <input type="checkbox" data-perm-grp="${g.key}" ${allOn ? 'checked' : ''} ${dis ? 'disabled' : ''}
                 ref-indet="${!allOn && !noneOn ? '1' : ''}"> ${g.label}
          <span class="tiny muted" style="font-weight:600">${on}/${total}</span>
        </label>
        <div class="flex" style="flex-wrap:wrap;gap:8px 18px;margin-top:8px">
          ${g.items.map(it => {
            const gated = it.minlvl > roleLvl;
            return `<label class="flex items-center gap-1" style="font-size:12.5px;min-width:200px;cursor:${dis || gated ? 'default' : 'pointer'};opacity:${gated ? .45 : 1}" title="${gated ? 'Exige nível ' + it.minlvl + ' — o cargo não alcança' : ''}">
              <input type="checkbox" data-perm-route="${it.route}" ${st.has(it.route) ? 'checked' : ''} ${dis || gated ? 'disabled' : ''}>
              ${it.icon} ${escapeHtml(it.label)}${gated ? ' 🔒' : ''}</label>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:10px">
      <span class="tiny muted" style="font-weight:700">Editando o papel:</span>
      <select id="perm-role-sel" class="select">${PERM_ROLES.map(([r, lbl]) => `<option value="${r}"${r === _permRole ? ' selected' : ''}>${lbl}</option>`).join('')}</select>
      ${_permCanEdit ? `
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-sm" id="perm-reset">↩ Restaurar padrão deste papel</button>
        <button class="btn btn-primary btn-sm" id="perm-save">💾 Salvar permissões</button>` : `<span class="tiny muted">· somente leitura (edição é do sócio)</span>`}
    </div>
    <p class="tiny muted" style="margin:0 0 10px">👑 Sócio vê tudo (não editável). 🔒 = item exige nível acima do cargo — fica indisponível pra evitar erro de acesso.</p>
    ${groupsHTML || '<div class="muted tiny">Catálogo de menu vazio.</div>'}`;

  // tri-state nos checkboxes de grupo
  host.querySelectorAll('input[ref-indet="1"]').forEach(el => { el.indeterminate = true; });

  const sel = host.querySelector('#perm-role-sel');
  if (sel) sel.onchange = () => { _permRole = sel.value; renderPermEditor(); };
  if (!_permCanEdit) return;
  host.querySelectorAll('input[data-perm-route]').forEach(cb => cb.onchange = () => {
    const r = cb.dataset.permRoute;
    if (cb.checked) _permState[_permRole].add(r); else _permState[_permRole].delete(r);
    renderPermEditor();
  });
  host.querySelectorAll('input[data-perm-grp]').forEach(cb => cb.onchange = () => {
    const g = (_permCatalog || []).find(x => x.key === cb.dataset.permGrp);
    if (!g) return;
    g.items.forEach(it => { if (it.minlvl <= roleLvl) { if (cb.checked) _permState[_permRole].add(it.route); else _permState[_permRole].delete(it.route); } });
    renderPermEditor();
  });
  host.querySelector('#perm-reset') && (host.querySelector('#perm-reset').onclick = () => {
    _permState[_permRole] = new Set(_permDefault[_permRole]); renderPermEditor();
  });
  host.querySelector('#perm-save') && (host.querySelector('#perm-save').onclick = savePerms);
}

function _setEq(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }

async function savePerms() {
  // só persiste papéis que DIFEREM do default (mantém papéis intactos dinâmicos)
  const perms = {};
  PERM_ROLES.forEach(([role]) => {
    if (!_setEq(_permState[role], _permDefault[role])) perms[role] = [..._permState[role]];
  });
  const btn = document.getElementById('perm-save');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }
  try {
    await api.request('/api/v3/settings/role_perms', { method: 'POST', body: { perms } });
    if (btn) btn.textContent = '✓ Salvo — recarregando…';
    setTimeout(() => location.reload(), 800);   // re-aplica o menu pra todos os fluxos
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar permissões'; }
    alert('Erro ao salvar: ' + e.message);
  }
}

function groupCard(g, canEdit) {
  return `
    <div class="card mt-4" style="margin-top:14px">
      <h3 class="card-title">${g.ico || ''} ${escapeHtml(g.label || g.category)}</h3>
      <div style="display:grid;gap:10px">
        ${g.items.map(it => settingRow(it, canEdit)).join('')}
      </div>
    </div>
  `;
}

function settingRow(it, canEdit) {
  const inputType = it.is_secret ? (_reveal ? 'text' : 'password') : 'text';
  const displayValue = canEdit && _reveal ? it.value : (it.is_secret ? (it.has_value ? '••••••••••••' : '') : it.value);
  return `
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
      <div class="field" style="margin:0">
        <label style="font-size:11px;font-weight:700;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.5px">
          ${escapeHtml(it.label)}${it.is_secret ? ' 🔒' : ''}
          ${it.has_value ? '<span class="tiny" style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:var(--r-full);margin-left:6px;font-weight:600">✓ configurado</span>' : ''}
        </label>
        <input type="${inputType}" class="input" id="set-${it.key}"
               value="${escapeHtml(displayValue)}"
               placeholder="${escapeHtml(it.placeholder || '')}"
               ${canEdit ? '' : 'disabled'}>
      </div>
      ${canEdit ? `<button class="btn btn-primary" data-setting-save="${it.key}" style="height:fit-content">Salvar</button>` : ''}
    </div>
  `;
}

async function saveSetting(ev) {
  const key = ev.currentTarget.dataset.settingSave;
  const input = document.getElementById('set-' + key);
  if (!input) return;
  const value = input.value;
  const btn = ev.currentTarget;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await api.request('/api/v3/settings/upsert', { method: 'POST', body: { key, value } });
    btn.textContent = '✓ Salvo';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; reload(); }, 1200);
  } catch (e) {
    btn.textContent = '✕ Erro';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
    alert('Erro: ' + e.message);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
