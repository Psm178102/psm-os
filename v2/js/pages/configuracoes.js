/* ============================================================================
   PSM-OS v2 — Configurações (Connectors, API Keys, Integrações)
   Sprint 7.17
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { ROUTE_GROUP, ROLE_ALLOWED, ROUTE_MIN_LVL } from '../main.js';
import { getResourcePerms, saveResourcePerms, ROLE_OPTIONS } from '../links.js';

let _root = null;
let _data = null;
let _reveal = false;

// ── Visibilidade de SUB-ABAS (resource_perms) — controle central v81.85 ──
// Cada sub-aba interna (que não é rota própria) vira um "recurso" com chave;
// a página confere canSeeResource(chave). Lista por GRUPO de página. Extensível:
// pra controlar uma sub-aba nova, registra aqui + 1 checagem canSeeResource na página.
const SUBABA_REGISTRY = [
  { grupo: '🗺 Mapa de Empreendimentos', itens: [
    ['mapa_map', 'Aba MAP'], ['mapa_conquista', 'Aba PSM Conquista'] ] },
  { grupo: '📚 Biblioteca de Anúncios — Bibliotecas do Meta', itens: [
    ['ads_conquista', 'Conta Conquista'], ['ads_map', 'Conta MAP'],
    ['ads_locacao', 'Conta Locação'], ['ads_terceiros', 'Conta Terceiros'] ] },
  { grupo: '📣 Biblioteca de Anúncios — Anúncios PSM (criativo+copy)', itens: [
    ['adspsm_conquista', 'Aba Conquista'], ['adspsm_map_terceiros', 'Aba MAP+Terceiros'],
    ['adspsm_locacao', 'Aba Locação'] ] },
  { grupo: '🌟 Base de Talentos', itens: [
    ['talentos_rd', 'Aba RD ao vivo'], ['talentos_manual', 'Aba Base manual'] ] },
];
let _resState = {};      // { key: Set(roles) }  — Set vazio = todos veem
let _resCanEdit = false;
let _homeRoutes = {};    // { papel: '/rota' } — tela inicial por papel (v81.86)

// ── Editor de Permissões por papel (matriz editável pelo sócio) ──
const PERM_GROUP_LBL = {
  inicio: '🏠 Início',
  academy: '🎓 PSM Academy',
  secretaria: '🗂 Secretaria de Vendas & Backoffice', adm: '🗄 Backoffice & Adm', vendas: '🏘 Imóveis & Vendas', locacao: '🔑 Locação',
  financeiro: '💰 Financeiro', marketing: '📊 Marketing', performance: '🎯 Metas & Performance',
  diretoria: '🏛 Diretoria', juridico: '⚖️ Jurídico', ia: '🤖 IA', rh: '🧑‍💼 Gestão de Pessoas & RH',
  sucesso: '🤝 Sucesso do Cliente', ferramentas: '🧮 Ferramentas',
  sistema: '⚙️ Sistema',
};
const PERM_ROLES = [   // socio é fixo (vê tudo) → fora da edição
  ['diretor', '👑 Diretor', 10], ['gerente', '🎯 Gerente (geral)', 7], ['lider', '🛡️ Líder', 5],
  ['gerente_conquista', '🎯 Gerente Conquista', 7], ['gerente_map', '🎯 Gerente MAP', 7],
  ['gerente_locacao', '🎯 Gerente Locação', 7], ['gerente_terceiros', '🎯 Gerente Terceiros', 7],
  ['backoffice', '📋 Back Office', 6], ['secretaria_vendas', '🗂️ Secretária de Vendas', 3],
  ['financeiro', '💰 Financeiro', 4],
  ['marketing', '📢 Marketing', 3],
  ['corretor_conquista', '🏠 Corretor Conquista', 2], ['corretor_map', '🗺️ Corretor MAP', 2],
  ['corretor_locacao', '🔑 Corretor Locação', 2], ['corretor_terceiros', '🤝 Corretor Terceiros', 2],
];
let _cfgCustomRoles = [];   // categorias de login CUSTOM (shared_kv 'custom_roles'). v81.91
let _cfgBuiltin = [];       // papéis FIXOS com nível efetivo (base + override do sócio). v83.9
let _cfgRouteLvl = {};      // travas de nível por rota (shared_kv 'route_min_lvl'). v83.9
let _cfgFrentes = [];       // fonte única de frentes (shared_kv 'frentes_config'). v84.0
const permRoles = () => [...PERM_ROLES, ..._cfgCustomRoles.map(r => [r.id, (r.ico ? r.ico + ' ' : '🏷️ ') + r.label, r.lvl || 2])];
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
    const [d, cr] = await Promise.all([
      api.request('/api/v3/settings/list' + (_reveal ? '?reveal=1' : '')),
      api.request('/api/v3/settings/roles').catch(() => ({ roles: [] })),
    ]);
    _data = d;
    _cfgCustomRoles = (cr && cr.roles) || [];   // categorias custom entram na matriz/sub-abas/tela inicial
    _cfgBuiltin = (cr && cr.builtin) || [];      // fixos c/ nível efetivo (Central de Permissões, v83.9)
    try { const rp = await api.request('/api/v3/settings/role_perms'); _cfgRouteLvl = (rp && rp.route_lvl) || {}; } catch (_) { _cfgRouteLvl = {}; }
    try { const fr = await api.request('/api/v3/settings/frentes'); _cfgFrentes = (fr && fr.frentes) || []; } catch (_) { _cfgFrentes = []; }
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

      ${cargosNiveisCard()}

      ${permissoesCard()}

      ${travasRotaCard()}

      ${frentesCard()}

      ${kvConfigCard()}

      ${subAbasCard()}

      ${homeRoutesCard()}

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
  initCargosNiveis(); // Central de Permissões: níveis por cargo (v83.9)
  initTravasRota();   // Central de Permissões: travas de nível por rota (v83.9)
  initFrentes();      // Central de Frentes: nome/funis/ativa (fonte única, v84.0)
  initKvConfig();     // configs avançadas que antes só saíam via SQL (v84.1)
  initSubAbas();      // monta o painel central de visibilidade de sub-abas
  initHomeRoutes();   // monta o editor de tela inicial por papel
  initConclEditor();  // monta o editor de campos de conclusão por atividade
}


// ── Central de Permissões · CARGOS & NÍVEIS (sócio define, v83.9) ──
const ROLE_LBL = Object.fromEntries(PERM_ROLES.map(([id, lbl]) => [id, lbl]));
ROLE_LBL.socio = '👑 Sócio'; ROLE_LBL.corretor = '🏠 Corretor (genérico)';
function cargosNiveisCard() {
  return `
    <div class="card mt-4" id="cargos-card" style="margin-top:14px">
      <h3 class="card-title">🎚 Cargos & Níveis</h3>
      <p class="card-sub">O <b>nível</b> (1–10) é a régua de alçada do sistema inteiro — telas e backend leem daqui. Edite o nível de qualquer cargo (fixo ou custom). <b>Sócio e Diretor são travados em 10</b> (proteção pra você nunca se trancar fora). Cargos novos você cria em <b>Usuários → Categorias</b>.</p>
      <div id="cargos-editor"><div class="flex items-center gap-2 muted tiny" style="padding:8px 0"><span class="spinner"></span> Carregando cargos…</div></div>
    </div>`;
}
function initCargosNiveis() {
  const box = document.getElementById('cargos-editor');
  if (!box) return;
  const isSocio = (auth.user()?.lvl || 0) >= 10;
  const rowB = r => `<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:5px 8px">${ROLE_LBL[r.id] || r.id}</td>
    <td style="padding:5px 8px" class="tiny muted">fixo${r.override ? ' · <b style="color:#d97706">nível alterado</b>' : ''}</td>
    <td style="padding:5px 8px;text-align:center">${['socio','diretor'].includes(r.id)
      ? `<b>${r.lvl}</b> 🔒`
      : `<input type="number" min="1" max="10" class="input cn-lvl" data-role="${r.id}" value="${r.lvl}" ${isSocio ? '' : 'disabled'} style="width:64px;padding:3px 6px;text-align:center">${r.override && isSocio ? ` <button class="btn btn-ghost btn-sm cn-reset" data-role="${r.id}" title="voltar ao padrão (${r.lvl_base})" style="padding:1px 6px">↩ ${r.lvl_base}</button>` : ''}`}</td>
  </tr>`;
  const rowC = r => `<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:5px 8px">${(r.ico || '🏷️')} ${escapeHtml(r.label || r.id)}</td>
    <td style="padding:5px 8px" class="tiny muted">custom</td>
    <td style="padding:5px 8px;text-align:center"><input type="number" min="1" max="10" class="input cn-lvl-custom" data-role="${r.id}" value="${r.lvl || 2}" ${isSocio ? '' : 'disabled'} style="width:64px;padding:3px 6px;text-align:center"></td>
  </tr>`;
  box.innerHTML = `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;max-width:560px">
      <thead><tr style="background:var(--bg-3);text-align:left"><th style="padding:6px 8px">Cargo</th><th style="padding:6px 8px">Tipo</th><th style="padding:6px 8px;text-align:center">Nível</th></tr></thead>
      <tbody>${(_cfgBuiltin || []).map(rowB).join('')}${(_cfgCustomRoles || []).map(rowC).join('')}</tbody>
    </table></div>
    <div class="tiny muted mt-2">Referência de alçada: 10 sócio/diretor · 7 gerente · 6 backoffice · 5 líder · 4 financeiro · 3 marketing/secretaria · 2 corretor. Mudar aqui vale no login seguinte (cache de 60s no backend).</div>
    <span class="tiny" id="cn-msg" style="color:#16a34a"></span>`;
  if (!isSocio) return;
  const msg = t => { const m = document.getElementById('cn-msg'); if (m) { m.textContent = t; setTimeout(() => { if (m) m.textContent = ''; }, 3500); } };
  box.querySelectorAll('.cn-lvl').forEach(el => el.addEventListener('change', async () => {
    try { await api.request('/api/v3/settings/roles', { method: 'POST', body: { action: 'set_lvl', role: el.dataset.role, lvl: parseInt(el.value) || 2 } }); msg('✅ nível salvo'); }
    catch (e) { msg('⚠️ ' + e.message); }
  }));
  box.querySelectorAll('.cn-reset').forEach(b => b.addEventListener('click', async () => {
    try { await api.request('/api/v3/settings/roles', { method: 'POST', body: { action: 'set_lvl', role: b.dataset.role, lvl: 'reset' } }); msg('↩ nível padrão restaurado'); await reload(); }
    catch (e) { msg('⚠️ ' + e.message); }
  }));
  box.querySelectorAll('.cn-lvl-custom').forEach(el => el.addEventListener('change', async () => {
    const r = (_cfgCustomRoles || []).find(x => x.id === el.dataset.role); if (!r) return;
    try { await api.request('/api/v3/settings/roles', { method: 'POST', body: { action: 'add', id: r.id, label: r.label, lvl: parseInt(el.value) || 2, color: r.color, ico: r.ico } }); msg('✅ nível salvo'); }
    catch (e) { msg('⚠️ ' + e.message); }
  }));
}

// ── Central de Permissões · TRAVAS DE NÍVEL POR ROTA (sócio define, v83.9) ──
function travasRotaCard() {
  return `
    <div class="card mt-4" id="travas-card" style="margin-top:14px">
      <h3 class="card-title">🔒 Travas de nível por página</h3>
      <p class="card-sub">Além da matriz (quem VÊ), estas travas exigem um <b>nível mínimo</b> pra abrir a página — a fronteira dura. Edite o número pra abrir/fechar uma página por alçada (ex.: baixar Cockpit Conquista de 10 pra 2 libera pro corretor). 0 = sem trava.</p>
      <div id="travas-editor"><div class="flex items-center gap-2 muted tiny" style="padding:8px 0"><span class="spinner"></span> Carregando travas…</div></div>
    </div>`;
}
function initTravasRota() {
  const box = document.getElementById('travas-editor');
  if (!box) return;
  const isSocio = (auth.user()?.lvl || 0) >= 10;
  const rotas = { ...ROUTE_MIN_LVL };
  Object.keys(_cfgRouteLvl || {}).forEach(r => { if (!(r in rotas)) rotas[r] = 0; });
  const nomeDe = r => { const el = document.querySelector(`.app-sidebar .sb-link[data-nav="${r}"]`); return el ? el.textContent.trim() : r; };
  const rows = Object.keys(rotas).sort().map(r => {
    const base = ROUTE_MIN_LVL[r] || 0;
    const ef = (_cfgRouteLvl[r] !== undefined) ? _cfgRouteLvl[r] : base;
    const mudou = _cfgRouteLvl[r] !== undefined && _cfgRouteLvl[r] !== base;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:4px 8px">${escapeHtml(nomeDe(r))} <span class="tiny muted">${r}</span></td>
      <td style="padding:4px 8px;text-align:center" class="tiny muted">${base}</td>
      <td style="padding:4px 8px;text-align:center"><input type="number" min="0" max="10" class="input tr-lvl" data-route="${r}" value="${ef}" ${isSocio ? '' : 'disabled'} style="width:60px;padding:3px 6px;text-align:center;${mudou ? 'border-color:#d97706;font-weight:700' : ''}"></td>
    </tr>`;
  }).join('');
  box.innerHTML = `
    <div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;max-width:640px">
      <thead><tr style="background:var(--bg-3);text-align:left;position:sticky;top:0"><th style="padding:6px 8px">Página</th><th style="padding:6px 8px;text-align:center">Padrão</th><th style="padding:6px 8px;text-align:center">Trava atual</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${isSocio ? `<div class="flex gap-2 mt-2" style="align-items:center">
      <button class="btn btn-primary btn-sm" id="tr-save">💾 Salvar travas</button>
      <button class="btn btn-ghost btn-sm" id="tr-reset">↩ Voltar tudo ao padrão</button>
      <span class="tiny" id="tr-msg" style="color:#16a34a"></span>
    </div>` : '<div class="tiny muted mt-2">Só o sócio edita.</div>'}`;
  if (!isSocio) return;
  const msg = t => { const m = document.getElementById('tr-msg'); if (m) { m.textContent = t; setTimeout(() => { if (m) m.textContent = ''; }, 3500); } };
  const salvar = async (rl) => {
    try {
      const r = await api.request('/api/v3/settings/role_perms', { method: 'POST', body: { route_lvl: rl } });
      _cfgRouteLvl = (r && r.route_lvl) || {}; msg('✅ travas salvas — valem no próximo carregamento de cada login'); initTravasRota();
    } catch (e) { msg('⚠️ ' + e.message); }
  };
  const save = document.getElementById('tr-save');
  if (save) save.addEventListener('click', () => {
    const rl = {};
    box.querySelectorAll('.tr-lvl').forEach(el => {
      const r = el.dataset.route, v = Math.max(0, Math.min(10, parseInt(el.value) || 0));
      if (v !== (ROUTE_MIN_LVL[r] || 0)) rl[r] = v;   // só guarda o que difere do padrão
    });
    salvar(rl);
  });
  const rst = document.getElementById('tr-reset');
  if (rst) rst.addEventListener('click', () => { if (confirm('Voltar TODAS as travas ao padrão do sistema?')) salvar({}); });
}


// ── Central de FRENTES (fonte única: nome, funis do RD, ativa/pausada). v84.0 ──
function frentesCard() {
  return `
    <div class="card mt-4" id="frentes-card" style="margin-top:14px">
      <h3 class="card-title">🏢 Frentes / Empresas (fonte única)</h3>
      <p class="card-sub">Todo o sistema (painéis, viabilidade, dashboard) lê as frentes daqui. <b>Pausar</b> uma frente esconde as telas dela do menu (ex.: Locações sem operação) — os dados históricos continuam contando. <b>Funis</b> são as palavras-chave que casam com o nome do funil no RD (ex.: "MAP" pega FUNIL MAP e CARTEIRA MAP PAULO).</p>
      <div id="frentes-editor"><div class="flex items-center gap-2 muted tiny" style="padding:8px 0"><span class="spinner"></span> Carregando frentes…</div></div>
    </div>`;
}
function initFrentes() {
  const box = document.getElementById('frentes-editor');
  if (!box) return;
  const isSocio = (auth.user()?.lvl || 0) >= 10;
  const rows = (_cfgFrentes || []).map(f => `<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:5px 8px">${f.icon} <input class="input fr-nome" data-id="${f.id}" value="${escapeHtml(f.nome || f.id)}" ${isSocio ? '' : 'disabled'} style="width:150px;padding:3px 6px;font-size:12.5px"></td>
    <td style="padding:5px 8px"><input class="input fr-funis" data-id="${f.id}" value="${escapeHtml((f.funis || []).join(', '))}" ${isSocio ? '' : 'disabled'} title="palavras-chave dos funis do RD, separadas por vírgula" style="width:200px;padding:3px 6px;font-size:12px"></td>
    <td style="padding:5px 8px;text-align:center"><label class="tiny" style="cursor:pointer;display:inline-flex;gap:5px;align-items:center"><input type="checkbox" class="fr-ativa" data-id="${f.id}" ${f.ativa !== false ? 'checked' : ''} ${isSocio ? '' : 'disabled'}> ${f.ativa !== false ? '▶ ativa' : '⏸ pausada'}</label></td>
  </tr>`).join('');
  box.innerHTML = `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;max-width:640px">
      <thead><tr style="background:var(--bg-3);text-align:left"><th style="padding:6px 8px">Frente</th><th style="padding:6px 8px">Funis do RD (palavras-chave)</th><th style="padding:6px 8px;text-align:center">Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${isSocio ? `<div class="flex gap-2 mt-2" style="align-items:center">
      <button class="btn btn-primary btn-sm" id="fr-save">💾 Salvar frentes</button>
      <span class="tiny" id="fr-msg" style="color:#16a34a"></span>
    </div>` : '<div class="tiny muted mt-2">Só o sócio edita.</div>'}`;
  if (!isSocio) return;
  const save = document.getElementById('fr-save');
  if (save) save.addEventListener('click', async () => {
    const frentes = (_cfgFrentes || []).map(f => ({
      id: f.id,
      nome: box.querySelector(`.fr-nome[data-id="${f.id}"]`)?.value?.trim() || f.nome,
      funis: (box.querySelector(`.fr-funis[data-id="${f.id}"]`)?.value || '').split(',').map(s => s.trim()).filter(Boolean),
      ativa: !!box.querySelector(`.fr-ativa[data-id="${f.id}"]`)?.checked,
    }));
    const m = document.getElementById('fr-msg');
    try {
      const r = await api.request('/api/v3/settings/frentes', { method: 'POST', body: { frentes } });
      _cfgFrentes = (r && r.frentes) || _cfgFrentes;
      if (m) m.textContent = '✅ frentes salvas — menu e painéis atualizam no próximo carregamento';
      initFrentes();
    } catch (e) { if (m) m.textContent = '⚠️ ' + e.message; }
  });
}


// ── Configs AVANÇADAS (antes só via SQL — auditoria A5). Editor JSON com whitelist. v84.1 ──
const KVCFG_KEYS = [
  ['oo_meta_team_account', '🎯 One-on-One: equipe → conta Meta', 'ex.: { "conquista": "act_123..." } — usado pro CPL por equipe no 1:1'],
  ['custos_fixos_corretor', '💰 Custo fixo por corretor/equipe (CPL 1:1)', 'ex.: { "teams": { "conquista": { "itens": [ { "desc": "mesa", "valor": 350 } ] } }, "users": {} }'],
];
function kvConfigCard() {
  return `
    <div class="card mt-4" id="kvcfg-card" style="margin-top:14px">
      <h3 class="card-title">🧩 Configs avançadas (JSON)</h3>
      <p class="card-sub">Configurações que o sistema lê e que antes só dava pra mudar por SQL. Formato JSON — o botão valida antes de salvar. Se não usa, deixa como está.</p>
      <div id="kvcfg-editor"><div class="flex items-center gap-2 muted tiny" style="padding:8px 0"><span class="spinner"></span> Carregando…</div></div>
    </div>`;
}
async function initKvConfig() {
  const box = document.getElementById('kvcfg-editor');
  if (!box) return;
  const isSocio = (auth.user()?.lvl || 0) >= 10;
  const vals = {};
  for (const [k] of KVCFG_KEYS) {
    try { const r = await api.request('/api/v3/settings/kv_config?key=' + k); vals[k] = r?.value || {}; }
    catch (_) { vals[k] = {}; }
  }
  box.innerHTML = KVCFG_KEYS.map(([k, titulo, hint]) => `
    <div style="margin-bottom:12px">
      <div style="font-weight:700;font-size:13px">${titulo}</div>
      <div class="tiny muted" style="margin:2px 0 4px">${escapeHtml(hint)}</div>
      <textarea class="input kv-json" data-key="${k}" rows="4" ${isSocio ? '' : 'disabled'} style="width:100%;font-family:monospace;font-size:11.5px">${escapeHtml(JSON.stringify(vals[k], null, 2))}</textarea>
      ${isSocio ? `<button class="btn btn-primary btn-sm kv-save" data-key="${k}" style="margin-top:4px">💾 Validar & salvar</button> <span class="tiny kv-msg" data-key="${k}"></span>` : ''}
    </div>`).join('');
  if (!isSocio) return;
  box.querySelectorAll('.kv-save').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.key;
    const ta = box.querySelector(`.kv-json[data-key="${k}"]`);
    const m = box.querySelector(`.kv-msg[data-key="${k}"]`);
    let value;
    try { value = JSON.parse(ta.value || '{}'); if (typeof value !== 'object' || Array.isArray(value)) throw new Error('precisa ser um objeto {}'); }
    catch (e) { if (m) { m.textContent = '⚠️ JSON inválido: ' + e.message; m.style.color = '#dc2626'; } return; }
    try {
      await api.request('/api/v3/settings/kv_config', { method: 'POST', body: { key: k, value } });
      if (m) { m.textContent = '✅ salvo'; m.style.color = '#16a34a'; setTimeout(() => m.textContent = '', 3000); }
    } catch (e) { if (m) { m.textContent = '⚠️ ' + e.message; m.style.color = '#dc2626'; } }
  }));
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
  permRoles().forEach(([role]) => {
    _permDefault[role] = defaultSetFor(role);
    _permState[role] = Array.isArray(saved[role]) ? new Set(saved[role]) : new Set(_permDefault[role]);
  });
  renderPermEditor();
}

function renderPermEditor() {
  const host = document.getElementById('perm-editor');
  if (!host) return;
  const roleLvl = (permRoles().find(r => r[0] === _permRole) || [, , 0])[2];
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
      <select id="perm-role-sel" class="select">${permRoles().map(([r, lbl]) => `<option value="${r}"${r === _permRole ? ' selected' : ''}>${lbl}</option>`).join('')}</select>
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
  permRoles().forEach(([role, , roleLvl]) => {
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
// ── Painel central: Visibilidade de SUB-ABAS (resource_perms) v81.85 ──
function subAbasCard() {
  return `
    <div class="card mt-4" id="subaba-card" style="margin-top:14px">
      <h3 class="card-title">👁 Visibilidade de sub-abas</h3>
      <p class="card-sub">Controle aqui, num só lugar, quem vê cada <b>sub-aba interna</b> (abas dentro de uma página — que não são item de menu). Marque os papéis que podem ver; <b>nenhum marcado = todos veem</b>. O sócio sempre vê tudo. (Os itens de menu ficam na matriz acima.)</p>
      <div id="subaba-editor"><div class="flex items-center gap-2 muted tiny" style="padding:10px 0"><span class="spinner"></span> Carregando…</div></div>
    </div>`;
}

async function initSubAbas() {
  const host = document.getElementById('subaba-editor');
  if (!host) return;
  _resCanEdit = (auth.user()?.lvl || 0) >= 10;
  let perms = {};
  try { perms = await getResourcePerms(true); } catch (_) { perms = {}; }
  _resState = {};
  SUBABA_REGISTRY.forEach(g => g.itens.forEach(([key]) => {
    const list = Array.isArray(perms[key]) ? perms[key] : [];
    _resState[key] = new Set(list.filter(r => r !== '*'));
  }));
  renderSubAbas();
}

function renderSubAbas() {
  const host = document.getElementById('subaba-editor');
  if (!host) return;
  const dis = !_resCanEdit;
  const chip = (key, role, lbl) => {
    const on = (_resState[key] || new Set()).has(role);
    return `<button class="saba-chip${on ? ' on' : ''}" data-saba="${key}" data-role="${role}" ${dis ? 'disabled' : ''} style="${on ? 'background:#2563eb;color:#fff;border-color:#2563eb' : ''}">${escapeHtml(lbl)}</button>`;
  };
  const todos = key => {
    const empty = !(_resState[key] && _resState[key].size);
    return `<button class="saba-chip${empty ? ' on' : ''}" data-saba="${key}" data-role="__todos__" ${dis ? 'disabled' : ''} style="${empty ? 'background:#16a34a;color:#fff;border-color:#16a34a' : ''}">🌐 Todos</button>`;
  };
  host.innerHTML = `
    <style>.saba-chip{font-size:11.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--bd,#cbd5e1);background:var(--bg-2);cursor:pointer;white-space:nowrap}.saba-chip[disabled]{cursor:default;opacity:.7}.saba-row{padding:7px 0;border-top:1px solid var(--bd,#e2e8f0)}</style>
    ${SUBABA_REGISTRY.map(g => `
      <div style="margin-bottom:10px">
        <div style="font-weight:800;font-size:13px;margin:8px 0 2px">${escapeHtml(g.grupo)}</div>
        ${g.itens.map(([key, lbl]) => `
          <div class="saba-row">
            <div style="font-size:12.5px;font-weight:600;margin-bottom:5px">${escapeHtml(lbl)}</div>
            <div class="flex" style="gap:5px;flex-wrap:wrap">
              ${todos(key)}
              ${permRoles().map(([r, rl]) => chip(key, r, rl.replace(/^\S+\s/, ''))).join('')}
            </div>
          </div>`).join('')}
      </div>`).join('')}
    ${_resCanEdit ? '<div class="flex gap-2" style="margin-top:8px"><button class="btn btn-primary" id="saba-save">💾 Salvar visibilidade</button></div>' : '<div class="tiny muted">Só o sócio (lvl 10) edita.</div>'}
  `;
  host.querySelectorAll('[data-saba]').forEach(b => b.addEventListener('click', () => {
    if (dis) return;
    const key = b.dataset.saba, role = b.dataset.role;
    const set = _resState[key] || (_resState[key] = new Set());
    if (role === '__todos__') set.clear();
    else if (set.has(role)) set.delete(role); else set.add(role);
    renderSubAbas();
  }));
  const sv = host.querySelector('#saba-save'); if (sv) sv.onclick = saveSubAbas;
}

async function saveSubAbas() {
  const patch = {};
  SUBABA_REGISTRY.forEach(g => g.itens.forEach(([key]) => {
    const set = _resState[key] || new Set();
    patch[key] = set.size ? [...set] : [];   // vazio = todos veem
  }));
  const btn = document.getElementById('saba-save');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ salvando…'; }
  try {
    await saveResourcePerms(patch);
    if (btn) { btn.textContent = '✅ Salvo!'; setTimeout(() => { const b = document.getElementById('saba-save'); if (b) { b.disabled = false; b.textContent = '💾 Salvar visibilidade'; } }, 1600); }
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar visibilidade'; }
  }
}

// ── Tela inicial por papel (home_routes) — modo inicializador v81.86 ──
function homeRoutesCard() {
  return `
    <div class="card mt-4" id="home-card" style="margin-top:14px">
      <h3 class="card-title">🏠 Tela inicial por papel</h3>
      <p class="card-sub">Em qual tela o sistema <b>abre</b> pra cada papel (modo inicializador). Padrão = <b>Dashboard inicial</b>. Ex.: corretor Conquista pode iniciar direto no <b>Meu Painel</b> ou <b>Cockpit</b> em vez do Dashboard. Vale só quando a pessoa entra na tela inicial (não atrapalha links diretos). O usuário precisa ter <b>permissão</b> de ver a tela escolhida — senão cai no padrão.</p>
      <div id="home-editor"><div class="flex items-center gap-2 muted tiny" style="padding:10px 0"><span class="spinner"></span> Carregando…</div></div>
    </div>`;
}

function _allRouteOpts(selected) {
  const cat = (_permCatalog && _permCatalog.length) ? _permCatalog : buildPermCatalog();
  let opts = `<option value=""${!selected ? ' selected' : ''}>🏠 Dashboard inicial (padrão)</option>`;
  cat.forEach(g => {
    opts += `<optgroup label="${escapeHtml(g.label)}">`;
    g.items.forEach(it => {
      const sel = selected === it.route ? ' selected' : '';
      const lbl = ((it.icon ? it.icon + ' ' : '') + it.label).trim();
      opts += `<option value="${escapeHtml(it.route)}"${sel}>${escapeHtml(lbl)}</option>`;
    });
    opts += `</optgroup>`;
  });
  if (selected && !cat.some(g => g.items.some(it => it.route === selected)))
    opts += `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`;
  return opts;
}

async function initHomeRoutes() {
  const host = document.getElementById('home-editor');
  if (!host) return;
  const canEdit = (auth.user()?.lvl || 0) >= 10;
  try { const r = await api.request('/api/v3/settings/home_routes'); _homeRoutes = (r && r.routes) || {}; } catch (_) { _homeRoutes = {}; }
  const roles = [['socio', '👑 Sócio'], ...permRoles().map(r => [r[0], r[1]])];
  host.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:8px 12px;align-items:center;max-width:580px">
      ${roles.map(([role, lbl]) => `
        <div style="font-size:13px;font-weight:600">${escapeHtml(lbl)}</div>
        <select class="select" data-home-role="${role}" ${canEdit ? '' : 'disabled'}>${_allRouteOpts(_homeRoutes[role] || '')}</select>
      `).join('')}
    </div>
    ${canEdit ? '<div class="flex gap-2" style="margin-top:10px"><button class="btn btn-primary" id="home-save">💾 Salvar tela inicial</button></div>' : '<div class="tiny muted">Só o sócio (lvl 10) edita.</div>'}
  `;
  const sv = host.querySelector('#home-save'); if (sv) sv.onclick = saveHomeRoutes;
}

async function saveHomeRoutes() {
  const patch = {};
  document.querySelectorAll('[data-home-role]').forEach(s => { patch[s.dataset.homeRole] = s.value || ''; });
  const btn = document.getElementById('home-save');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ salvando…'; }
  try {
    await api.request('/api/v3/settings/home_routes', { method: 'POST', body: { routes: patch } });
    // atualiza o cache local do próprio sócio (efeito imediato no próximo boot)
    try {
      Object.entries(patch).forEach(([role, route]) => {
        if (route) localStorage.setItem('psm.v2.home.' + role, route);
        else localStorage.removeItem('psm.v2.home.' + role);
      });
    } catch {}
    if (btn) { btn.textContent = '✅ Salvo!'; setTimeout(() => { const b = document.getElementById('home-save'); if (b) { b.disabled = false; b.textContent = '💾 Salvar tela inicial'; } }, 1600); }
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar tela inicial'; }
  }
}

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
