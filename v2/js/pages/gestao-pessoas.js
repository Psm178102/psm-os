/* PSM-OS v2 — Gestão de Pessoas (Sprint 8.1) */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { pageTalentos } from './talentos.js';

let _root = null;
let _ctx = null;
let _tab = 'treinamentos';
let _treinamentos = [];
let _editing = null;
let _rh = { onboarding: [], offboarding: [] };   // processos de admissão/desligamento (sócio)
const isSocio = () => (auth.user()?.lvl || 0) >= 10;
const SETORES = ['Comercial', 'SDR / Prospecção', 'Marketing', 'Backoffice', 'Financeiro', 'RH', 'Diretoria', 'Locação'];
const EQUIPES_COM = ['Conquista', 'MAP', 'Locação', 'Terceiros'];
let _trSetor = '', _trEquipe = '';   // filtros do Treinamentos

// Abas do hub de Pessoas, na ordem pedida (v81.52). Onboarding/Offboarding = só
// sócio (lvl 10); o resto = líder+ (lvl 5).
function visibleTabs() {
  const t = [{ id: 'treinamentos', lbl: '🎓 Treinamentos' }];
  if (isSocio()) t.push({ id: 'onboarding', lbl: '🚀 Onboarding' }, { id: 'offboarding', lbl: '👋 Offboarding' });
  t.push(
    { id: 'talentos', lbl: '🧲 Recrutamento & Seleção' },
    { id: 'plano', lbl: '📈 Plano de Crescimento' },
    { id: 'clima', lbl: '🌡 Clima Interno' },
    { id: 'avaliacoes', lbl: '⭐ Avaliações & Feedbacks' },
  );
  return t;
}

// Entradas diretas (deep-link) — cada aba é um item próprio na barra lateral (v81.55)
export async function pageOnboarding(ctx, root) { _tab = 'onboarding'; return pageGestaoPessoas(ctx, root); }
export async function pageOffboarding(ctx, root) { _tab = 'offboarding'; return pageGestaoPessoas(ctx, root); }
export async function pageRhTreinamentos(ctx, root) { _tab = 'treinamentos'; return pageGestaoPessoas(ctx, root); }
export async function pageRhRecrutamento(ctx, root) { _tab = 'talentos'; return pageGestaoPessoas(ctx, root); }
export async function pageRhPlano(ctx, root) { _tab = 'plano'; return pageGestaoPessoas(ctx, root); }
export async function pageRhClima(ctx, root) { _tab = 'clima'; return pageGestaoPessoas(ctx, root); }
export async function pageRhAvaliacoes(ctx, root) { _tab = 'avaliacoes'; return pageGestaoPessoas(ctx, root); }

export async function pageGestaoPessoas(ctx, root) {
  _root = root; _ctx = ctx;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+).</div>';
    return;
  }
  const valid = visibleTabs().map(t => t.id);
  if (!valid.includes(_tab)) _tab = valid[0];   // default = 1ª aba visível (sócio→Onboarding)
  render();
  await loadData();
}

// v81.56: cada aba é um item próprio no menu lateral — sem barra de abas interna.
// A página renderiza direto o conteúdo do módulo da rota (_tab) em #gp-body.
function render() {
  _root.innerHTML = `<div id="gp-body"></div>`;
}

async function loadData() {
  if (_tab === 'talentos') return pageTalentos(_ctx, document.getElementById('gp-body'));
  if (_tab === 'onboarding' || _tab === 'offboarding') return loadRH(_tab);
  if (_tab === 'plano' || _tab === 'clima' || _tab === 'avaliacoes') return loadReg(_tab);
  return loadTreinamentos();
}

async function loadTreinamentos() {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/treinamentos');
    _treinamentos = r.treinamentos || [];
    renderTreinamentos();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderTreinamentos() {
  const body = document.getElementById('gp-body');
  const ft = _treinamentos.filter(t => (!_trSetor || t.setor === _trSetor) && (!_trEquipe || t.equipe === _trEquipe));
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);margin-bottom:14px;padding:14px">
      <div style="font-weight:800;margin-bottom:8px">🎓 ${_editing?.id ? 'Editar' : 'Mapear'} Treinamento</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:8px">
        <input id="trt-titulo" class="input" placeholder="Título do treinamento *" value="${esc(_editing?.titulo || '')}">
        <input id="trt-publico" class="input" placeholder="Público-alvo" value="${esc(_editing?.publico || '')}">
        <select id="trt-tipo" class="select">
          ${['tecnico','comportamental','comercial','lideranca','integracao'].map(t => `<option value="${t}" ${_editing?.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <select id="trt-setor" class="select" title="Setor"><option value="">Setor…</option>${SETORES.map(s => `<option ${_editing?.setor === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select id="trt-equipe" class="select" title="Equipe comercial"><option value="">Equipe comercial…</option>${EQUIPES_COM.map(e => `<option ${_editing?.equipe === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
        <input id="trt-prazo" class="input" type="date" value="${esc(_editing?.prazo || '')}">
        <select id="trt-status" class="select">
          ${['planejado','em_andamento','concluido'].map(s => `<option value="${s}" ${_editing?.status === s ? 'selected' : ''}>${s.replace('_',' ')}</option>`).join('')}
        </select>
      </div>
      <textarea id="trt-conteudo" class="input mt-2" rows="2" placeholder="Conteúdo / objetivos / materiais">${esc(_editing?.conteudo || '')}</textarea>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-primary" id="trt-save">${_editing?.id ? '💾 Salvar' : '➕ Adicionar'}</button>
        ${_editing?.id ? '<button class="btn btn-ghost" id="trt-cancel">Cancelar</button>' : ''}
      </div>
    </div>
    <div class="flex gap-2 items-center" style="flex-wrap:wrap;margin-bottom:8px">
      <div style="font-weight:800">Treinamentos (${ft.length})</div>
      <select id="trf-setor" class="select" style="max-width:170px;margin-left:auto"><option value="">Todos os setores</option>${SETORES.map(s => `<option ${_trSetor === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="trf-equipe" class="select" style="max-width:170px"><option value="">Todas as equipes</option>${EQUIPES_COM.map(e => `<option ${_trEquipe === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
    </div>
    ${ft.length === 0 ? '<div class="muted tiny" style="text-align:center;padding:20px">Nenhum treinamento com esse filtro.</div>' : `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg-3)">
          <th style="text-align:left;padding:8px">Título</th>
          <th style="text-align:left;padding:8px">Setor / Equipe</th>
          <th style="text-align:left;padding:8px">Tipo</th>
          <th style="text-align:left;padding:8px">Prazo</th>
          <th style="text-align:left;padding:8px">Status</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${ft.map(t => `
            <tr style="border-bottom:1px solid var(--bd)">
              <td style="padding:8px"><div style="font-weight:700">${esc(t.titulo)}</div><div class="tiny muted">${esc(t.publico ? t.publico + ' · ' : '')}${esc((t.conteudo || '').substring(0, 70))}</div></td>
              <td style="padding:8px">${t.setor ? `<span class="tiny" style="background:rgba(14,165,233,.14);color:#0369a1;padding:1px 7px;border-radius:99px">${esc(t.setor)}</span>` : ''}${t.equipe ? ` <span class="tiny" style="background:rgba(22,163,74,.14);color:#15803d;padding:1px 7px;border-radius:99px">${esc(t.equipe)}</span>` : ''}${!t.setor && !t.equipe ? '<span class="muted">—</span>' : ''}</td>
              <td style="padding:8px">${esc(t.tipo || '—')}</td>
              <td style="padding:8px">${esc(t.prazo || '—')}</td>
              <td style="padding:8px"><span style="color:${t.status === 'concluido' ? '#22c55e' : t.status === 'em_andamento' ? '#f59e0b' : 'var(--muted)'};font-weight:700">${esc((t.status || '').replace('_',' '))}</span></td>
              <td style="padding:8px;text-align:right">
                <button class="btn btn-ghost btn-sm" data-edit-tr="${t.id}">✏️</button>
                <button class="btn btn-ghost btn-sm" data-del-tr="${t.id}">🗑️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  `;
  const fS = document.getElementById('trf-setor'); if (fS) fS.onchange = () => { _trSetor = fS.value; renderTreinamentos(); };
  const fE = document.getElementById('trf-equipe'); if (fE) fE.onchange = () => { _trEquipe = fE.value; renderTreinamentos(); };
  document.getElementById('trt-save').addEventListener('click', saveTreinamento);
  const cancel = document.getElementById('trt-cancel');
  if (cancel) cancel.addEventListener('click', () => { _editing = null; renderTreinamentos(); });
  body.querySelectorAll('[data-edit-tr]').forEach(b => b.addEventListener('click', () => {
    _editing = _treinamentos.find(x => x.id === b.dataset.editTr);
    renderTreinamentos();
  }));
  body.querySelectorAll('[data-del-tr]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover treinamento?')) return;
    try {
      await api.request('/api/v3/gp/treinamentos?id=' + encodeURIComponent(b.dataset.delTr), { method: 'DELETE' });
      loadTreinamentos();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

async function saveTreinamento() {
  const payload = {
    id: _editing?.id,
    titulo: document.getElementById('trt-titulo').value.trim(),
    publico: document.getElementById('trt-publico').value.trim(),
    tipo: document.getElementById('trt-tipo').value,
    setor: document.getElementById('trt-setor').value,
    equipe: document.getElementById('trt-equipe').value,
    prazo: document.getElementById('trt-prazo').value || null,
    status: document.getElementById('trt-status').value,
    conteudo: document.getElementById('trt-conteudo').value.trim(),
  };
  if (!payload.titulo) { alert('Título obrigatório'); return; }
  try {
    await api.request('/api/v3/gp/treinamentos', { method: 'POST', body: payload });
    _editing = null;
    await loadTreinamentos();
  } catch (e) { alert('Erro: ' + e.message); }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ════════════════════════════════════════════════════════════════════════
   ONBOARDING & OFFBOARDING (admissão / desligamento) — só sócio (lvl 10)
   Trilha por etapas com checklist. O template (etapas+itens) mora aqui; o
   backend (gp/rh_processos, shared_kv) só guarda nome/dados + quais itens
   estão marcados. Progresso = itens marcados / total do template. v81.44
═══════════════════════════════════════════════════════════════════════════ */
const RH_TPL = {
  onboarding: {
    titulo: '🚀 Onboarding — admissão', cor: '#16a34a', dataLbl: 'Data de início',
    sub: 'Trilha de entrada do novo colaborador — da papelada à rampa de produção.',
    campos: ['cargo', 'equipe', 'data', 'responsavel'],
    etapas: [
      { id: 'pre', lbl: '📄 Pré-início (documentação)', itens: [
        ['contrato', 'Contrato assinado'], ['docs', 'Documentos (RG, CPF, comprovante)'],
        ['creci', 'CRECI ativo / em transferência'], ['banco', 'Dados bancários p/ comissão'],
        ['lgpd', 'Termo LGPD + confidencialidade'] ] },
      { id: 'dia1', lbl: '🔑 Dia 1 (acessos)', itens: [
        ['login', 'Login House PSM criado'], ['rd', 'Acesso ao RD CRM'],
        ['wpp', 'WhatsApp corporativo'], ['email', 'E-mail / grupos'],
        ['time', 'Apresentação ao time'] ] },
      { id: 'sem1', lbl: '🎓 Semana 1 (formação)', itens: [
        ['academy', 'Trilha de boas-vindas (PSM Academy)'], ['cultura', 'Manual de Cultura + Código de Ética'],
        ['tabelas', 'Conhecer tabelas (Conquista/MAP) e lançamentos'], ['scripts', 'Scripts e cadências de atendimento'],
        ['shadow', 'Acompanhar 1 plantão (shadowing)'] ] },
      { id: 'mes1', lbl: '🚀 Mês 1 (rampa)', itens: [
        ['captacao', 'Primeira captação registrada'], ['visita', 'Primeiro atendimento / visita'],
        ['padrinho', 'Padrinho/líder de acompanhamento definido'], ['meta', 'Meta de rampa 30/60/90 definida'],
        ['oo', 'Primeira reunião 1:1 realizada'] ] },
    ],
  },
  offboarding: {
    titulo: '👋 Offboarding — desligamento', cor: '#ef4444', dataLbl: 'Data de saída',
    sub: 'Saída organizada: sem perder cliente, sem acesso solto, sem pendência financeira.',
    campos: ['cargo', 'equipe', 'motivo', 'data', 'responsavel', 'carteira_destino'],
    etapas: [
      { id: 'com', lbl: '📢 Comunicação', itens: [
        ['motivo', 'Motivo registrado (pediu/desligado)'], ['data', 'Data de saída definida'],
        ['lider', 'Líder e time comunicados'], ['aviso', 'Aviso prévio / acordo'] ] },
      { id: 'acessos', lbl: '🔒 Acessos (revogar)', itens: [
        ['login', 'Desativar login House PSM'], ['rd', 'Remover do RD CRM'],
        ['wpp', 'Sair dos grupos de WhatsApp'], ['email', 'Encerrar e-mail corporativo'],
        ['equip', 'Devolver equipamentos / materiais'] ] },
      { id: 'fin', lbl: '💰 Financeiro', itens: [
        ['comissoes', 'Acerto de comissões pendentes'], ['repasses', 'Repasses em aberto liquidados'],
        ['rescisao', 'Rescisão / quitação'] ] },
      { id: 'carteira', lbl: '🤝 Carteira (crítico — não perder cliente)', itens: [
        ['leads', 'Reatribuir leads/clientes ativos'], ['captacoes', 'Transferir captações em andamento'],
        ['herdeiro', 'Quem herda a carteira definido'] ] },
      { id: 'conhecimento', lbl: '🧠 Conhecimento', itens: [
        ['entrevista', 'Entrevista de saída'], ['doc', 'Documentar aprendizados / feedback'],
        ['confid', 'Termo de confidencialidade reforçado (LGPD)'] ] },
    ],
  },
};
const CARGOS = ['Corretor Conquista', 'Corretor MAP', 'Corretor Locação', 'Corretor Terceiros', 'SDR', 'Líder', 'Backoffice', 'Marketing', 'Financeiro', 'Outro'];
const EQUIPES = ['Conquista', 'MAP', 'Locação', 'Terceiros', '—'];
const MOTIVOS = ['Pediu demissão', 'Desligado', 'Fim de contrato', 'Outro'];

const tplItems = tipo => RH_TPL[tipo].etapas.flatMap(e => e.itens.map(([k]) => e.id + '.' + k));
function rhProgress(tipo, proc) {
  const all = tplItems(tipo);
  const done = all.filter(k => proc.checklist && proc.checklist[k]).length;
  return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
}

async function loadRH(tipo) {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/rh_processos');
    _rh = { onboarding: r.onboarding || [], offboarding: r.offboarding || [] };
    renderRH(tipo);
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderRH(tipo) {
  const T = RH_TPL[tipo];
  const list = _rh[tipo] || [];
  const ativos = list.filter(p => (p.status || 'em_andamento') !== 'concluido');
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:18px;font-weight:800;color:${T.cor}">${T.titulo}</div>
        <div class="tiny muted">${T.sub}</div>
      </div>
      <button class="btn btn-primary" id="rh-new">+ Novo processo</button>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-bottom:14px">
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Em andamento</div><div style="font-size:20px;font-weight:800;color:${T.cor}">${ativos.length}</div></div>
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Concluídos</div><div style="font-size:20px;font-weight:800">${list.length - ativos.length}</div></div>
      <div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div class="tiny muted">Total</div><div style="font-size:20px;font-weight:800">${list.length}</div></div>
    </div>
    ${!list.length
      ? `<div class="card muted tiny" style="text-align:center;padding:34px">Nenhum processo de ${tipo === 'onboarding' ? 'admissão' : 'desligamento'} ainda. Clique em <b>+ Novo processo</b>.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">${list.map(p => rhCard(tipo, p)).join('')}</div>`}`;
  document.getElementById('rh-new').onclick = () => openRHEditor(tipo, null);
  body.querySelectorAll('[data-rh-open]').forEach(b => b.onclick = () => openRHEditor(tipo, list.find(p => p.id === b.dataset.rhOpen)));
}

function rhCard(tipo, p) {
  const T = RH_TPL[tipo];
  const pr = rhProgress(tipo, p);
  const done = (p.status || 'em_andamento') === 'concluido';
  const barcor = done ? '#16a34a' : (pr.pct >= 67 ? '#16a34a' : pr.pct >= 34 ? '#f59e0b' : '#ef4444');
  return `
    <div class="card" style="padding:14px;cursor:pointer;border-left:4px solid ${T.cor}" data-rh-open="${esc(p.id)}">
      <div class="flex items-center" style="justify-content:space-between;gap:8px">
        <div style="font-weight:800;font-size:14px">${esc(p.nome || 'Sem nome')}</div>
        <span class="tiny" style="font-weight:800;color:${done ? '#16a34a' : T.cor}">${done ? '✓ Concluído' : pr.pct + '%'}</span>
      </div>
      <div class="tiny muted" style="margin:3px 0 8px">${esc(p.cargo || '—')}${p.equipe && p.equipe !== '—' ? ' · ' + esc(p.equipe) : ''}${p.data ? ' · ' + esc(p.data.split('-').reverse().join('/')) : ''}</div>
      <div style="height:7px;background:var(--bg-3,#e2e8f0);border-radius:99px;overflow:hidden"><div style="height:100%;width:${pr.pct}%;background:${barcor};transition:width .2s"></div></div>
      <div class="tiny muted" style="margin-top:5px">${pr.done}/${pr.total} itens${p.responsavel ? ' · 👤 ' + esc(p.responsavel) : ''}</div>
      ${tipo === 'offboarding' && p.carteira_destino ? `<div class="tiny" style="margin-top:5px;color:#0891b2;font-weight:700">🤝 carteira → ${esc(p.carteira_destino)}</div>` : ''}
    </div>`;
}

function openRHEditor(tipo, p0) {
  const T = RH_TPL[tipo];
  const p = p0 ? JSON.parse(JSON.stringify(p0)) : { checklist: {}, status: 'em_andamento' };
  if (!p.checklist) p.checklist = {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  const campo = (k) => {
    if (k === 'cargo') return `<div><label class="tiny muted">Cargo</label><select id="rh-cargo" class="select"><option value="">—</option>${CARGOS.map(c => `<option${p.cargo === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'equipe') return `<div><label class="tiny muted">Equipe</label><select id="rh-equipe" class="select">${EQUIPES.map(c => `<option${(p.equipe || '—') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'motivo') return `<div><label class="tiny muted">Motivo</label><select id="rh-motivo" class="select"><option value="">—</option>${MOTIVOS.map(c => `<option${p.motivo === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`;
    if (k === 'data') return `<div><label class="tiny muted">${T.dataLbl}</label><input id="rh-data" class="input" type="date" value="${esc((p.data || '').substring(0, 10))}"></div>`;
    if (k === 'responsavel') return `<div><label class="tiny muted">Responsável (padrinho/líder)</label><input id="rh-responsavel" class="input" value="${esc(p.responsavel || '')}" placeholder="Quem acompanha"></div>`;
    if (k === 'carteira_destino') return `<div><label class="tiny muted">🤝 Carteira vai pra</label><input id="rh-carteira_destino" class="input" value="${esc(p.carteira_destino || '')}" placeholder="Quem herda os leads/clientes"></div>`;
    return '';
  };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:620px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:4px;color:${T.cor}">${p.id ? 'Editar' : 'Novo'} — ${T.titulo}</div>
      <label class="tiny muted">Nome do colaborador *</label>
      <input id="rh-nome" class="input" value="${esc(p.nome || '')}" placeholder="Nome completo" style="margin-bottom:10px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:12px">
        ${T.campos.map(campo).join('')}
        <div><label class="tiny muted">Status</label><select id="rh-status" class="select"><option value="em_andamento"${(p.status || 'em_andamento') === 'em_andamento' ? ' selected' : ''}>Em andamento</option><option value="concluido"${p.status === 'concluido' ? ' selected' : ''}>Concluído</option></select></div>
      </div>
      <div style="font-weight:800;font-size:13px;margin-bottom:8px">✅ Checklist</div>
      <div id="rh-checklist">${T.etapas.map(e => `
        <div style="margin-bottom:12px">
          <div style="font-weight:700;font-size:12px;color:${T.cor};margin-bottom:5px">${e.lbl}</div>
          ${e.itens.map(([k, lbl]) => { const key = e.id + '.' + k; return `
            <label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;cursor:pointer;font-size:13px" onmouseover="this.style.background='var(--bg-3,#f1f5f9)'" onmouseout="this.style.background=''">
              <input type="checkbox" data-ck="${key}"${p.checklist[key] ? ' checked' : ''} style="width:16px;height:16px;cursor:pointer">
              <span>${esc(lbl)}</span>
            </label>`; }).join('')}
        </div>`).join('')}
      </div>
      <label class="tiny muted">Observações</label>
      <textarea id="rh-obs" class="input" rows="2" placeholder="Anotações do processo">${esc(p.obs || '')}</textarea>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="rh-del" ${p.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="rh-cancel">Cancelar</button><button class="btn btn-primary" id="rh-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#rh-cancel').onclick = () => ov.remove();
  ov.querySelector('#rh-save').onclick = async () => {
    const g = id => (ov.querySelector('#rh-' + id)?.value || '').trim();
    const checklist = {};
    ov.querySelectorAll('[data-ck]').forEach(c => { if (c.checked) checklist[c.dataset.ck] = true; });
    const proc = { id: p.id, nome: g('nome'), status: g('status') || 'em_andamento', obs: g('obs'), checklist };
    T.campos.forEach(k => { proc[k] = g(k); });
    if (!proc.nome) { ov.querySelector('#rh-nome').focus(); return; }
    ov.querySelector('#rh-save').disabled = true;
    try { await api.request('/api/v3/gp/rh_processos', { method: 'POST', body: { action: 'upsert', tipo, proc } }); ov.remove(); await loadRH(tipo); }
    catch (e) { alert('Erro ao salvar: ' + e.message); ov.querySelector('#rh-save').disabled = false; }
  };
  ov.querySelector('#rh-del').onclick = async () => {
    if (!p.id || !confirm('Excluir este processo?')) return;
    try { await api.request('/api/v3/gp/rh_processos', { method: 'POST', body: { action: 'delete', tipo, id: p.id } }); ov.remove(); await loadRH(tipo); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => ov.querySelector('#rh-nome')?.focus(), 50);
}

/* ════════════════════════════════════════════════════════════════════════
   MÓDULOS GENÉRICOS DE RH (Plano de Crescimento · Clima Interno · Avaliações)
   Lista de fichas via shared_kv (gp/rh_registros). O template (campos) mora
   aqui no front — adicionar campo/módulo é só editar isto. Líder+ (lvl 5). v81.52
═══════════════════════════════════════════════════════════════════════════ */
const REG_TPL = {
  plano: {
    titulo: '📈 Plano de Crescimento', cor: '#0ea5e9', titleField: 'pessoa',
    sub: 'Trilha de cargos e PDI: onde cada um está e o próximo passo.',
    campos: [
      { k: 'pessoa', lbl: 'Colaborador', type: 'text', req: true },
      { k: 'cargo_atual', lbl: 'Cargo atual', type: 'select', opts: CARGOS },
      { k: 'proximo_cargo', lbl: 'Próximo cargo (meta)', type: 'select', opts: CARGOS },
      { k: 'competencias', lbl: 'Competências a desenvolver', type: 'textarea' },
      { k: 'prazo', lbl: 'Prazo', type: 'date' },
      { k: 'status', lbl: 'Status', type: 'select', opts: ['Em andamento', 'No prazo', 'Atrasado', 'Concluído'] },
      { k: 'obs', lbl: 'Observações', type: 'textarea' },
    ],
    chips: r => [r.cargo_atual, r.proximo_cargo ? '→ ' + r.proximo_cargo : '', r.status].filter(Boolean),
  },
  clima: {
    titulo: '🌡 Clima Interno', cor: '#16a34a', titleField: 'periodo',
    sub: 'Pesquisas de clima / pulso — participação, eNPS e ações.',
    campos: [
      { k: 'periodo', lbl: 'Período (ex.: Jun/2026)', type: 'text', req: true },
      { k: 'participacao', lbl: 'Participação (%)', type: 'number' },
      { k: 'enps', lbl: 'eNPS (-100 a 100)', type: 'number' },
      { k: 'destaques', lbl: 'Destaques (o que está bom)', type: 'textarea' },
      { k: 'pontos_atencao', lbl: 'Pontos de atenção', type: 'textarea' },
      { k: 'acoes', lbl: 'Ações definidas', type: 'textarea' },
    ],
    chips: r => [r.participacao ? r.participacao + '% part.' : '', (r.enps !== undefined && r.enps !== '') ? 'eNPS ' + r.enps : ''].filter(Boolean),
  },
  avaliacoes: {
    titulo: '⭐ Avaliações & Feedbacks', cor: '#f59e0b', titleField: 'pessoa',
    sub: 'Avaliações de desempenho e feedbacks estruturados por colaborador.',
    campos: [
      { k: 'pessoa', lbl: 'Colaborador', type: 'text', req: true },
      { k: 'periodo', lbl: 'Período / ciclo', type: 'text' },
      { k: 'nota', lbl: 'Nota (0–10)', type: 'number' },
      { k: 'pontos_fortes', lbl: 'Pontos fortes', type: 'textarea' },
      { k: 'a_desenvolver', lbl: 'A desenvolver', type: 'textarea' },
      { k: 'feedback', lbl: 'Feedback', type: 'textarea' },
      { k: 'proximos_passos', lbl: 'Próximos passos', type: 'textarea' },
    ],
    chips: r => [r.periodo, (r.nota !== undefined && r.nota !== '') ? 'nota ' + r.nota : ''].filter(Boolean),
  },
};

let _regs = { plano: [], clima: [], avaliacoes: [] };

async function loadReg(modulo) {
  const body = document.getElementById('gp-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando…</div>';
  try {
    const r = await api.request('/api/v3/gp/rh_registros');
    const reg = (r && r.registros) || {};
    _regs = { plano: reg.plano || [], clima: reg.clima || [], avaliacoes: reg.avaliacoes || [] };
    renderReg(modulo);
  } catch (e) { body.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

function renderReg(modulo) {
  const T = REG_TPL[modulo], list = _regs[modulo] || [];
  const body = document.getElementById('gp-body');
  body.innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div><div style="font-size:17px;font-weight:800;color:${T.cor}">${T.titulo}</div><div class="tiny muted">${T.sub}</div></div>
      <button class="btn btn-primary" id="reg-new">+ Nova ficha</button>
    </div>
    ${!list.length ? `<div class="card muted tiny" style="text-align:center;padding:30px">Nenhuma ficha ainda. Clique em <b>+ Nova ficha</b>.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${list.map(r => regCard(modulo, r)).join('')}</div>`}`;
  document.getElementById('reg-new').onclick = () => openRegEditor(modulo, null);
  body.querySelectorAll('[data-reg]').forEach(b => b.onclick = () => openRegEditor(modulo, list.find(r => r.id === b.dataset.reg)));
}

function regCard(modulo, r) {
  const T = REG_TPL[modulo];
  const title = r[T.titleField] || '—';
  const chips = (T.chips(r) || []).map(c => `<span style="background:${T.cor}1f;color:${T.cor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px">${esc(c)}</span>`).join(' ');
  const pf = T.campos.find(c => c.type === 'textarea' && r[c.k]);
  const prev = pf ? esc(String(r[pf.k]).slice(0, 90)) : '';
  return `<div class="card" style="padding:13px;cursor:pointer;border-left:4px solid ${T.cor}" data-reg="${esc(r.id)}">
    <div style="font-weight:800;font-size:14px">${esc(title)}</div>
    <div class="flex gap-1" style="flex-wrap:wrap;margin:6px 0">${chips}</div>
    ${prev ? `<div class="tiny muted">${prev}${String(r[pf.k]).length > 90 ? '…' : ''}</div>` : ''}
  </div>`;
}

function openRegEditor(modulo, r0) {
  const T = REG_TPL[modulo], r = r0 ? { ...r0 } : {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  const field = c => {
    const v = r[c.k] != null ? r[c.k] : '';
    if (c.type === 'textarea') return `<div><label class="tiny muted">${c.lbl}</label><textarea id="rg-${c.k}" class="input" rows="2">${esc(v)}</textarea></div>`;
    if (c.type === 'select') return `<div><label class="tiny muted">${c.lbl}</label><select id="rg-${c.k}" class="select"><option value="">—</option>${c.opts.map(o => `<option${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    const t = c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text';
    return `<div><label class="tiny muted">${c.lbl}</label><input id="rg-${c.k}" class="input" type="${t}" value="${esc(c.type === 'date' ? String(v).slice(0, 10) : v)}"></div>`;
  };
  ov.innerHTML = `
    <div style="background:var(--bg-1,#fff);border-radius:14px;max-width:520px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800;margin-bottom:12px;color:${T.cor}">${r.id ? 'Editar' : 'Nova'} — ${T.titulo}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${T.campos.map(field).join('')}</div>
      <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn-ghost" id="rg-del" ${r.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
        <div class="flex gap-2"><button class="btn btn-ghost" id="rg-cancel">Cancelar</button><button class="btn btn-primary" id="rg-save">Salvar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#rg-cancel').onclick = () => ov.remove();
  ov.querySelector('#rg-save').onclick = async () => {
    const rec = { id: r.id };
    T.campos.forEach(c => { const el = ov.querySelector('#rg-' + c.k); if (el) rec[c.k] = (el.value || '').trim(); });
    const reqF = T.campos.find(c => c.req);
    if (reqF && !rec[reqF.k]) { ov.querySelector('#rg-' + reqF.k).focus(); return; }
    ov.querySelector('#rg-save').disabled = true;
    try { await api.request('/api/v3/gp/rh_registros', { method: 'POST', body: { action: 'upsert', modulo, registro: rec } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); ov.querySelector('#rg-save').disabled = false; }
  };
  ov.querySelector('#rg-del').onclick = async () => {
    if (!r.id || !confirm('Excluir esta ficha?')) return;
    try { await api.request('/api/v3/gp/rh_registros', { method: 'POST', body: { action: 'delete', modulo, id: r.id } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => { const f = ov.querySelector('.input'); if (f) f.focus(); }, 50);
}
