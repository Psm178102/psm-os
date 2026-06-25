/* ============================================================================
   PSM-OS v2 — Sucesso do Cliente (Customer Success)  v81.53
   ----------------------------------------------------------------------------
   Hub com 9 abas. HÍBRIDO: a Carteira vem AUTOMÁTICA dos negócios ganhos no RD
   (nome, LTV, categoria pelo funil) e você ENRIQUECE (status/score/renovação/
   satisfação). As Métricas (churn/retenção/LTV/score) saem disso, geral + por
   categoria. Os outros 7 módulos são listas de fichas (cs/registros genérico).
   Gated em líder+ (lvl 5). Quem vê = matriz por papel.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const BRL = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtData = d => d ? String(d).substring(0, 10).split('-').reverse().join('/') : '—';

const CAT = ['MAP', 'Conquista', 'Locação', 'Terceiros'];
const CAT_COR = { MAP: '#8b5cf6', Conquista: '#16a34a', 'Locação': '#0ea5e9', Terceiros: '#f59e0b', Outros: '#64748b' };
const STAT = { ativo: { l: 'Ativo', c: '#16a34a' }, em_risco: { l: 'Em risco', c: '#f59e0b' }, churn: { l: 'Churn', c: '#ef4444' }, renovado: { l: 'Renovado', c: '#0891b2' } };

const TABS = [
  { id: 'onb_cliente', lbl: '🚀 Onboarding do Cliente' },
  { id: 'carteira', lbl: '💼 Gestão de Carteira' },
  { id: 'suporte', lbl: '📞 Relacionamento & Suporte' },
  { id: 'retencao', lbl: '🔄 Retenção & Renovação' },
  { id: 'metricas', lbl: '📊 Métricas' },
  { id: 'upsell', lbl: '📈 Upsell & Cross-sell' },
  { id: 'marketing', lbl: '⭐ Customer Marketing' },
  { id: 'avaliacoes', lbl: '🌟 Avaliações de Atendimento' },
  { id: 'indicacoes', lbl: '🎁 Programa de Indicações' },
];

const REG = {
  onb_cliente: { titulo: '🚀 Onboarding do Cliente', cor: '#16a34a', titleField: 'cliente', sub: 'Jornada de entrada do cliente, por categoria.',
    campos: [{ k: 'cliente', lbl: 'Cliente', type: 'text', req: true }, { k: 'categoria', lbl: 'Categoria', type: 'select', opts: CAT },
      { k: 'etapa', lbl: 'Etapa', type: 'select', opts: ['Boas-vindas', 'Documentação', 'Configuração/Acesso', 'Acompanhamento', 'Concluído'] },
      { k: 'responsavel', lbl: 'Responsável', type: 'text' }, { k: 'data', lbl: 'Data', type: 'date' }, { k: 'obs', lbl: 'Observações', type: 'textarea' }],
    chips: r => [r.categoria, r.etapa].filter(Boolean) },
  suporte: { titulo: '📞 Relacionamento & Suporte', cor: '#0ea5e9', titleField: 'cliente', sub: 'Tickets e contatos de relacionamento.',
    campos: [{ k: 'cliente', lbl: 'Cliente', type: 'text', req: true }, { k: 'categoria', lbl: 'Categoria', type: 'select', opts: CAT },
      { k: 'assunto', lbl: 'Assunto', type: 'text' }, { k: 'canal', lbl: 'Canal', type: 'select', opts: ['WhatsApp', 'Ligação', 'E-mail', 'Presencial'] },
      { k: 'prioridade', lbl: 'Prioridade', type: 'select', opts: ['Baixa', 'Média', 'Alta'] },
      { k: 'status', lbl: 'Status', type: 'select', opts: ['Aberto', 'Em andamento', 'Resolvido'] }, { k: 'descricao', lbl: 'Descrição', type: 'textarea' }],
    chips: r => [r.categoria, r.status, r.prioridade ? '⚑ ' + r.prioridade : ''].filter(Boolean) },
  retencao: { titulo: '🔄 Retenção & Renovação', cor: '#8b5cf6', titleField: 'cliente', sub: 'Renovações, riscos de churn e reativações.',
    campos: [{ k: 'cliente', lbl: 'Cliente', type: 'text', req: true }, { k: 'categoria', lbl: 'Categoria', type: 'select', opts: CAT },
      { k: 'tipo', lbl: 'Tipo', type: 'select', opts: ['Renovação', 'Risco de churn', 'Reativação'] }, { k: 'data_alvo', lbl: 'Data alvo', type: 'date' },
      { k: 'valor', lbl: 'Valor (R$)', type: 'number' }, { k: 'status', lbl: 'Status', type: 'select', opts: ['A fazer', 'Em negociação', 'Renovado', 'Perdido'] }, { k: 'obs', lbl: 'Observações', type: 'textarea' }],
    chips: r => [r.categoria, r.tipo, r.status].filter(Boolean) },
  upsell: { titulo: '📈 Upsell & Cross-sell', cor: '#f59e0b', titleField: 'cliente', sub: 'Oportunidades de aumentar ticket e portfólio.',
    campos: [{ k: 'cliente', lbl: 'Cliente', type: 'text', req: true }, { k: 'categoria', lbl: 'Categoria', type: 'select', opts: CAT },
      { k: 'oferta', lbl: 'Oferta', type: 'text' }, { k: 'tipo', lbl: 'Tipo', type: 'select', opts: ['Upsell', 'Cross-sell'] },
      { k: 'valor_potencial', lbl: 'Valor potencial (R$)', type: 'number' }, { k: 'status', lbl: 'Status', type: 'select', opts: ['Identificado', 'Proposto', 'Fechado', 'Perdido'] }, { k: 'obs', lbl: 'Observações', type: 'textarea' }],
    chips: r => [r.categoria, r.tipo, r.status].filter(Boolean) },
  marketing: { titulo: '⭐ Customer Marketing', cor: '#d6249f', titleField: 'cliente', sub: 'Depoimentos, cases e provas sociais de clientes felizes.',
    campos: [{ k: 'cliente', lbl: 'Cliente', type: 'text', req: true }, { k: 'tipo', lbl: 'Tipo', type: 'select', opts: ['Depoimento', 'Case', 'Avaliação', 'Foto/Vídeo'] },
      { k: 'conteudo', lbl: 'Conteúdo', type: 'textarea' }, { k: 'link', lbl: 'Link', type: 'text' }, { k: 'status', lbl: 'Status', type: 'select', opts: ['Coletado', 'Aprovado', 'Publicado'] }, { k: 'obs', lbl: 'Observações', type: 'textarea' }],
    chips: r => [r.tipo, r.status].filter(Boolean) },
  avaliacoes: { titulo: '🌟 Avaliações de Atendimento', cor: '#16a34a', titleField: 'cliente', sub: 'Notas e comentários de atendimento (NPS/CSAT).',
    campos: [{ k: 'cliente', lbl: 'Cliente', type: 'text', req: true }, { k: 'categoria', lbl: 'Categoria', type: 'select', opts: CAT },
      { k: 'nota', lbl: 'Nota (0–10)', type: 'number' }, { k: 'canal', lbl: 'Canal', type: 'select', opts: ['WhatsApp', 'Ligação', 'E-mail', 'Presencial'] },
      { k: 'comentario', lbl: 'Comentário', type: 'textarea' }, { k: 'data', lbl: 'Data', type: 'date' }],
    chips: r => [r.categoria, (r.nota !== undefined && r.nota !== '') ? 'nota ' + r.nota : ''].filter(Boolean) },
  indicacoes: { titulo: '🎁 Programa de Indicações', cor: '#0891b2', titleField: 'indicado', sub: 'Indicações por categoria — de quem veio e status.',
    campos: [{ k: 'indicado', lbl: 'Indicado (novo cliente)', type: 'text', req: true }, { k: 'indicador', lbl: 'Quem indicou', type: 'text' },
      { k: 'categoria', lbl: 'Categoria', type: 'select', opts: CAT }, { k: 'status', lbl: 'Status', type: 'select', opts: ['Recebida', 'Em contato', 'Convertida', 'Perdida'] },
      { k: 'recompensa', lbl: 'Recompensa', type: 'text' }, { k: 'obs', lbl: 'Observações', type: 'textarea' }],
    chips: r => [r.categoria, r.status, r.indicador ? 'por ' + r.indicador : ''].filter(Boolean) },
};

let _root = null, _tab = 'carteira', _regs = {}, _cli = null;

export async function pageSucessoCliente(ctx, root) {
  _root = root;
  // v81.56: cada aba é item do menu lateral — sem barra de abas interna.
  root.innerHTML = `<div id="sc-body"></div>`;
  route();
}

// Entradas diretas (deep-link) — cada aba vira item próprio na barra lateral (v81.55)
const _entry = tab => async (ctx, root) => { _tab = tab; return pageSucessoCliente(ctx, root); };
export const pageSCOnboarding = _entry('onb_cliente');
export const pageSCCarteira = _entry('carteira');
export const pageSCSuporte = _entry('suporte');
export const pageSCRetencao = _entry('retencao');
export const pageSCMetricas = _entry('metricas');
export const pageSCUpsell = _entry('upsell');
export const pageSCMarketing = _entry('marketing');
export const pageSCAvaliacoes = _entry('avaliacoes');
export const pageSCIndicacoes = _entry('indicacoes');
const body = () => _root.querySelector('#sc-body');
function renderTabs() {
  _root.querySelector('#sc-tabs').innerHTML = TABS.map(t => {
    const on = t.id === _tab;
    return `<button class="sc-tb" data-t="${t.id}" style="background:none;border:none;padding:9px 13px;cursor:pointer;font-weight:800;font-size:13px;white-space:nowrap;border-bottom:3px solid ${on ? '#0891b2' : 'transparent'};color:${on ? 'var(--ink,#0f172a)' : 'var(--ink-muted,#64748b)'}">${t.lbl}</button>`;
  }).join('');
  _root.querySelectorAll('.sc-tb').forEach(b => b.onclick = () => { _tab = b.dataset.t; renderTabs(); route(); });
}
function route() {
  if (_tab === 'carteira') return loadCarteira();
  if (_tab === 'metricas') return loadMetricas();
  return loadReg(_tab);
}

/* ─────────── CARTEIRA + MÉTRICAS (cs/clientes — RD + enriquecimento) ─────────── */
let _fCat = '', _fStat = '';
async function fetchClientes() {
  if (_cli) return _cli;
  const r = await api.request('/api/v3/cs/clientes');
  _cli = r || {};
  return _cli;
}
async function loadCarteira() {
  body().innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando carteira do RD…</div></div>';
  try { _cli = null; await fetchClientes(); renderCarteira(); }
  catch (e) { body().innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; }
}
function renderCarteira() {
  const all = (_cli.clientes || []);
  const list = all.filter(c => (!_fCat || c.categoria === _fCat) && (!_fStat || c.status === _fStat));
  body().innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div><div style="font-size:18px;font-weight:800">💼 Gestão de Carteira</div><div class="tiny muted">Clientes dos negócios ganhos no RD — enriqueça status, score e renovação.</div></div>
      <div class="flex gap-2">
        <select id="ca-cat" class="select" style="max-width:150px"><option value="">Todas categorias</option>${CAT.concat('Outros').map(c => `<option${_fCat === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
        <select id="ca-stat" class="select" style="max-width:140px"><option value="">Todos status</option>${Object.keys(STAT).map(s => `<option value="${s}"${_fStat === s ? ' selected' : ''}>${STAT[s].l}</option>`).join('')}</select>
      </div>
    </div>
    ${!all.length ? `<div class="card muted tiny" style="text-align:center;padding:34px">Nenhum negócio ganho no RD ainda. Quando houver vendas fechadas, os clientes aparecem aqui automaticamente.</div>`
      : `<div class="tiny muted" style="margin-bottom:8px">${list.length} cliente(s) · LTV total ${BRL(list.reduce((a, c) => a + (c.ltv || 0), 0))}</div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="text-align:left;color:var(--ink-muted,#64748b)"><th style="padding:7px 10px">Cliente</th><th style="padding:7px 10px">Categoria</th><th style="padding:7px 10px;text-align:right">LTV</th><th style="padding:7px 10px">Status</th><th style="padding:7px 10px">Score</th><th style="padding:7px 10px">Últ. compra</th><th></th></tr></thead>
          <tbody>${list.map(cliRow).join('')}</tbody></table></div>`}`;
  const fc = body().querySelector('#ca-cat'); if (fc) fc.onchange = () => { _fCat = fc.value; renderCarteira(); };
  const fs = body().querySelector('#ca-stat'); if (fs) fs.onchange = () => { _fStat = fs.value; renderCarteira(); };
  body().querySelectorAll('[data-enr]').forEach(b => b.onclick = () => openEnrich(all.find(c => c.key === b.dataset.enr)));
}
function cliRow(c) {
  const st = STAT[c.status] || STAT.ativo;
  const cc = CAT_COR[c.categoria] || '#64748b';
  return `<tr style="border-top:1px solid var(--bd,#e2e8f0)">
    <td style="padding:7px 10px;font-weight:700">${esc(c.nome)}${c.n_negocios > 1 ? ` <span class="tiny muted">(${c.n_negocios})</span>` : ''}</td>
    <td style="padding:7px 10px"><span class="tiny" style="background:${cc}1f;color:${cc};padding:1px 8px;border-radius:99px;font-weight:700">${esc(c.categoria)}</span></td>
    <td style="padding:7px 10px;text-align:right;font-weight:700">${BRL(c.ltv)}</td>
    <td style="padding:7px 10px"><span style="color:${st.c};font-weight:700">●</span> ${st.l}</td>
    <td style="padding:7px 10px">${c.score != null && c.score !== '' ? c.score : '<span class="muted">—</span>'}</td>
    <td style="padding:7px 10px;white-space:nowrap">${fmtData(c.ultima_compra)}</td>
    <td style="padding:7px 10px;text-align:right"><button class="btn btn-ghost btn-sm" data-enr="${esc(c.key)}">✏️ Enriquecer</button></td></tr>`;
}
function openEnrich(c) {
  if (!c) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  ov.innerHTML = `<div style="background:var(--bg-1,#fff);border-radius:14px;max-width:460px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
    <div style="font-size:17px;font-weight:800;margin-bottom:2px">${esc(c.nome)}</div>
    <div class="tiny muted" style="margin-bottom:12px">LTV ${BRL(c.ltv)} · ${c.n_negocios} negócio(s) · última ${fmtData(c.ultima_compra)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div><label class="tiny muted">Categoria</label><select id="en-categoria" class="select">${CAT.concat('Outros').map(o => `<option${c.categoria === o ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      <div><label class="tiny muted">Status</label><select id="en-status" class="select">${Object.keys(STAT).map(s => `<option value="${s}"${c.status === s ? ' selected' : ''}>${STAT[s].l}</option>`).join('')}</select></div>
      <div><label class="tiny muted">Score saúde (0–100)</label><input id="en-score" class="input" type="number" min="0" max="100" value="${c.score != null ? esc(c.score) : ''}"></div>
      <div><label class="tiny muted">Satisfação</label><select id="en-satisfacao" class="select"><option value="">—</option>${['😀 Promotor', '😐 Neutro', '😞 Detrator'].map(o => `<option${c.satisfacao === o ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      <div><label class="tiny muted">Próxima renovação</label><input id="en-proxima_renovacao" class="input" type="date" value="${esc((c.proxima_renovacao || '').substring(0, 10))}"></div>
    </div>
    <label class="tiny muted" style="margin-top:6px;display:block">Observações</label><textarea id="en-obs" class="input" rows="2">${esc(c.obs || '')}</textarea>
    <div class="flex gap-2 mt-3" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-ghost" id="en-cancel">Cancelar</button><button class="btn btn-primary" id="en-save">Salvar</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#en-cancel').onclick = () => ov.remove();
  ov.querySelector('#en-save').onclick = async () => {
    const g = id => ov.querySelector('#en-' + id)?.value || '';
    const dados = { categoria: g('categoria'), status: g('status'), score: g('score'), satisfacao: g('satisfacao'), proxima_renovacao: g('proxima_renovacao'), obs: g('obs') };
    ov.querySelector('#en-save').disabled = true;
    try { await api.request('/api/v3/cs/clientes', { method: 'POST', body: { action: 'enrich', key: c.key, dados } }); ov.remove(); await loadCarteira(); }
    catch (e) { alert('Erro: ' + e.message); ov.querySelector('#en-save').disabled = false; }
  };
}

async function loadMetricas() {
  body().innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Calculando métricas…</div></div>';
  try { _cli = null; await fetchClientes(); renderMetricas(); }
  catch (e) { body().innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message)}</div>`; }
}
function kpiRow(m, label, cor) {
  return `<div class="card" style="padding:12px">
    <div style="font-weight:800;margin-bottom:8px;color:${cor || 'inherit'}">${esc(label)} <span class="tiny muted">· ${m.clientes} cliente(s)</span></div>
    <div class="flex gap-2" style="flex-wrap:wrap">
      ${[['LTV total', BRL(m.ltv_total)], ['LTV médio', BRL(m.ltv_medio)], ['Retenção', m.retencao_pct + '%'], ['Churn', m.churn_pct + '%'], ['Score médio', m.score_medio != null ? m.score_medio : '—'], ['Em risco', m.em_risco], ['Renovados', m.renovados]]
        .map(([l, v]) => `<div style="flex:1;min-width:92px"><div class="tiny muted">${l}</div><div style="font-size:17px;font-weight:800">${v}</div></div>`).join('')}
    </div></div>`;
}
function renderMetricas() {
  const M = _cli.metrics || { geral: {}, por_categoria: {} };
  if (!(M.geral && M.geral.clientes)) { body().innerHTML = `<div class="card muted tiny" style="text-align:center;padding:34px">Sem clientes na carteira ainda — as métricas aparecem quando houver negócios ganhos no RD.</div>`; return; }
  const cats = Object.keys(M.por_categoria || {});
  body().innerHTML = `
    <div style="font-size:18px;font-weight:800;margin-bottom:4px">📊 Métricas de Sucesso do Cliente</div>
    <div class="tiny muted" style="margin-bottom:12px">% churn, % retenção, LTV e score — visão geral e por categoria. Score/status vêm do enriquecimento da Carteira.</div>
    <div style="display:grid;gap:12px">
      ${kpiRow(M.geral, '🌐 Geral')}
      ${cats.map(cat => kpiRow(M.por_categoria[cat], (CAT_COR[cat] ? '' : '') + cat, CAT_COR[cat])).join('')}
    </div>
    ${!cats.length ? '<div class="tiny muted" style="margin-top:10px">Classifique a categoria dos clientes na Carteira pra ver o detalhamento por MAP/Conquista/Locação/Terceiros.</div>' : ''}`;
}

/* ─────────── MÓDULOS DE PROCESSO (cs/registros genérico) ─────────── */
async function loadReg(modulo) {
  body().innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    const r = await api.request('/api/v3/cs/registros');
    _regs = (r && r.registros) || {};
    renderReg(modulo);
  } catch (e) { body().innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}
let _fRegCat = '';
function renderReg(modulo) {
  const T = REG[modulo], all = _regs[modulo] || [];
  const temCat = T.campos.some(c => c.k === 'categoria');
  const list = (temCat && _fRegCat) ? all.filter(r => r.categoria === _fRegCat) : all;
  body().innerHTML = `
    <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div><div style="font-size:18px;font-weight:800;color:${T.cor}">${T.titulo}</div><div class="tiny muted">${T.sub}</div></div>
      <div class="flex gap-2">
        ${temCat ? `<select id="rg-fcat" class="select" style="max-width:150px"><option value="">Todas categorias</option>${CAT.map(c => `<option${_fRegCat === c ? ' selected' : ''}>${c}</option>`).join('')}</select>` : ''}
        <button class="btn btn-primary" id="rg-new">+ Nova ficha</button>
      </div>
    </div>
    ${!list.length ? `<div class="card muted tiny" style="text-align:center;padding:30px">Nenhuma ficha${_fRegCat ? ' nessa categoria' : ''} ainda.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${list.map(r => regCard(modulo, r)).join('')}</div>`}`;
  const fc = body().querySelector('#rg-fcat'); if (fc) fc.onchange = () => { _fRegCat = fc.value; renderReg(modulo); };
  body().querySelector('#rg-new').onclick = () => openRegEditor(modulo, null);
  body().querySelectorAll('[data-rg]').forEach(b => b.onclick = () => openRegEditor(modulo, all.find(r => r.id === b.dataset.rg)));
}
function regCard(modulo, r) {
  const T = REG[modulo];
  const chips = (T.chips(r) || []).map(c => `<span style="background:${T.cor}1f;color:${T.cor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px">${esc(c)}</span>`).join(' ');
  const pf = T.campos.find(c => c.type === 'textarea' && r[c.k]);
  const prev = pf ? esc(String(r[pf.k]).slice(0, 90)) : '';
  return `<div class="card" style="padding:13px;cursor:pointer;border-left:4px solid ${T.cor}" data-rg="${esc(r.id)}">
    <div style="font-weight:800;font-size:14px">${esc(r[T.titleField] || '—')}</div>
    <div class="flex gap-1" style="flex-wrap:wrap;margin:6px 0">${chips}</div>
    ${prev ? `<div class="tiny muted">${prev}${String(r[pf.k]).length > 90 ? '…' : ''}</div>` : ''}</div>`;
}
function openRegEditor(modulo, r0) {
  const T = REG[modulo], r = r0 ? { ...r0 } : {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  const field = c => {
    const v = r[c.k] != null ? r[c.k] : '';
    if (c.type === 'textarea') return `<div><label class="tiny muted">${c.lbl}</label><textarea id="f-${c.k}" class="input" rows="2">${esc(v)}</textarea></div>`;
    if (c.type === 'select') return `<div><label class="tiny muted">${c.lbl}</label><select id="f-${c.k}" class="select"><option value="">—</option>${c.opts.map(o => `<option${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    const t = c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text';
    return `<div><label class="tiny muted">${c.lbl}</label><input id="f-${c.k}" class="input" type="${t}" value="${esc(c.type === 'date' ? String(v).slice(0, 10) : v)}"></div>`;
  };
  ov.innerHTML = `<div style="background:var(--bg-1,#fff);border-radius:14px;max-width:520px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto">
    <div style="font-size:17px;font-weight:800;margin-bottom:12px;color:${T.cor}">${r.id ? 'Editar' : 'Nova'} — ${T.titulo}</div>
    <div style="display:flex;flex-direction:column;gap:8px">${T.campos.map(field).join('')}</div>
    <div class="flex gap-2 mt-3" style="justify-content:space-between;margin-top:14px">
      <button class="btn btn-ghost" id="f-del" ${r.id ? '' : 'style="visibility:hidden"'}>🗑 Excluir</button>
      <div class="flex gap-2"><button class="btn btn-ghost" id="f-cancel">Cancelar</button><button class="btn btn-primary" id="f-save">Salvar</button></div>
    </div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#f-cancel').onclick = () => ov.remove();
  ov.querySelector('#f-save').onclick = async () => {
    const rec = { id: r.id };
    T.campos.forEach(c => { const el = ov.querySelector('#f-' + c.k); if (el) rec[c.k] = (el.value || '').trim(); });
    const reqF = T.campos.find(c => c.req);
    if (reqF && !rec[reqF.k]) { ov.querySelector('#f-' + reqF.k).focus(); return; }
    ov.querySelector('#f-save').disabled = true;
    try { await api.request('/api/v3/cs/registros', { method: 'POST', body: { action: 'upsert', modulo, registro: rec } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); ov.querySelector('#f-save').disabled = false; }
  };
  ov.querySelector('#f-del').onclick = async () => {
    if (!r.id || !confirm('Excluir esta ficha?')) return;
    try { await api.request('/api/v3/cs/registros', { method: 'POST', body: { action: 'delete', modulo, id: r.id } }); ov.remove(); await loadReg(modulo); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  setTimeout(() => { const f = ov.querySelector('.input'); if (f) f.focus(); }, 50);
}
