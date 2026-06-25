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
  inicio: '🏠 Início',
  academy: '🎓 PSM Academy',
  secretaria: '🗂 Secretaria de Vendas & Backoffice', vendas: '🏘 Imóveis & Vendas', locacao: '🔑 Locação',
  financeiro: '💰 Financeiro', marketing: '📊 Marketing', performance: '🎯 Metas & Performance',
  diretoria: '🏛 Diretoria', juridico: '⚖️ Jurídico', ia: '🤖 IA', rh: '🧑‍💼 Gestão de Pessoas & RH',
  sucesso: '🤝 Sucesso do Cliente', ferramentas: '🧮 Ferramentas',
  sistema: '⚙️ Sistema',
};
const PERM_ROLES = [   // socio é fixo (vê tudo) → fora da edição
  ['diretor', '👑 Diretor', 10], ['gerente', '🎯 Gerente', 7], ['lider', '🛡️ Líder', 5],
  ['backoffice', '📋 Back Office', 6], ['financeiro', '💰 Financeiro', 4],
  ['marketing', '📢 Marketing', 3],
  ['corretor_conquista', '🏠 Corretor Conquista', 2], ['corretor_map', '🗺️ Corretor MAP', 2],
  ['corretor_locacao', '🔑 Corretor Locação', 2], ['corretor_terceiros', '🤝 Corretor Terceiros', 2],
];
const PERM_ALWAYS = new Set(['conta']);  // só CONTA é sempre visível; Início e PSM Academy são configuráveis na matriz. v81.40
let _permCatalog = null;   // [{key,label,items:[{route,label,icon,minlvl}]}]
let _permState = {};       // { role: Set(routes) }
let _permDefault = {};     // { role: Set(routes) } — default p/ comparar/restaurar
let _permRole = 'corretor';
let _permCanEdit = false;

// ── Editor de "campos de conclusão" por atividade ──
let _cf = null, _cfKinds = {}, _cfTypes = ['text', 'url', 'number', 'textarea', 'select'], _cfCanEdit = false;
const _cfSlug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);

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

      ${conclusaoCard()}

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
  initConclEditor();  // monta o editor de campos de conclusão por atividade
}

// Matriz de permissões por papel — EDITÁVEL pelo sócio (lvl≥10). Granular por item de menu.
function permissoesCard() {
  return `
    <div class="card mt-4" id="perm-card" style="margin-top:14px">
      <h3 class="card-title">🔐 Permissões por papel</h3>
      <p class="card-sub">Escolha o papel e marque <b>cada item de menu</b> que ele pode ver. Os itens aparecem <b>nas mesmas seções do menu</b> (se você mover um item no Editor de Menu, ele aparece na seção nova aqui). Conta é sempre visível. O papel de cada pessoa é definido em <b>Usuários</b>.</p>
      <div id="perm-editor"><div class="flex items-center gap-2 muted tiny" style="padding:10px 0"><span class="spinner"></span> Carregando matriz…</div></div>
    </div>`;
}

// monta o catálogo agrupado pela SEÇÃO VISUAL do menu (o .sb-sec que precede o item).
// Como a barra já foi reorganizada pelo Editor de Menu (applyMenuLayout), mover um
// item pra outra seção faz ele aparecer sob essa seção AQUI também. v81.54
function buildPermCatalog() {
  const sidebar = document.querySelector('.app-sidebar');
  const groups = [];
  if (!sidebar) return groups;
  let cur = null;
  [...sidebar.children].forEach(node => {
    if (!node.classList) return;
    if (node.classList.contains('sb-sec')) {
      cur = { key: (node.dataset.deflabel || node.textContent.trim()), label: node.textContent.trim(), items: [] };
      groups.push(cur);
    } else if (node.classList.contains('sb-link') && node.dataset.nav && cur) {
      const route = node.dataset.nav;
      const grp = ROUTE_GROUP[route] || 'inicio';
      if (PERM_ALWAYS.has(grp) || !PERM_GROUP_LBL[grp]) return;   // pula sempre-visíveis (conta) e sem rótulo
      const icon = (node.querySelector('.sb-ico')?.textContent || '').trim();
      const label = (node.textContent || '').replace(icon, '').trim();
      if (!cur.items.some(i => i.route === route))
        cur.items.push({ route, label, icon, minlvl: ROUTE_MIN_LVL[route] || 0 });
    }
  });
  return groups.filter(g => g.items.length);
}

function defaultSetFor(role) {
  const allow = ROLE_ALLOWED[role];
  const set = new Set();
  (_permCatalog || []).forEach(g => g.items.forEach(it => {
    const grp = ROUTE_GROUP[it.route] || 'inicio';   // permissão padrão é por ROUTE_GROUP (não pela seção visual)
    if (allow === '*' || (Array.isArray(allow) && (allow.includes(it.route) || allow.includes(grp)))) set.add(it.route);
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
            // v81.58: a MATRIZ MANDA. Nada de cadeado — o sócio libera o que quiser pra
            // qualquer papel. 'warn' é só um aviso suave (ⓘ): o conteúdo pode exigir
            // nível maior no servidor; aparece no menu mas alguns dados podem não abrir.
            const warn = it.minlvl > roleLvl;
            return `<label class="flex items-center gap-1" style="font-size:12.5px;min-width:200px;cursor:${dis ? 'default' : 'pointer'}" title="${warn ? 'Aparece no menu deste cargo. O conteúdo pode exigir nível ' + it.minlvl + ' no servidor — pode não abrir pra cargos abaixo.' : ''}">
              <input type="checkbox" data-perm-route="${it.route}" ${st.has(it.route) ? 'checked' : ''} ${dis ? 'disabled' : ''}>
              ${it.icon} ${escapeHtml(it.label)}${warn ? ' <span style="opacity:.45;font-size:11px" title="pode exigir nível maior no servidor">ⓘ</span>' : ''}</label>`;
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
    <p class="tiny muted" style="margin:0 0 10px">👑 Sócio vê tudo (não editável). Marque/desmarque livremente o que cada papel enxerga no menu — <b>você decide, sem trava de nível</b>. As mudanças propagam pros outros logins em segundos. <span style="opacity:.6">ⓘ = o conteúdo pode exigir nível maior no servidor.</span></p>
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
    g.items.forEach(it => { if (cb.checked) _permState[_permRole].add(it.route); else _permState[_permRole].delete(it.route); });   // v81.58: sem trava de nível
    renderPermEditor();
  });
  host.querySelector('#perm-reset') && (host.querySelector('#perm-reset').onclick = () => {
    _permState[_permRole] = new Set(_permDefault[_permRole]); renderPermEditor();
  });
  host.querySelector('#perm-save') && (host.querySelector('#perm-save').onclick = savePerms);
}

function _setEq(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }

async function savePerms() {
  // Fonte da verdade = as checkboxes REAIS na tela do papel em edição. Garante que
  // nada que você marcou seja perdido por dessincronia de estado interno. v81.25
  if (document.querySelector('input[data-perm-route]')) {
    _permState[_permRole] = new Set(
      [...document.querySelectorAll('input[data-perm-route]:checked')].map(cb => cb.dataset.permRoute)
    );
  }
  // Higiene: só remove rota MORTA/renomeada (que não existe mais como item de menu).
  // v81.58: o NÍVEL não trava mais nada — o sócio decide o que cada papel vê.
  const minByRoute = {};
  (_permCatalog || []).forEach(g => g.items.forEach(it => { minByRoute[it.route] = it.minlvl || 0; }));
  const perms = {};
  PERM_ROLES.forEach(([role, , roleLvl]) => {
    const clean = new Set([..._permState[role]].filter(r => r in minByRoute));
    _permState[role] = clean;
    // só persiste papéis que DIFEREM do default (mantém papéis intactos dinâmicos)
    if (!_setEq(clean, _permDefault[role])) perms[role] = [...clean];
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

// ── Campos de conclusão por atividade (editável pelo sócio) ──
function conclusaoCard() {
  return `
    <div class="card mt-4" id="concl-card" style="margin-top:14px">
      <h3 class="card-title">✅ Campos ao concluir cada atividade</h3>
      <p class="card-sub">Defina o que a pessoa precisa preencher ao marcar como concluída no Home (ex.: Criativo → link + número). Tipos sem campos concluem em 1 clique.</p>
      <div id="concl-editor"><div class="flex items-center gap-2 muted tiny" style="padding:10px 0"><span class="spinner"></span> Carregando…</div></div>
    </div>`;
}

async function initConclEditor() {
  const host = document.getElementById('concl-editor');
  if (!host) return;
  _cfCanEdit = (auth.user()?.lvl || 0) >= 7;
  try {
    const r = await api.request('/api/v3/settings/conclusao_forms');
    _cf = r.forms || {};
    _cfKinds = r.kinds || {};
    if (Array.isArray(r.types) && r.types.length) _cfTypes = r.types;
  } catch (_) { _cf = {}; }
  renderConclEditor();
}

function renderConclEditor() {
  const host = document.getElementById('concl-editor');
  if (!host) return;
  const dis = !_cfCanEdit;
  const kinds = Object.keys(_cfKinds).length ? _cfKinds
    : { criativo: '🎨 Criativo', conteudo: '🎬 Conteúdo', captacao: '📥 Captação', tarefa: '📋 Tarefa', plantao: '🛡 Plantão' };

  const fieldRow = (kind, f, idx) => `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;margin-bottom:6px">
      <input class="input" style="flex:2;min-width:160px" value="${escapeHtml(f.label || '')}" ${dis ? 'disabled' : ''}
             data-cf-edit="${kind}|${idx}|label" placeholder="Rótulo do campo">
      <select class="select" style="flex:1;min-width:110px" ${dis ? 'disabled' : ''} data-cf-edit="${kind}|${idx}|type">
        ${_cfTypes.map(t => `<option value="${t}"${(f.type || 'text') === t ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      ${(f.type === 'select') ? `<input class="input" style="flex:1.5;min-width:140px" value="${escapeHtml((f.options || []).join(', '))}" ${dis ? 'disabled' : ''} data-cf-edit="${kind}|${idx}|options" placeholder="opções: A, B, C">` : ''}
      <label class="tiny" style="font-weight:700;display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" ${f.required ? 'checked' : ''} ${dis ? 'disabled' : ''} data-cf-edit="${kind}|${idx}|required"> obrigatório</label>
      ${dis ? '' : `<button class="btn btn-ghost btn-sm" data-cf-del="${kind}|${idx}" style="color:#dc2626">✕</button>`}
    </div>`;

  host.innerHTML = `
    ${Object.entries(kinds).map(([kind, lbl]) => {
      const fields = (_cf[kind] || []);
      return `<div class="card" style="margin:0 0 10px;background:var(--bg-3)">
        <div class="flex items-center gap-2" style="justify-content:space-between">
          <b style="font-size:13px">${lbl}</b>
          <span class="tiny muted">${fields.length ? fields.length + ' campo(s)' : '1 clique (sem campos)'}</span>
        </div>
        <div style="margin-top:8px">${fields.map((f, i) => fieldRow(kind, f, i)).join('')}</div>
        ${dis ? '' : `<button class="btn btn-ghost btn-sm" data-cf-add="${kind}" style="margin-top:4px;border:1px dashed var(--bd)">➕ campo</button>`}
      </div>`;
    }).join('')}
    ${_cfCanEdit ? `<div class="flex gap-2 mt-2"><button class="btn btn-primary btn-sm" id="cf-save">💾 Salvar campos</button><span id="cf-msg" class="tiny" style="align-self:center"></span></div>`
      : '<div class="tiny muted">Somente leitura (edição é do sócio).</div>'}`;

  if (dis) return;
  host.querySelectorAll('[data-cf-edit]').forEach(el => {
    const [kind, idx, prop] = el.dataset.cfEdit.split('|');
    const handler = () => {
      const f = _cf[kind][+idx];
      if (prop === 'required') f.required = el.checked;
      else if (prop === 'options') f.options = el.value.split(',').map(s => s.trim()).filter(Boolean);
      else { f[prop] = el.value; if (prop === 'type') renderConclEditor(); }   // type muda → re-render (mostra opções)
    };
    if (prop === 'type' || prop === 'required') el.onchange = handler; else el.oninput = handler;
  });
  host.querySelectorAll('[data-cf-add]').forEach(b => b.onclick = () => {
    const kind = b.dataset.cfAdd;
    (_cf[kind] = _cf[kind] || []).push({ key: '', label: '', type: 'text', required: false });
    renderConclEditor();
  });
  host.querySelectorAll('[data-cf-del]').forEach(b => b.onclick = () => {
    const [kind, idx] = b.dataset.cfDel.split('|');
    _cf[kind].splice(+idx, 1); renderConclEditor();
  });
  const save = host.querySelector('#cf-save');
  if (save) save.onclick = saveConcl;
}

async function saveConcl() {
  // gera chave estável p/ campos novos (mantém as existentes — ex.: link/numero/desfecho)
  const out = {};
  Object.entries(_cf).forEach(([kind, fields]) => {
    const seen = new Set();
    out[kind] = (fields || []).filter(f => (f.label || '').trim()).map(f => {
      let key = f.key || _cfSlug(f.label) || 'campo';
      while (seen.has(key)) key += '_';
      seen.add(key);
      const o = { key, label: f.label.trim(), type: f.type || 'text', required: !!f.required };
      if (o.type === 'select') o.options = f.options || [];
      return o;
    });
  });
  const msg = document.getElementById('cf-msg');
  try {
    await api.request('/api/v3/settings/conclusao_forms', { method: 'POST', body: { forms: out } });
    if (msg) { msg.textContent = '✓ Salvo'; msg.style.color = '#16a34a'; }
  } catch (e) {
    if (msg) { msg.textContent = 'Erro: ' + e.message; msg.style.color = '#dc2626'; }
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
