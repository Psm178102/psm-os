/* ============================================================================
   PSM-OS v2 — Pontos de Atenção (radar automático de riscos · Diretoria)
   ----------------------------------------------------------------------------
   Compila SOZINHO os sinais reais já existentes no sistema e os prioriza num
   painel acionável. Nada de cadastro manual, nada inventado:
     • Infra & Integrações  → /api/v3/system_health
     • Vendas & Metas       → /api/v3/metrics/overview (run-rate, pipeline, perdas)
     • Captações            → /api/v3/captacoes/kanban (paradas, sem dono, mídia)
     • Equipe               → /api/v3/oo/overview (concentração, sem venda)
     • Financeiro/Operação  → comissões a pagar (metrics)
   Cada sinal vira um cartão com severidade 🔴/🟡 e deep-link pra resolver.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _signals = [];
let _notes = [];
let _notesPending = false;

const TERMINAIS = new Set(['aprovado', 'concluido']); // captação encerrada
const PRIO = { alta: { lbl: 'Alta', cor: '#dc2626' }, media: { lbl: 'Média', cor: '#d97706' }, baixa: { lbl: 'Baixa', cor: '#2563eb' } };

export async function pagePontosAtencao(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Gerência/Diretoria.</div>';
    return;
  }
  root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Varrendo o sistema em busca de pontos de atenção…</div></div>`;

  const isGestor = (auth.user()?.lvl || 0) >= 5;
  const [health, metrics, oo, caps, notes] = await Promise.all([
    api.request('/api/v3/system_health').catch(() => null),
    api.request('/api/v3/metrics/overview').catch(() => null),
    isGestor ? api.request('/api/v3/oo/overview?date_preset=this_month').catch(() => null) : Promise.resolve(null),
    api.request('/api/v3/captacoes/kanban').catch(() => null),
    api.request('/api/v3/diretoria/notes?kind=atencao').catch(() => null),
  ]);
  _notes = (notes && notes.notes) || [];
  _notesPending = !!(notes && notes.pending);

  const signals = [];
  collectInfra(signals, health);
  collectVendas(signals, metrics);
  collectCaptacoes(signals, caps);
  collectEquipe(signals, oo);
  collectOperacao(signals, metrics);
  _signals = signals;

  render(signals);
}

async function reloadNotes() {
  try {
    const r = await api.request('/api/v3/diretoria/notes?kind=atencao');
    _notes = r.notes || [];
    _notesPending = !!r.pending;
  } catch (_) {}
  render(_signals);
}

/* ─── Coletores de sinais ─────────────────────────────────────────────── */

function push(arr, sev, area, icon, title, detail, href, hrefLabel) {
  arr.push({ sev, area, icon, title, detail, href, hrefLabel });
}

function collectInfra(arr, health) {
  if (!health) {
    push(arr, 'warn', 'Infra', '🩺', 'Saúde do sistema indisponível', 'Não consegui consultar /system_health agora.', '#/configuracoes', 'Configurações');
    return;
  }
  const AREA_HREF = {
    banco: ['#/configuracoes', 'Configurações'],
    crm: ['#/crm', 'CRM'],
    meta: ['#/marketing', 'Marketing'],
    captura: ['#/configuracoes', 'Configurações'],
    financeiro: ['#/financeiro', 'Financeiro'],
  };
  (health.issues || []).forEach(it => {
    const sev = it.severity === 'error' ? 'crit' : 'warn';
    const [href, lbl] = AREA_HREF[it.area] || ['#/configuracoes', 'Configurações'];
    push(arr, sev, 'Infra & Integrações', '🔌', `${cap(it.area)} — ${it.severity === 'error' ? 'falha' : 'atenção'}`, it.message, href, lbl);
  });
}

function collectVendas(arr, m) {
  if (!m || !m.sales) return;
  const s = m.sales, meta = (m.metas && m.metas.meta_vgv) || 0;
  // 1) Projeção de meta no ritmo atual (run-rate por dia corrido do mês)
  if (meta > 0) {
    const now = new Date();
    const dia = now.getDate();
    const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const frac = Math.max(dia / diasMes, 0.01);
    const proj = (s.vgv_mes || 0) / frac;
    const pct = Math.round(proj / meta * 100);
    const pctReal = Math.round((s.vgv_mes || 0) / meta * 100);
    if (pct < 80) {
      push(arr, 'crit', 'Vendas & Metas', '🎯', `Meta do mês em risco — projeção ~${pct}%`,
        `Hoje ${pctReal}% atingido (R$ ${km(s.vgv_mes)} de R$ ${km(meta)}). No ritmo atual o mês fecha em ~${pct}% da meta.`,
        '#/metas', 'Metas');
    } else if (pct < 100) {
      push(arr, 'warn', 'Vendas & Metas', '🎯', `Meta do mês apertada — projeção ~${pct}%`,
        `${pctReal}% atingido (R$ ${km(s.vgv_mes)} de R$ ${km(meta)}). Projeção no ritmo atual: ~${pct}%.`,
        '#/metas', 'Metas');
    }
    // 2) Pipeline cobre o que falta?
    const falta = Math.max(meta - (s.vgv_mes || 0), 0);
    if (falta > 0 && (s.pipeline_vgv || 0) < falta) {
      push(arr, 'warn', 'Vendas & Metas', '📈', 'Pipeline não cobre o restante da meta',
        `Falta R$ ${km(falta)} pra meta, mas o pipeline aberto soma só R$ ${km(s.pipeline_vgv)} (${s.pipeline_count || 0} negócios). Precisa gerar oportunidade.`,
        '#/crm', 'CRM');
    }
  }
  // 3) Mais perdas que vendas no mês
  if ((s.perdidos_mes || 0) >= 3 && (s.perdidos_mes || 0) > (s.vendas_mes || 0)) {
    push(arr, 'warn', 'Vendas & Metas', '❌', 'Mais perdas que vendas no mês',
      `${s.perdidos_mes} oportunidade(s) perdida(s) (R$ ${km(s.vgv_perdido_mes)}) contra ${s.vendas_mes || 0} venda(s). Revisar motivos de perda.`,
      '#/cerebro-vendas', 'Cérebro de Vendas');
  }
  // 4) Pipeline vazio
  if ((s.pipeline_count || 0) === 0) {
    push(arr, 'crit', 'Vendas & Metas', '🫙', 'Pipeline vazio',
      'Nenhum negócio aberto no CRM. Sem pipeline não há previsibilidade de receita.',
      '#/crm', 'CRM');
  }
}

function collectCaptacoes(arr, c) {
  const items = (c && c.captacoes) || [];
  if (!items.length) return;
  const ativos = items.filter(x => !TERMINAIS.has(x.status));
  const now = Date.now();
  const ageDays = x => {
    const t = x.updated_at || x.created_at;
    if (!t) return null;
    const d = new Date(t).getTime();
    return isNaN(d) ? null : (now - d) / 86400000;
  };
  // 1) Paradas há muito tempo
  const paradas14 = ativos.filter(x => (ageDays(x) || 0) > 14);
  const paradas7 = ativos.filter(x => { const a = ageDays(x) || 0; return a > 7 && a <= 14; });
  if (paradas14.length) {
    push(arr, 'crit', 'Captações', '📥', `${paradas14.length} captação(ões) parada(s) +14 dias`,
      `Sem movimentação há mais de 2 semanas: ${paradas14.slice(0, 3).map(nomeCap).join(', ')}${paradas14.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
  if (paradas7.length) {
    push(arr, 'warn', 'Captações', '📥', `${paradas7.length} captação(ões) parada(s) +7 dias`,
      `Estão estagnando: ${paradas7.slice(0, 3).map(nomeCap).join(', ')}${paradas7.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
  // 2) Sem responsável
  const semDono = ativos.filter(x => !(x.responsavel || x.responsavel_id));
  if (semDono.length) {
    push(arr, 'warn', 'Captações', '👤', `${semDono.length} captação(ões) sem responsável`,
      `Ninguém atribuído — risco de cair no esquecimento: ${semDono.slice(0, 3).map(nomeCap).join(', ')}${semDono.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
  // 3) Mídia pendente (precisa fotos/vídeos sem link)
  const midia = ativos.filter(x => (x.precisa_fotos && !x.link_fotos) || (x.precisa_videos && !x.link_videos));
  if (midia.length) {
    push(arr, 'warn', 'Captações', '📸', `${midia.length} captação(ões) aguardando mídia`,
      `Precisam de fotos/vídeos ainda não entregues — trava o anúncio: ${midia.slice(0, 3).map(nomeCap).join(', ')}${midia.length > 3 ? '…' : ''}.`,
      '#/captacoes', 'Captações');
  }
}

function collectEquipe(arr, oo) {
  if (!oo) return;
  const all = (oo.corretores || []).filter(c => !c.is_team);
  if (all.length < 3) return;
  const totalVgv = all.reduce((s, c) => s + (c.vgv || 0), 0);
  // 1) Concentração de receita num único corretor
  if (totalVgv > 0) {
    const top = all.slice().sort((a, b) => (b.vgv || 0) - (a.vgv || 0))[0];
    const share = Math.round((top.vgv || 0) / totalVgv * 100);
    if (share >= 60) {
      push(arr, 'warn', 'Equipe', '⚠️', `Receita concentrada em 1 pessoa (${share}%)`,
        `${esc(top.name || 'um corretor')} responde por ${share}% do VGV do mês. Dependência alta — risco se faltar.`,
        '#/equipe', 'Equipes');
    }
  }
  // 2) Quantos corretores sem nenhuma venda no mês
  const semVenda = all.filter(c => (c.vendas || 0) === 0);
  if (semVenda.length && semVenda.length >= Math.ceil(all.length / 2)) {
    push(arr, 'warn', 'Equipe', '😴', `${semVenda.length}/${all.length} sem venda neste mês`,
      `Metade ou mais do time ainda não fechou no mês. Olhar pipeline e atividade individual.`,
      '#/arena', 'Arena Live');
  }
}

function collectOperacao(arr, m) {
  if (!m) return;
  const co = m.commissions || {};
  if ((co.pendentes || 0) > 0 && (co.valor_pendente || 0) > 0) {
    push(arr, 'warn', 'Operação', '💎', `${co.pendentes} comissão(ões) a pagar`,
      `R$ ${km(co.valor_pendente)} em comissões pendentes de repasse.`,
      '#/financeiro', 'Financeiro');
  }
}

/* ─── Render ───────────────────────────────────────────────────────────── */

function render(signals) {
  const crit = signals.filter(s => s.sev === 'crit');
  const warn = signals.filter(s => s.sev === 'warn');
  const total = signals.length;

  const grupos = {};
  signals.forEach(s => { (grupos[s.area] = grupos[s.area] || []).push(s); });
  // ordena cada grupo: críticos primeiro
  Object.values(grupos).forEach(g => g.sort((a, b) => (a.sev === 'crit' ? 0 : 1) - (b.sev === 'crit' ? 0 : 1)));
  const ordemAreas = ['Infra & Integrações', 'Vendas & Metas', 'Captações', 'Equipe', 'Operação'];
  const areas = Object.keys(grupos).sort((a, b) => (ordemAreas.indexOf(a) + 1 || 99) - (ordemAreas.indexOf(b) + 1 || 99));

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">🚨 Pontos de Atenção</h2>
          <p class="card-sub">Radar automático — sinais reais do sistema, priorizados. Atualizado ${new Date().toLocaleString('pt-BR')}.</p>
        </div>
        <button class="btn btn-ghost" id="pa-reload">🔄 Reverificar</button>
      </div>

      <div class="flex gap-3 mt-3" style="flex-wrap:wrap">
        ${sumCard('🔴 Críticos', crit.length, '#dc2626')}
        ${sumCard('🟡 Atenção', warn.length, '#d97706')}
        ${sumCard('📋 Total', total, '#2563eb')}
      </div>

      ${total === 0 ? `
        <div style="text-align:center;padding:42px 20px;margin-top:16px;background:linear-gradient(135deg,rgba(22,163,74,.10),transparent);border:1px solid rgba(22,163,74,.3);border-radius:14px">
          <div style="font-size:46px">✅</div>
          <h3 style="margin:8px 0 4px">Tudo sob controle</h3>
          <p class="muted" style="margin:0">Nenhum ponto de atenção detectado agora. As metas, captações, integrações e a equipe estão dentro do esperado.</p>
        </div>
      ` : areas.map(area => `
        <div class="card mt-4" style="background:var(--bg-2)">
          <h3 class="card-title" style="font-size:14px">${esc(area)} <span class="tiny muted">· ${grupos[area].length}</span></h3>
          <div style="display:grid;gap:8px;margin-top:8px">
            ${grupos[area].map(sigRow).join('')}
          </div>
        </div>
      `).join('')}

      ${manualSection()}

      <div class="tiny muted" style="margin-top:14px">🤖 Os cartões coloridos acima são <b>automáticos</b> (dados reais do sistema) — resolva na origem e somem sozinhos. A seção ✍️ abaixo é pra <b>pontos que você escreve à mão</b> e controla manualmente.</div>
    </div>
    <div id="pa-modal"></div>
  `;
  document.getElementById('pa-reload').addEventListener('click', () => pagePontosAtencao(null, _root));
  bindManual();
}

/* ─── Pontos de atenção MANUAIS (escritos pela diretoria) ─────────────── */
function manualSection() {
  const abertos = _notes.filter(n => n.status !== 'resolvido');
  const resolvidos = _notes.filter(n => n.status === 'resolvido');
  return `
    <div class="card mt-4" style="background:var(--bg-2);border:1px dashed var(--border)">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <h3 class="card-title" style="flex:1;min-width:200px;font-size:14px">✍️ Pontos da diretoria <span class="tiny muted">· escritos à mão</span></h3>
        <button class="btn btn-primary btn-sm" id="pa-note-new">➕ Anotar ponto</button>
      </div>
      ${_notesPending ? `<div class="alert alert-warn" style="margin-top:8px">⏳ Rode <code>supabase/sprint9_23_diretoria_notes.sql</code> pra salvar os pontos manuais.</div>` : ''}
      ${!_notes.length ? `<div class="tiny muted" style="margin-top:8px">Nenhum ponto anotado. Use o botão acima pra registrar algo que precisa de atenção e ainda não vira sinal automático (ex.: pendência com um proprietário, decisão travada, risco de contrato).</div>` : `
        <div style="display:grid;gap:8px;margin-top:10px">
          ${abertos.map(noteRow).join('')}
        </div>
        ${resolvidos.length ? `<details style="margin-top:10px"><summary class="tiny muted" style="cursor:pointer">✅ ${resolvidos.length} resolvido(s)</summary><div style="display:grid;gap:8px;margin-top:8px;opacity:.7">${resolvidos.map(noteRow).join('')}</div></details>` : ''}
      `}
    </div>`;
}

function noteRow(n) {
  const p = PRIO[n.prioridade] || PRIO.media;
  const done = n.status === 'resolvido';
  return `
    <div style="display:flex;gap:11px;align-items:flex-start;background:var(--bg-3);border-left:4px solid ${done ? '#16a34a' : p.cor};border-radius:10px;padding:11px 13px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13.5px;${done ? 'text-decoration:line-through;opacity:.7' : ''}">
          <span class="cap-chip" style="background:${p.cor}1f;color:${p.cor};font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px">${p.lbl}</span>
          ${esc(n.titulo)}
        </div>
        ${n.texto ? `<div class="tiny muted" style="margin-top:3px;line-height:1.45;white-space:pre-wrap">${esc(n.texto)}</div>` : ''}
        <div class="tiny muted" style="margin-top:4px;opacity:.7">${esc(n.autor_nome || '')}${n.updated_at ? ' · ' + fmtDate(n.updated_at) : ''}</div>
      </div>
      <div class="flex gap-1" style="flex-shrink:0;align-self:center">
        <button class="btn btn-ghost btn-sm" data-note-done="${esc(n.id)}" title="${done ? 'Reabrir' : 'Marcar resolvido'}" style="padding:2px 7px">${done ? '↩' : '✅'}</button>
        <button class="btn btn-ghost btn-sm" data-note-edit="${esc(n.id)}" title="Editar" style="padding:2px 7px">✏️</button>
        <button class="btn btn-ghost btn-sm" data-note-del="${esc(n.id)}" title="Excluir" style="padding:2px 7px">🗑</button>
      </div>
    </div>`;
}

function bindManual() {
  const nw = document.getElementById('pa-note-new');
  if (nw) nw.addEventListener('click', () => openNoteForm(null));
  document.querySelectorAll('[data-note-edit]').forEach(b => b.addEventListener('click', () => openNoteForm(_notes.find(n => n.id === b.dataset.noteEdit))));
  document.querySelectorAll('[data-note-del]').forEach(b => b.addEventListener('click', () => delNote(b.dataset.noteDel)));
  document.querySelectorAll('[data-note-done]').forEach(b => b.addEventListener('click', () => toggleNote(b.dataset.noteDone)));
}

function openNoteForm(n) {
  n = n || {};
  const modal = document.getElementById('pa-modal');
  modal.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:24px;overflow:auto">
      <div class="card" style="max-width:540px;width:100%;background:var(--bg-2);margin:auto">
        <div class="flex" style="justify-content:space-between;align-items:center">
          <h3 class="card-title">${n.id ? '✏️ Editar' : '➕ Novo'} ponto de atenção</h3>
          <button class="btn btn-ghost btn-sm" id="pa-x">✕</button>
        </div>
        <div style="display:grid;gap:10px;margin-top:12px">
          <div><label class="tiny muted" style="font-weight:700">Título</label>
            <input id="pa-f-titulo" class="input" value="${esc(n.titulo || '')}" placeholder="Ex.: Renegociar contrato do proprietário X" style="width:100%" /></div>
          <div><label class="tiny muted" style="font-weight:700">Prioridade</label>
            <select id="pa-f-prio" class="input" style="width:100%">
              ${Object.entries(PRIO).map(([v, o]) => `<option value="${v}"${(n.prioridade || 'media') === v ? ' selected' : ''}>${o.lbl}</option>`).join('')}
            </select></div>
          <div><label class="tiny muted" style="font-weight:700">Detalhe</label>
            <textarea id="pa-f-texto" class="input" rows="4" style="width:100%" placeholder="Contexto, o que precisa ser feito, prazo…">${esc(n.texto || '')}</textarea></div>
        </div>
        <div id="pa-f-err" class="tiny" style="color:#dc2626;margin-top:8px"></div>
        <div class="flex gap-2 mt-3" style="justify-content:flex-end">
          <button class="btn btn-ghost" id="pa-cancel">Cancelar</button>
          <button class="btn btn-primary" id="pa-save">${n.id ? 'Salvar' : 'Adicionar'}</button>
        </div>
      </div>
    </div>`;
  const close = () => { modal.innerHTML = ''; };
  document.getElementById('pa-x').addEventListener('click', close);
  document.getElementById('pa-cancel').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
  document.getElementById('pa-save').addEventListener('click', () => saveNote(n));
}

async function saveNote(n) {
  const titulo = document.getElementById('pa-f-titulo').value.trim();
  if (!titulo) { document.getElementById('pa-f-err').textContent = 'O título é obrigatório.'; return; }
  const payload = {
    id: n.id || undefined, kind: 'atencao', titulo,
    prioridade: document.getElementById('pa-f-prio').value,
    texto: document.getElementById('pa-f-texto').value.trim(),
    status: n.status || 'aberto',
  };
  const btn = document.getElementById('pa-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const r = await api.request('/api/v3/diretoria/notes', { method: 'POST', body: payload });
    if (r && r.ok === false && r.pending) { document.getElementById('pa-f-err').textContent = r.error; btn.disabled = false; btn.textContent = 'Adicionar'; return; }
    document.getElementById('pa-modal').innerHTML = '';
    await reloadNotes();
  } catch (e) { document.getElementById('pa-f-err').textContent = e.message; btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function toggleNote(id) {
  const n = _notes.find(x => x.id === id);
  if (!n) return;
  try {
    await api.request('/api/v3/diretoria/notes', { method: 'POST', body: { id: n.id, kind: 'atencao', titulo: n.titulo, texto: n.texto, prioridade: n.prioridade, status: n.status === 'resolvido' ? 'aberto' : 'resolvido' } });
    await reloadNotes();
  } catch (e) { alert('Erro: ' + e.message); }
}

async function delNote(id) {
  const n = _notes.find(x => x.id === id);
  if (!confirm(`Excluir "${(n && n.titulo) || 'este ponto'}"?`)) return;
  try { await api.request('/api/v3/diretoria/notes?id=' + encodeURIComponent(id), { method: 'DELETE' }); await reloadNotes(); }
  catch (e) { alert('Erro: ' + e.message); }
}

function fmtDate(s) { try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } }

function sigRow(s) {
  const cor = s.sev === 'crit' ? '#dc2626' : '#d97706';
  const dot = s.sev === 'crit' ? '🔴' : '🟡';
  return `
    <div style="display:flex;gap:11px;align-items:flex-start;background:var(--bg-3);border-left:4px solid ${cor};border-radius:10px;padding:11px 13px">
      <div style="font-size:16px;line-height:1.2">${dot}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13.5px">${s.icon} ${esc(s.title)}</div>
        <div class="tiny muted" style="margin-top:2px;line-height:1.45">${esc(s.detail)}</div>
      </div>
      ${s.href ? `<a href="${s.href}" class="btn btn-ghost btn-sm" style="white-space:nowrap;align-self:center">${esc(s.hrefLabel || 'Abrir')} →</a>` : ''}
    </div>`;
}

function sumCard(label, n, color) {
  return `
    <div style="flex:1;min-width:120px;background:var(--bg-3);border-radius:var(--r-md);padding:12px 16px;border-left:4px solid ${color}">
      <div class="tiny muted" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">${label}</div>
      <div style="font-size:30px;font-weight:900;color:${color}">${n}</div>
    </div>`;
}

/* ─── helpers ─── */
function nomeCap(x) {
  return esc(x.endereco || x.nome_imovel || x.condominio || x.proprietario || x.localizacao || 'Imóvel');
}
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function km(n) {
  if (n == null) return '0';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
  return Math.round(v).toLocaleString('pt-BR');
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
