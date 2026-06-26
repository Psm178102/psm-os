/* ============================================================================
   PSM-OS v2 — Meu Painel (desenvolvimento individual de TODO usuário)
   Desempenho + Metas (produtividade/resultado) + Perfil + Feedbacks 1:1 + Rotina.
   Para corretor, marketing, adm, financeiro — todos têm painel e metas. v77.50
============================================================================ */
import { api, selectableUsers } from '../api.js';
import { auth } from '../auth.js';
import { mountDev } from './painel-dev.js';

let _root = null;
let _me = null;
let _targetId = null;
let _users = [];
let _data = null;        // { user, profile, feedbacks, can_edit }
let _perf = null;        // overview (só quando alvo = eu)
let _audit = null;

export async function pagePainel(ctx, root) {
  _root = root;
  _me = auth.user();
  _targetId = _me.id;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando seu painel…</div></div>';
  // gestor (lvl≥5) pode acompanhar o painel de qualquer pessoa
  if ((_me.lvl || 0) >= 5) {
    api.request('/api/v3/users/list').then(r => { _users = (r && r.users) || []; renderSelector(); }).catch(() => {});
  }
  await loadTarget(_me.id);
}

async function loadTarget(id) {
  _targetId = id;
  const mine = id === _me.id;
  try {
    const [prof, perf, audit] = await Promise.all([
      api.request('/api/v3/profile/data?user_id=' + encodeURIComponent(id)),
      mine ? api.request('/api/v3/metrics/overview').catch(() => null) : Promise.resolve(null),
      mine ? api.request('/api/v3/audit/list?target_id=' + encodeURIComponent(id) + '&limit=20').catch(() => ({ entries: [] })) : Promise.resolve({ entries: [] }),
    ]);
    _data = prof; _perf = perf; _audit = audit;
    render();
    if (mine) loadFila();
  } catch (e) {
    const msg = e?.message || e?.error || (typeof e === 'string' ? e : JSON.stringify(e));
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(msg)}</div>`;
  }
}

function renderSelector() {
  const sel = document.getElementById('painel-userpick');
  if (!sel || !_users.length) return;
  sel.innerHTML = selectableUsers(_users, _targetId)
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(u => `<option value="${escapeHtml(u.id)}"${u.id === _targetId ? ' selected' : ''}>${escapeHtml(u.name)} · ${escapeHtml(u.role || '')}</option>`)
    .join('');
  sel.onchange = () => loadTarget(sel.value);
}

/* ── 📞 Fila do Dia (Cérebro de Vendas → tarefa) — só no meu próprio painel ── */
async function loadFila() {
  const el = () => document.getElementById('fila-dia');
  if (!el()) return;
  try {
    const r = await api.request('/api/v3/intel/fila_dia?n=10');
    if (!el()) return;
    const fila = r.fila || [];
    if (!fila.length) {
      el().innerHTML = `<div class="muted tiny">Nenhum negócio aberto na sua carteira${r.aviso ? ' — ' + escapeHtml(r.aviso) : ''}.</div>`;
      return;
    }
    const TEMP = { quente: ['#dc2626', '🔥'], morno: ['#d97706', '🌤'], frio: ['#64748b', '❄️'] };
    el().innerHTML = `
      <div class="tiny muted" style="margin-bottom:8px">Os <b>${fila.length}</b> negócios mais quentes da sua carteira (${r.total_abertos} abertos). Comece do topo. 💪</div>
      <div style="display:grid;gap:6px">
        ${fila.map((s, i) => {
          const [c, ico] = TEMP[s.temp] || TEMP.frio;
          return `
          <div style="display:flex;align-items:center;gap:10px;background:var(--bg-3);border-left:4px solid ${c};border-radius:var(--r-md);padding:9px 12px">
            <div style="font-weight:900;color:${c};min-width:54px;text-align:center">${ico} ${s.score}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i + 1}. ${escapeHtml(s.title)}</div>
              <div class="tiny muted">${escapeHtml(s.stage_name || s.ms_label || '')}${s.amount ? ' · R$ ' + fmtKM(s.amount) : ''}${s.dias_parado != null ? ' · parado ' + s.dias_parado + 'd' : ''}</div>
              <div class="tiny" style="color:${c};font-weight:600">👉 ${escapeHtml(s.acao || 'Fazer contato')}</div>
            </div>
            ${s.phone ? `<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="https://wa.me/${escapeHtml(s.phone)}" style="white-space:nowrap">💬 Chamar</a>` : '<span class="tiny muted">s/ fone</span>'}
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://crm.rdstation.com/deals/${encodeURIComponent(s.id)}" title="Abrir no RD">🔗</a>
          </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    if (el()) el().innerHTML = `<div class="tiny muted">Fila indisponível agora.</div>`;
  }
}

function render() {
  const u = _data.user || {};
  const p = _data.profile || {};
  const mine = _targetId === _me.id;
  const canEdit = !!_data.can_edit;
  const isMgr = (_me.lvl || 0) >= 5;
  // Corretor (qualquer tipo) tem um Meu Perfil enxuto: sem Metas do colaborador,
  // Rotina, Feedbacks 1:1, Fila do Dia, Comissões e Atividade recente. O GESTOR que
  // abre o painel de um corretor continua vendo tudo (visão de 1:1). v81.41
  const hideForCorretor = (_me.role || '').toLowerCase().startsWith('corretor');
  const ini = escapeHtml((u.ini || (u.name || '?').substring(0, 2)).toUpperCase());
  const d = _perf || {};

  _root.innerHTML = `
    <div class="card">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--border)">
        <div style="width:64px;height:64px;border-radius:var(--r-md);background:${u.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:24px">${ini}</div>
        <div style="flex:1;min-width:200px">
          <h2 class="card-title" style="margin:0">${escapeHtml(u.name || '')}${mine ? '' : ' <span class="tiny muted">(painel do colaborador)</span>'}</h2>
          <div class="muted tiny">${escapeHtml(u.email || '')} · ${escapeHtml(u.role || '')} · ${escapeHtml(u.team || 'Geral')}</div>
          <div class="tiny" style="margin-top:4px">
            ${p.data_inicio ? `<span style="color:var(--info)">📅 Na PSM desde ${fmtDate(p.data_inicio)} · ${tempoCasa(p.data_inicio)}</span>` : '<span class="muted">📅 Data de início na PSM não preenchida</span>'}
          </div>
        </div>
        ${isMgr ? `<div style="min-width:220px">
          <label class="tiny muted">👁 Ver painel de</label>
          <select id="painel-userpick" class="select"><option value="${escapeHtml(_me.id)}">${escapeHtml(_me.name)} (eu)</option></select>
        </div>` : ''}
      </div>

      ${_data.pending ? `<div class="alert alert-warn mt-3">⚠️ Tabela do perfil ainda não criada — rode <code>supabase/sprint_user_profile.sql</code>. As metas/perfil não vão salvar até lá.</div>` : ''}

      ${mine ? renderPerf(d) : `
        <div class="mt-4" style="background:var(--bg-3);border-radius:var(--r-md);padding:14px">
          <div class="tiny muted">Números de produtividade e vendas deste colaborador ficam no cockpit individual.</div>
          <a class="btn btn-ghost mt-2" href="#/one-on-one">📊 Abrir cockpit individual (One-on-One)</a>
        </div>`}

      <!-- ===== DESENVOLVIMENTO INDIVIDUAL (teste, rotina semanal, metas, PDF) ===== -->
      <h3 class="card-title mt-4">🌟 Desenvolvimento Individual</h3>
      <div id="dev-extra"></div>

      <!-- ===== FUNÇÕES & TAREFAS do colaborador (cargo + login) ===== -->
      <h3 class="card-title mt-4">📋 Funções & Tarefas</h3>
      <div id="painel-funcoes"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>

      <!-- ===== METAS (produtividade + resultado) — oculto p/ corretor ===== -->
      ${hideForCorretor ? '' : `
      <h3 class="card-title mt-4">🎯 Metas do colaborador</h3>
      <div class="painel-grid">
        ${field('meta_produtividade', '⚡ Meta de PRODUTIVIDADE (atividades)', p.meta_produtividade, canEdit, 'Ex.: 30 ligações/dia · 8 visitas/semana · 12 reels/mês…')}
        ${field('meta_resultado', '🏁 Meta de RESULTADO (output)', p.meta_resultado, canEdit, 'Ex.: R$ X de VGV/mês · 200 leads · CPL < R$ Y · N contratos…')}
        ${field('metas_pessoais', '🌱 Metas pessoais', p.metas_pessoais, canEdit, 'Objetivos pessoais e de carreira…')}
      </div>`}

      <!-- ===== PERFIL & VÍNCULO ===== -->
      <h3 class="card-title mt-4">🧬 Perfil & vínculo</h3>
      <div class="painel-grid">
        <div>
          <label class="tiny muted">📅 Data de início na PSM</label>
          <input id="pf-data_inicio" class="input" type="date" value="${p.data_inicio ? String(p.data_inicio).substring(0,10) : ''}" ${canEdit ? '' : 'disabled'}>
          <label class="tiny muted" style="margin-top:8px;display:block">📄 Contrato de vínculo (link)</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input id="pf-contrato_url" class="input" type="url" value="${escapeHtml(p.contrato_url || '')}" placeholder="Drive / URL do contrato" style="flex:1;min-width:0" ${canEdit ? '' : 'disabled'}>
            <a id="pf-contrato_url-go" href="${/^https?:\/\//i.test(p.contrato_url || '') ? escapeHtml(p.contrato_url) : '#'}" target="_blank" rel="noopener" title="Abrir contrato"
               style="text-decoration:none;font-size:17px;padding:6px 8px;border-radius:8px;background:rgba(59,130,246,.12);${/^https?:\/\//i.test(p.contrato_url || '') ? '' : 'display:none'}">🔗</a>
          </div>
        </div>
        ${field('perfil_comportamental', '🧭 Perfil comportamental', p.perfil_comportamental, canEdit, 'DISC / eneagrama / pontos fortes / como gosta de ser liderado…', 4)}
      </div>

      <!-- ===== ACOMPANHAMENTO ===== -->
      <h3 class="card-title mt-4">📌 Acompanhamento</h3>
      <div class="painel-grid">
        ${field('pontos_atencao', '⚠️ Pontos de atenção', p.pontos_atencao, canEdit, 'O que precisa melhorar / observar…')}
        ${hideForCorretor ? '' : field('rotina', '🗓 Rotina', p.rotina, canEdit, 'Rotina padrão (horários, blocos, rituais)…')}
      </div>

      ${canEdit ? `<div class="flex gap-2 mt-3" style="align-items:center">
        <button class="btn btn-primary" id="pf-save">💾 Salvar painel</button>
        <span id="pf-status" class="tiny muted"></span>
      </div>` : '<div class="tiny muted mt-3">Você não tem permissão para editar este painel.</div>'}

      <!-- ===== FEEDBACKS 1:1 — oculto p/ corretor ===== -->
      ${hideForCorretor ? '' : `
      <h3 class="card-title mt-4">💬 Feedbacks do One-on-One</h3>
      ${renderFeedbacks(_data.feedbacks || [])}`}

      ${mine && !hideForCorretor ? `
      <!-- Fila + comissões + tarefas + atividade (só meu painel) -->
      <h3 class="card-title mt-4">📞 Sua Fila do Dia</h3>
      <div id="fila-dia"><div class="muted tiny"><span class="spinner"></span> Montando suas ligações de hoje…</div></div>

      <h3 class="card-title mt-4">💎 Suas comissões</h3>
      ${(d.commissions?.count || 0) > 0 ? `
        <div class="flex gap-3" style="flex-wrap:wrap">
          ${kpi('# Comissões', d.commissions.count)}
          ${kpi('Pagas', d.commissions.pagas, '#16a34a')}
          ${kpi('Pendentes', d.commissions.pendentes, '#d97706')}
          ${kpi('Valor total', 'R$ ' + fmtMoney(d.commissions.valor_total))}
          ${kpi('Valor pendente', 'R$ ' + fmtMoney(d.commissions.valor_pendente), '#d97706')}
        </div>` : '<div class="muted tiny">Nenhuma comissão registrada ainda.</div>'}

      <h3 class="card-title mt-4">📜 Sua atividade recente</h3>
      ${(_audit?.entries || []).length ? `
        <div style="display:grid;gap:6px;max-height:340px;overflow-y:auto">
          ${_audit.entries.map(e => activityRow(e, _me.id)).join('')}
        </div>` : '<div class="muted tiny">Nenhuma atividade registrada ainda.</div>'}
      ` : ''}
    </div>

    <style>
      .painel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
      .painel-fld textarea{width:100%;resize:vertical}
    </style>
  `;

  // selector (caso a lista já tenha chegado)
  renderSelector();

  // link do contrato ao vivo
  const cf = document.getElementById('pf-contrato_url');
  const cg = document.getElementById('pf-contrato_url-go');
  if (cf && cg) cf.addEventListener('input', () => {
    const ok = /^https?:\/\//i.test(cf.value.trim());
    cg.href = ok ? cf.value.trim() : '#'; cg.style.display = ok ? '' : 'none';
  });

  // salvar
  const sv = document.getElementById('pf-save');
  if (sv) sv.addEventListener('click', save);

  // 🌟 Desenvolvimento individual (teste comportamental + rotina planner + metas + PDF)
  const devEl = document.getElementById('dev-extra');
  if (devEl) mountDev(devEl, { uid: _targetId, canEdit: !!_data.can_edit, conquista: (_me.role || '').toLowerCase() === 'corretor_conquista' }).catch(() => {});

  // 📋 Funções & Tarefas do colaborador (cargo + login) — marca como feito só no meu painel
  loadPainelFuncoes(_targetId, _targetId === _me.id);
}

async function loadPainelFuncoes(uid, canCheck) {
  const host = document.getElementById('painel-funcoes');
  if (!host) return;
  let data;
  try { data = await api.request('/api/v3/settings/funcoes_tarefas?user_id=' + encodeURIComponent(uid)); }
  catch { host.innerHTML = '<div class="tiny muted">—</div>'; return; }
  const items = (data && data.items) || [];
  const checked = (data && data.checked) || {};
  if (!items.length) {
    host.innerHTML = '<div class="tiny muted">Nenhuma função/tarefa cadastrada. O sócio define em <b>Meu Perfil → Funções e Tarefas</b> por cargo e por login.</div>';
    return;
  }
  const done = items.filter(it => checked[it.id]).length;
  host.innerHTML = `
    <div class="tiny muted" style="margin-bottom:6px"><b>${done}/${items.length}</b> concluídos · cargo + login</div>
    <div>${items.map(it => `
      <label style="display:flex;gap:9px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--border,#e2e8f0);${canCheck ? 'cursor:pointer' : ''}">
        <input type="checkbox" data-pf-toggle="${escapeHtml(it.id)}" ${checked[it.id] ? 'checked' : ''} ${canCheck ? '' : 'disabled'} style="margin-top:3px;width:16px;height:16px;flex:none">
        <span style="font-size:13.5px;${checked[it.id] ? 'text-decoration:line-through;opacity:.55' : ''}">${escapeHtml(it.txt)}</span>
      </label>`).join('')}</div>`;
  if (canCheck) host.querySelectorAll('[data-pf-toggle]').forEach(cb => cb.addEventListener('change', async () => {
    try { await api.request('/api/v3/settings/funcoes_tarefas', { method: 'POST', body: { action: 'toggle', itemId: cb.dataset.pfToggle, done: cb.checked } }); loadPainelFuncoes(uid, canCheck); }
    catch (e) { cb.checked = !cb.checked; alert('Erro: ' + e.message); }
  }));
}

function renderPerf(d) {
  return `
    <h3 class="card-title mt-4">💰 Seu Desempenho do Mês</h3>
    <div class="flex gap-3" style="flex-wrap:wrap">
      ${kpi('🏆 Vendas', d.sales?.vendas_mes || 0, '#16a34a')}
      ${kpi('💰 VGV', 'R$ ' + fmtKM(d.sales?.vgv_mes || 0), '#16a34a')}
      ${kpi('🎯 Meta VGV', 'R$ ' + fmtKM(d.metas?.meta_vgv || 0), '#d4a843')}
      ${kpi('📊 Atingimento', pctMeta(d.sales?.vgv_mes, d.metas?.meta_vgv), pctColor(d.sales?.vgv_mes, d.metas?.meta_vgv))}
      ${kpi('📈 Pipeline', 'R$ ' + fmtKM(d.sales?.pipeline_vgv || 0), '#3b82f6')}
      ${kpi('💎 VGV no Ano', 'R$ ' + fmtKM(d.sales?.vgv_ano || 0), '#0891b2')}
    </div>`;
}

function field(id, label, val, canEdit, ph, rows) {
  return `
    <div class="painel-fld">
      <label class="tiny muted">${label}</label>
      <textarea id="pf-${id}" class="input" rows="${rows || 3}" placeholder="${escapeHtml(ph || '')}" ${canEdit ? '' : 'disabled'}>${escapeHtml(val || '')}</textarea>
    </div>`;
}

function renderFeedbacks(fb) {
  if (!fb.length) return '<div class="muted tiny">Nenhum One-on-One registrado ainda. As conversas de feedback aparecem aqui.</div>';
  return `<div style="display:grid;gap:8px">${fb.map(f => {
    const acoes = Array.isArray(f.acoes) ? f.acoes : [];
    return `
    <div style="background:var(--bg-3);border-radius:var(--r-md);padding:11px 13px;border-left:3px solid var(--info)">
      <div class="flex" style="justify-content:space-between;align-items:center;gap:8px">
        <b style="font-size:13px">${fmtDate(f.data)}</b>
        <span class="tiny muted">${f.lider_nome ? 'com ' + escapeHtml(f.lider_nome) : ''}${f.proxima_data ? ' · próx: ' + fmtDate(f.proxima_data) : ''}</span>
      </div>
      ${f.observacoes ? `<div class="tiny" style="margin-top:6px;white-space:pre-wrap">${escapeHtml(f.observacoes)}</div>` : ''}
      ${acoes.length ? `<ul class="tiny" style="margin:6px 0 0;padding-left:18px">${acoes.map(a => `<li>${escapeHtml(typeof a === 'string' ? a : (a.texto || a.label || JSON.stringify(a)))}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('')}</div>
  <a href="#/one-on-one" class="tiny mt-2" style="display:inline-block">Ver One-on-One completo →</a>`;
}

async function save() {
  const sv = document.getElementById('pf-save');
  const st = document.getElementById('pf-status');
  const g = id => document.getElementById('pf-' + id);
  const prof = _data.profile || {};
  // Campos ocultos (ex.: corretor não vê Metas/Rotina) podem não estar no DOM —
  // preserva o valor que já estava salvo em vez de apagar. v81.41
  const val = id => { const el = g(id); return el ? el.value.trim() : (prof[id] || ''); };
  const body = {
    user_id: _targetId,
    data_inicio: (g('data_inicio') ? g('data_inicio').value : prof.data_inicio) || null,
    contrato_url: val('contrato_url'),
    perfil_comportamental: val('perfil_comportamental'),
    meta_produtividade: val('meta_produtividade'),
    meta_resultado: val('meta_resultado'),
    metas_pessoais: val('metas_pessoais'),
    pontos_atencao: val('pontos_atencao'),
    rotina: val('rotina'),
  };
  sv.disabled = true; if (st) st.textContent = 'Salvando…';
  try {
    await api.request('/api/v3/profile/data', { method: 'POST', body });
    if (st) { st.textContent = '✓ Salvo'; st.style.color = '#16a34a'; }
    // reflete no header (tempo de casa) sem recarregar tudo
    if (_data.profile) Object.assign(_data.profile, body);
  } catch (e) {
    if (st) { st.textContent = 'Erro: ' + e.message; st.style.color = '#dc2626'; }
  } finally {
    sv.disabled = false;
    setTimeout(() => { if (st) { st.textContent = ''; st.style.color = ''; } }, 4000);
  }
}

/* ── helpers ── */
function tempoCasa(dateStr) {
  const d = new Date(dateStr); if (isNaN(d)) return '';
  const meses = Math.max(0, Math.floor((Date.now() - d.getTime()) / (30.44 * 86400000)));
  if (meses < 1) return 'recém-chegado';
  if (meses < 12) return meses + (meses === 1 ? ' mês' : ' meses') + ' de casa';
  const anos = Math.floor(meses / 12), rm = meses % 12;
  return anos + (anos === 1 ? ' ano' : ' anos') + (rm ? ' e ' + rm + 'm' : '') + ' de casa';
}
function fmtDate(s) { return s ? String(s).substring(0, 10).split('-').reverse().join('/') : '—'; }
function pctMeta(real, meta) { if (!meta || meta <= 0) return '—'; return pct2((real || 0) / meta * 100); }
function pct2(v){ return v==null?'—':(Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'; }
function pctColor(real, meta) { if (!meta || meta <= 0) return 'var(--muted)'; const p = (real || 0) / meta; return p >= 1 ? '#16a34a' : p >= 0.7 ? '#f59e0b' : '#dc2626'; }
function fmtKM(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function kpi(label, value, color) {
  return `<div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:140px"><div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div><div style="font-size:20px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div></div>`;
}
function activityRow(e, myId) {
  const ts = new Date(e.ts).toLocaleString('pt-BR');
  const who = e.actor_id === myId ? `<b>Você</b>` : `<b>${escapeHtml(e.actor_name || e.actor_id || 'sistema')}</b>`;
  return `<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px"><code style="font-size:11px;color:var(--info);align-self:center">${escapeHtml(e.action || '')}</code><div>${who}${e.notes ? ' · <span class="muted">' + escapeHtml(e.notes) + '</span>' : ''}</div><span class="tiny muted">${ts}</span></div>`;
}
function fmtMoney(n) { if (n == null) return '0,00'; return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
