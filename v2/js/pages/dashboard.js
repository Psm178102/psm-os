/* ============================================================================
   PSM-OS v2 — Dashboard (cockpit executivo, role-based)
   Porta de entrada: KPIs reais de vendas/meta/pipeline + ranking de vendas do
   mês (dado real do RD via OO) + comissões. Sem ruído de sistema/dev.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { pageAgenda } from './agenda.js';

/* A AGENDA MORA AQUI (v84.56). A rota '/' é a única que todo mundo tem — é a
   tela de pouso garantida do router. Enquanto a Agenda vivia só em /agenda,
   ela não tinha link no menu NEM entrada na matriz de permissão, então a
   equipe simplesmente não chegava nela — e o "Conectar meu Zoho" mora lá.
   Trazendo pra cá, todo mundo enxerga sem depender de permissão nenhuma.
   Monta depois do 1º paint pra não atrasar o dashboard (que é cacheado). */
async function montarAgenda() {
  const host = document.getElementById('dash-agenda');
  if (!host) return;
  try {
    await pageAgenda({}, host);
  } catch (e) {
    host.innerHTML = `<div class="card"><b>Não consegui carregar a agenda.</b>
      <div class="tiny muted mt-1">${escapeHtml(e.message || e)}</div>
      <a href="#/agenda" class="btn btn-ghost btn-sm mt-2">Abrir a Agenda em tela cheia</a></div>`;
  }
}

const SCOPE_LBL = {
  global: '👁 Visão global (Sócio/Gerente)',
  team:   '👥 Sua equipe (Líder)',
  self:   '👤 Seus dados',
};

// rótulos das frentes (Central de Frentes) pro breakdown do pipeline
const FRENTE_LBL = { conquista: '🏆 Conquista', map: '🏠 MAP', terceiros: '🔁 Terceiros',
  locacoes: '🔑 Locação', outros: '📦 Outros' };

let _root = null;
let _data = null;
let _board = null; // ranking de vendas (gestores)
let _feed = [];        // central do usuário (agenda + tarefas + tudo)
let _feedCounts = {};
let _feedProd = {};    // produtividade (concluídas/solicitadas/atrasadas)
let _feedRole = '';    // cargo (corretor é exceção da produtividade)
let _plOffset = 0;     // mês do planner (0 = atual)
let _conclForms = {};  // campos obrigatórios por tipo ao concluir (config editável)
let _filterOrig = '';  // filtro de origem na lista de pendências
let _pendView = 'kanban';  // 'kanban' (diário/semanal/mensal) | 'lista'
let _pendLimit = 50;       // quantos itens por página na lista
// tipos que podem ser concluídos direto do Home (os demais abrem a aba)
const CONCLUDABLE = { tarefa: 1, plantao: 1, criativo: 1, conteudo: 1, captacao: 1 };

// ── Criar tarefa (pra si ou pra equipe, conforme hierarquia) ──
let _taskModal = false;   // modal aberto?
let _taskUsers = null;    // lista de usuários (lazy)
let _taskBusy = false;    // salvando?
let _taskMsg = '';        // feedback
let _taskEditing = null;  // tarefa em edição (null = nova). v81.84
const ROLE_LVL = { socio: 10, diretor: 10, gerente: 7, backoffice: 6, lider: 5, financeiro: 4, marketing: 3, corretor: 2 };
const lvlDe = u => (ROLE_LVL[String((u && u.role) || '').toLowerCase()] || 2);

// Quem o usuário atual pode atribuir (mesma regra do backend _pode_atribuir):
// sócio(≥10)→todos · gerente(≥7)→lvl<7 · líder(≥5)→própria equipe lvl<5 · demais→só si.
function allowedAssignees() {
  const me = auth.user() || {};
  const lvl = me.lvl || ROLE_LVL[String(me.role || '').toLowerCase()] || 2;
  const team = String(me.team || '').trim().toLowerCase();
  const ativos = (_taskUsers || []).filter(u => (u.status || 'ativo') === 'ativo');
  let list;
  if (lvl >= 10) list = ativos;
  else if (lvl >= 7) list = ativos.filter(u => lvlDe(u) < 7);
  else if (lvl >= 5) list = ativos.filter(u => String(u.team || '').trim().toLowerCase() === team && lvlDe(u) < 5);
  else list = [];
  list = list.filter(u => u.id !== me.id).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return [{ id: me.id, name: (me.name || 'Eu') + ' (você)' }, ...list];
}

async function openTaskModal(task) {
  _taskEditing = task || null;   // se vier um item de tarefa do feed → modo edição
  _taskModal = true; _taskMsg = '';
  render();
  if (!_taskUsers) {
    try { const r = await api.listUsers(); _taskUsers = (r && r.users) || []; }
    catch { _taskUsers = []; }
    if (_taskModal) render();
  }
}

async function saveNewTask() {
  if (_taskBusy) return;
  const g = id => document.getElementById(id);
  const titulo = (g('nt-tit')?.value || '').trim();
  if (!titulo) { _taskMsg = '⚠️ Título é obrigatório.'; render(); return; }
  const me = auth.user() || {};
  const ed = _taskEditing;
  const body = {
    titulo,
    descricao: (g('nt-desc')?.value || '').trim() || null,
    observacoes: (g('nt-obs')?.value || '').trim() || null,
    prioridade: g('nt-prio')?.value || 'media',
    prazo: g('nt-prazo')?.value || null,
    hora_inicio: g('nt-hini')?.value || null,
    hora_fim: g('nt-hfim')?.value || null,
    responsavel: g('nt-resp')?.value || me.id,
    categoria: (g('nt-cat')?.value || '').trim() || null,
  };
  if (ed && ed.id) body.id = ed.id; else body.status = 'aberta';
  _taskBusy = true; _taskMsg = ed && ed.id ? '⏳ salvando…' : '⏳ criando…'; render();
  try {
    await api.request('/api/v3/tasks/upsert', { method: 'POST', body });
    const f = await api.request('/api/v3/tasks/feed').catch(() => null);
    if (f) { _feed = f.items || _feed; _feedCounts = f.counts || _feedCounts; _feedProd = f.prod || _feedProd; }
    _taskBusy = false; _taskModal = false; _taskMsg = ''; _taskEditing = null;
    render();
    if (ed && ed.id) { _toast('✅ Tarefa atualizada.'); return; }
    const paraOutro = body.responsavel && body.responsavel !== me.id;
    if (paraOutro) {
      const nome = (allowedAssignees().find(u => u.id === body.responsavel) || {}).name || 'o responsável';
      _toast(`✅ Tarefa criada e atribuída a ${nome.replace(' (você)', '')} (ele(a) foi notificado).`);
    } else _toast('✅ Tarefa criada na sua lista.');
  } catch (e) {
    _taskBusy = false; _taskMsg = '⚠️ ' + (e.message || 'erro ao salvar'); render();
  }
}

async function deleteTask() {
  if (!_taskEditing || !_taskEditing.id || _taskBusy) return;
  if (!confirm('Excluir esta tarefa? Não dá pra desfazer.')) return;
  _taskBusy = true; _taskMsg = '⏳ excluindo…'; render();
  try {
    await api.request('/api/v3/tasks/delete', { method: 'POST', body: { id: _taskEditing.id } });
    const f = await api.request('/api/v3/tasks/feed').catch(() => null);
    if (f) { _feed = f.items || _feed; _feedCounts = f.counts || _feedCounts; _feedProd = f.prod || _feedProd; }
    _taskBusy = false; _taskModal = false; _taskMsg = ''; _taskEditing = null;
    render(); _toast('🗑️ Tarefa excluída.');
  } catch (e) { _taskBusy = false; _taskMsg = '⚠️ ' + (e.message || 'erro ao excluir'); render(); }
}

function _toast(msg) {
  try {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:11px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 8px 28px rgba(0,0,0,.3);max-width:90vw';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  } catch { /* noop */ }
}

function taskModalHTML() {
  const ed = _taskEditing;                  // tarefa em edição (ou null = nova)
  const sel = id => id && ed && ed.responsavel === id ? ' selected' : '';
  const opts = allowedAssignees().map(u => `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name)}</option>`).join('');
  const loading = _taskUsers === null;
  const hoje = _todayBRT();
  const prio = (ed && ed.prioridade) || 'media';
  const podeExcluir = ed && ed.id && (auth.user()?.lvl || 0) >= 10;
  return `
  <div class="tl-overlay" data-nt-close="1" style="position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 14px;overflow:auto">
    <div class="card" style="max-width:480px;width:100%;margin:0" onclick="event.stopPropagation()">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 class="card-title" style="margin:0">${ed && ed.id ? '✏️ Editar tarefa' : '➕ Nova tarefa'}</h3>
        <button class="btn btn-ghost btn-sm" data-nt-close="1">✕</button>
      </div>
      <label class="tiny muted">Título *</label>
      <input id="nt-tit" class="input" placeholder="Ex.: Ligar para o cliente X" style="margin-bottom:9px" value="${escapeHtml((ed && ed.titulo) || '')}" autofocus>
      <label class="tiny muted">Responsável</label>
      <select id="nt-resp" class="input" style="margin-bottom:9px" ${loading ? 'disabled' : ''}>
        ${loading ? '<option>⏳ carregando equipe…</option>' : opts}
      </select>
      <div class="flex gap-2" style="margin-bottom:9px">
        <div style="flex:1">
          <label class="tiny muted">Prioridade</label>
          <select id="nt-prio" class="input">
            <option value="baixa"${prio === 'baixa' ? ' selected' : ''}>🟢 Baixa</option>
            <option value="media"${prio === 'media' ? ' selected' : ''}>🟡 Média</option>
            <option value="alta"${prio === 'alta' ? ' selected' : ''}>🔴 Alta</option>
          </select>
        </div>
        <div style="flex:1">
          <label class="tiny muted">Prazo (data)</label>
          <input id="nt-prazo" type="date" class="input" value="${escapeHtml((ed && ed.data) || '')}">
        </div>
      </div>
      <div class="flex gap-2" style="margin-bottom:9px">
        <div style="flex:1">
          <label class="tiny muted">Hora início</label>
          <input id="nt-hini" type="time" class="input" value="${escapeHtml((ed && ed.hora_inicio) || '')}">
        </div>
        <div style="flex:1">
          <label class="tiny muted">Hora fim</label>
          <input id="nt-hfim" type="time" class="input" value="${escapeHtml((ed && ed.hora_fim) || '')}">
        </div>
      </div>
      <label class="tiny muted">Categoria (opcional)</label>
      <input id="nt-cat" class="input" placeholder="Ex.: Vendas, Follow-up…" style="margin-bottom:9px" value="${escapeHtml((ed && ed.categoria) || '')}">
      <label class="tiny muted">Descrição (opcional)</label>
      <textarea id="nt-desc" class="input" rows="3" placeholder="Detalhes da tarefa…" style="margin-bottom:9px">${escapeHtml((ed && (ed.descricao || ed.sub)) || '')}</textarea>
      <label class="tiny muted">Observações / comentário</label>
      <textarea id="nt-obs" class="input" rows="2" placeholder="Andamento, comentário, nota…" style="margin-bottom:6px">${escapeHtml((ed && ed.observacoes) || '')}</textarea>
      ${_taskMsg ? `<div class="tiny" style="margin-bottom:8px;color:${_taskMsg[0] === '⚠' ? '#dc2626' : '#64748b'}">${escapeHtml(_taskMsg)}</div>` : ''}
      <div class="flex gap-2" style="align-items:center;margin-top:4px">
        ${podeExcluir ? '<button class="btn btn-ghost" data-nt-delete="1" style="color:#dc2626">🗑️ Excluir</button>' : ''}
        <button class="btn btn-ghost" data-nt-close="1" style="margin-left:auto">Cancelar</button>
        <button class="btn btn-primary" data-nt-save="1" ${_taskBusy ? 'disabled' : ''}>${_taskBusy ? '⏳…' : (ed && ed.id ? '💾 Salvar' : '✅ Criar tarefa')}</button>
      </div>
      <div class="tiny muted" style="margin-top:8px">💡 Você pode atribuir a si mesmo ou a quem está sob sua gestão. Quem recebe é notificado.</div>
    </div>
  </div>`;
}

export async function pageDashboard(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando seu painel…</div></div>';
  const isGestor = (auth.user()?.lvl || 0) >= 5;
  try {
    const calls = [
      api.request('/api/v3/metrics/overview'),
      api.request('/api/v3/tasks/feed').catch(() => ({ items: [], counts: {} })),
      api.request('/api/v3/settings/conclusao_forms').catch(() => ({ forms: {} })),
    ];
    // Ranking de vendas real (mês) — só gestor (o endpoint exige lvl>=5)
    if (isGestor) calls.push(api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null));
    const res = await Promise.all(calls);
    const d = res[0], f = res[1], cf = res[2], oo = isGestor ? res[3] : null;
    _data = d;
    _feed = (f && f.items) || [];
    _feedCounts = (f && f.counts) || {};
    _feedProd = (f && f.prod) || {};
    _feedRole = (f && f.role) || (auth.user()?.role) || '';
    _conclForms = (cf && cf.forms) || {};
    _board = oo;
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  }
}

function _todayBRT() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }

/* ═══ PLANO DO MÊS — cockpit pessoal (metas + produtividade + planner + 4W) ═══ */
const ORIG_COR = { 'Tarefa': '#2563eb', 'Agenda': '#0891b2', 'Academy': '#7c3aed', 'Projeto': '#f59e0b', 'Captação': '#16a34a', 'One-on-One': '#d6249f', 'Plantão': '#64748b', 'Criativo': '#db2777', 'Conteúdo': '#9333ea' };
const corOrigem = o => ORIG_COR[o] || '#64748b';
const _ymOffset = off => { const n = new Date(Date.now() - 3 * 3600 * 1000); return new Date(n.getFullYear(), n.getMonth() + off, 1); };

const PLANNER_CSS = `<style>
/* cabeçalho de card do cockpit */
.ck-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.ck-title{font-size:16px;font-weight:800;margin:0;display:flex;align-items:center;gap:7px}
.ck-spacer{flex:1}
.ck-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;white-space:nowrap}
/* lista executiva — O QUE / QUANDO / COMO / QUEM */
.exec-wrap{overflow-x:auto;border:1px solid var(--bd);border-radius:12px}
.exec-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.exec-tbl thead th{text-align:left;padding:10px 12px;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-muted,#94a3b8);background:var(--bg-3);font-weight:800;white-space:nowrap}
.exec-tbl td{padding:9px 12px;border-top:1px solid var(--bd);vertical-align:top}
.exec-tbl tbody tr{transition:background .15s}
.exec-tbl tbody tr:hover{background:var(--bg-3)}
.exec-task{font-weight:700;text-decoration:none;color:inherit;display:flex;align-items:center;gap:6px}
.exec-origin{display:inline-block;font-size:9.5px;font-weight:800;padding:1px 8px;border-radius:999px;margin-top:4px}
.exec-when{font-weight:800;font-size:12px;white-space:nowrap}
.exec-sub{font-size:12px;color:var(--ink-muted,#64748b);max-width:320px}
.exec-quem{font-size:12px;font-weight:600;white-space:nowrap}
.exec-done{width:28px;height:28px;border-radius:8px;border:1.5px solid #16a34a;background:transparent;color:#16a34a;font-weight:900;cursor:pointer;line-height:1;transition:all .12s}
.exec-done:hover{background:#16a34a;color:#fff}
.exec-filtros{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.exec-fchip{font-size:11px;font-weight:700;padding:4px 11px;border-radius:999px;border:1px solid var(--bd);background:transparent;color:var(--ink-muted,#64748b);cursor:pointer}
.exec-fchip.on{background:var(--c);border-color:var(--c);color:#fff}
/* banner bom-dia */
.bomdia{background:linear-gradient(135deg,#1e293b,#334155);color:#fff;border-radius:12px;padding:12px 16px;font-size:13.5px;font-weight:600;margin-bottom:12px}
.bomdia.ok{background:linear-gradient(135deg,#14532d,#16a34a)}
/* toggle lista/kanban */
.ck-toggle{display:inline-flex;border:1px solid var(--bd);border-radius:8px;overflow:hidden}
.ck-toggle button{border:0;background:transparent;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;color:var(--ink-muted,#64748b)}
.ck-toggle button.on{background:#2563eb;color:#fff}
/* kanban de pendências */
.kb-board{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 8px;align-items:flex-start}
.kb-col{flex:0 0 250px;background:var(--bg-3);border-radius:12px;padding:10px}
.kb-col-h{font-size:12.5px;font-weight:800;display:flex;align-items:center;gap:6px;margin-bottom:8px}
.kb-n{margin-left:auto;background:rgba(148,163,184,.25);color:var(--ink,#475569);font-size:11px;padding:1px 8px;border-radius:999px}
.kb-col-body{display:flex;flex-direction:column;gap:7px}
.kb-card{background:var(--bg-1,#fff);border:1px solid var(--bd);border-radius:9px;padding:9px 10px}
.kb-t{font-weight:700;font-size:12.5px;text-decoration:none;color:inherit;line-height:1.25}
.kb-card .exec-done{width:24px;height:24px;border-radius:6px;font-size:13px;flex:0 0 auto}
/* gauges (% meta / % produtividade) */
.gz{flex:1;min-width:230px;background:var(--bg-1,#fff);border:1px solid var(--bd);border-radius:14px;padding:15px 17px}
.gz-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.gz-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:800;color:var(--ink-muted,#94a3b8)}
.gz-pct{font-size:28px;font-weight:900;line-height:1}
.gz-track{height:10px;border-radius:6px;background:rgba(148,163,184,.18);overflow:hidden;margin-top:10px}
.gz-fill{height:100%;border-radius:6px;transition:width .4s}
.gz-sub{font-size:11px;color:var(--ink-muted,#94a3b8);margin-top:7px}
/* planner mensal */
.pl-head{display:flex;align-items:center;justify-content:center;gap:16px;margin:4px 0 10px}
.pl-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.pl-wd{text-align:center;font-size:10px;font-weight:800;color:var(--ink-muted,#94a3b8);text-transform:uppercase;padding-bottom:2px}
.pl-cell{min-height:82px;background:var(--bg-3);border:1px solid transparent;border-radius:10px;padding:5px 5px 4px;overflow:hidden}
.pl-empty{background:transparent;border:none}
.pl-today{border-color:#2563eb;background:rgba(37,99,235,.07)}
.pl-dn{font-size:11px;font-weight:800;color:var(--ink-muted,#94a3b8);margin-bottom:3px;text-align:right;padding-right:2px}
.pl-today .pl-dn{color:#2563eb}
.pl-ev{display:block;font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:5px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}
.pl-more{font-size:9px;color:var(--ink-muted,#94a3b8);font-weight:700;padding-left:3px}
</style>`;

function gauge(label, pct, sub, cor) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="gz" style="border-color:${cor}55">
    <div class="gz-top"><span class="gz-lbl">${label}</span><span class="gz-pct" style="color:${cor}">${pct2(pct)}</span></div>
    <div class="gz-track"><div class="gz-fill" style="width:${p}%;background:${cor}"></div></div>
    <div class="gz-sub">${sub || ''}</div></div>`;
}
function miniMetric(label, big, sub, cor) {
  return `<div style="flex:1;min-width:160px;background:var(--bg-3);border-radius:14px;padding:14px 16px;border-left:4px solid ${cor}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:800">${label}</div>
    <div style="font-size:22px;font-weight:900;color:${cor};margin-top:2px">${big}</div><div class="tiny muted">${sub || ''}</div></div>`;
}

function metricsRow() {
  const d = _data || {};
  const isCorretor = (_feedRole || '').toLowerCase().startsWith('corretor');
  const metaVgv = d.metas?.meta_vgv || 0, vgvMes = d.sales?.vgv_mes || 0;
  const metaPct = metaVgv > 0 ? (vgvMes / metaVgv * 100) : null;
  const prod = _feedProd || {};
  const cards = [];
  if (metaPct !== null) cards.push(gauge('🎯 Meta do mês', metaPct, `R$ ${fmtKM(vgvMes)} de R$ ${fmtKM(metaVgv)}`, metaPct >= 100 ? '#16a34a' : metaPct >= 70 ? '#d4a843' : '#dc2626'));
  if (isCorretor) {
    cards.push(miniMetric('💰 VGV no mês', 'R$ ' + fmtKM(vgvMes), `${d.sales?.vendas_mes || 0} venda(s)`, '#16a34a'));
    cards.push(miniMetric('📈 Pipeline', 'R$ ' + fmtKM(d.sales?.pipeline_vgv), `${d.sales?.pipeline_count || 0} aberto(s)`, '#3b82f6'));
  } else {
    const pct = prod.pct;
    const sub = prod.solicitadas != null && prod.solicitadas > 0
      ? `${prod.concluidas || 0}/${prod.solicitadas} concluídas · ${prod.atrasadas || 0} atrasada(s)`
      : 'sem tarefas atribuídas ainda';
    cards.push(gauge('⚡ Produtividade', pct, sub, pct == null ? '#94a3b8' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d4a843' : '#dc2626'));
  }
  return `<div class="flex gap-3" style="flex-wrap:wrap;margin-bottom:14px">${cards.join('')}</div>`;
}

function plannerMensal() {
  const base = _ymOffset(_plOffset), y = base.getFullYear(), m = base.getMonth();
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`, today = _todayBRT();
  const byDay = {};
  (_feed || []).forEach(i => { if (i.data && i.data.slice(0, 7) === ym) (byDay[i.data] = byDay[i.data] || []).push(i); });
  const startDow = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][m];
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="pl-cell pl-empty"></div>';
  for (let dn = 1; dn <= days; dn++) {
    const ds = `${ym}-${String(dn).padStart(2, '0')}`, its = byDay[ds] || [], isT = ds === today;
    cells += `<div class="pl-cell${isT ? ' pl-today' : ''}"><div class="pl-dn">${dn}</div>`
      + its.slice(0, 3).map(i => `<a href="${i.link}" class="pl-ev" title="${escapeHtml((i.titulo || '') + ' — ' + (i.quem || ''))}" style="background:${corOrigem(i.origem)}22;color:${corOrigem(i.origem)}">${(i.ico || '')} ${escapeHtml((i.titulo || '').substring(0, 14))}</a>`).join('')
      + (its.length > 3 ? `<div class="pl-more">+${its.length - 3}</div>` : '') + `</div>`;
  }
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<div class="pl-wd">${d}</div>`).join('');
  return `<div class="pl-head"><button class="btn btn-ghost tiny" data-pl-nav="-1">‹ mês</button><b style="font-size:14px;min-width:150px;text-align:center">${MES} ${y}</b><button class="btn btn-ghost tiny" data-pl-nav="1">mês ›</button></div>
    <div class="pl-grid">${WD}</div>
    <div class="pl-grid" style="margin-top:4px">${cells}</div>`;
}

// pendências filtradas + ordenadas (compartilhado entre lista e kanban)
function pendFiltradas() {
  const all = (_feed || []).filter(i => !i.done)
    .sort((a, b) => (a.data || '9999') < (b.data || '9999') ? -1 : 1);
  return _filterOrig ? all.filter(i => i.origem === _filterOrig) : all;
}
function filtrosChips() {
  const origens = [...new Set((_feed || []).filter(i => !i.done).map(i => i.origem).filter(Boolean))];
  if (origens.length <= 1) return '';
  const chip = (lbl, val) => {
    const on = _filterOrig === val, cor = val ? corOrigem(val) : '#475569';
    return `<button class="exec-fchip${on ? ' on' : ''}" data-forig="${escapeHtml(val)}" style="--c:${cor}">${escapeHtml(lbl)}</button>`;
  };
  return `<div class="exec-filtros">${chip('Tudo', '')}${origens.map(o => chip(o, o)).join('')}</div>`;
}
const _concBtn = i => CONCLUDABLE[i.kind]
  ? `<button class="exec-done" data-conc="${escapeHtml(i.kind)}|${escapeHtml(i.id)}" title="Concluir">✓</button>` : '';
const _vazio = `<div class="exec-wrap" style="padding:28px;text-align:center"><div style="font-size:28px">🎉</div>
    <div class="muted tiny" style="margin-top:4px">Nada pendente pra você agora. Tudo em dia!</div></div>`;

function listaExec() {
  const hoje = _todayBRT();
  const pend = pendFiltradas();
  if (!pend.length) return _vazio;
  const shown = pend.slice(0, _pendLimit);
  const rows = shown.map(i => {
    const overdue = i.data && i.data < hoje, eh = i.data === hoje;
    const cor = corOrigem(i.origem);
    const dia = i.data ? i.data.split('-').reverse().slice(0, 2).join('/') : 'sem data';
    const badge = overdue ? ` <span style="color:#dc2626">⚠ atrasado</span>` : eh ? ` <span style="color:#16a34a">• hoje</span>` : '';
    const qcor = overdue ? '#dc2626' : eh ? '#16a34a' : 'var(--ink,#0f172a)';
    return `<tr>
      <td style="border-left:3px solid ${cor}">
        ${i.kind === 'tarefa'
          ? `<a href="#" class="exec-task" data-edittask="${escapeHtml(i.id)}" title="Abrir / editar tarefa">${i.ico || ''} <span>${escapeHtml(i.titulo || '')}</span></a>`
          : `<a href="${i.link}" class="exec-task">${i.ico || ''} <span>${escapeHtml(i.titulo || '')}</span></a>`}
        <span class="exec-origin" style="background:${cor}1f;color:${cor}">${escapeHtml(i.origem)}</span>
      </td>
      <td class="exec-when" style="color:${qcor}">${dia}${badge}</td>
      <td class="exec-sub">${escapeHtml((i.sub || '—').substring(0, 100))}</td>
      <td class="exec-quem">${escapeHtml(i.quem || '—')}</td>
      <td style="text-align:center">${_concBtn(i)}</td>
    </tr>`;
  }).join('');
  return `<div class="exec-wrap"><table class="exec-tbl">
    <thead><tr><th>🎯 O que fazer</th><th>📅 Quando</th><th>🛠 Como</th><th>👤 Quem</th><th>✓</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${pend.length > _pendLimit ? `<div style="text-align:center;margin-top:10px"><button class="btn btn-ghost btn-sm" data-pend-more="1">▼ Ver mais ${Math.min(50, pend.length - _pendLimit)} (de ${pend.length})</button></div>` : ''}`;
}

// 🗂 KANBAN por horizonte: Atrasados · Hoje (diário) · Semana · Mês · Depois
function kanbanPend() {
  const pend = pendFiltradas();
  if (!pend.length) return _vazio;
  const hoje = _todayBRT();
  const d7 = new Date(Date.now() - 3 * 3600 * 1000); d7.setDate(d7.getDate() + 7);
  const sem = d7.toISOString().slice(0, 10);
  const fm = _ymOffset(0); const mfim = new Date(fm.getFullYear(), fm.getMonth() + 1, 0).toISOString().slice(0, 10);
  const cols = [
    { id: 'atr', lbl: '🔴 Atrasados', cor: '#dc2626', t: d => d && d < hoje },
    { id: 'hoje', lbl: '☀️ Hoje', cor: '#16a34a', t: d => d === hoje },
    { id: 'sem', lbl: '📆 Esta semana', cor: '#2563eb', t: d => d && d > hoje && d <= sem },
    { id: 'mes', lbl: '🗓 Este mês', cor: '#7c3aed', t: d => d && d > sem && d <= mfim },
    { id: 'dep', lbl: '⏳ Depois / sem data', cor: '#64748b', t: d => !d || d > mfim },
  ];
  const buckets = { atr: [], hoje: [], sem: [], mes: [], dep: [] };
  pend.forEach(i => { const c = cols.find(c => c.t(i.data)); (buckets[c ? c.id : 'dep']).push(i); });
  const card = i => {
    const dia = i.data ? i.data.split('-').reverse().slice(0, 2).join('/') : 'sem data';
    const cor = corOrigem(i.origem);
    return `<div class="kb-card" style="border-left:3px solid ${cor}">
      <div class="flex" style="justify-content:space-between;gap:6px">
        ${i.kind === 'tarefa'
          ? `<a href="#" class="kb-t" data-edittask="${escapeHtml(i.id)}" title="Abrir / editar tarefa">${i.ico || ''} ${escapeHtml(i.titulo || '')}</a>`
          : `<a href="${i.link}" class="kb-t">${i.ico || ''} ${escapeHtml(i.titulo || '')}</a>`}
        ${_concBtn(i)}
      </div>
      <div class="flex" style="gap:6px;flex-wrap:wrap;align-items:center;margin-top:5px">
        <span class="exec-origin" style="background:${cor}1f;color:${cor}">${escapeHtml(i.origem)}</span>
        <span class="tiny muted">📅 ${dia}</span>
        ${i.quem ? `<span class="tiny muted">· ${escapeHtml(i.quem)}</span>` : ''}
      </div></div>`;
  };
  return `<div class="kb-board">${cols.map(c => `
    <div class="kb-col">
      <div class="kb-col-h" style="color:${c.cor}">${c.lbl} <span class="kb-n">${buckets[c.id].length}</span></div>
      <div class="kb-col-body">${buckets[c.id].length ? buckets[c.id].map(card).join('') : '<div class="tiny muted" style="text-align:center;padding:14px 0">—</div>'}</div>
    </div>`).join('')}</div>`;
}

// CARD 1 — ✅ TAREFAS & PENDÊNCIAS (ação primeiro: o que fazer / quando / como / quem)
function tarefasCard() {
  const c = _feedCounts || {};
  const chip = (n, lbl, cor) => `<span class="ck-chip" style="background:${cor}1a;color:${cor}">${n} ${lbl}</span>`;
  return `${PLANNER_CSS}
    <div class="card mt-4">
      <div class="ck-head">
        <h3 class="ck-title">✅ Tarefas &amp; pendências</h3>
        <span class="ck-spacer"></span>
        ${c.atrasados ? chip(c.atrasados, 'atrasada(s)', '#dc2626') : ''}
        ${c.hoje ? chip(c.hoje, 'hoje', '#16a34a') : ''}
        ${chip(c.pendentes || 0, 'pendente(s)', '#64748b')}
        <div class="ck-toggle">
          <button class="${_pendView === 'kanban' ? 'on' : ''}" data-pview="kanban">🗂 Kanban</button>
          <button class="${_pendView === 'lista' ? 'on' : ''}" data-pview="lista">📋 Lista</button>
        </div>
        <button class="btn btn-primary tiny" data-newtask="1">➕ Nova tarefa</button>
        <a href="#/agenda" class="btn btn-ghost tiny">📅 Agenda</a>
        <a href="#/tarefas" class="btn btn-ghost tiny">🗂 Ver tudo</a>
      </div>
      ${bomDiaBanner()}
      ${filtrosChips()}
      ${_pendView === 'kanban' ? kanbanPend() : listaExec()}
    </div>`;
}

function bomDiaBanner() {
  const c = _feedCounts || {};
  const h = new Date(Date.now() - 3 * 3600 * 1000).getHours();
  const saud = h < 12 ? '☀️ Bom dia' : h < 18 ? '👋 Boa tarde' : '🌙 Boa noite';
  const nome = escapeHtml((auth.user()?.name || '').split(' ')[0]);
  const atr = c.atrasados || 0, hoje = c.hoje || 0, pend = c.pendentes || 0;
  if (!pend) return `<div class="bomdia ok">${saud}, ${nome}! Tudo em dia por aqui. 🎉</div>`;
  const partes = [];
  if (atr) partes.push(`🔴 <b>${atr} atrasada(s)</b>`);
  if (hoje) partes.push(`🟢 <b>${hoje} pra hoje</b>`);
  partes.push(`${pend} pendente(s) no total`);
  return `<div class="bomdia">${saud}, ${nome}! Hoje você tem ${partes.join(' · ')}. Resolva de cima pra baixo 👇</div>`;
}

// CARD 2 — 🗓 PLANO DO MÊS (% da meta + % de produtividade + cronograma mensal)
function planoMesCard() {
  return `
    <div class="card mt-4">
      <div class="ck-head">
        <h3 class="ck-title">🗓 Plano do mês</h3>
        <span class="ck-spacer"></span>
        <span class="tiny muted">% da meta · % de produtividade · cronograma</span>
      </div>
      ${metricsRow()}
      ${plannerMensal()}
    </div>`;
}

// Time comercial vê os números de venda (VGV/meta/pipeline/ticket/ranking).
// Backoffice/secretaria, marketing e financeiro NÃO — não faz sentido pra eles.
const COMERCIAL_ROLES = ['corretor', 'lider', 'líder', 'gerente', 'socio', 'sócio', 'diretor'];
function ehComercial() { return COMERCIAL_ROLES.includes((auth.user()?.role || '').toLowerCase()); }

function render() {
  const me = auth.user();
  const d = _data || {};
  const hasFunis = (d.pipelines?.count_total || 0) > 0;
  const comercial = ehComercial();
  setTimeout(injectMeuAcompanhamento, 0); // equipe de apoio vê o próprio semáforo na entrada (v84.19)
  setTimeout(montarAgenda, 0);            // agenda + banner do Zoho (v84.56)

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">👋 Olá, ${escapeHtml(me.name || '')}</h2>
      <p class="card-sub">
        ${SCOPE_LBL[d.scope] || ''} ·
        <span class="tiny muted">Atualizado ${new Date().toLocaleString('pt-BR')}</span>
      </p>

      <!-- HERO KPIs — VENDAS + META (só time comercial) -->
      ${comercial ? `<div class="flex gap-3 mt-4" style="flex-wrap:wrap">
        ${heroKpi('💰 VGV no Mês',  'R$ ' + fmtKM(d.sales?.vgv_mes), `${d.sales?.vendas_mes || 0} venda(s) fechada(s)`,          '#16a34a')}
        ${heroKpi('🎯 Meta do Mês', 'R$ ' + fmtKM(d.metas?.meta_vgv), pctMeta(d.sales?.vgv_mes, d.metas?.meta_vgv),               '#d4a843')}
        ${heroKpi('📈 Pipeline em andamento', 'R$ ' + fmtKM(d.sales?.pipeline_vgv), `${d.sales?.pipeline_count || 0} em atendimento (ativ. ≤${d.sales?.pipeline_dias || 30}d)`, '#3b82f6')}
        ${heroKpi('🏆 Ticket Médio','R$ ' + fmtKM(d.sales?.ticket_medio_mes), 'média da venda no mês',                             '#8b5cf6')}
      </div>
      ${(d.sales?.pipeline_frentes || []).length ? `<div class="tiny muted" style="margin-top:6px">
        📈 Por funil: ${(d.sales.pipeline_frentes).map(([f, n, vgv, sv]) =>
          `<b>${escapeHtml(FRENTE_LBL[f] || f)}</b> R$ ${fmtKM(vgv)} (${n}${sv ? `, ${sv} s/ valor` : ''})`).join(' · ')}
        · base total: ${fmtNum(d.sales?.pipeline_base_count)} abertos (R$ ${fmtKM(d.sales?.pipeline_base_vgv)})
      </div>` : ''}` : ''}

      <!-- ✅ TAREFAS & PENDÊNCIAS primeiro (ação) · depois 🗓 PLANO DO MÊS (metas/prod + planner) -->
      ${tarefasCard()}

      <!-- 📅 AGENDA (inclui o banner de conexão do Zoho) -->
      <div id="dash-agenda" class="mt-3"><div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando agenda…</div></div></div>

      ${planoMesCard()}

      <!-- KPIs SECUNDÁRIOS (VGV são comerciais; Tarefas vale pra todos) -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${comercial ? `
        ${kpiCard('💰 VGV 30 dias',  'R$ ' + fmtKM(d.sales?.vgv_30d),    `${d.sales?.vendas_30d || 0} vendas`,                  '#16a34a')}
        ${kpiCard('💎 VGV no Ano',   'R$ ' + fmtKM(d.sales?.vgv_ano),    `${d.sales?.vendas_ano || 0} vendas no ano`,           '#0891b2')}
        ${kpiCard('❌ Perdidos mês', 'R$ ' + fmtKM(d.sales?.vgv_perdido_mes), `${d.sales?.perdidos_mes || 0} oportunidades`,    '#dc2626')}` : ''}
        ${kpiCard('📋 Tarefas',      fmtNum(d.tasks?.pending),          `${d.tasks?.done || 0} feitas / ${d.tasks?.total || 0} total`, '#f59e0b')}
      </div>

      <!-- KPIs DE APOIO (limpos, sem ruído de sistema) -->
      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${kpiCard('👥 Equipe',    fmtNum(d.users?.total),         `${d.users?.ativos || 0} ativos`,         '#2563eb')}
        ${kpiCard('💎 Comissões', 'R$ ' + fmtKM(d.commissions?.valor_pendente), `${d.commissions?.pendentes || 0} a pagar`, '#7c3aed')}
        ${hasFunis ? kpiCard('🔗 Funis RD', fmtNum(d.pipelines?.count_active), `de ${d.pipelines?.count_total} ativos`, '#0d9488') : ''}
      </div>

      <!-- DISTRIBUIÇÃO POR EQUIPE -->
      ${(d.users?.by_team && Object.keys(d.users.by_team).length > 1) ? `
      <div class="card mt-4">
        <h3 class="card-title">👥 Distribuição por equipe</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${Object.entries(d.users.by_team).map(([t, n]) => teamChip(t, n)).join('')}
        </div>
      </div>` : ''}

      <!-- 🏆 RANKING DE VENDAS DO MÊS (dado real do RD, só gestor) -->
      ${salesBoard()}

      <!-- 💎 COMISSÕES -->
      ${(d.commissions?.count || 0) > 0 ? `
        <div class="card mt-4">
          <h3 class="card-title">💎 Resumo de Comissões</h3>
          <div class="flex gap-3" style="flex-wrap:wrap">
            ${kpiMini('Total registrado', 'R$ ' + fmtMoney(d.commissions.valor_total))}
            ${kpiMini('Pendente',          'R$ ' + fmtMoney(d.commissions.valor_pendente), '#d97706')}
            ${kpiMini('# pagas',           d.commissions.pagas, '#16a34a')}
            ${kpiMini('# pendentes',       d.commissions.pendentes, '#d97706')}
          </div>
        </div>
      ` : ''}

      <!-- atalhos -->
      <div class="card mt-4">
        <h3 class="card-title">⚡ Atalhos</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${shortcut('🔗 CRM (RD)', '#/crm')}
          ${shortcut('🎯 Cérebro de Vendas', '#/cerebro-vendas')}
          ${shortcut('📥 Captações', '#/captacoes')}
          ${shortcut('💰 Financeiro', '#/financeiro')}
          ${shortcut('📊 Metas', '#/metas')}
          ${shortcut('👥 One-on-One', '#/one-on-one')}
        </div>
      </div>
    </div>
    ${_taskModal ? taskModalHTML() : ''}
  `;
  // ➕ nova tarefa (abre modal) — wrap p/ NÃO passar o Event como tarefa
  _root.querySelectorAll('[data-newtask]').forEach(b => b.addEventListener('click', () => openTaskModal()));
  // ✏️ abrir/editar uma tarefa do feed direto no dashboard (v81.84)
  _root.querySelectorAll('[data-edittask]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    const it = (_feed || []).find(x => x.id === b.dataset.edittask && x.kind === 'tarefa');
    if (it) openTaskModal(it);
  }));
  // modal: fechar / salvar / excluir
  _root.querySelectorAll('[data-nt-close]').forEach(b => b.addEventListener('click', () => {
    _taskModal = false; _taskBusy = false; _taskMsg = ''; _taskEditing = null; render();
  }));
  _root.querySelectorAll('[data-nt-save]').forEach(b => b.addEventListener('click', saveNewTask));
  _root.querySelectorAll('[data-nt-delete]').forEach(b => b.addEventListener('click', deleteTask));
  if (_taskModal) {
    const tit = document.getElementById('nt-tit');
    if (tit) { tit.focus(); tit.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveNewTask(); } }); }
  }
  // navegação do planner mensal (‹ mês ›)
  _root.querySelectorAll('[data-pl-nav]').forEach(b => b.addEventListener('click', () => {
    _plOffset += parseInt(b.dataset.plNav, 10) || 0;
    render();
  }));
  // alterna Kanban / Lista
  _root.querySelectorAll('[data-pview]').forEach(b => b.addEventListener('click', () => {
    _pendView = b.dataset.pview; _pendLimit = 50; render();
  }));
  // ver mais (lista)
  _root.querySelectorAll('[data-pend-more]').forEach(b => b.addEventListener('click', () => {
    _pendLimit += 50; render();
  }));
  // filtro por origem na lista de pendências
  _root.querySelectorAll('[data-forig]').forEach(b => b.addEventListener('click', () => {
    _filterOrig = b.dataset.forig || ''; render();
  }));
  // ✓ concluir (abre form se o tipo exige campos; senão conclui direto)
  _root.querySelectorAll('[data-conc]').forEach(b => b.addEventListener('click', () => {
    const [kind, id] = b.dataset.conc.split('|');
    const item = (_feed || []).find(i => i.kind === kind && String(i.id) === id);
    abrirConclusao(kind, id, item);
  }));
}

/* ─── Concluir item do Home (com campos obrigatórios por tipo) ─── */
function abrirConclusao(kind, id, item) {
  const defs = (_conclForms && _conclForms[kind]) || [];
  const nome = item ? (item.titulo || '') : '';
  if (!defs.length) {   // 1 clique
    if (confirm(`Concluir "${nome}"?`)) enviarConclusao(kind, id, {});
    return;
  }
  let ov = document.getElementById('conc-modal');
  if (!ov) { ov = document.createElement('div'); ov.id = 'conc-modal'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:5vh 20px 20px;overflow:auto';
  const field = f => {
    const id2 = 'cf-' + f.key;
    if (f.type === 'select') return `<label class="tiny muted" style="font-weight:700">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
      <select id="${id2}" class="select" style="margin-bottom:10px"><option value="">—</option>${(f.options || []).map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') return `<label class="tiny muted" style="font-weight:700">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
      <textarea id="${id2}" class="input" rows="2" style="margin-bottom:10px"></textarea>`;
    const t = f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text';
    return `<label class="tiny muted" style="font-weight:700">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
      <input id="${id2}" type="${t}" class="input" style="margin-bottom:10px" placeholder="${f.type === 'url' ? 'https://…' : ''}">`;
  };
  ov.innerHTML = `<div class="card" style="max-width:460px;width:100%">
    <h3 class="card-title" style="font-size:15px">✓ Concluir — ${escapeHtml(nome)}</h3>
    <p class="tiny muted" style="margin:0 0 12px">Preencha pra registrar a entrega:</p>
    ${defs.map(field).join('')}
    <div id="conc-msg"></div>
    <div class="flex gap-2 mt-2" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="conc-cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="conc-ok">✓ Concluir</button>
    </div></div>`;
  ov.querySelector('#conc-cancel').onclick = () => ov.remove();
  ov.querySelector('#conc-ok').onclick = () => {
    const fields = {}; let falta = '';
    defs.forEach(f => {
      const el = document.getElementById('cf-' + f.key);
      const v = (el && el.value || '').trim();
      fields[f.key] = v;
      if (f.required && !v && !falta) falta = f.label;
    });
    if (falta) { ov.querySelector('#conc-msg').innerHTML = `<div class="alert alert-err tiny">Preencha: ${escapeHtml(falta)}</div>`; return; }
    enviarConclusao(kind, id, fields, ov);
  };
}

async function enviarConclusao(kind, id, fields, ov) {
  try {
    await api.request('/api/v3/tasks/conclude', { method: 'POST', body: { kind, id, fields } });
    if (ov) ov.remove();
    await pageDashboard(null, _root);   // recarrega o feed (item sai das pendências)
  } catch (e) {
    if (ov) ov.querySelector('#conc-msg').innerHTML = `<div class="alert alert-err tiny">${escapeHtml(e.message)}</div>`;
    else alert('Erro: ' + e.message);
  }
}

/* ─── Ranking de vendas do mês (real, via OO) ─── */
function salesBoard() {
  if (!ehComercial()) return '';               // backoffice/marketing/financeiro não veem ranking de vendas
  if ((auth.user()?.lvl || 0) < 5) return ''; // corretor não vê ranking de todos
  if (!_board) return '';
  const all = (_board.corretores || []).filter(c => !c.is_team);
  if (!all.length) return '';
  const ranked = all.slice().sort((a, b) => (b.vgv || 0) - (a.vgv || 0) || (b.vendas || 0) - (a.vendas || 0));
  const comVenda = ranked.filter(c => (c.vendas || 0) > 0);
  const lista = (comVenda.length ? comVenda : ranked).slice(0, 8);
  const totalVgv = ranked.reduce((s, c) => s + (c.vgv || 0), 0);
  const totalVendas = ranked.reduce((s, c) => s + (c.vendas || 0), 0);
  return `
    <div class="card mt-4">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h3 class="card-title" style="flex:1;min-width:200px">🏆 Ranking de Vendas — mês</h3>
        <span class="tiny muted">${totalVendas} venda(s) · R$ ${fmtKM(totalVgv)} VGV no time</span>
      </div>
      ${comVenda.length === 0 ? '<div class="muted tiny" style="margin-top:6px">Ainda sem vendas fechadas neste mês — ranking por pipeline/atividade aparece aqui assim que fechar a primeira.</div>' : ''}
      <div style="display:grid;gap:6px;margin-top:8px">
        ${lista.map((c, i) => salesRow(c, i)).join('')}
      </div>
    </div>`;
}

function salesRow(c, i) {
  const ini = escapeHtml((c.ini || (c.name || '?').substring(0, 2)).toUpperCase());
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
  return `
    <div style="display:grid;grid-template-columns:34px 30px 1fr auto auto;gap:10px;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);align-items:center;font-size:13px">
      <div style="font-size:16px;text-align:center">${medal}</div>
      <div style="width:28px;height:28px;border-radius:50%;background:${c.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${ini}</div>
      <div style="min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name || '—')}</div><div class="tiny muted">${escapeHtml(c.team || 'geral')}</div></div>
      <div style="text-align:right"><div class="tiny muted">vendas</div><div style="font-weight:800;color:#2563eb">${c.vendas || 0}</div></div>
      <div style="text-align:right"><div class="tiny muted">VGV</div><div style="font-weight:900;color:#16a34a">R$ ${fmtKM(c.vgv)}</div></div>
    </div>`;
}

function shortcut(label, href) {
  return `<a href="${href}" class="btn btn-ghost" style="font-size:13px">${label}</a>`;
}

/* ─── KPI helpers ─── */
function kpiCard(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:180px;background:var(--bg-3);border-radius:var(--r-md);padding:14px 16px;border-left:4px solid ${color}">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:28px;font-weight:900;color:${color};margin-top:2px">${big ?? '—'}</div>
      <div class="tiny muted">${sub || ''}</div>
    </div>
  `;
}

function heroKpi(label, big, sub, color) {
  return `
    <div style="flex:1;min-width:200px;background:linear-gradient(135deg, ${color}22, ${color}05);border:1px solid ${color}44;border-radius:var(--r-md);padding:16px 18px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:30px;font-weight:900;color:${color};margin-top:4px;line-height:1.1">${big ?? '—'}</div>
      <div class="tiny muted" style="margin-top:2px">${sub || ''}</div>
    </div>
  `;
}

function pctMeta(real, meta) {
  if (!meta || meta <= 0) return 'meta não definida';
  const pct = (real || 0) / meta * 100;
  const emoji = pct >= 100 ? '🟢' : pct >= 70 ? '🟡' : '🔴';
  return `${emoji} ${pct2(pct)} atingido`;
}

function fmtKM(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }

function kpiMini(label, value, color) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-sm);padding:10px 14px;min-width:140px">
      <div class="tiny muted" style="letter-spacing:1px;text-transform:uppercase">${label}</div>
      <div style="font-size:18px;font-weight:800;color:${color || 'var(--ink)'}">${value}</div>
    </div>
  `;
}

function teamChip(team, n) {
  return `
    <div style="background:var(--bg-3);border-radius:var(--r-full);padding:6px 14px;font-size:12px;font-weight:600">
      ${escapeHtml(team)} <span class="muted">·</span> <b>${n}</b>
    </div>
  `;
}

function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR'); }
function fmtMoney(n) {
  if (n == null) return '0,00';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── 📈 Meu Acompanhamento no Dashboard Inicial (v84.19) ─────────────────────
   Se o user logado é colaborador do Painel de Fiscalização (Leire/Mariane/
   Guilherme), injeta um card compacto com o semáforo pessoal logo no topo.
   Best-effort: quem não é colaborador não vê NADA (nem erro). */
async function injectMeuAcompanhamento() {
  let card = null;
  try {
    const r = await api.request('/api/v3/producao/painel?visao=me');
    card = (r.cards || [])[0];
  } catch (_) { return; }
  if (!card || !_root || !_root.querySelector('.card')) return;
  if (_root.querySelector('#dash-fisc')) return;
  const COR = { verde: '#16a34a', amarelo: '#d97706', vermelho: '#dc2626' };
  const cor = COR[card.semaforo] || '#64748b';
  let miolo = '';
  if (card.placar_mes) {
    const p = card.placar_mes;
    const done = Object.entries(p.metas).filter(([f, m]) => m > 0 && (p.feito[f] || 0) >= m).length;
    miolo = `placar do mês: <b>${done}</b>/${Object.keys(p.metas).length} frentes na meta (rampa ${escapeHtml((card.rampa || '').toUpperCase())})`;
  } else {
    const f = card.motor_feito || {}, m = card.motor_meta || {};
    miolo = `hoje: <b>${f.dia || 0}</b>/${m.dia || 0} · esperado até agora: ${card.esperado_agora}`;
  }
  const el = document.createElement('div');
  el.id = 'dash-fisc';
  el.className = 'card';
  el.style.cssText = `border-left:4px solid ${cor};margin-top:8px`;
  el.innerHTML = `<div class="flex items-center" style="gap:10px;flex-wrap:wrap">
      <span style="width:13px;height:13px;border-radius:50%;background:${cor};flex-shrink:0"></span>
      <b>📈 Meu Acompanhamento</b>
      <span class="tiny">${miolo}</span>
      ${(card.alertas || []).map(a => `<span class="badge" style="background:#dc262622;color:#dc2626;font-weight:700">${escapeHtml(a)}</span>`).join(' ')}
      <button class="btn btn-primary btn-sm" style="margin-left:auto" id="dash-fisc-abrir">registrar produção →</button>
    </div>`;
  const primeiro = _root.querySelector('.card');
  primeiro.parentNode.insertBefore(el, primeiro.nextSibling);
  el.querySelector('#dash-fisc-abrir').onclick = () => { location.hash = '#/minha-producao'; };
}
