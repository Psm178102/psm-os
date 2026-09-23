/* PSM-OS v2 — 🎯 Objetivos & OKRs: desdobramento estratégico (v88.13)
   Uma cadeia só, lida de cima pra baixo:
     Norte (visão/missão) → Objetivo estratégico do ano → OKR do ciclo → KR → Projetos
   - KR pode ser MANUAL (digitado) ou LIGADO ÀS METAS (VGV/vendas da aba Metas, somando
     os meses do ciclo) — aí o número se atualiza sozinho e a meta é a soma das metas.
   - Progresso sobe sozinho (KR → OKR → Objetivo) e o status do OKR sai do RITMO
     (quanto do ciclo já passou), não de um select digitado.
   - Painel de saúde aponta os buracos: objetivo sem OKR, OKR sem dono/objetivo,
     projeto ativo que não move nenhum OKR.
   Backend: /api/v3/okrs/cascata (leitura calculada), /api/v3/okrs/list (grava OKR),
   /api/v3/diretoria/estrategia (grava objetivo), /api/v3/paulo/cards (liga projeto). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _d = null;               // resposta da cascata
let _ano = new Date().getFullYear();
let _ciclo = '';             // '' = todos os ciclos do ano
let _editing = null;         // OKR em edição
let _allOkrs = [];           // todos os OKRs do ano (pro select de projetos órfãos)
let _users = null;           // okrs.responsavel é FK de users.id → o dono é escolhido numa lista

const STATUS = {
  on_track:     { lbl: 'No ritmo',      color: '#16a34a' },
  at_risk:      { lbl: 'Em risco',      color: '#d97706' },
  off_track:    { lbl: 'Fora do ritmo', color: '#dc2626' },
  completed:    { lbl: 'Concluído',     color: '#2563eb' },
  nao_iniciado: { lbl: 'Não iniciado',  color: '#64748b' },
};
const AREAS = ['Presidência', 'Comercial', 'Marketing', 'Financeiro', 'Operações', 'Pessoas', 'Jurídico & Compliance', 'Tecnologia & Dados'];
const FONTES = { manual: '✍️ Manual', vgv: '🔗 VGV (aba Metas)', vendas: '🔗 Vendas (aba Metas)' };
const ciclosDo = ano => [`Q1 ${ano}`, `Q2 ${ano}`, `Q3 ${ano}`, `Q4 ${ano}`, `S1 ${ano}`, `S2 ${ano}`, `ANO ${ano}`];
const cicloAtual = () => { const d = new Date(); return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`; };

const lvl = () => auth.user()?.lvl || 0;
const podeOkr = () => lvl() >= 5;
const podeObjetivo = () => lvl() >= 7;

export async function pageOKRs(ctx, root) {
  _root = root;
  _editing = null;
  renderShell();
  await load();
}

async function load() {
  const body = document.getElementById('okr-body');
  if (body) body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Montando o desdobramento…</div>';
  try {
    const q = new URLSearchParams({ ano: _ano });
    if (_ciclo) q.set('ciclo', _ciclo);
    _d = await api.request('/api/v3/okrs/cascata?' + q);
    _allOkrs = [..._d.objetivos.flatMap(o => o.okrs), ..._d.okrs_sem_objetivo];
    if (_ciclo) {   // com filtro, o select de "ligar projeto" ainda precisa enxergar o ano todo
      try { const all = await api.request('/api/v3/okrs/cascata?ano=' + _ano); _allOkrs = [...all.objetivos.flatMap(o => o.okrs), ...all.okrs_sem_objetivo]; } catch (_) {}
    }
    renderAll();
  } catch (e) {
    if (body) body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

/* ─── casca ─────────────────────────────────────────────────────────── */
function renderShell() {
  const anos = [_ano - 1, _ano, _ano + 1];
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🎯 Objetivos & OKRs</h2>
          <p class="card-sub">Desdobramento estratégico: <b>Norte → Objetivo do ano → OKR do ciclo → Resultado-chave → Projetos</b>. O progresso sobe sozinho e o status vem do ritmo do ciclo.</p>
        </div>
        <div class="flex gap-1" style="flex-wrap:wrap;align-items:center">
          <select id="okr-ano" class="select" style="width:auto">${anos.map(a => `<option ${a === _ano ? 'selected' : ''}>${a}</option>`).join('')}</select>
          <select id="okr-ciclo" class="select" style="width:auto">
            <option value="">Todos os ciclos</option>
            ${ciclosDo(_ano).map(c => `<option ${c === _ciclo ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          ${podeObjetivo() ? '<button class="btn btn-ghost" id="okr-new-obj">➕ Objetivo</button>' : ''}
          ${podeOkr() ? '<button class="btn btn-primary" id="okr-new">➕ OKR</button>' : ''}
        </div>
      </div>
      <div id="okr-body" class="mt-3"></div>
    </div>`;
  document.getElementById('okr-ano').addEventListener('change', e => { _ano = +e.target.value; _ciclo = ''; renderShell(); load(); });
  document.getElementById('okr-ciclo').addEventListener('change', e => { _ciclo = e.target.value; load(); });
  document.getElementById('okr-new-obj')?.addEventListener('click', () => objetivoForm(null));
  document.getElementById('okr-new')?.addEventListener('click', () => { _editing = novoOkr(); okrForm(); });
}

function renderAll() {
  const d = _d;
  const body = document.getElementById('okr-body');
  body.innerHTML = `
    ${norteHTML(d.norte)}
    ${saudeHTML(d.saude)}
    <div id="okr-form"></div>
    ${d.objetivos.length ? d.objetivos.map(objetivoHTML).join('') : `
      <div class="card mb-3" style="text-align:center;padding:28px;border:2px dashed var(--border)">
        <div style="font-weight:800">Nenhum objetivo estratégico para ${d.ano}</div>
        <div class="tiny muted" style="margin:6px 0 12px">Comece pelos 3 a 5 grandes objetivos do ano. Cada OKR do trimestre se pendura em um deles.</div>
        ${podeObjetivo() ? '<button class="btn btn-primary" data-act="novo-objetivo">➕ Criar o primeiro objetivo</button>' : ''}
      </div>`}
    ${d.okrs_sem_objetivo.length ? `
      <div id="soltos" class="card mb-3" style="border-left:4px solid #94a3b8">
        <div style="font-weight:800">🧩 OKRs sem objetivo estratégico (${d.okrs_sem_objetivo.length})</div>
        <div class="tiny muted" style="margin-bottom:8px">Edite e escolha o objetivo que cada um move — senão o esforço não aparece na estratégia.</div>
        ${d.okrs_sem_objetivo.map(okrHTML).join('')}
      </div>` : ''}
    ${orfaosHTML(d.projetos_orfaos)}`;
  bind(body);
}

/* ─── blocos ────────────────────────────────────────────────────────── */
function norteHTML(n) {
  const v = (n.visao || [])[0], m = (n.missao || [])[0];
  const cel = (lbl, it) => `<div style="flex:1;min-width:220px;padding:10px 12px;border-radius:8px;background:var(--bg-3)">
    <div class="tiny" style="font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.6">${lbl}</div>
    ${it ? `<div style="font-weight:700;margin-top:3px">${esc(it.titulo)}</div>${it.descricao ? `<div class="tiny muted">${esc(it.descricao)}</div>` : ''}`
         : `<div class="tiny" style="margin-top:3px;color:#d97706">não definida — <a href="#/norte-estrategico">definir no Norte Estratégico</a></div>`}
  </div>`;
  return `<div class="flex gap-2 mb-3" style="flex-wrap:wrap;align-items:stretch">
    <div style="display:flex;align-items:center;font-size:22px" title="Norte">⭐</div>
    ${cel('Visão', v)}${cel('Missão', m)}
  </div>`;
}

function saudeHTML(s) {
  const tile = (lbl, val, cor) => `<div style="background:var(--bg-3);border-radius:8px;padding:10px;text-align:center;border-top:3px solid ${cor}">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">${lbl}</div>
    <div style="font-size:22px;font-weight:800;color:${cor}">${val}</div></div>`;
  const NIV = { alto: ['🔴', '#dc2626'], medio: ['🟡', '#d97706'], baixo: ['⚪', '#64748b'] };
  const al = s.alertas || [];
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px" class="mb-3">
      ${tile('Progresso geral', s.pct_geral + '%', 'var(--psm-navy)')}
      ${tile('Objetivos', s.objetivos, '#0891b2')}
      ${tile('OKRs', s.okrs, '#0891b2')}
      ${tile('No ritmo', s.on_track, STATUS.on_track.color)}
      ${tile('Em risco', s.at_risk, STATUS.at_risk.color)}
      ${tile('Fora do ritmo', s.off_track, STATUS.off_track.color)}
    </div>
    ${al.length ? `<details class="mb-3" ${al.some(a => a.nivel === 'alto') ? 'open' : ''} style="background:var(--bg-3);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-weight:800">🩺 Saúde do desdobramento — ${al.length} ponto(s) a resolver</summary>
      <div style="margin-top:6px">${al.map(a => `<div class="flex gap-2" style="align-items:center;font-size:12.5px;padding:4px 0;border-top:1px dashed var(--border)">
        <span>${NIV[a.nivel]?.[0] || '•'}</span><span style="flex:1">${esc(a.txt)}</span>
        ${a.acao ? `<button class="btn btn-ghost btn-sm" data-act="${esc(a.acao)}">resolver →</button>` : ''}
      </div>`).join('')}</div>
    </details>` : `<div class="tiny mb-3" style="color:#16a34a;font-weight:700">✅ Desdobramento íntegro: todo objetivo tem OKR, todo OKR tem dono e todo projeto move um OKR.</div>`}`;
}

function barra(pct, cor, ritmo) {
  return `<div style="position:relative;background:var(--bg-2);height:8px;border-radius:4px;overflow:visible">
    <div style="background:${cor};height:100%;border-radius:4px;width:${Math.min(100, Math.max(0, pct))}%;transition:width .4s"></div>
    ${ritmo > 0 && ritmo < 100 ? `<div title="ritmo esperado hoje: ${ritmo}%" style="position:absolute;top:-3px;left:${ritmo}%;width:2px;height:14px;background:var(--ink,#0b1f3a);opacity:.55"></div>` : ''}
  </div>`;
}
const corPct = p => p >= 70 ? '#16a34a' : p >= 40 ? '#d97706' : '#dc2626';

function objetivoHTML(ob) {
  return `
    <div class="card mb-3" style="border-left:5px solid var(--psm-gold,#d4a843)">
      <div class="flex gap-2" style="align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div class="tiny" style="font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.55">Objetivo estratégico ${_d.ano}</div>
          <div style="font-weight:800;font-size:16px">${esc(ob.titulo)}</div>
          ${ob.descricao ? `<div class="tiny muted">${esc(ob.descricao)}</div>` : ''}
        </div>
        <div style="width:170px">
          <div class="flex" style="justify-content:space-between" ><span class="tiny muted">${ob.okrs.length} OKR(s)</span><b style="color:${corPct(ob.pct)}">${ob.pct}%</b></div>
          ${barra(ob.pct, corPct(ob.pct))}
        </div>
        ${podeObjetivo() ? `<div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" data-edit-obj="${ob.id}" title="Editar objetivo">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del-obj="${ob.id}" title="Remover objetivo">🗑</button>
        </div>` : ''}
      </div>
      <div style="margin-top:10px;padding-left:12px;border-left:2px dashed var(--border)">
        ${ob.okrs.map(okrHTML).join('') || '<div class="tiny muted" style="padding:6px 0">Nenhum OKR neste objetivo ainda.</div>'}
        ${podeOkr() ? `<button class="btn btn-ghost btn-sm" data-act="novo-okr:${ob.id}">➕ OKR neste objetivo</button>` : ''}
      </div>
    </div>`;
}

function okrHTML(o) {
  const st = STATUS[o.status] || STATUS.on_track;
  return `
    <div id="okr-${esc(o.id)}" style="background:var(--bg-3);border-radius:8px;padding:10px 12px;margin:8px 0;border-left:4px solid ${st.color}">
      <div class="flex gap-2" style="align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="font-weight:800">${esc(o.objetivo)}</div>
          <div class="tiny muted">${esc(o.ciclo || '')}${o.area ? ' · ' + esc(o.area) : ''} · ${o.responsavel ? '👤 ' + esc(o.responsavel_nome || o.responsavel) : '<span style="color:#d97706">sem dono</span>'}</div>
        </div>
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${st.color}22;color:${st.color};white-space:nowrap">${st.lbl}</span>
        <div style="width:150px">
          <div class="flex" style="justify-content:space-between"><span class="tiny muted">ritmo ${o.ritmo}%</span><b style="color:${st.color}">${o.pct}%</b></div>
          ${barra(o.pct, st.color, o.ritmo)}
        </div>
        ${podeOkr() ? `<div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" data-edit="${esc(o.id)}" title="Editar OKR">✏️</button>
          <button class="btn btn-ghost btn-sm" data-del="${esc(o.id)}" title="Remover OKR">🗑</button>
        </div>` : ''}
      </div>
      <div style="display:grid;gap:6px;margin-top:8px">${(o.krs || []).map(krHTML).join('') || '<div class="tiny" style="color:#d97706">Sem resultado-chave — um OKR precisa de 2 a 4 KRs mensuráveis.</div>'}</div>
      ${projetosHTML(o)}
    </div>`;
}

function krHTML(k) {
  const auto = k.fonte === 'vgv' || k.fonte === 'vendas';
  const fmt = v => k.unit === 'R$' ? brl(v) : `${num(v)} ${esc(k.unit || '')}`;
  return `<div style="background:var(--bg-2);border-radius:6px;padding:7px 10px">
    <div class="flex gap-2" style="align-items:center;justify-content:space-between">
      <span style="font-size:12.5px;font-weight:600">${esc(k.label || '—')}
        ${auto ? `<span class="tiny" title="Número puxado da aba Metas — atualiza sozinho" style="margin-left:4px;padding:1px 6px;border-radius:99px;background:rgba(8,145,178,.14);color:#0891b2;font-weight:700">🔗 Metas</span>` : ''}
        ${k.parado_dias ? `<span class="tiny" style="margin-left:4px;color:#d97706">⏳ ${k.parado_dias}d sem atualizar</span>` : ''}
      </span>
      <b style="font-size:12px;color:${corPct(k.pct)}">${k.pct}%</b>
    </div>
    <div style="margin:4px 0 2px">${barra(k.pct, corPct(k.pct))}</div>
    <div class="flex tiny muted" style="justify-content:space-between"><span>${fmt(k.curr || 0)}</span><span>${k.sem_meta ? '<span style="color:#d97706">sem meta</span>' : 'meta ' + fmt(k.target || 0)}</span></div>
  </div>`;
}

function projetosHTML(o) {
  const ps = o.projetos || [];
  if (!ps.length) return `<div class="tiny muted" style="margin-top:8px">📁 Nenhum projeto ligado — <a href="#/projetos">ligar em Projetos</a> ou pela lista de projetos sem OKR abaixo.</div>`;
  const ETAPA = { ideia: '💡', planejamento: '📋', andamento: '🚧', revisao: '👁', concluido: '✅', pausado: '⏸' };
  return `<div style="margin-top:8px">
    <div class="tiny" style="font-weight:800">📁 Projetos que movem este OKR (${ps.length}) · <span style="color:${corPct(o.projetos_pct)}">${o.projetos_pct}% de execução</span></div>
    ${ps.map(c => `<div class="flex gap-2" style="align-items:center;font-size:12px;padding:3px 0;border-top:1px dashed var(--border)">
      <span>${ETAPA[c.status] || '📁'}</span>
      <a href="#/projetos" style="flex:1;min-width:0;font-weight:700;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.titulo || 'Sem nome')}</a>
      ${c.responsavel ? `<span class="tiny muted">👤 ${esc(c.responsavel)}</span>` : ''}
      ${c.atrasado ? '<span class="tiny" style="color:#dc2626;font-weight:700">⚠ atrasado</span>' : ''}
      <span class="tiny muted" style="width:34px;text-align:right">${c.pct}%</span>
    </div>`).join('')}
  </div>`;
}

function orfaosHTML(ps) {
  if (!ps.length) return '';
  const opts = `<option value="">— ligar a um OKR —</option>` + _allOkrs.map(o => `<option value="${esc(o.id)}">${esc(o.objetivo)} (${esc(o.ciclo || '')})</option>`).join('');
  return `<div id="orfaos" class="card mb-3" style="border-left:4px solid #d97706">
    <div style="font-weight:800">📁 Projetos ativos sem OKR (${ps.length})</div>
    <div class="tiny muted" style="margin-bottom:8px">Numa diretoria madura, todo projeto existe pra mover um resultado. Ligue cada um ao OKR que ele move — ou questione se ele deveria existir.</div>
    ${ps.map(c => `<div class="flex gap-2" style="align-items:center;font-size:12.5px;padding:5px 0;border-top:1px dashed var(--border);flex-wrap:wrap">
      <span style="flex:1;min-width:180px;font-weight:700">${esc(c.titulo || 'Sem nome')}</span>
      <span class="tiny muted">${esc(c.status || '')}${c.responsavel ? ' · 👤 ' + esc(c.responsavel) : ''}</span>
      ${podeOkr() && _allOkrs.length ? `<select class="select" data-ligar="${esc(c.id)}" style="width:auto;max-width:280px;font-size:12px">${opts}</select>` : ''}
    </div>`).join('')}
    ${!_allOkrs.length ? '<div class="tiny" style="color:#d97706;margin-top:6px">Crie os OKRs primeiro — depois é só escolher aqui.</div>' : ''}
  </div>`;
}

/* ─── eventos ───────────────────────────────────────────────────────── */
function bind(body) {
  body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => acao(b.dataset.act)));
  body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editarOkr(b.dataset.edit)));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover este OKR? Os projetos ligados a ele ficam sem OKR.')) return;
    try { await api.request('/api/v3/okrs/list?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); await load(); }
    catch (e) { alert('Erro: ' + e.message); }
  }));
  body.querySelectorAll('[data-edit-obj]').forEach(b => b.addEventListener('click', () => objetivoForm(_d.objetivos.find(o => String(o.id) === b.dataset.editObj))));
  body.querySelectorAll('[data-del-obj]').forEach(b => b.addEventListener('click', async () => {
    const ob = _d.objetivos.find(o => String(o.id) === b.dataset.delObj);
    if (!confirm(`Remover o objetivo "${ob?.titulo}"? ${ob?.okrs?.length ? 'Os OKRs dele vão para "sem objetivo".' : ''}`)) return;
    try { await api.request('/api/v3/diretoria/estrategia', { method: 'POST', body: { id: ob.id, _delete: true } }); await load(); }
    catch (e) { alert('Erro: ' + e.message); }
  }));
  body.querySelectorAll('[data-ligar]').forEach(s => s.addEventListener('change', async () => {
    if (!s.value) return;
    s.disabled = true;
    try { await api.request('/api/v3/paulo/cards', { method: 'POST', body: { action: 'upsert', id: s.dataset.ligar, board: 'projetos', okr_id: s.value } }); await load(); }
    catch (e) { alert('Erro: ' + e.message); s.disabled = false; }
  }));
}

function acao(a) {
  if (!a) return;
  if (a.startsWith('#/')) { location.hash = a; return; }
  if (a.startsWith('#')) { document.getElementById(a.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (a === 'novo-objetivo') return objetivoForm(null);
  if (a.startsWith('novo-okr:')) { _editing = novoOkr(a.slice(9)); return okrForm(); }
  if (a.startsWith('editar-okr:')) return editarOkr(a.slice(11));
}

function editarOkr(id) {
  const o = _allOkrs.find(x => x.id === id);
  if (!o) return;
  _editing = JSON.parse(JSON.stringify({
    id: o.id, objetivo: o.objetivo, ciclo: o.ciclo, responsavel: o.responsavel || '', area: o.area || '',
    objetivo_id: o.objetivo_id || '', concluido: o.status_manual === 'completed',
    krs: (o.krs || []).map(k => ({ label: k.label || '', fonte: k.fonte || 'manual', meta_modo: k.meta_modo || 'metas',
      curr: k.fonte === 'vgv' || k.fonte === 'vendas' ? 0 : (k.curr || 0), target: k.target || 0, unit: k.unit || '', atualizado_em: k.atualizado_em || null, _curr0: k.curr || 0 })),
  }));
  okrForm();
}

function novoOkr(objetivoId) {
  return { objetivo: '', ciclo: _ciclo || cicloAtual(), responsavel: '', area: '', objetivo_id: objetivoId || '', concluido: false,
    krs: [{ label: '', fonte: 'manual', meta_modo: 'metas', curr: 0, target: 0, unit: '' }] };
}

/* ─── formulário do OKR ─────────────────────────────────────────────── */
async function okrForm() {
  if (!_users) {
    try { const r = await api.request('/api/v3/users/list'); _users = (r.users || []).filter(u => u.id && u.name).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (_) { _users = []; }
  }
  const o = _editing;
  const wrap = document.getElementById('okr-form');
  if (!wrap) return;
  const objs = _d?.objetivos || [];
  wrap.innerHTML = `
    <div class="card mb-3" style="background:var(--bg-3);padding:16px;border:2px solid var(--psm-navy)">
      <div class="flex" style="justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800">${o.id ? '✏️ Editar OKR' : '➕ Novo OKR'}</div>
        <button class="btn btn-ghost btn-sm" id="o-cancel">✕ Cancelar</button>
      </div>
      <div style="display:grid;gap:10px">
        <div><label class="tiny muted">Objetivo do OKR * <span style="opacity:.7">(qualitativo e inspirador — o número vai nos KRs)</span></label>
          <input id="o-obj" class="input" placeholder="Ex.: Virar a referência em MCMV em Rio Preto" value="${esc(o.objetivo)}"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
          <div><label class="tiny muted">Objetivo estratégico que ele move</label>
            <select id="o-objid" class="select"><option value="">— nenhum —</option>${objs.map(x => `<option value="${x.id}" ${String(o.objetivo_id) === String(x.id) ? 'selected' : ''}>${esc(x.titulo)}</option>`).join('')}</select></div>
          <div><label class="tiny muted">Ciclo</label>
            <select id="o-ciclo" class="select">${ciclosDo(_ano).map(c => `<option ${o.ciclo === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div><label class="tiny muted">Área</label>
            <select id="o-area" class="select"><option value="">—</option>${AREAS.map(a => `<option ${o.area === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
          <div><label class="tiny muted">Dono (1 pessoa)</label>
            <select id="o-resp" class="select"><option value="">— escolha —</option>${(_users || []).map(u => `<option value="${esc(u.id)}" ${o.responsavel === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}${o.responsavel && !(_users || []).some(u => u.id === o.responsavel) ? `<option value="${esc(o.responsavel)}" selected>${esc(o.responsavel)}</option>` : ''}</select></div>
        </div>
        <label class="tiny" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="o-done" ${o.concluido ? 'checked' : ''}> Marcar como concluído (senão o status é calculado pelo ritmo)</label>
        <div>
          <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:6px">
            <label class="tiny muted" style="font-weight:700">Resultados-chave (2 a 4)</label>
            <button class="btn btn-ghost btn-sm" id="o-add-kr">➕ KR</button>
          </div>
          <div id="o-krs"></div>
        </div>
        <button class="btn btn-primary" id="o-save">💾 Salvar OKR</button>
      </div>
    </div>`;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('o-cancel').addEventListener('click', () => { _editing = null; wrap.innerHTML = ''; });
  document.getElementById('o-add-kr').addEventListener('click', () => { lerCampos(); _editing.krs.push({ label: '', fonte: 'manual', meta_modo: 'metas', curr: 0, target: 0, unit: '' }); renderKRs(); });
  document.getElementById('o-save').addEventListener('click', salvarOkr);
  renderKRs();
}

function renderKRs() {
  const wrap = document.getElementById('o-krs');
  wrap.innerHTML = _editing.krs.map((k, i) => {
    const auto = k.fonte === 'vgv' || k.fonte === 'vendas';
    return `<div style="background:var(--bg-2);border-radius:8px;padding:10px;margin-bottom:6px">
      <div class="flex" style="justify-content:space-between;margin-bottom:6px"><div class="tiny muted">KR ${i + 1}</div>
        <button class="btn btn-ghost btn-sm" data-rem-kr="${i}">🗑</button></div>
      <input class="input" placeholder="Resultado mensurável (ex.: VGV do trimestre)" data-k="label" data-i="${i}" value="${esc(k.label)}" style="margin-bottom:6px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;align-items:end">
        <div><label class="tiny muted">Fonte do número</label>
          <select class="select" data-k="fonte" data-i="${i}">${Object.entries(FONTES).map(([v, l]) => `<option value="${v}" ${k.fonte === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${auto ? `
          <div><label class="tiny muted">Meta</label>
            <select class="select" data-k="meta_modo" data-i="${i}">
              <option value="metas" ${k.meta_modo !== 'manual' ? 'selected' : ''}>Soma das metas do ciclo</option>
              <option value="manual" ${k.meta_modo === 'manual' ? 'selected' : ''}>Meta própria</option></select></div>
          ${k.meta_modo === 'manual' ? `<div><label class="tiny muted">Meta própria</label><input class="input" type="number" data-k="target" data-i="${i}" value="${k.target || 0}"></div>` : ''}
          <div class="tiny muted" style="padding-bottom:8px">O realizado vem sozinho da aba Metas.</div>`
        : `
          <div><label class="tiny muted">Atual</label><input class="input" type="number" data-k="curr" data-i="${i}" value="${k.curr || 0}"></div>
          <div><label class="tiny muted">Meta</label><input class="input" type="number" data-k="target" data-i="${i}" value="${k.target || 0}"></div>
          <div><label class="tiny muted">Unidade</label><input class="input" placeholder="R$, %, un" data-k="unit" data-i="${i}" value="${esc(k.unit || '')}"></div>`}
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-k]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    const k = _editing.krs[+el.dataset.i], key = el.dataset.k;
    k[key] = (key === 'curr' || key === 'target') ? (parseFloat(el.value) || 0) : el.value;
    if (el.tagName === 'SELECT') renderKRs();   // fonte/meta mudam o formulário
  }));
  wrap.querySelectorAll('[data-rem-kr]').forEach(b => b.addEventListener('click', () => { _editing.krs.splice(+b.dataset.remKr, 1); renderKRs(); }));
}

function lerCampos() {
  _editing.objetivo = document.getElementById('o-obj').value.trim();
  _editing.objetivo_id = document.getElementById('o-objid').value;
  _editing.ciclo = document.getElementById('o-ciclo').value;
  _editing.area = document.getElementById('o-area').value;
  _editing.responsavel = document.getElementById('o-resp').value;
  _editing.concluido = document.getElementById('o-done').checked;
}

async function salvarOkr() {
  lerCampos();
  const o = _editing;
  if (!o.objetivo) { alert('Escreva o objetivo do OKR.'); return; }
  const hoje = new Date().toISOString().slice(0, 10);
  const krs = o.krs.filter(k => (k.label || '').trim()).map(k => {
    const auto = k.fonte === 'vgv' || k.fonte === 'vendas';
    const out = { label: k.label.trim(), fonte: k.fonte || 'manual' };
    if (auto) { out.meta_modo = k.meta_modo || 'metas'; if (out.meta_modo === 'manual') out.target = k.target || 0; }
    else {
      Object.assign(out, { curr: k.curr || 0, target: k.target || 0, unit: k.unit || '' });
      // carimbo de atualização: só muda quando o número andou (alimenta o alerta "KR parado")
      out.atualizado_em = (k.atualizado_em && k._curr0 === out.curr) ? k.atualizado_em : hoje;
    }
    return out;
  });
  try {
    await api.request('/api/v3/okrs/list', { method: 'POST', body: {
      id: o.id, objetivo: o.objetivo, ciclo: o.ciclo, responsavel: o.responsavel || null, area: o.area || null,
      objetivo_id: o.objetivo_id || null, status: o.concluido ? 'completed' : 'on_track', krs,
    } });
    _editing = null;
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

/* ─── formulário do objetivo estratégico ────────────────────────────── */
function objetivoForm(ob) {
  const wrap = document.getElementById('okr-form');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="card mb-3" style="background:var(--bg-3);padding:16px;border:2px solid var(--psm-gold,#d4a843)">
      <div class="flex" style="justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:800">${ob ? '✏️ Editar objetivo estratégico' : `➕ Novo objetivo estratégico de ${_ano}`}</div>
        <button class="btn btn-ghost btn-sm" id="ob-cancel">✕ Cancelar</button>
      </div>
      <div class="tiny muted" style="margin-bottom:8px">Os 3 a 5 grandes resultados do ano. Pense nas 4 perspectivas: financeira, clientes, processos e pessoas.</div>
      <div style="display:grid;gap:8px">
        <input id="ob-tit" class="input" placeholder="Ex.: Sair do vermelho e voltar a gerar caixa" value="${esc(ob?.titulo || '')}">
        <textarea id="ob-desc" class="input" rows="2" placeholder="Por que ele importa / como saberemos que chegamos lá">${esc(ob?.descricao || '')}</textarea>
        <button class="btn btn-primary" id="ob-save">💾 Salvar objetivo</button>
      </div>
    </div>`;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('ob-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });
  document.getElementById('ob-save').addEventListener('click', async () => {
    const titulo = document.getElementById('ob-tit').value.trim();
    if (!titulo) { alert('Dê um título ao objetivo.'); return; }
    const descricao = document.getElementById('ob-desc').value.trim() || null;
    const body = ob ? { id: ob.id, titulo, descricao } : { tipo: 'objetivo', ano: _ano, titulo, descricao, ordem: (_d?.objetivos?.length || 0) + 1 };
    try { await api.request('/api/v3/diretoria/estrategia', { method: 'POST', body }); await load(); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

/* ─── util ──────────────────────────────────────────────────────────── */
function brl(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
  if (Math.abs(n) >= 1e3) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
  return 'R$ ' + n.toLocaleString('pt-BR');
}
function num(v) { return (Number(v) || 0).toLocaleString('pt-BR'); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
