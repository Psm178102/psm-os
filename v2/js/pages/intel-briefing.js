/* PSM-OS v2 — Briefing de Guerra (boletim do comandante)
   Compila vendas + mídia + concorrência e a IA escreve a leitura estratégica
   da semana. Gerado sob demanda OU automático toda segunda (cron) com
   notificação pra gerência/diretoria. Tudo dado real. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _busy = false;

export async function pageIntelBriefing(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 10) {
    root.innerHTML = '<div class="alert alert-warn">🔒 A seção Inteligência é só dos sócios.</div>';
    return;
  }
  await reload();
}

async function reload() {
  _root.innerHTML = spinner('Carregando briefings…');
  try {
    _d = await api.request('/api/v3/intel/war_briefing');
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
    return;
  }
  render();
}

function render() {
  const briefings = _d.briefings || [];
  const f = _d.facts_atual || {};
  const v = f.vendas || {}, a = f.ads || {}, c = f.concorrencia || [];
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:6px">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">📋 Briefing da semana</h2>
          <p class="card-sub">O boletim do comandante — vendas × mídia × concorrência, com a leitura estratégica da IA. Sai automático toda segunda, 7h.</p>
        </div>
        <button class="btn btn-primary" id="bg-gen">⚔️ Gerar briefing agora</button>
      </div>

      ${_d.pending ? `<div class="alert alert-warn">⏳ Histórico não persiste ainda — rode <code>supabase/sprint9_20_war_briefings.sql</code>. O briefing é gerado e exibido normalmente.</div>` : ''}

      <!-- fatos atuais -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px">
        ${factCard('🤝 Vendas (mês)', `${v.vendas_mes ?? '—'}`, `R$ ${moneyShort(v.vgv_mes)} VGV · ${v.pipeline_aberto ?? '—'} no pipeline`, 'var(--ok)')}
        ${factCard('📢 Mídia (Meta)', a.cpl != null ? 'R$ ' + money(a.cpl) : '—', `CPL · ${fmtNum(a.leads_30d)} leads/30d`, 'var(--warn)')}
        ${factCard('📉 Perdas 90d', `${v.perdas_90d ?? '—'}`, `${v.trash_pct == null ? '—' : pct2(v.trash_pct)} lixo/desqualificado`, 'var(--err)')}
        ${factCard('🎯 Concorrentes', `${c.length}`, c.length ? c.slice(0,3).map(x=>escapeHtml(x.concorrente)).join(', ') : 'sem captura', 'var(--accent-ink)')}
      </div>

      ${ordensCard()}

      <div id="bg-out" style="margin-top:14px"></div>

      <h3 class="card-title" style="margin-top:18px">📜 Briefings anteriores</h3>
      <div id="bg-list" style="margin-top:8px">
        ${briefings.length ? briefings.map(briefCard).join('') : '<div class="tiny muted">Nenhum briefing salvo ainda. Clique em "Gerar briefing agora".</div>'}
      </div>
      <div class="tiny muted" style="margin-top:12px">Fatos reais (deals do RD + cache Meta + Biblioteca de Anúncios). A IA escreve a leitura — não inventa número além dos fatos.</div>
    </div>`;
  document.getElementById('bg-gen').addEventListener('click', generate);
  _root.querySelectorAll('.bg-ordem').forEach(cb => cb.addEventListener('change', async () => {
    try { const r = await api.request('/api/v3/intel/war_briefing', { method: 'POST', body: { action: 'toggle_ordem', i: +cb.dataset.i } }); if (r && r.ordens) { _d.ordens = r.ordens; render(); } }
    catch (e) { alert('⚠️ ' + e.message); }
  }));
  _root.querySelectorAll('[data-deleg]').forEach(b => b.addEventListener('click', () => delegar(+b.dataset.i, b.dataset.deleg)));
}

// v88.82 (decisão do Paulo): a ordem é do sócio; ele assume ou delega a um usuário ou a um agente de IA.
async function delegar(i, tipo) {
  let alvo = '';
  if (tipo !== 'socio') {
    const sel = document.getElementById(`bg-alvo-${tipo}-${i}`);
    alvo = sel ? sel.value : '';
    if (!alvo) { alert(tipo === 'agente' ? 'Escolha o agente.' : 'Escolha o usuário.'); return; }
  }
  const prazo = document.getElementById(`bg-prazo-${i}`)?.value || null;
  const st = document.getElementById(`bg-st-${i}`);
  if (st) st.innerHTML = `<span class="spinner"></span> ${tipo === 'agente' ? 'O agente está escrevendo a entrega…' : 'Criando a tarefa…'}`;
  try {
    const r = await api.request('/api/v3/intel/war_briefing', { method: 'POST', body: { action: 'delegar', i, tipo, alvo, prazo } });
    if (r && r.ok && r.ordens) { _d.ordens = r.ordens; render(); }
    else if (st) st.innerHTML = `<span style="color:var(--err)">⚠️ ${escapeHtml((r && r.error) || 'erro')}</span>`;
  } catch (e) { if (st) st.innerHTML = `<span style="color:var(--err)">⚠️ ${escapeHtml(e.message)}</span>`; }
}

// ── Ordens da semana (v84.6 → v88.82): cada ordem tem DONO, PRAZO e vira tarefa na Agenda ──
const ST_ORDEM = {
  pendente: ['sem dono', 'var(--ink-muted)'], em_andamento: ['em andamento', 'var(--info)'],
  atrasada: ['atrasada', 'var(--err)'], aguardando_validacao: ['valide a entrega', 'var(--warn)'], feita: ['feita', 'var(--ok)'],
};
function ordensCard() {
  const o = _d.ordens || {};
  const itens = o.itens || [];
  if (!itens.length) return '';
  const feitos = itens.filter(x => x.feito).length;
  const dl = _d.delegaveis || { usuarios: [], agentes: [] };
  const hoje = new Date(); const sexta = new Date(hoje); sexta.setDate(hoje.getDate() + ((5 - hoje.getDay() + 7) % 7 || 7));
  const prazoPadrao = `${sexta.getFullYear()}-${String(sexta.getMonth() + 1).padStart(2, '0')}-${String(sexta.getDate()).padStart(2, '0')}`;   // data local (toISOString virava sábado à noite)
  return `<div class="card" style="margin-top:14px;border-left:4px solid var(--err);border-radius:0">
    <h3 class="card-title">🔥 Ordens da semana <span class="tiny muted" style="font-weight:400">· ${escapeHtml(o.semana || '')} · ${feitos}/${itens.length} feitas</span></h3>
    <div class="tiny muted" style="margin-bottom:8px">Cada ordem é sua até você delegar. Delegada, vira tarefa com prazo na Agenda do dono. Agente de IA entrega o plano na hora e você valida. O briefing da semana seguinte cobra o que ficou para trás.</div>
    ${itens.map((it, i) => {
      const [stLbl, stCor] = ST_ORDEM[it.status] || ST_ORDEM.pendente;
      const dono = it.dono ? `${it.dono.tipo === 'agente' ? '🤖 ' : '👤 '}${escapeHtml(it.dono.nome)}` : 'Paulo (padrão)';
      const podeDelegar = !it.feito && !it.task_id;
      return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:13px">
          <input type="checkbox" class="bg-ordem" data-i="${i}" ${it.feito ? 'checked' : ''} style="margin-top:2px">
          <span style="flex:1;${it.feito ? 'text-decoration:line-through;opacity:.55' : ''}">${escapeHtml(it.txt)}</span>
        </label>
        <div class="flex gap-2 tiny" style="flex-wrap:wrap;align-items:center;margin:6px 0 0 24px">
          <span style="font-weight:600;color:${stCor}">● ${stLbl}</span>
          <span class="muted">dono: <b>${dono}</b>${it.prazo ? ` · prazo ${escapeHtml(it.prazo)}` : ''}</span>
          <span id="bg-st-${i}"></span>
        </div>
        ${podeDelegar ? `<div class="flex gap-2" style="flex-wrap:wrap;align-items:center;margin:8px 0 0 24px">
          <label class="tiny muted">prazo <input id="bg-prazo-${i}" type="date" class="input" value="${prazoPadrao}" style="padding:3px 6px;font-size:12px;width:140px;display:inline-block"></label>
          <button class="btn btn-sm btn-ghost" data-deleg="socio" data-i="${i}">Assumir</button>
          <select id="bg-alvo-usuario-${i}" class="select" style="padding:3px 6px;font-size:12px"><option value="">usuário…</option>${(dl.usuarios || []).map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.nome)}${u.papel ? ' · ' + escapeHtml(u.papel) : ''}</option>`).join('')}</select>
          <button class="btn btn-sm btn-ghost" data-deleg="usuario" data-i="${i}">Delegar</button>
          <select id="bg-alvo-agente-${i}" class="select" style="padding:3px 6px;font-size:12px"><option value="">agente de IA…</option>${(dl.agentes || []).map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.nome)}</option>`).join('')}</select>
          <button class="btn btn-sm btn-ghost" data-deleg="agente" data-i="${i}">Delegar ao agente</button>
        </div>` : ''}
        ${it.entrega ? `<details style="margin:8px 0 0 24px"><summary class="tiny" style="cursor:pointer;font-weight:600">🤖 Entrega do ${escapeHtml(it.dono?.nome || 'agente')}${it.entrega_modelo ? ' · ' + escapeHtml(it.entrega_modelo) : ''}</summary>
          <div style="font-size:13px;line-height:1.55;margin-top:6px;background:var(--bg-3);border-radius:var(--r-md);padding:10px 12px">${mdLite(it.entrega)}</div></details>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function factCard(t, big, sub, color) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${color};border-radius:var(--r-md);padding:10px 12px">
    <div style="font-size:11px;font-weight:600;color:var(--ink-muted)">${t}</div>
    <div style="font-size:20px;font-weight:600;color:${color};margin:2px 0">${big}</div>
    <div class="tiny muted">${sub}</div></div>`;
}

function briefCard(b) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px;margin-bottom:10px">
    <div class="flex items-center gap-2" style="margin-bottom:6px">
      <span style="font-weight:600;font-size:12px;color:var(--roxo)">⚔️ ${fmtDT(b.created_at)}</span>
      <span class="tiny muted" style="margin-left:auto">${escapeHtml(b.model || '')}${b.criado_por ? '' : ' · automático'}</span>
    </div>
    ${b.facts && b.facts.ia_diag ? `<div class="tiny" style="color:var(--warn);margin-bottom:6px" title="gravado pelo sistema na hora da geração">⚠️ A IA principal não respondeu: ${escapeHtml(b.facts.ia_diag.erro_modelo_principal || b.facts.ia_diag.erro_analyze || '')}</div>` : ''}
    <div style="font-size:13px;line-height:1.55">${mdLite(b.briefing || '')}</div>
  </div>`;
}

async function generate() {
  if (_busy) return;
  _busy = true;
  const out = document.getElementById('bg-out');
  out.innerHTML = `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:14px"><span class="spinner"></span> Compilando frentes e montando o briefing de guerra…</div>`;
  try {
    const r = await api.request('/api/v3/intel/war_briefing', { method: 'POST', body: {} });
    if (r && r.ok && r.briefing) {
      out.innerHTML = `<div style="background:linear-gradient(180deg,rgba(124,58,237,.07),transparent);border:1px solid var(--accent-ink);border-radius:var(--r-md);padding:16px 18px">
        <div style="font-weight:600;font-size:13px;color:var(--roxo);margin-bottom:8px">⚔️ Briefing da semana <span class="tiny muted" style="font-weight:400">· ${escapeHtml(r.model || 'IA')}${r.saved ? ' · salvo' : ''}</span></div>
        <div style="font-size:13px;line-height:1.6">${mdLite(r.briefing)}</div></div>`;
      if (r.saved) setTimeout(reload, 1200);
    } else {
      out.innerHTML = `<div class="alert alert-warn">Não consegui gerar: ${escapeHtml((r && r.error) || 'erro')}</div>`;
    }
  } catch (e) {
    out.innerHTML = `<div class="alert alert-err">Erro: ${escapeHtml(e.message)}</div>`;
  } finally { _busy = false; }
}

/* ─── helpers ─── */
function mdLite(t) {
  return escapeHtml(t)
    .replace(/^### (.*)$/gm, '<div style="font-weight:600;margin:8px 0 2px">$1</div>')
    .replace(/^## (.*)$/gm, '<div style="font-weight:600;font-size:14px;margin:12px 0 4px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*\d+\.\s+(.*)$/gm, '<div style="margin:3px 0 3px 6px">▸ $1</div>')
    .replace(/^\s*[-*] (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}
function spinner(t) { return `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> ${t}</div></div>`; }
function money(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function moneyShort(v) { return money(v); }
function pct2(v) { return v == null ? '—' : (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
function fmtNum(v) { return v == null ? '—' : (v || 0).toLocaleString('pt-BR'); }
function fmtDT(s) { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; } }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
