/* PSM-OS v2 — Briefing de Guerra (boletim do comandante)
   Compila vendas + mídia + concorrência e a IA escreve a leitura estratégica
   da semana. Gerado sob demanda OU automático toda segunda (cron) com
   notificação pra gerência/diretoria. Tudo dado real. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _busy = false;

export async function pageIntelBriefing(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Gerência/Diretoria.</div>';
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
          <h2 class="card-title">⚔️ Briefing de Guerra</h2>
          <p class="card-sub">O boletim do comandante — vendas × mídia × concorrência, com a leitura estratégica da IA. Gera automático toda segunda 7h.</p>
        </div>
        <button class="btn btn-primary" id="bg-gen">⚔️ Gerar briefing agora</button>
      </div>

      ${_d.pending ? `<div class="alert alert-warn">⏳ Histórico não persiste ainda — rode <code>supabase/sprint9_20_war_briefings.sql</code>. O briefing é gerado e exibido normalmente.</div>` : ''}

      <!-- fatos atuais -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px">
        ${factCard('🤝 Vendas (mês)', `${v.vendas_mes ?? '—'}`, `R$ ${moneyShort(v.vgv_mes)} VGV · ${v.pipeline_aberto ?? '—'} no pipeline`, '#16a34a')}
        ${factCard('📢 Mídia (Meta)', a.cpl != null ? 'R$ ' + money(a.cpl) : '—', `CPL · ${fmtNum(a.leads_30d)} leads/30d`, '#f59e0b')}
        ${factCard('📉 Perdas 90d', `${v.perdas_90d ?? '—'}`, `${v.trash_pct == null ? '—' : pct2(v.trash_pct)} lixo/desqualificado`, '#dc2626')}
        ${factCard('🎯 Concorrentes', `${c.length}`, c.length ? c.slice(0,3).map(x=>escapeHtml(x.concorrente)).join(', ') : 'sem captura', '#7c3aed')}
      </div>

      <div id="bg-out" style="margin-top:14px"></div>

      <h3 class="card-title" style="margin-top:18px">📜 Briefings anteriores</h3>
      <div id="bg-list" style="margin-top:8px">
        ${briefings.length ? briefings.map(briefCard).join('') : '<div class="tiny muted">Nenhum briefing salvo ainda. Clique em "Gerar briefing agora".</div>'}
      </div>
      <div class="tiny muted" style="margin-top:12px">Fatos reais (deals do RD + cache Meta + Biblioteca de Anúncios). A IA escreve a leitura — não inventa número além dos fatos.</div>
    </div>`;
  document.getElementById('bg-gen').addEventListener('click', generate);
}

function factCard(t, big, sub, color) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-top:3px solid ${color};border-radius:var(--r-md);padding:10px 12px">
    <div style="font-size:11px;font-weight:700;color:var(--ink-muted)">${t}</div>
    <div style="font-size:20px;font-weight:900;color:${color};margin:2px 0">${big}</div>
    <div class="tiny muted">${sub}</div></div>`;
}

function briefCard(b) {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px;margin-bottom:10px">
    <div class="flex items-center gap-2" style="margin-bottom:6px">
      <span style="font-weight:800;font-size:12px;color:#7c3aed">⚔️ ${fmtDT(b.created_at)}</span>
      <span class="tiny muted" style="margin-left:auto">${escapeHtml(b.model || '')}${b.criado_por ? '' : ' · automático'}</span>
    </div>
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
      out.innerHTML = `<div style="background:linear-gradient(180deg,rgba(124,58,237,.07),transparent);border:1px solid rgba(124,58,237,.3);border-radius:var(--r-md);padding:16px 18px">
        <div style="font-weight:800;font-size:13px;color:#7c3aed;margin-bottom:8px">⚔️ Briefing da semana <span class="tiny muted" style="font-weight:400">· ${escapeHtml(r.model || 'IA')}${r.saved ? ' · salvo' : ''}</span></div>
        <div style="font-size:13.5px;line-height:1.6">${mdLite(r.briefing)}</div></div>`;
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
    .replace(/^### (.*)$/gm, '<div style="font-weight:800;margin:8px 0 2px">$1</div>')
    .replace(/^## (.*)$/gm, '<div style="font-weight:800;font-size:14px;margin:12px 0 4px">$1</div>')
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
