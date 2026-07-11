/* PSM-OS v2 — 👁 Painel de Fiscalização (v84.18)
   Produção DIÁRIA da equipe de apoio (Leire · Mariane · Guilherme) com registro
   NO ATO (1 clique = 1 evento imutável), semáforo por horário e alertas.
   Visão gestor (lvl>=7): 3 cards lado a lado · Visão individual: card em tela cheia.
   Backend: /api/v3/producao/painel (agregados) + /api/v3/producao/eventos (log). */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _busy = false, _undo = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COR = { verde: '#16a34a', amarelo: '#d97706', vermelho: '#dc2626' };
const NOME_TIPO = {
  reativacao_tocada: 'Reativações', avaliacao_agendada: 'Avaliações agendadas',
  captacao_fechada: 'Captações fechadas', doc_aberto: 'Docs recebidos', doc_resolvido: 'Docs resolvidos',
  ticket_locacao_aberto: 'Tickets abertos', ticket_locacao_respondido: 'Tickets respondidos',
  abordagem_indicacao: 'Abordagens de indicação', indicacao_qualificada: 'Indicações qualificadas',
  nps_coletado: 'NPS coletados', venda_atribuida_indicacao: 'Vendas por indicação',
  contrato_locacao: 'Contratos de locação', conteudo_entregue: 'Conteúdos entregues',
  video_conquista: '🎬 Vídeos Conquista', video_map: '🎬 Vídeos MAP',
  art_conquista: '🎨 Arts Conquista', art_map: '🎨 Arts MAP',
};

export async function pageProducao(ctx, root) {
  _root = root;
  await reload();
  // tempo real: recarrega no pulso do app + fallback 30s (para quando sai da tela)
  const tick = setInterval(() => {
    if (!document.getElementById('fisc-root')) { clearInterval(tick); return; }
    reload(true);
  }, 30000);
}

async function reload(silencioso = false) {
  if (!_root) return;
  if (!silencioso) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando produção do dia…</div></div>';
  try {
    _d = await api.request('/api/v3/producao/painel');
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  render();
}

/* ── log rápido ─────────────────────────────────────────────────────────── */
async function log(colab, tipo, extras = {}) {
  if (_busy) return;
  _busy = true;
  try {
    const r = await api.request('/api/v3/producao/eventos', {
      method: 'POST', body: { colaborador: colab, tipo, ...extras } });
    _undo = { id: r.id, ate: Date.now() + 85000 };
    if (r.premio != null) alert(`💰 Prêmio de indicação pela faixa: ${brl(r.premio)}`);
  } catch (e) {
    alert('❌ NÃO REGISTROU: ' + e.message);
  }
  _busy = false;
  reload(true);
}

function pedirLog(colab, tipo) {
  if (tipo === 'nps_coletado') {
    const nota = prompt('Nota do NPS (0 a 10):');
    if (nota === null || nota === '') return;
    const ref = prompt('Cliente/negócio (opcional — id ou nome curto):') || '';
    return log(colab, tipo, { valor: Number(nota), ref_type: ref ? 'cliente' : null, ref_id: ref || null });
  }
  if (tipo === 'venda_atribuida_indicacao') {
    const v = prompt('Valor da venda (só números, ex.: 450000):');
    if (!v) return;
    return log(colab, tipo, { valor: Number(v) });
  }
  if (tipo === 'contrato_locacao') {
    const end = prompt('Endereço/identificação do imóvel:');
    if (end === null) return;
    const alq = prompt('Valor do 1º aluguel (só números):');
    if (!alq) return;
    const geo = confirm('É contrato da GEORGINA? (OK = sim — split 50/50 indicador+corretor)');
    return log(colab, tipo, { meta: { endereco: end, aluguel: Number(alq), georgina: geo } });
  }
  if (tipo.startsWith('doc_') || tipo.startsWith('ticket_')) {
    const ref = prompt('Identificação (contrato/cliente — igual na abertura e na resolução):');
    if (!ref) return;
    return log(colab, tipo, { ref_type: tipo.startsWith('doc') ? 'doc' : 'ticket', ref_id: ref, meta: { rotulo: ref } });
  }
  if (tipo.startsWith('conteudo:')) {
    const [, formato, marca] = tipo.split(':');
    return log(colab, 'conteudo_entregue', { meta: { formato, marca } });
  }
  return log(colab, tipo);
}

/* ── pedaços de UI ──────────────────────────────────────────────────────── */
function barra(lbl, feito, meta, cor = '#2563eb') {
  const pct = meta ? Math.min(100, Math.round(100 * feito / meta)) : 0;
  return `<div class="tiny" style="margin:4px 0">
    <div class="flex" style="justify-content:space-between"><span>${lbl}</span><b>${feito}${meta ? ' / ' + meta : ''}</b></div>
    <div style="background:var(--bg-3);border-radius:6px;height:9px"><div style="width:${pct}%;background:${cor};height:9px;border-radius:6px"></div></div>
  </div>`;
}

function botoes(card, podeLogar) {
  if (!podeLogar) return '';
  const k = card.key;
  const B = {
    leire: [['reativacao_tocada', '📱 Reativação tocada'], ['avaliacao_agendada', '📅 Avaliação agendada'],
      ['doc_aberto', '📄 Doc recebido'], ['doc_resolvido', '✅ Doc resolvido'],
      ['ticket_locacao_aberto', '🎫 Ticket locação'], ['ticket_locacao_respondido', '💬 Ticket respondido']],
    mariane: [['abordagem_indicacao', '🤝 Abordagem de indicação'], ['indicacao_qualificada', '⭐ Indicação qualificada'],
      ['nps_coletado', '📊 NPS coletado'], ['venda_atribuida_indicacao', '💰 Venda por indicação']],
    guilherme: [['contrato_locacao', '🔑 Contrato de locação'],
      ['conteudo:video:conquista', '🎬 Vídeo Conquista'], ['conteudo:video:map', '🎬 Vídeo MAP'],
      ['conteudo:art:conquista', '🎨 Art Conquista'], ['conteudo:art:map', '🎨 Art MAP']],
  }[k] || [];
  const lembrete = (k === 'leire' && (_d.lembrete_reativacao || []).length)
    ? `<div class="tiny" style="background:#7c3aed11;border:1px dashed #7c3aed55;border-radius:8px;padding:6px 8px;margin:6px 0">
        <b>Antes de tocar o lead:</b><br>${_d.lembrete_reativacao.map(esc).join('<br>')}</div>` : '';
  return `${lembrete}
    <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:6px">
      ${B.map(([t, lbl]) => `<button class="btn btn-primary btn-sm fz-log" data-colab="${k}" data-tipo="${t}">${lbl}</button>`).join('')}
    </div>
    ${k === 'guilherme' ? '<div class="tiny muted mt-1">🎯 Captações contam sozinhas pela aba Captações.</div>' : ''}
    ${k === 'leire' ? '<div class="tiny muted mt-1">📱 A fila de Reativação MAP também conta sozinha a cada lead trabalhado.</div>' : ''}`;
}

function cardHtml(card, unico, podeLogar) {
  const cor = COR[card.semaforo] || '#64748b';
  let corpo = '';
  if (card.placar_mes) {  // Guilherme — placar do MÊS
    const p = card.placar_mes;
    corpo = `<div class="tiny muted">Placar do mês · rampa <b>${esc((card.rampa || '').toUpperCase())}</b></div>
      ${Object.entries(p.metas).map(([f, m]) => barra(NOME_TIPO[f] || f, p.feito[f] || 0, m,
        f.startsWith('captacao') ? '#16a34a' : f.startsWith('contrato') ? '#0891b2' : '#7c3aed')).join('')}`;
  } else {
    const m = card.motor_meta || {}, f = card.motor_feito || {};
    corpo = `<div class="tiny muted">${NOME_TIPO[card.motor] || card.motor} · esperado até agora: <b>${card.esperado_agora}</b></div>
      ${barra('🌅 Manhã (meta ' + (m.manha || 0) + ')', f.manha || 0, m.manha || 0)}
      ${barra('🌇 Tarde (meta ' + (m.tarde || 0) + ')', f.tarde || 0, m.tarde || 0)}
      ${barra('📅 Dia', f.dia || 0, m.dia || 0, '#16a34a')}
      <div class="tiny muted">Semana: <b>${f.semana || 0}</b>/${m.semana || '—'} · Mês: <b>${f.mes || 0}</b>/${m.mes || '—'}</div>`;
  }
  let extras = '';
  if (card.key === 'leire') {
    const docs = card.docs || [], tks = card.tickets || [];
    extras = `<div class="tiny mt-1"><b>📄 Docs pendentes:</b> ${docs.length ? docs.map(d =>
      `<span class="badge" style="background:${d.estourado ? '#dc2626' : '#d97706'}22;color:${d.estourado ? '#dc2626' : '#d97706'}">${esc(d.rotulo)} · ${d.horas}h</span>`).join(' ') : 'nenhum ✅'}</div>
      <div class="tiny"><b>🎫 Tickets locação:</b> ${tks.length ? tks.map(t =>
      `<span class="badge" style="background:${t.estourado ? '#dc2626' : '#d97706'}22;color:${t.estourado ? '#dc2626' : '#d97706'}">${esc(t.rotulo)} · ${t.horas}h</span>`).join(' ') : 'nenhum ✅'}</div>`;
  }
  if (card.key === 'mariane' && card.nps) {
    const n = card.nps;
    extras = `<div class="flex tiny mt-1" style="gap:10px;flex-wrap:wrap">
      <span>📊 NPS: <b style="color:${(n.score ?? 100) >= n.meta_min ? '#16a34a' : '#dc2626'}">${n.score ?? '—'}</b> (meta ≥${n.meta_min}, ${n.n} respostas)</span>
      <span>🌟 Fila de promotores: <b>${n.fila_promotores}</b></span>
      <span>👀 Visitas sem NPS: <b>${n.visitas_sem_nps.total}</b>${n.visitas_sem_nps.atrasadas ? ` <b style="color:#dc2626">(${n.visitas_sem_nps.atrasadas} >48h)</b>` : ''}</span>
    </div>`;
  }
  const contadores = Object.entries(card.contadores || {})
    .filter(([t]) => !['reativacao_tocada', 'abordagem_indicacao'].includes(t) || card.placar_mes)
    .map(([t, c]) => `${NOME_TIPO[t] || t}: <b>${c.dia}</b> hoje · ${c.mes} no mês`).join(' · ');
  return `<div class="card" style="flex:1;min-width:${unico ? '100%' : '300px'};margin:0;border-top:3px solid ${cor}">
    <div class="flex items-center" style="gap:8px">
      <span style="width:14px;height:14px;border-radius:50%;background:${cor};display:inline-block"></span>
      <b style="font-size:16px">${esc(card.nome)}</b>
      <span class="tiny muted">${card.pct != null ? card.pct + '% do esperado' : ''}</span>
      <span style="margin-left:auto"></span>
      ${(card.alertas || []).map(a => `<span class="badge" style="background:#dc262622;color:#dc2626;font-weight:700">${esc(a)}</span>`).join(' ')}
    </div>
    <div class="mt-1">${corpo}</div>
    ${extras}
    ${contadores ? `<div class="tiny muted mt-1">${contadores}</div>` : ''}
    ${botoes(card, podeLogar)}
  </div>`;
}

function render() {
  const me = _d.sou, gestor = _d.gestor;
  const cards = _d.cards || [];
  const unico = cards.length === 1;
  _root.innerHTML = `<div id="fisc-root">
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">👁 Painel de Fiscalização</h2>
        <span class="tiny muted">produção logada NO ATO · semáforo por horário · ${gestor ? 'visão gestor' : 'minha produção'}</span>
        <span style="margin-left:auto"></span>
        ${_undo && Date.now() < _undo.ate ? `<button class="btn btn-ghost btn-sm" id="fz-undo">↩️ desfazer último (90s)</button>` : ''}
        <button class="btn btn-ghost btn-sm" id="fz-reload">↻</button>
      </div>
    </div>
    <div class="flex mt-2" style="gap:8px;flex-wrap:wrap;align-items:stretch">
      ${cards.map(c => cardHtml(c, unico, gestor || c.key === me)).join('')}
    </div>
    ${!cards.length ? '<div class="card muted mt-2">Nenhum card pra mostrar — fale com a gestão pra entrar na configuração do painel.</div>' : ''}
  </div>`;
  _root.querySelector('#fz-reload').onclick = () => reload();
  const u = _root.querySelector('#fz-undo');
  if (u) u.onclick = async () => {
    try { await api.request('/api/v3/producao/eventos', { method: 'POST', body: { action: 'undo', id: _undo.id } }); }
    catch (e) { alert('❌ ' + e.message); }
    _undo = null; reload(true);
  };
  _root.querySelectorAll('.fz-log').forEach(b => b.onclick = () => pedirLog(b.dataset.colab, b.dataset.tipo));
}
