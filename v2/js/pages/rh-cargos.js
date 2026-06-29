/* ============================================================================
   PSM-OS v2 — Funções & Organograma (RH) · v81.95
   Organograma de CARGOS por empresa (Conquista / MAP / Locações / Terceiros +
   Grupo PSM). Hover no cargo → Funções, Objetivos e Tarefas (sócio cadastra).
   Cada cargo lista as PESSOAS (foto + bio). Cada login edita sua bio + foto.
   Backend: /api/v3/settings/funcoes_tarefas (cargo{} + perfil{}).
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const EP = '/api/v3/settings/funcoes_tarefas';
const CARGO_LBL = {
  socio: '👑 Sócio/Diretor', diretor: '👑 Sócio/Diretor', lider: '🛡 Líder de Equipe',
  secretaria_vendas: '🗂️ Secretária de Vendas', backoffice: '📋 Back Office', marketing: '📢 Marketing', financeiro: '💰 Financeiro',
  gerente: '🎯 Gerente', gerente_conquista: '🎯 Gerente Conquista', gerente_map: '🎯 Gerente MAP', gerente_locacao: '🎯 Gerente Locação', gerente_terceiros: '🎯 Gerente Terceiros',
  corretor: '🏠 Corretor', corretor_conquista: '🏠 Corretor Conquista', corretor_map: '🗺️ Corretor MAP', corretor_locacao: '🔑 Corretor Locação', corretor_terceiros: '🤝 Corretor Terceiros',
};
const COMPANIES = [
  { nome: 'PSM Conquista', cor: '#f59e0b', cargos: ['gerente_conquista', 'corretor_conquista'] },
  { nome: 'PSM M.A.P', cor: '#a855f7', cargos: ['gerente_map', 'corretor_map'] },
  { nome: 'PSM Locações', cor: '#0891b2', cargos: ['gerente_locacao', 'corretor_locacao'] },
  { nome: 'PSM Terceiros', cor: '#0d9488', cargos: ['gerente_terceiros', 'corretor_terceiros'] },
];
const COMPART = { nome: 'Grupo PSM · Compartilhado', cor: '#7c3aed', cargos: ['socio', 'lider', 'secretaria_vendas', 'backoffice', 'marketing', 'financeiro'] };

let _root = null, _cargo = {}, _perfil = {}, _users = [];
const me = () => auth.user() || {};
const isSocio = () => (me().lvl || 0) >= 10;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cargoLbl = r => CARGO_LBL[r] || ('🏷️ ' + r);
const peopleOf = role => _users.filter(u => (u.status || 'ativo') === 'ativo' && (u.role || '') === role);
const nl2br = s => esc(s).replace(/\n/g, '<br>');

export async function pageRhCargos(ctx, root) {
  _root = root;
  if ((me().lvl || 0) < 2) { root.innerHTML = '<div class="alert alert-warn">🔒 Sem acesso.</div>'; return; }
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const [r, u] = await Promise.all([api.request(EP), api.listUsers().catch(() => ({ users: [] }))]);
    _cargo = r.cargo || {}; _perfil = r.perfil || {}; _users = (u && u.users) || [];
  } catch (e) { root.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; return; }
  render();
}

function avatar(u, size = 34) {
  const p = _perfil[u.id] || {};
  const ini = esc((u.ini || (u.name || '?').slice(0, 2)).toUpperCase());
  if (p.foto) return `<img src="${esc(p.foto)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex:none" alt="">`;
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.36)}px;flex:none">${ini}</div>`;
}

function render() {
  const u = me();
  const myCargo = _cargo[u.role] || {};
  const myP = _perfil[u.id] || {};
  _root.innerHTML = `
    <style>
      .cg-card{position:relative;background:var(--bg-2);border:1px solid var(--bd,#e2e8f0);border-radius:10px;padding:10px;cursor:default}
      .cg-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.12)}
      .cg-pop{display:none;position:absolute;left:0;top:100%;z-index:50;width:300px;background:var(--bg-1,#fff);border:1px solid var(--bd,#cbd5e1);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:11px;margin-top:4px;font-size:12px;line-height:1.45}
      .cg-card:hover .cg-pop{display:block}
      .cg-pop b{color:#0f172a}
      .cg-person{display:flex;align-items:center;gap:6px;font-size:11.5px;position:relative}
      .cg-person .cg-bio{display:none;position:absolute;left:0;top:115%;z-index:60;width:220px;background:#0f172a;color:#fff;border-radius:8px;padding:7px 9px;font-size:11px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
      .cg-person:hover .cg-bio{display:block}
    </style>
    <div class="card">
      <h2 class="card-title">🗂 Funções & Organograma</h2>
      <p class="card-sub">Estrutura de cargos das empresas PSM. <b>Passe o mouse num cargo</b> pra ver Funções, Objetivos e Tarefas${isSocio() ? ' (clique no ✏️ pra editar)' : ''}. Cada pessoa tem foto e bio.</p>
    </div>

    <!-- Meu perfil -->
    <div class="card mt-3">
      <div style="font-weight:800;margin-bottom:8px">👤 Meu perfil</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
        <div style="text-align:center">
          ${avatar(u, 84)}
          <div style="margin-top:6px"><label class="btn btn-ghost btn-sm" style="cursor:pointer">📷 Trocar foto<input type="file" id="cg-foto" accept="image/*" style="display:none"></label></div>
          ${myP.foto ? '<div><button class="btn btn-ghost btn-sm" id="cg-foto-rm" style="color:#dc2626">remover</button></div>' : ''}
        </div>
        <div style="flex:1;min-width:220px">
          <div style="font-weight:700">${esc(u.name || '')} <span class="tiny muted">· ${esc(cargoLbl(u.role))}</span></div>
          <label class="tiny muted" style="display:block;margin-top:6px">Sua bio (texto livre)
            <textarea id="cg-bio" class="input" rows="3" placeholder="Conte um pouco sobre você, sua trajetória, especialidade…">${esc(myP.bio || '')}</textarea></label>
          <button class="btn btn-primary btn-sm mt-2" id="cg-bio-save">💾 Salvar perfil</button>
          <span class="tiny muted" id="cg-msg"></span>
        </div>
        ${(myCargo.funcoes || myCargo.objetivos || myCargo.tarefas) ? `
        <div style="flex:1;min-width:240px;background:var(--bg-3);border-radius:10px;padding:10px;font-size:12px">
          <div style="font-weight:800;margin-bottom:4px">📌 O que se espera do seu cargo</div>
          ${myCargo.funcoes ? `<div><b>Funções:</b> ${nl2br(myCargo.funcoes)}</div>` : ''}
          ${myCargo.objetivos ? `<div style="margin-top:4px"><b>Objetivos:</b> ${nl2br(myCargo.objetivos)}</div>` : ''}
          ${myCargo.tarefas ? `<div style="margin-top:4px"><b>Tarefas:</b> ${nl2br(myCargo.tarefas)}</div>` : ''}
        </div>` : ''}
      </div>
    </div>

    <!-- Organograma por empresa -->
    <div class="card mt-3">
      <div style="font-weight:800;margin-bottom:10px">🌳 Organograma de cargos</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
        ${COMPANIES.map(companyCol).join('')}
      </div>
      <div style="margin-top:14px">${companyCol(COMPART)}</div>
    </div>`;

  // foto upload
  const fi = _root.querySelector('#cg-foto');
  if (fi) fi.addEventListener('change', () => {
    const f = fi.files && fi.files[0]; if (!f) return;
    resizePhoto(f, async dataUrl => {
      try { await api.request(EP, { method: 'POST', body: { action: 'set_perfil', foto: dataUrl } }); _perfil[u.id] = { ...(_perfil[u.id] || {}), foto: dataUrl }; render(); }
      catch (e) { alert('Erro: ' + e.message); }
    });
  });
  const rm = _root.querySelector('#cg-foto-rm');
  if (rm) rm.onclick = async () => { try { await api.request(EP, { method: 'POST', body: { action: 'set_perfil', foto: '' } }); _perfil[u.id] = { ...(_perfil[u.id] || {}), foto: '' }; render(); } catch (e) { alert(e.message); } };
  _root.querySelector('#cg-bio-save').onclick = async () => {
    const bio = _root.querySelector('#cg-bio').value;
    try { await api.request(EP, { method: 'POST', body: { action: 'set_perfil', bio } }); _perfil[u.id] = { ...(_perfil[u.id] || {}), bio: bio.trim() }; _root.querySelector('#cg-msg').textContent = '✅ salvo'; }
    catch (e) { alert('Erro: ' + e.message); }
  };
  // editar cargo (sócio)
  _root.querySelectorAll('[data-edit-cargo]').forEach(b => b.onclick = e => { e.stopPropagation(); openCargoEditor(b.dataset.editCargo); });
}

function companyCol(co) {
  return `
    <div style="border:1px solid var(--bd,#e2e8f0);border-top:3px solid ${co.cor};border-radius:12px;overflow:visible">
      <div style="background:${co.cor}14;padding:8px 12px;font-weight:800;font-size:13px;color:${co.cor};border-radius:9px 9px 0 0">${esc(co.nome)}</div>
      <div style="padding:10px;display:flex;flex-direction:column;gap:10px">
        ${co.cargos.map(cargoCard).join('')}
      </div>
    </div>`;
}

function cargoCard(role) {
  const c = _cargo[role] || {};
  const ppl = peopleOf(role);
  const tem = c.funcoes || c.objetivos || c.tarefas;
  return `
    <div class="cg-card">
      <div class="flex items-center" style="justify-content:space-between;gap:6px">
        <span style="font-weight:700;font-size:12.5px">${esc(cargoLbl(role))}</span>
        <span style="display:flex;align-items:center;gap:4px">
          <span class="tiny muted">${ppl.length}</span>
          ${isSocio() ? `<button class="btn btn-ghost btn-sm" data-edit-cargo="${esc(role)}" title="Editar funções/objetivos/tarefas" style="padding:2px 6px">✏️</button>` : ''}
        </span>
      </div>
      ${ppl.length ? `<div style="display:flex;flex-direction:column;gap:5px;margin-top:7px">${ppl.map(personRow).join('')}</div>` : '<div class="tiny muted" style="margin-top:6px">Ninguém neste cargo.</div>'}
      <div class="tiny" style="margin-top:7px;color:${tem ? '#2563eb' : '#94a3b8'}">${tem ? 'ⓘ passe o mouse pra ver funções/objetivos/tarefas' : 'sem descrição cadastrada'}</div>
      ${tem ? `<div class="cg-pop">
        ${c.funcoes ? `<div><b>📋 Funções</b><br>${nl2br(c.funcoes)}</div>` : ''}
        ${c.objetivos ? `<div style="margin-top:6px"><b>🎯 Objetivos</b><br>${nl2br(c.objetivos)}</div>` : ''}
        ${c.tarefas ? `<div style="margin-top:6px"><b>✅ Tarefas</b><br>${nl2br(c.tarefas)}</div>` : ''}
      </div>` : ''}
    </div>`;
}

function personRow(u) {
  const p = _perfil[u.id] || {};
  return `<div class="cg-person">
    ${avatar(u, 26)}
    <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name || '—')}</span>
    ${p.bio ? `<div class="cg-bio"><b>${esc(u.name)}</b><br>${esc(p.bio)}</div>` : ''}
  </div>`;
}

function openCargoEditor(role) {
  const c = _cargo[role] || {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow:auto';
  ov.innerHTML = `
    <div class="card" style="max-width:560px;width:100%;margin:auto">
      <div class="flex" style="justify-content:space-between;align-items:center"><h3 class="card-title" style="margin:0">✏️ ${esc(cargoLbl(role))}</h3><button class="btn btn-ghost btn-sm" id="ce-x">✕</button></div>
      <p class="tiny muted" style="margin:4px 0 8px">Descrição do cargo — aparece no hover do organograma e no "Meu perfil" de quem ocupa o cargo.</p>
      <label class="tiny muted" style="display:block">📋 Funções (o que faz)<textarea id="ce-func" class="input" rows="3">${esc(c.funcoes || '')}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:6px">🎯 Objetivos (resultados esperados)<textarea id="ce-obj" class="input" rows="3">${esc(c.objetivos || '')}</textarea></label>
      <label class="tiny muted" style="display:block;margin-top:6px">✅ Tarefas (rotina/atividades)<textarea id="ce-tar" class="input" rows="4">${esc(c.tarefas || '')}</textarea></label>
      <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="ce-save">💾 Salvar cargo</button><span class="tiny muted" id="ce-msg"></span></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#ce-x').onclick = () => ov.remove();
  ov.querySelector('#ce-save').onclick = async () => {
    const body = { action: 'set_cargo', role, funcoes: ov.querySelector('#ce-func').value, objetivos: ov.querySelector('#ce-obj').value, tarefas: ov.querySelector('#ce-tar').value };
    try { await api.request(EP, { method: 'POST', body }); _cargo[role] = { funcoes: body.funcoes.trim(), objetivos: body.objetivos.trim(), tarefas: body.tarefas.trim() }; ov.remove(); render(); }
    catch (e) { alert('Erro: ' + e.message); }
  };
}

function resizePhoto(file, cb) {
  const r = new FileReader();
  r.onload = e => {
    const img = new Image();
    img.onload = () => {
      const max = 256; let w = img.width, h = img.height; const s = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => alert('Imagem inválida.');
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}
