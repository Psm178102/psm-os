/* ============================================================================
   PSM-OS v2 — Configurações (Connectors, API Keys, Integrações)
   Sprint 7.17
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;
let _reveal = false;

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
}

// Matriz de permissões por papel (espelha ROLE_ALLOWED de main.js — somente leitura)
function permissoesCard() {
  const GRUPOS = [
    ['inicio', '🏠 Início'], ['vendas', '🏘 Imóveis & Vendas'], ['captacoes', '📥 Captações'],
    ['locacao', '🔑 Locação'], ['financeiro', '💰 Financeiro'], ['marketing', '📊 Marketing'],
    ['performance', '🎯 Metas & Performance'], ['diretoria', '🏛 Diretoria'], ['ia', '🤖 IA'],
    ['cultura', '🎓 Cultura'], ['ferramentas', '🧮 Ferramentas'], ['sistema', '⚙️ Sistema'],
  ];
  const PAPEIS = [
    ['Sócio/Diretor', '👑', '*'],
    ['Gerente', '🎯', '*'],
    ['Líder', '🛡️', ['inicio', 'vendas', 'captacoes', 'locacao', 'marketing', 'performance', 'ia', 'cultura', 'ferramentas']],
    ['Back Office', '📋', ['inicio', 'captacoes', 'vendas', 'locacao', 'cultura']],
    ['Financeiro', '💰', ['inicio', 'financeiro', 'cultura']],
    ['Marketing', '📢', ['inicio', 'marketing', 'captacoes', 'cultura']],
    ['Corretor', '🏠', ['inicio', 'vendas', 'captacoes', 'locacao', 'performance', 'ia', 'cultura', 'ferramentas']],
  ];
  const cell = (allow, grp) => {
    const ok = allow === '*' || allow.includes(grp) || grp === 'inicio';
    return `<td style="text-align:center;padding:6px 4px">${ok ? '<span style="color:#16a34a;font-weight:700">✓</span>' : '<span style="color:#cbd5e1">·</span>'}</td>`;
  };
  return `
    <div class="card mt-4" style="margin-top:14px">
      <h3 class="card-title">🔐 Permissões por papel</h3>
      <p class="card-sub">Cada papel vê apenas suas seções no menu. Conta e Início são sempre visíveis. Defina o papel de cada pessoa em <b>Usuários</b>.</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:760px">
          <thead>
            <tr style="border-bottom:2px solid var(--bd,#e5e7eb)">
              <th style="text-align:left;padding:6px 8px">Papel</th>
              ${GRUPOS.map(([, lbl]) => `<th style="padding:6px 4px;font-size:10px;white-space:nowrap">${lbl}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${PAPEIS.map(([nome, ico, allow]) => `
              <tr style="border-bottom:1px solid var(--bd,#eef2f7)">
                <td style="padding:6px 8px;font-weight:600;white-space:nowrap">${ico} ${nome}</td>
                ${GRUPOS.map(([grp]) => cell(allow, grp)).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
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
